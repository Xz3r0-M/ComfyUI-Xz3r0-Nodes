/**
 * Xz3r0 Window - ComfyUI 浮动窗口扩展
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
 *    - 状态持久化（位置/大小保存到 localStorage）
 *
 * 2. 集成方式:
 *    - 在 ComfyUI 菜单栏添加按钮（新 UI）
 *
 * 3. 内容加载:
 *    - 通过 iframe 加载 xmetadataworkflow.html
 *    - 完全隔离的浏览环境
 *
 * 技术实现:
 * ---------
 * - 使用 CSS 变量适配 ComfyUI 主题
 * - 使用 localStorage 持久化窗口状态
 * - 使用鼠标事件实现拖拽，带阈值和 RAF 优化
 * - 使用鼠标事件实现四边四角拉伸
 * - 限制窗口位置防止完全拖出屏幕
 *
 * 文件结构:
 * ---------
 * - xz3r0window.js: 窗口管理逻辑（此文件）
 * - xmetadataworkflow.html: 窗口内加载的网页内容
 *
 * @author Xz3r0
 * @project ComfyUI-Xz3r0-Nodes
 */

import { app } from "../../scripts/app.js";

// ============================================
// 本地化支持 (i18n)
// ============================================

/**
 * 翻译字典
 * 英文为默认语言，中文为本地化支持
 */
const TRANSLATIONS = {
    en: {
        settingEnableName: "Enable Xz3r0 Floating Window ♾️",
        settingEnableTooltip: "Show Xz3r0 floating window button in the menu bar",
        windowTitle: "♾️ Xz3r0 Windows",
        closeBtn: "Close",
        menuTooltip: "Xz3r0 Window",
        opacityLabel: "Opacity"
    },
    zh: {
        settingEnableName: "启用 Xz3r0 浮动窗口 ♾️",
        settingEnableTooltip: "在菜单栏显示 Xz3r0 浮动窗口按钮",
        windowTitle: "♾️ Xz3r0 窗口",
        closeBtn: "关闭",
        menuTooltip: "Xz3r0 窗口",
        opacityLabel: "透明度"
    }
};

/**
 * 获取当前语言设置
 * 优先从 ComfyUI 设置读取，其次从 localStorage 读取
 * @returns {string} 语言代码 (en, zh 等)
 */
function getCurrentLocale() {
    // 尝试从 ComfyUI 的 setting store 获取
    if (window.app?.extensionManager?.setting) {
        const comfyLocale = window.app.extensionManager.setting.get('Comfy.Locale');
        if (comfyLocale) {
            // 处理 zh-TW, zh-CN 等变体
            const mainLang = comfyLocale.split('-')[0];
            return TRANSLATIONS[comfyLocale] ? comfyLocale : mainLang;
        }
    }

    // 从 localStorage 获取
    const stored = localStorage.getItem('Comfy.Locale');
    if (stored) {
        const mainLang = stored.split('-')[0];
        return TRANSLATIONS[stored] ? stored : mainLang;
    }

    // 默认返回英文
    return 'en';
}

/**
 * 翻译函数
 * 根据键获取对应语言的文本，如果没有则回退到英文
 * @param {string} key - 翻译键
 * @returns {string} 翻译后的文本
 */
function t(key) {
    const locale = getCurrentLocale();
    // 优先使用当前语言，如果不存在则回退到英文
    return TRANSLATIONS[locale]?.[key] ?? TRANSLATIONS.en[key] ?? key;
}

/**
 * 菜单按钮引用
 */
let menuButton = null;

/**
 * 窗口启用状态
 */
let windowEnabled = true;

/**
 * 更新菜单按钮显示状态
 */
function updateMenuButtonVisibility() {
    if (!menuButton) return;
    menuButton.element.style.display = windowEnabled ? "" : "none";
    if (!windowEnabled && window.Xz3r0Window?.instance?.isVisible) {
        window.Xz3r0Window.instance.hide();
    }
}

/**
 * 注册 ComfyUI 扩展
 * 在 ComfyUI 初始化时设置窗口按钮和样式
 */
