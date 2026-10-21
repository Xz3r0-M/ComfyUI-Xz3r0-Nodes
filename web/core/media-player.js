/**
 * 共享媒体播放器（自绘控件）
 * ==========================
 * XVideoGet / XAudioGet 的节点面板和 XMediaListGet 的全屏预览共用这一套
 * 播放器：自绘进度条、波形、音量滑块，并支持把音量放大到 300%
 * （超过 100% 的部分用 WebAudio 的 GainNode 实现）。
 *
 * 用法：
 *   const player = buildVideoPlayer({ t, tooltip });
 *   host.appendChild(player.container);
 *   player.mediaEl.src = url;          // 播放源照常设置
 *   player.playerState.sync();         // 需要时可手动刷新界面
 *   player.playerState.dispose();      // 销毁（关掉 AudioContext）
 *
 * - t(key, fallback)：传完整本地化键，节点面板与预览各自传自己的查表函数。
 * - tooltip：{ set(el, text), bind(el) }，缺省直接写原生 title。
 */

const STYLE_ID = "xdh-media-player-style";

function resolveDeps(deps) {
    const translate = typeof deps.t === "function"
        ? deps.t
        : (key, fallback) => fallback || key;
    const tooltip = deps.tooltip && typeof deps.tooltip.set === "function"
        ? deps.tooltip
        : {
            set: (el, text) => {
                if (el && text) {
                    el.title = String(text);
                }
            },
            bind: () => {},
        };
    return { t: translate, tooltip };
}

