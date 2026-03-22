const TABS = [
    { id: "history", label: "历史数据" },
    { id: "image", label: "图片" },
    { id: "video", label: "视频" },
    { id: "audio", label: "音频" },
];

const DEFAULT_STATE = {
    page: 1,
    pageSize: 50,
    selectedId: "",
    scrollTop: 0,
    detailCollapsed: false,
    splitRatio: 0.45,
    drawerOpen: false,
    compactFiltersExpanded: false,
    filtersSidebarOpen: false,
    cleanupDbName: "",
    cleanupDeleteAll: false,
    mediaRoot: "input",
    mediaSubdir: "",
    mediaBackStack: [],
    mediaForwardStack: [],
    historySortOrder: "desc",
    lastOpenedMediaId: "",
    lastOpenedMediaUrl: "",
    filters: {
        keyword: "",
        dataType: "",
        source: "",
        dbName: "",
        start: "",
        end: "",
    },
};

const appState = {
    activeTab: "history",
    filtersSidebarOpen: false,
    loading: false,
    error: "",
    items: [],
    total: 0,
    totalPages: 1,
    lockState: { state: "IDLE", readonly: false, cooldown_ms: 0 },
    requests: new Map(),
    lockPollTimer: 0,
    lockWs: null,
    imagePreview: {
        open: false,
        kind: "image",
        url: "",
        title: "",
        scale: 1,
        offsetX: 0,
        offsetY: 0,
        naturalWidth: 0,
        naturalHeight: 0,
        dragging: false,
        dragStartX: 0,
        dragStartY: 0,
        dragOriginX: 0,
        dragOriginY: 0,
    },
    mediaResolutionCache: new Map(),
    copyNotice: {
        text: "",
        error: false,
        timer: 0,
    },
    historyDetailRaw: false,
    selectedItemCache: new Map(),
    splitDrag: {
        active: false,
        move: null,
        up: null,
    },
    compactActionsMenuOpen: false,
    dateRangePanelOpen: false,
    recordFacets: {
        dbNames: [],
        dataTypes: [],
        sources: [],
    },
    scopedFacets: {
        dbNameKey: "",
        dataTypes: [],
        sources: [],
    },
    facetDropdown: {
        open: false,
        fieldId: "",
    },
    dangerDialog: {
        open: false,
        kind: "",
        input: "",
        meta: {},
    },
    dangerDialogResolver: null,
    dbDeleteDialogOpen: false,
    dbDeleteLoading: false,
    dbDeleteError: "",
    dbDeleteResult: "",
    clearDataMode: "records",
    dbFileList: [],
    selectedDbFiles: [],
    unlockCritical: false,
    confirmYes: "",
    confirmYesCritical: "",
    dbRefreshLockedUntil: 0,
    dbRefreshLockTimer: 0,
    dbRefreshDebounceTimer: 0,
    dbRefreshInFlight: false,
    dataActionLockedUntil: 0,
    dataActionLockTimer: 0,
    dataActionInFlight: false,
    searchLockedUntil: 0,
    searchLockTimer: 0,
    searchDebounceTimer: 0,
    searchInFlight: false,
    settingsDialogOpen: false,
    settingsSaving: false,
    settingsError: "",
    settingsDraft: null,
    settings: {
        showMediaChipType: true,
        showMediaChipResolution: true,
        showMediaChipDatetime: true,
        showMediaChipSize: true,
        videoPreviewAutoplay: false,
        videoPreviewMuted: true,
        audioPreviewAutoplay: false,
        audioPreviewMuted: false,
        mediaSortBy: "mtime",
        mediaSortOrder: "desc",
        mediaCardSizePreset: "standard",
    },
    videoLoadQueue: [],
    videoActiveLoads: 0,
    videoSchedulerTimer: 0,
    videoCardStateMap: new Map(),
    videoSchedulerSeq: 0,
    videoWatchdogMap: new Map(),
    mediaListenerRegistry: new WeakMap(),
    mediaQueueRebuildTimer: 0,
};
let historyRowExtraLayoutRaf = 0;
let topActionCompactRaf = 0;

const tabStates = {};
for (const tab of TABS) {
    tabStates[tab.id] = loadTabState(tab.id);
}
appState.filtersSidebarOpen = loadGlobalFiltersSidebarState();

const root = document.getElementById("app");
const DB_LIST_REFRESH_LOCK_MS = 1200;
const DB_LIST_REFRESH_DEBOUNCE_MS = 220;
const SEARCH_LOCK_MS = 900;
const SEARCH_DEBOUNCE_MS = 220;
const DATA_ACTION_LOCK_MS = 1800;
const MAX_MEDIA_RESOLUTION_CACHE = 2000;
const MEDIA_SORT_BY_VALUES = new Set(["mtime", "name", "size"]);
const MEDIA_SORT_ORDER_VALUES = new Set(["asc", "desc"]);
const MEDIA_CARD_SIZE_PRESET_VALUES = new Set([
    "compact",
    "standard",
    "large",
]);
const VIDEO_SCHEDULER_MAX_CONCURRENCY = 2;
const VIDEO_SCHEDULER_BATCH_SIZE = 4;
const VIDEO_SCHEDULER_BATCH_DELAY_MS = 120;
const VIDEO_SCHEDULER_TIME_BUDGET_MS = 8;
const VIDEO_LOAD_TIMEOUT_MS = 2200;
const MEDIA_NAV_STACK_LIMIT = 60;
const ICON_BASE_PATH = "/extensions/ComfyUI-Xz3r0-Nodes/icons";
const DB_ACCENT_PALETTE = [
    "var(--db-accent-01)",
    "var(--db-accent-02)",
    "var(--db-accent-03)",
    "var(--db-accent-04)",
    "var(--db-accent-05)",
    "var(--db-accent-06)",
    "var(--db-accent-07)",
    "var(--db-accent-08)",
    "var(--db-accent-09)",
    "var(--db-accent-10)",
    "var(--db-accent-11)",
    "var(--db-accent-12)",
];
// 设计说明：
// 1) 视频继续使用分批调度，目的是限制首帧解码并发，避免大目录下
//    CPU/GPU 瞬时压力过高造成页面卡顿。
// 2) 图片固定使用浏览器原生加载（直接 <img src>），这是刻意设计，
//    不是遗漏。此前图片分批方案在极端滚动/超时场景会出现黑块与
//    挂起体验，回退原生策略后稳定性更高。

const FOCUSABLE_IDS = new Set([
    "filter-keyword",
    "filter-data-type",
    "filter-source",
    "filter-db-name",
    "filter-start",
    "filter-end",
    "page-jump",
]);

function cloneDefaultState() {
    return JSON.parse(JSON.stringify(DEFAULT_STATE));
}

function debounce(fn, delay) {
    let timer = null;
    return (...args) => {
        clearTimeout(timer);
        timer = setTimeout(() => fn(...args), delay);
    };
}

function loadTabState(tab) {
    try {
        const raw = sessionStorage.getItem(`xdatahub.tab.${tab}`);
        if (!raw) {
            return cloneDefaultState();
        }
        return {
            ...cloneDefaultState(),
            ...JSON.parse(raw),
        };
    } catch {
        return cloneDefaultState();
    }
}

function saveTabState(tab) {
    sessionStorage.setItem(
        `xdatahub.tab.${tab}`,
        JSON.stringify(tabStates[tab])
    );
}

function apiUrl(path, query = {}) {
    const url = new URL(path, window.location.origin);
    Object.entries(query).forEach(([key, value]) => {
        if (value === undefined || value === null || value === "") {
            return;
        }
        url.searchParams.set(key, String(value));
    });
    return url.toString();
}

function iconSvg(name, label = "", className = "xdatahub-icon") {
    return `<img class="${className}" src="${ICON_BASE_PATH}/${name}.svg" alt="${escapeAttr(label)}" aria-hidden="true">`;
}

function loadGlobalFiltersSidebarState() {
    try {
        const raw = sessionStorage.getItem("xdatahub.filtersSidebarOpen");
        if (raw === "true") {
            return true;
        }
        if (raw === "false") {
            return false;
        }
    } catch {
        // ignore sessionStorage read errors
    }
    return !!tabStates?.history?.filtersSidebarOpen;
}

function saveGlobalFiltersSidebarState() {
    try {
        sessionStorage.setItem(
            "xdatahub.filtersSidebarOpen",
            appState.filtersSidebarOpen ? "true" : "false"
        );
    } catch {
        // ignore sessionStorage write errors
    }
}

function toAbsoluteUrl(url) {
    if (!url) {
        return "";
    }
    try {
        return new URL(url, window.location.origin).toString();
    } catch {
        return String(url);
    }
}

function normalizeDbColorKey(dbName) {
    return String(dbName || "").trim().toLowerCase();
}

