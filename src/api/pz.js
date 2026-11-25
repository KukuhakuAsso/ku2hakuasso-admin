/**
 * @file 出题台接口：题目主数据、可塑区组件、素材、五元素页面、预置提示、目录、外链来源白名单
 * （api-12-puzzle.md §三–§五、api-9-admin.md 题目主数据）。
 *
 * 经 `http.request` 调用，返回值已剥掉统一信封，直接是 `data`；失败抛
 * {@link ApiError}（后端 `error` 对象在 `error.detail` 上）。例外：`uploadToSignedUrl()`
 * 是浏览器 → 对象存储的直传，走 XHR，不经过本项目的请求层。
 */

import { del, get, post, put } from "./http";

const key = (value) => encodeURIComponent(String(value ?? ""));

/**
 * 预签名直传票据（`upload` 字段，组件源码与素材共用同一形状）。
 * @typedef {Object} UploadTicket
 * @property {string} objectKey 不透明对象键：**原样**回传给 confirm，不要解析或自拼
 * @property {string} url 预签名上传地址（含临时授权，不要记日志 / 持久化 / 进缓存）
 * @property {string} [method="PUT"] 上传用的 HTTP 方法
 * @property {Object<string, string>} [headers] 上传时必须**原样**带上的请求头（签名按它计算）
 * @property {string} expiresAt 票据过期时间（素材 10 分钟，过期后重新 sign）
 */

/**
 * 可塑区组件（清单项与发布响应同形）。
 * @typedef {Object} WidgetMeta
 * @property {string} name 组件名（`^[a-z][a-z0-9-]{2,31}$`）
 * @property {string} version 当前版本号（服务端分配并递增，前端不要自造）
 * @property {string} tag custom element 标签名，前端用它挂载
 * @property {string} integrity `sha384-…`，取包后**必须**校验
 * @property {1|2} [status] `1` 可用 / `2` 停用（停用后玩家侧下发 404）；发布响应无此字段
 * @property {string} url 组件 ESM 地址
 * @property {{ version: string, current?: boolean, url: string }[]} [sources] 仍留档的源码版本
 *   （最多 3 版）；`current=true` 为当前 ESM 对应的源码
 */

/**
 * 组件源码（`getWidgetSource()` 的 `data.source`）。
 * @typedef {Object} WidgetSource
 * @property {string} name 组件名
 * @property {string} version 版本号
 * @property {string} source `.vue` 源码全文
 * @property {number} sizeBytes 源码字节数（上限 128KB）
 * @property {string} [sourceHash] 源码哈希
 * @property {string} createdAt 留档时间
 */

/**
 * 素材行（`confirm` 响应、列表项、修改响应同形）。
 * @typedef {Object} MediaRow
 * @property {number} id 素材 id
 * @property {string} url 管理端预览路径 `/api/admin/pz/media/<id>`；取字节需带令牌转 blob
 * @property {string} filename 展示 / 下载名
 * @property {"image"|"audio"|"video"|"pdf"|"file"} mediaType 素材类型
 * @property {string} mime MIME
 * @property {number} sizeBytes 文件字节数
 * @property {number|null} durationSec 音视频时长（秒）；其他类型为 `null`
 * @property {1|2} status `1` 启用 / `2` 停用（停用后所有视图与下发不可用，页面元素降级）
 * @property {"private"|"public"} scope 私有 / 公共区
 * @property {number|null} ownerId 所有人账号 id；`null` = admin 直传的公共素材（或历史无主素材）
 * @property {string|null} ownerUsername 所有人用户名
 * @property {boolean} allowShare 作者是否允许他人使用（收录前提；下架回私有后为 `false`）
 * @property {string|null} withdrawRequestedAt 撤回申请时间；非 `null` = 审核中
 * @property {string} createdAt 创建时间
 */

/**
 * 页面引用位置（描述一张素材被放在题目的哪里）。
 * @typedef {Object} PageRef
 * @property {"cover"|"progressCover"|"attachments"|"description"} where 位置
 * @property {number} [index] `attachments` 的 0-based 下标
 * @property {number} [occurrence] `description` 内联图的 1-based 序号
 * @property {string} [alt] `description` 内联图的 alt，配合 `occurrence` 定位
 */

/**
 * 非法素材引用（保存 400 与 `view=used` / `usage` 查询共用同一结构）。
 * @typedef {Object} InvalidRef
 * @property {number} assetId 素材 id
 * @property {string} [path] 出错字段路径：`cover.assetId` / `cover.progressAssetId` /
 *   `attachments[<i>].assetId` / `description`（仅保存 400 侧提供）
 * @property {"not_found"|"disabled"|"not_referenceable"} reason `not_found` id 不存在 /
 *   `disabled` 已停用 / `not_referenceable` 他人私有或公共素材已被撤销
 * @property {"cover"|"progressCover"|"attachments"|"description"} [where] 位置（查询侧恒有）
 * @property {number} [index] 附件下标
 * @property {number} [occurrence] 描述内联图序号
 * @property {string} [alt] 描述内联图 alt
 * @property {string} [filename] 素材展示名（查询侧附带）
 * @property {"private"|"public"} [scope] 素材分区（查询侧附带）
 * @property {number|null} [ownerId] 素材所有人（查询侧附带）
 */

/**
 * 「本题已使用」行 = 素材行 + 以下来源 / 失效标记。
 * @typedef {Object} MediaUsedItem
 * @property {number} id 素材 id
 * @property {string} url 管理端预览路径
 * @property {string} filename 展示名
 * @property {"private"|"public"} scope 分区
 * @property {number|null} ownerId 所有人
 * @property {1|2} status 启停
 * @property {("page"|"mark")[]} sources `page` = 页面直接引用；`mark` = 仅本题标记（不参与渲染）
 * @property {PageRef[]} refs 页面位置；仅 `mark` 来源时为 `[]`
 * @property {boolean} invalid 素材当前是否已不可用（停用 / 公共被撤回 / 归属变更）
 * @property {string|null} invalidReason 不可用原因；`invalid=false` 时为 `null`
 * @property {string|null} [markedAt] 标记时间；仅 `mark` 来源有值
 * @property {boolean} [usedInPage] 仅 `view=puzzle`：已被本题页面引用
 * @property {boolean} [marked] 仅 `view=puzzle`：已加入本题使用列表
 */

/**
 * 素材使用反查的汇总计数（`getMediaUsage()` 的 `data.summary`）。
 * 口径与待审撤回列表的 `withdrawImpact` 一致。
 * @typedef {Object} MediaUsageSummary
 * @property {number} pageReferencedByCount 页面**直接引用**该素材的题数（含停用题）
 * @property {number} pageReferencedByOtherAuthors 其中作者不是素材所有人的题数
 * @property {number} markedByCount 仅标记（页面未直接引用）的题数
 * @property {{ self: number, admin: number, other: number }} relationCounts 按题目与素材的
 *   关系计数（`self` = 题目作者就是素材所有人、`admin` = 题目作者是 admin、`other` = 其余）
 * @property {number} enabledCount 明细中启用题数
 * @property {number} disabledCount 明细中停用题数
 */

