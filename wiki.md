## 🎁 节点的详细说明（推荐查看）
`xnode`

`Workflow-Processing`

<details>
<summary><strong> XAnyGate10 </strong> | 🚦 10 路任意类型门控</summary>

`♾️ Xz3r0/Workflow-Processing`

10 路任意类型数据门控节点，每一路独立开关控制，并提供可自定义顺序的递归输出端口。

**这个节点是做什么的**:
- 替代使用繁琐的 ComfyUI 原生 `bypass`/`unbypass` 功能，通过开关按钮直接控制每一路数据是否输出
- 适合多路候选数据的优先级透传与分流控制，例如：控制参考图是否输出到 `XKleinRefConditioning`，或按递归顺序从多个提示词中输出第一个有效值

**功能**:
- 10 路任意类型的独立输入/输出端口
  - `input_1 ~ input_10`
  - `output_1 ~ output_10`
- 每一路都有独立开关按钮 `enable_1 ~ enable_10`，关闭时对应输出为空值 (`None`)
- 递归输出端口 `recursive_output`，开启后按 `recursive_order` 指定顺序返回第一个有效输出
  - 如果所有通道均无有效输出，递归输出为空值 (`None`)
- 可自定义 `recursive_order` 递归顺序
  - 格式为 `-` 分隔的数字列表，仅允许 `1~10`，不允许重复
  - 支持跳号（例如：`1-3-5-7-9`）和插队（例如：`5-9-3-7-1`）

**输入**:
- `input_1 ~ input_10` (ANY, 可选): 各路任意类型输入
- `enable_1 ~ enable_10` (BOOLEAN): 各路输出开关（默认：`Enabled`）
- `enable_recursive` (BOOLEAN): 递归输出开关（默认：`Enabled`）
- `recursive_order` (STRING): 递归顺序列表（默认：`1-2-3-4-5-6-7-8-9-10`）

**输出**:
- `output_1 ~ output_10` (ANY): 各路原始数据输出（关闭时为 `None`）
- `recursive_output` (ANY): 按递归顺序找到的第一个有效输出（全部无效时为 `None`）

**使用示例**:
```
# 示例: 控制参考图是否传递
input_1 = 参考图A, enable_1 = Enabled
input_2 = 参考图B, enable_2 = Disabled
recursive_order = "1-2"

output_1 = 参考图A
output_2 = None
recursive_output = 参考图A（第一个有效值）
```
</details>

<details>
<summary><strong> XAnyToString </strong> | 🔤 任意数据转字符串</summary>

`♾️ Xz3r0/Workflow-Processing`

任意数据转字符串节点，用来把上游传来的各种数据转换成字符串，
同时保留原始数据继续往下传。

**这个节点是做什么的**:
- 有些节点只接受字符串，但上游给你的可能是数字、布尔值，
  或者其他类型的数据
- 这个节点会帮你把那些数据直接转成字符串，方便接到保存文本、
  拼接文本、写入 Markdown 等节点上
- 同时它还会把原始数据原样透传出去，这样你不需要为了转换字符串
  而中断原本的数据流

**功能**:
- 接收任意类型输入
- 使用 Python 的 `str()` 规则转换为字符串
- 同时输出原始输入数据
- 适合在工作流里做“数据转文本”的中转

**输入**:
- `anything` (ANY): 任意输入数据

**输出**:
- `anything` (ANY): 原始输入数据，原样透传
- `string` (STRING): 转换后的字符串结果
- `xdata_string` (xdata_string): 字符串 xdata 协议输出，可链接 `XDataSave` 节点的 `xdata_input` 端口将转换后的字符串内容保存到数据库

**使用示例**:
```
输入：
anything = 123

输出：
anything = 123
string = "123"
```

**适合什么时候用**:
- 把数字转成字符串后拿去保存到文本文件
- 把上游节点结果转成字符串后接到 `XStringGroup`
- 把任意数据转成字符串后接到 `XMarkdownSave`
- 把转换结果通过 `xdata_string` 接到 `XDataSave` 保存到历史数据库
</details>

<details>
<summary><strong> XDateTimeString </strong> | 📅 日期时间标识符字符串</summary>

`♾️ Xz3r0/Workflow-Processing`

日期时间字符串节点，生成包含日期时间标识符的格式化字符串

**功能**:
- 支持自定义格式模板
- 支持多种日期时间占位符 (%Y%, %m%, %d%, %H%, %M%, %S%)
- 支持添加前缀和后缀
- 实时生成当前日期时间字符串
- 用于链接给本身不支持日期标识符的节点作为文件名

**支持的占位符**:
- `%Y%` - 四位年份 (如：2026)
- `%m%` - 两位月份 (01-12)
- `%d%` - 两位日期 (01-31)
- `%H%` - 两位小时 (00-23)
- `%M%` - 两位分钟 (00-59)
- `%S%` - 两位秒数 (00-59)

**输入**:
- `prefix` (STRING): 前缀字符串，添加到日期时间之前
- `format_template` (STRING): 格式模板 (默认：`%Y%-%m%-%d%_%H%-%M%-%S%`)
- `suffix` (STRING): 后缀字符串，添加到日期时间之后

**输出**:
- `datetime_string` (STRING): 格式化后的日期时间字符串

**使用示例**:
```
prefix="Image_",
format_template="%Y%-%m%-%d%_%H%-%M%-%S%",
suffix="_v1"
输出："Image_2026-02-21_14-30-52_v1"
```
</details>

<details>
<summary><strong> XKleinRefConditioning </strong> | 🧠 FLUX.2-klein 参考条件链路合并</summary>

`♾️ Xz3r0/Workflow-Processing`

FLUX.2-klein 工作流的参考条件链路节点，用来把多张参考图自动编码并同时追加到
正面条件与负面条件两条链路。

**这个节点是做什么的**:
- 你不需要为参考图手动重复搭建多组 `VAE Encode + ReferenceLatent` 了
- 只要把参考图接进来，节点会自动按顺序处理并追加到正负条件
- 适合需要在 文生图/单图编辑/多图编辑 模式来回切换的工作流场景，保持工作流结构便捷和稳定
- 没有输入参考图时正面和负面条件会直接透传，即文生图模式

**功能**:
- 支持 `image_1` 到 `image_4` 四个可选参考图输入
- 只处理实际连接的图片输入口
- 每张图编码一次，同时追加到正面与负面条件
- 没有接参考图时，正负条件原样透传
- 缺少正面或负面条件时抛出英文错误提示

**输入**:
- `positive_conditioning` (CONDITIONING): 正面条件输入
- `negative_conditioning` (CONDITIONING): 负面条件输入
- `vae` (VAE): 用于把参考图编码为 latent 的 VAE
- `image_1` (IMAGE, 可选): 参考图 1
- `image_2` (IMAGE, 可选): 参考图 2
- `image_3` (IMAGE, 可选): 参考图 3
- `image_4` (IMAGE, 可选): 参考图 4

**输出**:
- `positive_conditioning` (CONDITIONING): 已追加参考信息的正面条件
- `negative_conditioning` (CONDITIONING): 已追加参考信息的负面条件

**多图传递逻辑**:
1. 按顺序检查 `image_1 -> image_2 -> image_3 -> image_4`
2. 对每张已连接图片执行一次 VAE 编码
3. 将该图片的 latent 同时追加到正面和负面条件链
4. 重复直到所有已连接图片处理完成

**使用示例**:
```
输入:
positive_conditioning = P
negative_conditioning = N
image_1, image_3 已连接（image_2, image_4 未连接）

输出:
positive_out = P + ref(image_1) + ref(image_3)
negative_out = N + ref(image_1) + ref(image_3)
```
</details>

<details>
<summary><strong> XMath </strong> | 🔢 数学运算</summary>

