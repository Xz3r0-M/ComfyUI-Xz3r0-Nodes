import { app } from "../../scripts/app.js";

var NODE_CLASS = "XPipeRecursive";
var INITIAL_WIDTH_EXTRA = 20;

function isXPipeRecursive(node) {
    return !!(
        node
        && String(node.comfyClass || node.type || "") === NODE_CLASS
    );
}

function resolveInitialNodeSize(node) {
    if (!node) return null;
    var current = Array.isArray(node.size) ? node.size : [0, 0];
    var computed = typeof node.computeSize === "function"
        ? node.computeSize()
        : [0, 0];
    var computedWidth = Number(computed && computed[0]) || 0;
    var computedHeight = Number(computed && computed[1]) || 0;
    var width = computedWidth || Number(current[0]) || 0;
    var height = computedHeight || Number(current[1]) || 0;
    return [
        Math.max(1, Math.ceil(width + INITIAL_WIDTH_EXTRA)),
        Math.max(1, Math.ceil(height)),
    ];
}

function applyInitialNodeSize(node) {
    if (!node || node.__xpipeRecursiveInitialSizeApplied) return;
    var size = resolveInitialNodeSize(node);
    if (!size) return;
    node.min_size = size.slice();
    if (typeof node.setSize === "function") node.setSize(size.slice());
    else node.size = size.slice();
    node.__xpipeRecursiveInitialSizeApplied = true;
    node.setDirtyCanvas && node.setDirtyCanvas(true, true);
}

app.registerExtension({
    name: "ComfyUI.Xz3r0.XPipeRecursive",

    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (String(nodeData.name) !== NODE_CLASS) return;

        var originalCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            originalCreated && originalCreated.apply(this, arguments);
            applyInitialNodeSize(this);
        };

        var originalConfigure = nodeType.prototype.onConfigure;
        nodeType.prototype.onConfigure = function () {
            originalConfigure && originalConfigure.apply(this, arguments);
            applyInitialNodeSize(this);
        };
    },

    async loadedGraphNode(node) {
        if (!isXPipeRecursive(node)) return;
        applyInitialNodeSize(node);
    },

    nodeCreated(node) {
        if (!isXPipeRecursive(node)) return;
        applyInitialNodeSize(node);
    },
});
