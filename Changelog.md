## v1.2.0 主要更新
1. 🛠️ 增强`XAudioSave`
    - 将节点原先的音频音量标准化和峰值限制处理方式转为使用FFmpeg (loudnorm 滤镜), 以提高对多声道(比如5.1和7.1)音频的兼容性, 原先所使用的依赖 `pyloudnorm` 也不再需要了, 目前项目只需要安装`ffmpeg-python`这一个依赖以及在本机安装FFmpeg (太棒了😌)
    - FFmpeg的处理所需时间会比之前的方式慢 (需要2次处理 Two-pass), 但是对目标值会更精准
    - 音频文件从原先的16位WAV(PCM 16-bit)提升为更高质量的32位浮点WAV(PCM 32-bit float), 但是文件也相应的更大了 (向您的硬盘致敬🫡)
    - 移除了原先的简单限制 (Simple Peak)模式, 现在改为选择是否开启`峰值限制`(True Peak 峰值限制), 默认为:`true` (开启)
    - 新增压缩器 (acompressor 滤镜)和开关按钮, 压缩器可以选择三种压缩预设：快速/平衡/缓慢, 压缩器开关默认为:`false` (关闭)
    - 新增自定义压缩器的压缩比和开关按钮, 当开启时自定义的压缩比值会替代压缩预设所使用的压缩比值
    - LUFS目标值改为`-14.1`, 峰值限制目标值改为`-1.1`（因为有些情况下loudnorm 滤镜处理后的音频会有偏差）

    无关紧要的抱怨:
        不再使用`pyloudnorm`是因为我测试发现对多声道音频会报错, 尝试修复无果所以换成了FFmpeg, 但FFmpeg并不是没有问题, 实际上loudnorm 滤镜本身对一些参数有 (莫名其妙的) 硬绑定, 导致无法完全符合我的 (传统音频插件处理流程) 想法, 来来回回好几天尝试不同方案和解决奇怪的BUG, 我在这个节点上花了1亿Tokens, 是的, 就是1亿, 谢谢你 FFmpeg🫠

2. 🧬 规范化所有节点的代码 (呃, 真的规范了吗...)


## v1.2.0 Major Updates
1. 🛠️ Enhanced `XAudioSave`
    - Changed the node's audio volume normalization and peak limiting processing to use FFmpeg (loudnorm filter) to improve compatibility with multi-channel audio (e.g., 5.1 and 7.1). The previously used dependency `pyloudnorm` is no longer needed. Now the project only requires installing `ffmpeg-python` as a dependency and having FFmpeg installed locally (Awesome 😌)
    - FFmpeg processing takes longer than the previous method (requires two-pass processing), but achieves more accurate target values
    - Audio files upgraded from 16-bit WAV (PCM 16-bit) to higher quality 32-bit float WAV (PCM 32-bit float), but files are correspondingly larger (Salute to your hard drive 🫡)
    - Removed the previous Simple Peak mode, now changed to a toggle for `Peak Limiting` (True Peak peak limiting), default: `true` (enabled)
    - Added compressor (acompressor filter) and toggle button. Compressor offers three compression presets: Fast/Balanced/Slow. Compressor toggle default: `false` (disabled)
    - Added custom compressor ratio and toggle button. When enabled, custom ratio values override the compression preset's ratio
    - LUFS target value changed to `-14.1`, peak limiting target value changed to `-1.1` (because in some cases audio processed by loudnorm filter has deviations)

    Irrelevant complaint:
        Stopped using `pyloudnorm` because I found it errors with multi-channel audio during testing. Tried to fix it but failed, so switched to FFmpeg. However, FFmpeg is not without issues - actually the loudnorm filter has some (inexplicable) hard bindings on certain parameters, making it impossible to fully match my (traditional audio plugin processing workflow) ideas. Went back and forth for several days trying different solutions and solving weird bugs. I spent 100 million Tokens on this node. Yes, 100 million. Thank you FFmpeg 🫠

2. 🧬 Standardized code for all nodes (Uh, did I really standardize it...)


## v1.1.0 主要更新

- **本次更新节点功能没有变化**
1. 📝 将版本号改为`1.1.0`
    - 未来版本号的前两位数字表示主要功能更新 (新增节点 或 增强节点功能), 最后一位数字表示次要更新 (一般为修复BUG)

2. 🪛 更改节点注册方式
    - 放弃项目之前使用的节点自动注册方式改为更偏标准的节点注册方式 (尝试提高兼容性)

## v1.1.0 Major Updates

- **No changes to node functionality in this update**
1. 📝 Changed version number to `1.1.0`
    - In the future, the first two digits of the version number will indicate major feature updates (new nodes or enhanced node functionality), and the last digit will indicate minor updates (generally bug fixes)

2. 🪛 Changed node registration method
    - Abandoned the previous automatic node registration method in favor of a more standard node registration approach (attempting to improve compatibility)

---

## v1.0.3 主要更新

1. ⭐ 新增 `XAudioSave` (音频保存节点)
    - 无损 16位 WAV
    - 多种采样率 (44.1kHz, 48kHz, 96kHz, 192kHz)
    - 音量标准化 (使用LUFS响度标准)
    - 音量峰值限制 (Simple Peak, True Peak)

2. 🛠️ 增强 `XMath`
	- 添加高优先级并支持接收整数和浮点数的 输入A/B 以及对应的 开关按钮
	- 添加 交换A/B数值 开关按钮

3. 🛠️ 增强 `XStringGroup`
    - 添加`无`, `逗号+空格`, `句号+空格`三种分隔方式, 并调整分隔方式默认为`无`

4. 🪛 修改 `XVideoSave`
    - FFmpeg对音频流不再转码而是改为直接复制接收到的音频流, 以兼容`XAudioSave`输出的高品质WAV音频合并到视频中

## v1.0.3 Major Updates

1. ⭐ Added `XAudioSave` (Audio Save Node)
    - Lossless 16-bit WAV
    - Multiple sample rates (44.1kHz, 48kHz, 96kHz, 192kHz)
    - Volume normalization (using LUFS loudness standard)
    - Volume peak limiting (Simple Peak, True Peak)

2. 🛠️ Enhanced `XMath`
    - Added high-priority Input A/B that supports both integers and floats with corresponding toggle buttons
    - Added Swap A/B Values toggle button

3. 🛠️ Enhanced `XStringGroup`
    - Added three separator options: `None`, `Comma + Space`, `Period + Space`, and changed default separator to `None`

4. 🪛 Modified `XVideoSave`
    - FFmpeg now directly copies received audio streams instead of transcoding to better support merging high-quality WAV audio from `XAudioSave` into videos

---

## v1.0.2 主要更新

1. ⭐ 新增 `XStringGroup` (字符串组合节点)
    - 5个多行字符串输入框
    - 支持多种分隔方式的自定义分隔
    - 提供字符串的多种输出端口 (带自定义分隔的全部字符串, 选择的字符串, 单独的1-5字符串)

## v1.0.2 Major Updates

1. ⭐ Added `XStringGroup` (String Group Node)
    - 5 multi-line string input fields
    - Supports custom separators with multiple separator options
    - Provides multiple string output ports (all strings with custom separator, selected string, individual strings 1-5)
