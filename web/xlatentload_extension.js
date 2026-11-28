/**
 * XLatentLoad - 接了输入口就不用再看文件下拉
 * =====================================
 *
 * 这个节点两条来路，输入口优先：
 *
 *   latent_input（接线，优先）→ 有就不读文件
 *   latent_file （下拉）      → 上面空着时才读
 *
 * 所以只要 latent_input 一接线，文件下拉写什么都不算数。
 * 这时把它置灰，比让用户对着一份「选了但没生效」的文件名强。
 *
 * 纯粹的连线驱动：没有哪个参数能反映「接没接线」，
 * 所以规则不写 watch，只给函数形式的 target。
 * （这种规则每次 syncWidgetRules 都会重算，接线一变就刷新。）
 */

import { registerWidgetRules, inputHasLink } from "./core/widget-rules.js";

registerWidgetRules({
    nodeClass: "XLatentLoad",
    rules: [
        {
            targets: {
                latent_file: (_value, node) =>
                    !inputHasLink(node, "latent_input"),
            },
        },
    ],
});
