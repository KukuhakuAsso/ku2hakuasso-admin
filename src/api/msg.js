import { del, get, post } from "./http";

/**
 * @file 管理端站内信工作台 / 公告 / 定向通知 / 权限组 / 求提示工作台
 * （api-9-admin.md「站内信与公告接口」「权限组接口」，api-10-tips-hints.md §10.8–§10.16）。
 *
 * 经 `http.request` 调用，返回值已剥掉统一信封，直接是 `data`；失败抛
 * {@link ApiError}（后端 `error` 对象在 `error.detail` 上）。
 *
 * 工单模型：
 * - 工作台按工单分栏：待处理 / 处理中 / 已结束。
 * - **详情 GET 是纯读**，不再「打开即接单」：有处理权限的 staff 必须先 `claimTicket()`，
 *   否则 403 `TICKET_NOT_CLAIMED`；被他人持有则 403 `TICKET_HELD_BY_OTHER`
 *   （同时有 `msg.ticket.read` 时降级为 `200 readOnly:true` 只读预览）。
 * - admin 的 GET 只查看不占位，但**回复前同样要先 claim**。
 * - 权限按工单 kind：普通来信 / 告知回信需 `msg.feedback.handle`、求提示需 `msg.hint.handle`、
 *   禁言申诉需 `moderation.mute`、封禁申诉**仅 admin**。
 * - 回复与求提示动作在有未办结工单时必须带 `ticket_id`，否则 409。
 */

/**
 * 工单对象（列表行、详情、`claim`/`release` 响应里同形）。
 * @typedef {Object} Ticket
 * @property {number} ticketId 工单 id（`claim` / `release` / 动作接口的 `ticket_id` 都用它）
 * @property {number} mailId 工单对应的邮件 id
 * @property {number} rootMailId 会话根邮件 id
 * @property {"mail"|"hint_quote"|"hint_cheaper"|"appeal_mute"|"appeal_ban"} kind
 *   工单种类（决定所需权限）
 * @property {"pending"|"processing"|"done"|"superseded"} status 工单状态
 * @property {{ id: number, username: string }|null} assignee 当前处理人；无人接单为 `null`
 * @property {string|null} claimedAt 接单时间
 * @property {string|null} handledAt 办结时间
 * @property {number|null} handledBy 办结人账号 id
 * @property {number|null} supersededBy 顶替它的新工单 id
 * @property {string} requestedAt 来信（首次请求）时间；待处理计时从这里算
 * @property {0|1} pendingOverdue 待处理是否超时（默认阈值 12h）
 * @property {0|1} processingOverdue 处理中是否超时（默认阈值 24h）
 * @property {0|1} overdue 上述任一超时
 * @property {number} ageHours 已存在小时数
 */

/**
 * 工单分栏计数（`getTicketSummary()` 的 `data`）。
 * @typedef {Object} TicketSummary
 * @property {number} open 待处理 + 处理中
 * @property {number} pending 待接单
 * @property {number} processing 处理中
 * @property {number} closed 已结束（`done` + `superseded`）
 * @property {number} done 已办结
 * @property {number} superseded 被新工单顶替
 * @property {number} pendingOverdue 待处理超时数
 * @property {number} processingOverdue 处理中超时数
 * @property {number} mine 当前处理人是我的工单数（未接单的申诉不计）
 * @property {{ mail: Object, hint: Object, appeal: Object }} byKind
 *   按种类的同形计数；`byKind.appeal` 是 `appeal_mute` + `appeal_ban` 的合并桶（`superseded` 恒 0）
 * @property {{ pendingHours: number, processingHours: number }} sla 超时阈值（小时，可配置）
 * @property {boolean} includeMail 是否把普通来信计入统计（= 有 `msg.feedback.handle`）
 * @property {boolean} includeHint 是否把求提示计入统计（= 有 `msg.hint.handle`）
 * @property {{ ban: boolean, mute: boolean }} includeAppeal 哪些申诉类型被计入
 */

