/**
 * XAudioSave — 用不到的参数自动变暗
 * ================================
 *
 * 保存音频时可以顺手做两件加工：压一下动态（压缩）、掐一下峰值（限制）。
 * 两个都是开关，关掉以后它下面的参数还留在面板上，看着能改，其实写多少都
 * 不算数。这里把那些「开关关了就别管」的参数统一变暗。
 *
 * 规则（左边一变，右边跟着变）：
 * - 峰值限制 = Disabled    → 峰值上限（dB）变暗
 * - 压缩 = Disabled        → 压缩预设 / 自定义比例开关 / 比例值 全变暗
 * - 自定义比例 = Disabled  → 比例值变暗
 *
 * 注意「比例值」有两条规则同时在管：压缩关了要暗，自定义比例关了也要暗。
 * 共享工具的合并规则是「有一条说能用就算能用」，所以两条规则里的判断都写成
 * **完整结论**（把另一个条件一起算进去），不然会互相盖掉。
 *
 * 落地全靠共享工具 `web/core/widget-rules.js`（两个渲染器的钩子、置灰状态
 * 双写、widget 没挂完时的重试都在那里）。这里只写声明表。
 */

import { registerWidgetRules } from "./core/widget-rules.js";

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

registerWidgetRules({
    nodeClass: "XAudioSave",
    rules: [
        {
            watch: "enable_peak_limiter",
            targets: {
                peak_limit: [true],
            },
        },
        {
            watch: "enable_compression",
            targets: {
                compression_mode: [true],
                use_custom_ratio: [true],
            },
        },
        {
            watch: "use_custom_ratio",
            targets: {
                /*
                 * 两道门都要过：自己的开关打开，并且压缩整体没关。
                 * 写成完整结论，是因为「压缩」那条规则也会给同一个项下判断。
                 */
                custom_ratio: (value, node) =>
                    value === true &&
                    widgetValue(node, "enable_compression") === true,
            },
        },
    ],
});
