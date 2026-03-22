export type LockState = {
    state: "IDLE" | "RUNNING" | "COOLDOWN";
    readonly: boolean;
    cooldown_ms: number;
};

export type UnifiedListItem = {
    id: string;
    kind: string;
    title: string;
    saved_at: string;
    path: string;
    previewable: boolean;
    extra: Record<string, unknown>;
};

export type TabState = {
    page: number;
    pageSize: number;
    selectedId: string;
    scrollTop: number;
    filters: {
        keyword: string;
        dataType: string;
        start: string;
        end: string;
    };
};
