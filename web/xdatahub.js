/**
 * XDataHub - ComfyUI 浮动窗口扩展
 * ===================================
 *
 * 功能概述:
 * ---------
 * 为 ComfyUI 提供一个可拖拽、可调整大小的浮动窗口容器，
 * 用于嵌入 XDataHub 数据浏览网页工具。
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
 *    - 通过 iframe 加载 XDataHub 内部页面
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
 * - xdatahub_app.html: 窗口内加载的网页内容
 *
 * @author Xz3r0
 * @project ComfyUI-Xz3r0-Nodes
 *
 * 颜色规范（强约束）:
 * 1) 本文件默认必须引用 `xdatahub-color-tokens.css`。
 * 2) 默认禁止在本文件直接硬编码颜色值；如需硬编码，必须由用户明确要求。
 * 3) 文本与边框命名必须镜像：standard/hover/active/emphasis。
 */

import { app } from "../../scripts/app.js";

/**
 * 菜单按钮引用
 */
let menuButton = null;
const HOTKEY_SETTING_ID = "Xz3r0.XDataHub.Hotkey";
const DEFAULT_HOTKEY_SPEC = "Alt + X";
const OPEN_LAYOUT_SETTING_ID = "Xz3r0.XDataHub.DefaultOpenLayout";
const CLOSE_BEHAVIOR_SETTING_ID = "Xz3r0.XDataHub.WindowCloseBehavior";
const OPEN_LAYOUT_VALUE_CENTER = "center";
const OPEN_LAYOUT_VALUE_LEFT = "left";
const OPEN_LAYOUT_VALUE_RIGHT = "right";
const OPEN_LAYOUT_VALUE_MAXIMIZED = "maximized";
const CLOSE_BEHAVIOR_VALUE_HIDE = "hide";
const CLOSE_BEHAVIOR_VALUE_DESTROY = "destroy";
const OPEN_LAYOUT_OPTION_CODES = [
    OPEN_LAYOUT_VALUE_CENTER,
    OPEN_LAYOUT_VALUE_LEFT,
    OPEN_LAYOUT_VALUE_RIGHT,
    OPEN_LAYOUT_VALUE_MAXIMIZED,
];
const CLOSE_BEHAVIOR_OPTION_CODES = [
    CLOSE_BEHAVIOR_VALUE_HIDE,
    CLOSE_BEHAVIOR_VALUE_DESTROY,
];
const WINDOW_STATE_STORAGE_KEY = "Xz3r0.XDataHub.WindowState.v1";
const WINDOW_STATE_VERSION = 1;
let hotkeySpec = DEFAULT_HOTKEY_SPEC;
let hotkeySettingInitialized = false;
let defaultOpenLayout = "center";
let closeBehavior = "hide";
let xdataHubRef = null;
let uiLocalePrimary = {};
let uiLocaleFallback = {};

const UI_KEYS = {
    windowTitle: "xdatahub.ui.shell.window_title",
    closeBtn: "xdatahub.ui.shell.btn.close",
    maxBtn: "xdatahub.ui.shell.btn.maximize",
    restoreBtn: "xdatahub.ui.shell.btn.restore",
    dockLeftBtn: "xdatahub.ui.shell.btn.dock_left",
    dockRightBtn: "xdatahub.ui.shell.btn.dock_right",
    menuTooltip: "xdatahub.ui.shell.menu_tooltip",
    opacityLabel: "xdatahub.ui.shell.opacity_label",
    hotkeyUpdated: "xdatahub.ui.shell.toast.hotkey_updated",
    toggleCommandLabel: "xdatahub.ui.shell.command.toggle_window",
    tabHistory: "xdatahub.ui.shell.tab.history",
    tabImage: "xdatahub.ui.shell.tab.image",
    tabVideo: "xdatahub.ui.shell.tab.video",
    tabAudio: "xdatahub.ui.shell.tab.audio",
};

const HOST_TABS = [
    { id: "history", icon: "history", textKey: UI_KEYS.tabHistory },
    { id: "image", icon: "image", textKey: UI_KEYS.tabImage },
    { id: "video", icon: "video", textKey: UI_KEYS.tabVideo },
    { id: "audio", icon: "audio-lines", textKey: UI_KEYS.tabAudio },
];
const XDATAHUB_ASSET_VER = "20260325-070";
const XDATAHUB_THEME_CSS_ID = "xdatahub-color-tokens-css";
const XDATAHUB_THEME_CSS_HREF =
    "/extensions/ComfyUI-Xz3r0-Nodes/xdatahub-color-tokens.css"
    + `?v=${XDATAHUB_ASSET_VER}`;
const XDATAHUB_THEME_MODE_VALUES = new Set(["dark", "light"]);
let currentThemeMode = "dark";

function normalizeThemeMode(value) {
    const mode = String(value || "").trim().toLowerCase();
    return XDATAHUB_THEME_MODE_VALUES.has(mode) ? mode : "dark";
}

function ensureColorTokensStylesheet() {
    if (document.getElementById(XDATAHUB_THEME_CSS_ID)) {
        return;
    }
    const link = document.createElement("link");
    link.id = XDATAHUB_THEME_CSS_ID;
    link.rel = "stylesheet";
    link.href = XDATAHUB_THEME_CSS_HREF;
    document.head.appendChild(link);
}

function applyThemeMode(mode) {
    const normalized = normalizeThemeMode(mode);
    if (normalized === currentThemeMode) {
        return;
    }
    currentThemeMode = normalized;
    xdataHubRef?.instance?.applyThemeMode?.(currentThemeMode);
}

