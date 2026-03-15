"""
Markdown 保存节点模块
====================

这个模块包含 Markdown 文本保存相关的节点。
"""

from pathlib import Path

from comfy_api.latest import io

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

try:
    import folder_paths

    COMFYUI_AVAILABLE = True
except ImportError:
    COMFYUI_AVAILABLE = False


class XMarkdownSave(io.ComfyNode):
    """
    XMarkdownSave Markdown 保存节点

    将头部、正文、尾部的输入端口或文本框内容保存为 Markdown 文件，
    并输出最终保存内容与相对保存路径。

    功能:
        - 保存 Markdown 到 ComfyUI 默认输出目录
        - 头部、正文、尾部都支持字符串输入端口优先
        - 支持在正文前后显式插入换行分隔
        - 支持头部和尾部文本直接拼接
        - 支持自定义文件名和子文件夹
        - 支持日期时间标识符(%Y%, %m%, %d%, %H%, %M%, %S%)
        - 自动检测同名文件并添加序列号
        - 仅支持单级子文件夹创建
        - 安全防护(防止路径遍历攻击，禁用路径分隔符)
        - 输出相对路径(不泄露绝对路径)

    输入:
        header_input: 头部字符串输入端口 (STRING，可选，优先使用)
        text_content: 正文文本输入框 (STRING，多行，回退使用)
        main_text_input: 正文字符串输入端口 (STRING，可选，优先使用)
        header_text: 头部额外文本 (STRING，多行)
        footer_input: 尾部字符串输入端口 (STRING，可选，优先使用)
        footer_text: 尾部额外文本 (STRING，多行)
        filename_prefix: 文件名前缀 (STRING)
        subfolder: 子文件夹名称 (STRING)
        before_main_separator: 正文前分隔方式 (COMBO)
        before_main_newline_count: 正文前换行次数 (INT)
        after_main_separator: 正文后分隔方式 (COMBO)
        after_main_newline_count: 正文后换行次数 (INT)

    输出:
        content: 最终保存的完整 Markdown 内容 (STRING)
        save_path: 保存的相对路径 (STRING)
    """

    SEPARATOR_OPTIONS = [
        "none",
        "newline",
    ]
    OUTPUT_DIRECTORY_ERROR = "Unable to create output directory"
    WRITE_MARKDOWN_ERROR = "Unable to write markdown file"
    RELATIVE_PATH_ERROR = "Unable to build relative save path"

    @classmethod
    def define_schema(cls) -> io.Schema:
        """定义节点的输入类型和约束"""
        return io.Schema(
            node_id="XMarkdownSave",
            display_name="XMarkdownSave",
            description=(
                "Save markdown text from a string input or multiline "
                "textbox with explicit separators before and after the "
                "main content"
            ),
            category="♾️ Xz3r0/File-Processing",
            is_output_node=True,
            inputs=[
                io.String.Input(
                    "filename_prefix",
                    default="ComfyUI_%Y%-%m%-%d%_%H%-%M%-%S%",
                    tooltip=(
                        "Filename prefix, supports datetime "
                        "placeholders: %Y%, %m%, %d%, %H%, %M%, %S%"
                    ),
                ),
                io.String.Input(
                    "subfolder",
                    default="Markdown",
                    tooltip=(
                        "Subfolder name (no path separators allowed), "
                        "supports datetime placeholders: %Y%, %m%, "
                        "%d%, %H%, %M%, %S%"
                    ),
                ),
                io.String.Input(
                    "header_input",
                    optional=True,
                    force_input=True,
                    tooltip=(
                        "Optional header string input. When connected, "
                        "this input takes priority over header_text"
                    ),
                ),
                io.String.Input(
                    "header_text",
                    default="",
                    multiline=True,
                    tooltip=(
                        "Fallback multiline header text used when "
                        "header_input is not connected. Use separator "
                        "controls below instead of relying on trailing "
                        "blank lines"
                    ),
                ),
                io.Combo.Input(
                    "before_main_separator",
                    options=cls.SEPARATOR_OPTIONS,
                    default="none",
                    tooltip=(
                        "Separator inserted between header_text and the "
                        "main content: none or newline"
                    ),
                ),
                io.Int.Input(
                    "before_main_newline_count",
                    default=1,
                    min=1,
                    max=99,
                    step=1,
                    tooltip=(
                        "Number of newline characters inserted before the "
                        "main content when before_main_separator is newline"
                    ),
                ),
                io.String.Input(
                    "main_text_input",
                    optional=True,
                    force_input=True,
                    tooltip=(
                        "Optional main content string input. When connected, "
                        "input takes priority over text_content"
                    ),
                ),
                io.String.Input(
                    "text_content",
                    default="",
                    multiline=True,
                    tooltip=(
                        "Fallback multiline text content used when "
                        "text_input is not connected"
                    ),
                ),
                io.Combo.Input(
                    "after_main_separator",
                    options=cls.SEPARATOR_OPTIONS,
                    default="none",
                    tooltip=(
                        "Separator inserted between the main content and "
                        "footer_text: none or newline"
                    ),
                ),
                io.Int.Input(
                    "after_main_newline_count",
                    default=1,
                    min=1,
                    max=99,
                    step=1,
                    tooltip=(
                        "Number of newline characters inserted after the "
                        "main content when after_main_separator is newline"
                    ),
                ),
                io.String.Input(
                    "footer_input",
                    optional=True,
                    force_input=True,
                    tooltip=(
                        "Optional footer string input. When connected, "
                        "this input takes priority over footer_text"
                    ),
                ),
                io.String.Input(
                    "footer_text",
                    default="",
                    multiline=True,
                    tooltip=(
                        "Fallback multiline footer text used when "
                        "footer_input is not connected. Use separator "
                        "controls above instead of relying on leading "
                        "blank lines"
                    ),
                ),
            ],
            outputs=[
                io.String.Output(
                    "content",
                    tooltip="Final markdown content saved to the file",
                ),
                io.String.Output(
                    "save_path",
                    tooltip=(
                        "Saved file path relative to ComfyUI output directory"
                    ),
                ),
            ],
        )

    @classmethod
    def execute(
        cls,
        filename_prefix: str = "ComfyUI_%Y%-%m%-%d%_%H%-%M%-%S%",
        subfolder: str = "Markdown",
        header_input: str | None = None,
        header_text: str = "",
        before_main_separator: str = "none",
        before_main_newline_count: int = 1,
        main_text_input: str | None = None,
        text_content: str = "",
        after_main_separator: str = "none",
        after_main_newline_count: int = 1,
        footer_input: str | None = None,
        footer_text: str = "",
    ) -> io.NodeOutput:
        """
        保存 Markdown 内容到 ComfyUI 输出目录

        Args:
            header_input: 头部字符串输入端口内容，优先使用
            header_text: 头部额外文本
            before_main_separator: 正文前分隔方式
            before_main_newline_count: 正文前换行次数
            main_text_input: 正文字符串输入端口内容，优先使用
            text_content: 正文文本框内容
            after_main_separator: 正文后分隔方式
            after_main_newline_count: 正文后换行次数
            footer_input: 尾部字符串输入端口内容，优先使用
            footer_text: 尾部额外文本
            filename_prefix: 文件名前缀
            subfolder: 子文件夹名称

        Returns:
            NodeOutput: 包含最终保存内容和保存相对路径
        """
        output_dir = cls._get_output_directory()

        safe_filename_prefix = sanitize_path_component(filename_prefix)
        safe_filename_prefix = replace_datetime_tokens(safe_filename_prefix)

        safe_subfolder = sanitize_path_component(subfolder)
        safe_subfolder = replace_datetime_tokens(safe_subfolder)

        save_dir = resolve_output_subpath(output_dir, safe_subfolder)
        try:
            save_dir.mkdir(exist_ok=True)
        except OSError as exc:
            raise RuntimeError(cls.OUTPUT_DIRECTORY_ERROR) from exc

        header_value = (
            header_input if header_input is not None else header_text
        )
        main_text = (
            main_text_input if main_text_input is not None else text_content
        )
        footer_value = (
            footer_input if footer_input is not None else footer_text
        )
        before_separator = cls._build_separator(
            before_main_separator,
            before_main_newline_count,
            "before_main_newline_count",
        )
        after_separator = cls._build_separator(
            after_main_separator,
            after_main_newline_count,
            "after_main_newline_count",
        )
        final_content = (
            f"{header_value}{before_separator}{main_text}"
            f"{after_separator}{footer_value}"
        )

        final_filename = ensure_unique_filename(
            save_dir,
            safe_filename_prefix,
            ".md",
        )
        save_path = resolve_output_subpath(
            output_dir,
            Path(safe_subfolder) / final_filename,
        )

        try:
            with open(save_path, "w", encoding="utf-8") as file:
                file.write(final_content)
        except OSError as exc:
            raise RuntimeError(cls.WRITE_MARKDOWN_ERROR) from exc

        relative_path = cls._build_relative_save_path(save_path, output_dir)

        return io.NodeOutput(final_content, relative_path)

    @classmethod
    def _build_separator(
        cls,
        separator_mode: str,
        newline_count: int,
        field_name: str,
    ) -> str:
        """
        根据分隔模式构建正文前后分隔文本
        """
        if separator_mode == "none":
            return ""

        if separator_mode != "newline":
            raise ValueError(f"Unknown separator mode: {separator_mode}")

        cls._validate_newline_count(newline_count, field_name)
        return "\n" * newline_count

    @classmethod
    def _validate_newline_count(
        cls,
        newline_count: int,
        field_name: str,
    ) -> None:
        """
        验证换行次数必须大于等于 1
        """
        if newline_count < 1:
            raise ValueError(f"{field_name} must be >= 1")

    @classmethod
    def _get_output_directory(cls) -> Path:
        """
        获取 ComfyUI 默认输出目录

        Returns:
            输出目录路径
        """
        if COMFYUI_AVAILABLE:
            return Path(folder_paths.get_output_directory())

        return Path("test_output")

    @classmethod
    def _build_relative_save_path(
        cls,
        save_path: Path,
        output_dir: Path,
    ) -> str:
        """
        基于当前实例输出目录构建相对保存路径。
        """
        try:
            return str(Path(save_path).relative_to(output_dir))
        except ValueError as exc:
            raise RuntimeError(cls.RELATIVE_PATH_ERROR) from exc
