import { app } from "../../scripts/app.js";

// XPipe 管道束节点前端扩展
// ============================
// Canvas 浮层输入框贴在端口旁，支持编辑、自动命名、向下传递、
// 固定 20 槽位、管道连线显隐切换。

var NODE_CLASS = "XPipe";
var HIDE_NONE = 0;
var HIDE_INPUT = 1;   // bit 0
var HIDE_OUTPUT = 2;  // bit 1
var HIDE_BOTH = 3;    // bits 0+1
var PIPE_SLOTS = 20;
var HIDE_STATE_PROP = "xpipe_hide_links_state";
var NAMES_WIDGET = "port_names";
var META_WIDGET = "xpipe_ui_state";
var NAMES_PROP = "xpipe_names";
var MANUAL_PROP = "xpipe_manual";
var TYPES_PROP = "xpipe_types";
var MIN_NODE_W = 210;
var WARNING_COLOR = "#ff6a3d";
var WARNING_GLOW = "rgba(255, 106, 61, 0.7)";
var BUTTON_HIDE = "xpipe-hide";
var HIDE_BUTTON_TEXTS = ["◀▶", "◁▶", "◀▷", "◁▷"];
var TITLE_BUTTON_FONT_SIZE = 14;
var TITLE_BUTTON_HEIGHT = 22;
var TITLE_BUTTON_Y_OFFSET = 1;
var HIDE_BUTTON_X_OFFSET = -8;
var NAME_INPUT_FONT_SIZE = 12;
var NAME_INPUT_FONT_FAMILY = "Inter, sans-serif";
var graphIds = new WeakMap();
var nextGraphId = 1;
var scopedNodeIds = new WeakMap();
var scopedNodeIdsRoot = null;
var subgraphParentNodes = new WeakMap();
var XPIPE_DEBUG = false;
var XPIPE_LOG_PREFIX = "[XPipe]";

// ---------------------------------------------------------------------------
// 工具
// ---------------------------------------------------------------------------
function slotIndexOfName(list, name) {
    if (!list) return -1;
    for (var i = 0; i < list.length; i++) if (list[i] && list[i].name === name) return i;
    return -1;
}
function valueSlotNumber(name) {
    var m = /^value_(\d+)$/.exec(name || "");
    return m ? parseInt(m[1], 10) : 0;
}
function cleanName(value) {
    return value == null ? "" : String(value).trim();
}
function cleanType(value) {
    if (Array.isArray(value)) value = value[0];
    var type = value == null ? "" : String(value).trim();
    return type && type !== "*" ? type : "";
}
function socketType(value) {
    return cleanType(value) || "*";
}
function padArray(arr, size, fill) {
    var out = Array.isArray(arr) ? arr.slice(0, size) : [];
    while (out.length < size) out.push(fill);
    return out;
}
function xpipeDebugEnabled() {
    return XPIPE_DEBUG || !!(window && window.XPIPE_DEBUG === true);
}
function compactSlots(values) {
    if (!xpipeDebugEnabled()) return {};
    var out = {};
    if (!Array.isArray(values)) return out;
    for (var i = 0; i < values.length; i++) {
        if (values[i]) out[String(i + 1)] = values[i];
    }
    return out;
}
function debugNode(node) {
    if (!xpipeDebugEnabled()) return null;
    if (!node) return null;
    return {
        id: node.id,
        type: String(node.comfyClass || node.type || ""),
        title: node.title || "",
        graph: graphKey(node.graph),
        scoped: getScopedNodeId(node),
    };
}
function debugSlot(slot) {
    if (!xpipeDebugEnabled()) return null;
    if (!slot) return null;
    return {
        name: slot.name,
        label: slot.label,
        type: slot.type,
        link: slot.link,
        links: Array.isArray(slot.links) ? slot.links.slice() : slot.links,
        linkIds: Array.isArray(slot.linkIds) ? slot.linkIds.slice() : slot.linkIds,
    };
}
function xpipeLog(event, data) {
    if (!xpipeDebugEnabled() || !console) return;
    try { console.debug(XPIPE_LOG_PREFIX + " " + event, data || ""); } catch (_e) {}
}
function xpipeWarn(event, data) {
    if (!xpipeDebugEnabled() || !console) return;
    try { console.warn(XPIPE_LOG_PREFIX + " " + event, data || ""); } catch (_e) {}
}
function parseNames(raw) {
    var data = [];
    try { data = JSON.parse(raw || "[]"); } catch (_e) { data = []; }
    if (!Array.isArray(data)) data = [];
    return padArray(data.map(function (n) { return n == null ? "" : String(n); }), PIPE_SLOTS, "");
}
function activeGraph() {
    return (app.canvas && app.canvas.getCurrentGraph && app.canvas.getCurrentGraph())
        || (app.canvas && app.canvas.graph)
        || app.graph;
}
function graphKey(graph) {
    if (!graph) return "root";
    if (!graphIds.has(graph)) graphIds.set(graph, String(nextGraphId++));
    return graphIds.get(graph);
}
function nodeKey(node) {
    var scopedId = getScopedNodeId(node);
    if (scopedId) return scopedId;
    return graphKey(node && node.graph) + ":" + String(node && node.id);
}
function graphNodes(graph) {
    return graph ? (graph._nodes || graph.nodes || []) : [];
}
function markCanvasDirty() {
    if (!app.canvas) return;
    if (typeof app.canvas.setDirtyCanvas === "function") {
        app.canvas.setDirtyCanvas(true, true);
    } else if (typeof app.canvas.setDirty === "function") {
        app.canvas.setDirty(true, true);
    }
}
function bringXPipeNodeToFront(node) {
    if (!node || !app.canvas) return;
    try {
        if (typeof app.canvas.selectNode === "function") {
            app.canvas.selectNode(node);
        }
        if (typeof app.canvas.bringToFront === "function") {
            app.canvas.bringToFront(node);
        }
        markCanvasDirty();
        requestAnimationFrame(function () {
            try { syncAllOverlays(); } catch (_e) {}
        });
    } catch (_e) {}
}
function forEachGraphInTree(rootGraph, visitor) {
    if (!rootGraph || typeof visitor !== "function") return;
    var visited = new WeakSet();
    var walk = function (graph) {
        if (!graph || typeof graph !== "object" || visited.has(graph)) return;
        visited.add(graph);
        visitor(graph);
        var nodes = graphNodes(graph);
        for (var i = 0; i < nodes.length; i++) {
            if (nodes[i] && nodes[i].subgraph) walk(nodes[i].subgraph);
        }
    };
    walk(rootGraph);
}
function getNodeByIdInGraph(graph, nodeId) {
    if (!graph || nodeId == null) return null;
    if (typeof graph.getNodeById === "function") {
        var found = graph.getNodeById(nodeId);
        if (found) return found;
    }
    var nodes = graphNodes(graph);
    for (var i = 0; i < nodes.length; i++) {
        if (String(nodes[i] && nodes[i].id) === String(nodeId)) return nodes[i];
    }
    return null;
}
function buildScopedNodeId(pathIds, nodeId) {
    var base = String(nodeId == null ? "" : nodeId).trim();
    if (!base) return "";
    if (!Array.isArray(pathIds) || pathIds.length < 1) return base;
    return pathIds.join(":") + ":" + base;
}
function forEachNodeInGraphTree(rootGraph, visitor) {
    if (!rootGraph || typeof visitor !== "function") return;
    var visited = new WeakSet();
    var walk = function (graph, pathIds) {
        if (!graph || typeof graph !== "object" || visited.has(graph)) return;
        visited.add(graph);
        var nodes = graphNodes(graph);
        for (var i = 0; i < nodes.length; i++) {
            var node = nodes[i];
            var nodeId = String(node && node.id != null ? node.id : "").trim();
            if (!nodeId) continue;
            var scopedId = buildScopedNodeId(pathIds, nodeId);
            visitor(node, scopedId, graph, pathIds);
            if (node && node.subgraph && typeof node.subgraph === "object") {
                walk(node.subgraph, pathIds.concat([nodeId]));
            }
        }
    };
    walk(rootGraph, []);
}
function resetGraphTreeCaches() {
    scopedNodeIds = new WeakMap();
    scopedNodeIdsRoot = null;
    subgraphParentNodes = new WeakMap();
}
function rebuildGraphTreeCaches() {
    scopedNodeIds = new WeakMap();
    subgraphParentNodes = new WeakMap();
    scopedNodeIdsRoot = app.graph || null;
    forEachNodeInGraphTree(scopedNodeIdsRoot, function (node, scopedId) {
        scopedNodeIds.set(node, scopedId);
        if (node && node.subgraph) subgraphParentNodes.set(node.subgraph, node);
    });
}
function ensureGraphTreeCaches() {
    if (scopedNodeIdsRoot !== app.graph) rebuildGraphTreeCaches();
}
function getScopedNodeId(node) {
    if (!node || !app.graph) return "";
    ensureGraphTreeCaches();
    if (!scopedNodeIds.has(node)) rebuildGraphTreeCaches();
    return scopedNodeIds.get(node) || "";
}
function findSubgraphNodeForGraph(childGraph) {
    if (!childGraph) return null;
    ensureGraphTreeCaches();
    var found = subgraphParentNodes.get(childGraph);
    if (found) return found;
    rebuildGraphTreeCaches();
    return subgraphParentNodes.get(childGraph) || null;
}
function normalizedNodeType(node) {
    return String(
        (node && (node.comfyClass || node.type || node.title
            || (node.constructor && node.constructor.name))) || ""
    ).toLowerCase().replace(/[^a-z0-9]/g, "");
}
function isSubgraphInputNode(node, graph) {
    if (!node) return false;
    if (graph && node === graph.inputNode) return true;
    return normalizedNodeType(node).indexOf("subgraphinput") >= 0;
}
function isSubgraphOutputNode(node, graph) {
    if (!node) return false;
    if (graph && node === graph.outputNode) return true;
    return normalizedNodeType(node).indexOf("subgraphoutput") >= 0;
}
function findSubgraphInputNode(graph) {
    if (!graph) return null;
    if (graph.inputNode) return graph.inputNode;
    var nodes = graphNodes(graph);
    for (var i = 0; i < nodes.length; i++) {
        if (isSubgraphInputNode(nodes[i], graph)) return nodes[i];
    }
    return null;
}
function findSubgraphOutputNode(graph) {
    if (!graph) return null;
    if (graph.outputNode) return graph.outputNode;
    var nodes = graphNodes(graph);
    for (var i = 0; i < nodes.length; i++) {
        if (isSubgraphOutputNode(nodes[i], graph)) return nodes[i];
    }
    return null;
}
function findSlotOwner(slot, direction, preferredGraph) {
    if (!slot) return null;
    var found = null;
    var visitGraph = function (graph) {
        if (found) return;
        var nodes = graphNodes(graph);
        for (var i = 0; i < nodes.length; i++) {
            var node = nodes[i], list = direction === "input" ? node.inputs : node.outputs;
            if (!list) continue;
            for (var j = 0; j < list.length; j++) {
                if (list[j] === slot) {
                    found = { node: node, index: j, slot: slot, graph: graph };
                    return;
                }
            }
        }
    };
    if (preferredGraph) visitGraph(preferredGraph);
    if (!found) forEachGraphInTree(app.graph, visitGraph);
    return found;
}
function forEachXPipeInGraphTree(rootGraph, visitor) {
    forEachNodeInGraphTree(rootGraph, function (node) {
        if (isXPipe(node)) visitor(node);
    });
}
function refreshAllXPipesInGraphTree(rootGraph) {
    var nodes = [];
    forEachXPipeInGraphTree(rootGraph || app.graph, function (node) {
        nodes.push(node);
        ensureXPipe(node);
        if (!node.__xpipeState) return;
        refreshAutoNames(node.__xpipeState);
        refreshSlotTypes(node.__xpipeState);
        syncSlots(node.__xpipeState);
        fitNode(node.__xpipeState);
    });
    for (var i = 0; i < nodes.length; i++) {
        if (isXPipe(nodes[i])) {
            try { notifyTypesDownstream(nodes[i]); } catch (_e) {}
        }
    }
    if (xpipeDebugEnabled()) {
        xpipeLog("refreshAllXPipesInGraphTree", {
            root: graphKey(rootGraph || app.graph),
            count: nodes.length,
            nodes: nodes.map(debugNode),
        });
    }
}

