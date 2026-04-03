import {
    BaseElement,
    registerCustomElement,
} from "../core/base-element.js?v=20260403-2";
import { banner } from "../core/banner.js";
import { icon, ICON_CSS, TOOLTIP_CSS } from "../core/icon.js";
import { t } from "../core/i18n.js?v=20260404-1";

function escapeHtml(v) {
    return String(v || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

const TYPE_CONFIG = {
    success: {
        iconName: "check",
        color: "#4ade80",
        bg: "rgba(74,222,128,0.10)",
        border: "rgba(74,222,128,0.25)",
    },
    error: {
        iconName: "x",
        color: "#f87171",
        bg: "rgba(248,113,113,0.10)",
        border: "rgba(248,113,113,0.25)",
    },
    info: {
        iconName: "info",
        color: "#60a5fa",
        bg: "rgba(96,165,250,0.10)",
        border: "rgba(96,165,250,0.25)",
    },
    warn: {
        iconName: "triangle-alert",
        color: "#fbbf24",
        bg: "rgba(251,191,36,0.10)",
        border: "rgba(251,191,36,0.25)",
    },
};

export class XdhBanner extends BaseElement {
    constructor() {
        super();
        this._queue = [];
        this._current = null;
        this._timer = null;
        this._visible = false;
        this._onBanner = this._onBanner.bind(this);
    }

    connectedCallback() {
        // Host is a zero-size shell; the toast is fixed-positioned inside
        this.style.display = "contents";
        super.connectedCallback();
        this.renderRoot();
        banner._subscribe(this._onBanner);
    }

    disconnectedCallback() {
        banner._unsubscribe(this._onBanner);
        clearTimeout(this._timer);
        if (this._storeUnsubscribe) {
            this._storeUnsubscribe();
            this._storeUnsubscribe = null;
        }
    }

    _onBanner(entry) {
        this._queue.push(entry);
        if (!this._visible) {
            this._showNext();
        }
    }

    _showNext() {
        clearTimeout(this._timer);
        if (!this._queue.length) {
            this._visible = false;
            this._current = null;
            this.renderRoot();
            return;
        }
        this._current = this._queue.shift();
        this._visible = true;
        this.renderRoot();
        if (!this._current.persist) {
            this._timer = setTimeout(
                () => this._dismiss(),
                this._current.duration ?? 2500
            );
        }
    }

    _dismiss() {
        clearTimeout(this._timer);
        const el = this.shadowRoot?.querySelector(".toast");
        if (el) {
            el.classList.add("leaving");
        }
        setTimeout(() => {
            this._visible = false;
            this._showNext();
        }, 220);
    }

    bindEvents() {
        this.shadowRoot?.querySelector(".btn-close")
            ?.addEventListener("click", () => this._dismiss());

        const actionBtn = this.shadowRoot?.querySelector(".btn-action");
        if (actionBtn && this._current?.action?.onClick) {
            actionBtn.addEventListener("click", () => {
                this._current?.action?.onClick?.();
                this._dismiss();
            });
        }

        // 鼠标悬停时暂停自动消失
        const toast = this.shadowRoot?.querySelector(".toast");
        if (toast && !this._current?.persist) {
            toast.addEventListener("mouseenter", () => {
                clearTimeout(this._timer);
            });
            toast.addEventListener("mouseleave", () => {
                this._timer = setTimeout(
                    () => this._dismiss(),
                    1200
                );
            });
        }
    }

    render() {
        if (!this._visible || !this._current) {
            return ``;
        }
        const cfg = TYPE_CONFIG[this._current.type] || TYPE_CONFIG.info;
        const actionHTML = this._current.action
            ? `<button class="btn-action">${escapeHtml(
                  this._current.action.label
              )}</button>`
            : "";

        return `
            <style>
                ${ICON_CSS}
                :host {
                    /* zero-size shell, toast is fixed */
                    display: contents;
                }
                .toast {
                    position: fixed;
                    top: 16px;
                    left: 50%;
                    transform: translateX(-50%) translateY(0);
                    width: min(480px, calc(100vw - 48px));
                    display: flex;
                    align-items: center;
                    gap: 10px;
                    padding: 0 12px 0 14px;
                    height: 44px;
                    background: color-mix(
                        in srgb,
                        ${cfg.bg} 80%,
                        var(--xdh-color-surface-1, #2a2a2a) 20%
                    );
                    border: 1px solid ${cfg.border};
                    border-radius: 10px;
                    font-size: 13px;
                    color: var(--xdh-color-text-primary, #f0f0f0);
                    backdrop-filter: blur(12px) saturate(1.4);
                    -webkit-backdrop-filter: blur(12px) saturate(1.4);
                    box-shadow: 0 4px 24px rgba(0,0,0,0.45),
                                0 1px 4px rgba(0,0,0,0.3);
                    z-index: 900;
                    white-space: nowrap;
                    animation: toast-in 0.22s cubic-bezier(0.34,1.56,0.64,1)
                               both;
                }
                .toast.leaving {
                    animation: toast-out 0.18s ease-in forwards;
                }
                @keyframes toast-in {
                    from {
                        opacity: 0;
                        transform: translateX(-50%) translateY(-120%);
                    }
                    to {
                        opacity: 1;
                        transform: translateX(-50%) translateY(0);
                    }
                }
                @keyframes toast-out {
                    from {
                        opacity: 1;
                        transform: translateX(-50%) translateY(0);
                    }
                    to {
                        opacity: 0;
                        transform: translateX(-50%) translateY(-120%);
                    }
                }
                .toast-icon {
                    color: ${cfg.color};
                    flex-shrink: 0;
                    display: flex;
                    align-items: center;
                }
                .toast-accent {
                    width: 3px;
                    height: 22px;
                    border-radius: 2px;
                    background: ${cfg.color};
                    flex-shrink: 0;
                }
                .message {
                    flex: 1;
                    min-width: 0;
                    overflow: hidden;
                    text-overflow: ellipsis;
                }
                .btn-action {
                    background: transparent;
                    border: 1px solid ${cfg.color};
                    color: ${cfg.color};
                    padding: 3px 10px;
                    border-radius: 4px;
                    font-size: 12px;
                    cursor: pointer;
                    flex-shrink: 0;
                    transition: background 0.15s;
                }
                .btn-action:hover {
                    background: ${cfg.bg};
                }
                .btn-close {
                    background: transparent;
                    border: none;
                    color: var(--xdh-color-text-secondary, #777);
                    cursor: pointer;
                    flex-shrink: 0;
                    display: flex;
                    align-items: center;
                    padding: 4px;
                    border-radius: 4px;
                    transition: color 0.15s;
                }
                .btn-close:hover {
                    color: var(--xdh-color-text-primary, #fff);
                }
                ${TOOLTIP_CSS}
            </style>
            <div class="toast">
                <span class="toast-accent"></span>
                <span class="toast-icon">${icon(cfg.iconName, 15)}</span>
                <span class="message">${escapeHtml(
                    this._current.message
                )}</span>
                ${actionHTML}
                <button class="btn-close xdh-tooltip xdh-tooltip-down" data-tooltip="${t('banner.close')}">
                    ${icon("x", 13)}
                </button>
            </div>
        `;
    }
}

registerCustomElement("xdh-banner", XdhBanner);