`♾️ Xz3r0/Workflow-Processing`

基础数学运算节点，支持双输出格式 (整数 + 浮点数)

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
</details>

<details>
<summary><strong> XMemoryCleanup </strong> | 🧹 内存/显存清理</summary>

`♾️ Xz3r0/Workflow-Processing`

内存与显存资源占用清理节点，提供三种可选清理动作，可独立执行或接入工作流透传数据。

**这个节点是做什么的**:
- 在工作流的指定位置手动触发 Python 级别的资源清理
- 支持清理内存（Python GC）、清理节点模型占用（卸载已加载模型）和清理显存缓存
- 由于使用 Python 提供的清理方式（相对安全），在工作流执行过程中可能无法完全清理所有占用

**功能**:
- 三种清理动作，均由独立开关按钮控制，默认全部关闭
  - `cleanup_memory`: 执行 Python 垃圾回收（`gc.collect`）
  - `cleanup_node_usage`: 卸载已加载模型并运行模型清理（通常为最大占用项）
  - `cleanup_vram`: 清空设备缓存（`soft_empty_cache`）
- 可选数据透传输入/输出端口（MatchType，自动保持类型一致）
- 可独立执行（不需要任何输入）

**输入**:
- `anything` (ANY, 可选): 透传输入，不处理数据，仅用于工作流连接
- `cleanup_memory` (BOOLEAN): 执行 Python GC（默认：`Disabled`）
- `cleanup_node_usage` (BOOLEAN): 卸载模型（默认：`Disabled`）
- `cleanup_vram` (BOOLEAN): 清理显存缓存（默认：`Disabled`）

**输出**:
- `anything` (ANY): 原始输入数据，原样透传
</details>

<details>
<summary><strong> XResolution </strong> | 📐 分辨率设置</summary>

`♾️ Xz3r0/Workflow-Processing`

分辨率设置节点，提供标准分辨率预设、自定义缩放和整除调整功能

**功能**:
- 标准分辨率预设 (16:9, 4:3, 1:1, 16:10, 21:9 等)
- 倍率缩放功能
- 宽高互换功能
- 整除调整功能 - 使分辨率可被指定整数整除（常用值：8、16、32、64）
- 分辨率偏移功能 - 在最终分辨率上添加偏移值（范围：-128 到 128）
- 参数验证 (最小 1×1)

**输入**:
- `preset` (下拉选择): 预设分辨率
- `width` (INT): 自定义宽度（仅在 preset 为 Custom 且未连接 `image_or_mask` 时生效）
- `height` (INT): 自定义高度（仅在 preset 为 Custom 且未连接 `image_or_mask` 时生效）
- `scale` (FLOAT): 缩放倍率
- `swap` (BOOLEAN): 是否交换宽高
- `divisible` (INT): 整除数（默认：16，范围 1-128）
- `divisible_mode` (下拉选择): 取整方式（默认：Disabled）
  - `Disabled`: 禁用整除调整
  - `Nearest`: 取最接近的倍数
  - `Up`: 向上取整
  - `Down`: 向下取整
- `width_offset` (INT): 宽度偏移（默认：0，范围 -128 到 128）
- `height_offset` (INT): 高度偏移（默认：0，范围 -128 到 128）
- `image_or_mask` (IMAGE/MASK, 可选): 图像或遮罩输入，连接后优先使用其分辨率作为基础宽高，优先级高于预设和自定义宽高

**取整方式说明**:
- `Disabled` - 禁用整除调整功能（默认）
- `Nearest` - 取最接近的倍数（余数 ≤ 除数 /2 时向下，否则向上）
- `Up` - 向上取整到下一个倍数
- `Down` - 向下取整到上一个倍数

**输出**:
- `width` (INT): 最终宽度
- `height` (INT): 最终高度

**使用示例**:
```
# 示例 1: 基础使用
preset="1920×1080 (16:9)", scale=1, swap=False
输出：width=1920, height=1080

# 示例 2: 启用整除调整（向上取整到 16 的倍数）
preset="1920×1080 (16:9)", divisible=16, divisible_mode="Up"
输出：width=1920, height=1088 (1080→1088)

# 示例 3: 禁用整除调整
preset="1920×1080 (16:9)", divisible=16, divisible_mode="Disabled"
输出：width=1920, height=1080 (保持原样)

# 示例 4: 带分辨率偏移（+1）
preset="1920×1080 (16:9)", width_offset=1, height_offset=1
输出：width=1921, height=1081

# 示例 5: 带分辨率偏移（-1）
preset="1024×1024 (1:1)", width_offset=-1, height_offset=-1
输出：width=1023, height=1023

# 示例 6: 整除调整 + 分辨率偏移
preset="1920×1080 (16:9)", divisible=16, divisible_mode="Up", width_offset=1, height_offset=1
输出：width=1921, height=1089 (1920x1088 + 偏移)
```
</details>

<details>
<summary><strong> XSeed </strong> | 🎲 种子值生成</summary>

`♾️ Xz3r0/Workflow-Processing`

种子值生成节点，使用原生 seed 输入控件，并提供位数截断和补零功能，以及 `xdata_seed` 协议输出端口用于接入数据保存流程。

**功能**:
- 使用 ComfyUI 原生 seed 控件（支持 control_after_generate）
- 数值位数上限截断（默认 20 位数值，超过时取低位截断）
- 可选补零功能：不足位数上限时使用 0 在末尾补全（通常用不上）
- `xdata_seed` 输出端口，可链接 `XDataSave` 节点的 `xdata_input` 端口将种子值保存到历史数据库

**输入**:
- `seed_value` (INT): 基础种子值（0 到 2^64-1，支持自动生成控制）
- `digits` (INT): 位数上限（1 到 20，默认 20）
- `pad_to_limit` (BOOLEAN): 不足位数时末尾补零（默认：`Disabled`）

**输出**:
- `seed_int` (INT): 经过截断/补零处理的最终种子整数
- `xdata_seed` (xdata_seed): 种子 xdata 协议输出，可链接 `XDataSave` 保存到数据库
</details>

<details>
<summary><strong> XStringGroup </strong> | 🔗 字符串组合</summary>

`♾️ Xz3r0/Workflow-Processing`

字符串组合节点，支持多行输入和自定义分隔符

**功能**:
- 支持最多 5 个多行字符串输入
- 每个字符串之间可选择不同的分隔方式 (无、换行、空格、逗号、逗号 + 空格、句号、句号 + 空格)
- 输出组合后的完整字符串
- 支持选择单个字符串输出 (1-5)
- 支持每个字符串的原始输出

**输入**:
- `select_string` (下拉选择): 选择要输出的字符串编号 (1-5)
- `string_1` (STRING, 多行): 第一个字符串
- `separation_method_1_2` (下拉选择): 字符串 1 和 2 之间的分隔方式
- `string_2` (STRING, 多行): 第二个字符串
- `separation_method_2_3` (下拉选择): 字符串 2 和 3 之间的分隔方式
- `string_3` (STRING, 多行): 第三个字符串
- `separation_method_3_4` (下拉选择): 字符串 3 和 4 之间的分隔方式
- `string_4` (STRING, 多行): 第四个字符串
- `separation_method_4_5` (下拉选择): 字符串 4 和 5 之间的分隔方式
- `string_5` (STRING, 多行): 第五个字符串

**分隔方式选项**:
- `none`: 无分隔
- `newline`: 换行符 (`\n`)
- `space`: 空格 (` `)
- `comma`: 逗号 (`,`)
- `comma_space`: 逗号 + 空格 (`, `)
- `period`: 句号 (`.`)
- `period_space`: 句号 + 空格 (`. `)

