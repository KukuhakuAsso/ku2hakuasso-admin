import { del, get, post } from "./http";

// ---------- 工单（2026-11-12 迁移 0041 起；2.2.0 起含申诉） ----------
//
// 管理端站内信改为工单式工作台：全局「待处理 / 处理中 / 已处理」。
// 2.2.0 起详情 GET 是**纯读**：不再「打开即接单」，有处理权限的 staff 必须先 claim
//（未持有 pending → 403 TICKET_NOT_CLAIMED，被他人持有 → 403 TICKET_HELD_BY_OTHER）；
// admin 的 GET 只查看不占位，但**回复前同样要先 claim**。
// 权限按工单 kind：普通来信 / 告知回信需 msg.feedback.handle、求提示需 msg.hint.handle、
// 禁言申诉需 moderation.mute、封禁申诉仅 admin。
// 回复与求提示动作都要带 ticket_id（有未办结工单时必填），否则 409 TICKET_NOT_CLAIMED 等。

// 分栏计数：open / pending / processing / closed / done / superseded、
// pendingOverdue / processingOverdue、mine、byKind.{mail,hint,appeal}、sla；
// 另含 includeMail / includeHint / includeAppeal（哪些类型被计入，只由处理权限决定，
// msg.ticket.read 不参与统计）。
export const getTicketSummary = () => get("/admin/msg/tickets/summary");

// 接单（pending → processing；本人重复调用幂等；被他人持有 → 409 TICKET_CLAIMED）。
// 权限按工单 kind（appeal_ban 仅 admin、appeal_mute 需 moderation.mute）。
// staff 不能抢占他人处理中的工单：改派只能由 admin 先 release 再 claim，计时不重置。
export const claimTicket = (ticketId) =>
  post(`/admin/msg/tickets/${ticketId}/claim`);

// 退出 / 标记未处理（processing → pending 并清处理人；admin 可强制退回他人）。
// 注意：退出后待处理计时不重置，超时仍按最初来信时间计算。
export const releaseTicket = (ticketId) =>
  post(`/admin/msg/tickets/${ticketId}/release`);

// ---------- 站内信工作台（邮件式，2026-10-14 起取代旧的 /msg/threads） ----------

// 邮件列表：管理端工作台用 threaded=1 —— 一条会话一行，行内带 thread 子对象，
// 「已处理 / 全部」里同一会话不会再重复成多行（平铺 threaded=0 时每封邮件一行）。
// 工单过滤（迁移 0041）：ticket_status=open|closed|pending|processing|done|superseded|all、
// ticket_assignee=me|unassigned|all、ticket_overdue=1。
// threaded 行：mailId / rootMailId 都是会话根，另有 latestSubject、replyCount，以及
//   thread{rootMailId, subject, latestSubject, snippet, replyCount, messageCount,
//          unreadCount, from, ticket, readOnly}；
// 顶层同样带 ticket / ticketStatus / readOnly / hint（threaded 行**没有** direction）。
// 2.2.0 起行内另含 readOnly（处理权限 + msg.ticket.read 时，待处理/他人持有的行可预览），
// source=hint 的行还带 hint 七字段快照（requestId / kind / status / quotedCost …）。
export const listMails = (params) => get("/admin/msg/mails", params);

// 整条会话（工作台详情）：thread（会话信息 + ticket）+ messages[]（按时间**升序**，
// 每封都带正文与附件）+ hasMore / nextBeforeId（向更早翻页）+ readOnly。
// 求提示 / 申诉相关的份量也都在会话里：每封另带 hint（求提示 7 字段快照）、
// hintQuotes[]（历次报价 + 该次暂存答案）、appeal（申诉 6 字段快照）——
// 工作台的动作面板与「查看历史提示」直接读这里，不用再补一次单封详情。
// 2.2.0 起**纯读、不自动接单**；readOnly=true = 只读预览（有处理权限 + msg.ticket.read，
// 或 admin 看别人手上的工单），此时能看正文但不能回复 / 报价 / 回复申诉。
// rootId 只认会话根（拿中间某一封的 id 会 404）；mark_read 目前必须显式传 1，
// 不传或传 0 后端返回 500 E_INTERNAL（文档写的是可选，属于后端 bug）。
export const getThread = (rootId, params) =>
  get(`/admin/msg/threads/${rootId}`, { mark_read: 1, ...params });