/**
 * 站内信列表行（`threaded=0` 平铺 = 每封一封；`threaded=1` = 每条会话一行）。
 * @typedef {Object} AdminMailRow
 * @property {number} mailId 平铺：这一封的 id；`threaded=1`：会话根 id
 * @property {number} [rootMailId] 仅 `threaded=1`：会话根 id（与 `mailId` 相同）
 * @property {number|null} replyMsgId 直接父邮件；根为 `null`
 * @property {number|null} rootMsgId 线程根；根为 `null`
 * @property {boolean} isRoot 是否根邮件
 * @property {string} channel 频道（`system` / `internal` / `account` / `team`）
 * @property {string} channelName 频道展示名
 * @property {"to_staff"|"to_player"} [direction] 方向；**`threaded=1` 行没有该字段**
 * @property {{ id: number|null, name: string|null, role: string|null }} from 发送者
 * @property {string} subject 主题（threaded 行为根主题）
 * @property {string} [latestSubject] 仅 `threaded=1`：线程最近主题
 * @property {number} subjectLevel 主题层级（0 = 开启新主题基准）
 * @property {string|null} snippet 正文摘要（≤60 字符）；他人持有且无只读权限时为 `null`
 * @property {string} source 来源（`mail`/`feedback`/`hint`/`notice`/`announce`/`warn`/`system`/`appeal_ban`/`appeal_mute`）
 * @property {string} createdAt 创建时间
 * @property {number} replyCount 线程回复数
 * @property {string|null} lastReplyAt 线程最后回复时间
 * @property {0|1} unread 未读标记
 * @property {0|1} answered 我是否回复过
 * @property {0|1} archived 是否归档
 * @property {0|1} hasAttachments 是否有附件
 * @property {0|1} canReply 是否可回复（公告 / 仅通知 / 队伍通知为 `0`）
 * @property {0|1} shared 是否队伍共享
 * @property {string} box 所在文件夹
 * @property {Ticket|null} ticket 该行工单；无工单为 `null`
 * @property {string|null} ticketStatus 工单状态；无工单为 `null`
 * @property {boolean} readOnly 只读预览（有处理权限 + `msg.ticket.read` 且待接单 / 他人持有）
 * @property {Object} [thread] 仅 `threaded=1`：会话摘要（含 `ticket` / `readOnly` 等）
 * @property {Object|null} [hint] `source=hint` 时的求提示快照（`requestId`/`kind`/`status`/`quotedCost`…）
 * @property {number|null} ownerAccountId 归属账号
 * @property {string|null} ownerUsername 归属账号用户名
 * @property {string|null} ownerPlayerNo 归属账号玩家编号
 * @property {number|null} teamId 关联队伍
 * @property {string|null} teamName 关联队伍名
 */

/**
 * 整条会话（`getThread()` 的 `data`，工作台详情）。
 * @typedef {Object} AdminThreadData
 * @property {Object} thread 会话信息：`rootMailId` / `subject` / `latestSubject` / `canReply` /
 *   `messageCount` / `replyCount` / `unreadCount` / `hasAttachments` / `participants[]` / `ticket` / `readOnly`
 * @property {Object[]} messages 邮件（**按时间升序**），每封带正文与附件；
 *   `source=hint` 的另带 `hint` 快照与 `hintQuotes[]`（`reply` 是该次暂存的答案，仅管理端可见），
 *   `source=appeal_*` 的另带 `appeal` 快照
 * @property {boolean} hasMore 是否还有更早的邮件
 * @property {number|null} nextBeforeId 下一页 `before_id`
 * @property {boolean} truncated 是否因超过 200 层被截断
 * @property {boolean} readOnly 只读预览（同上）
 */

/**
 * 公告发布结果（`announce()` 的 `data`，201）。
 * @typedef {Object} AnnounceResult
 * @property {true} announced 固定 `true`
 * @property {number} threadId 全局系统频道会话 id
 * @property {number} msgId 新公告邮件 id
 * @property {string} createdAt 发布时间
 * @property {Object[]} attachments 实际写入的附件；无图时 `[]`
 */

/**
 * 公告历史项（`listAnnouncements()` 的 `items[]`）。
 * @typedef {Object} AnnouncementRow
 * @property {number} id 公告邮件 id（翻页游标）
 * @property {string} subject 主题
 * @property {string} content 正文（历史公告**仍带正文**）
 * @property {"text"|"image"} contentType 正文类型
 * @property {string} createdAt 发布时间
 * @property {Object[]} attachments 附件；无图时 `[]`
 */

/**
 * 定向通知结果（`notifyTargets()` 的 `data`，201）。
 * @typedef {Object} NotifyResult
 * @property {true} sent 固定 `true`（全部成功才写库）
 * @property {number} count 实际发出的封数（= 收件人数）
 * @property {{ type: "account"|"team", id: number, mailId: number }[]} mails
 *   每位收件人一封根邮件：`type` 收件人类型、`id` 账号 / 队伍 id、`mailId` 新邮件 id
 */

/**
 * 内部公告结果（`publishInternalAnnounce()` 的 `data`，201）。
 * @typedef {Object} InternalAnnounceResult
 * @property {true} announced 固定 `true`
 * @property {number} threadId 内部频道会话 id
 * @property {number} msgId 新邮件 id
 * @property {string} createdAt 发布时间
 */

/**
 * 权限目录（`listPermissions()` 的 `data`）。
 * @typedef {Object} PermissionCatalog
 * @property {{ code: string, title?: string, description?: string }[]} permissions 权限码目录
 * @property {{ code: string, title?: string, permissions?: string[] }[]} groups 权限组
 */

/**
 * 某账号的权限（`getAccountPermissions()` 的 `data`）。
 * @typedef {Object} AccountPermissions
 * @property {number} accountId 账号 id
 * @property {"player"|"staff"|"admin"} role 角色
 * @property {boolean} byRole `true` = admin 由角色获得全部权限（不依赖授权组）
 * @property {string[]} groups 已授权组 code
 * @property {string[]} permissions 生效的权限码清单
 */

