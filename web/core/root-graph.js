/**
 * root-graph.js
 * =============
 *
 * 取「顶层图（rootGraph）」的统一入口。
 *
 * 背景：官方把 `app.graph` 标成了弃用（注释里写着 use `app.rootGraph`），
 * 现在两者指向同一个图对象，但 `app.graph` 迟早会消失。直接用
 * `app.rootGraph` 又有两个坑：
 *
 * 1. 它会打日志：图还没初始化时 `app.rootGraph` 会 `console.error`，
 *    而老代码用 `app.graph` 做空值判断时是安静的；
 * 2. 很老的前端根本没有 `rootGraph`。
 *
 * 所以统一走这里：优先安静版 getter `rootGraphOrUndefined`，
 * 拿不到（老前端 / 还没初始化）再退回 `app.graph`。
 *
 * 用法：
 *   import { rootGraphOf } from "./core/root-graph.js";
 *   const graph = rootGraphOf(app);
 */

/**
 * 取顶层图。
 * @param {object} app ComfyUI 的 app 对象
 * @returns {object|null} 图还没建好时返回 null
 */
export function rootGraphOf(app) {
    if (!app) return null;
    if (app.rootGraphOrUndefined !== undefined) {
        return app.rootGraphOrUndefined || null;
    }
    return app.graph || null;
}
