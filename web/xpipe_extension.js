import { app } from "../../scripts/app.js";
import {
    applyVisibleSlotWindow,
    fitNodeSizeToVisibleSlots,
    installStableSlotView,
    refreshInputLinkTargets as stableRefreshInputLinkTargets,
    refreshOutputLinkSources as stableRefreshOutputLinkSources,
    setSlotHidden,
} from "./x_stable_slots.js";
import {
    findLinkInGraphTree as sgFindLinkInGraphTree,
    findLinkToNodeInput,
    findMatchingSlotIndex,
    findParentSubgraphNode as sgFindParentSubgraphNode,
    findSlotOwner as sgFindSlotOwner,
    findSubgraphOutputNode,
    forEachNodeByComfyClass,
    getLinkInfo,
    getNodeById,
    graphKey,
    isSubgraphInputNode,
    slotAt,
} from "./x_subgraph_utils.js";

var NODE_CLASS = "XPipe";
var PIPE_TYPE = "xpipe";
var PIPE_SLOTS = 50;
var HIDE_NONE = 0;
var HIDE_INPUT = 1;
var HIDE_OUTPUT = 2;
var HIDE_BOTH = 3;
var BUNDLE_INPUT_NAME = "xpipe_in";
var BUNDLE_OUTPUT_NAME = "xpipe_out";
var PIPE_GATE_CLASS = "XPipeGate";
var LIST_TO_PIPE_CLASS = "XListToPipe";
var LIST_CREATE_CLASS = "XListCreate";
var LIST_RESTORE_CLASS = "XListRestore";
var NAMES_WIDGET = "port_names";
var HIDE_STATE_PROP = "xpipe_hide_links_state";
var VALUE_HIDE_STATE_PROP = "xpipe_hide_value_links_state";
var NAMES_PROP = "xpipe_names";
var MANUAL_PROP = "xpipe_manual";
var TYPES_PROP = "xpipe_types";
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
var CANVAS_HOOK_RETRY_MS = 200;
var CANVAS_HOOK_MAX_RETRIES = 50;
var hookedCanvas = null;
var canvasHookRetries = 0;
var linkRenderCache = new WeakMap();
var graphRefreshTimer = null;
var xpipeNodeCount = 0;
var metadataListeners = [];

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

// Thin wrappers keep call sites stable; rootGraph defaults to app.graph.
function findParentSubgraphNode(childGraph) {
    return sgFindParentSubgraphNode(childGraph, app.graph);
}

function findLinkInGraphTree(linkId, preferredGraph) {
    return sgFindLinkInGraphTree(linkId, preferredGraph, app.graph);
}

function findSlotOwner(slot, direction, preferredGraph) {
    return sgFindSlotOwner(slot, direction, preferredGraph, app.graph);
}

function isXPipe(node) {
    return !!(
        node
        && String(node.comfyClass || node.type || "") === NODE_CLASS
    );
}

function isXPipeGate(node) {
    return !!(
        node
        && String(node.comfyClass || node.type || "") === PIPE_GATE_CLASS
    );
}

function isXListToPipe(node) {
    return !!(
        node
        && String(node.comfyClass || node.type || "") === LIST_TO_PIPE_CLASS
    );
}

function isXListCreate(node) {
    return !!(
        node
        && String(node.comfyClass || node.type || "") === LIST_CREATE_CLASS
    );
}

function isXListRestore(node) {
    return !!(
        node
        && String(node.comfyClass || node.type || "") === LIST_RESTORE_CLASS
    );
}


function isXpipeFamily(node) {
    return isXPipe(node)
        || isXPipeGate(node)
        || isXListToPipe(node)
        || isXListCreate(node)
        || isXListRestore(node);
}

function linkTouchesXpipeFamily(node, link) {
    if (isXpipeFamily(node)) return true;
    if (!link) return false;
    var graph = node.graph || app.graph;
    return isXpipeFamily(getNodeById(graph, link.origin_id))
        || isXpipeFamily(getNodeById(graph, link.target_id));
}

function findWidgetByName(node, name) {
    if (!node || !Array.isArray(node.widgets)) return null;
    for (var index = 0; index < node.widgets.length; index++) {
        if (node.widgets[index] && node.widgets[index].name === name) {
            return node.widgets[index];
        }
    }
    return null;
}

