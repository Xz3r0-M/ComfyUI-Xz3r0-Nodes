import { XMaskEditorController } from "./controller.js?v=20261023-14";
import { openMaskEditorSession } from "./session.js?v=20261023-14";
import { saveMaskArtifacts } from "./upload.js?v=20261023-14";

const THEME_MODE_VALUES = new Set(["dark", "light", "comfyui"]);
const EFFECTIVE_THEME_MODE_VALUES = new Set(["dark", "light"]);
const TEXT_EDITABLE_INPUT_TYPES = new Set([
    "email",
    "number",
    "password",
    "search",
    "tel",
    "text",
    "url",
]);
const HANDLED_KEYBOARD_EVENTS = new WeakSet();

function normalizeThemeMode(value) {
    const mode = String(value || "").trim().toLowerCase();
    return THEME_MODE_VALUES.has(mode) ? mode : "dark";
}

function normalizeEffectiveThemeMode(value) {
    const mode = String(value || "").trim().toLowerCase();
    return EFFECTIVE_THEME_MODE_VALUES.has(mode) ? mode : "dark";
}

async function resolveMaskEditorThemeMode() {
    try {
        const response = await fetch("/xz3r0/xdatahub/settings", {
            cache: "no-cache",
        });
        const payload = await response.json();
        if (response.ok && payload?.status === "success") {
            const themeMode = normalizeThemeMode(payload?.settings?.theme_mode);
            if (themeMode === "comfyui") {
                return normalizeEffectiveThemeMode(
                    document.body?.dataset?.theme
                );
            }
            return normalizeEffectiveThemeMode(themeMode);
        }
    } catch {
        // Ignore request failures and keep the dark default.
    }
    const themedWindow = document.querySelector(
        ".xz3r0-datahub-window[data-theme]"
    );
    return normalizeEffectiveThemeMode(
        themedWindow?.getAttribute?.("data-theme")
            || document.body?.dataset?.theme
    );
}

function isTextEditableTarget(target) {
    if (!(target instanceof HTMLElement)) {
        return false;
    }
    if (target.isContentEditable) {
        return true;
    }
    if (target instanceof HTMLTextAreaElement) {
        return !target.readOnly && !target.disabled;
    }
    if (!(target instanceof HTMLInputElement)) {
        return false;
    }
    if (target.readOnly || target.disabled) {
        return false;
    }
    const inputType = String(target.type || "text").toLowerCase();
    return TEXT_EDITABLE_INPUT_TYPES.has(inputType);
}

function getKeyboardEventKey(event) {
    return String(event?.key || "").toLowerCase();
}

function stopKeyboardEvent(event, options = {}) {
    const { preventDefault = true } = options;
    if (HANDLED_KEYBOARD_EVENTS.has(event)) {
        return;
    }
    HANDLED_KEYBOARD_EVENTS.add(event);
    if (preventDefault) {
        event.preventDefault();
    }
    event.stopPropagation();
    event.stopImmediatePropagation?.();
}

function shouldBypassPlainTextInput(event) {
    if (!isTextEditableTarget(event?.target)) {
        return false;
    }
    if (event.ctrlKey || event.metaKey || event.altKey) {
        return false;
    }
    return getKeyboardEventKey(event) !== "escape";
}

function shouldKeepEditorFieldFocus(target, hotkeySink) {
    if (target === hotkeySink) {
        return true;
    }
    if (!(target instanceof Element)) {
        return false;
    }
    return !!target.closest(
        "input, textarea, select, [contenteditable=''], [contenteditable='true']"
    );
}

