/**
 * XMediaListGet 画布面板扩展
 * ==========================
 *
 * 在节点内提供按「图片 / 视频 / 音频」分类管理的媒体列表：
 * - 分类切换、启用开关、删除、清空、刷新
 * - 缩略图懒加载，加载失败自动标红（文件失效）
 * - 从 XDataHub 拖入媒体卡片（插入 / 替换由后续拖拽逻辑处理）
 * - 列表内拖拽排序、分组（同组连续 = 加载顺序）
 * - 转发中键平移与滚轮缩放，保持画布基础交互
 *
 * 列表数据保存在隐藏 widget media_items 中，格式：
 * {
 *   "image": [{ref,title,enabled,group}],
 *   "video": [], "audio": [],
 *   "groups": { "image": [{id,name,collapsed}], "video": [], "audio": [] }
 * }
 *
 * 分页已经退场：分组要求「同组的行连续」，一个组被切到两页就
 * 说不清组头归谁，跨页也拖不动。现在是一条长列表全量渲染。
 */

import { app } from "../../scripts/app.js";
import {
    getHexAccentFromModuloId as getNodeAccentColor,
    getModuloAccentIndex as getNodeAccentIndex,
} from "./core/node-accent.js";
import {
    applyHiddenWidgetLayers,
    removeWidgetInput,
} from "./core/hidden-widget.js";
import {
    buildAudioPlayer,
    buildVideoPlayer,
} from "./core/media-player.js";
import {
    buildRenderList,
    createGroupFromSelection,
    deleteGroup,
    groupMembers,
    groupOfGap,
    groupSeqOf,
    nextGroupSeq,
    moveGroupToGap,
    moveRowToGap,
    normalizeGroups,
    renameGroup,
    setCollapsed,
} from "./core/group-model.js";
import { openXMaskEditor } from "./x-mask-editor/index.js?v=20261023-14";

const EXT_NAME = "xz3r0.xmedialistget";
const EXT_GUARD_KEY = "__xmedialistget_extension_registered__";
const ROOT = globalThis;
const NODE_CLASS = "XMediaListGet";
const STORAGE_WIDGET = "media_items";
const MEDIA_ITEMS_PROP = "__xdatahub_media_items";
const MEDIA_TYPE_PROP = "__xdatahub_media_type";
const MEDIA_TYPE_WIDGET = "media_type";
const TYPE_WARNING_WIDGET = "type_warning";
const OUTPUT_WIDGETS = {
    image: "output_images",
    video: "output_videos",
    audio: "output_audios",
};
// 某一类只要任一相关输出端口有连线，就加载该类。
// 0 images / 1 masks / 2 image_count
// 3 videos / 4 video_count
// 5 audios / 6 audio_count
const OUTPUT_SLOT_GROUPS = {
    image: [0, 1, 2],
    video: [3, 4],
    audio: [5, 6],
};
/* 旧版「每页条数」的设置名。分页已经退场，这里只保留名字：
   老节点的属性仍然读得到，不用做数据迁移。 */
const PAGE_SIZE_PROP = "xmedialistget.pageSize";
const CATEGORIES = ["image", "video", "audio"];
/*
 * 行的唯一标识。
 *
 * 同一个文件允许在列表里出现多次（用户可能就是想让它多跑一遍），
 * 所以 ref 不再是身份——拿 ref 当身份的话，点一下就会把所有重复的
 * 行一起选中，建组也会把副本一起拽走。每行发一个 uid，跟着行走，
 * 复制行、拖动、重排都不变。
 */
