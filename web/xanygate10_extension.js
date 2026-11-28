/**
 * XAnyGate10 - 递归顺序在递归关闭时置灰
 * =================================
 *
 * 「递归输出」那一路上找顺序完全由 recursive_order 决定
 * （`1-2-3-4-5` 这种）。递归开关一关，这一串就再也不会被读，
 * 留着只会让人以为「顺序写错了」。
 *
 * 注意只动 recursive_order 这一项：
 * enable_1 ~ enable_10 是各个通道自己的开关，跟递归无关，
 * 递归关掉时它们照样各管各的。
 */

import { registerWidgetRules } from "./core/widget-rules.js";

registerWidgetRules({
    nodeClass: "XAnyGate10",
    rules: [
        {
            watch: "enable_recursive",
            targets: { recursive_order: [true] },
        },
    ],
});
