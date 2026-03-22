/**
 * XDataHub - ComfyUI 浮动窗口扩展
 * ===================================
 *
 * 功能概述:
 * ---------
 * 为 ComfyUI 提供一个可拖拽、可调整大小的浮动窗口容器，
 * 用于嵌入 XMetadataWorkflow 等网页工具。
 *
 * 核心功能:
 * ---------
 * 1. 窗口管理:
 *    - 拖拽移动（标题栏拖动，带阈值防误触）
 *    - 调整大小（四边和四角都可拉伸，类似 Windows 窗口）
 *    - 显示/隐藏切换
 *    - 窗口启用/禁用设置
 *
 * 2. 集成方式:
 *    - 在 ComfyUI 菜单栏添加按钮（新 UI）
 *    - 支持 ComfyUI 设置面板配置
 *
 * 3. 内容加载:
 *    - 通过 iframe 加载 XMetadataWorkflow.html
 *    - 完全隔离的浏览环境
 *
 * 4. 界面特性:
 *    - 窗口透明度调节（20%-100%，带滑块控制，保存到 localStorage）
 *    - 窗口位置限制（防止完全拖出屏幕）
 *    - 多语言支持（英文/中文）
 *
 * 技术实现:
 * ---------
 * - 使用 CSS 变量适配 ComfyUI 主题
 * - 使用 localStorage 保存透明度设置
 * - 使用鼠标事件实现拖拽，带阈值和 RAF 优化
 * - 使用鼠标事件实现四边四角拉伸
 * - 限制窗口位置防止完全拖出屏幕
 * - 使用 requestAnimationFrame 优化拖拽性能
 *
 * 文件结构:
 * ---------
 * - xdatahub.js: 窗口管理逻辑（此文件）
 * - XMetadataWorkflow.html: 窗口内加载的网页内容
 *
 * @author Xz3r0
 * @project ComfyUI-Xz3r0-Nodes
 */

import { app } from "../../scripts/app.js";

/**
 * 菜单按钮引用
 */
let menuButton = null;
const HOTKEY_SETTING_ID = "Xz3r0.XDataHub.Hotkey";
const DEFAULT_HOTKEY_SPEC = "Alt + X";
const OPEN_LAYOUT_SETTING_ID = "Xz3r0.XDataHub.DefaultOpenLayout";
const OPEN_LAYOUT_OPTION_DEFAULT = "默认（居中 75%）";
const OPEN_LAYOUT_OPTION_LEFT = "左靠边";
const OPEN_LAYOUT_OPTION_RIGHT = "右靠边";
const OPEN_LAYOUT_OPTION_MAXIMIZED = "最大化";
let hotkeySpec = DEFAULT_HOTKEY_SPEC;
let hotkeySettingInitialized = false;
let defaultOpenLayout = "center";
let xdataHubRef = null;

// ============================================
// 内部文本本地化 (仅用于窗口内部 DOM 元素)
// ============================================

const UI_TEXT = {
    en: {
        windowTitle: "XDataHub",
        closeBtn: "Close",
        maxBtn: "Maximize",
        restoreBtn: "Restore",
        dockLeftBtn: "Dock Left",
        dockRightBtn: "Dock Right",
        menuTooltip: "XDataHub",
        opacityLabel: "Opacity"
    },
    zh: {
        windowTitle: "XDataHub",
        closeBtn: "关闭",
        maxBtn: "最大化",
        restoreBtn: "还原",
        dockLeftBtn: "靠左停靠",
        dockRightBtn: "靠右停靠",
        menuTooltip: "XDataHub",
        opacityLabel: "透明度"
    }
};

const HOST_TABS = [
    { id: "history", icon: "history", text: "历史数据" },
    { id: "image", icon: "image", text: "图片" },
    { id: "video", icon: "video", text: "视频" },
    { id: "audio", icon: "audio-lines", text: "音频" },
    { id: "workflow", icon: "workflow", text: "工作流元数据" },
];
const XDATAHUB_ASSET_VER = "20260322-85";

function iconUrl(name) {
    return `/extensions/ComfyUI-Xz3r0-Nodes/icons/${name}.svg`;
}

function iconHtml(name, label, className = "xz3r0-icon") {
    return `<img class="${className}" src="${iconUrl(name)}" alt="${label}" aria-hidden="true">`;
}

function applyMenuButtonIcon() {
    if (!menuButton?.element) {
        return;
    }
    menuButton.element.classList.add("xz3r0-datahub-menu-btn");
    menuButton.element.innerHTML = `
        <span class="xz3r0-datahub-menu-content">
            ${iconHtml("infinity", t("menuTooltip"), "xz3r0-icon xz3r0-menu-icon")}
        </span>
    `;
}

function getLocale() {
    const locale = window.app?.extensionManager?.setting?.get('Comfy.Locale')
        || localStorage.getItem('Comfy.Locale')
        || navigator.language
        || 'en';
    return locale.split('-')[0];
}

function t(key) {
    const locale = getLocale();
    return UI_TEXT[locale]?.[key] ?? UI_TEXT.en[key] ?? key;
}

function parseHotkeySpec(spec) {
    const raw = String(spec || "").trim();
    if (!raw) {
        return null;
    }
    const tokens = raw
        .split("+")
        .map((part) => part.trim().toLowerCase())
        .filter(Boolean);
    if (tokens.length === 0) {
        return null;
    }

    const combo = {
        ctrl: false,
        alt: false,
        shift: false,
        meta: false,
        key: "",
    };

    const keyAlias = {
        esc: "escape",
        return: "enter",
        spacebar: "space",
        cmd: "meta",
        command: "meta",
        win: "meta",
        windows: "meta",
    };

    for (const tokenRaw of tokens) {
        const token = keyAlias[tokenRaw] || tokenRaw;
        if (token === "ctrl" || token === "control") {
            combo.ctrl = true;
            continue;
        }
        if (token === "alt" || token === "option") {
            combo.alt = true;
            continue;
        }
        if (token === "shift") {
            combo.shift = true;
            continue;
        }
        if (token === "meta") {
            combo.meta = true;
            continue;
        }
        combo.key = token;
    }

    if (!combo.key) {
        return null;
    }
    return combo;
}

function readHotkeySpecFromSettings() {
    return String(
        app.extensionManager?.setting?.get(HOTKEY_SETTING_ID)
        || DEFAULT_HOTKEY_SPEC
    ).trim() || DEFAULT_HOTKEY_SPEC;
}

function normalizeDefaultOpenLayout(value) {
    const text = String(value || "").trim().toLowerCase();
    if (text === OPEN_LAYOUT_OPTION_LEFT.toLowerCase() || text === "left") {
        return "left";
    }
    if (text === OPEN_LAYOUT_OPTION_RIGHT.toLowerCase() || text === "right") {
        return "right";
    }
    if (
        text === OPEN_LAYOUT_OPTION_MAXIMIZED.toLowerCase()
        || text === "maximized"
        || text === "maximize"
    ) {
        return "maximized";
    }
    return "center";
}

function readDefaultOpenLayoutFromSettings() {
    const currentValue = app.extensionManager?.setting?.get(
        OPEN_LAYOUT_SETTING_ID
    ) || OPEN_LAYOUT_OPTION_DEFAULT;
    return normalizeDefaultOpenLayout(currentValue);
}

function applyDefaultOpenLayoutToOpenWindow() {
    xdataHubRef?.instance?.applyDefaultOpenLayout?.();
}

const initialHotkeyCombo = (
    parseHotkeySpec(readHotkeySpecFromSettings())
    || parseHotkeySpec(DEFAULT_HOTKEY_SPEC)
);

/**
 * 窗口启用状态
 */
let windowEnabled = true;
let windowUnderComfySidebar = false;

const WINDOW_Z_INDEX_DEFAULT = 10000;
const WINDOW_Z_INDEX_UNDER_SIDEBAR = 998;

