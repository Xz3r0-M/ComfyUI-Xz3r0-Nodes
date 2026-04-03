// Core
import { appStore } from "./core/store.js";
import {
    apiPost,
    loadMediaList, loadLoraList, loadRecords, loadFavorites, loadLockStatus,
    buildMediaUrl,
} from "./core/api.js?v=20260402-411";
import { banner } from "./core/banner.js";
import { setLocale, t } from "./core/i18n.js?v=20260403-5";

// Components (side-effect imports to register custom elements)
import "./components/xdh-button.js?v=20260402-381";
import "./components/xdh-sidebar-filter.js?v=20260403-12";
import "./components/xdh-media-grid.js?v=20260403-8";
import "./components/xdh-staging-dock.js?v=20260403-402";
import "./components/xdh-node-picker.js?v=20260403-401";
import "./core/node-bridge.js?v=20260402-398";
import "./components/xdh-content-nav.js?v=20260403-13";
import "./components/xdh-pagination.js?v=20260403-8";
import "./components/xdh-lightbox.js?v=20260403-21";
import "./components/xdh-history-view.js?v=20260403-1";
import "./components/xdh-banner.js?v=20260402-381";
import "./components/xdh-lora-detail.js?v=20260402-401";
import "./components/xdh-settings-dialog.js?v=20260403-1";

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
    const payload = event?.data;
    if (!payload || typeof payload !== "object") {
        return;
    }
    if (payload.type === "xdatahub:ui-locale") {
        setLocale(payload.locale);
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
        applyThemeV2(appStore.state.xdatahubSettings.theme_mode);
    } catch (error) {
        console.warn("[xdh-v2] Failed to load settings", error);
    }
}

function applyThemeV2(mode) {
    document.body.dataset.theme =
        (mode === "light") ? "light" : "dark";
}

function categoryToMediaType(category) {
    return ["image", "video", "audio"].includes(category)
        ? category
        : null;
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
                await apiPost("/xz3r0/xdatahub/media/clear", {});
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

async function refreshLockState() {
    try {
        const res = await loadLockStatus();
        setLockState(res);
    } catch (e) {
        console.warn("[xdh-v2] Failed to refresh lock state", e);
    }
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
    // ── Folder shape ─────────────────────────────────────
    if (item.kind === "folder") {
        return {
            id: item.id || String(Math.random()),
            name: item.title || item.path || "Folder",
            type: "folder",
            thumbUrl: "icons/folder.svg",
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
            id: item.id || ref || String(Math.random()),
            name,
            type: "lora",
            thumbUrl,
            previewable: !!(item.extra?.thumb_url || item.thumb_url),
            raw: item,
        };
    }

    // ── Record / Favorites shape ─────────────────────────
    if (category === "history" || category === "favorites") {
        const id   = item.id || String(Math.random());
        const name = item.title || id;
        // Records don't have a thumb — use a placeholder
        return {
            id,
            name,
            type: "record",
            thumbUrl: MOCK_THUMB,
            previewable: false,
            raw: item,
        };
    }

    // ── Media shape (image / video / audio) ─────────────
    const id   = item.id || String(Math.random());
    const name = item.title || item.extra?.media_ref || id;
    const ref  = item.extra?.media_ref || "";
    const isMock = item.extra?.isMock;
    const thumbUrl = isMock
        ? MOCK_THUMB
        : ref
            ? buildMediaUrl(ref)
            : MOCK_THUMB;
    const mediaType = item.kind || item.extra?.media_type || "image";
    return {
        id,
        name,
        type: mediaType,
        thumbUrl,
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

async function fetchCategory(category) {
    if (category === "lora") {
        return loadLoraList(
            appStore.state.currentPage || 1,
            50,
            appStore.state.activeFolder || ""
        );
    }
    if (category === "history")   return loadRecords(appStore.state.currentPage || 1, 50);
    if (category === "favorites") return loadFavorites(appStore.state.currentPage || 1, 50);
    if (MEDIA_CATEGORIES.has(category)) {
        return loadMediaList(
            category,
            appStore.state.currentPage || 1,
            50,
            appStore.state.activeFolder || ""
        );
    }
    return { items: [], page: 1, total_pages: 1 };
}

appStore.subscribe(async (state, key) => {
    if (
        key !== "activeCategory"
        && key !== "activeFolder"
        && key !== "currentPage"
        && key !== "refreshTrigger"
    ) {
        return;
    }
    appStore.state.isLoading = true;
    if ((appStore.state.selectedItems || []).length > 0) {
        appStore.state.selectedItems = [];
    }
    try {
        const category = state.activeCategory;
        const res = await fetchCategory(category);
        const raw = res.items || res.data || [];
        appStore.state.mediaList   = raw.map(item => mapItem(item, category));
        appStore.state.currentPage = res.page        || 1;
        appStore.state.totalPages  = res.total_pages || 1;
        if (res.lock_state) {
            setLockState({
                ...appStore.state.lockState,
                ...res.lock_state,
            });
        }
    } catch (e) {
        console.error("[xdh-v2] Failed to load list", e);
        appStore.state.mediaList = [];
    } finally {
        appStore.state.isLoading = false;
        if (key === "refreshTrigger") {
            appStore.state.dbTaskBusy = false;
        }
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
        backdropFilter: "blur(8px)",
        webkitBackdropFilter: "blur(8px)",
        background: "rgba(0,0,0,0.35)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        pointerEvents: "all",
        userSelect: "none",
    });
    const label = document.createElement("div");
    label.id = "xdh-exec-overlay-label";
    Object.assign(label.style, {
        color: "#ffffff",
        fontSize: "15px",
        fontFamily: "system-ui, -apple-system, sans-serif",
        fontWeight: "500",
        letterSpacing: "0.03em",
        textShadow: "0 1px 4px rgba(0,0,0,0.6)",
        padding: "12px 24px",
        background: "rgba(0,0,0,0.45)",
        borderRadius: "8px",
    });
    el.appendChild(label);
    return el;
})();

function updateExecOverlay() {
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
window.setInterval(refreshLockState, 1500);
