/**
 * 共享「分组列表」引擎：把「组」这一层从节点里抽出来，XMediaListGet 与
 * XLoraGet 共用一份实现。
 *
 * 引擎只管组相关的行为：组头与计数胶囊、左侧竖线、折叠/展开动画、指针
 * 拖拽（单行 / 整组 / 外部拖入插入线）、选择、批量开关范围、改名换色解散
 * 删组、撤销重做、提示条。
 *
 * 引擎不认识「文件」「LoRA」这些词，也不知道行里有什么——行的长相、行身份、
 * 存盘、文案全部由调用方通过 ctx 注入（见 createGroupEngine 的注释）。
 */
import {
    buildRenderList,
    createGroupFromSelection,
    deleteGroup,
    groupMembers,
    groupOfGap,
    groupSeqOf,
    moveGroupToGap,
    moveRowToGap,
    nextGroupSeq,
    renameGroup,
    setCollapsed,
} from "./group-model.js";

/* 按下后移动多少像素才算「拖」：小于它还是单击（点开关、点缩略图）。 */
const DRAG_START_PX = 4;

/* 拖到列表上下边缘多少像素内开始自动滚动，以及每次滚多少。 */
const DROP_AUTOSCROLL_EDGE = 28;

// ✔ ✖ ⇄ 三个按钮的「作用范围」：files = 只动还没分组的，all = 全都动，
// groups = 只动组里的。再加上「单击组头 → 只作用于这一组」的临时收窄。
const ENABLE_SCOPES = ["files", "all", "groups"];

/* 组的可选颜色。刻意不用红色系（色板里的 02 / 09 红）：它跟品牌粉太接近，
   画在竖线和胶囊上会被误当成强调色或警告色。橙色系可以用，它和品牌粉
   隔着 30 多度，看得出是两种颜色。
   一共 14 个：色板里现成的原色 + 由原色调出来的中间色，按色相从蓝走到
   橙排好，选起来像一道彩虹。
   色号存进组记录（color 字段），没存过色号的老组按 id 哈希挑一个，
   所以老数据不需要迁移（包括以前存过 "02" 的组，会自动换到别的颜色）。 */
const GROUP_COLORS = [
    {
        id: "01",
        nameKey: "group_color_blue",
        fallback: "Blue",
        value: "var(--db-palette-01, #0066FF)",
    },
    {
        id: "11",
        nameKey: "group_color_azure",
        fallback: "Azure",
        value: "color-mix(in srgb, var(--db-palette-01, #0066FF) 55%, "
            + "var(--db-palette-06, #00CCCC))",
    },
    {
        id: "13",
        nameKey: "group_color_sky",
        fallback: "Sky",
        value: "color-mix(in srgb, var(--db-palette-01, #0066FF) 45%, "
            + "#ffffff)",
    },
    {
        id: "14",
        nameKey: "group_color_steel",
        fallback: "Steel",
        value: "color-mix(in srgb, var(--db-palette-01, #0066FF) 50%, "
            + "#808080)",
    },
    {
        id: "15",
        nameKey: "group_color_indigo",
        fallback: "Indigo",
        value: "color-mix(in srgb, var(--db-palette-01, #0066FF) 70%, "
            + "var(--db-palette-05, #CC00CC))",
    },
    {
        id: "16",
        nameKey: "group_color_violet",
        fallback: "Violet",
        value: "color-mix(in srgb, var(--db-palette-05, #CC00CC) 60%, "
            + "var(--db-palette-01, #0066FF))",
    },
    {
        id: "05",
        nameKey: "group_color_purple",
        fallback: "Purple",
        value: "var(--db-palette-05, #CC00CC)",
    },
    {
        id: "06",
        nameKey: "group_color_cyan",
        fallback: "Cyan",
        value: "var(--db-palette-06, #00CCCC)",
    },
    {
        id: "17",
        nameKey: "group_color_teal",
        fallback: "Teal",
        value: "color-mix(in srgb, var(--db-palette-06, #00CCCC) 55%, "
            + "var(--db-palette-03, #00A86B))",
    },
    {
        id: "03",
        nameKey: "group_color_green",
        fallback: "Green",
        value: "var(--db-palette-03, #00A86B)",
    },
    {
        id: "12",
        nameKey: "group_color_lime",
        fallback: "Lime",
        value: "color-mix(in srgb, var(--db-palette-03, #00A86B) 55%, "
            + "var(--db-palette-04, #FFBF00))",
    },
    {
        id: "04",
        nameKey: "group_color_yellow",
        fallback: "Yellow",
        value: "var(--db-palette-04, #FFBF00)",
    },
    {
        id: "18",
        nameKey: "group_color_amber",
        fallback: "Amber",
        value: "color-mix(in srgb, var(--db-palette-04, #FFBF00) 55%, "
            + "var(--db-palette-07, #FF6600))",
    },
    {
        id: "07",
        nameKey: "group_color_orange",
        fallback: "Orange",
        value: "var(--db-palette-07, #FF6600)",
    },
];

const GROUP_DRAG_THRESHOLD_RATIO = 0.75;

/* 跨组归属的「中性带」：以缝隙两侧邻居的边界为中心，左右各留行高的
   四分之一（Chromium 用的就是标签宽度的 1/4）。落在这段里 = 不属于
   任何组；越过去才算加入某一组。 */
const GROUP_LEAN_RATIO = 0.25;

// 单击组头换范围：等这么久还等不到第二下，才当成「单击」。
// 不然双击改名会顺手把范围切走（改个名字，工具栏跟着跳）。
const HEAD_TAP_DELAY_MS = 220;

const INSERT_EDGE_PX = 8;

const MAX_ENABLED = 50;

/** 组合名的前半：形容词（都短、都好念，不跟后半重词）。 */
const PRESET_GROUP_ADJECTIVES = [
    "Amber",
    "Brave",
    "Calm",
    "Clever",
    "Cosmic",
    "Crisp",
    "Dapper",
    "Dusty",
    "Eager",
    "Gentle",
    "Golden",
    "Hazy",
    "Humble",
    "Jolly",
    "Keen",
    "Lucky",
    "Mellow",
    "Merry",
    "Nimble",
    "Plucky",
    "Quiet",
    "Rapid",
    "Rustic",
    "Silent",
    "Silver",
    "Sunny",
    "Swift",
    "Velvet",
    "Wandering",
    "Wild",
    "Witty",
    "Zesty",
];

/**
 * 新建组的默认名字池：先短后长，够用一辈子。
 *
 * 为什么不用「组 N」：那是把一句中文（或一句英文）**存进工作流数据**，
 * 换个语言界面就变成另一种文字。这些代号是全球通用的词，中英一模一样，
 * 存下来永远是同一个词，用户也不用先打字才能有个名字。
 *
 * 三层设计：
 *   1~26 号   NATO 代号（Alpha…Zulu）——短、好认，像行业默认值；
 *   27 号起   两个常见词拼起来（Amber Falcon、Brave Otter）——
 *             32 × 32 = 1024 个，越用越长但不会越用越生僻；
 *   全用完了   才退回「组 1150」这种（现实中到不了）。
 *
 * 名字由**序号**算出来，不是随机抽：同一号永远是同一个名字，
 * 删组、重排、刷新都不会变。
 */
const PRESET_GROUP_NAMES = [
    "Alpha",
    "Bravo",
    "Charlie",
    "Delta",
    "Echo",
    "Foxtrot",
    "Golf",
    "Hotel",
    "India",
    "Juliet",
    "Kilo",
    "Lima",
    "Mike",
    "November",
    "Oscar",
    "Papa",
    "Quebec",
    "Romeo",
    "Sierra",
    "Tango",
    "Uniform",
    "Victor",
    "Whiskey",
    "Xray",
    "Yankee",
    "Zulu",
];

/** 组合名的后半：具体的东西（看得见摸得着，比抽象词好记）。 */
const PRESET_GROUP_NOUNS = [
    "Anchor",
    "Badger",
    "Beacon",
    "Bison",
    "Canyon",
    "Cedar",
    "Comet",
    "Cove",
    "Dolphin",
    "Ember",
    "Falcon",
    "Fern",
    "Glacier",
    "Harbor",
    "Heron",
    "Lantern",
    "Maple",
    "Meadow",
    "Orchid",
    "Otter",
    "Panda",
    "Pebble",
    "Pine",
    "Raven",
    "River",
    "Sparrow",
    "Summit",
    "Thistle",
    "Tide",
    "Valley",
    "Willow",
    "Wren",
];

/** 名字池总容量：NATO + 形容词 × 名词。 */
const PRESET_GROUP_NAME_COUNT = PRESET_GROUP_NAMES.length
    + PRESET_GROUP_ADJECTIVES.length * PRESET_GROUP_NOUNS.length;


/* 重排防抖：指针相对上次改顺序的位置要移动够这么远才允许再改。
   Chromium 用 16dip（按标签宽度缩放），我们按行高缩放。 */
const REORDER_THRESHOLD_RATIO = 0.35;

/* 列表内拖动「让位」的滑动时长。Chromium 的标签条用 200ms，我们的
   行比标签矮，160ms 更跟手；也是「其它行滑开」这个效果的全部时长。 */
const SLIDE_MS = 160;

const TOAST_DURATION_MS = 2600;

/**
 * 造一个分组引擎实例。
 *
 * ctx 里要提供的（两个节点各写一份，见 xmedialistget_extension.js 的用法）：
 *
 *   keyOf(row)                  行身份（媒体用行 uid，LoRA 用现成的 id）
 *   element(tag, cls, text)     造 DOM 元素
 *   t(key, fallback, vars)      查文案
 *   normalizeItems(raw)         把存盘数据整理成列表数据
 *   emptyItems()                空列表数据
 *   writeItems(node, items, o)  把列表数据写回存盘
 *   renderPanel(node, options)  重画整个面板
 *   ensureStorageWidget(node)   拿存盘 widget
 *   scrollRowIntoView(node, i)  把某一行滚进视野
 *   syncOutputPortType(node)    同步输出类型
 *   startDropAutoScroll(node, dir) / stopDropAutoScroll(state)
 *   dragCountFromDataTransfer(dt)  拖进来几条
 *   hideTypeMismatch(panel)     收起「类型不对」提示
 *   hintHost()                  悬停提示挂在哪
 *   buildRow(node, category, entry, index, seq)
 *                               造一行（拖动就地重排时要补行）
 *   applyPointerDragStop(node)  松手后把拖拽结果落地
 */
/* 组头的折叠箭头（见 buildGroupHead）：它住在组逻辑里，图标路径相对本模块。 */
const GROUP_ARROW_ICON_URL = new URL(
    "../icons/chevron-down.svg",
    import.meta.url
).href;

/* 分组那一层的全部样式：组头胶囊、序列号、计数、竖线、折叠、范围胶囊、
   组名输入、对话框、色板、拖动跟手卡片、插入线、提示条、toast。
   前缀一律 xmlg-（两个节点共用同一套类名），只有「颜色变量挂在哪个面板上」
   由调用方指定，见 groupStyles。

   ⚠️ 改这里等于同时改 XMediaListGet 与 XLoraGet 的外观，改完两边都要看。 */
