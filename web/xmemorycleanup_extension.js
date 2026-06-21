import { api } from "../../scripts/api.js";
import { app } from "../../scripts/app.js";

var EXT_NAME = "ComfyUI.Xz3r0.XMemoryCleanup";
var NODE_CLASS = "XMemoryCleanup";
var WIDGET_NAME = "xmemorycleanup_actions";
var LOCALE_PREFIX = "xdatahub.ui.node.xmemorycleanup";
var COMFY_LOCALE_KEY = "Comfy.Locale";
var LOCALE_SYNC_INTERVAL = 1000;
var MIN_NODE_W = 380;
var MIN_NODE_H = 360;
var PANEL_WIDGET_H = 312;
var STYLE_ID = "xmemorycleanup-styles";
var ACTION_MODELS = "models";
var ACTION_EXECUTION_CACHE = "execution_cache";
var ACTION_MODELS_AND_EXECUTION_CACHE = "models_and_execution_cache";
var uiLocalePrimary = null;
var uiLocaleFallback = null;
var i18nCache = {};
var localeSyncInstalled = false;
var currentUiLocale = null;
var cleanupStates = {};

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

function formatText(template, values) {
    var text = String(template || "");
    var data = values || {};
    return text.replace(/\{([a-zA-Z0-9_]+)\}/g, function (_match, key) {
        return data[key] !== undefined ? String(data[key]) : "";
    });
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
            currentUiLocale = normalized;
            return normalized;
        });
}

