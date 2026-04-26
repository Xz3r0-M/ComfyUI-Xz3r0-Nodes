import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";
import {
    getHashedAccentIndex as getNodeAccentIndex,
    getHexAccentFromHashedKey as getNodeAccentColor,
} from "./core/node-accent.js";
import { openXMaskEditor } from "./x-mask-editor/index.js?v=20260406h";

const EXT_NAME = "xz3r0.ximageget";
const EXT_GUARD_KEY = "__ximageget_extension_registered__";
const ROOT = globalThis;
const NODE_CLASS = "XImageGet";
const SUPPORTED_NODE_CLASSES = new Set([NODE_CLASS]);
const MEDIA_REF_WIDGET = "media_ref";
const X_MASK_REF_WIDGET = "x_mask_ref";
const X_PAINT_REF_WIDGET = "x_paint_ref";
const X_TRANSFORM_STATE_WIDGET = "x_transform_state";
const MEDIA_REF_PROPERTY = "__xdatahub_media_ref";
const TITLE_PROPERTY = "__ximageget2_title";
const X_MASK_REF_PROPERTY = "__ximageget2_mask_ref";
const X_PAINT_REF_PROPERTY = "__ximageget2_paint_ref";
const X_TRANSFORM_STATE_PROPERTY = "__ximageget2_transform_state";
const X_MASK_SAVED_REF_PROPERTY = "__ximageget2_mask_saved_ref";
const X_MASK_SAVE_SEPARATE_PROPERTY = "__ximageget2_mask_save_separate";
const XDATAHUB_MEDIA_MIME = "application/x-xdatahub-media+json";
const DEFAULT_MIN_NODE_WIDTH = 260;
const DEFAULT_MIN_NODE_HEIGHT = 356;
const STYLE_ID = "ximageget-extension-style";
const TOOLTIP_ID = "ximageget-global-tooltip";
const TOOLTIP_VIEWPORT_MARGIN = 12;
const TOOLTIP_CURSOR_OFFSET_X = 16;
const TOOLTIP_CURSOR_OFFSET_Y = 26;
const PREVIEW_STATE_EMPTY = "empty";
const PREVIEW_STATE_LOADED = "loaded";
const PREVIEW_STATE_MISSING = "missing";
const COMFY_LOCALE_KEY = "Comfy.Locale";
const LOCALE_SYNC_INTERVAL_MS = 1000;
const OPEN_MASK_EDITOR_LABEL_KEY =
    "xdatahub.ui.node.ximageget.open_mask_editor";
const OPEN_MASK_EDITOR_LABEL_FALLBACK = "Mask Editor";
const MASK_EDITOR_UNAVAILABLE_KEY =
    "xdatahub.ui.node.ximageget.mask_editor_unavailable";
const MASK_EDITOR_UNAVAILABLE_FALLBACK = "XMaskEditor unavailable";
const MASK_EDITOR_I18N_PREFIX = "xdatahub.ui.node.ximageget.mask_editor";
const CLEAR_BTN_LABEL_KEY = "xdatahub.ui.node.xmediaget.clear_loaded_media";
const CLEAR_BTN_LABEL_FALLBACK = "Clear loaded content";

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
};

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
    uiLocalePrimary = locale === "en"
        ? uiLocaleFallback
        : await fetchLocaleJson(locale);
    return locale;
}

function refreshAllPanelLocales() {
    const rootGraph = app.graph;
    if (!rootGraph) {
        return;
    }
    forEachNodeInGraphTree(rootGraph, (node) => {
        const panelInfo = node?.__ximageget2_panel;
        if (panelInfo) {
            applyPanelLocale(panelInfo);
        }
    });
}

async function applyUiLocale(localeOverride = null) {
    currentUiLocale = await loadUiLocaleBundle(localeOverride);
    refreshAllPanelLocales();
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
            && setting.__ximageget2LocaleHookInstalled !== true) {
            const originalSet = setting.set.bind(setting);
            setting.set = (...args) => {
                const result = originalSet(...args);
                if (String(args[0] || "") === COMFY_LOCALE_KEY) {
                    Promise.resolve(result).finally(refreshLocale);
                }
                return result;
            };
            setting.__ximageget2LocaleHookInstalled = true;
        }
    } catch {
        // ignore locale hook failures
    }
    window.setInterval(() => {
        if (document.hidden) {
            return;
        }
        const nextLocale = resolveComfyLocale();
        if (nextLocale !== currentUiLocale) {
            refreshLocale();
        }
    }, LOCALE_SYNC_INTERVAL_MS);
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
        background: "rgba(16, 16, 16, 0.97)",
        border: "1px solid #666",
        borderRadius: "8px",
        padding: "6px 10px",
        maxWidth: "240px",
        boxSizing: "border-box",
        color: "#f2f2f2",
        boxShadow: "0 8px 22px rgba(0, 0, 0, 0.55)",
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
        target.dataset.ximageget2Tooltip = value;
    } else {
        delete target.dataset.ximageget2Tooltip;
    }
    target.removeAttribute("title");
}

