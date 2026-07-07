/**
 * XPrimitiveCombo — 桥接 COMBO widget 并输出 STRING
 * ==================================================
 *
 * 在 XPrimitiveCombo 节点上添加第二个 BRIDGE 输出端口 (type=*)，
 * 连接到目标节点的 widget 输入时动态创建匹配控件，并双向同步值。
 *
 * 数据流：
 *   BRIDGE 输出 → 目标 widget 输入
 *        ↕ (双向同步)
 *   bridge_control 控件 → bridge_value 隐藏 widget → Python execute()
 *                                                      ↓
 *                                                STRING 输出 → 下游节点
 *
 * 用法：
 *   1. 将 XPrimitiveCombo 的 BRIDGE 输出（右侧第2个端口）拖到
 *      任意节点的 COMBO/INT/FLOAT/STRING/BOOLEAN widget 输入上
 *   2. XPrimitiveCombo 自动创建匹配控件
 *   3. 控件值同步到目标节点，同时通过 STRING 输出传给下游
 */

import { app } from "../../scripts/app.js";

var NODE_CLASS = "XPrimitiveCombo";
var BRIDGE_OUTPUT_INDEX = 1;
var BRIDGE_OUTPUT_NAME = "connect to widget input";
var HIDDEN_WIDGET_NAME = "bridge_value";
var CONTROL_WIDGET_NAME = "bridge_control";

// ---------------------------------------------------------------------------
// 工具函数
// ---------------------------------------------------------------------------

function findWidget(node, name) {
    if (!node || !Array.isArray(node.widgets)) return null;
    for (var i = 0; i < node.widgets.length; i++) {
        if (node.widgets[i] && node.widgets[i].name === name) {
            return node.widgets[i];
        }
    }
    return null;
}

/**
 * 从 LiteGraph slot 读取 widget 配置。
 * 兼容两种来源：slot.widget.config（直接挂载）和
 * slot.widget[GET_CONFIG]()（延迟获取）。
 */
function getWidgetConfig(slot) {
    if (!slot || !slot.widget) return null;
    // config 直接挂载（由 ComfyUI V3 的 onGraphConfigured 注入）
    if (slot.widget.config) return slot.widget.config;
    // GET_CONFIG 符号（ComfyUI 内部约定）
    var getConfig =
        slot.widget.getConfig ||
        slot.widget[
            Object.getOwnPropertySymbols(slot.widget).find(function (s) {
                return String(s).indexOf("GET_CONFIG") >= 0;
            })
        ];
    if (typeof getConfig === "function") {
        return getConfig();
    }
    return null;
}

function getComfyWidgets() {
    // ComfyWidgets 挂载在全局
    if (typeof globalThis !== "undefined" && globalThis.ComfyWidgets) {
        return globalThis.ComfyWidgets;
    }
    if (typeof window !== "undefined" && window.ComfyWidgets) {
        return window.ComfyWidgets;
    }
    return null;
}

function activeGraph() {
    return (
        (app.canvas &&
            app.canvas.getCurrentGraph &&
            app.canvas.getCurrentGraph()) ||
        (app.canvas && app.canvas.graph) ||
        app.graph
    );
}

// ---------------------------------------------------------------------------
// 桥接逻辑（参照官方 PrimitiveNode）
// ---------------------------------------------------------------------------

/**
 * 首次连接：读取目标 widget 配置，动态创建匹配控件。
 */
