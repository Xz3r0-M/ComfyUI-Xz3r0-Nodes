import { api } from "../../scripts/api.js";
import { app } from "../../scripts/app.js";

var EXT_NAME = "ComfyUI.Xz3r0.XControlPanel";
var NODE_CLASS = "XControlPanel";
var WIDGET_NAME = "xcontrolpanel_actions";
var LOCALE_PREFIX = "xdatahub.ui.node.xcontrolpanel";
var COMFY_LOCALE_KEY = "Comfy.Locale";
var LOCALE_SYNC_INTERVAL = 1000;
var MIN_NODE_W = 280;
var MIN_NODE_H = 178;
var STYLE_ID = "xcontrolpanel-styles";
var uiLocalePrimary = null;
var uiLocaleFallback = null;
var i18nCache = {};
var localeSyncInstalled = false;
var controlPanelStates = {};

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
        "  position: absolute;",
        "  top: 0; left: 0; right: 0; bottom: 0;",
        "  display: flex;",
        "  flex-direction: column;",
        "  gap: 8px;",
        "  padding: 10px;",
        "  box-sizing: border-box;",
        "  border: 1px solid var(--xdh-clr-hairline, #333);",
        "  background: var(--comfy-menu-bg, #1a1a1a);",
        "  overflow: hidden;",
        "}",
        ".xcontrolpanel-title {",
        "  font: var(--xdh-font-ui-md, 12px sans-serif);",
        "  color: var(--input-text, #ddd);",
        "  font-weight: 600;",
        "  line-height: 1.3;",
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
    ].join("\n");
    document.head.appendChild(style);
}

function setStatus(state, message, kind) {
    if (!state || !state.statusEl) return;
    state.statusEl.textContent = message || "";
    state.statusEl.classList.remove("is-error", "is-success");
    if (kind === "error") {
        state.statusEl.classList.add("is-error");
    } else if (kind === "success") {
        state.statusEl.classList.add("is-success");
    }
}

function applyPanelLocale(state) {
    if (!state) return;
    if (state.titleEl) {
        state.titleEl.textContent = tk("title", "Control Panel");
    }
    if (state.subtitleEl) {
        state.subtitleEl.textContent = tk(
            "subtitle",
            "Run immediate control actions without queueing the workflow."
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
        if (!state.isBusy) {
            state.restartButton.textContent = state.restartButton.dataset.label;
        }
    }
    if (!state.hasStatus && state.statusEl) {
        state.statusEl.textContent = tk("status.idle", "Idle");
    }
}

function setBusy(state, busy) {
    state.isBusy = !!busy;
    if (!state.restartButton) return;
    state.restartButton.disabled = !!busy;
    state.restartButton.textContent = busy
        ? state.restartButton.dataset.busyLabel
        : state.restartButton.dataset.label;
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
            "status.restart_scheduled",
            "Restart scheduled. Refresh the browser after ComfyUI is back."
        );
        setStatus(state, successMessage, "success");
        app.extensionManager.toast.add({
            severity: "success",
            summary: "XControlPanel",
            detail: successMessage,
            life: 5000,
        });
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

function bindCanvasForwarding(panel) {
    if (!panel) return;

    panel.addEventListener("wheel", function (event) {
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

    node.min_size = [MIN_NODE_W, MIN_NODE_H];
    if (typeof node.setSize === "function") {
        var width = Math.max((node.size && node.size[0]) || 0, MIN_NODE_W);
        var height = Math.max((node.size && node.size[1]) || 0, MIN_NODE_H);
        node.setSize([width, height]);
    }

    if (node.__xcontrolpanel_resize_guard) return;
    node.__xcontrolpanel_resize_guard = true;

    var origOnResize = node.onResize;
    node.onResize = function (size) {
        this.min_size = [MIN_NODE_W, MIN_NODE_H];
        var srcSize = Array.isArray(size) ? size : this.size;
        var nextWidth = Math.max((srcSize && srcSize[0]) || 0, MIN_NODE_W);
        var nextHeight = Math.max((srcSize && srcSize[1]) || 0, MIN_NODE_H);
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

    var title = document.createElement("div");
    title.className = "xcontrolpanel-title";
    title.textContent = tk("title", "Control Panel");
    wrap.appendChild(title);

    var subtitle = document.createElement("div");
    subtitle.className = "xcontrolpanel-subtitle";
    subtitle.textContent = tk(
        "subtitle",
        "Run immediate control actions without queueing the workflow."
    );
    wrap.appendChild(subtitle);

    var restartButton = document.createElement("button");
    restartButton.className = "xcontrolpanel-button";
    restartButton.type = "button";
    restartButton.textContent = tk("btn.restart", "Restart ComfyUI");
    wrap.appendChild(restartButton);

    var statusEl = document.createElement("div");
    statusEl.className = "xcontrolpanel-status";
    statusEl.textContent = tk("status.idle", "Idle");
    wrap.appendChild(statusEl);

    var state = {
        node: node,
        wrap: wrap,
        titleEl: title,
        subtitleEl: subtitle,
        restartButton: restartButton,
        statusEl: statusEl,
        isBusy: false,
        hasStatus: false,
    };
    node.__xcontrolpanelState = state;
    controlPanelStates[String(node.id)] = state;

    restartButton.addEventListener("click", function () {
        runRestart(state);
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
