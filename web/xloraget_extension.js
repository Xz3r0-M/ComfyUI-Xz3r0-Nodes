import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";
import {
    getModuloAccentIndex as getNodeAccentIndex,
    getHexAccentFromModuloId as getNodeAccentColor,
} from "./core/node-accent.js";
import {
    applyHiddenWidgetLayers,
    removeWidgetInput,
} from "./core/hidden-widget.js";
/* 分组（组头 / 竖线 / 折叠 / 拖拽 / 范围 / 撤销）是共享引擎，
   XMediaListGet 用的是同一份实现（见 web/core/group-list.js）。 */
import {
    createGroupEngine,
    groupStyles,
    MAX_ENABLED,
    sanitizeEnableScope,
} from "./core/group-list.js";
/* 纯数据层的分组函数（整理分组、算归属、算出渲染顺序） */
import { buildRenderList, normalizeGroups } from "./core/group-model.js";

const EXT_NAME = "xz3r0.xloraget";
const EXT_GUARD_KEY = "__xloraget_extension_registered__";
const ROOT = globalThis;
const TARGET_NODE_CLASS = "XLoraGet";
const XDATAHUB_MEDIA_MIME = "application/x-xdatahub-media+json";
/* 拖到列表边缘多少像素内开始自动滚动，以及每次滚多少。 */
const DROP_AUTOSCROLL_EDGE = 28;
const DROP_AUTOSCROLL_STEP = 10;
const TOAST_DURATION_MS = 2200;
const STORAGE_WIDGET = "lora_stack";
/* 存盘格式版本。2 = {version, rows, groups}：
   分组数据（组名、颜色、折叠状态、序号）跟行一起存，Python 只读 rows。 */
const STORAGE_VERSION = 2;
// 画布拖拽建节点时，建节点方通过 createNode options 预置的种子行。
// 只消费一次，避免节点恢复时又被种子拉回。
const PENDING_ROWS_FIELD = "__xloraget_pending_rows";
const STYLE_ID = "xloraget-extension-style";
const GLOBAL_CLIP_MODE_PROP = "xloraget.globalSeparateClipStrength";
/* ✔ ✖ ⇄ 的作用范围（未分组 / 全部 / 分组）也存 properties：
   跟着工作流走，但不进 lora_stack（那个 JSON 是 Python 侧解析的）。 */
const ENABLE_SCOPE_PROP = "xloraget.enableScope";
const DEFAULT_MIN_NODE_WIDTH = 614;
const DEFAULT_MIN_NODE_HEIGHT = 560;
const TRIGGER_PANEL_HEIGHT_DELTA = 220;
const AUTO_RESIZE_TRIGGER_PANEL = false;
const TRIGGER_WORDS_ENDPOINT = "/xz3r0/xdatahub/loras/trigger-words";
/* 「刷新」按钮逐个问后端：这些 LoRA 文件还在不在硬盘上。
   和 XMediaListGet 用同一个思路（问一个、回来一个，最多 4 个同时在问）。 */
const LORA_META_ENDPOINT = "/xz3r0/xdatahub/loras/meta";
const REFRESH_CONCURRENCY = 4;
const TRIGGER_WORD_INLINE_LIMIT = 3;
const COMFY_LOCALE_KEY = "Comfy.Locale";
const LOCALE_SYNC_INTERVAL_MS = 1000;
const TOOLTIP_VIEWPORT_MARGIN = 12;
const TOOLTIP_CURSOR_OFFSET_X = 16;
const TOOLTIP_CURSOR_OFFSET_Y = 26;

let rowSeq = 1;

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

function readUiText(key, fallback) {
    const text = uiLocalePrimary?.[key] ?? uiLocaleFallback?.[key];
    if (typeof text === "string" && text.length > 0) {
        return text;
    }
    return fallback;
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
    return formatText(readUiText(key, fallback || key), vars);
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
        if (!response.ok) {
            uiLocaleCache.set(normalizedCode, dict);
            return dict;
        }
        const payload = await response.json();
        const payloadDict = payload?.dict;
        dict = payloadDict && typeof payloadDict === "object"
            ? payloadDict
            : {};
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
    if (locale === "en") {
        uiLocalePrimary = uiLocaleFallback;
        return;
    }
    uiLocalePrimary = await fetchLocaleJson(locale);
}

function installLocaleSync() {
    if (localeSyncInstalled) {
        return;
    }
    localeSyncInstalled = true;

    const refreshLocale = () => {
        applyUiLocale().catch(() => {});
    };

    try {
        const setting = app.extensionManager?.setting;
        if (setting && typeof setting.set === "function"
            && setting.__xloragetLocaleHookInstalled !== true) {
            const originalSet = setting.set.bind(setting);
            setting.set = (...args) => {
                const result = originalSet(...args);
                if (String(args[0] || "") === COMFY_LOCALE_KEY) {
                    Promise.resolve(result).finally(refreshLocale);
                }
                return result;
            };
            setting.__xloragetLocaleHookInstalled = true;
        }
    } catch {
        // Ignore setting hook failures.
    }

    ROOT.addEventListener("storage", (event) => {
        if (!event.key || event.key === COMFY_LOCALE_KEY) {
            refreshLocale();
        }
    });
    ROOT.addEventListener("focus", refreshLocale);
    ROOT.addEventListener("pageshow", refreshLocale);
    document.addEventListener("visibilitychange", () => {
        if (!document.hidden) {
            refreshLocale();
        }
    });

    try {
        const root = document.documentElement;
        const observer = new MutationObserver((mutations) => {
            if (
                mutations.some(
                    (mutation) => mutation.attributeName === "lang"
                )
            ) {
                refreshLocale();
            }
        });
        observer.observe(root, {
            attributes: true,
            attributeFilter: ["lang"],
        });
    } catch {
        // Ignore lang observer failures.
    }

    ROOT.setInterval(() => {
        if (document.hidden) {
            return;
        }
        const nextLocale = resolveComfyLocale();
        if (nextLocale !== currentUiLocale) {
            refreshLocale();
        }
    }, LOCALE_SYNC_INTERVAL_MS);
}

function toFloat(value, fallback = 1) {
    const n = Number(value);
    if (!Number.isFinite(n)) {
        return fallback;
    }
    return n;
}

function clamp(v, min, max) {
    return Math.min(max, Math.max(min, v));
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
            const scopedId = buildScopedNodeId(pathIds, nodeId);
            visitor(node, scopedId);

            const subgraph = node?.subgraph;
            if (subgraph && typeof subgraph === "object") {
                walk(subgraph, [...pathIds, nodeId]);
            }
        }
    };

    walk(rootGraph, []);
}

function getScopedNodeId(node) {
    if (!node) {
        return "";
    }
    const rootGraph = app.graph;
    if (!rootGraph) {
        return "";
    }
    let scopedId = "";
    forEachNodeInGraphTree(rootGraph, (graphNode, graphScopedId) => {
        if (!scopedId && graphNode === node) {
            scopedId = graphScopedId;
        }
    });
    return scopedId;
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

function collectXLoraNodes() {
    const rootGraph = app.graph;
    if (!rootGraph) {
        return [];
    }
    const items = [];
    forEachNodeInGraphTree(rootGraph, (node, scopedId) => {
        if (String(node?.comfyClass || "") !== TARGET_NODE_CLASS) {
            return;
        }
        items.push({
            id: scopedId,
            node_class: TARGET_NODE_CLASS,
            title: String(node.title || TARGET_NODE_CLASS),
            accent_index: getNodeAccentIndex(scopedId),
        });
    });
    return items.filter((item) => item.id !== "");
}

function extractLoraFilename(loraPath) {
    const text = String(loraPath || "").trim();
    if (!text) {
        return "";
    }
    const parts = text.split("/");
    const filename = parts[parts.length - 1] || text;
    return filename;
}

function normalizeLoraName(value) {
    const text = String(value || "")
        .trim()
        .replaceAll("\\", "/")
        .replace(/^\/+/, "");
    if (!text) {
        return "";
    }
    const noRoot = text.toLowerCase().startsWith("loras/")
        ? text.slice(6)
        : text;
    return noRoot
        .split("/")
        .filter((part) => part && part !== "." && part !== "..")
        .join("/");
}

function normalizeTriggerWordItem(value) {
    const rawText = typeof value === "object" && value
        ? value.text
        : value;
    const text = String(rawText || "")
        .trim()
        .replace(/\s+/g, " ");
    if (!text) {
        return null;
    }
    return {
        text,
        enabled: typeof value === "object" && value
            ? value.enabled !== false
            : true,
    };
}

function normalizeTriggerWords(value) {
    if (!Array.isArray(value)) {
        return [];
    }
    const seen = new Set();
    const items = [];
    for (const item of value) {
        const normalized = normalizeTriggerWordItem(item);
        if (!normalized) {
            continue;
        }
        const key = normalized.text.toLowerCase();
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);
        items.push(normalized);
    }
    return items;
}

function mergeTriggerWords(existingValue, incomingValue) {
    const existing = normalizeTriggerWords(existingValue);
    const incoming = normalizeTriggerWords(incomingValue);
    const enabledMap = new Map(
        existing.map((item) => [item.text.toLowerCase(), item.enabled !== false])
    );
    return incoming.map((item) => ({
        text: item.text,
        enabled: enabledMap.has(item.text.toLowerCase())
            ? enabledMap.get(item.text.toLowerCase()) !== false
            : item.enabled !== false,
    }));
}

function filterTriggerWords(triggerWords, query) {
    const list = Array.isArray(triggerWords)
        ? triggerWords
        : [];
    const key = String(query || "").trim().toLowerCase();
    if (!key) {
        return list;
    }
    return list.filter((item) => {
        const text = String(item?.text || "").toLowerCase();
        return text.includes(key);
    });
}

async function fetchLoraTriggerWords(loraRef) {
    const ref = String(loraRef || "").trim();
    if (!ref) {
        return {
            trigger_words: [],
            strength_model: null,
            strength_clip: null,
            cover: null,
        };
    }
    const response = await api.fetchApi(
        `${TRIGGER_WORDS_ENDPOINT}?ref=${encodeURIComponent(ref)}`
    );
    if (!response.ok) {
        throw new Error("Failed to load trigger words");
    }
    const data = await response.json();
    const item = data?.item || {};
    const strengthModel = Number(item.strength_model);
    const strengthClip = Number(item.strength_clip);
    return {
        trigger_words: normalizeTriggerWords(item.trigger_words || []),
        lora_note: String(item.lora_note || ""),
        strength_model: Number.isFinite(strengthModel)
            ? strengthModel
            : null,
        strength_clip: Number.isFinite(strengthClip)
            ? strengthClip
            : null,
        // 这个接口顺带带了封面信息，省一次请求（视频封面就靠它）
        cover: item.cover || null,
    };
}

/** 封面类型：只有 image / video 两种，其余一律当「没有封面」。 */
function normalizeCoverKind(value) {
    const kind = String(value || "").trim().toLowerCase();
    return kind === "video" || kind === "image" ? kind : "";
}

/**
 * 视频封面在 tooltip 里直接播放。
 *
 * 悬停才出现的封面本来就是「看一眼」，静态第一帧的信息量太少，
 * 所以这里静音自动循环播放（静音才不会被浏览器拦）。
 * 地址带 `#t=0.1`：万一系统禁止自动播放，也至少停在第一帧而
 * 不是一块黑。
 */
function playTooltipVideo(video, url) {
    if (!(video instanceof HTMLVideoElement)) {
        return;
    }
    const base = String(url || "").split("#")[0];
    if (!base) {
        return;
    }
    video.src = `${base}#t=0.1`;
    video.style.display = "block";
    const started = video.play?.();
    if (started && typeof started.catch === "function") {
        // 自动播放被拦下来不算错，停在第一帧也挺好看
        started.catch(() => {});
    }
}

function stopTooltipVideo(video) {
    if (!(video instanceof HTMLVideoElement) || !video.hasAttribute("src")) {
        return;
    }
    try {
        video.pause();
    } catch {
        // 没有可播源时 pause 可能抛错，忽略
    }
    video.removeAttribute("src");
    video.load?.();
    video.style.display = "none";
}

/**
 * tooltip 里那块封面的内容：图片封面用 `<img>`，视频封面用 `<video>`。
 *
 * 视频走 `<video>` 而不是服务端抽的静帧：静帧只能看到一帧，而封面
 * 是悬停才出现的，动起来才看得出内容。这样也不依赖 ffmpeg。
 * @returns {boolean} 是否显示出了内容
 */
function applyTooltipMedia(tooltip, thumbUrl, coverKind, coverUrl) {
    const img = tooltip?.querySelector("img");
    const video = tooltip?.querySelector("video");
    if (!(img instanceof HTMLImageElement)
        || !(video instanceof HTMLVideoElement)) {
        return false;
    }
    const stillUrl = String(thumbUrl || "").trim();
    const sourceUrl = String(coverUrl || "").trim();
    const isVideo = normalizeCoverKind(coverKind) === "video";
    stopTooltipVideo(video);
    if (isVideo && sourceUrl) {
        img.removeAttribute("src");
        img.onerror = null;
        img.style.display = "none";
        playTooltipVideo(video, sourceUrl);
        return true;
    }
    img.onerror = () => {
        img.style.display = "none";
    };
    if (!stillUrl) {
        img.removeAttribute("src");
        img.style.display = "none";
        return false;
    }
    img.style.display = "block";
    img.src = stillUrl;
    return true;
}

function positionTooltip(tooltip, event) {
    if (!(tooltip instanceof HTMLElement) || !event) {
        return;
    }
    const rect = tooltip.getBoundingClientRect();
    const tooltipWidth = rect.width || tooltip.offsetWidth || 212;
    const tooltipHeight = rect.height || tooltip.offsetHeight || 48;
    const viewportWidth = window.innerWidth
        || document.documentElement.clientWidth;
    const viewportHeight = window.innerHeight
        || document.documentElement.clientHeight;

    let left = event.clientX + TOOLTIP_CURSOR_OFFSET_X;
    let top = event.clientY + TOOLTIP_CURSOR_OFFSET_Y;

    if (left + tooltipWidth > viewportWidth - TOOLTIP_VIEWPORT_MARGIN) {
        left = event.clientX - tooltipWidth - TOOLTIP_CURSOR_OFFSET_X;
    }
    if (top + tooltipHeight > viewportHeight - TOOLTIP_VIEWPORT_MARGIN) {
        top = event.clientY - tooltipHeight - TOOLTIP_CURSOR_OFFSET_Y;
    }

    left = Math.max(
        TOOLTIP_VIEWPORT_MARGIN,
        Math.min(
            viewportWidth - tooltipWidth - TOOLTIP_VIEWPORT_MARGIN,
            left
        )
    );
    top = Math.max(
        TOOLTIP_VIEWPORT_MARGIN,
        Math.min(
            viewportHeight - tooltipHeight - TOOLTIP_VIEWPORT_MARGIN,
            top
        )
    );

    tooltip.style.left = `${Math.round(left)}px`;
    tooltip.style.top = `${Math.round(top)}px`;
}

function resolveTooltipContent(source, target) {
    if (typeof source === "function") {
        return source(target);
    }
    return source;
}

function showTooltip(
    tooltip,
    event,
    text,
    thumbUrl = "",
    noteText = "",
    target = null,
    coverKind = "",
    coverUrl = ""
) {
    const label = tooltip?.querySelector(".xlora-tooltip-name");
    const divider = tooltip?.querySelector(".xlora-tooltip-divider");
    const note = tooltip?.querySelector(".xlora-tooltip-note");
    if (!(tooltip instanceof HTMLElement)
        || !(label instanceof HTMLElement)
        || !(divider instanceof HTMLElement)
        || !(note instanceof HTMLElement)) {
        return;
    }
    const resolvedText = resolveTooltipContent(text, target);
    const resolvedThumbUrl = resolveTooltipContent(thumbUrl, target);
    const resolvedNoteText = resolveTooltipContent(noteText, target);
    const resolvedCoverKind = resolveTooltipContent(coverKind, target);
    const resolvedCoverUrl = resolveTooltipContent(coverUrl, target);
    const displayName = extractLoraFilename(String(resolvedText || ""));
    const displayNote = String(resolvedNoteText || "").trim();
    const isVideoCover = normalizeCoverKind(resolvedCoverKind) === "video";
    const hasCover = !!String(resolvedThumbUrl || "").trim()
        || (isVideoCover && !!String(resolvedCoverUrl || "").trim());
    if (!displayName && !displayNote && !hasCover) {
        hideTooltip(tooltip);
        return;
    }
    label.textContent = displayName;
    note.textContent = displayNote;
    divider.style.display = displayNote ? "block" : "none";
    note.style.display = displayNote ? "block" : "none";
    const shown = applyTooltipMedia(
        tooltip,
        resolvedThumbUrl,
        resolvedCoverKind,
        resolvedCoverUrl
    );
    tooltip.classList.toggle("has-thumb", shown);
    tooltip.style.display = "block";
    positionTooltip(tooltip, event);
}

function moveTooltip(tooltip, event) {
    if (!(tooltip instanceof HTMLElement) || tooltip.style.display !== "block") {
        return;
    }
    positionTooltip(tooltip, event);
}

function hideTooltip(tooltip) {
    if (!(tooltip instanceof HTMLElement)) {
        return;
    }
    tooltip.style.display = "none";
    // 视频封面一直挂着会继续解码、占内存，收起来时顺手卸掉
    stopTooltipVideo(tooltip.querySelector("video"));
}

/**
 * 刷新：挨个问后端「这个 LoRA 文件还在不在硬盘上」，问不到就算丢失。
 *
 * 和 XMediaListGet 的 ↻ 一样——文件是用户自己在硬盘上搬来搬去的，
 * 节点里存的是路径，盘上的东西不打招呼就走了，所以留个按钮现场核对。
 */
