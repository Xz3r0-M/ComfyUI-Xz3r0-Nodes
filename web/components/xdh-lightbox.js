import {
    BaseElement,
    registerCustomElement,
} from "../core/base-element.js?v=20260408-2";
import { appStore } from "../core/store.js";
import {
    icon,
    ICON_CSS,
    SCROLLBAR_CSS,
    TOOLTIP_CSS,
} from "../core/icon.js";
import { t } from "../core/i18n.js?v=20260407-3";

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
const AUDIO_WAVEFORM_BAR_COUNT = 180;
const AUDIO_WAVEFORM_CACHE = new Map();
const AUDIO_VOLUME_NORMAL_PERCENT = 100;
const AUDIO_VOLUME_MAX_PERCENT = 300;

let sharedAudioDecodeContext = null;
let sharedAudioPlaybackContext = null;

function clamp(value, min, max) {
    const safeValue = Number.isFinite(value) ? value : min;
    return Math.min(max, Math.max(min, safeValue));
}

function formatMediaTime(value) {
    const totalSeconds = Math.max(
        0,
        Math.floor(Number.isFinite(value) ? value : 0)
    );
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    if (hours > 0) {
        return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
    }
    return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function hashText(value) {
    let hash = 2166136261;
    for (const char of String(value || "")) {
        hash ^= char.charCodeAt(0);
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
}

function buildFallbackWaveformPeaks(seedText, count = AUDIO_WAVEFORM_BAR_COUNT) {
    let seed = hashText(seedText) || 1;
    return Array.from({ length: count }, (_, index) => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        const noise = ((seed >>> 8) & 0xffff) / 0xffff;
        const envelope = 0.42 + (Math.sin((index / count) * Math.PI * 3.5) * 0.18);
        return clamp((noise * 0.55) + envelope, 0.12, 1);
    });
}

function normalizeWaveformPeaks(audioBuffer, barCount = AUDIO_WAVEFORM_BAR_COUNT) {
    const totalFrames = Math.max(1, audioBuffer?.length || 0);
    const totalChannels = Math.max(1, audioBuffer?.numberOfChannels || 1);
    const sampleSize = Math.max(1, Math.floor(totalFrames / barCount));
    const peaks = new Array(barCount).fill(0);

    for (let index = 0; index < barCount; index += 1) {
        const start = index * sampleSize;
        const end = Math.min(totalFrames, start + sampleSize);
        const stride = Math.max(1, Math.floor((end - start) / 32));
        let peak = 0;

        for (let channel = 0; channel < totalChannels; channel += 1) {
            const data = audioBuffer.getChannelData(channel);
            for (let cursor = start; cursor < end; cursor += stride) {
                peak = Math.max(peak, Math.abs(data[cursor] || 0));
            }
            if (end > start) {
                peak = Math.max(peak, Math.abs(data[end - 1] || 0));
            }
        }

        peaks[index] = peak;
    }

    const maxPeak = peaks.reduce(
        (maxValue, value) => Math.max(maxValue, value),
        0
    );
    if (maxPeak <= 1e-6) {
        return buildFallbackWaveformPeaks("");
    }
    return peaks.map((value) => clamp(value / maxPeak, 0.08, 1));
}

function getAudioDecodeContext() {
    if (sharedAudioDecodeContext) {
        return sharedAudioDecodeContext;
    }
    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextCtor) {
        return null;
    }
    sharedAudioDecodeContext = new AudioContextCtor();
    return sharedAudioDecodeContext;
}

function getAudioPlaybackContext() {
    if (sharedAudioPlaybackContext) {
        return sharedAudioPlaybackContext;
    }
    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextCtor) {
        return null;
    }
    sharedAudioPlaybackContext = new AudioContextCtor();
    return sharedAudioPlaybackContext;
}

