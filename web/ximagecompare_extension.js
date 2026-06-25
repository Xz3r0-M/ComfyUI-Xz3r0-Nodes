/**
 * XImageCompare 前端扩展
 *
 * 为 XImageCompare 节点提供 Canvas 画布渲染，支持 4 种对比模式：
 * 1. 滑动横向过渡对比
 * 2. 鼠标聚光局部对比
 * 3. 透明度渐变对比
 * 4. 自动乒乓式透明度循环对比
 *
 * 图片始终最大化 fit 画布、居中显示，跟随节点窗口尺寸自适应。
 * 状态通过 hidden widget 持久化。
 */

import { app } from "../../scripts/app.js";

// =========================================================================
// 本地化 Key 常量（参照 XImageGet2 模式）
// =========================================================================

var LOCALE_PREFIX = "xdatahub.ui.node.ximagecompare";
var COMFY_LOCALE_KEY_I18N = "Comfy.Locale";
var LOCALE_SYNC_INTERVAL = 1000;

// 模式按钮
var MODE_SLIDE_KEY = LOCALE_PREFIX + ".mode_slide";
var MODE_SLIDE_FB = "Slide";
var MODE_SPOTLIGHT_KEY = LOCALE_PREFIX + ".mode_spotlight";
var MODE_SPOTLIGHT_FB = "Spotlight";
var MODE_BLEND_KEY = LOCALE_PREFIX + ".mode_blend";
var MODE_BLEND_FB = "Blend";
var MODE_PINGPONG_KEY = LOCALE_PREFIX + ".mode_pingpong";
var MODE_PINGPONG_FB = "Ping-Pong Blend";
var MODE_KEYS = [
    { key: MODE_SLIDE_KEY, fb: MODE_SLIDE_FB },
    { key: MODE_SPOTLIGHT_KEY, fb: MODE_SPOTLIGHT_FB },
    { key: MODE_BLEND_KEY, fb: MODE_BLEND_FB },
    { key: MODE_PINGPONG_KEY, fb: MODE_PINGPONG_FB },
];

// 曲线标签
var CURVE_LABEL_KEY = LOCALE_PREFIX + ".curve_label";
var CURVE_LABEL_FB = "Curve";

// 画布滚轮控制开关
var WHEEL_CTRL_KEY = LOCALE_PREFIX + ".wheel_ctrl";
var WHEEL_CTRL_FB = "Image Area Scroll";
var WHEEL_CTRL_TIP_KEY = LOCALE_PREFIX + ".wheel_ctrl_tip";
var WHEEL_CTRL_TIP_FB = "When enabled, scrolling on the canvas adjusts the slider parameter for the current mode.";

// 实时预览开关
var LIVE_PREVIEW_KEY = LOCALE_PREFIX + ".live_preview";
var LIVE_PREVIEW_FB = "Live Preview";
var LIVE_PREVIEW_ENABLED_KEY = LOCALE_PREFIX + ".live_preview_enabled";
var LIVE_PREVIEW_ENABLED_FB = "Live Preview: Enabled";
var LIVE_PREVIEW_DISABLED_KEY = LOCALE_PREFIX + ".live_preview_disabled";
var LIVE_PREVIEW_DISABLED_FB = "Live Preview: Disabled";
var LIVE_PREVIEW_TIP_KEY = LOCALE_PREFIX + ".live_preview_tip";
var LIVE_PREVIEW_TIP_FB = "Show real-time preview from upstream sampler while running. Requires ComfyUI real-time preview to be enabled.";

// 滑块控制标签
var LABEL_SPLIT_KEY = LOCALE_PREFIX + ".label_split";
var LABEL_SPLIT_FB = "Split";
var LABEL_RADIUS_KEY = LOCALE_PREFIX + ".label_radius";
var LABEL_RADIUS_FB = "Radius";
var LABEL_OPACITY_KEY = LOCALE_PREFIX + ".label_opacity";
var LABEL_OPACITY_FB = "Opacity";
var LABEL_SPEED_KEY = LOCALE_PREFIX + ".label_speed";
var LABEL_SPEED_FB = "Speed";

// 占位文字
var PLACEHOLDER_KEY = LOCALE_PREFIX + ".placeholder";
var PLACEHOLDER_FB = "Execute to load images...";
var LOAD_FAILED_KEY = LOCALE_PREFIX + ".load_failed";
var LOAD_FAILED_FB = "Image load failed";

// 分辨率标签前缀
var RES_A_KEY = LOCALE_PREFIX + ".res_a";
var RES_A_FB = "A:";
var RES_B_KEY = LOCALE_PREFIX + ".res_b";
var RES_B_FB = "B:";

// 匹配提示
var MATCH_OK_KEY = LOCALE_PREFIX + ".match_ok";
var MATCH_OK_FB = "Resolutions match";
var MATCH_DIFF_KEY = LOCALE_PREFIX + ".match_diff";
var MATCH_DIFF_FB = "Resolutions differ";

// 滑动方向按钮
var SLIDE_DIR_TOGGLE_KEY = LOCALE_PREFIX + ".slide_dir_toggle";
var SLIDE_DIR_TOGGLE_FB = "Direction (V/H)";
var SLIDE_DIR_TOGGLE_TIP_KEY = LOCALE_PREFIX + ".slide_dir_toggle_tip";
var SLIDE_DIR_TOGGLE_TIP_FB = "Toggle slide direction between horizontal and vertical split";

// =========================================================================
// 常量
// =========================================================================

var EXT_NAME = "ComfyUI.Xz3r0.XImageCompare";
var NODE_CLASS = "XImageCompare";
var WIDGET_NAME = "xcompare_preview";

// 模式枚举
var MODE = {
    SLIDE: 0,
    SPOTLIGHT: 1,
    BLEND: 2,
    PINGPONG: 3,
};
var MODE_COUNT = 4;

// 乒乓曲线枚举
var CURVE_SINE = 0;
var CURVE_EASED = 1;
var CURVE_HOLD = 2;
var CURVE_LONG_HOLD = 3;
var CURVE_COUNT = 4;
var CURVE_DEFAULT = CURVE_SINE;

// 乒乓曲线定义
var PINGPONG_CURVES = [
    {
        name: "Sine",
        key: LOCALE_PREFIX + ".curve_sine",
        tipKey: LOCALE_PREFIX + ".curve_sine_tip",
        tipFB: "Smooth sine wave crossfade between A and B",
    },
    {
        name: "Ease",
        key: LOCALE_PREFIX + ".curve_eased",
        tipKey: LOCALE_PREFIX + ".curve_eased_tip",
        tipFB: "Eased transitions with smoother start and end",
    },
    {
        name: "Hold",
        key: LOCALE_PREFIX + ".curve_hold",
        tipKey: LOCALE_PREFIX + ".curve_hold_tip",
        tipFB: "Holds at A and B, with quick transitions between them",
    },
    {
        name: "Long",
        key: LOCALE_PREFIX + ".curve_long",
        tipKey: LOCALE_PREFIX + ".curve_long_tip",
        tipFB: "Extended holds at A and B with shorter transitions",
    },
];

// 默认画布尺寸
var DEFAULT_CW = 640;
var DEFAULT_CH = 480;

// 工具栏高度（3行：按钮行 + 标签行 + 滑块行）
var TOOLBAR_H = 70;
// 底部间隔（为拉伸手柄留出触发空间）
var BOTTOM_SPACING = 16;
var PANEL_WIDGET_H = DEFAULT_CH + TOOLBAR_H + BOTTOM_SPACING;

// 不设独立的 canvas min-height——canvas 跟随节点窗口，
// 由 node.min_size 保证最小可用空间。
// DEFAULT_CH 仅用于占位状态下的 imgW/imgH 初始值。

// 最小节点尺寸（1.0 视图兼容）
// 节点内部：header(~30px) + toolbar(70px) + canvas + bottom-spacing(16px) + padding(~16px)
var MIN_NODE_W = DEFAULT_CW + 44;
var MIN_NODE_H = DEFAULT_CH + TOOLBAR_H + BOTTOM_SPACING + 48;

// 默认参数
var DEFAULT_SLIDE_POS = 50;
var DEFAULT_SPOT_RADIUS = 80;
var DEFAULT_BLEND_OPACITY = 50;
var DEFAULT_PINGPONG_SPEED = 50;

// 滑动方向
var SLIDE_DIR_H = 0;
var SLIDE_DIR_V = 1;
var DEFAULT_SLIDE_DIR = SLIDE_DIR_H;

// 跟踪所有对比节点
var compareStates = {};

// =========================================================================
// 本地化（参照 XImageGet2 完整模式）
// =========================================================================

var uiLocalePrimary = null;
var uiLocaleFallback = null;
var currentUiLocale = null;
var i18nCache = {};
var localeSyncInstalled = false;

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

function fetchI18n(locale) {
    if (i18nCache[locale]) return Promise.resolve(i18nCache[locale]);
    return fetch("/xz3r0/xdatahub/i18n/ui?locale=" + encodeURIComponent(locale))
        .then(function (r) { return r.ok ? r.json() : {}; })
        .then(function (data) {
            i18nCache[locale] = (data && data.dict) ? data.dict : {};
            return i18nCache[locale];
        })
        .catch(function () { return {}; });
}

function loadLocaleBundle(locale) {
    var normalized = (locale === "zh" || locale === "zh-CN" || locale === "zh-TW") ? "zh" : "en";
    return Promise.all([fetchI18n("en"), fetchI18n(normalized)]).then(function (results) {
        uiLocaleFallback = results[0];
        uiLocalePrimary = normalized === "en" ? results[0] : results[1];
        return normalized;
    });
}

function applyUiLocale(localeOverride) {
    var loc = localeOverride || resolveComfyLocale();
    return loadLocaleBundle(loc).then(function () {
        currentUiLocale = loc;
        refreshAllPanelLocales();
    });
}

