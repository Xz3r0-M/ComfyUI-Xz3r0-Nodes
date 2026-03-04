/**
 * XFitView - ComfyUI 自动适应视图扩展
 * ===========================================
 * 版本: 1.3.0 - 2025-03-04
 *
 * 功能概述:
 * ---------
 * 在首次打开网页或载入新工作流时，自动执行"适应视图"功能，
 * 确保工作流内容完整显示在画布可视区域内。
 *
 * 核心功能:
 * ---------
 * 1. 工作流加载适应:
 *    - 页面首次加载完成后自动适应视图
 *    - 监听工作流加载事件(onConfigure, loadGraphData)
 *    - 新工作流载入后自动适应视图
 *
 * 2. 子图页面适应:
 *    - 监听面包屑导航变化检测子图进入
 *    - 进入子图页面后自动适应视图
 *    - 支持嵌套子图检测
 *
 * 3. 智能去重机制:
 *    - 基于工作流特征生成唯一标识(节点类型、连接拓扑)
 *    - "first"模式: 同一会话中相同工作流只适应一次
 *    - "always"模式: 每次加载都适应
 *    - "never"模式: 禁用自动适应
 *
 * 4. 防抖控制:
 *    - 同一工作流200ms内多次触发只执行一次
 *    - 不同工作流之间立即触发
 *
 * 5. 设置选项:
 *    - Workflow Enter Mode: 主工作流加载时 (first/always/never)
 *    - Workflow Exit Mode: 从子图退出到主工作流时 (first/always/never)
 *    - Subgraph Enter Mode: 进入子图时 (first/always/never)
 *    - Subgraph Exit Mode: 退出子图时 (first/always/never)
 *    - 适应延迟时间: 0-2000ms可调
 *    - 注册到 Xz3r0 设置分类
 *
 * 技术实现:
 * ---------
 * - 使用 ComfyUI 扩展 API (app.registerExtension)
 * - 通过 app.canvas 访问画布对象
 * - 监听 app.graph.onConfigure 事件
 * - 重写 app.loadGraphData 方法
 * - 使用 MutationObserver 监听面包屑导航变化
 * - 使用 setTimeout 确保 DOM 和画布已就绪
 * - 基于节点特征和连接关系生成工作流哈希标识
 *
 * 文件结构:
 * ---------
 * - XFitView.js: 扩展主文件（此文件）
 *
 * @author Xz3r0
 * @project ComfyUI-Xz3r0-Nodes
 */

import { app } from "../../scripts/app.js";

// ============================================
// 工作流识别与管理
// ============================================

/**
 * cyrb53 哈希算法 - 提供高质量的字符串哈希
 * 基于 https://github.com/bryc/code/blob/master/jshash/experimental/cyrb53.js
 * 相比简单哈希(djb2)，具有更低的冲突概率和更好的分布性
 * @param {string} str - 输入字符串
 * @param {number} seed - 随机种子
 * @returns {string} 16进制哈希字符串（16位）
 */
function cyrb53(str, seed = 0) {
    let h1 = 0xdeadbeef ^ seed;
    let h2 = 0x41c6ce57 ^ seed;

    for (let i = 0; i < str.length; i++) {
        const ch = str.charCodeAt(i);
        h1 = Math.imul(h1 ^ ch, 2654435761);
        h2 = Math.imul(h2 ^ ch, 1597334677);
    }

    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507)
        ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507)
        ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);

    // 返回64位哈希值的16进制字符串（16位字符）
    return (h2 >>> 0).toString(16).padStart(8, '0')
        + (h1 >>> 0).toString(16).padStart(8, '0');
}

/**
 * 获取工作流的唯一标识
 * 基于工作流数据的特征（节点类型、属性值、连接拓扑）
 * 使用稳定的特征组合（不包含位置/大小/运行时ID等会变化的属性）
 * 使用 cyrb53 哈希算法，提供64位哈希值，显著降低冲突概率
 * @returns {string|null} 工作流标识符
 */