/**
 * 求提示请求行（`listHintRequests()` 的 `items[]`）。
 * @typedef {Object} HintRequestRow
 * @property {number} id 请求 id（动作接口的 `:id`）
 * @property {"pending"|"quoted"|"answered"|"rejected"|"closed"} status 状态机
 * @property {string} question 提问正文
 * @property {number|null} quotedCost 当前报价
 * @property {number|null} cost 已扣费用（未确认时 `null`）
 * @property {number|null} questionMailId 提问邮件 id
 * @property {number|null} cheaperMailId 还价邮件 id
 * @property {number|null} quoteMailId 最近一次报价 / 改价邮件 id
 * @property {number} [quoteCount] 报价 / 改价邮件总数
 * @property {Ticket|null} ticket 对应工单
 * @property {string} [ticketStatus] 工单状态
 * @property {boolean} [readOnly] 是否只读预览
 */

/**
 * 求提示动作（报价 / 改价 / 拒绝降价 / 拒绝）的 `data`。
 * @typedef {Object} HintActionResult
 * @property {number} requestId 求提示请求 id
 * @property {string} status 动作后的状态
 * @property {number} [quoteId] 报价记录 id（quote / requote）
 * @property {number} [quoteMailId] 本次写入的报价邮件 id（quote / requote）
 * @property {number} [mailId] 本次写入的交互邮件 id（decline-cheaper / reject）
 */

/**
 * `http.request` 抛出的接口错误；后端 `error` 对象挂在 `error.detail` 上。
 * @typedef {import("./http").ApiError} ApiError
 */

/**
 * 读取工单分栏计数（侧栏角标与「待处理 / 处理中 / 已结束」计数）。
 *
 * - 接口：`GET /api/admin/msg/tickets/summary`
 * - 鉴权：需要访问令牌 + staff；**只由处理权限决定**（`msg.ticket.read` 不参与统计，
 *   只读-only 的 staff 三桶全 0；admin 全量）
 * - 文档：api-9-admin.md「`GET /api/admin/msg/tickets/summary`」
 *
 * @returns {Promise<TicketSummary>} `data` 本体
 * @throws {ApiError}
 *   - 401 `E_AUTH`：未登录或令牌失效
 *   - 403 `E_FORBIDDEN`：角色不足（不是 staff / admin）
 */
export const getTicketSummary = () => get("/admin/msg/tickets/summary");

/**
 * 接单（`pending` → `processing`）。
 *
 * - 接口：`POST /api/admin/msg/tickets/:ticketId/claim`
 * - 鉴权：按工单 `kind` 判权（`mail` 按来源同回复口径、`hint_*` 需 `msg.hint.handle`、
 *   `appeal_mute` 需 `moderation.mute`、`appeal_ban` 仅 admin；admin 直通）
 * - 文档：api-9-admin.md「`POST /api/admin/msg/tickets/:ticketId/claim` / `.../release`」
 *
 * @param {number} ticketId 工单 id（来自列表行的 `ticket.ticketId`）
 * @returns {Promise<{ ticket: Ticket }>} `data` 本体
 * @throws {ApiError}
 *   - 401 `E_AUTH`：未登录或令牌失效
 *   - 403 `E_FORBIDDEN`：无该 kind 的处理权限
 *   - 404 `E_NOT_FOUND`：工单不存在
 *   - 409 `E_CONFLICT`：工单已被他人持有
 *     detail.reason_code：
 *       `TICKET_CLAIMED` -- 他人处理中；`detail.ticket` 给当前工单与处理人（需 admin 先 release 强制退回）
 */
export const claimTicket = (ticketId) =>
  post(`/admin/msg/tickets/${ticketId}/claim`);

/**
 * 退出 / 标记未处理（`processing` → `pending` 并清处理人）。
 *
 * - 接口：`POST /api/admin/msg/tickets/:ticketId/release`
 * - 鉴权：本人或 admin（admin 可强制退回他人的工单）
 * - 文档：api-9-admin.md「`POST /api/admin/msg/tickets/:ticketId/claim` / `.../release`」
 *
 * ⚠ 退出后**待处理计时不重置**，超时仍按最初来信时间计算。
 *
 * @param {number} ticketId 工单 id
 * @returns {Promise<{ ticket: Ticket }>} `data` 本体
 * @throws {ApiError}
 *   - 401 `E_AUTH`：未登录或令牌失效
 *   - 403 `E_FORBIDDEN`：既不是持单人也不是 admin
 *   - 404 `E_NOT_FOUND`：工单不存在
 *   - 409 `E_CONFLICT`：工单不处于处理中
 *     detail.reason_code：
 *       `TICKET_NOT_PROCESSING` -- 当前状态不是 `processing`
 */
export const releaseTicket = (ticketId) =>
  post(`/admin/msg/tickets/${ticketId}/release`);

