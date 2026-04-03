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

function nextId() {
    _seq += 1;
    return `v2_nb_${Date.now()}_${_seq}`;
}

function handleMessage(event) {
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
                "*"
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
                "*"
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
