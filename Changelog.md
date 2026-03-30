# 更新日志 | Changelog

## 🎉 v2.0.0
<details>

> [!NOTE]
> 如果在任何一次更新中我修改 (调整) 了节点的输入/输出端口和设置参数导致您的工作流需要修复 (重新加载) 这些节点，我很抱歉🥺
> - 通常来说做出这些修改 (调整) 可能是因为节点功能改变 (新增或删减)，亦或者是原先使用的名称信息在后续我重新审查后认为不够直观或不符合规范
> - 虽然新增功能也可能会导致节点界面改变而需要对节点进行修复 (重新加载)，但是节点的新增功能更新基本属于正面反馈，比单纯的修改更容易让人接受一些
> - 我也有自己长期稳定使用的工作流，所以我了解更新节点后需要消耗额外时间对工作流的老版本节点进行修复会让人不好受
>    - 我尽量在版本更新时让新增功能多于修改，希望更多的正面反馈能够抵消一些负面反馈😇

---

> [!IMPORTANT]
> 全新推出 XDataHub - 文本 & 图片 & 视频 & 音频 & Lora 数据中心
> - 可能是目前（相对）最好的数据文件发送方案

### 1. ⭐ 新增 `XDataHub` 数据中心
`ComfyUI Web Interface Extension - ComfyUI.Xz3r0.XDataHub`
- ComfyUI 网页界面顶部栏的执行按钮左侧，粉红色无限图标♾️按钮 点击即可打开 XDataHub 窗口
- 5 种数据可预览，以及支持发送到配套的专属节点中
    - 文本
        - `XStringGet`
    - 图片
        - `XImageGet`
    - 视频
        - `XVideoGet`
    - 音频
        - `XAudioGet`
    - Lora
        - `XLoraGet`
    - 文本数据预览使用序列号（基于其数据库）和颜色标注作为区分
- 3 种数据发送给节点的方式
    - 拖拽数据卡片（推荐）
    - 滑动发送
    - 多选发送
- 发送到节点 窗口中使用列表显示当前工作流中存在的对应专属节点
    - 节点标题名称
    - 使用节点 ID 和颜色作为唯一性区分
- 5 种数据对应的标签页
    - 历史
    - 图片
    - 视频
    - 音频
    - Lora
- 可通过以下节点配合使用将文本保存到数据库中，并在 XDataHub 的 历史 标签页中查看
    - `XSeed`
        - `xdata_seed`
    - `XAnyToString`
        - `xdata_string`
    - `XDataSave`
        - `xdata_input`
    - 支持收藏保存文本数据
- 图片 & 视频 & 音频 数据从以下 ComfyUI 文件夹中读取
    - `input` 文件夹（以及 子文件夹）
    - `output` 文件夹（以及 子文件夹）
    - 支持在这 2 个文件夹中创建的 文件或文件夹 软链接
        - 不支持直接自定义，仅支持软链接
    - 不支持的格式或编码的文件会在卡片显示提示
- Lora 数据从以下 ComfyUI 文件夹中读取
    - `loras` 文件夹 (`models\loras`)
    - 支持在这个文件夹中创建的 文件或文件夹 软链接
        - 不支持直接自定义，仅支持软链接
    - 不支持的格式或编码的文件会在卡片显示提示
- 图片 & 视频 & 音频 支持预览播放
- Lora 支持编辑信息
    - 备注
    - 模型强度 和 Clip 强度
    - 触发词
    - 支持从 Lora 文件同目录中已存在的 `metadata.json`（ComfyUI-Lora-Manager）导入触发词
- 数据库清除记录 和 删除数据库文件功能
    - 预设名称的数据库默认被列为 内置关键数据库
    - 关键数据库 提供勾选功能默认锁定无法选择，防止误操作
- XDataHub 配置文件（.json）和 数据库文件（.db）本地持久化保存
    - `custom_nodes\ComfyUI-Xz3r0-Nodes\XDataSaved`
- 在 XDataHub 控制面板 中提供一些功能设置
    - 支持 明亮模式 和 暗黑模式 主题配色
    - 切换（窗口打开或关闭）快捷键
        - 默认：`Alt + X`
    - 卡片大小
    - 显示文件名
        - 关闭时卡片不会显示文件名部分
    - 卡片标签显示切换
    - 媒体文件播放相关设置
    - 将 Lora 数据库保存到 `models/loras`
        - 勾选启用并保存后，Lora 的数据库文件将不再保存于 `custom_nodes\ComfyUI-Xz3r0-Nodes\XDataSaved`
        - 勾选启用并点击 保存 按钮时，现有的 Lora 数据库文件会自动移动到 `models/loras`