// ---------------------------------------------------------------------------
// 状态
// ---------------------------------------------------------------------------
function findNamesWidget(node) {
    if (!node.widgets) return null;
    for (var i = 0; i < node.widgets.length; i++)
        if (node.widgets[i] && node.widgets[i].name === NAMES_WIDGET) return node.widgets[i];
    return null;
}
function findMetaWidget(node) {
    if (!node || !node.widgets) return null;
    for (var i = 0; i < node.widgets.length; i++)
        if (node.widgets[i] && node.widgets[i].name === META_WIDGET) return node.widgets[i];
    return null;
}
function ensureMetaWidget(node) {
    if (!node) return null;
    var widget = findMetaWidget(node);
    if (!widget && typeof node.addWidget === "function") {
        var saved = node.properties && typeof node.properties[META_WIDGET] === "string"
            ? node.properties[META_WIDGET]
            : "{}";
        widget = node.addWidget("text", META_WIDGET, saved, function () {});
    }
    hideWidget(widget);
    return widget || null;
}
function hideWidget(w) {
    if (!w) return;
    w.hidden = true;
    w.computeSize = function () { return [0, -4]; };
    w.serializeValue = function () { return w.value; };
}
function hideNamesWidget(w) {
    hideWidget(w);
}
function removePortNamesSlot(node) {
    if (!node || !Array.isArray(node.inputs)) return;
    var before = node.inputs.length;
    node.inputs = node.inputs.filter(function (input) {
        var name = String(input && input.name || "");
        return name !== NAMES_WIDGET && name !== META_WIDGET;
    });
    if (node.inputs.length !== before) node.graph && node.graph.setDirtyCanvas(true, true);
}
function cloneSlotDef(slot) {
    var out = {};
    if (slot) {
        for (var key in slot) {
            if (!slot.hasOwnProperty(key)) continue;
            if (key === "link" || key === "links" || key === "pos") continue;
            out[key] = slot[key];
        }
    }
    return out;
}
function captureSlotDefs(node) {
    var defs = { inputs: {}, outputs: {} };
    for (var k = 1; k <= PIPE_SLOTS; k++) {
        var inputIndex = slotIndexOfName(node.inputs, "value_" + k);
        var outputIndex = slotIndexOfName(node.outputs, "value_" + k);
        defs.inputs[k] = cloneSlotDef(inputIndex >= 0 ? node.inputs[inputIndex] : null);
        defs.outputs[k] = cloneSlotDef(outputIndex >= 0 ? node.outputs[outputIndex] : null);
        defs.inputs[k].name = "value_" + k;
        defs.outputs[k].name = "value_" + k;
        defs.inputs[k].type = socketType(defs.inputs[k].type);
        defs.outputs[k].type = socketType(defs.outputs[k].type);
    }
    return defs;
}
function addValueInput(node, state, slot) {
    var def = cloneSlotDef(state.slotDefs.inputs[slot]);
    def.name = "value_" + slot;
    def.type = "*";
    node.addInput(def.name, def.type);
    var index = slotIndexOfName(node.inputs, def.name);
    if (index >= 0) Object.assign(node.inputs[index], def);
}
function addValueOutput(node, state, slot) {
    var def = cloneSlotDef(state.slotDefs.outputs[slot]);
    def.name = "value_" + slot;
    def.type = socketType(state.types[slot - 1]);
    node.addOutput(def.name, def.type);
    var index = slotIndexOfName(node.outputs, def.name);
    if (index >= 0) Object.assign(node.outputs[index], def);
}
function loadState(state) {
    var props = state.node.properties || {};
    var meta = loadMetaState(state.node);
    state.names = Array.isArray(props[NAMES_PROP])
        ? padArray(props[NAMES_PROP].map(function (n) { return n == null ? "" : String(n); }), PIPE_SLOTS, "")
        : (Array.isArray(meta.names)
            ? padArray(meta.names.map(function (n) { return n == null ? "" : String(n); }), PIPE_SLOTS, "")
            : (state.namesWidget ? parseNames(state.namesWidget.value) : padArray([], PIPE_SLOTS, "")));
    state.manual = mergeManualState(props[MANUAL_PROP], meta);
    state.names = mergeManualMetaNames(state.names, meta, state.manual);
    state.types = mergeMetaTypes(props[TYPES_PROP], meta);
    xpipeLog("loadState", {
        node: debugNode(state.node),
        propNames: compactSlots(props[NAMES_PROP]),
        propTypes: compactSlots(props[TYPES_PROP]),
        metaNames: compactSlots(meta.names),
        metaTypes: compactSlots(meta.types),
        names: compactSlots(state.names),
        types: compactSlots(state.types),
        manual: compactSlots(state.manual),
    });
}
function loadMetaState(node) {
    var widget = findMetaWidget(node);
    var raw = widget && typeof widget.value === "string"
        ? widget.value
        : "";
    if ((!raw || raw === "{}") && node && node.properties) {
        raw = node.properties[META_WIDGET] || raw;
    }
    try {
        var data = JSON.parse(raw || "{}");
        data = data && typeof data === "object" ? data : {};
        xpipeLog("loadMetaState", {
            node: debugNode(node),
            names: compactSlots(data.names),
            types: compactSlots(data.types),
            manual: compactSlots(data.manual),
        });
        return data;
    } catch (_e) {
        xpipeWarn("loadMetaState.parseFailed", {
            node: debugNode(node),
            raw: raw,
            error: String(_e),
        });
        return {};
    }
}
function saveMetaState(state) {
    if (!state || !state.node) return;
    var payload = JSON.stringify({
        names: padArray(state.names, PIPE_SLOTS, ""),
        manual: padArray(state.manual, PIPE_SLOTS, false),
        types: padArray(state.types, PIPE_SLOTS, ""),
    });
    var p = state.node.properties = state.node.properties || {};
    p[META_WIDGET] = payload;
    var widget = ensureMetaWidget(state.node);
    if (widget) widget.value = payload;
    xpipeLog("saveMetaState", {
        node: debugNode(state.node),
        names: compactSlots(state.names),
        types: compactSlots(state.types),
        manual: compactSlots(state.manual),
    });
}
function mergeManualState(savedManual, meta) {
    var saved = padArray(
        Array.isArray(savedManual) ? savedManual.map(Boolean) : [],
        PIPE_SLOTS,
        false
    );
    var metaManual = padArray(
        Array.isArray(meta && meta.manual) ? meta.manual.map(Boolean) : [],
        PIPE_SLOTS,
        false
    );
    for (var k = 0; k < PIPE_SLOTS; k++) saved[k] = saved[k] || metaManual[k];
    return saved;
}
function mergeManualMetaNames(names, meta, manual) {
    var out = padArray(Array.isArray(names) ? names : [], PIPE_SLOTS, "");
    var metaNames = padArray(
        Array.isArray(meta && meta.names)
            ? meta.names.map(function (n) { return n == null ? "" : String(n); })
            : [],
        PIPE_SLOTS,
        ""
    );
    for (var k = 0; k < PIPE_SLOTS; k++) {
        if (manual[k] && !cleanName(out[k]) && cleanName(metaNames[k])) {
            out[k] = metaNames[k];
        }
    }
    return out;
}
function mergeMetaTypes(types, meta) {
    var out = padArray(
        Array.isArray(types) ? types.map(cleanType) : [],
        PIPE_SLOTS,
        ""
    );
    var metaTypes = padArray(
        Array.isArray(meta && meta.types) ? meta.types.map(cleanType) : [],
        PIPE_SLOTS,
        ""
    );
    for (var k = 0; k < PIPE_SLOTS; k++) {
        if (!out[k] && metaTypes[k]) out[k] = metaTypes[k];
    }
    return out;
}
function persistState(state) {
    saveStateNames(state.node, state.names);
    saveStateManual(state.node, state.manual);
    saveStateTypes(state.node, state.types);
    saveMetaState(state);
}

// ---------------------------------------------------------------------------
// Canvas 基础交互转发
// ---------------------------------------------------------------------------
var middleCanvasDrag = false;
var middleForwardingInstalled = false;

function installMiddleForwarding() {
    if (middleForwardingInstalled) return;
    middleForwardingInstalled = true;
    window.addEventListener("mousemove", function (event) {
        if (!middleCanvasDrag || !app.canvas || !app.canvas.processMouseMove) return;
        event.preventDefault();
        event.stopPropagation();
        app.canvas.processMouseMove(event);
    }, true);
    window.addEventListener("mouseup", function (event) {
        if (!middleCanvasDrag || !app.canvas || !app.canvas.processMouseUp) return;
        middleCanvasDrag = false;
        event.preventDefault();
        event.stopPropagation();
        app.canvas.processMouseUp(event);
    }, true);
}
function forwardWheelToCanvas(event) {
    var graphCanvas = app.canvas && app.canvas.canvas;
    if (!graphCanvas) return;
    event.preventDefault();
    event.stopPropagation();
    graphCanvas.dispatchEvent(new WheelEvent("wheel", {
        bubbles: true,
        cancelable: true,
        clientX: event.clientX,
        clientY: event.clientY,
        screenX: event.screenX,
        screenY: event.screenY,
        deltaX: event.deltaX,
        deltaY: event.deltaY,
        deltaZ: event.deltaZ,
        deltaMode: event.deltaMode,
        ctrlKey: event.ctrlKey,
        shiftKey: event.shiftKey,
        altKey: event.altKey,
        metaKey: event.metaKey,
    }));
}
function forwardMiddleDownToCanvas(event) {
    if (event.button !== 1 || !app.canvas || !app.canvas.processMouseDown) return;
    installMiddleForwarding();
    middleCanvasDrag = true;
    event.preventDefault();
    event.stopPropagation();
    app.canvas.processMouseDown(event);
}
function attachCanvasPassThrough(element) {
    if (!element || element.__xpipeCanvasPassThrough) return;
    element.__xpipeCanvasPassThrough = true;
    element.addEventListener("wheel", forwardWheelToCanvas, { passive: false });
    element.addEventListener("mousedown", forwardMiddleDownToCanvas, true);
}

// ---------------------------------------------------------------------------
// 端口标签隐藏
// ---------------------------------------------------------------------------
function hidePortLabels(node) {
    for (var k = 1; k <= PIPE_SLOTS; k++) {
        var ii = slotIndexOfName(node.inputs, "value_" + k);
        if (ii >= 0) node.inputs[ii].label = " ";
        var oi = slotIndexOfName(node.outputs, "value_" + k);
        if (oi >= 0) node.outputs[oi].label = " ";
    }
    node.setDirtyCanvas && node.setDirtyCanvas(true, true);
}

