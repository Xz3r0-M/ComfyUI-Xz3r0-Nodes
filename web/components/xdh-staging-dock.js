import {
    BaseElement,
    registerCustomElement,
} from '../core/base-element.js?v=20260403-2';
import { appStore } from '../core/store.js';
import { buildThumbUrl } from '../core/api.js?v=20260601-5';
import { icon, ICON_CSS, TOOLTIP_CSS } from '../core/icon.js';
import { t } from '../core/i18n.js?v=20261020-1';
import { banner } from '../core/banner.js';
import { resolveTokenAccentFromNode } from '../core/node-accent.js?v=20260402-400';
import {
    sendToNode,
    resolveNodeClassFromTargetType,
    resolveNodeClassFromCategory,
} from '../core/node-bridge.js?v=20261021-1';

function escapeAttr(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

// XMediaListGet 只能装图片/视频/音频：LoRA、文本（含文本收藏）
// 在节点选择器里就不该出现，否则用户选了一个收不了的目标。
const MEDIA_LIST_CATEGORIES = new Set(['image', 'video', 'audio']);

/**
 * 根据当前分类和已选内容，算出本次可以发送的目标节点类型。
 *
 * @param {string} category 当前分类（image/video/audio/lora/history/...）
 * @param {Array} items 已选条目（用 type 或 media_type 判断真实类型）
 * @param {boolean} isMulti 是否多选
 * @returns {string[]} 允许的目标节点类名
 */
function resolveAllowedTargetTypes(category, items = [], isMulti = false) {
    const normalizedCategory = String(
        category || 'image'
    ).trim().toLowerCase();
    const itemTypes = (Array.isArray(items) ? items : [])
        .map((item) => String(
            item?.type || item?.media_type || ''
        ).trim().toLowerCase())
        .filter(Boolean);
    const types = itemTypes.length ? itemTypes : [normalizedCategory];
    const listEligible = types.every((type) =>
        MEDIA_LIST_CATEGORIES.has(type)
    );
    if (!listEligible) {
        return [resolveNodeClassFromCategory(normalizedCategory)];
    }
    return isMulti
        ? ['XMediaListGet']
        : [resolveNodeClassFromCategory(normalizedCategory), 'XMediaListGet'];
}

/**
 * 发送栏里的小缩略图地址。
 *
 * LoRA 的封面走自己的接口（`/loras/thumb`，视频封面会返回首帧），
 * 不能套媒体文件的缩略图接口，否则请求会扑空、图片区一片空白。
 */
function resolveSelectedThumbUrl(item) {
    const type = String(item?.type || item?.media_type || '').toLowerCase();
    if (type === 'audio') {
        return '';
    }
    const extra = item?.raw?.extra || {};
    const raw = item?.raw || {};
    const mediaRef = String(
        extra.media_ref || raw.media_ref || raw.public_ref || raw.ref || ''
    );
    if (!mediaRef) {
        return '';
    }
    if (type === 'lora') {
        const explicit = String(extra.thumb_url || raw.thumb_url || '');
        if (explicit) {
            return explicit;
        }
        return `/xz3r0/xdatahub/loras/thumb?ref=${
            encodeURIComponent(mediaRef)
        }`;
    }
    return buildThumbUrl(mediaRef, 64);
}

export class XdhStagingDock extends BaseElement {
    constructor() {
        super();
        const initialSelectedItems = Array.isArray(appStore.state.selectedItems)
            ? appStore.state.selectedItems
            : [];
        this.selectedCount = initialSelectedItems.length;
        this.batchTargetNodeId = '';
        this.batchTargetNodeTitle = '';
        this.batchTargetNodeColor = '';
        this.batchTargetNodeClass = '';
        this.batchTargetItemCount = 0;
        this.batchTargetCounts = null;
        this.selectedItemSnapshots = [];
        this._collapsed = false;
        this._syncSelectedSnapshots(initialSelectedItems);
    }

    _syncSelectedSnapshots(ids = null) {
        const selected = Array.isArray(ids)
            ? ids
            : (appStore.state.selectedItems || []);
        const mediaList = appStore.state.mediaList || [];
        const previous = new Map(
            (this.selectedItemSnapshots || []).map(
                (item) => [String(item.id), item]
            )
        );
        this.selectedItemSnapshots = selected
            .map((id) => {
                const live = mediaList.find(
                    (entry) => String(entry.id) === String(id)
                );
                return live || previous.get(String(id)) || null;
            })
            .filter(Boolean);
    }

    onStoreUpdate(state, key, value) {
        if (key === 'selectedItems') {
            const incoming = Array.isArray(value) ? value : [];
            this.selectedCount = incoming.length;
            this._syncSelectedSnapshots(incoming);
            this.renderRoot();
        } else if (key === 'activeCategory') {
            // 不同分类对应不同节点类型，清空目标选择。
            this.batchTargetNodeId = '';
            this.batchTargetNodeTitle = '';
            this.batchTargetNodeColor = '';
            this.batchTargetNodeClass = '';
            this.batchTargetItemCount = 0;
            this.batchTargetCounts = null;
            this.selectedItemSnapshots = [];
            this.renderRoot();
        } else if (
            key === 'locale'
            || key === 'mediaList'
            || key === 'searchQuery'
            || key === 'loraDetailOpen'
        ) {
            this._syncSelectedSnapshots();
            this.renderRoot();
        }
    }

    bindEvents() {
        const clearBtn = this.$('.clear-btn');
        if (clearBtn) {
            clearBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                appStore.state.selectedItems = [];
            });
        }

        const collapseBtn = this.$('.dock-toggle');
        if (collapseBtn) {
            collapseBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this._collapsed = !this._collapsed;
                this.renderRoot();
            });
        }

        const applyBtn = this.$('.apply-btn');
        if (applyBtn) {
            applyBtn.addEventListener('click', () => {
                this._sendSelected('append');
            });
        }
        const replaceBtn = this.$('.replace-btn');
        if (replaceBtn) {
            replaceBtn.addEventListener('click', () => {
                const targetCount = this._resolveTargetCount();
                const message = t('dock.replace_confirm', {
                    count: targetCount,
                });
                if (!window.confirm(message)) {
                    return;
                }
                this._sendSelected('replace');
            });
        }
        const appendBtn = this.$('.append-btn');
        if (appendBtn) {
            appendBtn.addEventListener('click', () => {
                this._sendSelected('append');
            });
        }

        const batchPicker = this.$('xdh-node-picker[data-batch]');
        if (batchPicker) {
            batchPicker.addEventListener('node-selected', (e) => {
                this.batchTargetNodeId = String(e.detail?.nodeId || '').trim();
                this.batchTargetNodeTitle = String(
                    e.detail?.node?.title || ''
                ).trim();
                this.batchTargetNodeColor = e.detail?.node
                    ? String(resolveTokenAccentFromNode(e.detail.node))
                    : '';
                this.batchTargetNodeClass = String(
                    e.detail?.node?.node_class || ''
                ).trim();
                this.batchTargetItemCount = Number(
                    e.detail?.node?.item_count || 0
                );
                this.batchTargetCounts = e.detail?.node?.enabled_counts
                    || null;
                this.renderRoot();
            });
        }
    }

    _resolveTargetCount() {
        const state = appStore.state;
        const selectedItems = this.selectedItemSnapshots || [];
        const sendType = String(
            selectedItems[0]?.type || state.activeCategory || 'image'
        ).toLowerCase();
        const counts = this.batchTargetCounts || null;
        if (counts && counts[sendType] != null) {
            return Number(counts[sendType]);
        }
        return Number(this.batchTargetItemCount || 0);
    }

    async _sendSelected(mode = 'append') {
        const state = appStore.state;
        const selectedIds = state.selectedItems || [];
        if (!selectedIds.length) {
            return;
        }
        this._syncSelectedSnapshots(selectedIds);
        const items = this.selectedItemSnapshots.map((item) => {
            const extra = item?.raw?.extra || {};
            const raw = item?.raw || {};
            const mediaRef = String(
                extra.media_ref || raw.media_ref
                || raw.public_ref || raw.ref || ''
            );
            const rawPayload = extra?.payload;
            let textValue = '';
            if (!mediaRef) {
                if (typeof rawPayload === 'string') {
                    textValue = rawPayload.trim();
                } else if (rawPayload && typeof rawPayload === 'object') {
                    textValue = String(
                        rawPayload.text || rawPayload.payload || ''
                    ).trim();
                }
            }
            return {
                media_ref: mediaRef,
                media_type: String(
                    item?.type || state.activeCategory || 'image'
                ).toLowerCase(),
                title: String(item?.title || item?.name || ''),
                text_value: textValue,
            };
        }).filter((entry) => entry.media_ref || entry.text_value);

        if (!items.length) {
            banner.warn(t('dock.send_partial', { success: 0, fail: 1 }));
            return;
        }

        const batchPicker = this.$('xdh-node-picker[data-batch]');
        const pickerTargetType = String(
            batchPicker?.getAttribute('target-type')
            || state.activeCategory
            || 'image'
        ).trim();
        const firstTargetType = pickerTargetType.split(',')[0].trim();
        const nodeClass = String(
            this.batchTargetNodeClass
            || resolveNodeClassFromTargetType(firstTargetType)
            || resolveNodeClassFromCategory(state.activeCategory || 'image')
        );
        // 双保险：目标节点类型必须收得下这批内容，否则直接提示，
        // 不要发出一个注定被拒的请求。
        const allowedTargetTypes = resolveAllowedTargetTypes(
            state.activeCategory,
            items,
            items.length > 1
        );
        if (!allowedTargetTypes.includes(nodeClass)) {
            banner.warn(t('dock.send_partial', { success: 0, fail: 1 }));
            return;
        }
        const batchNodeId = String(
            batchPicker?.selectedNode?.id
            || this.batchTargetNodeId
            || ''
        ).trim();

        if (!batchNodeId) {
            banner.warn(t('dock.send_partial', { success: 0, fail: 1 }));
            return;
        }

        const first = items[0];
        const isListNode = nodeClass === 'XMediaListGet';
        // XLoraGet 可多行：一次性选中多个 LoRA 时逐条追加，
        // 否则用户选了 3 个只会进去 1 个。
        const isLoraNode = nodeClass === 'XLoraGet';
        const sendType = String(
            first.media_type || state.activeCategory || 'image'
        ).toLowerCase();
        const currentCounts = this.batchTargetCounts || null;
        const currentTargetCount = currentCounts
            && currentCounts[sendType] != null
            ? Number(currentCounts[sendType])
            : Number(this.batchTargetItemCount || 0);
        const addableBefore = Math.max(0, 50 - currentTargetCount);
        const accepted = isListNode
            ? (mode === 'replace'
                ? Math.min(items.length, 50)
                : Math.min(items.length, addableBefore))
            : 0;
        let result = null;
        if (isLoraNode && items.length > 1) {
            let failed = 0;
            for (const item of items) {
                const single = await sendToNode({
                    nodeId: batchNodeId,
                    nodeClass,
                    mediaRef: item.media_ref,
                    textValue: item.text_value,
                    title: item.title,
                });
                if (!single.ok) {
                    failed += 1;
                }
            }
            result = { ok: failed === 0, failed };
        } else {
            result = await sendToNode({
                nodeId: batchNodeId,
                nodeClass,
                mediaRef: first.media_ref,
                textValue: first.text_value,
                title: first.title,
                items: isListNode ? items : [],
                mode: isListNode ? mode : '',
            });
        }

        if (result.ok) {
            appStore.state.selectedItems = [];
            this.selectedItemSnapshots = [];
            if (isListNode) {
                const nextCount = mode === 'replace'
                    ? accepted
                    : Math.min(50, currentTargetCount + accepted);
                this.batchTargetCounts = currentCounts
                    ? { ...currentCounts, [sendType]: nextCount }
                    : null;
                this.batchTargetItemCount = nextCount;
            }
            this.renderRoot();
            banner.success(t('dock.send_success', { count: items.length }));
        } else {
            banner.warn(t('dock.send_partial', { success: 0, fail: 1 }));
        }
    }

    render() {
        const state = appStore.state;
        const selectedIds = state.selectedItems || [];
        this._syncSelectedSnapshots(selectedIds);
        const selectedItems = this.selectedItemSnapshots;
        const isMulti = selectedIds.length > 1;
        const selectedLabel = isMulti
            ? t('dock.selected_count', { count: selectedIds.length })
            : String(
                selectedItems[0]?.title
                || selectedItems[0]?.name
                || selectedIds[0]
                || ''
            );
        const selectedLabelEscaped = escapeAttr(selectedLabel);
        const allowedTargetTypes = resolveAllowedTargetTypes(
            state.activeCategory,
            selectedItems,
            isMulti
        );
        // 切换分类后，之前选中的目标可能已经不在候选范围内（比如
        // 图片时选中的 XMediaListGet，切到 LoRA 后就不该再留着）。
        if (this.batchTargetNodeClass
            && !allowedTargetTypes.includes(this.batchTargetNodeClass)) {
            this.batchTargetNodeId = '';
            this.batchTargetNodeTitle = '';
            this.batchTargetNodeColor = '';
            this.batchTargetNodeClass = '';
            this.batchTargetItemCount = 0;
            this.batchTargetCounts = null;
        }
        const pickerTargetType = allowedTargetTypes.join(',');
        const selectedThumbs = selectedItems
            .slice(0, 3)
            .map(resolveSelectedThumbUrl)
            .filter(Boolean);
        const targetCounts = this.batchTargetCounts || null;
        const sendType = String(
            selectedItems[0]?.type || state.activeCategory || 'image'
        ).toLowerCase();
        const targetCount = targetCounts
            && targetCounts[sendType] != null
            ? Number(targetCounts[sendType])
            : Number(this.batchTargetItemCount || 0);
        const targetHasContent = targetCount > 0;
        const isListTarget = this.batchTargetNodeClass === 'XMediaListGet'
            || pickerTargetType.split(',').includes('XMediaListGet');
        const addable = Math.max(0, 50 - targetCount);
        const sendCount = Math.min(selectedIds.length, addable);
        const dropped = Math.max(0, selectedIds.length - sendCount);
        const appendLabel = dropped > 0
            ? t('dock.append_count_dropped', {
                count: sendCount,
                dropped,
            })
            : t('dock.append_count', { count: sendCount });
        const targetCountLabel = isListTarget && targetCount > 0
            ? ` · ${t('dock.target_count', { count: targetCount })}`
            : '';
        const showChoice = isListTarget && targetHasContent;

        if (selectedIds.length === 0 || state.loraDetailOpen) {
            return `<style>:host { display: none; }</style>`;
        }

        return `
            <style>
                ${ICON_CSS}
                ${TOOLTIP_CSS}
                :host {
                    position: fixed;
                    bottom: 43px;
                    left: 50%;
                    transform: translateX(-50%);
                    z-index: 1000;
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    pointer-events: none; /* Let clicks pass through container */
                    --dock-panel-bg: var(--xdh-color-surface-2);
                    --dock-header-bg: var(--xdh-color-surface-3);
                    --dock-inner-bg: var(--xdh-color-surface-1);
                    --dock-muted-bg: var(--xdh-color-surface-3);
                    --dock-hover-bg: var(--xdh-color-surface-4);
                    --dock-border: var(--xdh-color-border);
                    --dock-shadow: 0 6px 24px rgba(0, 0, 0, 0.55),
                        0 0 0 1px color-mix(in srgb, var(--xdh-color-primary) 16%, transparent);
                    --dock-active-bg: var(--xdh-color-primary-muted);
                    --dock-active-color: var(--xdh-color-primary);
                    --dock-secondary-text: var(
                        --xdh-color-text-secondary
                    );
                }

                :host-context(body[data-theme="light"]) {
                    --dock-panel-bg: var(--xdh-color-surface-2);
                    --dock-header-bg: var(--xdh-clr-surface-strong);
                    --dock-inner-bg: var(--xdh-color-surface-1);
                    --dock-muted-bg: var(--xdh-clr-surface-strong);
                    --dock-hover-bg: var(--xdh-clr-hairline);
                    --dock-border: var(--xdh-color-border);
                    --dock-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
                    --dock-active-bg: color-mix(
                        in srgb, var(--xdh-clr-primary) 10%, transparent
                    );
                    --dock-active-color: var(--xdh-clr-primary);
                    --dock-secondary-text: var(--xdh-color-text-secondary);
                }

                .dock-container {
                    background: var(--dock-panel-bg);
                    border: 1px solid var(--dock-border);
                    border-radius: var(--xdh-radius-md);
                    box-shadow: var(--dock-shadow);
                    pointer-events: auto;
                    transition: width 0.22s cubic-bezier(0.4, 0, 0.2, 1),
                        box-shadow 0.15s ease,
                        border-color 0.15s ease,
                        background-color 0.15s ease;
                    width: 360px;
                    max-width: 90vw;
                    overflow: visible;
                    display: flex;
                    flex-direction: column;
                }

                /* ── External toggle tab ── */
                .dock-toggle {
                    width: 50px;
                    height: 24px;
                    background: var(--dock-panel-bg);
                    border: 1px solid var(--dock-border);
                    border-radius: var(--xdh-radius-sm) var(--xdh-radius-sm) 0 0;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    cursor: pointer;
                    pointer-events: auto;
                    color: var(--dock-secondary-text);
                    flex-shrink: 0;
                    transition: background 0.14s ease, color 0.14s ease;
                    margin-bottom: -1px;
                }
                .dock-toggle:hover {
                    background: var(--dock-hover-bg);
                    color: var(--xdh-color-text-primary);
                }
                /* standalone (collapsed) state */
                .dock-toggle.solo {
                    border-bottom: 1px solid var(--dock-border);
                    border-radius: var(--xdh-radius-sm) var(--xdh-radius-sm) 0 0;
                    height: 24px;
                    box-shadow: var(--dock-shadow);
                    margin-bottom: 0px;
                }

                .dock-header {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    padding: var(--xdh-space-xs) var(--xdh-space-md);
                    background: var(--dock-header-bg);
                    gap: var(--xdh-space-sm);
                    border-radius: var(--xdh-radius-md) var(--xdh-radius-md) 0 0;
                    white-space: nowrap;
                    transition: background-color 0.15s ease, color 0.15s ease;
                    border-bottom: 1px solid var(--dock-border);
                }

                .dock-title {
                    display: flex;
                    align-items: center;
                    gap: var(--xdh-space-sm);
                    flex-shrink: 0;
                }

                .dock-actions {
                    display: flex;
                    gap: var(--xdh-space-sm);
                    align-items: center;
                    flex-shrink: 0;
                }

                .dock-action-btn {
                    background: transparent;
                    border: 1px solid var(--dock-border);
                    color: var(--dock-secondary-text);
                    cursor: pointer;
                    white-space: nowrap;
                    flex-shrink: 0;
                    border-radius: var(--xdh-radius-xs);
                    width: 24px;
                    height: 24px;
                    padding: 0;
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    transition: background-color 0.15s ease,
                        color 0.15s ease,
                        border-color 0.15s ease;
                }

                .dock-action-btn:hover {
                    background: var(--dock-hover-bg);
                    color: var(--xdh-color-text-primary);
                }

                .dock-action-btn.active {
                    background: var(--dock-active-bg);
                    color: var(--dock-active-color);
                    border-color: var(--dock-active-color);
                }

                .dock-action-btn:disabled {
                    opacity: 0.35;
                    cursor: not-allowed;
                }

                .badge {
                    background: var(--xdh-color-primary);
                    color: var(--xdh-clr-on-primary);
                    border-radius: var(--xdh-radius-sm);
                    padding: var(--xdh-space-xxs) var(--xdh-space-sm);
                    font: var(--xdh-font-micro-label);
                    flex-shrink: 0;
                }

                .dock-body {
                    display: block;
                    padding: var(--xdh-space-md) var(--xdh-space-md) var(--xdh-space-xs);
                }

                .selected-item {
                    margin-bottom: 8px;
                    background: color-mix(in srgb, var(--dock-inner-bg) 88%, var(--dock-active-color, #4499ff) 12%);
                    border: 1px solid color-mix(in srgb, var(--dock-border) 50%, var(--dock-active-color, #4499ff) 50%);
                    border-radius: var(--xdh-radius-sm);
                    padding: var(--xdh-space-xs) var(--xdh-space-sm);
                    color: var(--xdh-color-text-primary);
                    overflow: hidden;
                    text-overflow: ellipsis;
                }

                .selected-stack {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                }

                .selected-thumbs {
                    display: flex;
                    align-items: center;
                    flex-shrink: 0;
                }

                .selected-thumbs img {
                    width: 28px;
                    height: 28px;
                    object-fit: cover;
                    border-radius: 4px;
                    border: 1px solid var(--dock-border);
                    margin-left: -8px;
                    background: var(--dock-inner-bg);
                }

                .selected-thumbs img:first-child {
                    margin-left: 0;
                }

                .selected-more {
                    margin-left: 4px;
                    font-size: 10px;
                    color: var(--dock-secondary-text);
                }

                .batch-target-row {
                    display: flex;
                    flex-direction: column;
                    gap: var(--xdh-space-xs);
                    padding: var(--xdh-space-sm) 0 0;
                }

                .batch-target-label {
                    font-size: 10px;
                    color: var(--dock-secondary-text);
                    text-transform: uppercase;
                    letter-spacing: 0.04em;
                }

                .actions {
                    padding: 0 var(--xdh-space-md) var(--xdh-space-sm);
                    display: flex;
                    justify-content: flex-end;
                    gap: var(--xdh-space-sm);
                    border-radius: 0 0 var(--xdh-radius-md) var(--xdh-radius-md);
                }
            </style>

            <button class="dock-toggle${this._collapsed ? ' solo' : ''} xdh-tooltip xdh-tooltip-up"
                    data-tooltip="${this._collapsed ? t('dock.expand') : t('dock.collapse')}">
                ${icon(this._collapsed ? 'panel-bottom-open' : 'panel-bottom-close', 14)}
            </button>

            ${this._collapsed ? '' : `
            <div class="dock-container">
                <div class="dock-header">
                    <div class="dock-title">
                        ${icon('send', 15)} <span>${t('dock.title')}</span>
                    </div>
                    <div class="dock-actions">
                        <button class="dock-action-btn clear-btn xdh-tooltip xdh-tooltip-up" data-tooltip="${t('dock.clear')}">
                            ${icon('trash-2', 14)}
                        </button>
                    </div>
                </div>

                <div class="dock-body">
                    ${isMulti ? `
                    <div class="selected-item selected-stack xdh-tooltip xdh-tooltip-up" data-tooltip="${selectedLabelEscaped}">
                        <div class="selected-thumbs">
                            ${selectedThumbs.map((url) => `<img src="${escapeAttr(url)}" alt="" onerror="this.style.display='none'">`).join('')}
                            ${selectedItems.length > 3 ? `<span class="selected-more">+${selectedItems.length - 3}</span>` : ''}
                        </div>
                        <span>${selectedLabelEscaped}</span>
                    </div>` : `
                    <div class="selected-item xdh-tooltip xdh-tooltip-up" data-tooltip="${selectedLabelEscaped}">
                        ${icon('file', 11)} ${selectedLabelEscaped}
                    </div>`}
                    <div class="batch-target-row">
                        <span class="batch-target-label">${t('dock.batch_target')}${targetCountLabel}</span>
                        <xdh-node-picker
                            data-batch="true"
                            target-type="${escapeAttr(pickerTargetType)}"
                            selected-node-id="${escapeAttr(this.batchTargetNodeId)}"
                            selected-node-title="${escapeAttr(this.batchTargetNodeTitle)}"
                            selected-node-color="${escapeAttr(this.batchTargetNodeColor)}">
                        </xdh-node-picker>
                    </div>
                </div>
                <div class="actions">
                    ${showChoice ? `
                    <xdh-button variant="primary" class="replace-btn">
                        ${icon('refresh-cw', 14)} ${t('dock.replace')}
                    </xdh-button>
                    <xdh-button variant="primary" class="append-btn">
                        ${icon('send', 14)} ${appendLabel}
                    </xdh-button>` : `
                    <xdh-button variant="primary" class="apply-btn">
                        ${icon('send', 14)} ${t('dock.send')}
                    </xdh-button>`}
                </div>
            </div>
            `}
        `;
    }
}

registerCustomElement('xdh-staging-dock', XdhStagingDock);
