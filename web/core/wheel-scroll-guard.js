/**
 * 让「面板里的滚动区域」在 Nodes 2.0 下真的能滚。
 * ==============================================
 *
 * 1.0（经典画布）里没有这个问题：滚轮落到列表上，列表自己滚，画布连事件
 * 都收不到。
 *
 * 2.0 不是。Vue 节点覆盖层（`TransformPane`）上挂着
 * `@wheel.capture="forwardEventToCanvas"`，它在**捕获阶段**就
 * `preventDefault + stopPropagation` 并把滚轮转给画布缩放。于是：
 *
 *     鼠标放在列表上滚 → 画布放大缩小，列表一动不动。
 *
 * 唯一能排在这个覆盖层前面的位置是 **window 的捕获阶段**。
 *
 * 我们在那里做的事很少：**只 `stopPropagation()`，不 `preventDefault()`**。
 * 事件不再往上冒泡（覆盖层抢不到 → 画布不缩放），而浏览器的「默认动作」
 * 不受 stopPropagation 影响，列表照样自己滚。等于把 1.0 的行为还原回来。
 *
 * 只对「真的能滚的容器」生效，而且必须在我们自己的节点面板里面
 * （`[data-node-id]`）——侧边栏、设置弹窗、节点搜索框一律不碰。
 */

/** 判断「内容确实超出了可视范围」时留的容差（缩放后可能差零点几像素）。 */
const SCROLL_TOLERANCE_PX = 1;

/** 2.0 里每个 Vue 节点的根元素带这个属性。 */
const NODE_ROOT_SELECTOR = "[data-node-id]";

let installed = false;

/** 取真实生效的 overflow 值（`overflow` 可能是简写）。 */
function overflowOf(style, axis) {
    return axis === "y" ? style.overflowY : style.overflowX;
}

/**
 * 这个元素现在能不能滚？
 *
 * 必须同时满足两条：`overflow` 是 auto/scroll **并且**内容真的超出。
 * 只看 `overflow` 会把「设了 auto 但其实没内容」的容器也算进来，
 * 那样一大片面板都会变成「滚不动也不缩放」的死区。
 */
export function isScrollableElement(el, axis = "y") {
    if (!el || el.nodeType !== 1) return false;
    // 便宜的判断先做：内容没超出就一定不滚。这一步能挡掉绝大多数元素，
    // 避免每次滚轮都对一串元素调 getComputedStyle（会强制样式重算）
    const overflowPx = axis === "y"
        ? el.scrollHeight - el.clientHeight
        : el.scrollWidth - el.clientWidth;
    if (overflowPx <= SCROLL_TOLERANCE_PX) return false;
    const overflow = overflowOf(window.getComputedStyle(el), axis);
    return !!overflow && /^(auto|scroll|overlay)$/.test(overflow);
}

/**
 * 从事件目标往上找「能滚的容器」，只找到节点根元素为止。
 * 找不到返回 null。
 */
export function findScrollableAncestor(target, event) {
    if (!target || target.nodeType !== 1) return null;
    // 捏合缩放（Ctrl/⌘ + 滚轮）留给画布，不做拦截
    if (event && (event.ctrlKey || event.metaKey)) return null;

    const horizontal = !!event
        && Math.abs(event.deltaX) > Math.abs(event.deltaY);
    const axis = horizontal ? "x" : "y";
    const root = target.closest ? target.closest(NODE_ROOT_SELECTOR) : null;
    if (!root) return null; // 不在节点面板里（侧边栏 / 弹窗 / 页面本身）

    for (let el = target; el; el = el.parentElement) {
        if (isScrollableElement(el, axis)) return el;
        if (el === root) break;
    }
    return null;
}

function handleWheel(event) {
    const scroller = findScrollableAncestor(event.target, event);
    if (!scroller) return;
    // 只断掉冒泡（画布缩放走的是覆盖层的捕获监听），默认滚动照旧
    event.stopPropagation();
}

/**
 * 装一次就够（幂等）。多个节点、多次重绘都不会重复挂监听。
 */
export function installWheelScrollGuard() {
    if (installed || typeof window === "undefined") return false;
    installed = true;
    // passive: true —— 我们从不 preventDefault，只断冒泡，别拖慢滚动
    window.addEventListener("wheel", handleWheel, {
        capture: true,
        passive: true,
    });
    return true;
}

/** 仅测试用：把「装过了」的状态清掉。 */
export function resetWheelScrollGuardForTest() {
    installed = false;
}
