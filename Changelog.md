# 更新日志
---

## v1.4.0 主要更新

### 1. ⭐ 新增 `ComfyUI.Xz3r0.XWorkflowSave` (`xworkflowsave_extension.js`) 网页扩展
- 从ComfyUI网页直接捕获完整工作流元数据给 `XWorkflowSave` 节点使用

### 2. 🛠️ 增强 `XworkflowSave` 节点
- 新增3种JSON保存模式: `auto`, `standard`, `full` (默认为: `auto` )
- `auto` 模式会优先使用 `full` 模式, 不可用时自动回退到 `standard` 模式以保证兼容性
- `standard` 模式使用ComfyUI标准后端API来获取工作流元数据, 优点: ComfyUI官方API支持, 缺点: 工作流元数据不完整, ( `note` 和 `markdown note` 节点不保存在元数据中)
- `full` 模式使用专门创建的网页扩展 `xworkflowsave_extension.js` 来捕获前端网页中完整的工作流元数据，数据完整性与ComfyUI网页原生的保存工作流功能`Save`和`Save As`所一致 (`note` 和 `markdown note` 节点能够保存在元数据中)
<img src="https://raw.githubusercontent.com/Xz3r0-M/Xz3r0/refs/heads/main/savetip.png" alt="Button" width="200">
- 新增文本框, 只用于网页扩展捕获给 `full` 模式的工作流元数据. 当模式为 `standard` 时, 文本框不会有(更新)内容
- 新增 `工作流信息` 字符串输出端口, 可以检查保存信息

### 3. 🛠️ 增强 `XMetadataWorkflow` 网页工具
- 支持完整工作流数据的JSON:
    - ✅ ComfyUI网页原生的保存工作流功能`Save`和`Save As`所保存的JSON (自动保存在ComfyUI目录下 `user\default\workflows`)
    - ✅ `XWorkflowSave` 节点 `full` 模式保存的JSON
- 为节点内的长内容添加滚动条
- 支持显示工作流中的 `note` 和 `markdown note` 节点
- 修复一些之前在硬编码中还没有被本地化的语言

注意: `XMetadataWorkflow` 网页工具对于使用自行创建前端界面的第三方自定义节点是不兼容的 (网页工具只会显示存在于元数据中的内容)

## v1.4.0 Major Updates

### 1. ⭐ Added `ComfyUI.Xz3r0.XWorkflowSave` (`xworkflowsave_extension.js`) Web Extension
- Captures complete workflow metadata directly from ComfyUI web interface for use with the `XWorkflowSave` node

### 2. 🛠️ Enhanced `XWorkflowSave` Node
- Added 3 JSON save modes: `auto`, `standard`, `full` (default: `auto`)
- `auto` mode prioritizes `full` mode, automatically falling back to `standard` mode when unavailable to ensure compatibility
- `standard` mode uses ComfyUI's standard backend API to retrieve workflow metadata. Pros: ComfyUI official API support. Cons: Incomplete workflow metadata ( `note` and `markdown note` nodes are not saved in metadata)
- `full` mode uses the specially created web extension `xworkflowsave_extension.js` to capture complete workflow metadata from the frontend web page. Data integrity is consistent with ComfyUI's native `Save` and `Save As` workflow functions ( `note` and `markdown note` nodes can be saved in metadata)
<img src="https://raw.githubusercontent.com/Xz3r0-M/Xz3r0/refs/heads/main/savetip.png" alt="Button" width="200">
- Added text box, used only for web extension to capture workflow metadata for `full` mode. When mode is `standard`, the text box will not have (updated) content
- Added `Workflow Info` string output port to check save information

### 3. 🛠️ Enhanced `XMetadataWorkflow` Web Tool
- Supports complete workflow data JSON:
    - ✅ JSON saved by ComfyUI web native `Save` and `Save As` workflow functions (automatically saved in ComfyUI directory `user\default\workflows`)
    - ✅ JSON saved by `XWorkflowSave` node in `full` mode
