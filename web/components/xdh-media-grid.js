import {
    BaseElement,
    registerCustomElement,
} from "../core/base-element.js?v=20260403-2";
import { appStore } from "../core/store.js";
import { icon, ICON_CSS, TOOLTIP_CSS } from "../core/icon.js";
import { t } from "../core/i18n.js?v=20260406-16";

function normalizeText(value) {
    return String(value || "").trim();
}

function normalizeNumber(value) {
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
}

function escapeHtml(value) {
    return String(value || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function escapeAttr(value) {
    return escapeHtml(value);
}

const CARD_CLICK_SUPPRESS_MS = 250;

const IMAGE_PREVIEWABLE_EXT = new Set([
    ".png",
    ".jpg",
    ".jpeg",
    ".webp",
    ".bmp",
    ".gif",
]);

const VIDEO_PREVIEW_MIME_BY_EXT = {
    ".mp4": "video/mp4",
    ".webm": "video/webm",
    ".mov": "video/quicktime",
    ".mkv": "video/x-matroska",
    ".avi": "video/x-msvideo",
};

const AUDIO_PREVIEW_MIME_BY_EXT = {
    ".wav": "audio/wav",
    ".mp3": "audio/mpeg",
    ".flac": "audio/flac",
    ".ogg": "audio/ogg",
    ".m4a": "audio/mp4",
};

let cachedVideoPreviewProbe = null;
let cachedAudioPreviewProbe = null;

function hasLoraThumbnail(item) {
    const raw = item?.raw || {};
    const extra = raw.extra || {};
    return normalizeText(extra.thumb_url || raw.thumb_url).length > 0
        || extra.has_thumbnail === true;
}

function getMediaExtension(item) {
    const raw = item?.raw || {};
    const extra = raw.extra || {};
    const source = normalizeText(
        extra.media_ref
        || raw.media_ref
        || raw.ref
        || item?.name
        || raw.title
    );

    if (!source) {
        return "";
    }

    const normalized = source
        .split("?", 1)[0]
        .split("#", 1)[0]
        .replace(/\\/g, "/");
    const lastSegment = normalized.split("/").pop() || normalized;
    const dotIndex = lastSegment.lastIndexOf(".");
    return dotIndex >= 0 ? lastSegment.slice(dotIndex).toLowerCase() : "";
}

function getPreviewProbe(kind) {
    if (typeof document === "undefined"
        || typeof document.createElement !== "function") {
        return null;
    }

    if (kind === "video") {
        cachedVideoPreviewProbe ||= document.createElement("video");
        return cachedVideoPreviewProbe;
    }

    if (kind === "audio") {
        cachedAudioPreviewProbe ||= document.createElement("audio");
        return cachedAudioPreviewProbe;
    }

    return null;
}

function canBrowserPlayMime(kind, mime) {
    const probe = getPreviewProbe(kind);
    if (!probe || typeof probe.canPlayType !== "function") {
        return true;
    }
    return String(probe.canPlayType(mime || "")).trim().length > 0;
}

function isBrowserPreviewSupported(item) {
    if (!item || item.isFolder || item.type === "record" || item.type === "lora") {
        return true;
    }

    const ext = getMediaExtension(item);
    if (!ext) {
        return true;
    }

    if (item.type === "image") {
        return IMAGE_PREVIEWABLE_EXT.has(ext);
    }

    if (item.type === "video") {
        const mime = VIDEO_PREVIEW_MIME_BY_EXT[ext];
        return mime ? canBrowserPlayMime("video", mime) : false;
    }

    if (item.type === "audio") {
        const mime = AUDIO_PREVIEW_MIME_BY_EXT[ext];
        return mime ? canBrowserPlayMime("audio", mime) : false;
    }

    return false;
}

function getCardPreviewState(item, failedThumbIds) {
    if (!item || item.isFolder || item.type === "record" || item.type === "lora") {
        return {
            blocked: false,
            showBadge: false,
            showSummary: false,
            label: "",
            iconName: "eye-off",
            tone: "muted",
            reason: "none",
        };
    }

    const key = String(item.id || "");
    if (failedThumbIds.has(key)) {
        return {
            blocked: true,
            showBadge: true,
            showSummary: false,
            label: t("grid.badge.unsupported_format"),
            iconName: "triangle-alert",
            tone: "warning",
            reason: "load_failed",
        };
    }

    if (item.previewable === false) {
        return {
            blocked: true,
            showBadge: true,
            showSummary: false,
            label: t("grid.badge.no_preview"),
            iconName: "eye-off",
            tone: "muted",
            reason: "preview_disabled",
        };
    }

    if (!isBrowserPreviewSupported(item)) {
        return {
            blocked: true,
            showBadge: true,
            showSummary: false,
            label: t("grid.badge.unsupported_format"),
            iconName: "eye-off",
            tone: "warning",
            reason: "unsupported_preview",
        };
    }

    return {
        blocked: false,
        showBadge: false,
        showSummary: false,
        label: "",
        iconName: "eye-off",
        tone: "muted",
        reason: "ok",
    };
}

function renderCardStatusBadge(previewState) {
    if (!previewState?.showBadge) {
        return "";
    }

    const toneClass = previewState.tone === "warning"
        ? "is-warning"
        : "is-muted";

    return `
        <div class="card-status-badge ${toneClass}">
            ${icon(previewState.iconName, 12)}
            <span>${escapeHtml(previewState.label)}</span>
        </div>`;
}

function syncCardPreviewUi(card, previewState) {
    if (!(card instanceof HTMLElement)) {
        return;
    }

    card.classList.toggle("preview-unavailable", previewState.blocked);

    const previewBtn = card.querySelector(".preview-btn");
    if (previewState.blocked) {
        previewBtn?.remove();
    }

    const thumb = card.querySelector(".thumb-container");
    if (thumb instanceof HTMLElement) {
        thumb.classList.toggle("preview-blocked", previewState.blocked);
        let badge = thumb.querySelector(".card-status-badge");
        if (previewState.showBadge) {
            if (!(badge instanceof HTMLElement)) {
                badge = document.createElement("div");
                thumb.appendChild(badge);
            }
            badge.className = [
                "card-status-badge",
                previewState.tone === "warning" ? "is-warning" : "is-muted",
            ].join(" ");
            badge.innerHTML = `${icon(previewState.iconName, 12)}<span>${escapeHtml(previewState.label)}</span>`;
        } else {
            badge?.remove();
        }
    }

    const textHost = card.querySelector(".card-text");
    if (!(textHost instanceof HTMLElement)) {
        return;
    }

    let summary = textHost.querySelector(".card-summary");
    if (previewState.showSummary) {
        if (!(summary instanceof HTMLElement)) {
            summary = document.createElement("div");
            summary.className = "card-summary";
            textHost.appendChild(summary);
        }
        summary.textContent = previewState.label;
    } else {
        summary?.remove();
    }
}

function getCardSummaryLabels(item, failedThumbIds) {
    if (!item || item.isFolder || item.type === "record") {
        return [];
    }

    const labels = [];
    const previewState = getCardPreviewState(item, failedThumbIds);
    if (previewState.showSummary) {
        labels.push(previewState.label);
    }

    return labels;
}

function renderLoraMeta(item) {
    const meta = getLoraMetaState(item);
    const badges = [];

    if (meta.hasStrength) {
        badges.push(`
            <span class="lora-badge is-active">
                ${icon("settings", 10)}
                <span>${t("lora.badge.strength")}</span>
            </span>`);
    }

    if (meta.hasNote) {
        badges.push(`
            <span class="lora-badge is-active">
                ${icon("file", 10)}
                <span>${t("lora.label.note")}</span>
            </span>`);
    }

    if (meta.hasTriggerWords) {
        badges.push(`
            <span class="lora-badge is-active">
                ${icon("wand-sparkles", 10)}
                <span>${t("lora.badge.trigger")}</span>
            </span>`);
    }

    if (badges.length === 0) {
        return "";
    }

    return `
        <div class="card-meta-overlay lora-meta-overlay">
            ${badges.join("")}
        </div>`;
}

function normalizeTriggerWords(value) {
    if (Array.isArray(value)) {
        return value
            .map(entry => {
                if (typeof entry === "string") {
                    return entry.trim();
                }
                if (entry && typeof entry === "object") {
                    return String(entry.text || entry.word || "").trim();
                }
                return "";
            })
            .filter(Boolean);
    }

    if (typeof value === "string") {
        const trimmed = value.trim();
        if (!trimmed) return [];
        if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
            try {
                return normalizeTriggerWords(JSON.parse(trimmed));
            } catch {
                // Fall through to plain-text splitting.
            }
        }
        return trimmed
            .split(/\r?\n|,|\|/)
            .map(part => part.trim())
            .filter(Boolean);
    }

    if (value && typeof value === "object") {
        return normalizeTriggerWords(
            value.trigger_words || value.words || value.text || ""
        );
    }

    return [];
}

function getLoraMetaState(item) {
    const raw = item?.raw || {};
    const extra = raw.extra || {};
    const triggerWords = normalizeTriggerWords(
        extra.trigger_words
        || raw.trigger_words
        || extra.trigger_words_json
        || raw.trigger_words_json
    );
    const note = normalizeText(extra.lora_note || raw.lora_note);
    const modelStrength = normalizeNumber(
        extra.strength_model ?? raw.strength_model
    );
    const clipStrength = normalizeNumber(
        extra.strength_clip ?? raw.strength_clip
    );
    return {
        hasTriggerWords: triggerWords.length > 0,
        hasNote: note.length > 0,
        hasStrength: (
            (modelStrength !== null && Math.abs(modelStrength - 1) > 1e-6)
            || (clipStrength !== null && Math.abs(clipStrength - 1) > 1e-6)
        ),
    };
}

/**
 * Generate the thumbnail HTML block for a card based on its type.
 * - image/lora : contained image thumbnail
 * - video      : <video muted preload="metadata"> + play overlay
 * - audio      : gradient art card with waveform icon
 * - folder     : small centered SVG icon
 */
function thumbFor(item, previewState = null) {
    const safeUrl = escapeAttr(String(item.thumbUrl || ""));
    const extra = item.raw?.extra || {};
    const isEmptyThumb = safeUrl.length === 0;
    const showLivePreview = !previewState?.blocked;
    const statusBadgeHtml = renderCardStatusBadge(previewState);
    const fallbackHtml = `
        <div class="thumb-fallback">${icon(isEmptyThumb ? "image-off" : "triangle-alert", 22)}</div>`;
    const metaHtml = item.type === "lora"
        ? renderLoraMeta(item)
        : extra.mtime
        ? `<div class="card-meta-overlay">`
            + `<span class="meta-date">${formatDate(extra.mtime)}</span>`
            + `</div>`
        : "";
    switch (item.type) {
        case "audio":
            return `
                <div class="thumb-container audio-thumb">
                    ${statusBadgeHtml}
                    <span class="audio-icon">${icon("audio-lines", 40)}</span>
                </div>`;
        case "video":
            return `
                <div class="thumb-container ${isEmptyThumb ? "thumb-empty" : ""} ${showLivePreview ? "" : "preview-blocked"}">
                    ${showLivePreview && safeUrl ? `<img class="thumb-img" src="${safeUrl}" alt=""
                           loading="lazy" onerror="this.style.display='none'"/>` : ""}
                    ${fallbackHtml}
                    ${statusBadgeHtml}
                    ${metaHtml}
                    ${showLivePreview ? `<div class="play-overlay">${icon("video", 18)}</div>` : ""}
                </div>`;
        case "folder":
            return `
                <div class="thumb-container folder-thumb">
                    <img class="thumb-img" src="${safeUrl}" alt=""
                         loading="lazy" onerror="this.style.display='none'"/>
                </div>`;
        default:
            return `
                 <div class="thumb-container ${isEmptyThumb ? "thumb-empty" : ""} ${showLivePreview ? "" : "preview-blocked"}">
                    ${showLivePreview && safeUrl ? `<img class="thumb-img" src="${safeUrl}" alt=""
                        loading="lazy" onerror="this.style.display='none'"/>` : ""}
                    ${fallbackHtml}
                    ${statusBadgeHtml}
                    ${metaHtml}
                </div>`;
    }
}

function formatSize(bytes) {
    if (!bytes) return "";
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(mtime) {
    if (!mtime) return "";
    const d = new Date(mtime * 1000);
    return `${d.getMonth() + 1}/${d.getDate()} `
        + `${String(d.getHours()).padStart(2, "0")}`
        + `:${String(d.getMinutes()).padStart(2, "0")}`;
}

function formatDateFull(mtime) {
    if (!mtime) return "";
    const d = new Date(mtime * 1000);
    return `${d.getFullYear()}-`
        + `${String(d.getMonth() + 1).padStart(2, "0")}-`
        + `${String(d.getDate()).padStart(2, "0")} `
        + `${String(d.getHours()).padStart(2, "0")}`
        + `:${String(d.getMinutes()).padStart(2, "0")}`
        + `:${String(d.getSeconds()).padStart(2, "0")}`;
}

function isFolderItem(item) {
    return !!(item?.isFolder || item?.type === "folder");
}

function compareSortedItems(left, right, sortOrder) {
    const leftIsFolder = isFolderItem(left);
    const rightIsFolder = isFolderItem(right);

    if (leftIsFolder !== rightIsFolder) {
        return leftIsFolder ? -1 : 1;
    }

    switch (sortOrder) {
        case "name-asc":
            return left.name.localeCompare(right.name);
        case "name-desc":
            return right.name.localeCompare(left.name);
        case "date-asc":
            return (left.mtime || 0) - (right.mtime || 0);
        case "date-desc":
            return (right.mtime || 0) - (left.mtime || 0);
        default:
            return 0;
    }
}

// Sort helper — pure function, no side-effects
function applySort(items, sortOrder) {
    return [...items].sort((left, right) =>
        compareSortedItems(left, right, sortOrder)
    );
}

export class XdhMediaGrid extends BaseElement {
    constructor() {
        super();
        this.items = [];
        this.failedThumbIds = new Set();
        this._gridInitialized = false;
        this._suppressCardClickUntil = 0;
    }

    /**
     * 覆写 renderRoot：首次完整初始化，后续只更新 .grid 内容。
     * 避免每次重建巨大的 <style> 块，大幅降低滚动/筛选时的 CPU 开销。
     */
    renderRoot() {
        if (!this.shadowRoot) return;

        const isRecordView = ["history", "favorites"].includes(
            appStore.state.activeCategory
        );
        // 控制 host 可见性，不依赖 <style> 内联，避免重建样式
        this.style.display = isRecordView ? "none" : "";

        if (!this._gridInitialized) {
            this._gridInitialized = true;
            // 首次：完整渲染（含 <style> 块 + shell）
            super.renderRoot();
            return; // super.renderRoot() 内部已调用 bindEvents
        }

        // 后续：只更新 .grid 内容，不碰 <style>
        const grid = this.$(".grid");
        if (grid) {
            const cardSize = appStore.state.cardSize || "small";
            grid.dataset.size = cardSize;
            grid.innerHTML = this._renderCards();
        }
        if (this.bindEvents) this.bindEvents();
    }

    onStoreUpdate(state, key, value) {
        if (
            key === "mediaList"
            || key === "sortOrder"
            || key === "activeCategory"
            || key === "locale"
            || key === "searchQuery"
            || key === "loadError"
        ) {
            // Full re-render needed (order or dataset changed)
            if (key === "mediaList") {
                this.items = value;
                const validIds = new Set((value || []).map(item => String(item.id)));
                this.failedThumbIds = new Set(
                    [...this.failedThumbIds].filter(id => validIds.has(id))
                );
            }
            this.renderRoot();
        } else if (key === "selectedItems") {
            // Partial: only update CSS classes — no DOM rebuild
            this._syncSelectionClasses();
        } else if (key === "cardSize") {
            // Partial: update data-size attribute — CSS handles the rest
            this._syncCardSize();
        }
    }

    _syncSelectionClasses() {
        const selected = appStore.state.selectedItems || [];
        this.$$(".media-card").forEach(card => {
            card.classList.toggle("selected", selected.includes(card.dataset.id));
        });
    }

    _syncCardSize() {
        const grid = this.$(".grid");
        if (grid) grid.dataset.size = appStore.state.cardSize || "small";
    }

    _markThumbFailed(itemId) {
        const key = String(itemId || "");
        if (!key || this.failedThumbIds.has(key)) return;
        this.failedThumbIds.add(key);
        const item = this._itemMap?.get(key);
        const previewState = getCardPreviewState(item, this.failedThumbIds);
        const card = this.$(`.media-card[data-id="${CSS.escape(key)}"]`);
        if (card) {
            card.classList.add("thumb-failed");
            syncCardPreviewUi(card, previewState);
        } else {
            // 卡片还未在 DOM 中（初次渲染前），才触发重渲
            this.renderRoot();
        }
    }

    _filteredItems() {
        const sortOrder = appStore.state.sortOrder || "date-desc";
        const searchQ = String(appStore.state.searchQuery || "")
            .toLowerCase()
            .trim();
        const sortedItems = applySort(this.items, sortOrder);
        return searchQ
            ? sortedItems.filter((item) =>
                String(item.name || "").toLowerCase().includes(searchQ)
            )
            : sortedItems;
    }

    _previewItems() {
        return this._filteredItems().filter((item) => {
            if (item?.isFolder || !item?.previewable) {
                return false;
            }
            const previewState = getCardPreviewState(item, this.failedThumbIds);
            return !previewState.blocked;
        });
    }

    _buildPreviewDetail(item) {
        if (!item) {
            return null;
        }
        return {
            id: String(item.id || ""),
            name: item.name,
            url: item.fullUrl || item.thumbUrl,
            type: item.type || "image",
            iconHtml: icon("audio-lines", 56),
        };
    }

    _buildPreviewNavigation(activeId) {
        const previewItems = this._previewItems();
        if (!previewItems.length) {
            return null;
        }
        return {
            items: previewItems.map((item) => ({
                id: String(item.id || ""),
                name: String(item.name || ""),
                type: item.type || "image",
                thumbnailUrl: String(item.thumbUrl || ""),
            })),
            activeId: String(activeId || ""),
            resolveById: (targetId) => {
                const normalizedId = String(targetId || "");
                const target = previewItems.find(
                    (item) => String(item.id || "") === normalizedId
                );
                return this._buildPreviewDetail(target);
            },
        };
    }

    bindEvents() {
        const grid = this.$(".grid");
        if (!grid) return;

        // ── 只在首次绑定时附加委托监听器 ──────────────────────────────────
        // 通过标记避免重复绑定（grid 每次 innerHTML 更新后是同一个节点）
        if (!grid._xdhBound) {
            grid._xdhBound = true;

            // 单一 click 委托
            grid.addEventListener("click", (e) => {
                // Preview button
                const prevBtn = e.target.closest(".preview-btn");
                if (prevBtn) {
                    e.stopPropagation();
                    const card = prevBtn.closest(".media-card");
                    const id = card?.dataset?.id;
                    const item = id ? this._itemMap?.get(id) : null;
                    const detail = this._buildPreviewDetail(item);
                    if (detail) {
                        document.dispatchEvent(new CustomEvent("xdh:preview", {
                            detail: {
                                ...detail,
                                navigation: this._buildPreviewNavigation(item.id),
                            },
                        }));
                    }
                    return;
                }

                // Lora edit button
                const editBtn = e.target.closest(".edit-lora-btn");
                if (editBtn) {
                    e.stopPropagation();
                    document.dispatchEvent(new CustomEvent("xdh:lora-detail", {
                        detail: { ref: editBtn.dataset.loraref }
                    }));
                    return;
                }

                // Card click (selection / folder nav)
                const card = e.target.closest(".media-card");
                if (!card) return;
                if (Date.now() < this._suppressCardClickUntil) {
                    e.preventDefault();
                    return;
                }
                e.preventDefault();
                const id = card.dataset.id;
                const item = this._itemMap?.get(id);

                if (item?.isFolder) {
                    const nextFolder = item.childPath || item.raw?.extra?.child_path || "";
                    const nextLabel  = item.name || nextFolder;
                    const truncated  = appStore.state.navHistory.slice(
                        0, appStore.state.navIndex + 1
                    );
                    truncated.push({
                        category: appStore.state.activeCategory,
                        folder: nextFolder, folderLabel: nextLabel, page: 1,
                    });
                    appStore.state.navHistory = truncated;
                    appStore.state.navIndex   = truncated.length - 1;
                    appStore.state.currentPage = 1;
                    appStore.state.activeFolder = nextFolder;
                    appStore.state.activeFolderLabel = nextLabel;
                    appStore.state.selectedItems = [];
                    return;
                }

                appStore.state.selectedItems = [id];
            });

            // 单一 dragstart 委托
            grid.addEventListener("dragstart", (e) => {
                const card = e.target.closest(".media-card");
                if (!card) return;
                this._suppressCardClickUntil = Date.now()
                    + CARD_CLICK_SUPPRESS_MS;
                const id   = card.dataset.id;
                const item = this._itemMap?.get(id);
                if (!item || item.isFolder || item.type === "record") {
                    e.preventDefault(); return;
                }
                const extra    = item.raw?.extra || {};
                const mediaRef = String(extra.media_ref || item.raw?.media_ref || item.raw?.ref || "");
                const mediaType = String(item.type || "image").toLowerCase();
                const payload  = {
                    source: "xdatahub",
                    media_ref: mediaRef, media_type: mediaType,
                    title: String(item.title || item.name || ""),
                };
                if (mediaType === "lora") {
                    payload.thumb_url = String(extra.thumb_url || "");
                    if (extra.strength_model != null) payload.strength_model = Number(extra.strength_model);
                    if (extra.strength_clip  != null) payload.strength_clip  = Number(extra.strength_clip);
                }
                e.dataTransfer.setData("application/x-xdatahub-media+json", JSON.stringify(payload));
                card.style.opacity = "0.5";
            });

            grid.addEventListener("dragend", (e) => {
                this._suppressCardClickUntil = Date.now()
                    + CARD_CLICK_SUPPRESS_MS;
                const card = e.target.closest(".media-card");
                if (card) card.style.opacity = "1";
            });

            // 单一 mouseover 委托：card-title tooltip
            const tt = this.$("#xdh-tt");
            if (tt) {
                grid.addEventListener("mouseover", (e) => {
                    const titleEl = e.target.closest(".card-title");
                    if (!titleEl) return;
                    const card = titleEl.closest(".media-card");
                    if (!card || card.classList.contains("is-folder")) return;
                    const mtime  = card.dataset.mtime;
                    const size   = card.dataset.size;
                    const isLora = card.dataset.type === "lora";
                    const metaParts = isLora ? [] : [
                        formatDateFull(parseFloat(mtime)),
                        formatSize(parseInt(size, 10)),
                    ].filter(Boolean);
                    const titleLine = document.createElement("span");
                    titleLine.className = "filename-tooltip-title";
                    titleLine.textContent = String(titleEl.textContent || "");

                    const nodes = [titleLine];
                    if (metaParts.length) {
                        const metaLine = document.createElement("span");
                        metaLine.className = "filename-tooltip-meta";
                        metaLine.textContent = metaParts.join(" · ");
                        nodes.push(metaLine);
                    }

                    tt.replaceChildren(...nodes);
                    tt.classList.add("visible");
                });
                grid.addEventListener("mouseout", (e) => {
                    if (!e.target.closest(".card-title")) return;
                    tt.classList.remove("visible");
                });
                // Follow cursor using a single persistent listener on the grid
                grid.addEventListener("mousemove", (e) => {
                    if (!tt.classList.contains("visible")) return;
                    tt.style.left = Math.min(e.clientX + 12, window.innerWidth - tt.offsetWidth - 8) + "px";
                    tt.style.top  = (e.clientY + 18) + "px";
                });
            }

            // img/video error 委托（error 不冒泡，需捕获阶段）
            grid.addEventListener("error", (e) => {
                const tgt = e.target;
                if (!(tgt instanceof HTMLImageElement || tgt instanceof HTMLVideoElement)) return;
                const card = tgt.closest(".media-card");
                if (!card) return;
                this._markThumbFailed(card.dataset.id);
            }, true /* capture */);
        }

        // 每次 DOM 更新后重建 id→item 查找表（O(n) 一次，替代 O(n²) find）
        this._itemMap = new Map(
            (appStore.state.mediaList || []).map(item => [item.id, item])
        );

        this._syncCardSize();
    }

    /** 只渲染卡片列表 HTML（.grid 内部），不含 <style> */
    _renderCards() {
        const selectedItems = appStore.state.selectedItems || [];
        const filteredItems = this._filteredItems();
        const searchQ = String(appStore.state.searchQuery || "")
            .toLowerCase()
            .trim();
        const loadError = String(appStore.state.loadError || "").trim();

        if (loadError) {
            return `
                <div class="empty-state is-error">
                    <span class="empty-icon">${icon("triangle-alert", 18)}</span>
                    <span>${loadError}</span>
                </div>`;
        }

        if (filteredItems.length === 0) {
            return `<div class="empty-state">${t(searchQ ? "grid.empty_search" : "grid.empty")}</div>`;
        }
        return filteredItems.map(item => {
            const previewState = getCardPreviewState(item, this.failedThumbIds);
            const isSelected = selectedItems.includes(item.id);
            const safeId = escapeAttr(String(item.id || ""));
            const safeName = escapeHtml(String(item.name || ""));
            const safeNameAttr = escapeAttr(String(item.name || ""));
            const safeUrl = escapeAttr(String(item.thumbUrl || ""));
            const safeType = escapeAttr(String(item.type || "image"));
            const safeLoraRef = escapeAttr(String(
                item.raw?.extra?.media_ref || item.raw?.media_ref
                || item.raw?.ref || ""
            ));
            const safeSize = escapeAttr(String(
                item.type === "lora" ? "" : item.raw?.extra?.size || ""
            ));
            const safeMtime = escapeAttr(String(
                item.type === "lora" ? "" : item.raw?.extra?.mtime || ""
            ));
            const summaryLabels = getCardSummaryLabels(item, this.failedThumbIds);
            const hasThumbFailure = this.failedThumbIds.has(String(item.id));
            const previewBtn = item.previewable && !previewState.blocked
                ? `<button class="preview-btn xdh-tooltip xdh-tooltip-down" data-preview="${safeId}" data-tooltip="${t("grid.btn.preview")}">${icon("eye", 14)}</button>`
                : "";
            const editBtn = item.type === "lora"
                ? `<button class="edit-lora-btn xdh-tooltip xdh-tooltip-down" data-loraref="${safeLoraRef}" data-tooltip="${t("grid.btn.edit_lora")}">${icon("settings", 14)}</button>`
                : "";
            return `<div class="media-card ${isSelected ? "selected" : ""} ${item.isFolder ? "is-folder" : ""} ${hasThumbFailure ? "thumb-failed" : ""} ${previewState.blocked ? "preview-unavailable" : ""}"
                 draggable="${item.isFolder || item.type === "record" ? "false" : "true"}"
                 data-id="${safeId}"
                 data-name="${safeNameAttr}"
                 data-url="${safeUrl}"
                 data-type="${safeType}"
                 data-size="${safeSize}"
                 data-mtime="${safeMtime}">
                <div class="card-actions">${editBtn}${previewBtn}</div>
                ${thumbFor(item, previewState)}
                <div class="card-text">
                    <div class="card-title">${safeName}</div>
                    ${summaryLabels.length > 0
                        ? `<div class="card-summary">${summaryLabels.join(" · ")}</div>`
                        : ""}
                </div>
            </div>`;
        }).join("");
    }

    render() {
        const cardSize = appStore.state.cardSize || "small";

        return `
            <style>
                ${ICON_CSS}
                ${TOOLTIP_CSS}
                :host { display: block; }
                .grid {
                    display: grid;
                    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
                    gap: 16px;
                    padding: 16px 17px 16px 16px;
                }
                .grid[data-size="small"]  { grid-template-columns: repeat(auto-fill, minmax(100px, 1fr)); gap: 16px; padding: 16px 17px 16px 16px; }
                .grid[data-size="medium"] { grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 16px; padding: 16px 17px 16px 16px; }
                .grid[data-size="large"]  { grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 16px; padding: 16px 17px 16px 16px; }

                .media-card {
                    background: var(--xdh-color-surface-1, #1e1e1e);
                    border: 1px solid var(--xdh-color-border, #333);
                    border-radius: 8px;
                    cursor: grab;
                    transition: transform 0.18s ease, box-shadow 0.18s ease, border-color 0.18s ease;
                    position: relative;
                    user-select: none;
                    overflow: hidden;
                    display: flex;
                    flex-direction: column;
                }
                .media-card.is-folder {
                    cursor: pointer;
                }
                .media-card:hover {
                    transform: translateY(-2px);
                    box-shadow: 0 6px 16px rgba(0,0,0,0.4);
                    border-color: var(--xdh-color-primary, #4499ff);
                }
                .media-card.selected {
                    border-color: var(--xdh-color-success, #4caf50);
                    box-shadow: 0 0 0 2px var(--xdh-color-success, #4caf50);
                }
                .media-card[hidden] { display: none; }

                /* ── Card actions (top-right, appears on hover) ── */
                .card-actions {
                    position: absolute;
                    top: 6px;
                    left: 6px;
                    right: 6px;
                    display: flex;
                    justify-content: flex-end;
                    align-items: flex-start;
                    gap: 6px;
                    opacity: 0;
                    pointer-events: none;
                    transition: opacity 0.18s ease;
                    z-index: 2;
                }
                .media-card:hover .card-actions {
                    opacity: 1;
                    pointer-events: auto;
                }

                .preview-btn, .edit-lora-btn {
                    width: 26px;
                    height: 26px;
                    border-radius: 8px;
                    background: rgba(28,28,28,0.88);
                    border: 1px solid rgba(255,255,255,0.14);
                    color: #fff;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    cursor: pointer;
                    transition: background 0.15s, transform 0.15s;
                    flex-shrink: 0;
                    padding: 0;
                }
                .preview-btn:hover, .edit-lora-btn:hover {
                    background: rgba(52,52,52,0.96);
                    transform: scale(1.08);
                }

                /* ── Thumbnail container ── */
                .thumb-container {
                    width: 100%;
                    aspect-ratio: 1;
                    position: relative;
                    overflow: hidden;
                    pointer-events: none;
                    flex-shrink: 0;
                    background: var(--xdh-color-surface-2, #1a1a1a);
                }

                .thumb-img {
                    position: relative;
                    width: 100%;
                    height: 100%;
                    object-fit: contain;
                    z-index: 1;
                    display: block;
                }

                /* Folder: small centered icon */
                .folder-thumb .thumb-img {
                    position: absolute;
                    top: 50%;
                    left: 50%;
                    transform: translate(-50%, -50%);
                    width: 48%;
                    height: 48%;
                    object-fit: contain;
                    z-index: 1;
                }

                /* Video thumbnail */
                .thumb-video {
                    width: 100%;
                    height: 100%;
                    object-fit: contain;
                    display: block;
                }
                .play-overlay {
                    position: absolute;
                    inset: 0;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    z-index: 2;
                    background: rgba(0,0,0,0.22);
                    color: rgba(255,255,255,0.8);
                    pointer-events: none;
                    transition: background 0.15s;
                }
                .media-card:hover .play-overlay {
                    background: rgba(0,0,0,0.38);
                }

                /* Audio card: gradient art */
                .audio-thumb {
                    background: linear-gradient(
                        135deg,
                        #171b2b 0%,
                        #221d3c 45%,
                        #172a2a 100%
                    );
                    display: flex;
                    align-items: center;
                    justify-content: center;
                }
                .audio-icon {
                    color: rgba(150, 175, 220, 0.42);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                }

                /* Hover metadata overlay — slides over thumbnail bottom */
                .card-meta-overlay {
                    position: absolute;
                    bottom: 0;
                    left: 0;
                    right: 0;
                    display: flex;
                    justify-content: space-between;
                    align-items: flex-end;
                    padding: 20px 6px 5px;
                    background: linear-gradient(
                        transparent,
                        rgba(0,0,0,0.72)
                    );
                    color: rgba(255,255,255,0.88);
                    font-size: 10px;
                    line-height: 1;
                    opacity: 0;
                    transition: opacity 0.18s;
                    z-index: 3;
                    pointer-events: none;
                }
                .media-card:hover .card-meta-overlay { opacity: 1; }

                .lora-meta-overlay {
                    justify-content: flex-start;
                    align-items: center;
                    gap: 6px;
                    flex-wrap: wrap;
                    padding: 0 8px 8px;
                    background: linear-gradient(
                        transparent,
                        color-mix(
                            in srgb,
                            var(--xdh-color-surface-1, #1e1e1e) 92%,
                            transparent
                        )
                    );
                }
                .lora-badge {
                    display: inline-flex;
                    align-items: center;
                    gap: 4px;
                    min-height: 22px;
                    padding: 0 7px;
                    border-radius: 999px;
                    border: 1px solid var(--xdh-color-border, #333);
                    background: var(--xdh-color-surface-2, #2a2a2a);
                    color: var(--xdh-color-text-secondary, #aaa);
                    font-size: 10px;
                    font-weight: 600;
                    letter-spacing: 0.02em;
                }
                .lora-badge.is-active {
                    border-color: var(--xdh-brand-pink, #EA005E);
                    color: var(--xdh-color-text-primary, #f0f0f0);
                    background: color-mix(
                        in srgb,
                        var(--xdh-color-surface-2, #2a2a2a) 78%,
                        var(--xdh-color-primary, #EA005E) 22%
                    );
                }

                .card-status-badge {
                    position: absolute;
                    top: 8px;
                    left: 8px;
                    z-index: 4;
                    display: inline-flex;
                    align-items: center;
                    gap: 4px;
                    max-width: calc(100% - 16px);
                    min-height: 22px;
                    padding: 0 7px;
                    border-radius: 6px;
                    border: 1px solid var(--xdh-color-border, #333);
                    background: color-mix(
                        in srgb,
                        var(--xdh-color-surface-2, #2a2a2a) 84%,
                        transparent
                    );
                    color: var(--xdh-color-text-primary, #f0f0f0);
                    font-size: 10px;
                    font-weight: 600;
                    letter-spacing: 0.02em;
                    pointer-events: none;
                }
                .card-status-badge span {
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                }
                .card-status-badge.is-muted {
                    color: var(--xdh-color-text-secondary, #aaa);
                }
                .card-status-badge.is-warning {
                    border-color: var(--xdh-brand-pink, #EA005E);
                    background: color-mix(
                        in srgb,
                        var(--xdh-color-surface-2, #2a2a2a) 78%,
                        var(--xdh-brand-pink, #EA005E) 22%
                    );
                }

                .thumb-failed .thumb-img,
                .thumb-failed .thumb-video,
                .preview-blocked .thumb-img,
                .preview-blocked .thumb-video,
                .thumb-failed .play-overlay {
                    display: none;
                }
                .thumb-fallback {
                    position: absolute;
                    inset: 0;
                    display: none;
                    align-items: center;
                    justify-content: center;
                    color: rgba(255,255,255,0.42);
                    z-index: 1;
                }
                .thumb-empty .thumb-fallback,
                .preview-blocked .thumb-fallback,
                .thumb-failed .thumb-fallback {
                    display: flex;
                }

                .card-text {
                    display: flex;
                    flex-direction: column;
                    gap: 2px;
                    padding: 7px 8px 8px;
                }
                .card-title {
                    font-size: 12px;
                    color: var(--xdh-color-text-secondary, #aaa);
                    text-overflow: ellipsis;
                    overflow: hidden;
                    white-space: nowrap;
                    text-align: center;
                }
                .card-summary {
                    min-height: 14px;
                    font-size: 10px;
                    line-height: 1.4;
                    text-align: center;
                    color: var(--xdh-color-text-secondary, #777);
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                }

                .empty-state {
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    gap: 8px;
                    padding: 48px 24px;
                    text-align: center;
                    color: var(--xdh-color-text-secondary, #666);
                    grid-column: 1 / -1;
                    font-size: 14px;
                }
                .empty-state.is-error {
                    color: var(--xdh-brand-pink, #EA005E);
                }
                .empty-icon {
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                }

                /* Filename tooltip */
                .filename-tooltip {
                    position: fixed;
                    z-index: 9999;
                    max-width: 320px;
                    padding: 5px 9px;
                    background: var(--xdh-color-surface-3, #2a2a2a);
                    color: var(--xdh-color-text-primary, #e8e8e8);
                    font-size: 12px;
                    line-height: 1.5;
                    border-radius: 6px;
                    border: 1px solid var(--xdh-color-border, #444);
                    box-shadow: 0 4px 12px rgba(0,0,0,0.45);
                    pointer-events: none;
                    word-break: break-all;
                    opacity: 0;
                    transition: opacity 0.12s;
                }
                .filename-tooltip-title {
                    display: block;
                    color: var(--xdh-color-text-primary, #e8e8e8);
                    word-break: break-all;
                }
                .filename-tooltip-meta {
                    display: block;
                    margin-top: 4px;
                    color: var(--xdh-color-text-secondary, #888);
                    font-size: 10px;
                }
                .filename-tooltip.visible { opacity: 1; }
            </style>

            <div class="grid" data-size="${cardSize}">
                ${this._renderCards()}
            </div>
            <div class="filename-tooltip" id="xdh-tt"></div>
        `;
    }
}

registerCustomElement("xdh-media-grid", XdhMediaGrid);


