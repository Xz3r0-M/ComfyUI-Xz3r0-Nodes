import {
    BaseElement,
    registerCustomElement,
} from "../core/base-element.js?v=20260403-2";
import { appStore } from "../core/store.js";
import {
    icon,
    ICON_CSS,
    SCROLLBAR_CSS,
    TOOLTIP_CSS,
} from "../core/icon.js";
import { t } from "../core/i18n.js?v=20260406-16";

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

function hasPreviewPayload(detail) {
    const mediaType = String(detail?.type || "image").toLowerCase();
    return mediaType === "text"
        ? typeof detail?.text === "string"
        : !!detail?.url;
}

function normalizeNavigationContext(value, currentDetail) {
    if (!value || typeof value !== "object") {
        return null;
    }

    const items = (Array.isArray(value.items) ? value.items : [])
        .map((item) => {
            const id = String(item?.id || "").trim();
            if (!id) {
                return null;
            }
            return {
                ...item,
                id,
                name: String(item?.name || ""),
            };
        })
        .filter(Boolean);

    if (!items.length) {
        return null;
    }

    const resolveById = typeof value.resolveById === "function"
        ? value.resolveById
        : (targetId) => {
            const normalizedId = String(targetId || "").trim();
            const entry = items.find((item) => item.id === normalizedId);
            return hasPreviewPayload(entry) ? entry : null;
        };

    const requestedId = String(
        value.activeId ?? currentDetail?.id ?? items[0]?.id ?? ""
    ).trim();
    const activeId = items.some((item) => item.id === requestedId)
        ? requestedId
        : items[0].id;

    return {
        items,
        resolveById,
        activeId,
    };
}

function findNavigationIndex(navigation, activeId) {
    if (!navigation || !Array.isArray(navigation.items)) {
        return -1;
    }
    return navigation.items.findIndex((item) => item.id === String(activeId));
}

function formatNavigationPosition(currentIndex, total) {
    const safeTotal = Math.max(1, Number(total) || 1);
    const safeIndex = Math.min(
        safeTotal,
        Math.max(1, Number(currentIndex) || 1)
    );
    return `${safeIndex} / ${safeTotal}`;
}

function readDetailTitle(detail) {
    const title = String(detail?.name || "").trim();
    return title || t("common.unknown");
}

function readElementInset(styles, property) {
    const value = Number.parseFloat(styles?.[property] || "0");
    return Number.isFinite(value) ? value : 0;
}

export class XdhLightbox extends BaseElement {
    constructor() {
        super();
        this._current = null;
        this._navigation = null;
        this._navigationIndex = -1;
        this._activeMedia = null;
        this._mainScrollSnapshot = null;
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
        this._onKeyDown = (event) => {
            const stage = this.$(".fs-stage");
            if (!stage || stage.dataset.active !== "true" || !this._navigation) {
                return;
            }
            if (event.defaultPrevented || event.altKey
                || event.ctrlKey || event.metaKey) {
                return;
            }
            const activeElement = document.activeElement;
            if (activeElement instanceof HTMLVideoElement
                || activeElement instanceof HTMLAudioElement) {
                return;
            }
            if (event.key === "ArrowLeft") {
                event.preventDefault();
                event.stopPropagation();
                void this._openNavigationByStep(-1);
                return;
            }
            if (event.key === "ArrowRight") {
                event.preventDefault();
                event.stopPropagation();
                void this._openNavigationByStep(1);
            }
        };
        this._onFullscreenChange = () => {
            const stage = this.$(".fs-stage");
            if (!stage || isStageFullscreen(stage)) {
                return;
            }
            this._teardown();
            this._restoreMainScrollPosition();
        };
    }

    _setNavigationContext(navigation, activeId = "") {
        if (!navigation) {
            this._navigation = null;
            this._navigationIndex = -1;
            return;
        }
        this._navigation = navigation;
        const nextIndex = findNavigationIndex(
            navigation,
            activeId || navigation.activeId
        );
        this._navigationIndex = nextIndex >= 0 ? nextIndex : 0;
    }

