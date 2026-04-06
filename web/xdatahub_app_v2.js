// Core
import { appStore } from "./core/store.js";
import {
    apiPost,
    loadMediaList, loadLoraList, loadRecords, loadFavorites, loadLockStatus,
    buildMediaUrl,
} from "./core/api.js?v=20260403-413";
import { banner } from "./core/banner.js";
import { setLocale, t } from "./core/i18n.js?v=20260406-9";

// Components (side-effect imports to register custom elements)
import "./components/xdh-button.js?v=20260403-383";
import "./components/xdh-sidebar-filter.js?v=20260406-4";
import "./components/xdh-media-grid.js?v=20260406-4";
import "./components/xdh-staging-dock.js?v=20260406-4";
import "./components/xdh-node-picker.js?v=20260406-4";
import "./core/node-bridge.js?v=20260403-400";
import "./components/xdh-content-nav.js?v=20260406-4";
import "./components/xdh-pagination.js?v=20260406-4";
import "./components/xdh-lightbox.js?v=20260406-12";
import "./components/xdh-history-view.js?v=20260406-10";
import "./components/xdh-banner.js?v=20260406-4";
import "./components/xdh-lora-detail.js?v=20260406-4";
import "./components/xdh-settings-dialog.js?v=20260406-13";

// Placeholder thumbnail for mock/offline mode
const MOCK_THUMB = [
    "data:image/svg+xml,",
    "%3Csvg xmlns='http://www.w3.org/2000/svg'",
    " width='100' height='100'%3E",
    "%3Crect width='100' height='100' fill='%23383838'/%3E",
    "%3Ctext x='50%25' y='50%25' fill='%23888' font-size='11'",
    " font-family='sans-serif' text-anchor='middle'",
    " dominant-baseline='middle'%3EXDataHub%3C/text%3E",
    "%3C/svg%3E"
].join("");

const UI_STATE_STORAGE_KEY = "XDataHub.V2.UIState";
const DEFAULT_ACTIVE_CATEGORY = "image";
const DEFAULT_SORT_ORDER = "date-desc";
const DEFAULT_CARD_SIZE = "small";
const PERSISTED_CATEGORIES = new Set([
    "image",
    "video",
    "audio",
    "lora",
    "history",
    "favorites",
]);
const PERSISTED_SORT_ORDERS = new Set([
    "date-desc",
    "date-asc",
    "name-asc",
    "name-desc",
]);
const PERSISTED_CARD_SIZES = new Set(["small", "medium", "large"]);

const URL_CATEGORY_PARAM = "tab";
const LOCK_FALLBACK_POLL_INTERVAL_MS = 10000;
const LOCK_EVENT_REFRESH_DEBOUNCE_MS = 80;
const THEME_MODE_VALUES = new Set(["dark", "light"]);
const DEFAULT_HOTKEY_SPEC = "Alt + X";

let lockRefreshTimer = 0;
let lockRefreshInFlight = null;
let lockRefreshQueued = false;
let hasShownLockStatusError = false;
let hotkeySpec = DEFAULT_HOTKEY_SPEC;

function normalizeThemeMode(mode) {
    const nextMode = String(mode || "").trim().toLowerCase();
    return THEME_MODE_VALUES.has(nextMode) ? nextMode : "dark";
}

function normalizeMessageOrigin(value) {
    if (typeof value !== "string" || !value) {
        return "";
    }
    try {
        const origin = new URL(value, window.location.href).origin;
        return origin === "null" ? "" : origin;
    } catch {
        return "";
    }
}

function getParentTargetOrigin() {
    const referrerOrigin = normalizeMessageOrigin(document.referrer || "");
    if (referrerOrigin) {
        return referrerOrigin;
    }
    return normalizeMessageOrigin(window.location.origin || "");
}

function isTrustedParentMessage(event) {
    return event?.source === window.parent
        && normalizeMessageOrigin(String(event.origin || ""))
            === getParentTargetOrigin();
}

function postThemeModeToHost(mode) {
    if (!window.parent || window.parent === window) {
        return;
    }
    const targetOrigin = getParentTargetOrigin();
    window.parent.postMessage(
        {
            type: "xdatahub:theme-mode",
            theme_mode: normalizeThemeMode(mode),
        },
        targetOrigin
    );
}

