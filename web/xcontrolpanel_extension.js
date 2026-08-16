import { api } from "../../scripts/api.js";
import { app } from "../../scripts/app.js";
import { ComfyDialog } from "../../scripts/ui/dialog.js";

var EXT_NAME = "ComfyUI.Xz3r0.XControlPanel";
var NODE_CLASS = "XControlPanel";
var WIDGET_NAME = "xcontrolpanel_actions";
var LOCALE_PREFIX = "xdatahub.ui.node.xcontrolpanel";
var COMFY_LOCALE_KEY = "Comfy.Locale";
var LOCALE_SYNC_INTERVAL = 1000;
var UPDATE_POLL_INTERVAL_MS = 1000;
var MIN_NODE_W = 390;
var MIN_NODE_H = 250;
var STYLE_ID = "xcontrolpanel-styles";
var uiLocalePrimary = null;
var uiLocaleFallback = null;
var i18nCache = {};
var localeSyncInstalled = false;
var controlPanelStates = {};

// 更新流程的模块级状态（跨面板共享，服务端为全局单例）
var updatePollTimer = null;
var updateModal = null;
var updateModalStage = null;
var updateModalPhaseEl = null;
var updateSourceState = null;
var updateKeyboardHandler = null;
var updateBeforeUnloadHandler = null;

// 按钮图标（Lucide 内联 SVG，继承按钮文字颜色）
var ICON_RESTART = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8\"/><path d=\"M21 3v5h-5\"/></svg>";
var ICON_SWITCH = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8\"/><path d=\"M21 3v5h-5\"/><path d=\"M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16\"/><path d=\"M8 16H3v5\"/></svg>";
function t(key, fallback) {
    if (uiLocalePrimary && uiLocalePrimary[key] !== undefined
        && String(uiLocalePrimary[key]).length > 0) {
        return uiLocalePrimary[key];
    }
    if (uiLocaleFallback && uiLocaleFallback[key] !== undefined
        && String(uiLocaleFallback[key]).length > 0) {
        return uiLocaleFallback[key];
    }
    return fallback || key;
}

function tk(suffix, fallback) {
    return t(LOCALE_PREFIX + "." + suffix, fallback);
}

function fetchI18n(locale) {
    if (i18nCache[locale]) return Promise.resolve(i18nCache[locale]);
    return fetch("/xz3r0/xdatahub/i18n/ui?locale=" + encodeURIComponent(locale))
        .then(function (response) {
            return response.ok ? response.json() : {};
        })
        .then(function (data) {
            i18nCache[locale] = data && data.dict ? data.dict : {};
            return i18nCache[locale];
        })
        .catch(function () {
            return {};
        });
}

function resolveComfyLocale() {
    try {
        var value = app.extensionManager
            && app.extensionManager.setting
            && app.extensionManager.setting.get
            && app.extensionManager.setting.get(COMFY_LOCALE_KEY);
        if (value) return value;
    } catch (_error) { /* fall through */ }
    try {
        var stored = localStorage.getItem(COMFY_LOCALE_KEY);
        if (stored) return stored;
    } catch (_error) { /* fall through */ }
    if (document.documentElement && document.documentElement.lang) {
        return document.documentElement.lang;
    }
    return navigator.language || "en";
}

function loadLocaleBundle(locale) {
    var normalized = (
        locale === "zh" || locale === "zh-CN" || locale === "zh-TW"
    ) ? "zh" : "en";
    return Promise.all([fetchI18n("en"), fetchI18n(normalized)])
        .then(function (results) {
            uiLocaleFallback = results[0];
            uiLocalePrimary = normalized === "en" ? results[0] : results[1];
            return normalized;
        });
}

function refreshAllPanelLocales() {
    for (var nodeId in controlPanelStates) {
        if (Object.prototype.hasOwnProperty.call(
            controlPanelStates,
            nodeId
        )) {
            applyPanelLocale(controlPanelStates[nodeId]);
        }
    }
}

function applyUiLocale(localeOverride) {
    return loadLocaleBundle(localeOverride || resolveComfyLocale())
        .then(function () {
            refreshAllPanelLocales();
        });
}

function installLocaleSync() {
    if (localeSyncInstalled) return;
    localeSyncInstalled = true;
    var lastLocale = null;
    setInterval(function () {
        var nextLocale = resolveComfyLocale();
        if (nextLocale && nextLocale !== lastLocale) {
            lastLocale = nextLocale;
            applyUiLocale(nextLocale);
        }
    }, LOCALE_SYNC_INTERVAL);
}

