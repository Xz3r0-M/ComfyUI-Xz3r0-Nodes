# 更新日志 | Changelog

## 🎉 v1.6.0
<details>

### ⚠️ 注意
- 本次 `1.6.0` 版本更新为本项目至今改动最多的更新, 有些改动我可能记不起来加到更新日志中了
- 如果发现问题请进入 Github 主页的 Issues 提交反馈


### 1. ⭐ 新增 `XAnyToString` 任意数据转换为字符串节点
- 任意数据的输入与透传输出端口 和 转换为字符串的输出端口
- 我知道大多数人都在使用的那些知名自定义节点库几乎都有这个功能的节点, 但是我的节点库没有, 所以我就是要重新造轮子!😈
- `XMath` 节点的 输入 A/B 端口可以接收整数和浮点数并输出为整数和浮点数, 加上这个新节点现在 整数/浮点数/字符串 这3个主要数据类型都有节点可以转换了😌

### 2. ⭐ 新增 `XMarkdownSave` Markdown 文件保存节点
- 将字符串内容保存为 Markdown 格式文件
- 头部\主要\尾部 字符串文本输入框
- 可以优先使用的可选 头部\主要\尾部 字符串输入端口
- 头部\主要\尾部 内容之间的分隔方式 (默认为: `none` 无换行):
    - `none` 无分隔, 内容直接相连
    - `newline` 换行 (\n)
- 使用 `newline` 换行分隔时的换行次数 (默认为: `1` 换行1次)
- 字符串内容和文件保存路径的输出端口
- 支持日期标识符的文件名和子文件夹名

### 3. 🪛 调整 `XImageResize` 图像缩放节点
- 移除 长/短边 模式的百万像素限制保护功能
    - 经过再次思考, 我认为这个限制保护功能在节点已经有了 `Megapixels` 百万像素缩放模式的情况下有些多余
- 将百万像素输入值范围改为 `0.1-100` (默认为: 1.0)
- 将输出端口的名称改为 `Processed_Images` (处理后的图像)
- 节点遵循官方缩放节点风格, 批处理时整批统一目标尺寸缩放

### 4. 🪛 调整 `XWorkflowSave` 工作流元数据 JSON 保存节点
- 移除 `FullWorkflow` 保存模式
    - 经过再次思考, 我认为这个模式在节点已经有了数据更加完整的 `Prompt+FullWorkflow` 保存模式的情况下有些多余
- 将 `Standard` 保存模式名称改为 `Native` (原生)
    - 原生模式所保存 JSON 的元数据 (Prompt + Workflow 字段) 与官方的保存图片节点所保存到图片中的元数据一致 (`XImageSave` 和 `XLatentSave` 节点保存的元数据也是一致的)

### 5. 🛠️ 增强 `XAudioSave` 音频保存节点
- 新增 `FLAC` 无损文件保存格式
    - `FLAC` 格式支持工作流元数据嵌入, 支持直接拖入 ComfyUI 网页界面读取工作流
        - `WAV` 格式并不支持工作流元数据嵌入, 虽然两个音频格式都是无损类, 但 `WAV` 格式是精度更高的 32位浮点 所以音频质量会更高些 (虽然对于绝大多数人来说和 `FLAC` 没区别)
- 新增选择音频格式的下拉菜单:
    - `WAV`
    - `FLAC` (默认)

### 6. 🛠️ 增强 `XVideoSave` 视频保存节点
- 新增 `MP4` 文件保存格式
    - `MP4` 格式支持工作流元数据嵌入, 支持直接拖入 ComfyUI 网页界面读取工作流
        - 虽然 `MP4` 支持拖入网页界面读取工作流, 但是 `MP4` 格式对无损和音频合并的兼容性没有 `MKV` 格式好
        - 虽然 `MKV` 是无损和音频合并兼容性最佳的格式, 但是 ComfyUI 网页界面不支持读取嵌入到 `MKV` 的工作流元数据, 所以也无法拖入到 ComfyUI 网页界面加载工作流
- 新增选择音频格式的下拉菜单:
    - `MKV`
    - `MP4` (默认)
        - 如果因为 `MP4` 的兼容性遇到报错可以选择 `MKV` (但是就不支持加载工作流了. 无论选什么格式都有问题, 头痛😕)

### 7. 🛠️ 增强 `XMetadataWorkflow` 工作流元数据可视化查看网页工具
- 将原先工具内部解析多种不同文件和不同元数据格式的单一实现方式, 改为独立分开的元数据解析模式
    - 将元数据解析模式分开独立可以大幅降低以后的维护难度, 但也会降低对使用者的易用性, 因为不再是原来那样全自动了.
