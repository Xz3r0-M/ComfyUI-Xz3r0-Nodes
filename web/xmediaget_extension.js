import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

const EXT_NAME = "xz3r0.xmediaget";
const EXT_GUARD_KEY = "__xmediaget_extension_registered__";
const ROOT = globalThis;
const STRING_NODE_CLASS = "XStringGet";
const SUPPORTED_NODE_CLASSES = new Set([
    "XImageGet",
    "XVideoGet",
    "XAudioGet",
    "XStringGet",
]);
const NODE_UI_CONFIG = {
    XImageGet: {
        kind: "image",
        emoji: "🖼️",
        placeholderKey: "xdatahub.ui.node.xmediaget.placeholder_image",
        placeholderFallback: "Drop XDataHub image here",
        missingKey: "xdatahub.ui.node.xmediaget.missing_image",
        missingFallback: "Image missing",
    },
    XVideoGet: {
        kind: "video",
        emoji: "🎞️",
        placeholderKey: "xdatahub.ui.node.xmediaget.placeholder_video",
        placeholderFallback: "Drop XDataHub video here",
        missingKey: "xdatahub.ui.node.xmediaget.missing_video",
        missingFallback: "Video missing",
    },
    XAudioGet: {
        kind: "audio",
        emoji: "🎵",
        placeholderKey: "xdatahub.ui.node.xmediaget.placeholder_audio",
        placeholderFallback: "Drop XDataHub audio here",
        missingKey: "xdatahub.ui.node.xmediaget.missing_audio",
        missingFallback: "Audio missing",
    },
    XStringGet: {
        kind: "text",
        emoji: "📝",
        placeholderKey: "xdatahub.ui.node.xmediaget.placeholder_text",
        placeholderFallback: "Drop or send XDataHub text here",
        missingKey: "xdatahub.ui.node.xmediaget.missing_text",
        missingFallback: "Text missing",
    },
};
const MEDIA_REF_WIDGET = "media_ref";
const TEXT_VALUE_WIDGET = "text_value";
const XDATAHUB_MEDIA_MIME = "application/x-xdatahub-media+json";
const MIN_NODE_WIDTH = 260;
const MIN_NODE_HEIGHT = 320;
const MEDIA_REF_PROPERTY = "__xdatahub_media_ref";
const TEXT_VALUE_PROPERTY = "__xdatahub_text_value";

const STYLE_ID = "xmediaget-extension-style";
const NODE_ACCENT_DEFAULT = "#0066FF";
const NODE_ACCENT_PALETTE = [
    "#0066FF",
    "#D90429",
    "#00A86B",
    "#FFBF00",
    "#CC00CC",
    "#00CCCC",
    "#FF6600",
    "#0066FF",
    "#D90429",
    "#00A86B",
    "#FFBF00",
    "#CC00CC",
];
const CLEAR_BTN_LABEL_KEY = "xdatahub.ui.node.xmediaget.clear_loaded_media";
const CLEAR_BTN_LABEL_FALLBACK = "Clear loaded media";
const PREVIEW_STATE_EMPTY = "empty";
const PREVIEW_STATE_LOADED = "loaded";
const PREVIEW_STATE_MISSING = "missing";

let uiLocalePrimary = {};
let uiLocaleFallback = {};

function getComfyLocale() {
    const locale = window.app?.extensionManager?.setting?.get("Comfy.Locale")
        || localStorage.getItem("Comfy.Locale")
        || navigator.language
        || "en";
    return String(locale).replace("_", "-").split("-")[0].toLowerCase();
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

function buildMediaFileUrl(mediaRef) {
    const value = String(mediaRef || "").trim();
    if (!value) {
        return "";
    }
    return `/xz3r0/xdatahub/media/file?ref=${encodeURIComponent(value)}`;
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
            source,
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
        return await response.json();
    } catch {
        return null;
    }
}

function getStoragePropertyName(node) {
    return isStringNode(node) ? TEXT_VALUE_PROPERTY : MEDIA_REF_PROPERTY;
}

function looksLikeMediaRef(value) {
    const raw = String(value || "").trim();
    return /^[A-Za-z0-9_-]{16,}$/.test(raw);
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
    const locale = String(localeOverride || getComfyLocale() || "en")
        .toLowerCase();
    uiLocaleFallback = await fetchLocaleJson("en");
    if (locale === "en") {
        uiLocalePrimary = uiLocaleFallback;
        return;
    }
    uiLocalePrimary = await fetchLocaleJson(locale);
}