export async function openXMaskEditor(options = {}) {
    const texts = options?.texts || {};
    const session = openMaskEditorSession(texts);
    const ui = session.ui;
    const focusHotkeySink = () => {
        if (!(ui.hotkeySink instanceof HTMLInputElement)) {
            return;
        }
        if (!ui.overlay.isConnected) {
            return;
        }
        ui.hotkeySink.focus({ preventScroll: true });
    };
    // 主题在 controller 建好之前就可能被应用，所以用个可空引用。
    let controllerRef = null;
    const applyThemeMode = (mode) => {
        ui.overlay.dataset.theme = normalizeEffectiveThemeMode(mode);
        // 方格底色是从主题变量读的，换主题后要重新生成。
        controllerRef?.refreshCheckerboard?.();
    };
    const applyThemeContext = (context) => {
        applyThemeMode(context?.effective_mode ?? context?.theme_mode);
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
        if (document.activeElement === input) {
            return;
        }
        const text = String(value);
        // 值没变就不要碰 DOM：写 value 会让浏览器重新布局，滚轮调
        // 画笔大小时一秒几十次，攒起来就是明显卡顿。
        if (input.value !== text) {
            input.value = text;
        }
    };
    const syncRangeExtent = (range, { min, max, step }) => {
        const nextMin = String(min);
        const nextMax = String(max);
        const nextStep = String(step);
        if (range.min !== nextMin) {
            range.min = nextMin;
        }
        if (range.max !== nextMax) {
            range.max = nextMax;
        }
        if (range.step !== nextStep) {
            range.step = nextStep;
        }
    };
    // 画笔大小相关的控件：滚轮 / 滑杆调大小时只更新这几个。
    // 而且**限流**：滚轮一秒能来上百个事件，而每写一次 DOM，浏览器就要
    // 重新算一遍布局再重画（实测一帧就掉到 50ms）。所以爆发期间最多每
    // 100ms 写一次，停下来再补一次最终值。实时反馈靠画布上的画笔圆环，
    // 它只重画画布，不碰 DOM。
    const BRUSH_SYNC_MS = 100;
    let pendingBrush = null;
    let brushTimer = 0;
    let lastBrushSync = 0;
    const flushBrushControls = () => {
        brushTimer = 0;
        const pending = pendingBrush;
        pendingBrush = null;
        // 编辑器已经关掉就别再碰 DOM 了
        if (!pending || !ui.overlay.isConnected) {
            return;
        }
        lastBrushSync = performance.now();
        const { size, max, min } = pending;
        if (max != null) {
            syncRangeExtent(ui.brushRange, {
                min: min ?? ui.brushRange.min,
                max,
                step: Math.max(1, Math.round(max * 0.01)),
            });
        }
        // 拖动滑杆时，滑杆自己就在手指下面，不需要我们再写它
        if (document.activeElement !== ui.brushRange) {
            const rounded = String(Math.round(size));
            if (ui.brushRange.value !== rounded) {
                ui.brushRange.value = rounded;
            }
        }
        syncInputValue(ui.brushInput, `${Math.round(size)}px`);
    };
    const applyBrushControls = (brushSize, brushSizeMax, brushSizeMin) => {
        pendingBrush = {
            size: brushSize,
            max: brushSizeMax ?? pendingBrush?.max ?? null,
            min: brushSizeMin ?? pendingBrush?.min ?? null,
        };
        if (performance.now() - lastBrushSync >= BRUSH_SYNC_MS) {
            flushBrushControls();
            return;
        }
        if (!brushTimer) {
            brushTimer = window.setTimeout(flushBrushControls, BRUSH_SYNC_MS);
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
    const bindRangeWheel = (rangeInput, wheelStep) => {
        session.bind(rangeInput, "wheel", (event) => {
            event.preventDefault();
            const step = Number(wheelStep ?? rangeInput.step) || 1;
            const delta = event.deltaY > 0 ? -step : step;
            rangeInput.value = String(
                Number(rangeInput.value || 0) + delta
            );
            rangeInput.dispatchEvent(
                new Event("input", { bubbles: true })
            );
        }, { passive: false });
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
            selectedTool,
            brushSize,
            brushSizeMax,
            brushSizeMin,
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
            threshold,
            erasePaintEnabled,
            eraseMaskEnabled,
            maskDisplayInverted,
        }, scope) => {
            // 滚轮调画笔大小每帧都会调到这里：只刷画笔那几个控件就够，
            // 整条工具栏一起刷会明显掉帧。
            if (scope === "brush") {
                applyBrushControls(brushSize, brushSizeMax, brushSizeMin);
                return;
            }
            ui.zoomInput.value = `${Math.round(zoom * 100)}%`;
            ui.imageSizeValue.textContent = `${imageSize.width}x${imageSize.height}`;
            applyBrushControls(brushSize, brushSizeMax, brushSizeMin);
            ui.hardnessRange.value = String(Math.round(hardness));
            syncInputValue(ui.hardnessInput, `${Math.round(hardness)}%`);
            ui.colorInput.value = paintColor;
            ui.paintOpacityRange.value = String(paintOpacity);
            syncInputValue(ui.paintOpacityInput, `${paintOpacity}%`);
            ui.maskOpacityRange.value = String(maskOpacity);
            syncInputValue(ui.maskOpacityInput, `${maskOpacity}%`);
            ui.brushBtn.classList.toggle("is-active", tool === "paint");
            ui.fillBtn.classList.toggle("is-active", selectedTool === "fill");
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
            ui.fillThresholdRange.value = String(threshold);
            syncInputValue(ui.fillThresholdInput, String(threshold));
            ui.erasePaintLock.checked = erasePaintEnabled;
            ui.eraseMaskLock.checked = eraseMaskEnabled;
            ui.invertDisplayBtn.classList.toggle(
                "is-active",
                maskDisplayInverted
            );
        },
    });
    controllerRef = controller;
    session.bind(ui.brushBtn, "click", () => controller.setTool("paint"));
    session.bind(ui.fillBtn, "click", () => controller.setTool("fill"));
    session.bind(ui.maskBrushBtn, "click", () => controller.setTool("mask"));
    session.bind(ui.eraseBtn, "click", () => controller.setTool("erase"));
    session.bind(ui.panBtn, "click", () => controller.setTool("pan"));
    session.bind(ui.erasePaintLock, "change", () => {
        controller.setErasePaintEnabled(ui.erasePaintLock.checked);
    });
    session.bind(ui.eraseMaskLock, "change", () => {
        controller.setEraseMaskEnabled(ui.eraseMaskLock.checked);
    });
    session.bind(ui.colorInput, "input", () => {
        controller.setPaintColor(ui.colorInput.value);
    });
    session.bind(ui.paintVisibilityBtn, "click", () => {
        controller.togglePaintVisibility();
    });
    session.bind(ui.paintOpacityRange, "input", () => {
        controller.setPaintOpacity(ui.paintOpacityRange.value);
    });
    bindRangeWheel(ui.paintOpacityRange);
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
    bindRangeWheel(ui.maskOpacityRange);
    bindCommitNumberInput(ui.maskOpacityInput, () => {
        controller.setMaskOpacity(parseUnitInput(ui.maskOpacityInput, "100"));
    });
    session.bind(ui.invertColorBtn, "click", () => {
        controller.invertMaskPixels();
    });
    session.bind(ui.invertPaintRegionBtn, "click", () => {
        controller.invertPaintRegion();
    });
    session.bind(ui.invertMaskRegionBtn, "click", () => {
        controller.invertMaskRegion();
    });
    session.bind(ui.invertDisplayBtn, "click", () => {
        controller.toggleMaskDisplayInvert();
    });
    session.bind(ui.brushRange, "input", () => {
        controller.setBrushSize(ui.brushRange.value);
    });
    bindRangeWheel(ui.brushRange);
    bindCommitNumberInput(ui.brushInput, () => {
        controller.setBrushSize(parseUnitInput(ui.brushInput, "100"));
    });
    session.bind(ui.hardnessRange, "input", () => {
        controller.setHardness(ui.hardnessRange.value);
    });
    bindRangeWheel(ui.hardnessRange);
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
    session.bind(ui.fillThresholdRange, "input", () => {
        controller.setThreshold(Number(ui.fillThresholdRange.value));
    });
    bindRangeWheel(ui.fillThresholdRange);
    bindCommitNumberInput(ui.fillThresholdInput, () => {
        controller.setThreshold(parseUnitInput(ui.fillThresholdInput, "32"));
    });
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
    session.bind(ui.overlay, "pointerdown", (event) => {
        if (shouldKeepEditorFieldFocus(event.target, ui.hotkeySink)) {
            return;
        }
        requestAnimationFrame(() => {
            focusHotkeySink();
        });
    }, {
        capture: true,
    });
    const handleKeyboardShortcut = (event) => {
        if (HANDLED_KEYBOARD_EVENTS.has(event)) {
            return;
        }
        if (shouldBypassPlainTextInput(event)) {
            return;
        }

        const key = getKeyboardEventKey(event);
        const withCommand = event.ctrlKey || event.metaKey;
        const isTextInputTarget = isTextEditableTarget(event.target);

        if (withCommand && (key === "z" || key === "y")) {
            stopKeyboardEvent(event);
            if (event.type === "keydown") {
                if (key === "y" || event.shiftKey) {
                    controller.redo();
                } else {
                    controller.undo();
                }
            }
            return;
        }

        if (key === "alt") {
            stopKeyboardEvent(event);
            controller.setModifierErase(event.type === "keydown");
            return;
        }

        if (event.altKey) {
            stopKeyboardEvent(event);
            return;
        }

        if (key === "escape") {
            stopKeyboardEvent(event);
            if (event.type === "keydown" && !event.repeat) {
                close();
            }
            return;
        }

        if (withCommand) {
            stopKeyboardEvent(event, {
                preventDefault: !isTextInputTarget,
            });
            return;
        }

        if (
            (key === "delete" || key === "backspace")
            && !isTextEditableTarget(event.target)
        ) {
            stopKeyboardEvent(event);
        }
    };
    session.bind(window, "keydown", handleKeyboardShortcut, {
        capture: true,
    });
    session.bind(document, "keydown", handleKeyboardShortcut, {
        capture: true,
    });
    session.bind(window, "keyup", handleKeyboardShortcut, {
        capture: true,
    });
    session.bind(document, "keyup", handleKeyboardShortcut, {
        capture: true,
    });
    session.bind(window, "blur", () => {
        controller.setModifierErase(false);
    });
    session.bind(window, "message", (event) => {
        const payload = event?.data;
        if (!payload) {
            return;
        }
        if (event.origin && event.origin !== window.location.origin) {
            return;
        }
        if (payload.type === "xdatahub:theme-context") {
            applyThemeContext(payload.context);
            return;
        }
        if (payload.type === "xdatahub:theme-mode") {
            applyThemeMode(payload.theme_mode);
        }
    });
    session.bind(document, "xdatahub:theme-context-applied", (event) => {
        applyThemeContext(event?.detail);
    });

    try {
        // 大图要等几秒，先亮出「加载中」，别让人对着一片空白猜
        session.setLoading(String(texts.loading || "Loading..."));
        await controller.load();
        controller.mount();
        controller.setTool("mask");
        controller.setBrushSize(ui.brushRange.value);
        controller.setHardness(ui.hardnessRange.value);
        controller.setPaintOpacity(ui.paintOpacityRange.value);
        controller.setMaskOpacity(ui.maskOpacityRange.value);
        controller.setThreshold(Number(ui.fillThresholdRange.value));
        session.setLoading("");
        focusHotkeySink();
    } catch (error) {
        session.setLoading(
            String(texts.loadFailed || "Failed to load image"),
            true
        );
        throw error;
    }

    session.bind(ui.saveBtn, "click", async () => {
        session.setBusy(true);
        session.setLoading(String(texts.saving || "Saving..."));
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
                    hasMask: exported.hasMask !== false,
                    hasPaint: exported.hasPaint === true,
                    transformState: exported.transformState,
                })
            );
            close();
        } catch (error) {
            session.setBusy(false);
            session.setLoading(
                String(texts.saveFailed || "Failed to save mask"),
                true
            );
        }
    });

    return {
        close,
    };
}
