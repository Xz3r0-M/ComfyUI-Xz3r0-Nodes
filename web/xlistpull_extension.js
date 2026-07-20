/**
 * XListPull — 动态输出端口可见性控制
 * =====================================
 * 根据 count 值自动增减输出端口。
 *
 * 触发时机：
 * - count / list_input 连线变化
 * - count_display widget 值变化
 * - 当 XListCreate 的输入变化时，刷新下游 XListPull
 * - 当 XListRestore 的 slot_map 变化时，刷新下游 XListPull
 */

import { app } from "../../scripts/app.js";

var NODE_CLASS = "XListPull";
var LIST_CREATE_CLASS = "XListCreate";
var LIST_RESTORE_CLASS = "XListRestore";
var MAX_OUTPUTS = 20;

/** 获取当前 ComfyUI 语言设置 */
function resolveLocale() {
    try {
        var locale =
            app.extensionManager?.setting?.get?.("Comfy.Locale") || "";
        if (locale && (locale.startsWith("zh") || locale === "cn"))
            return "zh";
    } catch (_e) {
        /* ignore */
    }
    return "en";
}

/** 简单中英翻译（每次调用实时查语言设置） */
function t(en, zh) {
    return resolveLocale() === "zh" ? zh : en;
}

/** dataCountLabel: 输出端口名 "Data 3" / "数据 3" */
function dataCountLabel(num) {
    return t("Data " + num, "数据 " + num);
}

function outputLinkCount(node, index) {
    if (!node || index < 0 || index >= node.outputs.length) return 0;
    var output = node.outputs[index];
    return (output && output.links && output.links.length) || 0;
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
    var cnt = 0;
    for (var i = 0; i < node.inputs.length; i++) {
        var input = node.inputs[i];
        if (!input) continue;
        var isAutogrow =
            /^input\d+$/.test(input.name || "") ||
            (input.name && input.name.indexOf("input") === 0);
        if (isAutogrow && input.link != null) cnt++;
    }
    return cnt;
}

/** 在节点上按名称找输入端口的 linkId */
function findNamedInputLink(node, name) {
    if (!node || !Array.isArray(node.inputs)) return null;
    for (var i = 0; i < node.inputs.length; i++) {
        var inp = node.inputs[i];
        if (!inp || inp.name !== name) continue;
        return inp.link != null ? inp.link : null;
    }
    return null;
}

/**
 * XListRestore.count = slot_map.width。
 * 前端从 Restore.slot_map 追溯到 XListCreate，用其已连接 Autogrow 槽位数近似 width。
 */
function resolveRestoreWidth(restoreNode) {
    if (!restoreNode || !restoreNode.graph) return 0;
    var linkId = findNamedInputLink(restoreNode, "slot_map");
    if (linkId == null) return 0;
    var source = getUpstreamNode(restoreNode.graph, linkId);
    if (source && source.comfyClass === LIST_CREATE_CLASS) {
        return countActiveInputs(source);
    }
    return 0;
}


/** 找到 count 端口（force_input），返回 index 和 linkId */
function findCountPort(node) {
    if (!node || !Array.isArray(node.inputs))
        return { idx: -1, linkId: null };
    for (var i = 0; i < node.inputs.length; i++) {
        var inp = node.inputs[i];
        if (!inp) continue;
        if (inp.name === "count")
            return { idx: i, linkId: inp.link != null ? inp.link : null };
    }
    return { idx: -1, linkId: null };
}

/** 找到 count_display widget（原生 Int widget） */
function findCountWidget(node) {
    if (!node || !node.widgets) return null;
    for (var i = 0; i < node.widgets.length; i++) {
        if (node.widgets[i].name === "count_display")
            return node.widgets[i];
    }
    return null;
}

