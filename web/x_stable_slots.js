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
 * Moving links when slots move
 * ============================
 * Newer ComfyUI frontends keep "which link is on which slot" in a registry
 * keyed by slot index. A slot's own link field is only a read-only echo of
 * that registry, and writing a link's target slot is validated: if the
 * destination is still occupied the write is refused (and only logged).
 *
 * Consequences for this file:
 * - capture slot -> link pairs BEFORE touching the slot arrays
 *   ({@link captureSlotLinks}); after the arrays move, put the links back
 *   with {@link applySlotLinks} / {@link reorderSlots}.
 * - a plain "for each slot: link.target_slot = index" loop can neither read
 *   the right pairing (the echo already answers by index) nor perform a
 *   swap (the write is refused) - that is why refreshInputLinkTargets /
 *   refreshOutputLinkSources are kept only as no-op compatibility shims.
 */

function slotLinkAt(node, direction, index, getLinkInfo) {
    var slots = direction === "input" ? node.inputs : node.outputs;
    var slot = slots && slots[index];
    if (!slot) return null;
    if (direction === "input" && typeof node.getInputLink === "function") {
        var direct = node.getInputLink(index);
        if (direct) return direct;
    }
    if (typeof getLinkInfo !== "function" || !node.graph) return null;
    var ids = slotLinkIds(slot);
    for (var linkIndex = 0; linkIndex < ids.length; linkIndex++) {
        var link = getLinkInfo(node.graph, ids[linkIndex]);
        if (link) return link;
    }
    return null;
}

function linkSlotNumber(link, direction) {
    if (!link) return -1;
    var value = direction === "input" ? link.target_slot : link.origin_slot;
    return typeof value === "number" ? value : -1;
}

/**
 * Point a link at a slot index. Returns true when it stuck (see the store's
 * validation note above).
 */
function writeLinkSlotNumber(link, direction, index) {
    if (!link) return false;
    if (direction === "input") link.target_slot = index;
    else link.origin_slot = index;
    return linkSlotNumber(link, direction) === index;
}

function slotIndexOf(node, direction, slot) {
    var slots = direction === "input" ? node.inputs : node.outputs;
    return slots ? slots.indexOf(slot) : -1;
}

/**
 * How many links the graph registry says touch this node on one side.
 * Used as a completeness check before reordering: if the slot objects cannot
 * account for every registered link, the link store is mid-update (e.g. a
 * subgraph conversion is remapping links) and moving slots then would strand
 * links on temporary parking slots. Returns -1 when it cannot be counted.
 * @param {object} node
 * @param {"input"|"output"} direction
 * @returns {number}
 */
function countRegisteredNodeLinks(node, direction) {
    var graph = node && node.graph;
    if (!graph || !graph.links) return -1;
    var links = graph.links;
    var nodeId = node.id == null ? null : String(node.id);
    if (nodeId == null) return -1;
    var count = 0;
    var inspect = function (link) {
        if (!link) return;
        var ownerId = direction === "input"
            ? link.target_id
            : link.origin_id;
        if (ownerId != null && String(ownerId) === nodeId) count++;
    };
    if (typeof links.forEach === "function") {
        links.forEach(function (link) {
            inspect(link);
        });
        return count;
    }
    for (var key in links) {
        if (!Object.prototype.hasOwnProperty.call(links, key)) continue;
        inspect(links[key]);
    }
    return count;
}

function addParkingSlot(node, direction) {
    var slot = null;
    if (direction === "input") {
        node.addInput("__xzr0_park", "*");
        slot = node.inputs[node.inputs.length - 1];
    } else {
        node.addOutput("__xzr0_park", "*");
        slot = node.outputs[node.outputs.length - 1];
    }
    return slot;
}

function removeTrailingSlot(node, direction, index) {
    var slots = direction === "input" ? node.inputs : node.outputs;
    if (!slots || index !== slots.length - 1) return;
    if (direction === "input" && typeof node.removeInput === "function") {
        node.removeInput(index);
    } else if (
        direction === "output"
        && typeof node.removeOutput === "function"
    ) {
        node.removeOutput(index);
    } else {
        slots.splice(index, 1);
    }
}

