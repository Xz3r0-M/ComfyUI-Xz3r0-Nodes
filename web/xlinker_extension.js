import { app } from "../../scripts/app.js";
import {
    inputConnected,
    inputLinkId,
    outputLinkIds,
} from "./core/slot-links.js";
import { rootGraphOf } from "./core/root-graph.js";
import { setComfyTip } from "./core/tooltip.js";

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
var BUTTON_GROUP_HEIGHT = 24;   // 胶囊那一行
var SWITCH_ROW_HEIGHT = 18;     // 三个开关那一行
var LINKER_EXTRA_HEIGHT = 10;
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
// 输出类型同步 / 警告环判定的轮询间隔。以前是每帧跑（挂 onDrawForeground），
// 现在改成定时器：Nodes 2.0 下节点级绘制钩子不执行，而且绘制钩子本就
// 不该改状态。200ms 比原来省 12 倍，肉眼无差别。
var XLINKER_STATE_SYNC_MS = 200;
var xlinkerStateTimer = null;
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
        || rootGraphOf(app);
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

function markCanvasDirty() {
    if (app.canvas && typeof app.canvas.setDirty === "function") {
        app.canvas.setDirty(true, true);
    }
}

/** 胶囊点哪档就切到哪档（不再循环点） */
function applyHideState(node, state) {
    setHiddenState(node, state);
    updateTitleButtons(node);
    markCanvasDirty();
}

function applyHighlight(node, enabled) {
    linkerLinksHighlighted[nodeKey(node)] = !!enabled;
    updateTitleButtons(node);
    markCanvasDirty();
}

function applyTitleSync(node, enabled) {
    setTitleSyncEnabled(node, !!enabled);
    updateTitleButtons(node);
    if (titleSyncEnabled(node)) {
        syncTitleFromNoteText(node);
    }
    markCanvasDirty();
}

