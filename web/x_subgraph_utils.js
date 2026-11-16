/**
 * Subgraph / graph-tree helpers
 * ==============================
 * Shared walk/find utilities for nested Comfy subgraphs.
 * No app import, no node business (bundle/names/types/count).
 *
 * Subgraph IO recognition matches existing XPipe pragmatic rules:
 * - inputNode/outputNode handle OR normalized type contains
 *   subgraphinput / subgraphoutput
 * - parent shell: node.subgraph === childGraph (reference equality)
 */

var graphIds = new WeakMap();
var nextGraphId = 1;

export function graphNodes(graph) {
    return graph ? (graph._nodes || graph.nodes || []) : [];
}

export function graphKey(graph) {
    if (!graph) return "root";
    if (!graphIds.has(graph)) graphIds.set(graph, String(nextGraphId++));
    return graphIds.get(graph);
}

export function getNodeById(graph, nodeId) {
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

export function getLinkInfo(graph, linkId) {
    if (!graph || linkId == null) return null;
    if (typeof graph.getLink === "function") {
        var graphLink = graph.getLink(linkId);
        if (graphLink) return graphLink;
    }
    if (graph.links && graph.links[linkId]) return graph.links[linkId];
    if (graph._links instanceof Map) return graph._links.get(linkId) || null;
    return (graph._links && graph._links[linkId]) || null;
}

/**
 * @param {object} rootGraph
 * @param {function({graph, parentSubgraphNode, depth}): void} visitor
 */
export function walkGraphTree(rootGraph, visitor) {
    if (!rootGraph || typeof visitor !== "function") return;
    var visited = new WeakSet();
    var walk = function (graph, parentSubgraphNode, depth) {
        if (!graph || visited.has(graph)) return;
        visited.add(graph);
        visitor({
            graph: graph,
            parentSubgraphNode: parentSubgraphNode || null,
            depth: depth || 0,
        });
        var nodes = graphNodes(graph);
        for (var index = 0; index < nodes.length; index++) {
            var node = nodes[index];
            if (node && node.subgraph) {
                walk(node.subgraph, node, (depth || 0) + 1);
            }
        }
    };
    walk(rootGraph, null, 0);
}

/**
 * @param {object} rootGraph
 * @param {function(object, {graph, parentSubgraphNode, depth}): void} visitor
 */
export function forEachNode(rootGraph, visitor) {
    if (typeof visitor !== "function") return;
    walkGraphTree(rootGraph, function (ctx) {
        var nodes = graphNodes(ctx.graph);
        for (var index = 0; index < nodes.length; index++) {
            var node = nodes[index];
            if (node) visitor(node, ctx);
        }
    });
}

export function forEachNodeWhere(rootGraph, predicate, visitor) {
    if (typeof predicate !== "function" || typeof visitor !== "function") {
        return;
    }
    forEachNode(rootGraph, function (node, ctx) {
        if (predicate(node, ctx)) visitor(node, ctx);
    });
}

/**
 * Match node.comfyClass || node.type by exact string equality.
 * @param {object} rootGraph
 * @param {string|string[]} className
 * @param {function(object, object): void} visitor
 */
export function forEachNodeByComfyClass(rootGraph, className, visitor) {
    var names = Array.isArray(className) ? className : [className];
    var set = {};
    for (var i = 0; i < names.length; i++) {
        if (names[i] != null && names[i] !== "") {
            set[String(names[i])] = true;
        }
    }
    forEachNodeWhere(rootGraph, function (node) {
        var id = String(node && (node.comfyClass || node.type) || "");
        return !!set[id];
    }, visitor);
}

export function normalizedNodeType(node) {
    return String(
        node && (node.comfyClass || node.type || node.title
            || (node.constructor && node.constructor.name)) || "",
    ).toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function isSubgraphInputNode(node, graph) {
    return !!(
        node
        && (node === (graph && graph.inputNode)
            || normalizedNodeType(node).indexOf("subgraphinput") >= 0)
    );
}

export function isSubgraphOutputNode(node, graph) {
    return !!(
        node
        && (node === (graph && graph.outputNode)
            || normalizedNodeType(node).indexOf("subgraphoutput") >= 0)
    );
}

export function findSubgraphInputNode(graph) {
    if (!graph) return null;
    if (graph.inputNode) return graph.inputNode;
    var nodes = graphNodes(graph);
    for (var index = 0; index < nodes.length; index++) {
        if (isSubgraphInputNode(nodes[index], graph)) return nodes[index];
    }
    return null;
}

export function findSubgraphOutputNode(graph) {
    if (!graph) return null;
    if (graph.outputNode) return graph.outputNode;
    var nodes = graphNodes(graph);
    for (var index = 0; index < nodes.length; index++) {
        if (isSubgraphOutputNode(nodes[index], graph)) return nodes[index];
    }
    return null;
}

/**
 * 新版前端的转接点住在 graph.reroutes 里（Map 或普通对象），不在节点表里。
 */
function findReroute(graph, id) {
    if (!graph || id == null) return null;
    var reroutes = graph.reroutes;
    if (!reroutes) return null;
    if (typeof reroutes.get === "function") {
        return reroutes.get(id) || null;
    }
    return reroutes[id] || null;
}

/**
 * 顺着「某个输出口」往回追，直到找到真正产出数据的节点，穿过子图边界。
 *
 * 为什么要穿：
 * - 子图里的一根线，源头往往是「子图输入」代理节点。它自己不产出数据，
 *   数据来自外层接在同一个槽位上的那根线。
 * - 反过来，源头的类型是「子图外壳」时，数据其实在子图内部。
 * 只看 origin_id 的话这两种情况都会认错人——数量、元素类型、名字就全估不
 * 出来（表现为画布上一直显示手填的旧值，或者名字一片空白）。
 *
 * @param {object} graph     连线所在的图
 * @param {object} link      连线对象（必须已解析成对象，不是 id）
 * @param {object} rootGraph 图树的根（通常是 app.graph）
 * @param {number} [depth]   递归深度，内部用
 * @returns {{graph: object, link: object, node: object, slot: number}|null}
 */
export function resolveLinkSource(graph, link, rootGraph, depth) {
    var level = depth || 0;
    if (!graph || !link || level > 16) return null;
    var origin = getNodeById(graph, link.origin_id);
    if (!origin && graph && graph.inputNode
        && String(link.origin_id) === String(graph.inputNode.id)) {
        // 子图输入代理不在普通节点表里（getNodeById 找不到），单独认领。
        origin = graph.inputNode;
    }
    if (!origin) {
        // 转接点（Reroute）不是普通节点，得去连线库的转接点表里找。
        var rerouteNode = findReroute(graph, link.origin_id);
        if (!rerouteNode) return null;
        var beforeReroute = findLinkToNodeInput(graph, rerouteNode, 0);
        return beforeReroute
            ? resolveLinkSource(graph, beforeReroute, rootGraph, level + 1)
            : null;
    }

    // 老式转接点是普通节点，只有一个入口，一样继续往上游走。
    if (normalizedNodeType(origin).indexOf("reroute") >= 0) {
        var throughReroute = findLinkToNodeInput(graph, origin, 0);
        return throughReroute
            ? resolveLinkSource(graph, throughReroute, rootGraph, level + 1)
            : null;
    }

    if (isSubgraphInputNode(origin, graph)) {
        // 子图输入代理：往外层同名的槽位继续找。
        var parent = findParentSubgraphNode(graph, rootGraph);
        if (!parent) return null;
        var outerGraph = parent.graph || rootGraph;
        var proxySlot = Array.isArray(origin.outputs)
            ? origin.outputs[link.origin_slot]
            : null;
        // 外壳节点的输入槽和子图输入一一对应，先按名字认，认不出用序号。
        var slotIndex = findMatchingSlotIndex(parent.inputs, proxySlot, -1);
        if (slotIndex < 0) slotIndex = link.origin_slot;
        var outerLink = findLinkToNodeInput(outerGraph, parent, slotIndex);
        if (!outerLink) return null;
        return resolveLinkSource(outerGraph, outerLink, rootGraph, level + 1);
    }

    if (origin.subgraph) {
        // 子图外壳的输出口：钻进子图，找内部真正产出数据的那个节点。
        var inner = origin.subgraph;
        var subOutput = Array.isArray(inner.outputs)
            ? inner.outputs[link.origin_slot]
            : null;
        var ids = (subOutput && (subOutput.linkIds || subOutput.links)) || [];
        for (var index = 0; index < ids.length; index++) {
            var found = resolveLinkSource(
                inner,
                getLinkInfo(inner, ids[index]),
                rootGraph,
                level + 1,
            );
            if (found) return found;
        }
        return null;
    }

    return {
        graph: graph,
        link: link,
        node: origin,
        slot: link.origin_slot,
    };
}

/**
 * Find the shell node whose .subgraph === childGraph.
 * @param {object} childGraph
 * @param {object} rootGraph  required (typically app.graph)
 */
export function findParentSubgraphNode(childGraph, rootGraph) {
    if (!childGraph || !rootGraph) return null;
    var found = null;
    walkGraphTree(rootGraph, function (ctx) {
        if (found) return;
        var nodes = graphNodes(ctx.graph);
        for (var index = 0; index < nodes.length; index++) {
            var node = nodes[index];
            if (node && node.subgraph === childGraph) {
                found = node;
                return;
            }
        }
    });
    return found;
}

function cleanSlotName(value) {
    return value == null ? "" : String(value).trim();
}

export function slotKeyNames(slot) {
    var names = [];
    var add = function (value) {
        var name = cleanSlotName(value);
        if (name && names.indexOf(name) < 0) names.push(name);
    };
    if (!slot) return names;
    add(slot.name);
    add(slot.label);
    add(slot.localized_name);
    return names;
}

export function slotAt(slots, index) {
    return slots && index != null && index >= 0 ? slots[index] || null : null;
}

export function findMatchingSlotIndex(slots, reference, fallbackIndex) {
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
            ) >= 0) {
                return entries[index].index;
            }
        }
    }
    return -1;
}

