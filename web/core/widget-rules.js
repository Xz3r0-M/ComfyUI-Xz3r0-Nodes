/**
 * 面板参数「跟着选择自动启用 / 禁用 / 隐藏」
 * =====================================
 *
 * 一句话：某个下拉框换了值，别的几项就跟着点亮或变灰——用一张声明表描述，
 * 不用每个节点各写一遍钩子。
 *
 * 为什么需要这个工具（两个渲染器差异）：
 * - 经典画布改参数会调 `node.onWidgetChanged`；
 * - Nodes 2.0 的 Vue 节点只调 `widget.callback`，**从不**碰
 *   `onWidgetChanged`（见前端 `processedWidgetRenderModel.ts` 的
 *   `createWidgetUpdateHandler`）。
 * 只挂其中一个，「另一个渲染器下切了没反应、不报错、控制台还没声音」。
 * 本工具把两个口子都挂上，调用方不用再关心这件事。
 *
 * 置灰状态写两处：`widget.disabled`（官方状态，画布用它判断能不能点，
 * 2.0 的 `processWidget` 也读它）和 `widget.options.disabled`（2.0 的各个
 * `Widget*.vue` 直接读它）。只写一处，换个前端版本就可能只生效一半。
 *
 * 用法（推荐：声明式，四个时机自动接管）：
 *
 *     import { registerWidgetRules } from "../core/widget-rules.js";
 *
 *     registerWidgetRules({
 *         nodeClass: "XImageResize",
 *         rules: [
 *             {
 *                 watch: "edge_mode",            // 驱动项
 *                 targets: {                     // 受影响的项 → 什么时候可用
 *                     target_edge: ["Long", "Short"],
 *                     megapixels: ["Megapixels"],
 *                     scale_multiplier: ["Scale Multiplier"],
 *                 },
 *             },
 *             {
 *                 watch: "divisible_mode",
 *                 targets: { divisible: ["Nearest", "Up", "Down"] },
 *             },
 *             {
 *                 watch: "pad_enabled",          // 布尔开关：可用 = 打开时
 *                 action: "hide",                // 可选：不显示而不是变灰
 *                 targets: {
 *                     pad_width: [true],
 *                     pad_height: [true],
 *                     pad_color: [true],
 *                 },
 *             },
 *         ],
 *     });
 *
 * 手动用法（节点已经建好了，或参数是程序改的）：
 *
 *     applyWidgetRules(node, rules);   // 立刻算一次，不挂监听
 *     watchWidgetRules(node, rules);   // 挂监听 + 记住规则 + 立刻算一次
 *     syncWidgetRules(node);           // 让已记住的规则全部重算一次
 *
 * 语义备忘：
 * - 表里**没提到**的项一律不碰（不会被强行点亮）。
 * - 同一项被多条规则提到时，只要有一条说「可以用」就算可以用。
 * - `targets` 的值可以是数组（可用值清单）、函数 `(驱动值, 节点) => 布尔`。
 *   函数形式的第二参是节点本身，所以「两个下拉框共同决定一项」也能写
 *   （例如「模式是 A 且比例是 Custom 时宽度才可用」）。
 *   注意合并语义是「任一规则说可用就可用」：同一项被多条规则提到时，
 *   几个函数都要算出**完整**的结论（而不是只看自己的驱动值），
 *   否则最后会被其它规则的结果盖掉。
 * - 比较前会把字符串 "true"/"false" 归一成布尔，老工作流里的字符串开关
 *   也能正确匹配。
 *
 * 动态子输入（DynamicCombo 的 `mode.xxx`）：
 * - 目标名带点（`"mode.chain_resample"`）表示它是某个下拉框展开出来的子项。
 *   这类子项在切换父下拉框时会被**整批销毁重建**（前端
 *   `dynamicWidgets.ts` 的 `updateWidgets` 里 `removeWidget` + 重新 add），
 *   挂在旧 widget 上的回调跟着一起没了。
 * - 所以本工具会把点号前面的宿主（`"mode"`）一并盯上，宿主一变就**重新
 *   挂一遍**回调，再重算。不这么做的话：切一次模式，之后所有子项都「改了
 *   没反应、不报错」。
 */

// 注意深度：本文件在 web/core/ 下，比 web/ 根部的扩展文件多一层，
// 所以要多退一级才能打到前端的 /scripts/app.js。
import { app } from "../../../scripts/app.js";

/* 挂到 node 上的私有状态：本节点记住了哪些规则。 */
const STATE_KEY = "__xwdrules";
/* 包在 widget.callback 外层的那一层的标记。 */
const WRAPPER_KEY = "__xwdrulesWrapper";

