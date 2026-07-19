import { app } from "../../scripts/app.js";

var NODE_CLASS = "XPipe_v2";
var PIPE_TYPE = "xpipe_v2";
var PIPE_SLOTS = 50;
var HIDE_NONE = 0;
var HIDE_INPUT = 1;
var HIDE_OUTPUT = 2;
var HIDE_BOTH = 3;
var BUNDLE_INPUT_NAME = "xpipe_in";
var BUNDLE_OUTPUT_NAME = "xpipe_out";
var NAMES_WIDGET = "port_names";
var HIDE_STATE_PROP = "xpipe_v2_hide_links_state";
var VALUE_HIDE_STATE_PROP = "xpipe_v2_hide_value_links_state";
var NAMES_PROP = "xpipe_v2_names";
var MANUAL_PROP = "xpipe_v2_manual";
var TYPES_PROP = "xpipe_v2_types";
var CONTROL_VALUES = ["0", "1", "2", "3"];
var CONTROL_BUNDLE = "bundle";
var CONTROL_VALUE = "value";
var CONTROL_REFRESH = "refresh";
var INITIAL_WIDTH_EXTRA = 20;
var WARNING_COLOR = "#1a1a1a";
var WARNING_GLOW = "rgba(255, 15, 15, 0.95)";
var uiLocalePrimary = null;
var uiLocaleFallback = null;
var i18nCache = {};
var localeSyncInstalled = false;
var canvasHooked = false;
var graphRefreshTimer = null;
var v2NodeCount = 0;
var graphIds = new WeakMap();
var nextGraphId = 1;

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

function padArray(values, size, fill) {
    var result = Array.isArray(values) ? values.slice(0, size) : [];
    while (result.length < size) result.push(fill);
    return result;
}

function valueSlotNumber(name) {
    var match = /(?:^|\.)value_(\d+)$/.exec(name || "");
    return match ? parseInt(match[1], 10) : 0;
}

