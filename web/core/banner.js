/**
 * banner.js — 全局顶部 Banner 通知 API
 *
 * 使用方式（任意组件内）:
 *   import { banner } from "../core/banner.js";
 *   banner.success("已收藏");
 *   banner.error("收藏失败，请重试");
 *   banner.info("该内容已在收藏中");
 *   banner.warn("当前处于只读模式");
 *
 *   // 带操作按钮：
 *   banner.warn("确定要清理所有记录吗？", {
 *       action: { label: "确认清理", onClick: () => doClean() },
 *       persist: true,
 *   });
 */

const _listeners = new Set();
let _idCounter = 0;

/**
 * @param {"success"|"error"|"info"|"warn"} type
 * @param {string} message
 * @param {{ persist?: boolean, duration?: number,
 *           action?: { label: string, onClick: () => void } }} [options]
 */
function show(type, message, options = {}) {
    const persist = Object.prototype.hasOwnProperty.call(options, "persist")
        ? options.persist
        : type === "error";
    const entry = {
        id: ++_idCounter,
        type,
        message,
        persist,
        duration: options.duration ?? 3000,
        action: options.action ?? null,
    };
    _listeners.forEach((fn) => fn(entry));
}

export const banner = {
    success: (msg, opts = {}) => show("success", msg, opts),
    error:   (msg, opts = {}) => show("error",   msg, opts),
    info:    (msg, opts = {}) => show("info",    msg, opts),
    warn:    (msg, opts = {}) => show("warn",    msg, opts),

    /** @internal — used by xdh-banner component */
    _subscribe:   (fn) => { _listeners.add(fn); },
    /** @internal */
    _unsubscribe: (fn) => { _listeners.delete(fn); },
};