const PLAYER_CSS = `
        /* ============================
           Custom Audio Player (xmg-*)
           ============================ */
        .xmg-audio-player {
            display: none;
            flex-direction: column;
            gap: 6px;
            width: 100%;
            height: 100%;
            box-sizing: border-box;
            padding: 8px;
        }
        .xmg-audio-play-btn {
            width: 36px;
            height: 36px;
            flex: 0 0 36px;
            align-self: center;
            padding: 0;
            border: 1px solid var(--xdh-clr-hairline);
            border-radius: 50%;
            background: var(--xdh-clr-surface-card);
            color: var(--xdh-color-text-primary);
            font-size: 14px;
            line-height: 1;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            box-shadow: var(--xdh-shadow-default, none);
            transition: background 0.12s ease, transform 0.12s ease, box-shadow 0.12s ease;
        }
        .xmg-audio-play-btn:hover {
            background: var(--xdh-clr-surface-soft);
            transform: scale(1.08);
            box-shadow: var(--xdh-shadow-popup, 0 2px 12px rgba(0,0,0,0.3));
        }
        .xmg-audio-play-btn:active {
            transform: scale(0.95);
        }
        .xmg-audio-waveform {
            flex: 1 1 auto;
            min-width: 0;
            min-height: 36px;
            border-radius: 8px;
            background: var(--xdh-clr-surface-soft);
            overflow: hidden;
            cursor: pointer;
            position: relative;
        }
        .xmg-audio-waveform[data-loading="true"]::after {
            content: "";
            position: absolute;
            inset: 0;
            opacity: 1;
            pointer-events: none;
            background: linear-gradient(90deg, transparent 0%, var(--xdh-clr-hairline) 50%, transparent 100%);
            animation: xmg-wave-sheen 1.2s linear infinite;
        }
        @keyframes xmg-wave-sheen {
            from { transform: translateX(-100%); }
            to { transform: translateX(100%); }
        }
        .xmg-audio-waveform-canvas {
            width: 100%;
            height: 100%;
            display: block;
        }
        .xmg-audio-bottom {
            display: flex;
            align-items: center;
            gap: 4px;
            flex: 0 0 auto;
            min-height: 18px;
            width: 100%;
        }
        .xmg-audio-time {
            font-size: 10px;
            line-height: 1.3;
            color: var(--xdh-color-text-secondary);
            font-variant-numeric: tabular-nums;
            font-family: ui-monospace, "Cascadia Mono", "Consolas", monospace;
            white-space: nowrap;
        }
        .xmg-audio-volume-btn {
            width: 20px;
            height: 20px;
            flex: 0 0 20px;
            padding: 0;
            border: none;
            background: transparent;
            color: var(--xdh-color-text-primary);
            font-size: 12px;
            line-height: 1;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            margin-left: auto;
        }
        .xmg-audio-volume-range {
            width: 48px;
            min-width: 0;
            margin: 0;
            padding: 0;
            appearance: none;
            background: transparent;
            cursor: pointer;
            height: 14px;
            flex: 0 0 auto;
        }
        .xmg-audio-volume-range::-webkit-slider-runnable-track {
            height: 3px;
            border-radius: 999px;
            background: var(--xdh-clr-hairline);
        }
        .xmg-audio-volume-range::-webkit-slider-thumb {
            appearance: none;
            width: 10px;
            height: 10px;
            margin-top: -3.5px;
            border-radius: 50%;
            background: var(--xdh-color-text-primary);
            cursor: pointer;
            border: none;
        }
        .xmg-audio-volume-range::-moz-range-track {
            height: 3px;
            border: 0;
            border-radius: 999px;
            background: var(--xdh-clr-hairline);
        }
        .xmg-audio-volume-range::-moz-range-thumb {
            width: 10px;
            height: 10px;
            border-radius: 50%;
            background: var(--xdh-color-text-primary);
            cursor: pointer;
            border: none;
        }
        .xmg-audio-volume-value {
            font-size: 10px;
            color: var(--xdh-color-text-secondary);
            line-height: 1.3;
            min-width: 28px;
            text-align: right;
            font-variant-numeric: tabular-nums;
            font-family: ui-monospace, "Cascadia Mono", "Consolas", monospace;
        }
        .xmg-audio-volume-lock {
            width: 16px;
            height: 16px;
            flex: 0 0 16px;
            padding: 0;
            border: none;
            background: transparent;
            color: var(--xdh-color-text-secondary);
            font-size: 9px;
            line-height: 1;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            opacity: 0.5;
            transition: opacity 0.12s ease;
        }
        .xmg-audio-volume-lock:hover {
            opacity: 1;
        }
        .xmg-audio-volume-lock.is-active {
            opacity: 1;
            color: var(--xdh-clr-surface-card, #fff);
            background: var(--xdh-color-primary);
            box-shadow: inset 0 0 0 1px var(--xdh-color-primary);
            border-radius: 2px;
        }
        .xmg-audio-el {
            position: absolute;
            width: 1px;
            height: 1px;
            opacity: 0;
            pointer-events: none;
            left: -9999px;
            top: 0;
            display: block !important;
        }

        /* ============================
           Custom Video Player (xmg-*)
           ============================ */
        .xmg-video-player {
            width: 100%;
            height: 100%;
            position: relative;
            display: none;
            flex-direction: column;
            background: var(--xdh-clr-surface-card, #000);
        }
        .xmg-video-el {
            width: 100%;
            flex: 1 1 auto;
            min-height: 0;
            display: block !important;
            object-fit: contain;
            background: var(--xdh-clr-surface-card, #000);
        }
        .xmg-video-content-area {
            position: relative;
            flex: 1 1 auto;
            min-height: 0;
            overflow: hidden;
        }
        .xmg-video-overlay {
            position: absolute;
            inset: 0;
            display: flex;
            align-items: center;
            justify-content: center;
            pointer-events: none;
            z-index: 2;
        }
        .xmg-video-overlay-btn {
            width: 48px;
            height: 48px;
            padding: 0;
            border: 1px solid var(--xdh-clr-hairline);
            border-radius: 50%;
            background: var(--xdh-clr-surface-card);
            color: var(--xdh-color-text-primary);
            font-size: 20px;
            line-height: 1;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            pointer-events: auto;
            box-shadow: var(--xdh-shadow-default, none);
            transition: background 0.15s ease, transform 0.15s ease, box-shadow 0.15s ease;
        }
        .xmg-video-overlay-btn:hover {
            background: var(--xdh-clr-surface-soft);
            transform: scale(1.08);
            box-shadow: var(--xdh-shadow-popup, 0 2px 12px rgba(0,0,0,0.3));
        }
        .xmg-video-overlay-btn:active {
            transform: scale(0.95);
        }
        .xmg-video-controls {
            display: flex;
            align-items: center;
            gap: 4px;
            padding: 2px 6px;
            flex: 0 0 auto;
            min-height: 22px;
            background: var(--xdh-clr-surface-card);
            border-top: 1px solid var(--xdh-clr-hairline);
        }
        .xmg-video-progress-row {
            width: 100%;
            flex: 0 0 auto;
            padding: 0 6px;
            box-sizing: border-box;
        }
        .xmg-video-progress-wrap {
            width: 100%;
            height: 14px;
            display: flex;
            align-items: center;
            cursor: pointer;
        }
        .xmg-video-progress {
            width: 100%;
            margin: 0;
            padding: 0;
            appearance: none;
            background: transparent;
            cursor: pointer;
            height: 14px;
        }
        .xmg-video-progress::-webkit-slider-runnable-track {
            height: 3px;
            border-radius: 999px;
            background: var(--xdh-clr-hairline);
        }
        .xmg-video-progress::-webkit-slider-thumb {
            appearance: none;
            width: 10px;
            height: 10px;
            margin-top: -3.5px;
            border-radius: 50%;
            background: var(--xdh-color-text-primary, #fff);
            cursor: pointer;
            border: none;
        }
        .xmg-video-progress::-moz-range-track {
            height: 3px;
            border: 0;
            border-radius: 999px;
            background: var(--xdh-clr-hairline);
        }
        .xmg-video-progress::-moz-range-thumb {
            width: 10px;
            height: 10px;
            border-radius: 50%;
            background: var(--xdh-color-text-primary, #fff);
            cursor: pointer;
            border: none;
        }
        .xmg-video-time {
            font-size: 10px;
            color: var(--xdh-color-text-secondary);
            line-height: 1.3;
            font-variant-numeric: tabular-nums;
            font-family: ui-monospace, "Cascadia Mono", "Consolas", monospace;
            white-space: nowrap;
            flex: 0 0 auto;
        }
        .xmg-video-volume-btn {
            width: 18px;
            height: 18px;
            flex: 0 0 18px;
            padding: 0;
            border: none;
            background: transparent;
            color: var(--xdh-color-text-secondary);
            font-size: 11px;
            line-height: 1;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            margin-left: auto;
        }
        .xmg-video-volume-range {
            width: 40px;
            margin: 0;
            padding: 0;
            appearance: none;
            background: transparent;
            cursor: pointer;
            height: 14px;
            flex: 0 0 auto;
        }
        .xmg-video-volume-range::-webkit-slider-runnable-track {
            height: 3px;
            border-radius: 999px;
            background: var(--xdh-clr-hairline);
        }
        .xmg-video-volume-range::-webkit-slider-thumb {
            appearance: none;
            width: 10px;
            height: 10px;
            margin-top: -3.5px;
            border-radius: 50%;
            background: var(--xdh-color-text-primary, #fff);
            cursor: pointer;
            border: none;
        }
        .xmg-video-volume-range::-moz-range-track {
            height: 3px;
            border: 0;
            border-radius: 999px;
            background: var(--xdh-clr-hairline);
        }
        .xmg-video-volume-range::-moz-range-thumb {
            width: 10px;
            height: 10px;
            border-radius: 50%;
            background: var(--xdh-color-text-primary, #fff);
            cursor: pointer;
            border: none;
        }
        .xmg-video-volume-value {
            font-size: 10px;
            color: var(--xdh-color-text-secondary);
            line-height: 1.3;
            min-width: 24px;
            text-align: right;
            font-variant-numeric: tabular-nums;
            font-family: ui-monospace, "Cascadia Mono", "Consolas", monospace;
        }
        .xmg-video-volume-lock {
            width: 16px;
            height: 16px;
            flex: 0 0 16px;
            padding: 0;
            border: none;
            background: transparent;
            color: var(--xdh-color-text-secondary);
            font-size: 9px;
            line-height: 1;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            opacity: 0.5;
            transition: opacity 0.12s ease;
        }
        .xmg-video-volume-lock:hover {
            opacity: 1;
        }
        .xmg-video-volume-lock.is-active {
            opacity: 1;
            color: var(--xdh-clr-surface-card, #fff);
            background: var(--xdh-color-primary);
            box-shadow: inset 0 0 0 1px var(--xdh-color-primary);
            border-radius: 2px;
        }

        /* Loop toggle button (audio + video) */
        .xmg-audio-loop-btn,
        .xmg-video-loop-btn {
            flex: 0 0 0px;
            height: 16px;
            padding: 0;
            border: none;
            background: transparent;
            color: var(--xdh-color-text-secondary);
            font-size: 11px;
            line-height: 1;
            display: inline-flex;
            align-items: center;
            justify-content: flex-start;
            cursor: pointer;
            opacity: 0.5;
            transition: opacity 0.12s ease, color 0.12s ease;
        }
        .xmg-audio-loop-btn:hover,
        .xmg-video-loop-btn:hover {
            opacity: 1;
        }
        .xmg-audio-loop-btn.is-active,
        .xmg-video-loop-btn.is-active {
            opacity: 1;
            color: var(--xdh-clr-surface-card, #fff);
            background: var(--xdh-color-primary);
            box-shadow: inset 0 0 0 1px var(--xdh-color-primary);
            border-radius: 2px;
        }
`;