function resolveCount(node) {
    if (!node) return 1;

    // 1) count 端口有连接 → 追踪上游 list 结构节点
    var cp = findCountPort(node);
    if (cp.linkId != null && node.graph) {
        var upstream = getUpstreamNode(node.graph, cp.linkId);
        if (upstream && upstream.comfyClass === LIST_CREATE_CLASS) {
            var createCount = countActiveInputs(upstream);
            if (createCount > 0) return Math.min(createCount, MAX_OUTPUTS);
        }
        if (upstream && upstream.comfyClass === LIST_RESTORE_CLASS) {
            var restoreWidth = resolveRestoreWidth(upstream);
            if (restoreWidth > 0) {
                return Math.min(restoreWidth, MAX_OUTPUTS);
            }
        }
        // 其它 INT 上游：回退 widget，直到执行时由后端 count 决定
    }

    // 2) count 端口无连接 / 无法从前端推断 → 用 count_display widget
    var w = findCountWidget(node);
    if (w && w.value != null) {
        return Math.max(
            1,
            Math.min(Math.round(Number(w.value)) || 1, MAX_OUTPUTS)
        );
    }
    return 1;
}

/** 从 list_input 的 link 对象中读取真实类型（如 IMAGE / MODEL，而非 *） */
function getListInputType(node) {
    var listInp = null;
    for (var i = 0; i < node.inputs.length; i++) {
        if (node.inputs[i] && node.inputs[i].name === "list_input") {
            listInp = node.inputs[i];
            break;
        }
    }
    if (listInp && listInp.link != null && node.graph && node.graph.links) {
        var linkObj = node.graph.links[listInp.link];
        if (linkObj && linkObj.type && linkObj.type !== "*") {
            return linkObj.type;
        }
    }
    // fallback: 从已有输出中找
    if (node.outputs) {
        for (var j = 0; j < node.outputs.length; j++) {
            var ot = node.outputs[j] && node.outputs[j].type;
            if (ot && ot !== "*") return ot;
        }
    }
    return "*";
}

function syncOutputs(node, count) {
    if (!node || !Array.isArray(node.outputs)) return;

    count = Math.max(1, Math.min(Math.floor(count) || 1, MAX_OUTPUTS));
    var linkType = getListInputType(node);

    // 删除多余端口（仅未连接的）
    while (node.outputs.length > count) {
        var idx = node.outputs.length - 1;
        if (outputLinkCount(node, idx) > 0) break;
        if (typeof node.removeOutput === "function") {
            node.removeOutput(idx);
        } else {
            node.outputs.splice(idx, 1);
        }
    }

    // 添加不足端口
    while (node.outputs.length < count) {
        var num = node.outputs.length + 1;
        node.addOutput(dataCountLabel(num), linkType);
    }

    // 用 LiteGraph 的 setOutputType 传播类型到所有 * 输出
    if (linkType !== "*" && typeof node.setOutputType === "function") {
        for (var oi = 0; oi < node.outputs.length; oi++) {
            var ot = node.outputs[oi] && node.outputs[oi].type;
            if (!ot || ot === "*") {
                node.setOutputType(oi, linkType);
            }
        }
    }

    // 重算尺寸
    try {
        if (typeof node._setConcreteSlots === "function")
            node._setConcreteSlots();
        if (typeof node.arrange === "function") node.arrange();
        if (typeof node.computeSize === "function") {
            var cs = node.computeSize();
            if (cs && Array.isArray(cs)) {
                var nw = Math.max(1, cs[0] || 1);
                var nh = Math.max(1, cs[1] || 1);
                if (typeof node.setSize === "function")
                    node.setSize([nw, nh]);
                else node.size = [nw, nh];
            }
        }
    } catch (_e) {
        /* ignore */
    }

    if (typeof node.setDirtyCanvas === "function") {
        node.setDirtyCanvas(true, true);
    }
}

// ---------------------------------------------------------------------------
// 节点尺寸修正（XListCreate 工作流加载后 size 可能不匹配）
// ---------------------------------------------------------------------------

function fixNodeSize(node) {
    if (!node) return;
    try {
        if (typeof node._setConcreteSlots === "function")
            node._setConcreteSlots();
        if (typeof node.arrange === "function") node.arrange();
        if (typeof node.computeSize === "function") {
            var cs = node.computeSize();
            if (cs && Array.isArray(cs)) {
                var w = Math.max(1, cs[0] || 1);
                var h = Math.max(1, cs[1] || 1);
                if (typeof node.setSize === "function")
                    node.setSize([w, h]);
                else node.size = [w, h];
            }
        }
    } catch (_e) {
        /* ignore */
    }
}

