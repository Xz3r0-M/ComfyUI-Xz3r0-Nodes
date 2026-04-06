import {
    canvasToBlob,
    clamp,
    loadImage,
} from "./utils.js";

const MIN_ZOOM = 0.01;
const MAX_ZOOM = 200;
const MAX_BRUSH_SIZE = 10000;
const MAX_BRUSH_WHEEL_STEP = 200;

export class XMaskEditorController {
    constructor({
        canvas,
        viewport,
        imageUrl,
        maskUrl,
        paintUrl,
        transformState,
        onStateChange,
    }) {
        this.canvas = canvas;
        this.viewport = viewport;
        this.imageUrl = String(imageUrl || "");
        this.maskUrl = String(maskUrl || "");
        this.paintUrl = String(paintUrl || "");
        this.onStateChange = typeof onStateChange === "function"
            ? onStateChange
            : () => {};

        this.ctx = this.canvas.getContext("2d", {
            alpha: true,
            willReadFrequently: true,
        });
        this.maskCanvas = document.createElement("canvas");
        this.maskCtx = this.maskCanvas.getContext("2d", {
            alpha: true,
            willReadFrequently: true,
        });
        this.paintCanvas = document.createElement("canvas");
        this.paintCtx = this.paintCanvas.getContext("2d", {
            alpha: true,
            willReadFrequently: true,
        });
        this.overlayCanvas = document.createElement("canvas");
        this.overlayCtx = this.overlayCanvas.getContext("2d", {
            alpha: true,
        });

        this.baseImage = null;
        this.imageWidth = 1;
        this.imageHeight = 1;
        this.zoom = 1;
        this.fitZoom = 1;
        this.panX = 0;
        this.panY = 0;
        this.tool = "mask";
        this.activeLayer = "mask";
        this.brushSize = 100;
        this.hardness = 100;
        this.paintColor = "#000000";
        this.paintOpacity = 1;
        this.maskBrushColor = "black";
        this.maskOpacity = 0.5;
        this.rotationQuarterTurns = 0;
        this.flipX = false;
        this.flipY = false;
        this.paintVisible = true;
        this.maskVisible = true;
        this.modifierErase = false;
        this.cursorPoint = null;
        this.isDrawing = false;
        this.isPanning = false;
        this.lastPoint = null;
        this.panStart = null;
        this.pointerId = null;
        this.history = [];
        this.historyIndex = -1;
        this.cursorAnimationFrame = 0;

        this.applyTransformState(transformState);

        this.handlePointerDown = this.handlePointerDown.bind(this);
        this.handlePointerMove = this.handlePointerMove.bind(this);
        this.handlePointerUp = this.handlePointerUp.bind(this);
        this.handlePointerLeave = this.handlePointerLeave.bind(this);
        this.handleContextMenu = this.handleContextMenu.bind(this);
        this.handleWheel = this.handleWheel.bind(this);
        this.handleResize = this.handleResize.bind(this);
        this.animateCursor = this.animateCursor.bind(this);
    }

    async load() {
        if (!this.imageUrl) {
            throw new Error("Image URL missing");
        }
        this.baseImage = await loadImage(this.imageUrl);
        const width = Math.max(
            1,
            this.baseImage.naturalWidth || this.baseImage.width
        );
        const height = Math.max(
            1,
            this.baseImage.naturalHeight || this.baseImage.height
        );
        this.imageWidth = width;
        this.imageHeight = height;
        this.maskCanvas.width = width;
        this.maskCanvas.height = height;
        this.paintCanvas.width = width;
        this.paintCanvas.height = height;
        this.overlayCanvas.width = width;
        this.overlayCanvas.height = height;
        this.maskCtx.clearRect(0, 0, width, height);
        this.paintCtx.clearRect(0, 0, width, height);

        if (this.maskUrl) {
            try {
                const maskImage = await loadImage(this.maskUrl);
                this.maskCtx.drawImage(maskImage, 0, 0, width, height);
            } catch {
                // ignore stale mask preview failures
            }
        }

        if (this.paintUrl) {
            try {
                const paintImage = await loadImage(this.paintUrl);
                this.paintCtx.drawImage(paintImage, 0, 0, width, height);
            } catch {
                // ignore stale paint preview failures
            }
        }

        this.resizeDisplayCanvas();
        this.fitZoom = this.computeFitZoom();
        this.zoom = this.fitZoom;
        this.updateZoomStyles();
        this.resetHistory();
        this.render();
        this.emitStateChange();
    }

