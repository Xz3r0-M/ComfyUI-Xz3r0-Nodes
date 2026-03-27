/*
 * 颜色规范（强约束）:
 * 1) 本文件默认必须引用 ./xdatahub-color-tokens.css。
 * 2) 默认禁止在本文件直接硬编码颜色值；如需硬编码，必须由用户明确要求。
 */

const TABS = [
    { id: "history" },
    { id: "image" },
    { id: "video" },
    { id: "audio" },
];
const XDATAHUB_MEDIA_MIME = "application/x-xdatahub-media+json";
const DEFAULT_TOGGLE_HOTKEY_SPEC = "Alt + X";

function createDefaultImagePreviewState() {
    return {
        open: false,
        kind: "image",
        url: "",
        mediaRef: "",
        title: "",
        mediaItemId: "",
        permissionDenied: false,
        permissionDeniedMessage: "",
        missing: false,
        missingMessage: "",
        unsupported: false,
        unsupportedMessage: "",
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
}

const DEFAULT_STATE = {
    page: 1,
    pageSize: 50,
    selectedId: "",
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
    lockState: {
        state: "IDLE",
        readonly: false,
        cooldown_ms: 0,
        is_executing: false,
        queue_remaining: 0,
        queue_running: 0,
        queue_pending: 0,
        interrupt_requested: false,
        interrupt_request_at: null,
        last_event: "",
    },
    requests: new Map(),
    lockPollTimer: 0,
    lockWs: null,
    imagePreview: createDefaultImagePreviewState(),
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
        anchor: null,
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
    mediaNavBusy: false,
    nodeSendDialogOpen: false,
    nodeSendLoading: false,
    nodeSendNodesLoading: false,
    nodeSendValidateLoading: false,
    nodeSendNodes: [],
    nodeSendSelectedIds: [],
    nodeSendSending: false,
    nodeSendHostLockActive: false,
    nodeSendProgressCurrent: 0,
    nodeSendProgressTotal: 0,
    nodeSendSuccessCount: 0,
    nodeSendFailureCount: 0,
    nodeSendLastFailureMessage: "",
    nodeSendMediaRef: "",
    nodeSendTextValue: "",
    nodeSendTitle: "",
    nodeSendTargetClass: "XImageGet",
    nodeSendSortKey: "id",
    nodeSendSortDir: "asc",
    nodeSendRequestId: "",
    nodeSendRequestTimer: 0,
    nodeSendValidateId: "",
    nodeSendValidateTimer: 0,
    nodeSendError: "",
    nodeSendQuickSlide: null,
    localeSwitcherOpen: false,
    localeSelectionPending: false,
    localeSelectionOriginal: "",
    localePreviewLang: "en",
    settingsDraft: null,
    settings: {
        showMediaTitle: true,
        showMediaChipResolution: true,
        showMediaChipDatetime: true,
        showMediaChipSize: true,
        videoPreviewAutoplay: false,
        videoPreviewMuted: true,
        videoPreviewLoop: false,
        audioPreviewAutoplay: false,
        audioPreviewMuted: false,
        audioPreviewLoop: false,
        mediaSortBy: "mtime",
        mediaSortOrder: "desc",
        mediaCardSizePreset: "standard",
        nodeSendCloseAfterSend: true,
        themeMode: "dark",
        hotkeySpec: DEFAULT_TOGGLE_HOTKEY_SPEC,
        uiLocale: "",
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
let rootDelegatedHandlersInstalled = false;
let historyRowExtraLayoutRaf = 0;
let topActionCompactRaf = 0;
let renderCount = 0;
let uiLocaleZhDict = {};
let uiLocaleEnDict = {};
let mediaSendProximityRaf = 0;
let mediaSendProximityPayload = null;
let nodeSendAckSeq = 0;
const nodeSendAckResolvers = new Map();
let hostHotkeyRequestSeq = 0;
const hostHotkeyRequestResolvers = new Map();

const tabStates = {};
for (const tab of TABS) {
    tabStates[tab.id] = loadTabState(tab.id);
    // 不继承上次会话的选中项，避免出现“默认选中第一个文件”观感。
    tabStates[tab.id].selectedId = "";
    tabStates[tab.id].lastOpenedMediaId = "";
    tabStates[tab.id].lastOpenedMediaUrl = "";
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
const THEME_MODE_VALUES = new Set(["dark", "light"]);
const VIDEO_SCHEDULER_MAX_CONCURRENCY = 2;
const VIDEO_SCHEDULER_BATCH_SIZE = 4;
const VIDEO_SCHEDULER_BATCH_DELAY_MS = 120;
const VIDEO_SCHEDULER_TIME_BUDGET_MS = 8;
const VIDEO_LOAD_TIMEOUT_MS = 2200;
const MEDIA_NAV_STACK_LIMIT = 60;
const NODE_SEND_ACK_TIMEOUT_MS = 1200;
const ICON_BASE_PATH = "/extensions/ComfyUI-Xz3r0-Nodes/icons";
const ACTIVE_TAB_STORAGE_KEY = "xdatahub.activeTab";
let iframeHotkeySpec = DEFAULT_TOGGLE_HOTKEY_SPEC;
let iframeHotkeyCombo = null;
const DB_ACCENT_PALETTE = [
    "var(--db-palette-01)",
    "var(--db-palette-02)",
    "var(--db-palette-03)",
    "var(--db-palette-04)",
    "var(--db-palette-05)",
    "var(--db-palette-06)",
    "var(--db-palette-07)",
    "var(--db-palette-08)",
    "var(--db-palette-09)",
    "var(--db-palette-10)",
    "var(--db-palette-11)",
    "var(--db-palette-12)",
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

function normalizeUiLocale(value) {
    return String(value || "").trim().toLowerCase() === "en" ? "en" : "zh";
}

function currentUiDict() {
    return appState.localePreviewLang === "en" ? uiLocaleEnDict : uiLocaleZhDict;
}

function t(key, fallback = "", vars = null) {
    const dict = currentUiDict();
    const base = dict?.[key];
    let text = typeof base === "string" && base.length > 0
        ? base
        : (fallback || key);
    if (!vars || typeof vars !== "object") {
        return text;
    }
    for (const [name, value] of Object.entries(vars)) {
        text = text.replaceAll(`{${name}}`, String(value));
    }
    return text;
}

function syncDocumentLocaleMeta() {
    const isEn = appState.localePreviewLang === "en";
    document.documentElement.lang = isEn ? "en" : "zh-CN";
    document.title = t("xdatahub.ui.app_html.title", "XDataHub");
}

function readUiLocalePreference() {
    return normalizeUiLocale(appState.localePreviewLang || "en");
}

async function fetchUiLocaleDict(locale) {
    try {
        const response = await fetch(
            `/xz3r0/xdatahub/i18n/ui?locale=${encodeURIComponent(locale)}`,
            { cache: "no-cache" }
        );
        if (!response.ok) {
            return {};
        }
        const payload = await response.json();
        const dict = payload?.dict;
        return dict && typeof dict === "object" ? dict : {};
    } catch {
        return {};
    }
}

function loadTabState(tab) {
    try {
        const raw = sessionStorage.getItem(`xdatahub.tab.${tab}`);
        if (!raw) {
            return cloneDefaultState();
        }
        const parsed = {
            ...cloneDefaultState(),
            ...JSON.parse(raw),
        };
        parsed.page = 1;
        parsed.pageSize = cloneDefaultState().pageSize;
        parsed.selectedId = "";
        parsed.detailCollapsed = false;
        parsed.drawerOpen = false;
        parsed.compactFiltersExpanded = false;
        parsed.cleanupDbName = "";
        parsed.cleanupDeleteAll = false;
        parsed.lastOpenedMediaId = "";
        parsed.lastOpenedMediaUrl = "";
        parsed.mediaBackStack = [];
        parsed.mediaForwardStack = [];
        return parsed;
    } catch {
        return cloneDefaultState();
    }
}

function buildPersistedTabState(tab, state) {
    const next = {
        filters: {
            ...cloneDefaultState().filters,
            ...(state?.filters || {}),
        },
    };
    if (tab === "history") {
        next.historySortOrder = normalizeHistorySortOrder(
            state?.historySortOrder
        );
        return next;
    }
    if (isMediaTab(tab)) {
        next.mediaRoot = normalizeMediaRoot(state?.mediaRoot);
        next.mediaSubdir = normalizeMediaSubdir(state?.mediaSubdir);
    }
    return next;
}

function saveTabState(tab) {
    sessionStorage.setItem(
        `xdatahub.tab.${tab}`,
        JSON.stringify(buildPersistedTabState(tab, tabStates[tab]))
    );
}

function loadPersistedActiveTab() {
    try {
        const raw = String(
            sessionStorage.getItem(ACTIVE_TAB_STORAGE_KEY) || ""
        ).trim();
        if (TABS.some((item) => item.id === raw)) {
            return raw;
        }
    } catch {
        // ignore sessionStorage read errors
    }
    return "";
}

function savePersistedActiveTab(tab) {
    if (!TABS.some((item) => item.id === tab)) {
        return;
    }
    try {
        sessionStorage.setItem(ACTIVE_TAB_STORAGE_KEY, tab);
    } catch {
        // ignore sessionStorage write errors
    }
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
    return `<img class="${className}" src="${ICON_BASE_PATH}/${name}.svg" alt="${escapeAttr(label)}" aria-hidden="true" draggable="false">`;
}

function iconMask(name, label = "", className = "xdatahub-mask-icon") {
    return `<span class="${className}" style="--mask-icon:url('${ICON_BASE_PATH}/${name}.svg')" aria-hidden="true" title="${escapeAttr(label)}"></span>`;
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

const MEDIA_MISSING_STATUS = new Set([404, 410]);
const MEDIA_PERMISSION_STATUS = new Set([401, 403]);

async function probeMediaFailure(url) {
    const absolute = toAbsoluteUrl(url);
    if (!absolute) {
        return "";
    }
    try {
        let response = await fetch(absolute, {
            method: "HEAD",
            cache: "no-store",
        });
        if (response.status === 405 || response.status === 501) {
            response = await fetch(absolute, {
                method: "GET",
                cache: "no-store",
                headers: { Range: "bytes=0-0" },
            });
        }
        if (MEDIA_PERMISSION_STATUS.has(response.status)) {
            return "permission";
        }
        if (MEDIA_MISSING_STATUS.has(response.status)) {
            return "missing";
        }
        return "";
    } catch {
        return "";
    }
}

function normalizeDbColorKey(dbName) {
    return String(dbName || "").trim().toLowerCase();
}

function hashColorKeyU32(key) {
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

function hashDbNameU32(dbName) {
    const key = normalizeDbColorKey(dbName);
    return hashColorKeyU32(key);
}

function getDbAccentColor(dbName) {
    const key = normalizeDbColorKey(dbName);
    if (!key) {
        return "var(--db-palette-default)";
    }
    const index = hashDbNameU32(dbName) % DB_ACCENT_PALETTE.length;
    return DB_ACCENT_PALETTE[index];
}

function normalizeNodeColorKey(nodeKey) {
    return String(nodeKey || "").trim().toLowerCase();
}

function hashNodeKeyU32(nodeKey) {
    const key = normalizeNodeColorKey(nodeKey);
    return hashColorKeyU32(key);
}

function getNodeAccentColor(nodeKey) {
    const key = normalizeNodeColorKey(nodeKey);
    if (!key) {
        return "var(--db-palette-default)";
    }
    const index = hashNodeKeyU32(key) % DB_ACCENT_PALETTE.length;
    return DB_ACCENT_PALETTE[index];
}

function resolveNodeAccentColor(node) {
    const paletteSize = DB_ACCENT_PALETTE.length;
    const index = Number(node?.accent_index);
    if (Number.isFinite(index) && paletteSize > 0) {
        const safeIndex = ((index % paletteSize) + paletteSize) % paletteSize;
        return DB_ACCENT_PALETTE[safeIndex];
    }
    return getNodeAccentColor(node?.id);
}

function buildMediaFileUrl(mediaRef) {
    const normalized = String(mediaRef || "").trim();
    if (!normalized) {
        return "";
    }
    return `/xz3r0/xdatahub/media/file?ref=${encodeURIComponent(normalized)}`;
}

function resolveApiErrorMessage(data, fallbackKey, fallbackText) {
    const payload = data && typeof data === "object" ? data : {};
    const key = String(payload.message_key || "").trim();
    if (key) {
        return t(key, String(payload.message || fallbackText || fallbackKey || key));
    }
    if (payload.message) {
        return String(payload.message);
    }
    return t(fallbackKey, fallbackText || fallbackKey);
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
            throw new Error(resolveApiErrorMessage(
                data,
                "xdatahub.ui.app.error.request_failed",
                "Request Failed"
            ));
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
        throw new Error(resolveApiErrorMessage(
            data,
            "xdatahub.ui.app.error.request_failed",
            "Request Failed"
        ));
    }
    return data;
}

function normalizeSettings(value) {
    const raw = value && typeof value === "object" ? value : {};
    const uiLocaleRaw = String(raw.ui_locale || "").trim().toLowerCase();
    const uiLocale = uiLocaleRaw ? normalizeUiLocale(uiLocaleRaw) : "";
    const legacy = raw.show_media_card_info;
    const legacyDefault = legacy !== false;
    const sortByRaw = String(raw.media_sort_by || "").trim().toLowerCase();
    const sortOrderRaw = String(
        raw.media_sort_order || ""
    ).trim().toLowerCase();
    const cardSizePresetRaw = String(
        raw.media_card_size_preset || ""
    ).trim().toLowerCase();
    const themeModeRaw = String(raw.theme_mode || "").trim().toLowerCase();
    const hotkeySpecRaw = String(
        raw.hotkeySpec || raw.hotkey_spec || ""
    ).trim();
    return {
        showMediaTitle:
            raw.show_media_title !== undefined
                ? raw.show_media_title !== false
                : true,
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
        videoPreviewLoop:
            raw.video_preview_loop !== undefined
                ? raw.video_preview_loop === true
                : raw.media_preview_loop !== undefined
                    ? raw.media_preview_loop === true
                    : false,
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
        audioPreviewLoop:
            raw.audio_preview_loop !== undefined
                ? raw.audio_preview_loop === true
                : raw.media_preview_loop !== undefined
                    ? raw.media_preview_loop === true
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
        nodeSendCloseAfterSend:
            raw.node_send_close_after_send !== undefined
                ? raw.node_send_close_after_send !== false
                : raw.nodeSendCloseAfterSend !== false,
        themeMode: THEME_MODE_VALUES.has(themeModeRaw)
            ? themeModeRaw
            : "dark",
        hotkeySpec:
            parseHotkeySpec(hotkeySpecRaw)
            ? hotkeySpecRaw
            : DEFAULT_TOGGLE_HOTKEY_SPEC,
        uiLocale,
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
    const themeMode = String(raw.themeMode || "").trim().toLowerCase();
    const hotkeySpec = String(raw.hotkeySpec || "").trim();
    const uiLocale = String(raw.uiLocale || "").trim().toLowerCase();
    return {
        showMediaTitle: raw.showMediaTitle !== false,
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
        videoPreviewLoop:
            raw.videoPreviewLoop !== undefined
                ? raw.videoPreviewLoop === true
                : raw.mediaPreviewLoop === true,
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
        audioPreviewLoop:
            raw.audioPreviewLoop !== undefined
                ? raw.audioPreviewLoop === true
                : raw.mediaPreviewLoop === true,
        mediaSortBy: MEDIA_SORT_BY_VALUES.has(sortBy) ? sortBy : "mtime",
        mediaSortOrder: MEDIA_SORT_ORDER_VALUES.has(sortOrder)
            ? sortOrder
            : "desc",
        mediaCardSizePreset: MEDIA_CARD_SIZE_PRESET_VALUES.has(cardSizePreset)
            ? cardSizePreset
            : "standard",
        nodeSendCloseAfterSend:
            raw.nodeSendCloseAfterSend !== undefined
                ? raw.nodeSendCloseAfterSend !== false
                : raw.node_send_close_after_send !== false,
        themeMode: THEME_MODE_VALUES.has(themeMode) ? themeMode : "dark",
        hotkeySpec:
            parseHotkeySpec(hotkeySpec)
            ? hotkeySpec
            : DEFAULT_TOGGLE_HOTKEY_SPEC,
        uiLocale: uiLocale ? normalizeUiLocale(uiLocale) : "",
    };
}

function normalizeThemeMode(value) {
    const mode = String(value || "").trim().toLowerCase();
    if (THEME_MODE_VALUES.has(mode)) {
        return mode;
    }
    return "dark";
}

function parseHotkeySpec(spec) {
    const raw = String(spec || "").trim();
    if (!raw) {
        return null;
    }
    const tokens = raw
        .split("+")
        .map((part) => part.trim().toLowerCase())
        .filter(Boolean);
    if (!tokens.length) {
        return null;
    }
    const combo = {
        ctrl: false,
        alt: false,
        shift: false,
        meta: false,
        key: "",
    };
    const keyAlias = {
        esc: "escape",
        return: "enter",
        spacebar: "space",
        cmd: "meta",
        command: "meta",
        win: "meta",
        windows: "meta",
    };
    for (const tokenRaw of tokens) {
        const token = keyAlias[tokenRaw] || tokenRaw;
        if (token === "ctrl" || token === "control") {
            combo.ctrl = true;
            continue;
        }
        if (token === "alt" || token === "option") {
            combo.alt = true;
            continue;
        }
        if (token === "shift") {
            combo.shift = true;
            continue;
        }
        if (token === "meta") {
            combo.meta = true;
            continue;
        }
        combo.key = token;
    }
    if (!combo.key) {
        return null;
    }
    return combo;
}

function normalizeHotkeyKey(value) {
    const key = String(value || "").trim().toLowerCase();
    if (!key) {
        return "";
    }
    if (key === " ") {
        return "space";
    }
    if (key === "esc") {
        return "escape";
    }
    return key;
}

function updateIframeHotkeySpec(spec) {
    const normalized = String(spec || "").trim() || DEFAULT_TOGGLE_HOTKEY_SPEC;
    const parsed = parseHotkeySpec(normalized);
    iframeHotkeySpec = parsed ? normalized : DEFAULT_TOGGLE_HOTKEY_SPEC;
    iframeHotkeyCombo = parsed
        || parseHotkeySpec(DEFAULT_TOGGLE_HOTKEY_SPEC);
    appState.settings.hotkeySpec = iframeHotkeySpec;
    if (!appState.settingsDialogOpen) {
        appState.settingsDraft = null;
    }
}

function isToggleHotkeyEvent(event) {
    if (!iframeHotkeyCombo || !event) {
        return false;
    }
    const key = normalizeHotkeyKey(event.key);
    if (!key || key !== iframeHotkeyCombo.key) {
        return false;
    }
    return (
        event.ctrlKey === iframeHotkeyCombo.ctrl
        && event.altKey === iframeHotkeyCombo.alt
        && event.shiftKey === iframeHotkeyCombo.shift
        && event.metaKey === iframeHotkeyCombo.meta
    );
}

function handleIframeToggleHotkey(event) {
    if (!event || event.isComposing || event.repeat) {
        return;
    }
    if (!isToggleHotkeyEvent(event)) {
        return;
    }
    event.preventDefault();
    event.stopPropagation();
    try {
        window.parent?.postMessage(
            { type: "xdatahub:toggle-window-request" },
            "*"
        );
    } catch {
        // 忽略通知失败，不影响其他交互。
    }
}

function notifyParentThemeMode(mode) {
    try {
        window.parent?.postMessage(
            {
                type: "xdatahub:theme-mode",
                theme_mode: normalizeThemeMode(mode),
            },
            "*"
        );
    } catch {
        // 忽略跨窗口通知失败，避免影响主流程。
    }
}

function applyThemeMode(mode) {
    const target = document.body;
    if (!target) {
        return;
    }
    const normalized = normalizeThemeMode(mode);
    target.setAttribute("data-theme", normalized);
}

async function fetchSettings() {
    const data = await apiGet(
        "/xz3r0/xdatahub/settings",
        {},
        "xdatahub-settings"
    );
    appState.settings = normalizeSettings(data.settings || {});
    applyThemeMode(appState.settings.themeMode);
    notifyParentThemeMode(appState.settings.themeMode);
    appState.settingsError = "";
}

async function updateSettings(partial) {
    appState.settingsSaving = true;
    appState.settingsError = "";
    refreshSettingsDialogOverlay();
    try {
        const hasOwn = (key) => Object.prototype.hasOwnProperty.call(
            partial || {},
            key
        );
        const body = {
            show_media_title:
                partial?.showMediaTitle
                ?? appState.settings.showMediaTitle,
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
            video_preview_loop:
                partial?.videoPreviewLoop
                ?? appState.settings.videoPreviewLoop,
            audio_preview_autoplay:
                partial?.audioPreviewAutoplay
                ?? appState.settings.audioPreviewAutoplay,
            audio_preview_muted:
                partial?.audioPreviewMuted
                ?? appState.settings.audioPreviewMuted,
            audio_preview_loop:
                partial?.audioPreviewLoop
                ?? appState.settings.audioPreviewLoop,
            media_sort_by:
                partial?.mediaSortBy
                ?? appState.settings.mediaSortBy,
            media_sort_order:
                partial?.mediaSortOrder
                ?? appState.settings.mediaSortOrder,
            media_card_size_preset:
                partial?.mediaCardSizePreset
                ?? appState.settings.mediaCardSizePreset,
            node_send_close_after_send:
                hasOwn("nodeSendCloseAfterSend")
                    ? partial.nodeSendCloseAfterSend
                    : appState.settings.nodeSendCloseAfterSend,
            theme_mode:
                partial?.themeMode
                ?? appState.settings.themeMode,
        };
        if (partial?.uiLocale) {
            body.ui_locale = partial.uiLocale;
        } else if (appState.settings.uiLocale) {
            body.ui_locale = appState.settings.uiLocale;
        }
        const data = await apiPost("/xz3r0/xdatahub/settings", body);
        appState.settings = normalizeSettings({
            ...appState.settings,
            ...(data.settings || {}),
        });
        applyThemeMode(appState.settings.themeMode);
        notifyParentThemeMode(appState.settings.themeMode);
    } catch (error) {
        appState.settingsError = error.message || t(
            "xdatahub.ui.app.error.save_settings_failed",
            "Failed to save settings"
        );
    } finally {
        appState.settingsSaving = false;
        refreshSettingsDialogOverlay();
        refreshNodeSendDialogOverlay();
        syncTopActionBarUi();
    }
}

function nextHostHotkeyRequestId() {
    hostHotkeyRequestSeq += 1;
    return `host_hotkey_${Date.now()}_${hostHotkeyRequestSeq}`;
}

function requestParentHotkeyUpdate(spec) {
    const normalized = String(spec || "").trim();
    return new Promise((resolve) => {
        const requestId = nextHostHotkeyRequestId();
        const timeoutId = window.setTimeout(() => {
            if (!hostHotkeyRequestResolvers.has(requestId)) {
                return;
            }
            hostHotkeyRequestResolvers.delete(requestId);
            resolve({
                ok: false,
                error: t(
                    "xdatahub.ui.app.settings.hotkey.timeout",
                    "Hotkey update timed out"
                ),
            });
        }, 1500);
        hostHotkeyRequestResolvers.set(requestId, { resolve, timeoutId });
        try {
            window.parent?.postMessage(
                {
                    type: "xdatahub:update-hotkey-spec",
                    request_id: requestId,
                    hotkey_spec: normalized,
                },
                "*"
            );
        } catch {
            window.clearTimeout(timeoutId);
            hostHotkeyRequestResolvers.delete(requestId);
            resolve({
                ok: false,
                error: t(
                    "xdatahub.ui.app.settings.hotkey.update_failed",
                    "Failed to update hotkey"
                ),
            });
        }
    });
}

function applyHotkeySaveResponse(payload) {
    const requestId = String(payload?.request_id || "");
    if (!requestId || !hostHotkeyRequestResolvers.has(requestId)) {
        return;
    }
    const pending = hostHotkeyRequestResolvers.get(requestId);
    hostHotkeyRequestResolvers.delete(requestId);
    window.clearTimeout(pending.timeoutId);
    pending.resolve({
        ok: payload?.ok === true,
        error: String(payload?.error || ""),
        hotkeySpec: String(payload?.hotkey_spec || ""),
    });
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

function getListTabId(listElement) {
    if (!(listElement instanceof HTMLElement)) {
        return appState.activeTab;
    }
    const raw = String(listElement.dataset.listTab || "").trim();
    if (TABS.some((item) => item.id === raw)) {
        return raw;
    }
    return appState.activeTab;
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

function parentMediaDirectoryPath(state = currentTabState()) {
    const rootName = normalizeMediaRoot(state?.mediaRoot);
    const subdir = normalizeMediaSubdir(state?.mediaSubdir);
    if (!subdir) {
        return "";
    }
    const parts = subdir.split("/").filter(Boolean);
    parts.pop();
    const parentSubdir = normalizeMediaSubdir(parts.join("/"));
    return parentSubdir ? `${rootName}/${parentSubdir}` : rootName;
}

function setMediaDirectoryFromPath(pathValue, options = {}) {
    const targetPath = normalizeMediaPath(pathValue);
    if (!targetPath) {
        return false;
    }
    const { recordHistory = true, clearForward = true } = options;
    const parts = targetPath.split("/");
    const rootName = normalizeMediaRoot(parts[0]);
    const subdir = parts.slice(1).join("/");
    const state = currentTabState();
    ensureMediaNavState(state);
    const currentPath = mediaDirectoryFromState(state);
    if (currentPath === targetPath) {
        return false;
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
    return true;
}

function syncMediaNavigationUi() {
    if (!isMediaTab(appState.activeTab)) {
        return;
    }
    syncMediaExplorerBarUi();
    syncPaginationUi();
}

function navigateMediaDirectory(pathValue, options = {}) {
    if (appState.mediaNavBusy) {
        return false;
    }
    const {
        cause = "data-change",
        recordHistory = true,
        clearForward = true,
    } = options;
    const changed = setMediaDirectoryFromPath(pathValue, {
        recordHistory,
        clearForward,
    });
    syncMediaNavigationUi();
    if (!changed) {
        return false;
    }
    appState.mediaNavBusy = true;
    syncMediaNavigationUi();
    loadList({ cause });
    return true;
}

function takeNextMediaHistoryTarget(stack, currentPath) {
    while (stack.length > 0) {
        const candidate = normalizeMediaPath(stack.pop());
        if (candidate && candidate !== currentPath) {
            return candidate;
        }
    }
    return "";
}

function moveMediaHistory(direction) {
    if (!isMediaTab(appState.activeTab)) {
        return false;
    }
    if (appState.mediaNavBusy) {
        return false;
    }
    const state = currentTabState();
    ensureMediaNavState(state);
    const currentPath = mediaDirectoryFromState(state);
    const fromStack = direction < 0
        ? state.mediaBackStack
        : state.mediaForwardStack;
    const toStack = direction < 0
        ? state.mediaForwardStack
        : state.mediaBackStack;
    const target = takeNextMediaHistoryTarget(fromStack, currentPath);
    if (!target) {
        saveTabState(appState.activeTab);
        syncMediaNavigationUi();
        return false;
    }
    pushMediaNavEntry(toStack, currentPath);
    const changed = setMediaDirectoryFromPath(target, {
        recordHistory: false,
        clearForward: false,
    });
    saveTabState(appState.activeTab);
    syncMediaNavigationUi();
    if (!changed) {
        return false;
    }
    appState.mediaNavBusy = true;
    syncMediaNavigationUi();
    loadList({ cause: "data-change" });
    return true;
}

function switchMediaRootDirectory(rootName) {
    if (!isMediaTab(appState.activeTab)) {
        return false;
    }
    if (appState.mediaNavBusy) {
        return false;
    }
    const normalizedRoot = normalizeMediaRoot(rootName);
    const state = currentTabState();
    ensureMediaNavState(state);
    const changed = setMediaDirectoryFromPath(normalizedRoot, {
        recordHistory: false,
        clearForward: true,
    });
    state.mediaBackStack = [];
    state.mediaForwardStack = [];
    saveTabState(appState.activeTab);
    syncMediaNavigationUi();
    if (!changed) {
        return true;
    }
    appState.mediaNavBusy = true;
    syncMediaNavigationUi();
    loadList({ cause: "data-change" });
    return true;
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
    if (!appState.loading) {
        syncListStatusUi();
    }
}

function normalizeLockState(lock) {
    return {
        state: lock?.state || "IDLE",
        readonly: !!lock?.readonly,
        cooldown_ms: Number(lock?.cooldown_ms || 0),
        is_executing: !!lock?.is_executing,
        queue_remaining: Math.max(0, Number(lock?.queue_remaining || 0)),
        queue_running: Math.max(0, Number(lock?.queue_running || 0)),
        queue_pending: Math.max(0, Number(lock?.queue_pending || 0)),
        interrupt_requested: !!lock?.interrupt_requested,
        interrupt_request_at: Number.isFinite(
            Number(lock?.interrupt_request_at)
        )
            ? Number(lock?.interrupt_request_at)
            : null,
        last_event: String(lock?.last_event || ""),
    };
}

function applyLockState(lock) {
    const next = normalizeLockState(lock);
    const prev = appState.lockState || normalizeLockState({});
    const changed =
        prev.state !== next.state ||
        prev.readonly !== next.readonly ||
        prev.cooldown_ms !== next.cooldown_ms ||
        prev.is_executing !== next.is_executing ||
        prev.queue_remaining !== next.queue_remaining ||
        prev.queue_running !== next.queue_running ||
        prev.queue_pending !== next.queue_pending ||
        prev.interrupt_requested !== next.interrupt_requested ||
        prev.interrupt_request_at !== next.interrupt_request_at ||
        prev.last_event !== next.last_event;
    if (changed) {
        appState.lockState = next;
    }
    return changed;
}

function applyInterruptRequested(requestedAt = Date.now()) {
    return applyLockState({
        ...appState.lockState,
        interrupt_requested: true,
        interrupt_request_at: requestedAt,
        last_event: "interrupt_requested",
        state: appState.lockState.is_executing
            ? "STOPPING"
            : appState.lockState.state,
    });
}

function applyOfficialQueueRemaining(queueRemaining, eventType) {
    const remaining = Math.max(0, Number(queueRemaining || 0));
    const next = {
        ...appState.lockState,
        readonly: remaining > 0,
        is_executing: remaining > 0,
        queue_remaining: remaining,
        last_event: String(eventType || appState.lockState.last_event || ""),
    };
    if (remaining <= 0) {
        next.state = "IDLE";
        next.interrupt_requested = false;
        next.interrupt_request_at = null;
        next.queue_running = 0;
        next.queue_pending = 0;
    } else if (next.interrupt_requested) {
        next.state = "STOPPING";
    } else if (next.queue_running > 0) {
        next.state = "RUNNING";
    } else {
        next.state = "QUEUED";
    }
    return applyLockState(next);
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
    const cause = String(options.cause || "data-change").trim().toLowerCase();
    const isUiOnly = cause === "ui-only";
    const shouldReleaseMountedMedia = !isUiOnly;
    const tab = appState.activeTab;
    if (!isUiOnly) {
        stopVideoScheduler(shouldReleaseMountedMedia);
    }
    appState.loading = true;
    setError("");
    syncListLoadingUi();

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
                    validate_page: options.validatePage !== false ? 1 : 0,
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
            setError(error.message || t(
                "xdatahub.ui.app.error.load_failed",
                "Load Failed"
            ));
        }
    } finally {
        if (isMediaTab(tab)) {
            appState.mediaNavBusy = false;
        }
        appState.loading = false;
        syncListContentUi();
        restoreListScroll();
        refreshDependentWarnings();
    }
}

function syncListLoadingUi() {
    if (!root) {
        return;
    }
    const list = document.getElementById("list");
    if (!(list instanceof HTMLElement)) {
        return;
    }
    list.innerHTML = renderStatus();
}

function syncListStatusUi() {
    if (!root) {
        return;
    }
    const list = document.getElementById("list");
    if (!(list instanceof HTMLElement)) {
        return;
    }
    if (appState.loading || appState.error || appState.items.length === 0) {
        list.innerHTML = renderStatus();
    }
}

const PAGINATION_DISPLAY_MAX = 99999;

function getPaginationInputWidthCh(page, totalPages) {
    const visibleDigits = Math.min(
        5,
        String(Math.max(page, totalPages, 1)).length
    );
    return Math.max(5, visibleDigits * 1.35);
}

function formatDisplayedTotalPages(totalPages) {
    if (totalPages > PAGINATION_DISPLAY_MAX) {
        return `${PAGINATION_DISPLAY_MAX}\u2026`;
    }
    return String(totalPages);
}

function syncPaginationUi() {
    const prev = document.getElementById("page-prev");
    const next = document.getElementById("page-next");
    const jump = document.getElementById("page-jump");
    const pageTotal = document.getElementById("page-total");
    const state = currentTabState();
    if (prev instanceof HTMLButtonElement) {
        prev.disabled = state.page <= 1;
    }
    if (next instanceof HTMLButtonElement) {
        next.disabled = state.page >= appState.totalPages;
    }
    if (jump instanceof HTMLInputElement) {
        jump.style.width = `${getPaginationInputWidthCh(
            state.page,
            appState.totalPages
        )}ch`;
        jump.value = String(state.page);
        jump.max = String(appState.totalPages);
        jump.title = t("xdatahub.ui.app.pagination.jump", "Jump to page");
    }
    if (pageTotal instanceof HTMLElement) {
        pageTotal.textContent = formatDisplayedTotalPages(appState.totalPages);
        pageTotal.title = String(appState.totalPages);
    }
}

function syncMediaExplorerBarUi() {
    const bar = document.querySelector(".media-explorer-bar");
    if (!(bar instanceof HTMLElement)) {
        return;
    }
    bar.outerHTML = renderMediaExplorerBar();
}

function syncListContentUi() {
    if (!root) {
        return;
    }
    const list = document.getElementById("list");
    if (!(list instanceof HTMLElement)) {
        render();
        return;
    }
    const isMedia = isMediaTab(appState.activeTab);
    const inMediaShell = list.classList.contains("media-grid");
    const inHistoryShell = list.classList.contains("list");
    if ((isMedia && !inMediaShell) || (!isMedia && !inHistoryShell)) {
        render();
        return;
    }
    if (isMedia) {
        list.dataset.listTab = appState.activeTab;
        syncMediaExplorerBarUi();
        list.innerHTML = renderMediaGrid();
        setupMediaResolutionObservers();
        if (appState.activeTab === "video") {
            setupVideoCardScheduler();
        } else {
            stopVideoScheduler(false);
        }
    } else {
        list.dataset.listTab = "history";
        list.innerHTML = `${renderListRows()}${renderStatus()}`;
    }
    syncPaginationUi();
    syncTopActionBarUi();
    syncLockBannerUi();
    renderOverlays();
}

function syncHistorySelectionUi() {
    const list = document.getElementById("list");
    if (!(list instanceof HTMLElement)) {
        return false;
    }
    if (list.dataset.listTab !== "history" || !list.classList.contains("list")) {
        return false;
    }
    const selectedId = String(currentTabState().selectedId || "").trim();
    if (!selectedId) {
        return false;
    }
    const escapedId = (
        typeof CSS !== "undefined" && typeof CSS.escape === "function"
            ? CSS.escape(selectedId)
            : selectedId.replaceAll("\"", "\\\"")
    );
    const selector = `.row[data-item-id="${escapedId}"]`;
    const currentActive = list.querySelector(".row.active");
    const nextActive = list.querySelector(selector);
    if (currentActive instanceof HTMLElement && currentActive !== nextActive) {
        currentActive.classList.remove("active");
    }
    if (nextActive instanceof HTMLElement && nextActive !== currentActive) {
        nextActive.classList.add("active");
    }
    const detail = document.querySelector(".record-detail");
    if (detail instanceof HTMLElement) {
        detail.outerHTML = renderDetail();
    }
    return true;
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
    const tabId = getListTabId(list);
    const state = tabStates[tabId] || cloneDefaultState();
    let selector = "";
    if (tabId === "history") {
        const selectedId = String(state.selectedId || "").trim();
        if (selectedId) {
            const escapedId = (
                typeof CSS !== "undefined" && typeof CSS.escape === "function"
                    ? CSS.escape(selectedId)
                    : selectedId.replaceAll("\"", "\\\"")
            );
            selector = `.row[data-item-id="${escapedId}"]`;
        }
    } else {
        const selectedMediaId = String(state.lastOpenedMediaId || "").trim();
        if (selectedMediaId) {
            const escapedId = (
                typeof CSS !== "undefined" && typeof CSS.escape === "function"
                    ? CSS.escape(selectedMediaId)
                    : selectedMediaId.replaceAll("\"", "\\\"")
            );
            selector = `.media-card[data-media-item-id="${escapedId}"]`;
        }
    }
    if (!selector) {
        list.scrollTop = 0;
        return;
    }
    const target = list.querySelector(selector);
    if (!(target instanceof HTMLElement)) {
        list.scrollTop = 0;
        return;
    }
    const alignSelectedCard = () => {
        const currentList = document.getElementById("list");
        if (!(currentList instanceof HTMLElement)) {
            return;
        }
        if (getListTabId(currentList) !== tabId) {
            return;
        }
        const currentTarget = currentList.querySelector(selector);
        if (!(currentTarget instanceof HTMLElement)) {
            currentList.scrollTop = 0;
            return;
        }
        const listRect = currentList.getBoundingClientRect();
        const targetRect = currentTarget.getBoundingClientRect();
        const top = Math.max(
            0,
            currentList.scrollTop + (targetRect.top - listRect.top) - 8
        );
        currentList.scrollTop = top;
    };
    alignSelectedCard();
    requestAnimationFrame(() => {
        alignSelectedCard();
        requestAnimationFrame(alignSelectedCard);
    });
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

function syncListScroll(force = false, tabIdOverride = "", listOverride = null) {
    void force;
    void tabIdOverride;
    void listOverride;
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
    appState.facetDropdown = { open: false, fieldId: "", anchor: null };
    if (shouldRender) {
        render();
    }
}

function computeFacetAnchor(fieldId) {
    const input = document.getElementById(fieldId);
    const shell = input?.closest?.(".facet-input-shell");
    const rect = shell?.getBoundingClientRect?.();
    if (!rect) {
        return null;
    }
    const top = rect.bottom + 4;
    const left = rect.left;
    const width = rect.width;
    const maxHeight = Math.max(140, window.innerHeight - top - 12);
    return { top, left, width, maxHeight };
}

function openFacetDropdown(fieldId) {
    appState.facetDropdown = {
        open: true,
        fieldId,
        anchor: computeFacetAnchor(fieldId)
    };
}

function updateFacetDropdownAnchor(shouldRender = false) {
    if (!appState.facetDropdown.open) {
        return;
    }
    const anchor = computeFacetAnchor(
        appState.facetDropdown.fieldId
    );
    if (!anchor || anchor.maxHeight < 120) {
        closeFacetDropdown(true);
        return;
    }
    appState.facetDropdown.anchor = anchor;
    const menu = document.querySelector(
        `.facet-menu[data-facet-menu="${appState.facetDropdown.fieldId}"]`
    );
    if (menu instanceof HTMLElement) {
        menu.style.top = `${Math.round(anchor.top)}px`;
        menu.style.left = `${Math.round(anchor.left)}px`;
        menu.style.width = `${Math.round(anchor.width)}px`;
        menu.style.maxHeight = `${Math.round(anchor.maxHeight)}px`;
        return;
    }
    if (shouldRender) {
        render();
    }
}

function renderFacetInput(fieldId, label, value, placeholder, options) {
    const wrapClass = "facet-field-wrap";
    const normalizedValue = String(value || "");
    const optionSet = new Set(options.map((item) => String(item)));
    const mergedOptions = [];
    if (normalizedValue && !optionSet.has(normalizedValue)) {
        mergedOptions.push(normalizedValue);
    }
    mergedOptions.push(...options);
    const optionsHtml = mergedOptions.map((option) => {
        const optionValue = String(option);
        const selected = optionValue === normalizedValue ? "selected" : "";
        return `<option value="${escapeAttr(optionValue)}" ${selected}>${escapeHtml(optionValue)}</option>`;
    }).join("");
    return `<div class="field">
        <span>${label}:</span>
        <div class="${wrapClass}">
            <select id="${fieldId}" title="${escapeAttr(normalizedValue)}">
                <option value="">${escapeHtml(t("xdatahub.ui.app.facet.all", "All"))}</option>
                ${optionsHtml}
            </select>
        </div>
    </div>`;
}

function switchTab(tab) {
    if (appState.activeTab === tab) {
        return;
    }
    syncListScroll(true);
    clearDetailResources();
    closeImagePreview();
    appState.compactActionsMenuOpen = false;
    appState.dateRangePanelOpen = false;
    closeFacetDropdown(false);
    if (appState.dbDeleteDialogOpen) {
        appState.dbDeleteDialogOpen = false;
    }
    appState.activeTab = tab;
    savePersistedActiveTab(tab);
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
    syncSearchButtonUi();
    appState.searchLockTimer = window.setTimeout(() => {
        appState.searchLockedUntil = 0;
        appState.searchLockTimer = 0;
        syncSearchButtonUi();
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
        syncTopActionBarUi();
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
    syncSearchButtonUi();
    const state = currentTabState();
    state.page = 1;
    saveTabState(appState.activeTab);
    loadList().finally(() => {
        appState.searchInFlight = false;
        syncSearchButtonUi();
    });
}

function scheduleSearchReload() {
    resetSearchDebounce();
    appState.searchDebounceTimer = window.setTimeout(() => {
        appState.searchDebounceTimer = 0;
        runSearchNow();
    }, SEARCH_DEBOUNCE_MS);
}

function syncSearchButtonUi() {
    const button = document.getElementById("btn-apply-filters");
    if (!(button instanceof HTMLButtonElement)) {
        return;
    }
    button.disabled = isSearchLocked() || appState.searchInFlight;
}

const debouncedLayoutRefresh = debounce(() => {
    if (document.fullscreenElement) {
        return;
    }
    const tab = appState.activeTab;
    if (tab !== "history" && !isMediaTab(tab)) {
        return;
    }
    if (tab === "history") {
        setHistoryLayoutState({ splitRatio: historyLayoutState().splitRatio });
    }
    render();
}, 120);
const debouncedFacetDropdownReposition = debounce(() => {
    updateFacetDropdownAnchor(false);
}, 80);

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

function currentPreviewMediaEntries() {
    if (!isMediaTab(appState.activeTab) || !Array.isArray(appState.items)) {
        return [];
    }
    return appState.items
        .filter((item) => item?.kind !== "folder")
        .map((item) => {
            const mediaType = String(
                item?.extra?.media_type || mediaTypeOfTab(appState.activeTab)
            );
            const fileUrl = String(item?.extra?.file_url || "");
            const mediaRef = String(item?.extra?.media_ref || "");
            return {
                kind: mediaType,
                url: fileUrl,
                title: String(item?.title || ""),
                mediaItemId: String(item?.id || "").trim(),
                mediaRef,
            };
        })
        .filter((item) => item.url);
}

function currentPreviewMediaNav() {
    const entries = currentPreviewMediaEntries();
    if (!entries.length) {
        return { index: -1, prev: null, next: null };
    }
    const preview = appState.imagePreview;
    const mediaItemId = String(preview.mediaItemId || "").trim();
    let index = entries.findIndex((item) =>
        mediaItemId
            ? item.mediaItemId === mediaItemId
            : item.url === preview.url
    );
    if (index < 0 && preview.url) {
        index = entries.findIndex((item) => item.url === preview.url);
    }
    return {
        index,
        prev: index > 0 ? entries[index - 1] : null,
        next: index >= 0 && index < entries.length - 1
            ? entries[index + 1]
            : null,
    };
}

function openAdjacentPreview(direction) {
    if (!appState.imagePreview.open) {
        return false;
    }
    const nav = currentPreviewMediaNav();
    const target = direction < 0 ? nav.prev : nav.next;
    if (!target) {
        return false;
    }
    const targetCard = findMediaCardByIdentity(target.mediaItemId, target.url);
    openImagePreview(
        target.kind,
        target.url,
        target.title,
        buildPreviewOptionsFromCard(targetCard, target)
    );
    if (target.mediaItemId) {
        const state = currentTabState();
        state.lastOpenedMediaId = target.mediaItemId;
        state.lastOpenedMediaUrl = target.url;
        saveTabState(appState.activeTab);
    }
    updateLastOpenedMediaCardClass(targetCard);
    return true;
}

function openImagePreview(kind, url, title) {
    if (!url) {
        return;
    }
    const options = arguments[3] || {};
    const missing = !!options.missing;
    const permissionDenied = !missing && !!options.permissionDenied;
    const unsupported = !missing && !permissionDenied && !!options.unsupported;
    appState.imagePreview = {
        open: true,
        kind: kind || "image",
        url,
        mediaRef: String(options.mediaRef || ""),
        title: title || "",
        mediaItemId: String(options.mediaItemId || "").trim(),
        permissionDenied,
        permissionDeniedMessage: String(
            options.permissionDeniedMessage || ""
        ),
        missing,
        missingMessage: String(options.missingMessage || ""),
        unsupported,
        unsupportedMessage: String(options.unsupportedMessage || ""),
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
    mountImageLightbox();
}

function closeImagePreview() {
    if (!appState.imagePreview.open) {
        return;
    }
    document.removeEventListener(
        "fullscreenchange",
        handleImageLightboxFullscreenChange
    );
    if (isImageLightboxFullscreenActive()) {
        void document.exitFullscreen().catch(() => {});
    }
    const audioPlayer = document.getElementById("audio-lightbox-player");
    if (audioPlayer instanceof HTMLMediaElement) {
        try {
            audioPlayer.pause();
        } catch {}
    }
    const videoPlayer = document.getElementById("video-lightbox-player");
    if (videoPlayer instanceof HTMLMediaElement) {
        try {
            videoPlayer.pause();
        } catch {}
    }
    appState.imagePreview = createDefaultImagePreviewState();
    unmountImageLightbox();
}

function updateLastOpenedMediaCardClass(card) {
    if (!root) {
        return;
    }
    root.querySelectorAll(".media-card-last-opened").forEach((node) => {
        node.classList.remove("media-card-last-opened");
    });
    if (card instanceof HTMLElement) {
        card.classList.add("media-card-last-opened");
    }
}

function findMediaCardByIdentity(mediaItemId, url) {
    if (!root) {
        return null;
    }
    const itemId = String(mediaItemId || "").trim();
    if (itemId) {
        const safeItemId = typeof CSS !== "undefined" && CSS.escape
            ? CSS.escape(itemId)
            : itemId.replaceAll("\"", "\\\"");
        const byId = root.querySelector(
            `.media-card[data-media-item-id="${safeItemId}"]`
        );
        if (byId instanceof HTMLElement) {
            return byId;
        }
    }
    const previewUrl = String(url || "");
    if (!previewUrl) {
        return null;
    }
    const safeUrl = typeof CSS !== "undefined" && CSS.escape
        ? CSS.escape(previewUrl)
        : previewUrl.replaceAll("\"", "\\\"");
    const byUrl = root.querySelector(
        `.media-card[data-preview-url="${safeUrl}"]`
    );
    return byUrl instanceof HTMLElement ? byUrl : null;
}

function buildPreviewOptionsFromCard(card, fallback) {
    const base = {
        mediaRef: String(fallback?.mediaRef || ""),
        mediaItemId: String(fallback?.mediaItemId || "").trim(),
    };
    if (!(card instanceof HTMLElement)) {
        return base;
    }
    const kind = String(
        card.getAttribute("data-preview-kind")
        || fallback?.kind
        || "image"
    );
    const missing = (
        (kind === "video" && card.getAttribute("data-video-missing") === "1")
        || (kind === "image" && card.getAttribute("data-image-missing") === "1")
        || (kind === "audio" && card.getAttribute("data-audio-missing") === "1")
    );
    const permissionDenied = (
        (kind === "video"
            && card.getAttribute("data-video-permission-denied") === "1")
        || (kind === "image"
            && card.getAttribute("data-image-permission-denied") === "1")
        || (kind === "audio"
            && card.getAttribute("data-audio-permission-denied") === "1")
    );
    const unsupported = (
        (kind === "video" && card.getAttribute("data-video-unsupported") === "1")
        || (kind === "image" && card.getAttribute("data-image-unsupported") === "1")
        || (kind === "audio" && card.getAttribute("data-audio-unsupported") === "1")
    );
    return {
        ...base,
        missing,
        missingMessage: missing
            ? t("xdatahub.api.error.file_not_found", "File not found or moved")
            : "",
        permissionDenied,
        permissionDeniedMessage: permissionDenied
            ? t("xdatahub.api.error.permission_denied", "Permission denied")
            : "",
        unsupported,
        unsupportedMessage: unsupported
            ? kind === "video"
                ? t(
                    "xdatahub.ui.app.media.unsupported_video_codec",
                    "This video format or codec is not supported in the current browser, or the file contains audio track only."
                )
                : kind === "audio"
                    ? t(
                        "xdatahub.ui.app.media.unsupported_audio_codec",
                        "This audio format or codec is not supported in the current browser."
                    )
                    : t(
                        "xdatahub.ui.app.media.unsupported_image_codec",
                        "This image format or codec is not supported in the current browser."
                    )
            : "",
    };
}

function markPreviewMissing(kind, message) {
    appState.imagePreview.permissionDenied = false;
    appState.imagePreview.permissionDeniedMessage = "";
    appState.imagePreview.missing = true;
    appState.imagePreview.missingMessage = message || "";
    appState.imagePreview.unsupported = false;
    appState.imagePreview.unsupportedMessage = "";
    if (kind) {
        markCurrentMediaCardMissing(kind);
    }
    mountImageLightbox();
}

function markPreviewPermissionDenied(kind, message) {
    appState.imagePreview.permissionDenied = true;
    appState.imagePreview.permissionDeniedMessage = message || "";
    appState.imagePreview.missing = false;
    appState.imagePreview.missingMessage = "";
    appState.imagePreview.unsupported = false;
    appState.imagePreview.unsupportedMessage = "";
    if (kind) {
        markCurrentMediaCardPermissionDenied(kind);
    }
    mountImageLightbox();
}

function markPreviewUnsupported(kind, message) {
    appState.imagePreview.permissionDenied = false;
    appState.imagePreview.permissionDeniedMessage = "";
    appState.imagePreview.missing = false;
    appState.imagePreview.missingMessage = "";
    appState.imagePreview.unsupported = true;
    appState.imagePreview.unsupportedMessage = message || "";
    if (kind) {
        markCurrentMediaCardUnsupported(kind);
    }
    mountImageLightbox();
}

function imageLightboxFullscreenTarget() {
    const stage = document.getElementById("image-lightbox-stage");
    if (stage instanceof HTMLElement) {
        return stage;
    }
    const content = document.querySelector("#image-lightbox .image-lightbox-content");
    if (content instanceof HTMLElement) {
        return content;
    }
    return null;
}

function isImageLightboxFullscreenActive() {
    const target = imageLightboxFullscreenTarget();
    if (!target || !document.fullscreenElement) {
        return false;
    }
    return (
        document.fullscreenElement === target
        || target.contains(document.fullscreenElement)
    );
}

function syncImageLightboxFullscreenButton() {
    const btn = document.getElementById("image-lightbox-fullscreen-btn");
    if (!(btn instanceof HTMLButtonElement)) {
        return;
    }
    const active = isImageLightboxFullscreenActive();
    const fullscreenTitle = btn.dataset.titleFullscreen || "Fullscreen";
    const exitFullscreenTitle = btn.dataset.titleExitFullscreen
        || "Exit fullscreen";
    const titleText = active ? exitFullscreenTitle : fullscreenTitle;
    btn.title = titleText;
    btn.setAttribute("aria-label", titleText);
    btn.setAttribute("aria-pressed", active ? "true" : "false");
    btn.innerHTML = iconSvg(
        active ? "minimize-2" : "maximize-2",
        titleText,
        "xdatahub-icon btn-icon"
    );
}

function handleImageLightboxFullscreenChange() {
    syncImageLightboxFullscreenButton();
    syncImagePreviewTransform();
}

async function toggleImageLightboxFullscreen() {
    const target = imageLightboxFullscreenTarget();
    if (!target) {
        return;
    }
    try {
        if (isImageLightboxFullscreenActive()) {
            await document.exitFullscreen();
        } else {
            await target.requestFullscreen();
        }
    } catch {
        // 浏览器或宿主环境可能阻止全屏，保持静默失败。
    } finally {
        handleImageLightboxFullscreenChange();
    }
}

function bindImageLightboxEvents() {
    document.getElementById("image-lightbox-prev-btn")?.addEventListener(
        "click",
        () => {
            openAdjacentPreview(-1);
        }
    );
    document.getElementById("image-lightbox-next-btn")?.addEventListener(
        "click",
        () => {
            openAdjacentPreview(1);
        }
    );
    document.getElementById("image-lightbox-close")?.addEventListener("click", () => {
        closeImagePreview();
    });
    document.getElementById("image-lightbox-close-btn")?.addEventListener("click", () => {
        closeImagePreview();
    });
    document.getElementById("image-lightbox-fullscreen-btn")?.addEventListener(
        "click",
        () => {
            void toggleImageLightboxFullscreen();
        }
    );
    document.removeEventListener(
        "fullscreenchange",
        handleImageLightboxFullscreenChange
    );
    document.addEventListener(
        "fullscreenchange",
        handleImageLightboxFullscreenChange
    );
    handleImageLightboxFullscreenChange();
    const previewVideo = document.getElementById("video-lightbox-player");
    if (previewVideo instanceof HTMLVideoElement) {
        previewVideo.addEventListener("error", () => {
            void (async () => {
                const failureType = await probeMediaFailure(
                    previewVideo.currentSrc
                    || previewVideo.src
                    || appState.imagePreview.url
                );
                if (failureType === "permission") {
                    markPreviewPermissionDenied("video", t(
                        "xdatahub.api.error.permission_denied",
                        "Permission denied"
                    ));
                    return;
                }
                if (failureType === "missing") {
                    markPreviewMissing("video", t(
                        "xdatahub.api.error.file_not_found",
                        "File not found or moved"
                    ));
                    return;
                }
                markPreviewUnsupported("video", t(
                    "xdatahub.ui.app.media.unsupported_video_codec",
                    "Unsupported video format or codec"
                ));
            })();
        }, { once: true });
        previewVideo.addEventListener("loadedmetadata", () => {
            if (
                previewVideo.videoWidth <= 0
                || previewVideo.videoHeight <= 0
            ) {
                markPreviewUnsupported("video", t(
                    "xdatahub.ui.app.media.unsupported_video_codec",
                    "Unsupported video format or codec"
                ));
            }
        }, { once: true });
    }
    const previewAudio = document.getElementById("audio-lightbox-player");
    if (previewAudio instanceof HTMLAudioElement) {
        previewAudio.addEventListener("error", () => {
            void (async () => {
                const failureType = await probeMediaFailure(
                    previewAudio.currentSrc
                    || previewAudio.src
                    || appState.imagePreview.url
                );
                if (failureType === "permission") {
                    markPreviewPermissionDenied("audio", t(
                        "xdatahub.api.error.permission_denied",
                        "Permission denied"
                    ));
                    return;
                }
                if (failureType === "missing") {
                    markPreviewMissing("audio", t(
                        "xdatahub.api.error.file_not_found",
                        "File not found or moved"
                    ));
                    return;
                }
                markPreviewUnsupported("audio", t(
                    "xdatahub.ui.app.media.unsupported_audio_codec",
                    "Unsupported audio format or codec"
                ));
            })();
        }, { once: true });
    }
}

function mountImageLightbox() {
    if (!root || !appState.imagePreview.open) {
        return;
    }
    const nextHtml = renderImagePreview();
    if (!nextHtml) {
        return;
    }
    const current = document.getElementById("image-lightbox");
    if (current instanceof HTMLElement) {
        current.outerHTML = nextHtml;
    } else {
        root.insertAdjacentHTML("beforeend", nextHtml);
    }
    bindImageLightboxEvents();
    setupImagePreviewEvents();
    syncImagePreviewTransform();
}

function unmountImageLightbox() {
    const lightbox = document.getElementById("image-lightbox");
    if (lightbox instanceof HTMLElement) {
        lightbox.remove();
        return;
    }
    // 兜底：若节点意外丢失，保持现有逻辑可恢复。
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
    const stageRect = stage.getBoundingClientRect();
    const stageW = Math.max(1, stageRect.width);
    const stageH = Math.max(1, stageRect.height);
    const nw = Math.max(1, Number(preview.naturalWidth || image.naturalWidth || 0));
    const nh = Math.max(1, Number(preview.naturalHeight || image.naturalHeight || 0));
    const fitScale = Math.min(stageW / nw, stageH / nh);
    const renderW = nw * fitScale * preview.scale;
    const renderH = nh * fitScale * preview.scale;
    image.style.width = `${renderW}px`;
    image.style.height = `${renderH}px`;
    image.style.maxWidth = "none";
    image.style.maxHeight = "none";
    image.style.transform = `translate(${preview.offsetX}px, ${preview.offsetY}px)`;
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
    image.addEventListener("error", () => {
        void (async () => {
            const failureType = await probeMediaFailure(
                image.currentSrc || image.src || appState.imagePreview.url
            );
            if (failureType === "permission") {
                markPreviewPermissionDenied("image", t(
                    "xdatahub.api.error.permission_denied",
                    "Permission denied"
                ));
                return;
            }
            if (failureType === "missing") {
                markPreviewMissing("image", t(
                    "xdatahub.api.error.file_not_found",
                    "File not found or moved"
                ));
                return;
            }
            markPreviewUnsupported("image", t(
                "xdatahub.ui.app.media.unsupported_image_codec",
                "Unsupported image format or codec"
            ));
        })();
    }, { once: true });

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
    if (!window.confirm(t(
        "xdatahub.ui.app.confirm.clear_media_index",
        "Confirm clearing current media type index?"
    ))) {
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

function refreshDbDeleteDialogOverlay() {
    if (!appState.dbDeleteDialogOpen) {
        return;
    }
    syncOverlayById("db-delete-overlay", renderDbDeleteDialog());
}

function refreshSettingsDialogOverlay() {
    if (!appState.settingsDialogOpen) {
        return;
    }
    syncOverlayById("settings-dialog-overlay", renderSettingsDialog());
}

function refreshNodeSendDialogOverlay() {
    if (!appState.nodeSendDialogOpen) {
        return;
    }
    syncOverlayById("node-send-overlay", renderNodeSendDialog());
}

function canSubmitNodeSend(nodeIds) {
    if (
        appState.nodeSendLoading
        || appState.nodeSendError
        || appState.nodeSendSending
    ) {
        return false;
    }
    const mediaRef = String(appState.nodeSendMediaRef || "");
    const textValue = String(appState.nodeSendTextValue || "");
    const isStringTarget = (
        String(appState.nodeSendTargetClass || "") === "XStringGet"
    );
    if (!Array.isArray(nodeIds) || !nodeIds.length) {
        return false;
    }
    if (!isStringTarget && !mediaRef) {
        return false;
    }
    if (isStringTarget && !textValue.trim()) {
        return false;
    }
    return true;
}

function nextNodeSendAckRequestId() {
    nodeSendAckSeq += 1;
    return `node_send_${Date.now()}_${nodeSendAckSeq}`;
}

function resetNodeSendResultState() {
    appState.nodeSendProgressCurrent = 0;
    appState.nodeSendProgressTotal = 0;
    appState.nodeSendSuccessCount = 0;
    appState.nodeSendFailureCount = 0;
    appState.nodeSendLastFailureMessage = "";
}

function syncHostNodeSendBusyState() {
    window.parent?.postMessage?.(
        {
            type: "xdatahub:node_send_busy",
            busy: appState.nodeSendSending === true
                && appState.nodeSendHostLockActive === true,
        },
        "*"
    );
}

function clearPendingNodeSendAcks() {
    for (const pending of nodeSendAckResolvers.values()) {
        window.clearTimeout(pending.timeoutId);
        pending.resolve({
            ok: false,
            error: t(
                "xdatahub.ui.app.media.send_dialog_failed_closed",
                "Dialog closed before send completed"
            ),
        });
    }
    nodeSendAckResolvers.clear();
}

function waitForNodeSendAck(requestId) {
    return new Promise((resolve) => {
        const timeoutId = window.setTimeout(() => {
            if (!nodeSendAckResolvers.has(requestId)) {
                return;
            }
            nodeSendAckResolvers.delete(requestId);
            resolve({
                ok: false,
                error: t(
                    "xdatahub.ui.app.media.send_dialog_timeout",
                    "Send timed out"
                ),
            });
        }, NODE_SEND_ACK_TIMEOUT_MS);
        nodeSendAckResolvers.set(requestId, { resolve, timeoutId });
    });
}

function applyNodeSendAckResponse(payload) {
    const requestId = String(payload?.request_id || "");
    if (!requestId || !nodeSendAckResolvers.has(requestId)) {
        return;
    }
    const pending = nodeSendAckResolvers.get(requestId);
    nodeSendAckResolvers.delete(requestId);
    window.clearTimeout(pending.timeoutId);
    pending.resolve({
        ok: payload?.ok !== false,
        error: String(payload?.error || ""),
        nodeId: Number(payload?.node_id),
    });
}

function getNodeSendSummaryText() {
    if (appState.nodeSendSending) {
        return t(
            "xdatahub.ui.app.media.send_dialog_progress",
            "Sending {current}/{total}",
            {
                current: appState.nodeSendProgressCurrent,
                total: appState.nodeSendProgressTotal,
            }
        );
    }
    if (
        appState.nodeSendSuccessCount > 0
        || appState.nodeSendFailureCount > 0
    ) {
        return t(
            "xdatahub.ui.app.media.send_dialog_result",
            "Success {success}, Failed {failure}",
            {
                success: appState.nodeSendSuccessCount,
                failure: appState.nodeSendFailureCount,
            }
        );
    }
    return t(
        "xdatahub.ui.app.media.send_dialog_selected",
        "Selected"
    ) + `: ${(appState.nodeSendSelectedIds || []).length}`;
}

async function submitNodeSend(nodeIds, options = {}) {
    const selectedIds = (nodeIds || [])
        .map((id) => Number(id))
        .filter((id) => Number.isFinite(id));
    if (!canSubmitNodeSend(selectedIds)) {
        return false;
    }
    const mediaRef = String(appState.nodeSendMediaRef || "");
    const textValue = String(appState.nodeSendTextValue || "");
    const isStringTarget = (
        String(appState.nodeSendTargetClass || "") === "XStringGet"
    );
    const lockHost = options.lockHost !== false;
    clearPendingNodeSendAcks();
    appState.nodeSendSending = true;
    appState.nodeSendHostLockActive = lockHost;
    syncHostNodeSendBusyState();
    appState.nodeSendProgressTotal = selectedIds.length;
    appState.nodeSendProgressCurrent = 0;
    appState.nodeSendSuccessCount = 0;
    appState.nodeSendFailureCount = 0;
    appState.nodeSendLastFailureMessage = "";
    refreshNodeSendDialogOverlay();
    for (const [index, nodeId] of selectedIds.entries()) {
        appState.nodeSendProgressCurrent = index + 1;
        refreshNodeSendDialogOverlay();
        const requestId = nextNodeSendAckRequestId();
        const ackPromise = waitForNodeSendAck(requestId);
        window.parent?.postMessage?.(
            {
                type: "xdatahub:send_to_node",
                data: {
                    request_id: requestId,
                    node_id: nodeId,
                    media_ref: mediaRef,
                    text_value: isStringTarget ? textValue : "",
                    title: appState.nodeSendTitle || "",
                    node_class: appState.nodeSendTargetClass || "",
                },
            },
            "*"
        );
        const ack = await ackPromise;
        if (ack.ok) {
            appState.nodeSendSuccessCount += 1;
        } else {
            appState.nodeSendFailureCount += 1;
            appState.nodeSendLastFailureMessage = String(
                ack.error
                || t(
                    "xdatahub.ui.app.media.send_dialog_failed_generic",
                    "Send failed"
                )
            );
        }
        refreshNodeSendDialogOverlay();
    }
    appState.nodeSendSending = false;
    appState.nodeSendHostLockActive = false;
    syncHostNodeSendBusyState();
    const shouldClose = (
        appState.settings.nodeSendCloseAfterSend !== false
        && appState.nodeSendFailureCount === 0
    );
    if (shouldClose) {
        closeNodeSendDialog();
    } else {
        refreshNodeSendDialogOverlay();
    }
    return appState.nodeSendFailureCount === 0;
}

function resetNodeSendQuickSlideState() {
    appState.nodeSendQuickSlide = null;
}

function getNodeSendQuickSlideElement(nodeId) {
    if (!root) {
        return null;
    }
    return root.querySelector(
        `[data-node-send-slide-id="${CSS.escape(String(nodeId))}"]`
    );
}

function syncNodeSendQuickSlideVisual(slider, progress = 0) {
    if (!(slider instanceof HTMLElement)) {
        return;
    }
    const clamped = Math.max(0, Math.min(1, progress));
    slider.style.setProperty("--node-send-slide-progress", String(clamped));
    slider.classList.toggle("is-ready", clamped >= 0.92);
    const label = slider.querySelector("[data-node-send-slide-label]");
    if (label instanceof HTMLElement) {
        label.textContent = clamped >= 0.92
            ? t("xdatahub.ui.app.media.send_dialog_slide_release", "Release to send")
            : t("xdatahub.ui.app.media.send_dialog_slide", "Slide to send");
    }
}

function beginNodeSendQuickSlide(event, slider) {
    if (
        !(slider instanceof HTMLElement)
        || appState.nodeSendLoading
        || !!appState.nodeSendError
        || appState.nodeSendSending
    ) {
        return false;
    }
    const nodeId = Number(slider.getAttribute("data-node-send-slide-id") || "");
    if (!Number.isFinite(nodeId)) {
        return false;
    }
    const track = slider.querySelector(".node-send-quick-track");
    const handle = slider.querySelector(".node-send-quick-handle");
    if (!(track instanceof HTMLElement) || !(handle instanceof HTMLElement)) {
        return false;
    }
    const rect = track.getBoundingClientRect();
    const usableWidth = Math.max(1, rect.width - handle.offsetWidth - 4);
    appState.nodeSendQuickSlide = {
        nodeId,
        pointerId: event.pointerId,
        startX: event.clientX,
        usableWidth,
    };
    slider.classList.add("is-sliding");
    slider.setPointerCapture?.(event.pointerId);
    syncNodeSendQuickSlideVisual(slider, 0);
    event.preventDefault();
    event.stopPropagation();
    return true;
}

function updateNodeSendQuickSlide(event) {
    const active = appState.nodeSendQuickSlide;
    if (!active || active.pointerId !== event.pointerId) {
        return false;
    }
    const slider = getNodeSendQuickSlideElement(active.nodeId);
    if (!(slider instanceof HTMLElement)) {
        resetNodeSendQuickSlideState();
        return false;
    }
    const deltaX = Math.max(0, event.clientX - active.startX);
    const progress = Math.max(0, Math.min(1, deltaX / active.usableWidth));
    syncNodeSendQuickSlideVisual(slider, progress);
    event.preventDefault();
    return true;
}

function endNodeSendQuickSlide(event) {
    const active = appState.nodeSendQuickSlide;
    if (!active || active.pointerId !== event.pointerId) {
        return false;
    }
    const slider = getNodeSendQuickSlideElement(active.nodeId);
    const progress = slider instanceof HTMLElement
        ? Number(slider.style.getPropertyValue("--node-send-slide-progress") || 0)
        : 0;
    if (slider instanceof HTMLElement) {
        slider.classList.remove("is-sliding");
        slider.releasePointerCapture?.(event.pointerId);
        syncNodeSendQuickSlideVisual(slider, 0);
    }
    resetNodeSendQuickSlideState();
    if (progress >= 0.92) {
        void submitNodeSend([active.nodeId], { lockHost: false });
    }
    event.preventDefault();
    return true;
}

function syncNodeSendSelectionUi() {
    const overlay = document.getElementById("node-send-overlay");
    if (!(overlay instanceof HTMLElement)) {
        return false;
    }
    const list = overlay.querySelector(".node-send-list");
    const selectedBadge = overlay.querySelector(".node-send-actions-selected");
    const confirmBtn = document.getElementById("node-send-confirm");
    const selectedIds = new Set(
        (appState.nodeSendSelectedIds || []).map((id) => String(id))
    );
    if (!(list instanceof HTMLElement) || !(selectedBadge instanceof HTMLElement)) {
        return false;
    }
    list.querySelectorAll("[data-node-send-id]").forEach((node) => {
        if (!(node instanceof HTMLElement)) {
            return;
        }
        const nodeId = String(node.getAttribute("data-node-send-id") || "");
        const checked = selectedIds.has(nodeId);
        node.classList.toggle("active", checked);
        node.setAttribute("aria-pressed", checked ? "true" : "false");
        const check = node.querySelector(".node-send-check");
        if (check instanceof HTMLElement) {
            const confirmText = t(
                "xdatahub.ui.app.common.confirm",
                "Confirm"
            );
            check.innerHTML = checked
                ? iconSvg(
                    "check",
                    confirmText,
                    "xdatahub-icon node-send-check-icon"
                )
                : "";
            if (checked) {
                check.setAttribute("title", confirmText);
            } else {
                check.removeAttribute("title");
            }
        }
    });
    const summaryText = getNodeSendSummaryText();
    selectedBadge.textContent = summaryText;
    selectedBadge.title = appState.nodeSendLastFailureMessage || summaryText;
    if (confirmBtn instanceof HTMLButtonElement) {
        const confirmSendText = t(
            "xdatahub.ui.app.media.send_dialog_confirm_send",
            "Send to selected nodes"
        );
        const sendingText = t(
            "xdatahub.ui.app.media.send_dialog_sending",
            "Sending..."
        );
        confirmBtn.disabled = (
            appState.nodeSendLoading
            || !!appState.nodeSendError
            || !selectedIds.size
            || appState.nodeSendSending
        );
        confirmBtn.innerHTML = appState.nodeSendSending
            ? `${iconSvg("refresh-cw", sendingText, "xdatahub-icon btn-icon")} ${escapeHtml(sendingText)}`
            : `${iconSvg("send", confirmSendText, "xdatahub-icon btn-icon")} ${escapeHtml(confirmSendText)}`;
        const buttonTitle = appState.nodeSendSending
            ? sendingText
            : confirmSendText;
        confirmBtn.title = buttonTitle;
        confirmBtn.setAttribute("aria-label", buttonTitle);
    }
    return true;
}

function syncNodeSendLoading() {
    appState.nodeSendLoading = (
        appState.nodeSendNodesLoading
        || appState.nodeSendValidateLoading
    );
}

function clearNodeSendRequestTimer() {
    if (appState.nodeSendRequestTimer) {
        window.clearTimeout(appState.nodeSendRequestTimer);
        appState.nodeSendRequestTimer = 0;
    }
}

function clearNodeSendValidateTimer() {
    if (appState.nodeSendValidateTimer) {
        window.clearTimeout(appState.nodeSendValidateTimer);
        appState.nodeSendValidateTimer = 0;
    }
}

function resolveNodeClassByMediaType(mediaType) {
    const type = String(mediaType || "").toLowerCase();
    if (type === "text") {
        return "XStringGet";
    }
    if (type === "video") {
        return "XVideoGet";
    }
    if (type === "audio") {
        return "XAudioGet";
    }
    return "XImageGet";
}

function renderNodeSendTargetHint(targetClass) {
    const nodeClassToken = "__XDH_NODE_CLASS__";
    const nodeClassText = String(targetClass || "").trim() || "XImageGet";
    const locale = readUiLocalePreference();
    const template = locale === "en"
        ? `Select a target ${nodeClassToken} node`
        : `选择目标 ${nodeClassToken} 节点`;
    return escapeHtml(template).replace(
        escapeHtml(nodeClassToken),
        `<code>${escapeHtml(nodeClassText)}</code>`
    );
}

function renderNodeSendTargetEmpty(targetClass) {
    const nodeClassToken = "__XDH_NODE_CLASS__";
    const nodeClassText = String(targetClass || "").trim() || "XImageGet";
    const locale = readUiLocalePreference();
    const template = locale === "en"
        ? `No ${nodeClassToken} nodes found`
        : `未找到 ${nodeClassToken} 节点`;
    return escapeHtml(template).replace(
        escapeHtml(nodeClassToken),
        `<code>${escapeHtml(nodeClassText)}</code>`
    );
}

function requestMediaGetNodes() {
    const targetClass = String(appState.nodeSendTargetClass || "XImageGet");
    const requestId = `mediaget_${Date.now()}_${Math.random()
        .toString(16)
        .slice(2)}`;
    appState.nodeSendRequestId = requestId;
    appState.nodeSendNodesLoading = true;
    syncNodeSendLoading();
    clearNodeSendRequestTimer();
    window.parent?.postMessage?.(
        {
            type: "xdatahub:request_media_get_nodes",
            request_id: requestId,
            node_class: targetClass,
        },
        "*"
    );
    appState.nodeSendRequestTimer = window.setTimeout(() => {
        if (appState.nodeSendRequestId !== requestId) {
            return;
        }
        appState.nodeSendRequestId = "";
        appState.nodeSendNodesLoading = false;
        syncNodeSendLoading();
        if (!appState.nodeSendError) {
            appState.nodeSendError = t(
                "xdatahub.ui.app.media.send_dialog_error",
                "Failed to load node list"
            );
        }
        refreshNodeSendDialogOverlay();
    }, 1500);
}

function refreshNodeSendTargets() {
    appState.nodeSendError = "";
    appState.nodeSendNodes = [];
    appState.nodeSendSelectedIds = [];
    resetNodeSendResultState();
    appState.nodeSendNodesLoading = true;
    appState.nodeSendValidateLoading = (
        appState.nodeSendTargetClass === "XImageGet"
        && !!String(appState.nodeSendMediaRef || "")
    );
    syncNodeSendLoading();
    requestMediaGetNodes();
    if (
        appState.nodeSendMediaRef
        && appState.nodeSendTargetClass === "XImageGet"
    ) {
        requestNodeSendValidation(appState.nodeSendMediaRef);
    } else if (!appState.nodeSendValidateLoading) {
        appState.nodeSendValidateLoading = false;
        syncNodeSendLoading();
    }
    refreshNodeSendDialogOverlay();
}

async function requestNodeSendValidation(mediaRef) {
    const requestId = `ximageget_validate_${Date.now()}_${Math.random()
        .toString(16)
        .slice(2)}`;
    appState.nodeSendValidateId = requestId;
    appState.nodeSendValidateLoading = true;
    syncNodeSendLoading();
    clearNodeSendValidateTimer();
    appState.nodeSendValidateTimer = window.setTimeout(() => {
        if (appState.nodeSendValidateId !== requestId) {
            return;
        }
        appState.nodeSendValidateId = "";
        appState.nodeSendValidateLoading = false;
        syncNodeSendLoading();
        if (!appState.nodeSendError) {
            appState.nodeSendError = t(
                "xdatahub.ui.app.media.send_dialog_error",
                "Failed to load node list"
            );
        }
        refreshNodeSendDialogOverlay();
    }, 1500);
    try {
        await apiPost("/xz3r0/xdatahub/media/validate", {
            media_ref: mediaRef,
        });
        if (appState.nodeSendValidateId !== requestId) {
            return;
        }
        appState.nodeSendValidateId = "";
        appState.nodeSendValidateLoading = false;
        clearNodeSendValidateTimer();
        syncNodeSendLoading();
        if (!appState.nodeSendError) {
            refreshNodeSendDialogOverlay();
        }
    } catch (error) {
        if (appState.nodeSendValidateId !== requestId) {
            return;
        }
        appState.nodeSendValidateId = "";
        appState.nodeSendValidateLoading = false;
        clearNodeSendValidateTimer();
        appState.nodeSendError = String(error?.message || "");
        appState.nodeSendNodes = [];
        syncNodeSendLoading();
        refreshNodeSendDialogOverlay();
    }
}

function openNodeSendDialog(
    mediaRef,
    title,
    mediaType = "",
    textValue = ""
) {
    appState.nodeSendDialogOpen = true;
    appState.nodeSendMediaRef = String(mediaRef || "");
    appState.nodeSendTextValue = String(textValue || "");
    appState.nodeSendTitle = String(title || "");
    appState.nodeSendTargetClass = resolveNodeClassByMediaType(mediaType);
    appState.nodeSendSending = false;
    resetNodeSendResultState();
    refreshNodeSendTargets();
}

function closeNodeSendDialog() {
    appState.nodeSendDialogOpen = false;
    appState.nodeSendMediaRef = "";
    appState.nodeSendTextValue = "";
    appState.nodeSendTitle = "";
    appState.nodeSendTargetClass = "XImageGet";
    appState.nodeSendNodes = [];
    appState.nodeSendSelectedIds = [];
    appState.nodeSendSending = false;
    appState.nodeSendHostLockActive = false;
    appState.nodeSendError = "";
    appState.nodeSendLoading = false;
    appState.nodeSendNodesLoading = false;
    appState.nodeSendValidateLoading = false;
    appState.nodeSendRequestId = "";
    appState.nodeSendValidateId = "";
    appState.nodeSendQuickSlide = null;
    resetNodeSendResultState();
    clearNodeSendRequestTimer();
    clearNodeSendValidateTimer();
    clearPendingNodeSendAcks();
    syncHostNodeSendBusyState();
    syncOverlayById("node-send-overlay", "");
}

function applyNodeSendNodesResponse(payload) {
    const requestId = String(payload?.request_id || "");
    if (!requestId || requestId !== appState.nodeSendRequestId) {
        return;
    }
    const responseClass = String(payload?.node_class || "");
    const targetClass = String(appState.nodeSendTargetClass || "");
    if (responseClass && targetClass && responseClass !== targetClass) {
        return;
    }
    clearNodeSendRequestTimer();
    appState.nodeSendRequestId = "";
    appState.nodeSendNodesLoading = false;
    syncNodeSendLoading();
    const nodes = Array.isArray(payload?.nodes)
        ? payload.nodes
        : [];
    appState.nodeSendNodes = nodes.filter(
        (item) => Number.isFinite(Number(item?.id))
    );
    refreshNodeSendDialogOverlay();
}

function buildDbDeleteSummaryText() {
    const selectedCount = appState.selectedDbFiles.length;
    const criticalCount = selectedCriticalDbCount();
    if (appState.clearDataMode === "delete") {
        return t(
            "xdatahub.ui.app.db.summary_delete_with_critical",
            "Will delete {selected} files (critical: {critical})",
            { selected: selectedCount, critical: criticalCount }
        );
    }
    return t(
        "xdatahub.ui.app.db.summary_clear_with_critical",
        "Will clear history in {selected} databases (critical: {critical})",
        { selected: selectedCount, critical: criticalCount }
    );
}

function renderDbDeleteConfirmHint() {
    const phrase = "__XDH_CONFIRM_PHRASE__";
    const template = t(
        "xdatahub.ui.app.db.confirm_yes_hint",
        "Confirm operation: type {phrase} below",
        { phrase }
    );
    return escapeHtml(template).replace(
        escapeHtml(phrase),
        `<code>YES</code>`
    );
}

function updateDbDeleteSubmitUi(submit) {
    if (!(submit instanceof HTMLButtonElement)) {
        return;
    }
    const isDeleteMode = appState.clearDataMode === "delete";
    const title = isDeleteMode
        ? t(
            "xdatahub.ui.app.db.submit_confirm_delete_short",
            "Confirm Delete"
        )
        : t(
            "xdatahub.ui.app.db.submit_confirm_clear_short",
            "Confirm Clear"
        );
    submit.disabled = isDeleteMode
        ? (!canSubmitDbDelete() || appState.dbDeleteLoading)
        : (!canSubmitRecordsCleanup() || appState.dbDeleteLoading);
    submit.title = title;
    submit.setAttribute("aria-label", title);
    submit.innerHTML = appState.dbDeleteLoading
        ? (
            isDeleteMode
                ? `${iconSvg("refresh-cw", t("xdatahub.ui.app.db.deleting", "Deleting"), "xdatahub-icon btn-icon")} ${t("xdatahub.ui.app.db.deleting_ellipsis", "Deleting...")}`
                : `${iconSvg("refresh-cw", t("xdatahub.ui.app.db.clearing", "Clearing"), "xdatahub-icon btn-icon")} ${t("xdatahub.ui.app.db.clearing_ellipsis", "Clearing...")}`
        )
        : `${iconSvg("triangle-alert", title, "xdatahub-icon btn-icon")} ${title}`;
}

function syncDbDeleteSelectionUi() {
    if (!appState.dbDeleteDialogOpen) {
        return;
    }
    const overlay = document.getElementById("db-delete-overlay");
    if (!(overlay instanceof HTMLElement)) {
        return;
    }
    overlay.querySelectorAll("[data-db-file-check]").forEach((node) => {
        if (!(node instanceof HTMLInputElement)) {
            return;
        }
        const name = node.getAttribute("data-db-file-check") || "";
        const item = appState.dbFileList.find(
            (entry) => normalizeDbName(entry.name) === normalizeDbName(name)
        );
        const locked = isDbCriticalEffective(item) && !appState.unlockCritical;
        const selected = isDbSelected(name);
        node.checked = selected;
        node.disabled = locked;
        const row = node.closest(".db-delete-row");
        if (row instanceof HTMLElement) {
            row.classList.toggle("selected", selected);
        }
    });
    overlay.querySelectorAll("[data-db-critical-mark]").forEach((node) => {
        if (!(node instanceof HTMLInputElement)) {
            return;
        }
        const name = node.getAttribute("data-db-critical-mark") || "";
        const item = appState.dbFileList.find(
            (entry) => normalizeDbName(entry.name) === normalizeDbName(name)
        );
        node.checked = !!item?.is_critical_user;
    });
    const summary = document.querySelector(".db-delete-summary");
    if (summary instanceof HTMLElement) {
        summary.textContent = buildDbDeleteSummaryText();
    }
    updateDbDeleteSubmitUi(document.getElementById("db-delete-submit"));
}

function dbPurposeIconName(purpose) {
    const text = String(purpose || "").trim().toLowerCase();
    if (!text) {
        return "database";
    }
    if (text.includes("media")) {
        return "image";
    }
    if (text.includes("audio")) {
        return "audio-lines";
    }
    if (text.includes("video")) {
        return "video";
    }
    if (text.includes("workflow")) {
        return "workflow";
    }
    if (text.includes("record") || text.includes("history")) {
        return "history";
    }
    return "database";
}

function localizeDbPurposeLabel(purpose) {
    const raw = String(purpose || "").trim();
    const text = raw.toLowerCase();
    if (!text) {
        return t("xdatahub.ui.app.text.h_f4dbbc63a5", "Database");
    }
    if (text === "media index db") {
        return t("xdatahub.ui.app.db.purpose.media_index", "Media Index DB");
    }
    if (text === "records db") {
        return t("xdatahub.ui.app.db.purpose.records", "Records DB");
    }
    if (text === "other db") {
        return t("xdatahub.ui.app.db.purpose.other", "Other DB");
    }
    return raw;
}

function canSubmitDbDelete() {
    if (!appState.selectedDbFiles.length) {
        return false;
    }
    if (appState.confirmYes.trim() !== "YES") {
        return false;
    }
    return true;
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
        refreshDbDeleteDialogOverlay();
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
    refreshDbDeleteDialogOverlay();
    appState.dbDeleteError = "";
    try {
        await fetchDbFileList();
        reconcileSelectedDbFiles();
    } catch (error) {
        appState.dbDeleteError = error.message || t(
            "xdatahub.ui.app.error.refresh_db_list_failed",
            "Failed to refresh database list"
        );
    } finally {
        appState.dbRefreshInFlight = false;
        refreshDbDeleteDialogOverlay();
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
    resetDbRefreshLock();
    resetDbRefreshDebounce();
    appState.dbRefreshInFlight = false;
    syncOverlayById("db-delete-overlay", "");
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

function reconcileLockedCriticalSelections() {
    if (appState.unlockCritical) {
        return;
    }
    const blocked = new Set(
        appState.dbFileList
            .filter((item) => isDbCriticalEffective(item))
            .map((item) => normalizeDbName(item.name))
    );
    appState.selectedDbFiles = appState.selectedDbFiles.filter((name) =>
        !blocked.has(normalizeDbName(name))
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
    resetDbRefreshLock();
    resetDbRefreshDebounce();
    appState.dbRefreshInFlight = false;
    refreshDbDeleteDialogOverlay();
    try {
        await fetchDbFileList();
    } catch (error) {
        appState.dbDeleteError = error.message || t(
            "xdatahub.ui.app.error.load_db_list_failed",
            "Failed to load database list"
        );
    } finally {
        appState.dbDeleteLoading = false;
        refreshDbDeleteDialogOverlay();
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
    refreshDbDeleteDialogOverlay();
    try {
        const result = await apiPost(
            "/xz3r0/xdatahub/records/db-files/delete",
            {
                targets: appState.selectedDbFiles,
                unlock_critical: appState.unlockCritical,
                confirm_yes: appState.confirmYes.trim(),
            }
        );
        const deleted = Number(result.deleted_count || 0);
        const failed = Number(result.failed_count || 0);
        const failedNames = Array.isArray(result.failed)
            ? result.failed.join(", ")
            : "";
        appState.dbDeleteResult = failed
            ? t(
                "xdatahub.ui.app.db.result_delete_failed",
                "Deleted {deleted}, failed {failed}: {names}",
                { deleted, failed, names: failedNames }
            )
            : t(
                "xdatahub.ui.app.db.result_delete_success",
                "Deleted {deleted} database files",
                { deleted }
            );
        await fetchDbFileList();
        appState.selectedDbFiles = [];
        appState.confirmYes = "";
        await loadList();
    } catch (error) {
        appState.dbDeleteError = error.message || t(
            "xdatahub.ui.app.error.delete_failed",
            "Delete Failed"
        );
    } finally {
        appState.dbDeleteLoading = false;
        refreshDbDeleteDialogOverlay();
    }
}

async function submitRecordsCleanup() {
    if (!canSubmitRecordsCleanup()) {
        return;
    }
    appState.dbDeleteLoading = true;
    appState.dbDeleteError = "";
    appState.dbDeleteResult = "";
    refreshDbDeleteDialogOverlay();
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
            ? t(
                "xdatahub.ui.app.db.result_clear_failed",
                "Cleared {touched} DB histories ({deleted} records), failed {failed}: {names}",
                { touched, deleted, failed, names: failedNames.join(", ") }
            )
            : t(
                "xdatahub.ui.app.db.result_clear_success",
                "Cleared {touched} DB histories ({deleted} records)",
                { touched, deleted }
            );
        await fetchDbFileList();
        appState.selectedDbFiles = [];
        appState.confirmYes = "";
        await loadList();
    } catch (error) {
        appState.dbDeleteError = error.message || t(
            "xdatahub.ui.app.error.cleanup_history_failed",
            "Failed to clear history"
        );
    } finally {
        appState.dbDeleteLoading = false;
        refreshDbDeleteDialogOverlay();
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
    const searchText = t("xdatahub.ui.app.text.h_f04090805c", "Search");
    const searchBtnText = `${iconSvg("search", searchText, "xdatahub-icon btn-icon")} ${searchText}`;
    const searchBtnClass = "btn primary search-btn";
    const searchDisabled = isSearchLocked() || appState.searchInFlight;
    const dbField = isHistory
        ? renderFacetInput(
            "filter-db-name",
            t("xdatahub.ui.app.text.h_1f6f90f1a7", "Source"),
            state.filters.dbName,
            t("xdatahub.ui.app.text.h_1f6f90f1a7", "Source"),
            appState.recordFacets.dbNames
        )
        : "";
    const typeField = isHistory
        ? renderFacetInput(
            "filter-data-type",
            t("xdatahub.ui.app.text.h_b031dc9a85", "Data Type"),
            state.filters.dataType,
            t("xdatahub.ui.app.text.h_b031dc9a85", "Data Type"),
            appState.recordFacets.dataTypes
        )
        : "";
    const sourceField = isHistory
        ? renderFacetInput(
            "filter-source",
            t("xdatahub.ui.app.text.h_e840cd6f1e", "Node"),
            state.filters.source,
            t("xdatahub.ui.app.text.h_e840cd6f1e", "Node"),
            appState.recordFacets.sources
        )
        : "";
    const facetBackdropHtml = appState.facetDropdown.open
        ? `<button class="facet-backdrop" id="facet-backdrop" aria-label="${escapeAttr(t("xdatahub.ui.app.filters.close_options", "Close options"))}"></button>`
        : "";
    const dateFilterHtml = `
        <div class="date-range-wrap date-range-inline">
            <div class="field">
                <span>${escapeHtml(t("xdatahub.ui.app.filters.start", "Start"))}:</span>
                <div class="datetime-field">
                    <div class="date-input-shell">
                        <input id="filter-start" type="datetime-local" value="${escapeHtml(state.filters.start)}" title="${escapeAttr(state.filters.start)}">
                        <button class="date-picker-btn" type="button" data-picker-target="filter-start" title="${escapeAttr(t("xdatahub.ui.app.aria.h_668822a22d", "Select start time"))}" aria-label="${escapeAttr(t("xdatahub.ui.app.aria.h_668822a22d", "Select start time"))}">${iconMask("calendar", t("xdatahub.ui.app.aria.h_668822a22d", "Select start time"), "date-picker-icon-mask")}</button>
                    </div>
                </div>
            </div>
            <div class="field">
                <span>${escapeHtml(t("xdatahub.ui.app.filters.end", "End"))}:</span>
                <div class="datetime-field">
                    <div class="date-input-shell">
                        <input id="filter-end" type="datetime-local" value="${escapeHtml(state.filters.end)}" title="${escapeAttr(state.filters.end)}">
                        <button class="date-picker-btn" type="button" data-picker-target="filter-end" title="${escapeAttr(t("xdatahub.ui.app.aria.h_6438a97efd", "Select end time"))}" aria-label="${escapeAttr(t("xdatahub.ui.app.aria.h_6438a97efd", "Select end time"))}">${iconMask("calendar", t("xdatahub.ui.app.aria.h_6438a97efd", "Select end time"), "date-picker-icon-mask")}</button>
                    </div>
                </div>
            </div>
        </div>
    `;
    const sidebarOpen = !!appState.filtersSidebarOpen;
    const filtersPanelHtml = `
        <div class="filters-sidebar-body">
            <div class="field keyword-field">
                <span>${escapeHtml(isHistory ? t("xdatahub.ui.app.text.h_83b27410a4", "Extra Header") : t("xdatahub.ui.app.text.h_1275f6feb7", "Filename"))}:</span>
                <input id="filter-keyword" value="${escapeHtml(state.filters.keyword)}" placeholder="${escapeAttr(isHistory ? t("xdatahub.ui.app.placeholder.h_5825819325", "Extra header keyword") : t("xdatahub.ui.app.placeholder.h_cc1b21e800", "Keyword"))}" title="${escapeAttr(state.filters.keyword)}">
            </div>
            ${dbField}
            ${typeField}
            ${sourceField}
            ${dateFilterHtml}
            <div class="filters-toolbar filter-panel-search">
                <button class="${searchBtnClass}" id="btn-apply-filters" ${searchDisabled ? "disabled" : ""}>${searchBtnText}</button>
            </div>
        </div>
        <div class="filters-sidebar-footer"></div>
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
    const mediaSortText = `${t("xdatahub.ui.app.sort.prefix", "Sort:")}${mediaSortDisplayText(
        appState.settings.mediaSortBy,
        appState.settings.mediaSortOrder
    )}${mediaSortOrder === "desc"
        ? t("xdatahub.ui.app.text.h_a4c38f3ce2", "Desc")
        : t("xdatahub.ui.app.text.h_c0276ec9a7", "Asc")}`;
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
            t("xdatahub.ui.app.text.h_dcce9a144a", "Filter"),
            "btn",
            false,
            sidebarOpen
        )}
        ${actionBtn("btn-refresh-inline", "refresh-cw", t("xdatahub.ui.app.text.h_38108eaa1d", "Refresh"), "btn", !canRefresh)}
        ${
            isMedia
                ? renderOrderSortButton(
                    "btn-media-sort-cycle",
                    mediaSortText,
                    mediaSortOrder,
                    t("xdatahub.ui.app.text.h_78cad6696d", "Toggle sort"),
                    "btn media-sort-cycle-btn"
                )
                : renderOrderSortButton(
                    "btn-history-sort-cycle",
                    historySortText,
                    historySortOrder,
                    t("xdatahub.ui.app.text.h_e73dc5b0e4", "Toggle history sort"),
                    "btn"
                )
        }
    `;
    const rightButtons = isMedia
        ? `
            ${actionBtn("btn-clean-invalid", "brush-cleaning", t("xdatahub.ui.app.text.h_e5f025789f", "Cleanup Invalid"), "btn", !canCleanInvalid)}
            ${actionBtn("btn-clear-index", "refresh-ccw", t("xdatahub.ui.app.action.rebuild_data", "Rebuild Data"), "btn danger", !canClearIndex)}
            ${actionBtn("btn-open-settings", "settings", t("xdatahub.ui.app.settings.title", "Settings"), "btn")}
        `
        : `
            ${actionBtn("btn-clear-data", "trash-2", t("xdatahub.ui.app.action.data_process", "Data Process"), "btn danger", !canClearData)}
            ${actionBtn("btn-open-settings", "settings", t("xdatahub.ui.app.settings.title", "Settings"), "btn")}
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

function syncCompactActionsUi() {
    const menu = document.getElementById("compact-actions-menu");
    const backdrop = document.getElementById("compact-actions-backdrop");
    const show = !!appState.compactActionsMenuOpen;
    menu?.classList.toggle("show", show);
    if (!show) {
        backdrop?.remove();
        return;
    }
    if (!backdrop && root) {
        const closeCompactActionsText = t(
            "xdatahub.ui.app.compact.close_actions",
            "Close compact actions"
        );
        root.insertAdjacentHTML(
            "beforeend",
            `<button class="compact-actions-backdrop" id="compact-actions-backdrop" aria-label="${escapeAttr(closeCompactActionsText)}"></button>`
        );
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
        ? t("xdatahub.ui.app.text.h_89b4aa6364", "Time")
        : by === "name"
            ? t("xdatahub.ui.app.text.h_1be7ae4fc2", "Name")
            : t("xdatahub.ui.app.text.h_fd20702c73", "Size");
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
        ? t("xdatahub.ui.app.text.h_74af8f8344", "Time Desc")
        : t("xdatahub.ui.app.text.h_c7e8b29a89", "Time Asc");
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
    title = t("xdatahub.ui.app.text.h_eb52699df3", "Toggle Sort"),
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
    const panel = document.getElementById("date-range-panel");
    const backdrop = document.getElementById("date-range-backdrop");
    if ((!panel || !backdrop) && shouldRender) {
        render();
        return;
    }
    panel?.classList.toggle("show", appState.dateRangePanelOpen);
    backdrop?.classList.toggle("show", appState.dateRangePanelOpen);
    updateDateRangeToggleVisual();
}

function syncHistoryDetailRawUi() {
    const container = document.querySelector(".record-detail");
    const item = selectedItem();
    if (!(container instanceof HTMLElement) || !item) {
        render();
        return;
    }
    container.outerHTML = renderHistoryDetail(item);
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
    const loadingVideoText = t("xdatahub.ui.app.text.h_9831837ab0", "Loading video");
    return (
        '<div class="video-card-placeholder is-loading" '
        + 'data-video-placeholder="1">'
        + '<span class="media-loading-spinner" aria-hidden="true"></span>'
        + `<span class="media-loading-icon">${iconSvg("video", loadingVideoText, "xdatahub-icon media-loading-icon-svg")}</span>`
        + "</div>"
    );
}

function renderVideoUnsupportedHtml() {
    const unsupportedText = t("xdatahub.ui.app.common.unsupported", "Unsupported");
    const unsupportedCodecText = t(
        "xdatahub.ui.app.media.unsupported_format_or_codec",
        "Unsupported format or codec"
    );
    return (
        '<div class="video-card-placeholder is-unsupported" '
        + 'data-video-placeholder="1" data-video-unsupported="1">'
        + `<span class="media-loading-icon">${iconSvg("triangle-alert", unsupportedText, "xdatahub-icon media-loading-icon-svg")}</span>`
        + `<span class="media-unsupported-text">${escapeHtml(unsupportedCodecText)}</span>`
        + "</div>"
    );
}

function renderVideoMissingHtml() {
    const missingLabel = t(
        "xdatahub.ui.app.media.file_missing",
        "File missing"
    );
    const missingText = t(
        "xdatahub.api.error.file_not_found",
        "File not found or moved"
    );
    return (
        '<div class="video-card-placeholder is-unsupported" '
        + 'data-video-placeholder="1" data-video-missing="1">'
        + `<span class="media-loading-icon">${iconSvg("triangle-alert", missingLabel, "xdatahub-icon media-loading-icon-svg")}</span>`
        + `<span class="media-unsupported-text">${escapeHtml(missingText)}</span>`
        + "</div>"
    );
}

function renderVideoPermissionDeniedHtml() {
    const deniedLabel = t(
        "xdatahub.ui.app.media.permission_denied",
        "Permission denied"
    );
    const deniedText = t(
        "xdatahub.api.error.permission_denied",
        "Permission denied"
    );
    return (
        '<div class="video-card-placeholder is-unsupported" '
        + 'data-video-placeholder="1" data-video-permission-denied="1">'
        + `<span class="media-loading-icon">${iconSvg("triangle-alert", deniedLabel, "xdatahub-icon media-loading-icon-svg")}</span>`
        + `<span class="media-unsupported-text">${escapeHtml(deniedText)}</span>`
        + "</div>"
    );
}

function renderAudioUnsupportedHtml() {
    const unsupportedText = t("xdatahub.ui.app.common.unsupported", "Unsupported");
    const unsupportedCodecText = t(
        "xdatahub.ui.app.media.unsupported_format_or_codec",
        "Unsupported format or codec"
    );
    return (
        '<div class="audio-card-hint is-unsupported" '
        + 'data-audio-unsupported="1">'
        + `<div class="audio-card-icon">${iconSvg("triangle-alert", unsupportedText, "xdatahub-icon audio-icon-svg")}</div>`
        + `<div>${escapeHtml(unsupportedCodecText)}</div>`
        + "</div>"
    );
}

function renderAudioMissingHtml() {
    const missingLabel = t(
        "xdatahub.ui.app.media.file_missing",
        "File missing"
    );
    const missingText = t(
        "xdatahub.api.error.file_not_found",
        "File not found or moved"
    );
    return (
        '<div class="audio-card-hint is-unsupported" '
        + 'data-audio-missing="1">'
        + `<div class="audio-card-icon">${iconSvg("triangle-alert", missingLabel, "xdatahub-icon audio-icon-svg")}</div>`
        + `<div>${escapeHtml(missingText)}</div>`
        + "</div>"
    );
}

function renderAudioPermissionDeniedHtml() {
    const deniedLabel = t(
        "xdatahub.ui.app.media.permission_denied",
        "Permission denied"
    );
    const deniedText = t(
        "xdatahub.api.error.permission_denied",
        "Permission denied"
    );
    return (
        '<div class="audio-card-hint is-unsupported" '
        + 'data-audio-permission-denied="1">'
        + `<div class="audio-card-icon">${iconSvg("triangle-alert", deniedLabel, "xdatahub-icon audio-icon-svg")}</div>`
        + `<div>${escapeHtml(deniedText)}</div>`
        + "</div>"
    );
}

function renderImageUnsupportedHtml() {
    const unsupportedText = t("xdatahub.ui.app.common.unsupported", "Unsupported");
    const unsupportedImageCodecText = t(
        "xdatahub.ui.app.media.unsupported_image_format_or_codec",
        "Unsupported image format or codec"
    );
    return (
        '<div class="video-card-placeholder is-unsupported" '
        + 'data-image-placeholder="1" data-image-unsupported="1">'
        + `<span class="media-loading-icon">${iconSvg("triangle-alert", unsupportedText, "xdatahub-icon media-loading-icon-svg")}</span>`
        + `<span class="media-unsupported-text">${escapeHtml(unsupportedImageCodecText)}</span>`
        + "</div>"
    );
}

function renderImageMissingHtml() {
    const missingLabel = t(
        "xdatahub.ui.app.media.file_missing",
        "File missing"
    );
    const missingText = t(
        "xdatahub.api.error.file_not_found",
        "File not found or moved"
    );
    return (
        '<div class="video-card-placeholder is-unsupported" '
        + 'data-image-placeholder="1" data-image-missing="1">'
        + `<span class="media-loading-icon">${iconSvg("triangle-alert", missingLabel, "xdatahub-icon media-loading-icon-svg")}</span>`
        + `<span class="media-unsupported-text">${escapeHtml(missingText)}</span>`
        + "</div>"
    );
}

function renderImagePermissionDeniedHtml() {
    const deniedLabel = t(
        "xdatahub.ui.app.media.permission_denied",
        "Permission denied"
    );
    const deniedText = t(
        "xdatahub.api.error.permission_denied",
        "Permission denied"
    );
    return (
        '<div class="video-card-placeholder is-unsupported" '
        + 'data-image-placeholder="1" data-image-permission-denied="1">'
        + `<span class="media-loading-icon">${iconSvg("triangle-alert", deniedLabel, "xdatahub-icon media-loading-icon-svg")}</span>`
        + `<span class="media-unsupported-text">${escapeHtml(deniedText)}</span>`
        + "</div>"
    );
}

function guessVideoMimeFromUrl(urlText) {
    const text = String(urlText || "").toLowerCase();
    const clean = text.split("?")[0].split("#")[0];
    if (clean.endsWith(".mp4") || clean.endsWith(".m4v")) {
        return "video/mp4";
    }
    if (clean.endsWith(".webm")) {
        return "video/webm";
    }
    if (clean.endsWith(".ogv") || clean.endsWith(".ogg")) {
        return "video/ogg";
    }
    if (clean.endsWith(".mov")) {
        return "video/quicktime";
    }
    if (clean.endsWith(".mkv")) {
        return "video/x-matroska";
    }
    if (clean.endsWith(".avi")) {
        return "video/x-msvideo";
    }
    if (clean.endsWith(".wmv")) {
        return "video/x-ms-wmv";
    }
    if (clean.endsWith(".flv")) {
        return "video/x-flv";
    }
    return "";
}

function guessAudioMimeFromUrl(urlText) {
    const text = String(urlText || "").toLowerCase();
    const clean = text.split("?")[0].split("#")[0];
    if (clean.endsWith(".mp3")) {
        return "audio/mpeg";
    }
    if (clean.endsWith(".m4a") || clean.endsWith(".aac")) {
        return "audio/mp4";
    }
    if (clean.endsWith(".wav")) {
        return "audio/wav";
    }
    if (clean.endsWith(".flac")) {
        return "audio/flac";
    }
    if (clean.endsWith(".ogg") || clean.endsWith(".oga")) {
        return "audio/ogg";
    }
    if (clean.endsWith(".opus")) {
        return "audio/opus";
    }
    if (clean.endsWith(".wma")) {
        return "audio/x-ms-wma";
    }
    if (clean.endsWith(".amr")) {
        return "audio/amr";
    }
    return "";
}

function isLikelyUnsupportedVideo(urlText) {
    const mime = guessVideoMimeFromUrl(urlText);
    if (!mime) {
        return false;
    }
    const probe = document.createElement("video");
    if (!(probe instanceof HTMLVideoElement)) {
        return false;
    }
    const result = String(probe.canPlayType(mime || "") || "").trim();
    return !result;
}

function isLikelyUnsupportedAudio(urlText) {
    const mime = guessAudioMimeFromUrl(urlText);
    if (!mime) {
        return false;
    }
    const probe = document.createElement("audio");
    if (!(probe instanceof HTMLAudioElement)) {
        return false;
    }
    const result = String(probe.canPlayType(mime || "") || "").trim();
    return !result;
}

function escapeCssSelectorValue(value) {
    const text = String(value || "");
    if (typeof window.CSS?.escape === "function") {
        return window.CSS.escape(text);
    }
    return text.replace(/["\\]/g, "\\$&");
}

function markCurrentMediaCardUnsupported(kind) {
    if (!root) {
        return;
    }
    const mediaItemId = String(
        currentTabState()?.lastOpenedMediaId || ""
    ).trim();
    if (!mediaItemId) {
        return;
    }
    const card = root.querySelector(
        `.media-card[data-media-item-id="${escapeCssSelectorValue(mediaItemId)}"]`
    );
    if (!(card instanceof HTMLElement)) {
        return;
    }
    markMediaCardUnsupported(card, kind);
}

function markCurrentMediaCardMissing(kind) {
    if (!root) {
        return;
    }
    const mediaItemId = String(
        currentTabState()?.lastOpenedMediaId || ""
    ).trim();
    if (!mediaItemId) {
        return;
    }
    const card = root.querySelector(
        `.media-card[data-media-item-id="${escapeCssSelectorValue(mediaItemId)}"]`
    );
    if (!(card instanceof HTMLElement)) {
        return;
    }
    markMediaCardMissing(card, kind);
}

function markCurrentMediaCardPermissionDenied(kind) {
    if (!root) {
        return;
    }
    const mediaItemId = String(
        currentTabState()?.lastOpenedMediaId || ""
    ).trim();
    if (!mediaItemId) {
        return;
    }
    const card = root.querySelector(
        `.media-card[data-media-item-id="${escapeCssSelectorValue(mediaItemId)}"]`
    );
    if (!(card instanceof HTMLElement)) {
        return;
    }
    markMediaCardPermissionDenied(card, kind);
}

function detachThumbSendButton(thumb) {
    if (!(thumb instanceof HTMLElement)) {
        return null;
    }
    const button = thumb.querySelector(".media-send-btn");
    if (!(button instanceof HTMLElement)) {
        return null;
    }
    button.remove();
    return button;
}

function setThumbHtmlKeepingSendButton(thumb, html) {
    if (!(thumb instanceof HTMLElement)) {
        return;
    }
    const sendButton = detachThumbSendButton(thumb);
    thumb.innerHTML = String(html || "");
    if (sendButton instanceof HTMLElement) {
        thumb.appendChild(sendButton);
    }
}

function markMediaCardUnsupported(card, kind) {
    if (!(card instanceof HTMLElement)) {
        return;
    }
    const thumb = card.querySelector(".media-thumb");
    if (!(thumb instanceof HTMLElement)) {
        return;
    }
    if (kind === "video") {
        const mediaId = String(
            card.getAttribute("data-media-item-id") || ""
        ).trim();
        if (mediaId) {
            appState.videoCardStateMap.set(mediaId, "unsupported");
        }
        card.removeAttribute("data-video-permission-denied");
        card.removeAttribute("data-video-missing");
        card.setAttribute("data-video-unsupported", "1");
        setThumbHtmlKeepingSendButton(
            thumb,
            renderVideoUnsupportedHtml()
        );
        return;
    }
    if (kind === "audio") {
        card.removeAttribute("data-audio-permission-denied");
        card.removeAttribute("data-audio-missing");
        card.setAttribute("data-audio-unsupported", "1");
        setThumbHtmlKeepingSendButton(
            thumb,
            renderAudioUnsupportedHtml()
        );
        return;
    }
    if (kind === "image") {
        card.removeAttribute("data-image-permission-denied");
        card.removeAttribute("data-image-missing");
        card.setAttribute("data-image-unsupported", "1");
        setThumbHtmlKeepingSendButton(
            thumb,
            renderImageUnsupportedHtml()
        );
    }
}

function markMediaCardMissing(card, kind) {
    if (!(card instanceof HTMLElement)) {
        return;
    }
    const thumb = card.querySelector(".media-thumb");
    if (!(thumb instanceof HTMLElement)) {
        return;
    }
    if (kind === "video") {
        const mediaId = String(
            card.getAttribute("data-media-item-id") || ""
        ).trim();
        if (mediaId) {
            appState.videoCardStateMap.set(mediaId, "missing");
        }
        card.removeAttribute("data-video-permission-denied");
        card.removeAttribute("data-video-unsupported");
        card.setAttribute("data-video-missing", "1");
        setThumbHtmlKeepingSendButton(
            thumb,
            renderVideoMissingHtml()
        );
        return;
    }
    if (kind === "audio") {
        card.removeAttribute("data-audio-permission-denied");
        card.removeAttribute("data-audio-unsupported");
        card.setAttribute("data-audio-missing", "1");
        setThumbHtmlKeepingSendButton(
            thumb,
            renderAudioMissingHtml()
        );
        return;
    }
    if (kind === "image") {
        card.removeAttribute("data-image-permission-denied");
        card.removeAttribute("data-image-unsupported");
        card.setAttribute("data-image-missing", "1");
        setThumbHtmlKeepingSendButton(
            thumb,
            renderImageMissingHtml()
        );
    }
}

function markMediaCardPermissionDenied(card, kind) {
    if (!(card instanceof HTMLElement)) {
        return;
    }
    const thumb = card.querySelector(".media-thumb");
    if (!(thumb instanceof HTMLElement)) {
        return;
    }
    if (kind === "video") {
        const mediaId = String(
            card.getAttribute("data-media-item-id") || ""
        ).trim();
        if (mediaId) {
            appState.videoCardStateMap.set(mediaId, "permission");
        }
        card.removeAttribute("data-video-unsupported");
        card.removeAttribute("data-video-missing");
        card.setAttribute("data-video-permission-denied", "1");
        setThumbHtmlKeepingSendButton(
            thumb,
            renderVideoPermissionDeniedHtml()
        );
        return;
    }
    if (kind === "audio") {
        card.removeAttribute("data-audio-unsupported");
        card.removeAttribute("data-audio-missing");
        card.setAttribute("data-audio-permission-denied", "1");
        setThumbHtmlKeepingSendButton(
            thumb,
            renderAudioPermissionDeniedHtml()
        );
        return;
    }
    if (kind === "image") {
        card.removeAttribute("data-image-unsupported");
        card.removeAttribute("data-image-missing");
        card.setAttribute("data-image-permission-denied", "1");
        setThumbHtmlKeepingSendButton(
            thumb,
            renderImagePermissionDeniedHtml()
        );
    }
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
            return (
                state !== "loaded"
                && state !== "loading"
                && state !== "error"
                && state !== "permission"
                && state !== "unsupported"
                && state !== "missing"
            );
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
    const markUnsupported = () => {
        appState.videoCardStateMap.set(id, "unsupported");
        card.removeAttribute("data-video-missing");
        card.setAttribute("data-video-unsupported", "1");
        thumb.innerHTML = renderVideoUnsupportedHtml();
    };
    const markMissing = () => {
        appState.videoCardStateMap.set(id, "missing");
        card.removeAttribute("data-video-unsupported");
        card.setAttribute("data-video-missing", "1");
        thumb.innerHTML = renderVideoMissingHtml();
    };
    const isVideoVisualTrackUsable = (videoEl) => {
        return (
            videoEl instanceof HTMLVideoElement
            && videoEl.videoWidth > 0
            && videoEl.videoHeight > 0
        );
    };
    const resolveLoadError = async (fallbackUrl) => {
        if (settled) {
            return;
        }
        const urlText = String(fallbackUrl || url || "");
        const failureType = await probeMediaFailure(urlText);
        if (failureType === "permission") {
            markMediaCardPermissionDenied(card, "video");
            settle("permission");
            return;
        }
        if (failureType === "missing") {
            markMissing();
            settle("missing");
            return;
        }
        markUnsupported();
        settle("unsupported");
    };
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
                if (!isVideoVisualTrackUsable(existing)) {
                    markUnsupported();
                    settle("unsupported");
                    return;
                }
                card.removeAttribute("data-video-unsupported");
                bindResolutionProbeForVideo(existing, resolutionKey);
                settle("loaded");
            }
        );
        addMediaListenerOnce(
            existing,
            `video-error:${id}`,
            "error",
            () => {
                void resolveLoadError(existing.currentSrc || existing.src);
            }
        );
        const watchdog = window.setTimeout(
            () => {
                markUnsupported();
                settle("unsupported");
            },
            VIDEO_LOAD_TIMEOUT_MS
        );
        appState.videoWatchdogMap.set(id, watchdog);
        return true;
    }
    const urlText = String(url || "");
    if (!urlText) {
        markUnsupported();
        onDone?.();
        return false;
    }
    if (isLikelyUnsupportedVideo(urlText)) {
        markUnsupported();
        onDone?.();
        return false;
    }
    const video = document.createElement("video");
    video.setAttribute("data-video-lazy", "1");
    video.muted = true;
    video.preload = "metadata";
    video.playsInline = true;
    video.src = urlText;
    const sendButton = detachThumbSendButton(thumb);
    thumb.innerHTML = "";
    thumb.appendChild(video);
    if (sendButton instanceof HTMLElement) {
        thumb.appendChild(sendButton);
    }
    addMediaListenerOnce(
        video,
        `video-meta:${id}`,
        "loadedmetadata",
        () => {
            if (!isVideoVisualTrackUsable(video)) {
                markUnsupported();
                settle("unsupported");
                return;
            }
            card.removeAttribute("data-video-unsupported");
            bindResolutionProbeForVideo(video, resolutionKey);
            settle("loaded");
        }
    );
    addMediaListenerOnce(
        video,
        `video-error:${id}`,
        "error",
        () => {
            void resolveLoadError(urlText);
        }
    );
    const watchdog = window.setTimeout(
        () => {
            markUnsupported();
            settle("unsupported");
        },
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
            || appState.videoCardStateMap.get(next.id) === "error"
            || appState.videoCardStateMap.get(next.id) === "permission"
            || appState.videoCardStateMap.get(next.id) === "unsupported"
            || appState.videoCardStateMap.get(next.id) === "missing"
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
    const noContentText = t("xdatahub.ui.app.text.h_895269f125", "(No Content)");
    const copyTitleText = t(
        "xdatahub.ui.app.title.h_8bac024269",
        "Send left content to node"
    );
    const copyText = t("xdatahub.ui.app.text.h_4edd1d0087", "Send to node");
    const dataTypeText = t("xdatahub.ui.app.text.h_b031dc9a85", "Data Type");
    const tagText = t("xdatahub.ui.app.title.h_ae0a7afece", "Tag");
    return appState.items
        .map((item) => {
            const contentPreview = getRecordContentPreview(item);
            const savedAt = formatDateTime(item.saved_at || "");
            const extraHeader = String(item.extra?.extra_header || "");
            const dataType = String(item.extra?.data_type || "");
            const recordId = String(item.extra?.record_id || "");
            const dbName = String(item.extra?.db_name || "");
            const dbAccent = getDbAccentColor(dbName);
            const rowStyle = ` style="--db-palette:${escapeAttr(dbAccent)}"`;
            const activeClass = String(item.id) === String(selectedId) ? " active" : "";
            let idDbChipHtml = "";
            if (recordId && dbName) {
                idDbChipHtml = `
                    <span class="row-id-db-group">
                        <span class="chip row-id-chip">${escapeHtml(recordId)}</span>
                        <span class="row-id-db-sep" aria-hidden="true"></span>
                        <span class="chip row-db-chip" title="${escapeAttr(dbName)}"><span class="chip-icon chip-icon-db" aria-hidden="true"></span><span class="row-db-chip-text">${escapeHtml(dbName)}</span></span>
                    </span>
                `;
            } else if (recordId) {
                idDbChipHtml = `<span class="chip row-id-chip">${escapeHtml(recordId)}</span>`;
            } else if (dbName) {
                idDbChipHtml = `<span class="chip row-db-chip" title="${escapeAttr(dbName)}"><span class="chip-icon chip-icon-db" aria-hidden="true"></span><span class="row-db-chip-text">${escapeHtml(dbName)}</span></span>`;
            }
            return `
                <div class="row${activeClass}" data-item-id="${escapeHtml(item.id)}"${rowStyle}>
                    <div class="row-id-line">
                        <div class="row-id-chip-wrap">
                            ${idDbChipHtml}
                        </div>
                    </div>
                    <div class="row-content-line">
                        <div class="row-title row-content-text" title="${escapeAttr(contentPreview || noContentText)}">${escapeHtml(contentPreview || noContentText)}</div>
                        <button
                            class="btn row-copy-btn row-copy-btn-inline"
                            type="button"
                            title="${escapeAttr(copyTitleText)}"
                            aria-label="${escapeAttr(copyTitleText)}"
                        >
                            <span class="btn-emoji" aria-hidden="true">${iconMask("send", copyText, "row-copy-icon-mask")}</span>
                            <span class="btn-text row-copy-btn-text">${escapeHtml(copyText)}</span>
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
                                        ? `<span class="chip">${iconSvg("workflow", dataTypeText, "xdatahub-icon chip-icon")} ${escapeHtml(dataType)}</span>`
                                        : ""
                                }
                                ${
                                    extraHeader
                                        ? `<span class="chip row-extra-inline" title="${escapeAttr(extraHeader)}">${iconSvg("tag", tagText, "xdatahub-icon chip-icon")} ${escapeHtml(extraHeader)}</span>`
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
    if (appState.loading || appState.error) {
        return renderStatus();
    }
    const folderText = t("xdatahub.ui.app.text.h_46ecac2910", "Folder");
    const parentFolderText = t(
        "xdatahub.ui.app.media.parent_folder",
        "Back to parent"
    );
    const untitledText = t("xdatahub.ui.app.title.h_8f9548eaa5", "(Untitled)");
    const audioText = t("xdatahub.ui.app.text.h_461189f186", "Audio");
    const tapToPlayText = t("xdatahub.ui.app.media.tap_to_open_player", "Click to preview");
    const sendToNodeText = t(
        "xdatahub.ui.app.media.send_to_node",
        "Send to node"
    );
    const showMediaTitle = appState.settings.showMediaTitle !== false;
    const showResolutionChip =
        appState.settings.showMediaChipResolution !== false;
    const showDatetimeChip =
        appState.settings.showMediaChipDatetime !== false;
    const showSizeChip = appState.settings.showMediaChipSize !== false;
    const lastOpenedMediaId = String(currentTabState().lastOpenedMediaId || "");
    const lastOpenedMediaUrl = String(
        currentTabState().lastOpenedMediaUrl || ""
    );
    const parentPath = isMediaTab(appState.activeTab)
        ? parentMediaDirectoryPath()
        : "";
    const parentCardHtml = isMediaTab(appState.activeTab)
        ? `
            <article class="media-card media-folder-card media-folder-card-parent${parentPath ? "" : " is-disabled"}" ${parentPath ? `data-folder-path="${escapeAttr(parentPath)}"` : ""}>
                <div class="media-thumb media-folder-thumb">
                    <div class="audio-card-hint media-parent-card-hint">
                        <div class="audio-card-icon media-parent-card-icon">${iconMask("folder-up", parentFolderText, "folder-icon-mask-parent")}</div>
                        <div class="audio-card-label media-parent-card-label" title="${escapeAttr(parentFolderText)}">${escapeHtml(parentFolderText)}</div>
                    </div>
                </div>
            </article>
        `
        : "";
    const itemCardsHtml = appState.items
        .map((item) => {
            if (item.kind === "folder" || item.extra?.entry_type === "folder") {
                const folderPath = String(item.path || item.extra?.child_path || "");
                return `
                    <article class="media-card media-folder-card" data-folder-path="${escapeAttr(folderPath)}">
                        <div class="media-thumb media-folder-thumb">
                            <div class="media-folder-thumb-inner">
                                <div class="media-folder-icon">${iconMask("folder", folderText, "folder-icon-mask")}</div>
                                <div class="media-folder-name" title="${escapeAttr(item.title || folderText)}">${escapeHtml(item.title || folderText)}</div>
                            </div>
                        </div>
                    </article>
                `;
            }
            const mediaType = item.extra?.media_type || mediaTypeOfTab(appState.activeTab);
            const mediaItemId = String(item.id || "");
            const fileUrl = item.extra?.file_url || "";
            const mediaRef = String(item.extra?.media_ref || "");
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
                (
                    showResolutionChip
                    && (mediaType === "image" || mediaType === "video")
                )
                    ? 1
                    : 0
            );
            const visibleMetaChipCount = (
                ((showDatetimeChip && savedAt) ? 1 : 0)
                + ((showSizeChip && fileSize) ? 1 : 0)
            );
            const showPrimaryRow = visiblePrimaryChipCount > 0;
            const showMetaRow = visibleMetaChipCount > 0;
            const hasVisibleChips = showPrimaryRow || showMetaRow;
            const showMetaSection = showMediaTitle || hasVisibleChips;
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
            const isVideoUnsupported = (
                mediaType === "video"
                && appState.videoCardStateMap.get(mediaItemId) === "unsupported"
            );
            const isVideoPermissionDenied = (
                mediaType === "video"
                && appState.videoCardStateMap.get(mediaItemId) === "permission"
            );
            const isVideoMissing = (
                mediaType === "video"
                && appState.videoCardStateMap.get(mediaItemId) === "missing"
            );
            const audioLikelyUnsupported = mediaType === "audio"
                ? isLikelyUnsupportedAudio(fileUrl)
                : false;
            const previewAttrs = (
                mediaType === "image"
                || mediaType === "audio"
                || mediaType === "video"
            )
                ? `data-preview-kind="${escapeAttr(mediaType)}" data-preview-url="${escapeAttr(fileUrl)}" data-preview-title="${escapeAttr(item.title || "")}" data-media-ref="${escapeAttr(mediaRef)}"`
                : "";
            const dragAttrs = (
                (mediaType === "video"
                    || mediaType === "audio"
                    || mediaType === "image")
                && mediaFileUrl
                && mediaRef
            )
                ? ` draggable="true" data-drag-media="1" data-drag-media-type="${escapeAttr(mediaType)}" data-drag-title="${escapeAttr(item.title || "")}"`
                : "";
            const resolutionAttr = canShowResolutionChip
                ? ` data-resolution-key="${escapeAttr(resolutionKey)}"`
                : "";
            let previewHtml = "";
            if (mediaType === "image") {
                // 设计说明：图片使用浏览器原生加载，避免历史分批调度在
                // 极端滚动下出现黑块/挂起。这里保持直接 <img src>。
                previewHtml = `<img src="${escapeAttr(fileUrl)}" alt="${escapeAttr(item.title || "image")}" draggable="false">`;
            } else if (mediaType === "video") {
                // 设计说明：视频保持分批调度，先渲染占位，后按队列挂载
                // <video> 以控制首帧解码并发。
                previewHtml = isVideoPermissionDenied
                    ? renderVideoPermissionDeniedHtml()
                    : isVideoMissing
                    ? renderVideoMissingHtml()
                    : isVideoUnsupported
                    ? renderVideoUnsupportedHtml()
                    : renderVideoPlaceholderHtml();
            } else {
                previewHtml = audioLikelyUnsupported
                    ? renderAudioUnsupportedHtml()
                    : `<div class="audio-card-hint"><div class="audio-card-icon">${iconSvg("audio-lines", audioText, "xdatahub-icon audio-icon-svg")}</div><div class="audio-card-label">${escapeHtml(tapToPlayText)}</div></div>`;
            }
            const unsupportedAttr = isVideoUnsupported
                ? ' data-video-unsupported="1"'
                : "";
            const permissionDeniedAttr = isVideoPermissionDenied
                ? ' data-video-permission-denied="1"'
                : "";
            const missingAttr = isVideoMissing
                ? ' data-video-missing="1"'
                : "";
            const audioUnsupportedAttr = (
                mediaType === "audio" && audioLikelyUnsupported
            )
                ? ' data-audio-unsupported="1"'
                : "";
            const sendDisabled = !mediaRef;
            const sendBtnHtml = (
                mediaType === "image"
                || mediaType === "video"
                || mediaType === "audio"
            )
                ? `<button class="media-send-btn ${sendDisabled ? "disabled" : ""}" type="button" data-media-send="1" data-media-send-ref="${escapeAttr(mediaRef)}" data-media-type="${escapeAttr(mediaType)}" data-media-title="${escapeAttr(item.title || "")}" title="${escapeAttr(sendToNodeText)}" aria-label="${escapeAttr(sendToNodeText)}" ${sendDisabled ? "disabled" : ""}>
                        ${iconSvg("send", sendToNodeText, "xdatahub-icon btn-icon")}
                    </button>`
                : "";
            return `
                <article class="media-card${cardActiveClass}" ${previewAttrs}${dragAttrs} data-media-item-id="${escapeAttr(mediaItemId)}" data-media-type="${escapeAttr(mediaType)}"${resolutionAttr}${unsupportedAttr}${permissionDeniedAttr}${missingAttr}${audioUnsupportedAttr}>
                    <div class="media-thumb">${previewHtml}${sendBtnHtml}</div>
                    ${
                        showMetaSection
                            ? `
                        <div class="media-meta">
                            ${
                                showMediaTitle
                                    ? `<div class="${mediaTitleClass}" title="${escapeAttr(item.title || "")}">${escapeHtml(item.title || untitledText)}</div>`
                                    : ""
                            }
                            ${
                                (canShowResolutionChip
                                    || showDatetimeChip
                                    || showSizeChip)
                                    ? `<div class="media-chips">
                                        ${
                                            showPrimaryRow
                                                ? `<div class="media-chip-row media-chip-row-primary">
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
                                                ? `<div class="media-chip-row media-chip-row-meta${showPrimaryRow ? "" : " is-first-row"}">
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
                    `
                            : ""
                    }
                </article>
            `;
        })
        .join("");
    if (!parentCardHtml && !itemCardsHtml) {
        return renderStatus();
    }
    return `${parentCardHtml}${itemCardsHtml}`;
}

function renderSettingsDialog() {
    const draft = cloneSettings(appState.settingsDraft || appState.settings);
    const settingsTitle = t("xdatahub.ui.app.settings.aria_label", "XDataHub Settings");
    const settingsPanel = t("xdatahub.ui.app.settings.panel_title", "Control Panel");
    const cancelText = t("xdatahub.ui.app.common.cancel", "Cancel");
    const savingText = t("xdatahub.ui.app.settings.saving", "Saving");
    const saveText = t("xdatahub.ui.app.aria.h_bb79ec7c15", "Save Settings");
    return `
        <div class="danger-dialog-overlay ${appState.settingsDialogOpen ? "" : "is-hidden"}" id="settings-dialog-overlay">
            <div class="danger-dialog settings-dialog" role="dialog" aria-modal="true" aria-label="${escapeAttr(settingsTitle)}">
                <div class="danger-dialog-title settings-dialog-title">${iconSvg("settings", t("xdatahub.ui.app.settings.title", "Settings"), "xdatahub-icon dialog-title-icon")} ${escapeHtml(settingsPanel)}</div>
                <div class="settings-section">
                    <div class="settings-section-title">${iconSvg("palette", t("xdatahub.ui.app.text.h_9bcf436eac", "Appearance Theme"), "xdatahub-icon chip-icon")} ${escapeHtml(t("xdatahub.ui.app.text.h_9bcf436eac", "Appearance Theme"))}</div>
                    <div class="danger-dialog-input-wrap settings-select-row">
                        <span>${escapeHtml(t("xdatahub.ui.app.settings.theme_mode", "Theme mode:"))}</span>
                        <select id="setting-theme-mode" ${appState.settingsSaving ? "disabled" : ""}>
                            <option value="dark" ${draft.themeMode === "dark" ? "selected" : ""}>${escapeHtml(t("xdatahub.ui.app.settings.theme.dark", "Dark"))}</option>
                            <option value="light" ${draft.themeMode === "light" ? "selected" : ""}>${escapeHtml(t("xdatahub.ui.app.settings.theme.light", "Light"))}</option>
                        </select>
                    </div>
                </div>
                <div class="settings-section">
                    <div class="settings-section-title">${iconSvg("keyboard", t("xdatahub.ui.app.settings.hotkey.title", "Hotkey"), "xdatahub-icon chip-icon")} ${escapeHtml(t("xdatahub.ui.app.settings.hotkey.title", "Hotkey"))}</div>
                    <div class="danger-dialog-input-wrap settings-select-row">
                        <span>${escapeHtml(t("xdatahub.ui.app.settings.hotkey.label", "Toggle hotkey:"))}</span>
                        <input
                            id="setting-hotkey-spec"
                            type="text"
                            value="${escapeAttr(draft.hotkeySpec || DEFAULT_TOGGLE_HOTKEY_SPEC)}"
                            placeholder="${escapeAttr(DEFAULT_TOGGLE_HOTKEY_SPEC)}"
                            spellcheck="false"
                            autocomplete="off"
                            ${appState.settingsSaving ? "disabled" : ""}
                        >
                    </div>
                </div>
                <div class="settings-section">
                    <div class="settings-section-title">${iconSvg("layout-grid", t("xdatahub.ui.app.text.h_638bf44547", "Card Layout"), "xdatahub-icon chip-icon")} ${escapeHtml(t("xdatahub.ui.app.text.h_638bf44547", "Card Layout"))}</div>
                    <div class="danger-dialog-input-wrap settings-select-row">
                        <span>${escapeHtml(t("xdatahub.ui.app.settings.card_size", "Card size:"))}</span>
                        <select id="setting-media-card-size-preset" ${appState.settingsSaving ? "disabled" : ""}>
                            <option value="compact" ${draft.mediaCardSizePreset === "compact" ? "selected" : ""}>${escapeHtml(t("xdatahub.ui.app.settings.card_size.compact", "Compact"))}</option>
                            <option value="standard" ${draft.mediaCardSizePreset === "standard" ? "selected" : ""}>${escapeHtml(t("xdatahub.ui.app.settings.card_size.standard", "Standard"))}</option>
                            <option value="large" ${draft.mediaCardSizePreset === "large" ? "selected" : ""}>${escapeHtml(t("xdatahub.ui.app.settings.card_size.large", "Large"))}</option>
                        </select>
                    </div>
                    <label class="cleanup-all-toggle settings-toggle-row">
                        <input
                            type="checkbox"
                            id="setting-show-media-title"
                            ${draft.showMediaTitle ? "checked" : ""}
                            ${appState.settingsSaving ? "disabled" : ""}
                        >
                        <span>${escapeHtml(t("xdatahub.ui.app.settings.show_media_title", "Show filename"))}</span>
                    </label>
                </div>
                <div class="settings-section">
                    <div class="settings-section-title">${iconSvg("tags", t("xdatahub.ui.app.text.h_52615a7e45", "Card Tag Display"), "xdatahub-icon chip-icon")} ${escapeHtml(t("xdatahub.ui.app.text.h_52615a7e45", "Card Tag Display"))}</div>
                    <label class="cleanup-all-toggle settings-toggle-row">
                        <input
                            type="checkbox"
                            id="setting-show-media-chip-resolution"
                            ${draft.showMediaChipResolution ? "checked" : ""}
                            ${appState.settingsSaving ? "disabled" : ""}
                        >
                        <span>${escapeHtml(t("xdatahub.ui.app.settings.show_chip_resolution", "Show resolution chip (image/video)"))}</span>
                    </label>
                    <label class="cleanup-all-toggle settings-toggle-row">
                        <input
                            type="checkbox"
                            id="setting-show-media-chip-datetime"
                            ${draft.showMediaChipDatetime ? "checked" : ""}
                            ${appState.settingsSaving ? "disabled" : ""}
                        >
                        <span>${escapeHtml(t("xdatahub.ui.app.settings.show_chip_datetime", "Show datetime chip"))}</span>
                    </label>
                    <label class="cleanup-all-toggle settings-toggle-row">
                        <input
                            type="checkbox"
                            id="setting-show-media-chip-size"
                            ${draft.showMediaChipSize ? "checked" : ""}
                            ${appState.settingsSaving ? "disabled" : ""}
                        >
                        <span>${escapeHtml(t("xdatahub.ui.app.settings.show_chip_size", "Show file size chip"))}</span>
                    </label>
                </div>
                <div class="settings-section">
                    <div class="settings-section-title">${iconSvg("audio-lines", t("xdatahub.ui.app.text.h_5cbb6e4131", "Media Playback"), "xdatahub-icon chip-icon")} ${escapeHtml(t("xdatahub.ui.app.text.h_5cbb6e4131", "Media Playback"))}</div>
                    <label class="cleanup-all-toggle settings-toggle-row">
                        <input
                            type="checkbox"
                            id="setting-video-preview-autoplay"
                            ${draft.videoPreviewAutoplay ? "checked" : ""}
                            ${appState.settingsSaving ? "disabled" : ""}
                        >
                        <span>${escapeHtml(t("xdatahub.ui.app.settings.video_autoplay", "Video autoplay"))}</span>
                    </label>
                    <label class="cleanup-all-toggle settings-toggle-row">
                        <input
                            type="checkbox"
                            id="setting-video-preview-muted"
                            ${draft.videoPreviewMuted ? "checked" : ""}
                            ${appState.settingsSaving ? "disabled" : ""}
                        >
                        <span>${escapeHtml(t("xdatahub.ui.app.settings.video_muted", "Video muted"))}</span>
                    </label>
                    <label class="cleanup-all-toggle settings-toggle-row">
                        <input
                            type="checkbox"
                            id="setting-video-preview-loop"
                            ${draft.videoPreviewLoop ? "checked" : ""}
                            ${appState.settingsSaving ? "disabled" : ""}
                        >
                        <span>${escapeHtml(t("xdatahub.ui.app.settings.video_loop", "Video loop"))}</span>
                    </label>
                    <hr class="settings-divider" aria-hidden="true">
                    <label class="cleanup-all-toggle settings-toggle-row">
                        <input
                            type="checkbox"
                            id="setting-audio-preview-autoplay"
                            ${draft.audioPreviewAutoplay ? "checked" : ""}
                            ${appState.settingsSaving ? "disabled" : ""}
                        >
                        <span>${escapeHtml(t("xdatahub.ui.app.settings.audio_autoplay", "Audio autoplay"))}</span>
                    </label>
                    <label class="cleanup-all-toggle settings-toggle-row">
                        <input
                            type="checkbox"
                            id="setting-audio-preview-muted"
                            ${draft.audioPreviewMuted ? "checked" : ""}
                            ${appState.settingsSaving ? "disabled" : ""}
                        >
                        <span>${escapeHtml(t("xdatahub.ui.app.settings.audio_muted", "Audio muted"))}</span>
                    </label>
                    <label class="cleanup-all-toggle settings-toggle-row">
                        <input
                            type="checkbox"
                            id="setting-audio-preview-loop"
                            ${draft.audioPreviewLoop ? "checked" : ""}
                            ${appState.settingsSaving ? "disabled" : ""}
                        >
                        <span>${escapeHtml(t("xdatahub.ui.app.settings.audio_loop", "Audio loop"))}</span>
                    </label>
                </div>
                ${
                    appState.settingsError
                        ? `<div class="status error">${escapeHtml(appState.settingsError)}</div>`
                        : ""
                }
                <div class="danger-dialog-actions">
                    <button class="btn primary" id="settings-dialog-save" title="${escapeAttr(appState.settingsSaving ? savingText : saveText)}" aria-label="${escapeAttr(appState.settingsSaving ? savingText : saveText)}" ${appState.settingsSaving ? "disabled" : ""}>
                        ${
                            appState.settingsSaving
                                ? `${iconSvg("refresh-cw", savingText, "xdatahub-icon btn-icon")} ${escapeHtml(t("xdatahub.ui.app.settings.saving_ellipsis", "Saving..."))}`
                                : `${iconSvg("save", saveText, "xdatahub-icon btn-icon")} ${escapeHtml(saveText)}`
                        }
                    </button>
                    <button class="btn" id="settings-dialog-cancel" title="${escapeAttr(cancelText)}" aria-label="${escapeAttr(cancelText)}" ${appState.settingsSaving ? "disabled" : ""}>${iconSvg("x", cancelText, "xdatahub-icon btn-icon")} ${escapeHtml(cancelText)}</button>
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
    const navBusy = !!appState.mediaNavBusy;
    const canGoBack = !navBusy && state.mediaBackStack.length > 0;
    const canGoForward = !navBusy && state.mediaForwardStack.length > 0;
    const inputFolderText = t("xdatahub.ui.app.aria.h_bc5317f9a4", "input folder");
    const outputFolderText = t("xdatahub.ui.app.aria.h_d3938c2496", "output folder");
    const backText = t("xdatahub.ui.app.aria.h_11d0241540", "Back");
    const forwardText = t("xdatahub.ui.app.aria.h_320ffeefca", "Forward");
    const inputTitle = t("xdatahub.ui.app.aria.h_19e973a912", "Switch to input folder");
    const outputTitle = t("xdatahub.ui.app.aria.h_259396db7f", "Switch to output folder");
    const backTitle = t("xdatahub.ui.app.aria.h_6133ea3cc6", "Back to previous path");
    const forwardTitle = t("xdatahub.ui.app.aria.h_742dbc9cfd", "Forward to next path");
    return `
        <div class="media-explorer-bar">
            <div class="media-root-switch">
                <button class="btn ${rootName === "input" ? "active" : ""}" id="btn-media-root-input" title="${escapeAttr(inputTitle)}" aria-label="${escapeAttr(inputTitle)}" ${navBusy ? "disabled" : ""}>${iconSvg("folder-input", inputFolderText, "xdatahub-icon btn-icon")} ${escapeHtml(inputFolderText)}</button>
                <button class="btn ${rootName === "output" ? "active" : ""}" id="btn-media-root-output" title="${escapeAttr(outputTitle)}" aria-label="${escapeAttr(outputTitle)}" ${navBusy ? "disabled" : ""}>${iconSvg("folder-output", outputFolderText, "xdatahub-icon btn-icon")} ${escapeHtml(outputFolderText)}</button>
            </div>
            <div class="media-path-line">
                <button class="btn" id="btn-media-up" title="${escapeAttr(backTitle)}" aria-label="${escapeAttr(backTitle)}" ${canGoBack ? "" : "disabled"}>${iconSvg("arrow-left", backText, "xdatahub-icon btn-icon")} ${escapeHtml(backText)}</button>
                <button class="btn" id="btn-media-forward" title="${escapeAttr(forwardTitle)}" aria-label="${escapeAttr(forwardTitle)}" ${canGoForward ? "" : "disabled"}>${iconSvg("arrow-right", forwardText, "xdatahub-icon btn-icon")} ${escapeHtml(forwardText)}</button>
                <span class="media-path-text" title="${escapeAttr(fullPath)}">${escapeHtml(fullPath)}</span>
            </div>
        </div>
    `;
}

function renderImagePreview() {
    if (!appState.imagePreview.open) {
        return "";
    }
    const nav = currentPreviewMediaNav();
    const canGoPrev = !!nav.prev;
    const canGoNext = !!nav.next;
    const isImage = appState.imagePreview.kind === "image";
    const isAudio = appState.imagePreview.kind === "audio";
    const isVideo = appState.imagePreview.kind === "video";
    const title = appState.imagePreview.title || (
        isImage
            ? t("xdatahub.ui.app.text.h_feabb054e5", "Image Preview")
            : isVideo
                ? t("xdatahub.ui.app.text.h_6ae2095066", "Video Playback")
                : t("xdatahub.ui.app.text.h_fd897b7598", "Audio Playback")
    );
    const closePreviewText = t("xdatahub.ui.app.aria.h_bf76308794", "Close Preview");
    const fullscreenPreviewText = t(
        "xdatahub.ui.app.aria.h_558f8fc0d4",
        "Fullscreen"
    );
    const exitFullscreenPreviewText = t(
        "xdatahub.ui.app.aria.h_f50dd6f6d4",
        "Exit fullscreen"
    );
    const prevText = t("xdatahub.ui.app.aria.h_b41561d807", "Previous");
    const nextText = t("xdatahub.ui.app.aria.h_67a246a344", "Next");
    const unsupportedText = t("xdatahub.ui.app.common.unsupported", "Unsupported");
    const permissionDeniedTitleText = t(
        "xdatahub.ui.app.media.permission_denied",
        "Permission denied"
    );
    const permissionDeniedDescText = t(
        "xdatahub.api.error.permission_denied",
        "Permission denied"
    );
    const missingTitleText = t(
        "xdatahub.ui.app.media.file_missing",
        "File missing"
    );
    const missingDescText = t(
        "xdatahub.api.error.file_not_found",
        "File not found or moved"
    );
    const unsupportedCodecText = t(
        "xdatahub.ui.app.media.unsupported_format_or_codec",
        "Unsupported format or codec"
    );
    const unsupportedImageDescText = t(
        "xdatahub.ui.app.text.h_bbd61f296e",
        "This image cannot be decoded for display in the current browser."
    );
    const unsupportedAudioDescText = t(
        "xdatahub.ui.app.text.h_b6ec59948c",
        "This audio cannot be decoded for playback in the current browser."
    );
    const unsupportedVideoDescText = t(
        "xdatahub.ui.app.text.h_8463d13571",
        "This video cannot be decoded for playback in the current browser."
    );
    const audioText = t("xdatahub.ui.app.text.h_461189f186", "Audio");
    const sendToNodeText = t(
        "xdatahub.ui.app.media.send_to_node",
        "Send to node"
    );
    const sendMediaRef = String(appState.imagePreview.mediaRef || "");
    const previewMediaType = isVideo ? "video" : isAudio ? "audio" : "image";
    const previewIndexText = nav.index >= 0
        ? `${nav.index + 1} / ${currentPreviewMediaEntries().length}`
        : "";
    const sendButtonHtml = ((isImage || isAudio || isVideo) && sendMediaRef)
        ? `<button class="btn row-copy-btn row-copy-btn-inline image-lightbox-send-btn" type="button" data-media-send="1" data-media-send-ref="${escapeAttr(sendMediaRef)}" data-media-type="${escapeAttr(previewMediaType)}" data-media-title="${escapeAttr(appState.imagePreview.title || "")}" title="${escapeAttr(sendToNodeText)}" aria-label="${escapeAttr(sendToNodeText)}">
                <span class="btn-emoji" aria-hidden="true">${iconMask("send", sendToNodeText, "row-copy-icon-mask")}</span>
                <span class="btn-text row-copy-btn-text">${escapeHtml(sendToNodeText)}</span>
            </button>`
        : "";
    const fullscreenActive = isImage && isImageLightboxFullscreenActive();
    const fullscreenTitleText = fullscreenActive
        ? exitFullscreenPreviewText
        : fullscreenPreviewText;
    const fullscreenButtonHtml = isImage
        ? `<button class="btn image-lightbox-fullscreen-btn" id="image-lightbox-fullscreen-btn" title="${escapeAttr(fullscreenTitleText)}" aria-label="${escapeAttr(fullscreenTitleText)}" aria-pressed="${fullscreenActive ? "true" : "false"}" data-title-fullscreen="${escapeAttr(fullscreenPreviewText)}" data-title-exit-fullscreen="${escapeAttr(exitFullscreenPreviewText)}">${iconSvg(fullscreenActive ? "minimize-2" : "maximize-2", fullscreenTitleText, "xdatahub-icon btn-icon")}</button>`
        : "";
    const navRowHtml = `<div class="image-lightbox-nav-row">
                <div class="image-lightbox-nav-group">
                    <button class="btn image-lightbox-nav-btn" id="image-lightbox-prev-btn" title="${escapeAttr(prevText)}" aria-label="${escapeAttr(prevText)}" ${canGoPrev ? "" : "disabled"}>
                        ${iconSvg("arrow-left", prevText, "xdatahub-icon btn-icon")}
                    </button>
                    <button class="btn image-lightbox-nav-btn" id="image-lightbox-next-btn" title="${escapeAttr(nextText)}" aria-label="${escapeAttr(nextText)}" ${canGoNext ? "" : "disabled"}>
                        ${iconSvg("arrow-right", nextText, "xdatahub-icon btn-icon")}
                    </button>
                </div>
            </div>`;
    const titleRowHtml = `<div class="image-lightbox-title-row">
                <div class="row-content-line image-lightbox-title-line">
                    <div class="row-title row-content-text image-lightbox-title" title="${escapeAttr(title)}">${escapeHtml(title)}</div>
                    ${sendButtonHtml}
                </div>
            </div>`;
    return `
        <div class="image-lightbox" id="image-lightbox">
            <div class="image-lightbox-backdrop" id="image-lightbox-close"></div>
            <div class="image-lightbox-content">
                ${previewIndexText ? `<div class="image-lightbox-index" title="${escapeAttr(previewIndexText)}">${escapeHtml(previewIndexText)}</div>` : ""}
                <div class="image-lightbox-top-actions">
                    ${fullscreenButtonHtml}
                    <button class="btn image-lightbox-close-btn" id="image-lightbox-close-btn" title="${escapeAttr(closePreviewText)}" aria-label="${escapeAttr(closePreviewText)}">${iconSvg("x", closePreviewText, "xdatahub-icon btn-icon")}</button>
                </div>
                ${navRowHtml}
                <div class="image-lightbox-top-divider" aria-hidden="true"></div>
                ${titleRowHtml}
                <div class="image-lightbox-body ${isAudio ? "audio" : isVideo ? "video" : "image"}">
                    ${
                        isImage
                            ? appState.imagePreview.permissionDenied
                                ? `<div class="media-lightbox media-lightbox-image media-lightbox-unsupported">
                        <div class="media-unsupported-panel">
                            <div class="media-unsupported-icon">${iconSvg("triangle-alert", permissionDeniedTitleText, "xdatahub-icon media-loading-icon-svg")}</div>
                            <div class="media-unsupported-title">${escapeHtml(permissionDeniedTitleText)}</div>
                            <div class="media-unsupported-desc">${escapeHtml(appState.imagePreview.permissionDeniedMessage || permissionDeniedDescText)}</div>
                        </div>
                    </div>`
                                : appState.imagePreview.missing
                                ? `<div class="media-lightbox media-lightbox-image media-lightbox-unsupported">
                        <div class="media-unsupported-panel">
                            <div class="media-unsupported-icon">${iconSvg("triangle-alert", missingTitleText, "xdatahub-icon media-loading-icon-svg")}</div>
                            <div class="media-unsupported-title">${escapeHtml(missingTitleText)}</div>
                            <div class="media-unsupported-desc">${escapeHtml(appState.imagePreview.missingMessage || missingDescText)}</div>
                        </div>
                    </div>`
                                : appState.imagePreview.unsupported
                                ? `<div class="media-lightbox media-lightbox-image media-lightbox-unsupported">
                        <div class="media-unsupported-panel">
                            <div class="media-unsupported-icon">${iconSvg("triangle-alert", unsupportedText, "xdatahub-icon media-loading-icon-svg")}</div>
                            <div class="media-unsupported-title">${escapeHtml(unsupportedCodecText)}</div>
                            <div class="media-unsupported-desc">${escapeHtml(appState.imagePreview.unsupportedMessage || unsupportedImageDescText)}</div>
                        </div>
                    </div>`
                                : `<div class="image-lightbox-stage" id="image-lightbox-stage">
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
                            ? appState.imagePreview.permissionDenied
                                ? `<div class="media-lightbox media-lightbox-audio media-lightbox-unsupported">
                        <div class="media-unsupported-panel">
                            <div class="media-unsupported-icon">${iconSvg("triangle-alert", permissionDeniedTitleText, "xdatahub-icon media-loading-icon-svg")}</div>
                            <div class="media-unsupported-title">${escapeHtml(permissionDeniedTitleText)}</div>
                            <div class="media-unsupported-desc">${escapeHtml(appState.imagePreview.permissionDeniedMessage || permissionDeniedDescText)}</div>
                        </div>
                    </div>`
                                : appState.imagePreview.missing
                                ? `<div class="media-lightbox media-lightbox-audio media-lightbox-unsupported">
                        <div class="media-unsupported-panel">
                            <div class="media-unsupported-icon">${iconSvg("triangle-alert", missingTitleText, "xdatahub-icon media-loading-icon-svg")}</div>
                            <div class="media-unsupported-title">${escapeHtml(missingTitleText)}</div>
                            <div class="media-unsupported-desc">${escapeHtml(appState.imagePreview.missingMessage || missingDescText)}</div>
                        </div>
                    </div>`
                                : appState.imagePreview.unsupported
                                ? `<div class="media-lightbox media-lightbox-audio media-lightbox-unsupported">
                        <div class="media-unsupported-panel">
                            <div class="media-unsupported-icon">${iconSvg("triangle-alert", unsupportedText, "xdatahub-icon media-loading-icon-svg")}</div>
                            <div class="media-unsupported-title">${escapeHtml(unsupportedCodecText)}</div>
                            <div class="media-unsupported-desc">${escapeHtml(appState.imagePreview.unsupportedMessage || unsupportedAudioDescText)}</div>
                        </div>
                    </div>`
                                : `<div class="media-lightbox media-lightbox-audio">
                        <div class="audio-lightbox-icon">${iconSvg("audio-lines", audioText, "xdatahub-icon audio-lightbox-icon-svg")}</div>
                        <audio
                            id="audio-lightbox-player"
                            src="${escapeAttr(appState.imagePreview.url)}"
                            controls
                            preload="metadata"
                            ${appState.settings.audioPreviewAutoplay ? "autoplay" : ""}
                            ${appState.settings.audioPreviewMuted ? "muted" : ""}
                            ${appState.settings.audioPreviewLoop ? "loop" : ""}
                        ></audio>
                    </div>`
                            : ""
                    }
                    ${
                        isVideo
                            ? appState.imagePreview.permissionDenied
                                ? `<div class="media-lightbox media-lightbox-video media-lightbox-unsupported">
                        <div class="media-unsupported-panel">
                            <div class="media-unsupported-icon">${iconSvg("triangle-alert", permissionDeniedTitleText, "xdatahub-icon media-loading-icon-svg")}</div>
                            <div class="media-unsupported-title">${escapeHtml(permissionDeniedTitleText)}</div>
                            <div class="media-unsupported-desc">${escapeHtml(appState.imagePreview.permissionDeniedMessage || permissionDeniedDescText)}</div>
                        </div>
                    </div>`
                                : appState.imagePreview.missing
                                ? `<div class="media-lightbox media-lightbox-video media-lightbox-unsupported">
                        <div class="media-unsupported-panel">
                            <div class="media-unsupported-icon">${iconSvg("triangle-alert", missingTitleText, "xdatahub-icon media-loading-icon-svg")}</div>
                            <div class="media-unsupported-title">${escapeHtml(missingTitleText)}</div>
                            <div class="media-unsupported-desc">${escapeHtml(appState.imagePreview.missingMessage || missingDescText)}</div>
                        </div>
                    </div>`
                                : appState.imagePreview.unsupported
                                ? `<div class="media-lightbox media-lightbox-video media-lightbox-unsupported">
                        <div class="media-unsupported-panel">
                            <div class="media-unsupported-icon">${iconSvg("triangle-alert", unsupportedText, "xdatahub-icon media-loading-icon-svg")}</div>
                            <div class="media-unsupported-title">${escapeHtml(unsupportedCodecText)}</div>
                            <div class="media-unsupported-desc">${escapeHtml(appState.imagePreview.unsupportedMessage || unsupportedVideoDescText)}</div>
                        </div>
                    </div>`
                                : `<div class="media-lightbox media-lightbox-video">
                        <video
                            id="video-lightbox-player"
                            src="${escapeAttr(appState.imagePreview.url)}"
                            controls
                            preload="metadata"
                            ${appState.settings.videoPreviewAutoplay ? "autoplay" : ""}
                            ${appState.settings.videoPreviewMuted ? "muted" : ""}
                            ${appState.settings.videoPreviewLoop ? "loop" : ""}
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
        return `<div class="status">${escapeHtml(t("xdatahub.ui.app.status.h_6d2a230190", "No item selected"))}</div>`;
    }
    if (appState.activeTab === "history") {
        return renderHistoryDetail(item);
    }
    const mediaType = item.extra?.media_type || mediaTypeOfTab(appState.activeTab);
    const fileUrl = item.extra?.file_url || "";
    if (mediaType === "image") {
        return `
            <div id="preview-media" class="preview-box">
                <img src="${escapeAttr(fileUrl)}" alt="preview" draggable="false">
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
    const showStructuredText = t("xdatahub.ui.app.aria.h_4d03befc66", "Show Structured");
    const showRawText = t("xdatahub.ui.app.aria.h_ae9642cc6c", "Show Raw");
    const toggleRawText = appState.historyDetailRaw ? showStructuredText : showRawText;
    const copyContentText = t(
        "xdatahub.ui.app.aria.h_3aeb16d4b1",
        "Send Content to Node"
    );
    const copyRecordText = t(
        "xdatahub.ui.app.aria.h_62f853f5ff",
        "Send This Record to Node"
    );
    return `
        <div class="record-detail">
            <div class="record-detail-actions">
                <button class="btn" id="btn-toggle-raw" title="${escapeAttr(toggleRawText)}" aria-label="${escapeAttr(toggleRawText)}">${escapeHtml(toggleRawText)}</button>
                <button class="btn" id="btn-copy-payload" data-copy-target="payload" title="${escapeAttr(copyContentText)}" aria-label="${escapeAttr(copyContentText)}">${escapeHtml(copyContentText)}</button>
                <button class="btn" id="btn-copy-record" data-copy-target="record" title="${escapeAttr(copyRecordText)}" aria-label="${escapeAttr(copyRecordText)}">${escapeHtml(copyRecordText)}</button>
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
    let title = t("xdatahub.ui.app.text.h_0704bf6331", "Dangerous Action Confirmation");
    let message = t(
        "xdatahub.ui.app.text.h_1a176a56fb",
        "This action cannot be undone. Type YES to continue."
    );
    let scopeHtml = "";
    if (dialog.kind === "clear-history") {
        title = t("xdatahub.ui.app.confirm.clear_all_history_title", "Clear History Data");
        const deleteAll = !!dialog.meta?.deleteAll;
        const dbName = String(dialog.meta?.dbName || "").trim();
        const dbOptions = [
            ...new Set([
                ...appState.recordFacets.dbNames,
                dbName,
            ]),
        ].filter(Boolean);
        if (deleteAll || !dbName) {
            message = t(
                "xdatahub.ui.app.confirm.clear_all_history_message",
                "You are about to delete all history records in all databases. This action cannot be undone. Type YES to confirm."
            );
        } else {
            message = t(
                "xdatahub.ui.app.confirm.clear_one_history_message",
                "You are about to delete history records in database {db}. This action cannot be undone. Type YES to confirm.",
                { db: dbName }
            );
        }
        scopeHtml = `
            <div class="danger-dialog-input-wrap">
                <span>${escapeHtml(t("xdatahub.ui.app.dialog.target_database", "Target Database:"))}</span>
                <select id="danger-clear-db-target" ${deleteAll ? "disabled" : ""}>
                    <option value="">${escapeHtml(t("xdatahub.ui.app.dialog.select_database", "Select database"))}</option>
                    ${dbOptions
                        .map((name) => `<option value="${escapeAttr(name)}" ${name === dbName ? "selected" : ""}>${escapeHtml(name)}</option>`)
                        .join("")}
                </select>
                <label class="cleanup-all-toggle">
                    <input id="danger-clear-all" type="checkbox" ${deleteAll ? "checked" : ""}>
                    <span>${escapeHtml(t("xdatahub.ui.app.dialog.delete_all_history", "Delete all history"))}</span>
                </label>
            </div>
        `;
    }
    return `
        <div class="danger-dialog-overlay" id="danger-dialog-overlay">
            <div class="danger-dialog" role="dialog" aria-modal="true" aria-labelledby="danger-dialog-title">
                <div class="danger-dialog-title" id="danger-dialog-title">${iconSvg("triangle-alert", t("xdatahub.ui.app.dialog.warning", "Warning"), "xdatahub-icon dialog-title-icon")} ${escapeHtml(title)}</div>
                <div class="danger-dialog-msg">${escapeHtml(message)}</div>
                ${scopeHtml}
                <div class="danger-dialog-input-wrap">
                    <span>${escapeHtml(t("xdatahub.ui.app.dialog.confirm_phrase", "Confirmation phrase:"))}</span>
                    <input id="danger-dialog-input" autocomplete="off" placeholder="${escapeAttr(t("xdatahub.ui.app.dialog.input_yes_placeholder", "Type YES"))}" value="${escapeAttr(dialog.input)}">
                </div>
                <div class="danger-dialog-actions">
                    <button class="btn danger" id="danger-dialog-confirm" title="${escapeAttr(t("xdatahub.ui.app.common.confirm_delete", "Confirm Delete"))}" aria-label="${escapeAttr(t("xdatahub.ui.app.common.confirm_delete", "Confirm Delete"))}" ${isDangerDialogConfirmed() ? "" : "disabled"}>${escapeHtml(t("xdatahub.ui.app.common.confirm_delete", "Confirm Delete"))}</button>
                    <button class="btn" id="danger-dialog-cancel" title="${escapeAttr(t("xdatahub.ui.app.common.cancel", "Cancel"))}" aria-label="${escapeAttr(t("xdatahub.ui.app.common.cancel", "Cancel"))}">${escapeHtml(t("xdatahub.ui.app.common.cancel", "Cancel"))}</button>
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
    const submitDisabled = isDeleteMode
        ? (!canSubmitDbDelete() || appState.dbDeleteLoading)
        : (!canSubmitRecordsCleanup() || appState.dbDeleteLoading);
    const rows = appState.dbFileList.map((item) => {
        const checked = isDbSelected(item.name) ? "checked" : "";
        const selected = isDbSelected(item.name);
        const critical = isDbCriticalEffective(item);
        const builtin = !!item.is_critical_builtin;
        const locked = critical && !appState.unlockCritical;
        const purposeRaw = String(item.purpose || "").trim();
        const purposeLabel = localizeDbPurposeLabel(purposeRaw);
        const purposeIcon = dbPurposeIconName(purposeRaw || purposeLabel);
        const rowClass = [
            builtin
                ? "critical-builtin"
                : critical
                    ? "critical-user"
                    : "",
            selected ? "selected" : "",
        ].filter(Boolean).join(" ");
        const overrideChecked = !!item.is_critical_user;
        return `
            <div class="db-delete-row ${rowClass}">
                <label class="db-delete-select db-delete-segment db-delete-segment-left">
                    <input type="checkbox" data-db-file-check="${escapeAttr(item.name)}" ${checked} ${locked ? "disabled" : ""}>
                    <span class="db-delete-name" title="${escapeAttr(item.name)}">${escapeHtml(item.name)}</span>
                </label>
                <div class="db-delete-meta db-delete-segment db-delete-segment-middle">
                    <span class="chip">${iconSvg(purposeIcon, purposeLabel, "xdatahub-icon chip-icon")} ${escapeHtml(purposeLabel)}</span>
                    <span class="chip">${escapeHtml(t("xdatahub.ui.app.db.record_count", "{count} records", { count: Number(item.record_count || 0) }))}</span>
                </div>
                ${
                    builtin
                        ? `<span class="db-critical-mark db-delete-segment db-delete-segment-right db-critical-mark-disabled">${escapeHtml(t("xdatahub.ui.app.text.h_aec1dd262b", "Built-in Critical DB"))}</span>`
                        : `<label class="db-critical-mark db-delete-segment db-delete-segment-right">
                            <input type="checkbox" data-db-critical-mark="${escapeAttr(item.name)}" ${overrideChecked ? "checked" : ""}>
                            <span>${escapeHtml(t("xdatahub.ui.app.db.mark_critical", "Mark Critical"))}</span>
                        </label>`
                }
            </div>
        `;
    }).join("");
    return `
        <div class="db-delete-overlay" id="db-delete-overlay">
            <div class="db-delete-dialog" role="dialog" aria-modal="true">
                <div class="db-delete-head">
                    <div class="db-delete-title">${iconSvg("triangle-alert", t("xdatahub.ui.app.dialog.warning", "Warning"), "xdatahub-icon dialog-title-icon")} ${escapeHtml(t("xdatahub.ui.app.db.clear_data", "Clear Data"))}</div>
                    <button class="btn image-lightbox-close-btn db-delete-title-close" id="db-delete-close" title="${escapeAttr(t("xdatahub.ui.app.common.close", "Close"))}" aria-label="${escapeAttr(t("xdatahub.ui.app.common.close", "Close"))}">${iconSvg("x", t("xdatahub.ui.app.common.close", "Close"), "xdatahub-icon btn-icon")}</button>
                </div>
                <div class="db-delete-mode-switch">
                    <button class="btn ${isDeleteMode ? "" : "active"}" id="btn-clear-mode-records" title="${escapeAttr(t("xdatahub.ui.app.db.mode_records_title", "Switch to clear-history mode"))}" aria-label="${escapeAttr(t("xdatahub.ui.app.db.mode_records_title", "Switch to clear-history mode"))}">${iconSvg("database", t("xdatahub.ui.app.db.mode_records", "Clear History"), "xdatahub-icon btn-icon")} ${escapeHtml(t("xdatahub.ui.app.db.mode_records", "Clear History"))}</button>
                    <button class="btn ${isDeleteMode ? "active" : ""}" id="btn-clear-mode-delete" title="${escapeAttr(t("xdatahub.ui.app.db.mode_delete_files_title", "Switch to delete-database-files mode"))}" aria-label="${escapeAttr(t("xdatahub.ui.app.db.mode_delete_files_title", "Switch to delete-database-files mode"))}">${iconSvg("trash-2", t("xdatahub.ui.app.db.mode_delete_files", "Delete Database Files"), "xdatahub-icon btn-icon")} ${escapeHtml(t("xdatahub.ui.app.db.mode_delete_files", "Delete Database Files"))}</button>
                </div>
                <div class="db-delete-desc">${escapeHtml(t("xdatahub.ui.app.db.desc", "Select databases to process. Critical databases are protected by default. This action cannot be undone."))}</div>
                <div class="db-delete-tools">
                    <button class="btn" id="btn-db-select-all" title="${escapeAttr(t("xdatahub.ui.app.aria.h_819c78323a", "Select all database files"))}" aria-label="${escapeAttr(t("xdatahub.ui.app.aria.h_819c78323a", "Select all database files"))}">${iconSvg("check", t("xdatahub.ui.app.aria.h_3e44b2a933", "Select All"), "xdatahub-icon btn-icon")} ${escapeHtml(t("xdatahub.ui.app.aria.h_3e44b2a933", "Select All"))}</button>
                    <button class="btn" id="btn-db-clear-selection" title="${escapeAttr(t("xdatahub.ui.app.db.clear_selected_files", "Clear selected database files"))}" aria-label="${escapeAttr(t("xdatahub.ui.app.db.clear_selected_files", "Clear selected database files"))}">${iconSvg("x", t("xdatahub.ui.app.db.clear_selection", "Clear Selection"), "xdatahub-icon btn-icon")} ${escapeHtml(t("xdatahub.ui.app.db.clear_selection", "Clear Selection"))}</button>
                    <button class="btn" id="btn-db-refresh-list" title="${escapeAttr(t("xdatahub.ui.app.aria.h_630c2252df", "Refresh database list"))}" aria-label="${escapeAttr(t("xdatahub.ui.app.aria.h_630c2252df", "Refresh database list"))}" ${refreshLocked || appState.dbDeleteLoading || appState.dbRefreshInFlight ? "disabled" : ""}>${iconSvg("refresh-cw", t("xdatahub.ui.app.text.h_38108eaa1d", "Refresh"), "xdatahub-icon btn-icon")} ${escapeHtml(t("xdatahub.ui.app.text.h_38108eaa1d", "Refresh"))}</button>
                </div>
                <div class="db-delete-list">
                    ${rows || `<div class="status">${escapeHtml(t("xdatahub.ui.app.status.h_e38b7aec78", "No database files"))}</div>`}
                </div>
                <div class="db-delete-summary">${
                    isDeleteMode
                        ? t("xdatahub.ui.app.db.summary_delete_with_critical", "Will delete {selected} files (critical: {critical})", { selected: selectedCount, critical: criticalCount })
                        : t("xdatahub.ui.app.db.summary_clear_with_critical", "Will clear history in {selected} databases (critical: {critical})", { selected: selectedCount, critical: criticalCount })
                }</div>
                <div class="db-delete-confirm-hint">${renderDbDeleteConfirmHint()}</div>
                <div class="db-delete-confirm-row">
                    <span>${escapeHtml(t("xdatahub.ui.app.dialog.confirm_phrase", "Confirmation phrase:"))}</span>
                    <input id="db-delete-confirm-yes" value="${escapeAttr(appState.confirmYes)}" autocomplete="off">
                </div>
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
                    <label class="db-delete-unlock db-delete-unlock-bottom">
                        <input type="checkbox" id="db-delete-unlock-critical" ${appState.unlockCritical ? "" : "checked"}>
                        <span>${escapeHtml(t("xdatahub.ui.app.db.lock_critical", "Lock critical databases"))}</span>
                    </label>
                    <button class="btn danger" id="db-delete-submit" title="${escapeAttr(isDeleteMode ? t("xdatahub.ui.app.db.submit_confirm_delete_short", "Confirm Delete") : t("xdatahub.ui.app.db.submit_confirm_clear_short", "Confirm Clear"))}" aria-label="${escapeAttr(isDeleteMode ? t("xdatahub.ui.app.db.submit_confirm_delete_short", "Confirm Delete") : t("xdatahub.ui.app.db.submit_confirm_clear_short", "Confirm Clear"))}" ${submitDisabled ? "disabled" : ""}>
                        ${
                            appState.dbDeleteLoading
                                ? `${iconSvg("refresh-cw", isDeleteMode ? t("xdatahub.ui.app.db.deleting", "Deleting") : t("xdatahub.ui.app.db.clearing", "Clearing"), "xdatahub-icon btn-icon")} ${isDeleteMode ? t("xdatahub.ui.app.db.deleting_ellipsis", "Deleting...") : t("xdatahub.ui.app.db.clearing_ellipsis", "Clearing...")}`
                                : `${iconSvg("triangle-alert", isDeleteMode ? t("xdatahub.ui.app.db.submit_confirm_delete_short", "Confirm Delete") : t("xdatahub.ui.app.db.submit_confirm_clear_short", "Confirm Clear"), "xdatahub-icon btn-icon")} ${isDeleteMode ? t("xdatahub.ui.app.db.submit_confirm_delete_short", "Confirm Delete") : t("xdatahub.ui.app.db.submit_confirm_clear_short", "Confirm Clear")}`
                        }
                    </button>
                    <button class="btn" id="db-delete-cancel" title="${escapeAttr(t("xdatahub.ui.app.common.cancel", "Cancel"))}" aria-label="${escapeAttr(t("xdatahub.ui.app.common.cancel", "Cancel"))}">${iconSvg("x", t("xdatahub.ui.app.common.cancel", "Cancel"), "xdatahub-icon btn-icon")} ${escapeHtml(t("xdatahub.ui.app.common.cancel", "Cancel"))}</button>
                </div>
            </div>
        </div>
    `;
}

function renderStatus() {
    if (appState.loading) {
        return `<div class="status">${escapeHtml(t("xdatahub.ui.app.status.h_514c33af5c", "Loading..."))}</div>`;
    }
    if (appState.error) {
        return `<div class="status error">${escapeHtml(appState.error)}</div>`;
    }
    if (appState.items.length === 0) {
        return `<div class="status">${escapeHtml(t("xdatahub.ui.app.status.h_56016b8700", "No data"))}</div>`;
    }
    return "";
}

function renderLocaleSwitcher() {
    const switchText = t("xdatahub.ui.app.locale.switch", "Switch Language");
    return `
        <div class="locale-switcher">
            <button
                class="btn locale-switcher-toggle"
                id="btn-locale-switch"
                title="${escapeAttr(switchText)}"
                aria-label="${escapeAttr(switchText)}"
                aria-expanded="${appState.localeSwitcherOpen ? "true" : "false"}"
            >
                ${iconSvg("languages", switchText, "xdatahub-icon btn-icon")}
            </button>
        </div>
    `;
}

function renderLocaleSwitcherOverlay() {
    if (!appState.localeSwitcherOpen) {
        return "";
    }
    const pending = appState.localeSelectionPending;
    const zhActive = !pending && appState.localePreviewLang === "zh";
    const enActive = !pending && appState.localePreviewLang === "en";
    const confirmText = t(
        "xdatahub.ui.app.aria.h_bb79ec7c15",
        "Save Settings"
    );
    const cancelText = t("xdatahub.ui.app.common.cancel", "Cancel");
    // NOTE: Keep "中文" label in English UI intentionally; do not "fix" to "Chinese".
    const zhDisplayLabel = appState.localePreviewLang === "en"
        ? "中文"
        : t("xdatahub.ui.app.locale.zh", "Chinese");
    return `
        <div class="locale-switcher-overlay" id="locale-switcher-overlay">
            <div
                class="locale-switcher-dialog"
                role="dialog"
                aria-modal="true"
                aria-label="${escapeAttr(t("xdatahub.ui.app.locale.select_title", "Select Language"))}"
            >
                <div class="locale-switcher-title">${iconSvg("languages", t("xdatahub.ui.app.locale.select_title", "Select Language"), "xdatahub-icon chip-icon")} ${escapeHtml(t("xdatahub.ui.app.locale.select_title", "Select Language"))}</div>
                <button
                    class="btn locale-option${zhActive ? " active" : ""}"
                    id="btn-locale-option-zh"
                    title="${escapeAttr(t("xdatahub.ui.app.locale.zh", "Chinese"))}"
                    aria-label="${escapeAttr(t("xdatahub.ui.app.locale.zh", "Chinese"))}"
                    role="menuitemradio"
                    aria-checked="${zhActive ? "true" : "false"}"
                >
                    🇨🇳 ${escapeHtml(zhDisplayLabel)}
                </button>
                <button
                    class="btn locale-option${enActive ? " active" : ""}"
                    id="btn-locale-option-en"
                    title="${escapeAttr(t("xdatahub.ui.app.locale.en", "English"))}"
                    aria-label="${escapeAttr(t("xdatahub.ui.app.locale.en", "English"))}"
                    role="menuitemradio"
                    aria-checked="${enActive ? "true" : "false"}"
                >
                    🇺🇸 ${escapeHtml(t("xdatahub.ui.app.locale.en", "English"))}
                </button>
                <div class="locale-switcher-actions">
                    <button class="btn primary" id="btn-locale-confirm" type="button">${iconSvg("save", confirmText, "xdatahub-icon btn-icon")} ${escapeHtml(confirmText)}</button>
                    <button class="btn" id="btn-locale-cancel" type="button">${iconSvg("x", cancelText, "xdatahub-icon btn-icon")} ${escapeHtml(cancelText)}</button>
                </div>
            </div>
        </div>
    `;
}

function renderHistoryLayout() {
    const state = currentTabState();
    const pageInputWidthCh = getPaginationInputWidthCh(
        state.page,
        appState.totalPages
    );
    const displayedTotalPages = formatDisplayedTotalPages(appState.totalPages);
    const prevText = t("xdatahub.ui.app.aria.h_b41561d807", "Prev");
    const nextText = t("xdatahub.ui.app.aria.h_67a246a344", "Next");
    const pageJumpText = t("xdatahub.ui.app.pagination.jump", "Jump to page");
    return `
        <div class="panel list-panel history-list-panel collapsed-fill" style="width:100%">
            <div class="list" id="list" data-list-tab="history">${renderListRows()}${renderStatus()}</div>
            <div class="pagination">
                <div class="pagination-main-left">
                    <div class="pagination-page-editor">
                        <input id="page-jump" type="text" inputmode="numeric" pattern="[0-9]*" min="1" max="${appState.totalPages}" value="${state.page}" aria-label="${escapeAttr(pageJumpText)}" title="${escapeAttr(pageJumpText)}" style="width:${pageInputWidthCh}ch;">
                        <span class="pagination-page-total">/ <span id="page-total" title="${escapeAttr(String(appState.totalPages))}">${displayedTotalPages}</span></span>
                    </div>
                </div>
                <div class="pagination-main-center">
                    <button class="btn" id="page-prev" title="${escapeAttr(prevText)}" aria-label="${escapeAttr(prevText)}" ${state.page <= 1 ? "disabled" : ""}>${iconSvg("arrow-left", prevText, "xdatahub-icon btn-icon")} ${escapeHtml(prevText)}</button>
                    <button class="btn" id="page-next" title="${escapeAttr(nextText)}" aria-label="${escapeAttr(nextText)}" ${state.page >= appState.totalPages ? "disabled" : ""}>${iconSvg("arrow-right", nextText, "xdatahub-icon btn-icon")} ${escapeHtml(nextText)}</button>
                </div>
                <div class="pagination-main-right">
                    <div class="pagination-locale-anchor">${renderLocaleSwitcher()}</div>
                </div>
            </div>
        </div>
    `;
}

function syncTopActionBarUi() {
    const bar = document.querySelector(".top-action-bar");
    if (!(bar instanceof HTMLElement)) {
        render();
        return;
    }
    bar.outerHTML = renderTopActionBar();
    updateTopActionBarCompactMode();
    scheduleTopActionBarCompactUpdate();
    syncDocumentLocaleMeta();
}

function getLockBannerText() {
    const stateLabel = getLocalizedLockStateLabel(appState.lockState.state);
    const key = appState.lockState.interrupt_requested
        ? "xdatahub.ui.app.lock.readonly_interrupt_requested"
        : "xdatahub.ui.app.lock.readonly_with_state";
    const fallback = appState.lockState.interrupt_requested
        ? (
            "Stop requested, waiting for active tasks to finish "
            + "(state: {state}, active: {count})"
        )
        : "Read-only while running (state: {state}, active: {count})";
    return t(key, fallback, {
        state: stateLabel,
        count: appState.lockState.queue_remaining,
    });
}

function syncLockBannerUi() {
    const banner = document.querySelector(".lock-banner");
    if (!(banner instanceof HTMLElement)) {
        render();
        return;
    }
    banner.classList.toggle("show", !!appState.lockState.readonly);
    banner.textContent = getLockBannerText();
}

function renderShell() {
    const tab = appState.activeTab;
    const state = currentTabState();
    const pageInputWidthCh = getPaginationInputWidthCh(
        state.page,
        appState.totalPages
    );
    const displayedTotalPages = formatDisplayedTotalPages(appState.totalPages);
    const readonly = appState.lockState.readonly;
    const showLock = readonly ? "show" : "";
    const mediaView = isMediaTab(tab);
    const sidebarOpen = !!appState.filtersSidebarOpen;
    const mediaCardSizePreset = normalizeMediaCardSizePreset(
        appState.settings.mediaCardSizePreset
    );
    return `
        <div class="lock-banner ${showLock}">
            ${escapeHtml(getLockBannerText())}
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
                    <div class="media-grid" id="list" data-list-tab="${tab}">${renderMediaGrid()}</div>
                    <div class="pagination">
                        <div class="pagination-main-left">
                            <div class="pagination-page-editor">
                                <input id="page-jump" type="text" inputmode="numeric" pattern="[0-9]*" min="1" max="${appState.totalPages}" value="${state.page}" aria-label="${escapeAttr(t("xdatahub.ui.app.pagination.jump", "Jump to page"))}" title="${escapeAttr(t("xdatahub.ui.app.pagination.jump", "Jump to page"))}" style="width:${pageInputWidthCh}ch;">
                                <span class="pagination-page-total">/ <span id="page-total" title="${escapeAttr(String(appState.totalPages))}">${displayedTotalPages}</span></span>
                            </div>
                        </div>
                        <div class="pagination-main-center">
                            <button class="btn" id="page-prev" title="${escapeAttr(t("xdatahub.ui.app.aria.h_b41561d807", "Prev"))}" aria-label="${escapeAttr(t("xdatahub.ui.app.aria.h_b41561d807", "Prev"))}" ${state.page <= 1 ? "disabled" : ""}>${iconSvg("arrow-left", t("xdatahub.ui.app.aria.h_b41561d807", "Prev"), "xdatahub-icon btn-icon")} ${escapeHtml(t("xdatahub.ui.app.aria.h_b41561d807", "Prev"))}</button>
                            <button class="btn" id="page-next" title="${escapeAttr(t("xdatahub.ui.app.aria.h_67a246a344", "Next"))}" aria-label="${escapeAttr(t("xdatahub.ui.app.aria.h_67a246a344", "Next"))}" ${state.page >= appState.totalPages ? "disabled" : ""}>${iconSvg("arrow-right", t("xdatahub.ui.app.aria.h_67a246a344", "Next"), "xdatahub-icon btn-icon")} ${escapeHtml(t("xdatahub.ui.app.aria.h_67a246a344", "Next"))}</button>
                        </div>
                        <div class="pagination-main-right">
                            <div class="pagination-locale-anchor">${renderLocaleSwitcher()}</div>
                        </div>
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
    `;
}

function syncOverlayById(id, html) {
    const existing = document.getElementById(id);
    if (!html) {
        existing?.remove();
        return;
    }
    if (existing instanceof HTMLElement) {
        existing.outerHTML = html;
    } else if (root) {
        root.insertAdjacentHTML("beforeend", html);
    }
}

function renderNodeSendDialog() {
    if (!appState.nodeSendDialogOpen) {
        return "";
    }
    const titleText = t(
        "xdatahub.ui.app.media.send_dialog_title",
        "Send to node"
    );
    const targetClass = String(appState.nodeSendTargetClass || "XImageGet");
    const hintHtml = renderNodeSendTargetHint(targetClass);
    const loadingText = t(
        "xdatahub.ui.app.media.send_dialog_loading",
        "Loading nodes..."
    );
    const emptyHtml = renderNodeSendTargetEmpty(targetClass);
    const sortLabelText = t(
        "xdatahub.ui.app.media.send_dialog_sort",
        "Sort by"
    );
    const sortIdText = t(
        "xdatahub.ui.app.media.send_dialog_sort_seq",
        "Sequence"
    );
    const sortNameText = t(
        "xdatahub.ui.app.media.send_dialog_sort_name",
        "Name"
    );
    const refreshNodesText = t(
        "xdatahub.ui.app.media.send_dialog_refresh",
        "Refresh node list"
    );
    const closeAfterSendText = t(
        "xdatahub.ui.app.media.send_dialog_close_after_send",
        "Close window after send"
    );
    const slideSendText = t(
        "xdatahub.ui.app.media.send_dialog_slide",
        "Slide to send"
    );
    const confirmText = t(
        "xdatahub.ui.app.common.confirm",
        "Confirm"
    );
    const confirmSendText = t(
        "xdatahub.ui.app.media.send_dialog_confirm_send",
        "Send to selected nodes"
    );
    const sendingText = t(
        "xdatahub.ui.app.media.send_dialog_sending",
        "Sending..."
    );
    const cancelText = t("xdatahub.ui.app.common.cancel", "Cancel");
    const closeText = t("xdatahub.ui.shell.btn.close", "Close");
    const nodes = appState.nodeSendNodes || [];
    const hasNodes = nodes.length > 0;
    const sortDisabled = (
        !hasNodes
        || appState.nodeSendLoading
        || !!appState.nodeSendError
        || appState.nodeSendSending
    );
    const subtitle = appState.nodeSendTitle
        ? `<div class="node-send-file-block">
                <div class="node-send-subtitle" title="${escapeAttr(appState.nodeSendTitle)}">${escapeHtml(appState.nodeSendTitle)}</div>
            </div>`
        : "";
    const errorText = appState.nodeSendError;
    let bodyHtml = "";
    const sortKey = appState.nodeSendSortKey === "name" ? "name" : "id";
    const sortDir = appState.nodeSendSortDir === "desc" ? "desc" : "asc";
    const sortArrow = sortDir === "asc" ? "↑" : "↓";
    const selectedIds = new Set(
        (appState.nodeSendSelectedIds || []).map((id) => String(id))
    );
    const selectedSummaryText = getNodeSendSummaryText();
    const selectedSummaryTitle = appState.nodeSendLastFailureMessage
        || selectedSummaryText;
    const closeToggleHtml = `
            <label class="node-send-close-toggle">
                <input
                    type="checkbox"
                    id="node-send-close-after-send"
                    ${appState.settings.nodeSendCloseAfterSend !== false ? "checked" : ""}
                    ${appState.settingsSaving || appState.nodeSendSending ? "disabled" : ""}
                >
                <span>${escapeHtml(closeAfterSendText)}</span>
            </label>
        `;
    const sortBarHtml = `
            <div class="node-send-sort">
                <span class="node-send-sort-label">${escapeHtml(sortLabelText)}</span>
                <button class="btn node-send-sort-btn ${sortKey === "id" ? "active" : ""}" data-node-send-sort="id" title="${escapeAttr(sortIdText)}" aria-label="${escapeAttr(sortIdText)}" ${sortDisabled ? "disabled" : ""}>
                    ${escapeHtml(sortIdText)}${sortKey === "id" ? ` ${sortArrow}` : ""}
                </button>
                <button class="btn node-send-sort-btn ${sortKey === "name" ? "active" : ""}" data-node-send-sort="name" title="${escapeAttr(sortNameText)}" aria-label="${escapeAttr(sortNameText)}" ${sortDisabled ? "disabled" : ""}>
                    ${escapeHtml(sortNameText)}${sortKey === "name" ? ` ${sortArrow}` : ""}
                </button>
                <button class="btn node-send-sort-btn node-send-refresh-btn" id="node-send-refresh" title="${escapeAttr(refreshNodesText)}" aria-label="${escapeAttr(refreshNodesText)}" ${appState.nodeSendLoading || appState.nodeSendSending ? "disabled" : ""}>
                    ${iconSvg("refresh-cw", refreshNodesText, "xdatahub-icon btn-icon")}
                    ${escapeHtml(refreshNodesText)}
                </button>
            </div>
        `;
    const buildNodeSendToolbar = (hintMarkup, hintClass = "") => `
            <div class="node-send-toolbar">
                <div class="node-send-toolbar-top">
                    <div class="node-send-hint${hintClass}">${hintMarkup}</div>
                    ${closeToggleHtml}
                </div>
                ${sortBarHtml}
            </div>
        `;
    if (appState.nodeSendLoading) {
        bodyHtml = buildNodeSendToolbar(escapeHtml(loadingText));
    } else if (errorText) {
        bodyHtml = buildNodeSendToolbar(
            escapeHtml(errorText),
            " is-error"
        );
    } else if (!nodes.length) {
        bodyHtml = buildNodeSendToolbar(emptyHtml);
    } else {
        const sortedNodes = [...nodes].sort((a, b) => {
            if (sortKey === "name") {
                const aName = String(a?.title || "").toLowerCase();
                const bName = String(b?.title || "").toLowerCase();
                if (aName !== bName) {
                    return sortDir === "asc"
                        ? aName.localeCompare(bName)
                        : bName.localeCompare(aName);
                }
            }
            const aId = Number(a?.id);
            const bId = Number(b?.id);
            if (Number.isFinite(aId) && Number.isFinite(bId)) {
                return sortDir === "asc" ? aId - bId : bId - aId;
            }
            return sortDir === "asc"
                ? String(a?.id || "").localeCompare(String(b?.id || ""))
                : String(b?.id || "").localeCompare(String(a?.id || ""));
        });
        const rows = sortedNodes.map((item) => {
            const nodeId = Number.isFinite(Number(item.id))
                ? String(item.id)
                : "--";
            const nodeTitle = String(item.title || targetClass);
            const label = `${nodeTitle} #${nodeId}`;
            const accent = resolveNodeAccentColor(item);
            const rowStyle = ` style="--node-palette:${escapeAttr(accent)}"`;
            const checked = selectedIds.has(String(item.id));
            return `
                <button class="btn node-send-option ${checked ? "active" : ""}" data-node-send-id="${escapeAttr(item.id)}" aria-pressed="${checked ? "true" : "false"}"${rowStyle} title="${escapeAttr(label)}" aria-label="${escapeAttr(label)}">
                    <span class="node-send-name" title="${escapeAttr(nodeTitle)}">${escapeHtml(nodeTitle)}</span>
                    <span class="node-send-meta-row">
                        <span class="node-send-seq-wrap">
                            <span class="node-send-seq">
                                <span class="node-send-seq-chip">${escapeHtml(nodeId)}</span>
                                <span class="node-send-swatch" aria-hidden="true"></span>
                            </span>
                            <span class="node-send-check" title="${checked ? escapeAttr(confirmText) : ""}">${checked ? iconSvg("check", confirmText, "xdatahub-icon node-send-check-icon") : ""}</span>
                        </span>
                        <span class="node-send-quick" data-node-send-slide data-node-send-slide-id="${escapeAttr(item.id)}" title="${escapeAttr(slideSendText)}" aria-label="${escapeAttr(slideSendText)}">
                            <span class="node-send-quick-track">
                                <span class="node-send-quick-label" data-node-send-slide-label>${escapeHtml(slideSendText)}</span>
                                <span class="node-send-quick-handle" aria-hidden="true">${iconSvg("send", slideSendText, "xdatahub-icon")}</span>
                            </span>
                        </span>
                    </span>
                </button>
            `;
        }).join("");
        bodyHtml = `
            ${buildNodeSendToolbar(hintHtml)}
            <div class="node-send-list">${rows}</div>
        `;
    }
    const submitDisabled = (
        appState.nodeSendLoading
        || !!appState.nodeSendError
        || !selectedIds.size
        || appState.nodeSendSending
    );
    return `
        <div class="node-send-overlay" id="node-send-overlay">
            <div class="node-send-dialog" role="dialog" aria-modal="true" aria-label="${escapeAttr(titleText)}">
                <div class="node-send-title">
                    <div class="node-send-title-text">${iconSvg("send", titleText, "xdatahub-icon dialog-title-icon")} ${escapeHtml(titleText)}</div>
                    <button class="btn node-send-title-close" id="node-send-close" title="${escapeAttr(closeText)}" aria-label="${escapeAttr(closeText)}" ${appState.nodeSendSending ? "disabled" : ""}>${iconSvg("x", closeText, "xdatahub-icon btn-icon")}</button>
                </div>
                ${subtitle}
                <div class="node-send-body">${bodyHtml}</div>
                <div class="node-send-actions">
                    <div class="node-send-actions-selected" title="${escapeAttr(selectedSummaryTitle)}">${escapeHtml(selectedSummaryText)}</div>
                    <button class="btn primary" id="node-send-confirm" title="${escapeAttr(appState.nodeSendSending ? sendingText : confirmSendText)}" aria-label="${escapeAttr(appState.nodeSendSending ? sendingText : confirmSendText)}" ${submitDisabled ? "disabled" : ""}>${
                        appState.nodeSendSending
                            ? `${iconSvg("refresh-cw", sendingText, "xdatahub-icon btn-icon")} ${escapeHtml(sendingText)}`
                            : `${iconSvg("send", confirmSendText, "xdatahub-icon btn-icon")} ${escapeHtml(confirmSendText)}`
                    }</button>
                    <button class="btn" id="node-send-cancel" title="${escapeAttr(cancelText)}" aria-label="${escapeAttr(cancelText)}" ${appState.nodeSendSending ? "disabled" : ""}>${iconSvg("x", cancelText, "xdatahub-icon btn-icon")} ${escapeHtml(cancelText)}</button>
                </div>
            </div>
        </div>
    `;
}

function renderOverlays() {
    syncOverlayById("image-lightbox", renderImagePreview());
    syncOverlayById("danger-dialog-overlay", renderDangerDialog());
    syncOverlayById("db-delete-overlay", renderDbDeleteDialog());
    syncOverlayById("settings-dialog-overlay", renderSettingsDialog());
    syncOverlayById("node-send-overlay", renderNodeSendDialog());
    syncOverlayById("locale-switcher-overlay", renderLocaleSwitcherOverlay());
}

function syncLocaleSwitcherUi() {
    const toggleBtn = document.getElementById("btn-locale-switch");
    if (toggleBtn instanceof HTMLButtonElement) {
        toggleBtn.setAttribute(
            "aria-expanded",
            appState.localeSwitcherOpen ? "true" : "false"
        );
    }
    syncOverlayById("locale-switcher-overlay", renderLocaleSwitcherOverlay());
    syncDocumentLocaleMeta();
}

function openLocaleSwitcher() {
    appState.localeSelectionOriginal = appState.localePreviewLang;
    appState.localeSwitcherOpen = true;
    syncLocaleSwitcherUi();
}

function closeLocaleSwitcher(confirmed) {
    appState.localeSwitcherOpen = false;
    if (!confirmed && appState.localeSelectionOriginal) {
        appState.localePreviewLang = appState.localeSelectionOriginal;
        syncDocumentLocaleMeta();
        window.parent?.postMessage?.({
            type: "xdatahub:ui-locale",
            locale: appState.localePreviewLang,
        }, "*");
    }
    syncLocaleSwitcherUi();
}

// 渲染策略（强约束）：
// 1) 常规交互默认禁止直接整页 render()。
// 2) 优先调用局部同步函数（topbar/list/overlay/detail/lock banner）。
// 3) 只有结构变更或关键节点缺失时，才允许整页 render() 兜底。
function render() {
    if (!root) {
        return;
    }
    renderCount += 1;
    window.__XDATAHUB_RENDER_COUNT = renderCount;
    if (window.__XDATAHUB_DEBUG_RENDER === true) {
        console.count("[xdatahub] render()");
    }
    const listBefore = document.getElementById("list");
    if (listBefore && getListTabId(listBefore) === appState.activeTab) {
        syncListScroll(true);
    }
    const focusState = captureFocusState();
    root.innerHTML = renderShell();
    renderOverlays();
    syncDocumentLocaleMeta();

    bindEvents();
    if (appState.imagePreview.open) {
        bindImageLightboxEvents();
        setupImagePreviewEvents();
        syncImagePreviewTransform();
    }
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

function handleDelegatedMediaFolderClick(event) {
    const card = event.target?.closest?.(".media-folder-card[data-folder-path]");
    if (!(card instanceof HTMLElement)) {
        return false;
    }
    if (!isMediaTab(appState.activeTab)) {
        return false;
    }
    const folderPath = card.getAttribute("data-folder-path") || "";
    if (!folderPath) {
        return true;
    }
    navigateMediaDirectory(folderPath, { cause: "data-change" });
    return true;
}

function openDatePickerInput(input) {
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
}

function handleDelegatedFacetToggleClick(event) {
    const button = event.target?.closest?.("[data-facet-toggle]");
    if (!(button instanceof HTMLElement)) {
        return false;
    }
    const fieldId = button.getAttribute("data-facet-toggle") || "";
    if (!fieldId) {
        return true;
    }
    const isOpen = appState.facetDropdown.open
        && appState.facetDropdown.fieldId === fieldId;
    if (isOpen) {
        closeFacetDropdown(true);
        return true;
    }
    openFacetDropdown(fieldId);
    render();
    return true;
}

function handleDelegatedFacetOptionClick(event) {
    const button = event.target?.closest?.("[data-facet-option]");
    if (!(button instanceof HTMLElement)) {
        return false;
    }
    const fieldId = button.getAttribute("data-facet-option") || "";
    const value = button.getAttribute("data-facet-value") || "";
    const input = document.getElementById(fieldId);
    if (!(input instanceof HTMLInputElement)) {
        return true;
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
    return true;
}

function handleDelegatedDatePickerButtonClick(event) {
    const button = event.target?.closest?.(".date-picker-btn");
    if (!(button instanceof HTMLElement)) {
        return false;
    }
    const targetId = button.getAttribute("data-picker-target");
    if (!targetId) {
        return true;
    }
    openDatePickerInput(document.getElementById(targetId));
    return true;
}

function handleDelegatedDateInputClick(event) {
    const input = event.target?.closest?.("#filter-start, #filter-end");
    if (!(input instanceof HTMLInputElement)) {
        return false;
    }
    openDatePickerInput(input);
    return true;
}

function handleDelegatedDateInputKeydown(event) {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) {
        return false;
    }
    if (target.id !== "filter-start" && target.id !== "filter-end") {
        return false;
    }
    if (event.key !== "Enter" && event.key !== " ") {
        return false;
    }
    event.preventDefault();
    openDatePickerInput(target);
    return true;
}

function applyFiltersFromUi() {
    if (isSearchLocked()) {
        return;
    }
    scheduleSearchReload();
}

async function runActionButtonAsync(fn, errorText, useDataActionLock = false) {
    if (useDataActionLock && isDataActionLocked()) {
        return;
    }
    let hasError = false;
    try {
        if (useDataActionLock) {
            appState.dataActionInFlight = true;
            // 仅刷新顶部动作区，避免整页重绘。
            syncTopActionBarUi();
        }
        closeCompactActionsMenu(false);
        const actionDone = await fn();
        if (useDataActionLock && actionDone !== false) {
            lockDataActions();
        }
    } catch (error) {
        hasError = true;
        setError(error.message || errorText);
    } finally {
        if (useDataActionLock) {
            appState.dataActionInFlight = false;
        }
        if (hasError) {
            render();
            return;
        }
        if (useDataActionLock) {
            syncTopActionBarUi();
        }
    }
}

function openSettingsDialogFromAction() {
    closeCompactActionsMenu(false);
    closeDateRangePanel(false);
    const compactBackdrop = document.getElementById("compact-actions-backdrop");
    compactBackdrop?.remove();
    const dateBackdrop = document.getElementById("date-range-backdrop");
    dateBackdrop?.classList.remove("show");
    appState.settingsDialogOpen = true;
    appState.settingsError = "";
    appState.settingsDraft = cloneSettings(appState.settings);
    const overlay = document.getElementById("settings-dialog-overlay");
    overlay?.classList.remove("is-hidden");
    syncSettingsDialogControlsFromDraft();
}

function syncSettingsDialogControlsFromDraft() {
    const draft = cloneSettings(appState.settingsDraft || appState.settings);
    const syncCheckbox = (id, value) => {
        const input = document.getElementById(id);
        if (input instanceof HTMLInputElement) {
            input.checked = !!value;
        }
    };
    const syncSelect = (id, value) => {
        const select = document.getElementById(id);
        if (select instanceof HTMLSelectElement && typeof value === "string") {
            select.value = value;
        }
    };
    const syncText = (id, value) => {
        const input = document.getElementById(id);
        if (input instanceof HTMLInputElement) {
            input.value = String(value || "");
        }
    };
    syncText("setting-hotkey-spec", draft.hotkeySpec || DEFAULT_TOGGLE_HOTKEY_SPEC);
    syncSelect("setting-theme-mode", normalizeThemeMode(draft.themeMode));
    syncSelect(
        "setting-media-card-size-preset",
        normalizeMediaCardSizePreset(draft.mediaCardSizePreset)
    );
    syncCheckbox("setting-show-media-title", draft.showMediaTitle);
    syncCheckbox(
        "setting-show-media-chip-resolution",
        draft.showMediaChipResolution
    );
    syncCheckbox(
        "setting-show-media-chip-datetime",
        draft.showMediaChipDatetime
    );
    syncCheckbox("setting-show-media-chip-size", draft.showMediaChipSize);
    syncCheckbox("setting-video-preview-autoplay", draft.videoPreviewAutoplay);
    syncCheckbox("setting-video-preview-muted", draft.videoPreviewMuted);
    syncCheckbox("setting-video-preview-loop", draft.videoPreviewLoop);
    syncCheckbox("setting-audio-preview-autoplay", draft.audioPreviewAutoplay);
    syncCheckbox("setting-audio-preview-muted", draft.audioPreviewMuted);
    syncCheckbox("setting-audio-preview-loop", draft.audioPreviewLoop);
}

function syncFiltersSidebarUi() {
    const workspace = document.querySelector(".workspace");
    const sidebarOpen = !!appState.filtersSidebarOpen;
    if (workspace instanceof HTMLElement) {
        workspace.classList.toggle("filters-expanded", sidebarOpen);
        workspace.classList.toggle("filters-collapsed", !sidebarOpen);
    }
    const button = document.getElementById("btn-toggle-filters-sidebar");
    button?.classList.toggle("active", sidebarOpen);
}

async function handleDelegatedPrimaryButtonClick(event) {
    const button = event.target?.closest?.("button[id]");
    if (!(button instanceof HTMLButtonElement)) {
        return false;
    }
    const buttonRect = button.getBoundingClientRect();
    const buttonId = button.id;
    if (!buttonId) {
        return false;
    }
    switch (buttonId) {
    case "btn-refresh-inline":
        await runActionButtonAsync(
            doRefresh,
            t("xdatahub.ui.app.error.refresh_failed", "Refresh Failed"),
            true
        );
        return true;
    case "btn-clean-invalid":
        await runActionButtonAsync(
            doCleanupInvalid,
            t("xdatahub.ui.app.error.cleanup_failed", "Cleanup Failed"),
            true
        );
        return true;
    case "btn-clear-index":
        await runActionButtonAsync(
            doClearIndex,
            t("xdatahub.ui.app.error.rebuild_failed", "Rebuild Failed"),
            true
        );
        return true;
    case "btn-clear-data":
        await runActionButtonAsync(
            doClearRecords,
            t("xdatahub.ui.app.error.data_process_failed", "Data processing failed"),
            true
        );
        return true;
    case "btn-open-settings":
        openSettingsDialogFromAction();
        return true;
    case "btn-toggle-compact-actions":
        appState.dateRangePanelOpen = false;
        appState.compactActionsMenuOpen = !appState.compactActionsMenuOpen;
        setDateRangePanelOpen(false, false);
        syncCompactActionsUi();
        return true;
    case "btn-toggle-date-range":
        appState.compactActionsMenuOpen = false;
        setDateRangePanelOpen(!appState.dateRangePanelOpen, false);
        return true;
    case "btn-media-root-output": {
        if (!isMediaTab(appState.activeTab)) {
            return true;
        }
        switchMediaRootDirectory("output");
        return true;
    }
    case "btn-media-root-input": {
        if (!isMediaTab(appState.activeTab)) {
            return true;
        }
        switchMediaRootDirectory("input");
        return true;
    }
    case "btn-media-up": {
        if (!isMediaTab(appState.activeTab)) {
            return true;
        }
        moveMediaHistory(-1);
        return true;
    }
    case "btn-media-forward": {
        if (!isMediaTab(appState.activeTab)) {
            return true;
        }
        moveMediaHistory(1);
        return true;
    }
    case "page-prev":
        changePage(currentTabState().page - 1);
        return true;
    case "page-next":
        changePage(currentTabState().page + 1);
        return true;
    case "btn-locale-switch":
        if (appState.localeSwitcherOpen) {
            closeLocaleSwitcher(false);
            return true;
        }
        openLocaleSwitcher();
        return true;
    case "btn-locale-option-zh":
        appState.localePreviewLang = "zh";
        appState.settings.uiLocale = "zh";
        appState.localeSelectionPending = false;
        window.parent?.postMessage?.({
            type: "xdatahub:ui-locale",
            locale: "zh",
        }, "*");
        syncLocaleSwitcherUi();
        return true;
    case "btn-locale-option-en":
        appState.localePreviewLang = "en";
        appState.settings.uiLocale = "en";
        appState.localeSelectionPending = false;
        window.parent?.postMessage?.({
            type: "xdatahub:ui-locale",
            locale: "en",
        }, "*");
        syncLocaleSwitcherUi();
        return true;
    case "btn-locale-cancel":
        closeLocaleSwitcher(false);
        return true;
    case "btn-locale-confirm": {
        const locale = appState.localePreviewLang || "en";
        appState.settings.uiLocale = locale;
        appState.localeSelectionPending = false;
        closeLocaleSwitcher(true);
        void updateSettings({ uiLocale: locale });
        return true;
    }
    case "btn-toggle-filters-sidebar":
        appState.filtersSidebarOpen = !appState.filtersSidebarOpen;
        saveGlobalFiltersSidebarState();
        render();
        return true;
    case "btn-apply-filters":
        flashButton(button);
        applyFiltersFromUi();
        return true;
    case "btn-toggle-raw":
        flashButton(button);
        appState.historyDetailRaw = !appState.historyDetailRaw;
        syncHistoryDetailRawUi();
        return true;
    case "btn-copy-payload":
    case "btn-copy-record":
        await handleCopyButton(button);
        return true;
    case "settings-dialog-cancel":
        restoreThemeFromSavedSettings();
        restoreMediaCardSizeFromSavedSettings();
        appState.settingsDialogOpen = false;
        appState.settingsDraft = null;
        document.getElementById("settings-dialog-overlay")
            ?.classList.add("is-hidden");
        return true;
    case "settings-dialog-save": {
        const draft = cloneSettings(appState.settingsDraft || appState.settings);
        const hotkeySpec = String(
            draft.hotkeySpec || DEFAULT_TOGGLE_HOTKEY_SPEC
        ).trim();
        if (!parseHotkeySpec(hotkeySpec)) {
            appState.settingsError = t(
                "xdatahub.ui.app.settings.hotkey.invalid",
                "Invalid hotkey format"
            );
            refreshSettingsDialogOverlay();
            return true;
        }
        const hotkeyResult = await requestParentHotkeyUpdate(hotkeySpec);
        if (!hotkeyResult.ok) {
            appState.settingsError = hotkeyResult.error || t(
                "xdatahub.ui.app.settings.hotkey.update_failed",
                "Failed to update hotkey"
            );
            refreshSettingsDialogOverlay();
            return true;
        }
        draft.hotkeySpec = hotkeyResult.hotkeySpec || hotkeySpec;
        appState.settings.hotkeySpec = draft.hotkeySpec;
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
                renderOverlays();
            }
        } else {
            restoreThemeFromSavedSettings();
            restoreMediaCardSizeFromSavedSettings();
        }
        return true;
    }
    case "btn-media-sort-cycle": {
        const currentBy = normalizeMediaSortBy(appState.settings.mediaSortBy);
        const currentOrder = normalizeMediaSortOrder(
            appState.settings.mediaSortOrder
        );
        const next = nextMediaSortCombo(currentBy, currentOrder);
        await applyMediaSortSettings(next.by, next.order);
        return true;
    }
    case "btn-history-sort-cycle": {
        if (appState.activeTab !== "history") {
            return true;
        }
        const state = currentTabState();
        const current = normalizeHistorySortOrder(state.historySortOrder);
        state.historySortOrder = current === "desc" ? "asc" : "desc";
        state.page = 1;
        saveTabState("history");
        await loadList();
        return true;
    }
    case "danger-dialog-cancel":
        closeDangerConfirm(false);
        return true;
    case "danger-dialog-confirm":
        if (isDangerDialogConfirmed()) {
            closeDangerConfirm(true);
        }
        return true;
    case "db-delete-close":
    case "db-delete-cancel":
        closeDbDeleteDialog();
        return true;
    case "btn-clear-mode-records":
        appState.clearDataMode = "records";
        appState.dbDeleteError = "";
        appState.dbDeleteResult = "";
        appState.confirmYes = "";
        refreshDbDeleteDialogOverlay();
        return true;
    case "btn-clear-mode-delete":
        appState.clearDataMode = "delete";
        appState.dbDeleteError = "";
        appState.dbDeleteResult = "";
        appState.confirmYes = "";
        refreshDbDeleteDialogOverlay();
        return true;
    case "btn-db-select-all": {
        const selected = appState.dbFileList
            .filter((item) => {
                if (!isDbCriticalEffective(item)) {
                    return true;
                }
                return appState.unlockCritical;
            })
            .map((item) => item.name);
        appState.selectedDbFiles = selected;
        root?.querySelectorAll("[data-db-file-check]").forEach((el) => {
            if (!(el instanceof HTMLInputElement)) {
                return;
            }
            const name = el.getAttribute("data-db-file-check") || "";
            el.checked = isDbSelected(name);
        });
        syncDbDeleteSelectionUi();
        return true;
    }
    case "btn-db-clear-selection":
        appState.selectedDbFiles = [];
        root?.querySelectorAll("[data-db-file-check]").forEach((el) => {
            if (el instanceof HTMLInputElement) {
                el.checked = false;
            }
        });
        syncDbDeleteSelectionUi();
        return true;
    case "btn-db-refresh-list":
        if (!isDbRefreshLocked()) {
            scheduleDbListRefresh();
        }
        return true;
    case "db-delete-submit":
        if (appState.clearDataMode === "delete") {
            await submitDbDelete();
        } else {
            await submitRecordsCleanup();
        }
        return true;
    default:
        return false;
    }
}

function handleDelegatedOverlayBackdropClick(event) {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
        return false;
    }
    if (target.id === "settings-dialog-overlay") {
        restoreThemeFromSavedSettings();
        restoreMediaCardSizeFromSavedSettings();
        appState.settingsDialogOpen = false;
        appState.settingsDraft = null;
        target.classList.add("is-hidden");
        return true;
    }
    if (target.id === "danger-dialog-overlay") {
        closeDangerConfirm(false);
        return true;
    }
    if (target.id === "db-delete-overlay") {
        closeDbDeleteDialog();
        return true;
    }
    if (target.id === "node-send-overlay") {
        closeNodeSendDialog();
        return true;
    }
    if (target.id === "compact-actions-backdrop") {
        closeCompactActionsMenu(true);
        return true;
    }
    if (target.id === "date-range-backdrop") {
        closeDateRangePanel(false);
        return true;
    }
    return false;
}

async function handleDelegatedHistoryRowCopy(event) {
    const button = event.target?.closest?.(".row-copy-btn");
    if (!(button instanceof HTMLElement)) {
        return false;
    }
    if (isMediaTab(appState.activeTab)) {
        return false;
    }
    event.preventDefault();
    event.stopPropagation();
    const row = button.closest("[data-item-id]");
    const itemId = String(row?.getAttribute("data-item-id") || "");
    const item = appState.items.find(
        (entry) => String(entry?.id || "") === itemId
    );
    if (!item) {
        return true;
    }
    const payloadInfo = normalizePayloadValue(item?.extra?.payload);
    const text = buildPayloadCopyText(payloadInfo);
    if (!String(text || "").trim()) {
        setCopyNotice(
            t("xdatahub.ui.app.text.h_3286eb7260", "Nothing to send"),
            true
        );
        return true;
    }
    openNodeSendDialog("", resolveTextSendTitle(item), "text", text);
    flashButton(button);
    return true;
}

function handleDelegatedHistoryRowSelect(event) {
    const row = event.target?.closest?.("[data-item-id]");
    if (!(row instanceof HTMLElement)) {
        return false;
    }
    if (isMediaTab(appState.activeTab)) {
        return false;
    }
    const itemId = row.dataset.itemId || "";
    currentTabState().selectedId = itemId;
    saveTabState(appState.activeTab);
    const item = appState.items.find((entry) => entry.id === itemId);
    if (item) {
        appState.selectedItemCache.set(appState.activeTab, item);
    }
    clearDetailResources();
    if (!syncHistorySelectionUi()) {
        render();
    }
    return true;
}

function handleDelegatedMediaCardClick(event) {
    const card = event.target?.closest?.(".media-card[data-preview-url]");
    if (!(card instanceof HTMLElement)) {
        return false;
    }
    if (!isMediaTab(appState.activeTab)) {
        return false;
    }
    if (event.target?.closest?.(".media-folder-card")) {
        return false;
    }
    const mediaItemId = String(
        card.getAttribute("data-media-item-id") || ""
    ).trim();
    const previewUrl = String(
        card.getAttribute("data-preview-url") || ""
    );
    if (mediaItemId) {
        const state = currentTabState();
        state.lastOpenedMediaId = mediaItemId;
        state.lastOpenedMediaUrl = previewUrl;
        saveTabState(appState.activeTab);
    }
    updateLastOpenedMediaCardClass(card);
    const kind = card.getAttribute("data-preview-kind") || "image";
    const title = card.getAttribute("data-preview-title") || "";
    const unsupported = (
        kind === "video"
        && card.getAttribute("data-video-unsupported") === "1"
    );
    const permissionDenied = (
        (kind === "video" && card.getAttribute("data-video-permission-denied") === "1")
        || (kind === "image" && card.getAttribute("data-image-permission-denied") === "1")
        || (kind === "audio" && card.getAttribute("data-audio-permission-denied") === "1")
    );
    const imageUnsupported = (
        kind === "image"
        && card.getAttribute("data-image-unsupported") === "1"
    );
    const audioUnsupported = (
        kind === "audio"
        && (
            card.getAttribute("data-audio-unsupported") === "1"
            || isLikelyUnsupportedAudio(previewUrl)
        )
    );
    const missing = (
        (kind === "video" && card.getAttribute("data-video-missing") === "1")
        || (kind === "image" && card.getAttribute("data-image-missing") === "1")
        || (kind === "audio" && card.getAttribute("data-audio-missing") === "1")
    );
    requestAnimationFrame(() => {
        const mediaRef = String(
            card.getAttribute("data-media-ref") || ""
        );
        openImagePreview(kind, previewUrl, title, {
            missing,
            missingMessage: missing
                ? t(
                    "xdatahub.api.error.file_not_found",
                    "File not found or moved"
                )
                : "",
            permissionDenied,
            permissionDeniedMessage: permissionDenied
                ? t(
                    "xdatahub.api.error.permission_denied",
                    "Permission denied"
                )
                    : "",
            unsupported: unsupported || audioUnsupported || imageUnsupported,
            unsupportedMessage: unsupported
                ? t(
                    "xdatahub.ui.app.media.unsupported_video_codec",
                    "This video format or codec is not supported in the current browser, or the file contains audio track only."
                )
                : audioUnsupported
                    ? t(
                        "xdatahub.ui.app.media.unsupported_audio_codec",
                        "This audio format or codec is not supported in the current browser."
                    )
                    : imageUnsupported
                        ? t(
                            "xdatahub.ui.app.media.unsupported_image_codec",
                            "This image format or codec is not supported in the current browser."
                        )
                    : "",
            mediaRef,
            mediaItemId,
        });
    });
    return true;
}

async function handleDelegatedMediaSend(event) {
    const button = event.target?.closest?.("[data-media-send='1']");
    if (!(button instanceof HTMLElement)) {
        return false;
    }
    if (!isMediaTab(appState.activeTab)) {
        return false;
    }
    event.preventDefault();
    event.stopPropagation();
    const mediaRef = String(button.getAttribute("data-media-send-ref") || "");
    if (!mediaRef) {
        return true;
    }
    const title = String(button.getAttribute("data-media-title") || "");
    const mediaType = String(
        button.getAttribute("data-media-type") || ""
    ).toLowerCase();
    openNodeSendDialog(mediaRef, title, mediaType);
    flashButton(button);
    return true;
}

function handleDelegatedMediaSendProximity(event) {
    const target = event.target;
    if (!(target instanceof Element)) {
        return;
    }
    const card = target.closest(".media-card");
    if (!(card instanceof HTMLElement)) {
        return;
    }
    if (!isMediaTab(appState.activeTab)) {
        return;
    }
    const button = card.querySelector(".media-send-btn");
    if (!(button instanceof HTMLElement)) {
        return;
    }
    if (button.hasAttribute("disabled")) {
        return;
    }
    mediaSendProximityPayload = {
        button,
        x: event.clientX,
        y: event.clientY,
    };
    if (mediaSendProximityRaf) {
        return;
    }
    mediaSendProximityRaf = requestAnimationFrame(() => {
        mediaSendProximityRaf = 0;
        const payload = mediaSendProximityPayload;
        mediaSendProximityPayload = null;
        if (!payload) {
            return;
        }
        applyMediaSendProximity(
            payload.button,
            payload.x,
            payload.y
        );
    });
}

function handleDelegatedMediaSendProximityOut(event) {
    const target = event.target;
    if (!(target instanceof Element)) {
        return;
    }
    const card = target.closest(".media-card");
    if (!(card instanceof HTMLElement)) {
        return;
    }
    const related = event.relatedTarget;
    if (related instanceof Node && card.contains(related)) {
        return;
    }
    resetMediaSendProximity(card);
}

function applyMediaSendProximity(button, x, y) {
    const card = button.closest(".media-card");
    if (!(card instanceof HTMLElement)) {
        return;
    }
    const cardRect = card.getBoundingClientRect();
    const rect = button.getBoundingClientRect();
    const dx = x < rect.left
        ? rect.left - x
        : x > rect.right
            ? x - rect.right
            : 0;
    const dy = y < rect.top
        ? rect.top - y
        : y > rect.bottom
            ? y - rect.bottom
            : 0;
    const distance = Math.sqrt((dx * dx) + (dy * dy));
    const maxDistance = Math.max(rect.height * 6, 120);
    const raw = 1 - (distance / maxDistance);
    const clamped = Math.min(1, Math.max(0, raw));
    const minOpacity = 0.15;
    const baseOpacity = minOpacity + ((1 - minOpacity) * clamped);
    const fadeLimit = cardRect.top + (cardRect.height * 0.95);
    const fadeRange = cardRect.height * 0.95;
    const verticalRaw = fadeRange > 0
        ? 1 - ((y - cardRect.top) / fadeRange)
        : 0;
    const verticalClamped = Math.min(1, Math.max(0, verticalRaw));
    const verticalFactor = Math.min(
        1,
        Math.pow(verticalClamped, 0.35) * 1.4
    );
    const opacity = baseOpacity * verticalFactor;
    button.style.setProperty("--send-proximity", opacity.toFixed(3));
}

function resetMediaSendProximity(card) {
    const button = card.querySelector(".media-send-btn");
    if (!(button instanceof HTMLElement)) {
        return;
    }
    button.style.removeProperty("--send-proximity");
}

function handleDelegatedNodeSend(event) {
    const slideArea = event.target?.closest?.("[data-node-send-slide]");
    if (slideArea instanceof HTMLElement) {
        return true;
    }
    const closeBtn = event.target?.closest?.("#node-send-close");
    if (closeBtn instanceof HTMLElement) {
        if (appState.nodeSendSending) {
            return true;
        }
        closeNodeSendDialog();
        return true;
    }
    const refreshBtn = event.target?.closest?.("#node-send-refresh");
    if (refreshBtn instanceof HTMLElement) {
        if (appState.nodeSendLoading || appState.nodeSendSending) {
            return true;
        }
        refreshNodeSendTargets();
        return true;
    }
    const cancelBtn = event.target?.closest?.("#node-send-cancel");
    if (cancelBtn instanceof HTMLElement) {
        if (appState.nodeSendSending) {
            return true;
        }
        closeNodeSendDialog();
        return true;
    }
    const confirmBtn = event.target?.closest?.("#node-send-confirm");
    if (confirmBtn instanceof HTMLElement) {
        const selectedIds = (appState.nodeSendSelectedIds || [])
            .map((id) => Number(id))
            .filter((id) => Number.isFinite(id));
        submitNodeSend(selectedIds);
        return true;
    }
    const option = event.target?.closest?.("[data-node-send-id]");
    if (!(option instanceof HTMLElement)) {
        return false;
    }
    if (
        appState.nodeSendLoading
        || appState.nodeSendError
        || appState.nodeSendSending
    ) {
        return true;
    }
    const nodeIdText = String(
        option.getAttribute("data-node-send-id") || ""
    );
    const nodeId = Number(nodeIdText);
    if (!Number.isFinite(nodeId)) {
        return true;
    }
    const selected = new Set(
        (appState.nodeSendSelectedIds || []).map((id) => String(id))
    );
    if (selected.has(nodeIdText)) {
        selected.delete(nodeIdText);
    } else {
        selected.add(nodeIdText);
    }
    resetNodeSendResultState();
    appState.nodeSendSelectedIds = Array.from(selected);
    if (!syncNodeSendSelectionUi()) {
        refreshNodeSendDialogOverlay();
    }
    return true;
}

function handleDelegatedNodeSendSort(event) {
    const button = event.target?.closest?.("[data-node-send-sort]");
    if (!(button instanceof HTMLElement)) {
        return false;
    }
    const key = String(button.getAttribute("data-node-send-sort") || "");
    if (key !== "id" && key !== "name") {
        return true;
    }
    if (appState.nodeSendSortKey === key) {
        appState.nodeSendSortDir = appState.nodeSendSortDir === "desc"
            ? "asc"
            : "desc";
    } else {
        appState.nodeSendSortKey = key;
        appState.nodeSendSortDir = "asc";
    }
    refreshNodeSendDialogOverlay();
    return true;
}

function handleDelegatedMediaCardDragstart(event) {
    const card = event.target?.closest?.(".media-card[data-drag-media='1']");
    if (!(card instanceof HTMLElement)) {
        event.preventDefault();
        return;
    }
    if (!isMediaTab(appState.activeTab)) {
        event.preventDefault();
        return;
    }
    const dataTransfer = event.dataTransfer;
    if (!dataTransfer) {
        event.preventDefault();
        return;
    }
    const mediaRef = String(card.getAttribute("data-media-ref") || "").trim();
    const mediaType = String(
        card.getAttribute("data-drag-media-type") || ""
    ).toLowerCase();
    if (!mediaRef) {
        event.preventDefault();
        return;
    }
    const title = String(
        card.getAttribute("data-drag-title")
        || (mediaType === "audio"
            ? "audio"
            : mediaType === "video"
                ? "video"
                : "image")
    );
    dataTransfer.effectAllowed = "copy";
    try {
        dataTransfer.setData(
            XDATAHUB_MEDIA_MIME,
            JSON.stringify({
                source: "xdatahub",
                media_ref: mediaRef,
                media_type: mediaType,
                title,
            })
        );
    } catch {}
}

function handleDelegatedDbFileCheckChange(event) {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) {
        return false;
    }
    if (!target.matches("[data-db-file-check]")) {
        return false;
    }
    const name = target.getAttribute("data-db-file-check") || "";
    toggleDbFileSelected(name);
    syncDbDeleteSelectionUi();
    return true;
}

async function handleDelegatedDbCriticalMarkChange(event) {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) {
        return false;
    }
    if (!target.matches("[data-db-critical-mark]")) {
        return false;
    }
    const name = target.getAttribute("data-db-critical-mark") || "";
    appState.dbDeleteError = "";
    try {
        await toggleCriticalOverride(name, target.checked);
        await fetchDbFileList();
        reconcileSelectedDbFiles();
        reconcileLockedCriticalSelections();
    } catch (error) {
        appState.dbDeleteError = error.message || t(
            "xdatahub.ui.app.error.update_critical_mark_failed",
            "Failed to update critical mark"
        );
    }
    refreshDbDeleteDialogOverlay();
    return true;
}

function handleDelegatedGlobalInput(event) {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)
        && !(target instanceof HTMLSelectElement)) {
        return false;
    }
    switch (target.id) {
    case "page-jump":
        target.value = target.value.replace(/\D+/g, "");
        debouncedJumpPage(target.value);
        return true;
    case "filter-keyword":
        currentTabState().filters.keyword = target.value;
        target.title = target.value;
        saveTabState(appState.activeTab);
        return true;
    case "filter-data-type":
        currentTabState().filters.dataType = target.value;
        target.title = target.value;
        saveTabState(appState.activeTab);
        refreshDependentWarnings();
        return true;
    case "filter-source":
        currentTabState().filters.source = target.value;
        target.title = target.value;
        saveTabState(appState.activeTab);
        refreshDependentWarnings();
        return true;
    case "filter-db-name":
        currentTabState().filters.dbName = target.value;
        target.title = target.value;
        saveTabState(appState.activeTab);
        debouncedScopedFacetReload(target.value);
        refreshDependentWarnings();
        return true;
    case "filter-start":
        currentTabState().filters.start = target.value;
        target.title = target.value;
        saveTabState(appState.activeTab);
        updateDateRangeToggleVisual();
        return true;
    case "filter-end":
        currentTabState().filters.end = target.value;
        target.title = target.value;
        saveTabState(appState.activeTab);
        updateDateRangeToggleVisual();
        return true;
    case "danger-dialog-input": {
        appState.dangerDialog.input = target.value;
        const confirmBtn = document.getElementById("danger-dialog-confirm");
        if (confirmBtn instanceof HTMLButtonElement) {
            confirmBtn.disabled = !isDangerDialogConfirmed();
        }
        return true;
    }
    case "db-delete-confirm-yes": {
        appState.confirmYes = target.value;
        updateDbDeleteSubmitUi(document.getElementById("db-delete-submit"));
        return true;
    }
    case "node-send-close-after-send":
        if (target instanceof HTMLInputElement) {
            appState.settings.nodeSendCloseAfterSend = !!target.checked;
            void updateSettings({
                nodeSendCloseAfterSend: !!target.checked,
            });
        }
        return true;
    default:
        return false;
    }
}

function ensureSettingsDraftState() {
    if (!appState.settingsDraft) {
        appState.settingsDraft = cloneSettings(appState.settings);
    }
}

function handleFacetFocusIn(event) {
    if (!appState.facetDropdown.open) {
        return;
    }
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
        return;
    }
    if (
        target.closest(".facet-menu")
        || target.closest(".facet-input-shell")
        || target.closest(".facet-toggle-btn")
    ) {
        return;
    }
    closeFacetDropdown(true);
}

function handleFacetWindowBlur() {
    if (appState.facetDropdown.open) {
        closeFacetDropdown(true);
    }
}

function handleFacetPointerDown(event) {
    if (!appState.facetDropdown.open) {
        return;
    }
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
        return;
    }
    if (
        target.closest(".facet-menu")
        || target.closest(".facet-input-shell")
        || target.closest(".facet-toggle-btn")
    ) {
        return;
    }
    closeFacetDropdown(true);
}

function applySettingsThemePreview(mode) {
    const normalized = normalizeThemeMode(mode);
    applyThemeMode(normalized);
    notifyParentThemeMode(normalized);
}

function restoreThemeFromSavedSettings() {
    applySettingsThemePreview(appState.settings?.themeMode);
}

function applyMediaCardSizePreview(preset) {
    if (!isMediaTab(appState.activeTab)) {
        return;
    }
    const normalized = normalizeMediaCardSizePreset(preset);
    const panel = root?.querySelector?.(".media-grid-panel");
    if (!(panel instanceof HTMLElement)) {
        return;
    }
    panel.classList.remove(
        "media-card-size-compact",
        "media-card-size-standard",
        "media-card-size-large"
    );
    panel.classList.add(`media-card-size-${normalized}`);
}

function restoreMediaCardSizeFromSavedSettings() {
    applyMediaCardSizePreview(appState.settings?.mediaCardSizePreset);
}

function handleDelegatedGlobalChange(event) {
    const target = event.target;
    if (
        !(target instanceof HTMLInputElement)
        && !(target instanceof HTMLSelectElement)
    ) {
        return false;
    }
    switch (target.id) {
    case "setting-hotkey-spec":
        ensureSettingsDraftState();
        appState.settingsDraft.hotkeySpec = String(target.value || "");
        return true;
    case "setting-show-media-title":
        ensureSettingsDraftState();
        appState.settingsDraft.showMediaTitle = !!target.checked;
        return true;
    case "setting-show-media-chip-resolution":
        ensureSettingsDraftState();
        appState.settingsDraft.showMediaChipResolution = !!target.checked;
        return true;
    case "setting-show-media-chip-datetime":
        ensureSettingsDraftState();
        appState.settingsDraft.showMediaChipDatetime = !!target.checked;
        return true;
    case "setting-show-media-chip-size":
        ensureSettingsDraftState();
        appState.settingsDraft.showMediaChipSize = !!target.checked;
        return true;
    case "setting-video-preview-autoplay":
        ensureSettingsDraftState();
        appState.settingsDraft.videoPreviewAutoplay = !!target.checked;
        return true;
    case "setting-video-preview-muted":
        ensureSettingsDraftState();
        appState.settingsDraft.videoPreviewMuted = !!target.checked;
        return true;
    case "setting-video-preview-loop":
        ensureSettingsDraftState();
        appState.settingsDraft.videoPreviewLoop = !!target.checked;
        return true;
    case "setting-audio-preview-autoplay":
        ensureSettingsDraftState();
        appState.settingsDraft.audioPreviewAutoplay = !!target.checked;
        return true;
    case "setting-audio-preview-muted":
        ensureSettingsDraftState();
        appState.settingsDraft.audioPreviewMuted = !!target.checked;
        return true;
    case "setting-audio-preview-loop":
        ensureSettingsDraftState();
        appState.settingsDraft.audioPreviewLoop = !!target.checked;
        return true;
    case "setting-media-card-size-preset":
        if (target instanceof HTMLSelectElement) {
            ensureSettingsDraftState();
            appState.settingsDraft.mediaCardSizePreset =
                normalizeMediaCardSizePreset(target.value);
            applyMediaCardSizePreview(appState.settingsDraft.mediaCardSizePreset);
        }
        return true;
    case "setting-theme-mode":
        if (target instanceof HTMLSelectElement) {
            ensureSettingsDraftState();
            appState.settingsDraft.themeMode = normalizeThemeMode(target.value);
            applySettingsThemePreview(appState.settingsDraft.themeMode);
        }
        return true;
    case "danger-clear-db-target":
        if (target instanceof HTMLSelectElement) {
            appState.dangerDialog.meta = {
                ...appState.dangerDialog.meta,
                dbName: target.value,
            };
            currentTabState().cleanupDbName = target.value;
            saveTabState(appState.activeTab);
            const confirmBtn = document.getElementById("danger-dialog-confirm");
            if (confirmBtn instanceof HTMLButtonElement) {
                confirmBtn.disabled = !isDangerDialogConfirmed();
            }
        }
        return true;
    case "danger-clear-all":
        if (target instanceof HTMLInputElement) {
            appState.dangerDialog.meta = {
                ...appState.dangerDialog.meta,
                deleteAll: target.checked,
            };
            currentTabState().cleanupDeleteAll = target.checked;
            saveTabState(appState.activeTab);
            render();
        }
        return true;
    case "db-delete-unlock-critical":
        if (target instanceof HTMLInputElement) {
            appState.unlockCritical = !target.checked;
            reconcileLockedCriticalSelections();
            syncDbDeleteSelectionUi();
        }
        return true;
    default:
        return false;
    }
}

function installRootDelegatedHandlers() {
    if (!root || rootDelegatedHandlersInstalled) {
        return;
    }
    root.addEventListener("click", async (event) => {
        if (handleDelegatedOverlayBackdropClick(event)) {
            return;
        }
        if (handleDelegatedNodeSend(event)) {
            return;
        }
        if (handleDelegatedNodeSendSort(event)) {
            return;
        }
        if (handleDelegatedFacetToggleClick(event)) {
            return;
        }
        if (handleDelegatedFacetOptionClick(event)) {
            return;
        }
        if (event.target?.id === "facet-backdrop") {
            closeFacetDropdown(true);
            return;
        }
        if (handleDelegatedDatePickerButtonClick(event)) {
            return;
        }
        handleDelegatedDateInputClick(event);
        if (await handleDelegatedPrimaryButtonClick(event)) {
            return;
        }
        if (await handleDelegatedHistoryRowCopy(event)) {
            return;
        }
        if (handleDelegatedHistoryRowSelect(event)) {
            return;
        }
        if (handleDelegatedMediaFolderClick(event)) {
            return;
        }
        if (await handleDelegatedMediaSend(event)) {
            return;
        }
        handleDelegatedMediaCardClick(event);
        const clickTarget = event.target;
        if (
            appState.localeSwitcherOpen
            && clickTarget instanceof HTMLElement
            && !clickTarget.closest(".locale-switcher")
            && !clickTarget.closest(".locale-switcher-dialog")
        ) {
            closeLocaleSwitcher(false);
        }
    });
    root.addEventListener("dragstart", (event) => {
        handleDelegatedMediaCardDragstart(event);
    });
    root.addEventListener("pointerdown", (event) => {
        const slider = event.target?.closest?.("[data-node-send-slide]");
        if (slider instanceof HTMLElement) {
            beginNodeSendQuickSlide(event, slider);
        }
    });
    root.addEventListener("pointermove", (event) => {
        if (updateNodeSendQuickSlide(event)) {
            return;
        }
        handleDelegatedMediaSendProximity(event);
    });
    root.addEventListener("pointerup", (event) => {
        endNodeSendQuickSlide(event);
    });
    root.addEventListener("pointercancel", (event) => {
        endNodeSendQuickSlide(event);
    });
    root.addEventListener("pointerover", (event) => {
        handleDelegatedMediaSendProximity(event);
    }, { passive: true });
    root.addEventListener("pointerout", (event) => {
        handleDelegatedMediaSendProximityOut(event);
    }, { passive: true });
    root.addEventListener("error", (event) => {
        const target = event.target;
        if (!(target instanceof HTMLImageElement)) {
            return;
        }
        if (target.id === "image-lightbox-image") {
            return;
        }
        const card = target.closest(".media-card[data-media-type='image']");
        if (!(card instanceof HTMLElement)) {
            return;
        }
        void (async () => {
            const urlText = target.currentSrc || target.src || "";
            const failureType = await probeMediaFailure(urlText);
            if (failureType === "permission") {
                markMediaCardPermissionDenied(card, "image");
                return;
            }
            if (failureType === "missing") {
                markMediaCardMissing(card, "image");
                return;
            }
            markMediaCardUnsupported(card, "image");
        })();
    }, true);
    root.addEventListener("keydown", (event) => {
        const target = event.target;
        if (target instanceof HTMLInputElement && event.key === "Enter") {
            if (target.id === "page-jump") {
                debouncedJumpPage(target.value);
                return;
            }
            if (
                target.id === "filter-keyword"
                || target.id === "filter-data-type"
                || target.id === "filter-source"
                || target.id === "filter-db-name"
                || target.id === "filter-start"
                || target.id === "filter-end"
            ) {
                event.preventDefault();
                applyFiltersFromUi();
                return;
            }
            if (target.id === "danger-dialog-input" && isDangerDialogConfirmed()) {
                event.preventDefault();
                closeDangerConfirm(true);
                return;
            }
        }
        handleDelegatedDateInputKeydown(event);
    });
    root.addEventListener("input", (event) => {
        handleDelegatedGlobalInput(event);
    });
    root.addEventListener("change", (event) => {
        handleDelegatedGlobalInput(event);
    });
    root.addEventListener("focusin", (event) => {
        const target = event.target;
        if (!(target instanceof HTMLInputElement)) {
            return;
        }
        if (
            target.id === "filter-data-type"
            || target.id === "filter-source"
            || target.id === "filter-db-name"
        ) {
            openFacetDropdown(target.id);
            render();
        }
    });
    root.addEventListener("change", async (event) => {
        if (handleDelegatedDbFileCheckChange(event)) {
            return;
        }
        if (await handleDelegatedDbCriticalMarkChange(event)) {
            return;
        }
        handleDelegatedGlobalChange(event);
    });
    rootDelegatedHandlersInstalled = true;
}

function bindEvents() {
    if (appState.activeTab !== "video") {
        stopVideoScheduler(false);
    }
    const list = document.getElementById("list");
    if (list) {
        list.addEventListener("scroll", () => {
            const listTabCurrent = getListTabId(list);
            syncListScroll(false, listTabCurrent, list);
            if (listTabCurrent === "video") {
                scheduleMediaQueueRebuild();
            }
        });
    }

    if (isMediaTab(appState.activeTab)) {
        setupMediaResolutionObservers();
        if (appState.activeTab === "video") {
            setupVideoCardScheduler();
        } else {
            stopVideoScheduler(false);
        }
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
            return `<div class="payload-row"><span class="payload-empty">${escapeHtml(t("xdatahub.ui.app.text.h_83a7a4af34", "Empty Array []"))}</span></div>`;
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
            rows.push(
                `<div class="payload-row"><span class="payload-empty">${escapeHtml(t("xdatahub.ui.app.payload.more_items", "{count} more items not expanded", { count: items.length - limit }))}</span></div>`
            );
        }
        return rows.join("");
    }

    const entries = Object.entries(value);
    if (entries.length === 0) {
        return `<div class="payload-row"><span class="payload-empty">${escapeHtml(t("xdatahub.ui.app.text.h_b536a95a40", "Empty Object {}"))}</span></div>`;
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
        rows.push(
            `<div class="payload-row"><span class="payload-empty">${escapeHtml(t("xdatahub.ui.app.payload.more_fields", "{count} more fields not expanded", { count: entries.length - limit }))}</span></div>`
        );
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

function scalarPayloadToText(value) {
    if (value === null || value === undefined) {
        return "";
    }
    if (
        typeof value === "string"
        || typeof value === "number"
        || typeof value === "boolean"
        || typeof value === "bigint"
    ) {
        return String(value);
    }
    return "";
}

function pickCorePayloadText(value, depth = 0) {
    if (depth > 6) {
        return "";
    }
    const scalarText = scalarPayloadToText(value);
    if (scalarText.trim()) {
        return scalarText;
    }
    if (Array.isArray(value)) {
        for (const item of value) {
            const text = pickCorePayloadText(item, depth + 1);
            if (text) {
                return text;
            }
        }
        return "";
    }
    if (!value || typeof value !== "object") {
        return "";
    }
    const preferredSeed = scalarPayloadToText(value.seed);
    if (preferredSeed.trim()) {
        return preferredSeed;
    }
    const preferredKeys = [
        "text",
        "content",
        "value",
        "result",
        "output",
        "message",
        "prompt",
        "data",
    ];
    for (const key of preferredKeys) {
        const preferred = scalarPayloadToText(value[key]);
        if (preferred.trim()) {
            return preferred;
        }
    }
    for (const entry of Object.values(value)) {
        const text = pickCorePayloadText(entry, depth + 1);
        if (text) {
            return text;
        }
    }
    return "";
}

function resolveTextSendTitle(item) {
    return String(item?.extra?.extra_header || "").trim();
}

function buildPayloadCopyText(payloadInfo) {
    return pickCorePayloadText(payloadInfo.value);
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
    const syncNoticeUi = () => {
        const actions = document.querySelector(".record-detail-actions");
        if (!(actions instanceof HTMLElement)) {
            render();
            return;
        }
        let notice = actions.querySelector(".copy-notice");
        if (!appState.copyNotice.text) {
            notice?.remove();
            return;
        }
        if (!(notice instanceof HTMLElement)) {
            notice = document.createElement("span");
            notice.className = "copy-notice";
            actions.appendChild(notice);
        }
        notice.textContent = appState.copyNotice.text;
        notice.classList.toggle("error", !!appState.copyNotice.error);
    };
    syncNoticeUi();
    appState.copyNotice.timer = setTimeout(() => {
        appState.copyNotice.text = "";
        appState.copyNotice.error = false;
        appState.copyNotice.timer = 0;
        syncNoticeUi();
    }, 1800);
}

async function handleCopyButton(button) {
    flashButton(button);
    const target = button?.getAttribute("data-copy-target") || "payload";
    const item = selectedItem();
    if (!item) {
        setCopyNotice(
            t("xdatahub.ui.app.text.h_3286eb7260", "Nothing to send"),
            true
        );
        return;
    }
    const payloadInfo = normalizePayloadValue(item?.extra?.payload);
    const text = target === "record"
        ? buildRecordCopyText(item)
        : buildPayloadCopyText(payloadInfo);
    if (!String(text || "").trim()) {
        setCopyNotice(
            t("xdatahub.ui.app.text.h_3286eb7260", "Nothing to send"),
            true
        );
        return;
    }
    const title = resolveTextSendTitle(item);
    openNodeSendDialog("", title, "text", text);
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
        textEl.textContent = t("xdatahub.ui.app.text.h_e381a5763d", "Sent");
    } else {
        button.textContent = t("xdatahub.ui.app.text.h_e381a5763d", "Sent");
    }
    button.classList.add("copied");
    const timer = window.setTimeout(() => {
        const resetTextEl = button.querySelector(".row-copy-btn-text");
        if (resetTextEl instanceof HTMLElement) {
            resetTextEl.textContent = t(
                "xdatahub.ui.app.text.h_4edd1d0087",
                "Send to node"
            );
        } else {
            button.textContent = t(
                "xdatahub.ui.app.text.h_4edd1d0087",
                "Send to node"
            );
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
        scheduleHistoryRowExtraHeaderLayout();
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
            syncLockBannerUi();
            syncTopActionBarUi();
        }
    } catch {
        // 忽略锁状态拉取失败，避免影响主流程。
    }
}

function scheduleLockUiSync() {
    syncLockBannerUi();
    syncTopActionBarUi();
}

function getLocalizedLockStateLabel(state) {
    const normalized = String(state || "").trim().toUpperCase() || "IDLE";
    const fallbackMap = {
        IDLE: "Idle",
        QUEUED: "Queued",
        RUNNING: "Running",
        STOPPING: "Stopping",
        COOLDOWN: "Cooldown",
    };
    return t(
        `xdatahub.ui.app.lock.state.${normalized.toLowerCase()}`,
        fallbackMap[normalized] || normalized
    );
}

function handleOfficialExecutionEvent(message) {
    if (!message || typeof message !== "object") {
        return false;
    }
    const eventType = String(message.type || "").trim();
    const payload = message.data;
    if (eventType === "status") {
        const queueRemaining = payload?.status?.exec_info?.queue_remaining;
        if (Number.isFinite(Number(queueRemaining))) {
            if (applyOfficialQueueRemaining(queueRemaining, eventType)) {
                scheduleLockUiSync();
            }
            return true;
        }
    }
    if (eventType === "execution_interrupted") {
        if (applyInterruptRequested(Date.now())) {
            scheduleLockUiSync();
        }
        return true;
    }
    if (
        eventType === "execution_start"
        || eventType === "execution_cached"
        || eventType === "executing"
        || eventType === "execution_success"
        || eventType === "execution_error"
        || eventType === "progress"
    ) {
        const changed = applyLockState({
            ...appState.lockState,
            last_event: eventType,
        });
        if (changed) {
            scheduleLockUiSync();
        }
        return true;
    }
    return false;
}

window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && appState.nodeSendDialogOpen) {
        if (appState.nodeSendSending) {
            event.preventDefault();
            return;
        }
        event.preventDefault();
        closeNodeSendDialog();
        return;
    }
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
        restoreThemeFromSavedSettings();
        restoreMediaCardSizeFromSavedSettings();
        appState.settingsDialogOpen = false;
        appState.settingsDraft = null;
        const overlay = document.getElementById("settings-dialog-overlay");
        overlay?.classList.add("is-hidden");
        return;
    }
    if (!appState.imagePreview.open) {
        return;
    }
    if (event.key === "ArrowLeft") {
        if (openAdjacentPreview(-1)) {
            event.preventDefault();
        }
    } else if (event.key === "ArrowRight") {
        if (openAdjacentPreview(1)) {
            event.preventDefault();
        }
    } else if (event.key === "+" || event.key === "=") {
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
        ws.addEventListener("message", (event) => {
            try {
                const payload = JSON.parse(String(event.data || ""));
                if (handleOfficialExecutionEvent(payload)) {
                    schedulePoll();
                    return;
                }
            } catch {
                // 忽略非 JSON 消息，保留轮询兜底。
            }
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
        return;
    }
    if (payload.type === "xdatahub:media_get_nodes") {
        applyNodeSendNodesResponse(payload);
        return;
    }
    if (payload.type === "xdatahub:send_to_node_ack") {
        applyNodeSendAckResponse(payload.data || payload);
        return;
    }
    if (payload.type === "xdatahub:interrupt-requested") {
        if (
            applyInterruptRequested(
                Number(payload.requested_at) || Date.now()
            )
        ) {
            scheduleLockUiSync();
        }
        pollLockStatus();
        return;
    }
    if (payload.type === "xdatahub:theme-mode") {
        applyThemeMode(payload.theme_mode);
        return;
    }
    if (payload.type === "xdatahub:hotkey-spec") {
        updateIframeHotkeySpec(payload.hotkey_spec);
        return;
    }
    if (payload.type === "xdatahub:hotkey-spec-updated") {
        applyHotkeySaveResponse(payload);
        return;
    }
    if (payload.type === "xdatahub:close-facet") {
        closeFacetDropdown(true);
        return;
    }
});

async function init() {
    if (!root) {
        return;
    }
    uiLocaleZhDict = await fetchUiLocaleDict("zh");
    uiLocaleEnDict = await fetchUiLocaleDict("en");
    appState.localePreviewLang = readUiLocalePreference();
    installRootDelegatedHandlers();
    updateIframeHotkeySpec(DEFAULT_TOGGLE_HOTKEY_SPEC);
    const queryTheme = new URLSearchParams(window.location.search).get("theme");
    const persistedTab = loadPersistedActiveTab();
    if (persistedTab) {
        appState.activeTab = persistedTab;
    }
    if (queryTheme) {
        applyThemeMode(queryTheme);
    }
    window.addEventListener("keydown", handleIframeToggleHotkey, true);
    window.addEventListener("focusin", handleFacetFocusIn, true);
    window.addEventListener("pointerdown", handleFacetPointerDown, true);
    window.addEventListener("blur", handleFacetWindowBlur, true);
    window.addEventListener("resize", scheduleTopActionBarCompactUpdate);
    window.addEventListener("resize", debouncedLayoutRefresh);
    window.addEventListener("resize", debouncedFacetDropdownReposition);
    setupWsLockSync();
    appState.lockPollTimer = window.setInterval(pollLockStatus, 2000);
    try {
        await fetchSettings();
    } catch {
        appState.settings = normalizeSettings({});
        applyThemeMode(appState.settings.themeMode);
        appState.settingsError = "";
    }
    if (appState.settings.uiLocale) {
        appState.localePreviewLang = appState.settings.uiLocale;
        appState.localeSelectionPending = false;
    } else {
        appState.localeSelectionPending = true;
        openLocaleSwitcher();
    }
    syncDocumentLocaleMeta();
    window.parent?.postMessage?.({
        type: "xdatahub:ui-locale",
        locale: appState.localePreviewLang,
    }, "*");
    render();
    await pollLockStatus();
    await loadList();
}

window.addEventListener("beforeunload", cleanupRuntimeResources);

init();