function hashDbNameU32(dbName) {
    const key = normalizeDbColorKey(dbName);
    if (!key) {
        return 0;
    }
    let hash = 2166136261;
    for (let i = 0; i < key.length; i += 1) {
        hash ^= key.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
}

function getDbAccentColor(dbName) {
    const key = normalizeDbColorKey(dbName);
    if (!key) {
        return "var(--db-accent-default)";
    }
    const index = hashDbNameU32(key) % DB_ACCENT_PALETTE.length;
    return DB_ACCENT_PALETTE[index];
}

function buildComfyViewUrlFromEntryPath(entryPath, fallbackFilename = "") {
    const raw = String(entryPath || "").trim().replace(/\\/g, "/");
    if (!raw) {
        return "";
    }
    const parts = raw.split("/").filter(Boolean);
    if (parts.length < 2) {
        return "";
    }
    const rootType = String(parts[0] || "").toLowerCase();
    if (rootType !== "input" && rootType !== "output") {
        return "";
    }
    const filename = String(parts[parts.length - 1] || fallbackFilename).trim();
    if (!filename) {
        return "";
    }
    const subfolderParts = parts.slice(1, -1);
    const query = {
        filename,
        type: rootType,
    };
    if (subfolderParts.length > 0) {
        query.subfolder = subfolderParts.join("/");
    }
    return apiUrl("/view", query);
}

async function apiGet(path, query = {}, key = "default") {
    abortRequest(key);
    const controller = new AbortController();
    appState.requests.set(key, controller);
    try {
        const response = await fetch(apiUrl(path, query), {
            signal: controller.signal,
        });
        const data = await response.json();
        if (!response.ok || data.status !== "success") {
            throw new Error(data.message || "请求失败");
        }
        return data;
    } finally {
        const current = appState.requests.get(key);
        if (current === controller) {
            appState.requests.delete(key);
        }
    }
}

async function apiPost(path, body = {}) {
    const response = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
    const data = await response.json();
    if (!response.ok || data.status !== "success") {
        throw new Error(data.message || "请求失败");
    }
    return data;
}

function normalizeSettings(value) {
    const raw = value && typeof value === "object" ? value : {};
    const legacy = raw.show_media_card_info;
    const legacyDefault = legacy !== false;
    const sortByRaw = String(raw.media_sort_by || "").trim().toLowerCase();
    const sortOrderRaw = String(
        raw.media_sort_order || ""
    ).trim().toLowerCase();
    const cardSizePresetRaw = String(
        raw.media_card_size_preset || ""
    ).trim().toLowerCase();
    return {
        showMediaChipType:
            raw.show_media_chip_type !== undefined
                ? raw.show_media_chip_type !== false
                : legacyDefault,
        showMediaChipResolution:
            raw.show_media_chip_resolution !== undefined
                ? raw.show_media_chip_resolution !== false
                : legacyDefault,
        showMediaChipDatetime:
            raw.show_media_chip_datetime !== undefined
                ? raw.show_media_chip_datetime !== false
                : legacyDefault,
        showMediaChipSize:
            raw.show_media_chip_size !== undefined
                ? raw.show_media_chip_size !== false
                : legacyDefault,
        videoPreviewAutoplay:
            raw.video_preview_autoplay !== undefined
                ? raw.video_preview_autoplay === true
                : raw.media_preview_autoplay !== undefined
                    ? raw.media_preview_autoplay === true
                    : false,
        videoPreviewMuted:
            raw.video_preview_muted !== undefined
                ? raw.video_preview_muted !== false
                : raw.media_preview_muted !== undefined
                    ? raw.media_preview_muted !== false
                    : true,
        audioPreviewAutoplay:
            raw.audio_preview_autoplay !== undefined
                ? raw.audio_preview_autoplay === true
                : raw.media_preview_autoplay !== undefined
                    ? raw.media_preview_autoplay === true
                : false,
        audioPreviewMuted:
            raw.audio_preview_muted !== undefined
                ? raw.audio_preview_muted !== false
                : raw.media_preview_muted !== undefined
                    ? raw.media_preview_muted !== false
                    : false,
        mediaSortBy: MEDIA_SORT_BY_VALUES.has(sortByRaw)
            ? sortByRaw
            : "mtime",
        mediaSortOrder: MEDIA_SORT_ORDER_VALUES.has(sortOrderRaw)
            ? sortOrderRaw
            : "desc",
        mediaCardSizePreset: MEDIA_CARD_SIZE_PRESET_VALUES.has(cardSizePresetRaw)
            ? cardSizePresetRaw
            : "standard",
    };
}

function cloneSettings(settings) {
    const raw = settings && typeof settings === "object"
        ? settings
        : {};
    const sortBy = String(raw.mediaSortBy || "").trim().toLowerCase();
    const sortOrder = String(raw.mediaSortOrder || "").trim().toLowerCase();
    const cardSizePreset = String(
        raw.mediaCardSizePreset || ""
    ).trim().toLowerCase();
    return {
        showMediaChipType: raw.showMediaChipType !== false,
        showMediaChipResolution: raw.showMediaChipResolution !== false,
        showMediaChipDatetime: raw.showMediaChipDatetime !== false,
        showMediaChipSize: raw.showMediaChipSize !== false,
        videoPreviewAutoplay:
            raw.videoPreviewAutoplay !== undefined
                ? raw.videoPreviewAutoplay === true
                : raw.mediaPreviewAutoplay === true,
        videoPreviewMuted:
            raw.videoPreviewMuted !== undefined
                ? raw.videoPreviewMuted !== false
                : raw.mediaPreviewMuted !== false,
        audioPreviewAutoplay:
            raw.audioPreviewAutoplay !== undefined
                ? raw.audioPreviewAutoplay === true
                : raw.mediaPreviewAutoplay === true,
        audioPreviewMuted:
            raw.audioPreviewMuted !== undefined
                ? raw.audioPreviewMuted !== false
                : raw.mediaPreviewMuted !== undefined
                    ? raw.mediaPreviewMuted !== false
                    : false,
        mediaSortBy: MEDIA_SORT_BY_VALUES.has(sortBy) ? sortBy : "mtime",
        mediaSortOrder: MEDIA_SORT_ORDER_VALUES.has(sortOrder)
            ? sortOrder
            : "desc",
        mediaCardSizePreset: MEDIA_CARD_SIZE_PRESET_VALUES.has(cardSizePreset)
            ? cardSizePreset
            : "standard",
    };
}

async function fetchSettings() {
    const data = await apiGet(
        "/xz3r0/xdatahub/settings",
        {},
        "xdatahub-settings"
    );
    appState.settings = normalizeSettings(data.settings || {});
    appState.settingsError = "";
}

async function updateSettings(partial) {
    appState.settingsSaving = true;
    appState.settingsError = "";
    render();
    try {
        const body = {
            show_media_chip_type:
                partial?.showMediaChipType
                ?? appState.settings.showMediaChipType,
            show_media_chip_resolution:
                partial?.showMediaChipResolution
                ?? appState.settings.showMediaChipResolution,
            show_media_chip_datetime:
                partial?.showMediaChipDatetime
                ?? appState.settings.showMediaChipDatetime,
            show_media_chip_size:
                partial?.showMediaChipSize
                ?? appState.settings.showMediaChipSize,
            video_preview_autoplay:
                partial?.videoPreviewAutoplay
                ?? appState.settings.videoPreviewAutoplay,
            video_preview_muted:
                partial?.videoPreviewMuted
                ?? appState.settings.videoPreviewMuted,
            audio_preview_autoplay:
                partial?.audioPreviewAutoplay
                ?? appState.settings.audioPreviewAutoplay,
            audio_preview_muted:
                partial?.audioPreviewMuted
                ?? appState.settings.audioPreviewMuted,
            media_sort_by:
                partial?.mediaSortBy
                ?? appState.settings.mediaSortBy,
            media_sort_order:
                partial?.mediaSortOrder
                ?? appState.settings.mediaSortOrder,
            media_card_size_preset:
                partial?.mediaCardSizePreset
                ?? appState.settings.mediaCardSizePreset,
        };
        const data = await apiPost("/xz3r0/xdatahub/settings", body);
        appState.settings = normalizeSettings(data.settings || {});
    } catch (error) {
        appState.settingsError = error.message || "保存设置失败";
    } finally {
        appState.settingsSaving = false;
        render();
    }
}

function abortRequest(key) {
    const old = appState.requests.get(key);
    if (old) {
        old.abort();
        appState.requests.delete(key);
    }
}

function currentTabState() {
    return tabStates[appState.activeTab];
}

function isMediaTab(tab) {
    return tab === "image" || tab === "video" || tab === "audio";
}

function mediaTypeOfTab(tab) {
    if (isMediaTab(tab)) {
        return tab;
    }
    return "image";
}

function normalizeMediaRoot(value) {
    const v = String(value || "").trim().toLowerCase();
    if (v === "input" || v === "output") {
        return v;
    }
    return "input";
}

function normalizeMediaSubdir(value) {
    const raw = String(value || "").replaceAll("\\", "/").trim();
    if (!raw) {
        return "";
    }
    return raw
        .split("/")
        .map((part) => part.trim())
        .filter((part) => part && part !== "." && part !== "..")
        .join("/");
}

function normalizeMediaPath(pathValue) {
    const raw = String(pathValue || "").replaceAll("\\", "/").trim();
    if (!raw) {
        return "";
    }
    const parts = raw
        .split("/")
        .map((part) => part.trim())
        .filter(Boolean);
    if (!parts.length) {
        return "";
    }
    const rootName = normalizeMediaRoot(parts[0]);
    const subdir = normalizeMediaSubdir(parts.slice(1).join("/"));
    return subdir ? `${rootName}/${subdir}` : rootName;
}

function normalizeMediaNavStack(value) {
    if (!Array.isArray(value)) {
        return [];
    }
    const out = [];
    for (const item of value) {
        const normalized = normalizeMediaPath(item);
        if (normalized) {
            out.push(normalized);
        }
    }
    return out;
}

function ensureMediaNavState(state) {
    state.mediaBackStack = normalizeMediaNavStack(state.mediaBackStack);
    state.mediaForwardStack = normalizeMediaNavStack(state.mediaForwardStack);
}

function pushMediaNavEntry(stack, pathValue) {
    const normalized = normalizeMediaPath(pathValue);
    if (!normalized) {
        return;
    }
    if (stack[stack.length - 1] === normalized) {
        return;
    }
    stack.push(normalized);
    if (stack.length > MEDIA_NAV_STACK_LIMIT) {
        stack.splice(0, stack.length - MEDIA_NAV_STACK_LIMIT);
    }
}

function mediaDirectoryFromState(state) {
    const rootName = normalizeMediaRoot(state.mediaRoot);
    const subdir = normalizeMediaSubdir(state.mediaSubdir);
    return subdir ? `${rootName}/${subdir}` : rootName;
}

function currentMediaDirectory() {
    return mediaDirectoryFromState(currentTabState());
}

function setMediaDirectoryFromPath(pathValue, options = {}) {
    const targetPath = normalizeMediaPath(pathValue);
    if (!targetPath) {
        return;
    }
    const { recordHistory = true, clearForward = true } = options;
    const parts = targetPath.split("/");
    const rootName = normalizeMediaRoot(parts[0]);
    const subdir = parts.slice(1).join("/");
    const state = currentTabState();
    ensureMediaNavState(state);
    const currentPath = mediaDirectoryFromState(state);
    if (currentPath === targetPath) {
        return;
    }
    if (recordHistory) {
        pushMediaNavEntry(state.mediaBackStack, currentPath);
    }
    if (clearForward) {
        state.mediaForwardStack = [];
    }
    state.mediaRoot = rootName;
    state.mediaSubdir = normalizeMediaSubdir(subdir);
    state.page = 1;
    saveTabState(appState.activeTab);
}

function toFacetList(value) {
    if (!Array.isArray(value)) {
        return [];
    }
    const output = value
        .map((item) => String(item || "").trim())
        .filter(Boolean);
    return Array.from(new Set(output)).sort((a, b) =>
        a.localeCompare(b, "zh-CN", { sensitivity: "base" })
    );
}

function normalizeFacetKey(value) {
    return String(value || "").trim().toLowerCase();
}

function isDbNameMatched(dbName) {
    const key = normalizeFacetKey(dbName);
    if (!key) {
        return false;
    }
    return appState.recordFacets.dbNames.some((name) =>
        normalizeFacetKey(name) === key
    );
}

function refreshDependentWarnings() {
    if (appState.activeTab !== "history") {
        return;
    }
    const state = currentTabState();
    const dbNameKey = normalizeFacetKey(state.filters.dbName);
    if (!dbNameKey || !isDbNameMatched(state.filters.dbName)) {
        root?.querySelectorAll(".filter-invalid").forEach((el) => {
            el.classList.remove("filter-invalid");
        });
        return;
    }
    const scoped = appState.scopedFacets;
    if (!scoped || scoped.dbNameKey !== dbNameKey) {
        return;
    }
    const typeKeys = new Set(scoped.dataTypes.map((item) => normalizeFacetKey(item)));
    const sourceKeys = new Set(scoped.sources.map((item) => normalizeFacetKey(item)));
    const dataTypeInput = document.getElementById("filter-data-type");
    const sourceInput = document.getElementById("filter-source");
    if (dataTypeInput instanceof HTMLInputElement) {
        const value = dataTypeInput.value.trim();
        const valid = !value || typeKeys.has(normalizeFacetKey(value));
        dataTypeInput.classList.toggle("filter-invalid", !valid);
    }
    if (sourceInput instanceof HTMLInputElement) {
        const value = sourceInput.value.trim();
        const valid = !value || sourceKeys.has(normalizeFacetKey(value));
        sourceInput.classList.toggle("filter-invalid", !valid);
    }
}

function hasHorizontalOverflow(el) {
    if (!(el instanceof HTMLElement)) {
        return false;
    }
    return el.scrollWidth > el.clientWidth + 1;
}

function hasWrappedChildren(el) {
    if (!(el instanceof HTMLElement)) {
        return false;
    }
    const children = Array.from(el.children).filter((child) =>
        child instanceof HTMLElement
    );
    if (children.length < 2) {
        return false;
    }
    const firstTop = children[0].offsetTop;
    return children.some((child) => Math.abs(child.offsetTop - firstTop) > 1);
}

function isCompactFiltersLayout(expandedFiltersHtml) {
    if (!root || !expandedFiltersHtml) {
        return false;
    }
    const hostWidth = Math.max(
        320,
        Math.floor(root.getBoundingClientRect().width || window.innerWidth || 0)
    );
    const probe = document.createElement("div");
    probe.style.position = "fixed";
    probe.style.left = "-100000px";
    probe.style.top = "0";
    probe.style.width = `${hostWidth}px`;
    probe.style.visibility = "hidden";
    probe.style.pointerEvents = "none";
    probe.style.zIndex = "-1";
    probe.innerHTML = expandedFiltersHtml;
    document.body.appendChild(probe);
    try {
        const filters = probe.querySelector(".filters");
        if (!(filters instanceof HTMLElement)) {
            return false;
        }
        if (hasHorizontalOverflow(filters)) {
            return true;
        }
        const keyRows = [
            filters.querySelector(".filters-main-row"),
            filters.querySelector(".filters-secondary-content"),
            filters.querySelector(".filters-toolbar"),
        ];
        return keyRows.some((row) =>
            hasHorizontalOverflow(row) || hasWrappedChildren(row)
        );
    } finally {
        probe.remove();
    }
}

function isCompactHistoryLayout() {
    try {
        return window.matchMedia("(max-width: 960px)").matches;
    } catch {
        return window.innerWidth <= 960;
    }
}

function clampHistorySplitRatio(ratio, totalWidthInput = null) {
    const body = root?.querySelector(".body");
    const totalWidth = Math.max(
        1,
        Number(totalWidthInput || 0) || body?.getBoundingClientRect().width || window.innerWidth || 1
    );
    const minListWidth = 320;
    const minDetailWidth = 360;
    const minRatio = minListWidth / totalWidth;
    const maxRatio = 1 - (minDetailWidth / totalWidth);
    const boundedMin = Math.min(0.8, Math.max(0.2, minRatio));
    const boundedMax = Math.max(0.2, Math.min(0.8, maxRatio));
    const safeMin = Math.min(boundedMin, boundedMax);
    const safeMax = Math.max(boundedMin, boundedMax);
    const value = Number.isFinite(Number(ratio)) ? Number(ratio) : 0.45;
    return Math.max(safeMin, Math.min(safeMax, value));
}

function setHistoryLayoutState(patch) {
    const state = currentTabState();
    if (appState.activeTab !== "history") {
        return;
    }
    if (Object.prototype.hasOwnProperty.call(patch, "detailCollapsed")) {
        state.detailCollapsed = !!patch.detailCollapsed;
    }
    if (Object.prototype.hasOwnProperty.call(patch, "drawerOpen")) {
        state.drawerOpen = !!patch.drawerOpen;
    }
    if (Object.prototype.hasOwnProperty.call(patch, "splitRatio")) {
        state.splitRatio = clampHistorySplitRatio(patch.splitRatio);
    }
    saveTabState("history");
}

function historyLayoutState() {
    const state = currentTabState();
    state.detailCollapsed = !!state.detailCollapsed;
    state.drawerOpen = !!state.drawerOpen;
    state.splitRatio = clampHistorySplitRatio(state.splitRatio);
    return state;
}

function setError(message) {
    appState.error = message || "";
}

function normalizeLockState(lock) {
    return {
        state: lock?.state || "IDLE",
        readonly: !!lock?.readonly,
        cooldown_ms: Number(lock?.cooldown_ms || 0),
    };
}

function applyLockState(lock) {
    const next = normalizeLockState(lock);
    const prev = appState.lockState || normalizeLockState({});
    const changed =
        prev.state !== next.state ||
        prev.readonly !== next.readonly ||
        prev.cooldown_ms !== next.cooldown_ms;
    if (changed) {
        appState.lockState = next;
    }
    return changed;
}

function clearDetailResources() {
    stopVideoScheduler(true);
    clearMediaQueueRebuildTimer();
    if (!root) {
        return;
    }
    root.querySelectorAll("video,audio").forEach((el) => {
        try {
            el.pause();
            el.src = "";
            el.load();
        } catch {}
    });
}

async function loadList(options = {}) {
    const tab = appState.activeTab;
    stopVideoScheduler(true);
    appState.loading = true;
    setError("");
    render();

    const state = currentTabState();
    try {
        let data;
        if (tab === "history") {
            const historySortOrder = normalizeHistorySortOrder(
                state.historySortOrder
            );
            data = await apiGet(
                "/xz3r0/xdatahub/records",
                {
                    page: state.page,
                    page_size: state.pageSize,
                    extra_header: state.filters.keyword,
                    data_type: state.filters.dataType,
                    source: state.filters.source,
                    db_name: state.filters.dbName,
                    start: state.filters.start,
                    end: state.filters.end,
                    sort_order: historySortOrder,
                },
                `list-${tab}`
            );
            const facets = data.facets || {};
            appState.recordFacets = {
                dbNames: toFacetList(facets.db_names),
                dataTypes: toFacetList(facets.data_types),
                sources: toFacetList(facets.sources),
            };
            const dbNameKey = normalizeFacetKey(state.filters.dbName);
            if (dbNameKey) {
                appState.scopedFacets = {
                    dbNameKey,
                    dataTypes: toFacetList(facets.data_types),
                    sources: toFacetList(facets.sources),
                };
            } else {
                appState.scopedFacets = {
                    dbNameKey: "",
                    dataTypes: [],
                    sources: [],
                };
            }
        } else {
            const showDatetimeChip =
                appState.settings.showMediaChipDatetime !== false;
            const showSizeChip = appState.settings.showMediaChipSize !== false;
            const showResolutionChip =
                appState.settings.showMediaChipResolution !== false;
            const sortBy = normalizeMediaSortBy(
                appState.settings.mediaSortBy
            );
            const sortOrder = normalizeMediaSortOrder(
                appState.settings.mediaSortOrder
            );
            data = await apiGet(
                "/xz3r0/xdatahub/media",
                {
                    media_type: mediaTypeOfTab(tab),
                    flat: 0,
                    dir: mediaDirectoryFromState(state),
                    page: state.page,
                    page_size: state.pageSize,
                    keyword: state.filters.keyword,
                    start: state.filters.start,
                    end: state.filters.end,
                    validate_page: options.validatePage ? 1 : 0,
                    include_datetime: showDatetimeChip ? 1 : 0,
                    include_size: showSizeChip ? 1 : 0,
                    include_resolution: showResolutionChip ? 1 : 0,
                    sort_by: sortBy,
                    sort_order: sortOrder,
                },
                `list-${tab}`
            );
        }
        appState.items = data.items || [];
        if (tab === "history") {
            appState.items = applyHistorySortLocal(
                appState.items,
                normalizeHistorySortOrder(state.historySortOrder)
            );
        }
        appState.total = data.total || 0;
        appState.totalPages = data.total_pages || 1;
        applyLockState(data.lock_state || appState.lockState);
        const selected = appState.items.find((item) => item.id === state.selectedId);
        if (selected) {
            appState.selectedItemCache.set(tab, selected);
        }
    } catch (error) {
        if (error?.name !== "AbortError") {
            setError(error.message || "加载失败");
        }
    } finally {
        appState.loading = false;
        render();
        restoreListScroll();
        refreshDependentWarnings();
    }
}

async function loadScopedFacetsByDb(dbName) {
    const key = normalizeFacetKey(dbName);
    if (!key || !isDbNameMatched(dbName)) {
        appState.scopedFacets = {
            dbNameKey: "",
            dataTypes: [],
            sources: [],
        };
        refreshDependentWarnings();
        return;
    }
    try {
        const data = await apiGet(
            "/xz3r0/xdatahub/records",
            {
                page: 1,
                page_size: 1,
                db_name: dbName,
            },
            "scoped-facets-history"
        );
        const facets = data.facets || {};
        appState.scopedFacets = {
            dbNameKey: key,
            dataTypes: toFacetList(facets.data_types),
            sources: toFacetList(facets.sources),
        };
    } catch {
        // 保持静默，避免输入过程中弹错。
    } finally {
        refreshDependentWarnings();
    }
}

const debouncedScopedFacetReload = debounce((dbName) => {
    loadScopedFacetsByDb(dbName);
}, 180);

function restoreListScroll() {
    const list = document.getElementById("list");
    if (!list) {
        return;
    }
    list.scrollTop = currentTabState().scrollTop || 0;
}

function captureFocusState() {
    const active = document.activeElement;
    if (!(active instanceof HTMLInputElement)) {
        return null;
    }
    if (!FOCUSABLE_IDS.has(active.id)) {
        return null;
    }
    return {
        id: active.id,
        start: active.selectionStart ?? null,
        end: active.selectionEnd ?? null,
    };
}

function restoreFocusState(focusState) {
    if (!focusState) {
        return;
    }
    const target = document.getElementById(focusState.id);
    if (!(target instanceof HTMLInputElement)) {
        return;
    }
    target.focus();
    if (
        focusState.start !== null &&
        focusState.end !== null &&
        typeof target.setSelectionRange === "function" &&
        target.type !== "datetime-local"
    ) {
        try {
            target.setSelectionRange(focusState.start, focusState.end);
        } catch {
            // 部分输入类型不支持 setSelectionRange，忽略即可。
        }
    }
}

function syncListScroll() {
    const list = document.getElementById("list");
    if (!list) {
        return;
    }
    currentTabState().scrollTop = list.scrollTop;
    saveTabState(appState.activeTab);
}

function selectedItem() {
    const selected = appState.items.find(
        (item) => item.id === currentTabState().selectedId
    );
    if (selected) {
        appState.selectedItemCache.set(appState.activeTab, selected);
        return selected;
    }
    return appState.selectedItemCache.get(appState.activeTab) || null;
}

function closeFacetDropdown(shouldRender = false) {
    if (!appState.facetDropdown.open && !appState.facetDropdown.fieldId) {
        return;
    }
    appState.facetDropdown = { open: false, fieldId: "" };
    if (shouldRender) {
        render();
    }
}

function openFacetDropdown(fieldId) {
    appState.facetDropdown = { open: true, fieldId };
}

function renderFacetInput(fieldId, label, value, placeholder, options) {
    const wrapClass = "facet-field-wrap";
    const isOpen = appState.facetDropdown.open
        && appState.facetDropdown.fieldId === fieldId;
    const menuHtml = isOpen
        ? `<div class="facet-menu" data-facet-menu="${fieldId}">
            <button class="facet-option facet-option-all" type="button" data-facet-option="${fieldId}" data-facet-value="">全部</button>
            ${
                options.length
                    ? options.map((option) =>
                        `<button class="facet-option" type="button" data-facet-option="${fieldId}" data-facet-value="${escapeAttr(option)}">${escapeHtml(option)}</button>`
                    ).join("")
                    : ""
            }
        </div>`
        : "";
    return `<div class="field">
        <span>${label}:</span>
        <div class="${wrapClass}">
            <div class="facet-input-shell">
                <input id="${fieldId}" value="${escapeHtml(value)}" placeholder="${escapeAttr(placeholder)}" autocomplete="off">
                <button class="facet-toggle-btn" type="button" data-facet-toggle="${fieldId}" title="展开选项" aria-label="展开选项">▾</button>
            </div>
            ${menuHtml}
        </div>
    </div>`;
}

function switchTab(tab) {
    if (appState.activeTab === tab) {
        return;
    }
    clearDetailResources();
    closeImagePreview();
    appState.compactActionsMenuOpen = false;
    appState.dateRangePanelOpen = false;
    closeFacetDropdown(false);
    if (appState.dbDeleteDialogOpen) {
        appState.dbDeleteDialogOpen = false;
    }
    appState.activeTab = tab;
    loadList();
}

function changePage(nextPage) {
    const state = currentTabState();
    state.page = Math.max(1, Math.min(nextPage, appState.totalPages || 1));
    saveTabState(appState.activeTab);
    loadList();
}

const debouncedJumpPage = debounce((value) => {
    const target = Number(value);
    if (Number.isNaN(target)) {
        return;
    }
    changePage(target);
}, 200);

function isSearchLocked() {
    return Date.now() < Number(appState.searchLockedUntil || 0);
}

function resetSearchLock() {
    if (appState.searchLockTimer) {
        clearTimeout(appState.searchLockTimer);
        appState.searchLockTimer = 0;
    }
    appState.searchLockedUntil = 0;
}

function lockSearchButton(ms = SEARCH_LOCK_MS) {
    resetSearchLock();
    appState.searchLockedUntil = Date.now() + ms;
    appState.searchLockTimer = window.setTimeout(() => {
        appState.searchLockedUntil = 0;
        appState.searchLockTimer = 0;
        render();
    }, ms);
}

function isDataActionLocked() {
    return (
        appState.dataActionInFlight
        || Date.now() < Number(appState.dataActionLockedUntil || 0)
    );
}

function resetDataActionLock() {
    if (appState.dataActionLockTimer) {
        clearTimeout(appState.dataActionLockTimer);
        appState.dataActionLockTimer = 0;
    }
    appState.dataActionLockedUntil = 0;
}

function lockDataActions(ms = DATA_ACTION_LOCK_MS) {
    resetDataActionLock();
    appState.dataActionLockedUntil = Date.now() + ms;
    appState.dataActionLockTimer = window.setTimeout(() => {
        appState.dataActionLockedUntil = 0;
        appState.dataActionLockTimer = 0;
        render();
    }, ms);
}

function resetSearchDebounce() {
    if (appState.searchDebounceTimer) {
        clearTimeout(appState.searchDebounceTimer);
        appState.searchDebounceTimer = 0;
    }
}

function runSearchNow() {
    if (appState.searchInFlight) {
        return;
    }
    appState.searchInFlight = true;
    lockSearchButton();
    const state = currentTabState();
    state.page = 1;
    saveTabState(appState.activeTab);
    loadList().finally(() => {
        appState.searchInFlight = false;
        render();
    });
}

function scheduleSearchReload() {
    resetSearchDebounce();
    appState.searchDebounceTimer = window.setTimeout(() => {
        appState.searchDebounceTimer = 0;
        runSearchNow();
    }, SEARCH_DEBOUNCE_MS);
}

const debouncedLayoutRefresh = debounce(() => {
    const tab = appState.activeTab;
    if (tab !== "history" && !isMediaTab(tab)) {
        return;
    }
    if (tab === "history") {
        setHistoryLayoutState({ splitRatio: historyLayoutState().splitRatio });
    }
    render();
}, 120);

async function doRefresh() {
    if (isMediaTab(appState.activeTab)) {
        await apiPost("/xz3r0/xdatahub/media/refresh", {
            media_type: mediaTypeOfTab(appState.activeTab),
        });
    }
    await loadList({ validatePage: true });
    return true;
}

async function applyMediaSortSettings(sortBy, sortOrder) {
    const nextSortBy = normalizeMediaSortBy(sortBy);
    const nextSortOrder = normalizeMediaSortOrder(sortOrder);
    const prevSortBy = normalizeMediaSortBy(appState.settings.mediaSortBy);
    const prevSortOrder = normalizeMediaSortOrder(
        appState.settings.mediaSortOrder
    );
    if (
        nextSortBy === prevSortBy
        && nextSortOrder === prevSortOrder
    ) {
        return;
    }
    await updateSettings({
        mediaSortBy: nextSortBy,
        mediaSortOrder: nextSortOrder,
    });
    if (!appState.settingsError && isMediaTab(appState.activeTab)) {
        const state = currentTabState();
        state.page = 1;
        saveTabState(appState.activeTab);
        await loadList();
    }
}

function openImagePreview(kind, url, title) {
    if (!url) {
        return;
    }
    appState.imagePreview = {
        open: true,
        kind: kind || "image",
        url,
        title: title || "",
        scale: 1,
        offsetX: 0,
        offsetY: 0,
        naturalWidth: 0,
        naturalHeight: 0,
        dragging: false,
        dragStartX: 0,
        dragStartY: 0,
        dragOriginX: 0,
        dragOriginY: 0,
    };
    render();
}

function closeImagePreview() {
    if (!appState.imagePreview.open) {
        return;
    }
    appState.imagePreview = {
        open: false,
        kind: "image",
        url: "",
        title: "",
        scale: 1,
        offsetX: 0,
        offsetY: 0,
        naturalWidth: 0,
        naturalHeight: 0,
        dragging: false,
        dragStartX: 0,
        dragStartY: 0,
        dragOriginX: 0,
        dragOriginY: 0,
    };
    render();
}

function clampImagePreviewOffset(stageEl) {
    const preview = appState.imagePreview;
    const nw = Number(preview.naturalWidth || 0);
    const nh = Number(preview.naturalHeight || 0);
    if (!stageEl || !nw || !nh) {
        preview.offsetX = 0;
        preview.offsetY = 0;
        return;
    }
    const stageRect = stageEl.getBoundingClientRect();
    const stageW = Math.max(1, stageRect.width);
    const stageH = Math.max(1, stageRect.height);
    const fitScale = Math.min(stageW / nw, stageH / nh);
    const baseW = nw * fitScale;
    const baseH = nh * fitScale;
    const scaledW = baseW * preview.scale;
    const scaledH = baseH * preview.scale;
    const maxX = Math.max(0, (scaledW - stageW) / 2);
    const maxY = Math.max(0, (scaledH - stageH) / 2);
    preview.offsetX = Math.max(-maxX, Math.min(maxX, preview.offsetX));
    preview.offsetY = Math.max(-maxY, Math.min(maxY, preview.offsetY));
}

function syncImagePreviewTransform() {
    const preview = appState.imagePreview;
    const stage = document.getElementById("image-lightbox-stage");
    const image = document.getElementById("image-lightbox-image");
    if (!preview.open || !stage || !image) {
        return;
    }
    clampImagePreviewOffset(stage);
    image.style.transform = `translate(${preview.offsetX}px, ${preview.offsetY}px) scale(${preview.scale})`;
    stage.classList.toggle("zoomed", preview.scale > 1.001);
    stage.classList.toggle("dragging", !!preview.dragging);
}

function setImagePreviewScale(nextScale, anchorX = 0, anchorY = 0) {
    const preview = appState.imagePreview;
    const prevScale = preview.scale;
    const clampedScale = Math.max(1, Math.min(8, nextScale));
    if (Math.abs(clampedScale - prevScale) < 1e-6) {
        return;
    }
    const ratio = clampedScale / prevScale;
    preview.offsetX = anchorX - (anchorX - preview.offsetX) * ratio;
    preview.offsetY = anchorY - (anchorY - preview.offsetY) * ratio;
    preview.scale = clampedScale;
    syncImagePreviewTransform();
}

function setupImagePreviewEvents() {
    const preview = appState.imagePreview;
    if (!preview.open || preview.kind !== "image") {
        return;
    }
    const stage = document.getElementById("image-lightbox-stage");
    const image = document.getElementById("image-lightbox-image");
    if (!stage || !image) {
        return;
    }

    const finishDrag = () => {
        if (!preview.dragging) {
            return;
        }
        preview.dragging = false;
        syncImagePreviewTransform();
    };

    image.addEventListener("load", () => {
        preview.naturalWidth = image.naturalWidth || 0;
        preview.naturalHeight = image.naturalHeight || 0;
        preview.scale = 1;
        preview.offsetX = 0;
        preview.offsetY = 0;
        syncImagePreviewTransform();
    });

    stage.addEventListener("wheel", (event) => {
        event.preventDefault();
        const rect = stage.getBoundingClientRect();
        const anchorX = event.clientX - rect.left - rect.width / 2;
        const anchorY = event.clientY - rect.top - rect.height / 2;
        const step = event.deltaY < 0 ? 1.1 : 0.9;
        setImagePreviewScale(preview.scale * step, anchorX, anchorY);
    }, { passive: false });

    stage.addEventListener("pointerdown", (event) => {
        if (preview.scale <= 1.001) {
            return;
        }
        event.preventDefault();
        preview.dragging = true;
        preview.dragStartX = event.clientX;
        preview.dragStartY = event.clientY;
        preview.dragOriginX = preview.offsetX;
        preview.dragOriginY = preview.offsetY;
        syncImagePreviewTransform();
    });

    stage.addEventListener("pointermove", (event) => {
        if (!preview.dragging) {
            return;
        }
        event.preventDefault();
        preview.offsetX = preview.dragOriginX + (event.clientX - preview.dragStartX);
        preview.offsetY = preview.dragOriginY + (event.clientY - preview.dragStartY);
        syncImagePreviewTransform();
    });

    stage.addEventListener("pointerup", finishDrag);
    stage.addEventListener("pointercancel", finishDrag);
    stage.addEventListener("pointerleave", finishDrag);
}

async function doCleanupInvalid() {
    if (appState.lockState.readonly) {
        return false;
    }
    if (!isMediaTab(appState.activeTab)) {
        return false;
    }
    await apiPost("/xz3r0/xdatahub/media/cleanup-invalid", {
        media_type: mediaTypeOfTab(appState.activeTab),
    });
    await loadList({ validatePage: true });
    return true;
}

async function doClearIndex() {
    if (appState.lockState.readonly) {
        return false;
    }
    if (!isMediaTab(appState.activeTab)) {
        return false;
    }
    if (!window.confirm("确认清空当前媒体类型索引？")) {
        return false;
    }
    await apiPost("/xz3r0/xdatahub/media/rebuild", {
        media_type: mediaTypeOfTab(appState.activeTab),
    });
    await loadList({ validatePage: true });
    return true;
}

async function doClearRecords() {
    if (appState.lockState.readonly || appState.activeTab !== "history") {
        return false;
    }
    await openDbDeleteDialog();
    return true;
}

function normalizeDbName(value) {
    return String(value || "").trim().toLowerCase();
}

function isDbCriticalEffective(item) {
    return !!item?.is_critical_effective;
}

function isDbSelected(name) {
    const key = normalizeDbName(name);
    return appState.selectedDbFiles.some(
        (item) => normalizeDbName(item) === key
    );
}

function selectedDbItems() {
    const selected = new Set(
        appState.selectedDbFiles.map((item) => normalizeDbName(item))
    );
    return appState.dbFileList.filter((item) =>
        selected.has(normalizeDbName(item.name))
    );
}

function selectedCriticalDbCount() {
    return selectedDbItems().filter((item) =>
        isDbCriticalEffective(item)
    ).length;
}

function dbPurposeIconName(purpose) {
    const text = String(purpose || "").trim();
    if (!text) {
        return "database";
    }
    if (text.includes("媒体")) {
        return "image";
    }
    if (text.includes("音频")) {
        return "audio-lines";
    }
    if (text.includes("视频")) {
        return "video";
    }
    if (text.includes("工作流")) {
        return "workflow";
    }
    if (text.includes("记录") || text.includes("历史")) {
        return "history";
    }
    return "database";
}

function canSubmitDbDelete() {
    if (!appState.selectedDbFiles.length) {
        return false;
    }
    if (appState.confirmYes.trim() !== "YES") {
        return false;
    }
    const criticalCount = selectedCriticalDbCount();
    if (criticalCount <= 0) {
        return true;
    }
    return appState.unlockCritical
        && appState.confirmYesCritical.trim() === "YES";
}

function canSubmitRecordsCleanup() {
    if (!appState.selectedDbFiles.length) {
        return false;
    }
    return appState.confirmYes.trim() === "YES";
}

function isDbRefreshLocked() {
    return Date.now() < Number(appState.dbRefreshLockedUntil || 0);
}

function resetDbRefreshLock() {
    if (appState.dbRefreshLockTimer) {
        clearTimeout(appState.dbRefreshLockTimer);
        appState.dbRefreshLockTimer = 0;
    }
    appState.dbRefreshLockedUntil = 0;
}

function lockDbRefreshButton(ms = DB_LIST_REFRESH_LOCK_MS) {
    resetDbRefreshLock();
    appState.dbRefreshLockedUntil = Date.now() + ms;
    appState.dbRefreshLockTimer = window.setTimeout(() => {
        appState.dbRefreshLockedUntil = 0;
        appState.dbRefreshLockTimer = 0;
        render();
    }, ms);
}

function resetDbRefreshDebounce() {
    if (appState.dbRefreshDebounceTimer) {
        clearTimeout(appState.dbRefreshDebounceTimer);
        appState.dbRefreshDebounceTimer = 0;
    }
}

async function runDbListRefreshNow() {
    if (appState.dbRefreshInFlight) {
        return;
    }
    appState.dbRefreshInFlight = true;
    lockDbRefreshButton();
    render();
    appState.dbDeleteError = "";
    try {
        await fetchDbFileList();
        reconcileSelectedDbFiles();
    } catch (error) {
        appState.dbDeleteError = error.message || "刷新数据库列表失败";
    } finally {
        appState.dbRefreshInFlight = false;
        render();
    }
}

function scheduleDbListRefresh() {
    resetDbRefreshDebounce();
    appState.dbRefreshDebounceTimer = window.setTimeout(() => {
        appState.dbRefreshDebounceTimer = 0;
        runDbListRefreshNow();
    }, DB_LIST_REFRESH_DEBOUNCE_MS);
}

function closeDbDeleteDialog() {
    appState.dbDeleteDialogOpen = false;
    appState.dbDeleteLoading = false;
    appState.dbDeleteError = "";
    appState.dbDeleteResult = "";
    appState.clearDataMode = "records";
    appState.dbFileList = [];
    appState.selectedDbFiles = [];
    appState.unlockCritical = false;
    appState.confirmYes = "";
    appState.confirmYesCritical = "";
    resetDbRefreshLock();
    resetDbRefreshDebounce();
    appState.dbRefreshInFlight = false;
    render();
}

async function fetchDbFileList() {
    const data = await apiGet(
        "/xz3r0/xdatahub/records/db-files",
        {},
        "db-files-list"
    );
    appState.dbFileList = Array.isArray(data.items) ? data.items : [];
}

function reconcileSelectedDbFiles() {
    const existing = new Set(
        appState.dbFileList.map((item) => normalizeDbName(item.name))
    );
    appState.selectedDbFiles = appState.selectedDbFiles.filter((name) =>
        existing.has(normalizeDbName(name))
    );
}

async function openDbDeleteDialog() {
    appState.dbDeleteDialogOpen = true;
    appState.dbDeleteLoading = true;
    appState.dbDeleteError = "";
    appState.dbDeleteResult = "";
    appState.clearDataMode = "records";
    appState.selectedDbFiles = [];
    appState.unlockCritical = false;
    appState.confirmYes = "";
    appState.confirmYesCritical = "";
    resetDbRefreshLock();
    resetDbRefreshDebounce();
    appState.dbRefreshInFlight = false;
    render();
    try {
        await fetchDbFileList();
    } catch (error) {
        appState.dbDeleteError = error.message || "加载数据库列表失败";
    } finally {
        appState.dbDeleteLoading = false;
        render();
    }
}

function toggleDbFileSelected(name) {
    const item = appState.dbFileList.find(
        (entry) => normalizeDbName(entry.name) === normalizeDbName(name)
    );
    if (!item) {
        return;
    }
    if (isDbCriticalEffective(item) && !appState.unlockCritical) {
        return;
    }
    if (isDbSelected(name)) {
        appState.selectedDbFiles = appState.selectedDbFiles.filter(
            (entry) => normalizeDbName(entry) !== normalizeDbName(name)
        );
    } else {
        appState.selectedDbFiles = [...appState.selectedDbFiles, name];
    }
}

async function toggleCriticalOverride(name, marked) {
    await apiPost(
        "/xz3r0/xdatahub/records/db-files/critical-mark",
        {
            name,
            marked,
        }
    );
}

async function submitDbDelete() {
    if (!canSubmitDbDelete()) {
        return;
    }
    appState.dbDeleteLoading = true;
    appState.dbDeleteError = "";
    appState.dbDeleteResult = "";
    render();
    try {
        const result = await apiPost(
            "/xz3r0/xdatahub/records/db-files/delete",
            {
                targets: appState.selectedDbFiles,
                unlock_critical: appState.unlockCritical,
                confirm_yes: appState.confirmYes.trim(),
                confirm_yes_critical: appState.confirmYesCritical.trim(),
            }
        );
        const deleted = Number(result.deleted_count || 0);
        const failed = Number(result.failed_count || 0);
        const failedNames = Array.isArray(result.failed)
            ? result.failed.join(", ")
            : "";
        appState.dbDeleteResult = failed
            ? `已删除 ${deleted} 个，失败 ${failed} 个：${failedNames}`
            : `已删除 ${deleted} 个数据库文件`;
        await fetchDbFileList();
        appState.selectedDbFiles = [];
        appState.confirmYes = "";
        appState.confirmYesCritical = "";
        await loadList();
    } catch (error) {
        appState.dbDeleteError = error.message || "删除失败";
    } finally {
        appState.dbDeleteLoading = false;
        render();
    }
}

async function submitRecordsCleanup() {
    if (!canSubmitRecordsCleanup()) {
        return;
    }
    appState.dbDeleteLoading = true;
    appState.dbDeleteError = "";
    appState.dbDeleteResult = "";
    render();
    try {
        const targets = [...appState.selectedDbFiles];
        let deleted = 0;
        let touched = 0;
        let failed = 0;
        const failedNames = [];
        for (const dbName of targets) {
            try {
                const result = await apiPost(
                    "/xz3r0/xdatahub/records/cleanup",
                    {
                        mode: "all",
                        db_name: dbName,
                    }
                );
                deleted += Number(result.deleted || 0);
                touched += Number(result.touched || 0);
            } catch {
                failed += 1;
                failedNames.push(dbName);
            }
        }
        appState.dbDeleteResult = failed
            ? `已清空 ${touched} 个数据库历史（删除 ${deleted} 条），失败 ${failed} 个：${failedNames.join(", ")}`
            : `已清空 ${touched} 个数据库历史（删除 ${deleted} 条）`;
        await fetchDbFileList();
        appState.selectedDbFiles = [];
        appState.confirmYes = "";
        appState.confirmYesCritical = "";
        await loadList();
    } catch (error) {
        appState.dbDeleteError = error.message || "清空历史失败";
    } finally {
        appState.dbDeleteLoading = false;
        render();
    }
}

function isDangerDialogConfirmed() {
    if (appState.dangerDialog.input.trim() !== "YES") {
        return false;
    }
    if (appState.dangerDialog.kind !== "clear-history") {
        return true;
    }
    const deleteAll = !!appState.dangerDialog.meta?.deleteAll;
    const dbName = String(appState.dangerDialog.meta?.dbName || "").trim();
    return deleteAll || !!dbName;
}

function closeDangerConfirm(result = false) {
    const resolver = appState.dangerDialogResolver;
    appState.dangerDialogResolver = null;
    appState.dangerDialog = {
        open: false,
        kind: "",
        input: "",
        meta: {},
    };
    render();
    if (typeof resolver === "function") {
        resolver(result);
    }
}

function requestDangerConfirm(kind, meta = {}) {
    if (appState.dangerDialog.open) {
        closeDangerConfirm(false);
    }
    appState.dangerDialog = {
        open: true,
        kind,
        input: "",
        meta,
    };
    render();
    return new Promise((resolve) => {
        appState.dangerDialogResolver = resolve;
    });
}

function renderFilters() {
    const state = currentTabState();
    const isHistory = appState.activeTab === "history";
    const tab = appState.activeTab;
    const readonly = appState.lockState.readonly;
    const canCleanInvalid = isMediaTab(tab) && !readonly;
    const canClearIndex = isMediaTab(tab) && !readonly;
    const canClearData = tab === "history" && !readonly;
    const searchBtnText = `${iconSvg("search", "搜索", "xdatahub-icon btn-icon")} 搜索`;
    const searchBtnClass = "btn primary search-btn";
    const searchDisabled = isSearchLocked() || appState.searchInFlight;
    const dbField = isHistory
        ? renderFacetInput(
            "filter-db-name",
            "数据来源",
            state.filters.dbName,
            "数据来源",
            appState.recordFacets.dbNames
        )
        : "";
    const typeField = isHistory
        ? renderFacetInput(
            "filter-data-type",
            "数据类型",
            state.filters.dataType,
            "数据类型",
            appState.recordFacets.dataTypes
        )
        : "";
    const sourceField = isHistory
        ? renderFacetInput(
            "filter-source",
            "节点",
            state.filters.source,
            "节点",
            appState.recordFacets.sources
        )
        : "";
    const facetBackdropHtml = appState.facetDropdown.open
        ? '<button class="facet-backdrop" id="facet-backdrop" aria-label="关闭下拉选项"></button>'
        : "";
    const dateFilterHtml = `
        <div class="date-range-wrap date-range-inline">
            <div class="field">
                <span>开始:</span>
                <div class="datetime-field">
                    <div class="date-input-shell">
                        <input id="filter-start" type="datetime-local" value="${escapeHtml(state.filters.start)}">
                        <button class="date-picker-btn" type="button" data-picker-target="filter-start" title="选择开始时间" aria-label="选择开始时间">${iconSvg("calendar", "选择开始时间", "xdatahub-icon date-picker-icon")}</button>
                    </div>
                </div>
            </div>
            <div class="field">
                <span>结束:</span>
                <div class="datetime-field">
                    <div class="date-input-shell">
                        <input id="filter-end" type="datetime-local" value="${escapeHtml(state.filters.end)}">
                        <button class="date-picker-btn" type="button" data-picker-target="filter-end" title="选择结束时间" aria-label="选择结束时间">${iconSvg("calendar", "选择结束时间", "xdatahub-icon date-picker-icon")}</button>
                    </div>
                </div>
            </div>
        </div>
    `;
    const sidebarOpen = !!appState.filtersSidebarOpen;
    const filtersPanelHtml = `
        <div class="filters-sidebar-body">
            <div class="field keyword-field">
                <span>${isHistory ? "额外头部信息" : "文件名"}:</span>
                <input id="filter-keyword" value="${escapeHtml(state.filters.keyword)}" placeholder="${isHistory ? "额外头部信息关键词" : "关键词"}">
            </div>
            ${dbField}
            ${typeField}
            ${sourceField}
            ${dateFilterHtml}
            <div class="filters-toolbar filter-panel-search">
                <button class="${searchBtnClass}" id="btn-apply-filters" ${searchDisabled ? "disabled" : ""}>${searchBtnText}</button>
            </div>
        </div>
        <div class="filters-sidebar-footer">
            
        </div>
    `;
    if (!sidebarOpen) {
        return "";
    }
    return `
        <div class="filters filters-topbar" id="filters-topbar">
            ${filtersPanelHtml}
            ${facetBackdropHtml}
        </div>
    `;
}

function renderTopActionBar() {
    const tab = appState.activeTab;
    const state = currentTabState();
    const sidebarOpen = !!appState.filtersSidebarOpen;
    const readonly = appState.lockState.readonly;
    const isMedia = isMediaTab(tab);
    const dataActionLocked = isDataActionLocked();
    const canRefresh = !dataActionLocked;
    const canCleanInvalid = isMedia && !readonly && !dataActionLocked;
    const canClearIndex = isMedia && !readonly && !dataActionLocked;
    const canClearData = tab === "history" && !readonly && !dataActionLocked;
    const historySortOrder = normalizeHistorySortOrder(
        state.historySortOrder
    );
    const historySortText = historySortDisplayText(historySortOrder);
    const mediaSortOrder = normalizeMediaSortOrder(
        appState.settings.mediaSortOrder
    );
    const mediaSortText = `排序:${mediaSortDisplayText(
        appState.settings.mediaSortBy,
        appState.settings.mediaSortOrder
    )}${mediaSortOrder === "desc" ? "降序" : "升序"}`;
    const actionBtn = (
        id,
        iconName,
        text,
        extraClass = "btn",
        disabled = false,
        active = false
    ) => `
        <button
            class="${extraClass}${active ? " active" : ""}"
            id="${id}"
            ${disabled ? "disabled" : ""}
            title="${escapeAttr(text)}"
            aria-label="${escapeAttr(text)}"
        >
            <span class="btn-emoji" aria-hidden="true">${iconSvg(iconName, text, "xdatahub-icon btn-icon")}</span>
            <span class="btn-text">${escapeHtml(text)}</span>
        </button>
    `;
    const leftButtons = `
        ${actionBtn(
            "btn-toggle-filters-sidebar",
            "list-filter",
            "筛选",
            "btn",
            false,
            sidebarOpen
        )}
        ${actionBtn("btn-refresh-inline", "refresh-cw", "刷新", "btn", !canRefresh)}
        ${
            isMedia
                ? renderOrderSortButton(
                    "btn-media-sort-cycle",
                    mediaSortText,
                    mediaSortOrder,
                    "切换排序（时间/名称/大小 + 升降序）",
                    "btn media-sort-cycle-btn"
                )
                : renderOrderSortButton(
                    "btn-history-sort-cycle",
                    historySortText,
                    historySortOrder,
                    "切换历史时间排序（升降序）",
                    "btn"
                )
        }
    `;
    const rightButtons = isMedia
        ? `
            ${actionBtn("btn-clean-invalid", "brush-cleaning", "清理失效", "btn", !canCleanInvalid)}
            ${actionBtn("btn-clear-index", "refresh-ccw", "重建数据", "btn danger", !canClearIndex)}
            ${actionBtn("btn-open-settings", "settings", "设置", "btn")}
        `
        : `
            ${actionBtn("btn-clear-data", "trash-2", "数据处理", "btn danger", !canClearData)}
            ${actionBtn("btn-open-settings", "settings", "设置", "btn")}
        `;
    const topActionCount = isMedia ? 6 : 5;
    return `
        <div class="history-list-header compact top-action-bar" style="--top-action-count:${topActionCount}">
            <div class="history-list-header-left">
                ${leftButtons}
            </div>
            <div class="history-list-header-actions">
                ${rightButtons}
            </div>
        </div>
    `;
}

function closeCompactActionsMenu(shouldRender = false) {
    if (!appState.compactActionsMenuOpen) {
        return;
    }
    appState.compactActionsMenuOpen = false;
    if (shouldRender) {
        render();
    }
}

function closeDateRangePanel(shouldRender = false) {
    if (!appState.dateRangePanelOpen) {
        return;
    }
    setDateRangePanelOpen(false, shouldRender);
}

function normalizeMediaSortBy(value) {
    const v = String(value || "").trim().toLowerCase();
    if (MEDIA_SORT_BY_VALUES.has(v)) {
        return v;
    }
    return "mtime";
}

function normalizeMediaSortOrder(value) {
    const v = String(value || "").trim().toLowerCase();
    if (MEDIA_SORT_ORDER_VALUES.has(v)) {
        return v;
    }
    return "desc";
}

function mediaSortDisplayText(sortBy, sortOrder) {
    const by = normalizeMediaSortBy(sortBy);
    const byText = by === "mtime"
        ? "时间"
        : by === "name"
            ? "名称"
            : "大小";
    return byText;
}

function nextMediaSortCombo(sortBy, sortOrder) {
    const combos = [
        { by: "mtime", order: "desc" },
        { by: "name", order: "desc" },
        { by: "size", order: "desc" },
        { by: "mtime", order: "asc" },
        { by: "name", order: "asc" },
        { by: "size", order: "asc" },
    ];
    const by = normalizeMediaSortBy(sortBy);
    const order = normalizeMediaSortOrder(sortOrder);
    const idx = combos.findIndex((item) =>
        item.by === by && item.order === order
    );
    if (idx < 0) {
        return combos[0];
    }
    return combos[(idx + 1) % combos.length];
}

function normalizeHistorySortOrder(value) {
    return normalizeMediaSortOrder(value);
}

function historySortDisplayText(sortOrder) {
    return normalizeHistorySortOrder(sortOrder) === "desc"
        ? "时间降序"
        : "时间升序";
}

function sortOrderIconName(sortOrder) {
    return normalizeMediaSortOrder(sortOrder) === "desc"
        ? "arrow-down"
        : "arrow-up";
}

function renderOrderSortButton(
    id,
    text,
    sortOrder,
    title = "切换排序（升降序）",
    extraClass = "btn"
) {
    return `
        <button
            class="${extraClass}"
            id="${id}"
            title="${escapeAttr(title)}"
            aria-label="${escapeAttr(title)}"
        >
            <span class="btn-emoji" aria-hidden="true">${iconSvg(sortOrderIconName(sortOrder), text, "xdatahub-icon btn-icon")}</span>
            <span class="btn-text">${escapeHtml(text)}</span>
        </button>
    `;
}

function parseSavedAtTs(value) {
    const raw = String(value || "").trim();
    if (!raw) {
        return 0;
    }
    const parsed = Date.parse(raw);
    if (Number.isFinite(parsed)) {
        return parsed / 1000;
    }
    const numeric = Number(raw);
    return Number.isFinite(numeric) ? numeric : 0;
}

function applyHistorySortLocal(items, sortOrder) {
    if (!Array.isArray(items)) {
        return [];
    }
    const order = normalizeHistorySortOrder(sortOrder);
    const decorated = items.map((item, idx) => {
        const ts = parseSavedAtTs(item?.saved_at);
        const recordId = Number(item?.extra?.record_id || 0);
        return {
            item,
            ts,
            recordId: Number.isFinite(recordId) ? recordId : 0,
            idx,
        };
    });
    decorated.sort((a, b) => {
        if (a.ts !== b.ts) {
            return order === "desc" ? b.ts - a.ts : a.ts - b.ts;
        }
        if (a.recordId !== b.recordId) {
            return order === "desc"
                ? b.recordId - a.recordId
                : a.recordId - b.recordId;
        }
        return a.idx - b.idx;
    });
    return decorated.map((entry) => entry.item);
}

function normalizeMediaCardSizePreset(value) {
    const v = String(value || "").trim().toLowerCase();
    if (MEDIA_CARD_SIZE_PRESET_VALUES.has(v)) {
        return v;
    }
    return "standard";
}

function updateDateRangeToggleVisual() {
    const state = currentTabState();
    const active = !!(
        appState.dateRangePanelOpen
        || state.filters.start
        || state.filters.end
    );
    const btn = document.getElementById("btn-toggle-date-range");
    btn?.classList.toggle("active", active);
}

function setDateRangePanelOpen(open, shouldRender = false) {
    appState.dateRangePanelOpen = !!open;
    if (shouldRender) {
        render();
        return;
    }
    const panel = document.getElementById("date-range-panel");
    const backdrop = document.getElementById("date-range-backdrop");
    panel?.classList.toggle("show", appState.dateRangePanelOpen);
    backdrop?.classList.toggle("show", appState.dateRangePanelOpen);
    updateDateRangeToggleVisual();
}

function bindActionButtons() {
    const bind = (id, handler) => {
        document.getElementById(id)?.addEventListener("click", handler);
    };
    const handleAsync = async (fn, errorText, useDataActionLock = false) => {
        if (useDataActionLock && isDataActionLocked()) {
            return;
        }
        try {
            if (useDataActionLock) {
                appState.dataActionInFlight = true;
                // 先把按钮锁定态渲染出来，再进入确认/请求流程，
                // 避免用户感知到“点击后短暂未锁定”的空窗。
                render();
            }
            closeCompactActionsMenu(false);
            const actionDone = await fn();
            if (useDataActionLock && actionDone !== false) {
                lockDataActions();
            }
        } catch (error) {
            setError(error.message || errorText);
        } finally {
            if (useDataActionLock) {
                appState.dataActionInFlight = false;
            }
            render();
        }
    };
    bind("btn-refresh-inline", async () => {
        await handleAsync(doRefresh, "刷新失败", true);
    });
    bind("btn-clean-invalid", async () => {
        await handleAsync(doCleanupInvalid, "清理失败", true);
    });
    bind("btn-clear-index", async () => {
        await handleAsync(doClearIndex, "重建失败", true);
    });
    bind("btn-clear-data", async () => {
        await handleAsync(doClearRecords, "数据处理失败", true);
    });
    bind("btn-open-settings", () => {
        closeCompactActionsMenu(true);
        appState.settingsDialogOpen = true;
        appState.settingsError = "";
        appState.settingsDraft = cloneSettings(appState.settings);
        const overlay = document.getElementById("settings-dialog-overlay");
        overlay?.classList.remove("is-hidden");
        const typeInput = document.getElementById(
            "setting-show-media-chip-type"
        );
        const resInput = document.getElementById(
            "setting-show-media-chip-resolution"
        );
        const dtInput = document.getElementById(
            "setting-show-media-chip-datetime"
        );
        const sizeInput = document.getElementById(
            "setting-show-media-chip-size"
        );
        if (typeInput instanceof HTMLInputElement) {
            typeInput.checked = !!appState.settingsDraft.showMediaChipType;
        }
        if (resInput instanceof HTMLInputElement) {
            resInput.checked = !!appState.settingsDraft.showMediaChipResolution;
        }
        if (dtInput instanceof HTMLInputElement) {
            dtInput.checked = !!appState.settingsDraft.showMediaChipDatetime;
        }
        if (sizeInput instanceof HTMLInputElement) {
            sizeInput.checked = !!appState.settingsDraft.showMediaChipSize;
        }
    });
    bind("btn-toggle-compact-actions", () => {
        appState.dateRangePanelOpen = false;
        appState.compactActionsMenuOpen = !appState.compactActionsMenuOpen;
        render();
    });
    bind("compact-actions-backdrop", () => {
        closeCompactActionsMenu(true);
    });
    bind("btn-toggle-date-range", () => {
        appState.compactActionsMenuOpen = false;
        setDateRangePanelOpen(!appState.dateRangePanelOpen, false);
    });
    bind("date-range-backdrop", () => {
        closeDateRangePanel(false);
    });
}

function clearVideoSchedulerTimer() {
    if (appState.videoSchedulerTimer) {
        clearTimeout(appState.videoSchedulerTimer);
        appState.videoSchedulerTimer = 0;
    }
}

function clearMediaQueueRebuildTimer() {
    if (appState.mediaQueueRebuildTimer) {
        clearTimeout(appState.mediaQueueRebuildTimer);
        appState.mediaQueueRebuildTimer = 0;
    }
}

function unloadMountedVideoCards() {
    if (!root) {
        return;
    }
    root.querySelectorAll(".media-card video[data-video-lazy='1']").forEach((el) => {
        if (!(el instanceof HTMLVideoElement)) {
            return;
        }
        try {
            el.pause();
            el.removeAttribute("src");
            el.load();
        } catch {}
    });
}

function stopVideoScheduler(releaseMounted = false) {
    appState.videoSchedulerSeq += 1;
    appState.videoLoadQueue = [];
    appState.videoActiveLoads = 0;
    appState.videoCardStateMap.clear();
    for (const timer of appState.videoWatchdogMap.values()) {
        clearTimeout(timer);
    }
    appState.videoWatchdogMap.clear();
    clearVideoSchedulerTimer();
    if (releaseMounted) {
        unloadMountedVideoCards();
    }
}

function renderVideoPlaceholderHtml() {
    return (
        '<div class="video-card-placeholder is-loading" '
        + 'data-video-placeholder="1">'
        + '<span class="media-loading-spinner" aria-hidden="true"></span>'
        + `<span class="media-loading-icon">${iconSvg("video", "视频加载中", "xdatahub-icon media-loading-icon-svg")}</span>`
        + "</div>"
    );
}

function buildRankedMediaQueue(mediaType, stateMap) {
    if (!root) {
        return [];
    }
    const selector = `.media-card[data-media-type='${mediaType}'][data-preview-url]`;
    return Array.from(root.querySelectorAll(selector))
        .map((card) => {
            const rank = rankVideoCardForSchedule(card);
            return {
                id: String(card.getAttribute("data-media-item-id") || ""),
                url: String(card.getAttribute("data-preview-url") || ""),
                title: String(card.getAttribute("data-preview-title") || ""),
                resolutionKey: String(
                    card.getAttribute("data-resolution-key") || ""
                ),
                card,
                ...rank,
            };
        })
        .filter((item) => item.id && item.url)
        .filter((item) => {
            const state = stateMap.get(item.id);
            return state !== "loaded" && state !== "loading";
        })
        .sort((a, b) => {
            if (a.visible !== b.visible) {
                return a.visible ? -1 : 1;
            }
            if (a.y !== b.y) {
                return a.y - b.y;
            }
            return a.x - b.x;
        });
}

function scheduleMediaQueueRebuild() {
    if (!isMediaTab(appState.activeTab)) {
        return;
    }
    clearMediaQueueRebuildTimer();
    appState.mediaQueueRebuildTimer = window.setTimeout(() => {
        appState.mediaQueueRebuildTimer = 0;
        if (appState.activeTab === "video") {
            // 仅视频需要滚动重排；图片由浏览器原生加载接管。
            setupVideoCardScheduler(false);
        }
    }, 80);
}

function rankVideoCardForSchedule(card) {
    const rect = card.getBoundingClientRect();
    const viewportH = window.innerHeight || 0;
    const viewportW = window.innerWidth || 0;
    const visible = (
        rect.bottom > 0
        && rect.right > 0
        && rect.top < viewportH
        && rect.left < viewportW
    );
    const y = Math.max(0, rect.top);
    const x = Math.max(0, rect.left);
    return {
        visible,
        y,
        x,
    };
}

function getMediaListenerSet(el) {
    let set = appState.mediaListenerRegistry.get(el);
    if (!set) {
        set = new Set();
        appState.mediaListenerRegistry.set(el, set);
    }
    return set;
}

function addMediaListenerOnce(el, key, eventName, callback) {
    const set = getMediaListenerSet(el);
    if (set.has(key)) {
        return false;
    }
    set.add(key);
    const wrapped = (event) => {
        set.delete(key);
        callback(event);
    };
    el.addEventListener(eventName, wrapped, { once: true });
    return true;
}

function settleVideoActiveLoad(seq) {
    if (seq !== appState.videoSchedulerSeq) {
        return;
    }
    appState.videoActiveLoads = Math.max(0, appState.videoActiveLoads - 1);
    scheduleNextVideoTick(seq);
}

function bindResolutionProbeForVideo(video, resolutionKey) {
    if (appState.settings.showMediaChipResolution === false) {
        return;
    }
    if (!resolutionKey) {
        return;
    }
    const cached = getCachedResolution(resolutionKey);
    if (cached) {
        applyResolutionText(resolutionKey, cached);
        return;
    }
    const applyVideo = () => {
        const text = formatResolution(video.videoWidth, video.videoHeight);
        if (text) {
            applyResolutionText(resolutionKey, text);
        }
    };
    if (video.videoWidth > 0 && video.videoHeight > 0) {
        applyVideo();
    } else {
        addMediaListenerOnce(
            video,
            `res-video:${resolutionKey}`,
            "loadedmetadata",
            applyVideo
        );
    }
}


function mountVideoPreview(item, seq, onDone) {
    const {
        id,
        url,
        card,
        resolutionKey,
    } = item;
    if (
        seq !== appState.videoSchedulerSeq
        || !card.isConnected
    ) {
        onDone?.();
        return false;
    }
    const thumb = card.querySelector(".media-thumb");
    if (!(thumb instanceof HTMLElement)) {
        onDone?.();
        return false;
    }
    let settled = false;
    const settle = (state) => {
        if (settled) {
            return;
        }
        settled = true;
        const timer = appState.videoWatchdogMap.get(id);
        if (timer) {
            clearTimeout(timer);
            appState.videoWatchdogMap.delete(id);
        }
        if (state) {
            appState.videoCardStateMap.set(id, state);
        }
        onDone?.();
    };
    const existing = thumb.querySelector("video[data-video-lazy='1']");
    if (existing instanceof HTMLVideoElement) {
        bindResolutionProbeForVideo(existing, resolutionKey);
        if (existing.videoWidth > 0 && existing.videoHeight > 0) {
            appState.videoCardStateMap.set(id, "loaded");
            settle(null);
            return true;
        }
        addMediaListenerOnce(
            existing,
            `video-meta:${id}`,
            "loadedmetadata",
            () => {
                bindResolutionProbeForVideo(existing, resolutionKey);
                settle("loaded");
            }
        );
        addMediaListenerOnce(
            existing,
            `video-error:${id}`,
            "error",
            () => settle("error")
        );
        const watchdog = window.setTimeout(
            () => settle("error"),
            VIDEO_LOAD_TIMEOUT_MS
        );
        appState.videoWatchdogMap.set(id, watchdog);
        return true;
    }
    const urlText = String(url || "");
    if (!urlText) {
        appState.videoCardStateMap.set(id, "error");
        onDone?.();
        return false;
    }
    const video = document.createElement("video");
    video.setAttribute("data-video-lazy", "1");
    video.muted = true;
    video.preload = "metadata";
    video.playsInline = true;
    video.src = urlText;
    thumb.innerHTML = "";
    thumb.appendChild(video);
    addMediaListenerOnce(
        video,
        `video-meta:${id}`,
        "loadedmetadata",
        () => {
            bindResolutionProbeForVideo(video, resolutionKey);
            settle("loaded");
        }
    );
    addMediaListenerOnce(
        video,
        `video-error:${id}`,
        "error",
        () => settle("error")
    );
    const watchdog = window.setTimeout(
        () => settle("error"),
        VIDEO_LOAD_TIMEOUT_MS
    );
    appState.videoWatchdogMap.set(id, watchdog);
    return true;
}

function scheduleNextVideoTick(seq) {
    if (seq !== appState.videoSchedulerSeq) {
        return;
    }
    if (appState.videoSchedulerTimer) {
        return;
    }
    appState.videoSchedulerTimer = window.setTimeout(() => {
        appState.videoSchedulerTimer = 0;
        runVideoSchedulerTick(seq);
    }, VIDEO_SCHEDULER_BATCH_DELAY_MS);
}

function runVideoSchedulerTick(seq) {
    if (seq !== appState.videoSchedulerSeq) {
        return;
    }
    if (appState.activeTab !== "video") {
        return;
    }
    const startedAt = performance.now();
    let launched = 0;
    while (
        appState.videoLoadQueue.length > 0
        && appState.videoActiveLoads < VIDEO_SCHEDULER_MAX_CONCURRENCY
        && launched < VIDEO_SCHEDULER_BATCH_SIZE
    ) {
        if ((performance.now() - startedAt) >= VIDEO_SCHEDULER_TIME_BUDGET_MS) {
            break;
        }
        const next = appState.videoLoadQueue.shift();
        if (!next) {
            break;
        }
        if (
            !next.card?.isConnected
            || appState.videoCardStateMap.get(next.id) === "loaded"
            || appState.videoCardStateMap.get(next.id) === "loading"
        ) {
            continue;
        }
        appState.videoCardStateMap.set(next.id, "loading");
        appState.videoActiveLoads += 1;
        launched += 1;
        requestAnimationFrame(() => {
            const started = mountVideoPreview(
                next,
                seq,
                () => settleVideoActiveLoad(seq)
            );
            if (!started) {
                settleVideoActiveLoad(seq);
            }
        });
    }
    if (
        appState.videoLoadQueue.length > 0
        || appState.videoActiveLoads > 0
    ) {
        scheduleNextVideoTick(seq);
    }
}

function setupVideoCardScheduler(resetState = true) {
    if (appState.activeTab !== "video" || !root) {
        stopVideoScheduler(false);
        return;
    }
    if (resetState) {
        stopVideoScheduler(false);
    }
    const queue = buildRankedMediaQueue(
        "video",
        appState.videoCardStateMap
    );
    if (!queue.length && appState.videoActiveLoads <= 0) {
        return;
    }
    appState.videoLoadQueue = queue;
    const seq = appState.videoSchedulerSeq;
    runVideoSchedulerTick(seq);
}

function renderListRows() {
    const selectedId = currentTabState().selectedId;
    return appState.items
        .map((item) => {
            const contentPreview = getRecordContentPreview(item);
            const savedAt = formatDateTime(item.saved_at || "");
            const extraHeader = String(item.extra?.extra_header || "");
            const dataType = String(item.extra?.data_type || "");
            const recordId = String(item.extra?.record_id || "");
            const dbName = String(item.extra?.db_name || "");
            const dbAccent = getDbAccentColor(dbName);
            const rowStyle = ` style="--db-accent:${escapeAttr(dbAccent)}"`;
            const activeClass = String(item.id) === String(selectedId) ? " active" : "";
            let idDbChipHtml = "";
            if (recordId && dbName) {
                idDbChipHtml = `
                    <span class="row-id-db-group">
                        <span class="chip row-id-chip">${escapeHtml(recordId)}</span>
                        <span class="row-id-db-sep" aria-hidden="true"></span>
                        <span class="chip row-db-chip"><span class="chip-icon chip-icon-db" aria-hidden="true"></span> ${escapeHtml(dbName)}</span>
                    </span>
                `;
            } else if (recordId) {
                idDbChipHtml = `<span class="chip row-id-chip">${escapeHtml(recordId)}</span>`;
            } else if (dbName) {
                idDbChipHtml = `<span class="chip row-db-chip"><span class="chip-icon chip-icon-db" aria-hidden="true"></span> ${escapeHtml(dbName)}</span>`;
            }
            return `
                <div class="row${activeClass}" data-item-id="${escapeHtml(item.id)}"${rowStyle}>
                    <div class="row-id-line">
                        <div class="row-id-chip-wrap">
                            ${idDbChipHtml}
                        </div>
                    </div>
                    <div class="row-content-line">
                        <div class="row-title row-content-text">${escapeHtml(contentPreview || "(无内容)")}</div>
                        <button
                            class="btn row-copy-btn row-copy-btn-inline"
                            type="button"
                            data-copy-preview="${escapeAttr(contentPreview || "")}"
                            title="复制左侧内容"
                            aria-label="复制左侧内容"
                        >
                            <span class="btn-emoji" aria-hidden="true">${iconSvg("copy", "复制", "xdatahub-icon btn-icon")}</span>
                            <span class="btn-text row-copy-btn-text">复制</span>
                        </button>
                    </div>
                    ${
                        savedAt || dataType || extraHeader
                            ? `<div class="row-time-line row-time-line-primary">
                                ${
                                    savedAt
                                        ? `<span class="chip">${escapeHtml(savedAt)}</span>`
                                        : ""
                                }
                                ${
                                    dataType
                                        ? `<span class="chip">${iconSvg("workflow", "数据类型", "xdatahub-icon chip-icon")} ${escapeHtml(dataType)}</span>`
                                        : ""
                                }
                                ${
                                    extraHeader
                                        ? `<span class="chip row-extra-inline" title="${escapeAttr(extraHeader)}">${iconSvg("tag", "标签", "xdatahub-icon chip-icon")} ${escapeHtml(extraHeader)}</span>`
                                        : ""
                                }
                            </div>`
                            : ""
                    }
                </div>
            `;
        })
        .join("");
}

function updateHistoryRowExtraHeaderLayout() {
    // 当前设计：extra_header 固定在时间行内，超长时单行省略并通过 title 查看完整内容。
}

function scheduleHistoryRowExtraHeaderLayout() {
    if (historyRowExtraLayoutRaf) {
        cancelAnimationFrame(historyRowExtraLayoutRaf);
    }
    historyRowExtraLayoutRaf = requestAnimationFrame(() => {
        historyRowExtraLayoutRaf = 0;
        updateHistoryRowExtraHeaderLayout();
    });
}

function renderMediaGrid() {
    if (appState.loading || appState.error || appState.items.length === 0) {
        return renderStatus();
    }
    const showTypeChip = appState.settings.showMediaChipType !== false;
    const showResolutionChip =
        appState.settings.showMediaChipResolution !== false;
    const showDatetimeChip =
        appState.settings.showMediaChipDatetime !== false;
    const showSizeChip = appState.settings.showMediaChipSize !== false;
    const lastOpenedMediaId = String(currentTabState().lastOpenedMediaId || "");
    const lastOpenedMediaUrl = String(
        currentTabState().lastOpenedMediaUrl || ""
    );
    return appState.items
        .map((item) => {
            if (item.kind === "folder" || item.extra?.entry_type === "folder") {
                const folderPath = String(item.path || item.extra?.child_path || "");
                return `
                    <article class="media-card media-folder-card" data-folder-path="${escapeAttr(folderPath)}">
                        <div class="media-thumb media-folder-thumb">
                            <div class="media-folder-thumb-inner">
                                <div class="media-folder-icon">${iconSvg("folder", "文件夹", "xdatahub-icon folder-icon-svg")}</div>
                                <div class="media-folder-kind">文件夹</div>
                            </div>
                        </div>
                        <div class="media-meta">
                            <div class="media-title" title="${escapeAttr(item.title || "文件夹")}">${escapeHtml(item.title || "文件夹")}</div>
                        </div>
                    </article>
                `;
            }
            const mediaType = item.extra?.media_type || mediaTypeOfTab(appState.activeTab);
            const mediaItemId = String(item.id || "");
            const fileUrl = item.extra?.file_url || "";
            const mediaFileUrl = String(fileUrl || "");
            const canShowResolutionChip = (
                showResolutionChip
                && (mediaType === "image" || mediaType === "video")
            );
            const resolutionKey = canShowResolutionChip
                ? buildResolutionKey(item)
                : "";
            const resolutionText = canShowResolutionChip
                ? getResolutionText(item, mediaType, resolutionKey)
                : "";
            const savedAt = showDatetimeChip
                ? formatDateTime(item.saved_at || "")
                : "";
            const fileSize = showSizeChip
                ? formatFileSize(item.extra?.size)
                : "";
            const visiblePrimaryChipCount = (
                (showTypeChip ? 1 : 0)
                + (
                    (
                        showResolutionChip
                        && (mediaType === "image" || mediaType === "video")
                    )
                        ? 1
                        : 0
                )
            );
            const visibleMetaChipCount = (
                ((showDatetimeChip && savedAt) ? 1 : 0)
                + ((showSizeChip && fileSize) ? 1 : 0)
            );
            const showPrimaryRow = visiblePrimaryChipCount > 0;
            const showMetaRow = visibleMetaChipCount > 0;
            const hasVisibleChips = showPrimaryRow || showMetaRow;
            const mediaTitleClass = hasVisibleChips
                ? "media-title with-chips"
                : "media-title";
            const cardActiveClass = (
                (mediaItemId && mediaItemId === lastOpenedMediaId)
                || (
                    mediaFileUrl
                    && lastOpenedMediaUrl
                    && mediaFileUrl === lastOpenedMediaUrl
                )
            )
                ? " media-card-last-opened"
                : "";
            const mediaIcon = (
                mediaType === "image"
                    ? "image"
                    : mediaType === "video"
                        ? "video"
                        : "audio-lines"
            );
            const previewAttrs = (
                mediaType === "image"
                || mediaType === "audio"
                || mediaType === "video"
            )
                ? `data-preview-kind="${escapeAttr(mediaType)}" data-preview-url="${escapeAttr(fileUrl)}" data-preview-title="${escapeAttr(item.title || "")}"`
                : "";
            const dragAttrs = (
                (mediaType === "video" || mediaType === "audio")
                && mediaFileUrl
            )
                ? ` draggable="true" data-drag-media="1" data-drag-url-fallback="${escapeAttr(mediaFileUrl)}" data-drag-url-preferred="${escapeAttr(buildComfyViewUrlFromEntryPath(item.path || "", item.title || ""))}" data-drag-media-type="${escapeAttr(mediaType)}" data-drag-title="${escapeAttr(item.title || "")}"`
                : "";
            const resolutionAttr = canShowResolutionChip
                ? ` data-resolution-key="${escapeAttr(resolutionKey)}"`
                : "";
            let previewHtml = "";
            if (mediaType === "image") {
                // 设计说明：图片使用浏览器原生加载，避免历史分批调度在
                // 极端滚动下出现黑块/挂起。这里保持直接 <img src>。
                previewHtml = `<img src="${escapeAttr(fileUrl)}" alt="${escapeAttr(item.title || "image")}">`;
            } else if (mediaType === "video") {
                // 设计说明：视频保持分批调度，先渲染占位，后按队列挂载
                // <video> 以控制首帧解码并发。
                previewHtml = renderVideoPlaceholderHtml();
            } else {
                previewHtml = `<div class="audio-card-hint"><div class="audio-card-icon">${iconSvg("audio-lines", "音频", "xdatahub-icon audio-icon-svg")}</div><div>点击打开播放器</div></div>`;
            }
            return `
                <article class="media-card${cardActiveClass}" ${previewAttrs}${dragAttrs} data-media-item-id="${escapeAttr(mediaItemId)}" data-media-type="${escapeAttr(mediaType)}"${resolutionAttr}>
                    <div class="media-thumb">${previewHtml}</div>
                        <div class="media-meta">
                            <div class="${mediaTitleClass}" title="${escapeAttr(item.title || "")}">${escapeHtml(item.title || "(无标题)")}</div>
                            ${
                                (showTypeChip
                                    || canShowResolutionChip
                                    || showDatetimeChip
                                    || showSizeChip)
                                    ? `<div class="media-chips">
                                        ${
                                            showPrimaryRow
                                                ? `<div class="media-chip-row media-chip-row-primary">
                                                    ${
                                                        showTypeChip
                                                            ? `<span class="chip">${iconSvg(mediaIcon, mediaType.toUpperCase(), "xdatahub-icon chip-icon")} ${escapeHtml(mediaType.toUpperCase())}</span>`
                                                            : ""
                                                    }
                                                    ${
                                                        canShowResolutionChip
                                                            ? `<span class="chip resolution-chip ${resolutionText ? "" : "pending"}" data-resolution-chip="${escapeAttr(resolutionKey)}">${escapeHtml(resolutionText || "...")}</span>`
                                                            : ""
                                                    }
                                                </div>`
                                                : ""
                                        }
                                        ${
                                            showMetaRow
                                                ? `<div class="media-chip-row media-chip-row-meta">
                                                    ${
                                                        (showDatetimeChip && savedAt)
                                                            ? `<span class="chip">${escapeHtml(savedAt)}</span>`
                                                            : ""
                                                    }
                                                    ${
                                                        (showSizeChip && fileSize)
                                                            ? `<span class="chip">${escapeHtml(fileSize)}</span>`
                                                            : ""
                                                    }
                                                </div>`
                                                : ""
                                        }
                                    </div>`
                                    : ""
                            }
                    </div>
                </article>
            `;
        })
        .join("");
}

function renderSettingsDialog() {
    const draft = cloneSettings(appState.settingsDraft || appState.settings);
    return `
        <div class="danger-dialog-overlay ${appState.settingsDialogOpen ? "" : "is-hidden"}" id="settings-dialog-overlay">
            <div class="danger-dialog settings-dialog" role="dialog" aria-modal="true" aria-label="XDataHub 设置">
                <div class="danger-dialog-title settings-dialog-title">${iconSvg("settings", "设置", "xdatahub-icon dialog-title-icon")} 控制面板</div>
                <div class="settings-section">
                    <div class="settings-section-title">${iconSvg("tags", "卡片标签显示", "xdatahub-icon chip-icon")} 卡片标签显示</div>
                    <label class="cleanup-all-toggle settings-toggle-row">
                        <input
                            type="checkbox"
                            id="setting-show-media-chip-type"
                            ${draft.showMediaChipType ? "checked" : ""}
                            ${appState.settingsSaving ? "disabled" : ""}
                        >
                        <span>显示类型标签</span>
                    </label>
                    <label class="cleanup-all-toggle settings-toggle-row">
                        <input
                            type="checkbox"
                            id="setting-show-media-chip-resolution"
                            ${draft.showMediaChipResolution ? "checked" : ""}
                            ${appState.settingsSaving ? "disabled" : ""}
                        >
                        <span>显示分辨率标签（图片/视频）</span>
                    </label>
                    <label class="cleanup-all-toggle settings-toggle-row">
                        <input
                            type="checkbox"
                            id="setting-show-media-chip-datetime"
                            ${draft.showMediaChipDatetime ? "checked" : ""}
                            ${appState.settingsSaving ? "disabled" : ""}
                        >
                        <span>显示日期时间标签</span>
                    </label>
                    <label class="cleanup-all-toggle settings-toggle-row">
                        <input
                            type="checkbox"
                            id="setting-show-media-chip-size"
                            ${draft.showMediaChipSize ? "checked" : ""}
                            ${appState.settingsSaving ? "disabled" : ""}
                        >
                        <span>显示文件大小标签</span>
                    </label>
                </div>
                <div class="settings-section">
                    <div class="settings-section-title">${iconSvg("layout-grid", "卡片布局", "xdatahub-icon chip-icon")} 卡片布局</div>
                    <div class="danger-dialog-input-wrap settings-select-row">
                        <span>卡片大小:</span>
                        <select id="setting-media-card-size-preset" ${appState.settingsSaving ? "disabled" : ""}>
                            <option value="compact" ${draft.mediaCardSizePreset === "compact" ? "selected" : ""}>紧凑</option>
                            <option value="standard" ${draft.mediaCardSizePreset === "standard" ? "selected" : ""}>标准</option>
                            <option value="large" ${draft.mediaCardSizePreset === "large" ? "selected" : ""}>宽大</option>
                        </select>
                    </div>
                </div>
                <div class="settings-section">
                    <div class="settings-section-title">${iconSvg("audio-lines", "媒体播放", "xdatahub-icon chip-icon")} 媒体播放</div>
                    <label class="cleanup-all-toggle settings-toggle-row">
                        <input
                            type="checkbox"
                            id="setting-video-preview-autoplay"
                            ${draft.videoPreviewAutoplay ? "checked" : ""}
                            ${appState.settingsSaving ? "disabled" : ""}
                        >
                        <span>默认打开视频时自动播放</span>
                    </label>
                    <label class="cleanup-all-toggle settings-toggle-row">
                        <input
                            type="checkbox"
                            id="setting-video-preview-muted"
                            ${draft.videoPreviewMuted ? "checked" : ""}
                            ${appState.settingsSaving ? "disabled" : ""}
                        >
                        <span>默认静音打开视频</span>
                    </label>
                    <label class="cleanup-all-toggle settings-toggle-row">
                        <input
                            type="checkbox"
                            id="setting-audio-preview-autoplay"
                            ${draft.audioPreviewAutoplay ? "checked" : ""}
                            ${appState.settingsSaving ? "disabled" : ""}
                        >
                        <span>默认打开音频时自动播放</span>
                    </label>
                    <label class="cleanup-all-toggle settings-toggle-row">
                        <input
                            type="checkbox"
                            id="setting-audio-preview-muted"
                            ${draft.audioPreviewMuted ? "checked" : ""}
                            ${appState.settingsSaving ? "disabled" : ""}
                        >
                        <span>默认静音打开音频</span>
                    </label>
                </div>
                ${
                    appState.settingsError
                        ? `<div class="status error">${escapeHtml(appState.settingsError)}</div>`
                        : ""
                }
                <div class="danger-dialog-actions">
                    <button class="btn" id="settings-dialog-cancel" title="取消" aria-label="取消" ${appState.settingsSaving ? "disabled" : ""}>${iconSvg("x", "取消", "xdatahub-icon btn-icon")} 取消</button>
                    <button class="btn primary" id="settings-dialog-save" title="${appState.settingsSaving ? "保存中" : "保存设置"}" aria-label="${appState.settingsSaving ? "保存中" : "保存设置"}" ${appState.settingsSaving ? "disabled" : ""}>
                        ${
                            appState.settingsSaving
                                ? `${iconSvg("refresh-cw", "保存中", "xdatahub-icon btn-icon")} 保存中...`
                                : `${iconSvg("save", "保存设置", "xdatahub-icon btn-icon")} 保存设置`
                        }
                    </button>
                </div>
            </div>
        </div>
    `;
}

function renderMediaExplorerBar() {
    const state = currentTabState();
    ensureMediaNavState(state);
    const rootName = normalizeMediaRoot(state.mediaRoot);
    const subdir = normalizeMediaSubdir(state.mediaSubdir);
    const fullPath = subdir ? `${rootName}/${subdir}` : rootName;
    const canGoBack = state.mediaBackStack.length > 0;
    const canGoForward = state.mediaForwardStack.length > 0;
    return `
        <div class="media-explorer-bar">
            <div class="media-root-switch">
                <button class="btn ${rootName === "input" ? "active" : ""}" id="btn-media-root-input" title="切换到 input 文件夹" aria-label="切换到 input 文件夹">${iconSvg("folder-input", "input 文件夹", "xdatahub-icon btn-icon")} input 文件夹</button>
                <button class="btn ${rootName === "output" ? "active" : ""}" id="btn-media-root-output" title="切换到 output 文件夹" aria-label="切换到 output 文件夹">${iconSvg("folder-output", "output 文件夹", "xdatahub-icon btn-icon")} output 文件夹</button>
            </div>
            <div class="media-path-line">
                <button class="btn" id="btn-media-up" title="返回上一个路径" aria-label="返回上一个路径" ${canGoBack ? "" : "disabled"}>${iconSvg("arrow-left", "返回", "xdatahub-icon btn-icon")} 返回</button>
                <button class="btn" id="btn-media-forward" title="前进到下一个路径" aria-label="前进到下一个路径" ${canGoForward ? "" : "disabled"}>${iconSvg("arrow-right", "前进", "xdatahub-icon btn-icon")} 前进</button>
                <span class="media-path-text" title="${escapeAttr(fullPath)}">${escapeHtml(fullPath)}</span>
            </div>
        </div>
    `;
}

function renderImagePreview() {
    if (!appState.imagePreview.open) {
        return "";
    }
    const isImage = appState.imagePreview.kind === "image";
    const isAudio = appState.imagePreview.kind === "audio";
    const isVideo = appState.imagePreview.kind === "video";
    const title = appState.imagePreview.title || (
        isImage ? "图片预览" : isVideo ? "视频播放" : "音频播放"
    );
    return `
        <div class="image-lightbox" id="image-lightbox">
            <div class="image-lightbox-backdrop" id="image-lightbox-close"></div>
            <div class="image-lightbox-content">
                <div class="image-lightbox-head">
                    <div class="image-lightbox-head-pill">
                        <div class="image-lightbox-title">${escapeHtml(title)}</div>
                        <button class="btn image-lightbox-close-btn" id="image-lightbox-close-btn" title="关闭预览" aria-label="关闭预览">${iconSvg("x", "关闭预览", "xdatahub-icon btn-icon")} 关闭</button>
                    </div>
                </div>
                <div class="image-lightbox-body ${isAudio ? "audio" : isVideo ? "video" : "image"}">
                    ${
                        isImage
                            ? `<div class="image-lightbox-stage" id="image-lightbox-stage">
                        <img
                            id="image-lightbox-image"
                            src="${escapeAttr(appState.imagePreview.url)}"
                            alt="${escapeAttr(appState.imagePreview.title || "image")}"
                            draggable="false"
                        >
                    </div>`
                            : ""
                    }
                    ${
                        isAudio
                            ? `<div class="media-lightbox media-lightbox-audio">
                        <div class="audio-lightbox-icon">${iconSvg("audio-lines", "音频", "xdatahub-icon audio-lightbox-icon-svg")}</div>
                        <audio
                            id="audio-lightbox-player"
                            src="${escapeAttr(appState.imagePreview.url)}"
                            controls
                            preload="metadata"
                            ${appState.settings.audioPreviewAutoplay ? "autoplay" : ""}
                            ${appState.settings.audioPreviewMuted ? "muted" : ""}
                        ></audio>
                    </div>`
                            : ""
                    }
                    ${
                        isVideo
                            ? `<div class="media-lightbox media-lightbox-video">
                        <video
                            id="video-lightbox-player"
                            src="${escapeAttr(appState.imagePreview.url)}"
                            controls
                            preload="metadata"
                            ${appState.settings.videoPreviewAutoplay ? "autoplay" : ""}
                            ${appState.settings.videoPreviewMuted ? "muted" : ""}
                            playsinline
                        ></video>
                    </div>`
                            : ""
                    }
                </div>
            </div>
        </div>
    `;
}

function renderDetail() {
    const item = selectedItem();
    if (!item) {
        return '<div class="status">暂无选中项</div>';
    }
    if (appState.activeTab === "history") {
        return renderHistoryDetail(item);
    }
    const mediaType = item.extra?.media_type || mediaTypeOfTab(appState.activeTab);
    const fileUrl = item.extra?.file_url || "";
    if (mediaType === "image") {
        return `
            <div id="preview-media" class="preview-box">
                <img src="${escapeAttr(fileUrl)}" alt="preview">
            </div>
            <pre>${escapeHtml(JSON.stringify(item.extra || {}, null, 2))}</pre>
        `;
    }
    if (mediaType === "video") {
        return `
            <div id="preview-media" class="preview-box">
                <video src="${escapeAttr(fileUrl)}" controls muted preload="metadata"></video>
            </div>
            <pre>${escapeHtml(JSON.stringify(item.extra || {}, null, 2))}</pre>
        `;
    }
    return `
        <div id="preview-media" class="preview-box">
            <audio src="${escapeAttr(fileUrl)}" controls preload="metadata"></audio>
        </div>
        <pre>${escapeHtml(JSON.stringify(item.extra || {}, null, 2))}</pre>
    `;
}

function renderHistoryDetail(item) {
    const payloadInfo = normalizePayloadValue(item?.extra?.payload);
    const rawText = payloadToJson(item?.extra || {});
    const bodyHtml = appState.historyDetailRaw
        ? `<pre class="record-detail-raw">${escapeHtml(rawText)}</pre>`
        : renderPayloadNode(payloadInfo.value);
    const notice = appState.copyNotice.text
        ? `<span class="copy-notice ${appState.copyNotice.error ? "error" : ""}">${escapeHtml(appState.copyNotice.text)}</span>`
        : "";
    return `
        <div class="record-detail">
            <div class="record-detail-actions">
                <button class="btn" id="btn-toggle-raw" title="${appState.historyDetailRaw ? "显示结构化" : "显示原始格式"}" aria-label="${appState.historyDetailRaw ? "显示结构化" : "显示原始格式"}">${appState.historyDetailRaw ? "显示结构化" : "显示原始格式"}</button>
                <button class="btn" id="btn-copy-payload" data-copy-target="payload" title="复制内容" aria-label="复制内容">复制内容</button>
                <button class="btn" id="btn-copy-record" data-copy-target="record" title="复制本条记录" aria-label="复制本条记录">复制本条记录</button>
                ${notice}
            </div>
            <div class="record-detail-body">
                ${bodyHtml}
            </div>
        </div>
    `;
}

function renderDangerDialog() {
    const dialog = appState.dangerDialog;
    if (!dialog.open) {
        return "";
    }
    let title = "危险操作确认";
    let message = "此操作不可撤销。请输入 YES 以继续。";
    let scopeHtml = "";
    if (dialog.kind === "clear-history") {
        title = "清空历史数据";
        const deleteAll = !!dialog.meta?.deleteAll;
        const dbName = String(dialog.meta?.dbName || "").trim();
        const dbOptions = [
            ...new Set([
                ...appState.recordFacets.dbNames,
                dbName,
            ]),
        ].filter(Boolean);
        if (deleteAll || !dbName) {
            message = "你将删除全部数据库中的历史数据记录。此操作不可恢复。请输入 YES 后才可确认删除。";
        } else {
            message = `你将仅删除数据库 ${dbName} 的历史数据记录。此操作不可恢复。请输入 YES 后才可确认删除。`;
        }
        scopeHtml = `
            <div class="danger-dialog-input-wrap">
                <span>目标数据库:</span>
                <select id="danger-clear-db-target" ${deleteAll ? "disabled" : ""}>
                    <option value="">请选择数据库</option>
                    ${dbOptions
                        .map((name) => `<option value="${escapeAttr(name)}" ${name === dbName ? "selected" : ""}>${escapeHtml(name)}</option>`)
                        .join("")}
                </select>
                <label class="cleanup-all-toggle">
                    <input id="danger-clear-all" type="checkbox" ${deleteAll ? "checked" : ""}>
                    <span>删除全部历史</span>
                </label>
            </div>
        `;
    }
    return `
        <div class="danger-dialog-overlay" id="danger-dialog-overlay">
            <div class="danger-dialog" role="dialog" aria-modal="true" aria-labelledby="danger-dialog-title">
                <div class="danger-dialog-title" id="danger-dialog-title">${iconSvg("triangle-alert", "警告", "xdatahub-icon dialog-title-icon")} ${escapeHtml(title)}</div>
                <div class="danger-dialog-msg">${escapeHtml(message)}</div>
                ${scopeHtml}
                <div class="danger-dialog-input-wrap">
                    <span>确认口令:</span>
                    <input id="danger-dialog-input" autocomplete="off" placeholder="请输入 YES" value="${escapeAttr(dialog.input)}">
                </div>
                <div class="danger-dialog-actions">
                    <button class="btn" id="danger-dialog-cancel" title="取消" aria-label="取消">取消</button>
                    <button class="btn danger" id="danger-dialog-confirm" title="确认删除" aria-label="确认删除" ${isDangerDialogConfirmed() ? "" : "disabled"}>确认删除</button>
                </div>
            </div>
        </div>
    `;
}

function renderDbDeleteDialog() {
    if (!appState.dbDeleteDialogOpen) {
        return "";
    }
    const isDeleteMode = appState.clearDataMode === "delete";
    const selectedCount = appState.selectedDbFiles.length;
    const criticalCount = selectedCriticalDbCount();
    const refreshLocked = isDbRefreshLocked();
    const needSecondYes = isDeleteMode && criticalCount > 0;
    const submitDisabled = isDeleteMode
        ? (!canSubmitDbDelete() || appState.dbDeleteLoading)
        : (!canSubmitRecordsCleanup() || appState.dbDeleteLoading);
    const rows = appState.dbFileList.map((item) => {
        const checked = isDbSelected(item.name) ? "checked" : "";
        const critical = isDbCriticalEffective(item);
        const builtin = !!item.is_critical_builtin;
        const locked = critical && !appState.unlockCritical;
        const purposeLabel = String(item.purpose || "数据库");
        const purposeIcon = dbPurposeIconName(purposeLabel);
        const rowClass = builtin
            ? "critical-builtin"
            : critical
                ? "critical-user"
                : "";
        const overrideChecked = !!item.is_critical_user;
        return `
            <div class="db-delete-row ${rowClass}">
                <label class="db-delete-select db-delete-segment db-delete-segment-left">
                    <input type="checkbox" data-db-file-check="${escapeAttr(item.name)}" ${checked} ${locked ? "disabled" : ""}>
                    <span class="db-delete-name">${escapeHtml(item.name)}</span>
                </label>
                <div class="db-delete-meta db-delete-segment db-delete-segment-middle">
                    <span class="chip">${iconSvg(purposeIcon, purposeLabel, "xdatahub-icon chip-icon")} ${escapeHtml(purposeLabel)}</span>
                    <span class="chip">${escapeHtml(`${Number(item.record_count || 0)} 条`)}</span>
                </div>
                ${
                    builtin
                        ? '<span class="db-critical-mark db-delete-segment db-delete-segment-right db-critical-mark-disabled">内置关键库</span>'
                        : `<label class="db-critical-mark db-delete-segment db-delete-segment-right">
                            <input type="checkbox" data-db-critical-mark="${escapeAttr(item.name)}" ${overrideChecked ? "checked" : ""}>
                            <span>标记关键</span>
                        </label>`
                }
            </div>
        `;
    }).join("");
    return `
        <div class="db-delete-overlay" id="db-delete-overlay">
            <div class="db-delete-dialog" role="dialog" aria-modal="true">
                <div class="db-delete-head">
                    <div class="db-delete-title">${iconSvg("triangle-alert", "警告", "xdatahub-icon dialog-title-icon")} 清除数据</div>
                    <label class="db-delete-unlock db-delete-unlock-top">
                        <input type="checkbox" id="db-delete-unlock-critical" ${appState.unlockCritical ? "" : "checked"}>
                        <span>锁定关键数据库</span>
                    </label>
                </div>
                <div class="db-delete-mode-switch">
                    <button class="btn ${isDeleteMode ? "" : "active"}" id="btn-clear-mode-records" title="切换到清空历史记录模式" aria-label="切换到清空历史记录模式">${iconSvg("database", "清空历史记录", "xdatahub-icon btn-icon")} 清空历史记录</button>
                    <button class="btn ${isDeleteMode ? "active" : ""}" id="btn-clear-mode-delete" title="切换到删除数据库文件模式" aria-label="切换到删除数据库文件模式">${iconSvg("trash-2", "删除数据库文件", "xdatahub-icon btn-icon")} 删除数据库文件</button>
                </div>
                <div class="db-delete-desc">请选择要操作的数据库。关键数据库默认受保护（锁定）。此操作不可恢复，请谨慎确认。</div>
                <div class="db-delete-tools">
                    <button class="btn" id="btn-db-select-all" title="全选数据库文件" aria-label="全选数据库文件">${iconSvg("check", "全选", "xdatahub-icon btn-icon")} 全选</button>
                    <button class="btn" id="btn-db-clear-selection" title="清空已选数据库文件" aria-label="清空已选数据库文件">${iconSvg("x", "清空选择", "xdatahub-icon btn-icon")} 清空选择</button>
                    <button class="btn" id="btn-db-refresh-list" title="刷新数据库列表" aria-label="刷新数据库列表" ${refreshLocked || appState.dbDeleteLoading || appState.dbRefreshInFlight ? "disabled" : ""}>${iconSvg("refresh-cw", "刷新", "xdatahub-icon btn-icon")} 刷新</button>
                </div>
                <div class="db-delete-list">
                    ${rows || '<div class="status">暂无数据库文件</div>'}
                </div>
                <div class="db-delete-summary">${
                    isDeleteMode
                        ? `将删除 ${selectedCount} 个文件（关键 ${criticalCount} 个）`
                        : `将清空 ${selectedCount} 个数据库的历史记录（关键 ${criticalCount} 个）`
                }</div>
                <div class="db-delete-confirm-hint">确认操作：请在下方输入 <code>YES</code>。</div>
                <div class="db-delete-confirm-row">
                    <span>确认口令:</span>
                    <input id="db-delete-confirm-yes" value="${escapeAttr(appState.confirmYes)}" autocomplete="off">
                </div>
                ${
                    needSecondYes
                        ? `<div class="db-delete-confirm-hint">检测到关键库：请再次输入 <code>YES</code> 进行二次确认。</div>
                        <div class="db-delete-confirm-row">
                            <span>关键库二次口令:</span>
                            <input id="db-delete-confirm-yes-critical" value="${escapeAttr(appState.confirmYesCritical)}" autocomplete="off">
                        </div>`
                        : ""
                }
                ${
                    appState.dbDeleteError
                        ? `<div class="status error">${escapeHtml(appState.dbDeleteError)}</div>`
                        : ""
                }
                ${
                    appState.dbDeleteResult
                        ? `<div class="status">${escapeHtml(appState.dbDeleteResult)}</div>`
                        : ""
                }
                <div class="db-delete-actions">
                    <button class="btn" id="db-delete-cancel" title="取消" aria-label="取消">${iconSvg("x", "取消", "xdatahub-icon btn-icon")} 取消</button>
                    <button class="btn danger" id="db-delete-submit" title="${isDeleteMode ? "确认删除所选文件" : "确认清空所选历史"}" aria-label="${isDeleteMode ? "确认删除所选文件" : "确认清空所选历史"}" ${submitDisabled ? "disabled" : ""}>
                        ${
                            appState.dbDeleteLoading
                                ? `${iconSvg("refresh-cw", isDeleteMode ? "删除中" : "清空中", "xdatahub-icon btn-icon")} ${isDeleteMode ? "删除中..." : "清空中..."}`
                                : `${iconSvg("triangle-alert", isDeleteMode ? "确认删除所选文件" : "确认清空所选历史", "xdatahub-icon btn-icon")} ${isDeleteMode ? "确认删除所选文件" : "确认清空所选历史"}`
                        }
                    </button>
                </div>
            </div>
        </div>
    `;
}

function renderStatus() {
    if (appState.loading) {
        return '<div class="status">加载中...</div>';
    }
    if (appState.error) {
        return `<div class="status error">${escapeHtml(appState.error)}</div>`;
    }
    if (appState.items.length === 0) {
        return '<div class="status">暂无数据，可尝试刷新索引或调整筛选条件</div>';
    }
    return "";
}

function renderHistoryLayout() {
    const state = currentTabState();
    return `
        <div class="panel list-panel history-list-panel collapsed-fill" style="width:100%">
            <div class="list" id="list">${renderListRows()}${renderStatus()}</div>
            <div class="pagination">
                <button class="btn" id="page-prev" title="上一页" aria-label="上一页" ${state.page <= 1 ? "disabled" : ""}>${iconSvg("arrow-left", "上一页", "xdatahub-icon btn-icon")} 上一页</button>
                <span>${state.page} / ${appState.totalPages}</span>
                <button class="btn" id="page-next" title="下一页" aria-label="下一页" ${state.page >= appState.totalPages ? "disabled" : ""}>${iconSvg("arrow-right", "下一页", "xdatahub-icon btn-icon")} 下一页</button>
                <span>跳页</span>
                <input id="page-jump" type="number" min="1" max="${appState.totalPages}" value="${state.page}" style="width:88px;">
            </div>
        </div>
    `;
}

function render() {
    if (!root) {
        return;
    }
    syncListScroll();
    const focusState = captureFocusState();
    const tab = appState.activeTab;
    const state = currentTabState();
    const readonly = appState.lockState.readonly;
    const showLock = readonly ? "show" : "";
    const mediaView = isMediaTab(tab);
    const sidebarOpen = !!appState.filtersSidebarOpen;
    const mediaCardSizePreset = normalizeMediaCardSizePreset(
        appState.settings.mediaCardSizePreset
    );
    root.innerHTML = `
        <div class="lock-banner ${showLock}">
            执行中，仅可只读浏览（状态: ${escapeHtml(appState.lockState.state)}）
        </div>
        <div class="workspace ${sidebarOpen ? "filters-expanded" : "filters-collapsed"}">
            ${renderTopActionBar()}
            ${renderFilters()}
            <div class="workspace-main">
                <div class="body ${mediaView ? "media-body" : ""}">
                ${
                    mediaView
                        ? `
                <div class="panel media-grid-panel media-card-size-${mediaCardSizePreset}">
                    ${renderMediaExplorerBar()}
                    <div class="media-grid" id="list">${renderMediaGrid()}</div>
                    <div class="pagination">
                        <button class="btn" id="page-prev" title="上一页" aria-label="上一页" ${state.page <= 1 ? "disabled" : ""}>${iconSvg("arrow-left", "上一页", "xdatahub-icon btn-icon")} 上一页</button>
                        <span>${state.page} / ${appState.totalPages}</span>
                        <button class="btn" id="page-next" title="下一页" aria-label="下一页" ${state.page >= appState.totalPages ? "disabled" : ""}>${iconSvg("arrow-right", "下一页", "xdatahub-icon btn-icon")} 下一页</button>
                        <span>跳页</span>
                        <input id="page-jump" type="number" min="1" max="${appState.totalPages}" value="${state.page}" style="width:88px;">
                    </div>
                </div>
                `
                        : `
                ${renderHistoryLayout()}
                `
                }
            </div>
                </div>
            </div>
        </div>
        ${renderImagePreview()}
        ${renderDangerDialog()}
        ${renderDbDeleteDialog()}
        ${renderSettingsDialog()}
    `;

    bindEvents();
    updateTopActionBarCompactMode();
    scheduleTopActionBarCompactUpdate();
    restoreListScroll();
    restoreFocusState(focusState);
    scheduleHistoryRowExtraHeaderLayout();
}

function updateTopActionBarCompactMode() {
    const bar = document.querySelector(".top-action-bar");
    if (!(bar instanceof HTMLElement)) {
        return;
    }
    bar.classList.remove("compact-icons");
    const needsCompact = bar.scrollWidth > bar.clientWidth;
    bar.classList.toggle("compact-icons", needsCompact);
}

function scheduleTopActionBarCompactUpdate() {
    if (topActionCompactRaf) {
        return;
    }
    topActionCompactRaf = window.requestAnimationFrame(() => {
        topActionCompactRaf = 0;
        updateTopActionBarCompactMode();
    });
}

function bindEvents() {
    if (appState.activeTab !== "video") {
        stopVideoScheduler(false);
    }
    const list = document.getElementById("list");
    if (list) {
        list.addEventListener("scroll", () => {
            syncListScroll();
            if (appState.activeTab === "video") {
                scheduleMediaQueueRebuild();
            }
        });
    }

    if (!isMediaTab(appState.activeTab)) {
        root.querySelectorAll("[data-item-id]").forEach((row) => {
            row.addEventListener("click", () => {
                const itemId = row.dataset.itemId || "";
                currentTabState().selectedId = itemId;
                saveTabState(appState.activeTab);
                const item = appState.items.find((entry) => entry.id === itemId);
                if (item) {
                    appState.selectedItemCache.set(appState.activeTab, item);
                }
                clearDetailResources();
                render();
            });
        });
        root.querySelectorAll(".row-copy-btn").forEach((button) => {
            button.addEventListener("click", async (event) => {
                event.preventDefault();
                event.stopPropagation();
                const text = String(
                    button.getAttribute("data-copy-preview") || ""
                ).trim();
                if (!text) {
                    return;
                }
                try {
                    await navigator.clipboard.writeText(text);
                } catch {
                    try {
                        const temp = document.createElement("textarea");
                        temp.value = text;
                        temp.style.position = "fixed";
                        temp.style.opacity = "0";
                        document.body.appendChild(temp);
                        temp.select();
                        document.execCommand("copy");
                        temp.remove();
                    } catch {}
                }
                flashButton(button);
                setRowCopyFeedback(button);
            });
        });
    }
    if (isMediaTab(appState.activeTab)) {
        root.querySelectorAll(".media-folder-card[data-folder-path]").forEach((card) => {
            card.addEventListener("click", () => {
                const folderPath = card.getAttribute("data-folder-path") || "";
                if (!folderPath) {
                    return;
                }
                setMediaDirectoryFromPath(folderPath);
                loadList();
            });
        });
        root.querySelectorAll(".media-card[data-preview-url]").forEach((card) => {
            card.addEventListener("click", () => {
                const mediaItemId = String(
                    card.getAttribute("data-media-item-id") || ""
                ).trim();
                if (mediaItemId) {
                    const state = currentTabState();
                    state.lastOpenedMediaId = mediaItemId;
                    state.lastOpenedMediaUrl = String(
                        card.getAttribute("data-preview-url") || ""
                    );
                    saveTabState(appState.activeTab);
                    render();
                }
                const kind = card.getAttribute("data-preview-kind") || "image";
                const url = card.getAttribute("data-preview-url") || "";
                const title = card.getAttribute("data-preview-title") || "";
                requestAnimationFrame(() => {
                    openImagePreview(kind, url, title);
                });
            });
        });
        root.querySelectorAll(".media-card[data-drag-media='1']").forEach((card) => {
            card.addEventListener("dragstart", (event) => {
                const dataTransfer = event.dataTransfer;
                if (!dataTransfer) {
                    event.preventDefault();
                    return;
                }
                const rawPreferredUrl = String(
                    card.getAttribute("data-drag-url-preferred") || ""
                );
                const rawFallbackUrl = String(
                    card.getAttribute("data-drag-url-fallback") || ""
                );
                const mediaType = String(
                    card.getAttribute("data-drag-media-type") || ""
                ).toLowerCase();
                const preferredUrl = toAbsoluteUrl(rawPreferredUrl);
                const fallbackUrl = toAbsoluteUrl(rawFallbackUrl);
                const primaryUrl = preferredUrl || fallbackUrl;
                if (!primaryUrl) {
                    event.preventDefault();
                    return;
                }
                const title = String(
                    card.getAttribute("data-drag-title")
                    || (mediaType === "audio" ? "audio" : "video")
                );
                const uriValues = [primaryUrl];
                if (fallbackUrl && fallbackUrl !== primaryUrl) {
                    uriValues.push(fallbackUrl);
                }
                const mime = mediaType === "audio"
                    ? "audio/*"
                    : mediaType === "video"
                        ? "video/*"
                        : "application/octet-stream";
                dataTransfer.effectAllowed = "copy";
                try {
                    dataTransfer.setData("text/uri-list", uriValues.join("\r\n"));
                } catch {}
                try {
                    dataTransfer.setData("text/plain", primaryUrl);
                } catch {}
                try {
                    dataTransfer.setData("text/x-moz-url", `${primaryUrl}\n${title}`);
                } catch {}
                try {
                    dataTransfer.setData(
                        "DownloadURL",
                        `${mime}:${title}:${primaryUrl}`
                    );
                } catch {}
            });
        });
        setupMediaResolutionObservers();
        if (appState.activeTab === "video") {
            setupVideoCardScheduler();
        } else {
            stopVideoScheduler(false);
        }

        document.getElementById("btn-media-root-output")?.addEventListener("click", () => {
            const state = currentTabState();
            if (normalizeMediaRoot(state.mediaRoot) === "output") {
                return;
            }
            setMediaDirectoryFromPath("output");
            loadList();
        });
        document.getElementById("btn-media-root-input")?.addEventListener("click", () => {
            const state = currentTabState();
            if (normalizeMediaRoot(state.mediaRoot) === "input") {
                return;
            }
            setMediaDirectoryFromPath("input");
            loadList();
        });
        document.getElementById("btn-media-up")?.addEventListener("click", () => {
            const state = currentTabState();
            ensureMediaNavState(state);
            const target = state.mediaBackStack.pop();
            if (!target) {
                return;
            }
            pushMediaNavEntry(state.mediaForwardStack, mediaDirectoryFromState(state));
            setMediaDirectoryFromPath(target, {
                recordHistory: false,
                clearForward: false,
            });
            saveTabState(appState.activeTab);
            loadList();
        });
        document.getElementById("btn-media-forward")?.addEventListener("click", () => {
            const state = currentTabState();
            ensureMediaNavState(state);
            const target = state.mediaForwardStack.pop();
            if (!target) {
                return;
            }
            pushMediaNavEntry(state.mediaBackStack, mediaDirectoryFromState(state));
            setMediaDirectoryFromPath(target, {
                recordHistory: false,
                clearForward: false,
            });
            saveTabState(appState.activeTab);
            loadList();
        });
    }

    const prev = document.getElementById("page-prev");
    const next = document.getElementById("page-next");
    prev?.addEventListener("click", () => changePage(currentTabState().page - 1));
    next?.addEventListener("click", () => changePage(currentTabState().page + 1));

    const jump = document.getElementById("page-jump");
    jump?.addEventListener("input", () => debouncedJumpPage(jump.value));
    jump?.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
            debouncedJumpPage(jump.value);
        }
    });

    bindActionButtons();
    document.getElementById("btn-toggle-filters-sidebar")?.addEventListener("click", () => {
        appState.filtersSidebarOpen = !appState.filtersSidebarOpen;
        saveGlobalFiltersSidebarState();
        render();
    });

    const keyword = document.getElementById("filter-keyword");
    keyword?.addEventListener("input", () => {
        currentTabState().filters.keyword = keyword.value;
        saveTabState(appState.activeTab);
    });

    const dtype = document.getElementById("filter-data-type");
    dtype?.addEventListener("input", () => {
        currentTabState().filters.dataType = dtype.value;
        saveTabState(appState.activeTab);
        refreshDependentWarnings();
    });
    const source = document.getElementById("filter-source");
    source?.addEventListener("input", () => {
        currentTabState().filters.source = source.value;
        saveTabState(appState.activeTab);
        refreshDependentWarnings();
    });
    const dbName = document.getElementById("filter-db-name");
    dbName?.addEventListener("input", () => {
        currentTabState().filters.dbName = dbName.value;
        saveTabState(appState.activeTab);
        debouncedScopedFacetReload(dbName.value);
        refreshDependentWarnings();
    });
    [dtype, source, dbName].forEach((inputEl) => {
        inputEl?.addEventListener("focus", () => {
            openFacetDropdown(inputEl.id);
            render();
        });
    });

    const start = document.getElementById("filter-start");
    const end = document.getElementById("filter-end");
    start?.addEventListener("input", () => {
        currentTabState().filters.start = start.value;
        saveTabState(appState.activeTab);
        updateDateRangeToggleVisual();
    });
    end?.addEventListener("input", () => {
        currentTabState().filters.end = end.value;
        saveTabState(appState.activeTab);
        updateDateRangeToggleVisual();
    });

    const applyFilters = () => {
        if (isSearchLocked()) {
            return;
        }
        scheduleSearchReload();
    };
    document.getElementById("btn-apply-filters")?.addEventListener("click", () => {
        flashButton(document.getElementById("btn-apply-filters"));
        applyFilters();
    });

    [keyword, dtype, source, dbName, start, end].forEach((inputEl) => {
        inputEl?.addEventListener("keydown", (event) => {
            if (event.key === "Enter") {
                event.preventDefault();
                applyFilters();
            }
        });
    });
    root.querySelectorAll("[data-facet-toggle]").forEach((button) => {
        button.addEventListener("click", () => {
            const fieldId = button.getAttribute("data-facet-toggle") || "";
            if (!fieldId) {
                return;
            }
            const isOpen = appState.facetDropdown.open
                && appState.facetDropdown.fieldId === fieldId;
            if (isOpen) {
                closeFacetDropdown(true);
                return;
            }
            openFacetDropdown(fieldId);
            render();
        });
    });
    root.querySelectorAll("[data-facet-option]").forEach((button) => {
        button.addEventListener("click", () => {
            const fieldId = button.getAttribute("data-facet-option") || "";
            const value = button.getAttribute("data-facet-value") || "";
            const input = document.getElementById(fieldId);
            if (!(input instanceof HTMLInputElement)) {
                return;
            }
            input.value = value;
            if (fieldId === "filter-data-type") {
                currentTabState().filters.dataType = value;
            } else if (fieldId === "filter-source") {
                currentTabState().filters.source = value;
            } else if (fieldId === "filter-db-name") {
                currentTabState().filters.dbName = value;
                debouncedScopedFacetReload(value);
            }
            saveTabState(appState.activeTab);
            closeFacetDropdown(true);
            refreshDependentWarnings();
        });
    });
    document.getElementById("facet-backdrop")?.addEventListener("click", () => {
        closeFacetDropdown(true);
    });

    const openDatePickerInput = (input) => {
        if (!(input instanceof HTMLInputElement)) {
            return;
        }
        if (typeof input.showPicker === "function") {
            try {
                input.showPicker();
                return;
            } catch {
                // 回退到 focus
            }
        }
        input.focus();
    };

    root.querySelectorAll(".date-picker-btn").forEach((button) => {
        button.addEventListener("click", () => {
            const targetId = button.getAttribute("data-picker-target");
            if (!targetId) {
                return;
            }
            openDatePickerInput(document.getElementById(targetId));
        });
    });

    ["filter-start", "filter-end"].forEach((inputId) => {
        const input = document.getElementById(inputId);
        if (!(input instanceof HTMLInputElement)) {
            return;
        }
        input.addEventListener("click", () => {
            openDatePickerInput(input);
        });
        input.addEventListener("keydown", (event) => {
            if (event.key !== "Enter" && event.key !== " ") {
                return;
            }
            event.preventDefault();
            openDatePickerInput(input);
        });
    });

    document.getElementById("image-lightbox-close")?.addEventListener("click", () => {
        closeImagePreview();
    });
    document.getElementById("image-lightbox-close-btn")?.addEventListener("click", () => {
        closeImagePreview();
    });

    const copyPayloadBtn = document.getElementById("btn-copy-payload");
    copyPayloadBtn?.addEventListener("click", async () => {
        await handleCopyButton(copyPayloadBtn);
    });
    const copyRecordBtn = document.getElementById("btn-copy-record");
    copyRecordBtn?.addEventListener("click", async () => {
        await handleCopyButton(copyRecordBtn);
    });
    document.getElementById("btn-toggle-raw")?.addEventListener("click", () => {
        flashButton(document.getElementById("btn-toggle-raw"));
        appState.historyDetailRaw = !appState.historyDetailRaw;
        render();
    });
    document.getElementById("settings-dialog-overlay")?.addEventListener("click", (event) => {
        if (event.target?.id !== "settings-dialog-overlay") {
            return;
        }
        appState.settingsDialogOpen = false;
        appState.settingsDraft = null;
        const overlay = document.getElementById("settings-dialog-overlay");
        overlay?.classList.add("is-hidden");
    });
    document.getElementById("settings-dialog-cancel")?.addEventListener("click", () => {
        appState.settingsDialogOpen = false;
        appState.settingsDraft = null;
        const overlay = document.getElementById("settings-dialog-overlay");
        overlay?.classList.add("is-hidden");
    });
    document.getElementById("setting-show-media-chip-type")?.addEventListener("change", (event) => {
        if (!appState.settingsDraft) {
            appState.settingsDraft = cloneSettings(appState.settings);
        }
        const checked = !!event.target?.checked;
        appState.settingsDraft.showMediaChipType = checked;
    });
    document.getElementById("setting-show-media-chip-resolution")?.addEventListener("change", (event) => {
        if (!appState.settingsDraft) {
            appState.settingsDraft = cloneSettings(appState.settings);
        }
        const checked = !!event.target?.checked;
        appState.settingsDraft.showMediaChipResolution = checked;
    });
    document.getElementById("setting-show-media-chip-datetime")?.addEventListener("change", (event) => {
        if (!appState.settingsDraft) {
            appState.settingsDraft = cloneSettings(appState.settings);
        }
        const checked = !!event.target?.checked;
        appState.settingsDraft.showMediaChipDatetime = checked;
    });
    document.getElementById("setting-show-media-chip-size")?.addEventListener("change", (event) => {
        if (!appState.settingsDraft) {
            appState.settingsDraft = cloneSettings(appState.settings);
        }
        const checked = !!event.target?.checked;
        appState.settingsDraft.showMediaChipSize = checked;
    });
    document.getElementById("setting-video-preview-autoplay")?.addEventListener("change", (event) => {
        if (!appState.settingsDraft) {
            appState.settingsDraft = cloneSettings(appState.settings);
        }
        const checked = !!event.target?.checked;
        appState.settingsDraft.videoPreviewAutoplay = checked;
    });
    document.getElementById("setting-video-preview-muted")?.addEventListener("change", (event) => {
        if (!appState.settingsDraft) {
            appState.settingsDraft = cloneSettings(appState.settings);
        }
        const checked = !!event.target?.checked;
        appState.settingsDraft.videoPreviewMuted = checked;
    });
    document.getElementById("setting-audio-preview-autoplay")?.addEventListener("change", (event) => {
        if (!appState.settingsDraft) {
            appState.settingsDraft = cloneSettings(appState.settings);
        }
        const checked = !!event.target?.checked;
        appState.settingsDraft.audioPreviewAutoplay = checked;
    });
    document.getElementById("setting-audio-preview-muted")?.addEventListener("change", (event) => {
        if (!appState.settingsDraft) {
            appState.settingsDraft = cloneSettings(appState.settings);
        }
        const checked = !!event.target?.checked;
        appState.settingsDraft.audioPreviewMuted = checked;
    });
    document.getElementById("btn-media-sort-cycle")?.addEventListener("click", async () => {
        const currentBy = normalizeMediaSortBy(appState.settings.mediaSortBy);
        const currentOrder = normalizeMediaSortOrder(
            appState.settings.mediaSortOrder
        );
        const next = nextMediaSortCombo(currentBy, currentOrder);
        await applyMediaSortSettings(next.by, next.order);
    });
    document.getElementById("btn-history-sort-cycle")?.addEventListener("click", async () => {
        if (appState.activeTab !== "history") {
            return;
        }
        const state = currentTabState();
        const current = normalizeHistorySortOrder(state.historySortOrder);
        state.historySortOrder = current === "desc" ? "asc" : "desc";
        state.page = 1;
        saveTabState("history");
        await loadList();
    });
    document.getElementById("setting-media-card-size-preset")?.addEventListener("change", (event) => {
        if (!appState.settingsDraft) {
            appState.settingsDraft = cloneSettings(appState.settings);
        }
        const target = event.target;
        if (!(target instanceof HTMLSelectElement)) {
            return;
        }
        appState.settingsDraft.mediaCardSizePreset =
            normalizeMediaCardSizePreset(target.value);
    });
    document.getElementById("settings-dialog-save")?.addEventListener("click", async () => {
        const draft = cloneSettings(appState.settingsDraft || appState.settings);
        await updateSettings(draft);
        if (!appState.settingsError) {
            appState.settingsDraft = null;
            appState.settingsDialogOpen = false;
            if (isMediaTab(appState.activeTab)) {
                const state = currentTabState();
                state.page = 1;
                saveTabState(appState.activeTab);
                await loadList();
            } else {
                render();
            }
        }
    });
    document.getElementById("danger-dialog-overlay")?.addEventListener("click", (event) => {
        if (event.target?.id === "danger-dialog-overlay") {
            closeDangerConfirm(false);
        }
    });
    document.getElementById("danger-dialog-cancel")?.addEventListener("click", () => {
        closeDangerConfirm(false);
    });
    document.getElementById("danger-dialog-confirm")?.addEventListener("click", () => {
        if (!isDangerDialogConfirmed()) {
            return;
        }
        closeDangerConfirm(true);
    });
    const dangerInput = document.getElementById("danger-dialog-input");
    dangerInput?.addEventListener("input", () => {
        appState.dangerDialog.input = dangerInput.value;
        const confirmBtn = document.getElementById("danger-dialog-confirm");
        if (confirmBtn instanceof HTMLButtonElement) {
            confirmBtn.disabled = !isDangerDialogConfirmed();
        }
    });
    dangerInput?.addEventListener("keydown", (event) => {
        if (event.key === "Enter" && isDangerDialogConfirmed()) {
            event.preventDefault();
            closeDangerConfirm(true);
        }
    });
    const dangerClearDb = document.getElementById("danger-clear-db-target");
    const dangerClearAll = document.getElementById("danger-clear-all");
    dangerClearDb?.addEventListener("change", () => {
        if (!(dangerClearDb instanceof HTMLSelectElement)) {
            return;
        }
        appState.dangerDialog.meta = {
            ...appState.dangerDialog.meta,
            dbName: dangerClearDb.value,
        };
        currentTabState().cleanupDbName = dangerClearDb.value;
        saveTabState(appState.activeTab);
        const confirmBtn = document.getElementById("danger-dialog-confirm");
        if (confirmBtn instanceof HTMLButtonElement) {
            confirmBtn.disabled = !isDangerDialogConfirmed();
        }
    });
    dangerClearAll?.addEventListener("change", () => {
        if (!(dangerClearAll instanceof HTMLInputElement)) {
            return;
        }
        appState.dangerDialog.meta = {
            ...appState.dangerDialog.meta,
            deleteAll: dangerClearAll.checked,
        };
        currentTabState().cleanupDeleteAll = dangerClearAll.checked;
        saveTabState(appState.activeTab);
        render();
    });
    document.getElementById("db-delete-overlay")?.addEventListener("click", (event) => {
        if (event.target?.id === "db-delete-overlay") {
            closeDbDeleteDialog();
        }
    });
    document.getElementById("db-delete-cancel")?.addEventListener("click", () => {
        closeDbDeleteDialog();
    });
    document.getElementById("db-delete-unlock-critical")?.addEventListener("change", (event) => {
        const target = event.target;
        if (!(target instanceof HTMLInputElement)) {
            return;
        }
        appState.unlockCritical = !target.checked;
        render();
    });
    document.getElementById("btn-clear-mode-records")?.addEventListener("click", () => {
        appState.clearDataMode = "records";
        appState.dbDeleteError = "";
        appState.dbDeleteResult = "";
        appState.confirmYes = "";
        appState.confirmYesCritical = "";
        render();
    });
    document.getElementById("btn-clear-mode-delete")?.addEventListener("click", () => {
        appState.clearDataMode = "delete";
        appState.dbDeleteError = "";
        appState.dbDeleteResult = "";
        appState.confirmYes = "";
        appState.confirmYesCritical = "";
        render();
    });
    document.getElementById("btn-db-select-all")?.addEventListener("click", () => {
        const selected = appState.dbFileList
            .filter((item) => {
                if (!isDbCriticalEffective(item)) {
                    return true;
                }
                return appState.unlockCritical;
            })
            .map((item) => item.name);
        appState.selectedDbFiles = selected;
        render();
    });
    document.getElementById("btn-db-clear-selection")?.addEventListener("click", () => {
        appState.selectedDbFiles = [];
        render();
    });
    document.getElementById("btn-db-refresh-list")?.addEventListener("click", async () => {
        if (isDbRefreshLocked()) {
            return;
        }
        scheduleDbListRefresh();
    });
    document.getElementById("db-delete-confirm-yes")?.addEventListener("input", (event) => {
        const target = event.target;
        if (!(target instanceof HTMLInputElement)) {
            return;
        }
        appState.confirmYes = target.value;
        const btn = document.getElementById("db-delete-submit");
        if (btn instanceof HTMLButtonElement) {
            btn.disabled = !canSubmitDbDelete() || appState.dbDeleteLoading;
        }
    });
    document.getElementById("db-delete-confirm-yes-critical")?.addEventListener("input", (event) => {
        const target = event.target;
        if (!(target instanceof HTMLInputElement)) {
            return;
        }
        appState.confirmYesCritical = target.value;
        const btn = document.getElementById("db-delete-submit");
        if (btn instanceof HTMLButtonElement) {
            btn.disabled = !canSubmitDbDelete() || appState.dbDeleteLoading;
        }
    });
    root.querySelectorAll("[data-db-file-check]").forEach((el) => {
        el.addEventListener("change", (event) => {
            const target = event.target;
            if (!(target instanceof HTMLInputElement)) {
                return;
            }
            const name = target.getAttribute("data-db-file-check") || "";
            toggleDbFileSelected(name);
            render();
        });
    });
    root.querySelectorAll("[data-db-critical-mark]").forEach((el) => {
        el.addEventListener("change", async (event) => {
            const target = event.target;
            if (!(target instanceof HTMLInputElement)) {
                return;
            }
            const name = target.getAttribute("data-db-critical-mark") || "";
            await toggleCriticalOverride(name, target.checked);
            await fetchDbFileList();
            reconcileSelectedDbFiles();
            render();
        });
    });
    document.getElementById("db-delete-submit")?.addEventListener("click", async () => {
        if (appState.clearDataMode === "delete") {
            await submitDbDelete();
        } else {
            await submitRecordsCleanup();
        }
    });

    setupImagePreviewEvents();
    if (appState.imagePreview.kind === "image") {
        syncImagePreviewTransform();
    }

}

