/**
 * XDataHub Canvas Drop Extension
 * ==================================
 *
 * 功能:
 * 从 XDataHub 浮动窗口拖动媒体卡片到 ComfyUI 画布空白处时，
 * 自动在该落点创建对应的 X*Get 节点并载入该媒体。
 *
 * 设计要点:
 * - 复用官方建节点原语 `LiteGraph.createNode(name)` + `graph.add(node)`
 *   （与项目内 xlinker_extension.js 同款），不依赖 Vue composable / Pinia。
 * - 仅在画布 *空白处* 接管；落在已有节点上时完全放行，保留
 *   现有「拖到 X*Get 节点预览面板 = 载入」的行为。
 * - 以 capture 阶段监听 document 的 dragover / drop，仅对自家 MIME
 *   `application/x-xdatahub-media+json` 生效；非自家拖拽一律放行，
 *   不影响 ComfyUI 原生拖文件 / 拖官方节点的功能。
 * - drop 处理后 preventDefault + stopImmediatePropagation，让官方
 *   app.ts 的 bubble drop 命中 `event.defaultPrevented` 提前退出。
 * - 建节点以「画布当前挂载的图」为目标（`app.canvas.graph`）：主画布时
 *   就是根图，进入子图编辑后就是该子图。**不能用 `app.graph`**，它是
 *   已废弃别名、恒指根图，会把节点建到用户看不见的地方（子图内拖拽
 *   看似「没反应」就是此因）。
 *
 * 支持的类型：图片 / 视频 / 音频 / 文本 → 建 X*Get 节点（多选媒体
 * 建一个 XMediaListGet）；LoRA → 建 XLoraGet，把拖过来的每个 LoRA
 * 按原顺序填成一行（多选就是一个节点多行）。
 *
 * 开关来源：XDataHub 设置面板「画布交互」段的 `canvas_drop_enabled`
 * （后端 `/xz3r0/xdatahub/settings` 持久化）。本扩展运行在 ComfyUI
 * 宿主页，与 XDataHub 设置 iframe 同源；setup 时拉取一次，随后监听
 * iframe postMessage 的 `xdatahub:host-settings-updated` 即时同步。
 */

import { app } from "../../scripts/app.js";

const EXT_NAME = "xz3r0.xdatahub_canvas_drop";
const EXT_GUARD_KEY = "__xdatahub_canvas_drop_registered__";
const ROOT = globalThis;

const XDATAHUB_MEDIA_MIME = "application/x-xdatahub-media+json";
const LIST_NODE_CLASS = "XMediaListGet";
const MEDIA_ITEMS_PROP = "__xdatahub_media_items";
const MEDIA_TYPE_PROP = "__xdatahub_media_type";
const SETTINGS_ENDPOINT = "/xz3r0/xdatahub/settings";
const SETTING_FIELD = "canvas_drop_enabled";
const SETTING_DEFAULT = true;

// 模块级缓存：drop 事件同步处理，不能在事件回调里 await fetch。
let _canvasDropEnabled = SETTING_DEFAULT;

// media_type -> node class。
const TYPE_TO_CLASS = {
    image: "XImageGet",
    video: "XVideoGet",
    audio: "XAudioGet",
    text: "XStringGet",
    lora: "XLoraGet",
};

// 默认落点偏移：按节点大致尺寸居中。
const DEFAULT_DROP_OFFSET = [130, 160];

// 节点类 -> 存储 / 标题 property 名配置。需与各自扩展内
// restoreStoredData 读取的 property 名严格一致，确保预置的
// properties 被 onNodeCreated 在预览渲染点读到。
const NODE_CONFIG = {
    XImageGet: {
        kind: "image",
        valueProperty: "__xdatahub_media_ref",
        titleProperty: "__ximageget2_title",
    },
    XVideoGet: {
        kind: "video",
        valueProperty: "__xdatahub_media_ref",
        titleProperty: "",
    },
    XAudioGet: {
        kind: "audio",
        valueProperty: "__xdatahub_media_ref",
        titleProperty: "",
    },
    XStringGet: {
        kind: "text",
        valueProperty: "__xdatahub_text_value",
        titleProperty: "__xdatahub_text_title",
        isText: true,
    },
    XLoraGet: {
        kind: "lora",
        isLora: true,
        // XLoraGet 没有可直接预置的 widget：把种子行挂在实例字段上，
        // createNode 的 options 会在 onNodeCreated 之前赋值，
        // 扩展在 installNodeUi 里读一次并写回 lora_stack（见
        // xloraget_extension.js 的 readStoredRows）。
        pendingRowsField: "__xloraget_pending_rows",
        dropOffset: [310, 280],
    },
};

