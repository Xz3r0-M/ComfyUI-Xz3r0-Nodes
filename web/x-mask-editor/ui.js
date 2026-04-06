const STYLE_ID = "ximageget-mask-editor-style";

function createButton(className, text) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = className;
    const iconName = arguments[2];
    if (iconName) {
        const icon = document.createElement("img");
        icon.className = "ximageget-mask-editor-icon";
        icon.src = new URL(`../icons/${iconName}`, import.meta.url).href;
        icon.alt = "";
        icon.draggable = false;
        icon.setAttribute("draggable", "false");
        icon.setAttribute("aria-hidden", "true");
        button.appendChild(icon);
    }
    if (text) {
        const label = document.createElement("span");
        label.className = "ximageget-mask-editor-button-text";
        label.textContent = String(text || "");
        button.appendChild(label);
    }
    return button;
}

function setButtonTooltip(button, text) {
    const tooltip = String(text || "").trim();
    if (!tooltip) {
        return;
    }
    button.title = tooltip;
    button.setAttribute("aria-label", tooltip);
}

export function ensureMaskEditorStyles() {
    if (document.getElementById(STYLE_ID)) {
        return;
    }
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
        .ximageget-mask-editor-overlay {
            --ximageget-mask-editor-bg: var(
                --theme-bg-main,
                var(--comfy-menu-bg, #1a1a1a)
            );
            --ximageget-mask-editor-surface: var(
                --surface-input,
                var(--comfy-input-bg, #202020)
            );
            --ximageget-mask-editor-surface-soft: color-mix(
                in srgb,
                var(--ximageget-mask-editor-surface) 92%,
                transparent
            );
            --ximageget-mask-editor-text: var(
                --text-standard,
                var(--input-text, #f3f3f3)
            );
            --ximageget-mask-editor-text-muted: color-mix(
                in srgb,
                var(--ximageget-mask-editor-text) 90%,
                transparent
            );
            --ximageget-mask-editor-border: var(
                --border-standard,
                var(--borderColor, #4f4f4f)
            );
            --ximageget-mask-editor-accent: var(
                --xdh-brand-pink,
                #ea005e
            );
            --ximageget-mask-editor-accent-text: var(
                --xdh-brand-text-on-accent,
                #ffffff
            );
            --ximageget-mask-editor-shadow: var(
                --xdh-window-shadow,
                0 20px 80px rgba(0, 0, 0, 0.45)
            );
            position: fixed;
            inset: 0;
            z-index: 100000;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
            box-sizing: border-box;
            background: color-mix(
                in srgb,
                var(--ximageget-mask-editor-bg) 78%,
                transparent
            );
            backdrop-filter: blur(6px);
            color: var(--ximageget-mask-editor-text);
        }
        .ximageget-mask-editor-dialog {
            width: min(1220px, calc(100vw - 40px));
            height: min(920px, calc(100vh - 40px));
            display: grid;
            grid-template-rows: auto auto 1fr auto auto;
            gap: 12px;
            padding: 16px;
            border-radius: 16px;
            box-sizing: border-box;
            overflow: hidden;
            color: var(--ximageget-mask-editor-text);
            background: var(--ximageget-mask-editor-bg);
            border: 1px solid var(--ximageget-mask-editor-border);
            box-shadow: var(--ximageget-mask-editor-shadow);
        }
        .ximageget-mask-editor-header {
            display: flex;
            align-items: center;
            justify-content: flex-start;
            gap: 12px;
            min-width: 0;
            overflow: hidden;
        }
        .ximageget-mask-editor-header-main {
            display: flex;
            align-items: center;
            gap: 12px;
            flex-wrap: nowrap;
            flex: 1 1 auto;
            min-width: 0;
            overflow: hidden;
        }
        .ximageget-mask-editor-title {
            margin: 0;
            font-size: 18px;
            line-height: 1.2;
            font-weight: 700;
            min-width: 0;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        .ximageget-mask-editor-toolbar {
            display: grid;
            grid-template-rows: auto auto auto;
            gap: 10px;
            width: 100%;
            min-width: 0;
            overflow: hidden;
        }
        .ximageget-mask-editor-toolbar-row {
            display: flex;
            align-items: center;
            gap: 10px;
            flex-wrap: nowrap;
            min-width: 0;
            overflow: hidden;
        }
        .ximageget-mask-editor-actions {
            display: grid;
            grid-template-columns: minmax(0, 1fr) auto;
            gap: 10px;
            align-items: center;
            width: 100%;
            min-width: 0;
            overflow: hidden;
        }
        .ximageget-mask-editor-actions-main,
        .ximageget-mask-editor-actions-buttons {
            display: flex;
            align-items: center;
            gap: 10px;
            flex-wrap: nowrap;
            min-width: 0;
            overflow: hidden;
        }
        .ximageget-mask-editor-actions-main {
            justify-content: flex-start;
        }
        .ximageget-mask-editor-actions-buttons {
            margin-left: auto;
        }
        .ximageget-mask-editor-zoom-group {
            margin-left: auto;
            margin-right: auto;
        }
        .ximageget-mask-editor-group {
            display: inline-flex;
            align-items: center;
            gap: 8px;
            flex-wrap: nowrap;
            padding: 0;
            border: 0;
            background: transparent;
            position: relative;
            min-height: 32px;
            min-width: 0;
            overflow: hidden;
        }
        .ximageget-mask-editor-group.with-separator {
            padding-left: 16px;
        }
        .ximageget-mask-editor-group.with-separator::before {
            content: "";
            position: absolute;
            left: 0;
            top: 4px;
            bottom: 4px;
            width: 1px;
            background: var(--ximageget-mask-editor-border);
        }
        .ximageget-mask-editor-toolbar-break {
            display: none;
        }
        .ximageget-mask-editor-toolbar-spacer {
            flex: 1 1 auto;
            min-width: 0;
        }
        .ximageget-mask-editor-tool,
        .ximageget-mask-editor-action,
        .ximageget-mask-editor-zoom,
        .ximageget-mask-editor-primary,
        .ximageget-mask-editor-secondary {
            min-height: 32px;
            padding: 0 12px;
            border: 1px solid var(--ximageget-mask-editor-border);
            border-radius: 8px;
            background: var(--ximageget-mask-editor-surface);
            color: var(--ximageget-mask-editor-text);
            cursor: pointer;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 6px;
            flex: 0 1 auto;
            min-width: 0;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        .ximageget-mask-editor-zoom {
            padding: 0 10px;
        }
        .ximageget-mask-editor-visibility-btn {
            width: 104px;
            flex: 0 0 104px;
        }
        .ximageget-mask-editor-color {
            width: 36px;
            height: 32px;
            padding: 0;
            border: 1px solid var(--ximageget-mask-editor-border);
            border-radius: 8px;
            background: var(--ximageget-mask-editor-surface);
            cursor: pointer;
        }
        .ximageget-mask-editor-tool.is-active {
            background: var(--ximageget-mask-editor-accent);
            color: #ffffff;
        }
        .ximageget-mask-editor-action.is-hidden {
            background: color-mix(
                in srgb,
                var(--ximageget-mask-editor-accent) 22%,
                var(--ximageget-mask-editor-bg)
            );
            color: var(--ximageget-mask-editor-text);
        }
        .ximageget-mask-editor-header-close {
            margin-left: auto;
            min-width: 32px;
            padding: 0 10px;
        }
        .ximageget-mask-editor-icon {
            width: 14px;
            height: 14px;
            flex: 0 0 auto;
            opacity: 0.92;
            pointer-events: none;
            user-select: none;
            -webkit-user-drag: none;
            filter: var(--xdh-inner-icon-filter, var(--icon-color-filter, none));
        }
        .ximageget-mask-editor-tool.is-active .ximageget-mask-editor-icon,
        .ximageget-mask-editor-primary .ximageget-mask-editor-icon {
            filter: brightness(0) saturate(100%) invert(100%);
        }
        .ximageget-mask-editor-button-text {
            min-width: 0;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }
        .ximageget-mask-editor-chip {
            width: 28px;
            height: 28px;
            padding: 0;
            border: 1px solid var(--ximageget-mask-editor-border);
            border-radius: 8px;
            cursor: pointer;
            position: relative;
        }
        .ximageget-mask-editor-chip.is-active {
            box-shadow: 0 0 0 1px var(--ximageget-mask-editor-accent);
            border-color: var(--ximageget-mask-editor-accent);
        }
        .ximageget-mask-editor-chip-black {
            background: #101010;
        }
        .ximageget-mask-editor-chip-white {
            background: #f5f5f5;
        }
        .ximageget-mask-editor-primary {
            background: var(--ximageget-mask-editor-accent);
            border-color: var(--ximageget-mask-editor-accent);
            color: var(--ximageget-mask-editor-accent-text);
        }
        .ximageget-mask-editor-primary:disabled,
        .ximageget-mask-editor-tool:disabled,
        .ximageget-mask-editor-action:disabled,
        .ximageget-mask-editor-zoom:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }
        .ximageget-mask-editor-label {
            font-size: 12px;
            color: var(--ximageget-mask-editor-text-muted);
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        .ximageget-mask-editor-range {
            width: 93px;
            appearance: none;
            -webkit-appearance: none;
            height: 18px;
            background: transparent;
            accent-color: var(--ximageget-mask-editor-accent);
            cursor: pointer;
        }
        .ximageget-mask-editor-range-compact {
            width: 72px;
        }
        .ximageget-mask-editor-range-short {
            width: 75px;
        }
        .ximageget-mask-editor-range::-webkit-slider-runnable-track {
            height: 4px;
            border-radius: 999px;
            background: color-mix(
                in srgb,
                var(--ximageget-mask-editor-accent) 28%,
                var(--ximageget-mask-editor-surface)
            );
        }
        .ximageget-mask-editor-range::-webkit-slider-thumb {
            -webkit-appearance: none;
            width: 14px;
            height: 14px;
            margin-top: -5px;
            border: 2px solid var(--ximageget-mask-editor-bg);
            border-radius: 50%;
            background: var(--ximageget-mask-editor-accent);
            box-shadow: 0 0 0 1px var(--ximageget-mask-editor-accent);
        }
        .ximageget-mask-editor-range::-moz-range-track {
            height: 4px;
            border: 0;
            border-radius: 999px;
            background: color-mix(
                in srgb,
                var(--ximageget-mask-editor-accent) 28%,
                var(--ximageget-mask-editor-surface)
            );
        }
        .ximageget-mask-editor-range::-moz-range-thumb {
            width: 14px;
            height: 14px;
            border: 2px solid var(--ximageget-mask-editor-bg);
            border-radius: 50%;
            background: var(--ximageget-mask-editor-accent);
            box-shadow: 0 0 0 1px var(--ximageget-mask-editor-accent);
        }
        .ximageget-mask-editor-value,
        .ximageget-mask-editor-hint {
            font-size: 12px;
            color: var(--ximageget-mask-editor-text-muted);
            display: inline-flex;
            align-items: center;
            white-space: nowrap;
            font-variant-numeric: tabular-nums;
            font-family: ui-monospace, "Cascadia Mono", "Consolas", monospace;
        }
        .ximageget-mask-editor-size {
            width: 64px;
        }
        .ximageget-mask-editor-value-input {
            width: 72px;
            min-height: 32px;
            padding: 0 8px;
            border: 1px solid var(--ximageget-mask-editor-border);
            border-radius: 8px;
            background: var(--ximageget-mask-editor-surface);
            color: var(--ximageget-mask-editor-text);
            font-size: 12px;
            text-align: center;
            font-variant-numeric: tabular-nums;
            font-family: ui-monospace, "Cascadia Mono", "Consolas", monospace;
            cursor: text;
        }
        .ximageget-mask-editor-zoom-value {
            width: 64px;
            justify-content: center;
        }
        .ximageget-mask-editor-zoom-input {
            width: 76px;
            min-height: 32px;
            padding: 0 8px;
            border: 1px solid var(--ximageget-mask-editor-border);
            border-radius: 8px;
            background: var(--ximageget-mask-editor-surface);
            color: var(--ximageget-mask-editor-text);
            font-size: 12px;
            text-align: center;
            font-variant-numeric: tabular-nums;
            font-family: ui-monospace, "Cascadia Mono", "Consolas", monospace;
            cursor: text;
        }
        .ximageget-mask-editor-image-size {
            font-size: 12px;
            color: var(--ximageget-mask-editor-text-muted);
            width: 132px;
            font-variant-numeric: tabular-nums;
            font-family: ui-monospace, "Cascadia Mono", "Consolas", monospace;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        .ximageget-mask-editor-viewport {
            position: relative;
            overflow: hidden;
            min-width: 0;
            min-height: 0;
            min-height: 320px;
            border-radius: 14px;
            border: 1px solid var(--ximageget-mask-editor-border);
            background:
                linear-gradient(45deg,
                    color-mix(in srgb, var(--ximageget-mask-editor-surface-soft) 92%, transparent) 25%,
                    transparent 25%,
                    transparent 75%,
                    color-mix(in srgb, var(--ximageget-mask-editor-surface-soft) 92%, transparent) 75%),
                linear-gradient(45deg,
                    color-mix(in srgb, var(--ximageget-mask-editor-surface-soft) 92%, transparent) 25%,
                    transparent 25%,
                    transparent 75%,
                    color-mix(in srgb, var(--ximageget-mask-editor-surface-soft) 92%, transparent) 75%);
            background-position: 0 0, 12px 12px;
            background-size: 24px 24px;
        }
        .ximageget-mask-editor-stage {
            width: 100%;
            height: 100%;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 0;
            box-sizing: border-box;
        }
        .ximageget-mask-editor-canvas {
            display: block;
            width: 100%;
            height: 100%;
            border-radius: 10px;
            box-shadow: 0 12px 40px rgba(0, 0, 0, 0.3);
            background: transparent;
            touch-action: none;
        }
        @media (max-width: 840px) {
            .ximageget-mask-editor-dialog {
                height: 100%;
                padding: 12px;
                border-radius: 12px;
            }
            .ximageget-mask-editor-stage {
                padding: 0;
            }
            .ximageget-mask-editor-range {
                width: 75px;
            }
            .ximageget-mask-editor-range-compact,
            .ximageget-mask-editor-range-short {
                width: 64px;
            }
        }
    `;
    document.head.appendChild(style);
}

export function createMaskEditorUi(texts = {}) {
    const overlay = document.createElement("div");
    overlay.className = "ximageget-mask-editor-overlay xz3r0-datahub-window";

    const dialog = document.createElement("section");
    dialog.className = "ximageget-mask-editor-dialog";
    overlay.appendChild(dialog);

    const header = document.createElement("div");
    header.className = "ximageget-mask-editor-header";
    dialog.appendChild(header);

    const headerMain = document.createElement("div");
    headerMain.className = "ximageget-mask-editor-header-main";
    header.appendChild(headerMain);

    const title = document.createElement("h2");
    title.className = "ximageget-mask-editor-title";
    title.textContent = String(texts.dialogTitle || "XMaskEditor");
    headerMain.appendChild(title);

    const closeBtn = createButton(
        "ximageget-mask-editor-action ximageget-mask-editor-header-close",
        "",
        "x.svg"
    );
    setButtonTooltip(closeBtn, texts.closeTip || texts.close || "Close");

    const undoBtn = createButton(
        "ximageget-mask-editor-action",
        texts.undo || "Undo",
        "undo.svg"
    );
    const redoBtn = createButton(
        "ximageget-mask-editor-action",
        texts.redo || "Redo",
        "redo.svg"
    );
    setButtonTooltip(undoBtn, texts.undoTip || texts.undo || "Undo");
    setButtonTooltip(redoBtn, texts.redoTip || texts.redo || "Redo");
    const historyGroup = document.createElement("div");
    historyGroup.className = "ximageget-mask-editor-group";
    historyGroup.appendChild(undoBtn);
    historyGroup.appendChild(redoBtn);
    headerMain.appendChild(historyGroup);

    const transformGroup = document.createElement("div");
    transformGroup.className = "ximageget-mask-editor-group with-separator";
    const rotateLeftBtn = createButton(
        "ximageget-mask-editor-action",
        texts.rotateLeft || "Rot Left",
        "rotate-ccw.svg"
    );
    const rotateRightBtn = createButton(
        "ximageget-mask-editor-action",
        texts.rotateRight || "Rot Right",
        "rotate-cw.svg"
    );
    const flipHorizontalBtn = createButton(
        "ximageget-mask-editor-action",
        texts.flipHorizontal || "Flip H",
        "flip-horizontal-2.svg"
    );
    const flipVerticalBtn = createButton(
        "ximageget-mask-editor-action",
        texts.flipVertical || "Flip V",
        "flip-vertical-2.svg"
    );
    const resetTransformBtn = createButton(
        "ximageget-mask-editor-action",
        texts.resetTransform || "Reset",
        "refresh-ccw.svg"
    );
    setButtonTooltip(
        rotateLeftBtn,
        texts.rotateLeftTip || "Rotate image left"
    );
    setButtonTooltip(
        rotateRightBtn,
        texts.rotateRightTip || "Rotate image right"
    );
    setButtonTooltip(
        flipHorizontalBtn,
        texts.flipHorizontalTip || "Flip image left to right"
    );
    setButtonTooltip(
        flipVerticalBtn,
        texts.flipVerticalTip || "Flip image top to bottom"
    );
    setButtonTooltip(
        resetTransformBtn,
        texts.resetTransformTip || "Reset rotation and flip"
    );
    transformGroup.appendChild(rotateLeftBtn);
    transformGroup.appendChild(rotateRightBtn);
    transformGroup.appendChild(flipHorizontalBtn);
    transformGroup.appendChild(flipVerticalBtn);
    transformGroup.appendChild(resetTransformBtn);
    headerMain.appendChild(transformGroup);
    header.appendChild(closeBtn);

    const toolbar = document.createElement("div");
    toolbar.className = "ximageget-mask-editor-toolbar";
    dialog.appendChild(toolbar);

    const firstRow = document.createElement("div");
    firstRow.className = "ximageget-mask-editor-toolbar-row";
    toolbar.appendChild(firstRow);

    const secondRow = document.createElement("div");
    secondRow.className = "ximageget-mask-editor-toolbar-row";
    toolbar.appendChild(secondRow);

    const thirdRow = document.createElement("div");
    thirdRow.className = "ximageget-mask-editor-toolbar-row";
    toolbar.appendChild(thirdRow);

    const colorGroup = document.createElement("div");
    colorGroup.className = "ximageget-mask-editor-group";
    const brushBtn = createButton(
        "ximageget-mask-editor-tool",
        texts.toolBrush || "Brush",
        "palette.svg"
    );
    setButtonTooltip(brushBtn, texts.toolBrushTip || "Paint color");
    const colorLabel = document.createElement("span");
    colorLabel.className = "ximageget-mask-editor-label";
    colorLabel.textContent = String(texts.color || "Color");
    const colorInput = document.createElement("input");
    colorInput.className = "ximageget-mask-editor-color";
    colorInput.type = "color";
    colorInput.value = "#000000";
    colorGroup.appendChild(brushBtn);
    colorGroup.appendChild(colorLabel);
    colorGroup.appendChild(colorInput);
    firstRow.appendChild(colorGroup);

    const firstRowSpacer = document.createElement("div");
    firstRowSpacer.className = "ximageget-mask-editor-toolbar-spacer";
    firstRow.appendChild(firstRowSpacer);

    const paintOpacityGroup = document.createElement("div");
    paintOpacityGroup.className = "ximageget-mask-editor-group";
    const paintOpacityLabel = document.createElement("span");
    paintOpacityLabel.className = "ximageget-mask-editor-label";
    paintOpacityLabel.textContent = String(
        texts.paintOpacity || "Color Preview Opacity"
    );
    const paintOpacityRange = document.createElement("input");
    paintOpacityRange.className = (
        "ximageget-mask-editor-range "
        + "ximageget-mask-editor-range-compact"
    );
    paintOpacityRange.type = "range";
    paintOpacityRange.min = "0";
    paintOpacityRange.max = "100";
    paintOpacityRange.step = "1";
    paintOpacityRange.value = "100";
    const paintOpacityInput = document.createElement("input");
    paintOpacityInput.className = "ximageget-mask-editor-value-input";
    paintOpacityInput.type = "text";
    paintOpacityInput.inputMode = "numeric";
    paintOpacityInput.value = "100%";
    const paintVisibilityBtn = createButton(
        "ximageget-mask-editor-action ximageget-mask-editor-visibility-btn",
        texts.showPaint || "Visible",
        "eye.svg"
    );
    setButtonTooltip(
        paintVisibilityBtn,
        texts.hidePaintTip || "Hide color layer"
    );
    paintOpacityGroup.appendChild(paintOpacityLabel);
    paintOpacityGroup.appendChild(paintOpacityRange);
    paintOpacityGroup.appendChild(paintOpacityInput);
    paintOpacityGroup.appendChild(paintVisibilityBtn);
    firstRow.appendChild(paintOpacityGroup);

    const maskGroup = document.createElement("div");
    maskGroup.className = "ximageget-mask-editor-group";
    const maskBrushBtn = createButton(
        "ximageget-mask-editor-tool",
        texts.toolMaskBrush || "Mask Brush",
        "brush-cleaning.svg"
    );
    setButtonTooltip(maskBrushBtn, texts.toolMaskBrushTip || "Paint mask");
    const maskColorLabel = document.createElement("span");
    maskColorLabel.className = "ximageget-mask-editor-label";
    maskColorLabel.textContent = String(texts.maskColor || "Mask");
    const maskBlackBtn = document.createElement("button");
    maskBlackBtn.type = "button";
    maskBlackBtn.className = (
        "ximageget-mask-editor-chip "
        + "ximageget-mask-editor-chip-black"
    );
    setButtonTooltip(maskBlackBtn, texts.maskBlackTip || "Black mask");
    const maskWhiteBtn = document.createElement("button");
    maskWhiteBtn.type = "button";
    maskWhiteBtn.className = (
        "ximageget-mask-editor-chip "
        + "ximageget-mask-editor-chip-white"
    );
    setButtonTooltip(maskWhiteBtn, texts.maskWhiteTip || "White mask");
    const invertColorBtn = createButton(
        "ximageget-mask-editor-action",
        texts.invertColor || "Invert",
        "contrast.svg"
    );
    setButtonTooltip(
        invertColorBtn,
        texts.invertColorTip || "Swap black and white"
    );
    maskGroup.appendChild(maskBrushBtn);
    maskGroup.appendChild(maskColorLabel);
    maskGroup.appendChild(maskBlackBtn);
    maskGroup.appendChild(maskWhiteBtn);
    maskGroup.appendChild(invertColorBtn);
    secondRow.appendChild(maskGroup);

    const secondRowSpacer = document.createElement("div");
    secondRowSpacer.className = "ximageget-mask-editor-toolbar-spacer";
    secondRow.appendChild(secondRowSpacer);

    const maskOpacityGroup = document.createElement("div");
    maskOpacityGroup.className = "ximageget-mask-editor-group";
    const maskOpacityLabel = document.createElement("span");
    maskOpacityLabel.className = "ximageget-mask-editor-label";
    maskOpacityLabel.textContent = String(
        texts.maskOpacity || "Mask Preview Opacity"
    );
    const maskOpacityRange = document.createElement("input");
    maskOpacityRange.className = (
        "ximageget-mask-editor-range "
        + "ximageget-mask-editor-range-compact"
    );
    maskOpacityRange.type = "range";
    maskOpacityRange.min = "0";
    maskOpacityRange.max = "100";
    maskOpacityRange.step = "1";
    maskOpacityRange.value = "50";
    const maskOpacityInput = document.createElement("input");
    maskOpacityInput.className = "ximageget-mask-editor-value-input";
    maskOpacityInput.type = "text";
    maskOpacityInput.inputMode = "numeric";
    maskOpacityInput.value = "50%";
    const maskVisibilityBtn = createButton(
        "ximageget-mask-editor-action ximageget-mask-editor-visibility-btn",
        texts.showMask || "Visible",
        "eye.svg"
    );
    setButtonTooltip(
        maskVisibilityBtn,
        texts.hideMaskTip || "Hide mask layer"
    );
    maskOpacityGroup.appendChild(maskOpacityLabel);
    maskOpacityGroup.appendChild(maskOpacityRange);
    maskOpacityGroup.appendChild(maskOpacityInput);
    maskOpacityGroup.appendChild(maskVisibilityBtn);
    secondRow.appendChild(maskOpacityGroup);

    const optionsTools = document.createElement("div");
    optionsTools.className = "ximageget-mask-editor-group";
    const eraseBtn = createButton(
        "ximageget-mask-editor-tool",
        texts.toolErase || "Erase",
        "eraser.svg"
    );
    setButtonTooltip(eraseBtn, texts.toolEraseTip || "Erase current layer");
    const panBtn = createButton(
        "ximageget-mask-editor-tool",
        texts.toolPan || "Pan",
        "hand-grab.svg"
    );
    setButtonTooltip(
        panBtn,
        texts.toolPanTip
            || "Move the canvas (middle mouse drag / Ctrl+left drag)"
    );
    optionsTools.appendChild(eraseBtn);
    optionsTools.appendChild(panBtn);
    thirdRow.appendChild(optionsTools);

    const brushGroup = document.createElement("div");
    brushGroup.className = "ximageget-mask-editor-group with-separator";
    const brushLabel = document.createElement("span");
    brushLabel.className = "ximageget-mask-editor-label";
    brushLabel.textContent = String(
        texts.brushSize || "Brush and Eraser Size"
    );
    setButtonTooltip(
        brushLabel,
        texts.brushSizeTip
            || "Ctrl/Cmd + Wheel adaptive, Ctrl/Cmd + Shift + Wheel fine"
    );
    const brushRange = document.createElement("input");
    brushRange.className = (
        "ximageget-mask-editor-range "
        + "ximageget-mask-editor-range-short"
    );
    brushRange.type = "range";
    brushRange.min = "1";
    brushRange.max = "10000";
    brushRange.step = "1";
    brushRange.value = "100";
    setButtonTooltip(
        brushRange,
        texts.brushSizeTip
            || "Ctrl/Cmd + Wheel adaptive, Ctrl/Cmd + Shift + Wheel fine"
    );
    const brushInput = document.createElement("input");
    brushInput.className = "ximageget-mask-editor-value-input";
    brushInput.type = "text";
    brushInput.inputMode = "numeric";
    brushInput.value = "100px";
    setButtonTooltip(
        brushInput,
        texts.brushSizeTip
            || "Ctrl/Cmd + Wheel adaptive, Ctrl/Cmd + Shift + Wheel fine"
    );
    brushGroup.appendChild(brushLabel);
    brushGroup.appendChild(brushRange);
    brushGroup.appendChild(brushInput);
    thirdRow.appendChild(brushGroup);

    const hardnessGroup = document.createElement("div");
    hardnessGroup.className = "ximageget-mask-editor-group";
    const hardnessLabel = document.createElement("span");
    hardnessLabel.className = "ximageget-mask-editor-label";
    hardnessLabel.textContent = String(
        texts.hardness || "Edge Hardness"
    );
    const hardnessRange = document.createElement("input");
    hardnessRange.className = (
        "ximageget-mask-editor-range "
        + "ximageget-mask-editor-range-short"
    );
    hardnessRange.type = "range";
    hardnessRange.min = "1";
    hardnessRange.max = "100";
    hardnessRange.step = "1";
    hardnessRange.value = "100";
    const hardnessInput = document.createElement("input");
    hardnessInput.className = "ximageget-mask-editor-value-input";
    hardnessInput.type = "text";
    hardnessInput.inputMode = "numeric";
    hardnessInput.value = "100%";
    hardnessGroup.appendChild(hardnessLabel);
    hardnessGroup.appendChild(hardnessRange);
    hardnessGroup.appendChild(hardnessInput);
    thirdRow.appendChild(hardnessGroup);

    const toolbarSpacer = document.createElement("div");
    toolbarSpacer.className = "ximageget-mask-editor-toolbar-spacer";
    thirdRow.appendChild(toolbarSpacer);

    const clearPaintBtn = createButton(
        "ximageget-mask-editor-action",
        texts.clearPaint || "Clear Color",
        "trash-2.svg"
    );
    const clearMaskBtn = createButton(
        "ximageget-mask-editor-action",
        texts.clearMask || "Clear Mask",
        "trash-2.svg"
    );
    setButtonTooltip(
        clearPaintBtn,
        texts.clearPaintTip || texts.clearPaint || "Clear Color"
    );
    setButtonTooltip(
        clearMaskBtn,
        texts.clearMaskTip || texts.clearMask || "Clear Mask"
    );
    const clearGroup = document.createElement("div");
    clearGroup.className = "ximageget-mask-editor-group";
    clearGroup.appendChild(clearPaintBtn);
    clearGroup.appendChild(clearMaskBtn);
    thirdRow.appendChild(clearGroup);

    const zoomGroup = document.createElement("div");
    zoomGroup.className = (
        "ximageget-mask-editor-group "
        + "ximageget-mask-editor-zoom-group"
    );
    const zoomOutBtn = createButton(
        "ximageget-mask-editor-zoom",
        "",
        "zoom-out.svg"
    );
    setButtonTooltip(zoomOutBtn, texts.zoomOutTip || texts.zoomOut || "Zoom Out");
    const zoomInput = document.createElement("input");
    zoomInput.className = "ximageget-mask-editor-zoom-input";
    zoomInput.type = "text";
    zoomInput.inputMode = "numeric";
    zoomInput.value = "100%";
    const zoomInBtn = createButton(
        "ximageget-mask-editor-zoom",
        "",
        "zoom-in.svg"
    );
    setButtonTooltip(zoomInBtn, texts.zoomInTip || texts.zoomIn || "Zoom In");
    const zoomOriginalBtn = createButton(
        "ximageget-mask-editor-zoom",
        texts.originalSize || "Original",
        "maximize-2.svg"
    );
    setButtonTooltip(
        zoomOriginalBtn,
        texts.originalSizeTip || texts.originalSize || "Original Size"
    );
    const zoomResetBtn = createButton(
        "ximageget-mask-editor-zoom",
        texts.zoomReset || "Reset",
        "refresh-ccw.svg"
    );
    setButtonTooltip(
        zoomResetBtn,
        texts.zoomResetTip || texts.zoomReset || "Reset"
    );
    zoomGroup.appendChild(zoomOutBtn);
    zoomGroup.appendChild(zoomInput);
    zoomGroup.appendChild(zoomInBtn);
    zoomGroup.appendChild(zoomOriginalBtn);
    zoomGroup.appendChild(zoomResetBtn);

    const viewport = document.createElement("div");
    viewport.className = "ximageget-mask-editor-viewport";
    dialog.appendChild(viewport);

    const stage = document.createElement("div");
    stage.className = "ximageget-mask-editor-stage";
    viewport.appendChild(stage);

    const canvas = document.createElement("canvas");
    canvas.className = "ximageget-mask-editor-canvas";
    stage.appendChild(canvas);

    const actions = document.createElement("div");
    actions.className = "ximageget-mask-editor-actions";
    dialog.appendChild(actions);

    const actionsMain = document.createElement("div");
    actionsMain.className = "ximageget-mask-editor-actions-main";
    actions.appendChild(actionsMain);

    const imageSizeValue = document.createElement("span");
    imageSizeValue.className = "ximageget-mask-editor-image-size";
    imageSizeValue.textContent = "-- x --";
    actionsMain.appendChild(imageSizeValue);
    actionsMain.appendChild(zoomGroup);

    const actionButtons = document.createElement("div");
    actionButtons.className = "ximageget-mask-editor-actions-buttons";
    actions.appendChild(actionButtons);

    const saveBtn = createButton(
        "ximageget-mask-editor-primary",
        texts.save || "Save",
        "save.svg"
    );
    setButtonTooltip(saveBtn, texts.saveTip || texts.save || "Save");
    const cancelBtn = createButton(
        "ximageget-mask-editor-secondary",
        texts.cancel || "Cancel",
        "x.svg"
    );
    setButtonTooltip(cancelBtn, texts.cancelTip || texts.cancel || "Cancel");
    actionButtons.appendChild(saveBtn);
    actionButtons.appendChild(cancelBtn);

    return {
        overlay,
        dialog,
        title,
        brushBtn,
        maskBrushBtn,
        eraseBtn,
        panBtn,
        undoBtn,
        redoBtn,
        closeBtn,
        rotateLeftBtn,
        rotateRightBtn,
        flipHorizontalBtn,
        flipVerticalBtn,
        resetTransformBtn,
        colorInput,
        paintVisibilityBtn,
        paintOpacityRange,
        paintOpacityInput,
        maskBlackBtn,
        maskWhiteBtn,
        maskVisibilityBtn,
        maskOpacityRange,
        maskOpacityInput,
        invertColorBtn,
        brushRange,
        brushInput,
        hardnessRange,
        hardnessInput,
        zoomOutBtn,
        zoomInput,
        zoomInBtn,
        zoomOriginalBtn,
        zoomResetBtn,
        imageSizeValue,
        clearPaintBtn,
        clearMaskBtn,
        viewport,
        canvas,
        saveBtn,
        cancelBtn,
    };
}