async function loadAudioWaveformPeaks(url) {
    const key = String(url || "").trim();
    if (!key) {
        return buildFallbackWaveformPeaks("empty");
    }
    const cached = AUDIO_WAVEFORM_CACHE.get(key);
    if (cached) {
        return cached;
    }

    const task = (async () => {
        try {
            const response = await fetch(key, { credentials: "same-origin" });
            if (!response.ok) {
                throw new Error(`audio-waveform-fetch-${response.status}`);
            }
            const arrayBuffer = await response.arrayBuffer();
            const audioContext = getAudioDecodeContext();
            if (!audioContext) {
                throw new Error("audio-context-unavailable");
            }
            const decoded = await audioContext.decodeAudioData(arrayBuffer.slice(0));
            return normalizeWaveformPeaks(decoded);
        } catch {
            return buildFallbackWaveformPeaks(key);
        }
    })();

    AUDIO_WAVEFORM_CACHE.set(key, task);
    return task;
}

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
        this._dimension = "";
        this._audioState = null;
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
            const shadowActiveElement = this.shadowRoot?.activeElement;
            if (activeElement instanceof HTMLVideoElement
                || activeElement instanceof HTMLAudioElement) {
                return;
            }
            if (shadowActiveElement instanceof HTMLElement
                && shadowActiveElement.closest(".fs-audio-shell")) {
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
        const titleEl = this.$(".fs-panel-title");
        const counterEl = this.$(".fs-panel-counter");
        const dimensionEl = this.$(".fs-dimension");
        const bottomPanel = this.$(".fs-bottom-panel");
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
        if (dimensionEl) {
            dimensionEl.textContent = this._dimension || "";
        }
        if (bottomPanel) {
            const hasNav = !!this._navigation && this._navigation.items.length > 1;
            bottomPanel.dataset.hasNav = hasNav ? "true" : "false";
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
        this._syncBottomNav();
    }

    _syncBottomNav() {
        const navContainer = this.$(".fs-bottom-nav");
        if (!navContainer) {
            return;
        }
        const hasNav = !!this._navigation && this._navigation.items.length > 1;
        if (!hasNav) {
            navContainer.innerHTML = "";
            return;
        }
        const activeId = this._current?.id;
        const items = this._navigation.items;
        navContainer.innerHTML = items.map((item, index) => {
            const isActive = item.id === activeId;
            const isAudio = item.type === "audio";
            const thumbUrl = item.thumbnailUrl || "";
            return this._renderBottomNavItem(item, index, isActive, isAudio, thumbUrl);
        }).join("");
        this._scrollBottomNavToActive();
    }

    _renderBottomNavItem(item, index, isActive, isAudio, thumbUrl) {
        const safeId = String(item.id || "").replace(/"/g, "&quot;");
        const safeName = String(item.name || "").replace(/</g, "&lt;").replace(/>/g, "&gt;");
        const activeClass = isActive ? "is-active" : "";
        const isText = item.type === "text";
        if (isAudio) {
            return `
                <button class="fs-nav-item ${activeClass}" type="button"
                        data-nav-index="${index}" data-nav-id="${safeId}"
                        title="${safeName}">
                    <div class="fs-nav-thumb audio-thumb">
                        <span class="audio-icon">${icon("audio-lines", 24)}</span>
                    </div>
                    <div class="fs-nav-name">${safeName}</div>
                </button>`;
        }
        if (isText) {
            return `
                <button class="fs-nav-item ${activeClass}" type="button"
                        data-nav-index="${index}" data-nav-id="${safeId}"
                        title="${safeName}">
                    <div class="fs-nav-thumb text-thumb">
                        <span class="text-icon">${icon("file", 24)}</span>
                    </div>
                    <div class="fs-nav-name">${safeName}</div>
                </button>`;
        }
        const hasThumb = thumbUrl.length > 0;
        const thumbHtml = hasThumb
            ? `<img class="fs-nav-img" src="${thumbUrl.replace(/"/g, "&quot;")}" alt="" loading="lazy" />`
            : "";
        const fallbackHtml = !hasThumb
            ? `<div class="fs-nav-fallback">${icon("image-off", 20)}</div>`
            : "";
        return `
            <button class="fs-nav-item ${activeClass}" type="button"
                    data-nav-index="${index}" data-nav-id="${safeId}"
                    title="${safeName}">
                <div class="fs-nav-thumb ${!hasThumb ? "thumb-empty" : ""}">
                    ${thumbHtml}
                    ${fallbackHtml}
                </div>
                <div class="fs-nav-name">${safeName}</div>
            </button>`;
    }

    _onBottomNavClick(event) {
        const item = event.target.closest(".fs-nav-item");
        if (!item) {
            return;
        }
        const indexAttr = item.dataset.navIndex;
        const index = Number(indexAttr);
        if (Number.isFinite(index)) {
            void this._openNavigationByIndex(index);
        }
    }

    _scrollBottomNavToActive() {
        const navContainer = this.$(".fs-bottom-nav");
        if (!navContainer) {
            return;
        }
        requestAnimationFrame(() => {
            const activeItem = navContainer.querySelector(".fs-nav-item.is-active");
            if (!activeItem) {
                return;
            }
            const containerRect = navContainer.getBoundingClientRect();
            const itemRect = activeItem.getBoundingClientRect();
            const scrollLeft = navContainer.scrollLeft;
            const relativeLeft = itemRect.left - containerRect.left;
            const relativeRight = itemRect.right - containerRect.right;
            const leftOverflow = relativeLeft - 8;
            const rightOverflow = relativeRight + 8 - containerRect.width;
            if (leftOverflow < 0) {
                navContainer.scrollTo({
                    left: scrollLeft + leftOverflow,
                    behavior: "smooth",
                });
            } else if (rightOverflow > 0) {
                navContainer.scrollTo({
                    left: scrollLeft + rightOverflow,
                    behavior: "smooth",
                });
            }
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

    _getPlayableMediaElement() {
        if (this._activeMedia instanceof HTMLVideoElement
            || this._activeMedia instanceof HTMLAudioElement) {
            return this._activeMedia;
        }
        const nestedMedia = this._activeMedia?.__xdhPlayableMedia;
        if (nestedMedia instanceof HTMLVideoElement
            || nestedMedia instanceof HTMLAudioElement) {
            return nestedMedia;
        }
        return null;
    }

    _cancelAudioAnimationFrame(state) {
        if (!state?.rafId) {
            return;
        }
        cancelAnimationFrame(state.rafId);
        state.rafId = 0;
    }

    _scheduleAudioAnimationFrame(state) {
        if (!state || state.disposed || state.rafId) {
            return;
        }
        state.rafId = requestAnimationFrame(() => {
            state.rafId = 0;
            if (state.disposed) {
                return;
            }
            this._syncAudioState(state);
        });
    }

    _drawAudioWaveform(state) {
        const canvas = state?.canvas;
        const waveform = state?.waveform;
        if (!(canvas instanceof HTMLCanvasElement)
            || !(waveform instanceof HTMLElement)) {
            return;
        }

        const width = Math.max(0, Math.floor(waveform.clientWidth));
        const height = Math.max(0, Math.floor(waveform.clientHeight));
        if (!width || !height) {
            return;
        }

        const dpr = Math.max(1, window.devicePixelRatio || 1);
        const pixelWidth = Math.floor(width * dpr);
        const pixelHeight = Math.floor(height * dpr);
        if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
            canvas.width = pixelWidth;
            canvas.height = pixelHeight;
        }

        const ctx = canvas.getContext("2d");
        if (!ctx) {
            return;
        }
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.scale(dpr, dpr);
        ctx.clearRect(0, 0, width, height);

        // 根据主题获取颜色
        const isLightTheme = document.body.dataset.theme === "light";
        const playedColor = isLightTheme ? "#171717" : "#ffffff";
        const idleColor = isLightTheme ? "rgba(0, 0, 0, 0.15)" : "rgba(255, 255, 255, 0.25)";
        const playheadColor = isLightTheme ? "#171717" : "#ffffff";

        const peaks = Array.isArray(state.peaks) && state.peaks.length
            ? state.peaks
            : buildFallbackWaveformPeaks(state.audio?.src || "");
        const progress = clamp(state.progress || 0, 0, 1);
        const gap = width <= 420 ? 1 : 2;
        const targetCount = Math.max(36, Math.min(peaks.length, Math.floor(width / 4)));
        const barWidth = Math.max(
            2,
            Math.floor((width - (gap * Math.max(targetCount - 1, 0))) / targetCount)
        );
        const totalWidth = (targetCount * barWidth)
            + (Math.max(targetCount - 1, 0) * gap);
        const startX = Math.floor((width - totalWidth) / 2);
        const sourceStride = peaks.length / targetCount;

        for (let index = 0; index < targetCount; index += 1) {
            const sourceStart = Math.floor(index * sourceStride);
            const sourceEnd = Math.max(
                sourceStart + 1,
                Math.floor((index + 1) * sourceStride)
            );
            let peak = 0;
            for (let cursor = sourceStart; cursor < sourceEnd; cursor += 1) {
                peak = Math.max(peak, peaks[cursor] || 0);
            }
            const barHeight = Math.max(6, Math.round((height - 12) * peak));
            const x = startX + (index * (barWidth + gap));
            const y = Math.floor((height - barHeight) / 2);
            const threshold = (index + 1) / targetCount;
            ctx.fillStyle = threshold <= progress ? playedColor : idleColor;
            ctx.fillRect(x, y, barWidth, barHeight);
        }

        if (progress > 0 && progress < 1) {
            const playheadX = clamp(
                Math.floor(width * progress),
                0,
                Math.max(width - 2, 0)
            );
            ctx.fillStyle = playheadColor;
            ctx.fillRect(playheadX, 4, 2, Math.max(height - 8, 0));
        }
    }

    _syncAudioState(state) {
        if (!state || state.disposed) {
            return;
        }
        const audio = state.audio;
        const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
        const currentTime = duration > 0
            ? clamp(audio.currentTime, 0, duration)
            : Math.max(0, Number(audio.currentTime) || 0);
        const isPlaying = !audio.paused && !audio.ended;
        const playLabel = isPlaying
            ? t("lightbox.audio_pause")
            : t("lightbox.audio_play");
        const maxOutputLevel = Math.max(
            AUDIO_VOLUME_NORMAL_PERCENT,
            Number(state.maxOutputLevel) || AUDIO_VOLUME_NORMAL_PERCENT
        );
        const volumePercent = Math.round(clamp(
            Number(state.outputLevel),
            0,
            maxOutputLevel
        ));
        const isMuted = volumePercent <= 0;
        const volumeLabel = isMuted
            ? t("lightbox.audio_unmute")
            : t("lightbox.audio_mute");
        const volumeText = t("lightbox.audio_volume", {
            value: volumePercent,
        });

        state.progress = duration > 0
            ? clamp(currentTime / duration, 0, 1)
            : 0;
        state.currentTimeEl.textContent = formatMediaTime(currentTime);
        state.durationEl.textContent = formatMediaTime(duration);
        state.playBtn.dataset.audioPlaying = isPlaying ? "true" : "false";
        state.playBtn.dataset.tooltip = playLabel;
        state.playBtn.setAttribute("aria-label", playLabel);
        state.playBtn.innerHTML = icon(isPlaying ? "pause" : "play", 20);
        state.volumeBtn.dataset.audioMuted = isMuted ? "true" : "false";
        state.volumeBtn.dataset.tooltip = volumeLabel;
        state.volumeBtn.setAttribute("aria-label", volumeLabel);
        state.volumeBtn.innerHTML = icon(
            isMuted ? "volume-x" : "volume-2",
            18
        );
        state.volumeRange.value = String(volumePercent);
        state.volumeRange.dataset.tooltip = volumeText;
        state.volumeRange.setAttribute("aria-label", volumeText);
        state.volumeRange.style.setProperty(
            "--fs-audio-volume-progress",
            `${(volumePercent / maxOutputLevel) * 100}%`
        );
        state.volumeValueEl.textContent = `${volumePercent}%`;
        state.volumeValueEl.dataset.tooltip = volumeText;
        state.volumeValueEl.setAttribute("aria-label", volumeText);
        state.waveform.dataset.loading = state.loading ? "true" : "false";
        this._drawAudioWaveform(state);

        if (isPlaying) {
            this._scheduleAudioAnimationFrame(state);
        } else {
            this._cancelAudioAnimationFrame(state);
        }
    }

    _seekAudioToClientPosition(state, clientX) {
        if (!state || state.disposed) {
            return;
        }
        const rect = state.waveform.getBoundingClientRect();
        const duration = Number.isFinite(state.audio.duration)
            ? state.audio.duration
            : 0;
        if (!rect.width || duration <= 0) {
            return;
        }
        const ratio = clamp((clientX - rect.left) / rect.width, 0, 1);
        state.audio.currentTime = duration * ratio;
        this._syncAudioState(state);
    }

    _destroyAudioState(state) {
        if (!state) {
            return;
        }
        state.disposed = true;
        this._cancelAudioAnimationFrame(state);
        state.resizeObserver?.disconnect?.();
        state.audioGraph?.sourceNode?.disconnect?.();
        state.audioGraph?.gainNode?.disconnect?.();
    }

    _resumeAudioPlaybackGraph(state) {
        const audioContext = state?.audioGraph?.audioContext;
        if (!audioContext || audioContext.state !== "suspended") {
            return;
        }
        audioContext.resume().catch(() => {});
    }

    _applyAudioOutputLevel(state, volumePercent) {
        if (!state || state.disposed) {
            return;
        }
        const maxOutputLevel = Math.max(
            AUDIO_VOLUME_NORMAL_PERCENT,
            Number(state.maxOutputLevel) || AUDIO_VOLUME_NORMAL_PERCENT
        );
        const nextPercent = Math.round(clamp(
            Number(volumePercent) || 0,
            0,
            maxOutputLevel
        ));
        const limitedPercent = Math.min(
            nextPercent,
            AUDIO_VOLUME_NORMAL_PERCENT
        );
        const gainValue = nextPercent > AUDIO_VOLUME_NORMAL_PERCENT
            ? nextPercent / AUDIO_VOLUME_NORMAL_PERCENT
            : 1;

        state.audio.volume = limitedPercent / AUDIO_VOLUME_NORMAL_PERCENT;
        state.audio.muted = nextPercent <= 0;
        if (state.audioGraph?.gainNode) {
            state.audioGraph.gainNode.gain.value = gainValue;
        }
        state.outputLevel = nextPercent;
        if (nextPercent > 0) {
            state.lastVolume = nextPercent;
        }
    }

    async _loadAudioWaveform(state, url) {
        if (!state || state.disposed) {
            return;
        }
        state.loading = true;
        this._syncAudioState(state);
        const peaks = await loadAudioWaveformPeaks(url);
        if (state.disposed) {
            return;
        }
        state.peaks = peaks;
        state.loading = false;
        this._syncAudioState(state);
    }

    _buildAudioMedia(detail, previewSettings) {
        const shell = document.createElement("div");
        shell.className = "fs-audio-shell";

        const panel = document.createElement("div");
        panel.className = "fs-audio-panel";
        panel.setAttribute("aria-label", t("lightbox.audio"));

        const transport = document.createElement("div");
        transport.className = "fs-audio-transport";

        const playBtn = document.createElement("button");
        playBtn.type = "button";
        playBtn.className = "fs-audio-play-btn xdh-tooltip xdh-tooltip-up";
        playBtn.dataset.audioPlaying = "false";
        playBtn.dataset.tooltip = t("lightbox.audio_play");
        playBtn.setAttribute("aria-label", t("lightbox.audio_play"));
        playBtn.innerHTML = icon("play", 20);

        const timeline = document.createElement("div");
        timeline.className = "fs-audio-timeline";

        const volumeGroup = document.createElement("div");
        volumeGroup.className = "fs-audio-volume-group";

        const volumeBtn = document.createElement("button");
        volumeBtn.type = "button";
        volumeBtn.className = "fs-audio-volume-btn xdh-tooltip xdh-tooltip-up";
        volumeBtn.dataset.audioMuted = previewSettings.audioMuted
            ? "true"
            : "false";
        volumeBtn.dataset.tooltip = previewSettings.audioMuted
            ? t("lightbox.audio_unmute")
            : t("lightbox.audio_mute");
        volumeBtn.setAttribute("aria-label", volumeBtn.dataset.tooltip);
        volumeBtn.innerHTML = icon(
            previewSettings.audioMuted ? "volume-x" : "volume-2",
            18
        );

        const volumeRange = document.createElement("input");
        volumeRange.type = "range";
        volumeRange.className = "fs-audio-volume-range xdh-tooltip xdh-tooltip-up";
        volumeRange.min = "0";
        volumeRange.max = String(AUDIO_VOLUME_MAX_PERCENT);
        volumeRange.step = "1";
        volumeRange.value = previewSettings.audioMuted
            ? "0"
            : String(AUDIO_VOLUME_NORMAL_PERCENT);
        volumeRange.dataset.tooltip = t("lightbox.audio_volume", {
            value: Number(volumeRange.value),
        });
        volumeRange.setAttribute("aria-label", volumeRange.dataset.tooltip);
        volumeRange.style.setProperty(
            "--fs-audio-volume-progress",
            `${(Number(volumeRange.value) / AUDIO_VOLUME_MAX_PERCENT) * 100}%`
        );

        const volumeValue = document.createElement("span");
        volumeValue.className = "fs-audio-volume-value xdh-tooltip xdh-tooltip-up";
        volumeValue.textContent = `${volumeRange.value}%`;
        volumeValue.dataset.tooltip = t("lightbox.audio_volume", {
            value: Number(volumeRange.value),
        });
        volumeValue.setAttribute("aria-label", volumeValue.dataset.tooltip);

        const waveform = document.createElement("button");
        waveform.type = "button";
        waveform.className = "fs-audio-waveform xdh-tooltip xdh-tooltip-up";
        waveform.dataset.tooltip = t("lightbox.audio_seek");
        waveform.dataset.loading = "true";
        waveform.setAttribute("aria-label", t("lightbox.audio_seek"));

        const canvas = document.createElement("canvas");
        canvas.className = "fs-audio-waveform-canvas";
        waveform.appendChild(canvas);

        const meta = document.createElement("div");
        meta.className = "fs-audio-meta";

        const currentTime = document.createElement("span");
        currentTime.className = "fs-audio-time is-current";
        currentTime.textContent = "0:00";

        const duration = document.createElement("span");
        duration.className = "fs-audio-time is-duration";
        duration.textContent = "0:00";

        meta.appendChild(currentTime);
        meta.appendChild(duration);
        timeline.appendChild(waveform);
        timeline.appendChild(meta);
        transport.appendChild(playBtn);
        transport.appendChild(timeline);
        volumeGroup.appendChild(volumeBtn);
        volumeGroup.appendChild(volumeRange);
        volumeGroup.appendChild(volumeValue);
        transport.appendChild(volumeGroup);
        panel.appendChild(transport);
        shell.appendChild(panel);

        const audio = document.createElement("audio");
        audio.src = detail.url;
        audio.preload = "metadata";
        audio.autoplay = previewSettings.audioAutoplay;
        audio.muted = previewSettings.audioMuted;
        audio.loop = previewSettings.audioLoop;
        audio.controls = false;
        audio.className = "fs-audio";
        audio.setAttribute("aria-hidden", "true");
        shell.appendChild(audio);
        shell.__xdhPlayableMedia = audio;

        const audioGraph = (() => {
            const audioContext = getAudioPlaybackContext();
            if (!audioContext
                || typeof audioContext.createMediaElementSource !== "function"
                || typeof audioContext.createGain !== "function") {
                return null;
            }
            try {
                const sourceNode = audioContext.createMediaElementSource(audio);
                const gainNode = audioContext.createGain();
                sourceNode.connect(gainNode);
                gainNode.connect(audioContext.destination);
                return {
                    audioContext,
                    sourceNode,
                    gainNode,
                };
            } catch {
                return null;
            }
        })();
        const maxOutputLevel = audioGraph
            ? AUDIO_VOLUME_MAX_PERCENT
            : AUDIO_VOLUME_NORMAL_PERCENT;
        volumeRange.max = String(maxOutputLevel);
        volumeRange.value = previewSettings.audioMuted
            ? "0"
            : String(AUDIO_VOLUME_NORMAL_PERCENT);
        volumeRange.style.setProperty(
            "--fs-audio-volume-progress",
            `${(Number(volumeRange.value) / maxOutputLevel) * 100}%`
        );

        const state = {
            shell,
            audio,
            audioGraph,
            playBtn,
            volumeBtn,
            volumeRange,
            volumeValueEl: volumeValue,
            waveform,
            canvas,
            currentTimeEl: currentTime,
            durationEl: duration,
            peaks: buildFallbackWaveformPeaks(detail.url),
            progress: 0,
            loading: true,
            disposed: false,
            rafId: 0,
            resizeObserver: null,
            maxOutputLevel,
            outputLevel: previewSettings.audioMuted
                ? 0
                : AUDIO_VOLUME_NORMAL_PERCENT,
            lastVolume: AUDIO_VOLUME_NORMAL_PERCENT,
        };

        this._applyAudioOutputLevel(state, state.outputLevel);

        playBtn.addEventListener("click", () => {
            this._resumeAudioPlaybackGraph(state);
            if (audio.paused || audio.ended) {
                audio.play().catch(() => {});
            } else {
                audio.pause();
            }
        });
        volumeBtn.addEventListener("click", () => {
            if (audio.muted || (state.outputLevel || 0) <= 0) {
                this._applyAudioOutputLevel(
                    state,
                    state.lastVolume || AUDIO_VOLUME_NORMAL_PERCENT
                );
                this._resumeAudioPlaybackGraph(state);
            } else {
                this._applyAudioOutputLevel(state, 0);
            }
            this._syncAudioState(state);
        });
        volumeRange.addEventListener("input", () => {
            const nextVolume = clamp(
                Number(volumeRange.value),
                0,
                maxOutputLevel
            );
            this._applyAudioOutputLevel(state, nextVolume);
            if (nextVolume > 0) {
                this._resumeAudioPlaybackGraph(state);
            }
            this._syncAudioState(state);
        });
        waveform.addEventListener("click", (event) => {
            this._seekAudioToClientPosition(state, event.clientX);
        });
        waveform.addEventListener("keydown", (event) => {
            const durationValue = Number.isFinite(audio.duration)
                ? audio.duration
                : 0;
            if (!durationValue) {
                return;
            }
            if (event.key === "ArrowLeft") {
                event.preventDefault();
                audio.currentTime = clamp(audio.currentTime - 5, 0, durationValue);
                this._syncAudioState(state);
                return;
            }
            if (event.key === "ArrowRight") {
                event.preventDefault();
                audio.currentTime = clamp(audio.currentTime + 5, 0, durationValue);
                this._syncAudioState(state);
                return;
            }
            if (event.key === "Home") {
                event.preventDefault();
                audio.currentTime = 0;
                this._syncAudioState(state);
                return;
            }
            if (event.key === "End") {
                event.preventDefault();
                audio.currentTime = durationValue;
                this._syncAudioState(state);
            }
        });

        for (const eventName of [
            "loadedmetadata",
            "durationchange",
            "timeupdate",
            "seeking",
            "seeked",
            "play",
            "pause",
            "ended",
            "volumechange",
        ]) {
            audio.addEventListener(eventName, () => {
                this._syncAudioState(state);
            });
        }

        if (typeof ResizeObserver === "function") {
            state.resizeObserver = new ResizeObserver(() => {
                this._drawAudioWaveform(state);
            });
            state.resizeObserver.observe(waveform);
        }

        shell.__xdhAudioState = state;
        void this._loadAudioWaveform(state, detail.url);
        this._syncAudioState(state);
        return shell;
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
        const stage = this.$(".fs-stage");
        if (!stage || !isStageFullscreen(stage)) {
            return;
        }

        // 检查鼠标是否在底部导航栏上
        const bottomNav = this.$(".fs-bottom-nav");
        if (bottomNav) {
            const navRect = bottomNav.getBoundingClientRect();
            const isOverNav = (
                event.clientX >= navRect.left &&
                event.clientX <= navRect.right &&
                event.clientY >= navRect.top &&
                event.clientY <= navRect.bottom
            );
            if (isOverNav) {
                // 在导航栏上时，横向滚动导航栏
                event.preventDefault();
                const scrollAmount = event.deltaY || event.deltaX;
                bottomNav.scrollLeft += scrollAmount;
                return;
            }
        }

        // 不在导航栏上时，执行图片缩放
        if (!(this._activeMedia instanceof HTMLImageElement)) {
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
        const target = event.target;
        if (target instanceof Element) {
            const isInteractive = target.closest(
                'button, [data-lightbox-action], .fs-top-actions, .fs-side-btn, .fs-bottom-nav'
            );
            if (isInteractive) {
                return;
            }
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
            const actionBtn = event.target.closest("[data-lightbox-action]");
            if (actionBtn) {
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
                return;
            }
            const navItem = event.target.closest(".fs-nav-item");
            if (navItem) {
                this._onBottomNavClick(event);
            }
        });
    }

    _buildMedia(detail, previewSettings) {
        const mediaType = String(detail?.type || "image").toLowerCase();

        if (mediaType === "text") {
            const shell = document.createElement("div");
            shell.className = "fs-text-shell xdh-scroll";
            shell.setAttribute("aria-label", t("lightbox.text"));

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
            video.setAttribute("aria-label", t("lightbox.video"));
            return video;
        }

        if (mediaType === "audio") {
            return this._buildAudioMedia(detail, previewSettings);
        }

        const image = document.createElement("img");
        image.src = detail.url;
        image.alt = detail.name || "";
        image.className = "fs-img";
        image.setAttribute("aria-label", detail.name || t("lightbox.image"));
        return image;
    }

    _probeDimension(mediaNode, mediaType) {
        if (!mediaNode) {
            return;
        }
        if (mediaNode instanceof HTMLImageElement) {
            if (mediaNode.complete && mediaNode.naturalWidth > 0) {
                this._dimension = `${mediaNode.naturalWidth} × ${mediaNode.naturalHeight}`;
                return;
            }
            mediaNode.addEventListener("load", () => {
                if (mediaNode !== this._activeMedia) return;
                this._dimension = `${mediaNode.naturalWidth} × ${mediaNode.naturalHeight}`;
                this._syncChrome();
            }, { once: true });
            return;
        }
        if (mediaNode instanceof HTMLVideoElement) {
            mediaNode.addEventListener("loadedmetadata", () => {
                if (mediaNode !== this._activeMedia) return;
                const w = mediaNode.videoWidth;
                const h = mediaNode.videoHeight;
                if (w > 0 && h > 0) {
                    this._dimension = `${w} × ${h}`;
                    this._syncChrome();
                }
            }, { once: true });
            return;
        }
    }

    _startPlayback() {
        const playableMedia = this._getPlayableMediaElement();
        if (!(playableMedia instanceof HTMLVideoElement)
            && !(playableMedia instanceof HTMLAudioElement)) {
            return;
        }
        if (!playableMedia.autoplay) {
            return;
        }
        queueMicrotask(() => {
            if (playableMedia instanceof HTMLAudioElement) {
                this._resumeAudioPlaybackGraph(this._audioState);
            }
            playableMedia.play?.().catch(() => {});
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
        this._audioState = mediaNode?.__xdhAudioState || null;
        this._resetImageZoom();
        this._syncAudioState(this._audioState);
        this._probeDimension(mediaNode, mediaType);
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
        const playableMedia = this._getPlayableMediaElement();
        if (playableMedia instanceof HTMLVideoElement
            || playableMedia instanceof HTMLAudioElement) {
            playableMedia.pause();
        }
        this._destroyAudioState(this._audioState);
        this._audioState = null;
        this._resetImageZoom();
        this._activeMedia = null;
        this._dimension = "";
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

                /* ============================================
                   Vercel Design System - Theme Variables
                   ============================================ */
                :host {
                    /* Dark Theme (Default) */
                    --lb-bg: rgba(10, 10, 10, 0.5);
                    --lb-surface: #111111;
                    --lb-surface-elevated: #1a1a1a;
                    --lb-text-primary: #ededed;
                    --lb-text-secondary: #a0a0a0;
                    --lb-text-tertiary: #808080;
                    --lb-border: rgba(255, 255, 255, 0.1);
                    --lb-border-light: rgba(255, 255, 255, 0.06);
                    --lb-shadow-ring: rgba(255, 255, 255, 0.1) 0px 0px 0px 1px;
                    --lb-shadow-card: rgba(255, 255, 255, 0.1) 0px 0px 0px 1px, rgba(0, 0, 0, 0.2) 0px 2px 2px 0px, rgba(255, 255, 255, 0.03) 0px 0px 0px 1px;
                    --lb-btn-bg: rgba(255, 255, 255, 0.08);
                    --lb-btn-bg-hover: rgba(255, 255, 255, 0.14);
                    --lb-btn-bg-active: rgba(255, 255, 255, 0.2);
                    --lb-thumb-bg: rgba(255, 255, 255, 0.08);
                    --lb-waveform-bg: rgba(255, 255, 255, 0.05);
                    --lb-focus: hsl(212, 100%, 48%);
                    --lb-audio-gradient-start: rgba(100, 120, 180, 0.3);
                    --lb-audio-gradient-mid: rgba(80, 100, 160, 0.2);
                    --lb-audio-gradient-end: rgba(60, 90, 140, 0.3);
                }

                :host-context(body[data-theme="light"]) {
                    /* Light Theme */
                    --lb-bg: rgba(255, 255, 255, 0.5);
                    --lb-surface: #fafafa;
                    --lb-surface-elevated: #ffffff;
                    --lb-text-primary: #171717;
                    --lb-text-secondary: #4d4d4d;
                    --lb-text-tertiary: #666666;
                    --lb-border: rgba(0, 0, 0, 0.08);
                    --lb-border-light: rgba(0, 0, 0, 0.04);
                    --lb-shadow-ring: rgba(0, 0, 0, 0.08) 0px 0px 0px 1px;
                    --lb-shadow-card: rgba(0, 0, 0, 0.08) 0px 0px 0px 1px, rgba(0, 0, 0, 0.04) 0px 2px 2px 0px, rgb(250, 250, 250) 0px 0px 0px 1px;
                    --lb-btn-bg: rgba(0, 0, 0, 0.04);
                    --lb-btn-bg-hover: rgba(0, 0, 0, 0.08);
                    --lb-btn-bg-active: rgba(0, 0, 0, 0.12);
                    --lb-thumb-bg: rgba(0, 0, 0, 0.04);
                    --lb-waveform-bg: rgba(0, 0, 0, 0.03);
                    --lb-focus: hsl(212, 100%, 48%);
                    --lb-audio-gradient-start: rgba(100, 120, 200, 0.15);
                    --lb-audio-gradient-mid: rgba(80, 100, 180, 0.1);
                    --lb-audio-gradient-end: rgba(60, 90, 160, 0.15);
                }

                /* ============================================
                   Base Stage
                   ============================================ */
                .fs-stage {
                    position: fixed;
                    inset: 0;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    padding: 24px;
                    background: var(--lb-bg);
                    opacity: 0;
                    visibility: hidden;
                    pointer-events: none;
                    z-index: 999999;
                }

                .fs-stage:fullscreen,
                .fs-stage:-webkit-full-screen {
                    opacity: 1;
                    visibility: visible;
                    pointer-events: auto;
                    overflow: hidden;
                }

                .fs-media {
                    width: 100%;
                    height: 100%;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    padding: 103px 16px 155px;
                    box-sizing: border-box;
                    overflow: hidden;
                    z-index: 1;
                }

                /* ============================================
                   Top Right Actions - Close & Open buttons
                   ============================================ */
                .fs-top-actions {
                    position: absolute;
                    top: 16px;
                    right: 16px;
                    display: inline-flex;
                    align-items: center;
                    gap: 8px;
                    z-index: 10;
                    opacity: 0;
                    transform: translateY(-14px);
                    transition:
                        transform 0.28s cubic-bezier(0.4, 0, 0.2, 1),
                        opacity 0.22s ease;
                    pointer-events: none;
                }

                .fs-stage[data-active="true"] .fs-top-actions {
                    opacity: 1;
                    transform: translateY(0);
                    pointer-events: auto;
                }



                /* ============================================
                   Action Buttons - Solid Circular (Vercel Style)
                   ============================================ */
                .fs-action-btn {
                    width: 36px;
                    height: 36px;
                    padding: 0;
                    border: none;
                    border-radius: 50%;
                    background: var(--lb-surface-elevated);
                    color: var(--lb-text-primary);
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    box-shadow: var(--lb-shadow-ring);
                    cursor: pointer;
                    transition:
                        background 0.15s ease,
                        transform 0.15s ease,
                        box-shadow 0.15s ease;
                    flex-shrink: 0;
                }

                .fs-action-btn:hover {
                    background: var(--lb-surface);
                    transform: scale(1.05);
                    box-shadow:
                        var(--lb-shadow-ring),
                        0 2px 8px rgba(0, 0, 0, 0.08);
                }

                :host-context(body[data-theme="light"]) .fs-action-btn:hover {
                    box-shadow:
                        var(--lb-shadow-ring),
                        0 2px 8px rgba(0, 0, 0, 0.06);
                }

                .fs-action-btn:focus-visible {
                    outline: 2px solid var(--lb-focus);
                    outline-offset: 2px;
                }

                .fs-action-btn:disabled {
                    opacity: 0.32;
                    cursor: not-allowed;
                    transform: none;
                }

                /* ============================================
                   Side Navigation Buttons - Solid Background (Vercel Style)
                   ============================================ */
                .fs-side-btn {
                    position: absolute;
                    top: 50%;
                    width: 48px;
                    height: 48px;
                    padding: 0;
                    border: none;
                    border-radius: 50%;
                    background: var(--lb-surface-elevated);
                    color: var(--lb-text-primary);
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    box-shadow:
                        var(--lb-shadow-ring),
                        0 2px 8px rgba(0, 0, 0, 0.08);
                    opacity: 0;
                    transform: translateY(-50%) scale(0.9);
                    transition:
                        transform 0.24s cubic-bezier(0.4, 0, 0.2, 1),
                        opacity 0.2s ease,
                        background 0.15s ease;
                    pointer-events: none;
                    z-index: 10;
                    cursor: pointer;
                }

                :host-context(body[data-theme="light"]) .fs-side-btn {
                    box-shadow:
                        var(--lb-shadow-ring),
                        0 2px 8px rgba(0, 0, 0, 0.06);
                }

                .fs-prev-edge-btn {
                    left: 16px;
                }

                .fs-next-edge-btn {
                    right: 16px;
                }

                .fs-stage[data-active="true"] .fs-side-btn {
                    opacity: 1;
                    pointer-events: auto;
                    transform: translateY(-50%) scale(1);
                }

                .fs-side-btn:hover {
                    background: var(--lb-btn-bg-hover);
                    transform: translateY(-50%) scale(1.08);
                }

                .fs-side-btn:focus-visible {
                    outline: 2px solid var(--lb-focus);
                    outline-offset: 2px;
                }

                .fs-side-btn:disabled {
                    opacity: 0.24;
                    cursor: not-allowed;
                    transform: translateY(-50%) scale(1);
                }

                /* ============================================
                   Media Elements
                   ============================================ */
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
                    background: var(--lb-surface);
                    border-radius: 8px;
                    box-shadow: var(--lb-shadow-card);
                }

                .fs-stage[data-media-type="audio"] .fs-media {
                    align-items: center;
                }

                .fs-stage[data-media-type="text"] .fs-media {
                    align-items: center;
                    justify-content: center;
                }

                /* ============================================
                   Text Content Panel
                   ============================================ */
                .fs-text-shell {
                    width: min(92vw, 1120px);
                    max-width: 100%;
                    height: min(88vh, 820px);
                    max-height: 100%;
                    padding: 24px;
                    border-radius: 12px;
                    background: var(--lb-surface-elevated);
                    box-shadow: var(--lb-shadow-card);
                    display: flex;
                    flex-direction: column;
                    gap: 16px;
                    overflow-x: auto;
                    overflow-y: scroll;
                    /* Shadow-as-border */
                    box-shadow:
                        var(--lb-shadow-ring),
                        rgba(0, 0, 0, 0.04) 0px 2px 2px 0px,
                        rgba(0, 0, 0, 0.04) 0px 8px 8px -8px;
                }

                :host-context(body[data-theme="light"]) .fs-text-shell {
                    box-shadow:
                        var(--lb-shadow-ring),
                        rgba(0, 0, 0, 0.04) 0px 2px 2px 0px,
                        rgba(0, 0, 0, 0.04) 0px 8px 8px -8px,
                        rgb(250, 250, 250) 0px 0px 0px 1px;
                }

                .fs-text-section {
                    display: flex;
                    flex-direction: column;
                    gap: 12px;
                }

                .fs-text-section-heading {
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    gap: 10px;
                    min-width: 0;
                    font-size: 12px;
                    line-height: 1.3;
                    font-weight: 500;
                    color: var(--lb-text-tertiary);
                    letter-spacing: 0.03em;
                    text-align: center;
                    font-family: 'Geist Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
                    text-transform: uppercase;
                }

                .fs-text-section-heading::before,
                .fs-text-section-heading::after {
                    content: "";
                    flex: 1 1 auto;
                    min-width: 24px;
                    height: 1px;
                    background: var(--lb-border);
                }

                .fs-text-title {
                    margin: 0;
                    font-size: 16px;
                    line-height: 1.4;
                    font-weight: 500;
                    color: var(--lb-text-primary);
                    text-align: left;
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    flex: 0 0 auto;
                    letter-spacing: -0.32px;
                }

                .fs-text-body {
                    margin: 0;
                    color: var(--lb-text-secondary);
                    font-size: 14px;
                    line-height: 1.65;
                    white-space: pre-wrap;
                    word-break: break-word;
                    font-family: 'Geist Mono', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
                }

                /* ============================================
                   Audio Player (Vercel Style)
                   ============================================ */
                .fs-audio-shell {
                    width: min(92vw, 720px);
                    max-width: 100%;
                }

                .fs-audio-panel {
                    padding: 24px;
                    border-radius: 16px;
                    background: var(--lb-surface-elevated);
                    box-shadow:
                        var(--lb-shadow-ring),
                        rgba(0, 0, 0, 0.04) 0px 2px 2px 0px,
                        rgba(0, 0, 0, 0.04) 0px 8px 8px -8px;
                }

                :host-context(body[data-theme="light"]) .fs-audio-panel {
                    box-shadow:
                        var(--lb-shadow-ring),
                        rgba(0, 0, 0, 0.04) 0px 2px 2px 0px,
                        rgba(0, 0, 0, 0.04) 0px 8px 8px -8px,
                        rgb(250, 250, 250) 0px 0px 0px 1px;
                }

                .fs-audio-transport {
                    display: flex;
                    align-items: center;
                    gap: 16px;
                }

                .fs-audio-play-btn,
                .fs-audio-volume-btn {
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    padding: 0;
                    border: none;
                    background: var(--lb-surface-elevated);
                    color: var(--lb-text-primary);
                    box-shadow: var(--lb-shadow-ring);
                    flex: 0 0 auto;
                    cursor: pointer;
                    transition:
                        background 0.15s ease,
                        transform 0.15s ease,
                        box-shadow 0.15s ease;
                }

                .fs-audio-play-btn {
                    width: 52px;
                    height: 52px;
                    border-radius: 50%;
                }

                .fs-audio-volume-btn {
                    width: 40px;
                    height: 40px;
                    border-radius: 50%;
                }

                .fs-audio-play-btn:hover,
                .fs-audio-volume-btn:hover {
                    background: var(--lb-surface);
                    transform: scale(1.05);
                    box-shadow:
                        var(--lb-shadow-ring),
                        0 2px 8px rgba(0, 0, 0, 0.08);
                }

                :host-context(body[data-theme="light"]) .fs-audio-play-btn:hover,
                :host-context(body[data-theme="light"]) .fs-audio-volume-btn:hover {
                    box-shadow:
                        var(--lb-shadow-ring),
                        0 2px 8px rgba(0, 0, 0, 0.06);
                }

                .fs-audio-play-btn:focus-visible,
                .fs-audio-volume-btn:focus-visible {
                    outline: 2px solid var(--lb-focus);
                    outline-offset: 2px;
                }

                .fs-audio-play-btn .xdh-icon,
                .fs-audio-volume-btn .xdh-icon {
                    pointer-events: none;
                }

                .fs-audio-volume-btn[data-audio-muted="true"] {
                    color: var(--lb-text-tertiary);
                }

                .fs-audio-volume-group {
                    display: flex;
                    align-items: center;
                    gap: 10px;
                    flex: 0 0 auto;
                    min-width: 0;
                }

                .fs-audio-volume-range {
                    width: 100px;
                    min-width: 0;
                    margin: 0;
                    padding: 0;
                    appearance: none;
                    background: transparent;
                    cursor: pointer;
                }

                .fs-audio-volume-range:focus-visible {
                    outline: 2px solid var(--lb-focus);
                    outline-offset: 2px;
                }

                .fs-audio-volume-range::-webkit-slider-runnable-track {
                    height: 4px;
                    border-radius: 999px;
                    background: linear-gradient(
                        90deg,
                        var(--lb-text-primary) 0%,
                        var(--lb-text-primary) var(--fs-audio-volume-progress, 100%),
                        var(--lb-border) var(--fs-audio-volume-progress, 100%),
                        var(--lb-border) 100%
                    );
                }

                .fs-audio-volume-range::-webkit-slider-thumb {
                    appearance: none;
                    width: 14px;
                    height: 14px;
                    margin-top: -5px;
                    border: 2px solid var(--lb-bg);
                    border-radius: 50%;
                    background: var(--lb-text-primary);
                    cursor: pointer;
                }

                .fs-audio-volume-range::-moz-range-track {
                    height: 4px;
                    border: 0;
                    border-radius: 999px;
                    background: var(--lb-border);
                }

                .fs-audio-volume-range::-moz-range-progress {
                    height: 4px;
                    border-radius: 999px;
                    background: var(--lb-text-primary);
                }

                .fs-audio-volume-range::-moz-range-thumb {
                    width: 14px;
                    height: 14px;
                    border: 2px solid var(--lb-bg);
                    border-radius: 50%;
                    background: var(--lb-text-primary);
                    cursor: pointer;
                }

                .fs-audio-volume-value {
                    min-width: 40px;
                    color: var(--lb-text-tertiary);
                    font-size: 11px;
                    line-height: 1.3;
                    text-align: right;
                    font-variant-numeric: tabular-nums;
                    font-family: 'Geist Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
                }

                .fs-audio-timeline {
                    min-width: 0;
                    flex: 1 1 auto;
                    display: flex;
                    flex-direction: column;
                    gap: 10px;
                }

                .fs-audio-waveform {
                    position: relative;
                    width: 100%;
                    height: 100px;
                    padding: 0;
                    border: none;
                    border-radius: 12px;
                    background: var(--lb-waveform-bg);
                    overflow: hidden;
                    cursor: pointer;
                }

                .fs-audio-waveform::after {
                    content: "";
                    position: absolute;
                    inset: 0;
                    opacity: 0;
                    pointer-events: none;
                    background: linear-gradient(
                        90deg,
                        transparent 0%,
                        var(--lb-border) 50%,
                        transparent 100%
                    );
                    transform: translateX(-100%);
                }

                .fs-audio-waveform[data-loading="true"]::after {
                    opacity: 1;
                    animation: fs-audio-wave-sheen 1.2s linear infinite;
                }

                .fs-audio-waveform-canvas {
                    width: 100%;
                    height: 100%;
                    display: block;
                }

                .fs-audio-meta {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    gap: 12px;
                    padding: 0 4px;
                }

                .fs-audio-time {
                    font-size: 11px;
                    line-height: 1.3;
                    color: var(--lb-text-tertiary);
                    font-variant-numeric: tabular-nums;
                    font-family: 'Geist Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
                }

                .fs-audio {
                    position: absolute;
                    width: 1px;
                    height: 1px;
                    opacity: 0;
                    pointer-events: none;
                    inset: auto;
                    left: -9999px;
                    top: 0;
                }

                @keyframes fs-audio-wave-sheen {
                    from { transform: translateX(-100%); }
                    to { transform: translateX(100%); }
                }

                /* ============================================
                   Bottom Panel - Navigation with Title & Counter
                   ============================================ */
                .fs-bottom-panel {
                    position: absolute;
                    left: 50%;
                    bottom: 16px;
                    transform: translateX(-50%) translateY(14px);
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    gap: 8px;
                    max-width: min(92vw, 1080px);
                    padding: 12px 16px;
                    border-radius: 12px;
                    background: var(--lb-surface-elevated);
                    box-shadow:
                        var(--lb-shadow-ring),
                        0 4px 16px rgba(0, 0, 0, 0.08);
                    opacity: 0;
                    visibility: hidden;
                    pointer-events: none;
                    transition:
                        transform 0.28s cubic-bezier(0.4, 0, 0.2, 1),
                        opacity 0.24s cubic-bezier(0.4, 0, 0.2, 1),
                        visibility 0.24s ease;
                    z-index: 10;
                }

                :host-context(body[data-theme="light"]) .fs-bottom-panel {
                    box-shadow:
                        var(--lb-shadow-ring),
                        0 4px 16px rgba(0, 0, 0, 0.06);
                }

                .fs-stage[data-active="true"] .fs-bottom-panel {
                    opacity: 1;
                    visibility: visible;
                    pointer-events: auto;
                    transform: translateX(-50%) translateY(0);
                }

                .fs-bottom-panel[data-has-nav="false"] {
                    padding: 10px 16px;
                }

                /* Panel Header - Dimension + Title + Counter */
                .fs-panel-header {
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    gap: 12px;
                    width: 100%;
                }

                .fs-dimension {
                    flex-shrink: 0;
                    padding: 4px 10px;
                    border-radius: 6px;
                    background: var(--lb-surface);
                    box-shadow: var(--lb-shadow-ring);
                    font-size: 12px;
                    font-weight: 500;
                    color: var(--lb-text-secondary);
                    font-variant-numeric: tabular-nums;
                    font-family: 'Geist Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
                    white-space: nowrap;
                }

                .fs-dimension:empty {
                    display: none;
                }

                .fs-panel-title {
                    flex: 1;
                    min-width: 0;
                    font-size: 14px;
                    font-weight: 500;
                    color: var(--lb-text-primary);
                    letter-spacing: -0.14px;
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    text-align: center;
                }

                .fs-panel-counter {
                    flex-shrink: 0;
                    padding: 4px 10px;
                    border-radius: 6px;
                    background: var(--lb-surface);
                    box-shadow: var(--lb-shadow-ring);
                    font-size: 12px;
                    font-weight: 500;
                    color: var(--lb-text-secondary);
                    font-variant-numeric: tabular-nums;
                    font-family: 'Geist Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
                    white-space: nowrap;
                }

                /* Navigation Strip */
                .fs-bottom-nav {
                    display: flex;
                    align-items: center;
                    gap: 4px;
                    max-width: 100%;
                    padding: 4px;
                    overflow-x: auto;
                    overflow-y: hidden;
                    scrollbar-width: thin;
                    scrollbar-color: var(--lb-border) transparent;
                }

                .fs-bottom-nav::-webkit-scrollbar {
                    height: 4px;
                }

                .fs-bottom-nav::-webkit-scrollbar-track {
                    background: transparent;
                    border-radius: 2px;
                }

                .fs-bottom-nav::-webkit-scrollbar-thumb {
                    background: var(--lb-border);
                    border-radius: 2px;
                }

                .fs-bottom-nav::-webkit-scrollbar-thumb:hover {
                    background: var(--lb-text-tertiary);
                }

                .fs-bottom-panel[data-has-nav="false"] .fs-bottom-nav {
                    display: none;
                }

                .fs-nav-item {
                    flex: 0 0 auto;
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    gap: 4px;
                    width: 64px;
                    padding: 5px 4px 6px;
                    border: 1px solid transparent;
                    border-radius: 12px;
                    background: transparent;
                    cursor: pointer;
                    transition:
                        background 0.15s ease,
                        border-color 0.15s ease,
                        transform 0.15s ease;
                }

                .fs-nav-item:hover {
                    background: var(--lb-btn-bg);
                }

                .fs-nav-item:focus-visible {
                    outline: 2px solid var(--lb-focus);
                    outline-offset: 2px;
                }

                .fs-nav-item.is-active {
                    background: var(--lb-btn-bg-hover);
                    border-color: var(--lb-border);
                }

                .fs-nav-thumb {
                    width: 48px;
                    height: 48px;
                    border-radius: 8px;
                    overflow: hidden;
                    background: var(--lb-thumb-bg);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    position: relative;
                    /* Shadow-as-border */
                    box-shadow: var(--lb-shadow-ring);
                }

                .fs-nav-img {
                    width: 100%;
                    height: 100%;
                    object-fit: cover;
                    display: block;
                }

                .fs-nav-fallback {
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    color: var(--lb-text-tertiary);
                }

                .fs-nav-thumb.thumb-empty .fs-nav-fallback {
                    display: flex;
                }

                .fs-nav-thumb.audio-thumb {
                    background: linear-gradient(
                        135deg,
                        var(--lb-audio-gradient-start) 0%,
                        var(--lb-audio-gradient-mid) 50%,
                        var(--lb-audio-gradient-end) 100%
                    );
                }

                .fs-nav-thumb .audio-icon {
                    color: var(--lb-text-secondary);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                }

                .fs-nav-thumb.text-thumb {
                    background: linear-gradient(
                        135deg,
                        rgba(120, 130, 150, 0.22) 0%,
                        rgba(100, 110, 140, 0.14) 50%,
                        rgba(80, 90, 130, 0.22) 100%
                    );
                }

                .fs-nav-thumb .text-icon {
                    color: var(--lb-text-secondary);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                }

                .fs-nav-name {
                    width: 100%;
                    font-size: 9px;
                    line-height: 1.2;
                    color: var(--lb-text-tertiary);
                    text-align: center;
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    letter-spacing: -0.1px;
                }

                .fs-nav-item.is-active .fs-nav-name {
                    color: var(--lb-text-primary);
                }

                /* ============================================
                   Responsive
                   ============================================ */
                @media (max-width: 640px) {
                    .fs-stage {
                        padding: 12px;
                    }

                    .fs-media {
                        padding: 72px 8px 120px;
                    }

                    .fs-top-actions {
                        top: 12px;
                        right: 12px;
                        gap: 6px;
                    }

                    .fs-bottom-panel {
                        bottom: 12px;
                        padding: 10px 12px;
                        gap: 6px;
                    }

                    .fs-bottom-panel[data-has-nav="false"] {
                        padding: 8px 12px;
                    }

                    .fs-panel-header {
                        gap: 8px;
                    }

                    .fs-panel-title {
                        font-size: 13px;
                    }

                    .fs-panel-counter {
                        padding: 3px 8px;
                        font-size: 11px;
                    }

                    .fs-action-btn {
                        width: 32px;
                        height: 32px;
                    }

                    .fs-side-btn {
                        width: 40px;
                        height: 40px;
                    }

                    .fs-prev-edge-btn {
                        left: 8px;
                    }

                    .fs-next-edge-btn {
                        right: 8px;
                    }

                    .fs-bottom-nav {
                        bottom: 10px;
                        padding: 6px 10px;
                        gap: 4px;
                    }

                    .fs-nav-item {
                        width: 52px;
                        padding: 4px 3px;
                    }

                    .fs-nav-thumb {
                        width: 40px;
                        height: 40px;
                        border-radius: 6px;
                    }

                    .fs-nav-name {
                        font-size: 8px;
                    }

                    .fs-audio-shell {
                        width: 100%;
                    }

                    .fs-audio-panel {
                        padding: 16px;
                        border-radius: 12px;
                    }

                    .fs-audio-transport {
                        flex-wrap: wrap;
                        align-items: flex-start;
                        gap: 10px;
                    }

                    .fs-audio-play-btn {
                        width: 44px;
                        height: 44px;
                    }

                    .fs-audio-volume-btn {
                        width: 36px;
                        height: 36px;
                    }

                    .fs-audio-timeline {
                        order: 3;
                        flex-basis: 100%;
                    }

                    .fs-audio-volume-group {
                        margin-left: auto;
                        gap: 8px;
                    }

                    .fs-audio-volume-range {
                        width: min(40vw, 128px);
                    }

                    .fs-audio-volume-value {
                        min-width: 40px;
                    }

                    .fs-audio-waveform {
                        height: 96px;
                        border-radius: 8px;
                    }

                    .fs-text-shell {
                        padding: 16px;
                        border-radius: 8px;
                    }
                }
            </style>

            <div class="fs-stage">
                <!-- Top Right: Open & Close buttons -->
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

                <!-- Side Navigation buttons -->
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

                <!-- Main Media Area -->
                <div class="fs-media"></div>

                <!-- Bottom Panel: Dimension + Title + Counter + Navigation -->
                <div class="fs-bottom-panel" data-has-nav="false">
                    <div class="fs-panel-header">
                        <div class="fs-dimension"></div>
                        <div class="fs-panel-title xdh-tooltip xdh-tooltip-up" data-tooltip=""></div>
                        <div class="fs-panel-counter xdh-tooltip xdh-tooltip-up" data-tooltip=""></div>
                    </div>
                    <div class="fs-bottom-nav"></div>
                </div>
            </div>
        `;
    }
}

registerCustomElement("xdh-lightbox", XdhLightbox);