    mount() {
        this.canvas.addEventListener("pointerdown", this.handlePointerDown);
        this.canvas.addEventListener("pointermove", this.handlePointerMove);
        this.canvas.addEventListener("pointerup", this.handlePointerUp);
        this.canvas.addEventListener("pointercancel", this.handlePointerUp);
        this.canvas.addEventListener("pointerleave", this.handlePointerLeave);
        this.canvas.addEventListener("contextmenu", this.handleContextMenu);
        this.viewport.addEventListener("wheel", this.handleWheel, {
            passive: false,
        });
        window.addEventListener("resize", this.handleResize);
        this.updateCursorStyle();
    }

    destroy() {
        this.canvas.removeEventListener("pointerdown", this.handlePointerDown);
        this.canvas.removeEventListener("pointermove", this.handlePointerMove);
        this.canvas.removeEventListener("pointerup", this.handlePointerUp);
        this.canvas.removeEventListener("pointercancel", this.handlePointerUp);
        this.canvas.removeEventListener("pointerleave", this.handlePointerLeave);
        this.canvas.removeEventListener("contextmenu", this.handleContextMenu);
        this.viewport.removeEventListener("wheel", this.handleWheel);
        window.removeEventListener("resize", this.handleResize);
        if (this.cursorAnimationFrame) {
            cancelAnimationFrame(this.cursorAnimationFrame);
            this.cursorAnimationFrame = 0;
        }
    }

    setTool(tool) {
        const value = String(tool || "mask");
        this.tool = ["paint", "mask", "erase", "pan"].includes(value)
            ? value
            : "mask";
        if (this.tool === "paint") {
            this.activeLayer = "paint";
        } else if (this.tool === "mask") {
            this.activeLayer = "mask";
        }
        this.updateCursorStyle();
        this.emitStateChange();
    }

    setModifierErase(enabled) {
        this.modifierErase = !!enabled;
        this.updateCursorStyle();
        this.render();
        this.emitStateChange();
    }

    setBrushSize(value) {
        this.brushSize = clamp(value, 1, MAX_BRUSH_SIZE);
        this.emitStateChange();
    }

    setHardness(value) {
        this.hardness = clamp(value, 1, 100);
        this.emitStateChange();
    }

    setPaintColor(value) {
        const normalized = String(value || "#ffffff").trim();
        this.paintColor = /^#[0-9a-fA-F]{6}$/.test(normalized)
            ? normalized
            : "#ffffff";
        this.emitStateChange();
    }

    setPaintOpacity(value) {
        this.paintOpacity = clamp(value, 0, 100) / 100;
        this.render();
        this.emitStateChange();
    }

    invertPaintColor() {
        const current = this.paintColor.replace("#", "");
        const red = 255 - Number.parseInt(current.slice(0, 2), 16);
        const green = 255 - Number.parseInt(current.slice(2, 4), 16);
        const blue = 255 - Number.parseInt(current.slice(4, 6), 16);
        const next = [red, green, blue]
            .map((item) => item.toString(16).padStart(2, "0"))
            .join("");
        this.setPaintColor(`#${next}`);
    }

    setMaskBrushColor(value) {
        this.maskBrushColor = value === "white" ? "white" : "black";
        this.emitStateChange();
    }

    setMaskOpacity(value) {
        this.maskOpacity = clamp(value, 0, 100) / 100;
        this.render();
        this.emitStateChange();
    }

    togglePaintVisibility() {
        this.paintVisible = !this.paintVisible;
        this.render();
        this.emitStateChange();
    }

    toggleMaskVisibility() {
        this.maskVisible = !this.maskVisible;
        this.render();
        this.emitStateChange();
    }

