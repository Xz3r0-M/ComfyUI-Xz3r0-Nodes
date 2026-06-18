import {
    BaseElement,
    registerCustomElement,
} from "../core/base-element.js?v=20260403-2";
import { appStore as store } from "../core/store.js";
import { apiPost } from "../core/api.js";
import { banner } from "../core/banner.js";
import { icon, ICON_CSS, TOOLTIP_CSS } from "../core/icon.js";
import { t } from "../core/i18n.js?v=20260406-15";

function getSortOptions() {
    return [
        { key: "date-desc", label: t("nav.sort.date_desc") },
        { key: "date-asc",  label: t("nav.sort.date_asc") },
        { key: "name-asc",  label: t("nav.sort.name_asc") },
        { key: "name-desc", label: t("nav.sort.name_desc") },
        { key: "size-desc", label: t("nav.sort.size_desc") },
        { key: "size-asc",  label: t("nav.sort.size_asc") },
    ];
}

function lockMeta(lockState = {}) {
    const state = String(lockState.state || "IDLE").toUpperCase();
    if (state === "RUNNING") {
        return {
            key: "running",
            label: t("nav.lock.running"),
            title: t("nav.lock.running_title", {
                running: lockState.queue_running || 0,
                pending: lockState.queue_pending || 0,
            }),
        };
    }
    if (state === "QUEUED" || state === "COOLDOWN") {
        return {
            key: "queued",
            label: state === "COOLDOWN"
                ? t("nav.lock.cooldown")
                : t("nav.lock.queued"),
            title: t(
                state === "COOLDOWN"
                    ? "nav.lock.cooldown_title"
                    : "nav.lock.queued_title",
                { remaining: lockState.queue_remaining || 0 }
            ),
        };
    }
    if (state === "STOPPING") {
        return {
            key: "stopping",
            label: t("nav.lock.stopping"),
            title: t("nav.lock.stopping_title"),
        };
    }
    return {
        key: "idle",
        label: t("nav.lock.idle"),
        title: t("nav.lock.idle_title"),
    };
}

function lockEventLabel(value) {
    const event = String(value || "").trim().toLowerCase();
    const key = `nav.event.${event}`;
    const result = t(key);
    return result === `[${key}]` ? t("nav.event.unknown") : result;
}

function lockReadonlyLabel(value) {
    return value ? t("nav.lock.readonly") : t("nav.lock.writable");
}