function refreshAllPanelLocales() {
    for (var nodeId in cleanupStates) {
        if (Object.prototype.hasOwnProperty.call(cleanupStates, nodeId)) {
            applyPanelLocale(cleanupStates[nodeId]);
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
        ".xmemorycleanup-wrap {",
        "  position: relative;",
        "  width: 100%; height: 100%;",
        "  display: flex;",
        "  flex-direction: column;",
        "  gap: 8px;",
        "  padding: 10px;",
        "  box-sizing: border-box;",
        "  border: 1px solid var(--xdh-clr-hairline, #333);",
        "  background: var(--comfy-menu-bg, #1a1a1a);",
        "  overflow: hidden;",
        "}",
        ".xmemorycleanup-title {",
        "  font: var(--xdh-font-ui-md, 12px sans-serif);",
        "  color: var(--input-text, #ddd);",
        "  font-weight: 600;",
        "  line-height: 1.3;",
        "}",
        ".xmemorycleanup-subtitle {",
        "  font: var(--xdh-font-caption-sm, 11px sans-serif);",
        "  color: var(--descrip-text, #999);",
        "  line-height: 1.4;",
        "}",
        ".xmemorycleanup-actions {",
        "  display: flex;",
        "  flex-direction: column;",
        "  gap: 8px;",
        "  flex: 1 1 auto;",
        "}",
        ".xmemorycleanup-button {",
        "  min-height: 36px;",
        "  padding: 8px 10px;",
        "  border: 1px solid var(--border-color, #555);",
        "  border-radius: 6px;",
        "  background: var(--comfy-menu-secondary-bg, #2a2a2a);",
        "  color: var(--input-text, #ddd);",
        "  font: var(--xdh-font-micro-label, 11px sans-serif);",
        "  text-align: center;",
        "  white-space: nowrap;",
        "  overflow: hidden;",
        "  text-overflow: ellipsis;",
        "  cursor: pointer;",
        "  transition: border-color 120ms ease, background-color 120ms ease;",
        "}",
        ".xmemorycleanup-button:hover:enabled {",
        "  border-color: var(--primary-color, #ff385c);",
        "}",
        ".xmemorycleanup-button:disabled {",
        "  opacity: 0.65;",
        "  cursor: progress;",
        "}",
        ".xmemorycleanup-status {",
        "  min-height: 32px;",
        "  font: var(--xdh-font-caption-sm, 10px sans-serif);",
        "  color: var(--descrip-text, #999);",
        "  line-height: 1.4;",
        "  white-space: normal;",
        "}",
        ".xmemorycleanup-status.is-error {",
        "  color: var(--error-text, #ff8c8c);",
        "}",
        ".xmemorycleanup-status.is-success {",
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

function getActionSuccessMessage(action, payload) {
    var models = Number(payload && payload.models_cleared) || 0;
    var entries = Number(
        payload && payload.execution_cache_entries_cleared
    ) || 0;

    if (action === ACTION_MODELS) {
        return formatText(
            tk("status.models_done", "Cleared {models} loaded models."),
            { models: models }
        );
    }
    if (action === ACTION_EXECUTION_CACHE) {
        return formatText(
            tk(
                "status.execution_cache_done",
                "Cleared {entries} workflow node result cache entries."
            ),
            { entries: entries }
        );
    }
    if (action === ACTION_MODELS_AND_EXECUTION_CACHE) {
        return formatText(
            tk(
                "status.models_and_execution_cache_done",
                "Cleared {models} loaded models and {entries} workflow node result cache entries."
            ),
            { models: models, entries: entries }
        );
    }
    return tk("status.done", "Cleanup completed");
}

function applyPanelLocale(state) {
    if (!state) return;
    if (state.titleEl) {
        state.titleEl.textContent = tk("title", "Manual Quick Cleanup");
    }
    if (state.subtitleEl) {
        state.subtitleEl.textContent = tk(
            "subtitle",
            "Use these buttons manually when you want to free resources without running the workflow."
        );
    }
    var specs = getButtonSpecs();
    if (Array.isArray(state.buttons)) {
        for (var i = 0; i < state.buttons.length; i++) {
            var button = state.buttons[i];
            var spec = specs[i];
            if (!button || !spec) continue;
            button.dataset.label = spec.label;
            button.dataset.busyLabel = spec.busyLabel;
            button.title = spec.tooltip;
            if (!state.isBusy) {
                button.textContent = spec.label;
            }
        }
    }
    if (!state.lastStatusKey && state.statusEl) {
        state.statusEl.textContent = tk("status.idle", "Idle");
    }
}

function setBusy(state, busy, activeButton) {
    state.isBusy = !!busy;
    if (!Array.isArray(state.buttons)) return;
    for (var i = 0; i < state.buttons.length; i++) {
        var button = state.buttons[i];
        button.disabled = !!busy;
        if (busy && button === activeButton) {
            button.textContent = button.dataset.busyLabel || button.textContent;
        } else {
            button.textContent = button.dataset.label || button.textContent;
        }
    }
}

async function runCleanupAction(state, action, button) {
    if (!state || state.isBusy) return;

    setBusy(state, true, button);
    setStatus(state, tk("status.running", "Running cleanup..."), "");

    try {
        var response = await api.fetchApi("/xz3r0/xmemorycleanup/action", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ action: action }),
        });

        var payload = {};
        try {
            payload = await response.json();
        } catch (_error) {
            payload = {};
        }

        if (!response.ok || payload.status !== "success") {
            var message = payload.message ||
                tk("status.request_failed", "Cleanup request failed");
            setStatus(state, message, "error");
            app.extensionManager.toast.add({
                severity: "error",
                summary: "XMemoryCleanup",
                detail: message,
                life: 4000,
            });
            return;
        }

        var successMessage = getActionSuccessMessage(action, payload);
        setStatus(state, successMessage, "success");
        app.extensionManager.toast.add({
            severity: "success",
            summary: "XMemoryCleanup",
            detail: successMessage,
            life: 3000,
        });
    } catch (error) {
        var detail = error && error.message ?
            error.message :
            tk("status.request_failed", "Cleanup request failed");
        setStatus(state, detail, "error");
        app.extensionManager.toast.add({
            severity: "error",
            summary: "XMemoryCleanup",
            detail: detail,
            life: 4000,
        });
    } finally {
        setBusy(state, false, null);
    }
}

