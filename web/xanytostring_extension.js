/**
 * XAnyToString - 节点窗口内显示字符串输出
 * ==========================================
 *
 * 功能：
 * - 捕获节点的 string 输出并在节点 DOM 面板内显示
 * - 支持 ComfyUI 中键平移 / 滚轮缩放转发
 * - 响应 ComfyUI 语言设置（通过 xdatahub_ui.json）
 */

import { api } from "../../scripts/api.js";
import { app } from "../../scripts/app.js";

var EXT_NAME = "ComfyUI.Xz3r0.XAnyToString";
var NODE_CLASS = "XAnyToString";
var WIDGET_NAME = "xanytostring_display";
var STYLE_ID = "xanytostring-styles";
var PROPERTY_COLLAPSED = "xanytostring_collapsed";
var MIN_NODE_W = 280;
var MIN_NODE_H_COLLAPSED = 88;
var MIN_NODE_H_EXPANDED = 170;
var LOCALE_PREFIX = "xdatahub.ui.node.xanytostring";
var LOCALE_SYNC_INTERVAL = 1000;
var uiLocalePrimary = null;
var uiLocaleFallback = null;
var i18nCache = {};
var localeSyncInstalled = false;
var nodeStates = {};

// ---------------------------------------------------------------------------
// i18n
// ---------------------------------------------------------------------------

function t(key, fallback) {
    if (uiLocalePrimary && uiLocalePrimary[key] !== undefined
        && String(uiLocalePrimary[key]).length > 0) {
        return uiLocalePrimary[key];
    }
    if (uiLocaleFallback && uiLocaleFallback[key] !== undefined
        && String(uiLocaleFallback[key]).length > 0) {
        return uiLocaleFallback[key];
    }
    return fallback || key;
}

function tk(suffix, fallback) {
    return t(LOCALE_PREFIX + "." + suffix, fallback);
}

function fetchI18n(locale) {
    if (i18nCache[locale]) return Promise.resolve(i18nCache[locale]);
    return fetch(
        "/xz3r0/xdatahub/i18n/ui?locale=" + encodeURIComponent(locale)
    )
        .then(function (response) {
            return response.ok ? response.json() : {};
        })
        .then(function (data) {
            i18nCache[locale] = data && data.dict ? data.dict : {};
            return i18nCache[locale];
        })
        .catch(function () {
            return {};
        });
}

function resolveComfyLocale() {
    try {
        var value = app.extensionManager
            && app.extensionManager.setting
            && app.extensionManager.setting.get
            && app.extensionManager.setting.get("Comfy.Locale");
        if (value) return value;
    } catch (_error) { /* fall through */ }
    try {
        var stored = localStorage.getItem("Comfy.Locale");
        if (stored) return stored;
    } catch (_error) { /* fall through */ }
    if (document.documentElement && document.documentElement.lang) {
        return document.documentElement.lang;
    }
    return navigator.language || "en";
}

function loadLocaleBundle(locale) {
    var normalized = (
        locale === "zh" || locale === "zh-CN" || locale === "zh-TW"
    ) ? "zh" : "en";
    return Promise.all([fetchI18n("en"), fetchI18n(normalized)]).then(
        function (results) {
            uiLocaleFallback = results[0];
            uiLocalePrimary = normalized === "en" ? results[0] : results[1];
            return normalized;
        }
    );
}

function applyUiLocale(localeOverride) {
    return loadLocaleBundle(localeOverride || resolveComfyLocale()).then(
        function () {
            for (var nodeId in nodeStates) {
                if (Object.prototype.hasOwnProperty.call(
                    nodeStates,
                    nodeId
                )) {
                    applyLocale(nodeStates[nodeId]);
                }
            }
        }
    );
}

function installLocaleSync() {
    if (localeSyncInstalled) return;
    localeSyncInstalled = true;
    var lastLocale = null;
    setInterval(function () {
        var nextLocale = resolveComfyLocale();
        if (nextLocale && nextLocale !== lastLocale) {
            lastLocale = nextLocale;
            applyUiLocale(nextLocale);
        }
    }, LOCALE_SYNC_INTERVAL);
}

