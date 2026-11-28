/**
 * 可自定义的主题颜色清单
 * ==========================================
 * 这里只列「用户值得调」的颜色，不列全部 60 多个 token。
 * 分组的顺序就是配置页里的显示顺序；每组 3~9 项，够了也不至于让人
 * 面对上百个色块无从下手。
 *
 * 约定：
 *   - token 名必须是 --xdh* 开头（后端只收这个前缀）。
 *   - 值一律写成 CSS 颜色字符串；改过的项才写进 overrides，
 *     没改的项留空表示「跟随预设」。
 *   - 深色和浅色各自存一份，切主题不会互相污染。
 */

export const THEME_OVERRIDE_MODES = ["dark", "light"];

/** 分组 → 颜色项。labelKey 走 i18n，禁止硬编码文案。 */
export const THEME_COLOR_GROUPS = [
    {
        key: "window",
        titleKey: "theme.grp.window",
        items: [
            { token: "--xdh-clr-canvas", labelKey: "theme.item.canvas" },
            {
                token: "--xdh-clr-surface-soft",
                labelKey: "theme.item.surface_soft",
            },
            {
                token: "--xdh-clr-surface-card",
                labelKey: "theme.item.surface_card",
            },
            {
                token: "--xdh-clr-surface-strong",
                labelKey: "theme.item.surface_strong",
            },
        ],
    },
    {
        key: "text",
        titleKey: "theme.grp.text",
        items: [
            { token: "--xdh-clr-ink", labelKey: "theme.item.ink" },
            { token: "--xdh-clr-body", labelKey: "theme.item.body" },
            { token: "--xdh-clr-muted", labelKey: "theme.item.muted" },
            {
                token: "--xdh-clr-muted-soft",
                labelKey: "theme.item.muted_soft",
            },
        ],
    },
    {
        key: "line",
        titleKey: "theme.grp.line",
        items: [
            { token: "--xdh-clr-hairline", labelKey: "theme.item.hairline" },
            {
                token: "--xdh-clr-hairline-soft",
                labelKey: "theme.item.hairline_soft",
            },
            {
                token: "--xdh-clr-border-strong",
                labelKey: "theme.item.border_strong",
            },
        ],
    },
    {
        key: "accent",
        titleKey: "theme.grp.accent",
        items: [
            { token: "--xdh-clr-primary", labelKey: "theme.item.primary" },
            {
                token: "--xdh-clr-primary-active",
                labelKey: "theme.item.primary_active",
            },
            {
                token: "--xdh-clr-on-primary",
                labelKey: "theme.item.on_primary",
            },
            {
                token: "--xdh-clr-legal-link",
                labelKey: "theme.item.legal_link",
            },
            { token: "--xdh-clr-error", labelKey: "theme.item.error" },
            { token: "--xdh-clr-scrim", labelKey: "theme.item.scrim" },
        ],
    },
    {
        /* 全屏预览单独一组：它盖在内容上面、背后是全屏黑底，
           对比度需求和窗口里的卡片不是一回事，所以要能单独调。 */
        key: "fullscreen",
        titleKey: "theme.grp.fullscreen",
        items: [
            { token: "--xdh-fs-scrim", labelKey: "theme.item.fs_scrim" },
            { token: "--xdh-fs-panel", labelKey: "theme.item.fs_panel" },
            {
                token: "--xdh-fs-panel-raised",
                labelKey: "theme.item.fs_panel_raised",
            },
            { token: "--xdh-fs-ink", labelKey: "theme.item.fs_ink" },
            { token: "--xdh-fs-ink-2", labelKey: "theme.item.fs_ink_2" },
            { token: "--xdh-fs-ink-3", labelKey: "theme.item.fs_ink_3" },
            { token: "--xdh-fs-line", labelKey: "theme.item.fs_line" },
            { token: "--xdh-fs-btn", labelKey: "theme.item.fs_btn" },
            { token: "--xdh-fs-wave", labelKey: "theme.item.fs_wave" },
        ],
    },
];