**输出**:
- `total_string` (STRING): 组合后的完整字符串 (带有分隔方式)
- `selected_string` (STRING): 由选择字符串栏所选择的输出
- `string_1` (STRING): 字符串 1 的原始输出
- `string_2` (STRING): 字符串 2 的原始输出
- `string_3` (STRING): 字符串 3 的原始输出
- `string_4` (STRING): 字符串 4 的原始输出
- `string_5` (STRING): 字符串 5 的原始输出

**使用场景**:
- 构建复杂提示词组合
- 生成多行文本描述
- 创建带格式化的文本输出
- 工作流中的文本处理和组合
</details>

<details>
<summary><strong> XStringWrap </strong> | 🎀 自动分隔包装字符串</summary>

`♾️ Xz3r0/Workflow-Processing`

自动带前后分隔符的单字符串节点，仅当文本有内容时才会应用分隔符，适合将上游传入的 Lora 触发词包装后输出。

**这个节点是做什么的**:
- 对输入文本按照所选分隔方式自动添加前缀和/或后缀分隔符
- 仅在文本有内容时才应用分隔符；文本为空时输出空字符串，分隔符不会添加
- 适合在工作流中接收 `XLoraGet` 的触发词输出后自动加上分隔，再接入提示词组合节点

**功能**:
- 前后分隔符与 `XStringGroup` 的分隔方式一致
  - 可选：`none`、`newline`、`space`、`comma`、`comma_space`、`period`、`period_space`
- 分隔生效模式：
  - `both`: 前后都生效
  - `prefix_only`: 仅前分隔生效
  - `suffix_only`: 仅后分隔生效
- 节点开关（`enabled`）：关闭时输出空字符串

**输入**:
- `enabled` (BOOLEAN): 节点开关（默认：`Enabled`）
- `apply_mode` (下拉选择): 分隔生效模式（默认：`both`）
- `prefix_separator` (下拉选择): 前分隔方式（默认：`none`）
- `text` (STRING, 多行): 要包装的主文本
- `suffix_separator` (下拉选择): 后分隔方式（默认：`none`）

**输出**:
- `wrapped_text` (STRING): 包装后的字符串结果

**使用示例**:
```
text = "masterpiece, best quality"
apply_mode = "both"
prefix_separator = "comma_space"
suffix_separator = "comma_space"

输出：", masterpiece, best quality, "
（文本为空时输出空字符串，不添加分隔符）
```
</details>

---
`File-Processing`

<details>
<summary><strong> XAudioGet </strong> | 🎵 音频数据接收</summary>

`♾️ Xz3r0/File-Processing`

与 XDataHub 配套的音频数据接收节点，接收从 XDataHub 发送的音频文件并输出为 AUDIO 类型。

**功能**:
- 接收 XDataHub 通过 3 种发送方式（拖拽、滑动、多选）发送的音频数据
- 在节点前端显示音频播放器和文件名
- 使用节点 ID 和颜色作为唯一性区分
- 清空已接收数据按钮
- 前端组件中英文本地化显示基于 XDataHub 的语言选择

**输出**:
- `audio` (AUDIO): 从 XDataHub 接收并解码的音频对象
</details>

<details>
<summary><strong> XAudioSave </strong> | 🎵 音频保存</summary>

`♾️ Xz3r0/File-Processing`

音频保存节点，支持 WAV/FLAC 无损格式保存音频，支持压缩和
LUFS 标准化以及峰值限制

**功能**:
- 保存音频到 ComfyUI 默认输出目录
- 输出格式下拉菜单（默认：`FLAC`）
  - `WAV`: 无损格式 (PCM 32-bit float)
  - `FLAC`: 无损压缩格式，支持嵌入工作流元数据
    - `WAV` 无法嵌入工作流元数据
- 支持多种采样率 (44.1kHz, 48kHz, 96kHz, 192kHz)
- 可以使用压缩器 (acompressor 滤镜，三种预设：快速/平衡/缓慢)
- 支持自定义压缩比 (1.0-20.0)
- LUFS 音量标准化 (默认 -14.1 LUFS，可设置为 -70 禁用)
- 可以使用峰值限制 (True Peak)
- 支持自定义文件名和子文件夹
- 日期时间标识符替换 (%Y%, %m%, %d%, %H%, %M%, %S%)
- 路径安全防护 (防止路径遍历攻击)
- 自动添加序列号防止覆盖 (从 00001 开始)

**处理流程**:
1. 使用 FFmpeg 的压缩器 acompressor 滤镜 (如果启用) :
   - 选择预设模式 (快速/平衡/缓慢)
   - 可选使用自定义压缩比覆盖预设值
   - 对音频进行动态范围压缩
2. 使用 loudnorm 滤镜 双阶段处理进行 LUFS 标准化和限制峰值 (如果启用)
3. 最终测量音频信息验证结果

**压缩预设参数说明**:
- 阈值自适应计算：`threshold = actual_lufs + (actual_lufs - target_lufs) * 0.3 + base_offset`
- 快速：适合语音/播客，base_offset=6dB, ratio=3:1, attack=10ms, release=50ms
- 平衡：通用/音乐，base_offset=4dB, ratio=2:1, attack=20ms, release=250ms
- 缓慢：适合母带/广播，base_offset=2dB, ratio=1.5:1, attack=50ms, release=500ms
- 如果您不了解音频处理，简单来说，压缩器会让符合条件即超过音量阈值 (`threshold`) 的声音降低。选择快速预设时压缩器遇到符合的声音会反应迅速但工作时间短，适合处理音频中极短出现的声音 (比如：鼓的敲击声和双手的拍打声) 可以让其听起来不再那么尖锐。相反的，选择缓慢预设时压缩器遇到符合条件的声音反应会较慢但工作时间更长所以更适合处理持续时间更长的声音 (比如悠长的人声) 可以让其听起来更加紧凑。为了简化节点，对于阈值使用公式根据音频的响度 (LUFS) 以及压缩预设的偏移量 (`base_offset`) 来自动设置阈值
- 压缩比 (`ratio`) 是压缩器降低声音的幅度 (比例)，压缩比越高声音被降低得越多，预设带有压缩比，可以自定义
**峰值限制说明**:
- 使用 True Peak 方式 (广播标准，8x 过采样，精度高) 限制音量峰值来尽可能避免削波失真

**输入**:
- `audio` (AUDIO): 音频对象 (包含波形和采样率)
- `filename_prefix` (STRING): 文件名前缀 (默认：`ComfyUI_%Y%-%m%-%d%_%H%-%M%-%S%`)
- `subfolder` (STRING): 子文件夹名称 (默认：`Audio`)
- `format` (STRING): 输出格式 (默认：`FLAC`，可选：WAV, FLAC)
- `sample_rate` (STRING): 采样率 (默认：`48000`，可选：44100, 48000, 96000, 192000)
- `target_lufs` (FLOAT): 目标 LUFS 值 (默认：`-14.1`，范围 -70.0 到 0.0，-70 禁用)
- `enable_peak_limiter` (BOOLEAN): 是否启用峰值限制 (默认：True)
- `peak_limit` (FLOAT): 峰值限制值 (默认：`-1.1`，范围 -6.0 到 0.0)
- `enable_compression` (BOOLEAN): 是否启用压缩 (默认：False)
- `compression_mode` (STRING): 压缩预设模式 (默认：`Balanced`，可选：Fast, Balanced, Slow)
- `use_custom_ratio` (BOOLEAN): 是否使用自定义压缩比 (默认：False)
- `custom_ratio` (FLOAT): 自定义压缩比 (默认：`2.0`，范围 1.0 到 20.0)

**输出**:
- `processed_audio` (AUDIO): 处理后的音频 (重采样、压缩、LUFS 标准化、峰值限制)
- `save_path` (STRING): 保存的相对路径
</details>

