"""
ComfyUI-Xz3r0-Nodes V3 扩展入口。

此文件仅负责固定注册节点与最小环境提示。
"""

# ================================
# 注册策略约束（全文件级，必须遵守）
# ================================
# 1) 本项目约定使用固定注册列表，不做条件注册/动态隐藏节点。
# 2) 依赖缺失不在注册层兜底，错误由导入阶段或节点执行阶段抛出。
# 3) requirements.txt 内的 Python 依赖交由 ComfyUI/Python 处理。
# 4) 注册层只检测依赖文件之外的额外环境依赖（如系统 ffmpeg）。
# 5) on_load 仅输出面向用户的简短环境提示，不输出复杂调试统计。
# 6) 排序规则同时约束：
#    - `from .xnode...` 导入顺序
#    - `REGISTERED_NODE_CLASSES` 注册顺序
#    两者必须同时符合，禁止只调整其中一个。
# 7) 排序规则：
#    - 先放 Workflow-Processing 分类节点，再放 File-Processing 分类节点
#    - 列表保持单一连续结构，不使用空行或分段拆分
#    - 每个分类内部按节点类名字母序排列（A->Z）
# 8) 新增节点时必须按上述规则插入，不要按“最近修改”或“功能关联”排序。

import shutil

try:
    from typing import override
except ImportError:
    from typing_extensions import override

from comfy_api.latest import ComfyExtension, io  # noqa: I001

from .xnode.xanygate10 import XAnyGate10
from .xnode.xanytostring import XAnyToString
from .xnode.xaudioget import XAudioGet
from .xnode.xdatetimestring import XDateTimeString
from .xnode.xkleinrefconditioning import XKleinRefConditioning
from .xnode.xmath import XMath
from .xnode.xmemorycleanup import XMemoryCleanup
from .xnode.xresolution import XResolution
from .xnode.xseed import XSeed
from .xnode.xstringgroup import XStringGroup
from .xnode.xstringget import XStringGet
from .xnode.xstringwrap import XStringWrap
from .xnode.xaudiosave import XAudioSave
from .xnode.xdatasave import XDataSave
from .xnode.ximageget import XImageGet
from .xnode.ximageresize import XImageResize
from .xnode.ximagesave import XImageSave
from .xnode.xlatentload import XLatentLoad
from .xnode.xlatentsave import XLatentSave
from .xnode.xmarkdownsave import XMarkdownSave
from .xnode.xvideoget import XVideoGet
from .xnode.xvideosave import XVideoSave
from .xnode.xworkflowsave import XWorkflowSave
from .xz3r0_utils import configure_logging, get_logger

LOGGER = get_logger(__name__)


def _register_api_modules() -> None:
    """
    注册 API 路由模块（导入即注册）。

    兼容两种场景：
    1) 作为包导入（ComfyUI 正常加载）
    2) 作为脚本顶层导入（pytest 某些收集模式）
    """
    if __package__:
        __import__(f"{__package__}.api.xdatahub_api", fromlist=["*"])
        __import__(f"{__package__}.api.xworkflowsave_api", fromlist=["*"])
        return
    __import__("api.xdatahub_api")
    __import__("api.xworkflowsave_api")


_register_api_modules()

WEB_DIRECTORY = "./web"
REGISTERED_NODE_CLASSES: tuple[type[io.ComfyNode], ...] = (
    XAnyGate10,
    XAnyToString,
    XDateTimeString,
    XKleinRefConditioning,
    XMath,
    XMemoryCleanup,
    XResolution,
    XSeed,
    XStringGroup,
    XStringWrap,
    XAudioGet,
    XAudioSave,
    XDataSave,
    XImageGet,
    XImageResize,
    XImageSave,
    XLatentLoad,
    XLatentSave,
    XMarkdownSave,
    XStringGet,
    XVideoGet,
    XVideoSave,
    XWorkflowSave,
)


def is_ffmpeg_available() -> bool:
    """
    检查系统 PATH 中是否存在 ffmpeg 可执行文件。

    说明：
        仅检测 requirements.txt 之外的额外环境依赖。
    """
    return shutil.which("ffmpeg") is not None


class Xz3r0NodesExtension(ComfyExtension):
    """
    Xz3r0-Nodes 扩展类（V3）。
    """

    @override
    async def get_node_list(self) -> list[type[io.ComfyNode]]:
        """
        返回固定注册节点列表。
        """
        return list(REGISTERED_NODE_CLASSES)

    @override
    async def on_load(self):
        """
        扩展加载时输出最小环境提示。

        说明：
            requirements.txt 内依赖不在此处检测，交由 ComfyUI/Python。
        """
        configure_logging()
        if not is_ffmpeg_available():
            LOGGER.warning(
                "[Xz3r0-Nodes] ffmpeg not found in PATH. "
                "Some audio/video nodes may fail at runtime.",
            )


async def comfy_entrypoint() -> Xz3r0NodesExtension:
    """
    ComfyUI V3 入口点。
    """
    return Xz3r0NodesExtension()