/** 配置页要报对比度的几对：太挤会变噪音，只留最要紧的 6 对。 */
export const THEME_CONTRAST_PAIRS = [
    {
        key: "window_ink",
        fg: "--xdh-clr-ink",
        bg: "--xdh-clr-surface-card",
        labelKey: "theme.contrast.window_ink",
    },
    {
        key: "window_body",
        fg: "--xdh-clr-body",
        bg: "--xdh-clr-surface-card",
        labelKey: "theme.contrast.window_body",
    },
    {
        key: "window_muted",
        fg: "--xdh-clr-muted",
        bg: "--xdh-clr-surface-card",
        labelKey: "theme.contrast.window_muted",
    },
    {
        key: "fs_ink",
        fg: "--xdh-fs-ink",
        bg: "--xdh-fs-panel",
        labelKey: "theme.contrast.fs_ink",
    },
    {
        key: "fs_ink2",
        fg: "--xdh-fs-ink-2",
        bg: "--xdh-fs-panel",
        labelKey: "theme.contrast.fs_ink2",
    },
    {
        key: "fs_raised",
        fg: "--xdh-fs-ink",
        bg: "--xdh-fs-panel-raised",
        labelKey: "theme.contrast.fs_raised",
    },
];

/** 正文字号下的小字，低于这个比例就算不合格。 */
export const THEME_MIN_CONTRAST = 4.5;

export function allThemeTokens() {
    const out = [];
    for (const group of THEME_COLOR_GROUPS) {
        for (const item of group.items) {
            out.push(item.token);
        }
    }
    return out;
}

export function isThemeTokenAllowed(token) {
    if (typeof token !== "string") {
        return false;
    }
    const name = token.trim();
    if (!name.startsWith("--xdh")) {
        return false;
    }
    if (!/^--xdh[a-z0-9-]+$/.test(name)) {
        return false;
    }
    // 名字合法还不够，必须是配置页里真能调的那 26 项。
    // 否则导入一个捏造的文件就能往 body 上塞任意 --xdh-* 变量
    // （包括「就地改名重定向」用的中间变量，塞进去会把重定向打断）。
    return allowedTokenSet().has(name);
}

let ALLOWED_TOKEN_SET = null;

function allowedTokenSet() {
    if (!ALLOWED_TOKEN_SET) {
        ALLOWED_TOKEN_SET = new Set(allThemeTokens());
    }
    return ALLOWED_TOKEN_SET;
}

function isSafeValue(value) {
    if (typeof value !== "string") {
        return false;
    }
    const text = value.trim();
    if (!text || text.length > 160) {
        return false;
    }
    const lowered = text.toLowerCase();
    if (lowered.includes("url(") || lowered.includes("expression(")) {
        return false;
    }
    if (lowered.includes("<")) {
        return false;
    }
    return true;
}

/** 洗数据：只留 --xdh* 变量名 + 安全的短字符串值。 */
export function normalizeThemeOverrides(value) {
    const out = { dark: {}, light: {} };
    if (!value || typeof value !== "object") {
        return out;
    }
    for (const mode of THEME_OVERRIDE_MODES) {
        const group = value[mode];
        if (!group || typeof group !== "object") {
            continue;
        }
        for (const [token, raw] of Object.entries(group)) {
            if (!isThemeTokenAllowed(token) || !isSafeValue(raw)) {
                continue;
            }
            out[mode][token] = raw.trim();
        }
    }
    return out;
}

export function countOverrides(overrides, mode) {
    const group = overrides?.[mode];
    return group && typeof group === "object"
        ? Object.keys(group).length
        : 0;
}

/** 生成会挂到 <head> 最后的那张样式表内容。 */
export function buildOverrideSheet(overrides) {
    const lines = [];
    const dark = Object.entries(overrides?.dark || {});
    const light = Object.entries(overrides?.light || {});
    if (dark.length) {
        lines.push(':root,body[data-theme="dark"],body:not([data-theme]){');
        for (const [name, value] of dark) {
            lines.push(`  ${name}:${value};`);
        }
        lines.push("}");
    }
    if (light.length) {
        lines.push('body[data-theme="light"]{');
        for (const [name, value] of light) {
            lines.push(`  ${name}:${value};`);
        }
        lines.push("}");
    }
    return lines.join("\n");
}