const GROUP_CSS_TEXT = `__GROUP_HOSTS__,
        /* 拖动时跟手的卡片挂在 body 上（见 spawnGhost），
           颜色变量要在这里再给一份 */
        .xmlg-drag-ghost,
        .xmlg-preview {
            /* 颜色收口：优先 XDataHub token（由 web/xdatahub.js 注入宿主页），
               缺失时回退到品牌色/中性色。面板和全屏预览共用这套变量。 */
            --xmlg-accent: var(--xdh-clr-primary, #ff385c);
            --xmlg-accent-muted: color-mix(
                in srgb,
                var(--xmlg-accent) 14%,
                transparent
            );
            --xmlg-text: var(--xdh-clr-ink, #ffffff);
            --xmlg-text-muted: var(--xdh-clr-muted, rgba(255, 255, 255, 0.6));
            --xmlg-border: var(--xdh-clr-hairline, rgba(255, 255, 255, 0.12));
            --xmlg-surface: var(--xdh-clr-surface-soft, #161618);
            --xmlg-surface-strong: var(--xdh-clr-surface-strong, #1d1d20);
            --xmlg-canvas: var(--xdh-clr-canvas, #0c0c0e);
            --xmlg-on-accent: var(--xdh-clr-on-primary, #ffffff);
            --xmlg-danger: var(--xdh-clr-error, #c13515);
            --xmlg-danger-bright: #ff0000;
            --xmlg-danger-text: color-mix(in srgb, var(--xmlg-danger) 55%, white);
            --xmlg-danger-soft: color-mix(in srgb, var(--xmlg-danger) 12%, transparent);
            --xmlg-success: #22c55e;
            --xmlg-success-text: #4ade80;
            --xmlg-success-glow: color-mix(in srgb, var(--xmlg-success) 65%, transparent);
            --xmlg-success-glow-fade: color-mix(in srgb, var(--xmlg-success) 0%, transparent);
            --xmlg-warning: #f59e0b;
            --xmlg-warning-strong: #fbbf24;
            /* 提示条：浅色主题用深琥珀字 + 米色底，深色主题反过来，
               两边都是 6:1 以上的对比，避免「黄字压浅灰」看不清。 */
            --xmlg-warning-text: color-mix(
                in srgb,
                var(--xmlg-warning) 38%,
                var(--xmlg-text)
            );
            --xmlg-warning-surface: color-mix(
                in srgb,
                var(--xmlg-warning) 16%,
                var(--xmlg-surface)
            );
            --xmlg-warning-soft: color-mix(in srgb, var(--xmlg-warning) 12%, transparent);
            --xmlg-warning-ink: var(--xdh-clr-canvas, #0c0c0e);
            --xmlg-switch-off: var(--xdh-clr-border-strong, rgba(255, 255, 255, 0.22));
            --xmlg-scrim: color-mix(in srgb, var(--xmlg-canvas) 72%, transparent);
            --xmlg-toast-bg: var(--xdh-clr-surface-strong, #1d1d20);
            --xmlg-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
            --xmlg-thumb-bg: var(--xdh-clr-canvas, #0c0c0e);
            --xmlg-scroll-thumb: var(--xdh-scrollbar-thumb, #555);
            --xmlg-scroll-track: var(--xdh-scrollbar-track, transparent);
        }
        /* ✔ ✖ ⇄ 打哪里：一枚胶囊里分三档，当前那档是实心圆点 */
        .xmlg-scope {
            display: inline-flex;
            align-items: center;
            gap: 2px;
            flex: 0 0 auto;
            padding: 2px;
            border: 1px solid var(--xmlg-border);
            border-radius: 999px;
            background: var(--xmlg-surface-strong);
        }
        .xmlg-scope-btn {
            flex: 0 0 auto;
            padding: 2px 8px;
            border: none;
            border-radius: 999px;
            background: transparent;
            color: var(--xmlg-text);
            font: inherit;
            font-size: 10px;
            line-height: 1.5;
            white-space: nowrap;
            cursor: pointer;
            opacity: 0.62;
            /* 合并 / 拆开时圆角要跟着动，别一下子跳变形 */
            transition: background 120ms, opacity 120ms,
                border-radius 120ms ease-out;
        }
        .xmlg-scope-btn:hover {
            opacity: 0.9;
        }
        .xmlg-scope-btn.is-active {
            opacity: 1;
            background: color-mix(
                in srgb,
                var(--xmlg-accent) 26%,
                transparent
            );
            box-shadow: inset 0 0 0 1px color-mix(
                in srgb,
                var(--xmlg-accent) 45%,
                transparent
            );
        }
        /* 这一档里一个文件都没有：切过去也没东西可动，先淡下去 */
        .xmlg-scope-btn.is-empty {
            opacity: 0.32;
        }
        /* 单击组头 = 让 ✔ ✖ ⇄ 只作用于这一组，这里显示是哪一组。
           它和「分组」拼成**同一个胶囊**的两半：中间不留缝、外圈只有一根
           边框，实心底色的「分组」在左边收圆、右边接平，组号在右边续上，
           看起来就是 (分组｜组 2)。 */
        .xmlg-scope-chip {
            /* 常驻 DOM、收成 0 宽：靠 grid 列宽 0fr → 1fr 平滑长出来，
               而不是 display:none 一下蹦出来（那没法做动画） */
            display: inline-grid;
            /* 必须写 minmax(0, …)：光写 0fr 会被内容的「最小宽度」兜住，
               收起时还留着内边距那 13px，收不干净 */
            grid-template-columns: minmax(0, 0fr);
            align-items: center;
            flex: 0 0 auto;
            margin-left: 0;
            padding: 0;
            border: none;
            opacity: 0;
            overflow: hidden;
            pointer-events: none;
            transition:
                grid-template-columns 200ms cubic-bezier(0.22, 0.61, 0.36, 1),
                opacity 160ms ease;
            border-radius: 0 999px 999px 0;
            /* 内容宽度交给内部撑开，超长时自己收省略号 */
            max-width: 110px;
            /* 描边用**这一组自己的颜色**，不用品牌粉：这半段的底子是组色，
               套一圈粉边会互相染色、看着像另一种颜色。组色描边和底色同源，
               在接缝处正好和左边的粉边形成一条双色分界线 */
            box-shadow: inset 0 0 0 1px color-mix(
                in srgb,
                var(--xmlg-group-stripe, var(--xmlg-accent)) 70%,
                transparent
            );
            background: color-mix(
                in srgb,
                var(--xmlg-group-stripe, var(--xmlg-accent)) 22%,
                transparent
            );
            color: var(--xmlg-text);
            font: inherit;
            font-size: 10px;
            line-height: 1.5;
            cursor: pointer;
        }
        .xmlg-scope-chip.is-visible {
            /* 抵消容器那 2px 段间缝，和左边的「分组」严丝合缝 */
            grid-template-columns: minmax(0, 1fr);
            margin-left: -2px;
            opacity: 1;
            pointer-events: auto;
        }
        .xmlg-scope-chip-inner {
            display: inline-flex;
            align-items: center;
            gap: 5px;
            min-width: 0;
            overflow: hidden;
            padding: 2px 7px 2px 6px;
            white-space: nowrap;
        }
        /* 合并态：「分组」那段右边不再收圆，实心底色和组号连成一片，
           只在最外侧收圆。两者之间原本 2px 的段间缝用负外边距抵消掉，
           这样 Files / All / 分组 之间的缝还是原来的 2px，不会被一起拉紧 */
        .xmlg-scope-btn.is-scoped {
            /* 合并态：右边缘不收圆角，内描边照旧留着。
               组号那半有同一圈描边、位置严丝合缝，两段描边叠起来看着
               就是**整条胶囊的一圈边框**，不会在接缝处「收口」 */
            border-radius: 999px 0 0 999px;
        }
        .xmlg-scope-chip-text {
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }
        .xmlg-scope-chip-close {
            flex: 0 0 auto;
            opacity: 0.7;
        }
        .xmlg-scope-chip:hover .xmlg-scope-chip-close {
            opacity: 1;
        }
        /* 「只作用于这一组」的标记：用品牌粉，不用组色。
           组色和组头自己的底色太接近，画布缩小后这根线就看不见了；
           品牌粉在深色/浅色两套主题下都够扎眼。2px 是为了小缩放也认得出。 */
        .xmlg-group-head.is-scope-target {
            box-shadow: inset 0 0 0 2px var(--xmlg-accent, #ff385c);
        }
        /* 折叠 / 展开那一下的高度收放：过渡只在这 160ms 里挂着，
           平时不挂——否则换缩略图、改行内容也会跟着动一下。
           内边距和上下边框也要一起收：只收 height 的话，行压到 0 还剩
           10px（上下内边距 8 + 边框 2），那一截会在最后「啪」地消失。 */
        .xmlg-row.is-folding {
            transition:
                height ${SLIDE_MS}ms cubic-bezier(0.2, 0, 0.6, 1),
                margin-top ${SLIDE_MS}ms cubic-bezier(0.2, 0, 0.6, 1),
                padding-top ${SLIDE_MS}ms cubic-bezier(0.2, 0, 0.6, 1),
                padding-bottom ${SLIDE_MS}ms cubic-bezier(0.2, 0, 0.6, 1),
                border-top-width ${SLIDE_MS}ms cubic-bezier(0.2, 0, 0.6, 1),
                border-bottom-width ${SLIDE_MS}ms cubic-bezier(0.2, 0, 0.6, 1),
                opacity ${SLIDE_MS}ms linear;
        }
        /* 组内行的序号（含没有序号时的「–」）用组色，和左侧竖线呼应 */
        .xmlg-row.is-grouped .xmlg-seq {
            color: var(--xmlg-group-stripe, var(--xmlg-accent));
            opacity: 1;
            border-right-color: color-mix(
                in srgb,
                var(--xmlg-group-stripe, var(--xmlg-accent)) 45%,
                transparent
            );
        }
        /* 每组一根竖线：整组一条，画在行边框外面的留白里。
           做成一个绝对定位元素（而不是每行一个伪元素），组头和第一行
           之间才不会断成两截。上下位置由脚本按组头和最后一行的位置算。 */
        .xmlg-group-rail {
            position: absolute;
            /* 列表左内边距 6px、行边框正好在 6px 处：竖线占 1~4px，在边框外 */
            left: 1px;
            width: 3px;
            border-radius: 3px;
            background: var(--xmlg-group-stripe, var(--xmlg-accent));
            pointer-events: none;
        }
        .xmlg-row.is-selected {
            border-color: var(--xmlg-accent);
            box-shadow: inset 0 0 0 1px var(--xmlg-accent);
        }
        .xmlg-group-head.is-group-target {
            border-color: color-mix(
                in srgb,
                var(--xmlg-group-stripe, var(--xmlg-accent)) 70%,
                transparent
            );
        }
        .xmlg-group-head.is-drop-target {
            border-color: var(--xmlg-accent);
            background: color-mix(
                in srgb,
                var(--xmlg-accent) 20%,
                transparent
            );
        }
        /* 拖动中的行：不能只靠变淡（那和禁用分不开），用虚线 + 强调色
           底 + 抬起表示「正被搬走」。必须写在 :hover / .is-disabled
           之后，两者同时命中时以拖动为准。 */
        /* 拖动中的行不再是「抬起的那张卡片」——卡片是浏览器自己画的
           拖影，这里的原件留在列表里当「空槽位」：位置就是落点，
           用户看到的是一个虚线框，松手就地变成这一行。 */
        /* 拖动中的行只把「内容」藏起来，它占的那一格留着：
           这样列表里能看出这一格空出来、要落在这儿（让位动画也才有东西可让）。
           用 display: none 的话整行连位置一起消失，拖动时列表纹丝不动，
           就看不出会插到哪了。 */
        .xmlg-row.is-dragging {
            visibility: hidden;
        }
        /* 拖动中整个列表不参与鼠标命中：悬停样式（行边框变色、按钮变亮、
           缩略图预览）就全部自然失效——边框一亮会被误读成「放上来就覆盖」。
           落点只按位置算，跟指针压在谁身上无关。 */
        body.xmlg-pointer-dragging .xmlg-list {
            pointer-events: none;
        }
        /* 跟着指针走的卡片：源行已经藏起来了，这一张就是它本身 */
        .xmlg-drag-ghost {
            position: fixed;
            z-index: 99999;
            pointer-events: none;
            /* 不透明：半透明会把下面那行透出来，看起来像是重影 */
            opacity: 1;
            /* 不许放大：放大 1% 就会往两边各溢出一个像素，
               正好压住行左边那根组竖线，竖线就看不清了。
               卡片和原来的行一样大，只靠阴影表现「浮起来」。 */
            box-shadow: var(--xdh-shadow-popup, 0 10px 26px rgba(0, 0, 0, 0.45));
        }
        /* 卡片必须完全不透明：禁用行本身是 50% 半透明，直接克隆过来
           会透出下面的行，看着像重影（选择器要比 .is-disabled 更具体） */
        .xmlg-row.xmlg-drag-ghost,
        .xmlg-group-head.xmlg-drag-ghost {
            opacity: 1;
        }
        /* 组胶囊的底色是「组色 20% + 透明」，拿它当卡片会透出下面的行：
           换成同一个颜色压在不透明底色上 */
        .xmlg-group-head.xmlg-drag-ghost {
            background: color-mix(
                in srgb,
                var(--xmlg-group-stripe, var(--xmlg-accent)) 18%,
                var(--xmlg-surface-strong)
            );
        }
        /* 指针拖动期间：不选中文字，光标保持「抓着」 */
        body.xmlg-pointer-dragging {
            user-select: none;
            cursor: grabbing;
        }
        /* 拖一行进组时，这一组的竖线要跟着变长：
           给它一个和行让位同长的过渡，别瞬间跳到新长度。
           只在指针拖动期间开——否则刷新页面时竖线会从 3px 长出来。 */
        body.xmlg-pointer-dragging .xmlg-group-rail {
            transition:
                height ${SLIDE_MS}ms cubic-bezier(0.2, 0, 0, 1),
                top ${SLIDE_MS}ms cubic-bezier(0.2, 0, 0, 1);
        }
        /* 让位时正在滑动的行：交给合成层，长列表里不抖 */
        .xmlg-row.is-sliding,
        .xmlg-group-head.is-sliding {
            will-change: transform;
        }
        /* 拖整组时这一摞一起变淡（比单行更淡：表示整块在搬） */
        .xmlg-row.is-block-dragging {
            opacity: 0.45;
        }
        /* 拖整组时这一组当场折起来：只留组名那一行
           （和「折叠组」看起来一致，只是不改数据） */
        /* 组内成员：整块让开，不占位置 */
        .xmlg-row.is-drag-collapsed {
            display: none;
        }
        /* 组名那一行：内容藏起来，但那一格留着当空位，
           拖动时其它组和行才能滑开让位，看出这一组会落到哪 */
        .xmlg-group-head.is-drag-collapsed {
            visibility: hidden;
        }
        .xmlg-group-head.is-dragging {
            cursor: grabbing;
            opacity: 0.7;
        }
        /* 组头本身就是一整行贯穿的胶囊：底色用组色兑淡、边框用组色，
           箭头 / 名字 / 计数 / 设置按钮都住在里面。顶上不画分隔线。 */
        .xmlg-row input,
        .xmlg-group-name-input {
            user-select: text;
        }
        .xmlg-group-head {
            user-select: none;
            position: relative;
            display: flex;
            align-items: center;
            /* 箭头、名字之间留出呼吸区（原来 6px 挤在一起）。
               计数胶囊要把这份间距收回去，贴着设置按钮，所以留个变量 */
            --xmlg-head-gap: 9px;
            gap: var(--xmlg-head-gap);
            min-height: 28px;
            /* 不要额外上边距：列表本身就是 4px 间距，再加 6px 会让
               「组上方的缝」比「组下方」「行与行之间」都大一截 */
            margin: 0;
            /* 右内边距要和上下一样（2px + 1px 边框 = 4px 视觉缝）：
               原来是 8px，设置按钮右边空出 9px、上下只有 4px，看着往左歪 */
            padding: 2px 3px 2px 4px;
            border: 1px solid color-mix(
                in srgb,
                var(--xmlg-group-stripe, var(--xmlg-accent)) 40%,
                transparent
            );
            border-radius: 999px;
            background: color-mix(
                in srgb,
                var(--xmlg-group-stripe, var(--xmlg-accent)) 16%,
                transparent
            );
            font-size: 11px;
            line-height: 1.2;
            box-sizing: border-box;
        }
        .xmlg-group-arrow {
            flex: 0 0 auto;
            width: 18px;
            height: 18px;
            margin-left: 1px;
            padding: 0;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            border: 1px solid transparent;
            border-radius: 999px;
            background: transparent;
            color: inherit;
            font: inherit;
            line-height: 1;
            cursor: pointer;
        }
        /* 用图标而不是字符：字符受字号限制，缩小后笔画糊在一起 */
        .xmlg-group-arrow::before {
            content: "";
            width: 16px;
            height: 16px;
            background: currentColor;
            -webkit-mask: url("${GROUP_ARROW_ICON_URL}") center / contain
                no-repeat;
            mask: url("${GROUP_ARROW_ICON_URL}") center / contain no-repeat;
            transition: transform 160ms cubic-bezier(0.2, 0, 0.6, 1);
        }
        /* 展开时朝下，折叠时就地转成朝右 */
        .xmlg-group-arrow.is-collapsed::before {
            transform: rotate(-90deg);
        }
        .xmlg-group-arrow:hover {
            border-color: var(--xmlg-border);
            background: var(--xmlg-surface-strong);
        }
        /* 折叠组的「已启用 / 总数」：紧挨在设置按钮左边的一个小胶囊，
           中间固定留一个间距。位置靠「吃掉剩余空间」定住，所以组名多长
           都影响不到它——长名字自己收省略号，胶囊纹丝不动。 */
        .xmlg-group-count {
            flex: 0 0 auto;
            margin-left: auto;
            display: inline-flex;
            align-items: center;
            /* 展开时宽度收到 0、全透明，但一直占着位置：收拢这 160ms 里
               慢慢长出来，而不是等动画结束重画那一帧突然冒出来 */
            max-width: 0;
            padding: 1px 0;
            border: 1px solid color-mix(
                in srgb,
                var(--xmlg-group-stripe, var(--xmlg-accent)) 34%,
                transparent
            );
            border-radius: 999px;
            background: color-mix(
                in srgb,
                var(--xmlg-group-stripe, var(--xmlg-accent)) 14%,
                transparent
            );
            border-width: 0;
            font-size: 10px;
            line-height: 1.4;
            font-variant-numeric: tabular-nums;
            white-space: nowrap;
            overflow: hidden;
            opacity: 0;
            transition:
                max-width ${SLIDE_MS}ms cubic-bezier(0.2, 0, 0.6, 1),
                padding ${SLIDE_MS}ms cubic-bezier(0.2, 0, 0.6, 1),
                border-width ${SLIDE_MS}ms cubic-bezier(0.2, 0, 0.6, 1),
                opacity ${SLIDE_MS}ms cubic-bezier(0.2, 0, 0.6, 1);
            /* 数字不该抢走按住组头的鼠标事件 */
            pointer-events: none;
        }
        .xmlg-group-head.is-collapsed .xmlg-group-count {
            max-width: 80px;
            padding: 1px 7px;
            border-width: 1px;
            opacity: 1;
        }
        /* 名字前面的序列号徽标：「组 3」这个号才是这一组的身份，
           工具栏要指代某一组时念的就是它 */
        .xmlg-group-seq {
            flex: 0 0 auto;
            min-width: 16px;
            padding: 0 5px;
            border: 1px solid var(--xmlg-border);
            border-radius: 999px;
            background: color-mix(
                in srgb,
                var(--xmlg-group-stripe, var(--xmlg-accent)) 14%,
                transparent
            );
            color: var(--xmlg-text);
            font-size: 10px;
            font-variant-numeric: tabular-nums;
            line-height: 1.5;
            text-align: center;
            opacity: 0.85;
        }
        .xmlg-group-seq.is-hidden {
            display: none;
        }
        .xmlg-group-name {
            flex: 0 1 auto;
            min-width: 0;
            /* 剩下的空间归名字（超长就省略号），右边的计数和设置按钮
               因此始终贴在最右侧 */
            margin-right: 0;
            font-weight: 600;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            cursor: text;
        }
        .xmlg-group-name-input {
            flex: 1 1 auto;
            min-width: 60px;
            height: 20px;
            padding: 0 6px;
            border: 1px solid var(--xmlg-accent);
            border-radius: 999px;
            background: var(--xmlg-canvas, rgba(0, 0, 0, 0.35));
            color: inherit;
            font: inherit;
            font-size: 11px;
            box-sizing: border-box;
        }
        /* 胶囊里的设置按钮：圆角跟着胶囊走，不然右端会显得方方正正 */
        .xmlg-group-settings {
            /* 靠右的活交给计数胶囊做（它要贴着这个按钮）：
               两个 auto 外边距会把剩余空间五五分，计数就贴不过来了 */
            margin-left: 0;
            flex: 0 0 auto;
            width: auto;
            min-width: 0;
            height: 20px;
            padding: 0 10px;
            border-radius: 999px;
            background: color-mix(
                in srgb,
                var(--xmlg-group-stripe, var(--xmlg-accent)) 22%,
                transparent
            );
            font-size: 10px;
            white-space: nowrap;
            /* 按钮的基础外观必须写在这里：这份引擎两个节点共用，不能去
               捡某个节点面板里的按钮样式——捡不到就会退化成浏览器默认
               按钮（黑字 + 2px 立体边框），看着像坏了。 */
            display: inline-flex;
            align-items: center;
            justify-content: center;
            border: 1px solid var(--xmlg-border);
            color: var(--xmlg-text);
            font: inherit;
            font-size: 10px;
            line-height: 1;
            cursor: pointer;
            box-sizing: border-box;
        }
        .xmlg-group-settings:hover {
            border-color: var(--xmlg-accent);
        }
        .xmlg-group-btn {
            width: auto;
            min-width: 0;
            flex: 0 0 auto;
            padding: 0 8px;
            font-size: 11px;
            /* 宽度紧的时候宁可让右边的状态文字省略，也别把按钮折成两行 */
            white-space: nowrap;
        }
        .xmlg-modal {
            position: absolute;
            inset: 0;
            z-index: 30;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 12px;
            background: var(--xmlg-scrim, rgba(0, 0, 0, 0.55));
            backdrop-filter: blur(1.5px);
            box-sizing: border-box;
        }
        .xmlg-modal-card {
            width: 100%;
            max-width: 320px;
            display: flex;
            flex-direction: column;
            gap: 8px;
            padding: 12px;
            border-radius: var(--xdh-radius-sm, 8px);
            border: 1px solid var(--xmlg-border, rgba(255, 255, 255, 0.14));
            background: var(--xmlg-surface-strong, rgba(32, 32, 36, 0.96));
            box-shadow: var(--xdh-shadow-popup, 0 12px 32px rgba(0, 0, 0, 0.5));
            box-sizing: border-box;
        }
        .xmlg-modal-title {
            font-size: 12px;
            font-weight: 600;
        }
        .xmlg-modal-field {
            display: flex;
            flex-direction: column;
            gap: 4px;
        }
        .xmlg-modal-label {
            font-size: 10px;
            opacity: 0.6;
        }
        .xmlg-modal-input {
            width: 100%;
            height: 26px;
            padding: 0 8px;
            border: 1px solid var(--xmlg-border, rgba(255, 255, 255, 0.14));
            border-radius: var(--xdh-radius-xs, 4px);
            background: var(--xmlg-canvas, rgba(0, 0, 0, 0.35));
            color: inherit;
            font: inherit;
            font-size: 11px;
            box-sizing: border-box;
        }
        .xmlg-modal-input:focus {
            outline: none;
            border-color: var(--xmlg-accent);
        }
        /* 色球排成 7 列：14 个颜色正好两行，左对齐、间距一致，
           不会再出现「最后一行只剩一颗」的样子 */
        .xmlg-swatches {
            display: grid;
            grid-template-columns: repeat(7, 18px);
            gap: 6px;
            justify-content: start;
            align-items: center;
        }
        .xmlg-swatch {
            width: 18px;
            height: 18px;
            padding: 0;
            border: 1px solid var(--xmlg-border, rgba(255, 255, 255, 0.14));
            border-radius: 999px;
            background: var(--xmlg-swatch, var(--xmlg-accent));
            cursor: pointer;
            box-sizing: border-box;
        }
        /* 选中的颜色：外圈描一道亮边，深色浅色主题都看得清 */
        .xmlg-swatch.is-active {
            box-shadow: 0 0 0 2px var(--xmlg-surface-strong, #202024),
                0 0 0 3px var(--xmlg-swatch, var(--xmlg-accent));
        }
        .xmlg-swatch:hover {
            box-shadow: 0 0 0 2px var(--xmlg-surface-strong, #202024),
                0 0 0 3px color-mix(
                    in srgb,
                    var(--xmlg-swatch, var(--xmlg-accent)) 70%,
                    transparent
                );
        }
        .xmlg-modal-text {
            font-size: 11px;
            line-height: 1.5;
            opacity: 0.8;
        }
        .xmlg-modal-actions {
            display: flex;
            flex-direction: column;
            gap: 6px;
        }
        .xmlg-modal-btn {
            width: 100%;
            height: 26px;
            padding: 0 8px;
            border: 1px solid var(--xmlg-border, rgba(255, 255, 255, 0.14));
            /* 按钮圆角跟着两个列表的按钮走（--xdh-radius-sm = 8px） */
            border-radius: var(--xdh-radius-sm, 8px);
            background: var(--xmlg-surface, rgba(255, 255, 255, 0.06));
            color: inherit;
            font: inherit;
            font-size: 11px;
            line-height: 1;
            cursor: pointer;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            box-sizing: border-box;
        }
        .xmlg-modal-btn:hover {
            border-color: var(--xmlg-accent);
        }
        .xmlg-modal-btn.is-danger {
            border-color: var(--xmlg-danger, #D90429);
            color: var(--xmlg-danger-bright, #FF6B6B);
        }
        .xmlg-modal-btn.is-danger:hover {
            background: var(--xmlg-danger-soft, rgba(217, 4, 41, 0.16));
        }
        .xmlg-insert-line {
            position: absolute;
            left: 4px;
            right: 4px;
            height: 2px;
            border-radius: 2px;
            background: var(--xmlg-warning-strong);
            box-shadow: 0 0 8px var(--xmlg-warning-strong);
            pointer-events: none;
            display: none;
            z-index: 6;
        }
        .xmlg-toast {
            position: absolute;
            left: 50%;
            top: 42px;
            transform: translateX(-50%);
            max-width: 92%;
            padding: 5px 10px;
            border-radius: var(--xdh-radius-sm, 8px);
            background: var(--xmlg-toast-bg);
            border: 1px solid var(--xmlg-accent);
            color: inherit;
            font-size: 11px;
            display: none;
            z-index: 20;
            text-align: center;
            box-sizing: border-box;
        }
        .xmlg-toast.is-visible {
            display: block;
            animation: xmlg-toast-in 120ms ease-out;
        }
        .xmlg-toast.is-warning {
            border-color: var(--xmlg-warning);
            background: var(--xmlg-warning-surface);
            color: var(--xmlg-warning-text);
            font-weight: 600;
        }
        @keyframes xmlg-toast-in {
            from { opacity: 0; transform: translate(-50%, -4px); }
            to { opacity: 1; transform: translate(-50%, 0); }
        }
        .xmlg-hint {
            position: fixed;
            z-index: 99998;
            pointer-events: none;
            display: none;
            max-width: 260px;
            padding: 5px 8px;
            border-radius: var(--xdh-radius-xs, 4px);
            background: var(
                --xdh-color-surface-3,
                var(--xdh-clr-surface-strong, #1d1d20)
            );
            border: 1px solid var(
                --xdh-clr-hairline,
                rgba(255, 255, 255, 0.12)
            );
            color: var(--xdh-color-text-primary, var(--xdh-clr-ink, #ffffff));
            box-shadow: var(
                --xdh-shadow-popup,
                0 8px 24px rgba(0, 0, 0, 0.15)
            );
            font-size: 11px;
            line-height: 1.35;
            white-space: normal;
            overflow-wrap: break-word;
        }
        .xmlg-hint.is-visible {
            display: block;
        }
`;

