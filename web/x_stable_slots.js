/**
 * Stable slot identity helpers (Scheme A)
 * ========================================
 * Keep fixed channel slots in the node arrays forever. Visibility is a
 * view concern (layout / draw / height), never removeInput/removeOutput.
 *
 * LiteGraph has no first-class slot.hidden that affects layout. We:
 * - mark slots with _xzr0Hidden
 * - give hidden slots a sentinel pos so they leave the default vertical pack
 * - filter them out of computeSize row counts and drawSlots
 * - rebind link origin_slot / target_slot after any reorder
 */

var HIDDEN_POS = [0, -100000];
var HIDDEN_FLAG = "_xzr0Hidden";

function slotLinkIds(slot) {
    if (!slot) return [];
    if (Array.isArray(slot.linkIds)) return slot.linkIds.slice();
    if (Array.isArray(slot.links)) return slot.links.slice();
    if (slot.linkId != null) return [slot.linkId];
    if (slot.link != null) return [slot.link];
    return [];
}

/**
 * @param {object} node
 * @param {function(object, *): object|null} getLinkInfo
 */
export function refreshInputLinkTargets(node, getLinkInfo) {
    if (!node || !node.graph || !Array.isArray(node.inputs)) return;
    if (typeof getLinkInfo !== "function") return;
    for (var index = 0; index < node.inputs.length; index++) {
        var ids = slotLinkIds(node.inputs[index]);
        for (var linkIndex = 0; linkIndex < ids.length; linkIndex++) {
            var link = getLinkInfo(node.graph, ids[linkIndex]);
            if (link) link.target_slot = index;
        }
    }
}

/**
 * @param {object} node
 * @param {function(object, *): object|null} getLinkInfo
 */
export function refreshOutputLinkSources(node, getLinkInfo) {
    if (!node || !node.graph || !Array.isArray(node.outputs)) return;
    if (typeof getLinkInfo !== "function") return;
    for (var index = 0; index < node.outputs.length; index++) {
        var ids = slotLinkIds(node.outputs[index]);
        for (var linkIndex = 0; linkIndex < ids.length; linkIndex++) {
            var link = getLinkInfo(node.graph, ids[linkIndex]);
            if (link) link.origin_slot = index;
        }
    }
}

/**
 * Mark a slot hidden or visible for layout/draw. Does not remove it.
 * @param {object|null} slot
 * @param {boolean} hidden
 */
export function setSlotHidden(slot, hidden) {
    if (!slot) return;
    if (hidden) {
        slot[HIDDEN_FLAG] = true;
        slot.pos = HIDDEN_POS.slice();
    } else {
        if (slot[HIDDEN_FLAG]) delete slot[HIDDEN_FLAG];
        if (
            Array.isArray(slot.pos)
            && slot.pos[0] === HIDDEN_POS[0]
            && slot.pos[1] === HIDDEN_POS[1]
        ) {
            delete slot.pos;
        }
    }
}

export function isSlotHidden(slot) {
    return !!(slot && slot[HIDDEN_FLAG]);
}

/**
 * Apply hidden window to channel slots.
 * Linked slots are never hidden so origin/target positions stay valid.
 * @param {Array} slots
 * @param {function(object): number} channelNumberOf  1-based; 0 = not a channel
 * @param {number} visibleCount
 */
export function applyVisibleSlotWindow(slots, channelNumberOf, visibleCount) {
    if (!Array.isArray(slots) || typeof channelNumberOf !== "function") return;
    var count = Math.max(0, Number(visibleCount) || 0);
    for (var index = 0; index < slots.length; index++) {
        var slot = slots[index];
        if (!slot) continue;
        var channel = channelNumberOf(slot) || 0;
        if (channel <= 0) {
            setSlotHidden(slot, false);
            continue;
        }
        var linked = slotLinkIds(slot).length > 0;
        setSlotHidden(slot, channel > count && !linked);
    }
}

function isWidgetInputSlot(slot) {
    return !!(slot && slot.widget);
}

/**
 * Walk the prototype chain for an own-or-inherited function property.
 * ComfyNode instances often put methods on LGraphNode.prototype, not the
 * immediate class prototype, so Object.getPrototypeOf(node).fn can miss.
 * @param {object} obj
 * @param {string} name
 * @returns {Function|null}
 */
function resolveMethod(obj, name) {
    if (!obj) return null;
    var proto = obj;
    while (proto) {
        if (
            Object.prototype.hasOwnProperty.call(proto, name)
            && typeof proto[name] === "function"
        ) {
            return proto[name];
        }
        proto = Object.getPrototypeOf(proto);
    }
    return typeof obj[name] === "function" ? obj[name] : null;
}

function filterVisibleSlots(slots) {
    return Array.isArray(slots)
        ? slots.filter(function (slot) {
            return slot && !slot[HIDDEN_FLAG];
        })
        : slots;
}

/**
 * Run fn with hidden Scheme A slots temporarily removed from the live
 * inputs/outputs/_concrete* arrays used by LiteGraph layout/draw/size.
 * @param {object} node
 * @param {Function} fn
 * @returns {*}
 */
