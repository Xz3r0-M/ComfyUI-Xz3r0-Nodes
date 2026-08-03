import { app } from "../../scripts/app.js";
import {
    resolveXPipeStateForInput,
    resolveXPipeValueMetadataForInput,
    scheduleXPipeRefresh,
    subscribeXPipeMetadata,
} from "./xpipe_extension.js";
import {
    applyVisibleSlotWindow,
    fitNodeSizeToVisibleSlots,
    installStableSlotView,
    refreshInputLinkTargets as stableRefreshInputLinkTargets,
    refreshOutputLinkSources as stableRefreshOutputLinkSources,
    setSlotHidden,
} from "./x_stable_slots.js";
import {
    forEachNodeByComfyClass,
    getLinkInfo,
    getNodeById,
} from "./x_subgraph_utils.js";

var NODE_CLASS = "XPipeGate";
var XPIPE_CLASS = "XPipe";
var GATE_SLOTS = 50;
var HIDE_NONE = 0;
var HIDE_INPUT = 1;
var HIDE_OUTPUT = 2;
var HIDE_BOTH = 3;
var BUNDLE_INPUT = "xpipe_in";
var BUNDLE_OUTPUT = "xpipe_out";
var NAMES_WIDGET = "port_names";
var HIDE_STATE_PROP = "xpipe_gate_hide_links_state";
var VALUE_HIDE_STATE_PROP = "xpipe_gate_hide_value_links_state";
var TYPES_PROP = "xpipe_gate_types";
var ENABLES_PROP = "xpipe_gate_enables";
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

function isXPipeGate(node) {
    return !!(
        node
        && String(node.comfyClass || node.type || "") === NODE_CLASS
    );
}

function isXPipe(node) {
    return !!(
        node
        && String(node.comfyClass || node.type || "") === XPIPE_CLASS
    );
}

function isGateFamily(node) {
    return isXPipeGate(node) || isXPipe(node);
}

function linkTouchesGateFamily(node, link) {
    if (isGateFamily(node)) return true;
    if (!link) return false;
    var graph = node.graph || app.graph;
    return isGateFamily(getNodeById(graph, link.origin_id))
        || isGateFamily(getNodeById(graph, link.target_id));
}

function forEachPipeGate(rootGraph, visitor) {
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
    return t("xdatahub.ui.node.xpipe_gate." + suffix, fallback);
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
            forEachPipeGate(app.graph, function (node) {
                updateControlWidgets(node);
                refreshNodeLayout(node);
                applyInitialNodeSize(node);
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
    stableRefreshInputLinkTargets(node, getLinkInfo);
}

function refreshOutputLinkSources(node) {
    stableRefreshOutputLinkSources(node, getLinkInfo);
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
    return resolveXPipeStateForInput(node, BUNDLE_INPUT);
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

function findControlWidget(node, role) {
    if (!node || !Array.isArray(node.widgets)) return null;
    for (var index = 0; index < node.widgets.length; index++) {
        var widget = node.widgets[index];
        if (widget && widget.__xpipeGateControl === role) return widget;
    }
    return null;
}

function setWidgetTooltip(widget, tooltip) {
    if (!widget) return;
    widget.tooltip = tooltip;
    widget.options = widget.options || {};
    widget.options.tooltip = tooltip;
}

function disableWidgetPromptSerialization(widget) {
    if (!widget) return;
    // Keep workflow serialization enabled. LiteGraph writes widgets_values by
    // original index but restores sequentially, so serialize:false holes in
    // the middle scramble later enable_* values on every reload.
    widget.serialize = true;
    widget.options = widget.options || {};
    widget.options.serialize = false;
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
                // workflow-serializable; only exclude from API prompt
            },
        );
        bundle.__xpipeGateControl = CONTROL_BUNDLE;
        disableWidgetPromptSerialization(bundle);
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
                // workflow-serializable; only exclude from API prompt
            },
        );
        value.__xpipeGateControl = CONTROL_VALUE;
        disableWidgetPromptSerialization(value);
    }
    var refresh = findControlWidget(node, CONTROL_REFRESH);
    if (!refresh) {
        refresh = node.addWidget(
            "button",
            tx("control_refresh", "Refresh"),
            "refresh",
            function () { refreshPortStatus(node); },
        );
        refresh.__xpipeGateControl = CONTROL_REFRESH;
        disableWidgetPromptSerialization(refresh);
    }
    updateControlWidgets(node);
    sortGateWidgets(node);
}

