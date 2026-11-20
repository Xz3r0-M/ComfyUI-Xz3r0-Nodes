/**
 * slot-links.js
 * =============
 *
 * 取「节点的输入口 / 输出口连了哪根线」的统一入口。
 *
 * 为什么要绕一层：
 * 新版 ComfyUI 前端把连线数据搬进了「连线库」（link store），节点口上的
 * `input.link` / `output.links` 只剩一个兼容视图，**读一次就在控制台
 * 打一条弃用警告**：
 *
 *   input.link is deprecated. Read connectivity via node.isInputConnected(slot) /
 *   node.getInputLink(slot); mutate via node.connect() / node.disconnectInput().
 *   output.links is deprecated. Read connectivity via node.isOutputConnected(slot) /
 *   node.getOutputNodes(slot); mutate via node.connect() / node.disconnectOutput().
 *
 * 所以业务代码一律走这里，不再直接摸这两个属性。
 *
 * 用法：
 *   import { inputLinkId, outputLinkIds } from "./core/slot-links.js";
 *
 *   var id  = inputLinkId(node, node.inputs[index]);       // 连线 id 或 null
 *   var ids = outputLinkIds(node, node.outputs[index]);    // 连线 id 数组
 *   var has = inputConnected(node, node.inputs[index]);    // 是否接线
 *
 * 说明：
 * - 第一个参数可以传 null：本模块会尝试用 `slot.node`（前端给每个口挂的
 *   归属节点）自己找，这比让老代码直接读 `.link` 安全得多。
 * - 只有当「口子不是新版前端的对象（没有 slot.node）且拿不到新 API」时，
 *   才退回读老的 `.link` / `.links`——那条路只可能发生在很老的前端上。
 */

/**
 * 口子在新版前端里是 NodeSlot 实例，带一个指向归属节点的 `node`。
 * @param {object} slot
 * @returns {object|null}
 */
function slotOwner(slot) {
    var owner = slot && slot.node;
    if (!owner || typeof owner !== "object") return null;
    if (!Array.isArray(owner.inputs) && !Array.isArray(owner.outputs)) {
        return null;
    }
    return owner;
}

/**
 * 判断某个口子是不是新版前端的对象（新版对象才有 `slot.node`）。
 * @param {object} slot
 * @returns {boolean}
 */
function isModernSlot(slot) {
    return !!slotOwner(slot);
}

/**
 * 找口子在某个列表里的序号（同名口子不猜）。
 *
 * 先按引用找（唯一可靠）；引用对不上时，只有「名字在这边唯一、且对面
 * 那一列没有同名口子」才按名字认——否则输入口和输出口同名时会认错。
 *
 * @param {object[]} slots      要去查的那一列（输入列或输出列）
 * @param {object[]} otherSlots 对面那一列，用来排除进出口同名
 * @param {object} slot
 * @returns {number} 找不到返回 -1
 */
function slotIndexIn(slots, otherSlots, slot) {
    if (!Array.isArray(slots) || !slot) return -1;
    var index = slots.indexOf(slot);
    if (index >= 0) return index;
    if (!slot.name) return -1;

    if (Array.isArray(otherSlots)) {
        for (var j = 0; j < otherSlots.length; j += 1) {
            var other = otherSlots[j];
            if (!other) continue;
            if (other === slot) return -1;
            if (other.name === slot.name) return -1;
        }
    }

    var found = -1;
    for (var i = 0; i < slots.length; i += 1) {
        if (!slots[i] || slots[i].name !== slot.name) continue;
        if (found >= 0) return -1;
        found = i;
    }
    return found;
}

/**
 * 找口子的归属节点：优先用口子自带的 `slot.node`（新版前端的权威值），
 * 其次用调用方给的节点。
 * @param {object|null} node
 * @param {object} slot
 * @returns {object|null}
 */
function resolveOwner(node, slot) {
    if (!slot) return node || null;
    var own = slotOwner(slot);
    if (own) return own;
    if (!node) return null;
    if (slotIndexIn(node.inputs, node.outputs, slot) >= 0) return node;
    if (slotIndexIn(node.outputs, node.inputs, slot) >= 0) return node;
    return null;
}

/**
 * 连线 id 统一成 number/string，取不到返回 null。
 * @param {object|null} link
 * @returns {number|string|null}
 */
function linkIdOf(link) {
    if (!link || link.id == null) return null;
    return link.id;
}

/**
 * 老前端专用：直接读口子上挂的连线 id。
 * @param {object} slot
 * @returns {number|string|null}
 */
function legacyInputLinkId(slot) {
    if (!slot) return null;
    if (slot.linkId != null) return slot.linkId;
    if (slot.link != null) return slot.link;
    return null;
}

/**
 * 老前端专用：直接读输出口上挂的连线 id 列表。
 * @param {object} slot
 * @returns {Array<number|string>}
 */