export function ensureMediaPlayerStyles() {
    if (document.getElementById(STYLE_ID)) {
        return;
    }
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = PLAYER_CSS;
    document.head.appendChild(style);
}

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}

/* Global theme observer — redraws all audio waveforms on data-theme change */
var WAVEFORM_CALLBACKS = new Set();
var THEME_OBSERVER = null;
var THEME_CONTEXT_LISTENER_INSTALLED = false;
function ensureThemeObserver() {
    if (THEME_OBSERVER) return;
    THEME_OBSERVER = new MutationObserver(function () {
        WAVEFORM_CALLBACKS.forEach(function (fn) { fn(); });
    });
    THEME_OBSERVER.observe(document.body, { attributes: true, attributeFilter: ["data-theme"] });
    if (!THEME_CONTEXT_LISTENER_INSTALLED) {
        THEME_CONTEXT_LISTENER_INSTALLED = true;
        document.addEventListener("xdatahub:theme-context-applied", function () {
            WAVEFORM_CALLBACKS.forEach(function (fn) { fn(); });
        });
    }
}

const AUDIO_BAR_COUNT = 3000;
export const AUDIO_VOLUME_NORMAL = 100;
export const AUDIO_VOLUME_MAX = 300;
const AUDIO_WAVEFORM_CACHE = new Map();

function applyVolume(mediaEl, gainNode, percent) {
    const clamped = Math.max(0, Math.min(AUDIO_VOLUME_MAX, Number.isFinite(percent) ? percent : AUDIO_VOLUME_NORMAL));
    mediaEl.volume = Math.min(clamped, AUDIO_VOLUME_NORMAL) / AUDIO_VOLUME_NORMAL;
    if (gainNode) {
        gainNode.gain.value = clamped > AUDIO_VOLUME_NORMAL
            ? clamped / AUDIO_VOLUME_NORMAL
            : 1;
    }
    return clamped;
}

function formatTime(value) {
    const totalSeconds = Math.max(0, Math.floor(Number.isFinite(value) ? value : 0));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
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

function buildFallbackPeaks(seedText, count) {
    count = count || AUDIO_BAR_COUNT;
    let seed = hashText(seedText) || 1;
    return Array.from({ length: count }, (_, index) => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        const noise = ((seed >>> 8) & 0xffff) / 0xffff;
        const envelope = 0.42 + (Math.sin((index / count) * Math.PI * 3.5) * 0.18);
        return Math.min(1, Math.max(0.12, (noise * 0.55) + envelope));
    });
}

function normalizePeaks(audioBuffer, barCount) {
    barCount = barCount || AUDIO_BAR_COUNT;
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
    const maxPeak = peaks.reduce((mv, v) => Math.max(mv, v), 0);
    if (maxPeak <= 1e-6) return buildFallbackPeaks("", barCount);
    return peaks.map(v => Math.min(1, Math.max(0.08, v / maxPeak)));
}

function getAudioDecodeContext() {
    if (getAudioDecodeContext._ctx) return getAudioDecodeContext._ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    getAudioDecodeContext._ctx = new AC();
    return getAudioDecodeContext._ctx;
}

async function loadWaveformPeaks(url) {
    const key = String(url || "").trim();
    if (!key) return buildFallbackPeaks("", AUDIO_BAR_COUNT);
    const cached = AUDIO_WAVEFORM_CACHE.get(key);
    if (cached) return cached;
    const ctx = getAudioDecodeContext();
    if (!ctx) return buildFallbackPeaks(key, AUDIO_BAR_COUNT);
    try {
        const response = await fetch(key, { cache: "force-cache" });
        if (!response.ok) return buildFallbackPeaks(key, AUDIO_BAR_COUNT);
        const arrayBuffer = await response.arrayBuffer();
        let audioBuffer;
        try {
            audioBuffer = await ctx.decodeAudioData(arrayBuffer.slice(0));
        } catch {
            return buildFallbackPeaks(key, AUDIO_BAR_COUNT);
        }
        const peaks = normalizePeaks(audioBuffer, AUDIO_BAR_COUNT);
        AUDIO_WAVEFORM_CACHE.set(key, peaks);
        return peaks;
    } catch {
        return buildFallbackPeaks(key, AUDIO_BAR_COUNT);
    }
}

function drawAudioWaveform(canvas, peaks, progress, width, height) {
    if (!(canvas instanceof HTMLCanvasElement)) return;
    if (!width || !height) return;
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const pw = Math.floor(width * dpr);
    const ph = Math.floor(height * dpr);
    if (canvas.width !== pw || canvas.height !== ph) {
        canvas.width = pw;
        canvas.height = ph;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);
    // Resolve actual theme text color (CSS var → computed value)
    const _probe = document.createElement("div");
    _probe.style.cssText = "position:absolute;visibility:hidden;color:var(--xdh-color-text-primary)";
    document.body.appendChild(_probe);
    const playedColor = getComputedStyle(_probe).color || "#ffffff";
    document.body.removeChild(_probe);
    // Idle (unplayed) = played color at ~20% opacity
    const idleColor = playedColor.replace(")", ",0.2)").replace("rgb(", "rgba(");
    const p = Math.min(1, Math.max(0, progress || 0));

    // Bar count = span / desired-bar-pitch — so bar thickness stays consistent
    // at any window width. More width = more bars, same thickness.
    const gap = 1;
    const PX_PER_BAR = 2.5;
    const targetCount = Math.max(20, Math.min(peaks.length, Math.floor(width / PX_PER_BAR)));
    const totalGap = (targetCount - 1) * gap;
    const barSpace = Math.max(1, Math.floor((width - totalGap) / targetCount));
    const leftover = Math.max(0, (width - totalGap) - barSpace * targetCount);

    const srcStride = peaks.length / targetCount;
    let cursorX = 0;
    let playedEndX = 0;
    for (let i = 0; i < targetCount; i++) {
        const sStart = Math.floor(i * srcStride);
        const sEnd = Math.max(sStart + 1, Math.floor((i + 1) * srcStride));
        let peak = 0;
        for (let c = sStart; c < sEnd; c++) peak = Math.max(peak, peaks[c] || 0);
        const barW = barSpace + (i < leftover ? 1 : 0);
        const barH = Math.max(4, Math.round((height - 6) * peak));
        const x = cursorX;
        const y = Math.floor((height - barH) / 2);
        const thresh = (i + 1) / targetCount;
        ctx.fillStyle = thresh <= p ? playedColor : idleColor;
        ctx.fillRect(x, y, barW, barH);
        cursorX += barW + gap;
        if (thresh <= p) playedEndX = cursorX;
    }

    if (p > 0 && p < 1) {
        const px = Math.max(0, Math.min(Math.floor(playedEndX), width - 2));
        ctx.fillStyle = playedColor;
        ctx.fillRect(px, 3, 2, Math.max(height - 6, 0));
    }
}

