import {
    BaseElement,
    registerCustomElement,
} from "../core/base-element.js?v=20260403-2";
import { appStore } from "../core/store.js";

function getPreviewSettings() {
    const settings = appStore.state.xdatahubSettings || {};
    return {
        videoAutoplay: settings.video_preview_autoplay === true,
        videoMuted: settings.video_preview_muted !== false,
        videoLoop: settings.video_preview_loop === true,
        audioAutoplay: settings.audio_preview_autoplay === true,
        audioMuted: settings.audio_preview_muted === true,
        audioLoop: settings.audio_preview_loop === true,
    };
}

function getFullscreenElement() {
    return document.fullscreenElement
        || document.webkitFullscreenElement
        || null;
}

function requestElementFullscreen(element) {
    if (typeof element.requestFullscreen === "function") {
        return element.requestFullscreen({ navigationUI: "hide" });
    }
    if (typeof element.webkitRequestFullscreen === "function") {
        return Promise.resolve(element.webkitRequestFullscreen());
    }
    return Promise.reject(new Error("fullscreen-unavailable"));
}

function exitElementFullscreen() {
    if (typeof document.exitFullscreen === "function") {
        return document.exitFullscreen();
    }
    if (typeof document.webkitExitFullscreen === "function") {
        return Promise.resolve(document.webkitExitFullscreen());
    }
    return Promise.resolve();
}

function isStageFullscreen(stage) {
    if (!(stage instanceof HTMLElement)) {
        return false;
    }

    const rootNode = stage.getRootNode();
    const rootFullscreenElement = rootNode instanceof ShadowRoot
        ? (rootNode.fullscreenElement || rootNode.webkitFullscreenElement)
        : null;
    const activeFullscreenElement = rootFullscreenElement
        || getFullscreenElement();

    if (activeFullscreenElement === stage) {
        return true;
    }
    if (activeFullscreenElement instanceof Node
        && activeFullscreenElement.contains(stage)) {
        return true;
    }

    try {
        if (stage.matches(":fullscreen")) {
            return true;
        }
    } catch {
        // Ignore unsupported selector errors.
    }

    try {
        if (stage.matches(":-webkit-full-screen")) {
            return true;
        }
    } catch {
        // Ignore unsupported selector errors.
    }

    return false;
}

const IMAGE_ZOOM_MIN = 1;
const IMAGE_ZOOM_MAX = 8;
const IMAGE_ZOOM_STEP = 0.2;

export class XdhLightbox extends BaseElement {
    constructor() {
        super();
        this._current = null;
        this._activeMedia = null;
        this._imageScale = IMAGE_ZOOM_MIN;
        this._imagePanX = 0;
        this._imagePanY = 0;
        this._isImagePanning = false;
        this._activePointerId = null;
        this._panStartX = 0;
        this._panStartY = 0;
        this._panStartOffsetX = 0;
        this._panStartOffsetY = 0;
        this._onPreview = (e) => this._open(e.detail);
        this._onFullscreenChange = () => {
            const stage = this.$(".fs-stage");
            if (!stage || isStageFullscreen(stage)) {
                return;
            }
            this._teardown();
        };
    }

    _syncPanStateDataset() {
        const stage = this.$(".fs-stage");
        if (!stage) {
            return;
        }
        stage.dataset.canPan = this._imageScale > IMAGE_ZOOM_MIN
            ? "true"
            : "false";
        stage.dataset.panning = this._isImagePanning ? "true" : "false";
    }

    _clampImagePan() {
        if (!(this._activeMedia instanceof HTMLImageElement)) {
            this._imagePanX = 0;
            this._imagePanY = 0;
            return;
        }

        if (this._imageScale <= IMAGE_ZOOM_MIN) {
            this._imagePanX = 0;
            this._imagePanY = 0;
            return;
        }

        const mediaHost = this.$(".fs-media");
        const viewportWidth = mediaHost?.clientWidth || 0;
        const viewportHeight = mediaHost?.clientHeight || 0;
        if (!viewportWidth || !viewportHeight) {
            return;
        }

        const rect = this._activeMedia.getBoundingClientRect();
        if (!rect.width || !rect.height) {
            return;
        }

        const maxPanX = Math.max(0, (rect.width - viewportWidth) / 2);
        const maxPanY = Math.max(0, (rect.height - viewportHeight) / 2);

        this._imagePanX = Math.min(
            maxPanX,
            Math.max(-maxPanX, this._imagePanX)
        );
        this._imagePanY = Math.min(
            maxPanY,
            Math.max(-maxPanY, this._imagePanY)
        );
    }

    _resetImageZoom() {
        this._imageScale = IMAGE_ZOOM_MIN;
        this._imagePanX = 0;
        this._imagePanY = 0;
        this._isImagePanning = false;
        this._activePointerId = null;
        this._syncPanStateDataset();
        if (!(this._activeMedia instanceof HTMLImageElement)) {
            return;
        }
        this._activeMedia.style.transform = "translate(0px, 0px) scale(1)";
        this._activeMedia.style.transformOrigin = "50% 50%";
    }