function withVisibleSlotsOnly(node, fn) {
    var fullInputs = node.inputs;
    var fullOutputs = node.outputs;
    var concreteIn = node._concreteInputs;
    var concreteOut = node._concreteOutputs;
    node.inputs = filterVisibleSlots(fullInputs);
    node.outputs = filterVisibleSlots(fullOutputs);
    if (Array.isArray(concreteIn)) {
        node._concreteInputs = filterVisibleSlots(concreteIn);
    }
    if (Array.isArray(concreteOut)) {
        node._concreteOutputs = filterVisibleSlots(concreteOut);
    }
    try {
        return fn();
    } finally {
        node.inputs = fullInputs;
        node.outputs = fullOutputs;
        if (concreteIn) node._concreteInputs = concreteIn;
        if (concreteOut) node._concreteOutputs = concreteOut;
    }
}

/**
 * Override computeSize so hidden channel slots do not inflate node height.
 * Safe to call multiple times on the same node.
 * @param {object} node
 */
export function installStableComputeSize(node) {
    if (!node || node.__xStableComputeSize) return;
    var original = resolveMethod(node, "computeSize");
    if (!original) return;
    node.__xStableComputeSize = true;
    // Remember the true original in case another wrapper was already present.
    node.__xStableComputeSizeOriginal = original;

    node.computeSize = function (out) {
        var self = this;
        return withVisibleSlotsOnly(self, function () {
            return original.call(self, out);
        });
    };
}

/**
 * Skip drawing hidden slots (still present in arrays for stable indices).
 * @param {object} node
 */
export function installStableDrawSlots(node) {
    if (!node || node.__xStableDrawSlots) return;
    var original = resolveMethod(node, "drawSlots");
    if (!original) return;
    node.__xStableDrawSlots = true;
    node.__xStableDrawSlotsOriginal = original;

    node.drawSlots = function (ctx, options) {
        var self = this;
        return withVisibleSlotsOnly(self, function () {
            return original.call(self, ctx, options);
        });
    };
}

/**
 * Keep hidden slots out of arrange() / _measureSlots().
 *
 * Scheme A parks hidden slots at a sentinel pos so they leave the default
 * vertical pack. Newer ComfyUI measures ALL concrete slots for widget start Y
 * via createBounds(boundingRect). Sentinel Y ≈ -100000 then makes
 * widgetStartY enormous and _arrangeWidgets auto-grows the node height.
 *
 * Filter hidden slots before arrange, same idea as drawSlots/computeSize.
 * @param {object} node
 */
export function installStableArrange(node) {
    if (!node || node.__xStableArrange) return;
    var original = resolveMethod(node, "arrange");
    if (!original) return;
    node.__xStableArrange = true;
    node.__xStableArrangeOriginal = original;

    node.arrange = function () {
        var self = this;
        var args = arguments;
        var result = withVisibleSlotsOnly(self, function () {
            return original.apply(self, args);
        });
        // ComfyUI draw loop calls arrange every frame. If any hidden slot
        // still leaks into widgetStartY, _arrangeWidgets grows the node.
        // Always snap height back to Scheme-A content size after arrange.
        // Width extra is 0 here; initial-size helpers apply INITIAL_WIDTH_EXTRA.
        fitNodeSizeToVisibleSlots(self, 0);
        return result;
    };
}

/**
 * Install size + draw + arrange hooks used by Scheme A nodes.
 * @param {object} node
 */
export function installStableSlotView(node) {
    installStableComputeSize(node);
    installStableDrawSlots(node);
    installStableArrange(node);
}

/**
 * Snap node size to the Scheme-A-aware content size.
 * Used after layout passes that may have been inflated by hidden slots or
 * by ComfyUI setInitialSize() before visibility windows were applied.
 * @param {object} node
 * @param {number} [widthExtra=0]
 * @returns {[number, number]|null}
 */
export function fitNodeSizeToVisibleSlots(node, widthExtra) {
    if (!node || typeof node.computeSize !== "function") return null;
    var extra = Number(widthExtra) || 0;
    var computed = node.computeSize();
    if (!Array.isArray(computed) || computed.length < 2) return null;
    var nextW = Math.max(1, Math.ceil((Number(computed[0]) || 0) + extra));
    var nextH = Math.max(1, Math.ceil(Number(computed[1]) || 0));
    var curW = (node.size && node.size[0]) || 0;
    var curH = (node.size && node.size[1]) || 0;
    // Width: keep user-enlarged width; always honor content minimum.
    var width = Math.max(nextW, curW || nextW);
    // Height: content size is authoritative. Construction / arrange can leave
    // a massively inflated height (50 slots × slot height, or sentinel pos);
    // never keep a taller value than the visible-slot computeSize.
    var height = nextH;
    if (width === curW && height === curH) return [width, height];
    if (typeof node.setSize === "function") node.setSize([width, height]);
    else if (!node.size || node.size.length < 2) node.size = [width, height];
    else {
        node.size[0] = width;
        node.size[1] = height;
    }
    return [width, height];
}

export function slotLinkIdsOf(slot) {
    return slotLinkIds(slot);
}

// Keep widget helper available for callers that filter like LiteGraph.
export function isWidgetLikeSlot(slot) {
    return isWidgetInputSlot(slot);
}
