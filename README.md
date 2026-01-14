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

---

## 📁 项目结构

```
ComfyUI-Xz3r0-Nodes/
├── __init__.py          # 主入口 + 自动发现机制
├── xnode/               # 节点目录（自动发现）
│   ├── __init__.py
│   └── xmath.py        # 数学运算节点
├── tests/               # 测试目录
│   ├── __init__.py
│   └── test_nodes.py
├── requirements.txt     # Python依赖清单
├── CLAUDE.md            # AI 助手项目指南
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