/* widget 还没挂完时的重试时机（毫秒）。2.0 下 widget 有时下一帧才注册。 */
const RETRY_DELAYS = [0, 120];

/* 已经声明过的节点类，防止同一个类被注册两次。 */
const REGISTERED = {};

/*
 * Nodes 2.0 的数值控件漏了禁用样式。
 *
 * 官方 2.0 里别的控件都做了：下拉框是整块 `opacity-50`，布尔按钮组和开关
 * 是 `disabled:opacity-50`，加减按钮也有。只有数值输入（前端
 * `ScrubableNumberInput.vue`）什么都没写——`:disabled` 只传给了内部的
 * `<input>` 和左右按钮，外面那层容器没有禁用态。而 `<input>` 的文字颜色是从
 * 父级继承来的 `text-foreground`（作者样式），直接把浏览器给禁用输入的默认灰
 * 盖掉了。
 *
 * 结果就是：置灰后的数值项只有两侧的小加减按钮变暗，中间那串数字还是亮的，
 * 一眼看过去看不出来它已经不能改了。（经典画布没这个问题：那边是
 * `ctx.fillStyle = disabled ? disabledTextColor : text_color`，默认
 * `WIDGET_DISABLED_TEXT_COLOR = '#666'`。）
 *
 * 所以这里给中间那串数字补上跟两侧按钮**完全相同**的一套：
 * `--muted-foreground` + `opacity: 0.3`。
 *
 * 两侧按钮本身就是这么来的（v1.59.6 的 `ScrubableNumberInput.vue`）：
 *
 *     <Button variant="muted-textonly" class="... disabled:opacity-30">
 *                           └ text-muted-foreground
 *
 * 也就是 `0.3 × #494a50 + 0.7 × #e1e1e1 ≈ #B3B3B3`——浅色主题下那层浅灰。
 * 文字用同一套，整行就一个颜色了，而不是「按钮浅、数字深」。
 *
 * （试过的两个错版：`opacity: 0.5` 单独用 → 跟背景混，主题一变就变；
 * `--node-foreground`（浅色 `#444444`）→ 比按钮深一截。）
 *
 * 为什么用 `inputmode="decimal"` 而不是 `data-part`：
 * `data-part="widget-number"` / `data-part="widget-value"` 是前端**后来才
 * 加**的定位标记，v1.59.6（用户机器上的版本）里压根没有，按那个写会一个
 * 元素都选不到，看上去就是「补丁没生效」。而 `inputmode="decimal"` 是写死
 * 在 `ScrubableNumberInput.vue` 模板上的，两个版本都有，而且只出现在数值
 * 输入上（文本框不用它），正好就是我们要的范围。（教训：定论前先 `git
 * show <用户版本 tag>:<文件>`，别拿本机 clone 的 HEAD 当回事。）
 *
 * 作用域限定在 `.lg-node`（只存在于 Nodes 2.0 的节点容器，两个版本都有），
 * 经典画布不受影响——那边数值是 canvas 画的，没有 `<input>`。
 *
 * 将来官方自己补上后：
 * - 如果官方给这个 input 也补了 `disabled:opacity-30` + 颜色，两边结果一样，
 *   谁盖谁都无所谓；
 * - 如果发现官方补过了，把下面四行删掉就行。
 */
const NODES2_DISABLED_STYLE_ID = "xwdrules-nodes2-disabled";
const NODES2_DISABLED_CSS = `
.lg-node input[inputmode="decimal"]:disabled {
    color: var(--muted-foreground, var(--foreground));
    opacity: 0.3;
}
`;

/** 把上面那段样式插进页面（没插过的才插，重复调用无害）。 */
function installNodes2DisabledStyle() {
    try {
        if (typeof document === "undefined") return;
        if (document.getElementById(NODES2_DISABLED_STYLE_ID)) return;
        const style = document.createElement("style");
        style.id = NODES2_DISABLED_STYLE_ID;
        style.textContent = NODES2_DISABLED_CSS;
        const host = document.head || document.documentElement;
        if (!host) return;
        host.appendChild(style);
    } catch (error) {
        /* 样式补丁失败不该影响节点本身 */
    }
}

installNodes2DisabledStyle();

/**
 * 把驱动值统一成便于比较的样子。
 *
 * 只处理一种情况：老工作流里开关可能存成字符串，"true" 要能匹配 true。
 * 其余原样返回，避免 `1` 和 `"1"` 这种相互猜心思带来的意外。
 */
