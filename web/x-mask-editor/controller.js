import {
    canvasToBlob,
    clamp,
    loadImage,
} from "./utils.js";

const MIN_ZOOM = 0.01;
const MAX_ZOOM = 200;
const MAX_BRUSH_WHEEL_STEP = 200;
const BRUSH_DEFAULT_FRACTION = 0.1;
const BRUSH_MAX_FRACTION = 0.8;
const BRUSH_MIN = 1;
const SESSION_KEY = "xz3r0_xmaskeditor_settings";
// 方格「透明底」的格子边长（和原来 CSS 里的一致）
const CHECKER_TILE_SIZE = 24;
// 遮罩 / 颜色图层最大边长：几万×几万的图，图层按原分辨率会吃掉几百 MB，
// 每帧还要缩放一遍整块。超过这个尺寸就按比例缩小存储，导出时再放大回原尺寸。
const MAX_LAYER_EDGE = 4096;
// 撤销历史的内存预算：一张图层快照 = 宽 × 高 × 4 字节，超大图要限制步数。
const HISTORY_BUDGET_BYTES = 768 * 1024 * 1024;
const HISTORY_MIN_DEPTH = 4;
const HISTORY_MAX_DEPTH = 50;
// 撤销历史按「块」存：只记这一笔真正改到的小方块。
const HISTORY_TILE = 256;
// 缩略金字塔：给缩小显示准备的小图，预算控制总占用
const PYRAMID_MAX_BYTES = 96 * 1024 * 1024;
const PYRAMID_MIN_EDGE = 128;

/** a 是否完全盖住 b。 */
function rectContains(a, b) {
    return a.x0 <= b.x0 && a.y0 <= b.y0 && a.x1 >= b.x1 && a.y1 >= b.y1;
}

/** 把几个矩形合成一个（都为空时返回 null）。 */
function unionRects(rects) {
    let result = null;
    for (const rect of rects) {
        if (!rect) {
            continue;
        }
        if (!result) {
            result = { x0: rect.x0, y0: rect.y0, x1: rect.x1, y1: rect.y1 };
            continue;
        }
        result.x0 = Math.min(result.x0, rect.x0);
        result.y0 = Math.min(result.y0, rect.y0);
        result.x1 = Math.max(result.x1, rect.x1);
        result.y1 = Math.max(result.y1, rect.y1);
    }
    return result;
}

