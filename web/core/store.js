export class Store {
    constructor(initialState = {}) {
        this.listeners = new Set();
        this.state = new Proxy(initialState, {
            set: (target, key, value) => {
                if (target[key] === value) {
                    return true;
                }
                target[key] = value;
                this.notify(key, value);
                return true;
            }
        });
    }

    subscribe(listener) {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    notify(key, value) {
        for (const listener of this.listeners) {
            try {
                listener(this.state, key, value);
            } catch (err) {
                console.error("Store listener error:", err);
            }
        }
    }
}

// Global default store
export const appStore = new Store({
    activeCategory: 'image', // 'image', 'video', 'audio', 'lora'
    activeFolder: '',
    mediaList: [],         // Currently displayed items
    isLoading: false,
    loadError: '',
    selectedItems: [],     // Items mapped to Staging Dock
    loraDetailOpen: false,
    isCompact: false,      // Track responsive state
    lockState: {
        state: 'IDLE',
        readonly: false,
        cooldown_ms: 0,
        is_executing: false,
        queue_remaining: 0,
        queue_running: 0,
        queue_pending: 0,
        interrupt_requested: false,
        last_event: '',
    },

    // View controls
    cardSize: 'medium',    // 'small' | 'medium' | 'large'
    sortOrder: 'date-desc',// 'date-desc' | 'date-asc' | 'name-asc' | 'name-desc'
    searchQuery: '',

    // Navigation history  (managed by xdatahub_app_v2.js)
    navHistory: [{ category: 'image', folder: '', page: 1, folderLabel: '' }],
    navIndex: 0,
    _navSkipPush: false,   // internal flag — set before back/fwd navigation
    activeFolderLabel: '', // display name for active folder (may differ from path)

    // Pagination
    currentPage: 1,
    totalPages: 1,

    // Runtime XDataHub settings used by V2 components
    xdatahubSettings: {
        video_preview_autoplay: false,
        video_preview_muted: true,
        video_preview_loop: false,
        audio_preview_autoplay: false,
        audio_preview_muted: false,
        audio_preview_loop: false,
        theme_mode: 'dark',
        auto_show_on_startup: false,
        hotkey_spec: 'Alt + X',
        default_open_layout: 'center',
        close_behavior: 'hide',
        disable_interaction_while_running: true,
    },

    // i18n — default English; i18n.js overwrites at module load from Comfy.Locale
    locale: 'en',
});

