"""
任意数据转字符串节点模块
========================

这个模块提供将任意输入数据转换为字符串的节点。
"""

import contextlib
import contextvars
import importlib
import threading
import time
from typing import Any

from comfy_api.latest import io, ui

try:
    from comfy_api.latest import ComfyAPISync
except ImportError:  # pragma: no cover - 测试桩 / 旧版本没有这个 API
    ComfyAPISync = None  # type: ignore[assignment]

try:
    from ..xz3r0_utils import get_logger
except ImportError:  # pragma: no cover - 包外直接运行时的回退
    from xz3r0_utils import get_logger

LOGGER = get_logger(__name__)

XDataStringType = io.Custom("xdata_string")

# 完整显示时的单行宽度。面板会自动折行，这里放宽一点少换行、更好读
_FULL_LINE_WIDTH = 200
# 超过这个长度就在日志里提醒一句（内容照常完整输出，不截断）
_LONG_TEXT_WARN_CHARS = 200_000

# ── 进度条参数 ──
# ComfyUI 把进度值换算成节点顶部那条绿条（value / max_value）
_PROGRESS_MAX = 100.0
# 估算进度封顶处：留点余量给真正的结束点，避免进度条先跑到头
_PROGRESS_CEILING = 0.95
# 进度条刷新间隔（秒）
_PROGRESS_TICK_SECONDS = 0.4
# 预估耗时低于这个秒数就不显示进度条（避免一闪而过）
_PROGRESS_MIN_SECONDS = 0.6
# 测速样本的元素个数区间
_SAMPLE_MIN_ELEMENTS = 256
_SAMPLE_MAX_ELEMENTS = 4096


@contextlib.contextmanager
def _full_print_options():
    """
    临时把张量 / 数组的打印规则改成「不省略」。

    PyTorch 和 NumPy 默认只打印首尾几个元素，中间用 ... 代替；
    完整打印只能改全局打印选项（没有按次调用的接口），
    所以这里临时改、退出时立刻还原。极端情况下（另一个线程恰好
    同时打印）只影响打印外观，不影响数据本身。
    """
    with contextlib.ExitStack() as stack:
        try:
            import torch  # noqa: PLC0415 - 只有完整显示时才需要

            printer = getattr(torch, "printoptions", None)
            if printer is None:
                # 部分版本只把上下文管理器放在私有模块里
                printer = torch._tensor_str.printoptions
            stack.enter_context(
                printer(
                    threshold=float("inf"),
                    linewidth=_FULL_LINE_WIDTH,
                )
            )
        except Exception:  # noqa: BLE001 - 依赖缺失或 API 变动时退回省略显示
            LOGGER.debug(
                "[XAnyToString] Full tensor printing unavailable, "
                "using shortened form"
            )
        try:
            import numpy as np  # noqa: PLC0415

            stack.enter_context(
                np.printoptions(
                    threshold=float("inf"),
                    linewidth=_FULL_LINE_WIDTH,
                )
            )
        except Exception:  # noqa: BLE001
            LOGGER.debug(
                "[XAnyToString] Full array printing unavailable, "
                "using shortened form"
            )
        yield


def _print_full(value: Any) -> str:
    """完整打印：张量 / 数组不省略中间元素。"""
    with _full_print_options():
        return str(value)


def _import_or_none(name: str) -> Any:
    """按需导入依赖；不可用时返回 None（完整打印会退回省略显示）。"""
    try:
        return importlib.import_module(name)
    except Exception:  # noqa: BLE001 - 依赖缺失不影响基本功能
        return None


def _elements_of(value: Any) -> int:
    """
    粗算输入里有多少个元素：张量 / 数组按元素个数，容器逐项累加。

    只用来估算打印耗时，认不出的类型算 0（不显示进度条）。
    """
    torch_module = _import_or_none("torch")
    numpy_module = _import_or_none("numpy")

    def count(item: Any) -> int:
        if torch_module is not None and isinstance(item, torch_module.Tensor):
            return int(item.numel())
        if numpy_module is not None and isinstance(item, numpy_module.ndarray):
            return int(item.size)
        if isinstance(item, (list, tuple, set, frozenset)):
            return sum(count(entry) for entry in item)
        if isinstance(item, dict):
            return sum(count(entry) for entry in item.values())
        return 0

    return count(value)