    updateOrientation(mutator) {
        const previousFitZoom = this.fitZoom;
        const followsViewport = Math.abs(this.zoom - previousFitZoom) < 0.001;
        mutator();
        this.fitZoom = this.computeFitZoom();
        if (followsViewport) {
            this.zoom = this.fitZoom;
            this.panX = 0;
            this.panY = 0;
        }
        this.render();
        this.emitStateChange();
    }

    rotateClockwise() {
        this.updateOrientation(() => {
            const step = this.flipX !== this.flipY ? 3 : 1;
            this.rotationQuarterTurns = (
                this.rotationQuarterTurns + step
            ) % 4;
        });
    }

    rotateCounterClockwise() {
        this.updateOrientation(() => {
            const step = this.flipX !== this.flipY ? 1 : 3;
            this.rotationQuarterTurns = (
                this.rotationQuarterTurns + step
            ) % 4;
        });
    }

    flipHorizontal() {
        this.updateOrientation(() => {
            this.flipX = !this.flipX;
        });
    }

    flipVertical() {
        this.updateOrientation(() => {
            this.flipY = !this.flipY;
        });
    }

    resetTransform() {
        this.updateOrientation(() => {
            this.rotationQuarterTurns = 0;
            this.flipX = false;
            this.flipY = false;
        });
    }

    invertMaskBrushColor() {
        this.setMaskBrushColor(
            this.maskBrushColor === "black" ? "white" : "black"
        );
    }

    setZoom(value) {
        this.zoom = clamp(value, MIN_ZOOM, MAX_ZOOM);
        this.updateZoomStyles();
        this.render();
        this.emitStateChange();
    }

    zoomBy(multiplier) {
        this.setZoom(this.zoom * Number(multiplier || 1));
    }

    setZoomPercent(percent) {
        const numeric = Number(percent);
        if (!Number.isFinite(numeric)) {
            this.emitStateChange();
            return;
        }
        this.setZoom(numeric / 100);
    }

    setOriginalZoom() {
        this.panX = 0;
        this.panY = 0;
        this.setZoom(1);
    }

    resetZoom() {
        this.fitZoom = this.computeFitZoom();
        this.panX = 0;
        this.panY = 0;
        this.setZoom(this.fitZoom);
    }

    clearLayers() {
        this.clearPaintLayer(false);
        this.clearMaskLayer(false);
        this.render();
        this.commitHistory();
    }

    clearPaintLayer(commitHistory = true) {
        this.paintCtx.clearRect(
            0,
            0,
            this.paintCanvas.width,
            this.paintCanvas.height
        );
        this.render();
        if (commitHistory) {
            this.commitHistory();
        }
    }

    clearMaskLayer(commitHistory = true) {
        this.maskCtx.clearRect(
            0,
            0,
            this.maskCanvas.width,
            this.maskCanvas.height
        );
        this.render();
        if (commitHistory) {
            this.commitHistory();
        }
    }

    invertMaskPixels() {
        const imageData = this.maskCtx.getImageData(
            0,
            0,
            this.maskCanvas.width,
            this.maskCanvas.height
        );
        const pixels = imageData.data;
        for (let index = 0; index < pixels.length; index += 4) {
            const alpha = pixels[index + 3];
            if (alpha === 0) {
                continue;
            }
            pixels[index] = 255 - pixels[index];
            pixels[index + 1] = 255 - pixels[index + 1];
            pixels[index + 2] = 255 - pixels[index + 2];
        }
        this.maskCtx.putImageData(imageData, 0, 0);
        this.render();
        this.commitHistory();
        this.emitStateChange();
    }

    captureSnapshot() {
        return {
            mask: this.maskCtx.getImageData(
                0,
                0,
                this.maskCanvas.width,
                this.maskCanvas.height
            ),
            paint: this.paintCtx.getImageData(
                0,
                0,
                this.paintCanvas.width,
                this.paintCanvas.height
            ),
        };
    }

    restoreSnapshot(snapshot) {
        if (!snapshot) {
            return;
        }
        this.maskCtx.putImageData(snapshot.mask, 0, 0);
        this.paintCtx.putImageData(snapshot.paint, 0, 0);
        this.render();
        this.emitStateChange();
    }

    resetHistory() {
        this.history = [this.captureSnapshot()];
        this.historyIndex = 0;
    }

