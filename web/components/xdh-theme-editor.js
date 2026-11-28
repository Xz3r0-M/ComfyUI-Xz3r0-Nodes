/**
 * 主题颜色配置页
 * ==========================================
 * 为什么要有它：XDataHub 自己的配色以前只有「深色 / 浅色 / 跟随 ComfyUI」
 * 三档，改一个颜色就要改 CSS。这里把最值得调的 26 个颜色摆出来，
 * 用户自己配色，不用等我们发版。
 *
 * 三条设计规则：
 *   1. 只调「自己盖的房子」。节点面板是透色的（跟 ComfyUI 节点同色），
 *      不在这个页面里；这里管的是 XDataHub 窗口和全屏预览。
 *   2. 深色、浅色各存一份。切主题不会互相污染。
 *   3. 没改的项显示「跟随预设」并给出实际继承到的颜色，
 *      改过的项打一个小圆点 —— 一眼看得出哪些是自己动过的。
 */
import {
    BaseElement,
    registerCustomElement,
} from "../core/base-element.js?v=20260403-2";
import { icon, ICON_CSS, SCROLLBAR_CSS, TOOLTIP_CSS } from "../core/icon.js";
import { t } from "../core/i18n.js?v=20261116-9";
import { banner } from "../core/banner.js";
import {
    THEME_COLOR_GROUPS,
    THEME_CONTRAST_PAIRS,
    THEME_MIN_CONTRAST,
    THEME_OVERRIDE_MODES,
    allThemeTokens,
    buildOverrideSheet,
    contrastRatio,
    normalizeThemeOverrides,
    toPickerHex,
} from "../core/theme-tokens.js?v=20261116-9";
import {
    mergeIntoDraft,
    readThemeFile,
} from "../core/theme-import.js?v=20261116-9";

/** 预览用占位图：内联 SVG，不读用户素材，也不依赖额外文件。 */
const PREVIEW_PLACEHOLDER = "data:image/svg+xml;charset=utf-8,"
    + encodeURIComponent(
        `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="800">
<defs>
<linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
<stop offset="0" stop-color="#2b3a67"/>
<stop offset="0.5" stop-color="#5f4b8b"/>
<stop offset="1" stop-color="#c78a5a"/>
</linearGradient>
</defs>
<rect width="1280" height="800" fill="url(#g)"/>
<circle cx="420" cy="330" r="180" fill="#ffffff" opacity="0.16"/>
<circle cx="880" cy="500" r="230" fill="#000000" opacity="0.14"/>
</svg>`
    );

const PREVIEW_DETAIL = {
    id: "theme-preview",
    type: "image",
    name: "Preview",
    url: PREVIEW_PLACEHOLDER,
    thumbnailUrl: PREVIEW_PLACEHOLDER,
    raw: {},
};

const USER_THEME_STYLE_ID = "xdatahub-user-theme";

function sameOverrides(a, b) {
    return JSON.stringify(a || {}) === JSON.stringify(b || {});
}

function cloneOverrides(value) {
    return normalizeThemeOverrides(JSON.parse(JSON.stringify(value || {})));
}

export class XdhThemeEditor extends BaseElement {
    constructor() {
        super();
        this._open = false;
        this._mode = "dark";
        this._savedMode = "dark";
        this._saved = cloneOverrides(null);
        this._draft = cloneOverrides(null);
        this._frame = 0;
        this._savedInline = new Map();
        this._presetCache = null;
        this._bound = false;
    }

    connectedCallback() {
        super.connectedCallback();
    }

    /** 打开配置页。settings 是后端 /settings 返回的那份。 */
    open(settings) {
        const source = settings || {};
        this._savedMode = source.theme_mode === "light" ? "light" : "dark";
        this._mode = this._savedMode;
        this._saved = cloneOverrides(source.theme_overrides);
        this._draft = cloneOverrides(source.theme_overrides);
        this._presetCache = null;
        this._open = true;
        this.renderRoot();
        this._bindEvents();
        this._applyDraftToDocument();
        this._mountPreview();
    }

    close() {
        if (!this._open) {
            return;
        }
        this._open = false;
        this._cancelFrame();
        this._releaseInline();
        this.renderRoot();
        this.dispatchEvent(new CustomEvent("theme-editor-closed", {
            bubbles: true,
            composed: true,
        }));
    }

