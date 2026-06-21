import { app } from "../../scripts/app.js";

// XLinker 连线显隐透传节点前端扩展
// ===================================
// Widget 区横向双按钮组：隐藏连线 / 高亮连线
// 标准节点 widget 区 DOM widget + renderLink 拦截，纯前端特性。

var NODE_CLASS = "XLinker";
var HIDE_NONE = 0;
var HIDE_INPUT = 1;   // bit 0
var HIDE_OUTPUT = 2;  // bit 1
var HIDE_BOTH = 3;    // bits 0+1
var HIDE_STATE_PROP = "xlinker_hide_links_state";
var HIDE_STATE_WIDGET = "__xlinker_hide_links_state";
var linkerLinksHidden = {};      // nodeKey -> state (0-3)
var linkerLinksHighlighted = {}; // nodeKey -> bool
var canvasHooked = false;
var HIDE_BUTTON_TEXTS = ["◀▶", "◁▶", "◀▷", "◁▷"];
var HIGHLIGHT_BUTTON_TEXTS = ["☆", "★"];
var BUTTON_GROUP = "xlinker_button_group";
var BUTTON_GROUP_MARGIN = 15;
var BUTTON_GROUP_GAP = 4;
var BUTTON_GROUP_HEIGHT = 24;
var BUTTON_GROUP_STYLE_ID = "xlinker-button-group-style";
var uiLocalePrimary = null;
var uiLocaleFallback = null;
var i18nCache = {};

// ---------------------------------------------------------------------------
// 工具
// ---------------------------------------------------------------------------
function activeGraph() {
    return (app.canvas && app.canvas.getCurrentGraph && app.canvas.getCurrentGraph())
        || (app.canvas && app.canvas.graph)
        || app.graph;
}
function nodeKey(node) {
    return String(node && node.id);
}
function findWidget(node, name) {
    if (!node || !Array.isArray(node.widgets)) return null;
    for (var i = 0; i < node.widgets.length; i++) {
        if (node.widgets[i] && node.widgets[i].name === name) {
            return node.widgets[i];
        }
    }
    return null;
}
function ensureHiddenWidget(node, name, defaultValue) {
    if (!node || !Array.isArray(node.widgets)) return null;
    var widget = findWidget(node, name);
    if (!widget && typeof node.addWidget === "function") {
        widget = node.addWidget("text", name, String(defaultValue), function () {});
    }
    if (widget) {
        widget.hidden = true;
        widget.options = widget.options || {};
        widget.options.hidden = true;
        widget.serializeValue = function () {
            return this.value;
        };
    }
    return widget || null;
}
function removeHiddenInputSlot(node, name) {
    if (!node || !Array.isArray(node.inputs)) return;
    var filtered = [];
    for (var i = 0; i < node.inputs.length; i++) {
        var input = node.inputs[i];
        if (!input || String(input.name || "") !== name) {
            filtered.push(input);
        }
    }
    if (filtered.length !== node.inputs.length) {
        node.inputs = filtered;
        if (node.graph && typeof node.graph.setDirtyCanvas === "function") {
            node.graph.setDirtyCanvas(true, true);
        }
    }
}
function ensureHiddenStateWidget(node) {
    var widget = ensureHiddenWidget(node, HIDE_STATE_WIDGET, String(HIDE_NONE));
    removeHiddenInputSlot(node, HIDE_STATE_WIDGET);
    return widget;
}

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
    return t("xdatahub.ui.node.xlinker." + suffix, fallback);
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