    commitHistory() {
        const snapshot = this.captureSnapshot();
        if (this.historyIndex < (this.history.length - 1)) {
            this.history = this.history.slice(0, this.historyIndex + 1);
        }
        this.history.push(snapshot);
        if (this.history.length > 50) {
            this.history.shift();
        }
        this.historyIndex = this.history.length - 1;
        this.emitStateChange();
    }

    canUndo() {
        return this.historyIndex > 0;
    }

    canRedo() {
        return this.historyIndex >= 0
            && this.historyIndex < (this.history.length - 1);
    }

    undo() {
        if (!this.canUndo()) {
            return;
        }
        this.historyIndex -= 1;
        this.restoreSnapshot(this.history[this.historyIndex]);
    }

    redo() {
        if (!this.canRedo()) {
            return;
        }
        this.historyIndex += 1;
        this.restoreSnapshot(this.history[this.historyIndex]);
    }

    async exportArtifacts() {
        const exportMaskCanvas = this.buildExportCanvas(
            this.maskCanvas,
            this.maskOpacity
        );
        const maskBlob = await canvasToBlob(exportMaskCanvas);
        const exportPaintCanvas = this.buildExportCanvas(
            this.paintCanvas,
            this.paintOpacity
        );
        const paintBlob = this.hasPaintData()
            ? await canvasToBlob(exportPaintCanvas)
            : null;
        return {
            maskBlob,
            paintBlob,
            transformState: this.getTransformState(),
        };
    }

    getImageSize() {
        return {
            width: this.imageWidth,
            height: this.imageHeight,
        };
    }

    buildExportCanvas(sourceCanvas, opacity) {
        const alpha = clamp(Number(opacity ?? 1), 0, 1);
        if (alpha >= 0.999) {
            return sourceCanvas;
        }
        const exportCanvas = document.createElement("canvas");
        exportCanvas.width = sourceCanvas.width;
        exportCanvas.height = sourceCanvas.height;
        const exportCtx = exportCanvas.getContext("2d", {
            alpha: true,
            willReadFrequently: true,
        });
        exportCtx.clearRect(0, 0, exportCanvas.width, exportCanvas.height);
        exportCtx.globalAlpha = alpha;
        exportCtx.drawImage(sourceCanvas, 0, 0);
        return exportCanvas;
    }

    normalizeTransformState(value) {
        try {
            const parsed = typeof value === "string"
                ? JSON.parse(value || "{}")
                : (value || {});
            const rotation = Number(parsed?.rotation ?? 0);
            return {
                rotation: Number.isFinite(rotation)
                    ? ((Math.round(rotation) % 4) + 4) % 4
                    : 0,
                flipX: !!parsed?.flipX,
                flipY: !!parsed?.flipY,
            };
        } catch {
            return {
                rotation: 0,
                flipX: false,
                flipY: false,
            };
        }
    }

    applyTransformState(value) {
        const state = this.normalizeTransformState(value);
        this.rotationQuarterTurns = state.rotation;
        this.flipX = state.flipX;
        this.flipY = state.flipY;
    }

    getTransformState() {
        if (
            this.rotationQuarterTurns === 0
            && !this.flipX
            && !this.flipY
        ) {
            return "";
        }
        return JSON.stringify({
            rotation: this.rotationQuarterTurns,
            flipX: this.flipX,
            flipY: this.flipY,
        });
    }

    getBrushSizeText() {
        return `${Math.round(this.brushSize)} px`;
    }

    getBrushWheelStep(fineTune = false) {
        if (fineTune) {
            return 1;
        }
        const adaptiveStep = Math.round(Math.max(this.brushSize, 1) * 0.05);
        return clamp(adaptiveStep, 1, MAX_BRUSH_WHEEL_STEP);
    }

    getEffectiveTool() {
        if (this.modifierErase && ["paint", "mask"].includes(this.tool)) {
            return "erase";
        }
        return this.tool;
    }

    updateCursorStyle() {
        const effectiveTool = this.getEffectiveTool();
        this.canvas.style.cursor = effectiveTool === "pan"
            ? (this.isPanning ? "grabbing" : "grab")
            : "none";
    }

