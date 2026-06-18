import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";
import {
    NODE_ACCENT_HEX_DEFAULT,
    getHashedAccentIndex as getNodeAccentIndex,
    getHexAccentFromHashedKey as getNodeAccentColor,
} from "./core/node-accent.js";

const EXT_NAME = "xz3r0.xmediaget";
const EXT_GUARD_KEY = "__xmediaget_extension_registered__";
const ROOT = globalThis;
const STRING_NODE_CLASS = "XStringGet";
const SUPPORTED_NODE_CLASSES = new Set([
    "XVideoGet",
    "XAudioGet",
    "XStringGet",
]);
const NODE_UI_CONFIG = {
    XImageGet: {
        kind: "image",
        emoji: "🖼️",
        placeholderKey: "xdatahub.ui.node.xmediaget.placeholder_image",
        placeholderFallback: "Drop an XDataHub image card here",
        missingKey: "xdatahub.ui.node.xmediaget.missing_image",
        missingFallback: "Image missing",
        titlePlaceholderKey: "xdatahub.ui.node.xmediaget.title_placeholder_media",
        titlePlaceholderFallback: "Filename",
    },
    XVideoGet: {
        kind: "video",
        emoji: "🎞️",
        placeholderKey: "xdatahub.ui.node.xmediaget.placeholder_video",
        placeholderFallback: "Drop an XDataHub video card here",
        missingKey: "xdatahub.ui.node.xmediaget.missing_video",
        missingFallback: "Video missing",
        titlePlaceholderKey: "xdatahub.ui.node.xmediaget.title_placeholder_media",
        titlePlaceholderFallback: "Filename",
    },
    XAudioGet: {
        kind: "audio",
        emoji: "🎵",
        placeholderKey: "xdatahub.ui.node.xmediaget.placeholder_audio",
        placeholderFallback: "Drop an XDataHub audio card here",
        missingKey: "xdatahub.ui.node.xmediaget.missing_audio",
        missingFallback: "Audio missing",
        titlePlaceholderKey: "xdatahub.ui.node.xmediaget.title_placeholder_media",
        titlePlaceholderFallback: "Filename",
    },
    XStringGet: {
        kind: "text",
        emoji: "📝",
        placeholderKey: "xdatahub.ui.node.xmediaget.placeholder_text",
        placeholderFallback: "Drop an XDataHub text card here",
        missingKey: "xdatahub.ui.node.xmediaget.missing_text",
        missingFallback: "Text missing",
        titlePlaceholderKey: "xdatahub.ui.node.xmediaget.title_placeholder",
        titlePlaceholderFallback: "Header",
    },
};
const MEDIA_REF_WIDGET = "media_ref";
const MASK_IMAGE_REF_WIDGET = "mask_image_ref";
const MASK_EDITOR_IMAGE_WIDGET = "image";
const TEXT_VALUE_WIDGET = "text_value";
const TEXT_TITLE_WIDGET = "title_value";
const XDATAHUB_MEDIA_MIME = "application/x-xdatahub-media+json";
const DEFAULT_MIN_NODE_WIDTH = 260;
const DEFAULT_MIN_NODE_HEIGHT = 320;
const IMAGE_GET_MIN_NODE_HEIGHT = 356;
const MEDIA_REF_PROPERTY = "__xdatahub_media_ref";
const MASK_IMAGE_REF_PROPERTY = "__xdatahub_mask_image_ref";
const TEXT_VALUE_PROPERTY = "__xdatahub_text_value";
const TEXT_TITLE_PROPERTY = "__xdatahub_text_title";
const OPEN_MASK_EDITOR_LABEL_KEY = "xdatahub.ui.node.xmediaget.open_mask_editor";
const OPEN_MASK_EDITOR_LABEL_FALLBACK = "Mask";
const MASK_EDITOR_UNAVAILABLE_KEY = "xdatahub.ui.node.xmediaget.mask_editor_unavailable";
const MASK_EDITOR_UNAVAILABLE_FALLBACK = "Mask editor unavailable";
const TEXT_TITLE_PLACEHOLDER_KEY = "xdatahub.ui.node.xmediaget.title_placeholder";
const TEXT_TITLE_PLACEHOLDER_FALLBACK = "Header";
const MASK_EDITOR_CLOSE_POLL_MS = 120;
const MASK_EDITOR_CLOSE_TIMEOUT_MS = 30000;

const STYLE_ID = "xmediaget-extension-style";
const CLEAR_BTN_LABEL_KEY = "xdatahub.ui.node.xmediaget.clear_loaded_media";
const CLEAR_BTN_LABEL_FALLBACK = "Clear loaded media";
const PREVIEW_STATE_EMPTY = "empty";
const PREVIEW_STATE_LOADED = "loaded";
const PREVIEW_STATE_MISSING = "missing";
const COMFY_LOCALE_KEY = "Comfy.Locale";
const LOCALE_SYNC_INTERVAL_MS = 1000;
const TOOLTIP_ID = "xmediaget-global-tooltip";
const TOOLTIP_VIEWPORT_MARGIN = 12;
const TOOLTIP_CURSOR_OFFSET_X = 16;
const TOOLTIP_CURSOR_OFFSET_Y = 26;

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

function t(key, fallback = "") {
    return readUiText(key, fallback || key);
}

function getTooltipElement() {
    let tooltip = document.getElementById(TOOLTIP_ID);
    if (tooltip instanceof HTMLElement) {
        return tooltip;
    }
    tooltip = document.createElement("div");
    tooltip.id = TOOLTIP_ID;
    Object.assign(tooltip.style, {
        position: "fixed",
        zIndex: "999999",
        pointerEvents: "none",
        background: "var(--xdh-color-surface-3)",
        border: "1px solid var(--xdh-clr-hairline, #666)",
        borderRadius: "var(--xdh-radius-sm)",
        padding: "6px 10px",
        maxWidth: "240px",
        boxSizing: "border-box",
        color: "var(--xdh-color-text-primary)",
        boxShadow: "var(--xdh-shadow-popup)",
        fontSize: "12px",
        lineHeight: "1.35",
        whiteSpace: "normal",
        overflowWrap: "break-word",
        wordBreak: "break-word",
        display: "none",
    });
    document.body.appendChild(tooltip);
    return tooltip;
}

function setTooltipText(target, text) {
    if (!(target instanceof HTMLElement)) {
        return;
    }
    const value = String(text || "").trim();
    if (value) {
        target.dataset.xmediagetTooltip = value;
    } else {
        delete target.dataset.xmediagetTooltip;
    }
    target.removeAttribute("title");
}

function readTooltipText(target) {
    if (!(target instanceof HTMLElement)) {
        return "";
    }
    return String(target.dataset.xmediagetTooltip || "").trim();
}