app.registerExtension({
    name: "ComfyUI.Xz3r0.xz3r0window",

    /**
     * 扩展设置配置
     */
    settings: [
        {
            id: "Xz3r0.Window.Enabled",
            get name() { return t('settingEnableName'); },
            type: "boolean",
            defaultValue: true,
            get tooltip() { return t('settingEnableTooltip'); },
            onChange: (value) => {
                if (windowEnabled === value) return;
                windowEnabled = value;
                updateMenuButtonVisibility();
            }
        }
    ],

    /**
     * 扩展初始化函数
     * 创建样式表并添加菜单按钮
     */
    async setup() {
        // 创建并注入窗口样式
        const style = document.createElement("style");
        style.textContent = `
            .xz3r0-floating-window {
                position: fixed;
                z-index: 10000;
                background: var(--comfy-menu-bg, #1e1e1e);
                border: 1px solid var(--border-color, #3d3d3d);
                border-radius: 8px;
                box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
                display: flex;
                flex-direction: column;
                overflow: hidden;
                min-width: 400px;
                min-height: 300px;
            }
            .xz3r0-floating-window-header {
                display: flex;
                align-items: center;
                justify-content: space-between;
                padding: 8px 12px;
                background: var(--comfy-input-bg, #252525);
                border-bottom: 1px solid var(--border-color, #3d3d3d);
                cursor: grab;
                user-select: none;
                flex-shrink: 0;
            }
            .xz3r0-floating-window-header:active {
                cursor: grabbing;
            }
            .xz3r0-floating-window-header.dragging {
                cursor: grabbing;
            }
            .xz3r0-floating-window-title {
                font-weight: 600;
                color: var(--input-text, #fff);
                font-size: 13px;
            }
            .xz3r0-floating-window-controls {
                display: flex;
                gap: 6px;
            }
            .xz3r0-floating-window-btn {
                width: 24px;
                height: 24px;
                border: 1px solid transparent;
                border-radius: 4px;
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 16px;
                background: #C9C9C9;
                color: var(--input-text, #fff);
                transition: all 0.2s;
            }
            .xz3r0-floating-window-btn:hover {
                border-color: #ff69b4;
            }
            .xz3r0-floating-window-content {
                flex: 1;
                overflow: hidden;
                min-height: 0;
            }
            .xz3r0-floating-window-content iframe {
                width: 100%;
                height: 100%;
                border: none;
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
                color: var(--input-text, #fff);
                opacity: 0.8;
            }
            .xz3r0-opacity-slider {
                width: 80px;
                height: 4px;
                -webkit-appearance: none;
                appearance: none;
                background: var(--border-color, #3d3d3d);
                border-radius: 2px;
                outline: none;
                cursor: pointer;
            }
            .xz3r0-opacity-slider::-webkit-slider-thumb {
                -webkit-appearance: none;
                appearance: none;
                width: 12px;
                height: 12px;
                background: var(--input-text, #fff);
                border-radius: 50%;
                cursor: pointer;
                transition: background 0.2s;
            }
            .xz3r0-opacity-slider::-webkit-slider-thumb:hover {
                background: #ff69b4;
            }
            .xz3r0-opacity-slider::-moz-range-thumb {
                width: 12px;
                height: 12px;
                background: var(--input-text, #fff);
                border-radius: 50%;
                cursor: pointer;
                border: none;
                transition: background 0.2s;
            }
            .xz3r0-opacity-slider::-moz-range-thumb:hover {
                background: #ff69b4;
            }
            .xz3r0-opacity-value {
                font-size: 11px;
                color: var(--input-text, #fff);
                opacity: 0.8;
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
                    action: () => Xz3r0Window.toggle(),
                    tooltip: t('menuTooltip'),
                    content: "♾️",
                });
                app.menu.settingsGroup.append(menuButton);
                // 根据设置显示/隐藏按钮
                updateMenuButtonVisibility();
            } catch (e) {
                console.warn("[Xz3r0-Nodes] Failed to create menu button:", e);
            }
        }
    }
});

/**
 * Xz3r0Window 窗口管理对象
 * 提供窗口的创建、显示/隐藏、状态管理等功能
 */
const Xz3r0Window = {
    /** 当前窗口实例 */
    instance: null,

    /**
     * 加载窗口状态（不再使用 localStorage）
     * @returns {null} 始终返回 null，使用默认状态
     */
    loadState() {
        return null;
    },

    /**
     * 保存窗口状态（不再使用 localStorage）
     * @param {Object} state - 窗口状态对象
     */
    saveState(state) {
        // 不再保存到 localStorage
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
        windowEl.className = "xz3r0-floating-window";

        // 默认尺寸
        const DEFAULT_WIDTH = 900;
        const DEFAULT_HEIGHT = 700;

        // 设置窗口尺寸
        windowEl.style.width = `${DEFAULT_WIDTH}px`;
        windowEl.style.height = `${DEFAULT_HEIGHT}px`;

        // 居中显示
        const centerLeft = Math.max(0, (window.innerWidth - DEFAULT_WIDTH) / 2);
        const centerTop = Math.max(0, (window.innerHeight - DEFAULT_HEIGHT) / 2);
        windowEl.style.left = `${centerLeft}px`;
        windowEl.style.top = `${centerTop}px`;

        const header = document.createElement("div");
        header.className = "xz3r0-floating-window-header";

        const title = document.createElement("span");
        title.className = "xz3r0-floating-window-title";
        title.textContent = t('windowTitle');

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
        controls.className = "xz3r0-floating-window-controls";

        const closeBtn = document.createElement("button");
        closeBtn.className = "xz3r0-floating-window-btn";
        closeBtn.innerHTML = "❌";
        closeBtn.title = t('closeBtn');

        controls.appendChild(closeBtn);
        header.appendChild(title);
        header.appendChild(opacityControl);
        header.appendChild(controls);

        const content = document.createElement("div");
        content.className = "xz3r0-floating-window-content";

        const iframe = document.createElement("iframe");
        iframe.src = "/extensions/ComfyUI-Xz3r0-Nodes/xmetadataworkflow.html";
        content.appendChild(iframe);

        windowEl.appendChild(header);
        windowEl.appendChild(content);
        document.body.appendChild(windowEl);

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

        resizeHandles.forEach(({ class: className, direction }) => {
            const handle = document.createElement('div');
            handle.className = `xz3r0-resize-handle ${className}`;
            handle.dataset.direction = direction;
            windowEl.appendChild(handle);
        });

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
        const RESIZE_MIN_WIDTH = 400;
        const RESIZE_MIN_HEIGHT = 300;

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
            }
        };

        /**
         * 鼠标释放事件处理
         * 保存窗口状态并清除拖拽/拉伸状态
         * 确保一旦鼠标左键松开就立即重置所有状态
         */
        const handleMouseUp = () => {
            // 处理拖拽状态
            if (isDragging) {
                if (rafId) {
                    cancelAnimationFrame(rafId);
                    rafId = null;
                }

                if (hasDragStarted) {
                    updatePosition(pendingX, pendingY);
                    Xz3r0Window.saveState({
                        left: windowEl.style.left,
                        top: windowEl.style.top,
                        width: windowEl.style.width,
                        height: windowEl.style.height
                    });
                }

                header.classList.remove("dragging");
                document.body.classList.remove("xz3r0-dragging");
                document.body.style.userSelect = "";
            }

            // 处理拉伸状态 - 确保鼠标松开时立即重置
            if (isResizing) {
                isResizing = false;
                resizeDirection = '';
                document.body.classList.remove("xz3r0-resizing");
                document.body.style.userSelect = "";

                // 保存状态
                Xz3r0Window.saveState({
                    left: windowEl.style.left,
                    top: windowEl.style.top,
                    width: windowEl.style.width,
                    height: windowEl.style.height
                });
            }

            isDragging = false;
            hasDragStarted = false;
        };

        // 绑定全局鼠标事件 - 使用 pointer 事件以支持 setPointerCapture
        document.addEventListener("pointermove", handleMouseMove);
        document.addEventListener("pointerup", handleMouseUp);

        // 标题栏拖拽事件 - 使用 pointer 事件保持一致性
        header.addEventListener("pointerdown", (e) => {
            if (e.target.closest(".xz3r0-floating-window-btn")) return;
            if (e.target.closest(".xz3r0-opacity-control")) return;
            // 只有左键点击才触发拖拽
            if (e.button !== 0) return;

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

        // 当失去指针捕获时（如鼠标松开），重置拖拽状态
        header.addEventListener('lostpointercapture', () => {
            if (isDragging) {
                if (rafId) {
                    cancelAnimationFrame(rafId);
                    rafId = null;
                }

                if (hasDragStarted) {
                    updatePosition(pendingX, pendingY);
                    Xz3r0Window.saveState({
                        left: windowEl.style.left,
                        top: windowEl.style.top,
                        width: windowEl.style.width,
                        height: windowEl.style.height
                    });
                }

                header.classList.remove("dragging");
                document.body.classList.remove("xz3r0-dragging");
                document.body.style.userSelect = "";

                isDragging = false;
                hasDragStarted = false;
            }
        });

        // 当鼠标移入标题栏时，检查鼠标左键是否真正按下
        // 修复：鼠标移出后松开再移入会自动进入拖动状态的问题
        header.addEventListener('pointerenter', (e) => {
            // 如果处于拖拽状态但鼠标左键未按下，则重置状态
            if (isDragging && (e.buttons & 1) === 0) {
                if (rafId) {
                    cancelAnimationFrame(rafId);
                    rafId = null;
                }
                header.classList.remove("dragging");
                document.body.classList.remove("xz3r0-dragging");
                document.body.style.userSelect = "";
                isDragging = false;
                hasDragStarted = false;
            }
        });

        // Alt + 鼠标左键拖动窗口（在窗口任意位置）
        // 通过监听 keydown/keyup 来检测 Alt 键状态，并控制 iframe 的 pointer-events
        let isAltPressed = false;

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Alt' && !isAltPressed) {
                isAltPressed = true;
                // 禁用 iframe 的鼠标事件，让事件能够传递到父窗口
                iframe.style.pointerEvents = 'none';
            }
        });

        document.addEventListener('keyup', (e) => {
            if (e.key === 'Alt' && isAltPressed) {
                isAltPressed = false;
                // 恢复 iframe 的鼠标事件
                iframe.style.pointerEvents = 'auto';
            }
        });

        // 当窗口失去焦点时，重置 Alt 状态
        window.addEventListener('blur', () => {
            if (isAltPressed) {
                isAltPressed = false;
                iframe.style.pointerEvents = 'auto';
            }
        });

        windowEl.addEventListener('pointerdown', (e) => {
            // 检查是否按住 Alt 键且是左键点击
            if (!e.altKey || e.button !== 0) return;
            // 排除标题栏、按钮和拉伸手柄（这些有独立的事件处理）
            if (e.target.closest('.xz3r0-floating-window-header') ||
                e.target.closest('.xz3r0-resize-handle')) return;

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
            if (isDragging) {
                if (rafId) {
                    cancelAnimationFrame(rafId);
                    rafId = null;
                }

                if (hasDragStarted) {
                    updatePosition(pendingX, pendingY);
                    Xz3r0Window.saveState({
                        left: windowEl.style.left,
                        top: windowEl.style.top,
                        width: windowEl.style.width,
                        height: windowEl.style.height
                    });
                }

                document.body.classList.remove("xz3r0-dragging");
                document.body.style.userSelect = "";
                isDragging = false;
                hasDragStarted = false;
            }
        });

        // 拉伸手柄事件 - 使用 pointer 事件确保捕获能正常工作
        windowEl.querySelectorAll('.xz3r0-resize-handle').forEach(handle => {
            handle.addEventListener('pointerdown', (e) => {
                // 只有左键点击才触发拉伸
                if (e.button !== 0) return;

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
                if (isResizing) {
                    isResizing = false;
                    resizeDirection = '';
                    document.body.classList.remove("xz3r0-resizing");
                    document.body.style.userSelect = "";

                    // 保存状态
                    Xz3r0Window.saveState({
                        left: windowEl.style.left,
                        top: windowEl.style.top,
                        width: windowEl.style.width,
                        height: windowEl.style.height
                    });
                }
            });
        });

        // 当鼠标移入拉伸手柄时，检查鼠标左键是否真正按下
        // 修复：鼠标移出后松开再移入会自动进入拉伸状态的问题
        windowEl.querySelectorAll('.xz3r0-resize-handle').forEach(handle => {
            handle.addEventListener('pointerenter', (e) => {
                // 如果处于拉伸状态但鼠标左键未按下，则重置状态
                if (isResizing && (e.buttons & 1) === 0) {
                    isResizing = false;
                    resizeDirection = '';
                    document.body.classList.remove("xz3r0-resizing");
                    document.body.style.userSelect = "";
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
            iframe,

            /**
             * 显示窗口
             */
            show() {
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

            /**
             * 销毁窗口
             * 移除事件监听和 DOM 元素，清理资源
             */
            destroy() {
                if (rafId) {
                    cancelAnimationFrame(rafId);
                }

                document.removeEventListener("pointermove", handleMouseMove);
                document.removeEventListener("pointerup", handleMouseUp);
                windowEl.remove();
                Xz3r0Window.instance = null;
            }
        };

        // 关闭按钮事件
        closeBtn.addEventListener("click", () => state.hide());

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