let rowUidSeed = 0;
function newRowUid() {
    rowUidSeed += 1;
    return `r${rowUidSeed.toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

const XMLG_KEY_OF = (entry) => {
    if (!entry || typeof entry !== "object") {
        return "";
    }
    if (!entry.uid) {
        // 兜底：老数据、或别处漏掉的行，第一次被认出来时补一个
        entry.uid = newRowUid();
    }
    return String(entry.uid);
};
const CATEGORY_EMOJI = {
    image: "🖼️",
    video: "🎞️",
    audio: "🎵",
};
const MAX_ENABLED = 50;
// ✔ ✖ ⇄ 三个按钮的「作用范围」：files = 只动还没分组的，all = 全都动，
// groups = 只动组里的。再加上「单击组头 → 只作用于这一组」的临时收窄。
const ENABLE_SCOPES = ["files", "all", "groups"];
// 单击组头换范围：等这么久还等不到第二下，才当成「单击」。
// 不然双击改名会顺手把范围切走（改个名字，工具栏跟着跳）。
const HEAD_TAP_DELAY_MS = 220;
const XDATAHUB_MEDIA_MIME = "application/x-xdatahub-media+json";
const STYLE_ID = "xmedialistget-extension-style";
const MIN_NODE_WIDTH = 500;
const MIN_NODE_HEIGHT = 700;
const THUMB_SIZE = 96;
/* 和 XDataHub 卡片一样的「眼睛」预览图标。图标文件相对本模块解析，
   避免在主页面里把 icons/... 解析到站点根目录。 */
const PREVIEW_EYE_ICON_URL = new URL(
    "./icons/eye.svg",
    import.meta.url
).href;
/* 组头的折叠箭头。原来的 ▾ 是 10px 字号里的一个字符，字高只有 5px
   左右，画布一缩小就糊成一团；换成一条粗一点的折线图标，缩到 0.8 倍
   仍然清楚，折叠时就地转 90 度。 */
const GROUP_ARROW_ICON_URL = new URL(
    "./icons/chevron-down.svg",
    import.meta.url
).href;
const REFRESH_CONCURRENCY = 4;
/* 列表内拖动「让位」的滑动时长。Chromium 的标签条用 200ms，我们的
   行比标签矮，160ms 更跟手；也是「其它行滑开」这个效果的全部时长。 */
const SLIDE_MS = 160;
/* 重排防抖：指针相对上次改顺序的位置要移动够这么远才允许再改。
   Chromium 用 16dip（按标签宽度缩放），我们按行高缩放。 */
const REORDER_THRESHOLD_RATIO = 0.35;
const GROUP_DRAG_THRESHOLD_RATIO = 0.75;
/* 按下后移动多少像素才算「拖」：小于它还是单击（点开关、点缩略图）。 */
const DRAG_START_PX = 4;
/* 跨组归属的「中性带」：以缝隙两侧邻居的边界为中心，左右各留行高的
   四分之一（Chromium 用的就是标签宽度的 1/4）。落在这段里 = 不属于
   任何组；越过去才算加入某一组。 */
const GROUP_LEAN_RATIO = 0.25;
/* 组的可选颜色。刻意不用红色系（色板里的 02 红、07 橙）：它们跟品牌粉
   太接近，画在竖线和胶囊上会被误当成强调色或警告色。
   色号存进组记录（color 字段），没存过色号的老组按 id 哈希挑一个，
   所以老数据不需要迁移（包括以前存过 "02" 的组，会自动换到别的颜色）。 */
const GROUP_COLORS = [
    {
        id: "01",
        nameKey: "group_color_blue",
        fallback: "Blue",
        value: "var(--db-palette-01, #0066FF)",
    },
    {
        id: "11",
        nameKey: "group_color_azure",
        fallback: "Azure",
        value: "color-mix(in srgb, var(--db-palette-01, #0066FF) 55%, "
            + "var(--db-palette-06, #00CCCC))",
    },
    {
        id: "06",
        nameKey: "group_color_cyan",
        fallback: "Cyan",
        value: "var(--db-palette-06, #00CCCC)",
    },
    {
        id: "03",
        nameKey: "group_color_green",
        fallback: "Green",
        value: "var(--db-palette-03, #00A86B)",
    },
    {
        id: "12",
        nameKey: "group_color_lime",
        fallback: "Lime",
        value: "color-mix(in srgb, var(--db-palette-03, #00A86B) 55%, "
            + "var(--db-palette-04, #FFBF00))",
    },
    {
        id: "04",
        nameKey: "group_color_yellow",
        fallback: "Yellow",
        value: "var(--db-palette-04, #FFBF00)",
    },
    {
        id: "05",
        nameKey: "group_color_purple",
        fallback: "Purple",
        value: "var(--db-palette-05, #CC00CC)",
    },
];
const COMFY_LOCALE_KEY = "Comfy.Locale";
const TOAST_DURATION_MS = 2600;
const INSERT_EDGE_PX = 8;
/* 列表内部拖拽排序用的标记：带上它就能和「从 XDataHub 拖入」区分开。 */
/* 拖到列表上下边缘多少像素内开始自动滚动，以及每次滚多少。 */
const DROP_AUTOSCROLL_EDGE = 28;
const DROP_AUTOSCROLL_STEP = 10;
const TYPE_SWITCH_DELAY_MS = 600;
const XDATAHUB_TYPE_MIME_PREFIX = "application/x-xdatahub-type-";
const XDATAHUB_COUNT_MIME_PREFIX = "application/x-xdatahub-count-";

let uiLocalePrimary = {};
let uiLocaleFallback = {};
let currentUiLocale = "en";
let localeSyncInstalled = false;
const uiLocaleCache = new Map();

function normalizeLocaleCode(value) {
    const text = String(value || "")
        .trim()
        .replace(/_/g, "-")
        .toLowerCase();
    if (!text) {
        return "";
    }
    return text === "zh" || text.startsWith("zh-") ? "zh" : "en";
}

function resolveComfyLocale() {
    const locale = app.extensionManager?.setting?.get?.(COMFY_LOCALE_KEY)
        || localStorage.getItem(COMFY_LOCALE_KEY)
        || document.documentElement?.lang
        || navigator.language
        || "en";
    return normalizeLocaleCode(locale) || "en";
}

function formatText(template, vars) {
    let text = String(template || "");
    if (!vars || typeof vars !== "object") {
        return text;
    }
    for (const [key, value] of Object.entries(vars)) {
        text = text.split(`{${key}}`).join(String(value ?? ""));
    }
    return text;
}

function t(key, fallback = "", vars = null) {
    const template = uiLocalePrimary?.[key]
        ?? uiLocaleFallback?.[key]
        ?? fallback
        ?? key;
    return formatText(template, vars);
}

async function fetchLocaleJson(localeCode) {
    const normalizedCode = normalizeLocaleCode(localeCode) || "en";
    if (uiLocaleCache.has(normalizedCode)) {
        return uiLocaleCache.get(normalizedCode);
    }
    let dict = {};
    try {
        const response = await fetch(
            `/xz3r0/xdatahub/i18n/ui?locale=${encodeURIComponent(normalizedCode)}`,
            { cache: "no-cache" }
        );
        if (response.ok) {
            const payload = await response.json();
            dict = payload?.dict && typeof payload.dict === "object"
                ? payload.dict
                : {};
        }
    } catch {
        dict = {};
    }
    uiLocaleCache.set(normalizedCode, dict);
    return dict;
}

async function loadUiLocaleBundle(localeOverride = null) {
    const locale = normalizeLocaleCode(localeOverride || resolveComfyLocale())
        || "en";
    uiLocaleFallback = await fetchLocaleJson("en");
    uiLocalePrimary = locale === "en"
        ? uiLocaleFallback
        : await fetchLocaleJson(locale);
    currentUiLocale = locale;
}

async function applyUiLocale(localeOverride = null) {
    await loadUiLocaleBundle(localeOverride);
    refreshAllPanels();
}

function installLocaleSync() {
    if (localeSyncInstalled) {
        return;
    }
    localeSyncInstalled = true;
    const refresh = () => {
        applyUiLocale().catch(() => {});
    };
    try {
        const setting = app.extensionManager?.setting;
        if (
            setting
            && typeof setting.set === "function"
            && setting.__xmedialistgetLocaleHookInstalled !== true
        ) {
            const originalSet = setting.set.bind(setting);
            setting.set = (...args) => {
                const result = originalSet(...args);
                if (String(args[0] || "") === COMFY_LOCALE_KEY) {
                    Promise.resolve(result).finally(refresh);
                }
                return result;
            };
            setting.__xmedialistgetLocaleHookInstalled = true;
        }
    } catch {
        // 忽略设置钩子失败
    }
    ROOT.addEventListener("storage", (event) => {
        if (!event.key || event.key === COMFY_LOCALE_KEY) {
            refresh();
        }
    });
    ROOT.addEventListener("focus", refresh);
    ROOT.addEventListener("pageshow", refresh);
    document.addEventListener("visibilitychange", () => {
        if (!document.hidden) {
            refresh();
        }
    });
}

function categoryLabel(category) {
    const key = `xdatahub.ui.node.xmedialistget.category_${category}`;
    const fallback = {
        image: "Images",
        video: "Videos",
        audio: "Audio",
    }[category] || category;
    return t(key, fallback);
}

function emptyGroups() {
    return { image: [], video: [], audio: [] };
}

function emptyItems() {
    return {
        image: [],
        video: [],
        audio: [],
        groups: emptyGroups(),
    };
}

function normalizeItems(raw) {
    const output = emptyItems();
    if (!raw || typeof raw !== "object") {
        return output;
    }
    const rawGroups = raw.groups && typeof raw.groups === "object"
        ? raw.groups
        : {};
    for (const category of CATEGORIES) {
        const list = Array.isArray(raw[category]) ? raw[category] : [];
        const rows = [];
        for (const entry of list) {
            if (!entry || typeof entry !== "object") {
                continue;
            }
            const ref = String(entry.ref || "").trim();
            if (!ref) {
                continue;
            }
            rows.push({
                uid: String(entry.uid || "").trim() || newRowUid(),
                ref,
                title: String(entry.title || ""),
                enabled: entry.enabled !== false,
                group: typeof entry.group === "string"
                    ? entry.group.trim() || null
                    : null,
                mask_ref: String(entry.mask_ref || ""),
                paint_ref: String(entry.paint_ref || ""),
                transform_state: String(entry.transform_state || ""),
            });
        }
        // 旧数据完全没有 group 字段，这里必须安静地接受并把
        // 「同组连续」「不留空组」两条不变量一次落地。
        const normalized = normalizeGroups(rows, rawGroups[category]);
        output[category] = normalized.items;
        output.groups[category] = normalized.groups;
    }
    return output;
}

function findWidget(node, name) {
    return node?.widgets?.find?.((widget) => widget?.name === name) || null;
}

function ensureStorageWidget(node) {
    let widget = findWidget(node, STORAGE_WIDGET);
    if (!widget && typeof node.addWidget === "function") {
        widget = node.addWidget("text", STORAGE_WIDGET, "{}", () => {});
    }
    applyHiddenWidgetLayers(widget);
    if (widget) {
        widget.serializeValue = () => widget.value;
    }
    removeWidgetInput(node, STORAGE_WIDGET);
    return widget || null;
}

function readItems(node) {
    const widget = ensureStorageWidget(node);
    const rawWidget = String(widget?.value || "").trim();
    const seed = String(
        node?.properties?.[MEDIA_ITEMS_PROP] || ""
    ).trim();
    const raw = rawWidget && rawWidget !== "{}" ? rawWidget : seed;
    if (!raw) {
        return emptyItems();
    }
    let items = emptyItems();
    try {
        items = normalizeItems(JSON.parse(raw));
    } catch {
        items = emptyItems();
    }
    if (seed && (!rawWidget || rawWidget === "{}") && widget) {
        // 子图 / 加载过程中 V3 widget 可能被重建，先写入 widget；
        // 种子属性保留到延迟应用成功后再清理。
        widget.value = JSON.stringify(items);
    }
    return items;
}

/*
 * 组的两条不变量（同组连续、不留空组）只在一个地方落地：
 * 每次写入前统一整理。任何新增的「改列表」路径只要走 writeItems
 * 就不会留下幽灵组，也不会出现同组被拆开。
 */
function syncCategoryGroups(items, category) {
    if (!items.groups || typeof items.groups !== "object") {
        items.groups = emptyGroups();
    }
    const result = normalizeGroups(
        items[category] || [],
        items.groups[category]
    );
    items[category] = result.items;
    items.groups[category] = result.groups;
    return result;
}

function syncAllGroups(items) {
    const dissolved = [];
    for (const category of CATEGORIES) {
        dissolved.push(...syncCategoryGroups(items, category).dissolved);
    }
    return dissolved;
}

function writeItems(node, items, options = {}) {
    const widget = ensureStorageWidget(node);
    if (!widget) {
        return;
    }
    // 模型里的操作（移动 / 建组）会当场把空组剔掉，所以它会把
    // 「刚刚被解散的组」一并交出来；这里只负责提示，不重复整理。
    const dissolved = [
        ...(Array.isArray(options.dissolved) ? options.dissolved : []),
        ...syncAllGroups(items),
    ];
    // 组一声不响地消失，会让人以为文件也丢了。必须明确提示。
    if (dissolved.length && options.recordUndo !== false) {
        const names = [];
        for (const record of dissolved) {
            const label = record.name || record.id;
            if (label && !names.includes(label)) {
                names.push(label);
            }
        }
        showToast(
            node,
            t(
                "xdatahub.ui.node.xmedialistget.group_dissolved",
                "Group {name} has no files left, so it was removed",
                { name: names.join(", ") }
            )
        );
    }
    if (options.recordUndo !== false) {
        pushUndoSnapshot(node);
        const panel = node.__xmlg_panel;
        if (panel) {
            // 新修改会岔开历史，之前的重做分支作废。
            panel.state.redoStack = [];
        }
    }
    widget.value = JSON.stringify(items);
    node.setDirtyCanvas?.(true, true);
    node.graph?.change?.();
    updateUndoButton(node);
}

function pushUndoSnapshot(node) {
    const panel = node?.__xmlg_panel;
    if (!panel) {
        return;
    }
    const widget = ensureStorageWidget(node);
    const value = String(widget?.value || "{}");
    const stack = panel.state.undoStack || [];
    if (stack[stack.length - 1] === value) {
        return;
    }
    stack.push(value);
    if (stack.length > 30) {
        stack.shift();
    }
    panel.state.undoStack = stack;
}

function updateUndoButton(node) {
    const panel = node?.__xmlg_panel;
    if (!panel) {
        return;
    }
    const undoStack = panel.state.undoStack || [];
    const redoStack = panel.state.redoStack || [];
    if (panel.undoButton) {
        panel.undoButton.disabled = undoStack.length === 0;
    }
    if (panel.redoButton) {
        panel.redoButton.disabled = redoStack.length === 0;
    }
}

function applySnapshot(node, raw) {
    const panel = node?.__xmlg_panel;
    if (!panel) {
        return;
    }
    let items = emptyItems();
    try {
        items = normalizeItems(JSON.parse(raw));
    } catch {
        items = emptyItems();
    }
    panel.state.items = items;
    panel.state.missing = new Set();
    writeItems(node, items, { recordUndo: false });
    renderPanel(node);
    syncOutputPortType(node);
}

function undoLastChange(node) {
    const panel = node?.__xmlg_panel;
    const stack = panel?.state?.undoStack || [];
    if (!stack.length) {
        return;
    }
    const current = String(ensureStorageWidget(node)?.value || "{}");
    const raw = stack.pop();
    panel.state.redoStack = [
        ...(panel.state.redoStack || []),
        current,
    ];
    applySnapshot(node, raw);
}

function redoLastChange(node) {
    const panel = node?.__xmlg_panel;
    const stack = panel?.state?.redoStack || [];
    if (!stack.length) {
        return;
    }
    const current = String(ensureStorageWidget(node)?.value || "{}");
    const raw = stack.pop();
    panel.state.undoStack = [
        ...(panel.state.undoStack || []),
        current,
    ];
    applySnapshot(node, raw);
}

function readCategory(node) {
    const widget = findWidget(node, MEDIA_TYPE_WIDGET);
    const widgetValue = String(widget?.value || "")
        .trim()
        .toLowerCase();
    const seed = String(
        node?.properties?.[MEDIA_TYPE_PROP] || ""
    ).trim().toLowerCase();
    if (
        seed
        && CATEGORIES.includes(seed)
        && (!widgetValue || widgetValue === "image")
    ) {
        if (widget) {
            widget.value = seed;
        }
        return seed;
    }
    const value = widgetValue || "image";
    return CATEGORIES.includes(value) ? value : "image";
}

function enabledCount(items, category) {
    return (items[category] || []).filter(
        (entry) => entry.enabled !== false
    ).length;
}

function hasAnyItems(items) {
    return CATEGORIES.some(
        (category) => (items[category] || []).length > 0
    );
}

function applyPendingSeed(node) {
    const panel = node?.__xmlg_panel;
    if (!panel) {
        return;
    }
    const seed = String(
        node.__xmlg_pending_items
        || node?.properties?.[MEDIA_ITEMS_PROP]
        || ""
    ).trim();
    const seedType = String(
        node.__xmlg_pending_type
        || node?.properties?.[MEDIA_TYPE_PROP]
        || ""
    ).trim().toLowerCase();
    if (seed && !hasAnyItems(panel.state.items)) {
        try {
            const items = normalizeItems(JSON.parse(seed));
            if (hasAnyItems(items)) {
                panel.state.items = items;
                if (CATEGORIES.includes(seedType)) {
                    panel.state.category = seedType;
                    const widget = findWidget(node, MEDIA_TYPE_WIDGET);
                    if (widget) {
                        widget.value = seedType;
                    }
                }
                const storage = ensureStorageWidget(node);
                if (storage) {
                    storage.value = JSON.stringify(items);
                }
                renderPanel(node);
            }
        } catch {
            // 忽略非法种子数据
        }
    }
    delete node.__xmlg_pending_items;
    delete node.__xmlg_pending_type;
    if (node.properties && typeof node.properties === "object") {
        delete node.properties[MEDIA_ITEMS_PROP];
        delete node.properties[MEDIA_TYPE_PROP];
    }
}

function scheduleSeedApply(node) {
    if (
        !node?.__xmlg_pending_items
        && !node?.properties?.[MEDIA_ITEMS_PROP]
    ) {
        return;
    }
    for (const delay of [60, 180, 400]) {
        window.setTimeout(() => applyPendingSeed(node), delay);
    }
}

function ensureNodeMinSize(node) {
    if (!node) {
        return;
    }
    const minWidth = MIN_NODE_WIDTH;
    const minHeight = MIN_NODE_HEIGHT;
    if (!node.min_size || node.min_size.length < 2) {
        node.min_size = [minWidth, minHeight];
    } else {
        node.min_size[0] = Math.max(node.min_size[0], minWidth);
        node.min_size[1] = Math.max(node.min_size[1], minHeight);
    }
    if (typeof node.setSize === "function") {
        const width = Math.max(Number(node.size?.[0]) || 0, minWidth);
        const height = Math.max(Number(node.size?.[1]) || 0, minHeight);
        node.setSize([width, height]);
    }
    // LiteGraph 在拖拽 resize 时不一定遵守 min_size，需要在 onResize
    // 里重新设置并 clamp（与 XLoraGet / XImageGet 的做法一致）。
    if (node.__xmlg_resize_guard) {
        return;
    }
    node.__xmlg_resize_guard = true;
    const originalOnResize = node.onResize;
    node.onResize = function (size) {
        this.min_size = [minWidth, minHeight];
        const sourceSize = Array.isArray(size) ? size : this.size;
        const nextWidth = Math.max(sourceSize?.[0] ?? 0, minWidth);
        const nextHeight = Math.max(sourceSize?.[1] ?? 0, minHeight);
        if (!Array.isArray(this.size) || this.size.length < 2) {
            this.size = [nextWidth, nextHeight];
        } else {
            this.size[0] = nextWidth;
            this.size[1] = nextHeight;
        }
        this.setDirtyCanvas?.(true, true);
        if (typeof originalOnResize === "function") {
            originalOnResize.apply(this, arguments);
        }
    };
}

function ensureStyles() {
    if (document.getElementById(STYLE_ID)) {
        return;
    }
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
        .xmlg-panel,
        /* 拖动时跟手的卡片挂在 body 上（见 spawnGhost），
           颜色变量要在这里再给一份 */
        .xmlg-drag-ghost,
        .xmlg-preview {
            /* 颜色收口：优先 XDataHub token（由 web/xdatahub.js 注入宿主页），
               缺失时回退到品牌色/中性色。面板和全屏预览共用这套变量。 */
            --xmlg-accent: var(--xdh-clr-primary, #ff385c);
            --xmlg-accent-muted: color-mix(
                in srgb,
                var(--xmlg-accent) 14%,
                transparent
            );
            --xmlg-text: var(--xdh-clr-ink, #ffffff);
            --xmlg-text-muted: var(--xdh-clr-muted, rgba(255, 255, 255, 0.6));
            --xmlg-border: var(--xdh-clr-hairline, rgba(255, 255, 255, 0.12));
            --xmlg-surface: var(--xdh-clr-surface-soft, #161618);
            --xmlg-surface-strong: var(--xdh-clr-surface-strong, #1d1d20);
            --xmlg-canvas: var(--xdh-clr-canvas, #0c0c0e);
            --xmlg-on-accent: var(--xdh-clr-on-primary, #ffffff);
            --xmlg-danger: var(--xdh-clr-error, #c13515);
            --xmlg-danger-bright: #ff0000;
            --xmlg-danger-text: color-mix(in srgb, var(--xmlg-danger) 55%, white);
            --xmlg-danger-soft: color-mix(in srgb, var(--xmlg-danger) 12%, transparent);
            --xmlg-success: #22c55e;
            --xmlg-success-text: #4ade80;
            --xmlg-success-glow: color-mix(in srgb, var(--xmlg-success) 65%, transparent);
            --xmlg-success-glow-fade: color-mix(in srgb, var(--xmlg-success) 0%, transparent);
            --xmlg-warning: #f59e0b;
            --xmlg-warning-strong: #fbbf24;
            /* 提示条：浅色主题用深琥珀字 + 米色底，深色主题反过来，
               两边都是 6:1 以上的对比，避免「黄字压浅灰」看不清。 */
            --xmlg-warning-text: color-mix(
                in srgb,
                var(--xmlg-warning) 38%,
                var(--xmlg-text)
            );
            --xmlg-warning-surface: color-mix(
                in srgb,
                var(--xmlg-warning) 16%,
                var(--xmlg-surface)
            );
            --xmlg-warning-soft: color-mix(in srgb, var(--xmlg-warning) 12%, transparent);
            --xmlg-warning-ink: var(--xdh-clr-canvas, #0c0c0e);
            --xmlg-switch-off: var(--xdh-clr-border-strong, rgba(255, 255, 255, 0.22));
            --xmlg-scrim: color-mix(in srgb, var(--xmlg-canvas) 72%, transparent);
            --xmlg-toast-bg: var(--xdh-clr-surface-strong, #1d1d20);
            --xmlg-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
            --xmlg-thumb-bg: var(--xdh-clr-canvas, #0c0c0e);
            --xmlg-scroll-thumb: var(--xdh-scrollbar-thumb, #555);
            --xmlg-scroll-track: var(--xdh-scrollbar-track, transparent);
        }
        .xmlg-panel {
            position: relative;
            display: flex;
            flex-direction: column;
            gap: 6px;
            width: 100%;
            height: 100%;
            min-height: 0;
            box-sizing: border-box;
            overflow: hidden;
            padding: 8px;
            color: var(--xmlg-text);
            font-size: 12px;
        }
        .xmlg-tabs {
            display: flex;
            gap: 4px;
        }
        .xmlg-tab {
            flex: 1 1 0;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 5px;
            padding: 5px 6px;
            border-radius: var(--xdh-radius-sm, 6px);
            border: 1px solid var(--xmlg-border);
            background: var(--xmlg-surface-strong);
            color: inherit;
            font: inherit;
            cursor: pointer;
            position: relative;
            overflow: hidden;
        }
        .xmlg-tab:hover {
            border-color: var(--xmlg-accent);
        }
        .xmlg-tab.is-active {
            border-color: var(--xmlg-accent);
            box-shadow: inset 0 0 0 1px var(--xmlg-accent);
        }
        .xmlg-tab.is-target {
            animation: xmlg-tab-pulse 1s ease-in-out infinite;
            border-color: var(--xmlg-success);
            color: var(--xmlg-success-text);
        }
        .xmlg-tab.is-dimmed {
            opacity: 0.45;
        }
        @keyframes xmlg-tab-pulse {
            0%, 100% {
                box-shadow: 0 0 0 0 var(--xmlg-success-glow);
            }
            50% {
                box-shadow: 0 0 0 4px var(--xmlg-success-glow-fade);
            }
        }
        .xmlg-tab-progress {
            position: absolute;
            left: 0;
            bottom: 0;
            height: 2px;
            width: 0%;
            background: var(--xmlg-success);
            pointer-events: none;
        }
        .xmlg-tab.is-target.is-switching .xmlg-tab-progress {
            width: 100%;
            transition: width 600ms linear;
        }
        .xmlg-tab-count {
            font-size: 10px;
            opacity: 0.75;
        }
        .xmlg-toolbar {
            display: flex;
            align-items: center;
            gap: 6px;
            flex-wrap: wrap;
            justify-content: space-between;
        }
        .xmlg-toolbar-left {
            display: inline-flex;
            align-items: center;
            gap: 6px;
        }
        .xmlg-toolbar-right {
            display: inline-flex;
            align-items: center;
            gap: 6px;
        }
        .xmlg-output-toggles {
            display: inline-flex;
            align-items: center;
            gap: 6px;
        }
        .xmlg-output-toggle {
            gap: 4px;
        }
        .xmlg-toggle-emoji {
            font-size: 13px;
            line-height: 1;
        }
        .xmlg-tab.is-output-off {
            opacity: 0.4;
        }
        .xmlg-toolbar-divider {
            width: 1px;
            height: 16px;
            flex: 0 0 auto;
            background: var(--xmlg-border);
        }
        .xmlg-toggle {
            display: inline-flex;
            align-items: center;
            gap: 7px;
            font-size: 11px;
            color: var(--xmlg-text);
            user-select: none;
            white-space: nowrap;
            cursor: pointer;
        }
        .xmlg-list-shell {
            display: flex;
            flex-direction: column;
            flex: 1 1 0;
            min-height: 0;
            border: 1px solid var(--xmlg-border);
            border-radius: var(--xdh-radius-sm, 8px);
            background: var(--xmlg-surface-strong);
            overflow: hidden;
        }
        .xmlg-meta {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 8px;
            min-height: 22px;
        }
        .xmlg-node-badge {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            padding: 4px 12px;
            border-radius: var(--xdh-radius-full, 999px);
            border: 1px solid var(--xmlg-accent);
            background: var(--xmlg-surface-strong);
        }
        .xmlg-node-badge-swatch {
            width: 18px;
            height: 18px;
            border-radius: var(--xdh-radius-xs, 4px);
            background: var(--xmlg-accent);
            box-shadow: inset 0 0 0 1px var(--xmlg-border);
        }
        .xmlg-node-badge-chip {
            font-size: 16px;
            line-height: 1;
            font-weight: 700;
            font-variant-numeric: tabular-nums;
            font-family: ui-monospace, "Cascadia Mono", "Consolas", monospace;
            letter-spacing: 0.15px;
            color: var(--xmlg-accent);
        }
        .xmlg-kind-emoji {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 20px;
            height: 20px;
            font-size: 20px;
            line-height: 1;
            filter: saturate(1.1);
            user-select: none;
            pointer-events: none;
            flex: 0 0 auto;
        }
        .xmlg-list-toolbar {
            position: relative;
            display: flex;
            align-items: center;
            /* 靠左挤紧：换行时各行也从头排，不会像 space-between 那样
               被拉得东一个西一个。状态文字自己用 margin-left:auto 顶右边 */
            justify-content: flex-start;
            gap: 6px;
            /* 窄面板放不下一整排（刷新 + 建组 + 三个开关 + 范围胶囊 + 状态）
               时换行，宁可多占一行也别把按钮裁掉一半 */
            flex-wrap: wrap;
            row-gap: 4px;
            min-height: 30px;
            padding: 4px 10px;
            border: none;
            border-bottom: 1px solid var(--xmlg-border);
            border-radius: var(--xdh-radius-sm, 8px) var(--xdh-radius-sm, 8px) 0 0;
            background: var(--xmlg-surface);
            box-sizing: border-box;
        }
        /* ✔ ✖ ⇄ 打哪里：一枚胶囊里分三档，当前那档是实心圆点 */
        .xmlg-scope {
            display: inline-flex;
            align-items: center;
            gap: 2px;
            flex: 0 0 auto;
            padding: 2px;
            border: 1px solid var(--xmlg-border);
            border-radius: 999px;
            background: var(--xmlg-surface-strong);
        }
        .xmlg-scope-btn {
            flex: 0 0 auto;
            padding: 2px 8px;
            border: none;
            border-radius: 999px;
            background: transparent;
            color: var(--xmlg-text);
            font: inherit;
            font-size: 10px;
            line-height: 1.5;
            white-space: nowrap;
            cursor: pointer;
            opacity: 0.62;
            /* 合并 / 拆开时圆角要跟着动，别一下子跳变形 */
            transition: background 120ms, opacity 120ms,
                border-radius 120ms ease-out;
        }
        .xmlg-scope-btn:hover {
            opacity: 0.9;
        }
        .xmlg-scope-btn.is-active {
            opacity: 1;
            background: color-mix(
                in srgb,
                var(--xmlg-accent) 26%,
                transparent
            );
            box-shadow: inset 0 0 0 1px color-mix(
                in srgb,
                var(--xmlg-accent) 45%,
                transparent
            );
        }
        /* 这一档里一个文件都没有：切过去也没东西可动，先淡下去 */
        .xmlg-scope-btn.is-empty {
            opacity: 0.32;
        }
        /* 单击组头 = 让 ✔ ✖ ⇄ 只作用于这一组，这里显示是哪一组。
           它和「分组」拼成**同一个胶囊**的两半：中间不留缝、外圈只有一根
           边框，实心底色的「分组」在左边收圆、右边接平，组号在右边续上，
           看起来就是 (分组｜组 2)。 */
        .xmlg-scope-chip {
            /* 常驻 DOM、收成 0 宽：靠 grid 列宽 0fr → 1fr 平滑长出来，
               而不是 display:none 一下蹦出来（那没法做动画） */
            display: inline-grid;
            /* 必须写 minmax(0, …)：光写 0fr 会被内容的「最小宽度」兜住，
               收起时还留着内边距那 13px，收不干净 */
            grid-template-columns: minmax(0, 0fr);
            align-items: center;
            flex: 0 0 auto;
            margin-left: 0;
            padding: 0;
            border: none;
            opacity: 0;
            overflow: hidden;
            pointer-events: none;
            transition:
                grid-template-columns 200ms cubic-bezier(0.22, 0.61, 0.36, 1),
                opacity 160ms ease;
            border-radius: 0 999px 999px 0;
            /* 内容宽度交给内部撑开，超长时自己收省略号 */
            max-width: 110px;
            /* 描边用**这一组自己的颜色**，不用品牌粉：这半段的底子是组色，
               套一圈粉边会互相染色、看着像另一种颜色。组色描边和底色同源，
               在接缝处正好和左边的粉边形成一条双色分界线 */
            box-shadow: inset 0 0 0 1px color-mix(
                in srgb,
                var(--xmlg-group-stripe, var(--xmlg-accent)) 70%,
                transparent
            );
            background: color-mix(
                in srgb,
                var(--xmlg-group-stripe, var(--xmlg-accent)) 22%,
                transparent
            );
            color: var(--xmlg-text);
            font: inherit;
            font-size: 10px;
            line-height: 1.5;
            cursor: pointer;
        }
        .xmlg-scope-chip.is-visible {
            /* 抵消容器那 2px 段间缝，和左边的「分组」严丝合缝 */
            grid-template-columns: minmax(0, 1fr);
            margin-left: -2px;
            opacity: 1;
            pointer-events: auto;
        }
        .xmlg-scope-chip-inner {
            display: inline-flex;
            align-items: center;
            gap: 5px;
            min-width: 0;
            overflow: hidden;
            padding: 2px 7px 2px 6px;
            white-space: nowrap;
        }
        /* 合并态：「分组」那段右边不再收圆，实心底色和组号连成一片，
           只在最外侧收圆。两者之间原本 2px 的段间缝用负外边距抵消掉，
           这样 Files / All / 分组 之间的缝还是原来的 2px，不会被一起拉紧 */
        .xmlg-scope-btn.is-scoped {
            /* 合并态：右边缘不收圆角，内描边照旧留着。
               组号那半有同一圈描边、位置严丝合缝，两段描边叠起来看着
               就是**整条胶囊的一圈边框**，不会在接缝处「收口」 */
            border-radius: 999px 0 0 999px;
        }
        .xmlg-scope-chip-text {
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }
        .xmlg-scope-chip-close {
            flex: 0 0 auto;
            opacity: 0.7;
        }
        .xmlg-scope-chip:hover .xmlg-scope-chip-close {
            opacity: 1;
        }
        /* 「只作用于这一组」的标记：用品牌粉，不用组色。
           组色和组头自己的底色太接近，画布缩小后这根线就看不见了；
           品牌粉在深色/浅色两套主题下都够扎眼。2px 是为了小缩放也认得出。 */
        .xmlg-group-head.is-scope-target {
            box-shadow: inset 0 0 0 2px var(--xmlg-accent, #ff385c);
        }
        .xmlg-list-toolbar label {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            margin-left: auto;
            white-space: nowrap;
        }
        .xmlg-toolbar label {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            white-space: nowrap;
        }
        .xmlg-btn {
            width: 22px;
            min-width: 22px;
            height: 22px;
            padding: 0;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            border: 1px solid var(--xmlg-border);
            background: var(--xmlg-surface-strong);
            color: inherit;
            font: inherit;
            font-size: 12px;
            line-height: 1;
            border-radius: var(--xdh-radius-xs, 4px);
            cursor: pointer;
            box-sizing: border-box;
        }
        .xmlg-btn:hover {
            border-color: var(--xmlg-accent);
        }
        .xmlg-btn:disabled {
            opacity: 0.4;
            cursor: default;
        }
        /* 「创建分组」不可用时不用真 disabled：真 disabled 的按钮收不到
           鼠标事件，悬停提示就永远看不到为什么点不动。 */
        .xmlg-btn.is-disabled {
            opacity: 0.4;
            cursor: not-allowed;
        }
        /* 底栏里的「已启用 X / 50」：和「共 N 个文件」并排，
           中间靠 .xmlg-pager-divider 隔开 */
        .xmlg-status {
            flex: 0 0 auto;
            opacity: 0.8;
            font-size: 11px;
            font-variant-numeric: tabular-nums;
            white-space: nowrap;
        }
        .xmlg-pager-info {
            display: flex;
            align-items: center;
            gap: 8px;
            min-width: 0;
        }
        .xmlg-pager-divider {
            flex: 0 0 auto;
            width: 1px;
            height: 11px;
            background: var(--xmlg-border);
        }
        .xmlg-list-viewport {
            position: relative;
            display: flex;
            flex: 1 1 0;
            min-height: 0;
        }
        .xmlg-list {
            position: relative;
            display: flex;
            flex-direction: column;
            gap: 4px;
            min-height: 160px;
            flex: 1 1 0;
            border: none;
            border-radius: 0;
            background: var(--xmlg-surface-strong);
            padding: 6px;
            box-sizing: border-box;
            overflow-x: hidden;
            overflow-y: scroll;
            scrollbar-gutter: stable;
            scrollbar-width: auto;
            scrollbar-color: var(--xmlg-scroll-thumb) var(--xmlg-scroll-track);
        }
        .xmlg-list::-webkit-scrollbar {
            width: 10px;
            height: 10px;
        }
        .xmlg-list::-webkit-scrollbar-thumb {
            background: var(--xmlg-scroll-thumb);
            border-radius: 4px;
        }
        .xmlg-row {
            position: relative;
            display: flex;
            align-items: center;
            gap: 6px;
            /* 按住行是要搬它，不是要选字：一旦选中文字，浏览器会启动
               原生「拖选文字」，我们的拖动会被 pointercancel 打断 */
            user-select: none;
            min-height: 44px;
            flex: 0 0 auto;
            padding: 4px 6px;
            border-radius: var(--xdh-radius-sm, 8px);
            border: 1px solid var(--xmlg-border);
            background: var(--xmlg-surface-strong);
            box-sizing: border-box;
        }
        /* 折叠 / 展开那一下的高度收放：过渡只在这 160ms 里挂着，
           平时不挂——否则换缩略图、改行内容也会跟着动一下。
           内边距和上下边框也要一起收：只收 height 的话，行压到 0 还剩
           10px（上下内边距 8 + 边框 2），那一截会在最后「啪」地消失。 */
        .xmlg-row.is-folding {
            transition:
                height ${SLIDE_MS}ms cubic-bezier(0.2, 0, 0.6, 1),
                margin-top ${SLIDE_MS}ms cubic-bezier(0.2, 0, 0.6, 1),
                padding-top ${SLIDE_MS}ms cubic-bezier(0.2, 0, 0.6, 1),
                padding-bottom ${SLIDE_MS}ms cubic-bezier(0.2, 0, 0.6, 1),
                border-top-width ${SLIDE_MS}ms cubic-bezier(0.2, 0, 0.6, 1),
                border-bottom-width ${SLIDE_MS}ms cubic-bezier(0.2, 0, 0.6, 1),
                opacity ${SLIDE_MS}ms linear;
        }
        .xmlg-seq {
            flex: 0 0 24px;
            text-align: center;
            font-size: 10px;
            opacity: 0.6;
            font-variant-numeric: tabular-nums;
            border-right: 1px solid var(--xmlg-border);
            padding-right: 6px;
            box-sizing: border-box;
        }
        /* 组内行的序号（含没有序号时的「–」）用组色，和左侧竖线呼应 */
        .xmlg-row.is-grouped .xmlg-seq {
            color: var(--xmlg-group-stripe, var(--xmlg-accent));
            opacity: 1;
            border-right-color: color-mix(
                in srgb,
                var(--xmlg-group-stripe, var(--xmlg-accent)) 45%,
                transparent
            );
        }
        .xmlg-row-hint {
            position: absolute;
            left: 50%;
            top: 50%;
            transform: translate(-50%, -50%);
            padding: 2px 8px;
            border-radius: 999px;
            background: var(--xmlg-warning);
            color: var(--xmlg-warning-ink);
            font-size: 11px;
            font-weight: 600;
            white-space: nowrap;
            pointer-events: none;
            display: none;
            z-index: 2;
        }
        .xmlg-row.is-replace-target .xmlg-row-hint {
            display: inline-flex;
            align-items: center;
            gap: 3px;
        }
        .xmlg-row:hover {
            border-color: var(--xmlg-accent);
        }
        .xmlg-row.is-disabled {
            opacity: 0.5;
        }
        /* 每组一根竖线：整组一条，画在行边框外面的留白里。
           做成一个绝对定位元素（而不是每行一个伪元素），组头和第一行
           之间才不会断成两截。上下位置由脚本按组头和最后一行的位置算。 */
        .xmlg-group-rail {
            position: absolute;
            /* 列表左内边距 6px、行边框正好在 6px 处：竖线占 1~4px，在边框外 */
            left: 1px;
            width: 3px;
            border-radius: 3px;
            background: var(--xmlg-group-stripe, var(--xmlg-accent));
            pointer-events: none;
        }
        .xmlg-row.is-selected {
            border-color: var(--xmlg-accent);
            box-shadow: inset 0 0 0 1px var(--xmlg-accent);
        }
        .xmlg-group-head.is-group-target {
            border-color: color-mix(
                in srgb,
                var(--xmlg-group-stripe, var(--xmlg-accent)) 70%,
                transparent
            );
        }
        .xmlg-group-head.is-drop-target {
            border-color: var(--xmlg-accent);
            background: color-mix(
                in srgb,
                var(--xmlg-accent) 20%,
                transparent
            );
        }
        /* 拖动中的行：不能只靠变淡（那和禁用分不开），用虚线 + 强调色
           底 + 抬起表示「正被搬走」。必须写在 :hover / .is-disabled
           之后，两者同时命中时以拖动为准。 */
        /* 拖动中的行不再是「抬起的那张卡片」——卡片是浏览器自己画的
           拖影，这里的原件留在列表里当「空槽位」：位置就是落点，
           用户看到的是一个虚线框，松手就地变成这一行。 */
        /* 拖动中的行只把「内容」藏起来，它占的那一格留着：
           这样列表里能看出这一格空出来、要落在这儿（让位动画也才有东西可让）。
           用 display: none 的话整行连位置一起消失，拖动时列表纹丝不动，
           就看不出会插到哪了。 */
        .xmlg-row.is-dragging {
            visibility: hidden;
        }
        /* 拖动中整个列表不参与鼠标命中：悬停样式（行边框变色、按钮变亮、
           缩略图预览）就全部自然失效——边框一亮会被误读成「放上来就覆盖」。
           落点只按位置算，跟指针压在谁身上无关。 */
        body.xmlg-pointer-dragging .xmlg-list {
            pointer-events: none;
        }
        /* 跟着指针走的卡片：源行已经藏起来了，这一张就是它本身 */
        .xmlg-drag-ghost {
            position: fixed;
            z-index: 99999;
            pointer-events: none;
            /* 不透明：半透明会把下面那行透出来，看起来像是重影 */
            opacity: 1;
            /* 不许放大：放大 1% 就会往两边各溢出一个像素，
               正好压住行左边那根组竖线，竖线就看不清了。
               卡片和原来的行一样大，只靠阴影表现「浮起来」。 */
            box-shadow: var(--xdh-shadow-popup, 0 10px 26px rgba(0, 0, 0, 0.45));
        }
        /* 卡片必须完全不透明：禁用行本身是 50% 半透明，直接克隆过来
           会透出下面的行，看着像重影（选择器要比 .is-disabled 更具体） */
        .xmlg-row.xmlg-drag-ghost,
        .xmlg-group-head.xmlg-drag-ghost {
            opacity: 1;
        }
        /* 组胶囊的底色是「组色 20% + 透明」，拿它当卡片会透出下面的行：
           换成同一个颜色压在不透明底色上 */
        .xmlg-group-head.xmlg-drag-ghost {
            background: color-mix(
                in srgb,
                var(--xmlg-group-stripe, var(--xmlg-accent)) 18%,
                var(--xmlg-surface-strong)
            );
        }
        /* 指针拖动期间：不选中文字，光标保持「抓着」 */
        body.xmlg-pointer-dragging {
            user-select: none;
            cursor: grabbing;
        }
        /* 拖一行进组时，这一组的竖线要跟着变长：
           给它一个和行让位同长的过渡，别瞬间跳到新长度。
           只在指针拖动期间开——否则刷新页面时竖线会从 3px 长出来。 */
        body.xmlg-pointer-dragging .xmlg-group-rail {
            transition:
                height ${SLIDE_MS}ms cubic-bezier(0.2, 0, 0, 1),
                top ${SLIDE_MS}ms cubic-bezier(0.2, 0, 0, 1);
        }
        /* 让位时正在滑动的行：交给合成层，长列表里不抖 */
        .xmlg-row.is-sliding,
        .xmlg-group-head.is-sliding {
            will-change: transform;
        }
        .xmlg-mask-btn {
            font-size: 12px;
        }
        .xmlg-mask-emoji {
            filter: grayscale(1);
            opacity: 0.55;
            line-height: 1;
        }
        .xmlg-mask-btn.is-set {
            border-color: var(--xmlg-accent);
        }
        .xmlg-mask-btn.is-set .xmlg-mask-emoji {
            filter: none;
            opacity: 1;
        }
        /* 行的操作按钮之间那条竖线：align-self 撑满行高，再用负外边距
           吃掉行的上下内边距，线两头正好顶到行边框（原来是固定 16px，
           上下各留一截空白）。 */
        .xmlg-row-divider {
            align-self: stretch;
            margin: -4px 0;
            width: 1px;
            flex: 0 0 1px;
            background: var(--xmlg-border);
        }
        .xmlg-row.is-missing {
            border-color: var(--xmlg-danger);
            background: var(--xmlg-danger-soft);
        }
        /* 拖整组时这一摞一起变淡（比单行更淡：表示整块在搬） */
        .xmlg-row.is-block-dragging {
            opacity: 0.45;
        }
        /* 拖整组时这一组当场折起来：只留组名那一行
           （和「折叠组」看起来一致，只是不改数据） */
        /* 组内成员：整块让开，不占位置 */
        .xmlg-row.is-drag-collapsed {
            display: none;
        }
        /* 组名那一行：内容藏起来，但那一格留着当空位，
           拖动时其它组和行才能滑开让位，看出这一组会落到哪 */
        .xmlg-group-head.is-drag-collapsed {
            visibility: hidden;
        }
        .xmlg-group-head.is-dragging {
            cursor: grabbing;
            opacity: 0.7;
        }
        .xmlg-row.is-replace-target {
            border-color: var(--xmlg-warning);
            background: var(--xmlg-warning-soft);
        }
        .xmlg-switch {
            display: inline-flex;
            align-items: center;
            flex: 0 0 auto;
            cursor: pointer;
        }
        .xmlg-switch input {
            position: absolute;
            opacity: 0;
            width: 0;
            height: 0;
        }
        .xmlg-switch-track {
            position: relative;
            display: inline-flex;
            align-items: center;
            width: 24px;
            min-width: 24px;
            height: 14px;
            border-radius: var(--xdh-radius-full, 999px);
            border: 1px solid var(--xmlg-border);
            background: var(--xmlg-surface-strong);
            box-sizing: border-box;
            transition: background 0.15s ease, border-color 0.15s ease,
                box-shadow 0.15s ease;
        }
        .xmlg-switch-track::after {
            content: "";
            position: absolute;
            top: 1px;
            left: 1px;
            width: 10px;
            height: 10px;
            border-radius: 50%;
            background: var(--xmlg-text);
            transition: transform 0.15s ease, background 0.15s ease;
        }
        .xmlg-switch input:checked + .xmlg-switch-track {
            border-color: var(--xmlg-accent);
            background: var(--xmlg-accent-muted);
        }
        .xmlg-switch input:checked + .xmlg-switch-track::after {
            transform: translateX(10px);
            background: var(--xmlg-accent);
        }
        .xmlg-switch input:focus-visible + .xmlg-switch-track {
            box-shadow: 0 0 0 1px var(--xmlg-accent);
        }
        .xmlg-thumb {
            position: relative;
            width: 34px;
            height: 34px;
            flex: 0 0 34px;
            border-radius: 4px;
            overflow: hidden;
            background: var(--xmlg-thumb-bg);
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 15px;
            color: var(--xmlg-text-muted);
        }
        /* 悬停 / 键盘聚焦时，在缩略图正中浮出预览图标。 */
        .xmlg-thumb-preview {
            position: absolute;
            left: 50%;
            top: 50%;
            z-index: 1;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 20px;
            height: 20px;
            border-radius: 50%;
            border: 1px solid var(--xmlg-border);
            background: color-mix(
                in srgb,
                var(--xmlg-canvas) 72%,
                transparent
            );
            color: var(--xmlg-text);
            box-shadow: 0 1px 4px rgba(0, 0, 0, 0.45);
            opacity: 0;
            pointer-events: none;
            transform: translate(-50%, -50%) scale(0.9);
            transition: opacity 0.12s ease, transform 0.12s ease;
        }
        .xmlg-thumb-preview-icon {
            display: block;
            width: 12px;
            height: 12px;
            background-color: currentColor;
            -webkit-mask: url("${PREVIEW_EYE_ICON_URL}") center / contain
                no-repeat;
            mask: url("${PREVIEW_EYE_ICON_URL}") center / contain no-repeat;
        }
        .xmlg-thumb.is-previewable:hover .xmlg-thumb-preview,
        .xmlg-thumb.is-previewable:focus .xmlg-thumb-preview,
        .xmlg-thumb.is-previewable:focus-visible .xmlg-thumb-preview {
            opacity: 1;
            transform: translate(-50%, -50%) scale(1);
        }
        .xmlg-thumb.is-audio {
            background: var(--xmlg-surface);
        }
        .xmlg-thumb img,
        .xmlg-thumb video {
            width: 100%;
            height: 100%;
            /* 保持原始宽高比，整张图完整显示（不拉伸、不裁切） */
            object-fit: contain;
            display: block;
        }
        .xmlg-thumb img.is-missing {
            opacity: 0;
        }
        .xmlg-name {
            flex: 1 1 auto;
            min-width: 0;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }
        .xmlg-remove {
            flex: 0 0 22px;
            width: 22px;
            min-width: 22px;
            height: 22px;
            border: 1px solid var(--xmlg-border);
            border-radius: var(--xdh-radius-xs, 4px);
            background: var(--xmlg-surface-strong);
            color: inherit;
            cursor: pointer;
            opacity: 0.8;
            font-size: 12px;
            line-height: 1;
            padding: 0;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            box-sizing: border-box;
        }
        .xmlg-remove:hover {
            opacity: 1;
            background: var(--xmlg-danger-soft);
            color: var(--xmlg-danger-text);
            border-color: var(--xmlg-danger);
        }
        .xmlg-empty {
            position: absolute;
            inset: 0;
            display: flex;
            align-items: center;
            justify-content: center;
            text-align: center;
            padding: 12px;
            opacity: 0.55;
            pointer-events: none;
            box-sizing: border-box;
        }
        /* 组头本身就是一整行贯穿的胶囊：底色用组色兑淡、边框用组色，
           箭头 / 名字 / 计数 / 设置按钮都住在里面。顶上不画分隔线。 */
        .xmlg-row input,
        .xmlg-group-name-input {
            user-select: text;
        }
        .xmlg-group-head {
            user-select: none;
            position: relative;
            display: flex;
            align-items: center;
            /* 箭头、名字之间留出呼吸区（原来 6px 挤在一起）。
               计数胶囊要把这份间距收回去，贴着设置按钮，所以留个变量 */
            --xmlg-head-gap: 9px;
            gap: var(--xmlg-head-gap);
            min-height: 28px;
            /* 不要额外上边距：列表本身就是 4px 间距，再加 6px 会让
               「组上方的缝」比「组下方」「行与行之间」都大一截 */
            margin: 0;
            /* 右内边距要和上下一样（2px + 1px 边框 = 4px 视觉缝）：
               原来是 8px，设置按钮右边空出 9px、上下只有 4px，看着往左歪 */
            padding: 2px 3px 2px 4px;
            border: 1px solid color-mix(
                in srgb,
                var(--xmlg-group-stripe, var(--xmlg-accent)) 40%,
                transparent
            );
            border-radius: 999px;
            background: color-mix(
                in srgb,
                var(--xmlg-group-stripe, var(--xmlg-accent)) 16%,
                transparent
            );
            font-size: 11px;
            line-height: 1.2;
            box-sizing: border-box;
        }
        .xmlg-group-arrow {
            flex: 0 0 auto;
            width: 18px;
            height: 18px;
            margin-left: 1px;
            padding: 0;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            border: 1px solid transparent;
            border-radius: 999px;
            background: transparent;
            color: inherit;
            font: inherit;
            line-height: 1;
            cursor: pointer;
        }
        /* 用图标而不是字符：字符受字号限制，缩小后笔画糊在一起 */
        .xmlg-group-arrow::before {
            content: "";
            width: 16px;
            height: 16px;
            background: currentColor;
            -webkit-mask: url("${GROUP_ARROW_ICON_URL}") center / contain
                no-repeat;
            mask: url("${GROUP_ARROW_ICON_URL}") center / contain no-repeat;
            transition: transform 160ms cubic-bezier(0.2, 0, 0.6, 1);
        }
        /* 展开时朝下，折叠时就地转成朝右 */
        .xmlg-group-arrow.is-collapsed::before {
            transform: rotate(-90deg);
        }
        .xmlg-group-arrow:hover {
            border-color: var(--xmlg-border);
            background: var(--xmlg-surface-strong);
        }
        /* 折叠组的「已启用 / 总数」：紧挨在设置按钮左边的一个小胶囊，
           中间固定留一个间距。位置靠「吃掉剩余空间」定住，所以组名多长
           都影响不到它——长名字自己收省略号，胶囊纹丝不动。 */
        .xmlg-group-count {
            flex: 0 0 auto;
            margin-left: auto;
            display: inline-flex;
            align-items: center;
            /* 展开时宽度收到 0、全透明，但一直占着位置：收拢这 160ms 里
               慢慢长出来，而不是等动画结束重画那一帧突然冒出来 */
            max-width: 0;
            padding: 1px 0;
            border: 1px solid color-mix(
                in srgb,
                var(--xmlg-group-stripe, var(--xmlg-accent)) 34%,
                transparent
            );
            border-radius: 999px;
            background: color-mix(
                in srgb,
                var(--xmlg-group-stripe, var(--xmlg-accent)) 14%,
                transparent
            );
            border-width: 0;
            font-size: 10px;
            line-height: 1.4;
            font-variant-numeric: tabular-nums;
            white-space: nowrap;
            overflow: hidden;
            opacity: 0;
            transition:
                max-width ${SLIDE_MS}ms cubic-bezier(0.2, 0, 0.6, 1),
                padding ${SLIDE_MS}ms cubic-bezier(0.2, 0, 0.6, 1),
                border-width ${SLIDE_MS}ms cubic-bezier(0.2, 0, 0.6, 1),
                opacity ${SLIDE_MS}ms cubic-bezier(0.2, 0, 0.6, 1);
            /* 数字不该抢走按住组头的鼠标事件 */
            pointer-events: none;
        }
        .xmlg-group-head.is-collapsed .xmlg-group-count {
            max-width: 80px;
            padding: 1px 7px;
            border-width: 1px;
            opacity: 1;
        }
        /* 名字前面的序列号徽标：「组 3」这个号才是这一组的身份，
           工具栏要指代某一组时念的就是它 */
        .xmlg-group-seq {
            flex: 0 0 auto;
            min-width: 16px;
            padding: 0 5px;
            border: 1px solid var(--xmlg-border);
            border-radius: 999px;
            background: color-mix(
                in srgb,
                var(--xmlg-group-stripe, var(--xmlg-accent)) 14%,
                transparent
            );
            color: var(--xmlg-text);
            font-size: 10px;
            font-variant-numeric: tabular-nums;
            line-height: 1.5;
            text-align: center;
            opacity: 0.85;
        }
        .xmlg-group-seq.is-hidden {
            display: none;
        }
        .xmlg-group-name {
            flex: 0 1 auto;
            min-width: 0;
            /* 剩下的空间归名字（超长就省略号），右边的计数和设置按钮
               因此始终贴在最右侧 */
            margin-right: 0;
            font-weight: 600;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            cursor: text;
        }
        .xmlg-group-name-input {
            flex: 1 1 auto;
            min-width: 60px;
            height: 20px;
            padding: 0 6px;
            border: 1px solid var(--xmlg-accent);
            border-radius: 999px;
            background: var(--xmlg-canvas, rgba(0, 0, 0, 0.35));
            color: inherit;
            font: inherit;
            font-size: 11px;
            box-sizing: border-box;
        }
        /* 胶囊里的设置按钮：圆角跟着胶囊走，不然右端会显得方方正正 */
        .xmlg-group-settings {
            /* 靠右的活交给计数胶囊做（它要贴着这个按钮）：
               两个 auto 外边距会把剩余空间五五分，计数就贴不过来了 */
            margin-left: 0;
            flex: 0 0 auto;
            width: auto;
            min-width: 0;
            height: 20px;
            padding: 0 10px;
            border-radius: 999px;
            background: color-mix(
                in srgb,
                var(--xmlg-group-stripe, var(--xmlg-accent)) 22%,
                transparent
            );
            font-size: 10px;
            white-space: nowrap;
        }
        .xmlg-group-btn {
            width: auto;
            min-width: 0;
            flex: 0 0 auto;
            padding: 0 8px;
            font-size: 11px;
            /* 宽度紧的时候宁可让右边的状态文字省略，也别把按钮折成两行 */
            white-space: nowrap;
        }
        .xmlg-modal {
            position: absolute;
            inset: 0;
            z-index: 30;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 12px;
            background: var(--xmlg-scrim, rgba(0, 0, 0, 0.55));
            backdrop-filter: blur(1.5px);
            box-sizing: border-box;
        }
        .xmlg-modal-card {
            width: 100%;
            max-width: 320px;
            display: flex;
            flex-direction: column;
            gap: 8px;
            padding: 12px;
            border-radius: var(--xdh-radius-sm, 10px);
            border: 1px solid var(--xmlg-border, rgba(255, 255, 255, 0.14));
            background: var(--xmlg-surface-strong, rgba(32, 32, 36, 0.96));
            box-shadow: var(--xdh-shadow-popup, 0 12px 32px rgba(0, 0, 0, 0.5));
            box-sizing: border-box;
        }
        .xmlg-modal-title {
            font-size: 12px;
            font-weight: 600;
        }
        .xmlg-modal-field {
            display: flex;
            flex-direction: column;
            gap: 4px;
        }
        .xmlg-modal-label {
            font-size: 10px;
            opacity: 0.6;
        }
        .xmlg-modal-input {
            width: 100%;
            height: 26px;
            padding: 0 8px;
            border: 1px solid var(--xmlg-border, rgba(255, 255, 255, 0.14));
            border-radius: var(--xdh-radius-xs, 4px);
            background: var(--xmlg-canvas, rgba(0, 0, 0, 0.35));
            color: inherit;
            font: inherit;
            font-size: 11px;
            box-sizing: border-box;
        }
        .xmlg-modal-input:focus {
            outline: none;
            border-color: var(--xmlg-accent);
        }
        .xmlg-swatches {
            display: flex;
            align-items: center;
            gap: 6px;
        }
        .xmlg-swatch {
            width: 20px;
            height: 20px;
            padding: 0;
            border: 1px solid var(--xmlg-border, rgba(255, 255, 255, 0.14));
            border-radius: 999px;
            background: var(--xmlg-swatch, var(--xmlg-accent));
            cursor: pointer;
            box-sizing: border-box;
        }
        /* 选中的颜色：外圈描一道亮边，深色浅色主题都看得清 */
        .xmlg-swatch.is-active {
            box-shadow: 0 0 0 2px var(--xmlg-surface-strong, #202024),
                0 0 0 3px var(--xmlg-swatch, var(--xmlg-accent));
        }
        .xmlg-swatch:hover {
            box-shadow: 0 0 0 2px var(--xmlg-surface-strong, #202024),
                0 0 0 3px color-mix(
                    in srgb,
                    var(--xmlg-swatch, var(--xmlg-accent)) 70%,
                    transparent
                );
        }
        .xmlg-modal-text {
            font-size: 11px;
            line-height: 1.5;
            opacity: 0.8;
        }
        .xmlg-modal-actions {
            display: flex;
            flex-direction: column;
            gap: 6px;
        }
        .xmlg-modal-btn {
            width: 100%;
            height: 26px;
            padding: 0 8px;
            border: 1px solid var(--xmlg-border, rgba(255, 255, 255, 0.14));
            border-radius: var(--xdh-radius-xs, 4px);
            background: var(--xmlg-surface, rgba(255, 255, 255, 0.06));
            color: inherit;
            font: inherit;
            font-size: 11px;
            line-height: 1;
            cursor: pointer;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            box-sizing: border-box;
        }
        .xmlg-modal-btn:hover {
            border-color: var(--xmlg-accent);
        }
        .xmlg-modal-btn.is-danger {
            border-color: var(--xmlg-danger, #D90429);
            color: var(--xmlg-danger-bright, #FF6B6B);
        }
        .xmlg-modal-btn.is-danger:hover {
            background: var(--xmlg-danger-soft, rgba(217, 4, 41, 0.16));
        }
        .xmlg-pager {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 8px;
            min-height: 30px;
            padding: 4px 10px;
            border-top: 1px solid var(--xmlg-border);
            border-radius: 0 0 var(--xdh-radius-sm, 8px) var(--xdh-radius-sm, 8px);
            background: var(--xmlg-surface);
            box-sizing: border-box;
        }
        .xmlg-total {
            font-size: 11px;
            opacity: 0.6;
            white-space: nowrap;
        }
        .xmlg-pager-clear {
            font-size: 13px;
        }
        .xmlg-overlay {
            position: absolute;
            inset: 0;
            display: none;
            align-items: center;
            justify-content: center;
            flex-direction: column;
            gap: 6px;
            text-align: center;
            padding: 16px;
            box-sizing: border-box;
            background: var(--xmlg-scrim);
            backdrop-filter: blur(1.5px);
            color: var(--xmlg-danger-bright);
            border-radius: var(--xdh-radius-sm, 6px);
            pointer-events: none;
            z-index: 5;
        }
        .xmlg-overlay.is-visible {
            display: flex;
        }
        .xmlg-overlay-icon {
            font-size: 26px;
            line-height: 1;
        }
        .xmlg-overlay-title {
            font-size: 13px;
            font-weight: 600;
            padding: 3px 12px;
            border-radius: 999px;
            background: color-mix(
                in srgb,
                var(--xmlg-canvas) 70%,
                transparent
            );
        }
        .xmlg-overlay-hint {
            font-size: 11px;
            padding: 2px 10px;
            border-radius: 999px;
            background: color-mix(
                in srgb,
                var(--xmlg-canvas) 55%,
                transparent
            );
        }
        .xmlg-insert-line {
            position: absolute;
            left: 4px;
            right: 4px;
            height: 2px;
            border-radius: 2px;
            background: var(--xmlg-warning-strong);
            box-shadow: 0 0 8px var(--xmlg-warning-strong);
            pointer-events: none;
            display: none;
            z-index: 6;
        }
        .xmlg-drop-label {
            position: absolute;
            left: 50%;
            transform: translateX(-50%);
            padding: 2px 8px;
            border-radius: 999px;
            background: var(--xmlg-warning);
            color: var(--xmlg-warning-ink);
            font-size: 11px;
            font-weight: 600;
            pointer-events: none;
            display: none;
            z-index: 7;
            white-space: nowrap;
        }
        .xmlg-toast {
            position: absolute;
            left: 50%;
            top: 42px;
            transform: translateX(-50%);
            max-width: 92%;
            padding: 5px 10px;
            border-radius: var(--xdh-radius-sm, 6px);
            background: var(--xmlg-toast-bg);
            border: 1px solid var(--xmlg-accent);
            color: inherit;
            font-size: 11px;
            display: none;
            z-index: 20;
            text-align: center;
            box-sizing: border-box;
        }
        .xmlg-toast.is-visible {
            display: block;
            animation: xmlg-toast-in 120ms ease-out;
        }
        .xmlg-toast.is-warning {
            border-color: var(--xmlg-warning);
            background: var(--xmlg-warning-surface);
            color: var(--xmlg-warning-text);
            font-weight: 600;
        }
        @keyframes xmlg-toast-in {
            from { opacity: 0; transform: translate(-50%, -4px); }
            to { opacity: 1; transform: translate(-50%, 0); }
        }
        .xmlg-tooltip {
            /* tooltip 挂在 body 下，不在 .xmlg-panel 作用域内，
               因此直接用 :root 上的 XDataHub token（带品牌色兜底）。 */
            --xmlg-tooltip-media-bg: #000;
            position: fixed;
            z-index: 99999;
            pointer-events: none;
            display: none;
            background: var(
                --xdh-color-surface-3,
                var(--xdh-clr-surface-strong, #1d1d20)
            );
            border: 1px solid var(
                --xdh-clr-hairline,
                rgba(255, 255, 255, 0.12)
            );
            border-radius: var(--xdh-radius-sm, 8px);
            padding: 8px;
            width: 212px;
            max-width: 212px;
            box-sizing: border-box;
            color: var(--xdh-color-text-primary, var(--xdh-clr-ink, #ffffff));
            box-shadow: var(
                --xdh-shadow-popup,
                0 8px 24px rgba(0, 0, 0, 0.15)
            );
        }
        .xmlg-tooltip.is-visible {
            display: block;
        }
        .xmlg-tooltip-media {
            display: flex;
            align-items: center;
            justify-content: center;
            width: 100%;
            min-height: 120px;
            background: var(--xmlg-tooltip-media-bg);
            border-radius: var(--xdh-radius-xs, 4px);
            overflow: hidden;
        }
        .xmlg-tooltip-media.is-audio {
            background: transparent;
        }
        .xmlg-tooltip-media img,
        .xmlg-tooltip-media video {
            width: 120px;
            height: 120px;
            object-fit: contain;
            display: block;
            margin: 0 auto;
        }
        .xmlg-tooltip-name {
            margin-top: 8px;
            padding-top: 8px;
            border-top: 1px solid var(
                --xdh-color-border,
                var(--xdh-clr-hairline, rgba(255, 255, 255, 0.12))
            );
            font-size: 11px;
            line-height: 1.35;
            white-space: normal;
            overflow-wrap: break-word;
            color: var(--xdh-color-text-primary, var(--xdh-clr-ink, #ffffff));
        }
        .xmlg-tooltip-fallback {
            display: flex;
            align-items: center;
            justify-content: center;
            width: 120px;
            height: 120px;
            font-size: 12px;
        }
        .xmlg-tooltip-fallback-label {
            color: var(--xdh-clr-ink, #ffffff);
            background: var(--xdh-clr-hairline, rgba(255, 255, 255, 0.12));
            padding: 4px 12px;
            border-radius: 999px;
            font-size: 12px;
            font-weight: 600;
        }
        .xmlg-hint {
            position: fixed;
            z-index: 99998;
            pointer-events: none;
            display: none;
            max-width: 260px;
            padding: 5px 8px;
            border-radius: var(--xdh-radius-xs, 4px);
            background: var(
                --xdh-color-surface-3,
                var(--xdh-clr-surface-strong, #1d1d20)
            );
            border: 1px solid var(
                --xdh-clr-hairline,
                rgba(255, 255, 255, 0.12)
            );
            color: var(--xdh-color-text-primary, var(--xdh-clr-ink, #ffffff));
            box-shadow: var(
                --xdh-shadow-popup,
                0 8px 24px rgba(0, 0, 0, 0.15)
            );
            font-size: 11px;
            line-height: 1.35;
            white-space: normal;
            overflow-wrap: break-word;
        }
        .xmlg-hint.is-visible {
            display: block;
        }

        /* ── 全屏预览 ──────────────────────────────────────────────── */
        .xmlg-preview {
            position: fixed;
            inset: 0;
            /* 固定成视口大小并裁掉溢出内容：大图不能把界面撑到屏幕外。 */
            width: 100%;
            height: 100vh;
            height: 100dvh;
            overflow: hidden;
            z-index: 99990;
            display: none;
            flex-direction: column;
            /* 全屏后背后是浏览器黑底，半透明/毛玻璃只会发灰，
               所以这里用不透明的主底色：浅色主题纯白、深色主题近黑。 */
            --xmlg-fs-bg: var(--xdh-clr-canvas, #0c0c0e);
            --xmlg-fs-panel: var(--xdh-clr-surface-card, #161618);
            --xmlg-fs-ring: var(--xdh-clr-hairline-soft,
                rgba(255, 255, 255, 0.06));
            --xmlg-fs-shadow: 0 2px 8px rgba(0, 0, 0, 0.18);
            background: var(--xmlg-fs-bg);
            color: var(--xmlg-text);
            font-size: 12px;
            box-sizing: border-box;
        }
        .xmlg-preview.is-open {
            display: flex;
        }
        .xmlg-preview-stage {
            position: relative;
            display: flex;
            flex: 1 1 auto;
            flex-direction: column;
            gap: 10px;
            width: 100%;
            min-height: 0;
            padding: 12px;
            box-sizing: border-box;
        }
        .xmlg-preview-bar {
            position: relative;
            z-index: 2;
            display: flex;
            flex: 0 0 auto;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
            min-height: 40px;
        }
        .xmlg-preview-title-wrap {
            display: flex;
            align-items: baseline;
            gap: 10px;
            min-width: 0;
        }
        .xmlg-preview-title {
            max-width: 45vw;
            font-size: 14px;
            font-weight: 600;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }
        .xmlg-preview-counter {
            color: var(--xmlg-text-muted);
            font-variant-numeric: tabular-nums;
            white-space: nowrap;
        }
        .xmlg-preview-actions {
            display: flex;
            flex: 0 0 auto;
            align-items: center;
            gap: 8px;
        }
        .xmlg-preview-btn {
            min-width: 30px;
            height: 30px;
            padding: 0 8px;
            font-size: 14px;
            /* 主底色上的小按钮：白（浅色）/ 深面板（深色）+ 细边框 */
            background: var(--xmlg-fs-panel);
        }
        .xmlg-preview-btn:hover {
            background: color-mix(
                in srgb,
                var(--xmlg-text) 8%,
                var(--xmlg-fs-panel)
            );
        }
        .xmlg-preview-btn[hidden] {
            display: none;
        }
        .xmlg-preview-toggle {
            gap: 6px;
        }
        .xmlg-preview-toggle-text {
            color: var(--xmlg-text-muted);
            font-size: 11px;
            white-space: nowrap;
        }
        .xmlg-preview-media {
            position: relative;
            display: flex;
            flex: 1 1 auto;
            align-items: center;
            justify-content: center;
            width: 100%;
            height: 100%;
            min-height: 0;
            overflow: hidden;
            border-radius: var(--xdh-radius-sm, 8px);
            /* 媒体区与主底色同色，靠一圈细线标出范围，避免出现第二种灰。 */
            background: var(--xmlg-fs-bg);
            box-shadow: inset 0 0 0 1px var(--xmlg-fs-ring);
            touch-action: none;
        }
        .xmlg-preview-media img.xmlg-preview-img {
            display: block;
            width: auto;
            height: auto;
            max-width: 100%;
            max-height: 100%;
            object-fit: contain;
            user-select: none;
            -webkit-user-drag: none;
            transform-origin: center center;
            will-change: transform;
            cursor: zoom-in;
        }
        .xmlg-preview-media img.xmlg-preview-img.is-zoomed {
            cursor: grab;
        }
        .xmlg-preview-media img.xmlg-preview-img.is-panning {
            cursor: grabbing;
        }
        /* 视频/音频用和 XVideoGet / XAudioGet 同一套自绘播放器。 */
        .xmlg-preview-media .xmg-video-player,
        .xmlg-preview-media .xmg-audio-player {
            display: flex;
            width: 100%;
            height: 100%;
            max-width: 100%;
            max-height: 100%;
            box-sizing: border-box;
        }
        /* 音频没有画面，把宽度和高度收一收，避免波形拉成一道高墙。 */
        .xmlg-preview-media .xmg-audio-player {
            width: min(880px, 100%);
            height: min(360px, 100%);
            margin: auto;
        }
        .xmlg-preview-media .xmg-video-content-area video {
            max-width: 100%;
            max-height: 100%;
        }
        .xmlg-preview-fallback {
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 16px 22px;
            border-radius: 999px;
            border: 1px solid var(--xmlg-border);
            background: var(--xmlg-fs-panel);
            color: var(--xmlg-text-muted);
        }
        .xmlg-preview-nav {
            position: absolute;
            top: 50%;
            transform: translateY(-50%);
            width: 38px;
            height: 38px;
            padding: 0;
            border: 1px solid var(--xmlg-border);
            border-radius: 50%;
            background: var(--xmlg-fs-panel);
            box-shadow: var(--xmlg-fs-shadow);
            color: inherit;
            font-size: 20px;
            line-height: 1;
            cursor: pointer;
            z-index: 2;
        }
        .xmlg-preview-nav:disabled {
            opacity: 0.35;
            cursor: not-allowed;
        }
        .xmlg-preview-prev {
            left: 18px;
        }
        .xmlg-preview-next {
            right: 18px;
        }
        .xmlg-preview-strip {
            position: relative;
            z-index: 2;
            display: flex;
            flex: 0 0 auto;
            width: 100%;
            box-sizing: border-box;
            gap: 6px;
            padding: 6px;
            overflow-x: auto;
            overflow-y: hidden;
            border: 1px solid var(--xmlg-border);
            border-radius: var(--xdh-radius-sm, 8px);
            background: var(--xmlg-fs-panel);
            scrollbar-width: thin;
        }
        .xmlg-preview-strip-item {
            position: relative;
            display: flex;
            flex: 0 0 76px;
            flex-direction: column;
            align-items: center;
            gap: 4px;
            width: 76px;
            padding: 4px;
            border: 1px solid transparent;
            border-radius: var(--xdh-radius-sm, 8px);
            background: transparent;
            color: inherit;
            cursor: pointer;
            box-sizing: border-box;
        }
        .xmlg-preview-strip-item:hover {
            background: color-mix(
                in srgb,
                var(--xmlg-text) 8%,
                transparent
            );
        }
        .xmlg-preview-strip-item.is-active {
            border-color: var(--xmlg-accent);
            background: var(--xmlg-accent-muted);
        }
        .xmlg-preview-strip-item.is-disabled {
            opacity: 0.45;
        }
        /* 启用顺序角标：和面板行左侧的序号保持一致。 */
        .xmlg-preview-strip-seq {
            position: absolute;
            top: -2px;
            left: -2px;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            min-width: 16px;
            height: 16px;
            padding: 0 3px;
            border-radius: var(--xdh-radius-full, 999px);
            background: var(--xmlg-accent);
            color: var(--xmlg-on-accent);
            font-size: 9px;
            font-variant-numeric: tabular-nums;
            box-sizing: border-box;
            pointer-events: none;
            z-index: 1;
        }
        .xmlg-preview-strip-thumb {
            display: flex;
            align-items: center;
            justify-content: center;
            width: 48px;
            height: 48px;
            overflow: hidden;
            border-radius: 6px;
            background: var(--xmlg-thumb-bg);
            box-shadow: inset 0 0 0 1px var(--xmlg-fs-ring);
            font-size: 18px;
        }
        .xmlg-preview-strip-thumb img {
            display: block;
            width: 100%;
            height: 100%;
            object-fit: contain;
        }
        .xmlg-preview-strip-name {
            width: 100%;
            color: var(--xmlg-text-muted);
            font-size: 9px;
            line-height: 1.2;
            text-align: center;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        .xmlg-preview-hint {
            position: relative;
            z-index: 2;
            flex: 0 0 auto;
            align-self: flex-end;
            color: var(--xmlg-text-muted);
            font-size: 10px;
            opacity: 0.8;
        }
        .xmlg-preview-toast {
            position: fixed;
            left: 50%;
            top: 24px;
            transform: translateX(-50%);
            max-width: 80vw;
            padding: 6px 12px;
            border: 1px solid var(--xmlg-warning);
            border-radius: var(--xdh-radius-sm, 6px);
            background: var(--xmlg-warning-surface);
            color: var(--xmlg-warning-text);
            box-shadow: var(--xmlg-fs-shadow, 0 2px 8px rgba(0, 0, 0, 0.18));
            font-size: 12px;
            font-weight: 600;
            display: none;
            z-index: 3;
            box-sizing: border-box;
        }
        .xmlg-preview-toast.is-visible {
            display: block;
        }
        .xmlg-thumb.is-previewable {
            cursor: zoom-in;
        }
        .xmlg-tooltip-name-text {
            font-weight: 600;
        }
        .xmlg-tooltip-hint {
            margin-top: 2px;
            font-size: 10px;
            opacity: 0.65;
        }
    `;
    document.head.appendChild(style);
}