function applyLocale(state) {
    if (!state) return;
    if (state.labelEl) {
        state.labelEl.textContent = tk("label", "Result");
    }
    if (state.toggleBtn) {
        state.toggleBtn.textContent = state.collapsed
            ? EXPAND_ICON() + " " + tk("expand_label", "Expand")
            : COLLAPSE_ICON() + " " + tk("collapse_label", "Collapse");
        state.toggleBtn.title = state.collapsed
            ? tk("expand_tip", "Expand string output")
            : tk("collapse_tip", "Collapse string output");
    }
    if (state.displayEl) {
        state.displayEl.setAttribute(
            "data-placeholder",
            tk("placeholder", "String output will appear here after execution")
        );
    }
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;

    var style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = [
        ".xanytostring-wrap {",
        "  position: relative;",
        "  width: 100%; height: 100%;",
        "  display: flex;",
        "  flex-direction: column;",
        "  gap: 6px;",
        "  padding: 6px;",
        "  box-sizing: border-box;",
        "  overflow: hidden;",
        "  transition: height 120ms ease;",
        "}",
        ".xanytostring-result {",
        "  flex: 1 1 auto;",
        "  min-height: 0;",
        "  margin: 0;",
        "  padding: 5px 6px 6px;",
        "  border: 1px solid var(--border-color, #555);",
        "  border-radius: 4px;",
        "  display: flex;",
        "  flex-direction: column;",
        "  gap: 4px;",
        "}",
        ".xanytostring-header {",
        "  display: flex;",
        "  align-items: center;",
        "  justify-content: space-between;",
        "  gap: 6px;",
        "  flex-shrink: 0;",
        "  padding: 0 4px;",
        "}",
        ".xanytostring-label {",
        "  font: var(--xdh-font-ui-md, 12px sans-serif);",
        "  color: var(--descrip-text, #999);",
        "  font-weight: 600;",
        "  line-height: 1.3;",
        "}",
        ".xanytostring-toggle {",
        "  padding: 2px 6px;",
        "  gap: 3px;",
        "  border: 1px solid var(--border-color, #555);",
        "  border-radius: 4px;",
        "  background: var(--comfy-menu-secondary-bg, #2a2a2a);",
        "  color: var(--input-text, #ddd);",
        "  font-size: 11px;",
        "  font-family: inherit;",
        "  cursor: pointer;",
        "  display: inline-flex;",
        "  align-items: center;",
        "  flex-shrink: 0;",
        "  white-space: nowrap;",
        "  transition: border-color 120ms ease;",
        "}",
        ".xanytostring-toggle:hover {",
        "  border-color: var(--primary-color, #ff385c);",
        "}",
        ".xanytostring-display {",
        "  flex: 1 1 auto;",
        "  min-height: 40px;",
        "  padding: 6px 8px;",
        "  border-radius: 4px;",
        "  background: var(--comfy-menu-secondary-bg, #2a2a2a);",
        "  color: var(--input-text, #ddd);",
        "  font: var(--xdh-font-mono-sm, 11px monospace);",
        "  line-height: 1.4;",
        "  white-space: pre-wrap;",
        "  word-break: break-all;",
        "  overflow-y: auto;",
        "  overflow-x: hidden;",
        "}",
        ".xanytostring-display.is-collapsed {",
        "  display: none;",
        "}",
        ".xanytostring-display:empty::before {",
        "  content: attr(data-placeholder);",
        "  color: var(--descrip-text, #666);",
        "  font-style: italic;",
        "}",
    ].join("\n");
    document.head.appendChild(style);
}

// ---------------------------------------------------------------------------
// Canvas pass-through (中键平移 + 滚轮缩放)
// ---------------------------------------------------------------------------

var _middleDragActive = false;

function installGlobalMiddleForwarding() {
    if (installGlobalMiddleForwarding._installed) return;
    installGlobalMiddleForwarding._installed = true;

    window.addEventListener("mousemove", function (event) {
        if (!_middleDragActive || !app.canvas
            || !app.canvas.processMouseMove) return;
        event.preventDefault();
        event.stopPropagation();
        app.canvas.processMouseMove(event);
    }, true);

    window.addEventListener("mouseup", function (event) {
        if (!_middleDragActive || !app.canvas
            || !app.canvas.processMouseUp) return;
        _middleDragActive = false;
        event.preventDefault();
        event.stopPropagation();
        app.canvas.processMouseUp(event);
    }, true);
}

function forwardWheelToCanvas(event) {
    var graphCanvas = app.canvas && app.canvas.canvas;
    if (!graphCanvas) return;
    event.preventDefault();
    event.stopPropagation();
    graphCanvas.dispatchEvent(new WheelEvent("wheel", {
        bubbles: true,
        cancelable: true,
        clientX: event.clientX,
        clientY: event.clientY,
        screenX: event.screenX,
        screenY: event.screenY,
        deltaX: event.deltaX,
        deltaY: event.deltaY,
        deltaZ: event.deltaZ,
        deltaMode: event.deltaMode,
        ctrlKey: event.ctrlKey,
        shiftKey: event.shiftKey,
        altKey: event.altKey,
        metaKey: event.metaKey,
    }));
}

