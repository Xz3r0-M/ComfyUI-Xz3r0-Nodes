/**
 * XImageResize - 用不到的选项自动置灰 / 藏起来 + 老工作流数值不串位
 * ============================================================
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
 * - 缩放基准 = 按宽 / 按高  → 同上（也是用「目标边长」）
 * - 缩放基准 = 百万像素      → 只有「百万像素」有效，另两项变暗
 * - 缩放基准 = 缩放倍率      → 只有「缩放倍率」有效，另两项变暗；
 *                              缩放条件在倍率模式下本来就被忽略，一起变暗
 * - 整除模式 = Disabled      → 「整除数」变暗
 * - 补边 = Disabled          → 补边那一整组全藏起来
 * - 补边比例 = None（无比例）→ 用「画布宽 / 高」
 * - 补边比例 ≠ None          → 画布尺寸自动算出来，宽 / 高藏起来
 */

import { app } from "../../scripts/app.js";
import {
    registerWidgetRules,
    syncWidgetRules,
} from "./core/widget-rules.js";

const PAD_RATIO_NONE = "None";

/**
 * 只有新版才有的输入 → 默认值。
 *
 * 老工作流读进来时，ComfyUI 会按**位置**把这些输入也一起塞上值，于是
 * 后面的输入会串到前面来。凡是旧顺序里没有的项，一律回到默认值。
 */
const NEW_WIDGET_DEFAULTS = {
    pad_ratio: PAD_RATIO_NONE,
};

/**
 * 老工作流的 `widgets_values` 顺序（按位置存的）。
 *
 * 三版旧面板都要认：17 项（补边比例之前，真正发布过的那版）、
 * 18 项（比例排在补边颜色后面）、19 项（还带着已删掉的「补边长边」）。
 */
const LEGACY_ORDERS = [
    [
        // 17 项：补边比例之前
        "use_passed_settings",
        "output_resize_settings",
        "scale_mode",
        "edge_mode",
        "resize_condition",
        "target_edge",
        "megapixels",
        "scale_multiplier",
        "divisible_mode",
        "divisible",
        "width_offset",
        "height_offset",
        "pad_enabled",
        "pad_width",
        "pad_height",
        "pad_color",
        "skip_on_empty",
    ],
    [
        // 18 项：比例排在补边颜色后面（面板顺序还没调过来那版）
        "use_passed_settings",
        "output_resize_settings",
        "scale_mode",
        "edge_mode",
        "resize_condition",
        "target_edge",
        "megapixels",
        "scale_multiplier",
        "divisible_mode",
        "divisible",
        "width_offset",
        "height_offset",
        "pad_enabled",
        "pad_width",
        "pad_height",
        "pad_color",
        "pad_ratio",
        "skip_on_empty",
    ],
    [
        // 19 项：还带着已删掉的「补边长边」
        "use_passed_settings",
        "output_resize_settings",
        "scale_mode",
        "edge_mode",
        "resize_condition",
        "target_edge",
        "megapixels",
        "scale_multiplier",
        "divisible_mode",
        "divisible",
        "width_offset",
        "height_offset",
        "pad_enabled",
        "pad_width",
        "pad_height",
        "pad_color",
        "pad_ratio",
        "pad_base_edge",
        "skip_on_empty",
    ],
];

function widgetOf(node, name) {
    const widgets = node && node.widgets;
    if (!widgets) return null;
    for (let i = 0; i < widgets.length; i += 1) {
        if (widgets[i] && widgets[i].name === name) return widgets[i];
    }
    return null;
}

function widgetValue(node, name) {
    const widget = widgetOf(node, name);
    return widget ? widget.value : undefined;
}

/** 补边总开关。 */
function padOn(node) {
    return widgetValue(node, "pad_enabled") === true;
}

/** 画布宽 / 高：只在「补边开着 + 没选比例」时才算数。 */
function padSidesEnabled(_value, node) {
    return padOn(node) && widgetValue(node, "pad_ratio") === PAD_RATIO_NONE;
}

/** 补边颜色 / 比例本身：补边开着就够了。 */
function padCommonEnabled(_value, node) {
    return padOn(node);
}

registerWidgetRules({
    nodeClass: "XImageResize",
    rules: [
        {
            watch: "edge_mode",
            targets: {
                // 这四档都靠「目标边长」定尺寸
                target_edge: ["Long", "Short", "Width", "Height"],
                megapixels: ["Megapixels"],
                scale_multiplier: ["Scale Multiplier"],
                // 倍率模式会忽略缩放条件（见 tooltip），所以也一起变暗
                resize_condition: [
                    "Long",
                    "Short",
                    "Width",
                    "Height",
                    "Megapixels",
                ],
            },
        },
        {
            watch: "divisible_mode",
            targets: { divisible: ["Nearest", "Up", "Down"] },
        },
        {
            watch: "pad_enabled",
            action: "hide",
            targets: {
                pad_width: padSidesEnabled,
                pad_height: padSidesEnabled,
                pad_color: padCommonEnabled,
                pad_ratio: padCommonEnabled,
            },
        },
        {
            // 比例一变：手填宽高 和「自动算画布」之间换着来
            watch: "pad_ratio",
            action: "hide",
            targets: {
                pad_width: padSidesEnabled,
                pad_height: padSidesEnabled,
            },
        },
    ],
});

/**
 * 老工作流按名字搬值：只认「数值个数正好等于旧顺序，且新输入已经挂上」，
 * 新文件不会被误伤；返回是否真的迁移过。
 */
export function migrateLegacyWidgetValues(node, widgetsValues) {
    if (!node || !Array.isArray(widgetsValues)) return false;
    const legacyOrder = LEGACY_ORDERS.find(
        (order) => order.length === widgetsValues.length
    );
    if (!legacyOrder) return false;
    // 新结构里一定有这一项；老前端没拉到新 schema 时就不动
    if (!widgetOf(node, "pad_ratio")) return false;
    // 「比例排在补边开关后面」是新顺序的标记：老顺序那个格子放的是
    // 补边宽度（数字）。长度同为 18 的新工作流靠这一条区分开，
    // 不会被当成旧文件搬错。
    if (typeof widgetValue(node, "pad_ratio") === "string") return false;

    legacyOrder.forEach((name, index) => {
        const widget = widgetOf(node, name);
        if (widget) widget.value = widgetsValues[index];
    });
    // 旧顺序里没有的项：把按位置串进来的垃圾值清掉
    Object.keys(NEW_WIDGET_DEFAULTS).forEach((name) => {
        if (legacyOrder.indexOf(name) !== -1) return;
        const widget = widgetOf(node, name);
        if (widget) widget.value = NEW_WIDGET_DEFAULTS[name];
    });
    return true;
}

app.registerExtension({
    name: "ComfyUI.Xz3r0.XImageResize.LegacyValues",
    beforeRegisterNodeDef(nodeType, nodeData) {
        if (!nodeData || nodeData.name !== "XImageResize") return;
        const proto = nodeType.prototype;

        const origConfigure = proto.onConfigure;
        proto.onConfigure = function (info) {
            const result = origConfigure
                ? origConfigure.apply(this, arguments)
                : undefined;
            // 读工作流时 widgets_values 还在 info 上，正好拿来判断新旧
            if (info && migrateLegacyWidgetValues(this, info.widgets_values)) {
                // 值刚被改过：让画布和显隐状态都按新值重算一遍
                this.setDirtyCanvas?.(true, true);
                syncWidgetRules(this);
            }
            return result;
        };
    },
});
