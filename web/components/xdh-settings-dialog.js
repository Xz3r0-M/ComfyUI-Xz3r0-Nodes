import { BaseElement } from "../core/base-element.js";
import { appStore } from "../core/store.js";
import { icon, ICON_CSS, SCROLLBAR_CSS, TOOLTIP_CSS } from "../core/icon.js";
import { banner } from "../core/banner.js";
import { t } from "../core/i18n.js?v=20260403-7";

async function loadSettings() {
    const res = await fetch("/xz3r0/xdatahub/settings");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const payload = await res.json();
    return payload.settings || {};
}

async function saveSettings(patch) {
    const res = await fetch("/xz3r0/xdatahub/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
    });
    let payload = null;
    try {
        payload = await res.json();
    } catch {
        payload = null;
    }
    if (!res.ok) {
        const error = new Error(payload?.message || `HTTP ${res.status}`);
        error.status = res.status;
        error.payload = payload;
        throw error;
    }
    return payload?.settings || {};
}

function isLoraDbConflictError(error) {
    return error?.status === 409
        && error?.payload?.code === "lora_db_conflict";
}

function escapeHtml(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
}

function syncStoreSettings(settings) {
    appStore.state.xdatahubSettings = {
        ...appStore.state.xdatahubSettings,
        ...(settings || {}),
    };
}

export class XdhSettingsDialog extends BaseElement {
    constructor() {
        super();
        this._open = false;
        this._settings = {};
        this._loraDbConflict = null;
        this._onOpen = () => this._show();
        this._onKeydown = (e) => {
            if (e.key !== "Escape" || !this._open) {
                return;
            }
            if (this._loraDbConflict?.busy) {
                return;
            }
            if (this._loraDbConflict) {
                this._closeLoraDbConflictDialog();
                return;
            }
            this._close();
        };
    }

    connectedCallback() {
        super.connectedCallback();
        document.addEventListener("xdh:open-settings", this._onOpen);
        document.addEventListener("keydown", this._onKeydown);
    }

    disconnectedCallback() {
        super.disconnectedCallback();
        document.removeEventListener("xdh:open-settings", this._onOpen);
        document.removeEventListener("keydown", this._onKeydown);
    }

    async _show() {
        if (this._open) return;
        this._open = true;
        this._loraDbConflict = null;
        this._settings = {
            ...appStore.state.xdatahubSettings,
        };
        this.renderRoot();
        try {
            this._settings = await loadSettings();
            syncStoreSettings(this._settings);
        } catch {
            this._settings = {
                ...appStore.state.xdatahubSettings,
            };
        }
        this.renderRoot();
        this._bindFormEvents();
    }

    _close() {
        this._open = false;
        this._loraDbConflict = null;
        this.renderRoot();
    }

    _getBool(key, fallback = false) {
        const v = this._settings[key];
        return v === undefined ? fallback : !!v;
    }

    _getStr(key, fallback = "") {
        const v = this._settings[key];
        return v === undefined ? fallback : String(v);
    }

    _checked(key, fallback = false) {
        return this._getBool(key, fallback) ? "checked" : "";
    }

    // Local-only settings (localStorage, not backend)
    _getLocalBool(lsKey, fallback = false) {
        const v = localStorage.getItem(lsKey);
        if (v === null) return fallback;
        return v === "true";
    }

    _renderLocalToggle(lsKey, fallback = false) {
        const id = `xdhs-local-${lsKey.replace(/\./g, "-")}`;
        const chk = this._getLocalBool(lsKey, fallback) ? "checked" : "";
        return `<label class="toggle" for="${id}">
            <input id="${id}" type="checkbox" data-lskey="${lsKey}" ${chk}>
            <span class="track"></span>
        </label>`;
    }

    _renderRow(labelKey, inputHtml, tooltipKey = "") {
        const label = tooltipKey
            ? `<span class="row-label"><span class="row-label-text xdh-tooltip xdh-tooltip-down" data-tooltip="${t(tooltipKey)}">${t(labelKey)}</span></span>`
            : `<span class="row-label">${t(labelKey)}</span>`;
        return `<div class="row">
            ${label}
            <span class="row-ctrl">${inputHtml}</span>
        </div>`;
    }