/**
 * 邮件 / 会话列表（工作台主列表，`threaded=1` 一条会话一行）。
 *
 * - 接口：`GET /api/admin/msg/mails`
 * - 鉴权：需要访问令牌 + staff；可见范围按邮件来源权限（admin 或有 `msg.feedback.handle`
 *   的 staff 可见全部；无该权限的 staff 只能看到公告类频道）
 * - 文档：api-9-admin.md「`GET /api/admin/msg/mails`」
 *
 * @param {Object} [params]
 * @param {number} [params.cursor=0] 上一页 `nextCursor`（`threaded=1` 时为不透明串）
 * @param {number} [params.since_id] 大于 0 时按 id 正序拉新；与 `threaded=1` 互斥
 * @param {number} [params.limit=20] 每页条数（1–50）
 * @param {"system"|"internal"|"account"|"team"} [params.channel] 频道过滤
 * @param {string} [params.source] 来源过滤（`mail` / `feedback` / `hint` / `notice` / `appeal_*` 等）
 * @param {0|1} [params.answered] 按「我是否回复过」过滤
 * @param {"inbox"|"sent"|"archive"|"all"} [params.box="all"] 文件夹（管理端默认全部）
 * @param {boolean} [params.only_unread] 只看未读
 * @param {0|1} [params.threaded=1] `1` = 按线程聚合（工作台用），`0` = 每封一行
 * @param {number} [params.owner_account_id] 按归属账号过滤
 * @param {number} [params.owner_team_id] 按归属队伍过滤
 * @param {string} [params.since] 创建时间下限
 * @param {string} [params.until] 创建时间上限
 * @param {"open"|"closed"|"pending"|"processing"|"done"|"superseded"|"all"} [params.ticket_status]
 *   `open` = pending ∪ processing；`closed` = done ∪ superseded
 * @param {"me"|"unassigned"|"all"} [params.ticket_assignee] 我处理中 / 没人接 / 全部
 * @param {boolean|0|1} [params.ticket_overdue] 只看超时（待处理超 12h 或 处理中超 24h）
 * @returns {Promise<{ items: AdminMailRow[], nextCursor: number|string|null, hasMore: boolean }>}
 *   `data` 本体
 * @throws {ApiError}
 *   - 400 `E_VALIDATION`：参数非法（如 `since_id` 与 `threaded=1` 同用、`limit` 越界）
 *   - 401 `E_AUTH`：未登录或令牌失效
 *   - 403 `E_FORBIDDEN`：角色不足或被封禁
 */
export const listMails = (params) => get("/admin/msg/mails", params);

/**
 * 整条会话（工作台详情）。
 *
 * - 接口：`GET /api/admin/msg/threads/:rootId`
 * - 鉴权：需要访问令牌 + 对应来源的处理权限；**纯读、不自动接单**（须先 `claimTicket()`）
 * - 文档：api-9-admin.md「`GET /api/admin/msg/threads/:rootId`」
 *
 * ⚠ `mark_read` 目前必须显式传 `1`：不传或传 `0` 时后端返回 500 `E_INTERNAL`
 * （文档写的是可选，属后端缺陷），因此本封装默认注入 `mark_read: 1`。
 *
 * @param {number} rootId 会话根邮件 id
 * @param {Object} [params]
 * @param {number} [params.limit] 本页最多返回多少封（1–200，默认 100）
 * @param {number} [params.before_id] 取更早的一页（传上一页 `nextBeforeId`）
 * @param {0|1} [params.mark_read=1] `1` = 把整条线程可见未读全部标已读（不受本页 limit 影响）
 * @returns {Promise<AdminThreadData>} `data` 本体
 * @throws {ApiError}
 *   - 401 `E_AUTH`：未登录或令牌失效
 *   - 403 `E_FORBIDDEN`：无处理权限
 *     detail.reason_code：
 *       `TICKET_NOT_CLAIMED` -- 有处理权限但未接单
 *       `TICKET_HELD_BY_OTHER` -- 被其他 staff 持有（有 `msg.ticket.read` 时降级为 `200 readOnly`）
 *   - 404 `E_NOT_FOUND`：会话不存在，或 `rootId` 不是会话根
 */
export const getThread = (rootId, params) =>
  get(`/admin/msg/threads/${rootId}`, { mark_read: 1, ...params });

/**
 * 单封邮件详情（自身 + 祖先链）。
 *
 * - 接口：`GET /api/admin/msg/mails/:id`
 * - 鉴权：需要访问令牌 + 对应来源的处理权限；纯读、须先 `claimTicket()`
 * - 文档：api-9-admin.md「`GET /api/admin/msg/mails/:id`」
 *
 * 本接口属于半弃用状态，由于站内信工单化现状，不能按照原有的单封邮件工作流处理。
 * 工作台详情已改用 `getThread()`；本接口主要留给「深链进来的 id 不是会话根」时反查根 id。
 * 口径同 `getThread()`：返回 `ticket` / `threadTicket` / `readOnly`，
 * 以及 `mail.appeal` / `mail.hint` / `mail.hintQuotes[]`。
 *
 * @param {number} id 邮件 id（任意一封）
 * @returns {Promise<Object>} `data` 本体：`mail`（这一封，含正文与附件）+ `replyChain`（祖先链，时间倒序）
 *   + `truncated`（祖先超过 200 层）+ `ticket` / `threadTicket` / `readOnly`
 * @throws {ApiError}
 *   - 401 `E_AUTH`：未登录或令牌失效
 *   - 403 `E_FORBIDDEN`：无处理权限（`TICKET_NOT_CLAIMED` / `TICKET_HELD_BY_OTHER` 同上）
 *   - 404 `E_NOT_FOUND`：邮件不存在
 */
export const getMail = (id) => get(`/admin/msg/mails/${id}`);