- 新增位于网页工具视图顶部的元数据解析模式选择按钮 (默认为: `Native` 原生模式)
    - `📋 Native` 原生 模式, 仅基于元数据中的 Workflow 字段数据进行解析
    - `🔗 Native (Merged)` 原生合并 模式, 基于元数据中的 Prompt 和 Workflow 双字段进行合并解析
    - `🔗 P+FW` Prompt 和 Full Workflow 模式, 基于元数据中的 Prompt 和 Full Workflow 双字段进行合并解析
        - 这个模式专门用于解析 `XWorkflowSave` 节点保存模式 `Prompt+FullWorkflow` 的 JSON
- 新增 `💾 Convert XWorkflowSave JSON` 转换 JSON 功能, 用于转换 `XWorkflowSave` 所保存的 JSON 数据可以被 ComfyUI 网页界面加载的格式
    - 节点保存的 JSON 数据有着嵌套所以无法被 ComfyUI 网页界面直接加载, 数据的嵌套是为了可以让网页工具在解析时可以分清楚数据中哪个部分属于 Prompt 字段以及哪个部分属于 (Full)Workflow, 这个转换功能会删除数据中的嵌套
    - 需要注意, 使用转换功能删除嵌套后的 JSON 就只能使用 `Native` 原生模式解析了
- 新增 🔄️ 重置网页按钮
    - 按钮位于网页工具视图右上角

### 8. 🛠️ 增强 `XFitView` 网页扩展
- 适应视图支持子图 (Subgraph) 页面
    - ComfyUI 设置页面中已新增工作流和子图分别在 进入/退出 时的适应视图设置选项

### 9. 🛠️ 增强 `XLatentSave` 和 `XLatentLoad` Latnet 处理节点
- 代码内部添加 `Latent` 数据基础验证功能, 以验证获取或加载的 Latent 是否符合 ComfyUI 规范
    - Latent 基础验证：
        - 类型验证 - 必须是字典 (dict)
        - 键验证 - 必须包含 "samples" 键
        - 张量验证 - samples 必须是 torch.Tensor
        - 维度验证 - samples 必须是 4D [B,C,H,W] 或 5D [B,C,T,H,W]
    - 兼容：图像、音频、3D、视频、Inpaint、批量处理等所有 ComfyUI 标准 4D 或 5D 的 Latent 类型
- `XLatentSave` 和 `XLatentLoad` 在获取 Latent 并处理时, 不会验证 Latent 可能带有的额外可选键是否符合规范, 例如:
    - noise_mask
    - batch_index
    - type
- 额外的可选键并不是必须数据, 无论是基础数据还是可选数据都是上游生成 Latent 的节点负责的, 如果生成的 Latent 不符合规范, 这属于是上游节点的问题, 并不是 `XLatentSave` 和 `XLatentLoad` 的责任

### 10. 🛠️增强和调整 所有节点和网页扩展
- 所有节点的代码规范迁移至 V3 API
    - 不会影响节点原本的功能, 除非迁移的过程中搞错了什么
- 所有节点和网页扩展进行了代码优化和修复Bug (然后引入新的未知Bug🤣)

---

### ⚠️ Notes
- This `1.6.0` update is the largest update in this project so far, and I
  may have forgotten to include some changes in this changelog.
- If you find any issues, please submit feedback in GitHub Issues.


### 1. ⭐ Added `XAnyToString` Any Data to String Node
- Includes an input port for any data with passthrough output, plus a
  dedicated string-converted output port.
- I know most major custom node packs already have this kind of node, but my
  pack did not, so I decided to reinvent the wheel 😈
- The `XMath` node's Input A/B ports can accept integers and floats and output
  integers and floats. With this new node, all three main data types
  (int/float/string) now have conversion support 😌

### 2. ⭐ Added `XMarkdownSave` Markdown File Save Node
- Saves string content as a Markdown file.
- Header/Main/Footer string text input boxes.
- Optional Header/Main/Footer string input ports with higher priority.
- Separator mode between Header/Main/Footer content (default: `none`):
    - `none`: No separator, content is directly concatenated.
    - `newline`: New line (`\n`).
- Number of line breaks when using `newline` (default: `1`).
- Output ports for string content and file save path.
- Supports date identifiers in file names and subfolder names.

### 3. 🪛 Adjusted `XImageResize` Image Resize Node
- Removed megapixel protection limit in Long/Short edge modes.
    - After reconsideration, this felt redundant because the node already has
      a dedicated `Megapixels` mode.
