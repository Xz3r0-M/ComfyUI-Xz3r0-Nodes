# ComfyUI-Xz3r0-Nodes

<div align="center">

**🎨 一个可扩展的多功能ComfyUI自定义节点集合**

[![License](https://img.shields.io/badge/license-To%20be%20determined-blue.svg)](LICENSE)
[![Python](https://img.shields.io/badge/python-3.10%2B-blue.svg)](https://www.python.org/)
[![ComfyUI](https://img.shields.io/badge/ComfyUI-compatible-green.svg)](https://github.com/comfyanonymous/ComfyUI)

</div>

---

## 📖 项目简介

**ComfyUI-Xz3r0-Nodes** 是一个设计为**高度模块化、可扩展**的ComfyUI自定义节点集合项目，采用创新的**自动发现架构**。

### 🎯 设计特点

- 🔧 **自动发现机制** - 在 `xnode/` 目录创建节点文件即可自动注册
- 📦 **标准化结构** - 遵循ComfyUI插件开发最佳实践
- 🚀 **开发友好** - 清晰的代码组织和完整文档

### ✨ 当前功能

- 🛠️ **工具节点** - 数学运算、分辨率设置
- 🖼️ **图像处理** - 图像保存（支持自定义文件名和子文件夹）
- 🎬 **视频处理** - 视频保存（FFmpeg编码，无损质量）
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
2. 搜索 "Xz3r0 Nodes"
3. 点击安装按钮

---

## 📚 节点列表

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
- `image` (IMAGE): 输入图像张量
- `filename_prefix` (STRING): 文件名前缀
- `subfolder` (STRING): 子文件夹名称

**输出**:
- `image` (IMAGE): 原始图像（透传）
- `save_path` (STRING): 保存的相对路径

---

### 🎬 视频节点 (♾️ Xz3r0/Video)

#### XVideoSave

视频保存节点，使用FFmpeg将图像序列保存为视频。

**功能**:
- 使用FFmpeg将图像序列保存为MKV格式视频
- H.265/HEVC编码，yuv444p10le像素格式，CRF 0（无损）
- 支持自定义FPS（每秒帧数）
- 支持自定义文件名和子文件夹
- 日期时间标识符替换
- 同名文件自动序列号处理
- 路径安全防护

**输入**:
- `images` (IMAGE): 图像张量序列 (B, H, W, C)
- `fps` (INT): 每秒帧数（默认24，范围1-240）
- `filename_prefix` (STRING): 文件名前缀
- `subfolder` (STRING): 子文件夹名称

**输出**:
- `images` (IMAGE): 原始图像（透传）
- `save_path` (STRING): 保存的相对路径

**FFmpeg参数**:
- vcodec: libx265 (H.265/HEVC编码)
- pix_fmt: yuv444p10le (10位YUV 4:4:4采样，无损)
- crf: 0 (质量因子，0为无损)
- preset: fast (编码速度预设)
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

---

## 📁 项目结构

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
├── requirements.txt     # Python依赖清单
└── README.md            # 项目文档
```

---

## 📄 许可证

待定

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