function updateControlWidgets(node) {
    var bundle = findControlWidget(node, CONTROL_BUNDLE);
    if (bundle) {
        bundle.name = tx("control_links", "Links");
        bundle.label = bundle.name;
        bundle.value = String(hiddenState(node));
        bundle.options = bundle.options || {};
        bundle.options.values = CONTROL_VALUES;
        bundle.options.getOptionLabel = visibilityLabel;
        setWidgetTooltip(
            bundle,
            tx(
                "control_links_tooltip",
                "Set XPipeGate bundle link visibility",
            ),
        );
    }
    var value = findControlWidget(node, CONTROL_VALUE);
    if (value) {
        value.name = tx("control_ports", "Ports");
        value.label = value.name;
        value.value = String(valueHiddenState(node));
        value.options = value.options || {};
        value.options.values = CONTROL_VALUES;
        value.options.getOptionLabel = visibilityLabel;
        setWidgetTooltip(
            value,
            tx(
                "control_ports_tooltip",
                "Set XPipeGate channel link visibility",
            ),
        );
    }
    var refresh = findControlWidget(node, CONTROL_REFRESH);
    if (refresh) {
        refresh.name = tx("control_refresh", "Refresh");
        refresh.label = refresh.name;
        setWidgetTooltip(
            refresh,
            tx(
                "control_refresh_tooltip",
                "Refresh channel names and data types",
            ),
        );
    }
}

function sortGateWidgets(node) {
    if (!node || !Array.isArray(node.widgets)) return;
    var base = [];
    var controls = {};
    var enables = [];
    for (var index = 0; index < node.widgets.length; index++) {
        var widget = node.widgets[index];
        if (widget && widget.__xpipeGateControl) {
            controls[widget.__xpipeGateControl] = widget;
        } else if (widget && channelEnableNumber(widget.name)) {
            enables.push(widget);
        } else {
            base.push(widget);
        }
    }
    enables.sort(function (left, right) {
        return channelEnableNumber(left.name)
            - channelEnableNumber(right.name);
    });
    var ordered = base;
    [CONTROL_BUNDLE, CONTROL_VALUE, CONTROL_REFRESH].forEach(
        function (role) {
            if (controls[role]) ordered.push(controls[role]);
        },
    );
    ordered = ordered.concat(enables);
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
    // Scheme A: keep input_/output_/enable_ 1..50 forever; visibleCount only
    // hides extras in layout/draw and enable widgets.
    installStableSlotView(state.node);
    var count = desiredVisibleCount(state);
    for (var channel = 1; channel <= GATE_SLOTS; channel++) {
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
        var outIndex = slotIndexByName(
            state.node.outputs,
            "output_" + channel,
        );
        if (outIndex >= 0) {
            state.node.outputs[outIndex].name = "output_" + channel;
        }
    }
    state.visibleCount = count;
    sortChannelInputs(state.node);
    sortChannelOutputs(state.node);
    applyVisibleSlotWindow(state.node.inputs, function (input) {
        return channelInputNumber(input && input.name);
    }, count);
    applyVisibleSlotWindow(state.node.outputs, function (output) {
        return channelOutputNumber(output && output.name);
    }, count);
    // enable_* inputs are widget-backed; keep them out of the vertical pack
    // via their widget association, and hide switches past visibleCount.
    for (var enableCh = 1; enableCh <= GATE_SLOTS; enableCh++) {
        var enableIndex = slotIndexByName(
            state.node.inputs,
            "enable_" + enableCh,
        );
        if (enableIndex >= 0) {
            // Never use channel hide pos on widget slots; clear flag only.
            setSlotHidden(state.node.inputs[enableIndex], false);
        }
    }
    var bundleIn = slotIndexByName(state.node.inputs, BUNDLE_INPUT);
    if (bundleIn >= 0) setSlotHidden(state.node.inputs[bundleIn], false);
    var bundleOut = slotIndexByName(state.node.outputs, BUNDLE_OUTPUT);
    if (bundleOut >= 0) setSlotHidden(state.node.outputs[bundleOut], false);
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
    var metadata = resolveXPipeValueMetadataForInput(
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
        direct.source.__xpipeState
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
        // Match XPipe: hide output name labels.
        replaceSlotLabel(
            state.node.outputs,
            slotIndexByName(state.node.outputs, "output_" + channel),
            " ",
        );
    }
    syncSwitchLabels(state);
}