- 在 ComfyUI 设置面板 中提供一些功能设置
    - XDataHub 关闭按钮行为
        - 隐藏（推荐）
            - 仅隐藏窗口显示，窗口状态会保持，但会持续占用系统资源，重新打开速度快
        - 销毁
            - 完全关闭 XDataHub，窗口状态不会保持，关闭后不再占用系统资源，重新打开稍慢
    - XDataHub 默认打开布局
        - 默认
            - 视图居中位置，窗口大小为视图界面的 75%（不会小于 XDataHub 窗口最小尺寸）
        - 左靠边（推荐）
            - 最小窗口宽度在视图界面左侧贴边
        - 右靠边
            - 最小窗口宽度在视图界面右侧贴边
        - 最大化
    - 将 ♾️ XDataHub 置于 ComfyUI 界面组件之下
    - 启用 ♾️ XDataHub（按钮）
- 窗口右下角提供 语言 设置按钮
    - 支持 中文 和 英文
    - 首次使用（配置文件未存在）时窗口会弹出语言选择设置
- 自动轮询检测工作流是否正在执行以进入文件仅读取模式
    - 使用 ComfyUI 官方 API
    - 每 2 秒检测一次
- 媒体类 和 Lora 文件使用非明文的名称传递给节点

### 2. ⭐ 新增 `XDataSave` 文本数据（历史记录）保存节点
`♾️ Xz3r0/File-Processing`
- 接收独特 `xdata_*` 字符串类型数据
    - `xdata_seed`
    - `xdata_string`
- 保存类型（数据库文件名称）
    - `Custom`（默认，自定义名称.db）
    - `Seed`（预设名称：seed_data.db）
    - `String`（预设名称：string_data.db）
- 可选 自定义文件名（有长度限制）
    - 在保存类型为 Custom 时启用
    - 默认为空，如果默认选择了 Custom 未填写自定义文件名会报错
- 可选 额外头部信息（有长度限制）
    - 可自定义输入任意信息作为额外信息一同保存
    - 推荐将 提示词 链接 xdata_input 输入端口，然后将 种子值 转为字符串链接 额外头部信息
- 启用保存 开关按钮
    - 关闭时不会工作
- 数据库文件保存到 `custom_nodes\ComfyUI-Xz3r0-Nodes\XDataSaved`
- 文本保存到数据库文件中上限为 `500` 条历史记录
    - 超过 500 条后会开始覆盖最早的历史条目

### 3. ⭐ 新增 `XSeed` 种子值生成节点
- `xdata_seed` 输出端口
    - 可链接 XDataSave 节点的 xdata_input 输入端口将种子值以字符串进行传递
- 数值位数上限截断
    - 默认 20 位数值
- 不足位数上限时使用 0 补全
    - 一般情况用不上

### 4. 🛠️ 增强 `XAnyToString`
- 新增 `xdata_string` 输出端口
    - 可链接 XDataSave 节点的 xdata_input 输入端口将转换后的字符串内容进行传递

### 5. ⭐ 新增 `XStringGet` 与 XDataHub 配套的 文本数据接收节点
- 主要内容 和 头部信息 字符串输出端口
- 支持 XDataHub 的 3 种数据发送方式接收文本数据
- 可显示 主要内容文本 和 额外头部信息
- 使用节点 ID 和颜色作为唯一性区分
- 清空已接收数据按钮

### 6. ⭐ 新增 `XImageGet` 与 XDataHub 配套的 图片数据接收节点
- 图像 和 遮罩 输出端口
- 支持 XDataHub 的 3 种数据发送方式接收图片数据
- 可显示 图片内容 和 文件名
- 编辑遮罩 功能按钮
    - 使用 ComfyUI 官方原生的 遮罩编辑工具
- 输出占位黑图的开关按钮
    - 开启后，没有图片数据时使用 1x1 像素黑色图片作为输出
- 使用节点 ID 和颜色作为唯一性区分
- 清空已接收数据按钮

### 7. ⭐ 新增 `XVideoGet` 与 XDataHub 配套的 视频数据接收节点
- 视频 输出端口
- 支持 XDataHub 的 3 种数据发送方式接收视频数据
- 可显示 视频内容 和 文件名
- 使用节点 ID 和颜色作为唯一性区分
- 清空已接收数据按钮

### 8. ⭐ 新增 `XAudioGet` 与 XDataHub 配套的 音频数据接收节点
- 音频 输出端口
- 支持 XDataHub 的 3 种数据发送方式接收音频数据
- 可显示 音频内容 和 文件名
- 使用节点 ID 和颜色作为唯一性区分
- 清空已接收数据按钮

### 9. ⭐ 新增 `XLoraGet` 与 XDataHub 配套的 Lora 数据接收和加载节点
- 模型 输入输出端口
- Clip 输入输出端口（可选）
    - 未链接 Clip 时设置的强度值无效
