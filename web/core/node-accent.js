export const NODE_ACCENT_HEX_DEFAULT = "#0066FF";

export const NODE_ACCENT_HEX_PALETTE = [
    "#0066FF",
    "#D90429",
    "#00A86B",
    "#FFBF00",
    "#CC00CC",
    "#00CCCC",
    "#FF6600",
    "#0066FF",
    "#D90429",
    "#00A86B",
    "#FFBF00",
    "#CC00CC",
];

export const NODE_ACCENT_TOKEN_DEFAULT = "var(--db-palette-default)";

function normalizeColorKey(value) {
    return String(value || "").trim().toLowerCase();
}

function normalizePaletteIndex(index) {
    if (NODE_ACCENT_HEX_PALETTE.length < 1) {
        return -1;
    }
    const num = Number(index);
    if (!Number.isFinite(num)) {
        return -1;
    }
    return (
        (num % NODE_ACCENT_HEX_PALETTE.length)
        + NODE_ACCENT_HEX_PALETTE.length
    ) % NODE_ACCENT_HEX_PALETTE.length;
}

export function hashColorKeyU32(rawKey) {
    const key = normalizeColorKey(rawKey);
    if (!key) {
        return 0;
    }
    let hash = 2166136261;
    for (let i = 0; i < key.length; i += 1) {
        hash ^= key.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
}

export function getHashedAccentIndex(rawKey) {
    const key = normalizeColorKey(rawKey);
    if (!key || NODE_ACCENT_HEX_PALETTE.length < 1) {
        return -1;
    }
    return hashColorKeyU32(key) % NODE_ACCENT_HEX_PALETTE.length;
}

export function getModuloAccentIndex(rawNodeId) {
    if (NODE_ACCENT_HEX_PALETTE.length < 1) {
        return -1;
    }
    const id = parseInt(
        String(rawNodeId ?? "").split(":").pop() || "0",
        10
    );
    if (!Number.isFinite(id) || id < 0) {
        return -1;
    }
    return id % NODE_ACCENT_HEX_PALETTE.length;
}

export function getHexAccentByIndex(index) {
    const safeIndex = normalizePaletteIndex(index);
    if (safeIndex < 0) {
        return NODE_ACCENT_HEX_DEFAULT;
    }
    return NODE_ACCENT_HEX_PALETTE[safeIndex] || NODE_ACCENT_HEX_DEFAULT;
}

export function getTokenAccentByIndex(index) {
    const safeIndex = normalizePaletteIndex(index);
    if (safeIndex < 0) {
        return NODE_ACCENT_TOKEN_DEFAULT;
    }
    const tokenId = String(safeIndex + 1).padStart(2, "0");
    return `var(--db-palette-${tokenId})`;
}

export function getHexAccentFromHashedKey(rawKey) {
    return getHexAccentByIndex(getHashedAccentIndex(rawKey));
}

export function getHexAccentFromModuloId(rawNodeId) {
    return getHexAccentByIndex(getModuloAccentIndex(rawNodeId));
}

export function resolveTokenAccentFromNode(node) {
    const accentIndex = Number(node?.accent_index);
    if (Number.isFinite(accentIndex)) {
        return getTokenAccentByIndex(accentIndex);
    }
    return getTokenAccentByIndex(getHashedAccentIndex(node?.id));
}
