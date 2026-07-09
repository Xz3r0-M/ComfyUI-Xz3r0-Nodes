/**
 * XSeed — 自定义种子控件扩展
 * =============================
 *
 * 完全自定义的种子 UI，不依赖 ComfyUI 原生 Int/Boolean widget。
 * 仅通过隐藏的 seed_string / last_seed_string (STRING) widget 与 Python 后端通信。
 *
 * 功能：
 * - 种子值文本输入框（手动输入/显示）
 * - 即时生成按钮（基于位数上限逐位随机）
 * - 执行时随机生成开关（通过 beforeQueued 钩子实现）
 * - 上次应用的种子值显示
 * - 复用上次种子值按钮
 */

import { api } from "../../scripts/api.js";
import { app } from "../../scripts/app.js";

var EXT_NAME = "ComfyUI.Xz3r0.XSeed";
var NODE_CLASS = "XSeed";
var DOM_WIDGET_NAME = "xseed_ui";
var WIDGET_SEED = "seed_string";
var WIDGET_LAST_SEED = "last_seed_string";
var WIDGET_DIGITS = "digits";
var WIDGET_RANDOM = "random_on_execute";
var WIDGET_LAST_SEED_LOCKED = "last_seed_locked";
var STYLE_ID = "xseed-ui-styles";
var MIN_NODE_W = 280;
var MIN_NODE_H = 250;
var LOCALE_PREFIX = "xdatahub.ui.node.xseed";
var LOCALE_SYNC_INTERVAL = 1000;
var uiLocalePrimary = null;
var uiLocaleFallback = null;
var i18nCache = {};
var localeSyncInstalled = false;

// ---------------------------------------------------------------------------
// 本地化（参照 XLinker 模式）
// ---------------------------------------------------------------------------

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