    updateZoomStyles() {
        this.canvas.style.width = "100%";
        this.canvas.style.height = "100%";
        this.canvas.style.transform = "none";
    }

    resizeDisplayCanvas() {
        const nextWidth = Math.max(
            1,
            Math.round(this.viewport.clientWidth || 1)
        );
        const nextHeight = Math.max(
            1,
            Math.round(this.viewport.clientHeight || 1)
        );
        if (this.canvas.width !== nextWidth) {
            this.canvas.width = nextWidth;
        }
        if (this.canvas.height !== nextHeight) {
            this.canvas.height = nextHeight;
        }
    }

    getContentScale() {
        return this.zoom;
    }

    getRotatedSourceDimensions() {
        const rotated = (this.rotationQuarterTurns % 2) !== 0;
        return {
            width: rotated ? this.imageHeight : this.imageWidth,
            height: rotated ? this.imageWidth : this.imageHeight,
        };
    }

    sourceToLocal(point) {
        const sourceX = Number(point?.x || 0) - (this.imageWidth / 2);
        const sourceY = Number(point?.y || 0) - (this.imageHeight / 2);
        let localX = sourceX;
        let localY = sourceY;
        switch (this.rotationQuarterTurns % 4) {
        case 1:
            localX = -sourceY;
            localY = sourceX;
            break;
        case 2:
            localX = -sourceX;
            localY = -sourceY;
            break;
        case 3:
            localX = sourceY;
            localY = -sourceX;
            break;
        default:
            break;
        }
        if (this.flipX) {
            localX = -localX;
        }
        if (this.flipY) {
            localY = -localY;
        }
        return {
            x: localX,
            y: localY,
        };
    }

    displayToSource(displayX, displayY) {
        const imageRect = this.getImageDisplayRect();
        let localX = (displayX - imageRect.centerX) / imageRect.scale;
        let localY = (displayY - imageRect.centerY) / imageRect.scale;
        if (this.flipX) {
            localX = -localX;
        }
        if (this.flipY) {
            localY = -localY;
        }
        let sourceX = localX;
        let sourceY = localY;
        switch (this.rotationQuarterTurns % 4) {
        case 1:
            sourceX = localY;
            sourceY = -localX;
            break;
        case 2:
            sourceX = -localX;
            sourceY = -localY;
            break;
        case 3:
            sourceX = -localY;
            sourceY = localX;
            break;
        default:
            break;
        }
        return {
            x: sourceX + (this.imageWidth / 2),
            y: sourceY + (this.imageHeight / 2),
        };
    }

    getImageDisplayRect(scaleOverride = this.zoom) {
        const scale = Math.max(Number(scaleOverride || 0), 0.0001);
        const displaySize = this.getRotatedSourceDimensions();
        const width = displaySize.width * scale;
        const height = displaySize.height * scale;
        const left = ((this.canvas.width - width) / 2) + this.panX;
        const top = ((this.canvas.height - height) / 2) + this.panY;
        return {
            left,
            top,
            width,
            height,
            scale,
            centerX: left + (width / 2),
            centerY: top + (height / 2),
        };
    }

    computeFitZoom() {
        const displaySize = this.getRotatedSourceDimensions();
        const width = Math.max(displaySize.width, 1);
        const height = Math.max(displaySize.height, 1);
        const availableWidth = Math.max(this.canvas.width, 1);
        const availableHeight = Math.max(this.canvas.height, 1);
        const scaleX = availableWidth / width;
        const scaleY = availableHeight / height;
        return clamp(Math.min(scaleX, scaleY, 1), MIN_ZOOM, MAX_ZOOM);
    }

    handleResize() {
        this.resizeDisplayCanvas();
        const previousFitZoom = this.fitZoom;
        const nextFitZoom = this.computeFitZoom();
        const followsViewport = Math.abs(this.zoom - previousFitZoom) < 0.001;
        this.fitZoom = nextFitZoom;
        if (followsViewport) {
            this.zoom = nextFitZoom;
            this.panX = 0;
            this.panY = 0;
            this.updateZoomStyles();
            this.render();
        } else {
            this.updateZoomStyles();
            this.render();
        }
        this.emitStateChange();
    }