function getWorkflowId() {
    if (!app.graph || !app.graph.nodes) return null;

    const nodes = app.graph.nodes;
    if (nodes.length === 0) return 'empty';

    // 为每个节点创建稳定的索引（基于节点在数组中的位置）
    const nodeIndexMap = new Map();
    nodes.forEach((n, idx) => {
        nodeIndexMap.set(n.id, idx);
    });

    // 使用稳定的特征：节点类型 + 关键属性（不包含位置、大小等UI相关属性）
    const nodeSignatures = nodes
        .map((n, idx) => {
            // 收集节点的关键属性值（widgets_values 包含节点的配置参数）
            const widgetValues = n.widgets_values
                ? JSON.stringify(n.widgets_values)
                : '';
            // 使用节点索引而非运行时ID
            return `${idx}:${n.type}:${widgetValues}`;
        })
        .join('|');

    // 包含连接信息 - 使用节点索引而非运行时ID
    const links = app.graph.links || {};
    const linkList = Object.values(links).filter(l => l != null);

    const linkSignatures = linkList
        .map(l => {
            const originIdx = nodeIndexMap.get(l.origin_id) ?? '?';
            const targetIdx = nodeIndexMap.get(l.target_id) ?? '?';
            return `${originIdx}-${l.origin_slot}-${targetIdx}-${l.target_slot}`;
        })
        .sort()
        .join('|');

    // 使用 cyrb53 生成64位哈希
    const str = `${nodes.length}|${nodeSignatures}|${linkList.length}|${linkSignatures}`;
    const hash = cyrb53(str);

    return `wf_${hash}`;
}

/**
 * 当前会话中已适应的工作流（进入时，内存存储，页面刷新后重置）
 */
const fittedWorkflows = new Set();

/**
 * 当前会话中已适应的子图（进入时，内存存储，页面刷新后重置）
 */
const fittedSubgraphs = new Set();

/**
 * 当前会话中已适应的退出场景（退出子图后返回时，内存存储，页面刷新后重置）
 */
const fittedExits = new Set();

/**
 * 防抖控制 - 防止短时间内多次触发适应视图
 * 只在同一个工作流内防抖，不同工作流之间立即触发
 */
let fitViewTimeout = null;
let lastFitTime = 0;
let lastWorkflowId = null;
const FIT_DEBOUNCE_MS = 200; // 同一工作流200ms内只触发一次

/**
 * 标记工作流已适应
 * @param {string} workflowId - 工作流标识符
 */
function markWorkflowFitted(workflowId) {
    fittedWorkflows.add(workflowId);
}

/**
 * 检查工作流是否已适应
 * @param {string} workflowId - 工作流标识符
 * @returns {boolean} 是否已适应
 */
function isWorkflowFitted(workflowId) {
    return fittedWorkflows.has(workflowId);
}

/**
 * 标记子图已适应
 * @param {string} subgraphId - 子图标识符
 */
function markSubgraphFitted(subgraphId) {
    fittedSubgraphs.add(subgraphId);
}

/**
 * 检查子图是否已适应
 * @param {string} subgraphId - 子图标识符
 * @returns {boolean} 是否已适应
 */
function isSubgraphFitted(subgraphId) {
    return fittedSubgraphs.has(subgraphId);
}

/**
 * 标记退出场景已适应
 * @param {string} workflowId - 工作流标识符
 */
function markExitFitted(workflowId) {
    fittedExits.add(workflowId);
}

/**
 * 检查退出场景是否已适应
 * @param {string} workflowId - 工作流标识符
 * @returns {boolean} 是否已适应
 */
function isExitFitted(workflowId) {
    return fittedExits.has(workflowId);
}

// ============================================
// 子图检测与管理
// ============================================

/**
 * 调试模式开关
 */
const DEBUG = false;

/**
 * 调试日志输出
 * @param {...any} args - 日志参数
 */
function debugLog(...args) {
    if (DEBUG) {
        console.log('[XFitView]', ...args);
    }
}

/**
 * 获取当前子图标识
 * 基于面包屑导航中的子图名称生成唯一标识
 * @param {boolean} silent - 是否静默模式（不输出日志）
 * @returns {string|null} 子图标识符，如果不在子图中则返回null
 */