// ── 颜色工具（只服务配置页里的对比度读数）────────────────────────────

const HEX_RE = /^#([0-9a-f]{3,8})$/i;
const RGB_RE = /^rgba?\(([^)]+)\)$/i;

export function parseColor(text) {
    const value = String(text || "").trim();
    const hex = value.match(HEX_RE);
    if (hex) {
        let body = hex[1];
        if (body.length === 3 || body.length === 4) {
            body = body
                .split("")
                .map((ch) => ch + ch)
                .join("");
        }
        const r = Number.parseInt(body.slice(0, 2), 16);
        const g = Number.parseInt(body.slice(2, 4), 16);
        const b = Number.parseInt(body.slice(4, 6), 16);
        const a = body.length >= 8
            ? Number.parseInt(body.slice(6, 8), 16) / 255
            : 1;
        return { r, g, b, a: Number.isFinite(a) ? a : 1 };
    }
    const rgb = value.match(RGB_RE);
    if (rgb) {
        const parts = rgb[1]
            .split(/[,/\s]+/)
            .map((part) => part.trim())
            .filter(Boolean);
        if (parts.length >= 3) {
            const [r, g, b] = parts.slice(0, 3).map((part) => {
                if (part.endsWith("%")) {
                    return (Number.parseFloat(part) * 255) / 100;
                }
                return Number.parseFloat(part);
            });
            let a = 1;
            if (parts.length >= 4) {
                const raw = parts[3];
                a = raw.endsWith("%")
                    ? Number.parseFloat(raw) / 100
                    : Number.parseFloat(raw);
            }
            if ([r, g, b].every((n) => Number.isFinite(n))) {
                return {
                    r,
                    g,
                    b,
                    a: Number.isFinite(a) ? a : 1,
                };
            }
        }
    }
    return null;
}

/** 半透明色先压到背景上，否则对比度算不准（rgba 白 60% 会被当成纯白）。 */
export function flatten(color, backdrop) {
    if (color.a >= 1 || !backdrop) {
        return color;
    }
    return {
        r: color.r * color.a + backdrop.r * (1 - color.a),
        g: color.g * color.a + backdrop.g * (1 - color.a),
        b: color.b * color.a + backdrop.b * (1 - color.a),
        a: 1,
    };
}

export function relativeLuminance({ r, g, b }) {
    const channel = (value) => {
        const v = Math.min(255, Math.max(0, value)) / 255;
        return v <= 0.03928
            ? v / 12.92
            : ((v + 0.055) / 1.055) ** 2.4;
    };
    return (
        0.2126 * channel(r)
        + 0.7152 * channel(g)
        + 0.0722 * channel(b)
    );
}

/**
 * WCAG 对比度。任一颜色解析不出来就返回 null，
 * 由调用方显示「—」而不是瞎报一个数字。
 */
export function contrastRatio(fgText, bgText) {
    const fg = parseColor(fgText);
    const bg = parseColor(bgText);
    if (!fg || !bg) {
        return null;
    }
    const backdrop = flatten(bg, null);
    const solid = flatten(fg, backdrop);
    const l1 = relativeLuminance(solid);
    const l2 = relativeLuminance(backdrop);
    const light = Math.max(l1, l2);
    const dark = Math.min(l1, l2);
    return (light + 0.05) / (dark + 0.05);
}

/**
 * 把任意 CSS 颜色转成 <input type="color"> 要的 #rrggbb。
 * 半透明色**不压底**：取色器表达不了 alpha，先压底会让色块平移，
 * 用户从 rgba(0,0,0,0.7) 点开却看到灰色，会以为取错了色。
 */
export function toPickerHex(text, fallback = "#000000") {
    const color = parseColor(text);
    if (!color) {
        return fallback;
    }
    const clamp = (n) => Math.min(255, Math.max(0, Math.round(n)));
    const hex = (n) => clamp(n).toString(16).padStart(2, "0");
    return `#${hex(color.r)}${hex(color.g)}${hex(color.b)}`;
}