- Lora 触发词 字符串输出端口
- Lora 加载信息 字符串输出端口
    - 显示实际加载的 Lora 以及设置的强度值
- 单独调整 Clip 强度 勾选开关
    - 勾选时在列表框中显示 Clip 强度输入框
    - 不勾选时 Clip 强度与 模型强度 保持一致
- Lora 加载列表框
    - 支持拖拽排序
    - 首/尾 位置锁定 按钮
    - Lora 勾选开关
        - 取消勾选后，仅在列表中显示而不会实际使用
    - Lora 文件名浮动窗
        - 显示 Lora 缩略图
        - 显示 Lora 文件名
        - 显示 Lora 备注（加载自 XDataHub 的 编辑 Lora 信息窗口中的 Lora 备注）
    - 模型强度（M）值输入框
        - （数值默认加载自 XDataHub 的 编辑 Lora 信息窗口中保存的 模型 强度数值）
    - Clip 强度（C）值输入框，默认隐藏
        - （数值默认加载自 XDataHub 的 编辑 Lora 信息窗口中保存的 CLIP 强度数值）
    - 触发词
        - 某些 Lora 需要用于激活效果的特定提示词
        - 可点击开启或关闭提示词


- 支持 XDataHub 的 3 种数据发送方式接收音频数据
- 可显示 音频内容 和 文件名
- 使用节点 ID 和颜色作为唯一性区分
- 清空已接收数据按钮


### 1. ⭐ 新增 `XMemoryCleanup` 内存显存资源占用清理节点
`♾️ Xz3r0/Workflow-Processing`
- 3 种由 Python 提供的资源占用清理选项 (开关按钮控制)
    - `cleanup_memory` 清理内存
    - `cleanup_node_usage` 清理节点占用（通常为最多占用）
    - `cleanup_vram` 清理显存
- 数据透传 (可选) 输入与输出端口
- 可独立执行
- 由于使用 Python 的清理方式（较安全），在工作流中使用时可能无法完全清理占用

### 2. ⭐ 新增 `XStringWrap` 自动带分隔的单字符串节点
`♾️ Xz3r0/Workflow-Processing`
- 自动应用分隔
    - 当文本输入框有内容 (或输入) 时，分隔会自动应用，反之如果没有内容时分隔也不会应用
- 提供分隔生效模式
    - `both` 都生效
    - `prefix-only` 仅前分隔
    - `suffix-only` 仅后分隔
- 基于 `XStringGroup` 的分隔方式
    - 提供前/后 2 个分隔
- 独立的节点控制输出开关
    - 关闭后节点不输出任何数据
- 适合在工作流中接收上游的 Lora 触发词作为输出

### 3. ⭐ 新增 `XAnyGate10` 10 路任意类型门控节点
`♾️ Xz3r0/Workflow-Processing`
- 10 路任意类型数据的 输入/输出 端口
    - `input_1 ~ 10` 输入
    - `output_1 ~ 10` 输出
- 每一路都有独立开关按钮，可单独控制是否输出，关闭时输出为空 (`None`)
    - `enable_1 ~ 10`
- 递归输出 端口和对应开关按钮（默认开启）
    - `recursive_output` 递归输出
    - 开启时按 `recursive_order` 递归顺序 返回第一个有效输出
    - 若全部端口无有效输出，则递归输出为空值 (`None`)
- 可自定义的 `recursive_order` 递归顺序
    - 使用 `-` 符号分隔的数字递归顺序列表，支持跳号和插队（例如：跳号 `1-3-5-7-9`，或插队 `5-9-3-7-1`）
        - 仅允许 `1 ~ 10` 数字，且不允许重复
- 此节点适合多路候选数据的优先级透传与分流控制
    - 减少使用麻烦的 ComfyUI 原生 `bypass` `unbypass` 绕过/不绕过 节点功能
    - 比如控制参考图是否输出到 `XKleinRefConditioning` 节点，或控制多个不同提示词按递归顺序输出

### 4. 🪛 调整 所有含有开关按钮的节点
- 统一开关按钮的值名称为 `Enabled` 开启 和 `Disabled` 关闭
    - 原来的 `true` 和 `false` 过于编程语言化

### 5. 🪛 调整 `XAnyToString` `XMath` `XWorkflowSave` 节点
- 调整输入端口的代码内部类型以提高兼容性，降低未来链接下游节点出错的可能性

### 6. 🛠️ 增强 `XResolution` 分辨率设置节点
- 新增 `image_or_mask` 图像或遮罩 (可选) 输入端口
- 基于输入 图像或遮罩 的分辨率来处理
- 图像或遮罩 的分辨率优先级高于 预设 和 `Custom` 自定义 分辨率

### 7. 🛠️ 增强 `XImageSave` 图像保存节点
- 新增支持 `mask` 遮罩保存
- 新增 `enable_preview` 启用预览 开关按钮
    - 按钮开启时能预览图片
    - 默认为 `Enabled` 开启