function getCurrentSubgraphId(silent = true) {
    // 查找面包屑导航中的所有子图名称项
    // 面包屑结构: Unsaved Workflow / SubgraphName
    const breadcrumbItems = document.querySelectorAll('.p-breadcrumb-item-label');

    if (!silent) {
        debugLog('Found breadcrumb items:', breadcrumbItems.length);
    }

    if (breadcrumbItems.length <= 1) {
        // 只有一项或没有，说明不在子图中
        return null;
    }

    // 收集面包屑中的所有项目名称（排除第一个工作流名称）
    const subgraphNames = [];
    for (let i = 1; i < breadcrumbItems.length; i++) {
        const name = breadcrumbItems[i].textContent?.trim();
        if (name) {
            subgraphNames.push(name);
        }
    }

    if (!silent) {
        debugLog('Subgraph names:', subgraphNames);
    }

    if (subgraphNames.length === 0) {
        return null;
    }

    // 生成子图标识：使用层级路径
    const subgraphPath = subgraphNames.join('/');
    const hash = cyrb53(subgraphPath);

    const subgraphId = `sg_${hash}`;
    if (!silent) {
        debugLog('Generated subgraph ID:', subgraphId, 'from path:', subgraphPath);
    }

    return subgraphId;
}

/**
 * 检查当前是否在子图页面中
 * @returns {boolean} 是否在子图页面
 */
function isInSubgraph() {
    return getCurrentSubgraphId() !== null;
}

/**
 * 子图变化观察器
 * 用于监听面包屑导航变化
 */
let subgraphObserver = null;
let lastSubgraphId = null;

/**
 * 子图适应视图防抖定时器
 */
let subgraphFitTimeout = null;

/**
 * 子图适应视图的独立防抖时间戳
 */
let lastSubgraphFitTime = 0;

/**
 * 执行子图适应视图操作
 * @param {number} delay - 延迟时间（毫秒）
 * @param {boolean} checkSubgraph - 是否检查子图是否已适应
 * @param {string} subgraphMode - 子图适应模式
 */
function fitSubgraphToView(delay = 100, checkSubgraph = false) {
    const subgraphId = getCurrentSubgraphId();

    // 立即检查防抖条件，避免不必要的定时器创建
    const now = Date.now();
    if (subgraphId === lastSubgraphId && (now - lastSubgraphFitTime < FIT_DEBOUNCE_MS)) {
        return;
    }

    debugLog('fitSubgraphToView called for:', subgraphId);

    // 清除之前的定时器
    if (subgraphFitTimeout) {
        clearTimeout(subgraphFitTimeout);
    }

    subgraphFitTimeout = setTimeout(() => {
        try {
            // 再次检查是否在子图中（延迟后状态可能变化）
            if (!isInSubgraph()) {
                debugLog('Not in subgraph after delay, skipping');
                return;
            }

            // 再次检查画布是否为空
            if (isCanvasEmpty()) {
                debugLog('Canvas is empty after delay, skipping');
                return;
            }

            const currentSubgraphId = getCurrentSubgraphId();
            debugLog('Executing fit for subgraph:', currentSubgraphId);

            // 更新状态
            lastSubgraphFitTime = Date.now();
            lastSubgraphId = currentSubgraphId;

            // 如果启用了子图检查，则验证是否为首次加载
            if (checkSubgraph) {
                if (currentSubgraphId && isSubgraphFitted(currentSubgraphId)) {
                    debugLog('Subgraph already fitted:', currentSubgraphId);
                    return;
                }
                // 标记为已适应
                if (currentSubgraphId) {
                    markSubgraphFitted(currentSubgraphId);
                    debugLog('Marked subgraph as fitted:', currentSubgraphId);
                }
            }

            // 使用多种方式查找 Fit View 按钮（优先使用图标类名，支持多语言）
            const fitViewButton =
                // 1. 优先：通过 lucide focus 图标类名（语言无关）
                document.querySelector('button i.icon-\[lucide--focus\]')?.closest('button') ||
                document.querySelector('i.icon-\[lucide--focus\]')?.closest('button') ||
                // 2. 通过部分类名匹配
                document.querySelector('button i[class*="lucide--focus"]')?.closest('button') ||
                document.querySelector('i[class*="lucide--focus"]')?.closest('button') ||
                // 3. 中文版本（aria-label）
                document.querySelector('button[aria-label*="适应视图"]') ||
                document.querySelector('button[aria-label*="适应"]') ||
                // 4. 英文版本（aria-label）
                document.querySelector('button[aria-label*="Fit View" i]') ||
                // 5. 备用方案：查找包含 focus 图标的按钮
                Array.from(document.querySelectorAll('button')).find(btn =>
                    btn.querySelector('i[class*="focus"]') ||
                    btn.querySelector('svg[class*="focus"]')
                );

            debugLog('Fit View button found:', !!fitViewButton);

            if (fitViewButton) {
                debugLog('Clicking Fit View button');
                fitViewButton.click();
            } else {
                debugLog('Fit View button not found!');
            }
        } catch (error) {
            debugLog('Error in fitSubgraphToView:', error);
        } finally {
            // 清理定时器引用
            subgraphFitTimeout = null;
        }
    }, delay);
}

