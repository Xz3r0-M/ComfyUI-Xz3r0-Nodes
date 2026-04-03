// Category → { media_type, dir } mapping for /media endpoint
const CATEGORY_PARAMS = {
    image:  { media_type: "image", dir: "" },
    video:  { media_type: "video", dir: "" },
    audio:  { media_type: "audio", dir: "" },
};

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

export async function apiGet(path, query = {}) {
    const url = new URL(path, window.location.origin);
    Object.entries(query).forEach(([k, v]) => {
        if (v !== undefined && v !== null && v !== "") {
            url.searchParams.append(k, v);
        }
    });
    try {
        const response = await fetch(url.toString(), { method: "GET" });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return await response.json();
    } catch (e) {
        console.warn("[xdh-api] GET failed, returning mock data.", e);
        return {
            items: makeMockItems(12),
            page: 1, total_pages: 1, total: 12,
        };
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
export async function loadMediaList(category, page = 1, pageSize = 50, dir = "") {
    const params = CATEGORY_PARAMS[category] || CATEGORY_PARAMS.image;
    return await apiGet("/xz3r0/xdatahub/media", {
        media_type: params.media_type,
        dir:        dir || params.dir || undefined,
        page,
        page_size:  pageSize,
        flat:       0,
    });
}

export async function loadLoraList(page = 1, pageSize = 50, dir = "") {
    return await apiGet("/xz3r0/xdatahub/loras", {
        page,
        page_size: pageSize,
        dir: dir || undefined,
    });
}

export async function loadRecords(page = 1, pageSize = 50) {
    return await apiGet("/xz3r0/xdatahub/records", {
        page, page_size: pageSize, sort_order: "desc",
    });
}

export async function loadFavorites(page = 1, pageSize = 50) {
    return await apiGet("/xz3r0/xdatahub/favorites", {
        page, page_size: pageSize, sort_order: "desc",
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
    try {
        const response = await fetch("/xz3r0/xdatahub/lock/status", {
            method: "GET"
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return await response.json();
    } catch (e) {
        console.warn("[xdh-api] lock status failed, returning idle state.", e);
        return {
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
        };
    }
}

export function buildMediaUrl(mediaRef) {
    return `/xz3r0/xdatahub/media/file?ref=${encodeURIComponent(mediaRef)}`;
}