    emitStateChange() {
        this.onStateChange({
            zoom: this.zoom,
            tool: this.getEffectiveTool(),
            selectedTool: this.tool,
            brushSize: this.brushSize,
            hardness: this.hardness,
            paintColor: this.paintColor,
            paintOpacity: Math.round(this.paintOpacity * 100),
            maskBrushColor: this.maskBrushColor,
            maskOpacity: Math.round(this.maskOpacity * 100),
            paintVisible: this.paintVisible,
            maskVisible: this.maskVisible,
            imageSize: this.getImageSize(),
            brushSizeText: this.getBrushSizeText(),
            canUndo: this.canUndo(),
            canRedo: this.canRedo(),
        });
    }

    handleContextMenu(event) {
        event.preventDefault();
    }

    handleWheel(event) {
        if (!this.baseImage) {
            return;
        }
        event.preventDefault();
        if (event.shiftKey) {
            const step = this.getBrushWheelStep(
                event.ctrlKey || event.metaKey
            );
            const delta = event.deltaY < 0 ? step : -step;
            this.setBrushSize(this.brushSize + delta);
            return;
        }
        const factor = event.deltaY < 0 ? 1.12 : 0.88;
        this.zoomAtPoint(this.zoom * factor, event);
    }

    zoomAtPoint(nextZoom, event) {
        const rect = this.canvas.getBoundingClientRect();
        const scaleX = this.canvas.width / Math.max(rect.width, 1);
        const scaleY = this.canvas.height / Math.max(rect.height, 1);
        const displayX = (event.clientX - rect.left) * scaleX;
        const displayY = (event.clientY - rect.top) * scaleY;
        const focusPoint = this.getCanvasPoint(event);
        const focusLocalPoint = this.sourceToLocal(focusPoint);
        const clampedZoom = clamp(nextZoom, MIN_ZOOM, MAX_ZOOM);
        this.zoom = clampedZoom;
        this.panX = displayX - (this.canvas.width / 2)
            - (focusLocalPoint.x * clampedZoom);
        this.panY = displayY - (this.canvas.height / 2)
            - (focusLocalPoint.y * clampedZoom);
        this.render();
        this.emitStateChange();
    }

    handlePointerDown(event) {
        if (!this.baseImage) {
            return;
        }
        this.cursorPoint = this.getDisplayPoint(event);
        const wantsPan = this.tool === "pan"
            || event.button === 1
            || (event.button === 0 && event.ctrlKey);
        if (wantsPan) {
            this.isPanning = true;
            this.pointerId = event.pointerId;
            this.panStart = {
                x: event.clientX,
                y: event.clientY,
                panX: this.panX,
                panY: this.panY,
            };
            this.canvas.setPointerCapture?.(event.pointerId);
            this.updateCursorStyle();
            return;
        }
        if (event.button !== 0) {
            return;
        }
        this.isDrawing = true;
        this.pointerId = event.pointerId;
        this.lastPoint = this.getCanvasPoint(event);
        this.canvas.setPointerCapture?.(event.pointerId);
        this.drawLine(this.lastPoint, this.lastPoint);
        this.render();
    }

    handlePointerMove(event) {
        if (this.isPanning && this.panStart) {
            this.cursorPoint = this.getDisplayPoint(event);
            const deltaX = event.clientX - this.panStart.x;
            const deltaY = event.clientY - this.panStart.y;
            const rect = this.canvas.getBoundingClientRect();
            const displayScaleX = rect.width / Math.max(this.canvas.width, 1);
            const displayScaleY = rect.height / Math.max(this.canvas.height, 1);
            this.panX = this.panStart.panX + (deltaX / displayScaleX);
            this.panY = this.panStart.panY + (deltaY / displayScaleY);
            this.render();
            return;
        }
        this.cursorPoint = this.getDisplayPoint(event);
        if (!this.isDrawing) {
            this.render();
            return;
        }
        const nextPoint = this.getCanvasPoint(event);
        this.drawLine(this.lastPoint, nextPoint);
        this.lastPoint = nextPoint;
        this.render();
    }

