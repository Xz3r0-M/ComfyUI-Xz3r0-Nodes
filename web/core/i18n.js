import { appStore } from './store.js';

const Dictionary = {
    'zh': {
        // ── common ──────────────────────────────────────────
        'common.confirm':       '确认',
        'common.cancel':        '取消',
        'common.save':          '保存',
        'common.close':         '关闭',
        'common.loading':       '加载中…',
        'common.unknown':       '未知',
        'common.clear':         '清空',
        'common.select_all':    '全选',
        'common.deselect_all':  '取消全选',
        'common.search':        '搜索',
        'common.refresh':       '刷新',
        'common.settings':      '设置',
        'common.import':        '导入',
        'common.send':          '确认发送',

        // ── error ────────────────────────────────────────────
        'error.network':        '节点通信中断',
        'error.load_fail':      '加载失败，请稍后重试',
        'error.save_fail':      '保存失败，请重试',
        'nav.banner.lock_status_fail': '状态同步失败，将稍后重试',

        // ── nav — sidebar categories ─────────────────────────
        'nav.cat.image':        '图片',
        'nav.cat.input':        '输入图',
        'nav.cat.output':       '生成图',
        'nav.cat.video':        '视频',
        'nav.cat.audio':        '音频',
        'nav.cat.lora':         'Lora 模型',
        'nav.cat.history':      '历史',
        'nav.cat.favorites':    '收藏',

        // ── nav — sort options ───────────────────────────────
        'nav.sort.date_desc':   '最新优先',
        'nav.sort.date_asc':    '最旧优先',
        'nav.sort.name_asc':    '名称 A-Z',
        'nav.sort.name_desc':   '名称 Z-A',

        // ── nav — lock/status ────────────────────────────────
        'nav.lock.running':                 '工作',
        'nav.lock.running_title':           '工作中 · 运行 {running} / 等待 {pending}',
        'nav.lock.queued':                  '排队',
        'nav.lock.queued_title':            '排队中 · 队列 {remaining}',
        'nav.lock.cooldown':                '冷却',
        'nav.lock.cooldown_title':          '冷却中 · 队列 {remaining}',
        'nav.lock.stopping':                '停止',
        'nav.lock.stopping_title':          '停止中 · 正在等待任务结束',
        'nav.lock.idle':                    '空闲',
        'nav.lock.idle_title':              '空闲 · 当前可写入',
        'nav.lock.readonly':                '只读',
        'nav.lock.writable':                '可写',

        // ── nav — lock event labels ──────────────────────────
        'nav.event.init':                   '初始化',
        'nav.event.fallback':               '离线',
        'nav.event.interrupt_requested':    '请求中断',
        'nav.event.execution_start':        '开始执行',
        'nav.event.execution_cached':       '命中缓存',
        'nav.event.executing':              '执行中',
        'nav.event.execution_success':      '执行完成',
        'nav.event.execution_error':        '执行错误',
        'nav.event.execution_interrupted':  '已中断',
        'nav.event.progress':               '处理中',
        'nav.event.status':                 '状态更新',
        'nav.event.unknown':                '未知',

        // ── nav — status popover ─────────────────────────────
        'nav.status.aria_label':    '状态详情',
        'nav.status.running':       '运行中',
        'nav.status.pending':       '等待中',
        'nav.status.write_state':   '写入状态',
        'nav.status.last_event':    '最近事件',

        // ── nav — toolbar buttons ────────────────────────────
        'nav.btn.back':             '返回上一级',
        'nav.btn.forward':          '前进',
        'nav.btn.refresh':          '刷新',
        'nav.btn.home':             '返回该类别根目录',
        'nav.path.root':            '根目录',
        'nav.btn.select_all':       '全选当前列表',
        'nav.btn.deselect_all':     '取消全选',
        'nav.btn.search':           '搜索',
        'nav.btn.search_placeholder': '搜索…',
        'nav.banner.refresh_ok':    '已增量刷新当前分类',
        'nav.banner.refresh_fail':  '增量刷新失败，请重试',
        'nav.banner.cleanup_ok':    '已清理当前分类无效项',
        'nav.banner.cleanup_fail':  '清理无效项失败，请重试',
        'nav.banner.rebuild_ok':    '已完全重建当前分类索引',
        'nav.banner.rebuild_fail':  '完全重建失败，请重试',
        'nav.btn.sort_title':       '切换排序（当前：{label}）',
        'nav.btn.size_small':       '小卡片',
        'nav.btn.size_medium':      '中卡片',
        'nav.btn.size_large':       '大卡片',
        'nav.btn.show_tree':        '显示目录树',
        'nav.btn.hide_tree':        '隐藏目录树',
        'nav.btn.lang':             '切换语言',
        'nav.btn.settings':         '设置',
        'nav.btn.more':             '更多操作',
        'nav.tree.title':           '目录树',
        'nav.tree.empty':           '当前层级没有子文件夹',
        'nav.tree.loading':         '加载文件夹中…',
        'nav.tree.error':           '目录树加载失败',
        'nav.tree.expand':          '展开子目录',
        'nav.tree.collapse':        '收起子目录',
        'nav.tree.collapse_all':    '收起全部目录',

        // ── nav — more drawer ────────────────────────────────
        'nav.drawer.clean_invalid': '清理无效项',
        'nav.drawer.clean_index':   '完全重建当前索引',
        'nav.drawer.clean_data':    '清理全部数据',
            'nav.drawer.clean_data_confirm': '⚠️ 此操作将清理全部索引数据，确认继续？',
            'nav.drawer.open_db_folder': '打开数据库文件夹',
        'nav.banner.open_db_folder_ok':   '已在文件管理器中打开',
        'nav.banner.open_db_folder_fail': '打开文件夹失败，请重试',
        'nav.banner.open_db_unsupported': '当前平台不支持。',
        // ── media grid ──────────────────────────────────────
        'grid.empty':               '暂无文件',
        'grid.empty_search':        '没有匹配结果',
        'grid.btn.preview':         '预览',
        'grid.btn.edit_lora':       '编辑',
        'grid.badge.no_preview':    '无预览',
        'grid.badge.unsupported_format': '格式/编码不支持',
        'grid.badge.no_thumbnail':  '无缩略图',

        // ── lora detail drawer ───────────────────────────────
        'lora.title_default':       'LoRA 编辑',
        'lora.loading':             '加载中…',
        'lora.label.model_strength':'模型强度',
        'lora.label.clip_strength': 'CLIP 强度',
        'lora.badge.strength':      '强度',
        'lora.badge.trigger':       '触发词',
        'lora.label.note':          '备注',
        'lora.label.trigger_words': '触发词',
        'lora.placeholder.note':    '记录用途、风格或注意事项',
        'lora.placeholder.tw':      '每行一个触发词',
        'lora.btn.link':            '联动两者',
        'lora.btn.unlink':          '解除联动',
        'lora.btn.import_meta':     '导入 metadata',
        'lora.btn.import_meta_title': '从 metadata.json 导入触发词',
        'lora.banner.save_ok':      'LoRA 信息已保存',
        'lora.banner.save_fail':    '保存 LoRA 信息失败，请重试',
        'lora.banner.load_fail':    '加载 LoRA 详情失败，请稍后重试',
        'lora.banner.import_ok':    '已导入 metadata 中的触发词',
        'lora.banner.import_empty': 'metadata 中没有可导入的触发词',
        'lora.banner.import_fail':  '导入 metadata 失败，请重试',

        // ── history / favorites ──────────────────────────────
        'history.mode.history':     '历史',
        'history.mode.favorites':   '收藏',
        'history.empty':            '暂无{mode}记录',
        'history.unnamed':          '未命名记录',
        'history.unknown_db':       '未知数据库',
        'history.unknown_date':     '未知日期',
        'history.section.extra_header': '额外头部信息',
        'history.section.content':  '内容',
        'history.btn.favorite':     '收藏',
        'history.btn.unfavorite':   '取消收藏',
        'history.btn.favorited':    '已收藏',
        'history.banner.fav_ok':    '已收藏',
        'history.banner.fav_dup':   '该内容已在收藏中',
        'history.banner.fav_fail':  '收藏失败，请重试',
        'history.banner.unfav_ok':  '已取消收藏',
        'history.banner.unfav_fail': '取消收藏失败，请重试',

        // ── sidebar filter ───────────────────────────────────
        'sidebar.section.media':    '资源',
        'sidebar.section.record':   '记录',

        // ── pagination ───────────────────────────────────────
        'page.info':            '第 {cur} 页 / 共 {total} 页',
        'page.jump':            '页码',
        'page.input_aria':      '输入页码并按回车跳转',
        'page.prev':            '上一页',
        'page.next':            '下一页',

        // ── staging dock ─────────────────────────────────────
        'dock.title':           '发送',
        'dock.drag_all':        '整体拖拽',
        'dock.clear':           '清空',
        'dock.collapse':        '折叠',
        'dock.expand':          '展开',
        'dock.selected':        '已选项 ({count})：',
        'dock.more_items':      '...+ {count} 项',
        'dock.batch_target':    '发送目标：',
        'dock.send':            '发送',
        'dock.send_success':    '已发送 {count} 个文件',
        'dock.send_partial':    '发送完成：{success} 成功，{fail} 失败',

        // ── node picker ──────────────────────────────────────
        'picker.placeholder':       '指定目标接收节点…',
        'picker.search_placeholder':'输入名称或 ID 搜索节点…',
        'picker.empty':             '没有匹配的节点',
        'picker.loading':       '正在加载节点…',

        // ── banner / toast ───────────────────────────────────
        'banner.close':         '关闭',

        // ── lightbox ─────────────────────────────────────────
        'lightbox.close':       '关闭 (Esc)',
        'lightbox.prev':        '上一项',
        'lightbox.next':        '下一项',
        'lightbox.open_external': '在新标签页打开',
        'lightbox.position':    '第 {current} 项 / 共 {total} 项',
        'lightbox.image':       '图片',
        'lightbox.audio':       '音频',
        'lightbox.video':       '视频',
        'lightbox.text':        '文本',
        'lightbox.audio_play':  '播放音频',
        'lightbox.audio_pause': '暂停音频',
        'lightbox.audio_seek':  '点击波形定位播放位置',
        'lightbox.audio_mute':  '静音',
        'lightbox.audio_unmute': '取消静音',
        'lightbox.audio_volume': '音量 {value}%',

        // ── settings dialog ──────────────────────────────────
        'settings.sect.video':          '视频播放',
        'settings.sect.audio':          '音频播放',
        'settings.sect.lora':           'Lora 数据库',
        'settings.sect.media_folder':   '自定义媒体文件夹',
        'settings.sect.theme':          '外观主题',
        'settings.video_autoplay':      '自动播放',
        'settings.video_muted':         '默认静音',
        'settings.video_loop':          '循环播放',
        'settings.audio_autoplay':      '自动播放',
        'settings.audio_muted':         '默认静音',
        'settings.audio_loop':          '循环播放',
        'settings.store_lora_db':       '保存到 models/loras',
        'settings.lora_db_conflict.title': '发现已有 Lora 数据库',
        'settings.lora_db_conflict.message': 'models/loras 中已经存在 {fileName}。请选择要替换为当前数据库，还是直接使用已存在的数据库。',
        'settings.lora_db_conflict.current_path': '当前数据库',
        'settings.lora_db_conflict.target_path': 'models/loras 中已有数据库',
        'settings.lora_db_conflict.location.xdatahub_database': 'XDataSaved/database/{fileName}',
        'settings.lora_db_conflict.location.models_loras': 'models/loras/{fileName}',
        'settings.lora_db_conflict.location.unknown': '{fileName}',
        'settings.lora_db_conflict.use_existing': '使用已存在的',
        'settings.lora_db_conflict.replace': '替换已有数据库',
        'settings.lora_db_conflict.apply_failed': 'Lora 数据库切换失败，请重试',
        'settings.custom_folder':       '文件夹路径',
        'settings.custom_folder_placeholder': '绝对路径，留空则禁用',
        'settings.folder_add': '添加',
        'settings.folder_remove': '删除',
        'settings.folder_empty': '暂无自定义文件夹',
        'settings.theme_mode':          '主题',
        'settings.theme_dark':          '深色',
        'settings.theme_light':         '浅色',
        'settings.sect.launch':         '打开与唤起',
        'settings.auto_show_on_startup': '启动时显示 XDataHub',
        'settings.auto_show_on_startup_tooltip': 'ComfyUI 加载完成后自动打开 XDataHub 窗口。',
        'settings.hotkey':              'XDataHub 快捷键',
        'settings.hotkey_tooltip':      '切换 XDataHub 窗口的键盘快捷键。格式：Ctrl+Alt+X、Alt+X、Shift+F2 等。',
        'settings.hotkey_invalid':      '快捷键格式无效，请重新输入',
        'settings.default_open_layout': '默认打开布局',
        'settings.default_open_layout_tooltip': '设置打开 XDataHub 时的默认窗口布局。',
        'settings.default_open_layout.center': '默认（居中 75%）',
        'settings.default_open_layout.left': '左靠边',
        'settings.default_open_layout.right': '右靠边',
        'settings.default_open_layout.maximized': '最大化',
        'settings.sect.window':         '窗口行为',
        'settings.close_behavior':      '关闭按钮行为',
        'settings.close_behavior_tooltip': '隐藏：重开更快但占用更高。销毁：更省内存但重开更慢。',
        'settings.close_behavior.hide': '隐藏（重开更快）',
        'settings.close_behavior.destroy': '销毁（更省内存）',
        'settings.edge_peek':           '贴边隐藏（滑出）',
        'settings.edge_peek_tooltip':   '停靠到左/右边后自动隐藏，鼠标接近边缘即可展开',
        'settings.sect.exec':           '操作防护',
        'settings.disable_interaction_running': '工作中时禁止操作界面',
        'exec.overlay.running':         '工作中，请稍候…',
        'settings.sect.canvas':          '画布交互',
        'settings.hover_locate_enabled': '悬停时定位节点',
        'settings.hover_locate_enabled_tooltip': '在发送栏悬停节点名称时，画布视图自动移动到对应节点位置',
        'settings.hover_locate_debounce_ms': '防抖延迟 (ms)',
        'settings.hover_locate_debounce_ms_tooltip': '鼠标悬停多久后触发定位，数值越大越不容易误触发',
        'settings.sect.thumb_cache':    '缩略图缓存',
        'settings.enable_ffmpeg_thumb_cache': 'FFmpeg 缓存缩略图',
        'settings.enable_ffmpeg_thumb_cache_tooltip': '启用后使用 FFmpeg 为视频生成缓存缩略图以提升列表流畅度；关闭则使用浏览器原生读取。',
        },

    'en': {
        // ── common ──────────────────────────────────────────
        'common.confirm':       'Confirm',
        'common.cancel':        'Cancel',
        'common.save':          'Save',
        'common.close':         'Close',
        'common.loading':       'Loading…',
        'common.unknown':       'Unknown',
        'common.clear':         'Clear',
        'common.select_all':    'Select All',
        'common.deselect_all':  'Deselect All',
        'common.search':        'Search',
        'common.refresh':       'Refresh',
        'common.settings':      'Settings',
        'common.import':        'Import',
        'common.send':          'Confirm & Send',

        // ── error ────────────────────────────────────────────
        'error.network':        'Node communication lost',
        'error.load_fail':      'Load failed, please try again',
        'error.save_fail':      'Save failed, please retry',
        'nav.banner.lock_status_fail': 'Lock status refresh failed. Retrying shortly.',

        // ── nav — sidebar categories ─────────────────────────
        'nav.cat.image':        'Images',
        'nav.cat.input':        'Input Images',
        'nav.cat.output':       'Output Images',
        'nav.cat.video':        'Video',
        'nav.cat.audio':        'Audio',
        'nav.cat.lora':         'Lora Models',
        'nav.cat.history':      'History',
        'nav.cat.favorites':    'Favorites',

        // ── nav — sort options ───────────────────────────────
        'nav.sort.date_desc':   'Newest First',
        'nav.sort.date_asc':    'Oldest First',
        'nav.sort.name_asc':    'Name A-Z',
        'nav.sort.name_desc':   'Name Z-A',

        // ── nav — lock/status ────────────────────────────────
        'nav.lock.running':                 'Running',
        'nav.lock.running_title':           'Running · Active {running} / Queued {pending}',
        'nav.lock.queued':                  'Queued',
        'nav.lock.queued_title':            'Queued · Queue {remaining}',
        'nav.lock.cooldown':                'Cooldown',
        'nav.lock.cooldown_title':          'Cooldown · Queue {remaining}',
        'nav.lock.stopping':                'Stopping',
        'nav.lock.stopping_title':          'Stopping · Waiting for task to finish',
        'nav.lock.idle':                    'Idle',
        'nav.lock.idle_title':              'Idle · Ready to write',
        'nav.lock.readonly':                'Read-only',
        'nav.lock.writable':                'Writable',

        // ── nav — lock event labels ──────────────────────────
        'nav.event.init':                   'Initializing',
        'nav.event.fallback':               'Offline',
        'nav.event.interrupt_requested':    'Interrupt Requested',
        'nav.event.execution_start':        'Started',
        'nav.event.execution_cached':       'Cache Hit',
        'nav.event.executing':              'Executing',
        'nav.event.execution_success':      'Completed',
        'nav.event.execution_error':        'Error',
        'nav.event.execution_interrupted':  'Interrupted',
        'nav.event.progress':               'Processing',
        'nav.event.status':                 'Status Update',
        'nav.event.unknown':                'Unknown',

        // ── nav — status popover ─────────────────────────────
        'nav.status.aria_label':    'Status Details',
        'nav.status.running':       'Active',
        'nav.status.pending':       'Queued',
        'nav.status.write_state':   'Write State',
        'nav.status.last_event':    'Last Event',

        // ── nav — toolbar buttons ────────────────────────────
        'nav.btn.back':             'Go back',
        'nav.btn.forward':          'Go forward',
        'nav.btn.refresh':          'Refresh',
        'nav.btn.home':             'Go to category root',
        'nav.path.root':            'Root',
        'nav.btn.select_all':       'Select all on this page',
        'nav.btn.deselect_all':     'Deselect all',
        'nav.btn.search':           'Search',
        'nav.btn.search_placeholder': 'Search…',
        'nav.banner.refresh_ok':    'Incremental refresh completed',
        'nav.banner.refresh_fail':  'Incremental refresh failed, please retry',
        'nav.banner.cleanup_ok':    'Invalid entries cleaned',
        'nav.banner.cleanup_fail':  'Cleanup invalid failed, please retry',
        'nav.banner.rebuild_ok':    'Full rebuild completed',
        'nav.banner.rebuild_fail':  'Full rebuild failed, please retry',
        'nav.btn.sort_title':       'Toggle sort (current: {label})',
        'nav.btn.size_small':       'Small cards',
        'nav.btn.size_medium':      'Medium cards',
        'nav.btn.size_large':       'Large cards',
        'nav.btn.show_tree':        'Show folder tree',
        'nav.btn.hide_tree':        'Hide folder tree',
        'nav.btn.lang':             'Switch language',
        'nav.btn.settings':         'Settings',
        'nav.btn.more':             'More actions',
        'nav.tree.title':           'Folder Tree',
        'nav.tree.empty':           'No subfolders at this level',
        'nav.tree.loading':         'Loading folders…',
        'nav.tree.error':           'Failed to load folder tree',
        'nav.tree.expand':          'Expand branch',
        'nav.tree.collapse':        'Collapse branch',
        'nav.tree.collapse_all':    'Collapse all branches',

        // ── nav — more drawer ────────────────────────────────
        'nav.drawer.clean_invalid': 'Clean invalid entries',
        'nav.drawer.clean_index':   'Fully rebuild current index',
        'nav.drawer.clean_data':    'Clear all data',
        'nav.drawer.clean_data_confirm':
            '⚠️ This will clear all index data. Continue?',

        // ── media grid ──────────────────────────────────────
        'grid.empty':               'No files',
        'grid.empty_search':        'No matching results',
        'grid.btn.preview':         'Preview',
        'grid.btn.edit_lora':       'Edit',
        'grid.badge.no_preview':    'No Preview',
        'grid.badge.unsupported_format': 'Unsupported Format/Codec',
        'grid.badge.no_thumbnail':  'No Thumbnail',

        // ── lora detail drawer ───────────────────────────────
        'lora.title_default':       'Edit LoRA',
        'lora.loading':             'Loading…',
        'lora.label.model_strength':'Model Strength',
        'lora.label.clip_strength': 'CLIP Strength',
        'lora.badge.strength':      'Strength',
        'lora.badge.trigger':       'Trigger',
        'lora.label.note':          'Notes',
        'lora.label.trigger_words': 'Trigger Words',
        'lora.placeholder.note':    'Add usage notes, style, or reminders',
        'lora.placeholder.tw':      'One trigger word per line',
        'lora.btn.link':            'Link both',
        'lora.btn.unlink':          'Unlink',
        'lora.btn.import_meta':     'Import metadata',
        'lora.btn.import_meta_title': 'Import trigger words from metadata.json',
        'lora.banner.save_ok':      'LoRA info saved',
        'lora.banner.save_fail':    'Failed to save LoRA info, please retry',
        'lora.banner.load_fail':    'Failed to load LoRA details, please try again',
        'lora.banner.import_ok':    'Trigger words imported from metadata',
        'lora.banner.import_empty': 'No trigger words found in metadata',
        'lora.banner.import_fail':  'Failed to import metadata, please retry',

        // ── history / favorites ──────────────────────────────
        'history.mode.history':     'History',
        'history.mode.favorites':   'Favorites',
        'history.empty':            'No {mode} records',
        'history.unnamed':          'Unnamed Record',
        'history.unknown_db':       'Unknown DB',
        'history.unknown_date':     'Unknown Date',
        'history.section.extra_header': 'Extra Header',
        'history.section.content':  'Content',
        'history.btn.favorite':     'Add to favorites',
        'history.btn.unfavorite':   'Remove from favorites',
        'history.btn.favorited':    'Favorited',
        'history.banner.fav_ok':    'Added to favorites',
        'history.banner.fav_dup':   'Already in favorites',
        'history.banner.fav_fail':  'Failed to add favorite, please retry',
        'history.banner.unfav_ok':  'Removed from favorites',
        'history.banner.unfav_fail': 'Failed to remove favorite, please retry',

        // ── sidebar filter ───────────────────────────────────
        'sidebar.section.media':    'Media',
        'sidebar.section.record':   'Records',

        // ── pagination ───────────────────────────────────────
        'page.info':            'Page {cur} / {total}',
        'page.jump':            'Page',
        'page.input_aria':      'Enter a page number and press Enter to jump',
        'page.prev':            'Previous page',
        'page.next':            'Next page',

        // ── staging dock ─────────────────────────────────────
        'dock.title':           'Send',
        'dock.drag_all':        'Drag All',
        'dock.clear':           'Clear',
        'dock.collapse':        'Collapse',
        'dock.expand':          'Expand',
        'dock.selected':        'Selected ({count}):',
        'dock.more_items':      '...+ {count} more',
        'dock.batch_target':    'Target node:',
        'dock.send':            'Send',
        'dock.send_success':    'Sent {count} file(s) successfully',
        'dock.send_partial':    'Done: {success} sent, {fail} failed',

        // ── node picker ──────────────────────────────────────
        'picker.placeholder':       'Select target node…',
        'picker.search_placeholder':'Search by name or ID…',
        'picker.empty':             'No matching nodes',
        'picker.loading':       'Loading nodes…',

        // ── banner / toast ───────────────────────────────────
        'banner.close':         'Close',

        // ── lightbox ─────────────────────────────────────────
        'lightbox.close':       'Close (Esc)',
        'lightbox.prev':        'Previous item',
        'lightbox.next':        'Next item',
        'lightbox.open_external': 'Open in new tab',
        'lightbox.position':    'Item {current} of {total}',
        'lightbox.image':       'Image',
        'lightbox.audio':       'Audio',
        'lightbox.video':       'Video',
        'lightbox.text':        'Text',
        'lightbox.audio_play':  'Play audio',
        'lightbox.audio_pause': 'Pause audio',
        'lightbox.audio_seek':  'Seek playback position',
        'lightbox.audio_mute':  'Mute audio',
        'lightbox.audio_unmute': 'Unmute audio',
        'lightbox.audio_volume': 'Volume {value}%',

        // ── settings dialog ──────────────────────────────────
        'settings.sect.video':          'Video Playback',
        'settings.sect.audio':          'Audio Playback',
        'settings.sect.lora':           'Lora Database',
        'settings.sect.media_folder':   'Custom Media Folder',
        'settings.sect.theme':          'Appearance',
        'settings.video_autoplay':      'Autoplay',
        'settings.video_muted':         'Muted by default',
        'settings.video_loop':          'Loop playback',
        'settings.audio_autoplay':      'Autoplay',
        'settings.audio_muted':         'Muted by default',
        'settings.audio_loop':          'Loop playback',
        'settings.store_lora_db':       'Save to models/loras',
        'settings.lora_db_conflict.title': 'Existing Lora database found',
        'settings.lora_db_conflict.message': 'A {fileName} file already exists in models/loras. Choose whether to replace it with the current database or use the existing one.',
        'settings.lora_db_conflict.current_path': 'Current database',
        'settings.lora_db_conflict.target_path': 'Existing database in models/loras',
        'settings.lora_db_conflict.location.xdatahub_database': 'XDataSaved/database/{fileName}',
        'settings.lora_db_conflict.location.models_loras': 'models/loras/{fileName}',
        'settings.lora_db_conflict.location.unknown': '{fileName}',
        'settings.lora_db_conflict.use_existing': 'Use existing database',
        'settings.lora_db_conflict.replace': 'Replace existing database',
        'settings.lora_db_conflict.apply_failed': 'Failed to switch the Lora database location. Please retry.',
        'settings.custom_folder':       'Folder path',
        'settings.custom_folder_placeholder': 'Absolute path, empty = disabled',
        'settings.folder_add': 'Add',
        'settings.folder_remove': 'Remove',
        'settings.folder_empty': 'No custom folders added',
        'settings.theme_mode':          'Theme',
        'settings.theme_dark':          'Dark',
        'settings.theme_light':         'Light',
        'settings.sect.launch':         'Launch & Toggle',
        'settings.auto_show_on_startup': 'Show XDataHub on startup',
        'settings.auto_show_on_startup_tooltip': 'Automatically open the XDataHub window when ComfyUI loads.',
        'settings.hotkey':              'XDataHub Toggle Hotkey',
        'settings.hotkey_tooltip':      'Keyboard shortcut to toggle the XDataHub window. Format: Ctrl+Alt+X, Alt+X, Shift+F2, etc.',
        'settings.hotkey_invalid':      'Invalid hotkey format. Please enter it again.',
        'settings.default_open_layout': 'Default Open Layout',
        'settings.default_open_layout_tooltip': 'Default window layout when opening XDataHub.',
        'settings.default_open_layout.center': 'Default (Centered 75%)',
        'settings.default_open_layout.left': 'Dock Left',
        'settings.default_open_layout.right': 'Dock Right',
        'settings.default_open_layout.maximized': 'Maximize',
        'settings.sect.window':         'Window',
        'settings.close_behavior':      'Close Button Behavior',
        'settings.close_behavior_tooltip': 'Hide: faster reopen, higher memory. Destroy: lower memory, slower reopen.',
        'settings.close_behavior.hide': 'Hide (faster reopen)',
        'settings.close_behavior.destroy': 'Destroy (lower memory)',
        'settings.edge_peek':           'Edge Peek (auto-hide when docked)',
        'settings.edge_peek_tooltip':   'Hide to a thin strip when docked; hover the strip to reveal',
        'settings.sect.exec':           'Interaction protection',
        'settings.disable_interaction_running': 'Block interaction while running',
        'exec.overlay.running':         'Working, please wait…',
        'settings.sect.canvas':          'Canvas',
        'settings.hover_locate_enabled': 'Locate node on hover',
        'settings.hover_locate_enabled_tooltip': 'Auto-move canvas view to the corresponding node when hovering over it in the send panel',
        'settings.hover_locate_debounce_ms': 'Debounce delay (ms)',
        'settings.hover_locate_debounce_ms_tooltip': 'How long to hover before auto-locating the node',
        'settings.sect.thumb_cache':    'Thumbnail Cache',
        'settings.enable_ffmpeg_thumb_cache': 'FFmpeg cached thumbnails',
        'settings.enable_ffmpeg_thumb_cache_tooltip': 'Use FFmpeg to generate cached thumbnails for videos, improving grid performance. Disable to use native browser rendering.',
        'nav.drawer.open_db_folder':    'Open Database Folder',
        'nav.banner.open_db_folder_ok':   'Opened in file manager',
        'nav.banner.open_db_folder_fail': 'Failed to open folder, please retry',
        'nav.banner.open_db_unsupported': 'Not supported on this platform.',
    },
};

