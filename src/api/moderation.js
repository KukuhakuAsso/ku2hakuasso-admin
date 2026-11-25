import { get, post } from "./http";

/**
 * @file 管理端禁言 / 封禁 / 申诉（api-11-moderation-mute.md）。
 *
 * 经 `http.request` 调用，返回值已剥掉统一信封，直接是 `data`。
 */

/**
 * 处罚动作的请求体（禁言 / 封禁同形）。
 * @typedef {Object} PunishPayload
 * @property {string} reason 原因（1–200 字，不能为空白）
 * @property {string|null} [until] 到期时间（ISO 8601）；省略或 `null` = 永久，必须是未来时间
 */

/**
 * 账号级 / 队伍级禁言结果。
 * @typedef {Object} MuteResult
 * @property {number|null} accountId 账号级禁言时为账号 id；队伍级为 `null`
 * @property {number|null} teamId 队伍级禁言时为队伍 id；账号级为 `null`
 * @property {true} muted 固定 `true`
 * @property {boolean} overwritten `false` = 新建禁言；`true` = 覆盖了原本的禁言（原因/到期/操作人已更新）
 * @property {string} reason 本次写入的原因
 * @property {string|null} until 到期时间；`null` = 永久
 * @property {number} punishedById 操作者账号 id
 * @property {string} punishedAt 操作时间（ISO 8601）
 */

/**
 * 账号级 / 队伍级解禁结果。
 * @typedef {Object} UnmuteResult
 * @property {number|null} accountId 账号级解禁时为账号 id；队伍级为 `null`
 * @property {number|null} teamId 队伍级解禁时为队伍 id；账号级为 `null`
 * @property {true} unmuted 固定 `true`
 */

/**
 * 禁言 / 封禁列表里的一行（两者同形）。
 * @typedef {Object} PunishRow
 * @property {"account"|"team"} targetType 处罚主体；账号行无 `teamId` / `teamName`，队伍行无 `playerNo` / `username`
 * @property {number|null} accountId 账号 id（队伍行为 `null`）
 * @property {string|null} playerNo 玩家编号（队伍行为 `null`）
 * @property {string|null} username 用户名（队伍行为 `null`）
 * @property {number|null} teamId 队伍 id（账号行为 `null`）
 * @property {string|null} teamName 队伍名（账号行为 `null`）
 * @property {string} reason 处罚原因
 * @property {number} punishedById 操作者账号 id
 * @property {string} punishedByUsername 操作者用户名
 * @property {string|null} until 到期时间；`null` = 永久
 * @property {boolean} active 是否仍生效；`false` 只会出现在 `status=all` 的结果里
 * @property {string} punishedAt 处罚时间（ISO 8601）
 */

/**
 * 禁言 / 封禁列表。
 * @typedef {Object} PunishList
 * @property {PunishRow[]} items 按 `punishedAt` 倒序
 * @property {boolean} hasMore 是否因 `limit` 被截断
 */

/**
 * 申诉列表里的一行。
 * @typedef {Object} AppealRow
 * @property {"account"|"team"} targetType 账号级 / 队伍级申诉
 * @property {number|null} teamId 队伍级才有值
 * @property {string|null} teamName 队伍级才有值
 * @property {number} accountId 账号级 = 被处罚账号；队伍级 = **实际提交人**
 * @property {string} playerNo 玩家编号
 * @property {string} username 用户名
 * @property {"ban"|"mute"} kind 处罚种类（队伍封禁申诉为 `ban`）
 * @property {number} used 已提交条数
 * @property {number} limit 额度上限（固定 3）
 * @property {number} remaining 剩余条数
 * @property {"awaiting_reply"|"can_submit"|"closed"} state 申诉状态机
 * @property {boolean} awaitingReply 等价于 `state === "awaiting_reply"`
 * @property {string} lastAppealAt 最近一条申诉时间
 * @property {{ mailId: number, subject: string, content: string|null, createdAt: string }|null} lastAppeal
 *   最近一条申诉；`content` 在「他人持有工单且调用方无只读权限」时为 `null`
 * @property {{ content: string|null }|null} lastReply 最近一条官方回复（同样可能被遮蔽正文）
 * @property {string|null} banReason 封禁原因；`kind=mute` 时为 `null`
 * @property {string|null} banUntil 封禁到期；`kind=mute` 时为 `null`
 * @property {string|null} muteReason 禁言原因
 * @property {string|null} muteUntil 禁言到期
 * @property {Object|null} ticket 最近一条申诉邮件的工单（形状同站内信工单）；无则 `null`
 * @property {string|null} ticketStatus 工单状态（`open` 等），无工单时 `null`
 * @property {boolean} readOnly 是否只读预览（有处理权限 + 只读权限，且待接单 / 他人持有时为 `true`）
 */