    handlePointerUp(event) {
        const hadDrawing = this.isDrawing;
        if (this.pointerId !== null) {
            this.canvas.releasePointerCapture?.(this.pointerId);
        }
        this.pointerId = null;
        this.isDrawing = false;
        this.lastPoint = null;
        this.isPanning = false;
        this.panStart = null;
        this.updateCursorStyle();
        if (hadDrawing) {
            this.commitHistory();
        }
        if (event?.type === "pointerup") {
            this.render();
        }
    }

    handlePointerLeave() {
        this.cursorPoint = null;
        this.render();
    }

    getCanvasPoint(event) {
        const displayPoint = this.getDisplayPoint(event);
        return this.displayToSource(displayPoint.x, displayPoint.y);
    }

    getDisplayPoint(event) {
        const rect = this.canvas.getBoundingClientRect();
        const scaleX = this.canvas.width / Math.max(rect.width, 1);
        const scaleY = this.canvas.height / Math.max(rect.height, 1);
        return {
            x: (event.clientX - rect.left) * scaleX,
            y: (event.clientY - rect.top) * scaleY,
        };
    }

    drawLine(fromPoint, toPoint) {
        if (!fromPoint || !toPoint) {
            return;
        }
        const effectiveTool = this.getEffectiveTool();
        if (effectiveTool === "paint") {
            this.drawPaintLine(fromPoint, toPoint);
            return;
        }
        if (effectiveTool === "mask") {
            this.drawMaskLine(fromPoint, toPoint, false);
            return;
        }
        if (effectiveTool === "erase") {
            if (this.activeLayer === "paint") {
                this.erasePaintLine(fromPoint, toPoint);
            } else {
                this.drawMaskLine(fromPoint, toPoint, true);
            }
        }
    }

    drawPaintLine(fromPoint, toPoint) {
        this.drawSoftStroke(this.paintCtx, fromPoint, toPoint, {
            color: this.paintColor,
            opacity: 1,
            erase: false,
        });
    }

    erasePaintLine(fromPoint, toPoint) {
        this.drawSoftStroke(this.paintCtx, fromPoint, toPoint, {
            color: "#000000",
            opacity: 1,
            erase: true,
        });
    }

    drawMaskLine(fromPoint, toPoint, erase = false) {
        const drawColor = this.maskBrushColor === "black"
            ? "#000000"
            : "#ffffff";
        this.drawSoftStroke(this.maskCtx, fromPoint, toPoint, {
            color: drawColor,
            opacity: 1,
            erase,
        });
    }

    hexToRgb(hex) {
        const raw = String(hex || "#000000").replace("#", "");
        return {
            r: Number.parseInt(raw.slice(0, 2), 16) || 0,
            g: Number.parseInt(raw.slice(2, 4), 16) || 0,
            b: Number.parseInt(raw.slice(4, 6), 16) || 0,
        };
    }

    drawSoftStroke(ctx, fromPoint, toPoint, options = {}) {
        const radius = this.brushSize / 2;
        const hardnessRatio = clamp(this.hardness, 1, 100) / 100;
        const innerRadius = radius * hardnessRatio;
        const dx = toPoint.x - fromPoint.x;
        const dy = toPoint.y - fromPoint.y;
        const distance = Math.hypot(dx, dy);
        const step = Math.max(radius * 0.2, 0.75);
        const steps = Math.max(1, Math.ceil(distance / step));
        const { r, g, b } = this.hexToRgb(options.color || "#000000");
        const opacity = clamp(Number(options.opacity ?? 1), 0, 1);
        const erase = !!options.erase;

        ctx.save();
        ctx.globalCompositeOperation = erase
            ? "destination-out"
            : "source-over";

        for (let index = 0; index <= steps; index += 1) {
            const t = steps > 0 ? (index / steps) : 0;
            const x = fromPoint.x + (dx * t);
            const y = fromPoint.y + (dy * t);

            if (hardnessRatio >= 0.999) {
                ctx.fillStyle = erase
                    ? "rgba(0, 0, 0, 1)"
                    : `rgba(${r}, ${g}, ${b}, ${opacity})`;
                ctx.beginPath();
                ctx.arc(x, y, radius, 0, Math.PI * 2);
                ctx.fill();
                continue;
            }

            const gradient = ctx.createRadialGradient(
                x,
                y,
                innerRadius,
                x,
                y,
                radius
            );
            if (erase) {
                gradient.addColorStop(0, "rgba(0, 0, 0, 1)");
                gradient.addColorStop(hardnessRatio, "rgba(0, 0, 0, 1)");
                gradient.addColorStop(1, "rgba(0, 0, 0, 0)");
            } else {
                gradient.addColorStop(0, `rgba(${r}, ${g}, ${b}, ${opacity})`);
                gradient.addColorStop(
                    hardnessRatio,
                    `rgba(${r}, ${g}, ${b}, ${opacity})`
                );
                gradient.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
            }
            ctx.fillStyle = gradient;
            ctx.beginPath();
            ctx.arc(x, y, radius, 0, Math.PI * 2);
            ctx.fill();
        }

        ctx.restore();
    }

