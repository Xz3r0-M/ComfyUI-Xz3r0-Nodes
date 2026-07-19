import { app } from "../../scripts/app.js";
import {
    resolveXPipeV2StateForInput,
    resolveXPipeV2ValueMetadataForInput,
    scheduleXPipeV2Refresh,
    subscribeXPipeV2Metadata,
} from "./xpipe_v2_extension.js";

var NODE_CLASS = "XPipeGate";
var GATE_SLOTS = 50;
var BUNDLE_INPUT = "xpipe_in";
var BUNDLE_OUTPUT = "xpipe_out";
var NAMES_WIDGET = "port_names";
var TYPES_PROP = "xpipe_gate_types";
var INITIAL_WIDTH_EXTRA = 20;
var refreshTimer = null;
var gateNodeCount = 0;

function cleanType(value) {
    if (Array.isArray(value)) value = value[0];
    var type = value == null ? "" : String(value).trim();
    return type && type !== "*" ? type : "";
}

function cleanName(value) {
    return value == null ? "" : String(value).trim();
}

function socketType(value) {
    return cleanType(value) || "*";
}

function padArray(values, size, fill) {
    var result = Array.isArray(values) ? values.slice(0, size) : [];
    while (result.length < size) result.push(fill);
    return result;
}

function channelInputNumber(name) {
    var match = /(?:^|\.)input_(\d+)$/.exec(name || "");
    return match ? parseInt(match[1], 10) : 0;
}

function channelEnableNumber(name) {
    var match = /(?:^|\.)enable_(\d+)$/.exec(name || "");
    return match ? parseInt(match[1], 10) : 0;
}

function channelOutputNumber(name) {
    var match = /^output_(\d+)$/.exec(name || "");
    return match ? parseInt(match[1], 10) : 0;
}

function slotIndexByName(slots, name) {
    if (!Array.isArray(slots)) return -1;
    for (var index = 0; index < slots.length; index++) {
        if (slots[index] && slots[index].name === name) return index;
    }
    return -1;
}

function slotLinkIds(slot) {
    if (!slot) return [];
    if (Array.isArray(slot.linkIds)) return slot.linkIds.slice();
    if (Array.isArray(slot.links)) return slot.links.slice();
    if (slot.linkId != null) return [slot.linkId];
    if (slot.link != null) return [slot.link];
    return [];
}

function graphNodes(graph) {
    return graph ? (graph._nodes || graph.nodes || []) : [];
}

function getNodeById(graph, nodeId) {
    if (!graph || nodeId == null) return null;
    if (typeof graph.getNodeById === "function") {
        var found = graph.getNodeById(nodeId);
        if (found) return found;
    }
    var nodes = graphNodes(graph);
    for (var index = 0; index < nodes.length; index++) {
        if (String(nodes[index] && nodes[index].id) === String(nodeId)) {
            return nodes[index];
        }
    }
    return null;
}

function getLinkInfo(graph, linkId) {
    if (!graph || linkId == null) return null;
    if (typeof graph.getLink === "function") {
        var graphLink = graph.getLink(linkId);
        if (graphLink) return graphLink;
    }
    if (graph.links && graph.links[linkId]) return graph.links[linkId];
    if (graph._links instanceof Map) return graph._links.get(linkId) || null;
    return graph._links && graph._links[linkId] || null;
}

function isXPipeGate(node) {
    return !!(
        node
        && String(node.comfyClass || node.type || "") === NODE_CLASS
    );
}

function forEachPipeGate(rootGraph, visitor) {
    if (!rootGraph || typeof visitor !== "function") return;
    var visited = new WeakSet();
    var walk = function (graph) {
        if (!graph || visited.has(graph)) return;
        visited.add(graph);
        var nodes = graphNodes(graph);
        for (var index = 0; index < nodes.length; index++) {
            var node = nodes[index];
            if (isXPipeGate(node)) visitor(node);
            if (node && node.subgraph) walk(node.subgraph);
        }
    };
    walk(rootGraph);
}

function markCanvasDirty() {
    if (!app.canvas) return;
    if (typeof app.canvas.setDirtyCanvas === "function") {
        app.canvas.setDirtyCanvas(true, true);
    } else if (typeof app.canvas.setDirty === "function") {
        app.canvas.setDirty(true, true);
    }
}