export function buildAudioPlayer(deps = {}) {
    const { t, tooltip } = resolveDeps(deps);
    ensureMediaPlayerStyles();
    const container = document.createElement("div");
    container.className = "xmg-audio-player";

    // Hidden audio element
    const audio = document.createElement("audio");
    audio.preload = "metadata";
    audio.controls = false;
    audio.className = "xmg-audio-el";
    container.appendChild(audio);

    // Gain graph for volume amplification (>100%)
    let audioGainNode = null;
    try {
        const ac = new (window.AudioContext || window.webkitAudioContext)();
        const src = ac.createMediaElementSource(audio);
        const gn = ac.createGain();
        src.connect(gn);
        gn.connect(ac.destination);
        audioGainNode = gn;
        // Resume context on first user interaction
        const resumeCtx = function () { if (ac.state === "suspended") ac.resume(); document.removeEventListener("pointerdown", resumeCtx); };
        document.addEventListener("pointerdown", resumeCtx, { once: true });
    } catch {}
    const maxOutputLevel = audioGainNode ? AUDIO_VOLUME_MAX : AUDIO_VOLUME_NORMAL;

    // Play button (centered above waveform)
    const playBtn = document.createElement("button");
    playBtn.type = "button";
    playBtn.className = "xmg-audio-play-btn";
    playBtn.textContent = "▶";
    playBtn.setAttribute("aria-label", "Play");
    tooltip.set(playBtn, t("xdatahub.ui.node.xmediaget.player_play", "Play"));
    tooltip.bind(playBtn);
    container.appendChild(playBtn);

    // Waveform (fills remaining height)
    const waveformWrap = document.createElement("div");
    waveformWrap.className = "xmg-audio-waveform";
    const canvas = document.createElement("canvas");
    canvas.className = "xmg-audio-waveform-canvas";
    waveformWrap.appendChild(canvas);
    container.appendChild(waveformWrap);
    tooltip.set(waveformWrap, t("xdatahub.ui.node.xmediaget.player_seek", "Seek"));
    tooltip.bind(waveformWrap);

    // Bottom row: time + volume
    const bottomRow = document.createElement("div");
    bottomRow.className = "xmg-audio-bottom";

    const timeEl = document.createElement("span");
    timeEl.className = "xmg-audio-time";
    timeEl.textContent = "0:00 / 0:00";

    const volumeBtn = document.createElement("button");
    volumeBtn.type = "button";
    volumeBtn.className = "xmg-audio-volume-btn";
    volumeBtn.textContent = "🔊";
    volumeBtn.setAttribute("aria-label", "Mute");
    tooltip.set(volumeBtn, t("xdatahub.ui.node.xmediaget.player_mute", "Mute"));
    tooltip.bind(volumeBtn);

    const volumeRange = document.createElement("input");
    volumeRange.type = "range";
    volumeRange.className = "xmg-audio-volume-range";
    volumeRange.min = "0";
    volumeRange.max = String(AUDIO_VOLUME_NORMAL);
    volumeRange.step = "1";
    volumeRange.value = String(AUDIO_VOLUME_NORMAL);
    tooltip.set(volumeRange, t("xdatahub.ui.node.xmediaget.player_volume", "Volume"));
    tooltip.bind(volumeRange);

    const volumeValue = document.createElement("span");
    volumeValue.className = "xmg-audio-volume-value";
    volumeValue.textContent = "100%";

    // Volume boost lock toggle
    const lockBtn = document.createElement("button");
    lockBtn.type = "button";
    lockBtn.className = "xmg-audio-volume-lock";
    lockBtn.textContent = "🔒";
    lockBtn.setAttribute("aria-label", "Unlock volume boost");
    tooltip.set(lockBtn, t("xdatahub.ui.node.xmediaget.player_volume_unlock", "Unlock volume boost"));
    tooltip.bind(lockBtn);
    lockBtn.addEventListener("click", function () {
        var unlock = !state._volumeUnlocked;
        state._volumeUnlocked = unlock;
        lockBtn.classList.toggle("is-active", unlock);
        lockBtn.textContent = unlock ? "🔓" : "🔒";
        lockBtn.setAttribute("aria-label", unlock ? "Lock volume boost" : "Unlock volume boost");
        tooltip.set(lockBtn, t(unlock ? "xdatahub.ui.node.xmediaget.player_volume_lock" : "xdatahub.ui.node.xmediaget.player_volume_unlock", unlock ? "Lock volume boost" : "Unlock volume boost"));
        var cur = Number(volumeRange.value);
        if (!unlock && cur > AUDIO_VOLUME_NORMAL) {
            // Clamp back to normal when locking
            volumeRange.value = String(AUDIO_VOLUME_NORMAL);
            applyVolume(audio, audioGainNode, AUDIO_VOLUME_NORMAL);
            audio.muted = false;
            if (AUDIO_VOLUME_NORMAL > 0) state._lastVol = AUDIO_VOLUME_NORMAL;
        }
        volumeRange.max = unlock ? String(AUDIO_VOLUME_MAX) : String(AUDIO_VOLUME_NORMAL);
        sync();
    });
    lockBtn.style.display = audioGainNode ? "" : "none";

    // Loop toggle button
    const loopBtn = document.createElement("button");
    loopBtn.type = "button";
    loopBtn.className = "xmg-audio-loop-btn";
    loopBtn.textContent = "\uD83D\uDD01";
    loopBtn.setAttribute("aria-label", "Loop playback");
    tooltip.set(loopBtn, t("xdatahub.ui.node.xmediaget.player_loop", "Loop playback"));
    tooltip.bind(loopBtn);
    loopBtn.addEventListener("click", function () {
        audio.loop = !audio.loop;
        loopBtn.classList.toggle("is-active", audio.loop);
        loopBtn.setAttribute("aria-label", audio.loop ? "Loop enabled" : "Loop playback");
        tooltip.set(loopBtn, t(audio.loop ? "xdatahub.ui.node.xmediaget.player_loop_enabled" : "xdatahub.ui.node.xmediaget.player_loop", audio.loop ? "Loop enabled" : "Loop playback"));
    });

    bottomRow.appendChild(timeEl);
    bottomRow.appendChild(loopBtn);
    bottomRow.appendChild(volumeBtn);
    bottomRow.appendChild(volumeRange);
    bottomRow.appendChild(volumeValue);
    bottomRow.appendChild(lockBtn);
    container.appendChild(bottomRow);

    // State
    const state = {
        audio,
        playBtn,
        loopBtn,
        lockBtn,
        waveform: waveformWrap,
        canvas,
        timeEl,
        volumeBtn,
        volumeRange,
        volumeValue,
        peaks: [],
        progress: 0,
        loading: false,
        disposed: false,
        rafId: 0,
        _mouseEntered: false,
        _volumeUnlocked: false,
    };

    function draw() {
        const rect = waveformWrap.getBoundingClientRect();
        drawAudioWaveform(canvas, state.peaks, state.progress, rect.width, rect.height);
    }

    function sync() {
        if (state.disposed) return;
        const dur = Number.isFinite(audio.duration) ? audio.duration : 0;
        const ct = dur > 0 ? Math.min(Math.max(audio.currentTime, 0), dur) : 0;
        const playing = !audio.paused && !audio.ended;
        const pct = dur > 0 ? ct / dur : 0;
        state.progress = pct;
        timeEl.textContent = formatTime(ct) + " / " + formatTime(dur);
        playBtn.textContent = playing ? "⏸" : "▶";
        playBtn.setAttribute("aria-label", playing
            ? t("xdatahub.ui.node.xmediaget.player_pause", "Pause")
            : t("xdatahub.ui.node.xmediaget.player_play", "Play"));
        tooltip.set(playBtn, playing
            ? t("xdatahub.ui.node.xmediaget.player_pause", "Pause")
            : t("xdatahub.ui.node.xmediaget.player_play", "Play"));

        const volRaw = Number(volumeRange.value);
        var curMax = state._volumeUnlocked ? AUDIO_VOLUME_MAX : AUDIO_VOLUME_NORMAL;
        const vol = Math.round(clamp(Number.isFinite(volRaw) ? volRaw : AUDIO_VOLUME_NORMAL, 0, curMax));
        volumeValue.textContent = vol + "%";
        volumeBtn.textContent = vol <= 0 ? "🔇" : "🔊";
        volumeBtn.setAttribute("aria-label", vol <= 0
            ? t("xdatahub.ui.node.xmediaget.player_unmute", "Unmute")
            : t("xdatahub.ui.node.xmediaget.player_mute", "Mute"));
        tooltip.set(volumeBtn, vol <= 0
            ? t("xdatahub.ui.node.xmediaget.player_unmute", "Unmute")
            : t("xdatahub.ui.node.xmediaget.player_mute", "Mute"));
        tooltip.set(waveformWrap, t("xdatahub.ui.node.xmediaget.player_seek", "Seek"));
        tooltip.set(volumeRange, t("xdatahub.ui.node.xmediaget.player_volume", "Volume"));
        tooltip.set(lockBtn, t(state._volumeUnlocked
            ? "xdatahub.ui.node.xmediaget.player_volume_lock"
            : "xdatahub.ui.node.xmediaget.player_volume_unlock",
            state._volumeUnlocked ? "Lock volume boost" : "Unlock volume boost"));
        tooltip.set(loopBtn, t(audio.loop
            ? "xdatahub.ui.node.xmediaget.player_loop_enabled"
            : "xdatahub.ui.node.xmediaget.player_loop",
            audio.loop ? "Loop enabled" : "Loop playback"));
        loopBtn.classList.toggle("is-active", !!audio.loop);
        waveformWrap.dataset.loading = state.loading ? "true" : "false";

        draw();

        if (playing) {
            if (!state.rafId) {
                state.rafId = requestAnimationFrame(function tick() {
                    state.rafId = 0;
                    if (!state.disposed) sync();
                });
            }
        } else {
            if (state.rafId) {
                cancelAnimationFrame(state.rafId);
                state.rafId = 0;
            }
        }
    }

    // Event: play/pause
    playBtn.addEventListener("click", function () {
        if (audio.paused || audio.ended) {
            audio.play().catch(function () {});
        } else {
            audio.pause();
        }
    });

    // Event: seek on waveform click (bar-index-aware, not linear pixel ratio)
    waveformWrap.addEventListener("click", function (e) {
        const rect = waveformWrap.getBoundingClientRect();
        const dur = Number.isFinite(audio.duration) ? audio.duration : 0;
        if (!rect.width || dur <= 0) return;
        const relX = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
        // Find bar index from pixel position (accounts for leftover 1px distribution)
        const w = rect.width;
        const barCnt = Math.max(20, Math.min(state.peaks.length, Math.floor(w / 2.5)));
        const gap = 1;
        const totalG = (barCnt - 1) * gap;
        const bSpace = Math.max(1, Math.floor((w - totalG) / barCnt));
        const leftOver = Math.max(0, (w - totalG) - bSpace * barCnt);
        const targetPx = relX * w;
        let cumX = 0;
        let barIdx = 0;
        for (let i = 0; i < barCnt; i++) {
            const bw = bSpace + (i < leftOver ? 1 : 0);
            const nx = cumX + bw + gap;
            if (nx > targetPx) { barIdx = i; break; }
            cumX = nx;
            barIdx = i + 1;
        }
        const ratio = Math.min(1, Math.max(0, barIdx / barCnt));
        audio.currentTime = dur * ratio;
        sync();
    });

    // Event: volume (mute toggle with restore, supports amplification)
    function notifyVolumeChange() {
        if (typeof state.onVolumeChange === "function") {
            state.onVolumeChange();
        }
    }

    function toggleMute() {
        const cur = Number(volumeRange.value);
        if (cur > 0) {
            state._lastVol = clamp(cur, 0, state._volumeUnlocked ? AUDIO_VOLUME_MAX : AUDIO_VOLUME_NORMAL);
            const clamped = applyVolume(audio, audioGainNode, 0);
            volumeRange.value = "0";
            audio.muted = true;
        } else {
            const restore = state._lastVol > 0 ? state._lastVol : AUDIO_VOLUME_NORMAL;
            volumeRange.value = String(restore);
            const clamped = applyVolume(audio, audioGainNode, restore);
            audio.muted = false;
        }
        sync();
        notifyVolumeChange();
    }
    volumeBtn.addEventListener("click", toggleMute);
    volumeRange.addEventListener("input", function () {
        var curMax = state._volumeUnlocked ? AUDIO_VOLUME_MAX : AUDIO_VOLUME_NORMAL;
        const v = clamp(Number(volumeRange.value), 0, curMax);
        const clamped = applyVolume(audio, audioGainNode, v);
        audio.muted = v <= 0;
        if (v > 0) state._lastVol = v;
        sync();
        notifyVolumeChange();
    });
    volumeRange.addEventListener("wheel", function (e) {
        e.preventDefault();
        e.stopPropagation();
        var curMax = state._volumeUnlocked ? AUDIO_VOLUME_MAX : AUDIO_VOLUME_NORMAL;
        const step = e.deltaY < 0 ? 5 : -5;
        const cur = clamp(Number(volumeRange.value) || 0, 0, curMax);
        const next = clamp(cur + step, 0, curMax);
        volumeRange.value = String(next);
        const clamped = applyVolume(audio, audioGainNode, next);
        audio.muted = next <= 0;
        if (next > 0) state._lastVol = next;
        sync();
        notifyVolumeChange();
    }, { passive: false });

    // Event: keyboard seek on waveform
    waveformWrap.addEventListener("keydown", function (e) {
        const dur = Number.isFinite(audio.duration) ? audio.duration : 0;
        if (!dur) return;
        if (e.key === "ArrowLeft") {
            e.preventDefault();
            audio.currentTime = Math.max(0, audio.currentTime - 5);
            sync();
        } else if (e.key === "ArrowRight") {
            e.preventDefault();
            audio.currentTime = Math.min(dur, audio.currentTime + 5);
            sync();
        } else if (e.key === "Home") {
            e.preventDefault();
            audio.currentTime = 0;
            sync();
        } else if (e.key === "End") {
            e.preventDefault();
            audio.currentTime = dur;
            sync();
        }
    });

    // Media events
    function onMediaEvent() { sync(); }
    var mediaEvents = ["loadedmetadata", "durationchange", "timeupdate", "seeking", "seeked", "play", "pause", "ended", "volumechange"];
    for (var i = 0; i < mediaEvents.length; i++) {
        audio.addEventListener(mediaEvents[i], onMediaEvent);
    }

    // Auto-load waveform once we have src
    var _origSrcDescriptor = null;
    function setupWaveformLoad() {
        var src = audio.src || audio.getAttribute("src") || "";
        if (src && !state._waveformLoaded) {
            state._waveformLoaded = true;
            state.loading = true;
            sync();
            loadWaveformPeaks(src).then(function (peaks) {
                if (state.disposed) return;
                state.peaks = peaks;
                state.loading = false;
                sync();
            });
        }
    }
    audio.addEventListener("loadstart", setupWaveformLoad);
    audio.addEventListener("loadedmetadata", setupWaveformLoad);
    // Also check immediately if src already set
    setTimeout(setupWaveformLoad, 50);

    // Resize observer for waveform canvas
    if (typeof ResizeObserver === "function") {
        var ro = new ResizeObserver(function () {
            if (!state.disposed) {
                state._mouseEntered = false;
                draw();
            }
        });
        ro.observe(waveformWrap);
        state._resizeObserver = ro;
    }

    // Theme change → redraw waveform (via global observer)
    ensureThemeObserver();
    WAVEFORM_CALLBACKS.add(draw);

    // Mouse enters node widget area → redraw waveform once per entry
    // (fixes stale canvas after canvas zoom/pan without user interaction)
    container.addEventListener("mouseenter", function () {
        if (state._mouseEntered) return;
        state._mouseEntered = true;
        if (!state.disposed) draw();
    });
    container.addEventListener("mouseleave", function () {
        state._mouseEntered = false;
    });

    state.dispose = function () {
        if (state.disposed) return;
        state.disposed = true;
        if (state.rafId) { cancelAnimationFrame(state.rafId); state.rafId = 0; }
        if (state._resizeObserver) { state._resizeObserver.disconnect(); state._resizeObserver = null; }
        WAVEFORM_CALLBACKS.delete(draw);
        audio.pause();
        audio.src = "";
        if (typeof audio.load === "function") audio.load();
        if (audioGainNode) {
            try { var ac = audioGainNode.context; if (ac && ac.state !== "closed") ac.close(); } catch {}
        }
    };

    state.sync = sync;
    state.toggleMute = toggleMute;
    state.isMuted = function () { return Number(volumeRange.value) <= 0; };
    container.__xmgAudioState = state;
    return { container: container, mediaEl: audio, playerState: state };
}