function resolveComfyLocale() {
    try {
        var val = app.extensionManager
            && app.extensionManager.setting
            && app.extensionManager.setting.get
            && app.extensionManager.setting.get(COMFY_LOCALE_KEY_I18N);
        if (val) return val;
    } catch (e) { /* fall through */ }
    try {
        var ls = localStorage.getItem(COMFY_LOCALE_KEY_I18N);
        if (ls) return ls;
    } catch (e) { /* fall through */ }
    if (document.documentElement && document.documentElement.lang) {
        return document.documentElement.lang;
    }
    return navigator.language || "en";
}

function refreshAllPanelLocales() {
    for (var nodeId in compareStates) {
        if (compareStates.hasOwnProperty(nodeId)) {
            applyNodeLocale(compareStates[nodeId]);
        }
    }
}

function applyNodeLocale(state) {
    if (!state || !state.modeButtons) return;

    // 模式按钮文字
    var modeNames = [
        t(MODE_SLIDE_KEY, MODE_SLIDE_FB),
        t(MODE_SPOTLIGHT_KEY, MODE_SPOTLIGHT_FB),
        t(MODE_BLEND_KEY, MODE_BLEND_FB),
        t(MODE_PINGPONG_KEY, MODE_PINGPONG_FB),
    ];
    for (var i = 0; i < state.modeButtons.length; i++) {
        state.modeButtons[i].textContent = modeNames[i];
    }

    // 曲线标签
    if (state.curveLabel) {
        state.curveLabel.textContent = t(CURVE_LABEL_KEY, CURVE_LABEL_FB);
    }
    // 滚轮开关文字
    if (state.wheelToggle) {
        state.wheelToggle.textContent = t(WHEEL_CTRL_KEY, WHEEL_CTRL_FB);
        state.wheelToggle.title = t(WHEEL_CTRL_TIP_KEY, WHEEL_CTRL_TIP_FB);
    }

    // 曲线按钮文字
    if (state.curveButtons) {
        for (var ci = 0; ci < state.curveButtons.length; ci++) {
            state.curveButtons[ci].textContent = t(
                PINGPONG_CURVES[ci].key,
                PINGPONG_CURVES[ci].name
            );
            state.curveButtons[ci].title = t(
                PINGPONG_CURVES[ci].tipKey,
                PINGPONG_CURVES[ci].tipFB
            );
        }
    }

    // 滑动方向按钮（固定文字，不随方向变化）
    if (state.slideDirBtn) {
        state.slideDirBtn.textContent = t(SLIDE_DIR_TOGGLE_KEY, SLIDE_DIR_TOGGLE_FB);
        state.slideDirBtn.title = t(SLIDE_DIR_TOGGLE_TIP_KEY, SLIDE_DIR_TOGGLE_TIP_FB);
    }

    // 控制标签
    updateCtrlLabel(state);

    // 占位文字
    if (state.placeholder && !state.loaded) {
        state.placeholder.textContent = t(PLACEHOLDER_KEY, PLACEHOLDER_FB);
    }

    // 分辨率标签 — 更新格式前缀
    if (state.loaded && state.resALabel) {
        state.resALabel.textContent = state._rawResA
            ? t(RES_A_KEY, RES_A_FB) + " [" + state._rawResA + "]"
            : t(RES_A_KEY, RES_A_FB) + " [--]";
    }
    if (state.loaded && state.resBLabel) {
        state.resBLabel.textContent = state._rawResB
            ? t(RES_B_KEY, RES_B_FB) + " [" + state._rawResB + "]"
            : t(RES_B_KEY, RES_B_FB) + " [--]";
    }
}

function installLocaleSync() {
    if (localeSyncInstalled) return;
    localeSyncInstalled = true;

    var refreshLocale = function () {
        applyUiLocale().catch(function () {});
    };

    // 监听 ComfyUI 设置变更
    try {
        var setting = app.extensionManager && app.extensionManager.setting;
        if (setting && typeof setting.set === "function"
            && !setting.__xcompareLocaleHookInstalled) {
            var origSet = setting.set.bind(setting);
            setting.set = function () {
                var result = origSet.apply(this, arguments);
                if (String(arguments[0] || "") === COMFY_LOCALE_KEY_I18N) {
                    Promise.resolve(result).finally(refreshLocale);
                }
                return result;
            };
            setting.__xcompareLocaleHookInstalled = true;
        }
    } catch (e) { /* ignore */ }

    // 轮询兜底
    window.setInterval(function () {
        if (document.hidden) return;
        var nextLocale = resolveComfyLocale();
        if (nextLocale !== currentUiLocale) {
            refreshLocale();
        }
    }, LOCALE_SYNC_INTERVAL);
}

// =========================================================================
// 清除标准 ComfyUI 图片预览
// =========================================================================

function clearStandardPreview(node) {
    if (!node) return;
    delete node.images;
    delete node.imgs;
    node.imageIndex = null;

    if (Array.isArray(node.widgets)) {
        for (var i = node.widgets.length - 1; i >= 0; i--) {
            var w = node.widgets[i];
            if (w && w.name === "$$canvas-image-preview") {
                if (typeof w.onRemove === "function") {
                    w.onRemove();
                }
                node.widgets.splice(i, 1);
            }
        }
    }

    if (node.graph && typeof node.graph.setDirtyCanvas === "function") {
        node.graph.setDirtyCanvas(true, true);
    }
}

// =========================================================================
// URL 构建
// =========================================================================

function buildViewUrl(imgInfo) {
    var params = new URLSearchParams({
        filename: imgInfo.filename,
        type: imgInfo.type || "output",
    });
    if (imgInfo.subfolder) {
        params.set("subfolder", imgInfo.subfolder);
    }
    return "/api/view?" + params.toString();
}

// =========================================================================
// 隐藏 widget（参照 XImageGet2 ensureHiddenWidget + removeStorageInputSlot）
// =========================================================================

var HIDDEN_WIDGET_NAMES = [
    "__compare_mode", "__compare_slider",
    "__img_a_info", "__img_b_info",
    "__compare_curve",
    "__compare_wheel_ctrl",
    "__compare_slide_dir",
];

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
    var widget = null;
    for (var i = 0; i < node.widgets.length; i++) {
        if (node.widgets[i] && node.widgets[i].name === name) {
            widget = node.widgets[i];
            break;
        }
    }
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

function removeHiddenInputSlots(node) {
    if (!node || !Array.isArray(node.inputs)) return;
    var nameSet = {};
    for (var i = 0; i < HIDDEN_WIDGET_NAMES.length; i++) {
        nameSet[HIDDEN_WIDGET_NAMES[i]] = true;
    }
    var filtered = [];
    for (var j = 0; j < node.inputs.length; j++) {
        var inp = node.inputs[j];
        if (!inp || !nameSet[String(inp.name || "")]) {
            filtered.push(inp);
        }
    }
    if (filtered.length !== node.inputs.length) {
        node.inputs = filtered;
        if (node.graph && typeof node.graph.setDirtyCanvas === "function") {
            node.graph.setDirtyCanvas(true, true);
        }
    }
}

// =========================================================================
// CSS 注入
// =========================================================================