// ---------------------------------------------------------------------------
// 固定槽位 + 尺寸
// ---------------------------------------------------------------------------
function syncSlots(state) {
    var node = state.node, k;
    for (k = 1; k <= PIPE_SLOTS; k++) {
        if (slotIndexOfName(node.inputs, "value_" + k) < 0) addValueInput(node, state, k);
        if (slotIndexOfName(node.outputs, "value_" + k) < 0) addValueOutput(node, state, k);
    }
    applySlotTypes(state);
    hidePortLabels(node);
    removePortNamesSlot(node);
    state.visibleCount = PIPE_SLOTS;
}
function fitNode(state) {
    var n = state.node;
    if (!n) return;
    if (typeof n.setSize === "function" && typeof n.computeSize === "function") {
        var cs = n.computeSize();
        n.setSize([Math.max(cs[0], MIN_NODE_W), cs[1]]);
    }
    n.setDirtyCanvas && n.setDirtyCanvas(true, true);
}

function getUpstreamBundleMeta(node, seen) {
    var pin = slotIndexOfName(node.inputs, "inp");
    if (pin < 0 || node.inputs[pin].link == null) return null;
    return getFullBundleMetaFromLink(
        getLinkInfo(node.inputs[pin].link, node.graph),
        seen,
        node.graph
    );
}
function resultResolved(value) {
    return { state: "resolved", value: value };
}
function resultEmpty() {
    return { state: "empty", value: "" };
}
function resultUnresolved() {
    return { state: "unresolved", value: "" };
}
function getUpstreamBundleMetaResult(node, seen) {
    var pin = slotIndexOfName(node.inputs, "inp");
    if (pin < 0 || !node.inputs[pin] || node.inputs[pin].link == null) {
        xpipeLog("upstreamMeta.empty", {
            node: debugNode(node),
            pin: pin,
        });
        return resultEmpty();
    }
    var meta = getFullBundleMetaFromLink(
        getLinkInfo(node.inputs[pin].link, node.graph),
        seen,
        node.graph
    );
    xpipeLog("upstreamMeta.result", {
        node: debugNode(node),
        link: node.inputs[pin].link,
        state: meta ? "resolved" : "unresolved",
        metaNode: debugNode(meta && meta.node),
        names: compactSlots(meta && meta.names),
        types: compactSlots(meta && meta.types),
    });
    return meta ? resultResolved(meta) : resultUnresolved();
}
function getLinkInfo(linkId, graph) {
    graph = graph || activeGraph();
    if (!graph || linkId == null) return null;
    if (typeof graph.getLink === "function") {
        var graphLink = graph.getLink(linkId);
        if (graphLink) return graphLink;
    }
    if (graph.links && graph.links[linkId]) return graph.links[linkId];
    if (graph._links instanceof Map) return graph._links.get(linkId) || null;
    return graph._links && graph._links[linkId] || null;
}
function getLinkInfoInGraphTree(linkId, preferredGraph) {
    var link = getLinkInfo(linkId, preferredGraph);
    if (link) return { link: link, graph: preferredGraph };
    var found = null;
    forEachGraphInTree(app.graph, function (graph) {
        if (found) return;
        var item = getLinkInfo(linkId, graph);
        if (item) found = { link: item, graph: graph };
    });
    return found;
}
function slotLinkIds(slot) {
    if (!slot) return [];
    if (Array.isArray(slot.linkIds)) return slot.linkIds.slice();
    if (Array.isArray(slot.links)) return slot.links.slice();
    if (slot.linkId != null) return [slot.linkId];
    if (slot.link != null) return [slot.link];
    return [];
}
function slotKeyNames(slot) {
    var out = [];
    var add = function (value) {
        var name = cleanName(value);
        if (name && out.indexOf(name) < 0) out.push(name);
    };
    if (!slot) return out;
    add(slot.name);
    add(slot.label);
    add(slot.localized_name);
    return out;
}
function slotAt(slots, index) {
    if (!slots || index == null || index < 0) return null;
    return slots[index] || null;
}
function slotEntries(slots) {
    if (!slots) return [];
    if (Array.isArray(slots)) {
        return slots.map(function (slot, index) {
            return { index: index, slot: slot };
        });
    }
    var out = [];
    for (var key in slots) {
        if (!slots.hasOwnProperty(key)) continue;
        var index = parseInt(key, 10);
        if (!isNaN(index)) out.push({ index: index, slot: slots[key] });
    }
    out.sort(function (a, b) { return a.index - b.index; });
    return out;
}
function findMatchingSlotIndex(slots, refSlot, fallbackIndex) {
    if (!slots) return -1;
    if (slotAt(slots, fallbackIndex)) return fallbackIndex;
    var names = slotKeyNames(refSlot);
    var entries = slotEntries(slots);
    for (var n = 0; n < names.length; n++) {
        for (var i = 0; i < entries.length; i++) {
            if (slotKeyNames(entries[i].slot).indexOf(names[n]) >= 0) {
                return entries[i].index;
            }
        }
    }
    return -1;
}
function subgraphInputIndexFromNodeOutput(subgraph, inputNode, outputIndex) {
    var refSlot = slotAt(inputNode && inputNode.outputs, outputIndex);
    return findMatchingSlotIndex(subgraph && subgraph.inputs, refSlot, outputIndex);
}
function subgraphInputNodeOutputIndex(subgraph, inputIndex) {
    var inputNode = findSubgraphInputNode(subgraph);
    var refSlot = slotAt(subgraph && subgraph.inputs, inputIndex);
    return {
        node: inputNode,
        index: findMatchingSlotIndex(inputNode && inputNode.outputs, refSlot, inputIndex),
    };
}
function subgraphOutputIndexFromNodeOutput(subgraph, subgraphNode, outputIndex) {
    var refSlot = slotAt(subgraphNode && subgraphNode.outputs, outputIndex);
    return findMatchingSlotIndex(subgraph && subgraph.outputs, refSlot, outputIndex);
}
function subgraphOutputNodeInputIndex(subgraph, outputIndex) {
    var outputNode = findSubgraphOutputNode(subgraph);
    var refSlot = slotAt(subgraph && subgraph.outputs, outputIndex);
    return {
        node: outputNode,
        index: findMatchingSlotIndex(outputNode && outputNode.inputs, refSlot, outputIndex),
    };
}
function resolveLinkInfo(linkInfo, graph) {
    if (!linkInfo || typeof linkInfo.resolve !== "function") return null;
    try {
        var resolved = linkInfo.resolve(graph);
        xpipeLog("link.resolve", {
            graph: graphKey(graph),
            link: linkInfo.id,
            origin: linkInfo.origin_id + ":" + linkInfo.origin_slot,
            target: linkInfo.target_id + ":" + linkInfo.target_slot,
            hasOutput: !!(resolved && resolved.output),
            hasSubgraphInput: !!(resolved && resolved.subgraphInput),
            output: debugSlot(resolved && resolved.output),
            subgraphInput: debugSlot(resolved && resolved.subgraphInput),
        });
        return resolved;
    } catch (_e) {
        xpipeWarn("link.resolve.failed", {
            graph: graphKey(graph),
            link: linkInfo && linkInfo.id,
            error: String(_e),
        });
        return null;
    }
}
function getResolvedSourceSlots(linkInfo, graph) {
    var resolved = resolveLinkInfo(linkInfo, graph);
    if (!resolved) return [];
    var out = [];
    if (resolved.subgraphInput) out.push(resolved.subgraphInput);
    if (resolved.output && out.indexOf(resolved.output) < 0) out.push(resolved.output);
    return out;
}
function findLinkToNodeInput(graph, targetNode, targetSlot) {
    if (!graph || !targetNode) return null;
    var links = graph.links || graph._links;
    if (!links) return null;
    if (links instanceof Map) {
        var found = null;
        links.forEach(function (link) {
            if (!found && link && link.target_id === targetNode.id
                && link.target_slot === targetSlot) found = link;
        });
        return found;
    }
    for (var id in links) {
        if (!links.hasOwnProperty(id)) continue;
        var link = links[id];
        if (link && link.target_id === targetNode.id
            && link.target_slot === targetSlot) return link;
    }
    return null;
}
function bundleMetaFromState(node, outputIndex) {
    var st = node && node.__xpipeState;
    if (!st && isXPipe(node)) {
        ensureXPipe(node);
        st = node.__xpipeState;
        if (st) {
            refreshAutoNames(st);
            refreshSlotTypes(st);
            syncSlots(st);
        }
    }
    if (!st) return null;
    return {
        node: node,
        outputIndex: outputIndex,
        names: st.names || [],
        types: st.types || [],
    };
}
function getFullBundleMetaFromResolvedSlot(slot, seen, graph) {
    if (!slot) return null;
    var outputOwner = findSlotOwner(slot, "output", graph);
    if (outputOwner && isXPipe(outputOwner.node)) {
        return getFullBundleMetaFromOutput(outputOwner.node, outputOwner.index, seen);
    }
    var inputOwner = findSlotOwner(slot, "input", graph);
    if (inputOwner) {
        var input = inputOwner.slot;
        if (input && input.link != null) {
            var upstream = getLinkInfo(input.link, inputOwner.node.graph);
            return getFullBundleMetaFromLink(upstream, seen, inputOwner.node.graph);
        }
    }
    var ids = slotLinkIds(slot);
    for (var i = 0; i < ids.length; i++) {
        var found = getLinkInfoInGraphTree(ids[i], graph);
        if (!found) continue;
        var meta = getFullBundleMetaFromLink(found.link, seen, found.graph);
        if (meta) return meta;
    }
    return null;
}
function getFullBundleMetaFromResolvedLink(linkInfo, seen, graph) {
    var slots = getResolvedSourceSlots(linkInfo, graph);
    for (var i = 0; i < slots.length; i++) {
        var meta = getFullBundleMetaFromResolvedSlot(slots[i], seen, graph);
        if (meta) return meta;
    }
    return null;
}
function getFullBundleMetaFromVirtualSubgraphInput(linkInfo, seen, graph) {
    if (!graph || !linkInfo || Number(linkInfo.origin_id) >= 0) return null;
    var subgraphNode = findSubgraphNodeForGraph(graph);
    if (!subgraphNode || !subgraphNode.graph || !subgraphNode.inputs) {
        xpipeWarn("virtualSubgraphInput.noParentNode", {
            graph: graphKey(graph),
            link: linkInfo && linkInfo.id,
            originId: linkInfo && linkInfo.origin_id,
            originSlot: linkInfo && linkInfo.origin_slot,
        });
        return null;
    }
    var input = slotAt(subgraphNode.inputs, linkInfo.origin_slot);
    xpipeLog("virtualSubgraphInput.map", {
        childGraph: graphKey(graph),
        link: linkInfo.id,
        originId: linkInfo.origin_id,
        originSlot: linkInfo.origin_slot,
        parentNode: debugNode(subgraphNode),
        parentInput: debugSlot(input),
    });
    if (!input || input.link == null) {
        xpipeWarn("virtualSubgraphInput.noParentInputLink", {
            parentNode: debugNode(subgraphNode),
            originSlot: linkInfo.origin_slot,
            parentInput: debugSlot(input),
        });
        return null;
    }
    return getFullBundleMetaFromLink(
        getLinkInfo(input.link, subgraphNode.graph),
        seen,
        subgraphNode.graph
    );
}
function getFullBundleMetaFromLink(linkInfo, seen, graph) {
    graph = graph || activeGraph();
    if (!linkInfo || !graph) {
        xpipeWarn("metaFromLink.missingLinkOrGraph", {
            graph: graphKey(graph),
            link: linkInfo,
        });
        return null;
    }
    seen = seen || {};
    var linkKey = "link:" + graphKey(graph) + ":" + String(linkInfo.id != null ? linkInfo.id : (
        String(linkInfo.origin_id) + ":" + String(linkInfo.origin_slot)
            + ">" + String(linkInfo.target_id) + ":" + String(linkInfo.target_slot)
    ));
    if (seen[linkKey]) return null;
    seen[linkKey] = true;
    var resolvedMeta = getFullBundleMetaFromResolvedLink(linkInfo, seen, graph);
    if (resolvedMeta) {
        xpipeLog("metaFromLink.resolvedSlot", {
            graph: graphKey(graph),
            link: linkInfo.id,
            metaNode: debugNode(resolvedMeta.node),
            outputIndex: resolvedMeta.outputIndex,
            names: compactSlots(resolvedMeta.names),
            types: compactSlots(resolvedMeta.types),
        });
        return resolvedMeta;
    }
    var virtualMeta = getFullBundleMetaFromVirtualSubgraphInput(
        linkInfo,
        seen,
        graph
    );
    if (virtualMeta) {
        xpipeLog("metaFromLink.virtualSubgraphInput", {
            graph: graphKey(graph),
            link: linkInfo.id,
            metaNode: debugNode(virtualMeta.node),
            outputIndex: virtualMeta.outputIndex,
            names: compactSlots(virtualMeta.names),
            types: compactSlots(virtualMeta.types),
        });
        return virtualMeta;
    }
    var source = getNodeByIdInGraph(graph, linkInfo.origin_id);
    if (!source) {
        xpipeWarn("metaFromLink.missingSource", {
            graph: graphKey(graph),
            link: linkInfo.id,
            originId: linkInfo.origin_id,
        });
        return null;
    }
    var meta = isXPipe(source)
        ? getFullBundleMetaFromOutput(source, linkInfo.origin_slot, seen)
        : getFullBundleMetaThroughSubgraphInput(source, linkInfo.origin_slot, seen, graph)
            || getFullBundleMetaThroughSubgraphOutput(source, linkInfo.origin_slot, seen);
    xpipeLog("metaFromLink.result", {
        graph: graphKey(graph),
        link: linkInfo.id,
        source: debugNode(source),
        originSlot: linkInfo.origin_slot,
        resolved: !!meta,
        metaNode: debugNode(meta && meta.node),
        outputIndex: meta && meta.outputIndex,
        names: compactSlots(meta && meta.names),
        types: compactSlots(meta && meta.types),
    });
    return meta;
}
function getFullBundleMetaFromOutput(node, outputIndex, seen) {
    if (!node || !isXPipe(node) || !node.outputs) return null;
    seen = seen || {};
    var key = "full:" + nodeKey(node) + ":" + outputIndex;
    if (seen[key]) return null;
    seen[key] = true;
    var output = node.outputs[outputIndex];
    if (!output) return null;
    if (output.name === "out") return bundleMetaFromState(node, outputIndex);
    var slot = valueSlotNumber(output.name);
    return slot ? getSlotBundleMetaFromNode(node, slot, seen) : null;
}
function getSlotBundleMetaFromNode(node, slot, seen) {
    if (!node || !isXPipe(node)) return null;
    seen = seen || {};
    var key = "slot:" + nodeKey(node) + ":" + slot;
    if (seen[key]) return null;
    seen[key] = true;

    var inputIndex = slotIndexOfName(node.inputs, "value_" + slot);
    var input = inputIndex >= 0 && node.inputs ? node.inputs[inputIndex] : null;
    var directMeta = input && input.link != null
        ? getFullBundleMetaFromLink(getLinkInfo(input.link, node.graph), seen, node.graph)
        : null;
    if (directMeta) return directMeta;

    var pin = slotIndexOfName(node.inputs, "inp");
    var pipeInput = pin >= 0 && node.inputs ? node.inputs[pin] : null;
    if (!pipeInput || pipeInput.link == null) return null;
    return getSlotBundleMetaFromLink(getLinkInfo(pipeInput.link, node.graph), slot, seen, node.graph);
}
function getSlotBundleMetaFromLink(linkInfo, slot, seen, graph) {
    graph = graph || activeGraph();
    var fullMeta = getFullBundleMetaFromLink(linkInfo, seen, graph);
    if (!fullMeta) return null;
    return getSlotBundleMetaFromOutput(fullMeta.node, fullMeta.outputIndex, slot, seen);
}
function getSlotBundleMetaFromOutput(node, outputIndex, slot, seen) {
    if (!node || !isXPipe(node) || !node.outputs) return null;
    var output = node.outputs[outputIndex];
    if (!output) return null;
    if (output.name === "out") return getSlotBundleMetaFromNode(node, slot, seen);
    var fullMeta = getFullBundleMetaFromOutput(node, outputIndex, seen);
    if (!fullMeta) return null;
    return getSlotBundleMetaFromOutput(fullMeta.node, fullMeta.outputIndex, slot, seen);
}
function getFullBundleMetaThroughSubgraphInput(source, outputIndex, seen, graph) {
    if (!graph || !isSubgraphInputNode(source, graph)) return null;
    var subgraphNode = findSubgraphNodeForGraph(graph);
    if (!subgraphNode || !subgraphNode.graph || !subgraphNode.inputs) {
        xpipeWarn("subgraphInput.noParentNode", {
            graph: graphKey(graph),
            source: debugNode(source),
            outputIndex: outputIndex,
        });
        return null;
    }
    var inputIndex = subgraphInputIndexFromNodeOutput(graph, source, outputIndex);
    var input = slotAt(subgraphNode.inputs, inputIndex);
    xpipeLog("subgraphInput.map", {
        childGraph: graphKey(graph),
        parentNode: debugNode(subgraphNode),
        source: debugNode(source),
        sourceOutputIndex: outputIndex,
        parentInputIndex: inputIndex,
        parentInput: debugSlot(input),
    });
    if (!input || input.link == null) {
        xpipeWarn("subgraphInput.noParentInputLink", {
            parentNode: debugNode(subgraphNode),
            parentInputIndex: inputIndex,
            parentInput: debugSlot(input),
        });
        return null;
    }
    return getFullBundleMetaFromLink(
        getLinkInfo(input.link, subgraphNode.graph),
        seen,
        subgraphNode.graph
    );
}
function getFullBundleMetaThroughSubgraphOutput(source, outputIndex, seen) {
    var subgraph = source && source.subgraph;
    if (!subgraph) return null;
    var outputIndexInSubgraph = subgraphOutputIndexFromNodeOutput(
        subgraph,
        source,
        outputIndex
    );
    var outputInfo = subgraphOutputNodeInputIndex(subgraph, outputIndexInSubgraph);
    var outputNode = outputInfo.node;
    if (!subgraph || !outputNode || outputIndexInSubgraph < 0) {
        xpipeWarn("subgraphOutput.noOutputNode", {
            source: debugNode(source),
            outputIndex: outputIndex,
            mappedOutputIndex: outputIndexInSubgraph,
        });
        return null;
    }
    var outputSlot = slotAt(subgraph && subgraph.outputs, outputIndexInSubgraph);
    xpipeLog("subgraphOutput.map", {
        parentGraphNode: debugNode(source),
        subgraph: graphKey(subgraph),
        parentOutputIndex: outputIndex,
        subgraphOutputIndex: outputIndexInSubgraph,
        outputNode: debugNode(outputNode),
        outputNodeInputIndex: outputInfo.index,
        outputSlot: debugSlot(outputSlot),
    });
    var ids = slotLinkIds(outputSlot);
    for (var i = 0; i < ids.length; i++) {
        var found = getLinkInfoInGraphTree(ids[i], subgraph);
        if (!found) continue;
        var meta = getFullBundleMetaFromLink(found.link, seen, found.graph);
        if (meta) return meta;
    }
    var innerLink = findLinkToNodeInput(subgraph, outputNode, outputInfo.index);
    if (!innerLink) {
        xpipeWarn("subgraphOutput.noInnerLink", {
            outputNode: debugNode(outputNode),
            outputNodeInputIndex: outputInfo.index,
        });
        return null;
    }
    return getFullBundleMetaFromLink(innerLink, seen, subgraph);
}
function outputTypeFromLink(linkInfo, graph) {
    if (!linkInfo) return "";
    graph = graph || activeGraph();
    if (getFullBundleMetaFromLink(linkInfo, {}, graph)) return "xpipe";
    var resolvedSlots = getResolvedSourceSlots(linkInfo, graph);
    for (var i = 0; i < resolvedSlots.length; i++) {
        var resolvedType = cleanType(resolvedSlots[i] && resolvedSlots[i].type);
        if (resolvedType) return resolvedType;
    }
    var source = getNodeByIdInGraph(graph, linkInfo.origin_id);
    var output = source && source.outputs ? source.outputs[linkInfo.origin_slot] : null;
    var outputType = cleanType(output && output.type);
    if (source && isXPipe(source) && output) {
        var pipeSlot = valueSlotNumber(output.name);
        if (pipeSlot && source.__xpipeState) {
            outputType = cleanType(source.__xpipeState.types[pipeSlot - 1]) || outputType;
        }
    }
    return cleanType(linkInfo.type) || outputType;
}
function directInputTypeResult(node, slot, ignoredSlot) {
    if (slot === ignoredSlot) return resultEmpty();
    var index = slotIndexOfName(node.inputs, "value_" + slot);
    if (index < 0 || !node.inputs[index] || node.inputs[index].link == null) {
        return resultEmpty();
    }
    var linkInfo = getLinkInfo(node.inputs[index].link, node.graph);
    var meta = getFullBundleMetaFromLink(linkInfo, {}, node.graph);
    if (meta) {
        var metaType = cleanType(meta.types && meta.types[slot - 1]);
        xpipeLog("directInputType.meta", {
            node: debugNode(node),
            slot: slot,
            link: node.inputs[index].link,
            type: metaType,
            metaNode: debugNode(meta.node),
        });
        return resultResolved(metaType);
    }
    var type = outputTypeFromLink(linkInfo, node.graph);
    xpipeLog("directInputType.link", {
        node: debugNode(node),
        slot: slot,
        link: node.inputs[index].link,
        state: type ? "resolved" : "unresolved",
        type: type,
    });
    return type ? resultResolved(type) : resultUnresolved();
}
function updateValueOutputLinks(node, slot, type) {
    var index = slotIndexOfName(node.outputs, "value_" + slot);
    if (index < 0 || !node.outputs[index]) return;
    var links = node.outputs[index].links || [];
    for (var i = 0; i < links.length; i++) {
        var link = getLinkInfo(links[i], node.graph);
        if (link) link.type = type;
    }
}
function applySlotTypes(state) {
    var node = state.node;
    var debug = xpipeDebugEnabled();
    var applied = debug ? [] : null;
    for (var k = 1; k <= PIPE_SLOTS; k++) {
        var outputType = socketType(state.types[k - 1]);
        var inputIndex = slotIndexOfName(node.inputs, "value_" + k);
        var outputIndex = slotIndexOfName(node.outputs, "value_" + k);
        if (inputIndex >= 0 && node.inputs[inputIndex]) node.inputs[inputIndex].type = "*";
        if (outputIndex >= 0 && node.outputs[outputIndex]) node.outputs[outputIndex].type = outputType;
        updateValueOutputLinks(node, k, outputType);
        if (debug && outputType !== "*") {
            applied.push({ slot: k, outputIndex: outputIndex, type: outputType });
        }
    }
    if (debug) {
        xpipeLog("applySlotTypes", {
            node: debugNode(node),
            applied: applied,
            allTypes: compactSlots(state.types),
        });
    }
    node.setDirtyCanvas && node.setDirtyCanvas(true, true);
}
function refreshSlotTypes(state, ignoredDirectSlot) {
    var node = state.node;
    var upstreamResult = getUpstreamBundleMetaResult(node, {});
    var upstreamTypes = upstreamResult.state === "resolved"
        ? upstreamResult.value.types
        : [];
    var dirty = false;
    var debug = xpipeDebugEnabled();
    var events = debug ? [] : null;
    for (var k = 1; k <= PIPE_SLOTS; k++) {
        var directResult = directInputTypeResult(node, k, ignoredDirectSlot);
        if (directResult.state === "unresolved") {
            if (debug) events.push({ slot: k, action: "keep", reason: "direct unresolved", previous: state.types[k - 1] });
            continue;
        }
        if (directResult.state === "empty" && upstreamResult.state === "unresolved") {
            if (debug) events.push({ slot: k, action: "keep", reason: "upstream unresolved", previous: state.types[k - 1] });
            continue;
        }
        var nextType = directResult.state === "resolved"
            ? cleanType(directResult.value)
            : cleanType(upstreamTypes[k - 1]);
        if (state.types[k - 1] !== nextType) {
            if (debug) events.push({
                slot: k,
                action: "change",
                from: state.types[k - 1],
                to: nextType,
                directState: directResult.state,
                upstreamState: upstreamResult.state,
            });
            state.types[k - 1] = nextType;
            dirty = true;
        }
    }
    if (debug && events.length) {
        xpipeLog("refreshSlotTypes", {
            node: debugNode(node),
            ignoredDirectSlot: ignoredDirectSlot,
            upstreamState: upstreamResult.state,
            dirty: dirty,
            events: events,
            finalTypes: compactSlots(state.types),
        });
    }
    if (dirty) {
        persistState(state);
        applySlotTypes(state);
    }
    return dirty;
}

