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

// ---------- 题目主数据（标题 / 排序 / 奖励 / 答案 / 启用 / 出题人） ----------

// 题库列表：items 字段为 key / title / ord / archiveId / tipsReward / enabled / folderKey，
// 另有 authorId / authorUsername。mistarg.2.4.1 起响应另带 folders[]（目录扁平列表，
// 按 ord,key 升序，含空目录与停用目录），出题台据此分组。
// 2026-11-05 起严格隔离：admin 返回全部；持 pz.content.edit 的 staff 只返回自己的题；
// 无该权限的 staff 返回空列表。
// answer 只对 admin 或「持有 pz.content.edit 且是该题作者」返回，无权限时字段不存在（不是 null）。
export const listPuzzles = () => get("/admin/puzzles");

// 按需提交字段：更新时未传字段保持原值，新增时使用默认值。
// 可提交 title / ord / archive_id / tips_reward / enabled / answer / author_id。
// author_id 仅 admin 可传（staff 传 → 403）；新建时 author_id = 当前账号。
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
export const listWidgets = (options) => get("/admin/pz/widgets", undefined, options);

// 读取仍留档的某个版本的 Vue 源码；404 = 该版本没留档或已被清理。
// 响应 { source: { name, version, source, sizeBytes, sourceHash, createdAt } }
export const getWidgetSource = (name, version) =>
    get(`/admin/pz/widgets/${key(name)}/source/${key(version)}`);

// ---------- 素材（两步直传；mistarg.2.3.0 起素材与题目分离） ----------
//
// 素材归出题人所有，分「私有 private / 公共 public」两区：
//   · 私有：本人 + admin 可上传 / 修改 / 在题内引用（要求该题作者 = 素材所有人）；
//   · 公共：所有出题人可引用，只有 admin 能上传或修改。
// 归属不再由题目决定（sign / confirm 已移除 puzzleKey）。

// 第一步：拿直传地址。返回 upload：{ objectKey, url, method, headers, expiresAt }
// url 含临时授权：不要打日志、不要持久化、不要进缓存。
// scope 默认 private；public 仅 admin 可直传公共区。
// ownerId 仅 admin 可用（代传到指定出题人名下，scope=public 时禁止）。
export const signMedia = ({ filename, mime, sizeBytes, scope, ownerId }) =>
    post("/admin/pz/media/sign", {
        filename,
        mime,
        sizeBytes,
        ...(scope ? { scope } : {}),
        ...(ownerId ? { ownerId } : {}),
    });

// 第二步：直传完成后确认并登记。幂等 —— 重复确认同一 objectKey 返回已有素材。
// 归属由服务端从 objectKey 解析，前端不要自拼。
// 返回 media：{ id, url, mime, sizeBytes, filename, mediaType, status,
//               scope, ownerId, ownerUsername, allowShare, withdrawRequestedAt, note }
// url 是管理端预览路径 /api/admin/pz/media/<id>，要带 Bearer 取 blob。
export const confirmMedia = ({
    objectKey,
    filename,
    mime,
    sizeBytes,
    durationSec,
    note,
}) =>
    post("/admin/pz/media/confirm", {
        objectKey,
        filename,
        mime,
        sizeBytes,
        durationSec,
        note,
    });

// 素材（api-12 §四，mistarg.2.3.0 起素材与题目分离）
//
// 归属：私有 private 归出题人（本人 + admin 可改），公共 public 所有出题人可引用、
// 只有 admin 能改；进公共区要作者先允许他人使用（allowShare），出公共区要 admin 同意（撤回）。
//
// 查询维度（mistarg.2.4.0 起 view=mine 已移除）：
//   view=owner（默认）我的素材，admin 可用 ownerId 指定他人
//   view=usable 所有可用；view=public 公共；view=all 全量（admin）
//   view=puzzle 某题可用（必填 puzzleKey；行带 usedInPage / marked）
//   view=used 某题已使用（必填 puzzleKey）→ data = { media, invalidRefs }
export const listMedia = (params = {}, options) =>
    get("/admin/pz/media", params, options);

// 修改素材：filename / note / status / allowShare；
// admin 另可用 scope 收录（private→public，要求 allowShare=true）或下架（public→private）、
// 用 ownerId 改私有素材归属。
export const updateMedia = (id, body) => put(`/admin/pz/media/${id}`, body);

// admin-only：素材使用反查（素材 → 引用题 + 位置 + 仅标记题）
// 响应 { asset, summary, items: [{ puzzleKey, title, relation, needsAttention, refs, marked }], limit, total }
export const getMediaUsage = (id, params) =>
    get(`/admin/pz/media/${id}/usage`, params);