const COMFY_LOCALE_KEY = 'Comfy.Locale';
const LOCALE_WATCH_INTERVAL_MS = 1000;

function _normalizeLocaleCode(value) {
    const text = String(value || '')
        .trim()
        .replace(/_/g, '-')
        .toLowerCase();
    if (!text) {
        return '';
    }
    return text === 'zh' || text.startsWith('zh-') ? 'zh' : 'en';
}

function _readLocaleFromApp(targetWindow) {
    try {
        return targetWindow?.app?.extensionManager?.setting?.get?.(
            COMFY_LOCALE_KEY
        ) || '';
    } catch {
        return '';
    }
}

function _readDocumentLang(targetWindow) {
    try {
        return targetWindow?.document?.documentElement?.lang || '';
    } catch {
        return '';
    }
}

function _resolveLocaleFromComfyUI() {
    // Follow ComfyUI locale only.
    // Simplified/Traditional Chinese -> zh bundle; everything else -> en.
    const candidates = [
        _readLocaleFromApp(window),
        _readLocaleFromApp(window.parent),
        _readLocaleFromApp(window.top),
        localStorage.getItem(COMFY_LOCALE_KEY) || '',
        _readDocumentLang(window.parent),
        _readDocumentLang(window.top),
    ];

    for (const candidate of candidates) {
        const normalized = _normalizeLocaleCode(candidate);
        if (normalized) {
            return normalized;
        }
    }
    return 'en';
}

