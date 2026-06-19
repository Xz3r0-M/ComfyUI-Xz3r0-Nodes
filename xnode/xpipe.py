"""
管道束节点模块
==============

这个模块提供 XPipe 管道束节点：把多路任意类型数据收束成一根线传输，
同时保留 20 路独立的 MatchType 输入/输出端口。

设计要点：
    1. 1 路数据束（pipe_in / pipe_out）在管道束节点之间传输全部数据组
    2. 20 路相互对应的 MatchType 输入/输出端口（类型自动跟随）
    3. 合并语义为「单独输入覆盖束」：某槽位连了单独输入就用它，
       否则回退到数据束里的同槽位值
    4. port_names 为序列化的 JSON 名称表，由前端命名面板管理，
       随数据束向下游继续传递
"""

import json
from typing import Any

from comfy_api.latest import io

try:
    from ..xz3r0_utils import get_logger
except ImportError:  # pragma: no cover - 包外脚本运行兜底
    from xz3r0_utils import get_logger

LOGGER = get_logger(__name__)

XPipeBundle = io.Custom("xpipe")
PIPE_SLOTS = 20


class XPipe(io.ComfyNode):
    """
    管道束节点

    通过一根数据束在节点间传输全部数据组，同时提供 20 路独立的
    任意类型输入/输出端口。端口名称由前端自定义面板维护，可自动读取
    上游端口名、手动改名，并随数据束继续向下游传递。
    """

    @classmethod
    def define_schema(cls) -> io.Schema:
        """定义节点输入输出与约束。"""
        templates = [
            io.MatchType.Template(
                f"pipe_slot_{index}",
                allowed_types=[io.AnyType],
            )
            for index in range(1, PIPE_SLOTS + 1)
        ]

        inputs: list[Any] = [
            XPipeBundle.Input(
                "inp",
                optional=True,
                tooltip=(
                    "Data bundle input from an upstream XPipe. Carries all "
                    "slot values and names; per-slot inputs override it."
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
                        "Overrides the same slot from the bundle when present."
                    ),
                )
            )
        inputs.append(
            io.String.Input(
                "port_names",
                default="[]",
                tooltip=(
                    "Serialized JSON list of slot names, managed by the "
                    "XPipe naming panel. Do not edit by hand."
                ),
            )
        )

        outputs: list[Any] = [
            XPipeBundle.Output(
                display_name="out",
                tooltip=(
                    "Data bundle output carrying all slot values and names "
                    "for the next XPipe."
                ),
            ),
        ]
        for index, template in enumerate(templates, start=1):
            outputs.append(
                io.MatchType.Output(
                    template=template,
                    display_name=f"value_{index}",
                    tooltip=f"Slot {index} output (value or bundle fallback)",
                )
            )

        return io.Schema(
            node_id="XPipe",
            display_name="XPipe",
            description=(
                "Pipe bundle node: route up to 20 any-type data groups "
                "through a single bundle wire while keeping 20 matching "
                "input/output ports. Per-slot inputs override the bundle; "
                "port names are customizable and travel with the bundle."
            ),
            category="♾️ Xz3r0/Workflow-Processing",
            inputs=inputs,
            outputs=outputs,
        )

    @classmethod
    def _parse_port_names(cls, port_names: str) -> list[str]:
        """
        解析序列化名称表，始终返回恰好 PIPE_SLOTS 个名称。

        规则：
            非法 JSON、非列表或缺失一律兜底为空名，再截断/补齐到 20。
        """
        try:
            data = json.loads(port_names) if port_names else []
        except (TypeError, ValueError):
            data = []
        if not isinstance(data, list):
            data = []
        names = [
            str(item) if item is not None else "" for item in data[:PIPE_SLOTS]
        ]
        names += [""] * (PIPE_SLOTS - len(names))
        return names

    @classmethod
    def _extract_base_values(cls, pipe_in: Any) -> list[Any]:
        """
        从数据束取出 20 个槽位的回退值，缺失补 None。
        """
        values: list[Any] = []
        if isinstance(pipe_in, dict):
            raw = pipe_in.get("values")
            if isinstance(raw, list):
                values = list(raw[:PIPE_SLOTS])
        values += [None] * (PIPE_SLOTS - len(values))
        return values

    @classmethod
    def _extract_base_names(cls, pipe_in: Any) -> list[str]:
        """
        从数据束取出 20 个槽位的回退名称，缺失补空字符串。
        """
        names: list[str] = []
        if isinstance(pipe_in, dict):
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
        inp: Any = None,
        value_1: Any = None,
        value_2: Any = None,
        value_3: Any = None,
        value_4: Any = None,
        value_5: Any = None,
        value_6: Any = None,
        value_7: Any = None,
        value_8: Any = None,
        value_9: Any = None,
        value_10: Any = None,
        value_11: Any = None,
        value_12: Any = None,
        value_13: Any = None,
        value_14: Any = None,
        value_15: Any = None,
        value_16: Any = None,
        value_17: Any = None,
        value_18: Any = None,
        value_19: Any = None,
        value_20: Any = None,
        port_names: str = "[]",
    ) -> io.NodeOutput:
        """
        执行管道束合并与透传。

        工作流程：
            1. 解析名称表与数据束回退值
            2. 逐槽合并：单独输入非 None 则覆盖，否则取数据束同槽位值
            3. 打包新的数据束（values + names）
            4. 返回数据束 + 20 路个体输出
        """
        local_names = cls._parse_port_names(port_names)
        base_names = cls._extract_base_names(inp)
        names = [
            local_names[index] or base_names[index]
            for index in range(PIPE_SLOTS)
        ]
        base = cls._extract_base_values(inp)
        values_in = [
            value_1,
            value_2,
            value_3,
            value_4,
            value_5,
            value_6,
            value_7,
            value_8,
            value_9,
            value_10,
            value_11,
            value_12,
            value_13,
            value_14,
            value_15,
            value_16,
            value_17,
            value_18,
            value_19,
            value_20,
        ]
        outs = [
            values_in[index] if values_in[index] is not None else base[index]
            for index in range(PIPE_SLOTS)
        ]
        pipe_out = {"values": outs, "names": names}
        return io.NodeOutput(pipe_out, *outs)