/**
 * 官方回复（主题由服务端生成「回复：<根主题>」）。
 *
 * - 接口：`POST /api/admin/msg/mails/:id/reply`
 * - 鉴权：按邮件来源判权（普通信件 / 反馈 / 通知回信需 `msg.feedback.handle`；admin 直通）
 * - 文档：api-9-admin.md「`POST /api/admin/msg/mails/:id/reply`」
 *
 * 有未办结工单时**必须带 `ticket_id`**，回复成功即办结该工单。
 * 求提示与申诉邮件**不能**用它回复：分别返回 `HINT_REPLY_CLOSED` / `APPEAL_REPLY_CLOSED`，
 * 应改走 `quoteHint()` 系列与 `replyAppeal()`。
 *
 * @param {number} id 被回复的邮件 id（工作台里传会话最后一封）
 * @param {Object} body
 * @param {string} body.content 回复正文（1–2000 字）
 * @param {number} [body.ticket_id] 该会话有未办结工单时必填（取 `ticket.ticketId`）
 * @returns {Promise<{ mailId: number, rootMsgId: number, channel: string, createdAt: string,
 *   ticketId?: number, ticketStatus?: string }>} `data` 本体
 * @throws {ApiError}
 *   - 400 `E_VALIDATION`：正文缺失 / 超长，或有未办结工单时缺 `ticket_id`
 *   - 401 `E_AUTH`：未登录或令牌失效
 *   - 403 `E_FORBIDDEN`：无处理权限；或邮件不可回复
 *     detail.reason_code：
 *       `HINT_REPLY_CLOSED` -- 求提示邮件走报价 / 答复流程
 *       `APPEAL_REPLY_CLOSED` -- 申诉邮件走 `replyAppeal()`
 *       `NOTICE_REPLY_CLOSED` -- 仅通知（`allow_reply=false`）链已封口
 *   - 404 `E_NOT_FOUND`：邮件不存在
 *   - 409 `E_CONFLICT`：工单前置不满足
 *     detail.reason_code：
 *       `TICKET_NOT_CLAIMED` -- 未接单
 *       `TICKET_CLAIMED` -- 被他人持有
 *       `TICKET_STALE` -- `ticket_id` 已失效，刷新后回复最新一封
 */
export const replyMail = (id, body) =>
  post(`/admin/msg/mails/${id}/reply`, body);

/**
 * 逐封已读（**玩家端**接口，非管理端）。
 *
 * - 接口：`POST /api/msg/mails/:id/read`（注意：**没有** `/admin` 前缀）
 * - 鉴权：按玩家端规则（本人可见的邮件）
 * - 文档：api-8-message-mail.md §8.5
 *
 * ⚠ **当前代码未使用**：工作台详情改用 `getThread()` 后由 `mark_read=1` 整条会话标记，
 * 管理端也没有单封已读的专用接口（批量是 `POST /api/admin/msg/mails/read`）。
 * 保留仅为兼容旧调用；新增功能请勿使用，确认无外部调用后可删除。
 *
 * @deprecated 管理端不使用；且本函数打的是玩家端路径，与管理端其余接口不同源（仅共用 `/api` 前缀）。
 * @param {number} id 邮件 id
 * @returns {Promise<Object>} 玩家端响应 `data`：`{ mailId, unread: 0, readAt }`
 * @throws {ApiError}
 *   - 401 `E_AUTH`：未登录或令牌失效
 *   - 403 `E_FORBIDDEN`：无权操作这一封
 *   - 404 `E_NOT_FOUND`：邮件不存在
 */
export const markMailRead = (id) => post(`/msg/mails/${id}/read`);

/**
 * 发布官方公告（发给所有登录用户）。
 *
 * - 接口：`POST /api/admin/msg/announce`
 * - 鉴权：需要访问令牌 + `msg.announce.publish`（admin 直通）
 * - 文档：api-9-admin.md「`POST /api/admin/msg/announce`」
 *
 * 公告写入全局系统频道（`channel=system`），**发布后不可撤回**；带附件时正文与附件
 * 要么一起写入、要么整条不写。
 *
 * @param {Object} body
 * @param {string} body.subject 主题（1–80 字）
 * @param {string} body.content 正文（1–2000 字）
 * @param {Object[]} [body.attachments] 可选图片（≤3 张 jpg/png/webp、单张 ≤5MiB），
 *   元素 `{ objectKey, filename, mime, sizeBytes }`，先调 `POST /api/msg/media/sign`
 * @returns {Promise<AnnounceResult>} `data` 本体（201）
 * @throws {ApiError}
 *   - 400 `E_VALIDATION`：主题 / 正文缺失或越界，或附件不合法
 *     detail.fields：
 *       `subject` -- 缺失 / 超过 80 字
 *       `content` -- 缺失 / 超过 2000 字
 *   - 401 `E_AUTH`：未登录或令牌失效
 *   - 403 `E_FORBIDDEN`：缺 `msg.announce.publish`
 */
export const announce = (body) => post("/admin/msg/announce", body);