function legacyOutputLinkIds(slot) {
    if (!slot) return [];
    if (Array.isArray(slot.linkIds)) return slot.linkIds.slice();
    if (Array.isArray(slot.links)) return slot.links.slice();
    if (slot.linkId != null) return [slot.linkId];
    if (slot.link != null) return [slot.link];
    return [];
}

/**
 * 从连线库里筛出「某个输出口发出的」连线 id。
 * 连线库新版是 Map、老版是普通对象，两种都能遍历，因此不需要读弃用属性。
 * @param {object} node
 * @param {number} index
 * @returns {Array<number|string>|null} 拿不到连线库时返回 null
 */
function linkIdsFromStore(node, index) {
    var graph = node && node.graph;
    var links = graph && graph.links;
    if (!links) return null;
    var nodeId = String(node.id);
    var ids = [];
    var consider = function (link) {
        if (!link) return;
        if (String(link.origin_id) !== nodeId) return;
        if (Number(link.origin_slot) !== Number(index)) return;
        if (link.id == null) return;
        ids.push(link.id);
    };
    if (typeof links.forEach === "function") {
        links.forEach(consider);
    } else {
        for (var key in links) {
            if (!Object.prototype.hasOwnProperty.call(links, key)) continue;
            consider(links[key]);
        }
    }
    // 保持与官方兼容视图一致的「按 id 升序」顺序
    ids.sort(function (a, b) {
        return Number(a) - Number(b);
    });
    return ids;
}

/**
 * 读某个输入口当前的连线 id。
 * @param {object|null} node 归属节点（可省略）
 * @param {object} input 输入口
 * @returns {number|string|null} 没接线返回 null
 */
export function inputLinkId(node, input) {
    if (!input) return null;
    var owner = resolveOwner(node, input);
    var index = owner ? slotIndexIn(owner.inputs, owner.outputs, input) : -1;
    if (owner && index >= 0 && typeof owner.getInputLink === "function") {
        try {
            return linkIdOf(owner.getInputLink(index));
        } catch (_error) {
            // 节点还没挂到图上时官方方法会抛错，当作未接线
            return null;
        }
    }
    if (isModernSlot(input)) return null;
    return legacyInputLinkId(input);
}

/**
 * 读某个输入口当前的连线对象（省去自己去连线库查一次）。
 * @param {object|null} node
 * @param {object} input
 * @returns {object|null}
 */
export function inputLinkOf(node, input) {
    if (!input) return null;
    var owner = resolveOwner(node, input);
    var index = owner ? slotIndexIn(owner.inputs, owner.outputs, input) : -1;
    if (owner && index >= 0 && typeof owner.getInputLink === "function") {
        try {
            return owner.getInputLink(index) || null;
        } catch (_error) {
            return null;
        }
    }
    return null;
}

/**
 * 输入口是否接了线。
 * @param {object|null} node
 * @param {object} input
 * @returns {boolean}
 */
export function inputConnected(node, input) {
    return inputLinkId(node, input) != null;
}

/**
 * 读某个输出口发出的所有连线 id（按 id 升序）。
 * @param {object|null} node 归属节点（可省略）
 * @param {object} output 输出口
 * @returns {Array<number|string>}
 */
export function outputLinkIds(node, output) {
    if (!output) return [];
    var owner = resolveOwner(node, output);
    var index = owner ? slotIndexIn(owner.outputs, owner.inputs, output) : -1;
    if (owner && index >= 0) {
        var ids = linkIdsFromStore(owner, index);
        if (ids && ids.length) return ids;
        // 连线库里没有：新版口子就照实说「没连」，老口子再读老属性
        if (isModernSlot(output)) return ids || [];
    }
    if (isModernSlot(output)) return [];
    return legacyOutputLinkIds(output);
}

/**
 * 输出口是否接了线。
 * @param {object|null} node
 * @param {object} output
 * @returns {boolean}
 */
export function outputConnected(node, output) {
    if (!output) return false;
    var owner = resolveOwner(node, output);
    var index = owner ? slotIndexIn(owner.outputs, owner.inputs, output) : -1;
    if (owner && index >= 0 && typeof owner.isOutputConnected === "function") {
        return !!owner.isOutputConnected(index);
    }
    return outputLinkIds(node, output).length > 0;
}

/**
 * 不区分进/出口的版本：输入口返回 0 或 1 个 id，输出口返回全部 id。
 * @param {object|null} node
 * @param {object} slot
 * @returns {Array<number|string>}
 */
export function slotLinkIds(node, slot) {
    if (!slot) return [];
    var owner = resolveOwner(node, slot);
    if (owner && slotIndexIn(owner.outputs, owner.inputs, slot) >= 0) {
        return outputLinkIds(owner, slot);
    }
    var id = inputLinkId(owner, slot);
    return id == null ? [] : [id];
}
