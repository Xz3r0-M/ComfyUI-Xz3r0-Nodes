/**
 * XListPull — 固定 50 路 Data 输出 + 视图显隐（方案 A）
 * ====================================================
 * 后端始终 50 路输出；前端不再 removeOutput。count 只控制
 * 可见窗口与高度，保证 origin_slot 与 Data N 身份稳定。
 *
 * 触发时机：
 * - count / list_input 连线变化
 * - count_display widget 值变化
 * - 当 XListCreate 的输入变化时，刷新下游 XListPull
 * - 当 XListRestore 的 slot_map 变化时，刷新下游 XListPull
 */

import { app } from "../../scripts/app.js";
import {
    applyVisibleSlotWindow,
    installStableSlotView,
    refreshOutputLinkSources,
    removeSlot,
    reorderSlots,
    slotLinkIdsOf,
} from "./x_stable_slots.js";
import {
    forEachNodeByComfyClass,
    getLinkInfo as subgraphGetLinkInfo,
} from "./x_subgraph_utils.js";

var NODE_CLASS = "XListPull";
var LIST_CREATE_CLASS = "XListCreate";
var LIST_RESTORE_CLASS = "XListRestore";
var MAX_OUTPUTS = 50;

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

/** inputCountLabel: XListCreate 输入端口名 "Input 3" / "输入 3" */
function inputCountLabel(num) {
    return t("Input " + num, "输入 " + num);
}

/**
 * 解析 Autogrow 槽位序号。
 * 兼容 input1 / inputs.input1 / inputs_input1。
 */
function resolveAutogrowSlotNumber(name) {
    var raw = String(name || "");
    var match = raw.match(/(?:^|[._])input(\d+)$/);
    if (!match) return 0;
    var num = parseInt(match[1], 10);
    return Number.isFinite(num) && num > 0 ? num : 0;
}

function isXListCreateAutogrowInput(name) {
    return resolveAutogrowSlotNumber(name) > 0;
}

function outputLinkCount(node, index) {
    if (!node || index < 0 || index >= node.outputs.length) return 0;
    var output = node.outputs[index];
    if (!output) return 0;
    if (Array.isArray(output.linkIds)) return output.linkIds.length;
    if (Array.isArray(output.links)) return output.links.length;
    if (output.linkId != null || output.link != null) return 1;
    return 0;
}

function dataSlotNumber(name) {
    var raw = String(name || "");
    var match = raw.match(/(?:^|[._])(?:data|Data)[ _]?(\d+)$/)
        || raw.match(/^Data\s+(\d+)$/)
        || raw.match(/^data_(\d+)$/);
    if (!match) {
        // Localized labels e.g. "数据 3" still map via trailing digits.
        match = raw.match(/(\d+)\s*$/);
        if (!match || !/数据|Data|data/i.test(raw)) return 0;
    }
    var num = parseInt(match[1], 10);
    return Number.isFinite(num) && num > 0 && num <= MAX_OUTPUTS ? num : 0;
}

function stableDataName(num) {
    return "data_" + num;
}

function getLinkInfo(graph, linkId) {
    return subgraphGetLinkInfo(graph, linkId);
}