function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;

    var style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = [
        ".xcontrolpanel-wrap {",
        "  position: relative;",
        "  width: 100%; height: 100%;",
        "  display: flex;",
        "  flex-direction: column;",
        "  gap: 6px;",
        "  padding: 6px;",
        "  box-sizing: border-box;",
        "  overflow: hidden;",
        "}",
        ".xcontrolpanel-fieldset {",
        "  flex: 0 0 auto;",
        "  min-height: 0;",
        "  margin: 0;",
        "  padding: 5px 6px 6px;",
        "  border: 1px solid var(--border-color, #555);",
        "  border-radius: 4px;",
        "  display: flex;",
        "  flex-direction: column;",
        "  gap: 6px;",
        "}",
        ".xcontrolpanel-update-fieldset {",
        "  flex: 1 1 auto;",
        "}",
        ".xcontrolpanel-title {",
        "  font: var(--xdh-font-ui-md, 12px sans-serif);",
        "  color: var(--descrip-text, #999);",
        "  font-weight: 600;",
        "  line-height: 1.3;",
        "  padding: 0 4px;",
        "}",
        ".xcontrolpanel-subtitle {",
        "  font: var(--xdh-font-caption-sm, 11px sans-serif);",
        "  color: var(--descrip-text, #999);",
        "  line-height: 1.4;",
        "}",
        ".xcontrolpanel-button {",
        "  min-height: 36px;",
        "  padding: 8px 10px;",
        "  border: 1px solid var(--border-color, #555);",
        "  border-radius: 6px;",
        "  background: var(--comfy-menu-secondary-bg, #2a2a2a);",
        "  color: var(--input-text, #ddd);",
        "  font: var(--xdh-font-micro-label, 11px sans-serif);",
        "  text-align: center;",
        "  cursor: pointer;",
        "  transition: border-color 120ms ease, background-color 120ms ease;",
        "}",
        ".xcontrolpanel-button-icon {",
        "  display: flex;",
        "  align-items: center;",
        "  justify-content: center;",
        "  gap: 6px;",
        "}",
        ".xcontrolpanel-btn-icon {",
        "  display: inline-flex;",
        "  width: 14px;",
        "  height: 14px;",
        "  flex: 0 0 auto;",
        "}",
        ".xcontrolpanel-btn-icon svg {",
        "  width: 100%;",
        "  height: 100%;",
        "  display: block;",
        "}",
        ".xcontrolpanel-button:hover:enabled {",
        "  border-color: var(--primary-color, #ff385c);",
        "}",
        ".xcontrolpanel-button:disabled {",
        "  opacity: 0.65;",
        "  cursor: progress;",
        "}",
        ".xcontrolpanel-status {",
        "  min-height: 28px;",
        "  font: var(--xdh-font-caption-sm, 10px sans-serif);",
        "  color: var(--descrip-text, #999);",
        "  line-height: 1.4;",
        "  white-space: normal;",
        "}",
        ".xcontrolpanel-status.is-error {",
        "  color: var(--error-text, #ff8c8c);",
        "}",
        ".xcontrolpanel-status.is-success {",
        "  color: var(--success-color, #7bd88f);",
        "}",
        ".xcontrolpanel-update {",
        "  display: flex;",
        "  flex-direction: column;",
        "  gap: 5px;",
        "  border-top: 1px solid var(--border-color, #555);",
        "  padding-top: 6px;",
        "}",
        ".xcontrolpanel-version-row {",
        "  display: flex;",
        "  align-items: center;",
        "  justify-content: space-between;",
        "  gap: 6px;",
        "  font: var(--xdh-font-caption-sm, 11px sans-serif);",
        "  color: var(--descrip-text, #999);",
        "  line-height: 1.4;",
        "}",
        ".xcontrolpanel-version-text {",
        "  flex: 1 1 auto;",
        "  min-width: 0;",
        "  overflow: hidden;",
        "  text-overflow: ellipsis;",
        "  white-space: nowrap;",
        "}",
        ".xcontrolpanel-token-button {",
        "  align-self: flex-start;",
        "  margin-top: 4px;",
        "  padding: 1px 7px;",
        "  border: none;",
        "  border-radius: 3px;",
        "  background: transparent;",
        "  color: var(--descrip-text, #888);",
        "  font: var(--xdh-font-micro-label, 10px sans-serif);",
        "  cursor: pointer;",
        "  opacity: 0.75;",
        "}",
        ".xcontrolpanel-token-button:hover:enabled {",
        "  color: var(--descrip-text, #bbb);",
        "  opacity: 1;",
        "}",
        ".xcontrolpanel-token-input {",
        "  width: 100%;",
        "  box-sizing: border-box;",
        "  height: 30px;",
        "  padding: 0 8px;",
        "  border: 1px solid var(--border-color, #555);",
        "  border-radius: 6px;",
        "  background: var(--comfy-menu-bg, #1e1e1e);",
        "  color: var(--input-text, #ddd);",
        "  font: var(--xdh-font-micro-label, 11px sans-serif);",
        "}",
        ".xcontrolpanel-token-mode {",
        "  width: 100%;",
        "  box-sizing: border-box;",
        "  height: 26px;",
        "  padding: 0 6px;",
        "  border: 1px solid var(--border-color, #555);",
        "  border-radius: 6px;",
        "  background: var(--comfy-menu-bg, #1e1e1e);",
        "  color: var(--input-text, #ddd);",
        "  font: var(--xdh-font-micro-label, 11px sans-serif);",
        "}",
        ".xcontrolpanel-manager {",
        "  display: flex;",
        "  flex-direction: column;",
        "  gap: 8px;",
        "  min-width: 680px;",
        "  max-width: 720px;",
        "}",
        ".xcontrolpanel-manager-main {",
        "  display: flex;",
        "  gap: 14px;",
        "  flex: 1 1 auto;",
        "  min-height: 0;",
        "}",
        ".xcontrolpanel-manager-left {",
        "  flex: 0 0 260px;",
        "  display: flex;",
        "  flex-direction: column;",
        "  gap: 8px;",
        "  border-right: 1px solid var(--border-color, #555);",
        "  padding-right: 12px;",
        "}",
        ".xcontrolpanel-versions-row {",
        "  display: flex;",
        "  flex-wrap: wrap;",
        "  align-items: center;",
        "  gap: 5px;",
        "}",
        ".xcontrolpanel-version-chip {",
        "  display: inline-block;",
        "  padding: 1px 6px;",
        "  border: 1px solid var(--border-color, #555);",
        "  border-radius: 3px;",
        "  background: var(--comfy-menu-secondary-bg, #2a2a2a);",
        "  color: var(--input-text, #eee);",
        "  font: var(--xdh-font-ui-md, 12px sans-serif);",
        "  font-weight: 600;",
        "}",
        ".xcontrolpanel-version-chip.is-empty {",
        "  color: var(--descrip-text, #888);",
        "  font-weight: 400;",
        "}",
        ".xcontrolpanel-version-arrow {",
        "  display: inline-block;",
        "  font: var(--xdh-font-ui-md, 14px sans-serif);",
        "  font-weight: 700;",
        "}",
        ".xcontrolpanel-version-arrow.is-upgrade {",
        "  color: #7bd88f;",
        "}",
        ".xcontrolpanel-version-arrow.is-downgrade {",
        "  color: #ffb74d;",
        "}",
        ".xcontrolpanel-version-arrow.is-same {",
        "  color: var(--descrip-text, #999);",
        "}",
        ".xcontrolpanel-manager-right {",
        "  flex: 1 1 auto;",
        "  min-width: 0;",
        "  position: relative;",
        "  display: flex;",
        "  flex-direction: column;",
        "  gap: 6px;",
        "}",
        ".xcontrolpanel-float-toast {",
        "  position: absolute;",
        "  top: 0;",
        "  left: 0;",
        "  right: 0;",
        "  z-index: 5;",
        "  padding: 5px 8px;",
        "  border-radius: 4px;",
        "  font: var(--xdh-font-caption-sm, 11px sans-serif);",
        "  text-align: center;",
        "  background: var(--comfy-menu-bg, #1e1e1e);",
        "  border: 1px solid var(--border-color, #555);",
        "  opacity: 0;",
        "  pointer-events: none;",
        "  transition: opacity 180ms ease;",
        "}",
        ".xcontrolpanel-float-toast.is-visible {",
        "  opacity: 1;",
        "}",
        ".xcontrolpanel-float-toast.is-success {",
        "  color: var(--success-color, #7bd88f);",
        "}",
        ".xcontrolpanel-float-toast.is-warn {",
        "  color: #ffb74d;",
        "}",
        ".xcontrolpanel-float-toast.is-error {",
        "  color: var(--error-text, #ff8c8c);",
        "}",
        ".xcontrolpanel-manager-label {",
        "  font: var(--xdh-font-caption-sm, 11px sans-serif);",
        "  color: var(--descrip-text, #999);",
        "  line-height: 1.4;",
        "}",
        ".xcontrolpanel-manager-value {",
        "  font: var(--xdh-font-ui-lg, 16px sans-serif);",
        "  color: var(--input-text, #eee);",
        "  font-weight: 700;",
        "  line-height: 1.5;",
        "}",
        ".xcontrolpanel-version-badge {",
        "  display: inline-block;",
        "  min-width: 18px;",
        "  margin-right: 6px;",
        "  padding: 0 3px;",
        "  border-radius: 3px;",
        "  font: var(--xdh-font-micro-label, 10px sans-serif);",
        "  font-weight: 700;",
        "  text-align: center;",
        "}",
        ".xcontrolpanel-version-badge.is-upgrade {",
        "  color: #7bd88f;",
        "  background: rgba(123, 216, 143, 0.15);",
        "}",
        ".xcontrolpanel-version-badge.is-downgrade {",
        "  color: #ffb74d;",
        "  background: rgba(255, 183, 77, 0.15);",
        "}",
        ".xcontrolpanel-version-badge.is-same {",
        "  color: var(--descrip-text, #999);",
        "  background: rgba(150, 150, 150, 0.15);",
        "}",
        ".xcontrolpanel-version-tag-text {",
        "  font: var(--xdh-font-ui-lg, 16px sans-serif);",
        "  font-weight: 700;",
        "}",
        ".xcontrolpanel-manager-list {",
        "  height: 340px;",
        "}",
        ".xcontrolpanel-manager-footer {",
        "  display: flex;",
        "  align-items: center;",
        "  justify-content: space-between;",
        "  margin-top: 8px;",
        "  padding-top: 8px;",
        "  border-top: 1px solid var(--border-color, #555);",
        "}",
        ".xcontrolpanel-token-form {",
        "  display: flex;",
        "  flex-direction: column;",
        "  gap: 6px;",
        "  border: 1px dashed var(--border-color, #555);",
        "  border-radius: 4px;",
        "  padding: 6px;",
        "}",
        ".xcontrolpanel-token-actions {",
        "  display: flex;",
        "  gap: 6px;",
        "}",
        ".xcontrolpanel-update-row {",
        "  display: flex;",
        "  gap: 4px;",
        "  align-items: center;",
        "}",
        ".xcontrolpanel-search {",
        "  flex: 0 0 auto;",
        "  min-width: 0;",
        "  height: 22px;",
        "  padding: 0 6px;",
        "  box-sizing: border-box;",
        "  border: 1px solid var(--border-color, #555);",
        "  border-radius: 4px;",
        "  background: var(--comfy-menu-bg, #1e1e1e);",
        "  color: var(--input-text, #ddd);",
        "  font: var(--xdh-font-micro-label, 11px sans-serif);",
        "}",
        ".xcontrolpanel-refresh {",
        "  min-height: 26px;",
        "  padding: 2px 10px;",
        "  flex: 0 0 auto;",
        "}",
        ".xcontrolpanel-version-list {",
        "  position: relative;",
        "  max-height: 120px;",
        "  overflow-y: auto;",
        "  border: 1px solid var(--border-color, #555);",
        "  border-radius: 4px;",
        "  background: var(--comfy-menu-bg, #1e1e1e);",
        "}",
        ".xcontrolpanel-version-item {",
        "  display: flex;",
        "  align-items: center;",
        "  gap: 6px;",
        "  padding: 3px 6px;",
        "  cursor: pointer;",
        "  font: var(--xdh-font-micro-label, 11px sans-serif);",
        "  color: var(--input-text, #ddd);",
        "}",
        ".xcontrolpanel-version-item:hover {",
        "  background: var(--comfy-menu-secondary-bg, #2a2a2a);",
        "}",
        ".xcontrolpanel-version-item.is-selected {",
        "  background: var(--primary-color, #ff385c);",
        "  color: #fff;",
        "}",
        ".xcontrolpanel-version-item.is-selected .xcontrolpanel-version-kind,",
        "  .xcontrolpanel-version-item.is-selected .xcontrolpanel-version-date {",
        "  color: inherit;",
        "}",
        ".xcontrolpanel-badge {",
        "  width: 8px;",
        "  height: 8px;",
        "  border-radius: 50%;",
        "  flex: 0 0 auto;",
        "}",
        ".xcontrolpanel-badge-release { background: #4caf50; }",
        ".xcontrolpanel-badge-prerelease { background: #ff9800; }",
        ".xcontrolpanel-badge-dev { background: #9e9e9e; }",
        ".xcontrolpanel-version-tag {",
        "  flex: 0 1 auto;",
        "  min-width: 0;",
        "  overflow: hidden;",
        "  text-overflow: ellipsis;",
        "  white-space: nowrap;",
        "}",
        ".xcontrolpanel-version-kind {",
        "  flex: 0 0 auto;",
        "  color: var(--descrip-text, #999);",
        "}",
        ".xcontrolpanel-version-date {",
        "  flex: 0 0 auto;",
        "  color: var(--descrip-text, #999);",
        "  font-size: 10px;",
        "  margin-left: 8px;",
        "  padding-left: 8px;",
        "  border-left: 1px solid var(--border-color, #555);",
        "}",
        ".xcontrolpanel-list-empty {",
        "  padding: 6px;",
        "  color: var(--descrip-text, #999);",
        "  font: var(--xdh-font-caption-sm, 11px sans-serif);",
        "}",
        ".xcontrolpanel-change {",
        "  min-height: 30px;",
        "}",
        ".xcontrolpanel-dialog-body {",
        "  display: flex;",
        "  flex-direction: column;",
        "  gap: 8px;",
        "  min-width: 320px;",
        "  max-width: 420px;",
        "}",
        ".xcontrolpanel-dialog-title {",
        "  font-weight: 600;",
        "}",
        ".xcontrolpanel-dialog-text {",
        "  line-height: 1.5;",
        "}",
        ".xcontrolpanel-dialog-warning {",
        "  color: #ffb74d;",
        "  line-height: 1.5;",
        "}",
        ".xcontrolpanel-dialog-error {",
        "  color: var(--error-text, #ff8c8c);",
        "  line-height: 1.5;",
        "  white-space: pre-wrap;",
        "  word-break: break-word;",
        "  max-height: 160px;",
        "  overflow-y: auto;",
        "}",
        ".xcontrolpanel-dialog-buttons {",
        "  display: flex;",
        "  justify-content: flex-end;",
        "  gap: 8px;",
        "  margin-top: 4px;",
        "}",
    ].join("\n");
    document.head.appendChild(style);
}

