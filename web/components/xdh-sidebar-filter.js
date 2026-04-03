import { BaseElement } from "../core/base-element.js";
import { appStore as store } from "../core/store.js";
import { icon, ICON_CSS, TOOLTIP_CSS } from "../core/icon.js";
import { t } from "../core/i18n.js?v=20260403-8";

// Categories definition — single source of truth
const MEDIA_CATEGORIES = [
    { kind: "image",  iconName: "image" },
    { kind: "video",  iconName: "video" },
    { kind: "audio",  iconName: "audio-lines" },
    { kind: "lora",   iconName: "puzzle" },
];

const RECORD_CATEGORIES = [
    { kind: "history",   iconName: "history" },
    { kind: "favorites", iconName: "bookmark" },
];

export class XdhSidebarFilter extends BaseElement {
    constructor() {
        super();
        this.activeKind = store.state.activeCategory || "image";
    }

    onStoreUpdate(state, key) {
        if (key === "activeCategory") {
            this.activeKind = state.activeCategory;
            // Only update active class, no full re-render needed
            this.$$(".filter-item").forEach(el => {
                el.classList.toggle("active", el.dataset.kind === this.activeKind);
            });
        } else if (key === "locale") {
            this.renderRoot();
        }
    }

    bindEvents() {
        this.$$(".filter-item").forEach(item => {
            item.addEventListener("click", () => {
                const kind = item.dataset.kind;
                if (!kind) return;
                document.dispatchEvent(
                    new CustomEvent("xdh:reset-main-scroll")
                );
                this.activeKind = kind;
                this.$$(".filter-item").forEach(
                    el => el.classList.toggle("active", el.dataset.kind === kind)
                );
                store.state.activeFolder = "";
                store.state.activeFolderLabel = "";
                store.state.currentPage = 1;
                store.state.searchQuery = "";
                store.state.activeCategory = kind;
            });
        });
    }

    render() {
        const renderItems = (items) => items.map(c => {
            const label = t(`nav.cat.${c.kind}`);
            return `
            <div class="filter-item xdh-tooltip ${c.kind === this.activeKind ? "active" : ""}"
                 data-kind="${c.kind}"
                 data-tooltip="${label}">
                ${icon(c.iconName, 18)}
            </div>`;
        }).join("");

        const mediaHTML = renderItems(MEDIA_CATEGORIES);
        const recordHTML = renderItems(RECORD_CATEGORIES);

        return `
            <style>
                ${ICON_CSS}
                :host {
                    display: block;
                    width: 48px;
                    flex-shrink: 0;
                    height: 100%;
                    position: relative;
                    z-index: 50;
                    overflow: visible;
                }

                .panel {
                    width: 48px;
                    height: 100%;
                    background: var(--xdh-color-surface-1, #1a1a1a);
                    border-right: 1px solid var(--xdh-color-border, #2e2e2e);
                    display: flex;
                    flex-direction: column;
                    box-sizing: border-box;
                    overflow: visible;
                }

                .section {
                    padding: 0;
                    flex-shrink: 0;
                }

                .section:not(:last-child)::after {
                    content: "";
                    display: block;
                    height: 1px;
                    background: var(--xdh-color-border, #2e2e2e);
                    margin: 2px 6px;
                }

                .filter-item {
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    width: 36px;
                    height: 36px;
                    margin: 2px 6px;
                    box-sizing: border-box;
                    cursor: pointer;
                    border-radius: 8px;
                    transition: background 0.15s ease;
                    color: var(--xdh-color-text-primary, #ccc);
                    position: relative;
                }

                .filter-item:hover {
                    background: var(--xdh-color-surface-2, #252525);
                }

                /* Active: only the left accent bar */
                .filter-item.active::before {
                    content: "";
                    position: absolute;
                    left: -6px;
                    top: 6px;
                    bottom: 6px;
                    width: 3px;
                    border-radius: 3px;
                    background: var(--xdh-color-primary, #0078ff);
                }

                ${TOOLTIP_CSS}
            </style>

            <div class="panel">
                <div class="section">${mediaHTML}</div>
                <div class="section">${recordHTML}</div>
            </div>
        `;
    }
}

customElements.define("xdh-sidebar-filter", XdhSidebarFilter);

