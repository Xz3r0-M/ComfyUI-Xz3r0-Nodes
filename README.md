<div align="center">

# ♾️ ComfyUI-Xz3r0-Nodes ♾️

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![ComfyUI](https://img.shields.io/badge/ComfyUI-compatible-green.svg)](https://github.com/comfyanonymous/ComfyUI)


**如果这个项目对你有帮助，请给个星标⭐支持一下！**

[📜 点击查看更新日志 | Click to view the changelog 📜](Changelog.md)
</div>

---

## 📖 项目简介

ComfyUI-Xz3r0-Nodes 是一个ComfyUI自定义节点项目，当前主要目标为创建增强的基础功能节点

### 🎯 设计特点

- 🌍 多语言界面 - 节点目前支持 🇨🇳 `中文` 🇬🇧 `English` 界面
    - ComfyUI 会根据您的UI页面设置所选择的语言来调用节点的语言文件，节点名称、参数描述和提示信息都会按照语言文件自动翻译
    - 如果节点没有支持您使用的UI界面语言会默认显示节点代码的文字而不是语言文件(* 这可能是ComfyUI的BUG)
    - 如果您想为项目贡献新的语言支持，请参考项目中 `locales/en/nodeDefs.json` 的格式创建新的语言文件，并提交 Pull Request🤝
- 🚫 安全处理 - 节点中可输入的文件名和路径已做防遍历攻击处理，请使用文字，不要使用日期时间标识符以外的特殊符号！

### ✨ 项目节点和工具数量

🎁 自定义节点 （数量总计：`10`）

- 🛠️ 工具节点 - 数学运算、分辨率设置
- 📝 数据类节点 - 字符串组合 (支持多行输入和分隔方式)、日期时间标识符字符串
- 🖼️ 图像处理 - 图像保存 (支持自定义文件名和子文件夹)
- 🎬 视频处理 - 视频保存 (H.265编码，自定义质量和速度预设，音频支持)
- 🎵 音频处理 - 音频保存 (WAV无损格式，LUFS标准化，峰值限制)
- 🔮 Latent处理 - Latent加载和保存 (支持元数据)
- ⌨️ 工作流节点 - 工作流元数据保存


🧩 网页扩展工具 （数量总计：`3`）

- ⌨️ 工作流工具 - 工作流元数据可视化查看工具、XWorkflowSave网页扩展（捕获完整工作流元数据）
- 🔍 视图工具 - XFitView（工作流加载时自动适应视图）

---

## 💖 安装

### 方法 1: ComfyUI-Manager (推荐)

1. 使用 [ComfyUI-Manager](https://github.com/Comfy-Org/ComfyUI-Manager)
2. 搜索 `ComfyUI-Xz3r0-Nodes`
3. 点击安装按钮


### 方法 2: 手动安装

1. 克隆本仓库到ComfyUI的 `custom_nodes` 目录

```bash
cd ComfyUI/custom_nodes
git clone https://github.com/Xz3r0-M/ComfyUI-Xz3r0-Nodes.git
```

2. 安装依赖

```bash
cd ComfyUI-Xz3r0-Nodes
pip install -r requirements.txt
```

3. 重启ComfyUI

---

## 📦 依赖说明（重要必看）

本项目当前需要在您的电脑中安装有以下依赖程序：
- **⚠️ [FFmpeg](https://www.ffmpeg.org/download.html)** - 安装并配置到**系统环境（PATH）**，如果不安装FFmpeg，那么 `XVideoSave` 和 `XAudioSave` 节点将无法正常使用‼️

---

<div align="center">

<img src="preview/preview.png" alt="Node preview" width="800">
<img src="preview\XMetadataWorkflow_preview.png" alt="XMetadataWorkflow preview" width="800">

</div>

## 📚 详细说明（推荐查看）

<details>
<summary>🛠️ 工具节点 👈</summary>

### 🔢 XMath
`♾️ Xz3r0/Workflow-Processing`

基础数学运算节点，支持双输出格式 (整数+浮点数)

**功能**: 加法、减法、乘法、除法、幂运算、取模、最大值、最小值
- 支持输入端口和基础值两种输入方式
- 可独立切换 A 和 B 的输入来源
- 支持 A 和 B 值交换功能
- 自动处理除零和溢出等边界情况

**输入**:
- `input_a` (INT/FLOAT): 输入数值 A (接收上游节点，可选)
- `input_b` (INT/FLOAT): 输入数值 B (接收上游节点，可选)
- `basic_a` (FLOAT): 基础数值 A (默认值)
- `basic_b` (FLOAT): 基础数值 B (默认值)
- `operation`: 运算方式 (下拉选择)
- `use_input_a` (BOOLEAN): 是否使用输入端口数值 A
- `use_input_b` (BOOLEAN): 是否使用输入端口数值 B
- `swap_ab` (BOOLEAN): 是否交换 A 和 B 的值

**优先级逻辑**:
- 如果 `use_input_a` 为 True，使用 `input_a` (如果未连接到其他节点则回退到 `basic_a`
- 如果 `use_input_b` 为 True，使用 `input_b` (如果未连接到其他节点则回退到 `basic_b`

**输出**:
- `int_result` (INT): 整数结果 (截断小数)
- `float_result` (FLOAT): 浮点数结果 (精确值)

---

### 📐 XResolution
`♾️ Xz3r0/Workflow-Processing`

分辨率设置节点，提供标准分辨率预设和自定义功能

**功能**:
- 标准分辨率预设 (16:9, 4:3, 1:1, 16:10, 21:9等)
- 倍率缩放功能
- 宽高互换功能
- 参数验证 (最小1×1)

**输入**:
- `preset` (下拉选择): 预设分辨率
- `width` (INT): 自定义宽度
- `height` (INT): 自定义高度
- `scale` (FLOAT): 缩放倍率
- `swap_dimensions` (BOOLEAN): 是否交换宽高

**输出**:
- `width` (INT): 最终宽度
- `height` (INT): 最终高度

</details>



<details>
<summary>📝 数据类节点 👈</summary>

### 🔗 XStringGroup
`♾️ Xz3r0/Workflow-Processing`

字符串组合节点，支持多行输入和自定义分隔符

**功能**:
- 支持最多5个多行字符串输入
- 每个字符串之间可选择不同的分隔方式 (无、换行、空格、逗号、逗号+空格、句号、句号+空格)
- 输出组合后的完整字符串
- 支持选择单个字符串输出 (1-5)
- 支持每个字符串的原始输出

**输入**:
- `select_string` (下拉选择): 选择要输出的字符串编号 (1-5)
- `string_1` (STRING, 多行): 第一个字符串
- `separation_method_1_2` (下拉选择): 字符串1和2之间的分隔方式
- `string_2` (STRING, 多行): 第二个字符串
- `separation_method_2_3` (下拉选择): 字符串2和3之间的分隔方式
- `string_3` (STRING, 多行): 第三个字符串
- `separation_method_3_4` (下拉选择): 字符串3和4之间的分隔方式
- `string_4` (STRING, 多行): 第四个字符串
- `separation_method_4_5` (下拉选择): 字符串4和5之间的分隔方式
- `string_5` (STRING, 多行): 第五个字符串

**分隔方式选项**:
- `none`: 无分隔
- `newline`: 换行符 (`\n`)
- `space`: 空格 (` `)
- `comma`: 逗号 (`,`)
- `comma_space`: 逗号+空格 (`, `)
- `period`: 句号 (`.`)
- `period_space`: 句号+空格 (`. `)

**输出**:
- `total_string` (STRING): 组合后的完整字符串 (带有分隔方式)
- `selected_string` (STRING): 由选择字符串栏所选择的输出
- `string_1` (STRING): 字符串1的原始输出
- `string_2` (STRING): 字符串2的原始输出
- `string_3` (STRING): 字符串3的原始输出
- `string_4` (STRING): 字符串4的原始输出
- `string_5` (STRING): 字符串5的原始输出

**使用场景**:
- 构建复杂提示词组合
- 生成多行文本描述
- 创建带格式化的文本输出
- 工作流中的文本处理和组合

---

### 📅 XDateTimeString
`♾️ Xz3r0/Workflow-Processing`

日期时间字符串节点，生成包含日期时间标识符的格式化字符串

**功能**:
- 支持自定义格式模板
- 支持多种日期时间占位符 (%Y%, %m%, %d%, %H%, %M%, %S%)
- 支持添加前缀和后缀
- 实时生成当前日期时间字符串
- 用于链接给本身不支持日期标识符的节点作为文件名

**支持的占位符**:
- `%Y%` - 四位年份 (如: 2026)
- `%m%` - 两位月份 (01-12)
- `%d%` - 两位日期 (01-31)
- `%H%` - 两位小时 (00-23)
- `%M%` - 两位分钟 (00-59)
- `%S%` - 两位秒数 (00-59)

**输入**:
- `prefix` (STRING): 前缀字符串，添加到日期时间之前
- `format_template` (STRING): 格式模板 (默认: `%Y%-%m%-%d%_%H%-%M%-%S%`)
- `suffix` (STRING): 后缀字符串，添加到日期时间之后

**输出**:
- `datetime_string` (STRING): 格式化后的日期时间字符串

**使用示例**:
```
prefix="Image_",
format_template="%Y%-%m%-%d%_%H%-%M%-%S%",
suffix="_v1"
输出: "Image_2026-02-21_14-30-52_v1"
```

</details>



<details>
<summary>🖼️ 图像节点 👈</summary>

### 💾 XImageSave
`♾️ Xz3r0/File-Processing`

图像保存节点，支持自定义文件名和子文件夹管理

**功能**:
- 支持自定义文件名和子文件夹
- 日期时间标识符替换 (%Y%, %m%, %d%, %H%, %M%, %S%)
- 路径安全防护 (防止路径遍历攻击)
- 自动添加序列号防止覆盖(从00001开始)
- 批量图像保存支持
- PNG 压缩级别可调节 (0-9)
- 元数据保存 (工作流提示词、种子值、模型信息等)

**输入**:
- `images` (IMAGE): 输入图像张量
- `filename_prefix` (STRING): 文件名前缀
- `subfolder` (STRING): 子文件夹名称
- `compression_level` (INT): PNG 压缩级别 (0-9，0=无压缩，9=最大压缩)

**隐藏输入**:
- `prompt` (PROMPT): 工作流提示词 (自动注入)
- `extra_pnginfo` (EXTRA_PNGINFO): 额外元数据 (自动注入)

**输出**:
- `images` (IMAGE): 原始图像 (透传)
- `save_path` (STRING): 保存的相对路径

</details>



<details>
<summary>🎬 视频节点 👈</summary>

### 🎬 XVideoSave
`♾️ Xz3r0/File-Processing`

视频保存节点，使用FFmpeg将图像序列保存为视频

**功能**:
- 使用FFmpeg将视频对象保存为MKV格式视频
- H.265/HEVC编码，yuv444p10le像素格式
- FPS从视频对象自动获取 (由官方的创建视频CreateVideo节点设置)
- 音频支持 (自动从视频对象获取)
- 自定义CRF (质量参数 0-40，0为无损)
- 编码预设选择 (ultrafast到veryslow，平衡编码速度和压缩效率)
- 支持自定义文件名和子文件夹
- 日期时间标识符替换 (%Y%, %m%, %d%, %H%, %M%, %S%)
- 路径安全防护 (防止路径遍历攻击)
- 自动添加序列号防止覆盖(从00001开始)

**输入**:
- `video` (VIDEO): 视频对象 (包含图像序列、音频和帧率)
- `filename_prefix` (STRING): 文件名前缀 (默认：`ComfyUI_%Y%-%m%-%d%_%H%-%M%-%S%`)
- `subfolder` (STRING): 子文件夹名称 (默认：`Videos`)
- `crf` (FLOAT): 质量参数 (默认：`0.0`，范围0-40，0为无损，40为最差质量)
- `preset` (STRING): 编码预设 (默认：`medium`，可选：ultrafast, superfast, veryfast, faster, fast, medium, slow, slower, veryslow)

**输出**:
- 视频预览 (显示保存的视频)

**FFmpeg参数**:
- vcodec: libx265 (H.265/HEVC编码)
- pix_fmt: yuv444p10le (10位YUV 4:4:4采样)
- crf: 可配置 (0=无损，40=最差质量)
- preset: 可配置 (ultrafast到veryslow)
- 容器格式: MKV

</details>



<details>
<summary>🎵 音频节点 👈</summary>

### 🎵 XAudioSave
`♾️ Xz3r0/File-Processing`

音频保存节点，使用WAV无损格式保存音频，支持压缩和LUFS标准化以及峰值限制

**功能**:
- 保存音频到ComfyUI默认输出目录
- WAV无损格式 (PCM 32-bit float)
- 支持多种采样率 (44.1kHz, 48kHz, 96kHz, 192kHz)
- 可以使用压缩器 (acompressor滤镜，三种预设：快速/平衡/缓慢)
- 支持自定义压缩比 (1.0-20.0)
- LUFS音量标准化 (默认-14.1 LUFS，可设置为-70禁用)
- 可以使用峰值限制 (True Peak)
- 支持自定义文件名和子文件夹
- 日期时间标识符替换 (%Y%, %m%, %d%, %H%, %M%, %S%)
- 路径安全防护 (防止路径遍历攻击)
- 自动添加序列号防止覆盖(从00001开始)

**处理流程**:
1. 使用FFmpeg的压缩器 acompressor 滤镜 (如果启用) :
   - 选择预设模式 (快速/平衡/缓慢)
   - 可选使用自定义压缩比覆盖预设值
   - 对音频进行动态范围压缩
2. 使用 loudnorm 滤镜 双阶段处理进行 LUFS 标准化和限制峰值 (如果启用)
3. 最终测量音频信息验证结果

**压缩预设参数说明**:
- 阈值自适应计算: `threshold = actual_lufs + (actual_lufs - target_lufs) * 0.3 + base_offset`
- **快速**: 适合语音/播客，base_offset=6dB, ratio=3:1, attack=10ms, release=50ms
- **平衡**: 通用/音乐，base_offset=4dB, ratio=2:1, attack=20ms, release=250ms
- **缓慢**: 适合母带/广播，base_offset=2dB, ratio=1.5:1, attack=50ms, release=500ms
- 如果您不了解音频处理，简单来说，压缩器会让符合条件即超过音量阈值 (`threshold`) 的声音降低. 选择快速预设时压缩器遇到符合的声音会反应迅速但工作时间短，适合处理音频中极短出现的声音 (比如:鼓的敲击声和双手的拍打声) 可以让其听起来不再那么尖锐. 相反的，选择缓慢预设时压缩器遇到符合条件的声音反应会较慢但工作时间更长所以更适合处理持续时间更长的声音 (比如悠长的人声) 可以让其听起来更加紧凑. 为了简化节点，对于阈值使用公式根据音频的响度(LUFS)以及压缩预设的偏移量 (`base_offset`) 来自动设置阈值
- 压缩比 (`ratio`) 是压缩器降低声音的幅度 (比例)，压缩比越高声音被降低得越多，预设带有压缩比，可以自定义
**峰值限制说明**:
- 使用 True Peak 方式 (广播标准，8x过采样，精度高) 限制音量峰值来尽可能避免削波失真

**输入**:
- `audio` (AUDIO): 音频对象 (包含波形和采样率)
- `filename_prefix` (STRING): 文件名前缀 (默认：`ComfyUI_%Y%-%m%-%d%_%H%-%M%-%S%`)
- `subfolder` (STRING): 子文件夹名称 (默认：`Audio`)
- `sample_rate` (STRING): 采样率 (默认：`48000`，可选：44100, 48000, 96000, 192000)
- `target_lufs` (FLOAT): 目标LUFS值 (默认：`-14.1`，范围-70.0到0.0，-70禁用)
- `enable_peak_limiter` (BOOLEAN): 是否启用峰值限制 (默认：True)
- `peak_limit` (FLOAT): 峰值限制值 (默认：`-1.1`，范围-6.0到0.0)
- `enable_compression` (BOOLEAN): 是否启用压缩 (默认：False)
- `compression_mode` (STRING): 压缩预设模式 (默认：`Balanced`，可选：Fast, Balanced, Slow)
- `use_custom_ratio` (BOOLEAN): 是否使用自定义压缩比 (默认：False)
- `custom_ratio` (FLOAT): 自定义压缩比 (默认：`2.0`，范围1.0到20.0)

**输出**:
- `processed_audio` (AUDIO): 处理后的音频 (重采样、压缩、LUFS标准化、峰值限制)
- `save_path` (STRING): 保存的相对路径
</details>



<details>
<summary>🔮 Latent节点 👈</summary>

### 📥 XLatentLoad
`♾️ Xz3r0/File-Processing`

Latent加载节点，支持从输入端口或文件加载Latent

**功能**:
- 支持从上游节点输入Latent (优先级最高)
- 支持从下拉菜单选择Latent文件
- 自动扫描ComfyUI默认输出目录及其子文件夹中的.latent文件
- 文件存在性检查和错误提示
- 支持Latent格式版本自动检测
- 输出标准Latent格式字典

**输入**:
- `latent_input` (LATENT, 可选): 从上游节点接收的Latent
- `latent_file` (STRING, 下拉选择): 从下拉菜单选择Latent文件

**输出**:
- `latent` (LATENT): Latent字典

**优先级说明**:
1. 如果输入端口有Latent，直接返回输入的Latent
2. 如果输入端口为None，则从下拉菜单选择的文件加载Latent
3. 如果输入端口为None且文件不存在，弹出错误提示

---

### 📤 XLatentSave
`♾️ Xz3r0/File-Processing`

Latent保存节点，支持自定义文件名和元数据保存

**功能**:
- 保存Latent到ComfyUI默认输出目录
- 输出Latent端口可以传递到其他节点
- 支持自定义文件名和子文件夹
- 支持日期时间标识符 (%Y%, %m%, %d%, %H%, %M%, %S%)
- 自动检测同名文件并添加序列号 (从00001开始)
- 仅支持单级子文件夹创建
- 安全防护 (防止路径遍历攻击)
- 支持元数据保存 (工作流提示词、种子值、模型信息等)

**输入**:
- `latent` (LATENT): 输入Latent张量
- `filename_prefix` (STRING): 文件名前缀
- `subfolder` (STRING): 子文件夹名称

**隐藏输入**:
- `prompt` (PROMPT): 工作流提示词 (自动注入)
- `extra_pnginfo` (EXTRA_PNGINFO): 额外元数据 (自动注入)

**输出**:
- `latent` (LATENT): 原始Latent (透传)
- `save_path` (STRING): 保存的相对路径

</details>



<details>
<summary>⌨️ 工作流节点和工具 👈</summary>

### 📄 XWorkflowSave
`♾️ Xz3r0/File-Processing`

工作流保存节点，将ComfyUI工作流保存为JSON文件（适配 `XMetadataWorkflow`），支持4种保存模式、自定义文件名和子文件夹

**功能**:
- 保存工作流到ComfyUI默认输出目录
- 支持4种JSON保存模式: `Auto`, `Standard`, `FullWorkflow`, `Prompt+FullWorkflow`
- 支持自定义文件名和子文件夹
- 日期时间标识符替换 (%Y%, %m%, %d%, %H%, %M%, %S%)
- 路径安全防护 (防止路径遍历攻击)
- 自动添加序列号防止覆盖(从00001开始)
- 仅支持单级子文件夹创建
- 保存工作流元数据 (prompt 和 workflow)
- 工作流信息字符串输出，可检查保存状态

**JSON保存模式说明**:

| 模式 | 说明 | 优点 | 缺点 |
|-----|------|------|------|
| `Auto` (默认) | 自动模式，优先使用 `Prompt+FullWorkflow`，不可用时回退到 `Standard` | 智能选择最佳模式 | 依赖网页扩展 |
| `Standard` | 使用ComfyUI标准后端API获取工作流元数据 | 官方API支持，兼容性好 | `note` 和 `markdown note` 节点不保存在元数据中❌ |
| `FullWorkflow` | 使用网页扩展捕获前端完整工作流元数据 | 数据完整性与原生Save功能一致✅ | 依赖网页扩展，非官方原生支持 |
| `Prompt+FullWorkflow` (推荐) | 结合标准API的prompt字段和网页扩展的完整workflow数据 | 所有模式中最完整的工作流元数据✅ | 依赖网页扩展，非官方原生支持 |

**注意**: `FullWorkflow` 和 `Prompt+FullWorkflow` 模式依赖 `ComfyUI.Xz3r0.XWorkflowSave` 网页扩展和 `xworkflowsave_api` 自定义API

**工作原理**:
1. `ComfyUI.Xz3r0.XWorkflowSave` 网页扩展从ComfyUI前端捕获完整工作流元数据
2. `xworkflowsave_api` 自定义API接收网页扩展传来的数据
3. `XWorkflowSave` 节点通过API获取数据并保存为JSON文件

**输入**:
- `anything` (ANY): 任意输入类型，用于工作流连接。此输入不处理数据，仅用于将节点链接到工作流中
- `filename_prefix` (STRING): 文件名前缀 (默认：`ComfyUI_%Y%-%m%-%d%_%H%-%M%-%S%`)
- `subfolder` (STRING): 子文件夹名称 (默认：`Workflows`)
- `save_mode` (下拉选择): JSON保存模式 (默认：`Auto`，可选：Auto, Standard, FullWorkflow, Prompt+FullWorkflow)

**隐藏输入**:
- `prompt` (PROMPT): 工作流提示词 (自动注入)
- `extra_pnginfo` (EXTRA_PNGINFO): 额外元数据 (自动注入)

**输出**:
- `workflow_info` (STRING): 工作流保存信息，显示保存模式和状态

---

### 📊 XMetadataWorkflow
`🖥️ 浮动窗口（按钮）`

工作流元数据查看器工具，简易的网页类型的工具，用于可视化查看ComfyUI工作流

**功能**:
- 支持多种文件格式：PNG图片、Latent文件、JSON工作流文件
- 支持完整工作流数据的JSON（包括 `FullWorkflow` 和 `Prompt+FullWorkflow` 模式保存的文件）
- 支持显示 `note` 和 `markdown note` 节点内容
- 基于加载文件的元数据, 自动选择简单的自动层级布局算法或元数据中节点位置信息来排列节点
- 显示节点参数和连接关系
- 子图(Subgraph)自动颜色标记
- 支持缩放、平移、自适应视图
- 折叠/展开节点参数
- 选中节点高亮相关连接
- 左边栏隐藏/展开功能
- `Ctrl+鼠标左键` 框选多个节点并移动 (双击空白处 或 按 `ESC` 键取消框选)
- 节点内长内容滚动条支持
- 超长内容虚拟滚动优化性能

**支持的文件**:
- PNG图片 (包含工作流元数据的生成图片)
- Latent潜空间文件 (.latent)
- JSON工作流文件:
  - ✅ ComfyUI网页界面原生的 `Save` 和 `Save As` 所保存的JSON (自动保存在 `user\default\workflows`)
  - ✅ `XWorkflowSave` 节点的 `FullWorkflow` 模式保存的JSON
  - ✅ `XWorkflowSave` 节点的 `Prompt+FullWorkflow` 模式保存的JSON (推荐, 最完整的元数据)
  - ⚠️ ComfyUI网页界面导出功能的JSON文件 (缺少部分元数据，会导致缺失节点或参数)
<img src="https://raw.githubusercontent.com/Xz3r0-M/Xz3r0/refs/heads/main/savetip.png" alt="XWorkflowSave Extension" width="200">

**技术说明**:
- 优先使用完整工作流数据 (如果JSON中包含)
- 子图通过节点ID中的 ":" 识别 (如 "18:8" 表示子图18中的节点8)
- 节点位置使用简单的自动排列算法
- 对于使用自行创建前端界面的第三方自定义节点可能不兼容 (只显示存在于元数据中的内容)

**两种使用方式**:
1. **在ComfyUI中使用（集成）**: 点击ComfyUI页面顶部菜单栏的 ♾️ 按钮，可打开或关闭浮动窗口，已将此网页工具嵌入到该浮动窗口中
<img src="https://raw.githubusercontent.com/Xz3r0-M/Xz3r0/refs/heads/main/bl.png" alt="Open" width="500">

2. **浏览器直接打开（独立）**: 直接打开 `web/XMetadataWorkflow.html` 文件，在浏览器中使用

</details>



<details>
<summary>🧩 ComfyUI网页界面扩展 👈</summary>

### 🖥️ ♾️ XFloatingWindow 浮动窗口（顶部菜单栏 按钮）
`ComfyUI网页界面扩展 - ComfyUI.Xz3r0.XFloatingWindow`

为ComfyUI网页界面增加可打开的浮动窗口

**窗口功能**
- `XMetadataWorkflow`（工作流元数据查看器）
- 窗口透明度调整 (20% - 100%)
- 窗口最大化按钮
- `Alt+鼠标左键` 快捷拖动窗口

**使用按钮**:
- 在ComfyUI网页界面顶部菜单栏中的 ♾️ 按钮，点击可 打开或关闭 浮动窗口
<img src="https://raw.githubusercontent.com/Xz3r0-M/Xz3r0/refs/heads/main/bl.png" alt="Button" width="500">

**设置选项**:
- **Enable ♾️ XFloatingWindow (Button)** (启用浮动窗口按钮):
控制是否在顶部菜单栏显示 ♾️ 按钮
  - 默认: `启用`
  - 位置: ComfyUI 网页界面 ➡️ 设置(齿轮图标) ➡️ ♾️ Xz3r0 ➡️ 窗口 (Window)

**禁用按钮**:
- ComfyUI 网页界面 ➡️ 设置(齿轮图标) ➡️ ♾️ Xz3r0 ➡️ 窗口 (Window) ➡️ 关闭 `Enable ♾️ XFloatingWindow (Button)` 开关
<img src="https://raw.githubusercontent.com/Xz3r0-M/Xz3r0/refs/heads/main/XFloatingWindow.png" alt="XFloatingWindow" width="700">


---

### 💾 XWorkflowSave
`ComfyUI网页扩展 - ComfyUI.Xz3r0.XWorkflowSave`

从ComfyUI网页直接捕获完整工作流元数据，为 `XWorkflowSave` 节点提供 `FullWorkflow` 和 `Prompt+FullWorkflow` 模式所需的数据

**功能**:
- 捕获前端网页中的完整工作流元数据（包括 `note` 和 `markdown note` 节点）
- 通过 `xworkflowsave_api` 自定义API将数据传递给 `XWorkflowSave` 节点
- 数据完整性与ComfyUI网页界面原生的 `Save` 和 `Save As` 功能一致

**工作流程**:
1. 网页扩展 (`ComfyUI.Xz3r0.XWorkflowSave`) 在ComfyUI前端捕获完整工作流数据
2. 自定义API (`xworkflowsave_api`) 接收并缓存来自网页扩展的数据
3. `XWorkflowSave` 节点调用API获取数据并保存为JSON文件

**使用方式**:
- 扩展和API会自动加载，无需手动操作
- 在 `XWorkflowSave` 节点选择 `FullWorkflow` 或 `Prompt+FullWorkflow` 模式时自动使用
- 如果扩展未加载或API不可用，`Auto` 模式会自动回退到 `Standard` 模式

**注意事项**:
- 此扩展和API非ComfyUI官方原生支持，如果ComfyUI官方将来改动相关代码可能会导致出错
- 扩展加载后会在浏览器控制台输出日志信息

---

### 🔍 XFitView
`ComfyUI网页界面扩展 - ComfyUI.Xz3r0.XFitView`

打开ComfyUI网页界面或载入新工作流时，自动执行ComfyUI网页界面原生的`适应视图`功能，确保工作流内容完整显示在画布可视区域内

**功能**:
- **页面首次加载适应**: 页面首次加载完成后自动适应视图
- **工作流加载适应**: 监听工作流加载事件，新工作流载入后自动适应视图
- **智能去重机制**: 基于工作流特征生成唯一标识
- **防抖控制**: 同一工作流200ms内多次触发只执行一次，不同工作流之间立即触发

**设置选项**:
- **Workflow Load Mode** (工作流加载模式): 选择何时自动适应视图 (默认为: `never` )
  - `first` 模式: 同一会话中相同工作流只适应一次（推荐, ComfyUI网页界面刷新后重置）
  - `always` 模式: 每次加载或切换工作流都适应视图
  - `never` 模式: 禁用自动适应
- **Fit View Delay** (适应视图延迟): 延迟时间 0-2000ms 可调，默认 300ms
  - 如果视图适应不正确，可适当调整延迟时间

**设置位置**:
- ComfyUI 网页界面 ➡️ 设置(齿轮图标) ➡️ ♾️ Xz3r0 ➡️ XFitView
<img src="https://raw.githubusercontent.com/Xz3r0-M/Xz3r0/refs/heads/main/XFitView.png" alt="XFitView" width="700">

**工作原理**:
- 使用 ComfyUI 扩展 API 注册扩展
- 监听 `app.graph.onConfigure` 和 `app.loadGraphData` 事件
- 基于节点类型、连接拓扑生成工作流唯一标识
- 使用 cyrb53 哈希算法生成64位哈希值，显著降低冲突概率
- 通过触发ComfyUI页面右下角的原生 Fit View 按钮实现适应视图功能

</details>

---

## 📁 项目结构
<details>

```
ComfyUI-Xz3r0-Nodes/
├── .github/             # GitHub Actions
│   └── workflows/
│       └── publish.yml
├── __init__.py          # 主入口
├── xnode/               # 节点目录
│   ├── __init__.py
│   ├── xmath.py         # 数学运算节点
│   ├── xresolution.py   # 分辨率设置节点
│   ├── xdatetimestring.py     # 日期时间字符串节点
│   ├── ximagesave.py    # 图像保存节点
│   ├── xvideosave.py    # 视频保存节点
│   ├── xaudiosave.py    # 音频保存节点
│   ├── xlatentload.py   # Latent加载节点
│   ├── xlatentsave.py   # Latent保存节点
│   ├── xstringgroup.py  # 字符串组合节点
│   ├── xworkflowsave_api.py  # 工作流保存节点API
│   └── xworkflowsave.py # 工作流保存节点
├── web/                 # 网页扩展目录
│   ├── XFitView.js   # ComfyUI网页界面自动适应视图扩展
│   ├── XFloatingWindow.js   # ComfyUI浮动窗口扩展
│   ├── XWorkflowSave_Extension.js  # XWorkflowSave的网页扩展
│   └── XMetadataWorkflow.html  # 工作流元数据可视化查看器
├── locales/             # ComfyUI标准本地化支持
│   ├── en/              # 英文
│   │   ├── nodeDefs.json   # 节点本地化文件
│   │   └── settings.json   # 网页扩展本地化文件
│   └── zh/              # 中文
│       ├── nodeDefs.json   # 节点本地化文件
│       └── settings.json   # 网页扩展本地化文件
├── preview/             # 预览图片
│   ├── preview.png
│   └── XMetadataWorkflow_preview.png
├── .gitignore           # Git 忽略文件
├── Changelog.md         # 更新日志
├── LICENSE              # MIT 许可证
├── pyproject.toml       # Comfy Registry配置文件
├── requirements.txt     # Python 依赖清单
└── README.md            # 项目文档
```

</details>

---

## 📄 许可证

本项目采用 MIT 许可证 - 详见 [LICENSE](LICENSE) 文件

---

## 🙏 致谢

- [ComfyUI](https://github.com/comfyanonymous/ComfyUI) - 强大的基于节点的图像生成UI

---

## 📞 项目链接

- **项目主页**: [https://github.com/Xz3r0-M/ComfyUI-Xz3r0-Nodes](https://github.com/Xz3r0-M/ComfyUI-Xz3r0-Nodes)
- **问题反馈**: [GitHub Issues](https://github.com/Xz3r0-M/ComfyUI-Xz3r0-Nodes/issues)
- **Comfy Registry主页**: [Comfy Registry](https://registry.comfy.org/zh/publishers/xz3r0/nodes/xz3r0-nodes)

---
