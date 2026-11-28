/**
 * Global JS-driven tooltip manager.
 *
 * Replaces the CSS ::after pseudo-element approach so tooltips can be
 * positioned with `position: fixed` and clamped to the viewport boundary.
 * This is critical because components live inside an iframe: purely
 * CSS-absolute tooltips near the iframe edge get clipped.
 *
 * Usage (in each component's connectedCallback):
 *   import { installTooltips } from '../core/tooltip.js';
 *   connectedCallback() {
 *       super.connectedCallback();
 *       installTooltips(this.shadowRoot);
 *   }
 *
 * Markup requirements are identical to the old CSS approach:
 *   <button class="xdh-tooltip xdh-tooltip-down" data-tooltip="Settings">
 */

let _el = null;
let _hideTimer = null;
let _displayTimer = null;
let _showId = 0;
let _showRafId = null;
let _currentTarget = null; // track current tooltip target to avoid re-triggering on child mouseover
const MARGIN = 8;   // min distance from viewport edges (px)
const SHOW_DELAY = 0;  // ms before tooltip appears (0 = instant)
const HIDE_DELAY = 80; // ms before tooltip hides after mouse leaves
const FADE_DURATION = 120;
const SIDE_VERTICAL_OFFSET = 12;
const CURSOR_GAP = 14; // tooltip offset from mouse cursor (px)

function clearDisplayTimer() {
    clearTimeout(_displayTimer);
    _displayTimer = null;
}

function finalizeHiddenState() {
    if (!_el) return;
    _el.style.display = "none";
}

function getDocumentFullscreenElement() {
    return document.fullscreenElement
        || document.webkitFullscreenElement
        || null;
}

function getTooltipParent(target) {
    const rootNode = target?.getRootNode?.();
    const shadowFullscreenEl = rootNode instanceof ShadowRoot
        ? (rootNode.fullscreenElement || rootNode.webkitFullscreenElement)
        : null;
    if (shadowFullscreenEl instanceof Element) {
        return shadowFullscreenEl;
    }

    const documentFullscreenEl = getDocumentFullscreenElement();
    if (documentFullscreenEl instanceof Element) {
        return documentFullscreenEl;
    }

    return document.body;
}

function setHiddenState(immediate = false) {
    if (!_el) return;
    _el.setAttribute("aria-hidden", "true");
    _el.style.opacity = "0";
    _el.style.visibility = "hidden";
    clearDisplayTimer();
    if (immediate) {
        finalizeHiddenState();
        return;
    }
    _displayTimer = setTimeout(() => {
        if (_el?.getAttribute("aria-hidden") === "true") {
            finalizeHiddenState();
        }
        _displayTimer = null;
    }, FADE_DURATION);
}

function getEl(parent = document.body) {
    if (!_el) {
        _el = document.createElement("div");
        _el.id = "xdh-global-tooltip";
        _el.setAttribute("role", "tooltip");
        _el.setAttribute("aria-hidden", "true");
        Object.assign(_el.style, {
            position: "fixed",
            zIndex: "999999",
            /* 浮层色跟官方主题走：tip 挂 body（有时挂进 fullscreenElement），
               拿不到节点面板的变量，所以直接读前端写在 <html> 上的活变量。
               官方自己的 tooltip 就是 bg --background / text --foreground /
               border --border（见 design-system/TooltipContent.vue），
               --popover 的默认值正是 --background，视觉完全一致。
               中间那层是 XDataHub 窗口（iframe 里没有官方变量）的退路。 */
            background: "var(--popover, var(--xdh-surf-overlay-bg, #252525))",
            color: "var(--foreground, var(--xdh-surf-overlay-ink, #eee))",
            border:
                "1px solid var(--border,"
                + " var(--xdh-surf-overlay-line, #3a3a3a))",
            boxShadow: "2px 6px 18px rgba(0, 0, 0, 0.55)",
            padding: "5px 11px",
            borderRadius: "7px",
            fontSize: "12px",
            fontWeight: "500",
            lineHeight: "1.4",
            whiteSpace: "normal",
            wordBreak: "normal",
            overflowWrap: "anywhere",
            pointerEvents: "none",
            opacity: "0",
            transition: "opacity 0.12s ease",
            visibility: "hidden",
            display: "none",
            maxWidth: "300px",
            fontFamily: "system-ui, -apple-system, sans-serif",
            userSelect: "none",
        });
    }
    const resolvedParent = parent || document.body;
    if (_el.parentNode !== resolvedParent) {
        resolvedParent.appendChild(_el);
    }
    return _el;
}

function getDirection(el) {
    if (el.classList.contains("xdh-tooltip-down")) return "down";
    if (el.classList.contains("xdh-tooltip-up")) return "up";
    if (el.classList.contains("xdh-tooltip-left")) return "left";
    return "right";
}

function getTooltipTargetFromEvent(event) {
    return event.composedPath().find(
        (node) => node instanceof Element
            && node.hasAttribute("data-tooltip")
    );
}