function setStatusEl(element, message, kind) {
    if (!element) return;
    element.textContent = message || "";
    element.classList.remove("is-error", "is-success");
    if (kind === "error") {
        element.classList.add("is-error");
    } else if (kind === "success") {
        element.classList.add("is-success");
    }
}

function setStatus(state, message, kind) {
    setStatusEl(state && state.statusEl, message, kind);
}

function setUpdateStatus(state, message, kind) {
    setStatusEl(state && state.updateStatusEl, message, kind);
}

function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null && text !== "") {
        node.textContent = text;
    }
    return node;
}

function toast(message, severity) {
    try {
        if (app.extensionManager
            && app.extensionManager.toast
            && app.extensionManager.toast.add) {
            app.extensionManager.toast.add({
                severity: severity || "info",
                summary: "XControlPanel",
                detail: message,
                life: severity === "error" ? 5000 : 4000,
            });
        }
    } catch (_error) { /* ignore */ }
}

function normalizedVersion(value) {
    return String(value || "").replace(/^v/i, "");
}

function formatDate(iso) {
    var match = String(iso || "").match(/^\d{4}-\d{2}-\d{2}/);
    return match ? match[0] : "";
}

function kindLabel(kind) {
    if (kind === "release") return tk("badge.release", "Release");
    if (kind === "prerelease") return tk("badge.prerelease", "Pre-release");
    return tk("badge.dev", "Dev");
}

function updateStartErrorMessage(payload) {
    var code = payload && payload.code;
    if (code === "busy") return tk("err.busy", "Another update is already running.");
    if (code === "rate_limit") return rateLimitMessage(payload);
    if (code === "network") {
        return tk("err.network", "Cannot reach GitHub. Check your network and retry.");
    }
    if (code === "not_git") {
        return tk("err.not_git", "This ComfyUI was not installed with git.");
    }
    if (code === "unknown_tag") {
        return tk("err.unknown_tag", "This version is no longer in the list. Refresh and pick again.");
    }
    if (code === "already_current") {
        return tk("err.already_current", "ComfyUI is already on this version.");
    }
    if (code === "bad_request") {
        return (payload && payload.message) || tk("err.update_failed", "Update failed.");
    }
    return tk("err.update_failed", "Update failed.");
}

function rateLimitMessage(payload) {
    var retryAfter = payload && payload.retry_after;
    var hint = "";
    if (payload && payload.token_configured === false) {
        hint = " " + tk(
            "err.rate_limit_token_hint",
            "Set a GitHub token to raise the limit to 5000 requests per hour."
        );
    }
    if (retryAfter > 0) {
        var minutes = Math.max(1, Math.ceil(retryAfter / 60));
        return tk(
            "err.rate_limit_retry",
            "GitHub request limit reached. Try again in about {m} minute(s)."
        ).replace("{m}", String(minutes)) + hint;
    }
    return tk(
        "err.rate_limit",
        "GitHub request limit reached. Wait a while and retry."
    ) + hint;
}

function applyPanelLocale(state) {
    if (!state) return;
    if (state.titleEl) {
        state.titleEl.textContent = tk("title", "Restart ComfyUI");
    }
    if (state.titleUpdateEl) {
        state.titleUpdateEl.textContent = tk(
            "title.update",
            "Switch ComfyUI version"
        );
    }
    if (state.subtitleUpdateEl) {
        state.subtitleUpdateEl.textContent = tk(
            "subtitle.update",
            "See the current ComfyUI version and switch to any official version."
        );
    }
    if (state.openManagerButton) {
        state.openManagerButton.dataset.label = tk(
            "btn.open_manager",
            "Switch ComfyUI version"
        );
        state.openManagerButton.title = tk(
            "tip.open_manager",
            "Open a window to see and switch ComfyUI versions."
        );
        if (state.openManagerLabelEl) {
            state.openManagerLabelEl.textContent =
                state.openManagerButton.dataset.label;
        }
    }
    if (state.subtitleEl) {
        state.subtitleEl.textContent = tk(
            "subtitle",
            "Restart the ComfyUI server process. Refresh the browser after it comes back."
        );
    }
    if (state.restartButton) {
        state.restartButton.dataset.label = tk(
            "btn.restart",
            "Restart ComfyUI"
        );
        state.restartButton.dataset.busyLabel = tk(
            "btn.restart_busy",
            "Restarting ComfyUI..."
        );
        state.restartButton.title = tk(
            "tip.restart",
            "Restart the ComfyUI server process."
        );
        if (!state.isBusy && state.restartLabelEl) {
            state.restartLabelEl.textContent = state.restartButton.dataset.label;
        }
    }
    if (state.versionRowEl) {
        renderVersionRow(state);
    }
    if (state.tokenButtonEl) {
        state.tokenButtonEl.textContent = tk("btn.token", "GitHub token");
        state.tokenButtonEl.title = tk(
            "tip.token",
            "Set a GitHub token to raise the request limit (5000/hour instead of 60)."
        );
    }
    if (state.searchEl) {
        state.searchEl.placeholder = tk("search.placeholder", "Search versions…");
    }
    if (state.refreshButton) {
        state.refreshButton.dataset.label = tk("btn.refresh", "Refresh");
        state.refreshButton.dataset.busyLabel = tk("btn.refresh_busy", "Refreshing…");
        state.refreshButton.title = tk(
            "tip.refresh",
            "Fetch the latest official versions from GitHub."
        );
        if (!state.isRefreshing) {
            state.refreshButton.textContent = state.refreshButton.dataset.label;
        }
    }
    if (state.changeButton) {
        state.changeButton.dataset.label = tk("btn.change", "Switch version");
        state.changeButton.dataset.busyLabel = tk("btn.change_busy", "Updating…");
        state.changeButton.title = tk(
            "tip.change",
            "Switch ComfyUI to the selected version and install its dependencies."
        );
        updateChangeButton(state);
    }
    if (state.versions && state.versions.length > 0) {
        renderVersionList(state);
    }
    if (!state.hasStatus && state.statusEl) {
        state.statusEl.textContent = tk("status.idle", "Idle");
    }
}

function setBusy(state, busy) {
    state.isBusy = !!busy;
    if (!state.restartButton) return;
    state.restartButton.disabled = !!busy;
    if (state.restartLabelEl) {
        state.restartLabelEl.textContent = busy
            ? state.restartButton.dataset.busyLabel
            : state.restartButton.dataset.label;
    }
}

async function confirmRestart() {
    var message = tk(
        "confirm.restart",
        "Restart ComfyUI now? Running work may be interrupted."
    );
    try {
        if (app.extensionManager
            && app.extensionManager.dialog
            && app.extensionManager.dialog.confirm) {
            return await app.extensionManager.dialog.confirm({
                title: tk("confirm.title", "Restart ComfyUI"),
                message: message,
            });
        }
    } catch (_error) { /* fall through */ }
    return window.confirm(message);
}

async function runRestart(state) {
    if (!state || state.isBusy) return;

    var confirmed = await confirmRestart();
    if (!confirmed) return;

    setBusy(state, true);
    setStatus(state, tk("status.restarting", "Restart request sent..."), "");
    state.hasStatus = true;

    try {
        var response = await api.fetchApi("/xz3r0/xcontrolpanel/restart", {
            method: "POST",
        });

        var payload = {};
        try {
            payload = await response.json();
        } catch (_error) {
            payload = {};
        }

        if (!response.ok || payload.status !== "success") {
            var message = payload.message ||
                tk("status.request_failed", "Restart request failed");
            setStatus(state, message, "error");
            app.extensionManager.toast.add({
                severity: "error",
                summary: "XControlPanel",
                detail: message,
                life: 4000,
            });
            setBusy(state, false);
            return;
        }

        var successMessage = tk(
            "status.restarting_wait",
            "Waiting for ComfyUI to restart…"
        );
        setStatus(state, successMessage, "");
        startRestartDetection(state);
    } catch (error) {
        var detail = error && error.message ?
            error.message :
            tk("status.request_failed", "Restart request failed");
        setStatus(state, detail, "error");
        app.extensionManager.toast.add({
            severity: "error",
            summary: "XControlPanel",
            detail: detail,
            life: 4000,
        });
        setBusy(state, false);
    }
}

// ---------------------------------------------------------------- 重启完成探测

var RESTART_POLL_INTERVAL_MS = 2000;
var RESTART_POLL_TIMEOUT_MS = 180000;
var RESTART_EVENT_FALLBACK_MS = 8000;
var restartPollTimer = null;
var restartPollAttempts = 0;
var restartEventTimer = null;
var restartEventHandlers = null;

function startRestartDetection(state) {
    if (restartEventTimer || restartPollTimer) return;
    restartPollAttempts = 0;

    // 方案一：监听官方 websocket 事件（服务断开 → 重连成功 = 重启完成）
    var onReconnecting = function () {
        if (state) {
            setStatus(state,
                tk("status.restarting_wait", "Waiting for ComfyUI to restart…"), "");
        }
    };
    var onReconnected = function () {
        finishRestartDetection(state);
    };
    restartEventHandlers = { onReconnecting: onReconnecting, onReconnected: onReconnected };
    try {
        api.addEventListener("reconnecting", onReconnecting);
        api.addEventListener("reconnected", onReconnected);
    } catch (_error) { /* ignore */ }

    // 方案二兜底：事件 8 秒内未触发，转轮询核心接口
    restartEventTimer = setTimeout(function () {
        restartEventTimer = null;
        if (restartPollTimer) return;
        restartPollTimer = setInterval(function () {
            pollRestartStatus(state);
        }, RESTART_POLL_INTERVAL_MS);
        pollRestartStatus(state);
    }, RESTART_EVENT_FALLBACK_MS);
}