- Changed megapixels input range to `0.1-100` (default: 1.0).
- Renamed output port to `Processed_Images`.
- The node now follows the official resize-node behavior:
  in batch mode, the whole batch is resized to one shared target resolution.

### 4. 🪛 Adjusted `XWorkflowSave` Workflow Metadata JSON Save Node
- Removed `FullWorkflow` save mode.
    - After reconsideration, this felt redundant because
      `Prompt+FullWorkflow` already provides more complete data.
- Renamed `Standard` save mode to `Native`.
    - Metadata saved in Native mode (`Prompt` + `Workflow`) is consistent with
      metadata saved into images by ComfyUI official save-image behavior
      (also consistent with metadata saved by `XImageSave` and
      `XLatentSave`).

### 5. 🛠️ Enhanced `XAudioSave` Audio Save Node
- Added `FLAC` lossless save format.
    - `FLAC` supports embedded workflow metadata and can be dragged directly
      into the ComfyUI web UI to load workflows.
        - `WAV` does not support embedded workflow metadata. Although both are
          lossless formats, `WAV` uses higher-precision 32-bit float, so audio
          quality can be slightly higher (though for most users there's no
          practical difference from `FLAC`).
- Added an audio format dropdown:
    - `WAV`
    - `FLAC` (default)

### 6. 🛠️ Enhanced `XVideoSave` Video Save Node
- Added `MP4` save format.
    - `MP4` supports embedded workflow metadata and can be dragged directly
      into the ComfyUI web UI to load workflows.
        - Even though `MP4` supports drag-and-load workflows in the web UI,
          its compatibility for lossless mode and audio merge is not as good
          as `MKV`.
        - `MKV` has better compatibility for lossless mode and audio merge,
          but the ComfyUI web UI cannot read workflow metadata embedded in
          `MKV`, so you cannot drag `MKV` back into the UI to load workflows.
- Added a video format dropdown:
    - `MKV`
    - `MP4` (default)
        - If `MP4` compatibility causes errors, switch to `MKV` (but workflow
          loading from drag-and-drop will not be available).

### 7. 🛠️ Enhanced `XMetadataWorkflow` Workflow Metadata Visualization Web Tool
- Reworked metadata parsing from one mixed parser into separate parser modes
  for different file types and metadata structures.
    - This greatly reduces future maintenance cost, but is less user-friendly
      than the previous fully automatic behavior.
- Added metadata parse-mode buttons at the top of the web tool
  (default: `Native`):
    - `📋 Native`: Parses only the `Workflow` field.
    - `🔗 Native (Merged)`: Merges and parses both `Prompt` and `Workflow`.
    - `🔗 P+FW`: Merges and parses both `Prompt` and `Full Workflow`.
        - This mode is specifically for JSON saved by `XWorkflowSave` with
          `Prompt+FullWorkflow`.
- Added `💾 Convert XWorkflowSave JSON` feature to convert JSON saved by
  `XWorkflowSave` into a format that can be loaded by the ComfyUI web UI.
    - The node-saved JSON uses nested structure, which the ComfyUI web UI
      cannot load directly. Nesting is used so the web tool can distinguish
      which parts belong to `Prompt` and which parts belong to
      `(Full)Workflow`. This conversion removes that nesting.
    - After conversion (nesting removed), the JSON can only be parsed with
      `Native` mode.
- Added a `🔄️ Reset Web` button.
    - Located in the top-right of the web tool view.

### 8. 🛠️ Enhanced `XFitView` Web Extension
- Fit View now supports Subgraph pages.
    - ComfyUI settings now include separate fit-view options for workflow and
      subgraph when entering/leaving.

### 9. 🛠️ Enhanced `XLatentSave` and `XLatentLoad` Latent Processing Nodes
- Added built-in basic `Latent` data validation to verify whether fetched or
  loaded Latent data follows ComfyUI standards:
    - Type validation: must be a dictionary (`dict`)
    - Key validation: must include `"samples"` key
    - Tensor validation: `samples` must be `torch.Tensor`
    - Dimension validation: `samples` must be 4D `[B,C,H,W]` or
      5D `[B,C,T,H,W]`
    - Compatibility: image, audio, 3D, video, inpaint, batch processing, and
      all standard ComfyUI 4D/5D Latent types
- `XLatentSave` and `XLatentLoad` do not validate whether optional extra keys
  in Latent are standard-compliant, such as:
    - `noise_mask`
    - `batch_index`
    - `type`
- Optional extra keys are not required data. Whether base data or optional
  data, responsibility belongs to upstream nodes that generate the Latent.
  If generated Latent is non-compliant, that is an upstream-node issue, not
  the responsibility of `XLatentSave`/`XLatentLoad`.

