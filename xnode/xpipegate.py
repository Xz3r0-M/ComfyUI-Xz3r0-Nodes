"""支持 XPipe_v2 数据束的 50 路动态 Lazy 门控节点。"""

import json
from typing import Any

from comfy_api.latest import io

try:
    from ..xz3r0_utils import get_logger
except ImportError:  # pragma: no cover - 包外脚本运行兜底
    from xz3r0_utils import get_logger

LOGGER = get_logger(__name__)

GATE_SLOTS = 50
XPipeV2Bundle = io.Custom("xpipe_v2")


class XPipeGate(io.ComfyNode):
    """合并 XPipe_v2 数据束与独立输入并进行逐路门控。"""

    @classmethod
    def define_schema(cls) -> io.Schema:
        """定义 50 路固定后端槽位，由前端动态收缩可见部分。"""
        templates = [
            io.MatchType.Template(
                f"pipe_gate_slot_{index}",
                allowed_types=[io.AnyType],
            )
            for index in range(1, GATE_SLOTS + 1)
        ]

        inputs: list[Any] = [
            XPipeV2Bundle.Input(
                "xpipe_in",
                optional=True,
                tooltip=(
                    "Connect an XPipe_v2 bundle. Direct channel inputs "
                    "override matching bundled values."
                ),
            ),
        ]
        for index, template in enumerate(templates, start=1):
            inputs.append(
                io.MatchType.Input(
                    f"input_{index}",
                    template=template,
                    optional=True,
                    lazy=True,
                    tooltip=(
                        f"Channel {index} lazy input (optional, accepts any "
                        "data). Disabled channels do not request this input."
                    ),
                ),
            )
        for index in range(1, GATE_SLOTS + 1):
            inputs.append(
                io.Boolean.Input(
                    f"enable_{index}",
                    default=True,
                    label_on="Enabled",
                    label_off="Disabled",
                    tooltip=f"Enable channel {index} output",
                ),
            )
        inputs.append(
            io.String.Input(
                "port_names",
                default="[]",
                socketless=True,
                extra_dict={"hidden": True},
                tooltip="Serialized slot names managed by the frontend",
            ),
        )
        outputs: list[Any] = [
            XPipeV2Bundle.Output(
                "xpipe_out",
                display_name="xpipe_out",
                tooltip=(
                    "Send the merged and gated values as an XPipe_v2 bundle."
                ),
            ),
        ]
        for index, template in enumerate(templates, start=1):
            outputs.append(
                io.MatchType.Output(
                    template=template,
                    display_name=f"output_{index}",
                    tooltip=(
                        f"Channel {index} output (None when disabled or "
                        "empty)"
                    ),
                ),
            )
        return io.Schema(
            node_id="XPipeGate",
            display_name="XPipeGate",
            description=(
                "Gate an XPipe_v2 bundle and up to 50 direct any-type inputs "
                "with native Lazy evaluation for direct inputs."
            ),
            category="♾️ Xz3r0/Workflow-Processing",
            inputs=inputs,
            outputs=outputs,
        )

    @classmethod
    def _extract_bundle(cls, xpipe_in: Any) -> tuple[list[Any], list[str]]:
        """校验并规范化 XPipe_v2 数据束。"""
        if xpipe_in is None:
            return [None] * GATE_SLOTS, [""] * GATE_SLOTS
        if not (
            isinstance(xpipe_in, dict)
            and xpipe_in.get("__xpipe_v2_bundle__") is True
            and xpipe_in.get("__xpipe_v2_version__") == 2
        ):
            raise ValueError("xpipe_in must be a valid XPipe_v2 bundle")

        raw_values = xpipe_in.get("values")
        values = list(raw_values[:GATE_SLOTS]) if isinstance(
            raw_values, list
        ) else []
        values += [None] * (GATE_SLOTS - len(values))

        raw_names = xpipe_in.get("names")
        names = [
            str(item) if item is not None else ""
            for item in (
                raw_names[:GATE_SLOTS]
                if isinstance(raw_names, list)
                else []
            )
        ]
        names += [""] * (GATE_SLOTS - len(names))
        return values, names

    @classmethod
    def _parse_port_names(cls, port_names: str) -> list[str]:
        """解析前端维护的最终端口名称。"""
        try:
            data = json.loads(port_names) if port_names else []
        except (TypeError, ValueError):
            data = []
        if not isinstance(data, list):
            data = []
        names = [
            str(item) if item is not None else ""
            for item in data[:GATE_SLOTS]
        ]
        names += [""] * (GATE_SLOTS - len(names))
        return names

    @classmethod
    def check_lazy_status(cls, **kwargs: Any) -> list[str]:
        """仅请求已连接、已启用且尚未求值的通道输入。"""
        required: list[str] = []
        for index in range(1, GATE_SLOTS + 1):
            input_name = f"input_{index}"
            if not bool(kwargs.get(f"enable_{index}", True)):
                continue
            if input_name in kwargs and kwargs[input_name] is None:
                required.append(input_name)
        return required

    @classmethod
    def execute(
        cls,
        xpipe_in: Any = None,
        port_names: str = "[]",
        **kwargs: Any,
    ) -> io.NodeOutput:
        """合并数据束与独立输入，然后应用各通道开关。"""
        bundled_values, bundled_names = cls._extract_bundle(xpipe_in)
        local_names = cls._parse_port_names(port_names)
        names = [
            local_names[index] or bundled_names[index]
            for index in range(GATE_SLOTS)
        ]
        outputs = [
            (
                kwargs.get(f"input_{index}")
                if kwargs.get(f"input_{index}") is not None
                else bundled_values[index - 1]
            )
            if kwargs.get(f"enable_{index}", True)
            else None
            for index in range(1, GATE_SLOTS + 1)
        ]
        xpipe_out = {
            "__xpipe_v2_bundle__": True,
            "__xpipe_v2_version__": 2,
            "values": outputs,
            "names": names,
        }
        return io.NodeOutput(xpipe_out, *outputs)