### 8. 🛠️ 增强和修改 `XImageResize` 图像缩放节点
- 新增 `resize_setting_in` 和 `resize_setting_out` 将所有缩放设置参数进行传递的 (可选) 输入/输出 端口
    - 可以将传递链中首个 `XImageResize` 的所有缩放设置参数继续向后传递至下游 `XImageResize` 节点
        - 在对于需要同时缩放多个不同图片且需要缩放参数相同时能让工作流保持快捷和简洁
- 新增 `use_passed_settings` 使用上游传递的缩放设置参数 开关按钮
    - 按钮关闭时不使用上游传递的缩放设置参数，继续使用自身设置参数
    - 默认为 `Enabled` 开启
- 新增 `output_resize_settings` 缩放设置参数输出传递 控制按钮
    - 按钮关闭时不再继续向下游的 `XImageResize` 节点传递缩放设置参数 (等同于断开输出端口链接，输出为空值 `None`)
    - 默认为 `Enabled` 开启
- 修改 `target_edge` 目标边长 数值的步进为 `1`
    - 现在可以精确设置目标边长的数值了

### 9. 🩹 修复 `XFitView` `XFloatingWindow` 网页扩展
- 修复扩展在 ComfyUI 页面设置 的对应设置选项没有正确显示 中/英 本地化的问题

</details>

---

## 🎉 v1.7.0
<details>

### 1. ⭐ 新增 `XKleinRefConditioning` FLUX.2-klein 参考条件自动处理节点
`♾️ Xz3r0/Workflow-Processing`
- FLUX.2-klein 工作流的参考条件链路节点，用来把多张参考图自动编码并同时追加到
正面条件与负面条件两条链路。
    - 适合需要在 文生图/单图编辑/多图编辑 模式来回切换的工作流场景
- 支持 4 张可选参考图
- 没有输入参考图时正面和负面条件会直接透传，即文生图模式

### 2. 🛠️ 增强 `XImageResize` 图像缩放节点
- 新增缩放条件选择
    - `Always` 总是缩放 (默认)
    - `Only if Larger` 仅当图像大于目标时缩放
    - `Only if Smaller` 仅当图像小于目标时缩放
- 缩放条件仅作用于 `Long` / `Short` / `Megapixels` 长边/短边/百万像素 模式
    - 当条件不满足时，会跳过缩放，但整除与偏移仍会继续执行

### 3. 🪛 调整 节点注册 (加载)
- 移除原先在 ComfyUI 启动时控制台的相关输出信息
- 现在只有额外依赖 (比如 FFmpeg) 在用户的电脑 (系统环境 PATH) 中检测不到时才会在 ComfyUI 控制台中提示

---

### 1. ⭐ Added `XKleinRefConditioning` FLUX.2-klein Reference Conditioning Auto-Processing Node
`♾️ Xz3r0/Workflow-Processing`
- A reference-conditioning chain node for FLUX.2-klein workflows, used to
  automatically encode multiple reference images and append them to both
  positive and negative conditioning chains at the same time.
    - Suitable for workflow scenarios that need to switch between text-to-image,
      single-image editing, and multi-image editing modes.
- Supports up to 4 optional reference images.
- If no reference image is provided, positive and negative conditioning are
  passed through directly (text-to-image mode).

### 2. 🛠️ Enhanced `XImageResize` Image Resize Node
- Added resize-condition options:
    - `Always`: Always resize (default)
    - `Only if Larger`: Resize only when the image is larger than the target
    - `Only if Smaller`: Resize only when the image is smaller than the target
- Resize conditions apply only to `Long` / `Short` / `Megapixels` modes.
    - When the condition is not met, resizing is skipped, but divisibility
      adjustment and offset are still applied.

### 3. 🪛 Adjusted Node Registration (Loading)
- Removed the related console output messages that previously appeared when
  ComfyUI starts.
- Now, messages are shown in the ComfyUI console only when extra dependencies
  (such as FFmpeg) are not detected on the user's system PATH.
</details>

---

## 🎉 v1.6.0
<details>

### ⚠️ 注意
- 本次 `1.6.0` 版本更新为本项目至今改动最多的更新，有些改动我可能记不起来加到更新日志中了
- 如果发现问题请进入 Github 主页的 Issues 提交反馈


### 1. ⭐ 新增 `XAnyToString` 任意数据转换为字符串节点
- 任意数据的输入与透传输出端口 和 转换为字符串的输出端口
- 我知道大多数人都在使用的那些知名自定义节点库几乎都有这个功能的节点，但是我的节点库没有，所以我就是要重新造轮子!😈
- `XMath` 节点的 输入 A/B 端口可以接收整数和浮点数并输出为整数和浮点数，加上这个新节点现在 整数/浮点数/字符串 这 3 个主要数据类型都有节点可以转换了😌

