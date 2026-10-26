// 出题相关接口（api-12 + api-9 的题目主数据）：题目主数据、可塑区组件、素材、页面与目录。
//
// 路径分两类：
//   * 题目主数据 /admin/puzzles*（GET staff，PUT admin）
//   * 出题台其余接口 /admin/pz/*
//       - 组件：`pz.widget.publish`
//       - 素材 / 页面 / 目录：`pz.content.edit`
// admin 直通；权限判定在后端，前端用 auth.can(code) 决定是否显示入口。
//
// 五元素页面（page）里不存标题：标题属于题目主数据，走下面的 PUT /admin/puzzles/:key。
import { del, get, post, put } from "./http";

const key = (value) => encodeURIComponent(String(value ?? ""));

// ---------- 题目主数据（标题 / 排序 / 奖励 / 答案 / 启用） ----------

// 题库列表：items 字段为 key / title / ord / archiveId / tipsReward / enabled。
// staff 可读；写（PUT）仅 admin。
export const listPuzzles = () => get("/admin/puzzles");

// 按需提交字段：更新时未传字段保持原值，新增时使用默认值。
// 可提交 title / ord / archive_id / tips_reward / enabled / answer。
export const putPuzzle = (puzzleKey, body) =>
    put(`/admin/puzzles/${key(puzzleKey)}`, body);


// ---------- 可塑区组件 ----------

// 第一步：拿 Vue 源码上传地址。
// 响应 { upload: { objectKey, url, method, headers, expiresAt }, limits: { maxBytes } }
// upload.url 含临时授权：不要打日志、不要持久化。
export const signWidgetSource = ({ name, filename, sizeBytes }) =>
    post("/admin/pz/widgets/source/sign", { name, filename, sizeBytes });

// 第二步：把直传好的源码编译成组件 ESM 并登记。
// 版本号由服务端分配并自动递增（1.0.0 → 1.0.1），前端不再传 version。
// 响应 { widget: {...}, replaced: { esmVersions, referencesUpdated } }
export const compileWidget = ({ name, objectKey, note }) =>
    post("/admin/pz/widgets/compile", { name, objectKey, note });

// 组件清单：每个 name 只返回最新 ESM 与仍留档的源码（sources，最多 3 版）。
// status 1 = 可用，2 = 停用（玩家侧下发 404）。
export const listWidgets = () => get("/admin/pz/widgets");

// 读取仍留档的某个版本的 Vue 源码；404 = 该版本没留档或已被清理。
// 响应 { source: { name, version, source, sizeBytes, sourceHash, createdAt } }
export const getWidgetSource = (name, version) =>
    get(`/admin/pz/widgets/${key(name)}/source/${key(version)}`);

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

// ---------- 预置提示（api-10 §10.12） ----------

// 读某题提示草稿（含正文）：{ rev, hints: [{ id, ord, name, content, cost, createdAt, updatedAt }] }
export const getPuzzleHints = async (puzzleKey) => {
    const data = await get(`/admin/pz/puzzle/${key(puzzleKey)}/hints`);
    return data ?? { rev: 0, hints: [] };
};

// 整表保存：按数组顺序重排 ord，不带 id = 新增，未出现的已有 id = 删除（不退款）。
// 每次保存成功 puzzle.page_rev 严格 +1。
export const putPuzzleHints = (puzzleKey, hints) =>
    put(`/admin/pz/puzzle/${key(puzzleKey)}/hints`, { hints });

// ---------- 目录 ----------

// 目录列表：[{ key, title, ord, enabled, unlock, createdAt, updatedAt }]
export const listFolders = () => get("/admin/pz/folders");

// 新建或更新目录（幂等 upsert）；key 一旦建立不要改，赛事内视为标识。
export const upsertFolder = ({ key: folderKey, title, ord, enabled, unlock }) =>
    post("/admin/pz/folders", { key: folderKey, title, ord, enabled, unlock });

// 删除目录；目录下仍有题目时后端返回 409（不会自动把题目置为未分组）。
export const deleteFolder = (folderKey) =>
    del(`/admin/pz/folders/${key(folderKey)}`);