/**
 * `replyAppeal()` 的 `data`。
 * @typedef {Object} AppealReplyResult
 * @property {"account"|"team"} targetType 申诉主体
 * @property {number} targetId 账号 id 或队伍 id
 * @property {"ban"|"mute"} kind 处罚种类
 * @property {number} mailId 被回复的申诉邮件 id
 * @property {number} replyMsgId 新写入的官方回复邮件 id
 * @property {string} createdAt 回复时间（ISO 8601）
 * @property {number} [ticketId] 本次办结的工单 id（未带 `ticket_id` 或历史无工单时不出现）
 * @property {string} [ticketStatus] 办结后的工单状态（通常 `done`）
 * @property {Object} [ticket] 办结后的工单对象（形状同站内信工单）
 */

/**
 * `http.request` 抛出的接口错误；后端 `error` 对象挂在 `error.detail` 上。
 * @typedef {import("./http").ApiError} ApiError
 */

/**
 * 禁言账号（**staff + `moderation.mute`**，admin 直通）。
 *
 * - 接口：`POST /api/admin/players/:id/mute`
 * - 鉴权：需要访问令牌 + `moderation.mute`
 * - 文档：api-11-moderation-mute.md「禁言端点」
 *
 * 重复禁言同一账号 = 覆盖（`overwritten: true`），并重置其申诉额度。
 *
 * @param {number} id 账号 id（非正整数 → 400）
 * @param {PunishPayload} body
 * @returns {Promise<MuteResult>} `data` 本体（新建与覆盖都是 200）
 * @throws {ApiError}
 *   - 400 `E_VALIDATION`：参数校验失败
 *     detail.fields：
 *       `reason` -- 缺失 / 空白 / 超过 200 字
 *       `until` -- 格式错误或不是未来时间
 *   - 401 `E_AUTH`：未登录或令牌失效
 *   - 403 `E_FORBIDDEN`：缺 `moderation.mute`，或账号级目标角色不低于操作者
 *     detail.reason_code：
 *       `PUNISH_TARGET_ROLE` -- staff 不能禁言 staff / admin，admin 不能禁言 admin
 *   - 404 `E_NOT_FOUND`：`账号不存在`
 *   - 409 `E_CONFLICT`：`该目标已封禁，请先解封` / 账号已注销
 */
export const muteAccount = (id, body) =>
    post(`/admin/players/${id}/mute`, body);

/**
 * 禁言队伍（**staff + `moderation.mute`**，admin 直通）。
 *
 * - 接口：`POST /api/admin/teams/:id/mute`
 * - 鉴权：需要访问令牌 + `moderation.mute`
 * - 文档：api-11-moderation-mute.md「禁言端点」
 *
 * 对该队**全部在任成员**生效（处罚后入队的成员同样命中，退队后不再命中）；
 * 队伍级禁言不受角色等级限制。
 *
 * @param {number} id 队伍 id（非正整数 → 400）
 * @param {PunishPayload} body
 * @returns {Promise<MuteResult>} `data` 本体（`teamId` 有值、`accountId` 为 `null`）
 * @throws {ApiError}
 *   - 400 `E_VALIDATION`：`reason` / `until` 不合法（同上）
 *   - 401 `E_AUTH`：未登录或令牌失效
 *   - 403 `E_FORBIDDEN`：缺 `moderation.mute`
 *   - 404 `E_NOT_FOUND`：`队伍不存在`
 *   - 409 `E_CONFLICT`：`该目标已封禁，请先解封` / 队伍已解散
 */
export const muteTeam = (id, body) => post(`/admin/teams/${id}/mute`, body);

