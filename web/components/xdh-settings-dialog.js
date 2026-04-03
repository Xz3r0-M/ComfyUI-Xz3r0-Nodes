import { BaseElement } from "../core/base-element.js";
import { appStore } from "../core/store.js";
import { icon, ICON_CSS, SCROLLBAR_CSS } from "../core/icon.js";
import { t } from "../core/i18n.js?v=20260403-5";

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
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()).settings || {};
}

function esc(str) {
    return String(str || "").replace(/&/g, "&amp;").replace(/"/g, "&quot;");
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
        this._onOpen = () => this._show();
        this._onKeydown = (e) => {
            if (e.key === "Escape" && this._open) this._close();
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
        const tooltip = tooltipKey ? ` data-tooltip="${t(tooltipKey)}"` : "";
        return `<div class="row"${tooltip}>
            <span class="row-label">${t(labelKey)}</span>
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
        const roots = Array.isArray(this._settings.media_custom_roots)
            ? this._settings.media_custom_roots : [];
        const tags = roots.length
            ? roots.map((p, i) => `
                <div class="folder-tag">
                    <span class="folder-tag-text" title="${esc(p)}">${esc(p)}</span>
                    <button class="folder-del" data-index="${i}"
                        aria-label="${t("settings.folder_remove")}">
                        ${icon("x", 12)}
                    </button>
                </div>`).join("")
            : `<div class="folder-empty">${t("settings.folder_empty")}</div>`;

        return `<div class="section">
            <div class="sect-title">${t("settings.sect.media_folder")}</div>
            <div class="folder-list xdh-scroll">${tags}</div>
            <div class="folder-add-row">
                <input class="folder-input" type="text"
                    placeholder="${t("settings.custom_folder_placeholder")}">
                <button class="folder-add-btn">${t("settings.folder_add")}</button>
            </div>
        </div>`;
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
        `;
    }

    bindEvents() {
        if (!this._open) return;
        this.$(".overlay")?.addEventListener("click", (e) => {
            if (e.target === e.currentTarget) this._close();
        });
        this.$(".js-close")?.addEventListener("click", () => this._close());
        if (Object.keys(this._settings).length > 0) {
            this._bindFormEvents();
        }
        // 文件夹删除按钮
        this.shadowRoot?.querySelectorAll(".folder-del[data-index]")
            .forEach(btn => {
                btn.addEventListener("click", () => {
                    this._handleFolderDelete(Number(btn.dataset.index));
                });
            });
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
                this._settings[key] = val;
                try {
                    const updated = await saveSettings({ [key]: val });
                    this._settings = {
                        ...this._settings,
                        ...updated,
                    };
                    syncStoreSettings(updated);
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
                        this._settings = {
                            ...this._settings,
                            ...updated,
                        };
                        syncStoreSettings(updated);
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

    /** 仅更新 .folder-list 内容，不触发全量 renderRoot() */
    _refreshFolderDOM() {
        const listEl = this.$(".folder-list");
        if (!listEl) return;
        const roots = this._folderRoots();
        if (roots.length) {
            listEl.innerHTML = roots.map((p, i) => `
                <div class="folder-tag">
                    <span class="folder-tag-text" title="${esc(p)}">${esc(p)}</span>
                    <button class="folder-del" data-index="${i}"
                        aria-label="${t("settings.folder_remove")}">
                        ${icon("x", 12)}
                    </button>
                </div>`).join("");
        } else {
            listEl.innerHTML =
                `<div class="folder-empty">${t("settings.folder_empty")}</div>`;
        }
        // 重新绑定删除按钮事件
        listEl.querySelectorAll(".folder-del[data-index]").forEach(btn => {
            btn.addEventListener("click", () => {
                this._handleFolderDelete(Number(btn.dataset.index));
            });
        });
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