<details>
<summary><strong> XDataSave </strong> | 💾 文本历史数据保存</summary>

`♾️ Xz3r0/File-Processing`

接收 `xdata_seed` 或 `xdata_string` 类型数据并保存到本地 SQLite 数据库文件，可在 XDataHub 的历史标签页中查看。

**这个节点是做什么的**:
- 配合 `XSeed`（`xdata_seed` 输出）和 `XAnyToString`（`xdata_string` 输出）使用，将生成过程中的种子值或字符串内容持久化存储
- 数据库文件存储在 `custom_nodes\ComfyUI-Xz3r0-Nodes\XDataSaved`
- 每个数据库最多保存 500 条历史记录，超过后覆盖最早的条目

**功能**:
- 保存类型（数据库文件名）可选：
  - `Custom`（默认）：自定义文件名.db
  - `Seed`：固定写入 `seed_data.db`
  - `String`：固定写入 `string_data.db`
- 可选「自定义文件名」输入（选择 Custom 时生效，为空时报错）
  - 支持外部字符串输入端口（优先级高于文本框）
- 可选「额外头部信息」（最多 120 字符）
  - 推荐：将提示词连接 `xdata_input`，将种子值转字符串后连接额外头部信息
  - 支持外部字符串输入端口（优先级高于文本框）
- `enabled` 开关按钮：关闭时不会执行保存

**输入**:
- `xdata_input` (xdata_seed/xdata_string): xdata 复合输入，接收上游的 xdata 协议数据
- `save_type` (下拉选择): 保存类型（Custom / Seed / String）
- `custom_filename_input` (STRING, 可选): 自定义文件名输入端口
- `custom_filename_text` (STRING): 自定义文件名文本框（备用）
- `extra_header_input` (STRING, 可选): 额外头部信息输入端口
- `extra_header_text` (STRING): 额外头部信息文本框（备用）
- `enabled` (BOOLEAN): 启用保存开关（默认：`Enabled`）

**限制**:
- 每个数据库最多 500 条历史记录
- 额外头部信息最多 120 字符
- 单条记录最大 64KB
- 自定义文件名最多 64 字符
</details>

<details>
<summary><strong> XImageGet </strong> | 🖼️ 图片数据接收</summary>

`♾️ Xz3r0/File-Processing`

与 XDataHub 配套的图片数据接收节点，接收从 XDataHub 发送的图片文件并输出为 IMAGE 和 MASK 类型。

**功能**:
- 接收 XDataHub 通过 3 种发送方式（拖拽、滑动、多选）发送的图片数据
- 在节点前端显示图片内容和文件名
- 编辑遮罩按钮：调用 ComfyUI 原生遮罩编辑工具（MaskEditor）
- 占位黑图输出开关：开启后无图片数据时使用 1×1 像素黑色图片作为输出而非空值
- 使用节点 ID 和颜色作为唯一性区分
- 清空已接收数据按钮
- 前端组件中英文本地化显示基于 XDataHub 的语言选择

**输入**:
- `output_placeholder` (BOOLEAN): 无图片时输出占位黑图（默认：`Disabled`）

**输出**:
- `image` (IMAGE): 从 XDataHub 接收的图片张量
- `mask` (MASK): 遮罩数据（来自 MaskEditor 编辑结果；未编辑时为空值）
</details>

<details>
<summary><strong> XImageResize </strong> | 🔎 图像缩放</summary>

`♾️ Xz3r0/File-Processing`

全自动图像缩放节点，支持智能图像缩放功能

**功能**:
- 自动识别横屏/竖屏/正方形
- 按长边或短边缩放（可切换）
- 按百万像素缩放（精确控制输出像素数）
- 按条件缩放（总是 / 仅图像大于目标时 / 仅图像小于目标时）
- 保持原始宽高比，永不变形
- 整除调整功能 - 使分辨率可被指定整数整除
- 分辨率偏移功能 - 在最终分辨率上添加偏移值
- 支持批量图像处理（图片序列）
- 带进度条显示
- 支持多种插值算法（双线性/双三次/最近邻/区域/Lanczos）

**输入**:
- `images` (IMAGE): 输入图像张量
- `scale_mode` (下拉选择): 插值算法
  - `Nearest-exact`: 精确最近邻插值（速度最快）
  - `Bilinear`: 双线性插值（速度快，质量中等）
  - `Area`: 区域插值（适合缩小，质量好）
  - `Bicubic`: 双三次插值（速度中等，质量高）
  - `Lanczos`: Lanczos 插值（速度较慢，质量最高）
- `edge_mode` (下拉选择): 缩放基准
  - `Long`: 以长边为基准（横屏的宽，竖屏的高）
  - `Short`: 以短边为基准（横屏的高，竖屏的宽）
  - `Megapixels`: 以百万像素为基准（忽略 目标边长 `target_edge`）
  - `Scale Multiplier`: 以缩放倍率为基准（忽略 目标边长 `target_edge`）
- `resize_condition` (下拉选择): 缩放触发条件
  - `Always`: 总是缩放
  - `Only if Larger`: 仅当图像大于目标时缩放
  - `Only if Smaller`: 仅当图像小于目标时缩放
- `target_edge` (INT): 目标边长（范围 64-8192，步进为 1，可精确设置）
- `megapixels` (FLOAT): 百万像素数（范围 0.1-100，默认 1.0，仅在 Megapixels 模式下使用）
- `scale_multiplier` (FLOAT): 缩放倍率（范围 0.1-10）
- `divisible` (INT): 整除数（默认：16，范围 1-128）
- `divisible_mode` (下拉选择): 取整方式（默认：Disabled）
  - `Disabled`: 禁用整除调整
  - `Nearest`: 取最接近的倍数
  - `Up`: 向上取整
  - `Down`: 向下取整
- `width_offset` (INT): 宽度偏移（范围 -128 到 128）
- `height_offset` (INT): 高度偏移（范围 -128 到 128）
- `resize_setting_in` (RESIZE_SETTING, 可选): 上游 `XImageResize` 节点传递来的缩放设置参数包，连接后可使用上游传递的所有缩放设置参数
- `use_passed_settings` (BOOLEAN): 是否使用上游传递的缩放设置参数（默认：`Enabled`，关闭后忽略上游传递，继续使用自身参数）
- `output_resize_settings` (BOOLEAN): 是否向下游继续传递缩放设置参数（默认：`Enabled`，关闭后 `resize_setting_out` 输出为空值 `None`）

**输出**:
- `Processed_Images` (IMAGE): 缩放后的图像
- `width` (INT): 输出分辨率宽度
- `height` (INT): 输出分辨率高度
- `resize_setting_out` (RESIZE_SETTING): 向下游 `XImageResize` 节点传递的缩放设置参数包（当 `output_resize_settings` 关闭时输出为空值 `None`）

**使用示例**:
```
# 示例 1: 横屏图片按长边缩放
输入：1920x1080, edge_mode="Long", target_edge=1280
输出：1280x720

# 示例 2: 竖屏图片按长边缩放
输入：1080x1920, edge_mode="Long", target_edge=1280
输出：720x1280

# 示例 3: 按短边缩放
输入：1920x1080, edge_mode="Short", target_edge=720
输出：1280x720

# 示例 4: 百万像素模式（精确控制）
输入：1920x1080 (2.07MP), edge_mode="Megapixels", megapixels=1.0
输出：1334x750 (1.0MP)

# 示例 6: 带整除调整
输入：1920x1080, target_edge=1280, divisible=16, divisible_mode="Up"
输出：1280x720

# 示例 7: 带分辨率偏移（+1）
输入：1920x1080, target_edge=1280, width_offset=1, height_offset=1
输出：1281x721

# 示例 8: 倍率模式（放大 2 倍）
输入：1024x1024, edge_mode="Scale Multiplier", scale_multiplier=2.0
输出：2048x2048

# 示例 9: 条件缩放（仅当图像大于目标时）
输入：1024x768, edge_mode="Long", target_edge=1280, resize_condition="Only if Larger"
输出：1024x768（不按比例缩放；若启用整除或偏移，仍会继续应用）
```