/**
 * 素材使用反查的题目明细（`getMediaUsage()` 的 `data.items[]`）。
 * 含停用题与停用素材；`sources` 为并集，所以这里会同时出现「页面引用」与「仅标记」的题。
 * @typedef {Object} MediaUsageItem
 * @property {string} puzzleKey 题目 key
 * @property {string} title 题目标题
 * @property {number|null} authorId 题目作者账号 id
 * @property {string|null} authorUsername 题目作者用户名
 * @property {"player"|"captain"|"staff"|"admin"} authorRole 题目作者角色
 * @property {boolean} enabled 题目是否启用（停用题也会列出）
 * @property {number} pageRev 题目页面版本号
 * @property {"self"|"admin"|"other"} relation 题目作者与素材所有人的关系（优先级 `self > admin > other`）
 * @property {boolean} needsAttention `relation="other"`：撤回后需该作者清理页面引用
 * @property {("page"|"mark")[]} sources `page` = 页面直接引用；`mark` = 仅本题标记
 * @property {PageRef[]} refs 页面位置；仅 `mark` 来源时为 `[]`
 * @property {boolean} invalid 素材在该题是否已不可用
 * @property {string|null} invalidReason 不可用原因；`invalid=false` 时为 `null`
 * @property {string|null} markedAt 标记时间；无标记来源时为 `null`
 */

/**
 * 素材使用反查结果（`getMediaUsage()` 的 `data`）。
 * @typedef {Object} MediaUsage
 * @property {MediaRow} asset 被反查的素材行（含停用素材）
 * @property {MediaUsageSummary} summary 汇总计数
 * @property {MediaUsageItem[]} items 题目明细（页面引用题按 `enabled DESC, ord, key` 排序，
 *   仅标记题随后追加）
 * @property {number} limit 本次返回的明细条数上限
 * @property {number} total 明细总数（可能大于 `limit`）
 */

/**
 * 预览里的封面（玩家 view 同形，URL 指向管理端下发路径）。
 * @typedef {Object} PreviewCover
 * @property {string} url 本站素材路径 `/api/admin/pz/media/<id>`；取字节需带令牌转 blob
 * @property {string} alt 图片替代文本
 * @property {"16:9"|"4:3"|"1:1"} ratio 宽高比
 */

/**
 * 预览里的附件。
 * @typedef {Object} PreviewAttachment
 * @property {"image"|"video"|"audio"|"pdf"|"file"|"link"} type 类型
 * @property {string} name 展示名
 * @property {string} url 本站素材路径 `/api/admin/pz/media/<id>`（`pdf` / `file` 自带 `?download=1`）；
 *   `link` 为外链 `https:`
 * @property {number} [sizeBytes] 字节数（`link` 类型没有该字段）
 * @property {number} [durationSec] 音视频时长（非音视频没有该字段）
 * @property {string} [note] 出题人备注（可能没有该字段）
 */

/**
 * 预览里的预置提示。预览是「全量草稿」，所以每一项都是 `unlocked: true` 且都带正文。
 * @typedef {Object} PreviewHint
 * @property {number} id 提示 id
 * @property {string} name 提示名称
 * @property {number} cost 价格（tips 点数）
 * @property {boolean} unlocked 预览里恒为 `true`（不判进度、不判购买）
 * @property {string} content 正文（预览里必定下发）
 */

/**
 * 预览里的可塑区。
 * @typedef {Object} PreviewMalleable
 * @property {"component"|"iframe"} kind 可塑区类型
 * @property {boolean} wide `true` 时容器加宽（960），其余排版仍由宿主决定
 * @property {number} minHeight 骨架高度（默认 320）
 * @property {Object} [props] 仅 `component`：出题人配置的 props（原样透传）
 * @property {string} [url] 仅 `iframe`：外链地址（只可能是 `https:`）
 * @property {{ tag: string, url: string, integrity: string, bytes: number }|null} [asset]
 *   仅 `component`：组件描述符；`url` 指向
 *   `/api/admin/pz/puzzle/<key>/asset/<name>/<version>`，取回 ESM 后**必须**校验 `integrity`
 */

/**
 * 出题台预览的题目对象（`getPuzzlePreview()` 的 `data.puzzle`）。
 *
 * 字段 / 嵌套 / 语义与玩家 `GET /api/puzzle/:key` 的 `PuzzleView` 一致
 * （见 `vue-mistarg2anns/src/api/puzzle.js`），差别只有三点：
 * 1. 资源 URL 换成管理端预览路径 —— `/api/puzzle/media/<id>` →
 *    `/api/admin/pz/media/<id>`，`/api/puzzle/asset/<n>/<v>` →
 *    `/api/admin/pz/puzzle/<key>/asset/<n>/<v>`；这些地址都要带令牌取 blob，
 *    不能直接塞给 `<img src>`；
 * 2. 语义是**全量草稿**：跳过进度解锁、停用题也能预览、`solved` 恒为 `false`、
 *    提示全部 `unlocked` 且带正文；
 * 3. 没有队伍上下文，`teamProgress` 与 `runtime` **不下发**
 *    （预览桥因此固定为只读，见 `utils/previewPzBridge.js`）。
 *
 * @typedef {Object} PuzzlePreview
 * @property {string} key 题目 key
 * @property {number} rev 页面版本号（每次保存 +1，可作缓存键）
 * @property {boolean} solved 预览里恒为 `false`（不判队伍进度）
 * @property {string} title 页面唯一 H1
 * @property {PreviewCover|null} cover 封面；`null` 时整块不渲染
 * @property {string|null} description 受限 Markdown 源文本；`null` 时整块不渲染；
 *   内联图已在下发时改写为 `![alt](/api/admin/pz/media/<id>)`
 * @property {Object<string, string>} [media] 描述内联图映射
 *   `{ "<素材id>": "/api/admin/pz/media/<id>" }`；无引用时该字段不出现
 * @property {PreviewMalleable|null} malleable 可塑区；`null` 时整块不渲染
 * @property {PreviewAttachment[]} attachments 附件；空数组时整块不渲染
 * @property {PreviewHint[]} hints 预置提示；始终存在，无提示时为 `[]`
 */

/**
 * 题库列表行。
 * @typedef {Object} PuzzleRow
 * @property {string} key 题目 key
 * @property {string} title 标题
 * @property {number} ord 排序值
 * @property {number|null} archiveId 归档 id；`null` = 无
 * @property {number} tipsReward 提示点奖励（GET 侧为 **camelCase**）
 * @property {boolean} enabled 是否启用
 * @property {number|null} authorId 出题人账号 id；历史无主题为 `null`
 * @property {string|null} authorUsername 出题人用户名
 * @property {string|null} folderKey 所属目录 key；`null` = 未分组
 * @property {string} [answer] 判题答案；**仅 admin 或该题作者**才有该字段，
 *   无权限时响应里没有 `answer`（不是 `null`）
 */

/**
 * 题库列表里的目录（扁平、无父子层级，含空目录与停用目录）。
 * @typedef {Object} FolderBrief
 * @property {string} key 目录 key
 * @property {string} title 目录名
 * @property {number} ord 排序值
 * @property {boolean} enabled 是否启用
 * @property {number|null} ownerId 所有人账号 id
 * @property {string|null} ownerUsername 所有人用户名
 */

