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

export class XdhFolderTree extends BaseElement {
    constructor() {
        super();
        this._cacheByCategory = new Map();
        this._expandedByCategory = new Map();
        this._syncToken = 0;
        this._treeScrollTop = 0;
        this._treeScrollLeft = 0;
    }

    connectedCallback() {
        super.connectedCallback();
        this._syncHostState();
        void this._syncTreeState();
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
                "refreshTrigger",
            ].includes(key)
        ) {
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
            this.renderRoot();
            return;
        }

        expanded.add(path);
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
            this.renderRoot();
            return;
        }

        expanded.add(path);
        this.renderRoot();
        void this._ensureChildrenLoaded(category, path);
    }

    _collapseAll() {
        const category = String(store.state.activeCategory || "");
        this._expandedByCategory.set(category, new Set([""]));
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
                     data-tooltip="${escapeHtml(path)}"
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
    }

    render() {
        const category = String(store.state.activeCategory || "");
        const visible = !!store.state.folderTreeVisible
            && this._isSupportedCategory(category);
        const activePath = normalizePath(store.state.activeFolder || "");
        const categoryLabel = visible ? t(`nav.cat.${category}`) : "";
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
                }

                :host([data-visible="true"]) {
                    width: 220px;
                }

                .tree-shell {
                    width: 220px;
                    height: 100%;
                    display: flex;
                    flex-direction: column;
                    background: var(--xdh-color-surface-1, #1a1a1a);
                    border-right: 1px solid var(--xdh-color-border, #2e2e2e);
                    box-shadow: 0 14px 34px rgba(0, 0, 0, 0.28);
                    opacity: 0;
                    transform: translateX(-18px);
                    transition:
                        transform 0.22s cubic-bezier(0.4, 0, 0.2, 1),
                        opacity 0.18s ease;
                    will-change: transform, opacity;
                }

                :host([data-visible="true"]) .tree-shell {
                    opacity: 1;
                    transform: translateX(0);
                }

                .tree-head {
                    height: 40px;
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    padding: 0 10px;
                    border-bottom: 1px solid var(--xdh-color-border, #2e2e2e);
                    color: var(--xdh-color-text-secondary, #999);
                }

                .tree-head-title {
                    font-size: 12px;
                    font-weight: 700;
                    color: var(--xdh-color-text-primary, #eee);
                }

                .tree-head-category {
                    margin-left: auto;
                    font-size: 11px;
                    color: var(--xdh-color-text-secondary, #999);
                    min-width: 0;
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                }

                .tree-head .tree-collapse-all-btn {
                    margin-left: 8px;
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
                    padding: 5px;
                    scrollbar-gutter: stable;
                }

                .tree-scroll-content {
                    min-width: max-content;
                    min-height: 100%;
                }

                .tree-node {
                    display: block;
                }

                .tree-row,
                .tree-root-row {
                    width: max-content;
                    min-width: 100%;
                    min-height: 30px;
                    display: flex;
                    align-items: center;
                    gap: 6px;
                    border: 1px solid transparent;
                    border-radius: 6px;
                    background: transparent;
                    color: var(--xdh-color-text-secondary, #999);
                    cursor: pointer;
                    transition:
                        background 0.15s ease,
                        color 0.15s ease,
                        border-color 0.15s ease;
                }

                .tree-root-row {
                    padding: 0 10px;
                    margin-bottom: 4px;
                    font-weight: 600;
                    position: relative;
                }

                .tree-root-row .tree-label {
                    min-width: 0;
                }

                .tree-row:hover,
                .tree-root-row:hover {
                    background: var(--xdh-color-hover, #2a2a2a);
                    color: var(--xdh-color-text-primary, #eee);
                }

                .tree-row.is-active,
                .tree-root-row.is-active {
                    background: var(--xdh-color-primary-muted, #1a3050);
                    color: var(--xdh-color-primary, #4499ff);
                    border-color: var(--xdh-color-primary, #4499ff);
                }

                .tree-branch-toggle {
                    width: 18px;
                    height: 18px;
                    padding: 0;
                    border: 0;
                    border-radius: 4px;
                    color: inherit;
                    background: transparent;
                    flex-shrink: 0;
                }

                .tree-branch-toggle:hover {
                    background: var(--xdh-color-hover, #2a2a2a);
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
                    border-radius: 6px;
                    color: var(--xdh-color-text-secondary, #999);
                    background: transparent;
                    flex-shrink: 0;
                    transform: translateY(0);
                    transition:
                        background 0.14s ease,
                        border-color 0.14s ease,
                        color 0.14s ease;
                }

                .tree-collapse-all-btn:hover {
                    background: var(--xdh-color-hover, #2a2a2a);
                    color: var(--xdh-color-text-primary, #eee);
                }

                .tree-root-row.is-active .tree-collapse-all-btn {
                    color: var(--xdh-color-text-secondary, #999);
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
                        var(--xdh-color-primary, #4499ff) 64%,
                        var(--xdh-color-text-secondary, #999)
                    );
                    flex-shrink: 0;
                }

                .tree-label {
                    min-width: max-content;
                    overflow: visible;
                    text-overflow: clip;
                    white-space: nowrap;
                }

                .tree-status {
                    min-height: 26px;
                    display: flex;
                    align-items: center;
                    font-size: 11px;
                    color: var(--xdh-color-text-secondary, #999);
                    padding-right: 10px;
                }

                .tree-status.is-danger {
                    color: color-mix(
                        in srgb,
                        var(--db-palette-09, #d90429) 76%,
                        var(--xdh-color-text-secondary, #999)
                    );
                }
            </style>

            <div class="tree-shell">
                <div class="tree-head">
                    ${icon("folder", 14)}
                    <span class="tree-head-title">${t("nav.tree.title")}</span>
                    <span class="tree-head-category">${escapeHtml(categoryLabel)}</span>
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
            </div>`;
    }
}

registerCustomElement("xdh-folder-tree", XdhFolderTree);
