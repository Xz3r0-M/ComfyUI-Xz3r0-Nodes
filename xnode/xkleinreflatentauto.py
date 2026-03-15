"""
Flux 参考 Latent 自动处理节点
===========================

该节点把多张参考图的编码与参考 latent 追加合并到一个节点里，
用于简化 Flux/Klein 多图编辑工作流的搭建。
"""

import torch
from comfy_api.latest import io

try:
    import node_helpers

    HAS_NODE_HELPERS = True
except ImportError:
    HAS_NODE_HELPERS = False


class XKleinRefLatentAuto(io.ComfyNode):
    """
    XKleinRefLatentAuto 动态参考 latent 节点

    工作流程：
        1. 接收正面条件、负面条件、VAE 和最多 4 张可选参考图。
        2. 仅对实际连接的图片执行 VAE 编码。
        3. 将每张图片的 latent 分别追加到正面和负面条件链。
        4. 输出更新后的正面条件与负面条件。
    """

    MISSING_CONDITIONING_ERROR = (
        "Both positive_conditioning and negative_conditioning are required"
    )
    ENCODE_REFERENCE_IMAGE_ERROR = "Unable to encode reference image"
    INVALID_CONDITIONING_ERROR = "Conditioning format is invalid"
    INVALID_LATENT_ERROR = "Reference latent is invalid"
    APPEND_REFERENCE_ERROR = "Unable to append reference latent"
    VAE_IO_TYPE_MISSING_ERROR = (
        "VAE IO type is unavailable in current ComfyUI version"
    )

    @classmethod
    def _get_vae_io_type(cls):
        """
        获取兼容不同 ComfyUI 版本的 VAE IO 类型。
        """
        if hasattr(io, "Vae"):
            return io.Vae
        if hasattr(io, "VAE"):
            return io.VAE
        raise ValueError(cls.VAE_IO_TYPE_MISSING_ERROR)

    @classmethod
    def define_schema(cls) -> io.Schema:
        """定义节点输入输出。"""
        vae_io_type = cls._get_vae_io_type()

        return io.Schema(
            node_id="XKleinRefLatentAuto",
            display_name="XKleinRefLatentAuto",
            description=(
                "Automatically encodes connected reference images and "
                "applies reference latents to both positive and "
                "negative conditioning chains"
            ),
            category="♾️ Xz3r0/Workflow-Processing",
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
                io.Image.Input(
                    "image_1",
                    optional=True,
                    tooltip="Reference image 1 (optional)",
                ),
                io.Image.Input(
                    "image_2",
                    optional=True,
                    tooltip="Reference image 2 (optional)",
                ),
                io.Image.Input(
                    "image_3",
                    optional=True,
                    tooltip="Reference image 3 (optional)",
                ),
                io.Image.Input(
                    "image_4",
                    optional=True,
                    tooltip="Reference image 4 (optional)",
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
        positive_conditioning,
        negative_conditioning,
        vae,
        image_1=None,
        image_2=None,
        image_3=None,
        image_4=None,
    ) -> io.NodeOutput:
        """
        执行参考图编码并追加到正负条件链。
        """
        if positive_conditioning is None or negative_conditioning is None:
            raise ValueError(cls.MISSING_CONDITIONING_ERROR)

        images = [image_1, image_2, image_3, image_4]
        connected_images = [img for img in images if img is not None]

        if not connected_images:
            return io.NodeOutput(
                positive_conditioning,
                negative_conditioning,
            )

        positive_result = positive_conditioning
        negative_result = negative_conditioning

        for image in connected_images:
            latent = cls._encode_to_latent(vae, image)
            positive_result = cls._append_reference_latent(
                positive_result,
                latent,
            )
            negative_result = cls._append_reference_latent(
                negative_result,
                latent,
            )

        return io.NodeOutput(positive_result, negative_result)

    @classmethod
    def _encode_to_latent(cls, vae, image) -> dict:
        """
        使用 VAE 把图片编码为标准 latent 字典。
        """
        try:
            latent_samples = vae.encode(image)
        except Exception as exc:
            raise ValueError(cls.ENCODE_REFERENCE_IMAGE_ERROR) from exc

        if not isinstance(latent_samples, torch.Tensor):
            raise ValueError(cls.INVALID_LATENT_ERROR)

        return {"samples": latent_samples}

    @classmethod
    def _append_reference_latent(cls, conditioning, latent: dict):
        """
        将一个 latent 追加到 conditioning 的 reference_latents 中。
        """
        samples = latent.get("samples")
        if not isinstance(samples, torch.Tensor):
            raise ValueError(cls.INVALID_LATENT_ERROR)

        if HAS_NODE_HELPERS:
            try:
                return node_helpers.conditioning_set_values(
                    conditioning,
                    {"reference_latents": [samples]},
                    append=True,
                )
            except Exception as exc:
                raise ValueError(cls.APPEND_REFERENCE_ERROR) from exc

        if not isinstance(conditioning, list):
            raise ValueError(cls.INVALID_CONDITIONING_ERROR)

        updated_conditioning = []
        for item in conditioning:
            if not isinstance(item, (list, tuple)):
                raise ValueError(cls.INVALID_CONDITIONING_ERROR)
            if len(item) < 2 or not isinstance(item[1], dict):
                raise ValueError(cls.INVALID_CONDITIONING_ERROR)

            metadata = dict(item[1])
            previous = metadata.get("reference_latents", [])
            if not isinstance(previous, list):
                previous = []
            metadata["reference_latents"] = [*previous, samples]

            updated_item = list(item)
            updated_item[1] = metadata
            if isinstance(item, tuple):
                updated_conditioning.append(tuple(updated_item))
            else:
                updated_conditioning.append(updated_item)

        return updated_conditioning