function finishRestartDetection(state) {
    stopRestartDetection();
    if (state) {
        setBusy(state, false);
        var doneMessage = tk(
            "status.restarted",
            "Restart complete. You can refresh the page."
        );
        setStatus(state, doneMessage, "success");
        toast(doneMessage, "success");
    }
}

async function pollRestartStatus(state) {
    restartPollAttempts += 1;
    try {
        // 任意轻量核心接口：能连上即代表 ComfyUI 已恢复
        await api.fetchApi("/system_stats");
        finishRestartDetection(state);
        return;
    } catch (_error) {
        // 连接失败：还在重启中，继续等待
    }
    if (restartPollAttempts * RESTART_POLL_INTERVAL_MS
        >= RESTART_POLL_TIMEOUT_MS) {
        stopRestartDetection();
        if (state) {
            setBusy(state, false);
            var timeoutMessage = tk(
                "status.restart_timeout",
                "Restart is taking too long. Refresh the page manually or check ComfyUI."
            );
            setStatus(state, timeoutMessage, "error");
            toast(timeoutMessage, "error");
        }
    }
}

function stopRestartDetection() {
    if (restartPollTimer) {
        clearInterval(restartPollTimer);
        restartPollTimer = null;
    }
    if (restartEventTimer) {
        clearTimeout(restartEventTimer);
        restartEventTimer = null;
    }
    if (restartEventHandlers) {
        try {
            api.removeEventListener("reconnecting", restartEventHandlers.onReconnecting);
            api.removeEventListener("reconnected", restartEventHandlers.onReconnected);
        } catch (_error) { /* ignore */ }
        restartEventHandlers = null;
    }
}

// ---------------------------------------------------------------- 更新区块

function renderVersionRow(state) {
    if (!state || !state.versionRowEl) return;
    if (!state.supported) {
        state.versionTextEl.textContent = tk(
            "unsupported",
            "This ComfyUI was not installed with git, so version switching is unavailable."
        );
        setUpdateControlsHidden(state, true);
        return;
    }
    setUpdateControlsHidden(state, false);
    state.versionTextEl.textContent = tk(
        "current_version",
        "Current version: {v}"
    ).replace("{v}", state.currentVersion || "?");
}

function setUpdateControlsHidden(state, hidden) {
    if (!state) return;
    var els = [state.updateRowEl, state.versionListEl, state.changeButton];
    for (var i = 0; i < els.length; i++) {
        if (els[i]) els[i].style.display = hidden ? "none" : "";
    }
}

function renderVersionList(state) {
    if (!state || !state.versionListEl) return;
    state.versionListEl.textContent = "";
    // 浮动提示挂在列表内：清空后恢复，避免被移除
    if (state.floatToastEl) {
        state.versionListEl.appendChild(state.floatToastEl);
    }
    var versions = state.versions || [];
    if (versions.length === 0) {
        state.filteredVersions = [];
        state.versionListEl.appendChild(el(
            "div", "xcontrolpanel-list-empty",
            tk("manager.placeholder",
                "No versions yet. Click the button above to fetch the official list.")));
        return;
    }
    var query = String((state.searchEl && state.searchEl.value) || "")
        .trim().toLowerCase();
    var filtered = [];
    for (var i = 0; i < versions.length; i++) {
        var v = versions[i];
        if (!query || String(v.tag || "").toLowerCase().indexOf(query) !== -1) {
            filtered.push(v);
        }
    }
    state.filteredVersions = filtered;
    if (filtered.length === 0) {
        state.versionListEl.appendChild(
            el("div", "xcontrolpanel-list-empty", tk("list.empty", "No matching versions"))
        );
        return;
    }
    for (var j = 0; j < filtered.length; j++) {
        state.versionListEl.appendChild(buildVersionItem(state, filtered[j]));
    }
    highlightSelection(state);
}

function buildVersionItem(state, v) {
    var item = document.createElement("div");
    item.className = "xcontrolpanel-version-item";
    item.dataset.tag = v.tag;
    item.appendChild(el("span", "xcontrolpanel-badge xcontrolpanel-badge-" + v.kind, ""));
    item.appendChild(el("span", "xcontrolpanel-version-tag", v.tag));
    item.appendChild(el("span", "xcontrolpanel-version-kind", kindLabel(v.kind)));
    if (v.kind === "release" && v.published_at) {
        item.appendChild(el("span", "xcontrolpanel-version-date", formatDate(v.published_at)));
    }
    item.addEventListener("click", function () {
        state.selectedTag = v.tag;
        highlightSelection(state);
        updateChangeButton(state);
        updateSelectedVersionLabel(state);
    });
    return item;
}

function highlightSelection(state) {
    if (!state || !state.versionListEl) return;
    var items = state.versionListEl.children || [];
    var selected = state.selectedTag || "";
    for (var i = 0; i < items.length; i++) {
        if (items[i].dataset && items[i].dataset.tag === selected) {
            items[i].classList.add("is-selected");
        } else if (items[i].classList) {
            items[i].classList.remove("is-selected");
        }
    }
}

function moveSelection(state, delta) {
    var filtered = state.filteredVersions || [];
    if (filtered.length === 0) return;
    var idx = -1;
    for (var i = 0; i < filtered.length; i++) {
        if (filtered[i].tag === state.selectedTag) {
            idx = i;
            break;
        }
    }
    var next = (idx + delta + filtered.length) % filtered.length;
    state.selectedTag = filtered[next].tag;
    highlightSelection(state);
    updateChangeButton(state);
    updateSelectedVersionLabel(state);
    scrollSelectedIntoView(state);
}

function scrollSelectedIntoView(state) {
    if (!state || !state.versionListEl) return;
    var items = state.versionListEl.children || [];
    for (var i = 0; i < items.length; i++) {
        if (items[i].dataset && items[i].dataset.tag === state.selectedTag
            && typeof items[i].scrollIntoView === "function") {
            items[i].scrollIntoView({ block: "nearest" });
            return;
        }
    }
}

function updateChangeButton(state) {
    if (!state || !state.changeButton) return;
    var enabled = !!state.supported
        && !state.isBusy
        && !state.isUpdateBusy
        && !state.isRefreshing
        && !!state.selectedTag
        && normalizedVersion(state.selectedTag) !== normalizedVersion(state.currentVersion);
    state.changeButton.disabled = !enabled;
    state.changeButton.textContent = state.isUpdateBusy
        ? state.changeButton.dataset.busyLabel
        : state.changeButton.dataset.label;
}

function updateSelectedVersionLabel(state) {
    if (!state || !state.selectedVersionEl) return;
    if (!state.selectedTag) {
        state.selectedVersionEl.textContent = tk("manager.none", "Not selected");
        if (state.versionArrowEl) {
            state.versionArrowEl.textContent = "→";
            state.versionArrowEl.className = "xcontrolpanel-version-arrow is-same";
        }
        return;
    }
    state.selectedVersionEl.textContent = state.selectedTag;
    if (!state.versionArrowEl) return;
    var cmp = compareTagVersions(state.selectedTag, state.currentVersion);
    if (cmp > 0) {
        state.versionArrowEl.textContent = "↑";
        state.versionArrowEl.className = "xcontrolpanel-version-arrow is-upgrade";
    } else if (cmp < 0) {
        state.versionArrowEl.textContent = "↓";
        state.versionArrowEl.className = "xcontrolpanel-version-arrow is-downgrade";
    } else {
        state.versionArrowEl.textContent = "→";
        state.versionArrowEl.className = "xcontrolpanel-version-arrow is-same";
    }
}

function displayVersion(v) {
    var s = String(v || "");
    if (!s) return "?";
    if (s.charAt(0) === "v" || s.charAt(0) === "V") return s;
    return "v" + s;
}

function compareTagVersions(a, b) {
    function parts(t) {
        var raw = String(t || "").replace(/^v/i, "").split("-")[0];
        var segs = raw.split(".");
        var nums = [];
        for (var i = 0; i < segs.length; i++) {
            nums.push(parseInt(segs[i], 10) || 0);
        }
        return nums;
    }
    var pa = parts(a);
    var pb = parts(b);
    var len = Math.max(pa.length, pb.length);
    for (var i = 0; i < len; i++) {
        var x = pa[i] || 0;
        var y = pb[i] || 0;
        if (x !== y) return x - y;
    }
    return 0;
}

function setRefreshBusy(state, busy) {
    if (!state) return;
    state.isRefreshing = !!busy;
    if (state.refreshButton) {
        state.refreshButton.disabled = !!busy || state.isBusy || state.isUpdateBusy;
        state.refreshButton.textContent = busy
            ? state.refreshButton.dataset.busyLabel
            : state.refreshButton.dataset.label;
    }
    updateChangeButton(state);
}

function setUpdateBusy(state, busy) {
    if (!state) return;
    state.isUpdateBusy = !!busy;
    updateChangeButton(state);
}

