/**
 * XController 前端节点扩展
 * =====================
 *
 * 全部配置 UI 渲染为自定义 DOM 组件，原生 ComfyUI widget 完全隐藏。
 * 基于 XSeed 扩展的成功模式重写。
 *
 * 依赖：web/core/xcontroller_core.js（加载为全局 XControllerCore）
 */

import { api } from "../../scripts/api.js";
import { app } from "../../scripts/app.js";

var EXT_NAME = "ComfyUI.Xz3r0.XController";
var NODE_CLASS = "XController";
var DOM_WIDGET_NAME = "xcontrol_ui";
var LOCALE_PREFIX = "xdatahub.ui.node.xcontrol";
var uiLocalePrimary = null;
var uiLocaleFallback = null;
var i18nCache = {};

// ================================================================
// Widget 名称常量
// ================================================================

var W_CONTROL_TYPE = "control_type";
var W_VALUE_MODE = "value_mode";

var W_MIN = "min";
var W_MAX = "max";
var W_STEP = "step";
var W_DEFAULT_VALUE = "default_value";

var W_STEPS = "steps";
var W_DEFAULT_STEP_INDEX = "default_step_index";

var W_BASE_VALUE = "base_value";
var W_PCT_MIN = "pct_min";
var W_PCT_MAX = "pct_max";
var W_DEFAULT_PCT = "default_pct";

var W_SHAPE = "shape";
var W_TOGGLE_STYLE = "toggle_style";
var W_DEFAULT_STATE = "default_state";
var W_BUTTON_MODE = "button_mode";
var W_BUTTON_STYLE = "button_style";

var W_X_MIN = "x_min";
var W_X_MAX = "x_max";
var W_X_STEP = "x_step";
var W_X_DEFAULT = "x_default";
var W_Y_MIN = "y_min";
var W_Y_MAX = "y_max";
var W_Y_STEP = "y_step";
var W_Y_DEFAULT = "y_default";
var W_CROSSHAIR = "crosshair_visible";
var W_GRID = "grid_visible";

var W_NORMALIZED = "_normalized";
var W_STATE = "_state";
var W_X_NORMALIZED = "_x_normalized";
var W_Y_NORMALIZED = "_y_normalized";

/** 需要隐藏的原生 widget 列表 */
var ALL_WIDGET_NAMES = [
    W_CONTROL_TYPE, W_VALUE_MODE,
    W_MIN, W_MAX, W_STEP, W_DEFAULT_VALUE,
    W_STEPS, W_DEFAULT_STEP_INDEX,
    W_BASE_VALUE, W_PCT_MIN, W_PCT_MAX, W_DEFAULT_PCT,
    W_SHAPE, W_TOGGLE_STYLE, W_DEFAULT_STATE,
    W_BUTTON_MODE, W_BUTTON_STYLE,
    W_X_MIN, W_X_MAX, W_X_STEP, W_X_DEFAULT,
    W_Y_MIN, W_Y_MAX, W_Y_STEP, W_Y_DEFAULT,
    W_CROSSHAIR, W_GRID,
    W_NORMALIZED, W_STATE, W_X_NORMALIZED, W_Y_NORMALIZED,
];

// ================================================================
// i18n
// ================================================================

var _LOCALE = "en";

function detectLocale() {
    try {
        var data = app.ui?.settings?.settingValues;
        if (data) {
            for (var i = 0; i < data.length; i++) {
                if (data[i].id === "Comfy.Locale") return data[i].value || "en";
            }
        }
    } catch (e) {}
    return (
        (typeof document !== "undefined" && document.documentElement?.lang) ||
        "en"
    );
}

function isZh() {
    return _LOCALE.indexOf("zh") === 0;
}

var _ZH = {
    "Type:": "类型:",
    "Mode:": "模式:",
    "Range:": "范围:",
    "Min": "最小",
    "Max": "最大",
    "Step": "步长",
    "Def": "默认",
    "Steps:": "档位:",
    "Idx": "索引",
    "Pct:": "百分比:",
    "Base": "基础",
    "Min%": "最小%",
    "Max%": "最大%",
    "Def%": "默认%",
    "Shape:": "形状:",
    "Toggle:": "开关:",
    "Button:": "按钮:",
    "X:": "X:",
    "Y:": "Y:",
    "Crosshair": "十字线",
    "Grid": "网格",
    "Def State": "默认开",
};

var _TOOLTIPS = {
    "Control type": {
        en: "Select the visible controller: analog knob/fader, boolean toggle, hold button, or XY pad.",
        zh: "选择显示的控制器：模拟旋钮/推子、布尔开关、按住按钮或 XY 坐标面板。",
    },
    "Control value": {
        en: "Current output value. Type a value and press Enter or blur the field to update the control.",
        zh: "当前输出值。输入数值后按 Enter 或移出焦点即可更新控件。",
    },
    "Value mode": {
        en: "Choose how the normalized 0-1 control position is converted to the FLOAT output.",
        zh: "选择如何把 0-1 的控件位置转换为 FLOAT 输出值。",
    },
    "Mode Range": {
        en: "Range maps the control continuously from Min to Max and can snap to Step.",
        zh: "范围模式会把控件连续映射到最小值和最大值之间，并可按步长吸附。",
    },
    "Mode Steps": {
        en: "Steps snaps the control to one value from the JSON array.",
        zh: "档位模式会把控件吸附到 JSON 数组中的某个离散值。",
    },
    "Mode Percentage": {
        en: "Percentage outputs Base multiplied by a percentage offset between Min% and Max%.",
        zh: "百分比模式输出基础值乘以最小%到最大%之间的百分比偏移。",
    },
    "Range min": {
        en: "Lowest FLOAT output in Range mode.",
        zh: "范围模式下 FLOAT 输出的最小值。",
    },
    "Range max": {
        en: "Highest FLOAT output in Range mode.",
        zh: "范围模式下 FLOAT 输出的最大值。",
    },
    "Range step": {
        en: "Snap size for Range mode and hold-button increments. Use 0 to disable snapping.",
        zh: "范围模式吸附步长，也用于按住按钮的增减幅度。填 0 表示不吸附。",
    },
    "Range default": {
        en: "Default Range value used as the intended reset/start value.",
        zh: "范围模式的默认值，用作预期的重置/初始值。",
    },
    "Steps values": {
        en: "JSON array of discrete FLOAT outputs, for example [0, 0.25, 0.5, 1].",
        zh: "离散 FLOAT 输出值的 JSON 数组，例如 [0, 0.25, 0.5, 1]。",
    },
    "Steps index": {
        en: "Default step index, starting at 0. The button moves one index per repeat.",
        zh: "默认档位索引，从 0 开始。按钮每次重复会移动一个档位。",
    },
    "Percentage base": {
        en: "Base value used before applying the percentage offset.",
        zh: "应用百分比偏移前使用的基础值。",
    },
    "Percentage min": {
        en: "Minimum percentage offset. Negative values reduce the base value.",
        zh: "最小百分比偏移。负数会降低基础值。",
    },
    "Percentage max": {
        en: "Maximum percentage offset. Positive values increase the base value.",
        zh: "最大百分比偏移。正数会提高基础值。",
    },
    "Percentage default": {
        en: "Default percentage offset used as the intended reset/start value.",
        zh: "默认百分比偏移，用作预期的重置/初始值。",
    },
    "Shape": {
        en: "Visual shape for knobs, or handle shape for horizontal/vertical faders.",
        zh: "旋钮的视觉形状，或横向/纵向推子的手柄形状。",
    },
    "Toggle style": {
        en: "Visual style of the boolean toggle. It changes BOOLEAN and outputs 0 or 1 on FLOAT.",
        zh: "布尔开关的视觉样式。它会改变 BOOLEAN，并在 FLOAT 输出 0 或 1。",
    },
    "Default state": {
        en: "Default boolean state for Toggle when the node is created or restored without a saved state.",
        zh: "新建节点或没有保存状态时 Toggle 使用的默认布尔状态。",
    },
    "Button mode": {
        en: "Increase/Decrease change while held. Toggle switches between low and high values on click.",
        zh: "增加/降低会在按住时改变数值；切换模式点击时在低值和高值之间切换。",
    },
    "Button style": {
        en: "Visual shape of the hold button. The button also reports pressed state on BOOLEAN.",
        zh: "按住按钮的视觉形状。按钮也会在 BOOLEAN 输出按下状态。",
    },
    "X min": {
        en: "Lowest X output value for the XY pad.",
        zh: "XY 面板的 X 输出最小值。",
    },
    "X max": {
        en: "Highest X output value for the XY pad.",
        zh: "XY 面板的 X 输出最大值。",
    },
    "X step": {
        en: "Snap size for X output. Use 0 to disable X snapping.",
        zh: "X 输出吸附步长。填 0 表示不吸附 X。",
    },
    "X default": {
        en: "Default X value applied when switching to XY Pad or editing this field.",
        zh: "切换到 XY 面板或编辑此项时应用的默认 X 值。",
    },
    "Y min": {
        en: "Lowest Y output value for the XY pad.",
        zh: "XY 面板的 Y 输出最小值。",
    },
    "Y max": {
        en: "Highest Y output value for the XY pad.",
        zh: "XY 面板的 Y 输出最大值。",
    },
    "Y step": {
        en: "Snap size for Y output. Use 0 to disable Y snapping.",
        zh: "Y 输出吸附步长。填 0 表示不吸附 Y。",
    },
    "Y default": {
        en: "Default Y value applied when switching to XY Pad or editing this field.",
        zh: "切换到 XY 面板或编辑此项时应用的默认 Y 值。",
    },
    "Crosshair": {
        en: "Show guide lines through the current XY point.",
        zh: "显示穿过当前 XY 点的辅助准线。",
    },
    "Grid": {
        en: "Show a subtle grid behind the XY pad for easier positioning.",
        zh: "在 XY 面板背景显示淡网格，便于定位。",
    },
};