function cloneSlotDef(slot) {
    var result = {};
    if (!slot) return result;
    for (var key in slot) {
        if (!Object.prototype.hasOwnProperty.call(slot, key)) continue;
        if (key === "link" || key === "links" || key === "pos") continue;
        result[key] = slot[key];
    }
    return result;
}

function captureSlotDefs(node) {
    var defs = { inputs: {}, enables: {}, outputs: {} };
    for (var channel = 1; channel <= GATE_SLOTS; channel++) {
        var inputIndex = slotIndexByName(
            node.inputs,
            "input_" + channel,
        );
        var enableIndex = slotIndexByName(
            node.inputs,
            "enable_" + channel,
        );
        var outputIndex = slotIndexByName(
            node.outputs,
            "output_" + channel,
        );
        defs.inputs[channel] = cloneSlotDef(
            inputIndex >= 0 ? node.inputs[inputIndex] : null,
        );
        defs.enables[channel] = cloneSlotDef(
            enableIndex >= 0 ? node.inputs[enableIndex] : null,
        );
        defs.outputs[channel] = cloneSlotDef(
            outputIndex >= 0 ? node.outputs[outputIndex] : null,
        );
        defs.inputs[channel].name = "input_" + channel;
        defs.inputs[channel].type = "*";
        defs.enables[channel].name = "enable_" + channel;
        defs.outputs[channel].name = "output_" + channel;
    }
    return defs;
}

function refreshInputLinkTargets(node) {
    if (!node || !node.graph || !Array.isArray(node.inputs)) return;
    for (var index = 0; index < node.inputs.length; index++) {
        var ids = slotLinkIds(node.inputs[index]);
        for (var linkIndex = 0; linkIndex < ids.length; linkIndex++) {
            var link = getLinkInfo(node.graph, ids[linkIndex]);
            if (link) link.target_slot = index;
        }
    }
}

function refreshOutputLinkSources(node) {
    if (!node || !node.graph || !Array.isArray(node.outputs)) return;
    for (var index = 0; index < node.outputs.length; index++) {
        var ids = slotLinkIds(node.outputs[index]);
        for (var linkIndex = 0; linkIndex < ids.length; linkIndex++) {
            var link = getLinkInfo(node.graph, ids[linkIndex]);
            if (link) link.origin_slot = index;
        }
    }
}

function sortChannelInputs(node) {
    if (!node || !Array.isArray(node.inputs)) return;
    var channels = [];
    var bundle = null;
    var others = [];
    for (var index = 0; index < node.inputs.length; index++) {
        var input = node.inputs[index];
        if (input && input.name === BUNDLE_INPUT) bundle = input;
        else if (channelInputNumber(input && input.name)) channels.push(input);
        else others.push(input);
    }
    channels.sort(function (left, right) {
        return channelInputNumber(left.name) - channelInputNumber(right.name);
    });
    var ordered = bundle ? [bundle] : [];
    ordered = ordered.concat(channels, others);
    var changed = ordered.some(function (input, orderedIndex) {
        return input !== node.inputs[orderedIndex];
    });
    if (!changed) return;
    node.inputs.splice.apply(
        node.inputs,
        [0, node.inputs.length].concat(ordered),
    );
    refreshInputLinkTargets(node);
}

function sortChannelOutputs(node) {
    if (!node || !Array.isArray(node.outputs)) return;
    var channels = [];
    var bundle = null;
    var others = [];
    for (var index = 0; index < node.outputs.length; index++) {
        var output = node.outputs[index];
        if (output && output.name === BUNDLE_OUTPUT) bundle = output;
        else if (channelOutputNumber(output && output.name)) {
            channels.push(output);
        }
        else others.push(output);
    }
    channels.sort(function (left, right) {
        return channelOutputNumber(left.name)
            - channelOutputNumber(right.name);
    });
    var ordered = bundle ? [bundle] : [];
    ordered = ordered.concat(channels, others);
    var changed = ordered.some(function (output, orderedIndex) {
        return output !== node.outputs[orderedIndex];
    });
    if (!changed) return;
    node.outputs.splice.apply(
        node.outputs,
        [0, node.outputs.length].concat(ordered),
    );
    refreshOutputLinkSources(node);
}

