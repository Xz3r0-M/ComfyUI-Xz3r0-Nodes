import { BaseElement } from '../core/base-element.js';
import { appStore } from '../core/store.js';
import { t } from '../core/i18n.js?v=20260403-5';
import { resolveTokenAccentFromNode } from '../core/node-accent.js?v=20260402-400';
import { SCROLLBAR_CSS } from '../core/icon.js';
import {
    requestNodes,
    CATEGORY_NODE_CLASS,
} from '../core/node-bridge.js?v=20260402-398';

export class XdhNodePicker extends BaseElement {
    constructor() {
        super();
        this.expanded = false;
        this.searchQuery = '';
        this.selectedNode = null;
        this.nodes = [];
        this.loading = false;
    }

    static get observedAttributes() {
        return ['target-type'];
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
                this.searchQuery = e.target.value.toLowerCase();
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
            document.addEventListener('click', (e) => {
                if (this.expanded && !this.contains(e.target)) {
                    this.expanded = false;
                    this.renderRoot();
                }
            });
            this.docsListenerAdded = true;
        }
    }

    _fetchNodes() {
        const category = appStore.state.activeCategory || 'image';
        const nodeClass = CATEGORY_NODE_CLASS[category] || 'XImageGet';
        this.loading = true;
        this.renderRoot();
        requestNodes(nodeClass).then((nodes) => {
            this.nodes = nodes;
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
        // Filter nodes based on search query
        const filteredNodes = this.nodes.filter(n => {
            if (!this.searchQuery) return true;
            return String(n.title || '').toLowerCase().includes(this.searchQuery)
                || String(n.id).includes(this.searchQuery);
        });

        const getColor = (node) => resolveTokenAccentFromNode(node);

        const sn = this.selectedNode;
        const toggleContent = sn
            ? `<span class="node-color-dot"
                    style="background:${getColor(sn)};flex-shrink:0">
               </span>
               <span class="toggle-name">${sn.title}</span>
               <span class="toggle-id">#${sn.id}</span>`
            : `<span class="toggle-placeholder">${t('picker.placeholder')}</span>`;

        const listContent = this.loading
            ? `<div class="picker-empty">${t('picker.loading')}</div>`
            : filteredNodes.length === 0
                ? `<div class="picker-empty">${t('picker.empty')}</div>`
                : filteredNodes.map(n => `
                    <div class="node-option${sn && String(sn.id) === String(n.id) ? ' selected' : ''}"
                         data-id="${n.id}">
                        <span class="node-color-dot"
                              style="background:${getColor(n)}">
                        </span>
                        <span>${n.title}</span>
                        <span class="node-id">#${n.id}</span>
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
                        placeholder="${t('picker.search_placeholder')}"
                        value="${this.searchQuery}" />
                </div>
                <div style="padding: 4px 0;">
                    ${listContent}
                </div>
            </div>
        `;
    }
}

customElements.define('xdh-node-picker', XdhNodePicker);