### 2. ⭐ 新增 `XMarkdownSave` Markdown 文件保存节点
- 将字符串内容保存为 Markdown 格式文件
- 头部\主要\尾部 字符串文本输入框
- 可以优先使用的可选 头部\主要\尾部 字符串输入端口
- 头部\主要\尾部 内容之间的分隔方式 (默认为：`none` 无换行):
    - `none` 无分隔，内容直接相连
    - `newline` 换行 (\n)
- 使用 `newline` 换行分隔时的换行次数 (默认为：`1` 换行 1 次)
- 字符串内容和文件保存路径的输出端口
- 支持日期标识符的文件名和子文件夹名

### 3. 🪛 调整 `XImageResize` 图像缩放节点
- 移除 长/短边 模式的百万像素限制保护功能
    - 经过再次思考，我认为这个限制保护功能在节点已经有了 `Megapixels` 百万像素缩放模式的情况下有些多余
- 将百万像素输入值范围改为 `0.1-100` (默认为：1.0)
- 将输出端口的名称改为 `Processed_Images` (处理后的图像)
- 节点遵循官方缩放节点风格，批处理时整批统一目标尺寸缩放

### 4. 🪛 调整 `XWorkflowSave` 工作流元数据 JSON 保存节点
- 移除 `FullWorkflow` 保存模式
    - 经过再次思考，我认为这个模式在节点已经有了数据更加完整的 `Prompt+FullWorkflow` 保存模式的情况下有些多余
- 将 `Standard` 保存模式名称改为 `Native` (原生)
    - 原生模式所保存 JSON 的元数据 (Prompt + Workflow 字段) 与官方的保存图片节点所保存到图片中的元数据一致 (`XImageSave` 和 `XLatentSave` 节点保存的元数据也是一致的)

### 5. 🛠️ 增强 `XAudioSave` 音频保存节点
- 新增 `FLAC` 无损文件保存格式
    - `FLAC` 格式支持工作流元数据嵌入，支持直接拖入 ComfyUI 网页界面读取工作流
        - `WAV` 格式并不支持工作流元数据嵌入，虽然两个音频格式都是无损类，但 `WAV` 格式是精度更高的 32 位浮点 所以音频质量会更高些 (虽然对于绝大多数人来说和 `FLAC` 没区别)
- 新增选择音频格式的下拉菜单:
    - `WAV`
    - `FLAC` (默认)

### 6. 🛠️ 增强 `XVideoSave` 视频保存节点
- 新增 `MP4` 文件保存格式
    - `MP4` 格式支持工作流元数据嵌入，支持直接拖入 ComfyUI 网页界面读取工作流
        - 虽然 `MP4` 支持拖入网页界面读取工作流，但是 `MP4` 格式对无损和音频合并的兼容性没有 `MKV` 格式好
        - 虽然 `MKV` 是无损和音频合并兼容性最佳的格式，但是 ComfyUI 网页界面不支持读取嵌入到 `MKV` 的工作流元数据，所以也无法拖入到 ComfyUI 网页界面加载工作流
- 新增选择音频格式的下拉菜单:
    - `MKV`
    - `MP4` (默认)
        - 如果因为 `MP4` 的兼容性遇到报错可以选择 `MKV` (但是就不支持加载工作流了。无论选什么格式都有问题，头痛😕)

### 7. 🛠️ 增强 `XMetadataWorkflow` 工作流元数据可视化查看网页工具
- 将原先工具内部解析多种不同文件和不同元数据格式的单一实现方式，改为独立分开的元数据解析模式
    - 将元数据解析模式分开独立可以大幅降低以后的维护难度，但也会降低对使用者的易用性，因为不再是原来那样全自动了.
- 新增位于网页工具视图顶部的元数据解析模式选择按钮 (默认为：`Native` 原生模式)
    - `📋 Native` 原生 模式，仅基于元数据中的 Workflow 字段数据进行解析
    - `🔗 Native (Merged)` 原生合并 模式，基于元数据中的 Prompt 和 Workflow 双字段进行合并解析
    - `🔗 P+FW` Prompt 和 Full Workflow 模式，基于元数据中的 Prompt 和 Full Workflow 双字段进行合并解析
        - 这个模式专门用于解析 `XWorkflowSave` 节点保存模式 `Prompt+FullWorkflow` 的 JSON
- 新增 `💾 Convert XWorkflowSave JSON` 转换 JSON 功能，用于转换 `XWorkflowSave` 所保存的 JSON 数据可以被 ComfyUI 网页界面加载的格式
    - 节点保存的 JSON 数据有着嵌套所以无法被 ComfyUI 网页界面直接加载，数据的嵌套是为了可以让网页工具在解析时可以分清楚数据中哪个部分属于 Prompt 字段以及哪个部分属于 (Full)Workflow, 这个转换功能会删除数据中的嵌套
    - 需要注意，使用转换功能删除嵌套后的 JSON 就只能使用 `Native` 原生模式解析了