/**
 * 返回分组那一层的样式表。
 *
 * hosts 是「颜色变量挂在哪些元素上」：分组元素自己不带变量，靠所在面板
 * 兜住（媒体面板传 .xmlg-panel，LoRA 面板传 .xlora-panel）。
 */
function groupStyles(hosts = [".xmlg-panel"]) {
    return GROUP_CSS_TEXT.replace(
        "__GROUP_HOSTS__",
        hosts.length ? hosts.join(", ") : ".xmlg-panel"
    );
}

function createGroupEngine(ctx) {
    // 名词每次都现取：语言包是异步到的，写死在模块加载时就会一直念英文。
    const nounManyOf = typeof ctx.nounMany === "function"
        ? ctx.nounMany
        : () => ctx.nounMany || "files";
    const nounOneOf = typeof ctx.nounOne === "function"
        ? ctx.nounOne
        : () => ctx.nounOne || "file";
    const tBase = ctx.t;
    // 文案里的 {noun} / {nounOne} 由这里统一填：同一句话两个节点各念各的名词
    const t = (key, fallback, vars) => tBase(
        key,
        fallback,
        { noun: nounManyOf(), nounOne: nounOneOf(), ...(vars || {}) }
    );
    // 「这一行现在是开着还是关掉」：媒体用 enabled，LoRA 用 active，
    // 字段名由调用方注入；缺省按媒体的写法。
    const readRowOn = typeof ctx.isRowEnabled === "function"
        ? ctx.isRowEnabled
        : (row) => !!row && row.enabled !== false;
    const isRowOn = (row) => readRowOn(row) !== false;
    const writeRowOn = typeof ctx.setRowEnabled === "function"
        ? ctx.setRowEnabled
        : (row, value) => {
            row.enabled = !!value;
        };
    const setRowOn = (row, value) => {
        if (row) {
            writeRowOn(row, !!value);
        }
    };
    const {
        element,
        keyOf: XMLG_KEY_OF,
        normalizeItems,
        emptyItems,
        writeItems,
        renderPanel,
        ensureStorageWidget,
        scrollRowIntoView,
        syncOutputPortType,
        startDropAutoScroll,
        stopDropAutoScroll,
        dragCountFromDataTransfer,
        hideTypeMismatch,
        hintHost,
        buildRow,
    } = ctx;
    // 落地逻辑在媒体层，媒体层又要回调引擎（liveMoveRow / resolveGroupGap），
    // 所以晚绑定，避免「引擎还没造好就要拿函数」。
    const applyPointerDragStop = (...args) => ctx.applyPointerDragStop(...args);
    // 面板挂在节点的哪个字段上由调用方决定（媒体 __xmlg_panel，LoRA __xlora_panel）
    const PANEL_KEY = ctx.panelKey || "__xmlg_panel";
    function panelOf(node) {
        return node ? node[PANEL_KEY] : null;
    }
    let hintElement = null;

function pushUndoSnapshot(node) {
    const panel = panelOf(node);
    if (!panel) {
        return;
    }
    const widget = ensureStorageWidget(node);
    const value = String(widget?.value || "{}");
    const stack = panel.state.undoStack || [];
    if (stack[stack.length - 1] === value) {
        return;
    }
    stack.push(value);
    if (stack.length > 30) {
        stack.shift();
    }
    panel.state.undoStack = stack;
}

function updateUndoButton(node) {
    const panel = panelOf(node);
    if (!panel) {
        return;
    }
    const undoStack = panel.state.undoStack || [];
    const redoStack = panel.state.redoStack || [];
    if (panel.undoButton) {
        panel.undoButton.disabled = undoStack.length === 0;
    }
    if (panel.redoButton) {
        panel.redoButton.disabled = redoStack.length === 0;
    }
}

function applySnapshot(node, raw) {
    const panel = panelOf(node);
    if (!panel) {
        return;
    }
    let items = emptyItems();
    try {
        items = normalizeItems(JSON.parse(raw));
    } catch {
        items = emptyItems();
    }
    panel.state.items = items;
    panel.state.missing = new Set();
    writeItems(node, items, { recordUndo: false });
    renderPanel(node);
    syncOutputPortType(node);
}

function undoLastChange(node) {
    const panel = panelOf(node);
    const stack = panel?.state?.undoStack || [];
    if (!stack.length) {
        return;
    }
    const current = String(ensureStorageWidget(node)?.value || "{}");
    const raw = stack.pop();
    panel.state.redoStack = [
        ...(panel.state.redoStack || []),
        current,
    ];
    applySnapshot(node, raw);
}

function redoLastChange(node) {
    const panel = panelOf(node);
    const stack = panel?.state?.redoStack || [];
    if (!stack.length) {
        return;
    }
    const current = String(ensureStorageWidget(node)?.value || "{}");
    const raw = stack.pop();
    panel.state.undoStack = [
        ...(panel.state.undoStack || []),
        current,
    ];
    applySnapshot(node, raw);
}

function showToast(node, message, options = {}) {
    const panel = panelOf(node);
    if (!panel || !message) {
        return;
    }
    panel.toast.textContent = message;
    panel.toast.classList.toggle("is-warning", !!options.warning);
    panel.toast.classList.add("is-visible");
    if (panel.state.toastTimer) {
        clearTimeout(panel.state.toastTimer);
    }
    panel.state.toastTimer = window.setTimeout(() => {
        panel.toast.classList.remove("is-visible");
        panel.state.toastTimer = 0;
    }, TOAST_DURATION_MS);
}

function groupColorValue(colorId) {
    const picked = GROUP_COLORS.find((item) => item.id === colorId);
    return picked ? picked.value : "";
}

function groupColorId(group) {
    const record = group && typeof group === "object" ? group : null;
    if (record && groupColorValue(record.color)) {
        return record.color;
    }
    const text = String(record ? record.id : group || "");
    let hash = 0;
    for (let index = 0; index < text.length; index += 1) {
        hash = (hash * 31 + text.charCodeAt(index)) >>> 0;
    }
    return GROUP_COLORS[hash % GROUP_COLORS.length].id;
}

function groupStripeColor(group) {
    return groupColorValue(groupColorId(group));
}

function pruneSelection(state, items) {
    const alive = new Set((items || []).map((entry) => XMLG_KEY_OF(entry)));
    for (const key of Array.from(state.selection || [])) {
        if (!alive.has(key)) {
            state.selection.delete(key);
        }
    }
    if (!state.selection.size) {
        state.selectionAnchor = null;
        return;
    }
    if (
        state.selectionAnchor == null
        || state.selectionAnchor >= items.length
    ) {
        state.selectionAnchor = Math.max(0, items.length - 1);
    }
}

function handleRowSelection(node, category, key, index, event) {
    const state = panelOf(node)?.state;
    if (!state) {
        return;
    }
    const additive = event.ctrlKey || event.metaKey;
    const items = state.items[category] || [];
    if (
        event.shiftKey
        && Number.isFinite(state.selectionAnchor)
    ) {
        const start = Math.min(state.selectionAnchor, index);
        const end = Math.max(state.selectionAnchor, index);
        if (!additive) {
            state.selection.clear();
        }
        for (let cursor = start; cursor <= end; cursor += 1) {
            const entry = items[cursor];
            if (entry) {
                state.selection.add(XMLG_KEY_OF(entry));
            }
        }
    } else if (additive) {
        if (state.selection.has(key)) {
            state.selection.delete(key);
        } else {
            state.selection.add(key);
        }
        state.selectionAnchor = index;
    } else {
        const alreadyOnly = state.selection.size === 1
            && state.selection.has(key);
        state.selection.clear();
        if (!alreadyOnly) {
            state.selection.add(key);
        }
        state.selectionAnchor = index;
    }
    renderPanel(node);
}

function ungroupedSelection(state, category) {
    const list = state?.items?.[category] || [];
    const picked = [];
    for (const entry of list) {
        if (entry.group) {
            continue;
        }
        if (state.selection.has(XMLG_KEY_OF(entry))) {
            picked.push(XMLG_KEY_OF(entry));
        }
    }
    return picked;
}

function createGroupFromCurrentSelection(node) {
    const panel = panelOf(node);
    if (!panel) {
        return;
    }
    const state = panel.state;
    const category = state.category;
    if (!state.selection.size) {
        return;
    }
    const available = ungroupedSelection(state, category);
    if (!available.length) {
        // 选中的全都在组里：不动它们，也不造出空组
        showToast(
            node,
            t(
                "xdatahub.ui.group.group_all_selected_grouped",
                "Those are already in groups. Only ones without a group can start a new one.",
            ),
            { warning: true }
        );
        return;
    }
    const skipped = state.selection.size - available.length;
    const items = state.items;
    const groups = items.groups?.[category] || [];
    // 号不回收（删了组再建新的，号继续往后走），名字跟着号走
    const seq = nextGroupSeq(groups);
    const name = defaultGroupName(seq, groups);
    const result = createGroupFromSelection(
        items[category] || [],
        groups,
        available,
        name,
        { keyOf: XMLG_KEY_OF }
    );
    if (!result.id) {
        return;
    }
    items[category] = result.items;
    items.groups[category] = result.groups;
    state.selection.clear();
    state.selectionAnchor = null;
    writeItems(node, items, { dissolved: result.dissolved });
    renderPanel(node);
    // 建完直接进改名状态：名字天生是「组 N」，让用户顺手改掉
    beginGroupRename(node, result.id);
    scrollRowIntoView(node, Math.max(0, (result.insertAt || 0)));
    if (skipped > 0) {
        // 混选时明确告诉用户「有几个没算进去」，避免以为全都建进去了
        showToast(
            node,
            t(
                "xdatahub.ui.group.group_skipped_grouped",
                "Skipped {count} {noun} that are already in a group",
                { count: skipped }
            ),
            { warning: true }
        );
    }
}

function startGroupRename(node, category, groupId, head, nameEl) {
    if (!head || head.querySelector(".xmlg-group-name-input")) {
        return;
    }
    const groups = panelOf(node)?.state?.items?.groups?.[category];
    const record = (groups || []).find((item) => item.id === groupId);
    const input = document.createElement("input");
    input.type = "text";
    input.className = "xmlg-group-name-input";
    input.value = String(record?.name || "");
    nameEl.style.display = "none";
    // 名字现在包在胶囊里，输入框要插到同一层，别把胶囊撑坏
    nameEl.parentElement.insertBefore(input, nameEl);
    input.focus();
    input.select();
    let finished = false;
    const finish = (commit) => {
        if (finished) {
            return;
        }
        finished = true;
        const value = input.value.trim();
        // 列表重画时输入框可能已经被一起拆掉了，这里要容错：
        // 对着已经离开文档的节点再动一下会抛「不是子节点」的错
        if (input.parentElement) {
            input.remove();
        }
        if (nameEl.isConnected) {
            nameEl.style.display = "";
        }
        if (commit) {
            applyGroupRename(node, category, groupId, value);
        }
    };
    input.addEventListener("keydown", (event) => {
        // 不能把按键漏给画布（否则输入空格时画布可能吃到快捷键）
        event.stopPropagation();
        if (event.key === "Enter") {
            event.preventDefault();
            finish(true);
        } else if (event.key === "Escape") {
            event.preventDefault();
            finish(false);
        }
    });
    input.addEventListener("blur", () => finish(true));
}

function beginGroupRename(node, groupId) {
    const panel = panelOf(node);
    if (!panel || !groupId) {
        return;
    }
    const head = panel.list.querySelector(
        `.xmlg-group-head[data-group-id="${groupId}"]`
    );
    const nameEl = head?.querySelector(".xmlg-group-name");
    if (!head || !nameEl) {
        return;
    }
    startGroupRename(node, panel.state.category, groupId, head, nameEl);
}

function applyGroupRename(node, category, groupId, value) {
    const panel = panelOf(node);
    if (!panel) {
        return;
    }
    const items = panel.state.items;
    const groups = items.groups?.[category] || [];
    const record = groups.find((item) => item.id === groupId);
    const next = String(value || "").trim();
    // 空名字不接受；名字没变也不用重画。这里特意不重画：建完组会直接进
    // 改名状态，用户接着点折叠箭头时，这一下点击先触发「提交改名」，
    // 如果顺手把整张列表重画了，那个点击就跟着一起消失——看起来就是
    // 「第一次点折叠没反应」。名字真的变了才重画。
    if (!record || !next || next === record.name) {
        return;
    }
    items.groups[category] = renameGroup(groups, groupId, next);
    writeItems(node, items);
    renderPanel(node);
}

function groupMemberRowElements(list, groupId) {
    if (!list || !groupId) {
        return [];
    }
    // 行身上带着 data-group，拖动时也是靠它找「这一组还剩哪些可见行」
    return [...list.querySelectorAll(`.xmlg-row[data-group="${groupId}"]`)];
}

/**
 * 列表的行间距（`gap`）：折叠时靠一条负外边距把它一起收掉。
 * 收多少必须按列表实际的值来——这份引擎两个节点共用，XMediaListGet 的
 * 行间距是 4px，XLoraGet 是 8px，写死一边另一边就会收不干净。
 */
function listRowGap(list) {
    const gap = parseFloat(window.getComputedStyle(list).rowGap);
    return Number.isFinite(gap) && gap >= 0 ? gap : 4;
}

function foldGroupRowsOut(panel, groupId) {
    const list = panel?.list;
    const rows = groupMemberRowElements(list, groupId);
    if (!rows.length) {
        return false;
    }
    const rowGap = listRowGap(list);
    // 先把当前高度钉死，过渡才有起点（高度是 auto 的没得算）
    for (const row of rows) {
        row.style.height = `${row.offsetHeight}px`;
        row.style.overflow = "hidden";
        row.style.pointerEvents = "none";
    }
    // 强制一次重排，让「钉死的高度」落到样式里
    void list.offsetHeight;
    for (const row of rows) {
        row.classList.add("is-folding");
        row.style.height = "0px";
        // min-height 是 44px，不清掉的话压不到地板
        row.style.minHeight = "0px";
        row.style.opacity = "0";
        // 列表的行间距靠负外边距一起收掉，不然行都没了还留几道空隙
        row.style.marginTop = `-${rowGap}px`;
        // 上下内边距 + 边框也要收干净，否则行最低只能压到 10px
        row.style.paddingTop = "0px";
        row.style.paddingBottom = "0px";
        row.style.borderTopWidth = "0px";
        row.style.borderBottomWidth = "0px";
    }
    // 折叠状态提前挂到组头上：计数胶囊跟着这 160ms 慢慢长出来。
    // 等动画结束重画时，新组头一出生就是折叠后的样子，两边对得上。
    const head = list.querySelector(
        `.xmlg-group-head[data-group-id="${groupId}"]`
    );
    if (head) {
        head.classList.add("is-collapsed");
    }
    // 这 160ms 里整块列表不接鼠标：行正在收，点到、拖到都没有意义
    list.style.pointerEvents = "none";
    // 所有组的竖线每帧跟着重量（不只是这一组，下面那些组也在一起上移）
    followRailsDuringFold(panel);
    return true;
}

function seedCollapsedHeadLook(list, groupId) {
    const head = list?.querySelector(
        `.xmlg-group-head[data-group-id="${groupId}"]`
    );
    if (!head) {
        return;
    }
    head.classList.add("is-collapsed");
    const pill = head.querySelector(".xmlg-group-count");
    if (pill) {
        pill.style.transition = "none";
        pill.style.maxWidth = "80px";
    }
}

function unfoldGroupRowsIn(panel, groupId, targetScrollTop = NaN) {
    const list = panel?.list;
    const rows = groupMemberRowElements(list, groupId);
    if (!rows.length) {
        panel.foldBusy = false;
        return;
    }
    // 此刻行还是正常高度：先记下目标高度，顺便让调用方量的竖线算准
    const heights = rows.map((row) => row.offsetHeight);
    const savedScrollTop = Number.isFinite(targetScrollTop)
        ? targetScrollTop
        : list.scrollTop;
    // 重画出来的组头是「展开后」的样子，可用户刚看到的是折叠后的样子
    // （上面挂着计数胶囊）。先按折叠的样子摆回去，长开时再交还给 CSS
    // 过渡，胶囊就会跟着行一起收走，而不是当场消失。
    seedCollapsedHeadLook(list, groupId);
    // 从这里就开始跟：压扁的那两帧里这一组的竖线也得先缩下来
    followRailsDuringFold(panel);
    const rowGap = listRowGap(list);
    for (const row of rows) {
        row.style.height = "0px";
        row.style.minHeight = "0px";
        row.style.overflow = "hidden";
        row.style.opacity = "0";
        row.style.marginTop = `-${rowGap}px`;
        row.style.paddingTop = "0px";
        row.style.paddingBottom = "0px";
        row.style.borderTopWidth = "0px";
        row.style.borderBottomWidth = "0px";
        row.style.pointerEvents = "none";
    }
    // 这几行是刚插进 DOM 的：同一次任务里把高度改两遍，浏览器不会补
    // 过渡（元素还没算过一版样式）。等下一帧、让「压扁」这版样式真正
    // 算过一次之后再长开，才会看到从 0 拉起来的那 160ms。
    window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
            growGroupRowsIn(panel, list, rows, heights, savedScrollTop);
        });
    });
}