/**
 * 官方公告历史（**仍带正文**，列表不套用「只给主题」的规则）。
 *
 * - 接口：`GET /api/admin/msg/announcements`
 * - 鉴权：需要访问令牌 + staff 及以上
 * - 文档：api-9-admin.md「`GET /api/admin/msg/announcements`」
 *
 * @param {Object} [params]
 * @param {number} [params.cursor=0] 按 id 倒序翻页（传上一页 `nextCursor`）
 * @param {number} [params.limit=50] 每页条数（1–100）
 * @returns {Promise<{ items: AnnouncementRow[], nextCursor: number|null, hasMore: boolean }>} `data` 本体
 * @throws {ApiError}
 *   - 400 `E_VALIDATION`：`limit` 越界
 *   - 401 `E_AUTH`：未登录或令牌失效
 *   - 403 `E_FORBIDDEN`：角色不足
 */
export const listAnnouncements = (params) =>
  get("/admin/msg/announcements", params);

/**
 * 定向通知：向指定账号 / 队伍各发一封根邮件。
 *
 * - 接口：`POST /api/admin/msg/notify`
 * - 鉴权：需要访问令牌 + `msg.notify.send`（admin 直通；内置组 `staff.duty.notify` 自带）
 * - 文档：api-9-admin.md「`POST /api/admin/msg/notify`」
 *
 * 两个收件人列表**至少一个非空**，去重后合计 ≤50；全部成功才写库（要么全发、要么一封不发）。
 * 来源 `notice`，发送者是操作者（玩家侧看到真实 staff 用户名）。
 * 目标的禁言 / 封禁**不影响送达**；队伍已解散则 `409`。
 *
 * @param {Object} body
 * @param {number[]} [body.account_ids] 账号 id 列表（`account.id`，不是 `player_no`）
 * @param {number[]} [body.team_ids] 队伍 id 列表
 * @param {string} body.subject 主题（1–80 字）
 * @param {string} body.content 正文（1–2000 字）
 * @param {boolean} [body.allow_reply=true] `false` = **仅通知**：整条链封口，收件人不能再回复
 *   （`canReply=0`，回复 `403` + `detail.reason_code="NOTICE_REPLY_CLOSED"`），且不支持事后修改；
 *   **队伍收件人恒为仅通知**，该字段只对账号收件人生效
 * @param {Object[]} [body.attachments] 可选图片（≤3 张），元素 `{ objectKey, filename, mime, sizeBytes }`
 * @returns {Promise<NotifyResult>} `data` 本体（201）
 * @throws {ApiError}
 *   - 400 `E_VALIDATION`：两个列表都为空、收件人合计超过 50、主题 / 正文不合法
 *     detail.fields：
 *       `subject` -- 缺失 / 超过 80 字
 *       `content` -- 缺失 / 超过 2000 字
 *   - 401 `E_AUTH`：未登录或令牌失效
 *   - 403 `E_FORBIDDEN`：缺 `msg.notify.send`
 *   - 404 `E_NOT_FOUND`：收件人（账号或队伍）不存在
 *   - 409 `E_CONFLICT`：目标队伍已解散（文案带目标 id，如 `队伍已解散，无法发送: 7`）
 */
export const notifyTargets = (body) => post("/admin/msg/notify", body);

/**
 * 发布内部公告（仅 staff / admin 可见）。
 *
 * - 接口：`POST /api/admin/msg/internal-announce`
 * - 鉴权：**仅 admin**（角色硬门槛，不挂权限码）
 * - 文档：api-9-admin.md「`POST /api/admin/msg/internal-announce`」
 *
 * @param {Object} body
 * @param {string} body.subject 主题（1–80 字）
 * @param {string} body.content 正文（1–2000 字）
 * @param {Object[]} [body.attachments] 可选图片（≤3 张），元素 `{ objectKey, filename, mime, sizeBytes }`
 * @returns {Promise<InternalAnnounceResult>} `data` 本体（201）
 * @throws {ApiError}
 *   - 400 `E_VALIDATION`：主题 / 正文缺失或越界
 *   - 401 `E_AUTH`：未登录或令牌失效
 *   - 403 `E_FORBIDDEN`：不是 admin（staff 也会被拒）
 */
export const publishInternalAnnounce = (body) =>
  post("/admin/msg/internal-announce", body);

/**
 * 读取权限目录与权限组（admin）。
 *
 * - 接口：`GET /api/admin/permissions`
 * - 鉴权：**仅 admin**
 * - 文档：api-9-admin.md「权限组接口」
 *
 * @returns {Promise<PermissionCatalog>} `data` 本体
 * @throws {ApiError}
 *   - 401 `E_AUTH`：未登录或令牌失效
 *   - 403 `E_FORBIDDEN`：不是 admin
 */
export const listPermissions = () => get("/admin/permissions");

/**
 * 读取某账号的权限（admin）。
 *
 * - 接口：`GET /api/admin/accounts/:id/permissions`
 * - 鉴权：**仅 admin**
 * - 文档：api-9-admin.md「权限组接口」
 *
 * @param {number} id 账号 id
 * @returns {Promise<AccountPermissions>} `data` 本体
 * @throws {ApiError}
 *   - 401 `E_AUTH`：未登录或令牌失效
 *   - 403 `E_FORBIDDEN`：不是 admin
 *   - 404 `E_NOT_FOUND`：账号不存在
 */
export const getAccountPermissions = (id) =>
  get(`/admin/accounts/${id}/permissions`);

