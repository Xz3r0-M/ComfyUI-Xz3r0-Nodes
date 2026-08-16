"""
FLUX.2-klein 参考 Conditioning（IMAGE list）节点
================================================

接收 IMAGE list，按元素顺序编码参考图并追加到正/负 conditioning。
IMAGE batch 沿 batch 维拆成单帧；最多 50 张参考帧。
"""

from __future__ import annotations

from typing import Any

import torch
from comfy_api.latest import io

try:
    from .xkleinrefconditioning import XKleinRefConditioning
except ImportError:  # pragma: no cover - 包外脚本运行兜底
    from xnode.xkleinrefconditioning import XKleinRefConditioning

MAX_REFS = 50


class XKleinRefListConditioning(io.ComfyNode):
    """将 IMAGE list 编码为 FLUX.2-klein 参考 latent 并追加到双条件链。"""

    INVALID_IMAGE_LIST_ITEM_ERROR = (
        "image_list must be an IMAGE list "
        "(each non-None item is an IMAGE tensor)"
    )
    INVALID_IMAGE_LIST_SHAPE_ERROR = (
        "image_list IMAGE tensors must have shape (H,W,C) or (B,H,W,C)"
    )

    @classmethod
    def define_schema(cls) -> io.Schema:
        """定义节点输入输出。"""
        template = io.MatchType.Template(
            "image_list_element",
            allowed_types=[io.Image],
        )
        vae_io_type = XKleinRefConditioning._get_vae_io_type()
        return io.Schema(
            node_id="XKleinRefListConditioning",
            display_name="XKleinRefListConditioning",
            description=(
                "Encode an IMAGE list into FLUX.2-klein reference "
                "latents and append them to both positive and negative "
                "conditioning. Each list item is processed in order; "
                "IMAGE batches are split along the batch dimension into "
                "single frames. At most 50 reference frames are applied."
            ),
            category="♾️ Xz3r0/Workflow-Processing",
            is_input_list=True,
            inputs=[
                io.Conditioning.Input(
                    "positive_conditioning",
                    tooltip="Positive conditioning input",
                ),
                io.Conditioning.Input(
                    "negative_conditioning",
                    tooltip="Negative conditioning input",
                ),
                vae_io_type.Input(
                    "vae",
                    tooltip="VAE used to encode reference images",
                ),
                io.MatchType.Input(
                    "image_list",
                    template=template,
                    optional=True,
                    tooltip=(
                        "IMAGE list of reference images. Connect XListCreate "
                        "list output (or any IMAGE list wire). Leave "
                        "unconnected for passthrough conditioning."
                    ),
                ),
            ],
            outputs=[
                io.Conditioning.Output(
                    "positive_conditioning",
                    tooltip="Positive conditioning with reference latents",
                ),
                io.Conditioning.Output(
                    "negative_conditioning",
                    tooltip="Negative conditioning with reference latents",
                ),
            ],
        )

    @classmethod
    def execute(
        cls,
        positive_conditioning: Any,
        negative_conditioning: Any,
        vae: Any,
        image_list: Any = None,
        **_kwargs: Any,
    ) -> io.NodeOutput:
        """编码 IMAGE list 参考帧并追加到正负条件链。"""
        # is_input_list=True 会把每个输入包成 list：
        # - vae / conditioning 等标量口变成 [value]
        # - image_list 本身就是元素列表，保持原样
        positive = cls._unwrap_conditioning(positive_conditioning)
        negative = cls._unwrap_conditioning(negative_conditioning)
        vae = cls._unwrap_scalar(vae)

        if positive is None or negative is None:
            raise ValueError(XKleinRefConditioning.MISSING_CONDITIONING_ERROR)

        items = cls._normalize_image_list(image_list)
        cls._validate_image_list_items(items)
        frames = cls._expand_image_list_to_frames(items)
        frames = frames[:MAX_REFS]

        if not frames:
            return io.NodeOutput(positive, negative)

        for frame in frames:
            latent = XKleinRefConditioning._encode_to_latent(vae, frame)
            positive = XKleinRefConditioning._append_reference_latent(
                positive,
                latent,
            )
            negative = XKleinRefConditioning._append_reference_latent(
                negative,
                latent,
            )

        return io.NodeOutput(positive, negative)

    @classmethod
    def _unwrap_scalar(cls, value: Any) -> Any:
        """解包 is_input_list 对标量输入的单元素 list 包装。"""
        if isinstance(value, (list, tuple)):
            return value[0] if value else None
        return value

    @classmethod
    def _looks_like_conditioning(cls, value: Any) -> bool:
        """判断是否为 Comfy conditioning 结构 [[tensor, dict], ...]。"""
        if not isinstance(value, (list, tuple)) or not value:
            return False
        first = value[0]
        return (
            isinstance(first, (list, tuple))
            and len(first) >= 2
            and isinstance(first[1], dict)
        )

    @classmethod
    def _unwrap_conditioning(cls, value: Any) -> Any:
        """兼容裸 conditioning 与 is_input_list 包装后的 [conditioning]。"""
        if value is None:
            return None
        if cls._looks_like_conditioning(value):
            return value
        if isinstance(value, (list, tuple)) and value:
            inner = value[0]
            if inner is None:
                return None
            if cls._looks_like_conditioning(inner) or inner == []:
                return inner
        return value

    @classmethod
    def _normalize_image_list(cls, image_list: Any) -> list[Any]:
        """将 image_list 输入规整为 Python list。"""
        if image_list is None:
            return []
        if isinstance(image_list, list):
            return list(image_list)
        if isinstance(image_list, tuple):
            return list(image_list)
        return [image_list]

    @classmethod
    def _validate_image_list_items(cls, items: list[Any]) -> None:
        """校验 list 中每个非 None 项为 IMAGE 张量。"""
        for item in items:
            if item is None:
                continue
            if not isinstance(item, torch.Tensor):
                raise ValueError(cls.INVALID_IMAGE_LIST_ITEM_ERROR)
            dims = item.dim()
            if dims not in (3, 4):
                raise ValueError(cls.INVALID_IMAGE_LIST_SHAPE_ERROR)
            if dims == 4 and item.shape[0] < 1:
                raise ValueError(cls.INVALID_IMAGE_LIST_SHAPE_ERROR)

    @classmethod
    def _expand_image_list_to_frames(
        cls,
        items: list[Any],
    ) -> list[torch.Tensor]:
        """将已校验 IMAGE 项展开为 B=1 的单帧序列。"""
        frames: list[torch.Tensor] = []
        for item in items:
            if item is None:
                continue
            if item.dim() == 3:
                frames.append(item.unsqueeze(0))
                continue
            batch_size = int(item.shape[0])
            for index in range(batch_size):
                frames.append(item[index : index + 1])
        return frames