function growGroupRowsIn(panel, list, rows, heights, savedScrollTop) {
    // 这一帧里列表被重画过（换了分类、刷新了），这几行已经不在页面上了
    if (!list?.isConnected || !rows.every((row) => row.isConnected)) {
        if (panel) {
            panel.foldBusy = false;
        }
        return;
    }

    // 胶囊跟着行一起收：把展开时临时撑起来的宽度交还给 CSS 过渡。
    // 顺序不能反——先撤掉内联样式（恢复过渡），再摘掉折叠态才会动。
    const groupId = rows[0]?.dataset.group || "";
    const head = groupId
        ? list.querySelector(`.xmlg-group-head[data-group-id="${groupId}"]`)
        : null;
    if (head) {
        const pill = head.querySelector(".xmlg-group-count");
        if (pill) {
            pill.style.removeProperty("transition");
            pill.style.removeProperty("max-width");
        }
        head.classList.remove("is-collapsed");
    }
    rows.forEach((row, index) => {
        row.classList.add("is-folding");
        row.style.height = `${heights[index]}px`;
        row.style.opacity = "1";
        row.style.marginTop = "0px";
        // 内边距和边框的交还给 CSS（写回 4px / 1px），跟着一起长回来；
        // min-height 留到最后再还——它一回来就把高度顶到 44px，
        // 过渡还没开始就结束了
        row.style.paddingTop = "";
        row.style.paddingBottom = "";
        row.style.borderTopWidth = "";
        row.style.borderBottomWidth = "";
    });
    window.setTimeout(() => {
        for (const row of rows) {
            if (!row.isConnected) {
                continue;
            }
            row.classList.remove("is-folding");
            for (const prop of [
                "height",
                "min-height",
                "overflow",
                "opacity",
                "margin-top",
                "padding-top",
                "padding-bottom",
                "border-top-width",
                "border-bottom-width",
                "pointer-events",
            ]) {
                row.style.removeProperty(prop);
            }
        }
        // 胶囊的临时宽度也要收干净（动画被打断时可能还留着）
        if (head) {
            const pill = head.querySelector(".xmlg-group-count");
            if (pill) {
                pill.style.removeProperty("transition");
                pill.style.removeProperty("max-width");
            }
        }
        if (panel) {
            panel.foldBusy = false;
        }
        if (!list.isConnected || !panel) {
            return;
        }
        // 行缩到 0 的那一瞬间内容变短了，列表靠底时浏览器会把滚动位置
        // 往回顶；长回原样后把用户原来的位置还回去。
        if (list.scrollTop < savedScrollTop) {
            list.scrollTop = savedScrollTop;
        }
        // 现在高度才是真的，重新量一遍竖线
        panel.railMeasured = false;
        layoutGroupRails(panel);
    }, SLIDE_MS + 40);
}

function setGroupCollapsed(node, category, groupId, collapsed) {
    const panel = panelOf(node);
    if (!panel) {
        return;
    }
    // 动画那 160ms 里再点一下，直接不理：免得同时跑两段收放
    if (panel.foldBusy) {
        return;
    }
    const group = panel.state.items.groups?.[category] || [];
    const record = group.find((entry) => entry.id === groupId);
    if (!record || Boolean(record.collapsed) === Boolean(collapsed)) {
        return;
    }
    if (collapsed && foldGroupRowsOut(panel, groupId)) {
        // 收完再改数据重画（160ms）
        panel.foldBusy = true;
        window.setTimeout(() => {
            if (panel.foldBusy) {
                panel.foldBusy = false;
            }
            commitGroupCollapsed(node, category, groupId, true);
        }, SLIDE_MS);
        return;
    }
    commitGroupCollapsed(node, category, groupId, collapsed);
}

function commitGroupCollapsed(node, category, groupId, collapsed) {
    const panel = panelOf(node);
    if (!panel) {
        return;
    }
    // 收拢动画期间关掉的鼠标事件，到这里还回来（列表马上要重建，
    // 这行是给「收拢没走动画」那条路兜底的）
    if (panel.list) {
        panel.list.style.pointerEvents = "";
    }
    const items = panel.state.items;
    items.groups[category] = setCollapsed(
        items.groups?.[category] || [],
        groupId,
        collapsed
    );
    writeItems(node, items);
    // 展开时告诉 renderPanel：这一组刚长开，行要做入场动画
    panel.pendingExpand = collapsed ? "" : groupId;
    // 展开的动画在重画之后，结束才放开（见 growGroupRowsIn）
    panel.foldBusy = Boolean(panel.pendingExpand);
    renderPanel(node);
    panel.pendingExpand = "";
}

function closeGroupDialog(node) {
    const panel = panelOf(node);
    if (!panel) {
        return;
    }
    panel.modal?.remove();
    panel.modal = null;
}

function openGroupSettingsDialog(node, category, entry) {
    const panel = panelOf(node);
    if (!panel) {
        return;
    }
    closeGroupDialog(node);
    const groupId = entry.groupId;
    const group = entry.group;
    const count = entry.memberCount;
    const modal = element("div", "xmlg-modal");
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    const card = element("div", "xmlg-modal-card");
    card.appendChild(element(
        "div",
        "xmlg-modal-title",
        t(
            "xdatahub.ui.group.group_settings_title",
            "Group settings"
        )
    ));

    const nameField = element("label", "xmlg-modal-field");
    nameField.appendChild(element(
        "span",
        "xmlg-modal-label",
        t("xdatahub.ui.group.group_name_label", "Name")
    ));
    const input = document.createElement("input");
    input.type = "text";
    input.className = "xmlg-modal-input";
    input.maxLength = 60;
    input.value = String(group.name || groupId);
    input.addEventListener("keydown", (event) => {
        // 按键不能漏给画布（空格/方向键会被当成快捷键）
        event.stopPropagation();
        if (event.key === "Escape") {
            event.preventDefault();
            closeGroupDialog(node);
            return;
        }
        if (event.key === "Enter") {
            event.preventDefault();
            input.blur();
        }
    });
    input.addEventListener("change", () => {
        applyGroupRename(node, category, groupId, input.value);
        // 空名字不收：重画后把框里的内容拉回真名，别让用户以为改成功了
        const live = groupRecord(node, category, groupId);
        input.value = String(live?.name || groupId);
    });
    nameField.appendChild(input);
    card.appendChild(nameField);

    const colorField = element("div", "xmlg-modal-field");
    colorField.appendChild(element(
        "span",
        "xmlg-modal-label",
        t("xdatahub.ui.group.group_color_label", "Color")
    ));
    const swatches = element("div", "xmlg-swatches");
    const activeId = groupColorId(groupRecord(node, category, groupId) || group);
    for (const color of GROUP_COLORS) {
        const swatch = element("button", "xmlg-swatch");
        swatch.type = "button";
        swatch.dataset.color = color.id;
        swatch.style.setProperty("--xmlg-swatch", groupColorValue(color.id));
        const label = t(
            `xdatahub.ui.group.${color.nameKey}`,
            color.fallback
        );
        swatch.setAttribute("aria-label", label);
        swatch.setAttribute("aria-pressed", String(color.id === activeId));
        bindHint(swatch, () => label);
        if (color.id === activeId) {
            swatch.classList.add("is-active");
        }
        swatch.addEventListener("click", () => {
            applyGroupColor(node, category, groupId, color.id);
            for (const other of swatches.children) {
                const picked = other === swatch;
                other.classList.toggle("is-active", picked);
                other.setAttribute("aria-pressed", String(picked));
            }
        });
        swatches.appendChild(swatch);
    }
    colorField.appendChild(swatches);
    card.appendChild(colorField);

    card.appendChild(element(
        "div",
        "xmlg-modal-text",
        t(
            "xdatahub.ui.group.group_delete_hint",
            "This group holds {count} {noun}. Decide what happens to them.",
            { count }
        )
    ));

    // 按钮只写短标签（长句子会换行、按钮忽高忽低）；
    // 「点了会怎样」放到悬停提示里，想弄清的人一秒就能看到。
    const keepButton = element(
        "button",
        "xmlg-modal-btn",
        t(
            "xdatahub.ui.group.group_delete_keep",
            "Dissolve group"
        )
    );
    keepButton.type = "button";
    bindHint(keepButton, () => t(
        "xdatahub.ui.group.group_delete_keep_hint",
        "The {count} {noun} stay right where they are, just without a group.",
        { count }
    ));
    keepButton.addEventListener("click", () => {
        closeGroupDialog(node);
        applyGroupDelete(node, category, groupId, "ungroup");
    });

    const wipeButton = element(
        "button",
        "xmlg-modal-btn is-danger",
        t(
            "xdatahub.ui.group.group_delete_files",
            "Remove group and {noun} from list"
        )
    );
    wipeButton.type = "button";
    bindHint(wipeButton, () => t(
        "xdatahub.ui.group.group_delete_files_hint",
        "The group and its {count} {noun} leave this list. The {noun} themselves stay on disk."
            + "themselves stay on disk.",
        { count }
    ));
    wipeButton.addEventListener("click", () => {
        const message = t(
            "xdatahub.ui.group.group_delete_confirm",
            "Remove {count} {noun} from the list for good?",
            { count }
        );
        if (!window.confirm(message)) {
            return;
        }
        closeGroupDialog(node);
        applyGroupDelete(node, category, groupId, "delete");
    });

    const doneButton = element(
        "button",
        "xmlg-modal-btn",
        t("xdatahub.ui.group.group_done", "Done")
    );
    doneButton.type = "button";
    doneButton.addEventListener("click", () => closeGroupDialog(node));

    const actions = element("div", "xmlg-modal-actions");
    actions.appendChild(keepButton);
    actions.appendChild(wipeButton);
    actions.appendChild(doneButton);
    card.appendChild(actions);
    modal.appendChild(card);
    modal.addEventListener("click", (event) => {
        if (event.target === modal) {
            closeGroupDialog(node);
        }
    });
    modal.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
            event.preventDefault();
            closeGroupDialog(node);
        }
    });
    panel.panel.appendChild(modal);
    panel.modal = modal;
    // 焦点给名称框：破坏性按钮永远不能被回车顺手点到
    input.focus();
    input.select();
}

function groupRecord(node, category, groupId) {
    const state = panelOf(node)?.state;
    const groups = state?.items?.groups?.[category] || [];
    return groups.find((item) => item.id === groupId) || null;
}

function applyGroupColor(node, category, groupId, colorId) {
    const panel = panelOf(node);
    if (!panel) {
        return;
    }
    const items = panel.state.items;
    const groups = items.groups?.[category] || [];
    if (!groups.some((item) => item.id === groupId)) {
        return;
    }
    items.groups[category] = groups.map((item) => (
        item.id === groupId ? { ...item, color: colorId } : item
    ));
    writeItems(node, items);
    renderPanel(node);
}

function applyGroupDelete(node, category, groupId, mode) {
    const panel = panelOf(node);
    if (!panel) {
        return;
    }
    const items = panel.state.items;
    const result = deleteGroup(
        items[category] || [],
        items.groups?.[category] || [],
        groupId,
        mode
    );
    items[category] = result.items;
    items.groups[category] = result.groups;
    const alive = new Set(result.items.map((entry) => XMLG_KEY_OF(entry)));
    for (const key of Array.from(panel.state.selection)) {
        if (!alive.has(key)) {
            panel.state.selection.delete(key);
        }
    }
    writeItems(node, items);
    renderPanel(node);
    showToast(
        node,
        mode === "delete"
            ? t(
                "xdatahub.ui.group.group_files_deleted",
                "Removed a group and {count} {noun} from the list",
                { count: result.removed }
            )
            : t(
                "xdatahub.ui.group.group_ungrouped",
                "Moved {count} {noun} out of the group",
                { count: result.removed }
            ),
        { warning: mode === "delete" }
    );
}

function confirmRemovingGroupMember(node, category, entry) {
    const state = panelOf(node)?.state;
    if (!state || !entry?.group) {
        return true;
    }
    const members = groupMembers(state.items[category] || [], entry.group);
    if (members.length > 1) {
        return true;
    }
    const groups = state.items.groups?.[category] || [];
    const record = groups.find((item) => item.id === entry.group);
    return window.confirm(t(
        "xdatahub.ui.group.group_will_dissolve",
        "This is the last {nounOne} in group {name}. Removing it also removes the group. Continue?",
        { name: record?.name || entry.group }
    ));
}

function presetGroupNameAt(index) {
    if (index < 0 || index >= PRESET_GROUP_NAME_COUNT) {
        return "";
    }
    if (index < PRESET_GROUP_NAMES.length) {
        return PRESET_GROUP_NAMES[index];
    }
    const rest = index - PRESET_GROUP_NAMES.length;
    const adjectives = PRESET_GROUP_ADJECTIVES;
    const nouns = PRESET_GROUP_NOUNS;
    const adjective = adjectives[Math.floor(rest / nouns.length) % adjectives.length];
    const noun = nouns[rest % nouns.length];
    return `${adjective} ${noun}`;
}

function defaultGroupName(seq, groups = []) {
    const index = Math.trunc(Number(seq)) || 0;
    const taken = new Set(
        (Array.isArray(groups) ? groups : [])
            .map((group) => String(group?.name || "").trim().toLowerCase())
            .filter(Boolean)
    );
    for (
        let cursor = Math.max(0, index - 1);
        cursor < PRESET_GROUP_NAME_COUNT;
        cursor += 1
    ) {
        const preset = presetGroupNameAt(cursor);
        if (preset && !taken.has(preset.toLowerCase())) {
            return preset;
        }
    }
    return t(
        "xdatahub.ui.group.group_default_name",
        "Group {index}",
        { index }
    );
}

function groupSeqNumber(record) {
    const seq = Number(record && record.seq) || 0;
    return seq ? String(seq) : "";
}

function groupSeqLabel(record) {
    const seq = Number(record && record.seq) || 0;
    if (!seq) {
        // 极端情况（旧数据还没补号）：退回 id，也不会是用户的长名字
        return String((record && record.id) || "");
    }
    return t(
        "xdatahub.ui.group.group_default_name",
        "Group {index}",
        { index: seq }
    );
}

function groupTitle(record, fallback = "") {
    const name = String((record && record.name) || "").trim();
    return name || groupSeqLabel(record) || fallback;
}

