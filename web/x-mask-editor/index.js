import { XMaskEditorController } from "./controller.js?v=20260406d";
import { openMaskEditorSession } from "./session.js?v=20260406d";
import { saveMaskArtifacts } from "./upload.js?v=20260406d";

const THEME_MODE_VALUES = new Set(["dark", "light"]);

function normalizeThemeMode(value) {
    const mode = String(value || "").trim().toLowerCase();
    return THEME_MODE_VALUES.has(mode) ? mode : "dark";
}

async function resolveMaskEditorThemeMode() {
    try {
        const response = await fetch("/xz3r0/xdatahub/settings", {
            cache: "no-cache",
        });
        const payload = await response.json();
        if (response.ok && payload?.status === "success") {
            return normalizeThemeMode(payload?.settings?.theme_mode);
        }
    } catch {
        // Ignore request failures and keep the dark default.
    }
    const themedWindow = document.querySelector(
        ".xz3r0-datahub-window[data-theme]"
    );
    return normalizeThemeMode(themedWindow?.getAttribute?.("data-theme"));
}

export async function openXMaskEditor(options = {}) {
    const texts = options?.texts || {};
    const session = openMaskEditorSession(texts);
    const ui = session.ui;
    const applyThemeMode = (mode) => {
        ui.overlay.dataset.theme = normalizeThemeMode(mode);
    };
    applyThemeMode("dark");
    resolveMaskEditorThemeMode().then((mode) => {
        applyThemeMode(mode);
    });
    const setButtonIcon = (button, iconName) => {
        const icon = button?.querySelector?.(".ximageget-mask-editor-icon");
        if (!(icon instanceof HTMLImageElement)) {
            return;
        }
        icon.src = new URL(`../icons/${iconName}`, import.meta.url).href;
    };
    const setToggleButtonState = (
        button,
        isVisible,
        visibleText,
        hiddenText,
        visibleTip,
        hiddenTip
    ) => {
        const label = button?.querySelector?.(
            ".ximageget-mask-editor-button-text"
        );
        const nextText = isVisible ? visibleText : hiddenText;
        const nextTip = isVisible ? visibleTip : hiddenTip;
        if (label instanceof HTMLElement) {
            label.textContent = nextText;
        } else {
            button.textContent = nextText;
        }
        if (nextTip) {
            button.title = nextTip;
            button.setAttribute("aria-label", nextTip);
        }
        setButtonIcon(button, isVisible ? "eye.svg" : "eye-off.svg");
        button.classList.toggle("is-visible", isVisible);
        button.classList.toggle("is-hidden", !isVisible);
    };
    const syncInputValue = (input, value) => {
        if (document.activeElement !== input) {
            input.value = String(value);
        }
    };
    const parseUnitInput = (input, fallback = "") => {
        const numeric = String(input?.value || "").replace(/[^0-9.+-]/g, "");
        return numeric || fallback;
    };
    const bindCommitNumberInput = (input, commit) => {
        session.bind(input, "change", commit);
        session.bind(input, "blur", commit);
        session.bind(input, "keydown", (event) => {
            if (event.key === "Enter") {
                event.preventDefault();
                commit();
            }
        });
    };
    const controller = new XMaskEditorController({
        canvas: ui.canvas,
        viewport: ui.viewport,
        imageUrl: options?.imageUrl,
        maskUrl: options?.maskUrl,
        paintUrl: options?.paintUrl,
        transformState: options?.transformState,
        onStateChange: ({
            zoom,
            tool,
            brushSize,
            hardness,
            paintColor,
            paintOpacity,
            maskBrushColor,
            maskOpacity,
            paintVisible,
            maskVisible,
            imageSize,
            canUndo,
            canRedo,
        }) => {
            ui.zoomInput.value = `${Math.round(zoom * 100)}%`;
            ui.imageSizeValue.textContent = `${imageSize.width}x${imageSize.height}`;
            ui.brushRange.value = String(Math.round(brushSize));
            syncInputValue(ui.brushInput, `${Math.round(brushSize)}px`);
            ui.hardnessRange.value = String(Math.round(hardness));
            syncInputValue(ui.hardnessInput, `${Math.round(hardness)}%`);
            ui.colorInput.value = paintColor;
            ui.paintOpacityRange.value = String(paintOpacity);
            syncInputValue(ui.paintOpacityInput, `${paintOpacity}%`);
            ui.maskOpacityRange.value = String(maskOpacity);
            syncInputValue(ui.maskOpacityInput, `${maskOpacity}%`);
            ui.brushBtn.classList.toggle("is-active", tool === "paint");
            ui.maskBrushBtn.classList.toggle("is-active", tool === "mask");
            ui.eraseBtn.classList.toggle("is-active", tool === "erase");
            ui.panBtn.classList.toggle("is-active", tool === "pan");
            ui.maskBlackBtn.classList.toggle(
                "is-active",
                maskBrushColor === "black"
            );
            ui.maskWhiteBtn.classList.toggle(
                "is-active",
                maskBrushColor === "white"
            );
            setToggleButtonState(
                ui.paintVisibilityBtn,
                paintVisible,
                String(texts.showPaint || "Visible"),
                String(texts.hidePaint || "Hidden"),
                String(texts.hidePaintTip || "Hide color layer"),
                String(texts.showPaintTip || "Show color layer")
            );
            setToggleButtonState(
                ui.maskVisibilityBtn,
                maskVisible,
                String(texts.showMask || "Visible"),
                String(texts.hideMask || "Hidden"),
                String(texts.hideMaskTip || "Hide mask layer"),
                String(texts.showMaskTip || "Show mask layer")
            );
            ui.undoBtn.disabled = !canUndo;
            ui.redoBtn.disabled = !canRedo;
        },
    });
    session.bind(ui.brushBtn, "click", () => controller.setTool("paint"));
    session.bind(ui.maskBrushBtn, "click", () => controller.setTool("mask"));
    session.bind(ui.eraseBtn, "click", () => controller.setTool("erase"));
    session.bind(ui.panBtn, "click", () => controller.setTool("pan"));
    session.bind(ui.colorInput, "input", () => {
        controller.setPaintColor(ui.colorInput.value);
    });
    session.bind(ui.paintVisibilityBtn, "click", () => {
        controller.togglePaintVisibility();
    });
    session.bind(ui.paintOpacityRange, "input", () => {
        controller.setPaintOpacity(ui.paintOpacityRange.value);
    });
    bindCommitNumberInput(ui.paintOpacityInput, () => {
        controller.setPaintOpacity(parseUnitInput(ui.paintOpacityInput, "100"));
    });
    session.bind(ui.maskBlackBtn, "click", () => {
        controller.setMaskBrushColor("black");
    });
    session.bind(ui.maskWhiteBtn, "click", () => {
        controller.setMaskBrushColor("white");
    });
    session.bind(ui.maskVisibilityBtn, "click", () => {
        controller.toggleMaskVisibility();
    });
    session.bind(ui.maskOpacityRange, "input", () => {
        controller.setMaskOpacity(ui.maskOpacityRange.value);
    });
    bindCommitNumberInput(ui.maskOpacityInput, () => {
        controller.setMaskOpacity(parseUnitInput(ui.maskOpacityInput, "100"));
    });
    session.bind(ui.invertColorBtn, "click", () => {
        controller.invertMaskPixels();
    });
    session.bind(ui.brushRange, "input", () => {
        controller.setBrushSize(ui.brushRange.value);
    });
    bindCommitNumberInput(ui.brushInput, () => {
        controller.setBrushSize(parseUnitInput(ui.brushInput, "100"));
    });
    session.bind(ui.hardnessRange, "input", () => {
        controller.setHardness(ui.hardnessRange.value);
    });
    bindCommitNumberInput(ui.hardnessInput, () => {
        controller.setHardness(parseUnitInput(ui.hardnessInput, "100"));
    });
    session.bind(ui.zoomOutBtn, "click", () => controller.zoomBy(0.85));
    session.bind(ui.zoomInBtn, "click", () => controller.zoomBy(1.15));
    session.bind(ui.zoomOriginalBtn, "click", () => controller.setOriginalZoom());
    session.bind(ui.zoomResetBtn, "click", () => controller.resetZoom());
    const commitZoomInput = () => {
        controller.setZoomPercent(
            String(ui.zoomInput.value || "").replace(/\s*%\s*/g, "")
        );
    };
    session.bind(ui.zoomInput, "change", commitZoomInput);
    session.bind(ui.zoomInput, "blur", commitZoomInput);
    session.bind(ui.zoomInput, "keydown", (event) => {
        if (event.key === "Enter") {
            event.preventDefault();
            commitZoomInput();
        }
    });
    session.bind(ui.clearPaintBtn, "click", () => controller.clearPaintLayer());
    session.bind(ui.clearMaskBtn, "click", () => controller.clearMaskLayer());
    session.bind(ui.undoBtn, "click", () => controller.undo());
    session.bind(ui.redoBtn, "click", () => controller.redo());
    session.bind(ui.rotateLeftBtn, "click", () => {
        controller.rotateCounterClockwise();
    });
    session.bind(ui.rotateRightBtn, "click", () => {
        controller.rotateClockwise();
    });
    session.bind(ui.flipHorizontalBtn, "click", () => {
        controller.flipHorizontal();
    });
    session.bind(ui.flipVerticalBtn, "click", () => {
        controller.flipVertical();
    });
    session.bind(ui.resetTransformBtn, "click", () => {
        controller.resetTransform();
    });

    const close = () => {
        controller.destroy();
        session.close();
    };

    session.bind(ui.closeBtn, "click", () => {
        close();
    });
    session.bind(ui.cancelBtn, "click", () => {
        close();
    });
    session.bind(ui.overlay, "click", (event) => {
        if (event.target === ui.overlay) {
            close();
        }
    });
    session.bind(window, "keydown", (event) => {
        const key = String(event.key || "").toLowerCase();
        const withCommand = event.ctrlKey || event.metaKey;
        if (withCommand && key === "z") {
            event.preventDefault();
            event.stopPropagation();
            if (event.shiftKey) {
                controller.redo();
            } else {
                controller.undo();
            }
            return;
        }
        if (event.key === "Alt") {
            event.preventDefault();
            event.stopPropagation();
            controller.setModifierErase(true);
            return;
        }
        if (event.key === "Escape") {
            event.preventDefault();
            close();
        }
    });
    session.bind(window, "keyup", (event) => {
        if (event.key === "Alt") {
            event.preventDefault();
            event.stopPropagation();
            controller.setModifierErase(false);
        }
    });
    session.bind(window, "blur", () => {
        controller.setModifierErase(false);
    });
    session.bind(window, "message", (event) => {
        const payload = event?.data;
        if (!payload || payload.type !== "xdatahub:theme-mode") {
            return;
        }
        if (event.origin && event.origin !== window.location.origin) {
            return;
        }
        applyThemeMode(payload.theme_mode);
    });

    try {
        session.setStatus(String(texts.loading || "Loading..."));
        await controller.load();
        controller.mount();
        controller.setTool("mask");
        controller.setBrushSize(ui.brushRange.value);
        controller.setHardness(ui.hardnessRange.value);
        controller.setPaintOpacity(ui.paintOpacityRange.value);
        controller.setMaskOpacity(ui.maskOpacityRange.value);
        session.setStatus("");
    } catch (error) {
        session.setStatus(
            String(texts.loadFailed || "Failed to load image"),
            true
        );
        throw error;
    }

    session.bind(ui.saveBtn, "click", async () => {
        session.setBusy(true);
        session.setStatus(String(texts.saving || "Saving..."));
        try {
            const exported = await controller.exportArtifacts();
            const uploaded = await saveMaskArtifacts({
                maskBlob: exported.maskBlob,
                paintBlob: exported.paintBlob,
                title: options?.title || "",
            });
            await Promise.resolve(
                options?.onSave?.({
                    ...uploaded,
                    transformState: exported.transformState,
                })
            );
            close();
        } catch (error) {
            session.setBusy(false);
            session.setStatus(
                String(texts.saveFailed || "Failed to save mask"),
                true
            );
        }
    });

    return {
        close,
    };
}