    _renderToggle(key, fallback = false) {
        const id = `xdhs-${key}`;
        const chk = this._checked(key, fallback);
        return `<label class="toggle" for="${id}">
            <input id="${id}" type="checkbox" data-key="${key}" ${chk}>
            <span class="track"></span>
        </label>`;
    }

    _renderSection(titleKey, content) {
        return `<div class="section">
            <div class="sect-title">${t(titleKey)}</div>
            ${Array.isArray(content) ? content.join("") : content}
        </div>`;
    }

    _renderFolderSection() {
        return `<div class="section">
            <div class="sect-title">${t("settings.sect.media_folder")}</div>
            <div class="folder-list xdh-scroll"></div>
            <div class="folder-add-row">
                <input class="folder-input" type="text"
                    placeholder="${t("settings.custom_folder_placeholder")}">
                <button class="folder-add-btn">${t("settings.folder_add")}</button>
            </div>
        </div>`;
    }

    _applyUpdatedSettings(updated, rerender = false) {
        this._settings = {
            ...this._settings,
            ...(updated || {}),
        };
        syncStoreSettings(updated);
        if (rerender) {
            this.renderRoot();
        }
    }

    _openLoraDbConflictDialog(payload) {
        this._loraDbConflict = {
            currentLocation: String(payload?.current_location || ""),
            targetLocation: String(payload?.target_location || ""),
            fileName: String(payload?.file_name || "loras_data.db"),
            busy: false,
        };
        this.renderRoot();
    }

    _closeLoraDbConflictDialog() {
        if (this._loraDbConflict?.busy) {
            return;
        }
        this._loraDbConflict = null;
        this.renderRoot();
    }

    async _resolveLoraDbConflict(action) {
        if (!this._loraDbConflict || this._loraDbConflict.busy) {
            return;
        }
        this._loraDbConflict = {
            ...this._loraDbConflict,
            busy: true,
        };
        this.renderRoot();
        try {
            const updated = await saveSettings({
                store_lora_db_in_loras: true,
                lora_db_conflict_action: action,
            });
            this._loraDbConflict = null;
            this._applyUpdatedSettings(updated, true);
        } catch {
            this._loraDbConflict = null;
            this.renderRoot();
            banner.error(t("settings.lora_db_conflict.apply_failed"));
        }
    }

    _renderLoraDbConflictDialog() {
        if (!this._loraDbConflict) {
            return "";
        }
        const info = this._loraDbConflict;
        const disabled = info.busy ? "disabled" : "";
        const currentLocationKey = info.currentLocation
            ? `settings.lora_db_conflict.location.${info.currentLocation}`
            : "settings.lora_db_conflict.location.unknown";
        const targetLocationKey = info.targetLocation
            ? `settings.lora_db_conflict.location.${info.targetLocation}`
            : "settings.lora_db_conflict.location.unknown";
        return `
            <div class="confirm-overlay">
                <div class="confirm-dialog" role="dialog" aria-modal="true"
                     aria-label="${t("settings.lora_db_conflict.title")}">
                    <div class="confirm-title">
                        ${t("settings.lora_db_conflict.title")}
                    </div>
                    <div class="confirm-message">${t(
                        "settings.lora_db_conflict.message",
                        { fileName: info.fileName }
                    )}</div>
                    <div class="confirm-path-list">
                        <div class="confirm-path-card">
                            <div class="confirm-path-label">
                                ${t("settings.lora_db_conflict.current_path")}
                            </div>
                            <div class="confirm-path-value">${escapeHtml(
                                t(currentLocationKey, {
                                    fileName: info.fileName,
                                })
                            )}</div>
                        </div>
                        <div class="confirm-path-card">
                            <div class="confirm-path-label">
                                ${t("settings.lora_db_conflict.target_path")}
                            </div>
                            <div class="confirm-path-value">${escapeHtml(
                                t(targetLocationKey, {
                                    fileName: info.fileName,
                                })
                            )}</div>
                        </div>
                    </div>
                    <div class="confirm-actions">
                        <button class="confirm-btn" type="button"
                                data-action="cancel" ${disabled}>
                            ${t("common.cancel")}
                        </button>
                        <button class="confirm-btn confirm-btn-primary"
                                type="button" data-action="use-existing"
                                ${disabled}>
                            ${t("settings.lora_db_conflict.use_existing")}
                        </button>
                        <button class="confirm-btn confirm-btn-danger"
                                type="button" data-action="replace"
                                ${disabled}>
                            ${t("settings.lora_db_conflict.replace")}
                        </button>
                    </div>
                </div>
            </div>
        `;
    }