**注意事项**:
- 节点自动保持原始宽高比，不会导致图像变形
- `edge_mode="Megapixels"` 或 `"Scale Multiplier"` 时 `target_edge` 参数被忽略
- `edge_mode="Scale Multiplier"` 时，使用 `scale_multiplier` 作为缩放倍率
- `resize_condition` 缩放条件仅作用于 `Long` / `Short` / `Megapixels` 长边/短边/百万像素 模式
- `edge_mode="Scale Multiplier"` 缩放倍率模式时会忽略 `resize_condition` 缩放条件
- 当条件不满足时，会跳过缩放，但整除与偏移仍会继续执行
- 整除调整在尺寸计算之后应用
- 分辨率偏移在整除调整之后应用
- `edge_mode="Megapixels"` 时必须设置 `megapixels > 0`
- `edge_mode="Scale Multiplier"` 时必须设置 `scale_multiplier > 0`
- 偏移值范围：-128 到 128，确保最终分辨率 ≥ 1
- 节点只处理图像缩放；如需处理遮罩，请使用官方的遮罩分离/合并相关节点组合工作流

**批处理限制说明**:
- 批处理按整批统一目标尺寸计算和缩放（与官方缩放节点风格一致）
</details>

<details>
<summary><strong> XImageSave </strong> | 🖼️ 图像保存</summary>

`♾️ Xz3r0/File-Processing`

图像保存节点，支持自定义文件名和子文件夹管理，支持图像和遮罩保存

**功能**:
- 支持保存图像（IMAGE）和遮罩（MASK），输入端口同时兼容两种类型
- 支持自定义文件名和子文件夹
- 日期时间标识符替换 (%Y%, %m%, %d%, %H%, %M%, %S%)
- 路径安全防护 (防止路径遍历攻击)
- 自动添加序列号防止覆盖 (从 00001 开始)
- 批量图像保存支持
- PNG 压缩级别可调节 (0-9)
- 元数据保存 (工作流提示词、种子值、模型信息等)
- `enable_preview` 开关可控制节点预览图是否显示

**输入**:
- `image_or_mask` (IMAGE/MASK): 输入图像或遮罩张量
- `filename_prefix` (STRING): 文件名前缀
- `subfolder` (STRING): 子文件夹名称
- `compression_level` (INT): PNG 压缩级别 (0-9，0=无压缩，9=最大压缩)
- `enable_preview` (BOOLEAN): 启用预览 (默认：`Enabled`，关闭后节点不显示预览图)

**隐藏输入**:
- `prompt` (PROMPT): 工作流提示词 (自动注入)
- `extra_pnginfo` (EXTRA_PNGINFO): 额外元数据 (自动注入)

**输出**:
- `image_or_mask` (IMAGE/MASK): 原始图像或遮罩 (透传)
- `save_path` (STRING): 保存的相对路径
</details>

<details>
<summary><strong> XLatentLoad </strong> | 📥 Latent 加载</summary>

`♾️ Xz3r0/File-Processing`

Latent 加载节点，支持从输入端口或文件加载 Latent

**功能**:
- 支持从上游节点输入 Latent (优先级最高)
- 支持从下拉菜单选择 Latent 文件
- 自动扫描 ComfyUI 默认输出目录及其子文件夹中的.latent 文件
- 文件存在性检查和错误提示
- 支持 Latent 格式版本自动检测
- 输出标准 Latent 格式字典
- Latent 基础验证：验证获取或加载的 Latent 是否符合 ComfyUI 规范

**输入**:
- `latent_input` (LATENT, 可选): 从上游节点接收的 Latent
- `latent_file` (STRING, 下拉选择): 从下拉菜单选择 Latent 文件

**输出**:
- `latent` (LATENT): Latent 字典

**优先级说明**:
1. 如果输入端口有 Latent，直接返回输入的 Latent
2. 如果输入端口为 None，则从下拉菜单选择的文件加载 Latent
3. 如果输入端口为 None 且文件不存在，弹出错误提示

**Latent 基础验证说明**:
- 类型验证：必须是字典 (dict)
- 键验证：必须包含 "samples" 键
- 张量验证：samples 必须是 torch.Tensor
- 维度验证：samples 必须是 4D [B,C,H,W] 或 5D [B,C,T,H,W]
- 兼容：图像、音频、3D、视频、Inpaint、批量处理等所有 ComfyUI 标准 4D 或 5D 的 Latent 类型
- 注意：节点不验证 Latent 可能带有的额外可选键（如 noise_mask、batch_index、type），这些由上游生成 Latent 的节点负责
</details>

<details>
<summary><strong> XLatentSave </strong> | 📤 Latent 保存</summary>

`♾️ Xz3r0/File-Processing`

Latent 保存节点，支持自定义文件名和元数据保存

**功能**:
- 保存 Latent 到 ComfyUI 默认输出目录
- 输出 Latent 端口可以传递到其他节点
- 支持自定义文件名和子文件夹
- 支持日期时间标识符 (%Y%, %m%, %d%, %H%, %M%, %S%)
- 自动检测同名文件并添加序列号 (从 00001 开始)
- 仅支持单级子文件夹创建
- 安全防护 (防止路径遍历攻击)
- 支持元数据保存 (工作流提示词、种子值、模型信息等)
- Latent 基础验证：验证获取的 Latent 是否符合 ComfyUI 规范

**输入**:
- `latent` (LATENT): 输入 Latent 张量
- `filename_prefix` (STRING): 文件名前缀
- `subfolder` (STRING): 子文件夹名称

**隐藏输入**:
- `prompt` (PROMPT): 工作流提示词 (自动注入)
- `extra_pnginfo` (EXTRA_PNGINFO): 额外元数据 (自动注入)

**输出**:
- `latent` (LATENT): 原始 Latent (透传)
- `save_path` (STRING): 保存的相对路径

**Latent 基础验证说明**:
- 类型验证：必须是字典 (dict)
- 键验证：必须包含 "samples" 键
- 张量验证：samples 必须是 torch.Tensor
- 维度验证：samples 必须是 4D [B,C,H,W] 或 5D [B,C,T,H,W]
- 兼容：图像、音频、3D、视频、Inpaint、批量处理等所有 ComfyUI 标准 4D 或 5D 的 Latent 类型
- 注意：节点不验证 Latent 可能带有的额外可选键（如 noise_mask、batch_index、type），这些由上游生成 Latent 的节点负责
</details>

<details>
<summary><strong> XLoraGet </strong> | 🧬 Lora 数据接收与加载</summary>

`♾️ Xz3r0/File-Processing`

与 XDataHub 配套的 Lora 数据接收和加载节点，支持多条 Lora 按列表顺序加载，并提供触发词汇总输出。

**功能**:
- 前端显示 Lora 加载列表，支持拖拽排序，加载顺序从上至下
- 每条 Lora 可独立开关（取消勾选后仅显示在列表中，不实际加载）
- 首/尾位置锁定按钮
- Lora 文件名鼠标悬停浮动提示窗：显示缩略图、文件名和备注（来自 XDataHub 编辑的 Lora 信息）
- 模型强度（M）和 Clip 强度（C）输入框（数值默认加载自 XDataHub 的 Lora 编辑信息）
- 单独调整 Clip 强度勾选开关：关闭时 Clip 强度与模型强度保持一致
- 触发词显示区域：
  - 默认加载自 XDataHub Lora 编辑信息中保存的触发词
  - 支持鼠标点击以开启/关闭单个触发词
  - 多触发词显示栏按钮（超过 3 个触发词时显示 +数字 按钮）
  - 刷新按钮：重新从 XDataHub 获取触发词和备注
  - 多触发词输出时使用 `, ` 分隔