function addChannelInput(state, channel) {
    var def = cloneSlotDef(state.slotDefs.inputs[channel]);
    state.node.addInput("input_" + channel, "*");
    var index = slotIndexByName(
        state.node.inputs,
        "input_" + channel,
    );
    if (index >= 0) Object.assign(state.node.inputs[index], def);
}

function addChannelEnable(state, channel) {
    var def = cloneSlotDef(state.slotDefs.enables[channel]);
    if (!def.widget) return;
    state.node.addInput(def.name, def.type);
    var index = slotIndexByName(state.node.inputs, def.name);
    if (index >= 0) Object.assign(state.node.inputs[index], def);
}

function addChannelOutput(state, channel) {
    var def = cloneSlotDef(state.slotDefs.outputs[channel]);
    def.name = "output_" + channel;
    def.type = socketType(state.types[channel - 1]);
    state.node.addOutput(def.name, def.type);
    var index = slotIndexByName(state.node.outputs, def.name);
    if (index >= 0) Object.assign(state.node.outputs[index], def);
}

function removeChannelInput(node, channel) {
    var index = slotIndexByName(node.inputs, "input_" + channel);
    if (index < 0 || slotLinkIds(node.inputs[index]).length) return;
    if (typeof node.removeInput === "function") node.removeInput(index);
    else node.inputs.splice(index, 1);
    refreshInputLinkTargets(node);
}

function removeChannelEnable(node, channel) {
    var index = slotIndexByName(node.inputs, "enable_" + channel);
    if (index < 0 || slotLinkIds(node.inputs[index]).length) return;
    if (typeof node.removeInput === "function") node.removeInput(index);
    else node.inputs.splice(index, 1);
    refreshInputLinkTargets(node);
}

function removeChannelOutput(node, channel) {
    var index = slotIndexByName(node.outputs, "output_" + channel);
    if (index < 0 || slotLinkIds(node.outputs[index]).length) return;
    if (typeof node.removeOutput === "function") node.removeOutput(index);
    else node.outputs.splice(index, 1);
    refreshOutputLinkSources(node);
}

function highestUsedChannel(node) {
    var highest = 0;
    if (node && Array.isArray(node.inputs)) {
        for (var inputIndex = 0;
            inputIndex < node.inputs.length;
            inputIndex++) {
            var input = node.inputs[inputIndex];
            var dataChannel = channelInputNumber(input && input.name);
            var enableChannel = channelEnableNumber(input && input.name);
            if (dataChannel && slotLinkIds(input).length) {
                highest = Math.max(highest, dataChannel);
            }
            if (enableChannel && slotLinkIds(input).length) {
                highest = Math.max(highest, enableChannel);
            }
        }
    }
    if (node && Array.isArray(node.outputs)) {
        for (var outputIndex = 0;
            outputIndex < node.outputs.length;
            outputIndex++) {
            var output = node.outputs[outputIndex];
            var outputChannel = channelOutputNumber(output && output.name);
            if (outputChannel && slotLinkIds(output).length) {
                highest = Math.max(highest, outputChannel);
            }
        }
    }
    return Math.min(GATE_SLOTS, highest);
}

function upstreamBundleState(node) {
    return resolveXPipeV2StateForInput(node, BUNDLE_INPUT);
}

function desiredVisibleCount(state) {
    var highest = highestUsedChannel(state.node);
    var directCount = highest ? Math.min(
        GATE_SLOTS,
        highest + (highest < GATE_SLOTS ? 1 : 0),
    ) : 1;
    var upstream = upstreamBundleState(state.node);
    var upstreamCount = upstream
        ? Number(upstream.visibleCount) || 0
        : 0;
    return Math.max(
        1,
        Math.min(GATE_SLOTS, Math.max(directCount, upstreamCount)),
    );
}

function findWidget(node, name) {
    if (!node || !Array.isArray(node.widgets)) return null;
    for (var index = 0; index < node.widgets.length; index++) {
        if (node.widgets[index] && node.widgets[index].name === name) {
            return node.widgets[index];
        }
    }
    return null;
}