    get isOpen() {
        return this._open;
    }

    // ── 草稿 → 真实界面（仅预览，不落盘）────────────────────────────

    _cancelFrame() {
        if (this._frame) {
            cancelAnimationFrame(this._frame);
            this._frame = 0;
        }
    }

    /**
     * 只改 body 上的**内联变量**来预览，不写样式表。
     * 内联变量立刻生效，且关掉时逐条移除就行，不会留下垃圾。
     * 用 rAF 合并：拖取色器时一秒能触发几十次，不合并会卡。
     */
    _applyDraftToDocument() {
        this._cancelFrame();
        this._frame = requestAnimationFrame(() => {
            this._frame = 0;
            const body = document.body;
            if (!body) {
                return;
            }
            const group = this._draft[this._mode] || {};
            const saved = this._saved[this._mode] || {};
            for (const [token, value] of Object.entries(group)) {
                if (!this._savedInline.has(token)) {
                    this._savedInline.set(
                        token,
                        body.style.getPropertyValue(token)
                    );
                }
                body.style.setProperty(token, value);
            }
            for (const token of [...this._savedInline.keys()]) {
                if (token in group) {
                    continue;
                }
                // 这一项「已经保存过、但草稿里删掉了」= 用户刚点了恢复默认。
                //
                // 光把内联删掉是不够的：已保存的值还躺在
                // <style id="xdatahub-user-theme"> 里，删了内联反而把它
                // 露出来 —— 面板显示「跟随预设」，窗口却一点没变。
                // 所以显式用预设值盖住它，点「保存」后才由后端真正抹掉。
                if (token in saved) {
                    const preset = this._presetValues()[token];
                    if (preset) {
                        body.style.setProperty(token, preset);
                        continue;
                    }
                }
                const original = this._savedInline.get(token) || "";
                if (original) {
                    body.style.setProperty(token, original);
                } else {
                    body.style.removeProperty(token);
                }
            }
        });
    }

    _releaseInline() {
        const body = document.body;
        if (body) {
            for (const [token, original] of this._savedInline) {
                if (original) {
                    body.style.setProperty(token, original);
                } else {
                    body.style.removeProperty(token);
                }
            }
        }
        this._savedInline.clear();
    }

    // ── 读「没改时实际是什么颜色」────────────────────────────────

    /**
     * 26 项的「预设值」—— 也就是没做任何自定义、纯 CSS 文件给的那套。
     *
     * 读的时候要把两层盖在上面的东西一起摘掉：
     *   - body 的内联（正在预览的草稿）
     *   - <style id="xdatahub-user-theme">（已经保存过的配置）
     *
     * 一次读全 26 项再缓存：挂在渲染循环里逐项摘/插 DOM 会明显掉帧。
     * 失效点：open()（主题可能换过）、_switchMode()（深浅两套预设不同）。
     */
    _presetValues() {
        if (this._presetCache) {
            return this._presetCache;
        }
        const body = document.body;
        if (!body) {
            return {};
        }
        const sheet = document.getElementById(USER_THEME_STYLE_ID);
        const sheetParent = sheet?.parentNode || null;
        if (sheet) {
            sheet.remove();
        }
        const savedInline = new Map();
        for (const token of allThemeTokens()) {
            const inline = body.style.getPropertyValue(token);
            if (inline) {
                savedInline.set(token, inline);
                body.style.removeProperty(token);
            }
        }
        const out = {};
        for (const token of allThemeTokens()) {
            out[token] = String(
                getComputedStyle(body).getPropertyValue(token) || ""
            ).trim();
        }
        for (const [token, inline] of savedInline) {
            body.style.setProperty(token, inline);
        }
        if (sheet && sheetParent) {
            sheetParent.appendChild(sheet);
        }
        this._presetCache = out;
        return out;
    }

    _inheritedValue(token) {
        return this._presetValues()[token] || "";
    }

    _effectiveValue(token) {
        const override = this._draft[this._mode]?.[token];
        if (override) {
            return override;
        }
        return this._inheritedValue(token);
    }

    // ── 预览 ──────────────────────────────────────────────

