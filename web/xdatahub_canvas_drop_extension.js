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
 * - LoRA 在首期不响应（不建 XLoraGet）。
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
const SETTINGS_ENDPOINT = "/xz3r0/xdatahub/settings";
const SETTING_FIELD = "canvas_drop_enabled";
const SETTING_DEFAULT = true;

// 模块级缓存：drop 事件同步处理，不能在事件回调里 await fetch。
let _canvasDropEnabled = SETTING_DEFAULT;

// media_type -> node class. LoRA 首期不在范围内。
const TYPE_TO_CLASS = {
    image: "XImageGet",
    video: "XVideoGet",
    audio: "XAudioGet",
    text: "XStringGet",
};

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
    const textValue = String(payload.text_value || "");
    // text 用 text_value 作为内容载体，其余用 media_ref。
    if (mediaType === "text") {
        if (!textValue.trim()) return null;
    } else if (!mediaRef) {
        return null;
    }
    return {
        media_ref: mediaRef,
        media_type: mediaType,
        text_value: textValue,
        title: String(payload.title || ""),
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

function isOverBlankCanvas(cx, cy) {
    const graph = app?.canvas?.graph || app?.graph;
    if (!graph) return false;
    if (typeof graph.getNodeOnPos !== "function") return false;
    const hit = graph.getNodeOnPos(cx, cy);
    return !hit;
}

function createAndLoadNode(payload, cx, cy) {
    const className = TYPE_TO_CLASS[payload.media_type];
    if (!className) return null;
    const cfg = NODE_CONFIG[className];
    if (!cfg) return null;
    const graph = app?.graph;
    if (!graph || typeof graph.add !== "function") return null;
    if (typeof LiteGraph === "undefined" || !LiteGraph?.createNode) {
        return null;
    }

    // 落点居中：用默认节点尺寸 260×320，此时 node 尚未创建，
    // 不能读 node.size。
    const pos = [cx - 130, cy - 160];

    // 预置 properties：通过 createNode 第三参数 options.properties 注入，
    // LiteGraph 内部 Object.assign(node, options) 发生在 onNodeCreated
    // 之前，使各扩展 onNodeCreated 内 installNodeUi + restoreStoredData
    // 能在读值点读到并 setPreview 渲染预览。
    const seedProperties = {};
    seedProperties[cfg.valueProperty] =
        cfg.isText ? payload.text_value : payload.media_ref;
    if (cfg.titleProperty && payload.title) {
        seedProperties[cfg.titleProperty] = payload.title;
    }

    let node = null;
    try {
        node = LiteGraph.createNode(className, undefined, {
            pos,
            properties: seedProperties,
        });
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
    if (cfg.isText) {
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

            // LoRA 首期不响应。
            if (payload.media_type === "lora") return;

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

            const node = createAndLoadNode(payload, cx, cy);
            if (!node) {
                // 建节点失败：已 prevent，但仍 console.warn 便于排查。
                console.warn(
                    `[XDataHub CanvasDrop] createAndLoadNode returned null for media_type=${payload.media_type}`
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