/**
 * 目录详情（`listFolders()` / `upsertFolder()` 返回，比 `FolderBrief` 多解锁规则与时间戳）。
 * @typedef {Object} FolderRow
 * @property {string} key 目录 key（`^[a-z0-9][a-z0-9_]{2,31}$`，赛事内不改）
 * @property {string} title 目录名（1–200 字）
 * @property {number} ord 排序值（0–100000）
 * @property {boolean} enabled `false` = 从结构接口隐藏（题目行保留）
 * @property {Object} unlock 目录解锁规则（形状同题目 `unlock`）
 * @property {number|null} ownerId 所有人账号 id
 * @property {string|null} ownerUsername 所有人用户名
 * @property {string} createdAt 创建时间
 * @property {string} updatedAt 更新时间
 */

/**
 * 预置提示（草稿 / 保存后的同形结构）。
 * @typedef {Object} PuzzleHint
 * @property {number} id 提示 id；提交时不带 = 新增
 * @property {number} ord 顺序（= 提交数组下标）
 * @property {string} name 名称（1–40 字）
 * @property {string} content 正文（1–2000 字，**纯文本**、保留换行，不要当 Markdown/HTML）
 * @property {number} cost 价格 tips（0–1000000；`0` = 免费，正文直接对玩家可见）
 * @property {string} createdAt 创建时间
 * @property {string} updatedAt 更新时间
 */

/**
 * 某题预置提示（`getPuzzleHints()` / `putPuzzleHints()` 的 `data`）。
 * @typedef {Object} PuzzleHintsData
 * @property {number} rev 题目页面版本号（与 `getPuzzlePage()` 的 `rev` 同源，每次保存严格 +1）
 * @property {PuzzleHint[]} hints 提示列表（按 `ord`）
 */

/**
 * 出题草稿（`getPuzzlePage()` 解包后的 `data.puzzle`）。
 * @typedef {Object} PuzzlePageDraft
 * @property {string} key 题目 key
 * @property {string} title 标题
 * @property {boolean} enabled 是否启用（停用题也能读草稿）
 * @property {number} rev 页面版本号
 * @property {string|null} folderKey 所属目录；`null` = 未分组
 * @property {Object} unlock 解锁规则（默认 `{ kind: "sequence" }` = 同目录上一题答对后解锁）
 * @property {Object} [page] 四元素：`description` / `cover` / `malleable` / `attachments`，
 *   素材以 `assetId` 原始引用返回，便于编辑
 */

/**
 * 页面保存结果（`putPuzzlePage()` 的 `data`）。
 * @typedef {Object} PageSaveResult
 * @property {string} key 题目 key
 * @property {number} rev 保存后的新版本号（每次成功严格 +1，可当缓存键）
 * @property {string|null} folderKey 保存后的目录
 * @property {"none"|"component"|"iframe"|null} malleableKind 可塑区类型
 * @property {number} attachmentCount 附件条数
 * @property {Object} unlock 保存后的解锁规则
 */

/**
 * 外链来源白名单行（`listIframeOrigins()` 兼容 `{origins}` / `{items}` / 数组三种外形）。
 * @typedef {Object} IframeOriginRow
 * @property {number|string} [id] 行 id（DELETE 要用）
 * @property {string} origin 来源（只接受 `https://host[:port]`，全库唯一）
 * @property {string} [note] 备注
 * @property {1|2} [status] `1` 启用 / `2` 已软删
 * @property {string|null} [updatedAt] 更新时间（视图兼容 `updated_at`）
 */

/**
 * `http.request` 抛出的接口错误；后端 `error` 对象挂在 `error.detail` 上。
 * @typedef {import("./http").ApiError} ApiError
 */

/**
 * 题库列表 + 目录（出题台左侧导航）。
 *
 * - 接口：`GET /api/admin/puzzles`
 * - 鉴权：需要访问令牌 + staff 及以上
 * - 文档：api-12-puzzle.md「`GET /api/admin/puzzles`」
 *
 * @returns {Promise<{ items: PuzzleRow[], folders: FolderBrief[] }>} `data` 本体
 * @throws {ApiError}
 *   - 401 `E_AUTH`：未登录或令牌失效
 *   - 403 `E_FORBIDDEN`：不是 staff / admin
 */
export const listPuzzles = () => get("/admin/puzzles");

/**
 * 新建或更新题目主数据（upsert，**不会返回 404**）。
 *
 * - 接口：`PUT /api/admin/puzzles/:key`
 * - 鉴权：需要访问令牌 + `pz.content.edit` **且是该题作者**；admin 直通
 * - 文档：api-12-puzzle.md「`PUT /api/admin/puzzles/:key`」
 *
 * @param {string} puzzleKey 题目 key（取前 64 字符，为空 → 400）
 * @param {Object} body
 * @param {string} [body.title] 标题（trim 后 ≤200 字；新建省略 = `未命名`）
 * @param {number} [body.ord] 排序值（0–100000；新建默认 0）
 * @param {number|null} [body.archive_id] 归档 id（≥0，不校验是否存在；新建默认 `null`）
 * @param {number} [body.tips_reward] 提示点奖励（0–1000000；新建默认 0）
 * @param {boolean} [body.enabled] 是否启用（新建默认 `true`）
 * @param {string} [body.answer] 判题答案（≤200 字）
 * @param {number} [body.author_id] **仅 admin**：设置 / 改派出题人（须是 staff 或 admin）
 * @returns {Promise<{ puzzle: { key: string, title: string, ord: number, archive_id: number|null,
 *   tips_reward: number, enabled: boolean, author_id: number } }>} `data` 本体（**snake_case**）
 * @throws {ApiError}
 *   - 400 `E_VALIDATION`：字段越界 / 类型不对、`:key` 为空、`author_id` 目标不是出题人
 *     detail.fields：
 *       `title` -- 超过 200 字
 *       `ord` -- 不在 0–100000
 *       `tips_reward` -- 不在 0–1000000
 *       `answer` -- 超过 200 字
 *       `author_id` -- 目标账号不是 staff / admin
 *   - 401 `E_AUTH`：未登录或令牌失效
 *   - 403 `E_FORBIDDEN`：改别人的题 / staff 传 `author_id` / 缺 `pz.content.edit`
 */
export const putPuzzle = (puzzleKey, body) =>
  put(`/admin/puzzles/${key(puzzleKey)}`, body);

/**
 * 组件发布第一步：申请 Vue 源码的上传地址。
 *
 * - 接口：`POST /api/admin/pz/widgets/source/sign`
 * - 鉴权：需要访问令牌 + `pz.widget.publish`
 * - 文档：api-12-puzzle.md「`POST /api/admin/pz/widgets/source/sign`」
 *
 * @param {Object} body
 * @param {string} body.name 组件名（`^[a-z][a-z0-9-]{2,31}$`）
 * @param {string} [body.filename] 文件名；给了必须是 `.vue`
 * @param {number} [body.sizeBytes] 源码字节数；给了必须 1–131072（上限 128KB）
 * @returns {Promise<{ upload: UploadTicket, limits: { maxBytes: number } }>} `data` 本体
 * @throws {ApiError}
 *   - 400 `E_VALIDATION`：组件名不合法、`filename` 非 `.vue`、`sizeBytes` 越界
 *   - 401 `E_AUTH`：未登录或令牌失效
 *   - 403 `E_FORBIDDEN`：缺 `pz.widget.publish`
 *   - 502 `E_UPSTREAM`：上传服务暂不可用
 */