function forwardMiddleDownToCanvas(event) {
    if (event.button !== 1 || !app.canvas
        || !app.canvas.processMouseDown) return;
    installGlobalMiddleForwarding();
    _middleDragActive = true;
    event.preventDefault();
    event.stopPropagation();
    app.canvas.processMouseDown(event);
}

function bindCanvasForwarding(element) {
    if (!element || element.__xanytostringPassThrough) return;
    element.__xanytostringPassThrough = true;
    element.addEventListener("wheel", forwardWheelToCanvas, { passive: false });
    element.addEventListener("mousedown", forwardMiddleDownToCanvas, true);
}

// ---------------------------------------------------------------------------
// Node size clamping
// ---------------------------------------------------------------------------

function resolveMinHeight(state) {
    return (state && !state.collapsed)
        ? MIN_NODE_H_EXPANDED
        : MIN_NODE_H_COLLAPSED;
}

function clampNodeSize(node, state) {
    if (!node) return;

    var minWidth = MIN_NODE_W;
    var minHeight = resolveMinHeight(state);
    if (typeof node.computeSize === "function") {
        var computed = node.computeSize();
        if (Array.isArray(computed) && computed.length >= 2) {
            minWidth = Math.max(minWidth, computed[0] || 0);
            minHeight = Math.max(minHeight, computed[1] || 0);
        }
    }

    node.min_size = [minWidth, minHeight];

    if (!node.__xanytostringInitialSizeApplied) {
        node.__xanytostringInitialSizeApplied = true;
        var curW = node.size ? (node.size[0] || 0) : 0;
        var curH = node.size ? (node.size[1] || 0) : 0;
        if (curW < minWidth || curH < minHeight) {
            if (typeof node.setSize === "function") {
                node.setSize([
                    Math.max(curW, minWidth),
                    Math.max(curH, minHeight),
                ]);
            } else {
                node.size = [
                    Math.max(curW, minWidth),
                    Math.max(curH, minHeight),
                ];
            }
        }
    }

    if (node.__xanytostringResizeGuard) return;
    node.__xanytostringResizeGuard = true;

    var origOnResize = node.onResize;
    node.onResize = function (size) {
        var st = this.__xanytostringState;
        var resizeMinW = MIN_NODE_W;
        var resizeMinH = resolveMinHeight(st);
        if (typeof this.computeSize === "function") {
            var rc = this.computeSize();
            if (Array.isArray(rc) && rc.length >= 2) {
                resizeMinW = Math.max(resizeMinW, rc[0] || 0);
                resizeMinH = Math.max(resizeMinH, rc[1] || 0);
            }
        }
        this.min_size = [resizeMinW, resizeMinH];
        var src = Array.isArray(size) ? size : this.size;
        var nw = Math.max((src && src[0]) || 0, resizeMinW);
        var nh = Math.max((src && src[1]) || 0, resizeMinH);
        this.size = [nw, nh];
        this.setDirtyCanvas && this.setDirtyCanvas(true, true);
        if (typeof origOnResize === "function") {
            origOnResize.apply(this, arguments);
        }
    };
}

// ---------------------------------------------------------------------------
// UI creation
// ---------------------------------------------------------------------------

function EXPAND_ICON() { return "\u25B6"; }
function COLLAPSE_ICON() { return "\u25BC"; }

function resolveStoredCollapsed(node) {
    if (node && node.properties
        && typeof node.properties[PROPERTY_COLLAPSED] === "boolean") {
        return node.properties[PROPERTY_COLLAPSED];
    }
    return true;
}

function persistCollapsed(state) {
    if (!state || !state.node) return;
    state.node.properties = state.node.properties || {};
    state.node.properties[PROPERTY_COLLAPSED] = state.collapsed;
    if (state.node.graph && typeof state.node.graph.change === "function") {
        state.node.graph.change();
    }
}

function setCollapsed(state, collapsed, options) {
    if (!state) return;
    state.collapsed = !!collapsed;
    if (!options || options.persist !== false) {
        persistCollapsed(state);
    }
    if (state.displayEl) {
        if (state.collapsed) {
            state.displayEl.classList.add("is-collapsed");
        } else {
            state.displayEl.classList.remove("is-collapsed");
        }
    }
    if (state.toggleBtn) {
        state.toggleBtn.textContent = state.collapsed
            ? EXPAND_ICON() + " " + tk("expand_label", "Expand")
            : COLLAPSE_ICON() + " " + tk("collapse_label", "Collapse");
        state.toggleBtn.title = state.collapsed
            ? tk("expand_tip", "Expand string output")
            : tk("collapse_tip", "Collapse string output");
    }
    clampNodeSize(state.node, state);
    resizeNodeToFit(state);
}