### 10. 🛠️ Enhanced and Adjusted All Nodes and Web Extensions
- Migrated all node code style to V3 API.
    - Original node functionality should remain unchanged unless something was
      broken during migration.
- Performed code optimization and bug fixes across all nodes and web
  extensions (and probably introduced some new unknown bugs 🤣)
</details>

---

## 🎉 v1.5.0
<details>

### 1. ⭐ 新增 `XImageResize` 图像缩放节点
- 节点将在保持图像原始宽高比不变的情况下, 提供4种缩放基准模式进行图像缩放 (默认为: `Long` 长边)
    - `edge_mode` (下拉选择): 缩放基准
        - `Long`: 以长边为基准（横屏的宽，竖屏的高）
        - `Short`: 以短边为基准（横屏的高，竖屏的宽）
        - `Megapixels`: 以百万像素为基准（忽略 目标边长 `target_edge` ）
        - `Scale Multiplier`: 以缩放倍率为基准（忽略 目标边长 `target_edge`）
- 使用 `Long` 与 `Short` 长边/短边 模式时, 可设置百万像素值进行分辨率限制以保持图像不会超过目标百万像素值. 如果需要图像完全按照长/短边进行缩放, 记得保持设置百万像素目标值 `Megapixels` 为: `0.0`
- 提供与 ComfyUI 官方节点相同的5种图像缩放的插值算法
- 图像分辨率的整除限制功能, 以支持一些特殊模型对分辨率的整数要求
    - `divisible_mode` (下拉选择): 取整方式（默认：`Disabled` ）
        - `Disabled`: 禁用整除调整
        - `Nearest`: 取最接近的倍数
        - `Up`: 向上取整
        - `Down`: 向下取整
- 分辨率偏移功能, 可以对最终分辨率的 宽和高 分别进行额外的增减

### 2. 🛠️ 增强 `XResolution` 节点
- 分辨率的整除限制功能, 以支持一些特殊模型对分辨率的整数要求
    - `divisible_mode` (下拉选择): 取整方式（默认：`Disabled` ）
        - `Disabled`: 禁用整除调整
        - `Nearest`: 取最接近的倍数
        - `Up`: 向上取整
        - `Down`: 向下取整
- 分辨率偏移功能, 可以对最终分辨率的 宽和高 分别进行额外的增减


`碎碎念`:
    图像缩放节点其实在最开始新增分辨率节点的时候我就想要一起做了, 但是当时不知道什么原因我给忘了, 并且这段时间我都没有更新自己的图像相关的工作流, 所以直到现在我才想起来😅
    呃...但我感觉还是有其他什么东西我也忘了没做🤔

---

### 1. ⭐ Added `XImageResize` Image Resize Node
- The node provides 4 scaling modes while maintaining the original aspect ratio of the image (default: `Long` long edge)
    - `edge_mode` (dropdown): Scaling reference
        - `Long`: Based on long edge (width for landscape, height for portrait)
        - `Short`: Based on short edge (height for landscape, width for portrait)
        - `Megapixels`: Based on megapixel count (ignores `target_edge`)
        - `Scale Multiplier`: Based on scale multiplier (ignores `target_edge`)
- When using `Long` or `Short` mode, you can set a megapixel value to limit the resolution to prevent the image from exceeding the target megapixel count. If you want the image to scale completely according to the long/short edge, remember to keep the `Megapixels` target value at: `0.0`
- Provides the same 5 image scaling interpolation algorithms as ComfyUI official nodes
- Image resolution divisibility constraint feature to support special models' integer requirements for resolution
    - `divisible_mode` (dropdown): Rounding method (default: `Disabled`)
        - `Disabled`: Disable divisibility adjustment
        - `Nearest`: Round to nearest multiple
        - `Up`: Round up
        - `Down`: Round down
- Resolution offset feature, allowing additional adjustments to the final width and height

### 2. 🛠️ Enhanced `XResolution` Node
- Image resolution divisibility constraint feature to support special models' integer requirements for resolution
    - `divisible_mode` (dropdown): Rounding method (default: `Disabled`)
        - `Disabled`: Disable divisibility adjustment
        - `Nearest`: Round to nearest multiple
        - `Up`: Round up
        - `Down`: Round down
- Resolution offset feature, allowing additional adjustments to the final width and height


`mutter`:
    Actually, I wanted to create the image resize node when I first added the resolution node, but for some reason I forgot about it. And I haven't been updating my image-related workflows during this period, so I only remembered it now😅
    Uh... but I feel like there might be something else I forgot to do🤔
