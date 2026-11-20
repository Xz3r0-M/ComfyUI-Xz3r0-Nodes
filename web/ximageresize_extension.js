/**
 * XImageResize - 用不到的选项自动置灰
 * ================================
 *
 * 面板上十几项参数里，任何时候真正算数的只有几项。比如「缩放基准」选了
 * 长边，那「百万像素」和「缩放倍率」这两项无论写成多少都不会被用到。放着
 * 不管，用户就得自己去猜「这项现在算不算数」。
 *
 * 这里只写「哪些项跟着哪个选择走」这张表，剩下的交给共享工具
 * `web/core/widget-rules.js`（它负责两个渲染器的钩子、置灰状态双写、
 * widget 还没挂完时的重试）。
 *
 * 规则（左边一变，右边跟着变）：
 * - 缩放基准 = 不缩放        → 跟缩放有关的四项全暗（只做整除、偏移、补边）
 * - 缩放基准 = 长边 / 短边  → 只有「目标边长」有效，百万像素 / 缩放倍率变暗
 * - 缩放基准 = 百万像素      → 只有「百万像素」有效，另两项变暗
 * - 缩放基准 = 缩放倍率      → 只有「缩放倍率」有效，另两项变暗；
 *                              缩放条件在倍率模式下本来就被忽略，一起变暗
 * - 整除模式 = Disabled      → 「整除数」变暗
 * - 补边 = Disabled          → 补边目标宽 / 高 / 颜色三项变暗
 */

import { registerWidgetRules } from "./core/widget-rules.js";

registerWidgetRules({
    nodeClass: "XImageResize",
    rules: [
        {
            watch: "edge_mode",
            targets: {
                target_edge: ["Long", "Short"],
                megapixels: ["Megapixels"],
                scale_multiplier: ["Scale Multiplier"],
                // 倍率模式会忽略缩放条件（见 tooltip），所以也一起变暗
                resize_condition: ["Long", "Short", "Megapixels"],
            },
        },
        {
            watch: "divisible_mode",
            targets: { divisible: ["Nearest", "Up", "Down"] },
        },
        {
            watch: "pad_enabled",
            targets: {
                pad_width: [true],
                pad_height: [true],
                pad_color: [true],
            },
        },
    ],
});