/**
 * 解除账号禁言（**staff + `moderation.mute`**）。
 *
 * - 接口：`POST /api/admin/players/:id/unmute`
 * - 鉴权：需要访问令牌 + `moderation.mute`
 * - 文档：api-11-moderation-mute.md「禁言端点」
 *
 * 账号级与队伍级是**两个独立处罚**：同时生效时必须各调一次。解禁会释放该账号的申诉额度。
 *
 * @param {number} id 账号 id
 * @returns {Promise<UnmuteResult>} `data` 本体
 * @throws {ApiError}
 *   - 400 `E_VALIDATION`：`:id` 非正整数
 *   - 401 `E_AUTH`：未登录或令牌失效
 *   - 403 `E_FORBIDDEN`：缺 `moderation.mute`
 *   - 404 `E_NOT_FOUND`：`该账号当前未被禁言`（已到期的也按此处理）
 */
export const unmuteAccount = (id) => post(`/admin/players/${id}/unmute`);

/**
 * 解除队伍禁言（**staff + `moderation.mute`**）。
 *
 * - 接口：`POST /api/admin/teams/:id/unmute`
 * - 鉴权：需要访问令牌 + `moderation.mute`
 * - 文档：api-11-moderation-mute.md「禁言端点」
 *
 * @param {number} id 队伍 id
 * @returns {Promise<UnmuteResult>} `data` 本体
 * @throws {ApiError}
 *   - 400 `E_VALIDATION`：`:id` 非正整数
 *   - 401 `E_AUTH`：未登录或令牌失效
 *   - 403 `E_FORBIDDEN`：缺 `moderation.mute`
 *   - 404 `E_NOT_FOUND`：`该队伍当前未被禁言`
 */
export const unmuteTeam = (id) => post(`/admin/teams/${id}/unmute`);

/**
 * 禁言列表（解禁用，**不分页**）。
 *
 * - 接口：`GET /api/admin/mutes`
 * - 鉴权：需要访问令牌 + `moderation.mute`
 * - 文档：api-11-moderation-mute.md「`GET /api/admin/mutes`」
 *
 * 解禁时用行里的 `targetType` + `accountId` / `teamId` 调对应的 `unmute` 端点
 * （行内没有记录 id）。
 *
 * @param {Object} [params]
 * @param {"active"|"all"} [params.status="active"] `active` 只给仍生效的；`all` 含已到期（`active: false`）
 * @param {"account"|"team"|"all"} [params.target="all"] 只看账号 / 队伍 / 全部
 * @param {number} [params.account_id] 精确过滤；给了它则忽略 `team_id` 与 `target`
 * @param {number} [params.team_id] 精确过滤
 * @param {number} [params.limit=200] 1–200；不分页，截断时 `hasMore: true`
 * @returns {Promise<PunishList>} `data` 本体
 * @throws {ApiError}
 *   - 400 `E_VALIDATION`：`status` / `target` 不在枚举内，或 `limit` 超过 200
 *   - 401 `E_AUTH`：未登录或令牌失效
 *   - 403 `E_FORBIDDEN`：缺 `moderation.mute`
 */
export const listMutes = (params) => get("/admin/mutes", params);

/**
 * 封禁列表（解封用，查询参数与禁言列表相同）。
 *
 * - 接口：`GET /api/admin/banneds`
 * - 鉴权：需要访问令牌 + **admin**（+ `moderation.ban`）
 * - 文档：api-11-moderation-mute.md「`GET /api/admin/banneds`」
 *
 * @param {Object} [params] 同 `listMutes()`：`status` / `target` / `account_id` / `team_id` / `limit`
 * @returns {Promise<PunishList>} `data` 本体（行结构与禁言列表同形）
 * @throws {ApiError}
 *   - 400 `E_VALIDATION`：`status` / `target` 不在枚举内，或 `limit` 超过 200
 *   - 401 `E_AUTH`：未登录或令牌失效
 *   - 403 `E_FORBIDDEN`：非 admin 或缺 `moderation.ban`
 */
export const listBanneds = (params) => get("/admin/banneds", params);

