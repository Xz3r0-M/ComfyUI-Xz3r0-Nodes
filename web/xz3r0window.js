import { app } from "../../scripts/app.js";

app.registerExtension({
    name: "ComfyUI.Xz3r0.xz3r0window",

    async setup() {
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

        if (!menuButtonCreated) {
            const showButton = document.createElement("button");
            showButton.className = "comfy-settings-btn";
            showButton.textContent = "♾️";
            showButton.style.cssText = "position: absolute; right: 72px; cursor: pointer;";
            showButton.title = "Xz3r0 Window";
            showButton.onclick = () => Xz3r0Window.toggle();

            const settingsBtn = document.querySelector(".comfy-settings-btn");
            if (settingsBtn) {
                settingsBtn.before(showButton);
            } else {
                document.body.appendChild(showButton);
            }
        }
    }
});

const STORAGE_KEY = "xz3r0-metadataworkflow-state";

const Xz3r0Window = {
    instance: null,

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

    saveState(state) {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        } catch (e) {
            console.warn("[Xz3r0-Nodes] Failed to save window state:", e);
        }
    },

    toggle() {
        if (this.instance && this.instance.isVisible) {
            this.instance.hide();
        } else {
            this.show();
        }
    },

    show() {
        if (!this.instance) {
            this.instance = this.create();
        }
        this.instance.show();
    },

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

        let isDragging = false;
        let isResizing = false;
        let startX, startY, startLeft, startTop, startWidth, startHeight;

        const handleMouseMove = (e) => {
            if (isDragging) {
                const dx = e.clientX - startX;
                const dy = e.clientY - startY;
                const headerHeight = 40;
                const minVisible = 100;
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
                const newWidth = Math.max(400, startWidth + dx);
                const newHeight = Math.max(300, startHeight + dy);
                windowEl.style.width = `${newWidth}px`;
                windowEl.style.height = `${newHeight}px`;
            }
        };

        const handleMouseUp = () => {
            if (isDragging || isResizing) {
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

        document.addEventListener("mousemove", handleMouseMove);
        document.addEventListener("mouseup", handleMouseUp);

        header.addEventListener("mousedown", (e) => {
            if (e.target.closest(".xz3r0-floating-window-btn")) return;
            isDragging = true;
            startX = e.clientX;
            startY = e.clientY;
            startLeft = windowEl.offsetLeft;
            startTop = windowEl.offsetTop;
            e.preventDefault();
        });

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

        const state = {
            isVisible: true,
            windowEl,
            iframe,
            show() {
                windowEl.style.display = "flex";
                this.isVisible = true;
            },
            hide() {
                windowEl.style.display = "none";
                this.isVisible = false;
            },
            destroy() {
                document.removeEventListener("mousemove", handleMouseMove);
                document.removeEventListener("mouseup", handleMouseUp);
                windowEl.remove();
                Xz3r0Window.instance = null;
            }
        };

        closeBtn.addEventListener("click", () => state.hide());

        return state;
    }
};
