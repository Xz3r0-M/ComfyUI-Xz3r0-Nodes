/**
 * XFitView - ComfyUI 自动适应视图扩展
 * ===========================================
 * 版本: 1.1.0 - 2025-02-25
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
 * 2. 智能去重机制:
 *    - 基于工作流特征生成唯一标识(节点类型、连接拓扑)
 *    - "first"模式: 同一会话中相同工作流只适应一次
 *    - "always"模式: 每次加载都适应
 *    - "never"模式: 禁用自动适应
 *
 * 3. 防抖控制:
 *    - 同一工作流200ms内多次触发只执行一次
 *    - 不同工作流之间立即触发
 *
 * 4. 设置选项:
 *    - 工作流加载模式: first/always/never
 *    - 适应延迟时间: 0-2000ms可调
 *    - 注册到 Xz3r0 设置分类
 *
 * 技术实现:
 * ---------
 * - 使用 ComfyUI 扩展 API (app.registerExtension)
 * - 通过 app.canvas 访问画布对象
 * - 监听 app.graph.onConfigure 事件
 * - 重写 app.loadGraphData 方法
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
 * 当前会话中已适应的工作流（内存存储，页面刷新后重置）
 */
const fittedWorkflows = new Set();

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
 */
function fitToView(delay = 100, checkWorkflow = false) {
    // 清除之前的定时器
    if (fitViewTimeout) {
        clearTimeout(fitViewTimeout);
    }

    fitViewTimeout = setTimeout(() => {
        try {
            // 检查画布是否为空，为空则不触发适应视图
            if (isCanvasEmpty()) {
                return;
            }

            const workflowId = getWorkflowId();

            // 检查是否在防抖时间内已触发过（只在同一工作流内防抖）
            const now = Date.now();
            if (workflowId === lastWorkflowId && (now - lastFitTime < FIT_DEBOUNCE_MS)) {
                return;
            }
            lastFitTime = now;
            lastWorkflowId = workflowId;

            // 如果启用了工作流检查，则验证是否为首次加载
            if (checkWorkflow) {
                if (workflowId && isWorkflowFitted(workflowId)) {
                    return;
                }
                // 标记为已适应
                if (workflowId) {
                    markWorkflowFitted(workflowId);
                }
            }

            // 使用图标类名查找 Fit View 按钮
            const fitViewButton = document.querySelector('button i.icon-\\[lucide--focus\\]')?.closest('button');

            if (fitViewButton) {
                fitViewButton.click();
            }
        } catch (error) {
            // 静默处理错误
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
    workflowLoadMode: "never", // "first" | "always" | "never"
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
            id: "Xz3r0.XFitView.WorkflowLoadMode",
            name: "Workflow Load Mode",
            type: "combo",
            defaultValue: "never",
            tooltip: "Choose when to auto-fit view when loading workflows. 'First time only' resets on page refresh",
            category: ["♾️ Xz3r0", "XFitView", "Workflow"],
            options: ["first", "always", "never"],
            onChange: (value) => {
                settings.workflowLoadMode = value;
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
            // 页面首次加载时适应视图（如果模式不是"从不"）
            if (settings.workflowLoadMode !== "never" && !hasFittedOnLoad) {
                hasFittedOnLoad = true;
                fitToView(settings.fitDelay, settings.workflowLoadMode === "first");
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
            // 调用原始方法
            const result = originalOnConfigure?.apply(this, arguments);

            // 根据工作流加载模式决定是否执行适应视图
            if (settings.workflowLoadMode !== "never") {
                // 使用延迟确保工作流已完全加载
                // "first" 模式会检查是否已适应，"always" 模式每次都适应
                const checkWorkflow = settings.workflowLoadMode === "first";
                fitToView(settings.fitDelay, checkWorkflow);
            }

            return result;
        };

        // 监听 loadGraphData 方法（ComfyUI 加载工作流的主要方法）
        const originalLoadGraphData = app.loadGraphData;
        if (originalLoadGraphData) {
            app.loadGraphData = async function() {
                // 调用原始方法
                const result = await originalLoadGraphData.apply(this, arguments);

                // 根据工作流加载模式决定是否执行适应视图
                if (settings.workflowLoadMode !== "never") {
                    const checkWorkflow = settings.workflowLoadMode === "first";
                    fitToView(settings.fitDelay, checkWorkflow);
                }

                return result;
            };
        }
    }
});

// 导出功能供其他模块使用
export { fitToView };