export const signWidgetSource = ({ name, filename, sizeBytes }) =>
  post("/admin/pz/widgets/source/sign", { name, filename, sizeBytes });

/**
 * 组件发布第二步：把直传好的源码编译成组件 ESM 并登记。
 *
 * - 接口：`POST /api/admin/pz/widgets/compile`
 * - 鉴权：需要访问令牌 + `pz.widget.publish`
 * - 文档：api-12-puzzle.md「`POST /api/admin/pz/widgets/compile`」
 *
 * 版本号由服务端分配并自动递增（`1.0.0 → 1.0.1`），**前端不要传也不要自己生成**，
 * 挂载时用响应里的 `version` / `tag` / `integrity` / `url`。
 * `replaced.referencesUpdated` 是本次发布后受影响的题目数（需要重新读页面配置）。
 *
 * @param {Object} body
 * @param {string} body.name 组件名（必须与 `signWidgetSource()` 时一致）
 * @param {string} body.objectKey 直传接口返回的 `upload.objectKey`（原样）
 * @param {string} [body.note] 发布备注（≤200 字符）
 * @returns {Promise<{ widget: WidgetMeta, replaced: { esmVersions?: string[],
 *   referencesUpdated: number } }>} `data` 本体
 * @throws {ApiError}
 *   - 400 `E_VALIDATION`：名称 / 参数 / 源码格式不合法，或源码超过 128KB
 *   - 401 `E_AUTH`：未登录或令牌失效
 *   - 403 `E_FORBIDDEN`：缺 `pz.widget.publish`
 *   - 409 `E_CONFLICT`：发布冲突，请稍后重试
 *   - 502 `E_UPSTREAM`：组件发布暂不可用
 */
export const compileWidget = ({ name, objectKey, note }) =>
  post("/admin/pz/widgets/compile", { name, objectKey, note });

/**
 * 组件清单。
 *
 * - 接口：`GET /api/admin/pz/widgets`
 * - 鉴权：需要访问令牌 + `pz.widget.publish`
 * - 文档：api-12-puzzle.md「`GET /api/admin/pz/widgets`」
 *
 * 每个 `name` 只返回最新 ESM 与仍留档的源码（`sources`，最多 3 版）。
 * `status=2` 为停用：停用后玩家侧下发 `404`。
 *
 * @param {{ signal?: AbortSignal }} [options] 请求选项：只透传 `signal`
 *   （配合 `http.requestLatest()` 取消旧请求）
 * @returns {Promise<{ widgets: WidgetMeta[] }>} `data` 本体
 * @throws {ApiError}
 *   - 401 `E_AUTH`：未登录或令牌失效
 *   - 403 `E_FORBIDDEN`：缺 `pz.widget.publish`
 */
export const listWidgets = (options) =>
  get("/admin/pz/widgets", undefined, options);

/**
 * 读取仍留档的某个版本的组件源码。
 *
 * - 接口：`GET /api/admin/pz/widgets/:name/source/:version`
 * - 鉴权：需要访问令牌 + `pz.widget.publish`
 * - 文档：api-12-puzzle.md「`GET /api/admin/pz/widgets/:name/source/:version`」
 *
 * @param {string} name 组件名
 * @param {string} version 版本号（来自清单的 `sources[].version`）
 * @returns {Promise<{ source: WidgetSource }>} `data` 本体
 * @throws {ApiError}
 *   - 400 `E_VALIDATION`：组件名 / 版本格式不合法
 *   - 401 `E_AUTH`：未登录或令牌失效
 *   - 403 `E_FORBIDDEN`：缺 `pz.widget.publish`
 *   - 404 `E_NOT_FOUND`：该版本没留档或已被清理
 *   - 502 `E_UPSTREAM`：源码暂不可用
 */
export const getWidgetSource = (name, version) =>
  get(`/admin/pz/widgets/${key(name)}/source/${key(version)}`);

/**
 * 素材直传第一步：申请上传地址。
 *
 * - 接口：`POST /api/admin/pz/media/sign`
 * - 鉴权：需要访问令牌 + `pz.content.edit`；`scope:"public"` 与 `ownerId` **仅 admin**
 * - 文档：api-12-puzzle.md「`POST /api/admin/pz/media/sign`」
 * 类型白名单（扩展名须与 `mime` 匹配）：
 * - `image`：`image/webp` / `image/png` / `image/jpeg` → 上限 5 MB
 * - `audio`：`audio/mpeg` / `audio/mp4` / `audio/ogg` / `audio/wav` → 20 MB
 * - `video`：`video/mp4` / `video/webm` → 100 MB
 * - `pdf`：`application/pdf` → 20 MB
 * - `file`：`application/zip` / `application/x-zip-compressed` → 20 MB
 *
 * @param {Object} body
 * @param {string} body.filename 原始文件名（扩展名须与 `mime` 匹配）
 * @param {string} body.mime MIME（见上方白名单）
 * @param {number} body.sizeBytes 文件字节数（须 ≤ 该类型上限）
 * @param {"private"|"public"} [body.scope="private"] `public`（直传公共区）仅 admin
 * @param {number} [body.ownerId] 仅 admin：私有素材归属账号（须为 staff / admin；
 *   缺省 = 操作者自己）；`scope:"public"` 时禁止
 * @returns {Promise<{ upload: UploadTicket, scope: "private"|"public",
 *   ownerId: number|null }>} `data` 本体（`scope` / `ownerId` 为本次上传归属）
 * @throws {ApiError}
 *   - 400 `E_VALIDATION`：类型 / 扩展名 / 大小不在白名单，`scope` 非法，`ownerId` 非法或
 *     目标不是出题人账号
 *     detail.fields：
 *       `mime` -- 不支持的素材类型
 *       `filename` -- 扩展名与 mime 不匹配
 *       `sizeBytes` -- 超过该类型上限
 *       `ownerId` -- 目标账号不是 staff / admin
 *   - 401 `E_AUTH`：未登录或令牌失效
 *   - 403 `E_FORBIDDEN`：缺 `pz.content.edit`；staff 传 `scope:"public"` 或 `ownerId`
 *   - 502 `E_UPSTREAM`：上传服务暂不可用
 */
export const signMedia = ({ filename, mime, sizeBytes, scope, ownerId }) =>
  post("/admin/pz/media/sign", {
    filename,
    mime,
    sizeBytes,
    ...(scope ? { scope } : {}),
    ...(ownerId ? { ownerId } : {}),
  });