const MASK_EDITOR_I18N_PREFIX = "xdatahub.ui.node.ximageget.mask_editor";

function getMaskEditorTexts() {
    const key = (suffix) => `${MASK_EDITOR_I18N_PREFIX}.${suffix}`;
    return {
        dialogTitle: t(key("dialog_title"), "XMaskEditor"),
        toolBrush: t(key("tool_brush"), "Color Brush"),
        toolMaskBrush: t(key("tool_mask_brush"), "Mask Brush"),
        toolErase: t(key("tool_erase"), "Erase"),
        toolPan: t(key("tool_pan"), "Pan"),
        undo: t(key("undo"), "Undo"),
        undoTip: t(key("undo_tip"), "Undo last step"),
        redo: t(key("redo"), "Redo"),
        redoTip: t(key("redo_tip"), "Redo last step"),
        rotateLeft: t(key("rotate_left"), "Rot Left"),
        rotateLeftTip: t(key("rotate_left_tip"), "Rotate image left"),
        rotateRight: t(key("rotate_right"), "Rot Right"),
        rotateRightTip: t(key("rotate_right_tip"), "Rotate image right"),
        flipHorizontal: t(key("flip_horizontal"), "Flip H"),
        flipHorizontalTip: t(
            key("flip_horizontal_tip"),
            "Flip image left to right"
        ),
        flipVertical: t(key("flip_vertical"), "Flip V"),
        flipVerticalTip: t(
            key("flip_vertical_tip"),
            "Flip image top to bottom"
        ),
        resetTransform: t(key("transform_reset"), "Reset"),
        resetTransformTip: t(
            key("transform_reset_tip"),
            "Reset rotation and flip"
        ),
        brushSize: t(key("brush_size"), "Brush and Eraser Size"),
        brushSizeTip: t(
            key("brush_size_tip"),
            "Change size with Ctrl/Cmd + Wheel"
        ),
        toolBrushTip: t(key("tool_brush_tip"), "Paint color"),
        color: t(key("color"), "Color"),
        fillThreshold: t(key("fill_threshold"), "Paint Bucket Tolerance"),
        fillThresholdTip: t(
            key("fill_threshold_tip"),
            "Color tolerance for flood fill (scroll wheel to adjust)"
        ),
        maskColor: t(key("mask_color"), "Mask"),
        toolMaskBrushTip: t(key("tool_mask_brush_tip"), "Paint mask"),
        toolEraseTip: t(key("tool_erase_tip"), "Erase current layer"),
        erasePaintLock: t(key("erase_paint_lock"), "Paint"),
        erasePaintLockTip: t(
            key("erase_paint_lock_tip"),
            "Uncheck to lock paint layer from eraser"
        ),
        eraseMaskLock: t(key("erase_mask_lock"), "Mask"),
        eraseMaskLockTip: t(
            key("erase_mask_lock_tip"),
            "Uncheck to lock mask layer from eraser"
        ),
        toolFill: t(key("tool_fill"), "Fill"),
        toolFillTip: t(
            key("tool_fill_tip"),
            "Flood fill region (samples all visible layers)"
        ),
        toolPanTip: t(
            key("tool_pan_tip"),
            "Move the canvas (middle mouse drag / Ctrl+left drag)"
        ),
        invertColor: t(key("invert_color"), "Invert"),
        invertColorTip: t(
            key("invert_color_tip"),
            "Swap black and white"
        ),
        invertDisplay: t(key("invert_display"), "Invert Disp"),
        invertDisplayTip: t(
            key("invert_display_tip"),
            "Invert image colors in masked areas (visual only)"
        ),
        invertPaintRegion: t(
            key("invert_paint_region"),
            "Invert Color Area"
        ),
        invertPaintRegionTip: t(
            key("invert_paint_region_tip"),
            "Swap painted and unpainted areas on the color layer"
        ),
        invertMaskRegion: t(
            key("invert_mask_region"),
            "Invert Mask Area"
        ),
        invertMaskRegionTip: t(
            key("invert_mask_region_tip"),
            "Swap painted and unpainted areas on the mask layer"
        ),
        paintOpacity: t(key("paint_opacity"), "Color Opacity"),
        maskOpacity: t(key("mask_opacity"), "Mask Opacity"),
        hardness: t(key("hardness"), "Edge Hardness"),
        showPaint: t(key("show_paint"), "Visible"),
        showPaintTip: t(key("show_paint_tip"), "Show color layer"),
        hidePaint: t(key("hide_paint"), "Hidden"),
        hidePaintTip: t(key("hide_paint_tip"), "Hide color layer"),
        showMask: t(key("show_mask"), "Visible"),
        showMaskTip: t(key("show_mask_tip"), "Show mask layer"),
        hideMask: t(key("hide_mask"), "Hidden"),
        hideMaskTip: t(key("hide_mask_tip"), "Hide mask layer"),
        maskBlackTip: t(key("mask_black_tip"), "Black mask"),
        maskWhiteTip: t(key("mask_white_tip"), "White mask"),
        zoomIn: t(key("zoom_in"), "+"),
        zoomInTip: t(key("zoom_in_tip"), "Zoom in"),
        zoomOut: t(key("zoom_out"), "-"),
        zoomOutTip: t(key("zoom_out_tip"), "Zoom out"),
        originalSize: t(key("original_size"), "Original Size"),
        originalSizeTip: t(key("original_size_tip"), "Use original size"),
        zoomReset: t(key("zoom_reset"), "Reset"),
        zoomResetTip: t(key("zoom_reset_tip"), "Fit to window"),
        clear: t(key("clear"), "Clear"),
        clearPaint: t(key("clear_paint"), "Clear Color"),
        clearPaintTip: t(key("clear_paint_tip"), "Clear color"),
        clearMask: t(key("clear_mask"), "Clear Mask"),
        clearMaskTip: t(key("clear_mask_tip"), "Clear mask"),
        save: t(key("save"), "Save"),
        saveTip: t(key("save_tip"), "Save changes"),
        cancel: t(key("cancel"), "Cancel"),
        cancelTip: t(key("cancel_tip"), "Discard changes"),
        close: t("xdatahub.ui.shell.btn.close", "Close"),
        closeTip: t(key("close_tip"), "Close editor"),
        loading: t(key("loading"), "Loading..."),
        loadFailed: t(key("load_failed"), "Failed to load image"),
        saving: t(key("saving"), "Saving..."),
        saveFailed: t(key("save_failed"), "Failed to save mask"),
    };
}

function buildMediaFileUrl(mediaRef) {
    const value = String(mediaRef || "").trim();
    if (!value) {
        return "";
    }
    return `/xz3r0/xdatahub/media/file?ref=${
        encodeURIComponent(value)
    }`;
}

function parseAnnotatedImageRef(value) {
    const raw = String(value || "").trim();
    if (!raw.endsWith("]") || !raw.includes("[")) {
        return null;
    }
    const splitIndex = raw.lastIndexOf("[");
    const pathPart = raw.slice(0, splitIndex).trim();
    const typePart = raw.slice(splitIndex + 1, -1).trim().toLowerCase();
    if (!pathPart || !["input", "output", "temp"].includes(typePart)) {
        return null;
    }
    const parts = pathPart.split("/").filter(Boolean);
    if (!parts.length) {
        return null;
    }
    return {
        filename: parts[parts.length - 1],
        subfolder: parts.slice(0, -1).join("/"),
        type: typePart,
    };
}

function buildAnnotatedImageUrl(value) {
    const parsed = parseAnnotatedImageRef(value);
    if (!parsed) {
        return "";
    }
    const query = new URLSearchParams({
        filename: parsed.filename,
        type: parsed.type,
    });
    if (parsed.subfolder) {
        query.set("subfolder", parsed.subfolder);
    }
    return `/api/view?${query.toString()}`;
}

async function openMaskEditorForEntry(node, entry) {
    const imageUrl = buildMediaFileUrl(entry.ref);
    if (!imageUrl) {
        return;
    }
    try {
        await openXMaskEditor({
            imageUrl,
            maskUrl: buildAnnotatedImageUrl(entry.mask_ref),
            paintUrl: buildAnnotatedImageUrl(entry.paint_ref),
            transformState: entry.transform_state || "",
            title: entry.title || "",
            texts: getMaskEditorTexts(),
            onSave: ({ maskRef, paintRef, hasMask, transformState }) => {
                // 编辑器里清空遮罩后不该再算「已设置遮罩」。
                entry.mask_ref = hasMask === false
                    ? ""
                    : String(maskRef || "");
                entry.paint_ref = String(paintRef || "");
                entry.transform_state = String(transformState || "");
                const panel = node?.__xmlg_panel;
                if (!panel) {
                    return;
                }
                writeItems(node, panel.state.items);
                renderPanel(node);
                node.setDirtyCanvas?.(true, true);
            },
        });
    } catch (error) {
        console.warn("[XMediaListGet] mask editor unavailable", error);
    }
}

function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) {
        node.className = className;
    }
    if (text != null) {
        node.textContent = String(text);
    }
    return node;
}

function buildPanel() {
    ensureStyles();
    const panel = element("div", "xmlg-panel");

    const meta = element("div", "xmlg-meta");
    const badge = element("div", "xmlg-node-badge");
    const badgeSwatch = element("span", "xmlg-node-badge-swatch");
    const badgeChip = element("span", "xmlg-node-badge-chip", "--");
    badge.appendChild(badgeSwatch);
    badge.appendChild(badgeChip);
    const kindEmoji = element("span", "xmlg-kind-emoji", "🗂️");
    kindEmoji.setAttribute("aria-hidden", "true");
    meta.appendChild(badge);
    meta.appendChild(kindEmoji);

    const tabs = element("div", "xmlg-tabs");
    const tabButtons = {};
    for (const category of CATEGORIES) {
        const button = element("button", "xmlg-tab");
        button.type = "button";
        button.dataset.category = category;
        const label = element("span", "xmlg-tab-label");
        const count = element("span", "xmlg-tab-count", "0");
        const progress = element("span", "xmlg-tab-progress");
        button.appendChild(label);
        button.appendChild(count);
        button.appendChild(progress);
        tabs.appendChild(button);
        tabButtons[category] = { button, label, count, progress };
    }

    const toolbar = element("div", "xmlg-toolbar");
    const undoButton = element("button", "xmlg-btn", "↶");
    undoButton.type = "button";
    undoButton.disabled = true;
    const redoButton = element("button", "xmlg-btn", "↷");
    redoButton.type = "button";
    redoButton.disabled = true;
    const toolbarLeft = element("div", "xmlg-toolbar-left");
    toolbarLeft.appendChild(undoButton);
    toolbarLeft.appendChild(redoButton);

    const warningToggle = element("label", "xmlg-toggle xmlg-switch");
    const warningInput = document.createElement("input");
    warningInput.type = "checkbox";
    warningInput.checked = true;
    const warningTrack = element("span", "xmlg-switch-track");
    warningTrack.setAttribute("aria-hidden", "true");
    const warningText = element("span", "xmlg-toggle-text");
    warningToggle.appendChild(warningInput);
    warningToggle.appendChild(warningTrack);
    warningToggle.appendChild(warningText);
    bindHint(warningToggle, () => t(
        "xdatahub.ui.node.xmedialistget.type_warning_tooltip",
        "Flag a connection when a file here doesn't match the port"
    ));
    const toolbarRight = element("div", "xmlg-toolbar-right");
    toolbarRight.appendChild(warningToggle);
    toolbar.appendChild(toolbarLeft);
    toolbar.appendChild(toolbarRight);

    const listToolbar = element("div", "xmlg-list-toolbar");
    const refreshButton = element("button", "xmlg-btn", "↻");
    refreshButton.type = "button";
    const enableAllButton = element("button", "xmlg-btn", "✔");
    enableAllButton.type = "button";
    const disableAllButton = element("button", "xmlg-btn", "✖");
    disableAllButton.type = "button";
    const invertButton = element("button", "xmlg-btn", "⇄");
    invertButton.type = "button";
    // 范围胶囊：✔ ✖ ⇄ 这次动「文件（未分组）/ 全部 / 分组」——三档互斥
    const scopeControl = element("div", "xmlg-scope");
    scopeControl.setAttribute("role", "group");
    bindHint(scopeControl, () => t(
        "xdatahub.ui.node.xmedialistget.scope_tooltip",
        "Which files the three buttons on the right act on"
    ));
    const scopeButtons = new Map();
    for (const mode of ENABLE_SCOPES) {
        const button = element("button", "xmlg-scope-btn", scopeLabel(mode));
        button.type = "button";
        button.dataset.scope = mode;
        bindHint(button, () => scopeTooltip(mode));
        scopeButtons.set(mode, button);
        scopeControl.appendChild(button);
    }
    // 单击组头后出来的一枚小标签：显示「只作用于哪一组」，点它取消。
    // 它挂在范围胶囊**里面**（见下面的 appendChild），跟「分组」同一根边框，
    // 一眼就看得出「分组 = 组 2」，不会像另起一枚孤立药丸那样分裂。
    const scopeChip = element("button", "xmlg-scope-chip");
    scopeChip.type = "button";
    // 内容包一层：外层用 grid 列宽从 0fr 长到 1fr，宽度就能平滑展开
    // （直接 transition width / max-width 长到内容宽度做不出匀速效果）
    const scopeChipInner = element("span", "xmlg-scope-chip-inner");
    const scopeChipText = element("span", "xmlg-scope-chip-text", "");
    scopeChipInner.appendChild(scopeChipText);
    scopeChipInner.appendChild(element("span", "xmlg-scope-chip-close", "✕"));
    scopeChip.appendChild(scopeChipInner);
    // 提示文案由 syncScopeUi 现算现存在这里：这个函数拿不到 node，
    // 直接闭包读 node 会报错，而提示又要跟着当前选中的组走。
    bindHint(scopeChip, () => scopeChip.__xmlg_hint || "");
    const status = element("div", "xmlg-status", "—");
    const groupButton = element("button", "xmlg-btn xmlg-group-btn", "＋");
    groupButton.type = "button";
    bindHint(groupButton, () => t(
        "xdatahub.ui.node.xmedialistget.new_group_tooltip",
        "Create a group from the selected files that aren't in one yet."
    ));
    // 顺序：刷新 → 创建分组 → ✔ ✖ ⇄ → 范围胶囊（组标签长在里面）→ 状态。
    // 范围胶囊是唯一会「变宽」的东西（选出某一组时冒出组号），
    // 所以它必须排在所有按钮**之后**：变宽只会挤到右边那行状态文字，
    // 谁都不会在手指点到一半时自己挪位置。
    listToolbar.appendChild(refreshButton);
    listToolbar.appendChild(element("span", "xmlg-toolbar-divider"));
    listToolbar.appendChild(groupButton);
    listToolbar.appendChild(element("span", "xmlg-toolbar-divider"));
    listToolbar.appendChild(enableAllButton);
    listToolbar.appendChild(disableAllButton);
    listToolbar.appendChild(invertButton);
    listToolbar.appendChild(scopeControl);
    // 组标签是范围胶囊的最后一段
    scopeControl.appendChild(scopeChip);

    const list = element("div", "xmlg-list");
    const overlay = element("div", "xmlg-overlay");
    const overlayIcon = element("div", "xmlg-overlay-icon", "⚠");
    const overlayTitle = element("div", "xmlg-overlay-title");
    const overlayHint = element("div", "xmlg-overlay-hint");
    overlay.appendChild(overlayIcon);
    overlay.appendChild(overlayTitle);
    overlay.appendChild(overlayHint);
    const insertLine = element("div", "xmlg-insert-line");
    const dropLabel = element("div", "xmlg-drop-label");
    const empty = element("div", "xmlg-empty", "");
    const toast = element("div", "xmlg-toast");
    list.appendChild(insertLine);
    list.appendChild(dropLabel);
    list.appendChild(empty);

    // 遮罩和 toast 放在滚动容器外层，只覆盖列表可见区域，
    // 不会随列表内容一起滚走。
    const listViewport = element("div", "xmlg-list-viewport");
    listViewport.appendChild(list);
    listViewport.appendChild(overlay);
    listViewport.appendChild(toast);

    // 底栏只剩「共 N 个文件」和「清空本分类」：页码、上一页 /
    // 下一页、每页条数都随分页一起退场了。
    const pager = element("div", "xmlg-pager");
    // 两个数字并排：「共 N 个文件」和「已启用 X / 50」中间隔一条细线，
    // 免得两个数字粘在一起分不清谁是谁
    const pagerInfo = element("div", "xmlg-pager-info");
    const total = element("span", "xmlg-total", "");
    const pagerDivider = element("span", "xmlg-pager-divider");
    const clearButton = element("button", "xmlg-btn xmlg-pager-clear", "🗑️");
    clearButton.type = "button";
    pagerInfo.appendChild(total);
    pagerInfo.appendChild(pagerDivider);
    pagerInfo.appendChild(status);
    pager.appendChild(pagerInfo);
    pager.appendChild(clearButton);

    const listShell = element("div", "xmlg-list-shell");
    listShell.appendChild(listToolbar);
    listShell.appendChild(listViewport);
    listShell.appendChild(pager);

    panel.appendChild(meta);
    panel.appendChild(tabs);
    panel.appendChild(toolbar);
    panel.appendChild(listShell);

    const tooltip = element("div", "xmlg-tooltip");
    const tooltipMedia = element("div", "xmlg-tooltip-media");
    const tooltipName = element("div", "xmlg-tooltip-name");
    tooltip.appendChild(tooltipMedia);
    tooltip.appendChild(tooltipName);
    document.body.appendChild(tooltip);

    return {
        badge,
        badgeSwatch,
        badgeChip,
        kindEmoji,
        panel,
        tabs,
        tabButtons,
        refreshButton,
        scopeControl,
        scopeButtons,
        scopeChip,
        scopeChipText,
        enableAllButton,
        disableAllButton,
        invertButton,
        groupButton,
        undoButton,
        redoButton,
        warningToggle,
        warningInput,
        warningText,
        clearButton,
        status,
        listToolbar,
        list,
        overlay,
        overlayTitle,
        overlayHint,
        insertLine,
        dropLabel,
        empty,
        toast,
        total,
        tooltip,
        tooltipMedia,
        tooltipName,
    };
}

function showToast(node, message, options = {}) {
    const panel = node?.__xmlg_panel;
    if (!panel || !message) {
        return;
    }
    panel.toast.textContent = message;
    panel.toast.classList.toggle("is-warning", !!options.warning);
    panel.toast.classList.add("is-visible");
    if (panel.state.toastTimer) {
        clearTimeout(panel.state.toastTimer);
    }
    panel.state.toastTimer = window.setTimeout(() => {
        panel.toast.classList.remove("is-visible");
        panel.state.toastTimer = 0;
    }, TOAST_DURATION_MS);
}

function buildPreviewFallback() {
    const fallback = element("div", "xmlg-tooltip-fallback");
    fallback.appendChild(
        element(
            "span",
            "xmlg-tooltip-fallback-label",
            t(
                "xdatahub.ui.node.xmedialistget.no_preview",
                "No preview"
            )
        )
    );
    return fallback;
}

function buildThumb(category, ref) {
    if (category === "audio") {
        const icon = element("span", null, "♪");
        bindHint(icon, "audio");
        return icon;
    }
    const url = `/xz3r0/xdatahub/media/thumb?ref=${
        encodeURIComponent(ref)
    }&size=${THUMB_SIZE}`;
    const image = document.createElement("img");
    image.loading = "lazy";
    image.decoding = "async";
    image.alt = "";
    image.src = url;
    image.addEventListener("error", () => {
        if (category === "video" && image.dataset.fallback !== "1") {
            image.dataset.fallback = "1";
            const video = document.createElement("video");
            video.preload = "metadata";
            video.muted = true;
            video.playsInline = true;
            video.src = `/xz3r0/xdatahub/media/file?ref=${
                encodeURIComponent(ref)
            }#t=0.1`;
            video.addEventListener("error", () => {
                const fallback = element("span", null, "🎬");
                bindHint(fallback, () => t(
                    "xdatahub.ui.node.xmedialistget.no_preview",
                    "No preview"
                ));
                video.replaceWith(fallback);
            });
            image.replaceWith(video);
            return;
        }
        image.classList.add("is-missing");
        const node = image.closest(".xmlg-row");
        if (node) {
            node.classList.add("is-missing");
        }
    });
    return image;
}

/** 色号 → CSS 颜色（每一项都自带兜底色，主题变量没加载也不会变透明）。 */
function groupColorValue(colorId) {
    const picked = GROUP_COLORS.find((item) => item.id === colorId);
    return picked ? picked.value : "";
}

/**
 * 组当前用的是哪个色号：用户选过就用选的，没选过按组 id 哈希挑一个。
 * 传组记录或组 id 都行（老调用点只给 id）。
 */
function groupColorId(group) {
    const record = group && typeof group === "object" ? group : null;
    if (record && groupColorValue(record.color)) {
        return record.color;
    }
    const text = String(record ? record.id : group || "");
    let hash = 0;
    for (let index = 0; index < text.length; index += 1) {
        hash = (hash * 31 + text.charCodeAt(index)) >>> 0;
    }
    return GROUP_COLORS[hash % GROUP_COLORS.length].id;
}

/** 组色带的 CSS 颜色。 */
function groupStripeColor(group) {
    return groupColorValue(groupColorId(group));
}

/* 列表重建时把已经不存在的行从选择里剔掉。 */
function pruneSelection(state, items) {
    const alive = new Set((items || []).map((entry) => XMLG_KEY_OF(entry)));
    for (const key of Array.from(state.selection || [])) {
        if (!alive.has(key)) {
            state.selection.delete(key);
        }
    }
    if (!state.selection.size) {
        state.selectionAnchor = null;
        return;
    }
    if (
        state.selectionAnchor == null
        || state.selectionAnchor >= items.length
    ) {
        state.selectionAnchor = Math.max(0, items.length - 1);
    }
}

/**
 * 行的选择：普通点击选一个，Ctrl/Cmd 加选，Shift 连选一段。
 *
 * 选择只用于「成组」，拖动永远是单行 —— 不然拖一行动了一整批
 * 会变成新的惊吓源。
 */
function handleRowSelection(node, category, key, index, event) {
    const state = node?.__xmlg_panel?.state;
    if (!state) {
        return;
    }
    const additive = event.ctrlKey || event.metaKey;
    const items = state.items[category] || [];
    if (
        event.shiftKey
        && Number.isFinite(state.selectionAnchor)
    ) {
        const start = Math.min(state.selectionAnchor, index);
        const end = Math.max(state.selectionAnchor, index);
        if (!additive) {
            state.selection.clear();
        }
        for (let cursor = start; cursor <= end; cursor += 1) {
            const entry = items[cursor];
            if (entry) {
                state.selection.add(XMLG_KEY_OF(entry));
            }
        }
    } else if (additive) {
        if (state.selection.has(key)) {
            state.selection.delete(key);
        } else {
            state.selection.add(key);
        }
        state.selectionAnchor = index;
    } else {
        const alreadyOnly = state.selection.size === 1
            && state.selection.has(key);
        state.selection.clear();
        if (!alreadyOnly) {
            state.selection.add(key);
        }
        state.selectionAnchor = index;
    }
    renderPanel(node);
}

/** 把当前选中的文件合成一个组（默认名「组 N」）。 */
/**
 * 选中的文件里，还没有加入任何分组的那些。
 *
 * 「创建分组」只服务于未分组的文件：已经在组里的文件再去建组，
 * 等于把它从原来的组里拽出来，用户不会预料到这一点 —— 想换组
 * 应该用拖动（拖到别的组的地盘上），而不是重新建一个组。
 */
function ungroupedSelection(state, category) {
    const list = state?.items?.[category] || [];
    const picked = [];
    for (const entry of list) {
        if (entry.group) {
            continue;
        }
        if (state.selection.has(XMLG_KEY_OF(entry))) {
            picked.push(XMLG_KEY_OF(entry));
        }
    }
    return picked;
}

function createGroupFromCurrentSelection(node) {
    const panel = node?.__xmlg_panel;
    if (!panel) {
        return;
    }
    const state = panel.state;
    const category = state.category;
    if (!state.selection.size) {
        return;
    }
    const available = ungroupedSelection(state, category);
    if (!available.length) {
        // 选中的全都在组里：不动它们，也不造出空组
        showToast(
            node,
            t(
                "xdatahub.ui.node.xmedialistget.group_all_selected_grouped",
                "Those files are already in groups. Only files without a group can start a new one.",
            ),
            { warning: true }
        );
        return;
    }
    const skipped = state.selection.size - available.length;
    const items = state.items;
    const groups = items.groups?.[category] || [];
    // 号不回收（删了组再建新的，号继续往后走），名字跟着号走
    const seq = nextGroupSeq(groups);
    const name = defaultGroupName(seq, groups);
    const result = createGroupFromSelection(
        items[category] || [],
        groups,
        available,
        name,
        { keyOf: XMLG_KEY_OF }
    );
    if (!result.id) {
        return;
    }
    items[category] = result.items;
    items.groups[category] = result.groups;
    state.selection.clear();
    state.selectionAnchor = null;
    writeItems(node, items, { dissolved: result.dissolved });
    renderPanel(node);
    // 建完直接进改名状态：名字天生是「组 N」，让用户顺手改掉
    beginGroupRename(node, result.id);
    scrollRowIntoView(node, Math.max(0, (result.insertAt || 0)));
    if (skipped > 0) {
        // 混选时明确告诉用户「有几个没算进去」，避免以为全都建进去了
        showToast(
            node,
            t(
                "xdatahub.ui.node.xmedialistget.group_skipped_grouped",
                "Skipped {count} files that are already in a group",
                { count: skipped }
            ),
            { warning: true }
        );
    }
}

function startGroupRename(node, category, groupId, head, nameEl) {
    if (!head || head.querySelector(".xmlg-group-name-input")) {
        return;
    }
    const groups = node?.__xmlg_panel?.state?.items?.groups?.[category];
    const record = (groups || []).find((item) => item.id === groupId);
    const input = document.createElement("input");
    input.type = "text";
    input.className = "xmlg-group-name-input";
    input.value = String(record?.name || "");
    nameEl.style.display = "none";
    // 名字现在包在胶囊里，输入框要插到同一层，别把胶囊撑坏
    nameEl.parentElement.insertBefore(input, nameEl);
    input.focus();
    input.select();
    let finished = false;
    const finish = (commit) => {
        if (finished) {
            return;
        }
        finished = true;
        const value = input.value.trim();
        // 列表重画时输入框可能已经被一起拆掉了，这里要容错：
        // 对着已经离开文档的节点再动一下会抛「不是子节点」的错
        if (input.parentElement) {
            input.remove();
        }
        if (nameEl.isConnected) {
            nameEl.style.display = "";
        }
        if (commit) {
            applyGroupRename(node, category, groupId, value);
        }
    };
    input.addEventListener("keydown", (event) => {
        // 不能把按键漏给画布（否则输入空格时画布可能吃到快捷键）
        event.stopPropagation();
        if (event.key === "Enter") {
            event.preventDefault();
            finish(true);
        } else if (event.key === "Escape") {
            event.preventDefault();
            finish(false);
        }
    });
    input.addEventListener("blur", () => finish(true));
}

/** 给组头找到改名入口（建组后直接用）。 */
function beginGroupRename(node, groupId) {
    const panel = node?.__xmlg_panel;
    if (!panel || !groupId) {
        return;
    }
    const head = panel.list.querySelector(
        `.xmlg-group-head[data-group-id="${groupId}"]`
    );
    const nameEl = head?.querySelector(".xmlg-group-name");
    if (!head || !nameEl) {
        return;
    }
    startGroupRename(node, panel.state.category, groupId, head, nameEl);
}

function applyGroupRename(node, category, groupId, value) {
    const panel = node?.__xmlg_panel;
    if (!panel) {
        return;
    }
    const items = panel.state.items;
    const groups = items.groups?.[category] || [];
    const record = groups.find((item) => item.id === groupId);
    const next = String(value || "").trim();
    // 空名字不接受：组名不能是空白，保留原名重画
    if (!record || !next || next === record.name) {
        renderPanel(node);
        return;
    }
    items.groups[category] = renameGroup(groups, groupId, next);
    writeItems(node, items);
    renderPanel(node);
}

/** 这一组现在在列表里露出来的成员行（折叠组返回空数组）。 */
function groupMemberRowElements(list, groupId) {
    if (!list || !groupId) {
        return [];
    }
    // 行身上带着 data-group，拖动时也是靠它找「这一组还剩哪些可见行」
    return [...list.querySelectorAll(`.xmlg-row[data-group="${groupId}"]`)];
}

/**
 * 折叠前的收拢：把这组的成员行压到 0 高度、竖线缩到只剩组头。
 * 只改样式不碰数据——数据要等动画放完再改（见 commitGroupCollapsed），
 * 否则行会「啪」一下直接消失，白动画了。
 *
 * 返回 false 表示没东西可收（已经是折叠状态），调用方直接提交数据。
 */
function foldGroupRowsOut(panel, groupId) {
    const list = panel?.list;
    const rows = groupMemberRowElements(list, groupId);
    if (!rows.length) {
        return false;
    }
    // 先把当前高度钉死，过渡才有起点（高度是 auto 的没得算）
    for (const row of rows) {
        row.style.height = `${row.offsetHeight}px`;
        row.style.overflow = "hidden";
        row.style.pointerEvents = "none";
    }
    // 强制一次重排，让「钉死的高度」落到样式里
    void list.offsetHeight;
    for (const row of rows) {
        row.classList.add("is-folding");
        row.style.height = "0px";
        // min-height 是 44px，不清掉的话压不到地板
        row.style.minHeight = "0px";
        row.style.opacity = "0";
        // 列表的行间距是 4px，靠负外边距把这 4px 一起收掉，
        // 不然行都没了还留几道空隙
        row.style.marginTop = "-4px";
        // 上下内边距 + 边框也要收干净，否则行最低只能压到 10px
        row.style.paddingTop = "0px";
        row.style.paddingBottom = "0px";
        row.style.borderTopWidth = "0px";
        row.style.borderBottomWidth = "0px";
    }
    // 折叠状态提前挂到组头上：计数胶囊跟着这 160ms 慢慢长出来。
    // 等动画结束重画时，新组头一出生就是折叠后的样子，两边对得上。
    const head = list.querySelector(
        `.xmlg-group-head[data-group-id="${groupId}"]`
    );
    if (head) {
        head.classList.add("is-collapsed");
    }
    // 这 160ms 里整块列表不接鼠标：行正在收，点到、拖到都没有意义
    list.style.pointerEvents = "none";
    // 所有组的竖线每帧跟着重量（不只是这一组，下面那些组也在一起上移）
    followRailsDuringFold(panel);
    return true;
}

/**
 * 展开时用：重画出来的组头先摆成「折叠时」的样子，但不要动画。
 * 新元素没有「上一版宽度」，直接给它撑到折叠时的上限，长开那一步再
 * 交还给 CSS 过渡——计数胶囊才会跟着行一起收走，而不是当场消失。
 */
function seedCollapsedHeadLook(list, groupId) {
    const head = list?.querySelector(
        `.xmlg-group-head[data-group-id="${groupId}"]`
    );
    if (!head) {
        return;
    }
    head.classList.add("is-collapsed");
    const pill = head.querySelector(".xmlg-group-count");
    if (pill) {
        pill.style.transition = "none";
        pill.style.maxWidth = "80px";
    }
}

/**
 * 展开后的放行：行从 0 高度长回原样，竖线早在「长开」那一刻量准了，
 * 所以这 160ms 里不会短一截。
 */
function unfoldGroupRowsIn(panel, groupId, targetScrollTop = NaN) {
    const list = panel?.list;
    const rows = groupMemberRowElements(list, groupId);
    if (!rows.length) {
        panel.foldBusy = false;
        return;
    }
    // 此刻行还是正常高度：先记下目标高度，顺便让调用方量的竖线算准
    const heights = rows.map((row) => row.offsetHeight);
    const savedScrollTop = Number.isFinite(targetScrollTop)
        ? targetScrollTop
        : list.scrollTop;
    // 重画出来的组头是「展开后」的样子，可用户刚看到的是折叠后的样子
    // （上面挂着计数胶囊）。先按折叠的样子摆回去，长开时再交还给 CSS
    // 过渡，胶囊就会跟着行一起收走，而不是当场消失。
    seedCollapsedHeadLook(list, groupId);
    // 从这里就开始跟：压扁的那两帧里这一组的竖线也得先缩下来
    followRailsDuringFold(panel);
    for (const row of rows) {
        row.style.height = "0px";
        row.style.minHeight = "0px";
        row.style.overflow = "hidden";
        row.style.opacity = "0";
        row.style.marginTop = "-4px";
        row.style.paddingTop = "0px";
        row.style.paddingBottom = "0px";
        row.style.borderTopWidth = "0px";
        row.style.borderBottomWidth = "0px";
        row.style.pointerEvents = "none";
    }
    // 这几行是刚插进 DOM 的：同一次任务里把高度改两遍，浏览器不会补
    // 过渡（元素还没算过一版样式）。等下一帧、让「压扁」这版样式真正
    // 算过一次之后再长开，才会看到从 0 拉起来的那 160ms。
    window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
            growGroupRowsIn(panel, list, rows, heights, savedScrollTop);
        });
    });
}

/** 收放动画的后半段：行从 0 长回原样，再把临时样式清干净。 */
function growGroupRowsIn(panel, list, rows, heights, savedScrollTop) {
    // 这一帧里列表被重画过（换了分类、刷新了），这几行已经不在页面上了
    if (!list?.isConnected || !rows.every((row) => row.isConnected)) {
        if (panel) {
            panel.foldBusy = false;
        }
        return;
    }

    // 胶囊跟着行一起收：把展开时临时撑起来的宽度交还给 CSS 过渡。
    // 顺序不能反——先撤掉内联样式（恢复过渡），再摘掉折叠态才会动。
    const groupId = rows[0]?.dataset.group || "";
    const head = groupId
        ? list.querySelector(`.xmlg-group-head[data-group-id="${groupId}"]`)
        : null;
    if (head) {
        const pill = head.querySelector(".xmlg-group-count");
        if (pill) {
            pill.style.removeProperty("transition");
            pill.style.removeProperty("max-width");
        }
        head.classList.remove("is-collapsed");
    }
    rows.forEach((row, index) => {
        row.classList.add("is-folding");
        row.style.height = `${heights[index]}px`;
        row.style.opacity = "1";
        row.style.marginTop = "0px";
        // 内边距和边框的交还给 CSS（写回 4px / 1px），跟着一起长回来；
        // min-height 留到最后再还——它一回来就把高度顶到 44px，
        // 过渡还没开始就结束了
        row.style.paddingTop = "";
        row.style.paddingBottom = "";
        row.style.borderTopWidth = "";
        row.style.borderBottomWidth = "";
    });
    window.setTimeout(() => {
        for (const row of rows) {
            if (!row.isConnected) {
                continue;
            }
            row.classList.remove("is-folding");
            for (const prop of [
                "height",
                "min-height",
                "overflow",
                "opacity",
                "margin-top",
                "padding-top",
                "padding-bottom",
                "border-top-width",
                "border-bottom-width",
                "pointer-events",
            ]) {
                row.style.removeProperty(prop);
            }
        }
        // 胶囊的临时宽度也要收干净（动画被打断时可能还留着）
        if (head) {
            const pill = head.querySelector(".xmlg-group-count");
            if (pill) {
                pill.style.removeProperty("transition");
                pill.style.removeProperty("max-width");
            }
        }
        if (panel) {
            panel.foldBusy = false;
        }
        if (!list.isConnected || !panel) {
            return;
        }
        // 行缩到 0 的那一瞬间内容变短了，列表靠底时浏览器会把滚动位置
        // 往回顶；长回原样后把用户原来的位置还回去。
        if (list.scrollTop < savedScrollTop) {
            list.scrollTop = savedScrollTop;
        }
        // 现在高度才是真的，重新量一遍竖线
        panel.railMeasured = false;
        layoutGroupRails(panel);
    }, SLIDE_MS + 40);
}

function setGroupCollapsed(node, category, groupId, collapsed) {
    const panel = node?.__xmlg_panel;
    if (!panel) {
        return;
    }
    // 动画那 160ms 里再点一下，直接不理：免得同时跑两段收放
    if (panel.foldBusy) {
        return;
    }
    const group = panel.state.items.groups?.[category] || [];
    const record = group.find((entry) => entry.id === groupId);
    if (!record || Boolean(record.collapsed) === Boolean(collapsed)) {
        return;
    }
    if (collapsed && foldGroupRowsOut(panel, groupId)) {
        // 收完再改数据重画（160ms）
        panel.foldBusy = true;
        window.setTimeout(() => {
            if (panel.foldBusy) {
                panel.foldBusy = false;
            }
            commitGroupCollapsed(node, category, groupId, true);
        }, SLIDE_MS);
        return;
    }
    commitGroupCollapsed(node, category, groupId, collapsed);
}