function groupCountText(entry) {
    const members = Array.isArray(entry?.members) ? entry.members : [];
    const total = Number.isFinite(entry?.memberCount)
        ? entry.memberCount
        : members.length;
    const enabled = members.filter((row) => isRowOn(row)).length;
    return `${enabled}/${total}`;
}

function buildGroupHead(node, category, entry) {
    const group = entry.group;
    const head = element("div", "xmlg-group-head");
    head.dataset.groupId = entry.groupId;
    head.dataset.category = category;
    // 折叠状态同时挂到组头上：胶囊居中那个计数只在折叠时露出来
    head.classList.toggle("is-collapsed", Boolean(entry.collapsed));
    // 重建出来的组头也要带上「✔ ✖ ⇄ 只作用于这一组」的描边
    head.classList.toggle(
        "is-scope-target",
        (panelOf(node)?.state?.scopeGroup || null) === entry.groupId
    );
    head.style.setProperty(
        "--xmlg-group-stripe",
        groupStripeColor(group)
    );

    // 组头本身就是一个整行贯穿的胶囊：箭头 + 名字 + 计数 + 设置按钮
    const arrow = element("button", "xmlg-group-arrow");
    arrow.type = "button";
    arrow.classList.toggle("is-collapsed", Boolean(entry.collapsed));
    arrow.setAttribute("aria-expanded", String(!entry.collapsed));
    bindHint(arrow, () => (
        entry.collapsed
            ? t("xdatahub.ui.group.group_expand", "Expand")
            : t("xdatahub.ui.group.group_collapse", "Collapse")
    ));
    arrow.addEventListener("click", (event) => {
        // 箭头只负责折叠，不参与拖动，也不触发行的选择
        event.stopPropagation();
        setGroupCollapsed(node, category, entry.groupId, !entry.collapsed);
    });
    head.appendChild(arrow);

    // 序列号徽标：常态显示。数字是这一组的身份证，名字只是它的小名；
    // 有了它，工具栏上那句「只作用于组 3」永远对得上号。
    const title = groupTitle(group, entry.groupId);
    const seq = groupSeqOf(group);
    const seqBadge = element("span", "xmlg-group-seq", String(seq || ""));
    seqBadge.classList.toggle("is-hidden", !seq);
    head.appendChild(seqBadge);

    const name = element("span", "xmlg-group-name", title);
    bindHint(name, () => t(
        "xdatahub.ui.group.group_rename_tooltip",
        "Double-click to rename"
    ));
    name.addEventListener("dblclick", (event) => {
        event.stopPropagation();
        startGroupRename(node, category, entry.groupId, head, name);
    });
    head.appendChild(name);

    // 折叠起来就看不见成员了，把「这一组有几个文件」写在设置按钮左边；
    // 展开时成员都在眼前，这个数字是多余的，所以只在折叠时显示。
    const count = element(
        "span",
        "xmlg-group-count",
        groupCountText(entry)
    );
    head.appendChild(count);

    // 改名 / 换色 / 取消组 / 删除组都收进这个设置框，组头只留一个入口
    const settings = element(
        "button",
        "xmlg-group-settings",
        t("xdatahub.ui.group.group_settings", "Settings")
    );
    settings.type = "button";
    bindHint(settings, () => t(
        "xdatahub.ui.group.group_settings_tooltip",
        "Rename, recolor, or remove this group"
    ));
    settings.addEventListener("click", (event) => {
        event.stopPropagation();
        openGroupSettingsDialog(node, category, entry);
    });
    head.appendChild(settings);

    // 组头就是「整块的把手」：按住胶囊就能把这一组整摞搬走。
    // 展开组搬的是一整段，折叠组搬的只有组头（成员仍然跟着走）。
    // 和行一样走指针事件（浏览器自带的拖放事件太稀疏，滑不流畅）。
    bindHint(head, () => t(
        "xdatahub.ui.group.group_drag_tooltip",
        "Drag to move the whole group"
    ));
    head.addEventListener("pointerdown", (event) => {
        // 按在按钮上不算「抓组头」，否则点设置时手一抖就开始拖
        if (event.target?.closest?.("button, input")) {
            return;
        }
        armGroupPointerDrag(node, category, head, entry.groupId, event);
    });
    // 单击（没拖动）= 让 ✔ ✖ ⇄ 只作用于这一组，再点一次取消。
    // 拖完紧跟的那个 click 要吞掉，否则松手会顺手改了范围；
    // 双击（改名）也不能顺带改范围，所以延后一拍再决定。
    let scopeTapTimer = 0;
    head.addEventListener("click", (event) => {
        if (event.target?.closest?.("button, input")) {
            return;
        }
        const state = panelOf(node)?.state;
        if (!state) {
            return;
        }
        if (
            state.suppressClickUntil
            && performance.now() < state.suppressClickUntil
        ) {
            return;
        }
        if (isPassiveHeadZone(head, event)) {
            return;
        }
        window.clearTimeout(scopeTapTimer);
        scopeTapTimer = window.setTimeout(() => {
            toggleScopeGroup(node, category, entry.groupId);
        }, HEAD_TAP_DELAY_MS);
    });
    // 双击是「改名」，把刚才那一下单击撤销掉。
    // 必须用捕获阶段：名字自己的 dblclick 会 stopPropagation，
    // 冒泡阶段挂的监听根本收不到。
    head.addEventListener("dblclick", () => {
        window.clearTimeout(scopeTapTimer);
    }, true);
    head.addEventListener("dragstart", (event) => {
        event.preventDefault();
    });

    return head;
}

function ensureHintElement() {
    const host = hintHost();
    if (hintElement && hintElement.isConnected
        && hintElement.parentElement === host) {
        return hintElement;
    }
    if (!hintElement) {
        hintElement = element("div", "xmlg-hint");
    }
    host.appendChild(hintElement);
    return hintElement;
}

function positionHint(event) {
    const hint = hintElement;
    if (!hint) {
        return;
    }
    const margin = 12;
    const offsetX = 14;
    const offsetY = 22;
    hint.style.left = `${event.clientX + offsetX}px`;
    hint.style.top = `${event.clientY + offsetY}px`;
    const rect = hint.getBoundingClientRect();
    if (rect.right > window.innerWidth - margin) {
        hint.style.left = `${
            window.innerWidth - rect.width - margin
        }px`;
    }
    if (rect.bottom > window.innerHeight - margin) {
        hint.style.top = `${event.clientY - rect.height - 8}px`;
    }
}

function showHint(text, event) {
    const value = String(text || "");
    if (!value) {
        hideHint();
        return;
    }
    const hint = ensureHintElement();
    hint.textContent = value;
    hint.classList.add("is-visible");
    positionHint(event);
}

/** 收掉悬停提示：提示元素和状态都在引擎里，媒体层不用管。 */
function hideHint() {
    hintElement?.classList.remove("is-visible");
}

function bindHint(target, getText) {
    if (!(target instanceof HTMLElement)) {
        return;
    }
    target.addEventListener("mouseenter", (event) => {
        // 拖动中不要弹提示：它会一直挂在光标旁边，把要看的落点挡住
        if (event.buttons) {
            return;
        }
        const text = typeof getText === "function" ? getText() : getText;
        showHint(text, event);
    });
    target.addEventListener("mousemove", (event) => {
        positionHint(event);
    });
    target.addEventListener("mouseleave", hideHint);
    target.addEventListener("pointerdown", hideHint);
}

function isPassiveHeadZone(head, event) {
    const slack = 4;
    for (const selector of [
        ".xmlg-group-count",
        ".xmlg-group-settings",
        ".xmlg-group-arrow",
    ]) {
        const target = head.querySelector(selector);
        if (!target) {
            continue;
        }
        const rect = target.getBoundingClientRect();
        if (
            event.clientX >= rect.left - slack
            && event.clientX <= rect.right + slack
            && event.clientY >= rect.top - slack
            && event.clientY <= rect.bottom + slack
        ) {
            return true;
        }
    }
    return false;
}

function scopeRows(state) {
    const rows = state?.items?.[state.category] || [];
    const groupId = state?.scopeGroup;
    if (groupId) {
        const members = rows.filter(
            (row) => row && (row.group || null) === groupId
        );
        if (members.length) {
            return members;
        }
    }
    const mode = state?.enableScope || "all";
    if (mode === "files") {
        return rows.filter((row) => row && !row.group);
    }
    if (mode === "groups") {
        return rows.filter((row) => row && row.group);
    }
    return rows.slice();
}

function applyScopeEnabled(rows, targets, enabled, limit) {
    const set = new Set(Array.isArray(targets) ? targets : []);
    if (!set.size) {
        return 0;
    }
    // 名额 = 上限 - 已经开着的（范围内 + 范围外都算，上限是全局的）
    let used = 0;
    for (const row of rows) {
        if (isRowOn(row)) {
            used += 1;
        }
    }
    let budget = Math.max(0, limit - used);
    let skipped = 0;
    for (const row of rows) {
        if (!row || !set.has(row)) {
            continue;
        }
        if (!enabled) {
            setRowOn(row, false);
            continue;
        }
        if (isRowOn(row)) {
            continue;
        }
        if (budget > 0) {
            setRowOn(row, true);
            budget -= 1;
        } else {
            skipped += 1;
        }
    }
    return skipped;
}

function applyScopeInvert(rows, targets, limit) {
    const set = new Set(Array.isArray(targets) ? targets : []);
    if (!set.size) {
        return 0;
    }
    for (const row of rows) {
        if (row && set.has(row)) {
            setRowOn(row, !isRowOn(row));
        }
    }
    let total = rows.filter((row) => isRowOn(row)).length;
    let skipped = 0;
    for (let index = rows.length - 1; index >= 0 && total > limit; index -= 1) {
        const row = rows[index];
        if (!row || !isRowOn(row) || !set.has(row)) {
            continue;
        }
        setRowOn(row, false);
        total -= 1;
        skipped += 1;
    }
    for (let index = rows.length - 1; index >= 0 && total > limit; index -= 1) {
        const row = rows[index];
        if (!row || !isRowOn(row)) {
            continue;
        }
        setRowOn(row, false);
        total -= 1;
    }
    return skipped;
}

function narrowToGroup(state, groupId) {
    if (!state || !groupId) {
        return;
    }
    if (!state.scopeGroup) {
        state.scopeGroupBack = state.enableScope;
    }
    state.scopeGroup = groupId;
    state.enableScope = "groups";
}

function clearScopeGroup(state) {
    if (!state) {
        return;
    }
    state.scopeGroup = null;
    const back = state.scopeGroupBack;
    state.scopeGroupBack = null;
    if (ENABLE_SCOPES.includes(back)) {
        state.enableScope = back;
    }
}

function selectScope(node, mode) {
    const panel = panelOf(node);
    const state = panel?.state;
    if (!panel || !state || !ENABLE_SCOPES.includes(mode)) {
        return;
    }
    if (state.enableScope === mode && !state.scopeGroup) {
        return;
    }
    state.enableScope = mode;
    state.scopeGroup = null;
    // 用户自己点了档位，之前记的「退回去」就不要了
    state.scopeGroupBack = null;
    refreshScopeOnly(node);
}

function toggleScopeGroup(node, category, groupId) {
    const panel = panelOf(node);
    const state = panel?.state;
    if (!panel || !state || !groupId || state.category !== category) {
        return;
    }
    if (state.scopeGroup === groupId) {
        clearScopeGroup(state);
        refreshScopeOnly(node);
        return;
    }
    narrowToGroup(state, groupId);
    refreshScopeOnly(node);
    const record = groupRecord(node, category, groupId);
    showToast(
        node,
        t(
            "xdatahub.ui.group.scope_group_toast",
            "✔ ✖ ⇄ now act on {name} only",
            { name: groupSeqLabel(record || { id: groupId }) }
        )
    );
}

function refreshScopeOnly(node) {
    const panel = panelOf(node);
    const state = panel?.state;
    if (!panel || !state) {
        return;
    }
    const batchable = scopeRows(state).length > 0;
    panel.enableAllButton.disabled = !batchable;
    panel.disableAllButton.disabled = !batchable;
    panel.invertButton.disabled = !batchable;
    syncScopeUi(node, { heads: true });
}

    /** 范围胶囊上那三档的短标签。 */
    function scopeLabel(mode) {
        if (mode === "files") {
            return t("xdatahub.ui.group.scope_files", "Ungrouped");
        }
        if (mode === "groups") {
            return t("xdatahub.ui.group.scope_groups", "Grouped");
        }
        return t("xdatahub.ui.group.scope_all", "All");
    }

    function scopeTooltip(mode) {
        if (mode === "files") {
            return t(
                "xdatahub.ui.group.scope_files_tooltip",
                "Only the ones that aren't in a group yet"
            );
        }
        if (mode === "groups") {
            return t(
                "xdatahub.ui.group.scope_groups_tooltip",
                "Only the ones that are in a group"
            );
        }
        return t(
            "xdatahub.ui.group.scope_all_tooltip",
            "Everything, grouped or not"
        );
    }

    /**
     * 造一枚「范围胶囊」：✔ ✖ ⇄ 这次打哪儿（未分组 / 全部 / 已分组），
     * 加上单击组头后冒出来的组号标签。挂到哪个工具栏上由节点自己决定。
     */
    function buildScopeControl(node) {
        const scopeControl = element("div", "xmlg-scope");
        scopeControl.setAttribute("role", "group");
        bindHint(scopeControl, () => t(
            "xdatahub.ui.group.scope_tooltip",
            "Which rows the three buttons act on"
        ));
        const scopeButtons = new Map();
        for (const mode of ENABLE_SCOPES) {
            const button = element("button", "xmlg-scope-btn", scopeLabel(mode));
            button.type = "button";
            button.dataset.scope = mode;
            bindHint(button, () => scopeTooltip(mode));
            button.addEventListener("click", () => selectScope(node, mode));
            scopeButtons.set(mode, button);
            scopeControl.appendChild(button);
        }
        // 收窄到某一组时冒出的一枚小标签：显示「只作用于哪一组」，点它取消。
        // 它挂在胶囊**里面**，和「分组」同一根边框，一眼看出「分组 = 组 2」。
        const scopeChip = element("button", "xmlg-scope-chip");
        scopeChip.type = "button";
        // 内容包一层：外层用 grid 列宽从 0fr 长到 1fr，宽度才能匀速展开
        const scopeChipInner = element("span", "xmlg-scope-chip-inner");
        const scopeChipText = element("span", "xmlg-scope-chip-text", "");
        scopeChipInner.appendChild(scopeChipText);
        scopeChipInner.appendChild(
            element("span", "xmlg-scope-chip-close", "✕")
        );
        scopeChip.appendChild(scopeChipInner);
        // 提示文案由 syncScopeUi 现算现存在这里（那里拿不到闭包外的东西）
        bindHint(scopeChip, () => scopeChip.__xmlg_hint || "");
        scopeChip.addEventListener("click", () => {
            const state = panelOf(node)?.state;
            if (!state) {
                return;
            }
            clearScopeGroup(state);
            refreshScopeOnly(node);
        });
        scopeControl.appendChild(scopeChip);
        return { scopeControl, scopeChip, scopeChipText, scopeButtons };
    }

function syncScopeUi(node, options = {}) {
    const panel = panelOf(node);
    const state = panel?.state;
    if (!panel || !state) {
        return null;
    }
    const rows = state.items[state.category] || [];
    const groups = state.items.groups?.[state.category] || [];
    // 组已经被解散 / 清空 → 别再指着它
    if (
        state.scopeGroup
        && !groups.some((group) => group.id === state.scopeGroup)
    ) {
        // 指着的那一组已经没了：档位一起退回去，别停在「分组」上
        clearScopeGroup(state);
    }
    const counts = {
        files: rows.filter((row) => row && !row.group).length,
        groups: rows.filter((row) => row && row.group).length,
    };
    counts.all = rows.length;
    for (const [mode, button] of panel.scopeButtons) {
        const active = state.enableScope === mode;
        button.classList.toggle("is-active", active);
        button.classList.toggle("is-empty", (counts[mode] || 0) < 1);
        button.setAttribute("aria-pressed", active ? "true" : "false");
    }
    const scoped = state.scopeGroup;
    panel.scopeChip.classList.toggle("is-visible", Boolean(scoped));
    // 收起来的时候别让它还能被 Tab 到（它只是看不见，不是不存在）
    panel.scopeChip.tabIndex = scoped ? 0 : -1;
    // 「分组」和后面的组号要拼成同一个胶囊：左半段只收左边圆角，
    // 组号那半用负外边距顶上去把缝吃掉
    panel.scopeButtons
        .get("groups")
        ?.classList.toggle("is-scoped", Boolean(scoped));
    if (scoped) {
        const record = groups.find((group) => group.id === scoped) || {
            id: scoped,
        };
        // 标签上只放号：恒定宽度，名字再长也顶不动工具栏上的按钮
        const label = groupSeqLabel(record);
        panel.scopeChipText.textContent = groupSeqNumber(record) || label;
        panel.scopeChip.dataset.groupId = scoped;
        // 「组 12 · 名字」这种完整说法放进悬停提示，不占工具栏
        const name = String(record.name || "").trim();
        panel.scopeChip.__xmlg_hint = name && name !== label
            ? `${label} · ${name}`
            : t(
                "xdatahub.ui.group.scope_chip_tooltip",
                "Only this group — click to clear"
            );
        panel.scopeChip.style.setProperty(
            "--xmlg-group-stripe",
            groupStripeColor(record || {})
        );
    } else {
        delete panel.scopeChip.dataset.groupId;
        panel.scopeChip.__xmlg_hint = "";
    }
    if (options.heads === false) {
        return;
    }
    for (const head of panel.list.querySelectorAll(".xmlg-group-head")) {
        head.classList.toggle(
            "is-scope-target",
            Boolean(scoped) && (head.dataset.groupId || "") === scoped
        );
    }
}

