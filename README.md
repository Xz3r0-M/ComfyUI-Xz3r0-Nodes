<div align="center">

# ♾️ ComfyUI-Xz3r0-Nodes ♾️

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![ComfyUI](https://img.shields.io/badge/ComfyUI-compatible-green.svg)](https://github.com/comfyanonymous/ComfyUI)

</div>

---

## 📖 项目简介

**ComfyUI-Xz3r0-Nodes** 是一个设计为**高度模块化**的ComfyUI自定义节点项目，采用**自动发现架构**。

### 🎯 设计特点

- 🔧 **自动发现机制** - 在 `xnode/` 目录创建节点文件即可自动注册
- 🌍 **国际化支持** - 内置中英文界面，支持多语言扩展
- 🚫 **安全处理** - 节点中可输入的文件名和路径已做防遍历攻击处理，请使用文字，不要使用日期时间标识符以外的特殊符号！

### ✨ 当前功能

- 🛠️ **工具节点** - 数学运算、分辨率设置
- 🖼️ **图像处理** - 图像保存（支持自定义文件名和子文件夹）
- 🎬 **视频处理** - 视频保存（H.265编码，自定义质量和速度预设，音频支持）
- 🔮 **Latent处理** - Latent加载和保存（支持元数据）

---

## 🚀 快速开始

### 方法 1: 手动安装

1. **克隆仓库到ComfyUI的 `custom_nodes` 目录**

```bash
cd ComfyUI/custom_nodes
git clone https://github.com/Xz3r0-M/ComfyUI-Xz3r0-Nodes.git
```

2. **安装依赖**

```bash
cd ComfyUI-Xz3r0-Nodes
pip install -r requirements.txt
```

3. **重启ComfyUI**

### 方法 2: ComfyUI Manager（推荐）

1. 打开ComfyUI Manager
2. 搜索 "Xz3r0-Nodes"
3. 点击安装按钮

---

<div align="center">

<img src="preview/preview.png" alt="项目预览" width="400">

</div>

<details>
<summary><strong>📚 节点列表</strong>（点击展开/折叠）</summary>

### 🛠️ 工具节点 (♾️ Xz3r0/Tools)

#### XMath

基础数学运算节点，支持双输出格式（整数+浮点数）。

**功能**: 加法、减法、乘法、除法、幂运算、取模、最大值、最小值

**输入**:
- `a` (FLOAT): 第一个数值
- `b` (FLOAT): 第二个数值
- `operation`: 运算方式（下拉选择）

**输出**:
- `int_result` (INT): 整数结果（截断小数）
- `float_result` (FLOAT): 浮点数结果（精确值）

#### XResolution

分辨率设置节点，提供标准分辨率预设和自定义功能。

**功能**:
- 标准分辨率预设（16:9, 4:3, 1:1, 16:10, 21:9等）
- 倍率缩放功能
- 宽高互换功能
- 参数验证（最小1×1）

**输入**:
- `preset` (下拉选择): 预设分辨率
- `width` (INT): 自定义宽度
- `height` (INT): 自定义高度
- `scale` (FLOAT): 缩放倍率
- `swap_dimensions` (BOOLEAN): 是否交换宽高

**输出**:
- `width` (INT): 最终宽度
- `height` (INT): 最终高度

---

### 🖼️ 图像节点 (♾️ Xz3r0/Image)

#### XImageSave

图像保存节点，支持自定义文件名和子文件夹管理。

**功能**:
- 支持自定义文件名和子文件夹
- 日期时间标识符替换（%Y%, %m%, %d%, %H%, %M%, %S%）
- 路径安全防护（防止路径遍历攻击）
- 同名文件自动序列号处理
- 批量图像保存支持

**输入**:
- `images` (IMAGE)I: 输入图像张量
- `filename_prefix` (STRING): 文件名前缀
- `subfolder` (STRING): 子文件夹名称

**输出**:
- `images` (IMAGE): 原始图像（透传）
- `save_path` (STRING): 保存的相对路径

---

### 🎬 视频节点 (♾️ Xz3r0/Video)

#### XVideoSave

视频保存节点，使用FFmpeg将图像序列保存为视频。

**功能**:
- 使用FFmpeg将视频对象保存为MKV格式视频
- H.265/HEVC编码，yuv444p10le像素格式
- FPS从视频对象自动获取（由官方的创建视频CreateVideo节点设置）
- 音频支持（自动从视频对象获取）
- 自定义CRF（质量参数 0-40，0为无损）
- 编码预设选择（ultrafast到veryslow，平衡编码速度和压缩效率）
- 支持自定义文件名和子文件夹
- 日期时间标识符替换（%Y%, %m%, %d%, %H%, %M%, %S%）
- 路径安全防护（防止路径遍历攻击）
- 同名文件自动覆盖（建议使用日期时间标识符避免冲突）
- 元数据保存（工作流提示词、种子值、模型信息等）

**输入**:
- `video` (VIDEO): 视频对象（包含图像序列、音频和帧率）
- `filename_prefix` (STRING): 文件名前缀（默认：`ComfyUI_%Y%-%m%-%d%_%H%-%M%-%S%`）
- `subfolder` (STRING): 子文件夹名称（默认：`Videos`）
- `crf` (FLOAT): 质量参数（默认：0.0，范围0-40，0为无损，40为最差质量）
- `preset` (STRING): 编码预设（默认：`medium`，可选：ultrafast, superfast, veryfast, faster, fast, medium, slow, slower, veryslow）

**隐藏输入**:
- `prompt` (PROMPT): 工作流提示词（自动注入）
- `extra_pnginfo` (EXTRA_PNGINFO): 额外元数据（自动注入）

**输出**:
- 视频预览（显示保存的视频）

**FFmpeg参数**:
- vcodec: libx265 (H.265/HEVC编码)
- pix_fmt: yuv444p10le (10位YUV 4:4:4采样)
- crf: 可配置（0=无损，40=最差质量）
- preset: 可配置（ultrafast到veryslow）
- 容器格式: MKV

---

### 🔮 Latent节点 (♾️ Xz3r0/Latent)

#### XLatentLoad

Latent加载节点，支持从输入端口或文件加载Latent。

**功能**:
- 支持从上游节点输入Latent（优先级最高）
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

#### XLatentSave

Latent保存节点，支持自定义文件名和元数据保存。

**功能**:
- 保存Latent到ComfyUI默认输出目录
- 输出Latent端口可以传递到其他节点
- 支持自定义文件名和子文件夹
- 支持日期时间标识符（%Y%, %m%, %d%, %H%, %M%, %S%）
- 自动检测同名文件并添加序列号（从00001开始）
- 仅支持单级子文件夹创建
- 安全防护（防止路径遍历攻击）
- 支持元数据保存（工作流提示词、种子值、模型信息等）

**输入**:
- `latent` (LATENT): 输入Latent张量
- `filename_prefix` (STRING): 文件名前缀
- `subfolder` (STRING): 子文件夹名称

**隐藏输入**:
- `prompt` (PROMPT): 工作流提示词（自动注入）
- `extra_pnginfo` (EXTRA_PNGINFO): 额外元数据（自动注入）

**输出**:
- `latent` (LATENT): 原始Latent（透传）
- `save_path` (STRING): 保存的相对路径

</details>

---

## 🌍 国际化支持

ComfyUI-Xz3r0-Nodes 内置了中英文双语界面支持，通过 `locales/` 目录实现多语言切换。

### 支持的语言

- 🇬🇧 **English** - 英文界面
- 🇨🇳 **中文** - 中文界面

### 工作原理

- ComfyUI 会根据您的系统语言自动选择对应的界面语言
- 节点名称、参数描述和提示信息都会自动翻译
- 如需添加新的语言支持，只需在 `locales/` 目录下创建对应语言的 `nodeDefs.json` 文件

### 添加新语言

如果您想为项目贡献新的语言支持，请参考 `locales/en/nodeDefs.json` 的格式创建新的语言文件，并提交 Pull Request。

---

## � 依赖说明

### Python 依赖

项目依赖在 `requirements.txt` 中定义，主要包括：

- **torch** - 深度学习框架（ComfyUI 核心依赖）
- **numpy** - 数值计算库
- **Pillow** - 图像处理库
- **safetensors** - 张量安全保存和加载
- **ffmpeg-python** - FFmpeg Python 绑定（视频处理）

**注意**：ComfyUI 环境通常已经包含了 `torch`、`numpy` 等核心依赖，`requirements.txt` 列出节点所引用的依赖。

---

## �📁 项目结构

```
ComfyUI-Xz3r0-Nodes/
├── __init__.py          # 主入口 + 自动发现机制
├── xnode/               # 节点目录（自动发现）
│   ├── __init__.py
│   ├── xmath.py         # 数学运算节点
│   ├── xresolution.py   # 分辨率设置节点
│   ├── ximagesave.py    # 图像保存节点
│   ├── xvideosave.py    # 视频保存节点
│   ├── xlatentload.py   # Latent加载节点
│   └── xlatentsave.py   # Latent保存节点
├── locales/             # 国际化支持（节点显示名称和提示）
│   ├── en/              # 英文定义
│   │   └── nodeDefs.json
│   └── zh/              # 中文定义
│       └── nodeDefs.json
├── requirements.txt     # Python依赖清单
└── README.md            # 项目文档
```

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

---

<div align="center">

**⭐ 如果这个项目对你有帮助，请给个星标支持一下！**

</div>