- 新增 🔄️ 重置网页按钮
    - 按钮位于网页工具视图右上角

### 8. 🛠️ 增强 `XFitView` 网页扩展
- 适应视图支持子图 (Subgraph) 页面
    - ComfyUI 设置页面中已新增工作流和子图分别在 进入/退出 时的适应视图设置选项

### 9. 🛠️ 增强 `XLatentSave` 和 `XLatentLoad` Latnet 处理节点
- 代码内部添加 `Latent` 数据基础验证功能，以验证获取或加载的 Latent 是否符合 ComfyUI 规范
    - Latent 基础验证：
        - 类型验证 - 必须是字典 (dict)
        - 键验证 - 必须包含 "samples" 键
        - 张量验证 - samples 必须是 torch.Tensor
        - 维度验证 - samples 必须是 4D [B,C,H,W] 或 5D [B,C,T,H,W]
    - 兼容：图像、音频、3D、视频、Inpaint、批量处理等所有 ComfyUI 标准 4D 或 5D 的 Latent 类型
- `XLatentSave` 和 `XLatentLoad` 在获取 Latent 并处理时，不会验证 Latent 可能带有的额外可选键是否符合规范，例如:
    - noise_mask
    - batch_index
    - type
- 额外的可选键并不是必须数据，无论是基础数据还是可选数据都是上游生成 Latent 的节点负责的，如果生成的 Latent 不符合规范，这属于是上游节点的问题，并不是 `XLatentSave` 和 `XLatentLoad` 的责任

### 10. 🛠️增强和调整 所有节点和网页扩展
- 所有节点的代码规范迁移至 V3 API
    - 不会影响节点原本的功能，除非迁移的过程中搞错了什么
- 所有节点和网页扩展进行了代码优化和修复 Bug (然后引入新的未知 Bug🤣)

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
- 节点将在保持图像原始宽高比不变的情况下，提供 4 种缩放基准模式进行图像缩放 (默认为：`Long` 长边)
    - `edge_mode` (下拉选择): 缩放基准
        - `Long`: 以长边为基准（横屏的宽，竖屏的高）
        - `Short`: 以短边为基准（横屏的高，竖屏的宽）
        - `Megapixels`: 以百万像素为基准（忽略 目标边长 `target_edge`）
        - `Scale Multiplier`: 以缩放倍率为基准（忽略 目标边长 `target_edge`）
- 使用 `Long` 与 `Short` 长边/短边 模式时，可设置百万像素值进行分辨率限制以保持图像不会超过目标百万像素值。如果需要图像完全按照长/短边进行缩放，记得保持设置百万像素目标值 `Megapixels` 为：`0.0`
- 提供与 ComfyUI 官方节点相同的 5 种图像缩放的插值算法
- 图像分辨率的整除限制功能，以支持一些特殊模型对分辨率的整数要求
    - `divisible_mode` (下拉选择): 取整方式（默认：`Disabled`）
        - `Disabled`: 禁用整除调整
        - `Nearest`: 取最接近的倍数
        - `Up`: 向上取整
        - `Down`: 向下取整
- 分辨率偏移功能，可以对最终分辨率的 宽和高 分别进行额外的增减

### 2. 🛠️ 增强 `XResolution` 节点
- 分辨率的整除限制功能，以支持一些特殊模型对分辨率的整数要求
    - `divisible_mode` (下拉选择): 取整方式（默认：`Disabled`）
        - `Disabled`: 禁用整除调整
        - `Nearest`: 取最接近的倍数
        - `Up`: 向上取整
        - `Down`: 向下取整
- 分辨率偏移功能，可以对最终分辨率的 宽和高 分别进行额外的增减


`碎碎念`:
    图像缩放节点其实在最开始新增分辨率节点的时候我就想要一起做了，但是当时不知道什么原因我给忘了，并且这段时间我都没有更新自己的图像相关的工作流，所以直到现在我才想起来😅
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
- 从 ComfyUI 网页界面直接捕获完整工作流元数据
- `XWorkflowSave` 节点会自动调用此网页扩展

### 2. ⭐ 新增 `xworkflowsave_api` 自定义 API (*xworkflowsave_api.py*)
- 将 `XWorkflowSave_Extension` 网页扩展捕获的完整工作流元数据通过 API 传递给 `XWorkflowSave` 节点使用
- `XWorkflowSave` 节点会自动调用此 API