function setAllEnabled(node, enabled) {
    const panel = panelOf(node);
    if (!panel) {
        return;
    }
    const state = panel.state;
    const items = state.items[state.category] || [];
    // 只动「当前范围」里的文件：全部 / 未分组 / 某一组
    const targets = scopeRows(state);
    if (!items.length || !targets.length) {
        return;
    }
    const skipped = applyScopeEnabled(items, targets, enabled, MAX_ENABLED);
    writeItems(node, state.items);
    renderPanel(node);
    if (skipped > 0) {
        showToast(
            node,
            t(
                "xdatahub.ui.group.limit_scope_hit",
                "{count} stayed Disabled — {limit} is the limit",
                { count: skipped, limit: MAX_ENABLED }
            )
        );
    }
}

function invertEnabled(node) {
    const panel = panelOf(node);
    if (!panel) {
        return;
    }
    const state = panel.state;
    const items = state.items[state.category] || [];
    if (!items.length) {
        return;
    }
    const targets = scopeRows(state);
    if (!targets.length) {
        return;
    }
    const skipped = applyScopeInvert(items, targets, MAX_ENABLED);
    writeItems(node, state.items);
    renderPanel(node);
    if (skipped > 0) {
        showToast(
            node,
            t(
                "xdatahub.ui.group.limit_scope_hit",
                "{count} stayed Disabled — {limit} is the limit",
                { count: skipped, limit: MAX_ENABLED }
            )
        );
    }
}

function layoutGroupRails(panel, force = false) {
    if (!panel?.railHosts?.size || !panel.list?.isConnected) {
        return;
    }
    // 列表只变高（拖节点上下边）不会挪动任何一行，宽度没变就不用重新量。
    // 省掉的是一次强制重排：300 行的列表约 4ms，拖动时会一帧一次。
    // 收放动画期间要 force：行的高度一直在变，竖线必须跟着走。
    const width = panel.list.clientWidth;
    if (!force && panel.railMeasured && panel.railWidth === width) {
        return;
    }
    // 先把所有位置量完，再统一写样式。边量边写会让浏览器每改一次
    // 样式就重排一次，几十个组在拖动窗口时会明显卡顿。
    const plan = [];
    for (const host of panel.railHosts.values()) {
        // 组名那一行都藏起来了（拖整组时整组离开列表），竖线没有落点，
        // 先收起来；等放回来再重新量
        const headVisible = !!host.head?.isConnected
            && host.head.offsetHeight > 0
            && !host.head.classList.contains("is-drag-collapsed");
        if (!headVisible || host.rail.style.display === "none") {
            const want = headVisible ? "" : "none";
            if (host.rail.style.display !== want) {
                host.rail.style.display = want;
                host.top = null;
                host.height = null;
            }
            if (!headVisible) {
                continue;
            }
        }
        // 最后一个「还看得见」的成员行：拖动中被拖的那行是藏起来的，
        // 整组拖动时成员也全藏着，量出来都是 0，会把竖线缩成一个小残点
        const edge = lastVisibleMember(
            panel.list,
            host.head?.dataset.groupId || "",
            host.last
        ) || host.head;
        const top = host.head.offsetTop;
        const height = Math.max(3, edge.offsetTop + edge.offsetHeight - top);
        if (host.top === top && host.height === height) {
            continue;
        }
        plan.push({ host, top, height });
    }
    for (const { host, top, height } of plan) {
        host.top = top;
        host.height = height;
        host.rail.style.top = `${top}px`;
        host.rail.style.height = `${height}px`;
    }
    panel.railWidth = width;
    panel.railMeasured = width > 0;
}

function followRailsDuringFold(panel) {
    if (!panel?.list) {
        return;
    }
    const token = (panel.railToken || 0) + 1;
    panel.railToken = token;
    const startedAt = performance.now();
    const tick = () => {
        if (!panel.list?.isConnected || panel.railToken !== token) {
            return;
        }
        layoutGroupRails(panel, true);
        // 多跟 100ms：收拢那 160ms 之后还有一次重画，重画完的位置
        // 也得量一遍才算齐
        if (performance.now() - startedAt < SLIDE_MS + 120) {
            window.requestAnimationFrame(tick);
        }
    };
    window.requestAnimationFrame(tick);
}

function lastVisibleMember(list, groupId, fallback) {
    if (!list || !groupId) {
        return fallback;
    }
    const rows = list.querySelectorAll(
        `.xmlg-row[data-group="${groupId}"]`
    );
    for (let index = rows.length - 1; index >= 0; index -= 1) {
        if (rows[index].offsetHeight > 0) {
            return rows[index];
        }
    }
    return fallback && fallback.offsetHeight > 0 ? fallback : null;
}

function ensureRailObserver(panel) {
    if (panel.railObserver || typeof ResizeObserver !== "function") {
        return;
    }
    panel.railObserver = new ResizeObserver(() => layoutGroupRails(panel));
    panel.railObserver.observe(panel.list);
}

function appendIndexForGroup(items, groupId) {
    const rows = Array.isArray(items) ? items : [];
    let last = -1;
    rows.forEach((row, index) => {
        if (row && row.group === groupId) {
            last = index;
        }
    });
    return last >= 0 ? last + 1 : rows.length;
}

function rowAtPointer(list, clientY) {
    for (const row of list.querySelectorAll(".xmlg-row")) {
        const rect = row.getBoundingClientRect();
        if (clientY >= rect.top && clientY <= rect.bottom) {
            return row;
        }
    }
    return null;
}

function groupForDrop(list, items, gapIndex, clientY) {
    const row = rowAtPointer(list, clientY);
    if (row) {
        return row.dataset.group || null;
    }
    return groupOfGap(items, gapIndex);
}

function groupNameById(node, category, groupId) {
    if (!groupId) {
        return "";
    }
    const groups = panelOf(node)?.state?.items?.groups?.[category] || [];
    const record = groups.find((item) => item.id === groupId);
    return record?.name || groupId;
}

function moveTargetFromGap(gapIndex, fromIndex) {
    return gapIndex > fromIndex ? gapIndex - 1 : gapIndex;
}

function markGroupTarget(panel, groupId) {
    if (!panel) {
        return;
    }
    for (const target of panel.list.querySelectorAll(".is-group-target")) {
        target.classList.remove("is-group-target");
    }
    if (!groupId) {
        return;
    }
    panel.list
        .querySelector(`.xmlg-group-head[data-group-id="${groupId}"]`)
        ?.classList.add("is-group-target");
    for (const row of panel.list.querySelectorAll(
        `.xmlg-row[data-group="${groupId}"]`
    )) {
        row.classList.add("is-group-target");
    }
}

function markGroupBlockDragging(panel, groupId, active) {
    if (!panel?.list || !groupId) {
        return;
    }
    for (const row of panel.list.querySelectorAll(
        `.xmlg-row[data-group="${groupId}"]`
    )) {
        row.classList.toggle("is-block-dragging", active);
    }
    panel.railHosts?.get(groupId)?.rail.classList.toggle(
        "is-block-dragging",
        active
    );
}

function setGroupDragCollapsed(panel, groupId, collapsed) {
    if (!panel?.list || !groupId) {
        return;
    }
    // 组名那一行也一起藏：拖整组时列表里什么都不留，
    // 屏幕上只剩跟着指针的那张卡片（Chromium 拖标签组也是这样）
    const targets = [
        ...panel.list.querySelectorAll(`.xmlg-row[data-group="${groupId}"]`),
        ...panel.list.querySelectorAll(
            `.xmlg-group-head[data-group-id="${groupId}"]`
        ),
    ];
    for (const element of targets) {
        element.classList.toggle("is-drag-collapsed", collapsed);
    }
    panel.railMeasured = false;
    layoutGroupRails(panel);
}

function beginRowDrag(node, category, row, event) {
    const panel = panelOf(node);
    if (!panel) {
        return;
    }
    const state = panel.state;
    const index = Number(row.dataset.index);
    const safeIndex = Number.isFinite(index) ? index : 0;
    // 尺寸必须在「藏起来之前」量：藏起来（display: none）之后
    // 量到的全是 0，跟手的那张卡片就会变成一小撮
    const rect = row.getBoundingClientRect();
    state.dragRow = {
        category,
        index: safeIndex,
        ref: row.dataset.ref || "",
        // 行身份：同一个文件有多份时，要认得出拖的是哪一份
        key: XMLG_KEY_OF((state.items[category] || [])[safeIndex] || {}),
        rect: {
            left: rect.left,
            top: rect.top,
            width: rect.width,
            height: rect.height,
        },
        layoutW: row.offsetWidth,
        layoutH: row.offsetHeight,
        // undefined = 还没定过归属；null = 明确不分组
        groupId: undefined,
        // 开拖时它在哪一组：用它做「粘性」，让人容易留在原组
        groupOrigin: (state.items[category] || [])[safeIndex]?.group || null,
        grabOffsetY: Math.max(0, event.clientY - rect.top),
        height: rect.height || 44,
        lastY: event.clientY,
        snapshot: JSON.stringify(state.items),
        moved: false,
        dropped: false,
        dissolvedNames: [],
    };
    row.classList.add("is-dragging");
}

function finishRowDrag(node, dragRow) {
    const panel = panelOf(node);
    if (!panel || !dragRow) {
        return;
    }
    dragRow.dropped = true;
    writeItems(node, panel.state.items, { recordUndo: false });
    announceDissolvedGroups(node, dragRow.dissolvedNames);
    if (panel.state.dragRow === dragRow) {
        panel.state.dragRow = null;
    }
}

function beginGroupDrag(node, category, head, groupId, event) {
    const panel = panelOf(node);
    if (!panel) {
        return;
    }
    const headRect = head.getBoundingClientRect();
    panel.state.dragGroup = {
        category,
        groupId,
        gap: null,
        rect: {
            left: headRect.left,
            top: headRect.top,
            width: headRect.width,
            height: headRect.height,
        },
        layoutW: head.offsetWidth,
        layoutH: head.offsetHeight,
        lastY: event.clientY,
        snapshot: JSON.stringify(panel.state.items),
        moved: false,
        dropped: false,
        dissolvedNames: [],
    };
    head.classList.add("is-dragging");
    markGroupBlockDragging(panel, groupId, true);
    setGroupDragCollapsed(panel, groupId, true);
}

function finishGroupDrag(node, dragGroup) {
    const panel = panelOf(node);
    if (!panel || !dragGroup) {
        return;
    }
    dragGroup.dropped = true;
    markGroupBlockDragging(panel, dragGroup.groupId, false);
    setGroupDragCollapsed(panel, dragGroup.groupId, false);
    if (panel.state.dragGroup === dragGroup) {
        panel.state.dragGroup = null;
    }
    writeItems(node, panel.state.items, { recordUndo: false });
    announceDissolvedGroups(node, dragGroup.dissolvedNames);
}

function ensureDragUndo(node) {
    const panel = panelOf(node);
    const drag = panel?.state?.dragRow || panel?.state?.dragGroup;
    if (!panel || !drag || drag.undoTaken) {
        return;
    }
    drag.undoTaken = true;
    drag.pushedValue = String(ensureStorageWidget(node)?.value || "{}");
    pushUndoSnapshot(node);
    panel.state.redoStack = [];
}

function restoreDragSnapshot(node, drag) {
    const panel = panelOf(node);
    if (!panel || !drag?.snapshot) {
        return;
    }
    let items = panel.state.items;
    try {
        items = normalizeItems(JSON.parse(drag.snapshot));
    } catch {
        return;
    }
    panel.state.items = items;
    const stack = panel.state.undoStack || [];
    if (
        drag.pushedValue !== undefined
        && stack[stack.length - 1] === drag.pushedValue
    ) {
        stack.pop();
        panel.state.undoStack = stack;
    }
    writeItems(node, items, { recordUndo: false });
    renderPanel(node);
}

function collectDissolved(drag, dissolved) {
    if (!drag || !Array.isArray(dissolved)) {
        return;
    }
    drag.dissolvedNames = drag.dissolvedNames || [];
    for (const record of dissolved) {
        const name = record?.name || record?.id || "";
        if (name && !drag.dissolvedNames.includes(name)) {
            drag.dissolvedNames.push(name);
        }
    }
}

function announceDissolvedGroups(node, names) {
    if (!Array.isArray(names) || !names.length) {
        return;
    }
    showToast(
        node,
        t(
            "xdatahub.ui.group.group_dissolved",
            "Group {name} has nothing left, so it was removed",
            { name: names.join(", ") }
        )
    );
}

function liveMoveGroup(node, gapIndex) {
    const panel = panelOf(node);
    const dragGroup = panel?.state?.dragGroup;
    const state = panel?.state;
    if (!panel || !dragGroup || !state) {
        return false;
    }
    if (dragGroup.category !== state.category) {
        return false;
    }
    const rows = state.items[state.category];
    if (!Array.isArray(rows)) {
        return false;
    }
    const result = moveGroupToGap(
        rows,
        state.items.groups?.[state.category] || [],
        dragGroup.groupId,
        gapIndex
    );
    dragGroup.gap = result.gap;
    if (!result.moved) {
        return false;
    }
    // 和整行拖动一样，宿主可以规定「哪些位置不许去」：整组搬到置顶/
    // 置底行外侧时，就地钳回来，而不是等下次重画把人弹开。
    const constrained = ctx.applyOrderConstraints
        ? ctx.applyOrderConstraints(node, result.items)
        : result.items;
    state.items[state.category] = constrained;
    state.items.groups[state.category] = result.groups;
    dragGroup.moved = true;
    collectDissolved(dragGroup, result.dissolved);
    ensureDragUndo(node);
    applyOrderInPlace(node, { animate: true });
    writeItems(node, state.items, { recordUndo: false });
    return true;
}

function liveMoveRow(node, gapIndex, groupId) {
    const panel = panelOf(node);
    const dragRow = panel?.state?.dragRow;
    const state = panel?.state;
    if (!panel || !dragRow || !state) {
        return false;
    }
    if (dragRow.category !== state.category) {
        return false;
    }
    const rows = state.items[state.category];
    if (!Array.isArray(rows)) {
        return false;
    }
    const from = Number(dragRow.index);
    const gap = Number(gapIndex);
    if (!Number.isFinite(from) || from < 0 || from >= rows.length) {
        return false;
    }
    if (!Number.isFinite(gap)) {
        return false;
    }
    const wanted = groupId === undefined
        ? dragRow.groupId
        : groupId;
    const staysPut = moveTargetFromGap(gap, from) === from;
    const sameGroup = (wanted === undefined ? null : wanted || null)
        === (rows[from]?.group || null);
    if (staysPut && sameGroup) {
        return false;
    }
    const options = { keyOf: XMLG_KEY_OF };
    if (wanted !== undefined) {
        options.groupId = wanted || null;
    }
    const result = moveRowToGap(
        rows,
        state.items.groups?.[state.category] || [],
        from,
        gap,
        options
    );
    // 宿主可以规定「哪些位置不许去」：比如 XLoRAGet 里置顶/置底的行
    // 位置由标记决定，别的行挤到它们前面是无效操作——这里就地钳回去，
    // 而不是先答应再在下次重画时把人弹开。
    const constrained = ctx.applyOrderConstraints
        ? ctx.applyOrderConstraints(node, result.items)
        : result.items;
    state.items[state.category] = constrained;
    state.items.groups[state.category] = result.groups;
    const nextIndex = constrained.findIndex(
        (row) => XMLG_KEY_OF(row) === dragRow.key
    );
    if (nextIndex >= 0) {
        dragRow.index = nextIndex;
    }
    dragRow.groupId = result.groupId;
    dragRow.moved = true;
    collectDissolved(dragRow, result.dissolved);
    ensureDragUndo(node);
    applyOrderInPlace(node, { animate: true });
    writeItems(node, state.items, { recordUndo: false });
    return true;
}

function armPointerDrag(node, event, intent) {
    const panel = panelOf(node);
    if (!panel || event.button !== 0 || event.isPrimary === false) {
        return;
    }
    if (event.target?.closest?.("button, input, label, .xmlg-thumb")) {
        return;
    }
    const state = panel.state;
    if (state.pointerDrag?.active) {
        return;
    }
    const pending = {
        ...intent,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        clientY: event.clientY,
        active: false,
    };
    const onMove = (moveEvent) => {
        if (moveEvent.pointerId !== pending.pointerId) {
            return;
        }
        movePointerDrag(node, moveEvent);
    };
    const onUp = (upEvent) => {
        if (upEvent.pointerId !== pending.pointerId) {
            return;
        }
        endPointerDrag(node);
    };
    const onKey = (keyEvent) => {
        if (keyEvent.key !== "Escape") {
            return;
        }
        keyEvent.preventDefault();
        cancelPointerDrag(node);
    };
    pending.cleanup = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
        window.removeEventListener("keydown", onKey, true);
    };
    state.pointerDrag = pending;
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    window.addEventListener("keydown", onKey, true);
}

function armRowPointerDrag(node, category, row, event) {
    armPointerDrag(node, event, {
        kind: "row",
        category,
        row,
        ref: row.dataset.ref || "",
    });
}

function armGroupPointerDrag(node, category, head, groupId, event) {
    armPointerDrag(node, event, {
        kind: "group",
        category,
        head,
        groupId,
    });
}

function movePointerDrag(node, event) {
    const panel = panelOf(node);
    const pending = panel?.state?.pointerDrag;
    if (!panel || !pending) {
        return;
    }
    pending.clientY = event.clientY;
    if (!pending.active) {
        const dx = event.clientX - pending.startX;
        const dy = event.clientY - pending.startY;
        if (Math.hypot(dx, dy) < DRAG_START_PX) {
            return;
        }
        startPointerDrag(node, pending, event);
        return;
    }
    event.preventDefault();
    moveGhost(node, event.clientY);
    applyPointerDrag(node, event.clientY);
}