</details>

---

## 🎉 v1.4.0
<details>

### 1. ⭐ 新增 `XWorkflowSave_Extension` 网页扩展 (*XWorkflowSave_Extension.js*)
- 从ComfyUI网页界面直接捕获完整工作流元数据
- `XWorkflowSave` 节点会自动调用此网页扩展

### 2. ⭐ 新增 `xworkflowsave_api` 自定义API (*xworkflowsave_api.py*)
- 将 `XWorkflowSave_Extension` 网页扩展捕获的完整工作流元数据通过API传递给 `XWorkflowSave` 节点使用
- `XWorkflowSave` 节点会自动调用此API

### 3. ⭐ 新增 `XFitView` 网页扩展 (*XFitView.js*)
- 打开ComfyUI网页界面或载入新工作流时，自动执行ComfyUI网页界面原生的`适应视图`功能
- 支持3种模式 (默认为: `never` 从不):
    - `first` (仅首次 / First time only) 模式: 同一会话中相同工作流只适应一次（推荐, ComfyUI网页界面刷新后重置）
    - `always` (每次都适应 / Every time) 模式: 每次加载或切换工作流都适应视图
    - `never` (从不 / Never) 模式: 禁用自动适应
- 通过ComfyUI设置页面更改设置
    - ComfyUI 网页界面 ➡️ 设置(齿轮图标) ➡️ ♾️ Xz3r0 ➡️ XFitView
    - 支持中英本地化
<img src="https://raw.githubusercontent.com/Xz3r0-M/Xz3r0/refs/heads/main/XFitView.png" alt="XFitView" width="500">

### 4. 🛠️ 增强 `XWorkflowSave` 节点
- 新增3种JSON保存模式: Auto, Standard, FullWorkflow, Prompt+FullWorkflow (默认为: `Auto` )
- `Auto` 模式默认会优先使用 `Prompt+FullWorkflow` 模式, 不可用时自动回退到 `Standard` 模式以保证兼容性
- `Standard` 模式使用ComfyUI标准后端API来获取工作流元数据 (prompt + 标准workflow), 优点: ComfyUI官方API支持, 缺点: 标准workflow工作流元数据不完整 (`note` 和 `markdown note` 节点不保存在元数据中❌)
- `FullWorkflow` 模式使用专门创建的网页扩展 `XWorkflowSave_Extension.js` 来捕获前端网页中更为完整的工作流元数据. 优点: 数据完整性与ComfyUI网页界面原生的保存工作流功能 `Save` 和 `Save As` 所一致 (`note` 和 `markdown note` 节点能够保存在元数据中✅), 缺点: 依赖网页扩展并且非ComfyUI官方原生支持 (如果ComfyUI官方将来改动相关网页代码可能会导致出错)
<img src="https://raw.githubusercontent.com/Xz3r0-M/Xz3r0/refs/heads/main/savetip.png" alt="Button" width="200">

- `Prompt+FullWorkflow` (优先推荐) 模式使用ComfyUI标准后端API来获取prompt字段元数据, 以及使用 `XWorkflowSave_Extension.js` 网页扩展来捕获前端网页中完整的工作流元数据, 优点: 所有模式中最为完整的工作流元数据, 缺点: 依赖网页扩展并且非ComfyUI官方原生支持
- 新增 `工作流信息` 字符串输出端口, 可以检查保存信息

### 5. 🛠️ 增强 `XMetadataWorkflow` 网页工具
- 支持完整工作流数据的JSON:
    - ✅ ComfyUI网页界面原生的保存工作流功能 `Save` 和 `Save As` 所保存的JSON (自动保存在ComfyUI目录下 `user\default\workflows`)
    - ✅ `XWorkflowSave` 节点的 `FullWorkflow` 模式保存的JSON
    - ✅ `XWorkflowSave` 节点的 `Prompt+FullWorkflow` 模式保存的JSON (推荐, 合并得到最为完整的工作流元数据可视化)
- 支持 `FullWorkflow` 元数据中的 `note` 和 `markdown note` 节点显示
- 为节点内的长内容添加滚动条
- 为节点内的超长内容添加虚拟滚动以提升网页浏览性能
- 新增 侧边栏的隐藏/展开功能按钮
- 新增 复制节点名称功能按钮 `📋` (节点窗口标题栏)
- 新增 `Ctrl + 鼠标左键` 框选多个节点并移动功能 (双击空白处 或 按 `ESC` 键取消框选)
- 新增节点窗口四周拉伸功能
- 新增节点连接线首尾的圆点
- 调整节点连接线位置为节点窗口的边框
- 修正一些之前在硬编码中还没有被本地化的文字
- 优化和修复一些BUG

