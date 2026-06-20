import { app } from "../../scripts/app.js";

// XLinker 连线显隐透传节点前端扩展
// ===================================
// 标题栏 4 态切换按钮：不隐藏 / 仅隐藏输入线 / 仅隐藏输出线 / 全部隐藏
// 官方标题栏按钮 + renderLink 拦截，纯前端特性。

var NODE_CLASS = "XLinker";
var HIDE_NONE = 0;
var HIDE_INPUT = 1;   // bit 0
var HIDE_OUTPUT = 2;  // bit 1
var HIDE_BOTH = 3;    // bits 0+1
var linkerLinksHidden = {};      // nodeKey -> state (0-3)
var linkerLinksHighlighted = {}; // nodeKey -> bool
var canvasHooked = false;
var tooltipHooked = false;
var BUTTON_HIDE = "xlinker-hide";
var BUTTON_HIGHLIGHT = "xlinker-highlight";
var HIDE_BUTTON_TEXTS = ["◎", "◐", "◑", "○"];
var HIGHLIGHT_BUTTON_TEXTS = ["☆", "★"];
var TITLE_BUTTON_FONT_SIZE = 14;
var TITLE_BUTTON_HEIGHT = 22;
var TITLE_BUTTON_Y_OFFSET = 1;
var HIDE_BUTTON_X_OFFSET = -8;
var HIGHLIGHT_BUTTON_X_OFFSET = -14;
var TOOLTIP_ID = "xlinker-title-tooltip";
var TOOLTIP_STYLE_ID = "xlinker-title-tooltip-style";
var TOOLTIP_ACTIVE_CLASS = "xlinker-title-tooltip-active";
var LOCALE_PREFIX = "xdatahub.ui.node.xlinker";
var COMFY_LOCALE_KEY = "Comfy.Locale";
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
    return fetch("/xz3r0/xdatahub/i18n/ui?locale=" + encodeURIComponent(locale))
        .then(function (response) { return response.ok ? response.json() : {}; })
        .then(function (data) {
            i18nCache[locale] = data && data.dict ? data.dict : {};
            return i18nCache[locale];
        })
        .catch(function () { return {}; });
}

function resolveComfyLocale() {
    try {
        var value = app.extensionManager
            && app.extensionManager.setting
            && app.extensionManager.setting.get
            && app.extensionManager.setting.get(COMFY_LOCALE_KEY);
        if (value) return value;
    } catch (_e) { /* fall through */ }
    try {
        var stored = localStorage.getItem(COMFY_LOCALE_KEY);
        if (stored) return stored;
    } catch (_e) { /* fall through */ }
    if (document.documentElement && document.documentElement.lang) {
        return document.documentElement.lang;
    }
    return navigator.language || "en";
}

function loadLocaleBundle(locale) {
    var normalized = (
        locale === "zh" || locale === "zh-CN" || locale === "zh-TW"
    ) ? "zh" : "en";
    return Promise.all([fetchI18n("en"), fetchI18n(normalized)])
        .then(function (results) {
            uiLocaleFallback = results[0];
            uiLocalePrimary = normalized === "en" ? results[0] : results[1];
            return normalized;
        });
}

function nextState(state) {
    return (state + 1) % 4;
}

function hideButtonTooltip(state) {
    var next = nextState(state || HIDE_NONE);
    if (next === HIDE_INPUT) return tk("hide_input_links", "Hide input links");
    if (next === HIDE_OUTPUT) return tk("hide_output_links", "Hide output links");
    if (next === HIDE_BOTH) return tk("hide_all_links", "Hide all links");
    return tk("show_all_links", "Show all links");
}

function highlightButtonTooltip(highlightOn) {
    return highlightOn
        ? tk("stop_highlighting_links", "Stop highlighting links")
        : tk("highlight_links", "Highlight links");
}

function buttonTooltip(button, node) {
    var key = nodeKey(node);
    if (button && button.name === BUTTON_HIDE) {
        return hideButtonTooltip(linkerLinksHidden[key] || HIDE_NONE);
    }
    if (button && button.name === BUTTON_HIGHLIGHT) {
        return highlightButtonTooltip(!!linkerLinksHighlighted[key]);
    }
    return "";
}

function updateTitleButtons(node) {
    if (!node || !node.title_buttons) return;
    var key = nodeKey(node);
    var hideState = linkerLinksHidden[key] || HIDE_NONE;
    var highlightOn = !!linkerLinksHighlighted[key];

    for (var i = 0; i < node.title_buttons.length; i++) {
        var button = node.title_buttons[i];
        if (button.name === BUTTON_HIDE) {
            button.text = HIDE_BUTTON_TEXTS[hideState];
        } else if (button.name === BUTTON_HIGHLIGHT) {
            button.text = HIGHLIGHT_BUTTON_TEXTS[highlightOn ? 1 : 0];
        }
    }
}