var _TOOLTIP_KEYS = {
    "Control type": "tip.control_type",
    "Control value": "tip.control_value",
    "Value mode": "tip.value_mode",
    "Mode Range": "tip.mode_range",
    "Mode Steps": "tip.mode_steps",
    "Mode Percentage": "tip.mode_percentage",
    "Range min": "tip.range_min",
    "Range max": "tip.range_max",
    "Range step": "tip.range_step",
    "Range default": "tip.range_default",
    "Steps values": "tip.steps_values",
    "Steps index": "tip.steps_index",
    "Percentage base": "tip.percentage_base",
    "Percentage min": "tip.percentage_min",
    "Percentage max": "tip.percentage_max",
    "Percentage default": "tip.percentage_default",
    "Shape": "tip.shape",
    "Toggle style": "tip.toggle_style",
    "Default state": "tip.default_state",
    "Button mode": "tip.button_mode",
    "Button style": "tip.button_style",
    "X min": "tip.x_min",
    "X max": "tip.x_max",
    "X step": "tip.x_step",
    "X default": "tip.x_default",
    "Y min": "tip.y_min",
    "Y max": "tip.y_max",
    "Y step": "tip.y_step",
    "Y default": "tip.y_default",
    "Crosshair": "tip.crosshair",
    "Grid": "tip.grid",
};

var _LABEL_KEYS = {
    "Type:": "label.type",
    "Mode:": "label.mode",
    "Range:": "label.range",
    "Def:": "label.default",
    "Steps:": "label.steps",
    "Idx": "label.index",
    "Pct:": "label.percentage",
    "Min%": "label.min_pct",
    "Max%": "label.max_pct",
    "Def%": "label.default_pct",
    "Shape:": "label.shape",
    "Toggle:": "label.toggle",
    "Button:": "label.button",
    "X:": "label.x",
    "Y:": "label.y",
    "Crosshair": "label.crosshair",
    "Grid": "label.grid",
    "Def State": "label.default_state",
    "Settings": "label.settings",
    "Control": "label.control",
    "Collapse/Expand settings": "label.toggle_settings",
    "XControllerCore not loaded. Check web/core/xcontroller_core.js": "status.core_missing",
    "ON": "status.on",
    "OFF": "status.off",
};

var _OPTION_KEYS = {
    Knob: "option.control_type.knob",
    FaderH: "option.control_type.fader_h",
    FaderV: "option.control_type.fader_v",
    Toggle: "option.control_type.toggle",
    Button: "option.control_type.button",
    XYPad: "option.control_type.xy_pad",
    Range: "option.value_mode.range",
    Steps: "option.value_mode.steps",
    Percentage: "option.value_mode.percentage",
    circle: "option.shape.circle",
    rounded_rect: "option.shape.rounded_rect",
    hexagon: "option.shape.hexagon",
    square: "option.shape.square",
    diamond: "option.shape.diamond",
    switch: "option.toggle_style.switch",
    paddle: "option.toggle_style.paddle",
    dot: "option.toggle_style.dot",
    rounded: "option.button_style.rounded",
    pill: "option.button_style.pill",
    increase: "option.button_mode.increase",
    decrease: "option.button_mode.decrease",
    toggle: "option.button_mode.toggle",
    true: "option.boolean.true",
    false: "option.boolean.false",
};

function t(en) {
    var suffix = _LABEL_KEYS[en];
    var fallback = isZh() && _ZH[en] ? _ZH[en] : en;
    if (suffix) return translateLocaleKey(LOCALE_PREFIX + "." + suffix, fallback);
    return fallback;
}

function optionLabel(value) {
    var key = _OPTION_KEYS[String(value)];
    if (!key) return String(value);
    return translateLocaleKey(LOCALE_PREFIX + "." + key, String(value));
}

function stateLabel(state) {
    return t(state ? "ON" : "OFF");
}