// ---------------------------------------------------------------------------
// 链操作
// ---------------------------------------------------------------------------
function isXPipe(n) { return !!(n && String(n.comfyClass || n.type || "") === NODE_CLASS); }
function getBundleOutputLinks(node, outputIndex) {
    var output = node && node.outputs ? node.outputs[outputIndex] : null;
    if (output && output.links) return output.links;
    var graph = node && node.graph;
    var links = graph && (graph.links || graph._links);
    var out = [];
    if (!links) return out;
    if (links instanceof Map) {
        links.forEach(function (link, id) {
            if (link && link.origin_id === node.id && link.origin_slot === outputIndex) {
                out.push(link.id != null ? link.id : id);
            }
        });
        return out;
    }
    for (var id in links) {
        if (!links.hasOwnProperty(id)) continue;
        var link = links[id];
        if (link && link.origin_id === node.id && link.origin_slot === outputIndex) out.push(id);
    }
    return out;
}
function forEachSubgraphInputTarget(subgraph, inputIndex, callback, meta, seen) {
    var inputSlot = slotAt(subgraph && subgraph.inputs, inputIndex);
    var ids = slotLinkIds(inputSlot);
    for (var i = 0; i < ids.length; i++) {
        var found = getLinkInfoInGraphTree(ids[i], subgraph);
        if (found) visitBundleLinkTarget(found.graph, found.link, callback, meta, seen);
    }
    if (ids.length) return;
    var inputInfo = subgraphInputNodeOutputIndex(subgraph, inputIndex);
    var inputNode = inputInfo.node;
    if (!inputNode || inputInfo.index < 0) return;
    var links = getBundleOutputLinks(inputNode, inputInfo.index);
    for (var j = 0; j < links.length; j++) {
        var link = getLinkInfo(links[j], subgraph); if (!link) continue;
        visitBundleLinkTarget(subgraph, link, callback, meta, seen);
    }
}
function forEachSubgraphOutputTarget(subgraph, outputIndex, callback, meta, seen) {
    var subgraphNode = findSubgraphNodeForGraph(subgraph);
    if (!subgraphNode || !subgraphNode.graph) return;
    var outputIndexInParent = findMatchingSlotIndex(
        subgraphNode.outputs,
        slotAt(subgraph && subgraph.outputs, outputIndex),
        outputIndex
    );
    var links = getBundleOutputLinks(subgraphNode, outputIndexInParent);
    for (var i = 0; i < links.length; i++) {
        var link = getLinkInfo(links[i], subgraphNode.graph); if (!link) continue;
        visitBundleLinkTarget(subgraphNode.graph, link, callback, meta, seen);
    }
}
function visitBundleLinkTarget(graph, link, callback, meta, seen) {
    if (!graph || !link) return;
    seen = seen || {};
    var key = graphKey(graph) + ":link:" + String(link.id != null ? link.id : (
        String(link.origin_id) + ":" + String(link.origin_slot)
            + ">" + String(link.target_id) + ":" + String(link.target_slot)
    ));
    if (seen[key]) return;
    seen[key] = true;
    var child = getNodeByIdInGraph(graph, link.target_id);
    if (!child) return;
    if (child.subgraph) {
        forEachSubgraphInputTarget(child.subgraph, link.target_slot, callback, meta, seen);
        return;
    }
    if (isSubgraphOutputNode(child, graph)) {
        forEachSubgraphOutputTarget(graph, link.target_slot, callback, meta, seen);
        return;
    }
    if (!isXPipe(child)) return;
    var targetInput = child.inputs && child.inputs[link.target_slot];
    if (targetInput) callback(child, targetInput, link, meta);
}
function forEachBundleTarget(node, callback) {
    if (!node || !node.outputs) return;
    for (var outputIndex = 0; outputIndex < node.outputs.length; outputIndex++) {
        var meta = getFullBundleMetaFromOutput(node, outputIndex, {});
        var links = getBundleOutputLinks(node, outputIndex);
        for (var i = 0; i < links.length; i++) {
            var link = getLinkInfo(links[i], node.graph); if (!link) continue;
            visitBundleLinkTarget(node.graph, link, callback, meta, {});
        }
    }
}
function getChainStates(node) {
    var states = [], seen = {}, stack = [node];
    while (stack.length) {
        var n = stack.pop(), nk = nodeKey(n); if (!n || seen[nk]) continue; seen[nk] = true;
        if (n.__xpipeState) states.push(n.__xpipeState);
        if (n.outputs && n.outputs[0]) {
            var olinks = n.outputs[0].links || [];
            for (var i = 0; i < olinks.length; i++) {
                var ol = getLinkInfo(olinks[i], n.graph); if (!ol) continue;
                var tgt = getNodeByIdInGraph(n.graph, ol.target_id); if (!tgt || !isXPipe(tgt)) continue;
                var ts = tgt.inputs && tgt.inputs[ol.target_slot];
                if (ts && ts.name === "inp") stack.push(tgt);
            }
        }
        var pin = slotIndexOfName(n.inputs, "inp");
        if (pin >= 0 && n.inputs[pin].link != null) {
            var il = getLinkInfo(n.inputs[pin].link, n.graph);
            if (il) { var src = getNodeByIdInGraph(n.graph, il.origin_id); if (isXPipe(src)) stack.push(src); }
        }
    }
    return states;
}
// 向下游逐级传播名字
function pushNamesDown(startNode) {
    if (!startNode || !startNode.outputs || !startNode.outputs[0]) return;
    // 先填充所有后代（管道连接时一次性同步全量），然后改用按需通知
    _pushAllDown(startNode);
}
function _pushAllDown(startNode) {
    var seen = {}; seen[nodeKey(startNode)] = true;
    var stack = [startNode];
    while (stack.length) {
        var parent = stack.shift();
        forEachBundleTarget(parent, function (child, targetInput, _link, meta) {
            var childKey = nodeKey(child);
            if (seen[childKey]) return;
            var pipeInput = targetInput.name === "inp";
            var valueSlot = valueSlotNumber(targetInput.name);
            if (!pipeInput && !valueSlot) return;
            seen[childKey] = true;
            if (child.__xpipeState) {
                var cn = child.__xpipeState.names, cm = child.__xpipeState.manual;
                var dirty = false;
                if (pipeInput && meta) {
                    for (var k = 0; k < PIPE_SLOTS; k++) {
                        var nextName = cleanName(meta.names[k]);
                        if (!cm[k] && cn[k] !== nextName) { cn[k] = nextName; dirty = true; }
                    }
                } else {
                    dirty = refreshAutoNames(child.__xpipeState) || dirty;
                }
                if (refreshSlotTypes(child.__xpipeState)) dirty = true;
                if (dirty) { persistState(child.__xpipeState); syncSlots(child.__xpipeState); }
            }
            stack.push(child);
        });
    }
}
function notifyTypesDownstream(node, seen) {
    if (!node || !node.outputs) return;
    seen = seen || {};
    var key = nodeKey(node);
    if (seen[key]) return;
    seen[key] = true;
    forEachBundleTarget(node, function (child, targetInput) {
        if (!child.__xpipeState) return;
        if (targetInput.name !== "inp" && !valueSlotNumber(targetInput.name)) return;
        if (refreshSlotTypes(child.__xpipeState)) {
            syncSlots(child.__xpipeState);
        }
        notifyTypesDownstream(child, seen);
    });
}
// 单槽通知下游：只传一个槽位的变化
function notifyDownstream(node, slot) {
    try { pushNamesDown(node); } catch (_e) {}
    if (!node || !node.outputs || !node.outputs[0]) return;
    var nameVal = cleanName(node.__xpipeState ? node.__xpipeState.names[slot - 1] : "");
    var links = node.outputs[0].links || [];
    for (var i = 0; i < links.length; i++) {
        var link = getLinkInfo(links[i], node.graph); if (!link) continue;
        var child = getNodeByIdInGraph(node.graph, link.target_id);
        if (!child || !isXPipe(child) || !child.__xpipeState) continue;
        var pin = child.inputs && child.inputs[link.target_slot];
        if (!pin || pin.name !== "inp") continue;
        var cn = child.__xpipeState.names, cm = child.__xpipeState.manual;
        if (!cm[slot - 1] && cn[slot - 1] !== nameVal) {
            cn[slot - 1] = nameVal;
            persistState(child.__xpipeState); syncSlots(child.__xpipeState);
            // 链式反应：子节点继续通知它的子节点
            notifyDownstream(child, slot);
        }
    }
}
// shareChain → 改为只推送下游，不再双向合并
function mergeAndShareChain(node) {
    try { pushNamesDown(node); } catch (_e) {}
}
function shareChain(node, skipSourceRender, ignoredDirectSlot) {
    var st = node.__xpipeState; if (!st) return;
    refreshSlotTypes(st, ignoredDirectSlot);
    persistState(st);
    if (!skipSourceRender) { syncSlots(st); fitNode(st); }
    else { hidePortLabels(st.node); st.node.setDirtyCanvas && st.node.setDirtyCanvas(true, true); }
    if (!skipSourceRender) { try { pushNamesDown(node); } catch (_e) {} }
    try { notifyTypesDownstream(node); } catch (_e) {}
}