function escapeHtml(value) {
    return String(value || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function normalizeCustomMediaRoots(value) {
    const source = Array.isArray(value)
        ? value
        : typeof value === "string"
            ? value.split(/\r?\n/g)
            : [];
    const out = [];
    const seen = new Set();
    for (const item of source) {
        const text = String(item || "").trim();
        if (!text || seen.has(text)) {
            continue;
        }
        seen.add(text);
        out.push(text);
    }
    return out;
}

function isCustomToken(value) {
    return /^custom_\d+$/i.test(String(value || "").trim());
}

function pathLeafName(pathText) {
    const text = String(pathText || "")
        .trim()
        .replace(/[\\/]+$/, "");
    if (!text) {
        return "";
    }
    const parts = text.split(/[\\/]/).filter(Boolean);
    return parts.pop() || text;
}

function resolveCustomRootLabel(segment, settings = {}) {
    if (!isCustomToken(segment)) {
        return String(segment || "");
    }
    const roots = normalizeCustomMediaRoots(settings.media_custom_roots);
    const match = /^custom_(\d+)$/i.exec(String(segment || "").trim());
    if (!match) {
        return String(segment || "");
    }
    const idx = Number.parseInt(match[1], 10) - 1;
    if (!Number.isInteger(idx) || idx < 0 || idx >= roots.length) {
        return String(segment || "");
    }
    return pathLeafName(roots[idx]) || String(segment || "");
}

function buildBreadcrumbPath(folder, folderLabel) {
    const rootLabel = folderLabel || t("nav.path.root");
    const normalized = String(folder || "")
        .replace(/\\/g, "/")
        .split("/")
        .map((part) => part.trim())
        .filter(Boolean);
    if (!normalized.length) {
        return rootLabel;
    }

    const settings = store.state.xdatahubSettings || {};
    const labels = normalized.map((part) =>
        resolveCustomRootLabel(part, settings)
    );

    const lastRaw = normalized[normalized.length - 1] || "";
    const lastLabel = String(folderLabel || "").trim();
    if (
        lastLabel
        && (!isCustomToken(lastLabel) || !isCustomToken(lastRaw))
    ) {
        labels[labels.length - 1] = lastLabel;
    }

    return labels.join(" / ");
}

export class XdhContentNav extends BaseElement {
    constructor() {
        super();
        this._searchExpanded = false;
        this._statusOpen = false;
        this._refreshPending = false;
        this._onDocumentClick = (event) => {
            if (this._statusOpen) {
                const statusWrap = this.$(".status-wrap");
                if (
                    statusWrap
                    && !event.composedPath().includes(statusWrap)
                ) {
                    this._statusOpen = false;
                    this._syncStatusPopover();
                }
            }
            if (this._searchExpanded) {
                const searchWrap = this.$(".search-wrap");
                if (
                    searchWrap
                    && !event.composedPath().includes(searchWrap)
                ) {
                    this._setSearchExpanded(false);
                }
            }
        };
        this._onDocumentKeydown = (event) => {
            if (event.key !== "Escape") return;
            if (this._statusOpen) {
                this._statusOpen = false;
                this._syncStatusPopover();
                return;
            }
            if (this._searchExpanded) {
                this._setSearchExpanded(false);
            }
        };
    }

    connectedCallback() {
        super.connectedCallback();
        document.addEventListener("click", this._onDocumentClick, true);
        document.addEventListener("keydown", this._onDocumentKeydown);
    }

    disconnectedCallback() {
        super.disconnectedCallback();
        document.removeEventListener("click", this._onDocumentClick, true);
        document.removeEventListener("keydown", this._onDocumentKeydown);
    }

    onStoreUpdate(state, key) {
        // Full re-render only for navigation/view-state changes
        if (["activeCategory", "activeFolder", "activeFolderLabel", "cardSize", "sortOrder", "navHistory", "navIndex", "currentPage", "locale", "folderTreeVisible", "favoritesOnly"].includes(key)) {
            this.renderRoot();
        } else if (key === "lockState") {
            this._syncLockState();
        } else if (key === "searchQuery") {
            this._syncSearchUI();
        }
    }

    _syncLockState() {
        const panel = this.$(".status-panel");
        const status = this.$(".nav-status");
        const text = this.$(".status-text");
        const popHead = this.$(".status-popover-head");
        const stateText = this.$(".status-detail-state");
        const queueRunning = this.$(".status-detail-running");
        const queuePending = this.$(".status-detail-pending");
        const readonly = this.$(".status-detail-readonly");
        const lastEvent = this.$(".status-detail-event");
        if (!panel || !status || !text) return;
        const lockState = store.state.lockState || {};
        const meta = lockMeta(lockState);
        status.dataset.state = meta.key;
        status.dataset.busy = lockState.is_executing ? "true" : "false";
        status.removeAttribute("title");
        panel.removeAttribute("title");
        panel.setAttribute("data-tooltip", meta.title);
        panel.setAttribute("aria-label", meta.title);
        text.textContent = meta.label;
        if (popHead) popHead.dataset.state = meta.key;
        if (stateText) stateText.textContent = meta.label;
        if (queueRunning) queueRunning.textContent = String(lockState.queue_running || 0);
        if (queuePending) queuePending.textContent = String(lockState.queue_pending || 0);
        if (readonly) readonly.textContent = lockReadonlyLabel(lockState.readonly);
        if (lastEvent) lastEvent.textContent = lockEventLabel(lockState.last_event);
    }

    _syncStatusPopover() {
        const wrap = this.$(".status-wrap");
        const panel = this.$(".status-panel");
        const pop = this.$(".status-popover");
        if (!wrap || !panel || !pop) return;
        wrap.classList.toggle("open", this._statusOpen);
        pop.classList.toggle("open", this._statusOpen);
        panel.setAttribute("aria-expanded", this._statusOpen ? "true" : "false");
    }

    _setSearchExpanded(expanded, options = {}) {
        this._searchExpanded = !!expanded;
        this._syncSearchUI();
        if (options.focus) {
            setTimeout(() => {
                const input = this.$(".search-input");
                if (!input) return;
                input.focus();
                input.select();
            }, 0);
        }
    }

    _syncSearchUI() {
        const wrap = this.$(".search-wrap");
        const btn = this.$(".search-btn");
        const popover = this.$(".search-popover");
        const input = this.$(".search-input");
        const clearBtn = this.$(".search-clear-btn");
        const query = String(store.state.searchQuery || "");
        const hasQuery = query.trim().length > 0;
        if (wrap) {
            wrap.classList.toggle("open", this._searchExpanded);
            wrap.classList.toggle("has-query", hasQuery);
        }
        if (btn) {
            btn.classList.toggle("active", this._searchExpanded || hasQuery);
        }
        if (popover) {
            popover.classList.toggle("open", this._searchExpanded);
        }
        if (input && input.value !== query) {
            input.value = query;
        }
        if (clearBtn) {
            clearBtn.disabled = !hasQuery;
        }
    }

    bindEvents() {
        const state = store.state;

        const statusPanel = this.$(".status-panel");
        if (statusPanel) {
            const toggleStatus = (event) => {
                event.stopPropagation();
                this._statusOpen = !this._statusOpen;
                this._syncStatusPopover();
            };
            statusPanel.addEventListener("click", toggleStatus);
            statusPanel.addEventListener("keydown", (event) => {
                if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    toggleStatus(event);
                }
            });
        }

        // Global: more drawer toggle
        const btnMore   = this.$(".global-more-btn");
        const drawer    = this.$(".global-drawer");
        if (btnMore && drawer) {
            btnMore.addEventListener("click", (e) => {
                drawer.classList.toggle("open");
                e.stopPropagation();
            });
            // Close on outside click (shadow root boundary)
            this.shadowRoot.addEventListener("click", (e) => {
                if (!btnMore.contains(e.target) && !drawer.contains(e.target)) {
                    drawer.classList.remove("open");
                }
            });
            drawer.querySelectorAll("[data-action]").forEach(item => {
                item.addEventListener("click", () => {
                    const action = item.dataset.action;
                    document.dispatchEvent(
                        new CustomEvent("xdh:menu-action", { detail: { action } })
                    );
                    drawer.classList.remove("open");
                });
            });
        }

        // Global: settings + lang (placeholder dispatch)
        this.$(".global-settings-btn")?.addEventListener("click", () => {
            document.dispatchEvent(new CustomEvent("xdh:open-settings"));
        });
        // Back / Forward / Home
        const btnBack = this.$(".nav-back");
        const btnFwd  = this.$(".nav-fwd");
        const btnHome = this.$(".nav-home");
        const btnRefresh = this.$(".nav-refresh");
        if (btnHome) btnHome.addEventListener("click", () => {
            if (!store.state.activeFolder) return;
            document.dispatchEvent(
                new CustomEvent("xdh:reset-main-scroll")
            );
            // 截断前进历史，追加"回到根目录"记录
            const newEntry = {
                category: store.state.activeCategory,
                folder: "",
                folderLabel: "",
                page: 1,
            };
            const truncated = store.state.navHistory.slice(
                0, store.state.navIndex + 1
            );
            truncated.push(newEntry);
            store.state.navHistory = truncated;
            store.state.navIndex   = truncated.length - 1;
            store.state.currentPage = 1;
            store.state.activeFolder = "";
            store.state.activeFolderLabel = "";
        });
        if (btnRefresh) btnRefresh.addEventListener("click", async () => {
            if (this._refreshPending) return;
            this._refreshPending = true;
            btnRefresh.disabled = true;
            btnRefresh.classList.add("refreshing");
            const origTooltip = btnRefresh.getAttribute("data-tooltip");
            btnRefresh.setAttribute("data-tooltip", t("nav.btn.refreshing"));
            const category = String(store.state.activeCategory || "");
            const shouldBlock = ["image", "video", "audio", "lora"].includes(category);
            if (shouldBlock) {
                store.state.dbTaskBusy = true;
            }
            try {
                if (["image", "video", "audio"].includes(category)) {
                    await apiPost("/xz3r0/xdatahub/media/refresh", {
                        media_type: category,
                    });
                    banner.success(t("nav.banner.refresh_ok"));
                } else if (category === "lora") {
                    await apiPost("/xz3r0/xdatahub/loras/refresh", {});
                    await apiPost("/xz3r0/xdatahub/loras/cleanup-invalid", {});
                    banner.success(t("nav.banner.refresh_ok"));
                }
                store.state.refreshTrigger = Date.now();
            } catch {
                if (shouldBlock) {
                    store.state.dbTaskBusy = false;
                }
                banner.error(t("nav.banner.refresh_fail"));
            } finally {
                this._refreshPending = false;
                btnRefresh.disabled = false;
                btnRefresh.classList.remove("refreshing");
                btnRefresh.setAttribute("data-tooltip", origTooltip);
            }
        });
        if (btnBack) btnBack.addEventListener("click", () => {
            const idx = store.state.navIndex;
            if (idx <= 0) return;
            const entry = store.state.navHistory[idx - 1];
            document.dispatchEvent(
                new CustomEvent("xdh:reset-main-scroll")
            );
            store.state._navSkipPush = true;
            store.state.navIndex = idx - 1;
            if (entry.folder !== undefined) store.state.activeFolder = entry.folder;
            store.state.activeFolderLabel = entry.folderLabel || "";
            store.state.currentPage = entry.page || 1;
            store.state.activeCategory = entry.category;
        });
        if (btnFwd) btnFwd.addEventListener("click", () => {
            const idx   = store.state.navIndex;
            const hist  = store.state.navHistory;
            if (idx >= hist.length - 1) return;
            const entry = hist[idx + 1];
            document.dispatchEvent(
                new CustomEvent("xdh:reset-main-scroll")
            );
            store.state._navSkipPush = true;
            store.state.navIndex = idx + 1;
            if (entry.folder !== undefined) store.state.activeFolder = entry.folder;
            store.state.activeFolderLabel = entry.folderLabel || "";
            store.state.currentPage = entry.page || 1;
            store.state.activeCategory = entry.category;
        });

        // Sort cycle
        const btnSort = this.$(".sort-btn");
        if (btnSort) btnSort.addEventListener("click", () => {
            const opts = getSortOptions();
            const keys = opts.map(o => o.key);
            const cur  = store.state.sortOrder || "date-desc";
            store.state.sortOrder = keys[(keys.indexOf(cur) + 1) % keys.length];
        });

        // Card size — single cycle button
        const SIZES = ["small", "medium", "large"];
        this.$(".size-cycle-btn")?.addEventListener("click", () => {
            const cur = store.state.cardSize || "small";
            store.state.cardSize = SIZES[(SIZES.indexOf(cur) + 1) % SIZES.length];
        });

        this.$(".fav-toggle-btn")?.addEventListener("click", () => {
            store.state.favoritesOnly = !store.state.favoritesOnly;
        });

        this.$(".tree-toggle-btn")?.addEventListener("click", () => {
            store.state.folderTreeVisible = !store.state.folderTreeVisible;
        });

        // Search popover
        const btnSearch   = this.$(".search-btn");
        const inputSearch = this.$(".search-input");
        const clearSearch = this.$(".search-clear-btn");
        if (btnSearch && inputSearch) {
            btnSearch.addEventListener("click", (event) => {
                event.stopPropagation();
                if (this._searchExpanded) {
                    this._setSearchExpanded(false);
                } else {
                    this._setSearchExpanded(true, { focus: true });
                }
            });
            inputSearch.addEventListener("input", () => {
                store.state.searchQuery = inputSearch.value;
            });
            inputSearch.addEventListener("keydown", e => {
                if (e.key === "Escape") {
                    e.stopPropagation();
                    this._setSearchExpanded(false);
                }
            });
            clearSearch?.addEventListener("click", (event) => {
                event.stopPropagation();
                store.state.searchQuery = "";
                this._syncSearchUI();
                inputSearch.focus();
            });
        }

        this._syncSearchUI();
        this._syncStatusPopover();
        this._syncLockState();
    }

    render() {
        const state      = store.state;
        const canBack    = (state.navIndex || 0) > 0;
        const canFwd     = (state.navIndex || 0) < ((state.navHistory || []).length - 1);
        const sortOpts   = getSortOptions();
        const sortOpt    = sortOpts.find(o => o.key === state.sortOrder) || sortOpts[0];
        const cardSize   = state.cardSize || "small";
        const mediaList  = state.mediaList || [];
        const selItems   = state.selectedItems || [];
        const allSel     = mediaList.length > 0 && mediaList.every(i => selItems.includes(i.id));
        const folder     = state.activeFolder || "";
        const folderLabel = state.activeFolderLabel || folder || t("nav.path.root");
        const breadcrumbPath = buildBreadcrumbPath(folder, folderLabel);
        const breadcrumbPathEscaped = escapeHtml(breadcrumbPath);
        const lock       = lockMeta(state.lockState || {});
        const isRecordView = ["history", "favorites"].includes(state.activeCategory);
        const isMediaView = ["image", "video", "audio", "lora"].includes(state.activeCategory);
        const favTooltip = state.favoritesOnly
            ? t("nav.btn.show_all")
            : t("nav.btn.favorites_only");
        const treeTooltip = state.folderTreeVisible
            ? t("nav.btn.hide_tree")
            : t("nav.btn.show_tree");

        return `
            <style>
                ${ICON_CSS}
                :host { display: block; }

                .nav-layout {
                    display: grid;
                    grid-template-columns: 48px minmax(0, 1fr);
                    grid-template-rows: auto auto;
                    background: var(--xdh-color-surface-1);
                    border-bottom: 1px solid var(--xdh-color-border);
                    position: relative;
                }

                /* ── Two-row nav ── */
                .nav-row {
                    display: flex;
                    align-items: center;
                    gap: var(--xdh-space-xs);
                    padding: 3px var(--xdh-space-sm);
                    container-type: inline-size;
                    container-name: nav;
                    min-width: 0;
                }
                .nav-row-path  {
                    grid-column: 2;
                    grid-row: 1;
                    border-bottom: 1px solid var(--xdh-color-border);
                    min-height: 32px;
                    overflow: hidden;
                }
                .nav-row-tools {
                    grid-column: 2;
                    grid-row: 2;
                    min-height: 34px;
                    overflow: visible;
                    position: relative;
                }

                .status-wrap {
                    grid-column: 1;
                    grid-row: 1 / span 2;
                    position: relative;
                    z-index: 3;
                }
                .status-panel {
                    width: 100%;
                    height: 100%;
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                    border-right: 1px solid var(--xdh-color-border);
                    box-sizing: border-box;
                    flex-shrink: 0;
                    gap: var(--xdh-space-xs);
                    padding: var(--xdh-space-xs) 3px 6px;
                    background: var(--xdh-color-surface-1);
                    box-shadow:
                        inset 0 1px 0 color-mix(in srgb, var(--xdh-color-text-primary) 6%, transparent),
                        inset -1px 0 0 color-mix(in srgb, var(--xdh-color-surface-4) 22%, transparent);
                    cursor: pointer;
                    transition: background 0.16s ease;
                    outline: none;
                }
                .status-panel:hover,
                .status-wrap.open .status-panel {
                    background: var(--xdh-color-surface-2);
                }
                .status-panel:focus-visible {
                    box-shadow:
                        inset 0 1px 0 color-mix(in srgb, var(--xdh-color-text-primary) 6%, transparent),
                        inset -1px 0 0 color-mix(in srgb, var(--xdh-color-surface-4) 22%, transparent),
                        inset 0 0 0 1px color-mix(in srgb, var(--xdh-color-primary) 50%, transparent);
                }
                .nav-status {
                    width: 11px;
                    height: 11px;
                    border-radius: var(--xdh-radius-full);
                    background: var(--xdh-color-success);
                    box-shadow: 0 0 0 2px var(--xdh-color-surface-1);
                    position: relative;
                    flex-shrink: 0;
                }
                .nav-status::after {
                    content: "";
                    position: absolute;
                    inset: -4px;
                    border-radius: inherit;
                    opacity: 0;
                    transition: opacity 0.18s ease;
                }
                .nav-status[data-state="idle"] {
                    background: var(--xdh-color-success);
                    color: var(--xdh-color-success);
                }
                .nav-status[data-state="running"] {
                    background: var(--xdh-color-primary);
                    color: var(--xdh-color-primary);
                }
                .nav-status[data-state="queued"] {
                    background: var(--db-palette-11);
                    color: var(--db-palette-11);
                }
                .nav-status[data-state="stopping"] {
                    background: var(--db-palette-09);
                    color: var(--db-palette-09);
                }
                .nav-status[data-busy="true"]::after {
                    opacity: 1;
                    background: currentColor;
                    animation: nav-status-pulse 1.6s ease-out infinite;
                }
                @keyframes nav-status-pulse {
                    0% { transform: scale(0.7); opacity: 0.45; }
                    70% { transform: scale(1.6); opacity: 0; }
                    100% { transform: scale(1.6); opacity: 0; }
                }
                @keyframes xdh-spin {
                    to { transform: rotate(360deg); }
                }

                button {
                    background: transparent;
                    border: 1px solid transparent;
                    color: var(--xdh-color-text-secondary);
                    border-radius: var(--xdh-radius-sm);
                    cursor: pointer;
                    height: 28px;
                    padding: 0 var(--xdh-space-sm);
                    font: var(--xdh-font-micro-label);
                    white-space: nowrap;
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    gap: var(--xdh-space-xs);
                    box-sizing: border-box;
                    transition: background 0.14s, color 0.14s;
                    flex-shrink: 0;
                }
                button:hover { background: var(--xdh-color-hover); color: var(--xdh-color-text-primary); }
                button:disabled { opacity: 0.3; cursor: not-allowed; }
                button.active {
                    background-color: var(--xdh-color-primary-muted);
                    color: var(--xdh-color-primary);
                    border-color: var(--xdh-color-primary);
                }

                .nav-arrow { font-size: 14px; width: 28px; padding: 0; }
                .nav-refresh.refreshing { opacity: 1; }
                .nav-refresh.refreshing .xdh-icon {
                    animation: xdh-spin 0.8s linear infinite;
                }

                /* ── Row 1: Breadcrumb ── */
                .breadcrumb {
                    display: flex; align-items: center; gap: var(--xdh-space-sm);
                    flex: 1; min-width: 0; overflow: hidden;
                    background: var(--xdh-color-surface-2);
                    padding: 4px var(--xdh-space-sm);
                    border-radius: var(--xdh-radius-sm);
                    border: 1px solid var(--xdh-color-border);
                    font: var(--xdh-font-body-sm);
                }
                .bc-icon  { flex-shrink: 0; display: flex; align-items: center; }
                .bc-label { font-weight: 600; color: var(--xdh-color-text-primary); white-space: nowrap; }
                .bc-sep   { color: var(--xdh-color-text-secondary); flex-shrink: 0; }
                .bc-folder {
                    color: var(--xdh-color-text-secondary);
                    white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0;
                }
                .status-text {
                    display: block;
                    font: var(--xdh-font-uppercase-tag);
                    color: var(--xdh-color-text-secondary);
                    letter-spacing: 0.02em;
                    text-align: center;
                    white-space: nowrap;
                    overflow: hidden;
                    max-width: 44px;
                    opacity: 0.9;
                }
                .status-popover {
                    position: absolute;
                    top: 6px;
                    left: calc(100% + 8px);
                    width: 168px;
                    padding: 10px var(--xdh-space-sm) 9px;
                    border: 1px solid var(--xdh-color-border);
                    border-radius: var(--xdh-radius-md);
                    background: var(--xdh-color-surface-2);
                    box-shadow: var(--xdh-shadow-dialog);
                    display: none;
                }
                .status-popover.open {
                    display: block;
                }
                .status-popover::before {
                    content: "";
                    position: absolute;
                    left: -6px;
                    top: 16px;
                    width: 10px;
                    height: 10px;
                    background: inherit;
                    border-left: 1px solid var(--xdh-color-border);
                    border-bottom: 1px solid var(--xdh-color-border);
                    transform: rotate(45deg);
                }
                .status-popover-head {
                    display: flex;
                    align-items: center;
                    gap: var(--xdh-space-sm);
                    margin-bottom: 9px;
                    padding-bottom: var(--xdh-space-sm);
                    border-bottom: 1px solid color-mix(in srgb, var(--xdh-color-border) 80%, transparent);
                }
                .status-popover-dot {
                    width: 9px;
                    height: 9px;
                    border-radius: var(--xdh-radius-full);
                    background: currentColor;
                    flex-shrink: 0;
                }
                .status-popover-head[data-state="idle"] {
                    color: var(--xdh-color-success);
                }
                .status-popover-head[data-state="running"] {
                    color: var(--xdh-color-primary);
                }
                .status-popover-head[data-state="queued"] {
                    color: var(--db-palette-11);
                }
                .status-popover-head[data-state="stopping"] {
                    color: var(--db-palette-09);
                }
                .status-popover-title {
                    font: var(--xdh-font-micro-label);
                    color: var(--xdh-color-text-primary);
                    min-width: 0;
                }
                .status-grid {
                    display: grid;
                    grid-template-columns: 1fr auto;
                    row-gap: 7px;
                    column-gap: 12px;
                    align-items: center;
                }
                .status-key {
                    font: var(--xdh-font-badge);
                    color: var(--xdh-color-text-secondary);
                }
                .status-val {
                    font: 600 11px/1.18 var(--xdh-font-family-base);
                    color: var(--xdh-color-text-primary);
                    text-align: right;
                }

                /* ── Row 2: Tools ── */
                .divider { width: 1px; height: 14px; background: var(--xdh-color-border); margin: 0 var(--xdh-space-xxs); flex-shrink: 0; }

                .search-wrap {
                    position: relative;
                    display: flex;
                    align-items: center;
                }
                .search-btn  { font-size: 13px; width: 28px; padding: 0; }
                .search-popover {
                    position: absolute;
                    top: calc(100% + 6px);
                    left: 0;
                    min-width: 230px;
                    display: flex;
                    align-items: center;
                    gap: var(--xdh-space-sm);
                    padding: var(--xdh-space-sm);
                    border: 1px solid var(--xdh-color-border);
                    border-radius: var(--xdh-radius-sm);
                    background: var(--xdh-color-surface-2);
                    box-shadow: var(--xdh-shadow-dialog);
                    opacity: 0;
                    pointer-events: none;
                    transform: translateY(-4px);
                    transition: opacity 0.18s ease, transform 0.18s ease;
                    z-index: 210;
                }
                .search-popover.open,
                .search-wrap.open .search-popover {
                    opacity: 1;
                    pointer-events: auto;
                    transform: translateY(0);
                }
                .search-input {
                    flex: 1;
                    min-width: 0;
                    height: 28px;
                    padding: 0 var(--xdh-space-sm);
                    border: 1px solid var(--xdh-color-border);
                    background: var(--xdh-color-surface-1);
                    color: var(--xdh-color-text-primary);
                    border-radius: var(--xdh-radius-sm);
                    font: var(--xdh-font-micro-label);
                    outline: none;
                    transition: border-color 0.15s ease;
                }
                .search-input:focus {
                    border-color: var(--xdh-color-primary);
                }
                .search-clear-btn {
                    width: 28px;
                    padding: 0;
                    border: 1px solid var(--xdh-color-border);
                }
                .search-clear-btn:disabled {
                    opacity: 0.32;
                }

                .size-cycle-btn,
                .tree-toggle-btn,
                .global-more-btn,
                .global-settings-btn { width: 28px; padding: 0; }

                .label { transition: opacity 0.12s; }

                /* Global group — always pinned to right */
                .global-group {
                    display: flex; align-items: center; gap: 0;
                    margin-left: auto;
                    flex-shrink: 0;
                }
                .global-more-wrap { position: relative; }
                .global-drawer {
                    display: none; position: absolute; right: 0; top: calc(100% + 4px);
                    background: var(--xdh-color-surface-2);
                    border: 1px solid var(--xdh-color-border);
                    border-radius: var(--xdh-radius-sm); min-width: 170px; z-index: 200; padding: var(--xdh-space-xs) 0;
                    box-shadow: var(--xdh-shadow-popup);
                }
                .global-drawer.open { display: block; }
                .drawer-item {
                    padding: 9px 14px; font-size: 13px;
                    color: var(--xdh-color-text-primary);
                    cursor: pointer; white-space: nowrap;
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    border-radius: calc(var(--xdh-radius-sm) - 2px);
                    margin: 0 var(--xdh-space-xs);
                    outline: none;
                    transition:
                        background-color 0.12s ease,
                        color 0.12s ease,
                        box-shadow 0.12s ease;
                }
                .drawer-item:hover,
                .drawer-item:focus-visible {
                    background: color-mix(
                        in srgb, var(--xdh-color-text-primary) 10%,
                        var(--xdh-color-surface-2) 90%
                    );
                    color: var(--xdh-color-text-primary);
                    box-shadow:
                        inset 0 0 0 1px color-mix(
                            in srgb, var(--xdh-color-text-primary) 16%,
                            transparent
                        );
                }
                .drawer-item:active {
                    background: color-mix(
                        in srgb, var(--xdh-color-text-primary) 14%,
                        var(--xdh-color-surface-2) 86%
                    );
                    box-shadow:
                        inset 0 0 0 1px color-mix(
                            in srgb, var(--xdh-color-text-primary) 20%,
                            transparent
                        );
                }
                .drawer-sep { height: 1px; background: var(--xdh-color-border); margin: 3px 0; }
                .drawer-item.danger { color: #e06060; }
                .drawer-item.danger:hover,
                .drawer-item.danger:focus-visible {
                    background: color-mix(
                        in srgb, var(--xdh-clr-error) 16%, transparent
                    );
                    box-shadow:
                        inset 0 0 0 1px color-mix(
                            in srgb, var(--xdh-clr-error) 24%,
                            transparent
                        );
                }

                @container nav (max-width: 360px) { .label { display: none; } }
                @container nav (max-width: 280px) { .size-cycle-btn { display: none; } }
                ${TOOLTIP_CSS}
            </style>

            <div class="nav-layout">
                <div class="status-wrap">
                <div class="status-panel xdh-tooltip xdh-tooltip-down" data-tooltip="${lock.title}" role="button" tabindex="0" aria-expanded="false" aria-haspopup="dialog">
                    <div class="nav-status" data-state="${lock.key}" data-busy="${state.lockState?.is_executing ? "true" : "false"}"></div>
                    <span class="status-text">${lock.label}</span>
                </div>
                <div class="status-popover" role="dialog" aria-label="${t("nav.status.aria_label")}">
                    <div class="status-popover-head" data-state="${lock.key}">
                        <span class="status-popover-dot"></span>
                        <span class="status-popover-title status-detail-state">${lock.label}</span>
                    </div>
                    <div class="status-grid">
                        <span class="status-key">${t("nav.status.running")}</span>
                        <span class="status-val status-detail-running">${state.lockState?.queue_running || 0}</span>
                        <span class="status-key">${t("nav.status.pending")}</span>
                        <span class="status-val status-detail-pending">${state.lockState?.queue_pending || 0}</span>
                        <span class="status-key">${t("nav.status.write_state")}</span>
                        <span class="status-val status-detail-readonly">${lockReadonlyLabel(state.lockState?.readonly)}</span>
                        <span class="status-key">${t("nav.status.last_event")}</span>
                        <span class="status-val status-detail-event">${lockEventLabel(state.lockState?.last_event)}</span>
                    </div>
                </div>
                </div>

            <!-- Row 1: Path -->
            <div class="nav-row nav-row-path">
                <button class="nav-arrow nav-back xdh-tooltip xdh-tooltip-down" data-tooltip="${t("nav.btn.back")}" ${canBack ? "" : "disabled"}>${icon('arrow-left', 14)}</button>
                <button class="nav-arrow nav-fwd xdh-tooltip xdh-tooltip-down"  data-tooltip="${t("nav.btn.forward")}" ${canFwd ? "" : "disabled"}>${icon('arrow-right', 14)}</button>
                <div class="divider" style="margin: 0 4px;"></div>
                <button class="nav-arrow nav-refresh xdh-tooltip xdh-tooltip-down" data-tooltip="${t("nav.btn.refresh")}">${icon('refresh-cw', 15)}</button>
                <button class="nav-arrow nav-home xdh-tooltip xdh-tooltip-down" data-tooltip="${t("nav.btn.home")}" ${folder ? "" : "disabled"}>${icon('house', 15)}</button>
                <div class="breadcrumb" style="margin-left: 4px;">
                    <span class="bc-folder xdh-tooltip xdh-tooltip-down" data-tooltip="${breadcrumbPathEscaped}">${breadcrumbPathEscaped}</span>
                </div>
            </div>

            <!-- Row 2: Tools -->
            <div class="nav-row nav-row-tools">
                <button class="tree-toggle-btn xdh-tooltip xdh-tooltip-down ${state.folderTreeVisible ? "active" : ""}" data-tooltip="${treeTooltip}" style="display:${isRecordView ? 'none' : ''}">${icon('folder-tree', 14)}</button>
                <div class="divider" style="display:${isRecordView ? 'none' : 'block'};"></div>
                <button class="size-cycle-btn xdh-tooltip xdh-tooltip-down" data-tooltip="${t('nav.btn.size_' + cardSize)}" style="display:${isRecordView ? 'none' : ''}">${icon('layout-grid', 14)}</button>
                <div class="divider"></div>
                <div class="search-wrap ${this._searchExpanded ? "open" : ""} ${(state.searchQuery || "").trim() ? "has-query" : ""}">
                    <button class="search-btn xdh-tooltip xdh-tooltip-down ${this._searchExpanded || (state.searchQuery || "").trim() ? "active" : ""}"
                            data-tooltip="${t("nav.btn.search")}">${icon('search', 14)}</button>
                    <div class="search-popover ${this._searchExpanded ? "open" : ""}">
                        <input class="search-input" type="text" aria-label="${t("nav.btn.search")}"
                               placeholder="${t("nav.btn.search_placeholder")}"
                               value="${(state.searchQuery || "").replace(/"/g, "&quot;")}" />
                        <button class="search-clear-btn xdh-tooltip xdh-tooltip-down"
                                data-tooltip="${t("common.clear")}">
                            ${icon('x', 12)}
                        </button>
                    </div>
                </div>
                <div class="divider"></div>
                <button class="sort-btn xdh-tooltip xdh-tooltip-down" data-tooltip="${t("nav.btn.sort_title", { label: sortOpt.label })}">
                    ${icon('list-filter', 13)} <span class="label">${sortOpt.label}</span>
                </button>
                <div class="divider"></div>
                <button class="fav-toggle-btn xdh-tooltip xdh-tooltip-down ${state.favoritesOnly ? "active" : ""}"
                        data-tooltip="${favTooltip}"
                        style="display:${isMediaView ? "" : "none"}">
                    ${icon('star', 14)}
                </button>
                <div style="flex:1"></div>

                <div class="global-group">
                    <div class="global-more-wrap">
                        <button class="global-more-btn xdh-tooltip xdh-tooltip-down" data-tooltip="${t("nav.btn.more")}">${icon('ellipsis-vertical', 14)}</button>
                        <div class="global-drawer">
                            <div class="drawer-item" data-action="clean-index">${icon('database', 14)} ${t("nav.drawer.clean_index")}</div>
                            <div class="drawer-sep"></div>
                            <div class="drawer-item" data-action="open-db-folder">${icon('folder-open', 14)} ${t("nav.drawer.open_db_folder")}</div>
                        </div>
                    </div>
                    <div class="divider" aria-hidden="true"></div>
                    <button class="global-settings-btn xdh-tooltip xdh-tooltip-down" data-tooltip="${t("nav.btn.settings")}">${icon('settings', 14)}</button>
                </div>
            </div>
            </div>
        `;
    }
}

registerCustomElement("xdh-content-nav", XdhContentNav);
