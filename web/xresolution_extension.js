/**
 * XResolution —— 用不到的选项自动置灰 + 老工作流数值不串位
 * =====================================================
 *
 * 面板上有两个下拉框决定「尺寸怎么算」，其余项跟着亮灭 / 显隐：
 *
 * - 尺寸模式 = Resolution：预设 + 宽高决定尺寸，缩放倍率生效；
 * - 尺寸模式 = Megapixels：画面比例 + 百万像素决定尺寸，倍率不生效；
 * - 尺寸模式 = Width only：只给宽度，高度按比例算；
 * - 尺寸模式 = Height only：只给高度，宽度按比例算。
 *
 * 另外「预设不是 Custom」时宽高被预设覆盖，值也不该再改。所以宽 / 高
 * 的可用性同时取决于「尺寸模式、预设」两个下拉框——这种「多个下拉框
 * 共同决定一项」用函数形式的规则写，函数能拿到节点
 * （见 `web/core/widget-rules.js`）。
 *
 * 「画面比例」选到 Custom 时，多出来的「宽:高」两个输入框平时是藏起来
 * 的（`action: "hide"`）——藏起来比变灰更干净：不用的时候完全看不到。
 *
 * 另一件事是**老工作流兼容**：这个节点的面板重新排过版，而工作流里的
 * `widgets_values` 是按位置存的数组，直接换顺序会让老文件里的数值整体
 * 错位。所以下面按名字把老顺序的值搬回各自的输入框。
 */

import { app } from "../../scripts/app.js";
import {
    registerWidgetRules,
    syncWidgetRules,
} from "./core/widget-rules.js";

const MODE_RESOLUTION = "Resolution";
const MODE_MEGAPIXELS = "Megapixels";
const MODE_WIDTH_ONLY = "Width only";
const MODE_HEIGHT_ONLY = "Height only";
const RATIO_CUSTOM = "Custom";
const RATIO_DEFAULT = "1:1";
const PRESET_CUSTOM = "Custom";

/**
 * 老工作流的 `widgets_values` 顺序（按位置存的），长的在前。
 *
 * - 12 项 = 「尺寸模式 + 画面比例」那一版（还没有手动宽:高）
 * - 10 项 = 短暂出现过的「百万像素排在自定义高度下面」版本
 * - 9 项 = 最早那一版（没有「百万像素」）
 */
