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
import re
from datetime import datetime
from pathlib import Path

import folder_paths
from comfy_api.latest import io, ui

from .xworkflowsave_api import workflow_store


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
        safe_filename_prefix = cls._sanitize_path(filename_prefix)
        safe_filename_prefix = cls._replace_datetime_placeholders(
            safe_filename_prefix
        )

        safe_subfolder = cls._sanitize_path(subfolder)
        safe_subfolder = cls._replace_datetime_placeholders(safe_subfolder)

        # Create full save path
        save_dir = output_dir
        if safe_subfolder:
            save_dir = save_dir / safe_subfolder

        # Create directory (only single level supported)
        save_dir.mkdir(exist_ok=True)

        # Generate filename (detect duplicates and add sequence number)
        base_filename = safe_filename_prefix
        final_filename = cls._get_unique_filename(
            save_dir, base_filename, ".json"
        )
        save_path = save_dir / final_filename

        # Prepare data according to save mode
        workflow_data = cls._prepare_workflow_data(save_mode)

        # Save file
        with open(save_path, "w", encoding="utf-8") as f:
            json.dump(workflow_data, f, indent=2, ensure_ascii=False)

        # Generate status message
        status_msg = cls._generate_status_message(
            final_filename, workflow_data, save_mode
        )

        # Generate workflow_info output content
        # Build relative path (based on ComfyUI output directory)
        relative_path = Path(final_filename)
        if safe_subfolder:
            relative_path = Path(safe_subfolder) / final_filename
        workflow_info = cls._generate_workflow_info(
            final_filename, workflow_data, save_mode, relative_path
        )

        # Return save results and pass-through data
        return io.NodeOutput(
            anything,
            workflow_info,
            ui=ui.PreviewText(status_msg),
        )

    @classmethod
    def _prepare_workflow_data(cls, save_mode: str) -> dict:
        """
        Prepare workflow data according to save mode

        Args:
            save_mode: Save mode ("Auto", "Native", "Prompt+FullWorkflow")

        Returns:
            dict: Prepared workflow data
        """
        workflow_data = {}
        prompt = cls.hidden.prompt
        extra_pnginfo = cls.hidden.extra_pnginfo
        unique_id = cls.hidden.unique_id

        # Try to get full workflow data from API storage
        full_workflow_data = None
        if unique_id:
            # Use unique_id as prompt_id to retrieve data from storage
            stored_data = workflow_store.retrieve(unique_id)
            if stored_data:
                full_workflow_data = stored_data.get("workflow")

        if save_mode == "Native":
            # Native mode: save prompt and workflow
            # (same as official SaveImage)
            # This format is compatible with ComfyUI web interface
            if prompt is not None:
                workflow_data["prompt"] = prompt
            if extra_pnginfo is not None and "workflow" in extra_pnginfo:
                workflow_data["workflow"] = extra_pnginfo["workflow"]

        elif save_mode == "Prompt+FullWorkflow":
            # Merge mode: prompt + full_workflow
            if prompt is not None:
                workflow_data["prompt"] = prompt
            if full_workflow_data:
                workflow_data["full_workflow"] = full_workflow_data
            else:
                raise ValueError(
                    "Prompt+FullWorkflow mode requires full workflow "
                    "data from frontend API. Please ensure the "
                    "frontend extension is loaded and the node is "
                    "triggered via Queue Prompt."
                )

        else:  # Auto mode
            # Auto mode: prefer Prompt+FullWorkflow,
            # fallback to Native if frontend unavailable
            if full_workflow_data:
                workflow_data["full_workflow"] = full_workflow_data
            elif extra_pnginfo is not None and "workflow" in extra_pnginfo:
                # Fallback to Native format (same as official SaveImage)
                if prompt is not None:
                    workflow_data["prompt"] = prompt
                workflow_data["workflow"] = extra_pnginfo["workflow"]
            else:
                workflow_data = {}

        return workflow_data

    @classmethod
    def _generate_status_message(
        cls, filename: str, workflow_data: dict, save_mode: str
    ) -> str:
        """
        Generate save status message

        Args:
            filename: Saved filename
            workflow_data: Saved workflow data
            save_mode: Used save mode

        Returns:
            str: Status message string
        """
        # Analyze data completeness
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
        if "full_workflow" in workflow_data:
            status_lines.append("Has full_workflow: Yes")

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
        Generate workflow_info output content

        Generate different info summaries based on save mode:
        - full mode: display key info summary of complete workflow
        - auto/standard mode: display save status and data overview

        Args:
            filename: Saved filename
            workflow_data: Saved workflow data
            save_mode: Used save mode
            relative_path: Relative save path (based on ComfyUI output dir)

        Returns:
            str: Workflow info string
        """
        # Use forward slashes for cross-platform consistency
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

        # Analyze data
        analysis = cls._analyze_workflow(workflow_data)

        # Data overview
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

        # Add mode-specific information
        info_lines.extend(["", "-" * 50, "Data Content:"])

        if save_mode == "Native":
            # Native mode: display native format info
            info_lines.append(
                "Mode Description: Using ComfyUI "
                "native workflow format (compatible with web)"
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

        elif save_mode == "Prompt+FullWorkflow":
            # Prompt+FullWorkflow mode: display prompt + full_workflow info
            info_lines.append(
                "Mode Description: Prompt+FullWorkflow mode "
                "(prompt + full_workflow)"
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

            if "full_workflow" in workflow_data:
                full_wf = workflow_data["full_workflow"]
                if isinstance(full_wf, dict):
                    nodes = full_wf.get("nodes", [])
                    links = full_wf.get("links", [])
                    info_lines.append(
                        f"  - full_workflow: {len(nodes)} nodes, "
                        f"{len(links)} links"
                    )
                else:
                    info_lines.append("  - full_workflow: Included")
            else:
                info_lines.append("  - full_workflow: None")

        else:  # Auto mode
            # Auto mode: display auto-detect results
            info_lines.append(
                "Mode Description: Auto-detect and select best data source"
            )
            info_lines.append("")

            # Determine which data was actually used
            has_full_workflow = "full_workflow" in workflow_data
            has_workflow = "workflow" in workflow_data
            has_prompt = "prompt" in workflow_data

            if has_full_workflow:
                info_lines.append("Actually Used: Prompt+FullWorkflow data")
                full_wf = workflow_data.get("full_workflow", {})
                nodes = full_wf.get("nodes", [])
                links = full_wf.get("links", [])
                info_lines.append(f"  - FullWorkflow Nodes: {len(nodes)}")
                info_lines.append(f"  - FullWorkflow Links: {len(links)}")
                if has_prompt:
                    prompt_data = workflow_data.get("prompt", {})
                    if isinstance(prompt_data, dict):
                        info_lines.append(
                            f"  - Prompt nodes: {len(prompt_data)}"
                        )
            elif has_workflow:
                info_lines.append("Actually Used: Standard data")
                wf_data = workflow_data.get("workflow", {})
                if isinstance(wf_data, dict):
                    nodes = wf_data.get("nodes", [])
                    info_lines.append(f"  - Workflow nodes: {len(nodes)}")
                if has_prompt:
                    prompt_data = workflow_data.get("prompt", {})
                    if isinstance(prompt_data, dict):
                        info_lines.append(
                            f"  - Prompt nodes: {len(prompt_data)}"
                        )
            else:
                info_lines.append("Actually Used: No valid data recognized")

        # Add tips
        info_lines.extend(
            [
                "",
                "=" * 50,
                "Tips:",
            ]
        )

        if save_mode == "Standard":
            info_lines.append("- Standard mode uses ComfyUI built-in data")
            info_lines.append("- No frontend extension required")
            info_lines.append("- Some metadata may be simplified")
        elif save_mode == "Prompt+FullWorkflow":
            info_lines.append(
                "- Prompt+FullWorkflow provides most complete data"
            )
            info_lines.append(
                "- Requires frontend extension for full_workflow"
            )
            info_lines.append("- Recommended for backup and sharing workflows")
        else:
            info_lines.append(
                "- Auto mode intelligently selects best available data"
            )
            info_lines.append(
                "- Prefers Prompt+FullWorkflow when frontend is ready"
            )
            info_lines.append(
                "- Falls back to Standard if frontend unavailable"
            )

        info_lines.extend(
            [
                "",
                "=" * 50,
            ]
        )

        return "\n".join(info_lines)

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

            # Determine completeness
            if analysis["has_localized_name"] and analysis["has_widget"]:
                analysis["is_complete"] = True

        return analysis

    @classmethod
    def _sanitize_path(cls, path_str: str) -> str:
        """
        Sanitize path string to prevent path traversal attacks

        Removes path separators and other dangerous characters.
        Only allows alphanumeric, hyphen, underscore, percent, and dot.

        Args:
            path_str: Original path string

        Returns:
            str: Sanitized safe path string
        """
        if not path_str:
            return ""

        # Remove path separators and null bytes
        dangerous_chars = [
            "\\",  # Windows separator
            "/",  # Unix separator
            "\x00",  # Null byte
            "..",  # Parent directory
        ]

        result = path_str
        for char in dangerous_chars:
            result = result.replace(char, "")

        # Only allow safe characters
        result = re.sub(r"[^a-zA-Z0-9_\-%.]", "", result)

        return result

    @classmethod
    def _replace_datetime_placeholders(cls, text: str) -> str:
        """
        Replace datetime placeholders in text

        Supported placeholders:
        - %Y%: Four-digit year (e.g., 2024)
        - %m%: Two-digit month (01-12)
        - %d%: Two-digit day (01-31)
        - %H%: Two-digit hour (00-23)
        - %M%: Two-digit minute (00-59)
        - %S%: Two-digit second (00-59)

        Args:
            text: Text containing placeholders

        Returns:
            str: Text with placeholders replaced
        """
        now = datetime.now()

        placeholders = {
            "%Y%": now.strftime("%Y"),
            "%m%": now.strftime("%m"),
            "%d%": now.strftime("%d"),
            "%H%": now.strftime("%H"),
            "%M%": now.strftime("%M"),
            "%S%": now.strftime("%S"),
        }

        result = text
        for placeholder, value in placeholders.items():
            result = result.replace(placeholder, value)

        return result

    @classmethod
    def _get_unique_filename(
        cls, directory: Path, base_name: str, extension: str
    ) -> str:
        """
        Generate unique filename (auto-add sequence number if duplicate)

        Sequence number starts from 00001 and increments.

        Args:
            directory: Target directory
            base_name: Base filename (without extension)
            extension: File extension (including dot)

        Returns:
            str: Unique filename
        """
        # First try base name
        filename = f"{base_name}{extension}"
        filepath = directory / filename

        if not filepath.exists():
            return filename

        # If exists, add sequence number
        counter = 1
        while True:
            filename = f"{base_name}_{counter:05d}{extension}"
            filepath = directory / filename

            if not filepath.exists():
                return filename

            counter += 1

            # Safety limit
            if counter > 99999:
                import time

                timestamp = int(time.time())
                return f"{base_name}_{timestamp}{extension}"
