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
const MARGIN = 8;   // min distance from viewport edges (px)
const SHOW_DELAY = 0;  // ms before tooltip appears (0 = instant)
const HIDE_DELAY = 80; // ms before tooltip hides after mouse leaves
const FADE_DURATION = 120;
const SIDE_VERTICAL_OFFSET = 12;

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

export function showTooltip(text, targetRect, direction, target = null) {
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

    _showRafId = requestAnimationFrame(() => {
        _showRafId = null;
        if (showId !== _showId) {
            return;
        }

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
        el.setAttribute("aria-hidden", "false");
        el.style.visibility = "";
        el.style.opacity = "1";
    });
}

export function hideTooltip(immediate = false) {
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

/** Install tooltip listeners on a shadow root via event delegation. */
export function installTooltips(shadowRoot) {
    if (!shadowRoot || shadowRoot._xdhTooltipsInstalled) return;
    shadowRoot._xdhTooltipsInstalled = true;

    shadowRoot.addEventListener("mouseover", (e) => {
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