function normalizeValue(value) {
    if (typeof value === "string") {
        const lowered = value.trim().toLowerCase();
        if (lowered === "true") return true;
        if (lowered === "false") return false;
    }
    return value;
}

/**
 * 驱动值是否在「可用条件」里。
 *
 * allow 是数组时按清单比对；是函数时直接问它——函数拿得到节点，所以
 * 「看两个下拉框一起判断」也能写（`(value, node) => ...`）。
 */
function allowMatches(allow, value, node) {
    if (typeof allow === "function") return !!allow(value, node);
    const list = Array.isArray(allow) ? allow : [allow];
    const current = normalizeValue(value);
    for (let i = 0; i < list.length; i += 1) {
        if (normalizeValue(list[i]) === current) return true;
    }
    return false;
}

function widgetOf(node, name) {
    const widgets = node && node.widgets;
    if (!widgets) return null;
    for (let i = 0; i < widgets.length; i += 1) {
        if (widgets[i] && widgets[i].name === name) return widgets[i];
    }
    return null;
}

function widgetValue(node, name) {
    const widget = widgetOf(node, name);
    return widget ? widget.value : undefined;
}

/**
 * 把规则表编译成「要盯哪几个驱动项 + 每项归谁管」。
 *
 * 同一张表会被反复应用（几个时机都会调），所以先编译成固定形状，
 * 避免每次现算。
 */
/* 同一份规则表 → 编译结果，避免几次重试各编一份（否则规则集会越堆越多）。 */
const COMPILED_CACHE = new WeakMap();

/**
 * 拿规则表的编译结果（同一份表只编一次）。
 *
 * 用 WeakMap 按「规则表对象本身」缓存：调用方只要传同一个数组/对象，
 * 就会一直拿到同一个编译结果，重复调用天然幂等。
 */
function compiledOf(rules) {
    if (!rules || typeof rules !== "object") return compileRules(rules);
    const cached = COMPILED_CACHE.get(rules);
    if (cached) return cached;
    const compiled = compileRules(rules);
    COMPILED_CACHE.set(rules, compiled);
    return compiled;
}

export function compileRules(rules) {
    const list = Array.isArray(rules) ? rules : [rules];
    const compiled = [];
    const watching = [];
    /* 宿主（`mode` 这种）→ 它一变化就把子 widget 全部重挂 */
    const remount = [];

    const watchOnce = (name) => {
        if (watching.indexOf(name) < 0) watching.push(name);
    };

    list.forEach((rule) => {
        if (!rule || !rule.watch || !rule.targets) return;
        const action = rule.action === "hide" ? "hide" : "disable";
        const targets = Object.keys(rule.targets).map((name) => {
            /* 动态子输入（"mode.xxx"）：把宿主也盯上。见文件开头说明。 */
            const dot = name.indexOf(".");
            if (dot > 0) {
                const host = name.slice(0, dot);
                if (remount.indexOf(host) < 0) remount.push(host);
                watchOnce(host);
            }
            return { name, allow: rule.targets[name] };
        });
        compiled.push({ watch: rule.watch, action, targets });
        watchOnce(rule.watch);
    });

    return { rules: compiled, watching, remount };
}

/**
 * 把新算出来的状态并进已有状态。
 *
 * 合并规则：
 * - 「能不能用」用或：任一条说能用就算能用（模块之间不该互相掐）；
 * - 「要不要藏」要求所有相关规则都想藏才藏（别人只想置灰时不能被藏掉）。
 */
function mergeState(previous, next) {
    if (!previous) return { enabled: next.enabled, action: next.action };
    return {
        enabled: previous.enabled || next.enabled,
        action:
            previous.action === "hide" && next.action === "hide"
                ? "hide"
                : "disable",
    };
}

/**
 * 按驱动项当前的值，算出「每一项该不该可用」。
 *
 * 返回 Map<widget 名, { enabled, action }>。
 */
export function evaluateRules(node, compiled) {
    const wanted = new Map();

    compiled.rules.forEach((rule) => {
        const value = widgetValue(node, rule.watch);
        rule.targets.forEach((target) => {
            const state = {
                enabled: allowMatches(target.allow, value, node),
                action: rule.action,
            };
            wanted.set(target.name, mergeState(wanted.get(target.name), state));
        });
    });

    return wanted;
}

/**
 * 把多份规则表的结果并在一起。
 *
 * 不同模块可以各自给同一个节点注册规则（例如「参数联动」和「某个面板的
 * 附加开关」），合并后不会互相覆盖。
 */