- Added scrollbars for long content within nodes
- Supports displaying `note` and `markdown note` nodes in workflows
- Fixed some previously hardcoded languages that were not localized

Note: `XMetadataWorkflow` web tool is incompatible with third-party custom nodes that use self-created frontend interfaces (the web tool will only display content that exists in metadata)

---

## v1.3.0 主要更新

### 1. ⭐ 新增 `XWorkflowSave` (工作流元数据 JSON 文件保存节点)
- 将ComfyUI工作流元数据保存为JSON文件 (适配 `XMetadataWorkflow`)
- 同时保存 prompt 和 workflow 字段的工作流元数据
- ComfyUI的网页导出功能的JSON文件只有 workflow 字段而缺少 prompt 字段, workflow 字段的元数据中只有节点的参数值缺失了参数名, 这是制作这个节点的原因
- `XAudioSave` 和 `XVideoSave` 在保存文件时并没有嵌入工作流元数据, 推荐配合这个新节点

### 2. ⭐ 新增 `XMetadataWorkflow` (简易的工作流元数据可视化查看工具)
- 读取文件的 prompt 字段工作流元数据进行可视化查看数据, 可以在缺失节点或不使用ComfyUI的情况下更好的查看工作流中绝大部分节点的参数数据, 有一些节点和数据没有保存在 prompt 字段就不会显示
- 支持加载多种文件格式: PNG图片, Latent文件 (`XLatentSave`), JSON工作流文件 (`XWorkflowSave` 生成的带有 prompt 字段的JSON)
- 在ComfyUI页面中点击顶部菜单栏的 ♾️ 按钮打开浮动窗口, 或使用浏览器打开`web\xmetadataworkflow.html`独立使用
- 中英双语
- 暗黑和明亮界面
- 这是一个简易且粗糙的网页工具, 使用时可能会遇到很多BUG😜

### 3. ⭐ 新增 `XDateTimeString` 日期时间标识符字符串节点
- 使用日期时间标识符获取时间然后输出为字符串
- 可以提供给本身不支持日期时间字符串的节点用作文件名称或其他需要获取时间的文字内容

### 4. 🛠️ 为 `XImageSave` 和 `XAudioSave` 以及 `XVideoSave` 节点添加进度条
- 这3个节点处理文件时可能花费时间较长, 为它们添加进度条后, 不再是原来那样运行时看起来卡住了

### 5. 🪛 修改所有节点的分类
- 提升工作流体验的节点现在归类在 `Workflow-Processing`
- 处理文件的节点现在归类在 `File-Processing`

## v1.3.0 Major Updates

### 1. ⭐ Added `XWorkflowSave` (Workflow Metadata JSON File Save Node)
- Saves ComfyUI workflow metadata as JSON files (compatible with `XMetadataWorkflow`)
- Saves workflow metadata containing both prompt and workflow fields
- ComfyUI's web export function only includes the workflow field but lacks the prompt field, and the workflow field metadata only contains node parameter values without parameter names - this is why this node was created
- `XAudioSave` and `XVideoSave` do not embed workflow metadata when saving files, so using this new node is recommended

### 2. ⭐ Added `XMetadataWorkflow` (Simple Workflow Metadata Visualization Tool)
- Reads the prompt field workflow metadata from files for visual data viewing, allowing better viewing of most node parameter data in workflows when nodes are missing or ComfyUI is not being used; some nodes and data not saved in the prompt field will not be displayed
- Supports loading multiple file formats: PNG images, Latent files (`XLatentSave`), JSON workflow files (JSON with prompt field generated by `XWorkflowSave`)
- Click the ♾️ button in the top menu bar on the ComfyUI page to open the floating window, or use a browser to open `web\xmetadataworkflow.html` for standalone use
- Chinese and English support
- Dark and light themes
- This is a simple and rough web tool, you may encounter many BUGs when using it 😜