    _applyImageZoom() {
        if (!(this._activeMedia instanceof HTMLImageElement)) {
            return;
        }
        this._clampImagePan();
        this._activeMedia.style.transformOrigin = "50% 50%";
        this._activeMedia.style.transform =
            `translate(${this._imagePanX}px, ${this._imagePanY}px) scale(${this._imageScale})`;
        this._syncPanStateDataset();
    }

    _zoomImageAt(clientX, clientY, nextScale) {
        if (!(this._activeMedia instanceof HTMLImageElement)) {
            return;
        }

        const safeNextScale = Math.min(
            IMAGE_ZOOM_MAX,
            Math.max(IMAGE_ZOOM_MIN, nextScale)
        );
        const prevScale = this._imageScale;
        if (Math.abs(safeNextScale - prevScale) < 1e-6) {
            return;
        }

        const mediaHost = this.$(".fs-media");
        const viewportRect = mediaHost?.getBoundingClientRect();
        if (!viewportRect?.width || !viewportRect?.height) {
            return;
        }

        const viewportCenterX = viewportRect.left + viewportRect.width / 2;
        const viewportCenterY = viewportRect.top + viewportRect.height / 2;
        const cursorX = clientX - viewportCenterX;
        const cursorY = clientY - viewportCenterY;

        // Keep the image point under cursor stable while zooming.
        // Pan/scale model: screen = center + pan + scale * local.
        const ratio = safeNextScale / prevScale;
        this._imagePanX = cursorX - (cursorX - this._imagePanX) * ratio;
        this._imagePanY = cursorY - (cursorY - this._imagePanY) * ratio;
        this._imageScale = safeNextScale;
        this._applyImageZoom();
    }

    _handleImageWheel(event) {
        if (!(this._activeMedia instanceof HTMLImageElement)) {
            return;
        }
        const stage = this.$(".fs-stage");
        if (!stage || !isStageFullscreen(stage)) {
            return;
        }

        event.preventDefault();
        const nextScale = event.deltaY < 0
            ? this._imageScale + IMAGE_ZOOM_STEP
            : this._imageScale - IMAGE_ZOOM_STEP;
        this._zoomImageAt(event.clientX, event.clientY, nextScale);
    }

    _startImagePan(event) {
        if (!(this._activeMedia instanceof HTMLImageElement)) {
            return;
        }
        if (this._imageScale <= IMAGE_ZOOM_MIN || event.button !== 0) {
            return;
        }
        event.preventDefault();
        this._isImagePanning = true;
        this._activePointerId = event.pointerId;
        this._panStartX = event.clientX;
        this._panStartY = event.clientY;
        this._panStartOffsetX = this._imagePanX;
        this._panStartOffsetY = this._imagePanY;
        event.currentTarget?.setPointerCapture?.(event.pointerId);
        this._syncPanStateDataset();
    }

    _moveImagePan(event) {
        if (!this._isImagePanning || this._activePointerId !== event.pointerId) {
            return;
        }
        event.preventDefault();
        this._imagePanX = this._panStartOffsetX + (event.clientX - this._panStartX);
        this._imagePanY = this._panStartOffsetY + (event.clientY - this._panStartY);
        this._applyImageZoom();
    }

    _endImagePan(event) {
        if (!this._isImagePanning || this._activePointerId !== event.pointerId) {
            return;
        }
        this._isImagePanning = false;
        this._activePointerId = null;
        event.currentTarget?.releasePointerCapture?.(event.pointerId);
        this._syncPanStateDataset();
    }

    connectedCallback() {
        super.connectedCallback();
        document.addEventListener("xdh:preview", this._onPreview);
        document.addEventListener(
            "fullscreenchange",
            this._onFullscreenChange
        );
        document.addEventListener(
            "webkitfullscreenchange",
            this._onFullscreenChange
        );
    }

    disconnectedCallback() {
        super.disconnectedCallback();
        document.removeEventListener("xdh:preview", this._onPreview);
        document.removeEventListener(
            "fullscreenchange",
            this._onFullscreenChange
        );
        document.removeEventListener(
            "webkitfullscreenchange",
            this._onFullscreenChange
        );
        this._teardown();
    }

    bindEvents() {
        const stage = this.$(".fs-stage");
        if (!stage || stage._xdhWheelBound) {
            return;
        }
        stage._xdhWheelBound = true;
        stage.addEventListener(
            "wheel",
            (event) => this._handleImageWheel(event),
            { passive: false }
        );
        stage.addEventListener("dblclick", () => {
            this._resetImageZoom();
        });
        stage.addEventListener(
            "pointerdown",
            (event) => this._startImagePan(event)
        );
        stage.addEventListener(
            "pointermove",
            (event) => this._moveImagePan(event)
        );
        stage.addEventListener(
            "pointerup",
            (event) => this._endImagePan(event)
        );
        stage.addEventListener(
            "pointercancel",
            (event) => this._endImagePan(event)
        );
    }