function startPointerDrag(node, pending, event) {
    const panel = panelOf(node);
    if (pending.kind === "group") {
        beginGroupDrag(
            node,
            pending.category,
            pending.head,
            pending.groupId,
            event
        );
    } else {
        beginRowDrag(node, pending.category, pending.row, event);
    }
    pending.active = true;
    document.body.classList.add("xmlg-pointer-dragging");
    spawnGhost(node, pending);
    applyPointerDrag(node, pending.clientY);
}

function applyPointerDrag(node, clientY) {
    const panel = panelOf(node);
    const pending = panel?.state?.pointerDrag;
    if (!panel || !pending) {
        return;
    }
    if (pending.kind === "group") {
        // 整组拖动也走同一套防抖：不然在两组交界处挪一个像素就会来回翻
        const dragGroup = panel.state.dragGroup;
        if (!dragGroup) {
            return;
        }
        const groupThreshold = Math.max(
            6,
            (pending.head?.offsetHeight || 28) * GROUP_DRAG_THRESHOLD_RATIO
        );
        const groupFar = Math.abs(clientY - dragGroup.lastY) >= groupThreshold;
        if (groupFar && liveMoveGroup(node, resolveGroupGap(node, clientY))) {
            dragGroup.lastY = clientY;
        }
    } else {
        const dragRow = panel.state.dragRow;
        if (!dragRow) {
            return;
        }
        const target = resolveLiveRowTarget(node, clientY);
        const threshold = Math.max(
            6,
            (dragRow.height || 44) * REORDER_THRESHOLD_RATIO
        );
        const far = Math.abs(clientY - dragRow.lastY) >= threshold;
        if (far && liveMoveRow(node, target.gap, target.groupId)) {
            dragRow.lastY = clientY;
        }
        markGroupTarget(panel, dragRow.groupId || null);
    }
    const rect = panel.list.getBoundingClientRect();
    if (clientY - rect.top < DROP_AUTOSCROLL_EDGE) {
        startDropAutoScroll(node, -1);
    } else if (rect.bottom - clientY < DROP_AUTOSCROLL_EDGE) {
        startDropAutoScroll(node, 1);
    } else {
        stopDropAutoScroll(panel.state);
    }
}

function spawnGhost(node, pending) {
    const panel = panelOf(node);
    const source = pending.kind === "group" ? pending.head : pending.row;
    if (!panel || !source?.isConnected) {
        return;
    }
    // 只清上一张卡片：不能走 removeGhost，它会顺手把「拖动中」这个
    // 全局状态摘掉（竖线的过渡就挂在这个状态上）
    pending.ghost?.remove();
    pending.ghost = null;
    // 行在开拖时就被藏起来了（列表里不留槽位），所以尺寸要用
    // 藏起来之前量的那一份（记在 dragRow / dragGroup 上）
    const drag = pending.kind === "group"
        ? panel.state.dragGroup
        : panel.state.dragRow;
    const rect = drag?.rect || source.getBoundingClientRect();
    const grab = Number.isFinite(pending.startY)
        ? pending.startY - rect.top
        : 0;
    pending.grabOffsetY = Math.max(0, Number.isFinite(grab) ? grab : 0);
    const ghost = source.cloneNode(true);
    // is-drag-collapsed 也摘掉：拖整组时源组名是藏起来的，
    // 克隆带上这个 class 卡片就跟着一起看不见了
    ghost.classList.remove(
        "is-dragging",
        "is-drag-collapsed",
        "is-selected",
        "is-group-target"
    );
    ghost.removeAttribute("data-index");
    ghost.classList.add("xmlg-drag-ghost");
    // 组头本身带 margin-top（和上一组之间留的空），卡片是固定定位，
    // margin 会把盒子整体往下顶 6px，位置上就对不齐了
    ghost.style.margin = "0";
    // 卡片挂在 body 上，那里没有画布的缩放，所以：
    // 1) 尺寸用元素自己的布局尺寸（offsetWidth/Height），不用屏幕尺寸；
    // 2) 再按「屏幕尺寸 / 布局尺寸」算出的画布缩放比缩一下。
    // 不这么做的话，画布缩到 80% 时卡片会按 100% 显示，比原行大一圈，
    // 正好盖住左边的组竖线。
    const layoutW = drag?.layoutW || rect.width || 0;
    const layoutH = drag?.layoutH || rect.height || 0;
    const canvasScale = layoutW > 0
        ? Math.min(4, Math.max(0.1, rect.width / layoutW))
        : 1;
    ghost.style.width = `${layoutW}px`;
    ghost.style.height = `${layoutH}px`;
    // 行本身有 min-height，卡片要按量出来的高度走
    ghost.style.minHeight = "0";
    ghost.style.transformOrigin = "top left";
    // 必须挂 body：ComfyUI 的画布（节点的祖先）带缩放/位移变换，
    // position: fixed 一旦落在这种祖先里，left/top 就按坐标系的算法算，
    // 卡片会跑到屏幕另一边去。挂列表里也不行（会被当成一行）。
    // 颜色变量由 .xmlg-drag-ghost 这条样式自带一份。
    document.body.appendChild(ghost);
    pending.ghost = ghost;

    // 页面还可能有 zoom 之类的整体缩放/位移：写进去的 px 和屏幕上的 px
    // 未必 1:1。这里量一次换算关系（写 0px 和写 100px 分别落在哪），
    // 之后按这个关系换算，任何坐标系下都能落在指针对应的位置。
    ghost.style.left = "0px";
    ghost.style.top = "0px";
    const zero = ghost.getBoundingClientRect();
    ghost.style.top = "100px";
    const down = ghost.getBoundingClientRect();
    ghost.style.left = "100px";
    const right = ghost.getBoundingClientRect();
    const scaleY = (down.top - zero.top) / 100;
    const scaleX = (right.left - zero.left) / 100;
    pending.ghostOriginY = zero.top;
    pending.ghostOriginX = zero.left;
    pending.ghostScaleY = Number.isFinite(scaleY) && scaleY > 0 ? scaleY : 1;
    pending.ghostScaleX = Number.isFinite(scaleX) && scaleX > 0 ? scaleX : 1;
    pending.ghostHeight = Number.isFinite(rect.height) && rect.height > 0
        ? rect.height
        : layoutH;

    // 卡片自己还要缩一下才能真正和原元素一样大。
    // 注意要除掉坐标系本身的缩放：外层已经有 0.7 倍缩放时，
    // 元素在屏幕上量到的宽度本来就小了一圈，再乘一次就变成 0.49 倍。
    const extra = layoutW > 0
        ? Math.min(
            4,
            Math.max(0.1, rect.width / (layoutW * pending.ghostScaleX))
        )
        : canvasScale;
    ghost.style.transform = `scale(${extra})`;
    pending.ghostScale = extra;

    placeGhost(node, rect.left, rect.top);
}

function placeGhost(node, screenLeft, screenTop) {
    const pending = panelOf(node)?.state?.pointerDrag;
    const ghost = pending?.ghost;
    if (!ghost) {
        return;
    }
    const sx = pending.ghostScaleX || 1;
    const sy = pending.ghostScaleY || 1;
    const ox = pending.ghostOriginX || 0;
    const oy = pending.ghostOriginY || 0;
    if (Number.isFinite(screenLeft)) {
        ghost.style.left = `${(screenLeft - ox) / sx}px`;
    }
    if (Number.isFinite(screenTop)) {
        const height = pending.ghostHeight || 0;
        const lowest = window.innerHeight - height - 4;
        const clamped = Math.min(Math.max(0, lowest), Math.max(0, screenTop));
        ghost.style.top = `${(clamped - oy) / sy}px`;
    }
}

function moveGhost(node, clientY) {
    const pending = panelOf(node)?.state?.pointerDrag;
    if (!pending?.ghost) {
        return;
    }
    const offset = Number.isFinite(pending.grabOffsetY)
        ? pending.grabOffsetY
        : 0;
    if (!Number.isFinite(clientY)) {
        return;
    }
    placeGhost(node, null, clientY - offset);
}

function removeGhost(panel, known) {
    const pending = known || panel?.state?.pointerDrag;
    pending?.ghost?.remove();
    if (pending) {
        pending.ghost = null;
    }
    document.body.classList.remove("xmlg-pointer-dragging");
}

function endPointerDrag(node) {
    const panel = panelOf(node);
    const pending = panel?.state?.pointerDrag;
    if (!panel || !pending) {
        return;
    }
    pending.cleanup?.();
    if (!pending.active) {
        removeGhost(panel);
        panel.state.pointerDrag = null;
        return;
    }
    // 先按最终位置落地，再撤掉拖动状态：竖线的过渡挂在拖动状态上，
    // 反过来的话最后一格调整会跳过过渡，松手瞬间竖线会跳一下。
    applyPointerDragStop(node);
    removeGhost(panel);
    panel.state.pointerDrag = null;
    // 拖完必然紧跟一个 click：要吞掉，否则会顺手改了选中状态
    panel.state.suppressClickUntil = performance.now() + 400;
    if (pending.kind === "group") {
        const dragGroup = panel.state.dragGroup;
        panel.state.dragGroup = null;
        if (dragGroup) {
            finishGroupDrag(node, dragGroup);
        }
    } else {
        const dragRow = panel.state.dragRow;
        panel.state.dragRow = null;
        if (dragRow) {
            finishRowDrag(node, dragRow);
        }
    }
    pending.row?.classList.remove("is-dragging");
    pending.head?.classList.remove("is-dragging");
    stopDropAutoScroll(panel.state);
    clearDragHighlights(panel);
}

function cancelPointerDrag(node) {
    const panel = panelOf(node);
    const pending = panel?.state?.pointerDrag;
    if (!panel || !pending?.active) {
        return;
    }
    pending.cleanup?.();
    panel.state.pointerDrag = null;
    pending.row?.classList.remove("is-dragging");
    pending.head?.classList.remove("is-dragging");
    const drag = pending.kind === "group"
        ? panel.state.dragGroup
        : panel.state.dragRow;
    panel.state.dragRow = null;
    panel.state.dragGroup = null;
    stopDropAutoScroll(panel.state);
    clearDragHighlights(panel);
    markGroupBlockDragging(panel, pending.groupId, false);
    setGroupDragCollapsed(panel, pending.groupId, false);
    if (drag) {
        restoreDragSnapshot(node, drag);
    }
    // 回滚完再撤「拖动中」：竖线缩回去也走过渡，不突兀
    removeGhost(panel, pending);
}

function resolveFlowGap(node, clientY) {
    const panel = panelOf(node);
    const state = panel?.state;
    const list = panel?.list;
    if (!panel || !state || !list) {
        return 0;
    }
    const items = state.items[state.category] || [];
    for (const child of list.children) {
        const isRow = child.classList.contains("xmlg-row");
        const isHead = child.classList.contains("xmlg-group-head");
        if (!isRow && !isHead) {
            continue;
        }
        const rect = child.getBoundingClientRect();
        if (clientY >= rect.top + rect.height / 2) {
            continue;
        }
        if (isRow) {
            const index = Number(child.dataset.index);
            if (Number.isFinite(index)) {
                return index;
            }
            continue;
        }
        return firstIndexForGroup(items, child.dataset.groupId || "");
    }
    return items.length;
}

function resolveLiveRowTarget(node, clientY) {
    const panel = panelOf(node);
    const state = panel?.state;
    const list = panel?.list;
    if (!panel || !state || !list) {
        return { gap: null, groupId: null };
    }
    const items = state.items[state.category] || [];
    const gap = resolveFlowGap(node, clientY);
    return {
        gap,
        groupId: leanGroupForGap({
            list,
            items,
            gap,
            clientY,
            dragRow: state.dragRow,
        }),
    };
}

function isCollapsedGroupHead(el) {
    return Boolean(
        el
        && el.classList.contains("xmlg-group-head")
        && el.classList.contains("is-collapsed")
    );
}

function flowSlotAt(list, items, index) {
    const rows = Array.isArray(items) ? items : [];
    if (!Number.isFinite(index) || index < 0 || index >= rows.length) {
        return null;
    }
    for (const row of list.querySelectorAll(".xmlg-row")) {
        if (Number(row.dataset.index) === index) {
            return row;
        }
    }
    const groupId = (rows[index] && rows[index].group) || "";
    if (!groupId) {
        return null;
    }
    for (const head of list.querySelectorAll(".xmlg-group-head")) {
        if ((head.dataset.groupId || "") === groupId) {
            return head;
        }
    }
    return null;
}

function gapBoundaryTop(list, items, gap) {
    const above = flowSlotAt(list, items, gap - 1);
    const below = flowSlotAt(list, items, gap);
    if (above && below) {
        const a = above.getBoundingClientRect();
        const b = below.getBoundingClientRect();
        return (a.bottom + b.top) / 2;
    }
    if (below) {
        return below.getBoundingClientRect().top;
    }
    if (above) {
        return above.getBoundingClientRect().bottom;
    }
    return null;
}

function leanGroupForGap(options) {
    const { list, items, gap, clientY, dragRow } = options;
    const height = (dragRow && dragRow.height) || 44;
    const buffer = height * GROUP_LEAN_RATIO;
    const above = gap > 0 ? items[gap - 1] : null;
    const below = gap >= 0 && gap < items.length ? items[gap] : null;
    const aboveGroup = (above && above.group) || null;
    const belowGroup = (below && below.group) || null;
    // 折叠起来的组在列表里只占用一格（组头），成员看不见。这时候
    // 指针从它身上过，只能理解为「插到整组前面 / 后面」——绝不能
    // 把文件塞进一个看不见成员的组里（用户会以为文件没放下）。
    if (
        isCollapsedGroupHead(flowSlotAt(list, items, gap))
        || isCollapsedGroupHead(flowSlotAt(list, items, gap - 1))
    ) {
        return null;
    }
    if (aboveGroup === belowGroup) {
        return aboveGroup;
    }
    const boundary = gapBoundaryTop(list, items, gap);
    if (boundary === null) {
        return aboveGroup || belowGroup;
    }
    const grab = dragRow && Number.isFinite(dragRow.grabOffsetY)
        ? dragRow.grabOffsetY
        : height / 2;
    const center = clientY - grab + height / 2;
    const origin = (dragRow && dragRow.groupOrigin) || null;
    let shift = 0;
    if (aboveGroup && aboveGroup === origin) {
        shift = buffer;
    } else if (belowGroup && belowGroup === origin) {
        shift = -buffer;
    }
    const offset = center - boundary - shift;
    if (offset < -buffer) {
        return aboveGroup;
    }
    if (offset > buffer) {
        return belowGroup;
    }
    return null;
}

function measureRowTops(panel) {
    const list = panel.list;
    const listRect = list.getBoundingClientRect();
    const from = listRect.top - 240;
    const to = listRect.bottom + 240;
    const tops = new Map();
    for (const child of list.children) {
        if (
            !child.classList.contains("xmlg-row")
            && !child.classList.contains("xmlg-group-head")
        ) {
            continue;
        }
        const rect = child.getBoundingClientRect();
        if (rect.bottom < from || rect.top > to) {
            continue;
        }
        tops.set(child, rect.top - listRect.top);
    }
    return tops;
}

function clearSlide(panel) {
    const list = panel?.list;
    if (!list) {
        return;
    }
    for (const el of list.querySelectorAll(".is-sliding")) {
        el.style.transition = "none";
        el.style.transform = "";
        el.style.removeProperty("transition");
        el.classList.remove("is-sliding");
    }
}

function playSlide(panel, tops) {
    const list = panel.list;
    if (!list || !tops?.size) {
        return;
    }
    const listRect = list.getBoundingClientRect();
    const moves = [];
    for (const [el, top] of tops) {
        if (!el.isConnected || el.classList.contains("is-dragging")) {
            continue;
        }
        const delta = top - (el.getBoundingClientRect().top - listRect.top);
        if (Math.abs(delta) < 0.5) {
            continue;
        }
        moves.push({ el, delta });
    }
    if (!moves.length) {
        return;
    }
    for (const { el, delta } of moves) {
        el.style.transition = "none";
        el.style.transform = `translateY(${delta}px)`;
        el.classList.add("is-sliding");
    }
    // 先把「反向位移」这一帧确定下来，再开始过渡；否则两次写会被浏览器
    // 合成成一次，动画根本不会出现。
    void list.offsetHeight;
    window.requestAnimationFrame(() => {
        for (const { el } of moves) {
            if (!el.isConnected) {
                continue;
            }
            el.style.transition =
                `transform ${SLIDE_MS}ms cubic-bezier(0.2, 0, 0, 1)`;
            el.style.transform = "translateY(0px)";
        }
    });
    window.clearTimeout(panel.slideTimer);
    panel.slideTimer = window.setTimeout(() => {
        for (const { el } of moves) {
            if (!el.isConnected) {
                continue;
            }
            el.style.transition = "none";
            el.style.transform = "";
            el.style.removeProperty("transition");
            el.classList.remove("is-sliding");
        }
    }, SLIDE_MS + 60);
}

function firstFlowChild(panel) {
    const fixed = new Set([
        panel.overlay,
        panel.insertLine,
        panel.dropLabel,
        panel.empty,
        panel.toast,
    ]);
    for (const child of panel.list.children) {
        if (fixed.has(child) || child.classList.contains("xmlg-group-rail")) {
            continue;
        }
        return child;
    }
    return null;
}