### 3. ⭐ Added `XDateTimeString` (DateTime Identifier String Node)
- Uses datetime identifiers to get time and output as string
- Can be provided to nodes that don't natively support datetime strings for use as filenames or other text content requiring time information

### 4. 🛠️ Added progress bars to `XImageSave`, `XAudioSave`, and `XVideoSave` nodes
- These three nodes may take longer to process files. With progress bars added, they no longer appear to be stuck when running

### 5. 🪛 Changed categorization for all nodes
- Nodes that enhance workflow experience are now categorized under `Workflow-Processing`
- File processing nodes are now categorized under `File-Processing`

---

## v1.2.0 主要更新

### 1. 🛠️ 增强 `XAudioSave`
- 将节点原先的音频音量标准化和峰值限制处理方式转为使用 FFmpeg (loudnorm 滤镜), 以提高对多声道(比如5.1和7.1)音频的兼容性, 原先所使用的依赖 `pyloudnorm` 也不再需要了, 目前项目只需要安装 `ffmpeg-python` 这一个依赖以及在本机安装 FFmpeg (太棒了😌)
- FFmpeg 的处理所需时间会比之前的方式慢 (需要2次处理 Two-pass), 但是对目标值会更精准
- 音频文件从原先的 16位WAV(PCM 16-bit) 提升为更高质量的 32位浮点WAV(PCM 32-bit float), 但是文件也相应的更大了 (向您的硬盘致敬🫡)
- 移除了原先的简单限制 (Simple Peak) 模式, 现在改为选择是否开启 `峰值限制`(True Peak), 默认为: `true`(开启)
- 新增压缩器 (acompressor 滤镜)和开关按钮, 压缩器可以选择三种压缩预设：快速/平衡/缓慢, 压缩器开关默认为: `false`(关闭)
- 新增自定义压缩器的压缩比和开关按钮, 当开启时自定义的压缩比值会替代压缩预设所使用的压缩比值
- LUFS目标值改为: `-14.1`, 峰值限制目标值改为: `-1.1` （增加0.1是因为有些情况下loudnorm 滤镜处理后的音频会有偏差）

    无关紧要的抱怨:
        不再使用 `pyloudnorm` 是因为我测试发现对多声道音频会报错, 尝试修复无果所以换成了 FFmpeg, 但 FFmpeg 并不是没有问题的, 实际上 loudnorm 滤镜 本身对一些参数有 (莫名其妙的) 硬绑定, 导致无法完全符合我的 (传统音频插件处理流程) 想法, 来来回回好几天尝试不同方案和解决奇怪的BUG, 我在这个节点上花了1亿Tokens, 是的, 就是1亿, 谢谢你 FFmpeg🫠

### 2. 🧬 规范化所有节点的代码
- 呃, 真的规范了吗...?

## v1.2.0 Major Updates

### 1. 🛠️ Enhanced `XAudioSave`
- Changed the node's audio volume normalization and peak limiting processing to use FFmpeg (loudnorm filter) to improve compatibility with multi-channel audio (e.g., 5.1 and 7.1). The previously used dependency `pyloudnorm` is no longer needed. Now the project only requires installing `ffmpeg-python` as a dependency and having FFmpeg installed locally (Awesome 😌)
- FFmpeg processing takes longer than the previous method (requires two-pass processing), but achieves more accurate target values
- Audio files upgraded from 16-bit WAV (PCM 16-bit) to higher quality 32-bit float WAV (PCM 32-bit float), but files are correspondingly larger (Salute to your hard drive 🫡)
- Removed the previous Simple Peak mode, now changed to a toggle for `Peak Limiting` (True Peak), default: `true` (enabled)
- Added compressor (acompressor filter) and toggle button. Compressor offers three compression presets: Fast/Balanced/Slow. Compressor toggle default: `false` (disabled)
- Added custom compressor ratio and toggle button. When enabled, custom ratio values override the compression preset's ratio
- LUFS target value changed to `-14.1`, peak limiting target value changed to `-1.1` (because in some cases audio processed by loudnorm filter has deviations)

    Irrelevant complaint:
        Stopped using `pyloudnorm` because I found it errors with multi-channel audio during testing. Tried to fix it but failed, so switched to FFmpeg. However, FFmpeg is not without issues - actually the loudnorm filter has some (inexplicable) hard bindings on certain parameters, making it impossible to fully match my (traditional audio plugin processing workflow) ideas. Went back and forth for several days trying different solutions and solving weird bugs. I spent 100 million Tokens on this node. Yes, 100 million. Thank you FFmpeg 🫠