/**
 * Snapshot "slot -> link" for the current array order.
 * Call this BEFORE moving slots around.
 * @param {object} node
 * @param {"input"|"output"} direction
 * @param {function(object, *): object|null} getLinkInfo
 * @returns {Map<object, object>}
 */
export function captureSlotLinks(node, direction, getLinkInfo) {
    var bindings = new Map();
    var slots = !node
        ? null
        : (direction === "input" ? node.inputs : node.outputs);
    if (!Array.isArray(slots)) return bindings;
    for (var index = 0; index < slots.length; index++) {
        var link = slotLinkAt(node, direction, index, getLinkInfo);
        if (link) bindings.set(slots[index], link);
    }
    return bindings;
}

/**
 * Put captured links back onto the (moved) slots they belong to.
 *
 * Writes that would land on an occupied slot are staged through a free slot
 * first, so a swap of two slots cannot be refused halfway. Parking slots are
 * appended at the tail and removed again, which never shifts other slots.
 *
 * @param {object} node
 * @param {"input"|"output"} direction
 * @param {Map<object, object>} bindings  from {@link captureSlotLinks}
 * @param {function(object, *): object|null} getLinkInfo
 * @returns {{moved: number, failed: number}}
 */
export function applySlotLinks(node, direction, bindings, getLinkInfo) {
    var result = { moved: 0, failed: 0 };
    if (!node || !node.graph || !bindings || !bindings.size) return result;
    var isInput = direction === "input";
    var pending = [];
    bindings.forEach(function (link, slot) {
        if (!link) return;
        var index = slotIndexOf(node, direction, slot);
        if (index < 0) return;
        if (linkSlotNumber(link, direction) === index) return;
        pending.push({ link: link, target: index, attempts: 0 });
    });
    if (!pending.length) return result;

    var parked = [];
    var guard = 0;
    while (pending.length && guard++ < 200) {
        var progressed = false;
        for (var index = 0; index < pending.length; index++) {
            var move = pending[index];
            var occupant = isInput
                ? slotLinkAt(node, direction, move.target, getLinkInfo)
                : null;
            // Writes on the output side are never validated, so an occupant
            // only blocks input slots.
            if (occupant && occupant !== move.link) continue;
            if (writeLinkSlotNumber(move.link, direction, move.target)) {
                pending.splice(index, 1);
                index--;
                result.moved++;
                progressed = true;
            } else {
                move.attempts++;
            }
        }
        if (progressed) continue;

        // Every remaining move is blocked by another one (a swap/rotation):
        // stage one of them in a free slot and retry.
        var parking = findParkingIndex(node, direction, pending, getLinkInfo);
        if (parking < 0) {
            var extra = addParkingSlot(node, direction);
            parking = slotIndexOf(node, direction, extra);
            if (parking >= 0) parked.push(parking);
        }
        if (parking < 0) break;
        if (!writeLinkSlotNumber(pending[0].link, direction, parking)) break;
        pending[0].attempts++;
    }

    for (var done = parked.length - 1; done >= 0; done--) {
        removeTrailingSlot(node, direction, parked[done]);
    }
    result.failed = pending.length;
    return result;
}

function findParkingIndex(node, direction, pending, getLinkInfo) {
    var slots = direction === "input" ? node.inputs : node.outputs;
    if (!Array.isArray(slots)) return -1;
    var reserved = {};
    for (var index = 0; index < pending.length; index++) {
        reserved[pending[index].target] = true;
    }
    for (var candidate = slots.length - 1; candidate >= 0; candidate--) {
        if (reserved[candidate]) continue;
        if (slotLinkAt(node, direction, candidate, getLinkInfo)) continue;
        return candidate;
    }
    return -1;
}

/**
 * Replace the slot order, keeping every link attached to its own slot.
 *
 * `orderedSlots` must be a permutation of the current slots; when
 * `keepUnlisted` is set, slots left out of the list are appended at the end
 * instead of being silently dropped (dropping a linked slot would lose the
 * connection).
 *
 * @param {object} node
 * @param {"input"|"output"} direction
 * @param {Array} orderedSlots
 * @param {function(object, *): object|null} getLinkInfo
 * @param {{keepUnlisted?: boolean}} [options]
 * @returns {boolean} true when the array was reordered
 */