function injectStyles() {
    if (document.getElementById("xcompare-styles")) return;

    var style = document.createElement("style");
    style.id = "xcompare-styles";
    style.textContent = [
        ".xcompare-wrap {",
        "  position: relative;",
        "  width: 100%; height: 100%;",
        "  display: flex; flex-direction: column;",
        "  box-sizing: border-box;",
        "  background: transparent;",
        "  color: var(--input-text, inherit);",
        "  overflow: hidden;",
        "}",
        ".xcompare-toolbar {",
        "  display: flex; flex-direction: column; gap: 2px;",
        "  padding: 4px 0 2px 0;",
        "  background: transparent;",
        "  border-bottom: none;",
        "  flex-shrink: 0; box-sizing: border-box;",
        "}",
        ".xcompare-toolbar-row {",
        "  display: flex; align-items: center; gap: 4px;",
        "  padding: 0 6px;",
        "}",
        ".xcompare-toolbar-row.xcompare-label-row {",
        "  margin-bottom: 3px; position: relative;",
        "  min-height: 26px;",
        "}",
        ".xcompare-toolbar-row.xcompare-buttons-row {",
        "  justify-content: center;",
        "}",
        ".xcompare-toolbar-row.xcompare-slider-row {",
        "  padding: 4px 0;",
        "}",
        ".xcompare-toolbar button {",
        "  padding: 3px 8px;",
        "  border: 1px solid var(--border-color, #555);",
        "  border-radius: var(--xdh-radius-sm, 3px); cursor: pointer;",
        "  background: transparent;",
        "  color: inherit;",
        "  font: var(--xdh-font-micro-label, 11px sans-serif);",
        "  white-space: nowrap;",
        "  transition: border-color 120ms ease, background-color 120ms ease;",
        "  flex: 0 0 auto;",
        "}",
        ".xcompare-toolbar button:hover {",
        "  border-color: var(--xdh-clr-primary, #ff385c);",
        "}",
        ".xcompare-toolbar button.active {",
        "  background: var(--xdh-clr-primary, #ff385c);",
        "  color: #fff;",
        "  border-color: var(--xdh-clr-primary, #ff385c);",
        "}",
        ".xcompare-toolbar input[type=\"range\"] {",
        "  --xcompare-slider-pct: 50%;",
        "  flex: 1; min-width: 60px; height: 18px; cursor: pointer;",
        "  margin: 0; -webkit-appearance: none; appearance: none;",
        "  background: transparent; outline: none;",
        "  accent-color: var(--xdh-clr-primary, #ff385c);",
        "}",
        ".xcompare-toolbar input[type=\"range\"]::-webkit-slider-runnable-track {",
        "  height: 6px; border-radius: 999px;",
        "  background: linear-gradient(90deg,",
        "    var(--xdh-clr-primary, #ff385c) 0%,",
        "    var(--xdh-clr-primary, #ff385c) var(--xcompare-slider-pct),",
        "    rgba(255, 255, 255, 0.16) var(--xcompare-slider-pct),",
        "    rgba(255, 255, 255, 0.16) 100%);",
        "  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.08);",
        "}",
        ".xcompare-toolbar input[type=\"range\"]::-moz-range-track {",
        "  height: 6px; border-radius: 999px;",
        "  background: rgba(255, 255, 255, 0.16); border: none;",
        "  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.08);",
        "}",
        ".xcompare-toolbar input[type=\"range\"]::-moz-range-progress {",
        "  height: 6px; border-radius: 999px;",
        "  background: var(--xdh-clr-primary, #ff385c); border: none;",
        "}",
        ".xcompare-toolbar input[type=\"range\"]::-webkit-slider-thumb {",
        "  -webkit-appearance: none; appearance: none;",
        "  width: 14px; height: 14px; border-radius: 50%;",
        "  margin-top: -4px;",
        "  background: color-mix(in srgb, var(--xdh-clr-primary, #ff385c) 88%, white 12%);",
        "  border: 1px solid rgba(255, 255, 255, 0.55);",
        "  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.28);",
        "  transition: transform 120ms ease, box-shadow 120ms ease, background-color 120ms ease;",
        "  cursor: pointer;",
        "}",
        ".xcompare-toolbar input[type=\"range\"]::-moz-range-thumb {",
        "  width: 14px; height: 14px; border-radius: 50%;",
        "  background: color-mix(in srgb, var(--xdh-clr-primary, #ff385c) 88%, white 12%);",
        "  border: 1px solid rgba(255, 255, 255, 0.55);",
        "  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.28);",
        "  transition: transform 120ms ease, box-shadow 120ms ease, background-color 120ms ease;",
        "  cursor: pointer;",
        "}",
        ".xcompare-toolbar input[type=\"range\"]:hover::-webkit-slider-runnable-track {",
        "  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.12);",
        "}",
        ".xcompare-toolbar input[type=\"range\"]:hover::-moz-range-track {",
        "  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.12);",
        "}",
        ".xcompare-toolbar input[type=\"range\"]:hover::-webkit-slider-thumb {",
        "  transform: scale(1.08);",
        "  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.32);",
        "}",
        ".xcompare-toolbar input[type=\"range\"]:hover::-moz-range-thumb {",
        "  transform: scale(1.08);",
        "  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.32);",
        "}",
        ".xcompare-toolbar input[type=\"range\"]:active::-webkit-slider-thumb {",
        "  transform: scale(1.12);",
        "  box-shadow: 0 0 0 4px rgba(255, 56, 92, 0.15), 0 2px 8px rgba(0, 0, 0, 0.34);",
        "}",
        ".xcompare-toolbar input[type=\"range\"]:active::-moz-range-thumb {",
        "  transform: scale(1.12);",
        "  box-shadow: 0 0 0 4px rgba(255, 56, 92, 0.15), 0 2px 8px rgba(0, 0, 0, 0.34);",
        "}",
        ".xcompare-toolbar input[type=\"range\"]:focus-visible::-webkit-slider-thumb {",
        "  box-shadow: 0 0 0 4px rgba(255, 56, 92, 0.18), 0 2px 8px rgba(0, 0, 0, 0.34);",
        "}",
        ".xcompare-toolbar input[type=\"range\"]:focus-visible::-moz-range-thumb {",
        "  box-shadow: 0 0 0 4px rgba(255, 56, 92, 0.18), 0 2px 8px rgba(0, 0, 0, 0.34);",
        "}",
        ".xcompare-toolbar-label {",
        "  font: var(--xdh-font-caption-sm, 10px sans-serif);",
        "  color: inherit;",
        "  opacity: 0.78;",
        "  white-space: nowrap; text-align: center;",
        "  position: absolute; left: 50%; transform: translateX(-50%);",
        "}",
        ".xcompare-toolbar-res-a {",
        "  font: var(--xdh-font-caption-sm, 10px sans-serif);",
        "  color: inherit;",
        "  opacity: 0.72;",
        "  white-space: nowrap;",
        "}",
        ".xcompare-toolbar-res-b {",
        "  font: var(--xdh-font-caption-sm, 10px sans-serif);",
        "  color: inherit;",
        "  opacity: 0.72;",
        "  white-space: nowrap;",
        "}",
        ".xcompare-res-group {",
        "  display: flex; align-items: center; gap: 4px;",
        "}",
        ".xcompare-match-dot {",
        "  width: 7px; height: 7px; border-radius: 50%;",
        "  flex-shrink: 0;",
        "}",
        ".xcompare-curve-group {",
        "  display: flex; align-items: center; gap: 3px;",
        "  margin-left: auto;",
        "}",
        ".xcompare-curve-btn {",
        "  padding: 3px 6px;",
        "  border: 1px solid var(--border-color, #555);",
        "  border-radius: var(--xdh-radius-sm, 3px);",
        "  cursor: pointer;",
        "  background: transparent;",
        "  color: inherit;",
        "  font: var(--xdh-font-micro-label, 11px sans-serif);",
        "  white-space: nowrap;",
        "  transition: border-color 120ms ease, background-color 120ms ease;",
        "}",
        ".xcompare-curve-btn:hover {",
        "  border-color: var(--xdh-clr-primary, #ff385c);",
        "}",
        ".xcompare-curve-label {",
        "  font: var(--xdh-font-micro-label, 11px sans-serif);",
        "  color: inherit;",
        "  opacity: 0.72;",
        "  white-space: nowrap;",
        "  margin-right: 4px;",
        "}",
        ".xcompare-curve-btn.active {",
        "  background: var(--xdh-clr-primary, #ff385c);",
        "  color: #fff;",
        "  border-color: var(--xdh-clr-primary, #ff385c);",
        "}",
        ".xcompare-canvas-wrap {",
        "  position: relative; overflow: hidden;",
        "  background: transparent;",
        "  cursor: crosshair;",
        "  flex: 1 1 0;",
        "  box-sizing: border-box;",
        "  margin-bottom: 16px;",
        "}",
        ".xcompare-canvas-wrap canvas {",
        "  display: block;",
        "  position: absolute; top: 0; left: 0;",
        "  width: 100%; height: 100%;",
        "  box-sizing: border-box;",
        "}",
        ".xcompare-placeholder {",
        "  position: absolute; inset: 0;",
        "  display: flex; align-items: center; justify-content: center;",
        "  font: var(--xdh-font-caption-sm, 13px sans-serif);",
        "  color: inherit;",
        "  opacity: 0.6;",
        "  pointer-events: none; z-index: 1;",
        "}",
    ].join("\n");
    document.head.appendChild(style);
}

// =========================================================================
// CompareState — 每个节点实例的状态
// =========================================================================

function createCompareState(node) {
    return {
        node: node,
        canvas: null,
        ctx: null,
        wrap: null,
        mode: MODE.SLIDE,
        imageA: null,
        imageB: null,
        imgW: DEFAULT_CW,
        imgH: DEFAULT_CH,
        slidePos: DEFAULT_SLIDE_POS,
        slideDirection: DEFAULT_SLIDE_DIR,
        spotRadius: DEFAULT_SPOT_RADIUS,
        blendOpacity: DEFAULT_BLEND_OPACITY,
        pingPongSpeed: DEFAULT_PINGPONG_SPEED,
        pingPongCurve: CURVE_DEFAULT,
        wheelControlEnabled: false,
        dragging: false,
        dragStartX: 0,
        _spotBufPt: null,
        animFrameId: null,
        animStart: 0,
        loaded: false,
        loadToken: 0,
        _previewBlobUrl: null, // 上游实时预览 blob URL
        _previewOverlay: null,  // 预览覆盖层 DOM 元素
        _previewDone: false,    // 该节点已完成执行，不再接收预览
        livePreviewEnabled: false, // 实时预览开关（默认关闭）
    };
}

// =========================================================================
// 居中 — 图片始终 fit 画布最大化显示
// 使用 canvas.width/height（缓冲像素）统一所有计算，
// 鼠标坐标通过 canvas.width / rect.width 缩放因子转换（参照 mask-editor）
// =========================================================================

/** 读取当前主题背景色 */
function getCanvasBg(state) {
    if (!state.wrap) return "#1a1a1a";
    var cs = getComputedStyle(state.wrap);
    var bg = cs.getPropertyValue("--comfy-menu-bg").trim();
    return bg || "#1a1a1a";
}

/** 当前 fit 缩放比例（基于缓冲像素） */
function currentScale(state) {
    if (!state.imgW || !state.imgH) return 1;
    if (!state.canvas) return 1;
    var bw = state.canvas.width;
    var bh = state.canvas.height;
    if (bw <= 0 || bh <= 0) return 1;
    return Math.min(bw / state.imgW, bh / state.imgH);
}

/** 居中偏移量（缓冲像素） */
function getCenteredOffset(state) {
    if (!state.canvas) return { x: 0, y: 0 };
    var s = currentScale(state);
    var bw = state.canvas.width;
    var bh = state.canvas.height;
    return {
        x: (bw - state.imgW * s) / 2,
        y: (bh - state.imgH * s) / 2,
    };
}

/** CSS 坐标 → 缓冲像素坐标（参照 mask-editor getDisplayPoint） */
function cssToBuffer(state, cssX, cssY) {
    var rect = state.canvas.getBoundingClientRect();
    var sx = state.canvas.width / Math.max(rect.width, 1);
    var sy = state.canvas.height / Math.max(rect.height, 1);
    return {
        x: (cssX - rect.left) * sx,
        y: (cssY - rect.top) * sy,
    };
}

/** 缓冲像素坐标 → 图像坐标 */
function bufferToImage(state, bx, by) {
    var s = currentScale(state);
    var off = getCenteredOffset(state);
    return {
        x: (bx - off.x) / s,
        y: (by - off.y) / s,
    };
}

/** 图像坐标 → 缓冲像素坐标 */
function imageToBuffer(state, ix, iy) {
    var s = currentScale(state);
    var off = getCenteredOffset(state);
    return {
        x: ix * s + off.x,
        y: iy * s + off.y,
    };
}

