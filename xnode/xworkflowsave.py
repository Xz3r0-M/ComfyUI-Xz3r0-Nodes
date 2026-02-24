"""
工作流保存节点模块
================

这个模块包含工作流JSON保存相关的节点。
支持两种保存模式：
1. 标准模式：保存 prompt + extra_pnginfo.workflow（简化数据）
2. 完整模式：保存前端传来的完整 workflow（包含 localized_name 和 widget）
   通过自定义 API 接口 /xz3r0/xworkflowsave/capture 接收数据
"""

import json
import re
from datetime import datetime
from pathlib import Path

import folder_paths
from comfy_api.latest import io, ui

from .xworkflowsave_api import workflow_store


class XWorkflowSave(io.ComfyNode):
    """
    XWorkflowSave 工作流保存节点

    将ComfyUI工作流保存为JSON文件，支持两种保存模式：
    - 标准模式：保存 prompt + workflow（简化数据，来自 extra_pnginfo）
    - 完整模式：保存完整 workflow（包含 localized_name 和 widget，来自前端 API）

    功能:
        - 保存工作流到ComfyUI默认输出目录
        - 支持自定义文件名和子文件夹
        - 支持日期时间标识符(%Y%, %m%, %d%, %H%, %M%, %S%)
        - 自动添加序列号防止覆盖(从00001开始)
        - 仅支持单级子文件夹创建
        - 安全防护(防止路径遍历攻击，禁用路径分隔符)

    输入:
        anything: 任意输入(用于工作流连接，不处理数据，可选) (ANY)
        save_mode: 保存模式选择 (COMBO)
        filename_prefix: 文件名前缀 (STRING)
        subfolder: 子文件夹名称 (STRING)

    输出:
        anything: 透传输入的数据，可直接传递给下游节点 (ANY)
        workflow_info: 工作流信息摘要，包含保存状态和数据概览 (STRING)

    使用示例:
        save_mode="auto",
        filename_prefix="Workflow_%Y%m%d",
        subfolder="Workflows"
        (anything输入为可选，可以不连接任何数据)

    技术说明:
        完整模式通过前端扩展自动捕获 workflow 数据，
        并通过 /xz3r0/xworkflowsave/capture API 发送到后端存储。
        节点执行时通过 prompt_id 从存储中获取数据。

    """

    @classmethod
    def define_schema(cls):
        """定义节点的输入类型和约束"""
        return io.Schema(
            node_id="XWorkflowSave",
            display_name="XWorkflowSave",
            category="♾️ Xz3r0/File-Processing",
            description=(
                "Workflow save node that saves the ComfyUI workflow as a "
                "JSON file. Supports both standard mode (simplified data) "
                "and full mode (complete workflow with localized_name). "
                "Full mode uses custom API to receive data from frontend."
            ),
            inputs=[
                io.AnyType.Input(
                    "anything",
                    optional=True,
                    tooltip=(
                        "Any input type for workflow connection. "
                        "This input is not processed, only used to "
                        "link the node into your workflow. "
                        "Optional - node works without any input."
                    ),
                ),
                io.Combo.Input(
                    "save_mode",
                    options=["auto", "standard", "full"],
                    default="auto",
                    tooltip=(
                        "Save mode: auto (auto-detect, prefer full), "
                        "standard (use extra_pnginfo), "
                        "full (require frontend API data)"
                    ),
                ),
                io.String.Input(
                    "filename_prefix",
                    default="ComfyUI_%Y%-%m%-%d%_%H%-%M%-%S%",
                    tooltip=(
                        "Filename prefix, supports datetime "
                        "placeholders: %Y%, %m%, %d%, %H%, "
                        "%M%, %S%"
                    ),
                ),
                io.String.Input(
                    "subfolder",
                    default="Workflows",
                    tooltip=(
                        "Subfolder name (no path separators allowed), "
                        "supports datetime placeholders: %Y%, %m%, %d%, "
                        "%H%, %M%, %S%"
                    ),
                ),
            ],
            outputs=[
                io.AnyType.Output(
                    "anything",
                    tooltip="Pass through the input data to downstream nodes",
                ),
                io.String.Output(
                    "workflow_info",
                    tooltip=(
                        "Workflow information summary including save status, "
                        "node count, and data overview. "
                        "Useful for debugging and verification."
                    ),
                ),
            ],
            hidden=[
                io.Hidden.prompt,
                io.Hidden.extra_pnginfo,
                io.Hidden.unique_id,
            ],
            is_output_node=True,
        )

    @classmethod
    def execute(
        cls,
        anything=None,
        save_mode: str = "auto",
        filename_prefix: str = "",
        subfolder: str = "",
    ) -> io.NodeOutput:
        """
        保存工作流到ComfyUI输出目录

        Args:
            anything: 任意输入(用于工作流连接，不处理数据，可选)
            save_mode: 保存模式("auto", "standard", "full")
            filename_prefix: 文件名前缀(支持日期时间标识符)
            subfolder: 子文件夹名称(单级)

        Returns:
            io.NodeOutput: 包含保存结果的输出
        """
        # 获取ComfyUI默认输出目录
        output_dir = Path(folder_paths.get_output_directory())

        # 处理日期时间标识符和安全过滤
        safe_filename_prefix = cls._sanitize_path(filename_prefix)
        safe_filename_prefix = cls._replace_datetime_placeholders(
            safe_filename_prefix
        )

        safe_subfolder = cls._sanitize_path(subfolder)
        safe_subfolder = cls._replace_datetime_placeholders(safe_subfolder)

        # 创建完整保存路径
        save_dir = output_dir
        if safe_subfolder:
            save_dir = save_dir / safe_subfolder

        # 创建目录(仅支持单级目录)
        save_dir.mkdir(exist_ok=True)

        # 生成文件名(检测同名文件并添加序列号)
        base_filename = safe_filename_prefix
        final_filename = cls._get_unique_filename(
            save_dir, base_filename, ".json"
        )
        save_path = save_dir / final_filename

        # 根据保存模式准备数据
        workflow_data = cls._prepare_workflow_data(save_mode)

        # 保存文件
        with open(save_path, "w", encoding="utf-8") as f:
            json.dump(workflow_data, f, indent=2, ensure_ascii=False)

        # 生成状态信息
        status_msg = cls._generate_status_message(
            final_filename, workflow_data, save_mode
        )

        # 生成 workflow_info 输出内容
        # 构建相对路径 (基于 ComfyUI 输出目录)
        relative_path = Path(final_filename)
        if safe_subfolder:
            relative_path = Path(safe_subfolder) / final_filename
        workflow_info = cls._generate_workflow_info(
            final_filename, workflow_data, save_mode, relative_path
        )

        # 返回保存结果和透传数据
        return io.NodeOutput(
            anything,
            workflow_info,
            ui=ui.PreviewText(status_msg),
        )

    @classmethod
    def _prepare_workflow_data(cls, save_mode: str) -> dict:
        """
        根据保存模式准备 workflow 数据

        Args:
            save_mode: 保存模式("auto", "standard", "full")

        Returns:
            dict: 准备好的 workflow 数据
        """
        workflow_data = {}
        prompt = cls.hidden.prompt
        extra_pnginfo = cls.hidden.extra_pnginfo
        unique_id = cls.hidden.unique_id

        # 尝试从 API 存储获取完整 workflow 数据
        full_workflow_data = None
        if unique_id:
            # 使用 unique_id 作为 prompt_id 从存储获取数据
            stored_data = workflow_store.retrieve(unique_id)
            if stored_data:
                full_workflow_data = stored_data.get("workflow")

        if save_mode == "full":
            # 完整模式：必须使用前端传来的 workflow 数据
            if not full_workflow_data:
                raise ValueError(
                    "Full mode requires workflow data from frontend API. "
                    "Please ensure the frontend extension is loaded and "
                    "the node is triggered via Queue Prompt."
                )
            workflow_data = full_workflow_data

        elif save_mode == "standard":
            # 标准模式：使用 prompt + extra_pnginfo
            if prompt is not None:
                workflow_data["prompt"] = prompt
            if extra_pnginfo is not None:
                workflow_data["workflow"] = extra_pnginfo.get("workflow")

        else:  # auto mode
            # 自动模式：优先使用完整 workflow，否则使用标准方式
            if full_workflow_data:
                workflow_data = full_workflow_data
            else:
                if prompt is not None:
                    workflow_data["prompt"] = prompt
                if extra_pnginfo is not None:
                    workflow_data["workflow"] = extra_pnginfo.get("workflow")

        return workflow_data

    @classmethod
    def _generate_status_message(
        cls, filename: str, workflow_data: dict, save_mode: str
    ) -> str:
        """
        生成保存状态信息

        Args:
            filename: 保存的文件名
            workflow_data: 保存的 workflow 数据
            save_mode: 使用的保存模式

        Returns:
            str: 状态信息字符串
        """
        # 分析数据完整性
        analysis = cls._analyze_workflow(workflow_data)

        status_lines = [
            f"Saved: {filename}",
            f"Mode: {save_mode}",
        ]

        if analysis["node_count"] > 0:
            status_lines.extend(
                [
                    f"Nodes: {analysis['node_count']}",
                    f"Complete: {analysis['is_complete']}",
                ]
            )

        if "prompt" in workflow_data:
            status_lines.append("Has prompt: Yes")
        if "workflow" in workflow_data:
            status_lines.append("Has workflow: Yes")

        return "\n".join(status_lines)

    @classmethod
    def _generate_workflow_info(
        cls,
        filename: str,
        workflow_data: dict,
        save_mode: str,
        relative_path: Path,
    ) -> str:
        """
        生成 workflow_info 输出内容

        根据保存模式生成不同的信息摘要:
        - full 模式: 显示完整工作流的关键信息摘要
        - auto/standard 模式: 显示保存状态和数据概览

        Args:
            filename: 保存的文件名
            workflow_data: 保存的工作流数据
            save_mode: 使用的保存模式
            relative_path: 相对保存路径 (基于 ComfyUI 输出目录)

        Returns:
            str: 工作流信息字符串
        """
        # 统一使用正斜杠，确保跨平台一致性
        posix_path = relative_path.as_posix()

        info_lines = [
            "=" * 50,
            "Workflow Save Info",
            "=" * 50,
            "",
            f"Filename: {filename}",
            f"Save Path: [output_dir]/{posix_path}",
            f"Save Mode: {save_mode}",
            "",
        ]

        # 分析数据
        analysis = cls._analyze_workflow(workflow_data)

        # 数据概览
        info_lines.extend(
            [
                "-" * 50,
                "Data Overview:",
                f"  Node Count: {analysis['node_count']}",
                f"  Complete Metadata: "
                f"{'Yes' if analysis['is_complete'] else 'No'}",
            ]
        )

        if analysis["has_localized_name"]:
            info_lines.append("  - Contains localized_name")
        if analysis["has_widget"]:
            info_lines.append("  - Contains widget info")

        # 添加模式特定的信息
        info_lines.extend(["", "-" * 50, "Data Content:"])

        if save_mode == "full":
            # full 模式: 显示完整工作流的关键信息
            info_lines.append(
                "Mode Description: Using full workflow data from frontend API"
            )
            info_lines.append("")
            info_lines.append("Workflow Structure:")

            if "last_node_id" in workflow_data:
                info_lines.append(
                    f"  - Last Node ID: {workflow_data['last_node_id']}"
                )
            if "last_link_id" in workflow_data:
                info_lines.append(
                    f"  - Last Link ID: {workflow_data['last_link_id']}"
                )

            nodes = workflow_data.get("nodes", [])
            links = workflow_data.get("links", [])
            info_lines.append(f"  - Total Nodes: {len(nodes)}")
            info_lines.append(f"  - Total Links: {len(links)}")

            # 显示节点类型统计
            if nodes:
                node_types = {}
                for node in nodes:
                    node_type = node.get("type", "Unknown")
                    node_types[node_type] = node_types.get(node_type, 0) + 1

                info_lines.append("")
                info_lines.append("Node Type Statistics:")
                for node_type, count in sorted(
                    node_types.items(), key=lambda x: x[1], reverse=True
                )[:10]:  # 只显示前10个
                    info_lines.append(f"  - {node_type}: {count}")

        elif save_mode == "standard":
            # standard 模式: 显示标准数据信息
            info_lines.append(
                "Mode Description: Using ComfyUI "
                "standard data (prompt + workflow)"
            )
            info_lines.append("")
            info_lines.append("Data Composition:")

            if "prompt" in workflow_data:
                prompt_data = workflow_data["prompt"]
                if isinstance(prompt_data, dict):
                    info_lines.append(
                        f"  - prompt: Contains {len(prompt_data)} nodes"
                    )
                else:
                    info_lines.append("  - prompt: Included")
            else:
                info_lines.append("  - prompt: None")

            if "workflow" in workflow_data:
                wf_data = workflow_data["workflow"]
                if isinstance(wf_data, dict):
                    nodes = wf_data.get("nodes", [])
                    info_lines.append(
                        f"  - workflow: Contains {len(nodes)} nodes"
                    )
                else:
                    info_lines.append("  - workflow: Included")
            else:
                info_lines.append("  - workflow: None")

        else:  # auto mode
            # auto 模式: 显示自动检测结果
            info_lines.append(
                "Mode Description: Auto-detect and select best data source"
            )
            info_lines.append("")

            # 确定实际使用了哪种数据
            has_nodes = "nodes" in workflow_data
            has_prompt = "prompt" in workflow_data

            if has_nodes:
                info_lines.append("Actually Used: Full workflow data (full)")
                nodes = workflow_data.get("nodes", [])
                links = workflow_data.get("links", [])
                info_lines.append(f"  - Nodes: {len(nodes)}")
                info_lines.append(f"  - Links: {len(links)}")
            elif has_prompt:
                info_lines.append("Actually Used: Standard data (standard)")
                prompt_data = workflow_data.get("prompt", {})
                if isinstance(prompt_data, dict):
                    info_lines.append(f"  - prompt nodes: {len(prompt_data)}")
            else:
                info_lines.append("Actually Used: No valid data recognized")

        # 添加提示
        info_lines.extend(
            [
                "",
                "=" * 50,
                "Tips:",
            ]
        )

        if save_mode == "full":
            info_lines.append(
                "  This mode saves data with complete "
                "localized names and widget info"
            )
            info_lines.append(
                "  Suitable for scenarios requiring full UI state preservation"
            )
        elif save_mode == "standard":
            info_lines.append(
                "  This mode saves data in ComfyUI standard format"
            )
            info_lines.append(
                "  Best compatibility, but lacks some UI metadata"
            )
        else:
            info_lines.append(
                "  Auto mode automatically selects "
                "the best available data source"
            )
            info_lines.append(
                "  Prioritizes full data, falls back "
                "to standard data if unavailable"
            )

        info_lines.append("")

        return "\n".join(info_lines)

    @classmethod
    def _analyze_workflow(cls, data: dict) -> dict:
        """
        分析 workflow 数据的完整性

        Args:
            data: workflow 数据

        Returns:
            dict: 分析结果
        """
        result = {
            "node_count": 0,
            "has_localized_name": False,
            "has_widget": False,
            "is_complete": False,
        }

        if not isinstance(data, dict):
            return result

        nodes = data.get("nodes", [])
        result["node_count"] = len(nodes)

        if not nodes:
            return result

        # 检查第一个节点的 inputs 是否包含 localized_name 和 widget
        for node in nodes:
            inputs = node.get("inputs", [])
            for input_data in inputs:
                if "localized_name" in input_data:
                    result["has_localized_name"] = True
                if "widget" in input_data:
                    result["has_widget"] = True

                if result["has_localized_name"] and result["has_widget"]:
                    break

            if result["has_localized_name"] and result["has_widget"]:
                break

        # 判断是否为完整格式
        result["is_complete"] = (
            result["has_localized_name"] and result["has_widget"]
        )

        return result

    @classmethod
    def _sanitize_path(cls, path: str) -> str:
        """
        清理路径，防止遍历攻击并禁用多级目录

        将所有危险字符和路径分隔符替换为下划线，
        确保只允许单级文件夹名称

        Args:
            path: 原始路径或文件夹名称

        Returns:
            安全的文件夹名称
        """
        if not path:
            return ""

        # 危险字符列表
        dangerous_chars = [
            "\\",
            "/",
            "..",
            ".",
            "|",
            ":",
            "*",
            "?",
            '"',
            "<",
            ">",
            "\n",
            "\r",
            "\t",
            "\x00",
            "\x0b",
            "\x0c",
        ]

        # 路径遍历模式
        path_traversal_patterns = [
            r"\.\./+",
            r"\.\.\\+",
            r"~",
            r"^\.",
            r"\.$",
            r"^/",
            r"^\\",
        ]

        # 替换危险字符
        safe_path = path
        for char in dangerous_chars:
            safe_path = safe_path.replace(char, "_")

        # 替换路径遍历模式
        for pattern in path_traversal_patterns:
            safe_path = re.sub(pattern, "_", safe_path)

        # 清理连续的下划线
        safe_path = re.sub(r"_+", "_", safe_path)

        # 移除首尾下划线
        safe_path = safe_path.strip("_")

        return safe_path

    @classmethod
    def _replace_datetime_placeholders(cls, text: str) -> str:
        """
        替换日期时间标识符

        支持的标识符:
        - %Y%: 年份(4位)
        - %m%: 月份(01-12)
        - %d%: 日期(01-31)
        - %H%: 小时(00-23)
        - %M%: 分钟(00-59)
        - %S%: 秒(00-59)

        Args:
            text: 包含日期时间标识符的文本

        Returns:
            替换后的文本
        """
        if not text:
            return ""

        now = datetime.now()

        # 使用正则表达式替换，确保完整匹配 %Y%, %m% 等格式
        def replace_match(match):
            placeholder = match.group()
            if placeholder == "%Y%":
                return now.strftime("%Y")
            elif placeholder == "%m%":
                return now.strftime("%m")
            elif placeholder == "%d%":
                return now.strftime("%d")
            elif placeholder == "%H%":
                return now.strftime("%H")
            elif placeholder == "%M%":
                return now.strftime("%M")
            elif placeholder == "%S%":
                return now.strftime("%S")
            return placeholder

        # 匹配 %X% 格式(X为Y,m,d,H,M,S)
        pattern = r"%(Y|m|d|H|M|S)%"
        result = re.sub(pattern, replace_match, text)

        return result

    @classmethod
    def _get_unique_filename(
        cls,
        directory: Path,
        filename: str,
        extension: str,
        max_attempts: int = 100000,
    ) -> str:
        """
        获取唯一的文件名，避免覆盖

        如果文件名不存在则直接使用，存在则添加序列号

        Args:
            directory: 目录路径
            filename: 基础文件名
            extension: 文件扩展名
            max_attempts: 最大尝试次数，防止无限循环

        Returns:
            唯一的文件名

        Raises:
            FileExistsError: 无法生成唯一文件名时抛出
        """
        base_name = filename

        for counter in range(max_attempts):
            if counter == 0:
                candidate = f"{base_name}{extension}"
            else:
                candidate = f"{base_name}_{counter:05d}{extension}"

            candidate_path = directory / candidate

            if not candidate_path.exists():
                return candidate

        raise FileExistsError("Unable to generate unique filename")


NODE_CLASS_MAPPINGS = {
    "XWorkflowSave": XWorkflowSave,
}
NODE_DISPLAY_NAME_MAPPINGS = {
    "XWorkflowSave": "XWorkflowSave",
}