function resizeNodeToFit(state) {
    if (!state || !state.node) return;
    var node = state.node;
    var minH = resolveMinHeight(state);
    var curW = (node.size && node.size[0]) || MIN_NODE_W;
    var curH = (node.size && node.size[1]) || 0;
    var targetH = state.collapsed
        ? Math.min(curH, minH)
        : Math.max(curH, minH);
    if (typeof node.setSize === "function") {
        node.setSize([Math.max(curW, MIN_NODE_W), targetH]);
    } else {
        node.size = [Math.max(curW, MIN_NODE_W), targetH];
    }
    node.setDirtyCanvas && node.setDirtyCanvas(true, true);
}

function createDisplayUI(node) {
    if (!node || node.__xanytostringState) return;

    ensureStyles();

    var wrap = document.createElement("div");
    wrap.className = "xanytostring-wrap";

    var result = document.createElement("fieldset");
    result.className = "xanytostring-result";

    var header = document.createElement("legend");
    header.className = "xanytostring-header";

    var label = document.createElement("div");
    label.className = "xanytostring-label";
    label.textContent = tk("label", "Result");
    header.appendChild(label);

    var toggleBtn = document.createElement("button");
    toggleBtn.className = "xanytostring-toggle";
    toggleBtn.type = "button";
    toggleBtn.textContent = EXPAND_ICON() + " " + tk(
        "expand_label",
        "Expand"
    );
    toggleBtn.title = tk("expand_tip", "Expand string output");
    header.appendChild(toggleBtn);

    var display = document.createElement("div");
    display.className = "xanytostring-display is-collapsed";
    display.setAttribute(
        "data-placeholder",
        tk("placeholder", "String output will appear here after execution")
    );
    result.appendChild(header);
    result.appendChild(display);
    wrap.appendChild(result);

    var state = {
        node: node,
        wrap: wrap,
        resultEl: result,
        headerEl: header,
        labelEl: label,
        toggleBtn: toggleBtn,
        displayEl: display,
        collapsed: resolveStoredCollapsed(node),
    };
    node.__xanytostringState = state;
    nodeStates[String(node.id)] = state;

    toggleBtn.addEventListener("click", function () {
        setCollapsed(state, !state.collapsed);
    });

    if (typeof node.addDOMWidget === "function") {
        node.addDOMWidget(WIDGET_NAME, "custom", wrap, {
            serialize: false,
        });
    }

    bindCanvasForwarding(wrap);
    setCollapsed(state, state.collapsed, { persist: false });
    applyLocale(state);
    clampNodeSize(node, state);
}

// ---------------------------------------------------------------------------
// Extension registration
// ---------------------------------------------------------------------------

app.registerExtension({
    name: EXT_NAME,

    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (String(nodeData.name) !== NODE_CLASS) return;

        var origOnCreated = nodeType.prototype.onNodeCreated;
        var origOnConfigure = nodeType.prototype.onConfigure;
        var origOnExecuted = nodeType.prototype.onExecuted;

        nodeType.prototype.onNodeCreated = function () {
            origOnCreated && origOnCreated.apply(this, arguments);
            createDisplayUI(this);
        };

        nodeType.prototype.onConfigure = function () {
            origOnConfigure && origOnConfigure.apply(this, arguments);
            createDisplayUI(this);
            setCollapsed(
                this.__xanytostringState,
                resolveStoredCollapsed(this),
                { persist: false }
            );
        };

        nodeType.prototype.onExecuted = function (output) {
            origOnExecuted && origOnExecuted.apply(this, arguments);
            var state = this.__xanytostringState;
            if (!state || !state.displayEl) return;
            var text = "";
            if (output && output.text) {
                text = Array.isArray(output.text)
                    ? String(output.text[0] || "")
                    : String(output.text);
            }
            state.displayEl.textContent = text;
        };
    },

    async loadedGraphNode(node) {
        if (String(node.comfyClass || node.type || "") !== NODE_CLASS) return;
        createDisplayUI(node);
        setCollapsed(
            node.__xanytostringState,
            resolveStoredCollapsed(node),
            { persist: false }
        );
    },

    async setup() {
        await applyUiLocale();
        installLocaleSync();
    },
});
