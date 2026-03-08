"""
自动图像缩放节点模块
==================

这个模块包含全自动图像缩放相关的节点，提供智能图像缩放功能。
"""

import math

import comfy.utils
import torch
from comfy_api.latest import io

# 常量定义
PIXELS_PER_MEGAPIXEL = 1_000_000  # 每百万像素的像素数
MAX_MEGAPIXELS = 100.0  # 最大百万像素限制（防止显存溢出）


class XImageResize(io.ComfyNode):
    """
    XImageResize 全自动图像缩放节点

    提供智能图像缩放功能，自动识别图片方向并按长边/短边缩放。
    同时支持对遮罩(mask)进行同步缩放处理。

    功能:
        - 自动识别横屏/竖屏/正方形
        - 按长边或短边缩放（可切换）
        - 按百万像素缩放（精确控制输出像素数）
        - 保持原始宽高比，永不变形
        - 支持分辨率整除调整（适配模型要求）
        - 支持分辨率偏移调整（适配特殊模型要求）
        - 支持批量图像处理（图片序列）
        - 支持遮罩同步缩放（使用与图像相同的插值模式）
        - 带进度条显示
        - 支持多种插值算法（双线性/双三次/最近邻/区域）

    输入:
        images: 输入图像张量 (IMAGE)
        mask: 输入遮罩张量 (MASK, 可选)
            如果提供，将与图像使用相同的参数进行缩放
        scale_mode: 缩放模式 (STRING)
            - "Nearest-exact": 精确最近邻插值（速度最快）
            - "Bilinear": 双线性插值（速度快，质量中等）
            - "Area": 区域插值（适合缩小，质量好）
            - "Bicubic": 双三次插值（速度中等，质量高）
            - "Lanczos": Lanczos 插值（速度较慢，质量最高）
        edge_mode: 缩放基准 (STRING)
            - "Long": 以长边为基准（横屏的宽，竖屏的高）
            - "Short": 以短边为基准（横屏的高，竖屏的宽）
            - "Megapixels": 以百万像素为基准
              （忽略 target_edge）
            - "Scale Multiplier": 以缩放倍率为基准
              （忽略 target_edge，使用 scale_multiplier）
        target_edge: 目标边长 (INT, 范围 64-8192)
            仅在 edge_mode="long/short" 时使用
        megapixels: 百万像素 (FLOAT, 范围 0.1-100)
            仅在 edge_mode="Megapixels" 时使用，作为目标像素数
        scale_multiplier: 缩放倍率 (FLOAT, 范围 0.1-10)
            仅在 edge_mode="Scale" 时使用
        divisible: 整除数 (INT, 范围 1-128)
            使分辨率可被该数整除（设置为 1 时禁用，常用值：8、16、32、64）
        divisible_mode: 整除模式 (STRING)
            - "Disabled": 禁用整除调整
            - "Nearest": 取最接近的倍数
            - "Up": 向上取整
            - "Down": 向下取整
        width_offset: 宽度偏移 (INT, 范围 -128 到 128)
            在最终分辨率上添加的偏移值（正数=增加，负数=减少）
        height_offset: 高度偏移 (INT, 范围 -128 到 128)
            在最终分辨率上添加的偏移值（正数=增加，负数=减少）
        merge_mask: 合并遮罩到 Alpha 通道 (BOOLEAN)
            - False: 输出 RGB 图像 (3 通道)
            - True: 如果提供了 mask，输出 RGBA 图像 (4 通道)
              mask 作为 alpha 通道合并到图像中

    输出:
        Processed_Images: 缩放后的图像张量
            - merge_mask=False 或未提供 mask: (B, H, W, 3) RGB
            - merge_mask=True 且提供了 mask: (B, H, W, 4) RGBA
        Processed_Mask: 缩放后的遮罩张量（如果输入了 mask，否则 None）
        width: 输出分辨率宽度
        height: 输出分辨率高度

    使用示例:
        # 示例 1: 横屏图片按长边缩放
        输入：1920x1080, edge_mode="Long", target_edge=1280
        输出：1280x720

        # 示例 2: 竖屏图片按长边缩放
        输入：1080x1920, edge_mode="Long", target_edge=1280
        输出：720x1280

        # 示例 3: 正方形图片按长边缩放
        输入：1024x1024, edge_mode="Long", target_edge=1280
        输出：1280x1280

        # 示例 4: 按短边缩放
        输入：1920x1080, edge_mode="Short", target_edge=720
        输出：1280x720 (短边 1080→720, 等比缩放)

        # 示例 5: 百万像素模式（精确控制）
        输入：1920x1080 (2.07MP), edge_mode="Megapixels", megapixels=1.0
        输出：1334x750 (1.0MP)

        # 示例 6: 百万像素模式（放大）
        输入：1024x1024 (1.05MP), edge_mode="Megapixels", megapixels=2.0
        输出：1413x1413 (2.0MP)

        # 示例 7: 带整除调整
        输入：1920x1080, target_edge=1280, divisible=16, divisible_mode="Up"
        输出：1280x720 (720 已是 16 的倍数)

        # 示例 8: 带分辨率偏移（+1）
        输入：1920x1080, target_edge=1280, width_offset=1, height_offset=1
        输出：1281x721 (1280x720 + 偏移)

        # 示例 9: 带分辨率偏移（-1）
        输入：1024x1024, target_edge=512, width_offset=-1, height_offset=-1
        输出：511x511 (512x512 - 偏移)

        # 示例 10: 倍率模式（放大 2 倍）
        输入：1024x1024, edge_mode="Scale Multiplier", scale_multiplier=2.0
        输出：2048x2048

        # 示例 11: 倍率模式（缩小 0.5 倍）
        输入：1920x1080, edge_mode="Scale Multiplier", scale_multiplier=0.5
        输出：960x540

    注意事项:
        - 节点自动保持原始宽高比，不会导致图像变形
        - edge_mode="Megapixels" 或 "Scale Multiplier" 时
          target_edge 参数被忽略
        - edge_mode="Scale Multiplier" 时
          使用 scale_multiplier 作为缩放倍率
        - 整除调整在尺寸计算之后应用
        - 分辨率偏移在整除调整之后应用
        - edge_mode="Megapixels" 时必须设置 megapixels > 0
        - edge_mode="Scale Multiplier" 时必须设置 scale_multiplier > 0
        - 偏移值范围：-128 到 128，确保最终分辨率≥1
        - 不同插值模式特点:
            * Nearest-exact: 速度最快，像素级精确，适合像素艺术
            * Bilinear: 速度快，质量中等，通用场景
            * Area: 适合缩小，质量好，保留细节
            * Bicubic: 速度中等，质量高，适合放大
            * Lanczos: 速度较慢，质量最高，专业场景

    批处理限制说明:
        - 批量处理要求所有输入图片具有相同的原始尺寸
        - 如果输入图片尺寸不一致，每张图片会按各自的原始尺寸
          独立计算目标尺寸，可能导致输出图片尺寸不同
        - 输出图片尺寸不同时，torch.stack() 会报错
        - 建议：批处理时确保所有图片尺寸相同，或分批处理不同尺寸的图片
    """

    @classmethod
    def define_schema(cls) -> io.Schema:
        """定义节点的输入类型和约束"""
        return io.Schema(
            node_id="XImageResize",
            display_name="XImageResize",
            description="Automatic image resize "
            "with intelligent edge detection, "
            "megapixels mode, and divisible adjustment support",
            category="♾️ Xz3r0/File-Processing",
            inputs=[
                io.Image.Input(
                    "images",
                    tooltip="Input images",
                ),
                io.Mask.Input(
                    "mask",
                    optional=True,
                    tooltip="Input mask (optional, will be resized "
                    "with same settings as images)",
                ),
                io.Combo.Input(
                    "scale_mode",
                    options=[
                        "Nearest-exact",
                        "Bilinear",
                        "Area",
                        "Bicubic",
                        "Lanczos",
                    ],
                    default="Bilinear",
                    tooltip="Select interpolation algorithm: "
                    "Nearest-exact=fastest, "
                    "Bilinear=fast & medium quality, "
                    "Area=best for downsampling, "
                    "Bicubic=medium speed & high quality, "
                    "Lanczos=slow & highest quality",
                ),
                io.Combo.Input(
                    "edge_mode",
                    options=[
                        "Long",
                        "Short",
                        "Megapixels",
                        "Scale Multiplier",
                    ],
                    default="Long",
                    tooltip="Select scaling mode: Long=long edge, "
                    "Short=short edge, "
                    "Megapixels=target pixels, "
                    "Scale Multiplier=scale by multiplier",
                ),
                io.Int.Input(
                    "target_edge",
                    default=1280,
                    min=64,
                    max=8192,
                    step=64,
                    display_mode=io.NumberDisplay.number,
                    tooltip="Target edge length in pixels "
                    "(ignored in megapixels mode)",
                ),
                io.Float.Input(
                    "megapixels",
                    default=1.0,
                    min=0.1,
                    max=100.0,
                    step=0.1,
                    display_mode=io.NumberDisplay.number,
                    tooltip="Only used in Megapixels mode "
                    "as target value (must be >0)",
                ),
                io.Float.Input(
                    "scale_multiplier",
                    default=1.0,
                    min=0.1,
                    max=10.0,
                    step=0.1,
                    display_mode=io.NumberDisplay.number,
                    tooltip="Scale multiplier "
                    "(only used in Scale Multiplier mode)",
                ),
                io.Combo.Input(
                    "divisible_mode",
                    options=["Disabled", "Nearest", "Up", "Down"],
                    default="Disabled",
                    tooltip="How to adjust resolution to be divisible: "
                    "Disabled=no adjustment, Nearest=round to nearest "
                    "multiple, Up=round up, Down=round down",
                ),
                io.Int.Input(
                    "divisible",
                    default=16,
                    min=1,
                    max=128,
                    step=1,
                    display_mode=io.NumberDisplay.number,
                    tooltip="Make resolution divisible by this number "
                    "(set to 1 to disable, common values: 8, 16, 32, 64)",
                ),
                io.Int.Input(
                    "width_offset",
                    default=0,
                    min=-128,
                    max=128,
                    step=1,
                    display_mode=io.NumberDisplay.number,
                    tooltip="Add offset to output width "
                    "(positive=increase, negative=decrease, default=0)",
                ),
                io.Int.Input(
                    "height_offset",
                    default=0,
                    min=-128,
                    max=128,
                    step=1,
                    display_mode=io.NumberDisplay.number,
                    tooltip="Add offset to output height "
                    "(positive=increase, negative=decrease, default=0)",
                ),
                io.Boolean.Input(
                    "merge_mask",
                    default=False,
                    label_on="True",
                    label_off="False",
                    tooltip="If enabled and mask is provided, "
                    "merge mask into processed image alpha channel "
                    "(output RGBA). If disabled or no mask, "
                    "output RGB only",
                ),
            ],
            outputs=[
                io.Image.Output(
                    "Processed_Images",
                    tooltip="Scaled images",
                ),
                io.Mask.Output(
                    "Processed_Mask",
                    tooltip="Scaled mask (if input mask provided, "
                    "otherwise None)",
                ),
                io.Int.Output(
                    "width",
                    tooltip="Output resolution width",
                ),
                io.Int.Output(
                    "height",
                    tooltip="Output resolution height",
                ),
            ],
        )

    @classmethod
    def validate_inputs(
        cls,
        images: torch.Tensor,
        scale_mode: str,
        edge_mode: str,
        target_edge: int,
        megapixels: float,
        scale_multiplier: float,
        divisible_mode: str,
        divisible: int,
        width_offset: int,
        height_offset: int,
        merge_mask: bool,
        mask: torch.Tensor | None = None,
    ) -> bool | str:
        """
        验证输入参数的有效性

        Args:
            images: 输入图像张量
            scale_mode: 插值模式
            edge_mode: 缩放模式
            target_edge: 目标边长
            megapixels: 百万像素数
            scale_multiplier: 缩放倍率
            divisible_mode: 整除模式
            divisible: 整除数
            width_offset: 宽度偏移
            height_offset: 高度偏移

        Returns:
            True if valid, or error message string if invalid
        """
        if edge_mode == "Megapixels" and megapixels <= 0:
            return "Megapixels mode requires megapixels > 0"

        if edge_mode == "Scale Multiplier" and scale_multiplier <= 0:
            return "Scale Multiplier mode requires scale_multiplier > 0"

        return True

    @classmethod
    def execute(
        cls,
        images: torch.Tensor,
        scale_mode: str,
        edge_mode: str,
        target_edge: int,
        megapixels: float,
        scale_multiplier: float,
        divisible_mode: str,
        divisible: int,
        width_offset: int,
        height_offset: int,
        merge_mask: bool = False,
        mask: torch.Tensor | None = None,
    ) -> io.NodeOutput:
        """
        处理图像缩放

        处理流程:
            1. 验证输入数据
            2. 遍历批次中的每张图像
            3. 检测图像方向（横屏/竖屏/正方形）
            4. 根据 edge_mode 选择缩放策略:
               - "Long": 以长边为基准计算缩放比例
               - "Short": 以短边为基准计算缩放比例
               - "Megapixels": 以百万像素为目标直接计算
               - "Scale Multiplier": 以缩放倍率直接计算
            5. 应用整除调整
            6. 应用分辨率偏移
            7. 使用 comfy.utils.common_upscale 执行缩放
               - 支持所有插值模式（包括 lanczos）
               - 自动处理张量维度转换
            8. 返回处理后的图像和尺寸信息

        Args:
            images: 输入图像张量，形状为 (B, H, W, C)
                B: 批次大小（图像数量）
                H: 图像高度
                W: 图像宽度
                C: 通道数（通常为 3 或 4）
            scale_mode: 插值模式
                "Nearest-exact": 精确最近邻插值
                "Bilinear": 双线性插值
                "Area": 区域插值
                "Bicubic": 双三次插值
                "Lanczos": Lanczos 插值
            edge_mode: 缩放模式
                "Long": 以长边为基准（横屏的宽，竖屏的高）
                "Short": 以短边为基准（横屏的高，竖屏的宽）
                "Megapixels": 以百万像素为目标（忽略 target_edge）
                "Scale Multiplier": 以缩放倍率为基准（忽略 target_edge）
            target_edge: 目标边长（像素），范围 64-8192
                仅在 edge_mode="long/short" 时使用
            megapixels: 百万像素数，范围 0.1-100
                仅在 edge_mode="Megapixels" 时使用，作为目标像素数（必须>0）
            scale_multiplier: 缩放倍率，范围 0.1-10
                仅在 edge_mode="Scale" 时使用（必须>0）
            divisible: 整除基数，使输出分辨率可被此数整除
                1: 禁用（实际应用中通常使用 8、16、32、64 等）
            divisible_mode: 整除调整模式
                "Disabled": 不进行调整
                "Nearest": 取最接近的倍数
                "Up": 向上取整
                "Down": 向下取整
            width_offset: 宽度偏移值，范围 -128 到 128
                在最终分辨率上添加的偏移值（正数=增加，负数=减少，0=禁用）
            height_offset: 高度偏移值，范围 -128 到 128
                在最终分辨率上添加的偏移值（正数=增加，负数=减少，0=禁用）

        Returns:
            NodeOutput: 包含以下元素的输出
                scaled_images (torch.Tensor):
                    缩放后的图像张量 (B, H_out, W_out, C)
                scaled_mask (torch.Tensor | None):
                    缩放后的遮罩张量 (B, H_out, W_out) 或 None
                output_width (int): 输出图像宽度
                output_height (int): 输出图像高度

        性能说明:
            - 使用 comfy.utils.common_upscale 进行缩放，支持所有插值模式
            - lanczos 模式使用 PIL 实现，质量最高但速度较慢
            - 批量处理时自动显示进度条
            - 百万像素模式直接计算目标尺寸，效率更高
        """
        # 验证输入图像
        if images is None or len(images) == 0:
            raise ValueError("Input images cannot be empty")

        # 验证 mask 尺寸与 images 匹配
        if mask is not None:
            # 统一转换为 (B, H, W) 格式
            mask = mask.reshape((-1, mask.shape[-2], mask.shape[-1]))
            if mask.shape[0] != images.shape[0]:
                raise ValueError(
                    f"Mask batch size {mask.shape[0]} does not match "
                    f"images batch size {images.shape[0]}"
                )

        # 创建进度条
        progress_bar = comfy.utils.ProgressBar(len(images))

        output_images = []
        output_masks = [] if mask is not None else None
        output_width = 0
        output_height = 0

        for i, image in enumerate(images):
            # 处理维度：确保是 (H, W, C)
            if image.dim() == 4:
                # 4D 张量 (1, H, W, C)，提取第一个
                if image.shape[0] != 1:
                    raise ValueError(
                        f"Expected batch size 1 for 4D tensor, "
                        f"got {image.shape[0]}"
                    )
                image = image[0]
            elif image.dim() != 3:
                # 非 3D 或 4D 张量，报错
                raise ValueError(
                    f"Expected 3D (H,W,C) or 4D (1,H,W,C) tensor, "
                    f"got {image.dim()}D tensor"
                )

            # 获取原始尺寸 (H, W, C)
            height, width, channels = image.shape

            # 验证通道数（通常为 3=RGB 或 4=RGBA）
            if channels not in (3, 4):
                raise ValueError(
                    f"Expected image channels to be 3 (RGB) or 4 (RGBA), "
                    f"got {channels} channels"
                )

            # 确定长边和短边
            long_edge = max(width, height)
            short_edge = min(width, height)

            # 根据模式计算缩放比例
            if edge_mode == "Megapixels":
                # 百万像素模式：直接按目标像素数缩放
                # 限制最大百万像素值为 100（防止显存溢出）
                target_mp = min(megapixels, MAX_MEGAPIXELS)
                if target_mp < megapixels:
                    print(
                        f"Warning: megapixels value {megapixels} exceeds "
                        f"maximum limit of {MAX_MEGAPIXELS}, "
                        f"clamped to {target_mp}"
                    )

                target_pixels = int(target_mp * PIXELS_PER_MEGAPIXEL)
                current_pixels = width * height

                # 计算缩放倍率
                scale = math.sqrt(target_pixels / current_pixels)

                # 计算新尺寸（使用四舍五入）
                new_width = round(width * scale)
                new_height = round(height * scale)
            elif edge_mode == "Scale Multiplier":
                # 倍率模式：按缩放倍率缩放
                # 计算新尺寸（使用四舍五入）
                new_width = round(width * scale_multiplier)
                new_height = round(height * scale_multiplier)
            else:
                # 边长模式：按长边或短边缩放
                if edge_mode == "Long":
                    base_edge = long_edge
                else:  # Short
                    base_edge = short_edge

                # 计算缩放比例
                scale = target_edge / base_edge

                # 计算新尺寸（使用四舍五入）
                new_width = round(width * scale)
                new_height = round(height * scale)

            # 应用取整调整
            if divisible_mode != "Disabled" and divisible > 1:
                new_width = cls._make_divisible(
                    new_width, divisible, divisible_mode
                )
                new_height = cls._make_divisible(
                    new_height, divisible, divisible_mode
                )

            # 应用分辨率偏移
            new_width = new_width + width_offset
            new_height = new_height + height_offset

            # 确保最小尺寸
            new_width = max(new_width, 1)
            new_height = max(new_height, 1)

            # 执行缩放
            # 使用官方的 common_upscale 函数处理不同插值模式
            # 添加批次维度并转换格式：(H, W, C) -> (1, H, W, C) -> (1, C, H, W)
            image_batch = image.unsqueeze(0).movedim(-1, 1)
            # 确保张量是连续的（某些操作可能需要）
            if not image_batch.is_contiguous():
                image_batch = image_batch.contiguous()
            # 使用 common_upscale 进行缩放（支持所有插值模式）
            # 注意：需要将首字母大写的模式名转换为小写
            scale_mode_lower = scale_mode.lower()
            scaled_batch = comfy.utils.common_upscale(
                image_batch,
                new_width,
                new_height,
                upscale_method=scale_mode_lower,
                crop="disabled",
            )
            # 移除批次维度并恢复格式：(1, C, H, W) -> (1, H, W, C) -> (H, W, C)
            scaled_image = scaled_batch.movedim(1, -1).squeeze(0)

            output_images.append(scaled_image)
            output_width = new_width
            output_height = new_height

            # 处理 mask 缩放（使用与图像相同的参数）
            if mask is not None:
                mask_item = mask[i]
                # mask 已经是 (H, W) 格式
                # 添加通道维度：(H, W) -> (H, W, 1)
                mask_with_channel = mask_item.unsqueeze(-1)
                # 添加批次维度并转换格式：
                # (H, W, 1) -> (1, H, W, 1) -> (1, 1, H, W)
                mask_batch = mask_with_channel.unsqueeze(0).movedim(-1, 1)
                if not mask_batch.is_contiguous():
                    mask_batch = mask_batch.contiguous()
                # 使用相同的插值模式进行缩放
                scaled_mask_batch = comfy.utils.common_upscale(
                    mask_batch,
                    new_width,
                    new_height,
                    upscale_method=scale_mode_lower,
                    crop="disabled",
                )
                # 恢复格式：(1, 1, H, W) -> (1, H, W, 1) -> (H, W)
                scaled_mask = (
                    scaled_mask_batch.movedim(1, -1).squeeze(0).squeeze(-1)
                )
                # 限制 mask 值在 [0, 1] 范围内
                scaled_mask = torch.clamp(scaled_mask, 0.0, 1.0)
                output_masks.append(scaled_mask)

            # 更新进度
            progress_bar.update_absolute(i + 1)

        # 堆叠回批次 (B, H, W, C)
        output_tensor = torch.stack(output_images)

        # 堆叠 mask 回批次 (B, H, W)
        if output_masks is not None:
            output_mask_tensor = torch.stack(output_masks)
        else:
            output_mask_tensor = None

        # 如果启用 merge_mask 且有 mask，合并到图像 alpha 通道
        if merge_mask and output_mask_tensor is not None:
            # 将 mask 作为 alpha 通道合并:
            # (B, H, W, 3) + (B, H, W, 1) -> (B, H, W, 4)
            output_tensor = torch.cat(
                [output_tensor, output_mask_tensor.unsqueeze(-1)], dim=-1
            )

        return io.NodeOutput(
            output_tensor, output_mask_tensor, output_width, output_height
        )

    @staticmethod
    def _make_divisible(value: int, divisor: int, mode: str = "Up") -> int:
        """
        调整数值使其可被除数整除

        Args:
            value: 原始数值
            divisor: 除数
            mode: 取整方式 ("Nearest", "Up", "Down")

        Returns:
            调整后的数值
        """
        if divisor <= 1:
            return value

        remainder = value % divisor

        if remainder == 0:
            return value

        if mode == "Down":
            # 向下取整
            return value - remainder
        elif mode == "Up":
            # 向上取整
            return value + (divisor - remainder)
        else:  # Nearest
            # 最接近的倍数
            if remainder <= divisor // 2:
                return value - remainder
            else:
                return value + (divisor - remainder)