async function syncThemeModeFromSettings() {
    try {
        const response = await fetch("/xz3r0/xdatahub/settings");
        const payload = await response.json();
        if (response.ok && payload?.status === "success") {
            applyThemeMode(payload?.settings?.theme_mode);
            return currentThemeMode;
        }
    } catch {
        // 忽略拉取失败，保留本地默认值 dark。
    }
    applyThemeMode(currentThemeMode);
    return currentThemeMode;
}

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
            <svg
                class="xz3r0-menu-icon"
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                aria-hidden="true"
            >
                <path d="M6 16c5 0 7-8 12-8a4 4 0 0 1 0 8c-5 0-7-8-12-8a4 4 0 1 0 0 8" />
            </svg>
        </span>
    `;
}

function getLocale() {
    const locale = window.app?.extensionManager?.setting?.get('Comfy.Locale')
        || localStorage.getItem('Comfy.Locale')
        || navigator.language
        || 'en';
    return String(locale).replace("_", "-").split('-')[0].toLowerCase();
}

function readUiText(key, fallback) {
    const text = uiLocalePrimary?.[key] ?? uiLocaleFallback?.[key];
    if (typeof text === "string" && text.length > 0) {
        return text;
    }
    return fallback;
}

function t(token, fallback = "") {
    const key = UI_KEYS[token] ?? token;
    return readUiText(key, fallback || key);
}

async function fetchLocaleJson(localeCode) {
    try {
        const response = await fetch(
            `/xz3r0/xdatahub/i18n/ui?locale=${encodeURIComponent(localeCode)}`,
            { cache: "no-cache" }
        );
        if (!response.ok) {
            return {};
        }
        const payload = await response.json();
        const data = payload?.dict;
        return data && typeof data === "object" ? data : {};
    } catch {
        return {};
    }
}

async function loadUiLocaleBundle(localeOverride = null) {
    const locale = String(localeOverride || getLocale() || "en").toLowerCase();
    uiLocaleFallback = await fetchLocaleJson("en");
    if (locale === "en") {
        uiLocalePrimary = uiLocaleFallback;
        return;
    }
    uiLocalePrimary = await fetchLocaleJson(locale);
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

function equalsSettingOption(value, optionCode, aliases = []) {
    const text = String(value || "").trim().toLowerCase();
    if (!text) {
        return false;
    }
    if (text === optionCode.toLowerCase()) {
        return true;
    }
    return aliases.some((alias) => text === String(alias).trim().toLowerCase());
}

function normalizeDefaultOpenLayout(value) {
    if (equalsSettingOption(value, OPEN_LAYOUT_VALUE_LEFT, ["dock left"])) {
        return OPEN_LAYOUT_VALUE_LEFT;
    }
    if (equalsSettingOption(value, OPEN_LAYOUT_VALUE_RIGHT, ["dock right"])) {
        return OPEN_LAYOUT_VALUE_RIGHT;
    }
    if (
        equalsSettingOption(
            value,
            OPEN_LAYOUT_VALUE_MAXIMIZED,
            ["maximize"]
        )
    ) {
        return OPEN_LAYOUT_VALUE_MAXIMIZED;
    }
    return OPEN_LAYOUT_VALUE_CENTER;
}

function readDefaultOpenLayoutFromSettings() {
    const currentValue = app.extensionManager?.setting?.get(
        OPEN_LAYOUT_SETTING_ID
    ) || OPEN_LAYOUT_VALUE_CENTER;
    return normalizeDefaultOpenLayout(currentValue);
}

function normalizeCloseBehavior(value) {
    if (
        equalsSettingOption(
            value,
            CLOSE_BEHAVIOR_VALUE_DESTROY,
            ["destroy (lower memory)"]
        )
    ) {
        return CLOSE_BEHAVIOR_VALUE_DESTROY;
    }
    return CLOSE_BEHAVIOR_VALUE_HIDE;
}

function readCloseBehaviorFromSettings() {
    const currentValue = app.extensionManager?.setting?.get(
        CLOSE_BEHAVIOR_SETTING_ID
    ) || CLOSE_BEHAVIOR_VALUE_HIDE;
    return normalizeCloseBehavior(currentValue);
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
            label: t("toggleCommandLabel", "Toggle XDataHub Window"),
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
            name: "XDataHub Default Open Layout",
            type: "combo",
            options: OPEN_LAYOUT_OPTION_CODES,
            defaultValue: OPEN_LAYOUT_VALUE_CENTER,
            tooltip: "Default window layout when opening XDataHub.",
            // 注意：分类前缀 EMOJI（♾️）为固定分组标识，禁止修改。
            category: ["♾️ Xz3r0", "XDataHub", "OpenLayout"],
            onChange: (value) => {
                defaultOpenLayout = normalizeDefaultOpenLayout(value);
                applyDefaultOpenLayoutToOpenWindow();
            }
        },
        {
            id: CLOSE_BEHAVIOR_SETTING_ID,
            name: "XDataHub Close Button Behavior",
            type: "combo",
            options: CLOSE_BEHAVIOR_OPTION_CODES,
            defaultValue: CLOSE_BEHAVIOR_VALUE_HIDE,
            tooltip: "Hide: faster reopen, higher memory. Destroy: lower memory, slower reopen.",
            // 注意：分类前缀 EMOJI（♾️）为固定分组标识，禁止修改。
            category: ["♾️ Xz3r0", "XDataHub", "CloseBehavior"],
            onChange: (value) => {
                closeBehavior = normalizeCloseBehavior(value);
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
                xdataHubRef?.instance?.postHotkeySpecToDataFrame?.();
                if (!hotkeySettingInitialized) {
                    hotkeySettingInitialized = true;
                    return;
                }
                app.extensionManager?.toast?.add?.({
                    severity: "info",
                    summary: "XDataHub",
                    detail: t(
                        "hotkeyUpdated",
                        "Hotkey updated, refresh page to apply"
                    ),
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
        await loadUiLocaleBundle();
        hotkeySpec = readHotkeySpecFromSettings();
        defaultOpenLayout = readDefaultOpenLayoutFromSettings();
        closeBehavior = readCloseBehaviorFromSettings();
        ensureColorTokensStylesheet();
        await syncThemeModeFromSettings();
        try {
            const mod = await import("./xmediaget_extension.js");
            const init = mod?.initXMediaGetExtension
                || globalThis.__xmediaget_extension_init__;
            if (typeof init === "function") {
                init();
            }
        } catch {}

        // 创建并注入窗口样式
        const style = document.createElement("style");
        style.textContent = `
            .xz3r0-datahub-window {
                position: fixed;
                z-index: ${WINDOW_Z_INDEX_DEFAULT};
                background: var(--theme-bg-main);
                border: none;
                border-radius: 0;
                box-shadow: var(--xdh-window-shadow);
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
                padding: 5.2px 10px;
                background: var(--xdh-window-header-bg);
                border-bottom: 1px solid var(--border-standard);
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
                color: var(--text-standard);
                font-size: 14px;
            }
            .xz3r0-datahub-window-title .xz3r0-title-icon {
                width: 16px;
                height: 16px;
                display: block;
                filter: var(--icon-color-filter);
            }
            .xz3r0-datahub-menu-btn .xz3r0-datahub-menu-content {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                gap: 6px;
            }
            .xz3r0-datahub-menu-btn {
                position: relative;
                padding: 2px 8px;
                border-radius: 999px;
                border: 1px solid transparent;
                background: transparent !important;
                overflow: hidden;
                isolation: isolate;
                box-shadow:
                    inset 0 1px 0 transparent,
                    inset 0 -1px 0 transparent,
                    inset 0 0 0 1px transparent;
                transition: border-color 150ms ease,
                    background-color 150ms ease,
                    box-shadow 150ms ease,
                    transform 150ms ease;
            }
            .xz3r0-datahub-menu-btn::after {
                content: "";
                position: absolute;
                top: 0;
                left: -45%;
                width: 45%;
                height: 100%;
                background: linear-gradient(
                    120deg,
                    transparent 0%,
                    var(--hover-accent-bg) 50%,
                    transparent 100%
                );
                opacity: 0;
                transform: translateX(0);
                pointer-events: none;
                z-index: 0;
            }
            .xz3r0-datahub-menu-btn:hover::after {
                animation: xdhMenuSweep 720ms ease-in-out;
            }
            @keyframes xdhMenuSweep {
                0% {
                    opacity: 0;
                    transform: translateX(0);
                }
                20% {
                    opacity: 0.65;
                }
                80% {
                    opacity: 0.35;
                }
                100% {
                    opacity: 0;
                    transform: translateX(260%);
                }
            }
            .xz3r0-datahub-menu-btn:hover {
                border-color: var(--border-hover);
                background: var(--hover-accent-bg) !important;
                box-shadow:
                    inset 0 1px 0 var(--border-hover),
                    inset 0 -1px 0 var(--border-hover),
                    inset 0 0 0 1px var(--border-hover),
                    inset 0 0 8px var(--btn-active-color);
                transform: translateY(-1px) scale(1.02);
            }
            .xz3r0-datahub-menu-btn:active {
                border-color: var(--border-hover);
                background: var(--hover-accent-bg) !important;
                box-shadow:
                    inset 0 1px 0 var(--border-hover),
                    inset 0 -1px 0 var(--border-hover),
                    inset 0 0 0 1px var(--border-hover),
                    inset 0 0 10px var(--btn-active-color),
                    inset 0 2px 6px rgba(0, 0, 0, 0.12);
                transform: translateY(0) scale(0.98);
            }
            .xz3r0-datahub-menu-btn:focus-visible {
                outline: 2px solid var(--border-hover);
                outline-offset: 2px;
            }
            .xz3r0-datahub-menu-btn .xz3r0-menu-icon {
                width: 17px;
                height: 17px;
                display: block;
                stroke: var(--xdh-brand-pink);
                stroke-width: 2.6;
                stroke-linecap: round;
                stroke-linejoin: round;
            }
            .xz3r0-datahub-window-controls {
                display: flex;
                gap: 4px;
                position: relative;
                z-index: 10030;
            }
            .xz3r0-datahub-window-btn {
                width: 26.25px;
                height: 26.25px;
                border: none;
                border-radius: 4px;
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: center;
                background: transparent;
                color: var(--text-standard);
                transition: all 0.2s;
            }
            .xz3r0-datahub-window-btn:hover {
                background: var(--hover-accent-bg);
                box-shadow: var(--btn-hover-glow-soft);
            }
            .xz3r0-datahub-window-btn:active {
                background: var(--btn-active-color);
                box-shadow: var(--btn-press-glow-inset);
            }
            .xz3r0-datahub-window-btn .xz3r0-icon {
                width: 18px;
                height: 18px;
                display: block;
                filter: var(--icon-color-filter);
            }
            .xz3r0-datahub-window-btn:hover .xz3r0-icon {
                filter: var(--icon-color-filter-active);
            }
            .xz3r0-datahub-window-content {
                flex: 1;
                overflow: hidden;
                min-height: 0;
                display: flex;
                flex-direction: column;
                background: var(--bg-panel);
                border-radius: 0;
            }
            .xz3r0-datahub-window-content iframe {
                width: 100%;
                height: 100%;
                border: none;
            }
            .xz3r0-datahub-window-host-tabs {
                display: flex;
                gap: 6px;
                padding: 10px 10px 10px 10px;
                background: var(--xdh-tab-strip-bg);
                box-shadow: inset 0 -1px 0 var(--xdh-tab-strip-divider);
                flex-shrink: 0;
                overflow: hidden;
                justify-content: center;
                position: relative;
                align-items: center;
            }
            .xz3r0-datahub-window.compact-tabs .xz3r0-datahub-window-host-tabs {
                padding: 10px 8px 10px 8px;
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
                background: var(--border-standard);
                pointer-events: none;
            }
            .xz3r0-datahub-window-host-tabs-indicator {
                position: absolute;
                bottom: 0;
                height: 2px;
                width: 24px;
                border-radius: 999px;
                background: var(--btn-active-color);
                box-shadow: none;
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
                border: 1px solid var(--border-standard);
                background: var(--bg-panel);
                color: var(--text-emphasis);
                border-radius: 10px;
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
                overflow: hidden;
                backdrop-filter: blur(var(--xdh-window-tab-blur));
                -webkit-backdrop-filter: blur(var(--xdh-window-tab-blur));
                box-shadow: none;
            }
            .xz3r0-datahub-window-host-tab::before {
                opacity: 0;
                display: none;
            }
            .xz3r0-datahub-window-host-tab.active::before {
                opacity: 0;
            }
            .xz3r0-datahub-window-host-tab:not(.active) {
                border-color: var(--border-standard);
            }
            .xz3r0-datahub-window-host-tab-icon {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                line-height: 1;
                margin-right: 4px;
                position: relative;
                z-index: 1;
            }
            .xz3r0-datahub-window-host-tab-icon .xz3r0-icon {
                width: 16px;
                height: 16px;
                display: block;
                filter: var(--icon-color-filter);
            }
            .xz3r0-datahub-window-host-tab.active
            .xz3r0-datahub-window-host-tab-icon .xz3r0-icon {
                filter: var(--icon-color-filter-active);
            }
            .xz3r0-datahub-window-host-tab-text {
                display: inline;
                position: relative;
                z-index: 1;
            }
            @keyframes xz3r0TabBorderBreath {
                0%, 100% {
                    border-color: var(--border-standard);
                }
                50% {
                    border-color: var(--border-hover);
                }
            }
            .xz3r0-datahub-window-host-tab:not(.active):hover {
                color: var(--text-standard);
                border-color: var(--border-standard);
                background: var(--hover-accent-bg);
                box-shadow: none;
                animation: xz3r0TabBorderBreath 1.15s ease-in-out infinite;
            }
            .xz3r0-datahub-window-host-tab.active {
                border-color: var(--border-active);
                color: var(--text-active);
                font-weight: 700;
                background: var(--btn-active-color);
                box-shadow: none;
                animation: none;
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
                border-top: 6px solid var(--btn-active-color);
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
            .xz3r0-resize-handle-n-left,
            .xz3r0-resize-handle-n-right {
                top: -8px;
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
                /* 角点命中做成外侧 L 形，避免压住标题栏按钮中心区域 */
                clip-path: polygon(
                    0 0,
                    100% 0,
                    100% 100%,
                    58% 100%,
                    58% 42%,
                    0 42%
                );
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
                font-size: 12px;
                color: var(--text-standard);
                font-weight: 700;
            }
            .xz3r0-opacity-slider {
                width: 84px;
                height: 16px;
                -webkit-appearance: none;
                appearance: none;
                background: transparent;
                border-radius: 999px;
                outline: none;
                cursor: pointer;
            }
            .xz3r0-opacity-slider::-webkit-slider-runnable-track {
                height: 4px;
                background: var(--border-standard);
                border-radius: 999px;
            }
            .xz3r0-opacity-slider::-webkit-slider-thumb {
                -webkit-appearance: none;
                appearance: none;
                width: 13px;
                height: 13px;
                margin-top: -4.5px;
                background: var(--xdh-icon-color);
                border-radius: 50%;
                cursor: pointer;
                transition: background 0.2s;
            }
            .xz3r0-opacity-slider::-webkit-slider-thumb:hover {
                background: var(--btn-active-color);
            }
            .xz3r0-opacity-slider::-moz-range-thumb {
                width: 13px;
                height: 13px;
                background: var(--xdh-icon-color);
                border-radius: 50%;
                cursor: pointer;
                border: none;
                transition: background 0.2s;
            }
            .xz3r0-opacity-slider::-moz-range-track {
                height: 4px;
                background: var(--border-standard);
                border-radius: 999px;
            }
            .xz3r0-opacity-slider::-moz-range-thumb:hover {
                background: var(--btn-active-color);
            }
            .xz3r0-opacity-value {
                font-size: 12px;
                color: var(--text-standard);
                font-weight: 700;
                display: inline-block;
                width: 4ch;
                text-align: right;
                font-variant-numeric: tabular-nums;
            }
        `;
        document.head.appendChild(style);

        // 尝试在新版 ComfyUI UI 中添加菜单按钮
        if (app.menu?.settingsGroup) {
            try {
                const { ComfyButton } = await import("../../scripts/ui/components/button.js");
                menuButton = new ComfyButton({
                    action: () => XDataHub.toggle(),
                    tooltip: t("menuTooltip", "XDataHub"),
                    content: iconHtml("infinity-bold", t("menuTooltip", "XDataHub")),
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
     * 注：透明度设置单独使用 localStorage 保存
     * @returns {Object|null} 窗口状态对象或 null
     */
    loadState() {
        try {
            const raw = localStorage.getItem(WINDOW_STATE_STORAGE_KEY);
            if (!raw) {
                return null;
            }
            const parsed = JSON.parse(raw);
            if (!parsed || typeof parsed !== "object") {
                return null;
            }
            if (parsed.version !== WINDOW_STATE_VERSION) {
                return null;
            }
            const toFiniteNumber = (value) => {
                const num = Number(value);
                return Number.isFinite(num) ? num : null;
            };
            const dockSide = parsed.dockSide === "left" || parsed.dockSide === "right"
                ? parsed.dockSide
                : null;
            const left = toFiniteNumber(parsed.left);
            const top = toFiniteNumber(parsed.top);
            const width = toFiniteNumber(parsed.width);
            const height = toFiniteNumber(parsed.height);
            if (left === null || top === null || width === null || height === null) {
                return null;
            }
            return {
                version: WINDOW_STATE_VERSION,
                left,
                top,
                width,
                height,
                dockSide,
                isMaximized: parsed.isMaximized === true,
            };
        } catch {
            return null;
        }
    },

    /**
     * 保存窗口位置和大小状态
     * 注：透明度设置单独使用 localStorage 保存
     * @param {Object} state - 窗口状态对象
     */
    saveState(state) {
        if (!state || typeof state !== "object") {
            return;
        }
        try {
            const payload = {
                version: WINDOW_STATE_VERSION,
                left: Number(state.left),
                top: Number(state.top),
                width: Number(state.width),
                height: Number(state.height),
                dockSide: state.dockSide === "left" || state.dockSide === "right"
                    ? state.dockSide
                    : null,
                isMaximized: state.isMaximized === true,
            };
            if (
                !Number.isFinite(payload.left)
                || !Number.isFinite(payload.top)
                || !Number.isFinite(payload.width)
                || !Number.isFinite(payload.height)
            ) {
                return;
            }
            localStorage.setItem(WINDOW_STATE_STORAGE_KEY, JSON.stringify(payload));
        } catch {
            // 忽略 localStorage 写入失败
        }
    },

    /**
     * 切换窗口显示/隐藏
     * 如果窗口已显示则隐藏，否则显示
     */
    toggle() {
        if (this.instance && this.instance.isVisible) {
            if (closeBehavior === "destroy") {
                this.instance.destroy();
            } else {
                this.instance.hide();
            }
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
        const persistedState = XDataHub.loadState();
        let initialDockSide = null;
        let initialMaximized = false;

        const clampValue = (value, min, max) => {
            return Math.max(min, Math.min(value, max));
        };
        const clampLayoutToViewport = (layout) => {
            const viewportWidth = window.innerWidth;
            const viewportHeight = window.innerHeight;
            const minWidth = Math.min(RESIZE_MIN_WIDTH, viewportWidth);
            const minHeight = Math.min(RESIZE_MIN_HEIGHT, viewportHeight);
            const width = clampValue(
                Number(layout.width),
                minWidth,
                viewportWidth
            );
            const height = clampValue(
                Number(layout.height),
                minHeight,
                viewportHeight
            );
            const maxLeft = Math.max(0, viewportWidth - width);
            const maxTop = Math.max(0, viewportHeight - height);
            const left = clampValue(Number(layout.left), 0, maxLeft);
            const top = clampValue(Number(layout.top), 0, maxTop);
            return { left, top, width, height };
        };
        const applyLayout = (layout) => {
            windowEl.style.left = `${layout.left}px`;
            windowEl.style.top = `${layout.top}px`;
            windowEl.style.width = `${layout.width}px`;
            windowEl.style.height = `${layout.height}px`;
        };
        const applyDockLayout = (side) => {
            const viewportWidth = window.innerWidth;
            const viewportHeight = window.innerHeight;
            const dockWidth = Math.min(RESIZE_MIN_WIDTH, viewportWidth);
            const left = side === "right"
                ? Math.max(0, viewportWidth - dockWidth)
                : 0;
            applyLayout({
                left,
                top: 0,
                width: dockWidth,
                height: viewportHeight,
            });
        };
        const applyMaximizedLayout = () => {
            applyLayout({
                left: 0,
                top: 0,
                width: window.innerWidth,
                height: window.innerHeight,
            });
        };

        if (persistedState) {
            initialDockSide = persistedState.dockSide;
            initialMaximized = persistedState.isMaximized === true;
            if (initialMaximized) {
                applyMaximizedLayout();
            } else if (initialDockSide) {
                applyDockLayout(initialDockSide);
            } else {
                applyLayout(clampLayoutToViewport(persistedState));
            }
        } else if (defaultOpenLayout === "left" || defaultOpenLayout === "right") {
            initialDockSide = defaultOpenLayout;
            applyDockLayout(defaultOpenLayout);
        } else if (defaultOpenLayout === "maximized") {
            initialMaximized = true;
            applyMaximizedLayout();
        } else {
            // 默认尺寸：首次按当前视口 75% 打开（保持最小尺寸约束）
            const viewportWidth = window.innerWidth;
            const viewportHeight = window.innerHeight;
            const minWidth = Math.min(RESIZE_MIN_WIDTH, viewportWidth);
            const minHeight = Math.min(RESIZE_MIN_HEIGHT, viewportHeight);
            const defaultWidth = clampValue(
                Math.floor(viewportWidth * 0.75),
                minWidth,
                viewportWidth
            );
            const defaultHeight = clampValue(
                Math.floor(viewportHeight * 0.75),
                minHeight,
                viewportHeight
            );

            // 居中显示
            const centerLeft = Math.max(0, (viewportWidth - defaultWidth) / 2);
            const centerTop = Math.max(0, (viewportHeight - defaultHeight) / 2);
            applyLayout({
                left: centerLeft,
                top: centerTop,
                width: defaultWidth,
                height: defaultHeight,
            });
        }

        const header = document.createElement("div");
        header.className = "xz3r0-datahub-window-header";

        const title = document.createElement("span");
        title.className = "xz3r0-datahub-window-title";
        title.innerHTML = `
            ${iconHtml("infinity", t("windowTitle", "XDataHub"), "xz3r0-icon xz3r0-title-icon")}
            <span class="xz3r0-datahub-window-title-text">${t("windowTitle", "XDataHub")}</span>
        `;

        // 透明度控制组件
        const opacityControl = document.createElement("div");
        opacityControl.className = "xz3r0-opacity-control";

        const opacityLabel = document.createElement("span");
        opacityLabel.className = "xz3r0-opacity-label";
        opacityLabel.textContent = t("opacityLabel", "Opacity");

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
        dockLeftBtn.innerHTML = iconHtml(
            "panel-left-close",
            t("dockLeftBtn", "Dock Left")
        );
        dockLeftBtn.title = t("dockLeftBtn", "Dock Left");

        const maxBtn = document.createElement("button");
        maxBtn.className = "xz3r0-datahub-window-btn";
        maxBtn.innerHTML = iconHtml("maximize-2", t("maxBtn", "Maximize"));
        maxBtn.title = t("maxBtn", "Maximize");

        const closeBtn = document.createElement("button");
        closeBtn.className = "xz3r0-datahub-window-btn";
        closeBtn.innerHTML = iconHtml("x", t("closeBtn", "Close"));
        closeBtn.title = t("closeBtn", "Close");

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
        dataFrame.src = (
            "/extensions/ComfyUI-Xz3r0-Nodes/xdatahub_app.html"
            + `?tab=history&theme=${encodeURIComponent(currentThemeMode)}`
            + `&v=${XDATAHUB_ASSET_VER}`
        );

        frameStack.appendChild(dataFrame);
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
        };
        const postThemeModeToDataFrame = () => {
            if (!dataFrame.contentWindow) {
                return;
            }
            dataFrame.contentWindow.postMessage(
                {
                    type: "xdatahub:theme-mode",
                    theme_mode: currentThemeMode,
                },
                "*"
            );
        };
        const postHotkeySpecToDataFrame = () => {
            if (!dataFrame.contentWindow) {
                return;
            }
            dataFrame.contentWindow.postMessage(
                {
                    type: "xdatahub:hotkey-spec",
                    hotkey_spec: hotkeySpec,
                },
                "*"
            );
        };
        const postSharedStateToDataFrame = () => {
            postThemeModeToDataFrame();
            postHotkeySpecToDataFrame();
        };
        const postCloseFacetToDataFrame = () => {
            if (!dataFrame.contentWindow) {
                return;
            }
            dataFrame.contentWindow.postMessage(
                { type: "xdatahub:close-facet" },
                "*"
            );
        };
        const updateHostTabCompactMode = () => {
            if (windowEl.style.display === "none") {
                return;
            }
            if (hostTabs.clientWidth <= 0) {
                return;
            }
            // XDataHub 仅 4 个主标签，强制保持文字模式，避免快速缩放时误入图标模式。
            windowEl.classList.remove("compact-tabs");
            requestAnimationFrame(updateHostTabIndicator);
        };
        const scheduleVisibleLayoutSync = () => {
            const syncLayout = () => {
                updateHostTabCompactMode();
                updateResizeHandleLayout();
            };
            requestAnimationFrame(syncLayout);
            requestAnimationFrame(() => requestAnimationFrame(syncLayout));
        };
        const setHostTab = (tabId, options = {}) => {
            const force = options.force === true;
            if (!force && tabId === activeHostTab) {
                return;
            }
            activeHostTab = tabId;
            hostTabButtons.forEach((button, id) => {
                button.classList.toggle("active", id === tabId);
            });
            updateHostTabIndicator();
            dataFrame.classList.add("active");
            if (dataFrame.contentWindow) {
                dataFrame.contentWindow.postMessage(
                    { type: "xdatahub:set-tab", tab: tabId },
                    "*"
                );
                postSharedStateToDataFrame();
            }
        };

        HOST_TABS.forEach((tab) => {
            const button = document.createElement("button");
            button.className = "xz3r0-datahub-window-host-tab";
            const tabText = t(tab.textKey, tab.id);
            button.title = tabText;
            button.innerHTML = `
                <span class="xz3r0-datahub-window-host-tab-icon">${iconHtml(tab.icon, tabText)}</span>
                <span class="xz3r0-datahub-window-host-tab-text">${tabText}</span>
            `;
            button.addEventListener("pointerdown", (e) => {
                if (e.button !== 0) return;
                setHostTab(tab.id);
            });
            button.addEventListener("click", () => setHostTab(tab.id));
            hostTabs.appendChild(button);
            hostTabButtons.set(tab.id, button);
        });
        hostTabs.appendChild(hostTabsIndicator);

        const applyShellLocaleText = () => {
            const windowTitle = t("windowTitle", "XDataHub");
            title.innerHTML = `
                ${iconHtml("infinity", windowTitle, "xz3r0-icon xz3r0-title-icon")}
                <span class="xz3r0-datahub-window-title-text">${windowTitle}</span>
            `;
            opacityLabel.textContent = t("opacityLabel", "Opacity");
            closeBtn.innerHTML = iconHtml("x", t("closeBtn", "Close"));
            closeBtn.title = t("closeBtn", "Close");
            HOST_TABS.forEach((tab) => {
                const button = hostTabButtons.get(tab.id);
                if (!button) {
                    return;
                }
                const tabText = t(tab.textKey, tab.id);
                button.title = tabText;
                button.innerHTML = `
                    <span class="xz3r0-datahub-window-host-tab-icon">${iconHtml(tab.icon, tabText)}</span>
                    <span class="xz3r0-datahub-window-host-tab-text">${tabText}</span>
                `;
            });
            if (isMaximized) {
                maxBtn.innerHTML = iconHtml("minimize-2", t("restoreBtn", "Restore"));
                maxBtn.title = t("restoreBtn", "Restore");
            } else {
                maxBtn.innerHTML = iconHtml("maximize-2", t("maxBtn", "Maximize"));
                maxBtn.title = t("maxBtn", "Maximize");
            }
            updateDockButtonVisual();
            applyMenuButtonIcon();
            requestAnimationFrame(updateHostTabIndicator);
        };

        windowEl.appendChild(header);
        windowEl.appendChild(content);
        document.body.appendChild(windowEl);
        windowEl.setAttribute("data-theme", currentThemeMode);
        dataFrame.addEventListener("load", postSharedStateToDataFrame);
        updateHostTabCompactMode();
        setHostTab(activeHostTab, { force: true });

        // 创建拉伸手柄
        const resizeHandles = [
            { key: 'n-left', class: 'xz3r0-resize-handle-n-left', direction: 'n' },
            { key: 'n-right', class: 'xz3r0-resize-handle-n-right', direction: 'n' },
            { key: 's', class: 'xz3r0-resize-handle-s', direction: 's' },
            { key: 'w', class: 'xz3r0-resize-handle-w', direction: 'w' },
            { key: 'e', class: 'xz3r0-resize-handle-e', direction: 'e' },
            { key: 'nw', class: 'xz3r0-resize-handle-nw', direction: 'nw' },
            { key: 'ne', class: 'xz3r0-resize-handle-ne', direction: 'ne' },
            { key: 'sw', class: 'xz3r0-resize-handle-sw', direction: 'sw' },
            { key: 'se', class: 'xz3r0-resize-handle-se', direction: 'se' }
        ];
        const EDGE_SNAP_THRESHOLD = 4;
        const HANDLE_INSET = 2;
        const CONTROL_GUARD_PAD_X = 10;
        const CONTROL_GUARD_PAD_Y = 6;
        const TOP_HANDLE_HEIGHT = 16;
        const CORNER_HANDLE_SIZE = 24;
        const TOP_HANDLE_MIN_SEGMENT_WIDTH = 8;
        const resizeHandleElements = new Map();

        resizeHandles.forEach(({ key, class: className, direction }) => {
            const handle = document.createElement('div');
            handle.className = `xz3r0-resize-handle ${className}`;
            handle.dataset.direction = direction;
            handle.dataset.key = key;
            windowEl.appendChild(handle);
            resizeHandleElements.set(key, handle);
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
            resizeHandleElements.forEach((handle) => {
                const direction = handle.dataset.direction || "";
                const key = handle.dataset.key || "";
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
                if (key === "n-left" || key === "n-right") {
                    handle.style.height = `${TOP_HANDLE_HEIGHT}px`;
                }
            });

            const nLeftHandle = resizeHandleElements.get("n-left");
            const nRightHandle = resizeHandleElements.get("n-right");
            if (nLeftHandle && nRightHandle) {
                const windowRect = windowEl.getBoundingClientRect();
                const controlsRect = controls.getBoundingClientRect();
                const minX = 16;
                const maxX = Math.max(minX, windowRect.width - 16);

                const guardedLeft = Math.max(
                    minX,
                    Math.min(
                        maxX,
                        controlsRect.left - windowRect.left - CONTROL_GUARD_PAD_X
                    )
                );
                const guardedRight = Math.max(
                    minX,
                    Math.min(
                        maxX,
                        controlsRect.right - windowRect.left + CONTROL_GUARD_PAD_X
                    )
                );

                const applyTopSegment = (handle, startX, endX) => {
                    const width = Math.max(0, endX - startX);
                    if (width < TOP_HANDLE_MIN_SEGMENT_WIDTH) {
                        handle.style.display = "none";
                        return;
                    }
                    handle.style.display = "block";
                    handle.style.left = `${startX}px`;
                    handle.style.right = "";
                    handle.style.width = `${width}px`;
                    handle.style.top = edge.top
                        ? `${HANDLE_INSET}px`
                        : "";
                    handle.style.bottom = "";
                };

                applyTopSegment(nLeftHandle, minX, guardedLeft);
                applyTopSegment(nRightHandle, guardedRight, maxX);
            }

            const neHandle = resizeHandleElements.get("ne");
            if (neHandle) {
                const controlsRect = controls.getBoundingClientRect();
                const windowRect = windowEl.getBoundingClientRect();
                const controlsTopInWindow = controlsRect.top - windowRect.top;
                const guardTouchesTopHandle = controlsTopInWindow
                    <= (TOP_HANDLE_HEIGHT + CONTROL_GUARD_PAD_Y);
                const outwardOffset = Math.round(CORNER_HANDLE_SIZE * 0.58);
                const safeOuterOffset = guardTouchesTopHandle
                    ? outwardOffset + CONTROL_GUARD_PAD_Y
                    : outwardOffset;

                neHandle.style.width = `${CORNER_HANDLE_SIZE}px`;
                neHandle.style.height = `${CORNER_HANDLE_SIZE}px`;
                neHandle.style.right = edge.right
                    ? `${HANDLE_INSET}px`
                    : `-${safeOuterOffset}px`;
                neHandle.style.top = edge.top
                    ? `${HANDLE_INSET}px`
                    : `-${safeOuterOffset}px`;
                neHandle.style.left = "";
                neHandle.style.bottom = "";
            }
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
        let isMaximized = initialMaximized;
        let preMaximizeState = null;
        let isAltPressed = false;
        let dockSide = initialDockSide;

        /**
         * 保存窗口状态
         */
        const persistWindowState = () => {
            if (windowEl.offsetWidth <= 0 || windowEl.offsetHeight <= 0) {
                return;
            }
            XDataHub.saveState({
                left: windowEl.offsetLeft,
                top: windowEl.offsetTop,
                width: windowEl.offsetWidth,
                height: windowEl.offsetHeight,
                dockSide,
                isMaximized,
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
            maxBtn.innerHTML = iconHtml("minimize-2", t("restoreBtn", "Restore"));
            maxBtn.title = t("restoreBtn", "Restore");
            maxBtn.classList.add('maximized');
            updateHostTabCompactMode();
            updateResizeHandleLayout();
            updateDockButtonVisual();
            persistWindowState();
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
            maxBtn.innerHTML = iconHtml("maximize-2", t("maxBtn", "Maximize"));
            maxBtn.title = t("maxBtn", "Maximize");
            maxBtn.classList.remove('maximized');
            updateHostTabCompactMode();
            updateResizeHandleLayout();
            updateDockButtonVisual();
            persistWindowState();
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
            const fallbackTitle = nextSide === "left" ? "Dock Left" : "Dock Right";
            dockLeftBtn.innerHTML = iconHtml(iconName, t(titleKey, fallbackTitle));
            dockLeftBtn.title = t(titleKey, fallbackTitle);
        };

        /**
         * 停靠到指定方向：贴边、最小宽度、全高贴合可视区
         */
        const dockWindowTo = (side) => {
            resetInteractionState(false);
            isMaximized = false;
            preMaximizeState = null;
            maxBtn.innerHTML = iconHtml("maximize-2", t("maxBtn", "Maximize"));
            maxBtn.title = t("maxBtn", "Maximize");
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
            maxBtn.innerHTML = iconHtml("minimize-2", t("restoreBtn", "Restore"));
            maxBtn.title = t("restoreBtn", "Restore");
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
            maxBtn.innerHTML = iconHtml("maximize-2", t("maxBtn", "Maximize"));
            maxBtn.title = t("maxBtn", "Maximize");
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
            if (windowEl.style.display === "none") {
                return;
            }
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
            persistWindowState();
        };

        /**
         * 使用 requestAnimationFrame 优化拖拽性能
         * 限制窗口位置，确保窗口四边都不超出屏幕边界
         * @param {number} x - 目标 X 坐标
         * @param {number} y - 目标 Y 坐标
         */
        const updatePosition = (x, y) => {
            // 窗口左边不能小于 0（不能超出屏幕左边缘）
            // 窗口右边不能大于屏幕宽度（不能超出屏幕右边缘）
            const maxLeft = window.innerWidth - windowEl.offsetWidth;
            const newLeft = Math.max(0, Math.min(maxLeft, x));

            // 窗口顶部不能小于 0（不能超出屏幕上边缘）
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
                    // 向左拉伸时，dx 为负值，窗口宽度增加，left 减小
                    // 限制条件：newLeft >= 0 且 newWidth >= RESIZE_MIN_WIDTH
                    // dx 的最小值（最负）受限于：resizeStartLeft + dx >= 0 即 dx >= -resizeStartLeft
                    // dx 的最大值（最正）受限于：resizeStartWidth - dx >= RESIZE_MIN_WIDTH 即 dx <= resizeStartWidth - RESIZE_MIN_WIDTH
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
                    // 向上拉伸时，dy 为负值，窗口高度增加，top 减小
                    // 限制条件：newTop >= 0 且 newHeight >= RESIZE_MIN_HEIGHT
                    // dy 的最小值（最负）受限于：resizeStartTop + dy >= 0 即 dy >= -resizeStartTop
                    // dy 的最大值（最正）受限于：resizeStartHeight - dy >= RESIZE_MIN_HEIGHT 即 dy <= resizeStartHeight - RESIZE_MIN_HEIGHT
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
            postCloseFacetToDataFrame();
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
        windowEl.addEventListener("pointerdown", (e) => {
            if (e.target.closest("iframe")) {
                return;
            }
            postCloseFacetToDataFrame();
        }, true);

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

        // 当失去指针捕获时，重置 Alt+ 拖拽状态
        windowEl.addEventListener('lostpointercapture', () => {
            stopDragging(true);
        });

        // 拉伸手柄事件 - 使用 pointer 事件确保捕获能正常工作
        windowEl.querySelectorAll('.xz3r0-resize-handle').forEach(handle => {
            handle.addEventListener('pointerdown', (e) => {
                postCloseFacetToDataFrame();
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
            setHostTab,
            async applyUiLocale(locale) {
                await loadUiLocaleBundle(locale);
                applyShellLocaleText();
            },
            applyThemeMode(mode) {
                const normalized = normalizeThemeMode(mode);
                windowEl.setAttribute("data-theme", normalized);
                postThemeModeToDataFrame();
            },
            postHotkeySpecToDataFrame() {
                postHotkeySpecToDataFrame();
            },

            /**
             * 显示窗口
             */
            show() {
                windowEl.style.display = "flex";
                this.isVisible = true;
                handleWindowResize();
                scheduleVisibleLayoutSync();
            },

            /**
             * 隐藏窗口
             */
            hide() {
                resetInteractionState(true);
                persistWindowState();
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
                persistWindowState();
                resetInteractionState(false);
                isAltPressed = false;
                updateIframePointerEvents("auto");
                document.removeEventListener("pointermove", handleMouseMove);
                document.removeEventListener("pointerup", handleMouseUp);
                document.removeEventListener("keydown", handleKeyDown);
                document.removeEventListener("keyup", handleKeyUp);
                window.removeEventListener("blur", handleWindowBlur);
                window.removeEventListener("resize", handleWindowResize);
                dataFrame.removeEventListener("load", postSharedStateToDataFrame);
                windowEl.remove();
                XDataHub.instance = null;
            }
        };

        // 关闭按钮事件
        closeBtn.addEventListener("click", () => {
            if (closeBehavior === "destroy") {
                state.destroy();
            } else {
                state.hide();
            }
        });

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

window.addEventListener("message", (event) => {
    const payload = event.data;
    if (!payload || typeof payload !== "object") {
        return;
    }
    if (payload.type === "xdatahub:theme-mode") {
        applyThemeMode(payload.theme_mode);
        return;
    }
    if (payload.type === "xdatahub:toggle-window-request") {
        if (!windowEnabled) {
            return;
        }
        XDataHub.toggle();
        return;
    }
    if (payload.type === "xdatahub:ui-locale") {
        xdataHubRef?.instance?.applyUiLocale?.(payload.locale);
    }
});