function getWindowZIndex() {
    return windowUnderComfySidebar
        ? WINDOW_Z_INDEX_UNDER_SIDEBAR
        : WINDOW_Z_INDEX_DEFAULT;
}

function applyWindowZIndex(windowEl) {
    if (!windowEl) return;
    windowEl.style.zIndex = String(getWindowZIndex());
}

function applyWindowZIndexToOpenWindow() {
    const windowEl = document.querySelector(".xz3r0-datahub-window");
    applyWindowZIndex(windowEl);
}

/**
 * 更新菜单按钮显示状态
 */
function updateMenuButtonVisibility() {
    if (!menuButton) return;
    applyMenuButtonIcon();
    menuButton.element.style.display = windowEnabled ? "" : "none";
    if (!windowEnabled) {
        const windowEl = document.querySelector(".xz3r0-datahub-window");
        if (windowEl) {
            windowEl.style.display = "none";
        }
    }
}

/**
 * 注册 ComfyUI 扩展
 * 在 ComfyUI 初始化时设置窗口按钮和样式
 */
app.registerExtension({
    name: "ComfyUI.Xz3r0.XDataHub",
    commands: [
        {
            id: "Xz3r0.XDataHub.ToggleWindow",
            label: "Toggle XDataHub Window",
            icon: "pi pi-window-maximize",
            function: () => {
                if (!windowEnabled) {
                    return;
                }
                XDataHub.toggle();
            }
        }
    ],
    keybindings: initialHotkeyCombo
        ? [
            {
                commandId: "Xz3r0.XDataHub.ToggleWindow",
                combo: initialHotkeyCombo
            }
        ]
        : [],

    /**
     * 扩展设置配置
     */
    settings: [
        {
            id: "Xz3r0.XDataHub.Enabled",
            name: "Enable XDataHub (Button)",
            type: "boolean",
            defaultValue: true,
            tooltip: "Show XDataHub button in the top-menu bar",
            // 注意：分类前缀 EMOJI（♾️）为固定分组标识，禁止修改。
            category: ["♾️ Xz3r0", "XDataHub", "Enabled"],
            onChange: (value) => {
                if (windowEnabled === value) return;
                windowEnabled = value;
                updateMenuButtonVisibility();
            }
        },
        {
            id: "Xz3r0.XDataHub.UnderSidebar",
            name: "Place XDataHub below ComfyUI UI layers",
            type: "boolean",
            defaultValue: false,
            tooltip: "When enabled, XDataHub is rendered below ComfyUI UI components. Panels/tools around the viewport may cover content or controls.",
            // 注意：分类前缀 EMOJI（♾️）为固定分组标识，禁止修改。
            category: ["♾️ Xz3r0", "XDataHub", "Layer"],
            onChange: (value) => {
                if (windowUnderComfySidebar === value) return;
                windowUnderComfySidebar = value;
                applyWindowZIndexToOpenWindow();
            }
        },
        {
            id: OPEN_LAYOUT_SETTING_ID,
            name: "XDataHub default open layout",
            type: "combo",
            options: [
                OPEN_LAYOUT_OPTION_DEFAULT,
                OPEN_LAYOUT_OPTION_LEFT,
                OPEN_LAYOUT_OPTION_RIGHT,
                OPEN_LAYOUT_OPTION_MAXIMIZED
            ],
            defaultValue: OPEN_LAYOUT_OPTION_DEFAULT,
            tooltip: "Default window layout when opening XDataHub.",
            // 注意：分类前缀 EMOJI（♾️）为固定分组标识，禁止修改。
            category: ["♾️ Xz3r0", "XDataHub", "Window"],
            onChange: (value) => {
                defaultOpenLayout = normalizeDefaultOpenLayout(value);
                applyDefaultOpenLayoutToOpenWindow();
            }
        },
        {
            id: HOTKEY_SETTING_ID,
            name: "XDataHub toggle hotkey",
            type: "text",
            defaultValue: DEFAULT_HOTKEY_SPEC,
            tooltip: "Set the hotkey used to toggle XDataHub visibility.",
            // 注意：分类前缀 EMOJI（♾️）为固定分组标识，禁止修改。
            category: ["♾️ Xz3r0", "XDataHub", "Hotkey"],
            onChange: (value) => {
                hotkeySpec = String(value || "").trim() || DEFAULT_HOTKEY_SPEC;
                if (!parseHotkeySpec(hotkeySpec)) {
                    hotkeySpec = DEFAULT_HOTKEY_SPEC;
                    app.extensionManager?.setting?.set(
                        HOTKEY_SETTING_ID,
                        DEFAULT_HOTKEY_SPEC
                    );
                }
                if (!hotkeySettingInitialized) {
                    hotkeySettingInitialized = true;
                    return;
                }
                app.extensionManager?.toast?.add?.({
                    severity: "info",
                    summary: "XDataHub",
                    detail: "快捷键已更新，刷新页面后生效\nHotkey updated, refresh page to apply",
                    life: 2200
                });
            }
        }
    ],

    /**
     * 扩展初始化函数
     * 创建样式表并添加菜单按钮
     */
    async setup() {
        hotkeySpec = readHotkeySpecFromSettings();
        defaultOpenLayout = readDefaultOpenLayoutFromSettings();

        // 创建并注入窗口样式
        const style = document.createElement("style");
        style.textContent = `
            .xz3r0-datahub-window {
                /* 窗口内颜色变量入口：
                   新增/调整颜色请先在此定义变量，避免在样式规则中写硬编码颜色。 */
                /* 语义主色 */
                --btn-active-color: #ff69b4;
                --btn-hover-glow-rgb: 255, 105, 180;
                --btn-hover-glow: inset 0 0 0 1px
                    rgba(var(--btn-hover-glow-rgb), 0.32),
                    0 0 14px rgba(var(--btn-hover-glow-rgb), 0.32);
                /* 窗口层背景/边框/阴影 */
                --window-theme-bg-main: #1f1f1f; /* 主题背景主色（窗口主要区域） */
                --window-shell-bg: var(--comfy-menu-bg, #1e1e1e);
                --window-header-bg: #ffffff;
                --window-content-bg: var(--window-theme-bg-main);
                --window-tabs-bg: #2b2b2b;
                --window-tab-item-bg: rgba(255, 255, 255, 0.02);
                --window-tabs-rail-bg: rgba(255, 255, 255, 0.03);
                --window-tabs-rail-border: rgba(255, 255, 255, 0.1);
                --window-tab-inactive-compact-bg: rgba(255, 255, 255, 0.015);
                --window-tab-inactive-compact-border: rgba(255, 255, 255, 0.16);
                --window-border: var(--border, #3d3d3d);
                --window-shell-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
                /* 文本/控件色 */
                --window-title-text: #1f2430;
                --window-control-text: #1f2430;
                --window-tab-text: #e6ebf2;
                --window-tab-hover-text: #f3f7ff;
                --window-opacity-text: #000000;
                --window-opacity-track: var(--border-color, #3d3d3d);
                --window-opacity-thumb: #1f2430;
                --window-opacity-thumb-hover: #ff69b4;
                /* 图标滤镜 */
                --icon-filter-unified: brightness(0) saturate(100%)
                    invert(14%) sepia(11%) saturate(1195%)
                    hue-rotate(181deg) brightness(95%) contrast(94%);
                --icon-filter-unified-active: brightness(0) saturate(100%)
                    invert(61%) sepia(70%) saturate(1107%)
                    hue-rotate(287deg) brightness(103%) contrast(101%);
                --icon-filter-tab: brightness(0) saturate(100%)
                    invert(92%) sepia(13%) saturate(234%)
                    hue-rotate(181deg) brightness(98%) contrast(96%);
                --icon-filter-tab-active: brightness(0) saturate(100%)
                    invert(61%) sepia(70%) saturate(1107%)
                    hue-rotate(287deg) brightness(103%) contrast(101%);
                position: fixed;
                z-index: ${WINDOW_Z_INDEX_DEFAULT};
                background: var(--window-shell-bg);
                border: 1px solid var(--window-border);
                border-radius: 8px;
                box-shadow: var(--window-shell-shadow);
                display: flex;
                flex-direction: column;
                overflow: hidden;
                min-width: 400px;
                min-height: 300px;
            }
            .xz3r0-datahub-window-header {
                display: flex;
                align-items: center;
                justify-content: space-between;
                padding: 8px 12px;
                background: var(--window-header-bg);
                border-bottom: 1px solid var(--window-border);
                cursor: grab;
                user-select: none;
                flex-shrink: 0;
            }
            .xz3r0-datahub-window-header:active {
                cursor: grabbing;
            }
            .xz3r0-datahub-window-header.dragging {
                cursor: grabbing;
            }
            .xz3r0-datahub-window-title {
                display: inline-flex;
                align-items: center;
                gap: 6px;
                font-weight: 600;
                color: var(--window-title-text);
                font-size: 13px;
            }
            .xz3r0-datahub-window-title .xz3r0-title-icon {
                width: 16px;
                height: 16px;
                display: block;
                filter: var(--icon-filter-unified);
            }
            .xz3r0-datahub-menu-btn .xz3r0-datahub-menu-content {
                display: inline-flex;
                align-items: center;
                justify-content: center;
            }
            .xz3r0-datahub-menu-btn .xz3r0-menu-icon {
                width: 14px;
                height: 14px;
                display: block;
                filter: var(--icon-filter-unified);
            }
            .xz3r0-datahub-window-controls {
                display: flex;
                gap: 6px;
            }
            .xz3r0-datahub-window-btn {
                width: 30px;
                height: 30px;
                border: none;
                border-radius: 4px;
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: center;
                background: transparent;
                color: var(--window-control-text);
                transition: all 0.2s;
            }
            .xz3r0-datahub-window-btn .xz3r0-icon {
                width: 16px;
                height: 16px;
                display: block;
                filter: var(--icon-filter-unified);
            }
            .xz3r0-datahub-window-btn:hover .xz3r0-icon {
                filter: var(--icon-filter-unified-active);
            }
            .xz3r0-datahub-window-content {
                flex: 1;
                overflow: hidden;
                min-height: 0;
                display: flex;
                flex-direction: column;
                background: var(--window-content-bg);
            }
            .xz3r0-datahub-window-content iframe {
                width: 100%;
                height: 100%;
                border: none;
            }
            .xz3r0-datahub-window-host-tabs {
                display: flex;
                gap: 6px;
                padding: 4px 10px 8px 10px;
                background: transparent;
                flex-shrink: 0;
                overflow: hidden;
                justify-content: center;
                position: relative;
            }
            .xz3r0-datahub-window.compact-tabs .xz3r0-datahub-window-host-tabs {
                padding: 4px 8px 8px 8px;
                justify-content: flex-start;
            }
            .xz3r0-datahub-window.compact-tabs
            .xz3r0-datahub-window-host-tabs::after {
                left: 0;
                right: 0;
            }
            .xz3r0-datahub-window-host-tabs::after {
                content: "";
                position: absolute;
                left: 0;
                right: 0;
                bottom: 0;
                height: 1px;
                background: linear-gradient(
                    90deg,
                    rgba(255, 255, 255, 0.05) 0%,
                    rgba(255, 255, 255, 0.14) 50%,
                    rgba(255, 255, 255, 0.05) 100%
                );
                pointer-events: none;
            }
            .xz3r0-datahub-window-host-tabs-indicator {
                position: absolute;
                bottom: 0;
                height: 2px;
                width: 24px;
                border-radius: 999px;
                background: linear-gradient(
                    90deg,
                    rgba(var(--btn-hover-glow-rgb), 0.35) 0%,
                    rgba(var(--btn-hover-glow-rgb), 0.95) 50%,
                    rgba(var(--btn-hover-glow-rgb), 0.35) 100%
                );
                box-shadow: 0 0 10px rgba(var(--btn-hover-glow-rgb), 0.42);
                transform: translateZ(0);
                transition:
                    left 180ms ease,
                    width 180ms ease,
                    opacity 120ms ease;
                opacity: 0;
                pointer-events: none;
                z-index: 2;
            }
            .xz3r0-datahub-window-host-tabs.has-active-indicator
            .xz3r0-datahub-window-host-tabs-indicator {
                opacity: 1;
            }
            .xz3r0-datahub-window-host-tab {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                box-sizing: border-box;
                border: 1px solid var(--window-border);
                background: var(--window-tab-item-bg);
                color: var(--window-tab-text);
                border-radius: 6px;
                height: 32px;
                padding: 6px 10px;
                cursor: pointer;
                font-size: 12px;
                font-weight: 700;
                line-height: 1.15;
                white-space: nowrap;
                flex: 0 0 auto;
                transition: border-color 120ms ease, background-color 120ms ease,
                    color 120ms ease, box-shadow 120ms ease, transform 120ms ease;
                position: relative;
                z-index: 1;
            }
            .xz3r0-datahub-window-host-tab:not(.active) {
                border-color: var(--window-border);
            }
            .xz3r0-datahub-window-host-tab-icon {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                line-height: 1;
                margin-right: 4px;
            }
            .xz3r0-datahub-window-host-tab-icon .xz3r0-icon {
                width: 14px;
                height: 14px;
                display: block;
                filter: var(--icon-filter-tab);
            }
            .xz3r0-datahub-window-host-tab.active
            .xz3r0-datahub-window-host-tab-icon .xz3r0-icon {
                filter: var(--icon-filter-tab-active);
            }
            .xz3r0-datahub-window-host-tab-text {
                display: inline;
            }
            .xz3r0-datahub-window-host-tab:hover {
                color: var(--window-tab-hover-text);
                border-color: var(--window-border);
                background: rgba(var(--btn-hover-glow-rgb), 0.12);
                box-shadow: inset 0 0 0 1px rgba(var(--btn-hover-glow-rgb), 0.2);
            }
            .xz3r0-datahub-window-host-tab.active {
                border-color: var(--btn-active-color);
                color: var(--btn-active-color);
                font-weight: 700;
                background: rgba(var(--btn-hover-glow-rgb), 0.2);
                box-shadow: var(--btn-hover-glow);
                transform: translateY(-1px);
            }
            .xz3r0-datahub-window.compact-tabs .xz3r0-datahub-window-host-tab {
                width: auto;
                min-width: 0;
                flex: 1 1 0;
            }
            .xz3r0-datahub-window.compact-tabs
            .xz3r0-datahub-window-host-tab-icon {
                margin-right: 0;
            }
            .xz3r0-datahub-window.compact-tabs
            .xz3r0-datahub-window-host-tab-text {
                display: none;
            }
            .xz3r0-datahub-window-host-tab.active::after {
                content: "";
                position: absolute;
                left: 50%;
                bottom: -7px;
                width: 0;
                height: 0;
                border-left: 4px solid transparent;
                border-right: 4px solid transparent;
                border-top: 6px solid rgba(var(--btn-hover-glow-rgb), 0.9);
                transform: translateX(-50%);
                pointer-events: none;
            }
            .xz3r0-datahub-window-frame-stack {
                position: relative;
                flex: 1;
                min-height: 0;
                overflow: hidden;
            }
            .xz3r0-datahub-window-frame {
                position: absolute;
                inset: 0;
                width: 100%;
                height: 100%;
                border: none;
                display: none;
            }
            .xz3r0-datahub-window-frame.active {
                display: block;
            }
            .xz3r0-dragging {
                user-select: none !important;
            }
            .xz3r0-resizing {
                user-select: none !important;
            }
            .xz3r0-resize-handle {
                position: absolute;
                z-index: 10001;
            }
            .xz3r0-resize-handle-n {
                top: -8px;
                left: 16px;
                right: 16px;
                height: 16px;
                cursor: ns-resize;
            }
            .xz3r0-resize-handle-s {
                bottom: -8px;
                left: 16px;
                right: 16px;
                height: 16px;
                cursor: ns-resize;
            }
            .xz3r0-resize-handle-w {
                left: -8px;
                top: 16px;
                bottom: 16px;
                width: 16px;
                cursor: ew-resize;
            }
            .xz3r0-resize-handle-e {
                right: -8px;
                top: 16px;
                bottom: 16px;
                width: 16px;
                cursor: ew-resize;
            }
            .xz3r0-resize-handle-nw {
                top: -8px;
                left: -8px;
                width: 24px;
                height: 24px;
                cursor: nwse-resize;
            }
            .xz3r0-resize-handle-ne {
                top: -8px;
                right: -8px;
                width: 24px;
                height: 24px;
                cursor: nesw-resize;
            }
            .xz3r0-resize-handle-sw {
                bottom: -8px;
                left: -8px;
                width: 24px;
                height: 24px;
                cursor: nesw-resize;
            }
            .xz3r0-resize-handle-se {
                bottom: -8px;
                right: -8px;
                width: 24px;
                height: 24px;
                cursor: nwse-resize;
            }
            .xz3r0-opacity-control {
                display: flex;
                align-items: center;
                gap: 8px;
                position: absolute;
                left: 50%;
                transform: translateX(-50%);
            }
            .xz3r0-opacity-label {
                font-size: 11px;
                color: var(--window-opacity-text);
                font-weight: 700;
            }
            .xz3r0-opacity-slider {
                width: 80px;
                height: 4px;
                -webkit-appearance: none;
                appearance: none;
                background: var(--window-opacity-track);
                border-radius: 2px;
                outline: none;
                cursor: pointer;
            }
            .xz3r0-opacity-slider::-webkit-slider-thumb {
                -webkit-appearance: none;
                appearance: none;
                width: 12px;
                height: 12px;
                background: var(--window-opacity-thumb);
                border-radius: 50%;
                cursor: pointer;
                transition: background 0.2s;
            }
            .xz3r0-opacity-slider::-webkit-slider-thumb:hover {
                background: var(--window-opacity-thumb-hover);
            }
            .xz3r0-opacity-slider::-moz-range-thumb {
                width: 12px;
                height: 12px;
                background: var(--window-opacity-thumb);
                border-radius: 50%;
                cursor: pointer;
                border: none;
                transition: background 0.2s;
            }
            .xz3r0-opacity-slider::-moz-range-thumb:hover {
                background: var(--window-opacity-thumb-hover);
            }
            .xz3r0-opacity-value {
                font-size: 11px;
                color: var(--window-opacity-text);
                font-weight: 700;
                min-width: 32px;
                text-align: right;
            }
        `;
        document.head.appendChild(style);

        // 尝试在新版 ComfyUI UI 中添加菜单按钮
        if (app.menu?.settingsGroup) {
            try {
                const { ComfyButton } = await import("../../scripts/ui/components/button.js");
                menuButton = new ComfyButton({
                    action: () => XDataHub.toggle(),
                    tooltip: t('menuTooltip'),
                    content: iconHtml("infinity", t("menuTooltip")),
                });
                app.menu.settingsGroup.append(menuButton);
                applyMenuButtonIcon();
                // 根据设置显示/隐藏按钮
                updateMenuButtonVisibility();
            } catch (e) {
                console.warn("[Xz3r0-Nodes] Failed to create menu button:", e);
            }
        }
    }
});

