/**
 * XController Core — 通用控制组件渲染引擎
 * =========================================
 *
 * 为 XKnob / XFaderH / XFaderV / XToggle / XButton / XYPad
 * 提供统一的 Canvas 渲染、交互事件处理、画布事件转发。
 *
 * 颜色：全部使用 ComfyUI CSS 自定义属性，不硬编码色值。
 * 参考变量：
 *   --comfy-menu-bg              主背景
 *   --comfy-menu-secondary-bg    次级背景（轨道）
 *   --input-text                 文字 / 前景色
 *   --descrip-text               弱化文字
 *   --border-color               边框
 *   --primary-color              强调色（高亮 / 填充）
 *   --error-text                 错误色
 */

(function (global) {
    "use strict";

    // ================================================================
    // 工具函数
    // ================================================================

    /** 读取 ComfyUI CSS 变量的实际值。 */
    function cssVar(name, fallback) {
        if (typeof document === "undefined") return fallback;
        var v = getComputedStyle(document.documentElement)
            .getPropertyValue(name)
            .trim();
        return v || fallback;
    }

    /** 限制值在 [lo, hi] 之间。 */
    function clamp(v, lo, hi) {
        return Math.max(lo, Math.min(hi, v));
    }

    /** 将浏览器坐标映射回 Canvas 的逻辑像素坐标。 */
    function canvasPoint(canvas, event) {
        var rect = canvas.getBoundingClientRect();
        var dpr = (typeof window !== "undefined" && window.devicePixelRatio) || 1;
        var logicalW = canvas.width / dpr;
        var logicalH = canvas.height / dpr;
        return {
            x: rect.width ? (event.clientX - rect.left) * logicalW / rect.width : 0,
            y: rect.height ? (event.clientY - rect.top) * logicalH / rect.height : 0,
        };
    }

    /** 高 DPI 适配：设置 Canvas 物理像素。 */
    function setupHiDPI(canvas, ctx, cssW, cssH) {
        var dpr = (typeof window !== "undefined" && window.devicePixelRatio) || 1;
        canvas.width = cssW * dpr;
        canvas.height = cssH * dpr;
        canvas.style.width = cssW + "px";
        canvas.style.height = cssH + "px";
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.scale(dpr, dpr);
    }

    // ================================================================
    // 画布事件转发（中键平移 + 滚轮缩放）
    // ================================================================

    function installCanvasForwarding(element, app) {
        if (!element || !app || !app.canvas) return;

        /** 中键拖拽 → 画布平移。 */
        element.addEventListener("mousedown", function (e) {
            if (e.button !== 1) return;
            e.preventDefault();
            e.stopPropagation();
            var cvs = app.canvas;
            if (cvs && typeof cvs.processMouseDown === "function") {
                cvs.processMouseDown(e);
            }
        });

        element.addEventListener("mousemove", function (e) {
            if (!(e.buttons & 4)) return; // 中键
            e.preventDefault();
            e.stopPropagation();
            var cvs = app.canvas;
            if (cvs && typeof cvs.processMouseMove === "function") {
                cvs.processMouseMove(e);
            }
        });

        element.addEventListener("mouseup", function (e) {
            if (e.button !== 1) return;
            e.preventDefault();
            e.stopPropagation();
            var cvs = app.canvas;
            if (cvs && typeof cvs.processMouseUp === "function") {
                cvs.processMouseUp(e);
            }
        });

        /** 滚轮 → 画布缩放。 */
        element.addEventListener(
            "wheel",
            function (e) {
                e.preventDefault();
                e.stopPropagation();
                var cvs = app.canvas;
                var gc = cvs && cvs.canvas;
                if (gc) {
                    var we = new WheelEvent("wheel", {
                        deltaX: e.deltaX,
                        deltaY: e.deltaY,
                        deltaZ: e.deltaZ,
                        deltaMode: e.deltaMode,
                        clientX: e.clientX,
                        clientY: e.clientY,
                        screenX: e.screenX,
                        screenY: e.screenY,
                        ctrlKey: e.ctrlKey,
                        altKey: e.altKey,
                        shiftKey: e.shiftKey,
                        metaKey: e.metaKey,
                        bubbles: true,
                        cancelable: true,
                    });
                    gc.dispatchEvent(we);
                }
            },
            { passive: false }
        );
    }

    // ================================================================
    // 控件渲染器
    // ================================================================

    /**
     * 旋钮渲染器。
     *
     * 形状：circle / rounded_rect / hexagon
     * 交互：垂直拖拽或圆弧拖拽，调节 0~1。
     */
    function KnobRenderer(canvas, ctx, config) {
        var shape = config.shape || "circle";
        var W = config.width || 80;
        var H = config.height || 80;

        var outerR = Math.min(W, H) / 2 - 4;
        var cx = W / 2;
        var cy = H / 2;

        var arcStart = 0.75 * Math.PI; // 135°
        var arcEnd = 2.25 * Math.PI; // 405° (same as 45°)
        var arcRange = arcEnd - arcStart;

        this.render = function (normalizedValue) {
            ctx.clearRect(0, 0, W, H);

            var val = clamp(normalizedValue, 0, 1);
            var angle = arcStart + val * arcRange;

            // 外环 —— 轨道
            ctx.beginPath();
            if (shape === "rounded_rect") {
                roundRectPath(ctx, cx - outerR, cy - outerR, outerR * 2, outerR * 2, outerR * 0.3);
            } else if (shape === "hexagon") {
                hexagonPath(ctx, cx, cy, outerR);
            } else {
                ctx.arc(cx, cy, outerR, 0, Math.PI * 2);
            }
            ctx.lineWidth = 3;
            ctx.strokeStyle = cssVar("--comfy-menu-secondary-bg", "#333");
            ctx.stroke();

            // 已填充弧线
            ctx.beginPath();
            if (shape === "rounded_rect") {
                // 简化：只画圆弧
                ctx.arc(cx, cy, outerR * 0.85, arcStart, angle);
            } else if (shape === "hexagon") {
                ctx.arc(cx, cy, outerR * 0.85, arcStart, angle);
            } else {
                ctx.arc(cx, cy, outerR * 0.85, arcStart, angle);
            }
            ctx.lineWidth = 4;
            ctx.strokeStyle = cssVar("--primary-color", "#ff385c");
            ctx.stroke();

            // 指示线
            var innerR = outerR * 0.5;
            var ix = cx + Math.cos(angle) * innerR;
            var iy = cy + Math.sin(angle) * innerR;
            ctx.beginPath();
            ctx.moveTo(cx, cy);
            ctx.lineTo(ix, iy);
            ctx.lineWidth = 2;
            ctx.strokeStyle = cssVar("--input-text", "#ddd");
            ctx.stroke();

            // 中心点
            ctx.beginPath();
            ctx.arc(cx, cy, 3, 0, Math.PI * 2);
            ctx.fillStyle = cssVar("--input-text", "#ddd");
            ctx.fill();

            // 数值显示
            var pct = Math.round(val * 100);
            ctx.font = "10px sans-serif";
            ctx.fillStyle = cssVar("--descrip-text", "#999");
            ctx.textAlign = "center";
            ctx.fillText(pct + "%", cx, cy + outerR + 14);
        };

        /** 从鼠标位置推算归一化值。 */
        this.valueFromEvent = function (e) {
            var point = canvasPoint(canvas, e);
            var mx = point.x;
            var my = point.y;
            var dx = mx - cx;
            var dy = my - cy;
            var angle = Math.atan2(dy, dx);
            // 映射到 arcStart..arcEnd
            if (angle < 0) angle += Math.PI * 2;
            if (angle < arcStart - Math.PI * 0.2) angle += Math.PI * 2;
            return clamp((angle - arcStart) / arcRange, 0, 1);
        };
    }

    /**
     * 水平滑块渲染器。
     */
    function FaderHRenderer(canvas, ctx, config) {
        var handleShape = config.shape || "circle";
        var W = config.width || 200;
        var H = config.height || 32;
        var trackY = H / 2;
        var trackHMargin = 14;
        var trackW = W - trackHMargin * 2;
        var handleR = 8;

        this.render = function (normalizedValue) {
            ctx.clearRect(0, 0, W, H);

            var val = clamp(normalizedValue, 0, 1);
            var hx = trackHMargin + val * trackW;

            // 轨道
            var trackThick = 4;
            ctx.beginPath();
            ctx.moveTo(trackHMargin, trackY);
            ctx.lineTo(trackHMargin + trackW, trackY);
            ctx.lineWidth = trackThick;
            ctx.strokeStyle = cssVar("--comfy-menu-secondary-bg", "#333");
            ctx.lineCap = "round";
            ctx.stroke();

            // 已填充轨道
            ctx.beginPath();
            ctx.moveTo(trackHMargin, trackY);
            ctx.lineTo(hx, trackY);
            ctx.lineWidth = trackThick;
            ctx.strokeStyle = cssVar("--primary-color", "#ff385c");
            ctx.stroke();

            // 手柄
            drawHandle(ctx, hx, trackY, handleR, handleShape);

        };

        this.valueFromEvent = function (e) {
            var mx = canvasPoint(canvas, e).x;
            return clamp((mx - trackHMargin) / trackW, 0, 1);
        };
    }

    /**
     * 垂直推子渲染器。
     */
    function FaderVRenderer(canvas, ctx, config) {
        var handleShape = config.shape || "circle";
        var W = config.width || 32;
        var H = config.height || 160;
        var trackX = W / 2;
        var trackVMargin = 14;
        var trackH = H - trackVMargin * 2;
        var handleR = 8;

        this.render = function (normalizedValue) {
            ctx.clearRect(0, 0, W, H);

            var val = clamp(normalizedValue, 0, 1);
            // Y 轴：底部=0，顶部=1
            var hy = trackVMargin + (1 - val) * trackH;

            // 轨道
            var trackThick = 4;
            ctx.beginPath();
            ctx.moveTo(trackX, trackVMargin);
            ctx.lineTo(trackX, trackVMargin + trackH);
            ctx.lineWidth = trackThick;
            ctx.strokeStyle = cssVar("--comfy-menu-secondary-bg", "#333");
            ctx.lineCap = "round";
            ctx.stroke();

            // 已填充
            ctx.beginPath();
            ctx.moveTo(trackX, hy);
            ctx.lineTo(trackX, trackVMargin + trackH);
            ctx.lineWidth = trackThick;
            ctx.strokeStyle = cssVar("--primary-color", "#ff385c");
            ctx.stroke();

            // 手柄
            drawHandle(ctx, trackX, hy, handleR, handleShape);

        };

        this.valueFromEvent = function (e) {
            var my = canvasPoint(canvas, e).y;
            return clamp(1 - (my - trackVMargin) / trackH, 0, 1);
        };
    }

    /**
     * 开关渲染器。
     *
     * 样式：switch（滑动开关）/ paddle（拨片）/ dot（圆点按钮）
     */
    function ToggleRenderer(canvas, ctx, config) {
        var style = config.style || "switch";
        var W = config.width || 60;
        var H = config.height || 32;

        this.render = function (state) {
            ctx.clearRect(0, 0, W, H);

            if (style === "paddle") {
                renderPaddle(ctx, W, H, state);
            } else if (style === "dot") {
                renderDot(ctx, W, H, state);
            } else {
                renderSwitch(ctx, W, H, state);
            }
        };

        function renderSwitch(c, w, h, on) {
            var cx = w / 2;
            var cy = h / 2;
            var trackW = w - 4;
            var trackH = h - 10;
            var trackR = trackH / 2;
            var knobR = trackR - 1;
            var knobX = on ? cx + trackW / 2 - knobR - 3 : cx - trackW / 2 + knobR + 3;

            // 轨道
            c.beginPath();
            roundRectPath(c, cx - trackW / 2, cy - trackH / 2, trackW, trackH, trackR);
            c.fillStyle = on
                ? cssVar("--primary-color", "#ff385c")
                : cssVar("--comfy-menu-secondary-bg", "#333");
            c.fill();

            // 拨钮
            c.beginPath();
            c.arc(knobX, cy, knobR, 0, Math.PI * 2);
            c.fillStyle = cssVar("--input-text", "#ddd");
            c.fill();
        }

        function renderPaddle(c, w, h, on) {
            var cx = w / 2;
            var cy = h / 2;
            var bw = w - 6;
            var bh = h - 6;
            var tilt = on ? 0.15 : -0.15;

            c.save();
            c.translate(cx, cy);
            c.rotate(tilt);
            roundRectPath(c, -bw / 2, -bh / 2, bw, bh, 4);
            c.fillStyle = on
                ? cssVar("--primary-color", "#ff385c")
                : cssVar("--comfy-menu-secondary-bg", "#333");
            c.fill();
            c.strokeStyle = cssVar("--border-color", "#555");
            c.lineWidth = 1;
            c.stroke();
            c.restore();
        }

        function renderDot(c, w, h, on) {
            var cx = w / 2;
            var cy = h / 2;
            var r = Math.min(w, h) / 2 - 4;

            c.beginPath();
            c.arc(cx, cy, r, 0, Math.PI * 2);
            c.fillStyle = on
                ? cssVar("--primary-color", "#ff385c")
                : cssVar("--comfy-menu-secondary-bg", "#333");
            c.fill();
            c.strokeStyle = cssVar("--border-color", "#555");
            c.lineWidth = 1;
            c.stroke();

            if (on) {
                // 点亮时内部亮圈
                c.beginPath();
                c.arc(cx, cy, r * 0.6, 0, Math.PI * 2);
                c.fillStyle = cssVar("--input-text", "#ddd");
                c.fill();
            }
        }
    }

    /**
     * 按压按钮渲染器。
     *
     * 样式：rounded / square / pill
     * 状态：pressed（按住时高亮）
     */
    function ButtonRenderer(canvas, ctx, config) {
        var style = config.style || "rounded";
        var labelOn = config.labelOn || "ON";
        var labelOff = config.labelOff || "OFF";
        var W = config.width || 80;
        var H = config.height || 40;

        this.render = function (pressed) {
            ctx.clearRect(0, 0, W, H);

            var bw = W - 4;
            var bh = H - 4;
            var bx = (W - bw) / 2;
            var by = (H - bh) / 2;
            var radius;

            if (style === "pill") {
                radius = bh / 2;
            } else if (style === "square") {
                radius = 2;
            } else {
                radius = 6; // rounded
            }

            ctx.beginPath();
            roundRectPath(ctx, bx, by, bw, bh, radius);
            ctx.fillStyle = pressed
                ? cssVar("--primary-color", "#ff385c")
                : cssVar("--comfy-menu-secondary-bg", "#333");
            ctx.fill();
            ctx.strokeStyle = cssVar("--border-color", "#555");
            ctx.lineWidth = 1;
            ctx.stroke();

            // 标签
            ctx.font = "11px sans-serif";
            ctx.fillStyle = pressed
                ? "#fff"
                : cssVar("--input-text", "#ddd");
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(pressed ? labelOn : labelOff, W / 2, H / 2);
        };
    }

    /**
     * XY Pad 渲染器。
     */
    function XYPadRenderer(canvas, ctx, config) {
        var W = config.width || 160;
        var H = config.height || 160;
        var padMargin = 14;
        var padW = W - padMargin * 2;
        var padH = H - padMargin * 2;

        var showCrosshair = config.crosshairVisible !== false;
        var showGrid = config.gridVisible === true;

        this.render = function (nx, ny) {
            ctx.clearRect(0, 0, W, H);

            var x = clamp(nx, 0, 1);
            var y = clamp(ny, 0, 1);
            var px = padMargin + x * padW;
            var py = padMargin + (1 - y) * padH; // y 轴翻转

            // 面板背景
            ctx.beginPath();
            ctx.rect(padMargin, padMargin, padW, padH);
            ctx.fillStyle = cssVar("--comfy-input-bg", "#242426");
            ctx.fill();
            ctx.strokeStyle = cssVar("--border-color", "#555");
            ctx.lineWidth = 1;
            ctx.stroke();

            // 网格
            if (showGrid) {
                ctx.strokeStyle = cssVar("--descrip-text", "#999");
                ctx.globalAlpha = 0.28;
                ctx.lineWidth = 0.5;
                for (var i = 1; i < 4; i++) {
                    var gx = padMargin + (padW / 4) * i;
                    ctx.beginPath();
                    ctx.moveTo(gx, padMargin);
                    ctx.lineTo(gx, padMargin + padH);
                    ctx.stroke();
                    var gy = padMargin + (padH / 4) * i;
                    ctx.beginPath();
                    ctx.moveTo(padMargin, gy);
                    ctx.lineTo(padMargin + padW, gy);
                    ctx.stroke();
                }
                ctx.globalAlpha = 1;
            }

            // 十字准线
            if (showCrosshair) {
                ctx.strokeStyle = cssVar("--descrip-text", "#999");
                ctx.lineWidth = 0.5;
                ctx.setLineDash([4, 4]);
                ctx.beginPath();
                ctx.moveTo(px, padMargin);
                ctx.lineTo(px, padMargin + padH);
                ctx.moveTo(padMargin, py);
                ctx.lineTo(padMargin + padW, py);
                ctx.stroke();
                ctx.setLineDash([]);
            }

            // 指示点
            ctx.beginPath();
            ctx.arc(px, py, 6, 0, Math.PI * 2);
            ctx.fillStyle = cssVar("--primary-color", "#ff385c");
            ctx.fill();
            ctx.strokeStyle = cssVar("--input-text", "#ddd");
            ctx.lineWidth = 1.5;
            ctx.stroke();

        };

        this.valuesFromEvent = function (e) {
            var point = canvasPoint(canvas, e);
            var mx = point.x;
            var my = point.y;
            return {
                x: clamp((mx - padMargin) / padW, 0, 1),
                y: clamp(1 - (my - padMargin) / padH, 0, 1),
            };
        };
    }

    // ================================================================
    // 绘制辅助函数
    // ================================================================

    function roundRectPath(ctx, x, y, w, h, r) {
        ctx.moveTo(x + r, y);
        ctx.lineTo(x + w - r, y);
        ctx.arcTo(x + w, y, x + w, y + r, r);
        ctx.lineTo(x + w, y + h - r);
        ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
        ctx.lineTo(x + r, y + h);
        ctx.arcTo(x, y + h, x, y + h - r, r);
        ctx.lineTo(x, y + r);
        ctx.arcTo(x, y, x + r, y, r);
        ctx.closePath();
    }

    function hexagonPath(ctx, cx, cy, r) {
        ctx.moveTo(cx + r * Math.cos(0), cy + r * Math.sin(0));
        for (var i = 1; i < 6; i++) {
            var a = (Math.PI * 2 / 6) * i - Math.PI / 2;
            ctx.lineTo(cx + r * Math.cos(a), cy + r * Math.sin(a));
        }
        ctx.closePath();
    }

    function drawHandle(ctx, x, y, r, shape) {
        ctx.beginPath();
        if (shape === "square") {
            ctx.rect(x - r, y - r, r * 2, r * 2);
        } else if (shape === "diamond") {
            ctx.moveTo(x, y - r);
            ctx.lineTo(x + r, y);
            ctx.lineTo(x, y + r);
            ctx.lineTo(x - r, y);
            ctx.closePath();
        } else {
            ctx.arc(x, y, r, 0, Math.PI * 2);
        }
        ctx.fillStyle = cssVar("--input-text", "#ddd");
        ctx.fill();
        ctx.strokeStyle = cssVar("--border-color", "#555");
        ctx.lineWidth = 1;
        ctx.stroke();
    }

    // ================================================================
    // 控件工厂
    // ================================================================

    /**
     * 创建一个控件实例。
     *
     * @param {Object} config
     * @param {string} config.type - 'knob' | 'faderH' | 'faderV' | 'toggle' | 'button' | 'xyPad'
     * @param {string} [config.shape] - 形状变体
     * @param {string} [config.style] - 开关/按钮样式
     * @param {boolean} [config.crosshairVisible]
     * @param {boolean} [config.gridVisible]
     * @param {number} [config.width]
     * @param {number} [config.height]
     * @param {Object} config.app - ComfyUI app 引用（用于画布事件转发）
     * @param {Function} config.onValueChange - (normalizedValue) => void
     * @param {Function} config.onToggleChange - (boolean) => void
     * @param {Function} config.onButtonChange - (boolean) => void
     * @param {Function} config.onXYChange - (x, y) => void
     * @returns {{ canvas: HTMLCanvasElement, dom: HTMLElement, setValue: Function, getValue: Function, destroy: Function }}
     */
    function createControl(config) {
        var type = config.type;
        var W = config.width || defaultSize(type).w;
        var H = config.height || defaultSize(type).h;

        var wrap = document.createElement("div");
        wrap.style.cssText =
            "display:flex;align-items:center;justify-content:center;" +
            "overflow:hidden;";

        var canvas = document.createElement("canvas");
        canvas.style.display = "block";
        canvas.style.cursor = cursorFor(type);
        wrap.appendChild(canvas);

        var ctx = canvas.getContext("2d");
        setupHiDPI(canvas, ctx, W, H);

        var renderer;
        var currentValue = 0.5; // 归一化值
        var currentBool = false; // toggle / button
        var currentX = 0.5;
        var currentY = 0.5;
        var app = config.app;

        switch (type) {
            case "knob":
                renderer = new KnobRenderer(canvas, ctx, {
                    shape: config.shape || "circle",
                    width: W,
                    height: H,
                });
                break;
            case "faderH":
                renderer = new FaderHRenderer(canvas, ctx, {
                    shape: config.shape || "circle",
                    width: W,
                    height: H,
                });
                break;
            case "faderV":
                renderer = new FaderVRenderer(canvas, ctx, {
                    shape: config.shape || "circle",
                    width: W,
                    height: H,
                });
                break;
            case "toggle":
                renderer = new ToggleRenderer(canvas, ctx, {
                    style: config.style || "switch",
                    width: W,
                    height: H,
                });
                currentBool = true; // default
                break;
            case "button":
                renderer = new ButtonRenderer(canvas, ctx, {
                    style: config.style || "rounded",
                    labelOn: config.labelOn,
                    labelOff: config.labelOff,
                    width: W,
                    height: H,
                });
                break;
            case "xyPad":
                renderer = new XYPadRenderer(canvas, ctx, {
                    width: W,
                    height: H,
                    crosshairVisible: config.crosshairVisible,
                    gridVisible: config.gridVisible,
                });
                break;
            default:
                throw new Error("Unknown control type: " + type);
        }

        // 初始渲染
        renderControl();

        function renderControl() {
            if (type === "toggle") {
                renderer.render(currentBool);
            } else if (type === "button") {
                renderer.render(currentBool);
            } else if (type === "xyPad") {
                renderer.render(currentX, currentY);
            } else {
                renderer.render(currentValue);
            }
        }

        // ============================================================
        // 事件处理
        // ============================================================

        var dragging = false;
        var buttonToggleMode = config.buttonToggleMode === true;
        var dragStartY = 0;
        var dragStartValue = 0;

        canvas.addEventListener("mousedown", function (e) {
            if (e.button !== 0) return;
            e.preventDefault();

            if (type === "toggle") {
                currentBool = !currentBool;
                renderControl();
                if (config.onToggleChange) config.onToggleChange(currentBool);
                return;
            }

            if (type === "button") {
                if (buttonToggleMode) {
                    currentBool = !currentBool;
                    renderControl();
                    if (config.onButtonChange) config.onButtonChange(currentBool);
                    return;
                }
                currentBool = true;
                renderControl();
                if (config.onButtonChange) config.onButtonChange(true);
                dragging = true;
                return;
            }

            dragging = true;
            if (type === "knob") {
                dragStartY = e.clientY;
                dragStartValue = currentValue;
            }
            handleDrag(e);
        });

        function handleDrag(e) {
            if (type === "button") return;
            if (type === "knob") {
                currentValue = clamp(
                    dragStartValue + (dragStartY - e.clientY) / 150,
                    0,
                    1
                );
                renderControl();
                if (config.onValueChange) config.onValueChange(currentValue);
            } else if (type === "xyPad") {
                var coords = renderer.valuesFromEvent(e);
                currentX = coords.x;
                currentY = coords.y;
                renderControl();
                if (config.onXYChange) config.onXYChange(currentX, currentY);
            } else {
                currentValue = renderer.valueFromEvent(e);
                renderControl();
                if (config.onValueChange) config.onValueChange(currentValue);
            }
        }

        document.addEventListener("mousemove", function (e) {
            if (!dragging) return;
            handleDrag(e);
        });

        document.addEventListener("mouseup", function (e) {
            if (!dragging) return;
            dragging = false;

            if (type === "button" && !buttonToggleMode) {
                currentBool = false;
                renderControl();
                if (config.onButtonChange) config.onButtonChange(false);
            }
        });

        // 触摸支持
        canvas.addEventListener("touchstart", function (e) {
            e.preventDefault();
            if (type === "toggle") {
                currentBool = !currentBool;
                renderControl();
                if (config.onToggleChange) config.onToggleChange(currentBool);
                return;
            }
            if (type === "button") {
                if (buttonToggleMode) {
                    currentBool = !currentBool;
                    renderControl();
                    if (config.onButtonChange) config.onButtonChange(currentBool);
                    return;
                }
                currentBool = true;
                renderControl();
                if (config.onButtonChange) config.onButtonChange(true);
                dragging = true;
                return;
            }
            dragging = true;
            if (type === "knob") {
                var touch = e.touches[0];
                if (!touch) return;
                dragStartY = touch.clientY;
                dragStartValue = currentValue;
            }
            handleTouch(e);
        });

        canvas.addEventListener("touchmove", function (e) {
            if (!dragging) return;
            e.preventDefault();
            handleTouch(e);
        });

        canvas.addEventListener("touchend", function (e) {
            if (!dragging) return;
            dragging = false;
            if (type === "button" && !buttonToggleMode) {
                currentBool = false;
                renderControl();
                if (config.onButtonChange) config.onButtonChange(false);
            }
        });

        canvas.addEventListener("touchcancel", function (e) {
            if (!dragging) return;
            dragging = false;
            if (type === "button" && !buttonToggleMode) {
                currentBool = false;
                renderControl();
                if (config.onButtonChange) config.onButtonChange(false);
            }
        });

        function handleTouch(e) {
            var touch = e.touches[0];
            if (!touch) return;
            if (type === "xyPad") {
                var coords = renderer.valuesFromEvent(touch);
                currentX = coords.x;
                currentY = coords.y;
                renderControl();
                if (config.onXYChange) config.onXYChange(currentX, currentY);
            } else if (type === "knob") {
                currentValue = clamp(
                    dragStartValue + (dragStartY - touch.clientY) / 150,
                    0,
                    1
                );
                renderControl();
                if (config.onValueChange) config.onValueChange(currentValue);
            } else {
                currentValue = renderer.valueFromEvent(touch);
                renderControl();
                if (config.onValueChange) config.onValueChange(currentValue);
            }
        }

        // 画布事件转发
        installCanvasForwarding(wrap, app);

        // ============================================================
        // 公共接口
        // ============================================================

        var self = {
            canvas: canvas,
            dom: wrap,

            setValue: function (normalized) {
                if (type === "toggle" || type === "button") {
                    currentBool = !!normalized;
                } else if (type === "xyPad") {
                    // expect {x, y}
                    if (normalized && typeof normalized.x === "number") {
                        currentX = normalized.x;
                        currentY = normalized.y;
                    }
                } else {
                    currentValue = clamp(normalized, 0, 1);
                }
                renderControl();
            },

            getValue: function () {
                if (type === "toggle" || type === "button") return currentBool;
                if (type === "xyPad") return { x: currentX, y: currentY };
                return currentValue;
            },

            destroy: function () {
                // 清理事件由 DOM 移除处理
            },
        };

        return self;
    }

    function defaultSize(type) {
        switch (type) {
            case "knob": return { w: 80, h: 80 };
            case "faderH": return { w: 200, h: 32 };
            case "faderV": return { w: 32, h: 160 };
            case "toggle": return { w: 60, h: 32 };
            case "button": return { w: 80, h: 40 };
            case "xyPad": return { w: 160, h: 160 };
            default: return { w: 120, h: 40 };
        }
    }

    function cursorFor(type) {
        if (type === "toggle" || type === "button") return "pointer";
        if (type === "xyPad") return "crosshair";
        if (type === "faderV") return "ns-resize";
        if (type === "knob") return "ns-resize";
        return "ew-resize";
    }

    // ================================================================
    // 导出
    // ================================================================

    var module = {
        createControl: createControl,
        cssVar: cssVar,
        clamp: clamp,
    };

    // 支持 ES module 和 script 标签两种加载方式
    if (typeof global !== "undefined") {
        global.XControllerCore = module;
    }
    if (typeof window !== "undefined") {
        window.XControllerCore = module;
    }
})(typeof globalThis !== "undefined" ? globalThis : this);