function applyOrderInPlace(node, options = {}) {
    const panel = panelOf(node);
    const list = panel?.list;
    if (!panel || !list?.isConnected) {
        return false;
    }
    const state = panel.state;
    const items = state.items[state.category] || [];
    const groups = state.items.groups?.[state.category] || [];
    const animate = options.animate !== false;
    const tops = animate ? measureRowTops(panel) : null;
    if (animate) {
        clearSlide(panel);
    }
    const entries = buildRenderList(items, groups, {
        keyOf: XMLG_KEY_OF,
        willLoad: (entry) => isRowOn(entry),
    });
    const rowByRef = panel.rowByRef || new Map();
    const headByGroup = panel.headByGroup || new Map();
    const stripeByGroup = new Map(
        groups.map((group) => [group.id, groupStripeColor(group)])
    );
    const wanted = new Set();
    const lastRowByGroup = new Map();
    const placed = [];
    for (const entry of entries) {
        if (entry.type === "group") {
            let head = headByGroup.get(entry.groupId);
            if (!head) {
                head = buildGroupHead(node, state.category, entry);
                headByGroup.set(entry.groupId, head);
            }
            wanted.add(entry.groupId);
            placed.push({ entry, el: head });
            continue;
        }
        // 行身份就是 uid：重复文件各有一份，按 ref 会互相顶掉
        const key = XMLG_KEY_OF(entry.row);
        let rowEl = rowByRef.get(key);
        if (!rowEl) {
            rowEl = buildRow(
                node,
                state.category,
                entry.row,
                entry.index,
                entry.seq
            );
            rowByRef.set(key, rowEl);
        }
        placed.push({ entry, el: rowEl });
    }
    panel.rowByRef = rowByRef;
    panel.headByGroup = headByGroup;
    // 只搬位置：按目标顺序逐个插到游标前面，已经在正确位置的不动
    let cursor = firstFlowChild(panel);
    for (const { el } of placed) {
        if (el === cursor) {
            cursor = cursor.nextSibling;
            continue;
        }
        list.insertBefore(el, cursor);
    }
    // 不再需要的行 / 组头（组被解散、文件被删）直接撤掉
    const keep = new Set(placed.map((item) => item.el));
    const fixed = new Set([
        panel.overlay,
        panel.insertLine,
        panel.dropLabel,
        panel.empty,
        panel.toast,
    ]);
    for (const child of Array.from(list.children)) {
        if (
            keep.has(child)
            || fixed.has(child)
            || child.classList.contains("xmlg-group-rail")
        ) {
            continue;
        }
        child.remove();
    }
    for (const [ref, el] of rowByRef) {
        if (!el.isConnected) {
            rowByRef.delete(ref);
        }
    }
    for (const [groupId, el] of headByGroup) {
        if (!el.isConnected || !wanted.has(groupId)) {
            headByGroup.delete(groupId);
        }
    }
    // 行号、序号、归属：一次过全部对齐
    for (const { entry, el } of placed) {
        if (entry.type === "group") {
            el.dataset.groupId = entry.groupId;
            el.classList.toggle(
                "is-collapsed",
                entry.collapsed === true
            );
            el.style.setProperty(
                "--xmlg-group-stripe",
                stripeByGroup.get(entry.groupId)
                    || groupStripeColor(entry.groupId)
            );
            // 拖动时成员会进出这一组，胶囊上的数字跟着改
            const countEl = el.querySelector(".xmlg-group-count");
            const countText = groupCountText(entry);
            if (countEl && countEl.textContent !== countText) {
                countEl.textContent = countText;
            }
            continue;
        }
        el.dataset.index = String(entry.index);
        const row = entry.row;
        const enabled = isRowOn(row);
        const seqText = enabled ? String(entry.seq) : "–";
        if (el.__xmlgSeq && el.__xmlgSeq.textContent !== seqText) {
            el.__xmlgSeq.textContent = seqText;
        }
        el.classList.toggle("is-disabled", !enabled);
        // 同一个文件在列表里出现多次时，两个节点的「身份」可能互换，
        // 开关状态也一起对齐，免得显示成另一个的开关状态
        if (el.__xmlgSwitch && el.__xmlgSwitch.checked !== enabled) {
            el.__xmlgSwitch.checked = enabled;
        }
        const groupId = row.group || "";
        if ((el.dataset.group || "") !== groupId) {
            if (groupId) {
                el.dataset.group = groupId;
                el.classList.add("is-grouped");
                el.style.setProperty(
                    "--xmlg-group-stripe",
                    stripeByGroup.get(groupId) || groupStripeColor(groupId)
                );
            } else {
                delete el.dataset.group;
                el.classList.remove("is-grouped");
                el.style.removeProperty("--xmlg-group-stripe");
            }
        }
        if (groupId) {
            lastRowByGroup.set(groupId, el);
        }
    }
    // 每组一根竖线：能复用就复用。
    // 重建的话，新元素一挂上去就是最终长度，过渡根本没机会跑——
    // 这正是「拖一行进组时竖线突然变长」的来源。
    const railHosts = panel.railHosts instanceof Map
        ? panel.railHosts
        : new Map();
    for (const [groupId, host] of Array.from(railHosts)) {
        if (!wanted.has(groupId) || !headByGroup.get(groupId)) {
            host.rail.remove();
            railHosts.delete(groupId);
        }
    }
    for (const groupId of wanted) {
        const head = headByGroup.get(groupId);
        if (!head) {
            continue;
        }
        let host = railHosts.get(groupId);
        if (!host) {
            const rail = element("div", "xmlg-group-rail");
            rail.dataset.group = groupId;
            list.appendChild(rail);
            host = { rail, head, last: head };
            railHosts.set(groupId, host);
        }
        host.head = head;
        host.last = lastRowByGroup.get(groupId) || head;
        host.rail.style.setProperty(
            "--xmlg-group-stripe",
            stripeByGroup.get(groupId) || groupStripeColor(groupId)
        );
        // 正在拖的就是这一组：继续显示「正在搬」
        host.rail.classList.toggle(
            "is-block-dragging",
            Boolean(state.dragGroup && state.dragGroup.groupId === groupId)
        );
    }
    panel.railHosts = railHosts;
    panel.railMeasured = false;
    layoutGroupRails(panel);
    if (animate && tops) {
        playSlide(panel, tops);
    }
    // 就地重排没有整表重画，行左侧的序号得有人补：两个节点「哪些行
    // 会真的加载」的规则不一样（媒体看开关，LoRA 还要看强度），引擎
    // 算不准，交给调用方按屏幕上的顺序自己重写。
    if (typeof ctx.refreshRowNumbers === "function") {
        ctx.refreshRowNumbers(node);
    }
    return true;
}

function groupHeadAtPointer(list, clientY) {
    for (const head of list.querySelectorAll(".xmlg-group-head")) {
        const rect = head.getBoundingClientRect();
        if (clientY >= rect.top && clientY <= rect.bottom) {
            return head.dataset.groupId || null;
        }
    }
    return null;
}

function flowElementAbove(list, clientY) {
    let found = null;
    for (const child of list.children) {
        const isRow = child.classList.contains("xmlg-row");
        const isHead = child.classList.contains("xmlg-group-head");
        if (!isRow && !isHead) {
            continue;
        }
        const rect = child.getBoundingClientRect();
        if (rect.bottom <= clientY) {
            found = child;
        }
    }
    return found;
}

function firstIndexForGroup(items, groupId) {
    const rows = Array.isArray(items) ? items : [];
    for (let index = 0; index < rows.length; index += 1) {
        if (rows[index] && rows[index].group === groupId) {
            return index;
        }
    }
    return rows.length;
}

function resolveGroupGap(node, clientY) {
    return resolveFlowGap(node, clientY);
}

function isLastGroupMember(items, index, groupId) {
    if (!groupId) {
        return false;
    }
    const next = items[index + 1];
    return !next || (next.group || null) !== groupId;
}

function resolveDropTarget(node, clientY) {
    const panel = panelOf(node);
    const state = panel?.state;
    if (!panel || !state) {
        return null;
    }
    const list = panel.list;
    const category = state.category;
    const items = state.items[category] || [];
    const groups = (state.items.groups && state.items.groups[category]) || [];
    // 指针压在任意一组的胶囊上（展开的、折叠的都算）= 追加到这一组末尾。
    // 折叠组的成员没渲染，只能靠胶囊指位置；展开的组也照此办理，
    // 否则「拖到组头」会掉到列表最底下，跟这里提示的「加入这一组」不符。
    const head = groupHeadAtPointer(list, clientY);
    if (head) {
        return {
            mode: "insert",
            index: appendIndexForGroup(items, head),
            row: null,
            group: head,
        };
    }
    const rows = Array.from(list.querySelectorAll(".xmlg-row"));
    for (const row of rows) {
        const rect = row.getBoundingClientRect();
        if (clientY < rect.top || clientY > rect.bottom) {
            continue;
        }
        const index = Number(row.dataset.index);
        const group = row.dataset.group || null;
        if (clientY - rect.top <= INSERT_EDGE_PX) {
            return { mode: "insert", index, row, group };
        }
        if (rect.bottom - clientY <= INSERT_EDGE_PX) {
            return { mode: "insert", index: index + 1, row, group };
        }
        // 一组的最后一名（以及列表最后一行）的下半部分算「追加到末尾」，
        // 否则想在组的最底部加个文件，只能赌那 8px 边距，很容易误替换。
        const tail = isLastGroupMember(items, index, group)
            || index === items.length - 1;
        if (tail && clientY - rect.top > rect.height / 2) {
            return { mode: "insert", index: index + 1, row, group };
        }
        return { mode: "replace", index, row, group };
    }
    // 指针落在两段之间的空隙里（组和组之间只有几个像素），这时
    // 「接在上面那一段后面」才是用户的意思 —— 尤其想让文件进到某组
    // 的最底部时，手指很难刚好停在那一行里，常常就落在这条缝上。
    const above = flowElementAbove(list, clientY);
    if (!above) {
        return {
            mode: "insert",
            index: 0,
            row: null,
            group: groupForDrop(list, items, 0, clientY),
        };
    }
    if (above.classList.contains("xmlg-group-head")) {
        const groupId = above.dataset.groupId || null;
        const record = groups.find((item) => item.id === groupId);
        // 折叠组：成员没渲染，组头下面就是这一组的末尾 → 追加进去
        // 展开组：组头下面紧接着的是它的第一名成员 → 插到那一名前面
        return {
            mode: "insert",
            index: record && record.collapsed === true
                ? appendIndexForGroup(items, groupId)
                : firstIndexForGroup(items, groupId),
            row: null,
            group: groupId,
        };
    }
    const index = Number(above.dataset.index) + 1;
    return {
        mode: "insert",
        index,
        row: above,
        group: above.dataset.group || null,
    };
}

function clearDragHighlights(panel) {
    if (!panel) {
        return;
    }
    for (const row of panel.list.querySelectorAll(
        ".xmlg-row.is-replace-target"
    )) {
        row.classList.remove("is-replace-target");
    }
    panel.insertLine.style.display = "none";
    panel.dropLabel.style.display = "none";
    for (const target of panel.list.querySelectorAll(".is-drop-target")) {
        target.classList.remove("is-drop-target");
    }
}

function flowEndIndex(items, category, child) {
    if (child.classList.contains("xmlg-group-head")) {
        const groupId = child.dataset.groupId || "";
        const rows = items[category] || [];
        const records = (items.groups && items.groups[category]) || [];
        const record = records.find((item) => item.id === groupId);
        return record && record.collapsed === true
            ? appendIndexForGroup(rows, groupId)
            : firstIndexForGroup(rows, groupId);
    }
    return Number(child.dataset.index) + 1;
}

function insertLineTop(panel, index) {
    const items = panel.state.items || {};
    const category = panel.state.category;
    const flow = Array.from(panel.list.children).filter(
        (child) => child.classList.contains("xmlg-row")
            || child.classList.contains("xmlg-group-head")
    );
    if (!flow.length) {
        return 6;
    }
    // 取「结束位置最靠后、且不越过插入点」的那一段；位置打平时行优先。
    // 行优先很重要：落点在某组第一行前面时，那一组的组头结束位置也
    // 是同一下标，若让组头赢，线就会画到组头下面（看起来像插进了组里）。
    let anchor = null;
    let anchorEnd = Number.NEGATIVE_INFINITY;
    let anchorIsHead = false;
    for (const child of flow) {
        const isHead = child.classList.contains("xmlg-group-head");
        const end = flowEndIndex(items, category, child);
        if (!Number.isFinite(end) || end > index) {
            continue;
        }
        if (end > anchorEnd || (end === anchorEnd && anchorIsHead && !isHead)) {
            anchor = child;
            anchorEnd = end;
            anchorIsHead = isHead;
        }
    }
    if (!anchor) {
        return Math.max(0, flow[0].offsetTop - 2);
    }
    return anchor.offsetTop + anchor.offsetHeight + 1;
}

function placeInsertLine(panel, index) {
    const top = insertLineTop(panel, index);
    panel.insertLine.style.top = `${top}px`;
    panel.insertLine.style.display = "block";
    panel.dropLabel.style.top = `${Math.max(0, top - 24)}px`;
    panel.dropLabel.style.display = "block";
}

function updateDropIndicator(node, target) {
    const panel = panelOf(node);
    if (!panel || !target) {
        return;
    }
    clearDragHighlights(panel);
    const count = dragCountFromDataTransfer(
        panel.state.drag?.dataTransfer
    );
    if (target.mode === "replace" && count <= 1) {
        target.row?.classList.add("is-replace-target");
        return;
    }
    placeInsertLine(panel, target.index);
    // 落点落在某一组里：把那组圈出来，提示里直接写组名
    markGroupTarget(panel, target.group);
    const groupName = groupNameById(node, panel.state.category, target.group);
    if (groupName) {
        panel.dropLabel.textContent = count > 1
            ? `+ ${
                t(
                    "xdatahub.ui.group.insert_many_into_group",
                    "Insert {count} {noun} into \"{name}\"",
                    { count, name: groupName }
                )
            }`
            : `+ ${
                t(
                    "xdatahub.ui.group.insert_into_group",
                    "Insert into \"{name}\"",
                    { name: groupName }
                )
            }`;
        return;
    }
    panel.dropLabel.textContent = count > 1
        ? `+ ${
            t(
                "xdatahub.ui.group.insert_many",
                "Insert {count} {noun}",
                { count }
            )
        }`
        : `+ ${
            t(
                "xdatahub.ui.group.insert_here",
                "Insert here"
            )
        }`;
}

function clearDragUI(node) {
    const panel = panelOf(node);
    if (!panel) {
        return;
    }
    const state = panel.state;
    if (state.drag?.pendingTimer) {
        clearTimeout(state.drag.pendingTimer);
    }
    state.drag = null;
    panel.list.classList.remove("drag-over");
    clearDragHighlights(panel);
    hideTypeMismatch(panel);
}

    return {
        pushUndoSnapshot,
        updateUndoButton,
        applySnapshot,
        undoLastChange,
        redoLastChange,
        showToast,
        groupColorValue,
        groupColorId,
        groupStripeColor,
        pruneSelection,
        handleRowSelection,
        ungroupedSelection,
        createGroupFromCurrentSelection,
        startGroupRename,
        beginGroupRename,
        applyGroupRename,
        groupMemberRowElements,
        foldGroupRowsOut,
        seedCollapsedHeadLook,
        unfoldGroupRowsIn,
        growGroupRowsIn,
        setGroupCollapsed,
        commitGroupCollapsed,
        closeGroupDialog,
        openGroupSettingsDialog,
        groupRecord,
        applyGroupColor,
        applyGroupDelete,
        confirmRemovingGroupMember,
        presetGroupNameAt,
        defaultGroupName,
        groupSeqNumber,
        groupSeqLabel,
        groupTitle,
        hideHint,
        groupCountText,
        buildGroupHead,
        ensureHintElement,
        positionHint,
        showHint,
        bindHint,
        isPassiveHeadZone,
        scopeRows,
        applyScopeEnabled,
        applyScopeInvert,
        narrowToGroup,
        clearScopeGroup,
        selectScope,
        toggleScopeGroup,
        refreshScopeOnly,
        syncScopeUi,
        buildScopeControl,
        setAllEnabled,
        invertEnabled,
        layoutGroupRails,
        followRailsDuringFold,
        lastVisibleMember,
        ensureRailObserver,
        appendIndexForGroup,
        rowAtPointer,
        groupForDrop,
        groupNameById,
        moveTargetFromGap,
        markGroupTarget,
        markGroupBlockDragging,
        setGroupDragCollapsed,
        beginRowDrag,
        finishRowDrag,
        beginGroupDrag,
        finishGroupDrag,
        ensureDragUndo,
        restoreDragSnapshot,
        collectDissolved,
        announceDissolvedGroups,
        liveMoveGroup,
        liveMoveRow,
        armPointerDrag,
        armRowPointerDrag,
        armGroupPointerDrag,
        movePointerDrag,
        startPointerDrag,
        applyPointerDrag,
        spawnGhost,
        placeGhost,
        moveGhost,
        removeGhost,
        endPointerDrag,
        cancelPointerDrag,
        resolveFlowGap,
        resolveLiveRowTarget,
        isCollapsedGroupHead,
        flowSlotAt,
        gapBoundaryTop,
        leanGroupForGap,
        measureRowTops,
        clearSlide,
        playSlide,
        firstFlowChild,
        applyOrderInPlace,
        groupHeadAtPointer,
        flowElementAbove,
        firstIndexForGroup,
        resolveGroupGap,
        isLastGroupMember,
        resolveDropTarget,
        clearDragHighlights,
        flowEndIndex,
        insertLineTop,
        placeInsertLine,
        updateDropIndicator,
        clearDragUI,
    };
}

export {
    createGroupEngine,
    DRAG_START_PX,
    ENABLE_SCOPES,
    groupStyles,
    MAX_ENABLED,
    SLIDE_MS,
};
