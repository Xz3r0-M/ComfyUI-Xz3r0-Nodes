/**
 * XWorkflowSave_Extension 前端扩展
 * ======================
 *
 * 功能概述：
 * ---------
 * 为 XWorkflowSave 节点提供完整 workflow 数据捕获支持。
 * 当节点使用 "FullWorkflow"、"Auto" 或 "Prompt+FullWorkflow" 模式时，
 * 自动捕获完整 workflow 数据并通过自定义 API 接口发送到后端。
 *
 * 核心功能：
 * ---------
 * 1. 拦截 queuePrompt 调用
 * 2. 检测 XWorkflowSave 节点及其保存模式
 * 3. 捕获完整 workflow 数据（包含 localized_name 和 widget）
 * 4. 通过 /xz3r0/xworkflowsave/capture API 发送数据
 *
 * 技术实现：
 * ---------
 * - 使用 ComfyUI 扩展 API (app.registerExtension)
 * - 拦截 queuePrompt 方法
 * - 使用 fetch API 发送数据到自定义接口
 * - 使用节点 ID 作为数据存储的 key
 *
 * @author Xz3r0
 * @project ComfyUI-Xz3r0-Nodes
 */

import { app } from "../../scripts/app.js";

const QUEUE_PROMPT_WRAPPED_MARK = Symbol(
    "ComfyUI.Xz3r0.XWorkflowSave.queuePromptWrapped"
);
const ORIGINAL_QUEUE_PROMPT = Symbol(
    "ComfyUI.Xz3r0.XWorkflowSave.originalQueuePrompt"
);
const CAPTURE_TIMEOUT_MS = 5000;
const DEBUG_SUCCESS_LOG = false;

/**
 * 构建作用域节点 ID。
 *
 * ComfyUI 执行引擎在子图中的节点使用 "parent_id:child_id"
 * 格式的作用域 ID，前端必须使用相同格式才能与后端匹配。
 */
function buildScopedNodeId(pathIds, nodeId) {
    const base = String(nodeId ?? "").trim();
    if (!base) {
        return "";
    }
    if (!Array.isArray(pathIds) || pathIds.length < 1) {
        return base;
    }
    return pathIds.join(":") + ":" + base;
}

/**
 * 遍历完整图树（包含所有嵌套子图），对每个节点调用 visitor。
 *
 * 与 app.graph.nodes 不同，后者仅包含当前可见图的节点。
 * 此函数递归进入每个 node.subgraph，确保子图中的
 * XWorkflowSave 节点也能被发现。
 */
function forEachNodeInGraphTree(rootGraph, visitor) {
    if (!rootGraph || typeof visitor !== "function") {
        return;
    }
    const visited = new Set();

    const walk = function (graph, pathIds) {
        if (!graph || typeof graph !== "object" || visited.has(graph)) {
            return;
        }
        visited.add(graph);
        const nodes = Array.isArray(graph._nodes)
            ? graph._nodes
            : Array.isArray(graph.nodes)
                ? graph.nodes
                : [];
        for (let i = 0; i < nodes.length; i++) {
            const node = nodes[i];
            const nodeId = String(
                node && node.id != null ? node.id : ""
            ).trim();
            if (!nodeId) {
                continue;
            }
            const scopedId = buildScopedNodeId(pathIds, nodeId);
            visitor(node, scopedId);

            if (
                node &&
                node.subgraph &&
                typeof node.subgraph === "object"
            ) {
                walk(node.subgraph, pathIds.concat([nodeId]));
            }
        }
    };

    walk(rootGraph, []);
}

/**
 * 注册 ComfyUI 扩展
 */
