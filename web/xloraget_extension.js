import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";
import {
    getModuloAccentIndex as getNodeAccentIndex,
    getHexAccentFromModuloId as getNodeAccentColor,
} from "./core/node-accent.js";

const EXT_NAME = "xz3r0.xloraget";
const EXT_GUARD_KEY = "__xloraget_extension_registered__";
const ROOT = globalThis;
const TARGET_NODE_CLASS = "XLoraGet";
const XDATAHUB_MEDIA_MIME = "application/x-xdatahub-media+json";
const XLORA_ROW_MIME = "application/x-xloraget-row";
const STORAGE_WIDGET = "lora_stack";
const STYLE_ID = "xloraget-extension-style";
const GLOBAL_CLIP_MODE_PROP = "xloraget.globalSeparateClipStrength";
const DEFAULT_MIN_NODE_WIDTH = 614;
const DEFAULT_MIN_NODE_HEIGHT = 560;
const TRIGGER_PANEL_HEIGHT_DELTA = 220;
const AUTO_RESIZE_TRIGGER_PANEL = false;
const TRIGGER_WORDS_ENDPOINT = "/xz3r0/xdatahub/loras/trigger-words";
const TRIGGER_WORD_INLINE_LIMIT = 3;
const COMFY_LOCALE_KEY = "Comfy.Locale";
const LOCALE_SYNC_INTERVAL_MS = 1000;

let rowSeq = 1;

let uiLocalePrimary = {};
let uiLocaleFallback = {};
let currentUiLocale = "en";
let localeSyncInstalled = false;

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

function t(key, fallback = "") {
    return readUiText(key, fallback || key);
}

async function fetchLocaleJson(localeCode) {
    try {
        const response = await fetch(
            `/xz3r0/xdatahub/i18n/ui?locale=${encodeURIComponent(localeCode)}`,
            { cache: "no-cache" }
        );
        if (!response.ok) {
            return {};
        }
        const payload = await response.json();
        const dict = payload?.dict;
        return dict && typeof dict === "object" ? dict : {};
    } catch {
        return {};
    }
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
    };
}

function showTooltip(tooltip, event, text, thumbUrl = "", noteText = "") {
    const img = tooltip?.querySelector("img");
    const label = tooltip?.querySelector(".xlora-tooltip-name");
    const divider = tooltip?.querySelector(".xlora-tooltip-divider");
    const note = tooltip?.querySelector(".xlora-tooltip-note");
    if (!(tooltip instanceof HTMLElement)
        || !(label instanceof HTMLElement)
        || !(img instanceof HTMLImageElement)
        || !(divider instanceof HTMLElement)
        || !(note instanceof HTMLElement)) {
        return;
    }
    const displayName = extractLoraFilename(String(text || ""));
    const displayNote = String(noteText || "").trim();
    label.textContent = displayName;
    note.textContent = displayNote;
    divider.style.display = displayNote ? "block" : "none";
    note.style.display = displayNote ? "block" : "none";
    if (thumbUrl) {
        img.src = thumbUrl;
        img.style.display = "block";
        tooltip.classList.add("has-thumb");
    } else {
        img.removeAttribute("src");
        img.style.display = "none";
        tooltip.classList.remove("has-thumb");
    }
    tooltip.style.left = `${event.clientX + 14}px`;
    tooltip.style.top = `${event.clientY + 12}px`;
    tooltip.style.display = "block";
}

function moveTooltip(tooltip, event) {
    if (!(tooltip instanceof HTMLElement) || tooltip.style.display !== "block") {
        return;
    }
    tooltip.style.left = `${event.clientX + 14}px`;
    tooltip.style.top = `${event.clientY + 12}px`;
}

function hideTooltip(tooltip) {
    if (tooltip instanceof HTMLElement) {
        tooltip.style.display = "none";
    }
}