function findInputByName(node, name) {
    if (!node || !Array.isArray(node.inputs)) return null;
    for (var index = 0; index < node.inputs.length; index++) {
        if (node.inputs[index] && node.inputs[index].name === name) {
            return node.inputs[index];
        }
    }
    return null;
}

function countXListCreateActiveInputs(node) {
    if (!node || !Array.isArray(node.inputs)) return 0;
    var count = 0;
    for (var index = 0; index < node.inputs.length; index++) {
        var input = node.inputs[index];
        if (!input || input.link == null) continue;
        var name = String(input.name || "");
        if (/(?:^|[._])input\d+$/.test(name)) {
            count += 1;
        }
    }
    return Math.max(0, Math.min(PIPE_SLOTS, count));
}

function resolveXListToPipeCount(node) {
    // Same priority as XListPull: connected count port first, else widget.
    var countInput = findInputByName(node, "count");
    if (countInput && countInput.link != null && node.graph) {
        var link = getLinkInfo(node.graph, countInput.link);
        var source = link && getNodeById(node.graph, link.origin_id);
        if (isXListCreate(source)) {
            var listCount = countXListCreateActiveInputs(source);
            if (listCount > 0) {
                return Math.max(1, Math.min(PIPE_SLOTS, listCount));
            }
        }
        if (isXListRestore(source)) {
            // Restore.count = slot_map.width; resolve via Create inputs.
            var slotMapInput = findInputByName(source, "slot_map");
            if (slotMapInput && slotMapInput.link != null) {
                var mapLink = getLinkInfo(source.graph, slotMapInput.link);
                var mapSource =
                    mapLink && getNodeById(source.graph, mapLink.origin_id);
                if (isXListCreate(mapSource)) {
                    var restoreWidth = countXListCreateActiveInputs(mapSource);
                    if (restoreWidth > 0) {
                        return Math.max(
                            1,
                            Math.min(PIPE_SLOTS, restoreWidth),
                        );
                    }
                }
            }
        }
        // Other INT sources fall back to widget until execute.
    }
    var widget = findWidgetByName(node, "count_display");
    if (widget && widget.value != null) {
        return Math.max(
            1,
            Math.min(PIPE_SLOTS, Math.round(Number(widget.value)) || 1),
        );
    }
    return 1;
}

function resolveXListToPipeElementType(node) {
    // List is homogeneous: one element type applies to every expanded slot.
    var listInput = findInputByName(node, "list_input");
    if (!listInput || listInput.link == null || !node.graph) return "";
    var link = getLinkInfo(node.graph, listInput.link);
    if (!link) return "";
    var source = getNodeById(node.graph, link.origin_id);
    var output = source && source.outputs
        ? source.outputs[link.origin_slot]
        : null;
    return cleanType(output && output.type)
        || cleanType(link.type)
        || "";
}

function ensureXListToPipeState(node) {
    if (!isXListToPipe(node)) return null;
    // filledCount = actual list width; types only cover those slots.
    var filledCount = resolveXListToPipeCount(node);
    var elementType = resolveXListToPipeElementType(node);
    var types = padArray([], PIPE_SLOTS, "");
    for (var index = 0; index < filledCount; index++) {
        types[index] = elementType;
    }
    // Match desiredDirectVisibleCount: keep one empty spare so XPipe /
    // XPipeGate can still grow past the list width.
    var visibleCount = Math.min(
        PIPE_SLOTS,
        filledCount + (filledCount < PIPE_SLOTS ? 1 : 0),
    );
    var state = {
        node: node,
        names: padArray([], PIPE_SLOTS, ""),
        types: types,
        visibleCount: visibleCount,
    };
    node.__xlistToPipeState = state;
    return state;
}