export function showTooltip(text, targetRect, direction, target = null, cursorX = null, cursorY = null) {
    clearTimeout(_hideTimer);
    clearDisplayTimer();
    if (_showRafId !== null) {
        cancelAnimationFrame(_showRafId);
        _showRafId = null;
    }
    const showId = ++_showId;
    const el = getEl(getTooltipParent(target));
    el.textContent = text;
    // Move to a neutral off-screen position BEFORE measuring so that the
    // element's previous left/top never affects the layout width.  When a
    // fixed element is close to the right viewport edge the browser can
    // narrow its layout box, making offsetWidth vary by position and
    // causing inconsistent line-break results on re-use.
    el.style.left = "0px";
    el.style.top = "-9999px";
    el.style.width = "";
    // Make invisible but measurable before calculating position
    el.setAttribute("aria-hidden", "true");
    el.style.visibility = "hidden";
    el.style.opacity = "0";
    el.style.display = "block";

    const useCursor = cursorX !== null && cursorY !== null;

    _showRafId = requestAnimationFrame(() => {
        _showRafId = null;
        if (showId !== _showId) {
            return;
        }

        const tw = el.offsetWidth;
        const th = el.offsetHeight;
        const vw = window.innerWidth;
        const vh = window.innerHeight;

        let left, top;
        if (useCursor) {
            left = cursorX + CURSOR_GAP;
            top = cursorY + CURSOR_GAP;
            if (left + tw > vw - MARGIN) {
                left = cursorX - tw - CURSOR_GAP;
            }
            if (top + th > vh - MARGIN) {
                top = cursorY - th - CURSOR_GAP;
            }
        } else {
            const gap = 10;
            switch (direction) {
                case "down":
                    left = targetRect.left + (targetRect.width - tw) / 2;
                    top  = targetRect.bottom + gap;
                    break;
                case "up":
                    left = targetRect.left + (targetRect.width - tw) / 2;
                    top  = targetRect.top - th - gap;
                    break;
                case "left":
                    left = targetRect.left - tw - gap;
                    top  = targetRect.top + (targetRect.height - th) / 2
                        + SIDE_VERTICAL_OFFSET;
                    break;
                default: // right
                    left = targetRect.right + gap;
                    top  = targetRect.top + (targetRect.height - th) / 2
                        + SIDE_VERTICAL_OFFSET;
                    break;
            }
        }

        // Clamp to viewport
        left = Math.max(MARGIN, Math.min(vw - tw - MARGIN, left));
        top  = Math.max(MARGIN, Math.min(vh - th - MARGIN, top));

        el.style.left = `${Math.round(left)}px`;
        el.style.top  = `${Math.round(top)}px`;
        el.setAttribute("aria-hidden", "false");
        el.style.visibility = "";
        el.style.opacity = "1";
    });
}

function positionAtCursor(clientX, clientY) {
    if (!_el || _el.getAttribute("aria-hidden") === "true") return;
    const tw = _el.offsetWidth;
    const th = _el.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let left = clientX + CURSOR_GAP;
    let top = clientY + CURSOR_GAP;

    if (left + tw > vw - MARGIN) {
        left = clientX - tw - CURSOR_GAP;
    }
    if (top + th > vh - MARGIN) {
        top = clientY - th - CURSOR_GAP;
    }

    left = Math.max(MARGIN, Math.min(vw - tw - MARGIN, left));
    top = Math.max(MARGIN, Math.min(vh - th - MARGIN, top));

    _el.style.left = `${Math.round(left)}px`;
    _el.style.top = `${Math.round(top)}px`;
}

export function hideTooltip(immediate = false) {
    _currentTarget = null;
    clearTimeout(_hideTimer);
    _showId += 1;
    if (_showRafId !== null) {
        cancelAnimationFrame(_showRafId);
        _showRafId = null;
    }
    if (immediate) {
        setHiddenState(true);
        return;
    }
    _hideTimer = setTimeout(() => {
        setHiddenState();
    }, HIDE_DELAY);
}

/**
 * ── 节点面板里的普通文字提示 ────────────────────────────────────────
 *
 * 目标：**能用官方的就用官方的**，够不着才退回浏览器原生。
 *
 * ComfyUI 从 **v1.61.8** 起把节点提示改成一个全局共享的浮层
 * （`SharedNodeTooltip`）：元素只要带 `data-node-tooltip` 属性、并且落在
 * 画布容器里面，鼠标划过去就由官方弹出它自己的提示框 —— 主题色、圆角、
 * 边框、箭头、延迟全跟官方节点一致，我们一行样式都不用写。
 *
 * 更早的版本里没有这个机制（设了属性也没人理），所以退回浏览器原生
 * `title`：样式不好看、延迟约 1 秒，但**至少有提示**。
 *
 * 三条铁律：
 *  1. **默认必须是「有提示」的那条路**。读不到版本号就按「没有」处理，
 *     一律用 title。绝不允许出现「两头都没有」——那是真实踩过的坑。
 *  2. **两条路不能同时走**。判定为官方时要把 title 摘掉，否则系统气泡会
 *     在官方提示之后又冒一个出来。
 *  3. **只在节点面板里用**。官方浮层只认画布容器内的元素；XDataHub 浮动
 *     窗口挂在 body 上、iframe 里的界面连父页面都够不到 —— 那些地方请用
 *     自绘（`data-tooltip` + `installTooltips`）或保持原生 title。
 */