// 撤回流程（仅公共素材）：作者申请 / 撤销；admin 用同一个 DELETE 驳回申请。
export const requestMediaWithdraw = (id) =>
    post(`/admin/pz/media/${id}/withdraw`);

export const cancelMediaWithdraw = (id) =>
    del(`/admin/pz/media/${id}/withdraw`);

// admin 同意撤回：素材回到原作者私有，并清掉 allowShare 与申请。
export const approveMediaWithdraw = (id) =>
    post(`/admin/pz/media/${id}/withdraw/approve`);

// 本题素材标记（mistarg.2.4.0，幂等）：把素材归入「本题已使用」列表，
// 不要求页面已引用；素材须当前可被本题引用，否则 400 MEDIA_REF_INVALID。
export const markPuzzleMedia = (puzzleKey, assetId) =>
    put(`/admin/pz/puzzle/${key(puzzleKey)}/media/${Number(assetId)}`);

// 取消本题标记（幂等）：不要求素材当前可用，便于清理失效标记。
export const unmarkPuzzleMedia = (puzzleKey, assetId) =>
    del(`/admin/pz/puzzle/${key(puzzleKey)}/media/${Number(assetId)}`);

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
// options 目前只有 signal：切题时由 requestLatest 中断上一次请求
export const getPuzzleHints = async (puzzleKey, options) => {
    const data = await get(`/admin/pz/puzzle/${key(puzzleKey)}/hints`, undefined, options);
    return data ?? { rev: 0, hints: [] };
};

// 整表保存：按数组顺序重排 ord，不带 id = 新增，未出现的已有 id = 删除（不退款）。
// 每次保存成功 puzzle.page_rev 严格 +1。
export const putPuzzleHints = (puzzleKey, hints) =>
    put(`/admin/pz/puzzle/${key(puzzleKey)}/hints`, { hints });

// ---------- 题目预览（管理端下发） ----------

// 作者/admin 的全量草稿预览：跳过进度解锁、停用题也能预览、solved 恒为 false、
// 提示全部 unlocked 且带正文。字段与嵌套和玩家 view 完全一致，只有资源 URL 换成管理端路径：
//   /api/puzzle/media/<id>        → /api/admin/pz/media/<id>
//   /api/puzzle/asset/<n>/<v>     → /api/admin/pz/puzzle/<key>/asset/<n>/<v>
// 这些 URL 需要鉴权，必须经 fetchResource/resolveServerUrl 取 blob，不能直接塞给 <img>。
export const getPuzzlePreview = async (puzzleKey) => {
    const data = await get(`/admin/pz/puzzle/${key(puzzleKey)}/preview`);
    return data?.puzzle ?? null;
};

// ---------- 目录 ----------

// 目录列表：[{ key, title, ord, enabled, unlock, ownerId, ownerUsername, createdAt, updatedAt }]
// 2026-11-05 起按目录所有人隔离：admin 返回全部；staff 只返回 owner_id = 自己的目录。
export const listFolders = (options) => get("/admin/pz/folders", undefined, options);

// 新建或更新目录（幂等 upsert）；key 一旦建立不要改，赛事内视为标识。
// owner_id 仅 admin 可传（staff 传 → 403）；新建时 owner_id = 当前账号。
export const upsertFolder = ({ key: folderKey, title, ord, enabled, unlock, ownerId }) =>
    post("/admin/pz/folders", {
        key: folderKey,
        title,
        ord,
        enabled,
        unlock,
        ...(ownerId === undefined ? {} : { owner_id: ownerId }),
    });

// 删除目录；目录下仍有题目时后端返回 409（不会自动把题目置为未分组）。
export const deleteFolder = (folderKey) =>
    del(`/admin/pz/folders/${key(folderKey)}`);

// ---------- iframe 来源 allowlist（admin-only，2026-11-18 起） ----------

// 列表（含已停用 status=2 的行）。保存 iframe 页面时后端要求 url 的 origin 在这份**启用**列表里，
// 不在 → 400 且 detail.fields 指向 malleable.url。
// 响应形状文档未定；视图层对 { origins } / { items } / 数组三种都做了兼容。
export const listIframeOrigins = (options) =>
    get("/admin/pz/iframe-origins", undefined, options);

// 新建或恢复（幂等 upsert）：origin 只接受 https://host[:port]，全库唯一。
// status 省略时由后端决定；传 1 可把软删的行恢复启用。
export const upsertIframeOrigin = ({ origin, note, status }) =>
    post("/admin/pz/iframe-origins", {
        origin,
        ...(note === undefined ? {} : { note }),
        ...(status === undefined ? {} : { status }),
    });

// **软删**：只把 status 置 2，不物理删除，POST 同 origin 可恢复。
export const deleteIframeOrigin = (id) =>
    del(`/admin/pz/iframe-origins/${key(id)}`);
