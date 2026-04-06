import {
    BaseElement,
    registerCustomElement,
} from '../core/base-element.js?v=20260403-2';
import { appStore } from '../core/store.js';
import { t } from '../core/i18n.js?v=20260406-15';
import { resolveTokenAccentFromNode } from '../core/node-accent.js?v=20260402-400';
import { SCROLLBAR_CSS } from '../core/icon.js';
import {
    requestNodes,
    CATEGORY_NODE_CLASS,
    resolveNodeClassFromTargetType,
    resolveNodeClassFromCategory,
} from '../core/node-bridge.js?v=20260403-400';

function compareNodeByIdAsc(left, right) {
    const leftId = String(left?.id ?? '');
    const rightId = String(right?.id ?? '');
    const leftNum = Number.parseInt(leftId, 10);
    const rightNum = Number.parseInt(rightId, 10);
    const leftNumValid = Number.isFinite(leftNum);
    const rightNumValid = Number.isFinite(rightNum);

    if (leftNumValid && rightNumValid && leftNum !== rightNum) {
        return leftNum - rightNum;
    }
    if (leftNumValid && !rightNumValid) {
        return -1;
    }
    if (!leftNumValid && rightNumValid) {
        return 1;
    }
    return leftId.localeCompare(rightId, undefined, { numeric: true });
}

function escapeHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function escapeAttr(value) {
    return escapeHtml(value);
}

export class XdhNodePicker extends BaseElement {
    constructor() {
        super();
        this.expanded = false;
        this.searchQuery = '';
        this.targetType = '';
        this.selectedNode = null;
        this.selectedNodeId = '';
        this.selectedNodeTitle = '';
        this.selectedNodeColor = '';
        this.nodes = [];
        this.loading = false;
        this.docsListenerAdded = false;
        this._fetchRequestSeq = 0;
        this._onDocumentClick = this._handleDocumentClick.bind(this);
    }

    static get observedAttributes() {
        return [
            'target-type',
            'selected-node-id',
            'selected-node-title',
            'selected-node-color',
        ];
    }

    attributeChangedCallback(name, _oldValue, newValue) {
        if (name === 'target-type') {
            const nextTargetType = String(newValue || '').trim();
            if (this.targetType === nextTargetType) {
                return;
            }
            this.targetType = nextTargetType;
            this.selectedNode = null;
            this.nodes = [];
            if (this.expanded) {
                this._fetchNodes();
                return;
            }
            this.renderRoot();
            return;
        }
        if (name === 'selected-node-id') {
            this.selectedNodeId = String(newValue || '').trim();
            this._syncSelectedNodeFromId();
            return;
        }
        if (name === 'selected-node-title') {
            this.selectedNodeTitle = String(newValue || '').trim();
            this.renderRoot();
            return;
        }
        if (name === 'selected-node-color') {
            this.selectedNodeColor = String(newValue || '').trim();
            this.renderRoot();
        }
    }

    _syncSelectedNodeFromId() {
        if (!this.selectedNodeId) {
            return;
        }
        if (!Array.isArray(this.nodes) || this.nodes.length === 0) {
            return;
        }
        const matched = this.nodes.find(
            (node) => String(node.id) === this.selectedNodeId
        ) || null;
        if (!matched) {
            return;
        }
        this.selectedNode = matched;
        this.selectedNodeTitle = String(matched.title || '').trim();
        this.selectedNodeColor = String(resolveTokenAccentFromNode(matched));
    }

    _getNodeClass() {
        const targetNodeClass = resolveNodeClassFromTargetType(this.targetType);
        if (targetNodeClass) {
            return targetNodeClass;
        }

        const category = appStore.state.activeCategory || 'image';
        return resolveNodeClassFromCategory(category);
    }

    _isEventInsidePicker(event) {
        const path = typeof event?.composedPath === 'function'
            ? event.composedPath()
            : [];
        if (path.includes(this)) {
            return true;
        }
        if (this.shadowRoot && path.includes(this.shadowRoot)) {
            return true;
        }
        const target = event?.target;
        return Boolean(target && this.contains(target));
    }

    _handleDocumentClick(e) {
        if (this.expanded && !this._isEventInsidePicker(e)) {
            this.expanded = false;
            this.renderRoot();
        }
    }

