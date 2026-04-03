import { BaseElement } from '../core/base-element.js';
import { appStore } from '../core/store.js';
import { icon, ICON_CSS, SCROLLBAR_CSS, TOOLTIP_CSS } from '../core/icon.js';
import { t } from '../core/i18n.js?v=20260402-393';
import { banner } from '../core/banner.js';
import {
    sendToNode,
    CATEGORY_NODE_CLASS,
} from '../core/node-bridge.js?v=20260402-398';

function getSelectableItems(state = appStore.state) {
    const query = String(state.searchQuery || '').toLowerCase().trim();
    const isRecordView = ['history', 'favorites'].includes(
        state.activeCategory
    );
    return (state.mediaList || []).filter(item => {
        if (!item || item.isFolder) return false;
        // In history/favorites views, allow record-type items
        if (!isRecordView && item.type === 'record') return false;
        const name = String(item.name || item.title || '').toLowerCase();
        return !query || name.includes(query);
    });
}

export class XdhStagingDock extends BaseElement {
    constructor() {
        super();
        this.selectedCount = 0;
        this.expanded = false;
        // Keep track of which file goes to which node.
        // e.g., { '1': 10, '2': 11 } where keys are file IDs, values are node IDs
        this.routingMap = {};
    }

    onStoreUpdate(state, key, value) {
        if (key === 'selectedItems') {
            this.selectedCount = value.length;
            if (this.selectedCount === 0) {
                this.expanded = false; // Auto close if empty
            }
            // Cleanup routing map for unselected items
            const newMap = {};
            value.forEach(id => {
                if (this.routingMap[id]) newMap[id] = this.routingMap[id];
            });
            this.routingMap = newMap;
            this.renderRoot();
        } else if (
            key === 'locale'
            || key === 'mediaList'
            || key === 'activeCategory'
            || key === 'searchQuery'
            || key === 'loraDetailOpen'
        ) {
            this.renderRoot();
        }
    }