function onFirstConnection(node) {
    if (!node || !node.graph || !node.outputs) return;

    var output = node.outputs[BRIDGE_OUTPUT_INDEX];
    if (!output || !output.links || !output.links.length) return;

    var linkId = output.links[0];
    var link = node.graph.links[linkId];
    if (!link) return;

    var targetNode = node.graph.getNodeById(link.target_id);
    if (!targetNode || !targetNode.inputs) return;

    var targetInput = targetNode.inputs[link.target_slot];
    if (!targetInput) return;

    // 读取目标配置
    var config = getWidgetConfig(targetInput);
    if (!config) {
        // 回退：从 input.type 和 target widget 推断配置
        var targetWidget = findWidget(targetNode, targetInput.name);
        if (!targetWidget) return;
        config = [targetInput.type || targetWidget.type || "STRING", {}];
        if (targetWidget.options) {
            config[1] = targetWidget.options;
        }
    }

    var type = config[0];
    var options = config[1] || {};

    // 数组类型 → COMBO
    if (Array.isArray(type)) {
        options = { values: type };
        type = "COMBO";
    }

    // 标准化类型名（兼容 ComfyUI 内部命名）
    var widgetType = normalizeWidgetType(type, options);

    // 更新桥接输出类型
    output.type = widgetType;
    output.name = widgetType;
    output.widget = targetInput.widget;

    // 同步目标当前值作为默认值
    var targetValue = readTargetWidgetValue(targetNode, targetInput.name);
    if (targetValue != null && targetValue !== undefined) {
        if (options.default === undefined) {
            options.default = targetValue;
        }
    }

    // 创建可见控件
    createBridgeWidget(node, widgetType, options);

    // 同步初始值
    syncBridgeToHidden(node);
    syncBridgeToTarget(node, targetNode, link.target_slot);
}

/**
 * 标准化 ComfyUI widget 类型名。
 */
function normalizeWidgetType(type, options) {
    var t = String(type || "STRING").toUpperCase();

    if (t === "COMBO" || (options && Array.isArray(options.values))) {
        return "COMBO";
    }
    if (t === "INT" || t === "INTEGER" || t === "NUMBER") {
        // 如果有 step 且非整数 → FLOAT
        if (options && options.step && String(options.step).indexOf(".") >= 0) {
            return "FLOAT";
        }
        return "INT";
    }
    if (t === "FLOAT") return "FLOAT";
    if (t === "BOOLEAN" || t === "BOOL") return "BOOLEAN";
    return "STRING";
}

/**
 * 在节点上动态创建桥接控件。
 */
function createBridgeWidget(node, widgetType, options) {
    // 清理旧控件
    removeBridgeWidget(node);

    var ComfyWidgets = getComfyWidgets();
    var widget = null;
    var defaultValue = options.default;

    if (widgetType === "COMBO") {
        if (
            ComfyWidgets &&
            typeof ComfyWidgets.COMBO === "function"
        ) {
            var result = ComfyWidgets.COMBO(
                node,
                CONTROL_WIDGET_NAME,
                [options.values || [], options],
                app
            );
            widget = (result && result.widget) || result;
        } else {
            widget = node.addWidget(
                "combo",
                CONTROL_WIDGET_NAME,
                defaultValue || (options.values ? options.values[0] : ""),
                function () {},
                { values: options.values || [] }
            );
        }
    } else if (
        ComfyWidgets &&
        typeof ComfyWidgets[widgetType] === "function"
    ) {
        var result2 = ComfyWidgets[widgetType](
            node,
            CONTROL_WIDGET_NAME,
            [widgetType, options],
            app
        );
        widget = (result2 && result2.widget) || result2;
    } else {
        widget = node.addWidget(
            widgetType.toLowerCase(),
            CONTROL_WIDGET_NAME,
            defaultValue != null ? defaultValue : "",
            function () {},
            options
        );
    }

    if (!widget) return;

    // 隐藏标签（节省空间）
    if (widget.options) {
        widget.options.label = "";
    }
    if (widget.label != null) {
        widget.label = "";
    }

    // 拦截 callback：变更时双向同步
    var origCallback = widget.callback;
    widget.callback = function (value, canvas, n, mouse, event) {
        if (origCallback) {
            origCallback.apply(widget, arguments);
        }
        syncBridgeToHidden(node);
        syncBridgeToTarget(node);
        markCanvasDirty();
    };

    // 调整节点尺寸
    resizeNodeToFit(node);
}

/**
 * 移除桥接控件。
 */
