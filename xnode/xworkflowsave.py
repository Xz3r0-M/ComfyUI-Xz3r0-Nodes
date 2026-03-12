"""
工作流保存节点模块 (V3 API)
==========================

这个模块包含工作流JSON保存相关的节点。
支持三种保存模式：
1. Auto：自动检测，优先使用 Prompt+FullWorkflow，
   如前端扩展未加载则回退到 Native
2. Native：保存 prompt 和 extra_pnginfo.workflow
   （与官方 SaveImage 节点一致，兼容ComfyUI网页）
3. Prompt+FullWorkflow：同时保存 prompt 和完整 workflow
   通过自定义 API 接口 /xz3r0/xworkflowsave/capture 接收数据
"""

import json
from pathlib import Path

import folder_paths
from comfy_api.latest import io, ui

try:
    from ..api.xworkflowsave_api import workflow_store
except ImportError:
    from api.xworkflowsave_api import workflow_store

try:
    from ..xz3r0_utils import (
        ensure_unique_filename,
        replace_datetime_tokens,
        resolve_output_subpath,
        sanitize_path_component,
    )
except ImportError:
    # 兼容直接执行测试脚本时从仓库根目录导入 xnode 的场景。
    from xz3r0_utils import (
        ensure_unique_filename,
        replace_datetime_tokens,
        resolve_output_subpath,
        sanitize_path_component,
    )


