/**
 * SVG icon helper — CSS mask-image technique.
 * Icons inherit color from the parent's `color` CSS property (currentColor).
 * Paths resolve relative to the app root (web/), matching xdatahub_app_v2.html.
 *
 * Usage:
 *   import { icon, ICON_CSS } from '../core/icon.js';
 *   // In <style>: ${ICON_CSS}
 *   // In template: ${icon('search')} or ${icon('settings', 18)}
 */

export function icon(name, size = 16) {
    const p = `icons/${name}.svg`;
    return `<span class="xdh-icon" style="width:${size}px;height:${size}px;` +
        `-webkit-mask-image:url(${p});mask-image:url(${p})"></span>`;
}

export const ICON_CSS = `
.xdh-icon {
    display: inline-block;
    flex-shrink: 0;
    vertical-align: middle;
    background-color: currentColor;
    -webkit-mask-repeat: no-repeat;
    -webkit-mask-position: center;
    -webkit-mask-size: contain;
    mask-repeat: no-repeat;
    mask-position: center;
    mask-size: contain;
}
`;

/**
 * 跨平台滚动条样式片段。
 * 在 Shadow DOM 组件的 <style> 中通过 ${SCROLLBAR_CSS} 引入，
 * 再在目标元素上加 class="xdh-scroll"（或直接对选择器扩展）。
 *
 * 覆盖策略：
 *   - scrollbar-width / scrollbar-color  → Firefox、Safari 标准属性
 *   - ::-webkit-scrollbar-*              → Chromium 精确控制
 * 两者必须同时存在，缺一在对应浏览器上退回系统宽条（~15px）。
 *
 * 使用：
 *   import { SCROLLBAR_CSS } from '../core/icon.js';
 *   // 在组件 render() 的 <style> 内：
 *   ${SCROLLBAR_CSS}
 *   // 在需要滚动的容器上加：
 *   overflow-y: auto;
 *   scrollbar-gutter: stable;  // 预留槽位，防止出现时内容跳动
 */
export const SCROLLBAR_CSS = `
.xdh-scroll {
    scrollbar-width: auto;
    scrollbar-color: var(--xdh-scrollbar-thumb, #555)
        var(--xdh-scrollbar-track, transparent);
    scrollbar-gutter: stable;
}
.xdh-scroll::-webkit-scrollbar {
    width: 10px;
    height: 10px;
}
.xdh-scroll::-webkit-scrollbar-track {
    background: var(--xdh-scrollbar-track, transparent);
}
.xdh-scroll::-webkit-scrollbar-thumb {
    background: var(--xdh-scrollbar-thumb, #555);
    border-radius: 4px;
}
.xdh-scroll::-webkit-scrollbar-thumb:hover {
    background: var(--xdh-scrollbar-thumb-hover, #777);
}
.xdh-scroll::-webkit-scrollbar-corner {
    background: transparent;
}
`;

/**
 * Tooltip CSS — pure-CSS tooltips via data-tooltip attribute.
 *
 * Usage:
 *   Add class "xdh-tooltip" to any element, set data-tooltip="Label".
 *   The element must have position:relative (or the class provides it).
 *
 * Directions (modifier classes):
 *   xdh-tooltip          → appears to the RIGHT  (default, for sidebars)
 *   xdh-tooltip-down     → appears BELOW          (for top-bar buttons)
 *   xdh-tooltip-up       → appears ABOVE          (for bottom-bar buttons)
 *   xdh-tooltip-left     → appears to the LEFT    (for rightmost buttons)
 *
 * Example:
 *   <button class="xdh-tooltip xdh-tooltip-down" data-tooltip="Settings">
 *   <button class="xdh-tooltip xdh-tooltip-up"   data-tooltip="Prev">
 */
export const TOOLTIP_CSS = `
/* Structural baseline — layout only (visual is handled by JS tooltip.js) */
.xdh-tooltip {
    position: relative;
}
/* Suppress CSS ::after pseudo-element — JS tooltip.js renders instead */
.xdh-tooltip::after {
    display: none !important;
}
.xdh-tooltip.xdh-tooltip-down::after,
.xdh-tooltip.xdh-tooltip-up::after,
.xdh-tooltip.xdh-tooltip-left::after {
    display: none !important;
}
`;