// =========================================================================
// Canvas 渲染 — 纯缓冲像素空间，无 DPR 变换
// =========================================================================

function render(state) {
    var canvas = state.canvas;
    if (!canvas) return;

    var ctx = state.ctx;
    if (!ctx) return;

    // 取 CSS 尺寸，设为缓冲像素尺寸（无 DPR 放大，避免精度问题）
    var rect = canvas.getBoundingClientRect();
    var bw = Math.floor(rect.width);
    var bh = Math.floor(rect.height);
    if (bw <= 0 || bh <= 0) return;

    if (canvas.width !== bw || canvas.height !== bh) {
        canvas.width = bw;
        canvas.height = bh;
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, bw, bh);

    if (!state.imageA && !state.imageB) {
        return;
    }

    var hasBoth = state.imageA && state.imageB;
    var s = currentScale(state);
    var off = getCenteredOffset(state);

    ctx.save();
    ctx.translate(off.x, off.y);
    ctx.scale(s, s);

    var iw = state.imgW;
    var ih = state.imgH;

    if (!hasBoth) {
        // 仅显示单张图片
        var singleImg = state.imageA || state.imageB;
        var r = getContainRect(singleImg, iw, ih);
        ctx.drawImage(singleImg, r.x, r.y, r.w, r.h);
    } else {
        switch (state.mode) {
        case MODE.SLIDE:
            renderSlide(state, ctx, iw, ih);
            break;
        case MODE.SPOTLIGHT:
            renderSpotlight(state, ctx, iw, ih);
            break;
        case MODE.BLEND:
        case MODE.PINGPONG:
            renderBlend(state, ctx, iw, ih);
            break;
        }
    }

    ctx.restore();

    if (hasBoth) {
        renderOverlay(state, ctx, bw, bh, off);
    }
}

/** 计算 contain 尺寸 + 居中偏移 */
function getContainRect(img, maxW, maxH) {
    var s = Math.min(maxW / img.naturalWidth, maxH / img.naturalHeight);
    return {
        w: Math.round(img.naturalWidth * s),
        h: Math.round(img.naturalHeight * s),
        x: Math.round((maxW - img.naturalWidth * s) / 2),
        y: Math.round((maxH - img.naturalHeight * s) / 2),
    };
}

function renderSlide(state, ctx, iw, ih) {
    var imgs = getDisplayImages(state);
    var rA = getContainRect(imgs[0], iw, ih);
    var rB = getContainRect(imgs[1], iw, ih);
    var split = (state.slidePos / 100) * (state.slideDirection === SLIDE_DIR_H ? iw : ih);

    if (state.slideDirection === SLIDE_DIR_H) {
        // 水平（横向）分割
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, 0, split, ih);
        ctx.clip();
        ctx.drawImage(imgs[0], rA.x, rA.y, rA.w, rA.h);
        ctx.restore();

        ctx.save();
        ctx.beginPath();
        ctx.rect(split, 0, iw - split, ih);
        ctx.clip();
        ctx.drawImage(imgs[1], rB.x, rB.y, rB.w, rB.h);
        ctx.restore();
    } else {
        // 垂直（纵向）分割
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, 0, iw, split);
        ctx.clip();
        ctx.drawImage(imgs[0], rA.x, rA.y, rA.w, rA.h);
        ctx.restore();

        ctx.save();
        ctx.beginPath();
        ctx.rect(0, split, iw, ih - split);
        ctx.clip();
        ctx.drawImage(imgs[1], rB.x, rB.y, rB.w, rB.h);
        ctx.restore();
    }
}

function renderSpotlight(state, ctx, iw, ih) {
    var imgs = getDisplayImages(state);
    var rA = getContainRect(imgs[0], iw, ih);
    var rB = getContainRect(imgs[1], iw, ih);

    ctx.drawImage(imgs[0], rA.x, rA.y, rA.w, rA.h);

    var bp = state._spotBufPt;
    if (!bp) return;

    var imgPt = bufferToImage(state, bp.x, bp.y);
    var cx = imgPt.x;
    var cy = imgPt.y;

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, state.spotRadius, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(imgs[1], rB.x, rB.y, rB.w, rB.h);
    ctx.restore();
}

function renderBlend(state, ctx, iw, ih) {
    var imgs = getDisplayImages(state);
    var rA = getContainRect(imgs[0], iw, ih);
    var rB = getContainRect(imgs[1], iw, ih);

    var opacity;
    if (state.mode === MODE.PINGPONG) {
        opacity = getPingPongOpacity(state);
    } else {
        opacity = state.blendOpacity / 100;
    }

    ctx.drawImage(imgs[0], rA.x, rA.y, rA.w, rA.h);

    ctx.save();
    ctx.globalAlpha = opacity;
    ctx.drawImage(imgs[1], rB.x, rB.y, rB.w, rB.h);
    ctx.restore();
}