### 6. 🛠️ 增强 `♾️ XFloatingWindow` 浮动窗口
- 新增 窗口透明度功能滑动条 (标题栏)
- 新增 窗口最大化和复原按钮 `↕️` (标题栏)
- 新增 窗口四周拉伸和限制尺寸功能
- 新增 `Alt + 鼠标左键` 可直接拖动浮动窗口
- 优化和修复一些BUG
- 支持中英本地化

### 注意:
- `XMetadataWorkflow` 网页工具对于使用自行创建前端界面的第三方自定义节点是不兼容的 (网页工具只会显示存在于元数据中的内容)
- 从 `v1.3.0` 到 `v1.4.0` 新增的 (代码) 功能和节点以及工具我没有做完整测试, 代码很可能有问题, 但我需要缓一缓 (i need a doctor, call me a doctor😇)

---

### 1. ⭐ Added `XWorkflowSave_Extension` Web Extension (*XWorkflowSave_Extension.js*)
- Captures complete workflow metadata directly from ComfyUI web interface
- `XWorkflowSave` node automatically calls this web extension

### 2. ⭐ Added `xworkflowsave_api` Custom API (*xworkflowsave_api.py*)
- Passes complete workflow metadata captured by `XWorkflowSave_Extension` web extension to `XWorkflowSave` node via API
- `XWorkflowSave` node automatically calls this API

### 3. ⭐ Added `XFitView` Web Extension (*XFitView.js*)
- Automatically executes ComfyUI's native `Fit View` function when opening ComfyUI web interface or loading new workflows
- Supports 3 modes (default: `never` Never):
    - `first` First Time Only (reset after page refresh): Fits only once per session for the same workflow (recommended, resets after ComfyUI page refresh)
    - `always` Every time: Fits view every time a workflow is loaded or switched
    - `never` Never: Disables auto-fit
- Change settings via ComfyUI settings page
    - ComfyUI Web Interface ➡️ Settings (gear icon) ➡️ ♾️ Xz3r0 ➡️ XFitView
    - Supports Chinese and English localization
<img src="https://raw.githubusercontent.com/Xz3r0-M/Xz3r0/refs/heads/main/XFitView.png" alt="XFitView" width="500">

### 4. 🛠️ Enhanced `XWorkflowSave` Node
- Added 3 JSON save modes: Auto, Standard, FullWorkflow, Prompt+FullWorkflow (default: `Auto`)
- `Auto` mode prioritizes `Prompt+FullWorkflow` mode, automatically falls back to `Standard` mode when unavailable to ensure compatibility
- `Standard` mode uses ComfyUI's standard backend API to get workflow metadata (prompt + standard workflow). Pros: ComfyUI official API support. Cons: Standard workflow metadata is incomplete (`note` and `markdown note` nodes are not saved in metadata ❌)
- `FullWorkflow` mode uses the specially created web extension `XWorkflowSave_Extension.js` to capture more complete workflow metadata from the frontend. Pros: Data completeness matches ComfyUI's native `Save` and `Save As` workflow functions (`note` and `markdown note` nodes can be saved in metadata ✅). Cons: Depends on web extension and is not officially supported by ComfyUI (may break if ComfyUI changes related web code in the future)
<img src="https://raw.githubusercontent.com/Xz3r0-M/Xz3r0/refs/heads/main/savetip.png" alt="Button" width="200">

- `Prompt+FullWorkflow` (Recommended) mode uses ComfyUI's standard backend API to get prompt field metadata, and uses `XWorkflowSave_Extension.js` web extension to capture complete workflow metadata from the frontend. Pros: Most complete workflow metadata of all modes. Cons: Depends on web extension and is not officially supported by ComfyUI
- Added `Workflow Info` string output port for checking save information

### 5. 🛠️ Enhanced `XMetadataWorkflow` Web Tool
- Supports JSON with complete workflow data:
    - ✅ JSON saved by ComfyUI's native `Save` and `Save As` workflow functions (automatically saved in `user\default\workflows` under ComfyUI directory)
    - ✅ JSON saved by `XWorkflowSave` node's `FullWorkflow` mode
    - ✅ JSON saved by `XWorkflowSave` node's `Prompt+FullWorkflow` mode (recommended, merges to get the most complete workflow metadata visualization)