/** 真正把「折叠 / 展开」写进数据并重画（动画结束后才调）。 */
function commitGroupCollapsed(node, category, groupId, collapsed) {
    const panel = node?.__xmlg_panel;
    if (!panel) {
        return;
    }
    // 收拢动画期间关掉的鼠标事件，到这里还回来（列表马上要重建，
    // 这行是给「收拢没走动画」那条路兜底的）
    if (panel.list) {
        panel.list.style.pointerEvents = "";
    }
    const items = panel.state.items;
    items.groups[category] = setCollapsed(
        items.groups?.[category] || [],
        groupId,
        collapsed
    );
    writeItems(node, items);
    // 展开时告诉 renderPanel：这一组刚长开，行要做入场动画
    panel.pendingExpand = collapsed ? "" : groupId;
    // 展开的动画在重画之后，结束才放开（见 growGroupRowsIn）
    panel.foldBusy = Boolean(panel.pendingExpand);
    renderPanel(node);
    panel.pendingExpand = "";
}

function closeGroupDialog(node) {
    const panel = node?.__xmlg_panel;
    if (!panel) {
        return;
    }
    panel.modal?.remove();
    panel.modal = null;
}

/**
 * 组设置框：改名、换色、取消组、删除组都放这儿。
 * 组头只留一个入口 —— 一排小按钮在窄面板里挤成一团，还容易误点。
 *
 * 名称/颜色是「即改即生效」（带撤销快照），改完框不关；
 * 取消组和删除组会关框，删除组还有一次二次确认。
 */
function openGroupSettingsDialog(node, category, entry) {
    const panel = node?.__xmlg_panel;
    if (!panel) {
        return;
    }
    closeGroupDialog(node);
    const groupId = entry.groupId;
    const group = entry.group;
    const count = entry.memberCount;
    const modal = element("div", "xmlg-modal");
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    const card = element("div", "xmlg-modal-card");
    card.appendChild(element(
        "div",
        "xmlg-modal-title",
        t(
            "xdatahub.ui.node.xmedialistget.group_settings_title",
            "Group settings"
        )
    ));

    const nameField = element("label", "xmlg-modal-field");
    nameField.appendChild(element(
        "span",
        "xmlg-modal-label",
        t("xdatahub.ui.node.xmedialistget.group_name_label", "Name")
    ));
    const input = document.createElement("input");
    input.type = "text";
    input.className = "xmlg-modal-input";
    input.maxLength = 60;
    input.value = String(group.name || groupId);
    input.addEventListener("keydown", (event) => {
        // 按键不能漏给画布（空格/方向键会被当成快捷键）
        event.stopPropagation();
        if (event.key === "Escape") {
            event.preventDefault();
            closeGroupDialog(node);
            return;
        }
        if (event.key === "Enter") {
            event.preventDefault();
            input.blur();
        }
    });
    input.addEventListener("change", () => {
        applyGroupRename(node, category, groupId, input.value);
        // 空名字不收：重画后把框里的内容拉回真名，别让用户以为改成功了
        const live = groupRecord(node, category, groupId);
        input.value = String(live?.name || groupId);
    });
    nameField.appendChild(input);
    card.appendChild(nameField);

    const colorField = element("div", "xmlg-modal-field");
    colorField.appendChild(element(
        "span",
        "xmlg-modal-label",
        t("xdatahub.ui.node.xmedialistget.group_color_label", "Color")
    ));
    const swatches = element("div", "xmlg-swatches");
    const activeId = groupColorId(groupRecord(node, category, groupId) || group);
    for (const color of GROUP_COLORS) {
        const swatch = element("button", "xmlg-swatch");
        swatch.type = "button";
        swatch.dataset.color = color.id;
        swatch.style.setProperty("--xmlg-swatch", groupColorValue(color.id));
        const label = t(
            `xdatahub.ui.node.xmedialistget.${color.nameKey}`,
            color.fallback
        );
        swatch.setAttribute("aria-label", label);
        swatch.setAttribute("aria-pressed", String(color.id === activeId));
        bindHint(swatch, () => label);
        if (color.id === activeId) {
            swatch.classList.add("is-active");
        }
        swatch.addEventListener("click", () => {
            applyGroupColor(node, category, groupId, color.id);
            for (const other of swatches.children) {
                const picked = other === swatch;
                other.classList.toggle("is-active", picked);
                other.setAttribute("aria-pressed", String(picked));
            }
        });
        swatches.appendChild(swatch);
    }
    colorField.appendChild(swatches);
    card.appendChild(colorField);

    card.appendChild(element(
        "div",
        "xmlg-modal-text",
        t(
            "xdatahub.ui.node.xmedialistget.group_delete_hint",
            "This group holds {count} files. Decide what happens to them.",
            { count }
        )
    ));

    // 按钮只写短标签（长句子会换行、按钮忽高忽低）；
    // 「点了会怎样」放到悬停提示里，想弄清的人一秒就能看到。
    const keepButton = element(
        "button",
        "xmlg-modal-btn",
        t(
            "xdatahub.ui.node.xmedialistget.group_delete_keep",
            "Dissolve group"
        )
    );
    keepButton.type = "button";
    bindHint(keepButton, () => t(
        "xdatahub.ui.node.xmedialistget.group_delete_keep_hint",
        "The {count} files stay right where they are, just without a group.",
        { count }
    ));
    keepButton.addEventListener("click", () => {
        closeGroupDialog(node);
        applyGroupDelete(node, category, groupId, "ungroup");
    });

    const wipeButton = element(
        "button",
        "xmlg-modal-btn is-danger",
        t(
            "xdatahub.ui.node.xmedialistget.group_delete_files",
            "Remove group and files from list"
        )
    );
    wipeButton.type = "button";
    bindHint(wipeButton, () => t(
        "xdatahub.ui.node.xmedialistget.group_delete_files_hint",
        "The group and its {count} files leave this list. The files "
            + "themselves stay on disk.",
        { count }
    ));
    wipeButton.addEventListener("click", () => {
        const message = t(
            "xdatahub.ui.node.xmedialistget.group_delete_confirm",
            "Remove {count} files from the list for good?",
            { count }
        );
        if (!window.confirm(message)) {
            return;
        }
        closeGroupDialog(node);
        applyGroupDelete(node, category, groupId, "delete");
    });

    const doneButton = element(
        "button",
        "xmlg-modal-btn",
        t("xdatahub.ui.node.xmedialistget.group_done", "Done")
    );
    doneButton.type = "button";
    doneButton.addEventListener("click", () => closeGroupDialog(node));

    const actions = element("div", "xmlg-modal-actions");
    actions.appendChild(keepButton);
    actions.appendChild(wipeButton);
    actions.appendChild(doneButton);
    card.appendChild(actions);
    modal.appendChild(card);
    modal.addEventListener("click", (event) => {
        if (event.target === modal) {
            closeGroupDialog(node);
        }
    });
    modal.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
            event.preventDefault();
            closeGroupDialog(node);
        }
    });
    panel.panel.appendChild(modal);
    panel.modal = modal;
    // 焦点给名称框：破坏性按钮永远不能被回车顺手点到
    input.focus();
    input.select();
}

/** 取当前组记录（每次现查，弹框开着时列表可能已经重画过）。 */
function groupRecord(node, category, groupId) {
    const state = node?.__xmlg_panel?.state;
    const groups = state?.items?.groups?.[category] || [];
    return groups.find((item) => item.id === groupId) || null;
}

/** 换组颜色：写回组记录，色带立刻跟着变。 */
function applyGroupColor(node, category, groupId, colorId) {
    const panel = node?.__xmlg_panel;
    if (!panel) {
        return;
    }
    const items = panel.state.items;
    const groups = items.groups?.[category] || [];
    if (!groups.some((item) => item.id === groupId)) {
        return;
    }
    items.groups[category] = groups.map((item) => (
        item.id === groupId ? { ...item, color: colorId } : item
    ));
    writeItems(node, items);
    renderPanel(node);
}

function applyGroupDelete(node, category, groupId, mode) {
    const panel = node?.__xmlg_panel;
    if (!panel) {
        return;
    }
    const items = panel.state.items;
    const result = deleteGroup(
        items[category] || [],
        items.groups?.[category] || [],
        groupId,
        mode
    );
    items[category] = result.items;
    items.groups[category] = result.groups;
    const alive = new Set(result.items.map((entry) => XMLG_KEY_OF(entry)));
    for (const key of Array.from(panel.state.selection)) {
        if (!alive.has(key)) {
            panel.state.selection.delete(key);
        }
    }
    writeItems(node, items);
    renderPanel(node);
    showToast(
        node,
        mode === "delete"
            ? t(
                "xdatahub.ui.node.xmedialistget.group_files_deleted",
                "Removed a group and {count} files from the list",
                { count: result.removed }
            )
            : t(
                "xdatahub.ui.node.xmedialistget.group_ungrouped",
                "Moved {count} files out of the group",
                { count: result.removed }
            ),
        { warning: mode === "delete" }
    );
}

/**
 * 删掉某组最后一个成员时，组会跟着消失。删文件本身不可逆，所以这里
 * 必须停下来问一句 —— 否则用户只看到「文件没了，组头也没了」。
 * 拖出最后一个成员不做拦截（拖拽可逆，且有 toast 提示）。
 */
function confirmRemovingGroupMember(node, category, entry) {
    const state = node?.__xmlg_panel?.state;
    if (!state || !entry?.group) {
        return true;
    }
    const members = groupMembers(state.items[category] || [], entry.group);
    if (members.length > 1) {
        return true;
    }
    const groups = state.items.groups?.[category] || [];
    const record = groups.find((item) => item.id === entry.group);
    return window.confirm(t(
        "xdatahub.ui.node.xmedialistget.group_will_dissolve",
        "This is the last file in group {name}. Removing it also removes the group. Continue?",
        { name: record?.name || entry.group }
    ));
}

/** 折叠组胶囊上的数字：「已启用 / 总数」，和底部那条 Enabled 统计同一个读法。 */
/**
 * 新建组的默认名字池：先短后长，够用一辈子。
 *
 * 为什么不用「组 N」：那是把一句中文（或一句英文）**存进工作流数据**，
 * 换个语言界面就变成另一种文字。这些代号是全球通用的词，中英一模一样，
 * 存下来永远是同一个词，用户也不用先打字才能有个名字。
 *
 * 三层设计：
 *   1~26 号   NATO 代号（Alpha…Zulu）——短、好认，像行业默认值；
 *   27 号起   两个常见词拼起来（Amber Falcon、Brave Otter）——
 *             32 × 32 = 1024 个，越用越长但不会越用越生僻；
 *   全用完了   才退回「组 1150」这种（现实中到不了）。
 *
 * 名字由**序号**算出来，不是随机抽：同一号永远是同一个名字，
 * 删组、重排、刷新都不会变。
 */
const PRESET_GROUP_NAMES = [
    "Alpha",
    "Bravo",
    "Charlie",
    "Delta",
    "Echo",
    "Foxtrot",
    "Golf",
    "Hotel",
    "India",
    "Juliet",
    "Kilo",
    "Lima",
    "Mike",
    "November",
    "Oscar",
    "Papa",
    "Quebec",
    "Romeo",
    "Sierra",
    "Tango",
    "Uniform",
    "Victor",
    "Whiskey",
    "Xray",
    "Yankee",
    "Zulu",
];

/** 组合名的前半：形容词（都短、都好念，不跟后半重词）。 */
const PRESET_GROUP_ADJECTIVES = [
    "Amber",
    "Brave",
    "Calm",
    "Clever",
    "Cosmic",
    "Crisp",
    "Dapper",
    "Dusty",
    "Eager",
    "Gentle",
    "Golden",
    "Hazy",
    "Humble",
    "Jolly",
    "Keen",
    "Lucky",
    "Mellow",
    "Merry",
    "Nimble",
    "Plucky",
    "Quiet",
    "Rapid",
    "Rustic",
    "Silent",
    "Silver",
    "Sunny",
    "Swift",
    "Velvet",
    "Wandering",
    "Wild",
    "Witty",
    "Zesty",
];

/** 组合名的后半：具体的东西（看得见摸得着，比抽象词好记）。 */
const PRESET_GROUP_NOUNS = [
    "Anchor",
    "Badger",
    "Beacon",
    "Bison",
    "Canyon",
    "Cedar",
    "Comet",
    "Cove",
    "Dolphin",
    "Ember",
    "Falcon",
    "Fern",
    "Glacier",
    "Harbor",
    "Heron",
    "Lantern",
    "Maple",
    "Meadow",
    "Orchid",
    "Otter",
    "Panda",
    "Pebble",
    "Pine",
    "Raven",
    "River",
    "Sparrow",
    "Summit",
    "Thistle",
    "Tide",
    "Valley",
    "Willow",
    "Wren",
];

/** 名字池总容量：NATO + 形容词 × 名词。 */
const PRESET_GROUP_NAME_COUNT = PRESET_GROUP_NAMES.length
    + PRESET_GROUP_ADJECTIVES.length * PRESET_GROUP_NOUNS.length;

/**
 * 第 index 个（0 开始）预设名。超出池子返回空串。
 *
 * 组合名像里程表，**后半（名词）先换**：相邻两个名字看着差别大
 * （`Amber Falcon` → `Amber Otter`），不会一连几十个都长得一样。
 */
function presetGroupNameAt(index) {
    if (index < 0 || index >= PRESET_GROUP_NAME_COUNT) {
        return "";
    }
    if (index < PRESET_GROUP_NAMES.length) {
        return PRESET_GROUP_NAMES[index];
    }
    const rest = index - PRESET_GROUP_NAMES.length;
    const adjectives = PRESET_GROUP_ADJECTIVES;
    const nouns = PRESET_GROUP_NOUNS;
    const adjective = adjectives[Math.floor(rest / nouns.length) % adjectives.length];
    const noun = nouns[rest % nouns.length];
    return `${adjective} ${noun}`;
}

/**
 * 第 seq 个组该叫什么：从序号对应的名字往后找第一个没人用的。
 *
 * 为什么要「避开重名」：用户可能把某组改名成了「Delta」，等号轮到
 * Delta 时就往后顺延，别让两组装同名。
 */
function defaultGroupName(seq, groups = []) {
    const index = Math.trunc(Number(seq)) || 0;
    const taken = new Set(
        (Array.isArray(groups) ? groups : [])
            .map((group) => String(group?.name || "").trim().toLowerCase())
            .filter(Boolean)
    );
    for (
        let cursor = Math.max(0, index - 1);
        cursor < PRESET_GROUP_NAME_COUNT;
        cursor += 1
    ) {
        const preset = presetGroupNameAt(cursor);
        if (preset && !taken.has(preset.toLowerCase())) {
            return preset;
        }
    }
    return t(
        "xdatahub.ui.node.xmedialistget.group_default_name",
        "Group {index}",
        { index }
    );
}

/** 界面上指代某一组只用序列号：「组 3」。名字只在本组头里显示。 */
/**
 * 光秃秃的序列号：「12」。
 *
 * 工具栏里那枚标签只用号、不带「组 / Group」：那个词在英文界面里
 * 会把标签撑长一倍（"Group 12"），而且它紧挨着「分组」那段，
 * 意思已经够清楚了。需要成句说的地方（提示、toast）用下面的 label。
 */
function groupSeqNumber(record) {
    const seq = Number(record && record.seq) || 0;
    return seq ? String(seq) : "";
}

/** 成句的称呼：「组 12 / Group 12」，给提示和 toast 用。 */
function groupSeqLabel(record) {
    const seq = Number(record && record.seq) || 0;
    if (!seq) {
        // 极端情况（旧数据还没补号）：退回 id，也不会是用户的长名字
        return String((record && record.id) || "");
    }
    return t(
        "xdatahub.ui.node.xmedialistget.group_default_name",
        "Group {index}",
        { index: seq }
    );
}

/** 组头的标题：用户起的名字优先，没名字就用序列号。 */
function groupTitle(record, fallback = "") {
    const name = String((record && record.name) || "").trim();
    return name || groupSeqLabel(record) || fallback;
}

function groupCountText(entry) {
    const members = Array.isArray(entry?.members) ? entry.members : [];
    const total = Number.isFinite(entry?.memberCount)
        ? entry.memberCount
        : members.length;
    const enabled = members.filter(
        (row) => row && row.enabled !== false
    ).length;
    return `${enabled}/${total}`;
}

function buildGroupHead(node, category, entry) {
    const group = entry.group;
    const head = element("div", "xmlg-group-head");
    head.dataset.groupId = entry.groupId;
    head.dataset.category = category;
    // 折叠状态同时挂到组头上：胶囊居中那个计数只在折叠时露出来
    head.classList.toggle("is-collapsed", Boolean(entry.collapsed));
    // 重建出来的组头也要带上「✔ ✖ ⇄ 只作用于这一组」的描边
    head.classList.toggle(
        "is-scope-target",
        (node.__xmlg_panel?.state?.scopeGroup || null) === entry.groupId
    );
    head.style.setProperty(
        "--xmlg-group-stripe",
        groupStripeColor(group)
    );

    // 组头本身就是一个整行贯穿的胶囊：箭头 + 名字 + 计数 + 设置按钮
    const arrow = element("button", "xmlg-group-arrow");
    arrow.type = "button";
    arrow.classList.toggle("is-collapsed", Boolean(entry.collapsed));
    arrow.setAttribute("aria-expanded", String(!entry.collapsed));
    bindHint(arrow, () => (
        entry.collapsed
            ? t("xdatahub.ui.node.xmedialistget.group_expand", "Expand")
            : t("xdatahub.ui.node.xmedialistget.group_collapse", "Collapse")
    ));
    arrow.addEventListener("click", (event) => {
        // 箭头只负责折叠，不参与拖动，也不触发行的选择
        event.stopPropagation();
        setGroupCollapsed(node, category, entry.groupId, !entry.collapsed);
    });
    head.appendChild(arrow);

    // 序列号徽标：常态显示。数字是这一组的身份证，名字只是它的小名；
    // 有了它，工具栏上那句「只作用于组 3」永远对得上号。
    const title = groupTitle(group, entry.groupId);
    const seq = groupSeqOf(group);
    const seqBadge = element("span", "xmlg-group-seq", String(seq || ""));
    seqBadge.classList.toggle("is-hidden", !seq);
    head.appendChild(seqBadge);

    const name = element("span", "xmlg-group-name", title);
    bindHint(name, () => t(
        "xdatahub.ui.node.xmedialistget.group_rename_tooltip",
        "Double-click to rename"
    ));
    name.addEventListener("dblclick", (event) => {
        event.stopPropagation();
        startGroupRename(node, category, entry.groupId, head, name);
    });
    head.appendChild(name);

    // 折叠起来就看不见成员了，把「这一组有几个文件」写在设置按钮左边；
    // 展开时成员都在眼前，这个数字是多余的，所以只在折叠时显示。
    const count = element(
        "span",
        "xmlg-group-count",
        groupCountText(entry)
    );
    head.appendChild(count);

    // 改名 / 换色 / 取消组 / 删除组都收进这个设置框，组头只留一个入口
    const settings = element(
        "button",
        "xmlg-btn xmlg-group-settings",
        t("xdatahub.ui.node.xmedialistget.group_settings", "Settings")
    );
    settings.type = "button";
    bindHint(settings, () => t(
        "xdatahub.ui.node.xmedialistget.group_settings_tooltip",
        "Rename, recolor, or remove this group"
    ));
    settings.addEventListener("click", (event) => {
        event.stopPropagation();
        openGroupSettingsDialog(node, category, entry);
    });
    head.appendChild(settings);

    // 组头就是「整块的把手」：按住胶囊就能把这一组整摞搬走。
    // 展开组搬的是一整段，折叠组搬的只有组头（成员仍然跟着走）。
    // 和行一样走指针事件（浏览器自带的拖放事件太稀疏，滑不流畅）。
    bindHint(head, () => t(
        "xdatahub.ui.node.xmedialistget.group_drag_tooltip",
        "Drag to move the whole group"
    ));
    head.addEventListener("pointerdown", (event) => {
        // 按在按钮上不算「抓组头」，否则点设置时手一抖就开始拖
        if (event.target?.closest?.("button, input")) {
            return;
        }
        armGroupPointerDrag(node, category, head, entry.groupId, event);
    });
    // 单击（没拖动）= 让 ✔ ✖ ⇄ 只作用于这一组，再点一次取消。
    // 拖完紧跟的那个 click 要吞掉，否则松手会顺手改了范围；
    // 双击（改名）也不能顺带改范围，所以延后一拍再决定。
    let scopeTapTimer = 0;
    head.addEventListener("click", (event) => {
        if (event.target?.closest?.("button, input")) {
            return;
        }
        const state = node?.__xmlg_panel?.state;
        if (!state) {
            return;
        }
        if (
            state.suppressClickUntil
            && performance.now() < state.suppressClickUntil
        ) {
            return;
        }
        if (isPassiveHeadZone(head, event)) {
            return;
        }
        window.clearTimeout(scopeTapTimer);
        scopeTapTimer = window.setTimeout(() => {
            toggleScopeGroup(node, category, entry.groupId);
        }, HEAD_TAP_DELAY_MS);
    });
    // 双击是「改名」，把刚才那一下单击撤销掉。
    // 必须用捕获阶段：名字自己的 dblclick 会 stopPropagation，
    // 冒泡阶段挂的监听根本收不到。
    head.addEventListener("dblclick", () => {
        window.clearTimeout(scopeTapTimer);
    }, true);
    head.addEventListener("dragstart", (event) => {
        event.preventDefault();
    });

    return head;
}

/**
 * 行的 DOM 身份键。
 *
 * 同一个文件允许在列表里出现多次（比如从 XDataHub 把同一个文件拖进来两次）。
 * 只拿 ref 当键的话，第二次出现的那一行根本没被登记，重排时会被当成
 * 「多余节点」删掉——表现就是刚拖进来的那一行凭空消失、位置乱掉，而且
 * 之后再怎么拖都对不上。这里按出现顺序补序号：首次是 ref，之后是 ref#2…
 */
function rowKeyOf(entry, seen) {
    const ref = String(entry?.row?.ref || "");
    const count = (seen.get(ref) || 0) + 1;
    seen.set(ref, count);
    return count > 1 ? `${ref}#${count}` : ref;
}

function buildRow(node, category, entry, index, enabledSeq = 0) {
    const state = node.__xmlg_panel.state;
    const row = element("div", "xmlg-row");
    row.dataset.index = String(index);
    row.dataset.ref = entry.ref;
    row.dataset.category = category;
    // 拖动重排时这个节点会被搬到新位置，行号也跟着变。闭包里不能
    // 留着旧 index，否则开关 / 预览 / 移除会作用到别的一行上。
    const liveIndex = () => {
        const value = Number(row.dataset.index);
        return Number.isFinite(value) ? value : 0;
    };
    if (entry.enabled === false) {
        row.classList.add("is-disabled");
    }
    if (state.missing.has(entry.ref)) {
        row.classList.add("is-missing");
    }
    if (entry.group) {
        // 竖线不画在行上（那样组头和第一行之间会断），由整组一根的
        // .xmlg-group-rail 负责，这里只留「我在哪一组」的标记。
        row.classList.add("is-grouped");
        row.dataset.group = entry.group;
    }
    if (state.selection?.has(XMLG_KEY_OF(entry))) {
        row.classList.add("is-selected");
    }
    // 点行本身 = 选中；开关 / 缩略图 / 按钮有自己的点击行为，不抢。
    row.addEventListener("click", (event) => {
        if (
            event.target?.closest?.(
                "button, input, label, .xmlg-thumb, .xmlg-remove"
            )
        ) {
            return;
        }
        const panelState = node.__xmlg_panel?.state;
        // 刚拖完免不了会来一个 click：这时不能再改选中
        if (
            panelState?.suppressClickUntil
            && performance.now() < panelState.suppressClickUntil
        ) {
            return;
        }
        handleRowSelection(node, category, XMLG_KEY_OF(entry), liveIndex(), event);
    });
    // 列表内排序：按住行就能搬。
    //
    // 这里不用浏览器自带的拖放（draggable + dragstart）：它的 dragover
    // 实测只有 10Hz 上下，行会一顿一顿地跳，做不出「其它行平滑滑开」
    // 的效果。改用指针事件（每帧一次），Chromium 自己的标签条也是这么干的。
    row.addEventListener("pointerdown", (event) => {
        armRowPointerDrag(node, category, row, event);
    });
    // 缩略图之类的元素默认可以被浏览器拖走，那会把我们的指针拖动静悄悄掐断
    row.addEventListener("dragstart", (event) => {
        event.preventDefault();
    });

    const switchLabel = element("label", "xmlg-switch");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = entry.enabled !== false;
    bindHint(switchLabel, () => (
        checkbox.checked
            ? t("xdatahub.ui.node.xmedialistget.enabled", "Enabled")
            : t("xdatahub.ui.node.xmedialistget.disabled", "Disabled")
    ));
    const track = element("span", "xmlg-switch-track");
    row.__xmlgSwitch = checkbox;
    switchLabel.appendChild(checkbox);
    switchLabel.appendChild(track);
    checkbox.addEventListener("change", () => {
        const result = setEntryEnabled(node, category, entry, checkbox.checked);
        if (result.ok) {
            return;
        }
        checkbox.checked = entry.enabled !== false;
        if (result.reason === "limit") {
            showToast(
                node,
                t(
                    "xdatahub.ui.node.xmedialistget.limit_enable_blocked",
                    "Already {limit} enabled; turn one off first",
                    { limit: MAX_ENABLED }
                )
            );
        }
    });

    const thumb = element("div", "xmlg-thumb");
    if (category === "audio") {
        thumb.classList.add("is-audio");
    }
    thumb.classList.add("is-previewable");
    thumb.setAttribute("role", "button");
    thumb.setAttribute("aria-label", entry.title || entry.ref);
    thumb.tabIndex = 0;
    thumb.appendChild(buildThumb(category, entry.ref));
    const previewHintIcon = element("span", "xmlg-thumb-preview");
    previewHintIcon.setAttribute("aria-hidden", "true");
    previewHintIcon.appendChild(
        element("span", "xmlg-thumb-preview-icon")
    );
    thumb.appendChild(previewHintIcon);
    thumb.addEventListener("mouseenter", (event) => {
        // 拖动中不弹预览：它会跟到光标旁边，把要看的落点整个盖住
        if (event.buttons) {
            return;
        }
        showTooltip(node, event, category, entry);
    });
    thumb.addEventListener("mousemove", (event) => {
        moveTooltip(node, event);
    });
    thumb.addEventListener("mouseleave", () => {
        hideTooltip(node);
    });
    const openPreviewFromRow = () => {
        hideTooltip(node);
        openMediaPreview(node, category, liveIndex());
    };
    thumb.addEventListener("click", (event) => {
        event.stopPropagation();
        openPreviewFromRow();
    });
    thumb.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        openPreviewFromRow();
    });

    const name = element(
        "span",
        "xmlg-name",
        entry.title || entry.ref
    );
    bindHint(name, () => {
        const panelState = node.__xmlg_panel?.state;
        const title = entry.title || entry.ref;
        if (panelState?.missing.has(entry.ref)) {
            return `${
                t(
                    "xdatahub.ui.node.xmedialistget.item_missing",
                    "File is missing"
                )
            }\n${title}`;
        }
        return title;
    });

    const remove = element("button", "xmlg-remove", "✕");
    remove.type = "button";
    bindHint(remove, () => t(
        "xdatahub.ui.node.xmedialistget.remove",
        "Remove"
    ));
    remove.addEventListener("click", (event) => {
        event.stopPropagation();
        const panelState = node.__xmlg_panel?.state;
        if (!panelState) {
            return;
        }
        if (!confirmRemovingGroupMember(node, category, entry)) {
            return;
        }
        panelState.items[category].splice(liveIndex(), 1);
        writeItems(node, panelState.items);
        renderPanel(node);
    });

    const seq = element(
        "span",
        "xmlg-seq",
        enabledSeq > 0 ? String(enabledSeq) : "–"
    );
    // 缓存起来：重排时只需改文字（每行都要重算序号），不必再查一次
    row.__xmlgSeq = seq;
    row.appendChild(seq);
    row.appendChild(switchLabel);
    row.appendChild(thumb);
    row.appendChild(name);
    if (category === "image") {
        const maskButton = element(
            "button",
            "xmlg-btn xmlg-mask-btn"
        );
        maskButton.type = "button";
        const maskEmoji = element("span", "xmlg-mask-emoji", "🖌️");
        maskButton.appendChild(maskEmoji);
        if (entryHasMaskArtifacts(entry)) {
            maskButton.classList.add("is-set");
        }
        bindHint(maskButton, () => entryMaskHintText(entry));
        maskButton.addEventListener("click", (event) => {
            event.stopPropagation();
            openMaskEditorForEntry(node, entry);
        });
        row.appendChild(maskButton);
        row.appendChild(element("span", "xmlg-row-divider"));
    }

    row.appendChild(remove);
    row.appendChild(
        element(
            "span",
            "xmlg-row-hint",
            `↻ ${
                t("xdatahub.ui.node.xmedialistget.replace", "Replace")
            }`
        )
    );
    return row;
}

function showTooltip(node, event, category, entry) {
    const panel = node.__xmlg_panel;
    if (!panel) {
        return;
    }
    const media = panel.tooltipMedia;
    stopTooltipVideo(panel);
    media.innerHTML = "";
    media.classList.toggle("is-audio", category === "audio");
    if (category === "audio") {
        // 音频没有缩略图，直接显示占位，避免请求一次注定失败的图片。
        media.appendChild(buildPreviewFallback());
    } else if (category === "video") {
        const video = document.createElement("video");
        video.muted = true;
        video.playsInline = true;
        video.autoplay = true;
        video.loop = true;
        video.src = `/xz3r0/xdatahub/media/file?ref=${
            encodeURIComponent(entry.ref)
        }`;
        video.addEventListener("error", () => {
            media.innerHTML = "";
            media.appendChild(buildPreviewFallback());
        });
        media.appendChild(video);
    } else {
        const image = document.createElement("img");
        image.src = `/xz3r0/xdatahub/media/thumb?ref=${
            encodeURIComponent(entry.ref)
        }&size=512`;
        image.addEventListener("error", () => {
            media.innerHTML = "";
            media.appendChild(buildPreviewFallback());
        });
        media.appendChild(image);
    }
    panel.tooltipName.textContent = "";
    panel.tooltipName.appendChild(
        element("div", "xmlg-tooltip-name-text", entry.title || entry.ref)
    );
    panel.tooltipName.appendChild(
        element(
            "div",
            "xmlg-tooltip-hint",
            previewText("preview_hint", "Click to preview fullscreen")
        )
    );
    panel.tooltip.classList.add("is-visible");
    moveTooltip(node, event);
}

function moveTooltip(node, event) {
    const panel = node?.__xmlg_panel;
    if (!panel) {
        return;
    }
    const margin = 12;
    const offsetX = 16;
    const offsetY = 26;
    const tooltip = panel.tooltip;
    tooltip.style.left = `${event.clientX + offsetX}px`;
    tooltip.style.top = `${event.clientY + offsetY}px`;
    const rect = tooltip.getBoundingClientRect();
    if (rect.right > window.innerWidth - margin) {
        tooltip.style.left = `${
            window.innerWidth - rect.width - margin
        }px`;
    }
    if (rect.bottom > window.innerHeight - margin) {
        tooltip.style.top = `${
            event.clientY - rect.height - offsetY
        }px`;
    }
}

/**
 * 停掉悬停预览里的视频。
 *
 * 为什么必须手动停：CSS 的 `display:none` **不会**暂停视频，隐藏起来
 * 它还会继续解码、继续播放（静音但照样吃 CPU），换个文件再悬停才会
 * 被新元素顶掉。所以收起预览时要显式 pause + 卸掉播放源。
 */
function stopTooltipVideo(panel) {
    const video = panel?.tooltipMedia?.querySelector("video");
    if (!(video instanceof HTMLVideoElement) || !video.hasAttribute("src")) {
        return;
    }
    try {
        video.pause();
    } catch {
        // 忽略：暂停失败也要继续清理播放源
    }
    video.removeAttribute("src");
    video.load?.();
}

/**
 * 节点被删掉时收尾：tooltip 是挂在 body 上的，不主动摘掉会一直留着。
 */
function disposeNodeUi(node) {
    stopDropAutoScroll(node?.__xmlg_panel?.state);
    closeGroupDialog(node);
    const panel = node?.__xmlg_panel;
    if (!panel) {
        return;
    }
    panel.state?.pointerDrag?.cleanup?.();
    if (panel.state) {
        panel.state.pointerDrag = null;
    }
    panel.railObserver?.disconnect();
    panel.railObserver = null;
    // 让位动画的收尾定时器也要停，否则面板拆了还会去碰已经不在的节点
    window.clearTimeout(panel.slideTimer);
    panel.slideTimer = 0;
    hideTooltip(node);
    panel.tooltip?.remove();
    panel.tooltip = null;
    delete node.__xmlg_panel;
}

function hideTooltip(node) {
    const panel = node?.__xmlg_panel;
    if (!panel) {
        return;
    }
    panel.tooltip?.classList.remove("is-visible");
    stopTooltipVideo(panel);
}

// ── 全屏预览 ────────────────────────────────────────────────────────────

const PREVIEW_ZOOM_STEP = 1.2;
/* 1 = 铺满可用区域（适配屏幕）；允许继续缩小，方便看整体构图。 */
const PREVIEW_ZOOM_MIN = 0.1;
const PREVIEW_ZOOM_MAX = 8;
const PREVIEW_TOAST_MS = 2600;

let activePreview = null;

/**
 * 图片有没有被编辑过：画了遮罩或涂了颜色都算，
 * 这样只涂颜色也能在按钮上看出来。
 */
function entryHasMaskArtifacts(entry) {
    if (!entry) {
        return false;
    }
    return !!(
        String(entry.mask_ref || "").trim()
        || String(entry.paint_ref || "").trim()
    );
}

function entryMaskHintText(entry) {
    if (entry && String(entry.mask_ref || "").trim()) {
        return previewText("mask_set", "Mask set");
    }
    if (entry && String(entry.paint_ref || "").trim()) {
        return previewText("paint_set", "Paint layer set");
    }
    return previewText("edit_mask", "Edit mask");
}

function previewText(key, fallback) {
    return t(`xdatahub.ui.node.xmedialistget.${key}`, fallback);
}

function previewThumbUrl(ref) {
    return `/xz3r0/xdatahub/media/thumb?ref=${
        encodeURIComponent(ref)
    }&size=${THUMB_SIZE}`;
}

function clampPreviewZoom(value) {
    return Math.min(PREVIEW_ZOOM_MAX, Math.max(PREVIEW_ZOOM_MIN, value));
}

const NON_TEXT_INPUT_TYPES = new Set([
    "checkbox",
    "radio",
    "range",
    "button",
    "submit",
    "reset",
]);

function isTextEditingTarget(target) {
    if (!(target instanceof Element)) {
        return false;
    }
    const editable = target.closest(
        "input, textarea, select, [contenteditable=''], "
        + "[contenteditable='true']"
    );
    if (!editable) {
        return false;
    }
    // 预览里的启用开关是 checkbox，不应阻断快捷键。
    if (editable instanceof HTMLInputElement) {
        const type = String(editable.type || "text").toLowerCase();
        return !NON_TEXT_INPUT_TYPES.has(type);
    }
    return true;
}

/**
 * 按顺序把文件塞进列表：还能启用的先启用，超出上限的部分以「禁用」
 * 状态收下（不是丢掉）。返回其中被标成禁用的数量。
 */
function appendEntriesWithLimit(targetList, entries, enabledSlots) {
    let remaining = Math.max(0, Number(enabledSlots) || 0);
    let disabled = 0;
    for (const entry of entries) {
        const enabled = remaining > 0;
        if (enabled) {
            remaining -= 1;
        } else {
            disabled += 1;
        }
        targetList.push({
            uid: newRowUid(),
            ref: entry.ref,
            title: entry.title,
            enabled,
        });
    }
    return disabled;
}

/**
 * 启用/禁用某个条目：面板行开关与预览里的开关共用。
 * 返回 { ok, reason }，reason 为 "limit" 时调用方需要提示用户。
 */
function setEntryEnabled(node, category, entry, enabled) {
    const panel = node?.__xmlg_panel;
    if (!panel || !entry) {
        return { ok: false, reason: "no-panel" };
    }
    const items = panel.state.items;
    const nextEnabled = enabled !== false;
    if (
        nextEnabled
        && entry.enabled === false
        && enabledCount(items, category) >= MAX_ENABLED
    ) {
        return { ok: false, reason: "limit" };
    }
    if ((entry.enabled !== false) === nextEnabled) {
        return { ok: true };
    }
    entry.enabled = nextEnabled;
    writeItems(node, items);
    renderPanel(node);
    return { ok: true };
}

function createPreviewOverlay() {
    ensureStyles();
    const overlay = element("div", "xmlg-preview");
    const stage = element("div", "xmlg-preview-stage");

    const bar = element("div", "xmlg-preview-bar");
    const titleWrap = element("div", "xmlg-preview-title-wrap");
    const title = element("div", "xmlg-preview-title");
    const counter = element("div", "xmlg-preview-counter");
    titleWrap.appendChild(title);
    titleWrap.appendChild(counter);

    const actions = element("div", "xmlg-preview-actions");
    const toggle = element("label", "xmlg-switch xmlg-preview-toggle");
    const toggleInput = document.createElement("input");
    toggleInput.type = "checkbox";
    const toggleTrack = element("span", "xmlg-switch-track");
    toggleTrack.setAttribute("aria-hidden", "true");
    const toggleText = element("span", "xmlg-preview-toggle-text");
    toggle.appendChild(toggleInput);
    toggle.appendChild(toggleTrack);
    toggle.appendChild(toggleText);

    const maskButton = element("button", "xmlg-btn xmlg-preview-btn", "🖌️");
    maskButton.type = "button";
    maskButton.dataset.previewAction = "mask";
    const fullButton = element("button", "xmlg-btn xmlg-preview-btn", "⛶");
    fullButton.type = "button";
    fullButton.dataset.previewAction = "fullscreen";
    const closeButton = element("button", "xmlg-btn xmlg-preview-btn", "✕");
    closeButton.type = "button";
    closeButton.dataset.previewAction = "close";

    actions.appendChild(toggle);
    actions.appendChild(maskButton);
    actions.appendChild(fullButton);
    actions.appendChild(closeButton);
    bar.appendChild(titleWrap);
    bar.appendChild(actions);

    const media = element("div", "xmlg-preview-media");
    const prevButton = element("button", "xmlg-preview-nav xmlg-preview-prev", "‹");
    prevButton.type = "button";
    prevButton.dataset.previewAction = "prev";
    const nextButton = element("button", "xmlg-preview-nav xmlg-preview-next", "›");
    nextButton.type = "button";
    nextButton.dataset.previewAction = "next";
    const strip = element("div", "xmlg-preview-strip");
    const hint = element("div", "xmlg-preview-hint");
    const toast = element("div", "xmlg-preview-toast");

    const mediaWrap = element("div", "xmlg-preview-media-wrap");
    mediaWrap.style.cssText = "position:relative;display:flex;flex:1 1 auto;"
        + "min-height:0;align-items:stretch;justify-content:center;"
        + "overflow:hidden;";

    stage.appendChild(bar);
    stage.appendChild(mediaWrap);
    stage.appendChild(strip);
    stage.appendChild(hint);
    mediaWrap.appendChild(media);
    mediaWrap.appendChild(prevButton);
    mediaWrap.appendChild(nextButton);
    overlay.appendChild(stage);
    overlay.appendChild(toast);
    document.body.appendChild(overlay);

    // 顶栏与导航按钮的提示文字在 syncPreviewChrome() 里随状态更新，
    // 这里只绑一次监听，避免每次刷新界面重复挂事件。
    const hintTargets = [
        title,
        toggle,
        maskButton,
        fullButton,
        closeButton,
        prevButton,
        nextButton,
    ];
    for (const target of hintTargets) {
        bindHint(target, () => target.dataset.tooltip || "");
    }

    return {
        overlay,
        stage,
        bar,
        title,
        counter,
        toggle,
        toggleInput,
        toggleText,
        maskButton,
        fullButton,
        closeButton,
        media,
        prevButton,
        nextButton,
        strip,
        hint,
        toast,
    };
}