/**
 * 子图进入检测的多种方法
 */

/**
 * 通过检测子图按钮点击来触发适应
 * 子图节点右上角有一个进入子图的按钮
 * @param {string} enterMode - 进入子图时的适应模式
 * @param {string} exitMode - 退出子图时的适应模式
 * @param {number} delay - 适应延迟（毫秒）
 */
function setupSubgraphButtonListener(enterMode, exitMode, delay) {
    if (enterMode === "Never" && exitMode === "Never") {
        return;
    }

    debugLog('Setting up subgraph button listener');

    // 监听整个文档的点击事件
    document.addEventListener('click', (e) => {
        const target = e.target;
        const button = target.closest('button');

        // ========== 检查是否是子图进入按钮 ==========
        const isSubgraphButton = button?.querySelector('i[class*="lucide"], i[class*="subgraph"], [class*="subgraph"]') ||
                                 target.closest('[title*="subgraph" i], [data-tooltip*="subgraph" i]');

        if (isSubgraphButton && enterMode !== "Never") {
            debugLog('Subgraph button clicked, scheduling fit check');
            // 延迟检查，等待子图页面加载完成
            setTimeout(() => {
                const currentSubgraphId = getCurrentSubgraphId();
                if (currentSubgraphId && currentSubgraphId !== lastSubgraphId) {
                    debugLog('Subgraph detected after button click');
                    const checkSubgraph = enterMode === "First";
                    fitSubgraphToView(delay, checkSubgraph);
                }
            }, delay + 100);
        }

    }, true);
}

/**
 * 初始化子图观察器
 * 监听面包屑导航变化以检测子图进入/退出
 * @param {string} subgraphEnterMode - 进入子图时的适应模式 ("first" | "always" | "never")
 * @param {string} subgraphExitMode - 退出子图时的适应模式 ("first" | "always" | "never")
 * @param {number} delay - 适应延迟（毫秒）
 */