function removeBridgeWidget(node) {
    if (!node || !Array.isArray(node.widgets)) return;

    for (var i = node.widgets.length - 1; i >= 0; i--) {
        var w = node.widgets[i];
        if (w && w.name === CONTROL_WIDGET_NAME) {
            if (typeof w.onRemove === "function") {
                w.onRemove();
            }
            node.widgets.splice(i, 1);
        }
    }
}

/**
 * 最后一次断开：清理桥接状态。
 */
function onLastDisconnect(node) {
    var output = node.outputs[BRIDGE_OUTPUT_INDEX];
    if (!output) return;

    output.type = "*";
    output.name = BRIDGE_OUTPUT_NAME;
    delete output.widget;

    removeBridgeWidget(node);

    // 清空隐藏 widget
    var hidden = findWidget(node, HIDDEN_WIDGET_NAME);
    if (hidden) {
        hidden.value = "";
    }

    resizeNodeToFit(node);
    markCanvasDirty();
}

// ---------------------------------------------------------------------------
// 值同步
// ---------------------------------------------------------------------------

/**
 * 桥接控件 → hidden widget
 */
function syncBridgeToHidden(node) {
    var control = findWidget(node, CONTROL_WIDGET_NAME);
    var hidden = findWidget(node, HIDDEN_WIDGET_NAME);
    if (!control || !hidden) return;

    var value = control.value;
    hidden.value = value != null ? String(value) : "";
}

/**
 * 桥接控件 → 目标节点 widget
 */
function syncBridgeToTarget(node, specificTarget, specificSlot) {
    var control = findWidget(node, CONTROL_WIDGET_NAME);
    if (!control) return;

    var value = control.value;
    var output = node.outputs[BRIDGE_OUTPUT_INDEX];
    if (!output || !output.links || !node.graph) return;

    var links = output.links;
    for (var i = 0; i < links.length; i++) {
        var link = node.graph.links[links[i]];
        if (!link) continue;
        if (
            specificTarget &&
            link.target_id !== specificTarget.id
        ) {
            continue;
        }
        if (
            specificSlot != null &&
            link.target_slot !== specificSlot
        ) {
            continue;
        }

        var targetNode = node.graph.getNodeById(link.target_id);
        if (!targetNode) continue;

        var targetInput = targetNode.inputs[link.target_slot];
        if (!targetInput) continue;

        writeTargetWidgetValue(targetNode, targetInput.name, value);
    }
}

/**
 * 读取目标节点 widget 当前值。
 */
function readTargetWidgetValue(targetNode, widgetName) {
    var w = findWidget(targetNode, widgetName);
    return w ? w.value : undefined;
}

/**
 * 写入目标节点 widget 值。
 */
function writeTargetWidgetValue(targetNode, widgetName, value) {
    var w = findWidget(targetNode, widgetName);
    if (!w) return;

    var oldValue = w.value;
    if (oldValue === value) return;

    w.value = value;
    if (typeof w.callback === "function") {
        w.callback(value, app.canvas, targetNode, null, {});
    }
}

// ---------------------------------------------------------------------------
// UI 辅助
// ---------------------------------------------------------------------------

function resizeNodeToFit(node) {
    if (!node || typeof node.setSize !== "function") return;
    if (typeof node.computeSize === "function") {
        var sz = node.computeSize();
        node.setSize([Math.max(node.size[0], sz[0]), Math.max(node.size[1], sz[1])]);
    }
}

function markCanvasDirty() {
    if (app.canvas && typeof app.canvas.setDirty === "function") {
        app.canvas.setDirty(true, true);
    }
}

// ---------------------------------------------------------------------------
// 节点生命周期钩子
// ---------------------------------------------------------------------------

function ensureBridgeOutput(node) {
    if (!node || !Array.isArray(node.outputs)) return;

    // 检查桥接输出是否已存在
    if (
        node.outputs.length > BRIDGE_OUTPUT_INDEX &&
        node.outputs[BRIDGE_OUTPUT_INDEX]
    ) {
        return;
    }

    // 补建桥接输出（加载已有工作流时）
    if (typeof node.addOutput === "function") {
        node.addOutput(BRIDGE_OUTPUT_NAME, "*");
    }

    // 如果已有连接但无控件，恢复控件
    restoreBridgeWidget(node);
}