function setWidgetHidden(widget, hidden) {
    if (!widget) return;
    widget.hidden = hidden;
    widget.options = widget.options || {};
    widget.options.hidden = hidden;
    if (hidden) {
        widget.computeSize = function () { return [0, -4]; };
    } else if (Object.prototype.hasOwnProperty.call(widget, "computeSize")) {
        delete widget.computeSize;
    }
}

function syncSwitchVisibility(state) {
    for (var channel = 1; channel <= GATE_SLOTS; channel++) {
        setWidgetHidden(
            findWidget(state.node, "enable_" + channel),
            channel > state.visibleCount,
        );
    }
    state.node._widgetSlotsDirty = true;
}

function syncDynamicChannels(state) {
    var count = desiredVisibleCount(state);
    for (var channel = 1; channel <= count; channel++) {
        if (slotIndexByName(
            state.node.inputs,
            "input_" + channel,
        ) < 0) addChannelInput(state, channel);
        if (slotIndexByName(
            state.node.inputs,
            "enable_" + channel,
        ) < 0) addChannelEnable(state, channel);
        if (slotIndexByName(
            state.node.outputs,
            "output_" + channel,
        ) < 0) addChannelOutput(state, channel);
    }
    for (var unused = GATE_SLOTS; unused > count; unused--) {
        removeChannelEnable(state.node, unused);
        removeChannelInput(state.node, unused);
        removeChannelOutput(state.node, unused);
    }
    state.visibleCount = count;
    sortChannelInputs(state.node);
    sortChannelOutputs(state.node);
    syncSwitchVisibility(state);
}

function directInputSource(state, channel) {
    var index = slotIndexByName(
        state.node.inputs,
        "input_" + channel,
    );
    var input = index >= 0 ? state.node.inputs[index] : null;
    if (!input || input.link == null) return null;
    var link = getLinkInfo(state.node.graph, input.link);
    var source = link && getNodeById(state.node.graph, link.origin_id);
    var output = source && source.outputs
        ? source.outputs[link.origin_slot]
        : null;
    if (link && !output && typeof link.resolve === "function") {
        try {
            var resolved = link.resolve(state.node.graph);
            output = resolved && (
                resolved.output
                || resolved.subgraphInput
                || resolved.subgraphOutput
            );
        } catch (_error) { /* use link metadata */ }
    }
    var metadata = resolveXPipeV2ValueMetadataForInput(
        state.node,
        "input_" + channel,
    );
    return link
        ? {
            link: link,
            source: source,
            output: output,
            metadata: metadata,
        }
        : null;
}

function directSourceName(direct) {
    if (!direct) return "";
    var metadataName = cleanName(direct.metadata && direct.metadata.name);
    if (metadataName) return metadataName;
    if (!direct.output) return "";
    var match = /^(?:value|output)_(\d+)$/.exec(
        direct.output.name || "",
    );
    var slot = match ? parseInt(match[1], 10) : 0;
    var sourceState = direct.source && (
        direct.source.__xpipeV2State
        || direct.source.__xpipeGateState
    );
    if (sourceState && slot) {
        var stateName = cleanName(sourceState.names[slot - 1]);
        if (stateName) return stateName;
    }
    return cleanName(direct.output.label)
        || cleanName(direct.output.localized_name)
        || cleanName(direct.output.name);
}

function refreshChannelMetadata(state) {
    var upstream = upstreamBundleState(state.node);
    var changed = false;
    for (var channel = 1; channel <= GATE_SLOTS; channel++) {
        var direct = directInputSource(state, channel);
        var outputIndex = slotIndexByName(
            state.node.outputs,
            "output_" + channel,
        );
        var output = outputIndex >= 0
            ? state.node.outputs[outputIndex]
            : null;
        var nextType = direct
            ? cleanType(direct.metadata && direct.metadata.type)
                || cleanType(direct.output && direct.output.type)
                || cleanType(direct.link.type)
            : cleanType(upstream && upstream.types[channel - 1]);
        if (!nextType && output && slotLinkIds(output).length) {
            nextType = state.types[channel - 1];
        }
        var nextName = direct
            ? directSourceName(direct)
            : cleanName(upstream && upstream.names[channel - 1]);
        if (state.types[channel - 1] !== nextType) {
            state.types[channel - 1] = nextType;
            changed = true;
        }
        if (state.names[channel - 1] !== nextName) {
            state.names[channel - 1] = nextName;
            changed = true;
        }
    }
    return changed;
}