/**
 * 给账号授予权限组（admin，幂等）。
 *
 * - 接口：`POST /api/admin/accounts/:id/permissions`
 * - 鉴权：**仅 admin**
 * - 文档：api-9-admin.md「权限组接口」
 *
 * @param {number} id 账号 id
 * @param {string} groupCode 权限组 code（如 `staff.duty.msg`）
 * @returns {Promise<{ granted: boolean, accountId?: number, groupCode?: string,
 *   permissions?: string[] }>} `data` 本体：新授权 `granted: true`（201），已存在幂等 `granted: false`（200）
 * @throws {ApiError}
 *   - 401 `E_AUTH`：未登录或令牌失效
 *   - 403 `E_FORBIDDEN`：不是 admin
 *   - 404 `E_NOT_FOUND`：账号或权限组不存在
 */
export const grantPermissionGroup = (id, groupCode) =>
  post(`/admin/accounts/${id}/permissions`, { group_code: groupCode });

/**
 * 撤销账号的权限组（admin）。
 *
 * - 接口：`DELETE /api/admin/accounts/:id/permissions/:group_code`
 * - 鉴权：**仅 admin**
 * - 文档：api-9-admin.md「权限组接口」
 *
 * @param {number} id 账号 id
 * @param {string} groupCode 权限组 code
 * @returns {Promise<{ revoked: boolean, accountId: number, groupCode: string,
 *   permissions: string[] }>} `data` 本体；未授予该组时 `revoked: false`（仍为成功）
 * @throws {ApiError}
 *   - 401 `E_AUTH`：未登录或令牌失效
 *   - 403 `E_FORBIDDEN`：不是 admin
 *   - 404 `E_NOT_FOUND`：账号或权限组不存在
 */
export const revokePermissionGroup = (id, groupCode) =>
  del(`/admin/accounts/${id}/permissions/${groupCode}`);

/**
 * 求提示请求列表（待报价队列）。
 *
 * - 接口：`GET /api/admin/msg/hint-requests`
 * - 鉴权：需要访问令牌 + `msg.hint.handle`
 * - 文档：api-10-tips-hints.md §10.8
 *
 * ⚠ **当前代码未使用**（2026-11-12 站内信合并后）：求提示工作台已由 mail 线程承载
 * （`listMails({ source: "hint" })` + `getThread()` 读 `mail.hint` 快照），
 * 报价 / 改价 / 拒绝降价 / 拒绝仍由 `quoteHint()` 等在本文件内发起。
 * 本函数保留服务端接口与字段口径（与 `mail.hint` 同形），便于联调与将来做独立视图；
 * 新增功能请勿依赖，确认无外部调用后可删除。
 *
 * @deprecated 站内信合并后无调用方。
 * @param {Object} [params]
 * @param {"pending"|"quoted"|"answered"|"rejected"|"closed"|"all"} [params.status="pending"]
 *   默认只看待报价队列
 * @param {number} [params.cursor=0] 上一页 `nextCursor`
 * @param {number} [params.limit=50] 每页条数（最大 100）
 * @param {"open"|"pending"|"processing"|"closed"|"done"|"all"} [params.ticket_status] 工单状态过滤
 * @param {boolean|0|1} [params.ticket_overdue] 只看超时
 * @returns {Promise<{ items: HintRequestRow[], nextCursor: number|null, hasMore: boolean }>} `data` 本体
 * @throws {ApiError}
 *   - 401 `E_AUTH`：未登录或令牌失效
 *   - 403 `E_FORBIDDEN`：缺 `msg.hint.handle`
 */
export const listHintRequests = (params) =>
  get("/admin/msg/hint-requests", params);

/**
 * 求提示详情。
 *
 * - 接口：`GET /api/admin/msg/hint/:id`
 * - 鉴权：需要访问令牌 + `msg.hint.handle`；纯读、**不自动接单**（须先 `claimTicket()`）
 * - 文档：api-10-tips-hints.md §10.9、api-9-admin.md「`GET /api/admin/msg/hint/:id`」
 *
 * ⚠ **当前代码未使用**（2026-11-12 站内信合并后）：详情改由 `getThread()` 提供，
 * 其中每封邮件的 `hint` 快照与 `hintQuotes[]` 已含报价历史与暂存答案。
 * 保留以便联调；确认无外部调用后可删除。
 *
 * @deprecated 站内信合并后无调用方。
 * @param {number} id 求提示请求 id
 * @returns {Promise<Object>} `data` 本体：请求字段 + `questionMailId` / `cheaperMailId` +
 *   `quotes[]`（每次报价一行，`reply` 是该次暂存答案，仅管理端可见）+ `ticket` + `readOnly`
 * @throws {ApiError}
 *   - 401 `E_AUTH`：未登录或令牌失效
 *   - 403 `E_FORBIDDEN`：缺 `msg.hint.handle`；或未接单 / 被他人持有
 *     detail.reason_code：
 *       `TICKET_NOT_CLAIMED` -- 有处理权限但未接单
 *       `TICKET_HELD_BY_OTHER` -- 被其他 staff 持有
 *   - 404 `E_NOT_FOUND`：请求不存在
 */