async function refreshVersions(state) {
    if (!state || state.isUpdateBusy || state.isBusy || !state.supported) return;
    setRefreshBusy(state, true);
    try {
        var response = await api.fetchApi("/xz3r0/xcontrolpanel/update/refresh", {
            method: "POST",
        });
        var payload = {};
        try {
            payload = await response.json();
        } catch (_error) {
            payload = {};
        }
        if (!response.ok || payload.status !== "success") {
            var code = payload && payload.code;
            var message = code === "rate_limit"
                ? rateLimitMessage(payload)
                : code === "network"
                    ? tk("err.network", "Cannot reach GitHub. Check your network and retry.")
                    : (payload && payload.message)
                        || tk("err.refresh", "Failed to fetch the version list.");
            setUpdateStatus(state, message, "error");
            toast(message, "error");
            return;
        }
        state.versions = payload.versions || [];
        state.selectedTag = "";
        renderVersionList(state);
        updateChangeButton(state);
        updateSelectedVersionLabel(state);
        if (payload.from_cache) {
            var cacheMessage = tk(
                "status.from_cache",
                "Network limited. Showing the last fetched version list."
            );
            showFloatToast(state, cacheMessage, "warn");
            toast(cacheMessage, "warn");
        } else {
            showFloatToast(state,
                tk("status.refreshed", "Version list refreshed."), "success");
        }
    } catch (error) {
        var detail = (error && error.message)
            || tk("err.refresh", "Failed to fetch the version list.");
        setUpdateStatus(state, detail, "error");
        toast(detail, "error");
    } finally {
        setRefreshBusy(state, false);
    }
}

async function syncUpdateStatus(state) {
    if (!state) return;
    try {
        var response = await api.fetchApi("/xz3r0/xcontrolpanel/update/status");
        var payload = {};
        try {
            payload = await response.json();
        } catch (_error) {
            payload = {};
        }
        if (!response.ok || payload.status !== "success" || !payload.data) return;
        var data = payload.data;
        state.supported = !!data.supported;
        state.currentVersion = data.current_version || "";
        state.dirty = !!data.dirty;
        if ((!state.versions || state.versions.length === 0) && data.versions) {
            state.versions = data.versions;
        }
        renderVersionRow(state);
        renderVersionList(state);
        updateChangeButton(state);
        var update = data.update || {};
        if (update.active) {
            updateSourceState = state;
            openUpdateProgress();
            renderUpdateProgress(update);
            startUpdatePolling();
        }
    } catch (_error) {
        // 无法连接服务端时静默，避免面板加载报错
    }
}

// ---------------------------------------------------------------- 版本管理窗口

var updateManagerState = null;

function openVersionManagerWindow(nodeState) {
    ensureUpdateModal();
    updateModalStage = "manager";

    var body = document.createElement("div");
    body.className = "xcontrolpanel-manager";

    // ---- 左栏：当前版本 → 已选版本（同一行）+ 更换按钮 ----
    var leftCol = el("div", "xcontrolpanel-manager-left");

    var versionsRow = el("div", "xcontrolpanel-versions-row", "");
    versionsRow.appendChild(el("span", "xcontrolpanel-manager-label",
        tk("manager.current", "Current")));
    var currentVersionEl = el("span", "xcontrolpanel-version-chip", "…");
    versionsRow.appendChild(currentVersionEl);
    var versionArrowEl = el("span", "xcontrolpanel-version-arrow is-same", "→");
    versionsRow.appendChild(versionArrowEl);
    versionsRow.appendChild(el("span", "xcontrolpanel-manager-label",
        tk("manager.selected", "Selected")));
    var selectedVersionEl = el("span", "xcontrolpanel-version-chip is-empty",
        tk("manager.none", "Not selected"));
    versionsRow.appendChild(selectedVersionEl);
    leftCol.appendChild(versionsRow);

    var changeButton = el("button", "xcontrolpanel-button xcontrolpanel-change",
        tk("manager.change", "Switch to selected version"));
    changeButton.type = "button";
    changeButton.disabled = true;
    changeButton.dataset.label = tk("manager.change", "Switch to selected version");
    changeButton.dataset.busyLabel = tk("btn.change_busy", "Updating…");
    leftCol.appendChild(changeButton);

    var updateStatusEl = el("div", "xcontrolpanel-status", "");
    leftCol.appendChild(updateStatusEl);

    // ---- 右栏：获取版本按钮 + 搜索 + 版本列表（含浮动提示） ----
    var rightCol = el("div", "xcontrolpanel-manager-right");

    var fetchButton = el("button", "xcontrolpanel-button xcontrolpanel-refresh",
        tk("manager.fetch", "Fetch ComfyUI versions"));
    fetchButton.type = "button";
    fetchButton.dataset.label = tk("manager.fetch", "Fetch ComfyUI versions");
    fetchButton.dataset.busyLabel = tk("btn.refresh_busy", "Refreshing…");
    rightCol.appendChild(fetchButton);

    var searchEl = document.createElement("input");
    searchEl.className = "xcontrolpanel-search";
    searchEl.type = "text";
    searchEl.placeholder = tk("search.placeholder", "Search versions…");
    rightCol.appendChild(searchEl);

    var versionListEl = el("div", "xcontrolpanel-version-list xcontrolpanel-manager-list", "");
    // 浮动提示挂在版本列表内（列表上方），不遮挡按钮/搜索框
    var floatToastEl = el("div", "xcontrolpanel-float-toast", "");
    versionListEl.appendChild(floatToastEl);
    rightCol.appendChild(versionListEl);

    var mainRow = el("div", "xcontrolpanel-manager-main", "");
    mainRow.appendChild(leftCol);
    mainRow.appendChild(rightCol);
    body.appendChild(mainRow);
    // ---- 令牌配置（表单在底部上方展开） ----
    var tokenFormEl = el("div", "xcontrolpanel-token-form", "");
    tokenFormEl.style.display = "none";
    var tokenStatusEl = el("div", "xcontrolpanel-dialog-text", "");
    tokenFormEl.appendChild(tokenStatusEl);
    var tokenModeEl = createTokenModeSelect();
    tokenFormEl.appendChild(tokenModeEl);
    var tokenInputEl = document.createElement("input");
    tokenInputEl.className = "xcontrolpanel-token-input";
    tokenInputEl.type = "password";
    tokenInputEl.placeholder = tk("token.placeholder", "Paste token here");
    tokenFormEl.appendChild(tokenInputEl);
    var tokenHelpEl = el("div", "xcontrolpanel-dialog-text", "");
    tokenFormEl.appendChild(tokenHelpEl);
    var tokenActionsEl = el("div", "xcontrolpanel-token-actions", "");
    var tokenSaveBtn = el("button", "xcontrolpanel-button",
        tk("token.save", "Save"));
    tokenSaveBtn.type = "button";
    var tokenClearBtn = el("button", "xcontrolpanel-button",
        tk("token.clear", "Clear"));
    tokenClearBtn.type = "button";
    tokenActionsEl.appendChild(tokenSaveBtn);
    tokenActionsEl.appendChild(tokenClearBtn);
    tokenFormEl.appendChild(tokenActionsEl);
    body.appendChild(tokenFormEl);

    // ---- 底部：令牌按钮（左） + 关闭（右） ----
    var footer = el("div", "xcontrolpanel-manager-footer", "");
    var tokenButtonEl = el("button", "xcontrolpanel-token-button",
        tk("btn.token", "GitHub token"));
    tokenButtonEl.type = "button";
    footer.appendChild(tokenButtonEl);
    var closeBtn = el("button", "xcontrolpanel-button",
        tk("manager.close", "Close"));
    closeBtn.type = "button";
    closeBtn.addEventListener("click", function () {
        closeUpdateModal();
    });
    footer.appendChild(closeBtn);
    body.appendChild(footer);

    var winState = {
        nodeState: nodeState,
        body: body,
        currentVersionEl: currentVersionEl,
        selectedVersionEl: selectedVersionEl,
        versionArrowEl: versionArrowEl,
        changeButton: changeButton,
        updateStatusEl: updateStatusEl,
        tokenButtonEl: tokenButtonEl,
        tokenFormEl: tokenFormEl,
        tokenStatusEl: tokenStatusEl,
        tokenModeEl: tokenModeEl,
        tokenInputEl: tokenInputEl,
        tokenHelpEl: tokenHelpEl,
        refreshButton: fetchButton,
        floatToastEl: floatToastEl,
        searchEl: searchEl,
        versionListEl: versionListEl,
        versions: [],
        filteredVersions: [],
        selectedTag: "",
        currentVersion: "",
        supported: true,
        dirty: false,
        isBusy: false,
        isRefreshing: false,
        isUpdateBusy: false,
    };
    updateManagerState = winState;

    fetchButton.addEventListener("click", function () {
        refreshVersions(winState);
    });
    changeButton.addEventListener("click", function () {
        runUpdate(winState);
    });
    tokenButtonEl.addEventListener("click", function () {
        toggleTokenForm(winState);
    });
    tokenModeEl.addEventListener("change", function () {
        updateTokenModeUi(winState);
    });
    tokenSaveBtn.addEventListener("click", function () {
        saveManagerToken(winState, tokenStatusEl);
    });
    tokenClearBtn.addEventListener("click", function () {
        winState.tokenInputEl.value = "";
        saveManagerToken(winState, tokenStatusEl);
    });
    searchEl.addEventListener("input", function () {
        renderVersionList(winState);
        updateChangeButton(winState);
    });
    searchEl.addEventListener("keydown", function (event) {
        if (event.key === "ArrowDown") {
            event.preventDefault();
            moveSelection(winState, 1);
        } else if (event.key === "ArrowUp") {
            event.preventDefault();
            moveSelection(winState, -1);
        } else if (event.key === "Enter") {
            event.preventDefault();
            updateChangeButton(winState);
        }
    });

    updateModal.show(body);

    fetchManagerStatus(winState);
    fetchTokenStatus(winState);
}

async function fetchManagerStatus(winState) {
    if (!winState) return;
    try {
        var response = await api.fetchApi("/xz3r0/xcontrolpanel/update/status");
        var payload = {};
        try {
            payload = await response.json();
        } catch (_error) {
            payload = {};
        }
        if (!response.ok || payload.status !== "success" || !payload.data) return;
        var data = payload.data;
        winState.supported = !!data.supported;
        winState.currentVersion = data.current_version || "";
        winState.dirty = !!data.dirty;
        winState.currentVersionEl.textContent =
            displayVersion(winState.currentVersion);
        if (!winState.supported) {
            winState.changeButton.style.display = "none";
            setUpdateStatus(winState,
                tk("manager.unsupported",
                    "This ComfyUI was not installed with git, so switching is unavailable."),
                "error");
        }
        if (data.versions && data.versions.length > 0 && winState.versions.length === 0) {
            winState.versions = data.versions;
        }
        renderVersionList(winState);
        updateChangeButton(winState);
    } catch (_error) { /* ignore */ }
}

