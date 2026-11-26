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

    list.forEach((rule) => {
        if (!rule || !rule.watch || !rule.targets) return;
        const action = rule.action === "hide" ? "hide" : "disable";
        const targets = Object.keys(rule.targets).map((name) => ({
            name,
            allow: rule.targets[name],
        }));
        compiled.push({ watch: rule.watch, action, targets });
        if (watching.indexOf(rule.watch) < 0) watching.push(rule.watch);
    });

    return { rules: compiled, watching };
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
function watchWidget(node, name) {
    const widget = widgetOf(node, name);
    if (!widget || widget.callback === widget[WRAPPER_KEY]) return false;

    const original = widget.callback;
    const wrapper = function () {
        const result = original ? original.apply(this, arguments) : undefined;
        const owner = this && this.node ? this.node : node;
        syncWidgetRules(owner);
        return result;
    };
    widget[WRAPPER_KEY] = wrapper;
    widget.callback = wrapper;
    return true;
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
    compiled.watching.forEach((name) => {
        watchWidget(node, name);
    });
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
                if (compiledOfEntry().watching.indexOf(name) >= 0) {
                    syncWidgetRules(this);
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
