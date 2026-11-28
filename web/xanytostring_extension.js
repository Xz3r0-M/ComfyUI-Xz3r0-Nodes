/**
 * XAnyToString - 节点窗口内显示字符串输出
 * ==========================================
 *
 * 功能：
 * - 捕获节点的 string 输出并在节点 DOM 面板内显示
 * - 上游是列表输出时逐项全部显示（带 [序号] 分隔），不再只显示第一条
 * - 支持 ComfyUI 中键平移 / 滚轮缩放转发
 * - 响应 ComfyUI 语言设置（通过 xdatahub_ui.json）
 */

import { api } from "../../scripts/api.js";
import { app } from "../../scripts/app.js";
import { setComfyTip } from "./core/tooltip.js?v=20261116-8";

var EXT_NAME = "ComfyUI.Xz3r0.XAnyToString";
var NODE_CLASS = "XAnyToString";
var WIDGET_NAME = "xanytostring_display";
var BOOL_WIDGETS = ["full_display", "full_output"];
var STYLE_ID = "xanytostring-styles";
var PROPERTY_COLLAPSED = "xanytostring_collapsed";
var MIN_NODE_W = 280;
var MIN_NODE_H_COLLAPSED = 88;
var MIN_NODE_H_EXPANDED = 170;
/*
 * 面板本身（标题 + 文字框那块）有多高才算够用。
 *
 * 这个数要交给 ComfyUI（见 applyPanelHeightRequest）：自定义面板默认只报
 * 50px，节点排布时就不会为它多留地方。于是「展开」只是把 setSize 的数字
 * 改大，下一次排版又按「面板只要 50px」算回去，看着就像一点都没变高。
 */
var PANEL_MIN_H_EXPANDED = 120;
var PANEL_MIN_H_COLLAPSED = 0;
/*
 * 新节点从没展开过时，「展开」一次长到多高。
 *
 * 只按最小高度长的话只有两百出头，文字框刚够露一条缝；给一个像样的默认值，
 * 第一次展开就能直接看内容。用户自己拉过以后，就照他拉的那个尺寸来。
 */
var DEFAULT_EXPANDED_HEIGHT = 320;
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
        setComfyTip(
            state.toggleBtn,
            state.collapsed
                ? tk("expand_tip", "Expand string output")
                : tk("collapse_tip", "Collapse string output")
        );
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
        /*
         * 颜色跟节点本体走（透色），不用 XDataHub 的那套。
         * --node / --node-border / --foreground 是前端写在 <html> 上的活变量；
         * 下面留的 --comfy-* 是老前端与老主题的退路。
         * 注意用 --node（节点本体色），不是 --background（画布底色，更暗）。
         */
        "  --xanytostring-surface: var(--comfy-input-bg,",
        "    color-mix(in srgb, var(--node, #1d1d20) 88%, var(--foreground, #ddd)));",
        "  --xanytostring-text: var(--foreground, var(--input-text, #ddd));",
        "  --xanytostring-muted: var(--descrip-text, color-mix(in srgb, var(--xanytostring-text) 62%, transparent));",
        "  --xanytostring-border: var(--node-border, var(--border-color, #555));",
        "  --xanytostring-accent: #ff385c;",
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
        "  border: 1px solid var(--xanytostring-border);",
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
        "  color: var(--xanytostring-muted);",
        "  font-weight: 600;",
        "  line-height: 1.3;",
        "}",
        ".xanytostring-toggle {",
        "  padding: 2px 6px;",
        "  gap: 3px;",
        "  border: 1px solid var(--xanytostring-border);",
        "  border-radius: 4px;",
        "  background: var(--xanytostring-surface);",
        "  color: var(--xanytostring-text);",
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
        "  border-color: var(--xanytostring-accent);",
        "}",
        ".xanytostring-display {",
        "  flex: 1 1 auto;",
        "  min-height: 40px;",
        "  padding: 6px 8px;",
        "  border-radius: 4px;",
        "  background: var(--xanytostring-surface);",
        "  color: var(--xanytostring-text);",
        "  font: var(--xdh-font-mono-sm, 11px monospace);",
        "  line-height: 1.4;",
        "  white-space: pre-wrap;",
        "  word-break: break-all;",
        "  overflow-y: auto;",
        "  overflow-x: hidden;",
        "  overscroll-behavior: contain;",
        "}",
        ".xanytostring-display.is-collapsed {",
        "  display: none;",
        "}",
        /*
         * Nodes 2.0 里整个节点就是一块 DOM，官方设计系统在 .lg-node 上
         * 写了 user-select: none（免得拖节点时顺手选中一堆文字）。
         * 我们这块文字框在里面，跟着一起选不中 —— 而这里的文字就是要
         * 拿去复制粘贴的。所以明确改回来，选择器多套一层把那条压下去。
         *
         * 经典画布下面板是画布旁边的独立元素，本来就没这条限制。
         */
        ".xanytostring-wrap .xanytostring-display {",
        "  user-select: text;",
        "  -webkit-user-select: text;",
        "  cursor: text;",
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