function translateLocaleKey(key, fallback) {
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

function resolveComfyLocale() {
    try {
        var value = app.extensionManager
            && app.extensionManager.setting
            && app.extensionManager.setting.get
            && app.extensionManager.setting.get("Comfy.Locale");
        if (value) return value;
    } catch (_error) {}
    try {
        var stored = localStorage.getItem("Comfy.Locale");
        if (stored) return stored;
    } catch (_error) {}
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

function applyUiLocale(localeOverride) {
    var locale = localeOverride || resolveComfyLocale();
    var normalized = (
        locale === "zh" || locale === "zh-CN" || locale === "zh-TW"
    ) ? "zh" : "en";
    _LOCALE = normalized;
    return Promise.all([fetchI18n("en"), fetchI18n(normalized)])
        .then(function (results) {
            uiLocaleFallback = results[0];
            uiLocalePrimary = normalized === "en" ? results[0] : results[1];
            refreshAllControlLocales();
        });
}

function refreshAllControlLocales() {
    var graph = (app.canvas && app.canvas.getCurrentGraph
        && app.canvas.getCurrentGraph())
        || (app.canvas && app.canvas.graph)
        || app.graph;
    var nodes = (graph && (graph._nodes || graph.nodes)) || [];
    for (var i = 0; i < nodes.length; i++) {
        var node = nodes[i];
        if (String(node && (node.comfyClass || node.type || "")) !== NODE_CLASS) {
            continue;
        }
        applyTooltip(node.__xcontrolTypeSelect, tt("Control type"));
        applyTooltip(node.__xcontrolValueInput, tt("Control value"));
        if (node.__xcontrolTypeLabel) node.__xcontrolTypeLabel.textContent = t("Type:");
        if (node.__xcontrolConfigLegendText) {
            node.__xcontrolConfigLegendText.textContent = t("Settings");
        }
        if (node.__xcontrolControlLegend) {
            node.__xcontrolControlLegend.textContent = t("Control");
        }
        if (node.__xcontrolToggleBtn) {
            node.__xcontrolToggleBtn.title = t("Collapse/Expand settings");
        }
        if (node.__xcontrolTypeSelect) {
            Array.from(node.__xcontrolTypeSelect.options).forEach(function (option) {
                option.textContent = optionLabel(option.value);
            });
        }
        if (node.__xcontrolConfigPanel) {
            rebuildXControlConfigPanel(node);
        }
    }
}

function rebuildXControlConfigPanel(node) {
    if (!node.__xcontrolConfigPanel) return;
    node.__xcontrolConfigPanel.innerHTML = "";
    var ctype = getWidgetValue(node, W_CONTROL_TYPE, "Knob");
    var info = CONTROL_TYPES[ctype];
    if (info && info.isAnalog) buildAnalogConfig(node.__xcontrolConfigPanel, node);
    else if (ctype === "Toggle") buildToggleConfig(node.__xcontrolConfigPanel, node);
    else if (ctype === "Button") {
        buildAnalogConfig(node.__xcontrolConfigPanel, node, false);
        buildButtonConfig(node.__xcontrolConfigPanel, node);
    } else if (info && info.isXY) buildXYPadConfig(node.__xcontrolConfigPanel, node);
}

function syncControlTypeUI(node) {
    var rawType = getWidgetValue(node, W_CONTROL_TYPE, "Knob");
    var fixedType = normalizeControlType(rawType);
    if (String(rawType) !== fixedType) {
        setWidgetValue(node, W_CONTROL_TYPE, fixedType);
    }
    if (node.__xcontrolTypeSelect) {
        node.__xcontrolTypeSelect.value = fixedType;
    }
    rebuildXControlConfigPanel(node);
    rebuildControlForNode(node);
}

function tt(key) {
    var suffix = _TOOLTIP_KEYS[key];
    var item = _TOOLTIPS[key];
    var fallback = item ? (isZh() ? item.zh : item.en) : "";
    if (suffix) return translateLocaleKey(LOCALE_PREFIX + "." + suffix, fallback);
    if (!item) return "";
    return fallback;
}

// ================================================================
// 辅助函数
// ================================================================

function findWidget(node, name) {
    if (!node.widgets) return null;
    for (var i = 0; i < node.widgets.length; i++) {
        if (node.widgets[i].name === name) return node.widgets[i];
    }
    return null;
}

function getWidgetValue(node, name, def) {
    var w = findWidget(node, name);
    if (!w) return def;
    var v = w.value;
    if (v === undefined || v === null) return def;
    if (typeof v === "string") {
        var num = parseFloat(v);
        if (!isNaN(num)) return num;
        return v;
    }
    return v;
}

function setWidgetValue(node, name, value) {
    var w = findWidget(node, name);
    if (!w) return;
    w.value = value;
    w.callback?.(value);
    syncWidgetValues(node);
    node.setDirtyCanvas && node.setDirtyCanvas(true, true);
    app.graph?.setDirtyCanvas?.(true, true);
}

function syncWidgetValues(node) {
    if (!Array.isArray(node.widgets)) return;
    node.widgets_values = node.widgets.map(function (widget) {
        var value = typeof widget.serializeValue === "function"
            ? widget.serializeValue()
            : widget.value;
        return value === undefined ? "" : value;
    });
}

function ensureWidgetPersistence(node) {
    ALL_WIDGET_NAMES.forEach(function (name) {
        var widget = findWidget(node, name);
        if (!widget) return;
        widget.serializeValue = function () {
            return this.value;
        };
    });
    syncWidgetValues(node);
}

/**
 * 隐藏原生 ComfyUI widget——与 XSeed 的 hideNativeWidget 一致。
 */
function hideNativeWidget(node, name) {
    var w = findWidget(node, name);
    if (!w) return;
    w.hidden = true;
    w.options = w.options || {};
    w.options.hidden = true;
    w.type = "hidden";
    w.computeSize = function () {
        return [0, -4];
    };
    if (w.element) w.element.style.display = "none";
    if (w.inputEl) w.inputEl.style.display = "none";
    if (node.inputs) {
        for (var i = node.inputs.length - 1; i >= 0; i--) {
            if (node.inputs[i] && node.inputs[i].name === name) {
                if (typeof node.removeInput === "function") {
                    node.removeInput(i);
                } else {
                    node.inputs.splice(i, 1);
                }
            }
        }
    }
}

/**
 * 将旧版小写 control_type 值修正为大写开头（与后端 ControlType 枚举一致）。
 * 防止已保存 workflow 中的历史值导致校验失败。
 */
function normalizeControlType(val) {
    var map = {
        knob: "Knob", faderh: "FaderH", faderv: "FaderV",
        toggle: "Toggle", button: "Button", xypad: "XYPad",
    };
    var key = String(val || "").toLowerCase();
    return map[key] || "Knob";
}

function normalizeButtonMode(val) {
    var key = String(val || "").toLowerCase();
    if (key === "toggle") return "toggle";
    if (key === "decrease") return "decrease";
    return "increase";
}

function normalizeToggleStyle(val) {
    return String(val || "").toLowerCase() === "dot" ? "dot" : "switch";
}

function normalizeKnobShape(val) {
    var value = String(val || "").toLowerCase();
    return value === "rounded_rect" ? "rounded_rect" : "circle";
}

function normalizeHandleShape(val) {
    var value = String(val || "").toLowerCase();
    return HANDLE_SHAPES.includes(value) ? value : "circle";
}

/**
 * 根据当前控件类型动态计算并设置节点尺寸。
 * 不同控件需要不同的高度空间。
 */
function controlVisualHeight(node) {
    var ctrlH = 60;
    var ctype = getWidgetValue(node, W_CONTROL_TYPE, "Knob");
    var info = CONTROL_TYPES[ctype];
    if (info) {
        if (ctype === "Knob") ctrlH = 20;
        else if (ctype === "FaderH") ctrlH = -8;
        else if (ctype === "FaderV") ctrlH = 100;
        else if (ctype === "Toggle") ctrlH = -14;
        else if (ctype === "Button") ctrlH = -10;
        else if (info.isXY) ctrlH = 102;
    }
    return ctrlH;
}

function configRowCount(node) {
    if (node.__xcontrolCollapsed) {
        return 0;
    }
    var ctype = getWidgetValue(node, W_CONTROL_TYPE, "Knob");
    var mode = getWidgetValue(node, W_VALUE_MODE, "Range");
    var info = CONTROL_TYPES[ctype];
    if (info && info.isAnalog) {
        return mode === "Steps" ? 3 : 5;
    }
    if (ctype === "Button") {
        return mode === "Steps" ? 4 : 6;
    }
    if (ctype === "Toggle") return 1;
    if (info && info.isXY) return 4;
    return 1;
}

function computeXControlMinSize(node) {
    var ctype = getWidgetValue(node, W_CONTROL_TYPE, "Knob");
    var minW = MIN_NODE_W;
    var typeRowH = 26;
    var rootPadH = 12;
    var sectionGapH = 12;
    var fieldsetBaseH = 34;
    var rowH = 26;
    var configRows = configRowCount(node);
    var configSecH = node.__xcontrolCollapsed
        ? fieldsetBaseH
        : fieldsetBaseH + configRows * rowH;
    var controlSecH = 64 + controlVisualHeight(node);
    var bodyH = rootPadH + typeRowH + sectionGapH + configSecH + controlSecH;
    var collapsedExtraH = node.__xcontrolCollapsed ? 20 : 0;
    return [minW, bodyH + NODE_CHROME_H + collapsedExtraH];
}

function adjustNodeSize(node, fitContent) {
    var minSize = computeXControlMinSize(node);
    var minW = minSize[0];
    var minH = minSize[1];

    // 存储最小尺寸供 onResize 使用
    node.__xctrlMinW = minW;
    node.__xctrlMinH = minH;

    node.min_size = [minW, minH];
    if (typeof node.setSize === "function") {
        var keepUserSize = node.__xctrlUserResized && !fitContent;
        var w = keepUserSize
            ? Math.max((node.size && node.size[0]) || 0, minW)
            : minW;
        var h = keepUserSize
            ? Math.max((node.size && node.size[1]) || 0, minH)
            : minH;
        node.__xctrlApplyingResize = true;
        node.setSize([w, h]);
        node.__xctrlApplyingResize = false;
    } else {
        node.size = [minW, minH];
    }

    // onResize 防重入——手动拉伸时强制回弹到最小尺寸
    if (node.__xctrl_resize_guard) return;
    node.__xctrl_resize_guard = true;
    var origOnResize = node.onResize;
    node.onResize = function (size) {
        if (this.__xctrlApplyingResize) return;
        this.__xctrlUserResized = true;
        var src = Array.isArray(size) ? size : this.size;
        var mw = this.__xctrlMinW || minW;
        var mh = this.__xctrlMinH || minH;
        var nW = Math.max((src && src[0]) || 0, mw);
        var nH = Math.max((src && src[1]) || 0, mh);
        this.__xctrlApplyingResize = true;
        if (typeof this.setSize === "function") {
            this.setSize([nW, nH]);
        } else {
            this.size = [nW, nH];
        }
        this.__xctrlApplyingResize = false;
        this.setDirtyCanvas && this.setDirtyCanvas(true, true);
        if (typeof origOnResize === "function") {
            origOnResize.apply(this, arguments);
        }
    };
}

function clampNodeSize(node, minW, minH) {
    adjustNodeSize(node);
}

// ================================================================
// 输出端口可见性控制
// ================================================================

function outputIndexByName(node, name) {
    if (!node || !Array.isArray(node.outputs)) return -1;
    for (var i = 0; i < node.outputs.length; i++) {
        if (node.outputs[i] && node.outputs[i].name === name) return i;
    }
    return -1;
}

function outputLinkCountByIndex(node, index) {
    if (!node || index < 0 || index >= (node.outputs || []).length) return 0;
    var output = node.outputs[index];
    return (output && output.links && output.links.length) || 0;
}

function outputTypeForName(name) {
    if (name === "INT") return "INT";
    if (name === "BOOLEAN") return "BOOLEAN";
    return "FLOAT";
}

/**
 * 根据当前 control_type 同步输出端口可见性。
 * - 不在当前类型显示列表且无连线的端口：删除
 * - 在当前类型显示列表但缺失的端口：添加
 * - 已有连线的端口即使不在显示列表中也会保留
 */
function syncOutputVisibility(node) {
    if (!node || !Array.isArray(node.outputs)) return;

    var ctype = getWidgetValue(node, W_CONTROL_TYPE, "Knob");
    var info = VISIBLE_OUTPUTS[ctype];
    if (!info) return;
    var wantedNames = info.names;

    // Phase 1: 删除不需要的输出（仅无连线，从后往前避免索引漂移）
    for (var i = node.outputs.length - 1; i >= 0; i--) {
        var output = node.outputs[i];
        if (!output) continue;
        if (wantedNames.indexOf(output.name) >= 0) continue;

        if (outputLinkCountByIndex(node, i) > 0) continue;

        if (typeof node.removeOutput === "function") {
            node.removeOutput(i);
        } else {
            node.outputs.splice(i, 1);
        }
    }

    // Phase 2: 添加缺失的所需输出
    var existingNames = {};
    for (var j = 0; j < node.outputs.length; j++) {
        if (node.outputs[j]) existingNames[node.outputs[j].name] = true;
    }
    for (var k = 0; k < wantedNames.length; k++) {
        var name = wantedNames[k];
        if (existingNames[name]) continue;
        if (typeof node.addOutput === "function") {
            node.addOutput(name, outputTypeForName(name));
        }
    }

    // Phase 3: 刷新布局
    try {
        if (typeof node._setConcreteSlots === "function") {
            node._setConcreteSlots();
        }
        if (typeof node.arrange === "function") {
            node.arrange();
        }
    } catch (_e) {}

    node.setDirtyCanvas && node.setDirtyCanvas(true, true);
    if (app.canvas && typeof app.canvas.setDirty === "function") {
        app.canvas.setDirty(true, true);
    }
}

// ================================================================
// 控件类型映射
// ================================================================

var CONTROL_TYPES = {
    Knob: { label: "Knob", coreType: "knob", isAnalog: true },
    FaderH: { label: "FaderH", coreType: "faderH", isAnalog: true },
    FaderV: { label: "FaderV", coreType: "faderV", isAnalog: true },
    Toggle: { label: "Toggle", coreType: "toggle", isAnalog: false },
    Button: { label: "Button", coreType: "button", isAnalog: false },
    XYPad: { label: "XYPad", coreType: "xyPad", isAnalog: false, isXY: true },
};

var VALUE_MODES = ["Range", "Steps", "Percentage"];

var KNOB_SHAPES = ["circle", "rounded_rect"];
var HANDLE_SHAPES = ["circle", "square", "diamond"];
var TOGGLE_STYLES = ["switch", "dot"];
var BUTTON_STYLES = ["rounded", "square", "pill"];
var BUTTON_MODES = ["increase", "decrease", "toggle"];
var BUTTON_REPEAT_MS = 80;
var MIN_NODE_W = 320;
var NODE_CHROME_H = 90;

// ── 输出端口可见性映射 ──
var ALL_OUTPUT_NAMES = ["FLOAT", "INT", "BOOLEAN", "X", "Y"];
var VISIBLE_OUTPUTS = {
    Knob:   { names: ["FLOAT", "INT"] },
    FaderH: { names: ["FLOAT", "INT"] },
    FaderV: { names: ["FLOAT", "INT"] },
    Toggle: { names: ["BOOLEAN"] },
    Button: { names: ["FLOAT", "INT"] },
    XYPad:  { names: ["X", "Y"] },
};

// ================================================================
// 构建 UI
// ================================================================

function buildXControlUI(node) {
    if (node.__xcontrolUI) return;

    _LOCALE = detectLocale();

    // 隐藏所有原生 widget
    ALL_WIDGET_NAMES.forEach(function (name) {
        hideNativeWidget(node, name);
    });
    ensureWidgetPersistence(node);

    // ── 根容器 ──
    var root = document.createElement("div");
    root.className = "xcontrol-root";
    root.style.cssText =
        "display:flex;flex-direction:column;gap:6px;padding:6px;" +
        "width:100%;font-family:sans-serif;" +
        "box-sizing:border-box;";

    // ════════════════════════════════════════
    // 1. 类型选择（顶端独立，始终可见）
    // ════════════════════════════════════════
    var typeRow = document.createElement("div");
    typeRow.style.cssText =
        "display:flex;align-items:center;gap:4px;flex-wrap:wrap;";
    var typeLabel = document.createElement("span");
    typeLabel.textContent = t("Type:");
    typeLabel.style.cssText = "font-size:11px;white-space:nowrap;";
    var typeSelect = document.createElement("select");
    typeSelect.style.cssText =
        "flex:1;min-width:80px;background:var(--comfy-menu-secondary-bg,#2a2a2a);" +
        "color:var(--input-text,#ddd);border:1px solid var(--border-color,#555);" +
        "border-radius:4px;padding:2px 4px;font-size:11px;";
    applyTooltip(typeLabel, tt("Control type"));
    applyTooltip(typeSelect, tt("Control type"));
    Object.keys(CONTROL_TYPES).forEach(function (key) {
        var opt = document.createElement("option");
        opt.value = key;
        opt.textContent = optionLabel(key);
        opt.title = tt("Control type");
        typeSelect.appendChild(opt);
    });
    var rawVal = getWidgetValue(node, W_CONTROL_TYPE, "Knob");
    var fixedVal = normalizeControlType(rawVal);
    typeSelect.value = fixedVal;
    // 修正 widget 中的旧版小写值，防止提交时校验失败
    if (String(rawVal) !== fixedVal) {
        setWidgetValue(node, W_CONTROL_TYPE, fixedVal);
    }
    typeRow.appendChild(typeLabel);
    typeRow.appendChild(typeSelect);
    root.appendChild(typeRow);

    // ════════════════════════════════════════
    // 2. 设置区（带折叠按钮，可折叠）
    // ════════════════════════════════════════
    var configSection = document.createElement("fieldset");
    configSection.style.cssText =
        "border:1px solid var(--border-color,#555);" +
        "border-radius:4px;padding:5px 6px 6px;margin:0;" +
        "display:flex;flex-direction:column;gap:4px;";

    var configLegend = document.createElement("legend");
    configLegend.style.cssText =
        "font-size:11px;font-weight:bold;" +
        "color:var(--descrip-text,#999);" +
        "padding:0 4px;display:flex;align-items:center;gap:4px;";

    var configLegendText = document.createElement("span");
    configLegendText.textContent = t("Settings");
    configLegend.appendChild(configLegendText);

    // 折叠按钮（放在设置区 legend 内）
    var toggleBtn = document.createElement("button");
    toggleBtn.textContent = "▼";
    toggleBtn.title = t("Collapse/Expand settings");
    toggleBtn.style.cssText =
        "background:var(--comfy-menu-secondary-bg,#2a2a2a);" +
        "color:var(--input-text,#ddd);border:1px solid var(--border-color,#555);" +
        "border-radius:3px;padding:0 5px;font-size:9px;cursor:pointer;" +
        "line-height:14px;margin-left:4px;";
    configLegend.appendChild(toggleBtn);
    configSection.appendChild(configLegend);

    // ── 配置面板（动态，折叠时隐藏） ──
    var configPanel = document.createElement("div");
    configPanel.style.cssText =
        "display:flex;flex-direction:column;gap:4px;";
    configSection.appendChild(configPanel);

    root.appendChild(configSection);

    // ════════════════════════════════════════
    // 3. 控制区（始终可见，不可折叠）
    // ════════════════════════════════════════
    var controlSection = document.createElement("fieldset");
    controlSection.style.cssText =
        "border:1px solid var(--border-color,#555);" +
        "border-radius:4px;padding:5px 6px 6px;margin:0;" +
        "display:flex;flex-direction:column;gap:4px;";

    var controlLegend = document.createElement("legend");
    controlLegend.style.cssText =
        "font-size:11px;font-weight:bold;" +
        "color:var(--descrip-text,#999);" +
        "padding:0 4px;";
    controlLegend.textContent = t("Control");
    controlSection.appendChild(controlLegend);

    // ── 控件容器 ──
    var controlHost = document.createElement("div");
    controlHost.style.cssText =
        "display:flex;align-items:center;justify-content:center;" +
        "width:100%;min-height:60px;padding:4px 0;" +
        "box-sizing:border-box;";
    controlSection.appendChild(controlHost);

    // ── 数值输入（手动输入快速跳转） ──
    var valueInput = document.createElement("input");
    valueInput.type = "text";
    valueInput.placeholder = "0.00";
    valueInput.style.cssText =
        "width:100%;background:var(--comfy-menu-secondary-bg,#2a2a2a);" +
        "color:var(--input-text,#ddd);border:1px solid var(--border-color,#555);" +
        "border-radius:4px;padding:2px 6px;font-size:12px;text-align:center;" +
        "box-sizing:border-box;font-family:monospace;";
    applyTooltip(valueInput, tt("Control value"));
    valueInput.addEventListener("keydown", function (e) {
        if (e.key === "Enter") {
            e.preventDefault();
            applyValueInput();
        }
    });
    valueInput.addEventListener("blur", function () {
        applyValueInput();
    });
    controlSection.appendChild(valueInput);

    root.appendChild(controlSection);

    // 存储引用
    node.__xcontrolUI = root;
    node.__xcontrolTypeLabel = typeLabel;
    node.__xcontrolTypeSelect = typeSelect;
    node.__xcontrolConfigLegendText = configLegendText;
    node.__xcontrolConfigPanel = configPanel;
    node.__xcontrolConfigSection = configSection;
    node.__xcontrolControlLegend = controlLegend;
    node.__xcontrolControlHost = controlHost;
    node.__xcontrolValueInput = valueInput;
    node.__xcontrolControlSection = controlSection;
    node.__xcontrolToggleBtn = toggleBtn;
    node.__xcontrolCollapsed = false;

    // ── 折叠/展开（设置区） ──
    function setCollapsed(collapsed) {
        node.__xcontrolCollapsed = collapsed;
        if (collapsed) {
            configPanel.style.display = "none";
            toggleBtn.textContent = "▶";
        } else {
            configPanel.style.display = "flex";
            toggleBtn.textContent = "▼";
        }
        adjustNodeSize(node, true);
    }

    toggleBtn.addEventListener("click", function () {
        setCollapsed(!node.__xcontrolCollapsed);
    });

    // ── 同步函数 ──
    function getCurrentType() {
        return typeSelect.value;
    }

    function rebuildConfigPanel() {
        rebuildXControlConfigPanel(node);
    }

    function rebuildControl() {
        stopButtonHold(node);
        controlHost.innerHTML = "";
        var ctype = getCurrentType();
        var info = CONTROL_TYPES[ctype];
        if (!info) return;

        var core = getXControllerCore();
        if (!core) return;

        var ctrlConfig = {
            type: info.coreType,
            app: app,
        };

        if (info.isAnalog) {
            ctrlConfig.shape = getWidgetValue(node, W_SHAPE, "circle");
            ctrlConfig.onValueChange = function (norm) {
                setAnalogNormForNode(node, norm);
            };
        } else if (ctype === "Toggle") {
            ctrlConfig.style = getWidgetValue(node, W_TOGGLE_STYLE, "switch");
            ctrlConfig.onToggleChange = function (state) {
                setWidgetValue(node, W_STATE, state);
                valueInput.value = stateLabel(state);
            };
        } else if (ctype === "Button") {
            ctrlConfig.style = getWidgetValue(node, W_BUTTON_STYLE, "rounded");
            ctrlConfig.buttonToggleMode = getWidgetValue(
                node,
                W_BUTTON_MODE,
                "increase"
            ) === "toggle";
            ctrlConfig.labelOn = stateLabel(true);
            ctrlConfig.labelOff = stateLabel(false);
            ctrlConfig.onButtonChange = function (pressed) {
                setWidgetValue(node, W_STATE, pressed);
                handleButtonHold(node, pressed);
            };
        } else if (info.isXY) {
            ctrlConfig.crosshairVisible = getWidgetValue(node, W_CROSSHAIR, true);
            ctrlConfig.gridVisible = getWidgetValue(node, W_GRID, true);
            ctrlConfig.onXYChange = function (nx, ny) {
                nx = snapXYNorm(node, "x", nx);
                ny = snapXYNorm(node, "y", ny);
                setWidgetValue(node, W_X_NORMALIZED, nx);
                setWidgetValue(node, W_Y_NORMALIZED, ny);
                if (node.__xcontrol && node.__xcontrol.setValue) {
                    node.__xcontrol.setValue({ x: nx, y: ny });
                }
                updateXYDisplayForNode(node, nx, ny);
            };
        }

        var control;
        try {
            control = core.createControl(ctrlConfig);
        } catch (err) {
            console.error("[XController] createControl error:", err);
            return;
        }
        if (!control) return;

        controlHost.appendChild(control.dom);
        node.__xcontrol = control;

        // 从 widget 恢复初始值
        restoreControlValue(node, control, ctype);
        syncOutputVisibility(node);
        adjustNodeSize(node, true);
    }

    function updateValueDisplay(norm) {
        valueInput.value = analogNormToValueText(node, norm);
    }

    /** 用户手动输入数值 → 转换为标准化值 → 更新控件 */
    function applyValueInput() {
        var raw = String(valueInput.value || "").trim();
        if (!raw) return;
        var ctype = getCurrentType();
        var info = CONTROL_TYPES[ctype];
        if (!info) return;

        if (info.isAnalog || ctype === "Button") {
            var norm = parseValueInputToNorm(raw);
            if (isNaN(norm)) return;
            setAnalogNormForNode(node, norm);
        } else if (info.isXY) {
            var parts = raw.split(/[,;\s]+/);
            if (parts.length >= 2) {
                var nx = parseFloat(parts[0]);
                var ny = parseFloat(parts[1]);
                if (!isNaN(nx) && !isNaN(ny)) {
                    var xMin = getWidgetValue(node, W_X_MIN, 0);
                    var xMax = getWidgetValue(node, W_X_MAX, 1);
                    var yMin = getWidgetValue(node, W_Y_MIN, 0);
                    var yMax = getWidgetValue(node, W_Y_MAX, 1);
                    nx = xMax === xMin ? 0 : (nx - xMin) / (xMax - xMin);
                    ny = yMax === yMin ? 0 : (ny - yMin) / (yMax - yMin);
                    nx = snapXYNorm(node, "x", nx);
                    ny = snapXYNorm(node, "y", ny);
                    setWidgetValue(node, W_X_NORMALIZED, nx);
                    setWidgetValue(node, W_Y_NORMALIZED, ny);
                    if (node.__xcontrol && node.__xcontrol.setValue) {
                        node.__xcontrol.setValue({ x: nx, y: ny });
                    }
                    updateXYDisplayForNode(node, nx, ny);
                }
            }
        } else if (ctype === "Toggle" || ctype === "Button") {
            var lo = raw.toLowerCase();
            var state = (lo === "1" || lo === "true" || lo === "on");
            setWidgetValue(node, W_STATE, state);
            if (node.__xcontrol && node.__xcontrol.setValue) {
                node.__xcontrol.setValue(state ? 1 : 0);
            }
            valueInput.value = stateLabel(state);
        }
    }

    /**
     * 将用户输入的映射值转回标准化值 [0,1]。
     */
    function parseValueInputToNorm(raw) {
        return parseAnalogValueToNorm(node, raw);
    }

    // ── 事件绑定 ──
    typeSelect.addEventListener("change", function () {
        setWidgetValue(node, W_CONTROL_TYPE, typeSelect.value);
        rebuildConfigPanel();
        rebuildControl();
    });

    // 初始化
    rebuildConfigPanel();
    rebuildControl();

    // 如果控件创建失败（XControllerCore 未加载），显示提示
    if (!node.__xcontrol) {
        var warn = document.createElement("div");
        warn.style.cssText =
            "font-size:10px;color:#f87171;text-align:center;padding:8px;";
        warn.textContent = "⚠ "
            + t("XControllerCore not loaded. Check web/core/xcontroller_core.js");
        controlHost.appendChild(warn);
    }

    // 注册 DOM widget
    if (typeof node.addDOMWidget === "function") {
        node.addDOMWidget(DOM_WIDGET_NAME, "custom", root, {
            serialize: false,
        });
    }

    // 转发画布事件（中键平移、滚轮缩放）
    bindCanvasForwarding(root);
}

// ================================================================
// 配置面板构建器
// ================================================================

function createRow(labelText) {
    var row = document.createElement("div");
    row.style.cssText =
        "display:flex;align-items:center;gap:4px;flex-wrap:wrap;";
    var label = document.createElement("span");
    label.textContent = t(labelText);
    label.style.cssText = "font-size:11px;white-space:nowrap;min-width:38px;";
    row.appendChild(label);
    return row;
}

function applyTooltip(element, tooltip) {
    if (element && tooltip) element.title = tooltip;
    return element;
}

function setRowTooltip(row, tooltip) {
    if (!row || !tooltip) return row;
    row.title = tooltip;
    if (row.firstChild) row.firstChild.title = tooltip;
    return row;
}

function createSelect(options, value, tooltip) {
    var sel = document.createElement("select");
    sel.style.cssText =
        "flex:1;min-width:60px;background:var(--comfy-menu-secondary-bg,#2a2a2a);" +
        "color:var(--input-text,#ddd);border:1px solid var(--border-color,#555);" +
        "border-radius:4px;padding:2px 4px;font-size:11px;";
    options.forEach(function (opt) {
        var o = document.createElement("option");
        o.value = opt;
        o.textContent = optionLabel(opt);
        sel.appendChild(o);
    });
    sel.value = String(value);
    applyTooltip(sel, tooltip);
    return sel;
}

function createInput(value, isText, tooltip) {
    var inp = document.createElement("input");
    inp.style.cssText =
        "flex:1;min-width:40px;width:50px;background:var(--comfy-menu-secondary-bg,#2a2a2a);" +
        "color:var(--input-text,#ddd);border:1px solid var(--border-color,#555);" +
        "border-radius:4px;padding:2px 4px;font-size:11px;";
    inp.type = isText ? "text" : "number";
    inp.step = "any";
    inp.value = value;
    applyTooltip(inp, tooltip);
    return inp;
}

function clamp01(value) {
    return Math.max(0, Math.min(1, Number(value) || 0));
}

function formatNumber(value) {
    if (!isFinite(value)) return "0";
    return String(Math.round(value * 1000000) / 1000000);
}

function parseSteps(node) {
    var raw = getWidgetValue(node, W_STEPS, "[0, 0.5, 1]");
    try {
        var parsed = JSON.parse(String(raw));
        if (!Array.isArray(parsed) || parsed.length === 0) return [0, 1];
        var steps = parsed.map(function (item) {
            return Number(item);
        }).filter(function (item) {
            return isFinite(item);
        });
        return steps.length ? steps : [0, 1];
    } catch (e) {
        return [0, 1];
    }
}

function normToStepIndex(norm, steps) {
    if (steps.length <= 1) return 0;
    return Math.max(
        0,
        Math.min(steps.length - 1, Math.round(clamp01(norm) * (steps.length - 1)))
    );
}

function stepIndexToNorm(index, steps) {
    if (steps.length <= 1) return 0;
    return Math.max(0, Math.min(steps.length - 1, index)) / (steps.length - 1);
}

function snapAnalogNorm(node, norm) {
    norm = clamp01(norm);
    var mode = getWidgetValue(node, W_VALUE_MODE, "Range");
    if (mode === "Range") {
        var min = getWidgetValue(node, W_MIN, 0);
        var max = getWidgetValue(node, W_MAX, 1);
        var step = getWidgetValue(node, W_STEP, 0);
        if (step > 0 && max !== min) {
            var val = min + norm * (max - min);
            val = Math.round(val / step) * step;
            return clamp01((val - min) / (max - min));
        }
    } else if (mode === "Steps") {
        return stepIndexToNorm(normToStepIndex(norm, parseSteps(node)), parseSteps(node));
    }
    return norm;
}

function analogNormToValueText(node, norm) {
    var mode = getWidgetValue(node, W_VALUE_MODE, "Range");
    norm = clamp01(norm);
    if (mode === "Range") {
        var min = getWidgetValue(node, W_MIN, 0);
        var max = getWidgetValue(node, W_MAX, 1);
        var step = getWidgetValue(node, W_STEP, 0);
        var val = min + norm * (max - min);
        if (step > 0) val = Math.round(val / step) * step;
        return formatNumber(val);
    }
    if (mode === "Steps") {
        var steps = parseSteps(node);
        var idx = normToStepIndex(norm, steps);
        return formatNumber(steps[idx]) + " [" + idx + "]";
    }
    if (mode === "Percentage") {
        var base = getWidgetValue(node, W_BASE_VALUE, 1);
        var pctMin = getWidgetValue(node, W_PCT_MIN, -100);
        var pctMax = getWidgetValue(node, W_PCT_MAX, 100);
        var pct = pctMin + norm * (pctMax - pctMin);
        var pctStep = getWidgetValue(node, W_STEP, 0);
        if (pctStep > 0) pct = Math.round(pct / pctStep) * pctStep;
        var pctVal = base * (1 + pct / 100);
        return formatNumber(pctVal) + " (" + formatNumber(pct) + "%)";
    }
    return "";
}

function parseAnalogValueToNorm(node, raw) {
    var mode = getWidgetValue(node, W_VALUE_MODE, "Range");
    if (mode === "Range") {
        var min = getWidgetValue(node, W_MIN, 0);
        var max = getWidgetValue(node, W_MAX, 1);
        if (max === min) return 0;
        var val = parseFloat(raw);
        if (isNaN(val)) return NaN;
        return (val - min) / (max - min);
    }
    if (mode === "Steps") {
        var steps = parseSteps(node);
        var text = String(raw).trim();
        var indexMatch = text.match(/^\[?(\d+)\]?$/);
        if (indexMatch) return stepIndexToNorm(parseInt(indexMatch[1], 10), steps);
        var stepValue = parseFloat(text);
        if (isNaN(stepValue)) return NaN;
        var bestIdx = 0;
        var bestDist = Infinity;
        steps.forEach(function (stepValueItem, idx) {
            var dist = Math.abs(stepValueItem - stepValue);
            if (dist < bestDist) {
                bestDist = dist;
                bestIdx = idx;
            }
        });
        return stepIndexToNorm(bestIdx, steps);
    }
    if (mode === "Percentage") {
        var value = parseFloat(raw);
        if (isNaN(value)) return NaN;
        var base = getWidgetValue(node, W_BASE_VALUE, 1);
        var pctMin = getWidgetValue(node, W_PCT_MIN, -100);
        var pctMax = getWidgetValue(node, W_PCT_MAX, 100);
        if (base === 0 || pctMax === pctMin) return NaN;
        var pct = (value / base - 1) * 100;
        return (pct - pctMin) / (pctMax - pctMin);
    }
    return NaN;
}

function xyNormToValue(node, axis, norm) {
    var min = axis === "x" ? getWidgetValue(node, W_X_MIN, 0) : getWidgetValue(node, W_Y_MIN, 0);
    var max = axis === "x" ? getWidgetValue(node, W_X_MAX, 1) : getWidgetValue(node, W_Y_MAX, 1);
    var step = axis === "x" ? getWidgetValue(node, W_X_STEP, 0) : getWidgetValue(node, W_Y_STEP, 0);
    var val = min + clamp01(norm) * (max - min);
    if (step > 0) val = Math.round(val / step) * step;
    return val;
}

function snapXYNorm(node, axis, norm) {
    var min = axis === "x" ? getWidgetValue(node, W_X_MIN, 0) : getWidgetValue(node, W_Y_MIN, 0);
    var max = axis === "x" ? getWidgetValue(node, W_X_MAX, 1) : getWidgetValue(node, W_Y_MAX, 1);
    if (max === min) return 0;
    return clamp01((xyNormToValue(node, axis, norm) - min) / (max - min));
}

function updateXYDisplayForNode(node, nx, ny) {
    if (!node.__xcontrolValueInput) return;
    node.__xcontrolValueInput.value =
        "X:" + formatNumber(xyNormToValue(node, "x", nx)) +
        " Y:" + formatNumber(xyNormToValue(node, "y", ny));
}

function setAnalogNormForNode(node, norm) {
    norm = snapAnalogNorm(node, norm);
    setWidgetValue(node, W_NORMALIZED, norm);
    if (node.__xcontrol && node.__xcontrol.setValue) {
        node.__xcontrol.setValue(norm);
    }
    updateValueDisplayForNode(node, norm);
    return norm;
}

function buttonNormDelta(node) {
    var mode = getWidgetValue(node, W_VALUE_MODE, "Range");
    if (mode === "Steps") {
        var steps = parseSteps(node);
        return steps.length <= 1 ? 1 : 1 / (steps.length - 1);
    }
    if (mode === "Range") {
        var min = getWidgetValue(node, W_MIN, 0);
        var max = getWidgetValue(node, W_MAX, 1);
        var step = getWidgetValue(node, W_STEP, 0);
        if (step > 0 && max !== min) return Math.abs(step / (max - min));
    }
    return 0.01;
}

function stopButtonHold(node) {
    if (node.__xcontrolButtonTimer) {
        clearInterval(node.__xcontrolButtonTimer);
        node.__xcontrolButtonTimer = null;
    }
}

function handleButtonHold(node, pressed) {
    stopButtonHold(node);
    var mode = getWidgetValue(node, W_BUTTON_MODE, "increase");
    if (mode === "toggle") {
        setAnalogNormForNode(node, pressed ? 1 : 0);
        updateValueDisplayForNode(node, pressed ? 1 : 0);
        return;
    }
    if (!pressed) {
        updateValueDisplayForNode(node, getWidgetValue(node, W_NORMALIZED, 0.5));
        return;
    }
    var direction = mode === "decrease" ? -1 : 1;
    var tick = function () {
        var current = getWidgetValue(node, W_NORMALIZED, 0.5);
        setAnalogNormForNode(node, current + direction * buttonNormDelta(node));
    };
    tick();
    node.__xcontrolButtonTimer = setInterval(tick, BUTTON_REPEAT_MS);
}

function buildAnalogConfig(panel, node, includeShape) {
    if (includeShape !== false) includeShape = true;
    // Value Mode 选择
    var modeRow = setRowTooltip(createRow("Mode:"), tt("Value mode"));
    var modeSel = createSelect(
        VALUE_MODES,
        getWidgetValue(node, W_VALUE_MODE, "Range"),
        tt("Value mode")
    );
    Array.from(modeSel.options).forEach(function (option) {
        option.title = tt("Mode " + option.value);
    });
    modeSel.addEventListener("change", function () {
        setWidgetValue(node, W_VALUE_MODE, modeSel.value);
        panel.innerHTML = "";
        buildAnalogConfig(panel, node, includeShape);
        if (!includeShape) buildButtonConfig(panel, node);
        rebuildControlForNode(node);
    });
    modeRow.appendChild(modeSel);
    panel.appendChild(modeRow);

    var mode = modeSel.value;

    if (mode === "Range") {
        var r1 = setRowTooltip(createRow("Range:"), tt("Range min"));
        var minInp = createInput(getWidgetValue(node, W_MIN, 0), false, tt("Range min"));
        minInp.addEventListener("change", function () {
            setWidgetValue(node, W_MIN, parseFloat(minInp.value) || 0);
        });
        r1.appendChild(minInp);
        panel.appendChild(r1);

        var r2 = setRowTooltip(createRow(""), tt("Range max"));
        var maxInp = createInput(getWidgetValue(node, W_MAX, 1), false, tt("Range max"));
        maxInp.addEventListener("change", function () {
            setWidgetValue(node, W_MAX, parseFloat(maxInp.value) || 1);
        });
        r2.appendChild(maxInp);
        panel.appendChild(r2);

        var r3 = setRowTooltip(createRow(""), tt("Range step"));
        var stepInp = createInput(getWidgetValue(node, W_STEP, 0), false, tt("Range step"));
        stepInp.addEventListener("change", function () {
            setWidgetValue(node, W_STEP, parseFloat(stepInp.value) || 0);
        });
        r3.appendChild(stepInp);
        panel.appendChild(r3);

    } else if (mode === "Steps") {
        var s1 = setRowTooltip(createRow("Steps:"), tt("Steps values"));
        var stepsInp = createInput(
            getWidgetValue(node, W_STEPS, "[0, 0.5, 1]"),
            true,
            tt("Steps values")
        );
        stepsInp.style.minWidth = "120px";
        stepsInp.addEventListener("change", function () {
            setWidgetValue(node, W_STEPS, stepsInp.value);
        });
        s1.appendChild(stepsInp);
        panel.appendChild(s1);
    } else if (mode === "Percentage") {
        var p0 = setRowTooltip(createRow("Pct:"), tt("Percentage base"));
        var baseInp = createInput(
            getWidgetValue(node, W_BASE_VALUE, 1),
            false,
            tt("Percentage base")
        );
        baseInp.addEventListener("change", function () {
            setWidgetValue(node, W_BASE_VALUE, parseFloat(baseInp.value) || 1);
        });
        p0.appendChild(baseInp);
        panel.appendChild(p0);

        var p1 = setRowTooltip(createRow("Min%"), tt("Percentage min"));
        var pctMinInp = createInput(
            getWidgetValue(node, W_PCT_MIN, -100),
            false,
            tt("Percentage min")
        );
        pctMinInp.addEventListener("change", function () {
            setWidgetValue(node, W_PCT_MIN, parseFloat(pctMinInp.value) || -100);
        });
        p1.appendChild(pctMinInp);
        panel.appendChild(p1);

        var p2 = setRowTooltip(createRow("Max%"), tt("Percentage max"));
        var pctMaxInp = createInput(
            getWidgetValue(node, W_PCT_MAX, 100),
            false,
            tt("Percentage max")
        );
        pctMaxInp.addEventListener("change", function () {
            setWidgetValue(node, W_PCT_MAX, parseFloat(pctMaxInp.value) || 100);
        });
        p2.appendChild(pctMaxInp);
        panel.appendChild(p2);

    }

    if (!includeShape) return;

    // Shape 选择（knob/faderH/faderV）
    var ctype = getWidgetValue(node, W_CONTROL_TYPE, "Knob");
    var shapeOptions;
    if (ctype === "Knob") {
        shapeOptions = KNOB_SHAPES;
    } else {
        shapeOptions = HANDLE_SHAPES;
    }
    var shapeRow = setRowTooltip(createRow("Shape:"), tt("Shape"));
    var rawShape = getWidgetValue(node, W_SHAPE, shapeOptions[0]);
    var fixedShape = ctype === "Knob"
        ? normalizeKnobShape(rawShape)
        : normalizeHandleShape(rawShape);
    if (String(rawShape) !== fixedShape) {
        setWidgetValue(node, W_SHAPE, fixedShape);
    }
    var shapeSel = createSelect(
        shapeOptions,
        fixedShape,
        tt("Shape")
    );
    shapeSel.addEventListener("change", function () {
        setWidgetValue(node, W_SHAPE, shapeSel.value);
        rebuildControlForNode(node);
    });
    shapeRow.appendChild(shapeSel);
    panel.appendChild(shapeRow);
}

function buildToggleConfig(panel, node) {
    var styleRow = setRowTooltip(createRow("Toggle:"), tt("Toggle style"));
    var rawStyle = getWidgetValue(node, W_TOGGLE_STYLE, "switch");
    var fixedStyle = normalizeToggleStyle(rawStyle);
    if (String(rawStyle) !== fixedStyle) {
        setWidgetValue(node, W_TOGGLE_STYLE, fixedStyle);
    }
    var styleSel = createSelect(
        TOGGLE_STYLES,
        fixedStyle,
        tt("Toggle style")
    );
    styleSel.addEventListener("change", function () {
        setWidgetValue(node, W_TOGGLE_STYLE, styleSel.value);
        rebuildControlForNode(node);
    });
    styleRow.appendChild(styleSel);
    panel.appendChild(styleRow);
}

function buildButtonConfig(panel, node) {
    var modeRow = setRowTooltip(createRow(""), tt("Button mode"));
    var rawMode = getWidgetValue(node, W_BUTTON_MODE, "increase");
    var fixedMode = normalizeButtonMode(rawMode);
    if (String(rawMode) !== fixedMode) {
        setWidgetValue(node, W_BUTTON_MODE, fixedMode);
    }
    var modeSel = createSelect(BUTTON_MODES, fixedMode, tt("Button mode"));
    modeSel.addEventListener("change", function () {
        setWidgetValue(node, W_BUTTON_MODE, modeSel.value);
        rebuildControlForNode(node);
    });
    modeRow.appendChild(modeSel);
    panel.appendChild(modeRow);

    var styleRow = setRowTooltip(createRow("Button:"), tt("Button style"));
    var styleSel = createSelect(
        BUTTON_STYLES,
        getWidgetValue(node, W_BUTTON_STYLE, "rounded"),
        tt("Button style")
    );
    styleSel.addEventListener("change", function () {
        setWidgetValue(node, W_BUTTON_STYLE, styleSel.value);
        rebuildControlForNode(node);
    });
    styleRow.appendChild(styleSel);
    panel.appendChild(styleRow);
}

function buildXYPadConfig(panel, node) {
    // X 轴配置
    var xRow = createRow("X:");
    setRowTooltip(xRow, [
        tt("X min"), tt("X max"), tt("X step"),
    ].join("\n"));
    var xMin = createInput(getWidgetValue(node, W_X_MIN, 0), false, tt("X min"));
    xMin.addEventListener("change", function () {
        setWidgetValue(node, W_X_MIN, parseFloat(xMin.value) || 0);
    });
    xRow.appendChild(xMin);
    var xMax = createInput(getWidgetValue(node, W_X_MAX, 1), false, tt("X max"));
    xMax.addEventListener("change", function () {
        setWidgetValue(node, W_X_MAX, parseFloat(xMax.value) || 1);
    });
    xRow.appendChild(xMax);
    var xStep = createInput(getWidgetValue(node, W_X_STEP, 0), false, tt("X step"));
    xStep.addEventListener("change", function () {
        setWidgetValue(node, W_X_STEP, parseFloat(xStep.value) || 0);
    });
    xRow.appendChild(xStep);
    panel.appendChild(xRow);

    // Y 轴配置
    var yRow = createRow("Y:");
    setRowTooltip(yRow, [
        tt("Y min"), tt("Y max"), tt("Y step"),
    ].join("\n"));
    var yMin = createInput(getWidgetValue(node, W_Y_MIN, 0), false, tt("Y min"));
    yMin.addEventListener("change", function () {
        setWidgetValue(node, W_Y_MIN, parseFloat(yMin.value) || 0);
    });
    yRow.appendChild(yMin);
    var yMax = createInput(getWidgetValue(node, W_Y_MAX, 1), false, tt("Y max"));
    yMax.addEventListener("change", function () {
        setWidgetValue(node, W_Y_MAX, parseFloat(yMax.value) || 1);
    });
    yRow.appendChild(yMax);
    var yStep = createInput(getWidgetValue(node, W_Y_STEP, 0), false, tt("Y step"));
    yStep.addEventListener("change", function () {
        setWidgetValue(node, W_Y_STEP, parseFloat(yStep.value) || 0);
    });
    yRow.appendChild(yStep);
    panel.appendChild(yRow);

    // 十字线 / 网格
    var chRow = setRowTooltip(createRow("Crosshair"), tt("Crosshair"));
    var chChk = document.createElement("input");
    chChk.type = "checkbox";
    applyTooltip(chChk, tt("Crosshair"));
    chChk.checked = getWidgetValue(node, W_CROSSHAIR, true);
    chChk.addEventListener("change", function () {
        setWidgetValue(node, W_CROSSHAIR, chChk.checked);
        rebuildControlForNode(node);
    });
    chRow.appendChild(chChk);
    panel.appendChild(chRow);

    var gridRow = setRowTooltip(createRow("Grid"), tt("Grid"));
    var gridChk = document.createElement("input");
    gridChk.type = "checkbox";
    applyTooltip(gridChk, tt("Grid"));
    gridChk.checked = getWidgetValue(node, W_GRID, true);
    gridChk.addEventListener("change", function () {
        setWidgetValue(node, W_GRID, gridChk.checked);
        rebuildControlForNode(node);
    });
    gridRow.appendChild(gridChk);
    panel.appendChild(gridRow);
}

// ================================================================
// 控件重建与值恢复
// ================================================================

function rebuildControlForNode(node) {
    if (!node.__xcontrolControlHost) return;
    stopButtonHold(node);
    node.__xcontrolControlHost.innerHTML = "";
    node.__xcontrol = null;

    var ctype = getWidgetValue(node, W_CONTROL_TYPE, "Knob");
    var info = CONTROL_TYPES[ctype];
    if (!info) return;

        var core = getXControllerCore();
    if (!core) return;

    var ctrlConfig = {
        type: info.coreType,
        app: app,
    };

    if (info.isAnalog) {
        ctrlConfig.shape = getWidgetValue(node, W_SHAPE, "circle");
        ctrlConfig.onValueChange = function (norm) {
            setAnalogNormForNode(node, norm);
        };
    } else if (ctype === "Toggle") {
        ctrlConfig.style = getWidgetValue(node, W_TOGGLE_STYLE, "switch");
        ctrlConfig.onToggleChange = function (state) {
            setWidgetValue(node, W_STATE, state);
            if (node.__xcontrolValueInput) {
                node.__xcontrolValueInput.value = stateLabel(state);
            }
        };
    } else if (ctype === "Button") {
        ctrlConfig.style = getWidgetValue(node, W_BUTTON_STYLE, "rounded");
        ctrlConfig.buttonToggleMode = getWidgetValue(
            node,
            W_BUTTON_MODE,
            "increase"
        ) === "toggle";
        ctrlConfig.labelOn = stateLabel(true);
        ctrlConfig.labelOff = stateLabel(false);
        ctrlConfig.onButtonChange = function (pressed) {
            setWidgetValue(node, W_STATE, pressed);
            handleButtonHold(node, pressed);
        };
    } else if (info.isXY) {
        ctrlConfig.crosshairVisible = getWidgetValue(node, W_CROSSHAIR, true);
        ctrlConfig.gridVisible = getWidgetValue(node, W_GRID, true);
        ctrlConfig.onXYChange = function (nx, ny) {
            nx = snapXYNorm(node, "x", nx);
            ny = snapXYNorm(node, "y", ny);
            setWidgetValue(node, W_X_NORMALIZED, nx);
            setWidgetValue(node, W_Y_NORMALIZED, ny);
            if (node.__xcontrol && node.__xcontrol.setValue) {
                node.__xcontrol.setValue({ x: nx, y: ny });
            }
            updateXYDisplayForNode(node, nx, ny);
        };
    }

    var control;
    try {
        control = core.createControl(ctrlConfig);
    } catch (err) {
        console.error("[XController] createControl error:", err);
        return;
    }
    if (!control) return;

    node.__xcontrolControlHost.appendChild(control.dom);
    node.__xcontrol = control;

    restoreControlValue(node, control, ctype);
    syncOutputVisibility(node);
    adjustNodeSize(node, true);
}

function restoreControlValue(node, control, ctype) {
    var info = CONTROL_TYPES[ctype];
    if (!info) return;

    if (info.isAnalog) {
        var norm = getWidgetValue(node, W_NORMALIZED, 0.5);
        norm = snapAnalogNorm(node, norm);
        setWidgetValue(node, W_NORMALIZED, norm);
        control.setValue(norm);
        updateValueDisplayForNode(node, norm);
    } else if (ctype === "Toggle") {
        var state = getWidgetValue(node, W_STATE, false);
        control.setValue(state ? 1 : 0);
        if (node.__xcontrolValueInput) {
            node.__xcontrolValueInput.value = stateLabel(state);
        }
    } else if (ctype === "Button") {
        var buttonMode = getWidgetValue(node, W_BUTTON_MODE, "increase");
        var buttonState = buttonMode === "toggle"
            ? getWidgetValue(node, W_STATE, false)
            : false;
        control.setValue(buttonState ? 1 : 0);
        setWidgetValue(node, W_STATE, buttonState);
        if (node.__xcontrolValueInput) {
            updateValueDisplayForNode(node, getWidgetValue(node, W_NORMALIZED, 0.5));
        }
    } else if (info.isXY) {
        var nx = getWidgetValue(node, W_X_NORMALIZED, 0.5);
        var ny = getWidgetValue(node, W_Y_NORMALIZED, 0.5);
        nx = snapXYNorm(node, "x", nx);
        ny = snapXYNorm(node, "y", ny);
        setWidgetValue(node, W_X_NORMALIZED, nx);
        setWidgetValue(node, W_Y_NORMALIZED, ny);
        control.setValue({ x: nx, y: ny });
        updateXYDisplayForNode(node, nx, ny);
    }
}

function updateValueDisplayForNode(node, norm) {
    if (!node.__xcontrolValueInput) return;
    var mode = getWidgetValue(node, W_VALUE_MODE, "Range");
    if (mode === "Range" || mode === "Steps" || mode === "Percentage") {
        node.__xcontrolValueInput.value = analogNormToValueText(node, norm);
    }
}

// ================================================================
// XControllerCore 获取
// ================================================================

function getXControllerCore() {
    if (typeof XControllerCore !== "undefined" && XControllerCore) return XControllerCore;
    if (typeof window !== "undefined" && window.XControllerCore) return window.XControllerCore;
    if (typeof globalThis !== "undefined" && globalThis.XControllerCore) {
        return globalThis.XControllerCore;
    }
    console.warn("[XController] XControllerCore not loaded.");
    return null;
}

// ================================================================
// 画布事件转发
// ================================================================

/**
 * 转发鼠标中键（画布平移）和滚轮（画布缩放）到 ComfyUI 画布。
 * 这是 addDOMWidget 节点必须实现的基础交互。
 */
function bindCanvasForwarding(el) {
    // 中键拖拽 → 画布平移
    el.addEventListener("mousedown", function (e) {
        if (e.button !== 1) return;
        var canvas = app.canvas;
        if (!canvas) return;
        e.preventDefault();
        canvas.processMouseDown(e);
        var moveHandler = function (ev) {
            canvas.processMouseMove(ev);
        };
        var upHandler = function (ev) {
            canvas.processMouseUp(ev);
            document.removeEventListener("mousemove", moveHandler);
            document.removeEventListener("mouseup", upHandler);
        };
        document.addEventListener("mousemove", moveHandler);
        document.addEventListener("mouseup", upHandler);
    });

    // 滚轮 → 画布缩放
    el.addEventListener("wheel", function (e) {
        e.preventDefault();
        e.stopPropagation();
        var gc = app.canvas && app.canvas.canvas;
        if (!gc) return;
        gc.dispatchEvent(new WheelEvent("wheel", {
            deltaX: e.deltaX,
            deltaY: e.deltaY,
            deltaZ: e.deltaZ,
            deltaMode: e.deltaMode,
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
    });
}

// ================================================================
// 扩展注册
// ================================================================

app.registerExtension({
    name: EXT_NAME,

    async setup() {
        applyUiLocale();
    },

    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (String(nodeData.name) !== NODE_CLASS) return;

        var origOnCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            if (origOnCreated) {
                try {
                    origOnCreated.apply(this, arguments);
                } catch (err) {
        console.error("[XController] origOnCreated error:", err);
                }
            }
            buildXControlUI(this);
            adjustNodeSize(this, true);
        };

        var origOnConfigure = nodeType.prototype.onConfigure;
        nodeType.prototype.onConfigure = function () {
            if (origOnConfigure) {
                try {
                    origOnConfigure.apply(this, arguments);
                } catch (err) {
        console.error("[XController] origOnConfigure error:", err);
                }
            }
            // 重新隐藏 + 恢复值
            ALL_WIDGET_NAMES.forEach((name) => {
                // V2 视图可能在 onConfigure 后重建 widgets
                hideNativeWidget(this, name);
            });
            ensureWidgetPersistence(this);
            // 修复旧版小写值
            var rawType = getWidgetValue(this, W_CONTROL_TYPE, "Knob");
            var fixedType = normalizeControlType(rawType);
            if (String(rawType) !== fixedType) {
                setWidgetValue(this, W_CONTROL_TYPE, fixedType);
            }
            syncControlTypeUI(this);
            adjustNodeSize(this, true);
        };
    },

    async loadedGraphNode(node) {
        if (String(node.comfyClass || node.type || "") !== NODE_CLASS) {
            return;
        }
        if (!node.__xcontrolUI) {
            buildXControlUI(node);
        } else {
            ALL_WIDGET_NAMES.forEach((name) => {
                hideNativeWidget(node, name);
            });
            ensureWidgetPersistence(node);
            // 修复旧版小写值
            var rawType = getWidgetValue(node, W_CONTROL_TYPE, "Knob");
            var fixedType = normalizeControlType(rawType);
            if (String(rawType) !== fixedType) {
                setWidgetValue(node, W_CONTROL_TYPE, fixedType);
            }
            syncControlTypeUI(node);
        }
        adjustNodeSize(node, true);
    },

    async nodeCreated(node) {
        if (String(node.comfyClass || node.type || "") !== NODE_CLASS) {
            return;
        }
        if (!node.__xcontrolUI) {
            buildXControlUI(node);
        }
        adjustNodeSize(node, true);
    },
});