function isCanvasDropEnabled() {
    return _canvasDropEnabled;
}

// 拉取最新设置值到模块级缓存。setup 时调用一次，失败则保持默认。
async function refreshCanvasDropEnabled() {
    try {
        const res = await fetch(SETTINGS_ENDPOINT);
        if (!res.ok) return;
        const payload = await res.json();
        const v = payload?.settings?.[SETTING_FIELD];
        _canvasDropEnabled =
            v === undefined ? SETTING_DEFAULT : v === true;
    } catch {
        // 保持当前值。
    }
}

/**
 * 把任意形状的文本内容抽成字符串。
 *
 * XDataHub 的文本记录可能直接给字符串，也可能包在
 * `{text}` / `{payload: {text}}` 里，这里递归向下取。
 */
function extractPayloadText(value, depth = 0) {
    if (depth > 4 || value == null) return "";
    if (typeof value === "string") return value;
    if (typeof value !== "object") return String(value);
    if (typeof value.text === "string") return value.text;
    if (value.payload != null) {
        return extractPayloadText(value.payload, depth + 1);
    }
    return "";
}

/**
 * 把可选数值统一成 number 或 null（0 是合法强度，不能被吞）。
 */
function toOptionalNumber(value) {
    if (value === null || value === undefined || value === "") return null;
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
}

/**
 * 解析自家拖拽 payload。逻辑等价于 xmediaget_extension.js 的
 * parseMediaDragPayload，但本扩展独立持有一份，避免跨模块耦合。
 * 返回 null 表示不是本扩展要处理的拖拽（应放行）。
 */
function parsePayload(dataTransfer) {
    if (!dataTransfer) return null;
    let raw = "";
    try {
        raw = dataTransfer.getData(XDATAHUB_MEDIA_MIME) || "";
    } catch {
        return null;
    }
    if (!raw) return null;
    let payload;
    try {
        payload = JSON.parse(raw);
    } catch {
        return null;
    }
    if (!payload || typeof payload !== "object") return null;
    const source = String(payload.source || "").trim().toLowerCase();
    if (source !== "xdatahub") return null;
    const mediaType = String(payload.media_type || "").trim().toLowerCase();
    if (!mediaType) return null;
    const mediaRef = String(payload.media_ref || "").trim();
    const textValue = extractPayloadText(
        payload.text_value || payload.text || payload.payload
    );
    // text 用 text_value 作为内容载体，其余用 media_ref。
    if (mediaType === "text") {
        if (!textValue.trim()) return null;
    } else if (!mediaRef) {
        return null;
    }
    const strengthModel = toOptionalNumber(payload.strength_model);
    const strengthClip = toOptionalNumber(payload.strength_clip);
    const thumbUrl = String(payload.thumb_url || "");
    const rawItems = Array.isArray(payload.items) ? payload.items : [];
    const items = rawItems
        .map((item) => ({
            media_ref: String(item?.media_ref || "").trim(),
            media_type: String(item?.media_type || "").toLowerCase(),
            title: String(item?.title || ""),
            thumb_url: String(item?.thumb_url || ""),
            strength_model: toOptionalNumber(item?.strength_model),
            strength_clip: toOptionalNumber(item?.strength_clip),
        }))
        .filter((item) => item.media_ref);
    if (!items.length && mediaRef) {
        items.push({
            media_ref: mediaRef,
            media_type: mediaType,
            title: String(payload.title || ""),
            thumb_url: thumbUrl,
            strength_model: strengthModel,
            strength_clip: strengthClip,
        });
    }
    return {
        media_ref: mediaRef,
        media_type: mediaType,
        text_value: textValue,
        title: String(payload.title || ""),
        thumb_url: thumbUrl,
        strength_model: strengthModel,
        strength_clip: strengthClip,
        items,
    };
}