// ---------------------------------------------------------------------------
// 类型不兼容视觉提示
// ---------------------------------------------------------------------------
function getXPipeLinkWarning(link, graph) {
    if (!link) return null;
    graph = graph || activeGraph();
    if (!graph) return null;
    var src = getNodeByIdInGraph(graph, link.origin_id);
    if (!isXPipe(src) || !src.outputs) return null;
    var output = src.outputs[link.origin_slot];
    var pipeSlot = valueSlotNumber(output && output.name);
    if (!pipeSlot) return null;
    var tgt = getNodeByIdInGraph(graph, link.target_id);
    var input = tgt && tgt.inputs ? tgt.inputs[link.target_slot] : null;
    if (!input) return null;

    var outType = cleanType(src.__xpipeState && src.__xpipeState.types[pipeSlot - 1])
        || cleanType(output && output.type)
        || cleanType(link.type);
    var inType = cleanType(input.type);
    if (!outType || !inType || outType === inType) return null;

    return {
        source: src,
        sourceSlot: link.origin_slot,
        pipeSlot: pipeSlot,
        target: tgt,
        outputType: outType,
        inputType: inType,
    };
}
function outputHasWarning(node, outputIndex) {
    var output = node && node.outputs ? node.outputs[outputIndex] : null;
    if (!output || !output.links) return false;
    for (var i = 0; i < output.links.length; i++) {
        if (getXPipeLinkWarning(getLinkInfo(output.links[i], node.graph), node.graph)) return true;
    }
    return false;
}
function drawWarningOutputRings(node, ctx) {
    if (!ctx || !isXPipe(node) || !node.outputs) return;
    var scale = app.canvas && app.canvas.ds ? app.canvas.ds.scale || 1 : 1;
    var lineWidth = Math.max(1.5, 2.5 / scale);
    var radius = Math.max(6, 7 / scale);
    for (var i = 0; i < node.outputs.length; i++) {
        var output = node.outputs[i];
        if (!valueSlotNumber(output && output.name) || !outputHasWarning(node, i)) continue;
        var pos = typeof node.getConnectionPos === "function"
            ? node.getConnectionPos(false, i)
            : null;
        if (pos && node.pos) pos = [pos[0] - node.pos[0], pos[1] - node.pos[1]];
        else pos = output.pos || [node.size ? node.size[0] : MIN_NODE_W, 35 + i * 20];
        ctx.save();
        ctx.strokeStyle = WARNING_COLOR;
        ctx.lineWidth = lineWidth;
        ctx.shadowColor = WARNING_GLOW;
        ctx.shadowBlur = 5 / scale;
        ctx.beginPath();
        ctx.arc(pos[0], pos[1], radius, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
    }
}
// ---------------------------------------------------------------------------
// 自动命名
// ---------------------------------------------------------------------------
function upstreamOutputLabel(linkInfo, graph) {
    if (!linkInfo) return "";
    graph = graph || activeGraph();
    var o = getNodeByIdInGraph(graph, linkInfo.origin_id);
    if (!o || !o.outputs) return "";
    var slot = o.outputs[linkInfo.origin_slot];
    if (!slot) return "";
    var slotName = cleanName(slot.name);
    if (isXPipe(o)) {
        var pipeSlot = valueSlotNumber(slotName);
        if (pipeSlot && o.__xpipeState) {
            var pipeName = cleanName(o.__xpipeState.names[pipeSlot - 1]);
            if (pipeName) return pipeName;
        }
    }
    return cleanName(slot.label) || slotName;
}
function valueInputLabelFromLink(linkInfo, graph, slot) {
    var meta = getFullBundleMetaFromLink(linkInfo, {}, graph);
    var metaName = meta ? cleanName(meta.names && meta.names[slot - 1]) : "";
    return metaName || upstreamOutputLabel(linkInfo, graph);
}
function directInputLabelResult(node, slot, ignoredSlot) {
    if (slot === ignoredSlot) return resultEmpty();
    var index = slotIndexOfName(node.inputs, "value_" + slot);
    if (index < 0 || !node.inputs[index] || node.inputs[index].link == null) {
        return resultEmpty();
    }
    var linkInfo = getLinkInfo(node.inputs[index].link, node.graph);
    var meta = getFullBundleMetaFromLink(linkInfo, {}, node.graph);
    if (meta) {
        var metaName = cleanName(meta.names && meta.names[slot - 1]);
        xpipeLog("directInputLabel.meta", {
            node: debugNode(node),
            slot: slot,
            link: node.inputs[index].link,
            name: metaName,
            metaNode: debugNode(meta.node),
        });
        return resultResolved(metaName);
    }
    var label = upstreamOutputLabel(linkInfo, node.graph);
    xpipeLog("directInputLabel.link", {
        node: debugNode(node),
        slot: slot,
        link: node.inputs[index].link,
        state: label ? "resolved" : "unresolved",
        label: label,
    });
    return label ? resultResolved(label) : resultUnresolved();
}
function refreshAutoNames(state, ignoredDirectSlot) {
    var node = state.node;
    var upstreamResult = getUpstreamBundleMetaResult(node, {});
    var upstreamNames = upstreamResult.state === "resolved"
        ? upstreamResult.value.names
        : [];
    var dirty = false;
    var debug = xpipeDebugEnabled();
    var events = debug ? [] : null;
    for (var k = 1; k <= PIPE_SLOTS; k++) {
        if (state.manual[k - 1]) {
            if (debug) events.push({ slot: k, action: "keep", reason: "manual", previous: state.names[k - 1] });
            continue;
        }
        var directResult = directInputLabelResult(node, k, ignoredDirectSlot);
        if (directResult.state === "unresolved") {
            if (debug) events.push({ slot: k, action: "keep", reason: "direct unresolved", previous: state.names[k - 1] });
            continue;
        }
        if (directResult.state === "empty" && upstreamResult.state === "unresolved") {
            if (debug) events.push({ slot: k, action: "keep", reason: "upstream unresolved", previous: state.names[k - 1] });
            continue;
        }
        var nextName = directResult.state === "resolved"
            ? cleanName(directResult.value)
            : cleanName(upstreamNames[k - 1]);
        if (state.names[k - 1] !== nextName) {
            if (debug) events.push({
                slot: k,
                action: "change",
                from: state.names[k - 1],
                to: nextName,
                directState: directResult.state,
                upstreamState: upstreamResult.state,
            });
            state.names[k - 1] = nextName;
            dirty = true;
        }
    }
    if (debug && events.length) {
        xpipeLog("refreshAutoNames", {
            node: debugNode(node),
            ignoredDirectSlot: ignoredDirectSlot,
            upstreamState: upstreamResult.state,
            dirty: dirty,
            events: events,
            finalNames: compactSlots(state.names),
        });
    }
    if (dirty) persistState(state);
    return dirty;
}
function valueInputLinkId(node, slot) {
    var index = slotIndexOfName(node.inputs, "value_" + slot);
    var input = index >= 0 && node.inputs ? node.inputs[index] : null;
    return input ? input.link : null;
}
function refreshAfterValueDisconnect(state, slot, disconnectedLinkId) {
    if (!state || !state.node || state.node.__xpipeState !== state) return;
    var currentLinkId = valueInputLinkId(state.node, slot);
    var ignoreSlot = currentLinkId == null || currentLinkId === disconnectedLinkId
        ? slot
        : 0;
    refreshAutoNames(state, ignoreSlot);
    persistState(state);
    shareChain(state.node, false, ignoreSlot);
}
function scheduleValueDisconnectRefresh(state, slot, disconnectedLinkId) {
    var run = function () {
        try { refreshAfterValueDisconnect(state, slot, disconnectedLinkId); } catch (_e) {}
    };
    setTimeout(run, 0);
    if (window.requestAnimationFrame) {
        window.requestAnimationFrame(function () { setTimeout(run, 0); });
    } else {
        setTimeout(run, 50);
    }
    setTimeout(run, 120);
}
function handleConnectionChange(state, type, index, connected, linkInfo, slotInfo) {
    var node = state.node, isInput = type === (window.LiteGraph ? LiteGraph.INPUT : 1);
    var list = isInput ? node.inputs : node.outputs, slot = slotInfo || (list ? list[index] : null);
    var slotName = slot ? slot.name : "";
    xpipeLog("connectionChange", {
        node: debugNode(node),
        type: isInput ? "input" : "output",
        index: index,
        connected: connected,
        slotName: slotName,
        slot: debugSlot(slot),
        link: linkInfo ? {
            id: linkInfo.id,
            origin: linkInfo.origin_id + ":" + linkInfo.origin_slot,
            target: linkInfo.target_id + ":" + linkInfo.target_slot,
            type: linkInfo.type,
        } : null,
    });
    if (slotName === "inp") {
        if (connected) {
            scheduleGraphTreeRefresh();
            return;
        }
        refreshAutoNames(state);
        shareChain(node, false);
        return;
    }
    if (slotName === "out") {
        if (connected) {
            scheduleGraphTreeRefresh();
            return;
        }
        refreshSlotTypes(state); syncSlots(state); mergeAndShareChain(node); return;
    }
    var k = valueSlotNumber(slotName);
    // 连接：首次连接自动命名
    if (isInput && k && connected && linkInfo && !state.manual[k - 1]) {
        var label = valueInputLabelFromLink(linkInfo, node.graph, k);
        if (label) {
            state.names[k - 1] = label;
            persistState(state); shareChain(node, false); return;
        }
        scheduleGraphTreeRefresh();
        return;
    }
    // 断开：保留 last-known-good，只有明确解析为空时才回退为空。
    if (isInput && k && !connected) {
        var disconnectedLinkId = linkInfo && linkInfo.id != null ? linkInfo.id : null;
        if (disconnectedLinkId == null) disconnectedLinkId = valueInputLinkId(node, k);
        refreshAutoNames(state, k);
        persistState(state); shareChain(node, false, k);
        scheduleValueDisconnectRefresh(state, k, disconnectedLinkId);
        return;
    }
    refreshSlotTypes(state);
    syncSlots(state);
    persistState(state);
    fitNode(state);
    notifyTypesDownstream(node);
}

// ---------------------------------------------------------------------------
// Canvas 浮层输入框
// ---------------------------------------------------------------------------
var pipeInputEls = {};    // legacy DOM overlays, cleaned up by syncAllOverlays()
var activeNameEditor = null;
var pipeLinksHidden = {}; // nodeKey -> state (0-3)
var overlayHooked = false;
var graphTreeRefreshTimer = null;

function hiddenState(node) {
    var key = nodeKey(node);
    var state = pipeLinksHidden[key];
    if (state == null && node && node.properties) {
        state = node.properties[HIDE_STATE_PROP];
        if (state != null) pipeLinksHidden[key] = state;
    }
    if (state === true) return HIDE_BOTH;
    state = Number(state) || HIDE_NONE;
    return Math.max(HIDE_NONE, Math.min(HIDE_BOTH, state));
}

function nextHideState(state) {
    return (state + 1) % 4;
}

function setHiddenState(node, state) {
    var key = nodeKey(node);
    var normalized = Math.max(HIDE_NONE, Math.min(HIDE_BOTH, Number(state) || HIDE_NONE));
    node.properties = node.properties || {};
    if (normalized === HIDE_NONE) {
        delete pipeLinksHidden[key];
        delete node.properties[HIDE_STATE_PROP];
    } else {
        pipeLinksHidden[key] = normalized;
        node.properties[HIDE_STATE_PROP] = normalized;
    }
    if (node.graph && typeof node.graph.change === "function") {
        node.graph.change();
    }
}

function scheduleGraphTreeRefresh() {
    if (graphTreeRefreshTimer != null) return;
    var run = function () {
        xpipeLog("scheduledGraphTreeRefresh.run", {
            root: graphKey(app.graph),
        });
        try { refreshAllXPipesInGraphTree(app.graph); } catch (_e) {}
        try { syncAllOverlays(); } catch (_e) {}
        try { app.canvas && app.canvas.setDirty(true, true); } catch (_e) {}
    };
    xpipeLog("scheduledGraphTreeRefresh.queue", {});
    graphTreeRefreshTimer = setTimeout(function () {
        graphTreeRefreshTimer = null;
        if (window.requestAnimationFrame) {
            window.requestAnimationFrame(function () { setTimeout(run, 0); });
        } else {
            setTimeout(run, 16);
        }
        setTimeout(run, 80);
        setTimeout(run, 150);
    }, 0);
}

function isHiddenBundleLink(link, graph) {
    if (!link || link.id == null) return false;
    graph = graph || activeGraph();
    var src = getNodeByIdInGraph(graph, link.origin_id);
    var tgt = getNodeByIdInGraph(graph, link.target_id);
    var hideFromOutput = isXPipe(src) && (hiddenState(src) & HIDE_OUTPUT);
    var hideToInput = isXPipe(tgt) && (hiddenState(tgt) & HIDE_INPUT);
    if (!hideFromOutput && !hideToInput) return false;
    return !!getFullBundleMetaFromLink(link, {}, graph);
}

function updateTitleButtons(node) {
    if (!node || !node.title_buttons) return;
    var state = hiddenState(node);
    for (var i = 0; i < node.title_buttons.length; i++) {
        var button = node.title_buttons[i];
        if (button.name === BUTTON_HIDE) {
            button.text = HIDE_BUTTON_TEXTS[state];
        }
    }
}

function ensureTitleButtons(node) {
    if (!node || node.__xpipeTitleButtonsReady) return;
    node.__xpipeTitleButtonsReady = true;

    if (typeof node.addTitleButton === "function") {
        node.addTitleButton({
            name: BUTTON_HIDE,
            text: HIDE_BUTTON_TEXTS[hiddenState(node)],
            fontSize: TITLE_BUTTON_FONT_SIZE,
            height: TITLE_BUTTON_HEIGHT,
            xOffset: HIDE_BUTTON_X_OFFSET,
            yOffset: TITLE_BUTTON_Y_OFFSET,
        });
    }

    var originalOnTitleButtonClick = node.onTitleButtonClick;
    node.onTitleButtonClick = function (button, canvas) {
        if (button && button.name === BUTTON_HIDE) {
            var next = nextHideState(hiddenState(this));
            setHiddenState(this, next);
            updateTitleButtons(this);
            canvas && canvas.setDirty && canvas.setDirty(true, true);
            return;
        }
        if (originalOnTitleButtonClick) {
            return originalOnTitleButtonClick.apply(this, arguments);
        }
    };
}

function installOverlayHook() {
    if (overlayHooked || !app.canvas) { if (!app.canvas) setTimeout(installOverlayHook, 200); return; }
    overlayHooked = true;
    var origOnMouse = app.canvas.onMouse;
    app.canvas.onMouse = function (event) {
        if (event && event.button === 0 && activeGraph()) {
            var graph = activeGraph();
            var node = graph && typeof graph.getNodeOnPos === "function"
                ? graph.getNodeOnPos(event.canvasX, event.canvasY, this.visible_nodes)
                : null;
            if (isXPipe(node) && node.__xpipeState) {
                var slot = hitNameInputSlot(
                    node,
                    [event.canvasX - node.pos[0], event.canvasY - node.pos[1]]
                );
                if (slot) {
                    event.preventDefault && event.preventDefault();
                    event.stopPropagation && event.stopPropagation();
                    openNameEditor(node, slot);
                    return true;
                }
            }
        }
        return origOnMouse && origOnMouse.apply(this, arguments);
    };
    var origDraw = app.canvas.draw;
    app.canvas.draw = function (force) {
        origDraw && origDraw.apply(this, arguments);
        try { syncAllOverlays(); } catch (_e) {}
    };
    // 拦截管道连线渲染
    var origRenderLink = app.canvas.renderLink;
    app.canvas.renderLink = function (ctx, a, b, link) {
        var graph = this.graph || activeGraph();
        var warning = getXPipeLinkWarning(link, graph);
        if (isHiddenBundleLink(link, graph)) return;
        if (!warning) {
            origRenderLink && origRenderLink.apply(this, arguments);
            return;
        }
        var args = Array.prototype.slice.call(arguments);
        args[6] = WARNING_COLOR;
        ctx.save();
        ctx.shadowColor = WARNING_GLOW;
        ctx.shadowBlur = 6 / (this.ds && this.ds.scale ? this.ds.scale : 1);
        if (ctx.setLineDash) ctx.setLineDash([8, 5]);
        origRenderLink && origRenderLink.apply(this, args);
        ctx.restore();
    };
    setTimeout(function () { try { syncAllOverlays(); } catch (_e) {} }, 500);
}

function isNodeCollapsed(node) {
    return !!(node && (
        node.collapsed
        || (node.flags && node.flags.collapsed)
    ));
}

function syncAllOverlays() {
    updateActiveNameEditorPosition();
    for (var nid in pipeInputEls) {
        if (!pipeInputEls.hasOwnProperty(nid)) continue;
        if (pipeInputEls[nid].wrap && pipeInputEls[nid].wrap.parentNode) {
            pipeInputEls[nid].wrap.parentNode.removeChild(pipeInputEls[nid].wrap);
        }
        delete pipeInputEls[nid];
    }
}

// ---- 名字输入框 ----
function getNameInputLayout(node, slot) {
    var i1 = slotIndexOfName(node.inputs, "value_1");
    if (i1 < 0) i1 = slotIndexOfName(node.outputs, "value_1");
    var baseY = (i1 >= 0 && (node.inputs[i1] || node.outputs[i1]) && (node.inputs[i1] || node.outputs[i1]).pos)
        ? (node.inputs[i1] || node.outputs[i1]).pos[1] : 35;
    var nw = node.size ? node.size[0] : 200;
    var dy = baseY + (slot - 1) * 20;
    var ml = 21, mr = 20;
    return {
        x: ml,
        y: dy - 8,
        w: Math.max(60, nw - ml - mr),
        h: 14,
    };
}
function hitNameInputSlot(node, pos) {
    if (!node || !pos) return 0;
    for (var k = 1; k <= PIPE_SLOTS; k++) {
        var r = getNameInputLayout(node, k);
        if (pos[0] >= r.x && pos[0] <= r.x + r.w
            && pos[1] >= r.y && pos[1] <= r.y + r.h) return k;
    }
    return 0;
}
function canvasCssColor(name, fallback) {
    try {
        var value = getComputedStyle(document.body).getPropertyValue(name).trim();
        return value || fallback;
    } catch (_e) {
        return fallback;
    }
}
function nameInputFontFamily() {
    try {
        var font = getComputedStyle(document.body).fontFamily;
        return font || NAME_INPUT_FONT_FAMILY;
    } catch (_e) {
        return NAME_INPUT_FONT_FAMILY;
    }
}
function nameInputCanvasFont() {
    return NAME_INPUT_FONT_SIZE + "px " + nameInputFontFamily();
}
function centeredTextY(ctx, rect) {
    return rect.y + rect.h / 2 + 5;
}
function drawNameInputs(node, ctx) {
    var st = node && node.__xpipeState;
    if (!st || !ctx || isNodeCollapsed(node)) return;
    var scale = app.canvas && app.canvas.ds ? app.canvas.ds.scale || 1 : 1;
    var lodV = scale >= 0.35;
    try {
        var v = app.ui && app.ui.settings && app.ui.settings.getSettingValue("Comfy.LodScale");
        if (typeof v === "number") lodV = scale >= v;
    } catch (_e) {}
    if (!lodV) return;

    var bg = canvasCssColor("--comfy-input-bg", "#222");
    var text = canvasCssColor("--input-text", "#ddd");
    var border = canvasCssColor("--border-color", "#555");
    var primary = canvasCssColor("--primary-color", "#ff385c");
    ctx.save();
    ctx.font = nameInputCanvasFont();
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.lineWidth = Math.max(1, 1 / scale);
    for (var k = 1; k <= PIPE_SLOTS; k++) {
        var r = getNameInputLayout(node, k);
        var name = st.names[k - 1] || "";
        ctx.fillStyle = bg;
        ctx.strokeStyle = st.manual[k - 1] ? primary : border;
        ctx.beginPath();
        ctx.rect(r.x, r.y, r.w, r.h);
        ctx.fill();
        ctx.stroke();
        if (name) {
            ctx.save();
            ctx.beginPath();
            ctx.rect(r.x + 2, r.y, r.w - 4, r.h);
            ctx.clip();
            ctx.fillStyle = text;
            ctx.fillText(name, r.x + r.w / 2, centeredTextY(ctx, r));
            ctx.restore();
        }
    }
    ctx.restore();
}
function commitNameEditor(cancelled) {
    var editor = activeNameEditor;
    if (!editor) return;
    var st = editor.state, slot = editor.slot, inputEl = editor.input;
    if (!cancelled && st && slot) {
        var v = inputEl.value.trim();
        if (v.length) {
            st.names[slot - 1] = v;
            st.manual[slot - 1] = true;
        } else {
            st.names[slot - 1] = "";
            st.manual[slot - 1] = false;
            refreshAutoNames(st);
        }
        hidePortLabels(st.node);
        persistState(st);
        try { notifyDownstream(st.node, slot); } catch (_e) {}
        markCanvasDirty();
    }
    if (inputEl && inputEl.parentNode) inputEl.parentNode.removeChild(inputEl);
    activeNameEditor = null;
}
function updateActiveNameEditorPosition() {
    var editor = activeNameEditor;
    if (!editor || !editor.input || !editor.node || !app.canvas) return;
    if (isNodeCollapsed(editor.node) || editor.node.graph !== activeGraph()) {
        commitNameEditor(false);
        return;
    }
    var parent = app.canvas.canvas.parentNode || document.body;
    var pr = parent.getBoundingClientRect();
    var ds = app.canvas.ds || { offset: [0, 0], scale: 1 };
    var s = ds.scale || 1;
    var r = getNameInputLayout(editor.node, editor.slot);
    editor.input.style.left = ((editor.node.pos[0] + r.x + ds.offset[0]) * s) + "px";
    editor.input.style.top = ((editor.node.pos[1] + r.y + ds.offset[1]) * s) + "px";
    editor.input.style.width = (r.w * s) + "px";
    editor.input.style.height = (r.h * s) + "px";
    editor.input.style.fontSize = (NAME_INPUT_FONT_SIZE * s) + "px";
    editor.input.style.lineHeight = (r.h * s) + "px";
    if (editor.input.parentNode === parent) return;
    editor.input.style.left = (parseFloat(editor.input.style.left) - pr.left) + "px";
    editor.input.style.top = (parseFloat(editor.input.style.top) - pr.top) + "px";
}
function openNameEditor(node, slot) {
    if (!node || !node.__xpipeState || !slot) return;
    commitNameEditor(false);
    bringXPipeNodeToFront(node);
    var parent = app.canvas && app.canvas.canvas
        ? app.canvas.canvas.parentNode || document.body
        : document.body;
    var inputEl = document.createElement("input");
    inputEl.type = "text";
    inputEl.value = node.__xpipeState.names[slot - 1] || "";
    inputEl.className = "xpipe-name-editor";
    inputEl.style.cssText = [
        "position:absolute;z-index:0;pointer-events:auto;text-align:center;",
        "box-sizing:border-box;font-family:" + nameInputFontFamily() + ";",
        "border:1px solid var(--primary-color,#ff385c);border-radius:2px;",
        "background:var(--comfy-input-bg,#222);color:var(--input-text,#ddd);",
        "outline:none;padding:0;",
    ].join("");
    inputEl.addEventListener("keydown", function (event) {
        if (event.key === "Enter") {
            event.preventDefault();
            commitNameEditor(false);
        } else if (event.key === "Escape") {
            event.preventDefault();
            commitNameEditor(true);
        }
    });
    inputEl.addEventListener("blur", function () {
        commitNameEditor(false);
    });
    attachCanvasPassThrough(inputEl);
    parent.appendChild(inputEl);
    activeNameEditor = { node: node, state: node.__xpipeState, slot: slot, input: inputEl };
    updateActiveNameEditorPosition();
    inputEl.focus();
    inputEl.select();
}

// ---------------------------------------------------------------------------
// 生命周期
// ---------------------------------------------------------------------------
function createState(node) {
    if (node.__xpipeState) {
        if (!node.__xpipeState.slotDefs) node.__xpipeState.slotDefs = captureSlotDefs(node);
        if (!node.__xpipeState.types) node.__xpipeState.types = loadStateTypes(node);
        if (!node.__xpipeState.metaWidget) node.__xpipeState.metaWidget = ensureMetaWidget(node);
        xpipeLog("createState.reuse", {
            node: debugNode(node),
            names: compactSlots(node.__xpipeState.names),
            types: compactSlots(node.__xpipeState.types),
            manual: compactSlots(node.__xpipeState.manual),
        });
        return node.__xpipeState;
    }
    var st = {
        node: node,
        namesWidget: findNamesWidget(node),
        metaWidget: ensureMetaWidget(node),
        slotDefs: captureSlotDefs(node),
        visibleCount: PIPE_SLOTS,
    };
    st.names = loadStateNames(node);
    st.manual = loadStateManual(node);
    st.types = loadStateTypes(node);
    node.__xpipeState = st;
    hideNamesWidget(st.namesWidget);
    removePortNamesSlot(node);
    hidePortLabels(node);
    xpipeLog("createState.new", {
        node: debugNode(node),
        names: compactSlots(st.names),
        types: compactSlots(st.types),
        manual: compactSlots(st.manual),
        hasNamesWidget: !!st.namesWidget,
        hasMetaWidget: !!st.metaWidget,
    });
    return st;
}
function loadStateNames(node) {
    var props = node.properties || {};
    var meta = loadMetaState(node);
    var saved = props[NAMES_PROP];
    var manual = mergeManualState(props[MANUAL_PROP], meta);
    if (Array.isArray(saved)) {
        return mergeManualMetaNames(
            padArray(saved.map(function (n) { return n == null ? "" : String(n); }), PIPE_SLOTS, ""),
            meta,
            manual
        );
    }
    if (Array.isArray(meta.names)) {
        return padArray(meta.names.map(function (n) { return n == null ? "" : String(n); }), PIPE_SLOTS, "");
    }
    var w = findNamesWidget(node);
    if (w) { try { var d = JSON.parse(w.value || "[]"); if (Array.isArray(d)) return padArray(d.map(function (n) { return n == null ? "" : String(n); }), PIPE_SLOTS, ""); } catch (_e) {} }
    return padArray([], PIPE_SLOTS, "");
}
function loadStateManual(node) {
    var m = (node.properties || {})[MANUAL_PROP];
    var meta = loadMetaState(node);
    return mergeManualState(m, meta);
}
function loadStateTypes(node) {
    var t = (node.properties || {})[TYPES_PROP];
    var meta = loadMetaState(node);
    return mergeMetaTypes(t, meta);
}
function saveStateNames(node, names) {
    var p = node.properties = node.properties || {};
    p[NAMES_PROP] = names.slice();
    var w = findNamesWidget(node);
    if (w) w.value = JSON.stringify(names);
}
function saveStateManual(node, manual) {
    var p = node.properties = node.properties || {};
    p[MANUAL_PROP] = manual.slice();
}
function saveStateTypes(node, types) {
    var p = node.properties = node.properties || {};
    p[TYPES_PROP] = padArray(Array.isArray(types) ? types.map(cleanType) : [], PIPE_SLOTS, "");
}
function reconcile(state) {
    persistState(state);
    state.node.min_size = [MIN_NODE_W, 35];
    if (typeof state.node.setSize === "function") {
        var cs = state.node.computeSize();
        state.node.setSize([Math.max(cs[0], MIN_NODE_W), cs[1]]);
    }
    state.node.setDirtyCanvas && state.node.setDirtyCanvas(true, true);
    xpipeLog("reconcile", {
        node: debugNode(state.node),
        names: compactSlots(state.names),
        types: compactSlots(state.types),
        manual: compactSlots(state.manual),
    });
    // syncSlots 推迟到连线加载完成后（loadedGraphNode 或首次连接事件）
}
function ensureXPipe(node) {
    if (!node) return;
    ensureTitleButtons(node);
    updateTitleButtons(node);
    reconcile(createState(node));
}
function refreshAllXPipes(graph) {
    if (graph === app.graph || !graph) {
        refreshAllXPipesInGraphTree(app.graph);
        return;
    }
    if (!graph || (!graph._nodes && !graph.nodes)) return;
    var nodes = graphNodes(graph);
    for (var i = 0; i < nodes.length; i++) {
        var node = nodes[i];
        if (!isXPipe(node)) continue;
        ensureXPipe(node);
        if (!node.__xpipeState) continue;
        refreshAutoNames(node.__xpipeState);
        refreshSlotTypes(node.__xpipeState);
        syncSlots(node.__xpipeState);
        fitNode(node.__xpipeState);
    }
    for (var j = 0; j < nodes.length; j++) {
        if (isXPipe(nodes[j])) notifyTypesDownstream(nodes[j]);
    }
}
function hydrateFromInfo(node, info) {
    var st = createState(node), props = (info && info.properties) || node.properties || {};
    var meta = loadMetaState(node);
    var saved = props[NAMES_PROP];
    st.manual = mergeManualState(props[MANUAL_PROP], meta);
    st.names = Array.isArray(saved)
        ? mergeManualMetaNames(
            padArray(saved.map(function (n) { return n == null ? "" : String(n); }), PIPE_SLOTS, ""),
            meta,
            st.manual
        )
        : (Array.isArray(meta.names)
            ? padArray(meta.names.map(function (n) { return n == null ? "" : String(n); }), PIPE_SLOTS, "")
            : (st.namesWidget ? parseNames(st.namesWidget.value) : padArray([], PIPE_SLOTS, "")));
    st.types = mergeMetaTypes(props[TYPES_PROP], meta);
    xpipeLog("hydrateFromInfo", {
        node: debugNode(node),
        infoProps: {
            names: compactSlots(props[NAMES_PROP]),
            manual: compactSlots(props[MANUAL_PROP]),
            types: compactSlots(props[TYPES_PROP]),
        },
        meta: {
            names: compactSlots(meta.names),
            manual: compactSlots(meta.manual),
            types: compactSlots(meta.types),
        },
        state: {
            names: compactSlots(st.names),
            manual: compactSlots(st.manual),
            types: compactSlots(st.types),
        },
    });
    reconcile(st);
}

app.registerExtension({
    name: "ComfyUI.Xz3r0.XPipe",

    async setup() {
        xpipeLog("setup.debugEnabled", {
            debug: xpipeDebugEnabled(),
            hint: "Filter console by [XPipe]. Set window.XPIPE_DEBUG=false to silence.",
        });
        installOverlayHook();
    },

    async afterConfigureGraph() {
        resetGraphTreeCaches();
        xpipeLog("afterConfigureGraph", { root: graphKey(app.graph) });
        try { refreshAllXPipesInGraphTree(app.graph); } catch (_e) { /* ignore */ }
    },

    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (!nodeType.prototype.__xpipeGraphTreeRefreshHooked) {
            nodeType.prototype.__xpipeGraphTreeRefreshHooked = true;
            var origAnyOnConnections = nodeType.prototype.onConnectionsChange;
            nodeType.prototype.onConnectionsChange = function () {
                var result = origAnyOnConnections
                    && origAnyOnConnections.apply(this, arguments);
                try { scheduleGraphTreeRefresh(); } catch (_e) {}
                return result;
            };
        }
        if (String(nodeData.name) !== NODE_CLASS) return;
        var origOnCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            origOnCreated && origOnCreated.apply(this, arguments);
            xpipeLog("onNodeCreated", { node: debugNode(this) });
            ensureXPipe(this);
            if (this.__xpipeState) {
                refreshSlotTypes(this.__xpipeState);
                syncSlots(this.__xpipeState);
                hidePortLabels(this); removePortNamesSlot(this);
                if (typeof this.setSize === "function") {
                    var cs = this.computeSize();
                    this.setSize([Math.max(cs[0], MIN_NODE_W), cs[1]]);
                }
            }
        };
        var origOnConfigure = nodeType.prototype.onConfigure;
        nodeType.prototype.onConfigure = function (info) {
            origOnConfigure && origOnConfigure.apply(this, arguments);
            xpipeLog("onConfigure", {
                node: debugNode(this),
                infoProperties: info && info.properties,
            });
            try { hydrateFromInfo(this, info); } catch (_e) { /* ignore */ }
        };
        var origOnConnections = nodeType.prototype.onConnectionsChange;
        nodeType.prototype.onConnectionsChange = function (type, index, connected, linkInfo, slotInfo) {
            origOnConnections && origOnConnections.apply(this, arguments);
            var st = this.__xpipeState; if (!st) return;
            try { handleConnectionChange(st, type, index, connected, linkInfo, slotInfo); } catch (_e) { /* ignore */ }
        };
        var origOnDrawForeground = nodeType.prototype.onDrawForeground;
        nodeType.prototype.onDrawForeground = function (ctx) {
            origOnDrawForeground && origOnDrawForeground.apply(this, arguments);
            try { drawNameInputs(this, ctx); } catch (_e) { /* ignore */ }
            try { drawWarningOutputRings(this, ctx); } catch (_e) { /* ignore */ }
        };
        var origOnMouseDown = nodeType.prototype.onMouseDown;
        nodeType.prototype.onMouseDown = function (event, pos, canvas) {
            if (event && event.button === 0) {
                var slot = hitNameInputSlot(this, pos);
                if (slot) {
                    openNameEditor(this, slot);
                    canvas && canvas.setDirty && canvas.setDirty(true, true);
                    return true;
                }
            }
            return origOnMouseDown && origOnMouseDown.apply(this, arguments);
        };
    },

    async loadedGraphNode(node) {
        if (String(node.comfyClass || node.type || "") !== NODE_CLASS) return;
        xpipeLog("loadedGraphNode", { node: debugNode(node) });
        ensureXPipe(node);
        // 连线已全部恢复，此时同步端口 + 隐藏标签
        if (node.__xpipeState) {
            refreshSlotTypes(node.__xpipeState);
            syncSlots(node.__xpipeState);
            hidePortLabels(node); removePortNamesSlot(node);
            if (typeof node.setSize === "function") {
                var cs = node.computeSize();
                node.setSize([Math.max(cs[0], MIN_NODE_W), cs[1]]);
            }
        }
    },

    nodeCreated(node) {
        if (String(node.comfyClass || node.type || "") !== NODE_CLASS) return;
        ensureTitleButtons(node);
        updateTitleButtons(node);
    },

    async nodeRemoved(node) {
        if (String(node.comfyClass || node.type || "") !== NODE_CLASS) return;
        var key = nodeKey(node);
        resetGraphTreeCaches();
        var entry = pipeInputEls[key];
        if (entry) { if (entry.wrap.parentNode) entry.wrap.parentNode.removeChild(entry.wrap); delete pipeInputEls[key]; }
        if (activeNameEditor && activeNameEditor.node === node) commitNameEditor(false);
        delete pipeLinksHidden[key];
    },
});