function syncSwitchLabels(state) {
    if (!state || !state.node) return;
    for (var channel = 1; channel <= GATE_SLOTS; channel++) {
        var widget = findWidget(state.node, "enable_" + channel);
        if (!widget) continue;
        // Keep name=enable_N for serialize/lookup; only label tracks port name.
        var label = formatPortLabel(channel, state.names[channel - 1]);
        widget.label = label;
        if (widget.options) widget.options.label = label;
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

function normalizeEnableValue(value) {
    if (value === false || value === 0 || value === "0" || value === "false") {
        return false;
    }
    if (value === true || value === 1 || value === "1" || value === "true") {
        return true;
    }
    // null/undefined from sparse widgets_values holes must not force-disable.
    return true;
}

function normalizeEnableArray(values) {
    return padArray(values, GATE_SLOTS, true).map(normalizeEnableValue);
}

function readEnableStates(node) {
    var result = [];
    for (var channel = 1; channel <= GATE_SLOTS; channel++) {
        var widget = findWidget(node, "enable_" + channel);
        result.push(normalizeEnableValue(widget && widget.value));
    }
    return result;
}

function applyEnableStates(node, enables) {
    if (!node) return;
    var values = normalizeEnableArray(enables);
    for (var channel = 1; channel <= GATE_SLOTS; channel++) {
        var widget = findWidget(node, "enable_" + channel);
        if (widget) widget.value = values[channel - 1];
    }
}

function recoverEnablesFromWidgetsValues(values) {
    if (!Array.isArray(values)) return null;
    var bools = [];
    for (var index = 0; index < values.length; index++) {
        var value = values[index];
        if (value === true || value === false) bools.push(value);
    }
    // First boolean is type_warning; remaining values are enable_* switches.
    if (bools.length < 2) return null;
    return padArray(bools.slice(1), GATE_SLOTS, true);
}

function loadEnableStates(node, info) {
    // Prefer the values that actually arrived with the serialized node.
    // onNodeCreated may have written temporary defaults into node.properties
    // before configure runs, so do not trust live properties alone on load.
    var fromInfo = info
        && info.properties
        && info.properties[ENABLES_PROP];
    if (Array.isArray(fromInfo) && fromInfo.length) {
        return normalizeEnableArray(fromInfo);
    }
    var recovered = recoverEnablesFromWidgetsValues(
        info && info.widgets_values,
    );
    if (recovered) return recovered;
    var saved = node.properties && node.properties[ENABLES_PROP];
    if (Array.isArray(saved) && saved.length) {
        return normalizeEnableArray(saved);
    }
    return readEnableStates(node);
}

function persistState(state) {
    var props = state.node.properties = state.node.properties || {};
    props[TYPES_PROP] = state.types.slice();
    if (!Array.isArray(state.enables) || !state.enables.length) {
        state.enables = readEnableStates(state.node);
    } else {
        // Keep state.enables authoritative for currently visible switches.
        var current = readEnableStates(state.node);
        for (var channel = 1; channel <= state.visibleCount; channel++) {
            state.enables[channel - 1] = current[channel - 1];
        }
    }
    // Avoid writing temporary create-time defaults before configure restores
    // the saved enable vector from the workflow JSON.
    if (state.node.__xpipeGateEnablesReady) {
        props[ENABLES_PROP] = normalizeEnableArray(state.enables);
    }
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
        outputCount: state.node.outputs ? state.node.outputs.length : 0,
        names: state.names,
        types: state.types,
        enables: state.enables,
        visibleCount: state.visibleCount,
    });
}