    _mountPreview() {
        const host = this.$(".xte-preview-stage");
        const lightbox = this.$("xdh-lightbox");
        if (!host || !lightbox) {
            return;
        }
        requestAnimationFrame(async () => {
            try {
                await lightbox.previewMedia?.(PREVIEW_DETAIL);
            } catch {
                /* 预览失败不影响配置页本身 */
            }
        });
    }

    // ── 事件 ──────────────────────────────────────────────

    _bindEvents() {
        const root = this.shadowRoot;
        if (!root || this._bound) {
            this._syncBoundState();
            return;
        }
        this._bound = true;

        root.addEventListener("click", (event) => {
            const target = event.target instanceof Element
                ? event.target.closest("[data-act]")
                : null;
            if (!target) {
                return;
            }
            const act = target.getAttribute("data-act");
            if (act === "close") {
                this._onCancel();
                return;
            }
            if (act === "apply") {
                void this._onApply();
                return;
            }
            if (act === "reset-item") {
                const token = target.getAttribute("data-token") || "";
                this._setOverride(token, "");
                return;
            }
            if (act === "reset-group") {
                const groupKey = target.getAttribute("data-group") || "";
                this._resetGroup(groupKey);
                return;
            }
            if (act === "reset-all") {
                this._draft[this._mode] = {};
                this._refresh();
                return;
            }
            if (act === "mode") {
                const next = target.getAttribute("data-mode");
                this._switchMode(next);
                return;
            }
            if (act === "export") {
                this._exportFile();
                return;
            }
            if (act === "import") {
                this.$(".xte-file")?.click();
            }
        });

        root.addEventListener("input", (event) => {
            const input = event.target;
            if (!(input instanceof HTMLInputElement)) {
                return;
            }
            const token = input.getAttribute("data-color-token");
            if (!token) {
                return;
            }
            this._setOverride(token, input.value, { quiet: true });
        });

        root.addEventListener("change", (event) => {
            const input = event.target;
            if (!(input instanceof HTMLInputElement)) {
                return;
            }
            if (input.classList.contains("xte-file")) {
                void this._importFile(input);
                return;
            }
            const token = input.getAttribute("data-color-token");
            if (token) {
                this._setOverride(token, input.value);
            }
        });
    }

    _syncBoundState() {
        // 渲染会换掉 DOM，但监听挂在 shadowRoot 上，一直有效。
        this._bound = !!this.shadowRoot;
    }

    _setOverride(token, value, options = {}) {
        const group = this._draft[this._mode];
        const clean = String(value || "").trim();
        if (clean) {
            group[token] = clean;
        } else {
            delete group[token];
        }
        if (!options.quiet) {
            this._refresh();
            return;
        }
        // 拖取色器时只更新实时预览和对比度，不重画整棵列表（会掉帧）。
        this._applyDraftToDocument();
        this._paintRowState(token);
        this._paintContrast();
        this._mountPreview();
    }

    _paintRowState(token) {
        const row = this.shadowRoot?.querySelector(
            `[data-row-token="${CSS.escape(token)}"]`
        );
        if (!row) {
            return;
        }
        const overridden = !!this._draft[this._mode]?.[token];
        row.classList.toggle("is-overridden", overridden);
        const hint = row.querySelector(".xte-row-inherited");
        if (hint) {
            hint.textContent = overridden
                ? ""
                : t("theme.inherit_hint", {
                    value: this._inheritedValue(token),
                });
        }
    }

    _resetGroup(groupKey) {
        const group = THEME_COLOR_GROUPS.find((g) => g.key === groupKey);
        if (!group) {
            return;
        }
        for (const item of group.items) {
            delete this._draft[this._mode][item.token];
        }
        this._refresh();
    }

    _switchMode(mode) {
        const next = THEME_OVERRIDE_MODES.includes(mode) ? mode : "dark";
        if (next === this._mode) {
            return;
        }
        this._releaseInline();
        this._mode = next;
        this._presetCache = null;
        document.body.dataset.theme = next;
        this._refresh();
        this._applyDraftToDocument();
        this._mountPreview();
    }

    _refresh() {
        this.renderRoot();
        this._bindEvents();
        this._applyDraftToDocument();
        this._mountPreview();
    }

    _changedCount() {
        return Object.keys(this._draft[this._mode] || {}).length;
    }