function restoreBridgeWidget(node) {
    var output = node.outputs[BRIDGE_OUTPUT_INDEX];
    if (!output || !output.links || !output.links.length) return;

    // 已有控件则跳过
    if (findWidget(node, CONTROL_WIDGET_NAME)) return;

    onFirstConnection(node);
}

function setupNode(node) {
    if (!node || node.__xprimitiveSetupDone) return;
    node.__xprimitiveSetupDone = true;

    ensureBridgeOutput(node);

    // 如果桥接输出已有连接但无控件，恢复
    setTimeout(function () {
        restoreBridgeWidget(node);
    }, 50);
}

// ---------------------------------------------------------------------------
// 扩展注册
// ---------------------------------------------------------------------------

app.registerExtension({
    name: "ComfyUI.Xz3r0.XPrimitiveCombo",

    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (String(nodeData.name) !== NODE_CLASS) return;

        // ── onNodeCreated：创建时添加桥接输出 ──
        var origOnNodeCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            if (origOnNodeCreated) {
                origOnNodeCreated.apply(this, arguments);
            }

            // 添加桥接输出端口
            if (
                this.outputs &&
                this.outputs.length <= BRIDGE_OUTPUT_INDEX
            ) {
                this.addOutput(BRIDGE_OUTPUT_NAME, "*");
            }

            // 保存原始 onConnectionsChange
            var self = this;
            var origOnConnectionsChange =
                self.onConnectionsChange;

            // 拦截连接变化
            self.onConnectionsChange = function (
                type,
                index,
                connected,
                link,
                ioSlot
            ) {
                // 先调用原始处理（MatchType 等）
                if (origOnConnectionsChange) {
                    origOnConnectionsChange.apply(self, arguments);
                }

                // 仅处理桥接输出端口 (index 1, LiteGraph.OUTPUT = 2)
                if (
                    type !== 2 /* LiteGraph.OUTPUT */ ||
                    index !== BRIDGE_OUTPUT_INDEX
                ) {
                    return;
                }

                // 配置阶段不处理
                if (app.configuringGraph) return;

                if (connected) {
                    if (
                        !findWidget(self, CONTROL_WIDGET_NAME)
                    ) {
                        onFirstConnection(self);
                    } else {
                        // 额外连接：同步值到新目标
                        syncBridgeToTarget(self);
                    }
                } else {
                    var out = self.outputs[BRIDGE_OUTPUT_INDEX];
                    if (!out || !out.links || !out.links.length) {
                        onLastDisconnect(self);
                    }
                }
            };

            setupNode(self);
        };

        // ── onConfigure：加载工作流后恢复桥接输出 ──
        var origOnConfigure = nodeType.prototype.onConfigure;
        nodeType.prototype.onConfigure = function () {
            if (origOnConfigure) {
                origOnConfigure.apply(this, arguments);
            }
            this.__xprimitiveSetupDone = false;
            ensureBridgeOutput(this);
        };

        // ── onGraphConfigured：图配置完成时恢复控件 ──
        var origOnGraphConfigured =
            nodeType.prototype.onGraphConfigured;
        nodeType.prototype.onGraphConfigured = function () {
            if (origOnGraphConfigured) {
                origOnGraphConfigured.apply(this, arguments);
            }
            restoreBridgeWidget(this);
        };
    },

    async nodeCreated(node) {
        if (
            String(node.comfyClass || node.type || "") !== NODE_CLASS
        ) {
            return;
        }
        setupNode(node);
    },

    async loadedGraphNode(node) {
        if (
            String(node.comfyClass || node.type || "") !== NODE_CLASS
        ) {
            return;
        }
        node.__xprimitiveSetupDone = false;
        setupNode(node);
    },
});