function forEachXPipe(rootGraph, visitor) {
    forEachNodeByComfyClass(rootGraph, NODE_CLASS, function (node) {
        if (typeof visitor === "function") visitor(node);
    });
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
    return t("xdatahub.ui.node.xpipe." + suffix, fallback);
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
            forEachXPipe(app.graph, function (node) {
                updateControlWidgets(node);
                if (node.__xpipeState) {
                    syncNameWidgets(node.__xpipeState);
                    refreshNodeLayout(node);
                    applyInitialNodeSize(node);
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
        if (widget && widget.__xpipeControl === role) return widget;
    }
    return null;
}

function findNameWidget(node, slot) {
    if (!node || !Array.isArray(node.widgets)) return null;
    for (var index = 0; index < node.widgets.length; index++) {
        var widget = node.widgets[index];
        if (widget && widget.__xpipeNameSlot === slot) return widget;
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
    invalidateLinkRenderCache();
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
    invalidateLinkRenderCache();
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
        bundle.__xpipeControl = CONTROL_BUNDLE;
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
        value.__xpipeControl = CONTROL_VALUE;
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
        refresh.__xpipeControl = CONTROL_REFRESH;
        disableWidgetSerialization(refresh);
    }
    updateControlWidgets(node);
    sortXPipeWidgets(node);
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
            tx("control_links_tooltip", "Set XPipe bundle visibility"),
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
            tx("control_ports_tooltip", "Set slot link visibility"),
        );
    }
    var refresh = findControlWidget(node, CONTROL_REFRESH);
    if (refresh) {
        refresh.name = tx("control_refresh", "Refresh");
        refresh.label = refresh.name;
        setWidgetTooltip(
            refresh,
            tx("control_refresh_tooltip", "Refresh names and types"),
        );
    }
}

