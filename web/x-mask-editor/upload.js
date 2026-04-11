import {
    nextClipspaceName,
    sanitizeFileBase,
} from "./utils.js";

function buildAnnotatedRef(payload) {
    const name = String(payload?.name || "").trim();
    const type = String(payload?.type || "input").trim() || "input";
    const subfolder = String(payload?.subfolder || "").trim();
    const path = subfolder ? `${subfolder}/${name}` : name;
    return `${path} [${type}]`;
}

async function uploadImageBlob(blob, filename) {
    const file = new File([blob], filename, {
        type: blob?.type || "image/png",
    });
    const formData = new FormData();
    formData.append("image", file);
    formData.append("type", "input");
    formData.append("subfolder", "clipspace");
    const response = await fetch("/upload/image", {
        method: "POST",
        body: formData,
    });
    if (!response.ok) {
        throw new Error("Upload image failed");
    }
    const payload = await response.json();
    return {
        ...payload,
        ref: buildAnnotatedRef(payload),
    };
}

export async function saveMaskArtifacts({
    maskBlob,
    paintBlob,
    title = "",
}) {
    const base = sanitizeFileBase(title, "ximageget-mask");
    const maskArtifact = await uploadImageBlob(
        maskBlob,
        nextClipspaceName(`${base}-mask`)
    );

    let paintRef = "";
    if (paintBlob) {
        const paintLayer = await uploadImageBlob(
            paintBlob,
            nextClipspaceName(`${base}-paint`)
        );
        paintRef = paintLayer.ref;
    }

    return {
        maskRef: maskArtifact.ref,
        paintRef,
    };
}