function slotIndexOfName(slots, name) {
    if (!Array.isArray(slots)) return -1;
    for (var index = 0; index < slots.length; index++) {
        if (slots[index] && slots[index].name === name) return index;
    }
    var slot = valueSlotNumber(name);
    if (!slot) return -1;
    var autogrowName = "values.value_" + slot;
    for (var other = 0; other < slots.length; other++) {
        if (slots[other] && slots[other].name === autogrowName) return other;
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

function graphKey(graph) {
    if (!graph) return "root";
    if (!graphIds.has(graph)) graphIds.set(graph, String(nextGraphId++));
    return graphIds.get(graph);
}

function normalizedNodeType(node) {
    return String(
        node && (node.comfyClass || node.type || node.title
            || (node.constructor && node.constructor.name)) || "",
    ).toLowerCase().replace(/[^a-z0-9]/g, "");
}

function isSubgraphInputNode(node, graph) {
    return !!(
        node
        && (node === (graph && graph.inputNode)
            || normalizedNodeType(node).indexOf("subgraphinput") >= 0)
    );
}

function isSubgraphOutputNode(node, graph) {
    return !!(
        node
        && (node === (graph && graph.outputNode)
            || normalizedNodeType(node).indexOf("subgraphoutput") >= 0)
    );
}

function findSubgraphInputNode(graph) {
    if (!graph) return null;
    if (graph.inputNode) return graph.inputNode;
    var nodes = graphNodes(graph);
    for (var index = 0; index < nodes.length; index++) {
        if (isSubgraphInputNode(nodes[index], graph)) return nodes[index];
    }
    return null;
}

function findSubgraphOutputNode(graph) {
    if (!graph) return null;
    if (graph.outputNode) return graph.outputNode;
    var nodes = graphNodes(graph);
    for (var index = 0; index < nodes.length; index++) {
        if (isSubgraphOutputNode(nodes[index], graph)) return nodes[index];
    }
    return null;
}

function findParentSubgraphNode(childGraph) {
    if (!childGraph || !app.graph) return null;
    var found = null;
    var visited = new WeakSet();
    var walk = function (graph) {
        if (!graph || found || visited.has(graph)) return;
        visited.add(graph);
        var nodes = graphNodes(graph);
        for (var index = 0; index < nodes.length; index++) {
            var node = nodes[index];
            if (node && node.subgraph === childGraph) {
                found = node;
                return;
            }
            if (node && node.subgraph) walk(node.subgraph);
        }
    };
    walk(app.graph);
    return found;
}

function slotKeyNames(slot) {
    var names = [];
    var add = function (value) {
        var name = cleanName(value);
        if (name && names.indexOf(name) < 0) names.push(name);
    };
    if (!slot) return names;
    add(slot.name);
    add(slot.label);
    add(slot.localized_name);
    return names;
}

function slotAt(slots, index) {
    return slots && index != null && index >= 0 ? slots[index] || null : null;
}

function findMatchingSlotIndex(slots, reference, fallbackIndex) {
    if (!slots) return -1;
    if (slotAt(slots, fallbackIndex)) return fallbackIndex;
    var names = slotKeyNames(reference);
    var entries = Array.isArray(slots)
        ? slots.map(function (slot, index) {
            return { index: index, slot: slot };
        })
        : Object.keys(slots).map(function (key) {
            return { index: parseInt(key, 10), slot: slots[key] };
        });
    for (var nameIndex = 0; nameIndex < names.length; nameIndex++) {
        for (var index = 0; index < entries.length; index++) {
            if (slotKeyNames(entries[index].slot).indexOf(
                names[nameIndex],
            ) >= 0) return entries[index].index;
        }
    }
    return -1;
}

function findLinkToNodeInput(graph, node, inputIndex) {
    if (!graph || !node) return null;
    var links = graph.links || graph._links;
    if (!links) return null;
    if (links instanceof Map) {
        var found = null;
        links.forEach(function (link) {
            if (!found && link && link.target_id === node.id
                && link.target_slot === inputIndex) found = link;
        });
        return found;
    }
    for (var key in links) {
        if (!Object.prototype.hasOwnProperty.call(links, key)) continue;
        var link = links[key];
        if (link && link.target_id === node.id
            && link.target_slot === inputIndex) return link;
    }
    return null;
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

function findLinkInGraphTree(linkId, preferredGraph) {
    var direct = getLinkInfo(preferredGraph, linkId);
    if (direct) return { graph: preferredGraph, link: direct };
    var found = null;
    var visited = new WeakSet();
    var walk = function (graph) {
        if (!graph || found || visited.has(graph)) return;
        visited.add(graph);
        var link = getLinkInfo(graph, linkId);
        if (link) {
            found = { graph: graph, link: link };
            return;
        }
        var nodes = graphNodes(graph);
        for (var index = 0; index < nodes.length; index++) {
            if (nodes[index] && nodes[index].subgraph) {
                walk(nodes[index].subgraph);
            }
        }
    };
    walk(app.graph);
    return found;
}

function findSlotOwner(slot, direction, preferredGraph) {
    if (!slot) return null;
    var found = null;
    var visited = new WeakSet();
    var walk = function (graph) {
        if (!graph || found || visited.has(graph)) return;
        visited.add(graph);
        var nodes = graphNodes(graph);
        for (var index = 0; index < nodes.length; index++) {
            var node = nodes[index];
            var slots = direction === "input" ? node.inputs : node.outputs;
            if (Array.isArray(slots)) {
                for (var slotIndex = 0; slotIndex < slots.length; slotIndex++) {
                    if (slots[slotIndex] === slot) {
                        found = {
                            graph: graph,
                            index: slotIndex,
                            node: node,
                            slot: slot,
                        };
                        return;
                    }
                }
            }
            if (node && node.subgraph) walk(node.subgraph);
        }
    };
    walk(preferredGraph);
    if (!found) walk(app.graph);
    return found;
}

function isXPipeV2(node) {
    return !!(
        node
        && String(node.comfyClass || node.type || "") === NODE_CLASS
    );
}

function forEachXPipeV2(rootGraph, visitor) {
    if (!rootGraph || typeof visitor !== "function") return;
    var visited = new WeakSet();
    var walk = function (graph) {
        if (!graph || visited.has(graph)) return;
        visited.add(graph);
        var nodes = graphNodes(graph);
        for (var index = 0; index < nodes.length; index++) {
            var node = nodes[index];
            if (isXPipeV2(node)) visitor(node);
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

function resolveComfyLocale() {
    try {
        var value = app.extensionManager
            && app.extensionManager.setting
            && app.extensionManager.setting.get
            && app.extensionManager.setting.get("Comfy.Locale");
        if (value) return value;
    } catch (_error) { /* fall through */ }
    try {
        var stored = localStorage.getItem("Comfy.Locale");
        if (stored) return stored;
    } catch (_error) { /* fall through */ }
    if (document.documentElement && document.documentElement.lang) {
        return document.documentElement.lang;
    }
    return navigator.language || "en";
}

function fetchI18n(locale) {
    if (i18nCache[locale]) return Promise.resolve(i18nCache[locale]);
    return fetch("/xz3r0/xdatahub/i18n/ui?locale="
        + encodeURIComponent(locale))
        .then(function (response) {
            return response.ok ? response.json() : {};
        })
        .then(function (data) {
            i18nCache[locale] = data && data.dict ? data.dict : {};
            return i18nCache[locale];
        })
        .catch(function () { return {}; });
}

function t(key, fallback) {
    if (uiLocalePrimary && uiLocalePrimary[key] !== undefined) {
        return uiLocalePrimary[key];
    }
    if (uiLocaleFallback && uiLocaleFallback[key] !== undefined) {
        return uiLocaleFallback[key];
    }
    return fallback || key;
}

function tx(suffix, fallback) {
    return t("xdatahub.ui.node.xpipe_v2." + suffix, fallback);
}

function txf(suffix, fallback, variables) {
    return String(tx(suffix, fallback)).replace(
        /\{(\w+)\}/g,
        function (_match, key) {
            return variables && variables[key] != null
                ? String(variables[key])
                : "";
        },
    );
}

function visibilityLabel(value) {
    if (String(value) === "1") {
        return tx("visibility_hide_input", "Hide Input");
    }
    if (String(value) === "2") {
        return tx("visibility_hide_output", "Hide Output");
    }
    if (String(value) === "3") {
        return tx("visibility_hide_all", "Hide All");
    }
    return tx("visibility_show_all", "Show All");
}

function applyUiLocale() {
    var locale = resolveComfyLocale();
    var normalized = locale === "zh" || locale === "zh-CN"
        || locale === "zh-TW" ? "zh" : "en";
    return Promise.all([fetchI18n("en"), fetchI18n(normalized)])
        .then(function (results) {
            uiLocaleFallback = results[0];
            uiLocalePrimary = normalized === "en" ? results[0] : results[1];
            forEachXPipeV2(app.graph, function (node) {
                updateControlWidgets(node);
                if (node.__xpipeV2State) {
                    syncNameWidgets(node.__xpipeV2State);
                    refreshNodeLayout(node);
                }
            });
            markCanvasDirty();
        });
}

function installLocaleSync() {
    if (localeSyncInstalled) return;
    localeSyncInstalled = true;
    var lastLocale = null;
    setInterval(function () {
        var locale = resolveComfyLocale();
        if (locale && locale !== lastLocale) {
            lastLocale = locale;
            applyUiLocale();
        }
    }, 1000);
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

function findControlWidget(node, role) {
    if (!node || !Array.isArray(node.widgets)) return null;
    for (var index = 0; index < node.widgets.length; index++) {
        var widget = node.widgets[index];
        if (widget && widget.__xpipeV2Control === role) return widget;
    }
    return null;
}

function findNameWidget(node, slot) {
    if (!node || !Array.isArray(node.widgets)) return null;
    for (var index = 0; index < node.widgets.length; index++) {
        var widget = node.widgets[index];
        if (widget && widget.__xpipeV2NameSlot === slot) return widget;
    }
    return null;
}

function setWidgetTooltip(widget, tooltip) {
    if (!widget) return;
    widget.tooltip = tooltip;
    widget.options = widget.options || {};
    widget.options.tooltip = tooltip;
}

function disableWidgetSerialization(widget) {
    if (!widget) return;
    widget.serialize = false;
    widget.options = widget.options || {};
    widget.options.serialize = false;
}

function hideBackingWidget(widget) {
    if (!widget) return;
    widget.hidden = true;
    widget.options = widget.options || {};
    widget.options.hidden = true;
    widget.computeSize = function () { return [0, -4]; };
}

function normalizedHideState(value) {
    return Math.max(HIDE_NONE, Math.min(HIDE_BOTH, Number(value) || 0));
}

function hiddenState(node) {
    return normalizedHideState(
        node && node.properties && node.properties[HIDE_STATE_PROP],
    );
}

function valueHiddenState(node) {
    return normalizedHideState(
        node && node.properties && node.properties[VALUE_HIDE_STATE_PROP],
    );
}

function setHiddenState(node, state) {
    if (!node) return;
    node.properties = node.properties || {};
    var value = normalizedHideState(state);
    if (value === HIDE_NONE) delete node.properties[HIDE_STATE_PROP];
    else node.properties[HIDE_STATE_PROP] = value;
    updateControlWidgets(node);
    node.graph && node.graph.change && node.graph.change();
    markCanvasDirty();
}

function setValueHiddenState(node, state) {
    if (!node) return;
    node.properties = node.properties || {};
    var value = normalizedHideState(state);
    if (value === HIDE_NONE) delete node.properties[VALUE_HIDE_STATE_PROP];
    else node.properties[VALUE_HIDE_STATE_PROP] = value;
    updateControlWidgets(node);
    node.graph && node.graph.change && node.graph.change();
    markCanvasDirty();
}

function ensureControlWidgets(node) {
    if (!node || typeof node.addWidget !== "function") return;
    var bundle = findControlWidget(node, CONTROL_BUNDLE);
    if (!bundle) {
        bundle = node.addWidget(
            "combo",
            tx("control_links", "Links"),
            String(hiddenState(node)),
            function (value) { setHiddenState(node, value); },
            {
                values: CONTROL_VALUES,
                getOptionLabel: visibilityLabel,
                serialize: false,
            },
        );
        bundle.__xpipeV2Control = CONTROL_BUNDLE;
        disableWidgetSerialization(bundle);
    }
    var value = findControlWidget(node, CONTROL_VALUE);
    if (!value) {
        value = node.addWidget(
            "combo",
            tx("control_ports", "Ports"),
            String(valueHiddenState(node)),
            function (next) { setValueHiddenState(node, next); },
            {
                values: CONTROL_VALUES,
                getOptionLabel: visibilityLabel,
                serialize: false,
            },
        );
        value.__xpipeV2Control = CONTROL_VALUE;
        disableWidgetSerialization(value);
    }
    var refresh = findControlWidget(node, CONTROL_REFRESH);
    if (!refresh) {
        refresh = node.addWidget(
            "button",
            tx("control_refresh", "Refresh"),
            "refresh",
            function () { refreshPortStatus(node); },
            { serialize: false },
        );
        refresh.__xpipeV2Control = CONTROL_REFRESH;
        disableWidgetSerialization(refresh);
    }
    updateControlWidgets(node);
    sortXPipeV2Widgets(node);
}

function updateControlWidgets(node) {
    var bundle = findControlWidget(node, CONTROL_BUNDLE);
    if (bundle) {
        bundle.name = tx("control_links", "Links");
        bundle.label = bundle.name;
        bundle.value = String(hiddenState(node));
        bundle.options.values = CONTROL_VALUES;
        bundle.options.getOptionLabel = visibilityLabel;
        setWidgetTooltip(
            bundle,
            tx("control_links_tooltip", "Set XPipe_v2 bundle visibility"),
        );
    }
    var value = findControlWidget(node, CONTROL_VALUE);
    if (value) {
        value.name = tx("control_ports", "Ports");
        value.label = value.name;
        value.value = String(valueHiddenState(node));
        value.options.values = CONTROL_VALUES;
        value.options.getOptionLabel = visibilityLabel;
        setWidgetTooltip(
            value,
            tx("control_ports_tooltip", "Set V2 slot link visibility"),
        );
    }
    var refresh = findControlWidget(node, CONTROL_REFRESH);
    if (refresh) {
        refresh.name = tx("control_refresh", "Refresh");
        refresh.label = refresh.name;
        setWidgetTooltip(
            refresh,
            tx("control_refresh_tooltip", "Refresh V2 names and types"),
        );
    }
}

function sortXPipeV2Widgets(node) {
    if (!node || !Array.isArray(node.widgets)) return;
    var base = [];
    var controls = {};
    var names = [];
    for (var index = 0; index < node.widgets.length; index++) {
        var widget = node.widgets[index];
        if (widget && widget.__xpipeV2Control) {
            controls[widget.__xpipeV2Control] = widget;
        } else if (widget && widget.__xpipeV2NameSlot) {
            names.push(widget);
        } else {
            base.push(widget);
        }
    }
    names.sort(function (left, right) {
        return left.__xpipeV2NameSlot - right.__xpipeV2NameSlot;
    });
    var ordered = base;
    [CONTROL_BUNDLE, CONTROL_VALUE, CONTROL_REFRESH].forEach(
        function (role) {
            if (controls[role]) ordered.push(controls[role]);
        },
    );
    ordered = ordered.concat(names);
    var changed = ordered.length !== node.widgets.length;
    if (!changed) {
        for (var other = 0; other < ordered.length; other++) {
            if (ordered[other] !== node.widgets[other]) {
                changed = true;
                break;
            }
        }
    }
    if (!changed) return;
    node.widgets.splice.apply(
        node.widgets,
        [0, node.widgets.length].concat(ordered),
    );
    node._widgetSlotsDirty = true;
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
    var defs = { inputs: {}, outputs: {} };
    for (var slot = 1; slot <= PIPE_SLOTS; slot++) {
        var inputIndex = slotIndexOfName(node.inputs, "value_" + slot);
        var outputIndex = slotIndexOfName(node.outputs, "value_" + slot);
        defs.inputs[slot] = cloneSlotDef(
            inputIndex >= 0 ? node.inputs[inputIndex] : null,
        );
        defs.outputs[slot] = cloneSlotDef(
            outputIndex >= 0 ? node.outputs[outputIndex] : null,
        );
        defs.inputs[slot].name = "value_" + slot;
        defs.inputs[slot].type = "*";
        defs.outputs[slot].name = "value_" + slot;
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

function ensureInputOrder(node) {
    var bundleIndex = slotIndexOfName(node.inputs, BUNDLE_INPUT_NAME);
    if (bundleIndex <= 0) return;
    var bundle = node.inputs.splice(bundleIndex, 1)[0];
    node.inputs.unshift(bundle);
    refreshInputLinkTargets(node);
}

function normalizeValueInputs(node) {
    if (!node || !Array.isArray(node.inputs)) return;
    for (var index = 0; index < node.inputs.length; index++) {
        var slot = valueSlotNumber(node.inputs[index] && node.inputs[index].name);
        if (!slot) continue;
        node.inputs[index].name = "value_" + slot;
        node.inputs[index].display_name = String(slot);
    }
}

function addValueInput(state, slot) {
    var node = state.node;
    var def = cloneSlotDef(state.slotDefs.inputs[slot]);
    node.addInput("value_" + slot, "*");
    var index = slotIndexOfName(node.inputs, "value_" + slot);
    if (index >= 0) {
        Object.assign(node.inputs[index], def);
    }
}

function addValueOutput(state, slot) {
    var node = state.node;
    var def = cloneSlotDef(state.slotDefs.outputs[slot]);
    def.name = "value_" + slot;
    def.type = socketType(state.types[slot - 1]);
    node.addOutput(def.name, def.type);
    var index = slotIndexOfName(node.outputs, def.name);
    if (index >= 0) Object.assign(node.outputs[index], def);
}

function removeValueInput(node, slot) {
    var index = slotIndexOfName(node.inputs, "value_" + slot);
    if (index < 0 || slotLinkIds(node.inputs[index]).length) return;
    if (typeof node.removeInput === "function") node.removeInput(index);
    else node.inputs.splice(index, 1);
    refreshInputLinkTargets(node);
}

function removeValueOutput(node, slot) {
    var index = slotIndexOfName(node.outputs, "value_" + slot);
    if (index < 0 || slotLinkIds(node.outputs[index]).length) return;
    if (typeof node.removeOutput === "function") node.removeOutput(index);
    else node.outputs.splice(index, 1);
}

function highestConnectedValueSlot(node) {
    var highest = 0;
    if (!node || !Array.isArray(node.inputs)) return highest;
    for (var index = 0; index < node.inputs.length; index++) {
        var slot = valueSlotNumber(node.inputs[index] && node.inputs[index].name);
        if (slot && slotLinkIds(node.inputs[index]).length) {
            highest = Math.max(highest, slot);
        }
    }
    return highest;
}

function desiredDirectVisibleCount(node) {
    var highest = highestConnectedValueSlot(node);
    return highest
        ? Math.min(PIPE_SLOTS, highest + (highest < PIPE_SLOTS ? 1 : 0))
        : 1;
}

function upstreamBundleState(node) {
    var index = slotIndexOfName(node.inputs, BUNDLE_INPUT_NAME);
    var input = index >= 0 ? node.inputs[index] : null;
    if (!input || input.link == null) return null;
    var link = getLinkInfo(node.graph, input.link);
    return resolveBundleStateFromLink(node.graph, link, {});
}

function passthroughInputIndex(node, outputIndex) {
    if (!node || !Array.isArray(node.inputs)
        || !Array.isArray(node.outputs)) return -1;
    var output = node.outputs[outputIndex];
    if (!output) return -1;
    if (String(node.comfyClass || node.type || "") === "XLinker") {
        return outputIndex === 0 && node.inputs[0]
            && node.inputs[0].link != null ? 0 : -1;
    }
    var outputName = cleanName(output.name);
    for (var index = 0; index < node.inputs.length; index++) {
        var input = node.inputs[index];
        if (!input || input.link == null) continue;
        var inputType = cleanType(input.type);
        var outputType = cleanType(output.type);
        if (inputType && outputType && inputType !== outputType) continue;
        if (outputName && cleanName(input.name) === outputName) return index;
    }
    if (!outputName && node.inputs.length === 1
        && node.inputs[0].link != null) return 0;
    return -1;
}

function resolveBundleStateFromSlot(slot, graph, seen) {
    if (!slot) return null;
    var outputOwner = findSlotOwner(slot, "output", graph);
    if (outputOwner) {
        if (isXPipeV2(outputOwner.node)
            && outputOwner.slot.name === BUNDLE_OUTPUT_NAME) {
            ensureXPipeV2(outputOwner.node);
            return outputOwner.node.__xpipeV2State || null;
        }
        var inputIndex = passthroughInputIndex(
            outputOwner.node,
            outputOwner.index,
        );
        var input = inputIndex >= 0
            ? outputOwner.node.inputs[inputIndex]
            : null;
        if (input && input.link != null) {
            return resolveBundleStateFromLink(
                outputOwner.node.graph,
                getLinkInfo(outputOwner.node.graph, input.link),
                seen,
            );
        }
    }
    var inputOwner = findSlotOwner(slot, "input", graph);
    if (inputOwner && inputOwner.slot.link != null) {
        return resolveBundleStateFromLink(
            inputOwner.node.graph,
            getLinkInfo(inputOwner.node.graph, inputOwner.slot.link),
            seen,
        );
    }
    var ids = slotLinkIds(slot);
    for (var index = 0; index < ids.length; index++) {
        var found = findLinkInGraphTree(ids[index], graph);
        if (!found) continue;
        var state = resolveBundleStateFromLink(
            found.graph,
            found.link,
            seen,
        );
        if (state) return state;
    }
    return null;
}

function resolveBundleStateFromLink(graph, link, seen) {
    if (!graph || !link) return null;
    var key = graphKey(graph) + ":" + String(link.id != null ? link.id : (
        String(link.origin_id) + ":" + String(link.origin_slot)
            + ">" + String(link.target_id) + ":" + String(link.target_slot)
    ));
    seen = seen || {};
    if (seen[key]) return null;
    seen[key] = true;
    if (typeof link.resolve === "function") {
        try {
            var resolved = link.resolve(graph);
            var resolvedSlots = [
                resolved && resolved.subgraphInput,
                resolved && resolved.subgraphOutput,
                resolved && resolved.output,
            ];
            for (var index = 0; index < resolvedSlots.length; index++) {
                var resolvedState = resolveBundleStateFromSlot(
                    resolvedSlots[index],
                    graph,
                    seen,
                );
                if (resolvedState) return resolvedState;
            }
        } catch (_error) { /* continue with direct resolution */ }
    }
    if (Number(link.origin_id) < 0) {
        var parentNode = findParentSubgraphNode(graph);
        var parentInput = parentNode && parentNode.inputs
            ? parentNode.inputs[link.origin_slot]
            : null;
        if (parentInput && parentInput.link != null) {
            return resolveBundleStateFromLink(
                parentNode.graph,
                getLinkInfo(parentNode.graph, parentInput.link),
                seen,
            );
        }
    }
    var source = getNodeById(graph, link.origin_id);
    var output = source && source.outputs
        ? source.outputs[link.origin_slot]
        : null;
    if (isXPipeV2(source) && output
        && output.name === BUNDLE_OUTPUT_NAME) {
        ensureXPipeV2(source);
        return source.__xpipeV2State || null;
    }
    if (isSubgraphInputNode(source, graph)) {
        var parent = findParentSubgraphNode(graph);
        var inputIndex = findMatchingSlotIndex(
            graph.inputs,
            slotAt(source.outputs, link.origin_slot),
            link.origin_slot,
        );
        var parentInput = parent && parent.inputs
            ? parent.inputs[inputIndex]
            : null;
        if (parentInput && parentInput.link != null) {
            return resolveBundleStateFromLink(
                parent.graph,
                getLinkInfo(parent.graph, parentInput.link),
                seen,
            );
        }
    }
    if (source && source.subgraph) {
        var childGraph = source.subgraph;
        var childOutputIndex = findMatchingSlotIndex(
            childGraph.outputs,
            slotAt(source.outputs, link.origin_slot),
            link.origin_slot,
        );
        var outputNode = findSubgraphOutputNode(childGraph);
        var outputInputIndex = findMatchingSlotIndex(
            outputNode && outputNode.inputs,
            slotAt(childGraph.outputs, childOutputIndex),
            childOutputIndex,
        );
        var boundarySlot = slotAt(childGraph.outputs, childOutputIndex);
        var boundaryLinks = slotLinkIds(boundarySlot);
        for (var boundaryIndex = 0;
            boundaryIndex < boundaryLinks.length;
            boundaryIndex++) {
            var found = findLinkInGraphTree(
                boundaryLinks[boundaryIndex],
                childGraph,
            );
            if (!found) continue;
            var boundaryState = resolveBundleStateFromLink(
                found.graph,
                found.link,
                seen,
            );
            if (boundaryState) return boundaryState;
        }
        var innerLink = findLinkToNodeInput(
            childGraph,
            outputNode,
            outputInputIndex,
        );
        if (innerLink) {
            return resolveBundleStateFromLink(childGraph, innerLink, seen);
        }
    }
    var inputIndex = passthroughInputIndex(source, link.origin_slot);
    var input = inputIndex >= 0 && source.inputs
        ? source.inputs[inputIndex]
        : null;
    return input && input.link != null
        ? resolveBundleStateFromLink(
            source.graph,
            getLinkInfo(source.graph, input.link),
            seen,
        )
        : null;
}

function upstreamVisibleCount(node) {
    var state = upstreamBundleState(node);
    return state ? Number(state.visibleCount) || 0 : 0;
}

function syncDynamicSlots(state) {
    var node = state.node;
    normalizeValueInputs(node);
    ensureInputOrder(node);
    var count = Math.max(
        desiredDirectVisibleCount(node),
        upstreamVisibleCount(node),
    );
    count = Math.max(1, Math.min(PIPE_SLOTS, count));
    for (var slot = 1; slot <= count; slot++) {
        if (slotIndexOfName(node.inputs, "value_" + slot) < 0) {
            addValueInput(state, slot);
        }
        if (slotIndexOfName(node.outputs, "value_" + slot) < 0) {
            addValueOutput(state, slot);
        }
    }
    for (var unused = PIPE_SLOTS; unused > count; unused--) {
        removeValueInput(node, unused);
        removeValueOutput(node, unused);
    }
    state.visibleCount = count;
}

function directInputSource(node, slot) {
    var index = slotIndexOfName(node.inputs, "value_" + slot);
    var input = index >= 0 ? node.inputs[index] : null;
    if (!input || input.link == null) return null;
    var link = getLinkInfo(node.graph, input.link);
    var source = link && getNodeById(node.graph, link.origin_id);
    var output = source && source.outputs
        ? source.outputs[link.origin_slot]
        : null;
    return link && source && output
        ? { link: link, source: source, output: output }
        : null;
}

function sourceOutputLabel(sourceInfo) {
    if (!sourceInfo) return "";
    var output = sourceInfo.output;
    if (isXPipeV2(sourceInfo.source)) {
        var slot = valueSlotNumber(output.name);
        var state = sourceInfo.source.__xpipeV2State;
        var name = state && slot ? cleanName(state.names[slot - 1]) : "";
        if (name) return name;
    }
    return cleanName(output.label) || cleanName(output.name);
}

function refreshAutoNames(state) {
    var upstream = upstreamBundleState(state.node);
    var changed = false;
    for (var slot = 1; slot <= PIPE_SLOTS; slot++) {
        if (state.manual[slot - 1]) continue;
        var direct = directInputSource(state.node, slot);
        var next = direct
            ? sourceOutputLabel(direct)
            : cleanName(upstream && upstream.names[slot - 1]);
        if (state.names[slot - 1] !== next) {
            state.names[slot - 1] = next;
            changed = true;
        }
    }
    return changed;
}

function refreshSlotTypes(state) {
    var upstream = upstreamBundleState(state.node);
    var changed = false;
    for (var slot = 1; slot <= PIPE_SLOTS; slot++) {
        var direct = directInputSource(state.node, slot);
        var next = direct
            ? (isXPipeV2(direct.source)
                && direct.output.name === BUNDLE_OUTPUT_NAME
                ? PIPE_TYPE
                : cleanType(direct.output.type) || cleanType(direct.link.type))
            : cleanType(upstream && upstream.types[slot - 1]);
        if (state.types[slot - 1] !== next) {
            state.types[slot - 1] = next;
            changed = true;
        }
    }
    return changed;
}

function updateOutputLinkTypes(node, output, type) {
    var ids = slotLinkIds(output);
    for (var index = 0; index < ids.length; index++) {
        var link = getLinkInfo(node.graph, ids[index]);
        if (link) link.type = type;
    }
}

function applySlotTypes(state) {
    for (var slot = 1; slot <= PIPE_SLOTS; slot++) {
        var inputIndex = slotIndexOfName(state.node.inputs, "value_" + slot);
        if (inputIndex >= 0) state.node.inputs[inputIndex].type = "*";
        var outputIndex = slotIndexOfName(
            state.node.outputs,
            "value_" + slot,
        );
        if (outputIndex < 0) continue;
        var output = state.node.outputs[outputIndex];
        output.type = socketType(state.types[slot - 1]);
        updateOutputLinkTypes(state.node, output, output.type);
    }
}

function formatPortLabel(slot, name) {
    var value = cleanName(name);
    return value ? "[" + slot + "] " + value : "[" + slot + "]";
}

function replaceSlotLabel(slots, index, label) {
    if (!slots || index < 0 || !slots[index]) return;
    slots[index].label = label;
    slots[index].localized_name = label;
}

function syncPortLabels(state) {
    for (var slot = 1; slot <= PIPE_SLOTS; slot++) {
        var inputIndex = slotIndexOfName(state.node.inputs, "value_" + slot);
        if (inputIndex >= 0) {
            replaceSlotLabel(
                state.node.inputs,
                inputIndex,
                formatPortLabel(slot, state.names[slot - 1]),
            );
        }
        var outputIndex = slotIndexOfName(
            state.node.outputs,
            "value_" + slot,
        );
        if (outputIndex >= 0) {
            replaceSlotLabel(state.node.outputs, outputIndex, " ");
        }
    }
}

function visibleValueSlots(node) {
    var visible = {};
    if (!node || !Array.isArray(node.inputs)) return visible;
    for (var index = 0; index < node.inputs.length; index++) {
        var slot = valueSlotNumber(node.inputs[index] && node.inputs[index].name);
        if (slot) visible[slot] = true;
    }
    return visible;
}

function removeNameWidget(node, widget) {
    if (!node || !widget) return;
    if (typeof node.removeWidget === "function") {
        try {
            node.removeWidget(widget);
            return;
        } catch (_error) { /* use legacy fallback */ }
    }
    var index = node.widgets ? node.widgets.indexOf(widget) : -1;
    if (index >= 0) {
        widget.onRemove && widget.onRemove();
        node.widgets.splice(index, 1);
        node._widgetSlotsDirty = true;
    }
}

function ensureNameWidget(state, slot) {
    var widget = findNameWidget(state.node, slot);
    var label = txf("name_label", "Name {slot}", { slot: slot });
    if (!widget) {
        widget = state.node.addWidget(
            "text",
            label,
            state.names[slot - 1] || "",
            function () {
                var value = cleanName(widget.value);
                state.names[slot - 1] = value;
                state.manual[slot - 1] = !!value;
                if (!value) refreshAutoNames(state);
                persistState(state);
                syncNameWidgets(state);
                syncPortLabels(state);
                scheduleGraphRefresh();
            },
            { serialize: false },
        );
        widget.__xpipeV2NameSlot = slot;
        disableWidgetSerialization(widget);
    }
    widget.name = label;
    widget.label = label;
    widget.value = state.names[slot - 1] || "";
    setWidgetTooltip(
        widget,
        txf("name_tooltip", "Set slot {slot} name", { slot: slot }),
    );
    return widget;
}

function syncNameWidgets(state) {
    var visible = visibleValueSlots(state.node);
    if (Array.isArray(state.node.widgets)) {
        for (var index = state.node.widgets.length - 1; index >= 0; index--) {
            var existing = state.node.widgets[index];
            var slot = existing && existing.__xpipeV2NameSlot;
            if (slot && !visible[slot]) removeNameWidget(state.node, existing);
        }
    }
    for (var slot = 1; slot <= PIPE_SLOTS; slot++) {
        if (visible[slot]) ensureNameWidget(state, slot);
    }
    sortXPipeV2Widgets(state.node);
}

function saveNamesWidget(state) {
    var widget = findWidget(state.node, NAMES_WIDGET);
    if (widget) widget.value = JSON.stringify(state.names);
}

function persistState(state) {
    var props = state.node.properties = state.node.properties || {};
    props[NAMES_PROP] = state.names.slice();
    props[MANUAL_PROP] = state.manual.slice();
    props[TYPES_PROP] = state.types.slice();
    saveNamesWidget(state);
}

function loadNames(node) {
    var saved = node.properties && node.properties[NAMES_PROP];
    if (Array.isArray(saved)) {
        return padArray(saved.map(function (item) {
            return item == null ? "" : String(item);
        }), PIPE_SLOTS, "");
    }
    var widget = findWidget(node, NAMES_WIDGET);
    try {
        var parsed = JSON.parse(widget && widget.value || "[]");
        if (Array.isArray(parsed)) {
            return padArray(parsed.map(function (item) {
                return item == null ? "" : String(item);
            }), PIPE_SLOTS, "");
        }
    } catch (_error) { /* use empty state */ }
    return padArray([], PIPE_SLOTS, "");
}

function createState(node) {
    if (node.__xpipeV2State) return node.__xpipeV2State;
    node.properties = node.properties || {};
    var state = {
        node: node,
        slotDefs: captureSlotDefs(node),
        names: loadNames(node),
        manual: padArray(
            node.properties[MANUAL_PROP],
            PIPE_SLOTS,
            false,
        ).map(Boolean),
        types: padArray(
            node.properties[TYPES_PROP],
            PIPE_SLOTS,
            "",
        ).map(cleanType),
        visibleCount: 1,
    };
    node.__xpipeV2State = state;
    hideBackingWidget(findWidget(node, NAMES_WIDGET));
    return state;
}

function removeBackingInputSlot(node) {
    if (!node || !Array.isArray(node.inputs)) return;
    node.inputs = node.inputs.filter(function (input) {
        return String(input && input.name || "") !== NAMES_WIDGET;
    });
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
    var computedWidth = Number(computed && computed[0]) || 0;
    var computedHeight = Number(computed && computed[1]) || 0;
    var width = computedWidth || Number(current[0]) || 0;
    var height = computedHeight || Number(current[1]) || 0;
    return [
        Math.max(1, Math.ceil(width + INITIAL_WIDTH_EXTRA)),
        Math.max(1, Math.ceil(height)),
    ];
}

function applyInitialNodeSize(node) {
    if (!node || node.__xpipeV2InitialSizeApplied) return;
    var size = resolveInitialNodeSize(node);
    if (!size) return;
    node.min_size = size.slice();
    if (typeof node.setSize === "function") node.setSize(size.slice());
    else node.size = size.slice();
    node.__xpipeV2InitialSizeApplied = true;
    node.setDirtyCanvas && node.setDirtyCanvas(true, true);
}

function stateSignature(state) {
    return JSON.stringify({
        inputCount: state.node.inputs ? state.node.inputs.length : 0,
        names: state.names,
        outputCount: state.node.outputs ? state.node.outputs.length : 0,
        types: state.types,
        visibleCount: state.visibleCount,
    });
}

function syncNode(state) {
    var before = stateSignature(state);
    syncDynamicSlots(state);
    refreshAutoNames(state);
    refreshSlotTypes(state);
    applySlotTypes(state);
    syncPortLabels(state);
    removeBackingInputSlot(state.node);
    syncNameWidgets(state);
    persistState(state);
    refreshNodeLayout(state.node);
    applyInitialNodeSize(state.node);
    return before !== stateSignature(state);
}

function ensureXPipeV2(node) {
    if (!isXPipeV2(node)) return null;
    ensureControlWidgets(node);
    var state = createState(node);
    hideBackingWidget(findWidget(node, NAMES_WIDGET));
    return state;
}

function refreshAllXPipeV2() {
    var nodes = [];
    forEachXPipeV2(app.graph, function (node) {
        nodes.push(node);
        ensureXPipeV2(node);
    });
    var maxPasses = Math.max(1, nodes.length + 1);
    for (var pass = 0; pass < maxPasses; pass++) {
        var changed = false;
        for (var index = 0; index < nodes.length; index++) {
            if (nodes[index].__xpipeV2State) {
                changed = syncNode(nodes[index].__xpipeV2State) || changed;
            }
        }
        if (!changed) break;
    }
}

function scheduleGraphRefresh() {
    if (graphRefreshTimer != null) return;
    graphRefreshTimer = setTimeout(function () {
        graphRefreshTimer = null;
        try { refreshAllXPipeV2(); } catch (_error) { /* ignore */ }
    }, 0);
}

function refreshPortStatus(node) {
    var state = ensureXPipeV2(node);
    if (!state) return;
    refreshAutoNames(state);
    refreshSlotTypes(state);
    syncNode(state);
    scheduleGraphRefresh();
}

function isHiddenBundleLink(link, graph) {
    if (!link) return false;
    var source = getNodeById(graph, link.origin_id);
    var target = getNodeById(graph, link.target_id);
    var output = source && source.outputs
        ? source.outputs[link.origin_slot]
        : null;
    var input = target && target.inputs ? target.inputs[link.target_slot] : null;
    if (isXPipeV2(source) && output
        && output.name === BUNDLE_OUTPUT_NAME
        && (hiddenState(source) & HIDE_OUTPUT)) return true;
    return !!(
        isXPipeV2(target)
        && input
        && input.name === BUNDLE_INPUT_NAME
        && (hiddenState(target) & HIDE_INPUT)
    );
}

function isHiddenValueLink(link, graph) {
    if (!link) return false;
    var source = getNodeById(graph, link.origin_id);
    var target = getNodeById(graph, link.target_id);
    var output = source && source.outputs
        ? source.outputs[link.origin_slot]
        : null;
    var input = target && target.inputs ? target.inputs[link.target_slot] : null;
    if (isXPipeV2(source) && valueSlotNumber(output && output.name)
        && (valueHiddenState(source) & HIDE_OUTPUT)) return true;
    return !!(
        isXPipeV2(target)
        && valueSlotNumber(input && input.name)
        && (valueHiddenState(target) & HIDE_INPUT)
    );
}

function linkWarning(link, graph) {
    if (!link) return null;
    var source = getNodeById(graph, link.origin_id);
    if (!isXPipeV2(source) || !source.__xpipeV2State) return null;
    var output = source.outputs && source.outputs[link.origin_slot];
    var slot = valueSlotNumber(output && output.name);
    if (!slot) return null;
    var target = getNodeById(graph, link.target_id);
    var input = target && target.inputs ? target.inputs[link.target_slot] : null;
    var outputType = cleanType(source.__xpipeV2State.types[slot - 1])
        || cleanType(output && output.type);
    var inputType = cleanType(input && input.type);
    if (!outputType || !inputType || !window.LiteGraph) return null;
    if (LiteGraph.isValidConnection(outputType, inputType)) return null;
    var warningWidget = findWidget(source, "type_warning");
    return warningWidget && !warningWidget.value ? null : source;
}

function installCanvasHooks() {
    if (canvasHooked || !app.canvas) {
        if (!app.canvas) setTimeout(installCanvasHooks, 200);
        return;
    }
    canvasHooked = true;
    var originalRenderLink = app.canvas.renderLink;
    app.canvas.renderLink = function (ctx, start, end, link) {
        var graph = this.graph || app.graph;
        if (isHiddenBundleLink(link, graph)
            || isHiddenValueLink(link, graph)) return;
        if (!linkWarning(link, graph)) {
            return originalRenderLink
                && originalRenderLink.apply(this, arguments);
        }
        var args = Array.prototype.slice.call(arguments);
        ctx.save();
        ctx.shadowColor = WARNING_GLOW;
        ctx.shadowBlur = 10;
        args[6] = "#ffffff";
        originalRenderLink && originalRenderLink.apply(this, args);
        ctx.shadowBlur = 0;
        ctx.setLineDash && ctx.setLineDash([8, 5]);
        args[6] = WARNING_COLOR;
        originalRenderLink && originalRenderLink.apply(this, args);
        ctx.restore();
    };
}

app.registerExtension({
    name: "ComfyUI.Xz3r0.XPipeV2",

    async setup() {
        applyUiLocale();
        installLocaleSync();
        installCanvasHooks();
    },

    async afterConfigureGraph() {
        scheduleGraphRefresh();
    },

    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (!nodeType.prototype.__xpipeV2GraphRefreshHooked) {
            nodeType.prototype.__xpipeV2GraphRefreshHooked = true;
            var originalAnyConnections = nodeType.prototype.onConnectionsChange;
            nodeType.prototype.onConnectionsChange = function () {
                var result = originalAnyConnections
                    && originalAnyConnections.apply(this, arguments);
                if (v2NodeCount > 0) scheduleGraphRefresh();
                return result;
            };
        }
        if (String(nodeData.name) !== NODE_CLASS) return;
        var originalCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            originalCreated && originalCreated.apply(this, arguments);
            if (!this.__xpipeV2Counted) {
                this.__xpipeV2Counted = true;
                v2NodeCount++;
            }
            var state = ensureXPipeV2(this);
            if (state) syncNode(state);
        };
        var originalConfigure = nodeType.prototype.onConfigure;
        nodeType.prototype.onConfigure = function () {
            originalConfigure && originalConfigure.apply(this, arguments);
            var state = ensureXPipeV2(this);
            if (!state) return;
            state.names = loadNames(this);
            state.manual = padArray(
                this.properties && this.properties[MANUAL_PROP],
                PIPE_SLOTS,
                false,
            ).map(Boolean);
            state.types = padArray(
                this.properties && this.properties[TYPES_PROP],
                PIPE_SLOTS,
                "",
            ).map(cleanType);
            updateControlWidgets(this);
            scheduleGraphRefresh();
        };
        var originalRemoved = nodeType.prototype.onRemoved;
        nodeType.prototype.onRemoved = function () {
            if (this.__xpipeV2Counted) {
                this.__xpipeV2Counted = false;
                v2NodeCount = Math.max(0, v2NodeCount - 1);
            }
            return originalRemoved && originalRemoved.apply(this, arguments);
        };
    },

    async loadedGraphNode(node) {
        if (!isXPipeV2(node)) return;
        var state = ensureXPipeV2(node);
        if (state) syncNode(state);
        scheduleGraphRefresh();
    },

    nodeCreated(node) {
        if (!isXPipeV2(node)) return;
        if (!node.__xpipeV2Counted) {
            node.__xpipeV2Counted = true;
            v2NodeCount++;
        }
        ensureXPipeV2(node);
    },
});