function ensureOutputOrder(node) {
    if (!node || !Array.isArray(node.outputs)) return;
    var channels = [];
    var others = [];
    for (var index = 0; index < node.outputs.length; index++) {
        var output = node.outputs[index];
        var num = dataSlotNumber(output && output.name)
            || dataSlotNumber(output && output.label)
            || dataSlotNumber(output && output.localized_name);
        if (num > 0) {
            output.__xlistDataNum = num;
            channels.push(output);
        } else {
            others.push(output);
        }
    }
    channels.sort(function (left, right) {
        return (left.__xlistDataNum || 0) - (right.__xlistDataNum || 0);
    });
    // Deduplicate by channel number; keep first.
    var seen = {};
    var unique = [];
    for (var c = 0; c < channels.length; c++) {
        var n = channels[c].__xlistDataNum;
        if (seen[n]) continue;
        seen[n] = true;
        unique.push(channels[c]);
    }
    var ordered = unique.concat(others);
    var changed = ordered.length !== node.outputs.length;
    if (!changed) {
        for (var o = 0; o < ordered.length; o++) {
            if (ordered[o] !== node.outputs[o]) {
                changed = true;
                break;
            }
        }
    }
    if (!changed) return;
    // Duplicates are appended instead of dropped: removing a slot would drop
    // the links attached to it and shift every later slot's index.
    reorderSlots(node, "output", ordered, getLinkInfo, {
        keepUnlisted: true,
    });
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
        if (isXListCreateAutogrowInput(input.name) && input.link != null) {
            cnt++;
        }
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
    if (listInp && listInp.link != null && node.graph) {
        var linkObj = getLinkInfo(node.graph, listInp.link);
        if (linkObj) {
            // 上游 list 输出端口的实时类型优先。连线建立时的 link.type 可能
            // 还是 “*”（那时 XListCreate 还没接输入、类型未确定），只读
            // link.type 会把下游 Data 端口也卡在 “*”。
            var upstream = getUpstreamNode(node.graph, listInp.link);
            if (upstream && Array.isArray(upstream.outputs)) {
                var originSlot = linkObj.origin_slot;
                var upstreamOut = originSlot != null
                    ? upstream.outputs[originSlot]
                    : null;
                if (
                    upstreamOut
                    && upstreamOut.type
                    && upstreamOut.type !== "*"
                ) {
                    return upstreamOut.type;
                }
            }
            if (linkObj.type && linkObj.type !== "*") {
                return linkObj.type;
            }
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

function findDataOutputIndex(node, num) {
    if (!node || !Array.isArray(node.outputs)) return -1;
    var want = stableDataName(num);
    for (var i = 0; i < node.outputs.length; i++) {
        var output = node.outputs[i];
        if (!output) continue;
        if (output.name === want) return i;
        var n = dataSlotNumber(output.name)
            || dataSlotNumber(output.label)
            || dataSlotNumber(output.localized_name);
        if (n === num) return i;
    }
    return -1;
}

function syncOutputs(node, count) {
    // Scheme A: keep Data 1..50 outputs forever; count only hides extras.
    if (!node || !Array.isArray(node.outputs)) return;

    installStableSlotView(node);
    count = Math.max(1, Math.min(Math.floor(count) || 1, MAX_OUTPUTS));
    var linkType = getListInputType(node);

    for (var num = 1; num <= MAX_OUTPUTS; num++) {
        var idx = findDataOutputIndex(node, num);
        if (idx < 0) {
            if (typeof node.addOutput === "function") {
                node.addOutput(stableDataName(num), linkType || "*");
            } else {
                node.outputs.push({
                    name: stableDataName(num),
                    type: linkType || "*",
                    links: null,
                });
            }
            idx = findDataOutputIndex(node, num);
        }
        if (idx < 0) continue;
        var output = node.outputs[idx];
        output.name = stableDataName(num);
        output.label = dataCountLabel(num);
        output.localized_name = output.label;
    }

    ensureOutputOrder(node);

    // Keep any linked slot visible even if count shrank (old removeOutput
    // refused to delete linked tails; preserve that UX without dropping ids).
    var highestLinked = 0;
    for (var li = 0; li < node.outputs.length; li++) {
        if (outputLinkCount(node, li) <= 0) continue;
        var linkedNum = dataSlotNumber(node.outputs[li] && node.outputs[li].name)
            || dataSlotNumber(node.outputs[li] && node.outputs[li].label)
            || dataSlotNumber(
                node.outputs[li] && node.outputs[li].localized_name,
            );
        if (linkedNum > highestLinked) highestLinked = linkedNum;
    }
    var visible = Math.max(count, highestLinked);
    visible = Math.max(1, Math.min(MAX_OUTPUTS, visible));
    node.__xlistPullVisibleCount = visible;

    applyVisibleSlotWindow(node.outputs, function (slot) {
        return dataSlotNumber(slot && slot.name)
            || dataSlotNumber(slot && slot.label)
            || dataSlotNumber(slot && slot.localized_name);
    }, visible);

    // Type propagation for visible slots (and keep linked hidden slots typed).
    for (var oi = 0; oi < node.outputs.length; oi++) {
        var out = node.outputs[oi];
        if (!out) continue;
        var slotNum = dataSlotNumber(out.name) || 0;
        if (slotNum <= 0) continue;
        var shouldType = slotNum <= visible || outputLinkCount(node, oi) > 0;
        if (!shouldType) continue;
        if (linkType && linkType !== "*") {
            if (typeof node.setOutputType === "function") {
                node.setOutputType(oi, linkType);
            } else {
                out.type = linkType;
            }
        }
    }

    refreshOutputLinkSources(node, getLinkInfo);

    try {
        if (typeof node._setConcreteSlots === "function") {
            node._setConcreteSlots();
        }
        if (typeof node.arrange === "function") node.arrange();
        if (typeof node.computeSize === "function") {
            var cs = node.computeSize();
            if (cs && Array.isArray(cs)) {
                var nw = Math.max(1, cs[0] || 1);
                var nh = Math.max(1, cs[1] || 1);
                if (typeof node.setSize === "function") {
                    node.setSize([nw, nh]);
                } else {
                    node.size = [nw, nh];
                }
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

var MAX_CREATE_INPUTS = 50;
// 只补齐少量缺号，避免在异常状态下凭空造出一大堆空端口。
var MAX_CREATE_GAP_FILL = 8;

// LiteGraph 的槽位方向常量：输入。
function liteGraphInputSlotType() {
    if (typeof LiteGraph !== "undefined" && LiteGraph.INPUT != null) {
        return LiteGraph.INPUT;
    }
    return 1;
}

/**
 * XListCreate 的 Autogrow 输入按端口号排回正确顺序。
 *
 * 新版前端在加载工作流时会为已连接输入补出后续端口，找插入位置靠
 * 「名字前缀匹配」：给 input2 找前一个端口时，"inputs.input1" 会同时
 * 命中 input10…input19，于是端口被塞到错误位置，刷新后顺序变成
 * 1、10…19、2、3… 这类乱序。这里按端口号重排，并用 reorderSlots
 * 让连线跟着自己的端口一起移动。
 */
function ensureListCreateInputOrder(node) {
    if (!node || !Array.isArray(node.inputs)) return;
    var channels = [];
    var others = [];
    var seen = {};
    var highest = 0;
    for (var index = 0; index < node.inputs.length; index++) {
        var input = node.inputs[index];
        var slot = resolveAutogrowSlotNumber(input && input.name);
        if (slot > 0) {
            channels.push(input);
            seen[slot] = true;
            if (slot > highest) highest = slot;
        } else {
            others.push(input);
        }
    }
    if (channels.length < 2) return;
    // 缺号修复：乱序过程可能弄丢中间某个端口（如 21），这里按序号补齐空端口，
    // 和原生 Autogrow “端口必须连续”的预期一致。补齐数量有限，不改变已有连线。
    var missing = 0;
    var missingNums = [];
    for (var num = 1; num <= highest && num <= MAX_CREATE_INPUTS; num++) {
        if (seen[num]) continue;
        missing++;
        missingNums.push(num);
    }
    if (missing > 0 && missing <= MAX_CREATE_GAP_FILL) {
        for (var fill = 0; fill < missingNums.length; fill++) {
            var fillNum = missingNums[fill];
            var name = "inputs.input" + fillNum;
            if (typeof node.addInput !== "function") break;
            node.addInput(name, "*");
            var added = node.inputs[node.inputs.length - 1];
            if (!added) break;
            added.name = name;
            channels.push(added);
            seen[fillNum] = true;
        }
    }
    channels.sort(function (left, right) {
        return resolveAutogrowSlotNumber(left.name)
            - resolveAutogrowSlotNumber(right.name);
    });
    var ordered = channels.concat(others);
    var changed = ordered.length !== node.inputs.length;
    if (!changed) {
        for (var other = 0; other < ordered.length; other++) {
            if (ordered[other] !== node.inputs[other]) {
                changed = true;
                break;
            }
        }
    }
    if (changed) {
        // keepUnlisted：万一名单里漏了某个端口，宁可追加也不要丢掉它的连线。
        reorderSlots(node, "input", ordered, getLinkInfo, {
            keepUnlisted: true,
        });
    }
    trimTrailingEmptyListCreateInputs(node);
}

/** 该输入端口上是否挂着连线。 */
function listCreateInputHasLink(node, index) {
    if (!node || !Array.isArray(node.inputs) || !node.inputs[index]) {
        return false;
    }
    if (typeof node.getInputLink === "function" && node.getInputLink(index)) {
        return true;
    }
    return slotLinkIdsOf(node.inputs[index]).length > 0;
}

/**
 * 去掉末尾多余的空白输入端口。
 *
 * 原生 Autogrow 只会在「已连接的最大号」后面留一个空位（方便继续加端口）。
 * 前面的乱序/补齐可能留下好几个空白尾巴，这里把多出来的删掉，只保留一个。
 * 已连了线的端口绝不删除；什么都没接时至少保留两个空位（与原生一致）。
 */
function trimTrailingEmptyListCreateInputs(node) {
    if (!node || !Array.isArray(node.inputs)) return;
    var highestLinked = 0;
    for (var index = 0; index < node.inputs.length; index++) {
        var slot = resolveAutogrowSlotNumber(
            node.inputs[index] && node.inputs[index].name,
        );
        if (slot <= 0) continue;
        if (slot > highestLinked && listCreateInputHasLink(node, index)) {
            highestLinked = slot;
        }
    }
    var keepMax = Math.max(highestLinked + 1, 2);
    if (keepMax >= MAX_CREATE_INPUTS) return;
    for (var i = node.inputs.length - 1; i >= 0; i--) {
        var input = node.inputs[i];
        var num = resolveAutogrowSlotNumber(input && input.name);
        if (num <= keepMax) continue;
        if (listCreateInputHasLink(node, i)) continue;
        removeSlot(node, "input", input);
    }
}

/** 排序 + 标签 + 尺寸 + 类型刷新，XListCreate 加载后的统一收尾。 */
function normalizeXListCreate(node) {
    ensureListCreateInputOrder(node);
    syncXListCreateInputLabels(node);
    fixNodeSize(node);
    refreshListCreateTypes(node);
}

/**
 * 重算 XListCreate 的 MatchType 类型。
 *
 * 前端的类型串联（MatchType/多类型端口）只在「连线变化」时才重算，而且
 * 在加载工作流期间（configuringGraph）会直接跳过。我们重排端口后，连线
 * 换了位置但类型没跟着重算，于是 list 输出和各输入口的类型会停在 “*”。
 * 这里手动触发一次节点的连线回调，让它自己按当前连线重新算一遍类型。
 *
 * 只触发一次即可：前端的回调会遍历整个类型组，一次就把所有输入口和
 * 输出口的类型都重算完。选第一个（优先有连线的）输入口，避免落在末尾
 * 的空白口上触发自动加端口。
 */
function refreshListCreateTypes(node) {
    if (!node || !node.graph || !Array.isArray(node.inputs)) return;
    if (typeof node.onConnectionsChange !== "function") return;
    // 没连线时类型本来就是 “*”，不需要触发（也能避开前端的断线整理逻辑）。
    var chosen = -1;
    for (var index = 0; index < node.inputs.length; index++) {
        var input = node.inputs[index];
        if (!isXListCreateAutogrowInput(input && input.name)) continue;
        if (listCreateInputHasLink(node, index)) {
            chosen = index;
            break;
        }
    }
    if (chosen < 0) return;
    var slot = node.inputs[chosen];
    var link = typeof node.getInputLink === "function"
        ? node.getInputLink(chosen)
        : null;
    node.__xlistCreateRefreshingTypes = true;
    try {
        node.onConnectionsChange(
            liteGraphInputSlotType(),
            chosen,
            !!link,
            link || undefined,
            slot,
        );
    } catch (_e) {
        /* 类型刷新失败不应打断节点排版 */
    } finally {
        node.__xlistCreateRefreshingTypes = false;
    }
}

function syncXListCreateInputLabels(node) {
    if (!node || !Array.isArray(node.inputs)) return;
    var changed = false;
    for (var i = 0; i < node.inputs.length; i++) {
        var input = node.inputs[i];
        if (!input) continue;
        var slot = resolveAutogrowSlotNumber(input.name);
        if (slot <= 0) continue;
        var label = inputCountLabel(slot);
        if (input.label !== label) {
            input.label = label;
            changed = true;
        }
        if (input.localized_name !== label) {
            input.localized_name = label;
            changed = true;
        }
    }
    if (changed && typeof node.setDirtyCanvas === "function") {
        node.setDirtyCanvas(true, true);
    }
}


function fixXListCreateSizes(rootGraph) {
    // Walk the whole graph tree so Create nodes inside subgraphs are sized.
    var root = rootGraph || app.graph;
    if (!root) return;
    forEachNodeByComfyClass(root, LIST_CREATE_CLASS, function (node) {
        normalizeXListCreate(node);
    });
}

// ---------------------------------------------------------------------------
// 全局 refresh（带防抖）— 默认从 app.graph 整树刷新
// ---------------------------------------------------------------------------
var _refreshTimer = null;
function scheduleRefreshAll(_graph) {
    if (_refreshTimer) clearTimeout(_refreshTimer);
    _refreshTimer = setTimeout(function () {
        _refreshTimer = null;
        // Always refresh from the app root so nested subgraph Pulls update.
        doRefreshAll(app.graph);
    }, 50);
}

function doRefreshAll(rootGraph) {
    var root = rootGraph || app.graph;
    if (!root) return;
    // 先把 XListCreate 的端口顺序与类型弄对，下游 XListPull 再按新类型同步。
    forEachNodeByComfyClass(root, LIST_CREATE_CLASS, function (node) {
        ensureListCreateInputOrder(node);
        syncXListCreateInputLabels(node);
        fixNodeSize(node);
        refreshListCreateTypes(node);
    });
    forEachNodeByComfyClass(root, NODE_CLASS, function (node) {
        syncOutputs(node, resolveCount(node));
    });
}

// ---------------------------------------------------------------------------
// 扩展注册
// ---------------------------------------------------------------------------

app.registerExtension({
    name: "Xz3r0.XListPull",

    afterConfigureGraph: function () {
        // Full tree: Pull/Create may live inside nested subgraphs.
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
                    if (
                        slot
                        && isXListCreateAutogrowInput(slot.name || "")
                    ) {
                        // 我们自己刷新类型时会触发这个回调，此时不要再排队
                        // 刷新，否则会和 doRefreshAll 互相触发成死循环。
                        if (!node.__xlistCreateRefreshingTypes) {
                            scheduleRefreshAll(node.graph);
                        }
                        syncXListCreateInputLabels(node);
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

        // ---- XListCreate：本地化 Autogrow 输入端口标签 ----
        if (nodeData.name === LIST_CREATE_CLASS) {
            var origCreateCreated = nodeType.prototype.onNodeCreated;
            nodeType.prototype.onNodeCreated = function () {
                if (origCreateCreated) {
                    origCreateCreated.apply(this, arguments);
                }
                var self = this;
                setTimeout(function () {
                    normalizeXListCreate(self);
                }, 0);
            };
            return;
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
