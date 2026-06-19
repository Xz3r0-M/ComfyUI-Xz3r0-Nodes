import { app } from "../../scripts/app.js";

// XPipe 管道束节点前端扩展
// ============================
// Canvas 浮层输入框贴在端口旁，支持编辑、自动命名、向下传递、
// 固定 20 槽位、管道连线显隐切换。

var NODE_CLASS = "XPipe";
var PIPE_SLOTS = 20;
var NAMES_WIDGET = "port_names";
var NAMES_PROP = "xpipe_names";
var MANUAL_PROP = "xpipe_manual";
var TYPES_PROP = "xpipe_types";
var MIN_NODE_W = 210;
var WARNING_COLOR = "#ff6a3d";
var WARNING_GLOW = "rgba(255, 106, 61, 0.7)";
var LOCALE_PREFIX = "xdatahub.ui.node.xpipe";
var COMFY_LOCALE_KEY = "Comfy.Locale";
var LOCALE_SYNC_INTERVAL = 1000;
var uiLocalePrimary = null;
var uiLocaleFallback = null;
var i18nCache = {};
var localeSyncInstalled = false;

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
function parseNames(raw) {
    var data = [];
    try { data = JSON.parse(raw || "[]"); } catch (_e) { data = []; }
    if (!Array.isArray(data)) data = [];
    return padArray(data.map(function (n) { return n == null ? "" : String(n); }), PIPE_SLOTS, "");
}
function t(key, fallback) {
    if (uiLocalePrimary && uiLocalePrimary[key] !== undefined
        && String(uiLocalePrimary[key]).length > 0) {
        return uiLocalePrimary[key];
    }
    if (uiLocaleFallback && uiLocaleFallback[key] !== undefined
        && String(uiLocaleFallback[key]).length > 0) {
        return uiLocaleFallback[key];
    }
    return fallback || key;
}
function tk(suffix, fallback) {
    return t(LOCALE_PREFIX + "." + suffix, fallback);
}
function fetchI18n(locale) {
    if (i18nCache[locale]) return Promise.resolve(i18nCache[locale]);
    return fetch("/xz3r0/xdatahub/i18n/ui?locale=" + encodeURIComponent(locale))
        .then(function (response) { return response.ok ? response.json() : {}; })
        .then(function (data) {
            i18nCache[locale] = data && data.dict ? data.dict : {};
            return i18nCache[locale];
        })
        .catch(function () { return {}; });
}
function resolveComfyLocale() {
    try {
        var value = app.extensionManager
            && app.extensionManager.setting
            && app.extensionManager.setting.get
            && app.extensionManager.setting.get(COMFY_LOCALE_KEY);
        if (value) return value;
    } catch (_e) { /* fall through */ }
    try {
        var stored = localStorage.getItem(COMFY_LOCALE_KEY);
        if (stored) return stored;
    } catch (_e) { /* fall through */ }
    if (document.documentElement && document.documentElement.lang) {
        return document.documentElement.lang;
    }
    return navigator.language || "en";
}
function loadLocaleBundle(locale) {
    var normalized = (
        locale === "zh" || locale === "zh-CN" || locale === "zh-TW"
    ) ? "zh" : "en";
    return Promise.all([fetchI18n("en"), fetchI18n(normalized)])
        .then(function (results) {
            uiLocaleFallback = results[0];
            uiLocalePrimary = normalized === "en" ? results[0] : results[1];
            return normalized;
        });
}
function refreshAllToggleTooltips() {
    for (var nodeId in pipeInputEls) {
        if (!pipeInputEls.hasOwnProperty(nodeId)) continue;
        var entry = pipeInputEls[nodeId];
        if (!entry || !entry.toggleBtn) continue;
        updateToggleBtnTooltip(entry.toggleBtn, !!pipeLinksHidden[nodeId]);
    }
}
function applyUiLocale(localeOverride) {
    return loadLocaleBundle(localeOverride || resolveComfyLocale())
        .then(function () { refreshAllToggleTooltips(); });
}
function installLocaleSync() {
    if (localeSyncInstalled) return;
    localeSyncInstalled = true;
    var lastLocale = null;
    setInterval(function () {
        var nextLocale = resolveComfyLocale();
        if (nextLocale && nextLocale !== lastLocale) {
            lastLocale = nextLocale;
            applyUiLocale(nextLocale).catch(function () {});
        }
    }, LOCALE_SYNC_INTERVAL);
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
function hideNamesWidget(w) {
    if (!w) return;
    w.hidden = true;
    w.computeSize = function () { return [0, -4]; };
    w.serializeValue = function () { return w.value; };
}
function removePortNamesSlot(node) {
    if (!node || !Array.isArray(node.inputs)) return;
    var before = node.inputs.length;
    node.inputs = node.inputs.filter(function (input) {
        return String(input && input.name || "") !== NAMES_WIDGET;
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
    state.names = Array.isArray(props[NAMES_PROP])
        ? padArray(props[NAMES_PROP].map(function (n) { return n == null ? "" : String(n); }), PIPE_SLOTS, "")
        : (state.namesWidget ? parseNames(state.namesWidget.value) : padArray([], PIPE_SLOTS, ""));
    state.manual = padArray(Array.isArray(props[MANUAL_PROP]) ? props[MANUAL_PROP].map(Boolean) : [], PIPE_SLOTS, false);
    state.types = padArray(Array.isArray(props[TYPES_PROP]) ? props[TYPES_PROP].map(cleanType) : [], PIPE_SLOTS, "");
}
function persistState(state) {
    saveStateNames(state.node, state.names);
    saveStateManual(state.node, state.manual);
    saveStateTypes(state.node, state.types);
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
    return getFullBundleMetaFromLink(getLinkInfo(node.inputs[pin].link), seen);
}
function getLinkInfo(linkId) {
    if (!app.graph || !app.graph.links || linkId == null) return null;
    return app.graph.links[linkId] || null;
}
function bundleMetaFromState(node, outputIndex) {
    var st = node && node.__xpipeState;
    if (!st) return null;
    return {
        node: node,
        outputIndex: outputIndex,
        names: st.names || [],
        types: st.types || [],
    };
}
function getFullBundleMetaFromLink(linkInfo, seen) {
    if (!linkInfo || !app.graph || !app.graph.getNodeById) return null;
    var source = app.graph.getNodeById(linkInfo.origin_id);
    if (!source || !isXPipe(source)) return null;
    return getFullBundleMetaFromOutput(source, linkInfo.origin_slot, seen);
}
function getFullBundleMetaFromOutput(node, outputIndex, seen) {
    if (!node || !isXPipe(node) || !node.outputs) return null;
    seen = seen || {};
    var key = "full:" + node.id + ":" + outputIndex;
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
    var key = "slot:" + node.id + ":" + slot;
    if (seen[key]) return null;
    seen[key] = true;

    var inputIndex = slotIndexOfName(node.inputs, "value_" + slot);
    var input = inputIndex >= 0 && node.inputs ? node.inputs[inputIndex] : null;
    var directMeta = input && input.link != null
        ? getFullBundleMetaFromLink(getLinkInfo(input.link), seen)
        : null;
    if (directMeta) return directMeta;

    var pin = slotIndexOfName(node.inputs, "inp");
    var pipeInput = pin >= 0 && node.inputs ? node.inputs[pin] : null;
    if (!pipeInput || pipeInput.link == null) return null;
    return getSlotBundleMetaFromLink(getLinkInfo(pipeInput.link), slot, seen);
}
function getSlotBundleMetaFromLink(linkInfo, slot, seen) {
    if (!linkInfo || !app.graph || !app.graph.getNodeById) return null;
    var source = app.graph.getNodeById(linkInfo.origin_id);
    if (!source || !isXPipe(source)) return null;
    return getSlotBundleMetaFromOutput(source, linkInfo.origin_slot, slot, seen);
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
function outputTypeFromLink(linkInfo) {
    if (!linkInfo) return "";
    if (getFullBundleMetaFromLink(linkInfo, {})) return "xpipe";
    var source = app.graph && app.graph.getNodeById ? app.graph.getNodeById(linkInfo.origin_id) : null;
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
function directInputType(node, slot, ignoredSlot) {
    if (slot === ignoredSlot) return "";
    var index = slotIndexOfName(node.inputs, "value_" + slot);
    if (index < 0 || node.inputs[index].link == null) return "";
    return outputTypeFromLink(getLinkInfo(node.inputs[index].link));
}
function updateValueOutputLinks(node, slot, type) {
    var index = slotIndexOfName(node.outputs, "value_" + slot);
    if (index < 0 || !node.outputs[index]) return;
    var links = node.outputs[index].links || [];
    for (var i = 0; i < links.length; i++) {
        var link = getLinkInfo(links[i]);
        if (link) link.type = type;
    }
}
function applySlotTypes(state) {
    var node = state.node;
    for (var k = 1; k <= PIPE_SLOTS; k++) {
        var outputType = socketType(state.types[k - 1]);
        var inputIndex = slotIndexOfName(node.inputs, "value_" + k);
        var outputIndex = slotIndexOfName(node.outputs, "value_" + k);
        if (inputIndex >= 0 && node.inputs[inputIndex]) node.inputs[inputIndex].type = "*";
        if (outputIndex >= 0 && node.outputs[outputIndex]) node.outputs[outputIndex].type = outputType;
        updateValueOutputLinks(node, k, outputType);
    }
    node.setDirtyCanvas && node.setDirtyCanvas(true, true);
}
function refreshSlotTypes(state, ignoredDirectSlot) {
    var node = state.node;
    var upstreamMeta = getUpstreamBundleMeta(node, {});
    var upstreamTypes = upstreamMeta ? upstreamMeta.types : [];
    var dirty = false;
    for (var k = 1; k <= PIPE_SLOTS; k++) {
        var nextType = directInputType(node, k, ignoredDirectSlot)
            || cleanType(upstreamTypes[k - 1]);
        if (state.types[k - 1] !== nextType) {
            state.types[k - 1] = nextType;
            dirty = true;
        }
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
    return output && output.links ? output.links : [];
}
function forEachBundleTarget(node, callback) {
    if (!node || !node.outputs) return;
    for (var outputIndex = 0; outputIndex < node.outputs.length; outputIndex++) {
        var meta = getFullBundleMetaFromOutput(node, outputIndex, {});
        var links = getBundleOutputLinks(node, outputIndex);
        for (var i = 0; i < links.length; i++) {
            var link = getLinkInfo(links[i]); if (!link) continue;
            var child = app.graph && app.graph.getNodeById
                ? app.graph.getNodeById(link.target_id)
                : null;
            if (!child || !isXPipe(child)) continue;
            var targetInput = child.inputs && child.inputs[link.target_slot];
            if (!targetInput) continue;
            callback(child, targetInput, link, meta);
        }
    }
}
function getChainStates(node) {
    var states = [], seen = {}, stack = [node];
    while (stack.length) {
        var n = stack.pop(); if (!n || seen[n.id]) continue; seen[n.id] = true;
        if (n.__xpipeState) states.push(n.__xpipeState);
        if (n.outputs && n.outputs[0]) {
            var olinks = n.outputs[0].links || [];
            for (var i = 0; i < olinks.length; i++) {
                var ol = app.graph.links[olinks[i]]; if (!ol) continue;
                var tgt = app.graph.getNodeById(ol.target_id); if (!tgt || !isXPipe(tgt)) continue;
                var ts = tgt.inputs && tgt.inputs[ol.target_slot];
                if (ts && ts.name === "inp") stack.push(tgt);
            }
        }
        var pin = slotIndexOfName(n.inputs, "inp");
        if (pin >= 0 && n.inputs[pin].link != null) {
            var il = app.graph.links[n.inputs[pin].link];
            if (il) { var src = app.graph.getNodeById(il.origin_id); if (isXPipe(src)) stack.push(src); }
        }
    }
    return states;
}
// 向下游逐级传播名字（rgthree 模式：只通知直连子节点，子节点再通知孙子）
function pushNamesDown(startNode) {
    if (!startNode || !startNode.outputs || !startNode.outputs[0]) return;
    // 先填充所有后代（管道连接时一次性同步全量），然后改用按需通知
    _pushAllDown(startNode);
}
function _pushAllDown(startNode) {
    var seen = {}; seen[startNode.id] = true;
    var stack = [startNode];
    while (stack.length) {
        var parent = stack.shift();
        forEachBundleTarget(parent, function (child, targetInput, _link, meta) {
            if (seen[child.id]) return;
            var pipeInput = targetInput.name === "inp";
            var valueSlot = valueSlotNumber(targetInput.name);
            if (!pipeInput && !valueSlot) return;
            seen[child.id] = true;
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
    if (seen[node.id]) return;
    seen[node.id] = true;
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
        var link = app.graph.links[links[i]]; if (!link) continue;
        var child = app.graph.getNodeById(link.target_id);
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
    graph = graph || app.graph;
    if (!graph || !graph.getNodeById) return null;
    var src = graph.getNodeById(link.origin_id);
    if (!isXPipe(src) || !src.outputs) return null;
    var output = src.outputs[link.origin_slot];
    var pipeSlot = valueSlotNumber(output && output.name);
    if (!pipeSlot) return null;
    var tgt = graph.getNodeById(link.target_id);
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
        if (getXPipeLinkWarning(getLinkInfo(output.links[i]))) return true;
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
function upstreamOutputLabel(linkInfo) {
    if (!linkInfo) return "";
    var o = app.graph && app.graph.getNodeById ? app.graph.getNodeById(linkInfo.origin_id) : null;
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
function directInputLabel(node, slot, ignoredSlot) {
    if (slot === ignoredSlot) return "";
    var index = slotIndexOfName(node.inputs, "value_" + slot);
    if (index < 0 || node.inputs[index].link == null) return "";
    if (!app.graph || !app.graph.links) return "";
    return upstreamOutputLabel(app.graph.links[node.inputs[index].link]);
}
function refreshAutoNames(state, ignoredDirectSlot) {
    var node = state.node;
    var upstreamMeta = getUpstreamBundleMeta(node, {});
    var upstreamNames = upstreamMeta ? upstreamMeta.names : [];
    var dirty = false;
    for (var k = 1; k <= PIPE_SLOTS; k++) {
        if (state.manual[k - 1]) continue;
        var nextName = directInputLabel(node, k, ignoredDirectSlot)
            || cleanName(upstreamNames[k - 1]);
        if (state.names[k - 1] !== nextName) {
            state.names[k - 1] = nextName;
            dirty = true;
        }
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
    if (slotName === "inp") {
        refreshAutoNames(state);
        shareChain(node, false);
        return;
    }
    if (slotName === "out") {
        refreshSlotTypes(state); syncSlots(state); mergeAndShareChain(node); return;
    }
    var k = valueSlotNumber(slotName);
    // 连接：首次连接自动命名
    if (isInput && k && connected && linkInfo && !state.manual[k - 1]) {
        var label = upstreamOutputLabel(linkInfo);
        if (label) {
            state.names[k - 1] = label;
            persistState(state); shareChain(node, false); return;
        }
    }
    // 断开：任何端口都重置→从上游管道恢复→推送下游
    if (isInput && k && !connected) {
        var disconnectedLinkId = linkInfo && linkInfo.id != null ? linkInfo.id : null;
        if (disconnectedLinkId == null) disconnectedLinkId = valueInputLinkId(node, k);
        state.names[k - 1] = "";
        state.manual[k - 1] = false;
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
var pipeInputEls = {};    // nodeId -> { wrap, rows, toggleBtn }
var pipeLinksHidden = {}; // 管道连线显隐
var overlayHooked = false;

function isHiddenBundleLink(link) {
    if (!link || link.id == null) return false;
    if (!pipeLinksHidden[link.origin_id] && !pipeLinksHidden[link.target_id]) return false;
    return !!getFullBundleMetaFromLink(link, {});
}

function installOverlayHook() {
    if (overlayHooked || !app.canvas) { if (!app.canvas) setTimeout(installOverlayHook, 200); return; }
    overlayHooked = true;
    var origDraw = app.canvas.draw;
    app.canvas.draw = function (force) {
        origDraw && origDraw.apply(this, arguments);
        try { syncAllOverlays(); } catch (_e) {}
    };
    // 拦截管道连线渲染
    var origRenderLink = app.canvas.renderLink;
    app.canvas.renderLink = function (ctx, a, b, link) {
        var graph = this.graph || app.graph;
        var warning = getXPipeLinkWarning(link, graph);
        if (isHiddenBundleLink(link)) return;
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

function syncAllOverlays() {
    if (!app.graph || !app.canvas) return;
    var nodes = app.graph._nodes || [];
    var parent = app.canvas.canvas.parentNode || document.body;
    var pr = parent.getBoundingClientRect();
    var ds = app.canvas.ds || { offset: [0, 0], scale: 1 }, s = ds.scale || 1;
    // LOD
    var lodV = s >= 0.35;
    try { var v = app.ui && app.ui.settings && app.ui.settings.getSettingValue("Comfy.LodScale"); if (typeof v === "number") lodV = s >= v; } catch (_e) {}
    var aliveIds = {};

    for (var i = 0; i < nodes.length; i++) {
        var node = nodes[i], state = node.__xpipeState;
        if (!state) continue;
        aliveIds[node.id] = true;
        var entry = pipeInputEls[node.id];
        if (!lodV) { if (entry) entry.wrap.style.display = "none"; continue; }
        if (!entry) {
            var wrap = document.createElement("div");
            wrap.style.cssText = "position:absolute;pointer-events:none;z-index:5;";
            attachCanvasPassThrough(wrap);
            parent.appendChild(wrap);
            entry = { wrap: wrap, rows: {} };
            pipeInputEls[node.id] = entry;
        }
        entry.wrap.style.display = "";
        var npos = node.pos || [0, 0], nw = node.size ? node.size[0] : 200;
        var nx = pr.left + (npos[0] + ds.offset[0]) * s;
        var ny = pr.top  + (npos[1] + ds.offset[1]) * s;
        entry.wrap.style.left = (nx - pr.left) + "px";
        entry.wrap.style.top  = (ny - pr.top) + "px";

        // 切换按钮 (右上角)
        syncToggleBtn(node, entry, s, nw);

        // 名字输入框
        syncNameInputs(state, node, entry, s, nw);
    }
    // 清理
    for (var nid in pipeInputEls) {
        if (!pipeInputEls.hasOwnProperty(nid)) continue;
        if (!aliveIds[nid]) {
            if (pipeInputEls[nid].wrap.parentNode) pipeInputEls[nid].wrap.parentNode.removeChild(pipeInputEls[nid].wrap);
            delete pipeInputEls[nid];
        }
    }
}

// ---- 眼睛图标 SVG ----
var EYE_ON = '<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/></svg>';
var EYE_OFF = '<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49"/><path d="M14.084 14.158a3 3 0 0 1-4.242-4.242"/><path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143"/><path d="m2 2 20 20"/></svg>';

function toggleBtnIcon(hidden) { return hidden ? EYE_OFF : EYE_ON; }
function toggleBtnTooltip(hidden) {
    return hidden
        ? tk("show_bundle_links", "Show XPipe bundle links")
        : tk("hide_bundle_links", "Hide XPipe bundle links");
}
function updateToggleBtnTooltip(btn, hidden) {
    var label = toggleBtnTooltip(hidden);
    btn.title = label;
    btn.setAttribute("aria-label", label);
}

// ---- 切换按钮 ----
function syncToggleBtn(node, entry, s, nw) {
    if (!entry.toggleBtn) {
        var btn = document.createElement("button");
        btn.innerHTML = toggleBtnIcon(false);
        btn.type = "button";
        updateToggleBtnTooltip(btn, false);
        btn.style.cssText = [
            "position:absolute;pointer-events:auto;z-index:6;",
            "width:16px;height:16px;padding:0;border:none;",
            "background:transparent;cursor:pointer;",
            "color:var(--input-text,#888);line-height:0;",
            "border-radius:3px;transition:background .15s,color .15s;",
        ].join("");
        btn.addEventListener("mouseenter", function () {
            btn.style.background = "var(--comfy-input-bg,#333)";
            btn.style.color = "var(--primary-color,#ff385c)";
        });
        btn.addEventListener("mouseleave", function () {
            btn.style.background = "transparent";
            btn.style.color = "var(--input-text,#888)";
        });
        (function (nid) {
            btn.addEventListener("click", function (e) {
                e.stopPropagation();
                pipeLinksHidden[nid] = !pipeLinksHidden[nid];
                btn.innerHTML = toggleBtnIcon(pipeLinksHidden[nid]);
                updateToggleBtnTooltip(btn, pipeLinksHidden[nid]);
                btn.style.opacity = pipeLinksHidden[nid] ? "0.4" : "1";
                app.canvas && app.canvas.setDirty(true, true);
            });
            btn.addEventListener("pointerdown", function (e) { e.stopPropagation(); });
        })(node.id);
        attachCanvasPassThrough(btn);
        entry.wrap.appendChild(btn);
        entry.toggleBtn = btn;
    }
    var btn = entry.toggleBtn;
    var hidden = pipeLinksHidden[node.id];
    updateToggleBtnTooltip(btn, hidden);
    btn.style.opacity = hidden ? "0.4" : "1";
    btn.style.left = ((nw - 23) * s) + "px";
    btn.style.top = (-23 * s) + "px";
    btn.style.width = (16 * s) + "px";
    btn.style.height = (16 * s) + "px";
}

// ---- 名字输入框 ----
function syncNameInputs(state, node, entry, s, nw) {
    var names = state.names, manual = state.manual;
    var i1 = slotIndexOfName(node.inputs, "value_1");
    if (i1 < 0) i1 = slotIndexOfName(node.outputs, "value_1");
    var baseY = (i1 >= 0 && (node.inputs[i1] || node.outputs[i1]) && (node.inputs[i1] || node.outputs[i1]).pos)
        ? (node.inputs[i1] || node.outputs[i1]).pos[1] : 35;
    var spacing = 20, ih = 14 * s;

    for (var k = 1; k <= PIPE_SLOTS; k++) {
        var key = "v" + k, el = entry.rows[key];
        if (!el) {
            el = document.createElement("input");
            el.type = "text";
            el.style.cssText = [
                "position:absolute;pointer-events:auto;text-align:center;",
                "box-sizing:border-box;font-family:'Inter',sans-serif;",
                "border:1px solid var(--border-color,#555);border-radius:2px;",
                "background:var(--comfy-input-bg,#222);color:var(--input-text,#ddd);",
                "outline:none;",
            ].join("");
            (function (st, slot, inputEl) {
                inputEl.addEventListener("input", function () {
                    if (inputEl._busy) return;
                    var v = inputEl.value.trim();
                    st.names[slot - 1] = v; st.manual[slot - 1] = v.length > 0;
                    inputEl.style.borderColor = st.manual[slot - 1] ? "var(--primary-color, #ff385c)" : "var(--border-color,#555)";
                    hidePortLabels(st.node);
                    persistState(st);
                });
                // 失焦：空→回退；有内容→保存+推送下游
                inputEl.addEventListener("blur", function () {
                    var v = inputEl.value.trim();
                    if (v.length) {
                        st.names[slot - 1] = v;
                        st.manual[slot - 1] = true;
                    } else {
                        // 清空手动名后，恢复直接输入名或上游管道名。
                        st.names[slot - 1] = ""; st.manual[slot - 1] = false;
                        refreshAutoNames(st);
                    }
                    inputEl.value = st.names[slot - 1] || "";
                    inputEl.style.borderColor = st.manual[slot - 1] ? "var(--primary-color, #ff385c)" : "var(--border-color,#555)";
                    hidePortLabels(st.node);
                    persistState(st);
                    try { notifyDownstream(st.node, slot); } catch (_e) {}
                });
            })(state, k, el);
            attachCanvasPassThrough(el);
            entry.wrap.appendChild(el);
            entry.rows[key] = el;
        }
        var name = names[k - 1];
        if (el.value !== (name || "") && document.activeElement !== el) {
            el._busy = true; el.value = name || ""; setTimeout(function () { el._busy = false; }, 0);
        }
        el.readOnly = false;
        el.style.opacity = "1";
        el.style.borderColor = manual[k - 1] ? "var(--primary-color, #ff385c)" : "var(--border-color,#555)";
        if (name) el.title = name; else el.removeAttribute("title");
        var dy = baseY + (k - 1) * spacing;
        var ml = 21, mr = 20, boxW = Math.max(60, (nw - ml - mr) * s);
        el.style.left = (ml * s) + "px";
        el.style.top = ((dy - 8) * s) + "px";
        el.style.width = boxW + "px";
        el.style.fontSize = (12 * s) + "px";
        el.style.height = ih + "px";
        el.style.lineHeight = ih + "px";
    }
    // 清理异常超出 20 槽位的旧 input
    for (var rk in entry.rows) {
        if (!entry.rows.hasOwnProperty(rk)) continue;
        var sn = parseInt(rk.substring(1), 10);
        if (sn > PIPE_SLOTS) {
            if (entry.rows[rk].parentNode) entry.rows[rk].parentNode.removeChild(entry.rows[rk]);
            delete entry.rows[rk];
        }
    }
}

// ---------------------------------------------------------------------------
// 生命周期
// ---------------------------------------------------------------------------
function createState(node) {
    if (node.__xpipeState) {
        if (!node.__xpipeState.slotDefs) node.__xpipeState.slotDefs = captureSlotDefs(node);
        if (!node.__xpipeState.types) node.__xpipeState.types = loadStateTypes(node);
        return node.__xpipeState;
    }
    var st = {
        node: node,
        namesWidget: findNamesWidget(node),
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
    return st;
}
function loadStateNames(node) {
    var props = node.properties || {};
    var saved = props[NAMES_PROP];
    if (Array.isArray(saved)) return padArray(saved.map(function (n) { return n == null ? "" : String(n); }), PIPE_SLOTS, "");
    var w = findNamesWidget(node);
    if (w) { try { var d = JSON.parse(w.value || "[]"); if (Array.isArray(d)) return padArray(d.map(function (n) { return n == null ? "" : String(n); }), PIPE_SLOTS, ""); } catch (_e) {} }
    return padArray([], PIPE_SLOTS, "");
}
function loadStateManual(node) {
    var m = (node.properties || {})[MANUAL_PROP];
    return padArray(Array.isArray(m) ? m.map(Boolean) : [], PIPE_SLOTS, false);
}
function loadStateTypes(node) {
    var t = (node.properties || {})[TYPES_PROP];
    return padArray(Array.isArray(t) ? t.map(cleanType) : [], PIPE_SLOTS, "");
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
    // syncSlots 推迟到连线加载完成后（loadedGraphNode 或首次连接事件）
}
function ensureXPipe(node) {
    if (!node) return;
    reconcile(createState(node));
}
function refreshAllXPipes() {
    if (!app.graph || !app.graph._nodes) return;
    var nodes = app.graph._nodes || [];
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
    var saved = props[NAMES_PROP];
    st.names = Array.isArray(saved)
        ? padArray(saved.map(function (n) { return n == null ? "" : String(n); }), PIPE_SLOTS, "")
        : (st.namesWidget ? parseNames(st.namesWidget.value) : padArray([], PIPE_SLOTS, ""));
    st.manual = padArray(Array.isArray(props[MANUAL_PROP]) ? props[MANUAL_PROP].map(Boolean) : [], PIPE_SLOTS, false);
    st.types = padArray(Array.isArray(props[TYPES_PROP]) ? props[TYPES_PROP].map(cleanType) : [], PIPE_SLOTS, "");
    reconcile(st);
}

app.registerExtension({
    name: "ComfyUI.Xz3r0.XPipe",

    async setup() {
        installOverlayHook();
        installLocaleSync();
        applyUiLocale().catch(function () {});
    },

    async afterConfigureGraph() {
        try { refreshAllXPipes(); } catch (_e) { /* ignore */ }
    },

    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (String(nodeData.name) !== NODE_CLASS) return;
        var origOnCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            origOnCreated && origOnCreated.apply(this, arguments);
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
            try { drawWarningOutputRings(this, ctx); } catch (_e) { /* ignore */ }
        };
    },

    async loadedGraphNode(node) {
        if (String(node.comfyClass || node.type || "") !== NODE_CLASS) return;
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

    async nodeRemoved(node) {
        if (String(node.comfyClass || node.type || "") !== NODE_CLASS) return;
        var entry = pipeInputEls[node.id];
        if (entry) { if (entry.wrap.parentNode) entry.wrap.parentNode.removeChild(entry.wrap); delete pipeInputEls[node.id]; }
    },
});