function _applyLocale(locale) {
    const nextLocale = _normalizeLocaleCode(locale) || 'en';
    if (currentLocale === nextLocale) {
        return false;
    }
    currentLocale = nextLocale;
    appStore.state.locale = nextLocale;
    try {
        document.documentElement.lang = nextLocale === 'zh' ? 'zh-CN' : 'en';
    } catch {
        // Ignore document lang sync failures.
    }
    return true;
}

function _syncLocaleFromComfyUI() {
    return _applyLocale(_resolveLocaleFromComfyUI());
}

function _installSettingSetHook(targetWindow, refresh) {
    try {
        const setting = targetWindow?.app?.extensionManager?.setting;
        if (!setting || typeof setting.set !== 'function') {
            return;
        }
        if (setting.__xdhLocaleHookInstalled) {
            return;
        }

        const originalSet = setting.set.bind(setting);
        setting.set = (...args) => {
            const result = originalSet(...args);
            const key = args[0];
            if (String(key || '') === COMFY_LOCALE_KEY) {
                Promise.resolve(result).finally(refresh);
            }
            return result;
        };
        setting.__xdhLocaleHookInstalled = true;
    } catch {
        // Ignore setting hook failures.
    }
}

function _installLocaleWatcher(refresh) {
    let lastSeen = _resolveLocaleFromComfyUI();
    window.setInterval(() => {
        if (document.hidden) {
            return;
        }
        const next = _resolveLocaleFromComfyUI();
        if (next !== lastSeen) {
            lastSeen = next;
            refresh();
            return;
        }
        if (currentLocale !== next) {
            refresh();
        }
    }, LOCALE_WATCH_INTERVAL_MS);
}