    _buildMedia(detail, previewSettings) {
        const mediaType = String(detail?.type || "image").toLowerCase();

        if (mediaType === "video") {
            const video = document.createElement("video");
            video.src = detail.url;
            video.controls = true;
            video.preload = "metadata";
            video.autoplay = previewSettings.videoAutoplay;
            video.muted = previewSettings.videoMuted;
            video.loop = previewSettings.videoLoop;
            video.playsInline = true;
            video.className = "fs-video";
            return video;
        }

        if (mediaType === "audio") {
            const audio = document.createElement("audio");
            audio.src = detail.url;
            audio.controls = true;
            audio.preload = "metadata";
            audio.autoplay = previewSettings.audioAutoplay;
            audio.muted = previewSettings.audioMuted;
            audio.loop = previewSettings.audioLoop;
            audio.className = "fs-audio";
            return audio;
        }

        const image = document.createElement("img");
        image.src = detail.url;
        image.alt = detail.name || "";
        image.className = "fs-img";
        return image;
    }

    _startPlayback() {
        if (!(this._activeMedia instanceof HTMLVideoElement)
            && !(this._activeMedia instanceof HTMLAudioElement)) {
            return;
        }
        if (!this._activeMedia.autoplay) {
            return;
        }
        queueMicrotask(() => {
            this._activeMedia?.play?.().catch(() => {});
        });
    }

    _openInNewTab(detail) {
        window.open(detail.url, "_blank", "noopener,noreferrer");
    }

    async _open(detail) {
        if (!detail?.url) {
            return;
        }

        this._current = detail;
        const stage = this.$(".fs-stage");
        const mediaHost = this.$(".fs-media");
        const previewSettings = getPreviewSettings();
        if (!stage || !mediaHost) {
            return;
        }

        const mediaNode = this._buildMedia(detail, previewSettings);
        this._teardown({ preserveCurrent: true });
        mediaHost.replaceChildren(mediaNode);
        stage.dataset.mediaType = String(detail.type || "image").toLowerCase();
        this._activeMedia = mediaNode;
        this._resetImageZoom();

        if (isStageFullscreen(stage)) {
            this._startPlayback();
            return;
        }

        try {
            await requestElementFullscreen(stage);
            this._startPlayback();
        } catch {
            this._teardown({ preserveCurrent: true });
            this._openInNewTab(detail);
        }
    }

    _teardown(options = {}) {
        if (this._activeMedia instanceof HTMLVideoElement
            || this._activeMedia instanceof HTMLAudioElement) {
            this._activeMedia.pause();
        }
        this._resetImageZoom();
        this._activeMedia = null;
        const stage = this.$(".fs-stage");
        const mediaHost = this.$(".fs-media");
        if (stage) {
            delete stage.dataset.mediaType;
            delete stage.dataset.canPan;
            delete stage.dataset.panning;
        }
        mediaHost?.replaceChildren();
        if (!options.preserveCurrent) {
            this._current = null;
        }
    }

    _close() {
        const stage = this.$(".fs-stage");
        if (stage && isStageFullscreen(stage)) {
            exitElementFullscreen().catch(() => {
                this._teardown();
            });
            return;
        }
        this._teardown();
    }

    render() {
        return `
            <style>
                :host { display: contents; }

                .fs-stage {
                    position: fixed;
                    inset: 0;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    padding: 24px;
                    background: var(--xdh-color-background, #121212);
                    opacity: 0;
                    visibility: hidden;
                    pointer-events: none;
                }

                .fs-stage:fullscreen,
                .fs-stage:-webkit-full-screen {
                    opacity: 1;
                    visibility: visible;
                    pointer-events: auto;
                }

                .fs-media {
                    width: 100%;
                    height: 100%;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    overflow: hidden;
                }

                .fs-img,
                .fs-video {
                    display: block;
                    max-width: 100%;
                    max-height: 100%;
                    width: auto;
                    height: auto;
                    object-fit: contain;
                }

                .fs-img {
                    transition: none;
                    will-change: transform;
                    user-select: none;
                    -webkit-user-drag: none;
                    touch-action: none;
                }

                .fs-stage[data-can-pan="true"] .fs-img {
                    cursor: grab;
                }

                .fs-stage[data-panning="true"] .fs-img {
                    cursor: grabbing;
                }

                .fs-video {
                    background: var(--xdh-color-background, #121212);
                }

                .fs-stage[data-media-type="audio"] .fs-media {
                    align-items: center;
                }

                .fs-audio {
                    width: min(92vw, 720px);
                    max-width: 100%;
                }

                @media (max-width: 640px) {
                    .fs-stage {
                        padding: 16px;
                    }

                    .fs-audio {
                        width: 100%;
                    }
                }
            </style>

            <div class="fs-stage">
                <div class="fs-media"></div>
            </div>
        `;
    }
}

registerCustomElement("xdh-lightbox", XdhLightbox);
