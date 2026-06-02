import {
    BaseElement,
    registerCustomElement,
} from "../core/base-element.js?v=20260403-2";
import { appStore as store } from "../core/store.js";
import {
    loadMediaList,
    loadLoraList,
} from "../core/api.js?v=20260403-413";
import {
    icon,
    ICON_CSS,
    SCROLLBAR_CSS,
    TOOLTIP_CSS,
} from "../core/icon.js";
import { t } from "../core/i18n.js?v=20260406-15";

const MEDIA_CATEGORIES = new Set(["image", "video", "audio"]);
const TREE_PAGE_SIZE = 200;
const TREE_EXPANDED_STATE_STORAGE_KEY = "XDataHub.V2.TreeExpandedState.v2";
const TREE_STATE_CATEGORIES = ["image", "video", "audio", "lora"];
const TREE_WIDTH_STORAGE_KEY = "XDataHub.V2.TreeWidth";
const TREE_MIN_WIDTH = 140;
const TREE_DEFAULT_WIDTH = 220;

function createCacheEntry() {
    return {
        status: "idle",
        items: [],
        error: "",
        promise: null,
    };
}

function escapeHtml(value) {
    return String(value || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function normalizePath(value) {
    return String(value || "")
        .replace(/\\/g, "/")
        .replace(/^\/+|\/+$/g, "")
        .trim();
}

function getPathLabel(pathText, fallback = "") {
    const fallbackLabel = String(fallback || "").trim();
    if (fallbackLabel) {
        return fallbackLabel;
    }

    const normalized = normalizePath(pathText);
    if (!normalized) {
        return t("nav.path.root");
    }

    const parts = normalized.split("/").filter(Boolean);
    return parts[parts.length - 1] || normalized;
}

function getAncestorPaths(pathText) {
    const normalized = normalizePath(pathText);
    if (!normalized) {
        return [];
    }

    const segments = normalized.split("/").filter(Boolean);
    const result = [];
    let current = "";
    segments.forEach((segment) => {
        current = current ? `${current}/${segment}` : segment;
        result.push(current);
    });
    return result;
}

function compareFolderNodes(left, right) {
    return String(left.label || "").localeCompare(
        String(right.label || ""),
        store.state.locale || undefined,
        {
            numeric: true,
            sensitivity: "base",
        }
    );
}

function loadExpandedStateByCategory() {
    const expandedByCategory = new Map();
    try {
        const raw = localStorage.getItem(TREE_EXPANDED_STATE_STORAGE_KEY) || "";
        const parsed = raw ? JSON.parse(raw) : {};
        TREE_STATE_CATEGORIES.forEach((category) => {
            const expanded = new Set([""]);
            const stored = Array.isArray(parsed?.[category])
                ? parsed[category]
                : [];
            stored
                .map((path) => normalizePath(path))
                .filter(Boolean)
                .forEach((path) => expanded.add(path));
            expandedByCategory.set(category, expanded);
        });
    } catch {
        // ignore localStorage read errors
    }
    return expandedByCategory;
}

function persistExpandedStateByCategory(expandedByCategory) {
    try {
        const payload = {};
        TREE_STATE_CATEGORIES.forEach((category) => {
            const expanded = expandedByCategory.get(category);
            payload[category] = expanded
                ? Array.from(expanded)
                    .map((path) => normalizePath(path))
                    .filter(Boolean)
                : [];
        });
        localStorage.setItem(
            TREE_EXPANDED_STATE_STORAGE_KEY,
            JSON.stringify(payload)
        );
    } catch {
        // ignore localStorage write errors
    }
}

export class XdhFolderTree extends BaseElement {
    constructor() {
        super();
        this._cacheByCategory = new Map();
        this._expandedByCategory = loadExpandedStateByCategory();
        this._syncToken = 0;
        this._treeScrollTop = 0;
        this._treeScrollLeft = 0;
        this._treeWidth = TREE_DEFAULT_WIDTH;
        this._isResizing = false;
        this._resizeStartX = 0;
        this._resizeStartWidth = TREE_DEFAULT_WIDTH;
        this._parentResizeObserver = null;
    }

    connectedCallback() {
        super.connectedCallback();
        this._loadSavedWidth();
        this._clampToMaxWidth();
        this._applyTreeWidth();
        this._syncHostState();
        void this._syncTreeState();
        this._startParentResizeObserver();
    }

    disconnectedCallback() {
        super.disconnectedCallback();
        if (this._parentResizeObserver) {
            this._parentResizeObserver.disconnect();
            this._parentResizeObserver = null;
        }
    }

    renderRoot() {
        const scroller = this.$(".tree-scroll");
        if (scroller instanceof HTMLElement) {
            this._treeScrollTop = scroller.scrollTop;
            this._treeScrollLeft = scroller.scrollLeft;
        }

        super.renderRoot();

        const nextScroller = this.$(".tree-scroll");
        if (nextScroller instanceof HTMLElement) {
            nextScroller.scrollTop = this._treeScrollTop;
            nextScroller.scrollLeft = this._treeScrollLeft;
        }
    }

    onStoreUpdate(state, key) {
        if (
            ![
                "activeCategory",
                "activeFolder",
                "folderTreeVisible",
                "locale",
                "categoryViewToken",
                "refreshTrigger",
            ].includes(key)
        ) {
            return;
        }

        if (state._categoryViewSyncing === true && key !== "categoryViewToken") {
            return;
        }

        if (key === "refreshTrigger") {
            this._invalidateCategory(state.activeCategory);
        }

        this._syncHostState(state);

        if (key === "locale") {
            this.renderRoot();
        }

        void this._syncTreeState(state);
    }

    _syncHostState(state = store.state) {
        const supported = this._isSupportedCategory(state.activeCategory);
        const visible = !!state.folderTreeVisible && supported;
        this.dataset.supported = supported ? "true" : "false";
        this.dataset.visible = visible ? "true" : "false";
    }

    _isSupportedCategory(category) {
        const kind = String(category || "");
        return MEDIA_CATEGORIES.has(kind) || kind === "lora";
    }

    _getCategoryCache(category) {
        const safeCategory = String(category || "");
        let cache = this._cacheByCategory.get(safeCategory);
        if (!cache) {
            cache = new Map();
            this._cacheByCategory.set(safeCategory, cache);
        }
        return cache;
    }

    _getExpandedSet(category) {
        const safeCategory = String(category || "");
        let expanded = this._expandedByCategory.get(safeCategory);
        if (!expanded) {
            expanded = new Set([""]);
            this._expandedByCategory.set(safeCategory, expanded);
        }
        expanded.add("");
        return expanded;
    }

    _persistExpandedState() {
        persistExpandedStateByCategory(this._expandedByCategory);
    }

    _invalidateCategory(category) {
        this._cacheByCategory.delete(String(category || ""));
    }

    async _syncTreeState(state = store.state) {
        const category = String(state.activeCategory || "");
        const visible = !!state.folderTreeVisible
            && this._isSupportedCategory(category);
        const token = ++this._syncToken;

        if (!visible) {
            this.renderRoot();
            return;
        }

        try {
            await this._ensurePathReady(category, state.activeFolder || "");
        } finally {
            if (token === this._syncToken) {
                this.renderRoot();
            }
        }
    }

    async _ensurePathReady(category, activeFolder) {
        const expanded = this._getExpandedSet(category);
        expanded.add("");
        await this._ensureChildrenLoaded(category, "");

        const chain = getAncestorPaths(activeFolder);
        for (const path of chain) {
            expanded.add(path);
            await this._ensureChildrenLoaded(category, path);
        }
        if (chain.length > 0) {
            this._persistExpandedState();
        }
    }

    async _ensureChildrenLoaded(category, pathText, options = {}) {
        const safeCategory = String(category || "");
        const safePath = normalizePath(pathText);
        const cache = this._getCategoryCache(safeCategory);
        let entry = cache.get(safePath);

        if (!entry) {
            entry = createCacheEntry();
            cache.set(safePath, entry);
        }

        if (!options.force && entry.status === "ready") {
            return entry;
        }
        if (!options.force && entry.promise) {
            return entry.promise;
        }

        entry.status = "loading";
        entry.error = "";
        this.renderRoot();

        const promise = this._loadChildFolders(safeCategory, safePath)
            .then((items) => {
                entry.status = "ready";
                entry.items = items;
                entry.error = "";
                entry.promise = null;
                cache.set(safePath, entry);
                this.renderRoot();
                return entry;
            })
            .catch((error) => {
                entry.status = "error";
                entry.items = [];
                entry.error = String(error?.message || error || "");
                entry.promise = null;
                cache.set(safePath, entry);
                this.renderRoot();
                return entry;
            });

        entry.promise = promise;
        return promise;
    }

    async _loadChildFolders(category, folderPath) {
        let response;
        if (category === "lora") {
            response = await loadLoraList(
                1,
                TREE_PAGE_SIZE,
                folderPath,
                "name",
                "asc"
            );
        } else {
            response = await loadMediaList(
                category,
                1,
                TREE_PAGE_SIZE,
                folderPath,
                "name",
                "asc"
            );
        }

        const rawItems = Array.isArray(response?.items)
            ? response.items
            : Array.isArray(response?.data)
                ? response.data
                : [];

        return rawItems
            .filter((item) => item?.kind === "folder")
            .map((item) => {
                const childPath = normalizePath(
                    item?.extra?.child_path || item?.path || ""
                );
                return {
                    path: childPath,
                    label: getPathLabel(childPath, item?.title || item?.path),
                };
            })
            .filter((item) => item.path)
            .sort(compareFolderNodes);
    }

    _toggleExpanded(pathText) {
        const category = String(store.state.activeCategory || "");
        const path = normalizePath(pathText);
        const expanded = this._getExpandedSet(category);

        if (expanded.has(path)) {
            expanded.delete(path);
            this._persistExpandedState();
            this.renderRoot();
            return;
        }

        expanded.add(path);
        this._persistExpandedState();
        this.renderRoot();
        void this._ensureChildrenLoaded(category, path);
    }

    _handleRowClick(pathText, label) {
        const category = String(store.state.activeCategory || "");
        const path = normalizePath(pathText);
        const currentFolder = normalizePath(store.state.activeFolder || "");

        if (!path) {
            this._navigateToFolder("", "");
            return;
        }

        if (path !== currentFolder) {
            this._navigateToFolder(path, label);
            return;
        }

        const expanded = this._getExpandedSet(category);
        if (expanded.has(path)) {
            expanded.delete(path);
            this._persistExpandedState();
            this.renderRoot();
            return;
        }

        expanded.add(path);
        this._persistExpandedState();
        this.renderRoot();
        void this._ensureChildrenLoaded(category, path);
    }

    _collapseAll() {
        const category = String(store.state.activeCategory || "");
        this._expandedByCategory.set(category, new Set([""]));
        this._persistExpandedState();
        this.renderRoot();
    }

    _navigateToFolder(pathText, label) {
        const nextFolder = normalizePath(pathText);
        const nextLabel = nextFolder ? getPathLabel(nextFolder, label) : "";
        const currentFolder = normalizePath(store.state.activeFolder || "");
        const currentPage = Number(store.state.currentPage || 1);

        if (nextFolder === currentFolder && currentPage === 1) {
            return;
        }

        const truncated = store.state.navHistory.slice(
            0,
            store.state.navIndex + 1
        );
        truncated.push({
            category: store.state.activeCategory,
            folder: nextFolder,
            folderLabel: nextLabel,
            page: 1,
        });
        document.dispatchEvent(
            new CustomEvent("xdh:reset-main-scroll")
        );
        store.state.navHistory = truncated;
        store.state.navIndex = truncated.length - 1;
        store.state.currentPage = 1;
        store.state.activeFolder = nextFolder;
        store.state.activeFolderLabel = nextLabel;
        store.state.selectedItems = [];
    }

    _renderStatusRow(message, depth, tone = "muted") {
        const paddingLeft = 14 + (depth * 14);
        return `
            <div class="tree-status is-${tone}" style="padding-left:${paddingLeft}px;">
                ${escapeHtml(message)}
            </div>`;
    }

    _renderNode(node, depth, activePath, category) {
        const path = normalizePath(node.path);
        const expanded = this._getExpandedSet(category).has(path);
        const cache = this._getCategoryCache(category).get(path);
        const hasLoadedChildren = cache?.status === "ready";
        const showToggle = !hasLoadedChildren || (cache.items || []).length > 0;
        const isActive = path === activePath;
        const paddingLeft = 8 + (depth * 14);
        const toggleTooltip = expanded
            ? t("nav.tree.collapse")
            : t("nav.tree.expand");
        let childrenHtml = "";

        if (expanded) {
            if (cache?.status === "loading") {
                childrenHtml = this._renderStatusRow(
                    t("nav.tree.loading"),
                    depth + 1
                );
            } else if (cache?.status === "error") {
                childrenHtml = this._renderStatusRow(
                    t("nav.tree.error"),
                    depth + 1,
                    "danger"
                );
            } else if (cache?.status === "ready" && cache.items.length > 0) {
                childrenHtml = cache.items
                    .map((child) =>
                        this._renderNode(child, depth + 1, activePath, category)
                    )
                    .join("");
            }
        }

        return `
            <div class="tree-node">
                <div class="tree-row ${isActive ? "is-active" : ""} xdh-tooltip"
                     data-path="${escapeHtml(path)}"
                     data-label="${escapeHtml(node.label)}"
                     data-tooltip="${escapeHtml(node.label)}"
                     style="padding-left:${paddingLeft}px;">
                    ${showToggle
                        ? `<button class="tree-branch-toggle xdh-tooltip"
                                   data-path="${escapeHtml(path)}"
                                   data-tooltip="${toggleTooltip}">
                                ${icon(expanded ? "arrow-down" : "arrow-right", 12)}
                           </button>`
                        : '<span class="tree-toggle-spacer" aria-hidden="true"></span>'}
                    <span class="tree-folder">${icon("folder", 14)}</span>
                    <span class="tree-label">${escapeHtml(node.label)}</span>
                </div>
                ${childrenHtml}
            </div>`;
    }

    bindEvents() {
        this.$(".tree-scroll")?.addEventListener("scroll", (event) => {
            const target = event.currentTarget;
            if (!(target instanceof HTMLElement)) {
                return;
            }
            this._treeScrollTop = target.scrollTop;
            this._treeScrollLeft = target.scrollLeft;
        });

        this.$(".tree-root-row")?.addEventListener("click", () => {
            this._navigateToFolder("", "");
        });

        this.$(".tree-collapse-all-btn")?.addEventListener("click", (event) => {
            event.stopPropagation();
            this._collapseAll();
        });

        this.$$(".tree-row[data-path]").forEach((row) => {
            row.addEventListener("click", () => {
                this._handleRowClick(
                    row.dataset.path || "",
                    row.dataset.label || ""
                );
            });
        });

        this.$$(".tree-branch-toggle").forEach((button) => {
            button.addEventListener("click", (event) => {
                event.stopPropagation();
                this._toggleExpanded(button.dataset.path || "");
            });
        });

        this.$(".tree-resize-handle")?.addEventListener(
            "pointerdown",
            (event) => this._resizePointerDown(event)
        );
    }

    _getTreeMaxWidth() {
        // 上限 = 布局容器宽度 - 保留宽度（侧边栏 + 卡片区最小空间）
        // 确保拖拽目录树时右侧卡片区域始终可见
        const parentWidth = this.parentElement?.clientWidth || window.innerWidth;
        const MIN_CONTENT_RESERVE = 250; // 侧边栏 48px + 卡片区最低 ~200px
        return Math.max(TREE_MIN_WIDTH, parentWidth - MIN_CONTENT_RESERVE);
    }

    _clampToMaxWidth() {
        const maxWidth = this._getTreeMaxWidth();
        if (this._treeWidth > maxWidth) {
            this._treeWidth = maxWidth;
            this._applyTreeWidth();
        }
    }

    _startParentResizeObserver() {
        if (this._parentResizeObserver) return;
        const target = this.parentElement;
        if (!target) return;
        if (typeof ResizeObserver === "undefined") return;
        this._parentResizeObserver = new ResizeObserver(() => {
            this._clampToMaxWidth();
        });
        this._parentResizeObserver.observe(target);
    }

    _loadSavedWidth() {
        try {
            const saved = localStorage.getItem(TREE_WIDTH_STORAGE_KEY);
            const width = parseInt(saved, 10);
            const maxWidth = this._getTreeMaxWidth();
            if (width >= TREE_MIN_WIDTH && width <= maxWidth) {
                this._treeWidth = width;
            }
        } catch {
            /* ignore */
        }
    }

    _saveTreeWidth() {
        try {
            localStorage.setItem(
                TREE_WIDTH_STORAGE_KEY,
                String(Math.round(this._treeWidth))
            );
        } catch {
            /* ignore */
        }
    }

    _applyTreeWidth() {
        this.style.setProperty(
            "--tree-width",
            `${Math.round(this._treeWidth)}px`
        );
    }

    _resizePointerDown(event) {
        if (event.button !== 0) return;
        event.preventDefault();
        this._isResizing = true;
        this._resizeStartX = event.clientX;
        this._resizeStartWidth = this._treeWidth;

        this.$(".tree-resize-handle")?.classList.add("is-dragging");
        this.style.setProperty("transition", "none");

        // Temporarily disable tree-shell transition during drag
        const shell = this.$(".tree-shell");
        if (shell instanceof HTMLElement) {
            shell.style.transition = "none";
        }

        document.addEventListener("pointermove", this._resizeBoundMove);
        document.addEventListener("pointerup", this._resizeBoundUp);
    }

    _resizePointerMove(clientX) {
        if (!this._isResizing) return;
        const delta = clientX - this._resizeStartX;
        const maxWidth = this._getTreeMaxWidth();
        const newWidth = Math.min(
            maxWidth,
            Math.max(TREE_MIN_WIDTH, this._resizeStartWidth + delta)
        );
        if (newWidth !== this._treeWidth) {
            this._treeWidth = newWidth;
            this._applyTreeWidth();
        }
    }

    _resizePointerUp() {
        if (!this._isResizing) return;
        this._isResizing = false;

        this.$(".tree-resize-handle")?.classList.remove("is-dragging");
        this.style.transition = "";

        const shell = this.$(".tree-shell");
        if (shell instanceof HTMLElement) {
            shell.style.transition = "";
        }

        document.removeEventListener("pointermove", this._resizeBoundMove);
        document.removeEventListener("pointerup", this._resizeBoundUp);

        this._saveTreeWidth();
    }

    get _resizeBoundMove() {
        if (!this.__resizeMove) {
            this.__resizeMove = (event) =>
                this._resizePointerMove(event.clientX);
        }
        return this.__resizeMove;
    }

    get _resizeBoundUp() {
        if (!this.__resizeUp) {
            this.__resizeUp = () => this._resizePointerUp();
        }
        return this.__resizeUp;
    }

    render() {
        const category = String(store.state.activeCategory || "");
        const visible = !!store.state.folderTreeVisible
            && this._isSupportedCategory(category);
        const activePath = normalizePath(store.state.activeFolder || "");
        const rootCache = this._getCategoryCache(category).get("")
            || createCacheEntry();
        let treeBody = "";

        if (visible) {
            if (rootCache.status === "loading") {
                treeBody = this._renderStatusRow(t("nav.tree.loading"), 0);
            } else if (rootCache.status === "error") {
                treeBody = this._renderStatusRow(
                    t("nav.tree.error"),
                    0,
                    "danger"
                );
            } else if (rootCache.status === "ready" && rootCache.items.length) {
                treeBody = rootCache.items
                    .map((node) => this._renderNode(node, 0, activePath, category))
                    .join("");
            } else if (rootCache.status === "ready") {
                treeBody = this._renderStatusRow(t("nav.tree.empty"), 0);
            }
        }

        return `
            <style>
                ${ICON_CSS}
                ${SCROLLBAR_CSS}
                ${TOOLTIP_CSS}

                :host {
                    display: block;
                    width: 0;
                    min-width: 0;
                    flex-shrink: 0;
                    overflow: hidden;
                    position: relative;
                }

                :host([data-visible="true"]) {
                    width: var(--tree-width, 220px);
                }

                .tree-shell {
                    width: 100%;
                    height: 100%;
                    display: flex;
                    flex-direction: column;
                    position: relative;
                    background: var(--xdh-color-surface-1);
                    border-right: 1px solid var(--xdh-color-border);
                    box-shadow: var(--xdh-shadow-window);
                    opacity: 0;
                    transform: translateX(-18px);
                    transition:
                        transform 0.22s cubic-bezier(0.4, 0, 0.2, 1),
                        opacity 0.18s ease;
                    will-change: transform, opacity;
                }

                .tree-resize-handle {
                    position: absolute;
                    top: 0;
                    right: 0;
                    bottom: 0;
                    width: 7px;
                    cursor: col-resize;
                    z-index: 10;
                    background: transparent;
                    touch-action: none;
                }

                .tree-resize-handle::after {
                    content: "";
                    position: absolute;
                    top: 0;
                    right: 0;
                    bottom: 0;
                    width: 2px;
                    background: transparent;
                    transition: background 0.15s ease;
                }

                .tree-resize-handle:hover::after,
                .tree-resize-handle.is-dragging::after {
                    background: color-mix(
                        in srgb,
                        var(--xdh-color-primary) 30%,
                        transparent
                    );
                }

                :host([data-visible="true"]) .tree-shell {
                    opacity: 1;
                    transform: translateX(0);
                }

                .tree-head {
                    height: 40px;
                    display: flex;
                    align-items: center;
                    gap: var(--xdh-space-sm);
                    padding: 0 var(--xdh-space-sm);
                    border-bottom: 1px solid var(--xdh-color-border);
                    color: var(--xdh-color-text-secondary);
                }

                .tree-head-title {
                    font: var(--xdh-font-micro-label);
                    color: var(--xdh-color-text-primary);
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    min-width: 0;
                }

                .tree-head .tree-collapse-all-btn {
                    margin-left: auto;
                    align-self: center;
                }

                .tree-scroll-stage {
                    flex: 1;
                    min-height: 0;
                    display: block;
                }

                .tree-scroll {
                    min-width: 0;
                    height: 100%;
                    overflow-y: scroll;
                    overflow-x: scroll;
                    padding: var(--xdh-space-xs);
                    scrollbar-gutter: stable;
                }

                .tree-scroll-content {
                    width: 100%;
                    min-height: 100%;
                }

                .tree-node {
                    display: block;
                }

                .tree-row,
                .tree-root-row {
                    width: 100%;
                    min-height: 30px;
                    display: flex;
                    align-items: center;
                    gap: var(--xdh-space-sm);
                    border: 1px solid transparent;
                    border-radius: var(--xdh-radius-sm);
                    background: transparent;
                    color: var(--xdh-color-text-secondary);
                    cursor: pointer;
                    transition:
                        background 0.15s ease,
                        color 0.15s ease,
                        border-color 0.15s ease;
                }

                .tree-root-row {
                    padding: 0 var(--xdh-space-sm);
                    margin-bottom: var(--xdh-space-xs);
                    font-weight: 600;
                    position: relative;
                }

                .tree-root-row .tree-label {
                    min-width: 0;
                }

                .tree-row:hover,
                .tree-root-row:hover {
                    background: var(--xdh-color-hover);
                    color: var(--xdh-color-text-primary);
                }

                .tree-row.is-active,
                .tree-root-row.is-active {
                    background: var(--xdh-color-primary-muted);
                    color: var(--xdh-color-primary);
                    border-color: var(--xdh-color-primary);
                }

                .tree-branch-toggle {
                    width: 18px;
                    height: 18px;
                    padding: 0;
                    border: 0;
                    border-radius: var(--xdh-radius-xs);
                    color: inherit;
                    background: transparent;
                    flex-shrink: 0;
                }

                .tree-branch-toggle:hover {
                    background: var(--xdh-color-hover);
                }

                .tree-collapse-all-btn {
                    width: 28px;
                    height: 28px;
                    padding: 0;
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    line-height: 1;
                    border: 1px solid transparent;
                    border-radius: var(--xdh-radius-sm);
                    color: var(--xdh-color-text-secondary);
                    background: transparent;
                    flex-shrink: 0;
                    transform: translateY(0);
                    transition:
                        background 0.14s ease,
                        border-color 0.14s ease,
                        color 0.14s ease;
                }

                .tree-collapse-all-btn:hover {
                    background: var(--xdh-color-hover);
                    color: var(--xdh-color-text-primary);
                }

                .tree-root-row.is-active .tree-collapse-all-btn {
                    color: var(--xdh-color-text-secondary);
                    background: transparent;
                }

                .tree-toggle-spacer {
                    width: 18px;
                    height: 18px;
                    flex-shrink: 0;
                }

                .tree-folder {
                    color: color-mix(
                        in srgb,
                        var(--xdh-color-primary) 64%,
                        var(--xdh-color-text-secondary)
                    );
                    flex-shrink: 0;
                }

                .tree-label {
                    min-width: 0;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                }

                .tree-status {
                    min-height: 26px;
                    display: flex;
                    align-items: center;
                    font: var(--xdh-font-badge);
                    color: var(--xdh-color-text-secondary);
                    padding-right: var(--xdh-space-sm);
                }

                .tree-status.is-danger {
                    color: color-mix(
                        in srgb,
                        var(--db-palette-09) 76%,
                        var(--xdh-color-text-secondary)
                    );
                }
            </style>

            <div class="tree-shell">
                <div class="tree-head">
                    ${icon("folder", 14)}
                    <span class="tree-head-title">${t("nav.tree.title")}</span>
                    <button class="tree-collapse-all-btn xdh-tooltip xdh-tooltip-left"
                            data-tooltip="${t("nav.tree.collapse_all")}">
                        ${icon("list-collapse", 12)}
                    </button>
                </div>
                <div class="tree-scroll-stage">
                    <div class="tree-scroll xdh-scroll">
                        <div class="tree-scroll-content">
                            <div class="tree-root-row ${activePath ? "" : "is-active"} xdh-tooltip"
                                 data-tooltip="${t("nav.btn.home")}">
                                ${icon("house", 13)}
                                <span class="tree-label">${t("nav.path.root")}</span>
                            </div>
                            ${treeBody}
                        </div>
                    </div>
                </div>
                <div class="tree-resize-handle"></div>
            </div>`;
    }
}

registerCustomElement("xdh-folder-tree", XdhFolderTree);