function maxChannelDiff(r1, g1, b1, r2, g2, b2) {
    return Math.max(
        Math.abs(r1 - r2),
        Math.abs(g1 - g2),
        Math.abs(b1 - b2)
    );
}

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

        // 显示画布只用来画、从不读像素，所以不给 willReadFrequently
        // （那个提示会让浏览器把它留在 CPU 上，缩放整图会明显变慢）。
        this.ctx = this.canvas.getContext("2d", { alpha: true });
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
        // 「场景缓存」：方格 + 原图 + 颜色层 + 遮罩层合成后的画面。
        // 鼠标只是移动时直接贴这张，耗时跟图片多大无关。
        this.sceneCanvas = document.createElement("canvas");
        this.sceneCtx = this.sceneCanvas.getContext("2d", { alpha: true });
        this._sceneKey = "";
        this._sceneDirty = true;
        this._dirtyRect = null;
        // 图层内容范围（图层像素坐标），用来把「还有没有内容」的检查
        // 限制在画过的区域，不用每次扫全图。null = 未知。
        this._contentBounds = { mask: null, paint: null };
        this._whiteMaskDirty = true;
        // 这一步（一笔 / 一次操作）里，每一层被改到的块在改之前的样子
        this._stepTiles = { mask: new Map(), paint: new Map() };
        // 整层被改的操作（清空、反相、填充）走整层快照
        this._stepFull = { mask: null, paint: null };
        // 这一步开始前，各层「有没有内容」（撤销时直接用，不必扫像素）
        this._stepContent = { mask: undefined, paint: undefined };
        this._stepCleared = { mask: false, paint: false };
        // 缩略金字塔（缩小显示时用的小图，见 pyramidSource）
        this._pyramids = {
            image: null,
            mask: null,
            paint: null,
            white: null,
        };
        this._fillMarks = null;
        this._baseScaledBitmap = null;
        // 上一次的画笔圆环位置（局部更新时要把它擦掉）
        this._lastCursorRect = null;
        // 渲染按屏幕刷新率合并：一帧只画一次
        this._rafId = null;

        this.baseImage = null;
        this.imageWidth = 1;
        this.imageHeight = 1;
        this.imageDiagonal = 1;
        // 图层画布的真实尺寸（超大图会被按比例缩小）
        this.layerScale = 1;
        this.layerWidth = 1;
        this.layerHeight = 1;
        this.zoom = 1;
        this.fitZoom = 1;
        this.panX = 0;
        this.panY = 0;
        this.tool = "mask";
        this.activeLayer = "mask";
        this.brushSize = 100;
        this._brushSizeInitialized = false;
        this.hardness = 100;
        this.paintColor = "#000000";
        this.paintOpacity = 1;
        this.maskBrushColor = "black";
        this.maskDisplayOpacity = 0.75;
        this.maskOpacity = 1;
        this.maskDisplayInverted = false;
        this.threshold = 32;
        this.erasePaintEnabled = true;
        this.eraseMaskEnabled = true;

        this._loadSessionSettings();
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
        this._whiteMaskCanvas = null;
        this._whiteMaskCtx = null;
        this._checkerPattern = null;
        this._checkerKey = "";
        this._checkerCanvas = null;
        this._checkerCanvasKey = "";
        // 遮罩 / 颜色层里到底有没有东西：false 就别画，省掉一次整图缩放。
        // null 表示还没确认，下一次渲染时扫一遍再决定。
        this.maskHasContent = null;
        this.paintHasContent = null;
        this.applyTransformState(transformState);

        this.handlePointerDown = this.handlePointerDown.bind(this);
        this.handlePointerMove = this.handlePointerMove.bind(this);
        this.handlePointerUp = this.handlePointerUp.bind(this);
        this.handlePointerLeave = this.handlePointerLeave.bind(this);
        this.handleContextMenu = this.handleContextMenu.bind(this);
        this.handleWheel = this.handleWheel.bind(this);
        this.handleResize = this.handleResize.bind(this);
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
        this.imageDiagonal = Math.sqrt(width * width + height * height);
        // 图层按「原尺寸」还是「缩小后尺寸」存储
        const maxEdge = Math.max(width, height);
        this.layerScale = Math.min(1, MAX_LAYER_EDGE / maxEdge);
        this.layerWidth = Math.max(1, Math.round(width * this.layerScale));
        this.layerHeight = Math.max(1, Math.round(height * this.layerScale));
        // 首次加载时根据图片尺寸自动设定画笔大小
        if (!this._brushSizeInitialized) {
            this.brushSize = this.getDefaultBrushSize();
            this._brushSizeInitialized = true;
        }
        this.maskCanvas.width = this.layerWidth;
        this.maskCanvas.height = this.layerHeight;
        // 底图先缩到图层大小存一份：填充时直接贴图，不用每次重新缩放
        try {
            this._baseScaledBitmap = typeof createImageBitmap === "function"
                ? await createImageBitmap(this.baseImage, {
                    resizeWidth: this.layerWidth,
                    resizeHeight: this.layerHeight,
                    resizeQuality: "high",
                })
                : null;
        } catch {
            this._baseScaledBitmap = null;
        }
        this.paintCanvas.width = this.layerWidth;
        this.paintCanvas.height = this.layerHeight;
        this.maskCtx.clearRect(0, 0, this.layerWidth, this.layerHeight);
        this.paintCtx.clearRect(0, 0, this.layerWidth, this.layerHeight);
        this.maskHasContent = false;
        this.paintHasContent = false;
        this._contentBounds = { mask: null, paint: null };
        this._stepTiles = { mask: new Map(), paint: new Map() };
        this._stepFull = { mask: null, paint: null };
        this._stepContent = { mask: undefined, paint: undefined };
        this._stepCleared = { mask: false, paint: false };
        this._whiteMaskDirty = true;
        this._whiteMaskCanvas = null;
        this._checkerCanvas = null;
        this._sceneKey = "";
        this._sceneDirty = true;
        this._lastCursorRect = null;
        this._dirtyRect = null;
        this._pyramids = {
            image: null,
            mask: null,
            paint: null,
            white: null,
        };

        if (this.maskUrl) {
            try {
                const maskImage = await loadImage(this.maskUrl);
                this.maskCtx.drawImage(
                    maskImage,
                    0,
                    0,
                    this.layerWidth,
                    this.layerHeight
                );
                this.maskHasContent = true;
            } catch {
                // ignore stale mask preview failures
            }
        }

        if (this.paintUrl) {
            try {
                const paintImage = await loadImage(this.paintUrl);
                this.paintCtx.drawImage(
                    paintImage,
                    0,
                    0,
                    this.layerWidth,
                    this.layerHeight
                );
                this.paintHasContent = true;
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
        this.cancelScheduledRender();
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
        this.tool = ["paint", "mask", "erase", "pan", "fill"].includes(value)
            ? value
            : "mask";
        if (this.tool === "paint" || this.tool === "fill") {
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
        this.scheduleRender();
        this.emitStateChange();
    }

    getMaxBrushSize() {
        return Math.max(BRUSH_MIN + 1, Math.round(
            this.imageDiagonal * BRUSH_MAX_FRACTION
        ));
    }

    getDefaultBrushSize() {
        return Math.max(BRUSH_MIN, Math.round(
            this.imageDiagonal * BRUSH_DEFAULT_FRACTION
        ));
    }

    setBrushSize(value) {
        this.brushSize = clamp(value, BRUSH_MIN, this.getMaxBrushSize());
        this.emitStateChange();
    }

    setHardness(value) {
        this.hardness = clamp(value, 1, 100);
        this._saveSessionSettings();
        this.emitStateChange();
    }

    setPaintColor(value) {
        const normalized = String(value || "#ffffff").trim();
        this.paintColor = /^#[0-9a-fA-F]{6}$/.test(normalized)
            ? normalized
            : "#ffffff";
        this._saveSessionSettings();
        this.emitStateChange();
    }

    setPaintOpacity(value) {
        this.paintOpacity = clamp(value, 0, 100) / 100;
        this._saveSessionSettings();
        this.scheduleRender();
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
        this._saveSessionSettings();
        this.emitStateChange();
    }

    setMaskOpacity(value) {
        this.maskOpacity = clamp(value, 0, 100) / 100;
        this._saveSessionSettings();
        this.scheduleRender();
        this.emitStateChange();
    }

    setThreshold(value) {
        this.threshold = clamp(value, 0, 255);
        this._saveSessionSettings();
        this.emitStateChange();
    }

    setErasePaintEnabled(enabled) {
        this.erasePaintEnabled = !!enabled;
        this._saveSessionSettings();
        this.emitStateChange();
    }

    setEraseMaskEnabled(enabled) {
        this.eraseMaskEnabled = !!enabled;
        this._saveSessionSettings();
        this.emitStateChange();
    }

    /** 填充用的合成画布（用完就丢，不常驻占 67 MB）。 */
    newCompositeContext(width, height) {
        // 一次性用完就丢：常驻一块 4096² 的画布要占 67 MB 太贵
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        return canvas.getContext("2d", {
            alpha: true,
            willReadFrequently: true,
        });
    }

    /** 预先缩好的底图（没有就返回 null，调用方退回原图）。 */
    baseScaledSource() {
        const bitmap = this._baseScaledBitmap;
        if (!bitmap) {
            return null;
        }
        if (
            bitmap.width !== this.layerWidth
            || bitmap.height !== this.layerHeight
        ) {
            return null;
        }
        return bitmap;
    }

    /** 复用一块「已处理」标记（每次填充前清零），避免每点一次都新建 16 MB。 */
    fillMarks(size) {
        if (!this._fillMarks || this._fillMarks.length < size) {
            this._fillMarks = new Uint8Array(size);
        } else {
            this._fillMarks.fill(0, 0, size);
        }
        return this._fillMarks;
    }

    floodFill(sourceX, sourceY) {
        const effectiveTool = this.getEffectiveTool();
        const isErase = effectiveTool === "erase";
        const activeCtx = isErase
            ? this.paintCtx
            : (this.activeLayer === "paint" ? this.paintCtx : this.maskCtx);
        const canvas = activeCtx.canvas;
        const width = canvas.width;
        const height = canvas.height;

        // 传进来的是源图坐标，图层画布可能是缩小存储的
        const sx = Math.round(sourceX * this.layerScale);
        const sy = Math.round(sourceY * this.layerScale);
        if (sx < 0 || sx >= width || sy < 0 || sy >= height) {
            return;
        }

        if (isErase && !this.erasePaintEnabled && !this.eraseMaskEnabled) {
            return;
        }

        // 判断填充色
        let fillR; let fillG; let fillB; let fillA; let fillCss;
        if (isErase) {
            fillR = 0; fillG = 0; fillB = 0; fillA = 0;
        } else if (this.activeLayer === "paint") {
            const rgb = this.hexToRgb(this.paintColor);
            fillR = rgb.r; fillG = rgb.g; fillB = rgb.b; fillA = 255;
            fillCss = this.paintColor;
        } else {
            const val = this.maskBrushColor === "black" ? 0 : 255;
            fillR = val; fillG = val; fillB = val; fillA = 255;
            fillCss = val === 0 ? "#000000" : "#ffffff";
        }

        const threshold = this.threshold;

        // 点到的位置已经填好了就不用干活。只读 1×1 个像素，不整层读。
        const readOne = (ctx) => ctx.getImageData(sx, sy, 1, 1).data;
        if (isErase) {
            const paintDone = !this.erasePaintEnabled
                || readOne(this.paintCtx)[3] === 0;
            const maskDone = !this.eraseMaskEnabled
                || readOne(this.maskCtx)[3] === 0;
            if (paintDone && maskDone) {
                return;
            }
        } else {
            const one = readOne(activeCtx);
            if (
                maxChannelDiff(
                    one[0], one[1], one[2], fillR, fillG, fillB
                ) <= threshold
                && one[3] === fillA
            ) {
                return;
            }
        }

        // 合成图（底图 → 颜色层 → 遮罩层，和屏幕上看到的一致）
        // 颜色匹配就靠它，这是唯一必须整屏读的东西。
        const compCtx = this.newCompositeContext(width, height);
        compCtx.clearRect(0, 0, width, height);
        // 底图预先缩到图层大小，这里只是贴图，不用每次重新缩放
        compCtx.drawImage(
            this.baseScaledSource() || this.baseImage, 0, 0, width, height
        );
        if (this.paintVisible) {
            compCtx.globalAlpha = this.paintOpacity;
            compCtx.drawImage(this.paintCanvas, 0, 0);
            compCtx.globalAlpha = 1;
        }
        if (this.maskVisible) {
            compCtx.globalAlpha = this.maskDisplayOpacity;
            compCtx.drawImage(this.maskCanvas, 0, 0);
            compCtx.globalAlpha = 1;
        }
        const compData = compCtx.getImageData(0, 0, width, height);
        const compPixels = compData.data;

        // 起点颜色（从合成图取）
        const targetIdx = (sy * width + sx) * 4;
        const targetR = compPixels[targetIdx];
        const targetG = compPixels[targetIdx + 1];
        const targetB = compPixels[targetIdx + 2];

        // 扫描线填充：整行整段地找，比一格一格爬快好几倍，
        // 也省掉两份整屏队列（4096² 要 144 MB）。
        // 这里只「找」不「画」——找到的每一段先记下来。
        const marked = this.fillMarks(width * height);
        const neighbours = [-1, 1];
        const spans = [];
        const matches = (index) => {
            if (marked[index]) {
                return false;
            }
            const idx = index * 4;
            return maxChannelDiff(
                compPixels[idx], compPixels[idx + 1], compPixels[idx + 2],
                targetR, targetG, targetB
            ) <= threshold;
        };

        if (!matches(sy * width + sx)) {
            return;
        }

        const stack = [sx, sy];
        while (stack.length) {
            const y = stack.pop();
            const startX = stack.pop();
            if (!matches(y * width + startX)) {
                continue;
            }
            let left = startX;
            while (left > 0 && matches(y * width + left - 1)) {
                left -= 1;
            }
            let right = startX;
            while (right + 1 < width && matches(y * width + right + 1)) {
                right += 1;
            }
            const row = y * width;
            for (let x = left; x <= right; x += 1) {
                marked[row + x] = 1;
            }
            spans.push(y, left, right);
            // 上下两行的相连整段各压一次栈
            for (const step of neighbours) {
                const ny = y + step;
                if (ny < 0 || ny >= height) {
                    continue;
                }
                const nextRow = ny * width;
                let x = left;
                while (x <= right) {
                    if (matches(nextRow + x)) {
                        const runStart = x;
                        while (x <= right && matches(nextRow + x)) {
                            x += 1;
                        }
                        stack.push(runStart, ny);
                    } else {
                        x += 1;
                    }
                }
            }
        }

        if (!spans.length) {
            return;
        }

        let minX = width;
        let minY = height;
        let maxX = -1;
        let maxY = -1;
        for (let i = 0; i < spans.length; i += 3) {
            if (spans[i + 1] < minX) {
                minX = spans[i + 1];
            }
            if (spans[i + 2] > maxX) {
                maxX = spans[i + 2];
            }
            if (spans[i] < minY) {
                minY = spans[i];
            }
            if (spans[i] > maxY) {
                maxY = spans[i];
            }
        }

        const changedRect = maxX >= minX && maxY >= minY
            ? {
                x0: minX,
                y0: minY,
                x1: maxX + 1,
                y1: maxY + 1,
            }
            : null;
        if (!changedRect) {
            return;
        }
        // 写回画布之前，先按改动范围存块（这时画布还是改动前的样子）
        if (isErase) {
            if (this.erasePaintEnabled) {
                this.captureStepTilesBefore("paint", changedRect);
            }
            if (this.eraseMaskEnabled) {
                this.captureStepTilesBefore("mask", changedRect);
            }
        } else {
            this.captureStepTilesBefore(
                this.activeLayer === "paint" ? "paint" : "mask",
                changedRect
            );
        }

        // 按记下的整段直接刷上去：不用把整层读出来再整层写回去
        // （4096² 一次读写约 130 ms，这样几乎不花时间）。
        const targets = isErase
            ? [this.erasePaintEnabled ? this.paintCtx : null,
                this.eraseMaskEnabled ? this.maskCtx : null]
            : [activeCtx];
        const dirty = {
            layerRect: changedRect,
            displayRect: this.layerRectToDisplayRect(changedRect),
        };
        for (const ctx of targets) {
            if (!ctx) {
                continue;
            }
            ctx.save();
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.globalAlpha = 1;
            ctx.globalCompositeOperation = "source-over";
            if (isErase) {
                for (let i = 0; i < spans.length; i += 3) {
                    ctx.clearRect(
                        spans[i + 1], spans[i],
                        spans[i + 2] - spans[i + 1] + 1, 1
                    );
                }
            } else {
                ctx.fillStyle = fillCss;
                for (let i = 0; i < spans.length; i += 3) {
                    ctx.fillRect(
                        spans[i + 1], spans[i],
                        spans[i + 2] - spans[i + 1] + 1, 1
                    );
                }
            }
            ctx.restore();
        }
        if (isErase) {
            if (this.erasePaintEnabled) {
                this.markLayerContent("paint", null, dirty);
            }
            if (this.eraseMaskEnabled) {
                this.markLayerContent("mask", null, dirty);
            }
        } else {
            this.markLayerContent(
                this.activeLayer === "paint" ? "paint" : "mask",
                true,
                dirty
            );
        }
        if (isErase) {
            // 擦除式填充也可能把整层擦空，顺手确认一次
            this.verifyErasedLayers(changedRect);
        }
    }

    togglePaintVisibility() {
        this.paintVisible = !this.paintVisible;
        this.scheduleRender();
        this.emitStateChange();
    }

    toggleMaskVisibility() {
        this.maskVisible = !this.maskVisible;
        this.scheduleRender();
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

    toggleMaskDisplayInvert() {
        this.maskDisplayInverted = !this.maskDisplayInverted;
        this.scheduleRender();
        this.emitStateChange();
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
        this.captureStepFullBefore("paint");
        this._stepCleared.paint = true;
        this.paintCtx.clearRect(
            0,
            0,
            this.paintCanvas.width,
            this.paintCanvas.height
        );
        this.markLayerContent("paint", false);
        this.render();
        if (commitHistory) {
            this.commitHistory();
        }
    }

    clearMaskLayer(commitHistory = true) {
        this.captureStepFullBefore("mask");
        this._stepCleared.mask = true;
        this.maskCtx.clearRect(
            0,
            0,
            this.maskCanvas.width,
            this.maskCanvas.height
        );
        this.markLayerContent("mask", false);
        this.render();
        if (commitHistory) {
            this.commitHistory();
        }
    }

    invertMaskPixels() {
        this.captureStepFullBefore("mask");
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
        // 只换了颜色、透明范围没变，内容状态沿用原来的
        this.markLayerContent("mask", this.maskHasContent);
        this.render();
        this.commitHistory();
        this.emitStateChange();
    }

    /**
     * 区域反转：已画区域与未画区域互换。
     *
     * 用 alpha 取反实现：不透明处变透明，透明处用当前颜色补齐；
     * 柔边像素的 alpha 同样取反，反转后的边缘依旧平滑。
     */
    invertLayerRegion(ctx, canvas, color) {
        const { r, g, b } = this.hexToRgb(color);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const pixels = imageData.data;
        for (let index = 0; index < pixels.length; index += 4) {
            pixels[index] = r;
            pixels[index + 1] = g;
            pixels[index + 2] = b;
            pixels[index + 3] = 255 - pixels[index + 3];
        }
        ctx.putImageData(imageData, 0, 0);
    }

    invertPaintRegion() {
        this.captureStepFullBefore("paint");
        this.invertLayerRegion(
            this.paintCtx,
            this.paintCanvas,
            this.paintColor
        );
        this.invalidateLayerContent("paint");
        this.render();
        this.commitHistory();
        this.emitStateChange();
    }

    invertMaskRegion() {
        this.captureStepFullBefore("mask");
        this.invertLayerRegion(
            this.maskCtx,
            this.maskCanvas,
            this.maskBrushColor === "black" ? "#000000" : "#ffffff"
        );
        this.invalidateLayerContent("mask");
        this.render();
        this.commitHistory();
        this.emitStateChange();
    }

    /** 图层对应的 2D 上下文。 */
    layerContext(layer) {
        return layer === "mask" ? this.maskCtx : this.paintCtx;
    }

    /** 历史块在图层里的位置和大小（最后一行/列可能不满）。 */
    tileOrigin(index) {
        const columns = Math.max(1, Math.ceil(this.layerWidth / HISTORY_TILE));
        const rows = Math.max(1, Math.ceil(this.layerHeight / HISTORY_TILE));
        const safeIndex = clamp(index, 0, (columns * rows) - 1);
        const column = safeIndex % columns;
        const row = Math.floor(safeIndex / columns);
        const x = column * HISTORY_TILE;
        const y = row * HISTORY_TILE;
        return {
            x,
            y,
            width: Math.min(HISTORY_TILE, this.layerWidth - x),
            height: Math.min(HISTORY_TILE, this.layerHeight - y),
        };
    }

    /** 一块区域盖住了哪几个块（块编号）。 */
    tileIndicesForRect(rect) {
        if (!rect) {
            return [];
        }
        const columns = Math.max(1, Math.ceil(this.layerWidth / HISTORY_TILE));
        const rows = Math.max(1, Math.ceil(this.layerHeight / HISTORY_TILE));
        const x0 = clamp(Math.floor(Math.min(rect.x0, rect.x1)), 0, this.layerWidth - 1);
        const y0 = clamp(Math.floor(Math.min(rect.y0, rect.y1)), 0, this.layerHeight - 1);
        const x1 = clamp(Math.ceil(Math.max(rect.x0, rect.x1)), 1, this.layerWidth);
        const y1 = clamp(Math.ceil(Math.max(rect.y0, rect.y1)), 1, this.layerHeight);
        const firstColumn = Math.floor(x0 / HISTORY_TILE);
        const lastColumn = Math.floor((x1 - 1) / HISTORY_TILE);
        const firstRow = Math.floor(y0 / HISTORY_TILE);
        const lastRow = Math.floor((y1 - 1) / HISTORY_TILE);
        const indices = [];
        for (let row = firstRow; row <= lastRow && row < rows; row += 1) {
            for (let column = firstColumn; column <= lastColumn && column < columns; column += 1) {
                indices.push((row * columns) + column);
            }
        }
        return indices;
    }

    /**
     * 落笔之前，先把这一笔会碰到的块「原来的样子」存下来。
     *
     * 必须在真正画之前调用，否则拍下来的就是画完的样子了。
     * 同一笔里重复碰到的块只存一次。
     */
    captureStepTilesBefore(layer, layerRect) {
        if (!layerRect) {
            return;
        }
        const stepTiles = this._stepTiles[layer];
        if (!stepTiles) {
            return;
        }
        this.recordStepContent(layer);
        const context = this.layerContext(layer);
        for (const index of this.tileIndicesForRect(layerRect)) {
            if (stepTiles.has(index)) {
                continue;
            }
            const origin = this.tileOrigin(index);
            stepTiles.set(
                index,
                context.getImageData(
                    origin.x,
                    origin.y,
                    origin.width,
                    origin.height
                )
            );
        }
    }

    /** 整层改动（清空、反相、填充）之前，先存下整层原样。 */
    captureStepFullBefore(layer) {
        if (this._stepFull[layer]) {
            return;
        }
        this.recordStepContent(layer);
        const context = this.layerContext(layer);
        this._stepFull[layer] = context.getImageData(
            0,
            0,
            this.layerWidth,
            this.layerHeight
        );
        // 整层都算改过，块记录没意义了
        this._stepTiles[layer].clear();
    }

    /** 这一步「之前 / 之后」的内容状态。 */
    stepContent(layer) {
        const before = this._stepContent[layer];
        const after = layer === "mask"
            ? this.maskHasContent
            : this.paintHasContent;
        return {
            before: typeof before === "boolean" ? before : null,
            after: typeof after === "boolean" ? after : null,
        };
    }

    /** 记下这一步开始前，图层「有没有内容」。撤销时直接用它，不用再扫像素。 */
    recordStepContent(layer) {
        if (this._stepContent[layer] !== undefined) {
            return;
        }
        this._stepContent[layer] = layer === "mask"
            ? this.maskHasContent
            : this.paintHasContent;
    }

    /** 每一步历史现在占多少内存。 */
    historyBytes(entry) {
        let bytes = entry?.bytes || 0;
        return bytes;
    }

    /** 历史状态的总内存。 */
    totalHistoryBytes() {
        let total = 0;
        for (const entry of this.history) {
            total += entry.bytes || 0;
        }
        return total;
    }

    /**
     * 历史最多存几步（按内存预算估的，供界面和调试参考）。
     *
     * 实际裁剪在 commitHistory 里按真实占用算：撤销按块存之后，
     * 一步通常只有几 MB，所以基本都能存到 HISTORY_MAX_DEPTH 步。
     */
    historyDepthLimit() {
        const bytesPerStep = Math.max(
            HISTORY_TILE * HISTORY_TILE * 4 * 2,
            1
        );
        const steps = Math.floor(HISTORY_BUDGET_BYTES / bytesPerStep);
        return clamp(steps, HISTORY_MIN_DEPTH, HISTORY_MAX_DEPTH);
    }

    /** 回到某一步的状态：把这一笔改过的块贴回来（或贴回改后的样子）。 */
    /** 图层坐标的一块区域 → 屏幕上的方块（不含画笔余量）。 */
    layerRectToDisplayRect(rect) {
        const corners = [
            this.layerToDisplay(rect.x0, rect.y0),
            this.layerToDisplay(rect.x1, rect.y1),
        ];
        const xs = corners.map((point) => point.x);
        const ys = corners.map((point) => point.y);
        return {
            x0: Math.min(...xs),
            y0: Math.min(...ys),
            x1: Math.max(...xs),
            y1: Math.max(...ys),
        };
    }

    /**
     * 回到某一步的状态。
     *
     * 只把这一步改过的块贴回去，屏幕上也只重画这些块的位置 ——
     * 撤销不用整屏重建，几万像素的图也不会卡一下。
     */
    applyHistoryEntry(entry, side) {
        if (!entry?.parts) {
            return;
        }
        const displayRects = [];
        let fullRepaint = false;
        for (const layer of ["mask", "paint"]) {
            const part = entry.parts[layer];
            if (!part) {
                continue;
            }
            const context = this.layerContext(layer);
            if (part.full) {
                fullRepaint = true;
                const data = side === "before"
                    ? part.full.before
                    : part.full.after;
                if (data) {
                    context.putImageData(data, 0, 0);
                }
                else {
                    context.clearRect(0, 0, this.layerWidth, this.layerHeight);
                }
                this._contentBounds[layer] = {
                    x0: 0,
                    y0: 0,
                    x1: this.layerWidth,
                    y1: this.layerHeight,
                };
            }
            else if (part.tiles) {
                for (const [index, tile] of part.tiles) {
                    const origin = this.tileOrigin(index);
                    const data = side === "before" ? tile.before : tile.after;
                    if (data) {
                        context.putImageData(data, origin.x, origin.y);
                    }
                    else {
                        context.clearRect(
                            origin.x,
                            origin.y,
                            origin.width,
                            origin.height
                        );
                    }
                    const layerRect = {
                        x0: origin.x,
                        y0: origin.y,
                        x1: origin.x + origin.width,
                        y1: origin.y + origin.height,
                    };
                    this.addContentBounds(layer, layerRect);
                    displayRects.push(this.layerRectToDisplayRect(layerRect));
                }
                // 贴回去的块里可能全是透明的 -> 内容状态未知，按记录的值恢复，
                // 记录里也没有（null）时下次渲染再看那块区域。
                const area = displayRects.reduce(
                    (total, rect) => total
                        + Math.max(0, rect.x1 - rect.x0)
                        * Math.max(0, rect.y1 - rect.y0),
                    0
                );
                if (area > this.canvas.width * this.canvas.height * 0.4) {
                    fullRepaint = true;
                }
            }
            const content = side === "before"
                ? part.content?.before
                : part.content?.after;
            this.setLayerContentFlag(layer, content ?? null);
            this.invalidatePyramid(layer);
            if (layer === "mask") {
                this._whiteMaskDirty = true;
                this.invalidatePyramid("white");
            }
        }
        if (fullRepaint) {
            this.markSceneDirty();
        }
        else {
            for (const rect of displayRects) {
                this.addDirtyRect(rect);
            }
        }
        this.render();
        this.emitStateChange();
    }

    /**
     * 擦除抬笔后确认图层里还有没有内容。
     *
     * 只有当这一笔把「画过的范围」整块盖住时，才需要真的去看像素 ——
     * 别的情况一眼就知道还有内容，一次扫描都不用。
     */
    verifyErasedLayers(strokeRect) {
        let emptied = false;
        for (const layer of ["mask", "paint"]) {
            const enabled = layer === "mask"
                ? this.eraseMaskEnabled
                : this.erasePaintEnabled;
            if (!enabled) {
                continue;
            }
            const flag = layer === "mask"
                ? this.maskHasContent
                : this.paintHasContent;
            if (flag === false) {
                continue;
            }
            const bounds = this._contentBounds[layer];
            if (bounds && strokeRect && !rectContains(strokeRect, bounds)) {
                // 没盖满 → 没擦到的地方还有内容
                this.setLayerContentFlag(layer, true);
                continue;
            }
            if (!this.verifyLayerContent(layer)) {
                emptied = true;
            }
        }
        if (emptied) {
            // 图层空了，整屏要重画（那一层要整个消失）
            this.markSceneDirty();
        }
    }

    /** 强制重新检查一层有没有内容（只扫「画过的范围」）。 */
    verifyLayerContent(layer) {
        this.setLayerContentFlag(layer, null);
        if (layer === "mask") {
            this._whiteMaskDirty = true;
            this.invalidatePyramid("white");
        }
        return this.layerHasContent(layer);
    }

    /** 直接写图层「有没有内容」的标记（历史记录里存的值）。 */
    setLayerContentFlag(layer, value) {
        const flag = typeof value === "boolean" ? value : null;
        if (layer === "mask") {
            this.maskHasContent = flag;
        }
        else {
            this.paintHasContent = flag;
        }
        if (flag === false) {
            this._contentBounds[layer] = null;
        }
    }

    /** 第一步：整层的初始状态（撤销退到底时用）。 */
    resetHistory() {
        this._stepTiles = { mask: new Map(), paint: new Map() };
        this._stepFull = { mask: null, paint: null };
        this._stepContent = { mask: undefined, paint: undefined };
        this._stepCleared = { mask: false, paint: false };
        // 空图层就别存整层快照了（4096×4096 一张 67 MB）
        const mask = this.maskHasContent
            ? this.maskCtx.getImageData(0, 0, this.layerWidth, this.layerHeight)
            : null;
        const paint = this.paintHasContent
            ? this.paintCtx.getImageData(0, 0, this.layerWidth, this.layerHeight)
            : null;
        this.history = [{
            parts: {
                mask: {
                    tiles: null,
                    full: { before: null, after: mask },
                    content: { before: null, after: this.maskHasContent },
                },
                paint: {
                    tiles: null,
                    full: { before: null, after: paint },
                    content: { before: null, after: this.paintHasContent },
                },
            },
            bytes: (mask ? mask.data.byteLength : 0)
                + (paint ? paint.data.byteLength : 0),
            base: true,
        }];
        this.historyIndex = 0;
    }

    /**
     * 把这一笔/这一次操作记进历史：只存真正改到的块。
     *
     * 一步存两份：改之前、改之后 —— 撤销贴前者，重做贴后者。
     */
    commitHistory() {
        const parts = {};
        let bytes = 0;
        for (const layer of ["mask", "paint"]) {
            const stepTiles = this._stepTiles[layer];
            const fullBefore = this._stepFull[layer];
            if (!fullBefore && !stepTiles.size) {
                continue;
            }
            const context = this.layerContext(layer);
            if (fullBefore) {
                // 清空之后整层都是透明的，「改后」记成空就行，别占内存
                const after = this._stepCleared[layer]
                    ? null
                    : context.getImageData(
                        0,
                        0,
                        this.layerWidth,
                        this.layerHeight
                    );
                parts[layer] = {
                    tiles: null,
                    full: { before: fullBefore, after },
                    content: this.stepContent(layer),
                };
                bytes += fullBefore.data.byteLength
                    + (after ? after.data.byteLength : 0);
                continue;
            }
            const tiles = new Map();
            for (const [index, before] of stepTiles) {
                const origin = this.tileOrigin(index);
                const after = context.getImageData(
                    origin.x,
                    origin.y,
                    origin.width,
                    origin.height
                );
                tiles.set(index, { before, after });
                bytes += before.data.byteLength + after.data.byteLength;
            }
            parts[layer] = {
                tiles,
                full: null,
                content: this.stepContent(layer),
            };
        }
        this._stepTiles = { mask: new Map(), paint: new Map() };
        this._stepFull = { mask: null, paint: null };
        this._stepContent = { mask: undefined, paint: undefined };
        this._stepCleared = { mask: false, paint: false };
        if (!Object.keys(parts).length) {
            return;
        }
        if (this.historyIndex < (this.history.length - 1)) {
            this.history = this.history.slice(0, this.historyIndex + 1);
        }
        this.history.push({ parts, bytes });
        while (this.history.length > HISTORY_MAX_DEPTH) {
            this.history.shift();
        }
        while (
            this.history.length > 1
            && this.totalHistoryBytes() > HISTORY_BUDGET_BYTES
        ) {
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
        const entry = this.history[this.historyIndex];
        this.historyIndex -= 1;
        this.applyHistoryEntry(entry, "before");
    }

    redo() {
        if (!this.canRedo()) {
            return;
        }
        this.historyIndex += 1;
        this.applyHistoryEntry(this.history[this.historyIndex], "after");
    }

    async exportArtifacts() {
        // 「有没有内容」直接问图层：画过东西但透明度拉到 0 时，
        // 导出的图其实什么也看不见，也就不该留文件。
        // （不去扫导出的大画布，几万像素的图扫一次要吃几百 MB。）
        const hasMask = this.maskOpacity > 0 && this.layerHasContent("mask");
        let maskBlob = null;
        if (hasMask) {
            maskBlob = await canvasToBlob(
                this.buildExportCanvas(this.maskCanvas, this.maskOpacity)
            );
        }
        const hasPaint = this.paintOpacity > 0
            && this.layerHasContent("paint");
        let paintBlob = null;
        if (hasPaint) {
            paintBlob = await canvasToBlob(
                this.buildExportCanvas(this.paintCanvas, this.paintOpacity)
            );
        }
        return {
            maskBlob,
            hasMask,
            paintBlob,
            hasPaint,
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
        const sameSize = sourceCanvas.width === this.imageWidth
            && sourceCanvas.height === this.imageHeight;
        if (alpha >= 0.999 && sameSize) {
            return sourceCanvas;
        }
        const exportCanvas = document.createElement("canvas");
        // 超大图的图层是缩小存储的，导出时放大回原分辨率，
        // 下游按原图尺寸使用，位置才对得齐。
        exportCanvas.width = this.imageWidth;
        exportCanvas.height = this.imageHeight;
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
        if (this.tool === "fill") {
            this.canvas.style.cursor = "crosshair";
            return;
        }
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
        if (
            this.sceneCanvas.width !== this.canvas.width
            || this.sceneCanvas.height !== this.canvas.height
        ) {
            this.sceneCanvas.width = this.canvas.width;
            this.sceneCanvas.height = this.canvas.height;
            this._sceneDirty = true;
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

    /**
     * 图层是不是「有东西」。
     *
     * 空图层（还没画过遮罩 / 颜色）每帧也去缩放一遍整张图太浪费，
     * 所以缓存结果：true/false 直接用，null 才去看像素 —— 而且只看
     * 「画过的范围」里，几万像素的图也不用每次扫一整张。
     */
    layerHasContent(layer) {
        const isMask = layer === "mask";
        const cached = isMask ? this.maskHasContent : this.paintHasContent;
        if (typeof cached === "boolean") {
            return cached;
        }
        const canvas = isMask ? this.maskCanvas : this.paintCanvas;
        const bounds = this._contentBounds[layer];
        const value = bounds ? this.regionHasAlpha(canvas, bounds) : null;
        const found = value === null ? this.hasCanvasAlpha(canvas) : value;
        if (isMask) {
            this.maskHasContent = found;
        } else {
            this.paintHasContent = found;
        }
        if (!found) {
            this._contentBounds[layer] = null;
        }
        return found;
    }

    /**
     * 把一块区域记进「画过的范围」（图层像素坐标）。
     * 区域可以是负的或超出画布，这里会裁掉。
     */
    addContentBounds(layer, rect) {
        if (!rect) {
            return;
        }
        const canvas = layer === "mask" ? this.maskCanvas : this.paintCanvas;
        const x0 = clamp(Math.floor(Math.min(rect.x0, rect.x1)), 0, canvas.width);
        const y0 = clamp(Math.floor(Math.min(rect.y0, rect.y1)), 0, canvas.height);
        const x1 = clamp(Math.ceil(Math.max(rect.x0, rect.x1)), 0, canvas.width);
        const y1 = clamp(Math.ceil(Math.max(rect.y0, rect.y1)), 0, canvas.height);
        if (x1 <= x0 || y1 <= y0) {
            return;
        }
        const previous = this._contentBounds[layer];
        this._contentBounds[layer] = previous
            ? {
                x0: Math.min(previous.x0, x0),
                y0: Math.min(previous.y0, y0),
                x1: Math.max(previous.x1, x1),
                y1: Math.max(previous.y1, y1),
            }
            : { x0, y0, x1, y1 };
    }

    /** 一块区域里有没有不透明的像素。 */
    regionHasAlpha(canvas, rect) {
        const context = canvas.getContext("2d", {
            alpha: true,
            willReadFrequently: true,
        });
        if (!context) {
            return false;
        }
        const x = clamp(Math.floor(rect.x0), 0, Math.max(canvas.width - 1, 0));
        const y = clamp(Math.floor(rect.y0), 0, Math.max(canvas.height - 1, 0));
        const width = clamp(
            Math.ceil(rect.x1) - x,
            1,
            Math.max(canvas.width - x, 1)
        );
        const height = clamp(
            Math.ceil(rect.y1) - y,
            1,
            Math.max(canvas.height - y, 1)
        );
        const pixels = context.getImageData(x, y, width, height).data;
        for (let index = 3; index < pixels.length; index += 4) {
            if (pixels[index] > 0) {
                return true;
            }
        }
        return false;
    }

    /**
     * 标记图层内容状态；传 null 表示下次渲染时重新检查。
     *
     * rects 是这一笔碰到的范围（图层坐标 + 屏幕坐标）。给了它，场景缓存
     * 就只重画那一小块；没给（清空、撤销、填充之类）就整屏重画。
     */
    markLayerContent(layer, value, rects = null) {
        const isMask = layer === "mask";
        if (isMask) {
            this.maskHasContent = value;
        } else {
            this.paintHasContent = value;
        }
        if (value === false) {
            this._contentBounds[layer] = null;
        } else if (value === true && rects?.layerRect) {
            this.addContentBounds(layer, rects.layerRect);
        }
        if (isMask) {
            this._whiteMaskDirty = true;
            this.invalidatePyramid("white");
        }
        this.invalidatePyramid(isMask ? "mask" : "paint");
        if (rects?.displayRect) {
            this.addDirtyRect(rects.displayRect);
        } else {
            this._sceneDirty = true;
        }
    }

    /**
     * 整层内容无法预测（反相、撤销、填充整片）时用：标记成未知、
     * 把「画过的范围」放大到整张画布，下次检查一定看得全。
     */
    invalidateLayerContent(layer) {
        this._contentBounds[layer] = {
            x0: 0,
            y0: 0,
            x1: this.layerWidth,
            y1: this.layerHeight,
        };
        this.markLayerContent(layer, null);
    }

    /** 把一块屏幕区域并入「这一帧要重画的范围」。 */
    addDirtyRect(rect) {
        if (!rect) {
            return;
        }
        const width = this.canvas.width;
        const height = this.canvas.height;
        const x0 = clamp(Math.min(rect.x0, rect.x1), 0, width);
        const y0 = clamp(Math.min(rect.y0, rect.y1), 0, height);
        const x1 = clamp(Math.max(rect.x0, rect.x1), 0, width);
        const y1 = clamp(Math.max(rect.y0, rect.y1), 0, height);
        if (x1 <= x0 || y1 <= y0) {
            return;
        }
        const previous = this._dirtyRect;
        this._dirtyRect = previous
            ? {
                x0: Math.min(previous.x0, x0),
                y0: Math.min(previous.y0, y0),
                x1: Math.max(previous.x1, x1),
                y1: Math.max(previous.y1, y1),
            }
            : { x0, y0, x1, y1 };
    }

    /**
     * 一笔笔刷在屏幕上大概占多大一块（含画笔圆环的余量）。
     * 用屏幕坐标是因为重画的是显示画布。
     */
    strokeDisplayRect(layerRect) {
        if (!layerRect) {
            return null;
        }
        const imageRect = this.getImageDisplayRect();
        // 屏幕上笔刷的半径（圆环宽度 + 边缘抗锯齿再留几像素余量）
        const pad = ((this.brushSize * imageRect.scale) / 2) + 4;
        const points = [
            { x: layerRect.x0, y: layerRect.y0 },
            { x: layerRect.x1, y: layerRect.y1 },
        ].map((point) => this.layerToDisplay(point.x, point.y));
        const xs = points.map((point) => point.x);
        const ys = points.map((point) => point.y);
        return {
            x0: Math.min(...xs) - pad,
            y0: Math.min(...ys) - pad,
            x1: Math.max(...xs) + pad,
            y1: Math.max(...ys) + pad,
        };
    }

    /** 图层像素坐标 → 屏幕坐标。 */
    layerToDisplay(x, y) {
        const imageRect = this.getImageDisplayRect();
        const local = this.sourceToLocal({
            x: x / this.layerScale,
            y: y / this.layerScale,
        });
        return {
            x: imageRect.centerX + (local.x * imageRect.scale),
            y: imageRect.centerY + (local.y * imageRect.scale),
        };
    }

    /** 一笔的笔刷范围；sourceRect 用源图坐标。 */
    strokeRects(fromPoint, toPoint, radiusSource) {
        const minX = Math.min(fromPoint.x, toPoint.x) - radiusSource;
        const maxX = Math.max(fromPoint.x, toPoint.x) + radiusSource;
        const minY = Math.min(fromPoint.y, toPoint.y) - radiusSource;
        const maxY = Math.max(fromPoint.y, toPoint.y) + radiusSource;
        const layerRect = {
            x0: minX * this.layerScale,
            y0: minY * this.layerScale,
            x1: maxX * this.layerScale,
            y1: maxY * this.layerScale,
        };
        return {
            layerRect,
            displayRect: this.strokeDisplayRect(layerRect),
        };
    }

    /**
     * 方格「透明底」的两种颜色。
     *
     * 直接读画布上算出来的 CSS 变量值 —— 那里已经做过 var() 替换，
     * 拿到的就是实际颜色，画进画布后和界面主题一致。
     */
    resolveCheckerColors() {
        let styles = null;
        try {
            styles = getComputedStyle(this.canvas);
        } catch (error) {
            styles = null;
        }
        const read = (name) => {
            const value = styles
                ? String(styles.getPropertyValue(name) || "").trim()
                : "";
            return value;
        };
        // 变量有可能没被替换（返回 var(...) 原文），拿它当颜色会失败，
        // 用一个探针颜色试一下，认不出来就退回默认色。
        const normalize = (value, fallback) => {
            if (!value) {
                return fallback;
            }
            if (!this._colorProbeCtx) {
                this._colorProbeCtx = document.createElement("canvas")
                    .getContext("2d");
            }
            if (!this._colorProbeCtx) {
                return fallback;
            }
            this._colorProbeCtx.fillStyle = "#010203";
            this._colorProbeCtx.fillStyle = value;
            return this._colorProbeCtx.fillStyle === "#010203"
                ? fallback
                : value;
        };
        return {
            square: normalize(
                read("--ximageget-mask-editor-surface"),
                "#202020"
            ),
            gap: normalize(read("--ximageget-mask-editor-bg"), "#1a1a1a"),
        };
    }

    /**
     * 把「方格透明底」做成可平铺的图案。
     *
     * 原来这层是 CSS 画在画布下面的，画笔圆环的「反相」碰不到它，
     * 所以圆环压在方格上时不会变色。画进画布后，圆环在方格上也能反相。
     */
    buildCheckerboardPattern() {
        const colors = this.resolveCheckerColors();
        const key = `${colors.square}|${colors.gap}`;
        if (this._checkerPattern && this._checkerKey === key) {
            return this._checkerPattern;
        }
        const size = CHECKER_TILE_SIZE;
        const half = size / 2;
        const tile = document.createElement("canvas");
        tile.width = size;
        tile.height = size;
        const tileCtx = tile.getContext("2d");
        if (!tileCtx) {
            return null;
        }
        tileCtx.fillStyle = colors.gap;
        tileCtx.fillRect(0, 0, size, size);
        // 和原来的 CSS 一样：45° 渐变里取两段斜条，两层错开半个格子。
        const paintCheckerLayer = (offsetX, offsetY) => {
            const gradient = tileCtx.createLinearGradient(
                offsetX,
                offsetY + size,
                offsetX + size,
                offsetY
            );
            gradient.addColorStop(0, colors.square);
            gradient.addColorStop(0.25, colors.square);
            gradient.addColorStop(0.25, "rgba(0, 0, 0, 0)");
            gradient.addColorStop(0.75, "rgba(0, 0, 0, 0)");
            gradient.addColorStop(0.75, colors.square);
            gradient.addColorStop(1, colors.square);
            tileCtx.fillStyle = gradient;
            tileCtx.fillRect(offsetX, offsetY, size, size);
        };
        // 平铺时四周也要补画一圈，否则格子边界会断。
        for (const dx of [-size, 0, size]) {
            for (const dy of [-size, 0, size]) {
                paintCheckerLayer(dx, dy);
            }
        }
        for (const dx of [-size + half, half, size + half]) {
            for (const dy of [-size + half, half, size + half]) {
                paintCheckerLayer(dx, dy);
            }
        }
        this._checkerKey = key;
        this._checkerPattern = this.ctx.createPattern(tile, "repeat");
        return this._checkerPattern;
    }

    /** 主题变了颜色就变了，丢掉旧图案重新生成。 */
    /**
     * 现成的「方格底」图片（按显示尺寸做一张，之后直接贴）。
     *
     * 每帧用图案填充整屏在软件渲染下很贵，贴一张现成的图便宜得多。
     */
    checkerBackground(width, height) {
        const pattern = this.buildCheckerboardPattern();
        if (!pattern) {
            return null;
        }
        const cache = this._checkerCanvas;
        if (
            cache
            && cache.width === width
            && cache.height === height
            && this._checkerCanvasKey === this._checkerKey
        ) {
            return cache;
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d", { alpha: true });
        if (!ctx) {
            return null;
        }
        ctx.fillStyle = pattern;
        ctx.fillRect(0, 0, width, height);
        this._checkerCanvas = canvas;
        this._checkerCanvasKey = this._checkerKey;
        return canvas;
    }

    refreshCheckerboard() {
        this._checkerPattern = null;
        this._checkerCanvas = null;
        this.markSceneDirty();
        this._checkerKey = "";
        this.render();
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
            this.scheduleRender();
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
            brushSizeMax: this.getMaxBrushSize(),
            brushSizeMin: BRUSH_MIN,
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
            threshold: this.threshold,
            erasePaintEnabled: this.erasePaintEnabled,
            eraseMaskEnabled: this.eraseMaskEnabled,
            maskDisplayInverted: this.maskDisplayInverted,
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
        this.scheduleRender();
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
        if (this.tool === "fill") {
            const canvasPoint = this.getCanvasPoint(event);
            this.floodFill(canvasPoint.x, canvasPoint.y);
            this.scheduleRender();
            this.commitHistory();
            return;
        }
        this.isDrawing = true;
        this.pointerId = event.pointerId;
        this.lastPoint = this.getCanvasPoint(event);
        this.canvas.setPointerCapture?.(event.pointerId);
        this.drawLine(this.lastPoint, this.lastPoint);
        this.scheduleRender();
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
            this.scheduleRender();
            return;
        }
        this.cursorPoint = this.getDisplayPoint(event);
        if (!this.isDrawing) {
            this.scheduleRender();
            return;
        }
        const nextPoint = this.getCanvasPoint(event);
        this.drawLine(this.lastPoint, nextPoint);
        this.lastPoint = nextPoint;
        this.scheduleRender();
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
        // 橡皮擦抬笔（或任何一笔结束时）确认一次图层是不是被擦空了。
        // 只在「有擦除动作」时做，画笔不用。
        if (this.getEffectiveTool() === "erase" && this._eraseStrokeRect) {
            this.verifyErasedLayers(this._eraseStrokeRect);
        }
        if (hadDrawing) {
            this.commitHistory();
        }
        this._eraseStrokeRect = null;
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
        const rects = this.strokeRects(fromPoint, toPoint, this.brushSize / 2);
        if (effectiveTool === "erase") {
            this._eraseStrokeRect = unionRects([
                this._eraseStrokeRect,
                rects.layerRect,
            ]);
        }
        if (effectiveTool === "paint") {
            this.drawPaintLine(fromPoint, toPoint, rects);
            return;
        }
        if (effectiveTool === "mask") {
            this.drawMaskLine(fromPoint, toPoint, false, rects);
            return;
        }
        if (effectiveTool === "erase") {
            if (this.erasePaintEnabled) {
                this.erasePaintLine(fromPoint, toPoint, rects);
            }
            if (this.eraseMaskEnabled) {
                this.drawMaskLine(fromPoint, toPoint, true, rects);
            }
        }
    }

    drawPaintLine(fromPoint, toPoint, rects = null) {
        this.captureStepTilesBefore("paint", rects?.layerRect);
        this.drawSoftStroke(this.paintCtx, fromPoint, toPoint, {
            color: this.paintColor,
            opacity: 1,
            erase: false,
        });
        this.markLayerContent("paint", true, rects);
    }

    erasePaintLine(fromPoint, toPoint, rects = null) {
        this.captureStepTilesBefore("paint", rects?.layerRect);
        this.drawSoftStroke(this.paintCtx, fromPoint, toPoint, {
            color: "#000000",
            opacity: 1,
            erase: true,
        });
        // 擦除过程中每帧去扫像素太贵（几千万像素扫一次几十毫秒），
        // 先当作「还有内容」，抬笔时再统一确认一次。
        this.markLayerContent("paint", true, rects);
    }

    drawMaskLine(fromPoint, toPoint, erase = false, rects = null) {
        this.captureStepTilesBefore("mask", rects?.layerRect);
        const drawColor = this.maskBrushColor === "black"
            ? "#000000"
            : "#ffffff";
        this.drawSoftStroke(this.maskCtx, fromPoint, toPoint, {
            color: drawColor,
            opacity: 1,
            erase,
        });
        // 擦除过程中每帧去扫像素太贵，先当作「还有内容」，抬笔时确认
        this.markLayerContent("mask", true, rects);
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
        // 超大图的图层是缩小存储的，落笔坐标要跟着缩
        ctx.setTransform(
            this.layerScale,
            0,
            0,
            this.layerScale,
            0,
            0
        );
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

    _loadSessionSettings() {
        try {
            var raw = sessionStorage.getItem(SESSION_KEY);
            if (!raw) return;
            var saved = JSON.parse(raw);
            if (saved.paintColor) this.paintColor = saved.paintColor;
            if (saved.maskBrushColor) this.maskBrushColor = saved.maskBrushColor;
            if (typeof saved.hardness === "number") this.hardness = saved.hardness;
            if (typeof saved.paintOpacity === "number") this.paintOpacity = saved.paintOpacity;
            if (typeof saved.maskOpacity === "number") this.maskOpacity = saved.maskOpacity;
            if (typeof saved.threshold === "number") this.threshold = saved.threshold;
            if (typeof saved.erasePaintEnabled === "boolean") this.erasePaintEnabled = saved.erasePaintEnabled;
            if (typeof saved.eraseMaskEnabled === "boolean") this.eraseMaskEnabled = saved.eraseMaskEnabled;
        } catch (e) { /* ignore */ }
    }

    _saveSessionSettings() {
        try {
            sessionStorage.setItem(SESSION_KEY, JSON.stringify({
                paintColor: this.paintColor,
                maskBrushColor: this.maskBrushColor,
                hardness: this.hardness,
                paintOpacity: this.paintOpacity,
                maskOpacity: this.maskOpacity,
                threshold: this.threshold,
                erasePaintEnabled: this.erasePaintEnabled,
                eraseMaskEnabled: this.eraseMaskEnabled,
            }));
        } catch (e) { /* ignore */ }
    }

    /**
     * 画布上是否有可见像素（全透明 = 这一层是空的）。
     * 遮罩层和颜色层都用它判断，清空后就不会再导出空文件。
     */
    hasCanvasAlpha(canvas) {
        if (!canvas) {
            return false;
        }
        const width = Number(canvas.width) || 0;
        const height = Number(canvas.height) || 0;
        if (width <= 0 || height <= 0) {
            return false;
        }
        const context = canvas.getContext("2d", {
            alpha: true,
            willReadFrequently: true,
        });
        if (!context) {
            return false;
        }
        const pixels = context.getImageData(0, 0, width, height).data;
        for (let index = 3; index < pixels.length; index += 4) {
            if (pixels[index] > 0) {
                return true;
            }
        }
        return false;
    }

    /**
     * 把「下一帧再画」挂到屏幕刷新上。
     *
     * 鼠标一秒能来 100+ 次事件，如果每次都同步画一遍，就是白白重复算。
     * 这里合并成「一帧画一次」。
     */
    scheduleRender() {
        if (typeof requestAnimationFrame !== "function") {
            this.render();
            return;
        }
        if (this._rafId !== null) {
            return;
        }
        this._rafId = requestAnimationFrame(() => {
            this._rafId = null;
            this.render();
        });
    }

    cancelScheduledRender() {
        if (this._rafId !== null && typeof cancelAnimationFrame === "function") {
            cancelAnimationFrame(this._rafId);
        }
        this._rafId = null;
    }

    /**
     * 场景缓存失效：下次渲染整屏重画。
     * 缩放、平移、图层显隐、透明度这些变了一个就得重来。
     */
    markSceneDirty() {
        this._sceneDirty = true;
    }

    sceneCacheKey() {
        return [
            this.canvas.width,
            this.canvas.height,
            this.zoom,
            this.panX,
            this.panY,
            this.flipX ? 1 : 0,
            this.flipY ? 1 : 0,
            this.rotationQuarterTurns,
            this.paintVisible ? 1 : 0,
            this.maskVisible ? 1 : 0,
            this.paintOpacity,
            this.maskDisplayOpacity,
            this.maskDisplayInverted ? 1 : 0,
        ].join("|");
    }

    /** 取某一层金字塔的状态（第一次用时才建）。 */
    pyramidState(kind) {
        if (!this._pyramids[kind]) {
            this._pyramids[kind] = {
                levels: [],
                width: 0,
                height: 0,
                dirty: true,
            };
        }
        return this._pyramids[kind];
    }

    /** 图层内容变了：金字塔作废，下次要用时重建。 */
    invalidatePyramid(kind) {
        const state = this._pyramids[kind];
        if (state) {
            state.dirty = true;
        }
    }

    /**
     * 从第几级开始建缩略图。
     *
     * 直接建「一半大小」的那级最省事，但超大图那一级本身就几百 MB。
     * 所以先往下跳几级，直到尺寸能装进预算的一半为止。
     */
    pyramidStartLevel(width, height) {
        const budget = PYRAMID_MAX_BYTES / 2;
        for (let level = 1; level < 12; level += 1) {
            const levelWidth = Math.max(
                1,
                Math.ceil(width / (2 ** level))
            );
            const levelHeight = Math.max(
                1,
                Math.ceil(height / (2 ** level))
            );
            if (Math.max(levelWidth, levelHeight) < PYRAMID_MIN_EDGE) {
                return level;
            }
            if (levelWidth * levelHeight * 4 <= budget) {
                return level;
            }
        }
        return 12;
    }

    /** 按需把缩略图建到第 wanted 级（第 1 级 = 一半大小）。 */
    buildPyramidLevels(state, source, width, height, wanted) {
        if (state.width !== width || state.height !== height) {
            state.levels = [];
            state.width = width;
            state.height = height;
            state.dirty = true;
        }
        if (state.dirty) {
            state.levels = [];
            state.dirty = false;
            state.startLevel = this.pyramidStartLevel(width, height);
        }
        const startLevel = state.startLevel;
        const wantedOffset = Math.max(0, wanted - startLevel);
        let budget = PYRAMID_MAX_BYTES;
        while (
            state.levels.length <= wantedOffset
            && state.levels.length < 12
        ) {
            const level = startLevel + state.levels.length;
            const levelWidth = Math.max(1, Math.ceil(width / (2 ** level)));
            const levelHeight = Math.max(
                1,
                Math.ceil(height / (2 ** level))
            );
            if (Math.max(levelWidth, levelHeight) < PYRAMID_MIN_EDGE) {
                break;
            }
            const bytes = levelWidth * levelHeight * 4;
            if (bytes > budget) {
                break;
            }
            budget -= bytes;
            const previous = state.levels.length
                ? state.levels[state.levels.length - 1]
                : source;
            const canvas = document.createElement("canvas");
            canvas.width = levelWidth;
            canvas.height = levelHeight;
            const ctx = canvas.getContext("2d", { alpha: true });
            if (!ctx) {
                break;
            }
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = "high";
            ctx.drawImage(
                previous,
                0,
                0,
                previous.width,
                previous.height,
                0,
                0,
                levelWidth,
                levelHeight
            );
            state.levels.push(canvas);
        }
        return state.levels;
    }

    /**
     * 缩小显示时该用哪张图来画。
     *
     * 屏幕上一个像素对应原图好几个像素时，没必要每帧把整张图重采样一遍 ——
     * 直接用提前缩好的小图（Photoshop 也这么干）。放大或 1:1 时返回 null，
     * 表示照常画原图。
     */
    pyramidSource(kind, source, width, height, scale) {
        if (!source || width < 1 || height < 1) {
            return null;
        }
        if (!(scale > 0) || scale >= 0.5) {
            return null;
        }
        // 需要第几级：2^k <= 1 / scale
        const wanted = Math.max(1, Math.floor(Math.log2(1 / scale)));
        const state = this.pyramidState(kind);
        const levels = this.buildPyramidLevels(
            state,
            source,
            width,
            height,
            wanted
        );
        if (!levels.length) {
            return null;
        }
        const offset = clamp(wanted - state.startLevel, 0, levels.length - 1);
        return levels[offset];
    }

    /**
     * 把「方格底 + 原图 + 颜色层 + 遮罩层」画到指定画布上。
     *
     * clipRect 给定时只画这一块 —— 画一笔时只重画笔刷碰到的地方，
     * 每帧要采样的源像素就跟笔刷大小有关，不再跟整张图面积有关。
     */
    paintScene(ctx, clipRect = null) {
        const width = ctx.canvas.width;
        const height = ctx.canvas.height;
        const imageRect = this.getImageDisplayRect();
        const drawLayer = (imageLike, opacity = 1) => {
            ctx.save();
            ctx.translate(imageRect.centerX, imageRect.centerY);
            ctx.scale(imageRect.scale, imageRect.scale);
            ctx.scale(this.flipX ? -1 : 1, this.flipY ? -1 : 1);
            ctx.rotate((Math.PI / 2) * this.rotationQuarterTurns);
            ctx.globalAlpha = opacity;
            ctx.drawImage(
                imageLike,
                -this.imageWidth / 2,
                -this.imageHeight / 2,
                this.imageWidth,
                this.imageHeight
            );
            ctx.restore();
        };
        const checker = this.checkerBackground(width, height);
        const region = clipRect
            ? this.snapRepaintRect(clipRect, width, height)
            : { x0: 0, y0: 0, x1: width, y1: height };
        const regionWidth = region.x1 - region.x0;
        const regionHeight = region.y1 - region.y0;
        ctx.save();
        // 先在不裁剪的情况下把这一块铺成「完全不透明」的底。
        // 裁剪边缘带抗锯齿，如果底色是透明的，边缘就会留下半透明像素 ——
        // 画一笔之后屏幕上就是一道道竖条纹残影。
        ctx.clearRect(region.x0, region.y0, regionWidth, regionHeight);
        if (checker) {
            ctx.drawImage(
                checker,
                region.x0,
                region.y0,
                regionWidth,
                regionHeight,
                region.x0,
                region.y0,
                regionWidth,
                regionHeight
            );
        }
        if (clipRect) {
            ctx.beginPath();
            ctx.rect(region.x0, region.y0, regionWidth, regionHeight);
            ctx.clip();
        }
        // 缩略图：原图永远不会变，随时能用；图层刚画过，缩略图可能还是
        // 这一笔之前的内容，所以局部重画时图层只能画原图。
        const sourceOf = (
            kind,
            source,
            sourceWidth,
            sourceHeight,
            allowThumbnail = true
        ) => {
            if (!source || (clipRect && !allowThumbnail)) {
                return source;
            }
            return this.pyramidSource(
                kind,
                source,
                sourceWidth,
                sourceHeight,
                imageRect.scale
            ) || source;
        };
        drawLayer(
            sourceOf("image", this.baseImage, this.imageWidth, this.imageHeight),
            1
        );
        if (this.paintVisible && this.layerHasContent("paint")) {
            drawLayer(
                sourceOf(
                    "paint",
                    this.paintCanvas,
                    this.layerWidth,
                    this.layerHeight,
                    false
                ),
                this.paintOpacity
            );
        }
        if (this.maskVisible && this.layerHasContent("mask")) {
            if (this.maskDisplayInverted) {
                // 白色蒙版走差集：遮罩范围内整块反相显示
                const whiteMask = this.buildWhiteMaskCanvas();
                ctx.save();
                ctx.globalCompositeOperation = "difference";
                drawLayer(
                    sourceOf(
                        "white",
                        whiteMask,
                        whiteMask.width,
                        whiteMask.height,
                        false
                    ),
                    1
                );
                ctx.restore();
            } else {
                drawLayer(
                    sourceOf(
                        "mask",
                        this.maskCanvas,
                        this.layerWidth,
                        this.layerHeight,
                        false
                    ),
                    this.maskDisplayOpacity
                );
            }
        }
        ctx.restore();
    }

    /**
     * 局部重画用的矩形：对齐到整像素，并向外各放 1 像素。
     *
     * 放出来的那一圈内容没变，裁剪边缘抗锯齿混到的都是「旧 = 新」，
     * 所以看不出接缝。
     */
    snapRepaintRect(rect, width, height) {
        const x0 = clamp(
            Math.floor(Math.min(rect.x0, rect.x1)) - 1,
            0,
            width
        );
        const y0 = clamp(
            Math.floor(Math.min(rect.y0, rect.y1)) - 1,
            0,
            height
        );
        const x1 = clamp(
            Math.ceil(Math.max(rect.x0, rect.x1)) + 1,
            0,
            width
        );
        const y1 = clamp(
            Math.ceil(Math.max(rect.y0, rect.y1)) + 1,
            0,
            height
        );
        return { x0, y0, x1, y1 };
    }

    /**
     * 「反相显示」用的白模：遮罩不透明的地方变白，其余透明。
     * 它只跟遮罩内容有关，没改过就复用，不要每帧重建整张图。
     */
    buildWhiteMaskCanvas() {
        if (!this._whiteMaskCanvas) {
            this._whiteMaskCanvas = document.createElement("canvas");
            this._whiteMaskCtx = this._whiteMaskCanvas.getContext("2d", {
                alpha: true,
            });
        }
        const wm = this._whiteMaskCanvas;
        if (
            !this._whiteMaskDirty
            && wm.width === this.maskCanvas.width
            && wm.height === this.maskCanvas.height
        ) {
            return wm;
        }
        wm.width = this.maskCanvas.width;
        wm.height = this.maskCanvas.height;
        this._whiteMaskCtx.fillStyle = "#ffffff";
        this._whiteMaskCtx.fillRect(0, 0, wm.width, wm.height);
        this._whiteMaskCtx.globalCompositeOperation = "destination-in";
        this._whiteMaskCtx.drawImage(this.maskCanvas, 0, 0);
        this._whiteMaskCtx.globalCompositeOperation = "source-over";
        this._whiteMaskDirty = false;
        this.invalidatePyramid("white");
        return wm;
    }

    /** 画笔圆环在屏幕上占的方块（圆环本身 + 几个像素余量）。 */
    brushCursorRect() {
        if (
            !this.cursorPoint
            || this.getEffectiveTool() === "pan"
            || this.tool === "fill"
        ) {
            return null;
        }
        const imageRect = this.getImageDisplayRect();
        const radius = (this.brushSize * imageRect.scale) / 2;
        const pad = radius + 4;
        return {
            x0: this.cursorPoint.x - pad,
            y0: this.cursorPoint.y - pad,
            x1: this.cursorPoint.x + pad,
            y1: this.cursorPoint.y + pad,
        };
    }

    /** 把场景缓存里的一块贴到显示画布上（copy 模式，连透明一起覆盖）。 */
    blitScene(rect) {
        const width = this.canvas.width;
        const height = this.canvas.height;
        const region = rect
            ? this.snapRepaintRect(rect, width, height)
            : { x0: 0, y0: 0, x1: width, y1: height };
        const regionWidth = region.x1 - region.x0;
        const regionHeight = region.y1 - region.y0;
        if (regionWidth <= 0 || regionHeight <= 0) {
            return;
        }
        this.ctx.save();
        // 注意不能用 "copy" 合成：源图只覆盖这一块，copy 会把画布其余
        // 部分一起清成透明。先清这块，再正常贴上去。
        this.ctx.clearRect(region.x0, region.y0, regionWidth, regionHeight);
        this.ctx.drawImage(
            this.sceneCanvas,
            region.x0,
            region.y0,
            regionWidth,
            regionHeight,
            region.x0,
            region.y0,
            regionWidth,
            regionHeight
        );
        this.ctx.restore();
    }

    render() {
        if (!this.baseImage) {
            return;
        }
        const width = this.canvas.width;
        const height = this.canvas.height;
        if (
            this.sceneCanvas.width !== width
            || this.sceneCanvas.height !== height
        ) {
            this.sceneCanvas.width = width;
            this.sceneCanvas.height = height;
            this._sceneDirty = true;
        }
        const key = this.sceneCacheKey();
        const fullRebuild = this._sceneDirty || key !== this._sceneKey;
        const dirtyRect = fullRebuild ? null : this._dirtyRect;
        if (fullRebuild) {
            this.paintScene(this.sceneCtx);
            this._sceneKey = key;
            this._sceneDirty = false;
            this._dirtyRect = null;
        } else if (dirtyRect) {
            this.paintScene(this.sceneCtx, dirtyRect);
            this._dirtyRect = null;
        }
        // 显示画布只更新真正变了的地方：这一笔的范围、上一个圆环、当前圆环。
        const cursorRect = this.brushCursorRect();
        if (fullRebuild) {
            this.blitScene(null);
        } else {
            const region = unionRects([
                dirtyRect,
                this._lastCursorRect,
                cursorRect,
            ]);
            if (!region) {
                // 什么都没变（连圆环都没动），不用重画
                return;
            }
            this.blitScene(region);
        }
        this._lastCursorRect = cursorRect;
        this.drawBrushCursor();
    }

    /** 画笔圆环：压在什么颜色上都使用差集反相。 */
    drawBrushCursor() {
        if (
            !this.cursorPoint
            || this.getEffectiveTool() === "pan"
            || this.tool === "fill"
        ) {
            return;
        }
        const imageRect = this.getImageDisplayRect();
        const cursorRadius = (this.brushSize * imageRect.scale) / 2;
        this.ctx.save();
        this.ctx.globalCompositeOperation = "difference";
        this.ctx.strokeStyle = "#ffffff";
        this.ctx.lineWidth = 1.5;
        this.ctx.setLineDash([]);
        this.ctx.beginPath();
        this.ctx.arc(
            this.cursorPoint.x,
            this.cursorPoint.y,
            cursorRadius,
            0,
            Math.PI * 2
        );
        this.ctx.stroke();
        this.ctx.restore();
    }
}
