/**
 * XMediaListGet 的「上游是谁、第几号口」 —— 一处算清，到处复用
 * ==========================================================
 * XListPull / XListToPipe / XPipe 都想知道上游 XMediaListGet 的启用数量
 * 和文件名。这套知识（哪个端口号对应哪个分类）以前抄了三份，改一次端口
 * 顺序就得改三处、漏一处就把视频当图片。现在只有这一份。
 *
 * 顺便把「跨子图」接上：某个节点在子图里、XMediaListGet 在外面时，连线
 * 源头是子图的输入代理节点，不是真的数据源。直接读 origin_id 只会拿到
 * 代理，于是一律算不出来——数量退回手填值、名字一片空白。
 */

import { inputLinkId } from "./slot-links.js";
import {
    getLinkInfo,
    resolveLinkSource,
} from "../x_subgraph_utils.js";

export var MEDIA_LIST_CLASS = "XMediaListGet";

export function isXMediaListGet(node) {
    return !!(
        node
        && String(node.comfyClass || node.type || "") === MEDIA_LIST_CLASS
    );
}

/**
 * 找出「某个输入口的上游，到底是哪个节点的第几号口」。
 *
 * 返回值里的 slot 是**上游节点自己的输出口序号**，可以直接拿去
 * 查它的 outputs[slot]，也可以喂给下面的数量 / 名字解析。
 *
 * @param {object} node
 * @param {string} inputName
 * @param {object} rootGraph
 * @returns {{node: object, graph: object, slot: number}|null}
 */
export function upstreamSource(node, inputName, rootGraph) {
    if (!node || !Array.isArray(node.inputs) || !node.graph) return null;
    var input = null;
    for (var index = 0; index < node.inputs.length; index++) {
        if (node.inputs[index] && node.inputs[index].name === inputName) {
            input = node.inputs[index];
            break;
        }
    }
    var linkId = input ? inputLinkId(node, input) : null;
    if (linkId == null) return null;
    var link = getLinkInfo(node.graph, linkId);
    if (!link) return null;
    return resolveLinkSource(node.graph, link, rootGraph || node.graph);
}

/**
 * 上游 XMediaListGet 某个端口上「启用了几个」。
 *
 * 端口和分类的对应见下面的取值表；面板每次变动都会把三个分类的启用数
 * 写到节点上（__xmlg_enabled_counts），所以这里是实时的，不用等执行。
 *
 * @returns {number} 算不出来返回 0（调用方自己决定怎么兜底）
 */
export function mediaListEnabledCount(node, originSlot) {
    if (!isXMediaListGet(node)) return 0;
    var counts = node.__xmlg_enabled_counts || null;
    var key = categoryForSlot(originSlot, COUNT_SLOTS);
    if (counts && key && counts[key] != null) {
        var value = Math.round(Number(counts[key])) || 0;
        return value > 0 ? value : 0;
    }
    var total = Math.round(Number(node.__xmlg_enabled_count)) || 0;
    return total > 0 ? total : 0;
}

/**
 * 上游 XMediaListGet 某个「名称」端口上的文件名列表。
 *
 * @returns {string[]|null} 不是名称端口 / 还没算出来时返回 null
 */
export function mediaListEnabledNames(node, originSlot) {
    if (!isXMediaListGet(node)) return null;
    var byKind = node.__xmlg_enabled_names || null;
    if (!byKind) return null;
    var key = categoryForSlot(originSlot, NAME_SLOTS);
    if (!key) return null;
    var list = byKind[key];
    return Array.isArray(list) ? list : null;
}

/*
 * 端口号 → 分类。必须和 xnode/xmedialistget.py 的输出顺序一致：
 * 每一类的端口挨在一起（列表 / 遮罩 / 数量 / 名称），所以序号是断开的。
 *
 *   0 images / 1 masks / 2 image_count / 3 image_names
 *   4 videos / 5 video_count / 6 video_names
 *   7 audios / 8 audio_count / 9 audio_names
 */
var COUNT_SLOTS = { 2: "image", 5: "video", 8: "audio" };
var NAME_SLOTS = { 3: "image", 6: "video", 9: "audio" };

function categoryForSlot(originSlot, table) {
    if (originSlot == null) return "";
    return table[originSlot] || "";
}
