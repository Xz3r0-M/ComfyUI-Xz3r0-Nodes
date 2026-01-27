## v1.0.3 主要更新

1. ⭐新增 `XAudioSave` (音频保存节点)
    - 无损 16位 WAV
    - 多种采样率 (44.1kHz, 48kHz, 96kHz, 192kHz)
    - 音量标准化 (使用LUFS响度标准)
    - 音量峰值限制 (Simple Peak, True Peak)

2. 🛠️增强 `XMath`
	- 添加高优先级并支持接收整数和浮点数的 输入A/B 以及对应的 开关按钮
	- 添加 交换A/B数值 开关按钮

3. 🛠️增强 `XStringGroup`
    - 添加`无`, `逗号+空格`, `句号+空格`三种分隔方式, 并调整分隔方式默认为`无`

4. 🪛修改 `XVideoSave`
    - FFmpeg对音频流不再转码而是改为直接复制接收到的音频流, 以兼容`XAudioSave`输出的高品质WAV音频合并到视频中

## v1.0.3 Major Updates

1. ⭐Added `XAudioSave` (Audio Save Node)
    - Lossless 16-bit WAV
    - Multiple sample rates (44.1kHz, 48kHz, 96kHz, 192kHz)
    - Volume normalization (using LUFS loudness standard)
    - Volume peak limiting (Simple Peak, True Peak)

2. 🛠️Enhanced `XMath`
    - Added high-priority Input A/B that supports both integers and floats with corresponding toggle buttons
    - Added Swap A/B Values toggle button

3. 🛠️Enhanced `XStringGroup`
    - Added three separator options: `None`, `Comma + Space`, `Period + Space`, and changed default separator to `None`

4. 🪛Modified `XVideoSave`
    - FFmpeg now directly copies received audio streams instead of transcoding to better support merging high-quality WAV audio from `XAudioSave` into videos

---

## v1.0.2 主要更新

1. ⭐新增 `XStringGroup` (字符串组合节点)
    - 5个多行字符串输入框
    - 支持多种分隔方式的自定义分隔
    - 提供字符串的多种输出端口 (带自定义分隔的全部字符串, 选择的字符串, 单独的1-5字符串)

## v1.0.2 Major Updates

1. ⭐Added `XStringGroup` (String Group Node)
    - 5 multi-line string input fields
    - Supports custom separators with multiple separator options
    - Provides multiple string output ports (all strings with custom separator, selected string, individual strings 1-5)