function resolveComfyLocale() {
    try {
        var value = app.extensionManager
            && app.extensionManager.setting
            && app.extensionManager.setting.get
            && app.extensionManager.setting.get("Comfy.Locale");
        if (value) return value;
    } catch (_error) { /* fall through */ }
    try {
        var stored = localStorage.getItem("Comfy.Locale");
        if (stored) return stored;
    } catch (_error) { /* fall through */ }
    if (document.documentElement && document.documentElement.lang) {
        return document.documentElement.lang;
    }
    return navigator.language || "en";
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

function applyUiLocale(localeOverride) {
    var locale = localeOverride || resolveComfyLocale();
    var normalized = (
        locale === "zh" || locale === "zh-CN" || locale === "zh-TW"
    ) ? "zh" : "en";
    return Promise.all([fetchI18n("en"), fetchI18n(normalized)])
        .then(function (results) {
            uiLocaleFallback = results[0];
            uiLocalePrimary = normalized === "en" ? results[0] : results[1];
            refreshAllSeedLocales();
        });
}

function refreshAllSeedLocales() {
    var graph = (app.canvas && app.canvas.getCurrentGraph
        && app.canvas.getCurrentGraph())
        || (app.canvas && app.canvas.graph)
        || app.graph;
    var nodes = (graph && (graph._nodes || graph.nodes)) || [];
    for (var i = 0; i < nodes.length; i++) {
        var node = nodes[i];
        if (String(node && (node.comfyClass || node.type || "")) === NODE_CLASS) {
            applySeedLocale(node.__xseedState);
        }
    }
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

function applySeedLocale(state) {
    if (!state) return;
    if (state.labelSeed) {
        state.labelSeed.textContent = tk("label_seed_value", "Seed Value");
    }
    if (state.labelLast) {
        state.labelLast.textContent = tk("label_last_seed", "Last Applied Seed");
    }
    if (state.seedInput) {
        state.seedInput.placeholder = tk("placeholder_seed", "Seed");
    }
    if (state.genBtn) {
        state.genBtn.title = tk("tip_generate", "Generate random seed based on digit limit");
    }
    if (state.randomToggle) {
        state.randomToggle.title = state.randomOnExecute
            ? tk("tip_random_on", "Random on execute: enabled")
            : tk("tip_random_off", "Random on execute: disabled");
    }
    if (state.useLastBtn) {
        state.useLastBtn.textContent = "\u{1F4CB} " + tk("btn_use_last", "Use Last Seed");
        state.useLastBtn.title = tk("tip_use_last", "Copy last applied seed to current seed");
    }
}

// ---------------------------------------------------------------------------
// 工具函数
// ---------------------------------------------------------------------------

function findWidget(node, name) {
    if (!node || !Array.isArray(node.widgets)) return null;
    for (var i = 0; i < node.widgets.length; i++) {
        if (node.widgets[i] && node.widgets[i].name === name) {
            return node.widgets[i];
        }
    }
    return null;
}

function findAsNumber(value, fallback) {
    if (value === undefined || value === null || value === "") return fallback;
    var n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function readDigits(node) {
    var w = findWidget(node, WIDGET_DIGITS);
    if (!w) return 20;
    var v = findAsNumber(w.value, 20);
    if (v < 1) v = 1;
    if (v > 20) v = 20;
    return v;
}

function generateRandomSeed(digits) {
    if (digits <= 1) {
        return String(Math.floor(Math.random() * 10));
    }
    var result = "";
    result += String(Math.floor(Math.random() * 9) + 1);
    for (var i = 1; i < digits; i++) {
        result += String(Math.floor(Math.random() * 10));
    }
    return result;
}

// ---------------------------------------------------------------------------
// 样式注入
// ---------------------------------------------------------------------------

function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    var style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = [
        ".xseed-wrap {",
        "  position: relative;",
        "  width: 100%; height: 100%;",
        "  display: flex;",
        "  flex-direction: column;",
        "  gap: 6px;",
        "  padding: 8px 10px 10px 10px;",
        "  box-sizing: border-box;",
        "  border: 1px solid var(--xdh-clr-hairline, #333);",
        "  background: var(--comfy-menu-bg, #1a1a1a);",
        "  overflow: hidden;",
        "}",
        ".xseed-label {",
        "  font: var(--xdh-font-ui-md, 12px sans-serif);",
        "  color: var(--input-text, #ddd);",
        "  font-weight: 600;",
        "  line-height: 1.3;",
        "}",
        ".xseed-row {",
        "  display: flex;",
        "  gap: 6px;",
        "  align-items: center;",
        "}",
        ".xseed-input {",
        "  flex: 1;",
        "  min-width: 0;",
        "  height: 28px;",
        "  padding: 4px 8px;",
        "  border: 1px solid var(--border-color, #555);",
        "  border-radius: 4px;",
        "  background: var(--comfy-input-bg, #1a1a1a);",
        "  color: var(--input-text, #ddd);",
        "  font: var(--xdh-font-ui-md, 12px monospace);",
        "  outline: none;",
        "  box-sizing: border-box;",
        "}",
        ".xseed-input:focus {",
        "  border-color: var(--primary-color, #ff385c);",
        "}",
        ".xseed-input.is-readonly {",
        "  opacity: 0.7;",
        "  cursor: default;",
        "  resize: none;",
        "  flex-shrink: 0;",
        "}",
        ".xseed-btn {",
        "  height: 28px;",
        "  padding: 0 10px;",
        "  border: 1px solid var(--border-color, #555);",
        "  border-radius: 4px;",
        "  background: var(--comfy-menu-secondary-bg, #2a2a2a);",
        "  color: var(--input-text, #ddd);",
        "  font: var(--xdh-font-micro-label, 11px sans-serif);",
        "  cursor: pointer;",
        "  white-space: nowrap;",
        "  box-sizing: border-box;",
        "  transition: border-color 120ms ease, background-color 120ms ease;",
        "}",
        ".xseed-btn:hover {",
        "  border-color: var(--primary-color, #ff385c);",
        "}",
        ".xseed-btn:disabled {",
        "  opacity: 0.35;",
        "  cursor: not-allowed;",
        "}",
        ".xseed-btn.is-active {",
        "  background: var(--primary-color, #ff385c);",
        "  border-color: var(--primary-color, #ff385c);",
        "  color: #fff;",
        "}",
        ".xseed-btn-apply {",
        "  width: 100%;",
        "}",
    ].join("\n");
    document.head.appendChild(style);
}

// ---------------------------------------------------------------------------
// 隐藏原生 widget（seed_string / last_seed_string）
// ---------------------------------------------------------------------------

function hideNativeWidget(node, name) {
    var w = findWidget(node, name);
    if (!w) return;
    w.hidden = true;
    w.options = w.options || {};
    w.options.hidden = true;
    w.type = "hidden";
    w.computeSize = function () { return [0, -4]; };
    if (w.element) w.element.style.display = "none";
    if (w.inputEl) w.inputEl.style.display = "none";
    if (node.inputs) {
        for (var i = node.inputs.length - 1; i >= 0; i--) {
            if (node.inputs[i] && node.inputs[i].name === name) {
                if (typeof node.removeInput === "function") {
                    node.removeInput(i);
                } else {
                    node.inputs.splice(i, 1);
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------
// 隐藏 widget 读写
// ---------------------------------------------------------------------------

function writeSeedString(node, value) {
    var w = findWidget(node, WIDGET_SEED);
    if (!w) return;
    var v = String(value);
    if (w.value !== v) {
        w.value = v;
        if (typeof w.callback === "function") {
            w.callback(v, app.canvas, node, null, {});
        }
    }
}

function readSeedString(node) {
    var w = findWidget(node, WIDGET_SEED);
    return w ? String(w.value) : "1";
}

function readLastSeedString(node) {
    var w = findWidget(node, WIDGET_LAST_SEED);
    return w ? String(w.value) : "";
}

function writeLastSeedString(node, value) {
    var w = findWidget(node, WIDGET_LAST_SEED);
    if (!w) return;
    var v = String(value);
    if (w.value !== v) {
        w.value = v;
        if (typeof w.callback === "function") {
            w.callback(v, app.canvas, node, null, {});
        }
    }
}

function readRandomOnExecute(node) {
    var w = findWidget(node, WIDGET_RANDOM);
    return w ? Boolean(w.value) : false;
}

function writeRandomOnExecute(node, value) {
    var w = findWidget(node, WIDGET_RANDOM);
    if (!w) return;
    var b = Boolean(value);
    if (w.value !== b) {
        w.value = b;
        if (typeof w.callback === "function") {
            w.callback(b, app.canvas, node, null, {});
        }
    }
}

function readLastSeedLocked(node) {
    var w = findWidget(node, WIDGET_LAST_SEED_LOCKED);
    return w ? Boolean(w.value) : false;
}

function writeLastSeedLocked(node, value) {
    var w = findWidget(node, WIDGET_LAST_SEED_LOCKED);
    if (!w) return;
    var b = Boolean(value);
    if (w.value !== b) {
        w.value = b;
        if (typeof w.callback === "function") {
            w.callback(b, app.canvas, node, null, {});
        }
    }
}

// ---------------------------------------------------------------------------
// 节点尺寸约束（min_size + onResize 强制回弹）
// ---------------------------------------------------------------------------

function clampNodeSize(node) {
    if (!node) return;

    var minW = MIN_NODE_W;
    var minH = MIN_NODE_H;
    if (typeof node.computeSize === "function") {
        var computed = node.computeSize();
        if (Array.isArray(computed) && computed.length >= 2) {
            minW = Math.max(minW, Number(computed[0]) || 0);
            minH = Math.max(minH, Number(computed[1]) || 0);
        }
    }

    node.min_size = [minW, minH];
    if (typeof node.setSize === "function") {
        node.setSize([minW, minH]);
    } else {
        node.size = [minW, minH];
    }

    if (node.__xseed_resize_guard) return;
    node.__xseed_resize_guard = true;

    var origOnResize = node.onResize;
    node.onResize = function (size) {
        var src = Array.isArray(size) ? size : this.size;
        var nW = Math.max((src && src[0]) || 0, MIN_NODE_W);
        var nH = Math.max((src && src[1]) || 0, MIN_NODE_H);
        this.size = [nW, nH];
        this.setDirtyCanvas && this.setDirtyCanvas(true, true);
        if (typeof origOnResize === "function") {
            origOnResize.apply(this, arguments);
        }
    };
}

// ---------------------------------------------------------------------------
// 画布输入转发（中键 + 滚轮）
// ---------------------------------------------------------------------------

function bindCanvasForwarding(panel) {
    if (!panel) return;

    panel.addEventListener("wheel", function (event) {
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

// ---------------------------------------------------------------------------
// 创建自定义种子 UI
// ---------------------------------------------------------------------------

function createSeedUI(node) {
    if (!node || node.__xseedState) return;

    ensureStyles();
    hideNativeWidget(node, WIDGET_SEED);
    hideNativeWidget(node, WIDGET_LAST_SEED);
    hideNativeWidget(node, WIDGET_RANDOM);
    hideNativeWidget(node, WIDGET_LAST_SEED_LOCKED);

    var state = {
        node: node,
        randomOnExecute: readRandomOnExecute(node),
        lastSeedLocked: readLastSeedLocked(node),
    };

    var wrap = document.createElement("div");
    wrap.className = "xseed-wrap";

    // ── 行 1: 种子值标签 ──
    var label1 = document.createElement("div");
    label1.className = "xseed-label";
    wrap.appendChild(label1);
    state.labelSeed = label1;

    // ── 行 2: 种子值输入 + 生成按钮 + 随机开关 ──
    var row1 = document.createElement("div");
    row1.className = "xseed-row";

    var seedInput = document.createElement("input");
    seedInput.className = "xseed-input";
    seedInput.type = "text";
    seedInput.value = readSeedString(node);
    row1.appendChild(seedInput);

    var genBtn = document.createElement("button");
    genBtn.className = "xseed-btn";
    genBtn.type = "button";
    genBtn.textContent = "\u{1F3B2}"; // 🎲
    genBtn.title = tk("tip_generate", "Generate random seed based on digit limit");
    genBtn.disabled = state.randomOnExecute;
    row1.appendChild(genBtn);

    var randomToggle = document.createElement("button");
    randomToggle.className = "xseed-btn";
    randomToggle.type = "button";
    randomToggle.textContent = "\u{1F504}"; // 🔄
    row1.appendChild(randomToggle);

    wrap.appendChild(row1);

    // ── 行 3: 上次种子标签 ──
    var label2 = document.createElement("div");
    label2.className = "xseed-label";
    wrap.appendChild(label2);
    state.labelLast = label2;

    // ── 行 4: 上次种子值显示（只读） ──
    var row2 = document.createElement("div");
    row2.className = "xseed-row";

    var lastSeedInput = document.createElement("input");
    lastSeedInput.className = "xseed-input is-readonly";
    lastSeedInput.type = "text";
    lastSeedInput.readOnly = true;
    lastSeedInput.placeholder = "\u2014";
    lastSeedInput.value = readLastSeedString(node);
    row2.appendChild(lastSeedInput);

    var lastSeedLockBtn = document.createElement("button");
    lastSeedLockBtn.className = "xseed-btn";
    lastSeedLockBtn.type = "button";
    lastSeedLockBtn.style.flexShrink = "0";
    lastSeedLockBtn.style.width = "28px";
    lastSeedLockBtn.style.padding = "0";
    lastSeedLockBtn.textContent = state.lastSeedLocked ? "\u{1F512}" : "\u{1F513}";
    lastSeedLockBtn.title = state.lastSeedLocked
        ? tk("tip_last_seed_locked", "Last seed locked")
        : tk("tip_last_seed_unlocked", "Last seed unlocked");
    // 首次使用时还没有上次种子值，禁用锁定
    lastSeedLockBtn.disabled = !readLastSeedString(node);
    row2.appendChild(lastSeedLockBtn);

    wrap.appendChild(row2);

    // ── 行 5: 使用上次种子按钮 ──
    var useLastBtn = document.createElement("button");
    useLastBtn.className = "xseed-btn xseed-btn-apply";
    useLastBtn.type = "button";
    useLastBtn.disabled = !readLastSeedString(node);
    wrap.appendChild(useLastBtn);

    // ── 保存状态引用 ──
    state.wrap = wrap;
    state.seedInput = seedInput;
    state.lastSeedInput = lastSeedInput;
    state.genBtn = genBtn;
    state.randomToggle = randomToggle;
    state.useLastBtn = useLastBtn;
    state.lastSeedLockBtn = lastSeedLockBtn;
    node.__xseedState = state;

    // ── 应用本地化 ──
    applySeedLocale(state);

    // 从持久化 widget 恢复随机开关视觉状态
    if (state.randomOnExecute) {
        randomToggle.classList.add("is-active");
        genBtn.disabled = true;
        genBtn.title = tk("tip_gen_random_active", "Random mode active, manual generation disabled");
    }
    if (state.lastSeedLocked) {
        lastSeedLockBtn.classList.add("is-active");
    }

    // ── 事件绑定 ──

    seedInput.addEventListener("input", function () {
        var v = seedInput.value.trim();
        if (v && /^\d+$/.test(v)) {
            writeSeedString(node, v);
        }
    });
    seedInput.addEventListener("blur", function () {
        var v = seedInput.value.trim();
        if (!v || !/^\d+$/.test(v)) {
            v = readSeedString(node);
            seedInput.value = v;
        } else {
            // 按位数上限截断（与后端 _normalize_seed 一致）
            var digits = readDigits(node);
            if (v.length > digits) {
                v = v.slice(0, digits);
                seedInput.value = v;
            }
            writeSeedString(node, v);
        }
    });

    genBtn.addEventListener("click", function () {
        var digits = readDigits(node);
        var newSeed = generateRandomSeed(digits);
        seedInput.value = newSeed;
        writeSeedString(node, newSeed);
        markDirty();
    });

    randomToggle.addEventListener("click", function () {
        state.randomOnExecute = !state.randomOnExecute;
        writeRandomOnExecute(node, state.randomOnExecute);
        if (state.randomOnExecute) {
            randomToggle.classList.add("is-active");
        } else {
            randomToggle.classList.remove("is-active");
        }
        randomToggle.title = state.randomOnExecute
            ? tk("tip_random_on", "Random on execute: enabled")
            : tk("tip_random_off", "Random on execute: disabled");
        genBtn.disabled = state.randomOnExecute;
        genBtn.title = state.randomOnExecute
            ? tk("tip_gen_random_active", "Random mode active, manual generation disabled")
            : tk("tip_generate", "Generate random seed based on digit limit");
        markDirty();
    });

    useLastBtn.addEventListener("click", function () {
        var lastVal = readLastSeedString(node);
        if (!lastVal) return;
        // 使用上次种子意味着用户想要固定值，自动退出随机模式
        if (state.randomOnExecute) {
            state.randomOnExecute = false;
            writeRandomOnExecute(node, false);
            randomToggle.classList.remove("is-active");
            randomToggle.title = tk("tip_random_off", "Random on execute: disabled");
            genBtn.disabled = false;
            genBtn.title = tk("tip_generate", "Generate random seed based on digit limit");
        }
        seedInput.value = lastVal;
        writeSeedString(node, lastVal);
        markDirty();
    });

    lastSeedLockBtn.addEventListener("click", function () {
        state.lastSeedLocked = !state.lastSeedLocked;
        writeLastSeedLocked(node, state.lastSeedLocked);
        lastSeedLockBtn.textContent = state.lastSeedLocked
            ? "\u{1F512}" : "\u{1F513}";
        lastSeedLockBtn.title = state.lastSeedLocked
            ? tk("tip_last_seed_locked", "Last seed locked")
            : tk("tip_last_seed_unlocked", "Last seed unlocked");
        if (state.lastSeedLocked) {
            lastSeedLockBtn.classList.add("is-active");
        } else {
            lastSeedLockBtn.classList.remove("is-active");
        }
    });

    // ── beforeQueued：队列时捕获种子 ──
    attachBeforeQueued(node, state);

    // ── 注册 DOM widget ──
    if (typeof node.addDOMWidget === "function") {
        node.addDOMWidget(DOM_WIDGET_NAME, "custom", wrap, {
            serialize: false,
        });
    }

    bindCanvasForwarding(wrap);
    clampNodeSize(node);
}

function refreshUIFromWidgets(node, state) {
    if (!node || !state) return;
    // 种子值
    var seedVal = readSeedString(node);
    if (state.seedInput && state.seedInput.value !== seedVal) {
        state.seedInput.value = seedVal;
    }
    // 上次种子值
    var lastVal = readLastSeedString(node);
    if (state.lastSeedInput && state.lastSeedInput.value !== lastVal) {
        state.lastSeedInput.value = lastVal;
    }
    var hasLast = !!lastVal;
    if (state.useLastBtn) state.useLastBtn.disabled = !hasLast;
    // 随机开关
    var randomOn = readRandomOnExecute(node);
    if (state.randomOnExecute !== randomOn) {
        state.randomOnExecute = randomOn;
    }
    if (state.randomToggle) {
        if (randomOn) {
            state.randomToggle.classList.add("is-active");
        } else {
            state.randomToggle.classList.remove("is-active");
        }
        state.randomToggle.title = randomOn
            ? tk("tip_random_on", "Random on execute: enabled")
            : tk("tip_random_off", "Random on execute: disabled");
    }
    if (state.genBtn) {
        state.genBtn.disabled = randomOn;
        state.genBtn.title = randomOn
            ? tk("tip_gen_random_active", "Random mode active, manual generation disabled")
            : tk("tip_generate", "Generate random seed based on digit limit");
    }
    // 锁定开关
    var locked = readLastSeedLocked(node);
    if (state.lastSeedLocked !== locked) {
        state.lastSeedLocked = locked;
    }
    if (state.lastSeedLockBtn) {
        state.lastSeedLockBtn.disabled = !hasLast;
        state.lastSeedLockBtn.textContent = locked ? "\u{1F512}" : "\u{1F513}";
        state.lastSeedLockBtn.title = locked
            ? tk("tip_last_seed_locked", "Last seed locked")
            : tk("tip_last_seed_unlocked", "Last seed unlocked");
        if (locked) {
            state.lastSeedLockBtn.classList.add("is-active");
        } else {
            state.lastSeedLockBtn.classList.remove("is-active");
        }
    }
}

function markDirty() {
    if (app.canvas && app.canvas.setDirty) {
        app.canvas.setDirty(true, true);
    }
}

// ---------------------------------------------------------------------------
// beforeQueued 绑定 — 在队列时捕获种子
// ---------------------------------------------------------------------------

function attachBeforeQueued(node, state) {
    if (!node || !state) return;
    var seedWidget = findWidget(node, WIDGET_SEED);
    if (!seedWidget) return;

    seedWidget.beforeQueued = function () {
        // 锁定状态下不覆盖上次种子值
        if (!state.lastSeedLocked) {
            // 始终将当前种子值保存为 "上次执行的种子"
            // 先按位数上限截断（与后端 _normalize_seed 一致）
            var digits = readDigits(node);
            var currentSeed = String(this.value || "1");
            if (currentSeed.length > digits) {
                currentSeed = currentSeed.slice(0, digits);
            }
            writeLastSeedString(node, currentSeed);
            if (state.lastSeedInput) {
                state.lastSeedInput.value = currentSeed;
            }
            if (state.useLastBtn) {
                state.useLastBtn.disabled = false;
            }
            if (state.lastSeedLockBtn) {
                state.lastSeedLockBtn.disabled = false;
            }
        }

        // 执行时随机：重新生成并更新种子
        if (state.randomOnExecute) {
            var digits = readDigits(node);
            var newSeed = generateRandomSeed(digits);
            this.value = newSeed;
            if (state.seedInput) {
                state.seedInput.value = newSeed;
            }
            // 锁定状态下不覆盖上次种子值
            if (!state.lastSeedLocked) {
                writeLastSeedString(node, newSeed);
                if (state.lastSeedInput) {
                    state.lastSeedInput.value = newSeed;
                }
                if (state.lastSeedLockBtn) {
                    state.lastSeedLockBtn.disabled = false;
                }
            }
        }
    };
}

// ---------------------------------------------------------------------------
// 扩展注册
// ---------------------------------------------------------------------------

app.registerExtension({
    name: EXT_NAME,

    async setup() {
        await applyUiLocale();
        installLocaleSync();

        // fallback：执行完成事件作为辅助（beforeQueued 已做主要捕获）
        api.addEventListener("executed", function (_event) {
            var detail = _event && _event.detail;
            if (!detail || !detail.node) return;
            var graph = (app.canvas && app.canvas.getCurrentGraph
                && app.canvas.getCurrentGraph())
                || (app.canvas && app.canvas.graph)
                || app.graph;
            if (!graph) return;
            var node = graph.getNodeById
                ? graph.getNodeById(detail.node)
                : ((graph._nodes || graph.nodes || []).find(function (n) {
                    return n && String(n.id) === String(detail.node);
                }) || null);
            if (!node || String(node.comfyClass || node.type || "") !== NODE_CLASS) return;

            var state = node.__xseedState;
            if (!state) return;

            // 锁定状态下不覆盖
            if (state.lastSeedLocked) return;

            var executedSeed = readSeedString(node);
            if (!executedSeed || executedSeed === "") {
                executedSeed = "0";
            }
            // 按位数上限截断（与后端 _normalize_seed 一致）
            var digits = readDigits(node);
            if (executedSeed.length > digits) {
                executedSeed = executedSeed.slice(0, digits);
            }
            writeLastSeedString(node, executedSeed);
            if (state.lastSeedInput) {
                state.lastSeedInput.value = executedSeed;
            }
            if (state.useLastBtn) {
                state.useLastBtn.disabled = false;
            }
            if (state.lastSeedLockBtn) {
                state.lastSeedLockBtn.disabled = false;
            }
        });
    },

    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (String(nodeData.name) !== NODE_CLASS) return;

        var origOnCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            origOnCreated && origOnCreated.apply(this, arguments);
            createSeedUI(this);
            clampNodeSize(this);
        };

        var origOnConfigure = nodeType.prototype.onConfigure;
        nodeType.prototype.onConfigure = function () {
            origOnConfigure && origOnConfigure.apply(this, arguments);
            applySeedLocale(this.__xseedState);
            attachBeforeQueued(this, this.__xseedState);
            refreshUIFromWidgets(this, this.__xseedState);
            clampNodeSize(this);
        };
    },

    async nodeCreated(node) {
        if (String(node.comfyClass || node.type || "") !== NODE_CLASS) return;
        createSeedUI(node);
        clampNodeSize(node);
    },

    async loadedGraphNode(node) {
        if (String(node.comfyClass || node.type || "") !== NODE_CLASS) return;
        applySeedLocale(node.__xseedState);
        attachBeforeQueued(node, node.__xseedState);
        refreshUIFromWidgets(node, node.__xseedState);
        clampNodeSize(node);
    },
});