function renderOverlay(state, ctx, bw, bh, off) {
    if (state.mode === MODE.SLIDE) {
        if (state.slideDirection === SLIDE_DIR_H) {
            // 水平分割线（竖线）
            var splitX = (state.slidePos / 100) * state.imgW;
            var line = imageToBuffer(state, splitX, 0);

            ctx.save();
            ctx.globalCompositeOperation = "difference";
            ctx.strokeStyle = "#fff";
            ctx.lineWidth = 1;
            ctx.setLineDash([]);
            ctx.beginPath();
            ctx.moveTo(line.x, 0);
            ctx.lineTo(line.x, bh);
            ctx.stroke();
            ctx.restore();
        } else {
            // 垂直分割线（横线）
            var splitY = (state.slidePos / 100) * state.imgH;
            var line = imageToBuffer(state, 0, splitY);

            ctx.save();
            ctx.globalCompositeOperation = "difference";
            ctx.strokeStyle = "#fff";
            ctx.lineWidth = 1;
            ctx.setLineDash([]);
            ctx.beginPath();
            ctx.moveTo(0, line.y);
            ctx.lineTo(bw, line.y);
            ctx.stroke();
            ctx.restore();
        }
    }

    if (state.mode === MODE.SPOTLIGHT) {
        var bp = state._spotBufPt;
        if (!bp) return;
        var r = state.spotRadius * currentScale(state);

        // 细反色线 — difference 混合模式，不显示十字
        ctx.save();
        ctx.globalCompositeOperation = "difference";
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 1;
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.arc(bp.x, bp.y, r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
    }
}

// =========================================================================
// 乒乓周期映射
// =========================================================================

function getPingPongPeriod(speed) {
    return 8.0 - (speed / 100) * 7.5;
}

// =========================================================================
// 乒乓曲线 — 4 种可选动画曲线
// =========================================================================

/** 根据当前曲线计算乒乓透明度 [0, 1] */
function getPingPongOpacity(state) {
    var elapsed = (performance.now() - state.animStart) / 1000;
    var period = getPingPongPeriod(state.pingPongSpeed);
    var t = ((elapsed % period) / period); // 归一化相位 [0, 1)
    var curve = state.pingPongCurve;

    switch (curve) {
    case CURVE_SINE:
        // 对称正弦 sin²(πt) — A/B 视觉时间相等
        return 0.5 * (1 - Math.cos(2 * Math.PI * t));

    case CURVE_EASED:
        // 对称正弦基础上施加 smoothstep，两端更平、中间更快
        var v = 0.5 * (1 - Math.cos(2 * Math.PI * t));
        return v * v * (3 - 2 * v);

    case CURVE_HOLD:
        // 两端保持：30% 保持 A → 25% 升至 B → 20% 保持 B → 25% 降至 A
        return evalHoldCurve(t, 0.15, 0.10);

    case CURVE_LONG_HOLD:
        // 两端保持：40% 保持 A → 15% 升至 B → 30% 保持 B → 15% 降至 A
        return evalHoldCurve(t, 0.20, 0.15);

    default:
        return Math.abs(Math.sin(t * Math.PI));
    }
}

/** 分段保持曲线：t∈[0,1)，holdA=两端保持 A 的比例，holdB=两端保持 B 的比例 */
function evalHoldCurve(t, holdA, holdB) {
    if (t <= holdA) return 0;                 // hold at A
    if (t >= 1 - holdA) return 0;             // hold at A (wrap)

    var mid = 0.5;
    if (t >= mid - holdB && t <= mid + holdB) return 1; // hold at B

    var riseLen = mid - holdB - holdA;         // 上升/下降单段时长
    if (t < mid) {
        // 上升：A 保持区 → B 保持区
        var p = (t - holdA) / riseLen;
        return p * p * (3 - 2 * p);
    } else {
        // 下降：B 保持区 → A 保持区
        var p = (t - (mid + holdB)) / riseLen;
        return 1 - p * p * (3 - 2 * p);
    }
}

// =========================================================================
// 动画循环
// =========================================================================

function startPingPong(state) {
    if (state.animFrameId !== null) return;
    state.animStart = performance.now();

    function loop() {
        if (state.mode !== MODE.PINGPONG) {
            state.animFrameId = null;
            return;
        }
        render(state);
        state.animFrameId = requestAnimationFrame(loop);
    }
    state.animFrameId = requestAnimationFrame(loop);
}

function stopPingPong(state) {
    if (state.animFrameId !== null) {
        cancelAnimationFrame(state.animFrameId);
        state.animFrameId = null;
    }
}

// =========================================================================
// 参数滑块配置
// =========================================================================

function getSliderConfig(mode, state) {
    switch (mode) {
    case MODE.SLIDE:
        return { min: 0, max: 100 };
    case MODE.SPOTLIGHT:
        return getSpotlightRange(state);
    case MODE.BLEND:
        return { min: 0, max: 100 };
    case MODE.PINGPONG:
        return { min: 0, max: 100 };
    default:
        return { min: 0, max: 100 };
    }
}

/** 聚光圈范围基于图像对角线自动缩放 */
function getSpotlightRange(state) {
    var diag = Math.sqrt(
        state.imgW * state.imgW + state.imgH * state.imgH
    ) || 500;
    return {
        min: Math.round(diag * 0.03),
        max: Math.round(diag * 0.6),
    };
}

function clampSpotRadius(state, val) {
    var range = getSpotlightRange(state);
    return Math.max(range.min, Math.min(range.max, val));
}

/** 返回当前 swap 状态下应显示的 [图A, 图B] */
function getDisplayImages(state) {
    if (!state.imageA && !state.imageB) return [null, null];
    var swapW = findWidget(state.node, "swap_ab");
    if (swapW && swapW.value) {
        return [state.imageB, state.imageA];
    }
    return [state.imageA, state.imageB];
}

// =========================================================================
// UI 构建
// =========================================================================

function createCompareUI(node) {
    if (node.__xcompareState) return;

    var state = createCompareState(node);
    node.__xcompareState = state;
    compareStates[String(node.id)] = state;

    // 容器
    var wrap = document.createElement("div");
    wrap.className = "xcompare-wrap";
    state.wrap = wrap;

    // --- 工具栏（3行） ---
    var toolbar = document.createElement("div");
    toolbar.className = "xcompare-toolbar";

    // 第1行：实时预览开关（最左）+ 模式按钮（居中）+ 滚轮控制开关（靠右）
    var row1 = document.createElement("div");
    row1.className = "xcompare-toolbar-row xcompare-buttons-row";
    row1.style.position = "relative";

    // 实时预览开关按钮（最左侧，绝对定位）
    var livePreviewBtn = document.createElement("button");
    livePreviewBtn.className = "xcompare-live-preview-btn";
    livePreviewBtn.textContent = t(LIVE_PREVIEW_KEY, LIVE_PREVIEW_FB);
    livePreviewBtn.title = t(LIVE_PREVIEW_TIP_KEY, LIVE_PREVIEW_TIP_FB);
    livePreviewBtn.style.cssText =
        "position:absolute;left:6px;top:50%;transform:translateY(-50%);" +
        "padding:3px 6px;font:var(--xdh-font-micro-label, 11px sans-serif);";
    livePreviewBtn.addEventListener("click", function () {
        toggleLivePreview(state);
    });
    row1.appendChild(livePreviewBtn);
    state.livePreviewBtn = livePreviewBtn;

    var modeNames = [
        t(MODE_SLIDE_KEY, MODE_SLIDE_FB),
        t(MODE_SPOTLIGHT_KEY, MODE_SPOTLIGHT_FB),
        t(MODE_BLEND_KEY, MODE_BLEND_FB),
        t(MODE_PINGPONG_KEY, MODE_PINGPONG_FB),
    ];
    var modeButtons = [];
    for (var m = 0; m < MODE_COUNT; m++) {
        var btn = document.createElement("button");
        btn.textContent = modeNames[m];
        btn.setAttribute("data-mode", String(m));
        btn.addEventListener("click", (function (mode) {
            return function () { setMode(state, mode); };
        })(m));
        row1.appendChild(btn);
        modeButtons.push(btn);
    }
    state.modeButtons = modeButtons;

    // 画布悬停滚轮控制开关（第一行靠右）
    var wheelToggle = document.createElement("button");
    wheelToggle.textContent = t(WHEEL_CTRL_KEY, WHEEL_CTRL_FB);
    wheelToggle.title = t(WHEEL_CTRL_TIP_KEY, WHEEL_CTRL_TIP_FB);
    wheelToggle.style.cssText = "position:absolute;right:6px;top:50%;transform:translateY(-50%);padding:3px 6px;font:var(--xdh-font-micro-label, 11px sans-serif);";
    wheelToggle.addEventListener("click", function () {
        toggleWheelCtrl(state);
    });
    row1.appendChild(wheelToggle);
    state.wheelToggle = wheelToggle;

    // 曲线选择按钮组（靠右，仅在 PINGPONG 模式显示）
    var curveGroup = document.createElement("span");
    curveGroup.className = "xcompare-curve-group";
    curveGroup.style.display = "none";
    // 曲线标签
    var curveLabel = document.createElement("span");
    curveLabel.className = "xcompare-curve-label";
    curveLabel.textContent = t(CURVE_LABEL_KEY, CURVE_LABEL_FB);
    curveGroup.appendChild(curveLabel);
    state.curveLabel = curveLabel;
    var curveButtons = [];
    for (var c = 0; c < CURVE_COUNT; c++) {
        var cBtn = document.createElement("button");
        cBtn.textContent = t(PINGPONG_CURVES[c].key, PINGPONG_CURVES[c].name);
        cBtn.className = "xcompare-curve-btn";
        cBtn.title = t(PINGPONG_CURVES[c].tipKey, PINGPONG_CURVES[c].tipFB);
        cBtn.addEventListener("click", (function (idx) {
            return function () { setCurve(state, idx); };
        })(c));
        curveGroup.appendChild(cBtn);
        curveButtons.push(cBtn);
    }
    state.curveButtons = curveButtons;
    state.curveGroup = curveGroup;

    toolbar.appendChild(row1);

    // 第2行：A + ● + B 靠左，控制标签居中
    var row2 = document.createElement("div");
    row2.className = "xcompare-toolbar-row xcompare-label-row";
    // 分辨率组（靠左）
    var resGroup = document.createElement("span");
    resGroup.className = "xcompare-res-group";
    var resA = document.createElement("span");
    resA.className = "xcompare-toolbar-res-a";
    resA.textContent = t(RES_A_KEY, RES_A_FB) + " [--]";
    state.resALabel = resA;
    resGroup.appendChild(resA);
    var matchDot = document.createElement("span");
    matchDot.className = "xcompare-match-dot";
    matchDot.style.display = "none";
    state.matchDot = matchDot;
    resGroup.appendChild(matchDot);
    var resB = document.createElement("span");
    resB.className = "xcompare-toolbar-res-b";
    resB.textContent = t(RES_B_KEY, RES_B_FB) + " [--]";
    state.resBLabel = resB;
    resGroup.appendChild(resB);
    row2.appendChild(resGroup);
    // 控制标签（居中）
    var ctrlLabel = document.createElement("span");
    ctrlLabel.className = "xcompare-toolbar-label";
    ctrlLabel.textContent = t(LABEL_SPLIT_KEY, LABEL_SPLIT_FB) + ": 50%";
    state.ctrlLabel = ctrlLabel;
    row2.appendChild(ctrlLabel);
    // 滑动方向切换按钮（靠右，仅 SLIDE 模式可见）
    var slideDirBtn = document.createElement("button");
    slideDirBtn.textContent = t(SLIDE_DIR_TOGGLE_KEY, SLIDE_DIR_TOGGLE_FB);
    slideDirBtn.title = t(SLIDE_DIR_TOGGLE_TIP_KEY, SLIDE_DIR_TOGGLE_TIP_FB);
    slideDirBtn.style.marginLeft = "auto";
    slideDirBtn.addEventListener("click", function () {
        toggleSlideDir(state);
    });
    state.slideDirBtn = slideDirBtn;

    // 曲线选择按钮组移到第2行靠右
    row2.appendChild(slideDirBtn);
    row2.appendChild(curveGroup);
    toolbar.appendChild(row2);

    // 第3行：参数滑块（padding=0 对齐画布宽度）
    var row3 = document.createElement("div");
    row3.className = "xcompare-toolbar-row xcompare-slider-row";
    var slider = document.createElement("input");
    slider.type = "range";
    slider.min = "0";
    slider.max = "100";
    slider.value = "50";
    slider.addEventListener("input", function () {
        onSliderChange(state, Number(slider.value));
    });
    slider.addEventListener("wheel", function (e) {
        onWheel(state, e);
    }, { passive: false });
    row3.appendChild(slider);
    state.slider = slider;
    toolbar.appendChild(row3);

    wrap.appendChild(toolbar);

    // --- Canvas 区域 ---
    var canvasWrap = document.createElement("div");
    canvasWrap.className = "xcompare-canvas-wrap";

    var canvas = document.createElement("canvas");
    canvas.style.display = "block";
    canvas.style.position = "absolute";
    canvas.style.top = "0";
    canvas.style.left = "0";
    canvas.style.width = "100%";
    canvas.style.height = "100%";

    var placeholder = document.createElement("div");
    placeholder.className = "xcompare-placeholder";
    placeholder.textContent = t(PLACEHOLDER_KEY, PLACEHOLDER_FB);
    state.placeholder = placeholder;

    canvasWrap.appendChild(placeholder);
    canvasWrap.appendChild(canvas);

    state.canvas = canvas;
    state.ctx = canvas.getContext("2d");

    // --- 实时预览覆盖层（透传鼠标事件，不影响原有交互） ---
    var previewOverlay = document.createElement("img");
    previewOverlay.className = "xcompare-preview-overlay";
    previewOverlay.style.cssText =
        "position:absolute;top:0;left:0;" +
        "width:100%;height:100%;" +
        "object-fit:contain;" +
        "pointer-events:none;" +
        "z-index:10;" +
        "display:none;" +
        "background:transparent;";
    canvasWrap.appendChild(previewOverlay);
    state._previewOverlay = previewOverlay;

    wrap.appendChild(canvasWrap);

    // --- 注册 DOM widget ---
    if (typeof node.addDOMWidget === "function") {
        node.addDOMWidget(WIDGET_NAME, "custom", wrap, {
            serialize: false,
        });
    }

    // --- 隐藏状态 widget（对标 XImageGet2 双向隐藏） ---
    ensureHiddenWidget(node, "__compare_mode", MODE.SLIDE);
    ensureHiddenWidget(node, "__compare_slider", "50");
    ensureHiddenWidget(node, "__compare_curve", CURVE_DEFAULT);
    ensureHiddenWidget(node, "__img_a_info", "");
    ensureHiddenWidget(node, "__img_b_info", "");
    removeHiddenInputSlots(node);

    // swap_ab 开关监听 — 切换时重绘
    var swapW = findWidget(node, "swap_ab");
    if (swapW) {
        var origSwapCb = swapW.callback;
        swapW.callback = function (val) {
            if (origSwapCb) origSwapCb.apply(this, arguments);
            render(state);
        };
    }

    // --- 尺寸/主题变化自动重绘（RAF 轮询） ---
    state._lastSizeW = 0;
    state._lastSizeH = 0;
    state._lastBgColor = "";
    function sizePollLoop() {
        if (!state.node || !state.canvas) return;
        var rect = state.canvas.getBoundingClientRect();
        var w = Math.floor(rect.width);
        var h = Math.floor(rect.height);
        var bg = getCanvasBg(state);
        if (w !== state._lastSizeW || h !== state._lastSizeH
            || bg !== state._lastBgColor) {
            state._lastSizeW = w;
            state._lastSizeH = h;
            state._lastBgColor = bg;
            render(state);
        }
        state._sizePollRaf = requestAnimationFrame(sizePollLoop);
    }
    state._sizePollRaf = requestAnimationFrame(sizePollLoop);

    // --- 事件绑定 ---
    bindCanvasEvents(state);

    // 中键拖拽平移画布 — 通过 LiteGraph Canvas API 直接转发真实事件
    (function(panel) {
        panel.addEventListener("pointerdown", function(e) {
            if (e.button !== 1) return;
            e.preventDefault();
            var cvs = app.canvas;
            if (!cvs || typeof cvs.processMouseDown !== "function") return;
            cvs.processMouseDown(e);
        });
        panel.addEventListener("pointermove", function(e) {
            if ((e.buttons & 4) !== 4) return;
            var cvs = app.canvas;
            if (!cvs || typeof cvs.processMouseMove !== "function") return;
            cvs.processMouseMove(e);
        });
        panel.addEventListener("pointerup", function(e) {
            if (e.button !== 1) return;
            var cvs = app.canvas;
            if (!cvs || typeof cvs.processMouseUp !== "function") return;
            cvs.processMouseUp(e);
        });
    })(state.wrap);

    // --- 初始状态 ---
    updateModeButtons(state);
    updateLivePreviewBtn(state);
    updateSlideDirBtn(state);
    updateSlider(state);
    render(state);

}

// =========================================================================
// 模式切换
// =========================================================================

function setMode(state, newMode) {
    if (state.mode === newMode) return;

    if (state.mode === MODE.PINGPONG) {
        stopPingPong(state);
    }

    state.mode = newMode;
    updateModeButtons(state);
    updateSlider(state);

    // spotlight 模式隐藏鼠标指针，避免遮挡中心点
    if (state.canvas) {
        state.canvas.style.cursor = newMode === MODE.SPOTLIGHT ? "none" : "crosshair";
    }

    render(state);

    if (newMode === MODE.PINGPONG && state.loaded) {
        startPingPong(state);
    }

    // 曲线按钮组仅 PINGPONG 模式可见
    if (state.curveGroup) {
        state.curveGroup.style.display = newMode === MODE.PINGPONG ? "" : "none";
    }

    // 滑动方向按钮仅 SLIDE 模式可见
    if (state.slideDirBtn) {
        state.slideDirBtn.style.display = newMode === MODE.SLIDE ? "" : "none";
    }

    saveState(state);
}

function updateModeButtons(state) {
    for (var i = 0; i < state.modeButtons.length; i++) {
        if (i === state.mode) {
            state.modeButtons[i].classList.add("active");
        } else {
            state.modeButtons[i].classList.remove("active");
        }
    }
}

/** 切换滚轮控制开关 */
function toggleWheelCtrl(state) {
    state.wheelControlEnabled = !state.wheelControlEnabled;
    updateWheelToggle(state);
    saveState(state);
}

function updateWheelToggle(state) {
    if (!state.wheelToggle) return;
    if (state.wheelControlEnabled) {
        state.wheelToggle.classList.add("active");
    } else {
        state.wheelToggle.classList.remove("active");
    }
}

/** 切换实时预览开关 */
function toggleLivePreview(state) {
    state.livePreviewEnabled = !state.livePreviewEnabled;
    updateLivePreviewBtn(state);
    saveState(state);
    if (!state.livePreviewEnabled && state._previewOverlay) {
        state._previewOverlay.style.display = "none";
    }
}

function updateLivePreviewBtn(state) {
    if (!state.livePreviewBtn) return;
    if (state.livePreviewEnabled) {
        state.livePreviewBtn.classList.add("active");
    } else {
        state.livePreviewBtn.classList.remove("active");
    }
}

/** 切换曲线并更新 UI */
function setCurve(state, curveIdx) {
    if (state.pingPongCurve === curveIdx) return;
    state.pingPongCurve = curveIdx;
    updateCurveButtons(state);
    updateCtrlLabel(state);

    // 切换曲线时重启动画，使过渡从新的起点开始
    if (state.mode === MODE.PINGPONG && state.loaded) {
        stopPingPong(state);
        startPingPong(state);
    } else {
        render(state);
    }

    saveState(state);
}

function updateCurveButtons(state) {
    if (!state.curveButtons) return;
    for (var i = 0; i < state.curveButtons.length; i++) {
        if (i === state.pingPongCurve) {
            state.curveButtons[i].classList.add("active");
        } else {
            state.curveButtons[i].classList.remove("active");
        }
    }
}

/** 切换滑动方向（横向/纵向） */
function toggleSlideDir(state) {
    if (state.mode !== MODE.SLIDE) return;
    state.slideDirection = state.slideDirection === SLIDE_DIR_H ? SLIDE_DIR_V : SLIDE_DIR_H;
    updateSlideDirBtn(state);
    render(state);
    saveState(state);
}

function updateSlideDirBtn(state) {
    // 按钮文字固定，无需随方向变化
    // 保留作为 hook 供后续状态相关更新使用
}

function updateSliderVisual(state) {
    if (!state || !state.slider) return;
    var min = Number(state.slider.min);
    var max = Number(state.slider.max);
    var val = Number(state.slider.value);
    if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) {
        state.slider.style.setProperty("--xcompare-slider-pct", "50%");
        return;
    }
    if (!Number.isFinite(val)) val = min;
    var pct = ((val - min) / (max - min)) * 100;
    pct = Math.max(0, Math.min(100, pct));
    state.slider.style.setProperty("--xcompare-slider-pct", pct + "%");
}

