/**
 * XMath - 用不到的基准值自动置灰
 * ==========================
 *
 * 这个节点每个值都有两条来路：
 *
 *   input_a（接线） ──优先──┐
 *                           ├──→ a
 *   basic_a（手填） ────────┘
 *
 * 谁说了算按这条来（后端 `xmath.py`）：
 *
 *     if use_input_a and input_a is not None:  a = input_a
 *     else:                                   a = basic_a
 *
 * 所以「手填值」被忽略只有一种情况：**开关打开 + 那一头真的接了线**。
 * 这时候 basic_a 写得再大也不会被用到，留着是让人犯嘀咕「我填了怎么没用」。
 *
 * 反过来两种情况都还能用，不能置灰：
 *   - 开关关掉 → 就算接了线也走手填值；
 *   - 开关打开但没接线 → 走手填值。
 *
 * 规则函数里读连线状态用 `inputHasLink`（共享工具提供的）。
 * 接线变化时重算由 `registerWidgetRules` 自己挂在 onConnectionsChange 上。
 */

import { registerWidgetRules, inputHasLink } from "./core/widget-rules.js";

registerWidgetRules({
    nodeClass: "XMath",
    rules: [
        {
            watch: "use_input_a",
            targets: {
                basic_a: (value, node) =>
                    !(value === true && inputHasLink(node, "input_a")),
            },
        },
        {
            watch: "use_input_b",
            targets: {
                basic_b: (value, node) =>
                    !(value === true && inputHasLink(node, "input_b")),
            },
        },
    ],
});