/* ==========================================================
   Custom Player — Video (compact controls)
   ========================================================== */

export function buildVideoPlayer(deps = {}) {
    const { t, tooltip } = resolveDeps(deps);
    ensureMediaPlayerStyles();
    const container = document.createElement("div");
    container.className = "xmg-video-player";

    const video = document.createElement("video");
    video.preload = "metadata";
    video.controls = false;
    video.playsInline = true;
    video.className = "xmg-video-el";
    video.muted = true;

    // Content area wraps video + overlay, excludes controls for true centering
    const contentArea = document.createElement("div");
    contentArea.className = "xmg-video-content-area";
    contentArea.appendChild(video);
    container.appendChild(contentArea);

    // Gain graph for volume amplification (>100%)
    let videoGainNode = null;
    try {
        const ac = new (window.AudioContext || window.webkitAudioContext)();
        const src = ac.createMediaElementSource(video);
        const gn = ac.createGain();
        src.connect(gn);
        gn.connect(ac.destination);
        videoGainNode = gn;
        const resumeCtx = function () { if (ac.state === "suspended") ac.resume(); document.removeEventListener("pointerdown", resumeCtx); };
        document.addEventListener("pointerdown", resumeCtx, { once: true });
    } catch {}
    const vMaxOutput = videoGainNode ? AUDIO_VOLUME_MAX : AUDIO_VOLUME_NORMAL;

    // Play overlay (centered on video)
    const overlay = document.createElement("div");
    overlay.className = "xmg-video-overlay";
    const overlayBtn = document.createElement("button");
    overlayBtn.type = "button";
    overlayBtn.className = "xmg-video-overlay-btn";
    overlayBtn.textContent = "▶";
    overlayBtn.setAttribute("aria-label", t("xdatahub.ui.node.xmediaget.player_play", "Play"));
    tooltip.set(overlayBtn, t("xdatahub.ui.node.xmediaget.player_play", "Play"));
    tooltip.bind(overlayBtn);
    overlay.appendChild(overlayBtn);
    contentArea.appendChild(overlay);

    // Controls bar
    const controls = document.createElement("div");
    controls.className = "xmg-video-controls";

    const progressWrap = document.createElement("div");
    progressWrap.className = "xmg-video-progress-wrap";
    const progressBar = document.createElement("input");
    progressBar.type = "range";
    progressBar.className = "xmg-video-progress";
    progressBar.min = "0";
    progressBar.max = "1000";
    progressBar.step = "1";
    progressBar.value = "0";
    tooltip.set(progressBar, t("xdatahub.ui.node.xmediaget.player_seek", "Seek"));
    tooltip.bind(progressBar);
    progressWrap.appendChild(progressBar);

    const timeEl = document.createElement("span");
    timeEl.className = "xmg-video-time";
    timeEl.textContent = "0:00 / 0:00";

    const volumeBtn = document.createElement("button");
    volumeBtn.type = "button";
    volumeBtn.className = "xmg-video-volume-btn";
    volumeBtn.textContent = "🔊";
    volumeBtn.setAttribute("aria-label", "Mute");
    tooltip.set(volumeBtn, t("xdatahub.ui.node.xmediaget.player_mute", "Mute"));
    tooltip.bind(volumeBtn);

    const volumeRange = document.createElement("input");
    volumeRange.type = "range";
    volumeRange.className = "xmg-video-volume-range";
    volumeRange.min = "0";
    volumeRange.max = String(AUDIO_VOLUME_NORMAL);
    volumeRange.step = "1";
    volumeRange.value = String(AUDIO_VOLUME_NORMAL);
    tooltip.set(volumeRange, t("xdatahub.ui.node.xmediaget.player_volume", "Volume"));
    tooltip.bind(volumeRange);

    const volumeValue = document.createElement("span");
    volumeValue.className = "xmg-video-volume-value";
    volumeValue.textContent = "100%";

    // Volume boost lock toggle
    const lockBtn = document.createElement("button");
    lockBtn.type = "button";
    lockBtn.className = "xmg-video-volume-lock";
    lockBtn.textContent = "🔒";
    lockBtn.setAttribute("aria-label", "Unlock volume boost");
    tooltip.set(lockBtn, t("xdatahub.ui.node.xmediaget.player_volume_unlock", "Unlock volume boost"));
    tooltip.bind(lockBtn);
    lockBtn.addEventListener("click", function () {
        var unlock = !state._volumeUnlocked;
        state._volumeUnlocked = unlock;
        lockBtn.classList.toggle("is-active", unlock);
        lockBtn.textContent = unlock ? "🔓" : "🔒";
        lockBtn.setAttribute("aria-label", unlock ? "Lock volume boost" : "Unlock volume boost");
        tooltip.set(lockBtn, t(unlock ? "xdatahub.ui.node.xmediaget.player_volume_lock" : "xdatahub.ui.node.xmediaget.player_volume_unlock", unlock ? "Lock volume boost" : "Unlock volume boost"));
        var cur = Number(volumeRange.value);
        if (!unlock && cur > AUDIO_VOLUME_NORMAL) {
            volumeRange.value = String(AUDIO_VOLUME_NORMAL);
            applyVolume(video, videoGainNode, AUDIO_VOLUME_NORMAL);
            video.muted = false;
            if (AUDIO_VOLUME_NORMAL > 0) state._lastVol = AUDIO_VOLUME_NORMAL;
        }
        volumeRange.max = unlock ? String(AUDIO_VOLUME_MAX) : String(AUDIO_VOLUME_NORMAL);
        sync();
    });
    lockBtn.style.display = videoGainNode ? "" : "none";

    // Progress bar on its own row (prevents squeezing at small sizes)
    const progressRow = document.createElement("div");
    progressRow.className = "xmg-video-progress-row";
    progressRow.appendChild(progressWrap);
    container.appendChild(progressRow);

    // Loop toggle button
    const loopBtn = document.createElement("button");
    loopBtn.type = "button";
    loopBtn.className = "xmg-video-loop-btn";
    loopBtn.textContent = "\uD83D\uDD01";
    loopBtn.setAttribute("aria-label", "Loop playback");
    tooltip.set(loopBtn, t("xdatahub.ui.node.xmediaget.player_loop", "Loop playback"));
    tooltip.bind(loopBtn);
    loopBtn.addEventListener("click", function () {
        video.loop = !video.loop;
        loopBtn.classList.toggle("is-active", video.loop);
        loopBtn.setAttribute("aria-label", video.loop ? "Loop enabled" : "Loop playback");
        tooltip.set(loopBtn, t(video.loop ? "xdatahub.ui.node.xmediaget.player_loop_enabled" : "xdatahub.ui.node.xmediaget.player_loop", video.loop ? "Loop enabled" : "Loop playback"));
    });

    controls.appendChild(timeEl);
    controls.appendChild(loopBtn);
    controls.appendChild(volumeBtn);
    controls.appendChild(volumeRange);
    controls.appendChild(volumeValue);
    controls.appendChild(lockBtn);
    container.appendChild(controls);

    // Full progress bar width (for seek-on-click)
    // We'll make the entire progressWrap clickable for seeking

    const state = {
        video,
        loopBtn,
        lockBtn,
        overlay,
        overlayBtn,
        progress: progressBar,
        progressWrap,
        timeEl,
        volumeBtn,
        volumeRange,
        volumeValue,
        progressVal: 0,
        disposed: false,
        _hoverPause: false,
        rafId: 0,
        _userDragging: false,
        _volumeUnlocked: false,
    };

    function sync() {
        if (state.disposed || state._userDragging) return;
        const dur = Number.isFinite(video.duration) ? video.duration : 0;
        const ct = dur > 0 ? Math.min(Math.max(video.currentTime, 0), dur) : 0;
        const playing = !video.paused && !video.ended;
        const pct = dur > 0 ? ct / dur : 0;
        state.progressVal = pct;
        progressBar.value = String(Math.round(pct * 1000));
        timeEl.textContent = formatTime(ct) + " / " + formatTime(dur);
        overlay.style.display = (playing && !state._hoverPause) ? "none" : "flex";
        if (playing && state._hoverPause) {
            overlayBtn.textContent = "⏸";
            overlayBtn.setAttribute("aria-label", "Pause");
            tooltip.set(overlayBtn, t("xdatahub.ui.node.xmediaget.player_pause", "Pause"));
        } else {
            overlayBtn.textContent = video.ended ? "↻" : "▶";
            overlayBtn.setAttribute("aria-label", video.ended
                ? t("xdatahub.ui.node.xmediaget.player_play", "Play")
                : (playing
                    ? t("xdatahub.ui.node.xmediaget.player_pause", "Pause")
                    : t("xdatahub.ui.node.xmediaget.player_play", "Play")));
            tooltip.set(overlayBtn, video.ended
                ? t("xdatahub.ui.node.xmediaget.player_play", "Play")
                : (playing
                    ? t("xdatahub.ui.node.xmediaget.player_pause", "Pause")
                    : t("xdatahub.ui.node.xmediaget.player_play", "Play")));
        }

        var volRaw = Number(volumeRange.value);
        var curMax = state._volumeUnlocked ? AUDIO_VOLUME_MAX : AUDIO_VOLUME_NORMAL;
        var vol = Math.round(clamp(Number.isFinite(volRaw) ? volRaw : AUDIO_VOLUME_NORMAL, 0, curMax));
        volumeValue.textContent = vol + "%";
        volumeBtn.textContent = vol <= 0 ? "🔇" : "🔊";
        volumeBtn.setAttribute("aria-label", vol <= 0
            ? t("xdatahub.ui.node.xmediaget.player_unmute", "Unmute")
            : t("xdatahub.ui.node.xmediaget.player_mute", "Mute"));
        tooltip.set(volumeBtn, vol <= 0
            ? t("xdatahub.ui.node.xmediaget.player_unmute", "Unmute")
            : t("xdatahub.ui.node.xmediaget.player_mute", "Mute"));
        tooltip.set(progressBar, t("xdatahub.ui.node.xmediaget.player_seek", "Seek"));
        tooltip.set(volumeRange, t("xdatahub.ui.node.xmediaget.player_volume", "Volume"));
        tooltip.set(lockBtn, t(state._volumeUnlocked
            ? "xdatahub.ui.node.xmediaget.player_volume_lock"
            : "xdatahub.ui.node.xmediaget.player_volume_unlock",
            state._volumeUnlocked ? "Lock volume boost" : "Unlock volume boost"));
        tooltip.set(loopBtn, t(video.loop
            ? "xdatahub.ui.node.xmediaget.player_loop_enabled"
            : "xdatahub.ui.node.xmediaget.player_loop",
            video.loop ? "Loop enabled" : "Loop playback"));
        loopBtn.classList.toggle("is-active", !!video.loop);

        if (playing) {
            if (!state.rafId) {
                state.rafId = requestAnimationFrame(function tick() {
                    state.rafId = 0;
                    if (!state.disposed) sync();
                });
            }
        } else {
            if (state.rafId) {
                cancelAnimationFrame(state.rafId);
                state.rafId = 0;
            }
        }
    }

    // Overlay play/pause
    overlay.addEventListener("click", function () {
        if (video.paused || video.ended) {
            video.play().catch(function () {});
            state._hoverPause = true;
        } else {
            video.pause();
        }
    });

    // Progress bar seek (input)
    progressBar.addEventListener("input", function () {
        state._userDragging = true;
        var dur = Number.isFinite(video.duration) ? video.duration : 0;
        if (dur > 0) {
            var pct = clamp(Number(progressBar.value), 0, 1000) / 1000;
            video.currentTime = dur * pct;
            timeEl.textContent = formatTime(video.currentTime) + " / " + formatTime(dur);
        }
    });
    progressBar.addEventListener("change", function () {
        state._userDragging = false;
        sync();
    });

    // Seek by clicking on progress wrap (not just the thumb)
    progressWrap.addEventListener("click", function (e) {
        if (e.target === progressBar) return;
        var rect = progressWrap.getBoundingClientRect();
        var dur = Number.isFinite(video.duration) ? video.duration : 0;
        if (!rect.width || dur <= 0) return;
        var ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
        video.currentTime = dur * ratio;
        sync();
    });

    // Volume (mute toggle with restore, supports amplification)
    function notifyVolumeChange() {
        if (typeof state.onVolumeChange === "function") {
            state.onVolumeChange();
        }
    }

    function toggleMute() {
        var cur = Number(volumeRange.value);
        if (cur > 0) {
            state._lastVol = clamp(cur, 0, state._volumeUnlocked ? AUDIO_VOLUME_MAX : AUDIO_VOLUME_NORMAL);
            applyVolume(video, videoGainNode, 0);
            volumeRange.value = "0";
            video.muted = true;
        } else {
            var restore = state._lastVol > 0 ? state._lastVol : AUDIO_VOLUME_NORMAL;
            volumeRange.value = String(restore);
            applyVolume(video, videoGainNode, restore);
            video.muted = false;
        }
        sync();
        notifyVolumeChange();
    }
    volumeBtn.addEventListener("click", toggleMute);
    volumeRange.addEventListener("input", function () {
        var curMax = state._volumeUnlocked ? AUDIO_VOLUME_MAX : AUDIO_VOLUME_NORMAL;
        var v = clamp(Number(volumeRange.value), 0, curMax);
        applyVolume(video, videoGainNode, v);
        video.muted = v <= 0;
        if (v > 0) state._lastVol = v;
        sync();
        notifyVolumeChange();
    });
    volumeRange.addEventListener("wheel", function (e) {
        e.preventDefault();
        e.stopPropagation();
        var curMax = state._volumeUnlocked ? AUDIO_VOLUME_MAX : AUDIO_VOLUME_NORMAL;
        var step = e.deltaY < 0 ? 5 : -5;
        var cur = clamp(Number(volumeRange.value) || 0, 0, curMax);
        var next = clamp(cur + step, 0, curMax);
        volumeRange.value = String(next);
        applyVolume(video, videoGainNode, next);
        video.muted = next <= 0;
        if (next > 0) state._lastVol = next;
        sync();
        notifyVolumeChange();
    }, { passive: false });

    // Video click also toggles play
    video.addEventListener("click", function () {
        if (video.paused || video.ended) {
            video.play().catch(function () {});
            state._hoverPause = true;
        } else {
            video.pause();
        }
    });

    // Hover pause button (show ⏸ when hovering over video during playback)
    container.addEventListener("mouseenter", function () {
        if (!video.paused && !video.ended) {
            state._hoverPause = true;
            overlay.style.display = "flex";
            overlayBtn.textContent = "⏸";
            overlayBtn.setAttribute("aria-label", "Pause");
        }
    });
    container.addEventListener("mouseleave", function () {
        if (state._hoverPause) {
            state._hoverPause = false;
            if (!video.paused && !video.ended) {
                overlay.style.display = "none";
            }
        }
    });

    // Media events
    function onMediaEvent() { sync(); }
    var mediaEvents = ["loadedmetadata", "durationchange", "timeupdate", "seeking", "seeked", "play", "pause", "ended", "volumechange"];
    for (var i = 0; i < mediaEvents.length; i++) {
        video.addEventListener(mediaEvents[i], onMediaEvent);
    }

    state.dispose = function () {
        if (state.disposed) return;
        state.disposed = true;
        if (state.rafId) { cancelAnimationFrame(state.rafId); state.rafId = 0; }
        video.pause();
        video.src = "";
        if (typeof video.load === "function") video.load();
        if (videoGainNode) {
            try { var ac = videoGainNode.context; if (ac && ac.state !== "closed") ac.close(); } catch {}
        }
    };

    state.sync = sync;
    state.toggleMute = toggleMute;
    state.isMuted = function () { return Number(volumeRange.value) <= 0; };
    container.__xmgVideoState = state;
    return { container: container, mediaEl: video, playerState: state };
}