function applyPortSync(node, enabled) {
    var wasEnabled = portSyncEnabled(node);
    setPortSyncEnabled(node, !!enabled);
    updateTitleButtons(node);
    if (!wasEnabled) {
        // 刚刚开启，同步端口名称
        syncPortNamesFromNoteText(node);
    } else {
        // 刚刚关闭，还原原始端口名称
        resetPortNames(node);
    }
    markCanvasDirty();
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
        /* 两行都写死高度：图形/文字换成别的也不会把节点顶高 */
        ".xlinker-row {",
        "  display: flex;",
        "  align-items: center;",
        "  gap: 6px;",
        "  width: 100%;",
        "  box-sizing: border-box;",
        "}",
        ".xlinker-pill-row {",
        "  height: " + BUTTON_GROUP_HEIGHT + "px;",
        "}",
        ".xlinker-switch-row {",
        "  height: " + SWITCH_ROW_HEIGHT + "px;",
        "  justify-content: space-between;",
        "}",
        ".xlinker-row-label {",
        "  flex: 0 0 auto;",
        "  font: 11px sans-serif;",
        "  line-height: 1;",
        "  opacity: 0.72;",
        "  white-space: nowrap;",
        "}",
        /* 胶囊切换（跟 XLoraGet 的「未分组/全部/已分组」同一种） */
        ".xlinker-pill {",
        "  display: inline-flex;",
        "  align-items: center;",
        "  gap: 2px;",
        "  padding: 2px;",
        "  border: 1px solid var(--border-color, #555);",
        "  border-radius: 999px;",
        "  background: color-mix(in srgb, currentColor 7%, transparent);",
        "  box-sizing: border-box;",
        "  flex: 0 0 auto;",
        "}",
        ".xlinker-pill-btn {",
        "  padding: 2px 7px;",
        "  border: none;",
        "  border-radius: 999px;",
        "  background: transparent;",
        "  color: inherit;",
        "  font: 11px/1.4 sans-serif;",
        "  letter-spacing: 0;",
        "  white-space: nowrap;",
        "  cursor: pointer;",
        "  opacity: 0.62;",
        "  transition: background 120ms, opacity 120ms;",
        "  appearance: none;",
        "}",
        ".xlinker-pill-btn:hover {",
        "  opacity: 0.9;",
        "}",
        ".xlinker-pill-btn.is-active {",
        "  opacity: 1;",
        "  background: color-mix(",
        "    in srgb, var(--xdh-brand-pink, #ff385c) 26%, transparent);",
        "  box-shadow: inset 0 0 0 1px color-mix(",
        "    in srgb, var(--xdh-brand-pink, #ff385c) 45%, transparent);",
        "}",
        /* 圆点开关（跟 XLoraGet 的 Clip 开关同一种） */
        ".xlinker-switch {",
        "  display: inline-flex;",
        "  align-items: center;",
        "  gap: 5px;",
        "  font: 11px sans-serif;",
        "  line-height: 1;",
        "  color: var(--input-text, #ddd);",
        "  user-select: none;",
        "  white-space: nowrap;",
        "  cursor: pointer;",
        /* 节点被拖窄时允许收缩（文字末尾出省略号），而不是溢出到节点外 */
        "  flex: 0 1 auto;",
        "  min-width: 0;",
        "}",
        ".xlinker-switch-text {",
        "  overflow: hidden;",
        "  text-overflow: ellipsis;",
        "}",
        ".xlinker-switch-input {",
        "  position: absolute;",
        "  opacity: 0;",
        "  width: 0;",
        "  height: 0;",
        "  pointer-events: none;",
        "}",
        ".xlinker-switch-track {",
        "  position: relative;",
        "  display: inline-flex;",
        "  align-items: center;",
        "  flex: 0 0 auto;",
        "  width: 22px;",
        "  min-width: 22px;",
        "  height: 12px;",
        "  border-radius: 999px;",
        "  border: 1px solid color-mix(in srgb, currentColor 26%, transparent);",
        "  background: color-mix(in srgb, currentColor 10%, transparent);",
        "  box-sizing: border-box;",
        "  transition: background 150ms ease, border-color 150ms ease,",
        "    box-shadow 150ms ease;",
        "}",
        ".xlinker-switch-track::after {",
        "  content: \"\";",
        "  position: absolute;",
        "  top: 1px;",
        "  left: 1px;",
        "  width: 8px;",
        "  height: 8px;",
        "  border-radius: 50%;",
        "  background: currentColor;",
        "  opacity: 0.7;",
        "  transition: transform 150ms ease, background 150ms ease,",
        "    opacity 150ms ease;",
        "}",
        ".xlinker-switch-input:checked + .xlinker-switch-track {",
        "  border-color: var(--xdh-brand-pink, #ff385c);",
        "  background: color-mix(",
        "    in srgb, var(--xdh-brand-pink, #ff385c) 30%, transparent);",
        "}",
        ".xlinker-switch-input:checked + .xlinker-switch-track::after {",
        "  transform: translateX(10px);",
        "  background: var(--xdh-brand-pink, #ff385c);",
        "  opacity: 1;",
        "}",
        ".xlinker-switch-input:focus-visible + .xlinker-switch-track {",
        "  box-shadow: 0 0 0 1px var(--xdh-brand-pink, #ff385c);",
        "}",
    ].join("\n");
    (document.head || document.documentElement).appendChild(style);
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
        // 锁住指针：中键拖出面板时不丢事件（否则平移会卡住）
        panel.setPointerCapture?.(e.pointerId);
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
        panel.releasePointerCapture?.(e.pointerId);
        var cvs = app.canvas;
        if (!cvs || typeof cvs.processMouseUp !== "function") return;
        cvs.processMouseUp(e);
    });
}

/** 圆点开关：文字 + 轨道 + 圆点（跟 XLoraGet 的 Clip 开关同一种）。 */
function createLinkerSwitch(opts) {
    var label = document.createElement("label");
    label.className = "xlinker-switch";

    var input = document.createElement("input");
    input.type = "checkbox";
    input.className = "xlinker-switch-input";

    var track = document.createElement("span");
    track.className = "xlinker-switch-track";
    track.setAttribute("aria-hidden", "true");

    var text = document.createElement("span");
    text.className = "xlinker-switch-text";
    text.textContent = opts.label;

    label.appendChild(input);
    label.appendChild(track);
    label.appendChild(text);

    input.addEventListener("change", function () {
        opts.onChange(!!input.checked);
    });

    return { label: label, input: input, track: track, text: text };
}