/**
 * 素材直传第二步：确认并登记（**幂等**，重复确认同一 `objectKey` 返回既有素材）。
 *
 * - 接口：`POST /api/admin/pz/media/confirm`
 * - 鉴权：需要访问令牌 + `pz.content.edit`；私有归属须是本人或操作者是 admin，
 *   公共素材只有 admin 能确认
 * - 文档：api-12-puzzle.md「`POST /api/admin/pz/media/confirm`」
 *
 * @param {Object} body
 * @param {string} body.objectKey `signMedia()` 返回的 `upload.objectKey`（原样）
 * @param {string} body.filename 原始文件名（扩展名须与 key 一致）
 * @param {string} body.mime 与 sign 时一致
 * @param {number} body.sizeBytes 必须与已上传文件实际大小一致
 * @param {number} [body.durationSec] 音视频时长（0–86400）
 * @param {string} [body.note] 备注（≤200 字符）
 * @returns {Promise<{ media: MediaRow }>} `data` 本体
 * @throws {ApiError}
 *   - 400 `E_VALIDATION`：`objectKey` 格式不对 / 对象不存在 / 声明大小与实际不符 /
 *     扩展名或 mime 不符
 *     detail.fields：
 *       `sizeBytes` -- `声明大小与对象实际大小不一致（声明 X，实际 Y）`
 *   - 401 `E_AUTH`：未登录或令牌失效
 *   - 403 `E_FORBIDDEN`：缺 `pz.content.edit`；私有素材归属不是本人且非 admin；
 *     非 admin 确认公共素材
 *   - 409 `E_CONFLICT`：极端并发窗口下的重复登记，刷新后重试
 *   - 502 `E_UPSTREAM`：上传服务暂不可用
 */
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

/**
 * 素材列表（六个查询维度，由 `view` 决定集合）。
 *
 * - 接口：`GET /api/admin/pz/media`
 * - 鉴权：需要访问令牌 + `pz.content.edit`；`view=puzzle` / `used` 还要求是该题作者，
 *   `view=all` 与 `withdrawRequested=1` **仅 admin**
 * - 文档：api-12-puzzle.md §四「`GET /api/admin/pz/media`」
 *
 * `view` 集合（`mine` 已移除、无兼容别名）：
 * - `owner`（默认）：目标出题人**名下**全部素材（含已被收录公共的，便于查看与撤回）
 * - `usable`：目标出题人**能引用**的全集 = 名下 ∪ 公共。⚠ 收录候选要看**所有出题人**的
 *   私有素材，`usable` 拿不到，需 admin 用 `view=all` 再在前端筛
 * - `public`：公共素材区全部
 * - `all`：全量盘点（含他人私有与无主）—— **仅 admin**
 * - `puzzle`：某题**可用**（与保存校验同口径），每行附 `usedInPage` / `marked`
 * - `used`：某题**已使用**（页面引用 ∪ 本题标记），`data` 变成 `{ media, invalidRefs }`
 *
 * 列表**包含停用行**（`status=2`），由前端置灰或过滤；素材后来失效时不会从列表消失，
 * 而是 `invalid=true` + `invalidReason`。`view=puzzle` / `used` 允许停用题，只有题目不存在才 404。
 *
 * @param {Object} [params]
 * @param {"owner"|"usable"|"public"|"all"|"puzzle"|"used"} [params.view="owner"] 查询维度
 * @param {number} [params.ownerId] `owner` / `usable` 的目标出题人账号 id；缺省 = 自己。
 *   staff 只能指定自己（否则 403），admin 任意
 * @param {string} [params.puzzleKey] `view=puzzle` / `used` **必填**；调用者须该题作者或 admin
 * @param {boolean|0|1} [params.allowShare] `true` = 只列 `allowShare=true` 的素材（收录候选池）
 * @param {boolean|0|1} [params.withdrawRequested] 仅 admin：只列「公共且有待审撤回申请」的素材，
 *   按申请时间升序，每行附 `withdrawImpact`
 * @param {{ signal?: AbortSignal }} [options] 请求选项：只透传 `signal`
 * @returns {Promise<{ media: MediaRow[] }|{ media: MediaUsedItem[], invalidRefs: InvalidRef[] }>}
 *   普通 view 为 `{ media }`；`view=used` 额外带 `invalidRefs`（外形不同，注意解构）
 * @throws {ApiError}
 *   - 400 `E_VALIDATION`：`view` 不在六个枚举、`puzzleKey` 格式非法或该 view 下缺失
 *   - 401 `E_AUTH`：未登录或令牌失效
 *   - 403 `E_FORBIDDEN`：缺 `pz.content.edit`；staff 指定他人 `ownerId`；非 admin 用
 *     `view=all` / `withdrawRequested`；非该题作者用 `view=puzzle` / `used`
 *   - 404 `E_NOT_FOUND`：`view=puzzle` / `used` 时题目不存在
 */
export const listMedia = (params = {}, options) =>
  get("/admin/pz/media", params, options);

/**
 * 修改素材。
 *
 * - 接口：`PUT /api/admin/pz/media/:id`
 * - 鉴权：出题人只能改**自己的私有素材**；admin 任意
 * - 文档：api-12-puzzle.md「`PUT /api/admin/pz/media/:id`」
 *
 * @param {number} id 素材 id
 * @param {Object} body 至少一项
 * @param {string} [body.filename] 展示 / 下载名（1–200）
 * @param {string|null} [body.note] 备注（≤200；传 `null` 清空）
 * @param {1|2} [body.status] `1` 启用 / `2` 停用（停用后所有视图与下发立即不可用）
 * @param {boolean} [body.allowShare] **仅私有素材**：标记 / 取消「允许他人使用」
 *   （公共素材传入 → 400，共享状态由收录 / 撤回流程维护）
 * @param {"private"|"public"} [body.scope] **仅 admin**：`private→public` 收录 /
 *   `public→private` 下架（含同意撤回）
 * @param {number} [body.ownerId] **仅 admin**、仅私有素材：改归属（目标须是出题人账号）；
 *   与 `scope:"public"` 互斥
 * @returns {Promise<{ media: MediaRow }>} `data` 本体
 * @throws {ApiError}
 *   - 400 `E_VALIDATION`：请求体为空或字段不合法
 *     detail.reason_code：
 *       `MEDIA_SHARE_NOT_ALLOWED` -- 收录时作者还没允许他人使用
 *   - 401 `E_AUTH`：未登录或令牌失效
 *   - 403 `E_FORBIDDEN`：非本人且非 admin；出题人改公共素材；出题人传 `scope` / `ownerId`
 *     detail.reason_code：
 *       `MEDIA_PUBLIC_ADMIN_ONLY` -- 出题人试图修改公共素材
 *   - 404 `E_NOT_FOUND`：素材不存在
 */
export const updateMedia = (id, body) => put(`/admin/pz/media/${id}`, body);

/**
 * 素材使用反查（素材 → 引用它的题 + 位置 + 仅标记题）。
 *
 * - 接口：`GET /api/admin/pz/media/:id/usage`
 * - 鉴权：**仅 admin**（会让作者看到其他作者的题目标题，故不下放）
 * - 文档：api-12-puzzle.md「`GET /api/admin/pz/media/:id/usage`」
 *
 * @param {number} id 素材 id
 * @param {Object} [params]
 * @param {number} [params.limit=200] 明细条数上限（1–500）；总数见 `total`
 * @returns {Promise<MediaUsage>} `data` 本体
 * @throws {ApiError}
 *   - 400 `E_VALIDATION`：`limit` 不在 1–500
 *   - 401 `E_AUTH`：未登录或令牌失效
 *   - 403 `E_FORBIDDEN`：不是 admin
 *   - 404 `E_NOT_FOUND`：素材不存在
 */