function fetchI18n(locale) {
    if (i18nCache[locale]) return Promise.resolve(i18nCache[locale]);
    return fetch("/xz3r0/xdatahub/i18n/ui?locale=" + encodeURIComponent(locale))
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

function applyUiLocale() {
    var locale = resolveComfyLocale();
    var normalized = (
        locale === "zh" || locale === "zh-CN" || locale === "zh-TW"
    ) ? "zh" : "en";
    return Promise.all([fetchI18n("en"), fetchI18n(normalized)])
        .then(function (results) {
            uiLocaleFallback = results[0];
            uiLocalePrimary = normalized === "en" ? results[0] : results[1];
            var graph = activeGraph();
            var nodes = (graph && (graph._nodes || graph.nodes)) || [];
            for (var i = 0; i < nodes.length; i++) {
                if (String(nodes[i] && (nodes[i].comfyClass || nodes[i].type || "")) === NODE_CLASS) {
                    updateTitleButtons(nodes[i]);
                }
            }
        });
}

function hiddenState(node) {
    var key = nodeKey(node);
    var state = linkerLinksHidden[key];
    if (state == null && node && node.properties) {
        state = node.properties[HIDE_STATE_PROP];
        if (state != null) linkerLinksHidden[key] = state;
    }
    if (state == null) {
        var widget = findWidget(node, HIDE_STATE_WIDGET);
        state = widget ? widget.value : null;
        if (state != null && state !== "") linkerLinksHidden[key] = state;
    }
    if (state === true) return HIDE_BOTH;
    state = Number(state) || HIDE_NONE;
    return Math.max(HIDE_NONE, Math.min(HIDE_BOTH, state));
}

function setHiddenState(node, state) {
    var key = nodeKey(node);
    var normalized = Math.max(HIDE_NONE, Math.min(HIDE_BOTH, Number(state) || HIDE_NONE));
    node.properties = node.properties || {};
    var widget = ensureHiddenStateWidget(node);
    if (normalized === HIDE_NONE) {
        delete linkerLinksHidden[key];
        delete node.properties[HIDE_STATE_PROP];
        if (widget) widget.value = String(HIDE_NONE);
    } else {
        linkerLinksHidden[key] = normalized;
        node.properties[HIDE_STATE_PROP] = normalized;
        if (widget) widget.value = String(normalized);
    }
    if (node.graph && typeof node.graph.change === "function") {
        node.graph.change();
    }
}

function nextState(state) {
    return (state + 1) % 4;
}

function updateTitleButtons(node) {
    ensureButtonGroupWidget(node);
    updateButtonGroupWidget(node);
}

function hideTitleKey(state) {
    if (state === HIDE_INPUT) return "hide_input_links";
    if (state === HIDE_OUTPUT) return "hide_output_links";
    if (state === HIDE_BOTH) return "hide_all_links";
    return "show_all_links";
}

function clickHideButton(node) {
    setHiddenState(node, nextState(hiddenState(node)));
    updateTitleButtons(node);
    if (app.canvas && typeof app.canvas.setDirty === "function") {
        app.canvas.setDirty(true, true);
    }
}

function clickHighlightButton(node) {
    var key = nodeKey(node);
    linkerLinksHighlighted[key] = !linkerLinksHighlighted[key];
    updateTitleButtons(node);
    if (app.canvas && typeof app.canvas.setDirty === "function") {
        app.canvas.setDirty(true, true);
    }
}

function buttonGroupTooltip(node, role) {
    if (role === "hide") {
        return tk(hideTitleKey(hiddenState(node)), "Show or hide links");
    }
    return linkerLinksHighlighted[nodeKey(node)]
        ? tk("stop_highlighting_links", "Stop highlighting links")
        : tk("highlight_links", "Highlight links");
}
function hideButtonLabel() {
    return tk("button_links", "Links");
}
function highlightButtonLabel() {
    return tk("button_highlight", "Highlight");
}

function ensureButtonGroupStyles() {
    if (typeof document === "undefined") return;
    if (document.getElementById(BUTTON_GROUP_STYLE_ID)) return;
    var style = document.createElement("style");
    style.id = BUTTON_GROUP_STYLE_ID;
    style.textContent = [
        ".xlinker-button-group {",
        "  box-sizing: border-box;",
        "  width: 100%;",
        "  padding: 0 " + BUTTON_GROUP_MARGIN + "px;",
        "  color: var(--input-text, #ddd);",
        "  background: transparent;",
        "}",
        ".xlinker-button-row {",
        "  display: flex;",
        "  align-items: stretch;",
        "  gap: " + BUTTON_GROUP_GAP + "px;",
        "  width: 100%;",
        "  min-height: " + BUTTON_GROUP_HEIGHT + "px;",
        "}",
        ".xlinker-button {",
        "  display: flex;",
        "  align-items: center;",
        "  justify-content: center;",
        "  flex: 1 1 0;",
        "  min-width: 0;",
        "  height: " + BUTTON_GROUP_HEIGHT + "px;",
        "  min-height: " + BUTTON_GROUP_HEIGHT + "px;",
        "  padding: 0 8px;",
        "  border: 1px solid var(--border-color, #555);",
        "  border-radius: 4px;",
        "  background: transparent;",
        "  color: var(--input-text, #ddd);",
        "  font: 12px sans-serif;",
        "  line-height: 1;",
        "  letter-spacing: 0;",
        "  text-align: center;",
        "  white-space: nowrap;",
        "  cursor: pointer;",
        "  transition: border-color 120ms ease, color 120ms ease;",
        "  appearance: none;",
        "}",
        ".xlinker-button:hover {",
        "  border-color: var(--xdh-brand-pink, #ff385c);",
        "}",
        ".xlinker-button.active {",
        "  color: var(--xdh-brand-pink, #ff385c);",
        "}",
    ].join("\n");
    (document.head || document.documentElement).appendChild(style);
}

function applyButtonVisual(button, active) {
    if (!button) return;
    button.classList.toggle("active", !!active);
}

function forwardPanelWheel(panel) {
    panel.addEventListener("wheel", function (e) {
        var gc = app.canvas && app.canvas.canvas;
        if (gc) {
            gc.dispatchEvent(new WheelEvent("wheel", {
                deltaX: e.deltaX,
                deltaY: e.deltaY,
                deltaZ: e.deltaZ,
                clientX: e.clientX,
                clientY: e.clientY,
                screenX: e.screenX,
                screenY: e.screenY,
                ctrlKey: e.ctrlKey,
                altKey: e.altKey,
                shiftKey: e.shiftKey,
                metaKey: e.metaKey,
                bubbles: true,
                cancelable: true,
            }));
        }
    });
}

function forwardPanelMiddleButton(panel) {
    panel.addEventListener("pointerdown", function (e) {
        if (e.button !== 1) return;
        e.preventDefault();
        var cvs = app.canvas;
        if (!cvs || typeof cvs.processMouseDown !== "function") return;
        cvs.processMouseDown(e);
    });
    panel.addEventListener("pointermove", function (e) {
        if ((e.buttons & 4) !== 4) return;
        var cvs = app.canvas;
        if (!cvs || typeof cvs.processMouseMove !== "function") return;
        cvs.processMouseMove(e);
    });
    panel.addEventListener("pointerup", function (e) {
        if (e.button !== 1) return;
        var cvs = app.canvas;
        if (!cvs || typeof cvs.processMouseUp !== "function") return;
        cvs.processMouseUp(e);
    });
}

function createButtonGroupPanel(node) {
    if (!node || typeof document === "undefined") return null;
    ensureButtonGroupStyles();
    ensureHiddenStateWidget(node);

    var wrap = document.createElement("div");
    wrap.className = "xlinker-button-group";

    var row = document.createElement("div");
    row.className = "xlinker-button-row";
    wrap.appendChild(row);

    var hideButton = document.createElement("button");
    hideButton.type = "button";
    hideButton.className = "xlinker-button";
    hideButton.textContent = hideButtonLabel() + " " + HIDE_BUTTON_TEXTS[HIDE_NONE];
    hideButton.title = buttonGroupTooltip(node, "hide");
    hideButton.setAttribute("aria-label", hideButton.title);
    hideButton.addEventListener("click", function () {
        clickHideButton(node);
    });

    var highlightButton = document.createElement("button");
    highlightButton.type = "button";
    highlightButton.className = "xlinker-button";
    highlightButton.textContent = highlightButtonLabel()
        + " " + HIGHLIGHT_BUTTON_TEXTS[0];
    highlightButton.title = buttonGroupTooltip(node, "highlight");
    highlightButton.setAttribute("aria-label", highlightButton.title);
    highlightButton.addEventListener("click", function () {
        clickHighlightButton(node);
    });

    row.appendChild(hideButton);
    row.appendChild(highlightButton);

    forwardPanelWheel(wrap);
    forwardPanelMiddleButton(wrap);

    if (typeof node.addDOMWidget === "function") {
        node.addDOMWidget(BUTTON_GROUP, "custom", wrap, {
            serialize: false,
            getMinHeight: function () {
                return BUTTON_GROUP_HEIGHT;
            },
            margin: 0,
        });
    }

    node.__xlinkerButtonPanel = {
        wrap: wrap,
        hideButton: hideButton,
        highlightButton: highlightButton,
    };
    return node.__xlinkerButtonPanel;
}

function ensureButtonGroupWidget(node) {
    if (!node) return null;
    if (node.__xlinkerButtonPanel) return node.__xlinkerButtonPanel;
    return createButtonGroupPanel(node);
}

function updateButtonGroupWidget(node) {
    if (!node || node.id == null) return;
    var panel = ensureButtonGroupWidget(node);
    if (!panel) return;

    var key = nodeKey(node);
    var hideState = hiddenState(node);
    var highlightOn = !!linkerLinksHighlighted[key];

    panel.hideButton.textContent = hideButtonLabel() + " " + HIDE_BUTTON_TEXTS[hideState];
    panel.highlightButton.textContent = highlightButtonLabel() + " "
        + HIGHLIGHT_BUTTON_TEXTS[highlightOn ? 1 : 0];
    panel.hideButton.title = buttonGroupTooltip(node, "hide");
    panel.highlightButton.title = buttonGroupTooltip(node, "highlight");
    panel.hideButton.setAttribute("aria-label", panel.hideButton.title);
    panel.highlightButton.setAttribute("aria-label", panel.highlightButton.title);
    applyButtonVisual(panel.hideButton, hideState !== HIDE_NONE);
    applyButtonVisual(panel.highlightButton, highlightOn);
}


// ---------------------------------------------------------------------------
// 连线隐藏 / 高亮判定
// ---------------------------------------------------------------------------
function isLinkerHiddenLink(link, graph) {
    if (!link || link.id == null) return false;
    graph = graph || activeGraph();
    var nodes = graph._nodes || graph.nodes || [];
    var src = null, tgt = null;
    for (var i = 0; i < nodes.length; i++) {
        if (nodes[i].id === link.origin_id) src = nodes[i];
        if (nodes[i].id === link.target_id) tgt = nodes[i];
    }
    // 检查源节点（输出侧）：state & HIDE_OUTPUT → 隐藏
    if (src && src.comfyClass === NODE_CLASS) {
        var s = hiddenState(src);
        if (s & HIDE_OUTPUT) return true;
    }
    // 检查目标节点（输入侧）：state & HIDE_INPUT → 隐藏
    if (tgt && tgt.comfyClass === NODE_CLASS) {
        var s2 = hiddenState(tgt);
        if (s2 & HIDE_INPUT) return true;
    }
    return false;
}
function isLinkerHighlightedLink(link, graph) {
    if (!link || link.id == null) return false;
    graph = graph || activeGraph();
    var nodes = graph._nodes || graph.nodes || [];
    for (var i = 0; i < nodes.length; i++) {
        var node = nodes[i];
        if (String(node.comfyClass || node.type || "") !== NODE_CLASS) continue;
        if ((node.id === link.origin_id || node.id === link.target_id)
            && linkerLinksHighlighted[nodeKey(node)]) {
            return true;
        }
    }
    return false;
}

// ---------------------------------------------------------------------------
// Canvas hooks
// ---------------------------------------------------------------------------
function installCanvasHooks() {
    if (canvasHooked || !app.canvas) {
        if (!app.canvas) setTimeout(installCanvasHooks, 200);
        return;
    }
    canvasHooked = true;

    // 拦截连线渲染
    var origRenderLink = app.canvas.renderLink;
    app.canvas.renderLink = function (ctx, a, b, link) {
        var graph = this.graph || activeGraph();
        if (isLinkerHiddenLink(link, graph)) return;
        if (isLinkerHighlightedLink(link, graph)) {
            var args = Array.prototype.slice.call(arguments);
            var colors = ["red","orange","lime","cyan","magenta"];
            var cycle = 40, seg = cycle / colors.length;
            for (var c = 0; c < colors.length; c++) {
                args[6] = colors[c];
                ctx.setLineDash([seg, cycle - seg]);
                ctx.lineDashOffset = -c * seg;
                origRenderLink && origRenderLink.apply(this, args);
            }
            ctx.setLineDash([]);
            return;
        }
        origRenderLink && origRenderLink.apply(this, arguments);
    };
}

// ---------------------------------------------------------------------------
// 扩展注册
// ---------------------------------------------------------------------------
app.registerExtension({
    name: "ComfyUI.Xz3r0.XLinker",

    async setup() {
        installCanvasHooks();
        applyUiLocale();
    },

    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (String(nodeData.name) !== NODE_CLASS) return;
        // 初始最小尺寸约束（ComfyUI 1.0 兼容）
        var origOnCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            origOnCreated && origOnCreated.apply(this, arguments);
            if (typeof this.setSize === "function") {
                var cs = this.computeSize();
                this.setSize([Math.max(cs[0], 200), Math.max(cs[1], 60)]);
            }
        };

    },

    nodeCreated(node) {
        if (String(node.comfyClass || node.type || "") !== NODE_CLASS) return;
        ensureHiddenStateWidget(node);
        updateTitleButtons(node);
    },

    loadedGraphNode(node) {
        if (String(node.comfyClass || node.type || "") !== NODE_CLASS) return;
        ensureHiddenStateWidget(node);
        updateTitleButtons(node);
    },

    async nodeRemoved(node) {
        if (String(node.comfyClass || node.type || "") !== NODE_CLASS) return;
        var key = nodeKey(node);
        delete linkerLinksHidden[key];
        delete linkerLinksHighlighted[key];
        delete node.__xlinkerButtonPanel;
    },
});