const LEGACY_ORDERS = [
    [
        "size_mode",
        "preset",
        "width",
        "height",
        "aspect_ratio",
        "megapixels",
        "scale",
        "swap",
        "divisible_mode",
        "divisible",
        "width_offset",
        "height_offset",
    ],
    [
        "preset",
        "width",
        "height",
        "megapixels",
        "scale",
        "swap",
        "divisible_mode",
        "divisible",
        "width_offset",
        "height_offset",
    ],
    [
        "preset",
        "width",
        "height",
        "scale",
        "swap",
        "divisible_mode",
        "divisible",
        "width_offset",
        "height_offset",
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

/**
 * 宽度什么时候能改。
 *
 * - Width only：就是要给的那一边，永远可用；
 * - Megapixels / Height only：尺寸完全由比例算，宽度不参与；
 * - Resolution：预设为 Custom 时才有效（否则预设覆盖宽高）。
 *
 * 注意：同一项被多条规则引用时，引擎是「任一规则说可用就可用」，
 * 所以这里每次都算出**完整**结论，不看驱动值。
 */
function widthEnabled(_value, node) {
    const mode = widgetValue(node, "size_mode");
    if (mode === MODE_WIDTH_ONLY) return true;
    if (mode === MODE_HEIGHT_ONLY || mode === MODE_MEGAPIXELS) {
        return false;
    }
    return widgetValue(node, "preset") === PRESET_CUSTOM;
}

/** 高度什么时候能改，与宽度对称。 */
function heightEnabled(_value, node) {
    const mode = widgetValue(node, "size_mode");
    if (mode === MODE_HEIGHT_ONLY) return true;
    if (mode === MODE_WIDTH_ONLY || mode === MODE_MEGAPIXELS) {
        return false;
    }
    return widgetValue(node, "preset") === PRESET_CUSTOM;
}

/**
 * 手动宽:高这两个框什么时候露出来。
 *
 * 只有「这个模式真的用比例」且「比例选的是 Custom」时才露；
 * 其余情况（含 Resolution 模式）整个藏起来。
 */
function ratioPairEnabled(_value, node) {
    const mode = widgetValue(node, "size_mode");
    if (mode === MODE_RESOLUTION) return false;
    return widgetValue(node, "aspect_ratio") === RATIO_CUSTOM;
}

registerWidgetRules({
    nodeClass: "XResolution",
    rules: [
        {
            watch: "size_mode",
            targets: {
                // 固定分辨率档位只在「给确切宽高」时算数
                preset: [MODE_RESOLUTION],
                // 倍率对除百万像素外的三种模式都生效
                scale: [
                    MODE_RESOLUTION,
                    MODE_WIDTH_ONLY,
                    MODE_HEIGHT_ONLY,
                ],
                // 比例：百万像素 + 两个单边模式都用得上
                aspect_ratio: [
                    MODE_MEGAPIXELS,
                    MODE_WIDTH_ONLY,
                    MODE_HEIGHT_ONLY,
                ],
                megapixels: [MODE_MEGAPIXELS],
                width: widthEnabled,
                height: heightEnabled,
            },
        },
        {
            // 「宽:高」两个框一起显隐，所以两边都要跟着模式/比例重算
            watch: "size_mode",
            action: "hide",
            targets: {
                ratio_width: ratioPairEnabled,
                ratio_height: ratioPairEnabled,
            },
        },
        {
            // 预设一变，宽高能不能改也要跟着变
            watch: "preset",
            targets: {
                width: widthEnabled,
                height: heightEnabled,
            },
        },
        {
            // 比例一变：手动宽高比那两个框可能该露出来了
            watch: "aspect_ratio",
            action: "hide",
            targets: {
                ratio_width: ratioPairEnabled,
                ratio_height: ratioPairEnabled,
            },
        },
        {
            watch: "divisible_mode",
            targets: { divisible: ["Nearest", "Up", "Down"] },
        },
    ],
});

/**
 * 只有新版才有的输入 → 默认值。
 *
 * 老工作流读进来时，ComfyUI 会按**位置**把这些输入也一起塞上值，于是
 * 后面的输入会串到前面来（典型症状：「百万像素」里显示的是整除模式
 * 的 `Disabled`）。凡是旧顺序里没有的项，一律回到默认值。
 */
const NEW_WIDGET_DEFAULTS = {
    size_mode: MODE_RESOLUTION,
    aspect_ratio: RATIO_DEFAULT,
    ratio_width: 16,
    ratio_height: 9,
    megapixels: 1,
    preset: PRESET_CUSTOM,
};

/**
 * 老工作流按名字搬值：只认「数值个数正好等于某一版旧顺序，且新输入
 * 已经挂上」，新文件不会被误伤；返回是否真的迁移过。
 */
export function migrateLegacyWidgetValues(node, widgetsValues) {
    if (!node || !Array.isArray(widgetsValues)) return false;
    const legacyOrder = LEGACY_ORDERS.find(
        (order) => order.length === widgetsValues.length
    );
    if (!legacyOrder) return false;
    // 新结构里一定有这两项；老前端没拉到新 schema 时就不动
    if (!widgetOf(node, "size_mode") || !widgetOf(node, "megapixels")) {
        return false;
    }

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
    name: "ComfyUI.Xz3r0.XResolution.LegacyValues",
    beforeRegisterNodeDef(nodeType, nodeData) {
        if (!nodeData || nodeData.name !== "XResolution") return;
        const proto = nodeType.prototype;

        const origConfigure = proto.onConfigure;
        proto.onConfigure = function (info) {
            const result = origConfigure
                ? origConfigure.apply(this, arguments)
                : undefined;
            // 读工作流时 widgets_values 还在 info 上，正好拿来判断新旧
            if (info && migrateLegacyWidgetValues(this, info.widgets_values)) {
                // 值刚被改过：让画布和置灰状态都按新值重算一遍
                this.setDirtyCanvas?.(true, true);
                syncWidgetRules(this);
            }
            return result;
        };
    },
});