    _syncChrome() {
        const stage = this.$(".fs-stage");
        const titleEl = this.$(".fs-title");
        const counterEl = this.$(".fs-position");
        const prevBtn = this.$(".fs-prev-edge-btn");
        const nextBtn = this.$(".fs-next-edge-btn");
        const openBtn = this.$(".fs-open-btn");
        const closeBtn = this.$(".fs-close-btn");
        const hasCurrent = !!this._current;
        const total = this._navigation?.items?.length || (hasCurrent ? 1 : 0);
        const currentIndex = this._navigationIndex >= 0
            ? this._navigationIndex + 1
            : (hasCurrent ? 1 : 0);
        const title = hasCurrent ? readDetailTitle(this._current) : "";
        const position = hasCurrent
            ? formatNavigationPosition(currentIndex, total)
            : "";

        if (stage) {
            stage.dataset.active = hasCurrent ? "true" : "false";
        }
        if (titleEl) {
            titleEl.textContent = title;
            titleEl.dataset.tooltip = title;
        }
        if (counterEl) {
            counterEl.textContent = position;
            counterEl.dataset.tooltip = hasCurrent
                ? t("lightbox.position", {
                    current: currentIndex,
                    total,
                })
                : "";
        }
        if (prevBtn) {
            prevBtn.disabled = !this._navigation || this._navigationIndex <= 0;
        }
        if (nextBtn) {
            nextBtn.disabled = !this._navigation
                || this._navigationIndex >= total - 1;
        }
        if (openBtn) {
            openBtn.disabled = !hasCurrent;
        }
        if (closeBtn) {
            closeBtn.disabled = !hasCurrent;
        }
        this._syncThumbnailStrip();
    }

    _syncThumbnailStrip() {
        const stage = this.$(".fs-stage");
        const strip = this.$(".fs-thumb-strip");
        if (!stage || !(strip instanceof HTMLElement)) {
            return;
        }
        const navigation = this._navigation;
        const hasThumbnails = !!navigation
            && navigation.items.some((item) =>
                String(item?.thumbnailUrl || item?.url || "").trim()
            );
        stage.dataset.hasThumbnails = hasThumbnails ? "true" : "false";
        strip.replaceChildren();
        if (!hasThumbnails) {
            return;
        }

        navigation.items.forEach((item, index) => {
            const button = document.createElement("button");
            button.type = "button";
            button.className = "fs-thumb-btn xdh-tooltip xdh-tooltip-up";
            button.dataset.lightboxThumbIndex = String(index);
            if (index === this._navigationIndex) {
                button.classList.add("is-active");
            }

            const label = String(item?.name || "").trim() || t("common.unknown");
            button.dataset.tooltip = label;
            button.setAttribute("aria-label", label);

            const thumbUrl = String(
                item?.thumbnailUrl || item?.url || ""
            ).trim();
            if (thumbUrl) {
                const image = document.createElement("img");
                image.className = "fs-thumb-img";
                image.src = thumbUrl;
                image.alt = "";
                image.loading = "lazy";
                image.draggable = false;
                image.setAttribute("draggable", "false");
                button.appendChild(image);
            } else {
                const fallback = document.createElement("span");
                fallback.className = "fs-thumb-fallback";
                const iconName = item?.type === "video"
                    ? "video"
                    : item?.type === "audio"
                        ? "audio-lines"
                        : "file";
                fallback.innerHTML = icon(iconName, 18);
                button.appendChild(fallback);
            }

            strip.appendChild(button);
        });

        const activeThumb = strip.querySelector(".fs-thumb-btn.is-active");
        activeThumb?.scrollIntoView({
            block: "nearest",
            inline: "center",
        });
    }

