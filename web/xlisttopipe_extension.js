/**
 * XListToPipe — count 端口驱动下游 XPipe_v2 槽位展开
 * ==================================================
 * 与 XListPull 相同：count 连接时禁用 count_display；
 * 连线/widget 变化时刷新 XPipe_v2 元数据。
 */

import { app } from "../../scripts/app.js";
import {
    scheduleXPipeV2Refresh,
} from "./xpipe_v2_extension.js";

var NODE_CLASS = "XListToPipe";
var LIST_CREATE_CLASS = "XListCreate";
var PIPE_SLOTS = 50;

function findCountPort(node) {
    if (!node || !Array.isArray(node.inputs)) {
        return { idx: -1, linkId: null };
    }
    for (var index = 0; index < node.inputs.length; index++) {
        var input = node.inputs[index];
        if (input && input.name === "count") {
            return {
                idx: index,
                linkId: input.link != null ? input.link : null,
            };
        }
    }
    return { idx: -1, linkId: null };
}

function findCountWidget(node) {
    if (!node || !Array.isArray(node.widgets)) return null;
    for (var index = 0; index < node.widgets.length; index++) {
        if (node.widgets[index] && node.widgets[index].name === "count_display") {
            return node.widgets[index];
        }
    }
    return null;
}

function getUpstreamNode(graph, linkId) {
    if (!graph || linkId == null) return null;
    var link = graph.links
        ? graph.links[linkId] || linkId
        : linkId;
    if (!link || typeof link !== "object") return null;
    var originId = link.origin_id;
    if (originId == null) return null;
    return graph.getNodeById
        ? graph.getNodeById(originId)
        : graph._nodes_by_id && graph._nodes_by_id[originId];
}

function countActiveInputs(node) {
    if (!node || !Array.isArray(node.inputs)) return 0;
    var count = 0;
    for (var index = 0; index < node.inputs.length; index++) {
        var input = node.inputs[index];
        if (!input || input.link == null) continue;
        var name = String(input.name || "");
        if (/^input\d*$/.test(name) || name.indexOf("input") === 0) {
            count += 1;
        }
    }
    return Math.max(0, Math.min(PIPE_SLOTS, count));
}

function resolveCount(node) {
    if (!node) return 1;
    var countPort = findCountPort(node);
    if (countPort.linkId != null && node.graph) {
        var upstream = getUpstreamNode(node.graph, countPort.linkId);
        if (upstream && upstream.comfyClass === LIST_CREATE_CLASS) {
            var listCount = countActiveInputs(upstream);
            if (listCount > 0) {
                return Math.max(1, Math.min(PIPE_SLOTS, listCount));
            }
        }
    }
    var widget = findCountWidget(node);
    if (widget && widget.value != null) {
        return Math.max(
            1,
            Math.min(PIPE_SLOTS, Math.round(Number(widget.value)) || 1),
        );
    }
    return 1;
}

function syncCountWidget(node) {
    var countPort = findCountPort(node);
    var widget = findCountWidget(node);
    if (!widget) return;
    widget.disabled = countPort.linkId != null;
    if (countPort.linkId != null) {
        // Keep widget value aligned with resolved count for display.
        widget.value = resolveCount(node);
    }
}

function refreshDownstream() {
    scheduleXPipeV2Refresh();
}

function scheduleRefreshAll(graph) {
    // XListCreate input changes should re-expand downstream XPipe_v2.
    if (!graph) {
        refreshDownstream();
        return;
    }
    refreshDownstream();
}

app.registerExtension({
    name: "Xz3r0.XListToPipe",

    afterConfigureGraph: function () {
        var graph = app.graph;
        if (!graph) return;
        var nodes = graph._nodes || graph.nodes || [];
        for (var index = 0; index < nodes.length; index++) {
            if (nodes[index] && nodes[index].comfyClass === NODE_CLASS) {
                syncCountWidget(nodes[index]);
            }
        }
        refreshDownstream();
    },

    beforeRegisterNodeDef: function (nodeType, nodeData) {
        if (!nodeType.prototype.__xlisttopipe_hooked) {
            nodeType.prototype.__xlisttopipe_hooked = true;
            var originalConnections = nodeType.prototype.onConnectionsChange;
            nodeType.prototype.onConnectionsChange = function (
                type,
                index,
                connected,
                linkInfo,
                slotInfo,
            ) {
                if (originalConnections) {
                    originalConnections.apply(this, arguments);
                }
                var node = this;

                if (node.comfyClass === LIST_CREATE_CLASS) {
                    var createSlot = slotInfo
                        || (node.inputs && node.inputs[index]);
                    if (createSlot && /^input\d*$/.test(createSlot.name || "")) {
                        scheduleRefreshAll(node.graph);
                    }
                }

                if (node.comfyClass === NODE_CLASS) {
                    var slot = slotInfo
                        || (node.inputs && node.inputs[index]);
                    if (
                        slot
                        && (slot.name === "count" || slot.name === "list_input")
                    ) {
                        if (slot.name === "count") {
                            syncCountWidget(node);
                        }
                        refreshDownstream();
                    }
                }
            };
        }

        if (String(nodeData.name) !== NODE_CLASS) return;

        var originalCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            if (originalCreated) originalCreated.apply(this, arguments);
            var self = this;
            setTimeout(function () {
                syncCountWidget(self);
                var widget = findCountWidget(self);
                if (widget) {
                    var originalCallback = widget.callback;
                    widget.callback = function () {
                        if (originalCallback) {
                            originalCallback.apply(this, arguments);
                        }
                        refreshDownstream();
                    };
                }
                refreshDownstream();
            }, 0);
        };

        var originalExecuted = nodeType.prototype.onExecuted;
        nodeType.prototype.onExecuted = function () {
            if (originalExecuted) originalExecuted.apply(this, arguments);
            syncCountWidget(this);
            refreshDownstream();
        };
    },
});