function hasOwnMime(dataTransfer) {
    try {
        return typeof dataTransfer?.types?.includes === "function"
            && dataTransfer.types.includes(XDATAHUB_MEDIA_MIME);
    } catch {
        return false;
    }
}

function resolveCanvasPos(event) {
    const canvas = app?.canvas;
    if (!canvas) return null;
    // 优先官方同款 adjustMouseEvent，它会填充 event.canvasX/Y。
    if (typeof canvas.adjustMouseEvent === "function") {
        try {
            canvas.adjustMouseEvent(event);
            if (Number.isFinite(event.canvasX)
                && Number.isFinite(event.canvasY)) {
                return [event.canvasX, event.canvasY];
            }
        } catch {
            // 落到下面的回退。
        }
    }
    // 回退：convertEventToCanvasOffset（官方 addNodeAtPosition 同款）。
    if (typeof canvas.convertEventToCanvasOffset === "function") {
        try {
            const pos = canvas.convertEventToCanvasOffset({
                clientX: event.clientX,
                clientY: event.clientY,
            });
            if (Array.isArray(pos) && Number.isFinite(pos[0])
                && Number.isFinite(pos[1])) {
                return [pos[0], pos[1]];
            }
        } catch {
            // 忽略。
        }
    }
    return null;
}

/**
 * 取「画布当前正在编辑的图」。
 *
 * 主画布 = 根图；进入子图后官方会 canvas.setGraph(subgraph)，因此这里
 * 拿到的是当前打开的那张子图。不能用 app.graph：它是已废弃别名，恒返回
 * 根图，会把节点建到用户当前看不到的地方。
 */
function resolveActiveGraph() {
    const canvasGraph = app?.canvas?.graph;
    if (canvasGraph && typeof canvasGraph.add === "function") {
        return canvasGraph;
    }
    return app?.graph;
}

function isOverBlankCanvas(cx, cy) {
    const graph = resolveActiveGraph();
    if (!graph) return false;
    if (typeof graph.getNodeOnPos !== "function") return false;
    const hit = graph.getNodeOnPos(cx, cy);
    return !hit;
}

/**
 * XLoraGet 的拖拽种子：按拖拽顺序转成多行 lora_stack 数据。
 * 字段按 xloraget_extension.js 的 makeRow / writeStoredRows 约定。
 */
function buildLoraSeedRows(payload) {
    const rawItems = Array.isArray(payload?.items) && payload.items.length
        ? payload.items
        : [payload];
    const source = rawItems.filter(
        (entry) => String(entry?.media_type || "lora").toLowerCase()
            === "lora"
    );
    const rows = [];
    const seen = new Set();
    for (const entry of source) {
        const loraRef = String(entry?.media_ref || "").trim();
        if (!loraRef || seen.has(loraRef)) continue;
        seen.add(loraRef);
        const hasModel = Number.isFinite(entry?.strength_model);
        const hasClip = Number.isFinite(entry?.strength_clip);
        const model = hasModel ? entry.strength_model : 1;
        const clip = hasClip ? entry.strength_clip : model;
        rows.push({
            active: true,
            lora_ref: loraRef,
            lora_name: loraRef,
            title: String(entry?.title || ""),
            strength_model: model,
            strength_clip: clip,
            separate_clip_strength: clip !== model,
            // 拖拽数据里没带强度时，等节点拉取远端数据补全。
            strength_sync_pending: !hasModel || !hasClip,
            thumb_url: String(entry?.thumb_url || ""),
            pin: "none",
        });
    }
    return rows;
}