    bindEvents() {
        const toggleBtn = this.$('.picker-toggle');
        if (toggleBtn) {
            toggleBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.expanded = !this.expanded;
                if (this.expanded) {
                    this._fetchNodes();
                }
                this.renderRoot();
            });
        }

        const searchInput = this.$('.picker-search input');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                this.searchQuery = String(e.target?.value || '');
                this.renderRoot();
                // re-focus input since renderRoot recreates DOM
                const newSearchInput = this.$('.picker-search input');
                if (newSearchInput) {
                    newSearchInput.focus();
                    newSearchInput.setSelectionRange(this.searchQuery.length, this.searchQuery.length);
                }
            });
            searchInput.addEventListener('click', e => e.stopPropagation());
        }

        const options = this.$$('.node-option');
        options.forEach(opt => {
            opt.addEventListener('click', (e) => {
                e.stopPropagation();
                const nodeId = String(opt.dataset.id || '');
                this.selectedNode = this.nodes.find(
                    n => String(n.id) === nodeId
                ) || null;
                this.selectedNodeId = nodeId;
                this.selectedNodeTitle = String(
                    this.selectedNode?.title || ''
                ).trim();
                this.selectedNodeColor = this.selectedNode
                    ? String(resolveTokenAccentFromNode(this.selectedNode))
                    : '';
                this.dispatchEvent(new CustomEvent('node-selected', {
                    detail: {
                        nodeId,
                        node: this.selectedNode,
                    },
                    bubbles: true,
                    composed: true
                }));
                this.expanded = false;
                this.renderRoot();
            });
        });

        // Click outside to close
        if (!this.docsListenerAdded) {
            document.addEventListener('click', this._onDocumentClick);
            this.docsListenerAdded = true;
        }
    }

    disconnectedCallback() {
        super.disconnectedCallback?.();
        if (this.docsListenerAdded) {
            document.removeEventListener('click', this._onDocumentClick);
            this.docsListenerAdded = false;
        }
    }

    _fetchNodes() {
        const nodeClass = this._getNodeClass();
        const requestSeq = ++this._fetchRequestSeq;
        this.loading = true;
        this.renderRoot();
        requestNodes(nodeClass).then((nodes) => {
            if (requestSeq !== this._fetchRequestSeq) {
                return;
            }
            this.nodes = Array.isArray(nodes)
                ? [...nodes].sort(compareNodeByIdAsc)
                : [];
            this._syncSelectedNodeFromId();
            if (this.selectedNode) {
                const selectedId = String(this.selectedNode.id || '');
                this.selectedNode = this.nodes.find(
                    (node) => String(node.id) === selectedId
                ) || this.selectedNode;
            }
            this.loading = false;
            this.renderRoot();
            // keep search focus
            const input = this.$('.picker-search input');
            if (input) {
                input.focus();
                input.setSelectionRange(
                    this.searchQuery.length,
                    this.searchQuery.length
                );
            }
        });
    }

    render() {
        const normalizedSearchQuery = this.searchQuery.toLowerCase();

        // Filter nodes based on search query
        const filteredNodes = this.nodes.filter(n => {
            if (!normalizedSearchQuery) return true;
            return String(n.title || '').toLowerCase().includes(
                normalizedSearchQuery
            ) || String(n.id).includes(normalizedSearchQuery);
        });

        const getColor = (node) => resolveTokenAccentFromNode(node);

        const sn = this.selectedNode;
        const fallbackTitle = this.selectedNodeTitle
            ? this.selectedNodeTitle
            : this.selectedNodeId
                ? `#${this.selectedNodeId}`
                : '';
        const fallbackColor = this.selectedNodeColor
            ? this.selectedNodeColor
            : 'var(--db-palette-default)';
        const selectedNodeTitle = sn
            ? escapeHtml(String(sn.title || ''))
            : '';
        const selectedNodeId = sn
            ? escapeHtml(String(sn.id || ''))
            : '';
        const selectedNodeColor = sn
            ? escapeAttr(getColor(sn))
            : '';
        const fallbackTitleText = escapeHtml(fallbackTitle);
        const fallbackNodeId = escapeHtml(this.selectedNodeId);
        const fallbackNodeColor = escapeAttr(fallbackColor);
        const pickerPlaceholder = escapeHtml(t('picker.placeholder'));
        const pickerLoading = escapeHtml(t('picker.loading'));
        const pickerEmpty = escapeHtml(t('picker.empty'));
        const searchPlaceholder = escapeAttr(
            t('picker.search_placeholder')
        );
        const searchQueryValue = escapeAttr(this.searchQuery);

        const toggleContent = sn
            ? `<span class="node-color-dot"
                    style="background:${selectedNodeColor};flex-shrink:0">
               </span>
               <span class="toggle-name">${selectedNodeTitle}</span>
               <span class="toggle-id">#${selectedNodeId}</span>`
            : fallbackTitle
                ? `<span class="node-color-dot"
                        style="background:${fallbackNodeColor};flex-shrink:0">
                   </span>
                   <span class="toggle-name">${fallbackTitleText}</span>
                   <span class="toggle-id">#${fallbackNodeId}</span>`
            : `<span class="toggle-placeholder">${pickerPlaceholder}</span>`;

        const listContent = this.loading
            ? `<div class="picker-empty">${pickerLoading}</div>`
            : filteredNodes.length === 0
                ? `<div class="picker-empty">${pickerEmpty}</div>`
                : filteredNodes.map(n => `
                    <div class="node-option${sn && String(sn.id) === String(n.id) ? ' selected' : ''}"
                         data-id="${escapeAttr(String(n.id ?? ''))}">
                        <span class="node-color-dot"
                              style="background:${escapeAttr(getColor(n))}">
                        </span>
                        <span>${escapeHtml(String(n.title || ''))}</span>
                        <span class="node-id">#${escapeHtml(String(n.id ?? ''))}</span>
                    </div>
                `).join('');

        return `
            <style>
                ${SCROLLBAR_CSS}
                :host {
                    display: block;
                    position: relative;
                    font-family: sans-serif;
                    width: 100%;
                    --picker-toggle-bg: var(--xdh-color-surface-1, #1e1e1e);
                    --picker-panel-bg: var(--xdh-color-surface-2, #2a2a2a);
                    --picker-input-bg: var(--xdh-color-surface-1, #111111);
                    --picker-muted-bg: var(--xdh-color-surface-3, #3a3a3a);
                    --picker-hover-bg: var(--xdh-color-surface-3, #3d3d3d);
                    --picker-border: var(--xdh-color-border, #444444);
                    --picker-shadow: 0 -6px 20px rgba(0, 0, 0, 0.5);
                    --picker-active-bg: var(--xdh-color-primary-muted, #1a3050);
                    --picker-active-color: var(--xdh-color-primary, #4499ff);
                    --picker-secondary-text: var(
                        --xdh-color-text-secondary,
                        #777777
                    );
                }

                :host-context(body[data-theme="light"]) {
                    --picker-toggle-bg: color-mix(
                        in oklch,
                        var(--xdh-pure-white) 96%,
                        var(--xdh-color-surface-1) 4%
                    );
                    --picker-panel-bg: color-mix(
                        in oklch,
                        var(--xdh-pure-white) 90%,
                        var(--xdh-color-surface-2) 10%
                    );
                    --picker-input-bg: var(--xdh-pure-white);
                    --picker-muted-bg: color-mix(
                        in oklch,
                        var(--xdh-pure-white) 86%,
                        var(--xdh-color-surface-3) 14%
                    );
                    --picker-hover-bg: color-mix(
                        in oklch,
                        var(--xdh-pure-white) 82%,
                        var(--xdh-color-surface-3) 18%
                    );
                    --picker-border: color-mix(
                        in oklch,
                        var(--xdh-color-border) 72%,
                        var(--xdh-pure-black) 28%
                    );
                    --picker-shadow: 0 -10px 24px rgba(0, 0, 0, 0.14),
                        0 2px 6px rgba(0, 0, 0, 0.06);
                    --picker-active-bg: color-mix(
                        in oklch,
                        var(--xdh-brand-pink) 10%,
                        var(--xdh-pure-white) 90%
                    );
                    --picker-active-color: var(--xdh-brand-pink);
                    --picker-secondary-text: var(--xdh-color-text-secondary);
                }

                .picker-toggle {
                    background: var(--picker-toggle-bg);
                    border: 1px solid ${sn
                        ? 'var(--picker-active-color)'
                        : 'var(--picker-border)'};
                    color: var(--xdh-color-text-primary, #eee);
                    padding: 6px 10px;
                    border-radius: 6px;
                    cursor: pointer;
                    display: flex;
                    align-items: center;
                    gap: 7px;
                    width: 100%;
                    box-sizing: border-box;
                    font-size: 13px;
                    transition: background-color 0.15s ease,
                        border-color 0.15s ease,
                        color 0.15s ease,
                        box-shadow 0.15s ease;
                }
                .picker-toggle:hover {
                    border-color: var(--picker-active-color);
                }

                .toggle-placeholder {
                    color: var(--picker-secondary-text);
                    flex: 1;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                }
                .toggle-name {
                    flex: 1;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                }
                .toggle-id {
                    font-size: 11px;
                    color: var(--picker-secondary-text);
                    background: var(--picker-muted-bg);
                    padding: 1px 5px;
                    border-radius: 4px;
                    flex-shrink: 0;
                }
                .toggle-chevron {
                    color: var(--picker-secondary-text);
                    flex-shrink: 0;
                    font-size: 10px;
                    margin-left: auto;
                }

                .node-color-dot {
                    width: 10px;
                    height: 10px;
                    border-radius: 50%;
                    display: inline-block;
                }

                .picker-dropdown {
                    display: ${this.expanded ? 'block' : 'none'};
                    position: absolute;
                    bottom: calc(100% + 4px);
                    left: 0;
                    right: 0;
                    background: var(--picker-panel-bg);
                    border: 1px solid var(--picker-border);
                    border-radius: 8px;
                    box-shadow: var(--picker-shadow);
                    max-height: 240px;
                    overflow-y: auto;
                    z-index: 2000;
                }

                .picker-search {
                    padding: 8px;
                    position: sticky;
                    top: 0;
                    background: var(--picker-panel-bg);
                    border-bottom: 1px solid var(--picker-border);
                    z-index: 10;
                }

                .picker-search input {
                    width: 100%;
                    box-sizing: border-box;
                    background: var(--picker-input-bg);
                    border: 1px solid var(--picker-border);
                    color: var(--xdh-color-text-primary, #fff);
                    padding: 5px 8px;
                    border-radius: 5px;
                    outline: none;
                    font-size: 12px;
                }
                .picker-search input:focus {
                    border-color: var(--picker-active-color);
                }

                .node-option {
                    padding: 7px 12px;
                    font-size: 13px;
                    color: var(--picker-secondary-text);
                    cursor: pointer;
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    transition: background-color 0.12s ease,
                        color 0.12s ease;
                }
                .node-option:hover {
                    background: var(--picker-hover-bg);
                    color: var(--xdh-color-text-primary, #ffffff);
                }
                .node-option.selected {
                    background: var(--picker-active-bg);
                    color: var(--picker-active-color);
                }

                .node-option.selected .node-id {
                    background: color-mix(
                        in oklch,
                        var(--picker-active-color) 12%,
                        var(--picker-panel-bg) 88%
                    );
                    color: var(--picker-active-color);
                }

                .node-id {
                    background: var(--picker-muted-bg);
                    font-size: 10px;
                    padding: 2px 5px;
                    border-radius: 4px;
                    color: var(--picker-secondary-text);
                    margin-left: auto;
                    flex-shrink: 0;
                }

                .picker-empty {
                    padding: 16px 12px;
                    font-size: 12px;
                    color: var(--picker-secondary-text);
                    text-align: center;
                }
            </style>

            <div class="picker-toggle">
                ${toggleContent}
                <span class="toggle-chevron">${this.expanded ? '▴' : '▾'}</span>
            </div>

            <div class="picker-dropdown xdh-scroll">
                <div class="picker-search">
                    <input type="text"
                        placeholder="${searchPlaceholder}"
                        value="${searchQueryValue}" />
                </div>
                <div style="padding: 4px 0;">
                    ${listContent}
                </div>
            </div>
        `;
    }
}

registerCustomElement('xdh-node-picker', XdhNodePicker);
