/**
 * canvas-selection.js
 * ===================
 *
 * 把「只选中这一个节点」这件事统一到一处。
 *
 * 为什么需要它：官方前端把老写法 `canvas.selected_nodes = {...}`、
 * `canvas.selectNode(...)`、`canvas.deselectAllNodes()` 都标成了弃用，
 * 换成 `canvas.selectItems([node])` / `canvas.deselectAll()`。
 * 但很老的前端只有老写法，所以这里按「新 → 老」顺序逐级退让，
 * 保证新前端不打弃用提醒、老前端也不会突然失灵。
 */

/**
 * 让画布上只选中指定节点。
 *
 * @param {object} canvas ComfyUI 画布（app.canvas）
 * @param {object} node   要选中的节点
 */
export function selectOnlyNode(canvas, node) {
    if (!canvas || !node) {
        return;
    }

    // 1) 先清空原来的选中
    if (typeof canvas.deselectAll === "function") {
        try {
            canvas.deselectAll();
        } catch {
            // ignore
        }
    } else if (typeof canvas.deselectAllNodes === "function") {
        try {
            canvas.deselectAllNodes();
        } catch {
            // ignore
        }
    }

    // 2) 再选中目标节点（新 API 优先）
    if (typeof canvas.selectItems === "function") {
        try {
            canvas.selectItems([node]);
        } catch {
            // ignore
        }
    } else if (typeof canvas.selectNode === "function") {
        try {
            canvas.selectNode(node, false);
        } catch {
            // ignore
        }
    } else {
        // 最老的前端：直接写弃用字段（新版前端不会走到这里）
        canvas.selected_nodes = { [node.id]: node };
    }

    // 3) 「当前节点」指针（普通字段，非弃用 API）
    try {
        canvas.current_node = node;
        canvas.node_selected = node;
    } catch {
        // ignore
    }
}
