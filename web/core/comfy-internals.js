/**
 * comfy-internals.js
 * ==================
 *
 * 取用 ComfyUI 前端「内部对象」（模态对话框、菜单按钮等）的统一入口。
 *
 * 为什么要绕一层：
 * 这些类在官方仓库里位于 `src/scripts/ui/...`，属于内部实现。老写法是
 * 直接 `import "../../scripts/ui/dialog.js"`，但那条路径已被官方标记为
 * 弃用——新版前端加载它时会打印
 * `[ComfyUI Deprecated] Importing from ... is deprecated ...` 警告
 * （见 issue #55）。
 *
 * 官方给出的替代方式：打包时前端会把每个内部模块的导出挂到全局对象
 * `window.comfyAPI.<模块名>.<导出名>` 上（模块名 = 源文件名去掉扩展名），
 * 自定义节点直接读这个全局对象即可，不会触发弃用警告。
 *
 * 用法：
 *   import { getComfyExport, loadComfyExport } from "./core/comfy-internals.js";
 *
 *   // 同步取，取不到自己兜底
 *   const ComfyDialog = getComfyExport("dialog", "ComfyDialog");
 *
 *   // 同步取不到时再去请求老的 scripts/ 路径（只为极老的前端兜底）
 *   const ComfyButton = await loadComfyExport(
 *       "button", "ComfyButton", "/scripts/ui/components/button.js");
 *
 * 只支持「函数/类」导出（本仓库只用到这两类）。
 */

/**
 * 从 `window.comfyAPI` 取一个导出。
 * @param {string} moduleName 模块名（源文件名去扩展名），如 "dialog"、"button"
 * @param {string} exportName 导出名，如 "ComfyDialog"
 * @returns {Function|null} 取不到时返回 null
 */
export function getComfyExport(moduleName, exportName) {
    const bag = window.comfyAPI && window.comfyAPI[moduleName];
    const value = bag ? bag[exportName] : null;
    return typeof value === "function" ? value : null;
}

/**
 * 先读 `window.comfyAPI`；没有（很老的前端）才退回老路径动态 import。
 *
 * 老路径只在全局对象缺失时才会被请求，所以使用新版前端时不会出现
 * 弃用警告。
 *
 * @param {string} moduleName 模块名（源文件名去扩展名）
 * @param {string} exportName 导出名
 * @param {string} [legacyPath] 老路径，必须写成站点绝对路径，
 *     例如 "/scripts/ui/components/button.js"
 * @returns {Promise<Function|null>} 取不到时返回 null
 */
export async function loadComfyExport(moduleName, exportName, legacyPath) {
    const direct = getComfyExport(moduleName, exportName);
    if (direct) {
        return direct;
    }
    if (!legacyPath) {
        return null;
    }
    try {
        const mod = await import(legacyPath);
        const value = mod ? mod[exportName] : null;
        return typeof value === "function" ? value : null;
    } catch (_error) {
        return null;
    }
}