### 3. ⭐ 新增 `XFitView` 网页扩展 (*XFitView.js*)
- 打开 ComfyUI 网页界面或载入新工作流时，自动执行 ComfyUI 网页界面原生的`适应视图`功能
- 支持 3 种模式 (默认为：`never` 从不):
    - `first` (仅首次 / First time only) 模式：同一会话中相同工作流只适应一次（推荐，ComfyUI 网页界面刷新后重置）
    - `always` (每次都适应 / Every time) 模式：每次加载或切换工作流都适应视图
    - `never` (从不 / Never) 模式：禁用自动适应
- 通过 ComfyUI 设置页面更改设置
    - ComfyUI 网页界面 ➡️ 设置 (齿轮图标) ➡️ ♾️ Xz3r0 ➡️ XFitView
    - 支持中英本地化
<img src="https://raw.githubusercontent.com/Xz3r0-M/Xz3r0/refs/heads/main/XFitView.png" alt="XFitView" width="500">

### 4. 🛠️ 增强 `XWorkflowSave` 节点
- 新增 3 种 JSON 保存模式：Auto, Standard, FullWorkflow, Prompt+FullWorkflow (默认为：`Auto` )
- `Auto` 模式默认会优先使用 `Prompt+FullWorkflow` 模式，不可用时自动回退到 `Standard` 模式以保证兼容性
- `Standard` 模式使用 ComfyUI 标准后端 API 来获取工作流元数据 (prompt + 标准 workflow), 优点：ComfyUI 官方 API 支持，缺点：标准 workflow 工作流元数据不完整 (`note` 和 `markdown note` 节点不保存在元数据中❌)
- `FullWorkflow` 模式使用专门创建的网页扩展 `XWorkflowSave_Extension.js` 来捕获前端网页中更为完整的工作流元数据。优点：数据完整性与 ComfyUI 网页界面原生的保存工作流功能 `Save` 和 `Save As` 所一致 (`note` 和 `markdown note` 节点能够保存在元数据中✅), 缺点：依赖网页扩展并且非 ComfyUI 官方原生支持 (如果 ComfyUI 官方将来改动相关网页代码可能会导致出错)
<img src="https://raw.githubusercontent.com/Xz3r0-M/Xz3r0/refs/heads/main/savetip.png" alt="Button" width="200">

- `Prompt+FullWorkflow` (优先推荐) 模式使用 ComfyUI 标准后端 API 来获取 prompt 字段元数据，以及使用 `XWorkflowSave_Extension.js` 网页扩展来捕获前端网页中完整的工作流元数据，优点：所有模式中最为完整的工作流元数据，缺点：依赖网页扩展并且非 ComfyUI 官方原生支持
- 新增 `工作流信息` 字符串输出端口，可以检查保存信息

### 5. 🛠️ 增强 `XMetadataWorkflow` 网页工具
- 支持完整工作流数据的 JSON:
    - ✅ ComfyUI 网页界面原生的保存工作流功能 `Save` 和 `Save As` 所保存的 JSON (自动保存在 ComfyUI 目录下 `user\default\workflows`)
    - ✅ `XWorkflowSave` 节点的 `FullWorkflow` 模式保存的 JSON
    - ✅ `XWorkflowSave` 节点的 `Prompt+FullWorkflow` 模式保存的 JSON (推荐，合并得到最为完整的工作流元数据可视化)
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
- 优化和修复一些 BUG

### 6. 🛠️ 增强 `♾️ XFloatingWindow` 浮动窗口
- 新增 窗口透明度功能滑动条 (标题栏)
- 新增 窗口最大化和复原按钮 `↕️` (标题栏)
- 新增 窗口四周拉伸和限制尺寸功能
- 新增 `Alt + 鼠标左键` 可直接拖动浮动窗口
- 优化和修复一些 BUG
- 支持中英本地化

### 注意：
- `XMetadataWorkflow` 网页工具对于使用自行创建前端界面的第三方自定义节点是不兼容的 (网页工具只会显示存在于元数据中的内容)
- 从 `v1.3.0` 到 `v1.4.0` 新增的 (代码) 功能和节点以及工具我没有做完整测试，代码很可能有问题，但我需要缓一缓 (i need a doctor, call me a doctor😇)

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
- 将 ComfyUI 工作流元数据保存为 JSON 文件 (适配 `XMetadataWorkflow`)
- 同时保存 prompt 和 workflow 字段的工作流元数据
- ComfyUI 的网页导出功能的 JSON 文件只有 workflow 字段而缺少 prompt 字段，workflow 字段的元数据中只有节点的参数值缺失了参数名，这是制作这个节点的原因
- `XAudioSave` 和 `XVideoSave` 在保存文件时并没有嵌入工作流元数据，推荐配合这个新节点