**输入**:
- `model` (MODEL): 基础模型输入（必填）
- `clip` (CLIP, 可选): CLIP 输入（未连接时 Clip 强度设置无效）

**输出**:
- `model` (MODEL): 已按顺序应用全部启用 Lora 的模型
- `clip` (CLIP): 已应用 Lora 的 CLIP（无 CLIP 输入时透传 `None`）
- `trigger_words` (STRING): 已启用触发词汇总（多个触发词用 `, ` 分隔）
- `lora_info` (STRING): 实际加载的 Lora 列表及强度信息摘要
</details>

<details>
<summary><strong> XMarkdownSave </strong> | 📝 Markdown 保存</summary>

`♾️ Xz3r0/File-Processing`

Markdown 保存节点，用来把头部、正文、尾部文本组合成一个
`.md` 文件保存到 ComfyUI 输出目录中。

**这个节点是做什么的**:
- 适合把提示词、说明文字、工作流结果、元数据摘要之类的内容
  保存成 Markdown 文档
- 你既可以直接在节点里手动输入文字，也可以从上游节点接收字符串
- 头部、正文、尾部之间可以控制是否自动插入换行，避免自己手动数空行

**功能**:
- 保存 Markdown 文件到 ComfyUI 默认输出目录
- 头部、正文、尾部都支持“输入端口优先，文本框回退”
- 支持正文前后插入换行分隔
- 支持自定义文件名和子文件夹
- 支持日期时间标识符 `%Y% %m% %d% %H% %M% %S%`
- 自动检测同名文件并追加序列号，避免覆盖旧文件
- 路径安全防护，避免非法路径写入
- 输出最终保存内容和相对保存路径

**输入**:
- `filename_prefix` (STRING): 文件名前缀
- `subfolder` (STRING): 子文件夹名称，默认 `Markdown`
- `header_input` (STRING, 可选): 头部字符串输入端口，连接时优先
  使用它
- `header_text` (STRING, 多行): 头部文本框内容，未连接
  `header_input` 时使用
- `before_main_separator` (下拉选择): 头部和正文之间的分隔方式
  - `none`: 不插入分隔内容
  - `newline`: 插入换行
- `before_main_newline_count` (INT): 正文前的换行次数
- `main_text_input` (STRING, 可选): 正文字符串输入端口，连接时优先
  使用它
- `text_content` (STRING, 多行): 正文文本框内容，未连接
  `main_text_input` 时使用
- `after_main_separator` (下拉选择): 正文和尾部之间的分隔方式
  - `none`: 不插入分隔内容
  - `newline`: 插入换行
- `after_main_newline_count` (INT): 正文后的换行次数
- `footer_input` (STRING, 可选): 尾部字符串输入端口，连接时优先
  使用它
- `footer_text` (STRING, 多行): 尾部文本框内容，未连接
  `footer_input` 时使用

**优先级逻辑**:
- 头部：如果连接了 `header_input`，就使用输入端口内容；
  否则使用 `header_text`
- 正文：如果连接了 `main_text_input`，就使用输入端口内容；
  否则使用 `text_content`
- 尾部：如果连接了 `footer_input`，就使用输入端口内容；
  否则使用 `footer_text`

**输出**:
- `content` (STRING): 最终写入 Markdown 文件的完整内容
- `save_path` (STRING): 保存后的相对路径

**使用示例**:
```
filename_prefix = "PromptNotes_%Y%-%m%-%d%"
subfolder = "Markdown"
header_text = "# 本次生成记录"
before_main_separator = "newline"
before_main_newline_count = 2
text_content = "这里是正文内容"
after_main_separator = "newline"
after_main_newline_count = 2
footer_text = "---\n保存完成"

输出：
content = "# 本次生成记录\n\n这里是正文内容\n\n---\n保存完成"
save_path = "Markdown/PromptNotes_2026-03-11_00001.md"
```

**适合什么时候用**:
- 保存提示词记录、参数说明、生成备注
- 把 `XAnyToString` 转出来的字符串写成 Markdown 文件
- 把多个字符串节点整理后输出成可阅读的文档
</details>

<details>
<summary><strong> XStringGet </strong> | 📝 文本数据接收</summary>

`♾️ Xz3r0/File-Processing`

与 XDataHub 配套的文本数据接收节点，接收从 XDataHub 发送的历史记录文本并分别输出正文内容和头部信息。

**功能**:
- 接收 XDataHub 通过 3 种发送方式（拖拽、滑动、多选）发送的文本数据
- 在节点前端显示正文内容和额外头部信息
- 使用节点 ID 和颜色作为唯一性区分
- 清空已接收数据按钮
- 前端组件中英文本地化显示基于 XDataHub 的语言选择

**输出**:
- `Content` (STRING): 接收的主要文本内容
- `Header` (STRING): 接收的额外头部信息
</details>

<details>
<summary><strong> XVideoGet </strong> | 🎞️ 视频数据接收</summary>

`♾️ Xz3r0/File-Processing`

与 XDataHub 配套的视频数据接收节点，接收从 XDataHub 发送的视频文件并输出为 VIDEO 类型。

**功能**:
- 接收 XDataHub 通过 3 种发送方式（拖拽、滑动、多选）发送的视频数据
- 在节点前端显示视频播放器和文件名
- 使用节点 ID 和颜色作为唯一性区分
- 清空已接收数据按钮
- 前端组件中英文本地化显示基于 XDataHub 的语言选择

**输出**:
- `video` (VIDEO): 从 XDataHub 接收的视频对象
</details>

<details>
<summary><strong> XVideoSave </strong> | 🎬 视频保存</summary>

`♾️ Xz3r0/File-Processing`

视频保存节点，使用 FFmpeg 将图像序列保存为视频

**功能**:
- 支持容器格式下拉菜单（默认：`MP4`）
  - `MKV`: 优先兼容无损与音频合并场景
  - `MP4`: 优先兼容 ComfyUI 网页端工作流元数据读取
- H.265/HEVC 编码，yuv444p10le 像素格式
- FPS 从视频对象自动获取 (由官方的 CreateVideo 创建视频节点设置)
- 音频支持 (自动从视频对象获取)
- 自定义 CRF (质量参数 0-40，0 为无损)
- 编码预设选择 (ultrafast 到 veryslow，平衡编码速度和压缩效率)
- 支持自定义文件名和子文件夹
- 日期时间标识符替换 (%Y%, %m%, %d%, %H%, %M%, %S%)
- 路径安全防护 (防止路径遍历攻击)
- 自动添加序列号防止覆盖 (从 00001 开始)

**输入**:
- `video` (VIDEO): 视频对象 (包含图像序列、音频和帧率)
- `filename_prefix` (STRING): 文件名前缀 (默认：`ComfyUI_%Y%-%m%-%d%_%H%-%M%-%S%`)
- `subfolder` (STRING): 子文件夹名称 (默认：`Videos`)
- `crf` (INT): 质量参数 (默认：`0`，范围 0-40，0 为无损，40 为最差质量)
- `preset` (STRING): 编码预设 (默认：`medium`，可选：ultrafast, superfast, veryfast, faster, fast, medium, slow, slower, veryslow)
- `container` (STRING): 容器格式 (默认：`MP4`，可选：MKV, MP4)

**输出**:
- 视频预览 (显示保存的视频)

**FFmpeg 参数**:
- vcodec: libx265 (H.265/HEVC 编码)
- pix_fmt: yuv444p10le (10 位 YUV 4:4:4 采样)
- crf: 可配置 (0=无损，40=最差质量)
- preset: 可配置 (ultrafast 到 veryslow)
- 容器格式：MKV 或 MP4（默认：MP4）
</details>

