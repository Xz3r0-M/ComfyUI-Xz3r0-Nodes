import {
    createMaskEditorUi,
    ensureMaskEditorStyles,
} from "./ui.js";

let activeSession = null;

export function openMaskEditorSession(texts = {}) {
    ensureMaskEditorStyles();
    if (activeSession) {
        activeSession.close();
    }

    const ui = createMaskEditorUi(texts);
    const listeners = [];
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.body.appendChild(ui.overlay);

    let closed = false;
    const bind = (target, eventName, handler, options) => {
        if (!target || typeof target.addEventListener !== "function") {
            return;
        }
        target.addEventListener(eventName, handler, options);
        listeners.push(() => {
            target.removeEventListener(eventName, handler, options);
        });
    };

    const close = () => {
        if (closed) {
            return;
        }
        closed = true;
        for (const dispose of listeners.splice(0)) {
            try {
                dispose();
            } catch {
                // ignore cleanup errors
            }
        }
        if (ui.overlay.parentNode) {
            ui.overlay.parentNode.removeChild(ui.overlay);
        }
        document.body.style.overflow = previousOverflow;
        if (activeSession === session) {
            activeSession = null;
        }
    };

    const setBusy = (busy) => {
        const disabled = !!busy;
        ui.saveBtn.disabled = disabled;
        ui.cancelBtn.disabled = disabled;
        ui.brushBtn.disabled = disabled;
        ui.maskBrushBtn.disabled = disabled;
        ui.eraseBtn.disabled = disabled;
        ui.panBtn.disabled = disabled;
        ui.colorInput.disabled = disabled;
        ui.paintVisibilityBtn.disabled = disabled;
        ui.paintOpacityRange.disabled = disabled;
        ui.paintOpacityInput.disabled = disabled;
        ui.maskBlackBtn.disabled = disabled;
        ui.maskWhiteBtn.disabled = disabled;
        ui.maskVisibilityBtn.disabled = disabled;
        ui.maskOpacityRange.disabled = disabled;
        ui.maskOpacityInput.disabled = disabled;
        ui.invertColorBtn.disabled = disabled;
        ui.brushInput.disabled = disabled;
        ui.hardnessRange.disabled = disabled;
        ui.hardnessInput.disabled = disabled;
        ui.clearPaintBtn.disabled = disabled;
        ui.clearMaskBtn.disabled = disabled;
        ui.undoBtn.disabled = disabled;
        ui.redoBtn.disabled = disabled;
        ui.closeBtn.disabled = disabled;
        ui.rotateLeftBtn.disabled = disabled;
        ui.rotateRightBtn.disabled = disabled;
        ui.flipHorizontalBtn.disabled = disabled;
        ui.flipVerticalBtn.disabled = disabled;
        ui.resetTransformBtn.disabled = disabled;
        ui.zoomOutBtn.disabled = disabled;
        ui.zoomInput.disabled = disabled;
        ui.zoomInBtn.disabled = disabled;
        ui.zoomOriginalBtn.disabled = disabled;
        ui.zoomResetBtn.disabled = disabled;
        ui.brushRange.disabled = disabled;
    };

    const setStatus = (text, isError = false) => {
        if (!(ui.status instanceof HTMLElement)) {
            return;
        }
        ui.status.textContent = String(text || "");
        ui.status.classList.toggle("is-error", !!isError);
    };

    const session = {
        ui,
        bind,
        close,
        setBusy,
        setStatus,
    };
    activeSession = session;
    return session;
}