let previewRuntime = null;

/**
 * 预览层只建一次：DOM 与事件监听都复用，
 * 打开/关闭只切换状态，避免重复挂 body 元素和重复监听。
 */
function getPreviewRuntime() {
    if (previewRuntime?.els?.overlay?.isConnected) {
        return previewRuntime;
    }
    const preview = {
        els: createPreviewOverlay(),
        node: null,
        category: "image",
        entries: [],
        index: 0,
        playerState: null,
        zoom: 1,
        panX: 0,
        panY: 0,
        imageEl: null,
        mediaEl: null,
        suspended: false,
        panning: null,
        toastTimer: 0,
    };
    bindPreviewEvents(preview);
    previewRuntime = preview;
    return preview;
}

function buildPreviewMediaFallback() {
    return element(
        "div",
        "xmlg-preview-fallback",
        previewText("no_preview", "No preview")
    );
}

/**
 * 以鼠标位置为焦点缩放：返回缩放后图片中心需要的平移量。
 * 纯计算，方便单测；与 XDataHub 灯箱的滚轮缩放保持一致：
 * 鼠标指向的画面内容在缩放前后停在原地。
 */
function previewPanForZoomAt(point, pan, zoom, nextZoom) {
    const ratio = nextZoom / zoom;
    return {
        panX: point.x - ratio * (point.x - pan.x),
        panY: point.y - ratio * (point.y - pan.y),
    };
}

/** 图片按「完整放进预览区、不放大」显示时的基准尺寸与预览区中心。 */
function previewImageMetrics(preview) {
    const image = preview.imageEl;
    const media = preview.els.media;
    if (!(image instanceof HTMLImageElement) || !media) {
        return null;
    }
    const rect = media.getBoundingClientRect();
    if (!rect.width || !rect.height) {
        return null;
    }
    const naturalWidth = Math.max(
        1,
        image.naturalWidth || image.width || 1
    );
    const naturalHeight = Math.max(
        1,
        image.naturalHeight || image.height || 1
    );
    const fitScale = Math.min(
        rect.width / naturalWidth,
        rect.height / naturalHeight,
        1
    );
    return {
        centerX: rect.left + rect.width / 2,
        centerY: rect.top + rect.height / 2,
        viewportWidth: rect.width,
        viewportHeight: rect.height,
        width: naturalWidth * fitScale,
        height: naturalHeight * fitScale,
    };
}

function clampPreviewPan(preview) {
    const metrics = previewImageMetrics(preview);
    if (!metrics) {
        return;
    }
    if (preview.zoom <= 1) {
        preview.panX = 0;
        preview.panY = 0;
        return;
    }
    const maxX = Math.max(
        0,
        (metrics.width * preview.zoom - metrics.viewportWidth) / 2
    );
    const maxY = Math.max(
        0,
        (metrics.height * preview.zoom - metrics.viewportHeight) / 2
    );
    preview.panX = Math.min(maxX, Math.max(-maxX, preview.panX));
    preview.panY = Math.min(maxY, Math.max(-maxY, preview.panY));
}

function applyPreviewZoom(preview) {
    const image = preview.imageEl;
    if (!(image instanceof HTMLImageElement)) {
        return;
    }
    clampPreviewPan(preview);
    image.style.transform = `translate(${preview.panX}px, ${
        preview.panY
    }px) scale(${preview.zoom})`;
    image.classList.toggle("is-zoomed", preview.zoom > 1);
}

function zoomPreviewAt(preview, clientX, clientY, nextZoom) {
    const metrics = previewImageMetrics(preview);
    if (!metrics) {
        return;
    }
    const safeNext = clampPreviewZoom(nextZoom);
    if (Math.abs(safeNext - preview.zoom) < 1e-6) {
        return;
    }
    const point = {
        x: clientX - metrics.centerX,
        y: clientY - metrics.centerY,
    };
    const nextPan = previewPanForZoomAt(
        point,
        { x: preview.panX, y: preview.panY },
        preview.zoom,
        safeNext
    );
    preview.zoom = safeNext;
    preview.panX = nextPan.panX;
    preview.panY = nextPan.panY;
    applyPreviewZoom(preview);
}

function resetPreviewZoom(preview) {
    preview.zoom = 1;
    preview.panX = 0;
    preview.panY = 0;
    preview.panning = null;
    if (preview.imageEl) {
        preview.imageEl.classList.remove("is-panning");
    }
    applyPreviewZoom(preview);
}

function bindPreviewZoom(preview, image) {
    image.addEventListener("pointerdown", (event) => {
        if (preview.zoom <= 1 || event.button !== 0) {
            return;
        }
        event.preventDefault();
        image.setPointerCapture?.(event.pointerId);
        preview.panning = {
            id: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            panX: preview.panX,
            panY: preview.panY,
        };
        image.classList.add("is-panning");
    });
    image.addEventListener("pointermove", (event) => {
        const pan = preview.panning;
        if (!pan || pan.id !== event.pointerId) {
            return;
        }
        preview.panX = pan.panX + (event.clientX - pan.startX);
        preview.panY = pan.panY + (event.clientY - pan.startY);
        applyPreviewZoom(preview);
    });
    const endPan = (event) => {
        if (!preview.panning || preview.panning.id !== event.pointerId) {
            return;
        }
        preview.panning = null;
        image.classList.remove("is-panning");
    };
    image.addEventListener("pointerup", endPan);
    image.addEventListener("pointercancel", endPan);
    image.addEventListener("dblclick", () => resetPreviewZoom(preview));
}

/**
 * 预览里的播放器提示：与节点面板同一套自绘气泡。
 * 播放器会在状态变化时反复调用 set()，所以文字先存到 dataset，
 * 悬停时再按当前状态取出来。
 */
const PREVIEW_PLAYER_TOOLTIP = {
    set: (target, text) => {
        if (!(target instanceof HTMLElement)) {
            return;
        }
        if (text) {
            target.dataset.tooltip = String(text);
        } else {
            delete target.dataset.tooltip;
        }
    },
    bind: (target) => {
        if (target instanceof HTMLElement) {
            bindHint(target, () => target.dataset.tooltip || "");
        }
    },
};

/* ── 视频/音频默认状态 ─────────────────────────────────────────────
   和 XDataHub 设置面板里的「预览」开关保持一致（默认值也与 XDataHub、
   XVideoGet / XAudioGet 节点面板一致）：视频默认静音、音频默认不静音，
   两者都不自动播放、不循环。设置改动通过 postMessage 即时同步。 */
const XDATAHUB_SETTINGS_ENDPOINT = "/xz3r0/xdatahub/settings";
const PREVIEW_MEDIA_SETTINGS_DEFAULT = {
    video: { autoplay: false, muted: true, loop: false },
    audio: { autoplay: false, muted: false, loop: false },
};
let previewMediaSettings = {
    video: { ...PREVIEW_MEDIA_SETTINGS_DEFAULT.video },
    audio: { ...PREVIEW_MEDIA_SETTINGS_DEFAULT.audio },
};

function applyPreviewMediaSettings(settings) {
    if (!settings || typeof settings !== "object") {
        return;
    }
    previewMediaSettings = {
        // 与 xdh-lightbox.js 的 getPreviewSettings() 判定完全一致。
        video: {
            autoplay: settings.video_preview_autoplay === true,
            muted: settings.video_preview_muted !== false,
            loop: settings.video_preview_loop === true,
        },
        audio: {
            autoplay: settings.audio_preview_autoplay === true,
            muted: settings.audio_preview_muted === true,
            loop: settings.audio_preview_loop === true,
        },
    };
}

async function refreshPreviewMediaSettings() {
    try {
        const response = await fetch(XDATAHUB_SETTINGS_ENDPOINT);
        if (!response.ok) {
            return;
        }
        const payload = await response.json();
        applyPreviewMediaSettings(payload?.settings);
    } catch {
        // 拉取失败就用默认值（和 XDataHub 默认设置相同）
    }
}

function releasePreviewMedia(preview) {
    const playerState = preview?.playerState;
    if (playerState && typeof playerState.dispose === "function") {
        try {
            playerState.dispose();
        } catch {
            // 忽略：销毁失败也要继续清理播放源
        }
    }
    if (preview) {
        preview.playerState = null;
    }
    const media = preview?.mediaEl;
    if (media instanceof HTMLVideoElement
        || media instanceof HTMLAudioElement) {
        try {
            media.pause();
        } catch {
            // 忽略：暂停失败也要继续清理播放源
        }
        media.removeAttribute("src");
        media.load?.();
    }
}

function buildPreviewMedia(preview) {
    const host = preview.els.media;
    const entry = preview.entries[preview.index];
    // 换文件前先停掉上一个视频/音频，否则元素被移出页面后声音还会继续播。
    releasePreviewMedia(preview);
    host.innerHTML = "";
    preview.imageEl = null;
    preview.mediaEl = null;
    if (!entry) {
        return;
    }
    const url = buildMediaFileUrl(entry.ref);
    const showFallback = () => {
        releasePreviewMedia(preview);
        host.innerHTML = "";
        preview.imageEl = null;
        preview.mediaEl = null;
        host.appendChild(buildPreviewMediaFallback());
    };
    if (preview.category === "image") {
        const image = document.createElement("img");
        image.className = "xmlg-preview-img";
        image.alt = "";
        image.draggable = false;
        image.src = url;
        image.addEventListener("error", showFallback);
        host.appendChild(image);
        preview.imageEl = image;
        resetPreviewZoom(preview);
        bindPreviewZoom(preview, image);
        return;
    }
    const player = preview.category === "video"
        ? buildVideoPlayer({ t, tooltip: PREVIEW_PLAYER_TOOLTIP })
        : buildAudioPlayer({ t, tooltip: PREVIEW_PLAYER_TOOLTIP });
    const media = player.mediaEl;
    const mediaSettings = previewMediaSettings[preview.category]
        || PREVIEW_MEDIA_SETTINGS_DEFAULT[preview.category]
        || { autoplay: false, muted: false, loop: false };
    media.autoplay = mediaSettings.autoplay;
    media.loop = mediaSettings.loop;
    media.muted = mediaSettings.muted;
    media.src = url;
    media.addEventListener("error", showFallback);
    host.appendChild(player.container);
    preview.mediaEl = media;
    preview.playerState = player.playerState;
    preview.playerState.sync();
    if (mediaSettings.muted) {
        // 走播放器自己的静音逻辑，滑杆才会显示 0%、图标才会变 🔇。
        preview.playerState.toggleMute();
    }
    if (mediaSettings.autoplay) {
        media.play?.().catch(() => {});
    }
}

function previewEntryOf(preview) {
    return preview.entries[preview.index] || null;
}

function renderPreviewStrip(preview) {
    const strip = preview.els.strip;
    strip.innerHTML = "";
    strip.setAttribute("role", "group");
    strip.setAttribute(
        "aria-label",
        previewText("preview_strip_label", "Files in this list")
    );
    const enabledOrder = new Array(preview.entries.length).fill(0);
    let enabledSeq = 0;
    preview.entries.forEach((entry, index) => {
        if (entry.enabled !== false) {
            enabledSeq += 1;
            enabledOrder[index] = enabledSeq;
        }
    });
    const fragment = document.createDocumentFragment();
    preview.entries.forEach((entry, index) => {
        const item = document.createElement("button");
        item.type = "button";
        item.className = "xmlg-preview-strip-item";
        item.dataset.index = String(index);
        if (index === preview.index) {
            item.classList.add("is-active");
        }
        if (entry.enabled === false) {
            item.classList.add("is-disabled");
        }
        item.dataset.tooltip = entry.title || entry.ref;
        bindHint(item, () => item.dataset.tooltip || "");
        const thumb = element("div", "xmlg-preview-strip-thumb");
        if (preview.category === "audio") {
            thumb.textContent = "♪";
        } else {
            const image = document.createElement("img");
            image.loading = "lazy";
            image.decoding = "async";
            image.alt = "";
            image.src = previewThumbUrl(entry.ref);
            image.addEventListener("error", () => {
                image.remove();
                thumb.textContent = preview.category === "video" ? "🎬" : "🖼️";
            });
            thumb.appendChild(image);
        }
        item.appendChild(thumb);
        if (enabledOrder[index]) {
            item.appendChild(
                element(
                    "span",
                    "xmlg-preview-strip-seq",
                    String(enabledOrder[index])
                )
            );
        }
        item.appendChild(
            element("div", "xmlg-preview-strip-name", entry.title || entry.ref)
        );
        item.addEventListener("click", () => {
            previewSetIndex(preview, index);
        });
        fragment.appendChild(item);
    });
    strip.appendChild(fragment);
}

function syncPreviewStripSelection(preview) {
    const items = preview.els.strip.querySelectorAll(
        ".xmlg-preview-strip-item"
    );
    items.forEach((item) => {
        const index = Number(item.dataset.index);
        item.classList.toggle("is-active", index === preview.index);
        const entry = preview.entries[index];
        item.classList.toggle(
            "is-disabled",
            !!entry && entry.enabled === false
        );
    });
}

function scrollPreviewStripToActive(preview) {
    const active = preview.els.strip.querySelector(
        ".xmlg-preview-strip-item.is-active"
    );
    active?.scrollIntoView?.({ block: "nearest", inline: "center" });
}

function syncPreviewChrome(preview) {
    const els = preview.els;
    const entry = previewEntryOf(preview);
    const total = preview.entries.length;
    const isImage = preview.category === "image";
    const enabled = !!entry && entry.enabled !== false;

    els.title.textContent = entry ? (entry.title || entry.ref) : "";
    els.title.dataset.tooltip = els.title.textContent;
    els.counter.textContent = total
        ? `${preview.index + 1} / ${total}`
        : "";

    els.toggleInput.checked = enabled;
    els.toggleInput.disabled = !entry;
    els.toggle.dataset.tooltip = previewText(
        "preview_toggle_tooltip",
        "Click to enable or disable this file"
    );
    els.toggleText.textContent = enabled
        ? previewText("enabled", "Enabled")
        : previewText("disabled", "Disabled");

    els.maskButton.hidden = !isImage;
    els.maskButton.disabled = !entry;
    els.maskButton.classList.toggle("is-set", entryHasMaskArtifacts(entry));
    const maskLabel = entryMaskHintText(entry);
    els.maskButton.dataset.tooltip = maskLabel;
    els.maskButton.setAttribute("aria-label", maskLabel);

    // 正常情况预览就是全屏，全屏按钮只在浏览器拒绝全屏时兜底显示。
    const isFullscreen = document.fullscreenElement === els.overlay;
    els.fullButton.hidden = isFullscreen;
    els.fullButton.textContent = "⛶";
    const fullLabel = previewText("preview_fullscreen", "Fullscreen");
    els.fullButton.dataset.tooltip = fullLabel;
    els.fullButton.setAttribute("aria-label", fullLabel);

    const closeLabel = previewText("preview_close", "Close preview (Esc)");
    els.closeButton.dataset.tooltip = closeLabel;
    els.closeButton.setAttribute("aria-label", closeLabel);
    const prevLabel = previewText("page_prev", "Previous");
    els.prevButton.dataset.tooltip = prevLabel;
    els.prevButton.setAttribute("aria-label", prevLabel);
    const nextLabel = previewText("page_next", "Next");
    els.nextButton.dataset.tooltip = nextLabel;
    els.nextButton.setAttribute("aria-label", nextLabel);
    els.prevButton.disabled = preview.index <= 0;
    els.nextButton.disabled = preview.index >= total - 1;
    // 只有图片能用滚轮缩放；视频、音频别把这一项写进提示里。
    els.hint.textContent = isImage
        ? previewText(
            "preview_keys_hint",
            "← / → Switch · Wheel zoom · Esc Close"
        )
        : previewText(
            "preview_keys_hint_media",
            "← / → Switch · Esc Close"
        );
}

function showPreviewToast(preview, message) {
    const toast = preview.els.toast;
    toast.textContent = String(message || "");
    toast.classList.add("is-visible");
    if (preview.toastTimer) {
        clearTimeout(preview.toastTimer);
    }
    preview.toastTimer = window.setTimeout(() => {
        toast.classList.remove("is-visible");
        preview.toastTimer = 0;
    }, PREVIEW_TOAST_MS);
}

function previewSetIndex(preview, index) {
    const next = Math.max(0, Math.min(preview.entries.length - 1, index));
    if (next === preview.index && preview.els.media.childElementCount) {
        return;
    }
    preview.index = next;
    buildPreviewMedia(preview);
    syncPreviewChrome(preview);
    syncPreviewStripSelection(preview);
    scrollPreviewStripToActive(preview);
}

function previewStep(delta) {
    const preview = activePreview;
    if (!preview || !preview.entries?.length) {
        return;
    }
    previewSetIndex(preview, preview.index + delta);
}

function openMediaPreview(node, category, index) {
    const panel = node?.__xmlg_panel;
    if (!panel || !CATEGORIES.includes(category)) {
        return;
    }
    const entries = panel.state.items[category] || [];
    if (!entries.length) {
        return;
    }
    if (activePreview) {
        // 复用同一个覆盖层：换内容时不要退出全屏再重进。
        closeMediaPreview({ keepFullscreen: true });
    }
    const preview = getPreviewRuntime();
    activePreview = preview;
    preview.node = node;
    preview.category = category;
    preview.entries = entries;
    preview.index = Math.max(
        0,
        Math.min(entries.length - 1, Number(index) || 0)
    );
    preview.playerState = null;
    preview.zoom = 1;
    preview.panX = 0;
    preview.panY = 0;
    preview.imageEl = null;
    preview.mediaEl = null;
    preview.suspended = false;
    preview.panning = null;
    preview.els.overlay.classList.add("is-open");
    buildPreviewMedia(preview);
    renderPreviewStrip(preview);
    syncPreviewChrome(preview);
    window.requestAnimationFrame(() => scrollPreviewStripToActive(preview));
    // 预览只有「真全屏」一种形态：点缩略图时仍在用户手势里，直接进全屏。
    requestPreviewFullscreen();
}

function closeMediaPreview(options = {}) {
    const preview = activePreview;
    if (!preview) {
        return;
    }
    activePreview = null;
    if (preview.toastTimer) {
        clearTimeout(preview.toastTimer);
        preview.toastTimer = 0;
    }
    preview.els.toast.classList.remove("is-visible");
    releasePreviewMedia(preview);
    preview.els.media.innerHTML = "";
    preview.els.overlay.classList.remove("is-open");
    preview.imageEl = null;
    preview.mediaEl = null;
    preview.entries = [];
    preview.node = null;
    preview.suspended = false;
    preview.panning = null;
    if (
        !options.keepFullscreen
        && document.fullscreenElement === preview.els.overlay
    ) {
        document.exitFullscreen?.().catch(() => {});
    }
}

function closeMediaPreviewForNode(node) {
    if (activePreview && activePreview.node === node) {
        closeMediaPreview();
    }
}

/** 面板重绘 / 数据变化后刷新预览（分类或数据被改掉时直接关闭）。 */
function refreshPreviewForNode(node) {
    const preview = activePreview;
    if (!preview || preview.node !== node) {
        return;
    }
    const panel = node.__xmlg_panel;
    if (!panel || panel.state.category !== preview.category) {
        closeMediaPreview();
        return;
    }
    const entries = panel.state.items[preview.category] || [];
    if (!entries.length) {
        closeMediaPreview();
        return;
    }
    const currentRef = previewEntryOf(preview)?.ref || "";
    preview.entries = entries;
    const found = entries.findIndex((entry) => entry.ref === currentRef);
    preview.index = found >= 0 ? found : Math.min(
        preview.index,
        entries.length - 1
    );
    renderPreviewStrip(preview);
    const nextRef = previewEntryOf(preview)?.ref || "";
    if (nextRef !== currentRef) {
        buildPreviewMedia(preview);
    }
    syncPreviewChrome(preview);
    scrollPreviewStripToActive(preview);
}

/**
 * 进入真全屏。预览本身没有「窗口内」形态：如果浏览器拒绝
 * （例如自动化 / iframe 权限不足），会保留覆盖层并显示全屏按钮兜底。
 */
function requestPreviewFullscreen() {
    const preview = activePreview;
    const overlay = preview?.els?.overlay;
    if (!overlay || document.fullscreenElement === overlay) {
        return;
    }
    if (typeof overlay.requestFullscreen !== "function") {
        syncPreviewChrome(preview);
        return;
    }
    overlay.requestFullscreen({ navigationUI: "hide" }).catch(() => {
        if (activePreview === preview) {
            syncPreviewChrome(preview);
        }
    });
}

/** 遮罩编辑器是页面里的独立覆盖层：等它真正关掉再回到全屏。 */
function waitForMaskEditorClose() {
    const selector = ".ximageget-mask-editor-overlay";
    if (!document.querySelector(selector)) {
        return Promise.resolve();
    }
    return new Promise((resolve) => {
        const observer = new MutationObserver(() => {
            if (document.querySelector(selector)) {
                return;
            }
            observer.disconnect();
            resolve();
        });
        observer.observe(document.body, { childList: true, subtree: true });
    });
}

async function openPreviewMaskEditor() {
    const preview = activePreview;
    const entry = preview ? previewEntryOf(preview) : null;
    if (!preview || !entry || preview.category !== "image") {
        return;
    }
    // 遮罩编辑器是普通页面覆盖层，真全屏时会被藏起来，必须先退出全屏。
    // 先标记 suspended，避免这次「主动退出」被当成用户退出而关闭预览。
    const wasFullscreen = document.fullscreenElement === preview.els.overlay;
    preview.suspended = true;
    if (wasFullscreen) {
        try {
            await document.exitFullscreen();
        } catch {
            // 忽略：退出失败时仍然打开编辑器（页面内可见）。
        }
    }
    try {
        await openMaskEditorForEntry(preview.node, entry);
        // openXMaskEditor 打开后立刻返回，必须等覆盖层被移除，
        // 否则会在编辑器还开着的时候就抢先回到全屏。
        await waitForMaskEditorClose();
    } finally {
        preview.suspended = false;
        if (activePreview === preview) {
            syncPreviewChrome(preview);
            renderPreviewStrip(preview);
            scrollPreviewStripToActive(preview);
            if (wasFullscreen) {
                // 编辑完自动回到真全屏（用户刚点过编辑器按钮，手势通常还在）。
                requestPreviewFullscreen();
            }
        }
    }
}

function handlePreviewKeyDown(event) {
    const preview = activePreview;
    if (!preview || preview.suspended) {
        return;
    }
    // 预览打开时把按键拦在这里，避免后台画布响应 Delete / Ctrl+Z 等快捷键。
    event.stopPropagation();
    if (isTextEditingTarget(event.target)) {
        return;
    }
    if (event.key === "Escape") {
        if (document.fullscreenElement) {
            // 交给浏览器退出全屏（第一次 Esc 不关闭预览）。
            return;
        }
        event.preventDefault();
        closeMediaPreview();
        return;
    }
    if (event.altKey || event.ctrlKey || event.metaKey) {
        return;
    }
    if (event.key === "ArrowLeft") {
        event.preventDefault();
        previewStep(-1);
        return;
    }
    if (event.key === "ArrowRight") {
        event.preventDefault();
        previewStep(1);
    }
}

function bindPreviewEvents(preview) {
    const els = preview.els;
    // 预览是盖在整页上的模态层：指针事件不再冒泡给页面级监听。
    // 否则鼠标移到屏幕边缘时，XDataHub 的「贴边悬停展开」仍会被触发，
    // 在全屏预览后面把停靠窗口弹出来（看起来像被预览干扰了）。
    const keepPointerInPreview = (event) => {
        event.stopPropagation();
    };
    for (const type of ["pointermove", "mousemove", "pointerdown"]) {
        els.overlay.addEventListener(type, keepPointerInPreview);
    }
    els.closeButton.addEventListener("click", () => closeMediaPreview());
    els.prevButton.addEventListener("click", () => previewStep(-1));
    els.nextButton.addEventListener("click", () => previewStep(1));
    els.fullButton.addEventListener("click", () => requestPreviewFullscreen());
    els.toggleInput.addEventListener("change", () => {
        const entry = previewEntryOf(preview);
        if (!entry) {
            return;
        }
        const result = setEntryEnabled(
            preview.node,
            preview.category,
            entry,
            els.toggleInput.checked
        );
        if (!result.ok) {
            els.toggleInput.checked = entry.enabled !== false;
            if (result.reason === "limit") {
                showPreviewToast(
                    preview,
                    t(
                        "xdatahub.ui.node.xmedialistget"
                        + ".limit_enable_blocked",
                        "Already {limit} enabled; turn one off first",
                        { limit: MAX_ENABLED }
                    )
                );
            }
        }
    });
    els.maskButton.addEventListener("click", () => {
        void openPreviewMaskEditor();
    });
    els.media.addEventListener(
        "wheel",
        (event) => {
            if (preview.category !== "image" || !preview.imageEl) {
                return;
            }
            event.preventDefault();
            event.stopPropagation();
            const factor = event.deltaY < 0
                ? PREVIEW_ZOOM_STEP
                : 1 / PREVIEW_ZOOM_STEP;
            // 以鼠标所指的位置为中心缩放（和 XDataHub 灯箱一致）。
            zoomPreviewAt(
                preview,
                event.clientX,
                event.clientY,
                preview.zoom * factor
            );
        },
        { passive: false }
    );
}

function installPreviewRuntime() {
    if (ROOT.__xmedialistget_preview_runtime__) {
        return;
    }
    ROOT.__xmedialistget_preview_runtime__ = true;
    refreshPreviewMediaSettings();
    window.addEventListener("message", (event) => {
        if (event.origin !== window.location.origin) {
            return;
        }
        const payload = event?.data;
        if (!payload || payload.type !== "xdatahub:host-settings-updated") {
            return;
        }
        applyPreviewMediaSettings(payload.settings);
    });
    document.addEventListener("keydown", handlePreviewKeyDown, true);
    document.addEventListener("fullscreenchange", () => {
        const preview = activePreview;
        if (!preview) {
            return;
        }
        if (preview.suspended) {
            // 打开遮罩编辑器时我们会主动退出全屏，这里不关闭预览。
            return;
        }
        if (document.fullscreenElement !== preview.els.overlay) {
            // 只有真全屏一种形态：用户按 Esc / 浏览器按钮退出全屏就关掉预览。
            closeMediaPreview();
            return;
        }
        syncPreviewChrome(preview);
    });
}

// 轻量自绘提示（替换浏览器原生 title），平时挂在 body 上。
let hintElement = null;

/**
 * 提示节点该挂哪儿：预览是「真全屏」时，全屏元素之外的内容浏览器
 * 完全不渲染（连 z-index 也救不了），所以提示必须挂进预览层内部。
 */
function hintHost() {
    const overlay = activePreview?.els?.overlay;
    if (overlay && overlay.isConnected
        && overlay.classList.contains("is-open")) {
        return overlay;
    }
    return document.body;
}

function ensureHintElement() {
    const host = hintHost();
    if (hintElement && hintElement.isConnected
        && hintElement.parentElement === host) {
        return hintElement;
    }
    if (!hintElement) {
        hintElement = element("div", "xmlg-hint");
    }
    host.appendChild(hintElement);
    return hintElement;
}

function positionHint(event) {
    const hint = hintElement;
    if (!hint) {
        return;
    }
    const margin = 12;
    const offsetX = 14;
    const offsetY = 22;
    hint.style.left = `${event.clientX + offsetX}px`;
    hint.style.top = `${event.clientY + offsetY}px`;
    const rect = hint.getBoundingClientRect();
    if (rect.right > window.innerWidth - margin) {
        hint.style.left = `${
            window.innerWidth - rect.width - margin
        }px`;
    }
    if (rect.bottom > window.innerHeight - margin) {
        hint.style.top = `${event.clientY - rect.height - 8}px`;
    }
}

function showHint(text, event) {
    const value = String(text || "");
    if (!value) {
        hideHint();
        return;
    }
    const hint = ensureHintElement();
    hint.textContent = value;
    hint.classList.add("is-visible");
    positionHint(event);
}

function hideHint() {
    hintElement?.classList.remove("is-visible");
}

function bindHint(target, getText) {
    if (!(target instanceof HTMLElement)) {
        return;
    }
    target.addEventListener("mouseenter", (event) => {
        // 拖动中不要弹提示：它会一直挂在光标旁边，把要看的落点挡住
        if (event.buttons) {
            return;
        }
        const text = typeof getText === "function" ? getText() : getText;
        showHint(text, event);
    });
    target.addEventListener("mousemove", (event) => {
        positionHint(event);
    });
    target.addEventListener("mouseleave", hideHint);
    target.addEventListener("pointerdown", hideHint);
}

function renderPanel(node, options = {}) {
    const panel = node?.__xmlg_panel;
    if (!panel) {
        return;
    }
    const prevScrollTop = panel.list.scrollTop;
    const prevScrollLeft = panel.list.scrollLeft;
    const state = panel.state;
    state.items = normalizeItems(state.items);
    const outputCount = enabledCount(state.items, state.category);
    node.__xmlg_enabled_counts = {
        image: enabledCount(state.items, "image"),
        video: enabledCount(state.items, "video"),
        audio: enabledCount(state.items, "audio"),
    };
    if (node.__xmlg_enabled_count !== outputCount) {
        node.__xmlg_enabled_count = outputCount;
    }
    // 三个分类的启用数任一变化都要通知下游（下游可能用的不是当前分类）。
    const countsKey = [
        node.__xmlg_enabled_counts.image,
        node.__xmlg_enabled_counts.video,
        node.__xmlg_enabled_counts.audio,
    ].join("|");
    if (node.__xmlg_enabled_counts_key !== countsKey) {
        node.__xmlg_enabled_counts_key = countsKey;
        document.dispatchEvent(
            new CustomEvent("xmedialistget:count-changed")
        );
    }

    panel.kindEmoji.textContent = "🗂️";
    if (!applyBadge(node)) {
        scheduleBadgeRefresh(node);
    }

    for (const category of CATEGORIES) {
        const tab = panel.tabButtons[category];
        tab.button.classList.toggle(
            "is-output-off",
            !readOutputEnabled(node, category)
        );
        tab.label.textContent = `${
            CATEGORY_EMOJI[category] || ""
        } ${categoryLabel(category)}`;
        tab.count.textContent = String(
            enabledCount(state.items, category)
        );
        tab.button.classList.toggle(
            "is-active",
            state.category === category
        );
    }
    panel.warningText.textContent = t(
        "xdatahub.ui.node.xmedialistget.type_warning",
        "Type warning"
    );
    panel.warningInput.checked = readTypeWarning(node);
    updateUndoButton(node);
    panel.status.textContent = t(
        "xdatahub.ui.node.xmedialistget.enabled_count",
        "Enabled {count} / {limit}",
        {
            count: enabledCount(state.items, state.category),
            limit: MAX_ENABLED,
        }
    );

    const items = state.items[state.category] || [];
    const groups = state.items.groups?.[state.category] || [];
    pruneSelection(state, items);
    // 范围胶囊、组标签先对齐（顺手把失效的组范围清掉）。
    // 组头的高亮要等列表重建完再补，见函数末尾。
    syncScopeUi(node, { heads: false });
    // 三个按钮能不能按，看的是「当前范围里有没有文件」：
    // 范围选「分组」但一个组都没有时，按了也没意义
    const batchable = scopeRows(state).length > 0;
    // 只有选中了「还没分组」的文件时才能建组。这里不用真 disabled：
    // 真 disabled 的按钮收不到悬停事件，用户看不到「为什么点不动」。
    panel.enableAllButton.disabled = !batchable;
    panel.disableAllButton.disabled = !batchable;
    panel.invertButton.disabled = !batchable;
    const groupable = ungroupedSelection(state, state.category).length;
    panel.groupButton.classList.toggle("is-disabled", groupable < 1);
    panel.groupButton.setAttribute(
        "aria-disabled",
        groupable < 1 ? "true" : "false"
    );
    panel.groupButton.textContent = t(
        "xdatahub.ui.node.xmedialistget.new_group",
        "Create group"
    );

    for (const child of Array.from(panel.list.children)) {
        if (
            child === panel.overlay
            || child === panel.insertLine
            || child === panel.dropLabel
            || child === panel.empty
            || child === panel.toast
        ) {
            continue;
        }
        child.remove();
    }

    // 一条长列表全量渲染。组头也算一行；序号只数「会加载」的行，
    // 所以用户看到的数字就是实际加载顺序，跟组与折叠无关。
    const entries = buildRenderList(items, groups, {
        keyOf: XMLG_KEY_OF,
        willLoad: (entry) => entry.enabled !== false,
    });
    // 组色带：组头和竖线共用同一个颜色，按组记录算一次。
    const stripeByGroup = new Map(
        groups.map((group) => [group.id, groupStripeColor(group)])
    );
    const headByGroup = new Map();
    const lastRowByGroup = new Map();
    // 行元素按「唯一键」索引，重排时直接拿回来搬位置（不重建，缩略图不重载）
    const rowByRef = new Map();
    const seenRefs = new Map();
    for (const entry of entries) {
        if (entry.type === "group") {
            const head = buildGroupHead(node, state.category, entry);
            headByGroup.set(entry.groupId, head);
            panel.list.appendChild(head);
            continue;
        }
        const rowEl = buildRow(
            node,
            state.category,
            entry.row,
            entry.index,
            entry.seq
        );
        if (entry.row.group) {
            // 序号（以及没序号的「–」）跟着组色走，一眼看出这行属于哪一组
            rowEl.style.setProperty(
                "--xmlg-group-stripe",
                stripeByGroup.get(entry.row.group)
                    || groupStripeColor(entry.row.group)
            );
            lastRowByGroup.set(entry.row.group, rowEl);
        }
        rowByRef.set(rowKeyOf(entry, seenRefs), rowEl);
        panel.list.appendChild(rowEl);
    }
    panel.rowByRef = rowByRef;
    panel.headByGroup = headByGroup;
    // 每组一根竖线：从组头顶端一直画到最后一行底端。
    // 做成一个绝对定位元素（而不是每行一个伪元素），组头和第一行之间
    // 才不会断成两截；折叠的组就只贯穿组头那一条。
    panel.railHosts = new Map();
    for (const [groupId, head] of headByGroup) {
        const rail = element("div", "xmlg-group-rail");
        rail.dataset.group = groupId;
        rail.style.setProperty(
            "--xmlg-group-stripe",
            stripeByGroup.get(groupId) || groupStripeColor(groupId)
        );
        panel.list.appendChild(rail);
        panel.railHosts.set(groupId, {
            rail,
            head,
            last: lastRowByGroup.get(groupId) || head,
        });
    }
    // 换了新的一批组头和行，缓存作废，必须重新量
    panel.railMeasured = false;
    layoutGroupRails(panel);
    ensureRailObserver(panel);
    // 挂载瞬间布局可能还没算完，下一帧再校一次（幂等，代价很小）
    window.requestAnimationFrame(() => {
        if (panel.list?.isConnected) {
            layoutGroupRails(panel);
        }
    });

    panel.empty.textContent = items.length
        ? ""
        : t(
            "xdatahub.ui.node.xmedialistget.empty_category",
            "No files in this category yet"
        );
    panel.empty.style.display = items.length ? "none" : "flex";

    panel.total.textContent = t(
        "xdatahub.ui.node.xmedialistget.total_items",
        "{count} files",
        { count: items.length }
    );
    const targetScrollTop = Number.isFinite(options.scrollTop)
        ? options.scrollTop
        : prevScrollTop;
    const targetScrollLeft = Number.isFinite(options.scrollLeft)
        ? options.scrollLeft
        : prevScrollLeft;
    panel.state.scrollToken = (panel.state.scrollToken || 0) + 1;
    const scrollToken = panel.state.scrollToken;
    window.requestAnimationFrame(() => {
        if (!panel.list.isConnected) {
            return;
        }
        if (panel.state.scrollToken !== scrollToken) {
            return;
        }
        panel.list.scrollTop = targetScrollTop;
        panel.list.scrollLeft = targetScrollLeft;
    });
    // 刚展开的那一组：行从 0 高度长开。放在量完竖线之后，这样线是先按
    // 「长开」的尺寸摆好的，动画中途不会短一截；滚动位置也要传进去，
    // 行缩到 0 的那一帧内容变短，浏览器会把靠底的列表往回顶。
    if (panel.pendingExpand) {
        unfoldGroupRowsIn(panel, panel.pendingExpand, targetScrollTop);
    }
    // 列表重建完了，才能给「只作用于这一组」的组头描边
    syncScopeUi(node, { heads: true });
    refreshPreviewForNode(node);
}

/*
 * 把某一行滚进视野。分页退场后不再有「第几页」，插入或拖入
 * 新内容时改用这个，只滚列表本身（用 nearest 不会把整页弹走）。
 */
function scrollRowIntoView(node, index) {
    const panel = node?.__xmlg_panel;
    if (!panel || !Number.isFinite(Number(index))) {
        return;
    }
    window.requestAnimationFrame(() => {
        const row = panel.list.querySelector(
            `.xmlg-row[data-index="${Number(index)}"]`
        );
        row?.scrollIntoView?.({ block: "nearest" });
    });
}

function setCategory(node, category) {
    const panel = node?.__xmlg_panel;
    if (!panel || !CATEGORIES.includes(category)) {
        return;
    }
    const state = panel.state;
    if (state.category === category) {
        return;
    }
    state.category = category;
    state.selection.clear();
    state.selectionAnchor = null;
    // 组是分类内的，「只作用于某一组」换个标签就失效
    state.scopeGroup = null;
    state.scopeGroupBack = null;
    const widget = findWidget(node, MEDIA_TYPE_WIDGET);
    if (widget) {
        widget.value = category;
    }
    node.setDirtyCanvas?.(true, true);
    node.graph?.change?.();
    syncOutputPortType(node);
    renderPanel(node);
}

