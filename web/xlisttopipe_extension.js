/**
 * XListToPipe — count 端口驱动下游 XPipe 槽位展开
 * ==================================================
 * 与 XListPull 相同：count 连接时禁用 count_display；
 * 连线/widget 变化时刷新 XPipe 元数据。
 * 支持 count 来自 XListCreate 或 XListRestore。
 */

import { app } from "../../scripts/app.js";
import { inputConnected, inputLinkId } from "./core/slot-links.js";
import {
    scheduleXPipeRefresh,
} from "./xpipe_extension.js";
import { forEachNodeByComfyClass } from "./x_subgraph_utils.js";
import { rootGraphOf } from "./core/root-graph.js";
import {
    isXMediaListGet,
    mediaListEnabledCount,
    upstreamSource,
} from "./core/media-list-source.js";

var NODE_CLASS = "XListToPipe";
var LIST_CREATE_CLASS = "XListCreate";
var LIST_RESTORE_CLASS = "XListRestore";
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
                linkId: inputLinkId(node, input),
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

function resolveAutogrowSlotNumber(name) {
    var raw = String(name || "");
    var match = raw.match(/(?:^|[._])input(\d+)$/);
    if (!match) return 0;
    var num = parseInt(match[1], 10);
    return Number.isFinite(num) && num > 0 ? num : 0;
}

function countActiveInputs(node) {
    if (!node || !Array.isArray(node.inputs)) return 0;
    var count = 0;
    for (var index = 0; index < node.inputs.length; index++) {
        var input = node.inputs[index];
        if (!input || !inputConnected(node, input)) continue;
        if (resolveAutogrowSlotNumber(input.name) > 0) {
            count += 1;
        }
    }
    return Math.max(0, Math.min(PIPE_SLOTS, count));
}

/** Restore.count ≈ Create 已连接 Autogrow 槽位数（slot_map.width）。 */
function resolveRestoreWidth(restoreNode) {
    if (!restoreNode || !restoreNode.graph) return 0;
    var mapSource = upstreamSource(
        restoreNode,
        "slot_map",
        rootGraphOf(app),
    );
    if (mapSource && mapSource.node.comfyClass === LIST_CREATE_CLASS) {
        return countActiveInputs(mapSource.node);
    }
    return 0;
}


function resolveCount(node) {
    if (!node) return 1;
    var countSource = upstreamSource(node, "count", rootGraphOf(app));
    if (countSource) {
        var upstream = countSource.node;
        if (upstream && upstream.comfyClass === LIST_CREATE_CLASS) {
            var listCount = countActiveInputs(upstream);
            if (listCount > 0) {
                return Math.max(1, Math.min(PIPE_SLOTS, listCount));
            }
        }
        if (upstream && upstream.comfyClass === LIST_RESTORE_CLASS) {
            var restoreWidth = resolveRestoreWidth(upstream);
            if (restoreWidth > 0) {
                return Math.max(1, Math.min(PIPE_SLOTS, restoreWidth));
            }
        }
        if (isXMediaListGet(upstream)) {
            var mediaCount = mediaListEnabledCount(
                upstream,
                countSource.slot,
            );
            if (mediaCount > 0) {
                return Math.max(1, Math.min(PIPE_SLOTS, mediaCount));
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
    scheduleXPipeRefresh();
}


app.registerExtension({
    name: "Xz3r0.XListToPipe",

    setup: function () {
        // XMediaListGet 面板里启用/禁用文件会改变数量输出，
        // 收到通知就重算一次（下游管道槽位跟着变）。
        if (!window.__xlistToPipeMediaCountListenerInstalled) {
            window.__xlistToPipeMediaCountListenerInstalled = true;
            document.addEventListener(
                "xmedialistget:count-changed",
                function () {
                    if (!rootGraphOf(app)) return;
                    forEachNodeByComfyClass(
                        rootGraphOf(app),
                        NODE_CLASS,
                        function (node) {
                            syncCountWidget(node);
                        },
                    );
                    refreshDownstream();
                },
            );
        }
    },

    afterConfigureGraph: function () {
        // Full graph tree so ToPipe nodes inside subgraphs sync too.
        if (!rootGraphOf(app)) return;
        forEachNodeByComfyClass(rootGraphOf(app), NODE_CLASS, function (node) {
            syncCountWidget(node);
        });
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

                // Fast path: skip everything for unrelated node classes so
                // generic canvas edits never pay for slot lookups below.
                if (
                    node.comfyClass !== LIST_CREATE_CLASS
                    && node.comfyClass !== LIST_RESTORE_CLASS
                    && node.comfyClass !== NODE_CLASS
                ) {
                    return;
                }

                if (node.comfyClass === LIST_CREATE_CLASS) {
                    var createSlot = slotInfo
                        || (node.inputs && node.inputs[index]);
                    var createName = String(
                        (createSlot && createSlot.name) || ""
                    );
                    if (/(?:^|[._])input\d+$/.test(createName)) {
                        // XListCreate input changes should re-expand
                        // downstream XPipe.
                        refreshDownstream();
                    }
                }

                if (node.comfyClass === LIST_RESTORE_CLASS) {
                    var restoreSlot = slotInfo
                        || (node.inputs && node.inputs[index]);
                    if (
                        restoreSlot
                        && (
                            restoreSlot.name === "slot_map"
                            || restoreSlot.name === "list_input"
                        )
                    ) {
                        refreshDownstream();
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