    render() {
        if (!this._open) {
            return `<style>:host{display:contents;}</style>`;
        }
        const loading = Object.keys(this._settings).length === 0;
        const themeMode = this._getStr("theme_mode", "dark");

        const body = loading
            ? `<div class="loading-msg">${t("common.loading")}</div>`
            : `
                ${this._renderSection("settings.sect.theme", [
                    this._renderRow("settings.theme_mode", `
                        <select class="select-input" data-key="theme_mode">
                            <option value="dark"  ${themeMode === "dark"  ? "selected" : ""}>${t("settings.theme_dark")}</option>
                            <option value="light" ${themeMode === "light" ? "selected" : ""}>${t("settings.theme_light")}</option>
                        </select>`),
                ])}
                ${this._renderSection("settings.sect.window", [
                    this._renderRow("settings.edge_peek",
                        this._renderLocalToggle(
                            "Xz3r0.XDataHub.EdgePeek", false),
                        "settings.edge_peek_tooltip"),
                ])}
                ${this._renderSection("settings.sect.exec", [
                    this._renderRow("settings.disable_interaction_running",
                        this._renderToggle(
                            "disable_interaction_while_running", true)),
                ])}
                ${this._renderSection("settings.sect.video", [
                    this._renderRow("settings.video_autoplay",
                        this._renderToggle("video_preview_autoplay", false)),
                    this._renderRow("settings.video_muted",
                        this._renderToggle("video_preview_muted", true)),
                    this._renderRow("settings.video_loop",
                        this._renderToggle("video_preview_loop", false)),
                ])}
                ${this._renderSection("settings.sect.audio", [
                    this._renderRow("settings.audio_autoplay",
                        this._renderToggle("audio_preview_autoplay", false)),
                    this._renderRow("settings.audio_muted",
                        this._renderToggle("audio_preview_muted", false)),
                    this._renderRow("settings.audio_loop",
                        this._renderToggle("audio_preview_loop", false)),
                ])}
                ${this._renderSection("settings.sect.lora", [
                    this._renderRow("settings.store_lora_db",
                        this._renderToggle("store_lora_db_in_loras", false)),
                ])}
                ${this._renderFolderSection()}
            `;

        return `
            <style>
                ${ICON_CSS}
                ${TOOLTIP_CSS}
                ${SCROLLBAR_CSS}
                :host { display: contents; }

                .overlay {
                    position: fixed;
                    inset: 0;
                    z-index: 5000;
                    background: rgba(0,0,0,0.6);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                }

                .dialog {
                    background: var(--xdh-color-surface-1, #1a1a1a);
                    border: 1px solid var(--xdh-color-border, #2e2e2e);
                    border-radius: 12px;
                    box-shadow: 0 12px 48px rgba(0,0,0,0.65);
                    width: 460px;
                    max-width: calc(100vw - 32px);
                    /* 面板高度接近全屏，保留 16px 上下边缘 */
                    height: calc(100dvh - 32px);
                    display: flex;
                    flex-direction: column;
                    overflow: hidden;
                }

                .dialog-head {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    padding: 14px 18px 12px;
                    border-bottom: 1px solid var(--xdh-color-border, #2e2e2e);
                    flex-shrink: 0;
                }

                .dialog-title {
                    font-size: 14px;
                    font-weight: 600;
                    color: var(--xdh-color-text-primary, #f0f0f0);
                    display: flex;
                    align-items: center;
                    gap: 8px;
                }

                .btn-close-head {
                    background: transparent;
                    border: none;
                    color: var(--xdh-color-text-secondary, #888);
                    cursor: pointer;
                    padding: 4px;
                    border-radius: 6px;
                    display: flex;
                    align-items: center;
                    transition: color 0.13s, background 0.13s;
                }
                .btn-close-head:hover {
                    color: var(--xdh-color-text-primary, #f0f0f0);
                    background: var(--xdh-color-hover, #2a2a2a);
                }

                /* 内容区域：flex 撑满剩余空间，纵向滚动 */
                .dialog-body {
                    overflow-y: auto;
                    flex: 1;
                    padding: 6px 0 12px;
                }

                .loading-msg {
                    padding: 32px;
                    text-align: center;
                    color: var(--xdh-color-text-secondary, #888);
                    font-size: 13px;
                }

                .section {
                    padding: 10px 18px 4px;
                }

                .sect-title {
                    font-size: 11px;
                    font-weight: 600;
                    letter-spacing: 0.07em;
                    text-transform: uppercase;
                    color: var(--xdh-color-text-secondary, #888);
                    margin-bottom: 8px;
                    padding-bottom: 5px;
                    border-bottom: 1px solid var(--xdh-color-border, #2e2e2e);
                }

                .row {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    padding: 7px 0;
                    gap: 12px;
                }

                .row-label {
                    font-size: 13px;
                    color: var(--xdh-color-text-primary, #e8e8e8);
                    flex: 1;
                    min-width: 0;
                }

                .row-label-text {
                    display: inline-flex;
                    max-width: 100%;
                }

                .row-ctrl { flex-shrink: 0; }

                /* ── Toggle switch ── */
                .toggle {
                    position: relative;
                    display: inline-flex;
                    align-items: center;
                    cursor: pointer;
                    user-select: none;
                }
                .toggle input {
                    position: absolute;
                    opacity: 0;
                    width: 0; height: 0;
                }
                .track {
                    width: 36px;
                    height: 20px;
                    background: var(--xdh-color-surface-2, #333);
                    border-radius: 999px;
                    border: 1px solid var(--xdh-color-border, #3a3a3a);
                    transition: background 0.15s, border-color 0.15s;
                    position: relative;
                }
                .track::after {
                    content: "";
                    position: absolute;
                    width: 14px; height: 14px;
                    background: var(--xdh-color-text-secondary, #888);
                    border-radius: 50%;
                    top: 2px; left: 2px;
                    transition: transform 0.15s, background 0.15s;
                }
                .toggle input:checked + .track {
                    background: var(--xdh-brand-pink, #EA005E);
                    border-color: var(--xdh-brand-pink, #EA005E);
                }
                .toggle input:checked + .track::after {
                    transform: translateX(16px);
                    background: #fff;
                }

                /* ── Select ── */
                .select-input {
                    background: var(--xdh-color-surface-2, #252525);
                    border: 1px solid var(--xdh-color-border, #3a3a3a);
                    color: var(--xdh-color-text-primary, #eee);
                    border-radius: 6px;
                    padding: 5px 9px;
                    font-size: 12px;
                    outline: none;
                    cursor: pointer;
                    transition: border-color 0.13s;
                }
                .select-input:focus {
                    border-color: var(--xdh-brand-pink, #EA005E);
                }

                /* ── Custom folder list ── */
                .folder-list {
                    /* 最多显示约 3 条，超出内部滚动 */
                    max-height: 96px;
                    overflow-y: auto;
                    margin-bottom: 8px;
                    display: flex;
                    flex-direction: column;
                    gap: 4px;
                }
                .folder-empty {
                    font-size: 12px;
                    color: var(--xdh-color-text-secondary, #888);
                    padding: 6px 0;
                }
                .folder-tag {
                    display: flex;
                    align-items: center;
                    gap: 6px;
                    background: var(--xdh-color-surface-2, #252525);
                    border: 1px solid var(--xdh-color-border, #3a3a3a);
                    border-radius: 6px;
                    padding: 5px 8px;
                }
                .folder-tag-text {
                    flex: 1;
                    min-width: 0;
                    font-size: 12px;
                    color: var(--xdh-color-text-primary, #eee);
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                }
                .folder-del {
                    background: transparent;
                    border: none;
                    padding: 2px;
                    border-radius: 4px;
                    cursor: pointer;
                    color: var(--xdh-color-text-secondary, #888);
                    display: flex;
                    align-items: center;
                    flex-shrink: 0;
                    transition: color 0.12s, background 0.12s;
                }
                .folder-del:hover {
                    color: #e06060;
                    background: rgba(224, 96, 96, 0.15);
                }

                .folder-add-row {
                    display: flex;
                    gap: 6px;
                    align-items: center;
                }
                .folder-input {
                    flex: 1;
                    min-width: 0;
                    background: var(--xdh-color-surface-2, #252525);
                    border: 1px solid var(--xdh-color-border, #3a3a3a);
                    color: var(--xdh-color-text-primary, #eee);
                    border-radius: 6px;
                    padding: 5px 9px;
                    font-size: 12px;
                    outline: none;
                    transition: border-color 0.13s;
                }
                .folder-input:focus {
                    border-color: var(--xdh-brand-pink, #EA005E);
                }
                .folder-add-btn {
                    flex-shrink: 0;
                    background: var(--xdh-color-surface-2, #2e2e2e);
                    border: 1px solid var(--xdh-color-border, #3a3a3a);
                    color: var(--xdh-color-text-primary, #eee);
                    border-radius: 6px;
                    padding: 5px 12px;
                    font-size: 12px;
                    cursor: pointer;
                    transition: background 0.13s, border-color 0.13s;
                    white-space: nowrap;
                }
                .folder-add-btn:hover {
                    background: var(--xdh-color-hover, #333);
                    border-color: var(--xdh-brand-pink, #EA005E);
                    color: var(--xdh-brand-pink, #EA005E);
                }

                .confirm-overlay {
                    position: fixed;
                    inset: 0;
                    z-index: 5001;
                    background: rgba(0,0,0,0.72);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    padding: 16px;
                }

                .confirm-dialog {
                    width: min(460px, calc(100vw - 32px));
                    background: var(--xdh-color-surface-1, #1a1a1a);
                    border: 1px solid var(--xdh-color-border, #2e2e2e);
                    border-radius: 12px;
                    box-shadow: 0 12px 48px rgba(0,0,0,0.65);
                    padding: 18px;
                    display: flex;
                    flex-direction: column;
                    gap: 12px;
                }

                .confirm-title {
                    font-size: 15px;
                    font-weight: 600;
                    color: var(--xdh-color-text-primary, #f0f0f0);
                }

                .confirm-message {
                    font-size: 13px;
                    line-height: 1.6;
                    color: var(--xdh-color-text-secondary, #b8b8b8);
                }

                .confirm-path-list {
                    display: flex;
                    flex-direction: column;
                    gap: 8px;
                }

                .confirm-path-card {
                    background: var(--xdh-color-surface-2, #252525);
                    border: 1px solid var(--xdh-color-border, #3a3a3a);
                    border-radius: 6px;
                    padding: 8px 10px;
                    display: flex;
                    flex-direction: column;
                    gap: 4px;
                }

                .confirm-path-label {
                    font-size: 11px;
                    color: var(--xdh-color-text-secondary, #888);
                    text-transform: uppercase;
                    letter-spacing: 0.05em;
                }

                .confirm-path-value {
                    font-size: 12px;
                    line-height: 1.5;
                    color: var(--xdh-color-text-primary, #eee);
                    word-break: break-all;
                }

                .confirm-actions {
                    display: flex;
                    justify-content: flex-end;
                    flex-wrap: wrap;
                    gap: 8px;
                }

                .confirm-btn {
                    background: var(--xdh-color-surface-4, #505050);
                    border: 1px solid var(--xdh-color-surface-4, #505050);
                    color: var(--xdh-color-text-primary, #f0f0f0);
                    border-radius: 6px;
                    padding: 8px 12px;
                    font-size: 12px;
                    font-weight: 600;
                    cursor: pointer;
                    transition: background 0.13s, border-color 0.13s,
                        color 0.13s;
                }

                .confirm-btn:hover:not(:disabled) {
                    background: var(--xdh-color-surface-hover, #444444);
                    border-color: var(--xdh-color-surface-hover, #444444);
                }

                .confirm-btn:disabled {
                    opacity: 0.55;
                    cursor: default;
                }

                .confirm-btn-primary {
                    background: var(--xdh-color-success, #4caf50);
                    border-color: var(--xdh-color-success, #4caf50);
                    color: var(--xdh-pure-white, #ffffff);
                }

                .confirm-btn-primary:hover:not(:disabled) {
                    background: color-mix(
                        in srgb,
                        var(--xdh-color-success, #4caf50) 84%,
                        black 16%
                    );
                    border-color: color-mix(
                        in srgb,
                        var(--xdh-color-success, #4caf50) 84%,
                        black 16%
                    );
                }

                .confirm-btn-danger {
                    background: var(--state-danger-bg-standard, #EA005E);
                    border-color: var(--state-danger-bg-standard, #EA005E);
                    color: var(--xdh-pure-white, #ffffff);
                }

                .confirm-btn-danger:hover:not(:disabled) {
                    background: color-mix(
                        in srgb,
                        var(--state-danger-bg-standard, #EA005E) 84%,
                        black 16%
                    );
                    border-color: color-mix(
                        in srgb,
                        var(--state-danger-bg-standard, #EA005E) 84%,
                        black 16%
                    );
                }
            </style>
            <div class="overlay">
                <div class="dialog" role="dialog" aria-modal="true"
                     aria-label="${t("common.settings")}">
                    <div class="dialog-head">
                        <span class="dialog-title">
                            ${icon("settings", 15)}
                            ${t("common.settings")}
                        </span>
                        <button class="btn-close-head js-close">
                            ${icon("x", 14)}
                        </button>
                    </div>
                    <div class="dialog-body xdh-scroll">
                        ${body}
                    </div>
                </div>
            </div>
            ${this._renderLoraDbConflictDialog()}
        `;
    }