export function findLinkToNodeInput(graph, node, inputIndex) {
    if (!graph || !node) return null;
    var links = graph.links || graph._links;
    if (!links) return null;
    if (links instanceof Map) {
        var found = null;
        links.forEach(function (link) {
            if (!found && link && link.target_id === node.id
                && link.target_slot === inputIndex) {
                found = link;
            }
        });
        return found;
    }
    for (var key in links) {
        if (!Object.prototype.hasOwnProperty.call(links, key)) continue;
        var link = links[key];
        if (link && link.target_id === node.id
            && link.target_slot === inputIndex) {
            return link;
        }
    }
    return null;
}

/**
 * @param {*} linkId
 * @param {object|null} preferredGraph
 * @param {object|null} rootGraph  fallback tree root when not in preferred
 */
export function findLinkInGraphTree(linkId, preferredGraph, rootGraph) {
    var direct = getLinkInfo(preferredGraph, linkId);
    if (direct) return { graph: preferredGraph, link: direct };
    var found = null;
    var root = rootGraph || preferredGraph;
    if (!root) return null;
    walkGraphTree(root, function (ctx) {
        if (found) return;
        var link = getLinkInfo(ctx.graph, linkId);
        if (link) found = { graph: ctx.graph, link: link };
    });
    return found;
}

/**
 * @param {object} slot
 * @param {"input"|"output"} direction
 * @param {object|null} preferredGraph
 * @param {object|null} rootGraph
 */
export function findSlotOwner(slot, direction, preferredGraph, rootGraph) {
    if (!slot) return null;
    var found = null;
    var search = function (graph) {
        if (!graph || found) return;
        var visited = new WeakSet();
        var walk = function (g) {
            if (!g || found || visited.has(g)) return;
            visited.add(g);
            var nodes = graphNodes(g);
            for (var index = 0; index < nodes.length; index++) {
                var node = nodes[index];
                var slots = direction === "input"
                    ? node.inputs
                    : node.outputs;
                if (Array.isArray(slots)) {
                    for (var slotIndex = 0;
                        slotIndex < slots.length;
                        slotIndex++) {
                        if (slots[slotIndex] === slot) {
                            found = {
                                graph: g,
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
        walk(graph);
    };
    search(preferredGraph);
    if (!found && rootGraph && rootGraph !== preferredGraph) {
        search(rootGraph);
    }
    return found;
}
