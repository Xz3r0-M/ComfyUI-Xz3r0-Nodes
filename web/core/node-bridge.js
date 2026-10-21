/**
 * node-bridge.js
 * Wraps window.parent postMessage communication for node operations.
 *
 * requestNodes(nodeClass)         → Promise<{ id, title, accent_index }[]>
 * requestNodesDetailed(nodeClass) → Promise<{ ok, nodes }>
 * sendToNode(data)                → Promise<{ ok, error, accepted, dropped, disabled }>
 */

const REQUEST_TIMEOUT_MS = 1500;
const SEND_TIMEOUT_MS = 2000;

/**
 * 各组件是用带 `?v=` 的地址引用本模块的，版本不一致时浏览器会当成
 * 两个模块、各自实例化一份。消息监听只装一次（窗口级守卫），
 * 所以「等回复的请求表」必须放在 window 上共享，
 * 否则第二个实例发出去的请求永远等不到回复（表现为节点列表是空的）。
 */
const BRIDGE_STATE_KEY = "__xdh_node_bridge_state__";

function getSharedState() {
    const existing = window[BRIDGE_STATE_KEY];
    if (existing && typeof existing === "object") {
        if (!(existing.pendingNodes instanceof Map)) {
            existing.pendingNodes = new Map();
        }
        if (!(existing.pendingSend instanceof Map)) {
            existing.pendingSend = new Map();
        }
        return existing;
    }
    const created = {
        seq: 0,
        pendingNodes: new Map(),
        pendingSend: new Map(),
    };
    window[BRIDGE_STATE_KEY] = created;
    return created;
}

const _state = getSharedState();

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
    _state.seq += 1;
    return `v2_nb_${Date.now()}_${_state.seq}`;
}

function handleMessage(event) {
    if (!isAllowedParentMessage(event)) return;

    const payload = event?.data;
    if (!payload || typeof payload !== "object") return;

    if (payload.type === "xdatahub:media_get_nodes") {
        const req = _state.pendingNodes.get(payload.request_id);
        if (!req) return;
        clearTimeout(req.timer);
        _state.pendingNodes.delete(payload.request_id);
        req.resolve(true, payload.nodes);
        return;
    }

    if (payload.type === "xdatahub:send_to_node_ack") {
        const d = payload.data || {};
        const req = _state.pendingSend.get(d.request_id);
        if (!req) return;
        clearTimeout(req.timer);
        _state.pendingSend.delete(d.request_id);
        req.resolve({
            ok: d.ok !== false,
            error: String(d.error || ""),
            accepted: Number(d.accepted || 0),
            dropped: Number(d.dropped || 0),
            disabled: Number(d.disabled || 0),
        });
    }
}

if (!window.__xdh_node_bridge_installed__) {
    window.__xdh_node_bridge_installed__ = true;
    window.addEventListener("message", handleMessage);
}

/**
 * Request nodes of a given ComfyUI class from the parent window.
 *
 * 与 `requestNodes` 的区别：超时/失败时 `ok` 为 false，调用方据此判断
 * 「没取到节点」到底是「节点真被删了」还是「这一轮没拿到数据」。
 * @param {string} nodeClass e.g. 'XImageGet'
 * @returns {Promise<{ ok: boolean, nodes: Array }>}
 */
export function requestNodesDetailed(nodeClass) {
    return new Promise((resolve) => {
        const requestId = nextId();
        const targetOrigin = getParentTargetOrigin();
        const finish = (ok, nodes) => {
            resolve({
                ok: !!ok,
                nodes: Array.isArray(nodes) ? nodes : [],
            });
        };
        const timer = setTimeout(() => {
            _state.pendingNodes.delete(requestId);
            finish(false, []);
        }, REQUEST_TIMEOUT_MS);
        _state.pendingNodes.set(requestId, { resolve: finish, timer });
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
            _state.pendingNodes.delete(requestId);
            finish(false, []);
        }
    });
}

/**
 * Request nodes of a given ComfyUI class from the parent window.
 * @param {string} nodeClass e.g. 'XImageGet'
 * @returns {Promise<Array<{id:string,title:string,accent_index:number|null}>>}
 */
export function requestNodes(nodeClass) {
    return requestNodesDetailed(nodeClass).then((result) => result.nodes);
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
 * 返回里的 `disabled` 表示「因为目标已启用满 50 个、以禁用状态加进去」
 * 的文件数，界面可以据此提示用户。
 * @returns {Promise<{
 *   ok: boolean,
 *   error: string,
 *   accepted: number,
 *   dropped: number,
 *   disabled: number,
 * }>}
 */
export function sendToNode(data) {
    return new Promise((resolve) => {
        const requestId = nextId();
        const targetOrigin = getParentTargetOrigin();
        const timer = setTimeout(() => {
            _state.pendingSend.delete(requestId);
            resolve({
                ok: false,
                error: "timeout",
                accepted: 0,
                dropped: 0,
                disabled: 0,
            });
        }, SEND_TIMEOUT_MS);
        _state.pendingSend.set(requestId, { resolve, timer });
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
                        mode: String(data.mode || ""),
                        items: Array.isArray(data.items)
                            ? data.items.map((item) => ({
                                media_ref: String(
                                    item?.mediaRef ?? item?.media_ref ?? ""
                                ),
                                media_type: String(
                                    item?.mediaType ?? item?.media_type ?? ""
                                ),
                                title: String(item?.title || ""),
                            }))
                            : [],
                    },
                },
                targetOrigin
            );
        } catch {
            clearTimeout(timer);
            _state.pendingSend.delete(requestId);
            resolve({
                ok: false,
                error: "postMessage failed",
                accepted: 0,
                dropped: 0,
                disabled: 0,
            });
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

export function hoverNode(nodeId) {
    const targetOrigin = getParentTargetOrigin();
    try {
        window.parent?.postMessage?.(
            { type: "xdatahub:node_hover", node_id: String(nodeId) },
            targetOrigin
        );
    } catch {
        // ignore postMessage failures
    }
}

export function leaveNode() {
    const targetOrigin = getParentTargetOrigin();
    try {
        window.parent?.postMessage?.(
            { type: "xdatahub:node_hover_leave" },
            targetOrigin
        );
    } catch {
        // ignore postMessage failures
    }
}
