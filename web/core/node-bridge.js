/**
 * node-bridge.js
 * Wraps window.parent postMessage communication for node operations.
 *
 * requestNodes(nodeClass) → Promise<{ id, title, accent_index }[]>
 * sendToNode(data)        → Promise<{ ok, error }>
 */

const REQUEST_TIMEOUT_MS = 1500;
const SEND_TIMEOUT_MS = 2000;

let _seq = 0;
const _pendingNodes = new Map();
const _pendingSend  = new Map();

function normalizeOrigin(value) {
    if (typeof value !== "string" || !value) {
        return "";
    }
    try {
        const origin = new URL(value, window.location.href).origin;
        return origin === "null" ? "" : origin;
    } catch {
        return "";
    }
}

function getConfiguredParentOrigins() {
    const configured = window.__XDH_ALLOWED_PARENT_ORIGINS__;
    if (Array.isArray(configured)) {
        return configured
            .map((value) => normalizeOrigin(String(value || "")))
            .filter(Boolean);
    }
    if (typeof configured === "string") {
        return configured
            .split(",")
            .map((value) => normalizeOrigin(value.trim()))
            .filter(Boolean);
    }
    return [];
}

function getAllowedParentOrigins() {
    const origins = new Set(getConfiguredParentOrigins());
    const referrerOrigin = normalizeOrigin(document.referrer || "");
    if (referrerOrigin) {
        origins.add(referrerOrigin);
    }
    const currentOrigin = normalizeOrigin(window.location.origin || "");
    if (currentOrigin) {
        origins.add(currentOrigin);
    }
    return origins;
}

function getParentTargetOrigin() {
    const referrerOrigin = normalizeOrigin(document.referrer || "");
    if (referrerOrigin) {
        return referrerOrigin;
    }
    const configuredOrigins = getConfiguredParentOrigins();
    if (configuredOrigins.length > 0) {
        return configuredOrigins[0];
    }
    return normalizeOrigin(window.location.origin || "");
}

function isAllowedParentMessage(event) {
    if (!event || event.source !== window.parent) {
        return false;
    }
    return getAllowedParentOrigins().has(String(event.origin || ""));
}

function nextId() {
    _seq += 1;
    return `v2_nb_${Date.now()}_${_seq}`;
}

function handleMessage(event) {
    if (!isAllowedParentMessage(event)) return;

    const payload = event?.data;
    if (!payload || typeof payload !== "object") return;

    if (payload.type === "xdatahub:media_get_nodes") {
        const req = _pendingNodes.get(payload.request_id);
        if (!req) return;
        clearTimeout(req.timer);
        _pendingNodes.delete(payload.request_id);
        req.resolve(Array.isArray(payload.nodes) ? payload.nodes : []);
        return;
    }

    if (payload.type === "xdatahub:send_to_node_ack") {
        const d = payload.data || {};
        const req = _pendingSend.get(d.request_id);
        if (!req) return;
        clearTimeout(req.timer);
        _pendingSend.delete(d.request_id);
        req.resolve({ ok: d.ok !== false, error: String(d.error || "") });
    }
}

if (!window.__xdh_node_bridge_installed__) {
    window.__xdh_node_bridge_installed__ = true;
    window.addEventListener("message", handleMessage);
}

/**
 * Request nodes of a given ComfyUI class from the parent window.
 * @param {string} nodeClass e.g. 'XImageGet'
 * @returns {Promise<Array<{id:string,title:string,accent_index:number|null}>>}
 */
export function requestNodes(nodeClass) {
    return new Promise((resolve) => {
        const requestId = nextId();
        const targetOrigin = getParentTargetOrigin();
        const timer = setTimeout(() => {
            _pendingNodes.delete(requestId);
            resolve([]);
        }, REQUEST_TIMEOUT_MS);
        _pendingNodes.set(requestId, { resolve, timer });
        try {
            window.parent?.postMessage?.(
                {
                    type: "xdatahub:request_media_get_nodes",
                    request_id: requestId,
                    node_class: nodeClass,
                },
                targetOrigin
            );
        } catch {
            clearTimeout(timer);
            _pendingNodes.delete(requestId);
            resolve([]);
        }
    });
}

/**
 * Send a media ref (or text) to a specific ComfyUI node.
 * @param {{
 *   nodeId: string,
 *   nodeClass: string,
 *   mediaRef?: string,
 *   textValue?: string,
 *   title?: string,
 * }} data
 * @returns {Promise<{ ok: boolean, error: string }>}
 */
export function sendToNode(data) {
    return new Promise((resolve) => {
        const requestId = nextId();
        const targetOrigin = getParentTargetOrigin();
        const timer = setTimeout(() => {
            _pendingSend.delete(requestId);
            resolve({ ok: false, error: "timeout" });
        }, SEND_TIMEOUT_MS);
        _pendingSend.set(requestId, { resolve, timer });
        try {
            window.parent?.postMessage?.(
                {
                    type: "xdatahub:send_to_node",
                    data: {
                        request_id: requestId,
                        node_id: String(data.nodeId ?? ""),
                        node_class: String(data.nodeClass || ""),
                        media_ref: String(data.mediaRef || ""),
                        text_value: String(data.textValue || ""),
                        title: String(data.title || ""),
                    },
                },
                targetOrigin
            );
        } catch {
            clearTimeout(timer);
            _pendingSend.delete(requestId);
            resolve({ ok: false, error: "postMessage failed" });
        }
    });
}

/** Map V2 activeCategory to ComfyUI node class */
export const CATEGORY_NODE_CLASS = {
    image:     "XImageGet",
    video:     "XVideoGet",
    audio:     "XAudioGet",
    lora:      "XLoraGet",
    history:   "XStringGet",
    favorites: "XStringGet",
};

export function resolveNodeClassFromTargetType(targetType) {
    const rawTargetType = String(targetType || "").trim();
    if (!rawTargetType) {
        return "";
    }

    const normalizedTargetType = rawTargetType.toLowerCase();
    if (Object.prototype.hasOwnProperty.call(
        CATEGORY_NODE_CLASS,
        normalizedTargetType
    )) {
        return CATEGORY_NODE_CLASS[normalizedTargetType];
    }

    const matchedNodeClass = Object.values(CATEGORY_NODE_CLASS).find(
        (nodeClass) => nodeClass.toLowerCase() === normalizedTargetType
    );
    return matchedNodeClass || rawTargetType;
}

export function resolveNodeClassFromCategory(category) {
    const normalizedCategory = String(category || "image").trim().toLowerCase();
    return CATEGORY_NODE_CLASS[normalizedCategory] || "XImageGet";
}