function normalizeNodeColorKey(value) {
    return String(value || "").trim().toLowerCase();
}

function hashColorKeyU32(rawKey) {
    const key = normalizeNodeColorKey(rawKey);
    if (!key) {
        return 0;
    }
    let hash = 2166136261;
    for (let i = 0; i < key.length; i += 1) {
        hash ^= key.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
}

function getNodeAccentIndex(rawKey) {
    const key = normalizeNodeColorKey(rawKey);
    if (!key) {
        return -1;
    }
    return hashColorKeyU32(key) % NODE_ACCENT_PALETTE.length;
}

function getNodeAccentColor(rawKey) {
    const index = getNodeAccentIndex(rawKey);
    if (index < 0) {
        return NODE_ACCENT_DEFAULT;
    }
    return NODE_ACCENT_PALETTE[index] || NODE_ACCENT_DEFAULT;
}

function getNodeUiConfig(nodeClass) {
    const key = String(nodeClass || "");
    const config = NODE_UI_CONFIG[key] || NODE_UI_CONFIG.XImageGet;
    return {
        ...config,
        placeholder: t(
            config.placeholderKey,
            config.placeholderFallback || "Drop XDataHub media here"
        ),
        missing: t(
            config.missingKey,
            config.missingFallback || "Media missing"
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
            align-items: center;
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
            margin-left: auto;
        }
        .ximageget-badge {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            padding: 4px 12px;
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
        .ximageget-clear-btn {
            width: 22px;
            height: 22px;
            padding: 0;
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
        }
        .ximageget-clear-btn:hover,
        .ximageget-clear-btn:focus-visible {
            border-color: var(--ximageget-accent, #888);
            background: #2b2b2b;
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
            border: 1px solid var(--borderColor, #555);
            background: var(--bgColor, #222);
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
            background: #000;
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
            border-radius: 8px;
            border: 1px solid var(--borderColor, #555);
            background: #1a1a1a;
            color: #ffffff;
            font-size: 13px;
            line-height: 1.45;
            white-space: pre-wrap;
            word-break: break-word;
            overflow: auto;
            user-select: text;
        }
        .ximageget-preview.has-media img,
        .ximageget-preview.has-media video,
        .ximageget-preview.has-media audio,
        .ximageget-preview.has-media .ximageget-text-preview {
            display: block;
        }
        .ximageget-placeholder {
            font-size: 13px;
            color: #ffffff;
            font-weight: 600;
            opacity: 1;
            text-shadow:
                0 0 6px rgba(0, 0, 0, 0.9),
                0 0 10px rgba(0, 0, 0, 0.75);
        }
        .ximageget-title {
            font-size: 12px;
            color: #ffffff;
            opacity: 1;
            white-space: nowrap;
            overflow: hidden;
            user-select: text;
            cursor: text;
            background: #222222;
            padding: 4px 6px;
            border-radius: 6px;
            min-height: 22px;
            display: flex;
            align-items: center;
            flex: 1 1 auto;
            min-width: 0;
            text-overflow: ellipsis;
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
    kindEmoji.textContent = String(config.emoji || "🔹");
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

    const clearBtn = document.createElement("button");
    clearBtn.className = "ximageget-clear-btn";
    clearBtn.type = "button";
    clearBtn.textContent = "🗑️";
    const clearBtnLabel = t(CLEAR_BTN_LABEL_KEY, CLEAR_BTN_LABEL_FALLBACK);
    clearBtn.title = clearBtnLabel;
    clearBtn.setAttribute("aria-label", clearBtnLabel);

    meta.appendChild(badge);
    meta.appendChild(kindEmoji);

    const preview = document.createElement("div");
    preview.className = "ximageget-preview";
    let mediaEl = null;
    let textEl = null;
    if (config.kind === "image") {
        const img = document.createElement("img");
        img.alt = nodeClass || "XImageGet";
        mediaEl = img;
    } else if (config.kind === "video") {
        const video = document.createElement("video");
        video.preload = "metadata";
        video.controls = true;
        video.muted = true;
        video.playsInline = true;
        mediaEl = video;
    } else {
        if (config.kind === "audio") {
            const audio = document.createElement("audio");
            audio.preload = "metadata";
            audio.controls = true;
            mediaEl = audio;
        } else {
            const textPreview = document.createElement("div");
            textPreview.className = "ximageget-text-preview";
            textPreview.textContent = "";
            textEl = textPreview;
        }
    }
    if (mediaEl) {
        preview.appendChild(mediaEl);
    }
    if (textEl) {
        preview.appendChild(textEl);
    }

    const placeholder = document.createElement("div");
    placeholder.className = "ximageget-placeholder";
    placeholder.textContent = config.placeholder;
    preview.appendChild(placeholder);

    const title = document.createElement("div");
    title.className = "ximageget-title";
    title.textContent = "";

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
    const clearBtnLabel = t(CLEAR_BTN_LABEL_KEY, CLEAR_BTN_LABEL_FALLBACK);
    if (panelInfo.clearBtn instanceof HTMLButtonElement) {
        panelInfo.clearBtn.title = clearBtnLabel;
        panelInfo.clearBtn.setAttribute("aria-label", clearBtnLabel);
    }
    const state = String(
        panelInfo.__xmediaget_preview_state || PREVIEW_STATE_EMPTY
    );
    if (state === PREVIEW_STATE_EMPTY) {
        panelInfo.placeholder.textContent = panelInfo.placeholderText;
        return;
    }
    if (state === PREVIEW_STATE_MISSING) {
        panelInfo.placeholder.textContent = panelInfo.missingText;
    }
}

function refreshAllPanelLocales() {
    const nodes = app.graph?._nodes || [];
    for (const node of nodes) {
        const panelInfo = node?.__ximageget_panel;
        if (!panelInfo) {
            continue;
        }
        applyPanelLocale(panelInfo);
    }
}

async function applyUiLocale(localeOverride = null) {
    await loadUiLocaleBundle(localeOverride);
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
            if (textEl) {
                textEl.textContent = "";
            }
            placeholder.textContent =
                placeholderText || "Drop XDataHub text here";
            title.textContent = "";
            title.removeAttribute("title");
            return;
        }
        panelInfo.__xmediaget_preview_state = PREVIEW_STATE_LOADED;
        preview.classList.add("has-media");
        placeholder.textContent = "";
        if (textEl) {
            textEl.textContent = textValue;
        }
        const finalTitle = String(label || "");
        title.textContent = finalTitle;
        if (finalTitle) {
            title.setAttribute("title", finalTitle);
        } else {
            title.removeAttribute("title");
        }
        return;
    }

    if (!fileUrl) {
        panelInfo.__xmediaget_preview_state = PREVIEW_STATE_EMPTY;
        preview.classList.remove("has-media");
        if (mediaEl) {
            clearMediaElementHandlers(mediaEl);
            mediaEl.src = "";
            if (typeof mediaEl.load === "function") {
                mediaEl.load();
            }
        }
        placeholder.textContent = placeholderText || "Drop XDataHub media here";
        title.textContent = "";
        title.removeAttribute("title");
        if (textEl) {
            textEl.textContent = "";
        }
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
        };
        mediaEl.onerror = () => {
            if (panelInfo.__xmediaget_load_token !== loadToken) {
                return;
            }
            panelInfo.__xmediaget_preview_state = PREVIEW_STATE_MISSING;
            preview.classList.remove("has-media");
            placeholder.textContent = missingText || "Image missing";
        };
        mediaEl.src = cacheBusted;
        mediaEl.alt = label || nodeClass || "XImageGet";
    } else if (mediaEl) {
        clearMediaElementHandlers(mediaEl);
        mediaEl.onloadeddata = () => {
            if (panelInfo.__xmediaget_load_token !== loadToken) {
                return;
            }
            panelInfo.__xmediaget_preview_state = PREVIEW_STATE_LOADED;
            preview.classList.add("has-media");
            placeholder.textContent = "";
        };
        mediaEl.onerror = () => {
            if (panelInfo.__xmediaget_load_token !== loadToken) {
                return;
            }
            panelInfo.__xmediaget_preview_state = PREVIEW_STATE_MISSING;
            preview.classList.remove("has-media");
            placeholder.textContent = missingText || "Media missing";
        };
        mediaEl.src = cacheBusted;
        if (typeof mediaEl.load === "function") {
            mediaEl.load();
        }
    }
    title.textContent = label;
    if (label) {
        title.setAttribute("title", label);
    } else {
        title.removeAttribute("title");
    }
}

function formatNodeSerial(nodeId) {
    if (!Number.isFinite(Number(nodeId))) {
        return "--";
    }
    return String(nodeId);
}

function applyNodeBadge(panelInfo, node) {
    if (!panelInfo || !node) {
        return;
    }
    const nodeId = Number(node.id);
    if (!Number.isFinite(nodeId) || nodeId < 0) {
        return;
    }
    const serial = formatNodeSerial(node.id);
    const accentIndex = getNodeAccentIndex(node.id);
    const accentColor = getNodeAccentColor(node.id);
    panelInfo.panel.style.setProperty("--ximageget-accent", accentColor);
    if (panelInfo.badgeChip) {
        panelInfo.badgeChip.textContent = serial;
    }
    if (panelInfo.badge) {
        panelInfo.badge.setAttribute(
            "title",
            `${String(node.comfyClass || "XImageGet")} #${serial}`
        );
    }
    node.__ximageget_accent_index = accentIndex >= 0 ? accentIndex : null;
    node.__ximageget_badge_node_id = nodeId;
}

function scheduleBadgeSync(node, panelInfo) {
    if (!node || !panelInfo) {
        return;
    }
    const nodeId = Number(node.id);
    if (Number.isFinite(nodeId) && nodeId >= 0) {
        applyNodeBadge(panelInfo, node);
        return;
    }
    if (node.__ximageget_badge_retry_timer) {
        return;
    }
    node.__ximageget_badge_retry_timer = window.setTimeout(() => {
        node.__ximageget_badge_retry_timer = 0;
        applyNodeBadge(panelInfo, node);
        if (!Number.isFinite(Number(node.id)) || Number(node.id) < 0) {
            scheduleBadgeSync(node, panelInfo);
        }
    }, 80);
}

function refreshNodeBadge(node) {
    if (!node || !node.__ximageget_panel) {
        return;
    }
    const panelInfo = node.__ximageget_panel;
    const nodeId = Number(node.id);
    if (!Number.isFinite(nodeId) || nodeId < 0) {
        scheduleBadgeSync(node, panelInfo);
        return;
    }
    if (node.__ximageget_badge_node_id !== nodeId) {
        applyNodeBadge(panelInfo, node);
    }
}

function isStringNode(node) {
    return String(node?.comfyClass || "") === STRING_NODE_CLASS;
}

function getStorageWidgetName(node) {
    return isStringNode(node) ? TEXT_VALUE_WIDGET : MEDIA_REF_WIDGET;
}

function getStorageWidget(node) {
    if (!node) {
        return null;
    }
    const widgetName = getStorageWidgetName(node);
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

function removeStorageInputSlot(node) {
    if (!node || !SUPPORTED_NODE_CLASSES.has(String(node?.comfyClass || ""))) {
        return;
    }
    if (!Array.isArray(node?.inputs)) {
        return;
    }
    const widgetName = getStorageWidgetName(node);
    const nextInputs = node.inputs.filter(
        (input) => String(input?.name || "") !== widgetName
    );
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
    if (!node?.properties) {
        node.properties = {};
    }
    node.properties[getStoragePropertyName(node)] = normalized;
    if (!widget) {
        return;
    }
    widget.value = normalized;
    node?.graph?.setDirtyCanvas?.(true, true);
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
    const panelInfo = buildPanel(nodeClass);
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
    const consumeDragEvent = (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (typeof event.stopImmediatePropagation === "function") {
            event.stopImmediatePropagation();
        }
    };
    if (panelInfo.mediaKind !== "text") {
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
    }
    if (panelInfo.clearBtn instanceof HTMLButtonElement) {
        panelInfo.clearBtn.addEventListener("click", (event) => {
            consumeDragEvent(event);
            setStoredNodeValue(node, "");
            setPreview(panelInfo, {});
        });
    }
    ensureNodeMinSize(node);
    const stored = hydrateStoredNodeValue(node) || getStoredNodeValue(node);
    if (stored) {
        restoreStoredData(node, stored);
    }
}

function ensureNodeMinSize(node) {
    if (!node) {
        return;
    }
    if (!node.min_size || node.min_size.length < 2) {
        node.min_size = [MIN_NODE_WIDTH, MIN_NODE_HEIGHT];
    } else {
        node.min_size[0] = Math.max(node.min_size[0], MIN_NODE_WIDTH);
        node.min_size[1] = Math.max(node.min_size[1], MIN_NODE_HEIGHT);
    }
    if (typeof node.setSize === "function") {
        const width = Math.max(node.size?.[0] ?? 0, MIN_NODE_WIDTH);
        const height = Math.max(node.size?.[1] ?? 0, MIN_NODE_HEIGHT);
        node.setSize([width, height]);
    } else if (!node.size || node.size.length < 2) {
        node.size = [MIN_NODE_WIDTH, MIN_NODE_HEIGHT];
    } else {
        node.size[0] = Math.max(node.size[0], MIN_NODE_WIDTH);
        node.size[1] = Math.max(node.size[1], MIN_NODE_HEIGHT);
    }
    if (node.__ximageget_resize_guard) {
        return;
    }
    node.__ximageget_resize_guard = true;
    const origOnResize = node.onResize;
    node.onResize = function (size) {
        const sourceSize = Array.isArray(size) ? size : this.size;
        const nextWidth = Math.max(sourceSize?.[0] ?? 0, MIN_NODE_WIDTH);
        const nextHeight = Math.max(sourceSize?.[1] ?? 0, MIN_NODE_HEIGHT);
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

function restoreStoredData(node, stored) {
    const value = String(stored || "");
    if (!value) {
        return;
    }
    const panelInfo = node?.__ximageget_panel;
    const nodeClass = String(node?.comfyClass || "");
    if (nodeClass === STRING_NODE_CLASS) {
        if (panelInfo) {
            setPreview(panelInfo, {
                text_value: value,
                title: "",
            });
        }
        return;
    }
    const mediaRef = value;
    const fallbackUrl = buildMediaFileUrl(mediaRef);
    if (panelInfo) {
        setPreview(panelInfo, {
            file_url: fallbackUrl,
            title: panelInfo?.title?.textContent || "",
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
            file_url: fileUrl,
            title: String(payload.title || ""),
        });
    }).catch(() => {});
}

function installExistingNodes() {
    const nodes = app.graph?._nodes || [];
    for (const node of nodes) {
        installNodeUi(node);
        if (SUPPORTED_NODE_CLASSES.has(String(node?.comfyClass || ""))) {
            getStorageWidget(node);
        }
    }
}

function getNodeById(nodeId) {
    const nodes = app.graph?._nodes || [];
    return nodes.find((node) => node?.id === nodeId) || null;
}

function updateNodeMediaRef(node, mediaRef, title) {
    if (!node) {
        return;
    }
    if (!node.__ximageget_panel) {
        installNodeUi(node);
    }
    const panelInfo = node.__ximageget_panel;
    const fileUrl = buildMediaFileUrl(mediaRef);
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
}

function collectNodesByClass(nodeClass) {
    const targetClass = String(nodeClass || "");
    if (!SUPPORTED_NODE_CLASSES.has(targetClass)) {
        return [];
    }
    const nodes = app.graph?._nodes || [];
    return nodes
        .filter((node) => node?.comfyClass === targetClass)
        .map((node) => {
            const accentIndex = getNodeAccentIndex(node.id);
            return {
                id: node.id,
                title: String(node.title || targetClass),
                accent_index: accentIndex >= 0 ? accentIndex : null,
            };
        });
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
                );
                refreshNodeBadge(this);
            };
            nodeType.prototype.onConfigure = function () {
                origOnConfigure?.apply(this, arguments);
                installNodeUi(this);
                const stored = hydrateStoredNodeValue(this)
                    || getStoredNodeValue(this);
                if (stored) {
                    restoreStoredData(this, stored);
                }
                refreshNodeBadge(this);
            };
        },
        async nodeCreated(node) {
            installNodeUi(node);
            refreshNodeBadge(node);
            if (SUPPORTED_NODE_CLASSES.has(String(node?.comfyClass || ""))) {
                getStorageWidget(node);
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
            );
            refreshNodeBadge(node);
        },
        async setup() {
            ROOT.addEventListener("message", (event) => {
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
                        "*"
                    );
                };
                if (payload.type === "xdatahub:ui-locale") {
                    applyUiLocale(payload.locale).catch(() => {});
                    return;
                }
                if (payload.type === "xdatahub:request_media_get_nodes") {
                    const requestId = payload.request_id;
                    const nodeClass = String(payload.node_class || "");
                    event.source?.postMessage?.(
                        {
                            type: "xdatahub:media_get_nodes",
                            request_id: requestId,
                            node_class: nodeClass,
                            nodes: collectNodesByClass(nodeClass),
                        },
                        "*"
                    );
                    return;
                }
                if (payload.type === "xdatahub:send_to_node") {
                    const data = payload.data || {};
                    const requestId = String(data.request_id || "");
                    const nodeId = Number(data.node_id);
                    const mediaRef = String(data.media_ref || "");
                    const textValue = String(data.text_value || "");
                    const nodeClass = String(data.node_class || "");
                    if (!Number.isFinite(nodeId)) {
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
        applyUiLocale().catch(() => {});
    }, 0);
}

ROOT.__xmediaget_extension_loaded__ = true;
ROOT.__xmediaget_extension_init__ = initXMediaGetExtension;
initXMediaGetExtension();