function createAndLoadNode(payload, cx, cy) {
    const className = TYPE_TO_CLASS[payload.media_type];
    if (!className) return null;
    const cfg = NODE_CONFIG[className];
    if (!cfg) return null;
    const graph = resolveActiveGraph();
    if (!graph || typeof graph.add !== "function") return null;
    if (typeof LiteGraph === "undefined" || !LiteGraph?.createNode) {
        return null;
    }

    // 落点居中：用默认节点尺寸 260×320，此时 node 尚未创建，
    // 不能读 node.size。LoRA 节点更宽高，用配置里的偏移。
    const [offsetX, offsetY] = cfg.dropOffset || DEFAULT_DROP_OFFSET;
    const pos = [cx - offsetX, cy - offsetY];

    // 预置 properties：通过 createNode 第三参数 options.properties 注入，
    // LiteGraph 内部 Object.assign(node, options) 发生在 onNodeCreated
    // 之前，使各扩展 onNodeCreated 内 installNodeUi + restoreStoredData
    // 能在读值点读到并 setPreview 渲染预览。
    const seedProperties = {};
    const nodeOptions = { pos, properties: seedProperties };
    let seedRowsJson = "";
    if (cfg.isLora) {
        const rows = buildLoraSeedRows(payload);
        if (!rows.length) return null;
        // 同一条 options 会先于 onNodeCreated 赋值到节点上，
        // XLoraGet 扩展读一次种子并写回 lora_stack。
        seedRowsJson = JSON.stringify(rows);
        nodeOptions[cfg.pendingRowsField] = seedRowsJson;
    } else {
        seedProperties[cfg.valueProperty] =
            cfg.isText ? payload.text_value : payload.media_ref;
        if (cfg.titleProperty && payload.title) {
            seedProperties[cfg.titleProperty] = payload.title;
        }
    }

    let node = null;
    try {
        node = LiteGraph.createNode(className, undefined, nodeOptions);
    } catch (err) {
        console.warn(
            "[XDataHub CanvasDrop] createNode failed:", err
        );
        return null;
    }
    if (!node) return null;

    try {
        graph.add(node);
    } catch (err) {
        console.warn("[XDataHub CanvasDrop] graph.add failed:", err);
        // 不返回 null：node 已有 property 值，序列化 / 未来选中后
        // 刷新仍能渲染。
    }

    // 补设 widget.value，确保执行期 execute() 拿到正确参数。
    const setWidget = (name, value) => {
        const w = node?.widgets?.find?.((w) => w.name === name);
        if (w) {
            w.value = String(value || "");
            return true;
        }
        return false;
    };
    if (cfg.isLora) {
        // 兜底：扩展在 installNodeUi 阶段已把种子写入 lora_stack；
        // 若它还没装上（或钩子未跑到），这里补写一份，保证保存 /
        // 执行时 stack 不为空。
        const storageWidget = node?.widgets?.find?.(
            (w) => w.name === "lora_stack"
        );
        if (
            storageWidget
            && seedRowsJson
            && (!storageWidget.value || storageWidget.value === "[]")
        ) {
            storageWidget.value = seedRowsJson;
        }
    } else if (cfg.isText) {
        setWidget("text_value", payload.text_value);
        setWidget("title_value", payload.title || "");
    } else {
        setWidget("media_ref", payload.media_ref);
        // XVideoGet/XAudioGet/XImageGet 没有 title_value widget；
        // XImageGet 的 title widget 由 ximageget2 扩展自管，
        // 此处不强制写，title 经 property 已存。
    }

    try {
        node.setDirtyCanvas?.(true, true);
    } catch {
        // 忽略。
    }
    try {
        if (typeof app?.canvas?.selectItems === "function") {
            app.canvas.selectItems([node]);
        } else if (typeof app?.canvas?.selectNode === "function") {
            app.canvas.selectNode(node);
        }
    } catch {
        // 忽略。
    }
    return node;
}