function fixXListCreateSizes(graph) {
    if (!graph) return;
    var nodes = graph._nodes || graph.nodes || [];
    for (var i = 0; i < nodes.length; i++) {
        if (nodes[i] && nodes[i].comfyClass === "XListCreate") {
            fixNodeSize(nodes[i]);
        }
    }
}

// ---------------------------------------------------------------------------
// 全局 refresh（带防抖）
// ---------------------------------------------------------------------------
var _refreshTimer = null;
function scheduleRefreshAll(graph) {
    if (_refreshTimer) clearTimeout(_refreshTimer);
    _refreshTimer = setTimeout(function () {
        _refreshTimer = null;
        doRefreshAll(graph);
    }, 50);
}

function doRefreshAll(graph) {
    if (!graph) return;
    var nodes = graph._nodes || graph.nodes || [];
    for (var i = 0; i < nodes.length; i++) {
        var n = nodes[i];
        if (n && n.comfyClass === NODE_CLASS) {
            syncOutputs(n, resolveCount(n));
        }
    }
}

// ---------------------------------------------------------------------------
// 扩展注册
// ---------------------------------------------------------------------------

app.registerExtension({
    name: "Xz3r0.XListPull",

    afterConfigureGraph: function () {
        doRefreshAll(app.graph);
        fixXListCreateSizes(app.graph);
    },

    beforeRegisterNodeDef: function (nodeType, nodeData) {
        // ===========================================================
        // 全局钩子：在所有节点类型上挂 onConnectionsChange
        // ===========================================================
        if (!nodeType.prototype.__xlistpull_hooked) {
            nodeType.prototype.__xlistpull_hooked = true;
            var origConn = nodeType.prototype.onConnectionsChange;
            nodeType.prototype.onConnectionsChange = function (
                type,
                index,
                connected,
                linkInfo,
                slotInfo
            ) {
                if (origConn) origConn.apply(this, arguments);
                var node = this;

                // XListCreate 输入变化 → 刷新下游 XListPull + 修正自身尺寸
                if (node.comfyClass === LIST_CREATE_CLASS) {
                    var slot =
                        slotInfo || (node.inputs && node.inputs[index]);
                    if (slot && /^input\d*$/.test(slot.name || "")) {
                        scheduleRefreshAll(node.graph);
                        fixNodeSize(node);
                    }
                }

                // XListRestore slot_map / list_input 变化 → 刷新下游 Pull
                if (node.comfyClass === LIST_RESTORE_CLASS) {
                    var restoreSlot =
                        slotInfo || (node.inputs && node.inputs[index]);
                    if (
                        restoreSlot &&
                        (restoreSlot.name === "slot_map" ||
                            restoreSlot.name === "list_input")
                    ) {
                        scheduleRefreshAll(node.graph);
                    }
                }

                // XListPull 自身 count / list_input 变化 → 同步自己
                if (node.comfyClass === NODE_CLASS) {
                    var s =
                        slotInfo || (node.inputs && node.inputs[index]);
                    if (
                        s &&
                        (s.name === "count" || s.name === "list_input")
                    ) {
                        // count 连线变化 → toggle count_display widget disabled
                        if (s.name === "count") {
                            var w2 = findCountWidget(node);
                            if (w2) w2.disabled = !!connected;
                        }
                        syncOutputs(node, resolveCount(node));
                    }
                }
            };
        }

        if (nodeData.name !== NODE_CLASS) return;

        // ---- onNodeCreated — 绑定原生 count_display widget ----
        var origCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            if (origCreated) origCreated.apply(this, arguments);
            var self = this;
            setTimeout(function () {
                var cp = findCountPort(self);
                var connected = cp.linkId != null;
                var w = findCountWidget(self);
                if (w) {
                    w.disabled = connected;
                    var origCb = w.callback;
                    w.callback = function (v) {
                        if (origCb) origCb.apply(this, arguments);
                        syncOutputs(self, resolveCount(self));
                    };
                }
                syncOutputs(self, resolveCount(self));
            }, 0);
        };

        // ---- onExecuted — 执行后同步（不覆盖手动数量设置） ----
        var origExecuted = nodeType.prototype.onExecuted;
        nodeType.prototype.onExecuted = function (output) {
            if (origExecuted) origExecuted.apply(this, arguments);
            // 始终用 resolveCount，不自动从输出推断数量
            syncOutputs(this, resolveCount(this));
        };
    },
});