function bindTooltip(
    target,
    tooltip,
    text,
    thumbUrl = "",
    noteText = ""
) {
    if (!(target instanceof HTMLElement)) {
        return;
    }
    target.addEventListener("mouseenter", (event) => {
        showTooltip(tooltip, event, text, thumbUrl, noteText);
    });
    target.addEventListener("mousemove", (event) => {
        moveTooltip(tooltip, event);
    });
    target.addEventListener("mouseleave", () => {
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
        pin: partial.pin === "head" || partial.pin === "tail"
            ? partial.pin
            : "none",
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
        const strengthModel = Number(payload?.strength_model);
        const strengthClip = Number(payload?.strength_clip);
        return {
            lora_ref: loraRef,
            title,
            thumb_url: thumbUrl,
            strength_model: Number.isFinite(strengthModel)
                ? strengthModel
                : null,
            strength_clip: Number.isFinite(strengthClip)
                ? strengthClip
                : null,
        };
    } catch {
        return null;
    }
}

function isInternalRowDrag(dataTransfer) {
    if (!dataTransfer || typeof dataTransfer.types?.includes !== "function") {
        return false;
    }
    return dataTransfer.types.includes(XLORA_ROW_MIME);
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
        .xlora-panel {
            display: flex;
            flex-direction: column;
            gap: 6px;
            width: 100%;
            height: 100%;
            box-sizing: border-box;
            padding: 8px;
        }
        .xlora-meta {
            display: flex;
            align-items: center;
            gap: 8px;
            min-height: 20px;
            height: 20px;
            flex: 0 0 20px;
        }
        .xlora-list {
            display: flex;
            flex-direction: column;
            gap: 8px;
            min-height: 260px;
            flex: 1 1 auto;
            border: 1px solid var(--borderColor, #555);
            background: var(--bgColor, #222);
            border-radius: 8px;
            padding: 8px;
            box-sizing: border-box;
            overflow: auto;
            overflow-anchor: none;
        }
        .xlora-toolbar {
            display: flex;
            align-items: flex-start;
            justify-content: space-between;
            gap: 10px;
            border: 1px solid var(--borderColor, #555);
            background: var(--bgColor, #222);
            border-radius: 8px;
            padding: 8px 10px;
            box-sizing: border-box;
        }
        .xlora-toolbar-copy {
            display: flex;
            flex-direction: column;
            gap: 3px;
            min-width: 0;
            flex: 1 1 auto;
        }
        .xlora-toolbar-desc {
            font-size: 11px;
            color: #d7d7d7;
            opacity: 0.92;
            line-height: 1.35;
        }
        .xlora-global-toggle {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            font-size: 11px;
            color: #ddd;
            user-select: none;
            white-space: nowrap;
            flex: 0 0 auto;
        }
        .xlora-node-badge {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            border: 1px solid var(--xlora-accent, #0066FF);
            border-radius: 999px;
            background: var(--bgColor, #222);
            padding: 4px 12px;
            color: #f2f2f2;
            flex: 0 0 auto;
        }
        .xlora-node-badge-chip {
            font-size: 16px;
            line-height: 1;
            font-variant-numeric: tabular-nums;
            font-family: ui-monospace, "Cascadia Mono", "Consolas", monospace;
            letter-spacing: 0.15px;
            color: var(--xlora-accent, #0066FF);
            font-weight: 700;
        }
        .xlora-node-badge-swatch {
            width: 18px;
            height: 18px;
            border-radius: 5px;
            background: var(--xlora-accent, #0066FF);
            box-shadow: inset 0 0 0 1px var(--borderColor, #555);
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
            border-color: #EA005E;
            box-shadow: 0 0 0 1px #EA005E;
        }
        .xlora-empty {
            font-size: 12px;
            text-align: center;
            color: #ddd;
            opacity: 0.85;
            padding: 18px 8px;
            line-height: 1.5;
        }
        .xlora-row {
            border: 1px solid var(--borderColor, #555);
            border-radius: 8px;
            background: #1d1d1d;
            padding: 8px;
            box-sizing: border-box;
            display: flex;
            flex-direction: column;
            gap: 8px;
            min-height: 60px;
            flex: 0 0 auto;
            overflow: visible;
        }
        .xlora-row-main {
            width: 100%;
            display: flex;
            align-items: center;
            gap: 8px;
            min-width: 0;
        }
        .xlora-row.dragging {
            opacity: 0.5;
        }
        .xlora-row.drag-target {
            border-color: #EA005E;
            box-shadow: 0 0 0 1px #EA005E;
        }
        .xlora-handle {
            width: 20px;
            min-width: 20px;
            height: 20px;
            border-radius: 5px;
            border: 1px solid var(--borderColor, #555);
            display: inline-flex;
            align-items: center;
            justify-content: center;
            font-size: 12px;
            color: #ddd;
            cursor: grab;
            user-select: none;
            background: #2b2b2b;
        }
        .xlora-active {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 18px;
            min-width: 18px;
        }
        .xlora-row.inactive {
            opacity: 0.62;
        }
        .xlora-row.locked .xlora-handle {
            opacity: 0.45;
            cursor: not-allowed;
        }
        .xlora-name {
            flex: 1 1 auto;
            min-width: 0;
            font-size: 12px;
            color: #f2f2f2;
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
            scrollbar-width: thin;
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
            border: 1px solid rgba(234, 0, 94, 0.42);
            background: rgba(234, 0, 94, 0.16);
            color: #f6d7e4;
            border-radius: 999px;
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
            border-radius: 999px;
            border: 1px solid rgba(255, 255, 255, 0.22);
            background: rgba(255, 255, 255, 0.08);
            color: #ececec;
            font-size: 11px;
            line-height: 1.3;
            padding: 0 10px;
            cursor: pointer;
            flex: 0 0 auto;
        }
        .xlora-trigger-panel {
            border: 1px solid rgba(255, 255, 255, 0.14);
            background: rgba(0, 0, 0, 0.24);
            border-radius: 8px;
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
            border-radius: 6px;
            border: 1px solid rgba(255, 255, 255, 0.2);
            background: rgba(255, 255, 255, 0.06);
            color: #f2f2f2;
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
            border-radius: 6px;
            border: 1px solid rgba(255, 255, 255, 0.22);
            background: rgba(255, 255, 255, 0.08);
            color: #ececec;
            font-size: 11px;
            line-height: 1;
            padding: 0 8px;
            cursor: pointer;
        }
        .xlora-trigger-panel-list {
            display: flex;
            flex-wrap: wrap;
            gap: 6px;
            max-height: 168px;
            overflow-y: auto;
            overscroll-behavior: contain;
            padding-right: 2px;
        }
        .xlora-trigger-panel-empty {
            font-size: 11px;
            color: #c9c9c9;
            opacity: 0.9;
            padding: 4px 2px;
        }
        .xlora-trigger-chip.is-disabled {
            opacity: 0.45;
            background: rgba(255, 255, 255, 0.05);
            border-color: rgba(255, 255, 255, 0.14);
            color: #c8c8c8;
        }
        .xlora-trigger-chip.is-placeholder {
            cursor: default;
            border-style: dashed;
            background: rgba(255, 255, 255, 0.04);
            border-color: rgba(255, 255, 255, 0.14);
            color: #c8c8c8;
        }
        .xlora-trigger-refresh {
            width: 22px;
            min-width: 22px;
            height: 22px;
            border-radius: 6px;
            border: 1px solid rgba(255, 255, 255, 0.22);
            background: rgba(255, 255, 255, 0.08);
            color: #ececec;
            font-size: 12px;
            line-height: 1;
            cursor: pointer;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            padding: 0;
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
            opacity: 0.9;
            color: #ddd;
        }
        .xlora-input {
            width: 68px;
            height: 24px;
            border-radius: 6px;
            border: 1px solid var(--borderColor, #555);
            background: #161616;
            color: #f3f3f3;
            padding: 0 6px;
            box-sizing: border-box;
            font-size: 11px;
        }
        .xlora-lock-btn {
            width: 22px;
            min-width: 22px;
            height: 22px;
            border-radius: 6px;
            border: 1px solid var(--borderColor, #555);
            background: #2b2b2b;
            color: #efefef;
            font-size: 12px;
            line-height: 1;
            cursor: pointer;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            padding: 0;
        }
        .xlora-lock-btn.active {
            border-color: #EA005E;
            color: #EA005E;
        }
        .xlora-remove {
            width: 22px;
            min-width: 22px;
            height: 22px;
            border-radius: 6px;
            border: 1px solid var(--borderColor, #555);
            background: #2b2b2b;
            color: #efefef;
            font-size: 12px;
            line-height: 1;
            cursor: pointer;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            padding: 0;
        }
        .xlora-tooltip {
            position: fixed;
            z-index: 99999;
            pointer-events: none;
            background: rgba(16, 16, 16, 0.97);
            border: 1px solid #666;
            border-radius: 8px;
            padding: 8px;
            width: 212px;
            max-width: 212px;
            box-sizing: border-box;
            color: #f2f2f2;
            box-shadow: 0 8px 22px rgba(0, 0, 0, 0.55);
            display: none;
        }
        .xlora-tooltip img {
            width: 120px;
            height: 120px;
            display: block;
            object-fit: contain;
            background: #000;
            border-radius: 6px;
            margin: 0 auto;
        }
        .xlora-tooltip-name {
            font-size: 12px;
            line-height: 1.35;
            white-space: normal;
            word-break: keep-all;
            overflow-wrap: break-word;
        }
        .xlora-tooltip.has-thumb .xlora-tooltip-name {
            margin-top: 8px;
            padding-top: 8px;
            border-top: 1px solid rgba(255, 255, 255, 0.22);
        }
        .xlora-tooltip-divider {
            margin-top: 6px;
            padding-top: 6px;
            border-top: 1px solid rgba(255, 255, 255, 0.22);
            display: none;
        }
        .xlora-tooltip-note {
            font-size: 11px;
            line-height: 1.35;
            color: #d5d5d5;
            white-space: normal;
            overflow-wrap: break-word;
            word-break: break-word;
            display: none;
        }
    `;
    document.head.appendChild(style);
}

function ensureStorageWidget(node) {
    const widgets = node.widgets || [];
    let widget = widgets.find((item) => item?.name === STORAGE_WIDGET);
    if (!widget && typeof node.addWidget === "function") {
        widget = node.addWidget("text", STORAGE_WIDGET, "[]", () => {});
    }
    if (widget) {
        widget.hidden = true;
        widget.serializeValue = () => widget.value;
    }
    return widget || null;
}

function readStoredRows(node) {
    const widget = ensureStorageWidget(node);
    const raw = String(widget?.value || "").trim();
    if (!raw) {
        return [];
    }
    try {
        return normalizeRows(JSON.parse(raw));
    } catch {
        return [];
    }
}

function writeStoredRows(node, rows) {
    const panel = node.__xlora_panel;
    const globalSeparateClip = !!panel?.state?.globalSeparateClip;
    const widget = ensureStorageWidget(node);
    if (!widget) {
        return;
    }
    const payload = rows.map((item) => ({
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
        pin: item.pin || "none",
    }));
    widget.value = JSON.stringify(payload);
    node.setDirtyCanvas?.(true, true);
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

function buildPanel() {
    ensureStyles();
    const panel = document.createElement("div");
    panel.className = "xlora-panel";
    const meta = document.createElement("div");
    meta.className = "xlora-meta";
    const toolbar = document.createElement("div");
    toolbar.className = "xlora-toolbar";
    const toolbarCopy = document.createElement("div");
    toolbarCopy.className = "xlora-toolbar-copy";
    const toolbarDesc1 = document.createElement("div");
    toolbarDesc1.className = "xlora-toolbar-desc";
    toolbarDesc1.textContent = t("xdatahub.ui.node.xloraget.info_desc1", "Load order is top-to-bottom; trigger words in the second row can be toggled individually.");
    const toolbarDesc2 = document.createElement("div");
    toolbarDesc2.className = "xlora-toolbar-desc";
    toolbarDesc2.textContent = t("xdatahub.ui.node.xloraget.info_desc2", "Adjusting Clip strength has no effect when Clip is not connected.");
    toolbarCopy.appendChild(toolbarDesc1);
    toolbarCopy.appendChild(toolbarDesc2);
    const globalToggle = document.createElement("label");
    globalToggle.className = "xlora-global-toggle";
    const globalToggleInput = document.createElement("input");
    globalToggleInput.type = "checkbox";
    const globalToggleText = document.createElement("span");
    globalToggleText.textContent = t("xdatahub.ui.node.xloraget.clip_toggle", "Separate Clip Strength");
    globalToggle.appendChild(globalToggleInput);
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

    toolbar.appendChild(toolbarCopy);
    toolbar.appendChild(globalToggle);
    const list = document.createElement("div");
    list.className = "xlora-list";
    const empty = document.createElement("div");
    empty.className = "xlora-empty";
    empty.textContent = t("xdatahub.ui.node.xloraget.empty", "Drag Lora cards from XDataHub here");
    panel.appendChild(meta);
    panel.appendChild(toolbar);
    panel.appendChild(list);
    const tooltip = document.createElement("div");
    tooltip.className = "xlora-tooltip";
    tooltip.innerHTML = `
        <img alt="thumb" style="display:none;">
        <div class="xlora-tooltip-name"></div>
        <div class="xlora-tooltip-divider"></div>
        <div class="xlora-tooltip-note"></div>
    `;
    document.body.appendChild(tooltip);
    return {
        panel,
        toolbar,
        globalToggleInput,
        list,
        empty,
        tooltip,
        badge,
        badgeChip,
        toolbarDesc1,
        toolbarDesc2,
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
        panel.badge.title = `${TARGET_NODE_CLASS} #${serial}`;
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

function installNodeUi(node) {
    if (!node || String(node.comfyClass || "") !== TARGET_NODE_CLASS) {
        return;
    }
    if (node.__xlora_panel) {
        ensureStorageWidget(node);
        ensureXLoraNodeMinSize(node);
        return;
    }
    ensureStorageWidget(node);
    const ui = buildPanel();
    const initialRows = readStoredRows(node);
    const state = {
        rows: initialRows,
        globalSeparateClip: readGlobalClipMode(node, initialRows),
        dragIndex: -1,
        dragTargetEl: null,
        lastExternalDropKey: "",
        lastExternalDropAt: 0,
        expandedTriggerRowId: null,
        triggerSearchQuery: "",
    };
    node.__xlora_panel = { ...ui, state };
    if (typeof node.addDOMWidget === "function") {
        node.addDOMWidget("xlora_panel", "custom", ui.panel, {
            serialize: false,
        });
    }
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
}

function clearDragTarget(state) {
    if (state.dragTargetEl instanceof HTMLElement) {
        state.dragTargetEl.classList.remove("drag-target");
    }
    state.dragTargetEl = null;
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

function renderNodeRows(node) {
    const panel = node.__xlora_panel;
    if (!panel) {
        return;
    }
    const { list, empty, state, tooltip } = panel;
    const prevScrollTop = list.scrollTop;
    const prevScrollLeft = list.scrollLeft;
    clearDragTarget(state);
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
        writeStoredRows(node, rows);
        list.scrollTop = prevScrollTop;
        list.scrollLeft = prevScrollLeft;
        return;
    }
    rows.forEach((item, index) => {
        const row = document.createElement("div");
        row.className = "xlora-row";
        const rowMain = document.createElement("div");
        rowMain.className = "xlora-row-main";
        if (!canDragRow(rows, index)) {
            row.classList.add("locked");
        }
        row.setAttribute("data-index", String(index));
        row.draggable = canDragRow(rows, index);

        if (index === 0 || index === rows.length - 1) {
            const lockBtn = document.createElement("button");
            lockBtn.className = "xlora-lock-btn";
            lockBtn.type = "button";
            if (index === 0) {
                lockBtn.textContent = "⤒";
                lockBtn.title = t("xdatahub.ui.node.xloraget.pin_head", "Pin to top");
                if (item.pin === "head") {
                    lockBtn.classList.add("active");
                }
                lockBtn.addEventListener("click", () => {
                    const wasHead = item.pin === "head";
                    state.rows.forEach((rowItem) => {
                        if (rowItem.pin === "head") {
                            rowItem.pin = "none";
                        }
                    });
                    item.pin = wasHead ? "none" : "head";
                    state.rows = enforcePinLayout(state.rows);
                    writeStoredRows(node, state.rows);
                    renderNodeRows(node);
                });
            } else {
                lockBtn.textContent = "⤓";
                lockBtn.title = t("xdatahub.ui.node.xloraget.pin_tail", "Pin to bottom");
                if (item.pin === "tail") {
                    lockBtn.classList.add("active");
                }
                lockBtn.addEventListener("click", () => {
                    const wasTail = item.pin === "tail";
                    state.rows.forEach((rowItem) => {
                        if (rowItem.pin === "tail") {
                            rowItem.pin = "none";
                        }
                    });
                    item.pin = wasTail ? "none" : "tail";
                    state.rows = enforcePinLayout(state.rows);
                    writeStoredRows(node, state.rows);
                    renderNodeRows(node);
                });
            }
            rowMain.appendChild(lockBtn);
        } else {
            const handle = document.createElement("span");
            handle.className = "xlora-handle";
            handle.textContent = "↕";
            rowMain.appendChild(handle);
        }

        const active = document.createElement("label");
        active.className = "xlora-active";
        const activeInput = document.createElement("input");
        activeInput.type = "checkbox";
        activeInput.checked = item.active !== false;
        activeInput.title = t(
            "xdatahub.ui.node.xloraget.activate",
            "Activate this Lora"
        );
        activeInput.addEventListener("change", () => {
            item.active = !!activeInput.checked;
            writeStoredRows(node, state.rows);
            renderNodeRows(node);
        });
        active.appendChild(activeInput);
        rowMain.appendChild(active);

        if (item.active === false) {
            row.classList.add("inactive");
        }

        const name = document.createElement("span");
        name.className = "xlora-name";
        name.textContent = item.title || item.lora_name;
        bindTooltip(
            name,
            tooltip,
            item.title || item.lora_name,
            item.thumb_url,
            item.lora_note || ""
        );
        rowMain.appendChild(name);

        const controls = document.createElement("div");
        controls.className = "xlora-controls";
        const modelLabel = document.createElement("span");
        modelLabel.className = "xlora-label";
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
            clipLabel.className = "xlora-label";
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
        removeBtn.title = t("xdatahub.ui.node.xloraget.remove", "Remove");
        removeBtn.textContent = "✕";
        removeBtn.addEventListener("click", () => {
            if (state.expandedTriggerRowId === item.id) {
                setExpandedTriggerPanel(node, state, null);
            }
            state.rows.splice(index, 1);
            state.rows = enforcePinLayout(state.rows);
            writeStoredRows(node, state.rows);
            renderNodeRows(node);
        });
        rowMain.appendChild(removeBtn);

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
        triggerRefreshBtn.title = t("xdatahub.ui.node.xloraget.trigger_refresh", "Refresh trigger words and notes from XDataHub");
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
                moreBtn.textContent = expanded
                    ? t("xdatahub.ui.node.xloraget.collapse", "Collapse")
                    : `+${extraCount}`;
                moreBtn.title = expanded
                    ? t("xdatahub.ui.node.xloraget.collapse_title", "Collapse full trigger word list")
                    : t("xdatahub.ui.node.xloraget.expand_title", "Expand {count} more trigger words").replace("{count}", String(extraCount));
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

        row.appendChild(rowMain);
        row.appendChild(triggerRow);

        row.addEventListener("dragstart", (event) => {
            if (!canDragRow(state.rows, index)) {
                event.preventDefault();
                return;
            }
            state.dragIndex = index;
            row.classList.add("dragging");
            if (event.dataTransfer) {
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData(
                    XLORA_ROW_MIME,
                    String(item.id)
                );
            }
        });
        row.addEventListener("dragend", () => {
            state.dragIndex = -1;
            row.classList.remove("dragging");
            clearDragTarget(state);
        });
        row.addEventListener("dragover", (event) => {
            if (state.dragIndex < 0) {
                return;
            }
            event.preventDefault();
            event.stopPropagation();
            clearDragTarget(state);
            state.dragTargetEl = row;
            row.classList.add("drag-target");
            if (event.dataTransfer) {
                event.dataTransfer.dropEffect = "move";
            }
        });
        row.addEventListener("drop", (event) => {
            if (state.dragIndex < 0) {
                return;
            }
            event.preventDefault();
            event.stopPropagation();
            const rect = row.getBoundingClientRect();
            const target = Number(row.getAttribute("data-index") || "-1");
            const insertAfter = event.clientY > (rect.top + rect.height / 2);
            const nextTarget = insertAfter ? target + 1 : target;
            state.rows = moveRowWithLocks(
                state.rows,
                state.dragIndex,
                nextTarget
            );
            state.dragIndex = -1;
            writeStoredRows(node, state.rows);
            renderNodeRows(node);
        });

        list.appendChild(row);
    });
    writeStoredRows(node, rows);
    list.scrollTop = prevScrollTop;
    list.scrollLeft = prevScrollLeft;
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
        if (isInternalRowDrag(event.dataTransfer)) {
            return;
        }
        consume(event);
        list.classList.add("drag-over");
    });
    list.addEventListener("dragover", (event) => {
        if (isInternalRowDrag(event.dataTransfer)) {
            event.preventDefault();
            clearDragTarget(state);
            list.classList.remove("drag-over");
            if (event.dataTransfer) {
                event.dataTransfer.dropEffect = "move";
            }
            return;
        }
        consume(event);
        list.classList.add("drag-over");
        if (event.dataTransfer) {
            event.dataTransfer.dropEffect = "copy";
        }
    });
    list.addEventListener("dragleave", (event) => {
        if (isInternalRowDrag(event.dataTransfer)) {
            return;
        }
        consume(event);
        list.classList.remove("drag-over");
    });
    list.addEventListener("drop", (event) => {
        if (isInternalRowDrag(event.dataTransfer)) {
            event.preventDefault();
            clearDragTarget(state);
            state.rows = moveRowWithLocks(
                state.rows,
                state.dragIndex,
                state.rows.length
            );
            state.dragIndex = -1;
            writeStoredRows(node, state.rows);
            renderNodeRows(node);
            return;
        }
        consume(event);
        list.classList.remove("drag-over");
        const payload = parseDragPayload(event.dataTransfer);
        if (!payload) {
            return;
        }
        const dropKey = `${payload.lora_ref}|${payload.title}|${payload.thumb_url}`;
        const now = Date.now();
        if (
            dropKey === state.lastExternalDropKey
            && now - Number(state.lastExternalDropAt || 0) < 260
        ) {
            return;
        }
        state.lastExternalDropKey = dropKey;
        state.lastExternalDropAt = now;
        upsertLoraRowFromMediaRef(
            node,
            payload.lora_ref,
            payload.title,
            payload.thumb_url,
            payload.strength_model,
            payload.strength_clip,
            "",
            {
                syncStrengthFromRemote: (
                    payload.strength_model == null
                    && payload.strength_clip == null
                ),
            }
        );
    });
}

function applyPanelLocale(panelInfo) {
    if (!panelInfo) {
        return;
    }
    if (panelInfo.toolbarDesc1) {
        panelInfo.toolbarDesc1.textContent = t(
            "xdatahub.ui.node.xloraget.info_desc1",
            "Load order is top-to-bottom; trigger words in the second row can be toggled individually."
        );
    }
    if (panelInfo.toolbarDesc2) {
        panelInfo.toolbarDesc2.textContent = t(
            "xdatahub.ui.node.xloraget.info_desc2",
            "Adjusting Clip strength has no effect when Clip is not connected."
        );
    }
    if (panelInfo.globalToggleText) {
        panelInfo.globalToggleText.textContent = t(
            "xdatahub.ui.node.xloraget.clip_toggle",
            "Separate Clip Strength"
        );
    }
    if (panelInfo.empty) {
        panelInfo.empty.textContent = t(
            "xdatahub.ui.node.xloraget.empty",
            "Drag Lora cards from XDataHub here"
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
            nodeType.prototype.onNodeCreated = function () {
                origCreated?.apply(this, arguments);
                installNodeUi(this);
            };
            nodeType.prototype.onConfigure = function () {
                origConfigure?.apply(this, arguments);
                installNodeUi(this);
                const panel = this.__xlora_panel;
                if (panel) {
                    panel.state.rows = readStoredRows(this);
                    panel.state.globalSeparateClip = readGlobalClipMode(
                        this,
                        panel.state.rows
                    );
                    renderNodeRows(this);
                    syncAllRowTriggerWords(this, { force: true });
                }
            };
        },
        async nodeCreated(node) {
            installNodeUi(node);
        },
        async loadedGraphNode(node) {
            installNodeUi(node);
            const panel = node.__xlora_panel;
            if (panel) {
                panel.state.rows = readStoredRows(node);
                panel.state.globalSeparateClip = readGlobalClipMode(
                    node,
                    panel.state.rows
                );
                renderNodeRows(node);
                syncAllRowTriggerWords(node, { force: true });
            }
            refreshNodeBadge(node);
        },
        async setup() {
            await applyUiLocale();
            installLocaleSync();
            installExistingNodes();
            ROOT.addEventListener("message", (event) => {
                const payload = event?.data;
                if (!payload || typeof payload !== "object") {
                    return;
                }
                if (payload.type === "xdatahub:lora_info_saved") {
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
                        "*"
                    );
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
                        "*"
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
                        data.lora_note || ""
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
