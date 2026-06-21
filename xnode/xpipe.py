"""
管道束节点模块
==============

这个模块提供 XPipe 管道束节点：把多路任意类型数据收束成一根线传输，
同时保留 20 路独立输出端口；输入端口由官方 Autogrow 动态增长。

设计要点：
    1. 1 路数据束（xpipe_out -> xpipe_in）在管道束节点之间传输全部数据组
    2. 最多 20 路 Autogrow 输入端口与对应输出端口
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

    通过一根数据束在节点间传输全部数据组，同时提供最多 20 路
    任意类型输入端口和对应输出端口。端口名称由前端面板维护，可自动读取
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
        value_template = io.Autogrow.TemplateNames(
            input=io.AnyType.Input(
                "value",
                optional=True,
                tooltip=(
                    "Slot input (optional, accepts any data). Overrides "
                    "the same slot from the bundle when present."
                ),
            ),
            names=[f"value_{index}" for index in range(1, PIPE_SLOTS + 1)],
            min=0,
        )

        inputs: list[Any] = [
            XPipeBundle.Input(
                "xpipe_in",
                optional=True,
                tooltip=(
                    "Connect an upstream XPipe bundle here to receive the "
                    "whole group of datas and names at once. A connected "
                    "slot input still overrides the same position."
                ),
            ),
            io.Autogrow.Input(
                "values",
                template=value_template,
                optional=True,
                tooltip=(
                    "Autogrowing data inputs. Each connected slot "
                    "overrides the same slot from the bundle."
                ),
            ),
        ]
        inputs.append(
            io.String.Input(
                "port_names",
                default="[]",
                socketless=True,
                extra_dict={"hidden": True},
                tooltip=(
                    "Serialized JSON list of slot names, managed by the "
                    "XPipe naming panel. Do not edit by hand."
                ),
            )
        )

        outputs: list[Any] = [
            XPipeBundle.Output(
                "xpipe_out",
                display_name="xpipe_out",
                tooltip=(
                    "Send the current grouped values and names onward as a "
                    "single XPipe bundle connection."
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
                "through a single bundle wire while keeping autogrowing "
                "inputs and matching visible outputs. Per-slot inputs "
                "override the bundle; "
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
    def _extract_autogrow_values(
        cls,
        values: Any,
        legacy_values: dict[str, Any],
    ) -> list[Any]:
        """
        归一化 Autogrow 或旧式 value_N 输入，始终返回 20 个槽位。

        Autogrow 运行时会把 `values.value_1` 这类前端槽位折叠为
        `values={"value_1": ...}`；旧测试或旧 prompt 可能仍传入
        `value_1=...`，这里一并兼容。
        """
        normalized = [None] * PIPE_SLOTS
        if isinstance(values, dict):
            for index in range(PIPE_SLOTS):
                key = f"value_{index + 1}"
                if key in values:
                    normalized[index] = values[key]
        for index in range(PIPE_SLOTS):
            key = f"value_{index + 1}"
            if key in legacy_values and legacy_values[key] is not None:
                normalized[index] = legacy_values[key]
        return normalized

    @classmethod
    def execute(
        cls,
        xpipe_in: Any = None,
        values: Any = None,
        port_names: str = "[]",
        **legacy_values: Any,
    ) -> io.NodeOutput:
        """
        执行管道束合并与透传。

        工作流程：
            1. 解析名称表与 xpipe_in 数据束回退值
            2. 逐槽合并：单独输入非 None 则覆盖，否则取数据束同槽位值
            3. 打包新的数据束（values + names）
            4. 返回数据束 + 20 路个体输出
        """
        local_names = cls._parse_port_names(port_names)
        base_names = cls._extract_base_names(xpipe_in)
        names = [
            local_names[index] or base_names[index]
            for index in range(PIPE_SLOTS)
        ]
        base = cls._extract_base_values(xpipe_in)
        values_in = cls._extract_autogrow_values(values, legacy_values)
        outs = [
            values_in[index] if values_in[index] is not None else base[index]
            for index in range(PIPE_SLOTS)
        ]
        pipe_out = {"values": outs, "names": names}
        return io.NodeOutput(pipe_out, *outs)