    async _onApply() {
        const payload = {
            theme_mode: this._mode,
            theme_overrides: normalizeThemeOverrides(this._draft),
        };
        try {
            const res = await fetch("/xz3r0/xdatahub/settings", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            });
            if (!res.ok) {
                throw new Error(`HTTP ${res.status}`);
            }
            const data = await res.json().catch(() => null);
            const saved = data?.settings || payload;
            this._saved = cloneOverrides(saved.theme_overrides);
            this._savedMode = saved.theme_mode === "light" ? "light" : "dark";
            this._releaseInline();
            this._writeLocalSheet(this._saved);
            this._notifyHost(this._savedMode, this._saved);
            banner.success?.(t("theme.saved"));
        } catch (error) {
            banner.error?.(`${t("theme.save_failed")}: ${error.message}`);
        }
    }

    _onCancel() {
        this._draft = cloneOverrides(this._saved);
        this._releaseInline();
        document.body.dataset.theme = this._savedMode;
        this.close();
    }

    _writeLocalSheet(overrides) {
        let styleEl = document.getElementById(USER_THEME_STYLE_ID);
        const text = buildOverrideSheet(overrides);
        if (!text) {
            styleEl?.remove();
            return;
        }
        if (!styleEl) {
            styleEl = document.createElement("style");
            styleEl.id = USER_THEME_STYLE_ID;
            document.head.appendChild(styleEl);
        }
        styleEl.textContent = text;
    }

    _notifyHost(mode, overrides) {
        if (!window.parent || window.parent === window) {
            return;
        }
        try {
            window.parent.postMessage(
                {
                    type: "xdatahub:theme-overrides",
                    overrides: overrides,
                    theme_mode: mode,
                },
                document.referrer
                    ? new URL(document.referrer).origin
                    : window.location.origin
            );
        } catch {
            /* 跨窗口发不出去就只影响本窗口 */
        }
    }

    _exportFile() {
        const overrides = normalizeThemeOverrides(this._draft);
        const total = Object.keys(overrides.dark).length
            + Object.keys(overrides.light).length;
        const stamp = new Date().toISOString().slice(0, 10);
        const blob = new Blob(
            [JSON.stringify({
                version: 1,
                theme_mode: this._mode,
                theme_overrides: overrides,
            }, null, 2)],
            { type: "application/json" }
        );
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `xdatahub-theme-${stamp}.json`;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 10_000);
        // 以前导出完一声不响，用户不知道文件落哪了、导了几个颜色。
        banner.success?.(t("theme.exported", { count: total }));
    }

    /**
     * 导入。认两种文件：
     *
     *   1. 我们自己导出的（有 theme_overrides）
     *   2. ComfyUI 官方主题 JSON（有 colors.theme / comfy_base / litegraph_base）
     *      —— 官方只有 8 个字段能对上，其余 18 项按相对关系推算。
     *
     * 几条硬规矩：
     *   - 解析出 0 项就说「没认出颜色」，绝对不能弹「导入成功」
     *     （以前官方文件走到这一步，用户以为成功了，实际一个色都没进）。
     *   - 只覆盖文件里**真正出现**的模式。以前是整个 _draft 换掉，
     *     另一模式调了半天的一起没。
     *   - 文件里写了哪个模式就切过去。以前写 "dark" 时反而保持当前界面，
     *     变成「装的是深色，面板停在浅色」。
     */
    async _importFile(input) {
        const file = input.files?.[0];
        input.value = "";
        if (!file) {
            return;
        }
        try {
            const parsed = JSON.parse(await file.text());
            const read = readThemeFile(parsed, file.name);
            if (read.count === 0) {
                banner.error?.(t("theme.import_empty"));
                return;
            }

            const dirty = this._changedCount();
            if (dirty > 0 && !window.confirm(t("theme.import_confirm", {
                count: dirty,
            }))) {
                return;
            }

            // 合并：只替换文件里真给了内容的模式，其余一概不动。
            this._draft = mergeIntoDraft(this._draft, read.incoming);
            this._mode = read.modeHint || this._mode;
            document.body.dataset.theme = this._mode;
            this._refresh();

            banner.success?.(read.official
                ? t("theme.imported_official", {
                    name: read.title,
                    count: read.count,
                })
                : t("theme.imported_count", { count: read.count }));
        } catch (error) {
            banner.error?.(`${t("theme.import_failed")}: ${error.message}`);
        }
    }

    // ── 渲染 ──────────────────────────────────────────────

    _renderRow(item) {
        const overridden = !!this._draft[this._mode]?.[item.token];
        const effective = this._effectiveValue(item.token);
        const inherited = overridden
            ? ""
            : t("theme.inherit_hint", { value: this._inheritedValue(item.token) });
        return `<div class="xte-row${overridden ? " is-overridden" : ""}"
                data-row-token="${item.token}">
            <span class="xte-swatch"
                style="background:${effective || "transparent"}"></span>
            <span class="xte-row-text">
                <span class="xte-row-label">${t(item.labelKey)}</span>
                <span class="xte-row-inherited">${inherited}</span>
            </span>
            <input class="xte-color" type="color"
                data-color-token="${item.token}"
                value="${toPickerHex(effective)}">
            <button class="xte-icon-btn" data-act="reset-item"
                data-token="${item.token}"
                title="${t("theme.reset_item")}"
                ${overridden ? "" : "disabled"}>
                ${icon("rotate-ccw")}
            </button>
        </div>`;
    }

    _renderGroups() {
        return THEME_COLOR_GROUPS.map((group) => {
            const body = group.items.map((item) => this._renderRow(item));
            return `<section class="xte-group">
                <header class="xte-group-head">
                    <span class="xte-group-title">${t(group.titleKey)}</span>
                    <button class="xte-text-btn" data-act="reset-group"
                        data-group="${group.key}">${t("theme.reset_group")}</button>
                </header>
                <div class="xte-group-body">${body.join("")}</div>
            </section>`;
        }).join("");
    }

    _renderContrast() {
        const rows = THEME_CONTRAST_PAIRS.map((pair) => {
            const ratio = contrastRatio(
                this._effectiveValue(pair.fg),
                this._effectiveValue(pair.bg)
            );
            const ok = ratio !== null && ratio >= THEME_MIN_CONTRAST;
            const text = ratio === null ? "—" : `${ratio.toFixed(1)}:1`;
            return `<div class="xte-contrast-row${ok ? "" : " is-low"}">
                <span class="xte-contrast-label">${t(pair.labelKey)}</span>
                <span class="xte-contrast-value">${text}</span>
            </div>`;
        });
        return rows.join("");
    }

    _paintContrast() {
        const box = this.$(".xte-contrast");
        if (box) {
            box.innerHTML = this._renderContrast();
        }
    }

    render() {
        if (!this._open) {
            return `<style>:host{display:none;}</style>`;
        }
        const mode = this._mode;
        const changed = this._changedCount();
        const modeButton = (value, labelKey) => `<button
                class="xte-mode-btn${mode === value ? " is-active" : ""}"
                data-act="mode" data-mode="${value}">
                ${t(labelKey)}
            </button>`;
        return `
            <style>
                ${ICON_CSS}
                ${SCROLLBAR_CSS}
                ${TOOLTIP_CSS}
                :host { display: contents; }
                .xte-backdrop {
                    position: fixed;
                    inset: 0;
                    background: var(--xdh-clr-scrim, rgba(0, 0, 0, 0.6));
                    z-index: 9000;
                    animation: xte-fade 140ms ease-out;
                }
                .xte-panel {
                    position: fixed;
                    top: 0;
                    right: 0;
                    bottom: 0;
                    width: min(720px, 92vw);
                    display: flex;
                    flex-direction: column;
                    background: var(--xdh-clr-canvas, #0c0c0e);
                    color: var(--xdh-clr-ink, #ffffff);
                    border-left: 1px solid var(--xdh-clr-hairline, #2a2a2c);
                    box-shadow: -18px 0 48px rgba(0, 0, 0, 0.32);
                    z-index: 9001;
                    animation: xte-slide 160ms ease-out;
                }
                @keyframes xte-fade {
                    from { opacity: 0; }
                    to { opacity: 1; }
                }
                @keyframes xte-slide {
                    from { transform: translateX(24px); opacity: 0; }
                    to { transform: none; opacity: 1; }
                }
                .xte-head {
                    display: flex;
                    align-items: center;
                    gap: var(--xdh-space-sm, 12px);
                    padding: 14px 16px;
                    border-bottom: 1px solid var(--xdh-clr-hairline, #2a2a2c);
                }
                .xte-title {
                    font: var(--xdh-font-title-sm, 500 16px/1.25 sans-serif);
                    flex: 1 1 auto;
                }
                .xte-modes {
                    display: inline-flex;
                    gap: 2px;
                    padding: 2px;
                    border-radius: 9999px;
                    background: var(--xdh-clr-surface-strong, #1d1d20);
                }
                .xte-mode-btn {
                    border: none;
                    background: transparent;
                    color: inherit;
                    font: inherit;
                    font-size: 12px;
                    padding: 4px 12px;
                    border-radius: 9999px;
                    cursor: pointer;
                    opacity: 0.62;
                }
                .xte-mode-btn.is-active {
                    background: var(--xdh-clr-primary, #ff385c);
                    color: var(--xdh-clr-on-primary, #ffffff);
                    opacity: 1;
                }
                .xte-body {
                    flex: 1 1 auto;
                    display: grid;
                    grid-template-columns: minmax(0, 1fr) minmax(0, 320px);
                    min-height: 0;
                }
                .xte-groups {
                    overflow-y: auto;
                    padding: 8px 16px 16px;
                }
                .xte-side {
                    border-left: 1px solid var(--xdh-clr-hairline, #2a2a2c);
                    padding: 12px;
                    overflow-y: auto;
                    display: flex;
                    flex-direction: column;
                    gap: 12px;
                }
                .xte-group {
                    padding: 10px 0;
                    border-bottom: 1px solid var(--xdh-clr-hairline-soft, #232325);
                }
                .xte-group:last-child { border-bottom: none; }
                .xte-group-head {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    padding-bottom: 6px;
                }
                .xte-group-title {
                    flex: 1 1 auto;
                    font-size: 12px;
                    letter-spacing: 0.04em;
                    text-transform: uppercase;
                    opacity: 0.62;
                }
                .xte-text-btn {
                    border: none;
                    background: transparent;
                    color: var(--xdh-clr-legal-link, #428bff);
                    font: inherit;
                    font-size: 12px;
                    cursor: pointer;
                    padding: 2px 4px;
                }
                .xte-row {
                    display: grid;
                    grid-template-columns: 18px minmax(0, 1fr) 34px 26px;
                    align-items: center;
                    gap: 8px;
                    padding: 4px 0;
                }
                .xte-swatch {
                    width: 18px;
                    height: 18px;
                    border-radius: 4px;
                    box-shadow: inset 0 0 0 1px rgba(127, 127, 127, 0.4);
                }
                .xte-row-text {
                    display: flex;
                    flex-direction: column;
                    min-width: 0;
                }
                .xte-row-label {
                    font-size: 13px;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                }
                .xte-row-inherited {
                    font-size: 11px;
                    opacity: 0.55;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                }
                .xte-row.is-overridden .xte-row-label::after {
                    content: "";
                    display: inline-block;
                    width: 5px;
                    height: 5px;
                    margin-left: 5px;
                    border-radius: 50%;
                    background: var(--xdh-clr-primary, #ff385c);
                    vertical-align: middle;
                }
                .xte-color {
                    width: 34px;
                    height: 24px;
                    padding: 0;
                    border: 1px solid var(--xdh-clr-hairline, #2a2a2c);
                    border-radius: 4px;
                    background: transparent;
                    cursor: pointer;
                }
                .xte-icon-btn {
                    width: 26px;
                    height: 26px;
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    border: none;
                    border-radius: 4px;
                    background: transparent;
                    color: inherit;
                    opacity: 0.6;
                    cursor: pointer;
                }
                .xte-icon-btn:disabled {
                    opacity: 0.18;
                    cursor: default;
                }
                .xte-icon-btn:not(:disabled):hover {
                    background: var(--xdh-clr-surface-strong, #1d1d20);
                    opacity: 1;
                }
                .xte-side-title {
                    font-size: 12px;
                    letter-spacing: 0.04em;
                    text-transform: uppercase;
                    opacity: 0.62;
                }
                .xte-preview-stage {
                    position: relative;
                    width: 100%;
                    aspect-ratio: 16 / 11;
                    min-height: 200px;
                    border-radius: 8px;
                    overflow: hidden;
                    box-shadow: inset 0 0 0 1px
                        var(--xdh-clr-hairline, #2a2a2c);
                    background: var(--xdh-clr-surface-soft, #161618);
                    /* 预览里的小字不需要被选中，避免拖动取色器时误选 */
                    user-select: none;
                }
                .xte-preview-stage xdh-lightbox {
                    position: absolute;
                    inset: 0;
                }
                .xte-contrast {
                    display: flex;
                    flex-direction: column;
                    gap: 4px;
                }
                .xte-contrast-row {
                    display: flex;
                    justify-content: space-between;
                    gap: 8px;
                    font-size: 12px;
                    opacity: 0.86;
                }
                .xte-contrast-row.is-low {
                    color: var(--xdh-clr-error, #c13515);
                    opacity: 1;
                }
                .xte-contrast-value {
                    font-variant-numeric: tabular-nums;
                }
                .xte-hint {
                    font-size: 11px;
                    line-height: 1.5;
                    opacity: 0.55;
                }
                .xte-foot {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    padding: 12px 16px;
                    border-top: 1px solid var(--xdh-clr-hairline, #2a2a2c);
                }
                .xte-foot-count {
                    flex: 1 1 auto;
                    font-size: 12px;
                    opacity: 0.62;
                }
                .xte-btn {
                    border: none;
                    border-radius: 8px;
                    padding: 7px 14px;
                    font: inherit;
                    font-size: 13px;
                    cursor: pointer;
                    background: var(--xdh-clr-surface-strong, #1d1d20);
                    color: inherit;
                }
                .xte-btn.is-primary {
                    background: var(--xdh-clr-primary, #ff385c);
                    color: var(--xdh-clr-on-primary, #ffffff);
                }
                .xte-file { display: none; }
                @media (max-width: 720px) {
                    .xte-body {
                        grid-template-columns: minmax(0, 1fr);
                    }
                    .xte-side {
                        border-left: none;
                        border-top: 1px solid
                            var(--xdh-clr-hairline, #2a2a2c);
                    }
                }
            </style>
            <div class="xte-backdrop" data-act="close"></div>
            <div class="xte-panel" role="dialog" aria-modal="true">
                <div class="xte-head">
                    <span class="xte-title">${t("theme.title")}</span>
                    <span class="xte-modes">
                        ${modeButton("dark", "theme.mode.dark")}
                        ${modeButton("light", "theme.mode.light")}
                    </span>
                    <button class="xte-icon-btn" data-act="close"
                        title="${t("common.close")}">
                        ${icon("x")}
                    </button>
                </div>
                <div class="xte-body">
                    <div class="xte-groups xdh-scroll">
                        ${this._renderGroups()}
                    </div>
                    <div class="xte-side">
                        <div class="xte-side-title">
                            ${t("theme.preview.title")}
                        </div>
                        <div class="xte-preview-stage">
                            <xdh-lightbox preview></xdh-lightbox>
                        </div>
                        <div class="xte-side-title">
                            ${t("theme.contrast.title")}
                        </div>
                        <div class="xte-contrast">${this._renderContrast()}</div>
                        <div class="xte-hint">
                            ${t("theme.contrast.hint", {
                                min: THEME_MIN_CONTRAST,
                            })}
                        </div>
                    </div>
                </div>
                <div class="xte-foot">
                    <span class="xte-foot-count">
                        ${t("theme.changed_count", { count: changed })}
                    </span>
                    <input class="xte-file" type="file"
                        accept="application/json,.json">
                    <button class="xte-btn" data-act="import">
                        ${t("theme.import")}
                    </button>
                    <button class="xte-btn" data-act="export">
                        ${t("theme.export")}
                    </button>
                    <button class="xte-btn" data-act="reset-all">
                        ${t("theme.reset_all")}
                    </button>
                    <button class="xte-btn" data-act="close">
                        ${t("common.cancel")}
                    </button>
                    <button class="xte-btn is-primary" data-act="apply">
                        ${t("theme.apply")}
                    </button>
                </div>
            </div>
        `;
    }
}

registerCustomElement("xdh-theme-editor", XdhThemeEditor);

export default XdhThemeEditor;