- Supports display of `note` and `markdown note` nodes from `FullWorkflow` metadata
- Added scrollbars for long content within nodes
- Added virtual scrolling for extremely long content to improve web browsing performance
- Added sidebar hide/expand toggle button
- Added copy node name button `📋` (node window title bar)
- Added `Ctrl + Left mouse button` box selection for multiple nodes and move function (double-click blank area or press `ESC` to cancel selection)
- Added node window edge resizing function
- Added dots at the beginning and end of node connection lines
- Adjusted node connection line positions to node window borders
- Fixed some previously hardcoded text that wasn't localized
- Optimized and fixed some bugs

### 6. 🛠️ Enhanced `♾️ XFloatingWindow` Floating Window
- Added window transparency slider (title bar)
- Added window maximize and restore button `↕️` (title bar)
- Added window edge resizing and size limiting function
- Added `Alt + Left mouse button` to directly drag floating window
- Optimized and fixed some bugs
- Supports Chinese and English localization

### Notes:
- `XMetadataWorkflow` web tool is incompatible with third-party custom nodes that use their own frontend interfaces (the tool will only display content that exists in metadata)
- New features, nodes, and tools added from `v1.3.0` to `v1.4.0` have not been fully tested, code may have issues, but I need a break (i need a doctor, call me a doctor😇)
</details>

---

## 🎉 v1.3.0
<details>

### 1. ⭐ 新增 `XWorkflowSave` (工作流元数据 JSON 文件保存节点)
- 将ComfyUI工作流元数据保存为JSON文件 (适配 `XMetadataWorkflow`)
- 同时保存 prompt 和 workflow 字段的工作流元数据
- ComfyUI的网页导出功能的JSON文件只有 workflow 字段而缺少 prompt 字段, workflow 字段的元数据中只有节点的参数值缺失了参数名, 这是制作这个节点的原因
- `XAudioSave` 和 `XVideoSave` 在保存文件时并没有嵌入工作流元数据, 推荐配合这个新节点

### 2. ⭐ 新增 `XMetadataWorkflow` (简易的工作流元数据可视化查看工具)
- 读取文件的 prompt 字段工作流元数据进行可视化查看数据, 可以在缺失节点或不使用ComfyUI的情况下更好的查看工作流中绝大部分节点的参数数据, 有一些节点和数据没有保存在 prompt 字段就不会显示
- 支持加载多种文件格式: PNG图像, Latent文件 (`XLatentSave`), JSON工作流文件 (`XWorkflowSave` 生成的带有 prompt 字段的JSON)
- 在ComfyUI页面中点击顶部菜单栏的 ♾️ 按钮打开浮动窗口, 或使用浏览器打开`web\XMetadataWorkflow.html`独立使用
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

---

### 1. ⭐ Added `XWorkflowSave` (Workflow Metadata JSON File Save Node)
- Saves ComfyUI workflow metadata as JSON files (compatible with `XMetadataWorkflow`)
- Saves workflow metadata containing both prompt and workflow fields
- ComfyUI's web export function only includes the workflow field but lacks the prompt field, and the workflow field metadata only contains node parameter values without parameter names - this is why this node was created
- `XAudioSave` and `XVideoSave` do not embed workflow metadata when saving files, so using this new node is recommended

### 2. ⭐ Added `XMetadataWorkflow` (Simple Workflow Metadata Visualization Tool)
- Reads the prompt field workflow metadata from files for visual data viewing, allowing better viewing of most node parameter data in workflows when nodes are missing or ComfyUI is not being used; some nodes and data not saved in the prompt field will not be displayed
- Supports loading multiple file formats: PNG images, Latent files (`XLatentSave`), JSON workflow files (JSON with prompt field generated by `XWorkflowSave`)
- Click the ♾️ button in the top menu bar on the ComfyUI page to open the floating window, or use a browser to open `web\XMetadataWorkflow.html` for standalone use
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
</details>

---

## 🎉 v1.2.0
<details>

### 1. 🛠️ 增强 `XAudioSave`
- 将节点原先的音频音量标准化和峰值限制处理方式转为使用 FFmpeg (loudnorm 滤镜), 以提高对多声道(比如5.1和7.1)音频的兼容性, 原先所使用的依赖 `pyloudnorm` 也不再需要了, 目前项目只需要安装 `ffmpeg-python` 这一个依赖以及在本机安装 FFmpeg (太棒了😌)
- FFmpeg 的处理所需时间会比之前的方式慢 (需要2次处理 Two-pass), 但是对目标值会更精准
- 音频文件从原先的 16位WAV(PCM 16-bit) 提升为更高质量的 32位浮点WAV(PCM 32-bit float), 但是文件也相应的更大了 (向您的硬盘致敬🫡)
- 移除了原先的简单限制 (Simple Peak) 模式, 现在改为选择是否开启 `峰值限制`(True Peak), 默认为: `true`(开启)
- 新增压缩器 (acompressor 滤镜)和开关按钮, 压缩器可以选择三种压缩预设：快速/平衡/缓慢, 压缩器开关默认为: `false`(关闭)
- 新增自定义压缩器的压缩比和开关按钮, 当开启时自定义的压缩比值会替代压缩预设所使用的压缩比值
- LUFS目标值改为: `-14.1`, 峰值限制目标值改为: `-1.1` （增加0.1是因为有些情况下loudnorm 滤镜处理后的音频会有偏差）

