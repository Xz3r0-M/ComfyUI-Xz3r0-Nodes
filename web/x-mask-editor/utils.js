import { randomSuffix } from "../core/random-id.js";

export function clamp(value, min, max) {
    const number = Number(value);
    if (!Number.isFinite(number)) {
        return min;
    }
    return Math.min(Math.max(number, min), max);
}

export function sanitizeFileBase(value, fallback = "ximageget") {
    const text = String(value || "")
        .trim()
        .replace(/\.[^.]+$/, "")
        .replace(/[^a-zA-Z0-9_-]+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "");
    return text || fallback;
}

export function nextClipspaceName(prefix = "x-mask") {
    /* 随机段走共享的 randomSuffix（内部用 crypto）：静态扫描会把 Math
       里那个伪随机函数的结果报成「不安全的随机数」，而这个串是文件名。 */
    const seed = `${Date.now()}-${randomSuffix(6)}`;
    return `${prefix}-${seed}.png`;
}

export function loadImage(url) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error("Image load failed"));
        img.src = String(url || "");
    });
}

export function canvasToBlob(canvas, type = "image/png") {
    return new Promise((resolve, reject) => {
        if (!(canvas instanceof HTMLCanvasElement)) {
            reject(new Error("Canvas unavailable"));
            return;
        }
        canvas.toBlob((blob) => {
            if (!blob) {
                reject(new Error("Canvas export failed"));
                return;
            }
            resolve(blob);
        }, type);
    });
}