function initSubgraphObserver(subgraphEnterMode, subgraphExitMode, delay) {
    if (subgraphEnterMode === "Never" && subgraphExitMode === "Never" && settings.workflowExitMode === "Never") {
        debugLog('Subgraph observer disabled (all modes: Never)');
        return;
    }

    debugLog('Initializing subgraph observer with subgraphEnterMode:', subgraphEnterMode, 'subgraphExitMode:', subgraphExitMode, 'delay:', delay);

    // 设置按钮点击监听
    setupSubgraphButtonListener(subgraphEnterMode, subgraphExitMode, delay);

    // 如果已存在观察器，先断开
    if (subgraphObserver) {
        subgraphObserver.disconnect();
    }

    // 跟踪上一次检测到的子图ID和面包屑层级
    let lastDetectedSubgraphId = null;
    let lastBreadcrumbLevel = 0;

    // 获取面包屑层级（子图深度）
    function getBreadcrumbLevel() {
        const breadcrumbItems = document.querySelectorAll('.p-breadcrumb-item-label');
        return breadcrumbItems.length;
    }

    // 创建新的观察器
    subgraphObserver = new MutationObserver((mutations) => {
        const currentSubgraphId = getCurrentSubgraphId();
        const currentLevel = getBreadcrumbLevel();

        // ========== 进入更深的子图（层级增加）==========
        if (currentSubgraphId && currentSubgraphId !== lastDetectedSubgraphId && currentLevel > lastBreadcrumbLevel) {
            debugLog('Mutation detected: entered deeper subgraph', currentSubgraphId, 'level:', currentLevel);
            lastDetectedSubgraphId = currentSubgraphId;
            lastSubgraphId = currentSubgraphId;
            lastBreadcrumbLevel = currentLevel;

            // 触发子图适应（如果启用）
            if (subgraphEnterMode !== "Never") {
                const checkSubgraph = subgraphEnterMode === "First";
                fitSubgraphToView(delay, checkSubgraph);
            }
        }
        // ========== 返回上一级子图（层级减少但仍大于1）==========
        else if (currentSubgraphId && currentSubgraphId !== lastDetectedSubgraphId && currentLevel < lastBreadcrumbLevel && currentLevel > 1) {
            debugLog('Mutation detected: returned to parent subgraph', currentSubgraphId, 'level:', currentLevel);
            lastDetectedSubgraphId = currentSubgraphId;
            lastSubgraphId = currentSubgraphId;
            lastBreadcrumbLevel = currentLevel;

            // 返回上一级子图时，使用 subgraphExitMode 设置（视为子图退出行为）
            if (subgraphExitMode !== "Never") {
                const checkSubgraph = subgraphExitMode === "First";
                fitSubgraphToView(delay, checkSubgraph);
            }
        }
        // ========== 完全退出到主工作流（层级变为1）==========
        else if (!currentSubgraphId && lastDetectedSubgraphId && currentLevel <= 1) {
            debugLog('Mutation detected: exited to main workflow');
            lastDetectedSubgraphId = null;
            lastSubgraphId = null;
            lastBreadcrumbLevel = currentLevel;

            // 触发工作流适应（使用 workflowExitMode 设置）
            if (settings.workflowExitMode !== "Never") {
                debugLog('Triggering workflow fit after subgraph exit');
                const checkWorkflow = settings.workflowExitMode === "First";
                fitToView(delay, checkWorkflow, true);
            }
        }
    });

    // 开始观察文档中的面包屑导航
    // 使用延迟确保 DOM 已就绪
    setTimeout(() => {
        // 尝试找到面包屑容器
        const breadcrumbContainer = document.querySelector('.p-breadcrumb, .p-breadcrumb-list, [class*="breadcrumb"]');

        debugLog('Breadcrumb container found:', !!breadcrumbContainer);

        if (breadcrumbContainer) {
            subgraphObserver.observe(breadcrumbContainer, {
                childList: true,
                subtree: true,
                characterData: true
            });
            debugLog('Observer attached to breadcrumb container');
        } else {
            // 如果找不到特定容器，观察整个 body
            subgraphObserver.observe(document.body, {
                childList: true,
                subtree: true,
                characterData: true
            });
            debugLog('Observer attached to body (fallback)');
        }

        // 初始检查：如果已经在子图中，记录状态但不触发适应
        if (isInSubgraph()) {
            debugLog('Already in subgraph on init, recording state');
            const currentSubgraphId = getCurrentSubgraphId();
            const currentLevel = getBreadcrumbLevel();
            lastDetectedSubgraphId = currentSubgraphId;
            lastSubgraphId = currentSubgraphId;
            lastBreadcrumbLevel = currentLevel;
        }
    }, 500);
}

// ============================================
// 适应视图功能实现
// ============================================

/**
 * 检查画布是否为空
 * @returns {boolean} 画布是否为空（无节点）
 */
function isCanvasEmpty() {
    if (!app.graph || !app.graph.nodes) return true;
    if (!Array.isArray(app.graph.nodes)) return true;
    return app.graph.nodes.length === 0;
}

/**
 * 执行适应视图操作
 * 通过触发页面上的 Fit View 按钮来实现适应视图功能
 * @param {number} delay - 延迟时间（毫秒）
 * @param {boolean} checkWorkflow - 是否检查工作流是否已适应
 * @param {boolean} isExit - 是否是退出场景（退出子图后返回）
 */