function syncNode(state) {
    var before = stateSignature(state);
    ensureControlWidgets(state.node);
    syncDynamicChannels(state);
    // Expand/collapse may create new enable widgets with schema defaults.
    // Re-apply the authoritative enable vector after channel sync.
    if (!Array.isArray(state.enables) || !state.enables.length) {
        state.enables = readEnableStates(state.node);
    }
    applyEnableStates(state.node, state.enables);
    refreshChannelMetadata(state);
    applyChannelTypes(state);
    applyChannelLabels(state);
    hideNamesWidget(state.node);
    sortGateWidgets(state.node);
    refreshNodeLayout(state.node);
    // applyInitialNodeSize re-fits to visible content and updates min_size;
    // it is the single computeSize pass per sync.
    applyInitialNodeSize(state.node);
    // Persist only when the synced state actually changed; isolated
    // mutations (enable toggles, name edits) persist through their own
    // handlers.
    var changed = before !== stateSignature(state);
    if (changed) persistState(state);
    return changed;
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
        enables: loadEnableStates(node, null),
        visibleCount: 1,
    };
    node.__xpipeGateState = state;
    return state;
}

function ensurePipeGate(node) {
    if (!isXPipeGate(node)) return null;
    installStableSlotView(node);
    ensureControlWidgets(node);
    return createState(node);
}

function refreshPortStatus(node) {
    var state = ensurePipeGate(node);
    if (!state) return;
    // syncNode refreshes channel metadata; the scheduled refresh
    // propagates bundle metadata to dependent nodes.
    syncNode(state);
    scheduleRefresh();
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
    if (anyChanged) scheduleXPipeRefresh();
    // Link render cache depends on gate state; drop it after each sync so
    // hidden/warning visuals follow name/type changes immediately.
    invalidateLinkRenderCache();
}

function scheduleRefresh() {
    if (refreshTimer != null) return;
    refreshTimer = setTimeout(function () {
        refreshTimer = null;
        try { refreshAllPipeGate(); } catch (_error) { /* ignore */ }
    }, 0);
}

