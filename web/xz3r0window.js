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
 *    - 拖拽移动（标题栏拖动）
 *    - 调整大小（右下角拖拽）
 *    - 显示/隐藏切换
 *    - 状态持久化（位置/大小保存到 localStorage）
 *
 * 2. 集成方式:
 *    - 在 ComfyUI 菜单栏添加按钮（新 UI）
 *    - 在设置按钮旁添加备用按钮（旧 UI 兼容）
 *
 * 3. 内容加载:
 *    - 通过 iframe 加载 xmetadataworkflow.html
 *    - 完全隔离的浏览环境
 *
 * 技术实现:
 * ---------
 * - 使用 CSS 变量适配 ComfyUI 主题
 * - 使用 localStorage 持久化窗口状态
 * - 使用鼠标事件实现拖拽和调整大小
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

/**
 * 注册 ComfyUI 扩展
 * 在 ComfyUI 初始化时设置窗口按钮和样式
 */
app.registerExtension({
    name: "ComfyUI.Xz3r0.xz3r0window",

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
            }
            .xz3r0-floating-window-header {
                display: flex;
                align-items: center;
                justify-content: space-between;
                padding: 8px 12px;
                background: var(--comfy-input-bg, #252525);
                border-bottom: 1px solid var(--border-color, #3d3d3d);
                cursor: move;
                user-select: none;
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
                border: none;
                border-radius: 4px;
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 16px;
                background: transparent;
                color: var(--input-text, #fff);
                transition: color 0.2s;
            }
            .xz3r0-floating-window-btn:hover {
                color: #e74c3c;
            }
            .xz3r0-floating-window-content {
                flex: 1;
                overflow: hidden;
            }
            .xz3r0-floating-window-content iframe {
                width: 100%;
                height: 100%;
                border: none;
            }
            .xz3r0-floating-window-resize {
                position: absolute;
                bottom: 0;
                right: 0;
                width: 24px;
                height: 24px;
                cursor: se-resize;
                background: linear-gradient(135deg, transparent 50%, var(--border-color, #555) 50%);
                border-radius: 0 0 8px 0;
            }
            .xz3r0-floating-window-resize:hover {
                background: linear-gradient(135deg, transparent 50%, var(--p-primary-color, #4a90e2) 50%);
            }
            .xz3r0-dragging {
                cursor: se-resize !important;
                user-select: none !important;
            }
        `;
        document.head.appendChild(style);

        let menuButtonCreated = false;

        // 尝试在新版 ComfyUI UI 中添加菜单按钮
        if (app.menu?.settingsGroup) {
            try {
                const { ComfyButton } = await import("../../scripts/ui/components/button.js");
                const menuButton = new ComfyButton({
                    action: () => Xz3r0Window.toggle(),
                    tooltip: "Xz3r0 Window",
                    content: "♾️",
                });
                app.menu.settingsGroup.append(menuButton);
                menuButtonCreated = true;
            } catch (e) {
                console.warn("[Xz3r0-Nodes] Failed to create menu button:", e);
            }
        }

        // 如果新版 UI 不可用，创建备用按钮（兼容旧版 ComfyUI）
        // if (!menuButtonCreated) {
        //     const showButton = document.createElement("button");
        //     showButton.className = "comfy-settings-btn";
        //     showButton.textContent = "♾️";
        //     showButton.style.cssText = "position: absolute; right: 72px; cursor: pointer;";
        //     showButton.title = "Xz3r0 Window";
        //     showButton.onclick = () => Xz3r0Window.toggle();

        //     const settingsBtn = document.querySelector(".comfy-settings-btn");
        //     if (settingsBtn) {
        //         settingsBtn.before(showButton);
        //     } else {
        //         document.body.appendChild(showButton);
        //     }
        // }
    }
});

// localStorage 键名，用于保存窗口状态
const STORAGE_KEY = "xz3r0-metadataworkflow-state";

/**
 * Xz3r0Window 窗口管理对象
 * 提供窗口的创建、显示/隐藏、状态管理等功能
 */
const Xz3r0Window = {
    /** 当前窗口实例 */
    instance: null,

    /**
     * 从 localStorage 加载窗口状态
     * @returns {Object|null} 保存的状态对象，包含 left, top, width, height
     */
    loadState() {
        try {
            const saved = localStorage.getItem(STORAGE_KEY);
            if (saved) {
                return JSON.parse(saved);
            }
        } catch (e) {
            console.warn("[Xz3r0-Nodes] Failed to load window state:", e);
        }
        return null;
    },

    /**
     * 保存窗口状态到 localStorage
     * @param {Object} state - 窗口状态对象
     * @param {string} state.left - 窗口左边距
     * @param {string} state.top - 窗口上边距
     * @param {string} state.width - 窗口宽度
     * @param {string} state.height - 窗口高度
     */
    saveState(state) {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        } catch (e) {
            console.warn("[Xz3r0-Nodes] Failed to save window state:", e);
        }
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
        const savedState = this.loadState();
        const windowEl = document.createElement("div");
        windowEl.className = "xz3r0-floating-window";
        windowEl.style.width = savedState?.width || "900px";
        windowEl.style.height = savedState?.height || "700px";
        windowEl.style.left = savedState?.left || "100px";
        windowEl.style.top = savedState?.top || "100px";

        const header = document.createElement("div");
        header.className = "xz3r0-floating-window-header";

        const title = document.createElement("span");
        title.className = "xz3r0-floating-window-title";
        title.textContent = "♾️ Xz3r0 Windows";

        const controls = document.createElement("div");
        controls.className = "xz3r0-floating-window-controls";

        const closeBtn = document.createElement("button");
        closeBtn.className = "xz3r0-floating-window-btn";
        closeBtn.innerHTML = "❌";
        closeBtn.title = "Close";

        controls.appendChild(closeBtn);
        header.appendChild(title);
        header.appendChild(controls);

        const content = document.createElement("div");
        content.className = "xz3r0-floating-window-content";

        const iframe = document.createElement("iframe");
        iframe.src = "/extensions/ComfyUI-Xz3r0-Nodes/xmetadataworkflow.html";
        content.appendChild(iframe);

        const resizeHandle = document.createElement("div");
        resizeHandle.className = "xz3r0-floating-window-resize";

        windowEl.appendChild(header);
        windowEl.appendChild(content);
        windowEl.appendChild(resizeHandle);
        document.body.appendChild(windowEl);

        // 拖拽和调整大小的状态变量
        let isDragging = false;
        let isResizing = false;
        let startX, startY, startLeft, startTop, startWidth, startHeight;

        /**
         * 鼠标移动事件处理
         * 处理窗口拖拽和调整大小
         * @param {MouseEvent} e - 鼠标事件对象
         */
        const handleMouseMove = (e) => {
            if (isDragging) {
                const dx = e.clientX - startX;
                const dy = e.clientY - startY;
                const headerHeight = 40;
                const minVisible = 100; // 窗口边缘最小可见像素

                // 计算新的位置，限制在屏幕范围内
                const minLeft = -windowEl.offsetWidth + minVisible;
                const maxLeft = window.innerWidth - minVisible;
                const maxTop = window.innerHeight - headerHeight;
                const newLeft = Math.max(minLeft, Math.min(maxLeft, startLeft + dx));
                const newTop = Math.max(0, Math.min(maxTop, startTop + dy));

                windowEl.style.left = `${newLeft}px`;
                windowEl.style.top = `${newTop}px`;
            }
            if (isResizing) {
                const dx = e.clientX - startX;
                const dy = e.clientY - startY;

                // 限制最小尺寸
                const newWidth = Math.max(400, startWidth + dx);
                const newHeight = Math.max(300, startHeight + dy);

                windowEl.style.width = `${newWidth}px`;
                windowEl.style.height = `${newHeight}px`;
            }
        };

        /**
         * 鼠标释放事件处理
         * 保存窗口状态并清除拖拽/调整大小状态
         */
        const handleMouseUp = () => {
            if (isDragging || isResizing) {
                // 保存当前状态到 localStorage
                Xz3r0Window.saveState({
                    left: windowEl.style.left,
                    top: windowEl.style.top,
                    width: windowEl.style.width,
                    height: windowEl.style.height
                });
            }
            isDragging = false;
            isResizing = false;
            document.body.classList.remove("xz3r0-dragging");
        };

        // 绑定全局鼠标事件
        document.addEventListener("mousemove", handleMouseMove);
        document.addEventListener("mouseup", handleMouseUp);

        // 标题栏拖拽事件
        header.addEventListener("mousedown", (e) => {
            // 如果点击的是按钮，不启动拖拽
            if (e.target.closest(".xz3r0-floating-window-btn")) return;
            isDragging = true;
            startX = e.clientX;
            startY = e.clientY;
            startLeft = windowEl.offsetLeft;
            startTop = windowEl.offsetTop;
            e.preventDefault();
        });

        // 右下角调整大小事件
        resizeHandle.addEventListener("mousedown", (e) => {
            isResizing = true;
            startX = e.clientX;
            startY = e.clientY;
            startWidth = windowEl.offsetWidth;
            startHeight = windowEl.offsetHeight;
            document.body.classList.add("xz3r0-dragging");
            e.preventDefault();
            e.stopPropagation();
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
                document.removeEventListener("mousemove", handleMouseMove);
                document.removeEventListener("mouseup", handleMouseUp);
                windowEl.remove();
                Xz3r0Window.instance = null;
            }
        };

        // 关闭按钮事件
        closeBtn.addEventListener("click", () => state.hide());

        return state;
    }
};