    animateCursor() {
        this.cursorAnimationFrame = 0;
        if (this.cursorPoint && this.getEffectiveTool() !== "pan") {
            this.render();
        }
    }

    hasPaintData() {
        const imageData = this.paintCtx.getImageData(
            0,
            0,
            this.paintCanvas.width,
            this.paintCanvas.height
        );
        const pixels = imageData.data;
        for (let index = 3; index < pixels.length; index += 4) {
            if (pixels[index] > 0) {
                return true;
            }
        }
        return false;
    }

    render() {
        if (!this.baseImage) {
            return;
        }
        const width = this.canvas.width;
        const height = this.canvas.height;
        const imageRect = this.getImageDisplayRect();
        const drawTransformedLayer = (imageLike, opacity = 1) => {
            this.ctx.save();
            this.ctx.translate(imageRect.centerX, imageRect.centerY);
            this.ctx.scale(imageRect.scale, imageRect.scale);
            this.ctx.scale(this.flipX ? -1 : 1, this.flipY ? -1 : 1);
            this.ctx.rotate((Math.PI / 2) * this.rotationQuarterTurns);
            this.ctx.globalAlpha = opacity;
            this.ctx.drawImage(
                imageLike,
                -this.imageWidth / 2,
                -this.imageHeight / 2,
                this.imageWidth,
                this.imageHeight
            );
            this.ctx.restore();
        };
        this.ctx.clearRect(0, 0, width, height);
        drawTransformedLayer(this.baseImage, 1);
        if (this.paintVisible) {
            drawTransformedLayer(this.paintCanvas, this.paintOpacity);
        }
        if (this.maskVisible) {
            drawTransformedLayer(this.maskCanvas, this.maskOpacity);
        }

        if (this.cursorPoint && this.getEffectiveTool() !== "pan") {
            const cursorX = this.cursorPoint.x;
            const cursorY = this.cursorPoint.y;
            const cursorRadius = (this.brushSize * imageRect.scale) / 2;
            const cursorCircumference = 2 * Math.PI * cursorRadius;
            const dashCount = 16;
            const dashLength = Math.max(
                cursorCircumference / (dashCount * 2),
                1.2
            );
            const dashOffset = (
                performance.now() / 140
            ) % (dashLength * 2);
            this.ctx.save();
            this.ctx.lineWidth = 1;
            this.ctx.setLineDash([dashLength, dashLength]);
            this.ctx.beginPath();
            this.ctx.arc(
                cursorX,
                cursorY,
                cursorRadius,
                0,
                Math.PI * 2
            );
            this.ctx.strokeStyle = "#000000";
            this.ctx.stroke();
            this.ctx.lineDashOffset = dashOffset + dashLength;
            this.ctx.beginPath();
            this.ctx.arc(
                cursorX,
                cursorY,
                cursorRadius,
                0,
                Math.PI * 2
            );
            this.ctx.strokeStyle = "#ffffff";
            this.ctx.stroke();
            this.ctx.restore();

            if (!this.cursorAnimationFrame) {
                this.cursorAnimationFrame = requestAnimationFrame(
                    this.animateCursor
                );
            }
        } else if (this.cursorAnimationFrame) {
            cancelAnimationFrame(this.cursorAnimationFrame);
            this.cursorAnimationFrame = 0;
        }
    }
}