    bindEvents() {
        const toggleBtn = this.$('.dock-header');
        if (toggleBtn) {
            toggleBtn.addEventListener('click', () => {
                if (this.selectedCount > 0) {
                    this.expanded = !this.expanded;
                    this.renderRoot();
                }
            });
        }

        const selectToggleBtn = this.$('.select-toggle-btn');
        if (selectToggleBtn) {
            selectToggleBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const selectableIds = getSelectableItems(appStore.state)
                    .map(item => item.id);
                const selectedIds = appStore.state.selectedItems || [];
                const allSelected = selectableIds.length > 0
                    && selectableIds.every(id => selectedIds.includes(id));
                appStore.state.selectedItems = allSelected
                    ? selectedIds.filter(id => !selectableIds.includes(id))
                    : [...new Set([...selectedIds, ...selectableIds])];
            });
        }

        const clearBtn = this.$('.clear-btn');
        if (clearBtn) {
            clearBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                appStore.state.selectedItems = [];
            });
        }

        const dragHandle = this.$('.dock-drag-handle');
        if (dragHandle) {
            dragHandle.addEventListener('dragstart', (e) => {
                const selectedIds = appStore.state.selectedItems;
                e.dataTransfer.setData('text/plain', JSON.stringify({
                    type: 'batch',
                    items: selectedIds,
                }));
                // Also set the first item's payload for single-node drops
                const firstItem = (appStore.state.mediaList || []).find(
                    m => selectedIds.includes(m.id)
                );
                if (firstItem) {
                    const extra = firstItem.raw?.extra || {};
                    const mediaRef = String(
                        extra.media_ref || firstItem.raw?.media_ref
                        || firstItem.raw?.ref || ""
                    );
                    const xdhPayload = {
                        source: "xdatahub",
                        media_ref: mediaRef,
                        media_type: String(
                            firstItem.type || "image"
                        ).toLowerCase(),
                        title: String(
                            firstItem.title || firstItem.name || ""
                        ),
                    };
                    e.dataTransfer.setData(
                        "application/x-xdatahub-media+json",
                        JSON.stringify(xdhPayload)
                    );
                }
                e.stopPropagation();
            });
        }

        // Listen for node-picker events
        const pickers = this.$$('xdh-node-picker');
        pickers.forEach(picker => {
            picker.addEventListener('node-selected', (e) => {
                const fileId = e.target.dataset.fileId;
                const nodeId = e.detail.nodeId;
                this.routingMap[fileId] = nodeId;
            });
        });

        // Apply All — send each selected item to its target node
        const applyBtn = this.$('.apply-all-btn');
        if (applyBtn) {
            applyBtn.addEventListener('click', () => {
                this._sendAll();
            });
        }
    }

    async _sendAll() {
        const state = appStore.state;
        const selectedIds = state.selectedItems || [];
        const mediaList   = state.mediaList   || [];
        const category    = state.activeCategory || 'image';
        const nodeClass   = CATEGORY_NODE_CLASS[category] || 'XImageGet';

        // Get the batch picker's selected node
        const batchPicker = this.$('xdh-node-picker[data-batch]');
        const batchNode   = batchPicker?.selectedNode || null;

        let successCount = 0;
        let failCount    = 0;

        for (const itemId of selectedIds) {
            // Per-item target from routingMap, else fall back to batch picker node
            const targetNodeId = this.routingMap[itemId] != null
                ? String(this.routingMap[itemId])
                : batchNode ? String(batchNode.id) : null;

            if (!targetNodeId) {
                failCount += 1;
                continue;
            }

            const item = mediaList.find(
                (m) => String(m.id) === String(itemId)
            );
            const extra     = item?.raw?.extra || {};
            const mediaRef  = item
                ? String(
                    extra.media_ref || item.media_ref || item.ref || ''
                  )
                : '';
            // For text/history items, extract text payload
            const rawPayload = extra?.payload;
            let textValue = '';
            if (!mediaRef) {
                if (typeof rawPayload === 'string') {
                    textValue = rawPayload.trim();
                } else if (rawPayload && typeof rawPayload === 'object') {
                    textValue = String(rawPayload.text || rawPayload.payload || '')
                        .trim();
                }
            }
            const title = item
                ? String(item.title || item.name || '')
                : '';

            if (!mediaRef && !textValue) {
                failCount += 1;
                continue;
            }

            const result = await sendToNode({
                nodeId: targetNodeId,
                nodeClass,
                mediaRef,
                textValue,
                title,
            });

            if (result.ok) {
                successCount += 1;
            } else {
                failCount += 1;
            }
        }

        // Clear after send
        appStore.state.selectedItems = [];
        this.routingMap = {};

        // Show result banner
        if (failCount === 0) {
            banner.success(t('dock.send_success', { count: successCount }));
        } else {
            banner.warn(t('dock.send_partial', {
                success: successCount,
                fail: failCount,
            }));
        }
    }

    render() {
        const state = appStore.state;
        const isRecordView = ['history', 'favorites'].includes(
            state.activeCategory
        );
        const selectableItems = getSelectableItems(state);
        const selectableIds = selectableItems.map(item => item.id);
        const selectedIds = state.selectedItems || [];
        const allSelectableSelected = selectableIds.length > 0
            && selectableIds.every(id => selectedIds.includes(id));
        const selectedPreviewItems = selectedIds.slice(0, 10).map(id => {
            const item = (state.mediaList || []).find(entry => entry.id === id);
            return item || { id, name: id };
        });

        if (this.selectedCount === 0 || state.loraDetailOpen) {
            return `<style>:host { display: none; }</style>`;
        }

        return `
            <style>
                ${ICON_CSS}
                ${SCROLLBAR_CSS}
                ${TOOLTIP_CSS}
                :host {
                    position: fixed;
                    bottom: 52px;
                    left: 50%;
                    transform: translateX(-50%);
                    z-index: 1000;
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    pointer-events: none; /* Let clicks pass through container */
                }

                .dock-container {
                    background: var(--xdh-color-surface-2, #2a2a2a);
                    border: 1px solid var(--xdh-color-border, #444);
                    border-radius: 12px;
                    box-shadow: 0 8px 32px rgba(0,0,0,0.5);
                    pointer-events: auto;
                    transition: all 0.3s cubic-bezier(0.25, 0.8, 0.25, 1);
                    width: ${this.expanded ? '400px' : 'auto'};
                    max-width: 90vw;
                    overflow: visible; /* Need visible for picker dropdown to bleed out */
                    display: flex;
                    flex-direction: column;
                }

                .dock-header {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    padding: 8px 12px;
                    cursor: pointer;
                    background: var(--xdh-color-surface-3, #333);
                    gap: 12px;
                    border-radius: ${this.expanded ? '12px 12px 0 0' : '12px'};
                    white-space: nowrap;
                }

                .dock-header:hover {
                    background: var(--xdh-color-surface-4, #3d3d3d);
                }

                .dock-title {
                    display: flex;
                    align-items: center;
                    gap: 6px;
                    white-space: nowrap;
                    flex-shrink: 0;
                }

                .dock-actions {
                    display: flex;
                    gap: 6px;
                    align-items: center;
                    flex-shrink: 0;
                }

                .dock-action-btn {
                    background: transparent;
                    border: 1px solid var(--xdh-color-border, #444);
                    color: var(--xdh-color-text-secondary, #aaa);
                    cursor: pointer;
                    white-space: nowrap;
                    flex-shrink: 0;
                    border-radius: 6px;
                    height: 28px;
                    width: 28px;
                    padding: 0;
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    gap: 6px;
                    transition: background 0.15s ease, color 0.15s ease,
                        border-color 0.15s ease;
                }

                .dock-action-btn:hover {
                    background: var(--xdh-color-surface-4, #3d3d3d);
                    color: var(--xdh-color-text-primary, #eee);
                }

                .dock-action-btn.active {
                    background: var(--xdh-color-primary-muted, #1a3050);
                    color: var(--xdh-color-primary, #4499ff);
                    border-color: var(--xdh-color-primary, #4499ff);
                }

                .dock-action-btn:disabled {
                    opacity: 0.35;
                    cursor: not-allowed;
                }

                .badge {
                    background: var(--xdh-color-primary, #0066cc);
                    color: #fff;
                    border-radius: 12px;
                    padding: 2px 7px;
                    font-size: 12px;
                    font-weight: bold;
                    flex-shrink: 0;
                }

                .dock-drag-handle {
                    cursor: grab;
                    width: 28px;
                    height: 28px;
                    border-radius: 6px;
                    border: 1px solid var(--xdh-color-border, #444);
                    background: transparent;
                    color: var(--xdh-color-text-secondary, #aaa);
                    font-size: 12px;
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    flex-shrink: 0;
                    transition: background 0.15s ease, color 0.15s ease;
                }

                .dock-drag-handle:hover {
                    background: var(--xdh-color-surface-4, #3d3d3d);
                    color: var(--xdh-color-text-primary, #eee);
                }

                .dock-drag-handle:active {
                    cursor: grabbing;
                }

                .clear-btn-wrap {
                    flex-shrink: 0;
                }

                .dock-body {
                    display: ${this.expanded ? 'block' : 'none'};
                    padding: 16px;
                }

                .compact-item-list {
                    display: flex;
                    flex-wrap: wrap;
                    gap: 8px;
                    margin-bottom: 16px;
                    max-height: 150px;
                    overflow-y: auto;
                    background: var(--xdh-color-surface-1, #1e1e1e);
                    padding: 8px;
                    border-radius: 8px;
                    scrollbar-width: thin;
                }

                .pill {
                    background: var(--xdh-color-surface-3, #3a3a3a);
                    color: #ddd;
                    font-size: 12px;
                    padding: 4px 8px;
                    border-radius: 12px;
                    white-space: nowrap;
                }

                .more-pill {
                    background: transparent;
                    color: var(--xdh-color-primary, #0066cc);
                    border: 1px solid var(--xdh-color-primary, #0066cc);
                    font-weight: bold;
                }

                .batch-target-row {
                    display: flex;
                    flex-direction: column;
                    gap: 6px;
                    padding: 10px 0 0;
                }

                .batch-target-label {
                    font-size: 11px;
                    color: var(--xdh-color-text-secondary, #888);
                    text-transform: uppercase;
                    letter-spacing: 0.04em;
                }

                .actions {
                    padding: 16px;
                    display: flex;
                    justify-content: flex-end;
                    gap: 8px;
                    background: var(--xdh-color-surface-1, #1e1e1e);
                    border-top: 1px solid var(--xdh-color-border, #444);
                    border-radius: 0 0 12px 12px;
                }
            </style>

            <div class="dock-container">
                <div class="dock-header">
                    <div class="dock-title">
                        ${icon('shopping-cart', 15)} <span>${t('dock.title')}</span>
                        <span class="badge">${this.selectedCount}</span>
                    </div>
                    <div class="dock-actions">
                        <button class="dock-action-btn select-toggle-btn xdh-tooltip xdh-tooltip-up ${allSelectableSelected ? 'active' : ''}"
                                data-tooltip="${allSelectableSelected ? t('nav.btn.deselect_all') : t('nav.btn.select_all')}"
                                ${selectableIds.length === 0 ? 'disabled' : ''}>
                            ${icon(allSelectableSelected ? 'square-check-big' : 'square', 14)}
                        </button>
                        ${this.selectedCount > 0 ? `<div class="dock-drag-handle xdh-tooltip xdh-tooltip-up" draggable="true" data-tooltip="${t('dock.drag_all')}">${icon('hand-grab', 14)}</div>` : ''}
                        ${this.selectedCount > 0 ? `<button class="dock-action-btn clear-btn xdh-tooltip xdh-tooltip-up" data-tooltip="${t('dock.clear')}">${icon('trash-2', 14)}</button>` : ''}
                    </div>
                </div>

                ${this.expanded ? `
                    <div class="dock-body">
                        <div style="font-size: 13px; color: #888; margin-bottom: 8px;">${t('dock.selected', { count: appStore.state.selectedItems.length })}</div>
                        <div class="compact-item-list xdh-scroll">
                            ${selectedPreviewItems.map(item => `<span class="pill">${icon('file', 11)} ${String(item.title || item.name || item.id)}</span>`).join('')}
                            ${appStore.state.selectedItems.length > 10 ? `<span class="pill more-pill">${t('dock.more_items', { count: appStore.state.selectedItems.length - 10 })}</span>` : ''}
                        </div>
                        <div class="batch-target-row">
                            <span class="batch-target-label">${t('dock.batch_target')}</span>
                            <xdh-node-picker data-batch="true"></xdh-node-picker>
                        </div>
                    </div>
                    <div class="actions">
                        <xdh-button variant="primary" class="apply-all-btn">${icon('send', 14)} ${t('dock.send')}</xdh-button>
                    </div>
                ` : ''}
            </div>
        `;
    }
}

customElements.define('xdh-staging-dock', XdhStagingDock);
