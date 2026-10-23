import {
    BaseElement,
    registerCustomElement,
} from "../core/base-element.js?v=20260403-2";
import { icon, ICON_CSS, SCROLLBAR_CSS, TOOLTIP_CSS } from "../core/icon.js";
import { apiGet, apiPost, apiUpload } from "../core/api.js?v=20261013-1";
import { appStore } from "../core/store.js";
import { banner } from "../core/banner.js";
import { t } from "../core/i18n.js?v=20261013-1";

function escapeHtml(value) {
    return String(value || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function escapeAttr(value) {
    return escapeHtml(value);
}

const COVER_EXT_SET = new Set([
    ".png",
    ".jpg",
    ".jpeg",
    ".webp",
    ".bmp",
    ".gif",
    ".mp4",
    ".webm",
    ".mov",
]);
const COVER_MAX_BYTES = 100 * 1024 * 1024;
// 同时写扩展名与 MIME：Windows/Linux 的对话框主要按扩展名过滤，
// macOS 走 MIME/UTI，两边都写才能三大系统都正确筛选出 .mov 等格式
const COVER_ACCEPT = [
    ".png",
    ".jpg",
    ".jpeg",
    ".webp",
    ".bmp",
    ".gif",
    ".mp4",
    ".webm",
    ".mov",
    "image/png",
    "image/jpeg",
    "image/webp",
    "image/bmp",
    "image/gif",
    "video/mp4",
    "video/webm",
    "video/quicktime",
].join(",");

export class XdhLoraDetail extends BaseElement {
    constructor() {
        super();
        this._currentRef = null;
        this._currentData = null;
        this._isLoading = false;
        this._isLinked = false;
        this._imgLoaded = false;
        this._coverBusy = false;
        this._confirm = null;
        this._pendingCover = null;

        this._onOpenDetail = (e) => this._open(e.detail);
        this._onKeydown = (e) => {
            if (e.key !== "Escape") return;
            if (this._confirm) {
                this._closeConfirm();
                return;
            }
            this._close();
        };
    }

    connectedCallback() {
        super.connectedCallback();
        document.addEventListener("xdh:lora-detail", this._onOpenDetail);
        document.addEventListener("keydown", this._onKeydown);
    }

    disconnectedCallback() {
        super.disconnectedCallback();
        document.removeEventListener("xdh:lora-detail", this._onOpenDetail);
        document.removeEventListener("keydown", this._onKeydown);
        appStore.state.loraDetailOpen = false;
    }

    async _open(detail) {
        if (!detail || !detail.ref) return;
        this._currentRef = detail.ref;
        appStore.state.loraDetailOpen = true;
        this._isLoading = true;
        this._currentData = null;
        this._imgLoaded = false;
        this._coverBusy = false;
        this._confirm = null;
        this._pendingCover = null;
        this.renderRoot();

        this.$(".drawer-wrap")?.classList.add("open");

        try {
            const res = await apiGet(
                "/xz3r0/xdatahub/loras/trigger-words",
                { ref: this._currentRef }
            );
            if (res && res.status === "success" && res.item) {
                this._currentData = res.item;
                const sm = this._currentData.strength_model ?? 1.0;
                const sc = this._currentData.strength_clip ?? 1.0;
                this._isLinked = (sm === sc);
            }
        } catch (e) {
            console.error("Failed to load Lora detail:", e);
            banner.error(t("lora.banner.load_fail"));
        } finally {
            this._isLoading = false;
            this.renderRoot();
            this.$(".drawer-wrap")?.classList.add("open");
        }
    }

    _close() {
        this.$(".drawer-wrap")?.classList.remove("open");
        appStore.state.loraDetailOpen = false;
        this._currentRef = null;
        this._currentData = null;
        this._confirm = null;
        this._pendingCover = null;
    }

    async _save() {
        if (!this._currentRef || !this._currentData) return;

        const noteEl = this.$("#lora-note");
        const strengthModelEl = this.$("#lora-strength-model");
        const strengthClipEl = this.$("#lora-strength-clip");
        const triggerWordsEl = this.$("#lora-trigger-words");
        const saveBtn = this.$(".save-btn");
        const modelStrength = Number.parseFloat(
            strengthModelEl ? strengthModelEl.value : "1"
        );
        const clipStrength = Number.parseFloat(
            strengthClipEl ? strengthClipEl.value : "1"
        );

        const triggerWordsRaw = (triggerWordsEl ? triggerWordsEl.value : "")
            .split(/\r?\n/)
            .map(s => s.trim())
            .filter(s => s !== "");

        const payload = {
            ref: this._currentRef,
            title: this._currentData.title,
            sha256: this._currentData.sha256,
            mtime: this._currentData.mtime,
            lora_note: noteEl ? noteEl.value : "",
            strength_model: Number.isFinite(modelStrength) ? modelStrength : 1.0,
            strength_clip: Number.isFinite(clipStrength) ? clipStrength : 1.0,
            trigger_words: triggerWordsRaw.map(text => ({ text }))
        };

        try {
            if (saveBtn) saveBtn.classList.add("loading");

            const res = await apiPost("/xz3r0/xdatahub/loras/trigger-words", payload);
            if (res && res.status === "success") {
                banner.success(t("lora.banner.save_ok"));
                this._close();
                // trigger refresh to update grid if needed
                appStore.state.refreshTrigger = Date.now();
            }
        } catch (e) {
            console.error("Failed to save Lora detail:", e);
            banner.error(t("lora.banner.save_fail"));
        } finally {
            if (saveBtn) saveBtn.classList.remove("loading");
        }
    }

    async _importMetadata() {
        if (!this._currentRef) return;
        const btn = this.$(".import-meta-btn");
        if (btn) btn.classList.add("loading");
        try {
            const res = await apiGet("/xz3r0/xdatahub/loras/trigger-words/from-metadata", { ref: this._currentRef });
            if (res && res.status === "success" && res.trigger_words) {
                const twWords = res.trigger_words
                    .map(w => (w.text || w).trim()).filter(Boolean).join("\n");
                const twIn = this.$("#lora-trigger-words");
                if (twIn && twWords) {
                    if (twIn.value.trim().length > 0) {
                        twIn.value = twIn.value.trimEnd() + "\n" + twWords;
                    } else {
                        twIn.value = twWords;
                    }
                    banner.success(t("lora.banner.import_ok"));
                } else {
                    banner.info(t("lora.banner.import_empty"));
                }
            }
        } catch (e) {
            console.error("Failed to import metadata:", e);
            banner.error(t("lora.banner.import_fail"));
        } finally {
            if (btn) btn.classList.remove("loading");
        }
    }

    _toggleLink() {
        this._isLinked = !this._isLinked;
        const btn = this.$(".link-btn");
        const clipIn = this.$("#lora-strength-clip");
        const modelIn = this.$("#lora-strength-model");

        if (btn) {
            if (this._isLinked) {
                btn.classList.add("linked");
                btn.innerHTML = icon("link-2", 14);
                btn.setAttribute("data-tooltip", t("lora.btn.unlink"));
            } else {
                btn.classList.remove("linked");
                btn.innerHTML = icon("unlink-2", 14);
                btn.setAttribute("data-tooltip", t("lora.btn.link"));
            }
        }

        if (this._isLinked && modelIn && clipIn) {
            clipIn.value = modelIn.value;
            clipIn.disabled = true;
        } else if (clipIn) {
            clipIn.disabled = false;
        }
    }

    /* ── 封面：选择 / 上传 / 删除 / 预览 ────────────────── */

    _rerenderDrawer() {
        // renderRoot 会重建 DOM（丢掉 open 类），重绘后必须重新挂上
        this.renderRoot();
        this.$(".drawer-wrap")?.classList.add("open");
    }

    _renderConfirmDialog() {
        if (!this._confirm) return "";
        const isRemove = this._confirm.kind === "remove";
        const names = Array.isArray(this._confirm.names)
            ? this._confirm.names
            : [];
        const listHtml = names
            .map((name) => `<li>${escapeHtml(name)}</li>`)
            .join("");
        const titleKey = isRemove
            ? "lora.cover.confirm_remove_title"
            : "lora.cover.confirm_replace_title";
        const bodyKey = isRemove
            ? "lora.cover.confirm_remove_body"
            : "lora.cover.confirm_replace_body";
        return `
            <div class="confirm-overlay">
                <div class="confirm-box">
                    <div class="confirm-title">
                        ${icon("triangle-alert", 14)}
                        <span>${t(titleKey)}</span>
                    </div>
                    <div class="confirm-body">${t(bodyKey)}</div>
                    <ul class="confirm-list">${listHtml}</ul>
                    <div class="confirm-actions">
                        <button class="confirm-btn js-confirm-cancel">
                            ${t('common.cancel')}
                        </button>
                        <button class="confirm-btn is-danger js-confirm-ok"
                            ${this._coverBusy ? "disabled" : ""}>
                            ${t('common.confirm')}
                        </button>
                    </div>
                </div>
            </div>`;
    }

    _openConfirm(kind, names) {
        this._confirm = { kind, names: names || [] };
        this._rerenderDrawer();
    }

    _closeConfirm() {
        if (this._coverBusy) return;
        this._confirm = null;
        this._pendingCover = null;
        this._rerenderDrawer();
    }

    async _confirmAction() {
        const confirm = this._confirm;
        if (!confirm || this._coverBusy) return;
        if (confirm.kind === "replace") {
            const file = this._pendingCover;
            if (!file) {
                this._closeConfirm();
                return;
            }
            await this._uploadCover(file, true);
            return;
        }
        await this._deleteCover();
    }

    async _handleCoverFile(file) {
        if (!file || this._coverBusy) return;
        const name = String(file.name || "");
        const dotIndex = name.lastIndexOf(".");
        const ext = dotIndex >= 0 ? name.slice(dotIndex).toLowerCase() : "";
        if (!COVER_EXT_SET.has(ext)) {
            banner.error(t("lora.cover.invalid_format"));
            return;
        }
        if (Number(file.size || 0) > COVER_MAX_BYTES) {
            banner.error(t("lora.cover.too_large"));
            return;
        }
        await this._uploadCover(file, false);
    }

    async _uploadCover(file, overwrite) {
        if (!this._currentRef || this._coverBusy) return;
        this._coverBusy = true;
        this._confirm = null;
        this._rerenderDrawer();
        try {
            const form = new FormData();
            form.append("file", file, String(file.name || "cover"));
            const ref = encodeURIComponent(this._currentRef);
            const query = overwrite
                ? `?ref=${ref}&overwrite=1`
                : `?ref=${ref}`;
            const res = await apiUpload(
                "/xz3r0/xdatahub/loras/cover" + query,
                form
            );
            if (res.ok && res.data && res.data.status === "success") {
                if (this._currentData) {
                    this._currentData.cover = res.data.cover || null;
                }
                this._pendingCover = null;
                banner.success(t("lora.cover.upload_ok"));
                this._patchListedCover(res.data.cover || null);
                this._notifyCoverChanged(res.data.cover || null);
                appStore.state.refreshTrigger = Date.now();
                return;
            }
            if (
                res.status === 409
                && res.data
                && res.data.code === "cover_exists"
            ) {
                const names = Array.isArray(res.data.existing)
                    ? res.data.existing.map(String)
                    : [];
                const target = String(res.data.target || "");
                if (target && !names.includes(target)) names.push(target);
                this._pendingCover = file;
                this._openConfirm("replace", names);
                return;
            }
            this._pendingCover = null;
            if (res.status === 413 && !res.data) {
                // 服务器自己的上传上限更小（ComfyUI --max-upload-size）
                banner.error(t("lora.cover.too_large_server"));
            } else if (res.status === 413) {
                banner.error(t("lora.cover.too_large"));
            } else if (res.status === 415) {
                banner.error(t("lora.cover.invalid_format"));
            } else if (res.status === 409 || res.status === 403) {
                banner.error(t("lora.cover.readonly"));
            } else {
                banner.error(t("lora.cover.upload_fail"));
            }
        } catch (e) {
            console.error("Failed to upload LoRA cover:", e);
            this._pendingCover = null;
            banner.error(t("lora.cover.upload_fail"));
        } finally {
            this._coverBusy = false;
            this._rerenderDrawer();
        }
    }

    async _deleteCover() {
        if (!this._currentRef || this._coverBusy) return;
        this._coverBusy = true;
        this._rerenderDrawer();
        try {
            const res = await apiPost(
                "/xz3r0/xdatahub/loras/cover/delete",
                { ref: this._currentRef }
            );
            if (res && res.status === "success") {
                if (this._currentData) this._currentData.cover = null;
                banner.success(t("lora.cover.remove_ok"));
                this._patchListedCover(null);
                this._notifyCoverChanged(null);
                appStore.state.refreshTrigger = Date.now();
            } else {
                banner.error(t("lora.cover.remove_fail"));
            }
        } catch (e) {
            console.error("Failed to remove LoRA cover:", e);
            banner.error(t("lora.cover.remove_fail"));
        } finally {
            this._coverBusy = false;
            this._confirm = null;
            this._pendingCover = null;
            this._rerenderDrawer();
        }
    }

    /**
     * 换完封面立刻改掉列表里那张卡片。
     *
     * 光靠 refreshTrigger 重新拉列表也能更新，但要多等一次往返；这里
     * 直接用接口返回的新地址替换，用户一回头就看见新图。
     */
    _patchListedCover(cover) {
        const list = appStore.state.mediaList;
        if (!Array.isArray(list) || !this._currentRef) {
            return;
        }
        const targetId = `lora:${this._currentRef}`;
        let changed = false;
        const next = list.map((item) => {
            if (!item || String(item.id) !== targetId) {
                return item;
            }
            changed = true;
            if (!cover) {
                return {
                    ...item,
                    thumbUrl: "",
                    fullUrl: "",
                    coverKind: "",
                    previewable: false,
                    isVideoNativeThumb: false,
                };
            }
            // 接口返回的是抽屉用的 720 尺寸，卡片要 300 那张：
            // 自己拼一次，免得卡片先下一张 720 又换成 300
            const ver = String(cover.ver || "");
            const cardUrl = ver
                ? `/xz3r0/xdatahub/loras/thumb?ref=${
                    encodeURIComponent(this._currentRef)
                }&variant=thumb&ver=${encodeURIComponent(ver)}`
                : String(cover.thumb_url || cover.url || "");
            return {
                ...item,
                thumbUrl: cardUrl,
                fullUrl: String(cover.url || ""),
                coverKind: String(cover.kind || "image"),
                previewable: true,
                isVideoNativeThumb: false,
            };
        });
        if (changed) {
            appStore.state.mediaList = next;
        }
    }

    /** 通知宿主页面/节点面板：这个 LoRA 的封面换了。 */
    _notifyCoverChanged(cover) {
        const detail = {
            ref: String(this._currentRef || ""),
            thumb_url: cover ? String(cover.thumb_url || "") : "",
            cover_url: cover ? String(cover.url || "") : "",
            kind: cover ? String(cover.kind || "") : "",
        };
        document.dispatchEvent(
            new CustomEvent("xdh:lora-cover-changed", { detail })
        );
        if (!window.parent || window.parent === window) {
            return;
        }
        window.parent.postMessage(
            { type: "xdatahub:lora_cover_changed", ...detail },
            window.location.origin
        );
    }

    _openCoverPreview() {
        const cover = this._currentData ? this._currentData.cover : null;
        if (!cover || !cover.url) return;
        const isVideo = String(cover.kind || "") === "video";
        document.dispatchEvent(new CustomEvent("xdh:preview", {
            detail: {
                id: `loracover:${this._currentRef}`,
                name: String(cover.name || ""),
                url: String(cover.url),
                thumbnailUrl: String(cover.thumb_url || ""),
                type: isVideo ? "video" : "image",
                iconHtml: icon("video", 56),
                raw: {
                    extra: {
                        media_ref: this._currentRef,
                        media_type: "lora",
                    },
                },
            },
        }));
    }

    /**
     * 封面加载完就收起转圈。
     * 之前没提示，大图要等几秒，期间预览框里只有背景色。
     */
    _watchCoverLoading() {
        const box = this.$(".preview-loading");
        if (!box) return;
        const still = this.$(".preview-still") || this.$(".preview-img");
        if (!still) {
            box.remove();
            return;
        }
        const done = () => box.remove();
        if (still.complete && still.naturalWidth > 0) {
            done();
            return;
        }
        still.addEventListener("load", done, { once: true });
        still.addEventListener("error", done, { once: true });
    }

    bindEvents() {
        this._watchCoverLoading();
        this.$(".backdrop")?.addEventListener("click", () => this._close());
        this.$(".lb-close")?.addEventListener("click", () => this._close());
        this.$(".cancel-btn")?.addEventListener("click", () => this._close());
        this.$(".save-btn")?.addEventListener("click", () => this._save());

        this.$(".link-btn")?.addEventListener("click", () => this._toggleLink());
        this.$("#lora-strength-model")?.addEventListener("input", (e) => {
            if (this._isLinked) {
                const clipIn = this.$("#lora-strength-clip");
                if (clipIn) clipIn.value = e.target.value;
            }
        });
        this.$(".import-meta-btn")?.addEventListener("click", () => this._importMetadata());

        // ── 封面 ────────────────────────────────────────
        this.$(".preview-area")?.addEventListener("click", () => {
            this._openCoverPreview();
        });
        this.$(".js-cover-pick")?.addEventListener("click", (e) => {
            e.stopPropagation();
            if (this._coverBusy) return;
            this.$(".cover-file-input")?.click();
        });
        this.$(".js-cover-remove")?.addEventListener("click", (e) => {
            e.stopPropagation();
            if (this._coverBusy) return;
            const cover = this._currentData ? this._currentData.cover : null;
            this._openConfirm("remove", cover ? [cover.name] : []);
        });
        this.$(".cover-file-input")?.addEventListener("change", (e) => {
            const input = e.target;
            const file = input.files ? input.files[0] : null;
            input.value = "";
            if (file) void this._handleCoverFile(file);
        });
        // ── 确认框 ────────────────────────────────────
        this.$(".confirm-overlay")?.addEventListener("click", (e) => {
            if (e.target === e.currentTarget) this._closeConfirm();
        });
        this.$(".js-confirm-cancel")?.addEventListener("click", () => {
            this._closeConfirm();
        });
        this.$(".js-confirm-ok")?.addEventListener("click", () => {
            void this._confirmAction();
        });
    }

    render() {
        if (!this._currentRef) {
            return `<style>${ICON_CSS} ${TOOLTIP_CSS} :host { display: contents; }</style>
                    <div class="drawer-wrap"></div>`;
        }

        const data = this._currentData;
        const isLoading = this._isLoading || !data;
        const title = data ? data.title : t("lora.title_default");

        let drawerBody;
        if (isLoading) {
            drawerBody = `<div class="loading-state">
                ${icon("refresh-cw", 18)} ${t('lora.loading')}
            </div>`;
        } else {
            const twWords = (data.trigger_words || [])
                .map(w => (w.text || w).trim()).filter(Boolean).join("\n");
            const note = data.lora_note || "";
            const sM = data.strength_model ?? 1.0;
            const sC = data.strength_clip ?? 1.0;
            const cover = data.cover || null;
            const isVideoCover = !!cover && cover.kind === "video";
            const coverName = cover ? String(cover.name || "") : "";
            const coverUrl = cover ? String(cover.url || "") : "";
            // 关掉「图片缓存缩略图」时抽屉也用封面原图，和列表保持一致；
            // 视频封面只能靠服务端抽帧，取不到就只显示播放按钮
            const loraSettings = appStore.state.xdatahubSettings || {};
            const useStillFromThumb = isVideoCover
                || loraSettings.enable_image_thumb_cache !== false;
            const coverStillUrl = cover
                ? String(
                    useStillFromThumb
                        ? cover.thumb_url || cover.url || ""
                        : cover.url || ""
                )
                : "";
            const safeNote = escapeHtml(note);
            const safeCoverUrl = escapeAttr(coverUrl);
            const safeCoverStillUrl = escapeAttr(coverStillUrl);
            const safeCoverName = escapeHtml(coverName);
            const safeTriggerWords = escapeHtml(twWords);
            const safeStrengthModel = escapeAttr(String(sM));
            const safeStrengthClip = escapeAttr(String(sC));

            const previewBody = !cover
                ? `<span class="preview-empty">${icon("image", 36)}</span>`
                : isVideoCover
                    ? `<img class="preview-still"
                            src="${safeCoverStillUrl}" alt=""
                            onerror="this.style.display='none'"/>
                        <span class="preview-play">${icon("play", 20)}</span>`
                    : `<img class="preview-blur"
                            src="${safeCoverStillUrl}"
                            alt="" aria-hidden="true"
                            onerror="this.style.display='none'"/>
                        <img class="preview-img"
                            src="${safeCoverStillUrl}" alt="Cover"
                            onerror="this.style.display='none'"/>`;
            // 大图解码要一会儿，先给个转圈，别让人对着空框
            const previewLoading = cover
                ? `<div class="preview-loading">
                        <div class="preview-loading-pill">
                            <span class="preview-spinner"
                                aria-hidden="true"></span>
                            <span class="preview-loading-text">
                                ${escapeHtml(t("common.loading"))}
                            </span>
                        </div>
                    </div>`
                : "";

            const coverPickBtn = `
                <button class="cover-btn xdh-tooltip xdh-tooltip-down js-cover-pick"
                    data-tooltip="${t('lora.cover.btn.change')}">
                    ${icon("image-up", 14)}
                </button>`;
            const coverRemoveBtn = cover
                ? `
                <button class="cover-btn is-danger xdh-tooltip xdh-tooltip-down js-cover-remove"
                    data-tooltip="${t('lora.cover.btn.remove')}">
                    ${icon("trash-2", 14)}
                </button>`
                : "";
            const coverCaption = cover
                ? `${icon(isVideoCover ? "video" : "image", 12)}
                   <span class="cover-name">${safeCoverName}</span>`
                : `<span class="cover-name">${t('lora.cover.empty')}</span>`;
            const coverHint = isVideoCover
                ? ` title="${escapeAttr(t('lora.cover.video_hint'))}"`
                : "";

            drawerBody = `
                <div class="preview-area ${cover ? "has-cover" : ""}"
                    data-cover-url="${safeCoverUrl}"${coverHint}>
                    ${previewBody}
                    ${previewLoading}
                    <div class="preview-actions">
                        ${coverPickBtn}${coverRemoveBtn}
                    </div>
                    <div class="preview-caption">${coverCaption}</div>
                </div>
                <div class="form-scroll xdh-scroll">
                    <div class="strength-row">
                        <div class="field-group">
                            <label>${t('lora.label.model_strength')}</label>
                            <input type="number"
                                id="lora-strength-model"
                                step="0.05"
                                value="${safeStrengthModel}"/>
                        </div>
                        <button
                            class="link-btn xdh-tooltip xdh-tooltip-down ${this._isLinked ? "linked" : ""}"
                            data-tooltip="${this._isLinked ? t('lora.btn.unlink') : t('lora.btn.link')}">
                            ${icon(this._isLinked ? "link-2" : "unlink-2", 14)}
                        </button>
                        <div class="field-group">
                            <label>${t('lora.label.clip_strength')}</label>
                            <input type="number"
                                id="lora-strength-clip"
                                step="0.05"
                                value="${safeStrengthClip}"
                                ${this._isLinked ? "disabled" : ""}/>
                        </div>
                    </div>

                    <div class="field-group">
                        <label>${t('lora.label.note')}</label>
                        <textarea id="lora-note" class="note-ta"
                            placeholder="${t('lora.placeholder.note')}"
                        >${safeNote}</textarea>
                    </div>

                    <div class="field-group">
                        <div class="tw-label-row">
                            <label>${t('lora.label.trigger_words')}</label>
                            <button class="import-meta-btn xdh-tooltip xdh-tooltip-down"
                                data-tooltip="${t('lora.btn.import_meta_title')}">
                                ${icon("database", 12)} ${t('lora.btn.import_meta')}
                            </button>
                        </div>
                        <textarea id="lora-trigger-words" class="tw-ta"
                            placeholder="${t('lora.placeholder.tw')}"
                        >${safeTriggerWords}</textarea>
                    </div>
                </div>
                <div class="footer-bar">
                    <button class="cancel-btn">${t('common.cancel')}</button>
                    <button class="save-btn">
                        ${icon("save", 14)} ${t('common.save')}
                    </button>
                </div>
            `;
        }

        return `
            <style>
                ${ICON_CSS}
                ${TOOLTIP_CSS}
                :host { display: contents; }

                /* ── Wrapper ─────────────────────────── */
                .drawer-wrap {
                    position: fixed;
                    inset: 0;
                    z-index: 600;
                    pointer-events: none;
                }
                .drawer-wrap.open {
                    pointer-events: auto;
                }

                /* ── Backdrop ────────────────────────── */
                .backdrop {
                    position: absolute;
                    inset: 0;
                    background: rgba(0,0,0,0);
                    transition: background 0.28s ease;
                }
                .drawer-wrap.open .backdrop {
                    background: rgba(0,0,0,0.28);
                }

                /* ── Drawer panel ────────────────────── */
                .drawer {
                    position: absolute;
                    right: 0;
                    top: 0;
                    bottom: 0;
                    width: 360px;
                    max-width: 100vw;
                    display: flex;
                    flex-direction: column;
                    background: var(--xdh-color-surface-1);
                    border-left: 1px solid var(--xdh-color-border);
                    box-shadow: none;
                    transform: translateX(100%);
                    transition: transform 0.28s cubic-bezier(0.4, 0, 0.2, 1);
                }
                .drawer-wrap.open .drawer {
                    transform: translateX(0);
                    box-shadow: -6px 0 28px rgba(0,0,0,0.55);
                }

                /* ── Header ─────────────────────────── */
                .header {
                    flex-shrink: 0;
                    height: 44px;
                    padding: 0 var(--xdh-space-sm) 0 var(--xdh-space-md);
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    border-bottom: 1px solid var(--xdh-color-border);
                    background: var(--xdh-window-header-bg);
                }
                .title-wrap {
                    display: flex;
                    align-items: center;
                    gap: var(--xdh-space-sm);
                    color: var(--xdh-color-text-primary);
                    font: var(--xdh-font-title-sm);
                    min-width: 0;
                }
                .title-text {
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                }
                .lb-close {
                    flex-shrink: 0;
                    width: 28px;
                    height: 28px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    background: transparent;
                    border: none;
                    border-radius: var(--xdh-radius-xs);
                    color: var(--xdh-color-text-secondary);
                    cursor: pointer;
                }
                .lb-close:hover {
                    background: color-mix(in srgb, var(--xdh-clr-ink) 8%, transparent);
                    color: var(--xdh-color-text-primary);
                }

                /* ── Preview area ────────────────────── */
                .preview-area {
                    flex-shrink: 0;
                    height: 200px;
                    background: var(--xdh-clr-canvas);
                    border-bottom: 1px solid var(--xdh-color-border);
                    position: relative;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    overflow: hidden;
                }
                .preview-empty {
                    color: var(--xdh-color-text-secondary);
                    opacity: 0.2;
                    position: relative;
                    z-index: 1;
                }
                .preview-blur {
                    position: absolute;
                    inset: -10px;
                    width: calc(100% + 20px);
                    height: calc(100% + 20px);
                    object-fit: cover;
                    filter: blur(16px) brightness(0.45);
                    z-index: 2;
                }
                .preview-img {
                    position: absolute;
                    inset: 0;
                    width: 100%;
                    height: 100%;
                    object-fit: contain;
                    z-index: 3;
                }
                .preview-still {
                    position: absolute;
                    inset: 0;
                    width: 100%;
                    height: 100%;
                    object-fit: contain;
                    z-index: 3;
                }
                .preview-area.has-cover {
                    cursor: zoom-in;
                }
                .preview-loading {
                    position: absolute;
                    inset: 0;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    z-index: 5;
                    pointer-events: none;
                }
                .preview-loading-pill {
                    display: flex;
                    align-items: center;
                    gap: 10px;
                    padding: 9px 16px;
                    border-radius: 999px;
                    background: color-mix(
                        in srgb,
                        var(--xdh-color-surface-1) 88%,
                        var(--xdh-color-text-primary) 12%
                    );
                    border: 1px solid var(--xdh-color-border);
                    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.22);
                }
                .preview-spinner {
                    width: 16px;
                    height: 16px;
                    border-radius: 50%;
                    border: 2px solid var(--xdh-color-border);
                    border-top-color: var(--xdh-color-text-primary);
                    animation: lora-cover-spin 900ms linear infinite;
                }
                .preview-loading-text {
                    font-size: 12px;
                    color: var(--xdh-color-text-primary);
                    white-space: nowrap;
                }
                @keyframes lora-cover-spin {
                    to {
                        transform: rotate(360deg);
                    }
                }
                .preview-play {
                    position: absolute;
                    inset: 0;
                    margin: auto;
                    width: 44px;
                    height: 44px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    border-radius: 50%;
                    background: rgba(0,0,0,0.55);
                    color: #fff;
                    z-index: 4;
                    pointer-events: none;
                }
                .preview-actions {
                    position: absolute;
                    right: var(--xdh-space-sm);
                    top: var(--xdh-space-sm);
                    display: flex;
                    gap: var(--xdh-space-xs);
                    z-index: 6;
                }
                .cover-btn {
                    width: 28px;
                    height: 28px;
                    padding: 0;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    border-radius: var(--xdh-radius-xs);
                    border: 1px solid var(--xdh-clr-hairline);
                    background: var(--xdh-clr-surface-strong);
                    color: var(--xdh-clr-ink);
                    cursor: pointer;
                }
                .cover-btn:hover {
                    background: var(--xdh-clr-surface-soft);
                }
                .cover-btn.is-danger:hover {
                    color: var(--xdh-clr-error);
                }
                .preview-caption {
                    position: absolute;
                    left: 0;
                    right: 0;
                    bottom: 0;
                    z-index: 5;
                    display: flex;
                    align-items: center;
                    gap: var(--xdh-space-xs);
                    padding: var(--xdh-space-xs) var(--xdh-space-sm);
                    background: linear-gradient(
                        to top,
                        rgba(0,0,0,0.62),
                        rgba(0,0,0,0)
                    );
                    color: #fff;
                    font-size: 11px;
                    pointer-events: none;
                }
                .cover-name {
                    min-width: 0;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                }
                .cover-file-input {
                    /* 不用 display:none：部分 Safari 版本对不可渲染的
                       file input 不响应程序化 click */
                    position: absolute;
                    width: 1px;
                    height: 1px;
                    opacity: 0;
                    pointer-events: none;
                }

                /* ── 封面确认框 ─────────────────────── */
                .confirm-overlay {
                    position: absolute;
                    inset: 0;
                    z-index: 20;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    padding: var(--xdh-space-md);
                    background: rgba(0,0,0,0.45);
                }
                .confirm-box {
                    width: 100%;
                    max-width: 280px;
                    display: flex;
                    flex-direction: column;
                    gap: var(--xdh-space-sm);
                    padding: var(--xdh-space-md);
                    background: var(--xdh-color-surface-1);
                    border: 1px solid var(--xdh-color-border);
                    border-radius: var(--xdh-radius-sm);
                }
                .confirm-title {
                    display: flex;
                    align-items: center;
                    gap: var(--xdh-space-xs);
                    color: var(--xdh-color-text-primary);
                    font: var(--xdh-font-title-sm);
                }
                .confirm-body {
                    color: var(--xdh-color-text-secondary);
                    font-size: 12px;
                }
                .confirm-list {
                    margin: 0;
                    padding-left: 18px;
                    max-height: 120px;
                    overflow-y: auto;
                    color: var(--xdh-color-text-primary);
                    font-size: 12px;
                    word-break: break-all;
                }
                .confirm-actions {
                    display: flex;
                    justify-content: flex-end;
                    gap: var(--xdh-space-sm);
                }
                .confirm-btn {
                    padding: var(--xdh-space-sm) var(--xdh-space-md);
                    border-radius: var(--xdh-radius-sm);
                    border: 1px solid var(--border-standard);
                    background: transparent;
                    color: var(--xdh-color-text-secondary);
                    font: var(--xdh-font-button-sm);
                    font-family: inherit;
                    cursor: pointer;
                }
                .confirm-btn:hover {
                    border-color: var(--border-hover);
                    color: var(--xdh-color-text-primary);
                }
                .confirm-btn.is-danger {
                    border: none;
                    background: var(--xdh-clr-error);
                    color: #fff;
                }
                .confirm-btn.is-danger:hover {
                    background: var(--xdh-clr-error-hover);
                    color: #fff;
                }
                .confirm-btn:disabled {
                    opacity: 0.5;
                    pointer-events: none;
                }

                ${SCROLLBAR_CSS}

                /* ── Form scroll ─────────────────────── */
                .form-scroll {
                    flex: 1;
                    overflow-y: auto;
                    padding: var(--xdh-space-md) var(--xdh-space-base);
                    display: flex;
                    flex-direction: column;
                    gap: var(--xdh-space-md);
                }

                /* ── Strength row ────────────────────── */
                .strength-row {
                    display: flex;
                    align-items: flex-end;
                    gap: var(--xdh-space-xs);
                }
                .strength-row .field-group { flex: 1; min-width: 0; }

                /* ── Field group ─────────────────────── */
                .field-group {
                    display: flex;
                    flex-direction: column;
                    gap: var(--xdh-space-xs);
                }
                label {
                    font: var(--xdh-font-micro-label);
                    color: var(--xdh-color-text-secondary);
                    text-transform: uppercase;
                    letter-spacing: 0.06em;
                }
                input[type="number"], textarea {
                    background: var(--xdh-input-bg);
                    border: 1px solid var(--border-standard);
                    border-radius: var(--xdh-radius-sm);
                    color: var(--xdh-color-text-primary);
                    font-family: inherit;
                    font-size: 13px;
                    padding: var(--xdh-space-sm) var(--xdh-space-md);
                    width: 100%;
                    box-sizing: border-box;
                    transition: border-color 0.12s;
                }
                input[type="number"]:focus, textarea:focus {
                    outline: none;
                    border-color: var(--xdh-clr-primary);
                }
                input[type="number"]:disabled {
                    opacity: 0.35;
                    cursor: not-allowed;
                }
                textarea { resize: vertical; }
                .note-ta { min-height: 68px; }
                .tw-ta   { min-height: 100px; }

                /* ── Link button ─────────────────────── */
                .link-btn {
                    flex-shrink: 0;
                    width: 32px;
                    height: 32px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    background: transparent;
                    border: 1px solid var(--border-standard);
                    border-radius: var(--xdh-radius-sm);
                    color: var(--xdh-color-text-secondary);
                    cursor: pointer;
                    margin-bottom: 1px;
                }
                .link-btn:hover {
                    border-color: var(--border-hover);
                    color: var(--xdh-color-text-primary);
                }
                .link-btn.linked {
                    color: var(--xdh-clr-primary);
                    border-color: var(--xdh-clr-primary);
                }

                /* ── Trigger words ───────────────────── */
                .tw-label-row {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    gap: var(--xdh-space-sm);
                    flex-wrap: nowrap;
                }
                .tw-label-row label {
                    flex-shrink: 0;
                    white-space: nowrap;
                }
                .import-meta-btn {
                    flex-shrink: 0;
                    display: inline-flex;
                    align-items: center;
                    gap: var(--xdh-space-xs);
                    padding: var(--xdh-space-xxs) var(--xdh-space-sm);
                    background: transparent;
                    border: 1px solid var(--border-standard);
                    border-radius: var(--xdh-radius-xs);
                    color: var(--xdh-color-text-secondary);
                    font-size: 10px;
                    letter-spacing: 0.03em;
                    cursor: pointer;
                    white-space: nowrap;
                    font-family: inherit;
                }
                .import-meta-btn:hover {
                    border-color: var(--border-hover);
                    color: var(--xdh-color-text-primary);
                }
                .import-meta-btn.loading {
                    opacity: 0.4;
                    pointer-events: none;
                }

                /* ── Footer bar ──────────────────────── */
                .footer-bar {
                    flex-shrink: 0;
                    height: 52px;
                    padding: 0 var(--xdh-space-md);
                    display: flex;
                    align-items: center;
                    justify-content: flex-end;
                    gap: var(--xdh-space-sm);
                    border-top: 1px solid var(--xdh-color-border);
                    background: var(--xdh-window-header-bg);
                }
                button {
                    display: inline-flex;
                    align-items: center;
                    gap: var(--xdh-space-xs);
                    padding: var(--xdh-space-sm) var(--xdh-space-md);
                    border-radius: var(--xdh-radius-sm);
                    font: var(--xdh-font-button-sm);
                    cursor: pointer;
                    font-family: inherit;
                }
                .cancel-btn {
                    background: transparent;
                    border: 1px solid var(--border-standard);
                    color: var(--xdh-color-text-secondary);
                }
                .cancel-btn:hover {
                    border-color: var(--border-hover);
                    color: var(--xdh-color-text-primary);
                }
                .save-btn {
                    background: var(--xdh-clr-primary);
                    border: none;
                    color: var(--xdh-clr-on-primary);
                }
                .save-btn:hover { filter: brightness(1.12); }
                .save-btn.loading { opacity: 0.55; pointer-events: none; }

                /* ── Loading state ───────────────────── */
                .loading-state {
                    flex: 1;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    gap: var(--xdh-space-md);
                    color: var(--xdh-color-text-secondary);
                    font-size: 13px;
                }
            </style>

            <div class="drawer-wrap">
                <div class="backdrop"></div>
                <div class="drawer">
                    <div class="header">
                        <div class="title-wrap">
                            ${icon("wand-sparkles", 14)}
                            <span class="title-text">${escapeHtml(title)}</span>
                        </div>
                        <button class="lb-close">${icon("x", 16)}</button>
                    </div>
                    ${drawerBody}
                    <input type="file" class="cover-file-input"
                        accept="${COVER_ACCEPT}"/>
                    ${this._renderConfirmDialog()}
                </div>
            </div>
        `;
    }
}
registerCustomElement("xdh-lora-detail", XdhLoraDetail);

