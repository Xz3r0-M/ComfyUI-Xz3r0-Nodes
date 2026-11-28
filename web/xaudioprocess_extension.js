/**
 * XAudioProcess — 用不到的参数自动变暗
 * ==================================
 *
 * 这个节点有一档叫 `Chain`（一次串好几步处理）。选中它以后，面板上会多出
 * 四个开关：重采样、压缩、响度归一、峰值限制。每个开关下面还跟着它自己
 * 的参数，比如「重采样」下面是采样率。
 *
 * 问题就出在这里：开关关掉以后，它下面的参数还在，看着能改，其实写多少都
 * 不算数。用户得自己去猜「这项现在到底算不算」。这里把这些「关掉了就别
 * 管」的参数统一变暗，一眼就知道哪几项在算数。
 *
 * 规则（左边一变，右边跟着变）：
 * - 重采样 = Disabled        → 采样率变暗
 * - 压缩 = Disabled          → 压缩预设 / 自定义比例开关 / 比例值 全变暗
 * - 自定义比例 = Disabled    → 比例值变暗
 * - 响度归一 = Disabled      → 目标响度变暗
 * - 峰值限制 = Disabled      → 峰值上限变暗
 *
 * 另外还有三档单项模式（Resample / Compress / Normalize / Limit），那一档
 * 只有它自己的参数，不存在「用不到」的情况，所以规则要放行——做法是：只要
 * 面板上没有那一串 `chain_*` 开关，就当它「一直算数」。
 *
 * 落地全靠共享工具 `web/core/widget-rules.js`（两个渲染器的钩子、置灰状态
 * 双写、widget 没挂完时的重试都在那里）。这里只写声明表。
 *
 * 一个容易踩的点：`Chain` 是 `DynamicCombo`，它展开出来的子项在面板上叫
 * `mode.chain_resample` 这种（带 `mode.` 前缀），而且**切换模式时会被整批
 * 销毁重建**。共享工具已经处理了重挂，这里只要把名字写对就行。
 */

import { registerWidgetRules } from "./core/widget-rules.js";

/* DynamicCombo 子输入在面板上的名字前缀。 */
const MODE = "mode.";

/** 读一个面板项当前的值；没有这一项时返回 undefined。 */
function widgetValue(node, name) {
    const widgets = (node && node.widgets) || [];
    for (let i = 0; i < widgets.length; i += 1) {
        if (widgets[i] && widgets[i].name === name) {
            return widgets[i].value;
        }
    }
    return undefined;
}

/**
 * 现在是不是 `Chain` 模式。
 *
 * 拿 `chain_compress` 当判据：它是 Chain 独有的一项，别的模式里根本没有。
 */
function inChain(node) {
    return widgetValue(node, MODE + "chain_compress") !== undefined;
}

/**
 * 「某一整步被关掉，它下面的参数就别管了」。
 *
 * 单项模式下（面板上没有 `chain_*` 开关）一律算「能用」，因为那一档只有
 * 它自己的参数，不存在被谁管着的问题。
 */
function stepEnabled(value, node) {
    if (!inChain(node)) return true;
    return value === true;
}

/**
 * 压缩比例能不能改。
 *
 * 两道门：自己的开关得打开，`Chain` 模式下还得「压缩」这一步本身没关。
 */
function ratioEnabled(value, node) {
    if (value !== true) return false;
    if (!inChain(node)) return true;
    return widgetValue(node, MODE + "chain_compress") === true;
}

registerWidgetRules({
    nodeClass: "XAudioProcess",
    rules: [
        {
            watch: MODE + "chain_resample",
            targets: {
                [MODE + "sample_rate"]: stepEnabled,
            },
        },
        {
            watch: MODE + "chain_compress",
            targets: {
                [MODE + "compression_mode"]: stepEnabled,
                [MODE + "use_custom_ratio"]: stepEnabled,
            },
        },
        {
            watch: MODE + "use_custom_ratio",
            targets: {
                [MODE + "custom_ratio"]: ratioEnabled,
            },
        },
        {
            watch: MODE + "chain_normalize",
            targets: {
                [MODE + "target_lufs"]: stepEnabled,
            },
        },
        {
            watch: MODE + "chain_limit",
            targets: {
                [MODE + "peak_limit"]: stepEnabled,
            },
        },
    ],
});