export const getMediaUsage = (id, params) =>
  get(`/admin/pz/media/${id}/usage`, params);

/**
 * 作者对自己的**公共**素材发起撤回申请（幂等）。
 *
 * - 接口：`POST /api/admin/pz/media/:id/withdraw`
 * - 鉴权：素材作者本人
 * - 文档：api-12-puzzle.md「撤回流程」
 *
 * @param {number} id 素材 id
 * @returns {Promise<{ media: MediaRow }>} `data` 本体
 * @throws {ApiError}
 *   - 400 `E_VALIDATION`：id 不是正整数
 *   - 401 `E_AUTH`：未登录或令牌失效
 *   - 403 `E_FORBIDDEN`：不是素材作者本人
 *   - 404 `E_NOT_FOUND`：素材不存在
 *   - 409 `E_CONFLICT`：素材不在公共区（`detail.reason_code="MEDIA_NOT_PUBLIC"`）
 */
export const requestMediaWithdraw = (id) =>
  post(`/admin/pz/media/${id}/withdraw`);

/**
 * 撤销撤回申请：作者撤回自己的申请 / **admin 驳回**申请（幂等）。
 *
 * - 接口：`DELETE /api/admin/pz/media/:id/withdraw`
 * - 鉴权：素材作者本人或 admin
 * - 文档：api-12-puzzle.md「撤回流程」
 *
 * @param {number} id 素材 id
 * @returns {Promise<{ media: MediaRow }>} `data` 本体
 * @throws {ApiError}
 *   - 400 `E_VALIDATION`：id 不是正整数
 *   - 401 `E_AUTH`：未登录或令牌失效
 *   - 403 `E_FORBIDDEN`：既不是作者也不是 admin
 *   - 404 `E_NOT_FOUND`：素材不存在
 *   - 409 `E_CONFLICT`：素材不在公共区（`MEDIA_NOT_PUBLIC`）
 */
export const cancelMediaWithdraw = (id) =>
  del(`/admin/pz/media/${id}/withdraw`);

/**
 * admin 同意撤回：素材回到原作者私有、`allowShare=false`、清空申请。
 *
 * - 接口：`POST /api/admin/pz/media/:id/withdraw/approve`
 * - 鉴权：**仅 admin**
 * - 文档：api-12-puzzle.md「撤回流程」
 *
 * 同意后引用该素材的页面立即降级（视图跳过、保存 400、下发 404）。
 * admin 也可不经申请强制下架：`updateMedia(id, { scope: "private" })`。
 *
 * @param {number} id 素材 id
 * @returns {Promise<{ media: MediaRow }>} `data` 本体
 * @throws {ApiError}
 *   - 400 `E_VALIDATION`：id 不是正整数
 *   - 401 `E_AUTH`：未登录或令牌失效
 *   - 403 `E_FORBIDDEN`：不是 admin
 *   - 404 `E_NOT_FOUND`：素材不存在
 *   - 409 `E_CONFLICT`：状态不允许该操作
 *     detail.reason_code：
 *       `MEDIA_NOT_PUBLIC` -- 素材已不在公共区（已下架 / 已同意过）
 *       `MEDIA_NO_WITHDRAW_REQUEST` -- 在公共区但没有待审申请
 */
export const approveMediaWithdraw = (id) =>
  post(`/admin/pz/media/${id}/withdraw/approve`);

/**
 * 把素材归入某题的「本题已使用」列表（`mark` 来源，幂等）。
 *
 * - 接口：`PUT /api/admin/pz/puzzle/:key/media/:assetId`
 * - 鉴权：需要访问令牌 + `pz.content.edit` **且是该题作者**；admin 直通
 * - 文档：api-12-puzzle.md「`PUT /api/admin/pz/puzzle/:key/media/:assetId`」
 *
 * **无请求体**。不修改页面，也不参与渲染 / 保存校验 / 玩家下发；只让
 * `view=puzzle` 的该素材 `marked=true`、`view=used` 的 `sources` 含 `mark`。
 * 素材须**当前可被本题引用**（`status=1` 且公共或归属该题作者），否则
 * `400` + `detail.reason_code="MEDIA_REF_INVALID"`；允许先标记、后插入页面。
 *
 * @param {string} puzzleKey 题目 key
 * @param {number} assetId 素材 id
 * @returns {Promise<{ puzzleKey: string, assetId: number, marked: true }>} `data` 本体
 * @throws {ApiError}
 *   - 400 `E_VALIDATION`：`key` 格式非法 / `assetId` 非正整数；素材不可引用
 *     detail.reason_code：
 *       `MEDIA_REF_INVALID` -- 素材不存在 / 已停用 / 不是公共也不是本题作者的私有素材
 *   - 401 `E_AUTH`：未登录或令牌失效
 *   - 403 `E_FORBIDDEN`：不是该题作者
 *   - 404 `E_NOT_FOUND`：题目或素材不存在
 */
export const markPuzzleMedia = (puzzleKey, assetId) =>
  put(`/admin/pz/puzzle/${key(puzzleKey)}/media/${Number(assetId)}`);

/**
 * 取消本题标记（幂等）。
 *
 * - 接口：`DELETE /api/admin/pz/puzzle/:key/media/:assetId`
 * - 鉴权：该题作者或 admin
 * - 文档：api-12-puzzle.md「`DELETE /api/admin/pz/puzzle/:key/media/:assetId`」
 *
 * @param {string} puzzleKey 题目 key
 * @param {number} assetId 素材 id
 * @returns {Promise<{ puzzleKey: string, assetId: number, marked: false }>} `data` 本体
 * @throws {ApiError}
 *   - 400 `E_VALIDATION`：`key` / `assetId` 非法
 *   - 401 `E_AUTH`：未登录或令牌失效
 *   - 403 `E_FORBIDDEN`：不是该题作者
 *   - 404 `E_NOT_FOUND`：题目不存在
 */
export const unmarkPuzzleMedia = (puzzleKey, assetId) =>
  del(`/admin/pz/puzzle/${key(puzzleKey)}/media/${Number(assetId)}`);

/**
 * 直传本体：按 sign 返回的 `method` / `headers` 把文件 PUT 到对象存储（不经过后端）。
 *
 * @param {UploadTicket} upload `signMedia()` 返回的 `upload`
 * @param {File|Blob} file 要上传的文件
 * @param {(percent: number) => void} [onProgress] 进度回调（0–100 整数）
 * @returns {{ promise: Promise<XMLHttpRequest> }} 2xx 时 resolve 为 XHR 对象
 */
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

/**
 * 读取某题的出题草稿（五元素 + 目录归属 + 解锁规则）。
 *
 * - 接口：`GET /api/admin/pz/puzzle/:key/page`
 * - 鉴权：需要访问令牌 + `pz.content.edit` **且是该题作者**；admin 直通
 * - 文档：api-12-puzzle.md「`GET /api/admin/pz/puzzle/:key/page`」
 *
 * @param {string} puzzleKey 题目 key
 * @returns {Promise<PuzzlePageDraft|null>} 草稿本体；`data.puzzle` 缺失时为 `null`
 * @throws {ApiError}
 *   - 400 `E_VALIDATION`：`:key` 为空
 *   - 401 `E_AUTH`：未登录或令牌失效
 *   - 403 `E_FORBIDDEN`：缺 `pz.content.edit` 或不是该题作者
 *   - 404 `E_NOT_FOUND`：题目不存在
 */
