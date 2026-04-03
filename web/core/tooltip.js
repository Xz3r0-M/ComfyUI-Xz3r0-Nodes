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
const MARGIN = 8;   // min distance from viewport edges (px)
const SHOW_DELAY = 0;  // ms before tooltip appears (0 = instant)
const HIDE_DELAY = 80; // ms before tooltip hides after mouse leaves
const SIDE_VERTICAL_OFFSET = 12;

function getEl() {
    if (_el) return _el;
    _el = document.createElement("div");
    _el.id = "xdh-global-tooltip";
    Object.assign(_el.style, {
        position: "fixed",
        zIndex: "999999",
        background: "var(--xdh-color-surface-2, #252525)",
        color: "var(--xdh-color-text-primary, #eee)",
        border: "1px solid var(--xdh-color-border, #3a3a3a)",
        boxShadow: "2px 6px 18px rgba(0, 0, 0, 0.55)",
        padding: "5px 11px",
        borderRadius: "7px",
        fontSize: "12px",
        fontWeight: "500",
        lineHeight: "1.4",
        whiteSpace: "normal",
        wordBreak: "break-all",
        pointerEvents: "none",
        opacity: "0",
        transition: "opacity 0.12s ease",
        maxWidth: "300px",
        fontFamily: "system-ui, -apple-system, sans-serif",
        userSelect: "none",
    });
    document.body.appendChild(_el);
    return _el;
}

function getDirection(el) {
    if (el.classList.contains("xdh-tooltip-down")) return "down";
    if (el.classList.contains("xdh-tooltip-up")) return "up";
    if (el.classList.contains("xdh-tooltip-left")) return "left";
    return "right";
}

export function showTooltip(text, targetRect, direction) {
    clearTimeout(_hideTimer);
    const el = getEl();
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
    el.style.visibility = "hidden";
    el.style.opacity = "0";
    el.style.display = "block";

    requestAnimationFrame(() => {
        const tw = el.offsetWidth;
        const th = el.offsetHeight;
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const gap = 10;

        let left, top;
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

        // Clamp to viewport
        left = Math.max(MARGIN, Math.min(vw - tw - MARGIN, left));
        top  = Math.max(MARGIN, Math.min(vh - th - MARGIN, top));

        el.style.left = `${Math.round(left)}px`;
        el.style.top  = `${Math.round(top)}px`;
        el.style.visibility = "";
        el.style.opacity = "1";
    });
}

export function hideTooltip(immediate = false) {
    clearTimeout(_hideTimer);
    if (immediate) {
        if (_el) _el.style.opacity = "0";
        return;
    }
    _hideTimer = setTimeout(() => {
        if (_el) _el.style.opacity = "0";
    }, HIDE_DELAY);
}

/** Install tooltip listeners on a shadow root via event delegation. */
export function installTooltips(shadowRoot) {
    if (!shadowRoot || shadowRoot._xdhTooltipsInstalled) return;
    shadowRoot._xdhTooltipsInstalled = true;

    shadowRoot.addEventListener("mouseover", (e) => {
        const path = e.composedPath();
        const target = path.find(
            (n) => n instanceof Element && n.hasAttribute("data-tooltip")
        );
        if (!target) return;
        const text = target.getAttribute("data-tooltip");
        if (!text) return;
        showTooltip(
            text,
            target.getBoundingClientRect(),
            getDirection(target)
        );
    }, true);

    shadowRoot.addEventListener("mouseout", (e) => {
        const path = e.composedPath();
        const target = path.find(
            (n) => n instanceof Element && n.hasAttribute("data-tooltip")
        );
        if (!target) return;
        // Only hide if truly leaving the tooltip element (not moving to a child)
        if (!target.contains(e.relatedTarget)) {
            hideTooltip();
        }
    }, true);

    // Also hide on any scroll/key/click events
    shadowRoot.addEventListener("scroll", () => hideTooltip(true), true);
    shadowRoot.addEventListener("mousedown", () => hideTooltip(true), true);
}
