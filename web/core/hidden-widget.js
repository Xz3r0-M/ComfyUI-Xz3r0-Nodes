/**
 * Hidden internal widgets
 * =======================
 *
 * 给「内部状态 widget」加隐藏 + 去掉输入圆点。
 *
 * 背景（见 skill comfyui-node-inputs）：
 * Python 侧只写 `socketless=True` / `extra_dict={"hidden": True}` 是不够的。
 * 新版前端的 widget 构造器不会把 `socketless` 写进 `widget.options`，所以
 * `addInputWidget()` 仍会为它建一个输入槽。widget 一旦被隐藏，这个输入槽
 * 就变成节点上孤零零一个可点的圆点。必须显式 `removeInput()` 才能真正
 * 去掉；而且每次 `configure`（打开工作流）都会重建输入，所以要在所有
 * 生命周期钩子里重复执行。
 *
 * 用法：
 *   import { hideInternalWidget, hideInternalWidgets } from "./core/hidden-widget.js";
 *   hideInternalWidgets(node, ["internal_a", "internal_b"]);
 *
 * 注意：只对「不会接线」的内部状态口使用；普通可见 widget（开关、下拉）
 * 不需要也不应该删它的输入槽。
 */

/**
 * 按名字找 widget（不依赖 LiteGraph 的内部 API）。
 * @param {object} node
 * @param {string} name
 * @returns {object|null}
 */
export function findWidgetByName(node, name) {
    if (!node || !Array.isArray(node.widgets) || !name) {
        return null;
    }
    for (let index = 0; index < node.widgets.length; index += 1) {
        const widget = node.widgets[index];
        if (widget && widget.name === name) {
            return widget;
        }
    }
    return null;
}

/**
 * 五层隐藏里的前四层（LiteGraph 跳过绘制 / 标记 hidden 类型 / 零尺寸 /
 * DOM 级隐藏）。第五层「移除输入槽」见 {@link removeWidgetInput}。
 * @param {object} widget
 */
export function applyHiddenWidgetLayers(widget) {
    if (!widget) return;
    widget.hidden = true;
    widget.options = widget.options || {};
    widget.options.hidden = true;
    widget.type = "hidden";
    widget.computeSize = function () {
        return [0, -4];
    };
    if (widget.element) {
        widget.element.style.display = "none";
    }
    if (widget.inputEl) {
        widget.inputEl.style.display = "none";
    }
}

/**
 * 移除某个名字对应的输入槽（会同步前端的连线注册表）。
 * @param {object} node
 * @param {string} name
 * @returns {boolean} 是否移除了至少一个槽
 */
export function removeWidgetInput(node, name) {
    if (!node || !name || !Array.isArray(node.inputs)) {
        return false;
    }
    let removed = false;
    // 从后往前删，避免下标错位。
    for (let index = node.inputs.length - 1; index >= 0; index -= 1) {
        const input = node.inputs[index];
        if (!input || input.name !== name) {
            continue;
        }
        if (typeof node.removeInput === "function") {
            node.removeInput(index);
        } else {
            node.inputs.splice(index, 1);
        }
        removed = true;
    }
    if (
        removed
        && node.graph
        && typeof node.graph.setDirtyCanvas === "function"
    ) {
        node.graph.setDirtyCanvas(true, true);
    }
    return removed;
}

/**
 * 隐藏 widget 并移除它的输入圆点。
 * @param {object} node
 * @param {string} name
 * @returns {object|null} 找到的 widget（没有则 null）
 */
export function hideInternalWidget(node, name) {
    const widget = findWidgetByName(node, name);
    applyHiddenWidgetLayers(widget);
    removeWidgetInput(node, name);
    return widget;
}

/**
 * 批量版本。
 * @param {object} node
 * @param {string[]} names
 */
export function hideInternalWidgets(node, names) {
    if (!Array.isArray(names)) return;
    for (let index = 0; index < names.length; index += 1) {
        hideInternalWidget(node, names[index]);
    }
}
