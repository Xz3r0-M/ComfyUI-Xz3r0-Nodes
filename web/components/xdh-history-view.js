import {
    BaseElement,
    registerCustomElement,
} from "../core/base-element.js?v=20260403-2";
import { appStore } from "../core/store.js";
import { icon, ICON_CSS, SCROLLBAR_CSS } from "../core/icon.js";
import { addFavorite, removeFavorite } from "../core/api.js";
import { banner } from "../core/banner.js";
import { t, getLocale } from "../core/i18n.js?v=20260403-9";

function isHistoryCategory(category) {
    return category === "history" || category === "favorites";
}

function formatDateLabel(value) {
    const date = new Date(value || "");
    const locale = getLocale() === "zh" ? "zh-CN" : "en-US";
    if (Number.isNaN(date.getTime())) return t("history.unknown_date");
    return new Intl.DateTimeFormat(locale, {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        weekday: "short",
    }).format(date);
}

function formatTimeLabel(value) {
    const date = new Date(value || "");
    const locale = getLocale() === "zh" ? "zh-CN" : "en-US";
    if (Number.isNaN(date.getTime())) return "--:--";
    return new Intl.DateTimeFormat(locale, {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
    }).format(date);
}

function recordTimeValue(item) {
    const savedAt = item?.raw?.saved_at || "";
    const date = new Date(savedAt || 0);
    return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

function applyHistorySort(items, sortOrder) {
    const copy = [...items];
    switch (sortOrder) {
        case "name-asc":
            return copy.sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
        case "name-desc":
            return copy.sort((a, b) => b.name.localeCompare(a.name, "zh-CN"));
        case "date-asc":
            return copy.sort((a, b) => recordTimeValue(a) - recordTimeValue(b));
        case "date-desc":
        default:
            return copy.sort((a, b) => recordTimeValue(b) - recordTimeValue(a));
    }
}

function filterHistoryItems(items, keyword) {
    const q = String(keyword || "").trim().toLowerCase();
    if (!q) return items;
    return items.filter((item) => {
        const haystack = [
            item.name,
            payloadText(item),
        ].join(" ").toLowerCase();
        return haystack.includes(q);
    });
}

function groupItemsByDate(items) {
    const groups = new Map();
    items.forEach((item) => {
        const value = item?.raw?.saved_at || "";
        const key = value ? String(value).slice(0, 10) : "unknown";
        if (!groups.has(key)) {
            groups.set(key, []);
        }
        groups.get(key).push(item);
    });
    return Array.from(groups.entries()).map(([key, groupedItems]) => ({
        key,
        label: key === "unknown"
            ? t("history.unknown_date")
            : formatDateLabel(`${key}T00:00:00`),
        items: groupedItems,
    }));
}

function escapeHtml(value) {
    return String(value || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function extractPayloadText(payload) {
    if (payload == null) return "";
    if (typeof payload === "string") return payload.trim();
    if (typeof payload !== "object") return "";
    if (typeof payload.text === "string") return payload.text.trim();
    if (payload.text != null) return String(payload.text).trim();
    if (payload.payload != null) return extractPayloadText(payload.payload);
    return "";
}

function payloadText(item) {
    const payload = item?.raw?.extra?.payload;
    return extractPayloadText(payload);
}

function historyItemTitle(item) {
    return item?.raw?.extra?.extra_header
        || item?.raw?.title
        || item?.name
        || t("history.unnamed");
}

function historyItemDbName(item) {
    return item?.raw?.extra?.db_name
        || item?.db_name
        || item?.raw?.db_name
        || t("history.unknown_db");
}

export class XdhHistoryView extends BaseElement {
    constructor() {
        super();
        this._selectedId = "";
        this._items = [];
        this._itemMap = new Map();
    }

    onStoreUpdate(state, key, value) {
        const isActive = isHistoryCategory(state.activeCategory);

        if (key === "activeCategory") {
            this._selectedId = "";
            if (!isActive) {
                this._items = [];
                this._itemMap = new Map();
            }
            this.renderRoot();
            return;
        }

        if (!isActive) {
            return;
        }

        if (key === "mediaList") {
            this._items = Array.isArray(value) ? value : [];
            this._itemMap = new Map(
                this._items.map((i) => [String(i.id), i])
            );
            this.renderRoot();
            return;
        }

        if (["sortOrder", "searchQuery", "locale"].includes(key)) {
            this.renderRoot();
            return;
        }

        if (key === "loadError") {
            this.renderRoot();
            return;
        }

        if (key === "selectedItems") {
            // 仅更新选中标记，无需重建 DOM
            this._syncSelection();
        }
    }

    /** 仅更新 data-selected 属性，不触发全量渲染 */
    _syncSelection() {
        const sel = appStore.state.selectedItems || [];
        const rows = this.$$(".history-row");
        if (!rows.length) return;
        rows.forEach((row) => {
            row.dataset.selected = String(sel.includes(row.dataset.id));
        });
    }

    _visibleItems() {
        const sorted = applyHistorySort(this._items, appStore.state.sortOrder || "date-desc");
        return filterHistoryItems(sorted, appStore.state.searchQuery || "");
    }

    _selectedItem(items) {
        if (!items.length) return null;
        const found = items.find((item) => item.id === this._selectedId);
        if (found) return found;
        this._selectedId = items[0].id;
        return items[0];
    }

    bindEvents() {
        // 委托到 shadowRoot（持久存在，rerenderRoot 不会销毁它）
        const root = this.shadowRoot;
        if (!root || root._xdhBound) return;
        root._xdhBound = true;

        // ── 点击委托（行选中 + 收藏按钮）───────────────────────────
        root.addEventListener("click", async (e) => {
            if (!(e.target instanceof Element)) return;
            const favBtn = e.target.closest(".favorite-btn");
            if (favBtn) {
                e.stopPropagation();
                await this._onFavBtnClick(favBtn);
                return;
            }
            const row = e.target.closest(".history-row");
            if (!row) return;
            const id = row.dataset.id || "";
            this._selectedId = id;

            if (e.ctrlKey || e.metaKey) {
                const sel = [...(appStore.state.selectedItems || [])];
                const idx = sel.indexOf(id);
                if (idx >= 0) {
                    sel.splice(idx, 1);
                } else {
                    sel.push(id);
                }
                appStore.state.selectedItems = sel;
            } else {
                appStore.state.selectedItems = [id];
            }
            // _syncSelection 会由 onStoreUpdate("selectedItems") 触发
        });

        // ── 拖拽委托 ─────────────────────────────────────────────
        root.addEventListener("dragstart", (e) => {
            if (!(e.target instanceof Element)) return;
            const row = e.target.closest(".history-row[draggable='true']");
            if (!row) return;
            const id = row.dataset.id || "";
            const item = this._itemMap.get(String(id));
            if (!item) { e.preventDefault(); return; }

            const extra = item.raw?.extra || {};
            const rawPayload = extra?.payload;
            let textValue = "";
            if (typeof rawPayload === "string") {
                textValue = rawPayload.trim();
            } else if (rawPayload && typeof rawPayload === "object") {
                textValue = String(
                    rawPayload.text || rawPayload.payload || ""
                ).trim();
            }
            const title = historyItemTitle(item);

            e.dataTransfer.setData(
                "application/x-xdatahub-media+json",
                JSON.stringify({
                    source: "xdatahub",
                    media_type: "text",
                    text_value: textValue,
                    title,
                })
            );
            row.style.opacity = "0.5";
        });

        root.addEventListener("dragend", (e) => {
            if (!(e.target instanceof Element)) return;
            const row = e.target.closest(".history-row");
            if (row) row.style.opacity = "1";
        });
    }

    async _onFavBtnClick(btn) {
        const isFav = appStore.state.activeCategory === "favorites";
        if (isFav) {
            const favId = parseInt(btn.dataset.favId || "0", 10);
            if (!favId) return;
            btn.disabled = true;
            const result = await removeFavorite(favId);
            btn.disabled = false;
            if (result && result.status === "success") {
                banner.success(t("history.banner.unfav_ok"));
                this._items = this._items.filter(
                    (item) => (item.raw?.extra?.favorite_id || 0) !== favId
                );
                this._itemMap = new Map(
                    this._items.map((i) => [String(i.id), i])
                );
                this.renderRoot();
            } else {
                banner.error(t("history.banner.unfav_fail"));
            }
        } else {
            const recordId = parseInt(btn.dataset.recordId || "0", 10);
            const dbName = btn.dataset.dbName || "";
            if (!recordId || !dbName) return;
            const row = this._itemMap.get(btn.dataset.id);
            const extra = row?.raw?.extra || {};
            btn.disabled = true;
            const result = await addFavorite({
                record_id: recordId,
                db_name: dbName,
                extra_header: extra.extra_header || "",
                data_type: extra.data_type || "",
                source: extra.source || "",
                payload: extra.payload ?? null,
            });
            btn.disabled = false;
            if (result && result.status === "success") {
                if (result.duplicate) {
                    banner.info(t("history.banner.fav_dup"));
                } else {
                    banner.success(t("history.banner.fav_ok"));
                }
                btn.classList.add("active");
                btn.setAttribute("data-tooltip", t("history.btn.favorited"));
            } else {
                banner.error(t("history.banner.fav_fail"));
            }
        }
    }

    render() {
        const activeCategory = appStore.state.activeCategory;
        const isActive = isHistoryCategory(activeCategory);
        const items = isActive ? this._visibleItems() : [];
        const selected = this._selectedItem(items);
        const groups = groupItemsByDate(items);
        const selectedExtra = selected?.raw?.extra || {};
        const modeLabel = t(`history.mode.${activeCategory}`);
        const modeIcon = activeCategory === "favorites" ? "bookmark" : "history";
        const loadError = isActive
            ? String(appStore.state.loadError || "").trim()
            : "";

        return `
            <style>
                ${ICON_CSS}
                :host {
                    display: ${isActive ? "block" : "none"};
                    min-height: 100%;
                    container-type: inline-size;
                    container-name: hv;
                }
                .history-shell {
                    min-height: 100%;
                    display: flex;
                    flex-direction: column;
                    background: var(--xdh-color-background, #121212);
                    padding: 20px 24px;
                    gap: 16px;
                }
                .history-list {
                    background: transparent;
                }
                .history-head {
                    display: flex;
                    align-items: center;
                    gap: 12px;
                    margin-bottom: 24px;
                }
                .history-title {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    font-size: 18px;
                    font-weight: 600;
                    color: var(--xdh-color-text-primary, #ffffff);
                }
                .history-count {
                    font-size: 12px;
                    color: var(--xdh-color-text-secondary, #999999);
                    background: var(--xdh-color-surface-2, #333333);
                    padding: 2px 8px;
                    border-radius: 999px;
                }
                .history-group + .history-group {
                    margin-top: 24px;
                }
                .group-label {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    margin-bottom: 12px;
                    font-size: 13px;
                    font-weight: 500;
                    color: var(--xdh-color-text-primary, #eeeeee);
                }
                .history-rows {
                    display: grid;
                    grid-template-columns: repeat(
                        auto-fill, minmax(min(320px, 100%), 1fr)
                    );
                    gap: 12px;
                }
                .history-row {
                    display: flex;
                    flex-direction: column;
                    gap: 10px;
                    padding: 14px;
                    border-radius: 12px;
                    background: var(--xdh-color-surface-1, #1e1e1e);
                    border: 1px solid var(--xdh-color-border, #333333);
                    transition: transform 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease;
                    cursor: grab;
                    user-select: none;
                }
                .history-row:hover {
                    transform: translateY(-2px);
                    border-color: var(--xdh-color-primary, #4499ff);
                    box-shadow: 0 4px 12px rgba(0,0,0,0.2);
                }
                .history-row[data-selected="true"] {
                    border-color: var(--xdh-color-primary, #4499ff);
                    background: color-mix(
                        in srgb,
                        var(--xdh-color-primary, #4499ff) 12%,
                        var(--xdh-color-surface-1, #1e1e1e)
                    );
                    box-shadow: 0 0 0 2px
                        color-mix(
                            in srgb,
                            var(--xdh-color-primary, #4499ff) 40%,
                            transparent
                        );
                }
                @container hv (max-width: 440px) {
                    .history-rows { gap: 8px; }
                    .history-row { padding: 10px 12px; gap: 8px; }
                    .row-payload { max-height: 72px; font-size: 12px; }
                    .history-shell { padding: 14px 16px; }
                }
                .row-header {
                    display: flex;
                    align-items: flex-start;
                    gap: 12px;
                }
                .row-title {
                    flex: 1 1 auto;
                    min-width: 0;
                    font-size: 14px;
                    font-weight: 600;
                    color: var(--xdh-color-text-primary, #ffffff);
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                }
                .row-actions {
                    display: flex;
                    align-items: center;
                    gap: 4px;
                }
                .action-btn {
                    background: transparent;
                    border: none;
                    color: var(--xdh-color-text-secondary, #666666);
                    cursor: pointer;
                    padding: 4px;
                    border-radius: 4px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    transition: background 0.15s, color 0.15s;
                }
                .action-btn:hover {
                    background: var(--xdh-color-surface-2, #333333);
                    color: #f5c518;
                }
                .action-btn.active {
                    color: #f5c518;
                }
                .row-footer {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    gap: 8px;
                }
                .row-meta {
                    display: flex;
                    flex-wrap: wrap;
                    gap: 6px;
                }
                .row-time {
                    flex: 0 1 auto;
                    min-width: 0;
                    font-size: 12px;
                    color: var(--xdh-color-text-secondary, #999999);
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                }
                .row-tag {
                    font-size: 11px;
                    padding: 2px 6px;
                    border-radius: 4px;
                    background: var(--xdh-color-surface-2, #333333);
                    color: var(--xdh-color-text-secondary, #999999);
                }
                .row-payload {
                    margin-top: 2px;
                    padding: 10px;
                    border-radius: 8px;
                    background: var(--xdh-color-background, #121212);
                    border: 1px solid var(--xdh-color-border, #2a2a2a);
                    font-size: 13px;
                    line-height: 1.5;
                    color: var(--xdh-color-text-primary, #dddddd);
                    white-space: pre-wrap;
                    word-break: break-word;
                    max-height: 120px;
                    overflow-y: auto;
                }
                ${SCROLLBAR_CSS}
                .empty-state {
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    gap: 8px;
                    padding: 60px 20px;
                    text-align: center;
                    color: var(--xdh-color-text-secondary, #666666);
                    font-size: 14px;
                }
                .empty-state.is-error {
                    color: var(--xdh-brand-pink, #EA005E);
                }
            </style>
            <div class="history-shell">
                <section class="history-list">
                    <div class="history-head">
                        <div class="history-title">${icon(modeIcon, 20)} <span>${modeLabel}</span></div>
                        <div class="history-count">${items.length}</div>
                    </div>
                    ${loadError
                        ? `<div class="empty-state is-error">${icon('triangle-alert', 18)} <span>${loadError}</span></div>`
                        : groups.length === 0
                        ? `<div class="empty-state">${t('history.empty', { mode: modeLabel })}</div>`
                        : groups.map((group) => `
                            <section class="history-group">
                                <div class="group-label">${icon('calendar', 14)} <span>${group.label}</span></div>
                                <div class="history-rows">
                                    ${group.items.map((item) => {
                                        const text = payloadText(item);
                                        const title = historyItemTitle(item);
                                        const dbName = historyItemDbName(item);
                                        const isFav = activeCategory === "favorites";
                                        const favId = item.raw?.extra?.favorite_id || 0;
                                        const recordId = item.raw?.extra?.record_id || 0;
                                        const isSelected = (appStore.state.selectedItems || []).includes(item.id);
                                        return `
                                            <article class="history-row"
                                                     draggable="true"
                                                     data-id="${item.id}"
                                                     data-record-id="${recordId}"
                                                     data-fav-id="${favId}"
                                                     data-selected="${isSelected}">
                                                <div class="row-header">
                                                    <div class="row-title xdh-tooltip xdh-tooltip-down" data-tooltip="${escapeHtml(title)}">${escapeHtml(title)}</div>
                                                    <div class="row-actions">
                                                        <button class="action-btn favorite-btn xdh-tooltip xdh-tooltip-down ${isFav ? 'active' : ''}" data-id="${item.id}" data-record-id="${recordId}" data-fav-id="${favId}" data-db-name="${escapeHtml(dbName)}" data-extra-header="${escapeHtml(item.raw?.extra?.extra_header || '')}" data-data-type="${escapeHtml(item.raw?.extra?.data_type || '')}" data-source="${escapeHtml(item.raw?.extra?.source || '')}" data-tooltip="${isFav ? t('history.btn.unfavorite') : t('history.btn.favorite')}">
                                                            ${icon('bookmark', 14)}
                                                        </button>
                                                    </div>
                                                </div>
                                                <div class="row-footer">
                                                    <div class="row-meta">
                                                        <span class="row-tag">${escapeHtml(dbName)}</span>
                                                    </div>
                                                    <div class="row-time">${formatTimeLabel(item.raw?.saved_at)}</div>
                                                </div>
                                                ${text ? `<div class="row-payload xdh-scroll">${escapeHtml(text)}</div>` : ''}
                                            </article>
                                        `;
                                    }).join('')}
                                </div>
                            </section>
                        `).join('')}
                </section>
            </div>
        `;
    }
}

registerCustomElement("xdh-history-view", XdhHistoryView);
