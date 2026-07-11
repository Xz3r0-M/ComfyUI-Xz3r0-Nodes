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
var TITLE_SYNC_PROP = "xlinker_title_sync_enabled";
var TITLE_SYNC_WIDGET = "__xlinker_title_sync_enabled";
var PORT_SYNC_PROP = "xlinker_port_sync_enabled";
var PORT_SYNC_WIDGET = "__xlinker_port_sync_enabled";
var linkerLinksHidden = {};      // nodeKey -> state (0-3)
var linkerLinksHighlighted = {}; // nodeKey -> bool
var linkerTitleSyncEnabled = {}; // nodeKey -> bool
var linkerPortSyncEnabled = {};  // nodeKey -> bool
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
var localeSyncInstalled = false;
var LOCALE_SYNC_INTERVAL_MS = 1000;

// ---------------------------------------------------------------------------
// 类型不兼容视觉提示（参照 XPipe 警告渲染模式）
// ---------------------------------------------------------------------------
var WARNING_COLOR = "#1a1a1a";
var WARNING_GLOW = "rgba(255, 15, 15, 0.95)";
var WARNING_BREATH_SPEED = 0.012;
function warningGlowBlur() {
    var t = Date.now() * WARNING_BREATH_SPEED;
    var breath = Math.sin(t) * 0.5 + 0.5;
    return 3 + breath * 8;
}

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
function getNodeByIdInGraph(graph, id) {
    if (!graph || id == null) return null;
    return graph.getNodeById
        ? graph.getNodeById(id)
        : ((graph._nodes || graph.nodes || []).find(function (n) {
            return n && n.id === id;
        }) || null);
}
function getLinkInfo(linkId, graph) {
    if (linkId == null || !graph) return null;
    var links = graph.links || graph._links;
    if (!links) return null;
    if (links instanceof Map) return links.get(linkId) || null;
    return links[linkId] || null;
}
function cleanType(value) {
    if (Array.isArray(value)) value = value[0];
    var type = value == null ? "" : String(value).trim();
    return type && type !== "*" ? type : "";
}
function isXLinker(node) {
    return !!(node && String(node.comfyClass || node.type || "") === NODE_CLASS);
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

function ensureTitleSyncWidget(node) {
    var widget = ensureHiddenWidget(node, TITLE_SYNC_WIDGET, "false");
    removeHiddenInputSlot(node, TITLE_SYNC_WIDGET);
    return widget;
}

function ensurePortSyncWidget(node) {
    var widget = ensureHiddenWidget(node, PORT_SYNC_WIDGET, "false");
    removeHiddenInputSlot(node, PORT_SYNC_WIDGET);
    return widget;
}

function titleSyncEnabled(node) {
    var key = nodeKey(node);
    var enabled = linkerTitleSyncEnabled[key];
    if (enabled == null && node && node.properties) {
        enabled = node.properties[TITLE_SYNC_PROP];
        if (enabled != null) linkerTitleSyncEnabled[key] = enabled;
    }
    if (enabled == null) {
        var widget = findWidget(node, TITLE_SYNC_WIDGET);
        enabled = widget ? widget.value : null;
        if (enabled != null && enabled !== "") linkerTitleSyncEnabled[key] = enabled;
    }
    return enabled === true || String(enabled) === "true";
}

function portSyncEnabled(node) {
    var key = nodeKey(node);
    var enabled = linkerPortSyncEnabled[key];
    if (enabled == null && node && node.properties) {
        enabled = node.properties[PORT_SYNC_PROP];
        if (enabled != null) linkerPortSyncEnabled[key] = enabled;
    }
    if (enabled == null) {
        var widget = findWidget(node, PORT_SYNC_WIDGET);
        enabled = widget ? widget.value : null;
        if (enabled != null && enabled !== "") linkerPortSyncEnabled[key] = enabled;
    }
    return enabled === true || String(enabled) === "true";
}

function setTitleSyncEnabled(node, enabled) {
    var key = nodeKey(node);
    var normalized = !!enabled;
    node.properties = node.properties || {};
    var widget = ensureTitleSyncWidget(node);
    if (!normalized) {
        delete linkerTitleSyncEnabled[key];
        delete node.properties[TITLE_SYNC_PROP];
        if (widget) widget.value = "false";
    } else {
        linkerTitleSyncEnabled[key] = normalized;
        node.properties[TITLE_SYNC_PROP] = normalized;
        if (widget) widget.value = "true";
    }
    if (node.graph && typeof node.graph.change === "function") {
        node.graph.change();
    }
}

function setPortSyncEnabled(node, enabled) {
    var key = nodeKey(node);
    var normalized = !!enabled;
    node.properties = node.properties || {};
    var widget = ensurePortSyncWidget(node);
    if (!normalized) {
        delete linkerPortSyncEnabled[key];
        delete node.properties[PORT_SYNC_PROP];
        if (widget) widget.value = "false";
    } else {
        linkerPortSyncEnabled[key] = normalized;
        node.properties[PORT_SYNC_PROP] = normalized;
        if (widget) widget.value = "true";
    }
    if (node.graph && typeof node.graph.change === "function") {
        node.graph.change();
    }
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

function installLocaleSync() {
    if (localeSyncInstalled) return;
    localeSyncInstalled = true;
    var lastLocale = null;
    setInterval(function () {
        var nextLocale = resolveComfyLocale();
        if (nextLocale && nextLocale !== lastLocale) {
            lastLocale = nextLocale;
            applyUiLocale();
        }
    }, LOCALE_SYNC_INTERVAL_MS);
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

function clickTitleSyncButton(node) {
    setTitleSyncEnabled(node, !titleSyncEnabled(node));
    updateTitleButtons(node);
    if (titleSyncEnabled(node)) {
        syncTitleFromNoteText(node);
    }
    if (app.canvas && typeof app.canvas.setDirty === "function") {
        app.canvas.setDirty(true, true);
    }
}

function clickPortSyncButton(node) {
    var wasEnabled = portSyncEnabled(node);
    setPortSyncEnabled(node, !wasEnabled);
    updateTitleButtons(node);
    if (!wasEnabled) {
        // 刚刚开启，同步端口名称
        syncPortNamesFromNoteText(node);
    } else {
        // 刚刚关闭，还原原始端口名称
        resetPortNames(node);
    }
    if (app.canvas && typeof app.canvas.setDirty === "function") {
        app.canvas.setDirty(true, true);
    }
}

function syncTitleFromNoteText(node) {
    if (!node || !titleSyncEnabled(node)) return;
    var noteWidget = findWidget(node, "note_text");
    if (!noteWidget) return;
    var text = String(noteWidget.value || "").trim();
    if (text.length > 0) {
        node.title = text;
    }
    if (node.graph && typeof node.graph.setDirtyCanvas === "function") {
        node.graph.setDirtyCanvas(true, false);
    }
}

function syncPortNamesFromNoteText(node) {
    if (!node || !portSyncEnabled(node)) return;
    var noteWidget = findWidget(node, "note_text");
    if (!noteWidget) return;
    var text = String(noteWidget.value || "").trim();

    if (text.length > 0) {
        // 同步输入端口名称
        if (Array.isArray(node.inputs) && node.inputs.length > 0) {
            var input = node.inputs[0];
            if (input) {
                input.label = text;
            }
        }

        // 同步输出端口名称
        if (Array.isArray(node.outputs) && node.outputs.length > 0) {
            var output = node.outputs[0];
            if (output) {
                output.label = text;
            }
        }
    }

    if (node.graph && typeof node.graph.setDirtyCanvas === "function") {
        node.graph.setDirtyCanvas(true, false);
    }
}

function resetPortNames(node) {
    if (!node) return;

    // 恢复输入端口名称为原始名称
    if (Array.isArray(node.inputs) && node.inputs.length > 0) {
        var input = node.inputs[0];
        if (input) {
            delete input.label;
        }
    }

    // 恢复输出端口名称为原始名称
    if (Array.isArray(node.outputs) && node.outputs.length > 0) {
        var output = node.outputs[0];
        if (output) {
            delete output.label;
        }
    }

    if (node.graph && typeof node.graph.setDirtyCanvas === "function") {
        node.graph.setDirtyCanvas(true, false);
    }
}

function syncPortNamesFromLinks(node) {
    // 此函数已不再使用，但保留以避免引用错误
    syncPortNamesFromNoteText(node);
}

function buttonGroupTooltip(node, role) {
    if (role === "hide") {
        return tk(hideTitleKey(hiddenState(node)), "Show or hide links");
    }
    if (role === "highlight") {
        return linkerLinksHighlighted[nodeKey(node)]
            ? tk("stop_highlighting_links", "Stop highlighting links")
            : tk("highlight_links", "Highlight links");
    }
    if (role === "title_sync") {
        return titleSyncEnabled(node)
            ? tk("title_sync_enabled", "Title sync enabled")
            : tk("title_sync_disabled", "Title sync disabled");
    }
    if (role === "port_sync") {
        return portSyncEnabled(node)
            ? tk("port_sync_enabled", "Port sync enabled")
            : tk("port_sync_disabled", "Port sync disabled");
    }
    return "";
}
function hideButtonLabel() {
    return tk("button_links", "Links");
}
function highlightButtonLabel() {
    return tk("button_highlight", "Highlight");
}
function titleSyncButtonLabel() {
    return tk("button_title_sync", "Title");
}
function portSyncButtonLabel() {
    return tk("button_port_sync", "Port");
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
        "  display: flex;",
        "  flex-direction: column;",
        "  gap: " + BUTTON_GROUP_GAP + "px;",
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
    ensureTitleSyncWidget(node);
    ensurePortSyncWidget(node);

    var wrap = document.createElement("div");
    wrap.className = "xlinker-button-group";

    var row1 = document.createElement("div");
    row1.className = "xlinker-button-row";
    wrap.appendChild(row1);

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

    row1.appendChild(hideButton);
    row1.appendChild(highlightButton);

    var row2 = document.createElement("div");
    row2.className = "xlinker-button-row";
    wrap.appendChild(row2);

    var titleSyncButton = document.createElement("button");
    titleSyncButton.type = "button";
    titleSyncButton.className = "xlinker-button";
    titleSyncButton.textContent = titleSyncButtonLabel();
    titleSyncButton.title = buttonGroupTooltip(node, "title_sync");
    titleSyncButton.setAttribute("aria-label", titleSyncButton.title);
    titleSyncButton.addEventListener("click", function () {
        clickTitleSyncButton(node);
    });

    var portSyncButton = document.createElement("button");
    portSyncButton.type = "button";
    portSyncButton.className = "xlinker-button";
    portSyncButton.textContent = portSyncButtonLabel();
    portSyncButton.title = buttonGroupTooltip(node, "port_sync");
    portSyncButton.setAttribute("aria-label", portSyncButton.title);
    portSyncButton.addEventListener("click", function () {
        clickPortSyncButton(node);
    });

    row2.appendChild(titleSyncButton);
    row2.appendChild(portSyncButton);

    forwardPanelWheel(wrap);
    forwardPanelMiddleButton(wrap);

    if (typeof node.addDOMWidget === "function") {
        node.addDOMWidget(BUTTON_GROUP, "custom", wrap, {
            serialize: false,
            getMinHeight: function () {
                return BUTTON_GROUP_HEIGHT * 2 + BUTTON_GROUP_GAP;
            },
            margin: 4,
        });
    }

    node.__xlinkerButtonPanel = {
        wrap: wrap,
        hideButton: hideButton,
        highlightButton: highlightButton,
        titleSyncButton: titleSyncButton,
        portSyncButton: portSyncButton,
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
    var titleSyncOn = titleSyncEnabled(node);
    var portSyncOn = portSyncEnabled(node);

    panel.hideButton.textContent = hideButtonLabel() + " " + HIDE_BUTTON_TEXTS[hideState];
    panel.highlightButton.textContent = highlightButtonLabel() + " "
        + HIGHLIGHT_BUTTON_TEXTS[highlightOn ? 1 : 0];
    panel.titleSyncButton.textContent = titleSyncButtonLabel();
    panel.portSyncButton.textContent = portSyncButtonLabel();
    panel.hideButton.title = buttonGroupTooltip(node, "hide");
    panel.highlightButton.title = buttonGroupTooltip(node, "highlight");
    panel.titleSyncButton.title = buttonGroupTooltip(node, "title_sync");
    panel.portSyncButton.title = buttonGroupTooltip(node, "port_sync");
    panel.hideButton.setAttribute("aria-label", panel.hideButton.title);
    panel.highlightButton.setAttribute("aria-label", panel.highlightButton.title);
    panel.titleSyncButton.setAttribute("aria-label", panel.titleSyncButton.title);
    panel.portSyncButton.setAttribute("aria-label", panel.portSyncButton.title);
    applyButtonVisual(panel.hideButton, hideState !== HIDE_NONE);
    applyButtonVisual(panel.highlightButton, highlightOn);
    applyButtonVisual(panel.titleSyncButton, titleSyncOn);
    applyButtonVisual(panel.portSyncButton, portSyncOn);
}


// ---------------------------------------------------------------------------
// 类型不兼容警告检测
// ---------------------------------------------------------------------------
function getXLinkerLinkWarning(link, graph) {
    if (!link || link.id == null) return null;
    graph = graph || activeGraph();
    if (!graph) return null;
    var src = getNodeByIdInGraph(graph, link.origin_id);
    if (!isXLinker(src) || !src.outputs) return null;
    var output = src.outputs[link.origin_slot];
    if (!output) return null;
    var tgt = getNodeByIdInGraph(graph, link.target_id);
    var input = tgt && tgt.inputs ? tgt.inputs[link.target_slot] : null;
    if (!input) return null;

    var outType = cleanType(output.type) || cleanType(link.type);
    var inType = cleanType(input.type);
    if (!outType || !inType || outType === inType) return null;

    return {
        source: src,
        sourceSlot: link.origin_slot,
        target: tgt,
        outputType: outType,
        inputType: inType,
    };
}
function xlinkerOutputHasWarning(node) {
    var output = node && node.outputs ? node.outputs[0] : null;
    if (!output || !output.links) return false;
    for (var i = 0; i < output.links.length; i++) {
        if (getXLinkerLinkWarning(getLinkInfo(output.links[i], node.graph), node.graph)) {
            return true;
        }
    }
    return false;
}
function syncXLinkerOutputTypeFromInput(node) {
    // 根据输入端实际连接的类型，被动同步输出端口类型。
    // 用于处理上游节点（如 XPipe）静默改变输出类型时，
    // XLinker 也能自动更新并显示警告效果。
    //
    // 性能：onDrawForeground 每帧触发，故此函数用快速路径避免
    // 每帧 O(n) 遍历。仅当 link.type 与 output.type 不一致
    // 时才进入慢路径（getNodeByIdInGraph 遍历节点列表）。
    if (!isXLinker(node) || !node.graph || !node.inputs || !node.outputs) return;
    var input = node.inputs[0];
    var output = node.outputs[0];
    if (!output) return;

    if (!input || input.link == null) {
        // 无输入连接：输出回退为通配符
        if (output.type !== "*") {
            output.type = "*";
            syncLinkTypes(output, node.graph);
        }
        return;
    }

    var link = getLinkInfo(input.link, node.graph);
    if (!link) return;

    // 快速路径：link.type 已与 output.type 一致且非通配符 → 跳过
    var linkType = link.type;
    if (linkType && linkType !== "*" && linkType === output.type) return;

    // 慢路径：解析源节点确定实际类型
    var srcNode = getNodeByIdInGraph(node.graph, link.origin_id);
    if (!srcNode || !srcNode.outputs) return;
    var srcOutput = srcNode.outputs[link.origin_slot];
    if (!srcOutput) return;
    var srcType = srcOutput.type;
    if (!srcType || srcType === "*") return;

    if (output.type !== srcType) {
        output.type = srcType;
        syncLinkTypes(output, node.graph);
    }
}
function syncLinkTypes(output, graph) {
    // 将输出端口类型同步到所有下游链接的 type 元数据
    if (!output || !output.links || !graph) return;
    var newType = output.type;
    for (var i = 0; i < output.links.length; i++) {
        var outLink = getLinkInfo(output.links[i], graph);
        if (outLink) outLink.type = newType;
    }
}
function drawXLinkerWarningOutputRing(node, ctx) {
    if (!ctx || !isXLinker(node) || !node.outputs) return;
    var warnWidget = findWidget(node, "type_warning");
    if (warnWidget && !warnWidget.value) return;
    if (!xlinkerOutputHasWarning(node)) return;
    var output = node.outputs[0];
    var lineWidth = 2.5;
    var radius = 7;
    var glowBlur = warningGlowBlur();
    var pos = typeof node.getConnectionPos === "function"
        ? node.getConnectionPos(false, 0)
        : null;
    if (pos && node.pos) pos = [pos[0] - node.pos[0], pos[1] - node.pos[1]];
    else pos = output.pos || [node.size ? node.size[0] : 0, 35];
    ctx.save();
    ctx.strokeStyle = WARNING_COLOR;
    ctx.lineWidth = lineWidth;
    ctx.shadowColor = WARNING_GLOW;
    ctx.beginPath();
    ctx.arc(pos[0], pos[1], radius, 0, Math.PI * 2);
    // 三层叠加叠出厚辉光
    ctx.shadowBlur = glowBlur * 1.8; ctx.stroke();
    ctx.shadowBlur = glowBlur;       ctx.stroke();
    ctx.shadowBlur = glowBlur * 0.4; ctx.stroke();
    ctx.restore();
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

        // 类型不兼容警告：白线 + 三层红光辉光 + 黑虚线
        // 缩放处理由 origRenderLink 内部的 buildLinkRenderContext().scale
        // 统一负责，此处使用与 XPipe 完全一致的固定值。
        var warning = getXLinkerLinkWarning(link, graph);
        // 检查源节点的 type_warning 开关
        if (warning && warning.source) {
            var w = findWidget(warning.source, "type_warning");
            if (w && !w.value) warning = null;
        }
        if (warning) {
            var args = Array.prototype.slice.call(arguments);
            var baseBlur = warningGlowBlur();
            ctx.save();
            ctx.shadowColor = WARNING_GLOW;
            // 底层：白色实线 + 三层红光辉光，铺满整条线
            args[6] = "#ffffff";
            ctx.shadowBlur = baseBlur * 1.8; origRenderLink && origRenderLink.apply(this, args);
            ctx.shadowBlur = baseBlur;        origRenderLink && origRenderLink.apply(this, args);
            ctx.shadowBlur = baseBlur * 0.4; origRenderLink && origRenderLink.apply(this, args);
            // 上层：黑色虚线覆盖，形成黑白相间
            args[6] = WARNING_COLOR;
            if (ctx.setLineDash) ctx.setLineDash([8, 5]);
            ctx.shadowBlur = 0;
            origRenderLink && origRenderLink.apply(this, args);
            ctx.restore();
            return;
        }

        if (isLinkerHighlightedLink(link, graph)) {
            var args2 = Array.prototype.slice.call(arguments);
            var colors = ["red","orange","lime","cyan","magenta"];
            var cycle = 40, seg = cycle / colors.length;
            for (var c2 = 0; c2 < colors.length; c2++) {
                args2[6] = colors[c2];
                ctx.setLineDash([seg, cycle - seg]);
                ctx.lineDashOffset = -c2 * seg;
                origRenderLink && origRenderLink.apply(this, args2);
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
        installLocaleSync();
    },

    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (String(nodeData.name) !== NODE_CLASS) return;
        // 初始最小尺寸约束（ComfyUI 1.0 兼容）
        var origOnCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            origOnCreated && origOnCreated.apply(this, arguments);
            if (typeof this.setSize === "function") {
                var cs = this.computeSize();
                this.setSize([Math.max(cs[0], 200), Math.max(cs[1], 80)]);
            }
            // 监听 note_text widget 的变化
            var self = this;
            var noteWidget = findWidget(this, "note_text");
            if (noteWidget) {
                var origCallback = noteWidget.callback;
                noteWidget.callback = function () {
                    if (origCallback) origCallback.apply(this, arguments);
                    syncTitleFromNoteText(self);
                    syncPortNamesFromNoteText(self);
                };
            }
        };

        // 监听连接变化事件，阻止 MatchType 系统自动断开不兼容的输出链接。
        // 策略：在 withComfyMatchType → changeOutputType 执行之前，
        // 抢先将输出类型设为目标值。changeOutputType 检测到类型已匹配
        // 时会直接 return，跳过断开逻辑。这比拦截 disconnectInput 更可靠。
        var installOnConnectionsHook = function () {
            var origOnConnectionsChange = nodeType.prototype.onConnectionsChange;
            nodeType.prototype.onConnectionsChange = function (type, slotIndex, isConnected, link, ioSlot) {
                // 输入端变化时：抢先同步输出类型，让 changeOutputType 提前返回
                if (type === 1 /* LiteGraph.INPUT */ && this.graph && this.outputs && this.outputs[0]) {
                    var output = this.outputs[0];
                    if (isConnected && link) {
                        // 解析新连入链接的源类型，抢先赋值给输出
                        var linkInfo = getLinkInfo(
                            link && link.id != null ? link.id : link,
                            this.graph
                        );
                        if (linkInfo) {
                            var srcNode = getNodeByIdInGraph(this.graph, linkInfo.origin_id);
                            if (srcNode && srcNode.outputs && srcNode.outputs[linkInfo.origin_slot]) {
                                var srcType = srcNode.outputs[linkInfo.origin_slot].type;
                                if (srcType && srcType !== "*") {
                                    output.type = srcType;
                                }
                            }
                        }
                    } else if (!isConnected) {
                        // 断开时回退为通配符
                        output.type = "*";
                    }
                }

                // 调用 ComfyUI 原始 MatchType 处理
                // changeOutputType 发现 output.type 已等于 combinedType 时会直接 return
                if (origOnConnectionsChange) {
                    origOnConnectionsChange.apply(this, arguments);
                }
            };
        };
        // 推迟到下一个宏任务：此时 ComfyUI 的 MatchType 链已安装完成
        setTimeout(installOnConnectionsHook, 0);

        // 在节点绘制前景上：同步输出类型 + 叠加警告环
        // 解决上游节点（如 XPipe）静默改变输出类型时，XLinker
        // 无法通过 onConnectionsChange 感知的问题。
        var origOnDrawForeground = nodeType.prototype.onDrawForeground;
        nodeType.prototype.onDrawForeground = function (ctx) {
            if (origOnDrawForeground) origOnDrawForeground.apply(this, arguments);
            try {
                syncXLinkerOutputTypeFromInput(this);
                drawXLinkerWarningOutputRing(this, ctx);
            } catch (_e) { /* ignore */ }
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
        delete linkerTitleSyncEnabled[key];
        delete linkerPortSyncEnabled[key];
        delete node.__xlinkerButtonPanel;
    },
});