function collectWanted(node, sets) {
    const merged = new Map();
    sets.forEach((compiled) => {
        evaluateRules(node, compiled).forEach((state, name) => {
            merged.set(name, mergeState(merged.get(name), state));
        });
    });
    return merged;
}

/**
 * 置灰 / 解除置灰，返回「真的改了」。
 *
 * 两处一起写，理由见文件开头。
 */
function setWidgetDisabled(widget, disabled) {
    const next = !!disabled;
    let changed = false;

    if (!!widget.disabled !== next) {
        widget.disabled = next;
        changed = true;
    }
    if (widget.options && !!widget.options.disabled !== next) {
        widget.options.disabled = next;
        changed = true;
    }

    return changed;
}

/**
 * 藏起来 / 放出来，返回「真的改了」。
 *
 * 用官方的 `widget.hidden`：它写进 widget 的可见性组件，两个渲染器都认。
 * 隐藏时照样置灰——万一某个老前端不认 `hidden`，至少还是「点不动」，
 * 不会变成「看不见但还能误点」。
 */
function setWidgetHidden(widget, hidden) {
    const next = !!hidden;
    if (!!widget.hidden === next) return false;
    widget.hidden = next;
    return true;
}

/**
 * 把「该不该可用」落到 widget 上，返回是否真的改了。
 */
function applyWanted(node, wanted) {
    let changed = false;

    wanted.forEach((state, name) => {
        const widget = widgetOf(node, name);
        if (!widget) return;
        if (setWidgetDisabled(widget, !state.enabled)) changed = true;
        if (state.action !== "hide") return;
        if (setWidgetHidden(widget, !state.enabled)) changed = true;
    });

    return changed;
}

function redraw(node, changed) {
    if (!changed) return false;
    if (typeof node.setDirtyCanvas === "function") {
        node.setDirtyCanvas(true, true);
    }
    return true;
}

/**
 * 立刻按规则算一次（不挂监听，也不记住规则）。
 *
 * 适合「参数是程序改的」这种场景：改完值以后补一句。
 */
export function applyWidgetRules(node, rules) {
    if (!node) return false;
    const wanted = collectWanted(node, [compiledOf(rules)]);
    const changed = applyWanted(node, wanted);
    redraw(node, changed);
    return changed;
}

function stateOf(node) {
    if (!node[STATE_KEY]) {
        node[STATE_KEY] = { sets: [] };
    }
    return node[STATE_KEY];
}

/**
 * 让本节点记住的规则全部重算一次，返回是否真的改了。
 *
 * 规则是「加起来」的：多个模块各自的规则互不覆盖。
 */
export function syncWidgetRules(node) {
    const state = node && node[STATE_KEY];
    if (!state) return false;

    const changed = applyWanted(node, collectWanted(node, state.sets));
    redraw(node, changed);
    return changed;
}

/**
 * 给一个驱动项挂上回调（挂过就不再套）。
 *
 * 挂的是 widget 自己的 callback，因为 Nodes 2.0 改参数只走这一条；原来的
 * callback 照旧执行，只在其后补一次重算。
 *
 * 记下自己包出来的那一层：已经是最外层就不再套（防止一次改动跑多遍），
 * 但如果别人后来把 callback 换掉了，下次会重新包上，不至于静悄悄失效。
 */
function watchWidget(node, name, compiled) {
    const widget = widgetOf(node, name);
    if (!widget || widget.callback === widget[WRAPPER_KEY]) return false;

    const original = widget.callback;
    const wrapper = function () {
        const result = original ? original.apply(this, arguments) : undefined;
        const owner = this && this.node ? this.node : node;
        refreshAfterChange(owner, compiled, name);
        return result;
    };
    widget[WRAPPER_KEY] = wrapper;
    widget.callback = wrapper;
    return true;
}

/**
 * 把一个节点的所有驱动项都挂上回调（挂过的会被跳过）。
 *
 * 宿主变化后要重跑一遍：它底下的子 widget 已经换成新对象了。
 */
function mountWatched(node, compiled) {
    compiled.watching.forEach((name) => {
        watchWidget(node, name, compiled);
    });
}

/**
 * 某个驱动项变化之后要做的事。
 *
 * 普通驱动项只需重算；宿主（DynamicCombo 的 `mode`）要先重新挂一遍——
 * 它一变化就把 `mode.*` 子 widget 整批换新，旧回调跟着旧 widget 一起没了。
 */