/** `data-node-tooltip` 机制最早的版本（已用 git tag --contains 核实）。 */
export const COMFY_NODE_TIP_MIN_VERSION = "1.61.8";

/**
 * 比较两个版本号，返回 -1 / 0 / 1。
 * 按数字段比，不按字符串比：字符串比较下 "1.61.10" 会小于 "1.61.8"。
 * 先剥掉 `-1` 之类的构建后缀与开头的 v。
 */
export function compareVersion(a, b) {
    const parse = (raw) => {
        if (typeof raw !== "string") return [];
        const core = raw.trim().replace(/^v/i, "").split(/[-+]/)[0];
        return core.split(".").map((part) => {
            const digits = part.replace(/\D.*$/, "");
            return digits === "" ? 0 : Number(digits);
        });
    };
    const left = parse(a);
    const right = parse(b);
    if (!left.length || !right.length) return -1;
    const total = Math.max(left.length, right.length);
    for (let i = 0; i < total; i += 1) {
        const x = left[i] ?? 0;
        const y = right[i] ?? 0;
        if (x > y) return 1;
        if (x < y) return -1;
    }
    return 0;
}

/** 当前前端有没有 `data-node-tooltip` 那套共享浮层。 */
export function comfyNodeTipSupported() {
    try {
        const version = globalThis.__COMFYUI_FRONTEND_VERSION__;
        return compareVersion(version, COMFY_NODE_TIP_MIN_VERSION) >= 0;
    } catch {
        return false;
    }
}

/**
 * 给「节点面板里的普通文字提示」挂文案。
 *
 * @param {HTMLElement|null} el 目标元素
 * @param {string} text 提示文字；空值表示摘掉提示
 */
export function setComfyTip(el, text) {
    if (!el) return;
    const value = text == null ? "" : String(text);
    const useOfficial = comfyNodeTipSupported();
    if (!value) {
        delete el.dataset.nodeTooltip;
        el.removeAttribute("title");
        return;
    }
    if (useOfficial) {
        if (el.dataset.nodeTooltip !== value) {
            el.dataset.nodeTooltip = value;
        }
        // 两条路不能同时走：留着 title 会多冒一个系统气泡
        el.removeAttribute("title");
        return;
    }
    if (el.getAttribute("title") !== value) {
        el.setAttribute("title", value);
    }
    delete el.dataset.nodeTooltip;
}

/** Install tooltip listeners on a shadow root via event delegation. */
export function installTooltips(shadowRoot) {
    if (!shadowRoot || shadowRoot._xdhTooltipsInstalled) return;
    shadowRoot._xdhTooltipsInstalled = true;

    shadowRoot.addEventListener("mouseover", (e) => {
        const target = getTooltipTargetFromEvent(e);
        if (!target) return;
        // Same target: just update cursor position, skip re-show (avoids flicker on deeply nested elements)
        if (target === _currentTarget) {
            positionAtCursor(e.clientX, e.clientY);
            return;
        }
        _currentTarget = target;
        const text = target.getAttribute("data-tooltip");
        if (!text) return;
        showTooltip(
            text,
            target.getBoundingClientRect(),
            getDirection(target),
            target,
            e.clientX,
            e.clientY
        );
    }, true);

    shadowRoot.addEventListener("mousemove", (e) => {
        positionAtCursor(e.clientX, e.clientY);
    }, true);

    shadowRoot.addEventListener("mouseout", (e) => {
        const target = getTooltipTargetFromEvent(e);
        if (!target) return;
        // Only hide if truly leaving the tooltip element (not moving to a child)
        if (!target.contains(e.relatedTarget)) {
            hideTooltip();
        }
    }, true);

    shadowRoot.addEventListener("focusin", (e) => {
        const target = getTooltipTargetFromEvent(e);
        if (!target) return;
        const text = target.getAttribute("data-tooltip");
        if (!text) return;
        showTooltip(
            text,
            target.getBoundingClientRect(),
            getDirection(target),
            target
        );
    }, true);

    shadowRoot.addEventListener("focusout", (e) => {
        const target = getTooltipTargetFromEvent(e);
        if (!target) return;
        if (!target.contains(e.relatedTarget)) {
            hideTooltip(true);
        }
    }, true);

    shadowRoot.addEventListener("blur", (e) => {
        const target = getTooltipTargetFromEvent(e);
        if (!target) return;
        hideTooltip(true);
    }, true);

    // Also hide on any scroll/key/click events
    shadowRoot.addEventListener("scroll", () => hideTooltip(true), true);
    shadowRoot.addEventListener("mousedown", () => hideTooltip(true), true);
    shadowRoot.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
            hideTooltip(true);
        }
    }, true);
}