function escapeHtml(value) {
    return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll("\"", "&quot;")
        .replaceAll("'", "&#39;");
}

function escapeAttr(value) {
    return escapeHtml(value).replaceAll("`", "&#96;");
}

function formatDateTime(value) {
    if (!value) {
        return "";
    }
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
        return String(value);
    }
    try {
        return new Intl.DateTimeFormat("zh-CN", {
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hour12: false,
        }).format(parsed);
    } catch {
        return parsed.toLocaleString();
    }
}

function formatFileSize(bytes) {
    const value = Number(bytes || 0);
    if (!Number.isFinite(value) || value <= 0) {
        return "";
    }
    const units = ["B", "KB", "MB", "GB", "TB"];
    let size = value;
    let unit = 0;
    while (size >= 1024 && unit < units.length - 1) {
        size /= 1024;
        unit += 1;
    }
    return `${size.toFixed(size >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function truncateText(value, maxLen = 120) {
    const text = String(value || "").replace(/\s+/g, " ").trim();
    if (!text) {
        return "";
    }
    if (text.length <= maxLen) {
        return text;
    }
    return `${text.slice(0, Math.max(1, maxLen - 1))}…`;
}

function normalizePayloadValue(payload) {
    if (payload === undefined) {
        return {
            kind: "null",
            value: null,
            parseError: false,
            original: "",
        };
    }
    if (typeof payload !== "string") {
        return {
            kind: payload === null ? "null" : typeof payload,
            value: payload,
            parseError: false,
            original: payload,
        };
    }
    const raw = payload.trim();
    if (!raw) {
        return {
            kind: "string",
            value: "",
            parseError: false,
            original: payload,
        };
    }
    try {
        const parsed = JSON.parse(raw);
        return {
            kind: parsed === null ? "null" : typeof parsed,
            value: parsed,
            parseError: false,
            original: payload,
        };
    } catch {
        return {
            kind: "string",
            value: payload,
            parseError: true,
            original: payload,
        };
    }
}

function payloadSummary(payload, depth = 0) {
    if (depth > 2) {
        return "…";
    }
    if (payload === null || payload === undefined) {
        return "null";
    }
    if (typeof payload === "string") {
        return truncateText(payload, 120);
    }
    if (
        typeof payload === "number"
        || typeof payload === "boolean"
        || typeof payload === "bigint"
    ) {
        return String(payload);
    }
    if (Array.isArray(payload)) {
        if (payload.length === 0) {
            return "[]";
        }
        const first = payloadSummary(payload[0], depth + 1);
        return `[${payload.length}] ${truncateText(first, 90)}`;
    }
    if (typeof payload === "object") {
        const entries = Object.entries(payload);
        if (entries.length === 0) {
            return "{}";
        }
        for (const [key, value] of entries) {
            if (value === null || value === undefined || value === "") {
                continue;
            }
            if (
                typeof value === "string"
                || typeof value === "number"
                || typeof value === "boolean"
                || typeof value === "bigint"
            ) {
                return truncateText(String(value), 120);
            }
            if (Array.isArray(value)) {
                return truncateText(`[${value.length}]`, 120);
            }
            if (typeof value === "object") {
                return truncateText(payloadSummary(value, depth + 1), 120);
            }
        }
        return truncateText(JSON.stringify(payload), 120);
    }
    return truncateText(String(payload), 120);
}

function payloadNodeType(value) {
    if (value === null || value === undefined) {
        return "null";
    }
    if (Array.isArray(value)) {
        return "array";
    }
    if (typeof value === "object") {
        return "object";
    }
    return typeof value;
}

function formatPayloadScalar(value) {
    if (value === null || value === undefined) {
        return "null";
    }
    if (typeof value === "string") {
        return value;
    }
    if (typeof value === "number" || typeof value === "boolean") {
        return String(value);
    }
    if (typeof value === "bigint") {
        return `${value.toString()}n`;
    }
    try {
        return JSON.stringify(value);
    } catch {
        return String(value);
    }
}

function renderPayloadNode(value, depth = 0) {
    if (depth > 6) {
        return '<div class="payload-row"><span class="payload-value">...</span></div>';
    }
    const type = payloadNodeType(value);
    if (type !== "object" && type !== "array") {
        return `<div class="payload-row"><span class="payload-value">${escapeHtml(formatPayloadScalar(value))}</span></div>`;
    }

    const rows = [];
    if (type === "array") {
        const items = value;
        if (items.length === 0) {
            return '<div class="payload-row"><span class="payload-empty">空数组 []</span></div>';
        }
        const limit = 50;
        items.slice(0, limit).forEach((entry, index) => {
            rows.push(`
                <div class="payload-row">
                    <span class="payload-key">[${index}]</span>
                    <div class="payload-content">${renderPayloadValue(entry, depth + 1)}</div>
                </div>
            `);
        });
        if (items.length > limit) {
            rows.push(`<div class="payload-row"><span class="payload-empty">还有 ${items.length - limit} 项未展开</span></div>`);
        }
        return rows.join("");
    }

    const entries = Object.entries(value);
    if (entries.length === 0) {
        return '<div class="payload-row"><span class="payload-empty">空对象 {}</span></div>';
    }
    const limit = 50;
    entries.slice(0, limit).forEach(([key, entry]) => {
        rows.push(`
            <div class="payload-row">
                <span class="payload-key">${escapeHtml(key)}</span>
                <div class="payload-content">${renderPayloadValue(entry, depth + 1)}</div>
            </div>
        `);
    });
    if (entries.length > limit) {
        rows.push(`<div class="payload-row"><span class="payload-empty">还有 ${entries.length - limit} 个字段未展开</span></div>`);
    }
    return rows.join("");
}

function renderPayloadValue(value, depth) {
    const type = payloadNodeType(value);
    if (type === "object" || type === "array") {
        return `<div class="payload-nested">${renderPayloadNode(value, depth)}</div>`;
    }
    return `<span class="payload-value">${escapeHtml(formatPayloadScalar(value))}</span>`;
}

function payloadToJson(value) {
    try {
        return JSON.stringify(value, null, 2);
    } catch {
        return String(value);
    }
}

function buildPayloadCopyText(payloadInfo) {
    if (payloadInfo.parseError && typeof payloadInfo.original === "string") {
        return payloadInfo.original;
    }
    const value = payloadInfo.value;
    const json = payloadToJson(value);
    const stripLineIndent = (text) => String(text || "").replace(/^\s+/gm, "");
    if (Array.isArray(value)) {
        if (json.startsWith("[") && json.endsWith("]")) {
            return stripLineIndent(json.slice(1, -1).trim());
        }
        return stripLineIndent(json);
    }
    if (value && typeof value === "object") {
        if (json.startsWith("{") && json.endsWith("}")) {
            return stripLineIndent(json.slice(1, -1).trim());
        }
        return stripLineIndent(json);
    }
    return stripLineIndent(json);
}

function buildRecordCopyText(item) {
    const payloadInfo = normalizePayloadValue(item?.extra?.payload);
    const record = {
        id: item?.extra?.record_id ?? "",
        data_type: item?.extra?.data_type ?? "",
        extra_header: item?.extra?.extra_header ?? "",
        source: item?.extra?.source ?? "",
        db_name: item?.extra?.db_name ?? "",
        saved_at: item?.saved_at ?? "",
        payload: payloadInfo.value,
    };
    return payloadToJson(record);
}

async function copyText(text) {
    const value = String(text || "");
    if (!value) {
        throw new Error("empty");
    }
    if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
        return;
    }
    const textarea = document.createElement("textarea");
    textarea.value = value;
    textarea.setAttribute("readonly", "readonly");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(textarea);
    if (!ok) {
        throw new Error("copy_failed");
    }
}

function setCopyNotice(text, isError = false) {
    if (appState.copyNotice.timer) {
        clearTimeout(appState.copyNotice.timer);
    }
    appState.copyNotice.text = text;
    appState.copyNotice.error = !!isError;
    render();
    appState.copyNotice.timer = setTimeout(() => {
        appState.copyNotice.text = "";
        appState.copyNotice.error = false;
        appState.copyNotice.timer = 0;
        render();
    }, 1800);
}

async function handleCopyButton(button) {
    flashButton(button);
    const target = button?.getAttribute("data-copy-target") || "payload";
    const item = selectedItem();
    if (!item) {
        setCopyNotice("无可复制内容", true);
        return;
    }
    const payloadInfo = normalizePayloadValue(item?.extra?.payload);
    const text = target === "record"
        ? buildRecordCopyText(item)
        : buildPayloadCopyText(payloadInfo);
    try {
        await copyText(text);
        setCopyNotice("已复制");
    } catch {
        setCopyNotice("复制失败", true);
    }
}

function flashButton(button) {
    if (!(button instanceof HTMLElement)) {
        return;
    }
    button.classList.add("clicked");
    setTimeout(() => {
        button.classList.remove("clicked");
    }, 180);
}

function setRowCopyFeedback(button) {
    if (!(button instanceof HTMLElement)) {
        return;
    }
    const prevTimer = Number(button.dataset.copyTimer || 0);
    if (prevTimer) {
        clearTimeout(prevTimer);
    }
    const textEl = button.querySelector(".row-copy-btn-text");
    if (textEl instanceof HTMLElement) {
        textEl.textContent = "已复制";
    } else {
        button.textContent = "已复制";
    }
    button.classList.add("copied");
    const timer = window.setTimeout(() => {
        const resetTextEl = button.querySelector(".row-copy-btn-text");
        if (resetTextEl instanceof HTMLElement) {
            resetTextEl.textContent = "复制";
        } else {
            button.textContent = "复制";
        }
        button.classList.remove("copied");
        delete button.dataset.copyTimer;
    }, 900);
    button.dataset.copyTimer = String(timer);
}

function beginHistorySplitDrag(event) {
    if (appState.activeTab !== "history" || isCompactHistoryLayout()) {
        return;
    }
    endHistorySplitDrag();
    const body = root?.querySelector(".body");
    if (!(body instanceof HTMLElement)) {
        return;
    }
    const listPanel = root?.querySelector(".history-list-panel");
    if (!(listPanel instanceof HTMLElement)) {
        return;
    }
    body.classList.add("split-dragging");
    appState.splitDrag.active = true;
    let lastRatio = historyLayoutState().splitRatio;
    const move = (moveEvent) => {
        const rect = body.getBoundingClientRect();
        const ratio = clampHistorySplitRatio(
            (moveEvent.clientX - rect.left) / Math.max(1, rect.width),
            rect.width
        );
        lastRatio = ratio;
        listPanel.style.width = `${Math.round(ratio * 10000) / 100}%`;
    };
    const up = () => {
        setHistoryLayoutState({ splitRatio: lastRatio });
        endHistorySplitDrag();
        render();
    };
    appState.splitDrag.move = move;
    appState.splitDrag.up = up;
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", up, { once: true });
}

function endHistorySplitDrag() {
    if (!appState.splitDrag.active) {
        return;
    }
    const body = root?.querySelector(".body");
    body?.classList.remove("split-dragging");
    if (appState.splitDrag.move) {
        document.removeEventListener("pointermove", appState.splitDrag.move);
    }
    if (appState.splitDrag.up) {
        document.removeEventListener("pointerup", appState.splitDrag.up);
    }
    appState.splitDrag.active = false;
    appState.splitDrag.move = null;
    appState.splitDrag.up = null;
}

function getRecordContentPreview(item) {
    const payloadInfo = normalizePayloadValue(item?.extra?.payload);
    const preview = payloadSummary(payloadInfo.value);
    if (preview) {
        return preview;
    }
    return truncateText(item?.title || "", 120);
}

function parseDimension(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        return 0;
    }
    return Math.floor(parsed);
}

function formatResolution(width, height) {
    const w = parseDimension(width);
    const h = parseDimension(height);
    if (!w || !h) {
        return "";
    }
    return `${w}x${h}`;
}

function buildResolutionKey(item) {
    const id = String(item?.id || "");
    const sig = String(item?.extra?.file_sig || item?.extra?.file_url || "");
    return `${id}|${sig}`;
}

function getCachedResolution(key) {
    const cache = appState.mediaResolutionCache;
    if (!cache.has(key)) {
        return "";
    }
    const value = String(cache.get(key) || "");
    if (!value) {
        cache.delete(key);
        return "";
    }
    // LRU: 读取即刷新最近使用顺序。
    cache.delete(key);
    cache.set(key, value);
    return value;
}

function setCachedResolution(key, value) {
    const cache = appState.mediaResolutionCache;
    const text = String(value || "");
    if (!key || !text) {
        return;
    }
    if (cache.has(key)) {
        cache.delete(key);
    }
    cache.set(key, text);
    while (cache.size > MAX_MEDIA_RESOLUTION_CACHE) {
        const oldestKey = cache.keys().next().value;
        if (!oldestKey) {
            break;
        }
        cache.delete(oldestKey);
    }
}

function getResolutionText(item, mediaType, resolutionKey) {
    if (mediaType !== "image" && mediaType !== "video") {
        return "";
    }
    const cached = getCachedResolution(resolutionKey);
    if (cached) {
        return cached;
    }
    const extra = item?.extra || {};
    const fromShape = formatResolution(extra.width, extra.height);
    if (fromShape) {
        setCachedResolution(resolutionKey, fromShape);
        return fromShape;
    }
    return "";
}

function applyResolutionText(resolutionKey, text) {
    const value = String(text || "");
    if (!value) {
        return;
    }
    setCachedResolution(resolutionKey, value);
    root?.querySelectorAll("[data-resolution-chip]")
        .forEach((chip) => {
            if (chip.getAttribute("data-resolution-chip") !== resolutionKey) {
                return;
            }
            chip.textContent = value;
            chip.classList.remove("pending");
        });
}

function setupMediaResolutionObservers() {
    if (appState.settings.showMediaChipResolution === false) {
        return;
    }
    root?.querySelectorAll(".media-card[data-resolution-key]").forEach((card) => {
        const mediaType = card.getAttribute("data-media-type") || "";
        if (mediaType !== "image" && mediaType !== "video") {
            return;
        }
        const resolutionKey = card.getAttribute("data-resolution-key") || "";
        if (!resolutionKey) {
            return;
        }
        const cached = getCachedResolution(resolutionKey);
        if (cached) {
            applyResolutionText(resolutionKey, cached);
            return;
        }
        if (mediaType === "image") {
            const image = card.querySelector("img");
            if (!(image instanceof HTMLImageElement)) {
                return;
            }
            const applyImage = () => {
                const text = formatResolution(image.naturalWidth, image.naturalHeight);
                if (text) {
                    applyResolutionText(resolutionKey, text);
                }
            };
            if (image.complete && image.naturalWidth > 0) {
                applyImage();
            } else {
                image.addEventListener("load", applyImage, { once: true });
            }
            return;
        }
        const video = card.querySelector("video");
        if (!(video instanceof HTMLVideoElement)) {
            return;
        }
        const applyVideo = () => {
            const text = formatResolution(video.videoWidth, video.videoHeight);
            if (text) {
                applyResolutionText(resolutionKey, text);
            }
        };
        if (video.videoWidth > 0 && video.videoHeight > 0) {
            applyVideo();
        } else {
            video.addEventListener("loadedmetadata", applyVideo, { once: true });
        }
    });
}

async function pollLockStatus() {
    try {
        const lock = await apiGet("/xz3r0/xdatahub/lock/status", {}, "lock-status");
        if (applyLockState(lock)) {
            render();
        }
    } catch {
        // 忽略锁状态拉取失败，避免影响主流程。
    }
}

window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && appState.dbDeleteDialogOpen) {
        event.preventDefault();
        closeDbDeleteDialog();
        return;
    }
    if (event.key === "Escape" && appState.dangerDialog.open) {
        event.preventDefault();
        closeDangerConfirm(false);
        return;
    }
    if (event.key === "Escape" && appState.facetDropdown.open) {
        event.preventDefault();
        closeFacetDropdown(true);
        return;
    }
    if (event.key === "Escape" && appState.dateRangePanelOpen) {
        event.preventDefault();
        closeDateRangePanel(false);
        return;
    }
    if (event.key === "Escape" && appState.compactActionsMenuOpen) {
        event.preventDefault();
        closeCompactActionsMenu(true);
        return;
    }
    if (event.key === "Escape" && appState.imagePreview.open) {
        event.preventDefault();
        closeImagePreview();
        return;
    }
    if (event.key === "Escape" && appState.settingsDialogOpen) {
        event.preventDefault();
        appState.settingsDialogOpen = false;
        appState.settingsDraft = null;
        const overlay = document.getElementById("settings-dialog-overlay");
        overlay?.classList.add("is-hidden");
        return;
    }
    if (!appState.imagePreview.open) {
        return;
    }
    if (event.key === "+" || event.key === "=") {
        event.preventDefault();
        setImagePreviewScale(appState.imagePreview.scale * 1.1, 0, 0);
    } else if (event.key === "-" || event.key === "_") {
        event.preventDefault();
        setImagePreviewScale(appState.imagePreview.scale * 0.9, 0, 0);
    }
});

function setupWsLockSync() {
    try {
        const protocol = location.protocol === "https:" ? "wss:" : "ws:";
        const ws = new WebSocket(`${protocol}//${location.host}/ws`);
        appState.lockWs = ws;
        let pending = false;
        const schedulePoll = () => {
            if (pending) {
                return;
            }
            pending = true;
            setTimeout(() => {
                pending = false;
                pollLockStatus();
            }, 120);
        };
        ws.addEventListener("message", () => {
            schedulePoll();
        });
        ws.addEventListener("close", () => {
            if (appState.lockWs === ws) {
                appState.lockWs = null;
            }
        });
    } catch {
        // 忽略 WS 异常，保留轮询兜底。
    }
}

