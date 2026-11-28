/**
 * 把「ComfyUI 官方主题 JSON」转换成我们配置页认的 26 个 --xdh-* 初值。
 *
 * 为什么需要这一层：官方主题和我们的配置表**不是同一套东西**。
 * 官方主题长这样（从 ComfyUI 设置里「导出主题」得到的）：
 *
 *     {
 *       "id": "solarized",
 *       "name": "Solarized",
 *       "colors": {
 *         "theme":          { "background": "#002b36", "foreground": "#fdf6e3", ... },
 *         "comfy_base":     { "bg-color": "#002b36", "fg-color": "#fdf6e3", ... },
 *         "litegraph_base": { "NODE_DEFAULT_BGCOLOR": "#073642", ... },
 *         "node_slot":      { "IMAGE": "#5940bb", ... }
 *       }
 *     }
 *
 * 我们的是 26 个语义变量（--xdh-clr-canvas / --xdh-fs-panel / …）。
 * 官方 `colors.theme` 只有 8 个能对上，其余 18 个（包括全部 9 个
 * --xdh-fs-*）官方压根没有，只能按「背景 / 前景 / 卡片」的相对关系算出来。
 *
 * 三层兜底，因为老主题（solarized / arc）**没有 colors.theme 段**：
 *
 *     1. colors.theme          新版主题才有（dark / light）
 *     2. colors.comfy_base     老版主题的主力
 *     3. colors.litegraph_base 更老的，只有节点那几个色
 *
 * 明暗判断不靠 id 猜：先看 light_theme，再按背景亮度算。
 */

import {
    flatten,
    normalizeThemeOverrides,
    parseColor,
    relativeLuminance,
    THEME_OVERRIDE_MODES,
} from "./theme-tokens.js";

const WHITE = { r: 255, g: 255, b: 255, a: 1 };
const BLACK = { r: 0, g: 0, b: 0, a: 1 };

/** 没有背景色可参考时的最后一档（跟 dark 预设接近）。 */
const FALLBACK = {
    background: "#171718",
    foreground: "#ffffff",
    border: "#494a50",
    primary: "#0b8ce9",
    error: "#b33a3a",
};

// ── 小工具 ───────────────────────────────────────────────

function clamp255(n) {
    return Math.min(255, Math.max(0, Math.round(n)));
}

function toHex({ r, g, b }) {
    const hex = (n) => clamp255(n).toString(16).padStart(2, "0");
    return `#${hex(r)}${hex(g)}${hex(b)}`;
}

function toRgba({ r, g, b }, a) {
    const alpha = Math.min(1, Math.max(0, Math.round(a * 100) / 100));
    return `rgba(${clamp255(r)}, ${clamp255(g)}, ${clamp255(b)}, ${alpha})`;
}

/**
 * 在两色之间插值：amount = 0 取 bg，amount = 1 取 fg。
 *
 * 参数顺序容易搞混，所以统一写成 mix(往这个方向, 从这个方向, 比例),
 * 读作「把 fg 朝 bg 拉回 (1 - amount)」。
 */
function mix(fg, bg, amount) {
    const t = Math.min(1, Math.max(0, amount));
    return {
        r: fg.r * t + bg.r * (1 - t),
        g: fg.g * t + bg.g * (1 - t),
        b: fg.b * t + bg.b * (1 - t),
        a: 1,
    };
}

/**
 * 主色上该用白字还是黑字。
 *
 * 不用纯 WCAG 比较：品牌蓝 `#0b8ce9` 上黑字分数更高（6.2 vs 3.4），
 * 但 ComfyUI 自己所有主色按钮都是白字，生成黑字会跟整个界面拧着。
 * 所以按亮度阈值走：够亮才用黑字，其余一律白字。
 */
function contrastText(bg) {
    const solid = flatten(bg, null);
    const l = relativeLuminance(solid);
    return l > 0.55 ? toHex(BLACK) : toHex(WHITE);
}

function readColor(...candidates) {
    for (const text of candidates) {
        if (typeof text !== "string") {
            continue;
        }
        const color = parseColor(text);
        if (color) {
            return color;
        }
    }
    return null;
}

// ── 认格式 ───────────────────────────────────────────────

/**
 * 是不是 ComfyUI 官方主题文件。
 *
 * 判据：有 colors 对象，且三个已知段落里至少有一个。
 * 我们自己导出的文件有 theme_overrides，优先按自家格式处理。
 */
export function looksLikeOfficialTheme(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return false;
    }
    if (value.theme_overrides) {
        return false;
    }
    const colors = value.colors;
    if (!colors || typeof colors !== "object") {
        return false;
    }
    return ["theme", "comfy_base", "litegraph_base"].some(
        (key) => colors[key] && typeof colors[key] === "object"
    );
}