function createMediaListNode(payload, cx, cy) {
    const entries = payload.items.filter(
        (item) => item.media_ref
            && ["image", "video", "audio"].includes(item.media_type)
    );
    if (!entries.length) return null;
    const mediaType = entries[0].media_type;
    const items = { image: [], video: [], audio: [] };
    for (const entry of entries) {
        if (entry.media_type !== mediaType) continue;
        items[mediaType].push({
            ref: entry.media_ref,
            title: entry.title,
            enabled: true,
        });
    }
    if (!items[mediaType].length) return null;

    const graph = resolveActiveGraph();
    if (!graph || typeof graph.add !== "function") return null;
    if (typeof LiteGraph === "undefined" || !LiteGraph?.createNode) {
        return null;
    }

    const pos = [cx - 180, cy - 260];
    const seedProperties = {};
    seedProperties[MEDIA_ITEMS_PROP] = JSON.stringify(items);
    seedProperties[MEDIA_TYPE_PROP] = mediaType;

    let node = null;
    try {
        node = LiteGraph.createNode(LIST_NODE_CLASS, undefined, {
            pos,
            properties: seedProperties,
        });
    } catch (err) {
        console.warn("[XDataHub CanvasDrop] createNode failed:", err);
        return null;
    }
    if (!node) return null;

    try {
        graph.add(node);
    } catch (err) {
        console.warn("[XDataHub CanvasDrop] graph.add failed:", err);
    }

    // 子图里 V3 widget 可能在 add 之后被重建；
    // 把种子数据额外挂在实例上，供节点扩展延迟恢复。
    node.__xmlg_pending_items = seedProperties[MEDIA_ITEMS_PROP];
    node.__xmlg_pending_type = mediaType;

    const setWidget = (name, value) => {
        const widget = node?.widgets?.find?.(
            (entry) => entry.name === name
        );
        if (widget) {
            widget.value = value;
            return true;
        }
        return false;
    };
    setWidget("media_items", seedProperties[MEDIA_ITEMS_PROP]);
    setWidget("media_type", mediaType);

    try {
        node.setDirtyCanvas?.(true, true);
    } catch {
        // 忽略。
    }
    try {
        if (typeof app?.canvas?.selectItems === "function") {
            app.canvas.selectItems([node]);
        } else if (typeof app?.canvas?.selectNode === "function") {
            app.canvas.selectNode(node);
        }
    } catch {
        // 忽略。
    }
    return node;
}

function installDropHandler() {
    document.addEventListener(
        "dragover",
        (event) => {
            if (!hasOwnMime(event.dataTransfer)) return;
            event.preventDefault();
            if (event.dataTransfer) {
                event.dataTransfer.dropEffect = "copy";
            }
        },
        true,
    );

    document.addEventListener(
        "drop",
        (event) => {
            // 非自家拖拽一律放行。
            if (!hasOwnMime(event.dataTransfer)) return;

            // 开关关闭：不接管，交还官方 / 节点内逻辑。
            if (!isCanvasDropEnabled()) return;

            const payload = parsePayload(event.dataTransfer);
            if (!payload) return;

            const pos = resolveCanvasPos(event);
            if (!pos) return;

            const [cx, cy] = pos;
            // 落在已有节点上 -> 放行，保留「拖到节点预览面板载入」行为。
            if (!isOverBlankCanvas(cx, cy)) return;

            // 已 prevent 仅在确认要接管时执行，避免误吞官方逻辑。
            event.preventDefault();
            try {
                event.stopImmediatePropagation();
            } catch {
                // 忽略。
            }

            // 多选媒体 → 一个列表节点；LoRA 多选 → 一个 XLoraGet 多行；
            // 其余走单节点创建。
            const isMultiMedia = payload.items.length > 1
                && ["image", "video", "audio"].includes(
                    payload.media_type
                );
            const node = isMultiMedia
                ? createMediaListNode(payload, cx, cy)
                : createAndLoadNode(payload, cx, cy);
            if (!node) {
                // 建节点失败：已 prevent，但仍 console.warn 便于排查。
                console.warn(
                    `[XDataHub CanvasDrop] createNode returned null for media_type=${payload.media_type}`
                );
            }
        },
        true,
    );
}

app.registerExtension({
    name: EXT_NAME,
    async setup() {
        if (ROOT[EXT_GUARD_KEY]) return;
        ROOT[EXT_GUARD_KEY] = true;
        installDropHandler();
        refreshCanvasDropEnabled();
        // XDataHub 设置面板在 iframe 内，保存开关后会 postMessage
        // 到宿主窗口；此处监听以即时同步缓存，免改设置后须刷新。
        window.addEventListener("message", (event) => {
            if (event.origin !== window.location.origin) return;
            const payload = event?.data;
            if (!payload
                || payload.type !== "xdatahub:host-settings-updated") {
                return;
            }
            const settings = payload.settings;
            if (settings
                && Object.prototype.hasOwnProperty.call(
                    settings, SETTING_FIELD)) {
                _canvasDropEnabled =
                    settings[SETTING_FIELD] === true;
            }
        });
    },
});