function readTooltipText(target) {
    if (!(target instanceof HTMLElement)) {
        return "";
    }
    return String(target.dataset.ximageget2Tooltip || "").trim();
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
        Math.min(viewportWidth - tooltipWidth - TOOLTIP_VIEWPORT_MARGIN, left)
    );
    top = Math.max(
        TOOLTIP_VIEWPORT_MARGIN,
        Math.min(viewportHeight - tooltipHeight - TOOLTIP_VIEWPORT_MARGIN, top)
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
    if (!(target instanceof HTMLElement) || target.__ximageget2TooltipBound) {
        return;
    }
    target.__ximageget2TooltipBound = true;
    target.addEventListener("mouseenter", (event) => {
        showTooltip(target, event);
    });
    target.addEventListener("mousemove", (event) => {
        const tooltip = document.getElementById(TOOLTIP_ID);
        if (tooltip instanceof HTMLElement && tooltip.style.display === "block") {
            positionTooltip(tooltip, event);
        }
    });
    target.addEventListener("mouseleave", hideTooltip);
    target.addEventListener("blur", hideTooltip);
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
        if (source !== "xdatahub" || !mediaRef) {
            return null;
        }
        return {
            media_ref: mediaRef,
            media_type: mediaType,
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
        const payload = await response.json();
        return payload && typeof payload === "object" ? payload : null;
    } catch {
        return null;
    }
}

