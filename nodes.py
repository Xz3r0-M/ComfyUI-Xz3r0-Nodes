"""
节点聚合导出模块。

此文件只负责集中维护节点清单，便于入口文件按条件注册。
"""

from .xnode.xanytostring import XAnyToString
from .xnode.xdatetimestring import XDateTimeString
from .xnode.ximagesave import XImageSave
from .xnode.ximageresize import XImageResize
from .xnode.xkleinreflatentauto import XKleinRefLatentAuto
from .xnode.xlatentload import XLatentLoad
from .xnode.xlatentsave import XLatentSave
from .xnode.xmarkdownsave import XMarkdownSave
from .xnode.xmath import XMath
from .xnode.xresolution import XResolution
from .xnode.xstringgroup import XStringGroup
from .xnode.xworkflowsave import XWorkflowSave

BASE_NODE_CLASSES = (
    XAnyToString,
    XDateTimeString,
    XKleinRefLatentAuto,
    XMath,
    XResolution,
    XStringGroup,
    XImageResize,
    XImageSave,
    XLatentLoad,
    XLatentSave,
    XMarkdownSave,
    XWorkflowSave,
)

try:
    from .xnode.xaudiosave import XAudioSave
    from .xnode.xvideosave import XVideoSave

    FFMPEG_NODE_CLASSES = (XAudioSave, XVideoSave)
except ImportError:
    # 允许在缺少 ffmpeg-python 时继续加载基础节点。
    FFMPEG_NODE_CLASSES: tuple[type, ...] = ()

__all__ = ["BASE_NODE_CLASSES", "FFMPEG_NODE_CLASSES"]