/**
 * 申诉列表（服务站内信工作台时代的旧入口）。
 *
 * - 接口：`GET /api/admin/appeals`
 * - 鉴权：`kind=mute` 需 `moderation.mute`；`kind=ban` **必须 admin**；
 *   省略 `kind` 时按身份取并集（admin 看两类，staff 只看禁言）
 * - 文档：api-11-moderation-mute.md「`GET /api/admin/appeals`」
 *
 * ⚠ **当前代码未使用**（2026-11-12 站内信合并后）：申诉已并入站内信工作台，
 * 列表与筛选改走 `listMails()` / `getThread()` + `getTicketSummary()`（工单维度），
 * 申诉行数据取自邮件详情内联的 `appeal` 快照。本函数仅保留服务端仍存在的接口，
 *
 * 只列**提过申诉**的主体（`used > 0`），按最近申诉邮件 id 倒序，账号级与队伍级可混排。
 *
 * @param {Object} [params]
 * @param {"ban"|"mute"|"all"} [params.kind="all"] 处罚种类；可见性仍由权限决定
 * @param {"awaiting"|"all"} [params.state="awaiting"] `awaiting` 只给在等官方反馈的（工作台默认）
 * @param {"open"|"pending"|"processing"|"closed"|"done"|"all"} [params.ticket_status="all"]
 *   按最近一条申诉邮件的工单过滤：`open` = pending ∪ processing，`closed` = done
 * @param {"me"|"unassigned"|"all"} [params.ticket_assignee="all"] 我处理的 / 没人接的
 * @param {0|1} [params.ticket_overdue] 只看超时（待处理超 12h / 处理中超 24h，阈值可配置）
 * @param {number} [params.cursor=0] 上一页的 `nextCursor`（最后一行的 `lastAppeal.mailId`）
 * @param {number} [params.limit=20] 每页条数（1–50）
 * @returns {Promise<{ items: AppealRow[], nextCursor: number|null, hasMore: boolean }>} `data` 本体
 * @throws {ApiError}
 *   - 400 `E_VALIDATION`：`kind` / `state` / `limit` 非法
 *   - 401 `E_AUTH`：未登录或令牌失效
 *   - 403 `E_FORBIDDEN`：无 `moderation.mute` 且非 admin；或 `kind=ban` 但非 admin
 */
export const listAppeals = (params) => get("/admin/appeals", params);

/**
 * 回复申诉。
 *
 * - 接口：`POST /api/admin/appeals/:targetType/:targetId/reply`
 * - 鉴权：`kind=ban` → **admin**；`kind=mute` → `moderation.mute`（admin 直通）
 * - 文档：api-11-moderation-mute.md「`POST /api/admin/appeals/:targetType/:targetId/reply`」
 *
 * @param {"account"|"team"} targetType 申诉主体；其它值 → 400
 * @param {number} targetId 账号 id 或队伍 id（**不是**申诉邮件 id）
 * @param {Object} body
 * @param {"ban"|"mute"} [body.kind] `targetType=account` 时必填；
 *   `team` 时可省略（按 `mute` 兼容旧调用），队伍封禁申诉请显式传 `ban`
 * @param {string} body.content 回复正文（1–2000 字）
 * @param {number} [body.ticket_id] 该申诉有未办结工单时**必填**（取列表里的 `ticket.ticketId`），
 *   回复成功即办结该工单；无工单的历史申诉可省略
 * @returns {Promise<AppealReplyResult>} `data` 本体
 * @throws {ApiError}
 *   - 400 `E_VALIDATION`：参数校验失败
 *     detail.fields：
 *       `targetType` -- 不是 `account` / `team`
 *       `targetId` -- 不是正整数
 *       `kind` -- 账号级缺失，或不在 `ban` / `mute`
 *       `content` -- 缺失 / 空 / 超过 2000 字
 *       `ticket_id` -- 有未办结工单时缺失
 *   - 401 `E_AUTH`：未登录或令牌失效
 *   - 403 `E_FORBIDDEN`：权限不足
 *     detail.reason_code：
 *       `空` -- 文案为 `封禁申诉只有 admin 可回复` / `队伍封禁申诉只有 admin 可回复` / `需要 moderation.mute 权限`
 *   - 404 `E_NOT_FOUND`：`该账号没有可回复的申诉` / `该队伍没有可回复的申诉`
 *   - 409 `E_CONFLICT`：工单前置不满足
 *     detail.reason_code：
 *       `TICKET_NOT_CLAIMED` -- 未接单；先调 `claimTicket()`
 *       `TICKET_CLAIMED` -- 被其他 staff 持有（持有者见 `detail.ticket.assignee`）
 *       `TICKET_STALE` -- `ticket_id` 已失效；刷新后重试
 */
export const replyAppeal = (targetType, targetId, body) =>
    post(`/admin/appeals/${targetType}/${targetId}/reply`, body);
