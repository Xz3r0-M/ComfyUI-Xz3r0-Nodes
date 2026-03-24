import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

const EXT_NAME = "xz3r0.ximageget";
const EXT_GUARD_KEY = "__ximageget_extension_registered__";
const ROOT = globalThis;
const NODE_CLASS = "XImageGet";
const VIEW_URL_WIDGET = "view_url";
const MIN_NODE_WIDTH = 260;
const MIN_NODE_HEIGHT = 320;

const STYLE_ID = "ximageget-extension-style";
const NODE_ACCENT_DEFAULT = "hsl(212, 10%, 52%)";
const NODE_ACCENT_PALETTE = [
    "hsl(8, 74%, 62%)",
    "hsl(24, 78%, 60%)",
    "hsl(46, 76%, 60%)",
    "hsl(88, 68%, 56%)",
    "hsl(132, 62%, 54%)",
    "hsl(172, 68%, 55%)",
    "hsl(198, 76%, 60%)",
    "hsl(218, 74%, 62%)",
    "hsl(258, 68%, 64%)",
    "hsl(292, 66%, 62%)",
    "hsl(324, 70%, 60%)",
    "hsl(352, 72%, 61%)",
];

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
            font-size: 14px;
            line-height: 1;
            font-weight: 700;
            font-variant-numeric: tabular-nums;
            font-family: ui-monospace, "Cascadia Mono", "Consolas", monospace;
            letter-spacing: 0.15px;
            color: var(--ximageget-accent, #888);
        }
        .ximageget-badge-swatch {
            width: 14px;
            height: 14px;
            border-radius: 4px;
            background: var(--ximageget-accent, #888);
            box-shadow: inset 0 0 0 1px var(--borderColor, #555);
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
        .ximageget-preview.has-image img {
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
            text-overflow: clip;
            user-select: text;
            cursor: text;
            background: #222222;
            padding: 4px 6px;
            border-radius: 6px;
            min-height: 22px;
            display: flex;
            align-items: center;
            flex: 0 0 auto;
        }
    `;
    document.head.appendChild(style);
}

function buildPanel() {
    const panel = document.createElement("div");
    panel.className = "ximageget-panel";

    const meta = document.createElement("div");
    meta.className = "ximageget-meta";

    const badge = document.createElement("div");
    badge.className = "ximageget-badge";

    const badgeChip = document.createElement("span");
    badgeChip.className = "ximageget-badge-chip";
    badgeChip.textContent = "--";

    const badgeSwatch = document.createElement("span");
    badgeSwatch.className = "ximageget-badge-swatch";

    badge.appendChild(badgeChip);
    badge.appendChild(badgeSwatch);
    meta.appendChild(badge);

    const preview = document.createElement("div");
    preview.className = "ximageget-preview";

    const img = document.createElement("img");
    img.alt = "XImageGet";
    preview.appendChild(img);

    const placeholder = document.createElement("div");
    placeholder.className = "ximageget-placeholder";
    placeholder.textContent = "Drop XDataHub link here";
    preview.appendChild(placeholder);

    const title = document.createElement("div");
    title.className = "ximageget-title";
    title.textContent = "";

    panel.appendChild(meta);
    panel.appendChild(preview);
    panel.appendChild(title);

    return {
        panel,
        preview,
        img,
        placeholder,
        title,
        meta,
        badge,
        badgeChip,
        badgeSwatch,
    };
}

function setPreview(panelInfo, data) {
    if (!panelInfo) {
        return;
    }
    const { preview, img, placeholder, title } = panelInfo;
    const fileUrl = String(data?.file_url || "");
    const label = String(data?.title || "");
    if (!fileUrl) {
        preview.classList.remove("has-image");
        img.src = "";
        placeholder.textContent = "Drop XDataHub link here";
        title.textContent = "";
        title.removeAttribute("title");
        return;
    }
    const cacheBusted = fileUrl.includes("?")
        ? `${fileUrl}&ts=${Date.now()}`
        : `${fileUrl}?ts=${Date.now()}`;
    img.onload = () => {
        preview.classList.add("has-image");
        placeholder.textContent = "";
    };
    img.onerror = () => {
        preview.classList.remove("has-image");
        placeholder.textContent = "图片已丢失";
    };
    img.src = cacheBusted;
    img.alt = label || "XImageGet";
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
            `XImageGet #${serial}`
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

function parseMediaIdFromUrl(text) {
    const raw = String(text || "");
    const match = raw.match(/\/xz3r0\/xdatahub\/media\/file\?id=(\d+)/);
    if (!match) {
        return null;
    }
    const value = Number(match[1]);
    if (!Number.isFinite(value) || value <= 0) {
        return null;
    }
    return value;
}

function parseViewUrl(text) {
    const raw = String(text || "").trim();
    if (!raw) {
        return "";
    }
    const first = raw.split(/\r?\n/)[0].trim();
    if (!first) {
        return "";
    }
    try {
        const url = new URL(first, window.location.origin);
        return url.pathname === "/view"
            ? url.toString()
            : "";
    } catch {
        return first.startsWith("/view") ? first : "";
    }
}

async function sendMediaId(mediaId) {
    try {
        const res = await api.fetchApi("/xz3r0/xdatahub/media/send", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ media_id: mediaId }),
        });
        if (!res.ok) {
            return null;
        }
        return await res.json();
    } catch {
        return null;
    }
}

