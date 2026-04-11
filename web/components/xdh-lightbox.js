import {
    BaseElement,
    registerCustomElement,
} from "../core/base-element.js?v=20260407-1";
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

        const styles = window.getComputedStyle(state.shell);
        const playedColor = styles.getPropertyValue("--xdh-brand-pink").trim()
            || "#ea005e";
        const idleColor = styles.getPropertyValue("--xdh-color-border").trim()
            || "#2e2e2e";
        const playheadColor = styles.getPropertyValue("--xdh-color-text-primary").trim()
            || "#f0f0f0";
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
        panel.className = "fs-audio-panel xdh-tooltip xdh-tooltip-up";
        panel.dataset.tooltip = t("lightbox.audio_hint");
        panel.setAttribute("aria-label", t("lightbox.audio_hint"));

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
            shell.className = "fs-text-shell xdh-scroll xdh-tooltip xdh-tooltip-up";
            shell.dataset.tooltip = t("lightbox.text_hint");
            shell.setAttribute("aria-label", t("lightbox.text_hint"));

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
            video.className = "fs-video xdh-tooltip xdh-tooltip-up";
            video.dataset.tooltip = t("lightbox.video_hint");
            video.setAttribute("aria-label", t("lightbox.video_hint"));
            return video;
        }

        if (mediaType === "audio") {
            return this._buildAudioMedia(detail, previewSettings);
        }

        const image = document.createElement("img");
        image.src = detail.url;
        image.alt = detail.name || "";
        image.className = "fs-img xdh-tooltip xdh-tooltip-up";
        image.dataset.tooltip = t("lightbox.image_hint");
        image.setAttribute("aria-label", t("lightbox.image_hint"));
        return image;
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
                .fs-action-btn:disabled {
                    opacity: 0.42;
                    cursor: not-allowed;
                    transform: none;
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

                .fs-audio-shell {
                    width: min(92vw, 860px);
                    max-width: 100%;
                }

                .fs-audio-panel {
                    padding: 16px;
                    border-radius: 16px;
                    border: 1px solid var(--xdh-color-border, #2e2e2e);
                    background: var(--xdh-color-surface-1, #1a1a1a);
                    box-shadow: 0 10px 32px rgba(0, 0, 0, 0.45);
                }

                .fs-audio-transport {
                    display: flex;
                    align-items: center;
                    gap: 14px;
                }

                .fs-audio-play-btn,
                .fs-audio-volume-btn {
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    padding: 0;
                    border: 1px solid var(--xdh-color-border, #2e2e2e);
                    background: var(--xdh-color-surface-2, #2a2a2a);
                    color: var(--xdh-color-text-primary, #f0f0f0);
                    flex: 0 0 auto;
                    transition:
                        background 0.15s ease,
                        border-color 0.15s ease,
                        transform 0.15s ease;
                }

                .fs-audio-play-btn {
                    width: 48px;
                    height: 48px;
                    border-radius: 12px;
                }

                .fs-audio-volume-btn {
                    width: 40px;
                    height: 40px;
                    border-radius: 10px;
                }

                .fs-audio-play-btn:hover,
                .fs-audio-play-btn:focus-visible,
                .fs-audio-volume-btn:hover,
                .fs-audio-volume-btn:focus-visible,
                .fs-audio-waveform:hover,
                .fs-audio-waveform:focus-visible {
                    border-color: color-mix(
                        in srgb,
                        var(--xdh-brand-pink, #ea005e) 60%,
                        var(--xdh-color-border, #2e2e2e)
                    );
                    outline: none;
                }

                .fs-audio-play-btn:hover,
                .fs-audio-play-btn:focus-visible,
                .fs-audio-volume-btn:hover,
                .fs-audio-volume-btn:focus-visible {
                    background: var(--xdh-color-hover, #2a2a2a);
                    transform: translateY(-1px);
                }

                .fs-audio-play-btn .xdh-icon,
                .fs-audio-volume-btn .xdh-icon {
                    pointer-events: none;
                }

                .fs-audio-volume-btn[data-audio-muted="true"] {
                    color: var(--xdh-color-text-secondary, #999);
                }

                .fs-audio-volume-group {
                    display: flex;
                    align-items: center;
                    gap: 10px;
                    flex: 0 0 auto;
                    min-width: 0;
                }

                .fs-audio-volume-range {
                    width: 124px;
                    min-width: 0;
                    margin: 0;
                    padding: 0;
                    appearance: none;
                    background: transparent;
                    cursor: pointer;
                }

                .fs-audio-volume-range:focus-visible {
                    outline: none;
                }

                .fs-audio-volume-range::-webkit-slider-runnable-track {
                    height: 4px;
                    border-radius: 999px;
                    background: linear-gradient(
                        90deg,
                        var(--xdh-brand-pink, #ea005e) 0%,
                        var(--xdh-brand-pink, #ea005e)
                            var(--fs-audio-volume-progress, 100%),
                        var(--xdh-color-border, #2e2e2e)
                            var(--fs-audio-volume-progress, 100%),
                        var(--xdh-color-border, #2e2e2e) 100%
                    );
                }

                .fs-audio-volume-range::-webkit-slider-thumb {
                    appearance: none;
                    width: 12px;
                    height: 12px;
                    margin-top: -4px;
                    border: 2px solid var(--xdh-color-surface-1, #1a1a1a);
                    border-radius: 50%;
                    background: var(--xdh-color-text-primary, #f0f0f0);
                }

                .fs-audio-volume-range::-moz-range-track {
                    height: 4px;
                    border: 0;
                    border-radius: 999px;
                    background: var(--xdh-color-border, #2e2e2e);
                }

                .fs-audio-volume-range::-moz-range-progress {
                    height: 4px;
                    border-radius: 999px;
                    background: var(--xdh-brand-pink, #ea005e);
                }

                .fs-audio-volume-range::-moz-range-thumb {
                    width: 12px;
                    height: 12px;
                    border: 2px solid var(--xdh-color-surface-1, #1a1a1a);
                    border-radius: 50%;
                    background: var(--xdh-color-text-primary, #f0f0f0);
                }

                .fs-audio-volume-value {
                    min-width: 44px;
                    color: var(--xdh-color-text-secondary, #999);
                    font-size: 12px;
                    line-height: 1.3;
                    text-align: right;
                    font-variant-numeric: tabular-nums;
                    font-family: ui-monospace, "Cascadia Mono", "Consolas",
                        monospace;
                }

                .fs-audio-timeline {
                    min-width: 0;
                    flex: 1 1 auto;
                    display: flex;
                    flex-direction: column;
                    gap: 8px;
                }

                .fs-audio-waveform {
                    position: relative;
                    width: 100%;
                    height: 112px;
                    padding: 0;
                    border: 1px solid var(--xdh-color-border, #2e2e2e);
                    border-radius: 12px;
                    background: var(--xdh-color-surface-2, #2a2a2a);
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
                        rgba(255, 255, 255, 0.08) 50%,
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
                    padding: 0 2px;
                }

                .fs-audio-time {
                    font-size: 12px;
                    line-height: 1.3;
                    color: var(--xdh-color-text-secondary, #999);
                    font-variant-numeric: tabular-nums;
                    font-family: ui-monospace, "Cascadia Mono", "Consolas",
                        monospace;
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
                    from {
                        transform: translateX(-100%);
                    }
                    to {
                        transform: translateX(100%);
                    }
                }

                @media (max-width: 640px) {
                    .fs-stage {
                        padding: 16px;
                    }

                    .fs-media {
                        padding: 72px 0 24px;
                    }

                    .fs-top-bar {
                        left: 12px;
                        right: 12px;
                        top: 12px;
                        gap: 8px;
                    }

                    .fs-title-box {
                        max-width: min(70vw, 720px);
                        padding: 8px 10px;
                    }

                    .fs-title {
                        font-size: 12px;
                    }

                    .fs-side-btn {
                        width: 42px;
                        height: 72px;
                    }

                    .fs-audio-shell {
                        width: 100%;
                    }

                    .fs-audio-panel {
                        padding: 12px;
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
            </div>
        `;
    }
}

registerCustomElement("xdh-lightbox", XdhLightbox);