class XWorkflowSave(io.ComfyNode):
    """
    XWorkflowSave 工作流保存节点 (V3)

    将ComfyUI工作流保存为JSON文件，支持三种保存模式：
    - Auto：自动检测，优先使用 Prompt+FullWorkflow，
            如前端扩展未加载则回退到 Native
    - Native：保存 prompt 和 workflow（来自 extra_pnginfo，
              与官方 SaveImage 节点一致，兼容ComfyUI网页加载）
    - Prompt+FullWorkflow：同时保存 prompt 和完整 workflow

    功能:
        - 保存工作流到ComfyUI默认输出目录
        - 支持自定义文件名和子文件夹
        - 支持日期时间标识符(%Y%, %m%, %d%, %H%, %M%, %S%)
        - 自动添加序列号防止覆盖(从00001开始)
        - 仅支持单级子文件夹创建
        - 安全防护(防止路径遍历攻击，禁用路径分隔符)

    输入:
        anything: 任意输入(用于工作流连接，不处理数据，可选) (ANY)
        save_mode: 保存模式选择 (COMBO: Auto/Native/Prompt+FullWorkflow)
        filename_prefix: 文件名前缀 (STRING)
        subfolder: 子文件夹名称 (STRING)

    输出:
        anything: 透传输入的数据，可直接传递给下游节点 (ANY)
        workflow_info: 工作流信息摘要，包含保存状态和数据概览 (STRING)

    使用示例:
        save_mode="Auto",
        filename_prefix="Workflow_%Y%m%d",
        subfolder="Workflows"
        (anything输入为可选，可以不连接任何数据)

    技术说明:
        Prompt+FullWorkflow 模式通过前端扩展自动捕获 workflow 数据，
        并通过 /xz3r0/xworkflowsave/capture API 发送到后端存储。
        节点执行时通过 unique_id 从存储中获取数据。
    """
    OUTPUT_DIRECTORY_ERROR = "Unable to create output directory"
    WRITE_WORKFLOW_ERROR = "Unable to write workflow file"
    RELATIVE_PATH_ERROR = "Unable to build relative save path"

    @classmethod
    def define_schema(cls):
        """Define node input types and constraints"""
        return io.Schema(
            node_id="XWorkflowSave",
            display_name="XWorkflowSave",
            category="♾️ Xz3r0/File-Processing",
            description=(
                "Workflow save node that saves the ComfyUI workflow as a "
                "JSON file. Supports three save modes: Auto (auto-detect), "
                "Native (prompt + workflow, same as official SaveImage), "
                "and Prompt+FullWorkflow (prompt + full_workflow). "
                "Prompt+FullWorkflow mode uses custom API to receive "
                "data from frontend."
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
                    options=[
                        "Auto",
                        "Native",
                        "Prompt+FullWorkflow",
                    ],
                    default="Auto",
                    tooltip=(
                        "Save mode: Auto (auto-detect, prefer "
                        "Prompt+FullWorkflow, fallback to Native), "
                        "Native (native workflow format, compatible "
                        "with ComfyUI web), Prompt+FullWorkflow "
                        "(prompt + full_workflow)"
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
        save_mode: str = "Auto",
        filename_prefix: str = "ComfyUI_%Y%-%m%-%d%_%H%-%M%-%S%",
        subfolder: str = "Workflows",
    ) -> io.NodeOutput:
        """
        Save workflow to ComfyUI output directory

        Args:
            anything: Any input (for workflow connection, optional)
            save_mode: Save mode ("Auto", "Native", "Prompt+FullWorkflow")
            filename_prefix: Filename prefix (supports datetime placeholders)
            subfolder: Subfolder name (single level)

        Returns:
            io.NodeOutput: Contains save results
        """
        # Get ComfyUI default output directory
        output_dir = Path(folder_paths.get_output_directory())

        # Process datetime placeholders and security filtering
        safe_filename_prefix = sanitize_path_component(filename_prefix)
        safe_filename_prefix = replace_datetime_tokens(
            safe_filename_prefix
        )

        safe_subfolder = sanitize_path_component(subfolder)
        safe_subfolder = replace_datetime_tokens(safe_subfolder)

        # Create full save path
        save_dir = resolve_output_subpath(output_dir, safe_subfolder)

        # Create directory (only single level supported)
        try:
            save_dir.mkdir(exist_ok=True)
        except OSError as exc:
            raise RuntimeError(cls.OUTPUT_DIRECTORY_ERROR) from exc

        # Generate filename (detect duplicates and add sequence number)
        final_filename = ensure_unique_filename(
            save_dir,
            safe_filename_prefix,
            ".json",
        )
        save_path = resolve_output_subpath(
            output_dir,
            Path(safe_subfolder) / final_filename,
        )

        # Prepare data according to save mode
        workflow_data, actual_mode = cls._prepare_workflow_data(save_mode)

        # Save file
        try:
            with open(save_path, "w", encoding="utf-8") as file:
                json.dump(workflow_data, file, indent=2, ensure_ascii=False)
        except OSError as exc:
            raise RuntimeError(cls.WRITE_WORKFLOW_ERROR) from exc

        # Generate status message
        status_msg = cls._generate_status_message(
            final_filename,
            workflow_data,
            save_mode,
            actual_mode,
        )

        # Generate workflow_info output content
        # Build relative path (based on ComfyUI output directory)
        relative_path = cls._build_relative_save_path(
            save_path, output_dir
        )
        workflow_info = cls._generate_workflow_info(
            final_filename,
            workflow_data,
            save_mode,
            actual_mode,
            relative_path,
        )

        # Return save results and pass-through data
        return io.NodeOutput(
            anything,
            workflow_info,
            ui=ui.PreviewText(status_msg),
        )

    @classmethod
    def _prepare_workflow_data(cls, save_mode: str) -> tuple[dict, str]:
        """
        Prepare workflow data according to save mode

        Args:
            save_mode: Save mode ("Auto", "Native", "Prompt+FullWorkflow")

        Returns:
            tuple[dict, str]:
                工作流数据和实际执行模式
        """
        prompt = cls.hidden.prompt
        extra_pnginfo = cls.hidden.extra_pnginfo
        unique_id = cls.hidden.unique_id

        # Try to get full workflow data from API storage
        full_workflow_data = cls._get_full_workflow_data(unique_id)

        if save_mode == "Native":
            return cls._build_native_data(prompt, extra_pnginfo), "Native"

        if save_mode == "Prompt+FullWorkflow":
            workflow_data = cls._build_prompt_full_data(
                prompt,
                full_workflow_data,
            )
            return workflow_data, "Prompt+FullWorkflow"

        # Auto mode: simple selector, no third data format
        if cls._is_prompt_full_available(full_workflow_data):
            workflow_data = cls._build_prompt_full_data(
                prompt,
                full_workflow_data,
            )
            return workflow_data, "Prompt+FullWorkflow"
        return cls._build_native_data(prompt, extra_pnginfo), "Native"

    @classmethod
    def _build_native_data(cls, prompt, extra_pnginfo) -> dict:
        """
        构建 Native 模式输出数据。
        """
        workflow_data = {}
        if prompt is not None:
            workflow_data["prompt"] = prompt
        if extra_pnginfo is not None and "workflow" in extra_pnginfo:
            workflow_data["workflow"] = extra_pnginfo["workflow"]
        return workflow_data

    @classmethod
    def _build_prompt_full_data(
        cls,
        prompt,
        full_workflow_data,
    ) -> dict:
        """
        构建 Prompt+FullWorkflow 模式输出数据。
        """
        if not cls._is_prompt_full_available(full_workflow_data):
            raise ValueError(
                "Prompt+FullWorkflow mode requires full workflow "
                "data from frontend API. Please ensure the "
                "frontend extension is loaded and the node is "
                "triggered via Queue Prompt."
            )

        workflow_data = {"full_workflow": full_workflow_data}
        if prompt is not None:
            workflow_data["prompt"] = prompt
        return workflow_data

    @classmethod
    def _get_full_workflow_data(cls, unique_id) -> dict | None:
        """
        从缓存读取完整工作流数据。
        """
        if not unique_id:
            return None
        stored_data = workflow_store.retrieve(unique_id)
        if not isinstance(stored_data, dict):
            return None
        workflow = stored_data.get("workflow")
        if isinstance(workflow, dict):
            return workflow
        return None

    @classmethod
    def _is_prompt_full_available(cls, full_workflow_data) -> bool:
        """
        判断 Prompt+FullWorkflow 数据是否可用。
        """
        if not isinstance(full_workflow_data, dict):
            return False
        return bool(full_workflow_data)

    @classmethod
    def _generate_status_message(
        cls,
        filename: str,
        workflow_data: dict,
        save_mode: str,
        actual_mode: str,
    ) -> str:
        """
        Generate save status message

        Args:
            filename: Saved filename
            workflow_data: Saved workflow data
            save_mode: Selected save mode
            actual_mode: Actually used mode

        Returns:
            str: Status message string
        """
        analysis = cls._analyze_workflow(workflow_data)
        metadata_level = cls._get_metadata_level(analysis)
        data_keys = cls._format_data_keys(workflow_data)
        graph_line = cls._format_graph_line(workflow_data, analysis)

        status_lines = [
            f"Saved: {filename}",
            f"Mode: {save_mode} -> {actual_mode}",
            f"Data Keys: {data_keys}",
            graph_line,
            f"Metadata: {metadata_level}",
        ]

        return "\n".join(status_lines)

    @classmethod
    def _generate_workflow_info(
        cls,
        filename: str,
        workflow_data: dict,
        save_mode: str,
        actual_mode: str,
        relative_path: Path,
    ) -> str:
        """
        Generate workflow_info output content

        Generate different info summaries based on save mode:
        - full mode: display key info summary of complete workflow
        - auto/standard mode: display save status and data overview

        Args:
            filename: Saved filename
            workflow_data: Saved workflow data
            save_mode: Selected save mode
            actual_mode: Actually used mode
            relative_path: Relative save path (based on ComfyUI output dir)

        Returns:
            str: Workflow info string
        """
        posix_path = relative_path.as_posix()
        analysis = cls._analyze_workflow(workflow_data)
        metadata_level = cls._get_metadata_level(analysis)
        data_keys = cls._format_data_keys(workflow_data)
        graph_line = cls._format_graph_line(workflow_data, analysis)
        has_localized_name = "Yes" if analysis["has_localized_name"] else "No"
        has_widget = "Yes" if analysis["has_widget"] else "No"

        info_lines = [
            f"Saved: {filename}",
            f"Path: [output_dir]/{posix_path}",
            f"Mode: {save_mode} -> {actual_mode}",
            f"Data Keys: {data_keys}",
            graph_line,
            f"Metadata: {metadata_level}",
            (
                "Flags: "
                f"localized_name={has_localized_name}, "
                f"widget={has_widget}"
            ),
        ]
        return "\n".join(info_lines)

    @classmethod
    def _format_data_keys(cls, workflow_data: dict) -> str:
        """
        按固定顺序输出存在的数据键，便于快速阅读。
        """
        ordered_keys = ["prompt", "workflow", "full_workflow"]
        keys = [key for key in ordered_keys if key in workflow_data]
        if not keys:
            return "none"
        return "/".join(keys)

    @classmethod
    def _format_graph_line(cls, workflow_data: dict, analysis: dict) -> str:
        """
        统一图规模展示，links 仅在 full_workflow 可用时统计。
        """
        nodes = analysis["node_count"]
        links = cls._get_link_count(workflow_data)
        if links is None:
            return f"Graph: nodes={nodes}, links=N/A"
        return f"Graph: nodes={nodes}, links={links}"

    @classmethod
    def _get_link_count(cls, workflow_data: dict) -> int | None:
        """
        获取 full_workflow 中的链接数量，不可用时返回 None。
        """
        full_workflow = workflow_data.get("full_workflow")
        if not isinstance(full_workflow, dict):
            return None
        links = full_workflow.get("links")
        if isinstance(links, list):
            return len(links)
        return 0

    @classmethod
    def _get_metadata_level(cls, analysis: dict) -> str:
        """
        根据元数据标记输出 Full/Partial/Basic 等级。
        """
        has_localized_name = analysis["has_localized_name"]
        has_widget = analysis["has_widget"]
        if has_localized_name and has_widget:
            return "Full"
        if has_localized_name or has_widget:
            return "Partial"
        return "Basic"

    @classmethod
    def _analyze_workflow(cls, workflow_data: dict) -> dict:
        """
        Analyze workflow data completeness

        Args:
            workflow_data: Workflow data dictionary

        Returns:
            dict: Analysis results containing:
                - node_count: Node count
                - is_complete: Whether metadata is complete
                - has_localized_name: Whether contains localized_name
                - has_widget: Whether contains widget info
        """
        analysis = {
            "node_count": 0,
            "is_complete": False,
            "has_localized_name": False,
            "has_widget": False,
        }

        if not workflow_data:
            return analysis

        # Analyze based on data structure
        if "full_workflow" in workflow_data:
            wf = workflow_data["full_workflow"]
        elif "workflow" in workflow_data:
            wf = workflow_data["workflow"]
        else:
            wf = workflow_data

        if isinstance(wf, dict):
            nodes = wf.get("nodes", [])
            analysis["node_count"] = len(nodes)

            # Check for localized_name and widget
            for node in nodes:
                if isinstance(node, dict):
                    if node.get("localized_name"):
                        analysis["has_localized_name"] = True
                    widgets_values = node.get("widgets_values", [])
                    if widgets_values:
                        analysis["has_widget"] = True

            if analysis["has_localized_name"] and analysis["has_widget"]:
                analysis["is_complete"] = True

        return analysis

    @classmethod
    def _build_relative_save_path(
        cls,
        save_path: Path,
        output_dir: Path,
    ) -> Path:
        """
        基于当前实例输出目录构建相对保存路径。

        Args:
            save_path: 实际保存文件路径
            output_dir: ComfyUI 输出根目录

        Returns:
            Path: 相对输出目录的保存路径
        """
        try:
            return Path(save_path).relative_to(output_dir)
        except ValueError as exc:
            raise RuntimeError(cls.RELATIVE_PATH_ERROR) from exc