### 2. ⭐ 新增 `XMetadataWorkflow` (简易的工作流元数据可视化查看工具)
- 读取文件的 prompt 字段工作流元数据进行可视化查看数据，可以在缺失节点或不使用 ComfyUI 的情况下更好的查看工作流中绝大部分节点的参数数据，有一些节点和数据没有保存在 prompt 字段就不会显示
- 支持加载多种文件格式：PNG 图像，Latent 文件 (`XLatentSave`), JSON 工作流文件 (`XWorkflowSave` 生成的带有 prompt 字段的 JSON)
- 在 ComfyUI 页面中点击顶部菜单栏的 ♾️ 按钮打开浮动窗口，或使用浏览器打开`web\XMetadataWorkflow.html`独立使用
- 中英双语
- 暗黑和明亮界面
- 这是一个简易且粗糙的网页工具，使用时可能会遇到很多 BUG😜

### 3. ⭐ 新增 `XDateTimeString` 日期时间标识符字符串节点
- 使用日期时间标识符获取时间然后输出为字符串
- 可以提供给本身不支持日期时间字符串的节点用作文件名称或其他需要获取时间的文字内容

### 4. 🛠️ 为 `XImageSave` 和 `XAudioSave` 以及 `XVideoSave` 节点添加进度条
- 这 3 个节点处理文件时可能花费时间较长，为它们添加进度条后，不再是原来那样运行时看起来卡住了

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
- 将节点原先的音频音量标准化和峰值限制处理方式转为使用 FFmpeg (loudnorm 滤镜), 以提高对多声道 (比如 5.1 和 7.1) 音频的兼容性，原先所使用的依赖 `pyloudnorm` 也不再需要了，目前项目只需要安装 `ffmpeg-python` 这一个依赖以及在本机安装 FFmpeg (太棒了😌)
- FFmpeg 的处理所需时间会比之前的方式慢 (需要 2 次处理 Two-pass), 但是对目标值会更精准
- 音频文件从原先的 16 位 WAV(PCM 16-bit) 提升为更高质量的 32 位浮点 WAV(PCM 32-bit float), 但是文件也相应的更大了 (向您的硬盘致敬🫡)
- 移除了原先的简单限制 (Simple Peak) 模式，现在改为选择是否开启 `峰值限制`(True Peak), 默认为：`true`(开启)
- 新增压缩器 (acompressor 滤镜) 和开关按钮，压缩器可以选择三种压缩预设：快速/平衡/缓慢，压缩器开关默认为：`false`(关闭)
- 新增自定义压缩器的压缩比和开关按钮，当开启时自定义的压缩比值会替代压缩预设所使用的压缩比值
- LUFS 目标值改为：`-14.1`, 峰值限制目标值改为：`-1.1`（增加 0.1 是因为有些情况下 loudnorm 滤镜处理后的音频会有偏差）

`碎碎念`:
    不再使用 `pyloudnorm` 是因为我测试发现对多声道音频会报错，尝试修复无果所以换成了 FFmpeg, 但 FFmpeg 并不是没有问题的，实际上 loudnorm 滤镜 本身对一些参数有 (莫名其妙的) 硬绑定，导致无法完全符合我的 (传统音频插件处理流程) 想法，来来回回好几天尝试不同方案和解决奇怪的 BUG, 我在这个节点上花了 1 亿 Tokens, 是的，就是 1 亿，谢谢你 FFmpeg🫠

### 2. 🧬 规范化所有节点的代码
- 呃，真的规范了吗...?

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
- 未来版本号的前两位数字表示主要功能更新 (新增节点 或 增强节点功能), 最后一位数字表示次要更新 (一般为修复 BUG)

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
- 无损 16 位 WAV
- 多种采样率 (44.1kHz, 48kHz, 96kHz, 192kHz)
- 音量标准化 (使用 LUFS 响度标准)
- 音量峰值限制 (Simple Peak, True Peak)

### 2. 🛠️ 增强 `XMath`
- 添加高优先级并支持接收整数和浮点数的 输入 A/B 以及对应的 开关按钮
- 添加 交换 A/B 数值 开关按钮

### 3. 🛠️ 增强 `XStringGroup`
- 添加`无`, `逗号 + 空格`, `句号 + 空格`三种分隔方式，并调整分隔方式默认为`无`

### 4. 🪛 修改 `XVideoSave`
- FFmpeg 对音频流不再转码而是改为直接复制接收到的音频流，以兼容`XAudioSave`输出的高品质 WAV 音频合并到视频中

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
- 5 个多行字符串输入框
- 支持多种分隔方式的自定义分隔
- 提供字符串的多种输出端口 (带自定义分隔的全部字符串，选择的字符串，单独的 1-5 字符串)

---

### 1. ⭐ Added `XStringGroup` (String Group Node)
- 5 multi-line string input fields
- Supports custom separators with multiple separator options
- Provides multiple string output ports (all strings with custom separator, selected string, individual strings 1-5)
</details>