async function sendViewUrl(fileUrl) {
    try {
        const res = await api.fetchApi("/xz3r0/xdatahub/media/send-view", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ file_url: fileUrl }),
        });
        if (!res.ok) {
            return null;
        }
        return await res.json();
    } catch {
        return null;
    }
}

function getViewUrlWidget(node) {
    if (!node) {
        return null;
    }
    const widgets = node.widgets || [];
    let widget = widgets.find((item) => item?.name === VIEW_URL_WIDGET);
    if (!widget && typeof node.addWidget === "function") {
        widget = node.addWidget("text", VIEW_URL_WIDGET, "", () => {});
    }
    if (widget) {
        widget.hidden = true;
        widget.serializeValue = () => widget.value;
    }
    return widget || null;
}

function getStoredViewUrl(node) {
    const widget = getViewUrlWidget(node);
    const value = widget?.value;
    return typeof value === "string" ? value : String(value || "");
}

function setStoredViewUrl(node, url) {
    const widget = getViewUrlWidget(node);
    if (!widget) {
        return;
    }
    widget.value = String(url || "");
    node?.graph?.setDirtyCanvas?.(true, true);
}

function migrateLegacyViewUrl(node) {
    const legacy = node?.properties?.last_view_url;
    if (!legacy) {
        return;
    }
    if (getStoredViewUrl(node)) {
        return;
    }
    setStoredViewUrl(node, legacy);
    if (node?.properties) {
        delete node.properties.last_view_url;
    }
}

function installNodeUi(node) {
    if (!node || node.comfyClass !== NODE_CLASS) {
        return;
    }
    if (node.__ximageget_panel) {
        return;
    }
    ensureStyles();
    const panelInfo = buildPanel();
    node.__ximageget_panel = panelInfo;
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
        const uriList = dataTransfer?.getData("text/uri-list")
            || dataTransfer?.getData("text/plain")
            || "";
        const viewUrl = parseViewUrl(uriList);
        if (!viewUrl) {
            return;
        }
        const payload = await sendViewUrl(viewUrl);
        if (payload?.status === "success") {
            setPreview(panelInfo, payload);
        } else {
            setPreview(panelInfo, { file_url: viewUrl });
        }
        setStoredViewUrl(node, viewUrl);
    });
    ensureNodeMinSize(node);
    migrateLegacyViewUrl(node);
    const stored = getStoredViewUrl(node);
    if (stored) {
        restoreStoredView(node, stored);
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
        const nextWidth = Math.max(this.size?.[0] ?? 0, MIN_NODE_WIDTH);
        const nextHeight = Math.max(this.size?.[1] ?? 0, MIN_NODE_HEIGHT);
        if (typeof this.setSize === "function") {
            this.setSize([nextWidth, nextHeight]);
        } else if (Array.isArray(this.size)) {
            this.size[0] = nextWidth;
            this.size[1] = nextHeight;
        }
        this.setDirtyCanvas?.(true, true);
        if (typeof origOnResize === "function") {
            origOnResize.apply(this, arguments);
        }
    };
}