function fitToView(delay = 100, checkWorkflow = false, isExit = false) {
    debugLog('fitToView called:', { delay, checkWorkflow, isExit, workflowEnterMode: settings.workflowEnterMode });

    // 清除之前的定时器
    if (fitViewTimeout) {
        clearTimeout(fitViewTimeout);
    }

    fitViewTimeout = setTimeout(() => {
        try {
            // 检查画布是否为空，为空则不触发适应视图
            if (isCanvasEmpty()) {
                debugLog('Canvas is empty, skipping fit');
                return;
            }

            const workflowId = getWorkflowId();
            debugLog('Workflow ID:', workflowId, 'lastWorkflowId:', lastWorkflowId);

            // 检查是否在防抖时间内已触发过（只在同一工作流内防抖）
            const now = Date.now();
            if (workflowId === lastWorkflowId && (now - lastFitTime < FIT_DEBOUNCE_MS)) {
                debugLog('Debounced: same workflow within', FIT_DEBOUNCE_MS, 'ms');
                return;
            }
            lastFitTime = now;
            lastWorkflowId = workflowId;

            // 如果启用了工作流检查，则验证是否为首次加载
            if (checkWorkflow) {
                // 退出场景使用独立的检查机制
                if (isExit) {
                    if (workflowId && isExitFitted(workflowId)) {
                        debugLog('Exit already fitted for:', workflowId);
                        return;
                    }
                    // 标记为已适应
                    if (workflowId) {
                        markExitFitted(workflowId);
                    }
                } else {
                    if (workflowId && isWorkflowFitted(workflowId)) {
                        debugLog('Workflow already fitted:', workflowId);
                        return;
                    }
                    // 标记为已适应
                    if (workflowId) {
                        markWorkflowFitted(workflowId);
                    }
                }
            }

            // 使用图标类名查找 Fit View 按钮
            const fitViewButton = document.querySelector('button i.icon-\\[lucide--focus\\]')?.closest('button');

            debugLog('Fit View button found:', !!fitViewButton);

            if (fitViewButton) {
                debugLog('Clicking Fit View button');
                fitViewButton.click();
            }
        } catch (error) {
            debugLog('Error in fitToView:', error);
        } finally {
            // 清理定时器引用
            fitViewTimeout = null;
        }
    }, delay);
}

// ============================================
// 扩展注册
// ============================================

/**
 * 设置状态
 */
let settings = {
    workflowEnterMode: "Never",  // "First" | "Always" | "Never" - 主工作流加载时（页面加载、加载新工作流）
    workflowExitMode: "Never",   // "First" | "Always" | "Never" - 从子图退出到主工作流时
    subgraphEnterMode: "Never",  // "First" | "Always" | "Never" - 进入子图时
    subgraphExitMode: "Never",   // "First" | "Always" | "Never" - 退出子图（返回上级）时
    fitDelay: 300
};

/**
 * 标记是否已执行过首次加载适应
 */
let hasFittedOnLoad = false;

/**
 * 注册 ComfyUI 扩展
 */
