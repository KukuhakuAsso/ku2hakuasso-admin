// 出题相关接口（api-12）：可塑区组件、素材、页面与目录。
//
// 全部走 /api/admin/pz/*：
//   * 组件：`pz.widget.publish`
//   * 素材 / 页面 / 目录：`pz.content.edit`
// admin 直通；权限判定在后端，前端用 auth.can(code) 决定是否显示入口。
//
// 题目主数据（标题 / 排序 / 奖励 / 答案 / 启用）仍在 api/puzzles.js 的
// `PUT /admin/puzzles/:key`，这里只管五元素页面（page 里不存标题）。
import { del, get, post, put } from "./http";

const key = (value) => encodeURIComponent(String(value ?? ""));

// ---------- 可塑区组件 ----------

// 上传 Vue SFC 源码 → 服务端编译成单文件 ESM 并登记版本。
// 响应 widget：{ id, name, version, tag, integrity, bytes, url, createdAt }
// 同 name@version 已存在返回 409，升级必须发新版本。
export const compileWidget = ({ name, version, source, note }) =>
    post("/admin/pz/widgets/compile", { name, version, source, note });

// 已登记组件清单：status 1 = 可用，2 = 停用（玩家侧下发 404）。
export const listWidgets = () => get("/admin/pz/widgets");

// ---------- 素材（两步直传） ----------

// 第一步：拿直传地址。返回 upload：{ objectKey, url, method, headers, expiresAt }
// url 含临时授权：不要打日志、不要持久化、不要进缓存。
export const signMedia = ({ puzzleKey, filename, mime, sizeBytes }) =>
    post("/admin/pz/media/sign", {
        puzzleKey,
        filename,
        mime,
        sizeBytes,
    });

// 第二步：直传完成后确认并登记。幂等 —— 重复确认同一 objectKey 返回已有素材。
// 返回 media：{ id, url, mime, sizeBytes, filename, mediaType }
export const confirmMedia = ({
    puzzleKey,
    objectKey,
    filename,
    mime,
    sizeBytes,
    durationSec,
    note,
}) =>
    post("/admin/pz/media/confirm", {
        puzzleKey,
        objectKey,
        filename,
        mime,
        sizeBytes,
        durationSec,
        note,
    });

// 某题已登记的素材清单（页面里用 assetId 引用它们）。
export const listMedia = (puzzleKey) => get("/admin/pz/media", { puzzleKey });

// 直传本体：按 sign 返回的方式把文件 PUT 到对象存储（不经过后端）。
// 返回 { promise }，promise 在 2xx 时 resolve；onProgress 收到 0–100。
// 注意：成功后必须紧接着调 confirmMedia，否则素材不会登记。
export function uploadToSignedUrl(upload, file, onProgress) {
    const { url, method = "PUT", headers = {} } = upload ?? {};

    const promise = new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open(method, url, true);
        // 原样带上后端给的请求头（预签名按这些头计算签名，增删都会导致失败）
        Object.entries(headers).forEach(([name, value]) => {
            xhr.setRequestHeader(name, value);
        });

        xhr.upload.onprogress = (event) => {
            if (!onProgress || !event.lengthComputable) return;
            onProgress(Math.round((event.loaded / event.total) * 100));
        };
        xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
                resolve(xhr);
                return;
            }
            reject(new Error(`上传失败（${xhr.status}）`));
        };
        xhr.onerror = () => reject(new Error("上传中断，请重试"));
        xhr.onabort = () => reject(new Error("上传已取消"));

        xhr.send(file);
    });

    return { promise };
}

// ---------- 题目页面（五元素 + 目录归属 + 解锁规则） ----------

// 读草稿：素材以 assetId 原始引用返回，便于编辑。
// 响应 data.puzzle：{ key, title, enabled, rev, folderKey, unlock, page }，这里解包成 puzzle 本身。
export const getPuzzlePage = async (puzzleKey) => {
    const data = await get(`/admin/pz/puzzle/${key(puzzleKey)}/page`);
    return data?.puzzle ?? null;
};

// 保存页面。`page` 省略等价 `{}`（= 清空，只剩标题）；
// `unlock` 省略 = 不改现有规则。
// 响应：{ key, rev, folderKey, malleableKind, attachmentCount, unlock }，rev 每次 +1。
export const putPuzzlePage = (puzzleKey, body) =>
    put(`/admin/pz/puzzle/${key(puzzleKey)}/page`, body);

// ---------- 目录 ----------

// 目录列表：[{ key, title, ord, enabled, unlock, createdAt, updatedAt }]
export const listFolders = () => get("/admin/pz/folders");

// 新建或更新目录（幂等 upsert）；key 一旦建立不要改，赛事内视为标识。
export const upsertFolder = ({ key: folderKey, title, ord, enabled, unlock }) =>
    post("/admin/pz/folders", { key: folderKey, title, ord, enabled, unlock });

// 删除目录；目录下仍有题目时后端返回 409（不会自动把题目置为未分组）。
export const deleteFolder = (folderKey) =>
    del(`/admin/pz/folders/${key(folderKey)}`);