function sortXPipeWidgets(node) {
    if (!node || !Array.isArray(node.widgets)) return;
    var base = [];
    var controls = {};
    var names = [];
    for (var index = 0; index < node.widgets.length; index++) {
        var widget = node.widgets[index];
        if (widget && widget.__xpipeControl) {
            controls[widget.__xpipeControl] = widget;
        } else if (widget && widget.__xpipeNameSlot) {
            names.push(widget);
        } else {
            base.push(widget);
        }
    }
    names.sort(function (left, right) {
        return left.__xpipeNameSlot - right.__xpipeNameSlot;
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
    stableRefreshInputLinkTargets(node, getLinkInfo);
}

function refreshOutputLinkSources(node) {
    stableRefreshOutputLinkSources(node, getLinkInfo);
}

function ensureInputOrder(node) {
    if (!node || !Array.isArray(node.inputs)) return;
    var channels = [];
    var bundle = null;
    var others = [];
    for (var index = 0; index < node.inputs.length; index++) {
        var input = node.inputs[index];
        if (input && input.name === BUNDLE_INPUT_NAME) bundle = input;
        else if (valueSlotNumber(input && input.name)) channels.push(input);
        else others.push(input);
    }
    channels.sort(function (left, right) {
        return valueSlotNumber(left.name) - valueSlotNumber(right.name);
    });
    var ordered = bundle ? [bundle] : [];
    ordered = ordered.concat(channels, others);
    var changed = ordered.length !== node.inputs.length;
    if (!changed) {
        for (var other = 0; other < ordered.length; other++) {
            if (ordered[other] !== node.inputs[other]) {
                changed = true;
                break;
            }
        }
    }
    if (!changed) return;
    node.inputs.splice.apply(
        node.inputs,
        [0, node.inputs.length].concat(ordered),
    );
    refreshInputLinkTargets(node);
}

function ensureOutputOrder(node) {
    if (!node || !Array.isArray(node.outputs)) return;
    var channels = [];
    var bundle = null;
    var others = [];
    for (var index = 0; index < node.outputs.length; index++) {
        var output = node.outputs[index];
        if (output && output.name === BUNDLE_OUTPUT_NAME) bundle = output;
        else if (valueSlotNumber(output && output.name)) channels.push(output);
        else others.push(output);
    }
    channels.sort(function (left, right) {
        return valueSlotNumber(left.name) - valueSlotNumber(right.name);
    });
    var ordered = bundle ? [bundle] : [];
    ordered = ordered.concat(channels, others);
    var changed = ordered.length !== node.outputs.length;
    if (!changed) {
        for (var other = 0; other < ordered.length; other++) {
            if (ordered[other] !== node.outputs[other]) {
                changed = true;
                break;
            }
        }
    }
    if (!changed) return;
    node.outputs.splice.apply(
        node.outputs,
        [0, node.outputs.length].concat(ordered),
    );
    refreshOutputLinkSources(node);
}

function normalizeValueInputs(node) {
    if (!node || !Array.isArray(node.inputs)) return;
    for (var index = 0; index < node.inputs.length; index++) {
        var input = node.inputs[index];
        var slot = valueSlotNumber(input && input.name);
        if (!slot) continue;
        input.name = "value_" + slot;
        // Apply the default "N" label only when the slot has none yet
        // (fresh slot); never overwrite a port the user has renamed.
        if (!input.display_name) input.display_name = String(slot);
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

function highestConnectedValueSlot(node) {
    var highest = 0;
    if (node && Array.isArray(node.inputs)) {
        for (var index = 0; index < node.inputs.length; index++) {
            var slot = valueSlotNumber(
                node.inputs[index] && node.inputs[index].name,
            );
            if (slot && slotLinkIds(node.inputs[index]).length) {
                highest = Math.max(highest, slot);
            }
        }
    }
    if (node && Array.isArray(node.outputs)) {
        for (var outIndex = 0; outIndex < node.outputs.length; outIndex++) {
            var outSlot = valueSlotNumber(
                node.outputs[outIndex] && node.outputs[outIndex].name,
            );
            if (outSlot && slotLinkIds(node.outputs[outIndex]).length) {
                highest = Math.max(highest, outSlot);
            }
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
    if (isXPipeGate(node) && output.name === BUNDLE_OUTPUT_NAME) {
        var gateInputIndex = slotIndexOfName(
            node.inputs,
            BUNDLE_INPUT_NAME,
        );
        return gateInputIndex >= 0
            && node.inputs[gateInputIndex].link != null
            ? gateInputIndex
            : -1;
    }
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
        if (isXPipe(outputOwner.node)
            && outputOwner.slot.name === BUNDLE_OUTPUT_NAME) {
            ensureXPipe(outputOwner.node);
            return outputOwner.node.__xpipeState || null;
        }
        if (isXPipeGate(outputOwner.node)
            && outputOwner.slot.name === BUNDLE_OUTPUT_NAME
            && outputOwner.node.__xpipeGateState) {
            return outputOwner.node.__xpipeGateState;
        }
        if (isXListToPipe(outputOwner.node)
            && outputOwner.slot.name === BUNDLE_OUTPUT_NAME) {
            return ensureXListToPipeState(outputOwner.node);
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
    if (isXPipe(source) && output
        && output.name === BUNDLE_OUTPUT_NAME) {
        ensureXPipe(source);
        return source.__xpipeState || null;
    }
    if (isXPipeGate(source) && output
        && output.name === BUNDLE_OUTPUT_NAME
        && source.__xpipeGateState) {
        return source.__xpipeGateState;
    }
    if (isXListToPipe(source) && output
        && output.name === BUNDLE_OUTPUT_NAME) {
        return ensureXListToPipeState(source);
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

export function resolveXPipeStateForInput(node, inputName) {
    var index = slotIndexOfName(node && node.inputs, inputName);
    var input = index >= 0 ? node.inputs[index] : null;
    if (!input || input.link == null || !node.graph) return null;
    return resolveBundleStateFromLink(
        node.graph,
        getLinkInfo(node.graph, input.link),
        {},
    );
}

function pipeValueMetadata(node, output) {
    if (!node || !output) return null;
    var slot = valueSlotNumber(output.name);
    var state = node.__xpipeState;
    if (isXPipeGate(node)) {
        var match = /^output_(\d+)$/.exec(output.name || "");
        slot = match ? parseInt(match[1], 10) : 0;
        state = node.__xpipeGateState;
    }
    if (!slot || !state) return null;
    return {
        name: cleanName(state.names[slot - 1]),
        type: cleanType(state.types[slot - 1]),
    };
}

function resolveValueMetadataFromSlot(slot, graph, seen) {
    if (!slot) return null;
    var outputOwner = findSlotOwner(slot, "output", graph);
    if (outputOwner) {
        var metadata = pipeValueMetadata(
            outputOwner.node,
            outputOwner.slot,
        );
        if (metadata) return metadata;
        var inputIndex = passthroughInputIndex(
            outputOwner.node,
            outputOwner.index,
        );
        var input = inputIndex >= 0
            ? outputOwner.node.inputs[inputIndex]
            : null;
        if (input && input.link != null) {
            return resolveValueMetadataFromLink(
                outputOwner.node.graph,
                getLinkInfo(outputOwner.node.graph, input.link),
                seen,
            );
        }
    }
    var inputOwner = findSlotOwner(slot, "input", graph);
    if (inputOwner && inputOwner.slot.link != null) {
        return resolveValueMetadataFromLink(
            inputOwner.node.graph,
            getLinkInfo(inputOwner.node.graph, inputOwner.slot.link),
            seen,
        );
    }
    var ids = slotLinkIds(slot);
    for (var index = 0; index < ids.length; index++) {
        var found = findLinkInGraphTree(ids[index], graph);
        if (!found) continue;
        var linkedMetadata = resolveValueMetadataFromLink(
            found.graph,
            found.link,
            seen,
        );
        if (linkedMetadata) return linkedMetadata;
    }
    return null;
}

function resolveValueMetadataFromLink(graph, link, seen) {
    if (!graph || !link) return null;
    var key = "value:" + graphKey(graph) + ":" + String(
        link.id != null ? link.id : (
            String(link.origin_id) + ":" + String(link.origin_slot)
                + ">" + String(link.target_id) + ":"
                + String(link.target_slot)
        ),
    );
    seen = seen || {};
    if (seen[key]) return null;
    seen[key] = true;
    if (typeof link.resolve === "function") {
        try {
            var resolved = link.resolve(graph);
            var slots = [
                resolved && resolved.output,
                resolved && resolved.subgraphOutput,
                resolved && resolved.subgraphInput,
            ];
            for (var slotIndex = 0; slotIndex < slots.length; slotIndex++) {
                var resolvedMetadata = resolveValueMetadataFromSlot(
                    slots[slotIndex],
                    graph,
                    seen,
                );
                if (resolvedMetadata) return resolvedMetadata;
            }
        } catch (_error) { /* continue with direct source */ }
    }
    if (Number(link.origin_id) < 0) {
        var parentNode = findParentSubgraphNode(graph);
        var parentInput = parentNode && parentNode.inputs
            ? parentNode.inputs[link.origin_slot]
            : null;
        if (parentInput && parentInput.link != null) {
            return resolveValueMetadataFromLink(
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
    var directMetadata = pipeValueMetadata(source, output);
    if (directMetadata) return directMetadata;
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
            return resolveValueMetadataFromLink(
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
            var boundaryMetadata = resolveValueMetadataFromLink(
                found.graph,
                found.link,
                seen,
            );
            if (boundaryMetadata) return boundaryMetadata;
        }
        var innerLink = findLinkToNodeInput(
            childGraph,
            outputNode,
            outputInputIndex,
        );
        if (innerLink) {
            return resolveValueMetadataFromLink(
                childGraph,
                innerLink,
                seen,
            );
        }
    }
    var passthroughIndex = passthroughInputIndex(source, link.origin_slot);
    var passthroughInput = passthroughIndex >= 0 && source.inputs
        ? source.inputs[passthroughIndex]
        : null;
    return passthroughInput && passthroughInput.link != null
        ? resolveValueMetadataFromLink(
            source.graph,
            getLinkInfo(source.graph, passthroughInput.link),
            seen,
        )
        : null;
}

export function resolveXPipeValueMetadataForInput(node, inputName) {
    var index = slotIndexOfName(node && node.inputs, inputName);
    var input = index >= 0 ? node.inputs[index] : null;
    if (!input || input.link == null || !node.graph) return null;
    return resolveValueMetadataFromLink(
        node.graph,
        getLinkInfo(node.graph, input.link),
        {},
    );
}

export function subscribeXPipeMetadata(listener) {
    if (typeof listener !== "function") return;
    if (!metadataListeners.includes(listener)) metadataListeners.push(listener);
}

export function scheduleXPipeRefresh() {
    scheduleGraphRefresh();
}

function upstreamVisibleCount(node) {
    var state = upstreamBundleState(node);
    return state ? Number(state.visibleCount) || 0 : 0;
}

function syncDynamicSlots(state) {
    // Scheme A: keep value_1..50 in the arrays forever. visibleCount only
    // drives layout/draw hiding — never removeInput/removeOutput.
    var node = state.node;
    installStableSlotView(node);
    normalizeValueInputs(node);
    for (var slot = 1; slot <= PIPE_SLOTS; slot++) {
        if (slotIndexOfName(node.inputs, "value_" + slot) < 0) {
            addValueInput(state, slot);
        }
        if (slotIndexOfName(node.outputs, "value_" + slot) < 0) {
            addValueOutput(state, slot);
        }
        var outIndex = slotIndexOfName(node.outputs, "value_" + slot);
        if (outIndex >= 0) node.outputs[outIndex].name = "value_" + slot;
    }
    ensureInputOrder(node);
    ensureOutputOrder(node);
    var count = Math.max(
        desiredDirectVisibleCount(node),
        upstreamVisibleCount(node),
    );
    count = Math.max(1, Math.min(PIPE_SLOTS, count));
    state.visibleCount = count;
    applyVisibleSlotWindow(node.inputs, function (input) {
        return valueSlotNumber(input && input.name);
    }, count);
    applyVisibleSlotWindow(node.outputs, function (output) {
        return valueSlotNumber(output && output.name);
    }, count);
    // Bundle ports stay visible.
    var bundleIn = slotIndexOfName(node.inputs, BUNDLE_INPUT_NAME);
    if (bundleIn >= 0) setSlotHidden(node.inputs[bundleIn], false);
    var bundleOut = slotIndexOfName(node.outputs, BUNDLE_OUTPUT_NAME);
    if (bundleOut >= 0) setSlotHidden(node.outputs[bundleOut], false);
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
    if (isXPipe(sourceInfo.source)) {
        var slot = valueSlotNumber(output.name);
        var state = sourceInfo.source.__xpipeState;
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
            ? (isXPipe(direct.source)
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
    var limit = node.__xpipeState && node.__xpipeState.visibleCount
        ? node.__xpipeState.visibleCount
        : PIPE_SLOTS;
    for (var index = 0; index < node.inputs.length; index++) {
        var input = node.inputs[index];
        var slot = valueSlotNumber(input && input.name);
        if (slot && slot <= limit && !(input && input._xzr0Hidden)) {
            visible[slot] = true;
        }
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
    var label = txf("name_label", "[{slot}] Name", { slot: slot });
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
        widget.__xpipeNameSlot = slot;
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
            var slot = existing && existing.__xpipeNameSlot;
            if (slot && !visible[slot]) removeNameWidget(state.node, existing);
        }
    }
    for (var slot = 1; slot <= PIPE_SLOTS; slot++) {
        if (visible[slot]) ensureNameWidget(state, slot);
    }
    sortXPipeWidgets(state.node);
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
    if (node.__xpipeState) return node.__xpipeState;
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
    node.__xpipeState = state;
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
    var currentWidth = Number(current[0]) || 0;
    // Content height is authoritative (Scheme A hides extras).
    // Width may keep a larger saved/current size.
    var minWidth = Math.max(1, Math.ceil(
        (computedWidth || currentWidth || 1) + INITIAL_WIDTH_EXTRA,
    ));
    var height = Math.max(1, Math.ceil(computedHeight || 1));
    return [
        Math.max(minWidth, currentWidth || minWidth),
        height,
    ];
}

function applyInitialNodeSize(node) {
    if (!node) return;
    // arrange()/_setConcreteSlots() can leave a 50-slot inflated height
    // before Scheme-A visibility windows apply; re-fit to visible content
    // and keep min_size in sync so the node cannot shrink below it.
    var size = fitNodeSizeToVisibleSlots(node, INITIAL_WIDTH_EXTRA)
        || resolveInitialNodeSize(node);
    if (!size) return;
    node.min_size = size.slice();
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
    refreshNodeLayout(state.node);
    // applyInitialNodeSize re-fits to visible content and updates min_size;
    // it is the single computeSize pass per sync.
    applyInitialNodeSize(state.node);
    // Persist only when the synced state actually changed; isolated
    // mutations (name edits, hidden toggles) persist through their own
    // handlers.
    var changed = before !== stateSignature(state);
    if (changed) persistState(state);
    return changed;
}

function ensureXPipe(node) {
    if (!isXPipe(node)) return null;
    installStableSlotView(node);
    ensureControlWidgets(node);
    var state = createState(node);
    hideBackingWidget(findWidget(node, NAMES_WIDGET));
    return state;
}

function refreshAllXPipe() {
    var nodes = [];
    forEachXPipe(app.graph, function (node) {
        nodes.push(node);
        ensureXPipe(node);
    });
    // A constant small pass budget: sync passes only cascade when a bundle
    // type actually propagates, and the loop exits as soon as a pass makes
    // no further change. A per-node budget was quadratic in the worst case.
    var maxPasses = 4;
    for (var pass = 0; pass < maxPasses; pass++) {
        var changed = false;
        for (var index = 0; index < nodes.length; index++) {
            if (nodes[index].__xpipeState) {
                changed = syncNode(nodes[index].__xpipeState) || changed;
            }
        }
        if (!changed) break;
    }
    for (var listenerIndex = 0;
        listenerIndex < metadataListeners.length;
        listenerIndex++) {
        try { metadataListeners[listenerIndex](); } catch (_error) { /* ignore */ }
    }
    // Link render cache depends on XPipe state; drop it after each sync so
    // hidden/warning visuals follow name/type changes immediately.
    invalidateLinkRenderCache();
}

function scheduleGraphRefresh() {
    if (graphRefreshTimer != null) return;
    graphRefreshTimer = setTimeout(function () {
        graphRefreshTimer = null;
        try { refreshAllXPipe(); } catch (_error) { /* ignore */ }
    }, 0);
}

function refreshPortStatus(node) {
    var state = ensureXPipe(node);
    if (!state) return;
    // syncNode refreshes auto names and slot types; the scheduled graph
    // pass propagates bundle metadata to dependent nodes.
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
    if (isXPipe(source) && output
        && output.name === BUNDLE_OUTPUT_NAME
        && (hiddenState(source) & HIDE_OUTPUT)) return true;
    return !!(
        isXPipe(target)
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
    if (isXPipe(source) && valueSlotNumber(output && output.name)
        && (valueHiddenState(source) & HIDE_OUTPUT)) return true;
    return !!(
        isXPipe(target)
        && valueSlotNumber(input && input.name)
        && (valueHiddenState(target) & HIDE_INPUT)
    );
}

function linkWarning(link, graph) {
    if (!link) return null;
    var source = getNodeById(graph, link.origin_id);
    if (!isXPipe(source) || !source.__xpipeState) return null;
    var output = source.outputs && source.outputs[link.origin_slot];
    var slot = valueSlotNumber(output && output.name);
    if (!slot) return null;
    var target = getNodeById(graph, link.target_id);
    var input = target && target.inputs ? target.inputs[link.target_slot] : null;
    var outputType = cleanType(source.__xpipeState.types[slot - 1])
        || cleanType(output && output.type);
    var inputType = cleanType(input && input.type);
    if (!outputType || !inputType || !window.LiteGraph) return null;
    if (LiteGraph.isValidConnection(outputType, inputType)) return null;
    var warningWidget = findWidget(source, "type_warning");
    return warningWidget && !warningWidget.value ? null : source;
}
function cachedLinkRender(link, graph) {
    if (!link) return null;
    var cached = linkRenderCache.get(link);
    if (cached) return cached;
    // Hidden/warning lookups resolve source/target nodes per link; cache the
    // result per link object so the per-frame render hot path only pays a
    // WeakMap get. invalidateLinkRenderCache() drops entries whenever XPipe
    // state or connections change.
    var warningSource = linkWarning(link, graph);
    var origin = warningSource || getNodeById(graph, link.origin_id);
    var warningWidget = origin ? findWidget(origin, "type_warning") : null;
    var entry = {
        bundleHidden: isHiddenBundleLink(link, graph),
        valueHidden: isHiddenValueLink(link, graph),
        warning: !!warningSource,
        warningWidget: warningWidget,
        warningOn: !warningWidget || !!warningWidget.value,
    };
    linkRenderCache.set(link, entry);
    return entry;
}

function invalidateLinkRenderCache() {
    linkRenderCache = new WeakMap();
}

function installCanvasHooks() {
    var canvas = app.canvas;
    if (canvas === hookedCanvas) return;
    if (!canvas) {
        canvasHookRetries++;
        if (canvasHookRetries <= CANVAS_HOOK_MAX_RETRIES) {
            setTimeout(installCanvasHooks, CANVAS_HOOK_RETRY_MS);
        } else {
            console.warn("[XPipe] canvas not available; renderLink hooks not installed");
        }
        return;
    }
    canvasHookRetries = 0;
    hookedCanvas = canvas;
    var originalRenderLink = canvas.renderLink;
    if (typeof originalRenderLink !== "function") {
        console.warn("[XPipe] canvas.renderLink missing; link hiding/warning disabled");
        return;
    }
    // litegraph 新旧版 renderLink 的 color 参数位置不同：新版在 args[6]
    // （skipBorder、flow 之后），旧版在 args[5]。按函数声明的参数个数
    // 一次性判定，避免硬编码索引在新旧版本间静默失效。
    var colorIndex = originalRenderLink.length >= 7 ? 6 : 5;
    canvas.renderLink = function (ctx, start, end, link) {
        var graph = this.graph || app.graph;
        var entry = cachedLinkRender(link, graph);
        if (!entry) return originalRenderLink.apply(this, arguments);
        if (entry.bundleHidden || entry.valueHidden) return;
        // type_warning 开关是唯一不经刷新同步的渲染输入：widget 引用已
        // 缓存，每帧只做一次布尔比对；开关翻转时重算 warning（linkWarning
        // 的结果也随开关启停）。
        if (entry.warningWidget
            && !!entry.warningWidget.value !== entry.warningOn) {
            entry.warningOn = !!entry.warningWidget.value;
            entry.warning = !!linkWarning(link, graph);
        }
        if (!entry.warning || !entry.warningOn) {
            return originalRenderLink.apply(this, arguments);
        }
        var args = Array.prototype.slice.call(arguments);
        ctx.save();
        ctx.shadowColor = WARNING_GLOW;
        ctx.shadowBlur = 10;
        args[colorIndex] = "#ffffff";
        originalRenderLink.apply(this, args);
        ctx.shadowBlur = 0;
        ctx.setLineDash && ctx.setLineDash([8, 5]);
        args[colorIndex] = WARNING_COLOR;
        originalRenderLink.apply(this, args);
        ctx.restore();
    };
}

app.registerExtension({
    name: "ComfyUI.Xz3r0.XPipe",

    async setup() {
        applyUiLocale();
        installLocaleSync();
        installCanvasHooks();
    },

    async afterConfigureGraph() {
        // Undo/redo and workflow loads rebuild nodes through configure,
        // which can bypass the incremental onNodeCreated/onRemoved count;
        // rebuild the count from the graph so the gate stays accurate.
        xpipeNodeCount = 0;
        forEachXPipe(app.graph, function (node) {
            node.__xpipeCounted = true;
            xpipeNodeCount++;
        });
        scheduleGraphRefresh();
    },

    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (!nodeType.prototype.__xpipeGraphRefreshHooked) {
            nodeType.prototype.__xpipeGraphRefreshHooked = true;
            var originalAnyConnections = nodeType.prototype.onConnectionsChange;
            nodeType.prototype.onConnectionsChange = function (
                type,
                slotIndex,
                isConnected,
                link,
            ) {
                var result = originalAnyConnections
                    && originalAnyConnections.apply(this, arguments);
                // Only schedule when the change involves an XPipe-family
                // node; unrelated canvas edits must not trigger a full
                // graph refresh.
                if (
                    xpipeNodeCount > 0
                    && linkTouchesXpipeFamily(this, link)
                ) {
                    scheduleGraphRefresh();
                }
                return result;
            };
        }
        if (String(nodeData.name) !== NODE_CLASS) return;
        var originalCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            originalCreated && originalCreated.apply(this, arguments);
            if (!this.__xpipeCounted) {
                this.__xpipeCounted = true;
                xpipeNodeCount++;
            }
            try {
                var state = ensureXPipe(this);
                if (state) syncNode(state);
            } catch (_error) { /* keep ComfyUI node creation flow intact */ }
        };
        var originalConfigure = nodeType.prototype.onConfigure;
        nodeType.prototype.onConfigure = function () {
            originalConfigure && originalConfigure.apply(this, arguments);
            // Undo/redo and workflow loads restore nodes through configure
            // instead of onNodeCreated; count them here too.
            if (!this.__xpipeCounted) {
                this.__xpipeCounted = true;
                xpipeNodeCount++;
            }
            var state = ensureXPipe(this);
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
            if (this.__xpipeCounted) {
                this.__xpipeCounted = false;
                xpipeNodeCount = Math.max(0, xpipeNodeCount - 1);
            }
            return originalRemoved && originalRemoved.apply(this, arguments);
        };
    },

    async loadedGraphNode(node) {
        if (!isXPipe(node)) return;
        try {
            var state = ensureXPipe(node);
            if (state) syncNode(state);
        } catch (_error) { /* keep graph loading flow intact */ }
        scheduleGraphRefresh();
    },

    nodeCreated(node) {
        if (!isXPipe(node)) return;
        if (!node.__xpipeCounted) {
            node.__xpipeCounted = true;
            xpipeNodeCount++;
        }
        try { ensureXPipe(node); } catch (_error) { /* keep node creation flow intact */ }
    },
});