function postToggleWindowRequest() {
    if (!window.parent || window.parent === window) {
        return;
    }
    window.parent.postMessage(
        {
            type: "xdatahub:toggle-window-request",
        },
        getParentTargetOrigin()
    );
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
    if (tokens.length === 0) {
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

function normalizeHotkeyEventKey(key) {
    const raw = String(key || "").trim();
    if (!raw) {
        return "";
    }
    const lower = raw.toLowerCase();
    if (lower === " ") {
        return "space";
    }
    if (lower === "spacebar") {
        return "space";
    }
    return lower;
}

function matchesHotkeyEvent(event, combo) {
    if (!event || !combo) {
        return false;
    }
    const key = normalizeHotkeyEventKey(event.key);
    if (!key || key !== combo.key) {
        return false;
    }
    return (
        !!event.ctrlKey === !!combo.ctrl
        && !!event.altKey === !!combo.alt
        && !!event.shiftKey === !!combo.shift
        && !!event.metaKey === !!combo.meta
    );
}

function isEditableHotkeyTarget(target) {
    if (!(target instanceof Element)) {
        return false;
    }
    const editable = target.closest(
        "input, textarea, select, [contenteditable=''], [contenteditable='true']"
    );
    if (!editable) {
        return false;
    }
    if (!(editable instanceof HTMLInputElement)) {
        return true;
    }
    const type = String(editable.type || "").trim().toLowerCase();
    return ![
        "button",
        "checkbox",
        "radio",
        "reset",
        "submit",
    ].includes(type);
}

function handleFrameHotkeyCapture(event) {
    if (
        event.defaultPrevented
        || event.isComposing
        || event.repeat
        || isEditableHotkeyTarget(event.target)
    ) {
        return;
    }
    const combo = (
        parseHotkeySpec(hotkeySpec)
        || parseHotkeySpec(DEFAULT_HOTKEY_SPEC)
    );
    if (!matchesHotkeyEvent(event, combo)) {
        return;
    }
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();
    postToggleWindowRequest();
}

window.addEventListener("keydown", handleFrameHotkeyCapture, true);

function readCategoryFromUrl() {
    try {
        const url = new URL(window.location.href);
        const queryCategory = String(
            url.searchParams.get(URL_CATEGORY_PARAM) || ""
        ).trim();
        if (PERSISTED_CATEGORIES.has(queryCategory)) {
            return queryCategory;
        }
        const hash = String(url.hash || "").replace(/^#/, "").trim();
        if (!hash) {
            return "";
        }
        const hashParams = new URLSearchParams(hash);
        const hashCategory = String(
            hashParams.get(URL_CATEGORY_PARAM) || hash
        ).trim();
        return PERSISTED_CATEGORIES.has(hashCategory) ? hashCategory : "";
    } catch {
        return "";
    }
}

function syncCategoryToUrl(category, options = {}) {
    const nextCategory = String(category || "").trim();
    if (!PERSISTED_CATEGORIES.has(nextCategory)) {
        return;
    }
    try {
        const url = new URL(window.location.href);
        const nextHash = `${URL_CATEGORY_PARAM}=${encodeURIComponent(nextCategory)}`;
        const currentHash = String(url.hash || "").replace(/^#/, "");
        if (currentHash === nextHash) {
            return;
        }
        url.hash = nextHash;
        if (options.replace) {
            window.history.replaceState(null, "", url);
            return;
        }
        window.history.pushState(null, "", url);
    } catch {
        // ignore URL sync errors
    }
}

function loadPersistedUiState() {
    try {
        const raw = localStorage.getItem(UI_STATE_STORAGE_KEY) || "";
        const parsed = raw ? JSON.parse(raw) : {};
        return {
            activeCategory: PERSISTED_CATEGORIES.has(parsed.activeCategory)
                ? parsed.activeCategory
                : DEFAULT_ACTIVE_CATEGORY,
            sortOrder: PERSISTED_SORT_ORDERS.has(parsed.sortOrder)
                ? parsed.sortOrder
                : DEFAULT_SORT_ORDER,
            cardSize: PERSISTED_CARD_SIZES.has(parsed.cardSize)
                ? parsed.cardSize
                : DEFAULT_CARD_SIZE,
        };
    } catch {
        return {
            activeCategory: DEFAULT_ACTIVE_CATEGORY,
            sortOrder: DEFAULT_SORT_ORDER,
            cardSize: DEFAULT_CARD_SIZE,
        };
    }
}

function persistUiState(state = appStore.state) {
    try {
        localStorage.setItem(UI_STATE_STORAGE_KEY, JSON.stringify({
            activeCategory: String(
                state.activeCategory || DEFAULT_ACTIVE_CATEGORY
            ),
            sortOrder: String(state.sortOrder || DEFAULT_SORT_ORDER),
            cardSize: String(state.cardSize || DEFAULT_CARD_SIZE),
        }));
    } catch {
        // ignore localStorage write errors
    }
}

const initialUiState = loadPersistedUiState();
const initialCategoryFromUrl = readCategoryFromUrl();
if (initialCategoryFromUrl) {
    initialUiState.activeCategory = initialCategoryFromUrl;
}
appStore.state.activeCategory = initialUiState.activeCategory;
appStore.state.sortOrder = initialUiState.sortOrder;
appStore.state.cardSize = initialUiState.cardSize;
appStore.state.activeFolder = "";
appStore.state.currentPage = 1;
appStore.state.navHistory = [{
    category: initialUiState.activeCategory,
    folder: "",
    page: 1,
}];
appStore.state.navIndex = 0;
appStore.state.dbTaskBusy = false;
syncCategoryToUrl(appStore.state.activeCategory, { replace: true });

window.addEventListener("message", (event) => {
    if (!isTrustedParentMessage(event)) {
        return;
    }
    const payload = event?.data;
    if (!payload || typeof payload !== "object") {
        return;
    }
    if (payload.type === "xdatahub:theme-mode") {
        applyThemeV2(payload.theme_mode, { notifyHost: false });
        return;
    }
    if (payload.type === "xdatahub:hotkey-spec") {
        const nextSpec = String(payload.hotkey_spec || "").trim();
        hotkeySpec = parseHotkeySpec(nextSpec)
            ? nextSpec
            : DEFAULT_HOTKEY_SPEC;
        appStore.state.xdatahubSettings = {
            ...appStore.state.xdatahubSettings,
            hotkey_spec: hotkeySpec,
        };
        return;
    }
    if (payload.type === "xdatahub:ui-locale") {
        setLocale(payload.locale);
        return;
    }
    if (
        payload.type === "xdatahub:lock-state-dirty"
        || payload.type === "xdatahub:interrupt-requested"
    ) {
        scheduleLockStateRefresh(0);
    }
});

function scheduleMainScrollReset() {
    const apply = () => {
        const mainScroll = document.querySelector(".main-scroll");
        if (mainScroll instanceof HTMLElement) {
            mainScroll.scrollTop = 0;
        }
    };

    apply();
    requestAnimationFrame(apply);
    requestAnimationFrame(() => requestAnimationFrame(apply));
}

document.addEventListener("xdh:reset-main-scroll", () => {
    scheduleMainScrollReset();
});

async function loadAppSettings() {
    try {
        const response = await fetch("/xz3r0/xdatahub/settings");
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const payload = await response.json();
        appStore.state.xdatahubSettings = {
            ...appStore.state.xdatahubSettings,
            ...(payload.settings || {}),
        };
    } catch (error) {
        console.warn("[xdh-v2] Failed to load settings", error);
    }
}

function applyThemeV2(mode, options = {}) {
    const normalized = normalizeThemeMode(mode);
    if (document.body.dataset.theme === normalized) {
        return;
    }
    document.body.dataset.theme = normalized;
    if (options.notifyHost !== false) {
        postThemeModeToHost(normalized);
    }
}

function categoryToMediaType(category) {
    return ["image", "video", "audio"].includes(category)
        ? category
        : null;
}

function getSortRequest(sortOrder) {
    switch (String(sortOrder || DEFAULT_SORT_ORDER)) {
        case "date-asc":
            return { sortBy: "mtime", sortOrder: "asc" };
        case "name-asc":
            return { sortBy: "name", sortOrder: "asc" };
        case "name-desc":
            return { sortBy: "name", sortOrder: "desc" };
        case "date-desc":
        default:
            return { sortBy: "mtime", sortOrder: "desc" };
    }
}

function normalizeItemMtime(value) {
    if (typeof value === "number" && Number.isFinite(value)) {
        return value;
    }

    const text = String(value || "").trim();
    if (!text) {
        return 0;
    }

    const numeric = Number(text);
    if (Number.isFinite(numeric)) {
        return numeric;
    }

    const parsed = Date.parse(text);
    return Number.isFinite(parsed) ? parsed / 1000 : 0;
}

function extractItemMtime(item) {
    return normalizeItemMtime(
        item?.extra?.mtime ?? item?.mtime ?? item?.saved_at
    );
}

function normalizeItemSize(value) {
    const size = Number(value);
    return Number.isFinite(size) ? size : 0;
}

async function runMenuAction(action) {
    const category = String(appStore.state.activeCategory || "");
    const mediaType = categoryToMediaType(category);
    const canBlockDbTask = !!mediaType || category === "lora";

    if (action === "clean-invalid") {
        if (canBlockDbTask) {
            appStore.state.dbTaskBusy = true;
        }
        try {
            if (mediaType) {
                await apiPost("/xz3r0/xdatahub/media/cleanup-invalid", {
                    media_type: mediaType,
                });
            } else if (category === "lora") {
                await apiPost("/xz3r0/xdatahub/loras/cleanup-invalid", {});
            } else {
                appStore.state.refreshTrigger = Date.now();
                return;
            }
            banner.success(t("nav.banner.cleanup_ok"));
            appStore.state.refreshTrigger = Date.now();
        } catch {
            if (canBlockDbTask) {
                appStore.state.dbTaskBusy = false;
            }
            banner.error(t("nav.banner.cleanup_fail"));
        }
        return;
    }

    if (action === "clean-index") {
        if (canBlockDbTask) {
            appStore.state.dbTaskBusy = true;
        }
        try {
            if (mediaType) {
                await apiPost("/xz3r0/xdatahub/media/rebuild", {
                    media_type: mediaType,
                });
            } else if (category === "lora") {
                await apiPost("/xz3r0/xdatahub/loras/rebuild", {});
            } else {
                appStore.state.refreshTrigger = Date.now();
                return;
            }
            appStore.state.activeFolder = "";
            appStore.state.currentPage = 1;
            banner.success(t("nav.banner.rebuild_ok"));
            appStore.state.refreshTrigger = Date.now();
        } catch {
            if (canBlockDbTask) {
                appStore.state.dbTaskBusy = false;
            }
            banner.error(t("nav.banner.rebuild_fail"));
        }
        return;
    }

    if (action === "clean-data") {
        if (mediaType) {
            appStore.state.dbTaskBusy = true;
        }
        try {
            if (mediaType) {
                await apiPost("/xz3r0/xdatahub/media/clear", {
                    media_type: mediaType,
                });
                appStore.state.activeFolder = "";
                appStore.state.currentPage = 1;
                appStore.state.refreshTrigger = Date.now();
            }
        } catch {
            if (mediaType) {
                appStore.state.dbTaskBusy = false;
            }
            banner.error(t("error.save_fail"));
        }
    }

    if (action === "open-db-folder") {
        try {
            const res = await apiPost(
                "/xz3r0/xdatahub/open-db-folder", {}
            );
            if (res?.status === "unsupported") {
                banner.warn(t("nav.banner.open_db_unsupported"));
            } else {
                banner.success(t("nav.banner.open_db_folder_ok"));
            }
        } catch {
            banner.error(t("nav.banner.open_db_folder_fail"));
        }
    }
}

function scheduleLockStateRefresh(delay = LOCK_EVENT_REFRESH_DEBOUNCE_MS) {
    if (lockRefreshTimer) {
        window.clearTimeout(lockRefreshTimer);
        lockRefreshTimer = 0;
    }

    if (delay <= 0) {
        void refreshLockState();
        return;
    }

    lockRefreshTimer = window.setTimeout(() => {
        lockRefreshTimer = 0;
        void refreshLockState();
    }, delay);
}

async function refreshLockState() {
    if (lockRefreshInFlight) {
        lockRefreshQueued = true;
        return lockRefreshInFlight;
    }

    lockRefreshInFlight = (async () => {
        try {
            const res = await loadLockStatus();
            setLockState(res);
            hasShownLockStatusError = false;
        } catch (e) {
            console.warn("[xdh-v2] Failed to refresh lock state", e);
            if (!hasShownLockStatusError) {
                hasShownLockStatusError = true;
                banner.warn(t("nav.banner.lock_status_fail"));
            }
        } finally {
            lockRefreshInFlight = null;
            if (lockRefreshQueued) {
                lockRefreshQueued = false;
                scheduleLockStateRefresh(LOCK_EVENT_REFRESH_DEBOUNCE_MS);
            }
        }
    })();

    return lockRefreshInFlight;
}

function normalizeLockState(lock = {}) {
    return {
        state: lock.state || "IDLE",
        readonly: !!lock.readonly,
        cooldown_ms: lock.cooldown_ms || 0,
        is_executing: !!lock.is_executing,
        queue_remaining: lock.queue_remaining || 0,
        queue_running: lock.queue_running || 0,
        queue_pending: lock.queue_pending || 0,
        interrupt_requested: !!lock.interrupt_requested,
        last_event: lock.last_event || "",
    };
}

function isSameLockState(left = {}, right = {}) {
    return left.state === right.state
        && left.readonly === right.readonly
        && left.cooldown_ms === right.cooldown_ms
        && left.is_executing === right.is_executing
        && left.queue_remaining === right.queue_remaining
        && left.queue_running === right.queue_running
        && left.queue_pending === right.queue_pending
        && left.interrupt_requested === right.interrupt_requested
        && left.last_event === right.last_event;
}

function setLockState(lock) {
    const next = normalizeLockState(lock);
    const prev = normalizeLockState(appStore.state.lockState || {});
    if (isSameLockState(prev, next)) {
        return false;
    }
    appStore.state.lockState = next;
    return true;
}

function buildStableFallbackId(item, category, scope) {
    const stableParts = [
        category,
        scope,
        item.path,
        item.extra?.child_path,
        item.extra?.media_ref,
        item.media_ref,
        item.ref,
        item.title,
        item.name,
    ].map(value => String(value || "").trim()).filter(Boolean);

    if (stableParts.length > 0) {
        return stableParts.join("::");
    }

    try {
        return [
            String(category || "unknown"),
            String(scope || "item"),
            JSON.stringify(item),
        ].join("::");
    } catch {
        return [
            String(category || "unknown"),
            String(scope || "item"),
            "missing",
        ].join("::");
    }
}

/**
 * Map a raw API item to the uniform card model:
 * { id, name, type, thumbUrl, raw }
 *
 * Supports all three item shapes:
 * - media  : item.id = "media:ref"  (image/video/audio)
 * - lora   : item.media_ref          (from /loras)
 * - record : item.id = "record:..." (history/favorites)
 */
function mapItem(item, category) {
    const mtime = extractItemMtime(item);
    const size = normalizeItemSize(item?.extra?.size ?? item?.size);

    // ── Folder shape ─────────────────────────────────────
    if (item.kind === "folder") {
        return {
            id: item.id || buildStableFallbackId(item, category, "folder"),
            name: item.title || item.path || "Folder",
            type: "folder",
            thumbUrl: "icons/folder.svg",
            mtime,
            size,
            previewable: false,
            isFolder: true,
            childPath: item.extra?.child_path || item.path || "",
            raw: item,
        };
    }

    // ── Lora shape ──────────────────────────────────────
    if (category === "lora") {
        const ref  = item.extra?.media_ref || item.media_ref || item.ref || "";
        const name = item.title || item.name || ref || "Unnamed";
        const thumbUrl = item.extra?.thumb_url || item.thumb_url || "";
        return {
            id: item.id || ref || buildStableFallbackId(item, category, "lora"),
            name,
            type: "lora",
            thumbUrl,
            mtime,
            size,
            previewable: !!(item.extra?.thumb_url || item.thumb_url),
            raw: item,
        };
    }

    // ── Record / Favorites shape ─────────────────────────
    if (category === "history" || category === "favorites") {
        const id = item.id || buildStableFallbackId(item, category, "record");
        const name = item.title || id;
        // Records don't have a thumb — use a placeholder
        return {
            id,
            name,
            type: "record",
            thumbUrl: MOCK_THUMB,
            mtime,
            size,
            previewable: false,
            raw: item,
        };
    }

    // ── Media shape (image / video / audio) ─────────────
    const mediaType = item.kind || item.extra?.media_type || "image";
    const id = item.id || buildStableFallbackId(item, category, mediaType);
    const name = item.title || item.extra?.media_ref || id;
    const ref  = item.extra?.media_ref || "";
    const isMock = item.extra?.isMock;
    const thumbUrl = isMock
        ? MOCK_THUMB
        : ref
            ? buildMediaUrl(ref)
            : MOCK_THUMB;
    return {
        id,
        name,
        type: mediaType,
        thumbUrl,
        mtime,
        size,
        previewable: item.previewable !== false,
        raw: item,
    };
}

// ── Navigation history manager ───────────────────────────────────────────────
// Pushes a new entry to navHistory when activeCategory changes via sidebar click.
// Does NOT push when back/fwd buttons are used (_navSkipPush flag).
appStore.subscribe((state, key) => {
    if (key !== "activeCategory") return;
    if (state._navSkipPush) {
        // Flag consumed — clear it; history was already updated by content-nav
        appStore.state._navSkipPush = false;
        return;
    }
    // Truncate any forward history, then push new entry
    const newEntry  = {
        category: state.activeCategory,
        folder: state.activeFolder || "",
        folderLabel: state.activeFolderLabel || "",
        page: state.currentPage || 1,
    };
    const truncated = state.navHistory.slice(0, state.navIndex + 1);
    truncated.push(newEntry);
    // Assign as new array to trigger subscribers
    appStore.state.navHistory = truncated;
    appStore.state.navIndex   = truncated.length - 1;
});

appStore.subscribe((state, key) => {
    if (key !== "activeCategory") return;
    syncCategoryToUrl(state.activeCategory);
});

window.addEventListener("hashchange", () => {
    const category = readCategoryFromUrl();
    if (!category || category === appStore.state.activeCategory) {
        return;
    }
    appStore.state.activeFolder = "";
    appStore.state.activeFolderLabel = "";
    appStore.state.currentPage = 1;
    appStore.state.activeCategory = category;
});

appStore.subscribe((state, key) => {
    if (
        key !== "activeCategory"
        && key !== "sortOrder"
        && key !== "cardSize"
    ) {
        return;
    }
    persistUiState(state);
});

// ── Data loader ──────────────────────────────────────────────────────────────
const MEDIA_CATEGORIES = new Set(["image", "video", "audio"]);
let latestListLoadToken = 0;

async function fetchCategory(category, page, folder, sortKey) {
    const safePage = page || 1;
    const safeFolder = folder || "";
    const { sortBy, sortOrder } = getSortRequest(sortKey);
    if (category === "lora") {
        return loadLoraList(
            safePage,
            50,
            safeFolder,
            sortBy,
            sortOrder
        );
    }
    if (category === "history") return loadRecords(safePage, 50);
    if (category === "favorites") return loadFavorites(safePage, 50);
    if (MEDIA_CATEGORIES.has(category)) {
        return loadMediaList(
            category,
            safePage,
            50,
            safeFolder,
            sortBy,
            sortOrder
        );
    }
    return { items: [], page: 1, total_pages: 1 };
}

appStore.subscribe(async (state, key) => {
    if (
        key !== "activeCategory"
        && key !== "activeFolder"
        && key !== "currentPage"
        && key !== "sortOrder"
        && key !== "refreshTrigger"
    ) {
        return;
    }

    const requestToken = ++latestListLoadToken;
    const categorySnapshot = state.activeCategory;
    const folderSnapshot = state.activeFolder || "";
    const pageSnapshot = state.currentPage || 1;
    const sortSnapshot = state.sortOrder || DEFAULT_SORT_ORDER;

    appStore.state.isLoading = true;
    appStore.state.loadError = "";
    const shouldResetSelection = key !== "currentPage";
    if (
        shouldResetSelection
        && (appStore.state.selectedItems || []).length > 0
    ) {
        appStore.state.selectedItems = [];
    }
    try {
        const res = await fetchCategory(
            categorySnapshot,
            pageSnapshot,
            folderSnapshot,
            sortSnapshot
        );
        if (requestToken !== latestListLoadToken) {
            return;
        }
        const raw = res.items || res.data || [];
        appStore.state.mediaList = raw.map(
            item => mapItem(item, categorySnapshot)
        );
        appStore.state.loadError = "";
        appStore.state.currentPage = res.page        || 1;
        appStore.state.totalPages  = res.total_pages || 1;
        if (res.lock_state) {
            setLockState({
                ...appStore.state.lockState,
                ...res.lock_state,
            });
        }
    } catch (e) {
        if (requestToken !== latestListLoadToken) {
            return;
        }
        console.error("[xdh-v2] Failed to load list", e);
        appStore.state.mediaList = [];
        appStore.state.totalPages = 1;
        appStore.state.loadError = t("error.load_fail");
        banner.error(t("error.load_fail"));
    } finally {
        if (key === "refreshTrigger") {
            appStore.state.dbTaskBusy = false;
        }
        if (requestToken !== latestListLoadToken) {
            return;
        }
        appStore.state.isLoading = false;
    }
});

document.addEventListener("xdh:menu-action", (event) => {
    const action = event?.detail?.action;
    if (!action) return;
    void runMenuAction(String(action));
});

// ── 主题响应：xdatahubSettings.theme_mode 变化时即时更新 body dataset ──────
appStore.subscribe((state, key) => {
    if (key !== "xdatahubSettings") return;
    applyThemeV2(state.xdatahubSettings?.theme_mode || "dark");
    updateExecOverlay();
});

appStore.subscribe((state, key) => {
    if (key === "lockState" || key === "dbTaskBusy") {
        updateExecOverlay();
    }
});

// ── 执行覆盖层（Task 5）────────────────────────────────────────────────────
const _execOverlay = (() => {
    const el = document.createElement("div");
    el.id = "xdh-exec-overlay";
    Object.assign(el.style, {
        position: "fixed",
        inset: "0",
        zIndex: "4500",
        background: "color-mix(in srgb, var(--xdh-color-background, #121212) 86%, transparent)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        pointerEvents: "all",
        userSelect: "none",
    });
    const label = document.createElement("div");
    label.id = "xdh-exec-overlay-label";
    Object.assign(label.style, {
        color: "var(--xdh-color-text-primary, #f0f0f0)",
        fontSize: "15px",
        fontFamily: "system-ui, -apple-system, sans-serif",
        fontWeight: "500",
        letterSpacing: "0.03em",
        textShadow: "0 1px 4px rgba(0,0,0,0.6)",
        padding: "12px 24px",
        background: "color-mix(in srgb, var(--xdh-color-surface-2, #333) 95%, transparent)",
        border: "1px solid var(--xdh-color-border, #2e2e2e)",
        borderRadius: "8px",
    });
    el.appendChild(label);
    return el;
})();

function updateExecOverlay() {
    // 仅在嵌入 iframe 模式下显示——直接在浏览器打开时不产生遮罩
    if (window.parent === window) {
        return;
    }
    const settings = appStore.state.xdatahubSettings || {};
    const lock = appStore.state.lockState || {};
    const enabled = settings.disable_interaction_while_running !== false;
    const running = !!lock.is_executing || !!appStore.state.dbTaskBusy;
    if (enabled && running) {
        const label = _execOverlay.querySelector("#xdh-exec-overlay-label");
        if (label) label.textContent = t("exec.overlay.running");
        if (!_execOverlay.parentNode) {
            document.body.appendChild(_execOverlay);
        }
    } else {
        _execOverlay.parentNode?.removeChild(_execOverlay);
    }
}

// Boot: trigger initial data load after sidebar is ready
customElements.whenDefined("xdh-sidebar-filter").then(async () => {
    await loadAppSettings();
    appStore.state.refreshTrigger = Date.now();
});

refreshLockState();
document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
        scheduleLockStateRefresh(0);
    }
});
window.setInterval(() => {
    if (document.hidden) {
        return;
    }
    scheduleLockStateRefresh();
}, LOCK_FALLBACK_POLL_INTERVAL_MS);