function formatPortLabel(channel, name) {
    var value = cleanName(name);
    return value ? "[" + channel + "] " + value : "[" + channel + "]";
}

function replaceSlotLabel(slots, index, label) {
    if (!slots || index < 0 || !slots[index]) return;
    slots[index].label = label;
    slots[index].localized_name = label;
}

function applyChannelLabels(state) {
    for (var channel = 1; channel <= GATE_SLOTS; channel++) {
        var label = formatPortLabel(channel, state.names[channel - 1]);
        replaceSlotLabel(
            state.node.inputs,
            slotIndexByName(state.node.inputs, "input_" + channel),
            label,
        );
        replaceSlotLabel(
            state.node.outputs,
            slotIndexByName(state.node.outputs, "output_" + channel),
            label,
        );
    }
}

function applyChannelTypes(state) {
    for (var channel = 1; channel <= GATE_SLOTS; channel++) {
        var inputIndex = slotIndexByName(
            state.node.inputs,
            "input_" + channel,
        );
        if (inputIndex >= 0) state.node.inputs[inputIndex].type = "*";
        var outputIndex = slotIndexByName(
            state.node.outputs,
            "output_" + channel,
        );
        if (outputIndex < 0) continue;
        var output = state.node.outputs[outputIndex];
        output.type = socketType(state.types[channel - 1]);
        var ids = slotLinkIds(output);
        for (var linkIndex = 0; linkIndex < ids.length; linkIndex++) {
            var link = getLinkInfo(state.node.graph, ids[linkIndex]);
            if (link) link.type = output.type;
        }
    }
}

function persistState(state) {
    state.node.properties = state.node.properties || {};
    state.node.properties[TYPES_PROP] = state.types.slice();
    var namesWidget = findWidget(state.node, NAMES_WIDGET);
    if (namesWidget) namesWidget.value = JSON.stringify(state.names);
}

function hideNamesWidget(node) {
    var widget = findWidget(node, NAMES_WIDGET);
    if (!widget) return;
    setWidgetHidden(widget, true);
    widget.type = "hidden";
    if (widget.element) widget.element.style.display = "none";
    if (widget.inputEl) widget.inputEl.style.display = "none";
    var inputIndex = slotIndexByName(node.inputs, NAMES_WIDGET);
    if (inputIndex < 0 || slotLinkIds(node.inputs[inputIndex]).length) return;
    if (typeof node.removeInput === "function") node.removeInput(inputIndex);
    else node.inputs.splice(inputIndex, 1);
    refreshInputLinkTargets(node);
}

function refreshNodeLayout(node) {
    if (!node) return;
    try {
        if (typeof node._setConcreteSlots === "function") {
            node._setConcreteSlots();
        }
        if (typeof node.arrange === "function") node.arrange();
    } catch (_error) { /* keep current layout */ }
    node.setDirtyCanvas && node.setDirtyCanvas(true, true);
    markCanvasDirty();
}

function resolveInitialNodeSize(node) {
    if (!node) return null;
    var current = Array.isArray(node.size) ? node.size : [0, 0];
    var computed = typeof node.computeSize === "function"
        ? node.computeSize()
        : [0, 0];
    var width = Number(computed && computed[0])
        || Number(current[0]) || 0;
    var height = Number(computed && computed[1])
        || Number(current[1]) || 0;
    return [
        Math.max(1, Math.ceil(width + INITIAL_WIDTH_EXTRA)),
        Math.max(1, Math.ceil(height)),
    ];
}

function applyInitialNodeSize(node) {
    if (!node || node.__xpipeGateInitialSizeApplied) return;
    var size = resolveInitialNodeSize(node);
    if (!size) return;
    node.min_size = size.slice();
    if (typeof node.setSize === "function") node.setSize(size.slice());
    else node.size = size.slice();
    node.__xpipeGateInitialSizeApplied = true;
}

