/**
 * 悬停提示的兜底检查。
 * ====================
 *
 * 提示条（tooltip / 悬停说明）平时靠「鼠标移出」这个事件来收。可这个事件
 * 不一定每次都会到：
 *
 * - 进出子图、切图、节点面板被重建时，鼠标底下的元素被换掉了；
 * - 元素被摘掉（detach）以后，就再也不会替自己报「我这儿鼠标走了」；
 * - 拖动、按住鼠标、`stopPropagation` 之类的操作把事件链打断。
 *
 * 一漏就是「提示条粘在屏幕上不走」，用户只能点一下别处或者移动节点才收掉。
 *
 * 这里加一道很轻的兜底：提示条可见时，每 200ms 确认一次
 * 「那个元素还在页面里吗、鼠标真的还在它上面吗」，不对就收掉。
 * 提示条不可见时定时器是停的，所以正常浏览时几乎没有开销。
 */

/** 元素还在页面里，并且确实处于鼠标悬停状态。 */
export function isTargetStillHovered(target) {
    if (!target || target.isConnected === false) {
        return false;
    }
    if (typeof target.matches !== "function") {
        return true;
    }
    try {
        // :hover 对祖先同样成立，所以鼠标在它的子元素里也算悬停
        return target.matches(":hover");
    } catch {
        // 老浏览器 / 奇怪的环境问不出来时，宁可不动它
        return true;
    }
}

/**
 * 造一个兜底检查器。
 *
 * @param {object} options
 * @param {() => Element|null} options.getTarget 现在悬停的是哪个元素
 * @param {() => boolean} options.isVisible 提示条现在是否真的在屏幕上
 * @param {() => void} options.hide 收掉提示条
 * @param {number} [options.intervalMs] 检查间隔
 * @returns {{ start: () => void, stop: () => void, check: () => void }}
 */
export function createHoverGuard({
    getTarget,
    isVisible,
    hide,
    intervalMs = 200,
} = {}) {
    let timer = 0;

    const stop = () => {
        if (timer) {
            clearInterval(timer);
            timer = 0;
        }
    };

    const check = () => {
        if (typeof isVisible !== "function" || !isVisible()) {
            stop();
            return false;
        }
        const target = typeof getTarget === "function" ? getTarget() : null;
        if (!isTargetStillHovered(target)) {
            stop();
            if (typeof hide === "function") {
                hide();
            }
            return false;
        }
        return true;
    };

    const start = () => {
        if (!timer) {
            timer = setInterval(check, intervalMs);
        }
    };

    return { start, stop, check };
}
