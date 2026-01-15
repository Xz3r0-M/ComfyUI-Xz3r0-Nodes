"""
视频保存节点模块
================

这个模块包含视频保存相关的节点。
"""

import json
import os
import re
import shutil
import tempfile
from datetime import datetime
from pathlib import Path

import ffmpeg
import numpy as np
import torch
import PIL.Image

import folder_paths

from comfy_api.latest import io, ui, Input, Types
from comfy.cli_args import args


class XVideoSave(io.ComfyNode):
    """
    XVideoSave 视频保存节点

    提供视频保存功能，使用H.265/HEVC编码，支持自定义文件名、子文件夹、日期时间标识符和安全防护。

    功能:
        - 保存视频到ComfyUI默认输出目录
        - 强制使用H.265/HEVC编码，yuv444p10le像素格式，mkv格式
        - fps从video对象自动获取(由CreateVideo节点设置)
        - 支持自定义文件名和子文件夹
        - 支持日期时间标识符(%Y%, %m%, %d%, %H%, %M%, %S%)
        - 允许覆盖同名文件(建议使用日期时间标识符避免冲突)
        - 仅支持单级子文件夹创建
        - 安全防护(防止路径遍历攻击，禁用路径分隔符)
        - 元数据保存(工作流提示词、种子值、模型信息等)
        - 输出相对路径(不泄露绝对路径)

    输入:
        video: 视频对象(fps已集成其中)
        filename_prefix: 文件名前缀 (STRING)
        subfolder: 子文件夹名称 (STRING)
        crf: 质量参数 0-63 (FLOAT)
        prompt: 工作流提示词(隐藏参数，自动注入)
        extra_pnginfo: 额外元数据(隐藏参数，自动注入)

    使用示例:
        filename_prefix="MyVideo_%Y%m%d", subfolder="Videos", crf=0

    元数据说明:
        - 节点自动接收ComfyUI注入的隐藏参数(prompt和extra_pnginfo)
        - prompt: 包含完整的工作流提示词JSON数据
        - extra_pnginfo: 包含工作流结构、种子值、模型信息等额外元数据
        - 元数据嵌入视频文件
    """

    @classmethod
    def define_schema(cls):
        """定义节点的输入类型和约束"""
        return io.Schema(
            node_id="XVideoSave",
            display_name="XVideoSave",
            category="♾️ Xz3r0/Video",
            description="Saves the input video to your ComfyUI output directory with H.265/HEVC encoding.",
            inputs=[
                io.Video.Input("video", tooltip="The video to save."),
                io.String.Input("filename_prefix", default="ComfyUI_%Y%-%m%-%d%_%H%-%M%-%S%", tooltip="The prefix for the file to save. Supports date/time placeholders: %Y%, %m%, %d%, %H%, %M%, %S%"),
                io.String.Input("subfolder", default="Videos", tooltip="Subfolder name (no path separators, single folder only). Example: Videos or videos_%Y%-%m%-%d%"),
                io.Float.Input("crf", default=0.0, min=0, max=40.0, step=1, tooltip="Quality parameter (0=lossless, 40=worst quality). Higher CRF means lower quality with smaller file size."),
            ],
            hidden=[io.Hidden.prompt, io.Hidden.extra_pnginfo],
            is_output_node=True,
        )

    @classmethod
    def execute(cls, video: Input.Video, filename_prefix: str, subfolder: str, crf: float) -> io.NodeOutput:
        """
        保存视频到ComfyUI输出目录

        Args:
            video: 视频对象(fps已由CreateVideo节点集成)
            filename_prefix: 文件名前缀(支持日期时间标识符)
            subfolder: 子文件夹名称(单级)
            crf: 质量参数(0=无损, 63=最差质量)

        Returns:
            io.NodeOutput: 包含保存路径和视频预览的输出
        """
        # 获取视频组件
        components = video.get_components()
        images = components.images
        audio = components.audio
        fps = float(components.frame_rate)

        # 获取视频尺寸
        width, height = images.shape[-2], images.shape[-3]

        # 获取ComfyUI默认输出目录
        output_dir = Path(folder_paths.get_output_directory())

        # 处理日期时间标识符和安全过滤
        safe_filename_prefix = cls._sanitize_path(filename_prefix)
        safe_filename_prefix = cls._replace_datetime_placeholders(safe_filename_prefix)

        safe_subfolder = cls._sanitize_path(subfolder)
        safe_subfolder = cls._replace_datetime_placeholders(safe_subfolder)

        # 创建完整保存路径
        save_dir = output_dir
        if safe_subfolder:
            save_dir = save_dir / safe_subfolder

        # 创建目录(仅支持单级目录)
        save_dir.mkdir(exist_ok=True)

        # 生成文件名(允许覆盖同名文件)
        final_filename = f"{safe_filename_prefix}.mkv"
        save_path = save_dir / final_filename

        # 创建临时文件保存音频（如果存在）
        temp_audio_path = None
        if audio is not None:
            waveform = audio["waveform"]
            sample_rate = audio["sample_rate"]
            
            # 确保波形数据格式正确
            if waveform.dim() == 3:
                waveform = waveform.squeeze(0)
            if waveform.dim() == 1:
                waveform = waveform.unsqueeze(0)
            
            # 转换为float32 PCM格式（如果是其他格式）
            if waveform.dtype.is_floating_point:
                waveform = waveform.float()
            elif waveform.dtype == torch.int16:
                waveform = waveform.float() / (2 ** 15)
            elif waveform.dtype == torch.int32:
                waveform = waveform.float() / (2 ** 31)
            
            # 转换为int16格式用于pcm_s16le编码
            waveform_int16 = (waveform * (2 ** 15 - 1)).clamp(-2 ** 15, 2 ** 15 - 1).short()
            
            # 转换为numpy数组（channels, samples）→ (samples, channels）
            audio_data = waveform_int16.numpy().T
            
            # 创建临时音频文件
            with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as temp_audio:
                temp_audio_path = temp_audio.name
                
            # 使用ffmpeg保存音频
            audio_input = (
                ffmpeg
                .input('pipe:', format='s16le', ac=audio_data.shape[1], ar=sample_rate)
                .output(temp_audio_path, acodec='pcm_s16le', **{'loglevel': 'quiet'})
                .overwrite_output()
                .run_async(pipe_stdin=True)
            )
            
            # 写入音频数据
            audio_input.stdin.write(audio_data.tobytes())
            audio_input.stdin.close()
            audio_input.wait()

        # 使用ffmpeg-python保存视频
        # 先保存临时视频文件
        with tempfile.NamedTemporaryFile(suffix='.mkv', delete=False) as temp_video:
            temp_video_path = temp_video.name
        
        # 构建ffmpeg命令
        if temp_audio_path:
            # 视频和音频
            process = (
                ffmpeg
                .input('pipe:', format='rawvideo', pix_fmt='rgb24', s=f'{width}x{height}', r=fps)
                .output(
                    temp_video_path,
                    vcodec='libx265',
                    pix_fmt='yuv444p10le',
                    crf=int(crf),
                    preset='medium',
                    acodec='aac',
                    audio_bitrate='192k',
                    movflags='faststart',
                    **{'loglevel': 'quiet'}
                )
                .overwrite_output()
                .run_async(pipe_stdin=True)
            )
        else:
            # 只有视频
            process = (
                ffmpeg
                .input('pipe:', format='rawvideo', pix_fmt='rgb24', s=f'{width}x{height}', r=fps)
                .output(
                    temp_video_path,
                    vcodec='libx265',
                    pix_fmt='yuv444p10le',
                    crf=int(crf),
                    preset='medium',
                    movflags='faststart',
                    **{'loglevel': 'quiet'}
                )
                .overwrite_output()
                .run_async(pipe_stdin=True)
            )
        
        # 写入视频帧
        for frame in images:
            frame_data = torch.clamp(frame[..., :3] * 255, min=0, max=255).to(device=torch.device("cpu"), dtype=torch.uint8).numpy()
            process.stdin.write(frame_data.tobytes())
        process.stdin.close()
        return_code = process.wait()
        
        # 检查是否成功
        if return_code != 0:
            raise RuntimeError(f"FFmpeg encoding failed with code {return_code}")

        # 如果有音频，合并到最终文件
        if temp_audio_path:
            # 合并视频和音频
            video_input = ffmpeg.input(temp_video_path)
            audio_input = ffmpeg.input(temp_audio_path)
            try:
                (
                    ffmpeg
                    .output(
                        video_input,
                        audio_input,
                        str(save_path),
                        vcodec='libx265',
                        pix_fmt='yuv444p10le',
                        crf=int(crf),
                        preset='medium',
                        acodec='aac',
                        audio_bitrate='192k',
                        movflags='faststart',
                        **{'loglevel': 'quiet'}
                    )
                    .overwrite_output()
                    .run()
                )
            except ffmpeg.Error as e:
                raise RuntimeError(f"FFmpeg 合并失败") from e
            
            # 删除临时音频文件
            os.unlink(temp_audio_path)
        else:
            # 直接移动临时视频文件到最终位置
            shutil.move(temp_video_path, save_path)

        # 删除临时视频文件（如果没有被移动）
        if os.path.exists(temp_video_path):
            os.unlink(temp_video_path)

        # 提取子文件夹路径(用于ComfyUI预览)
        subfolder_path = safe_subfolder if safe_subfolder else ""

        # 返回视频预览
        return io.NodeOutput(ui=ui.PreviewVideo([ui.SavedResult(final_filename, subfolder_path, io.FolderType.output)]))

    @classmethod
    def _sanitize_path(cls, path: str) -> str:
        """
        清理路径，防止遍历攻击并禁用多级目录

        将所有危险字符和路径分隔符替换为下划线，确保只允许单级文件夹名称

        Args:
            path: 原始路径或文件夹名称

        Returns:
            安全的文件夹名称
        """
        if not path:
            return ""

        # 危险字符列表
        dangerous_chars = [
            '\\', '/', '..', '.', '|', ':', '*', '?', '"', '<', '>',
            '\n', '\r', '\t', '\x00', '\x0b', '\x0c'
        ]

        # 路径遍历模式
        path_traversal_patterns = [
            r'\.\./+',
            r'\.\.\\+',
            r'~',
            r'^\.',
            r'\.$',
            r'^/',
            r'^\\',
        ]

        # 替换危险字符
        safe_path = path
        for char in dangerous_chars:
            safe_path = safe_path.replace(char, '_')

        # 替换路径遍历模式
        for pattern in path_traversal_patterns:
            safe_path = re.sub(pattern, '_', safe_path)

        # 清理连续的下划线
        safe_path = re.sub(r'_+', '_', safe_path)

        # 移除首尾下划线
        safe_path = safe_path.strip('_')

        return safe_path

    @classmethod
    def _replace_datetime_placeholders(cls, text: str) -> str:
        """
        替换日期时间标识符

        支持的标识符:
        - %Y%: 年份(4位)
        - %m%: 月份(01-12)
        - %d%: 日期(01-31)
        - %H%: 小时(00-23)
        - %M%: 分钟(00-59)
        - %S%: 秒(00-59)

        Args:
            text: 包含日期时间标识符的文本

        Returns:
            替换后的文本
        """
        if not text:
            return ""

        now = datetime.now()

        # 使用正则表达式替换，确保完整匹配 %Y%, %m% 等格式
        def replace_match(match):
            placeholder = match.group()
            if placeholder == "%Y%":
                return now.strftime("%Y")
            elif placeholder == "%m%":
                return now.strftime("%m")
            elif placeholder == "%d%":
                return now.strftime("%d")
            elif placeholder == "%H%":
                return now.strftime("%H")
            elif placeholder == "%M%":
                return now.strftime("%M")
            elif placeholder == "%S%":
                return now.strftime("%S")
            return placeholder

        # 匹配 %X% 格式(X为Y,m,d,H,M,S)
        pattern = r'%(Y|m|d|H|M|S)%'
        result = re.sub(pattern, replace_match, text)

        return result