function positionTooltip(tooltip, event) {
    if (!(tooltip instanceof HTMLElement) || !event) {
        return;
    }
    const rect = tooltip.getBoundingClientRect();
    const tooltipWidth = rect.width || tooltip.offsetWidth || 240;
    const tooltipHeight = rect.height || tooltip.offsetHeight || 40;
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

function showTooltip(target, event) {
    const text = readTooltipText(target);
    const tooltip = getTooltipElement();
    if (!text) {
        tooltip.style.display = "none";
        return;
    }
    tooltip.textContent = text;
    tooltip.style.display = "block";
    positionTooltip(tooltip, event);
}

function hideTooltip() {
    const tooltip = document.getElementById(TOOLTIP_ID);
    if (tooltip instanceof HTMLElement) {
        tooltip.style.display = "none";
    }
}

function bindTooltipTarget(target) {
    if (!(target instanceof HTMLElement) || target.__xmediagetTooltipBound) {
        return;
    }
    target.__xmediagetTooltipBound = true;
    target.addEventListener("mouseenter", (event) => {
        showTooltip(target, event);
    });
    target.addEventListener("mousemove", (event) => {
        const tooltip = document.getElementById(TOOLTIP_ID);
        if (tooltip instanceof HTMLElement && tooltip.style.display === "block") {
            positionTooltip(tooltip, event);
        }
    });
    target.addEventListener("mouseleave", () => {
        hideTooltip();
    });
    target.addEventListener("blur", () => {
        hideTooltip();
    });
}

function buildMediaFileUrl(mediaRef) {
    const value = String(mediaRef || "").trim();
    if (!value) {
        return "";
    }
    return `/xz3r0/xdatahub/media/file?ref=${encodeURIComponent(value)}`;
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
    const filename = parts[parts.length - 1];
    const subfolder = parts.slice(0, -1).join("/");
    return {
        filename,
        subfolder,
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

function parseMediaDragPayload(dataTransfer) {
    const raw = dataTransfer?.getData(XDATAHUB_MEDIA_MIME) || "";
    if (!raw) {
        return null;
    }
    try {
        const payload = JSON.parse(raw);
        const source = String(payload?.source || "").trim().toLowerCase();
        const mediaRef = String(payload?.media_ref || "").trim();
        const mediaType = String(payload?.media_type || "").trim().toLowerCase();
        const textValue = String(payload?.text_value || "");
        if (source !== "xdatahub") {
            return null;
        }
        if (!mediaRef && !textValue.trim()) {
            return null;
        }
        return {
            source,
            media_ref: mediaRef,
            media_type: mediaType,
            text_value: textValue,
            title: String(payload?.title || ""),
        };
    } catch {
        return null;
    }
}

async function fetchMediaMeta(mediaRef) {
    const normalized = String(mediaRef || "").trim();
    if (!normalized) {
        return null;
    }
    try {
        const response = await api.fetchApi(
            `/xz3r0/xdatahub/media/meta?ref=${encodeURIComponent(normalized)}`
        );
        if (!response.ok) {
            return null;
        }
        return await response.json();
    } catch {
        return null;
    }
}

function getStoragePropertyName(node) {
    return isStringNode(node) ? TEXT_VALUE_PROPERTY : MEDIA_REF_PROPERTY;
}

function getTextTitlePropertyName(node) {
    return isStringNode(node) ? TEXT_TITLE_PROPERTY : "";
}

function looksLikeMediaRef(value) {
    const raw = String(value || "").trim();
    return /^[A-Za-z0-9_-]{16,}$/.test(raw);
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
            && setting.__xmediagetLocaleHookInstalled !== true) {
            const originalSet = setting.set.bind(setting);
            setting.set = (...args) => {
                const result = originalSet(...args);
                if (String(args[0] || "") === COMFY_LOCALE_KEY) {
                    Promise.resolve(result).finally(refreshLocale);
                }
                return result;
            };
            setting.__xmediagetLocaleHookInstalled = true;
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

function getNodeUiConfig(nodeClass) {
    const key = String(nodeClass || "");
    const config = NODE_UI_CONFIG[key] || NODE_UI_CONFIG.XImageGet;
    return {
        ...config,
        placeholder: t(
            config.placeholderKey,
            config.placeholderFallback ||
            "Drop an XDataHub media card here"
        ),
        missing: t(
            config.missingKey,
            config.missingFallback || "Media missing"
        ),
        titlePlaceholder: t(
            config.titlePlaceholderKey || TEXT_TITLE_PLACEHOLDER_KEY,
            config.titlePlaceholderFallback || TEXT_TITLE_PLACEHOLDER_FALLBACK
        ),
    };
}

function ensureStyles() {
    if (document.getElementById(STYLE_ID)) {
        return;
    }
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
        .ximageget-panel {
            display: flex;
            flex-direction: column;
            gap: 6px;
            padding: 6px 6px 2px 6px;
            width: 100%;
            height: 100%;
            box-sizing: border-box;
        }
        .ximageget-meta {
            display: flex;
            align-items: flex-end;
            gap: 8px;
            min-height: 20px;
        }
        .ximageget-kind-emoji {
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
        .ximageget-kind-emoji-push {
            margin-left: auto;
        }
        .ximageget-mask-btn {
            min-width: 40px;
            height: 22px;
            padding: 0 8px;
            border-radius: var(--xdh-radius-sm);
            border: 1px solid var(--xdh-clr-hairline);
            background: var(--xdh-clr-surface-strong);
            color: var(--xdh-color-text-primary);
            display: inline-flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            font: var(--xdh-font-micro-label);
            line-height: 1;
            transition: border-color 120ms ease, background-color 120ms ease;
            flex: 0 0 auto;
            margin-left: auto;
        }
        .ximageget-mask-btn:hover,
        .ximageget-mask-btn:focus-visible {
            border-color: var(--ximageget-accent);
            background: var(--xdh-clr-surface-strong);
            outline: none;
        }
        .ximageget-mask-btn:disabled {
            opacity: 0.45;
            cursor: not-allowed;
        }
        .ximageget-badge {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            padding: 4px 12px;
            border-radius: var(--xdh-radius-full);
            border: 1px solid var(--ximageget-accent);
            background: var(--xdh-clr-surface-strong);
        }
        .ximageget-badge-chip {
            font-size: 16px;
            line-height: 1;
            font-weight: 700;
            font-variant-numeric: tabular-nums;
            font-family: ui-monospace, "Cascadia Mono", "Consolas", monospace;
            letter-spacing: 0.15px;
            color: var(--ximageget-accent);
        }
        .ximageget-badge-swatch {
            width: 18px;
            height: 18px;
            border-radius: var(--xdh-radius-xs);
            background: var(--ximageget-accent);
            box-shadow: inset 0 0 0 1px var(--xdh-clr-hairline);
        }
        .ximageget-clear-btn {
            width: 22px;
            height: 22px;
            padding: 0;
            border-radius: var(--xdh-radius-sm);
            border: 1px solid var(--xdh-clr-hairline);
            background: var(--xdh-clr-surface-strong);
            color: var(--xdh-color-text-primary);
            display: inline-flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            font: var(--xdh-font-micro-label);
            line-height: 1;
            transition: border-color 120ms ease, background-color 120ms ease;
        }
        .ximageget-clear-btn:hover,
        .ximageget-clear-btn:focus-visible {
            border-color: var(--ximageget-accent);
            background: var(--xdh-clr-surface-strong);
            outline: none;
        }
        .ximageget-clear-btn:active {
            transform: translateY(1px);
        }
        .ximageget-footer {
            display: flex;
            align-items: center;
            gap: 6px;
            flex: 0 0 auto;
            min-height: 24px;
        }
        .ximageget-preview {
            width: 100%;
            min-height: 180px;
            border: 1px solid var(--xdh-clr-hairline);
            background: var(--xdh-clr-surface-card);
            position: relative;
            display: flex;
            align-items: center;
            justify-content: center;
            overflow: hidden;
            flex: 1 1 auto;
        }
        .ximageget-preview.drag-over {
            border-color: var(--xdh-brand-pink);
            box-shadow: 0 0 0 1px var(--xdh-brand-pink);
        }
        .ximageget-preview img {
            width: 100%;
            height: 100%;
            object-fit: contain;
            display: none;
        }
        .ximageget-preview video {
            width: 100%;
            height: 100%;
            object-fit: contain;
            display: none;
            background: var(--xdh-clr-surface-card, #000);
        }
        .ximageget-preview audio {
            width: calc(100% - 16px);
            max-width: 420px;
            display: none;
        }
        .ximageget-preview .ximageget-text-preview {
            display: none;
            width: calc(100% - 16px);
            height: calc(100% - 16px);
            margin: 8px;
            padding: 10px 12px;
            border-radius: var(--xdh-radius-sm);
            border: 1px solid var(--xdh-clr-hairline);
            background: var(--xdh-clr-surface-strong);
            color: var(--xdh-color-text-primary);
            font-size: 13px;
            line-height: 1.45;
            white-space: pre-wrap;
            word-break: break-word;
            overflow: auto;
            user-select: text;
            resize: none;
            outline: none;
            font-family: inherit;
            scrollbar-color: var(--xdh-scrollbar-thumb, #555) var(--xdh-scrollbar-track, transparent);
        }
        .ximageget-preview .ximageget-text-preview::-webkit-scrollbar {
            width: 10px;
        }
        .ximageget-preview .ximageget-text-preview::-webkit-scrollbar-track {
            background: var(--xdh-scrollbar-track, transparent);
        }
        .ximageget-preview .ximageget-text-preview::-webkit-scrollbar-thumb {
            background: var(--xdh-scrollbar-thumb, #555);
            border-radius: 4px;
        }
        .ximageget-preview .ximageget-text-preview::-webkit-scrollbar-thumb:hover {
            background: var(--xdh-scrollbar-thumb-hover, #777);
        }
        .ximageget-preview.is-text .ximageget-text-preview {
            display: block;
        }
        .ximageget-preview.is-text.is-empty-text .ximageget-text-preview {
            text-align: center;
        }
        .ximageget-preview.is-text .ximageget-text-preview:focus {
            border-color: var(--xdh-brand-pink);
            box-shadow: 0 0 0 1px var(--xdh-brand-pink);
        }
        .ximageget-preview.is-text .ximageget-text-preview::placeholder {
            color: var(--xdh-color-text-secondary);
            text-align: center;
        }
        .ximageget-preview.has-media img,
        .ximageget-preview.has-media video,
        .ximageget-preview.has-media audio,
        .ximageget-preview.has-media .ximageget-text-preview {
            display: block;
        }
        .ximageget-preview.has-media .xmg-video-player {
            display: flex;
        }
        .ximageget-preview.has-media .xmg-audio-player {
            display: flex;
        }
        .ximageget-placeholder {
            position: absolute;
            left: 50%;
            top: 50%;
            transform: translate(-50%, -50%);
            font: var(--xdh-font-caption-sm);
            color: var(--xdh-color-text-primary);
            font-weight: 600;
            opacity: 1;
            width: calc(100% - 24px);
            max-width: 220px;
            text-align: center;
            line-height: 1.45;
            pointer-events: none;
        }
        .ximageget-placeholder:empty {
            display: none;
        }
        .ximageget-title {
            font: var(--xdh-font-micro-label);
            color: var(--xdh-color-text-primary);
            opacity: 1;
            user-select: text;
            cursor: text;
            background: var(--xdh-clr-surface-soft);
            padding: var(--xdh-space-xs) var(--xdh-space-sm);
            border-radius: var(--xdh-radius-sm);
            min-height: 24px;
            display: block;
            flex: 1 1 auto;
            min-width: 0;
            border: 1px solid transparent;
            outline: none;
            font-family: inherit;
            line-height: 1.3;
        }
        .ximageget-title::placeholder {
            color: var(--xdh-color-text-secondary);
        }
        .ximageget-title:focus {
            border-color: var(--xdh-brand-pink);
            box-shadow: 0 0 0 1px var(--xdh-brand-pink);
        }

        /* ============================
           Custom Audio Player (xmg-*)
           ============================ */
        .xmg-audio-player {
            display: none;
            flex-direction: column;
            gap: 6px;
            width: 100%;
            height: 100%;
            box-sizing: border-box;
            padding: 8px;
        }
        .xmg-audio-play-btn {
            width: 36px;
            height: 36px;
            flex: 0 0 36px;
            align-self: center;
            padding: 0;
            border: 1px solid var(--xdh-clr-hairline);
            border-radius: 50%;
            background: var(--xdh-clr-surface-card);
            color: var(--xdh-color-text-primary);
            font-size: 14px;
            line-height: 1;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            box-shadow: var(--xdh-shadow-default, none);
            transition: background 0.12s ease, transform 0.12s ease, box-shadow 0.12s ease;
        }
        .xmg-audio-play-btn:hover {
            background: var(--xdh-clr-surface-soft);
            transform: scale(1.08);
            box-shadow: var(--xdh-shadow-popup, 0 2px 12px rgba(0,0,0,0.3));
        }
        .xmg-audio-play-btn:active {
            transform: scale(0.95);
        }
        .xmg-audio-waveform {
            flex: 1 1 auto;
            min-width: 0;
            min-height: 36px;
            border-radius: 8px;
            background: var(--xdh-clr-surface-soft);
            overflow: hidden;
            cursor: pointer;
            position: relative;
        }
        .xmg-audio-waveform[data-loading="true"]::after {
            content: "";
            position: absolute;
            inset: 0;
            opacity: 1;
            pointer-events: none;
            background: linear-gradient(90deg, transparent 0%, var(--xdh-clr-hairline) 50%, transparent 100%);
            animation: xmg-wave-sheen 1.2s linear infinite;
        }
        @keyframes xmg-wave-sheen {
            from { transform: translateX(-100%); }
            to { transform: translateX(100%); }
        }
        .xmg-audio-waveform-canvas {
            width: 100%;
            height: 100%;
            display: block;
        }
        .xmg-audio-bottom {
            display: flex;
            align-items: center;
            gap: 4px;
            flex: 0 0 auto;
            min-height: 18px;
            width: 100%;
        }
        .xmg-audio-time {
            font-size: 10px;
            line-height: 1.3;
            color: var(--xdh-color-text-secondary);
            font-variant-numeric: tabular-nums;
            font-family: ui-monospace, "Cascadia Mono", "Consolas", monospace;
            white-space: nowrap;
        }
        .xmg-audio-volume-btn {
            width: 20px;
            height: 20px;
            flex: 0 0 20px;
            padding: 0;
            border: none;
            background: transparent;
            color: var(--xdh-color-text-primary);
            font-size: 12px;
            line-height: 1;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            margin-left: auto;
        }
        .xmg-audio-volume-range {
            width: 48px;
            min-width: 0;
            margin: 0;
            padding: 0;
            appearance: none;
            background: transparent;
            cursor: pointer;
            height: 14px;
            flex: 0 0 auto;
        }
        .xmg-audio-volume-range::-webkit-slider-runnable-track {
            height: 3px;
            border-radius: 999px;
            background: var(--xdh-clr-hairline);
        }
        .xmg-audio-volume-range::-webkit-slider-thumb {
            appearance: none;
            width: 10px;
            height: 10px;
            margin-top: -3.5px;
            border-radius: 50%;
            background: var(--xdh-color-text-primary);
            cursor: pointer;
            border: none;
        }
        .xmg-audio-volume-range::-moz-range-track {
            height: 3px;
            border: 0;
            border-radius: 999px;
            background: var(--xdh-clr-hairline);
        }
        .xmg-audio-volume-range::-moz-range-thumb {
            width: 10px;
            height: 10px;
            border-radius: 50%;
            background: var(--xdh-color-text-primary);
            cursor: pointer;
            border: none;
        }
        .xmg-audio-volume-value {
            font-size: 10px;
            color: var(--xdh-color-text-secondary);
            line-height: 1.3;
            min-width: 28px;
            text-align: right;
            font-variant-numeric: tabular-nums;
            font-family: ui-monospace, "Cascadia Mono", "Consolas", monospace;
        }
        .xmg-audio-volume-lock {
            width: 16px;
            height: 16px;
            flex: 0 0 16px;
            padding: 0;
            border: none;
            background: transparent;
            color: var(--xdh-color-text-secondary);
            font-size: 9px;
            line-height: 1;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            opacity: 0.5;
            transition: opacity 0.12s ease;
        }
        .xmg-audio-volume-lock:hover {
            opacity: 1;
        }
        .xmg-audio-volume-lock.is-active {
            opacity: 1;
            color: var(--xdh-clr-surface-card, #fff);
            background: var(--xdh-color-primary);
            box-shadow: inset 0 0 0 1px var(--xdh-color-primary);
            border-radius: 2px;
        }
        .xmg-audio-el {
            position: absolute;
            width: 1px;
            height: 1px;
            opacity: 0;
            pointer-events: none;
            left: -9999px;
            top: 0;
            display: block !important;
        }

        /* ============================
           Custom Video Player (xmg-*)
           ============================ */
        .xmg-video-player {
            width: 100%;
            height: 100%;
            position: relative;
            display: none;
            flex-direction: column;
            background: var(--xdh-clr-surface-card, #000);
        }
        .xmg-video-el {
            width: 100%;
            flex: 1 1 auto;
            min-height: 0;
            display: block !important;
            object-fit: contain;
            background: var(--xdh-clr-surface-card, #000);
        }
        .xmg-video-content-area {
            position: relative;
            flex: 1 1 auto;
            min-height: 0;
            overflow: hidden;
        }
        .xmg-video-overlay {
            position: absolute;
            inset: 0;
            display: flex;
            align-items: center;
            justify-content: center;
            pointer-events: none;
            z-index: 2;
        }
        .xmg-video-overlay-btn {
            width: 48px;
            height: 48px;
            padding: 0;
            border: 1px solid var(--xdh-clr-hairline);
            border-radius: 50%;
            background: var(--xdh-clr-surface-card);
            color: var(--xdh-color-text-primary);
            font-size: 20px;
            line-height: 1;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            pointer-events: auto;
            box-shadow: var(--xdh-shadow-default, none);
            transition: background 0.15s ease, transform 0.15s ease, box-shadow 0.15s ease;
        }
        .xmg-video-overlay-btn:hover {
            background: var(--xdh-clr-surface-soft);
            transform: scale(1.08);
            box-shadow: var(--xdh-shadow-popup, 0 2px 12px rgba(0,0,0,0.3));
        }
        .xmg-video-overlay-btn:active {
            transform: scale(0.95);
        }
        .xmg-video-controls {
            display: flex;
            align-items: center;
            gap: 4px;
            padding: 2px 6px;
            flex: 0 0 auto;
            min-height: 22px;
            background: var(--xdh-clr-surface-card);
            border-top: 1px solid var(--xdh-clr-hairline);
        }
        .xmg-video-progress-row {
            width: 100%;
            flex: 0 0 auto;
            padding: 0 6px;
            box-sizing: border-box;
        }
        .xmg-video-progress-wrap {
            width: 100%;
            height: 14px;
            display: flex;
            align-items: center;
            cursor: pointer;
        }
        .xmg-video-progress {
            width: 100%;
            margin: 0;
            padding: 0;
            appearance: none;
            background: transparent;
            cursor: pointer;
            height: 14px;
        }
        .xmg-video-progress::-webkit-slider-runnable-track {
            height: 3px;
            border-radius: 999px;
            background: var(--xdh-clr-hairline);
        }
        .xmg-video-progress::-webkit-slider-thumb {
            appearance: none;
            width: 10px;
            height: 10px;
            margin-top: -3.5px;
            border-radius: 50%;
            background: var(--xdh-color-text-primary, #fff);
            cursor: pointer;
            border: none;
        }
        .xmg-video-progress::-moz-range-track {
            height: 3px;
            border: 0;
            border-radius: 999px;
            background: var(--xdh-clr-hairline);
        }
        .xmg-video-progress::-moz-range-thumb {
            width: 10px;
            height: 10px;
            border-radius: 50%;
            background: var(--xdh-color-text-primary, #fff);
            cursor: pointer;
            border: none;
        }
        .xmg-video-time {
            font-size: 10px;
            color: var(--xdh-color-text-secondary);
            line-height: 1.3;
            font-variant-numeric: tabular-nums;
            font-family: ui-monospace, "Cascadia Mono", "Consolas", monospace;
            white-space: nowrap;
            flex: 0 0 auto;
        }
        .xmg-video-volume-btn {
            width: 18px;
            height: 18px;
            flex: 0 0 18px;
            padding: 0;
            border: none;
            background: transparent;
            color: var(--xdh-color-text-secondary);
            font-size: 11px;
            line-height: 1;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            margin-left: auto;
        }
        .xmg-video-volume-range {
            width: 40px;
            margin: 0;
            padding: 0;
            appearance: none;
            background: transparent;
            cursor: pointer;
            height: 14px;
            flex: 0 0 auto;
        }
        .xmg-video-volume-range::-webkit-slider-runnable-track {
            height: 3px;
            border-radius: 999px;
            background: var(--xdh-clr-hairline);
        }
        .xmg-video-volume-range::-webkit-slider-thumb {
            appearance: none;
            width: 10px;
            height: 10px;
            margin-top: -3.5px;
            border-radius: 50%;
            background: var(--xdh-color-text-primary, #fff);
            cursor: pointer;
            border: none;
        }
        .xmg-video-volume-range::-moz-range-track {
            height: 3px;
            border: 0;
            border-radius: 999px;
            background: var(--xdh-clr-hairline);
        }
        .xmg-video-volume-range::-moz-range-thumb {
            width: 10px;
            height: 10px;
            border-radius: 50%;
            background: var(--xdh-color-text-primary, #fff);
            cursor: pointer;
            border: none;
        }
        .xmg-video-volume-value {
            font-size: 10px;
            color: var(--xdh-color-text-secondary);
            line-height: 1.3;
            min-width: 24px;
            text-align: right;
            font-variant-numeric: tabular-nums;
            font-family: ui-monospace, "Cascadia Mono", "Consolas", monospace;
        }
        .xmg-video-volume-lock {
            width: 16px;
            height: 16px;
            flex: 0 0 16px;
            padding: 0;
            border: none;
            background: transparent;
            color: var(--xdh-color-text-secondary);
            font-size: 9px;
            line-height: 1;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            opacity: 0.5;
            transition: opacity 0.12s ease;
        }
        .xmg-video-volume-lock:hover {
            opacity: 1;
        }
        .xmg-video-volume-lock.is-active {
            opacity: 1;
            color: var(--xdh-clr-surface-card, #fff);
            background: var(--xdh-color-primary);
            box-shadow: inset 0 0 0 1px var(--xdh-color-primary);
            border-radius: 2px;
        }

        /* Loop toggle button (audio + video) */
        .xmg-audio-loop-btn,
        .xmg-video-loop-btn {
            flex: 0 0 0px;
            height: 16px;
            padding: 0;
            border: none;
            background: transparent;
            color: var(--xdh-color-text-secondary);
            font-size: 11px;
            line-height: 1;
            display: inline-flex;
            align-items: center;
            justify-content: flex-start;
            cursor: pointer;
            opacity: 0.5;
            transition: opacity 0.12s ease, color 0.12s ease;
        }
        .xmg-audio-loop-btn:hover,
        .xmg-video-loop-btn:hover {
            opacity: 1;
        }
        .xmg-audio-loop-btn.is-active,
        .xmg-video-loop-btn.is-active {
            opacity: 1;
            color: var(--xdh-clr-surface-card, #fff);
            background: var(--xdh-color-primary);
            box-shadow: inset 0 0 0 1px var(--xdh-color-primary);
            border-radius: 2px;
        }
    `;
    document.head.appendChild(style);
}

/* ==========================================================
   Custom Player — Audio (compact waveform player)
   ========================================================== */

function xmgClamp(value, min, max) {
    return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}

/* Global theme observer — redraws all audio waveforms on data-theme change */
var XMG_WAVEFORM_CALLBACKS = new Set();
var XMG_THEME_OBSERVER = null;
var XMG_THEME_CONTEXT_LISTENER_INSTALLED = false;
function xmgEnsureThemeObserver() {
    if (XMG_THEME_OBSERVER) return;
    XMG_THEME_OBSERVER = new MutationObserver(function () {
        XMG_WAVEFORM_CALLBACKS.forEach(function (fn) { fn(); });
    });
    XMG_THEME_OBSERVER.observe(document.body, { attributes: true, attributeFilter: ["data-theme"] });
    if (!XMG_THEME_CONTEXT_LISTENER_INSTALLED) {
        XMG_THEME_CONTEXT_LISTENER_INSTALLED = true;
        document.addEventListener("xdatahub:theme-context-applied", function () {
            XMG_WAVEFORM_CALLBACKS.forEach(function (fn) { fn(); });
        });
    }
}

const XMG_AUDIO_BAR_COUNT = 3000;
const XMG_AUDIO_VOLUME_NORMAL = 100;
const XMG_AUDIO_VOLUME_MAX = 300;
const XMG_AUDIO_WAVEFORM_CACHE = new Map();

function xmgApplyVolume(mediaEl, gainNode, percent) {
    const clamped = Math.max(0, Math.min(XMG_AUDIO_VOLUME_MAX, Number.isFinite(percent) ? percent : XMG_AUDIO_VOLUME_NORMAL));
    mediaEl.volume = Math.min(clamped, XMG_AUDIO_VOLUME_NORMAL) / XMG_AUDIO_VOLUME_NORMAL;
    if (gainNode) {
        gainNode.gain.value = clamped > XMG_AUDIO_VOLUME_NORMAL
            ? clamped / XMG_AUDIO_VOLUME_NORMAL
            : 1;
    }
    return clamped;
}

function xmgFormatTime(value) {
    const totalSeconds = Math.max(0, Math.floor(Number.isFinite(value) ? value : 0));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function xmgHashText(value) {
    let hash = 2166136261;
    for (const char of String(value || "")) {
        hash ^= char.charCodeAt(0);
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
}

function xmgBuildFallbackPeaks(seedText, count) {
    count = count || XMG_AUDIO_BAR_COUNT;
    let seed = xmgHashText(seedText) || 1;
    return Array.from({ length: count }, (_, index) => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        const noise = ((seed >>> 8) & 0xffff) / 0xffff;
        const envelope = 0.42 + (Math.sin((index / count) * Math.PI * 3.5) * 0.18);
        return Math.min(1, Math.max(0.12, (noise * 0.55) + envelope));
    });
}

function xmgNormalizePeaks(audioBuffer, barCount) {
    barCount = barCount || XMG_AUDIO_BAR_COUNT;
    const totalFrames = Math.max(1, audioBuffer?.length || 0);
    const totalChannels = Math.max(1, audioBuffer?.numberOfChannels || 1);
    const sampleSize = Math.max(1, Math.floor(totalFrames / barCount));
    const peaks = new Array(barCount).fill(0);
    for (let index = 0; index < barCount; index += 1) {
        const start = index * sampleSize;
        const end = Math.min(totalFrames, start + sampleSize);
        const stride = Math.max(1, Math.floor((end - start) / 32));
        let peak = 0;
        for (let channel = 0; channel < totalChannels; channel += 1) {
            const data = audioBuffer.getChannelData(channel);
            for (let cursor = start; cursor < end; cursor += stride) {
                peak = Math.max(peak, Math.abs(data[cursor] || 0));
            }
            if (end > start) {
                peak = Math.max(peak, Math.abs(data[end - 1] || 0));
            }
        }
        peaks[index] = peak;
    }
    const maxPeak = peaks.reduce((mv, v) => Math.max(mv, v), 0);
    if (maxPeak <= 1e-6) return xmgBuildFallbackPeaks("", barCount);
    return peaks.map(v => Math.min(1, Math.max(0.08, v / maxPeak)));
}

function xmgGetAudioDecodeContext() {
    if (xmgGetAudioDecodeContext._ctx) return xmgGetAudioDecodeContext._ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    xmgGetAudioDecodeContext._ctx = new AC();
    return xmgGetAudioDecodeContext._ctx;
}

async function xmgLoadWaveformPeaks(url) {
    const key = String(url || "").trim();
    if (!key) return xmgBuildFallbackPeaks("", XMG_AUDIO_BAR_COUNT);
    const cached = XMG_AUDIO_WAVEFORM_CACHE.get(key);
    if (cached) return cached;
    const ctx = xmgGetAudioDecodeContext();
    if (!ctx) return xmgBuildFallbackPeaks(key, XMG_AUDIO_BAR_COUNT);
    try {
        const response = await fetch(key, { cache: "force-cache" });
        if (!response.ok) return xmgBuildFallbackPeaks(key, XMG_AUDIO_BAR_COUNT);
        const arrayBuffer = await response.arrayBuffer();
        let audioBuffer;
        try {
            audioBuffer = await ctx.decodeAudioData(arrayBuffer.slice(0));
        } catch {
            return xmgBuildFallbackPeaks(key, XMG_AUDIO_BAR_COUNT);
        }
        const peaks = xmgNormalizePeaks(audioBuffer, XMG_AUDIO_BAR_COUNT);
        XMG_AUDIO_WAVEFORM_CACHE.set(key, peaks);
        return peaks;
    } catch {
        return xmgBuildFallbackPeaks(key, XMG_AUDIO_BAR_COUNT);
    }
}

function xmgDrawAudioWaveform(canvas, peaks, progress, width, height) {
    if (!(canvas instanceof HTMLCanvasElement)) return;
    if (!width || !height) return;
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const pw = Math.floor(width * dpr);
    const ph = Math.floor(height * dpr);
    if (canvas.width !== pw || canvas.height !== ph) {
        canvas.width = pw;
        canvas.height = ph;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);
    // Resolve actual theme text color (CSS var → computed value)
    const _probe = document.createElement("div");
    _probe.style.cssText = "position:absolute;visibility:hidden;color:var(--xdh-color-text-primary)";
    document.body.appendChild(_probe);
    const playedColor = getComputedStyle(_probe).color || "#ffffff";
    document.body.removeChild(_probe);
    // Idle (unplayed) = played color at ~20% opacity
    const idleColor = playedColor.replace(")", ",0.2)").replace("rgb(", "rgba(");
    const p = Math.min(1, Math.max(0, progress || 0));

    // Bar count = span / desired-bar-pitch — so bar thickness stays consistent
    // at any window width. More width = more bars, same thickness.
    const gap = 1;
    const PX_PER_BAR = 2.5;
    const targetCount = Math.max(20, Math.min(peaks.length, Math.floor(width / PX_PER_BAR)));
    const totalGap = (targetCount - 1) * gap;
    const barSpace = Math.max(1, Math.floor((width - totalGap) / targetCount));
    const leftover = Math.max(0, (width - totalGap) - barSpace * targetCount);

    const srcStride = peaks.length / targetCount;
    let cursorX = 0;
    let playedEndX = 0;
    for (let i = 0; i < targetCount; i++) {
        const sStart = Math.floor(i * srcStride);
        const sEnd = Math.max(sStart + 1, Math.floor((i + 1) * srcStride));
        let peak = 0;
        for (let c = sStart; c < sEnd; c++) peak = Math.max(peak, peaks[c] || 0);
        const barW = barSpace + (i < leftover ? 1 : 0);
        const barH = Math.max(4, Math.round((height - 6) * peak));
        const x = cursorX;
        const y = Math.floor((height - barH) / 2);
        const thresh = (i + 1) / targetCount;
        ctx.fillStyle = thresh <= p ? playedColor : idleColor;
        ctx.fillRect(x, y, barW, barH);
        cursorX += barW + gap;
        if (thresh <= p) playedEndX = cursorX;
    }

    if (p > 0 && p < 1) {
        const px = Math.max(0, Math.min(Math.floor(playedEndX), width - 2));
        ctx.fillStyle = playedColor;
        ctx.fillRect(px, 3, 2, Math.max(height - 6, 0));
    }
}

function xmgBuildAudioPlayer() {
    const container = document.createElement("div");
    container.className = "xmg-audio-player";

    // Hidden audio element
    const audio = document.createElement("audio");
    audio.preload = "metadata";
    audio.controls = false;
    audio.className = "xmg-audio-el";
    container.appendChild(audio);

    // Gain graph for volume amplification (>100%)
    let audioGainNode = null;
    try {
        const ac = new (window.AudioContext || window.webkitAudioContext)();
        const src = ac.createMediaElementSource(audio);
        const gn = ac.createGain();
        src.connect(gn);
        gn.connect(ac.destination);
        audioGainNode = gn;
        // Resume context on first user interaction
        const resumeCtx = function () { if (ac.state === "suspended") ac.resume(); document.removeEventListener("pointerdown", resumeCtx); };
        document.addEventListener("pointerdown", resumeCtx, { once: true });
    } catch {}
    const maxOutputLevel = audioGainNode ? XMG_AUDIO_VOLUME_MAX : XMG_AUDIO_VOLUME_NORMAL;

    // Play button (centered above waveform)
    const playBtn = document.createElement("button");
    playBtn.type = "button";
    playBtn.className = "xmg-audio-play-btn";
    playBtn.textContent = "▶";
    playBtn.setAttribute("aria-label", "Play");
    setTooltipText(playBtn, t("xdatahub.ui.node.xmediaget.player_play", "Play"));
    bindTooltipTarget(playBtn);
    container.appendChild(playBtn);

    // Waveform (fills remaining height)
    const waveformWrap = document.createElement("div");
    waveformWrap.className = "xmg-audio-waveform";
    const canvas = document.createElement("canvas");
    canvas.className = "xmg-audio-waveform-canvas";
    waveformWrap.appendChild(canvas);
    container.appendChild(waveformWrap);
    setTooltipText(waveformWrap, t("xdatahub.ui.node.xmediaget.player_seek", "Seek"));
    bindTooltipTarget(waveformWrap);

    // Bottom row: time + volume
    const bottomRow = document.createElement("div");
    bottomRow.className = "xmg-audio-bottom";

    const timeEl = document.createElement("span");
    timeEl.className = "xmg-audio-time";
    timeEl.textContent = "0:00 / 0:00";

    const volumeBtn = document.createElement("button");
    volumeBtn.type = "button";
    volumeBtn.className = "xmg-audio-volume-btn";
    volumeBtn.textContent = "🔊";
    volumeBtn.setAttribute("aria-label", "Mute");
    setTooltipText(volumeBtn, t("xdatahub.ui.node.xmediaget.player_mute", "Mute"));
    bindTooltipTarget(volumeBtn);

    const volumeRange = document.createElement("input");
    volumeRange.type = "range";
    volumeRange.className = "xmg-audio-volume-range";
    volumeRange.min = "0";
    volumeRange.max = String(XMG_AUDIO_VOLUME_NORMAL);
    volumeRange.step = "1";
    volumeRange.value = String(XMG_AUDIO_VOLUME_NORMAL);
    setTooltipText(volumeRange, t("xdatahub.ui.node.xmediaget.player_volume", "Volume"));
    bindTooltipTarget(volumeRange);

    const volumeValue = document.createElement("span");
    volumeValue.className = "xmg-audio-volume-value";
    volumeValue.textContent = "100%";

    // Volume boost lock toggle
    const lockBtn = document.createElement("button");
    lockBtn.type = "button";
    lockBtn.className = "xmg-audio-volume-lock";
    lockBtn.textContent = "🔒";
    lockBtn.setAttribute("aria-label", "Unlock volume boost");
    setTooltipText(lockBtn, t("xdatahub.ui.node.xmediaget.player_volume_unlock", "Unlock volume boost"));
    bindTooltipTarget(lockBtn);
    lockBtn.addEventListener("click", function () {
        var unlock = !state._volumeUnlocked;
        state._volumeUnlocked = unlock;
        lockBtn.classList.toggle("is-active", unlock);
        lockBtn.textContent = unlock ? "🔓" : "🔒";
        lockBtn.setAttribute("aria-label", unlock ? "Lock volume boost" : "Unlock volume boost");
        setTooltipText(lockBtn, t(unlock ? "xdatahub.ui.node.xmediaget.player_volume_lock" : "xdatahub.ui.node.xmediaget.player_volume_unlock", unlock ? "Lock volume boost" : "Unlock volume boost"));
        var cur = Number(volumeRange.value);
        if (!unlock && cur > XMG_AUDIO_VOLUME_NORMAL) {
            // Clamp back to normal when locking
            volumeRange.value = String(XMG_AUDIO_VOLUME_NORMAL);
            xmgApplyVolume(audio, audioGainNode, XMG_AUDIO_VOLUME_NORMAL);
            audio.muted = false;
            if (XMG_AUDIO_VOLUME_NORMAL > 0) state._lastVol = XMG_AUDIO_VOLUME_NORMAL;
        }
        volumeRange.max = unlock ? String(XMG_AUDIO_VOLUME_MAX) : String(XMG_AUDIO_VOLUME_NORMAL);
        sync();
    });
    lockBtn.style.display = audioGainNode ? "" : "none";

    // Loop toggle button
    const loopBtn = document.createElement("button");
    loopBtn.type = "button";
    loopBtn.className = "xmg-audio-loop-btn";
    loopBtn.textContent = "\uD83D\uDD01";
    loopBtn.setAttribute("aria-label", "Loop playback");
    setTooltipText(loopBtn, t("xdatahub.ui.node.xmediaget.player_loop", "Loop playback"));
    bindTooltipTarget(loopBtn);
    loopBtn.addEventListener("click", function () {
        audio.loop = !audio.loop;
        loopBtn.classList.toggle("is-active", audio.loop);
        loopBtn.setAttribute("aria-label", audio.loop ? "Loop enabled" : "Loop playback");
        setTooltipText(loopBtn, t(audio.loop ? "xdatahub.ui.node.xmediaget.player_loop_enabled" : "xdatahub.ui.node.xmediaget.player_loop", audio.loop ? "Loop enabled" : "Loop playback"));
    });

    bottomRow.appendChild(timeEl);
    bottomRow.appendChild(loopBtn);
    bottomRow.appendChild(volumeBtn);
    bottomRow.appendChild(volumeRange);
    bottomRow.appendChild(volumeValue);
    bottomRow.appendChild(lockBtn);
    container.appendChild(bottomRow);

    // State
    const state = {
        audio,
        playBtn,
        loopBtn,
        lockBtn,
        waveform: waveformWrap,
        canvas,
        timeEl,
        volumeBtn,
        volumeRange,
        volumeValue,
        peaks: [],
        progress: 0,
        loading: false,
        disposed: false,
        rafId: 0,
        _mouseEntered: false,
        _volumeUnlocked: false,
    };

    function draw() {
        const rect = waveformWrap.getBoundingClientRect();
        xmgDrawAudioWaveform(canvas, state.peaks, state.progress, rect.width, rect.height);
    }

    function sync() {
        if (state.disposed) return;
        const dur = Number.isFinite(audio.duration) ? audio.duration : 0;
        const ct = dur > 0 ? Math.min(Math.max(audio.currentTime, 0), dur) : 0;
        const playing = !audio.paused && !audio.ended;
        const pct = dur > 0 ? ct / dur : 0;
        state.progress = pct;
        timeEl.textContent = xmgFormatTime(ct) + " / " + xmgFormatTime(dur);
        playBtn.textContent = playing ? "⏸" : "▶";
        playBtn.setAttribute("aria-label", playing
            ? t("xdatahub.ui.node.xmediaget.player_pause", "Pause")
            : t("xdatahub.ui.node.xmediaget.player_play", "Play"));
        setTooltipText(playBtn, playing
            ? t("xdatahub.ui.node.xmediaget.player_pause", "Pause")
            : t("xdatahub.ui.node.xmediaget.player_play", "Play"));

        const volRaw = Number(volumeRange.value);
        var curMax = state._volumeUnlocked ? XMG_AUDIO_VOLUME_MAX : XMG_AUDIO_VOLUME_NORMAL;
        const vol = Math.round(xmgClamp(Number.isFinite(volRaw) ? volRaw : XMG_AUDIO_VOLUME_NORMAL, 0, curMax));
        volumeValue.textContent = vol + "%";
        volumeBtn.textContent = vol <= 0 ? "🔇" : "🔊";
        volumeBtn.setAttribute("aria-label", vol <= 0
            ? t("xdatahub.ui.node.xmediaget.player_unmute", "Unmute")
            : t("xdatahub.ui.node.xmediaget.player_mute", "Mute"));
        setTooltipText(volumeBtn, vol <= 0
            ? t("xdatahub.ui.node.xmediaget.player_unmute", "Unmute")
            : t("xdatahub.ui.node.xmediaget.player_mute", "Mute"));
        setTooltipText(waveformWrap, t("xdatahub.ui.node.xmediaget.player_seek", "Seek"));
        setTooltipText(volumeRange, t("xdatahub.ui.node.xmediaget.player_volume", "Volume"));
        setTooltipText(lockBtn, t(state._volumeUnlocked
            ? "xdatahub.ui.node.xmediaget.player_volume_lock"
            : "xdatahub.ui.node.xmediaget.player_volume_unlock",
            state._volumeUnlocked ? "Lock volume boost" : "Unlock volume boost"));
        setTooltipText(loopBtn, t(audio.loop
            ? "xdatahub.ui.node.xmediaget.player_loop_enabled"
            : "xdatahub.ui.node.xmediaget.player_loop",
            audio.loop ? "Loop enabled" : "Loop playback"));
        waveformWrap.dataset.loading = state.loading ? "true" : "false";

        draw();

        if (playing) {
            if (!state.rafId) {
                state.rafId = requestAnimationFrame(function tick() {
                    state.rafId = 0;
                    if (!state.disposed) sync();
                });
            }
        } else {
            if (state.rafId) {
                cancelAnimationFrame(state.rafId);
                state.rafId = 0;
            }
        }
    }

    // Event: play/pause
    playBtn.addEventListener("click", function () {
        if (audio.paused || audio.ended) {
            audio.play().catch(function () {});
        } else {
            audio.pause();
        }
    });

    // Event: seek on waveform click (bar-index-aware, not linear pixel ratio)
    waveformWrap.addEventListener("click", function (e) {
        const rect = waveformWrap.getBoundingClientRect();
        const dur = Number.isFinite(audio.duration) ? audio.duration : 0;
        if (!rect.width || dur <= 0) return;
        const relX = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
        // Find bar index from pixel position (accounts for leftover 1px distribution)
        const w = rect.width;
        const barCnt = Math.max(20, Math.min(state.peaks.length, Math.floor(w / 2.5)));
        const gap = 1;
        const totalG = (barCnt - 1) * gap;
        const bSpace = Math.max(1, Math.floor((w - totalG) / barCnt));
        const leftOver = Math.max(0, (w - totalG) - bSpace * barCnt);
        const targetPx = relX * w;
        let cumX = 0;
        let barIdx = 0;
        for (let i = 0; i < barCnt; i++) {
            const bw = bSpace + (i < leftOver ? 1 : 0);
            const nx = cumX + bw + gap;
            if (nx > targetPx) { barIdx = i; break; }
            cumX = nx;
            barIdx = i + 1;
        }
        const ratio = Math.min(1, Math.max(0, barIdx / barCnt));
        audio.currentTime = dur * ratio;
        sync();
    });

    // Event: volume (mute toggle with restore, supports amplification)
    volumeBtn.addEventListener("click", function () {
        const cur = Number(volumeRange.value);
        if (cur > 0) {
            state._lastVol = xmgClamp(cur, 0, state._volumeUnlocked ? XMG_AUDIO_VOLUME_MAX : XMG_AUDIO_VOLUME_NORMAL);
            const clamped = xmgApplyVolume(audio, audioGainNode, 0);
            volumeRange.value = "0";
            audio.muted = true;
        } else {
            const restore = state._lastVol > 0 ? state._lastVol : XMG_AUDIO_VOLUME_NORMAL;
            volumeRange.value = String(restore);
            const clamped = xmgApplyVolume(audio, audioGainNode, restore);
            audio.muted = false;
        }
        sync();
    });
    volumeRange.addEventListener("input", function () {
        var curMax = state._volumeUnlocked ? XMG_AUDIO_VOLUME_MAX : XMG_AUDIO_VOLUME_NORMAL;
        const v = xmgClamp(Number(volumeRange.value), 0, curMax);
        const clamped = xmgApplyVolume(audio, audioGainNode, v);
        audio.muted = v <= 0;
        if (v > 0) state._lastVol = v;
        sync();
    });
    volumeRange.addEventListener("wheel", function (e) {
        e.preventDefault();
        e.stopPropagation();
        var curMax = state._volumeUnlocked ? XMG_AUDIO_VOLUME_MAX : XMG_AUDIO_VOLUME_NORMAL;
        const step = e.deltaY < 0 ? 5 : -5;
        const cur = xmgClamp(Number(volumeRange.value) || 0, 0, curMax);
        const next = xmgClamp(cur + step, 0, curMax);
        volumeRange.value = String(next);
        const clamped = xmgApplyVolume(audio, audioGainNode, next);
        audio.muted = next <= 0;
        if (next > 0) state._lastVol = next;
        sync();
    }, { passive: false });

    // Event: keyboard seek on waveform
    waveformWrap.addEventListener("keydown", function (e) {
        const dur = Number.isFinite(audio.duration) ? audio.duration : 0;
        if (!dur) return;
        if (e.key === "ArrowLeft") {
            e.preventDefault();
            audio.currentTime = Math.max(0, audio.currentTime - 5);
            sync();
        } else if (e.key === "ArrowRight") {
            e.preventDefault();
            audio.currentTime = Math.min(dur, audio.currentTime + 5);
            sync();
        } else if (e.key === "Home") {
            e.preventDefault();
            audio.currentTime = 0;
            sync();
        } else if (e.key === "End") {
            e.preventDefault();
            audio.currentTime = dur;
            sync();
        }
    });

    // Media events
    function onMediaEvent() { sync(); }
    var mediaEvents = ["loadedmetadata", "durationchange", "timeupdate", "seeking", "seeked", "play", "pause", "ended", "volumechange"];
    for (var i = 0; i < mediaEvents.length; i++) {
        audio.addEventListener(mediaEvents[i], onMediaEvent);
    }

    // Auto-load waveform once we have src
    var _origSrcDescriptor = null;
    function setupWaveformLoad() {
        var src = audio.src || audio.getAttribute("src") || "";
        if (src && !state._waveformLoaded) {
            state._waveformLoaded = true;
            state.loading = true;
            sync();
            xmgLoadWaveformPeaks(src).then(function (peaks) {
                if (state.disposed) return;
                state.peaks = peaks;
                state.loading = false;
                sync();
            });
        }
    }
    audio.addEventListener("loadstart", setupWaveformLoad);
    audio.addEventListener("loadedmetadata", setupWaveformLoad);
    // Also check immediately if src already set
    setTimeout(setupWaveformLoad, 50);

    // Resize observer for waveform canvas
    if (typeof ResizeObserver === "function") {
        var ro = new ResizeObserver(function () {
            if (!state.disposed) {
                state._mouseEntered = false;
                draw();
            }
        });
        ro.observe(waveformWrap);
        state._resizeObserver = ro;
    }

    // Theme change → redraw waveform (via global observer)
    xmgEnsureThemeObserver();
    XMG_WAVEFORM_CALLBACKS.add(draw);

    // Mouse enters node widget area → redraw waveform once per entry
    // (fixes stale canvas after canvas zoom/pan without user interaction)
    container.addEventListener("mouseenter", function () {
        if (state._mouseEntered) return;
        state._mouseEntered = true;
        if (!state.disposed) draw();
    });
    container.addEventListener("mouseleave", function () {
        state._mouseEntered = false;
    });

    state.dispose = function () {
        if (state.disposed) return;
        state.disposed = true;
        if (state.rafId) { cancelAnimationFrame(state.rafId); state.rafId = 0; }
        if (state._resizeObserver) { state._resizeObserver.disconnect(); state._resizeObserver = null; }
        XMG_WAVEFORM_CALLBACKS.delete(draw);
        audio.pause();
        audio.src = "";
        if (typeof audio.load === "function") audio.load();
        if (audioGainNode) {
            try { var ac = audioGainNode.context; if (ac && ac.state !== "closed") ac.close(); } catch {}
        }
    };

    state.sync = sync;
    container.__xmgAudioState = state;
    return { container: container, mediaEl: audio, playerState: state };
}

/* ==========================================================
   Custom Player — Video (compact controls)
   ========================================================== */

function xmgBuildVideoPlayer() {
    const container = document.createElement("div");
    container.className = "xmg-video-player";

    const video = document.createElement("video");
    video.preload = "metadata";
    video.controls = false;
    video.playsInline = true;
    video.className = "xmg-video-el";
    video.muted = true;

    // Content area wraps video + overlay, excludes controls for true centering
    const contentArea = document.createElement("div");
    contentArea.className = "xmg-video-content-area";
    contentArea.appendChild(video);
    container.appendChild(contentArea);

    // Gain graph for volume amplification (>100%)
    let videoGainNode = null;
    try {
        const ac = new (window.AudioContext || window.webkitAudioContext)();
        const src = ac.createMediaElementSource(video);
        const gn = ac.createGain();
        src.connect(gn);
        gn.connect(ac.destination);
        videoGainNode = gn;
        const resumeCtx = function () { if (ac.state === "suspended") ac.resume(); document.removeEventListener("pointerdown", resumeCtx); };
        document.addEventListener("pointerdown", resumeCtx, { once: true });
    } catch {}
    const vMaxOutput = videoGainNode ? XMG_AUDIO_VOLUME_MAX : XMG_AUDIO_VOLUME_NORMAL;

    // Play overlay (centered on video)
    const overlay = document.createElement("div");
    overlay.className = "xmg-video-overlay";
    const overlayBtn = document.createElement("button");
    overlayBtn.type = "button";
    overlayBtn.className = "xmg-video-overlay-btn";
    overlayBtn.textContent = "▶";
    overlayBtn.setAttribute("aria-label", t("xdatahub.ui.node.xmediaget.player_play", "Play"));
    setTooltipText(overlayBtn, t("xdatahub.ui.node.xmediaget.player_play", "Play"));
    bindTooltipTarget(overlayBtn);
    overlay.appendChild(overlayBtn);
    contentArea.appendChild(overlay);

    // Controls bar
    const controls = document.createElement("div");
    controls.className = "xmg-video-controls";

    const progressWrap = document.createElement("div");
    progressWrap.className = "xmg-video-progress-wrap";
    const progressBar = document.createElement("input");
    progressBar.type = "range";
    progressBar.className = "xmg-video-progress";
    progressBar.min = "0";
    progressBar.max = "1000";
    progressBar.step = "1";
    progressBar.value = "0";
    setTooltipText(progressBar, t("xdatahub.ui.node.xmediaget.player_seek", "Seek"));
    bindTooltipTarget(progressBar);
    progressWrap.appendChild(progressBar);

    const timeEl = document.createElement("span");
    timeEl.className = "xmg-video-time";
    timeEl.textContent = "0:00 / 0:00";

    const volumeBtn = document.createElement("button");
    volumeBtn.type = "button";
    volumeBtn.className = "xmg-video-volume-btn";
    volumeBtn.textContent = "🔊";
    volumeBtn.setAttribute("aria-label", "Mute");
    setTooltipText(volumeBtn, t("xdatahub.ui.node.xmediaget.player_mute", "Mute"));
    bindTooltipTarget(volumeBtn);

    const volumeRange = document.createElement("input");
    volumeRange.type = "range";
    volumeRange.className = "xmg-video-volume-range";
    volumeRange.min = "0";
    volumeRange.max = String(XMG_AUDIO_VOLUME_NORMAL);
    volumeRange.step = "1";
    volumeRange.value = String(XMG_AUDIO_VOLUME_NORMAL);
    setTooltipText(volumeRange, t("xdatahub.ui.node.xmediaget.player_volume", "Volume"));
    bindTooltipTarget(volumeRange);

    const volumeValue = document.createElement("span");
    volumeValue.className = "xmg-video-volume-value";
    volumeValue.textContent = "100%";

    // Volume boost lock toggle
    const lockBtn = document.createElement("button");
    lockBtn.type = "button";
    lockBtn.className = "xmg-video-volume-lock";
    lockBtn.textContent = "🔒";
    lockBtn.setAttribute("aria-label", "Unlock volume boost");
    setTooltipText(lockBtn, t("xdatahub.ui.node.xmediaget.player_volume_unlock", "Unlock volume boost"));
    bindTooltipTarget(lockBtn);
    lockBtn.addEventListener("click", function () {
        var unlock = !state._volumeUnlocked;
        state._volumeUnlocked = unlock;
        lockBtn.classList.toggle("is-active", unlock);
        lockBtn.textContent = unlock ? "🔓" : "🔒";
        lockBtn.setAttribute("aria-label", unlock ? "Lock volume boost" : "Unlock volume boost");
        setTooltipText(lockBtn, t(unlock ? "xdatahub.ui.node.xmediaget.player_volume_lock" : "xdatahub.ui.node.xmediaget.player_volume_unlock", unlock ? "Lock volume boost" : "Unlock volume boost"));
        var cur = Number(volumeRange.value);
        if (!unlock && cur > XMG_AUDIO_VOLUME_NORMAL) {
            volumeRange.value = String(XMG_AUDIO_VOLUME_NORMAL);
            xmgApplyVolume(video, videoGainNode, XMG_AUDIO_VOLUME_NORMAL);
            video.muted = false;
            if (XMG_AUDIO_VOLUME_NORMAL > 0) state._lastVol = XMG_AUDIO_VOLUME_NORMAL;
        }
        volumeRange.max = unlock ? String(XMG_AUDIO_VOLUME_MAX) : String(XMG_AUDIO_VOLUME_NORMAL);
        sync();
    });
    lockBtn.style.display = videoGainNode ? "" : "none";

    // Progress bar on its own row (prevents squeezing at small sizes)
    const progressRow = document.createElement("div");
    progressRow.className = "xmg-video-progress-row";
    progressRow.appendChild(progressWrap);
    container.appendChild(progressRow);

    // Loop toggle button
    const loopBtn = document.createElement("button");
    loopBtn.type = "button";
    loopBtn.className = "xmg-video-loop-btn";
    loopBtn.textContent = "\uD83D\uDD01";
    loopBtn.setAttribute("aria-label", "Loop playback");
    setTooltipText(loopBtn, t("xdatahub.ui.node.xmediaget.player_loop", "Loop playback"));
    bindTooltipTarget(loopBtn);
    loopBtn.addEventListener("click", function () {
        video.loop = !video.loop;
        loopBtn.classList.toggle("is-active", video.loop);
        loopBtn.setAttribute("aria-label", video.loop ? "Loop enabled" : "Loop playback");
        setTooltipText(loopBtn, t(video.loop ? "xdatahub.ui.node.xmediaget.player_loop_enabled" : "xdatahub.ui.node.xmediaget.player_loop", video.loop ? "Loop enabled" : "Loop playback"));
    });

    controls.appendChild(timeEl);
    controls.appendChild(loopBtn);
    controls.appendChild(volumeBtn);
    controls.appendChild(volumeRange);
    controls.appendChild(volumeValue);
    controls.appendChild(lockBtn);
    container.appendChild(controls);

    // Full progress bar width (for seek-on-click)
    // We'll make the entire progressWrap clickable for seeking

    const state = {
        video,
        loopBtn,
        lockBtn,
        overlay,
        overlayBtn,
        progress: progressBar,
        progressWrap,
        timeEl,
        volumeBtn,
        volumeRange,
        volumeValue,
        progressVal: 0,
        disposed: false,
        _hoverPause: false,
        rafId: 0,
        _userDragging: false,
        _volumeUnlocked: false,
    };

    function sync() {
        if (state.disposed || state._userDragging) return;
        const dur = Number.isFinite(video.duration) ? video.duration : 0;
        const ct = dur > 0 ? Math.min(Math.max(video.currentTime, 0), dur) : 0;
        const playing = !video.paused && !video.ended;
        const pct = dur > 0 ? ct / dur : 0;
        state.progressVal = pct;
        progressBar.value = String(Math.round(pct * 1000));
        timeEl.textContent = xmgFormatTime(ct) + " / " + xmgFormatTime(dur);
        overlay.style.display = (playing && !state._hoverPause) ? "none" : "flex";
        if (playing && state._hoverPause) {
            overlayBtn.textContent = "⏸";
            overlayBtn.setAttribute("aria-label", "Pause");
            setTooltipText(overlayBtn, t("xdatahub.ui.node.xmediaget.player_pause", "Pause"));
        } else {
            overlayBtn.textContent = video.ended ? "↻" : "▶";
            overlayBtn.setAttribute("aria-label", video.ended
                ? t("xdatahub.ui.node.xmediaget.player_play", "Play")
                : (playing
                    ? t("xdatahub.ui.node.xmediaget.player_pause", "Pause")
                    : t("xdatahub.ui.node.xmediaget.player_play", "Play")));
            setTooltipText(overlayBtn, video.ended
                ? t("xdatahub.ui.node.xmediaget.player_play", "Play")
                : (playing
                    ? t("xdatahub.ui.node.xmediaget.player_pause", "Pause")
                    : t("xdatahub.ui.node.xmediaget.player_play", "Play")));
        }

        var volRaw = Number(volumeRange.value);
        var curMax = state._volumeUnlocked ? XMG_AUDIO_VOLUME_MAX : XMG_AUDIO_VOLUME_NORMAL;
        var vol = Math.round(xmgClamp(Number.isFinite(volRaw) ? volRaw : XMG_AUDIO_VOLUME_NORMAL, 0, curMax));
        volumeValue.textContent = vol + "%";
        volumeBtn.textContent = vol <= 0 ? "🔇" : "🔊";
        volumeBtn.setAttribute("aria-label", vol <= 0
            ? t("xdatahub.ui.node.xmediaget.player_unmute", "Unmute")
            : t("xdatahub.ui.node.xmediaget.player_mute", "Mute"));
        setTooltipText(volumeBtn, vol <= 0
            ? t("xdatahub.ui.node.xmediaget.player_unmute", "Unmute")
            : t("xdatahub.ui.node.xmediaget.player_mute", "Mute"));
        setTooltipText(progressBar, t("xdatahub.ui.node.xmediaget.player_seek", "Seek"));
        setTooltipText(volumeRange, t("xdatahub.ui.node.xmediaget.player_volume", "Volume"));
        setTooltipText(lockBtn, t(state._volumeUnlocked
            ? "xdatahub.ui.node.xmediaget.player_volume_lock"
            : "xdatahub.ui.node.xmediaget.player_volume_unlock",
            state._volumeUnlocked ? "Lock volume boost" : "Unlock volume boost"));
        setTooltipText(loopBtn, t(video.loop
            ? "xdatahub.ui.node.xmediaget.player_loop_enabled"
            : "xdatahub.ui.node.xmediaget.player_loop",
            video.loop ? "Loop enabled" : "Loop playback"));

        if (playing) {
            if (!state.rafId) {
                state.rafId = requestAnimationFrame(function tick() {
                    state.rafId = 0;
                    if (!state.disposed) sync();
                });
            }
        } else {
            if (state.rafId) {
                cancelAnimationFrame(state.rafId);
                state.rafId = 0;
            }
        }
    }

    // Overlay play/pause
    overlay.addEventListener("click", function () {
        if (video.paused || video.ended) {
            video.play().catch(function () {});
            state._hoverPause = true;
        } else {
            video.pause();
        }
    });

    // Progress bar seek (input)
    progressBar.addEventListener("input", function () {
        state._userDragging = true;
        var dur = Number.isFinite(video.duration) ? video.duration : 0;
        if (dur > 0) {
            var pct = xmgClamp(Number(progressBar.value), 0, 1000) / 1000;
            video.currentTime = dur * pct;
            timeEl.textContent = xmgFormatTime(video.currentTime) + " / " + xmgFormatTime(dur);
        }
    });
    progressBar.addEventListener("change", function () {
        state._userDragging = false;
        sync();
    });

    // Seek by clicking on progress wrap (not just the thumb)
    progressWrap.addEventListener("click", function (e) {
        if (e.target === progressBar) return;
        var rect = progressWrap.getBoundingClientRect();
        var dur = Number.isFinite(video.duration) ? video.duration : 0;
        if (!rect.width || dur <= 0) return;
        var ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
        video.currentTime = dur * ratio;
        sync();
    });

    // Volume (mute toggle with restore, supports amplification)
    volumeBtn.addEventListener("click", function () {
        var cur = Number(volumeRange.value);
        if (cur > 0) {
            state._lastVol = xmgClamp(cur, 0, state._volumeUnlocked ? XMG_AUDIO_VOLUME_MAX : XMG_AUDIO_VOLUME_NORMAL);
            xmgApplyVolume(video, videoGainNode, 0);
            volumeRange.value = "0";
            video.muted = true;
        } else {
            var restore = state._lastVol > 0 ? state._lastVol : XMG_AUDIO_VOLUME_NORMAL;
            volumeRange.value = String(restore);
            xmgApplyVolume(video, videoGainNode, restore);
            video.muted = false;
        }
        sync();
    });
    volumeRange.addEventListener("input", function () {
        var curMax = state._volumeUnlocked ? XMG_AUDIO_VOLUME_MAX : XMG_AUDIO_VOLUME_NORMAL;
        var v = xmgClamp(Number(volumeRange.value), 0, curMax);
        xmgApplyVolume(video, videoGainNode, v);
        video.muted = v <= 0;
        if (v > 0) state._lastVol = v;
        sync();
    });
    volumeRange.addEventListener("wheel", function (e) {
        e.preventDefault();
        e.stopPropagation();
        var curMax = state._volumeUnlocked ? XMG_AUDIO_VOLUME_MAX : XMG_AUDIO_VOLUME_NORMAL;
        var step = e.deltaY < 0 ? 5 : -5;
        var cur = xmgClamp(Number(volumeRange.value) || 0, 0, curMax);
        var next = xmgClamp(cur + step, 0, curMax);
        volumeRange.value = String(next);
        xmgApplyVolume(video, videoGainNode, next);
        video.muted = next <= 0;
        if (next > 0) state._lastVol = next;
        sync();
    }, { passive: false });

    // Video click also toggles play
    video.addEventListener("click", function () {
        if (video.paused || video.ended) {
            video.play().catch(function () {});
            state._hoverPause = true;
        } else {
            video.pause();
        }
    });

    // Hover pause button (show ⏸ when hovering over video during playback)
    container.addEventListener("mouseenter", function () {
        if (!video.paused && !video.ended) {
            state._hoverPause = true;
            overlay.style.display = "flex";
            overlayBtn.textContent = "⏸";
            overlayBtn.setAttribute("aria-label", "Pause");
        }
    });
    container.addEventListener("mouseleave", function () {
        if (state._hoverPause) {
            state._hoverPause = false;
            if (!video.paused && !video.ended) {
                overlay.style.display = "none";
            }
        }
    });

    // Media events
    function onMediaEvent() { sync(); }
    var mediaEvents = ["loadedmetadata", "durationchange", "timeupdate", "seeking", "seeked", "play", "pause", "ended", "volumechange"];
    for (var i = 0; i < mediaEvents.length; i++) {
        video.addEventListener(mediaEvents[i], onMediaEvent);
    }

    state.dispose = function () {
        if (state.disposed) return;
        state.disposed = true;
        if (state.rafId) { cancelAnimationFrame(state.rafId); state.rafId = 0; }
        video.pause();
        video.src = "";
        if (typeof video.load === "function") video.load();
        if (videoGainNode) {
            try { var ac = videoGainNode.context; if (ac && ac.state !== "closed") ac.close(); } catch {}
        }
    };

    state.sync = sync;
    container.__xmgVideoState = state;
    return { container: container, mediaEl: video, playerState: state };
}

function buildPanel(nodeClass) {
    const config = getNodeUiConfig(nodeClass);
    const panel = document.createElement("div");
    panel.className = "ximageget-panel";

    const meta = document.createElement("div");
    meta.className = "ximageget-meta";

    const kindEmoji = document.createElement("span");
    kindEmoji.className = "ximageget-kind-emoji";
    kindEmoji.textContent = String(config.emoji || "🔹");
    kindEmoji.setAttribute("aria-hidden", "true");

    let maskBtn = null;
    if (nodeClass === "XImageGet") {
        maskBtn = document.createElement("button");
        maskBtn.className = "ximageget-mask-btn";
        maskBtn.type = "button";
        maskBtn.disabled = true;
    } else {
        kindEmoji.classList.add("ximageget-kind-emoji-push");
    }

    const badge = document.createElement("div");
    badge.className = "ximageget-badge";

    const badgeChip = document.createElement("span");
    badgeChip.className = "ximageget-badge-chip";
    badgeChip.textContent = "--";

    const badgeSwatch = document.createElement("span");
    badgeSwatch.className = "ximageget-badge-swatch";

    badge.appendChild(badgeChip);
    badge.appendChild(badgeSwatch);

    const clearBtn = document.createElement("button");
    clearBtn.className = "ximageget-clear-btn";
    clearBtn.type = "button";
    clearBtn.textContent = "🗑️";
    const clearBtnLabel = t(CLEAR_BTN_LABEL_KEY, CLEAR_BTN_LABEL_FALLBACK);
    setTooltipText(clearBtn, clearBtnLabel);
    clearBtn.setAttribute("aria-label", clearBtnLabel);
    bindTooltipTarget(clearBtn);

    meta.appendChild(badge);
    if (maskBtn) {
        meta.appendChild(maskBtn);
    }
    meta.appendChild(kindEmoji);

    const preview = document.createElement("div");
    preview.className = "ximageget-preview";
    let mediaEl = null;
    let textEl = null;
    let _playerState = null;
    if (config.kind === "image") {
        const img = document.createElement("img");
        img.alt = nodeClass || "XImageGet";
        mediaEl = img;
    } else if (config.kind === "video") {
        const player = xmgBuildVideoPlayer();
        mediaEl = player.mediaEl;
        _playerState = player.playerState;
        preview.appendChild(player.container);
    } else if (config.kind === "audio") {
        const player = xmgBuildAudioPlayer();
        mediaEl = player.mediaEl;
        _playerState = player.playerState;
        preview.appendChild(player.container);
    } else {
        const textPreview = document.createElement("textarea");
        textPreview.className = "ximageget-text-preview";
        textPreview.value = "";
        textPreview.placeholder = String(config.placeholder || "");
        textPreview.spellcheck = false;
        textEl = textPreview;
        preview.classList.add("is-text");
    }
    if (mediaEl && config.kind !== "video" && config.kind !== "audio") {
        preview.appendChild(mediaEl);
    }
    if (textEl) {
        preview.appendChild(textEl);
    }

    const placeholder = document.createElement("div");
    placeholder.className = "ximageget-placeholder";
    placeholder.textContent = config.placeholder;
    preview.appendChild(placeholder);

    const title = document.createElement("input");
    title.className = "ximageget-title";
    title.type = "text";
    title.value = "";
    title.placeholder = config.titlePlaceholder;
    title.spellcheck = false;
    bindTooltipTarget(title);

    bindTooltipTarget(badge);

    if (maskBtn) {
        bindTooltipTarget(maskBtn);
    }

    const footer = document.createElement("div");
    footer.className = "ximageget-footer";
    footer.appendChild(title);
    footer.appendChild(clearBtn);

    panel.appendChild(meta);
    panel.appendChild(preview);
    panel.appendChild(footer);

    const panelInfo = {
        panel,
        preview,
        mediaEl,
        textEl,
        mediaKind: config.kind,
        nodeClass: String(nodeClass || "XImageGet"),
        emoji: String(config.emoji || "🔹"),
        kindEmoji,
        maskBtn,
        placeholderText: config.placeholder,
        missingText: config.missing,
        placeholder,
        title,
        footer,
        meta,
        clearBtn,
        badge,
        badgeChip,
        badgeSwatch,
        __xmgPlayerState: _playerState,
    };
    panelInfo.__xmediaget_preview_state = PREVIEW_STATE_EMPTY;
    return panelInfo;
}

function applyPanelLocale(panelInfo) {
    if (!panelInfo) {
        return;
    }
    const config = getNodeUiConfig(panelInfo.nodeClass);
    panelInfo.placeholderText = config.placeholder;
    panelInfo.missingText = config.missing;
    if (panelInfo.mediaKind === "text" && panelInfo.textEl) {
        panelInfo.textEl.placeholder = config.placeholder || "";
    }
    if (panelInfo.title instanceof HTMLInputElement) {
        panelInfo.title.placeholder = config.titlePlaceholder;
    }
    const clearBtnLabel = t(CLEAR_BTN_LABEL_KEY, CLEAR_BTN_LABEL_FALLBACK);
    const maskBtnLabel = t(
        OPEN_MASK_EDITOR_LABEL_KEY,
        OPEN_MASK_EDITOR_LABEL_FALLBACK
    );
    if (panelInfo.clearBtn instanceof HTMLButtonElement) {
        setTooltipText(panelInfo.clearBtn, clearBtnLabel);
        panelInfo.clearBtn.setAttribute("aria-label", clearBtnLabel);
    }
    if (panelInfo.maskBtn instanceof HTMLButtonElement) {
        panelInfo.maskBtn.textContent = maskBtnLabel;
        setTooltipText(panelInfo.maskBtn, maskBtnLabel);
        panelInfo.maskBtn.setAttribute("aria-label", maskBtnLabel);
    }
    const state = String(
        panelInfo.__xmediaget_preview_state || PREVIEW_STATE_EMPTY
    );
    if (state === PREVIEW_STATE_EMPTY) {
        panelInfo.placeholder.textContent =
            panelInfo.mediaKind === "text"
                ? ""
                : panelInfo.placeholderText;
        return;
    }
    if (state === PREVIEW_STATE_MISSING) {
        panelInfo.placeholder.textContent = panelInfo.missingText;
    }
}

function refreshAllPanelLocales() {
    const rootGraph = app.graph;
    if (!rootGraph) {
        return;
    }
    forEachNodeInGraphTree(rootGraph, (node) => {
        const panelInfo = node?.__ximageget_panel;
        if (!panelInfo) {
            return;
        }
        applyPanelLocale(panelInfo);
        // Refresh player UI labels on locale change
        if (panelInfo.__xmgPlayerState && typeof panelInfo.__xmgPlayerState.sync === "function") {
            panelInfo.__xmgPlayerState.sync();
        }
    });
}

async function applyUiLocale(localeOverride = null) {
    const locale = normalizeLocaleCode(localeOverride || resolveComfyLocale())
        || "en";
    await loadUiLocaleBundle(locale);
    currentUiLocale = locale;
    refreshAllPanelLocales();
}

function clearMediaElementHandlers(mediaEl) {
    if (!mediaEl) {
        return;
    }
    mediaEl.onload = null;
    mediaEl.onerror = null;
    mediaEl.onloadeddata = null;
}

function deriveTitleFromText(textValue, fallback = "") {
    const text = String(textValue || "").trim();
    if (!text) {
        return String(fallback || "");
    }
    const firstLine = text.split(/\r?\n/)[0].trim();
    if (!firstLine) {
        return String(fallback || "");
    }
    return firstLine.length > 96
        ? `${firstLine.slice(0, 96)}...`
        : firstLine;
}

function getNodeMinSize(node) {
    const nodeClass = String(node?.comfyClass || "");
    if (nodeClass === "XImageGet") {
        return [DEFAULT_MIN_NODE_WIDTH, IMAGE_GET_MIN_NODE_HEIGHT];
    }
    return [DEFAULT_MIN_NODE_WIDTH, DEFAULT_MIN_NODE_HEIGHT];
}

function readPanelHorizontalPadding(panelEl) {
    if (!(panelEl instanceof HTMLElement)) {
        return 0;
    }
    const styles = window.getComputedStyle(panelEl);
    const left = Number.parseFloat(styles.paddingLeft || "0");
    const right = Number.parseFloat(styles.paddingRight || "0");
    const total = left + right;
    return Number.isFinite(total) ? total : 0;
}

function readFlexColumnGap(containerEl) {
    if (!(containerEl instanceof HTMLElement)) {
        return 0;
    }
    const styles = window.getComputedStyle(containerEl);
    const rawGap = styles.columnGap || styles.gap || "0";
    const gap = Number.parseFloat(rawGap || "0");
    return Number.isFinite(gap) ? gap : 0;
}

function measureMetaContentWidth(metaEl) {
    if (!(metaEl instanceof HTMLElement)) {
        return 0;
    }
    const children = Array.from(metaEl.children).filter(
        (child) => child instanceof HTMLElement
            && window.getComputedStyle(child).display !== "none"
    );
    if (!children.length) {
        return 0;
    }
    const gap = readFlexColumnGap(metaEl);
    const contentWidth = children.reduce((total, child) => {
        const measured = Math.max(
            child.getBoundingClientRect().width || 0,
            child.offsetWidth || 0,
            child.scrollWidth || 0
        );
        return total + (Number.isFinite(measured) ? measured : 0);
    }, 0);
    const totalGap = gap * Math.max(children.length - 1, 0);
    return Math.ceil(contentWidth + totalGap);
}

function resolveAdaptiveMinWidth(node, baseMinWidth) {
    const fallbackMin = Number.isFinite(baseMinWidth)
        ? baseMinWidth
        : DEFAULT_MIN_NODE_WIDTH;
    const panelInfo = node?.__ximageget_panel;
    const meta = panelInfo?.meta;
    const scopedId = getScopedNodeId(node);
    const idText = scopedId
        || String(panelInfo?.badgeChip?.textContent || "").trim();
    const extraByIdLength = idText.length > 5
        ? (idText.length - 5) * 8
        : 0;
    let domRequired = 0;
    if (meta instanceof HTMLElement) {
        domRequired = measureMetaContentWidth(meta);
    }
    const panelPadding = readPanelHorizontalPadding(panelInfo?.panel);
    const layoutSlack = 12;
    const requiredByDom = Math.ceil(domRequired + panelPadding + layoutSlack);
    const requiredById = Math.ceil(fallbackMin + extraByIdLength);
    const required = Math.max(requiredByDom, requiredById);
    return Math.max(fallbackMin, required);
}

function syncTextPreviewEmptyState(panelInfo, textValue = "") {
    if (panelInfo?.mediaKind !== "text" || !panelInfo.preview) {
        return;
    }
    panelInfo.preview.classList.toggle(
        "is-empty-text",
        !String(textValue || "")
    );
}

function setPreview(panelInfo, data) {
    if (!panelInfo) {
        return;
    }
    const {
        preview,
        mediaEl,
        textEl,
        placeholder,
        title,
        mediaKind,
        placeholderText,
        missingText,
        nodeClass,
    } = panelInfo;
    const fileUrl = String(data?.file_url || "");
    const textValue = String(data?.text_value || "");
    const label = String(data?.title || "");
    const loadToken = (Number(panelInfo.__xmediaget_load_token) || 0) + 1;
    panelInfo.__xmediaget_load_token = loadToken;
    if (mediaKind === "text") {
        if (!textValue) {
            panelInfo.__xmediaget_preview_state = PREVIEW_STATE_EMPTY;
            preview.classList.remove("has-media");
            syncTextPreviewEmptyState(panelInfo, "");
            if (textEl) {
                textEl.value = "";
            }
            placeholder.textContent = "";
            if (title instanceof HTMLInputElement) {
                title.value = String(label || "");
                setTooltipText(title, label);
            }
            return;
        }
        panelInfo.__xmediaget_preview_state = PREVIEW_STATE_LOADED;
        preview.classList.add("has-media");
        syncTextPreviewEmptyState(panelInfo, textValue);
        placeholder.textContent = "";
        if (textEl) {
            textEl.value = textValue;
        }
        const finalTitle = String(label || "");
        if (title instanceof HTMLInputElement) {
            title.value = finalTitle;
            setTooltipText(title, finalTitle);
        }
        syncMaskButtonState(panelInfo.__ximageget_node);
        return;
    }

    if (!fileUrl) {
        panelInfo.__xmediaget_preview_state = PREVIEW_STATE_EMPTY;
        preview.classList.remove("has-media");
        if (mediaEl) {
            clearMediaElementHandlers(mediaEl);
            if (panelInfo.__xmgPlayerState && typeof panelInfo.__xmgPlayerState.dispose === "function") {
                panelInfo.__xmgPlayerState.dispose();
                panelInfo.__xmgPlayerState = null;
            }
            mediaEl.src = "";
            if (typeof mediaEl.load === "function") {
                mediaEl.load();
            }
        }
        placeholder.textContent =
            placeholderText || "Drop an XDataHub media card here";
        if (title instanceof HTMLInputElement) {
            title.value = "";
            setTooltipText(title, "");
        }
        if (textEl) {
            textEl.textContent = "";
        }
        syncMaskButtonState(panelInfo.__ximageget_node);
        return;
    }
    const cacheBusted = fileUrl.includes("?")
        ? `${fileUrl}&ts=${Date.now()}`
        : `${fileUrl}?ts=${Date.now()}`;
    if (mediaEl && mediaKind === "image") {
        clearMediaElementHandlers(mediaEl);
        mediaEl.onload = () => {
            if (panelInfo.__xmediaget_load_token !== loadToken) {
                return;
            }
            panelInfo.__xmediaget_preview_state = PREVIEW_STATE_LOADED;
            preview.classList.add("has-media");
            placeholder.textContent = "";
            syncMaskButtonState(panelInfo.__ximageget_node);
        };
        mediaEl.onerror = () => {
            if (panelInfo.__xmediaget_load_token !== loadToken) {
                return;
            }
            panelInfo.__xmediaget_preview_state = PREVIEW_STATE_MISSING;
            preview.classList.remove("has-media");
            placeholder.textContent = missingText || "Image missing";
            syncMaskButtonState(panelInfo.__ximageget_node);
        };
        mediaEl.src = cacheBusted;
        mediaEl.alt = label || nodeClass || "XImageGet";
    } else if (mediaEl) {
        clearMediaElementHandlers(mediaEl);
        // Reset custom player state for fresh load (without rebuilding DOM)
        if (panelInfo.__xmgPlayerState) {
            const ps = panelInfo.__xmgPlayerState;
            // Stop RAF if running
            if (ps.rafId) { cancelAnimationFrame(ps.rafId); ps.rafId = 0; }
            // Don't disconnect ResizeObserver — it still observes the same element
            // Reset waveform flags so it reloads peaks on new src
            ps._waveformLoaded = false;
            ps.peaks = [];
            ps.progress = 0;
            ps.loading = false;
            ps.disposed = false;
            ps._mouseEntered = false;
        }
        mediaEl.onloadeddata = () => {
            if (panelInfo.__xmediaget_load_token !== loadToken) {
                return;
            }
            panelInfo.__xmediaget_preview_state = PREVIEW_STATE_LOADED;
            preview.classList.add("has-media");
            placeholder.textContent = "";
            syncMaskButtonState(panelInfo.__ximageget_node);
        };
        mediaEl.onerror = () => {
            if (panelInfo.__xmediaget_load_token !== loadToken) {
                return;
            }
            panelInfo.__xmediaget_preview_state = PREVIEW_STATE_MISSING;
            preview.classList.remove("has-media");
            placeholder.textContent = missingText || "Media missing";
            syncMaskButtonState(panelInfo.__ximageget_node);
        };
        mediaEl.src = cacheBusted;
        if (typeof mediaEl.load === "function") {
            mediaEl.load();
        }
    }
    if (title instanceof HTMLInputElement) {
        title.value = label;
        setTooltipText(title, label);
    }
}

function formatNodeSerial(nodeId) {
    const s = String(nodeId ?? "").trim();
    if (!s) {
        return "--";
    }
    return s;
}

function applyNodeBadge(panelInfo, node) {
    if (!panelInfo || !node) {
        return;
    }
    const scopedId = getScopedNodeId(node);
    if (!scopedId) {
        return;
    }
    const serial = formatNodeSerial(scopedId);
    const accentIndex = getNodeAccentIndex(scopedId);
    const accentColor = getNodeAccentColor(scopedId);
    panelInfo.panel.style.setProperty("--ximageget-accent", accentColor);
    if (panelInfo.badgeChip) {
        panelInfo.badgeChip.textContent = serial;
    }
    if (panelInfo.badge) {
        setTooltipText(
            panelInfo.badge,
            `${String(node.comfyClass || "XImageGet")} #${serial}`
        );
    }
    node.__ximageget_accent_index = accentIndex >= 0 ? accentIndex : null;
    node.__ximageget_badge_node_id = scopedId;
    // Long scoped IDs can expand header content; keep node width adaptive.
    ensureNodeMinSize(node);
}

function scheduleBadgeSync(node, panelInfo) {
    if (!node || !panelInfo) {
        return;
    }
    if (getScopedNodeId(node)) {
        applyNodeBadge(panelInfo, node);
        return;
    }
    if (node.__ximageget_badge_retry_timer) {
        return;
    }
    node.__ximageget_badge_retry_timer = window.setTimeout(() => {
        node.__ximageget_badge_retry_timer = 0;
        applyNodeBadge(panelInfo, node);
        if (!getScopedNodeId(node)) {
            scheduleBadgeSync(node, panelInfo);
        }
    }, 80);
}

function refreshNodeBadge(node) {
    if (!node || !node.__ximageget_panel) {
        return;
    }
    const panelInfo = node.__ximageget_panel;
    const scopedId = getScopedNodeId(node);
    if (!scopedId) {
        scheduleBadgeSync(node, panelInfo);
        return;
    }
    if (node.__ximageget_badge_node_id !== scopedId) {
        applyNodeBadge(panelInfo, node);
    }
}

function isStringNode(node) {
    return String(node?.comfyClass || "") === STRING_NODE_CLASS;
}

function getStorageWidgetName(node) {
    return isStringNode(node) ? TEXT_VALUE_WIDGET : MEDIA_REF_WIDGET;
}

function getTextTitleWidgetName(node) {
    return isStringNode(node) ? TEXT_TITLE_WIDGET : "";
}

function getPreferredImagePreviewUrl(node, fallbackUrl = "") {
    if (String(node?.comfyClass || "") !== "XImageGet") {
        return String(fallbackUrl || "");
    }
    const maskRef = getMaskImageRef(node);
    const maskUrl = buildAnnotatedImageUrl(maskRef);
    if (maskUrl) {
        return maskUrl;
    }
    return String(fallbackUrl || "");
}

function canOpenMaskEditor(node) {
    if (String(node?.comfyClass || "") !== "XImageGet") {
        return false;
    }
    const mediaRef = getStoredNodeValue(node);
    if (!mediaRef) {
        return false;
    }
    const panelInfo = node?.__ximageget_panel;
    if (!panelInfo) {
        return false;
    }
    if (panelInfo.__xmediaget_preview_state !== PREVIEW_STATE_LOADED) {
        return false;
    }
    if (!(panelInfo.mediaEl instanceof HTMLImageElement)) {
        return false;
    }
    if (!panelInfo.mediaEl.complete) {
        return false;
    }
    if (!panelInfo.mediaEl.naturalWidth || !panelInfo.mediaEl.naturalHeight) {
        return false;
    }
    return typeof app?.extensionManager?.command?.execute === "function";
}

function syncMaskButtonState(node) {
    const panelInfo = node?.__ximageget_panel;
    const btn = panelInfo?.maskBtn;
    if (!(btn instanceof HTMLButtonElement)) {
        return;
    }
    btn.disabled = !canOpenMaskEditor(node);
}

function createPreviewImageFromNode(node) {
    const panelInfo = node?.__ximageget_panel;
    const imgEl = panelInfo?.mediaEl;
    if (!(imgEl instanceof HTMLImageElement)) {
        return null;
    }
    if (!imgEl.complete || !imgEl.naturalWidth || !imgEl.naturalHeight) {
        return null;
    }
    return imgEl;
}

function selectNodeForMaskEditor(node) {
    const canvas = app?.canvas;
    if (!canvas || !node) {
        return;
    }
    try {
        canvas.deselectAllNodes?.();
    } catch {
        // ignore
    }
    try {
        canvas.selectNode?.(node, false);
    } catch {
        // ignore
    }
    canvas.current_node = node;
    canvas.node_selected = node;
    canvas.selected_nodes = { [node.id]: node };
}

function clearTemporaryMaskEditorState(node) {
    if (!node) {
        return;
    }
    if (node.__ximageget_mask_editor_prev_imgs === undefined) {
        delete node.imgs;
    } else {
        node.imgs = node.__ximageget_mask_editor_prev_imgs;
    }
    if (node.__ximageget_mask_editor_prev_images === undefined) {
        delete node.images;
    } else {
        node.images = node.__ximageget_mask_editor_prev_images;
    }
    if (node.__ximageget_mask_editor_prev_preview_type === undefined) {
        delete node.previewMediaType;
    } else {
        node.previewMediaType = node.__ximageget_mask_editor_prev_preview_type;
    }
    delete node.__ximageget_mask_editor_prev_imgs;
    delete node.__ximageget_mask_editor_prev_images;
    delete node.__ximageget_mask_editor_prev_preview_type;
}

function scheduleTemporaryMaskEditorStateClear(node) {
    window.setTimeout(() => {
        clearTemporaryMaskEditorState(node);
    }, 0);
}

function clearLegacyCanvasPreview(node) {
    if (!node) {
        return;
    }
    delete node.images;
    delete node.imgs;
    node.imageIndex = null;
    if (Array.isArray(node.widgets)) {
        const widgetIndex = node.widgets.findIndex(
            (item) => item?.name === "$$canvas-image-preview"
        );
        if (widgetIndex >= 0) {
            node.widgets[widgetIndex]?.onRemove?.();
            node.widgets.splice(widgetIndex, 1);
        }
    }
    node?.graph?.setDirtyCanvas?.(true, true);
}

function scheduleLegacyCanvasPreviewClear(node) {
    clearLegacyCanvasPreview(node);
    window.setTimeout(() => {
        clearLegacyCanvasPreview(node);
    }, 0);
    window.requestAnimationFrame(() => {
        clearLegacyCanvasPreview(node);
    });
}

function isMaskEditorDialog(dialog) {
    if (!(dialog instanceof HTMLElement)) {
        return false;
    }
    if (dialog.getAttribute("role") !== "dialog") {
        return false;
    }
    const buttonTexts = Array.from(dialog.querySelectorAll("button"))
        .map((button) => String(button.textContent || "").trim())
        .filter(Boolean);
    const hasSave = buttonTexts.some(
        (text) => text === "Save"
            || text === "保存"
            || text.endsWith("Save")
            || text.endsWith("保存")
    );
    const hasCancel = buttonTexts.some(
        (text) => text === "Cancel"
            || text === "取消"
            || text.endsWith("Cancel")
            || text.endsWith("取消")
    );
    return hasSave && hasCancel;
}

function findOpenMaskEditorDialogs() {
    return Array.from(document.querySelectorAll('[role="dialog"]'))
        .filter((dialog) => isMaskEditorDialog(dialog));
}

function finalizeMaskEditorSession(node, sessionToken) {
    if (!node || node.__ximageget_mask_editor_session !== sessionToken) {
        return;
    }
    clearTemporaryMaskEditorState(node);
    scheduleLegacyCanvasPreviewClear(node);
    delete node.__ximageget_mask_editor_session;
    node?.graph?.setDirtyCanvas?.(true, true);
}

function watchMaskEditorClose(node, sessionToken) {
    if (!node || !sessionToken) {
        return;
    }
    const startedAt = Date.now();
    let hasSeenDialog = false;

    const poll = () => {
        if (node.__ximageget_mask_editor_session !== sessionToken) {
            return;
        }
        const dialogs = findOpenMaskEditorDialogs();
        if (dialogs.length > 0) {
            hasSeenDialog = true;
            window.setTimeout(poll, MASK_EDITOR_CLOSE_POLL_MS);
            return;
        }
        if (hasSeenDialog) {
            finalizeMaskEditorSession(node, sessionToken);
            return;
        }
        if ((Date.now() - startedAt) >= MASK_EDITOR_CLOSE_TIMEOUT_MS) {
            finalizeMaskEditorSession(node, sessionToken);
            return;
        }
        window.setTimeout(poll, MASK_EDITOR_CLOSE_POLL_MS);
    };

    window.setTimeout(poll, MASK_EDITOR_CLOSE_POLL_MS);
}

async function uploadCurrentNodeImageForMaskEditor(node) {
    const panelInfo = node?.__ximageget_panel;
    const imgEl = panelInfo?.mediaEl;
    if (!(imgEl instanceof HTMLImageElement)) {
        throw new Error("Mask source image element missing");
    }
    // Always use the original XDataHub media URL as the source, regardless of
    // whether imgEl.src has been changed to a mask-overlay clipspace file by
    // getPreferredImagePreviewUrl. If no media_ref exists, fall back to imgEl.
    const mediaRef = getStoredNodeValue(node);
    const sourceUrl = mediaRef
        ? buildMediaFileUrl(mediaRef)
        : String(imgEl.currentSrc || imgEl.src || "").trim();
    if (!sourceUrl) {
        throw new Error("Mask source image URL missing");
    }
    const response = await fetch(sourceUrl, { credentials: "same-origin" });
    if (!response.ok) {
        throw new Error("Failed to fetch mask source image");
    }
    const blob = await response.blob();
    const sourceTitle = String(
        panelInfo?.title instanceof HTMLInputElement
            ? panelInfo.title.value
            : (panelInfo?.title?.textContent || "")
    ).trim();
    const ts = Date.now();
    const nameBase = sourceTitle
        ? sourceTitle.replace(/\.[^.]+$/, "")
        : "ximageget-mask-source";
    const uploadName = `${nameBase}_${ts}.png`;
    const file = new File([blob], uploadName, {
        type: blob.type || "image/png",
    });
    const formData = new FormData();
    formData.append("image", file);
    formData.append("subfolder", "clipspace");
    const uploadResponse = await api.fetchApi("/upload/image", {
        method: "POST",
        body: formData,
    });
    if (!uploadResponse.ok) {
        throw new Error("Failed to upload mask source image");
    }
    const payload = await uploadResponse.json();
    return {
        filename: String(payload?.name || ""),
        subfolder: String(payload?.subfolder || ""),
        type: String(payload?.type || "input"),
    };
}

async function openMaskEditorForNode(node) {
    if (!canOpenMaskEditor(node)) {
        return;
    }
    const tempPreviewImage = createPreviewImageFromNode(node);
    if (!tempPreviewImage) {
        return;
    }
    try {
        const uploadedRef = await uploadCurrentNodeImageForMaskEditor(node);
        if (!uploadedRef.filename) {
            return;
        }
        const bridgeWidget = getMaskEditorBridgeWidget(node);
        // Clear the bridge widget value so loadFromNode falls back to
        // node.images[0] (our fresh upload) instead of the stale saved ref.
        if (bridgeWidget) {
            bridgeWidget.value = "";
            if (node.properties) {
                delete node.properties.image;
            }
        }
        const sessionToken = `${Date.now()}_${Math.random()
            .toString(36)
            .slice(2, 10)}`;
        node.__ximageget_mask_editor_session = sessionToken;
        node.__ximageget_mask_editor_prev_imgs = node.imgs;
        node.__ximageget_mask_editor_prev_images = node.images;
        node.__ximageget_mask_editor_prev_preview_type = node.previewMediaType;
        node.images = [uploadedRef];
        node.imgs = [tempPreviewImage];
        node.previewMediaType = "image";
        selectNodeForMaskEditor(node);
        await app.extensionManager.command.execute(
            "Comfy.MaskEditor.OpenMaskEditor"
        );
        watchMaskEditorClose(node, sessionToken);
    } catch (error) {
        scheduleTemporaryMaskEditorStateClear(node);
        scheduleLegacyCanvasPreviewClear(node);
        delete node.__ximageget_mask_editor_session;
        console.warn(
            t(
                MASK_EDITOR_UNAVAILABLE_KEY,
                MASK_EDITOR_UNAVAILABLE_FALLBACK
            ),
            error
        );
    }
}

function handleMaskEditorImageSaved(node, value) {
    if (String(node?.comfyClass || "") !== "XImageGet") {
        return;
    }
    const normalized = String(value || "").trim();
    setMaskImageRef(node, normalized);
    if (!normalized) {
        syncMaskButtonState(node);
        return;
    }
    const panelInfo = node?.__ximageget_panel;
    if (!panelInfo) {
        return;
    }
    const mediaRef = getStoredNodeValue(node);
    const previewUrl = getPreferredImagePreviewUrl(
        node,
        buildMediaFileUrl(mediaRef)
    );
    setPreview(panelInfo, {
        file_url: previewUrl,
        title: (
            panelInfo.title instanceof HTMLInputElement
                ? panelInfo.title.value
                : (panelInfo.title?.textContent || "")
        ),
    });
    scheduleLegacyCanvasPreviewClear(node);
    syncMaskButtonState(node);
}

function ensureHiddenWidget(node, widgetName, onChange = null) {
    if (!node) {
        return null;
    }
    const widgets = node.widgets || [];
    let widget = widgets.find((item) => item?.name === widgetName);
    if (!widget && typeof node.addWidget === "function") {
        widget = node.addWidget("text", widgetName, "", onChange || (() => {}));
    } else if (widget && typeof onChange === "function") {
        widget.callback = onChange;
    }
    if (widget) {
        widget.hidden = true;
        widget.serializeValue = () => widget.value;
    }
    return widget || null;
}

function getStorageWidget(node) {
    return ensureHiddenWidget(node, getStorageWidgetName(node));
}

function getTextTitleWidget(node) {
    const widgetName = getTextTitleWidgetName(node);
    if (!widgetName) {
        return null;
    }
    return ensureHiddenWidget(node, widgetName);
}

function getMaskStorageWidget(node) {
    if (String(node?.comfyClass || "") !== "XImageGet") {
        return null;
    }
    return ensureHiddenWidget(node, MASK_IMAGE_REF_WIDGET);
}

function getMaskEditorBridgeWidget(node) {
    if (String(node?.comfyClass || "") !== "XImageGet") {
        return null;
    }
    return ensureHiddenWidget(node, MASK_EDITOR_IMAGE_WIDGET, (value) => {
        handleMaskEditorImageSaved(node, value);
    });
}

function removeStorageInputSlot(node) {
    if (!node || !SUPPORTED_NODE_CLASSES.has(String(node?.comfyClass || ""))) {
        return;
    }
    if (!Array.isArray(node?.inputs)) {
        return;
    }
    const hiddenNames = new Set([getStorageWidgetName(node)]);
    const textTitleWidgetName = getTextTitleWidgetName(node);
    if (textTitleWidgetName) {
        hiddenNames.add(textTitleWidgetName);
    }
    if (String(node?.comfyClass || "") === "XImageGet") {
        hiddenNames.add(MASK_IMAGE_REF_WIDGET);
    }
    const nextInputs = node.inputs.filter((input) => {
        const name = String(input?.name || "");
        return !hiddenNames.has(name);
    });
    if (nextInputs.length === node.inputs.length) {
        return;
    }
    node.inputs = nextInputs;
    node?.graph?.setDirtyCanvas?.(true, true);
}

function getStoredNodeValue(node) {
    const widget = getStorageWidget(node);
    const value = widget?.value;
    const text = typeof value === "string" ? value : String(value || "");
    if (text) {
        return text;
    }
    const propertyName = getStoragePropertyName(node);
    const propertyValue = node?.properties?.[propertyName];
    return typeof propertyValue === "string"
        ? propertyValue
        : String(propertyValue || "");
}

function setStoredNodeValue(node, value) {
    const widget = getStorageWidget(node);
    const normalized = String(value || "");
    const propertyName = getStoragePropertyName(node);
    const currentValue = getStoredNodeValue(node);
    if (currentValue === normalized) {
        if (!node?.properties) {
            node.properties = {};
        }
        node.properties[propertyName] = normalized;
        if (widget) {
            widget.value = normalized;
        }
        return;
    }
    if (!node?.properties) {
        node.properties = {};
    }
    node.properties[propertyName] = normalized;
    if (!widget) {
        return;
    }
    widget.value = normalized;
    node?.graph?.setDirtyCanvas?.(true, true);
}

function getStoredNodeTitle(node) {
    const widget = getTextTitleWidget(node);
    const value = widget?.value;
    const text = typeof value === "string" ? value : String(value || "");
    if (text) {
        return text;
    }
    const propertyName = getTextTitlePropertyName(node);
    if (!propertyName) {
        return "";
    }
    const propertyValue = node?.properties?.[propertyName];
    return typeof propertyValue === "string"
        ? propertyValue
        : String(propertyValue || "");
}

function setStoredNodeTitle(node, value) {
    const propertyName = getTextTitlePropertyName(node);
    if (!propertyName) {
        return;
    }
    const widget = getTextTitleWidget(node);
    const normalized = String(value || "");
    const currentValue = getStoredNodeTitle(node);
    if (currentValue === normalized) {
        if (!node?.properties) {
            node.properties = {};
        }
        node.properties[propertyName] = normalized;
        if (widget) {
            widget.value = normalized;
        }
        return;
    }
    if (!node?.properties) {
        node.properties = {};
    }
    node.properties[propertyName] = normalized;
    if (!widget) {
        return;
    }
    widget.value = normalized;
    node?.graph?.setDirtyCanvas?.(true, true);
}

function getMaskImageRef(node) {
    const widget = getMaskStorageWidget(node);
    const value = widget?.value;
    if (typeof value === "string" && value) {
        return value;
    }
    const propertyValue = node?.properties?.[MASK_IMAGE_REF_PROPERTY];
    return typeof propertyValue === "string"
        ? propertyValue
        : String(propertyValue || "");
}

function setMaskImageRef(node, value) {
    if (String(node?.comfyClass || "") !== "XImageGet") {
        return;
    }
    const normalized = String(value || "");
    if (!node?.properties) {
        node.properties = {};
    }
    node.properties[MASK_IMAGE_REF_PROPERTY] = normalized;
    const widget = getMaskStorageWidget(node);
    if (widget) {
        widget.value = normalized;
    }
}

function hydrateStoredNodeValue(node) {
    if (!node) {
        return "";
    }
    const current = getStoredNodeValue(node);
    if (current) {
        return current;
    }
    const propertyValue = node?.properties?.[getStoragePropertyName(node)];
    if (isStringNode(node)) {
        if (propertyValue) {
            setStoredNodeValue(node, propertyValue);
            return String(propertyValue);
        }
        return "";
    }
    if (looksLikeMediaRef(propertyValue)) {
        setStoredNodeValue(node, propertyValue);
        return String(propertyValue);
    }
    const widgetValues = Array.isArray(node?.widgets_values)
        ? node.widgets_values
        : [];
    for (const item of widgetValues) {
        if (looksLikeMediaRef(item)) {
            setStoredNodeValue(node, item);
            return String(item);
        }
    }
    return "";
}

function hydrateStoredNodeTitle(node) {
    if (!isStringNode(node)) {
        return "";
    }
    const current = getStoredNodeTitle(node);
    if (current) {
        return current;
    }
    const propertyName = getTextTitlePropertyName(node);
    const propertyValue = propertyName
        ? node?.properties?.[propertyName]
        : "";
    if (propertyValue) {
        setStoredNodeTitle(node, propertyValue);
        return String(propertyValue);
    }
    const widgetValues = Array.isArray(node?.widgets_values)
        ? node.widgets_values
        : [];
    for (let index = widgetValues.length - 1; index >= 0; index -= 1) {
        const item = widgetValues[index];
        if (typeof item === "string" && item.trim()) {
            setStoredNodeTitle(node, item);
            return item;
        }
    }
    return "";
}

function restoreMediaPlayerState(node) {
    if (!node || !node.__ximageget_panel) return;
    const ps = node.__ximageget_panel.__xmgPlayerState;
    if (!ps) return;
    const widgets = node.widgets;
    if (!Array.isArray(widgets)) return;
    const loopWidget = widgets.find(function (w) { return w.name === "__loop"; });
    const unlockWidget = widgets.find(function (w) { return w.name === "__volume_unlocked"; });
    const volWidget = widgets.find(function (w) { return w.name === "__volume"; });
    // Restore volume unlock first (so volume max is correct)
    if (ps.lockBtn && unlockWidget && unlockWidget.value === "true" && !ps._volumeUnlocked) {
        ps.lockBtn.click();
    }
    // Restore volume level
    if (volWidget && volWidget.value && ps.volumeRange) {
        var saved = String(volWidget.value);
        if (saved !== String(ps.volumeRange.value)) {
            ps.volumeRange.value = saved;
            ps.volumeRange.dispatchEvent(new Event("input", { bubbles: true }));
        }
    }
    // Restore loop
    if (ps.loopBtn && loopWidget && loopWidget.value === "true") {
        var media = ps.audio || ps.video;
        if (media && !media.loop) {
            ps.loopBtn.click();
        }
    }
}

function installNodeUi(node) {
    if (!node) {
        return;
    }
    const nodeClass = String(node.comfyClass || "");
    if (!SUPPORTED_NODE_CLASSES.has(nodeClass)) {
        return;
    }
    if (node.__ximageget_panel) {
        removeStorageInputSlot(node);
        return;
    }
    removeStorageInputSlot(node);
    ensureStyles();
    clearLegacyCanvasPreview(node);
    const panelInfo = buildPanel(nodeClass);
    panelInfo.__ximageget_node = node;
    node.__ximageget_panel = panelInfo;
    applyPanelLocale(panelInfo);
    applyNodeBadge(panelInfo, node);
    scheduleBadgeSync(node, panelInfo);

    if (typeof node.addDOMWidget === "function") {
        node.addDOMWidget("ximageget_preview", "custom", panelInfo.panel, {
            serialize: false,
        });
    }
    refreshNodeBadge(node);

    // 持久化循环和音量解锁状态到隐藏 widget
    const _playerState_persist = panelInfo.__xmgPlayerState;
    const _kind_persist = panelInfo.mediaKind;
    if (_playerState_persist && (_kind_persist === "audio" || _kind_persist === "video")) {
        const loopWidget = ensureHiddenWidget(node, "__loop");
        const unlockWidget = ensureHiddenWidget(node, "__volume_unlocked");
        if (_playerState_persist.loopBtn) {
            _playerState_persist.loopBtn.addEventListener("click", function () {
                const media = _playerState_persist.audio || _playerState_persist.video;
                if (loopWidget) loopWidget.value = (media && media.loop) ? "true" : "";
            });
        }
        if (_playerState_persist.lockBtn) {
            _playerState_persist.lockBtn.addEventListener("click", function () {
                if (unlockWidget) unlockWidget.value = _playerState_persist._volumeUnlocked ? "true" : "";
            });
        }
        // 持久化音量值
        const volWidget = ensureHiddenWidget(node, "__volume");
        if (_playerState_persist.volumeRange) {
            _playerState_persist.volumeRange.addEventListener("input", function () {
                if (volWidget) volWidget.value = String(_playerState_persist.volumeRange.value);
            });
        }
        if (_playerState_persist.volumeBtn) {
            _playerState_persist.volumeBtn.addEventListener("click", function () {
                if (volWidget && _playerState_persist.volumeRange) {
                    volWidget.value = String(_playerState_persist.volumeRange.value);
                }
            });
        }
    }

    // 转发滚轮到 ComfyUI 主画布（避开可滚动区域内的原生滚轮）
    panelInfo.panel.addEventListener("wheel", function (e) {
        // 检查目标是否在可滚动元素内部（textarea、overflow:auto/scroll 且有溢出内容）
        for (var el = e.target; el && el !== panelInfo.panel; el = el.parentElement) {
            if (el.scrollHeight > el.clientHeight || el.scrollWidth > el.clientWidth) {
                var st = getComputedStyle(el);
                if (st.overflow.indexOf("auto") >= 0 || st.overflow.indexOf("scroll") >= 0 ||
                    st.overflowY.indexOf("auto") >= 0 || st.overflowY.indexOf("scroll") >= 0) {
                    return; // 让原生滚动处理
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
    })(panelInfo.panel);

    const consumeDragEvent = (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (typeof event.stopImmediatePropagation === "function") {
            event.stopImmediatePropagation();
        }
    };
    panelInfo.preview.addEventListener("dragenter", (event) => {
        consumeDragEvent(event);
        panelInfo.preview.classList.add("drag-over");
        if (event.dataTransfer) {
            event.dataTransfer.dropEffect = "copy";
        }
    });
    panelInfo.preview.addEventListener("dragover", (event) => {
        consumeDragEvent(event);
        panelInfo.preview.classList.add("drag-over");
        if (event.dataTransfer) {
            event.dataTransfer.dropEffect = "copy";
        }
    });
    panelInfo.preview.addEventListener("dragleave", (event) => {
        consumeDragEvent(event);
        panelInfo.preview.classList.remove("drag-over");
    });
    panelInfo.preview.addEventListener("drop", async (event) => {
        consumeDragEvent(event);
        panelInfo.preview.classList.remove("drag-over");
        const dataTransfer = event.dataTransfer;
        const payload = parseMediaDragPayload(dataTransfer);
        if (!payload) {
            return;
        }
        if (panelInfo.mediaKind === "text") {
            const textValue = String(payload.text_value || "");
            if (!textValue.trim()) {
                return;
            }
            setPreview(panelInfo, {
                text_value: textValue,
                title: payload.title || "",
            });
            setStoredNodeValue(node, textValue);
            setStoredNodeTitle(node, payload.title || "");
            return;
        }
        if (
            payload.media_type
            && payload.media_type !== panelInfo.mediaKind
        ) {
            return;
        }
        const mediaRef = String(payload.media_ref || "");
        const fileUrl = buildMediaFileUrl(mediaRef);
        if (!fileUrl) {
            return;
        }
        setPreview(panelInfo, {
            file_url: fileUrl,
            title: payload.title || "",
        });
        setStoredNodeValue(node, mediaRef);
    });
    if (
        panelInfo.mediaKind === "text"
        && panelInfo.textEl instanceof HTMLTextAreaElement
    ) {
        if (panelInfo.title instanceof HTMLInputElement) {
            panelInfo.title.addEventListener("input", () => {
                const nextTitle = String(panelInfo.title.value || "");
                if (getStoredNodeTitle(node) === nextTitle) {
                    return;
                }
                setStoredNodeTitle(node, nextTitle);
                setTooltipText(panelInfo.title, nextTitle);
            });
        }
        panelInfo.textEl.addEventListener("input", () => {
            const nextValue = String(panelInfo.textEl.value || "");
            if (getStoredNodeValue(node) === nextValue) {
                return;
            }
            setStoredNodeValue(node, nextValue);
            syncTextPreviewEmptyState(panelInfo, nextValue);
            panelInfo.__xmediaget_preview_state = nextValue
                ? PREVIEW_STATE_LOADED
                : PREVIEW_STATE_EMPTY;
            panelInfo.preview.classList.toggle("has-media", Boolean(nextValue));
            panelInfo.placeholder.textContent = "";
        });
    }
    if (panelInfo.clearBtn instanceof HTMLButtonElement) {
        panelInfo.clearBtn.addEventListener("click", (event) => {
            consumeDragEvent(event);
            setStoredNodeValue(node, "");
            setStoredNodeTitle(node, "");
            setMaskImageRef(node, "");
            setPreview(panelInfo, {});
        });
    }
    if (panelInfo.maskBtn instanceof HTMLButtonElement) {
        panelInfo.maskBtn.addEventListener("click", async (event) => {
            consumeDragEvent(event);
            await openMaskEditorForNode(node);
        });
    }
    getMaskStorageWidget(node);
    getTextTitleWidget(node);
    getMaskEditorBridgeWidget(node);
    ensureNodeMinSize(node);
    const stored = hydrateStoredNodeValue(node) || getStoredNodeValue(node);
    const storedTitle = hydrateStoredNodeTitle(node) || getStoredNodeTitle(node);
    if (stored || storedTitle) {
        restoreStoredData(node, stored, storedTitle);
    }
    syncMaskButtonState(node);
}

function ensureNodeMinSize(node) {
    if (!node) {
        return;
    }
    const [baseMinWidth, minHeight] = getNodeMinSize(node);
    const minWidth = resolveAdaptiveMinWidth(node, baseMinWidth);
    node.min_size = [minWidth, minHeight];
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
    if (node.__ximageget_resize_guard) {
        return;
    }
    node.__ximageget_resize_guard = true;
    const origOnResize = node.onResize;
    node.onResize = function (size) {
        const [resizeBaseMinWidth, resizeMinHeight] = getNodeMinSize(this);
        const resizeMinWidth = resolveAdaptiveMinWidth(this, resizeBaseMinWidth);
        this.min_size = [resizeMinWidth, resizeMinHeight];
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

function restoreStoredData(node, stored, storedTitle = "") {
    const value = String(stored || "");
    const titleValue = String(storedTitle || "");
    if (!value && !titleValue) {
        return;
    }
    clearLegacyCanvasPreview(node);
    const panelInfo = node?.__ximageget_panel;
    const nodeClass = String(node?.comfyClass || "");
    if (nodeClass === STRING_NODE_CLASS) {
        if (panelInfo) {
            setPreview(panelInfo, {
                text_value: value,
                title: titleValue,
            });
        }
        return;
    }
    const mediaRef = value;
    const fallbackUrl = getPreferredImagePreviewUrl(
        node,
        buildMediaFileUrl(mediaRef)
    );
    if (panelInfo) {
        setPreview(panelInfo, {
            file_url: fallbackUrl,
            title: (
                panelInfo?.title instanceof HTMLInputElement
                    ? panelInfo.title.value
                    : (panelInfo?.title?.textContent || "")
            ),
        });
    }
    fetchMediaMeta(mediaRef).then((payload) => {
        if (!payload || getStoredNodeValue(node) !== mediaRef) {
            return;
        }
        const fileUrl = String(payload.file_url || fallbackUrl || "");
        if (!fileUrl) {
            return;
        }
        setPreview(panelInfo, {
            file_url: getPreferredImagePreviewUrl(node, fileUrl),
            title: String(payload.title || ""),
        });
    }).catch(() => {});
}

function installExistingNodes() {
    const rootGraph = app.graph;
    if (!rootGraph) {
        return;
    }
    forEachNodeInGraphTree(rootGraph, (node) => {
        installNodeUi(node);
        if (SUPPORTED_NODE_CLASSES.has(String(node?.comfyClass || ""))) {
            getStorageWidget(node);
            getTextTitleWidget(node);
        }
    });
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
    const targetId = String(nodeId ?? "").trim();
    if (!targetId) {
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
        if (scopedId === targetId) {
            scopedMatch = node;
            return;
        }
        if (
            !targetId.includes(":")
            && !plainMatch
            && String(node?.id ?? "").trim() === targetId
        ) {
            plainMatch = node;
        }
    });
    return scopedMatch || plainMatch;
}

function updateNodeMediaRef(node, mediaRef, title) {
    if (!node) {
        return;
    }
    clearLegacyCanvasPreview(node);
    if (!node.__ximageget_panel) {
        installNodeUi(node);
    }
    const panelInfo = node.__ximageget_panel;
    setMaskImageRef(node, "");
    const fileUrl = getPreferredImagePreviewUrl(node, buildMediaFileUrl(mediaRef));
    if (panelInfo) {
        setPreview(panelInfo, { file_url: fileUrl, title });
    }
    setStoredNodeValue(node, mediaRef);
}

function updateNodeTextValue(node, textValue, title) {
    if (!node) {
        return;
    }
    if (!node.__ximageget_panel) {
        installNodeUi(node);
    }
    const panelInfo = node.__ximageget_panel;
    const text = String(textValue || "");
    const finalTitle = String(title || "");
    if (panelInfo) {
        setPreview(panelInfo, {
            text_value: text,
            title: finalTitle,
        });
    }
    setStoredNodeValue(node, text);
    setStoredNodeTitle(node, finalTitle);
}

function collectNodesByClass(nodeClass) {
    const targetClass = String(nodeClass || "");
    if (!SUPPORTED_NODE_CLASSES.has(targetClass)) {
        return [];
    }
    const rootGraph = app.graph;
    if (!rootGraph) {
        return [];
    }
    const items = [];
    forEachNodeInGraphTree(rootGraph, (node, scopedId) => {
        if (node?.comfyClass !== targetClass) {
            return;
        }
        const accentIndex = getNodeAccentIndex(scopedId);
        items.push({
            id: scopedId,
            title: String(node.title || targetClass),
            accent_index: accentIndex >= 0 ? accentIndex : null,
        });
    });
    return items;
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

export function initXMediaGetExtension() {
    if (ROOT[EXT_GUARD_KEY]) {
        return;
    }
    ROOT[EXT_GUARD_KEY] = true;
    app.registerExtension({
        name: EXT_NAME,
        async beforeRegisterNodeDef(nodeType, nodeData) {
            const nodeClass = String(nodeData?.name || "");
            if (!SUPPORTED_NODE_CLASSES.has(nodeClass)) {
                return;
            }
            const orig = nodeType.prototype.onNodeCreated;
            const origOnConfigure = nodeType.prototype.onConfigure;
            nodeType.prototype.onNodeCreated = function () {
                orig?.apply(this, arguments);
                installNodeUi(this);
                restoreStoredData(
                    this,
                    hydrateStoredNodeValue(this) || getStoredNodeValue(this),
                    hydrateStoredNodeTitle(this) || getStoredNodeTitle(this),
                );
                refreshNodeBadge(this);
                restoreMediaPlayerState(this);
            };
            nodeType.prototype.onConfigure = function () {
                origOnConfigure?.apply(this, arguments);
                installNodeUi(this);
                const stored = hydrateStoredNodeValue(this)
                    || getStoredNodeValue(this);
                const storedTitle = hydrateStoredNodeTitle(this)
                    || getStoredNodeTitle(this);
                if (stored || storedTitle) {
                    restoreStoredData(this, stored, storedTitle);
                }
                refreshNodeBadge(this);
                restoreMediaPlayerState(this);
            };
        },
        async nodeCreated(node) {
            installNodeUi(node);
            refreshNodeBadge(node);
            if (SUPPORTED_NODE_CLASSES.has(String(node?.comfyClass || ""))) {
                getStorageWidget(node);
                getTextTitleWidget(node);
            }
        },
        async loadedGraphNode(node) {
            const comfyClass = String(node?.comfyClass || "");
            if (!SUPPORTED_NODE_CLASSES.has(comfyClass)) {
                return;
            }
            installNodeUi(node);
            restoreStoredData(
                node,
                hydrateStoredNodeValue(node) || getStoredNodeValue(node),
                hydrateStoredNodeTitle(node) || getStoredNodeTitle(node),
            );
            refreshNodeBadge(node);
        },
        async setup() {
            await applyUiLocale();
            installLocaleSync();
            const rootOrigin = window.location.origin;
            ROOT.addEventListener("message", (event) => {
                if (event?.source !== ROOT || event.origin !== rootOrigin) {
                    return;
                }
                const payload = event?.data;
                if (!payload || typeof payload !== "object") {
                    return;
                }
                const replyNodeSendAck = (requestId, nodeId, ok, error = "") => {
                    if (!requestId) {
                        return;
                    }
                    event.source?.postMessage?.(
                        {
                            type: "xdatahub:send_to_node_ack",
                            data: {
                                request_id: String(requestId),
                                node_id: nodeId,
                                ok: !!ok,
                                error: String(error || ""),
                            },
                        },
                        rootOrigin
                    );
                };
                if (payload.type === "xdatahub:ui-locale") {
                    applyUiLocale(payload.locale).catch(() => {});
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
                if (payload.type === "xdatahub:request_media_get_nodes") {
                    const requestId = payload.request_id;
                    const nodeClass = String(payload.node_class || "");
                    if (!SUPPORTED_NODE_CLASSES.has(nodeClass)) {
                        return;
                    }
                    event.source?.postMessage?.(
                        {
                            type: "xdatahub:media_get_nodes",
                            request_id: requestId,
                            node_class: nodeClass,
                            nodes: collectNodesByClass(nodeClass),
                        },
                        rootOrigin
                    );
                    return;
                }
                if (payload.type === "xdatahub:send_to_node") {
                    const data = payload.data || {};
                    const requestId = String(data.request_id || "");
                    const nodeId = String(data.node_id ?? "").trim();
                    const mediaRef = String(data.media_ref || "");
                    const textValue = String(data.text_value || "");
                    const nodeClass = String(data.node_class || "");
                    if (nodeClass && !SUPPORTED_NODE_CLASSES.has(nodeClass)) {
                        return;
                    }
                    if (!nodeId) {
                        replyNodeSendAck(
                            requestId,
                            data.node_id,
                            false,
                            "Invalid node id"
                        );
                        return;
                    }
                    const node = getNodeById(nodeId);
                    if (!node) {
                        replyNodeSendAck(
                            requestId,
                            nodeId,
                            false,
                            "Target node not found"
                        );
                        return;
                    }
                    if (
                        nodeClass
                        && SUPPORTED_NODE_CLASSES.has(nodeClass)
                        && node.comfyClass !== nodeClass
                    ) {
                        replyNodeSendAck(
                            requestId,
                            nodeId,
                            false,
                            "Target node type mismatch"
                        );
                        return;
                    }
                    if (!SUPPORTED_NODE_CLASSES.has(String(node.comfyClass || ""))) {
                        replyNodeSendAck(
                            requestId,
                            nodeId,
                            false,
                            "Unsupported target node"
                        );
                        return;
                    }
                    try {
                        if (String(node.comfyClass || "") === STRING_NODE_CLASS) {
                            updateNodeTextValue(node, textValue, data.title || "");
                            replyNodeSendAck(requestId, nodeId, true);
                            return;
                        }
                        if (!mediaRef) {
                            replyNodeSendAck(
                                requestId,
                                nodeId,
                                false,
                                "Missing media reference"
                            );
                            return;
                        }
                        updateNodeMediaRef(node, mediaRef, data.title || "");
                        replyNodeSendAck(requestId, nodeId, true);
                        return;
                    } catch (error) {
                        replyNodeSendAck(
                            requestId,
                            nodeId,
                            false,
                            error?.message || "Failed to update target node"
                        );
                        return;
                    }
                }
                if (payload.type === "xdatahub:image_sent") {
                    return;
                }
            });
        },
    });
    setTimeout(() => {
        installExistingNodes();
    }, 0);
}

ROOT.__xmediaget_extension_loaded__ = true;
ROOT.__xmediaget_extension_init__ = initXMediaGetExtension;
initXMediaGetExtension();
