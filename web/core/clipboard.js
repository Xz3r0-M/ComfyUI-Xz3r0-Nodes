/**
 * 把一段文字复制到系统剪贴板。
 *
 * 为什么要写两套
 * --------------
 * 新的剪贴板接口（`navigator.clipboard`）只在**安全上下文**才有：https，
 * 或者 localhost。ComfyUI 经常是从局域网访问的（http://192.168.x.x），
 * 那个页面里这个接口根本不存在——和 `crypto.getRandomValues` 是同一条
 * 限制（之前随机后缀踩过一模一样的坑）。所以先试新接口，拿不到就退回
 * 「藏一个输入框 + execCommand("copy")」的老办法。
 *
 * 调用方只需要关心返回值：true = 复制成功，false = 两边都没成（这时候
 * 应该提示用户手动选中复制）。
 */

/** 这个页面能不能用新的剪贴板接口。 */
export function canUseAsyncClipboard() {
    const nav = globalThis.navigator;
    if (!nav?.clipboard || typeof nav.clipboard.writeText !== "function") {
        return false;
    }
    // isSecureContext 明确为 false 时不用：某些浏览器会把接口留着但在
    // 调用时才拒绝，那还不如直接走老办法。
    return globalThis.isSecureContext !== false;
}

/**
 * 老办法：临时放一个看不见的输入框，全选它，让浏览器执行复制命令。
 *
 * 必须用 `position: fixed` + 极小尺寸：留在文档流里会让页面抖一下，而
 * `display: none` 的元素选不中、复制不了。
 */
function copyWithHiddenInput(text) {
    const doc = globalThis.document;
    if (!doc?.body || typeof doc.createElement !== "function") {
        return false;
    }
    let area = null;
    try {
        area = doc.createElement("textarea");
        area.value = text;
        area.setAttribute("readonly", "");
        area.style.position = "fixed";
        area.style.top = "0";
        area.style.left = "0";
        area.style.width = "1px";
        area.style.height = "1px";
        area.style.padding = "0";
        area.style.border = "none";
        area.style.outline = "none";
        area.style.opacity = "0";
        area.style.pointerEvents = "none";
        doc.body.appendChild(area);
        area.select();
        area.setSelectionRange?.(0, String(text).length);
        return doc.execCommand("copy") === true;
    } catch {
        return false;
    } finally {
        area?.remove?.();
    }
}

/**
 * 复制文字。成功返回 true，失败返回 false。
 *
 * 空白内容直接返回 false：复制一段空格对用户来说和「没反应」没区别，
 * 弹一句「已复制」反而更误导。
 */
export async function copyText(text) {
    const value = typeof text === "string" ? text : String(text ?? "");
    if (!value.trim()) {
        return false;
    }
    if (canUseAsyncClipboard()) {
        try {
            await globalThis.navigator.clipboard.writeText(value);
            return true;
        } catch {
            // 接口在、但被拒绝（权限/焦点问题），继续走老办法
        }
    }
    return copyWithHiddenInput(value);
}