var floatToastTimer = null;

function showFloatToast(state, message, kind) {
    if (!state || !state.floatToastEl) return;
    if (floatToastTimer) {
        clearTimeout(floatToastTimer);
        floatToastTimer = null;
    }
    state.floatToastEl.textContent = message || "";
    state.floatToastEl.classList.remove("is-error", "is-success", "is-warn");
    if (kind === "error") {
        state.floatToastEl.classList.add("is-error");
    } else if (kind === "success") {
        state.floatToastEl.classList.add("is-success");
    } else if (kind === "warn") {
        state.floatToastEl.classList.add("is-warn");
    }
    state.floatToastEl.classList.add("is-visible");
    floatToastTimer = setTimeout(function () {
        if (state.floatToastEl) {
            state.floatToastEl.classList.remove("is-visible");
        }
        floatToastTimer = null;
    }, 2600);
}

function toggleTokenForm(winState) {
    if (!winState) return;
    var hidden = winState.tokenFormEl.style.display === "none";
    winState.tokenFormEl.style.display = hidden ? "" : "none";
    if (hidden) {
        fetchTokenStatus(winState);
    }
}

// ---------------------------------------------------------------- 令牌配置（共享 UI）
function createTokenModeSelect() {
    var select = document.createElement("select");
    select.className = "xcontrolpanel-token-mode";
    var optDirect = document.createElement("option");
    optDirect.value = "token";
    optDirect.textContent = tk("token.mode_direct", "Direct token");
    var optEnv = document.createElement("option");
    optEnv.value = "env_var";
    optEnv.textContent = tk(
        "token.mode_env_var",
        "Use an environment variable"
    );
    select.appendChild(optDirect);
    select.appendChild(optEnv);
    return select;
}

function updateTokenModeUi(state) {
    if (!state || !state.tokenInputEl || !state.tokenModeEl) return;
    var isEnv = state.tokenModeEl.value === "env_var";
    state.tokenInputEl.type = isEnv ? "text" : "password";
    state.tokenInputEl.placeholder = isEnv
        ? tk(
            "token.env_var_placeholder",
            "Environment variable name, e.g. MY_GITHUB_TOKEN"
        )
        : tk("token.placeholder", "Paste token here");
    if (state.tokenHelpEl) {
        state.tokenHelpEl.textContent = isEnv
            ? tk(
                "token.env_var_help",
                "The token itself lives in a system environment variable; "
                + "only the name is saved here. How to create one: "
                + "Windows: System Properties → Environment Variables "
                + "(or run setx NAME \"token\" in a terminal, then open "
                + "a new terminal). macOS/Linux: add export NAME=token to "
                + "~/.bashrc or ~/.zshrc. Restart ComfyUI after setting it."
            )
            : tk(
                "token.direct_help",
                "The token is stored in a local settings file readable "
                + "only by you. Do not sync the XDataSaved folder to "
                + "cloud drives."
            );
        state.tokenHelpEl.style.display = "";
    }
}

function applyTokenStatus(state, payload) {
    if (!state || !payload) return;
    var source = payload.source || "none";
    var envVar = payload.env_var || "";
    if (source === "env") {
        state.tokenModeEl.value = "env_var";
        state.tokenInputEl.value = envVar;
        state.tokenStatusEl.textContent = tk(
            "token.status_env",
            "Using the {name} environment variable."
        ).replace("{name}", envVar);
    } else if (source === "unset_env") {
        state.tokenModeEl.value = "env_var";
        state.tokenInputEl.value = envVar;
        state.tokenStatusEl.textContent = tk(
            "token.status_unset_env",
            "Saved environment variable name {name}, but it has no value "
            + "here yet. Create the variable and restart ComfyUI."
        ).replace("{name}", envVar);
    } else if (source === "file") {
        state.tokenModeEl.value = "token";
        state.tokenInputEl.value = "";
        state.tokenStatusEl.textContent = tk(
            "token.status_file",
            "A saved token is in use."
        );
    } else {
        state.tokenModeEl.value = "token";
        state.tokenInputEl.value = "";
        state.tokenStatusEl.textContent = tk(
            "token.none",
            "No token configured."
        );
    }
    updateTokenModeUi(state);
}

function buildTokenPayload(mode, value) {
    return mode === "env_var"
        ? JSON.stringify({
            mode: "env_var",
            env_var: String(value || "").trim(),
        })
        : JSON.stringify({
            mode: "token",
            token: String(value || "").trim(),
        });
}

async function fetchTokenStatus(winState) {
    if (!winState || !winState.tokenStatusEl) return;
    try {
        var response = await api.fetchApi("/xz3r0/xcontrolpanel/update/token");
        var payload = {};
        try {
            payload = await response.json();
        } catch (_error) {
            payload = {};
        }
        applyTokenStatus(winState, payload);
    } catch (_error) { /* ignore */ }
}

async function saveManagerToken(winState, statusEl) {
    try {
        var mode = winState.tokenModeEl ? winState.tokenModeEl.value : "token";
        var response = await api.fetchApi("/xz3r0/xcontrolpanel/update/token", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: buildTokenPayload(mode, winState.tokenInputEl.value),
        });
        var payload = {};
        try {
            payload = await response.json();
        } catch (_error) {
            payload = {};
        }
        if (!response.ok || payload.status !== "success") {
            var msg = (payload && payload.message)
                || tk("err.token_save", "Failed to save the token.");
            statusEl.textContent = msg;
            toast(msg, "error");
            return;
        }
        var okMsg = mode === "env_var"
            ? tk("token.saved_env_var", "Environment variable name saved.")
            : (payload.configured
                ? tk("token.saved", "Token saved.")
                : tk("token.cleared", "Token cleared."));
        statusEl.textContent = okMsg;
        toast(okMsg, "success");
        winState.tokenInputEl.value = "";
        updateTokenModeUi(winState);
    } catch (error) {
        var detail = (error && error.message)
            || tk("err.token_save", "Failed to save the token.");
        statusEl.textContent = detail;
        toast(detail, "error");
    }
}

// ---------------------------------------------------------------- 令牌配置
async function showTokenDialog(state) {
    ensureUpdateModal();
    updateModalStage = "token";

    var body = document.createElement("div");
    body.className = "xcontrolpanel-dialog-body";
    body.appendChild(el("div", "xcontrolpanel-dialog-title",
        tk("token.title", "GitHub token")));
    body.appendChild(el("div", "xcontrolpanel-dialog-text",
        tk("token.hint",
            "A token raises the GitHub request limit from 60 to 5000 per hour. "
            + "Create one at github.com → Settings → Developer settings → Personal access tokens.")));

    var statusEl = el("div", "xcontrolpanel-dialog-text", "");
    body.appendChild(statusEl);

    var modeEl = createTokenModeSelect();
    body.appendChild(modeEl);

    var inputEl = document.createElement("input");
    inputEl.className = "xcontrolpanel-token-input";
    inputEl.type = "password";
    inputEl.placeholder = tk("token.placeholder", "Paste token here");
    body.appendChild(inputEl);

    var helpEl = el("div", "xcontrolpanel-dialog-text", "");
    body.appendChild(helpEl);

    var dialogState = {
        tokenModeEl: modeEl,
        tokenInputEl: inputEl,
        tokenHelpEl: helpEl,
        tokenStatusEl: statusEl,
    };
    modeEl.addEventListener("change", function () {
        updateTokenModeUi(dialogState);
    });

    try {
        var res = await api.fetchApi("/xz3r0/xcontrolpanel/update/token");
        var payload = {};
        try {
            payload = await res.json();
        } catch (_error) {
            payload = {};
        }
        applyTokenStatus(dialogState, payload);
    } catch (_error) { /* ignore */ }

    var cancelBtn = el("button", "xcontrolpanel-button",
        tk("btn.cancel", "Cancel"));
    var saveBtn = el("button", "xcontrolpanel-button",
        tk("token.save", "Save"));
    var clearBtn = el("button", "xcontrolpanel-button",
        tk("token.clear", "Clear"));
    cancelBtn.type = "button";
    saveBtn.type = "button";
    clearBtn.type = "button";

    cancelBtn.addEventListener("click", function () {
        closeUpdateModal();
    });
    saveBtn.addEventListener("click", function () {
        saveTokenFromDialog(modeEl, inputEl, body, statusEl);
    });
    clearBtn.addEventListener("click", function () {
        inputEl.value = "";
        saveTokenFromDialog(modeEl, inputEl, body, statusEl);
    });

    setDialogButtons(updateModal, [cancelBtn, saveBtn, clearBtn]);
    updateModal.show(body);
}

async function saveTokenFromDialog(modeEl, inputEl, body, statusEl) {
    try {
        var mode = modeEl ? modeEl.value : "token";
        var response = await api.fetchApi("/xz3r0/xcontrolpanel/update/token", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: buildTokenPayload(mode, inputEl.value),
        });
        var payload = {};
        try {
            payload = await response.json();
        } catch (_error) {
            payload = {};
        }
        if (!response.ok || payload.status !== "success") {
            var msg = (payload && payload.message)
                || tk("err.token_save", "Failed to save the token.");
            statusEl.textContent = msg;
            toast(msg, "error");
            return;
        }
        var okMsg = mode === "env_var"
            ? tk("token.saved_env_var", "Environment variable name saved.")
            : (payload.configured
                ? tk("token.saved", "Token saved.")
                : tk("token.cleared", "Token cleared."));
        statusEl.textContent = okMsg;
        toast(okMsg, "success");
        if (body && body.parentNode) body.remove();
        closeUpdateModal();
    } catch (error) {
        var detail = (error && error.message)
            || tk("err.token_save", "Failed to save the token.");
        statusEl.textContent = detail;
        toast(detail, "error");
    }
}