export const getPuzzlePage = async (puzzleKey) => {
  const data = await get(`/admin/pz/puzzle/${key(puzzleKey)}/page`);
  return data?.puzzle ?? null;
};

/**
 * 保存元素页面（整页替换）。
 *
 * - 接口：`PUT /api/admin/pz/puzzle/:key/page`
 * - 鉴权：需要访问令牌 + `pz.content.edit` **且是该题作者**；admin 直通
 * - 文档：api-12-puzzle.md「`PUT /api/admin/pz/puzzle/:key/page`」
 *
 * @param {string} puzzleKey 题目 key
 * @param {Object} body
 * @param {string|null} [body.folderKey] 目录 key；省略或 `null` = 未分组（给了必须存在）。
 *   staff 只能放进**自己的目录**；当前已在别人目录时只能原样传回，移出 / 换目录需 admin
 * @param {Object} [body.page] 四元素；`{}` = 清空
 * @param {string} [body.page.description] 受限 Markdown（≤20000 字符）；内联图只允许
 *   `![alt](asset:<素材id>)`（alt 1–200 字、不同素材 ≤20 个；外链 / `data:` / `javascript:` → 400）
 * @param {{ assetId: number, alt: string, ratio?: "16:9"|"4:3"|"1:1",
 *   progressAssetId?: number }} [body.page.cover] 封面（`assetId` / `alt` 有 cover 时必填；
 *   `progressAssetId` = 完成后换用的封面）
 * @param {{ kind: "none"|"component"|"iframe", name?: string, version?: string,
 *   props?: Object, wide?: boolean, minHeight?: number, url?: string }} [body.page.malleable]
 *   可塑区：`component` 需 `name` + `version`（已登记）；`iframe` 需 `url`（只认 `https:`，
 *   ≤500 字符，且 origin 须在启用 allowlist 内）；`minHeight` 200–2000 默认 320
 * @param {{ type: "image"|"video"|"audio"|"pdf"|"file"|"link", name: string,
 *   assetId?: number, href?: string, note?: string }[]} [body.page.attachments] 附件（≤20 条）；
 *   `link` 用 `href`（只认 `https:`），其余用 `assetId` 且类型须与素材一致
 * @param {Object} [body.unlock] 解锁规则；省略 = 不改
 * @param {"sequence"|"always"|"count"|"keys"|"handler"} [body.unlock.kind] 规则类型
 * @param {number} [body.unlock.min] `count` 必填：已解数阈值（0–100000）
 * @param {string[]} [body.unlock.keys] `keys` 必填：指定题 key 集合（≤100，全部答对才解锁）。
 *   staff 只能引用自己的题，引用别人的题 → 403
 * @param {string} [body.unlock.name] `handler` 必填：已配置的判定函数名
 * @param {Object} [body.unlock.params] 传给判定函数的参数（≤4KB）
 * @param {{ handler: string, params?: Object }} [body.unlock.extra] 额外条件，与主规则 **AND**
 * @returns {Promise<PageSaveResult>} `data` 本体
 * @throws {ApiError}
 *   - 400 `E_VALIDATION`：字段不合法 / 组件未登记 / 页面超 64KB / 素材不可引用
 *     detail.reason_code：
 *       `MEDIA_REF_INVALID` -- 有素材引用不可用，`detail.invalidRefs[]` 给全量清单
 *     detail.invalidRefs[].reason：
 *       `not_found` -- 素材 id 不存在
 *       `disabled` -- 素材已停用
 *       `not_referenceable` -- 他人私有，或公共素材已被撤销
 *   - 401 `E_AUTH`：未登录或令牌失效
 *   - 403 `E_FORBIDDEN`：缺 `pz.content.edit`、不是该题作者、跨区目录、跨区 unlock keys
 *   - 404 `E_NOT_FOUND`：题目不存在
 */
export const putPuzzlePage = (puzzleKey, body) =>
  put(`/admin/pz/puzzle/${key(puzzleKey)}/page`, body);

/**
 * 读取某题预置提示草稿（**含正文**，供出题人编辑）。
 *
 * - 接口：`GET /api/admin/pz/puzzle/:key/hints`
 * - 鉴权：需要访问令牌 + `pz.content.edit` **且是该题作者**；admin 直通
 * - 文档：api-12-puzzle.md「`GET /api/admin/pz/puzzle/:key/hints`」
 *
 * @param {string} puzzleKey 题目 key
 * @param {{ signal?: AbortSignal }} [options] 请求选项：只透传 `signal`
 *   —— 切题时由 `http.requestLatest()` 中断上一次请求
 * @returns {Promise<PuzzleHintsData>} `data` 本体（缺失时 `{ rev: 0, hints: [] }`）
 * @throws {ApiError}
 *   - 401 `E_AUTH`：未登录或令牌失效
 *   - 403 `E_FORBIDDEN`：缺 `pz.content.edit` 或不是该题作者
 *   - 404 `E_NOT_FOUND`：题目不存在
 */
export const getPuzzleHints = async (puzzleKey, options) => {
  const data = await get(
    `/admin/pz/puzzle/${key(puzzleKey)}/hints`,
    undefined,
    options,
  );
  return data ?? { rev: 0, hints: [] };
};

/**
 * 整表保存某题的预置提示（顺序即 `ord`）。
 *
 * - 接口：`PUT /api/admin/pz/puzzle/:key/hints`
 * - 鉴权：需要访问令牌 + `pz.content.edit` **且是该题作者**；admin 直通
 * - 文档：api-12-puzzle.md「`PUT /api/admin/pz/puzzle/:key/hints`」
 *
 * 不带 `id` = 新增；未出现在数组里的已有 `id` = 删除，tips 流水留痕）
 *
 * @param {string} puzzleKey 题目 key
 * @param {{ id?: number, name: string, content: string, cost?: number }[]} hints
 *   0–10 条（空数组 = 清空）；`name` 1–40 字、`content` 1–2000 字**纯文本**、
 *   `cost` 0–1000000（缺省 0 = 免费）
 * @returns {Promise<PuzzleHintsData>} 保存后的同形结构（`rev` 已递增）
 * @throws {ApiError}
 *   - 400 `E_VALIDATION`：超过 10 条 / 名称或正文空或超长 / 价格越界 / `id` 不属于本题或重复
 *     detail.fields：
 *       `hints[<i>].cost` -- 必须在 0–1000000 之间
 *   - 401 `E_AUTH`：未登录或令牌失效
 *   - 403 `E_FORBIDDEN`：缺 `pz.content.edit` 或不是该题作者
 *   - 404 `E_NOT_FOUND`：题目不存在
 */
export const putPuzzleHints = (puzzleKey, hints) =>
  put(`/admin/pz/puzzle/${key(puzzleKey)}/hints`, { hints });

