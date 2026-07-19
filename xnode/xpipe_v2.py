"""独立的第二版管道束节点。"""

import json
from typing import Any

from comfy_api.latest import io

try:
    from ..xz3r0_utils import get_logger
except ImportError:  # pragma: no cover - 包外脚本运行兜底
    from xz3r0_utils import get_logger

LOGGER = get_logger(__name__)

XPipeV2Bundle = io.Custom("xpipe_v2")
PIPE_SLOTS = 50


class XPipeV2(io.ComfyNode):
    """通过独立 V2 数据束传递最多 50 路任意类型数据。"""

    @classmethod
    def define_schema(cls) -> io.Schema:
        """定义独立于原版 XPipe 的输入、输出和类型模板。"""
        templates = [
            io.MatchType.Template(
                f"pipe_v2_slot_{index}",
                allowed_types=[io.AnyType],
            )
            for index in range(1, PIPE_SLOTS + 1)
        ]

        inputs: list[Any] = [
            XPipeV2Bundle.Input(
                "xpipe_in",
                optional=True,
                tooltip=(
                    "Connect an upstream XPipe_v2 bundle to receive all "
                    "slot values and names. Direct slot inputs override "
                    "the corresponding bundled values."
                ),
            ),
        ]
        for index, template in enumerate(templates, start=1):
            inputs.append(
                io.MatchType.Input(
                    f"value_{index}",
                    template=template,
                    optional=True,
                    tooltip=(
                        f"Slot {index} input (optional, accepts any data). "
                        "Overrides the same slot from the V2 bundle."
                    ),
                ),
            )
        inputs.extend(
            [
                io.String.Input(
                    "port_names",
                    default="[]",
                    socketless=True,
                    extra_dict={"hidden": True},
                    tooltip=(
                        "Serialized JSON slot names managed by the "
                        "XPipe_v2 frontend."
                    ),
                ),
                io.Boolean.Input(
                    "type_warning",
                    default=True,
                    label_on="Enabled",
                    label_off="Disabled",
                    tooltip=(
                        "Show a warning when a V2 slot output is connected "
                        "to an incompatible input type."
                    ),
                ),
            ],
        )

        outputs: list[Any] = [
            XPipeV2Bundle.Output(
                "xpipe_out",
                display_name="xpipe_out",
                tooltip=(
                    "Send all current values and names as an independent "
                    "XPipe_v2 bundle."
                ),
            ),
        ]
        for index, template in enumerate(templates, start=1):
            outputs.append(
                io.MatchType.Output(
                    template=template,
                    display_name=f"value_{index}",
                    tooltip=f"V2 slot {index} output",
                ),
            )

        return io.Schema(
            node_id="XPipe_v2",
            display_name="XPipe_v2",
            description=(
                "Independent second-generation pipe bundle node. Route up "
                "to 50 any-type values through an isolated XPipe_v2 bundle "
                "without affecting the original XPipe node."
            ),
            category="♾️ Xz3r0/Workflow-Processing",
            inputs=inputs,
            outputs=outputs,
        )

    @classmethod
    def _parse_port_names(cls, port_names: str) -> list[str]:
        """解析并规范化为恰好 50 个名称。"""
        try:
            data = json.loads(port_names) if port_names else []
        except (TypeError, ValueError):
            data = []
        if not isinstance(data, list):
            data = []
        names = [
            str(item) if item is not None else ""
            for item in data[:PIPE_SLOTS]
        ]
        names += [""] * (PIPE_SLOTS - len(names))
        return names

    @classmethod
    def _is_xpipe_v2_bundle(cls, data: Any) -> bool:
        """只接受 V2 专属束，不接受原版 XPipe 束。"""
        return bool(
            isinstance(data, dict)
            and data.get("__xpipe_v2_bundle__") is True
            and data.get("__xpipe_v2_version__") == 2
        )

    @classmethod
    def _extract_base_values(cls, pipe_in: Any) -> list[Any]:
        """从合法 V2 束提取 50 个回退值。"""
        values: list[Any] = []
        if cls._is_xpipe_v2_bundle(pipe_in):
            raw = pipe_in.get("values")
            if isinstance(raw, list):
                values = list(raw[:PIPE_SLOTS])
        values += [None] * (PIPE_SLOTS - len(values))
        return values

    @classmethod
    def _extract_base_names(cls, pipe_in: Any) -> list[str]:
        """从合法 V2 束提取 50 个回退名称。"""
        names: list[str] = []
        if cls._is_xpipe_v2_bundle(pipe_in):
            raw = pipe_in.get("names")
            if isinstance(raw, list):
                names = [
                    str(item) if item is not None else ""
                    for item in raw[:PIPE_SLOTS]
                ]
        names += [""] * (PIPE_SLOTS - len(names))
        return names

    @classmethod
    def execute(
        cls,
        xpipe_in: Any = None,
        port_names: str = "[]",
        **kwargs: Any,
    ) -> io.NodeOutput:
        """合并 V2 束与直接输入，并返回独立束和各槽位值。"""
        local_names = cls._parse_port_names(port_names)
        base_names = cls._extract_base_names(xpipe_in)
        names = [
            local_names[index] or base_names[index]
            for index in range(PIPE_SLOTS)
        ]
        base_values = cls._extract_base_values(xpipe_in)
        values = [
            kwargs.get(f"value_{index + 1}")
            if kwargs.get(f"value_{index + 1}") is not None
            else base_values[index]
            for index in range(PIPE_SLOTS)
        ]
        pipe_out = {
            "__xpipe_v2_bundle__": True,
            "__xpipe_v2_version__": 2,
            "values": values,
            "names": names,
        }
        return io.NodeOutput(pipe_out, *values)