function getButtonSpecs() {
    return [
        {
            action: ACTION_MODELS,
            label: tk("btn.models", "Clear All Models"),
            busyLabel: tk("btn.models_busy", "Clearing All Models..."),
            tooltip: tk(
                "tip.models",
                "Unload all models that are currently kept ready in memory."
            ),
        },
        {
            action: ACTION_EXECUTION_CACHE,
            label: tk(
                "btn.execution_cache",
                "Clear Workflow Node Result Cache"
            ),
            busyLabel: tk(
                "btn.execution_cache_busy",
                "Clearing Workflow Node Result Cache..."
            ),
            tooltip: tk(
                "tip.execution_cache",
                "Clear node result cache saved after running a workflow. Those nodes may recalculate next time."
            ),
        },
        {
            action: ACTION_MODELS_AND_EXECUTION_CACHE,
            label: tk(
                "btn.models_and_execution_cache",
                "Clear Models + Workflow Node Result Cache"
            ),
            busyLabel: tk(
                "btn.models_and_execution_cache_busy",
                "Clearing Models + Workflow Node Result Cache..."
            ),
            tooltip: tk(
                "tip.models_and_execution_cache",
                "Unload ready models and clear node result cache saved after running a workflow."
            ),
        },
    ];
}

function bindCanvasForwarding(panel) {
    if (!panel) return;

    panel.addEventListener("wheel", function (event) {
        var target = event.target;
        var tag = String(target && target.tagName || "").toUpperCase();
        if (tag === "BUTTON") {
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
    } else if (!node.size || node.size.length < 2) {
        node.size = [minWidth, minHeight];
    } else {
        node.size[0] = Math.max(node.size[0], minWidth);
        node.size[1] = Math.max(node.size[1], minHeight);
    }

    if (node.__xmemorycleanup_resize_guard) return;
    node.__xmemorycleanup_resize_guard = true;

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

function createCleanupUI(node) {
    if (!node || node.__xmemorycleanupState) return;

    ensureStyles();

    var wrap = document.createElement("div");
    wrap.className = "xmemorycleanup-wrap";

    var title = document.createElement("div");
    title.className = "xmemorycleanup-title";
    title.textContent = tk("title", "Manual Quick Cleanup");
    wrap.appendChild(title);

    var subtitle = document.createElement("div");
    subtitle.className = "xmemorycleanup-subtitle";
    subtitle.textContent = tk(
        "subtitle",
        "Use these buttons manually when you want to free resources without running the workflow."
    );
    wrap.appendChild(subtitle);

    var actions = document.createElement("div");
    actions.className = "xmemorycleanup-actions";
    wrap.appendChild(actions);

    var statusEl = document.createElement("div");
    statusEl.className = "xmemorycleanup-status";
    statusEl.textContent = tk("status.idle", "Idle");
    wrap.appendChild(statusEl);

    var state = {
        node: node,
        wrap: wrap,
        titleEl: title,
        subtitleEl: subtitle,
        statusEl: statusEl,
        buttons: [],
        isBusy: false,
    };
    node.__xmemorycleanupState = state;
    cleanupStates[String(node.id)] = state;

    var buttonSpecs = getButtonSpecs();

    for (var i = 0; i < buttonSpecs.length; i++) {
        var spec = buttonSpecs[i];
        var button = document.createElement("button");
        button.className = "xmemorycleanup-button";
        button.type = "button";
        button.textContent = spec.label;
        button.dataset.label = spec.label;
        button.dataset.busyLabel = spec.busyLabel;
        button.title = spec.tooltip;
        button.addEventListener("click", (function (action, btn) {
            return function () {
                runCleanupAction(state, action, btn);
            };
        })(spec.action, button));
        actions.appendChild(button);
        state.buttons.push(button);
    }

    if (typeof node.addDOMWidget === "function") {
        node.addDOMWidget(WIDGET_NAME, "custom", wrap, {
            getMinHeight: function () {
                return PANEL_WIDGET_H;
            },
            margin: 0,
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
            createCleanupUI(this);
            clampNodeSize(this);
        };

        nodeType.prototype.onConfigure = function () {
            origOnConfigure && origOnConfigure.apply(this, arguments);
            createCleanupUI(this);
            clampNodeSize(this);
        };
    },

    async loadedGraphNode(node) {
        if (String(node.comfyClass || node.type || "") !== NODE_CLASS) return;
        createCleanupUI(node);
        clampNodeSize(node);
    },

    async setup() {
        await applyUiLocale();
        installLocaleSync();
    },
});
