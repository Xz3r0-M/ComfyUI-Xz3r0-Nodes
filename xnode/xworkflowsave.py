"""
工作流保存节点模块
================

这个模块包含工作流JSON保存相关的节点。
"""

import json
import re
from datetime import datetime
from pathlib import Path

import folder_paths
from comfy_api.latest import io, ui


class XWorkflowSave(io.ComfyNode):
    """
    XWorkflowSave 工作流保存节点

    将ComfyUI工作流保存为JSON文件，支持自定义文件名、子文件夹、日期时间标识符。

    功能:
        - 保存工作流到ComfyUI默认输出目录
        - 支持自定义文件名和子文件夹
        - 支持日期时间标识符(%Y%, %m%, %d%, %H%, %M%, %S%)
        - 自动添加序列号防止覆盖(从00001开始)
        - 仅支持单级子文件夹创建
        - 安全防护(防止路径遍历攻击，禁用路径分隔符)
        - 输出相对路径(不泄露绝对路径)

    输入:
        anything: 任意输入(用于工作流连接，不处理数据) (ANY)
        filename_prefix: 文件名前缀 (STRING)
        subfolder: 子文件夹名称 (STRING)

    使用示例:
        anything=image,
        filename_prefix="Workflow_%Y%m%d",
        subfolder="Workflows"

    """

    @classmethod
    def define_schema(cls):
        """定义节点的输入类型和约束"""
        return io.Schema(
            node_id="XWorkflowSave",
            display_name="XWorkflowSave",
            category="♾️ Xz3r0/File-Processing",
            description=(
                "Saves the current ComfyUI workflow as a JSON file "
                "to your output directory. Useful for archiving "
                "workflows separately from media files."
            ),
            inputs=[
                io.AnyType.Input(
                    "anything",
                    tooltip=(
                        "Any input type for workflow connection. "
                        "This input is not processed, only used to "
                        "link the node into your workflow."
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
            hidden=[io.Hidden.prompt, io.Hidden.extra_pnginfo],
            is_output_node=True,
        )

    @classmethod
    def execute(
        cls,
        anything,
        filename_prefix: str,
        subfolder: str,
    ) -> io.NodeOutput:
        """
        保存工作流到ComfyUI输出目录

        Args:
            anything: 任意输入(用于工作流连接，不处理数据)
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

        # 保存工作流JSON文件
        prompt = cls.hidden.prompt
        extra_pnginfo = cls.hidden.extra_pnginfo

        workflow_data = {}
        if prompt is not None:
            workflow_data["prompt"] = prompt
        if extra_pnginfo is not None:
            workflow_data["workflow"] = extra_pnginfo.get("workflow")

        with open(save_path, "w", encoding="utf-8") as f:
            json.dump(workflow_data, f, indent=2, ensure_ascii=False)

        # 返回保存结果
        return io.NodeOutput(
            ui=ui.PreviewText(f"Workflow saved: {final_filename}")
        )

    @classmethod
    def _sanitize_path(cls, path: str) -> str:
        """
        清理路径，防止遍历攻击并禁用多级目录

        将所有危险字符和路径分隔符替换为下划线，确保只允许单级文件夹名称

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