function clearCurrentCategory(node) {
    const panel = node?.__xmlg_panel;
    if (!panel) {
        return;
    }
    const state = panel.state;
    const items = state.items[state.category] || [];
    if (!items.length) {
        return;
    }
    const message = t(
        "xdatahub.ui.node.xmedialistget.clear_confirm",
        "Remove all {count} files in this category?",
        { count: items.length }
    );
    if (!window.confirm(message)) {
        return;
    }
    state.items[state.category] = [];
    state.missing.clear();
    writeItems(node, state.items);
    renderPanel(node);
}

async function refreshMissing(node) {
    const panel = node?.__xmlg_panel;
    if (!panel) {
        return;
    }
    const state = panel.state;
    const refs = (state.items[state.category] || []).map(
        (entry) => entry.ref
    );
    const missing = new Set();
    const queue = refs.slice();
    const worker = async () => {
        while (queue.length) {
            const ref = queue.shift();
            try {
                const response = await fetch(
                    `/xz3r0/xdatahub/media/meta?ref=${
                        encodeURIComponent(ref)
                    }`
                );
                if (!response.ok) {
                    missing.add(ref);
                }
            } catch {
                missing.add(ref);
            }
        }
    };
    const workers = [];
    for (let index = 0; index < REFRESH_CONCURRENCY; index += 1) {
        workers.push(worker());
    }
    await Promise.all(workers);
    state.missing = missing;
    renderPanel(node);
}

/**
 * 这一次点击算不算「点在这组的身上」。
 *
 * 计数胶囊是纯显示（pointer-events: none），点它的命中目标会变成组头；
 * 设置按钮和折叠箭头周边也有几个像素的余量——点偏一点点就去改范围，
 * 用户会觉得「数字和设置被动了」。这些区域一律不算。
 */
function isPassiveHeadZone(head, event) {
    const slack = 4;
    for (const selector of [
        ".xmlg-group-count",
        ".xmlg-group-settings",
        ".xmlg-group-arrow",
    ]) {
        const target = head.querySelector(selector);
        if (!target) {
            continue;
        }
        const rect = target.getBoundingClientRect();
        if (
            event.clientX >= rect.left - slack
            && event.clientX <= rect.right + slack
            && event.clientY >= rect.top - slack
            && event.clientY <= rect.bottom + slack
        ) {
            return true;
        }
    }
    return false;
}

function scopeLabel(mode) {
    if (mode === "files") {
        return t("xdatahub.ui.node.xmedialistget.scope_files", "Files");
    }
    if (mode === "groups") {
        return t("xdatahub.ui.node.xmedialistget.scope_groups", "Grouped");
    }
    return t("xdatahub.ui.node.xmedialistget.scope_all", "All");
}

function scopeTooltip(mode) {
    if (mode === "files") {
        return t(
            "xdatahub.ui.node.xmedialistget.scope_files_tooltip",
            "Only files that aren't in a group"
        );
    }
    if (mode === "groups") {
        return t(
            "xdatahub.ui.node.xmedialistget.scope_groups_tooltip",
            "Only files that are in a group"
        );
    }
    return t(
        "xdatahub.ui.node.xmedialistget.scope_all_tooltip",
        "Every file, grouped or not"
    );
}

/**
 * ✔ ✖ ⇄ 这三个按钮这次要动哪些文件。
 *
 * - 单击过某个组头 → 只动这一组的成员（最具体的指令优先）
 * - 否则按工具栏那枚胶囊：files 只动未分组 / groups 只动已分组 / all 全都动
 */
function scopeRows(state) {
    const rows = state?.items?.[state.category] || [];
    const groupId = state?.scopeGroup;
    if (groupId) {
        const members = rows.filter(
            (row) => row && (row.group || null) === groupId
        );
        if (members.length) {
            return members;
        }
    }
    const mode = state?.enableScope || "all";
    if (mode === "files") {
        return rows.filter((row) => row && !row.group);
    }
    if (mode === "groups") {
        return rows.filter((row) => row && row.group);
    }
    return rows.slice();
}

/**
 * 把「目标行」设成开 / 关，范围外的行一个都不碰。
 *
 * 名额是全局的（上限 MAX_ENABLED）：先数一遍目标行里已经开着的，
 * 剩下的名额再从前往后分配，没分到的返回数量去提示。
 * 注意这里「只加不减」——名额不够时不会把用户原本开着的行关掉。
 */
function applyScopeEnabled(rows, targets, enabled, limit) {
    const set = new Set(Array.isArray(targets) ? targets : []);
    if (!set.size) {
        return 0;
    }
    // 名额 = 上限 - 已经开着的（范围内 + 范围外都算，上限是全局的）
    let used = 0;
    for (const row of rows) {
        if (row && row.enabled !== false) {
            used += 1;
        }
    }
    let budget = Math.max(0, limit - used);
    let skipped = 0;
    for (const row of rows) {
        if (!row || !set.has(row)) {
            continue;
        }
        if (!enabled) {
            row.enabled = false;
            continue;
        }
        if (row.enabled !== false) {
            continue;
        }
        if (budget > 0) {
            row.enabled = true;
            budget -= 1;
        } else {
            skipped += 1;
        }
    }
    return skipped;
}

/**
 * 反相：先只翻转目标行，再按全局名额从后往前收。
 *
 * 收的时候优先关掉「这次刚被打开、且在范围内」的那些，范围外原本开着的
 * 尽量留到最后才动——用户没要求碰它们。
 */
function applyScopeInvert(rows, targets, limit) {
    const set = new Set(Array.isArray(targets) ? targets : []);
    if (!set.size) {
        return 0;
    }
    for (const row of rows) {
        if (row && set.has(row)) {
            row.enabled = row.enabled === false;
        }
    }
    let total = rows.filter((row) => row && row.enabled !== false).length;
    let skipped = 0;
    for (let index = rows.length - 1; index >= 0 && total > limit; index -= 1) {
        const row = rows[index];
        if (!row || row.enabled === false || !set.has(row)) {
            continue;
        }
        row.enabled = false;
        total -= 1;
        skipped += 1;
    }
    for (let index = rows.length - 1; index >= 0 && total > limit; index -= 1) {
        const row = rows[index];
        if (!row || row.enabled === false) {
            continue;
        }
        row.enabled = false;
        total -= 1;
    }
    return skipped;
}

/**
 * 收窄到某一组：先把当前档位记下来，取消时好退回去。
 * 连续点不同的组不会把记下的那一档覆盖成「分组」。
 */
function narrowToGroup(state, groupId) {
    if (!state || !groupId) {
        return;
    }
    if (!state.scopeGroup) {
        state.scopeGroupBack = state.enableScope;
    }
    state.scopeGroup = groupId;
    state.enableScope = "groups";
}

/**
 * 取消「只作用于某一组」，并把档位退回收窄之前那一档。
 * 只收窄不留退路的话，点两下点了等于没点：组不作用于任何分组，
 * 胶囊却还亮着「分组」，✔ ✖ ⇄ 就作用在一堆你没打算动的文件上。
 */
function clearScopeGroup(state) {
    if (!state) {
        return;
    }
    state.scopeGroup = null;
    const back = state.scopeGroupBack;
    state.scopeGroupBack = null;
    if (ENABLE_SCOPES.includes(back)) {
        state.enableScope = back;
    }
}

/** 切换那枚胶囊的档位（顺手取消「只作用于某一组」）。 */
function selectScope(node, mode) {
    const panel = node?.__xmlg_panel;
    const state = panel?.state;
    if (!panel || !state || !ENABLE_SCOPES.includes(mode)) {
        return;
    }
    if (state.enableScope === mode && !state.scopeGroup) {
        return;
    }
    state.enableScope = mode;
    state.scopeGroup = null;
    // 用户自己点了档位，之前记的「退回去」就不要了
    state.scopeGroupBack = null;
    refreshScopeOnly(node);
}

/**
 * 单击组头 = 让 ✔ ✖ ⇄ 只作用于这一组。
 *
 * 再点一次取消；档位同时挪到「分组」，否则胶囊亮着「全部」、
 * 实际却只动一组，看起来自相矛盾。
 */
function toggleScopeGroup(node, category, groupId) {
    const panel = node?.__xmlg_panel;
    const state = panel?.state;
    if (!panel || !state || !groupId || state.category !== category) {
        return;
    }
    if (state.scopeGroup === groupId) {
        clearScopeGroup(state);
        refreshScopeOnly(node);
        return;
    }
    narrowToGroup(state, groupId);
    refreshScopeOnly(node);
    const record = groupRecord(node, category, groupId);
    showToast(
        node,
        t(
            "xdatahub.ui.node.xmedialistget.scope_group_toast",
            "✔ ✖ ⇄ now act on {name} only",
            { name: groupSeqLabel(record || { id: groupId }) }
        )
    );
}

/**
 * 只刷新「✔ ✖ ⇄ 的作用范围」相关的零星部件，**不重建列表**。
 *
 * 重建列表会换掉所有元素，双击改名的第二下就落到新元素上了，
 * 于是「双击组名」永远进不去。范围切换本来也不需要动任何一行，
 * 所以这里只调胶囊、组标签、组头描边和三个按钮的可用状态。
 */
function refreshScopeOnly(node) {
    const panel = node?.__xmlg_panel;
    const state = panel?.state;
    if (!panel || !state) {
        return;
    }
    const batchable = scopeRows(state).length > 0;
    panel.enableAllButton.disabled = !batchable;
    panel.disableAllButton.disabled = !batchable;
    panel.invertButton.disabled = !batchable;
    syncScopeUi(node, { heads: true });
}

/** 把范围胶囊、组标签、组头高亮跟当前数据对齐。 */
function syncScopeUi(node, options = {}) {
    const panel = node?.__xmlg_panel;
    const state = panel?.state;
    if (!panel || !state) {
        return null;
    }
    const rows = state.items[state.category] || [];
    const groups = state.items.groups?.[state.category] || [];
    // 组已经被解散 / 清空 → 别再指着它
    if (
        state.scopeGroup
        && !groups.some((group) => group.id === state.scopeGroup)
    ) {
        // 指着的那一组已经没了：档位一起退回去，别停在「分组」上
        clearScopeGroup(state);
    }
    const counts = {
        files: rows.filter((row) => row && !row.group).length,
        groups: rows.filter((row) => row && row.group).length,
    };
    counts.all = rows.length;
    for (const [mode, button] of panel.scopeButtons) {
        const active = state.enableScope === mode;
        button.classList.toggle("is-active", active);
        button.classList.toggle("is-empty", (counts[mode] || 0) < 1);
        button.setAttribute("aria-pressed", active ? "true" : "false");
    }
    const scoped = state.scopeGroup;
    panel.scopeChip.classList.toggle("is-visible", Boolean(scoped));
    // 收起来的时候别让它还能被 Tab 到（它只是看不见，不是不存在）
    panel.scopeChip.tabIndex = scoped ? 0 : -1;
    // 「分组」和后面的组号要拼成同一个胶囊：左半段只收左边圆角，
    // 组号那半用负外边距顶上去把缝吃掉
    panel.scopeButtons
        .get("groups")
        ?.classList.toggle("is-scoped", Boolean(scoped));
    if (scoped) {
        const record = groups.find((group) => group.id === scoped) || {
            id: scoped,
        };
        // 标签上只放号：恒定宽度，名字再长也顶不动工具栏上的按钮
        const label = groupSeqLabel(record);
        panel.scopeChipText.textContent = groupSeqNumber(record) || label;
        panel.scopeChip.dataset.groupId = scoped;
        // 「组 12 · 名字」这种完整说法放进悬停提示，不占工具栏
        const name = String(record.name || "").trim();
        panel.scopeChip.__xmlg_hint = name && name !== label
            ? `${label} · ${name}`
            : t(
                "xdatahub.ui.node.xmedialistget.scope_chip_tooltip",
                "Only this group — click to clear"
            );
        panel.scopeChip.style.setProperty(
            "--xmlg-group-stripe",
            groupStripeColor(record || {})
        );
    } else {
        delete panel.scopeChip.dataset.groupId;
        panel.scopeChip.__xmlg_hint = "";
    }
    if (options.heads === false) {
        return;
    }
    for (const head of panel.list.querySelectorAll(".xmlg-group-head")) {
        head.classList.toggle(
            "is-scope-target",
            Boolean(scoped) && (head.dataset.groupId || "") === scoped
        );
    }
}

function setAllEnabled(node, enabled) {
    const panel = node?.__xmlg_panel;
    if (!panel) {
        return;
    }
    const state = panel.state;
    const items = state.items[state.category] || [];
    // 只动「当前范围」里的文件：全部 / 未分组 / 某一组
    const targets = scopeRows(state);
    if (!items.length || !targets.length) {
        return;
    }
    const skipped = applyScopeEnabled(items, targets, enabled, MAX_ENABLED);
    writeItems(node, state.items);
    renderPanel(node);
    if (skipped > 0) {
        showToast(
            node,
            t(
                "xdatahub.ui.node.xmedialistget.limit_scope_hit",
                "{count} stayed Disabled — {limit} is the limit",
                { count: skipped, limit: MAX_ENABLED }
            )
        );
    }
}

function invertEnabled(node) {
    const panel = node?.__xmlg_panel;
    if (!panel) {
        return;
    }
    const state = panel.state;
    const items = state.items[state.category] || [];
    if (!items.length) {
        return;
    }
    const targets = scopeRows(state);
    if (!targets.length) {
        return;
    }
    const skipped = applyScopeInvert(items, targets, MAX_ENABLED);
    writeItems(node, state.items);
    renderPanel(node);
    if (skipped > 0) {
        showToast(
            node,
            t(
                "xdatahub.ui.node.xmedialistget.limit_scope_hit",
                "{count} stayed Disabled — {limit} is the limit",
                { count: skipped, limit: MAX_ENABLED }
            )
        );
    }
}

function bindPanelEvents(node) {
    const panel = node.__xmlg_panel;
    if (!panel) {
        return;
    }
    for (const category of CATEGORIES) {
        panel.tabButtons[category].button.addEventListener("click", () => {
            setCategory(node, category);
        });
    }
    panel.refreshButton.addEventListener("click", () => {
        refreshMissing(node).catch(() => {});
    });
    panel.clearButton.addEventListener("click", () => {
        clearCurrentCategory(node);
    });
    for (const [mode, button] of panel.scopeButtons) {
        button.addEventListener("click", () => {
            selectScope(node, mode);
        });
    }
    panel.scopeChip.addEventListener("click", () => {
        const state = node.__xmlg_panel?.state;
        if (!state) {
            return;
        }
        clearScopeGroup(state);
        refreshScopeOnly(node);
    });
    panel.enableAllButton.addEventListener("click", () => {
        setAllEnabled(node, true);
    });
    panel.disableAllButton.addEventListener("click", () => {
        setAllEnabled(node, false);
    });
    panel.invertButton.addEventListener("click", () => {
        invertEnabled(node);
    });
    panel.groupButton.addEventListener("click", () => {
        createGroupFromCurrentSelection(node);
    });
    // 点列表空白处取消选择（点行由行自己处理）
    panel.list.addEventListener("click", (event) => {
        const state = node.__xmlg_panel?.state;
        if (!state || !state.selection.size) {
            return;
        }
        if (event.target?.closest?.(".xmlg-row, .xmlg-group-head")) {
            return;
        }
        state.selection.clear();
        state.selectionAnchor = null;
        renderPanel(node);
    });
    bindHint(panel.enableAllButton, () => t(
        "xdatahub.ui.node.xmedialistget.enable_all",
        "All enabled"
    ));
    bindHint(panel.disableAllButton, () => t(
        "xdatahub.ui.node.xmedialistget.disable_all",
        "All disabled"
    ));
    bindHint(panel.invertButton, () => t(
        "xdatahub.ui.node.xmedialistget.invert_enabled",
        "Invert switches"
    ));
    bindHint(panel.refreshButton, () => t(
        "xdatahub.ui.node.xmedialistget.refresh_tooltip",
        "Check again whether these files still exist on disk."
    ));
    bindHint(panel.clearButton, () => t(
        "xdatahub.ui.node.xmedialistget.clear_tooltip",
        "Remove every file in the current category."
    ));
    bindHint(panel.undoButton, () => t(
        "xdatahub.ui.node.xmedialistget.undo_tooltip",
        "Undo last step"
    ));
    bindHint(panel.redoButton, () => t(
        "xdatahub.ui.node.xmedialistget.redo_tooltip",
        "Redo last undo"
    ));
    panel.undoButton.addEventListener("click", () => {
        undoLastChange(node);
    });
    panel.redoButton.addEventListener("click", () => {
        redoLastChange(node);
    });
    panel.warningInput.addEventListener("change", () => {
        const widget = findWidget(node, TYPE_WARNING_WIDGET);
        if (widget) {
            widget.value = panel.warningInput.checked;
        }
        node.setDirtyCanvas?.(true, true);
        node.graph?.change?.();
    });
}

function hasMediaPayload(dataTransfer) {
    try {
        return typeof dataTransfer?.types?.includes === "function"
            && dataTransfer.types.includes(XDATAHUB_MEDIA_MIME);
    } catch {
        return false;
    }
}

function dragTypeFromDataTransfer(dataTransfer) {
    const types = dataTransfer?.types;
    if (!types || typeof types.length !== "number") {
        return "";
    }
    // 不限定在 CATEGORIES 内：LoRA / 文本等不支持的类型也要能识别出来，
    // 否则拖它们进来时既不提示类型不符，也没有任何反馈。
    for (let index = 0; index < types.length; index += 1) {
        const value = String(types[index] || "");
        if (!value.startsWith(XDATAHUB_TYPE_MIME_PREFIX)) {
            continue;
        }
        const type = value
            .slice(XDATAHUB_TYPE_MIME_PREFIX.length)
            .trim()
            .toLowerCase();
        if (type) {
            return type;
        }
    }
    return "";
}

function isSupportedCategory(type) {
    return CATEGORIES.includes(String(type || "").toLowerCase());
}

function unsupportedDragType(dataTransfer) {
    if (!hasMediaPayload(dataTransfer)) {
        return "";
    }
    const type = dragTypeFromDataTransfer(dataTransfer);
    return type && !isSupportedCategory(type) ? type : "";
}

function unsupportedTypeLabel(type) {
    const fallback = { lora: "LoRA", text: "Text" }[type] || type;
    return t(
        `xdatahub.ui.node.xmedialistget.unsupported_type_${type}`,
        fallback
    );
}

function unsupportedTypeHint(type) {
    const fallback = {
        lora: "LoRA cards become an XLoraGet node when dropped on empty canvas",
        text: "Text cards become an XStringGet node when dropped on empty canvas",
    }[type] || "This kind of card can't be added to a list";
    return t(
        `xdatahub.ui.node.xmedialistget.unsupported_hint_${type}`,
        fallback
    );
}

function unsupportedDropMessage(types) {
    return t(
        "xdatahub.ui.node.xmedialistget.unsupported_drop",
        "{type} can't be added to this list. Only images, videos and audio can go in.",
        { type: types.map(unsupportedTypeLabel).join(", ") }
    );
}

// 类型标记只在 dragstart 时由 XDataHub 卡片写入 dataTransfer.types，
// drop 阶段才能读明文；这里作为兜底，直接从拖动内容里取类型。
function payloadMediaTypes(dataTransfer) {
    let payload = null;
    try {
        const raw = dataTransfer?.getData(XDATAHUB_MEDIA_MIME) || "";
        payload = raw ? JSON.parse(raw) : null;
    } catch {
        return [];
    }
    if (!payload || typeof payload !== "object") {
        return [];
    }
    const rawItems = Array.isArray(payload.items) ? payload.items : [payload];
    const types = [];
    for (const item of rawItems) {
        if (!item || typeof item !== "object") {
            continue;
        }
        const type = String(
            item.media_type || item.type || ""
        ).trim().toLowerCase();
        if (type && !types.includes(type)) {
            types.push(type);
        }
    }
    return types;
}

function explainRejectedDrop(node, dataTransfer) {
    const types = payloadMediaTypes(dataTransfer);
    const unsupported = types.filter((type) => !isSupportedCategory(type));
    if (unsupported.length) {
        showToast(node, unsupportedDropMessage(unsupported), {
            warning: true,
        });
        return;
    }
    if (types.length > 1) {
        showToast(
            node,
            t(
                "xdatahub.ui.node.xmedialistget.mixed_type_drop",
                "One type at a time: these cards mix different types"
            ),
            { warning: true }
        );
        return;
    }
    showToast(
        node,
        t(
            "xdatahub.ui.node.xmedialistget.drop_rejected",
            "These items can't be added to this list"
        ),
        { warning: true }
    );
}

function dragCountFromDataTransfer(dataTransfer) {
    const types = dataTransfer?.types;
    if (!types || typeof types.length !== "number") {
        return 0;
    }
    for (let index = 0; index < types.length; index += 1) {
        const value = String(types[index] || "");
        if (!value.startsWith(XDATAHUB_COUNT_MIME_PREFIX)) {
            continue;
        }
        const count = Number(
            value.slice(XDATAHUB_COUNT_MIME_PREFIX.length)
        );
        if (Number.isFinite(count) && count > 0) {
            return Math.floor(count);
        }
    }
    return 0;
}

function parseDropPayload(dataTransfer) {
    let raw = "";
    try {
        raw = dataTransfer.getData(XDATAHUB_MEDIA_MIME) || "";
    } catch {
        return null;
    }
    if (!raw) {
        return null;
    }
    let payload = null;
    try {
        payload = JSON.parse(raw);
    } catch {
        return null;
    }
    if (!payload || typeof payload !== "object") {
        return null;
    }
    const source = String(payload.source || "").toLowerCase();
    if (source && source !== "xdatahub") {
        return null;
    }
    const rawItems = Array.isArray(payload.items) ? payload.items : [payload];
    const entries = [];
    for (const item of rawItems) {
        if (!item || typeof item !== "object") {
            continue;
        }
        const ref = String(item.media_ref || item.ref || "").trim();
        const mediaType = String(
            item.media_type || item.type || ""
        ).trim().toLowerCase();
        if (!ref || !CATEGORIES.includes(mediaType)) {
            continue;
        }
        entries.push({
            ref,
            type: mediaType,
            title: String(item.title || ""),
        });
    }
    if (!entries.length) {
        return null;
    }
    const firstType = entries[0].type;
    if (entries.some((entry) => entry.type !== firstType)) {
        return null;
    }
    return { type: firstType, entries };
}

function ensureDragState(node, dataTransfer) {
    const panel = node?.__xmlg_panel;
    if (!panel) {
        return null;
    }
    const state = panel.state;
    const type = dragTypeFromDataTransfer(dataTransfer);
    if (!state.drag) {
        state.drag = {
            type: type || null,
            target: null,
            pendingTimer: 0,
        };
    } else if (type) {
        state.drag.type = type;
    }
    return state.drag;
}

/**
 * 按组头和最后一行的实际位置重画每组那根竖线。
 *
 * 为什么不能只在 renderPanel 里算一次：节点刚创建 / 刚刷新网页时，
 * DOM 小组件可能还没挂进画布，所有行的位置和高度都还是 0，
 * 算出来的竖线只有 3px（等于看不见），必须等布局好了再算一次。
 */
function layoutGroupRails(panel, force = false) {
    if (!panel?.railHosts?.size || !panel.list?.isConnected) {
        return;
    }
    // 列表只变高（拖节点上下边）不会挪动任何一行，宽度没变就不用重新量。
    // 省掉的是一次强制重排：300 行的列表约 4ms，拖动时会一帧一次。
    // 收放动画期间要 force：行的高度一直在变，竖线必须跟着走。
    const width = panel.list.clientWidth;
    if (!force && panel.railMeasured && panel.railWidth === width) {
        return;
    }
    // 先把所有位置量完，再统一写样式。边量边写会让浏览器每改一次
    // 样式就重排一次，几十个组在拖动窗口时会明显卡顿。
    const plan = [];
    for (const host of panel.railHosts.values()) {
        // 组名那一行都藏起来了（拖整组时整组离开列表），竖线没有落点，
        // 先收起来；等放回来再重新量
        const headVisible = !!host.head?.isConnected
            && host.head.offsetHeight > 0
            && !host.head.classList.contains("is-drag-collapsed");
        if (!headVisible || host.rail.style.display === "none") {
            const want = headVisible ? "" : "none";
            if (host.rail.style.display !== want) {
                host.rail.style.display = want;
                host.top = null;
                host.height = null;
            }
            if (!headVisible) {
                continue;
            }
        }
        // 最后一个「还看得见」的成员行：拖动中被拖的那行是藏起来的，
        // 整组拖动时成员也全藏着，量出来都是 0，会把竖线缩成一个小残点
        const edge = lastVisibleMember(
            panel.list,
            host.head?.dataset.groupId || "",
            host.last
        ) || host.head;
        const top = host.head.offsetTop;
        const height = Math.max(3, edge.offsetTop + edge.offsetHeight - top);
        if (host.top === top && host.height === height) {
            continue;
        }
        plan.push({ host, top, height });
    }
    for (const { host, top, height } of plan) {
        host.top = top;
        host.height = height;
        host.rail.style.top = `${top}px`;
        host.rail.style.height = `${height}px`;
    }
    panel.railWidth = width;
    panel.railMeasured = width > 0;
}

/**
 * 折叠 / 展开的那 160ms 里，每帧把所有组的竖线重量一次。
 *
 * 为什么非跟不可：竖线的 top / height 是缓存下来的绝对坐标，被折叠那组
 * 一变高变矮，它下面所有组的位置就跟着上下走——只钉死自己的那一根，
 * 别的组就会错位。（只让被折叠那组动也不行：它下面那些组照样要挪。）
 */
function followRailsDuringFold(panel) {
    if (!panel?.list) {
        return;
    }
    const token = (panel.railToken || 0) + 1;
    panel.railToken = token;
    const startedAt = performance.now();
    const tick = () => {
        if (!panel.list?.isConnected || panel.railToken !== token) {
            return;
        }
        layoutGroupRails(panel, true);
        // 多跟 100ms：收拢那 160ms 之后还有一次重画，重画完的位置
        // 也得量一遍才算齐
        if (performance.now() - startedAt < SLIDE_MS + 120) {
            window.requestAnimationFrame(tick);
        }
    };
    window.requestAnimationFrame(tick);
}

/** 这一组里最后一个还看得见的成员行（都看不见就返回兜底元素）。 */
function lastVisibleMember(list, groupId, fallback) {
    if (!list || !groupId) {
        return fallback;
    }
    const rows = list.querySelectorAll(
        `.xmlg-row[data-group="${groupId}"]`
    );
    for (let index = rows.length - 1; index >= 0; index -= 1) {
        if (rows[index].offsetHeight > 0) {
            return rows[index];
        }
    }
    return fallback && fallback.offsetHeight > 0 ? fallback : null;
}

/** 列表尺寸变化（首次挂载、窗口缩放、节点缩放）就重排竖线。 */
function ensureRailObserver(panel) {
    if (panel.railObserver || typeof ResizeObserver !== "function") {
        return;
    }
    panel.railObserver = new ResizeObserver(() => layoutGroupRails(panel));
    panel.railObserver.observe(panel.list);
}

/** 某一组在数据里的最后一位之后（折叠组追加到这里）。 */
function appendIndexForGroup(items, groupId) {
    const rows = Array.isArray(items) ? items : [];
    let last = -1;
    rows.forEach((row, index) => {
        if (row && row.group === groupId) {
            last = index;
        }
    });
    return last >= 0 ? last + 1 : rows.length;
}

/** 指针当前压在哪个 .xmlg-row 上（压在组头/空白处返回 null）。 */
function rowAtPointer(list, clientY) {
    for (const row of list.querySelectorAll(".xmlg-row")) {
        const rect = row.getBoundingClientRect();
        if (clientY >= rect.top && clientY <= rect.bottom) {
            return row;
        }
    }
    return null;
}

/**
 * 落点属于哪一组。
 *
 * 指针停在哪一组的行上就算哪一组 —— 用户把文件拖到「组的地盘」里，
 * 意思很明确就是加入这一组，不该只有拖到组头才生效。
 * 只有指针落在空白处（没有任何行）时，才退回老规则「跟上方那一行」。
 */
function groupForDrop(list, items, gapIndex, clientY) {
    const row = rowAtPointer(list, clientY);
    if (row) {
        return row.dataset.group || null;
    }
    return groupOfGap(items, gapIndex);
}

/** 组名（提示里要说人话：「插入到「风格」」）。 */
function groupNameById(node, category, groupId) {
    if (!groupId) {
        return "";
    }
    const groups = node?.__xmlg_panel?.state?.items?.groups?.[category] || [];
    const record = groups.find((item) => item.id === groupId);
    return record?.name || groupId;
}

/**
 * 「第几个缝」换算成「抽走自己之后插到第几位」。
 * 往下拖要减 1：自己被抽走后，下面的行整体前移一格。
 */
function moveTargetFromGap(gapIndex, fromIndex) {
    return gapIndex > fromIndex ? gapIndex - 1 : gapIndex;
}

function startDropAutoScroll(node, dir) {
    const panel = node?.__xmlg_panel;
    if (!panel) {
        return;
    }
    const state = panel.state;
    if (state.autoScrollRaf && state.autoScrollDir === dir) {
        return;
    }
    stopDropAutoScroll(state);
    state.autoScrollDir = dir;
    const tick = () => {
        if (!state.autoScrollDir || !panel.list.isConnected) {
            state.autoScrollRaf = 0;
            return;
        }
        panel.list.scrollTop += state.autoScrollDir * DROP_AUTOSCROLL_STEP;
        // 指针没动，但列表滚了：落点要跟着重算，否则滚半天不挪位
        const pending = state.pointerDrag;
        if (pending?.active) {
            applyPointerDrag(node, pending.clientY);
            // 重算落点可能把方向翻了个面（换了新的循环），这里别重复排
            if (!state.autoScrollDir) {
                return;
            }
        }
        state.autoScrollRaf = window.requestAnimationFrame(tick);
    };
    state.autoScrollRaf = window.requestAnimationFrame(tick);
}

function stopDropAutoScroll(state) {
    if (!state) {
        return;
    }
    if (state.autoScrollRaf) {
        window.cancelAnimationFrame(state.autoScrollRaf);
        state.autoScrollRaf = 0;
    }
    state.autoScrollDir = 0;
}

/* 拖动时把「即将加入的那一组」圈出来，落点归属一眼可见。 */
function markGroupTarget(panel, groupId) {
    if (!panel) {
        return;
    }
    for (const target of panel.list.querySelectorAll(".is-group-target")) {
        target.classList.remove("is-group-target");
    }
    if (!groupId) {
        return;
    }
    panel.list
        .querySelector(`.xmlg-group-head[data-group-id="${groupId}"]`)
        ?.classList.add("is-group-target");
    for (const row of panel.list.querySelectorAll(
        `.xmlg-row[data-group="${groupId}"]`
    )) {
        row.classList.add("is-group-target");
    }
}

/** 拖动整组时把这一摞行一起变淡，让人看出搬的是整块。 */
function markGroupBlockDragging(panel, groupId, active) {
    if (!panel?.list || !groupId) {
        return;
    }
    for (const row of panel.list.querySelectorAll(
        `.xmlg-row[data-group="${groupId}"]`
    )) {
        row.classList.toggle("is-block-dragging", active);
    }
    panel.railHosts?.get(groupId)?.rail.classList.toggle(
        "is-block-dragging",
        active
    );
}

/**
 * 拖整组时，列表里这一组当场折起来，只留组名那一行。
 *
 * Chromium 拖标签组也是这么做的（拖起来就把组收成一行）：
 * 一来拖一整摞的时候，屏幕上还占着一整摞会让人分不清「跟着鼠标的是什么」，
 * 二来折叠后它只占一行，落点算起来和折叠组完全一致。
 *
 * 只改显示，不动数据：拖完 / 取消就恢复展开。
 */
function setGroupDragCollapsed(panel, groupId, collapsed) {
    if (!panel?.list || !groupId) {
        return;
    }
    // 组名那一行也一起藏：拖整组时列表里什么都不留，
    // 屏幕上只剩跟着指针的那张卡片（Chromium 拖标签组也是这样）
    const targets = [
        ...panel.list.querySelectorAll(`.xmlg-row[data-group="${groupId}"]`),
        ...panel.list.querySelectorAll(
            `.xmlg-group-head[data-group-id="${groupId}"]`
        ),
    ];
    for (const element of targets) {
        element.classList.toggle("is-drag-collapsed", collapsed);
    }
    panel.railMeasured = false;
    layoutGroupRails(panel);
}

/** 开拖：记下起点、抓取偏移、以及「取消就还原」的快照。 */
function beginRowDrag(node, category, row, event) {
    const panel = node?.__xmlg_panel;
    if (!panel) {
        return;
    }
    const state = panel.state;
    const index = Number(row.dataset.index);
    const safeIndex = Number.isFinite(index) ? index : 0;
    // 尺寸必须在「藏起来之前」量：藏起来（display: none）之后
    // 量到的全是 0，跟手的那张卡片就会变成一小撮
    const rect = row.getBoundingClientRect();
    state.dragRow = {
        category,
        index: safeIndex,
        ref: row.dataset.ref || "",
        // 行身份：同一个文件有多份时，要认得出拖的是哪一份
        key: XMLG_KEY_OF((state.items[category] || [])[safeIndex] || {}),
        rect: {
            left: rect.left,
            top: rect.top,
            width: rect.width,
            height: rect.height,
        },
        layoutW: row.offsetWidth,
        layoutH: row.offsetHeight,
        // undefined = 还没定过归属；null = 明确不分组
        groupId: undefined,
        // 开拖时它在哪一组：用它做「粘性」，让人容易留在原组
        groupOrigin: (state.items[category] || [])[safeIndex]?.group || null,
        grabOffsetY: Math.max(0, event.clientY - rect.top),
        height: rect.height || 44,
        lastY: event.clientY,
        snapshot: JSON.stringify(state.items),
        moved: false,
        dropped: false,
        dissolvedNames: [],
    };
    row.classList.add("is-dragging");
}

/** 收尾（已放下）：补上结构性变化，并把这次的组消失提示说一声。 */
function finishRowDrag(node, dragRow) {
    const panel = node?.__xmlg_panel;
    if (!panel || !dragRow) {
        return;
    }
    dragRow.dropped = true;
    writeItems(node, panel.state.items, { recordUndo: false });
    announceDissolvedGroups(node, dragRow.dissolvedNames);
    if (panel.state.dragRow === dragRow) {
        panel.state.dragRow = null;
    }
}

function beginGroupDrag(node, category, head, groupId, event) {
    const panel = node?.__xmlg_panel;
    if (!panel) {
        return;
    }
    const headRect = head.getBoundingClientRect();
    panel.state.dragGroup = {
        category,
        groupId,
        gap: null,
        rect: {
            left: headRect.left,
            top: headRect.top,
            width: headRect.width,
            height: headRect.height,
        },
        layoutW: head.offsetWidth,
        layoutH: head.offsetHeight,
        lastY: event.clientY,
        snapshot: JSON.stringify(panel.state.items),
        moved: false,
        dropped: false,
        dissolvedNames: [],
    };
    head.classList.add("is-dragging");
    markGroupBlockDragging(panel, groupId, true);
    setGroupDragCollapsed(panel, groupId, true);
}

/** 整组收尾（已放下）：把模型写回去，组消失的提示说一声。 */
function finishGroupDrag(node, dragGroup) {
    const panel = node?.__xmlg_panel;
    if (!panel || !dragGroup) {
        return;
    }
    dragGroup.dropped = true;
    markGroupBlockDragging(panel, dragGroup.groupId, false);
    setGroupDragCollapsed(panel, dragGroup.groupId, false);
    if (panel.state.dragGroup === dragGroup) {
        panel.state.dragGroup = null;
    }
    writeItems(node, panel.state.items, { recordUndo: false });
    announceDissolvedGroups(node, dragGroup.dissolvedNames);
}

/** 整段拖动只算一次撤销：第一次真的挪动时才记快照。 */
function ensureDragUndo(node) {
    const panel = node?.__xmlg_panel;
    const drag = panel?.state?.dragRow || panel?.state?.dragGroup;
    if (!panel || !drag || drag.undoTaken) {
        return;
    }
    drag.undoTaken = true;
    drag.pushedValue = String(ensureStorageWidget(node)?.value || "{}");
    pushUndoSnapshot(node);
    panel.state.redoStack = [];
}

/** 取消拖动：数据回滚到开拖前，撤销栈里那条也撤掉（这次没改成任何东西）。 */
function restoreDragSnapshot(node, drag) {
    const panel = node?.__xmlg_panel;
    if (!panel || !drag?.snapshot) {
        return;
    }
    let items = panel.state.items;
    try {
        items = normalizeItems(JSON.parse(drag.snapshot));
    } catch {
        return;
    }
    panel.state.items = items;
    const stack = panel.state.undoStack || [];
    if (
        drag.pushedValue !== undefined
        && stack[stack.length - 1] === drag.pushedValue
    ) {
        stack.pop();
        panel.state.undoStack = stack;
    }
    writeItems(node, items, { recordUndo: false });
    renderPanel(node);
}

function collectDissolved(drag, dissolved) {
    if (!drag || !Array.isArray(dissolved)) {
        return;
    }
    drag.dissolvedNames = drag.dissolvedNames || [];
    for (const record of dissolved) {
        const name = record?.name || record?.id || "";
        if (name && !drag.dissolvedNames.includes(name)) {
            drag.dissolvedNames.push(name);
        }
    }
}

function announceDissolvedGroups(node, names) {
    if (!Array.isArray(names) || !names.length) {
        return;
    }
    showToast(
        node,
        t(
            "xdatahub.ui.node.xmedialistget.group_dissolved",
            "Group {name} has no files left, so it was removed",
            { name: names.join(", ") }
        )
    );
}

/** 整组拖动：落点一变就真的搬过去（不再画插入线）。 */
function liveMoveGroup(node, gapIndex) {
    const panel = node?.__xmlg_panel;
    const dragGroup = panel?.state?.dragGroup;
    const state = panel?.state;
    if (!panel || !dragGroup || !state) {
        return false;
    }
    if (dragGroup.category !== state.category) {
        return false;
    }
    const rows = state.items[state.category];
    if (!Array.isArray(rows)) {
        return false;
    }
    const result = moveGroupToGap(
        rows,
        state.items.groups?.[state.category] || [],
        dragGroup.groupId,
        gapIndex
    );
    dragGroup.gap = result.gap;
    if (!result.moved) {
        return false;
    }
    state.items[state.category] = result.items;
    state.items.groups[state.category] = result.groups;
    dragGroup.moved = true;
    collectDissolved(dragGroup, result.dissolved);
    ensureDragUndo(node);
    applyOrderInPlace(node, { animate: true });
    writeItems(node, state.items, { recordUndo: false });
    return true;
}

