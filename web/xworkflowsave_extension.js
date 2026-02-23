/**
 * XWorkflowSave 前端扩展
 * ======================
 *
 * 功能概述:
 * ---------
 * 为 XWorkflowSave 节点提供完整 workflow 数据捕获支持。
 * 当节点使用 "full" 或 "auto" 模式时，自动注入完整 workflow 数据。
 *
 * 核心功能:
 * ---------
 * 1. 拦截 queuePrompt 调用
 * 2. 检测 XWorkflowSave 节点及其保存模式
 * 3. 捕获完整 workflow 数据（包含 localized_name 和 widget）
 * 4. 将数据注入到节点的 workflow_json 输入
 *
 * 技术实现:
 * ---------
 * - 使用 ComfyUI 扩展 API (app.registerExtension)
 * - 拦截 queuePrompt 方法
 * - 通过 widget.value 传递数据
 *
 * @author Xz3r0
 * @project ComfyUI-Xz3r0-Nodes
 */

import { app } from "../../scripts/app.js";

/**
 * 存储捕获的 workflow 数据
 * 使用 Map 以节点ID为key，避免并发场景下的数据竞争
 */
const capturedWorkflowData = new Map();

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
     * 在 queuePrompt 调用前捕获 workflow 数据并注入到节点
     */
    setupQueueInterceptor() {
        const self = this;
        const originalQueuePrompt = app.queuePrompt;

        app.queuePrompt = async function(number, batchCount) {
            // 查找需要完整 workflow 数据的 XWorkflowSave 节点
            const saveNodes = app.graph.nodes.filter(
                n => n.type === "XWorkflowSave"
            );

            if (saveNodes.length > 0) {
                // 检查是否有节点需要完整 workflow
                const needsFullWorkflow = saveNodes.some(node => {
                    const modeWidget = node.widgets?.find(
                        w => w.name === "save_mode"
                    );
                    const mode = modeWidget?.value || "auto";
                    // full 模式或 auto 模式都可能需要完整 workflow
                    return mode === "full" || mode === "auto";
                });

                if (needsFullWorkflow) {
                    // 捕获完整 workflow 数据
                    const workflowData = self.captureWorkflow();

                    if (workflowData) {
                        // 为每个节点单独存储数据，避免并发冲突
                        for (const node of saveNodes) {
                            capturedWorkflowData.set(node.id, workflowData);

                            const widget = node.widgets?.find(
                                w => w.name === "workflow_json"
                            );
                            if (widget) {
                                try {
                                    widget.value = JSON.stringify(workflowData);
                                } catch (e) {
                                    console.error(
                                        `[XWorkflowSave] Failed to serialize workflow for node ${node.id}:`,
                                        e
                                    );
                                    widget.value = "{}";
                                }
                            }
                        }
                    }
                }
            }

            // 调用原始的 queuePrompt
            return originalQueuePrompt.apply(this, arguments);
        };
    },

    /**
     * 修改节点定义
     * 在节点序列化时将捕获的数据写入 widgets_values
     */
    async beforeRegisterNodeDef(nodeType, nodeData, app) {
        if (nodeData.name === "XWorkflowSave") {
            const originalOnSerialize = nodeType.prototype.onSerialize;

            nodeType.prototype.onSerialize = function(o) {
                // 调用原始方法
                if (originalOnSerialize) {
                    originalOnSerialize.apply(this, arguments);
                }

                // 将捕获的数据注入到序列化输出
                // workflow_json 是隐藏参数，需要通过 widgets_values 传递
                // 使用节点ID从Map中获取对应的数据
                const nodeWorkflowData = capturedWorkflowData.get(this.id);

                if (nodeWorkflowData) {
                    // 找到 workflow_json 在输入中的索引位置
                    const inputNames = nodeData.input?.required ?
                        Object.keys(nodeData.input.required) :
                        [];
                    const widgetIndex = inputNames.indexOf("workflow_json");

                    if (widgetIndex >= 0) {
                        if (!o.widgets_values) {
                            o.widgets_values = [];
                        }
                        try {
                            o.widgets_values[widgetIndex] = JSON.stringify(
                                nodeWorkflowData
                            );
                        } catch (e) {
                            console.error(
                                `[XWorkflowSave] Failed to serialize workflow in onSerialize for node ${this.id}:`
                                , e
                            );
                            o.widgets_values[widgetIndex] = "{}";
                        }
                    }
                }
            };
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
        if (!app.graph?.nodes) {
            return workflow;
        }

        for (const node of workflow.nodes) {
            const graphNode = app.graph.nodes.find(n => n.id === node.id);
            if (!graphNode) continue;

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
                            widget: input.widget ? {name: input.widget.name} : undefined
                        });
                    } else if (input.widget && !exists.widget) {
                        exists.widget = {name: input.widget.name};
                        exists.localized_name = input.localized_name || exists.localized_name || input.name;
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
                        if (!nodeOutput.localized_name && graphOutput.localized_name) {
                            nodeOutput.localized_name = graphOutput.localized_name;
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