function updateSlider(state) {
    var cfg = getSliderConfig(state.mode, state);
    state.slider.min = String(cfg.min);
    state.slider.max = String(cfg.max);

    var val;
    switch (state.mode) {
    case MODE.SLIDE: val = state.slidePos; break;
    case MODE.SPOTLIGHT: val = state.spotRadius; break;
    case MODE.BLEND: val = state.blendOpacity; break;
    case MODE.PINGPONG: val = state.pingPongSpeed; break;
        default: val = 50;
    }
    state.slider.value = String(val);
    updateSliderVisual(state);
    updateCtrlLabel(state);
}

function updateCtrlLabel(state) {
    if (!state.ctrlLabel) return;
    var label, val;
    switch (state.mode) {
    case MODE.SLIDE:
        label = t(LABEL_SPLIT_KEY, LABEL_SPLIT_FB);
        val = Math.round(state.slidePos) + "%"; break;
    case MODE.SPOTLIGHT:
        label = t(LABEL_RADIUS_KEY, LABEL_RADIUS_FB);
        val = Math.round(state.spotRadius) + "px"; break;
    case MODE.BLEND:
        label = t(LABEL_OPACITY_KEY, LABEL_OPACITY_FB);
        val = Math.round(state.blendOpacity) + "%"; break;
    case MODE.PINGPONG:
        label = t(LABEL_SPEED_KEY, LABEL_SPEED_FB);
        val = Math.round(state.pingPongSpeed) + "%"; break;
    default:
        label = ""; val = "";
    }
    state.ctrlLabel.textContent = label + ": " + val;
}

// =========================================================================
// 滑块值变更
// =========================================================================

function onSliderChange(state, value) {
    switch (state.mode) {
    case MODE.SLIDE:
        state.slidePos = value;
        break;
    case MODE.SPOTLIGHT:
        state.spotRadius = clampSpotRadius(state, value);
        break;
    case MODE.BLEND:
        state.blendOpacity = value;
        break;
    case MODE.PINGPONG:
        state.pingPongSpeed = value;
        break;
    }
    updateSliderVisual(state);
    updateCtrlLabel(state);
    render(state);
    saveState(state);
}

// =========================================================================
// Canvas 事件处理 — 无平移，仅分割线拖拽 + 聚光跟踪
// =========================================================================

function bindCanvasEvents(state) {
    var canvas = state.canvas;
    if (!canvas) return;

    canvas.addEventListener("mousedown", function (e) {
        onMouseDown(state, e);
    });
    canvas.addEventListener("mousemove", function (e) {
        onMouseMove(state, e);
    });
    // 拖拽期间在 window 上跟踪鼠标，超出画布也能继续拖到底
    window.addEventListener("mousemove", function (e) {
        onWindowMouseMove(state, e);
    });
    window.addEventListener("mouseup", function () {
        onMouseUp(state);
    });
    canvas.addEventListener("mouseleave", function () {
        onMouseLeave(state);
    });
    canvas.addEventListener("contextmenu", function (e) {
        e.preventDefault();
    });
    // 永久 wheel 监听：开启时控制滑块，关闭时转发给 ComfyUI 主画布实现缩放
    canvas.addEventListener("wheel", function (e) {
        if (state.wheelControlEnabled) {
            e.preventDefault();
            onWheel(state, e);
        } else {
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
        }
    }, { passive: false });
}

