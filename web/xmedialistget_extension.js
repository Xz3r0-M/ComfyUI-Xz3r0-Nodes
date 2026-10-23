/**
 * XMediaListGet 画布面板扩展
 * ==========================
 *
 * 在节点内提供按「图片 / 视频 / 音频」分类管理的媒体列表：
 * - 分类切换、分页显示、启用开关、删除、清空、刷新
 * - 缩略图懒加载，加载失败自动标红（文件失效）
 * - 从 XDataHub 拖入媒体卡片（插入 / 替换由后续拖拽逻辑处理）
 * - 转发中键平移与滚轮缩放，保持画布基础交互
 *
 * 列表数据保存在隐藏 widget media_items 中，格式：
 * { "image": [{ref,title,enabled}], "video": [], "audio": [] }
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
import { openXMaskEditor } from "./x-mask-editor/index.js?v=20261023-13";

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
const PAGE_SIZE_PROP = "xmedialistget.pageSize";
const CATEGORIES = ["image", "video", "audio"];
const CATEGORY_EMOJI = {
    image: "🖼️",
    video: "🎞️",
    audio: "🎵",
};
const MAX_ENABLED = 50;
const DEFAULT_PAGE_SIZE = 50;
const MIN_PAGE_SIZE = 5;
const MAX_PAGE_SIZE = 50;
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
const REFRESH_CONCURRENCY = 4;
const COMFY_LOCALE_KEY = "Comfy.Locale";
const TOAST_DURATION_MS = 2600;
const INSERT_EDGE_PX = 8;
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

function emptyItems() {
    return { image: [], video: [], audio: [] };
}

function normalizeItems(raw) {
    const output = emptyItems();
    if (!raw || typeof raw !== "object") {
        return output;
    }
    for (const category of CATEGORIES) {
        const list = Array.isArray(raw[category]) ? raw[category] : [];
        for (const entry of list) {
            if (!entry || typeof entry !== "object") {
                continue;
            }
            const ref = String(entry.ref || "").trim();
            if (!ref) {
                continue;
            }
            output[category].push({
                ref,
                title: String(entry.title || ""),
                enabled: entry.enabled !== false,
                mask_ref: String(entry.mask_ref || ""),
                paint_ref: String(entry.paint_ref || ""),
                transform_state: String(entry.transform_state || ""),
            });
        }
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

function writeItems(node, items, options = {}) {
    const widget = ensureStorageWidget(node);
    if (!widget) {
        return;
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

function readPageSize(node) {
    const value = Number(node?.properties?.[PAGE_SIZE_PROP]);
    if (!Number.isFinite(value)) {
        return DEFAULT_PAGE_SIZE;
    }
    return Math.min(
        MAX_PAGE_SIZE,
        Math.max(MIN_PAGE_SIZE, Math.round(value))
    );
}

function writePageSize(node, value) {
    if (!node.properties || typeof node.properties !== "object") {
        node.properties = {};
    }
    node.properties[PAGE_SIZE_PROP] = value;
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
            justify-content: space-between;
            gap: 6px;
            min-height: 30px;
            padding: 4px 10px;
            border: none;
            border-bottom: 1px solid var(--xmlg-border);
            border-radius: var(--xdh-radius-sm, 8px) var(--xdh-radius-sm, 8px) 0 0;
            background: var(--xmlg-surface);
            box-sizing: border-box;
        }
        .xmlg-list-toolbar .xmlg-status {
            position: absolute;
            left: 50%;
            transform: translateX(-50%);
            white-space: nowrap;
            flex: none;
            text-align: center;
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
        .xmlg-range {
            width: 56px;
            accent-color: var(--xmlg-accent);
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
        .xmlg-status {
            flex: 1 1 auto;
            text-align: center;
            opacity: 0.8;
            font-size: 11px;
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
            min-height: 44px;
            flex: 0 0 auto;
            padding: 4px 6px;
            border-radius: var(--xdh-radius-sm, 8px);
            border: 1px solid var(--xmlg-border);
            background: var(--xmlg-surface-strong);
            box-sizing: border-box;
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
        .xmlg-row-divider {
            width: 1px;
            height: 16px;
            flex: 0 0 auto;
            background: var(--xmlg-border);
        }
        .xmlg-row.is-missing {
            border-color: var(--xmlg-danger);
            background: var(--xmlg-danger-soft);
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
        .xmlg-pager {
            display: grid;
            grid-template-columns: 1fr auto 1fr;
            align-items: center;
            gap: 8px;
            min-height: 30px;
            padding: 4px 10px;
            border-top: 1px solid var(--xmlg-border);
            border-radius: 0 0 var(--xdh-radius-sm, 8px) var(--xdh-radius-sm, 8px);
            background: var(--xmlg-surface);
            box-sizing: border-box;
        }
        .xmlg-pager-center {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 10px;
        }
        .xmlg-total {
            justify-self: start;
            font-size: 11px;
            opacity: 0.6;
            white-space: nowrap;
        }
        .xmlg-pager-clear {
            justify-self: end;
            font-size: 13px;
        }
        .xmlg-page-status {
            min-width: 96px;
            text-align: center;
            opacity: 0.85;
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
    const status = element("div", "xmlg-status", "—");
    const pageLabel = element("label");
    const pageText = element("span", null, "Per page");
    const range = document.createElement("input");
    range.type = "range";
    range.className = "xmlg-range";
    range.min = String(MIN_PAGE_SIZE);
    range.max = String(MAX_PAGE_SIZE);
    range.step = "5";
    range.value = String(DEFAULT_PAGE_SIZE);
    const rangeValue = element("span", "xmlg-range-value", String(range.value));
    pageLabel.appendChild(pageText);
    pageLabel.appendChild(range);
    pageLabel.appendChild(rangeValue);
    listToolbar.appendChild(refreshButton);
    listToolbar.appendChild(element("span", "xmlg-toolbar-divider"));
    listToolbar.appendChild(enableAllButton);
    listToolbar.appendChild(disableAllButton);
    listToolbar.appendChild(invertButton);
    listToolbar.appendChild(status);
    listToolbar.appendChild(pageLabel);

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

    const pager = element("div", "xmlg-pager");
    const total = element("span", "xmlg-total", "");
    const pagerCenter = element("div", "xmlg-pager-center");
    const prevButton = element("button", "xmlg-btn", "‹");
    prevButton.type = "button";
    const pageStatus = element("span", "xmlg-page-status", "1 / 1");
    const nextButton = element("button", "xmlg-btn", "›");
    nextButton.type = "button";
    const clearButton = element("button", "xmlg-btn xmlg-pager-clear", "🗑️");
    clearButton.type = "button";
    pagerCenter.appendChild(prevButton);
    pagerCenter.appendChild(pageStatus);
    pagerCenter.appendChild(nextButton);
    pager.appendChild(total);
    pager.appendChild(pagerCenter);
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
        range,
        rangeValue,
        pageText,
        refreshButton,
        enableAllButton,
        disableAllButton,
        invertButton,
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
        prevButton,
        pageStatus,
        nextButton,
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

function buildRow(node, category, entry, index, enabledSeq = 0) {
    const state = node.__xmlg_panel.state;
    const row = element("div", "xmlg-row");
    row.dataset.index = String(index);
    row.dataset.ref = entry.ref;
    row.dataset.category = category;
    if (entry.enabled === false) {
        row.classList.add("is-disabled");
    }
    if (state.missing.has(entry.ref)) {
        row.classList.add("is-missing");
    }

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
        openMediaPreview(node, category, index);
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
        panelState.items[category].splice(index, 1);
        writeItems(node, panelState.items);
        renderPanel(node);
    });

    row.appendChild(
        element(
            "span",
            "xmlg-seq",
            enabledSeq > 0 ? String(enabledSeq) : "–"
        )
    );
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

function hideTooltip(node) {
    node?.__xmlg_panel?.tooltip?.classList.remove("is-visible");
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
    panel.pageText.textContent = t(
        "xdatahub.ui.node.xmedialistget.page_size_label",
        "Per page"
    );
    if (document.activeElement !== panel.range) {
        panel.range.value = String(state.pageSize);
    }
    panel.rangeValue.textContent = String(state.pageSize);
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
    const hasItems = items.length > 0;
    panel.enableAllButton.disabled = !hasItems;
    panel.disableAllButton.disabled = !hasItems;
    panel.invertButton.disabled = !hasItems;
    const enabledOrder = new Array(items.length).fill(0);
    let enabledSeq = 0;
    for (let index = 0; index < items.length; index += 1) {
        if (items[index].enabled !== false) {
            enabledSeq += 1;
            enabledOrder[index] = enabledSeq;
        }
    }
    const totalPages = Math.max(
        1,
        Math.ceil(items.length / state.pageSize)
    );
    if (state.page > totalPages) {
        state.page = totalPages;
    }
    if (state.page < 1) {
        state.page = 1;
    }

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

    const start = (state.page - 1) * state.pageSize;
    const visible = items.slice(start, start + state.pageSize);
    for (let offset = 0; offset < visible.length; offset += 1) {
        panel.list.appendChild(
            buildRow(
                node,
                state.category,
                visible[offset],
                start + offset,
                enabledOrder[start + offset]
            )
        );
    }

    panel.empty.textContent = items.length
        ? ""
        : t(
            "xdatahub.ui.node.xmedialistget.empty_category",
            "No files in this category yet"
        );
    panel.empty.style.display = items.length ? "none" : "flex";

    panel.pageStatus.textContent = t(
        "xdatahub.ui.node.xmedialistget.page_status",
        "Page {page} of {total}",
        { page: state.page, total: totalPages }
    );
    panel.total.textContent = t(
        "xdatahub.ui.node.xmedialistget.total_items",
        "{count} files",
        { count: items.length }
    );
    panel.prevButton.disabled = state.page <= 1;
    panel.nextButton.disabled = state.page >= totalPages;
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
    refreshPreviewForNode(node);
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
    state.page = 1;
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

function setAllEnabled(node, enabled) {
    const panel = node?.__xmlg_panel;
    if (!panel) {
        return;
    }
    const state = panel.state;
    const items = state.items[state.category] || [];
    if (!items.length) {
        return;
    }
    let remaining = MAX_ENABLED;
    let overflow = 0;
    for (const entry of items) {
        if (!enabled) {
            entry.enabled = false;
            continue;
        }
        if (remaining > 0) {
            entry.enabled = true;
            remaining -= 1;
        } else {
            entry.enabled = false;
            overflow += 1;
        }
    }
    writeItems(node, state.items);
    renderPanel(node);
    if (overflow > 0) {
        showToast(
            node,
            t(
                "xdatahub.ui.node.xmedialistget.limit_enabled_hit",
                "Already {limit} enabled; the rest stay Disabled",
                { limit: MAX_ENABLED }
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
    let remaining = MAX_ENABLED;
    let overflow = 0;
    for (const entry of items) {
        entry.enabled = entry.enabled === false;
        if (!entry.enabled) {
            continue;
        }
        if (remaining > 0) {
            remaining -= 1;
        } else {
            entry.enabled = false;
            overflow += 1;
        }
    }
    writeItems(node, state.items);
    renderPanel(node);
    if (overflow > 0) {
        showToast(
            node,
            t(
                "xdatahub.ui.node.xmedialistget.limit_enabled_hit",
                "Already {limit} enabled; the rest stay Disabled",
                { limit: MAX_ENABLED }
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
    panel.range.addEventListener("input", () => {
        const state = node.__xmlg_panel?.state;
        if (!state) {
            return;
        }
        const value = Math.min(
            MAX_PAGE_SIZE,
            Math.max(MIN_PAGE_SIZE, Number(panel.range.value) || DEFAULT_PAGE_SIZE)
        );
        state.pageSize = value;
        state.page = 1;
        writePageSize(node, value);
        renderPanel(node);
    });
    panel.prevButton.addEventListener("click", () => {
        const state = node.__xmlg_panel?.state;
        if (!state || state.page <= 1) {
            return;
        }
        state.page -= 1;
        renderPanel(node, { scrollTop: 0 });
    });
    panel.nextButton.addEventListener("click", () => {
        const state = node.__xmlg_panel?.state;
        if (!state) {
            return;
        }
        const items = state.items[state.category] || [];
        const totalPages = Math.max(
            1,
            Math.ceil(items.length / state.pageSize)
        );
        if (state.page >= totalPages) {
            return;
        }
        state.page += 1;
        renderPanel(node, { scrollTop: 0 });
    });
    panel.refreshButton.addEventListener("click", () => {
        refreshMissing(node).catch(() => {});
    });
    panel.clearButton.addEventListener("click", () => {
        clearCurrentCategory(node);
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
    for (const target of [panel.pageText, panel.range, panel.rangeValue]) {
        bindHint(target, () => t(
            "xdatahub.ui.node.xmedialistget.page_size_tooltip",
            "How many rows to draw per page."
        ));
    }
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
    bindHint(panel.prevButton, () => t(
        "xdatahub.ui.node.xmedialistget.page_prev",
        "Previous"
    ));
    bindHint(panel.nextButton, () => t(
        "xdatahub.ui.node.xmedialistget.page_next",
        "Next"
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

function resolveDropTarget(list, clientY) {
    const rows = Array.from(list.querySelectorAll(".xmlg-row"));
    for (const row of rows) {
        const rect = row.getBoundingClientRect();
        if (clientY < rect.top || clientY > rect.bottom) {
            continue;
        }
        const index = Number(row.dataset.index);
        if (clientY - rect.top <= INSERT_EDGE_PX) {
            return { mode: "insert", index, row };
        }
        if (rect.bottom - clientY <= INSERT_EDGE_PX) {
            return { mode: "insert", index: index + 1, row };
        }
        return { mode: "replace", index, row };
    }
    const last = rows[rows.length - 1];
    const index = last ? Number(last.dataset.index) + 1 : 0;
    return { mode: "insert", index, row: null };
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
}

function placeInsertLine(panel, index) {
    const rows = Array.from(panel.list.querySelectorAll(".xmlg-row"));
    let top = 6;
    let row = rows.find(
        (entry) => Number(entry.dataset.index) === index
    );
    if (row) {
        top = row.offsetTop - 2;
    } else if (rows.length) {
        const last = rows[rows.length - 1];
        top = last.offsetTop + last.offsetHeight + 1;
    }
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
                ref: entries[0].ref,
                title: entries[0].title || previous.title,
                enabled: previous.enabled,
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
    const added = entries.map((entry) => {
        const enabled = slots > 0;
        if (enabled) {
            slots -= 1;
        }
        return {
            ref: entry.ref,
            title: entry.title,
            enabled,
        };
    });
    list.splice(insertIndex, 0, ...added);
    writeItems(node, items);
    state.page = Math.floor(insertIndex / state.pageSize) + 1;
    renderPanel(node);
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
        showToast(
            node,
            t(
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
        const target = resolveDropTarget(list, event.clientY);
        drag.target = target;
        updateDropIndicator(node, target);
    });

    list.addEventListener("dragleave", (event) => {
        const related = event.relatedTarget;
        if (related instanceof Node && list.contains(related)) {
            return;
        }
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
        const target = state.drag?.target
            || resolveDropTarget(list, event.clientY);
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
            page: 1,
            pageSize: readPageSize(node),
            missing: new Set(),
            toastTimer: 0,
            drag: null,
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
                    state.page = 1;
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
    // 跳到新加文件所在的那一页，否则列表长了看不到刚加进来的内容。
    const pageSize = Math.max(1, Number(state.pageSize) || DEFAULT_PAGE_SIZE);
    state.page = Math.floor(firstNewIndex / pageSize) + 1;
    renderPanel(node);
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
                originalRemoved?.apply(this, arguments);
            };
            nodeType.prototype.onConfigure = function () {
                originalConfigure?.apply(this, arguments);
                installNodeUi(this);
                const panel = this.__xmlg_panel;
                if (panel) {
                    panel.state.items = readItems(this);
                    panel.state.category = readCategory(this);
                    panel.state.pageSize = readPageSize(this);
                    panel.state.page = 1;
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
                panel.state.pageSize = readPageSize(node);
                panel.state.page = 1;
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