/**
 * 出题台全量草稿预览（作者 / admin）。
 *
 * - 接口：`GET /api/admin/pz/puzzle/:key/preview`
 * - 鉴权：需要访问令牌 + `pz.content.edit` **且是该题作者**；admin 直通
 * - 文档：api-12-puzzle.md「`GET /api/admin/pz/puzzle/:key/preview`」
 *
 * 返回体与玩家 view 同形，字段差异（管理端 URL、全量草稿语义、不下发 `teamProgress` /
 * `runtime`）见 {@link PuzzlePreview}。
 *
 * @param {string} puzzleKey 题目 key
 * @returns {Promise<PuzzlePreview|null>} 与玩家 view 同形的题目对象；`data.puzzle` 缺失时为 `null`
 * @throws {ApiError}
 *   - 401 `E_AUTH`：未登录或令牌失效
 *   - 403 `E_FORBIDDEN`：缺 `pz.content.edit` 或不是该题作者
 *   - 404 `E_NOT_FOUND`：题目不存在
 */
export const getPuzzlePreview = async (puzzleKey) => {
  const data = await get(`/admin/pz/puzzle/${key(puzzleKey)}/preview`);
  return data?.puzzle ?? null;
};

/**
 * 目录列表（扁平，无父子层级）。
 *
 * - 接口：`GET /api/admin/pz/folders`
 * - 鉴权：需要访问令牌 + `pz.content.edit`
 * - 文档：api-12-puzzle.md「`GET /api/admin/pz/folders`」
 *
 * @param {{ signal?: AbortSignal }} [options] 请求选项：只透传 `signal`
 * @returns {Promise<{ folders: FolderRow[] }>} `data` 本体
 * @throws {ApiError}
 *   - 401 `E_AUTH`：未登录或令牌失效
 *   - 403 `E_FORBIDDEN`：缺 `pz.content.edit`
 */
export const listFolders = (options) =>
  get("/admin/pz/folders", undefined, options);

/**
 * 新建或更新目录（幂等 upsert）。
 *
 * - 接口：`POST /api/admin/pz/folders`
 * - 鉴权：需要访问令牌 + `pz.content.edit`（staff 只能建 / 改自己的目录），admin 全部
 * - 文档：api-12-puzzle.md「`POST /api/admin/pz/folders`」
 *
 * @param {Object} body
 * @param {string} body.key 目录标识（`^[a-z0-9][a-z0-9_]{2,31}$`）
 * @param {string} body.title 目录名（1–200 字）
 * @param {number} [body.ord] 排序值（0–100000，默认 0）
 * @param {boolean} [body.enabled] 默认 `true`；`false` = 从结构接口隐藏（题目行保留）
 * @param {Object} [body.unlock] 目录解锁规则（形状同题目 `unlock`）
 * @param {number} [body.ownerId] **仅 admin**：目录所有人（须是 staff / admin）；
 *   staff 传 → `403`
 * @returns {Promise<{ folder: FolderRow }>} `data` 本体
 * @throws {ApiError}
 *   - 400 `E_VALIDATION`：标识格式不对 / 标题为空或超 200 / `ord` 超范围 / `unlock` 非法
 *     detail.fields：
 *       `key` -- 不符合 `^[a-z0-9][a-z0-9_]{2,31}$`
 *       `title` -- 空或超过 200 字
 *       `ord` -- 不在 0–100000
 *   - 401 `E_AUTH`：未登录或令牌失效
 *   - 403 `E_FORBIDDEN`：缺 `pz.content.edit`；staff 改他人目录或传 `owner_id`；
 *     跨区 `unlock.keys`
 */
export const upsertFolder = ({
  key: folderKey,
  title,
  ord,
  enabled,
  unlock,
  ownerId,
}) =>
  post("/admin/pz/folders", {
    key: folderKey,
    title,
    ord,
    enabled,
    unlock,
    ...(ownerId === undefined ? {} : { owner_id: ownerId }),
  });

/**
 * 删除目录。
 *
 * - 接口：`DELETE /api/admin/pz/folders/:key`
 * - 鉴权：需要访问令牌 + `pz.content.edit`
 * - 文档：api-12-puzzle.md「`DELETE /api/admin/pz/folders/:key`」
 *
 * @param {string} folderKey 目录 key
 * @returns {Promise<{ key: string, deleted: true }>} `data` 本体
 * @throws {ApiError}
 *   - 401 `E_AUTH`：未登录或令牌失效
 *   - 403 `E_FORBIDDEN`：缺 `pz.content.edit`
 *   - 404 `E_NOT_FOUND`：目录不存在
 *   - 409 `E_CONFLICT`：目录下仍有题目（文案带题数，如「目录下还有 2 道题，先把它们移到别的目录或置为未分组」）
 */
export const deleteFolder = (folderKey) =>
  del(`/admin/pz/folders/${key(folderKey)}`);

/**
 * iframe 来源 allowlist 列表（**admin-only**，2026-11-18 起）。
 *
 * - 接口：`GET /api/admin/pz/iframe-origins`
 * - 鉴权：**仅 admin**
 * - 文档：api-12-puzzle.md「`PUT /api/admin/pz/puzzle/:key/page`」的 iframe 说明
 *
 * @param {{ signal?: AbortSignal }} [options] 请求选项：只透传 `signal`
 * @returns {Promise<{ origins?: IframeOriginRow[], items?: IframeOriginRow[] }|IframeOriginRow[]>}
 *   `data` 本体（三种外形之一）
 * @throws {ApiError}
 *   - 401 `E_AUTH`：未登录或令牌失效
 *   - 403 `E_FORBIDDEN`：不是 admin
 */
export const listIframeOrigins = (options) =>
  get("/admin/pz/iframe-origins", undefined, options);

/**
 * 新建或恢复 iframe 来源（幂等 upsert，**admin-only**）。
 *
 * - 接口：`POST /api/admin/pz/iframe-origins`
 * - 鉴权：**仅 admin**
 *
 * @param {Object} body
 * @param {string} body.origin 来源（`https://host[:port]`）
 * @param {string} [body.note] 备注
 * @param {1|2} [body.status] `1` 启用；`2` 等价软删
 * @returns {Promise<Object>} `data` 本体（响应字段以后端为准；视图只关心是否成功）
 * @throws {ApiError}
 *   - 400 `E_VALIDATION`：`origin` 不是 `https://host[:port]` 形式
 *   - 401 `E_AUTH`：未登录或令牌失效
 *   - 403 `E_FORBIDDEN`：不是 admin
 */
export const upsertIframeOrigin = ({ origin, note, status }) =>
  post("/admin/pz/iframe-origins", {
    origin,
    ...(note === undefined ? {} : { note }),
    ...(status === undefined ? {} : { status }),
  });

/**
 * 停用 iframe 来源（**软删**，admin-only）。
 *
 * - 接口：`DELETE /api/admin/pz/iframe-origins/:id`
 * - 鉴权：**仅 admin**
 *
 * @param {number|string} id 行 id
 * @returns {Promise<Object>} `data` 本体（响应字段以后端为准）
 * @throws {ApiError}
 *   - 401 `E_AUTH`：未登录或令牌失效
 *   - 403 `E_FORBIDDEN`：不是 admin
 *   - 404 `E_NOT_FOUND`：该行不存在
 */
export const deleteIframeOrigin = (id) =>
  del(`/admin/pz/iframe-origins/${key(id)}`);