// 单封邮件详情：mail（请求的那封自己）+ replyChain（祖先链，时间倒序、不含后续回复）。
// 工作台详情已改用 getThread()，这里只留给「深链进来的 id 不是会话根」时反查根 id。
// 口径同 getThread：纯读、须先 claim，并返回 ticket / threadTicket、readOnly、
// mail.appeal（申诉 6 字段快照）、mail.hint（求提示快照）、mail.hintQuotes[]——
// 这三样 getThread 的 messages[] 上也有，工作台不再依赖本接口取它们。
export const getMail = (id) => get(`/admin/msg/mails/${id}`);

// 官方回复：主题由服务端生成（回复：<根主题>），正文之外要带 ticket_id
//（有未办结工单时必填）。响应新增 ticketId / ticketStatus。
// 注意：source=hint 的邮件 403 HINT_REPLY_CLOSED（走报价/答复流程）；
// source=appeal_* 的邮件 403 APPEAL_REPLY_CLOSED（走 /admin/appeals/:targetType/:targetId/reply）。
export const replyMail = (id, body) =>
  post(`/admin/msg/mails/${id}/reply`, body);

// 逐封已读（POST /api/msg/mails/:id/read，与玩家端同一个接口）：
// 无请求体、幂等、只标记这一封（不影响它回复过的链、也不影响同对话其它记录）。
// 工作台详情改用 getThread() 后由 mark_read=1 整条会话标记，这里留给其它页面按封标记。
export const markMailRead = (id) => post(`/msg/mails/${id}/read`);

// ---------- 公告 ----------

// 发布官方公告：subject（1–80）与 content（1–2000）都必填
export const announce = (body) => post("/admin/msg/announce", body);

// 历史公告（仍带正文，不套用「只给主题」的规则）
export const listAnnouncements = (params) =>
  get("/admin/msg/announcements", params);

// ---------- 定向通知（2026-10-17 起，迁移 0027） ----------

// 向指定接收人发信：{ account_ids?, team_ids?, subject(1..80), content(1..2000), allow_reply? }
// 两个列表至少一个非空，去重后合计 ≤ 50；每位收件人各得一封根邮件（来源 notice，发送者是操作者）。
// allow_reply 默认 true；队伍收件人恒为「仅通知」，该字段只对账号生效。
// 201 → { sent, count, mails: [{ type, id, mailId }] }
export const notifyTargets = (body) => post("/admin/msg/notify", body);

// ---------- 内部公告（仅 admin，2026-10-17 起） ----------

// 发布管理级内部公告：{ subject(1..80), content(1..2000) }
// 只向 staff / admin 广播（channel=internal，只读、canReply=false），玩家侧不可见。
// 201 → { announced, threadId, msgId, createdAt }；历史用 GET /admin/msg/mails?channel=internal
export const publishInternalAnnounce = (body) =>
  post("/admin/msg/internal-announce", body);

// ---------- 权限与权限组（admin） ----------

export const listPermissions = () => get("/admin/permissions");

export const getAccountPermissions = (id) =>
  get(`/admin/accounts/${id}/permissions`);

export const grantPermissionGroup = (id, groupCode) =>
  post(`/admin/accounts/${id}/permissions`, { group_code: groupCode });

export const revokePermissionGroup = (id, groupCode) =>
  del(`/admin/accounts/${id}/permissions/${groupCode}`);