function isHiddenBundleLink(link, graph) {
    if (!link) return false;
    var source = getNodeById(graph, link.origin_id);
    var target = getNodeById(graph, link.target_id);
    var output = source && source.outputs
        ? source.outputs[link.origin_slot]
        : null;
    var input = target && target.inputs ? target.inputs[link.target_slot] : null;
    if (isXPipeGate(source) && output
        && output.name === BUNDLE_OUTPUT
        && (hiddenState(source) & HIDE_OUTPUT)) return true;
    return !!(
        isXPipeGate(target)
        && input
        && input.name === BUNDLE_INPUT
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
    if (isXPipeGate(source) && channelOutputNumber(output && output.name)
        && (valueHiddenState(source) & HIDE_OUTPUT)) return true;
    return !!(
        isXPipeGate(target)
        && channelInputNumber(input && input.name)
        && (valueHiddenState(target) & HIDE_INPUT)
    );
}

function linkWarning(link, graph) {
    if (!link) return null;
    var source = getNodeById(graph, link.origin_id);
    if (!isXPipeGate(source) || !source.__xpipeGateState) return null;
    var output = source.outputs && source.outputs[link.origin_slot];
    var slot = channelOutputNumber(output && output.name);
    if (!slot) return null;
    var target = getNodeById(graph, link.target_id);
    var input = target && target.inputs ? target.inputs[link.target_slot] : null;
    var outputType = cleanType(source.__xpipeGateState.types[slot - 1])
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
    // WeakMap get. invalidateLinkRenderCache() drops entries whenever gate
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
            console.warn("[XPipeGate] canvas not available; renderLink hooks not installed");
        }
        return;
    }
    canvasHookRetries = 0;
    hookedCanvas = canvas;
    var originalRenderLink = canvas.renderLink;
    if (typeof originalRenderLink !== "function") {
        console.warn("[XPipeGate] canvas.renderLink missing; link hiding/warning disabled");
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
    name: "ComfyUI.Xz3r0.XPipeGate",

    async setup() {
        applyUiLocale();
        installLocaleSync();
        installCanvasHooks();
        subscribeXPipeMetadata(scheduleRefresh);
    },

    async afterConfigureGraph() {
        // Undo/redo and workflow loads rebuild nodes through configure,
        // which can bypass the incremental onNodeCreated/onRemoved count;
        // rebuild the count from the graph so the gate stays accurate.
        gateNodeCount = 0;
        forEachPipeGate(app.graph, function (node) {
            node.__xpipeGateCounted = true;
            gateNodeCount++;
            if (node.__xpipeGateEnablesReady) return;
            node.__xpipeGateEnablesReady = true;
            var state = ensurePipeGate(node);
            if (state) persistState(state);
        });
        scheduleRefresh();
    },

    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (!nodeType.prototype.__xpipeGateRefreshHooked) {
            nodeType.prototype.__xpipeGateRefreshHooked = true;
            var originalAnyConnections = nodeType.prototype.onConnectionsChange;
            nodeType.prototype.onConnectionsChange = function (
                type,
                slotIndex,
                isConnected,
                link,
            ) {
                var result = originalAnyConnections
                    && originalAnyConnections.apply(this, arguments);
                // Only schedule when the change touches a Gate/XPipe node;
                // unrelated canvas edits must not trigger a full refresh.
                if (
                    gateNodeCount > 0
                    && linkTouchesGateFamily(this, link)
                ) {
                    scheduleRefresh();
                }
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
            // Do not mark enables ready here. Graph-loaded nodes call
            // onConfigure next; writing defaults first would clobber the
            // missing ENABLES_PROP case with all-true values.
            try {
                var state = ensurePipeGate(this);
                if (state) syncNode(state);
            } catch (_error) { /* keep ComfyUI node creation flow intact */ }
            var node = this;
            setTimeout(function () {
                if (node.__xpipeGateEnablesReady) return;
                // No configure followed creation: treat as a fresh node and
                // start persisting the current enable defaults.
                node.__xpipeGateEnablesReady = true;
                var readyState = ensurePipeGate(node);
                if (readyState) persistState(readyState);
            }, 0);
        };
        var originalConfigure = nodeType.prototype.onConfigure;
        nodeType.prototype.onConfigure = function (info) {
            originalConfigure && originalConfigure.apply(this, arguments);
            // Undo/redo and workflow loads restore nodes through configure
            // instead of onNodeCreated; count them here too.
            if (!this.__xpipeGateCounted) {
                this.__xpipeGateCounted = true;
                gateNodeCount++;
            }
            var state = ensurePipeGate(this);
            if (!state) return;
            state.types = padArray(
                this.properties && this.properties[TYPES_PROP],
                GATE_SLOTS,
                "",
            ).map(cleanType);
            state.enables = loadEnableStates(this, info);
            this.__xpipeGateEnablesReady = true;
            applyEnableStates(this, state.enables);
            updateControlWidgets(this);
            scheduleRefresh();
        };

        var originalWidgetChanged = nodeType.prototype.onWidgetChanged;
        nodeType.prototype.onWidgetChanged = function (
            name,
            value,
            oldValue,
            widget,
        ) {
            var result = originalWidgetChanged
                && originalWidgetChanged.apply(this, arguments);
            var channel = channelEnableNumber(name);
            if (channel) {
                var state = ensurePipeGate(this);
                if (state) {
                    this.__xpipeGateEnablesReady = true;
                    state.enables = normalizeEnableArray(state.enables);
                    state.enables[channel - 1] = normalizeEnableValue(value);
                    persistState(state);
                }
            }
            return result;
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
        try {
            var state = ensurePipeGate(node);
            if (!state) return;
            // Configure already restored enables when available. Still
            // re-assert them after dynamic channel expansion.
            if (!Array.isArray(state.enables) || !state.enables.length) {
                state.enables = loadEnableStates(node, null);
            }
            node.__xpipeGateEnablesReady = true;
            applyEnableStates(node, state.enables);
            syncNode(state);
        } catch (_error) { /* keep graph loading flow intact */ }
        scheduleRefresh();
    },
    nodeCreated(node) {
        if (!isXPipeGate(node)) return;
        if (!node.__xpipeGateCounted) {
            node.__xpipeGateCounted = true;
            gateNodeCount++;
        }
        try { ensurePipeGate(node); } catch (_error) { /* keep node creation flow intact */ }
    },
});