function refreshAfterChange(node, compiled, name) {
    if (compiled && compiled.remount.indexOf(name) >= 0) {
        mountWatched(node, compiled);
    }
    syncWidgetRules(node);
}

/**
 * 记住规则并挂好监听，返回「这份规则是不是新记下的」。
 *
 * 同一个节点重复调用是安全的：规则集会去重，回调也不会套娃。
 */
export function watchWidgetRules(node, rules) {
    if (!node) return false;
    const compiled = compiledOf(rules);
    if (!compiled.rules.length) return false;

    const state = stateOf(node);
    const isNew = state.sets.indexOf(compiled) < 0;
    if (isNew) state.sets.push(compiled);
    mountWatched(node, compiled);
    syncWidgetRules(node);
    return isNew;
}

/**
 * 节点刚建好 / 刚读进工作流时 widget 可能还没挂完，所以下一拍再补两次。
 */
function deferredWatch(node, rules) {
    watchWidgetRules(node, rules);
    RETRY_DELAYS.forEach((delay) => {
        setTimeout(() => {
            watchWidgetRules(node, rules);
        }, delay);
    });
}

/**
 * 最省事的入口：声明「哪个节点类、什么规则」，其余时机全自动。
 *
 * 会接上 onNodeCreated / onConfigure / onAdded / onWidgetChanged 四处，
 * 并对 widget 未就绪的情况做两次短重试。
 */
export function registerWidgetRules(options) {
    const config = options || {};
    const nodeClass = config.nodeClass;
    if (!nodeClass) {
        console.warn("[xwdrules] registerWidgetRules 缺少 nodeClass");
        return false;
    }

    const added = Array.isArray(config.rules)
        ? config.rules.slice()
        : [config.rules];
    if (!added.length || !added[0]) {
        console.warn("[xwdrules] registerWidgetRules 缺少 rules");
        return false;
    }

    // 同一个节点类再来一份规则：并进同一个扩展，不重复挂钩子
    const existing = REGISTERED[nodeClass];
    if (existing) {
        existing.rules.push(...added);
        existing.version += 1;
        return true;
    }

    const entry = { rules: added, version: 1 };
    REGISTERED[nodeClass] = entry;

    // 规则可能在扩展注册后才被追加，所以每次现取（按版本号记忆化）
    const compiledOfEntry = () => {
        if (!entry.cached || entry.cachedVersion !== entry.version) {
            entry.cached = compiledOf(entry.rules);
            entry.cachedVersion = entry.version;
        }
        return entry.cached;
    };

    app.registerExtension({
        name:
            config.name ||
            `ComfyUI.Xz3r0.WidgetRules.${nodeClass}`,
        beforeRegisterNodeDef(nodeType, nodeData) {
            if (!nodeData || nodeData.name !== nodeClass) return;
            const proto = nodeType.prototype;

            const origCreated = proto.onNodeCreated;
            proto.onNodeCreated = function () {
                const result = origCreated
                    ? origCreated.apply(this, arguments)
                    : undefined;
                deferredWatch(this, entry.rules);
                return result;
            };

            const origConfigure = proto.onConfigure;
            proto.onConfigure = function () {
                const result = origConfigure
                    ? origConfigure.apply(this, arguments)
                    : undefined;
                deferredWatch(this, entry.rules);
                return result;
            };

            const origAdded = proto.onAdded;
            proto.onAdded = function () {
                const result = origAdded
                    ? origAdded.apply(this, arguments)
                    : undefined;
                watchWidgetRules(this, entry.rules);
                return result;
            };

            const origWidgetChanged = proto.onWidgetChanged;
            proto.onWidgetChanged = function (name) {
                const result = origWidgetChanged
                    ? origWidgetChanged.apply(this, arguments)
                    : undefined;
                const compiled = compiledOfEntry();
                if (compiled.watching.indexOf(name) >= 0) {
                    refreshAfterChange(this, compiled, name);
                }
                return result;
            };
        },
    });

    return true;
}

/** 测试用：忘掉「已注册」记录，好让同一个类能重新注册。 */
export function resetWidgetRulesForTest() {
    Object.keys(REGISTERED).forEach((key) => {
        delete REGISTERED[key];
    });
}

/* 供测试与调用方使用的小工具 */

/* 供测试与调用方使用的小工具 */
export const widgetRulesInternals = {
    normalizeValue,
    allowMatches,
    widgetOf,
    widgetValue,
    compiledOf,
    setWidgetDisabled,
    setWidgetHidden,
    STATE_KEY,
    WRAPPER_KEY,
    RETRY_DELAYS,
};