function stateSignature(state) {
    return JSON.stringify({
        inputCount: state.node.inputs ? state.node.inputs.length : 0,
        outputCount: state.node.outputs ? state.node.outputs.length : 0,
        names: state.names,
        types: state.types,
        visibleCount: state.visibleCount,
    });
}

function syncNode(state) {
    var before = stateSignature(state);
    syncDynamicChannels(state);
    refreshChannelMetadata(state);
    applyChannelTypes(state);
    applyChannelLabels(state);
    persistState(state);
    hideNamesWidget(state.node);
    refreshNodeLayout(state.node);
    applyInitialNodeSize(state.node);
    return before !== stateSignature(state);
}

function createState(node) {
    if (node.__xpipeGateState) return node.__xpipeGateState;
    node.properties = node.properties || {};
    var state = {
        node: node,
        slotDefs: captureSlotDefs(node),
        names: padArray([], GATE_SLOTS, ""),
        types: padArray(
            node.properties[TYPES_PROP],
            GATE_SLOTS,
            "",
        ).map(cleanType),
        visibleCount: 1,
    };
    node.__xpipeGateState = state;
    return state;
}

function ensurePipeGate(node) {
    return isXPipeGate(node) ? createState(node) : null;
}

function refreshAllPipeGate() {
    var states = [];
    forEachPipeGate(app.graph, function (node) {
        var state = ensurePipeGate(node);
        if (state) states.push(state);
    });
    var anyChanged = false;
    for (var pass = 0; pass < 2; pass++) {
        var changed = false;
        for (var index = 0; index < states.length; index++) {
            changed = syncNode(states[index]) || changed;
        }
        anyChanged = anyChanged || changed;
        if (!changed) break;
    }
    if (anyChanged) scheduleXPipeV2Refresh();
}

function scheduleRefresh() {
    if (refreshTimer != null) return;
    refreshTimer = setTimeout(function () {
        refreshTimer = null;
        try { refreshAllPipeGate(); } catch (_error) { /* ignore */ }
    }, 0);
}

app.registerExtension({
    name: "ComfyUI.Xz3r0.XPipeGate",

    async setup() {
        subscribeXPipeV2Metadata(scheduleRefresh);
    },

    async afterConfigureGraph() {
        scheduleRefresh();
    },

    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (!nodeType.prototype.__xpipeGateRefreshHooked) {
            nodeType.prototype.__xpipeGateRefreshHooked = true;
            var originalAnyConnections = nodeType.prototype.onConnectionsChange;
            nodeType.prototype.onConnectionsChange = function () {
                var result = originalAnyConnections
                    && originalAnyConnections.apply(this, arguments);
                if (gateNodeCount > 0) scheduleRefresh();
                return result;
            };
        }
        if (String(nodeData.name) !== NODE_CLASS) return;

        var originalCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            originalCreated && originalCreated.apply(this, arguments);
            if (!this.__xpipeGateCounted) {
                this.__xpipeGateCounted = true;
                gateNodeCount++;
            }
            var state = ensurePipeGate(this);
            if (state) syncNode(state);
        };

        var originalConfigure = nodeType.prototype.onConfigure;
        nodeType.prototype.onConfigure = function () {
            originalConfigure && originalConfigure.apply(this, arguments);
            var state = ensurePipeGate(this);
            if (!state) return;
            state.types = padArray(
                this.properties && this.properties[TYPES_PROP],
                GATE_SLOTS,
                "",
            ).map(cleanType);
            scheduleRefresh();
        };

        var originalRemoved = nodeType.prototype.onRemoved;
        nodeType.prototype.onRemoved = function () {
            if (this.__xpipeGateCounted) {
                this.__xpipeGateCounted = false;
                gateNodeCount = Math.max(0, gateNodeCount - 1);
            }
            return originalRemoved && originalRemoved.apply(this, arguments);
        };
    },

    async loadedGraphNode(node) {
        if (!isXPipeGate(node)) return;
        var state = ensurePipeGate(node);
        if (state) syncNode(state);
        scheduleRefresh();
    },

    nodeCreated(node) {
        if (!isXPipeGate(node)) return;
        if (!node.__xpipeGateCounted) {
            node.__xpipeGateCounted = true;
            gateNodeCount++;
        }
        ensurePipeGate(node);
    },
});