app.registerExtension({
    name: "ComfyUI.Xz3r0.XFitView",

    /**
     * 扩展设置配置
     */
    settings: [
        {
            id: "Xz3r0.XFitView.WorkflowEnterMode",
            name: "Workflow Enter Mode",
            type: "combo",
            defaultValue: "Never",
            tooltip: "When to auto-fit view when loading main workflow (page load, load workflow file). 'First' resets on page refresh",
            category: ["♾️ Xz3r0", "XFitView", "WorkflowEnter"],
            options: ["First", "Always", "Never"],
            onChange: (value) => {
                settings.workflowEnterMode = value;
            }
        },
        {
            id: "Xz3r0.XFitView.WorkflowExitMode",
            name: "Workflow Exit Mode",
            type: "combo",
            defaultValue: "Never",
            tooltip: "When to auto-fit view when exiting subgraph back to main workflow. 'First' resets on page refresh",
            category: ["♾️ Xz3r0", "XFitView", "WorkflowExit"],
            options: ["First", "Always", "Never"],
            onChange: (value) => {
                settings.workflowExitMode = value;
            }
        },
        {
            id: "Xz3r0.XFitView.SubgraphEnterMode",
            name: "Subgraph Enter Mode",
            type: "combo",
            defaultValue: "Never",
            tooltip: "When to auto-fit view when entering a subgraph. 'First' resets on page refresh",
            category: ["♾️ Xz3r0", "XFitView", "SubgraphEnter"],
            options: ["First", "Always", "Never"],
            onChange: (value) => {
                settings.subgraphEnterMode = value;
            }
        },
        {
            id: "Xz3r0.XFitView.SubgraphExitMode",
            name: "Subgraph Exit Mode",
            type: "combo",
            defaultValue: "Never",
            tooltip: "When to auto-fit view when returning to parent subgraph or main workflow. 'First' resets on page refresh",
            category: ["♾️ Xz3r0", "XFitView", "SubgraphExit"],
            options: ["First", "Always", "Never"],
            onChange: (value) => {
                settings.subgraphExitMode = value;
            }
        },
        {
            id: "Xz3r0.XFitView.Delay",
            name: "Fit View Delay (ms)",
            type: "number",
            defaultValue: 300,
            tooltip: "Delay before fitting view (milliseconds). Increase if view doesn't fit correctly. Range: 0-2000ms",
            category: ["♾️ Xz3r0", "XFitView", "Delay"],
            attrs: {
                min: 0,
                max: 2000,
                step: 50
            },
            onChange: (value) => {
                settings.fitDelay = value;
            }
        }
    ],

    /**
     * 扩展初始化函数
     */
    async setup() {
        // 等待 ComfyUI 完全初始化
        const initFitView = () => {
            // 页面首次加载时适应视图（使用主工作流进入模式控制）
            if (settings.workflowEnterMode !== "Never") {
                // "First" 模式下只执行一次，"Always" 模式每次都执行
                if (settings.workflowEnterMode === "Always" || !hasFittedOnLoad) {
                    hasFittedOnLoad = true;
                    fitToView(settings.fitDelay, settings.workflowEnterMode === "First");
                }
            }
        };

        // 如果画布已就绪，直接执行
        if (app.canvas && app.graph) {
            initFitView();
        } else {
            // 否则等待初始化完成
            const checkInterval = setInterval(() => {
                if (app.canvas && app.graph) {
                    clearInterval(checkInterval);
                    initFitView();
                }
            }, 100);

            // 超时处理
            setTimeout(() => {
                clearInterval(checkInterval);
            }, 5000);
        }

        // 设置工作流加载监听器
        this.setupWorkflowListener();

        // 初始化子图观察器（传入子图进入和退出模式）
        initSubgraphObserver(settings.subgraphEnterMode, settings.subgraphExitMode, settings.fitDelay);
    },

    /**
     * 设置工作流加载监听器
     * 监听工作流配置变化，在新工作流加载时自动适应视图
     */
    setupWorkflowListener() {
        // 保存原始的 onConfigure 方法
        const originalOnConfigure = app.graph.onConfigure;

        // 重写 onConfigure 方法
        app.graph.onConfigure = function(config) {
            debugLog('onConfigure called, workflowEnterMode:', settings.workflowEnterMode);

            // 调用原始方法
            const result = originalOnConfigure?.apply(this, arguments);

            // 根据主工作流进入模式决定是否执行适应视图
            if (settings.workflowEnterMode !== "Never") {
                // 使用延迟确保工作流已完全加载
                // "First" 模式会检查是否已适应，"Always" 模式每次都适应
                const checkWorkflow = settings.workflowEnterMode === "First";
                debugLog('Triggering fit from onConfigure, checkWorkflow:', checkWorkflow);
                fitToView(settings.fitDelay, checkWorkflow);
            } else {
                debugLog('Skipping fit from onConfigure (Never mode)');
            }

            return result;
        };

        // 监听 loadGraphData 方法（ComfyUI 加载工作流的主要方法）
        const originalLoadGraphData = app.loadGraphData;
        if (originalLoadGraphData) {
            app.loadGraphData = async function() {
                debugLog('loadGraphData called, workflowEnterMode:', settings.workflowEnterMode);

                // 调用原始方法
                const result = await originalLoadGraphData.apply(this, arguments);

                // 根据主工作流进入模式决定是否执行适应视图
                if (settings.workflowEnterMode !== "Never") {
                    const checkWorkflow = settings.workflowEnterMode === "First";
                    debugLog('Triggering fit from loadGraphData, checkWorkflow:', checkWorkflow);
                    fitToView(settings.fitDelay, checkWorkflow);
                } else {
                    debugLog('Skipping fit from loadGraphData (Never mode)');
                }

                return result;
            };
        }
    }
});

// 导出功能供其他模块使用
export { fitToView, fitSubgraphToView, isInSubgraph, getCurrentSubgraphId };