function restoreStoredView(node, stored) {
    const value = String(stored || "");
    if (!value) {
        return;
    }
    const panelInfo = node?.__ximageget_panel;
    if (panelInfo) {
        setPreview(panelInfo, {
            file_url: value,
            title: panelInfo?.title?.textContent || "",
        });
    }
    const viewUrl = parseViewUrl(value);
    if (viewUrl) {
        sendViewUrl(viewUrl);
        return;
    }
    const mediaId = parseMediaIdFromUrl(value);
    if (mediaId) {
        sendMediaId(mediaId);
    }
}

function installExistingNodes() {
    const nodes = app.graph?._nodes || [];
    for (const node of nodes) {
        installNodeUi(node);
    }
}

function getNodeById(nodeId) {
    const nodes = app.graph?._nodes || [];
    return nodes.find((node) => node?.id === nodeId) || null;
}

function updateNodeViewUrl(node, fileUrl, title) {
    if (!node) {
        return;
    }
    if (!node.__ximageget_panel) {
        installNodeUi(node);
    }
    const panelInfo = node.__ximageget_panel;
    if (panelInfo) {
        setPreview(panelInfo, { file_url: fileUrl, title });
    }
    setStoredViewUrl(node, fileUrl);
    const viewUrl = parseViewUrl(fileUrl);
    if (viewUrl) {
        sendViewUrl(viewUrl);
    }
}

function collectXImageGetNodes() {
    const nodes = app.graph?._nodes || [];
    return nodes
        .filter((node) => node?.comfyClass === NODE_CLASS)
        .map((node) => {
            const accentIndex = getNodeAccentIndex(node.id);
            return {
                id: node.id,
                title: String(node.title || NODE_CLASS),
                accent_index: accentIndex >= 0 ? accentIndex : null,
            };
        });
}

export function initXImageGetExtension() {
    if (ROOT[EXT_GUARD_KEY]) {
        return;
    }
    ROOT[EXT_GUARD_KEY] = true;
    app.registerExtension({
        name: EXT_NAME,
        async beforeRegisterNodeDef(nodeType, nodeData) {
            if (nodeData?.name !== NODE_CLASS) {
                return;
            }
            const orig = nodeType.prototype.onNodeCreated;
            nodeType.prototype.onNodeCreated = function () {
                orig?.apply(this, arguments);
                installNodeUi(this);
                restoreStoredView(this, getStoredViewUrl(this));
                refreshNodeBadge(this);
            };
        },
        async nodeCreated(node) {
            installNodeUi(node);
            refreshNodeBadge(node);
        },
        async loadedGraphNode(node) {
            if (node?.comfyClass !== NODE_CLASS) {
                return;
            }
            installNodeUi(node);
            restoreStoredView(node, getStoredViewUrl(node));
            refreshNodeBadge(node);
        },
        async setup() {
            ROOT.addEventListener("message", (event) => {
                const payload = event?.data;
                if (!payload || typeof payload !== "object") {
                    return;
                }
                if (payload.type === "xdatahub:request_ximageget_nodes") {
                    const requestId = payload.request_id;
                    event.source?.postMessage?.(
                        {
                            type: "xdatahub:ximageget_nodes",
                            request_id: requestId,
                            nodes: collectXImageGetNodes(),
                        },
                        "*"
                    );
                    return;
                }
                if (payload.type === "xdatahub:send_to_node") {
                    const data = payload.data || {};
                    const nodeId = Number(data.node_id);
                    const fileUrl = String(data.file_url || "");
                    if (!Number.isFinite(nodeId) || !fileUrl) {
                        return;
                    }
                    const node = getNodeById(nodeId);
                    if (!node) {
                        return;
                    }
                    updateNodeViewUrl(node, fileUrl, data.title || "");
                    return;
                }
                if (payload.type === "xdatahub:image_sent") {
                    return;
                }
            });
        },
    });
    setTimeout(installExistingNodes, 0);
}

ROOT.__ximageget_extension_loaded__ = true;
ROOT.__ximageget_extension_init__ = initXImageGetExtension;
initXImageGetExtension();
