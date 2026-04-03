import {
    BaseElement,
    registerCustomElement,
} from "../core/base-element.js?v=20260403-2";
import { appStore as store } from "../core/store.js";
import { icon, ICON_CSS, TOOLTIP_CSS } from "../core/icon.js";
import { t } from "../core/i18n.js?v=20260403-9";

export class XdhPagination extends BaseElement {
    _clampPage(page, total) {
        const safeTotal = Math.max(1, Number(total) || 1);
        const numericPage = Number.parseInt(page, 10);
        if (!Number.isFinite(numericPage)) {
            return null;
        }
        return Math.min(safeTotal, Math.max(1, numericPage));
    }

    _commitInputPage() {
        const input = this.$(".page-input");
        const total = store.state.totalPages || 1;
        const cur = store.state.currentPage || 1;
        if (!input) {
            return;
        }
        const nextPage = this._clampPage(input.value, total);
        if (nextPage === null) {
            input.value = String(cur);
            return;
        }
        input.value = String(nextPage);
        if (nextPage === cur) {
            return;
        }
        store.state.currentPage = nextPage;
        this._resetMainScroll();
    }

    _resetMainScroll() {
        const mainScroll = this.parentElement?.querySelector(".main-scroll");
        if (mainScroll) {
            mainScroll.scrollTop = 0;
        }
    }

    onStoreUpdate(state, key) {
        if (key === "currentPage" || key === "totalPages") {
            this._sync();
        } else if (key === "locale") {
            this.renderRoot();
        }
    }

    _sync() {
        const cur   = store.state.currentPage  || 1;
        const total = store.state.totalPages   || 1;
        const prev  = this.$(".btn-prev");
        const next  = this.$(".btn-next");
        const input = this.$(".page-input");
        const totalEl = this.$(".page-total");
        if (!prev) return;
        prev.disabled  = cur <= 1;
        next.disabled  = cur >= total;
        if (totalEl) totalEl.textContent = String(total);
        if (input && this.shadowRoot?.activeElement !== input) {
            input.value = String(cur);
        }
        if (input) {
            input.max = String(total);
            input.setAttribute("aria-label", t("page.input_aria"));
        }
    }

    bindEvents() {
        this.$(".btn-prev")?.addEventListener("click", () => {
            const cur = store.state.currentPage || 1;
            if (cur > 1) {
                store.state.currentPage = cur - 1;
                this._resetMainScroll();
            }
        });
        this.$(".btn-next")?.addEventListener("click", () => {
            const cur   = store.state.currentPage  || 1;
            const total = store.state.totalPages || 1;
            if (cur < total) {
                store.state.currentPage = cur + 1;
                this._resetMainScroll();
            }
        });
        this.$(".page-input")?.addEventListener("focus", (event) => {
            event.target.select();
        });
        this.$(".page-input")?.addEventListener("blur", () => {
            this._commitInputPage();
        });
        this.$(".page-input")?.addEventListener("keydown", (event) => {
            if (event.key === "Enter") {
                event.preventDefault();
                this._commitInputPage();
                event.target.blur();
                return;
            }
            if (event.key === "Escape") {
                event.preventDefault();
                event.target.value = String(store.state.currentPage || 1);
                event.target.blur();
            }
        });
    }