// ---------------------------------------------------------------- 更新弹窗与轮询
function ensureUpdateModal() {
    if (updateModal) return;
    updateModal = new ComfyDialog("div", []);
}

function setDialogButtons(dialog, buttons) {
    if (!dialog || !dialog.element) return;
    var content = dialog.element.querySelector(".comfy-modal-content");
    if (!content) return;
    var old = content.querySelectorAll("button");
    for (var i = 0; i < old.length; i++) {
        old[i].remove();
    }
    var wrap = el("div", "xcontrolpanel-dialog-buttons");
    for (var j = 0; j < buttons.length; j++) {
        wrap.appendChild(buttons[j]);
    }
    content.appendChild(wrap);
}

function closeUpdateModal() {
    if (updateModal) updateModal.close();
    updateModalStage = null;
    updateModalPhaseEl = null;
    uninstallUpdateBlocking();
    stopUpdatePolling();
}

function showUpdateConfirm(state) {
    return new Promise(function (resolve) {
        ensureUpdateModal();
        updateModalStage = "confirm";
        var body = document.createElement("div");
        body.className = "xcontrolpanel-dialog-body";
        body.appendChild(el("div", "xcontrolpanel-dialog-title",
            tk("confirm.update_title", "Switch ComfyUI version")));
        body.appendChild(el("div", "xcontrolpanel-dialog-text",
            tk("confirm.body", "Switch ComfyUI to {tag} now?")
                .replace("{tag}", state.selectedTag || "")));
        if (state.dirty) {
            body.appendChild(el("div", "xcontrolpanel-dialog-warning",
                tk("confirm.dirty",
                    "⚠ Uncommitted changes detected. Switching will overwrite them.")));
        }
        body.appendChild(el("div", "xcontrolpanel-dialog-text",
            tk("confirm.running", "Running tasks may be interrupted.")));

        var cancelBtn = el("button", "xcontrolpanel-button",
            tk("btn.cancel", "Cancel"));
        var proceedBtn = el("button", "xcontrolpanel-button",
            tk("btn.proceed", "Continue"));
        cancelBtn.type = "button";
        proceedBtn.type = "button";
        cancelBtn.addEventListener("click", function () {
            closeUpdateModal();
            resolve(false);
        });
        proceedBtn.addEventListener("click", function () {
            resolve(true);
        });
        setDialogButtons(updateModal, [cancelBtn, proceedBtn]);
        updateModal.show(body);
    });
}

function openUpdateProgress() {
    ensureUpdateModal();
    updateModalStage = "progress";
    var body = document.createElement("div");
    body.className = "xcontrolpanel-dialog-body";
    body.appendChild(el("div", "xcontrolpanel-dialog-title",
        tk("progress.title", "Updating ComfyUI")));
    updateModalPhaseEl = el("div", "xcontrolpanel-dialog-text",
        tk("progress.fetching", "Getting update info…"));
    body.appendChild(updateModalPhaseEl);
    setDialogButtons(updateModal, []);
    updateModal.show(body);
    installUpdateBlocking();
}

function renderUpdateProgress(update) {
    if (!update) return;
    if (!update.active) {
        if (update.phase === "done") {
            showUpdateComplete(update.target_tag, update.error_kind);
        } else if (update.phase === "error") {
            showUpdateError(update.error
                || tk("err.update_failed", "Update failed."),
                update.error_kind);
        }
        return;
    }
    if (updateModalStage !== "progress" || !updateModalPhaseEl) return;
    var phaseText = tk("progress.fetching", "Getting update info…");
    if (update.phase === "preparing") {
        phaseText = tk("progress.preparing", "Switching to the target version…");
    } else if (update.phase === "installing") {
        phaseText = tk("progress.installing", "Installing dependencies…");
    }
    updateModalPhaseEl.textContent = phaseText;
}

function showUpdateComplete(tag, errorKind) {
    uninstallUpdateBlocking();
    stopUpdatePolling();
    updateModalStage = "done";
    var body = document.createElement("div");
    body.className = "xcontrolpanel-dialog-body";
    body.appendChild(el("div", "xcontrolpanel-dialog-title",
        tk("done.title", "Update complete")));
    if (errorKind === "pending_restart") {
        body.appendChild(el("div", "xcontrolpanel-dialog-text",
            tk("done.body_pending",
                "Code switched to {tag}. Dependencies will finish installing after you restart ComfyUI.")
                .replace("{tag}", tag || "?")));
    } else {
        body.appendChild(el("div", "xcontrolpanel-dialog-text",
            tk("done.body", "ComfyUI is now on {tag}. Restart ComfyUI to apply.")
                .replace("{tag}", tag || "?")));
    }
    var restartBtn = el("button", "xcontrolpanel-button",
        tk("done.restart", "Restart ComfyUI"));
    restartBtn.type = "button";
    restartBtn.addEventListener("click", function () {
        var source = updateSourceState;
        closeUpdateModal();
        if (source) {
            setUpdateBusy(source, false);
            syncUpdateStatus(source);
            var panel = (source && source.nodeState) ? source.nodeState : source;
            runRestart(panel);
        }
    });
    setDialogButtons(updateModal, [restartBtn]);
    updateModal.show(body);
    if (updateSourceState) {
        setUpdateStatus(updateSourceState,
            tk("status.updated", "Update complete. Restart ComfyUI to apply."), "success");
        toast(tk("status.updated", "Update complete. Restart ComfyUI to apply."), "success");
        syncUpdateStatus(updateSourceState);
    }
}

function showUpdateError(message, errorKind) {
    uninstallUpdateBlocking();
    stopUpdatePolling();
    updateModalStage = "error";
    var body = document.createElement("div");
    body.className = "xcontrolpanel-dialog-body";
    body.appendChild(el("div", "xcontrolpanel-dialog-title",
        tk("error.title", "Update failed")));
    if (errorKind === "file_locked") {
        body.appendChild(el(
            "div", "xcontrolpanel-dialog-warning",
            tk("err.file_locked",
                "Windows is blocking some dependency files because the running ComfyUI has loaded them. Restart ComfyUI and try the update again.")));
    }
    body.appendChild(el("div", "xcontrolpanel-dialog-error", message || ""));
    body.appendChild(el("div", "xcontrolpanel-dialog-text",
        tk("error.hint", "You can pick a previous version and try again.")));
    var okBtn = el("button", "xcontrolpanel-button",
        tk("btn.ok", "OK"));
    okBtn.type = "button";
    okBtn.addEventListener("click", function () {
        var source = updateSourceState;
        closeUpdateModal();
        if (source) {
            setUpdateBusy(source, false);
            syncUpdateStatus(source);
        }
    });
    setDialogButtons(updateModal, [okBtn]);
    updateModal.show(body);
    if (updateSourceState) {
        setUpdateStatus(updateSourceState, tk("status.update_failed", "Update failed."), "error");
    }
}

async function runUpdate(state) {
    if (!state || state.isUpdateBusy || state.isBusy || !state.selectedTag) return;
    var confirmed = await showUpdateConfirm(state);
    if (!confirmed) return;

    updateSourceState = state;
    setUpdateBusy(state, true);
    setUpdateStatus(state, tk("status.updating", "Update in progress…"), "");
    openUpdateProgress();

    try {
        var response = await api.fetchApi("/xz3r0/xcontrolpanel/update/start", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ tag: state.selectedTag }),
        });
        var payload = {};
        try {
            payload = await response.json();
        } catch (_error) {
            payload = {};
        }
        if (!response.ok || payload.status !== "success") {
            var message = updateStartErrorMessage(payload);
            setUpdateStatus(state, tk("status.update_failed", "Update failed."), "error");
            toast(message, "error");
            showUpdateError(message);
            return;
        }
        toast(tk("status.updating", "Update in progress…"), "info");
        startUpdatePolling();
    } catch (error) {
        var detail = (error && error.message)
            || tk("err.server", "Cannot reach the server.");
        setUpdateStatus(state, tk("status.update_failed", "Update failed."), "error");
        toast(detail, "error");
        showUpdateError(detail);
    }
}

// ---------------------------------------------------------------- 键盘拦截与轮询

function installUpdateBlocking() {
    if (updateKeyboardHandler) return;
    updateKeyboardHandler = function (event) {
        var key = String(event.key || "").toLowerCase();
        var blocked = key === "f5"
            || key === "f11"
            || ((event.ctrlKey || event.metaKey) && key === "r")
            || ((event.ctrlKey || event.metaKey) && key === "w")
            || ((event.ctrlKey || event.metaKey) && key === "s")
            || ((event.ctrlKey || event.metaKey) && event.shiftKey && key === "i")
            || ((event.altKey || event.metaKey)
                && (key === "arrowleft" || key === "arrowright"));
        if (blocked) {
            event.preventDefault();
            event.stopPropagation();
        }
    };
    window.addEventListener("keydown", updateKeyboardHandler, true);
    updateBeforeUnloadHandler = function (event) {
        event.preventDefault();
        event.returnValue = "";
    };
    window.addEventListener("beforeunload", updateBeforeUnloadHandler);
}

function uninstallUpdateBlocking() {
    if (updateKeyboardHandler) {
        window.removeEventListener("keydown", updateKeyboardHandler, true);
        updateKeyboardHandler = null;
    }
    if (updateBeforeUnloadHandler) {
        window.removeEventListener("beforeunload", updateBeforeUnloadHandler);
        updateBeforeUnloadHandler = null;
    }
}