export function reorderSlots(
    node,
    direction,
    orderedSlots,
    getLinkInfo,
    options,
) {
    var slots = !node
        ? null
        : (direction === "input" ? node.inputs : node.outputs);
    if (!Array.isArray(slots) || !Array.isArray(orderedSlots)) return false;
    var next = orderedSlots.filter(function (slot) {
        return slots.indexOf(slot) >= 0;
    });
    var unique = [];
    for (var index = 0; index < next.length; index++) {
        if (unique.indexOf(next[index]) < 0) unique.push(next[index]);
    }
    if (options && options.keepUnlisted) {
        for (var slotIndex = 0; slotIndex < slots.length; slotIndex++) {
            if (unique.indexOf(slots[slotIndex]) < 0) unique.push(slots[slotIndex]);
        }
    }
    var unchanged = unique.length === slots.length
        && unique.every(function (slot, position) {
            return slot === slots[position];
        });
    if (unchanged) return false;

    var originalOrder = slots.slice();
    var bindings = captureSlotLinks(node, direction, getLinkInfo);
    var registered = countRegisteredNodeLinks(node, direction);
    if (
        direction === "input"
        && registered >= 0
        && bindings.size < registered
    ) {
        // Not every registered link is reachable from its slot yet. Do not
        // touch the order at all: moving slots now is what strands links on
        // parking slots during subgraph conversion.
        console.warn(
            "[XPipe] slot reorder skipped: " + (registered - bindings.size)
            + " link(s) not resolvable yet.",
        );
        return false;
    }
    slots.splice.apply(slots, [0, slots.length].concat(unique));
    var applied = applySlotLinks(node, direction, bindings, getLinkInfo);
    if (!applied.failed) return true;

    // Roll the array back and re-anchor every link to its original slot.
    // Keeping the previous (valid) order beats leaving links on a
    // temporary parking slot like "port 49".
    slots.splice.apply(slots, [0, slots.length].concat(originalOrder));
    var restored = applySlotLinks(node, direction, bindings, getLinkInfo);
    console.warn(
        "[XPipe] slot reorder rolled back (" + applied.failed
        + " link(s) could not follow, " + restored.failed
        + " not restored).",
    );
    return false;
}

/**
 * Remove one slot through the frontend API so the link registry stays in
 * sync (plain array filtering shifts every later slot but not its links).
 * @param {object} node
 * @param {"input"|"output"} direction
 * @param {object} slot  the slot object to remove
 * @returns {boolean} true when the slot was removed
 */
export function removeSlot(node, direction, slot) {
    var index = slotIndexOf(node, direction, slot);
    if (index < 0) return false;
    if (direction === "input") {
        if (typeof node.removeInput === "function") {
            node.removeInput(index);
            return true;
        }
        return node.inputs.splice(index, 1).length > 0;
    }
    if (typeof node.removeOutput === "function") {
        node.removeOutput(index);
        return true;
    }
    return node.outputs.splice(index, 1).length > 0;
}

/**
 * Compatibility shims. On newer frontends a slot's link field answers by
 * slot index only, so a bare "re-point every linked slot" pass cannot repair
 * anything (and a swap would be refused). They now re-anchor the links to the
 * index each slot currently holds, which is a no-op unless slots were moved
 * without using {@link reorderSlots}.
 * @param {object} node
 * @param {function(object, *): object|null} getLinkInfo
 */
export function refreshInputLinkTargets(node, getLinkInfo) {
    if (!node || !node.graph || !Array.isArray(node.inputs)) return;
    if (typeof getLinkInfo !== "function") return;
    applySlotLinks(
        node,
        "input",
        captureSlotLinks(node, "input", getLinkInfo),
        getLinkInfo,
    );
}

/**
 * @see refreshInputLinkTargets
 * @param {object} node
 * @param {function(object, *): object|null} getLinkInfo
 */
export function refreshOutputLinkSources(node, getLinkInfo) {
    if (!node || !node.graph || !Array.isArray(node.outputs)) return;
    if (typeof getLinkInfo !== "function") return;
    applySlotLinks(
        node,
        "output",
        captureSlotLinks(node, "output", getLinkInfo),
        getLinkInfo,
    );
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