/**
 * XDataHub 窗口管理对象
 * 提供窗口的创建、显示/隐藏、状态管理等功能
 */
const XDataHub = {
    /** 当前窗口实例 */
    instance: null,

    /**
     * 加载窗口位置和大小状态
     * 当前实现返回 null，窗口始终使用默认居中位置
     * 注：透明度设置单独使用 localStorage 保存
     * @returns {null} 始终返回 null，使用默认状态
     */
    loadState() {
        return null;
    },

    /**
     * 保存窗口位置和大小状态
     * 当前实现为空，不保存窗口位置和大小
     * 注：透明度设置单独使用 localStorage 保存
     * @param {Object} state - 窗口状态对象
     */
    saveState(state) {
        // 当前不保存窗口位置和大小
    },

    /**
     * 切换窗口显示/隐藏
     * 如果窗口已显示则隐藏，否则显示
     */
    toggle() {
        if (this.instance && this.instance.isVisible) {
            this.instance.hide();
        } else {
            this.show();
        }
    },

    /**
     * 显示窗口
     * 如果窗口未创建则先创建
     */
    show() {
        if (!this.instance) {
            this.instance = this.create();
        }
        this.instance.show();
    },

    /**
     * 创建窗口
     * 构建窗口 DOM 结构并设置事件处理
     * @returns {Object} 窗口实例对象，包含 show/hide/destroy 方法
     */
    create() {
        const windowEl = document.createElement("div");
        windowEl.className = "xz3r0-datahub-window";
        applyWindowZIndex(windowEl);

        const RESIZE_MIN_WIDTH = 400;
        const RESIZE_MIN_HEIGHT = 300;
        let initialDockSide = null;

        if (defaultOpenLayout === "left" || defaultOpenLayout === "right") {
            const targetLeft = defaultOpenLayout === "right"
                ? Math.max(0, window.innerWidth - RESIZE_MIN_WIDTH)
                : 0;
            initialDockSide = defaultOpenLayout;
            windowEl.style.left = `${targetLeft}px`;
            windowEl.style.top = "0px";
            windowEl.style.width = `${RESIZE_MIN_WIDTH}px`;
            windowEl.style.height = `${window.innerHeight}px`;
        } else if (defaultOpenLayout === "maximized") {
            windowEl.style.left = "0px";
            windowEl.style.top = "0px";
            windowEl.style.width = `${window.innerWidth}px`;
            windowEl.style.height = `${window.innerHeight}px`;
        } else {
            // 默认尺寸：首次按当前视口 75% 打开（保持最小尺寸约束）
            const defaultWidth = Math.max(
                RESIZE_MIN_WIDTH,
                Math.floor(window.innerWidth * 0.75)
            );
            const defaultHeight = Math.max(
                RESIZE_MIN_HEIGHT,
                Math.floor(window.innerHeight * 0.75)
            );

            // 居中显示
            const centerLeft = Math.max(
                0,
                (window.innerWidth - defaultWidth) / 2
            );
            const centerTop = Math.max(
                0,
                (window.innerHeight - defaultHeight) / 2
            );
            windowEl.style.left = `${centerLeft}px`;
            windowEl.style.top = `${centerTop}px`;
            windowEl.style.width = `${defaultWidth}px`;
            windowEl.style.height = `${defaultHeight}px`;
        }

        const header = document.createElement("div");
        header.className = "xz3r0-datahub-window-header";

        const title = document.createElement("span");
        title.className = "xz3r0-datahub-window-title";
        title.innerHTML = `
            ${iconHtml("infinity", t("windowTitle"), "xz3r0-icon xz3r0-title-icon")}
            <span class="xz3r0-datahub-window-title-text">${t("windowTitle")}</span>
        `;

        // 透明度控制组件
        const opacityControl = document.createElement("div");
        opacityControl.className = "xz3r0-opacity-control";

        const opacityLabel = document.createElement("span");
        opacityLabel.className = "xz3r0-opacity-label";
        opacityLabel.textContent = t('opacityLabel');

        const opacitySlider = document.createElement("input");
        opacitySlider.type = "range";
        opacitySlider.className = "xz3r0-opacity-slider";
        opacitySlider.min = "20";
        opacitySlider.max = "100";
        opacitySlider.value = "100";

        const opacityValue = document.createElement("span");
        opacityValue.className = "xz3r0-opacity-value";
        opacityValue.textContent = "100%";

        opacityControl.appendChild(opacityLabel);
        opacityControl.appendChild(opacitySlider);
        opacityControl.appendChild(opacityValue);

        const controls = document.createElement("div");
        controls.className = "xz3r0-datahub-window-controls";

        const dockLeftBtn = document.createElement("button");
        dockLeftBtn.className = "xz3r0-datahub-window-btn";
        dockLeftBtn.innerHTML = iconHtml("panel-left-close", t("dockLeftBtn"));
        dockLeftBtn.title = t("dockLeftBtn");

        const maxBtn = document.createElement("button");
        maxBtn.className = "xz3r0-datahub-window-btn";
        maxBtn.innerHTML = iconHtml("maximize-2", t("maxBtn"));
        maxBtn.title = t('maxBtn');

        const closeBtn = document.createElement("button");
        closeBtn.className = "xz3r0-datahub-window-btn";
        closeBtn.innerHTML = iconHtml("x", t("closeBtn"));
        closeBtn.title = t('closeBtn');

        controls.appendChild(dockLeftBtn);
        controls.appendChild(maxBtn);
        controls.appendChild(closeBtn);
        header.appendChild(title);
        header.appendChild(opacityControl);
        header.appendChild(controls);

        const content = document.createElement("div");
        content.className = "xz3r0-datahub-window-content";

        const hostTabs = document.createElement("div");
        hostTabs.className = "xz3r0-datahub-window-host-tabs";

        const frameStack = document.createElement("div");
        frameStack.className = "xz3r0-datahub-window-frame-stack";

        const dataFrame = document.createElement("iframe");
        dataFrame.className = "xz3r0-datahub-window-frame";
        dataFrame.src = `/extensions/ComfyUI-Xz3r0-Nodes/xdatahub_app.html?tab=history&v=${XDATAHUB_ASSET_VER}`;

        const workflowFrame = document.createElement("iframe");
        workflowFrame.className = "xz3r0-datahub-window-frame";
        workflowFrame.src = `/extensions/ComfyUI-Xz3r0-Nodes/xmetadataworkflow.html?v=${XDATAHUB_ASSET_VER}`;

        frameStack.appendChild(dataFrame);
        frameStack.appendChild(workflowFrame);
        content.appendChild(hostTabs);
        content.appendChild(frameStack);

        let activeHostTab = "history";
        const hostTabButtons = new Map();
        const hostTabsIndicator = document.createElement("div");
        hostTabsIndicator.className = "xz3r0-datahub-window-host-tabs-indicator";
        const updateHostTabIndicator = () => {
            const activeButton = hostTabButtons.get(activeHostTab);
            if (!activeButton) {
                hostTabs.classList.remove("has-active-indicator");
                return;
            }
            const tabsRect = hostTabs.getBoundingClientRect();
            const buttonRect = activeButton.getBoundingClientRect();
            const inset = Math.min(12, Math.max(6, buttonRect.width * 0.16));
            const left = buttonRect.left - tabsRect.left + inset;
            const width = Math.max(16, buttonRect.width - (inset * 2));
            hostTabsIndicator.style.left = `${left}px`;
            hostTabsIndicator.style.width = `${width}px`;
            hostTabs.classList.add("has-active-indicator");
        };
        const updateIframePointerEvents = (value) => {
            dataFrame.style.pointerEvents = value;
            workflowFrame.style.pointerEvents = value;
        };
        const updateHostTabCompactMode = () => {
            windowEl.classList.remove("compact-tabs");
            const needsCompactByLayout = hostTabs.scrollWidth > hostTabs.clientWidth;
            const isCompact = needsCompactByLayout;
            windowEl.classList.toggle("compact-tabs", isCompact);
            requestAnimationFrame(updateHostTabIndicator);
        };
        const setHostTab = (tabId) => {
            activeHostTab = tabId;
            hostTabButtons.forEach((button, id) => {
                button.classList.toggle("active", id === tabId);
            });
            updateHostTabIndicator();
            const isWorkflow = tabId === "workflow";
            workflowFrame.classList.toggle("active", isWorkflow);
            dataFrame.classList.toggle("active", !isWorkflow);
            if (!isWorkflow && dataFrame.contentWindow) {
                dataFrame.contentWindow.postMessage(
                    { type: "xdatahub:set-tab", tab: tabId },
                    "*"
                );
            }
        };

        HOST_TABS.forEach((tab) => {
            const button = document.createElement("button");
            button.className = "xz3r0-datahub-window-host-tab";
            button.title = tab.text;
            button.innerHTML = `
                <span class="xz3r0-datahub-window-host-tab-icon">${iconHtml(tab.icon, tab.text)}</span>
                <span class="xz3r0-datahub-window-host-tab-text">${tab.text}</span>
            `;
            button.addEventListener("click", () => setHostTab(tab.id));
            hostTabs.appendChild(button);
            hostTabButtons.set(tab.id, button);
        });
        hostTabs.appendChild(hostTabsIndicator);

        windowEl.appendChild(header);
        windowEl.appendChild(content);
        document.body.appendChild(windowEl);
        updateHostTabCompactMode();
        setHostTab(activeHostTab);

        // 创建拉伸手柄
        const resizeHandles = [
            { class: 'xz3r0-resize-handle-n', direction: 'n' },
            { class: 'xz3r0-resize-handle-s', direction: 's' },
            { class: 'xz3r0-resize-handle-w', direction: 'w' },
            { class: 'xz3r0-resize-handle-e', direction: 'e' },
            { class: 'xz3r0-resize-handle-nw', direction: 'nw' },
            { class: 'xz3r0-resize-handle-ne', direction: 'ne' },
            { class: 'xz3r0-resize-handle-sw', direction: 'sw' },
            { class: 'xz3r0-resize-handle-se', direction: 'se' }
        ];
        const EDGE_SNAP_THRESHOLD = 4;
        const HANDLE_INSET = 2;
        const resizeHandleElements = new Map();

        resizeHandles.forEach(({ class: className, direction }) => {
            const handle = document.createElement('div');
            handle.className = `xz3r0-resize-handle ${className}`;
            handle.dataset.direction = direction;
            windowEl.appendChild(handle);
            resizeHandleElements.set(direction, handle);
        });

        const computeWindowEdgeState = () => {
            const rect = windowEl.getBoundingClientRect();
            return {
                left: rect.left <= EDGE_SNAP_THRESHOLD,
                right: (window.innerWidth - rect.right) <= EDGE_SNAP_THRESHOLD,
                top: rect.top <= EDGE_SNAP_THRESHOLD,
                bottom: (window.innerHeight - rect.bottom) <= EDGE_SNAP_THRESHOLD,
            };
        };

        const updateResizeHandleLayout = () => {
            const edge = computeWindowEdgeState();
            resizeHandleElements.forEach((handle, direction) => {
                handle.style.left = direction.includes("w")
                    ? edge.left
                        ? `${HANDLE_INSET}px`
                        : ""
                    : "";
                handle.style.right = direction.includes("e")
                    ? edge.right
                        ? `${HANDLE_INSET}px`
                        : ""
                    : "";
                handle.style.top = direction.includes("n")
                    ? edge.top
                        ? `${HANDLE_INSET}px`
                        : ""
                    : "";
                handle.style.bottom = direction.includes("s")
                    ? edge.bottom
                        ? `${HANDLE_INSET}px`
                        : ""
                    : "";
            });
        };
        updateResizeHandleLayout();

        // 拖拽状态变量
        let isDragging = false;
        let hasDragStarted = false;
        let startX, startY, startLeft, startTop;
        const DRAG_THRESHOLD = 3;
        let rafId = null;
        let pendingX = 0;
        let pendingY = 0;

        // 拉伸状态变量
        let isResizing = false;
        let resizeDirection = '';
        let resizeStartX, resizeStartY;
        let resizeStartWidth, resizeStartHeight;
        let resizeStartLeft, resizeStartTop;

        // 最大化状态变量
        let isMaximized = defaultOpenLayout === "maximized";
        let preMaximizeState = null;
        let isAltPressed = false;
        let dockSide = initialDockSide;

        /**
         * 保存窗口状态
         */
        const persistWindowState = () => {
            XDataHub.saveState({
                left: windowEl.style.left,
                top: windowEl.style.top,
                width: windowEl.style.width,
                height: windowEl.style.height
            });
        };

        /**
         * 结束拖拽状态并按需保存
         * @param {boolean} shouldSave - 是否保存窗口状态
         */
        const stopDragging = (shouldSave = false) => {
            if (!isDragging) return;

            if (rafId) {
                cancelAnimationFrame(rafId);
                rafId = null;
            }

            if (hasDragStarted) {
                updatePosition(pendingX, pendingY);
                if (shouldSave) {
                    persistWindowState();
                }
            }

            header.classList.remove("dragging");
            document.body.classList.remove("xz3r0-dragging");
            document.body.style.userSelect = "";
            isDragging = false;
            hasDragStarted = false;
        };

        /**
         * 结束拉伸状态并按需保存
         * @param {boolean} shouldSave - 是否保存窗口状态
         */
        const stopResizing = (shouldSave = false) => {
            if (!isResizing) return;

            isResizing = false;
            resizeDirection = "";
            document.body.classList.remove("xz3r0-resizing");
            document.body.style.userSelect = "";

            if (shouldSave) {
                persistWindowState();
            }
        };

        /**
         * 重置交互状态，避免残留
         * @param {boolean} shouldSave - 是否保存窗口状态
         */
        const resetInteractionState = (shouldSave = false) => {
            stopDragging(shouldSave);
            stopResizing(shouldSave);
        };

        /**
         * 最大化窗口
         */
        const maximizeWindow = () => {
            if (isMaximized) return;

            // 保存当前状态
            preMaximizeState = {
                left: windowEl.style.left,
                top: windowEl.style.top,
                width: windowEl.style.width,
                height: windowEl.style.height
            };

            // 设置最大化尺寸和位置
            windowEl.style.left = '0px';
            windowEl.style.top = '0px';
            windowEl.style.width = `${window.innerWidth}px`;
            windowEl.style.height = `${window.innerHeight}px`;

            isMaximized = true;
            dockSide = null;
            maxBtn.innerHTML = iconHtml("minimize-2", t("restoreBtn"));
            maxBtn.title = t('restoreBtn');
            maxBtn.classList.add('maximized');
            updateHostTabCompactMode();
            updateResizeHandleLayout();
            updateDockButtonVisual();
        };

        /**
         * 还原窗口
         */
        const restoreWindow = () => {
            if (!isMaximized) return;

            // 恢复之前的状态
            if (preMaximizeState) {
                windowEl.style.left = preMaximizeState.left;
                windowEl.style.top = preMaximizeState.top;
                windowEl.style.width = preMaximizeState.width;
                windowEl.style.height = preMaximizeState.height;
            }

            isMaximized = false;
            preMaximizeState = null;
            dockSide = null;
            maxBtn.innerHTML = iconHtml("maximize-2", t("maxBtn"));
            maxBtn.title = t('maxBtn');
            maxBtn.classList.remove('maximized');
            updateHostTabCompactMode();
            updateResizeHandleLayout();
            updateDockButtonVisual();
        };

        /**
         * 切换最大化/还原状态
         */
        const toggleMaximize = () => {
            if (isMaximized) {
                restoreWindow();
            } else {
                maximizeWindow();
            }
        };

        /**
         * 根据当前停靠状态更新按钮图标与提示文本
         */
        const updateDockButtonVisual = () => {
            const nextSide = dockSide === "left" ? "right" : "left";
            const iconName = nextSide === "left"
                ? "panel-left-close"
                : "panel-right-close";
            const titleKey = nextSide === "left"
                ? "dockLeftBtn"
                : "dockRightBtn";
            dockLeftBtn.innerHTML = iconHtml(iconName, t(titleKey));
            dockLeftBtn.title = t(titleKey);
        };

        /**
         * 停靠到指定方向：贴边、最小宽度、全高贴合可视区
         */
        const dockWindowTo = (side) => {
            resetInteractionState(false);
            isMaximized = false;
            preMaximizeState = null;
            maxBtn.innerHTML = iconHtml("maximize-2", t("maxBtn"));
            maxBtn.title = t("maxBtn");
            maxBtn.classList.remove("maximized");

            const targetSide = side === "right" ? "right" : "left";
            const targetLeft = targetSide === "right"
                ? Math.max(0, window.innerWidth - RESIZE_MIN_WIDTH)
                : 0;

            dockSide = targetSide;
            windowEl.style.left = `${targetLeft}px`;
            windowEl.style.top = "0px";
            windowEl.style.width = `${RESIZE_MIN_WIDTH}px`;
            windowEl.style.height = `${window.innerHeight}px`;

            updateHostTabCompactMode();
            updateResizeHandleLayout();
            updateDockButtonVisual();
            persistWindowState();
        };
        if (isMaximized) {
            maxBtn.innerHTML = iconHtml("minimize-2", t("restoreBtn"));
            maxBtn.title = t("restoreBtn");
            maxBtn.classList.add("maximized");
        }

        /**
         * 应用默认打开布局（居中 75% / 左靠边 / 右靠边）
         */
        const applyDefaultOpenLayout = () => {
            if (defaultOpenLayout === "left" || defaultOpenLayout === "right") {
                dockWindowTo(defaultOpenLayout);
                return;
            }
            if (defaultOpenLayout === "maximized") {
                maximizeWindow();
                persistWindowState();
                return;
            }

            resetInteractionState(false);
            isMaximized = false;
            preMaximizeState = null;
            dockSide = null;
            maxBtn.innerHTML = iconHtml("maximize-2", t("maxBtn"));
            maxBtn.title = t("maxBtn");
            maxBtn.classList.remove("maximized");

            const targetWidth = Math.max(
                RESIZE_MIN_WIDTH,
                Math.floor(window.innerWidth * 0.75)
            );
            const targetHeight = Math.max(
                RESIZE_MIN_HEIGHT,
                Math.floor(window.innerHeight * 0.75)
            );
            const targetLeft = Math.max(
                0,
                (window.innerWidth - targetWidth) / 2
            );
            const targetTop = Math.max(
                0,
                (window.innerHeight - targetHeight) / 2
            );

            windowEl.style.left = `${targetLeft}px`;
            windowEl.style.top = `${targetTop}px`;
            windowEl.style.width = `${targetWidth}px`;
            windowEl.style.height = `${targetHeight}px`;

            updateHostTabCompactMode();
            updateResizeHandleLayout();
            updateDockButtonVisual();
            persistWindowState();
        };

        /**
         * 切换左右停靠
         */
        const toggleDockSide = () => {
            const nextSide = dockSide === "left" ? "right" : "left";
            dockWindowTo(nextSide);
        };
        updateDockButtonVisual();

        /**
         * 窗口尺寸变化时保持最大化窗口贴合视口
         */
        const handleWindowResize = () => {
            if (isMaximized) {
                windowEl.style.width = `${window.innerWidth}px`;
                windowEl.style.height = `${window.innerHeight}px`;
            }
            if (!isMaximized && dockSide) {
                const targetLeft = dockSide === "right"
                    ? Math.max(0, window.innerWidth - RESIZE_MIN_WIDTH)
                    : 0;
                windowEl.style.left = `${targetLeft}px`;
                windowEl.style.top = "0px";
                windowEl.style.width = `${RESIZE_MIN_WIDTH}px`;
                windowEl.style.height = `${window.innerHeight}px`;
            }
            if (!isMaximized) {
                const viewportWidth = window.innerWidth;
                const viewportHeight = window.innerHeight;

                const currentWidth = windowEl.offsetWidth;
                const currentHeight = windowEl.offsetHeight;

                let nextWidth = currentWidth;
                let nextHeight = currentHeight;

                // 视口变小且当前窗口超出时，向下收缩并贴边；
                // 收缩到最小尺寸后不再继续缩小。
                if (
                    currentWidth > viewportWidth
                    && viewportWidth >= RESIZE_MIN_WIDTH
                ) {
                    nextWidth = viewportWidth;
                } else if (
                    currentWidth > viewportWidth
                    && viewportWidth < RESIZE_MIN_WIDTH
                ) {
                    nextWidth = RESIZE_MIN_WIDTH;
                }

                if (
                    currentHeight > viewportHeight
                    && viewportHeight >= RESIZE_MIN_HEIGHT
                ) {
                    nextHeight = viewportHeight;
                } else if (
                    currentHeight > viewportHeight
                    && viewportHeight < RESIZE_MIN_HEIGHT
                ) {
                    nextHeight = RESIZE_MIN_HEIGHT;
                }

                if (
                    nextWidth !== currentWidth
                    || nextHeight !== currentHeight
                ) {
                    windowEl.style.width = `${nextWidth}px`;
                    windowEl.style.height = `${nextHeight}px`;
                }

                const widthForClamp = windowEl.offsetWidth;
                const heightForClamp = windowEl.offsetHeight;
                const maxLeft = viewportWidth - widthForClamp;
                const maxTop = viewportHeight - heightForClamp;

                let left = windowEl.offsetLeft;
                let top = windowEl.offsetTop;

                if (maxLeft >= 0) {
                    left = Math.max(0, Math.min(left, maxLeft));
                } else {
                    left = 0;
                }
                if (maxTop >= 0) {
                    top = Math.max(0, Math.min(top, maxTop));
                } else {
                    top = 0;
                }

                windowEl.style.left = `${left}px`;
                windowEl.style.top = `${top}px`;
            }
            updateHostTabCompactMode();
            updateResizeHandleLayout();
            updateDockButtonVisual();
        };

        /**
         * 使用 requestAnimationFrame 优化拖拽性能
         * 限制窗口位置，确保窗口四边都不超出屏幕边界
         * @param {number} x - 目标 X 坐标
         * @param {number} y - 目标 Y 坐标
         */
        const updatePosition = (x, y) => {
            // 窗口左边不能小于0（不能超出屏幕左边缘）
            // 窗口右边不能大于屏幕宽度（不能超出屏幕右边缘）
            const maxLeft = window.innerWidth - windowEl.offsetWidth;
            const newLeft = Math.max(0, Math.min(maxLeft, x));

            // 窗口顶部不能小于0（不能超出屏幕上边缘）
            // 窗口底部不能大于屏幕高度（不能超出屏幕下边缘）
            const maxTop = window.innerHeight - windowEl.offsetHeight;
            const newTop = Math.max(0, Math.min(maxTop, y));

            windowEl.style.left = `${newLeft}px`;
            windowEl.style.top = `${newTop}px`;
            updateResizeHandleLayout();
        };

        /**
         * 动画帧回调，用于优化拖拽性能
         */
        const onAnimationFrame = () => {
            if (isDragging && hasDragStarted) {
                updatePosition(pendingX, pendingY);
                rafId = requestAnimationFrame(onAnimationFrame);
            } else {
                rafId = null;
            }
        };

        /**
         * 鼠标移动事件处理
         * 处理窗口拖拽和拉伸
         * @param {MouseEvent} e - 鼠标事件对象
         */
        const handleMouseMove = (e) => {
            if (isDragging) {
                const dx = e.clientX - startX;
                const dy = e.clientY - startY;
                const distance = Math.sqrt(dx * dx + dy * dy);

                if (!hasDragStarted && distance > DRAG_THRESHOLD) {
                    hasDragStarted = true;
                    header.classList.add("dragging");
                    document.body.classList.add("xz3r0-dragging");
                    document.body.style.userSelect = "none";

                    if (!rafId) {
                        rafId = requestAnimationFrame(onAnimationFrame);
                    }
                }

                if (hasDragStarted) {
                    pendingX = startLeft + dx;
                    pendingY = startTop + dy;
                }
            }

            if (isResizing) {
                const dx = e.clientX - resizeStartX;
                const dy = e.clientY - resizeStartY;

                let newWidth = resizeStartWidth;
                let newHeight = resizeStartHeight;
                let newLeft = resizeStartLeft;
                let newTop = resizeStartTop;

                // 根据拉伸方向计算新尺寸和位置
                if (resizeDirection.includes('e')) {
                    // 限制右边不超出屏幕
                    const maxWidth = window.innerWidth - resizeStartLeft;
                    newWidth = Math.max(RESIZE_MIN_WIDTH, Math.min(resizeStartWidth + dx, maxWidth));
                }
                if (resizeDirection.includes('w')) {
                    // 限制左边不超出屏幕
                    // 向左拉伸时，dx为负值，窗口宽度增加，left减小
                    // 限制条件：newLeft >= 0 且 newWidth >= RESIZE_MIN_WIDTH
                    // dx的最小值（最负）受限于：resizeStartLeft + dx >= 0 即 dx >= -resizeStartLeft
                    // dx的最大值（最正）受限于：resizeStartWidth - dx >= RESIZE_MIN_WIDTH 即 dx <= resizeStartWidth - RESIZE_MIN_WIDTH
                    const minDx = -resizeStartLeft;  // 不能向左超过屏幕左边缘
                    const maxDx = resizeStartWidth - RESIZE_MIN_WIDTH;  // 不能小于最小宽度
                    const clampedDx = Math.max(minDx, Math.min(dx, maxDx));
                    newWidth = resizeStartWidth - clampedDx;
                    newLeft = resizeStartLeft + clampedDx;
                }
                if (resizeDirection.includes('s')) {
                    // 限制底边不超出屏幕
                    const maxHeight = window.innerHeight - resizeStartTop;
                    newHeight = Math.max(RESIZE_MIN_HEIGHT, Math.min(resizeStartHeight + dy, maxHeight));
                }
                if (resizeDirection.includes('n')) {
                    // 限制顶边不超出屏幕
                    // 向上拉伸时，dy为负值，窗口高度增加，top减小
                    // 限制条件：newTop >= 0 且 newHeight >= RESIZE_MIN_HEIGHT
                    // dy的最小值（最负）受限于：resizeStartTop + dy >= 0 即 dy >= -resizeStartTop
                    // dy的最大值（最正）受限于：resizeStartHeight - dy >= RESIZE_MIN_HEIGHT 即 dy <= resizeStartHeight - RESIZE_MIN_HEIGHT
                    const minDy = -resizeStartTop;  // 不能向上超过屏幕顶部
                    const maxDy = resizeStartHeight - RESIZE_MIN_HEIGHT;  // 不能小于最小高度
                    const clampedDy = Math.max(minDy, Math.min(dy, maxDy));
                    newHeight = resizeStartHeight - clampedDy;
                    newTop = resizeStartTop + clampedDy;
                }

                windowEl.style.width = `${newWidth}px`;
                windowEl.style.height = `${newHeight}px`;
                windowEl.style.left = `${newLeft}px`;
                windowEl.style.top = `${newTop}px`;
                updateHostTabCompactMode();
                updateResizeHandleLayout();
            }
        };

        /**
         * 鼠标释放事件处理
         * 保存窗口状态并清除拖拽/拉伸状态
         * 确保一旦鼠标左键松开就立即重置所有状态
         */
        const handleMouseUp = () => {
            // 鼠标松开时统一结束拖拽/拉伸并保存状态
            resetInteractionState(true);
        };

        // 绑定全局鼠标事件 - 使用 pointer 事件以支持 setPointerCapture
        document.addEventListener("pointermove", handleMouseMove);
        document.addEventListener("pointerup", handleMouseUp);
        window.addEventListener("resize", handleWindowResize);

        // 标题栏拖拽事件 - 使用 pointer 事件保持一致性
        header.addEventListener("pointerdown", (e) => {
            if (e.target.closest(".xz3r0-datahub-window-btn")) return;
            if (e.target.closest(".xz3r0-opacity-control")) return;
            // 只有左键点击才触发拖拽
            if (e.button !== 0) return;

            dockSide = null;
            updateDockButtonVisual();
            isDragging = true;
            hasDragStarted = false;
            startX = e.clientX;
            startY = e.clientY;
            startLeft = windowEl.offsetLeft;
            startTop = windowEl.offsetTop;
            pendingX = startLeft;
            pendingY = startTop;

            // 捕获鼠标指针，确保即使鼠标移出标题栏也能继续接收事件
            header.setPointerCapture(e.pointerId);

            e.preventDefault();
        });

        // 双击标题栏切换最大化/还原（与右上角按钮行为一致）
        header.addEventListener("dblclick", (e) => {
            if (e.target.closest(".xz3r0-datahub-window-btn")) return;
            if (e.target.closest(".xz3r0-opacity-control")) return;
            toggleMaximize();
            e.preventDefault();
        });

        // 当失去指针捕获时（如鼠标松开），重置拖拽状态
        header.addEventListener('lostpointercapture', () => {
            stopDragging(true);
        });

        // 当鼠标移入标题栏时，检查鼠标左键是否真正按下
        // 修复：鼠标移出后松开再移入会自动进入拖动状态的问题
        header.addEventListener('pointerenter', (e) => {
            // 如果处于拖拽状态但鼠标左键未按下，则重置状态
            if (isDragging && (e.buttons & 1) === 0) {
                stopDragging(false);
            }
        });

        // Alt + 鼠标左键拖动窗口（在窗口任意位置）
        // 通过监听 keydown/keyup 来检测 Alt 键状态，并控制 iframe 的 pointer-events
        const handleKeyDown = (e) => {
            if (e.key === 'Alt' && !isAltPressed) {
                isAltPressed = true;
                // 禁用 iframe 的鼠标事件，让事件能够传递到父窗口
                updateIframePointerEvents('none');
            }
        };

        const handleKeyUp = (e) => {
            if (e.key === 'Alt' && isAltPressed) {
                isAltPressed = false;
                // 恢复 iframe 的鼠标事件
                updateIframePointerEvents('auto');
            }
        };

        // 当窗口失去焦点时，重置 Alt 状态
        const handleWindowBlur = () => {
            if (isAltPressed) {
                isAltPressed = false;
                updateIframePointerEvents('auto');
            }
        };

        document.addEventListener('keydown', handleKeyDown);
        document.addEventListener('keyup', handleKeyUp);
        window.addEventListener('blur', handleWindowBlur);

        windowEl.addEventListener('pointerdown', (e) => {
            // 检查是否按住 Alt 键且是左键点击
            if (!e.altKey || e.button !== 0) return;
            // 排除标题栏、按钮和拉伸手柄（这些有独立的事件处理）
            if (e.target.closest('.xz3r0-datahub-window-header') ||
                e.target.closest('.xz3r0-resize-handle')) return;

            dockSide = null;
            updateDockButtonVisual();
            isDragging = true;
            hasDragStarted = false;
            startX = e.clientX;
            startY = e.clientY;
            startLeft = windowEl.offsetLeft;
            startTop = windowEl.offsetTop;
            pendingX = startLeft;
            pendingY = startTop;

            // 捕获鼠标指针
            windowEl.setPointerCapture(e.pointerId);

            e.preventDefault();
            e.stopPropagation();
        });

        // 当失去指针捕获时，重置 Alt+拖拽状态
        windowEl.addEventListener('lostpointercapture', () => {
            stopDragging(true);
        });

        // 拉伸手柄事件 - 使用 pointer 事件确保捕获能正常工作
        windowEl.querySelectorAll('.xz3r0-resize-handle').forEach(handle => {
            handle.addEventListener('pointerdown', (e) => {
                // 只有左键点击才触发拉伸
                if (e.button !== 0) return;

                dockSide = null;
                updateDockButtonVisual();
                isResizing = true;
                resizeDirection = handle.dataset.direction;
                resizeStartX = e.clientX;
                resizeStartY = e.clientY;
                resizeStartWidth = windowEl.offsetWidth;
                resizeStartHeight = windowEl.offsetHeight;
                resizeStartLeft = windowEl.offsetLeft;
                resizeStartTop = windowEl.offsetTop;

                document.body.classList.add("xz3r0-resizing");
                document.body.style.userSelect = "none";

                // 捕获鼠标指针，确保即使鼠标移出手柄也能继续接收事件
                handle.setPointerCapture(e.pointerId);

                e.preventDefault();
                e.stopPropagation();
            });

            // 当失去指针捕获时（如鼠标松开），重置拉伸状态
            handle.addEventListener('lostpointercapture', () => {
                stopResizing(true);
            });
        });

        // 当鼠标移入拉伸手柄时，检查鼠标左键是否真正按下
        // 修复：鼠标移出后松开再移入会自动进入拉伸状态的问题
        windowEl.querySelectorAll('.xz3r0-resize-handle').forEach(handle => {
            handle.addEventListener('pointerenter', (e) => {
                // 如果处于拉伸状态但鼠标左键未按下，则重置状态
                if (isResizing && (e.buttons & 1) === 0) {
                    stopResizing(false);
                }
            });
        });

        /**
         * 窗口实例对象
         * 提供 show/hide/destroy 方法控制窗口
         */
        const state = {
            isVisible: true,
            windowEl,
            dataFrame,
            workflowFrame,
            setHostTab,

            /**
             * 显示窗口
             */
            show() {
                if (!this.isVisible) {
                    this.applyDefaultOpenLayout();
                }
                windowEl.style.display = "flex";
                this.isVisible = true;
            },

            /**
             * 隐藏窗口
             */
            hide() {
                windowEl.style.display = "none";
                this.isVisible = false;
            },

            applyDefaultOpenLayout() {
                applyDefaultOpenLayout();
            },

            /**
             * 销毁窗口
             * 移除事件监听和 DOM 元素，清理资源
             */
            destroy() {
                resetInteractionState(false);
                isAltPressed = false;
                updateIframePointerEvents("auto");
                document.removeEventListener("pointermove", handleMouseMove);
                document.removeEventListener("pointerup", handleMouseUp);
                document.removeEventListener("keydown", handleKeyDown);
                document.removeEventListener("keyup", handleKeyUp);
                window.removeEventListener("blur", handleWindowBlur);
                window.removeEventListener("resize", handleWindowResize);
                windowEl.remove();
                XDataHub.instance = null;
            }
        };

        // 关闭按钮事件
        closeBtn.addEventListener("click", () => state.hide());

        // 靠左停靠按钮事件
        dockLeftBtn.addEventListener("click", () => toggleDockSide());

        // 最大化按钮事件
        maxBtn.addEventListener("click", () => toggleMaximize());

        // 透明度调整事件
        opacitySlider.addEventListener("input", (e) => {
            const opacity = e.target.value / 100;
            windowEl.style.opacity = opacity;
            opacityValue.textContent = `${e.target.value}%`;
        });

        // 透明度调整完成时保存状态
        opacitySlider.addEventListener("change", (e) => {
            localStorage.setItem('Xz3r0.Window.Opacity', e.target.value);
        });

        // 加载保存的透明度设置
        const savedOpacity = localStorage.getItem('Xz3r0.Window.Opacity');
        if (savedOpacity) {
            const opacityValue_num = parseInt(savedOpacity, 10);
            if (opacityValue_num >= 20 && opacityValue_num <= 100) {
                opacitySlider.value = opacityValue_num;
                windowEl.style.opacity = opacityValue_num / 100;
                opacityValue.textContent = `${opacityValue_num}%`;
            }
        }

        return state;
    }
};
xdataHubRef = XDataHub;