function startUpdatePolling() {
    if (updatePollTimer) return;
    updatePollTimer = setInterval(pollUpdateStatus, UPDATE_POLL_INTERVAL_MS);
}

function stopUpdatePolling() {
    if (updatePollTimer) {
        clearInterval(updatePollTimer);
        updatePollTimer = null;
    }
}

async function pollUpdateStatus() {
    try {
        var response = await api.fetchApi("/xz3r0/xcontrolpanel/update/status");
        var payload = {};
        try {
            payload = await response.json();
        } catch (_error) {
            payload = {};
        }
        var data = payload && payload.data;
        if (!data || !data.update) return;
        renderUpdateProgress(data.update);
    } catch (_error) {
        // 瞬时网络错误：保持轮询，下轮再试
    }
}

function isInsideVersionList(target) {
    var node = target;
    while (node) {
        if (node.classList && node.classList.contains("xcontrolpanel-version-list")) {
            return true;
        }
        node = node.parentNode;
    }
    return false;
}

function bindCanvasForwarding(panel) {
    if (!panel) return;

    panel.addEventListener("wheel", function (event) {
        // 版本列表是可滚动区域：列表内的滚轮只滚动列表，不转发给画布
        if (isInsideVersionList(event.target)) {
            return;
        }
        if (String(event.target && event.target.tagName || "")
            .toUpperCase() === "BUTTON") {
            event.preventDefault();
        }
        var graphCanvas = app.canvas && app.canvas.canvas;
        if (!graphCanvas) return;
        graphCanvas.dispatchEvent(new WheelEvent("wheel", {
            deltaX: event.deltaX,
            deltaY: event.deltaY,
            deltaZ: event.deltaZ,
            clientX: event.clientX,
            clientY: event.clientY,
            screenX: event.screenX,
            screenY: event.screenY,
            ctrlKey: event.ctrlKey,
            altKey: event.altKey,
            shiftKey: event.shiftKey,
            metaKey: event.metaKey,
            bubbles: true,
            cancelable: true,
        }));
    });

    panel.addEventListener("pointerdown", function (event) {
        if (event.button !== 1) return;
        event.preventDefault();
        var canvas = app.canvas;
        if (!canvas || typeof canvas.processMouseDown !== "function") return;
        canvas.processMouseDown(event);
    });
    panel.addEventListener("pointermove", function (event) {
        if ((event.buttons & 4) !== 4) return;
        var canvas = app.canvas;
        if (!canvas || typeof canvas.processMouseMove !== "function") return;
        canvas.processMouseMove(event);
    });
    panel.addEventListener("pointerup", function (event) {
        if (event.button !== 1) return;
        var canvas = app.canvas;
        if (!canvas || typeof canvas.processMouseUp !== "function") return;
        canvas.processMouseUp(event);
    });
}

function clampNodeSize(node) {
    if (!node) return;

    var minWidth = MIN_NODE_W;
    var minHeight = MIN_NODE_H;
    if (typeof node.computeSize === "function") {
        var computed = node.computeSize();
        if (Array.isArray(computed) && computed.length >= 2) {
            minWidth = Math.max(minWidth, computed[0] || 0);
            minHeight = Math.max(minHeight, computed[1] || 0);
        }
    }

    node.min_size = [minWidth, minHeight];
    if (typeof node.setSize === "function") {
        var width = Math.max((node.size && node.size[0]) || 0, minWidth);
        var height = Math.max((node.size && node.size[1]) || 0, minHeight);
        node.setSize([width, height]);
    }

    if (node.__xcontrolpanel_resize_guard) return;
    node.__xcontrolpanel_resize_guard = true;

    var origOnResize = node.onResize;
    node.onResize = function (size) {
        var resizeMinWidth = MIN_NODE_W;
        var resizeMinHeight = MIN_NODE_H;
        if (typeof this.computeSize === "function") {
            var resizeComputed = this.computeSize();
            if (Array.isArray(resizeComputed) && resizeComputed.length >= 2) {
                resizeMinWidth = Math.max(resizeMinWidth, resizeComputed[0] || 0);
                resizeMinHeight = Math.max(resizeMinHeight, resizeComputed[1] || 0);
            }
        }
        this.min_size = [resizeMinWidth, resizeMinHeight];
        var srcSize = Array.isArray(size) ? size : this.size;
        var nextWidth = Math.max((srcSize && srcSize[0]) || 0, resizeMinWidth);
        var nextHeight = Math.max((srcSize && srcSize[1]) || 0, resizeMinHeight);
        this.size = [nextWidth, nextHeight];
        this.setDirtyCanvas && this.setDirtyCanvas(true, true);
        if (typeof origOnResize === "function") {
            origOnResize.apply(this, arguments);
        }
    };
}

function createControlPanelUI(node) {
    if (!node || node.__xcontrolpanelState) return;

    ensureStyles();

    var wrap = document.createElement("div");
    wrap.className = "xcontrolpanel-wrap";

    // 功能一：重启 ComfyUI
    var fieldset = document.createElement("fieldset");
    fieldset.className = "xcontrolpanel-fieldset";

    var title = document.createElement("legend");
    title.className = "xcontrolpanel-title";
    title.textContent = tk("title", "Restart ComfyUI");
    fieldset.appendChild(title);

    var subtitle = document.createElement("div");
    subtitle.className = "xcontrolpanel-subtitle";
    subtitle.textContent = tk(
        "subtitle",
        "Restart the ComfyUI server process. Refresh the browser after it comes back."
    );
    fieldset.appendChild(subtitle);

    var restartButton = document.createElement("button");
    restartButton.className = "xcontrolpanel-button xcontrolpanel-button-icon";
    restartButton.type = "button";
    var restartIconEl = el("span", "xcontrolpanel-btn-icon", "");
    restartIconEl.innerHTML = ICON_RESTART;
    restartButton.appendChild(restartIconEl);
    var restartLabelEl = el("span", "xcontrolpanel-btn-label",
        tk("btn.restart", "Restart ComfyUI"));
    restartButton.appendChild(restartLabelEl);
    fieldset.appendChild(restartButton);

    var statusEl = document.createElement("div");
    statusEl.className = "xcontrolpanel-status";
    statusEl.textContent = tk("status.idle", "Idle");
    fieldset.appendChild(statusEl);

    wrap.appendChild(fieldset);

    // 功能二：更换 ComfyUI 版本（入口按钮，详细功能在弹窗中）
    var updateFieldset = document.createElement("fieldset");
    updateFieldset.className = "xcontrolpanel-fieldset xcontrolpanel-update-fieldset";

    var titleUpdateEl = document.createElement("legend");
    titleUpdateEl.className = "xcontrolpanel-title";
    titleUpdateEl.textContent = tk("title.update", "Switch ComfyUI version");
    updateFieldset.appendChild(titleUpdateEl);

    var subtitleUpdateEl = document.createElement("div");
    subtitleUpdateEl.className = "xcontrolpanel-subtitle";
    subtitleUpdateEl.textContent = tk(
        "subtitle.update",
        "See the current ComfyUI version and switch to any official version."
    );
    updateFieldset.appendChild(subtitleUpdateEl);

    var openManagerButton = document.createElement("button");
    openManagerButton.className = "xcontrolpanel-button xcontrolpanel-button-icon";
    openManagerButton.type = "button";
    var openManagerIconEl = el("span", "xcontrolpanel-btn-icon", "");
    openManagerIconEl.innerHTML = ICON_SWITCH;
    openManagerButton.appendChild(openManagerIconEl);
    var openManagerLabelEl = el("span", "xcontrolpanel-btn-label",
        tk("btn.open_manager", "Switch ComfyUI version"));
    openManagerButton.appendChild(openManagerLabelEl);
    updateFieldset.appendChild(openManagerButton);

    wrap.appendChild(updateFieldset);
    var state = {
        node: node,
        wrap: wrap,
        titleEl: title,
        subtitleEl: subtitle,
        titleUpdateEl: titleUpdateEl,
        subtitleUpdateEl: subtitleUpdateEl,
        openManagerButton: openManagerButton,
        openManagerLabelEl: openManagerLabelEl,
        restartButton: restartButton,
        restartLabelEl: restartLabelEl,
        statusEl: statusEl,
        isBusy: false,
        hasStatus: false,
    };
    node.__xcontrolpanelState = state;
    controlPanelStates[String(node.id)] = state;

    restartButton.addEventListener("click", function () {
        runRestart(state);
    });

    openManagerButton.addEventListener("click", function () {
        openVersionManagerWindow(state);
    });

    if (typeof node.addDOMWidget === "function") {
        node.addDOMWidget(WIDGET_NAME, "custom", wrap, {
            serialize: false,
        });
    }

    bindCanvasForwarding(wrap);
    applyPanelLocale(state);
    clampNodeSize(node);
}

app.registerExtension({
    name: EXT_NAME,

    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (String(nodeData.name) !== NODE_CLASS) return;

        var origOnCreated = nodeType.prototype.onNodeCreated;
        var origOnConfigure = nodeType.prototype.onConfigure;

        nodeType.prototype.onNodeCreated = function () {
            origOnCreated && origOnCreated.apply(this, arguments);
            createControlPanelUI(this);
            clampNodeSize(this);
        };

        nodeType.prototype.onConfigure = function () {
            origOnConfigure && origOnConfigure.apply(this, arguments);
            createControlPanelUI(this);
            clampNodeSize(this);
        };
    },

    async loadedGraphNode(node) {
        if (String(node.comfyClass || node.type || "") !== NODE_CLASS) return;
        createControlPanelUI(node);
        clampNodeSize(node);
    },

    async setup() {
        await applyUiLocale();
        installLocaleSync();
    },
});