<details>
<summary><strong> XWorkflowSave </strong> | 📄 JSON 工作流元数据保存</summary>

`♾️ Xz3r0/File-Processing`

工作流保存节点，将 ComfyUI 工作流保存为 JSON 文件（适配 `XMetadataWorkflow`），支持 3 种保存模式、自定义文件名和子文件夹

**功能**:
- 保存工作流到 ComfyUI 默认输出目录
- 支持 3 种 JSON 保存模式：`Auto`, `Native`, `Prompt+FullWorkflow`
- 支持自定义文件名和子文件夹
- 日期时间标识符替换 (%Y%, %m%, %d%, %H%, %M%, %S%)
- 路径安全防护 (防止路径遍历攻击)
- 自动添加序列号防止覆盖 (从 00001 开始)
- 仅支持单级子文件夹创建
- 保存工作流元数据 (prompt 和 workflow)
- 工作流信息字符串输出，可检查保存状态

**JSON 保存模式说明**:

| 模式 | 说明 | 优点 | 缺点 |
|-----|------|------|------|
| `Auto` (默认) | 自动模式，优先使用 `Prompt+FullWorkflow`，不可用时回退到 `Native` | 智能选择最佳模式 | 依赖网页扩展 |
| `Native` | 使用 ComfyUI 官方后端 API 获取原生工作流格式（与官方 SaveImage 节点保存的元数据一致） | 使用官方后端 API | 缺少一些节点的元数据 |
| `Prompt+FullWorkflow` (推荐) | 结合标准 API 的 prompt 字段和网页扩展的完整 workflow 数据 | 所有模式中最完整的工作流元数据 | 依赖网页扩展，非官方原生支持 |

**注意**: `Prompt+FullWorkflow` 模式依赖 `ComfyUI.Xz3r0.XWorkflowSave` 网页扩展和 `xworkflowsave_api` 自定义 API

**工作原理**:
1. `ComfyUI.Xz3r0.XWorkflowSave` 网页扩展从 ComfyUI 前端网页捕获完整工作流元数据
2. `xworkflowsave_api` 自定义 API 接收网页扩展传来的数据
3. `XWorkflowSave` 节点通过 API 获取数据并保存为 JSON 文件

**输入**:
- `anything` (ANY): 任意输入类型，用于工作流连接。此输入不处理数据，仅用于将节点链接到工作流中
- `filename_prefix` (STRING): 文件名前缀 (默认：`ComfyUI_%Y%-%m%-%d%_%H%-%M%-%S%`)
- `subfolder` (STRING): 子文件夹名称 (默认：`Workflows`)
- `save_mode` (下拉选择): JSON 保存模式 (默认：`Auto`，可选：Auto, Native, Prompt+FullWorkflow)

**隐藏输入**:
- `prompt` (PROMPT): 工作流提示词 (自动注入)
- `extra_pnginfo` (EXTRA_PNGINFO): 额外元数据 (自动注入)

**输出**:
- `workflow_info` (STRING): 工作流保存信息，显示保存模式和状态
</details>

---

## 🧩 网页扩展的详细说明（推荐查看）
`web`

<details>
<summary><strong> XFitView </strong> | 🔍 工作流和子图页面自动适应视图</summary>

`ComfyUI Web Interface Extension - ComfyUI.Xz3r0.XFitView`

打开 ComfyUI 网页界面或载入新工作流时，自动执行 ComfyUI 网页界面原生的 *适应视图* 功能，确保工作流内容完整显示在画布可视区域内。支持主工作流和子图 (Subgraph) 页面的自动适应。

**功能**:
- 页面首次加载适应：页面首次加载完成后自动适应视图
- 工作流加载适应：监听工作流加载事件，新工作流载入后自动适应视图
- 子图页面适应：进入或退出子图页面时自动适应视图，支持嵌套子图
- 智能去重机制：基于工作流/子图特征生成唯一标识
- 防抖控制：同一工作流/子图 200ms 内多次触发只执行一次，不同工作流之间立即触发

**设置选项**:
- Workflow Enter Mode (工作流进入模式): 主工作流加载时（页面加载、加载工作流文件）
  - `First` (仅首次): 同一会话中相同工作流只适应一次（推荐，页面刷新后重置）
  - `Always` (每次都适应): 每次加载都适应视图
  - `Never` (从不): 禁用自动适应（默认）
- Workflow Exit Mode (工作流退出模式): 从子图退出到主工作流时
  - `First` (仅首次): 同一会话中只适应一次
  - `Always` (每次都适应): 每次退出都适应视图
  - `Never` (从不): 禁用自动适应（默认）
- Subgraph Enter Mode (子图进入模式): 进入子图时
  - `First` (仅首次): 同一会话中相同子图只适应一次
  - `Always` (每次都适应): 每次进入都适应视图
  - `Never` (从不): 禁用自动适应（默认）
- Subgraph Exit Mode (子图退出模式): 退出子图（返回上级子图或主工作流）时
  - `First` (仅首次): 同一会话中只适应一次
  - `Always` (每次都适应): 每次退出都适应视图
  - `Never` (从不): 禁用自动适应（默认）
- Fit View Delay (适应视图延迟): 延迟时间 0-2000ms 可调，默认 300ms
  - 如果视图适应不正确，可适当调整延迟时间

**设置位置**:
- ComfyUI 网页界面 ➡️ 设置 (齿轮图标) ➡️ ♾️ Xz3r0 ➡️ XFitView
<img src="https://raw.githubusercontent.com/Xz3r0-M/Xz3r0/refs/heads/main/XFitView.png" alt="XFitView" width="700">

**工作原理**:
- 使用 ComfyUI 扩展 API 注册扩展
- 监听 `app.graph.onConfigure` 和 `app.loadGraphData` 事件检测工作流变化
- 使用 `MutationObserver` 监听面包屑导航变化检测子图进入/退出
- 基于节点类型、连接拓扑生成工作流/子图唯一标识
- 使用 cyrb53 哈希算法生成 64 位哈希值，显著降低冲突概率
- 通过触发 ComfyUI 页面右下角的原生 Fit View 按钮实现适应视图功能
</details>

<details>
<summary><strong> XDataHub </strong> | ♾️ 数据中心 & 浮动窗口</summary>

`ComfyUI Web Interface Extension - ComfyUI.Xz3r0.XDataHub`

XDataHub 是 ComfyUI 网页界面的独立浮动窗口数据中心，支持预览和发送文本、图片、视频、音频和 Lora 五种数据类型，配合专属接收节点使用。

**打开方式**:
- 点击 ComfyUI 网页界面顶部栏执行按钮左侧的粉红色 ♾️ 按钮（或按默认快捷键 `Alt + X`）
<img src="https://raw.githubusercontent.com/Xz3r0-M/Xz3r0/refs/heads/main/bl.png" alt="Button" width="500">

**配套节点**:
| 数据类型 | 接收节点 |
|---------|---------|
| 文本（历史记录）| `XStringGet` |
| 图片 | `XImageGet` |
| 视频 | `XVideoGet` |
| 音频 | `XAudioGet` |
| Lora | `XLoraGet` |

**数据发送方式（3 种）**:
- 拖拽数据卡片到节点（推荐）
- 滑动发送
- 多选发送（从「发送到节点」窗口选择目标节点）

**标签页**:
- 历史：来自 `XSeed`、`XAnyToString`、`XDataSave` 节点保存的文本数据
- 图片：从 ComfyUI `input`/`output` 文件夹（含子文件夹和软链接）中读取
- 视频：同上
- 音频：同上
- Lora：从 `models/loras` 文件夹（含子文件夹和软链接）中读取