function cleanupRuntimeResources() {
    if (appState.lockPollTimer) {
        clearInterval(appState.lockPollTimer);
        appState.lockPollTimer = 0;
    }
    if (appState.lockWs) {
        try {
            appState.lockWs.close();
        } catch {}
        appState.lockWs = null;
    }
    for (const key of Array.from(appState.requests.keys())) {
        abortRequest(key);
    }
    resetDbRefreshLock();
    resetDbRefreshDebounce();
    appState.dbRefreshInFlight = false;
    resetDataActionLock();
    appState.dataActionInFlight = false;
    resetSearchLock();
    resetSearchDebounce();
    appState.searchInFlight = false;
    stopVideoScheduler(true);
    clearMediaQueueRebuildTimer();
    endHistorySplitDrag();
    if (topActionCompactRaf) {
        window.cancelAnimationFrame(topActionCompactRaf);
        topActionCompactRaf = 0;
    }
}

window.addEventListener("message", (event) => {
    const payload = event.data;
    if (!payload || typeof payload !== "object") {
        return;
    }
    if (payload.type === "xdatahub:set-tab") {
        const tab = String(payload.tab || "");
        if (!TABS.some((item) => item.id === tab)) {
            return;
        }
        switchTab(tab);
    }
});

async function init() {
    if (!root) {
        return;
    }
    const queryTab = new URLSearchParams(window.location.search).get("tab");
    if (queryTab && TABS.some((item) => item.id === queryTab)) {
        appState.activeTab = queryTab;
    }
    window.addEventListener("resize", scheduleTopActionBarCompactUpdate);
    window.addEventListener("resize", debouncedLayoutRefresh);
    setupWsLockSync();
    appState.lockPollTimer = window.setInterval(pollLockStatus, 2000);
    try {
        await fetchSettings();
    } catch {
        appState.settings = normalizeSettings({});
        appState.settingsError = "";
    }
    await pollLockStatus();
    await loadList();
}

window.addEventListener("beforeunload", cleanupRuntimeResources);

init();
