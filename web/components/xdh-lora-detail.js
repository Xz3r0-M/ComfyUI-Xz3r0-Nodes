import {
    BaseElement,
    registerCustomElement,
} from "../core/base-element.js?v=20260403-2";
import { icon, ICON_CSS, SCROLLBAR_CSS, TOOLTIP_CSS } from "../core/icon.js";
import { apiGet, apiPost } from "../core/api.js?v=20260403-412";
import { appStore } from "../core/store.js";
import { banner } from "../core/banner.js";
import { t } from "../core/i18n.js?v=20260406-15";

function escapeHtml(value) {
    return String(value || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function escapeAttr(value) {
    return escapeHtml(value);
}

export class XdhLoraDetail extends BaseElement {
    constructor() {
        super();
        this._currentRef = null;
        this._currentData = null;
        this._isLoading = false;
        this._isLinked = false;
        this._imgLoaded = false;

        this._onOpenDetail = (e) => this._open(e.detail);
        this._onKeydown = (e) => {
            if (e.key === "Escape") this._close();
        };
    }

    connectedCallback() {
        super.connectedCallback();
        document.addEventListener("xdh:lora-detail", this._onOpenDetail);
        document.addEventListener("keydown", this._onKeydown);
    }

    disconnectedCallback() {
        super.disconnectedCallback();
        document.removeEventListener("xdh:lora-detail", this._onOpenDetail);
        document.removeEventListener("keydown", this._onKeydown);
        appStore.state.loraDetailOpen = false;
    }

    async _open(detail) {
        if (!detail || !detail.ref) return;
        this._currentRef = detail.ref;
        appStore.state.loraDetailOpen = true;
        this._isLoading = true;
        this._currentData = null;
        this._imgLoaded = false;
        this.renderRoot();

        this.$(".drawer-wrap")?.classList.add("open");

        try {
            const res = await apiGet(
                "/xz3r0/xdatahub/loras/trigger-words",
                { ref: this._currentRef }
            );
            if (res && res.status === "success" && res.item) {
                this._currentData = res.item;
                const sm = this._currentData.strength_model ?? 1.0;
                const sc = this._currentData.strength_clip ?? 1.0;
                this._isLinked = (sm === sc);
            }
        } catch (e) {
            console.error("Failed to load Lora detail:", e);
            banner.error(t("lora.banner.load_fail"));
        } finally {
            this._isLoading = false;
            this.renderRoot();
            this.$(".drawer-wrap")?.classList.add("open");
        }
    }

    _close() {
        this.$(".drawer-wrap")?.classList.remove("open");
        appStore.state.loraDetailOpen = false;
        this._currentRef = null;
        this._currentData = null;
    }

    async _save() {
        if (!this._currentRef || !this._currentData) return;

        const noteEl = this.$("#lora-note");
        const strengthModelEl = this.$("#lora-strength-model");
        const strengthClipEl = this.$("#lora-strength-clip");
        const triggerWordsEl = this.$("#lora-trigger-words");
        const saveBtn = this.$(".save-btn");
        const modelStrength = Number.parseFloat(
            strengthModelEl ? strengthModelEl.value : "1"
        );
        const clipStrength = Number.parseFloat(
            strengthClipEl ? strengthClipEl.value : "1"
        );

        const triggerWordsRaw = (triggerWordsEl ? triggerWordsEl.value : "")
            .split(/\r?\n/)
            .map(s => s.trim())
            .filter(s => s !== "");

        const payload = {
            ref: this._currentRef,
            title: this._currentData.title,
            sha256: this._currentData.sha256,
            mtime: this._currentData.mtime,
            lora_note: noteEl ? noteEl.value : "",
            strength_model: Number.isFinite(modelStrength) ? modelStrength : 1.0,
            strength_clip: Number.isFinite(clipStrength) ? clipStrength : 1.0,
            trigger_words: triggerWordsRaw.map(text => ({ text }))
        };

        try {
            if (saveBtn) saveBtn.classList.add("loading");

            const res = await apiPost("/xz3r0/xdatahub/loras/trigger-words", payload);
            if (res && res.status === "success") {
                banner.success(t("lora.banner.save_ok"));
                this._close();
                // trigger refresh to update grid if needed
                appStore.state.refreshTrigger = Date.now();
            }
        } catch (e) {
            console.error("Failed to save Lora detail:", e);
            banner.error(t("lora.banner.save_fail"));
        } finally {
            if (saveBtn) saveBtn.classList.remove("loading");
        }
    }

    async _importMetadata() {
        if (!this._currentRef) return;
        const btn = this.$(".import-meta-btn");
        if (btn) btn.classList.add("loading");
        try {
            const res = await apiGet("/xz3r0/xdatahub/loras/trigger-words/from-metadata", { ref: this._currentRef });
            if (res && res.status === "success" && res.trigger_words) {
                const twWords = res.trigger_words
                    .map(w => (w.text || w).trim()).filter(Boolean).join("\n");
                const twIn = this.$("#lora-trigger-words");
                if (twIn && twWords) {
                    if (twIn.value.trim().length > 0) {
                        twIn.value = twIn.value.trimEnd() + "\n" + twWords;
                    } else {
                        twIn.value = twWords;
                    }
                    banner.success(t("lora.banner.import_ok"));
                } else {
                    banner.info(t("lora.banner.import_empty"));
                }
            }
        } catch (e) {
            console.error("Failed to import metadata:", e);
            banner.error(t("lora.banner.import_fail"));
        } finally {
            if (btn) btn.classList.remove("loading");
        }
    }

    _toggleLink() {
        this._isLinked = !this._isLinked;
        const btn = this.$(".link-btn");
        const clipIn = this.$("#lora-strength-clip");
        const modelIn = this.$("#lora-strength-model");

        if (btn) {
            if (this._isLinked) {
                btn.classList.add("linked");
                btn.innerHTML = icon("link-2", 14);
                btn.setAttribute("data-tooltip", t("lora.btn.unlink"));
            } else {
                btn.classList.remove("linked");
                btn.innerHTML = icon("unlink-2", 14);
                btn.setAttribute("data-tooltip", t("lora.btn.link"));
            }
        }

        if (this._isLinked && modelIn && clipIn) {
            clipIn.value = modelIn.value;
            clipIn.disabled = true;
        } else if (clipIn) {
            clipIn.disabled = false;
        }
    }

    bindEvents() {
        this.$(".backdrop")?.addEventListener("click", () => this._close());
        this.$(".lb-close")?.addEventListener("click", () => this._close());
        this.$(".cancel-btn")?.addEventListener("click", () => this._close());
        this.$(".save-btn")?.addEventListener("click", () => this._save());

        this.$(".link-btn")?.addEventListener("click", () => this._toggleLink());
        this.$("#lora-strength-model")?.addEventListener("input", (e) => {
            if (this._isLinked) {
                const clipIn = this.$("#lora-strength-clip");
                if (clipIn) clipIn.value = e.target.value;
            }
        });
        this.$(".import-meta-btn")?.addEventListener("click", () => this._importMetadata());
    }

    render() {
        if (!this._currentRef) {
            return `<style>${ICON_CSS} ${TOOLTIP_CSS} :host { display: contents; }</style>
                    <div class="drawer-wrap"></div>`;
        }

        const data = this._currentData;
        const isLoading = this._isLoading || !data;
        const title = data ? data.title : t("lora.title_default");

        let drawerBody;
        if (isLoading) {
            drawerBody = `<div class="loading-state">
                ${icon("refresh-cw", 18)} ${t('lora.loading')}
            </div>`;
        } else {
            const twWords = (data.trigger_words || [])
                .map(w => (w.text || w).trim()).filter(Boolean).join("\n");
            const note = data.lora_note || "";
            const sM = data.strength_model ?? 1.0;
            const sC = data.strength_clip ?? 1.0;
            const thumbUrl = "/xz3r0/xdatahub/loras/thumb?ref="
                + encodeURIComponent(data.media_ref);
            const safeNote = escapeHtml(note);
            const safeThumbUrl = escapeAttr(thumbUrl);
            const safeTriggerWords = escapeHtml(twWords);
            const safeStrengthModel = escapeAttr(String(sM));
            const safeStrengthClip = escapeAttr(String(sC));

            drawerBody = `
                <div class="preview-area">
                    <span class="preview-empty">${icon("image", 36)}</span>
                    <img class="preview-blur" src="${safeThumbUrl}"
                        alt="" aria-hidden="true"
                        onerror="this.style.display='none'"/>
                    <img class="preview-img" src="${safeThumbUrl}"
                        alt="Preview"
                        onerror="this.style.display='none'"/>
                </div>
                <div class="form-scroll xdh-scroll">
                    <div class="strength-row">
                        <div class="field-group">
                            <label>${t('lora.label.model_strength')}</label>
                            <input type="number"
                                id="lora-strength-model"
                                step="0.05"
                                value="${safeStrengthModel}"/>
                        </div>
                        <button
                            class="link-btn xdh-tooltip xdh-tooltip-down ${this._isLinked ? "linked" : ""}"
                            data-tooltip="${this._isLinked ? t('lora.btn.unlink') : t('lora.btn.link')}">
                            ${icon(this._isLinked ? "link-2" : "unlink-2", 14)}
                        </button>
                        <div class="field-group">
                            <label>${t('lora.label.clip_strength')}</label>
                            <input type="number"
                                id="lora-strength-clip"
                                step="0.05"
                                value="${safeStrengthClip}"
                                ${this._isLinked ? "disabled" : ""}/>
                        </div>
                    </div>

                    <div class="field-group">
                        <label>${t('lora.label.note')}</label>
                        <textarea id="lora-note" class="note-ta"
                            placeholder="${t('lora.placeholder.note')}"
                        >${safeNote}</textarea>
                    </div>

                    <div class="field-group">
                        <div class="tw-label-row">
                            <label>${t('lora.label.trigger_words')}</label>
                            <button class="import-meta-btn xdh-tooltip xdh-tooltip-down"
                                data-tooltip="${t('lora.btn.import_meta_title')}">
                                ${icon("database", 12)} ${t('lora.btn.import_meta')}
                            </button>
                        </div>
                        <textarea id="lora-trigger-words" class="tw-ta"
                            placeholder="${t('lora.placeholder.tw')}"
                        >${safeTriggerWords}</textarea>
                    </div>
                </div>
                <div class="footer-bar">
                    <button class="cancel-btn">${t('common.cancel')}</button>
                    <button class="save-btn">
                        ${icon("save", 14)} ${t('common.save')}
                    </button>
                </div>
            `;
        }

        return `
            <style>
                ${ICON_CSS}
                ${TOOLTIP_CSS}
                :host { display: contents; }

                /* ── Wrapper ─────────────────────────── */
                .drawer-wrap {
                    position: fixed;
                    inset: 0;
                    z-index: 600;
                    pointer-events: none;
                }
                .drawer-wrap.open {
                    pointer-events: auto;
                }

                /* ── Backdrop ────────────────────────── */
                .backdrop {
                    position: absolute;
                    inset: 0;
                    background: rgba(0,0,0,0);
                    transition: background 0.28s ease;
                }
                .drawer-wrap.open .backdrop {
                    background: rgba(0,0,0,0.28);
                }

                /* ── Drawer panel ────────────────────── */
                .drawer {
                    position: absolute;
                    right: 0;
                    top: 0;
                    bottom: 0;
                    width: 360px;
                    max-width: 100vw;
                    display: flex;
                    flex-direction: column;
                    background: var(--xdh-color-surface-1, #333);
                    border-left: 1px solid var(--xdh-color-border, #2e2e2e);
                    box-shadow: none;
                    transform: translateX(100%);
                    transition: transform 0.28s cubic-bezier(0.4, 0, 0.2, 1);
                }
                .drawer-wrap.open .drawer {
                    transform: translateX(0);
                    box-shadow: -6px 0 28px rgba(0,0,0,0.55);
                }

                /* ── Header ─────────────────────────── */
                .header {
                    flex-shrink: 0;
                    height: 44px;
                    padding: 0 8px 0 14px;
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    border-bottom: 1px solid var(--xdh-color-border, #2e2e2e);
                    background: var(--xdh-window-header-bg, #171718);
                }
                .title-wrap {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    color: var(--xdh-color-text-primary, #ddd);
                    font-size: 13px;
                    font-weight: 600;
                    min-width: 0;
                }
                .title-text {
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                }
                .lb-close {
                    flex-shrink: 0;
                    width: 28px;
                    height: 28px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    background: transparent;
                    border: none;
                    border-radius: 5px;
                    color: var(--xdh-color-text-secondary, #aaa);
                    cursor: pointer;
                }
                .lb-close:hover {
                    background: rgba(255,255,255,0.08);
                    color: var(--xdh-color-text-primary, #ddd);
                }

                /* ── Preview area ────────────────────── */
                .preview-area {
                    flex-shrink: 0;
                    height: 200px;
                    background: #0e0e0e;
                    border-bottom: 1px solid var(--xdh-color-border, #2e2e2e);
                    position: relative;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    overflow: hidden;
                }
                .preview-empty {
                    color: var(--xdh-color-text-secondary, #aaa);
                    opacity: 0.2;
                    position: relative;
                    z-index: 1;
                }
                .preview-blur {
                    position: absolute;
                    inset: -10px;
                    width: calc(100% + 20px);
                    height: calc(100% + 20px);
                    object-fit: cover;
                    filter: blur(16px) brightness(0.45);
                    z-index: 2;
                }
                .preview-img {
                    position: absolute;
                    inset: 0;
                    width: 100%;
                    height: 100%;
                    object-fit: contain;
                    z-index: 3;
                }

                ${SCROLLBAR_CSS}

                /* ── Form scroll ─────────────────────── */
                .form-scroll {
                    flex: 1;
                    overflow-y: auto;
                    padding: 14px 16px;
                    display: flex;
                    flex-direction: column;
                    gap: 14px;
                }

                /* ── Strength row ────────────────────── */
                .strength-row {
                    display: flex;
                    align-items: flex-end;
                    gap: 6px;
                }
                .strength-row .field-group { flex: 1; min-width: 0; }

                /* ── Field group ─────────────────────── */
                .field-group {
                    display: flex;
                    flex-direction: column;
                    gap: 5px;
                }
                label {
                    font-size: 10px;
                    font-weight: 600;
                    color: var(--xdh-color-text-secondary, #666);
                    text-transform: uppercase;
                    letter-spacing: 0.06em;
                }
                input[type="number"], textarea {
                    background: var(--xdh-input-bg, #222);
                    border: 1px solid var(--border-standard, #555);
                    border-radius: 6px;
                    color: var(--xdh-color-text-primary, #ddd);
                    font-family: inherit;
                    font-size: 13px;
                    padding: 7px 10px;
                    width: 100%;
                    box-sizing: border-box;
                    transition: border-color 0.12s;
                }
                input[type="number"]:focus, textarea:focus {
                    outline: none;
                    border-color: var(--xdh-brand-pink, #EA005E);
                }
                input[type="number"]:disabled {
                    opacity: 0.35;
                    cursor: not-allowed;
                }
                textarea { resize: vertical; }
                .note-ta { min-height: 68px; }
                .tw-ta   { min-height: 100px; }

                /* ── Link button ─────────────────────── */
                .link-btn {
                    flex-shrink: 0;
                    width: 32px;
                    height: 32px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    background: transparent;
                    border: 1px solid var(--border-standard, #555);
                    border-radius: 6px;
                    color: var(--xdh-color-text-secondary, #666);
                    cursor: pointer;
                    margin-bottom: 1px;
                }
                .link-btn:hover {
                    border-color: var(--border-hover, #EA005E);
                    color: var(--xdh-color-text-primary, #ddd);
                }
                .link-btn.linked {
                    color: var(--xdh-brand-pink, #EA005E);
                    border-color: var(--xdh-brand-pink, #EA005E);
                }

                /* ── Trigger words ───────────────────── */
                .tw-label-row {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    gap: 8px;
                    flex-wrap: nowrap;
                }
                .tw-label-row label {
                    flex-shrink: 0;
                    white-space: nowrap;
                }
                .import-meta-btn {
                    flex-shrink: 0;
                    display: inline-flex;
                    align-items: center;
                    gap: 4px;
                    padding: 3px 8px;
                    background: transparent;
                    border: 1px solid var(--border-standard, #555);
                    border-radius: 5px;
                    color: var(--xdh-color-text-secondary, #666);
                    font-size: 10px;
                    letter-spacing: 0.03em;
                    cursor: pointer;
                    white-space: nowrap;
                    font-family: inherit;
                }
                .import-meta-btn:hover {
                    border-color: var(--border-hover, #EA005E);
                    color: var(--xdh-color-text-primary, #ddd);
                }
                .import-meta-btn.loading {
                    opacity: 0.4;
                    pointer-events: none;
                }

                /* ── Footer bar ──────────────────────── */
                .footer-bar {
                    flex-shrink: 0;
                    height: 52px;
                    padding: 0 14px;
                    display: flex;
                    align-items: center;
                    justify-content: flex-end;
                    gap: 8px;
                    border-top: 1px solid var(--xdh-color-border, #2e2e2e);
                    background: var(--xdh-window-header-bg, #171718);
                }
                button {
                    display: inline-flex;
                    align-items: center;
                    gap: 6px;
                    padding: 7px 14px;
                    border-radius: 6px;
                    font-size: 13px;
                    font-weight: 500;
                    cursor: pointer;
                    font-family: inherit;
                }
                .cancel-btn {
                    background: transparent;
                    border: 1px solid var(--border-standard, #555);
                    color: var(--xdh-color-text-secondary, #aaa);
                }
                .cancel-btn:hover {
                    border-color: var(--border-hover, #EA005E);
                    color: var(--xdh-color-text-primary, #ddd);
                }
                .save-btn {
                    background: var(--xdh-brand-pink, #EA005E);
                    border: none;
                    color: #fff;
                }
                .save-btn:hover { filter: brightness(1.12); }
                .save-btn.loading { opacity: 0.55; pointer-events: none; }

                /* ── Loading state ───────────────────── */
                .loading-state {
                    flex: 1;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    gap: 10px;
                    color: var(--xdh-color-text-secondary, #666);
                    font-size: 13px;
                }
            </style>

            <div class="drawer-wrap">
                <div class="backdrop"></div>
                <div class="drawer">
                    <div class="header">
                        <div class="title-wrap">
                            ${icon("wand-sparkles", 14)}
                            <span class="title-text">${escapeHtml(title)}</span>
                        </div>
                        <button class="lb-close">${icon("x", 16)}</button>
                    </div>
                    ${drawerBody}
                </div>
            </div>
        `;
    }
}
registerCustomElement("xdh-lora-detail", XdhLoraDetail);