let currentLocale = 'en';
_syncLocaleFromComfyUI();

function _installLocaleSync() {
    const refresh = () => {
        _syncLocaleFromComfyUI();
    };

    window.addEventListener('storage', (event) => {
        if (!event.key || event.key === COMFY_LOCALE_KEY) {
            refresh();
        }
    });
    window.addEventListener('focus', refresh);
    window.addEventListener('pageshow', refresh);
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) {
            refresh();
        }
    });

    const observedRoots = new WeakSet();
    const observeLang = (targetWindow) => {
        try {
            const root = targetWindow?.document?.documentElement;
            if (!root || observedRoots.has(root)) {
                return;
            }
            const observer = new MutationObserver((mutations) => {
                if (
                    mutations.some(
                        (mutation) => mutation.attributeName === 'lang'
                    )
                ) {
                    refresh();
                }
            });
            observer.observe(root, {
                attributes: true,
                attributeFilter: ['lang'],
            });
            observedRoots.add(root);
        } catch {
            // Ignore cross-window access failures.
        }
    };

    _installSettingSetHook(window, refresh);
    _installSettingSetHook(window.parent, refresh);
    _installSettingSetHook(window.top, refresh);
    observeLang(window.parent);
    observeLang(window.top);
    _installLocaleWatcher(refresh);
}

_installLocaleSync();

export function getLocale() {
    return currentLocale;
}

export function setLocale(locale) {
    return _applyLocale(locale);
}

/**
 * Translate a key, with optional variable interpolation.
 * Variables use {name} syntax: t('nav.lock.running_title', {running: 3, pending: 1})
 */
export function t(key, vars) {
    const texts = Dictionary[currentLocale] || Dictionary['zh'];
    let str = texts[key];
    if (str === undefined) {
        str = Dictionary['zh'][key];
    }
    if (str === undefined) return `[${key}]`;
    if (vars) {
        str = str.replace(/\{(\w+)\}/g, (_, k) =>
            vars[k] !== undefined ? String(vars[k]) : `{${k}}`
        );
    }
    return str;
}