    async _openNavigationByIndex(index) {
        const navigation = this._navigation;
        if (!navigation || !Array.isArray(navigation.items)) {
            return;
        }
        if (index < 0 || index >= navigation.items.length) {
            return;
        }
        const entry = navigation.items[index];
        const resolved = navigation.resolveById?.(entry.id);
        const detail = resolved && typeof resolved === "object"
            ? { ...resolved }
            : null;
        if (!detail) {
            return;
        }
        if (!detail.id) {
            detail.id = entry.id;
        }
        if (!detail.name) {
            detail.name = entry.name || "";
        }
        await this._showDetail(detail, navigation);
    }

    async _openNavigationByStep(step) {
        if (!Number.isFinite(step) || !step) {
            return;
        }
        await this._openNavigationByIndex(this._navigationIndex + step);
    }

    _captureMainScrollPosition() {
        const mainScroll = document.querySelector(".main-scroll");
        if (mainScroll instanceof HTMLElement) {
            this._mainScrollSnapshot = {
                kind: "element",
                top: mainScroll.scrollTop,
            };
            return;
        }

        const scrollingElement = document.scrollingElement;
        if (scrollingElement instanceof HTMLElement) {
            this._mainScrollSnapshot = {
                kind: "document",
                top: scrollingElement.scrollTop,
            };
            return;
        }

        this._mainScrollSnapshot = null;
    }