/** 亮还是暗：先信 light_theme，再按背景亮度判断。 */
export function officialThemeMode(value) {
    if (value?.light_theme === true) {
        return "light";
    }
    const colors = value?.colors || {};
    const bg = readColor(
        colors.theme?.background,
        colors["comfy_base"]?.["bg-color"],
        colors["litegraph_base"]?.NODE_DEFAULT_COLOR
    );
    if (bg) {
        return relativeLuminance(flatten(bg, null)) > 0.5 ? "light" : "dark";
    }
    return "dark";
}

// ── 取色（三层兜底）──────────────────────────────────────

function paletteOf(value) {
    const colors = value?.colors || {};
    const theme = colors.theme || {};
    const comfy = colors["comfy_base"] || {};
    const lite = colors["litegraph_base"] || {};
    const mode = officialThemeMode(value);

    // 数一数到底从文件里读到了几个颜色。一个都没读到（比如
    // `{"colors": {"theme": {}}}` 这种空壳）就不该凭空编一套默认色出来，
    // 否则用户导入一个空文件，界面会显示「成功导入 26 项」。
    let hits = 0;
    const take = (...candidates) => {
        const color = readColor(...candidates);
        if (color) {
            hits += 1;
        }
        return color;
    };

    const background =
        take(
            theme.background,
            comfy["bg-color"],
            comfy["comfy-menu-bg"],
            lite.NODE_DEFAULT_COLOR
        ) || parseColor(FALLBACK.background);

    const foreground =
        take(
            theme.foreground,
            comfy["fg-color"],
            comfy["input-text"],
            lite.WIDGET_TEXT_COLOR,
            lite.NODE_TITLE_COLOR
        ) || parseColor(FALLBACK.foreground);

    // 卡片色要先落到变量上：下面 accent / secondary 的兜底都要用它，
    // 写在同一个对象字面量里没法自己引用自己。
    const card =
        take(
            theme.card,
            comfy["comfy-menu-bg"],
            lite.NODE_DEFAULT_BGCOLOR
        ) || background;

    return {
        hits,
        mode,
        background,
        foreground,
        card,
        border:
            take(
                theme.border,
                comfy["border-color"],
                lite.NODE_DEFAULT_BOXCOLOR,
                lite.WIDGET_OUTLINE_COLOR
            ) || parseColor(FALLBACK.border),
        mutedForeground:
            take(
                theme["muted-foreground"],
                comfy["descrip-text"],
                lite.WIDGET_SECONDARY_TEXT_COLOR,
                lite.NODE_TEXT_COLOR
            ) || mix(foreground, background, 0.55),
        accent:
            take(
                theme.accent,
                comfy["comfy-menu-secondary-bg"],
                comfy["comfy-input-bg"],
                lite.WIDGET_BGCOLOR
            ) || card,
        secondary:
            take(
                theme.secondary,
                comfy["comfy-menu-secondary-bg"],
                lite.WIDGET_BGCOLOR
            ) || card,
        primary:
            take(
                theme.primary,
                lite.LINK_COLOR,
                lite.NODE_SELECTED_TITLE_COLOR
            ) || parseColor(FALLBACK.primary),
        error:
            take(theme.destructive, comfy["error-text"]) ||
            parseColor(FALLBACK.error),
        // 链接色：官方主题的强调色基本都是蓝/青系，直接拿来用最贴原意。
        link:
            take(theme.primary, lite.LINK_COLOR) ||
            parseColor(FALLBACK.primary),
    };
}


// ── 26 项 ────────────────────────────────────────────────

/**
 * 官方给不出的那些项怎么算。
 *
 * 原则：**顺着明暗方向推**，而不是硬编码某个亮度值。
 * 深色主题里「浮起来」= 往前景（白）靠；浅色里「沉下去」= 往前景（黑）靠。
 * 所以 mix(foreground, background, 比例) 在两个模式下方向自动正确。
 */