/** 单行拖动：落点一变就真的挪过去，并记住它现在在第几位。 */
function liveMoveRow(node, gapIndex, groupId) {
    const panel = node?.__xmlg_panel;
    const dragRow = panel?.state?.dragRow;
    const state = panel?.state;
    if (!panel || !dragRow || !state) {
        return false;
    }
    if (dragRow.category !== state.category) {
        return false;
    }
    const rows = state.items[state.category];
    if (!Array.isArray(rows)) {
        return false;
    }
    const from = Number(dragRow.index);
    const gap = Number(gapIndex);
    if (!Number.isFinite(from) || from < 0 || from >= rows.length) {
        return false;
    }
    if (!Number.isFinite(gap)) {
        return false;
    }
    const wanted = groupId === undefined
        ? dragRow.groupId
        : groupId;
    const staysPut = moveTargetFromGap(gap, from) === from;
    const sameGroup = (wanted === undefined ? null : wanted || null)
        === (rows[from]?.group || null);
    if (staysPut && sameGroup) {
        return false;
    }
    const options = { keyOf: XMLG_KEY_OF };
    if (wanted !== undefined) {
        options.groupId = wanted || null;
    }
    const result = moveRowToGap(
        rows,
        state.items.groups?.[state.category] || [],
        from,
        gap,
        options
    );
    state.items[state.category] = result.items;
    state.items.groups[state.category] = result.groups;
    const nextIndex = result.items.findIndex(
        (row) => XMLG_KEY_OF(row) === dragRow.key
    );
    if (nextIndex >= 0) {
        dragRow.index = nextIndex;
    }
    dragRow.groupId = result.groupId;
    dragRow.moved = true;
    collectDissolved(dragRow, result.dissolved);
    ensureDragUndo(node);
    applyOrderInPlace(node, { animate: true });
    writeItems(node, state.items, { recordUndo: false });
    return true;
}

/* ==========================================================================
 * 列表内拖动：拖动过程中就真的改顺序（Chromium 标签条的做法）
 *
 * 三个要点：
 * 1. 穿过某一行就把数据真的挑过去，其它行「滑开让位」——
 *    用户看到的落点就是事实，不再需要插入线。
 * 2. 行元素不重建，只搬位置；搬完用「先量旧位置、改完再量新位置、
 *    反向位移做动画」的办法让它滑回去（业界叫 FLIP）。
 * 3. 归属哪一组用 Chromium 那套：看缝上下两行 + 四分之一行高的中性带
 *    + 「粘住原组」，不再只看指针压在哪一行上。
 *
 * 插入线只留给「从 XDataHub 拖新文件进来」，因为那个场景里还没
 * 有真位置可展示。
 * ========================================================================== */


/* ---------- 指针拖动引擎（行 / 整组共用） ---------- */

/**
 * 按下时只记一笔，移动超过 DRAG_START_PX 才算拖动。
 * 这样单击选中、点开关、点缩略图、点按钮都不受影响。
 */
function armPointerDrag(node, event, intent) {
    const panel = node?.__xmlg_panel;
    if (!panel || event.button !== 0 || event.isPrimary === false) {
        return;
    }
    if (event.target?.closest?.("button, input, label, .xmlg-thumb")) {
        return;
    }
    const state = panel.state;
    if (state.pointerDrag?.active) {
        return;
    }
    const pending = {
        ...intent,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        clientY: event.clientY,
        active: false,
    };
    const onMove = (moveEvent) => {
        if (moveEvent.pointerId !== pending.pointerId) {
            return;
        }
        movePointerDrag(node, moveEvent);
    };
    const onUp = (upEvent) => {
        if (upEvent.pointerId !== pending.pointerId) {
            return;
        }
        endPointerDrag(node);
    };
    const onKey = (keyEvent) => {
        if (keyEvent.key !== "Escape") {
            return;
        }
        keyEvent.preventDefault();
        cancelPointerDrag(node);
    };
    pending.cleanup = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
        window.removeEventListener("keydown", onKey, true);
    };
    state.pointerDrag = pending;
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    window.addEventListener("keydown", onKey, true);
}

function armRowPointerDrag(node, category, row, event) {
    armPointerDrag(node, event, {
        kind: "row",
        category,
        row,
        ref: row.dataset.ref || "",
    });
}

function armGroupPointerDrag(node, category, head, groupId, event) {
    armPointerDrag(node, event, {
        kind: "group",
        category,
        head,
        groupId,
    });
}

function movePointerDrag(node, event) {
    const panel = node?.__xmlg_panel;
    const pending = panel?.state?.pointerDrag;
    if (!panel || !pending) {
        return;
    }
    pending.clientY = event.clientY;
    if (!pending.active) {
        const dx = event.clientX - pending.startX;
        const dy = event.clientY - pending.startY;
        if (Math.hypot(dx, dy) < DRAG_START_PX) {
            return;
        }
        startPointerDrag(node, pending, event);
        return;
    }
    event.preventDefault();
    moveGhost(node, event.clientY);
    applyPointerDrag(node, event.clientY);
}

function startPointerDrag(node, pending, event) {
    const panel = node.__xmlg_panel;
    if (pending.kind === "group") {
        beginGroupDrag(
            node,
            pending.category,
            pending.head,
            pending.groupId,
            event
        );
    } else {
        beginRowDrag(node, pending.category, pending.row, event);
    }
    pending.active = true;
    document.body.classList.add("xmlg-pointer-dragging");
    spawnGhost(node, pending);
    applyPointerDrag(node, pending.clientY);
}

/**
 * 按指针位置算落点并当场落地（其它行滑开让位）。
 *
 * 防抖：跟上次真挪动时的指针位置差得够远才允许再挪，否则在两条行的
 * 中线附近会来回抖（Chromium 的 16dip 阈值是同一个思路）。
 */
function applyPointerDrag(node, clientY) {
    const panel = node?.__xmlg_panel;
    const pending = panel?.state?.pointerDrag;
    if (!panel || !pending) {
        return;
    }
    if (pending.kind === "group") {
        // 整组拖动也走同一套防抖：不然在两组交界处挪一个像素就会来回翻
        const dragGroup = panel.state.dragGroup;
        if (!dragGroup) {
            return;
        }
        const groupThreshold = Math.max(
            6,
            (pending.head?.offsetHeight || 28) * GROUP_DRAG_THRESHOLD_RATIO
        );
        const groupFar = Math.abs(clientY - dragGroup.lastY) >= groupThreshold;
        if (groupFar && liveMoveGroup(node, resolveGroupGap(node, clientY))) {
            dragGroup.lastY = clientY;
        }
    } else {
        const dragRow = panel.state.dragRow;
        if (!dragRow) {
            return;
        }
        const target = resolveLiveRowTarget(node, clientY);
        const threshold = Math.max(
            6,
            (dragRow.height || 44) * REORDER_THRESHOLD_RATIO
        );
        const far = Math.abs(clientY - dragRow.lastY) >= threshold;
        if (far && liveMoveRow(node, target.gap, target.groupId)) {
            dragRow.lastY = clientY;
        }
        markGroupTarget(panel, dragRow.groupId || null);
    }
    const rect = panel.list.getBoundingClientRect();
    if (clientY - rect.top < DROP_AUTOSCROLL_EDGE) {
        startDropAutoScroll(node, -1);
    } else if (rect.bottom - clientY < DROP_AUTOSCROLL_EDGE) {
        startDropAutoScroll(node, 1);
    } else {
        stopDropAutoScroll(panel.state);
    }
}

/** 跟着指针走的「卡片」：源行留在列表里当槽位，这个是纯装饰。 */
function spawnGhost(node, pending) {
    const panel = node?.__xmlg_panel;
    const source = pending.kind === "group" ? pending.head : pending.row;
    if (!panel || !source?.isConnected) {
        return;
    }
    // 只清上一张卡片：不能走 removeGhost，它会顺手把「拖动中」这个
    // 全局状态摘掉（竖线的过渡就挂在这个状态上）
    pending.ghost?.remove();
    pending.ghost = null;
    // 行在开拖时就被藏起来了（列表里不留槽位），所以尺寸要用
    // 藏起来之前量的那一份（记在 dragRow / dragGroup 上）
    const drag = pending.kind === "group"
        ? panel.state.dragGroup
        : panel.state.dragRow;
    const rect = drag?.rect || source.getBoundingClientRect();
    const grab = Number.isFinite(pending.startY)
        ? pending.startY - rect.top
        : 0;
    pending.grabOffsetY = Math.max(0, Number.isFinite(grab) ? grab : 0);
    const ghost = source.cloneNode(true);
    // is-drag-collapsed 也摘掉：拖整组时源组名是藏起来的，
    // 克隆带上这个 class 卡片就跟着一起看不见了
    ghost.classList.remove(
        "is-dragging",
        "is-drag-collapsed",
        "is-selected",
        "is-group-target"
    );
    ghost.removeAttribute("data-index");
    ghost.classList.add("xmlg-drag-ghost");
    // 组头本身带 margin-top（和上一组之间留的空），卡片是固定定位，
    // margin 会把盒子整体往下顶 6px，位置上就对不齐了
    ghost.style.margin = "0";
    // 卡片挂在 body 上，那里没有画布的缩放，所以：
    // 1) 尺寸用元素自己的布局尺寸（offsetWidth/Height），不用屏幕尺寸；
    // 2) 再按「屏幕尺寸 / 布局尺寸」算出的画布缩放比缩一下。
    // 不这么做的话，画布缩到 80% 时卡片会按 100% 显示，比原行大一圈，
    // 正好盖住左边的组竖线。
    const layoutW = drag?.layoutW || rect.width || 0;
    const layoutH = drag?.layoutH || rect.height || 0;
    const canvasScale = layoutW > 0
        ? Math.min(4, Math.max(0.1, rect.width / layoutW))
        : 1;
    ghost.style.width = `${layoutW}px`;
    ghost.style.height = `${layoutH}px`;
    // 行本身有 min-height，卡片要按量出来的高度走
    ghost.style.minHeight = "0";
    ghost.style.transformOrigin = "top left";
    // 必须挂 body：ComfyUI 的画布（节点的祖先）带缩放/位移变换，
    // position: fixed 一旦落在这种祖先里，left/top 就按坐标系的算法算，
    // 卡片会跑到屏幕另一边去。挂列表里也不行（会被当成一行）。
    // 颜色变量由 .xmlg-drag-ghost 这条样式自带一份。
    document.body.appendChild(ghost);
    pending.ghost = ghost;

    // 页面还可能有 zoom 之类的整体缩放/位移：写进去的 px 和屏幕上的 px
    // 未必 1:1。这里量一次换算关系（写 0px 和写 100px 分别落在哪），
    // 之后按这个关系换算，任何坐标系下都能落在指针对应的位置。
    ghost.style.left = "0px";
    ghost.style.top = "0px";
    const zero = ghost.getBoundingClientRect();
    ghost.style.top = "100px";
    const down = ghost.getBoundingClientRect();
    ghost.style.left = "100px";
    const right = ghost.getBoundingClientRect();
    const scaleY = (down.top - zero.top) / 100;
    const scaleX = (right.left - zero.left) / 100;
    pending.ghostOriginY = zero.top;
    pending.ghostOriginX = zero.left;
    pending.ghostScaleY = Number.isFinite(scaleY) && scaleY > 0 ? scaleY : 1;
    pending.ghostScaleX = Number.isFinite(scaleX) && scaleX > 0 ? scaleX : 1;
    pending.ghostHeight = Number.isFinite(rect.height) && rect.height > 0
        ? rect.height
        : layoutH;

    // 卡片自己还要缩一下才能真正和原元素一样大。
    // 注意要除掉坐标系本身的缩放：外层已经有 0.7 倍缩放时，
    // 元素在屏幕上量到的宽度本来就小了一圈，再乘一次就变成 0.49 倍。
    const extra = layoutW > 0
        ? Math.min(
            4,
            Math.max(0.1, rect.width / (layoutW * pending.ghostScaleX))
        )
        : canvasScale;
    ghost.style.transform = `scale(${extra})`;
    pending.ghostScale = extra;

    placeGhost(node, rect.left, rect.top);
}

/**
 * 把卡片放到「屏幕上」的某个位置。
 *
 * 写进去的值要按坐标系换算（页面可能有 zoom、画布有缩放），并且兜一层：
 * 非有限值一律不写——写成 NaN 浏览器会当成「没有 top」，
 * 卡片就会掉到页面最下面去。
 *
 * left 传 null 表示「横向不动」（拖动只改纵向）。
 */
function placeGhost(node, screenLeft, screenTop) {
    const pending = node?.__xmlg_panel?.state?.pointerDrag;
    const ghost = pending?.ghost;
    if (!ghost) {
        return;
    }
    const sx = pending.ghostScaleX || 1;
    const sy = pending.ghostScaleY || 1;
    const ox = pending.ghostOriginX || 0;
    const oy = pending.ghostOriginY || 0;
    if (Number.isFinite(screenLeft)) {
        ghost.style.left = `${(screenLeft - ox) / sx}px`;
    }
    if (Number.isFinite(screenTop)) {
        const height = pending.ghostHeight || 0;
        const lowest = window.innerHeight - height - 4;
        const clamped = Math.min(Math.max(0, lowest), Math.max(0, screenTop));
        ghost.style.top = `${(clamped - oy) / sy}px`;
    }
}

function moveGhost(node, clientY) {
    const pending = node?.__xmlg_panel?.state?.pointerDrag;
    if (!pending?.ghost) {
        return;
    }
    const offset = Number.isFinite(pending.grabOffsetY)
        ? pending.grabOffsetY
        : 0;
    if (!Number.isFinite(clientY)) {
        return;
    }
    placeGhost(node, null, clientY - offset);
}

function removeGhost(panel, known) {
    const pending = known || panel?.state?.pointerDrag;
    pending?.ghost?.remove();
    if (pending) {
        pending.ghost = null;
    }
    document.body.classList.remove("xmlg-pointer-dragging");
}

function endPointerDrag(node) {
    const panel = node?.__xmlg_panel;
    const pending = panel?.state?.pointerDrag;
    if (!panel || !pending) {
        return;
    }
    pending.cleanup?.();
    if (!pending.active) {
        removeGhost(panel);
        panel.state.pointerDrag = null;
        return;
    }
    // 先按最终位置落地，再撤掉拖动状态：竖线的过渡挂在拖动状态上，
    // 反过来的话最后一格调整会跳过过渡，松手瞬间竖线会跳一下。
    applyPointerDragStop(node);
    removeGhost(panel);
    panel.state.pointerDrag = null;
    // 拖完必然紧跟一个 click：要吞掉，否则会顺手改了选中状态
    panel.state.suppressClickUntil = performance.now() + 400;
    if (pending.kind === "group") {
        const dragGroup = panel.state.dragGroup;
        panel.state.dragGroup = null;
        if (dragGroup) {
            finishGroupDrag(node, dragGroup);
        }
    } else {
        const dragRow = panel.state.dragRow;
        panel.state.dragRow = null;
        if (dragRow) {
            finishRowDrag(node, dragRow);
        }
    }
    pending.row?.classList.remove("is-dragging");
    pending.head?.classList.remove("is-dragging");
    stopDropAutoScroll(panel.state);
    clearDragHighlights(panel);
}

function applyPointerDragStop(node) {
    const panel = node?.__xmlg_panel;
    const pending = panel?.state?.pointerDrag;
    if (!panel || !pending?.active) {
        return;
    }
    // 松手时按最终位置再算一次，免得最后几像素被阈值吃掉
    if (pending.kind === "group") {
        liveMoveGroup(node, resolveGroupGap(node, pending.clientY));
        return;
    }
    const target = resolveLiveRowTarget(node, pending.clientY);
    liveMoveRow(node, target.gap, target.groupId);
}

/** Esc / 指针被系统收走：这一趟作废，顺序回到按下之前。 */
function cancelPointerDrag(node) {
    const panel = node?.__xmlg_panel;
    const pending = panel?.state?.pointerDrag;
    if (!panel || !pending?.active) {
        return;
    }
    pending.cleanup?.();
    panel.state.pointerDrag = null;
    pending.row?.classList.remove("is-dragging");
    pending.head?.classList.remove("is-dragging");
    const drag = pending.kind === "group"
        ? panel.state.dragGroup
        : panel.state.dragRow;
    panel.state.dragRow = null;
    panel.state.dragGroup = null;
    stopDropAutoScroll(panel.state);
    clearDragHighlights(panel);
    markGroupBlockDragging(panel, pending.groupId, false);
    setGroupDragCollapsed(panel, pending.groupId, false);
    if (drag) {
        restoreDragSnapshot(node, drag);
    }
    // 回滚完再撤「拖动中」：竖线缩回去也走过渡，不突兀
    removeGhost(panel, pending);
}

/**
 * 指针指向哪一格缝隙。
 *
 * 关键在于**一趟扫完行和组胶囊**，用「谁的中线在指针下面」来定缝：
 *
 * - 行：缝落在它前面（等于它的下标）
 * - 组胶囊：缝落在这一组的**第一名成员**前面（折叠组没渲染成员，
 *   所以只能靠胶囊；上半边算「组前面」，下半边自然落到下一段）
 * - 都没有：列表末尾
 *
 * 这样映射是**单调**的：指针从上往下扫，扫到胶囊中线之前一直是「组前
 * 面」那一格，越过后才变成「组后面」。以前分成「压在胶囊上就强行进这
 * 一组」和「按行算」两条路，指针停在胶囊上沿时两者来回抢，就抖起来了。
 */
function resolveFlowGap(node, clientY) {
    const panel = node?.__xmlg_panel;
    const state = panel?.state;
    const list = panel?.list;
    if (!panel || !state || !list) {
        return 0;
    }
    const items = state.items[state.category] || [];
    for (const child of list.children) {
        const isRow = child.classList.contains("xmlg-row");
        const isHead = child.classList.contains("xmlg-group-head");
        if (!isRow && !isHead) {
            continue;
        }
        const rect = child.getBoundingClientRect();
        if (clientY >= rect.top + rect.height / 2) {
            continue;
        }
        if (isRow) {
            const index = Number(child.dataset.index);
            if (Number.isFinite(index)) {
                return index;
            }
            continue;
        }
        return firstIndexForGroup(items, child.dataset.groupId || "");
    }
    return items.length;
}

/**
 * 指针现在指向哪一格缝隙、归哪一组。
 *
 * 归属只看位置（Chromium 那套「中性带 + 粘性」），
 * 组胶囊不再是一条特殊的「放上来就进组」通道：位置本身就是答案。
 */
function resolveLiveRowTarget(node, clientY) {
    const panel = node?.__xmlg_panel;
    const state = panel?.state;
    const list = panel?.list;
    if (!panel || !state || !list) {
        return { gap: null, groupId: null };
    }
    const items = state.items[state.category] || [];
    const gap = resolveFlowGap(node, clientY);
    return {
        gap,
        groupId: leanGroupForGap({
            list,
            items,
            gap,
            clientY,
            dragRow: state.dragRow,
        }),
    };
}

/** 折叠起来的组头：成员行没渲染，整组在列表里只占这一格。 */
function isCollapsedGroupHead(el) {
    return Boolean(
        el
        && el.classList.contains("xmlg-group-head")
        && el.classList.contains("is-collapsed")
    );
}

/**
 * 数据里的第 index 项，在屏幕上落在哪个元素上。
 *
 * 有行就用行；折叠组没有成员行，退回去用它的组头（整组就占那么一格）。
 */
function flowSlotAt(list, items, index) {
    const rows = Array.isArray(items) ? items : [];
    if (!Number.isFinite(index) || index < 0 || index >= rows.length) {
        return null;
    }
    for (const row of list.querySelectorAll(".xmlg-row")) {
        if (Number(row.dataset.index) === index) {
            return row;
        }
    }
    const groupId = (rows[index] && rows[index].group) || "";
    if (!groupId) {
        return null;
    }
    for (const head of list.querySelectorAll(".xmlg-group-head")) {
        if ((head.dataset.groupId || "") === groupId) {
            return head;
        }
    }
    return null;
}

/** 缝隙那条界线在屏幕上的位置（上下两格都有时取交界）。 */
function gapBoundaryTop(list, items, gap) {
    const above = flowSlotAt(list, items, gap - 1);
    const below = flowSlotAt(list, items, gap);
    if (above && below) {
        const a = above.getBoundingClientRect();
        const b = below.getBoundingClientRect();
        return (a.bottom + b.top) / 2;
    }
    if (below) {
        return below.getBoundingClientRect().top;
    }
    if (above) {
        return above.getBoundingClientRect().bottom;
    }
    return null;
}

/**
 * 这一格缝隙「归哪一组」——照搬 Chromium 标签条的判定。
 *
 * 1. 缝上下两行同一组 → 就是这一组
 * 2. 不同组（含一边没组）→ 以两行交界为界：被拖那一行的中心还没越过
 *    界（各留四分之一行高的缓冲）就算上一组，越过去才算下一组
 * 3. 正好卡在缓冲带里 → 不属于任何组（最不容易误判）
 * 4. 「粘性」：上一组正是开拖时所在的那一组，就把界线往下挪一个缓冲，
 *    多留一点余地让人留在原组里（Chromium 注释里写明是为了防止在组的
 *    边缘反复闪来闪去）。
 */
function leanGroupForGap(options) {
    const { list, items, gap, clientY, dragRow } = options;
    const height = (dragRow && dragRow.height) || 44;
    const buffer = height * GROUP_LEAN_RATIO;
    const above = gap > 0 ? items[gap - 1] : null;
    const below = gap >= 0 && gap < items.length ? items[gap] : null;
    const aboveGroup = (above && above.group) || null;
    const belowGroup = (below && below.group) || null;
    // 折叠起来的组在列表里只占用一格（组头），成员看不见。这时候
    // 指针从它身上过，只能理解为「插到整组前面 / 后面」——绝不能
    // 把文件塞进一个看不见成员的组里（用户会以为文件没放下）。
    if (
        isCollapsedGroupHead(flowSlotAt(list, items, gap))
        || isCollapsedGroupHead(flowSlotAt(list, items, gap - 1))
    ) {
        return null;
    }
    if (aboveGroup === belowGroup) {
        return aboveGroup;
    }
    const boundary = gapBoundaryTop(list, items, gap);
    if (boundary === null) {
        return aboveGroup || belowGroup;
    }
    const grab = dragRow && Number.isFinite(dragRow.grabOffsetY)
        ? dragRow.grabOffsetY
        : height / 2;
    const center = clientY - grab + height / 2;
    const origin = (dragRow && dragRow.groupOrigin) || null;
    let shift = 0;
    if (aboveGroup && aboveGroup === origin) {
        shift = buffer;
    } else if (belowGroup && belowGroup === origin) {
        shift = -buffer;
    }
    const offset = center - boundary - shift;
    if (offset < -buffer) {
        return aboveGroup;
    }
    if (offset > buffer) {
        return belowGroup;
    }
    return null;
}

/** 只量「看得见的那几行」的位置，屏幕外的不参与动画。 */
function measureRowTops(panel) {
    const list = panel.list;
    const listRect = list.getBoundingClientRect();
    const from = listRect.top - 240;
    const to = listRect.bottom + 240;
    const tops = new Map();
    for (const child of list.children) {
        if (
            !child.classList.contains("xmlg-row")
            && !child.classList.contains("xmlg-group-head")
        ) {
            continue;
        }
        const rect = child.getBoundingClientRect();
        if (rect.bottom < from || rect.top > to) {
            continue;
        }
        tops.set(child, rect.top - listRect.top);
    }
    return tops;
}

/** 把上一次没跑完的让位动画就地收掉（不改布局，只清 transform）。 */
function clearSlide(panel) {
    const list = panel?.list;
    if (!list) {
        return;
    }
    for (const el of list.querySelectorAll(".is-sliding")) {
        el.style.transition = "none";
        el.style.transform = "";
        el.style.removeProperty("transition");
        el.classList.remove("is-sliding");
    }
}

/**
 * 让位动画：先量旧位置、改完再量新位置，然后用「反向位移 → 0」滑回去。
 *
 * 之所以量「屏幕位置」而不是 offsetTop：上一次动画可能还没跑完，
 * 屏幕位置里已经包含了它当前的位移，从这里接着滑才不会跳一下。
 */
function playSlide(panel, tops) {
    const list = panel.list;
    if (!list || !tops?.size) {
        return;
    }
    const listRect = list.getBoundingClientRect();
    const moves = [];
    for (const [el, top] of tops) {
        if (!el.isConnected || el.classList.contains("is-dragging")) {
            continue;
        }
        const delta = top - (el.getBoundingClientRect().top - listRect.top);
        if (Math.abs(delta) < 0.5) {
            continue;
        }
        moves.push({ el, delta });
    }
    if (!moves.length) {
        return;
    }
    for (const { el, delta } of moves) {
        el.style.transition = "none";
        el.style.transform = `translateY(${delta}px)`;
        el.classList.add("is-sliding");
    }
    // 先把「反向位移」这一帧确定下来，再开始过渡；否则两次写会被浏览器
    // 合成成一次，动画根本不会出现。
    void list.offsetHeight;
    window.requestAnimationFrame(() => {
        for (const { el } of moves) {
            if (!el.isConnected) {
                continue;
            }
            el.style.transition =
                `transform ${SLIDE_MS}ms cubic-bezier(0.2, 0, 0, 1)`;
            el.style.transform = "translateY(0px)";
        }
    });
    window.clearTimeout(panel.slideTimer);
    panel.slideTimer = window.setTimeout(() => {
        for (const { el } of moves) {
            if (!el.isConnected) {
                continue;
            }
            el.style.transition = "none";
            el.style.transform = "";
            el.style.removeProperty("transition");
            el.classList.remove("is-sliding");
        }
    }, SLIDE_MS + 60);
}

/** 列表里第一个「会随数据重排」的子元素（覆盖层、提示等都排在它前面）。 */
function firstFlowChild(panel) {
    const fixed = new Set([
        panel.overlay,
        panel.insertLine,
        panel.dropLabel,
        panel.empty,
        panel.toast,
    ]);
    for (const child of panel.list.children) {
        if (fixed.has(child) || child.classList.contains("xmlg-group-rail")) {
            continue;
        }
        return child;
    }
    return null;
}

/**
 * 按当前数据「就地」摆好列表：复用现有的行 / 组头节点，只搬位置、
 * 改序号、改归属，再给被挤动的行做滑动动画。
 *
 * 为什么不直接 renderPanel：一次全量重建 300 行的列表要 70ms 上下，
 * 而拖动时每穿过一行就要来一次，手感立刻就垮了。就地搬节点只要几
 * 毫秒，而且缩略图不会重新加载（不会闪）。
 */
function applyOrderInPlace(node, options = {}) {
    const panel = node?.__xmlg_panel;
    const list = panel?.list;
    if (!panel || !list?.isConnected) {
        return false;
    }
    const state = panel.state;
    const items = state.items[state.category] || [];
    const groups = state.items.groups?.[state.category] || [];
    const animate = options.animate !== false;
    const tops = animate ? measureRowTops(panel) : null;
    if (animate) {
        clearSlide(panel);
    }
    const entries = buildRenderList(items, groups, {
        keyOf: XMLG_KEY_OF,
        willLoad: (entry) => entry.enabled !== false,
    });
    const rowByRef = panel.rowByRef || new Map();
    const headByGroup = panel.headByGroup || new Map();
    const stripeByGroup = new Map(
        groups.map((group) => [group.id, groupStripeColor(group)])
    );
    const wanted = new Set();
    const seenRefs = new Map();
    const lastRowByGroup = new Map();
    const placed = [];
    for (const entry of entries) {
        if (entry.type === "group") {
            let head = headByGroup.get(entry.groupId);
            if (!head) {
                head = buildGroupHead(node, state.category, entry);
                headByGroup.set(entry.groupId, head);
            }
            wanted.add(entry.groupId);
            placed.push({ entry, el: head });
            continue;
        }
        const key = rowKeyOf(entry, seenRefs);
        let rowEl = rowByRef.get(key);
        if (!rowEl) {
            rowEl = buildRow(
                node,
                state.category,
                entry.row,
                entry.index,
                entry.seq
            );
            rowByRef.set(key, rowEl);
        }
        placed.push({ entry, el: rowEl });
    }
    panel.rowByRef = rowByRef;
    panel.headByGroup = headByGroup;
    // 只搬位置：按目标顺序逐个插到游标前面，已经在正确位置的不动
    let cursor = firstFlowChild(panel);
    for (const { el } of placed) {
        if (el === cursor) {
            cursor = cursor.nextSibling;
            continue;
        }
        list.insertBefore(el, cursor);
    }
    // 不再需要的行 / 组头（组被解散、文件被删）直接撤掉
    const keep = new Set(placed.map((item) => item.el));
    const fixed = new Set([
        panel.overlay,
        panel.insertLine,
        panel.dropLabel,
        panel.empty,
        panel.toast,
    ]);
    for (const child of Array.from(list.children)) {
        if (
            keep.has(child)
            || fixed.has(child)
            || child.classList.contains("xmlg-group-rail")
        ) {
            continue;
        }
        child.remove();
    }
    for (const [ref, el] of rowByRef) {
        if (!el.isConnected) {
            rowByRef.delete(ref);
        }
    }
    for (const [groupId, el] of headByGroup) {
        if (!el.isConnected || !wanted.has(groupId)) {
            headByGroup.delete(groupId);
        }
    }
    // 行号、序号、归属：一次过全部对齐
    for (const { entry, el } of placed) {
        if (entry.type === "group") {
            el.dataset.groupId = entry.groupId;
            el.classList.toggle(
                "is-collapsed",
                entry.collapsed === true
            );
            el.style.setProperty(
                "--xmlg-group-stripe",
                stripeByGroup.get(entry.groupId)
                    || groupStripeColor(entry.groupId)
            );
            // 拖动时成员会进出这一组，胶囊上的数字跟着改
            const countEl = el.querySelector(".xmlg-group-count");
            const countText = groupCountText(entry);
            if (countEl && countEl.textContent !== countText) {
                countEl.textContent = countText;
            }
            continue;
        }
        el.dataset.index = String(entry.index);
        const row = entry.row;
        const enabled = row.enabled !== false;
        const seqText = enabled ? String(entry.seq) : "–";
        if (el.__xmlgSeq && el.__xmlgSeq.textContent !== seqText) {
            el.__xmlgSeq.textContent = seqText;
        }
        el.classList.toggle("is-disabled", !enabled);
        // 同一个文件在列表里出现多次时，两个节点的「身份」可能互换，
        // 开关状态也一起对齐，免得显示成另一个的开关状态
        if (el.__xmlgSwitch && el.__xmlgSwitch.checked !== enabled) {
            el.__xmlgSwitch.checked = enabled;
        }
        const groupId = row.group || "";
        if ((el.dataset.group || "") !== groupId) {
            if (groupId) {
                el.dataset.group = groupId;
                el.classList.add("is-grouped");
                el.style.setProperty(
                    "--xmlg-group-stripe",
                    stripeByGroup.get(groupId) || groupStripeColor(groupId)
                );
            } else {
                delete el.dataset.group;
                el.classList.remove("is-grouped");
                el.style.removeProperty("--xmlg-group-stripe");
            }
        }
        if (groupId) {
            lastRowByGroup.set(groupId, el);
        }
    }
    // 每组一根竖线：能复用就复用。
    // 重建的话，新元素一挂上去就是最终长度，过渡根本没机会跑——
    // 这正是「拖一行进组时竖线突然变长」的来源。
    const railHosts = panel.railHosts instanceof Map
        ? panel.railHosts
        : new Map();
    for (const [groupId, host] of Array.from(railHosts)) {
        if (!wanted.has(groupId) || !headByGroup.get(groupId)) {
            host.rail.remove();
            railHosts.delete(groupId);
        }
    }
    for (const groupId of wanted) {
        const head = headByGroup.get(groupId);
        if (!head) {
            continue;
        }
        let host = railHosts.get(groupId);
        if (!host) {
            const rail = element("div", "xmlg-group-rail");
            rail.dataset.group = groupId;
            list.appendChild(rail);
            host = { rail, head, last: head };
            railHosts.set(groupId, host);
        }
        host.head = head;
        host.last = lastRowByGroup.get(groupId) || head;
        host.rail.style.setProperty(
            "--xmlg-group-stripe",
            stripeByGroup.get(groupId) || groupStripeColor(groupId)
        );
        // 正在拖的就是这一组：继续显示「正在搬」
        host.rail.classList.toggle(
            "is-block-dragging",
            Boolean(state.dragGroup && state.dragGroup.groupId === groupId)
        );
    }
    panel.railHosts = railHosts;
    panel.railMeasured = false;
    layoutGroupRails(panel);
    if (animate && tops) {
        playSlide(panel, tops);
    }
    return true;
}

/** 指针压在哪个组头上（展开、折叠都算；没压到返回 null）。 */
function groupHeadAtPointer(list, clientY) {
    for (const head of list.querySelectorAll(".xmlg-group-head")) {
        const rect = head.getBoundingClientRect();
        if (clientY >= rect.top && clientY <= rect.bottom) {
            return head.dataset.groupId || null;
        }
    }
    return null;
}

/** 指针上方最近的可见元素（行或组胶囊）；列表顶端之上返回 null。 */
function flowElementAbove(list, clientY) {
    let found = null;
    for (const child of list.children) {
        const isRow = child.classList.contains("xmlg-row");
        const isHead = child.classList.contains("xmlg-group-head");
        if (!isRow && !isHead) {
            continue;
        }
        const rect = child.getBoundingClientRect();
        if (rect.bottom <= clientY) {
            found = child;
        }
    }
    return found;
}

/** 某一组第一行在数据里的位置（用来把整块插到这一组前面）。 */
function firstIndexForGroup(items, groupId) {
    const rows = Array.isArray(items) ? items : [];
    for (let index = 0; index < rows.length; index += 1) {
        if (rows[index] && rows[index].group === groupId) {
            return index;
        }
    }
    return rows.length;
}

/** 整组拖动的落点：跟单行共用同一套「柜位」算法。 */
function resolveGroupGap(node, clientY) {
    return resolveFlowGap(node, clientY);
}

/** 这一行是不是它所在组的最后一名成员。 */
function isLastGroupMember(items, index, groupId) {
    if (!groupId) {
        return false;
    }
    const next = items[index + 1];
    return !next || (next.group || null) !== groupId;
}

function resolveDropTarget(node, clientY) {
    const panel = node?.__xmlg_panel;
    const state = panel?.state;
    if (!panel || !state) {
        return null;
    }
    const list = panel.list;
    const category = state.category;
    const items = state.items[category] || [];
    const groups = (state.items.groups && state.items.groups[category]) || [];
    // 指针压在任意一组的胶囊上（展开的、折叠的都算）= 追加到这一组末尾。
    // 折叠组的成员没渲染，只能靠胶囊指位置；展开的组也照此办理，
    // 否则「拖到组头」会掉到列表最底下，跟这里提示的「加入这一组」不符。
    const head = groupHeadAtPointer(list, clientY);
    if (head) {
        return {
            mode: "insert",
            index: appendIndexForGroup(items, head),
            row: null,
            group: head,
        };
    }
    const rows = Array.from(list.querySelectorAll(".xmlg-row"));
    for (const row of rows) {
        const rect = row.getBoundingClientRect();
        if (clientY < rect.top || clientY > rect.bottom) {
            continue;
        }
        const index = Number(row.dataset.index);
        const group = row.dataset.group || null;
        if (clientY - rect.top <= INSERT_EDGE_PX) {
            return { mode: "insert", index, row, group };
        }
        if (rect.bottom - clientY <= INSERT_EDGE_PX) {
            return { mode: "insert", index: index + 1, row, group };
        }
        // 一组的最后一名（以及列表最后一行）的下半部分算「追加到末尾」，
        // 否则想在组的最底部加个文件，只能赌那 8px 边距，很容易误替换。
        const tail = isLastGroupMember(items, index, group)
            || index === items.length - 1;
        if (tail && clientY - rect.top > rect.height / 2) {
            return { mode: "insert", index: index + 1, row, group };
        }
        return { mode: "replace", index, row, group };
    }
    // 指针落在两段之间的空隙里（组和组之间只有几个像素），这时
    // 「接在上面那一段后面」才是用户的意思 —— 尤其想让文件进到某组
    // 的最底部时，手指很难刚好停在那一行里，常常就落在这条缝上。
    const above = flowElementAbove(list, clientY);
    if (!above) {
        return {
            mode: "insert",
            index: 0,
            row: null,
            group: groupForDrop(list, items, 0, clientY),
        };
    }
    if (above.classList.contains("xmlg-group-head")) {
        const groupId = above.dataset.groupId || null;
        const record = groups.find((item) => item.id === groupId);
        // 折叠组：成员没渲染，组头下面就是这一组的末尾 → 追加进去
        // 展开组：组头下面紧接着的是它的第一名成员 → 插到那一名前面
        return {
            mode: "insert",
            index: record && record.collapsed === true
                ? appendIndexForGroup(items, groupId)
                : firstIndexForGroup(items, groupId),
            row: null,
            group: groupId,
        };
    }
    const index = Number(above.dataset.index) + 1;
    return {
        mode: "insert",
        index,
        row: above,
        group: above.dataset.group || null,
    };
}

function clearDragHighlights(panel) {
    if (!panel) {
        return;
    }
    for (const row of panel.list.querySelectorAll(
        ".xmlg-row.is-replace-target"
    )) {
        row.classList.remove("is-replace-target");
    }
    panel.insertLine.style.display = "none";
    panel.dropLabel.style.display = "none";
    for (const target of panel.list.querySelectorAll(".is-drop-target")) {
        target.classList.remove("is-drop-target");
    }
}

/**
 * 一个可见元素在数据里的「结束位置」。
 *
 * 插入点正好落在这里，插入线就画在它的下沿：
 * - 普通行：它自己后面那一格
 * - 折叠的组头：整个组的后面（成员没渲染，组头就是这组的末尾）
 * - 展开的组头：组里第一名成员那一格（成员行紧接着画在它下面）
 */
function flowEndIndex(items, category, child) {
    if (child.classList.contains("xmlg-group-head")) {
        const groupId = child.dataset.groupId || "";
        const rows = items[category] || [];
        const records = (items.groups && items.groups[category]) || [];
        const record = records.find((item) => item.id === groupId);
        return record && record.collapsed === true
            ? appendIndexForGroup(rows, groupId)
            : firstIndexForGroup(rows, groupId);
    }
    return Number(child.dataset.index) + 1;
}