    render() {
        const cur   = store.state.currentPage || 1;
        const total = store.state.totalPages  || 1;
        return `
            <style>
                ${ICON_CSS}
                :host {
                    display: block;
                    flex-shrink: 0;
                    container-type: inline-size;
                    container-name: pg;
                }

                .bar {
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    gap: 10px;
                    min-height: 44px;
                    padding: 0 12px;
                    background: var(--xdh-color-surface-1, #1a1a1a);
                    border-top: 1px solid var(--xdh-color-border, #2e2e2e);
                }

                .page-btn {
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    flex: 0 0 40px;
                    width: 40px;
                    height: 40px;
                    padding: 0;
                    background: var(--xdh-color-surface-2, #3a3a3a);
                    border: 1px solid var(--xdh-color-border, #2e2e2e);
                    border-radius: 6px;
                    color: var(--xdh-color-text-secondary, #888);
                    cursor: pointer;
                    transition:
                        background 0.14s ease,
                        border-color 0.14s ease,
                        color 0.14s ease,
                        transform 0.16s ease;
                }
                .page-btn:hover:not(:disabled) {
                    background: var(--xdh-color-surface-hover, #444444);
                    border-color: var(--border-hover, var(--xdh-color-primary));
                    color: var(--xdh-color-text-primary, #eee);
                    transform: translateY(-1px);
                }
                .page-btn:focus-visible,
                .page-jump:focus-within {
                    outline: none;
                    border-color: var(--border-hover, var(--xdh-color-primary));
                    box-shadow: 0 0 0 1px var(--border-hover, var(--xdh-color-primary));
                }
                .page-btn:disabled {
                    opacity: 0.3;
                    cursor: not-allowed;
                    transform: none;
                }
                .page-jump {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    min-width: 0;
                    padding: 0 10px;
                    min-height: 40px;
                    border: 1px solid var(--xdh-color-border, #2e2e2e);
                    border-radius: 8px;
                    background: var(--xdh-color-surface-2, #3a3a3a);
                    transition: border-color 0.14s ease, box-shadow 0.14s ease;
                }

                .page-label {
                    font-size: 12px;
                    color: var(--xdh-color-text-secondary, #888);
                    white-space: nowrap;
                }

                .page-input-row {
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    gap: 6px;
                }

                .page-input {
                    width: 48px;
                    min-width: 48px;
                    padding: 0;
                    border: none;
                    background: transparent;
                    color: var(--xdh-color-text-primary, #eee);
                    font: inherit;
                    font-size: 13px;
                    font-weight: 600;
                    text-align: center;
                    appearance: textfield;
                    outline: none;
                }
                .page-input::-webkit-outer-spin-button,
                .page-input::-webkit-inner-spin-button {
                    margin: 0;
                    appearance: none;
                }

                .page-divider,
                .page-total {
                    font-size: 12px;
                    color: var(--xdh-color-text-secondary, #888);
                    white-space: nowrap;
                }
                .page-total {
                    min-width: 20px;
                    color: var(--xdh-color-text-primary, #eee);
                    text-align: left;
                }

                @container pg (max-width: 420px) {
                    .bar {
                        gap: 8px;
                        padding: 0 10px;
                    }

                    .page-jump {
                        padding: 0 8px;
                    }

                    .page-label {
                        display: none;
                    }
                }

                @container pg (max-width: 280px) {
                    .bar {
                        gap: 6px;
                        padding: 0 8px;
                    }

                    .page-btn {
                        flex-basis: 36px;
                        width: 36px;
                        height: 36px;
                    }

                    .page-jump {
                        gap: 6px;
                        min-height: 36px;
                        padding: 0 7px;
                    }

                    .page-input {
                        width: 42px;
                        min-width: 42px;
                    }
                }
                ${TOOLTIP_CSS}
            </style>
            <div class="bar">
                <button class="page-btn btn-prev xdh-tooltip xdh-tooltip-up" data-tooltip="${t('page.prev')}" ${cur <= 1 ? "disabled" : ""}>
                    ${icon("arrow-left", 14)}
                </button>
                <div class="page-jump">
                    <span class="page-label">${t('page.jump')}</span>
                    <div class="page-input-row">
                        <input
                            class="page-input"
                            type="number"
                            inputmode="numeric"
                            min="1"
                            max="${total}"
                            step="1"
                            value="${cur}"
                            aria-label="${t('page.input_aria')}"
                        >
                        <span class="page-divider" aria-hidden="true">/</span>
                        <span class="page-total">${total}</span>
                    </div>
                </div>
                <button class="page-btn btn-next xdh-tooltip xdh-tooltip-up" data-tooltip="${t('page.next')}" ${cur >= total ? "disabled" : ""}>
                    ${icon("arrow-right", 14)}
                </button>
            </div>
        `;
    }
}

registerCustomElement("xdh-pagination", XdhPagination);