function createButtonGroupPanel(node) {
    if (!node || typeof document === "undefined") return null;
    ensureButtonGroupStyles();
    ensureHiddenStateWidget(node);
    ensureTitleSyncWidget(node);
    ensurePortSyncWidget(node);

    var wrap = document.createElement("div");
    wrap.className = "xlinker-button-group";

    // 第1行：连线 [◀▶ | ◁▶ | ◀▷ | ◁▷]
    // 四档直接点，比原来「点一下轮一个」省事，也一眼看出当前哪档
    var row1 = document.createElement("div");
    row1.className = "xlinker-row xlinker-pill-row";

    var linksLabel = document.createElement("span");
    linksLabel.className = "xlinker-row-label";
    linksLabel.textContent = hideButtonLabel();
    row1.appendChild(linksLabel);

    var hidePill = document.createElement("span");
    hidePill.className = "xlinker-pill";
    var hideButtons = [];
    for (var state = HIDE_NONE; state <= HIDE_BOTH; state++) {
        var seg = document.createElement("button");
        seg.type = "button";
        seg.className = "xlinker-pill-btn";
        seg.textContent = HIDE_BUTTON_TEXTS[state];
        seg.setAttribute("data-hide", String(state));
        seg.addEventListener("click", (function (target) {
            return function () { applyHideState(node, target); };
        })(state));
        hidePill.appendChild(seg);
        hideButtons.push(seg);
    }
    row1.appendChild(hidePill);
    wrap.appendChild(row1);

    // 第2行：三个开关（高亮 / 标题 / 端口）
    var row2 = document.createElement("div");
    row2.className = "xlinker-row xlinker-switch-row";

    var highlightSwitch = createLinkerSwitch({
        label: highlightButtonLabel(),
        onChange: function (on) {
            applyHighlight(node, on);
        },
    });
    var titleSyncSwitch = createLinkerSwitch({
        label: titleSyncButtonLabel(),
        onChange: function (on) {
            applyTitleSync(node, on);
        },
    });
    var portSyncSwitch = createLinkerSwitch({
        label: portSyncButtonLabel(),
        onChange: function (on) {
            applyPortSync(node, on);
        },
    });

    row2.appendChild(highlightSwitch.label);
    row2.appendChild(titleSyncSwitch.label);
    row2.appendChild(portSyncSwitch.label);
    wrap.appendChild(row2);

    forwardPanelWheel(wrap);
    forwardPanelMiddleButton(wrap);

    if (typeof node.addDOMWidget === "function") {
        node.addDOMWidget(BUTTON_GROUP, "custom", wrap, {
            serialize: false,
            getMinHeight: function () {
                return BUTTON_GROUP_HEIGHT + SWITCH_ROW_HEIGHT
                    + BUTTON_GROUP_GAP;
            },
            margin: 4,
        });
    }

    node.__xlinkerButtonPanel = {
        wrap: wrap,
        linksLabel: linksLabel,
        hidePill: hidePill,
        hideButtons: hideButtons,
        highlightSwitch: highlightSwitch,
        titleSyncSwitch: titleSyncSwitch,
        portSyncSwitch: portSyncSwitch,
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

    // 胶囊：当前那档实心
    if (panel.linksLabel) {
        panel.linksLabel.textContent = hideButtonLabel();
    }
    if (panel.hidePill) {
        setComfyTip(
            panel.hidePill,
            tk(hideTitleKey(hideState), "Show or hide links")
        );
        panel.hidePill.setAttribute("aria-label", panel.hidePill.title);
    }
    if (panel.hideButtons) {
        for (var i = 0; i < panel.hideButtons.length; i++) {
            var seg = panel.hideButtons[i];
            if (i === hideState) {
                seg.classList.add("is-active");
            } else {
                seg.classList.remove("is-active");
            }
            setComfyTip(seg, tk(hideTitleKey(i), "Show or hide links"));
        }
    }

    // 开关：文字 + 勾选态 + 悬停解释
    var switches = [
        { box: panel.highlightSwitch, on: highlightOn, label: highlightButtonLabel() },
        { box: panel.titleSyncSwitch, on: titleSyncOn, label: titleSyncButtonLabel() },
        { box: panel.portSyncSwitch, on: portSyncOn, label: portSyncButtonLabel() },
    ];
    var roles = ["highlight", "title_sync", "port_sync"];
    for (var k = 0; k < switches.length; k++) {
        var item = switches[k];
        if (!item.box) continue;
        if (item.box.input) item.box.input.checked = !!item.on;
        if (item.box.text) item.box.text.textContent = item.label;
        if (item.box.label) {
            setComfyTip(item.box.label, buttonGroupTooltip(node, roles[k]));
            item.box.label.setAttribute("aria-label", item.box.label.title);
        }
    }
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
    if (!outType || !inType) return null;
    if (LiteGraph.isValidConnection(outType, inType)) return null;

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
    if (!output) return false;
    var linkIds = outputLinkIds(node, output);
    for (var i = 0; i < linkIds.length; i++) {
        if (getXLinkerLinkWarning(getLinkInfo(linkIds[i], node.graph), node.graph)) {
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
    // 性能：由 installXLinkerStateTicker 每 200ms 调一次（以前是每帧），
    // 快速路径：仅当 link.type 与 output.type 不一致时才进入慢路径
    // （getNodeByIdInGraph 遍历节点列表）。
    if (!isXLinker(node) || !node.graph || !node.inputs || !node.outputs) return;
    var input = node.inputs[0];
    var output = node.outputs[0];
    if (!output) return;

    var inputLink = input ? inputLinkId(node, input) : null;
    if (inputLink == null) {
        // 无输入连接：输出回退为通配符
        if (output.type !== "*") {
            output.type = "*";
            syncLinkTypes(node, output);
        }
        return;
    }

    var link = getLinkInfo(inputLink, node.graph);
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
        syncLinkTypes(node, output);
    }
}

function syncLinkTypes(node, output) {
    // 将输出端口类型同步到所有下游链接的 type 元数据
    if (!node || !output || !node.graph) return;
    var newType = output.type;
    var linkIds = outputLinkIds(node, output);
    for (var i = 0; i < linkIds.length; i++) {
        var outLink = getLinkInfo(linkIds[i], node.graph);
        if (outLink) outLink.type = newType;
    }
}
function drawXLinkerWarningOutputRing(node, ctx) {
    if (!ctx || !isXLinker(node) || !node.outputs) return;
    var warnWidget = findWidget(node, "type_warning");
    if (warnWidget && !warnWidget.value) return;
    // 只读缓存：是否要画由 refreshXLinkerNodeState 预先算好。
    // 绘制钩子每帧都跑，不能在这里做全图遍历。
    if (!node.__xlinkerOutputWarning) return;
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
function xlinkerNodesInActiveGraph() {
    var graph = activeGraph();
    var nodes = (graph && (graph._nodes || graph.nodes)) || [];
    var out = [];
    for (var i = 0; i < nodes.length; i++) {
        if (isXLinker(nodes[i])) out.push(nodes[i]);
    }
    return out;
}

/**
 * 同步一个 XLinker 节点的输出类型，并顺手缓存「要不要画警告环」。
 * 两件事必须分开：类型同步是改状态，警告环是纯读取。
 */
function refreshXLinkerNodeState(node) {
    if (!isXLinker(node)) return;
    try {
        syncXLinkerOutputTypeFromInput(node);
        node.__xlinkerOutputWarning = xlinkerOutputHasWarning(node);
    } catch (_e) {
        node.__xlinkerOutputWarning = false;
    }
}

function refreshAllXLinkerState() {
    var nodes = xlinkerNodesInActiveGraph();
    for (var i = 0; i < nodes.length; i++) {
        refreshXLinkerNodeState(nodes[i]);
    }
}

/**
 * 定时器：每 XLINKER_STATE_SYNC_MS 同步一次输出类型 + 刷新警告环标记。
 *
 * 以前这两件事都挂在 node.onDrawForeground 里（借每帧执行当轮询）。
 * 那样有两个问题：
 *   1. Nodes 2.0 下 LGraphCanvas.drawNode() 直接 return，节点级绘制钩子
 *      完全不执行 → 输出类型不再跟随上游（不报错，纯静默失效）。
 *   2. 绘制钩子本就该只画、不改状态。
 */
function installXLinkerStateTicker() {
    if (xlinkerStateTimer) return;
    refreshAllXLinkerState();
    xlinkerStateTimer = setInterval(refreshAllXLinkerState, XLINKER_STATE_SYNC_MS);
}

/**
 * 警告环改挂**画布级** onDrawForeground：两种渲染器下都会执行。
 * 坐标：此处的 ctx 已经包含画布缩放/平移，并且与节点用同一套坐标，
 * 所以平移到 node.pos 后就能复用原来的绘制函数。
 */
function installXLinkerRingHook() {
    var canvas = app.canvas;
    if (!canvas || canvas.__xlinkerRingInstalled) return;
    canvas.__xlinkerRingInstalled = true;
    var orig = canvas.onDrawForeground;
    canvas.onDrawForeground = function (ctx, area) {
        if (orig) orig.apply(this, arguments);
        try {
            var graph = this.graph || activeGraph();
            var nodes = (graph && (graph._nodes || graph.nodes)) || [];
            for (var i = 0; i < nodes.length; i++) {
                var node = nodes[i];
                if (!node || !node.__xlinkerOutputWarning) continue;
                if (!isXLinker(node) || !node.pos) continue;
                ctx.save();
                ctx.translate(node.pos[0], node.pos[1]);
                drawXLinkerWarningOutputRing(node, ctx);
                ctx.restore();
            }
        } catch (_e) { /* 忽略绘制失败，不影响画布其他内容 */ }
    };
}

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

    // 输出端口类型不兼容的呼吸光环（画布级，Nodes 2.0 下同样生效）
    installXLinkerRingHook();

    // 连线中点右键菜单（2.0 下节点/端口变成 Vue DOM 了，但连线还在
    // canvas 上，showLinkMenu 依然会跑）
    installLinkMenuHook(app.canvas);
}
// ---------------------------------------------------------------------------
// 端口右键菜单：将连接转换为 XLinker
// ---------------------------------------------------------------------------
var _xlinkerSlotMenuInstalled = false;

function installXLinkerSlotMenu(nodeType) {
    if (_xlinkerSlotMenuInstalled) return;
    _xlinkerSlotMenuInstalled = true;

    // 通过原型链获取 LGraphNode.prototype（比 LiteGraph.LGraphNode 更可靠）
    // nodeType 继承自 LGraphNode，找到最顶层的父类原型
    var LGraphNodeProto = Object.getPrototypeOf(nodeType.prototype);
    if (!LGraphNodeProto) return;

    // 保存原始 getExtraSlotMenuOptions（如果有的话）
    var _origGetExtraSlotMenuOptions = LGraphNodeProto.getExtraSlotMenuOptions;

    LGraphNodeProto.getExtraSlotMenuOptions = function (slot) {
        var options = [];

        // 调用原始实现
        if (typeof _origGetExtraSlotMenuOptions === "function") {
            options = _origGetExtraSlotMenuOptions.call(this, slot) || [];
        }

        // 跳过 XLinker 自身
        if (isXLinker(this)) return options;

        var graph = this.graph;
        if (!graph) return options;

        var hasOutputLinks = !!(slot.output
            && outputLinkIds(this, slot.output).length > 0);
        var hasInputLink = !!(slot.input && inputConnected(this, slot.input));

        if (!hasOutputLinks && !hasInputLink) return options;

        var canvasRef = app.canvas;

        if (hasOutputLinks) {
            options.push({
                content: tk(
                    "convert_output_to_xlinker",
                    "Convert Output to XLinker"
                ),
                callback: (function (node, slotIndex, g, canvas) {
                    return function () {
                        convertOutputToXLinker(node, slotIndex, g, canvas);
                    };
                })(this, slot.slot, graph, canvasRef),
            });
        }

        if (hasInputLink) {
            options.push({
                content: tk(
                    "convert_input_to_xlinker",
                    "Convert Input to XLinker"
                ),
                callback: (function (node, slotIndex, g, canvas) {
                    return function () {
                        convertInputToXLinker(node, slotIndex, g, canvas);
                    };
                })(this, slot.slot, graph, canvasRef),
            });
        }

        return options;
    };
}

// ---------------------------------------------------------------------------
// Nodes 2.0（Vue 节点）：端口右键菜单
// ---------------------------------------------------------------------------
// 2.0 里端口是 Vue 组件里的 DOM（圆点带 data-slot-key="<nodeId>-out-<i>"），
// 整个节点由 Vue 处理右键 → LGraphCanvas.processContextMenu 根本不会被
// 调用，所以 1.0 那一套 getExtraSlotMenuOptions 在 2.0 下**永远不执行**。
// 这里在 document 捕获阶段接管「右键落在槽位圆点上」的情况，
// 用 LiteGraph.ContextMenu（浮层 DOM，两种模式都能用）弹自己的菜单。
//
// 认端口两条路，缺一不可：
//   A. DOM 上的 data-slot-key（精确，但只有圆点本体有；24px 命中区没有）
//   B. 鼠标坐标反算（兜底，跟 1.0 一样按「端口 20px 命中框」认）
// 为什么一定要 B：圆点视觉只有 8px（画布 85% 缩放时更小），用户经常点在
// 它周边 24px 的命中区上，那些 DOM 上根本没有 data-slot-key。
var SLOT_KEY_RE = /^(.+?)-(in|out)-(\d+)$/;

function isVueNodesMode() {
    var lite = typeof LiteGraph !== "undefined" ? LiteGraph : null;
    return !!(lite && lite.vueNodesMode);
}

/** 按 id 宽松匹配（下标里 id 可能是数字也可能是字符串）。 */
function resolveNodeByLooseId(graph, rawId) {
    var nodes = (graph && (graph._nodes || graph.nodes)) || [];
    for (var i = 0; i < nodes.length; i++) {
        if (nodes[i] && String(nodes[i].id) === String(rawId)) return nodes[i];
    }
    return null;
}

function currentCanvasGraph() {
    if (app.canvas && app.canvas.graph) return app.canvas.graph;
    try {
        return activeGraph();
    } catch (_error) {
        return null;
    }
}

/**
 * 调试用：`window.__xlinkerSlotMenu` 里能看到「右键到底停在哪一步」。
 * 只有几个数字，开销可忽略，出问题时让用户看一眼就行。
 */
function slotMenuStats() {
    if (typeof window === "undefined") return null;
    var stats = window.__xlinkerSlotMenu;
    if (!stats) {
        stats = window.__xlinkerSlotMenu = {
            events: 0,
            byDom: 0,
            byPoint: 0,
            menus: 0,
            last: "",
        };
    }
    return stats;
}

/** 记下「最后停在哪一步」（no-slot / not-connected / menu …）。 */
function slotMenuNote(step) {
    var stats = slotMenuStats();
    if (stats) stats.last = step;
    return step;
}

/** A 路：从 DOM 上认端口（连点元素可能在事件路径里的任一层）。 */
function resolveSlotFromDom(event) {
    var path = null;
    if (typeof event.composedPath === "function") path = event.composedPath();
    var elements = path && path.length ? path : [event.target];
    var graph = currentCanvasGraph();
    for (var i = 0; i < elements.length; i += 1) {
        var el = elements[i];
        if (!el || typeof el.getAttribute !== "function") continue;
        var key = el.getAttribute("data-slot-key");
        if (!key) continue;
        var match = SLOT_KEY_RE.exec(String(key));
        if (!match) continue;
        var node = resolveNodeByLooseId(graph, match[1]);
        if (!node) continue;
        return {
            node: node,
            isOutput: match[2] === "out",
            index: Number(match[3]),
            via: "dom",
        };
    }
    return null;
}

/** B 路：鼠标坐标反算（客户端坐标 → 画布坐标 → 端口命中框）。 */
function resolveSlotByPoint(event) {
    var canvas = app.canvas;
    var graph = currentCanvasGraph();
    if (!canvas || !graph || !canvas.canvas) return null;
    var rect = canvas.canvas.getBoundingClientRect();
    var scale = (canvas.ds && canvas.ds.scale) || 1;
    var offset = (canvas.ds && canvas.ds.offset) || [0, 0];
    var x = (event.clientX - rect.left) / scale - offset[0];
    var y = (event.clientY - rect.top) / scale - offset[1];
    var nodes = (graph._nodes || graph.nodes || []).slice().reverse();
    for (var i = 0; i < nodes.length; i += 1) {
        var node = nodes[i];
        if (!node || typeof node.getSlotInPosition !== "function") continue;
        var found = null;
        try {
            found = node.getSlotInPosition(x, y);
        } catch (_error) {
            found = null;
        }
        if (!found) continue;
        return {
            node: node,
            isOutput: !!found.output,
            index: Number(found.slot),
            via: "point",
        };
    }
    return null;
}

function showSlotMenu(node, slotIndex, isOutput, slot, event) {
    var menuCtor = (typeof LiteGraph !== "undefined" && LiteGraph.ContextMenu)
        || null;
    if (!menuCtor) return slotMenuNote("no-context-menu");

    var canvasRef = app.canvas;
    var graphRef = node.graph || currentCanvasGraph();
    var items = [{
        content: isOutput
            ? tk("convert_output_to_xlinker", "Convert Output to XLinker")
            : tk("convert_input_to_xlinker", "Convert Input to XLinker"),
        callback: function () {
            if (isOutput) {
                convertOutputToXLinker(node, slotIndex, graphRef, canvasRef);
            } else {
                convertInputToXLinker(node, slotIndex, graphRef, canvasRef);
            }
        },
    }];

    // 拦住：否则会继续冒泡到 Vue 节点的右键菜单（那是另一套菜单）
    event.preventDefault();
    event.stopPropagation();
    if (typeof event.stopImmediatePropagation === "function") {
        event.stopImmediatePropagation();
    }

    new menuCtor(items, {
        event: event,
        title: String(slot.type || "*"),
    });
    return slotMenuNote("menu");
}

function handleVueSlotContextMenu(event) {
    // 1.0 → 交给 LiteGraph 自己的端口菜单（有断开/重命名等完整项）
    if (!isVueNodesMode()) return;
    var stats = slotMenuStats();
    if (stats) stats.events += 1;

    var hit = resolveSlotFromDom(event) || resolveSlotByPoint(event);
    if (!hit) return slotMenuNote("no-slot");
    if (stats) {
        if (hit.via === "dom") stats.byDom += 1;
        else stats.byPoint += 1;
    }

    var target = hit.node;
    if (!target) return slotMenuNote("no-node");
    if (isXLinker(target)) return slotMenuNote("self");

    var slot = hit.isOutput
        ? (target.outputs || [])[hit.index]
        : (target.inputs || [])[hit.index];
    if (!slot) return slotMenuNote("no-slot-object");

    var connected = hit.isOutput
        ? outputLinkIds(target, slot).length > 0
        : inputConnected(target, slot);
    if (!connected) return slotMenuNote("not-connected");

    if (stats) stats.menus += 1;
    showSlotMenu(target, hit.index, hit.isOutput, slot, event);
}

function installVueSlotMenu() {
    if (installVueSlotMenu.__installed) return;
    if (typeof document === "undefined") return;
    installVueSlotMenu.__installed = true;
    document.addEventListener("contextmenu", handleVueSlotContextMenu, true);
}

// ---------------------------------------------------------------------------
// 连线中点右键菜单（2.0 也能用 —— 连线是画在 canvas 上的）
// ---------------------------------------------------------------------------
// 2.0 里节点/端口都是 Vue DOM，但**连线依然画在 canvas 上**，所以
// 「右键连线中点」走的是 LGraphCanvas.showLinkMenu()，这条路是活的。
// 它内部 `new LiteGraph.ContextMenu([...])` 构造菜单，条目来自
// getLinkMenuOptions()（没有扩展钩子、不能追加）→ 只能在构造那一下插一条。
// 做法：临时把 LiteGraph.ContextMenu 换成包装版（**只在这次同步调用期间**），
// 用完 finally 立刻还原，其它菜单一点不受影响。
function linkMenuExtraItems(segment, canvas) {
    if (!segment) return [];
    var graph = (canvas && canvas.graph) || currentCanvasGraph();
    var index = Number(segment.origin_slot);
    if (!Number.isInteger(index) || index < 0) return [];
    var upstream = resolveNodeByLooseId(graph, segment.origin_id);
    if (!upstream || isXLinker(upstream)) return [];
    var slot = (upstream.outputs || [])[index];
    if (!slot) return [];
    if (outputLinkIds(upstream, slot).length === 0) return [];
    return [{
        content: tk("convert_output_to_xlinker", "Convert Output to XLinker"),
        callback: function () {
            convertOutputToXLinker(upstream, index, upstream.graph, canvas);
        },
    }];
}

/** 把我们的项插到 Delete 之前（用 null 分隔线隔开）。 */
function insertLinkMenuItems(values, extra) {
    if (!Array.isArray(values)) return values;
    var out = values.slice();
    var at = -1;
    for (var i = 0; i < out.length; i += 1) {
        var entry = out[i];
        var text = typeof entry === "string"
            ? entry
            : (entry && entry.content) || "";
        if (String(text) === "Delete") {
            at = i;
            break;
        }
    }
    if (at < 0) return out.concat([null], extra);
    // Delete 前面本来就有分隔线 → 直接插在那条线之前，不再多插一条
    if (out[at - 1] == null) {
        return out.slice(0, at - 1).concat(extra, out.slice(at - 1));
    }
    return out.slice(0, at).concat(extra, [null], out.slice(at));
}

function installLinkMenuHook(canvas) {
    var target = canvas || app.canvas;
    if (!target) return;
    var proto = Object.getPrototypeOf(target);
    if (!proto || typeof proto.showLinkMenu !== "function") return;
    if (proto.__xlinkerShowLinkMenuPatched) return;
    proto.__xlinkerShowLinkMenuPatched = true;

    var origShowLinkMenu = proto.showLinkMenu;
    proto.showLinkMenu = function (segment, event, presentationLink) {
        var extra = [];
        try {
            extra = linkMenuExtraItems(segment, this);
        } catch (_error) {
            extra = [];
        }
        if (!extra.length || typeof LiteGraph === "undefined") {
            return origShowLinkMenu.apply(this, arguments);
        }
        var origMenu = LiteGraph.ContextMenu;
        if (typeof origMenu !== "function") {
            return origShowLinkMenu.apply(this, arguments);
        }
        var swapped = function (values, options) {
            return new origMenu(
                Array.isArray(values)
                    ? insertLinkMenuItems(values, extra)
                    : values,
                options
            );
        };
        swapped.prototype = origMenu && origMenu.prototype;
        LiteGraph.ContextMenu = swapped;
        try {
            return origShowLinkMenu.apply(this, arguments);
        } finally {
            LiteGraph.ContextMenu = origMenu;
        }
    };
}

function convertOutputToXLinker(node, slotIndex, graph, canvas) {
    var output = node.outputs[slotIndex];

    // 先取链接 id（断开后就连线库也查不到了）
    var linkIds = outputLinkIds(node, output);
    if (linkIds.length === 0) return;

    // 收集目标信息
    var targets = [];
    for (var i = 0; i < linkIds.length; i++) {
        var linkInfo = getLinkInfo(linkIds[i], graph);
        if (linkInfo) {
            targets.push({
                target_id: linkInfo.target_id,
                target_slot: linkInfo.target_slot,
            });
        }
    }

    if (targets.length === 0) return;

    if (typeof graph.beforeChange === "function") graph.beforeChange();

    // 断开所有输出连接
    node.disconnectOutput(slotIndex);

    // 创建 XLinker 节点
    var linkerNode = (typeof LiteGraph !== "undefined" && LiteGraph.createNode)
        ? LiteGraph.createNode("XLinker")
        : null;
    if (!linkerNode) {
        if (typeof graph.afterChange === "function") graph.afterChange();
        return;
    }

    // 计算位置：放在源节点右侧
    var nodePos = node.pos;
    var nodeSize = node.size || [200, 80];
    linkerNode.pos = [
        nodePos[0] + nodeSize[0] + 80,
        nodePos[1] + slotIndex * 24,
    ];

    graph.add(linkerNode);

    // 源节点 -> XLinker
    node.connect(slotIndex, linkerNode, 0);

    // XLinker -> 所有原下游节点
    for (var j = 0; j < targets.length; j++) {
        var targetNode = graph.getNodeById(targets[j].target_id);
        if (targetNode) {
            linkerNode.connect(0, targetNode, targets[j].target_slot);
        }
    }

    if (typeof graph.afterChange === "function") graph.afterChange();
    if (typeof graph.change === "function") graph.change();
    if (canvas) canvas.setDirty(true, true);
}

function convertInputToXLinker(node, slotIndex, graph, canvas) {
    var input = node.inputs[slotIndex];

    var linkId = input ? inputLinkId(node, input) : null;
    if (linkId == null) return;
    var linkInfo = getLinkInfo(linkId, graph);
    if (!linkInfo) return;

    var sourceId = linkInfo.origin_id;
    var sourceSlot = linkInfo.origin_slot;

    if (typeof graph.beforeChange === "function") graph.beforeChange();

    // 断开输入连接
    node.disconnectInput(slotIndex, true);

    // 创建 XLinker 节点
    var linkerNode2 = (typeof LiteGraph !== "undefined" && LiteGraph.createNode)
        ? LiteGraph.createNode("XLinker")
        : null;
    if (!linkerNode2) {
        if (typeof graph.afterChange === "function") graph.afterChange();
        return;
    }

    // 计算位置：放在目标节点左侧
    var nodePos2 = node.pos;
    linkerNode2.pos = [
        nodePos2[0] - 240,
        nodePos2[1] + slotIndex * 24,
    ];

    graph.add(linkerNode2);

    // 上游源节点 -> XLinker
    var sourceNode = graph.getNodeById(sourceId);
    if (sourceNode) {
        sourceNode.connect(sourceSlot, linkerNode2, 0);
    }

    // XLinker -> 本节点
    linkerNode2.connect(0, node, slotIndex);

    if (typeof graph.afterChange === "function") graph.afterChange();
    if (typeof graph.change === "function") graph.change();
    if (canvas) canvas.setDirty(true, true);
}
app.registerExtension({
    name: "ComfyUI.Xz3r0.XLinker",

    async setup() {
        installCanvasHooks();
        installXLinkerStateTicker();
        installVueSlotMenu();
        applyUiLocale();
        installLocaleSync();
    },

    async beforeRegisterNodeDef(nodeType, nodeData) {
        // 在所有节点右键端口菜单中注入「转换为 XLinker」选项（仅首次执行）
        installXLinkerSlotMenu(nodeType);

        if (String(nodeData.name) !== NODE_CLASS) return;
        var origOnCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            origOnCreated && origOnCreated.apply(this, arguments);
            if (typeof this.setSize === "function") {
                var cs = this.computeSize();
                this.setSize([Math.max(cs[0], 200), Math.max(cs[1], 80) + LINKER_EXTRA_HEIGHT]);
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

                // 连线变化后立即刷新一次：输出类型 + 警告环标记
                // 不用等 ticker 的 200ms，光环能马上出现
                refreshXLinkerNodeState(this);
            };
        };
        // 推迟到下一个宏任务：此时 ComfyUI 的 MatchType 链已安装完成
        setTimeout(installOnConnectionsHook, 0);

        // 注意：输出类型同步与警告环都**不再**挂在 node.onDrawForeground 上。
        // 那个钩子在 Nodes 2.0（Vue 节点）下完全不执行（drawNode 直接 return），
        // 而且绘制钩子不该改状态。现状：
        //   - 类型同步 → installXLinkerStateTicker() 定时器 + onConnectionsChange
        //   - 警告环   → installXLinkerRingHook() 的画布级 onDrawForeground
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