**Lora 编辑功能**:
- 备注、模型强度、Clip 强度、触发词
- 支持从同目录中已存在的 `metadata.json`（ComfyUI-Lora-Manager）导入触发词

**数据库管理**:
- 清除历史记录和删除数据库文件
- 预设名称数据库被列为内置关键数据库，默认锁定防止误操作
- 配置文件（.json）和数据库文件（.db）保存在 `custom_nodes\ComfyUI-Xz3r0-Nodes\XDataSaved`

**XDataHub 控制面板内设置**:
- 明亮/暗黑模式切换
- 快捷键设置（默认 `Alt + X`）
- 卡片大小
- 显示/隐藏文件名
- 卡片标签显示切换
- 媒体播放相关设置
- 将 Lora 数据库保存位置切换到 `models/loras`
- 语言设置按钮（中文/English）——首次使用时会弹出语言选择

**ComfyUI 设置面板中的设置**:
- `XDataHub 关闭按钮行为`
  - `隐藏`（推荐）：仅隐藏显示，窗口状态保留，关闭后仍占用系统资源，重新打开快
  - `销毁`：完全关闭，重新打开稍慢
- `XDataHub 默认打开布局`
  - `默认`：视图居中，窗口大小为视图界面的 75%
  - `左靠边`（推荐）：最小窗口宽度靠左
  - `右靠边`：最小窗口宽度靠右
  - `最大化`
- 将 ♾️ XDataHub 置于 ComfyUI 界面组件之下
- 启用 ♾️ XDataHub（按钮）

**其他功能**:
- 自动轮询检测工作流是否正在执行（每 2 秒一次，使用 ComfyUI 官方 API），执行期间进入文件仅读取模式
- 窗口透明度调整 (20% - 100%)
- 窗口最大化按钮
- `Alt + 鼠标左键` 快捷拖动窗口
- 内嵌 `XMetadataWorkflow` 工作流元数据查看器

</details>

<details>
<summary><strong> XMetadataWorkflow </strong> | 📊 工作流元数据可视化查看</summary>

`🌐 web/xmetadataworkflow.html`

简易且独立的工作流元数据的可视化查看网页工具，将多种包含有工作流元数据的文件在网页视图中以 ComfyUI 相似的节点界面风格进行展示

**功能**:
- 支持多种文件格式：PNG 图片、Latent 文件、JSON 工作流文件
- 三种元数据解析模式（位于网页工具视图顶部）:
  - `📋 Native` 原生模式 - 仅基于元数据中的 Workflow 字段数据进行解析
  - `🔗 Native (Merged)` 原生合并模式 - 基于元数据中的 Prompt 和 Workflow 双字段进行合并解析
  - `🔗 P+FW` Prompt 和 Full Workflow 模式 - 基于元数据中的 Prompt 和 Full Workflow 双字段进行合并解析（专门用于解析 `XWorkflowSave` 节点保存模式 `Prompt+FullWorkflow` 的 JSON）
- `💾 Convert XWorkflowSave JSON` 转换功能 - 用于转换 `XWorkflowSave` 所保存的 JSON 数据为可被 ComfyUI 网页界面加载的格式
- `🔄️` 重置网页按钮 - 位于网页工具视图右上角，用于快速重置工具状态
- 支持显示 `note` 和 `markdown note` 节点内容
- 基于加载文件的元数据，自动选择简单的自动层级布局算法或元数据中节点位置信息来排列节点
- 显示节点参数和连接关系
- 子图 (Subgraph) 自动颜色标记
- 支持缩放、平移、自适应视图
- 折叠/展开节点参数
- 选中节点高亮相关连接
- 左边栏隐藏/展开功能
- `Ctrl + Left mouse button` 框选多个节点并移动 (双击空白处 或 按 `ESC` 键取消框选)
- 节点内长内容滚动条支持
- 超长内容虚拟滚动优化性能

**解析模式支持的文件类型**:

| 解析模式 | 支持的文件类型 |
|---------|--------------|
| Native 原生 | ComfyUI 官方节点保存的图片、`XImageSave` 节点保存的图片、`XLatentSave` 节点保存的 Latent、ComfyUI 网页界面保存 (Save/Save As) 的 JSON、`XWorkflowSave` 节点 `Native` 模式保存的 JSON |
| Native (Merged) 原生合并 | ComfyUI 官方节点保存的图片、`XImageSave` 节点保存的图片、`XLatentSave` 节点保存的 Latent、`XWorkflowSave` 节点`Native` 模式保存的 JSON |
| P+FW | `XWorkflowSave` 节点 `Prompt+FullWorkflow` 模式保存的 JSON |

**技术说明**:
- 优先使用完整工作流数据 (如果 JSON 中包含)
- 子图通过节点 ID 中的 ":" 识别 (如 "18:8" 表示子图 18 中的节点 8)
- 节点位置使用简单的自动排列算法
- 对于使用自行创建前端界面的第三方自定义节点可能不兼容 (只显示存在于元数据中的内容)
- `💾 Convert XWorkflowSave JSON` 转换功能说明：
  - `XWorkflowSave` 节点保存的 JSON 数据有着嵌套结构所以无法被 ComfyUI 网页界面直接加载，数据的嵌套是为了让网页工具在解析时可以分清楚数据中哪个部分属于 Prompt 字段以及哪个部分属于 (Full)Workflow。
  - 使用转换功能删除嵌套后的 JSON 可以被 ComfyUI 网页界面加载，但是只能使用 `Native` 原生模式解析了

**三种使用方式**:
1. 在 ComfyUI 中使用（集成）: 点击 ComfyUI 页面顶部菜单栏的 ♾️ 按钮，可打开或关闭浮动窗口，已将此网页工具嵌入到该浮动窗口中
<img src="https://raw.githubusercontent.com/Xz3r0-M/Xz3r0/refs/heads/main/bl.png" alt="Open" width="500">

2. 在线使用：https://xz3r0-m.github.io/ComfyUI-Xz3r0-Nodes

3. 浏览器直接打开（独立）: 直接打开本项目中的 `web/xmetadataworkflow.html` 文件，在浏览器中单独使用
</details>

<details>
<summary><strong> XWorkflowSave Extension </strong> | 📋 捕获完整工作流元数据</summary>

`ComfyUI Web Interface Extension - ComfyUI.Xz3r0.XWorkflowSave`

从 ComfyUI 网页直接捕获完整工作流元数据，为 `XWorkflowSave` 节点提供 `Prompt+FullWorkflow` 模式所需的数据

**功能**:
- 捕获前端网页中的完整工作流元数据（包括 `note` 和 `markdown note` 节点）
- 通过 `xworkflowsave_api` 自定义 API 将数据传递给 `XWorkflowSave` 节点
- 数据完整性与 ComfyUI 网页界面原生的 `Save` 和 `Save As` 功能一致

**工作流程**:
1. 网页扩展 (`ComfyUI.Xz3r0.XWorkflowSave`) 在 ComfyUI 前端捕获完整工作流数据
2. 自定义 API (`xworkflowsave_api`) 接收并缓存来自网页扩展的数据
3. `XWorkflowSave` 节点调用 API 获取数据并保存为 JSON 文件

**使用方式**:
- 扩展和 API 会自动加载，无需手动操作
- 在 `XWorkflowSave` 节点选择 `Prompt+FullWorkflow` 模式时自动使用
  - 如果扩展未加载或 API 不可用，`XWorkflowSave` 节点的 `Auto` 模式会自动回退到 `Native` 模式

**注意事项**:
- 此扩展和 API 非 ComfyUI 官方原生支持，如果 ComfyUI 官方将来改动相关代码可能会导致出错
- 扩展加载后会在浏览器控制台输出日志信息
</details>