function isScrollableOverflowElement(element) {
    if (!element || element.nodeType !== 1) return false;
    if (element.scrollHeight <= element.clientHeight
        && element.scrollWidth <= element.clientWidth) {
        return false;
    }
    var style = window.getComputedStyle(element);
    var overflow = style.overflow || "";
    var overflowX = style.overflowX || "";
    var overflowY = style.overflowY || "";
    return overflow.indexOf("auto") >= 0
        || overflow.indexOf("scroll") >= 0
        || overflowX.indexOf("auto") >= 0
        || overflowX.indexOf("scroll") >= 0
        || overflowY.indexOf("auto") >= 0
        || overflowY.indexOf("scroll") >= 0;
}

function eventTargetInScrollableRegion(event, root) {
    var target = event && event.target;
    if (!target || !root) return false;
    if (target.nodeType === 3) {
        target = target.parentElement;
    }
    for (var el = target; el && el !== root; el = el.parentElement) {
        if (isScrollableOverflowElement(el)) {
            return true;
        }
    }
    return isScrollableOverflowElement(root)
        && (root === target || root.contains(target));
}

function forwardWheelToCanvas(event) {
    // 结果文本框有可滚动内容时保留原生滚动，否则转发到画布缩放。
    if (eventTargetInScrollableRegion(event, event.currentTarget)) {
        return;
    }
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

/**
 * 告诉 ComfyUI 这个自定义面板需要多高。
 *
 * ComfyUI 用元素上的 --comfy-widget-min-height / --comfy-widget-height 两个
 * CSS 变量来问「这个 DOM 面板最少要留多少地方」。不写就按 50px 算：节点
 * 排版时永远只给一点点高度，折叠能压下去（内容藏起来了），展开却顶不上来。
 *
 * 折叠时给 0（好让节点真的能缩到最小），展开时给一个能放下标题和文字框
 * 的高度，剩下的空间照样由用户自己拉。
 */
function applyPanelHeightRequest(state) {
    var wrap = state && state.wrap;
    if (!wrap || !wrap.style) return;
    var minHeight = state.collapsed
        ? PANEL_MIN_H_COLLAPSED
        : PANEL_MIN_H_EXPANDED;
    wrap.style.setProperty("--comfy-widget-min-height", minHeight + "px");
    // 不写 --comfy-widget-height：那是「首选高度」，写死了用户拉高节点时
    // 多出来的空间就分不到文字框了
    wrap.style.removeProperty("--comfy-widget-height");
}

/** 折叠前的高度，展开时照原样还回去（用户自己拉高过的尺寸也算数）。 */
function rememberExpandedHeight(state) {
    if (!state || !state.node || state.collapsed) return;
    var curH = (state.node.size && state.node.size[1]) || 0;
    if (curH > 0) {
        state.expandedHeight = Math.max(curH, MIN_NODE_H_EXPANDED);
    }
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
        // 展开状态下用户拉过的尺寸记下来，折叠再展开能还回去
        if (st && !st.collapsed && nh > 0) {
            st.expandedHeight = Math.max(
                st.expandedHeight || 0,
                nh
            );
        }
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
    if (collapsed) {
        // 压下去之前先记着：现在多高，展开时就还多高
        rememberExpandedHeight(state);
    } else if (!state.expandedHeight) {
        // 从没展开过（刚拖出来的新节点、旧工作流里存成折叠的节点）：
        // 用户亲手点展开时给一个像样的默认高度，别只露出两百来像素
        state.expandedHeight = options && options.userAction
            ? DEFAULT_EXPANDED_HEIGHT
            : 0;
    }
    state.collapsed = !!collapsed;
    // 先改面板的高度需求，再算节点尺寸——顺序反了的话，clampNodeSize 里
    // 的 computeSize() 读到的还是上一次（折叠时）的 0，展开又顶不上去
    applyPanelHeightRequest(state);
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
        setComfyTip(
            state.toggleBtn,
            state.collapsed
                ? tk("expand_tip", "Expand string output")
                : tk("collapse_tip", "Collapse string output")
        );
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
    /*
     * 折叠：压到最小。
     * 展开：回到折叠前的高度（没有记录就按最小高度）。
     *   以前展开只写 Math.max(当前高度, 最小高度)——折叠后当前高度本来就
     *   已经被压到最小了，这个式子算出来永远等于「最小高度」，身高一点都
     *   不涨，用户看到的就是「展开没反应」。
     */
    var targetH = state.collapsed
        ? Math.min(curH || minH, minH)
        : Math.max(state.expandedHeight || 0, curH, minH);
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
    normalizeBoolValues(node);

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
    setComfyTip(toggleBtn, tk("expand_tip", "Expand string output"));
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
        // 折叠前的高度；展开时照这个还回去
        expandedHeight: 0,
    };
    node.__xanytostringState = state;
    nodeStates[String(node.id)] = state;

    toggleBtn.addEventListener("click", function () {
        setCollapsed(state, !state.collapsed, { userAction: true });
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
// 开关值兜底
// ---------------------------------------------------------------------------

/**
 * 两个开关的值必须是真布尔值。
 *
 * 旧工作流按位置存 widget 值，新增开关前保存的节点只有显示面板那一个值
 * （空字符串），加载时会错落到开关上；这里统一归位成布尔值，
 * 空值按默认关闭处理。
 */
function normalizeBoolValues(node) {
    var widgets = node && node.widgets;
    if (!widgets) return;
    for (var i = 0; i < widgets.length; i++) {
        var widget = widgets[i];
        if (!widget || BOOL_WIDGETS.indexOf(widget.name) < 0) continue;
        if (typeof widget.value !== "boolean") {
            widget.value = !!widget.value;
        }
    }
}

// ---------------------------------------------------------------------------
// Executed output
// ---------------------------------------------------------------------------

/**
 * 合并执行结果里的文本，得到面板要显示的内容。
 *
 * 上游是列表输出时，ComfyUI 会把本节点按元素执行多次，每次各产出一条
 * 文本，这些文本统一汇总进 output.text。此前只取第 0 条，导致列表的其余
 * 元素看不见；这里把每一条都显示出来。
 *
 * - 只有一条：原样显示，不加任何前缀（单值场景与旧行为一致）
 * - 多条：每条前面加 [序号]，条目之间空一行，便于看出共有几项、边界在哪
 *
 * @param {*} textValue output.text，通常是字符串数组
 * @returns {string} 面板显示的完整文本
 */
function buildDisplayText(textValue) {
    if (Array.isArray(textValue)) {
        var items = textValue.map(function (item) {
            if (item === null || item === undefined) return "";
            return String(item);
        });
        if (items.length === 0) return "";
        if (items.length === 1) return items[0];
        return items.map(function (item, index) {
            return "[" + (index + 1) + "]\n" + item;
        }).join("\n\n");
    }
    if (textValue === null || textValue === undefined) return "";
    return String(textValue);
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
            normalizeBoolValues(this);
            createDisplayUI(this);
        };

        nodeType.prototype.onConfigure = function () {
            origOnConfigure && origOnConfigure.apply(this, arguments);
            normalizeBoolValues(this);
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
            var text = (output && output.text)
                ? buildDisplayText(output.text)
                : "";
            state.displayEl.textContent = text;
        };
    },

    async loadedGraphNode(node) {
        if (String(node.comfyClass || node.type || "") !== NODE_CLASS) return;
        normalizeBoolValues(node);
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