    _restoreMainScrollPosition() {
        const snapshot = this._mainScrollSnapshot;
        this._mainScrollSnapshot = null;
        if (!snapshot) {
            return;
        }

        const apply = () => {
            if (snapshot.kind === "element") {
                const mainScroll = document.querySelector(".main-scroll");
                if (mainScroll instanceof HTMLElement) {
                    mainScroll.scrollTop = snapshot.top;
                }
                return;
            }

            const scrollingElement = document.scrollingElement;
            if (scrollingElement instanceof HTMLElement) {
                scrollingElement.scrollTop = snapshot.top;
            }
        };

        apply();
        requestAnimationFrame(apply);
        requestAnimationFrame(() => requestAnimationFrame(apply));
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

    _getImageViewportRect() {
        const mediaHost = this.$(".fs-media");
        if (!(mediaHost instanceof HTMLElement)) {
            return null;
        }
        const rect = mediaHost.getBoundingClientRect();
        const styles = window.getComputedStyle(mediaHost);
        const insetLeft = readElementInset(styles, "paddingLeft");
        const insetRight = readElementInset(styles, "paddingRight");
        const insetTop = readElementInset(styles, "paddingTop");
        const insetBottom = readElementInset(styles, "paddingBottom");
        const width = Math.max(0, rect.width - insetLeft - insetRight);
        const height = Math.max(0, rect.height - insetTop - insetBottom);
        const left = rect.left + insetLeft;
        const top = rect.top + insetTop;
        return {
            left,
            top,
            width,
            height,
            centerX: left + (width / 2),
            centerY: top + (height / 2),
        };
    }

    _getImageBaseDisplaySize() {
        if (!(this._activeMedia instanceof HTMLImageElement)) {
            return null;
        }
        const viewport = this._getImageViewportRect();
        if (!viewport?.width || !viewport?.height) {
            return null;
        }
        const naturalWidth = Math.max(
            1,
            this._activeMedia.naturalWidth || this._activeMedia.width || 1
        );
        const naturalHeight = Math.max(
            1,
            this._activeMedia.naturalHeight || this._activeMedia.height || 1
        );
        const fitScale = Math.min(
            viewport.width / naturalWidth,
            viewport.height / naturalHeight,
            1
        );
        return {
            viewport,
            width: naturalWidth * fitScale,
            height: naturalHeight * fitScale,
        };
    }

    _getImageDisplayRect(scaleOverride = this._imageScale) {
        const base = this._getImageBaseDisplaySize();
        if (!base) {
            return null;
        }
        const scale = Math.min(
            IMAGE_ZOOM_MAX,
            Math.max(IMAGE_ZOOM_MIN, Number(scaleOverride) || IMAGE_ZOOM_MIN)
        );
        const width = base.width * scale;
        const height = base.height * scale;
        const centerX = base.viewport.centerX + this._imagePanX;
        const centerY = base.viewport.centerY + this._imagePanY;
        return {
            viewport: base.viewport,
            scale,
            width,
            height,
            centerX,
            centerY,
            left: centerX - (width / 2),
            top: centerY - (height / 2),
        };
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

        const imageRect = this._getImageDisplayRect();
        const viewport = imageRect?.viewport;
        if (!imageRect || !viewport?.width || !viewport?.height) {
            return;
        }

        const maxPanX = Math.max(0, (imageRect.width - viewport.width) / 2);
        const maxPanY = Math.max(0, (imageRect.height - viewport.height) / 2);

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
        this._applyImageZoom();
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

        const imageRect = this._getImageDisplayRect();
        const viewport = imageRect?.viewport;
        if (!imageRect || !viewport) {
            return;
        }

        const focusLocalPoint = {
            x: (clientX - imageRect.centerX) / imageRect.scale,
            y: (clientY - imageRect.centerY) / imageRect.scale,
        };

        const safeNextScale = Math.min(
            IMAGE_ZOOM_MAX,
            Math.max(IMAGE_ZOOM_MIN, nextScale)
        );
        if (Math.abs(safeNextScale - this._imageScale) < 1e-6) {
            return;
        }

        this._imageScale = safeNextScale;
        this._imagePanX = clientX - viewport.centerX
            - (focusLocalPoint.x * safeNextScale);
        this._imagePanY = clientY - viewport.centerY
            - (focusLocalPoint.y * safeNextScale);
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
        const factor = event.deltaY < 0
            ? 1.12
            : 0.88;
        const nextScale = this._imageScale * factor;
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
        document.addEventListener("keydown", this._onKeyDown, true);
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
        document.removeEventListener("keydown", this._onKeyDown, true);
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

        const root = this.shadowRoot;
        if (!root || root._xdhLightboxBound) {
            return;
        }
        root._xdhLightboxBound = true;
        root.addEventListener("click", (event) => {
            if (!(event.target instanceof Element)) {
                return;
            }
            const thumbBtn = event.target.closest("[data-lightbox-thumb-index]");
            if (thumbBtn) {
                const index = Number.parseInt(
                    thumbBtn.dataset.lightboxThumbIndex || "-1",
                    10
                );
                if (Number.isInteger(index) && index >= 0) {
                    void this._openNavigationByIndex(index);
                }
                return;
            }
            const actionBtn = event.target.closest("[data-lightbox-action]");
            if (!actionBtn) {
                return;
            }
            const action = String(actionBtn.dataset.lightboxAction || "");
            if (action === "prev") {
                void this._openNavigationByStep(-1);
                return;
            }
            if (action === "next") {
                void this._openNavigationByStep(1);
                return;
            }
            if (action === "open") {
                if (this._current) {
                    this._openInNewTab(this._current);
                }
                return;
            }
            if (action === "close") {
                this._close();
            }
        });
    }

    _buildMedia(detail, previewSettings) {
        const mediaType = String(detail?.type || "image").toLowerCase();

        if (mediaType === "text") {
            const shell = document.createElement("div");
            shell.className = "fs-text-shell xdh-scroll";

            const title = String(detail?.name || "").trim();
            if (title) {
                const titleSection = document.createElement("section");
                titleSection.className = "fs-text-section";

                const titleLabel = document.createElement("div");
                titleLabel.className = "fs-text-section-heading";
                titleLabel.textContent = t("history.section.extra_header");
                titleSection.appendChild(titleLabel);

                const titleNode = document.createElement("div");
                titleNode.className = "fs-text-title";
                titleNode.textContent = title;
                titleSection.appendChild(titleNode);
                shell.appendChild(titleSection);
            }

            const bodySection = document.createElement("section");
            bodySection.className = "fs-text-section";

            const bodyLabel = document.createElement("div");
            bodyLabel.className = "fs-text-section-heading";
            bodyLabel.textContent = t("history.section.content");
            bodySection.appendChild(bodyLabel);

            const body = document.createElement("pre");
            body.className = "fs-text-body";
            body.textContent = String(detail?.text || "");
            bodySection.appendChild(body);
            shell.appendChild(bodySection);

            return shell;
        }

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
        if (String(detail?.type || "").toLowerCase() === "text") {
            const blob = new Blob(
                [String(detail?.text || "")],
                { type: "text/plain;charset=utf-8" }
            );
            const blobUrl = URL.createObjectURL(blob);
            window.open(blobUrl, "_blank", "noopener,noreferrer");
            setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
            return;
        }
        window.open(detail.url, "_blank", "noopener,noreferrer");
    }

    async _showDetail(detail, navigation = null) {
        const mediaType = String(detail?.type || "image").toLowerCase();
        const isPreviewReady = hasPreviewPayload(detail);
        if (!isPreviewReady) {
            return;
        }

        const stage = this.$(".fs-stage");
        const mediaHost = this.$(".fs-media");
        const previewSettings = getPreviewSettings();
        if (!stage || !mediaHost) {
            return;
        }

        this._captureMainScrollPosition();
        const mediaNode = this._buildMedia(detail, previewSettings);
        this._teardown({ preserveCurrent: true, preserveNavigation: true });
        this._current = detail;
        this._setNavigationContext(navigation, detail?.id);
        mediaHost.replaceChildren(mediaNode);
        stage.dataset.mediaType = mediaType;
        this._activeMedia = mediaNode;
        this._resetImageZoom();
        this._syncChrome();

        if (isStageFullscreen(stage)) {
            this._startPlayback();
            return;
        }

        try {
            await requestElementFullscreen(stage);
            this._startPlayback();
        } catch {
            this._teardown({ preserveCurrent: true, preserveNavigation: true });
            this._restoreMainScrollPosition();
            this._openInNewTab(detail);
        }
    }

    async _open(detail) {
        const navigation = normalizeNavigationContext(detail?.navigation, detail);
        await this._showDetail(detail, navigation);
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
        if (!options.preserveNavigation) {
            this._navigation = null;
            this._navigationIndex = -1;
        }
        this._syncChrome();
    }

    _close() {
        const stage = this.$(".fs-stage");
        if (stage && isStageFullscreen(stage)) {
            exitElementFullscreen().catch(() => {
                this._teardown();
                this._restoreMainScrollPosition();
            });
            return;
        }
        this._teardown();
        this._restoreMainScrollPosition();
    }

    render() {
        return `
            <style>
                ${ICON_CSS}
                ${SCROLLBAR_CSS}
                ${TOOLTIP_CSS}
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
                    padding: 76px 12px 24px;
                    box-sizing: border-box;
                    overflow: hidden;
                }

                .fs-stage[data-has-thumbnails="true"] .fs-media {
                    padding-bottom: 112px;
                }

                .fs-top-bar {
                    position: absolute;
                    left: 16px;
                    right: 16px;
                    top: 16px;
                    display: grid;
                    grid-template-columns: 1fr minmax(0, auto) 1fr;
                    gap: 12px;
                    align-items: start;
                    opacity: 0;
                    transform: translateY(-14px);
                    transition:
                        transform 0.22s cubic-bezier(0.4, 0, 0.2, 1),
                        opacity 0.18s ease;
                    pointer-events: none;
                }

                .fs-stage[data-active="true"] .fs-top-bar {
                    opacity: 1;
                    transform: translateY(0);
                    pointer-events: none;
                }

                .fs-top-spacer {
                    min-width: 0;
                }

                .fs-title-box {
                    min-width: 0;
                    max-width: min(72vw, 920px);
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    gap: 4px;
                    justify-self: center;
                    padding: 10px 14px;
                    border: 1px solid var(--xdh-color-border, #2e2e2e);
                    border-radius: 14px;
                    background: color-mix(
                        in srgb,
                        var(--xdh-color-surface-1, #1a1a1a) 94%,
                        transparent
                    );
                    box-shadow: 0 10px 32px rgba(0, 0, 0, 0.45);
                    backdrop-filter: blur(10px);
                    -webkit-backdrop-filter: blur(10px);
                    pointer-events: auto;
                }

                .fs-title,
                .fs-position {
                    min-width: 0;
                    max-width: 100%;
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                }

                .fs-title {
                    font-size: 13px;
                    line-height: 1.35;
                    font-weight: 600;
                    color: var(--xdh-color-text-primary, #f0f0f0);
                }

                .fs-position {
                    font-size: 12px;
                    line-height: 1.3;
                    color: var(--xdh-color-text-secondary, #999);
                    font-variant-numeric: tabular-nums;
                    font-family: ui-monospace, "Cascadia Mono", "Consolas",
                        monospace;
                }

                .fs-top-actions {
                    justify-self: end;
                    display: inline-flex;
                    align-items: center;
                    gap: 8px;
                    pointer-events: auto;
                }

                .fs-side-btn {
                    position: absolute;
                    top: 50%;
                    width: 48px;
                    height: 84px;
                    padding: 0;
                    border: 1px solid var(--xdh-color-border, #2e2e2e);
                    background: color-mix(
                        in srgb,
                        var(--xdh-color-surface-1, #1a1a1a) 94%,
                        transparent
                    );
                    color: var(--xdh-color-text-primary, #f0f0f0);
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    box-shadow: 0 10px 32px rgba(0, 0, 0, 0.45);
                    backdrop-filter: blur(10px);
                    -webkit-backdrop-filter: blur(10px);
                    opacity: 0;
                    transition:
                        transform 0.22s cubic-bezier(0.4, 0, 0.2, 1),
                        opacity 0.18s ease,
                        background 0.15s ease,
                        border-color 0.15s ease;
                    pointer-events: none;
                }

                .fs-prev-edge-btn {
                    left: 0;
                    transform: translate(-12px, -50%);
                    border-left: 0;
                    border-radius: 0 14px 14px 0;
                }

                .fs-next-edge-btn {
                    right: 0;
                    transform: translate(12px, -50%);
                    border-right: 0;
                    border-radius: 14px 0 0 14px;
                }

                .fs-stage[data-active="true"] .fs-side-btn {
                    opacity: 1;
                    pointer-events: auto;
                }

                .fs-stage[data-active="true"] .fs-prev-edge-btn {
                    transform: translate(0, -50%);
                }

                .fs-stage[data-active="true"] .fs-next-edge-btn {
                    transform: translate(0, -50%);
                }

                .fs-bottom-bar {
                    position: absolute;
                    left: 16px;
                    right: 16px;
                    bottom: 16px;
                    display: flex;
                    align-items: center;
                    padding: 10px 12px;
                    border: 1px solid var(--xdh-color-border, #2e2e2e);
                    border-radius: 16px;
                    background: color-mix(
                        in srgb,
                        var(--xdh-color-surface-1, #1a1a1a) 94%,
                        transparent
                    );
                    box-shadow: 0 10px 32px rgba(0, 0, 0, 0.45);
                    backdrop-filter: blur(10px);
                    -webkit-backdrop-filter: blur(10px);
                    opacity: 0;
                    transform: translateY(16px);
                    transition:
                        transform 0.22s cubic-bezier(0.4, 0, 0.2, 1),
                        opacity 0.18s ease;
                    pointer-events: none;
                }

                .fs-stage[data-active="true"] .fs-bottom-bar {
                    opacity: 1;
                    transform: translateY(0);
                    pointer-events: auto;
                }

                .fs-stage[data-has-thumbnails="false"] .fs-bottom-bar {
                    opacity: 0;
                    transform: translateY(16px);
                    pointer-events: none;
                }

                .fs-thumb-strip {
                    width: 100%;
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    overflow-x: auto;
                    overflow-y: hidden;
                    padding: 2px 0;
                }

                .fs-thumb-btn {
                    width: 64px;
                    height: 64px;
                    padding: 0;
                    border: 1px solid var(--xdh-color-border, #2e2e2e);
                    border-radius: 10px;
                    background: var(--xdh-color-surface-2, #2a2a2a);
                    color: var(--xdh-color-text-primary, #f0f0f0);
                    overflow: hidden;
                    flex: 0 0 auto;
                    transition:
                        transform 0.15s ease,
                        border-color 0.15s ease,
                        box-shadow 0.15s ease,
                        opacity 0.15s ease;
                }

                .fs-thumb-btn:hover {
                    transform: translateY(-1px);
                }

                .fs-thumb-btn.is-active {
                    border-color: var(--xdh-brand-pink, #ea005e);
                    box-shadow: 0 0 0 1px var(--xdh-brand-pink, #ea005e);
                }

                .fs-action-btn {
                    width: 36px;
                    height: 36px;
                    padding: 0;
                    border: 1px solid var(--xdh-color-border, #2e2e2e);
                    border-radius: 10px;
                    background: var(--xdh-color-surface-2, #2a2a2a);
                    color: var(--xdh-color-text-primary, #f0f0f0);
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    transition:
                        background 0.15s ease,
                        border-color 0.15s ease,
                        color 0.15s ease,
                        transform 0.15s ease;
                }

                .fs-side-btn:hover,
                .fs-action-btn:hover {
                    background: var(--xdh-color-hover, #2a2a2a);
                    border-color: color-mix(
                        in srgb,
                        var(--xdh-brand-pink, #ea005e) 60%,
                        var(--xdh-color-border, #2e2e2e)
                    );
                    transform: translateY(-1px);
                }

                .fs-side-btn:disabled,
                .fs-thumb-btn:disabled,
                .fs-action-btn:disabled {
                    opacity: 0.42;
                    cursor: not-allowed;
                    transform: none;
                }

                .fs-thumb-img,
                .fs-thumb-fallback {
                    width: 100%;
                    height: 100%;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                }

                .fs-thumb-img {
                    object-fit: cover;
                }

                .fs-thumb-fallback {
                    background: var(--xdh-color-surface-2, #2a2a2a);
                    color: var(--xdh-color-text-secondary, #999);
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

                .fs-stage[data-media-type="text"] .fs-media {
                    align-items: center;
                    justify-content: center;
                }

                .fs-text-shell {
                    width: min(92vw, 1120px);
                    max-width: 100%;
                    height: min(88vh, 820px);
                    max-height: 100%;
                    padding: 18px 20px;
                    border-radius: 16px;
                    border: 1px solid var(--xdh-color-border, #2e2e2e);
                    background: var(--xdh-color-surface-1, #1a1a1a);
                    box-shadow: 0 10px 32px rgba(0, 0, 0, 0.45);
                    display: flex;
                    flex-direction: column;
                    gap: 12px;
                    overflow-x: auto;
                    overflow-y: scroll;
                }

                .fs-text-section {
                    display: flex;
                    flex-direction: column;
                    gap: 10px;
                }

                .fs-text-section-heading {
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    gap: 10px;
                    min-width: 0;
                    font-size: 15px;
                    line-height: 1.3;
                    font-weight: 700;
                    color: var(--xdh-color-text-primary, #f0f0f0);
                    letter-spacing: 0.03em;
                    text-align: center;
                }

                .fs-text-section-heading::before,
                .fs-text-section-heading::after {
                    content: "";
                    flex: 1 1 auto;
                    min-width: 24px;
                    height: 1px;
                    background: color-mix(
                        in srgb,
                        var(--xdh-color-border, #2e2e2e) 92%,
                        transparent
                    );
                }

                .fs-text-title {
                    margin: 0;
                    font-size: 16px;
                    line-height: 1.4;
                    font-weight: 400;
                    color: var(--xdh-color-text-primary, #f0f0f0);
                    text-align: left;
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    flex: 0 0 auto;
                }

                .fs-text-body {
                    margin: 0;
                    color: var(--xdh-color-text-primary, #f0f0f0);
                    font-size: 14px;
                    line-height: 1.65;
                    white-space: pre-wrap;
                    word-break: break-word;
                    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco,
                        Consolas, "Liberation Mono", monospace;
                }

                .fs-audio {
                    width: min(92vw, 720px);
                    max-width: 100%;
                }

                @media (max-width: 640px) {
                    .fs-stage {
                        padding: 16px;
                    }

                    .fs-media {
                        padding: 72px 0 24px;
                    }

                    .fs-stage[data-has-thumbnails="true"] .fs-media {
                        padding-bottom: 100px;
                    }

                    .fs-top-bar {
                        left: 12px;
                        right: 12px;
                        top: 12px;
                        gap: 8px;
                    }

                    .fs-bottom-bar {
                        left: 12px;
                        right: 12px;
                        bottom: 12px;
                        padding: 8px 10px;
                    }

                    .fs-title-box {
                        max-width: min(70vw, 720px);
                        padding: 8px 10px;
                    }

                    .fs-title {
                        font-size: 12px;
                    }

                    .fs-thumb-btn {
                        width: 56px;
                        height: 56px;
                    }

                    .fs-side-btn {
                        width: 42px;
                        height: 72px;
                    }

                    .fs-audio {
                        width: 100%;
                    }
                }
            </style>

            <div class="fs-stage">
                <div class="fs-top-bar">
                    <div class="fs-top-spacer"></div>
                    <div class="fs-title-box">
                        <div class="fs-title xdh-tooltip xdh-tooltip-down"
                             data-tooltip=""></div>
                        <div class="fs-position xdh-tooltip xdh-tooltip-down"
                             data-tooltip=""></div>
                    </div>
                    <div class="fs-top-actions">
                        <button class="fs-action-btn fs-open-btn xdh-tooltip xdh-tooltip-down"
                                type="button"
                                data-lightbox-action="open"
                                data-tooltip="${t("lightbox.open_external")}"
                                aria-label="${t("lightbox.open_external")}">
                            ${icon("link-2", 16)}
                        </button>
                        <button class="fs-action-btn fs-close-btn xdh-tooltip xdh-tooltip-down"
                                type="button"
                                data-lightbox-action="close"
                                data-tooltip="${t("lightbox.close") }"
                                aria-label="${t("lightbox.close")}">
                            ${icon("x", 16)}
                        </button>
                    </div>
                </div>
                <button class="fs-side-btn fs-prev-edge-btn xdh-tooltip"
                        type="button"
                        data-lightbox-action="prev"
                        data-tooltip="${t("lightbox.prev")}"
                        aria-label="${t("lightbox.prev")}">
                    ${icon("arrow-left", 18)}
                </button>
                <button class="fs-side-btn fs-next-edge-btn xdh-tooltip xdh-tooltip-left"
                        type="button"
                        data-lightbox-action="next"
                        data-tooltip="${t("lightbox.next")}"
                        aria-label="${t("lightbox.next")}">
                    ${icon("arrow-right", 18)}
                </button>
                <div class="fs-media"></div>
                <div class="fs-bottom-bar">
                    <div class="fs-thumb-strip xdh-scroll"></div>
                </div>
            </div>
        `;
    }
}

registerCustomElement("xdh-lightbox", XdhLightbox);