export const getHintRequest = (id) => get(`/admin/msg/hint/${id}`);

/**
 * 报价（报价即受理，释放该队「待报价」名额）。
 *
 * - 接口：`POST /api/admin/msg/hint/:id/quote`
 * - 鉴权：需要访问令牌 + `msg.hint.handle`；必须已接单
 * - 文档：api-10-tips-hints.md §10.9
 *
 * @param {number} id 求提示请求 id
 * @param {Object} body
 * @param {number} body.cost 报价点数（0–1000000 的整数）
 * @param {string} body.reply 暂存答复（1–2000 字，玩家确认后才可见）
 * @param {number} body.ticket_id 工单 id（必填，未接单或缺失 → 409）
 * @returns {Promise<HintActionResult>} `data` 本体（含 `quoteId` / `quoteMailId`）
 * @throws {ApiError}
 *   - 400 `E_VALIDATION`：`cost` / `reply` 不合法
 *     detail.fields：
 *       `cost` -- 不是 0–1000000 的整数
 *       `reply` -- 缺失 / 空 / 超过 2000 字
 *   - 401 `E_AUTH`：未登录或令牌失效
 *   - 403 `E_FORBIDDEN`：缺 `msg.hint.handle`，或该工单不归自己
 *   - 404 `E_NOT_FOUND`：请求不存在
 *   - 409 `E_CONFLICT`：工单前置不满足（`TICKET_NOT_CLAIMED` / `TICKET_CLAIMED` / `TICKET_STALE`）/
 *     请求状态已处理
 */
export const quoteHint = (id, body) =>
  post(`/admin/msg/hint/${id}/quote`, body);

/**
 * 同意降价并改回答（玩家申请更便宜后使用）。
 *
 * - 接口：`POST /api/admin/msg/hint/:id/requote`
 * - 鉴权：需要访问令牌 + `msg.hint.handle`；必须已接单
 * - 文档：api-10-tips-hints.md §10.9b
 *
 * @param {number} id 求提示请求 id
 * @param {Object} body
 * @param {number} body.cost 新报价（必须严格低于当前报价）
 * @param {string} body.reply 更新后的暂存答复（必填）
 * @param {number} body.ticket_id 工单 id（必填）
 * @returns {Promise<HintActionResult>} `data` 本体（含 `quoteId` / `quoteMailId`）
 * @throws {ApiError}
 *   - 400 `E_VALIDATION`：新价不低于当前价（`detail.fields.cost`）或答复不合法
 *   - 401 `E_AUTH`：未登录或令牌失效
 *   - 403 `E_FORBIDDEN`：缺 `msg.hint.handle`
 *   - 404 `E_NOT_FOUND`：请求不存在
 *   - 409 `E_CONFLICT`：`玩家还没有申请更便宜` / `该申请已处理` / 工单前置不满足
 */
export const requoteHint = (id, body) =>
  post(`/admin/msg/hint/${id}/requote`, body);

/**
 * 拒绝降价（＝把当前报价标记为最低报价）。
 *
 * - 接口：`POST /api/admin/msg/hint/:id/decline-cheaper`
 * - 鉴权：需要访问令牌 + `msg.hint.handle`；必须已接单
 * - 文档：api-10-tips-hints.md §10.9c
 *
 * @param {number} id 求提示请求 id
 * @param {Object} body
 * @param {number} body.ticket_id 工单 id（必填）
 * @returns {Promise<HintActionResult>} `data` 本体（含 `mailId`）
 * @throws {ApiError}
 *   - 401 `E_AUTH`：未登录或令牌失效
 *   - 403 `E_FORBIDDEN`：缺 `msg.hint.handle`
 *   - 404 `E_NOT_FOUND`：请求不存在
 *   - 409 `E_CONFLICT`：`该申请已处理` / 工单前置不满足
 */
export const declineCheaperHint = (id, body) =>
  post(`/admin/msg/hint/${id}/decline-cheaper`, body);

/**
 * 拒绝求提示请求。
 *
 * - 接口：`POST /api/admin/msg/hint/:id/reject`
 * - 鉴权：需要访问令牌 + `msg.hint.handle`；必须已接单
 * - 文档：api-10-tips-hints.md §10.10
 *
 * @param {number} id 求提示请求 id
 * @param {Object} body
 * @param {string} [body.reason] 拒绝原因（≤200 字）
 * @param {number} body.ticket_id 工单 id（必填）
 * @returns {Promise<HintActionResult>} `data` 本体（含 `mailId`）
 * @throws {ApiError}
 *   - 400 `E_VALIDATION`：`reason` 超过 200 字
 *   - 401 `E_AUTH`：未登录或令牌失效
 *   - 403 `E_FORBIDDEN`：缺 `msg.hint.handle`
 *   - 404 `E_NOT_FOUND`：请求不存在
 *   - 409 `E_CONFLICT`：`该请求已处理` / 工单前置不满足
 */
export const rejectHint = (id, body) =>
  post(`/admin/msg/hint/${id}/reject`, body);

// 禁言 / 封禁 / 申诉已迁到 ./moderation.js（2026-10-17 重构：
// 旧的 /admin/msg/ban|unban 与 /admin/appeals/:accountId/reply 路径已不存在）。