### 2. 🧬 Standardized code for all nodes
- Uh, did I really standardize it...?

---

## v1.1.0 主要更新

- 本次更新节点功能没有变化

### 1. 📝 将版本号改为`1.1.0`
- 未来版本号的前两位数字表示主要功能更新 (新增节点 或 增强节点功能), 最后一位数字表示次要更新 (一般为修复BUG)

### 2. 🪛 更改节点注册方式
- 放弃项目之前使用的节点自动注册方式改为更偏标准的节点注册方式 (尝试提高兼容性)

## v1.1.0 Major Updates

- No changes to node functionality in this update

### 1. 📝 Changed version number to `1.1.0`
- In the future, the first two digits of the version number will indicate major feature updates (new nodes or enhanced node functionality), and the last digit will indicate minor updates (generally bug fixes)

### 2. 🪛 Changed node registration method
- Abandoned the previous automatic node registration method in favor of a more standard node registration approach (attempting to improve compatibility)

---

## v1.0.3 主要更新

### 1. ⭐ 新增 `XAudioSave` (音频保存节点)
- 无损 16位 WAV
- 多种采样率 (44.1kHz, 48kHz, 96kHz, 192kHz)
- 音量标准化 (使用LUFS响度标准)
- 音量峰值限制 (Simple Peak, True Peak)

### 2. 🛠️ 增强 `XMath`
- 添加高优先级并支持接收整数和浮点数的 输入A/B 以及对应的 开关按钮
- 添加 交换A/B数值 开关按钮

### 3. 🛠️ 增强 `XStringGroup`
- 添加`无`, `逗号+空格`, `句号+空格`三种分隔方式, 并调整分隔方式默认为`无`

### 4. 🪛 修改 `XVideoSave`
- FFmpeg对音频流不再转码而是改为直接复制接收到的音频流, 以兼容`XAudioSave`输出的高品质WAV音频合并到视频中

## v1.0.3 Major Updates

### 1. ⭐ Added `XAudioSave` (Audio Save Node)
- Lossless 16-bit WAV
- Multiple sample rates (44.1kHz, 48kHz, 96kHz, 192kHz)
- Volume normalization (using LUFS loudness standard)
- Volume peak limiting (Simple Peak, True Peak)

### 2. 🛠️ Enhanced `XMath`
- Added high-priority Input A/B that supports both integers and floats with corresponding toggle buttons
- Added Swap A/B Values toggle button

### 3. 🛠️ Enhanced `XStringGroup`
- Added three separator options: `None`, `Comma + Space`, `Period + Space`, and changed default separator to `None`

### 4. 🪛 Modified `XVideoSave`
- FFmpeg now directly copies received audio streams instead of transcoding to better support merging high-quality WAV audio from `XAudioSave` into videos

---

## v1.0.2 主要更新

### 1. ⭐ 新增 `XStringGroup` (字符串组合节点)
- 5个多行字符串输入框
- 支持多种分隔方式的自定义分隔
- 提供字符串的多种输出端口 (带自定义分隔的全部字符串, 选择的字符串, 单独的1-5字符串)

## v1.0.2 Major Updates

### 1. ⭐ Added `XStringGroup` (String Group Node)
- 5 multi-line string input fields
- Supports custom separators with multiple separator options
- Provides multiple string output ports (all strings with custom separator, selected string, individual strings 1-5)