/**
 * 插入线画在哪个高度。
 *
 * 基准是「落点上面那一段」的下沿，不是「下一行的上边」：
 * 落点如果是「某一组的最后一名之后」，下一行属于**另一组**，
 * 拿下一行当基准就会把线画到下一组组头的下面 —— 看起来像插进了
 * 下一组，实际却是接在上一组末尾。认上一段的末尾，线和真实落点永远一致。
 */
function insertLineTop(panel, index) {
    const items = panel.state.items || {};
    const category = panel.state.category;
    const flow = Array.from(panel.list.children).filter(
        (child) => child.classList.contains("xmlg-row")
            || child.classList.contains("xmlg-group-head")
    );
    if (!flow.length) {
        return 6;
    }
    // 取「结束位置最靠后、且不越过插入点」的那一段；位置打平时行优先。
    // 行优先很重要：落点在某组第一行前面时，那一组的组头结束位置也
    // 是同一下标，若让组头赢，线就会画到组头下面（看起来像插进了组里）。
    let anchor = null;
    let anchorEnd = Number.NEGATIVE_INFINITY;
    let anchorIsHead = false;
    for (const child of flow) {
        const isHead = child.classList.contains("xmlg-group-head");
        const end = flowEndIndex(items, category, child);
        if (!Number.isFinite(end) || end > index) {
            continue;
        }
        if (end > anchorEnd || (end === anchorEnd && anchorIsHead && !isHead)) {
            anchor = child;
            anchorEnd = end;
            anchorIsHead = isHead;
        }
    }
    if (!anchor) {
        return Math.max(0, flow[0].offsetTop - 2);
    }
    return anchor.offsetTop + anchor.offsetHeight + 1;
}

function placeInsertLine(panel, index) {
    const top = insertLineTop(panel, index);
    panel.insertLine.style.top = `${top}px`;
    panel.insertLine.style.display = "block";
    panel.dropLabel.style.top = `${Math.max(0, top - 24)}px`;
    panel.dropLabel.style.display = "block";
}

function updateDropIndicator(node, target) {
    const panel = node?.__xmlg_panel;
    if (!panel || !target) {
        return;
    }
    clearDragHighlights(panel);
    const count = dragCountFromDataTransfer(
        panel.state.drag?.dataTransfer
    );
    if (target.mode === "replace" && count <= 1) {
        target.row?.classList.add("is-replace-target");
        return;
    }
    placeInsertLine(panel, target.index);
    // 落点落在某一组里：把那组圈出来，提示里直接写组名
    markGroupTarget(panel, target.group);
    const groupName = groupNameById(node, panel.state.category, target.group);
    if (groupName) {
        panel.dropLabel.textContent = count > 1
            ? `+ ${
                t(
                    "xdatahub.ui.node.xmedialistget.insert_many_into_group",
                    "Insert {count} files into \"{name}\"",
                    { count, name: groupName }
                )
            }`
            : `+ ${
                t(
                    "xdatahub.ui.node.xmedialistget.insert_into_group",
                    "Insert into \"{name}\"",
                    { name: groupName }
                )
            }`;
        return;
    }
    panel.dropLabel.textContent = count > 1
        ? `+ ${
            t(
                "xdatahub.ui.node.xmedialistget.insert_many",
                "Insert {count} files",
                { count }
            )
        }`
        : `+ ${
            t(
                "xdatahub.ui.node.xmedialistget.insert_here",
                "Insert here"
            )
        }`;
}

function showTypeMismatch(node, dragType) {
    const panel = node?.__xmlg_panel;
    if (!panel) {
        return;
    }
    const state = panel.state;
    panel.overlayTitle.textContent = t(
        "xdatahub.ui.node.xmedialistget.type_mismatch_title",
        "This list only takes {category}",
        { category: categoryLabel(state.category) }
    );
    panel.overlayHint.textContent = t(
        "xdatahub.ui.node.xmedialistget.type_mismatch_hint",
        "Hover the {category} button to switch automatically",
        { category: categoryLabel(dragType) }
    );
    panel.overlay.classList.add("is-visible");
    for (const category of CATEGORIES) {
        const tab = panel.tabButtons[category];
        tab.button.classList.toggle("is-target", category === dragType);
        tab.button.classList.toggle(
            "is-dimmed",
            category !== dragType && category !== state.category
        );
    }
}

function hideTypeMismatch(panel) {
    if (!panel) {
        return;
    }
    panel.overlay.classList.remove("is-visible");
    for (const category of CATEGORIES) {
        const button = panel.tabButtons[category].button;
        button.classList.remove("is-target", "is-dimmed", "is-switching");
    }
}

/**
 * 拖进来的卡片类型根本不支持（LoRA / 文本等）：
 * 列表无法把它插到任何分类里，也不存在可切换的标签页，
 * 因此单独给一层「这里放不进去」的提示，避免松手后毫无反应。
 */
function showUnsupportedDrag(node, dragType) {
    const panel = node?.__xmlg_panel;
    if (!panel) {
        return;
    }
    panel.overlayTitle.textContent = t(
        "xdatahub.ui.node.xmedialistget.unsupported_title",
        "Only images, videos and audio can go in this list"
    );
    panel.overlayHint.textContent = unsupportedTypeHint(dragType);
    panel.overlay.classList.add("is-visible");
    for (const category of CATEGORIES) {
        const button = panel.tabButtons[category].button;
        button.classList.remove("is-target", "is-switching");
        button.classList.add("is-dimmed");
    }
}

function clearDragUI(node) {
    const panel = node?.__xmlg_panel;
    if (!panel) {
        return;
    }
    const state = panel.state;
    if (state.drag?.pendingTimer) {
        clearTimeout(state.drag.pendingTimer);
    }
    state.drag = null;
    panel.list.classList.remove("drag-over");
    clearDragHighlights(panel);
    hideTypeMismatch(panel);
}

function applyDrop(node, payload, target) {
    const panel = node?.__xmlg_panel;
    if (!panel) {
        return;
    }
    const state = panel.state;
    const category = state.category;
    const items = state.items;
    const list = items[category];
    const entries = payload.entries;

    if (target?.mode === "replace" && entries.length === 1) {
        const index = target.index;
        if (index >= 0 && index < list.length) {
            const previous = list[index];
            list[index] = {
                // 换的是内容，这一「格」还是原来那一格：uid 留着
                uid: previous.uid || newRowUid(),
                ref: entries[0].ref,
                title: entries[0].title || previous.title,
                enabled: previous.enabled,
                // 在组内换文件时留在同一个组，不被默默踢出去
                group: previous.group || null,
            };
            writeItems(node, items);
            renderPanel(node);
            showToast(
                node,
                t(
                    "xdatahub.ui.node.xmedialistget.replaced",
                    "Replaced 1 file"
                )
            );
            return;
        }
    }

    const insertIndex = Math.max(
        0,
        Math.min(
            Number.isFinite(target?.index) ? target.index : list.length,
            list.length
        )
    );
    let slots = Math.max(
        0,
        MAX_ENABLED - enabledCount(items, category)
    );
    // 拖到某一组的地盘里落下的文件，直接成为这一组的成员
    const groupId = target?.group || null;
    const added = entries.map((entry) => {
        const enabled = slots > 0;
        if (enabled) {
            slots -= 1;
        }
        return {
            uid: newRowUid(),
            ref: entry.ref,
            title: entry.title,
            enabled,
            group: groupId,
        };
    });
    list.splice(insertIndex, 0, ...added);
    writeItems(node, items);
    renderPanel(node);
    // 分页退场后不再「翻到某一页」，改成把新插入的第一行滚进视野。
    scrollRowIntoView(node, insertIndex);
    const disabledCount = added.filter((entry) => !entry.enabled).length;
    if (disabledCount > 0) {
        showToast(
            node,
            t(
                "xdatahub.ui.node.xmedialistget.limit_insert_disabled",
                "Already {limit} enabled; new files were added as Disabled",
                { limit: MAX_ENABLED }
            )
        );
    } else {
        const groupName = groupNameById(node, category, groupId);
        showToast(
            node,
            groupName
                ? t(
                    "xdatahub.ui.node.xmedialistget.inserted_into_group",
                    "Inserted {count} files into \"{name}\"",
                    { count: added.length, name: groupName }
                )
                : t(
                    "xdatahub.ui.node.xmedialistget.inserted",
                    "Inserted {count} files",
                    { count: added.length }
                )
        );
    }
}

function bindDragAndDrop(node) {
    const panel = node?.__xmlg_panel;
    if (!panel || panel.list.__xmlgDragBound) {
        return;
    }
    panel.list.__xmlgDragBound = true;
    const list = panel.list;
    const state = panel.state;

    list.addEventListener("dragenter", (event) => {
        if (!hasMediaPayload(event.dataTransfer)) {
            return;
        }
        event.preventDefault();
        const drag = ensureDragState(node, event.dataTransfer);
        if (!drag) {
            return;
        }
        drag.dataTransfer = event.dataTransfer;
        list.classList.add("drag-over");
        if (drag.type && !isSupportedCategory(drag.type)) {
            clearDragHighlights(panel);
            showUnsupportedDrag(node, drag.type);
            return;
        }
        if (drag.type && drag.type !== state.category) {
            showTypeMismatch(node, drag.type);
        } else {
            hideTypeMismatch(panel);
        }
    });

    list.addEventListener("dragover", (event) => {
        if (!hasMediaPayload(event.dataTransfer)) {
            return;
        }
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
        const drag = ensureDragState(node, event.dataTransfer);
        if (!drag) {
            return;
        }
        drag.dataTransfer = event.dataTransfer;
        if (drag.type && !isSupportedCategory(drag.type)) {
            showUnsupportedDrag(node, drag.type);
            clearDragHighlights(panel);
            return;
        }
        if (drag.type && drag.type !== state.category) {
            showTypeMismatch(node, drag.type);
            clearDragHighlights(panel);
            return;
        }
        hideTypeMismatch(panel);
        const target = resolveDropTarget(node, event.clientY);
        drag.target = target;
        updateDropIndicator(node, target);
    });

    list.addEventListener("dragleave", (event) => {
        const related = event.relatedTarget;
        if (related instanceof Node && list.contains(related)) {
            return;
        }
        stopDropAutoScroll(state);
        clearDragHighlights(panel);
    });

    panel.panel.addEventListener("dragleave", (event) => {
        const related = event.relatedTarget;
        if (related instanceof Node && panel.panel.contains(related)) {
            return;
        }
        clearDragUI(node);
    });

    // 列表以外的区域（分类标签、工具栏、分页）也要接住不支持的卡片：
    // 拖 LoRA / 文本到节点上任何位置都应该看得到「这里放不进去」。
    panel.panel.addEventListener("dragenter", (event) => {
        const type = unsupportedDragType(event.dataTransfer);
        if (!type) {
            return;
        }
        event.preventDefault();
        clearDragHighlights(panel);
        showUnsupportedDrag(node, type);
    });

    panel.panel.addEventListener("dragover", (event) => {
        const type = unsupportedDragType(event.dataTransfer);
        if (!type) {
            return;
        }
        event.preventDefault();
        if (event.dataTransfer) {
            event.dataTransfer.dropEffect = "copy";
        }
        clearDragHighlights(panel);
        showUnsupportedDrag(node, type);
    });

    panel.panel.addEventListener("drop", (event) => {
        const type = unsupportedDragType(event.dataTransfer);
        if (!type) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        clearDragUI(node);
        showToast(node, unsupportedDropMessage([type]), { warning: true });
    });

    list.addEventListener("drop", (event) => {
        if (!hasMediaPayload(event.dataTransfer)) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        if (typeof event.stopImmediatePropagation === "function") {
            event.stopImmediatePropagation();
        }
        const payload = parseDropPayload(event.dataTransfer);
        const target = resolveDropTarget(node, event.clientY);
        clearDragUI(node);
        if (!payload) {
            // 可能是 LoRA / 文本这类根本不支持的内容，也可能一次拖了
            // 多种类型；以前这里直接 return，用户只看到“拖了但没反应”。
            explainRejectedDrop(node, event.dataTransfer);
            return;
        }
        if (payload.type !== state.category) {
            showToast(
                node,
                t(
                    "xdatahub.ui.node.xmedialistget.type_mismatch_title",
                    "This list only takes {category}",
                    { category: categoryLabel(state.category) }
                )
            );
            return;
        }
        applyDrop(node, payload, target);
    });

    // 拖到分类按钮上：类型对得上就直接切分类，并允许松手追加到末尾
    for (const category of CATEGORIES) {
        const button = panel.tabButtons[category].button;
        button.addEventListener("dragover", (event) => {
            if (!hasMediaPayload(event.dataTransfer)) {
                return;
            }
            const drag = ensureDragState(node, event.dataTransfer);
            if (!drag || drag.type !== category || category === state.category) {
                return;
            }
            event.preventDefault();
            event.dataTransfer.dropEffect = "copy";
            if (drag.pendingTimer || button.classList.contains("is-switching")) {
                return;
            }
            // 直接拖到按钮上也要先显示目标特效，不能只在经过列表时显示。
            showTypeMismatch(node, category);
            button.classList.add("is-switching");
            drag.pendingTimer = window.setTimeout(() => {
                drag.pendingTimer = 0;
                button.classList.remove("is-switching");
                setCategory(node, category);
                hideTypeMismatch(panel);
            }, TYPE_SWITCH_DELAY_MS);
        });
        button.addEventListener("dragleave", () => {
            if (state.drag?.pendingTimer) {
                clearTimeout(state.drag.pendingTimer);
                state.drag.pendingTimer = 0;
            }
            button.classList.remove("is-switching");
        });
        button.addEventListener("drop", (event) => {
            if (!hasMediaPayload(event.dataTransfer)) {
                return;
            }
            event.preventDefault();
            const payload = parseDropPayload(event.dataTransfer);
            const drag = state.drag;
            if (drag?.pendingTimer) {
                clearTimeout(drag.pendingTimer);
            }
            clearDragUI(node);
            if (!payload || payload.type !== category) {
                return;
            }
            setCategory(node, category);
            applyDrop(
                node,
                payload,
                { mode: "insert", index: Number.MAX_SAFE_INTEGER }
            );
        });
    }
}

// 类型警告的 canvas 绘制配色：刻意与 XPipe / XLinker 保持一致。
// canvas 绘制不能直接读 CSS 变量，因此保留为常量。
const WARNING_COLOR = "#1a1a1a";
const WARNING_GLOW = "rgba(255, 15, 15, 0.95)";
const WARNING_LINE = "#ffffff";
const WARNING_BREATH_SPEED = 0.012;
const LINK_WARNING_RETRY_MS = 250;
const LINK_WARNING_MAX_RETRIES = 20;
let linkWarningHookRetries = 0;

function cleanType(value) {
    if (Array.isArray(value)) {
        value = value[0];
    }
    const type = value == null ? "" : String(value).trim();
    return type && type !== "*" ? type : "";
}

function isMediaListNode(node) {
    return String(node?.comfyClass || node?.type || "") === NODE_CLASS;
}

function getNodeByIdInGraph(graph, id) {
    if (!graph || id == null) {
        return null;
    }
    return graph.getNodeById
        ? graph.getNodeById(id)
        : ((graph._nodes || graph.nodes || []).find(
            (node) => node && node.id === id
        ) || null);
}

function getLinkInfo(linkId, graph) {
    if (linkId == null || !graph) {
        return null;
    }
    const links = graph.links || graph._links;
    if (!links) {
        return null;
    }
    if (links instanceof Map) {
        return links.get(linkId) || null;
    }
    return links[linkId] || null;
}

function syncOutputPortType(node) {
    // 输出端口类型固定（images / masks / videos / audios），
    // 分类切换只影响面板显示，不再修改端口类型。
    void node;
}

function warningGlowBlur() {
    const time = Date.now() * WARNING_BREATH_SPEED;
    const breath = Math.sin(time) * 0.5 + 0.5;
    return 3 + breath * 8;
}

function getLinkWarning(link, graph) {
    if (!link || link.id == null) {
        return null;
    }
    const source = getNodeByIdInGraph(graph, link.origin_id);
    if (!isMediaListNode(source)) {
        return null;
    }
    const output = source.outputs?.[link.origin_slot];
    const target = getNodeByIdInGraph(graph, link.target_id);
    const input = target?.inputs?.[link.target_slot];
    if (!output || !input) {
        return null;
    }
    const outType = cleanType(output.type) || cleanType(link.type);
    const inType = cleanType(input.type);
    if (!outType || !inType) {
        return null;
    }
    const lite = globalThis.LiteGraph;
    if (lite?.isValidConnection?.(outType, inType)) {
        return null;
    }
    return { source, outputType: outType, inputType: inType };
}

function drawWarningOutputRing(node, ctx) {
    if (!ctx || !isMediaListNode(node) || !node.outputs) {
        return;
    }
    const widget = findWidget(node, TYPE_WARNING_WIDGET);
    if (widget && !widget.value) {
        return;
    }
    for (let slot = 0; slot < node.outputs.length; slot += 1) {
        const output = node.outputs[slot];
        if (!output?.links?.length) {
            continue;
        }
        let hasWarning = false;
        for (const linkId of output.links) {
            if (getLinkWarning(getLinkInfo(linkId, node.graph), node.graph)) {
                hasWarning = true;
                break;
            }
        }
        if (!hasWarning) {
            continue;
        }
        const glow = warningGlowBlur();
        const pos = typeof node.getConnectionPos === "function"
            ? node.getConnectionPos(false, slot)
            : null;
        const local = pos && node.pos
            ? [pos[0] - node.pos[0], pos[1] - node.pos[1]]
            : (output.pos || [node.size?.[0] || 0, 35]);
        ctx.save();
        ctx.strokeStyle = WARNING_COLOR;
        ctx.lineWidth = 2.5;
        ctx.shadowColor = WARNING_GLOW;
        ctx.beginPath();
        ctx.arc(local[0], local[1], 7, 0, Math.PI * 2);
        ctx.shadowBlur = glow * 1.8;
        ctx.stroke();
        ctx.shadowBlur = glow;
        ctx.stroke();
        ctx.shadowBlur = glow * 0.4;
        ctx.stroke();
        ctx.restore();
    }
}

function installLinkWarningHook() {
    const canvas = app.canvas;
    if (!canvas) {
        if (linkWarningHookRetries < LINK_WARNING_MAX_RETRIES) {
            linkWarningHookRetries += 1;
            setTimeout(installLinkWarningHook, LINK_WARNING_RETRY_MS);
        }
        return;
    }
    if (canvas.__xmlgTypeWarningInstalled) {
        return;
    }
    const original = canvas.renderLink;
    if (typeof original !== "function") {
        return;
    }
    canvas.__xmlgTypeWarningInstalled = true;
    const colorIndex = original.length >= 7 ? 6 : 5;
    canvas.renderLink = function (ctx, start, end, link) {
        const graph = this.graph || app.graph;
        const warning = getLinkWarning(link, graph);
        if (!warning) {
            return original.apply(this, arguments);
        }
        const widget = findWidget(warning.source, TYPE_WARNING_WIDGET);
        if (widget && !widget.value) {
            return original.apply(this, arguments);
        }
        const args = Array.prototype.slice.call(arguments);
        const base = warningGlowBlur();
        ctx.save();
        ctx.shadowColor = WARNING_GLOW;
        ctx.shadowBlur = base * 1.8;
        args[colorIndex] = WARNING_LINE;
        original.apply(this, args);
        ctx.shadowBlur = base;
        original.apply(this, args);
        ctx.shadowBlur = base * 0.4;
        original.apply(this, args);
        args[colorIndex] = WARNING_COLOR;
        if (ctx.setLineDash) {
            ctx.setLineDash([8, 5]);
        }
        ctx.shadowBlur = 0;
        original.apply(this, args);
        ctx.restore();
    };
}

function bindCanvasForwarding(panel) {
    // 转发滚轮到 ComfyUI 主画布（表单控件与可滚动区域保持原生滚动）
    panel.addEventListener("wheel", (event) => {
        const tag = (event.target.tagName || "").toUpperCase();
        if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") {
            return;
        }
        for (let el = event.target; el && el !== panel; el = el.parentElement) {
            if (
                el.scrollHeight > el.clientHeight
                || el.scrollWidth > el.clientWidth
            ) {
                const style = getComputedStyle(el);
                if (
                    style.overflow.indexOf("auto") >= 0
                    || style.overflow.indexOf("scroll") >= 0
                    || style.overflowY.indexOf("auto") >= 0
                    || style.overflowY.indexOf("scroll") >= 0
                ) {
                    return;
                }
            }
        }
        const canvas = app.canvas?.canvas;
        if (!canvas) {
            return;
        }
        canvas.dispatchEvent(
            new WheelEvent("wheel", {
                deltaX: event.deltaX,
                deltaY: event.deltaY,
                deltaZ: event.deltaZ,
                clientX: event.clientX,
                clientY: event.clientY,
                screenX: event.screenX,
                screenY: event.screenY,
                ctrlKey: event.ctrlKey,
                altKey: event.altKey,
                shiftKey: event.shiftKey,
                metaKey: event.metaKey,
                bubbles: true,
                cancelable: true,
            })
        );
    });

    // 中键拖拽平移画布 — 直接把真实事件交给 LiteGraph
    panel.addEventListener("pointerdown", (event) => {
        if (event.button !== 1) {
            return;
        }
        event.preventDefault();
        const canvas = app.canvas;
        if (!canvas || typeof canvas.processMouseDown !== "function") {
            return;
        }
        canvas.processMouseDown(event);
    });
    panel.addEventListener("pointermove", (event) => {
        if ((event.buttons & 4) !== 4) {
            return;
        }
        const canvas = app.canvas;
        if (!canvas || typeof canvas.processMouseMove !== "function") {
            return;
        }
        canvas.processMouseMove(event);
    });
    panel.addEventListener("pointerup", (event) => {
        if (event.button !== 1) {
            return;
        }
        const canvas = app.canvas;
        if (!canvas || typeof canvas.processMouseUp !== "function") {
            return;
        }
        canvas.processMouseUp(event);
    });
}

function hideMediaTypeWidget(node) {
    const widget = findWidget(node, MEDIA_TYPE_WIDGET);
    if (!widget) {
        return;
    }
    applyHiddenWidgetLayers(widget);
    removeWidgetInput(node, MEDIA_TYPE_WIDGET);
}

function readTypeWarning(node) {
    const widget = findWidget(node, TYPE_WARNING_WIDGET);
    return widget ? widget.value !== false : true;
}

function hideTypeWarningWidget(node) {
    const widget = findWidget(node, TYPE_WARNING_WIDGET);
    if (!widget) {
        return;
    }
    applyHiddenWidgetLayers(widget);
    removeWidgetInput(node, TYPE_WARNING_WIDGET);
}

function readOutputEnabled(node, category) {
    const widget = findWidget(node, OUTPUT_WIDGETS[category]);
    return widget ? widget.value !== false : true;
}

function syncOutputSwitchesFromConnections(node) {
    const panel = node?.__xmlg_panel;
    if (!panel) {
        return;
    }
    let changed = false;
    for (const category of CATEGORIES) {
        const slots = OUTPUT_SLOT_GROUPS[category] || [];
        const connected = slots.some(
            (slot) => (node.outputs?.[slot]?.links?.length || 0) > 0
        );
        const widget = findWidget(node, OUTPUT_WIDGETS[category]);
        if (widget && widget.value !== connected) {
            widget.value = connected;
            changed = true;
        }
        panel.tabButtons[category].button.classList.toggle(
            "is-output-off",
            !connected
        );
    }
    if (changed) {
        node.setDirtyCanvas?.(true, true);
        node.graph?.change?.();
    }
}

function hideOutputWidgets(node) {
    for (const category of CATEGORIES) {
        const widget = findWidget(node, OUTPUT_WIDGETS[category]);
        if (!widget) {
            continue;
        }
        applyHiddenWidgetLayers(widget);
        removeWidgetInput(node, OUTPUT_WIDGETS[category]);
    }
}

function getScopedIdForNode(node) {
    if (!node) {
        return "";
    }
    let found = "";
    const rootGraph = app.graph;
    if (rootGraph) {
        forEachNodeInGraphTree(rootGraph, (candidate, scopedId) => {
            if (candidate === node) {
                found = scopedId;
            }
        });
    }
    if (found) {
        return found;
    }
    const fallback = String(node.id ?? "").trim();
    // 新建 / 加载过程中 id 可能暂时是 -1，不要把它当成真实序号。
    if (!fallback || fallback === "-1") {
        return "";
    }
    return fallback;
}

function applyBadge(node) {
    const panel = node?.__xmlg_panel;
    if (!panel) {
        return false;
    }
    const scopedId = getScopedIdForNode(node);
    panel.badgeChip.textContent = scopedId || "--";
    if (!scopedId) {
        return false;
    }
    const accentColor = getNodeAccentColor(scopedId);
    if (accentColor) {
        panel.badge.style.borderColor = accentColor;
        panel.badgeSwatch.style.background = accentColor;
        panel.badgeChip.style.color = accentColor;
    }
    return true;
}

function scheduleBadgeRefresh(node) {
    if (!node || node.__xmlg_badge_timer) {
        return;
    }
    const attempts = Number(node.__xmlg_badge_attempts || 0);
    if (attempts >= 12) {
        return;
    }
    node.__xmlg_badge_attempts = attempts + 1;
    node.__xmlg_badge_timer = window.setTimeout(() => {
        node.__xmlg_badge_timer = 0;
        if (!node.__xmlg_panel) {
            return;
        }
        if (applyBadge(node)) {
            node.__xmlg_badge_attempts = 0;
            return;
        }
        scheduleBadgeRefresh(node);
    }, 80);
}

function installNodeUi(node) {
    if (!node || String(node.comfyClass || "") !== NODE_CLASS) {
        return;
    }
    ensureStyles();
    ensureStorageWidget(node);
    hideMediaTypeWidget(node);
    hideTypeWarningWidget(node);
    hideOutputWidgets(node);
    if (node.__xmlg_panel) {
        renderPanel(node);
        scheduleSeedApply(node);
        return;
    }
    const ui = buildPanel();
    node.__xmlg_panel = {
        ...ui,
        state: {
            items: readItems(node),
            category: readCategory(node),
            missing: new Set(),
            // 多选只用于成组；拖动永远是单行
            selection: new Set(),
            selectionAnchor: null,
            // ✔ ✖ ⇄ 的作用范围（ENABLE_SCOPES 之一），默认「全部」
            enableScope: "all",
            // 单击组头后收窄到这一组；null = 没选中任何组
            scopeGroup: null,
            // 收窄之前是哪一档：取消收窄时退回去（点两下 = 没点）
            scopeGroupBack: null,
            toastTimer: 0,
            drag: null,
            // 列表内拖拽排序（和「从 XDataHub 拖入」的 drag 分开）
            dragRow: null,
            // 拖整组（拖组头）
            dragGroup: null,
            // 按下但还没达到「算拖动」的阈值（指针事件那一套）
            pointerDrag: null,
            suppressClickUntil: 0,
            autoScrollDir: 0,
            autoScrollRaf: 0,
            undoStack: [],
            redoStack: [],
        },
    };
    if (typeof node.addDOMWidget === "function") {
        node.addDOMWidget("xmedialistget_panel", "custom", ui.panel, {
            serialize: false,
        });
    }
    bindPanelEvents(node);
    bindDragAndDrop(node);
    bindCanvasForwarding(ui.panel);
    ensureNodeMinSize(node);

    const typeWidget = findWidget(node, MEDIA_TYPE_WIDGET);
    if (typeWidget && typeWidget.__xmlg_hooked !== true) {
        typeWidget.__xmlg_hooked = true;
        const originalCallback = typeWidget.callback;
        typeWidget.callback = function (...args) {
            const result = originalCallback?.apply(this, args);
            const state = node.__xmlg_panel?.state;
            if (state) {
                const next = readCategory(node);
                if (next !== state.category) {
                    state.category = next;
                    syncOutputPortType(node);
                    renderPanel(node);
                }
            }
            return result;
        };
    }
    renderPanel(node);
    syncOutputPortType(node);
    scheduleSeedApply(node);
    window.setTimeout(() => syncOutputSwitchesFromConnections(node), 0);
}

function buildScopedNodeId(pathIds, nodeId) {
    const base = String(nodeId ?? "").trim();
    if (!base) {
        return "";
    }
    if (!Array.isArray(pathIds) || pathIds.length < 1) {
        return base;
    }
    return `${pathIds.join(":")}:${base}`;
}

function forEachNodeInGraphTree(rootGraph, visitor) {
    if (!rootGraph || typeof visitor !== "function") {
        return;
    }
    const visited = new Set();
    const walk = (graph, pathIds = []) => {
        if (!graph || typeof graph !== "object" || visited.has(graph)) {
            return;
        }
        visited.add(graph);
        const nodes = Array.isArray(graph._nodes) ? graph._nodes : [];
        for (const node of nodes) {
            const nodeId = String(node?.id ?? "").trim();
            if (!nodeId) {
                continue;
            }
            visitor(node, buildScopedNodeId(pathIds, nodeId));
            if (node?.subgraph) {
                walk(node.subgraph, [...pathIds, nodeId]);
            }
        }
    };
    walk(rootGraph, []);
}

function installExistingNodes() {
    const rootGraph = app.graph;
    if (!rootGraph) {
        return;
    }
    forEachNodeInGraphTree(rootGraph, (node) => {
        installNodeUi(node);
    });
}

function refreshAllPanels() {
    const rootGraph = app.graph;
    if (!rootGraph) {
        return;
    }
    forEachNodeInGraphTree(rootGraph, (node) => {
        if (node?.__xmlg_panel) {
            renderPanel(node);
        }
    });
}

function collectNodes() {
    const result = [];
    const rootGraph = app.graph;
    if (!rootGraph) {
        return result;
    }
    forEachNodeInGraphTree(rootGraph, (node, scopedId) => {
        if (String(node?.comfyClass || "") !== NODE_CLASS) {
            return;
        }
        result.push({
            id: scopedId,
            node_class: NODE_CLASS,
            title: String(node.title || node.type || NODE_CLASS),
            accent_index: getNodeAccentIndex(scopedId),
            item_count: node.__xmlg_panel
                ? enabledCount(
                    node.__xmlg_panel.state.items,
                    node.__xmlg_panel.state.category
                )
                : 0,
            enabled_counts: node.__xmlg_panel
                ? {
                    image: enabledCount(
                        node.__xmlg_panel.state.items, "image"
                    ),
                    video: enabledCount(
                        node.__xmlg_panel.state.items, "video"
                    ),
                    audio: enabledCount(
                        node.__xmlg_panel.state.items, "audio"
                    ),
                }
                : null,
            category: node.__xmlg_panel?.state?.category
                || readCategory(node),
        });
    });
    return result.filter((item) => item.id !== "");
}

function getNodeById(nodeId) {
    const id = String(nodeId ?? "").trim();
    if (!id) {
        return null;
    }
    const rootGraph = app.graph;
    if (!rootGraph) {
        return null;
    }
    let scopedMatch = null;
    let plainMatch = null;
    forEachNodeInGraphTree(rootGraph, (node, scopedId) => {
        if (scopedMatch) {
            return;
        }
        if (scopedId === id) {
            scopedMatch = node;
            return;
        }
        if (
            !id.includes(":")
            && !plainMatch
            && String(node?.id ?? "").trim() === id
        ) {
            plainMatch = node;
        }
    });
    return scopedMatch || plainMatch;
}

function normalizeSentItems(data) {
    const rawItems = Array.isArray(data?.items) ? data.items : [];
    const entries = [];
    for (const item of rawItems) {
        const ref = String(
            item?.media_ref || item?.mediaRef || ""
        ).trim();
        const type = String(
            item?.media_type || item?.mediaType || ""
        ).trim().toLowerCase();
        if (!ref || !CATEGORIES.includes(type)) {
            continue;
        }
        entries.push({
            ref,
            type,
            title: String(item?.title || ""),
        });
    }
    if (!entries.length) {
        const ref = String(data?.media_ref || "").trim();
        const type = String(data?.media_type || "").trim().toLowerCase();
        if (ref && CATEGORIES.includes(type)) {
            entries.push({
                ref,
                type,
                title: String(data?.title || ""),
            });
        }
    }
    if (!entries.length) {
        return null;
    }
    const firstType = entries[0].type;
    if (entries.some((entry) => entry.type !== firstType)) {
        return null;
    }
    return { type: firstType, entries };
}

function handleSendToNode(node, data, ack) {
    const payload = normalizeSentItems(data);
    if (!payload) {
        ack(false, "Missing media reference");
        return;
    }
    const panel = node.__xmlg_panel;
    if (!panel) {
        ack(false, "Node panel not ready");
        return;
    }
    const state = panel.state;
    const category = payload.type;
    if (state.category !== category) {
        setCategory(node, category);
    }
    const items = state.items;
    if (String(data.mode || "") === "replace") {
        items[category] = [];
    }
    // 已启用 50 个时不再丢弃剩下的文件：多出来的照样加进列表，
    // 只是以「禁用」状态进来，之后用户可以自己决定让哪 50 个参与输出。
    const firstNewIndex = items[category].length;
    const disabled = appendEntriesWithLimit(
        items[category],
        payload.entries,
        MAX_ENABLED - enabledCount(items, category)
    );
    writeItems(node, items);
    renderPanel(node);
    // 列表长了看不到刚加进来的内容：把第一行新文件滚进视野。
    scrollRowIntoView(node, firstNewIndex);
    syncOutputPortType(node);
    ack(true, "", {
        accepted: payload.entries.length,
        dropped: 0,
        disabled,
    });
}

function installMessageHandler() {
    const rootOrigin = window.location.origin;
    ROOT.addEventListener("message", (event) => {
        if (event?.source !== ROOT || event.origin !== rootOrigin) {
            return;
        }
        const payload = event?.data;
        if (!payload || typeof payload !== "object") {
            return;
        }
        if (payload.type === "xdatahub:ui-locale") {
            applyUiLocale(payload.locale).catch(() => {});
            return;
        }
        if (payload.type === "xdatahub:request_media_get_nodes") {
            const nodeClass = String(payload.node_class || "");
            if (nodeClass !== NODE_CLASS) {
                return;
            }
            event.source?.postMessage?.(
                {
                    type: "xdatahub:media_get_nodes",
                    request_id: payload.request_id,
                    node_class: nodeClass,
                    nodes: collectNodes(),
                },
                rootOrigin
            );
            return;
        }
        if (payload.type !== "xdatahub:send_to_node") {
            return;
        }
        const data = payload.data || {};
        const nodeClass = String(data.node_class || "");
        if (nodeClass && nodeClass !== NODE_CLASS) {
            return;
        }
        const requestId = String(data.request_id || "");
        const nodeId = String(data.node_id ?? "").trim();
        const ack = (ok, error = "", extra = {}) => {
            if (!requestId) {
                return;
            }
            event.source?.postMessage?.(
                {
                    type: "xdatahub:send_to_node_ack",
                    data: {
                        request_id: requestId,
                        node_id: nodeId,
                        ok: !!ok,
                        error: String(error || ""),
                        accepted: Number(extra.accepted || 0),
                        dropped: Number(extra.dropped || 0),
                    },
                },
                rootOrigin
            );
        };
        if (!nodeId) {
            ack(false, "Invalid node id");
            return;
        }
        const node = getNodeById(nodeId);
        if (!node || String(node.comfyClass || "") !== NODE_CLASS) {
            if (nodeClass === NODE_CLASS) {
                ack(false, "Target node not found");
            }
            return;
        }
        try {
            handleSendToNode(node, data, ack);
        } catch (error) {
            ack(false, error?.message || "Failed to update target node");
        }
    });
}

function initXMediaListGetExtension() {
    if (ROOT[EXT_GUARD_KEY]) {
        return;
    }
    ROOT[EXT_GUARD_KEY] = true;
    installPreviewRuntime();
    app.registerExtension({
        name: EXT_NAME,
        async beforeRegisterNodeDef(nodeType, nodeData) {
            if (String(nodeData?.name || "") !== NODE_CLASS) {
                return;
            }
            const originalCreated = nodeType.prototype.onNodeCreated;
            const originalConfigure = nodeType.prototype.onConfigure;
            const originalRemoved = nodeType.prototype.onRemoved;
            nodeType.prototype.onNodeCreated = function () {
                originalCreated?.apply(this, arguments);
                installNodeUi(this);
            };
            nodeType.prototype.onRemoved = function () {
                closeMediaPreviewForNode(this);
                disposeNodeUi(this);
                originalRemoved?.apply(this, arguments);
            };
            nodeType.prototype.onConfigure = function () {
                originalConfigure?.apply(this, arguments);
                installNodeUi(this);
                const panel = this.__xmlg_panel;
                if (panel) {
                    panel.state.items = readItems(this);
                    panel.state.category = readCategory(this);
                    panel.state.missing = new Set();
                    panel.state.undoStack = [];
                    panel.state.redoStack = [];
                    renderPanel(this);
                    syncOutputPortType(this);
                    window.setTimeout(
                        () => syncOutputSwitchesFromConnections(this),
                        0
                    );
                }
            };
            const originalDrawForeground =
                nodeType.prototype.onDrawForeground;
            nodeType.prototype.onDrawForeground = function (ctx) {
                originalDrawForeground?.apply(this, arguments);
                try {
                    drawWarningOutputRing(this, ctx);
                } catch {
                    // 忽略绘制失败，不影响画布其他内容
                }
            };
            const originalConnectionsChange =
                nodeType.prototype.onConnectionsChange;
            nodeType.prototype.onConnectionsChange = function (
                type,
                slotIndex,
                isConnected,
                linkInfo,
                slotInfo
            ) {
                originalConnectionsChange?.apply(this, arguments);
                if (this.__xmlg_panel) {
                    window.setTimeout(
                        () => syncOutputSwitchesFromConnections(this),
                        0
                    );
                }
            };
        },
        async nodeCreated(node) {
            installNodeUi(node);
        },
        async loadedGraphNode(node) {
            installNodeUi(node);
            const panel = node?.__xmlg_panel;
            if (panel) {
                panel.state.items = readItems(node);
                panel.state.category = readCategory(node);
                panel.state.missing = new Set();
                panel.state.undoStack = [];
                panel.state.redoStack = [];
                renderPanel(node);
                syncOutputPortType(node);
                window.setTimeout(
                    () => syncOutputSwitchesFromConnections(node),
                    0
                );
            }
        },
        async setup() {
            await applyUiLocale();
            installLocaleSync();
            installExistingNodes();
            installMessageHandler();
            installLinkWarningHook();
        },
    });
    setTimeout(() => {
        installExistingNodes();
    }, 0);
}

ROOT.__xmedialistget_extension_loaded__ = true;
ROOT.__xmedialistget_extension_init__ = initXMediaListGetExtension;
// 本地联调 / 自动化冒烟用入口（正常使用时不会有人调用）。
ROOT.__xmedialistget_preview__ = {
    open: openMediaPreview,
    close: closeMediaPreview,
};
initXMediaListGetExtension();