function getNodeUiConfig(nodeClass) {
    const key = String(nodeClass || "");
    const config = NODE_UI_CONFIG[key] || NODE_UI_CONFIG.XImageGet;
    return {
        ...config,
        placeholder: t(
            config.placeholderKey,
            config.placeholderFallback || "Drop an XDataHub image card here"
        ),
        missing: t(
            config.missingKey,
            config.missingFallback || "Image missing"
        ),
        titlePlaceholder: t(
            config.titlePlaceholderKey,
            config.titlePlaceholderFallback || "Filename"
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
        .ximageget-mask-btn,
        .ximageget-clear-btn {
            min-width: 40px;
            height: 22px;
            padding: 0 8px;
            border-radius: 6px;
            border: 1px solid var(--borderColor, #555);
            background: var(--bgColor, #222);
            color: #f2f2f2;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            font-size: 12px;
            line-height: 1;
            transition: border-color 120ms ease, background-color 120ms ease;
            flex: 0 0 auto;
        }
        .ximageget-mask-btn {
            margin-left: 0;
        }
        .ximageget-mask-btn:hover,
        .ximageget-mask-btn:focus-visible,
        .ximageget-clear-btn:hover,
        .ximageget-clear-btn:focus-visible {
            border-color: var(--ximageget-accent, #888);
            background: #2b2b2b;
            outline: none;
        }
        .ximageget-mask-btn:disabled,
        .ximageget-clear-btn:disabled {
            opacity: 0.45;
            cursor: not-allowed;
        }
        .ximageget-badge {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            padding: 4px 12px;
            margin-right: auto;
            border-radius: 999px;
            border: 1px solid var(--ximageget-accent, #888);
            background: var(--bgColor, #222);
        }
        .ximageget-badge-chip {
            font-size: 16px;
            line-height: 1;
            font-weight: 700;
            font-variant-numeric: tabular-nums;
            font-family: ui-monospace, "Cascadia Mono", "Consolas", monospace;
            letter-spacing: 0.15px;
            color: var(--ximageget-accent, #888);
        }
        .ximageget-badge-swatch {
            width: 18px;
            height: 18px;
            border-radius: 5px;
            background: var(--ximageget-accent, #888);
            box-shadow: inset 0 0 0 1px var(--borderColor, #555);
        }
        .ximageget-preview {
            width: 100%;
            min-height: 180px;
            border: 1px solid var(--borderColor, #555);
            background: var(--bgColor, #222);
            position: relative;
            display: flex;
            align-items: center;
            justify-content: center;
            overflow: hidden;
            flex: 1 1 auto;
        }
        .ximageget-preview.drag-over {
            border-color: var(--xdh-brand-pink, #EA005E);
            box-shadow: 0 0 0 1px var(--xdh-brand-pink, #EA005E);
        }
        .ximageget-preview.has-media .ximageget-base-image {
            display: block;
        }
        .ximageget-base-image {
            position: absolute;
            inset: 0;
            width: 100%;
            height: 100%;
            object-fit: contain;
            display: none;
            pointer-events: none;
        }
        .ximageget-paint-overlay {
            position: absolute;
            inset: 0;
            width: 100%;
            height: 100%;
            object-fit: contain;
            display: none;
            pointer-events: none;
        }
        .ximageget-preview.has-paint .ximageget-paint-overlay {
            display: block;
        }
        .ximageget-mask-overlay {
            position: absolute;
            inset: 0;
            display: none;
            pointer-events: none;
            background: rgba(255, 68, 68, 0.42);
            mask-repeat: no-repeat;
            mask-position: center;
            mask-size: contain;
            -webkit-mask-repeat: no-repeat;
            -webkit-mask-position: center;
            -webkit-mask-size: contain;
        }
        .ximageget-preview.has-mask .ximageget-mask-overlay {
            display: block;
        }
        .ximageget-placeholder {
            position: absolute;
            left: 50%;
            top: 50%;
            transform: translate(-50%, -50%);
            font-size: 13px;
            color: #ffffff;
            font-weight: 600;
            width: calc(100% - 24px);
            max-width: 220px;
            text-align: center;
            line-height: 1.45;
            pointer-events: none;
            text-shadow:
                0 0 6px rgba(0, 0, 0, 0.9),
                0 0 10px rgba(0, 0, 0, 0.75);
        }
        .ximageget-placeholder:empty {
            display: none;
        }
        .ximageget-footer {
            display: flex;
            align-items: center;
            gap: 6px;
            flex: 0 0 auto;
            min-height: 24px;
        }
        .ximageget-title {
            font-size: 12px;
            color: #ffffff;
            background: #222222;
            padding: 4px 6px;
            border-radius: 6px;
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
            color: rgba(255, 255, 255, 0.65);
        }
        .ximageget-title:focus {
            border-color: var(--xdh-brand-pink, #EA005E);
            box-shadow: 0 0 0 1px var(--xdh-brand-pink, #EA005E);
        }
    `;
    document.head.appendChild(style);
}

function buildPanel(nodeClass) {
    const config = getNodeUiConfig(nodeClass);
    const panel = document.createElement("div");
    panel.className = "ximageget-panel";

    const meta = document.createElement("div");
    meta.className = "ximageget-meta";

    const kindEmoji = document.createElement("span");
    kindEmoji.className = "ximageget-kind-emoji";
    kindEmoji.textContent = String(config.emoji || "🖼️");
    kindEmoji.setAttribute("aria-hidden", "true");

    const badge = document.createElement("div");
    badge.className = "ximageget-badge";
    const badgeChip = document.createElement("span");
    badgeChip.className = "ximageget-badge-chip";
    badgeChip.textContent = "--";
    const badgeSwatch = document.createElement("span");
    badgeSwatch.className = "ximageget-badge-swatch";
    badge.appendChild(badgeChip);
    badge.appendChild(badgeSwatch);

    const maskBtn = document.createElement("button");
    maskBtn.className = "ximageget-mask-btn";
    maskBtn.type = "button";
    maskBtn.disabled = true;

    const preview = document.createElement("div");
    preview.className = "ximageget-preview";
    const baseImage = document.createElement("img");
    baseImage.className = "ximageget-base-image";
    baseImage.alt = nodeClass || NODE_CLASS;
    const paintOverlay = document.createElement("img");
    paintOverlay.className = "ximageget-paint-overlay";
    paintOverlay.alt = "";
    paintOverlay.style.display = "none";
    const maskOverlay = document.createElement("div");
    maskOverlay.className = "ximageget-mask-overlay";
    maskOverlay.style.display = "none";
    const placeholder = document.createElement("div");
    placeholder.className = "ximageget-placeholder";
    placeholder.textContent = config.placeholder;
    preview.appendChild(baseImage);
    preview.appendChild(paintOverlay);
    preview.appendChild(maskOverlay);
    preview.appendChild(placeholder);

    const title = document.createElement("input");
    title.className = "ximageget-title";
    title.type = "text";
    title.value = "";
    title.placeholder = config.titlePlaceholder;
    title.spellcheck = false;

    const clearBtn = document.createElement("button");
    clearBtn.className = "ximageget-clear-btn";
    clearBtn.type = "button";
    clearBtn.textContent = "🗑️";

    meta.appendChild(badge);
    meta.appendChild(maskBtn);
    meta.appendChild(kindEmoji);

    const footer = document.createElement("div");
    footer.className = "ximageget-footer";
    footer.appendChild(title);
    footer.appendChild(clearBtn);

    panel.appendChild(meta);
    panel.appendChild(preview);
    panel.appendChild(footer);

    for (const target of [badge, maskBtn, title, clearBtn]) {
        bindTooltipTarget(target);
    }

    return {
        panel,
        meta,
        preview,
        baseImage,
        paintOverlay,
        maskOverlay,
        placeholder,
        title,
        clearBtn,
        maskBtn,
        badge,
        badgeChip,
        badgeSwatch,
        mediaKind: config.kind,
        nodeClass: String(nodeClass || NODE_CLASS),
        placeholderText: config.placeholder,
        missingText: config.missing,
        __ximageget2_preview_state: PREVIEW_STATE_EMPTY,
    };
}

function applyPanelLocale(panelInfo) {
    if (!panelInfo) {
        return;
    }
    const config = getNodeUiConfig(panelInfo.nodeClass);
    panelInfo.placeholderText = config.placeholder;
    panelInfo.missingText = config.missing;
    panelInfo.title.placeholder = config.titlePlaceholder;
    const clearLabel = t(CLEAR_BTN_LABEL_KEY, CLEAR_BTN_LABEL_FALLBACK);
    const maskLabel = t(
        OPEN_MASK_EDITOR_LABEL_KEY,
        OPEN_MASK_EDITOR_LABEL_FALLBACK
    );
    setTooltipText(panelInfo.clearBtn, clearLabel);
    setTooltipText(panelInfo.maskBtn, maskLabel);
    panelInfo.clearBtn.setAttribute("aria-label", clearLabel);
    panelInfo.maskBtn.setAttribute("aria-label", maskLabel);
    panelInfo.maskBtn.textContent = maskLabel;
    const state = String(panelInfo.__ximageget2_preview_state || PREVIEW_STATE_EMPTY);
    if (state === PREVIEW_STATE_EMPTY) {
        panelInfo.placeholder.textContent = panelInfo.placeholderText;
    } else if (state === PREVIEW_STATE_MISSING) {
        panelInfo.placeholder.textContent = panelInfo.missingText;
    }
}

function setMaskOverlay(element, maskUrl) {
    const normalized = String(maskUrl || "").trim();
    if (!(element instanceof HTMLElement)) {
        return;
    }
    if (!normalized) {
        element.style.maskImage = "none";
        element.style.webkitMaskImage = "none";
        return;
    }
    const cssValue = `url("${normalized}")`;
    element.style.maskImage = cssValue;
    element.style.webkitMaskImage = cssValue;
}

function clearMediaElementHandlers(imageEl) {
    if (!imageEl) {
        return;
    }
    imageEl.onload = null;
    imageEl.onerror = null;
}

function normalizeTransformState(value) {
    const raw = String(value || "").trim();
    if (!raw) {
        return {
            rotation: 0,
            flipX: false,
            flipY: false,
        };
    }
    try {
        const parsed = JSON.parse(raw);
        const rotation = Number(parsed?.rotation ?? 0);
        return {
            rotation: Number.isFinite(rotation)
                ? ((Math.round(rotation) % 4) + 4) % 4
                : 0,
            flipX: !!parsed?.flipX,
            flipY: !!parsed?.flipY,
        };
    } catch {
        return {
            rotation: 0,
            flipX: false,
            flipY: false,
        };
    }
}

function buildPreviewTransformCss(value) {
    const state = normalizeTransformState(value);
    const transforms = [];
    if (state.flipX) {
        transforms.push("scaleX(-1)");
    }
    if (state.flipY) {
        transforms.push("scaleY(-1)");
    }
    if (state.rotation) {
        transforms.push(`rotate(${state.rotation * 90}deg)`);
    }
    return transforms.length > 0 ? transforms.join(" ") : "none";
}

function applyPreviewTransform(panelInfo, value) {
    if (!panelInfo) {
        return;
    }
    const cssValue = buildPreviewTransformCss(value);
    for (const element of [
        panelInfo.baseImage,
        panelInfo.paintOverlay,
        panelInfo.maskOverlay,
    ]) {
        if (!(element instanceof HTMLElement)) {
            continue;
        }
        element.style.transform = cssValue;
        element.style.transformOrigin = "center center";
    }
}

function setPreview(panelInfo, data = {}) {
    if (!panelInfo) {
        return;
    }
    const fileUrl = String(data?.file_url || "");
    const maskUrl = String(data?.mask_url || "");
    const transformState = String(data?.transform_state || "");
    const label = String(data?.title || "");
    const loadToken = (Number(panelInfo.__ximageget2_load_token) || 0) + 1;
    panelInfo.__ximageget2_load_token = loadToken;
    applyPreviewTransform(panelInfo, transformState);

    if (!fileUrl) {
        panelInfo.__ximageget2_preview_state = PREVIEW_STATE_EMPTY;
        panelInfo.preview.classList.remove("has-media", "has-paint", "has-mask");
        panelInfo.placeholder.textContent = panelInfo.placeholderText;
        clearMediaElementHandlers(panelInfo.baseImage);
        clearMediaElementHandlers(panelInfo.paintOverlay);
        panelInfo.baseImage.removeAttribute("src");
        panelInfo.paintOverlay.removeAttribute("src");
        panelInfo.paintOverlay.style.display = "none";
        setMaskOverlay(panelInfo.maskOverlay, "");
        panelInfo.maskOverlay.style.display = "none";
        if (panelInfo.title instanceof HTMLInputElement) {
            panelInfo.title.value = label;
            setTooltipText(panelInfo.title, label);
        }
        syncMaskButtonState(panelInfo.__ximageget2_node);
        return;
    }

    const cacheBustedBase = fileUrl.includes("?")
        ? `${fileUrl}&ts=${Date.now()}`
        : `${fileUrl}?ts=${Date.now()}`;
    const paintUrl = String(data?.paint_url || "");
    const cacheBustedPaint = paintUrl
        ? (paintUrl.includes("?")
            ? `${paintUrl}&ts=${Date.now()}`
            : `${paintUrl}?ts=${Date.now()}`)
        : "";
    const cacheBustedMask = maskUrl
        ? (maskUrl.includes("?")
            ? `${maskUrl}&ts=${Date.now()}`
            : `${maskUrl}?ts=${Date.now()}`)
        : "";

    clearMediaElementHandlers(panelInfo.baseImage);
    panelInfo.baseImage.onload = () => {
        if (panelInfo.__ximageget2_load_token !== loadToken) {
            return;
        }
        panelInfo.__ximageget2_preview_state = PREVIEW_STATE_LOADED;
        panelInfo.preview.classList.add("has-media");
        panelInfo.placeholder.textContent = "";
        syncMaskButtonState(panelInfo.__ximageget2_node);
    };
    panelInfo.baseImage.onerror = () => {
        if (panelInfo.__ximageget2_load_token !== loadToken) {
            return;
        }
        panelInfo.__ximageget2_preview_state = PREVIEW_STATE_MISSING;
        panelInfo.preview.classList.remove("has-media", "has-paint", "has-mask");
        panelInfo.paintOverlay.style.display = "none";
        panelInfo.maskOverlay.style.display = "none";
        panelInfo.placeholder.textContent = panelInfo.missingText;
        syncMaskButtonState(panelInfo.__ximageget2_node);
    };
    panelInfo.baseImage.src = cacheBustedBase;
    panelInfo.baseImage.alt = label || panelInfo.nodeClass || NODE_CLASS;
    clearMediaElementHandlers(panelInfo.paintOverlay);
    panelInfo.paintOverlay.onload = () => {
        if (panelInfo.__ximageget2_load_token !== loadToken) {
            return;
        }
        panelInfo.paintOverlay.style.display = "";
        panelInfo.preview.classList.add("has-paint");
    };
    panelInfo.paintOverlay.onerror = () => {
        if (panelInfo.__ximageget2_load_token !== loadToken) {
            return;
        }
        panelInfo.preview.classList.remove("has-paint");
        panelInfo.paintOverlay.style.display = "none";
        panelInfo.paintOverlay.removeAttribute("src");
    };
    panelInfo.preview.classList.remove("has-paint");
    panelInfo.paintOverlay.style.display = "none";
    if (cacheBustedPaint) {
        panelInfo.paintOverlay.src = cacheBustedPaint;
    } else {
        panelInfo.paintOverlay.removeAttribute("src");
    }
    setMaskOverlay(panelInfo.maskOverlay, "");
    panelInfo.preview.classList.remove("has-mask");
    panelInfo.maskOverlay.style.display = "none";
    if (cacheBustedMask) {
        const maskProbe = new Image();
        maskProbe.onload = () => {
            if (panelInfo.__ximageget2_load_token !== loadToken) {
                return;
            }
            setMaskOverlay(
                panelInfo.maskOverlay,
                cacheBustedMask
            );
            panelInfo.maskOverlay.style.display = "";
            panelInfo.preview.classList.add("has-mask");
        };
        maskProbe.onerror = () => {
            if (panelInfo.__ximageget2_load_token !== loadToken) {
                return;
            }
            panelInfo.preview.classList.remove("has-mask");
            panelInfo.maskOverlay.style.display = "none";
            setMaskOverlay(panelInfo.maskOverlay, "");
        };
        maskProbe.src = cacheBustedMask;
    }
    if (panelInfo.title instanceof HTMLInputElement) {
        panelInfo.title.value = label;
        setTooltipText(panelInfo.title, label);
    }
}

function formatNodeSerial(nodeId) {
    const text = String(nodeId ?? "").trim();
    return text || "--";
}

function applyNodeBadge(panelInfo, node) {
    if (!panelInfo || !node) {
        return;
    }
    const scopedId = getScopedNodeId(node);
    if (!scopedId) {
        return;
    }
    const accentColor = getNodeAccentColor(scopedId);
    panelInfo.panel.style.setProperty("--ximageget-accent", accentColor);
    panelInfo.badgeChip.textContent = formatNodeSerial(scopedId);
    setTooltipText(panelInfo.badge, `${NODE_CLASS} #${scopedId}`);
    node.__ximageget2_badge_node_id = scopedId;
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
    if (node.__ximageget2_badge_retry_timer) {
        return;
    }
    node.__ximageget2_badge_retry_timer = window.setTimeout(() => {
        node.__ximageget2_badge_retry_timer = 0;
        applyNodeBadge(panelInfo, node);
        if (!getScopedNodeId(node)) {
            scheduleBadgeSync(node, panelInfo);
        }
    }, 80);
}

function refreshNodeBadge(node) {
    if (!node?.__ximageget2_panel) {
        return;
    }
    const scopedId = getScopedNodeId(node);
    if (!scopedId) {
        scheduleBadgeSync(node, node.__ximageget2_panel);
        return;
    }
    if (node.__ximageget2_badge_node_id !== scopedId) {
        applyNodeBadge(node.__ximageget2_panel, node);
    }
}

function ensureHiddenWidget(node, widgetName) {
    if (!node) {
        return null;
    }
    const widgets = node.widgets || [];
    let widget = widgets.find((item) => item?.name === widgetName);
    if (!widget && typeof node.addWidget === "function") {
        widget = node.addWidget("text", widgetName, "", () => {});
    }
    if (widget) {
        widget.hidden = true;
        widget.serializeValue = () => widget.value;
    }
    return widget || null;
}

function getStorageWidget(node) {
    return ensureHiddenWidget(node, MEDIA_REF_WIDGET);
}

function getMaskWidget(node) {
    return ensureHiddenWidget(node, X_MASK_REF_WIDGET);
}

function getPaintWidget(node) {
    return ensureHiddenWidget(node, X_PAINT_REF_WIDGET);
}

function getTransformStateWidget(node) {
    return ensureHiddenWidget(node, X_TRANSFORM_STATE_WIDGET);
}

function getOutputPlaceholderWidget(node) {
    const widgets = Array.isArray(node?.widgets)
        ? node.widgets
        : [];
    return widgets.find((item) => item?.name === "output_placeholder")
        || null;
}

function removeStorageInputSlot(node) {
    if (!node || !Array.isArray(node.inputs)) {
        return;
    }
    const hiddenNames = new Set([
        MEDIA_REF_WIDGET,
        X_MASK_REF_WIDGET,
        X_PAINT_REF_WIDGET,
        X_TRANSFORM_STATE_WIDGET,
    ]);
    const nextInputs = node.inputs.filter((input) => {
        const name = String(input?.name || "");
        return !hiddenNames.has(name);
    });
    if (nextInputs.length !== node.inputs.length) {
        node.inputs = nextInputs;
        node?.graph?.setDirtyCanvas?.(true, true);
    }
}

function getStoredNodeValue(node) {
    const widget = getStorageWidget(node);
    const value = widget?.value;
    if (typeof value === "string" && value) {
        return value;
    }
    const propertyValue = node?.properties?.[MEDIA_REF_PROPERTY];
    return typeof propertyValue === "string"
        ? propertyValue
        : String(propertyValue || "");
}

function setStoredNodeValue(node, value) {
    const normalized = String(value || "");
    if (!node?.properties) {
        node.properties = {};
    }
    node.properties[MEDIA_REF_PROPERTY] = normalized;
    const widget = getStorageWidget(node);
    if (widget) {
        widget.value = normalized;
    }
    node?.graph?.setDirtyCanvas?.(true, true);
}

function getStoredNodeTitle(node) {
    const propertyValue = node?.properties?.[TITLE_PROPERTY];
    return typeof propertyValue === "string"
        ? propertyValue
        : String(propertyValue || "");
}

function setStoredNodeTitle(node, value) {
    if (!node?.properties) {
        node.properties = {};
    }
    node.properties[TITLE_PROPERTY] = String(value || "");
    node?.graph?.setDirtyCanvas?.(true, true);
}

function getMaskImageRef(node) {
    const widget = getMaskWidget(node);
    const value = widget?.value;
    if (typeof value === "string" && value) {
        return value;
    }
    const propertyValue = node?.properties?.[X_MASK_REF_PROPERTY];
    return typeof propertyValue === "string"
        ? propertyValue
        : String(propertyValue || "");
}

function setMaskImageRef(node, value) {
    const normalized = String(value || "");
    if (!node?.properties) {
        node.properties = {};
    }
    node.properties[X_MASK_REF_PROPERTY] = normalized;
    const widget = getMaskWidget(node);
    if (widget) {
        widget.value = normalized;
    }
    node?.graph?.setDirtyCanvas?.(true, true);
}

function getPaintImageRef(node) {
    const widget = getPaintWidget(node);
    const value = widget?.value;
    if (typeof value === "string" && value) {
        return value;
    }
    const propertyValue = node?.properties?.[X_PAINT_REF_PROPERTY];
    return typeof propertyValue === "string"
        ? propertyValue
        : String(propertyValue || "");
}

function setPaintImageRef(node, value) {
    const normalized = String(value || "");
    if (!node?.properties) {
        node.properties = {};
    }
    node.properties[X_PAINT_REF_PROPERTY] = normalized;
    const widget = getPaintWidget(node);
    if (widget) {
        widget.value = normalized;
    }
    node?.graph?.setDirtyCanvas?.(true, true);
}

function getTransformState(node) {
    const widget = getTransformStateWidget(node);
    const value = widget?.value;
    if (typeof value === "string" && value) {
        return value;
    }
    const propertyValue = node?.properties?.[X_TRANSFORM_STATE_PROPERTY];
    return typeof propertyValue === "string"
        ? propertyValue
        : String(propertyValue || "");
}

function setTransformState(node, value) {
    const normalized = String(value || "");
    if (!node?.properties) {
        node.properties = {};
    }
    node.properties[X_TRANSFORM_STATE_PROPERTY] = normalized;
    const widget = getTransformStateWidget(node);
    if (widget) {
        widget.value = normalized;
    }
    node?.graph?.setDirtyCanvas?.(true, true);
}

function getSavedMaskRef(node) {
    const propertyValue = node?.properties?.[X_MASK_SAVED_REF_PROPERTY];
    return typeof propertyValue === "string"
        ? propertyValue
        : String(propertyValue || "");
}

function setSavedMaskRef(node, value) {
    if (!node?.properties) {
        node.properties = {};
    }
    node.properties[X_MASK_SAVED_REF_PROPERTY] = String(value || "");
    node?.graph?.setDirtyCanvas?.(true, true);
}

function getSaveSeparateState(node) {
    const value = node?.properties?.[X_MASK_SAVE_SEPARATE_PROPERTY];
    return value === true;
}

function setSaveSeparateState(node, value) {
    if (!node?.properties) {
        node.properties = {};
    }
    node.properties[X_MASK_SAVE_SEPARATE_PROPERTY] = !!value;
    node?.graph?.setDirtyCanvas?.(true, true);
}

function looksLikeMediaRef(value) {
    const raw = String(value || "").trim();
    return /^[A-Za-z0-9_-]{16,}$/.test(raw);
}

function hydrateStoredNodeValue(node) {
    if (!node) {
        return "";
    }
    const current = getStoredNodeValue(node);
    if (current) {
        return current;
    }
    const propertyValue = node?.properties?.[MEDIA_REF_PROPERTY];
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

function normalizeBooleanWidgetValue(value) {
    if (value === true || value === false) {
        return value;
    }
    const raw = String(value || "").trim().toLowerCase();
    if (raw === "true") {
        return true;
    }
    if (raw === "false") {
        return false;
    }
    return false;
}

function repairWidgetState(node) {
    if (!node) {
        return;
    }
    const widgetValues = Array.isArray(node?.widgets_values)
        ? node.widgets_values
        : [];
    hydrateStoredNodeValue(node);
    setMaskImageRef(node, getMaskImageRef(node));
    setPaintImageRef(node, getPaintImageRef(node));
    setTransformState(node, getTransformState(node));

    const outputPlaceholderWidget = getOutputPlaceholderWidget(node);
    if (outputPlaceholderWidget) {
        let nextValue = outputPlaceholderWidget.value;
        if (typeof nextValue !== "boolean") {
            const legacyValue = widgetValues[2];
            nextValue = typeof legacyValue === "boolean"
                ? legacyValue
                : normalizeBooleanWidgetValue(nextValue);
        }
        outputPlaceholderWidget.value = normalizeBooleanWidgetValue(
            nextValue
        );
    }

    if (Array.isArray(node?.widgets)) {
        node.widgets_values = node.widgets.map((widget) => {
            const value = typeof widget?.serializeValue === "function"
                ? widget.serializeValue()
                : widget?.value;
            return value === undefined ? "" : value;
        });
    }
}

function canOpenMaskEditor(node) {
    if (String(node?.comfyClass || "") !== NODE_CLASS) {
        return false;
    }
    if (!getStoredNodeValue(node)) {
        return false;
    }
    const panelInfo = node?.__ximageget2_panel;
    if (!panelInfo) {
        return false;
    }
    return panelInfo.__ximageget2_preview_state === PREVIEW_STATE_LOADED;
}

function syncMaskButtonState(node) {
    const button = node?.__ximageget2_panel?.maskBtn;
    if (button instanceof HTMLButtonElement) {
        button.disabled = !canOpenMaskEditor(node);
    }
}

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
        maskColor: t(key("mask_color"), "Mask"),
        toolMaskBrushTip: t(key("tool_mask_brush_tip"), "Paint mask"),
        toolEraseTip: t(key("tool_erase_tip"), "Erase current layer"),
        toolPanTip: t(
            key("tool_pan_tip"),
            "Move the canvas (middle mouse drag / Ctrl+left drag)"
        ),
        invertColor: t(key("invert_color"), "Invert"),
        invertColorTip: t(
            key("invert_color_tip"),
            "Swap black and white"
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
        close: t(
            "xdatahub.ui.shell.btn.close",
            "Close"
        ),
        closeTip: t(key("close_tip"), "Close editor"),
        loading: t(key("loading"), "Loading..."),
        loadFailed: t(key("load_failed"), "Failed to load image"),
        saving: t(key("saving"), "Saving..."),
        saveFailed: t(key("save_failed"), "Failed to save mask"),
    };
}

async function openMaskEditorForNode(node) {
    if (!canOpenMaskEditor(node)) {
        return;
    }
    const mediaRef = getStoredNodeValue(node);
    const imageUrl = buildMediaFileUrl(mediaRef);
    if (!imageUrl) {
        return;
    }
    const title = getStoredNodeTitle(node)
        || String(node?.__ximageget2_panel?.title?.value || "");
    try {
        await openXMaskEditor({
            imageUrl,
            maskUrl: buildAnnotatedImageUrl(getMaskImageRef(node)),
            paintUrl: buildAnnotatedImageUrl(getPaintImageRef(node)),
            transformState: getTransformState(node),
            title,
            texts: getMaskEditorTexts(),
            onSave: ({
                maskRef,
                paintRef,
                transformState,
            }) => {
                setMaskImageRef(node, maskRef || "");
                setSavedMaskRef(node, "");
                setPaintImageRef(node, paintRef || "");
                setSaveSeparateState(node, false);
                setTransformState(node, transformState || "");
                const panelInfo = node?.__ximageget2_panel;
                if (panelInfo) {
                    setPreview(panelInfo, {
                        file_url: buildMediaFileUrl(getStoredNodeValue(node)),
                        paint_url: buildAnnotatedImageUrl(paintRef),
                        mask_url: buildAnnotatedImageUrl(maskRef),
                        transform_state: transformState || "",
                        title: getStoredNodeTitle(node)
                            || String(panelInfo.title?.value || ""),
                    });
                }
                node?.graph?.setDirtyCanvas?.(true, true);
            },
        });
    } catch (error) {
        console.warn(
            t(
                MASK_EDITOR_UNAVAILABLE_KEY,
                MASK_EDITOR_UNAVAILABLE_FALLBACK
            ),
            error
        );
    }
}

function ensureNodeMinSize(node) {
    if (!node) {
        return;
    }
    const minHeight = DEFAULT_MIN_NODE_HEIGHT;
    const minWidth = resolveAdaptiveMinWidth(node, DEFAULT_MIN_NODE_WIDTH);
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
    if (node.__ximageget2_resize_guard) {
        return;
    }
    node.__ximageget2_resize_guard = true;
    const origOnResize = node.onResize;
    node.onResize = function (size) {
        const resizeMinHeight = DEFAULT_MIN_NODE_HEIGHT;
        const resizeMinWidth = resolveAdaptiveMinWidth(
            this,
            DEFAULT_MIN_NODE_WIDTH
        );
        this.min_size = [resizeMinWidth, resizeMinHeight];
        const sourceSize = Array.isArray(size) ? size : this.size;
        const nextWidth = Math.max(sourceSize?.[0] ?? 0, resizeMinWidth);
        const nextHeight = Math.max(
            sourceSize?.[1] ?? 0,
            resizeMinHeight
        );
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
    }
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
    const panelInfo = node?.__ximageget2_panel;
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

function restoreStoredData(node) {
    const mediaRef = hydrateStoredNodeValue(node) || getStoredNodeValue(node);
    const title = getStoredNodeTitle(node);
    if (!mediaRef) {
        return;
    }
    const panelInfo = node?.__ximageget2_panel;
    const baseUrl = buildMediaFileUrl(mediaRef);
    const paintUrl = buildAnnotatedImageUrl(getPaintImageRef(node));
    const maskUrl = buildAnnotatedImageUrl(getMaskImageRef(node));
    if (panelInfo) {
        setPreview(panelInfo, {
            file_url: baseUrl,
            paint_url: paintUrl,
            mask_url: maskUrl,
            transform_state: getTransformState(node),
            title,
        });
    }
    fetchMediaMeta(mediaRef).then((payload) => {
        if (!payload || getStoredNodeValue(node) !== mediaRef) {
            return;
        }
        const fileUrl = String(payload.file_url || baseUrl || "");
        const nextTitle = String(payload.title || title || "");
        setStoredNodeTitle(node, nextTitle);
        if (panelInfo) {
            setPreview(panelInfo, {
                file_url: fileUrl,
                paint_url: buildAnnotatedImageUrl(getPaintImageRef(node)),
                mask_url: buildAnnotatedImageUrl(getMaskImageRef(node)),
                transform_state: getTransformState(node),
                title: nextTitle,
            });
        }
    }).catch(() => {});
}

function clearMaskArtifacts(node) {
    setMaskImageRef(node, "");
    setPaintImageRef(node, "");
    setSavedMaskRef(node, "");
    setTransformState(node, "");
}

function installNodeUi(node) {
    if (!node) {
        return;
    }
    const nodeClass = String(node.comfyClass || "");
    if (!SUPPORTED_NODE_CLASSES.has(nodeClass)) {
        return;
    }
    if (node.__ximageget2_panel) {
        removeStorageInputSlot(node);
        repairWidgetState(node);
        return;
    }
    removeStorageInputSlot(node);
    ensureStyles();
    const panelInfo = buildPanel(nodeClass);
    panelInfo.__ximageget2_node = node;
    node.__ximageget2_panel = panelInfo;
    applyPanelLocale(panelInfo);
    applyNodeBadge(panelInfo, node);
    scheduleBadgeSync(node, panelInfo);

    if (typeof node.addDOMWidget === "function") {
        node.addDOMWidget("ximageget2_preview", "custom", panelInfo.panel, {
            serialize: false,
        });
    }

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
        const payload = parseMediaDragPayload(event.dataTransfer);
        if (!payload || (payload.media_type && payload.media_type !== "image")) {
            return;
        }
        clearMaskArtifacts(node);
        setStoredNodeValue(node, payload.media_ref);
        setStoredNodeTitle(node, payload.title || "");
        setPreview(panelInfo, {
            file_url: buildMediaFileUrl(payload.media_ref),
            paint_url: "",
            mask_url: "",
            title: payload.title || "",
        });
        syncMaskButtonState(node);
    });

    panelInfo.title.addEventListener("input", () => {
        const nextTitle = String(panelInfo.title.value || "");
        setStoredNodeTitle(node, nextTitle);
        setTooltipText(panelInfo.title, nextTitle);
    });

    panelInfo.clearBtn.addEventListener("click", (event) => {
        consumeDragEvent(event);
        setStoredNodeValue(node, "");
        setStoredNodeTitle(node, "");
        clearMaskArtifacts(node);
        setPreview(panelInfo, {});
    });

    panelInfo.maskBtn.addEventListener("click", async (event) => {
        consumeDragEvent(event);
        await openMaskEditorForNode(node);
    });

    getStorageWidget(node);
    getMaskWidget(node);
    getPaintWidget(node);
    getTransformStateWidget(node);
    repairWidgetState(node);
    ensureNodeMinSize(node);
    restoreStoredData(node);
    refreshNodeBadge(node);
    syncMaskButtonState(node);
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
    if (!node || !app.graph) {
        return "";
    }
    let scopedId = "";
    forEachNodeInGraphTree(app.graph, (graphNode, graphScopedId) => {
        if (!scopedId && graphNode === node) {
            scopedId = graphScopedId;
        }
    });
    return scopedId;
}

function getNodeById(nodeId) {
    const targetId = String(nodeId ?? "").trim();
    if (!targetId || !app.graph) {
        return null;
    }
    let scopedMatch = null;
    let plainMatch = null;
    forEachNodeInGraphTree(app.graph, (node, scopedId) => {
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

function collectNodesByClass(nodeClass) {
    const targetClass = String(nodeClass || "");
    if (!SUPPORTED_NODE_CLASSES.has(targetClass) || !app.graph) {
        return [];
    }
    const items = [];
    forEachNodeInGraphTree(app.graph, (node, scopedId) => {
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

function updateNodeMediaRef(node, mediaRef, title) {
    if (!node) {
        return;
    }
    if (!node.__ximageget2_panel) {
        installNodeUi(node);
    }
    clearMaskArtifacts(node);
    setStoredNodeValue(node, mediaRef);
    setStoredNodeTitle(node, title || "");
    const panelInfo = node.__ximageget2_panel;
    if (panelInfo) {
        setPreview(panelInfo, {
            file_url: buildMediaFileUrl(mediaRef),
            paint_url: "",
            mask_url: "",
            transform_state: "",
            title: title || "",
        });
    }
}

function installExistingNodes() {
    if (!app.graph) {
        return;
    }
    forEachNodeInGraphTree(app.graph, (node) => {
        installNodeUi(node);
        if (SUPPORTED_NODE_CLASSES.has(String(node?.comfyClass || ""))) {
            getStorageWidget(node);
            getMaskWidget(node);
            getPaintWidget(node);
            getTransformStateWidget(node);
        }
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

export function initXImageGet2Extension() {
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
            const origOnCreated = nodeType.prototype.onNodeCreated;
            const origOnConfigure = nodeType.prototype.onConfigure;
            nodeType.prototype.onNodeCreated = function () {
                origOnCreated?.apply(this, arguments);
                installNodeUi(this);
                restoreStoredData(this);
                refreshNodeBadge(this);
            };
            nodeType.prototype.onConfigure = function () {
                origOnConfigure?.apply(this, arguments);
                installNodeUi(this);
                restoreStoredData(this);
                refreshNodeBadge(this);
            };
        },
        async nodeCreated(node) {
            installNodeUi(node);
            refreshNodeBadge(node);
            if (SUPPORTED_NODE_CLASSES.has(String(node?.comfyClass || ""))) {
                getStorageWidget(node);
                getMaskWidget(node);
                getPaintWidget(node);
                getTransformStateWidget(node);
            }
        },
        async loadedGraphNode(node) {
            if (!SUPPORTED_NODE_CLASSES.has(String(node?.comfyClass || ""))) {
                return;
            }
            installNodeUi(node);
            restoreStoredData(node);
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
                    if (String(node?.comfyClass || "") !== NODE_CLASS) {
                        replyNodeSendAck(
                            requestId,
                            nodeId,
                            false,
                            "Target node class mismatch"
                        );
                        return;
                    }
                    if (!mediaRef) {
                        replyNodeSendAck(
                            requestId,
                            nodeId,
                            false,
                            "Missing media ref"
                        );
                        return;
                    }
                    updateNodeMediaRef(node, mediaRef, String(data.title || ""));
                    replyNodeSendAck(requestId, nodeId, true);
                }
            });
        },
    });
    setTimeout(() => {
        installExistingNodes();
    }, 0);
}

ROOT.__ximageget_extension_loaded__ = true;
ROOT.__ximageget_extension_init__ = initXImageGet2Extension;
ROOT.__ximageget2_extension_loaded__ = true;
ROOT.__ximageget2_extension_init__ = initXImageGet2Extension;
initXImageGet2Extension();
