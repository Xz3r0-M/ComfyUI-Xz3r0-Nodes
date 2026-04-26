import {
    BaseElement,
    registerCustomElement,
} from '../core/base-element.js?v=20260403-2';
import { appStore } from '../core/store.js';
import { icon, ICON_CSS, TOOLTIP_CSS } from '../core/icon.js';
import { t } from '../core/i18n.js?v=20260406-15';
import { banner } from '../core/banner.js';
import { resolveTokenAccentFromNode } from '../core/node-accent.js?v=20260402-400';
import {
    sendToNode,
    resolveNodeClassFromTargetType,
    resolveNodeClassFromCategory,
} from '../core/node-bridge.js?v=20260426-1';

function escapeAttr(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

export class XdhStagingDock extends BaseElement {
    constructor() {
        super();
        const initialSelectedItems = Array.isArray(appStore.state.selectedItems)
            ? appStore.state.selectedItems
            : [];
        const normalizedInitialSelected = initialSelectedItems.length > 0
            ? [initialSelectedItems[initialSelectedItems.length - 1]]
            : [];
        this.selectedCount = normalizedInitialSelected.length;
        this.batchTargetNodeId = '';
        this.batchTargetNodeTitle = '';
        this.batchTargetNodeColor = '';
        this.selectedItemSnapshot = null;
        this._collapsed = false;
        if (normalizedInitialSelected.length > 0) {
            const selectedId = String(normalizedInitialSelected[0]);
            const liveItem = ((appStore.state && appStore.state.mediaList) || []).find(
                (entry) => String(entry.id) === selectedId
            );
            if (liveItem) {
                this.selectedItemSnapshot = liveItem;
            }
        }
    }

    onStoreUpdate(state, key, value) {
        if (key === 'selectedItems') {
            const incoming = Array.isArray(value) ? value : [];
            const normalized = incoming.length > 0
                ? [incoming[incoming.length - 1]]
                : [];
            if (
                incoming.length !== normalized.length
                || incoming[0] !== normalized[0]
            ) {
                appStore.state.selectedItems = normalized;
                return;
            }
            this.selectedCount = normalized.length;
            if (normalized.length === 0) {
                this.selectedItemSnapshot = null;
            } else {
                const selectedId = String(normalized[0]);
                const liveItem = (state.mediaList || []).find(
                    (entry) => String(entry.id) === selectedId
                );
                if (liveItem) {
                    this.selectedItemSnapshot = liveItem;
                }
            }
            this.renderRoot();
        } else if (key === 'activeCategory') {
            // Different category may map to different node class.
            this.batchTargetNodeId = '';
            this.batchTargetNodeTitle = '';
            this.batchTargetNodeColor = '';
            this.selectedItemSnapshot = null;
            this.renderRoot();
        } else if (
            key === 'locale'
            || key === 'mediaList'
            || key === 'searchQuery'
            || key === 'loraDetailOpen'
        ) {
            const selectedId = String((state.selectedItems || [])[0] || '');
            if (selectedId) {
                const liveItem = (state.mediaList || []).find(
                    (entry) => String(entry.id) === selectedId
                );
                if (liveItem) {
                    this.selectedItemSnapshot = liveItem;
                }
            }
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
                this._sendSelected();
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
            });
        }
    }

    async _sendSelected() {
        const state = appStore.state;
        const selectedIds = state.selectedItems || [];
        const selectedId = selectedIds[0];
        if (!selectedId) {
            return;
        }
        const mediaList   = state.mediaList   || [];
        const category    = state.activeCategory || 'image';
        const batchPicker = this.$('xdh-node-picker[data-batch]');
        const pickerTargetType = String(
            batchPicker?.getAttribute('target-type') || category
        ).trim();
        const nodeClass   = resolveNodeClassFromTargetType(pickerTargetType)
            || resolveNodeClassFromCategory(category);
        const batchNodeId = String(
            batchPicker?.selectedNode?.id
            || this.batchTargetNodeId
            || ''
        ).trim();

        if (!batchNodeId) {
            banner.warn(t('dock.send_partial', { success: 0, fail: 1 }));
            return;
        }

        const item = mediaList.find((m) => String(m.id) === String(selectedId))
            || this.selectedItemSnapshot;
        const extra = item?.raw?.extra || {};
        const mediaRef = item
            ? String(extra.media_ref || item.media_ref || item.ref || '')
            : '';
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
        const title = item ? String(item.title || item.name || '') : '';

        if (!mediaRef && !textValue) {
            banner.warn(t('dock.send_partial', { success: 0, fail: 1 }));
            return;
        }

        const result = await sendToNode({
            nodeId: batchNodeId,
            nodeClass,
            mediaRef,
            textValue,
            title,
        });

        if (result.ok) {
            appStore.state.selectedItems = [];
            this.selectedItemSnapshot = null;
            banner.success(t('dock.send_success', { count: 1 }));
        } else {
            banner.warn(t('dock.send_partial', { success: 0, fail: 1 }));
        }
    }

    render() {
        const state = appStore.state;
        const selectedIds = state.selectedItems || [];
        const selectedItem = selectedIds.length > 0
            ? (state.mediaList || []).find(
                (entry) => String(entry.id) === String(selectedIds[0])
            ) || this.selectedItemSnapshot
            : null;
        const selectedLabel = String(
            selectedItem?.title || selectedItem?.name || selectedIds[0] || ''
        );
        const selectedLabelEscaped = escapeAttr(selectedLabel);
        const pickerTargetType = String(state.activeCategory || 'image');

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
                    --dock-panel-bg: var(--xdh-color-surface-2, #2a2a2a);
                    --dock-header-bg: var(--xdh-color-surface-3, #333333);
                    --dock-inner-bg: var(--xdh-color-surface-1, #1e1e1e);
                    --dock-muted-bg: var(--xdh-color-surface-3, #3a3a3a);
                    --dock-hover-bg: var(--xdh-color-surface-4, #3d3d3d);
                    --dock-border: var(--xdh-color-border, #444444);
                    --dock-shadow: 0 6px 24px rgba(0, 0, 0, 0.55),
                        0 0 0 1px color-mix(in srgb, var(--xdh-color-primary, #4499ff) 16%, transparent);
                    --dock-active-bg: var(--xdh-color-primary-muted, #1a3050);
                    --dock-active-color: var(--xdh-color-primary, #4499ff);
                    --dock-secondary-text: var(
                        --xdh-color-text-secondary,
                        #aaaaaa
                    );
                }

                :host-context(body[data-theme="light"]) {
                    --dock-panel-bg: color-mix(
                        in oklch,
                        var(--xdh-pure-white) 92%,
                        var(--xdh-color-surface-2) 8%
                    );
                    --dock-header-bg: color-mix(
                        in oklch,
                        var(--xdh-pure-white) 88%,
                        var(--xdh-color-surface-3) 12%
                    );
                    --dock-inner-bg: color-mix(
                        in oklch,
                        var(--xdh-pure-white) 96%,
                        var(--xdh-color-surface-1) 4%
                    );
                    --dock-muted-bg: color-mix(
                        in oklch,
                        var(--xdh-pure-white) 88%,
                        var(--xdh-color-surface-3) 12%
                    );
                    --dock-hover-bg: color-mix(
                        in oklch,
                        var(--xdh-pure-white) 82%,
                        var(--xdh-color-surface-4) 18%
                    );
                    --dock-border: color-mix(
                        in oklch,
                        var(--xdh-color-border) 72%,
                        var(--xdh-pure-black) 28%
                    );
                    --dock-shadow: 0 12px 28px rgba(0, 0, 0, 0.16),
                        0 2px 6px rgba(0, 0, 0, 0.06);
                    --dock-active-bg: color-mix(
                        in oklch,
                        var(--xdh-brand-pink) 10%,
                        var(--xdh-pure-white) 90%
                    );
                    --dock-active-color: var(--xdh-brand-pink);
                    --dock-secondary-text: var(--xdh-color-text-secondary);
                }

                .dock-container {
                    background: var(--dock-panel-bg);
                    border: 1px solid var(--dock-border);
                    border-radius: 10px;
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
                    border-radius: 8px 8px 0 0;
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
                    color: var(--xdh-color-text-primary, #eeeeee);
                }
                /* standalone (collapsed) state */
                .dock-toggle.solo {
                    border-bottom: 1px solid var(--dock-border);
                    border-radius: 8px 8px 0 0;
                    height: 24px;
                    box-shadow: var(--dock-shadow);
                    margin-bottom: 0px;
                }

                .dock-header {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    padding: 5px 10px;
                    background: var(--dock-header-bg);
                    gap: 8px;
                    border-radius: 10px 10px 0 0;
                    white-space: nowrap;
                    transition: background-color 0.15s ease, color 0.15s ease;
                    border-bottom: 1px solid var(--dock-border);
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
                    border: 1px solid var(--dock-border);
                    color: var(--dock-secondary-text);
                    cursor: pointer;
                    white-space: nowrap;
                    flex-shrink: 0;
                    border-radius: 5px;
                    height: 24px;
                    width: 24px;
                    padding: 0;
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    gap: 4px;
                    transition: background-color 0.15s ease,
                        color 0.15s ease,
                        border-color 0.15s ease;
                }

                .dock-action-btn:hover {
                    background: var(--dock-hover-bg);
                    color: var(--xdh-color-text-primary, #eeeeee);
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
                    background: var(--xdh-color-primary, #0066cc);
                    color: #fff;
                    border-radius: 12px;
                    padding: 2px 7px;
                    font-size: 12px;
                    font-weight: bold;
                    flex-shrink: 0;
                }

                .dock-body {
                    display: block;
                    padding: 10px 10px 4px;
                }

                .selected-item {
                    margin-bottom: 8px;
                    background: color-mix(in srgb, var(--dock-inner-bg) 88%, var(--dock-active-color, #4499ff) 12%);
                    border: 1px solid color-mix(in srgb, var(--dock-border) 50%, var(--dock-active-color, #4499ff) 50%);
                    border-radius: 6px;
                    padding: 5px 8px;
                    font-size: 12px;
                    color: var(--xdh-color-text-primary, #dddddd);
                    overflow: hidden;
                    text-overflow: ellipsis;
                }

                .batch-target-row {
                    display: flex;
                    flex-direction: column;
                    gap: 4px;
                    padding: 6px 0 0;
                }

                .batch-target-label {
                    font-size: 10px;
                    color: var(--dock-secondary-text);
                    text-transform: uppercase;
                    letter-spacing: 0.04em;
                }

                .actions {
                    padding: 0 10px 8px;
                    display: flex;
                    justify-content: flex-end;
                    gap: 6px;
                    border-radius: 0 0 10px 10px;
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
                    <div class="selected-item xdh-tooltip xdh-tooltip-up" data-tooltip="${selectedLabelEscaped}">
                        ${icon('file', 11)} ${selectedLabelEscaped}
                    </div>
                    <div class="batch-target-row">
                        <span class="batch-target-label">${t('dock.batch_target')}</span>
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
                    <xdh-button variant="primary" class="apply-btn">
                        ${icon('send', 14)} ${t('dock.send')}
                    </xdh-button>
                </div>
            </div>
            `}
        `;
    }
}

registerCustomElement('xdh-staging-dock', XdhStagingDock);