function onMouseDown(state, e) {
    if (!state.loaded) return;
    if (e.button !== 0) return;

    if (state.mode === MODE.SLIDE) {
        // 任意位置左键单击立即移动分割线并进入拖拽模式
        var bp = cssToBuffer(state, e.clientX, e.clientY);
        var imgPt = bufferToImage(state, bp.x, bp.y);
        var maxDim = state.slideDirection === SLIDE_DIR_H ? state.imgW : state.imgH;
        var pos = state.slideDirection === SLIDE_DIR_H ? imgPt.x : imgPt.y;
        state.slidePos = Math.max(0, Math.min(100, (pos / maxDim) * 100));
        state.slider.value = String(Math.round(state.slidePos));
        updateSliderVisual(state);
        updateCtrlLabel(state);
        state.dragging = true;
        render(state);
        e.preventDefault();
    }
}

function onMouseMove(state, e) {
    var bp = cssToBuffer(state, e.clientX, e.clientY);
    // 暂存 buffer 坐标用于 spotlight overlay 渲染
    state._spotBufPt = bp;

    if (state.dragging && state.mode === MODE.SLIDE) {
        var imgPt = bufferToImage(state, bp.x, bp.y);
        var maxDim = state.slideDirection === SLIDE_DIR_H ? state.imgW : state.imgH;
        var pos = state.slideDirection === SLIDE_DIR_H ? imgPt.x : imgPt.y;
        state.slidePos = Math.max(0, Math.min(100, (pos / maxDim) * 100));
        state.slider.value = String(Math.round(state.slidePos));
        updateSliderVisual(state);
        updateCtrlLabel(state);
        render(state);
        return;
    }

    if (state.mode === MODE.SPOTLIGHT) {
        render(state);
    }
}

function onMouseUp(state) {
    if (state.dragging) {
        state.dragging = false;
        if (state.mode === MODE.SLIDE) {
            saveState(state);
        }
    }
}

/** 拖拽时 window 级 mousemove — 鼠标超出画布仍能继续拖动 */
function onWindowMouseMove(state, e) {
    if (!state.dragging) return;
    if (state.mode !== MODE.SLIDE) return;

    var bp = cssToBuffer(state, e.clientX, e.clientY);
    var imgPt = bufferToImage(state, bp.x, bp.y);
    var maxDim = state.slideDirection === SLIDE_DIR_H ? state.imgW : state.imgH;
    var pos = state.slideDirection === SLIDE_DIR_H ? imgPt.x : imgPt.y;
    state.slidePos = Math.max(0, Math.min(100, (pos / maxDim) * 100));
    state.slider.value = String(Math.round(state.slidePos));
    updateSliderVisual(state);
    updateCtrlLabel(state);
    render(state);
}

function onWheel(state, e) {
    e.preventDefault();
    var delta = e.deltaY > 0 ? -1 : 1;
    var step, val;
    switch (state.mode) {
    case MODE.SLIDE:
        step = 2; val = state.slidePos + delta * step;
        val = Math.max(0, Math.min(100, val));
        state.slidePos = val;
        break;
    case MODE.SPOTLIGHT:
        step = Math.max(1, Math.round(
            Math.sqrt(state.imgW * state.imgW + state.imgH * state.imgH) * 0.01
        ));
        state.spotRadius = clampSpotRadius(state, state.spotRadius + delta * step);
        break;
    case MODE.BLEND:
        step = 2; val = state.blendOpacity + delta * step;
        val = Math.max(0, Math.min(100, val));
        state.blendOpacity = val;
        break;
    case MODE.PINGPONG:
        step = 2; val = state.pingPongSpeed + delta * step;
        val = Math.max(0, Math.min(100, val));
        state.pingPongSpeed = val;
        break;
    }
    updateSlider(state);
    saveState(state);
    render(state);
}

function onMouseLeave(state) {
    state._spotBufPt = null;
    if (state.mode === MODE.SPOTLIGHT) {
        render(state);
    }
}

// =========================================================================
// 图像加载
// =========================================================================

function loadImages(state, urlA, urlB) {
    var token = (state.loadToken || 0) + 1;
    state.loadToken = token;

    var expectCount = (urlA ? 1 : 0) + (urlB ? 1 : 0);
    if (expectCount === 0) {
        state.imageA = null;
        state.imageB = null;
        state.loaded = false;
        if (state.placeholder) {
            state.placeholder.textContent = t(PLACEHOLDER_KEY, PLACEHOLDER_FB);
            state.placeholder.style.display = "";
        }
        return;
    }

    var imgA = urlA ? new Image() : null;
    var imgB = urlB ? new Image() : null;
    var loaded = 0;

    function onLoad() {
        loaded++;
        if (loaded === expectCount) {
            if (state.loadToken !== token) return;

            state.imageA = imgA;
            state.imageB = imgB;

            var wA = imgA ? imgA.naturalWidth : (imgB ? imgB.naturalWidth : 640);
            var hA = imgA ? imgA.naturalHeight : (imgB ? imgB.naturalHeight : 480);
            var wB = imgB ? imgB.naturalWidth : wA;
            var hB = imgB ? imgB.naturalHeight : hA;
            state.imgW = Math.min(wA, wB);
            state.imgH = Math.min(hA, hB);
            state.loaded = true;

            if (state.placeholder) {
                state.placeholder.style.display = "none";
            }

            if (state.resALabel) {
                state.resALabel.textContent = imgA
                    ? t(RES_A_KEY, RES_A_FB) + " [" + imgA.naturalWidth + "×" + imgA.naturalHeight + "]"
                    : t(RES_A_KEY, RES_A_FB) + " [--]";
                state._rawResA = imgA ? imgA.naturalWidth + "×" + imgA.naturalHeight : null;
            }
            if (state.resBLabel) {
                state.resBLabel.textContent = imgB
                    ? t(RES_B_KEY, RES_B_FB) + " [" + imgB.naturalWidth + "×" + imgB.naturalHeight + "]"
                    : t(RES_B_KEY, RES_B_FB) + " [--]";
                state._rawResB = imgB ? imgB.naturalWidth + "×" + imgB.naturalHeight : null;
            }
            if (state.matchDot) {
                if (imgA && imgB) {
                    var same = imgA.naturalWidth === imgB.naturalWidth
                        && imgA.naturalHeight === imgB.naturalHeight;
                    state.matchDot.style.background = same ? "#4ade80" : "#f87171";
                    state.matchDot.title = same
                        ? t(MATCH_OK_KEY, MATCH_OK_FB)
                        : t(MATCH_DIFF_KEY, MATCH_DIFF_FB);
                    state.matchDot.style.display = "";
                } else {
                    state.matchDot.style.display = "none";
                }
            }

            var newDiag = Math.sqrt(state.imgW * state.imgW + state.imgH * state.imgH);
            if (state._spotDiag !== newDiag) {
                state._spotDiag = newDiag;
                state.spotRadius = clampSpotRadius(state, Math.round(newDiag * 0.15));
            }
            updateSlider(state);
            updateCtrlLabel(state);

            render(state);

            if (state.node) {
                clearStandardPreview(state.node);
            }

            if (state.mode === MODE.PINGPONG && imgA && imgB) {
                startPingPong(state);
            }
        }
    }

    function onError() {
        loaded++;
        if (loaded === expectCount && state.loadToken === token) {
            if (state.placeholder) {
                state.placeholder.textContent = t(LOAD_FAILED_KEY, LOAD_FAILED_FB);
                state.placeholder.style.display = "";
            }
        }
    }

    if (imgA) {
        imgA.onload = onLoad;
        imgA.onerror = onError;
        imgA.src = urlA;
    }
    if (imgB) {
        imgB.onload = onLoad;
        imgB.onerror = onError;
        imgB.src = urlB;
    }
}

// =========================================================================
// 执行事件处理
// =========================================================================

function handleNodeExecuted(node, output) {
    var state = node.__xcompareState;
    if (!state) return;

    // 清理上游实时预览覆盖层 + 标记该节点已完成
    state._previewDone = true;
    if (state._previewBlobUrl) {
        URL.revokeObjectURL(state._previewBlobUrl);
        state._previewBlobUrl = null;
    }
    if (state._previewOverlay) {
        state._previewOverlay.style.display = "none";
    }

    var images = (output && output.images) ? output.images : [];
    // images[0]=A, images[1]=B（无 filename 表示空占位）
    var imgA = (images.length >= 1 && images[0] && images[0].filename) ? images[0] : null;
    var imgB = (images.length >= 2 && images[1] && images[1].filename) ? images[1] : null;

    var infoA = ensureHiddenWidget(node, "__img_a_info", "");
    var infoB = ensureHiddenWidget(node, "__img_b_info", "");
    if (infoA) infoA.value = imgA ? JSON.stringify(imgA) : "";
    if (infoB) infoB.value = imgB ? JSON.stringify(imgB) : "";

    if (imgA || imgB) {
        loadImages(state,
            imgA ? buildViewUrl(imgA) : null,
            imgB ? buildViewUrl(imgB) : null);
    }
}

// =========================================================================
// 状态持久化
// =========================================================================

function saveState(state) {
    var node = state.node;
    if (!node) return;

    var modeW = ensureHiddenWidget(node, "__compare_mode", MODE.SLIDE);
    if (modeW) modeW.value = state.mode;

    var sliderVal;
    switch (state.mode) {
    case MODE.SLIDE: sliderVal = state.slidePos; break;
    case MODE.SPOTLIGHT: sliderVal = state.spotRadius; break;
    case MODE.BLEND: sliderVal = state.blendOpacity; break;
    case MODE.PINGPONG: sliderVal = state.pingPongSpeed; break;
    default: sliderVal = 50;
    }

    var sliderW = ensureHiddenWidget(node, "__compare_slider", "50");
    if (sliderW) sliderW.value = sliderVal;

    var curveW = ensureHiddenWidget(node, "__compare_curve", CURVE_DEFAULT);
    if (curveW) curveW.value = state.pingPongCurve;

    var wheelW = ensureHiddenWidget(node, "__compare_wheel_ctrl", "0");
    if (wheelW) wheelW.value = state.wheelControlEnabled ? "1" : "0";

    var dirW = ensureHiddenWidget(node, "__compare_slide_dir", DEFAULT_SLIDE_DIR);
    if (dirW) dirW.value = state.slideDirection;

    var liveW = ensureHiddenWidget(node, "__live_preview", "0");
    if (liveW) liveW.value = state.livePreviewEnabled ? "1" : "0";
}

