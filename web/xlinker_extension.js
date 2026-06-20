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
var HIDE_STATE_PROP = "xlinker_hide_links_state";
var linkerLinksHidden = {};      // nodeKey -> state (0-3)
var linkerLinksHighlighted = {}; // nodeKey -> bool
var canvasHooked = false;
var BUTTON_HIDE = "xlinker-hide";
var BUTTON_HIGHLIGHT = "xlinker-highlight";
var HIDE_BUTTON_TEXTS = ["◀▶", "◁▶", "◀▷", "◁▷"];
var HIGHLIGHT_BUTTON_TEXTS = ["☆", "★"];
var TITLE_BUTTON_FONT_SIZE = 14;
var TITLE_BUTTON_HEIGHT = 22;
var TITLE_BUTTON_Y_OFFSET = 1;
var HIDE_BUTTON_X_OFFSET = -8;
var HIGHLIGHT_BUTTON_X_OFFSET = -14;

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

function hiddenState(node) {
    var key = nodeKey(node);
    var state = linkerLinksHidden[key];
    if (state == null && node && node.properties) {
        state = node.properties[HIDE_STATE_PROP];
        if (state != null) linkerLinksHidden[key] = state;
    }
    if (state === true) return HIDE_BOTH;
    state = Number(state) || HIDE_NONE;
    return Math.max(HIDE_NONE, Math.min(HIDE_BOTH, state));
}

function setHiddenState(node, state) {
    var key = nodeKey(node);
    var normalized = Math.max(HIDE_NONE, Math.min(HIDE_BOTH, Number(state) || HIDE_NONE));
    node.properties = node.properties || {};
    if (normalized === HIDE_NONE) {
        delete linkerLinksHidden[key];
        delete node.properties[HIDE_STATE_PROP];
    } else {
        linkerLinksHidden[key] = normalized;
        node.properties[HIDE_STATE_PROP] = normalized;
    }
    if (node.graph && typeof node.graph.change === "function") {
        node.graph.change();
    }
}

function nextState(state) {
    return (state + 1) % 4;
}

function updateTitleButtons(node) {
    if (!node || !node.title_buttons) return;
    var key = nodeKey(node);
    var hideState = hiddenState(node);
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
            text: HIDE_BUTTON_TEXTS[hiddenState(node)],
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
            setHiddenState(this, nextState(hiddenState(this)));
            updateTitleButtons(this);
            canvas && canvas.setDirty && canvas.setDirty(true, true);
            return;
        }
        if (button && button.name === BUTTON_HIGHLIGHT) {
            linkerLinksHighlighted[key] = !linkerLinksHighlighted[key];
            updateTitleButtons(this);
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
    },
});
