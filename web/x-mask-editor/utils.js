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
    const seed = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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