// ---------- 求提示（两步报价，2026-10-14 起；2026-11-12 起并入站内信工作台） ----------
// 旧 POST /admin/msg/hint/:id/reply 已删除：答复必须与报价一起提交，
// 只落服务端 draft_reply，玩家确认扣费后才作为消息送达（见 api-10 §10.8–§10.16）。
// 2.2.0 起求提示全流程邮件化：提问 / 报价 / 还价 / 改价 / 拒绝降价 / 拒绝 / 确认 / 答复 / 关闭
// 各写一封邮件、串成完整回复链，求提示邮件一律不可回复。
// 动作（quote / requote / decline-cheaper / reject）现在由站内信抽屉的提示面板发起，
// :id 取邮件详情内联的 `hint.requestId`（后端未下发时面板只显示说明、不给动作）。

// 列表 / 详情：合并后前端不再单独调用，保留字段口径（与 `mail.hint` 同形），
// 便于后端联调与将来做「只看待报价」的独立视图。
// 列表：status 默认 pending（待报价队列），另支持 quoted / answered / rejected / closed / all。
// 2026-11-12 起元素新增 ticket / ticketStatus 与两个邮件 id（questionMailId / cheaperMailId），
// 并支持 ticket_status / ticket_overdue 过滤；被他人持有时隐藏 question / draftReply / attachments。
// 2.2.0 起每个元素另含 quoteMailId / quoteCount（最近一次报价邮件与报价次数）。
// 求提示工单与站内信工作台共享同一行，两边的 ticket_id 是同一个。
export const listHintRequests = (params) =>
  get("/admin/msg/hint-requests", params);

// 求提示详情（2026-11-12 新增）：question / quotedCost / draftReply / attachments / status /
// createdAt / questionMailId / cheaperMailId + ticket。
// 2.2.0 起纯读、不自动接单（须先 claimTicket）；另含 quotes[]（每次报价一行，
// quotes[].reply 是那次暂存的答案，仅管理端可见）。
export const getHintRequest = (id) => get(`/admin/msg/hint/${id}`);

// 报价：{ cost(0..1000000 整数), reply(1..2000), ticket_id } —— 报价即受理，释放该队「待报价」名额。
// 2.2.0 起每次报价都会写一封玩家可见的「求提示报价」邮件（只含价格，不含答案），
// 响应新增 quoteId / quoteMailId。工作台是整条会话视图，不拿这些 id 去取新邮件 ——
// 动作完成后按会话根重取 threads/:rootId，新邮件自然出现在会话末尾。
// 必须已接单并带上 ticket_id，否则 409。
export const quoteHint = (id, body) =>
  post(`/admin/msg/hint/${id}/quote`, body);

// 同意降价并改回答：{ cost(必须严格低于当前 quotedCost), reply(必填), ticket_id }
// 写一封「求提示降价」邮件（新价 + 原价，不含答案）；响应新增 quoteId / quoteMailId
//（同报价：前端只按会话根重取，不用它定位新邮件）。
export const requoteHint = (id, body) =>
  post(`/admin/msg/hint/${id}/requote`, body);

// 拒绝降价：{ ticket_id }；不改价不改回答，只把当前报价标记为最低报价。
// 写一封「求提示降价」邮件（当前已是最低报价）；响应新增 mailId（同样只作信息）。
export const declineCheaperHint = (id, body) =>
  post(`/admin/msg/hint/${id}/decline-cheaper`, body);

// 拒绝求提示：{ reason?, ticket_id }；reason 可选、≤200；可拒绝 pending / quoted（未确认即未扣费）。
// 写一封「求提示处理结果」邮件；响应新增 mailId（同样只作信息）。
export const rejectHint = (id, body) =>
  post(`/admin/msg/hint/${id}/reject`, body);

// 禁言 / 封禁 / 申诉已迁到 ./moderation.js（2026-10-17 重构：
// 旧的 /admin/msg/ban|unban 与 /admin/appeals/:accountId/reply 路径已不存在）。