def _timing_sample(value: Any, elements: int) -> Any:
    """
    取一小块用于测速，尽量贴近整体打印速度。

    取扁平切片而不是按第一维切：batch=1 的张量第一维只有 1，
    按第一维会拿整个张量当样本，白白多打一遍。
    """
    size = min(
        max(elements // 20, _SAMPLE_MIN_ELEMENTS),
        _SAMPLE_MAX_ELEMENTS,
    )
    torch_module = _import_or_none("torch")
    if torch_module is not None and isinstance(value, torch_module.Tensor):
        if value.dim() == 0:
            return None
        return value.flatten()[:size]
    numpy_module = _import_or_none("numpy")
    if numpy_module is not None and isinstance(value, numpy_module.ndarray):
        if value.ndim == 0:
            return None
        return value.ravel()[:size]
    return None


def _estimate_full_seconds(value: Any, elements: int) -> float:
    """
    先试打一小块，按元素数估算完整打印要多久。

    只用来决定「要不要显示进度条」和进度条走多快；估算不准不影响结果。
    """
    if elements <= 0:
        return 0.0
    sample = _timing_sample(value, elements)
    if sample is None:
        return 0.0
    sample_elements = max(_elements_of(sample), 1)
    started = time.perf_counter()
    _print_full(sample)
    spent = time.perf_counter() - started
    return spent / sample_elements * elements


class _EstimatedProgress:
    """
    估算式进度条：长时间转换期间让节点顶部那条绿条缓慢前进。

    PyTorch 打印是一次性调用，内部没有进度可读，所以这里按预估耗时匀速
    推进，并且封顶在 _PROGRESS_CEILING；真正的结束值由调用方精确写入。
    """

    def __init__(self, api: Any, start: float, end: float, seconds: float):
        self._api = api
        self._start = float(start)
        self._end = float(end)
        self._seconds = float(seconds)
        self._stop = threading.Event()
        # 复制当前执行上下文：后台线程也要知道「正在执行哪个节点」
        self._context = contextvars.copy_context()
        self._thread: threading.Thread | None = None

    def __enter__(self) -> "_EstimatedProgress":
        self._thread = threading.Thread(
            target=self._run,
            name="XAnyToStringProgress",
            daemon=True,
        )
        self._thread.start()
        return self

    def __exit__(self, *exc_info: object) -> None:
        self._stop.set()
        thread, self._thread = self._thread, None
        if thread is not None:
            thread.join(timeout=1.0)

    def _run(self) -> None:
        started = time.monotonic()
        span = (self._end - self._start) * _PROGRESS_CEILING
        while not self._stop.wait(_PROGRESS_TICK_SECONDS):
            elapsed = time.monotonic() - started
            ratio = (
                1.0
                if self._seconds <= 0
                else min(
                    elapsed / self._seconds,
                    1.0,
                )
            )
            if not self._send(self._start + span * ratio):
                return

    def _send(self, value: float) -> bool:
        try:
            self._context.run(
                self._api.execution.set_progress,
                value,
                _PROGRESS_MAX,
            )
        except Exception:  # noqa: BLE001 - 进度条只是锦上添花
            LOGGER.debug(
                "[XAnyToString] Progress update skipped "
                "(no executing context?)"
            )
            return False
        return True


class _NodeProgress:
    """节点进度条门面：拿不到运行时 API 时全部变成空操作。"""

    def __init__(self, api: Any | None):
        self._api = api
        self._shown = False

    def convert(
        self,
        value: Any,
        *,
        full: bool,
        start: float,
        end: float,
    ) -> str:
        """
        把输入转成字符串。

        full=True 时不省略张量 / 数组的中间元素；完整打印很慢时顺手让
        进度条在 [start, end] 区间内缓慢前进。
        """
        if not full:
            return str(value)
        if self._api is None:
            return _print_full(value)

        seconds = _estimate_full_seconds(value, _elements_of(value))
        if seconds < _PROGRESS_MIN_SECONDS:
            return _print_full(value)

        self._shown = True
        with _EstimatedProgress(self._api, start, end, seconds):
            text = _print_full(value)
        # 阶段结束写精确值；最后一段由 finish() 收尾，不重复推送
        if end < _PROGRESS_MAX:
            self._report(end)
        return text

    def finish(self) -> None:
        """收尾：写精确的最大值，让进度条走完。"""
        if self._shown:
            self._report(_PROGRESS_MAX)

    def _report(self, value: float) -> None:
        if self._api is None:
            return
        try:
            self._api.execution.set_progress(value, _PROGRESS_MAX)
        except Exception:  # noqa: BLE001 - 进度条只是锦上添花
            self._shown = False


def _runtime_api() -> Any | None:
    """拿到 V3 运行时 API（用来画节点进度条）；不可用时返回 None。"""
    if ComfyAPISync is None:
        return None
    try:
        return ComfyAPISync()
    except Exception:  # noqa: BLE001 - 进度条只是锦上添花
        return None


class XAnyToString(io.ComfyNode):
    """
    任意数据转字符串节点

    将任意类型输入转换为字符串输出，同时保留原始数据透传。

    功能：
        - 接收任意类型输入
        - 使用 Python 原生 str() 转换为字符串
        - 同时输出原始数据，方便继续连接下游节点
        - 两个开关各管一头：
            完整显示：只影响节点面板里看到的文字
            完整输出：只影响 STRING 端口和 xdata 传给下游的内容

    输入：
        anything: 任意输入类型 (MatchType 输入)
        full_display: 面板是否完整显示长内容（默认关闭，保持省略显示）
        full_output: 输出的字符串是否完整（默认关闭，保持省略显示）

    输出：
        anything: 原始输入数据 (MatchType 透传输出)
        string: 转换后的字符串 (STRING)
        xdata_string: 字符串 xdata 协议输出

    Usage example:
        anything=123
        Output anything: 123
        Output string: "123"
    """

    @classmethod
    def define_schema(cls) -> io.Schema:
        """定义节点的输入类型和约束"""
        passthrough_template = io.MatchType.Template("anything_passthrough")

        return io.Schema(
            node_id="XAnyToString",
            display_name="XAnyToString",
            description=(
                "Convert any input data to a string using Python str() "
                "while also passing the original data through"
            ),
            category="♾️ Xz3r0/Workflow-Processing",
            is_output_node=True,
            inputs=[
                io.MatchType.Input(
                    "anything",
                    template=passthrough_template,
                    tooltip=(
                        "Pass-through input. The pass-through "
                        "output keeps the same data type as this input while "
                        "also converting the value with Python str()"
                    ),
                ),
                io.Boolean.Input(
                    "full_display",
                    default=False,
                    label_on="Enabled",
                    label_off="Disabled",
                    tooltip=(
                        "When Enabled, the node panel shows long content in "
                        "full: tensors and arrays print every element "
                        "instead of skipping the middle with '...'. "
                        "When Disabled, keep the shortened form. "
                        "Only changes what you see in the node. "
                        "Note: printing full content takes longer, so a "
                        "large tensor can need several seconds."
                    ),
                ),
                io.Boolean.Input(
                    "full_output",
                    default=False,
                    label_on="Enabled",
                    label_off="Disabled",
                    tooltip=(
                        "When Enabled, the String output and the xdata "
                        "payload carry the complete content. "
                        "When Disabled, they keep the shortened form. "
                        "Only changes what downstream nodes receive; the "
                        "panel follows Full Display instead. "
                        "Note: generating full content takes longer, so a "
                        "large tensor can need several seconds."
                    ),
                ),
            ],
            outputs=[
                io.MatchType.Output(
                    template=passthrough_template,
                    display_name="anything",
                    tooltip=(
                        "Original input data passed through for downstream "
                        "nodes"
                    ),
                ),
                io.String.Output(
                    "string",
                    tooltip="String converted from the input using str()",
                ),
                XDataStringType.Output(
                    "xdata_string",
                    tooltip="xdata_string payload for XDataSave",
                ),
            ],
        )

    @classmethod
    def execute(
        cls,
        anything: Any,
        full_display: bool = False,
        full_output: bool = False,
    ) -> io.NodeOutput:
        """
        执行任意数据转字符串

        Args:
            anything: 任意输入数据
            full_display: 面板是否完整显示长内容
            full_output: STRING 输出（含 xdata 内容）是否完整

        Returns:
            NodeOutput: 包含原始输入和转换后的字符串
        """
        progress = _NodeProgress(_runtime_api())
        # 两个开关不一样时要转两次，进度条各占一半
        # （一样时只转一次，进度条全程跟着这一次）
        two_passes = full_display != full_output
        first_end = _PROGRESS_MAX / 2 if two_passes else _PROGRESS_MAX
        try:
            display_text = progress.convert(
                anything,
                full=full_display,
                start=0.0,
                end=first_end,
            )
            if two_passes:
                output_text = progress.convert(
                    anything,
                    full=full_output,
                    start=first_end,
                    end=_PROGRESS_MAX,
                )
            else:
                output_text = display_text
        except Exception as exc:
            raise ValueError("Failed to convert input to string") from exc
        progress.finish()

        long_texts = [
            text
            for text, is_full in (
                (display_text, full_display),
                (output_text, full_output),
            )
            if is_full and len(text) > _LONG_TEXT_WARN_CHARS
        ]
        if long_texts:
            LOGGER.warning(
                "[XAnyToString] Full content produced %d characters. "
                "The node panel and downstream nodes may become slow.",
                max(len(text) for text in long_texts),
            )
        payload = {
            "data_type": "string",
            "text": output_text,
            "source": "XAnyToString",
        }
        return io.NodeOutput(
            anything,
            output_text,
            payload,
            ui=ui.PreviewText(display_text),
        )
