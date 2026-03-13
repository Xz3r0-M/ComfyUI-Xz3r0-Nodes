"""
视频保存节点模块 (V3 API)
========================

这个模块包含视频保存相关的节点。
"""

import os
import shutil
import tempfile
import json
from pathlib import Path

import comfy.utils
import ffmpeg
import torch
from comfy_api.latest import Input, InputImpl, Types, io, ui

try:
    from ..xz3r0_utils import (
        ensure_unique_filename,
        replace_datetime_tokens,
        resolve_output_subpath,
        sanitize_path_component,
    )
except ImportError:
    # 兼容直接执行测试脚本时从仓库根目录导入 xnode 的场景。
    from xz3r0_utils import (
        ensure_unique_filename,
        replace_datetime_tokens,
        resolve_output_subpath,
        sanitize_path_component,
    )

try:
    import folder_paths

    COMFYUI_AVAILABLE = True
except ImportError:
    COMFYUI_AVAILABLE = False


class XVideoSave(io.ComfyNode):
    """
    XVideoSave 视频保存节点 (V3)

    提供视频保存功能，使用H.265/HEVC编码，支持自定义文件名、
    子文件夹、日期时间标识符和安全防护。

    功能:
        - 保存视频到ComfyUI默认输出目录
        - 强制使用H.265/HEVC编码，yuv444p10le像素格式，mkv格式
        - fps从video对象自动获取(由CreateVideo节点设置)
        - 音频流直接拷贝，保留原始质量（支持PCM/FLAC/AAC等）
        - 支持自定义文件名和子文件夹
        - 支持日期时间标识符(%Y%, %m%, %d%, %H%, %M%, %S%)
        - 自动添加序列号防止覆盖(从00001开始)
        - 仅支持单级子文件夹创建
        - 安全防护(防止路径遍历攻击，禁用路径分隔符)
        - 输出相对路径(不泄露绝对路径)
        - 编码预设选择(ultrafast到veryslow，平衡编码速度和压缩效率)

    输入:
        video: 视频对象(fps已集成其中)
        filename_prefix: 文件名前缀 (STRING)
        subfolder: 子文件夹名称 (STRING)
        crf: 质量参数 0-40 (INT)
        preset: 编码预设 (STRING, 可选: ultrafast,
            superfast, veryfast, faster, fast, medium, slow,
            slower, veryslow)

    使用示例:
        filename_prefix="MyVideo_%Y%m%d",
        subfolder="Videos", crf=0, preset="medium"

    """
    OUTPUT_DIRECTORY_ERROR = "Unable to create output directory"
    WRITE_VIDEO_ERROR = "Unable to write video file"
    RELATIVE_PATH_ERROR = "Unable to build relative save path"
    INVALID_CRF_ERROR = "crf must be an integer between 0 and 40"

    @classmethod
    def define_schema(cls):
        """定义节点的输入类型和约束"""
        return io.Schema(
            node_id="XVideoSave",
            display_name="XVideoSave",
            category="♾️ Xz3r0/File-Processing",
            description=(
                "Saves the input video to your ComfyUI output directory "
                "with H.265/HEVC encoding. Audio streams are copied "
                "without re-encoding to preserve original quality."
            ),
            is_output_node=True,
            inputs=[
                io.Video.Input("video", tooltip="The video to save."),
                io.String.Input(
                    "filename_prefix",
                    default="ComfyUI_%Y%-%m%-%d%_%H%-%M%-%S%",
                    tooltip=(
                        "Filename prefix, supports datetime "
                        "placeholders: %Y%, %m%, %d%, %H%, "
                        "%M%, %S%"
                    ),
                ),
                io.String.Input(
                    "subfolder",
                    default="Videos",
                    tooltip=(
                        "Subfolder name (no path separators allowed), "
                        "supports datetime placeholders: %Y%, %m%, %d%, "
                        "%H%, %M%, %S%"
                    ),
                ),
                io.Int.Input(
                    "crf",
                    default=0,
                    min=0,
                    max=40,
                    step=1,
                    tooltip=(
                        "Integer quality parameter (0=lossless, 40=worst "
                        "quality). Higher CRF means lower quality "
                        "with smaller file size."
                    ),
                ),
                io.Combo.Input(
                    "preset",
                    options=[
                        "ultrafast",
                        "superfast",
                        "veryfast",
                        "faster",
                        "fast",
                        "medium",
                        "slow",
                        "slower",
                        "veryslow",
                    ],
                    default="medium",
                    tooltip=(
                        "Encoding speed/compression tradeoff. Faster "
                        "presets encode quickly but with larger files. "
                        "Slower presets provide better compression but "
                        "take longer."
                    ),
                ),
                io.Combo.Input(
                    "container",
                    options=["MKV", "MP4"],
                    default="MP4",
                    tooltip=(
                        "Output container format. MKV prioritizes "
                        "lossless compatibility. MP4 prioritizes "
                        "ComfyUI web metadata compatibility."
                    ),
                ),
            ],
            hidden=[
                io.Hidden.prompt,
                io.Hidden.extra_pnginfo,
            ],
        )

    @classmethod
    def execute(
        cls,
        video: Input.Video,
        filename_prefix: str,
        subfolder: str,
        crf: int,
        preset: str,
        container: str,
    ) -> io.NodeOutput:
        """
        保存视频到ComfyUI输出目录

        Args:
            video: 视频对象(fps已由CreateVideo节点集成)
            filename_prefix: 文件名前缀(支持日期时间标识符)
            subfolder: 子文件夹名称(单级)
            crf: 整数质量参数(0=无损, 40=最差质量)
            preset: 编码预设(ultrafast到veryslow，
                平衡编码速度和压缩效率)

        Returns:
            io.NodeOutput: 包含视频预览的输出
        """
        normalized_crf = cls._normalize_crf(crf)
        prompt = cls.hidden.prompt if hasattr(cls.hidden, "prompt") else None
        extra_pnginfo = (
            cls.hidden.extra_pnginfo
            if hasattr(cls.hidden, "extra_pnginfo")
            else None
        )
        metadata = cls._generate_metadata(prompt, extra_pnginfo)
        metadata_for_official = cls._generate_metadata(
            prompt,
            extra_pnginfo,
            to_json=False,
        )
        normalized_container = container.upper()
        extension = ".mkv" if normalized_container == "MKV" else ".mp4"

        # 获取视频组件
        components = video.get_components()
        images = components.images
        audio = components.audio
        fps = float(components.frame_rate)

        # 获取视频尺寸
        width, height = images.shape[-2], images.shape[-3]

        # 获取 ComfyUI 默认输出目录
        output_dir = cls._get_output_directory()

        # 处理日期时间标识符和安全过滤
        safe_filename_prefix = sanitize_path_component(filename_prefix)
        safe_filename_prefix = replace_datetime_tokens(
            safe_filename_prefix
        )

        safe_subfolder = sanitize_path_component(subfolder)
        safe_subfolder = replace_datetime_tokens(safe_subfolder)

        # 创建完整保存路径
        save_dir = resolve_output_subpath(output_dir, safe_subfolder)

        # 创建目录(仅支持单级目录)
        try:
            save_dir.mkdir(exist_ok=True)
        except OSError as exc:
            raise RuntimeError(cls.OUTPUT_DIRECTORY_ERROR) from exc

        # 生成文件名(检测同名文件并添加序列号)
        final_filename = ensure_unique_filename(
            save_dir,
            safe_filename_prefix,
            extension,
        )
        save_path = resolve_output_subpath(
            output_dir,
            Path(safe_subfolder) / final_filename,
        )

        temp_audio_path = None
        temp_video_path = None
        try:
            if audio is not None:
                temp_audio_path = cls._write_temp_audio(audio)

            temp_video_path = cls._encode_video_frames(
                images=images,
                width=width,
                height=height,
                fps=fps,
                crf=normalized_crf,
                preset=preset,
            )

            if temp_audio_path:
                if normalized_container == "MP4":
                    temp_muxed_path = cls._mux_video_and_audio_to_temp(
                        temp_video_path=temp_video_path,
                        temp_audio_path=temp_audio_path,
                    )
                    try:
                        cls._save_mp4_with_official_api(
                            source_path=temp_muxed_path,
                            save_path=save_path,
                            metadata=metadata_for_official,
                        )
                    finally:
                        if os.path.exists(temp_muxed_path):
                            try:
                                os.unlink(temp_muxed_path)
                            except OSError:
                                pass
                else:
                    cls._mux_video_and_audio(
                        temp_video_path=temp_video_path,
                        temp_audio_path=temp_audio_path,
                        save_path=save_path,
                        metadata=metadata,
                    )
            else:
                if normalized_container == "MP4":
                    cls._save_mp4_with_official_api(
                        source_path=temp_video_path,
                        save_path=save_path,
                        metadata=metadata_for_official,
                    )
                else:
                    if metadata:
                        cls._write_video_with_metadata(
                            temp_video_path=temp_video_path,
                            save_path=save_path,
                            metadata=metadata,
                        )
                    else:
                        try:
                            shutil.move(temp_video_path, save_path)
                        except OSError as exc:
                            raise RuntimeError(
                                cls.WRITE_VIDEO_ERROR
                            ) from exc
        finally:
            for path_str in [temp_audio_path, temp_video_path]:
                if path_str and os.path.exists(path_str):
                    try:
                        os.unlink(path_str)
                    except OSError:
                        pass

        relative_subfolder = ""
        if safe_subfolder:
            relative_subfolder = cls._build_relative_save_path(
                save_dir,
                output_dir,
            )

        # 返回视频预览
        return io.NodeOutput(
            ui=ui.PreviewVideo(
                [
                    ui.SavedResult(
                        final_filename,
                        relative_subfolder,
                        io.FolderType.output,
                    )
                ]
            )
        )

    @classmethod
    def _write_temp_audio(cls, audio: dict) -> str:
        """
        把输入音频写入临时 WAV 文件，供后续复用。
        """
        waveform = audio["waveform"]
        sample_rate = audio["sample_rate"]

        if waveform.dim() == 3:
            waveform = waveform.squeeze(0)
        if waveform.dim() == 1:
            waveform = waveform.unsqueeze(0)

        if waveform.dtype.is_floating_point:
            waveform = waveform.float()
        elif waveform.dtype == torch.int16:
            waveform = waveform.float() / (2**15)
        elif waveform.dtype == torch.int32:
            waveform = waveform.float() / (2**31)

        try:
            waveform_int16 = (
                (waveform * (2**15 - 1))
                .clamp(-(2**15), 2**15 - 1)
                .to(device=torch.device("cpu"), dtype=torch.int16)
                .contiguous()
            )
            audio_data = waveform_int16.numpy().T
        except (RuntimeError, TypeError, ValueError):
            raise RuntimeError(cls.WRITE_VIDEO_ERROR) from None

        with tempfile.NamedTemporaryFile(
            suffix=".wav", delete=False
        ) as temp_audio:
            temp_audio_path = temp_audio.name

        try:
            audio_input = (
                ffmpeg.input(
                    "pipe:",
                    format="s16le",
                    ac=audio_data.shape[1],
                    ar=sample_rate,
                )
                .output(
                    temp_audio_path,
                    acodec="pcm_s16le",
                    **{"loglevel": "quiet"},
                )
                .overwrite_output()
                .run_async(pipe_stdin=True)
            )
            audio_input.stdin.write(audio_data.tobytes())
            audio_input.stdin.close()
            if audio_input.wait() != 0:
                raise RuntimeError(cls.WRITE_VIDEO_ERROR)
            return temp_audio_path
        except (ffmpeg.Error, OSError, RuntimeError):
            if os.path.exists(temp_audio_path):
                try:
                    os.unlink(temp_audio_path)
                except OSError:
                    pass
            raise RuntimeError(cls.WRITE_VIDEO_ERROR) from None

    @classmethod
    def validate_inputs(
        cls,
        video,
        filename_prefix,
        subfolder,
        crf,
        preset,
        container,
    ):
        """
        在执行前校验 CRF，防止外部节点传入非法值。
        """
        try:
            cls._normalize_crf(crf)
        except ValueError as exc:
            return str(exc)
        if container not in ("MKV", "MP4"):
            return "container must be either MKV or MP4"
        return True

    @classmethod
    def _normalize_crf(cls, crf_value) -> int:
        """
        将输入 CRF 归一化为整数并校验合法范围。
        """
        if isinstance(crf_value, bool):
            raise ValueError(cls.INVALID_CRF_ERROR)

        if isinstance(crf_value, int):
            normalized = crf_value
        elif isinstance(crf_value, float) and crf_value.is_integer():
            normalized = int(crf_value)
        else:
            raise ValueError(cls.INVALID_CRF_ERROR)

        if normalized < 0 or normalized > 40:
            raise ValueError(cls.INVALID_CRF_ERROR)

        return normalized

    @classmethod
    def _encode_video_frames(
        cls,
        images: torch.Tensor,
        width: int,
        height: int,
        fps: float,
        crf: int,
        preset: str,
    ) -> str:
        """
        将视频帧编码到临时 mkv 文件。
        """
        with tempfile.NamedTemporaryFile(
            suffix=".mkv", delete=False
        ) as temp_video:
            temp_video_path = temp_video.name

        try:
            process = (
                ffmpeg.input(
                    "pipe:",
                    format="rawvideo",
                    pix_fmt="rgb24",
                    s=f"{width}x{height}",
                    r=fps,
                )
                .output(
                    temp_video_path,
                    vcodec="libx265",
                    pix_fmt="yuv444p10le",
                    crf=crf,
                    preset=preset,
                    movflags="faststart",
                    **{"loglevel": "quiet"},
                )
                .overwrite_output()
                .run_async(pipe_stdin=True)
            )

            num_frames = len(images)
            progress_bar = comfy.utils.ProgressBar(num_frames)
            for index, frame in enumerate(images):
                frame_data = (
                    torch.clamp(frame[..., :3] * 255, min=0, max=255)
                    .to(device=torch.device("cpu"), dtype=torch.uint8)
                    .numpy()
                )
                process.stdin.write(frame_data.tobytes())
                progress_bar.update_absolute(index + 1)
            process.stdin.close()

            if process.wait() != 0:
                raise RuntimeError(cls.WRITE_VIDEO_ERROR)
            return temp_video_path
        except (ffmpeg.Error, OSError, RuntimeError):
            if os.path.exists(temp_video_path):
                try:
                    os.unlink(temp_video_path)
                except OSError:
                    pass
            raise RuntimeError(cls.WRITE_VIDEO_ERROR) from None

    @classmethod
    def _mux_video_and_audio(
        cls,
        temp_video_path: str,
        temp_audio_path: str,
        save_path: Path,
        metadata: dict | None = None,
    ) -> None:
        """
        合并临时视频和临时音频到最终输出文件。
        """
        video_input = ffmpeg.input(temp_video_path)
        audio_input = ffmpeg.input(temp_audio_path)
        output_kwargs = {
            "vcodec": "copy",
            "acodec": "copy",
            "movflags": "faststart",
            **{"loglevel": "quiet"},
        }
        output_kwargs.update(
            cls._build_ffmpeg_metadata_options(metadata)
        )
        try:
            (
                ffmpeg.output(
                    video_input,
                    audio_input,
                    str(save_path),
                    **output_kwargs,
                )
                .overwrite_output()
                .run()
            )
        except (ffmpeg.Error, OSError):
            raise RuntimeError(cls.WRITE_VIDEO_ERROR) from None

    @classmethod
    def _mux_video_and_audio_to_temp(
        cls,
        temp_video_path: str,
        temp_audio_path: str,
    ) -> str:
        """
        先合并视频和音频到临时文件，供官方 API 二次写入元数据。
        """
        with tempfile.NamedTemporaryFile(
            suffix=".mkv", delete=False
        ) as temp_muxed:
            temp_muxed_path = temp_muxed.name

        video_input = ffmpeg.input(temp_video_path)
        audio_input = ffmpeg.input(temp_audio_path)
        try:
            (
                ffmpeg.output(
                    video_input,
                    audio_input,
                    temp_muxed_path,
                    vcodec="copy",
                    acodec="copy",
                    movflags="faststart",
                    **{"loglevel": "quiet"},
                )
                .overwrite_output()
                .run()
            )
            return temp_muxed_path
        except (ffmpeg.Error, OSError):
            if os.path.exists(temp_muxed_path):
                try:
                    os.unlink(temp_muxed_path)
                except OSError:
                    pass
            raise RuntimeError(cls.WRITE_VIDEO_ERROR) from None

    @classmethod
    def _save_mp4_with_official_api(
        cls,
        source_path: str,
        save_path: Path,
        metadata: dict | None = None,
    ) -> None:
        """
        使用官方 Video API 写 MP4，确保主界面读取 metadata 行为一致。
        """
        try:
            video = InputImpl.VideoFromFile(source_path)
            video.save_to(
                str(save_path),
                format=Types.VideoContainer.MP4,
                codec=Types.VideoCodec.AUTO,
                metadata=metadata,
            )
        except (OSError, RuntimeError, ValueError):
            raise RuntimeError(cls.WRITE_VIDEO_ERROR) from None

    @classmethod
    def _write_video_with_metadata(
        cls,
        temp_video_path: str,
        save_path: Path,
        metadata: dict | None = None,
    ) -> None:
        """
        无音频时通过 FFmpeg 复制并写入元数据。
        """
        video_input = ffmpeg.input(temp_video_path)
        output_kwargs = {
            "vcodec": "copy",
            "movflags": "faststart",
            **{"loglevel": "quiet"},
        }
        output_kwargs.update(
            cls._build_ffmpeg_metadata_options(metadata)
        )
        try:
            (
                ffmpeg.output(
                    video_input,
                    str(save_path),
                    **output_kwargs,
                )
                .overwrite_output()
                .run()
            )
        except (ffmpeg.Error, OSError):
            raise RuntimeError(cls.WRITE_VIDEO_ERROR) from None

    @classmethod
    def _generate_metadata(
        cls,
        prompt,
        extra_pnginfo,
        to_json: bool = True,
    ):
        """
        生成用于视频容器写入的工作流元数据。
        """
        if prompt is None and extra_pnginfo is None:
            return None

        metadata = {}
        if prompt is not None:
            metadata["prompt"] = (
                json.dumps(prompt) if to_json else prompt
            )
        if extra_pnginfo is not None:
            for key, value in extra_pnginfo.items():
                metadata[key] = (
                    json.dumps(value) if to_json else value
                )
        return metadata

    @classmethod
    def _build_ffmpeg_metadata_options(
        cls, metadata: dict | None
    ) -> dict[str, str]:
        """
        将元数据转换为 FFmpeg 可识别的 metadata 参数。
        """
        if not metadata:
            return {}

        options = {}
        for index, (key, value) in enumerate(metadata.items()):
            options[f"metadata:g:{index}"] = f"{key}={value}"
        return options

    @classmethod
    def _get_output_directory(cls) -> Path:
        """
        获取 ComfyUI 默认输出目录。
        """
        if COMFYUI_AVAILABLE:
            return Path(folder_paths.get_output_directory())
        return Path("test_output")

    @classmethod
    def _build_relative_save_path(
        cls,
        save_path: Path,
        output_dir: Path,
    ) -> str:
        """
        基于当前实例输出目录构建相对保存路径。
        """
        try:
            return str(Path(save_path).relative_to(output_dir))
        except ValueError as exc:
            raise RuntimeError(cls.RELATIVE_PATH_ERROR) from exc