function restoreState(state) {
    var node = state.node;
    if (!node) return;

    var modeW = ensureHiddenWidget(node, "__compare_mode", MODE.SLIDE);
    if (modeW && modeW.value != null && modeW.value !== "") {
        state.mode = Number(modeW.value) || MODE.SLIDE;
    }

    var sliderW = ensureHiddenWidget(node, "__compare_slider", "50");
    if (sliderW && sliderW.value != null && sliderW.value !== "") {
        var val = Number(sliderW.value) || 50;
        switch (state.mode) {
        case MODE.SLIDE: state.slidePos = val; break;
        case MODE.SPOTLIGHT: state.spotRadius = clampSpotRadius(state, val); break;
        case MODE.BLEND: state.blendOpacity = val; break;
        case MODE.PINGPONG: state.pingPongSpeed = val; break;
        }
    }

    // 恢复持久化的图片 — 刷新/重新加载工作流后自动显示
    if (!state.loaded) {
        var infoA = ensureHiddenWidget(node, "__img_a_info", "");
        var infoB = ensureHiddenWidget(node, "__img_b_info", "");
        try {
            var imgA = infoA && infoA.value ? JSON.parse(infoA.value) : null;
            var imgB = infoB && infoB.value ? JSON.parse(infoB.value) : null;
            if (imgA || imgB) {
                loadImages(state,
                    imgA ? buildViewUrl(imgA) : null,
                    imgB ? buildViewUrl(imgB) : null);
            }
        } catch (e) { /* ignore parse errors */ }
    }

    // 恢复滑动方向
    var dirW = ensureHiddenWidget(node, "__compare_slide_dir", DEFAULT_SLIDE_DIR);
    if (dirW && dirW.value != null && dirW.value !== "") {
        var dir = Number(dirW.value);
        if (dir === SLIDE_DIR_H || dir === SLIDE_DIR_V) state.slideDirection = dir;
    }

    // 恢复曲线索引
    var curveW = ensureHiddenWidget(node, "__compare_curve", CURVE_DEFAULT);
    if (curveW && curveW.value != null && curveW.value !== "") {
        var cv = Number(curveW.value);
        if (cv >= 0 && cv < CURVE_COUNT) state.pingPongCurve = cv;
    }

    // 恢复滚轮开关
    var wheelW = ensureHiddenWidget(node, "__compare_wheel_ctrl", "0");
    if (wheelW && wheelW.value != null && wheelW.value !== "") {
        state.wheelControlEnabled = String(wheelW.value) === "1";
    }

    // 恢复实时预览开关
    var liveW = ensureHiddenWidget(node, "__live_preview", "0");
    if (liveW && liveW.value != null && liveW.value !== "") {
        state.livePreviewEnabled = String(liveW.value) !== "0";
    }

    updateModeButtons(state);
    updateWheelToggle(state);
    updateLivePreviewBtn(state);
    updateCurveButtons(state);
    updateSlideDirBtn(state);
    updateSlider(state);

    // 曲线按钮组显示状态
    if (state.curveGroup) {
        state.curveGroup.style.display = state.mode === MODE.PINGPONG ? "" : "none";
    }

    // 滑动方向按钮仅 SLIDE 模式可见
    if (state.slideDirBtn) {
        state.slideDirBtn.style.display = state.mode === MODE.SLIDE ? "" : "none";
    }

    if (state.canvas) {
        state.canvas.style.cursor = state.mode === MODE.SPOTLIGHT ? "none" : "crosshair";
    }

    render(state);

    if (state.mode === MODE.PINGPONG && state.loaded) {
        startPingPong(state);
    }
}

// =========================================================================
// 节点尺寸 clamp（参照 XImageGet2 ensureNodeMinSize）
// =========================================================================

function clampNodeSize(node) {
    if (!node) return;

    node.min_size = [MIN_NODE_W, MIN_NODE_H];

    // 强制当前尺寸不低于最小值
    if (typeof node.setSize === "function") {
        var w = Math.max((node.size && node.size[0]) || 0, MIN_NODE_W);
        var h = Math.max((node.size && node.size[1]) || 0, MIN_NODE_H);
        node.setSize([w, h]);
    }

    // 防止重复包装 onResize
    if (node.__xcompare_resize_guard) return;
    node.__xcompare_resize_guard = true;

    var origOnResize = node.onResize;
    node.onResize = function (size) {
        // 使用固定最小尺寸
        this.min_size = [MIN_NODE_W, MIN_NODE_H];

        // 取实际尺寸并 clamp，直接设 this.size 避免 setSize 递归
        var srcSize = Array.isArray(size) ? size : this.size;
        var nw = Math.max((srcSize && srcSize[0]) || 0, MIN_NODE_W);
        var nh = Math.max((srcSize && srcSize[1]) || 0, MIN_NODE_H);
        this.size = [nw, nh];

        this.setDirtyCanvas && this.setDirtyCanvas(true, true);

        // 调用原始 onResize
        if (typeof origOnResize === "function") {
            origOnResize.apply(this, arguments);
        }

        // 重绘画布
        var st = this.__xcompareState;
        if (st) {
            render(st);
        }
    };
}

// =========================================================================
// 扩展注册
// =========================================================================

app.registerExtension({
    name: EXT_NAME,

    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (String(nodeData.name) !== NODE_CLASS) return;

        var origOnCreated = nodeType.prototype.onNodeCreated;
        var origOnConfigure = nodeType.prototype.onConfigure;
        var origOnExecuted = nodeType.prototype.onExecuted;

        nodeType.prototype.onNodeCreated = function () {
            origOnCreated && origOnCreated.apply(this, arguments);
            createCompareUI(this);
            restoreState(this.__xcompareState);
            clampNodeSize(this);
        };

        nodeType.prototype.onConfigure = function () {
            origOnConfigure && origOnConfigure.apply(this, arguments);
            createCompareUI(this);
            restoreState(this.__xcompareState);
            clampNodeSize(this);
        };

        nodeType.prototype.onExecuted = function (output) {
            // 在调用原始 onExecuted 之前提取并删除 images，
            // 阻止 ComfyUI 创建标准图片预览
            var savedImages = null;
            if (output && output.images && output.images.length >= 1) {
                savedImages = output.images.slice();
                delete output.images;
            }

            origOnExecuted && origOnExecuted.apply(this, arguments);

            if (savedImages) {
                handleNodeExecuted(this, { images: savedImages });
            }

            clearStandardPreview(this);
        };
    },

    async loadedGraphNode(node) {
        if (String(node.comfyClass || node.type || "") !== NODE_CLASS) return;
        // 图形加载后重新应用 min-size（参照 XImageGet2）
        createCompareUI(node);
        restoreState(node.__xcompareState);
        clampNodeSize(node);
    },

    async setup() {
        injectStyles();
        await applyUiLocale();
        installLocaleSync();

        // === 实时预览：执行中 → 所有 XImageCompare 显示预览；执行结束 → 隐藏 ===
        var _api = app.api;

        if (!_api) {
            console.warn("[XImageCompare] app.api not available — "
                + "live preview disabled");
            return;
        }

        var _previewActive = false;

        // ---- 收集所有 XImageCompare state（避免每次遍历） ----
        function _getAllStates() {
            var graph = app.graph;
            if (!graph || !graph._nodes) return [];
            var result = [];
            var nodes = graph._nodes;
            for (var i = 0; i < nodes.length; i++) {
                var node = nodes[i];
                if (String(node.comfyClass || node.type || "") !== NODE_CLASS) {
                    continue;
                }
                var state = node.__xcompareState;
                if (state && state._previewOverlay) {
                    result.push(state);
                }
            }
            return result;
        }

        // ---- executing：执行开始/结束控制预览开关 ----
        _api.addEventListener("executing", function (event) {
            if (event.detail == null) {
                // 全部执行结束 → 关闭预览 + 重置完成标记
                _previewActive = false;
                _getAllStates().forEach(function (s) {
                    s._previewDone = false;
                    if (s._previewBlobUrl) {
                        URL.revokeObjectURL(s._previewBlobUrl);
                        s._previewBlobUrl = null;
                    }
                    if (s._previewOverlay) {
                        s._previewOverlay.style.display = "none";
                    }
                });
            } else {
                // 执行开始 → 开启预览模式（不重置 _previewDone）
                _previewActive = true;
            }
        });

        // ---- b_preview：执行中每帧推送（跳过已完成的节点） ----
        _api.addEventListener("b_preview", function (event) {
            if (!_previewActive) return;
            var blob = event.detail;
            if (!blob) return;

            _getAllStates().forEach(function (state) {
                if (state._previewDone || !state.livePreviewEnabled) return;
                var blobUrl = URL.createObjectURL(blob);
                if (state._previewBlobUrl) {
                    URL.revokeObjectURL(state._previewBlobUrl);
                }
                state._previewBlobUrl = blobUrl;
                state._previewOverlay.src = blobUrl;
                state._previewOverlay.style.display = "";
            });
        });

        // ---- b_preview_with_metadata：同上（Type 4 兜底） ----
        _api.addEventListener("b_preview_with_metadata", function (event) {
            if (!_previewActive) return;
            var blob = event.detail && event.detail.blob;
            if (!blob) return;

            _getAllStates().forEach(function (state) {
                if (state._previewDone || !state.livePreviewEnabled) return;
                var blobUrl = URL.createObjectURL(blob);
                if (state._previewBlobUrl) {
                    URL.revokeObjectURL(state._previewBlobUrl);
                }
                state._previewBlobUrl = blobUrl;
                state._previewOverlay.src = blobUrl;
                state._previewOverlay.style.display = "";
            });
        });
    },
});