function ensureTitleButtons(node) {
    if (!node || node.__xlinkerTitleButtonsReady) return;
    node.__xlinkerTitleButtonsReady = true;

    if (typeof node.addTitleButton === "function") {
        node.addTitleButton({
            name: BUTTON_HIDE,
            text: HIDE_BUTTON_TEXTS[linkerLinksHidden[nodeKey(node)] || HIDE_NONE],
            fontSize: TITLE_BUTTON_FONT_SIZE,
            height: TITLE_BUTTON_HEIGHT,
            xOffset: HIDE_BUTTON_X_OFFSET,
            yOffset: TITLE_BUTTON_Y_OFFSET,
        });
        node.addTitleButton({
            name: BUTTON_HIGHLIGHT,
            text: HIGHLIGHT_BUTTON_TEXTS[linkerLinksHighlighted[nodeKey(node)] ? 1 : 0],
            fontSize: TITLE_BUTTON_FONT_SIZE,
            height: TITLE_BUTTON_HEIGHT,
            xOffset: HIGHLIGHT_BUTTON_X_OFFSET,
            yOffset: TITLE_BUTTON_Y_OFFSET,
        });
    }

    var originalOnTitleButtonClick = node.onTitleButtonClick;
    node.onTitleButtonClick = function (button, canvas) {
        var key = nodeKey(this);
        if (button && button.name === BUTTON_HIDE) {
            linkerLinksHidden[key] = nextState(linkerLinksHidden[key] || HIDE_NONE);
            updateTitleButtons(this);
            hideTitleTooltip();
            canvas && canvas.setDirty && canvas.setDirty(true, true);
            return;
        }
        if (button && button.name === BUTTON_HIGHLIGHT) {
            linkerLinksHighlighted[key] = !linkerLinksHighlighted[key];
            updateTitleButtons(this);
            hideTitleTooltip();
            canvas && canvas.setDirty && canvas.setDirty(true, true);
            return;
        }
        if (originalOnTitleButtonClick) {
            return originalOnTitleButtonClick.apply(this, arguments);
        }
    };
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
        var s = linkerLinksHidden[nodeKey(src)] || 0;
        if (s & HIDE_OUTPUT) return true;
    }
    // 检查目标节点（输入侧）：state & HIDE_INPUT → 隐藏
    if (tgt && tgt.comfyClass === NODE_CLASS) {
        var s2 = linkerLinksHidden[nodeKey(tgt)] || 0;
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
// 标题栏按钮 tooltip
// ---------------------------------------------------------------------------
function ensureTooltipElement() {
    var style = document.getElementById(TOOLTIP_STYLE_ID);
    if (!style) {
        style = document.createElement("style");
        style.id = TOOLTIP_STYLE_ID;
        style.textContent = ""
            + "#" + TOOLTIP_ID + " {"
            + "position: fixed;"
            + "z-index: 100000;"
            + "max-width: 220px;"
            + "padding: 4px 8px;"
            + "border-radius: 4px;"
            + "background: rgba(20, 20, 24, 0.96);"
            + "color: #f4f4f5;"
            + "font: 12px/1.35 system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;"
            + "box-shadow: 0 6px 18px rgba(0, 0, 0, 0.28);"
            + "pointer-events: none;"
            + "opacity: 0;"
            + "white-space: nowrap;"
            + "transition: opacity 80ms ease;"
            + "}"
            + "#" + TOOLTIP_ID + ".is-visible { opacity: 1; }"
            + "body." + TOOLTIP_ACTIVE_CLASS + " .node-tooltip {"
            + "display: none !important;"
            + "}";
        document.head.appendChild(style);
    }

    var tooltip = document.getElementById(TOOLTIP_ID);
    if (!tooltip) {
        tooltip = document.createElement("div");
        tooltip.id = TOOLTIP_ID;
        tooltip.setAttribute("role", "tooltip");
        document.body.appendChild(tooltip);
    }
    return tooltip;
}

function hideTitleTooltip() {
    var tooltip = document.getElementById(TOOLTIP_ID);
    if (tooltip) tooltip.classList.remove("is-visible");
    if (document.body) document.body.classList.remove(TOOLTIP_ACTIVE_CLASS);
}

function showTitleTooltip(text, event) {
    if (!text || !event) {
        hideTitleTooltip();
        return;
    }

    var tooltip = ensureTooltipElement();
    tooltip.textContent = text;
    tooltip.classList.add("is-visible");
    if (document.body) document.body.classList.add(TOOLTIP_ACTIVE_CLASS);

    var width = tooltip.offsetWidth || 0;
    var height = tooltip.offsetHeight || 0;
    var x = event.clientX + 12;
    var y = event.clientY - height - 10;
    var maxX = window.innerWidth - width - 8;
    if (x > maxX) x = Math.max(8, event.clientX - width - 12);
    if (y < 8) y = event.clientY + 14;

    tooltip.style.left = Math.max(8, x) + "px";
    tooltip.style.top = Math.max(8, y) + "px";
}

function mouseEventToCanvasEvent(canvas, event) {
    if (!canvas || !canvas.canvas || !canvas.ds || !event) return event;
    var rect = canvas.canvas.getBoundingClientRect();
    var x = event.clientX - rect.left;
    var y = event.clientY - rect.top;
    return {
        clientX: event.clientX,
        clientY: event.clientY,
        canvasX: x / canvas.ds.scale - canvas.ds.offset[0],
        canvasY: y / canvas.ds.scale - canvas.ds.offset[1],
    };
}

function titleButtonAt(canvas, event) {
    if (!canvas || !event || event.canvasX == null || event.canvasY == null) {
        return null;
    }

    var graph = canvas.graph || activeGraph();
    var nodes = (canvas.visible_nodes && canvas.visible_nodes.length)
        ? canvas.visible_nodes
        : ((graph && (graph._nodes || graph.nodes)) || []);

    for (var i = nodes.length - 1; i >= 0; i--) {
        var node = nodes[i];
        if (String(node.comfyClass || node.type || "") !== NODE_CLASS) continue;
        if (node.flags && node.flags.collapsed) continue;
        if (!node.title_buttons || !node.pos) continue;

        var nodeRelativeX = event.canvasX - node.pos[0];
        var nodeRelativeY = event.canvasY - node.pos[1];
        for (var j = 0; j < node.title_buttons.length; j++) {
            var button = node.title_buttons[j];
            if (button.visible === false || !button.isPointInside) continue;
            if (button.isPointInside(nodeRelativeX, nodeRelativeY)) {
                return { node: node, button: button };
            }
        }
    }
    return null;
}

function updateTitleTooltip(canvas, event) {
    try {
        var hit = titleButtonAt(canvas, event);
        if (!hit) {
            hideTitleTooltip();
            return;
        }
        showTitleTooltip(buttonTooltip(hit.button, hit.node), event);
    } catch (_e) {
        hideTitleTooltip();
    }
}

function installTooltipHooks() {
    if (tooltipHooked) return;
    if (!app.canvas || !app.canvas.canvas) {
        setTimeout(installTooltipHooks, 200);
        return;
    }
    tooltipHooked = true;

    var canvas = app.canvas;
    var domCanvas = canvas.canvas;
    domCanvas.addEventListener("mousemove", function (event) {
        updateTitleTooltip(canvas, mouseEventToCanvasEvent(canvas, event));
    }, { passive: true });
    ["mouseleave", "mousedown", "wheel", "contextmenu"].forEach(function (type) {
        domCanvas.addEventListener(type, hideTitleTooltip, { passive: true });
    });
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
    installTooltipHooks();

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
        loadLocaleBundle(resolveComfyLocale());
        installCanvasHooks();
    },

    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (String(nodeData.name) !== NODE_CLASS) return;
        // 初始最小尺寸约束（ComfyUI 1.0 兼容）
        var origOnCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            origOnCreated && origOnCreated.apply(this, arguments);
            ensureTitleButtons(this);
            if (typeof this.setSize === "function") {
                var cs = this.computeSize();
                this.setSize([Math.max(cs[0], 200), Math.max(cs[1], 60)]);
            }
        };

    },

    nodeCreated(node) {
        if (String(node.comfyClass || node.type || "") !== NODE_CLASS) return;
        ensureTitleButtons(node);
        updateTitleButtons(node);
    },

    loadedGraphNode(node) {
        if (String(node.comfyClass || node.type || "") !== NODE_CLASS) return;
        ensureTitleButtons(node);
        updateTitleButtons(node);
    },

    async nodeRemoved(node) {
        if (String(node.comfyClass || node.type || "") !== NODE_CLASS) return;
        var key = nodeKey(node);
        delete linkerLinksHidden[key];
        delete linkerLinksHighlighted[key];
        hideTitleTooltip();
    },
});