async function refreshLoraMissing(node) {
    const panel = node?.__xlora_panel;
    if (!panel) {
        return;
    }
    const state = panel.state;
    const refs = [];
    for (const item of state.rows || []) {
        const ref = String(item?.lora_ref || "");
        if (ref && !refs.includes(ref)) {
            refs.push(ref);
        }
    }
    const missing = new Set();
    const queue = refs.slice();
    const worker = async () => {
        while (queue.length) {
            const ref = queue.shift();
            try {
                const response = await fetch(
                    `${LORA_META_ENDPOINT}?ref=${encodeURIComponent(ref)}`
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
    const lost = [...missing].length;
    state.missing = missing;
    renderNodeRows(node);
    if (lost > 0) {
        showPanelToast(
            node,
            t(
                "xdatahub.ui.node.xloraget.refresh_found_missing",
                "{count} file(s) not found on disk. Red rows are gone.",
                { count: String(lost) }
            )
        );
    } else {
        showPanelToast(
            node,
            t(
                "xdatahub.ui.node.xloraget.refresh_all_there",
                "All {count} file(s) are still on disk.",
                { count: String(refs.length) }
            )
        );
    }
}

/**
 * 名字提示里的一句话：文件没了就顶到最前面说清楚，再跟在后面的备注。
 */
function missingNoteText(missing, noteText) {
    if (!missing) {
        return noteText;
    }
    const label = t(
        "xdatahub.ui.node.xloraget.item_missing",
        "File is missing"
    );
    const note = String(noteText || "").trim();
    return note ? `${label} · ${note}` : label;
}

function bindTooltip(
    target,
    tooltip,
    text,
    thumbUrl = "",
    noteText = "",
    coverKind = "",
    coverUrl = ""
) {
    if (!(target instanceof HTMLElement)) {
        return;
    }
    target.addEventListener("mouseenter", (event) => {
        showTooltip(
            tooltip,
            event,
            text,
            thumbUrl,
            noteText,
            target,
            coverKind,
            coverUrl
        );
    });
    target.addEventListener("mousemove", (event) => {
        moveTooltip(tooltip, event);
    });
    target.addEventListener("mouseleave", () => {
        hideTooltip(tooltip);
    });
    target.addEventListener("pointerdown", () => {
        hideTooltip(tooltip);
    });
    target.addEventListener("click", () => {
        hideTooltip(tooltip);
    });
    target.addEventListener("blur", () => {
        hideTooltip(tooltip);
    });
}

function makeRow(partial = {}) {
    const loraRef = String(
        partial.lora_ref || partial.media_ref || ""
    ).trim();
    const loraName = normalizeLoraName(partial.lora_name || partial.path || "");
    const displayName = partial.title
        ? String(partial.title)
        : extractLoraFilename(loraName || loraRef);
    return {
        id: Number(partial.id) || (Date.now() + rowSeq++),
        active: partial.active !== false,
        lora_ref: loraRef,
        lora_name: loraName,
        title: displayName,
        strength_model: toFloat(partial.strength_model, 1),
        separate_clip_strength: !!partial.separate_clip_strength,
        strength_clip: toFloat(
            partial.strength_clip,
            toFloat(partial.strength_model, 1)
        ),
        trigger_words: normalizeTriggerWords(partial.trigger_words),
        lora_note: String(partial.lora_note || partial.note || ""),
        trigger_words_loading: false,
        trigger_words_synced: false,
        trigger_words_error: "",
        strength_sync_pending: partial.strength_sync_pending === true,
        thumb_url: String(partial.thumb_url || ""),
        // 封面类型与封面原图：视频封面靠它们才能在 tooltip 里画出来
        cover_kind: normalizeCoverKind(
            partial.cover_kind || partial.coverKind
        ),
        cover_url: String(partial.cover_url || partial.coverUrl || ""),
        pin: partial.pin === "head" || partial.pin === "tail"
            ? partial.pin
            : "none",
        // 属于哪一组（组 id）；null = 没分组
        group: String(partial.group || "").trim() || null,
    };
}

function normalizeRows(value) {
    if (!Array.isArray(value)) {
        return [];
    }
    const rows = value
        .map((item) => makeRow(item))
        .filter((item) => !!item.lora_ref);
    return enforcePinLayout(rows);
}

function enforcePinLayout(rows) {
    const list = rows.slice();
    const headIndex = list.findIndex((item) => item.pin === "head");
    const tailIndex = list.findIndex((item) => item.pin === "tail");
    if (headIndex > 0) {
        const [headItem] = list.splice(headIndex, 1);
        list.unshift(headItem);
    }
    const tailAfterHead = list.findIndex((item) => item.pin === "tail");
    if (tailAfterHead >= 0 && tailAfterHead !== list.length - 1) {
        const [tailItem] = list.splice(tailAfterHead, 1);
        list.push(tailItem);
    }
    return list;
}

function parseDragPayload(dataTransfer) {
    const raw = dataTransfer?.getData(XDATAHUB_MEDIA_MIME) || "";
    if (!raw) {
        return null;
    }
    try {
        const payload = JSON.parse(raw);
        if (String(payload?.source || "").trim().toLowerCase() !== "xdatahub") {
            return null;
        }
        if (String(payload?.media_type || "").trim().toLowerCase() !== "lora") {
            return null;
        }
        const loraRef = String(payload?.media_ref || payload?.lora_ref || "").trim();
        if (!loraRef) {
            return null;
        }
        const title = String(payload?.title || "lora");
        const thumbUrl = String(payload?.thumb_url || "");
        const coverKind = normalizeCoverKind(
            payload?.cover_kind || payload?.coverKind
        );
        const coverUrl = String(
            payload?.cover_url || payload?.coverUrl || ""
        );
        const strengthModel = Number(payload?.strength_model);
        const strengthClip = Number(payload?.strength_clip);
        const topLevel = {
            lora_ref: loraRef,
            title,
            thumb_url: thumbUrl,
            cover_kind: coverKind,
            cover_url: coverUrl,
            strength_model: Number.isFinite(strengthModel)
                ? strengthModel
                : null,
            strength_clip: Number.isFinite(strengthClip)
                ? strengthClip
                : null,
        };
        // 多选拖拽：顶层仍带第一条（兼容老逻辑），items 里带全部。
        const items = (Array.isArray(payload.items) ? payload.items : [])
            .map((item) => {
                const model = Number(item?.strength_model);
                const clip = Number(item?.strength_clip);
                return {
                    lora_ref: String(
                        item?.media_ref || item?.lora_ref || ""
                    ).trim(),
                    media_type: String(item?.media_type || "lora")
                        .trim()
                        .toLowerCase(),
                    title: String(item?.title || "lora"),
                    thumb_url: String(item?.thumb_url || ""),
                    cover_kind: normalizeCoverKind(
                        item?.cover_kind || item?.coverKind
                    ),
                    cover_url: String(
                        item?.cover_url || item?.coverUrl || ""
                    ),
                    strength_model: Number.isFinite(model) ? model : null,
                    strength_clip: Number.isFinite(clip) ? clip : null,
                };
            })
            .filter((item) => item.lora_ref && item.media_type === "lora");
        if (!items.length) {
            items.push(topLevel);
        }
        return { ...topLevel, items };
    } catch {
        return null;
    }
}

/* 范围档位跟着工作流走：读回来洗一遍（脏值退回「全部」） */
function readEnableScope(node) {
    const raw = node?.properties?.[ENABLE_SCOPE_PROP];
    return sanitizeEnableScope(raw);
}

function writeEnableScope(node, scope) {
    if (!node) {
        return;
    }
    if (!node.properties || typeof node.properties !== "object") {
        node.properties = {};
    }
    const value = sanitizeEnableScope(scope);
    if (node.properties[ENABLE_SCOPE_PROP] === value) {
        return;
    }
    node.properties[ENABLE_SCOPE_PROP] = value;
    // 档位现在是「会存进工作流的数据」，所以要告诉画布「改过了」，
    // 否则关掉时不会提示保存，用户的选择会悄悄丢掉。
    node.setDirtyCanvas?.(true, true);
    node.graph?.change?.();
}

function readGlobalClipMode(node, rows = []) {
    const value = node?.properties?.[GLOBAL_CLIP_MODE_PROP];
    if (typeof value === "boolean") {
        return value;
    }
    return rows.some((item) => !!item.separate_clip_strength);
}

function writeGlobalClipMode(node, enabled) {
    if (!node.properties || typeof node.properties !== "object") {
        node.properties = {};
    }
    node.properties[GLOBAL_CLIP_MODE_PROP] = !!enabled;
}

function ensureStyles() {
    if (document.getElementById(STYLE_ID)) {
        return;
    }
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
        /* 列表卡片：工具栏 + 列表合成一个整块（和 XMediaListGet 一样，
           工具栏是卡片的顶盖，不是另外一条悬在外面的栏）。 */
        .xlora-list-shell {
            position: relative;
            display: flex;
            flex-direction: column;
            flex: 1 1 0;
            min-height: 0;
            border: 1px solid var(
                --xdh-clr-hairline,
                rgba(255, 255, 255, 0.14)
            );
            border-radius: var(--xdh-radius-sm, 8px);
            background: var(
                --xdh-clr-surface-strong,
                rgba(32, 32, 36, 0.92)
            );
            overflow: hidden;
        }
        /* 卡片顶盖上的按钮：建组 / ✔ ✖ ⇄ / 范围胶囊。
           范围胶囊本身的样式在共享引擎里（见 groupStyles）。 */
        .xlora-list-toolbar {
            display: flex;
            align-items: center;
            flex-wrap: wrap;
            gap: 6px;
            row-gap: 4px;
            min-height: 30px;
            padding: 4px 10px;
            flex: 0 0 auto;
            border: none;
            border-bottom: 1px solid var(
                --xdh-clr-hairline,
                rgba(255, 255, 255, 0.14)
            );
            border-radius: var(--xdh-radius-sm, 8px) var(--xdh-radius-sm, 8px) 0 0;
            /* 和 XMediaListGet 的工具栏同一个底色（surface-soft） */
            background: var(--xdh-clr-surface-soft, #161618);
            box-sizing: border-box;
        }
        .xlora-tbtn {
            width: 22px;
            min-width: 22px;
            height: 22px;
            padding: 0;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            border: 1px solid var(--xdh-clr-hairline, rgba(255, 255, 255, 0.14));
            border-radius: var(--xdh-radius-sm, 8px);
            background: var(--xdh-clr-surface-strong, rgba(32, 32, 36, 0.92));
            color: inherit;
            font: inherit;
            font-size: 12px;
            line-height: 1;
            cursor: pointer;
        }
        .xlora-tbtn:hover {
            border-color: var(--xlora-brand);
        }
        /* 「创建分组」是文字按钮（图标 ＋ 和 ✔ ✖ ⇄ 挤在一起分不清），
           所以宽度跟着文字走，不用 22px 的方形格子 */
        .xlora-group-btn {
            width: auto;
            min-width: 0;
            padding: 0 10px;
            font-size: 11px;
            white-space: nowrap;
        }
        .xlora-group-btn.is-disabled {
            opacity: 0.4;
            cursor: not-allowed;
        }
        .xlora-tbtn:disabled {
            opacity: 0.4;
            cursor: default;
        }
        /* 底栏：一共几条 / 开了几条（和 XMediaListGet 的底栏对齐） */
        .xlora-footer {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 8px;
            min-height: 30px;
            padding: 4px 10px;
            flex: 0 0 auto;
            border-top: 1px solid var(
                --xdh-clr-hairline,
                rgba(255, 255, 255, 0.14)
            );
            border-radius: 0 0 var(--xdh-radius-sm, 8px) var(--xdh-radius-sm, 8px);
            background: var(--xdh-clr-surface-soft, #161618);
            box-sizing: border-box;
        }
        .xlora-footer-info {
            display: flex;
            align-items: center;
            gap: 8px;
            min-width: 0;
        }
        .xlora-total {
            flex: 0 0 auto;
            font-size: 11px;
            opacity: 0.6;
            white-space: nowrap;
        }
        /* 两个数字并排：中间一条细线，免得粘在一起分不清谁是谁 */
        .xlora-footer-divider {
            flex: 0 0 auto;
            width: 1px;
            height: 11px;
            background: var(
                --xdh-clr-hairline,
                rgba(255, 255, 255, 0.14)
            );
        }
        .xlora-status {
            flex: 0 0 auto;
            opacity: 0.8;
            font-size: 11px;
            font-variant-numeric: tabular-nums;
            white-space: nowrap;
        }
        .xlora-clear {
            flex: 0 0 auto;
            margin-left: auto;
            font-size: 13px;
        }
        /* 底栏右下角的「清空」：悬停描边跟节点 ID 序列号同色
           （和 XMediaListGet 的清除按钮一致）。取不到序列号色时
           退回品牌粉，不至于没反应。 */
        .xlora-clear:hover {
            border-color: var(--xlora-accent, var(--xlora-brand));
        }
        /* 指针拖动期间整块列表不接鼠标：悬停样式全部自然失效 */
        body.xmlg-pointer-dragging .xlora-list {
            pointer-events: none;
        }
        /* 跟手的那张卡片必须完全不透明。行的底色带一点透明度，克隆成
           卡片后会透出下面那一行，看着像重影。垫一层底色把透明度吃掉
           （卡片自己的颜色仍然是主题色）。 */
        .xlora-row.xmlg-drag-ghost,
        .xmlg-group-head.xmlg-drag-ghost {
            background-color: var(--xdh-clr-canvas, #0c0c0e);
            background-image: linear-gradient(
                var(--xdh-clr-surface-strong, rgba(32, 32, 36, 0.92)),
                var(--xdh-clr-surface-strong, rgba(32, 32, 36, 0.92))
            );
        }
        /* 刷新时发现文件不在硬盘上了：危险色描边 + 淡底，
           名字的悬停提示里也会写明「文件不存在」 */
        .xlora-row.is-missing {
            border-color: var(--xdh-color-danger, #d90429);
            background: color-mix(
                in srgb,
                var(--xdh-color-danger, #d90429) 12%,
                transparent
            );
        }
        /* 组内行的序号用组色，和左侧竖线呼应 */
        .xlora-row.is-grouped .xlora-seq {
            color: var(--xmlg-group-stripe, var(--xlora-accent));
            /* 组色本身是彩色，再压透明度就看不清了（媒体那边也是不透明） */
            opacity: 1;
        }
        .xlora-panel {
            /* 悬停高亮统一用品牌粉。节点面板里不一定装到 XDataHub 那套
               token（那些是 V2 应用里才有的），所以一路留到字面色，
               取不到变量也不会退化成「白底灰边」。 */
            --xlora-brand: var(
                --xdh-brand-pink,
                var(--xdh-clr-primary, #ff385c)
            );
            /* 正文色定在面板上（和 XMediaListGet 的 .xmlg-panel 完全一样，
               连兜底色都一样），序号这类「继承色 + 半透明」的东西才不会
               因为继承到别的色而变暗。 */
            color: var(--xdh-clr-ink, #ffffff);
            position: relative;
            display: flex;
            flex-direction: column;
            gap: 6px;
            width: 100%;
            height: 100%;
            box-sizing: border-box;
            padding: 8px;
        }
        .xlora-toast {
            /* 挂在列表底部：提示条弹出来不该盖住最上面的行 */
            position: absolute;
            left: 50%;
            bottom: 46px;
            transform: translateX(-50%);
            max-width: 92%;
            padding: 6px 12px;
            border-radius: 999px;
            background: var(
                --xdh-clr-surface-strong,
                rgba(32, 32, 36, 0.92)
            );
            border: 1px solid
                var(--xdh-clr-hairline, rgba(255, 255, 255, 0.14));
            color: var(--xdh-clr-ink, #f2f2f2);
            font: var(
                --xdh-font-micro-label,
                700 12px/1.33 system-ui, -apple-system, sans-serif
            );
            box-shadow: 0 6px 20px rgba(0, 0, 0, 0.28);
            pointer-events: none;
            display: none;
            z-index: 40;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        .xlora-toast.is-visible {
            display: block;
        }
        .xlora-insert-line {
            position: absolute;
            left: 4px;
            right: 4px;
            height: 2px;
            border-radius: 2px;
            background: var(
                --xlora-accent,
                var(--xdh-clr-primary, #7fb4ff)
            );
            box-shadow: 0 0 8px var(
                --xlora-accent,
                var(--xdh-clr-primary, #7fb4ff)
            );
            pointer-events: none;
            display: none;
            z-index: 6;
        }
        .xlora-drop-label {
            position: absolute;
            left: 50%;
            transform: translateX(-50%);
            padding: 2px 8px;
            border-radius: 999px;
            background: var(
                --xlora-accent,
                var(--xdh-clr-primary, #2f6fed)
            );
            color: var(--xdh-clr-on-primary, #fff);
            font-size: 11px;
            font-weight: 600;
            pointer-events: none;
            display: none;
            z-index: 7;
            white-space: nowrap;
        }
        /* 徽章行：高度跟着徽章走（写死 20px 会让 26px 高的徽章上下顶出去，
           看起来就是「序列号和撤销重做那一行贴在一起」）。XMediaListGet
           用的是「最小 22、高度随内容」。 */
        .xlora-meta {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 8px;
            min-height: 22px;
            flex: 0 0 auto;
        }
        .xlora-list {
            /* 插入线、胶囊标签用绝对定位贴在这一层上 */
            position: relative;
            display: flex;
            flex-direction: column;
            gap: 8px;
            min-height: 160px;
            flex: 1 1 0;
            border: none;
            background: transparent;
            border-radius: 0;
            padding: 8px;
            box-sizing: border-box;
            /* 和 XMediaListGet 的 .xmlg-list 一致：横向永不出现滚动条，
               竖直方向常驻预留一条的位置。否则清单长到能滚/缩到不能滚
               两种状态之间切换时，行宽会跟着变，看上去像整排被挤扁了。 */
            overflow-x: hidden;
            overflow-y: scroll;
            scrollbar-gutter: stable;
            overflow-anchor: none;
            scrollbar-width: auto;
            scrollbar-color: var(--xdh-scrollbar-thumb, #555) var(--xdh-scrollbar-track, transparent);
        }
        .xlora-list::-webkit-scrollbar {
            width: 10px;
            height: 10px;
        }
        .xlora-list::-webkit-scrollbar-track {
            background: var(--xdh-scrollbar-track, transparent);
        }
        .xlora-list::-webkit-scrollbar-thumb {
            background: var(--xdh-scrollbar-thumb, #555);
            border-radius: 4px;
        }
        .xlora-list::-webkit-scrollbar-thumb:hover {
            background: var(--xdh-scrollbar-thumb-hover, #777);
        }
        /* 工具栏里成组按钮之间的细竖线：刷新 / 建组 / 批量开关
           是三件事，挨在一起会看成一组 */
        .xlora-tb-divider {
            flex: 0 0 auto;
            width: 1px;
            height: 14px;
            margin: 0 2px;
            background: var(--xdh-clr-hairline, rgba(255, 255, 255, 0.14));
        }
        /* 列表卡片外面的一行：左边撤销重做，右边 Clip 开关（和
           XMediaListGet 的那一行一样，只有内容、没有外框） */
        .xlora-toolbar {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 6px;
            flex-wrap: wrap;
            flex: 0 0 auto;
        }
        .xlora-toolbar-left {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            flex: 0 0 auto;
        }
        /* Clip 开关：开关本体 + 文字，文字不能省——光一个开关没人知道
           它管什么；更详细的解释挂在悬停提示上 */
        .xlora-clip-toggle {
            display: inline-flex;
            align-items: center;
            gap: 7px;
            font-size: 11px;
            color: var(--xdh-color-text-primary, #ededed);
            user-select: none;
            white-space: nowrap;
            flex: 0 0 auto;
            cursor: pointer;
        }
        .xlora-switch-input {
            position: absolute;
            opacity: 0;
            width: 0;
            height: 0;
            pointer-events: none;
        }
        .xlora-switch-track {
            position: relative;
            display: inline-flex;
            align-items: center;
            width: 24px;
            min-width: 24px;
            height: 14px;
            border-radius: var(--xdh-radius-full, 999px);
            border: 1px solid
                var(--xdh-clr-hairline, rgba(255, 255, 255, 0.16));
            background: var(--xdh-clr-surface-strong, rgba(32, 32, 36, 0.92));
            box-sizing: border-box;
            transition: background 0.15s ease, border-color 0.15s ease,
                box-shadow 0.15s ease;
        }
        .xlora-switch-track::after {
            content: "";
            position: absolute;
            top: 1px;
            left: 1px;
            width: 10px;
            height: 10px;
            border-radius: 50%;
            background: var(--xdh-clr-ink, #f2f2f2);
            transition: transform 0.15s ease, background 0.15s ease;
        }
        .xlora-switch-input:checked + .xlora-switch-track {
            border-color: var(--xdh-clr-primary, #ff385c);
            background: var(
                --xdh-color-primary-muted,
                rgba(255, 56, 92, 0.28)
            );
        }
        .xlora-switch-input:checked + .xlora-switch-track::after {
            transform: translateX(10px);
            background: var(--xdh-clr-primary, #ff385c);
        }
        .xlora-switch-input:focus-visible + .xlora-switch-track {
            box-shadow: 0 0 0 1px var(--xdh-clr-primary, #ff385c);
        }
        .xlora-node-badge {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            border: 1px solid var(--xlora-accent, var(--xlora-brand));
            border-radius: var(--xdh-radius-full, 999px);
            background: var(--xdh-clr-surface-strong, rgba(32, 32, 36, 0.92));
            padding: 4px 12px;
            color: var(--xdh-clr-ink, #f2f2f2);
            flex: 0 0 auto;
        }
        .xlora-node-badge-chip {
            font-size: 16px;
            line-height: 1;
            font-variant-numeric: tabular-nums;
            font-family: ui-monospace, "Cascadia Mono", "Consolas", monospace;
            letter-spacing: 0.15px;
            color: var(--xlora-accent, var(--xlora-brand));
            font-weight: 700;
        }
        .xlora-node-badge-swatch {
            width: 18px;
            height: 18px;
            border-radius: var(--xdh-radius-xs, 4px);
            background: var(--xlora-accent, var(--xlora-brand));
            box-shadow: inset 0 0 0 1px
                var(--xdh-clr-hairline, rgba(255, 255, 255, 0.14));
        }
        .xlora-kind-emoji {
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
        .xlora-kind-emoji-push {
            margin-left: auto;
        }
        .xlora-list.drag-over {
            border-color: var(--xlora-brand);
            box-shadow: 0 0 0 1px var(--xlora-brand);
        }
        .xlora-empty {
            font: var(
                --xdh-font-micro-label,
                700 12px/1.33 system-ui, -apple-system, sans-serif
            );
            text-align: center;
            color: var(--xdh-clr-ink, #f2f2f2);
            opacity: 0.85;
            padding: 18px 8px;
            line-height: 1.5;
        }
        /* 加载序号：单独一列，右边一条分隔线，和后面的开关分开
           （和 XMediaListGet 的行首序号保持一致）。 */
        .xlora-seq {
            position: relative;
            flex: 0 0 26px;
            min-width: 26px;
            /* 撑满整张卡片的高度，数字才在上下居中（不再偏到第一行） */
            align-self: stretch;
            display: flex;
            align-items: center;
            justify-content: center;
            text-align: center;
            font-size: 10px;
            line-height: 1;
            font-variant-numeric: tabular-nums;
            /* 颜色继承面板正文色：和 XMediaListGet 一样只靠透明度变淡，
               再叠一层灰会明显比那边暗 */
            color: inherit;
            box-sizing: border-box;
            /* 行左边有 8px 内边距：右边也留出同样的 8px，数字才在
               「行左边框到分隔线」这一整段里居中（和 XMediaListGet 一致） */
            padding-right: 8px;
            opacity: 0.6;
            user-select: none;
        }
        /* 序号右边那条竖线：画成绝对定位的细线，上下各拉出内边距那么多，
           正好顶到行的上下边框上。用负外边距会跟着 flex 收缩算，位置会
           溢出到胶囊描边之外（Chromium 实测溢出 3~4px）。 */
        .xlora-seq::after {
            content: "";
            position: absolute;
            right: 0;
            top: -8px;
            bottom: -8px;
            width: 1px;
            background: var(--xdh-clr-hairline, rgba(255, 255, 255, 0.14));
            pointer-events: none;
        }
        .xlora-row.inactive .xlora-seq {
            opacity: 0.45;
        }
        .xlora-seq.is-skipped {
            opacity: 0.5;
        }
        /* 行 = 左边一列序号（贯穿整张卡片、上下居中）+ 右边的正文。
           序号单独占一列，数字才会在整行里居中、分隔线也从上贯到下。 */
        .xlora-row {
            border: 1px solid var(--xdh-clr-hairline, rgba(255, 255, 255, 0.14));
            border-radius: var(--xdh-radius-sm, 8px);
            background: var(
                --xdh-clr-surface-strong,
                rgba(32, 32, 36, 0.92)
            );
            padding: 8px;
            box-sizing: border-box;
            display: flex;
            flex-direction: row;
            align-items: stretch;
            gap: 8px;
            min-height: 60px;
            flex: 0 0 auto;
            overflow: visible;
        }
        .xlora-row-body {
            display: flex;
            flex-direction: column;
            gap: 8px;
            flex: 1 1 auto;
            min-width: 0;
            /* 右侧那条分隔线落在行间距里（离移除按钮 8px），正文也留
               同样的 8px，强度输入框才不会顶着线 */
            padding-right: 8px;
            box-sizing: border-box;
        }
        /* 悬停时只换边框颜色（品牌粉），和 XMediaListGet 的行一致。
           必须写在 .dragging 之前：拖动中的虚线框有自己的一套颜色。 */
        .xlora-row:hover {
            border-color: var(
                --xdh-brand-pink,
                var(--xdh-clr-primary, #ff385c)
            );
        }
        .xlora-row-main {
            width: 100%;
            display: flex;
            align-items: center;
            gap: 8px;
            min-width: 0;
        }
        .xlora-active {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 24px;
            min-width: 24px;
            position: relative;
            cursor: pointer;
        }
        .xlora-row.inactive {
            opacity: 0.62;
        }
        /* 拖动中的行：不能用「变淡」表示，那样和被禁用的行分不开。
           改成虚线描边 + 强调色底 + 抬起的阴影，读作「正被搬走」。
           这条必须写在 .inactive 之后：禁用的行同样可以拖，两个类同时
           命中时以「正在拖动」为准。 */
        .xlora-row.dragging {
            opacity: 0.95;
            border-width: 1px;
            border-style: dashed;
            border-color: var(
                --xlora-accent,
                var(--xdh-clr-primary, #7fb4ff)
            );
            background: color-mix(
                in srgb,
                var(--xlora-accent, var(--xdh-clr-primary, #7fb4ff)) 12%,
                var(--xdh-clr-surface-strong, rgba(32, 32, 36, 0.92))
            );
            box-shadow: 0 8px 20px rgba(0, 0, 0, 0.35);
            transform: scale(0.985);
            cursor: grabbing;
        }
        .xlora-name {
            flex: 1 1 auto;
            min-width: 0;
            font: var(
                --xdh-font-micro-label,
                700 12px/1.33 system-ui, -apple-system, sans-serif
            );
            color: var(--xdh-clr-ink, #f2f2f2);
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            cursor: default;
        }
        .xlora-trigger-row {
            width: 100%;
            display: flex;
            flex-direction: column;
            gap: 6px;
            margin-top: 0;
        }
        .xlora-trigger-row-main {
            width: 100%;
            display: flex;
            align-items: center;
            gap: 6px;
            min-width: 0;
        }
        .xlora-trigger-inline {
            flex: 1 1 auto;
            min-width: 0;
            display: flex;
            flex-wrap: nowrap;
            gap: 6px;
            align-items: center;
            overflow-x: auto;
            overflow-y: hidden;
            scrollbar-width: auto;
            scrollbar-color: var(--xdh-scrollbar-thumb, #555) var(--xdh-scrollbar-track, transparent);
        }
        .xlora-trigger-inline::-webkit-scrollbar {
            height: 6px;
        }
        .xlora-trigger-inline::-webkit-scrollbar-track {
            background: var(--xdh-scrollbar-track, transparent);
        }
        .xlora-trigger-inline::-webkit-scrollbar-thumb {
            background: var(--xdh-scrollbar-thumb, #555);
            border-radius: 4px;
        }
        .xlora-trigger-inline::-webkit-scrollbar-thumb:hover {
            background: var(--xdh-scrollbar-thumb-hover, #777);
        }
        .xlora-trigger-chip {
            width: 112px;
            max-width: 112px;
            min-height: 24px;
            height: 24px;
            flex: 0 0 auto;
            display: inline-flex;
            align-items: center;
            justify-content: flex-start;
            border: 1px solid var(--xdh-clr-primary, #ff385c);
            background: color-mix(in srgb, var(--xlora-brand) 12%, transparent);
            color: var(--xdh-clr-ink, #f2f2f2);
            border-radius: var(--xdh-radius-full, 999px);
            padding: 0 10px;
            box-sizing: border-box;
            font-size: 11px;
            line-height: 1.3;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            cursor: pointer;
            user-select: none;
        }
        .xlora-trigger-more {
            height: 24px;
            min-width: 54px;
            border-radius: var(--xdh-radius-full, 999px);
            border: 1px solid
                var(--xdh-clr-hairline, rgba(255, 255, 255, 0.14));
            background: var(--xdh-clr-surface-soft, #161618);
            color: var(--xdh-clr-ink, #f2f2f2);
            font-size: 11px;
            line-height: 1.3;
            padding: 0 10px;
            cursor: pointer;
            flex: 0 0 auto;
            transition: border-color 0.15s ease;
        }
        .xlora-trigger-more:hover {
            border-color: var(--xlora-brand);
        }
        .xlora-trigger-panel {
            border: 1px solid var(--xdh-clr-hairline, rgba(255, 255, 255, 0.14));
            background: var(--xdh-clr-surface-soft, #161618);
            border-radius: var(--xdh-radius-sm, 8px);
            padding: 8px;
            display: flex;
            flex-direction: column;
            gap: 8px;
        }
        .xlora-trigger-panel-header {
            display: flex;
            align-items: center;
            gap: 6px;
            min-width: 0;
        }
        .xlora-trigger-search {
            flex: 1 1 auto;
            min-width: 0;
            height: 24px;
            border-radius: var(--xdh-radius-xs, 4px);
            border: 1px solid var(--xdh-clr-hairline, rgba(255, 255, 255, 0.14));
            background: var(--xdh-clr-surface-soft, #161618);
            color: var(--xdh-clr-ink, #f2f2f2);
            padding: 0 8px;
            box-sizing: border-box;
            font-size: 11px;
        }
        .xlora-trigger-actions {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            flex: 0 0 auto;
        }
        .xlora-trigger-action {
            height: 24px;
            border-radius: var(--xdh-radius-sm, 8px);
            border: 1px solid
                var(--xdh-clr-hairline, rgba(255, 255, 255, 0.14));
            background: var(--xdh-clr-surface-soft, #161618);
            color: var(--xdh-clr-ink, #f2f2f2);
            font-size: 11px;
            line-height: 1;
            padding: 0 8px;
            cursor: pointer;
            transition: border-color 0.15s ease;
        }
        .xlora-trigger-action:hover {
            border-color: var(--xlora-brand);
        }
        .xlora-trigger-panel-list {
            display: flex;
            flex-wrap: wrap;
            gap: 6px;
            max-height: 168px;
            overflow-y: auto;
            overscroll-behavior: contain;
            padding-right: 2px;
            scrollbar-width: auto;
            scrollbar-color: var(--xdh-scrollbar-thumb, #555) var(--xdh-scrollbar-track, transparent);
        }
        .xlora-trigger-panel-list::-webkit-scrollbar {
            width: 10px;
            height: 10px;
        }
        .xlora-trigger-panel-list::-webkit-scrollbar-track {
            background: var(--xdh-scrollbar-track, transparent);
        }
        .xlora-trigger-panel-list::-webkit-scrollbar-thumb {
            background: var(--xdh-scrollbar-thumb, #555);
            border-radius: 4px;
        }
        .xlora-trigger-panel-list::-webkit-scrollbar-thumb:hover {
            background: var(--xdh-scrollbar-thumb-hover, #777);
        }
        .xlora-trigger-panel-empty {
            font-size: 11px;
            color: var(--xdh-clr-ink, #f2f2f2);
            opacity: 0.9;
            padding: 4px 2px;
        }
        .xlora-trigger-chip.is-disabled {
            opacity: 0.45;
            background: var(--xdh-clr-surface-soft, #161618);
            border-color: var(--xdh-clr-hairline, rgba(255, 255, 255, 0.14));
            color: var(--xdh-clr-ink, #f2f2f2);
        }
        .xlora-trigger-chip.is-placeholder {
            cursor: default;
            border-style: dashed;
            background: var(--xdh-clr-surface-soft, #161618);
            border-color: var(--xdh-clr-hairline, rgba(255, 255, 255, 0.14));
            color: var(--xdh-clr-ink, #f2f2f2);
        }
        /* 行内「刷新触发词」按钮：和工具栏的小方钮同一套外观。
           以前用的是 V2 应用里才有的 token，节点面板里根本取不到值，
           背景和描边整条声明失效，按钮就露出浏览器默认的白底灰边。 */
        .xlora-trigger-refresh {
            width: 22px;
            min-width: 22px;
            height: 22px;
            border-radius: var(--xdh-radius-sm, 8px);
            border: 1px solid
                var(--xdh-clr-hairline, rgba(255, 255, 255, 0.14));
            background: var(
                --xdh-clr-surface-strong,
                rgba(32, 32, 36, 0.92)
            );
            color: inherit;
            font: inherit;
            font-size: 12px;
            line-height: 1;
            cursor: pointer;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            padding: 0;
            transition: border-color 0.15s ease;
        }
        .xlora-trigger-refresh:hover {
            border-color: var(--xlora-brand);
        }
        .xlora-trigger-refresh:disabled {
            opacity: 0.5;
            cursor: default;
        }
        .xlora-controls {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            flex: 0 0 auto;
        }
        .xlora-label {
            font-size: 11px;
            opacity: 0.96;
            color: var(--xdh-clr-ink, #f2f2f2);
            font-weight: 700;
            letter-spacing: 0.02em;
            text-shadow: none;
        }
        .xlora-label-model {
            color: #b56cff;
        }
        .xlora-label-clip {
            color: #f4c14b;
        }
        .xlora-input {
            width: 68px;
            height: 24px;
            border-radius: var(--xdh-radius-xs, 4px);
            border: 1px solid var(--xdh-clr-hairline, rgba(255, 255, 255, 0.14));
            background: var(--xdh-clr-surface-soft, #161618);
            color: var(--xdh-clr-ink, #f2f2f2);
            padding: 0 6px;
            box-sizing: border-box;
            font-size: 11px;
        }
        .xlora-lock-btn {
            width: 22px;
            min-width: 22px;
            height: 22px;
            /* 和工具栏的小方钮同圆角（工具条上全是 8px） */
            border-radius: var(--xdh-radius-sm, 8px);
            border: 1px solid
                var(--xdh-clr-hairline, rgba(255, 255, 255, 0.14));
            background: var(
                --xdh-clr-surface-strong,
                rgba(32, 32, 36, 0.92)
            );
            color: var(--xdh-color-text-secondary, #9a9a9a);
            line-height: 0;
            cursor: pointer;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            padding: 0;
        }
        /* 图标用内联 SVG 画：⤒/⤓ 这类字符在小尺寸或缩放后会被字体
           栅格化糊掉，矢量描边始终是清晰的一条线。 */
        .xlora-pin-icon {
            display: block;
            pointer-events: none;
        }
        .xlora-lock-btn:hover {
            color: var(--xdh-clr-ink, #f2f2f2);
            border-color: var(--xlora-brand);
        }
        .xlora-lock-btn.active {
            border-color: var(--xdh-clr-primary, #7fb4ff);
            color: var(--xdh-clr-primary, #7fb4ff);
        }
        /* 移除按钮待在自己的小格子里：格子撑满行高，竖线用绝对定位画，
           上下各拉出内边距那么多 → 顶到行的上下边框，且不会越界。 */
        .xlora-remove-cell {
            position: relative;
            flex: 0 0 auto;
            align-self: stretch;
            display: flex;
            align-items: center;
        }
        .xlora-remove-cell::before {
            content: "";
            position: absolute;
            left: -8px;
            top: -8px;
            bottom: -8px;
            width: 1px;
            background: var(--xdh-clr-hairline, rgba(255, 255, 255, 0.14));
            pointer-events: none;
        }
        .xlora-remove {
            /* 单独站在行的右侧、竖向居中（行是 stretch 布局，这里要自己歪回来） */
            align-self: center;
            flex: 0 0 auto;
            width: 22px;
            min-width: 22px;
            height: 22px;
            /* 和工具栏按钮、XMediaListGet 的移除按钮同一个圆角 */
            border-radius: var(--xdh-radius-sm, 8px);
            border: 1px solid
                var(--xdh-clr-hairline, rgba(255, 255, 255, 0.14));
            background: var(--xdh-clr-surface-strong, rgba(32, 32, 36, 0.92));
            color: var(--xdh-color-text-primary, #ededed);
            font-size: 12px;
            line-height: 1;
            cursor: pointer;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            padding: 0;
            opacity: 0.8;
            transition: background 0.15s ease, border-color 0.15s ease,
                color 0.15s ease, opacity 0.15s ease;
        }
        /* 悬停：变红警告一下（和 XMediaListGet 的移除按钮同一套颜色） */
        .xlora-remove:hover {
            opacity: 1;
            background: var(--xmlg-danger-soft, rgba(217, 4, 41, 0.16));
            color: var(--xmlg-danger-text, #ff6b6b);
            border-color: var(--xmlg-danger, #d90429);
        }
        .xlora-tooltip {
            position: fixed;
            z-index: 99999;
            pointer-events: none;
            background: var(--xdh-clr-surface-strong, rgba(32, 32, 36, 0.92));
            border: 1px solid var(--xdh-clr-hairline, rgba(255, 255, 255, 0.14));
            border-radius: var(--xdh-radius-sm, 8px);
            padding: 8px;
            /* 宽度跟着内容走：只写「移除」这种短文字时，不该撑出
               半个面板宽的空框；上限仍是 212px。带封面图的提示框
               固定 212px（见 .xlora-tooltip.has-thumb）。 */
            width: max-content;
            min-width: 0;
            max-width: 212px;
            box-sizing: border-box;
            color: var(--xdh-clr-ink, #f2f2f2);
            box-shadow: var(
                --xdh-shadow-popup,
                0 10px 26px rgba(0, 0, 0, 0.45)
            );
            display: none;
        }
        .xlora-tooltip-media {
            position: relative;
            width: 120px;
            margin: 0 auto;
        }
        .xlora-tooltip img,
        .xlora-tooltip video {
            width: 120px;
            height: 120px;
            display: block;
            object-fit: contain;
            background: #000;
            border-radius: var(--xdh-radius-xs, 4px);
        }
        .xlora-tooltip-name {
            font: var(
                --xdh-font-micro-label,
                700 12px/1.33 system-ui, -apple-system, sans-serif
            );
            line-height: 1.35;
            white-space: normal;
            word-break: keep-all;
            overflow-wrap: break-word;
        }
        .xlora-tooltip.has-thumb {
            width: 212px;
        }
        /* 没有封面图时把 120px 的图片位一起收掉，否则短文字的提示框
           会被这个空位撑成一个偏宽的空盒子。 */
        .xlora-tooltip:not(.has-thumb) .xlora-tooltip-media {
            display: none;
        }
        .xlora-tooltip.has-thumb .xlora-tooltip-name {
            margin-top: 8px;
            padding-top: 8px;
            border-top: 1px solid var(--xdh-clr-hairline, rgba(255, 255, 255, 0.14));
        }
        .xlora-tooltip-divider {
            margin-top: 6px;
            padding-top: 6px;
            border-top: 1px solid var(--xdh-clr-hairline, rgba(255, 255, 255, 0.14));
            display: none;
        }
        .xlora-tooltip-note {
            font-size: 11px;
            line-height: 1.35;
            color: var(--xdh-clr-ink, #f2f2f2);
            white-space: normal;
            overflow-wrap: break-word;
            word-break: break-word;
            display: none;
        }
        /* 分组那一层的样式（组头胶囊、竖线、折叠、范围、对话框、拖动）
           全部来自共享引擎，两个节点一份，改一处两边一起变。 */
        ${groupStyles([".xlora-panel"])}
    `;
    document.head.appendChild(style);
}

function ensureStorageWidget(node) {
    const widgets = node.widgets || [];
    let widget = widgets.find((item) => item?.name === STORAGE_WIDGET);
    if (!widget && typeof node.addWidget === "function") {
        widget = node.addWidget("text", STORAGE_WIDGET, "[]", () => {});
    }
    // 五层隐藏 + 移除输入圆点（见 skill comfyui-node-inputs）。
    applyHiddenWidgetLayers(widget);
    if (widget) {
        widget.serializeValue = () => widget.value;
    }
    removeWidgetInput(node, STORAGE_WIDGET);
    return widget || null;
}

/**
 * 把存盘字符串里的行取出来。
 *
 * 新格式是 {version, rows, groups}，旧格式就是一个行数组——两种都得认，
 * 否则打开老工作流整条 LoRA 栈会凭空消失。
 */
function parseStoredRows(raw) {
    const text = String(raw || "").trim();
    if (!text) {
        return [];
    }
    let payload;
    try {
        payload = JSON.parse(text);
    } catch {
        return [];
    }
    const list = Array.isArray(payload) ? payload : payload?.rows;
    return normalizeRows(list);
}

/**
 * 组记录（组名 / 颜色 / 折叠状态 / 序号）。
 *
 * 分组 UI 还没接上，这里只做一件事：存盘时原样带回去，别把数据丢了。
 * 所以不在这里做整理，一个字都不改地读出来、写回去。
 */
function readStoredGroups(node) {
    const raw = String(ensureStorageWidget(node)?.value || "").trim();
    if (!raw) {
        return [];
    }
    try {
        const payload = JSON.parse(raw);
        if (!payload || Array.isArray(payload) || typeof payload !== "object") {
            return [];
        }
        return Array.isArray(payload.groups) ? payload.groups : [];
    } catch {
        return [];
    }
}

function readStoredRows(node) {
    const widget = ensureStorageWidget(node);
    return parseStoredRows(widget?.value);
}

/* ---------------------------------------------------------------------
 * 分组：和 XMediaListGet 共用一份实现（web/core/group-list.js）
 *
 * 引擎按「分类」组织列表（媒体有图片 / 视频 / 音频三类），LoRA 只有一类，
 * 所以这里给它一个固定的占位分类，再补一层转接：
 *
 *   存盘里：{ rows: [...], groups: [...] }
 *   引擎里：{ image: [...], video: [], audio: [], groups: { image: [...] } }
 *
 * 行归属存在每一行的 group 字段上（null = 没分组），组本身只记
 * id / name / collapsed / color / seq 五个字段。
 * ------------------------------------------------------------------- */
const LORA_CATEGORY = "image";

/** 造一个带类名（可选文字）的元素。 */
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

/** 行身份：LoRA 每一行本来就有唯一 id，直接用它。 */
function loraKeyOf(row) {
    return String(row?.id ?? "");
}

function emptyLoraItems() {
    return {
        image: [],
        video: [],
        audio: [],
        groups: { image: [], video: [], audio: [] },
    };
}

/**
 * 用「行 + 组」拼出引擎要的形状。
 *
 * 每次渲染前重算一遍：组的连续性、空组清理都交给纯数据层，
 * 免得两套数据各记一份、越走越远。
 */
function loraItemsFromState(state) {
    const rows = enforcePinLayout(state.rows || []);
    const normalized = normalizeGroups(rows, state.groups || []);
    state.rows = normalized.items;
    state.groups = normalized.groups;
    state.items = {
        image: state.rows,
        video: [],
        audio: [],
        groups: { image: state.groups, video: [], audio: [] },
    };
    return state.items;
}

function readLoraItems(node) {
    const state = node?.__xlora_panel?.state;
    if (state) {
        return loraItemsFromState(state);
    }
    const rows = readStoredRows(node);
    const groups = readStoredGroups(node);
    return {
        ...emptyLoraItems(),
        image: rows,
        groups: { image: groups, video: [], audio: [] },
    };
}

/**
 * 引擎改完数据后写回来。
 *
 * 引擎只认 items（含 groups.image），这里把它拆回 state.rows / state.groups，
 * 再走原来的存盘，所以 Python 那边看到的还是 rows + groups 两份。
 */
function writeLoraItems(node, items, options = {}) {
    const state = node?.__xlora_panel?.state;
    if (options.recordUndo !== false && state) {
        // 先存一份「改之前」的样子，撤销才有东西可退
        engine.pushUndoSnapshot(node);
    }
    const rows = enforcePinLayout(Array.isArray(items?.image) ? items.image : []);
    const groups = Array.isArray(items?.groups?.image)
        ? items.groups.image
        : [];
    if (state) {
        state.rows = rows;
        state.groups = groups;
        state.items = {
            image: rows,
            video: [],
            audio: [],
            groups: { image: groups, video: [], audio: [] },
        };
    }
    writeStoredRows(node, rows);
    engine.updateUndoButton(node);
}

/** 把某一行滚进视野（点组头收窄范围时用）。 */
function scrollLoraRowIntoView(node, index) {
    const list = node?.__xlora_panel?.list;
    if (!list) {
        return;
    }
    const el = list.querySelector(`.xlora-row[data-index="${index}"]`);
    el?.scrollIntoView?.({ block: "nearest" });
}

/** 引擎以为存在这个函数；LoRA 的输出端口不随列表变，什么都不用做。 */
function syncLoraOutputPortType() {}

/** 拖进来几条：XDataHub 的拖拽自己会算，这里给个保底。 */
function dragCountFromDataTransfer() {
    return 1;
}

/** 「类型不对」的提示条：LoRA 列表用的是自己的 toast，没有这条。 */
function hideTypeMismatch() {}

/** 分组的小提示挂在 body 上（和行内的 tooltip 各走各的）。 */
function hintHost() {
    return document.body;
}

/**
 * 分组引擎实例。
 *
 * 引擎负责组那一层（组头 / 竖线 / 折叠 / 拖拽 / 范围 / 撤销），
 * 行的长相、存盘、文案都从这里注入进去。
 */
const engine = createGroupEngine({
    keyOf: loraKeyOf,
    // LoRA 行用 active 表示开 / 关（媒体那边叫 enabled）
    isRowEnabled: (row) => !!row && row.active !== false,
    setRowEnabled: (row, value) => {
        if (row) {
            row.active = !!value;
        }
    },
    // 文案里的 {noun} 用的词：这一列表里装的是 LoRA，不是文件
    nounMany: () => t("xdatahub.ui.group.noun_loras", "LoRAs"),
    nounOne: () => t("xdatahub.ui.group.noun_lora", "LoRA"),
    // 面板挂在节点上的字段名（引擎按它找面板）
    panelKey: "__xlora_panel",
    element,
    t,
    normalizeItems: (raw) => {
        // 存盘数据 → 引擎数据（老工作流是纯数组，新的是 {rows, groups}）
        const payload = Array.isArray(raw) ? { rows: raw } : (raw || {});
        const rows = normalizeRows(payload.rows);
        const groups = Array.isArray(payload.groups) ? payload.groups : [];
        const normalized = normalizeGroups(rows, groups);
        return {
            image: normalized.items,
            video: [],
            audio: [],
            groups: {
                image: normalized.groups,
                video: [],
                audio: [],
            },
        };
    },
    emptyItems: emptyLoraItems,
    writeItems: writeLoraItems,
    renderPanel: (node) => renderNodeRows(node),
    // 拖动时是就地搬位置（不重画），序号由这里补
    refreshRowNumbers: refreshLoraRowNumbers,
    ensureStorageWidget,
    scrollRowIntoView: scrollLoraRowIntoView,
    syncOutputPortType: syncLoraOutputPortType,
    startDropAutoScroll: (node, dir) => {
        const state = node?.__xlora_panel?.state;
        if (state) {
            startDropAutoScroll(node, state, dir);
        }
    },
    stopDropAutoScroll: (nodeOrState) => {
        const state = nodeOrState?.state
            ? nodeOrState.state
            : nodeOrState;
        stopDropAutoScroll(state);
    },
    dragCountFromDataTransfer,
    hideTypeMismatch,
    hintHost,
    buildRow: (node, category, row, index, seq) => (
        buildLoraRow(node, row, index, seq)
    ),
    // 置顶/置底是硬约束：拖别的行到它们前面/后面都会被钳回去。
    // 引擎在中途（拖动过程中）就调用这个钩子，所以不会出现「先挪过去、
    // 过一会儿又被弹回原位」的怪象。
    applyOrderConstraints: (node, rows) => enforcePinLayout(rows),
    // 用户点档位时落盘（临时收窄不落盘，见引擎里的 selectScope）
    writeEnableScope,
    applyPointerDragStop: (node) => {
        const pending = node?.__xlora_panel?.state?.pointerDrag;
        if (!pending?.active) {
            return;
        }
        if (pending.kind === "group") {
            engine.liveMoveGroup(
                node,
                engine.resolveGroupGap(node, pending.clientY)
            );
            return;
        }
        const target = engine.resolveLiveRowTarget(node, pending.clientY);
        engine.liveMoveRow(node, target.gap, target.groupId);
    },
});

/**
 * 消费「画布拖拽建节点」时预置的种子行。
 *
 * 为什么不能在建面板时读：ComfyUI 的节点类在**构造函数里**就同步触发了
 * nodeCreated 扩展钩子（LGraphNode 构造函数 → invokeExtensionsAsync），
 * 那时 LiteGraph.createNode 还没把 options（种子字段）赋到节点上；等
 * options 赋值完成、onNodeCreated 再调 installNodeUi 时，面板已装好，
 * 只会走「已安装」早退分支。所以种子要在这里主动补一次。
 */
function consumePendingRows(node) {
    const pending = String(node?.[PENDING_ROWS_FIELD] || "").trim();
    if (!pending) {
        return false;
    }
    // 先删除：只消费一次，避免重复插入。
    delete node[PENDING_ROWS_FIELD];
    let incoming = [];
    try {
        incoming = normalizeRows(JSON.parse(pending));
    } catch {
        return false;
    }
    if (!incoming.length) {
        return false;
    }
    const panel = node.__xlora_panel;
    const rows = Array.isArray(panel?.state?.rows) ? panel.state.rows : [];
    const existingRefs = new Set(rows.map((row) => row.lora_ref));
    const added = incoming.filter((row) => !existingRefs.has(row.lora_ref));
    if (!added.length) {
        return false;
    }
    const nextRows = enforcePinLayout([...rows, ...added]);
    if (!panel) {
        const widget = ensureStorageWidget(node);
        if (widget) {
            widget.value = JSON.stringify(
                serializeStoredPayload(
                    nextRows,
                    readStoredGroups(node),
                    readGlobalClipMode(node, nextRows)
                )
            );
        }
        return true;
    }
    panel.state.rows = nextRows;
    if (nextRows.some((row) => row.separate_clip_strength)) {
        panel.state.globalSeparateClip = true;
    }
    writeStoredRows(node, nextRows);
    renderNodeRows(node);
    syncAllRowTriggerWords(node, { force: true });
    refreshNodeBadge(node);
    return true;
}

/** 存盘负载：行 + 组 + 版本号（Python 只读 rows）。 */
function serializeStoredPayload(rows, groups, globalSeparateClip) {
    return {
        version: STORAGE_VERSION,
        rows: serializeStoredRows(rows, globalSeparateClip),
        groups: Array.isArray(groups) ? groups : [],
    };
}

function serializeStoredRows(rows, globalSeparateClip) {
    return rows.map((item) => ({
        active: item.active !== false,
        lora_ref: item.lora_ref,
        lora_name: item.lora_name,
        title: item.title || "",
        strength_model: item.strength_model,
        separate_clip_strength: globalSeparateClip,
        strength_clip: globalSeparateClip
            ? item.strength_clip
            : item.strength_model,
        trigger_words: normalizeTriggerWords(item.trigger_words),
        lora_note: String(item.lora_note || ""),
        thumb_url: item.thumb_url || "",
        cover_kind: normalizeCoverKind(item.cover_kind),
        cover_url: String(item.cover_url || ""),
        pin: item.pin || "none",
        group: item.group || null,
    }));
}

function writeStoredRows(node, rows) {
    const panel = node.__xlora_panel;
    const globalSeparateClip = !!panel?.state?.globalSeparateClip;
    const widget = ensureStorageWidget(node);
    if (!widget) {
        return;
    }
    // 组记录：先把现有的读出来再覆盖（读和写在同一个 widget 上，顺序不能反）
    const groups = Array.isArray(panel?.state?.groups)
        ? panel.state.groups
        : readStoredGroups(node);
    widget.value = JSON.stringify(
        serializeStoredPayload(rows, groups, globalSeparateClip)
    );
    node.setDirtyCanvas?.(true, true);
}

/**
 * 某个 LoRA 换了封面：把节点里对应那一行的缩略图换掉。
 *
 * XDataHub 里换完封面会发消息过来，否则节点面板要重新拖一次才更新。
 */
function applyLoraCoverChange(payload) {
    const ref = String(payload?.ref || "").trim();
    if (!ref) {
        return;
    }
    const thumbUrl = String(payload?.thumb_url || "");
    const coverUrl = String(payload?.cover_url || "");
    const coverKind = normalizeCoverKind(payload?.cover_kind || payload?.kind);
    for (const node of collectXLoraNodes()) {
        const panel = node?.__xlora_panel;
        const rows = Array.isArray(panel?.state?.rows) ? panel.state.rows : [];
        if (!rows.length) {
            continue;
        }
        let changed = false;
        const nextRows = rows.map((row) => {
            if (String(row?.lora_ref || "") !== ref) {
                return row;
            }
            changed = true;
            return {
                ...row,
                thumb_url: thumbUrl,
                cover_kind: coverKind,
                cover_url: coverUrl,
            };
        });
        if (!changed) {
            continue;
        }
        panel.state.rows = nextRows;
        // 存回 widget：不然刷新页面后地址又变回旧的（旧地址会被浏览器缓存）
        writeStoredRows(node, nextRows);
        renderNodeRows(node);
    }
}

/**
 * 把封面信息写到行上；服务端说没有封面时清空，避免留着旧地址。
 */
function applyRowCover(row, kind, thumbUrl, coverUrl) {
    if (!row) {
        return;
    }
    const nextKind = normalizeCoverKind(kind);
    if (!nextKind) {
        row.cover_kind = "";
        row.cover_url = "";
        row.thumb_url = "";
        return;
    }
    row.cover_kind = nextKind;
    row.cover_url = String(coverUrl || "");
    row.thumb_url = String(thumbUrl || "");
}

function syncRowTriggerWords(node, row, options = {}) {
    if (!node || !row || !row.lora_ref) {
        return;
    }
    const force = options.force === true;
    const state = node.__xlora_panel?.state;
    if (row.trigger_words_loading) {
        return;
    }
    if (!force && row.trigger_words_synced === true) {
        return;
    }
    if (
        state
        && state.expandedTriggerRowId != null
        && String(state.expandedTriggerRowId) === String(row.id)
    ) {
        setExpandedTriggerPanel(node, state, null);
    }
    row.trigger_words_loading = true;
    row.trigger_words_error = "";
    renderNodeRows(node);
    void fetchLoraTriggerWords(row.lora_ref)
        .then((payload) => {
            const words = normalizeTriggerWords(payload?.trigger_words || []);
            row.trigger_words = mergeTriggerWords(row.trigger_words, words);
            row.lora_note = String(payload?.lora_note || "").trim();
            // 封面以服务端为准：目录里换了封面、或从别处拖进来的行，
            // 都能在这里补齐（视频封面需要 kind 才能画第一帧）。
            applyRowCover(
                row,
                payload?.cover?.kind,
                payload?.cover?.thumb_url,
                payload?.cover?.url
            );
            if (row.strength_sync_pending === true) {
                const fetchedModel = Number(payload?.strength_model);
                const fetchedClip = Number(payload?.strength_clip);
                const nextModel = Number.isFinite(fetchedModel)
                    ? fetchedModel
                    : row.strength_model;
                const nextClip = Number.isFinite(fetchedClip)
                    ? fetchedClip
                    : nextModel;
                row.strength_model = nextModel;
                row.strength_clip = nextClip;
                row.separate_clip_strength = nextClip !== nextModel;
                if (row.separate_clip_strength && state) {
                    state.globalSeparateClip = true;
                }
                row.strength_sync_pending = false;
            }
            row.trigger_words_synced = true;
            row.trigger_words_error = "";
        })
        .catch(() => {
            row.strength_sync_pending = false;
            row.trigger_words_synced = true;
            row.trigger_words_error = "load_failed";
        })
        .finally(() => {
            row.trigger_words_loading = false;
            writeStoredRows(node, node.__xlora_panel?.state?.rows || []);
            renderNodeRows(node);
        });
}

function syncAllRowTriggerWords(node, options = {}) {
    const rows = node?.__xlora_panel?.state?.rows || [];
    for (const row of rows) {
        syncRowTriggerWords(node, row, options);
    }
}

function buildPanel(node) {
    ensureStyles();
    const panel = document.createElement("div");
    panel.className = "xlora-panel";
    const meta = document.createElement("div");
    meta.className = "xlora-meta";
    // 列表卡片外面的一行：左撤销重做、右 Clip 开关（和 XMediaListGet 一致）
    const toolbar = element("div", "xlora-toolbar");
    const toolbarLeft = element("div", "xlora-toolbar-left");
    // Clip 开关：开关本体 + 文字。文字不能省——只有一个开关看不出它干什么
    const globalToggle = document.createElement("label");
    globalToggle.className = "xlora-clip-toggle";
    const globalToggleInput = document.createElement("input");
    globalToggleInput.type = "checkbox";
    globalToggleInput.className = "xlora-switch-input";
    const globalToggleTrack = document.createElement("span");
    globalToggleTrack.className = "xlora-switch-track";
    globalToggleTrack.setAttribute("aria-hidden", "true");
    const globalToggleText = element(
        "span",
        "xlora-clip-toggle-text",
        t("xdatahub.ui.node.xloraget.clip_toggle", "Separate Clip Strength")
    );
    globalToggle.appendChild(globalToggleInput);
    globalToggle.appendChild(globalToggleTrack);
    globalToggle.appendChild(globalToggleText);

    const badge = document.createElement("div");
    badge.className = "xlora-node-badge";
    const badgeChip = document.createElement("span");
    badgeChip.className = "xlora-node-badge-chip";
    badgeChip.textContent = "--";
    const badgeSwatch = document.createElement("span");
    badgeSwatch.className = "xlora-node-badge-swatch";
    badge.appendChild(badgeChip);
    badge.appendChild(badgeSwatch);

    const kindEmoji = document.createElement("span");
    kindEmoji.className = "xlora-kind-emoji";
    kindEmoji.classList.add("xlora-kind-emoji-push");
    kindEmoji.setAttribute("aria-hidden", "true");
    kindEmoji.textContent = "🧬";

    meta.appendChild(badge);
    meta.appendChild(kindEmoji);

    // 撤销 / 重做：待在列表卡片外面那一行，管的是整个列表的改动
    const undoButton = element("button", "xlora-tbtn", "↶");
    undoButton.type = "button";
    undoButton.disabled = true;
    engine.bindHint(undoButton, () => t(
        "xdatahub.ui.node.xloraget.undo_tooltip",
        "Undo the last step"
    ));
    const redoButton = element("button", "xlora-tbtn", "↷");
    redoButton.type = "button";
    redoButton.disabled = true;
    engine.bindHint(redoButton, () => t(
        "xdatahub.ui.node.xloraget.redo_tooltip",
        "Redo the step just undone"
    ));
    toolbarLeft.appendChild(undoButton);
    toolbarLeft.appendChild(redoButton);
    toolbar.appendChild(toolbarLeft);
    toolbar.appendChild(globalToggle);

    // 列表工具栏：刷新 │ 建组 │ ✔ ✖ ⇄ → 范围胶囊（组号长在里面）。
    // 会「变宽」的只有范围胶囊（选出某一组时冒出组号），所以它排在
    // 所有按钮后面：真要挤，挤的也是它右边的东西。
    const listToolbar = element("div", "xlora-list-toolbar");
    // 刷新：逐个问后端这些 LoRA 文件还在不在（和 XMediaListGet 的 ↻ 同位）
    const refreshButton = element("button", "xlora-tbtn", "↻");
    refreshButton.type = "button";
    engine.bindHint(refreshButton, () => t(
        "xdatahub.ui.node.xloraget.refresh_tooltip",
        "Check again whether these LoRA files still exist on disk."
    ));
    // 建组用文字不用图标：图标（＋）和 ✔ ✖ ⇄ 挤在一起分不清谁是谁
    const groupButton = element(
        "button",
        "xlora-tbtn xlora-group-btn",
        t("xdatahub.ui.node.xloraget.new_group", "Create group")
    );
    groupButton.type = "button";
    engine.bindHint(groupButton, () => t(
        "xdatahub.ui.node.xloraget.new_group_tooltip",
        "Create a group from the selected LoRAs that aren't in one yet."
    ));
    const enableAllButton = element("button", "xlora-tbtn", "✔");
    enableAllButton.type = "button";
    engine.bindHint(enableAllButton, () => t(
        "xdatahub.ui.node.xloraget.enable_all_tooltip",
        "Turn on every LoRA in scope"
    ));
    const disableAllButton = element("button", "xlora-tbtn", "✖");
    disableAllButton.type = "button";
    engine.bindHint(disableAllButton, () => t(
        "xdatahub.ui.node.xloraget.disable_all_tooltip",
        "Turn off every LoRA in scope"
    ));
    const invertButton = element("button", "xlora-tbtn", "⇄");
    invertButton.type = "button";
    engine.bindHint(invertButton, () => t(
        "xdatahub.ui.node.xloraget.invert_tooltip",
        "Flip every switch in scope"
    ));
    const {
        scopeControl,
        scopeChip,
        scopeChipText,
        scopeButtons,
    } = engine.buildScopeControl(node);
    listToolbar.appendChild(refreshButton);
    listToolbar.appendChild(element("span", "xlora-tb-divider"));
    listToolbar.appendChild(groupButton);
    listToolbar.appendChild(element("span", "xlora-tb-divider"));
    listToolbar.appendChild(enableAllButton);
    listToolbar.appendChild(disableAllButton);
    listToolbar.appendChild(invertButton);
    listToolbar.appendChild(scopeControl);

    const list = document.createElement("div");
    list.className = "xlora-list";
    // 插入线/标签放在列表内部：它们要跟着列表一起滚动，否则列表滚
    // 下去以后指示线会停在面板上，指不到真正的位置。
    const insertLine = document.createElement("div");
    insertLine.className = "xlora-insert-line";
    const dropLabel = document.createElement("div");
    dropLabel.className = "xlora-drop-label";
    list.appendChild(insertLine);
    list.appendChild(dropLabel);
    const empty = document.createElement("div");
    empty.className = "xlora-empty";
    empty.textContent = t("xdatahub.ui.node.xloraget.empty", "Drag Lora cards from XDataHub here");
    const toast = document.createElement("div");
    toast.className = "xlora-toast";
    // 底栏：一共几条 LoRA、开了几条（和 XMediaListGet 的底栏一样）
    const footer = element("div", "xlora-footer");
    const footerInfo = element("div", "xlora-footer-info");
    const total = element("span", "xlora-total", "");
    const footerDivider = element("span", "xlora-footer-divider");
    const status = element("span", "xlora-status", "");
    footerInfo.appendChild(total);
    footerInfo.appendChild(footerDivider);
    footerInfo.appendChild(status);
    footer.appendChild(footerInfo);
    // 右下角的清除：把这一整套 LoRA 清空（和 XMediaListGet 的底栏一致）
    const clearButton = element("button", "xlora-tbtn xlora-clear", "🗑️");
    clearButton.type = "button";
    footer.appendChild(clearButton);
    // 工具栏 + 列表 + 底栏合成一张卡片：顶盖是按钮条，中间滚动，
    // 底栏报数。
    const listShell = element("div", "xlora-list-shell");
    listShell.appendChild(listToolbar);
    listShell.appendChild(list);
    // 提示条浮在列表上方，所以跟着列表待在卡片里（卡片是它的定位父级），
    // 不会跑道卡片外面的描述文字上。
    listShell.appendChild(toast);
    listShell.appendChild(footer);
    panel.appendChild(meta);
    panel.appendChild(toolbar);
    panel.appendChild(listShell);
    const tooltip = document.createElement("div");
    tooltip.className = "xlora-tooltip";
    tooltip.innerHTML = `
        <div class="xlora-tooltip-media">
            <img alt="thumb" style="display:none;">
            <video
                muted
                loop
                autoplay
                playsinline
                preload="metadata"
                style="display:none;"
            ></video>
        </div>
        <div class="xlora-tooltip-name"></div>
        <div class="xlora-tooltip-divider"></div>
        <div class="xlora-tooltip-note"></div>
    `;
    document.body.appendChild(tooltip);
    bindTooltip(badge, tooltip, () => badge.dataset.tooltipLabel || "");
    return {
        panel,
        toolbar,
        listToolbar,
        footer,
        total,
        status,
        clearButton,
        refreshButton,
        groupButton,
        enableAllButton,
        disableAllButton,
        invertButton,
        undoButton,
        redoButton,
        scopeControl,
        scopeChip,
        scopeChipText,
        scopeButtons,
        // 引擎按名字找的几样东西：LoRA 列表没有遮罩层，留空即可
        overlay: null,
        globalToggleInput,
        list,
        empty,
        insertLine,
        dropLabel,
        toast,
        tooltip,
        badge,
        badgeChip,
        globalToggle,
        globalToggleText,
    };
}

function formatNodeSerial(nodeId) {
    const s = String(nodeId ?? "").trim();
    if (!s) {
        return "--";
    }
    return s;
}

function applyNodeBadge(node) {
    const panel = node?.__xlora_panel;
    if (!panel) {
        return;
    }
    const scopedId = getScopedNodeId(node);
    if (!scopedId) {
        return;
    }
    const serial = formatNodeSerial(scopedId);
    const accentColor = getNodeAccentColor(scopedId);
    panel.panel.style.setProperty("--xlora-accent", accentColor);
    if (panel.badgeChip) {
        panel.badgeChip.textContent = serial;
    }
    if (panel.badge) {
        panel.badge.dataset.tooltipLabel = `${TARGET_NODE_CLASS} #${serial}`;
    }
    node.__xlora_badge_node_id = scopedId;
}

function scheduleBadgeSync(node) {
    if (!node || !node.__xlora_panel) {
        return;
    }
    if (getScopedNodeId(node)) {
        applyNodeBadge(node);
        return;
    }
    if (node.__xlora_badge_retry_timer) {
        return;
    }
    node.__xlora_badge_retry_timer = window.setTimeout(() => {
        node.__xlora_badge_retry_timer = 0;
        applyNodeBadge(node);
        if (!getScopedNodeId(node)) {
            scheduleBadgeSync(node);
        }
    }, 80);
}

function refreshNodeBadge(node) {
    if (!node || !node.__xlora_panel) {
        return;
    }
    const scopedId = getScopedNodeId(node);
    if (!scopedId) {
        scheduleBadgeSync(node);
        return;
    }
    if (node.__xlora_badge_node_id !== scopedId) {
        applyNodeBadge(node);
    }
}

function upsertLoraRowFromMediaRef(
    node,
    mediaRef,
    title = "",
    thumbUrl = "",
    strengthModel = undefined,
    strengthClip = undefined,
    loraNote = "",
    options = {}
) {
    const loraRef = String(mediaRef || "").trim();
    if (!loraRef) {
        throw new Error("Missing media reference");
    }
    installNodeUi(node);
    const panel = node.__xlora_panel;
    const rows = readStoredRows(node);
    const existing = rows.find((item) => item.lora_ref === loraRef);
    const normalizedThumb = String(thumbUrl || "").trim();
    const incomingCoverKind = normalizeCoverKind(
        options.coverKind || options.cover_kind
    );
    const incomingCoverUrl = String(
        options.coverUrl || options.cover_url || ""
    ).trim();
    const hasExplicitStrengthModel = Number.isFinite(Number(strengthModel));
    const hasExplicitStrengthClip = Number.isFinite(Number(strengthClip));
    const strengthSyncPending = options.syncStrengthFromRemote === true
        || (!hasExplicitStrengthModel && !hasExplicitStrengthClip);
    const normalizedModelStrength = toFloat(strengthModel, 1);
    const normalizedClipStrength = toFloat(
        strengthClip,
        normalizedModelStrength
    );
    const normalizedLoraNote = String(loraNote || "").trim();
    const separateClipStrength = normalizedClipStrength !== normalizedModelStrength;
    if (separateClipStrength && panel?.state) {
        panel.state.globalSeparateClip = true;
    }
    if (existing) {
        existing.active = true;
        if (title) {
            existing.title = String(title);
        }
        if (normalizedThumb) {
            existing.thumb_url = normalizedThumb;
        }
        if (incomingCoverKind) {
            existing.cover_kind = incomingCoverKind;
            existing.cover_url = incomingCoverUrl;
        }
        existing.strength_model = normalizedModelStrength;
        existing.strength_clip = normalizedClipStrength;
        existing.separate_clip_strength = separateClipStrength;
        existing.lora_note = normalizedLoraNote;
        existing.strength_sync_pending = strengthSyncPending;
    } else {
        rows.push(
            makeRow({
                lora_ref: loraRef,
                title: String(title || "lora"),
                active: true,
                separate_clip_strength: separateClipStrength,
                strength_model: normalizedModelStrength,
                strength_clip: normalizedClipStrength,
                strength_sync_pending: strengthSyncPending,
                lora_note: normalizedLoraNote,
                thumb_url: normalizedThumb,
                cover_kind: incomingCoverKind,
                cover_url: incomingCoverUrl,
                pin: "none",
            })
        );
    }
    const nextRows = enforcePinLayout(rows);
    if (panel?.state) {
        panel.state.rows = nextRows;
    }
    writeStoredRows(node, nextRows);
    renderNodeRows(node);
    const nextRow = nextRows.find((item) => item.lora_ref === loraRef);
    if (nextRow) {
        syncRowTriggerWords(node, nextRow, { force: true });
    }
    refreshNodeBadge(node);
}

function refreshRowsByLoraRef(loraRef) {
    const target = String(loraRef || "").trim();
    if (!target) {
        return;
    }
    const nodes = (app.graph?._nodes || []).filter(
        (node) => String(node?.comfyClass || "") === TARGET_NODE_CLASS
    );
    for (const node of nodes) {
        installNodeUi(node);
        const panel = node.__xlora_panel;
        if (!panel?.state) {
            continue;
        }
        const rows = Array.isArray(panel.state.rows)
            ? panel.state.rows
            : [];
        let matched = false;
        for (const row of rows) {
            if (String(row?.lora_ref || "").trim() !== target) {
                continue;
            }
            matched = true;
            syncRowTriggerWords(node, row, { force: true });
        }
        if (matched) {
            renderNodeRows(node);
        }
    }
}

function getXLoraNodeMinSize() {
    return [DEFAULT_MIN_NODE_WIDTH, DEFAULT_MIN_NODE_HEIGHT];
}

function ensureXLoraNodeMinSize(node) {
    if (!node) {
        return;
    }
    const [minWidth, minHeight] = getXLoraNodeMinSize();
    if (!node.min_size || node.min_size.length < 2) {
        node.min_size = [minWidth, minHeight];
    } else {
        node.min_size[0] = Math.max(node.min_size[0], minWidth);
        node.min_size[1] = Math.max(node.min_size[1], minHeight);
    }
    if (typeof node.setSize === "function") {
        const width = Math.max(node.size?.[0] ?? 0, minWidth);
        const height = Math.max(node.size?.[1] ?? 0, minHeight);
        node.setSize([width, height]);
    } else if (!node.size || node.size.length < 2) {
        node.size = [minWidth, minHeight];
    } else {
        node.size[0] = Math.max(node.size[0], minWidth);
        node.size[1] = Math.max(node.size[1], minHeight);
    }
    if (node.__xlora_resize_guard) {
        return;
    }
    node.__xlora_resize_guard = true;
    const origOnResize = node.onResize;
    node.onResize = function (size) {
        const [resizeMinWidth, resizeMinHeight] = getXLoraNodeMinSize();
        const sourceSize = Array.isArray(size) ? size : this.size;
        const nextWidth = Math.max(sourceSize?.[0] ?? 0, resizeMinWidth);
        const nextHeight = Math.max(sourceSize?.[1] ?? 0, resizeMinHeight);
        if (!Array.isArray(this.size) || this.size.length < 2) {
            this.size = [nextWidth, nextHeight];
        } else {
            this.size[0] = nextWidth;
            this.size[1] = nextHeight;
        }
        this.setDirtyCanvas?.(true, true);
        if (typeof origOnResize === "function") {
            origOnResize.apply(this, arguments);
        }
    };
}

/**
 * 节点被删掉时收尾：tooltip 挂在 body 上，不主动摘掉会一直留着
 * （里面的图片/视频也一起赖着）。
 */
function disposeNodeUi(node) {
    stopDropAutoScroll(node?.__xlora_panel?.state);
    engine.closeGroupDialog(node);
    const panel = node?.__xlora_panel;
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
    if (panel.toastTimer) {
        clearTimeout(panel.toastTimer);
        panel.toastTimer = 0;
    }
    hideTooltip(panel.tooltip);
    panel.tooltip?.remove();
    panel.tooltip = null;
    delete node.__xlora_panel;
}

/**
 * 工作流读进来之后，把面板数据整个换成存盘里的内容。
 *
 * 行和组必须**一起**重读：只换行的话，行上挂的组号在组记录里找不到
 * 对应的组，纯数据层会把它当成「没有这个组」，于是组凭空消失。
 */
function reloadPanelFromStorage(node) {
    const panel = node?.__xlora_panel;
    if (!panel) {
        return;
    }
    panel.state.rows = readStoredRows(node);
    panel.state.groups = readStoredGroups(node);
    panel.state.globalSeparateClip = readGlobalClipMode(
        node,
        panel.state.rows
    );
    // 换了一批行，旧的选中、范围收窄、撤销记录都对不上了
    panel.state.selection = new Set();
    panel.state.scopeGroup = null;
    panel.state.scopeGroupBack = null;
    /* 档位跟着工作流走，但面板是「建节点那一刻」装的，那时 properties
       还是空的。configure / loadedGraphNode 会把 properties 恢复好再叫
       这里，所以必须在这重读一次。 */
    panel.state.enableScope = readEnableScope(node);
    panel.state.undoStack = [];
    panel.state.redoStack = [];
    // 丢失标记也是上一批文件的事，等用户再点一次刷新
    panel.state.missing = new Set();
    renderNodeRows(node);
    // 档位按钮的高亮要跟着重读出来的档位走
    engine.refreshScopeOnly(node);
    syncAllRowTriggerWords(node, { force: true });
}

function installNodeUi(node) {
    if (!node || String(node.comfyClass || "") !== TARGET_NODE_CLASS) {
        return;
    }
    if (node.__xlora_panel) {
        ensureStorageWidget(node);
        ensureXLoraNodeMinSize(node);
        // 拖拽建节点时种子在面板装好之后才赋到节点上，这里补消费。
        consumePendingRows(node);
        return;
    }
    ensureStorageWidget(node);
    const ui = buildPanel(node);
    const initialRows = readStoredRows(node);
    const state = {
        rows: initialRows,
        // 组记录（组名 / 颜色 / 折叠状态 / 序号）
        groups: readStoredGroups(node),
        // 分组引擎按「分类」组织数据，LoRA 只有一类（见 LORA_CATEGORY）
        category: LORA_CATEGORY,
        items: emptyLoraItems(),
        // 选中的行（按行 id 记）：建组、批量开关都靠它
        selection: new Set(),
        // 点过「刷新」后查出来已经不在硬盘上的文件（按 lora_ref 记）
        missing: new Set(),
        // ✔ ✖ ⇄ 打哪些行：all / files（未分组）/ groups（已分组）。
        // 跟着工作流走：上次选的档位存在 node.properties 里（不塞进
        // lora_stack，那个 JSON 是 Python 侧的，多字段要多一套迁移）。
        enableScope: readEnableScope(node),
        // 单击组头 = 临时只作用于那一组；scopeGroupBack 记住收窄前的档位
        scopeGroup: null,
        scopeGroupBack: null,
        globalSeparateClip: readGlobalClipMode(node, initialRows),
        dragIndex: -1,
        dragTargetEl: null,
        lastExternalDropKey: "",
        lastExternalDropAt: 0,
        expandedTriggerRowId: null,
        triggerSearchQuery: "",
    };
    node.__xlora_panel = { ...ui, state };
    // 引擎要的数据形状先备好（渲染前每次都会重算，见 loraItemsFromState）
    loraItemsFromState(state);
    if (typeof node.addDOMWidget === "function") {
        node.addDOMWidget("xlora_panel", "custom", ui.panel, {
            serialize: false,
        });
    }

    // 转发滚轮到 ComfyUI 主画布（避开表单控件和可滚动区域内的原生滚轮）
    // 工具栏：建组 / 批量开关 / 撤销重做（范围胶囊的接线在引擎里）
    ui.groupButton.addEventListener("click", () => {
        engine.createGroupFromCurrentSelection(node);
    });
    ui.enableAllButton.addEventListener("click", () => {
        engine.setAllEnabled(node, true);
    });
    ui.disableAllButton.addEventListener("click", () => {
        engine.setAllEnabled(node, false);
    });
    ui.invertButton.addEventListener("click", () => {
        engine.invertEnabled(node);
    });
    ui.undoButton.addEventListener("click", () => {
        engine.undoLastChange(node);
    });
    ui.redoButton.addEventListener("click", () => {
        engine.redoLastChange(node);
    });
    ui.clearButton.addEventListener("click", () => {
        clearLoraRows(node);
    });
    engine.bindHint(ui.clearButton, () => t(
        "xdatahub.ui.node.xloraget.clear_tooltip",
        "Remove every LoRA in this list."
    ));
    // Clip 开关有文字，这里补一句更细的解释（Clip 没连线时开了也没用）
    engine.bindHint(ui.globalToggle, () => t(
        "xdatahub.ui.node.xloraget.clip_tooltip",
        "Give Clip its own strength value. Nothing happens when nothing is connected to the Clip input."
    ));
    ui.refreshButton.addEventListener("click", () => {
        void refreshLoraMissing(node);
    });

    ui.panel.addEventListener("wheel", function (e) {
        var tag = (e.target.tagName || "").toUpperCase();
        if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") {
            return;
        }
        for (var el = e.target; el && el !== ui.panel; el = el.parentElement) {
            if (el.scrollHeight > el.clientHeight || el.scrollWidth > el.clientWidth) {
                var st = getComputedStyle(el);
                if (st.overflow.indexOf("auto") >= 0 || st.overflow.indexOf("scroll") >= 0 ||
                    st.overflowY.indexOf("auto") >= 0 || st.overflowY.indexOf("scroll") >= 0) {
                    return;
                }
            }
        }
        var gc = app.canvas && app.canvas.canvas;
        if (gc) {
            gc.dispatchEvent(new WheelEvent("wheel", {
                deltaX: e.deltaX, deltaY: e.deltaY, deltaZ: e.deltaZ,
                clientX: e.clientX, clientY: e.clientY,
                screenX: e.screenX, screenY: e.screenY,
                ctrlKey: e.ctrlKey, altKey: e.altKey,
                shiftKey: e.shiftKey, metaKey: e.metaKey,
                bubbles: true, cancelable: true,
            }));
        }
    });

    // 中键拖拽平移画布 — 通过 LiteGraph Canvas API 直接转发真实事件
    (function(panel) {
        panel.addEventListener("pointerdown", function(e) {
            if (e.button !== 1) return;
            e.preventDefault();
            var cvs = app.canvas;
            if (!cvs || typeof cvs.processMouseDown !== "function") return;
            cvs.processMouseDown(e);
        });
        panel.addEventListener("pointermove", function(e) {
            if ((e.buttons & 4) !== 4) return;
            var cvs = app.canvas;
            if (!cvs || typeof cvs.processMouseMove !== "function") return;
            cvs.processMouseMove(e);
        });
        panel.addEventListener("pointerup", function(e) {
            if (e.button !== 1) return;
            var cvs = app.canvas;
            if (!cvs || typeof cvs.processMouseUp !== "function") return;
            cvs.processMouseUp(e);
        });
    })(ui.panel);

    ensureXLoraNodeMinSize(node);
    ui.globalToggleInput.checked = !!state.globalSeparateClip;
    ui.globalToggleInput.addEventListener("change", () => {
        state.globalSeparateClip = !!ui.globalToggleInput.checked;
        writeGlobalClipMode(node, state.globalSeparateClip);
        writeStoredRows(node, state.rows);
        renderNodeRows(node);
    });
    bindDnD(node);
    renderNodeRows(node);
    syncAllRowTriggerWords(node, { force: true });
    refreshNodeBadge(node);
    // 若种子在面板之前就到了（异常时序），这里也会补上。
    consumePendingRows(node);
}

function clearDragTarget(state) {
    if (state.dragTargetEl instanceof HTMLElement) {
        state.dragTargetEl.classList.remove("drag-target");
    }
    state.dragTargetEl = null;
}

// Lucide 的 arrow-up-to-line / arrow-down-to-line：一条箭头加一条横线，
// 一看就是「钉到最上 / 钉到最下」。
const PIN_ICON_PATHS = {
    head: ["M5 3h14", "m18 13-6-6-6 6", "M12 7v14"],
    tail: ["M5 21h14", "m6 11 6 6 6-6", "M12 3v14"],
};

/**
 * 置顶/置底图标。用内联 SVG 而不是字符，缩放到任意大小都清晰。
 */
function buildPinIcon(direction) {
    const SVG_NS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    // 尺寸要给偶数：按钮 22px、去掉左右各 1px 边框后是 20px，
    // 20-14=6，每边正好 3px。用 15px 的话每边 2.5px，落屏时被四舍五入
    // 成一边 3 一边 2，图标看着就往右下偏了半个像素。
    svg.setAttribute("width", "14");
    svg.setAttribute("height", "14");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "2.4");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    svg.classList.add("xlora-pin-icon");
    for (const d of PIN_ICON_PATHS[direction] || []) {
        const path = document.createElementNS(SVG_NS, "path");
        path.setAttribute("d", d);
        svg.appendChild(path);
    }
    return svg;
}

function canDragRow(rows, index) {
    const item = rows[index];
    if (!item) {
        return false;
    }
    if (item.pin === "head" && index === 0) {
        return false;
    }
    if (item.pin === "tail" && index === rows.length - 1) {
        return false;
    }
    return true;
}

function moveRowWithLocks(rows, sourceIndex, targetIndex) {
    if (
        sourceIndex < 0
        || sourceIndex >= rows.length
        || targetIndex < 0
        || targetIndex > rows.length
    ) {
        return rows;
    }
    if (!canDragRow(rows, sourceIndex)) {
        return rows;
    }
    const list = rows.slice();
    const [moved] = list.splice(sourceIndex, 1);
    const headLocked = list.some((item) => item.pin === "head");
    const tailLocked = list.some((item) => item.pin === "tail");
    const minIndex = headLocked ? 1 : 0;
    const maxIndex = tailLocked ? list.length - 1 : list.length;
    const insertIndex = clamp(targetIndex, minIndex, maxIndex);
    list.splice(insertIndex, 0, moved);
    return enforcePinLayout(list);
}

function setExpandedTriggerPanel(node, state, nextExpandedRowId) {
    const previousExpanded = state.expandedTriggerRowId != null;
    const nextId = nextExpandedRowId == null ? null : nextExpandedRowId;
    const nextExpanded = nextId != null;
    state.expandedTriggerRowId = nextId;
    if (!nextExpanded) {
        state.triggerSearchQuery = "";
    }
    if (previousExpanded === nextExpanded) {
        return;
    }
    if (!AUTO_RESIZE_TRIGGER_PANEL) {
        if (!nextExpanded) {
            state.triggerPanelBaseHeight = null;
        }
        return;
    }
    if (typeof node?.setSize !== "function") {
        return;
    }
    const width = Math.max(
        Number(node.size?.[0]) || 0,
        DEFAULT_MIN_NODE_WIDTH
    );
    const currentHeight = Math.max(
        Number(node.size?.[1]) || 0,
        DEFAULT_MIN_NODE_HEIGHT
    );
    if (nextExpanded && !previousExpanded) {
        state.triggerPanelBaseHeight = currentHeight;
    }
    const baseHeight = Math.max(
        Number(state.triggerPanelBaseHeight) || DEFAULT_MIN_NODE_HEIGHT,
        DEFAULT_MIN_NODE_HEIGHT
    );
    const nextHeight = nextExpanded
        ? Math.max(currentHeight, baseHeight) + TRIGGER_PANEL_HEIGHT_DELTA
        : Math.max(
            DEFAULT_MIN_NODE_HEIGHT,
            Math.min(baseHeight, currentHeight - TRIGGER_PANEL_HEIGHT_DELTA)
        );
    if (!nextExpanded) {
        state.triggerPanelBaseHeight = null;
    }
    const prevX = Number(node.pos?.[0]);
    const prevY = Number(node.pos?.[1]);
    node.setSize([width, nextHeight]);
    if (Number.isFinite(prevX) && Number.isFinite(prevY)) {
        if (!Array.isArray(node.pos) || node.pos.length < 2) {
            node.pos = [prevX, prevY];
        } else {
            node.pos[0] = prevX;
            node.pos[1] = prevY;
        }
    }
}

/**
 * 这一行会不会真的被加载？
 *
 * 后端是按这个顺序筛的：`active` 为假直接跳过；`strength_model` 和
 * `strength_clip` 都是 0 也跳过（等于没加载）。序列号只数会加载的行，
 * 否则「第 3 个加载的 LoRA」就要靠用户自己心算。
 */
function rowWillLoad(item, clipConnected = true) {
    if (!item || item.active === false) {
        return false;
    }
    const model = Number(item.strength_model);
    // 后端在 CLIP 没接的时候会把这段强度按 0 算，这里跟着一起看，
    // 否则「M=0 + 只留 C」的行会被误算成会加载。
    const clip = clipConnected ? Number(item.strength_clip) : 0;
    return !(model === 0 && clip === 0);
}

/** CLIP 输入有没有接线；拿不到连线信息时按「已接」处理。 */
function isClipConnected(node) {
    const inputs = node?.inputs;
    if (!Array.isArray(inputs)) {
        return true;
    }
    const clipInput = inputs.find(
        (input) => String(input?.name || "") === "clip"
    );
    if (!clipInput) {
        return true;
    }
    return clipInput.link != null;
}

/** 重新排版加载序号（接线变化时用）。 */
function refreshLoadSequence(node) {
    const panel = node?.__xlora_panel;
    if (panel?.state?.rows?.length) {
        renderNodeRows(node);
    }
}

/**
 * 按屏幕上的顺序重写左侧的加载序号。
 *
 * 拖动时列表是「就地搬位置」，不走整表重画（否则拖动会跳），所以序号
 * 得单独补一遍。序号只数「会真的加载」的行：关掉的行、以及强度全是 0
 * 的行都不占号（后者在 CLIP 没接线时还要按 0 算）。
 */
function refreshLoraRowNumbers(node) {
    const panel = node?.__xlora_panel;
    const list = panel?.list;
    if (!list) {
        return;
    }
    // 拖动期间引擎把新顺序写在 state.items 上（state.rows 要等松手
    // 落地时才同步），所以这里必须读 items，否则序号按旧顺序数。
    const rows = panel.state.items?.[LORA_CATEGORY] || panel.state.rows || [];
    const clipConnected = isClipConnected(node);
    // 先按数据把号算好：折叠起来的组虽然不在屏幕上，里面的行照样会
    // 加载、照样占号——屏幕上直接数会把这些号跳过去，后面的号就全错了。
    const textByIndex = new Map();
    let seq = 0;
    rows.forEach((row, index) => {
        const willLoad = rowWillLoad(row, clipConnected);
        if (willLoad) {
            seq += 1;
        }
        textByIndex.set(index, willLoad ? String(seq) : "–");
    });
    for (const el of list.querySelectorAll(".xlora-row")) {
        const text = textByIndex.get(Number(el.dataset.index));
        const seqEl = el.querySelector(".xlora-seq");
        if (text === undefined || !seqEl || seqEl.textContent === text) {
            continue;
        }
        seqEl.textContent = text;
    }
    // 头尾可能换了人：钉子不能留在旧的那一行上
    syncRowPinButtons(node);
}

/** 底栏报数：一共几条、开了几条（名额上限是全局的，两个列表一样）。 */
/**
 * 清空整个 LoRA 列表（底栏右下角的 🗑️）。
 *
 * 会先问一句：这是不可撤销的大动作——虽然撤销能救回来，但一不小心点中
 * 的代价是整条 LoRA 栈没了，还是让用户确认一下。
 */
function clearLoraRows(node) {
    const panel = node?.__xlora_panel;
    const state = panel?.state;
    if (!state) {
        return;
    }
    const rows = state.items?.[LORA_CATEGORY] || [];
    if (!rows.length) {
        return;
    }
    const message = t(
        "xdatahub.ui.node.xloraget.clear_confirm",
        "Remove all {count} LoRAs from this list?",
        { count: rows.length }
    );
    if (!window.confirm(message)) {
        return;
    }
    // 清空 = 行全部拿走，组自然也没成员了（纯数据层会把空组一起清掉）
    writeLoraItems(node, emptyLoraItems());
    renderNodeRows(node);
}

function updateListFooter(panel, rows) {
    if (!panel?.total || !panel?.status) {
        return;
    }
    const list = Array.isArray(rows) ? rows : [];
    const enabled = list.filter((row) => row?.active !== false).length;
    panel.total.textContent = t(
        "xdatahub.ui.group.total_items",
        "{count} {noun}",
        {
            count: list.length,
            noun: t("xdatahub.ui.group.noun_loras", "LoRAs"),
        }
    );
    panel.status.textContent = t(
        "xdatahub.ui.group.enabled_count",
        "Enabled {count} / {limit}",
        { count: enabled, limit: MAX_ENABLED }
    );
    // 「创建分组」只有在选中了还没分组的行时才点得动。不用真 disabled：
    // 真 disabled 的按钮收不到悬停事件，用户看不到为什么点不动。
    if (panel.groupButton) {
        const state = panel.state || {};
        const groupable = engine.ungroupedSelection(state, LORA_CATEGORY);
        panel.groupButton.textContent = t(
            "xdatahub.ui.node.xloraget.new_group",
            "Create group"
        );
        panel.groupButton.classList.toggle("is-disabled", groupable < 1);
        panel.groupButton.setAttribute(
            "aria-disabled",
            groupable < 1 ? "true" : "false"
        );
    }
}

function renderNodeRows(node) {
    const panel = node.__xlora_panel;
    if (!panel) {
        return;
    }
    const { list, empty, state, tooltip } = panel;
    const prevScrollTop = list.scrollTop;
    const prevScrollLeft = list.scrollLeft;
    clearDragTarget(state);
    hideTooltip(tooltip);
    list.innerHTML = "";
    panel.globalToggleInput.checked = !!state.globalSeparateClip;
    const rows = enforcePinLayout(state.rows);
    state.rows = rows;
    const expandedRow = rows.find(
        (rowItem) => rowItem.id === state.expandedTriggerRowId
    );
    if (state.expandedTriggerRowId != null) {
        const canKeepExpanded = !!expandedRow
            && normalizeTriggerWords(expandedRow.trigger_words).length
                > TRIGGER_WORD_INLINE_LIMIT;
        if (!canKeepExpanded) {
            setExpandedTriggerPanel(node, state, null);
        }
    }
    if (!rows.length) {
        if (state.expandedTriggerRowId != null) {
            setExpandedTriggerPanel(node, state, null);
        }
        list.appendChild(empty);
        // 行 / 组 / 竖线的索引一起清空，免得后面的就地重排拿着旧元素
        panel.rowByRef = new Map();
        panel.headByGroup = new Map();
        panel.railHosts = new Map();
        engine.refreshScopeOnly(node);
        mountDropOverlay(panel);
        updateListFooter(panel, rows);
        writeStoredRows(node, rows);
        list.scrollTop = prevScrollTop;
        list.scrollLeft = prevScrollLeft;
        return;
    }
    // 分组：先按「同组连续」整理好数据，再按组的顺序排出渲染清单
    loraItemsFromState(state);
    const rowsNow = state.rows;
    const groups = state.groups;
    const stripeByGroup = new Map(
        groups.map((group) => [group.id, engine.groupStripeColor(group)])
    );
    const loadSeq = new Array(rowsNow.length).fill(0);
    const clipConnected = isClipConnected(node);
    let loadTotal = 0;
    rowsNow.forEach((item, index) => {
        if (rowWillLoad(item, clipConnected)) {
            loadTotal += 1;
            loadSeq[index] = loadTotal;
        }
    });
    const headByGroup = new Map();
    const rowByRef = new Map();
    const entries = buildRenderList(rowsNow, groups, {
        keyOf: loraKeyOf,
        willLoad: (entry) => entry.enabled !== false,
    });
    entries.forEach((entry) => {
        // 组的头：和媒体列表同一套胶囊（序号 / 名字 / 计数 / 设置）
        if (entry.type === "group") {
            const head = engine.buildGroupHead(node, LORA_CATEGORY, entry);
            headByGroup.set(entry.groupId, head);
            list.appendChild(head);
            return;
        }
        const item = entry.row;
        const index = entry.index;
        const row = document.createElement("div");
        row.className = "xlora-row xmlg-row";
        const rowBody = document.createElement("div");
        rowBody.className = "xlora-row-body";
        const rowMain = document.createElement("div");
        rowMain.className = "xlora-row-main";
        if (!canDragRow(rowsNow, index)) {
            row.classList.add("locked");
        }
        row.setAttribute("data-index", String(index));
        row.draggable = canDragRow(rowsNow, index);
        // 属于哪一组：组色写在这一行上，序号跟着组色走
        if (item.group) {
            row.classList.add("is-grouped");
            row.dataset.group = item.group;
            row.style.setProperty(
                "--xmlg-group-stripe",
                stripeByGroup.get(item.group)
                    || engine.groupStripeColor(item.group)
            );
        }
        if (state.selection?.has(loraKeyOf(item))) {
            row.classList.add("is-selected");
        }

        // 最左侧的加载序列号：只数真正会加载的行，被禁用（或强度为 0）
        // 的行显示「–」，位置由 loadSeq 预算好。
        const seq = document.createElement("span");
        seq.className = "xlora-seq";
        const loadIndex = loadSeq[index] || 0;
        const willLoad = loadIndex > 0;
        seq.textContent = willLoad ? String(loadIndex) : "–";
        if (!willLoad) {
            seq.classList.add("is-skipped");
        }
        bindTooltip(
            seq,
            tooltip,
            t("xdatahub.ui.node.xloraget.load_order", "Load order"),
            "",
            willLoad
                ? `${loadIndex} / ${loadTotal}`
                : t(
                    item.active === false
                        ? "xdatahub.ui.node.xloraget.load_order_off"
                        : "xdatahub.ui.node.xloraget.load_order_zero",
                    item.active === false
                        ? "Not loaded: disabled"
                        : "Not loaded: strength is 0"
                )
        );
        // 序号挂在「行」上，不挂在正文里：这样它才能横跨整张卡片、
        // 数字在上下居中（和 XMediaListGet 的序号列一致）
        row.appendChild(seq);

        const pinPosition = pinPositionForIndex(index, rowsNow.length);
        if (pinPosition) {
            rowMain.appendChild(
                buildPinButton(node, item, pinPosition, tooltip)
            );
        }

        const active = document.createElement("label");
        active.className = "xlora-active";
        const activeInput = document.createElement("input");
        activeInput.type = "checkbox";
        activeInput.className = "xlora-switch-input";
        activeInput.checked = item.active !== false;
        activeInput.setAttribute(
            "aria-label",
            t("xdatahub.ui.node.xloraget.activate", "Activate this Lora")
        );
        const activeTrack = document.createElement("span");
        activeTrack.className = "xlora-switch-track";
        activeTrack.setAttribute("aria-hidden", "true");
        bindTooltip(
            active,
            tooltip,
            t("xdatahub.ui.node.xloraget.activate", "Activate this Lora")
        );
        activeInput.addEventListener("change", () => {
            item.active = !!activeInput.checked;
            writeStoredRows(node, state.rows);
            renderNodeRows(node);
        });
        active.appendChild(activeInput);
        active.appendChild(activeTrack);
        rowMain.appendChild(active);

        if (item.active === false) {
            row.classList.add("inactive");
        }
        // 刷新按钮问出来的结果：这个文件已经不在硬盘上了
        const missing = !!panel?.state?.missing?.has(
            String(item.lora_ref || "")
        );
        if (missing) {
            row.classList.add("is-missing");
        }

        const name = document.createElement("span");
        name.className = "xlora-name";
        name.textContent = item.title || item.lora_name;
        bindTooltip(
            name,
            tooltip,
            item.title || item.lora_name,
            item.thumb_url,
            missingNoteText(missing, item.lora_note || ""),
            item.cover_kind,
            item.cover_url
        );
        rowMain.appendChild(name);

        const controls = document.createElement("div");
        controls.className = "xlora-controls";
        const modelLabel = document.createElement("span");
        modelLabel.className = "xlora-label xlora-label-model";
        modelLabel.textContent = "M";
        controls.appendChild(modelLabel);

        const modelInput = document.createElement("input");
        modelInput.className = "xlora-input";
        modelInput.type = "number";
        modelInput.step = "0.01";
        modelInput.value = String(item.strength_model);
        modelInput.disabled = item.active === false;
        modelInput.addEventListener("change", () => {
            item.strength_model = toFloat(modelInput.value, 1);
            if (!item.separate_clip_strength) {
                item.strength_clip = item.strength_model;
            }
            writeStoredRows(node, state.rows);
            renderNodeRows(node);
        });
        controls.appendChild(modelInput);

        if (state.globalSeparateClip) {
            const clipLabel = document.createElement("span");
            clipLabel.className = "xlora-label xlora-label-clip";
            clipLabel.textContent = "C";
            controls.appendChild(clipLabel);

            const clipInput = document.createElement("input");
            clipInput.className = "xlora-input";
            clipInput.type = "number";
            clipInput.step = "0.01";
            clipInput.value = String(item.strength_clip);
            clipInput.disabled = item.active === false;
            clipInput.addEventListener("change", () => {
                item.strength_clip = toFloat(
                    clipInput.value,
                    item.strength_model
                );
                writeStoredRows(node, state.rows);
            });
            controls.appendChild(clipInput);
        }
        rowMain.appendChild(controls);

        const removeBtn = document.createElement("button");
        removeBtn.className = "xlora-remove";
        removeBtn.type = "button";
        bindTooltip(
            removeBtn,
            tooltip,
            t("xdatahub.ui.node.xloraget.remove", "Remove")
        );
        removeBtn.textContent = "✕";
        removeBtn.addEventListener("click", () => {
            if (state.expandedTriggerRowId === item.id) {
                setExpandedTriggerPanel(node, state, null);
            }
            // 位置会被拖动改掉，建行时记下的 index 早过期了——按元素身上
            // 现在写着的位置删，否则删掉的是「原来站在这一格」的另一个 LoRA
            const liveIndex = Number(row.dataset.index);
            const target = Number.isFinite(liveIndex) ? liveIndex : index;
            state.rows.splice(target, 1);
            state.rows = enforcePinLayout(state.rows);
            writeStoredRows(node, state.rows);
            renderNodeRows(node);
        });

        const triggerRow = document.createElement("div");
        triggerRow.className = "xlora-trigger-row";
        const toggleTriggerWord = (triggerWord) => {
            triggerWord.enabled = triggerWord.enabled === false;
            writeStoredRows(node, state.rows);
            renderNodeRows(node);
        };
        const createTriggerChip = (triggerWord) => {
            const chip = document.createElement("button");
            chip.className = "xlora-trigger-chip";
            chip.type = "button";
            if (triggerWord.enabled === false) {
                chip.classList.add("is-disabled");
            }
            chip.textContent = triggerWord.text;
            bindTooltip(chip, tooltip, triggerWord.text);
            chip.addEventListener("click", () => {
                toggleTriggerWord(triggerWord);
            });
            return chip;
        };

        const triggerMain = document.createElement("div");
        triggerMain.className = "xlora-trigger-row-main";
        const triggerRefreshBtn = document.createElement("button");
        triggerRefreshBtn.className = "xlora-trigger-refresh";
        triggerRefreshBtn.type = "button";
        triggerRefreshBtn.textContent = "↻";
        bindTooltip(
            triggerRefreshBtn,
            tooltip,
            t(
                "xdatahub.ui.node.xloraget.trigger_refresh",
                "Refresh trigger words and notes from XDataHub"
            )
        );
        triggerRefreshBtn.disabled = item.trigger_words_loading;
        triggerRefreshBtn.addEventListener("click", () => {
            const panelState = node.__xlora_panel?.state;
            if (
                panelState
                && panelState.expandedTriggerRowId != null
                && String(panelState.expandedTriggerRowId)
                    === String(item.id)
            ) {
                setExpandedTriggerPanel(node, panelState, null);
                renderNodeRows(node);
            }
            syncRowTriggerWords(node, item, { force: true });
        });
        triggerMain.appendChild(triggerRefreshBtn);

        const triggerInline = document.createElement("div");
        triggerInline.className = "xlora-trigger-inline";
        if (item.trigger_words_loading) {
            const loadingChip = document.createElement("span");
            loadingChip.className = "xlora-trigger-chip is-placeholder";
            loadingChip.textContent = t("xdatahub.ui.node.xloraget.loading", "Loading...");
            triggerInline.appendChild(loadingChip);
        } else if (item.trigger_words.length) {
            const inlineWords = item.trigger_words.slice(
                0,
                TRIGGER_WORD_INLINE_LIMIT
            );
            inlineWords.forEach((triggerWord) => {
                triggerInline.appendChild(createTriggerChip(triggerWord));
            });
            const extraCount = Math.max(
                0,
                item.trigger_words.length - TRIGGER_WORD_INLINE_LIMIT
            );
            if (extraCount > 0) {
                const moreBtn = document.createElement("button");
                moreBtn.className = "xlora-trigger-more";
                moreBtn.type = "button";
                const expanded = state.expandedTriggerRowId === item.id;
                const moreTooltip = expanded
                    ? t(
                        "xdatahub.ui.node.xloraget.collapse_title",
                        "Collapse full trigger word list"
                    )
                    : t(
                        "xdatahub.ui.node.xloraget.expand_title",
                        "Expand {count} more trigger words"
                    ).replace("{count}", String(extraCount));
                moreBtn.textContent = expanded
                    ? t("xdatahub.ui.node.xloraget.collapse", "Collapse")
                    : `+${extraCount}`;
                bindTooltip(moreBtn, tooltip, moreTooltip);
                moreBtn.addEventListener("click", () => {
                    if (state.expandedTriggerRowId === item.id) {
                        setExpandedTriggerPanel(node, state, null);
                    } else {
                        setExpandedTriggerPanel(node, state, item.id);
                        state.triggerSearchQuery = "";
                    }
                    renderNodeRows(node);
                });
                triggerMain.appendChild(moreBtn);
            }
        } else {
            const emptyChip = document.createElement("span");
            emptyChip.className = "xlora-trigger-chip is-placeholder";
            emptyChip.textContent = item.trigger_words_error
                ? t("xdatahub.ui.node.xloraget.trigger_fail", "Failed to load trigger words")
                : t("xdatahub.ui.node.xloraget.no_trigger", "No trigger words");
            triggerInline.appendChild(emptyChip);
        }

        triggerMain.appendChild(triggerInline);
        triggerRow.appendChild(triggerMain);

        if (
            state.expandedTriggerRowId === item.id
            && item.trigger_words.length > TRIGGER_WORD_INLINE_LIMIT
        ) {
            const triggerPanel = document.createElement("div");
            triggerPanel.className = "xlora-trigger-panel";

            const panelHeader = document.createElement("div");
            panelHeader.className = "xlora-trigger-panel-header";

            const searchInput = document.createElement("input");
            searchInput.className = "xlora-trigger-search";
            searchInput.type = "search";
            searchInput.placeholder = t(
                "xdatahub.ui.node.xloraget.search_trigger_words",
                "Search trigger words..."
            );
            searchInput.value = state.triggerSearchQuery || "";
            searchInput.addEventListener("input", () => {
                state.triggerSearchQuery = String(searchInput.value || "");
                const start = searchInput.selectionStart;
                const end = searchInput.selectionEnd;
                renderNodeRows(node);
                const nextInput = node.__xlora_panel?.panel?.querySelector(
                    ".xlora-trigger-search"
                );
                if (nextInput instanceof HTMLInputElement) {
                    nextInput.focus();
                    if (start != null && end != null) {
                        nextInput.setSelectionRange(start, end);
                    }
                }
            });
            panelHeader.appendChild(searchInput);

            const actions = document.createElement("div");
            actions.className = "xlora-trigger-actions";

            const enableAllBtn = document.createElement("button");
            enableAllBtn.className = "xlora-trigger-action";
            enableAllBtn.type = "button";
            enableAllBtn.textContent = t("xdatahub.ui.node.xloraget.enable_all", "Enable all");
            enableAllBtn.addEventListener("click", () => {
                item.trigger_words.forEach((triggerWord) => {
                    triggerWord.enabled = true;
                });
                writeStoredRows(node, state.rows);
                renderNodeRows(node);
            });
            actions.appendChild(enableAllBtn);

            const disableAllBtn = document.createElement("button");
            disableAllBtn.className = "xlora-trigger-action";
            disableAllBtn.type = "button";
            disableAllBtn.textContent = t("xdatahub.ui.node.xloraget.disable_all", "Disable all");
            disableAllBtn.addEventListener("click", () => {
                item.trigger_words.forEach((triggerWord) => {
                    triggerWord.enabled = false;
                });
                writeStoredRows(node, state.rows);
                renderNodeRows(node);
            });
            actions.appendChild(disableAllBtn);
            panelHeader.appendChild(actions);

            const panelList = document.createElement("div");
            panelList.className = "xlora-trigger-panel-list";

            const hasPanelScrollableRange = (el) => {
                if (!(el instanceof HTMLElement)) {
                    return false;
                }
                // Use a small tolerance to avoid sub-pixel false positives.
                const maxScroll = el.scrollHeight - el.clientHeight;
                if (maxScroll > 1) {
                    return true;
                }
                const prevTop = el.scrollTop;
                el.scrollTop = prevTop + 2;
                const moved = el.scrollTop !== prevTop;
                el.scrollTop = prevTop;
                return moved;
            };

            const syncPanelWheelIsolation = (el) => {
                if (!(el instanceof HTMLElement)) {
                    return false;
                }
                // Only rely on real scrollable range. Visible scrollbar width
                // can be always-on depending on OS/browser settings.
                const hasScrollbar = hasPanelScrollableRange(el);
                el.style.overscrollBehavior = hasScrollbar ? "contain" : "auto";
                return hasScrollbar;
            };

            panelList.addEventListener("wheel", (event) => {
                const el = event.currentTarget;
                if (!(el instanceof HTMLElement)) {
                    return;
                }
                // Strict rule: isolate only when this panel is truly scrollable.
                const hasScrollbar = syncPanelWheelIsolation(el);
                if (!hasScrollbar) {
                    return;
                }
                event.stopPropagation();
            });
            const filteredWords = filterTriggerWords(
                item.trigger_words,
                state.triggerSearchQuery
            );
            if (!filteredWords.length) {
                const emptyTips = document.createElement("div");
                emptyTips.className = "xlora-trigger-panel-empty";
                emptyTips.textContent = t("xdatahub.ui.node.xloraget.no_match", "No matching trigger words");
                panelList.appendChild(emptyTips);
            } else {
                filteredWords.forEach((triggerWord) => {
                    panelList.appendChild(createTriggerChip(triggerWord));
                });
            }

            triggerPanel.appendChild(panelHeader);
            triggerPanel.appendChild(panelList);
            triggerRow.appendChild(triggerPanel);
            // Re-evaluate after attach to get correct clientHeight.
            requestAnimationFrame(() => {
                syncPanelWheelIsolation(panelList);
            });
        }

        rowBody.appendChild(rowMain);
        rowBody.appendChild(triggerRow);
        row.appendChild(rowBody);
        // 移除按钮挂在「行」上、竖向居中：和左边的序号一左一右对称，
        // 不会看起来只贴着上面那一行。它待在自己的格子里，格子左边缘那条
        // 竖线从顶贯到底，把「这一行」和「删掉它」隔开。
        const removeCell = element("div", "xlora-remove-cell");
        removeCell.appendChild(removeBtn);
        row.appendChild(removeCell);

        // 点行本身 = 选中（开关 / 输入框 / 按钮有自己的点击行为，不抢）
        row.addEventListener("click", (event) => {
            if (
                event.target?.closest?.(
                    "button, input, label, .xlora-preview-flag"
                )
            ) {
                return;
            }
            const panelState = node.__xlora_panel?.state;
            if (
                panelState?.suppressClickUntil
                && performance.now() < panelState.suppressClickUntil
            ) {
                return;
            }
            const liveIndex = Number(row.dataset.index);
            engine.handleRowSelection(
                node,
                LORA_CATEGORY,
                loraKeyOf(item),
                Number.isFinite(liveIndex) ? liveIndex : index,
                event
            );
        });
        // 列表内排序走指针事件（浏览器自带拖放只有 10Hz 上下，一顿一顿的）
        row.addEventListener("pointerdown", (event) => {
            if (!canDragRow(state.rows, index)) {
                return;
            }
            engine.armRowPointerDrag(node, LORA_CATEGORY, row, event);
        });
        // 行里的图片/链接默认能被浏览器拖走，会把我们的拖动静悄悄掐断
        row.addEventListener("dragstart", (event) => {
            event.preventDefault();
        });

        // 引擎就地重排时要能找回这一行（不重建，缩略图不重载）
        rowByRef.set(loraKeyOf(item), row);
        list.appendChild(row);
    });
    panel.rowByRef = rowByRef;
    // 每组一根贯穿竖线：从组头顶端画到最后一行底端（折叠组只到组头）
    panel.railHosts = new Map();
    for (const [groupId, head] of headByGroup) {
        const rail = element("div", "xmlg-group-rail");
        rail.dataset.group = groupId;
        rail.style.setProperty(
            "--xmlg-group-stripe",
            stripeByGroup.get(groupId) || engine.groupStripeColor(groupId)
        );
        list.appendChild(rail);
        panel.railHosts.set(groupId, { rail, head });
    }
    panel.headByGroup = headByGroup;
    // 换了新的一批组头和行，竖线的测量缓存作废：不重置的话这次重画
    // 会「宽度没变 → 跳过测量」，竖线就停在上一次的位置甚至干脆没有。
    panel.railMeasured = false;
    engine.layoutGroupRails(panel);
    engine.ensureRailObserver(panel);
    // 组没了 / 组数变了：范围胶囊、组号标签、✔ ✖ ⇄ 的可用状态一起刷新
    engine.refreshScopeOnly(node);
    mountDropOverlay(panel);
    updateListFooter(panel, rowsNow);
    // 刚展开的那一组：成员行从 0 高度长开（和 XMediaListGet 同一套动画）。
    // 这一步还负责把「展开动画进行中」的锁放开——不做的话，展开以后
    // 折叠按钮就再也不响应了。
    if (panel.pendingExpand) {
        engine.unfoldGroupRowsIn(panel, panel.pendingExpand, list.scrollTop);
    }
    writeStoredRows(node, rowsNow);
    list.scrollTop = prevScrollTop;
    list.scrollLeft = prevScrollLeft;
}

/**
 * 引擎手里没有某一行时，让它现造一个。
 *
 * 正常渲染路径不会走到这里（行元素都在 rowByRef 里登记过）；真走到了
 * 说明数据里多出一行而屏幕还没画，这里只保证「像一行、不报错」，
 * 下一次完整渲染就会换成真正的行。
 */
function buildLoraRow(node, row, index) {
    const el = element("div", "xlora-row xmlg-row");
    el.dataset.index = String(index);
    if (row?.group) {
        el.classList.add("is-grouped");
        el.dataset.group = row.group;
    }
    el.appendChild(element("span", "xlora-seq", "–"));
    el.appendChild(element(
        "span",
        "xlora-name",
        row?.title || row?.lora_name || row?.lora_ref || ""
    ));
    return el;
}

// ── 拖入即插入（对齐 XMediaListGet 的手感）──────────────────────────────

/**
 * 这一行该不该有钉住按钮、钉哪一头。
 *
 * 只有列表的头尾两行有：钉住的意思是「把这一端焊死」，中间的行先拖到端上
 * 再钉。位置会变（拖动、增删），所以每次都要重算，不能只在建行时算一次。
 */
function pinPositionForIndex(index, total) {
    if (!Number.isFinite(index) || index < 0) {
        return "";
    }
    if (index === 0) {
        return "head";
    }
    if (total > 0 && index === total - 1) {
        return "tail";
    }
    return "";
}

/** 造一颗钉住按钮：↑ 钉到最前 / ↓ 钉到最后，再点一次取消。 */
function buildPinButton(node, item, position, tooltip) {
    const isHead = position === "head";
    const lockBtn = document.createElement("button");
    lockBtn.className = "xlora-lock-btn";
    lockBtn.type = "button";
    lockBtn.dataset.pin = position;
    lockBtn.appendChild(buildPinIcon(position));
    bindTooltip(
        lockBtn,
        tooltip,
        t(
            isHead
                ? "xdatahub.ui.node.xloraget.pin_head"
                : "xdatahub.ui.node.xloraget.pin_tail",
            isHead ? "Pin to top" : "Pin to bottom"
        )
    );
    if (item.pin === position) {
        lockBtn.classList.add("active");
    }
    lockBtn.addEventListener("click", () => {
        const state = node?.__xlora_panel?.state;
        if (!state) {
            return;
        }
        const wasPinned = item.pin === position;
        state.rows.forEach((rowItem) => {
            if (rowItem.pin === position) {
                rowItem.pin = "none";
            }
        });
        item.pin = wasPinned ? "none" : position;
        applyPinToRow(state, item);
        writeStoredRows(node, state.rows);
        renderNodeRows(node);
    });
    return lockBtn;
}

/**
 * 行被搬来搬去之后，钉子要跟着走。
 *
 * 拖动走的是「就地重排」（复用原来的行元素，不重建），所以头尾换了人时
 * 钉子会留在旧的地方：新头尾没有钉子、旧头尾还挂着一颗。这里按最新位置
 * 补回来——不然得再点一下别的东西（触发整表重画）钉子才「突然出现」。
 */
function syncRowPinButtons(node) {
    const panel = node?.__xlora_panel;
    const list = panel?.list;
    if (!list) {
        return;
    }
    const rows = panel.state.items?.[LORA_CATEGORY] || panel.state.rows || [];
    for (const el of list.querySelectorAll(".xlora-row")) {
        const index = Number(el.dataset.index);
        const item = rows[index];
        const main = el.querySelector(".xlora-row-main");
        if (!item || !main) {
            continue;
        }
        const wanted = pinPositionForIndex(index, rows.length);
        const current = el.querySelector(".xlora-lock-btn");
        if (current && current.dataset.pin === wanted) {
            current.classList.toggle("active", !!wanted && item.pin === wanted);
            continue;
        }
        if (current) {
            current.remove();
        }
        if (!wanted) {
            continue;
        }
        // 钉子永远排在开关前面
        main.insertBefore(
            buildPinButton(node, item, wanted, panel.tooltip),
            main.querySelector(".xlora-active") || main.firstChild
        );
    }
}

/**
 * 钉住一行之后要做的两件事：
 *
 * 1. 挪到队首 / 队尾（`enforcePinLayout`）；
 * 2. **退出所在分组**——置顶/置底的行位置由标记决定，不能再跟着组跑，
 *    否则组里会夹着一个被挪到队首的成员，组的连贯性就断了。
 *    组里没人了就顺手解散（`loraItemsFromState` 会收掉空组）。
 */
function applyPinToRow(state, item) {
    if (item?.pin && item.pin !== "none" && item.group) {
        item.group = null;
    }
    state.rows = enforcePinLayout(state.rows);
    loraItemsFromState(state);
}

/** 把插入位置夹到「钉住区」以外：置顶行前不能插，置底行后不能插。 */
function clampInsertIndex(rows, index) {
    const total = Array.isArray(rows) ? rows.length : 0;
    const minIndex = rows?.some?.((item) => item.pin === "head") ? 1 : 0;
    const maxIndex = rows?.some?.((item) => item.pin === "tail")
        ? total - 1
        : total;
    const raw = Number.isFinite(index) ? index : total;
    return clamp(raw, Math.max(0, minIndex), Math.max(0, maxIndex));
}

/**
 * 鼠标落在列表的哪一行之间。
 *
 * 判定用行中线：上半段插到这一行前面，下半段插到后面。没有「替换」
 * 这一说——LoRA 行还带着强度、触发词和备注，静默替换会把它们一起
 * 丢掉，代价太大。
 */
function resolveInsertIndex(list, rows, clientY) {
    const rowEls = Array.from(list.querySelectorAll(".xlora-row"));
    let index = rowEls.length;
    for (const rowEl of rowEls) {
        const rect = rowEl.getBoundingClientRect();
        if (clientY < rect.top + rect.height / 2) {
            index = Number(rowEl.dataset.index);
            if (!Number.isFinite(index)) {
                index = rowEls.indexOf(rowEl);
            }
            break;
        }
    }
    return clampInsertIndex(rows, index);
}

function clearDropIndicator(panel) {
    if (!panel) {
        return;
    }
    if (panel.insertLine) {
        panel.insertLine.style.display = "none";
    }
    if (panel.dropLabel) {
        panel.dropLabel.style.display = "none";
    }
}

/** 列表每次重画都会清空 innerHTML，画完把指示线挂回去。 */
function mountDropOverlay(panel) {
    if (!panel?.list) {
        return;
    }
    clearDropIndicator(panel);
    if (panel.insertLine) {
        panel.list.appendChild(panel.insertLine);
    }
    if (panel.dropLabel) {
        panel.list.appendChild(panel.dropLabel);
    }
}

function showDropIndicator(panel, rows, index, count, kind = "insert") {
    if (!panel?.list || !panel.insertLine || !panel.dropLabel) {
        return;
    }
    panel.dropKind = kind;
    const rowEls = Array.from(panel.list.querySelectorAll(".xlora-row"));
    const padding = Number.parseFloat(
        getComputedStyle(panel.list).paddingTop
    ) || 0;
    let top = padding;
    const nextRow = rowEls.find(
        (rowEl) => Number(rowEl.dataset.index) === index
    );
    if (nextRow) {
        top = nextRow.offsetTop - 2;
    } else if (rowEls.length) {
        const last = rowEls[rowEls.length - 1];
        top = last.offsetTop + last.offsetHeight + 1;
    }
    panel.insertLine.style.top = `${Math.max(0, top)}px`;
    panel.insertLine.style.display = "block";
    if (kind === "move") {
        panel.dropLabel.textContent = t(
            "xdatahub.ui.node.xloraget.move_here",
            "Move here"
        );
    } else {
        panel.dropLabel.textContent = count > 1
            ? `+ ${
                t(
                    "xdatahub.ui.node.xloraget.insert_many",
                    "Insert {count} LoRAs",
                    { count }
                )
            }`
            : `+ ${
                t("xdatahub.ui.node.xloraget.insert_here", "Insert here")
            }`;
    }
    panel.dropLabel.style.top = `${Math.max(0, top - 24)}px`;
    panel.dropLabel.style.display = "block";
}

/**
 * 内部拖动时的落点。
 *
 * `resolveInsertIndex` 给的是「插到第几格」，而移动是先把原行抽出来再
 * 插回去：原行后面的位置要往前挪一格，否则往下拖会少走一位。
 */
/**
 * 把「当前列表里的第几个缝」换算成「抽走自己之后要插到第几位」。
 * 往下拖要减 1：自己一被抽走，下面的行整体前移一格。
 */
function moveTargetFromGap(gapIndex, fromIndex) {
    return gapIndex > fromIndex ? gapIndex - 1 : gapIndex;
}

function resolveMoveIndex(list, rows, clientY, fromIndex) {
    return moveTargetFromGap(
        resolveInsertIndex(list, rows, clientY),
        fromIndex
    );
}

/** 拖到列表上下边缘时自动滚动，长列表才拖得到看不见的位置。 */
function stopDropAutoScroll(state) {
    if (state?.autoScrollRaf) {
        cancelAnimationFrame(state.autoScrollRaf);
        state.autoScrollRaf = 0;
    }
    if (state) {
        state.autoScrollDir = 0;
    }
}

function startDropAutoScroll(node, state, dir) {
    if (!state || state.autoScrollDir === dir) {
        return;
    }
    stopDropAutoScroll(state);
    state.autoScrollDir = dir;
    const step = () => {
        if (!state.autoScrollDir) {
            state.autoScrollRaf = 0;
            return;
        }
        const list = node.__xlora_panel?.list;
        if (list) {
            list.scrollTop += state.autoScrollDir * DROP_AUTOSCROLL_STEP;
            const panel = node.__xlora_panel;
            if (panel?.dropIndex != null) {
                showDropIndicator(
                    panel,
                    panel.state.rows,
                    panel.dropIndex,
                    panel.dropCount || 1
                );
            }
        }
        state.autoScrollRaf = requestAnimationFrame(step);
    };
    state.autoScrollRaf = requestAnimationFrame(step);
}

function showPanelToast(node, text) {
    const panel = node?.__xlora_panel;
    if (!panel?.toast || !text) {
        return;
    }
    panel.toast.textContent = text;
    panel.toast.classList.add("is-visible");
    if (panel.toastTimer) {
        clearTimeout(panel.toastTimer);
    }
    panel.toastTimer = window.setTimeout(() => {
        panel.toastTimer = 0;
        panel.toast?.classList.remove("is-visible");
    }, TOAST_DURATION_MS);
}

/** 从 XDataHub 的拖拽类型标记里数一下拖了几个。 */
function dropCountFromDataTransfer(dataTransfer) {
    const types = dataTransfer?.types;
    if (!types || typeof types.length !== "number") {
        return 1;
    }
    for (const type of Array.from(types)) {
        const match = /^application\/x-xdatahub-count-(\d+)$/.exec(
            String(type)
        );
        if (match) {
            const count = Number(match[1]);
            if (Number.isFinite(count) && count > 0) {
                return count;
            }
        }
    }
    return 1;
}

/** 拖进来的不是 LoRA（图片/视频/音频/文本）时给出明确提示。 */
function dragHasForeignType(dataTransfer) {
    const types = dataTransfer?.types;
    if (!types || typeof types.length !== "number") {
        return false;
    }
    for (const type of Array.from(types)) {
        const match = /^application\/x-xdatahub-type-([a-z]+)$/.exec(
            String(type)
        );
        if (match) {
            return match[1] !== "lora";
        }
    }
    return false;
}

/**
 * 在指定位置插入几行 LoRA。
 *
 * 已经在列表里的不重复插入、也不挪位置，只提示一声——重复拖入多半是
 * 手滑，静默改动列表顺序比什么都不做更容易出事。
 */
function insertLoraRowsAt(node, entries, index) {
    const panel = node?.__xlora_panel;
    if (!panel?.state) {
        return;
    }
    const rows = readStoredRows(node);
    const existingRefs = new Set(rows.map((row) => String(row.lora_ref || "")));
    const fresh = [];
    let skipped = 0;
    for (const entry of entries) {
        const ref = String(entry?.lora_ref || "").trim();
        if (!ref) {
            continue;
        }
        if (existingRefs.has(ref)) {
            skipped += 1;
            continue;
        }
        existingRefs.add(ref);
        fresh.push(entry);
    }
    if (!fresh.length) {
        if (skipped) {
            showPanelToast(
                node,
                t(
                    "xdatahub.ui.node.xloraget.already_present",
                    "{count} already in the list",
                    { count: skipped }
                )
            );
        }
        return;
    }
    const insertIndex = clampInsertIndex(rows, index);
    const added = [];
    for (const entry of fresh) {
        const hasModel = Number.isFinite(Number(entry.strength_model));
        const hasClip = Number.isFinite(Number(entry.strength_clip));
        const model = hasModel ? toFloat(entry.strength_model, 1) : 1;
        const clip = hasClip
            ? toFloat(entry.strength_clip, model)
            : model;
        added.push(
            makeRow({
                lora_ref: entry.lora_ref,
                title: String(entry.title || "lora"),
                active: true,
                separate_clip_strength: clip !== model,
                strength_model: model,
                strength_clip: clip,
                // 拖拽数据里没带强度时，等节点拉取远端数据补全。
                strength_sync_pending: !hasModel || !hasClip,
                lora_note: "",
                thumb_url: entry.thumb_url,
                cover_kind: entry.cover_kind,
                cover_url: entry.cover_url,
                pin: "none",
            })
        );
    }
    const nextRows = enforcePinLayout([
        ...rows.slice(0, insertIndex),
        ...added,
        ...rows.slice(insertIndex),
    ]);
    panel.state.rows = nextRows;
    if (nextRows.some((row) => row.separate_clip_strength)) {
        panel.state.globalSeparateClip = true;
    }
    writeStoredRows(node, nextRows);
    renderNodeRows(node);
    for (const row of nextRows) {
        if (added.includes(row)) {
            syncRowTriggerWords(node, row, { force: true });
        }
    }
    const parts = [
        t(
            "xdatahub.ui.node.xloraget.inserted",
            "Inserted {count} LoRAs",
            { count: added.length }
        ),
    ];
    if (skipped) {
        parts.push(
            t(
                "xdatahub.ui.node.xloraget.already_present",
                "{count} already in the list",
                { count: skipped }
            )
        );
    }
    showPanelToast(node, parts.join(" · "));
}

function bindDnD(node) {
    const panel = node.__xlora_panel;
    if (!panel) {
        return;
    }
    const { list, state } = panel;
    const consume = (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (typeof event.stopImmediatePropagation === "function") {
            event.stopImmediatePropagation();
        }
    };
    list.addEventListener("dragenter", (event) => {
        consume(event);
        list.classList.add("drag-over");
    });
    list.addEventListener("dragover", (event) => {
        consume(event);
        list.classList.add("drag-over");
        // 列表只收 LoRA：拖图片/视频/音频/文本进来时明确拒绝，
        // 不要让人以为「拖进去了但没反应」。
        if (dragHasForeignType(event.dataTransfer)) {
            if (event.dataTransfer) {
                event.dataTransfer.dropEffect = "none";
            }
            clearDropIndicator(panel);
            stopDropAutoScroll(state);
            panel.dropIndex = null;
            showPanelToast(
                node,
                t(
                    "xdatahub.ui.node.xloraget.lora_only",
                    "This list only accepts LoRAs"
                )
            );
            return;
        }
        if (event.dataTransfer) {
            event.dataTransfer.dropEffect = "copy";
        }
        const rows = panel.state.rows;
        const index = resolveInsertIndex(list, rows, event.clientY);
        panel.dropIndex = index;
        panel.dropCount = dropCountFromDataTransfer(event.dataTransfer);
        showDropIndicator(panel, rows, index, panel.dropCount);
        // 拖到列表上下边缘时自动滚动
        const rect = list.getBoundingClientRect();
        if (event.clientY - rect.top < DROP_AUTOSCROLL_EDGE) {
            startDropAutoScroll(node, state, -1);
        } else if (rect.bottom - event.clientY < DROP_AUTOSCROLL_EDGE) {
            startDropAutoScroll(node, state, 1);
        } else {
            stopDropAutoScroll(state);
        }
    });
    list.addEventListener("dragleave", (event) => {
        consume(event);
        const related = event.relatedTarget;
        if (related instanceof Node && list.contains(related)) {
            return;
        }
        list.classList.remove("drag-over");
        clearDropIndicator(panel);
        stopDropAutoScroll(state);
        panel.dropIndex = null;
    });
    list.addEventListener("drop", (event) => {
        consume(event);
        list.classList.remove("drag-over");
        const dropIndex = resolveInsertIndex(
            list,
            panel.state.rows,
            event.clientY
        );
        clearDropIndicator(panel);
        stopDropAutoScroll(state);
        panel.dropIndex = null;
        const payload = parseDragPayload(event.dataTransfer);
        if (!payload) {
            return;
        }
        const entries = payload.items?.length ? payload.items : [payload];
        const dropKey = entries
            .map((entry) => entry.lora_ref)
            .join("|");
        const now = Date.now();
        if (
            dropKey === state.lastExternalDropKey
            && now - Number(state.lastExternalDropAt || 0) < 260
        ) {
            return;
        }
        state.lastExternalDropKey = dropKey;
        state.lastExternalDropAt = now;
        insertLoraRowsAt(node, entries, dropIndex);
    });
}

function applyPanelLocale(panelInfo) {
    if (!panelInfo) {
        return;
    }
    if (panelInfo.empty) {
        panelInfo.empty.textContent = t(
            "xdatahub.ui.node.xloraget.empty",
            "Drag Lora cards from XDataHub here"
        );
    }
    if (panelInfo.globalToggleText) {
        panelInfo.globalToggleText.textContent = t(
            "xdatahub.ui.node.xloraget.clip_toggle",
            "Separate Clip Strength"
        );
    }
}

function refreshAllPanelLocales() {
    const rootGraph = app.graph;
    if (!rootGraph) {
        return;
    }
    forEachNodeInGraphTree(rootGraph, (node) => {
        const panelInfo = node?.__xlora_panel;
        if (!panelInfo) {
            return;
        }
        applyPanelLocale(panelInfo);
        renderNodeRows(node);
    });
}

async function applyUiLocale(localeOverride = null) {
    const locale = normalizeLocaleCode(localeOverride || resolveComfyLocale())
        || "en";
    await loadUiLocaleBundle(locale);
    currentUiLocale = locale;
    refreshAllPanelLocales();
}

function installExistingNodes() {
    const rootGraph = app.graph;
    if (!rootGraph) {
        return;
    }
    forEachNodeInGraphTree(rootGraph, (node) => {
        installNodeUi(node);
        refreshNodeBadge(node);
    });
}

let _hoverRestoreState = null;
let _hoverRestoreGraph = null;
let _hoverAnimationId = null;

function cancelNodeHoverAnimation() {
    if (_hoverAnimationId) {
        cancelAnimationFrame(_hoverAnimationId);
        _hoverAnimationId = null;
    }
}

function animateNodeToView(node) {
    if (!node || !app.canvas) {
        return;
    }
    const currentGraph = app.canvas.graph;
    if (!node.graph || !currentGraph || node.graph !== currentGraph) {
        return;
    }
    const ds = app.canvas.ds;
    const canvasEl = ds.element;
    if (!ds || !canvasEl) {
        return;
    }

    cancelNodeHoverAnimation();
    if (!_hoverRestoreState || _hoverRestoreGraph !== currentGraph) {
        _hoverRestoreState = {
            offset: [ds.offset[0], ds.offset[1]],
            scale: ds.scale,
        };
        _hoverRestoreGraph = currentGraph;
    }

    const cw = canvasEl.width / window.devicePixelRatio;
    const ch = canvasEl.height / window.devicePixelRatio;

    const targetZoom = 0.75;
    const nodeW = Math.max(node.size[0], 300);
    const nodeH = Math.max(node.size[1], 300);
    let targetScale = (targetZoom * cw) / nodeW;
    targetScale = Math.min(targetScale, (targetZoom * ch) / nodeH, ds.max_scale);
    const targetCx = node.pos[0] + node.size[0] * 0.5;
    const targetCy = node.pos[1] + node.size[1] * 0.5;

    const startCx = cw * 0.5 / ds.scale - ds.offset[0];
    const startCy = ch * 0.5 / ds.scale - ds.offset[1];
    const startScale = ds.scale;

    const duration = 350;
    const startTime = performance.now();

    function easeInOutQuad(t) {
        return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
    }

    function step(now) {
        const elapsed = now - startTime;
        const progress = Math.min(elapsed / duration, 1);
        const eased = easeInOutQuad(progress);

        const curScale = startScale + (targetScale - startScale) * eased;
        const curCx = startCx + (targetCx - startCx) * eased;
        const curCy = startCy + (targetCy - startCy) * eased;

        ds.offset[0] = -(curCx - cw * 0.5 / curScale);
        ds.offset[1] = -(curCy - ch * 0.5 / curScale);
        ds.scale = curScale;
        app.canvas.setDirty(true, true);

        if (progress < 1) {
            _hoverAnimationId = requestAnimationFrame(step);
        } else {
            _hoverAnimationId = null;
        }
    }
    _hoverAnimationId = requestAnimationFrame(step);
}

function animateToSavedState() {
    if (!_hoverRestoreState || !app.canvas) {
        return;
    }
    const ds = app.canvas.ds;
    const canvasEl = ds?.element;
    if (!ds || !canvasEl) {
        _hoverRestoreState = null;
        _hoverRestoreGraph = null;
        return;
    }

    cancelNodeHoverAnimation();
    const saved = _hoverRestoreState;
    _hoverRestoreState = null;
    _hoverRestoreGraph = null;

    const cw = canvasEl.width / window.devicePixelRatio;
    const ch = canvasEl.height / window.devicePixelRatio;

    const startCx = cw * 0.5 / ds.scale - ds.offset[0];
    const startCy = ch * 0.5 / ds.scale - ds.offset[1];
    const startScale = ds.scale;
    const targetCx = cw * 0.5 / saved.scale - saved.offset[0];
    const targetCy = ch * 0.5 / saved.scale - saved.offset[1];
    const targetScale = saved.scale;

    const duration = 350;
    const startTime = performance.now();

    function easeInOutQuad(t) {
        return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
    }

    function step(now) {
        const elapsed = now - startTime;
        const progress = Math.min(elapsed / duration, 1);
        const eased = easeInOutQuad(progress);

        const curScale = startScale + (targetScale - startScale) * eased;
        const curCx = startCx + (targetCx - startCx) * eased;
        const curCy = startCy + (targetCy - startCy) * eased;

        ds.offset[0] = -(curCx - cw * 0.5 / curScale);
        ds.offset[1] = -(curCy - ch * 0.5 / curScale);
        ds.scale = curScale;
        app.canvas.setDirty(true, true);

        if (progress < 1) {
            _hoverAnimationId = requestAnimationFrame(step);
        } else {
            _hoverAnimationId = null;
        }
    }
    _hoverAnimationId = requestAnimationFrame(step);
}

function initXLoraGetExtension() {
    if (ROOT[EXT_GUARD_KEY]) {
        return;
    }
    ROOT[EXT_GUARD_KEY] = true;
    app.registerExtension({
        name: EXT_NAME,
        async beforeRegisterNodeDef(nodeType, nodeData) {
            const nodeClass = String(nodeData?.name || "");
            if (nodeClass !== TARGET_NODE_CLASS) {
                return;
            }
            const origCreated = nodeType.prototype.onNodeCreated;
            const origConfigure = nodeType.prototype.onConfigure;
            const origRemoved = nodeType.prototype.onRemoved;
            nodeType.prototype.onNodeCreated = function () {
                origCreated?.apply(this, arguments);
                installNodeUi(this);
            };
            const origConnectionsChange = nodeType.prototype.onConnectionsChange;
            nodeType.prototype.onConnectionsChange = function () {
                origConnectionsChange?.apply(this, arguments);
                refreshLoadSequence(this);
            };
            nodeType.prototype.onRemoved = function () {
                disposeNodeUi(this);
                origRemoved?.apply(this, arguments);
            };
            nodeType.prototype.onConfigure = function () {
                origConfigure?.apply(this, arguments);
                installNodeUi(this);
                reloadPanelFromStorage(this);
            };
        },
        async nodeCreated(node) {
            installNodeUi(node);
        },
        async loadedGraphNode(node) {
            installNodeUi(node);
            reloadPanelFromStorage(node);
            refreshNodeBadge(node);
        },
        async setup() {
            await applyUiLocale();
            installLocaleSync();
            installExistingNodes();
            const rootOrigin = window.location.origin;
            ROOT.addEventListener("message", (event) => {
                if (event?.source !== ROOT || event.origin !== rootOrigin) {
                    return;
                }
                const payload = event?.data;
                if (!payload || typeof payload !== "object") {
                    return;
                }
                if (payload.type === "xdatahub:lora_info_saved") {
                    return;
                }
                if (payload.type === "xdatahub:lora_cover_changed") {
                    applyLoraCoverChange(payload);
                    return;
                }
                if (payload.type === "xdatahub:ui-locale") {
                    applyUiLocale(payload.locale).catch(() => {});
                    return;
                }
                if (payload.type === "xdatahub:request_media_get_nodes") {
                    const nodeClass = String(payload.node_class || "");
                    if (nodeClass !== TARGET_NODE_CLASS) {
                        return;
                    }
                    event.source?.postMessage?.(
                        {
                            type: "xdatahub:media_get_nodes",
                            request_id: payload.request_id,
                            node_class: nodeClass,
                            nodes: collectXLoraNodes(),
                        },
                        rootOrigin
                    );
                    return;
                }
                if (payload.type === "xdatahub:node_hover") {
                    const hoverNodeId = String(
                        payload.node_id || ""
                    ).trim();
                    if (hoverNodeId) {
                        const hoverNode = getNodeById(hoverNodeId);
                        animateNodeToView(hoverNode);
                    }
                    return;
                }
                if (payload.type === "xdatahub:node_hover_leave") {
                    animateToSavedState();
                    return;
                }
                if (payload.type !== "xdatahub:send_to_node") {
                    return;
                }
                const data = payload.data || {};
                const nodeClass = String(data.node_class || "");
                if (nodeClass !== TARGET_NODE_CLASS) {
                    return;
                }
                const requestId = String(data.request_id || "");
                const nodeId = String(data.node_id ?? "").trim();
                const ack = (ok, error = "") => {
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
                if (!node || String(node.comfyClass || "") !== TARGET_NODE_CLASS) {
                    ack(false, "Target node not found");
                    return;
                }
                const mediaRef = String(data.media_ref || "");
                try {
                    upsertLoraRowFromMediaRef(
                        node,
                        mediaRef,
                        data.title || "",
                        data.thumb_url || "",
                        data.strength_model,
                        data.strength_clip,
                        data.lora_note || "",
                        {
                            coverKind: data.cover_kind,
                            coverUrl: data.cover_url,
                        }
                    );
                    ack(true);
                } catch (error) {
                    ack(false, error?.message || "Failed to update target node");
                }
            });
        },
    });
    setTimeout(() => {
        installExistingNodes();
    }, 0);
}

ROOT.__xloraget_extension_loaded__ = true;
ROOT.__xloraget_extension_init__ = initXLoraGetExtension;
initXLoraGetExtension();