function buildTokens(p) {
    const { mode, background: bg, foreground: fg } = p;
    const light = mode === "light";

    // 全屏预览是一套独立层级，官方没有对应字段，按背景相对关系造：
    // 深色：面板比背景亮一点；浅色：面板比背景暗一点点，浮起层用纯背景。
    const fsPanel = mix(fg, bg, light ? 0.02 : 0.06);
    const fsPanelRaised = mix(fg, bg, light ? 0 : 0.11);

    return {
        // 窗口
        "--xdh-clr-canvas": toHex(bg),
        "--xdh-clr-surface-soft": toHex(p.accent),
        "--xdh-clr-surface-card": toHex(p.card),
        "--xdh-clr-surface-strong": toHex(p.secondary),

        // 文字
        "--xdh-clr-ink": toHex(fg),
        "--xdh-clr-body": toHex(mix(fg, bg, 0.85)),
        "--xdh-clr-muted": toHex(p.mutedForeground),
        "--xdh-clr-muted-soft": toHex(mix(p.mutedForeground, bg, 0.7)),

        // 线条
        "--xdh-clr-hairline": toHex(p.border),
        "--xdh-clr-hairline-soft": toHex(mix(p.border, bg, 0.5)),
        "--xdh-clr-border-strong": toHex(mix(fg, p.border, 0.25)),

        // 强调
        "--xdh-clr-primary": toHex(p.primary),
        "--xdh-clr-primary-active": toHex(mix(p.primary, BLACK, 0.88)),
        "--xdh-clr-on-primary": contrastText(p.primary),
        "--xdh-clr-legal-link": toHex(p.link),
        "--xdh-clr-error": toHex(p.error),
        "--xdh-clr-scrim": light ? "rgba(0, 0, 0, 0.5)" : "rgba(0, 0, 0, 0.7)",

        // 全屏预览
        "--xdh-fs-scrim": toRgba(bg, 0.5),
        "--xdh-fs-panel": toHex(fsPanel),
        "--xdh-fs-panel-raised": toHex(fsPanelRaised),
        "--xdh-fs-ink": toHex(fg),
        "--xdh-fs-ink-2": toHex(mix(fg, bg, 0.65)),
        "--xdh-fs-ink-3": toHex(mix(fg, bg, 0.5)),
        "--xdh-fs-line": toRgba(fg, light ? 0.08 : 0.1),
        "--xdh-fs-btn": toRgba(fg, light ? 0.04 : 0.08),
        "--xdh-fs-wave": toRgba(fg, light ? 0.03 : 0.05),
    };
}

// ── 对外 ────────────────────────────────────────────────

/**
 * 官方主题 → `{ mode, overrides, name, id }`。
 *
 * 只返回**一个模式**的 overrides：官方主题本身就是单模式的
 * （`light_theme: true` 表示浅色，否则深色）。
 * 调用方按 `mode` 合并进草稿，别整体替换——不然另一模式的
 * 自定义颜色会被无声抹掉。
 */
export function convertOfficialTheme(value) {
    const palette = paletteOf(value);
    // 一个来源色都没有 → 不生成，交给调用方报「没认出颜色」
    const overrides = palette.hits > 0 ? buildTokens(palette) : {};
    const name = typeof value?.name === "string" && value.name.trim()
        ? value.name.trim()
        : "";
    const id = typeof value?.id === "string" ? value.id.trim() : "";
    return {
        mode: palette.mode,
        overrides,
        name: name || id,
        id,
    };
}

/** 给人看的名字，认不出来时退回文件名。 */
export function describeOfficialTheme(value, fallback = "") {
    const name = typeof value?.name === "string" ? value.name.trim() : "";
    const id = typeof value?.id === "string" ? value.id.trim() : "";
    return name || id || fallback;
}

// ── 整个文件怎么读（组件只需要调这两个）──────────────────

/**
 * 读一个已经 JSON.parse 过的主题文件。
 *
 * 返回：
 *   - `official`  是不是 ComfyUI 官方格式
 *   - `title`     官方主题的显示名（认不出来时用文件名）
 *   - `incoming`  归一化后的 `{dark, light}`，只含文件里真有的模式
 *   - `modeHint`  文件里指明的模式（"" = 没说）
 *   - `count`     一共多少项
 *
 * `count === 0` 表示「没认出任何颜色」，调用方必须报错而不是报成功。
 */
export function readThemeFile(parsed, fileName = "") {
    if (looksLikeOfficialTheme(parsed)) {
        const converted = convertOfficialTheme(parsed);
        const incoming = { dark: {}, light: {} };
        incoming[converted.mode] = converted.overrides;
        return {
            official: true,
            title: describeOfficialTheme(parsed, fileName),
            incoming,
            modeHint: converted.mode,
            count: Object.keys(converted.overrides).length,
        };
    }

    const incoming = normalizeThemeOverrides(
        parsed?.theme_overrides || parsed
    );
    let modeHint = "";
    if (THEME_OVERRIDE_MODES.includes(parsed?.theme_mode)) {
        modeHint = parsed.theme_mode;
    }
    const count = THEME_OVERRIDE_MODES.reduce(
        (n, mode) => n + Object.keys(incoming[mode] || {}).length,
        0
    );
    return { official: false, title: "", incoming, modeHint, count };
}

/**
 * 把读进来的东西并到草稿里。
 *
 * 只替换文件里**真给了内容**的模式：文件只管深色时，浅色那边
 * 调了半天的不该跟着没。
 */
export function mergeIntoDraft(draft, incoming) {
    const next = {
        dark: { ...(draft?.dark || {}) },
        light: { ...(draft?.light || {}) },
    };
    for (const mode of THEME_OVERRIDE_MODES) {
        const group = incoming?.[mode] || {};
        if (Object.keys(group).length > 0) {
            next[mode] = { ...group };
        }
    }
    return next;
}