    bindEvents() {
        if (!this._open) return;
        this.$(".overlay")?.addEventListener("click", (e) => {
            if (e.target === e.currentTarget) this._close();
        });
        this.$(".js-close")?.addEventListener("click", () => this._close());
        this.$(".confirm-overlay")?.addEventListener("click", (e) => {
            if (e.target === e.currentTarget) {
                this._closeLoraDbConflictDialog();
            }
        });
        this.shadowRoot?.querySelectorAll(".confirm-btn[data-action]")
            .forEach((el) => {
                el.addEventListener("click", () => {
                    const action = el.dataset.action;
                    if (action === "cancel") {
                        this._closeLoraDbConflictDialog();
                        return;
                    }
                    if (action === "use-existing") {
                        this._resolveLoraDbConflict("use_existing");
                        return;
                    }
                    if (action === "replace") {
                        this._resolveLoraDbConflict("replace");
                    }
                });
            });
        this._refreshFolderDOM();
        if (Object.keys(this._settings).length > 0) {
            this._bindFormEvents();
        }
        // 文件夹添加按钮
        this.$(".folder-add-btn")?.addEventListener("click", () => {
            this._handleFolderAdd();
        });
        // 添加输入框 Enter 键触发添加
        this.$(".folder-input")?.addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
                e.preventDefault();
                this._handleFolderAdd();
            }
        });
    }

    _bindFormEvents() {
        // 开关切换 — 立即保存
        this.shadowRoot?.querySelectorAll(
            "input[type=checkbox][data-key]"
        ).forEach(el => {
            el.onchange = null;
            el.addEventListener("change", async () => {
                const key = el.dataset.key;
                const val = el.checked;
                const prev = this._settings[key];
                if (key === "store_lora_db_in_loras" && val) {
                    try {
                        const updated = await saveSettings({ [key]: val });
                        this._applyUpdatedSettings(updated);
                    } catch (error) {
                        el.checked = !!prev;
                        this._settings[key] = prev;
                        if (isLoraDbConflictError(error)) {
                            this._openLoraDbConflictDialog(error.payload);
                        }
                    }
                    return;
                }
                this._settings[key] = val;
                try {
                    const updated = await saveSettings({ [key]: val });
                    this._applyUpdatedSettings(updated);
                } catch {
                    el.checked = !val;
                    this._settings[key] = prev;
                }
            });
        });

        // localStorage 开关 — 写 localStorage 并通知父窗口
        this.shadowRoot?.querySelectorAll(
            "input[type=checkbox][data-lskey]"
        ).forEach(el => {
            el.onchange = null;
            el.addEventListener("change", () => {
                const lsKey = el.dataset.lskey;
                const val = el.checked;
                try { localStorage.setItem(lsKey, val ? "true" : "false"); }
                catch { /* ignore */ }
                window.parent.postMessage(
                    { type: "xdatahub:ls-setting", key: lsKey, value: val },
                    "*"
                );
            });
        });

        // Select — 立即保存
        this.shadowRoot?.querySelectorAll("select[data-key]")
            .forEach(el => {
                el.onchange = null;
                el.addEventListener("change", async () => {
                    const key = el.dataset.key;
                    const val = el.value;
                    const prev = this._settings[key];
                    this._settings[key] = val;
                    try {
                        const updated = await saveSettings({ [key]: val });
                        this._applyUpdatedSettings(updated);
                    } catch {
                        this._settings[key] = prev;
                        el.value = prev;
                    }
                });
            });
    }

    _folderRoots() {
        const raw = this._settings.media_custom_roots;
        return Array.isArray(raw) ? raw : (raw ? [raw] : []);
    }

    _createFolderTag(path, index) {
        const tagEl = document.createElement("div");
        tagEl.className = "folder-tag";

        const textEl = document.createElement("span");
        textEl.className = "folder-tag-text xdh-tooltip xdh-tooltip-down";
        textEl.setAttribute("data-tooltip", path);
        textEl.textContent = path;

        const deleteBtn = document.createElement("button");
        deleteBtn.className = "folder-del";
        deleteBtn.dataset.index = String(index);
        deleteBtn.setAttribute("aria-label", t("settings.folder_remove"));
        deleteBtn.innerHTML = icon("x", 12);
        deleteBtn.addEventListener("click", () => {
            this._handleFolderDelete(index);
        });

        tagEl.append(textEl, deleteBtn);
        return tagEl;
    }

    /** 仅更新 .folder-list 内容，不触发全量 renderRoot() */
    _refreshFolderDOM() {
        const listEl = this.$(".folder-list");
        if (!listEl) return;
        const roots = this._folderRoots();
        listEl.replaceChildren();
        if (roots.length) {
            const nodes = roots.map((path, index) =>
                this._createFolderTag(path, index)
            );
            listEl.append(...nodes);
        } else {
            const emptyEl = document.createElement("div");
            emptyEl.className = "folder-empty";
            emptyEl.textContent = t("settings.folder_empty");
            listEl.append(emptyEl);
        }
    }

    async _handleFolderDelete(index) {
        const roots = this._folderRoots().filter((_, i) => i !== index);
        try {
            const updated = await saveSettings(
                { media_custom_roots: roots }
            );
            this._settings.media_custom_roots =
                updated.media_custom_roots ?? roots;
            syncStoreSettings(updated);
        } catch {
            this._settings.media_custom_roots = roots;
        }
        this._refreshFolderDOM();
    }

    async _handleFolderAdd() {
        const input = this.$(".folder-input");
        if (!input) return;
        const val = input.value.trim();
        if (!val) return;
        const roots = this._folderRoots();
        if (roots.includes(val)) {
            input.value = "";
            return;
        }
        const newRoots = [...roots, val];
        try {
            const updated = await saveSettings(
                { media_custom_roots: newRoots }
            );
            this._settings.media_custom_roots =
                updated.media_custom_roots ?? newRoots;
            syncStoreSettings(updated);
        } catch {
            this._settings.media_custom_roots = newRoots;
        }
        input.value = "";
        this._refreshFolderDOM();
    }
}

customElements.define("xdh-settings-dialog", XdhSettingsDialog);