`碎碎念`:
    不再使用 `pyloudnorm` 是因为我测试发现对多声道音频会报错, 尝试修复无果所以换成了 FFmpeg, 但 FFmpeg 并不是没有问题的, 实际上 loudnorm 滤镜 本身对一些参数有 (莫名其妙的) 硬绑定, 导致无法完全符合我的 (传统音频插件处理流程) 想法, 来来回回好几天尝试不同方案和解决奇怪的BUG, 我在这个节点上花了1亿Tokens, 是的, 就是1亿, 谢谢你 FFmpeg🫠

### 2. 🧬 规范化所有节点的代码
- 呃, 真的规范了吗...?

---

### 1. 🛠️ Enhanced `XAudioSave`
- Changed the node's audio volume normalization and peak limiting processing to use FFmpeg (loudnorm filter) to improve compatibility with multi-channel audio (e.g., 5.1 and 7.1). The previously used dependency `pyloudnorm` is no longer needed. Now the project only requires installing `ffmpeg-python` as a dependency and having FFmpeg installed locally (Awesome 😌)
- FFmpeg processing takes longer than the previous method (requires two-pass processing), but achieves more accurate target values
- Audio files upgraded from 16-bit WAV (PCM 16-bit) to higher quality 32-bit float WAV (PCM 32-bit float), but files are correspondingly larger (Salute to your hard drive 🫡)
- Removed the previous Simple Peak mode, now changed to a toggle for `Peak Limiting` (True Peak), default: `true` (enabled)
- Added compressor (acompressor filter) and toggle button. Compressor offers three compression presets: Fast/Balanced/Slow. Compressor toggle default: `false` (disabled)
- Added custom compressor ratio and toggle button. When enabled, custom ratio values override the compression preset's ratio
- LUFS target value changed to `-14.1`, peak limiting target value changed to `-1.1` (because in some cases audio processed by loudnorm filter has deviations)

`mutter`:
    Stopped using `pyloudnorm` because I found it errors with multi-channel audio during testing. Tried to fix it but failed, so switched to FFmpeg. However, FFmpeg is not without issues - actually the loudnorm filter has some (inexplicable) hard bindings on certain parameters, making it impossible to fully match my (traditional audio plugin processing workflow) ideas. Went back and forth for several days trying different solutions and solving weird bugs. I spent 100 million Tokens on this node. Yes, 100 million. Thank you FFmpeg 🫠

### 2. 🧬 Standardized code for all nodes
- Uh, did I really standardize it...?
</details>

---

## 🎉 v1.1.0
<details>

- 本次更新节点功能没有变化

### 1. 📝 将版本号改为`1.1.0`
- 未来版本号的前两位数字表示主要功能更新 (新增节点 或 增强节点功能), 最后一位数字表示次要更新 (一般为修复BUG)

### 2. 🪛 更改节点注册方式
- 放弃项目之前使用的节点自动注册方式改为更偏标准的节点注册方式 (尝试提高兼容性)

---

- No changes to node functionality in this update

### 1. 📝 Changed version number to `1.1.0`
- In the future, the first two digits of the version number will indicate major feature updates (new nodes or enhanced node functionality), and the last digit will indicate minor updates (generally bug fixes)

### 2. 🪛 Changed node registration method
- Abandoned the previous automatic node registration method in favor of a more standard node registration approach (attempting to improve compatibility)
</details>

---

## 🎉 v1.0.3
<details>

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

---

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
</details>

---

## 🎉 v1.0.2
<details>

### 1. ⭐ 新增 `XStringGroup` (字符串组合节点)
- 5个多行字符串输入框
- 支持多种分隔方式的自定义分隔
- 提供字符串的多种输出端口 (带自定义分隔的全部字符串, 选择的字符串, 单独的1-5字符串)

---

### 1. ⭐ Added `XStringGroup` (String Group Node)
- 5 multi-line string input fields
- Supports custom separators with multiple separator options
- Provides multiple string output ports (all strings with custom separator, selected string, individual strings 1-5)
</details>