app.registerExtension({
    name: "ComfyUI.Xz3r0.XWorkflowSave",

    /**
     * 初始化扩展
     */
    async setup() {
        console.log("[XWorkflowSave] Extension loaded");
        this.setupQueueInterceptor();
    },

    /**
     * 设置队列拦截器
     * 在 queuePrompt 调用前捕获 workflow 数据并通过 API 发送
     */
    setupQueueInterceptor() {
        if (typeof app.queuePrompt !== "function") {
            return;
        }

        const currentQueuePrompt = app.queuePrompt;
        if (currentQueuePrompt[QUEUE_PROMPT_WRAPPED_MARK]) {
            return;
        }

        const self = this;
        const originalQueuePrompt = currentQueuePrompt[ORIGINAL_QUEUE_PROMPT] ||
            currentQueuePrompt;
        const wrappedQueuePrompt = async function(number, batchCount) {
            const capturePayload = self.buildCapturePayload();
            if (capturePayload) {
                await self.sendCapturePayload(capturePayload);
            }

            return originalQueuePrompt.apply(this, arguments);
        };

        wrappedQueuePrompt[QUEUE_PROMPT_WRAPPED_MARK] = true;
        wrappedQueuePrompt[ORIGINAL_QUEUE_PROMPT] = originalQueuePrompt;
        app.queuePrompt = wrappedQueuePrompt;
    },

    /**
     * 构建需要上传的数据快照。
     *
     * @returns {Object|null} 上传负载
     */
    buildCapturePayload() {
        // 遍历完整图树（含嵌套子图），发现所有 XWorkflowSave 节点
        const targetNodes = [];
        forEachNodeInGraphTree(
            app.graph,
            function (node, scopedId) {
                if (node?.type !== "XWorkflowSave") {
                    return;
                }
                const modeWidget = node.widgets?.find(
                    function (widget) {
                        return widget.name === "save_mode";
                    }
                );
                const mode = modeWidget?.value || "Auto";
                if (
                    mode === "FullWorkflow" ||
                    mode === "Auto" ||
                    mode === "Prompt+FullWorkflow"
                ) {
                    targetNodes.push({
                        node_id: scopedId,
                        mode: mode,
                    });
                }
            }
        );

        if (targetNodes.length === 0) {
            return null;
        }

        // 捕获完整 workflow 数据
        const workflowData = this.captureWorkflow();
        if (!workflowData) {
            return null;
        }

        return {
            target_nodes: targetNodes,
            workflow: workflowData,
        };
    },

    /**
     * 顺序发送所有目标节点的 workflow 数据。
     *
     * @param {Object} payload - 上传负载
     */
    async sendCapturePayload(payload) {
        const targetNodes = payload?.target_nodes;
        if (!Array.isArray(targetNodes) || targetNodes.length === 0) {
            return;
        }

        for (const nodeInfo of targetNodes) {
            await this.sendNodeCapture(
                nodeInfo.node_id,
                payload.workflow,
                nodeInfo.mode
            );
        }
    },

    /**
     * 上传单个节点的 workflow 数据。
     *
     * @param {string} nodeId - 节点 ID
     * @param {Object} workflowData - workflow 快照
     * @param {string} mode - 保存模式
     */
    async sendNodeCapture(nodeId, workflowData, mode) {
        let timeoutId = null;
        let controller = null;

        if (typeof AbortController !== "undefined") {
            controller = new AbortController();
            timeoutId = setTimeout(() => {
                controller.abort();
            }, CAPTURE_TIMEOUT_MS);
        }

        try {
            const response = await fetch(
                "/xz3r0/xworkflowsave/capture",
                {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({
                        prompt_id: nodeId,
                        workflow: workflowData,
                        mode: mode
                    }),
                    signal: controller?.signal
                }
            );

            if (!response.ok) {
                console.error(
                    "[XWorkflowSave] Failed to send workflow data for " +
                    `node ${nodeId}:`,
                    await response.text()
                );
            } else if (DEBUG_SUCCESS_LOG) {
                console.log(
                    "[XWorkflowSave] Workflow data sent successfully for " +
                    `node ${nodeId}`
                );
            }
        } catch (error) {
            if (error?.name === "AbortError") {
                console.error(
                    "[XWorkflowSave] Capture request timed out for " +
                    `node ${nodeId}`
                );
                return;
            }

            console.error(
                "[XWorkflowSave] Error sending workflow data for " +
                `node ${nodeId}:`,
                error
            );
        } finally {
            if (timeoutId !== null) {
                clearTimeout(timeoutId);
            }
        }
    },

    /**
     * 捕获完整 Workflow 数据
     *
     * @returns {Object|null} 完整的 workflow 数据
     */
    captureWorkflow() {
        try {
            if (!app.graph) {
                return null;
            }

            // 尝试多种方法获取 workflow
            let workflow = null;

            if (app.workflowManager?.activeWorkflow) {
                workflow = app.workflowManager.activeWorkflow.save();
            } else if (app.saveWorkflow) {
                workflow = app.saveWorkflow();
            } else {
                workflow = app.graph.serialize();
            }

            // 补充缺失数据
            if (workflow?.nodes) {
                workflow = this.enrichWorkflowData(workflow);
            }

            return workflow;
        } catch (error) {
            console.error("[XWorkflowSave] Error:", error);
            return null;
        }
    },

    /**
     * 补充 Workflow 数据
     * 手动添加缺失的 widget 输入信息
     *
     * @param {Object} workflow - 基础 workflow 数据
     * @returns {Object} 补充后的 workflow 数据
     */
    enrichWorkflowData(workflow) {
        if (!Array.isArray(workflow?.nodes)) {
            return workflow;
        }

        // 遍历完整图树构建节点映射，确保子图中的节点也能匹配
        const graphNodeMap = new Map();
        forEachNodeInGraphTree(
            app.graph,
            function (node) {
                if (node && node.id != null) {
                    graphNodeMap.set(node.id, node);
                }
            }
        );

        for (const node of workflow.nodes) {
            const graphNode = graphNodeMap.get(node.id);
            if (!graphNode) {
                continue;
            }

            // 补充 inputs
            if (graphNode.inputs) {
                if (!node.inputs) {
                    node.inputs = [];
                }

                for (const input of graphNode.inputs) {
                    const exists = node.inputs.find(
                        ni => ni.name === input.name
                    );

                    if (!exists) {
                        node.inputs.push({
                            name: input.name,
                            type: input.type,
                            link: input.link || null,
                            localized_name: input.localized_name || input.name,
                            widget: input.widget ?
                                {name: input.widget.name} : undefined
                        });
                    } else if (input.widget && !exists.widget) {
                        exists.widget = {name: input.widget.name};
                        exists.localized_name = input.localized_name ||
                            exists.localized_name || input.name;
                    }
                }
            }

            // 补充 outputs 的 localized_name
            if (graphNode.outputs) {
                if (!node.outputs) {
                    node.outputs = [];
                }

                for (let i = 0; i < graphNode.outputs.length; i++) {
                    const graphOutput = graphNode.outputs[i];
                    const nodeOutput = node.outputs[i];

                    if (nodeOutput && graphOutput) {
                        if (!nodeOutput.localized_name &&
                            graphOutput.localized_name) {
                            nodeOutput.localized_name =
                                graphOutput.localized_name;
                        }
                        if (!nodeOutput.name && graphOutput.name) {
                            nodeOutput.name = graphOutput.name;
                        }
                    }
                }
            }
        }

        return workflow;
    }
});
