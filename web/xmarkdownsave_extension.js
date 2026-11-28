/**
 * XMarkdownSave - 被接线接管的手填文本 / 用不到的分隔换行数
 * ===================================================
 *
 * 这个节点把内容分成头 / 正文 / 尾三段，每段都有两条来路：
 *
 *   header_input（接线，优先）→ header_text（手填，上面空着时才用）
 *   main_text_input         → text_content
 *   footer_input            → footer_text
 *
 * 一接线，对应的手填框就完全被忽略（后端注释写得很明确：
 * "When connected, this input takes priority"）。让它保持可编辑，
 * 用户会以为自己写的东西被用上了。
 *
 * 另一组：分隔符选了 none，后面那个「插几个换行」根本没地方使
 * （后端只在 newline 时才读它），一起置灰。
 */

import { registerWidgetRules, inputHasLink } from "./core/widget-rules.js";

registerWidgetRules({
    nodeClass: "XMarkdownSave",
    rules: [
        // 接线接管手填文本
        {
            targets: {
                header_text: (_v, node) => !inputHasLink(node, "header_input"),
                text_content: (_v, node) =>
                    !inputHasLink(node, "main_text_input"),
                footer_text: (_v, node) => !inputHasLink(node, "footer_input"),
            },
        },
        // 分隔符 = none 时，换行数用不到
        {
            watch: "before_main_separator",
            targets: { before_main_newline_count: ["newline"] },
        },
        {
            watch: "after_main_separator",
            targets: { after_main_newline_count: ["newline"] },
        },
    ],
});
