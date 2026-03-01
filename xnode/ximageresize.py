"""
自动图像缩放节点模块
==================

这个模块包含全自动图像缩放相关的节点，提供智能图像缩放功能。
"""

import math

import comfy.utils
import torch

# 常量定义
PIXELS_PER_MEGAPIXEL = 1_000_000  # 每百万像素的像素数
MAX_MEGAPIXELS = 100.0  # 最大百万像素限制（防止显存溢出）


class XImageResize:
    """
    XImageResize 全自动图像缩放节点

    提供智能图像缩放功能，自动识别图片方向并按长边/短边缩放。

    功能:
        - 自动识别横屏/竖屏/正方形
        - 按长边或短边缩放（可切换）
        - 按百万像素缩放（精确控制输出像素数）
        - 保持原始宽高比，永不变形
        - 支持百万像素上限保护（防止显存溢出）
        - 支持分辨率整除调整（适配模型要求）
        - 支持分辨率偏移调整（适配特殊模型要求）
        - 支持批量图像处理（图片序列）
        - 带进度条显示
        - 支持多种插值算法（双线性/双三次/最近邻/区域）

    输入:
        images: 输入图像张量 (IMAGE)
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
            edge_mode="megapixels" 时：作为目标像素数
            edge_mode="long/short" 时：作为上限保护（0=禁用）
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

    输出:
        IMAGE: 缩放后的图像张量
        INT: 输出分辨率宽度
        INT: 输出分辨率高度

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

        # 示例 8: 边长模式 + 百万像素保护
        输入：4000x3000, edge_mode="Long", target_edge=1280, megapixels=0.5
        输出：894x671 (0.6MP → 触发保护，缩小到 0.5MP)

        # 示例 9: 带分辨率偏移（+1）
        输入：1920x1080, target_edge=1280, width_offset=1, height_offset=1
        输出：1281x721 (1280x720 + 偏移)

        # 示例 10: 带分辨率偏移（-1）
        输入：1024x1024, target_edge=512, width_offset=-1, height_offset=-1
        输出：511x511 (512x512 - 偏移)

        # 示例 11: 倍率模式（放大 2 倍）
        输入：1024x1024, edge_mode="Scale Multiplier", scale_multiplier=2.0
        输出：2048x2048

        # 示例 12: 倍率模式（缩小 0.5 倍）
        输入：1920x1080, edge_mode="Scale Multiplier", scale_multiplier=0.5
        输出：960x540

    注意事项:
        - 节点自动保持原始宽高比，不会导致图像变形
        - edge_mode="Megapixels" 或 "Scale Multiplier" 时
          target_edge 参数被忽略
        - edge_mode="Long/Short" 时，megapixels 作为上限保护
        - edge_mode="Scale Multiplier" 时
          使用 scale_multiplier 作为缩放倍率
        - 整除调整在百万像素保护之后应用
        - 分辨率偏移在整除调整之后应用
        - 批量处理时，所有图片使用相同的输出尺寸（基于最后一张）
        - edge_mode="Megapixels" 时必须设置 megapixels > 0
        - edge_mode="Scale Multiplier" 时必须设置 scale_multiplier > 0
        - 偏移值范围：-128 到 128，确保最终分辨率≥1
        - 不同插值模式特点:
            * Nearest-exact: 速度最快，像素级精确，适合像素艺术
            * Bilinear: 速度快，质量中等，通用场景
            * Area: 适合缩小，质量好，保留细节
            * Bicubic: 速度中等，质量高，适合放大
            * Lanczos: 速度较慢，质量最高，专业场景
    """

    @classmethod
    def INPUT_TYPES(cls) -> dict:
        """定义节点的输入类型和约束"""
        return {
            "required": {
                "images": (
                    "IMAGE",
                    {"tooltip": "Input images"},
                ),
                "scale_mode": (
                    [
                        "Nearest-exact",
                        "Bilinear",
                        "Area",
                        "Bicubic",
                        "Lanczos",
                    ],
                    {
                        "default": "Bilinear",
                        "tooltip": "Select interpolation algorithm: "
                        "Nearest-exact=fastest, "
                        "Bilinear=fast & medium quality, "
                        "Area=best for downsampling, "
                        "Bicubic=medium speed & high quality, "
                        "Lanczos=slow & highest quality",
                    },
                ),
                "edge_mode": (
                    ["Long", "Short", "Megapixels", "Scale Multiplier"],
                    {
                        "default": "Long",
                        "tooltip": "Select scaling mode: Long=long edge, "
                        "Short=short edge, "
                        "Megapixels=target pixels, "
                        "Scale Multiplier=scale by multiplier",
                    },
                ),
                "target_edge": (
                    "INT",
                    {
                        "default": 1280,
                        "min": 64,
                        "max": 8192,
                        "step": 64,
                        "display": "number",
                        "tooltip": "Target edge length in pixels "
                        "(ignored in megapixels mode)",
                    },
                ),
                "megapixels": (
                    "FLOAT",
                    {
                        "default": 0,
                        "min": 0,
                        "max": 100.0,
                        "step": 0.1,
                        "display": "number",
                        "tooltip": "Edge mode=upper limit (0=disabled), "
                        "Megapixels mode=target (must be >0)",
                    },
                ),
                "scale_multiplier": (
                    "FLOAT",
                    {
                        "default": 1.0,
                        "min": 0.1,
                        "max": 10.0,
                        "step": 0.1,
                        "display": "number",
                        "tooltip": "Scale multiplier "
                        "(only used in Scale Multiplier mode)",
                    },
                ),
                "divisible_mode": (
                    ["Disabled", "Nearest", "Up", "Down"],
                    {
                        "default": "Disabled",
                        "tooltip": "How to adjust resolution to be divisible: "
                        "Disabled=no adjustment, Nearest=round to nearest "
                        "multiple, Up=round up, Down=round down",
                    },
                ),
                "divisible": (
                    "INT",
                    {
                        "default": 16,
                        "min": 1,
                        "max": 128,
                        "step": 1,
                        "display": "number",
                        "tooltip": "Make resolution divisible by this number "
                        "(set to 1 to disable, common values: 8, 16, 32, 64)",
                    },
                ),
                "width_offset": (
                    "INT",
                    {
                        "default": 0,
                        "min": -128,
                        "max": 128,
                        "step": 1,
                        "display": "number",
                        "tooltip": "Add offset to output width "
                        "(positive=increase, negative=decrease, default=0)",
                    },
                ),
                "height_offset": (
                    "INT",
                    {
                        "default": 0,
                        "min": -128,
                        "max": 128,
                        "step": 1,
                        "display": "number",
                        "tooltip": "Add offset to output height "
                        "(positive=increase, negative=decrease, default=0)",
                    },
                ),
            }
        }

    RETURN_TYPES = ("IMAGE", "INT", "INT")
    RETURN_NAMES = ("images", "width", "height")
    OUTPUT_TOOLTIPS = (
        "Scaled images",
        "Output resolution width",
        "Output resolution height",
    )
    FUNCTION = "process"
    CATEGORY = "♾️ Xz3r0/File-Processing"

    def process(
        self,
        images: torch.Tensor,
        scale_mode: str,
        edge_mode: str,
        target_edge: int,
        megapixels: float,
        scale_multiplier: float,
        divisible: int,
        divisible_mode: str,
        width_offset: int,
        height_offset: int,
    ) -> tuple[torch.Tensor, int, int]:
        """
        处理图像缩放

        处理流程:
            1. 验证输入数据
            2. 遍历批次中的每张图像
            3. 检测图像方向（横屏/竖屏/正方形）
            4. 根据 edge_mode 选择缩放策略:
               - "long": 以长边为基准计算缩放比例
               - "short": 以短边为基准计算缩放比例
               - "Megapixels": 以百万像素为目标直接计算
               - "Scale Multiplier": 以缩放倍率直接计算
            5. 应用百万像素保护（仅边长模式）
            6. 应用整除调整
            7. 应用分辨率偏移
            8. 使用 comfy.utils.common_upscale 执行缩放
               - 支持所有插值模式（包括 lanczos）
               - 自动处理张量维度转换
            9. 返回处理后的图像和尺寸信息

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
                edge_mode="megapixels" 时：作为目标像素数（必须>0）
                edge_mode="long/short" 时：作为上限保护（0=禁用）
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
            tuple: 包含以下元素的元组
                scaled_images (torch.Tensor):
                    缩放后的图像张量 (B, H_out, W_out, C)
                output_width (int): 输出图像宽度
                output_height (int): 输出图像高度

        Raises:
            ValueError:
                - 当输入图像为空时
                - 当 edge_mode="megapixels" 但 megapixels <= 0 时

        性能说明:
            - 使用 comfy.utils.common_upscale 进行缩放，支持所有插值模式
            - lanczos 模式使用 PIL 实现，质量最高但速度较慢
            - 批量处理时自动显示进度条
            - 百万像素模式直接计算目标尺寸，效率更高
            - 边长模式的百万像素保护在缩放后检查，避免不必要的计算
        """
        if images is None or len(images) == 0:
            raise ValueError("Input images cannot be empty")

        # 创建进度条
        progress_bar = comfy.utils.ProgressBar(len(images))

        # 预计算不变的参数（优化循环性能）
        max_pixels_limit = (
            int(megapixels * PIXELS_PER_MEGAPIXEL) if megapixels > 0 else 0
        )

        output_images = []
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
                if megapixels <= 0:
                    raise ValueError(
                        f"Megapixels mode requires megapixels > 0, "
                        f"got {megapixels}"
                    )

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
                if scale_multiplier <= 0:
                    raise ValueError(
                        f"Scale Multiplier mode requires "
                        f"scale_multiplier > 0, got {scale_multiplier}"
                    )

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

                # 应用百万像素上限保护（仅边长模式）
                if max_pixels_limit > 0:
                    current_pixels = new_width * new_height

                    if current_pixels > max_pixels_limit:
                        # 超过上限，进一步缩小
                        adjust_scale = math.sqrt(
                            max_pixels_limit / current_pixels
                        )
                        new_width = round(new_width * adjust_scale)
                        new_height = round(new_height * adjust_scale)

            # 应用取整调整
            if divisible_mode != "Disabled" and divisible > 1:
                new_width = self._make_divisible(
                    new_width, divisible, divisible_mode
                )
                new_height = self._make_divisible(
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

            # 更新进度
            progress_bar.update_absolute(i + 1)

        # 堆叠回批次 (B, H, W, C)
        output_tensor = torch.stack(output_images)

        return (output_tensor, output_width, output_height)

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


NODE_CLASS_MAPPINGS = {
    "XImageResize": XImageResize,
}
NODE_DISPLAY_NAME_MAPPINGS = {
    "XImageResize": "XImageResize",
}
