// 素材白名单（api-12 §四）：前端按这张表先做本地校验，
// 避免上传到一半才被 sign 接口以 400 拒绝。真正的判定仍在后端。

export const MEDIA_KINDS = [
    {
        mediaType: "image",
        label: "图片",
        mimes: ["image/webp", "image/png", "image/jpeg"],
        exts: ["webp", "png", "jpg", "jpeg"],
        maxBytes: 5 * 1024 * 1024,
    },
    {
        mediaType: "audio",
        label: "音频",
        mimes: ["audio/mpeg", "audio/mp4", "audio/ogg", "audio/wav"],
        exts: ["mp3", "m4a", "ogg", "wav"],
        maxBytes: 20 * 1024 * 1024,
    },
    {
        mediaType: "video",
        label: "视频",
        mimes: ["video/mp4", "video/webm"],
        exts: ["mp4", "webm"],
        maxBytes: 100 * 1024 * 1024,
    },
    {
        mediaType: "pdf",
        label: "PDF",
        mimes: ["application/pdf"],
        exts: ["pdf"],
        maxBytes: 20 * 1024 * 1024,
    },
    {
        mediaType: "file",
        label: "压缩包",
        mimes: ["application/zip", "application/x-zip-compressed"],
        exts: ["zip"],
        maxBytes: 20 * 1024 * 1024,
    },
];

// 附件类型与素材类型一致（link 是外链，不占素材）
export const ATTACHMENT_TYPES = [
    { value: "image", label: "图片" },
    { value: "video", label: "视频" },
    { value: "audio", label: "音频" },
    { value: "pdf", label: "PDF" },
    { value: "file", label: "文件" },
    { value: "link", label: "外链" },
];

export function extOf(filename) {
    const name = String(filename ?? "");
    const index = name.lastIndexOf(".");
    return index >= 0 ? name.slice(index + 1).toLowerCase() : "";
}

export function kindOfExt(ext) {
    return MEDIA_KINDS.find((kind) => kind.exts.includes(ext)) ?? null;
}

// 按扩展名推断 kind 与 mime；不在白名单或超出大小上限时返回 { ok:false, message }。
export function validateMediaFile(file) {
    if (!file) return { ok: false, message: "请选择文件" };

    const kind = kindOfExt(extOf(file.name));
    if (!kind) {
        return {
            ok: false,
            message: `不支持的文件类型（仅支持 ${MEDIA_KINDS.flatMap((k) => k.exts).join(" / ")}）`,
        };
    }
    if (file.size > kind.maxBytes) {
        const mb = Math.round(kind.maxBytes / 1024 / 1024);
        return { ok: false, message: `${kind.label}不能超过 ${mb} MB` };
    }

    // 浏览器给的 MIME 可能与扩展名不一致（例如 .jpg 被识别成 image/pjpeg），
    // 以扩展名决定 kind，MIME 用白名单里与扩展名对应的那个值。
    const ext = extOf(file.name);
    const index = kind.exts.indexOf(ext);
    const mime = kind.mimes[index] || kind.mimes[0];
    return { ok: true, kind: kind.mediaType, mime, sizeBytes: file.size };
}
