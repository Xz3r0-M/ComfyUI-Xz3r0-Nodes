// Category → { media_type, dir } mapping for /media endpoint
const CATEGORY_PARAMS = {
    image:  { media_type: "image", dir: "" },
    video:  { media_type: "video", dir: "" },
    audio:  { media_type: "audio", dir: "" },
};

const MOCK_MODE_QUERY_KEYS = ["xdh_mock", "xdh_offline"];

function isTruthyFlag(value) {
    const normalized = String(value || "").trim().toLowerCase();
    return normalized === "1"
        || normalized === "true"
        || normalized === "yes"
        || normalized === "on";
}

function isMockModeEnabled() {
    try {
        const url = new URL(window.location.href);
        return MOCK_MODE_QUERY_KEYS.some((key) =>
            isTruthyFlag(url.searchParams.get(key))
        );
    } catch {
        return false;
    }
}

function buildApiError(path, url, error, status = 0) {
    if (error instanceof Error) {
        error.path = path;
        error.url = url;
        if (status > 0) {
            error.status = status;
        }
        return error;
    }

    const fallbackError = new Error(String(error || "Request failed"));
    fallbackError.path = path;
    fallbackError.url = url;
    if (status > 0) {
        fallbackError.status = status;
    }
    return fallbackError;
}

function buildMockListResponse(label = "Item", count = 12) {
    return {
        items: makeMockItems(count, label),
        page: 1,
        total_pages: 1,
        total: count,
    };
}

function makeMockItems(count, label = "Item") {
    return Array.from({ length: count }, (_, i) => ({
        id: `mock:${label.toLowerCase()}_${i}.png`,
        kind: "image",
        title: `${label} ${i + 1}`,
        saved_at: new Date(Date.now() - i * 3600_000).toISOString(),
        previewable: true,
        extra: { media_type: "image", media_ref: `mock/${i}.png`, isMock: true },
    }));
}

export async function apiGet(path, query = {}, options = {}) {
    const fallbackFactory = options.fallbackFactory;
    const url = new URL(path, window.location.origin);
    Object.entries(query).forEach(([k, v]) => {
        if (v !== undefined && v !== null && v !== "") {
            url.searchParams.append(k, v);
        }
    });
    try {
        const response = await fetch(url.toString(), { method: "GET" });
        if (!response.ok) {
            throw buildApiError(
                path,
                url.toString(),
                new Error(`HTTP ${response.status}`),
                response.status
            );
        }
        return await response.json();
    } catch (e) {
        const error = buildApiError(path, url.toString(), e);
        if (
            typeof fallbackFactory === "function"
            && isMockModeEnabled()
        ) {
            console.warn(
                `[xdh-api] GET ${path} failed in mock/offline mode, returning mock data.`,
                error
            );
            return fallbackFactory(error);
        }
        console.warn(`[xdh-api] GET ${path} failed.`, error);
        throw error;
    }
}

export async function apiPost(path, body = {}) {
    const url = new URL(path, window.location.origin);
    try {
        const response = await fetch(url.toString(), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return await response.json();
    } catch (e) {
        console.warn(`[xdh-api] POST ${path} failed:`, e);
        throw e;
    }
}

/**
 * Load media for a given category.
 * category: "image" | "video" | "audio"
 */
export async function loadMediaList(
    category,
    page = 1,
    pageSize = 50,
    dir = "",
    sortBy = "mtime",
    sortOrder = "desc"
) {
    const params = CATEGORY_PARAMS[category] || CATEGORY_PARAMS.image;
    return await apiGet("/xz3r0/xdatahub/media", {
        media_type: params.media_type,
        dir:        dir || params.dir || undefined,
        page,
        page_size:  pageSize,
        sort_by:    sortBy,
        sort_order: sortOrder,
        flat:       0,
    }, {
        fallbackFactory: () => buildMockListResponse(category || "Item"),
    });
}

export async function loadLoraList(
    page = 1,
    pageSize = 50,
    dir = "",
    sortBy = "mtime",
    sortOrder = "desc"
) {
    return await apiGet("/xz3r0/xdatahub/loras", {
        page,
        page_size: pageSize,
        dir: dir || undefined,
        sort_by: sortBy,
        sort_order: sortOrder,
    }, {
        fallbackFactory: () => buildMockListResponse("Lora"),
    });
}

export async function loadRecords(page = 1, pageSize = 50) {
    return await apiGet("/xz3r0/xdatahub/records", {
        page, page_size: pageSize, sort_order: "desc",
    }, {
        fallbackFactory: () => buildMockListResponse("Record"),
    });
}

export async function loadFavorites(page = 1, pageSize = 50) {
    return await apiGet("/xz3r0/xdatahub/favorites", {
        page, page_size: pageSize, sort_order: "desc",
    }, {
        fallbackFactory: () => buildMockListResponse("Favorite"),
    });
}

export async function addFavorite(record) {
    try {
        const response = await fetch("/xz3r0/xdatahub/favorites", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(record),
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return await response.json();
    } catch (e) {
        console.warn("[xdh-api] addFavorite failed:", e);
        return null;
    }
}

export async function removeFavorite(favoriteId) {
    try {
        const response = await fetch("/xz3r0/xdatahub/favorites/delete", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ids: [favoriteId] }),
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return await response.json();
    } catch (e) {
        console.warn("[xdh-api] removeFavorite failed:", e);
        return null;
    }
}

export async function loadLockStatus() {
    return await apiGet("/xz3r0/xdatahub/lock/status", {}, {
        fallbackFactory: () => ({
            status: "success",
            state: "IDLE",
            readonly: false,
            cooldown_ms: 0,
            is_executing: false,
            queue_remaining: 0,
            queue_running: 0,
            queue_pending: 0,
            interrupt_requested: false,
            last_event: "fallback",
        }),
    });
}

export function buildMediaUrl(mediaRef) {
    return `/xz3r0/xdatahub/media/file?ref=${encodeURIComponent(mediaRef)}`;
}

