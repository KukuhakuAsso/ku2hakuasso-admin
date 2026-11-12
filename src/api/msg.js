import { del, get, post } from "./http";

// ---------- 工单（2026-11-12 迁移 0041，mistarg.2.1.0） ----------
//
// 管理端站内信改为工单式工作台：全局「待处理 / 处理中 / 已处理」；
// staff 打开线程 / 单封 / 求提示详情即占位接单（admin 的 GET 只读），
// 被他人持有的工单再访问详情会 403（detail.reason_code = TICKET_HELD_BY_OTHER）。
// 回复与求提示动作都要带 ticket_id，否则 409（TICKET_NOT_CLAIMED 等）。

// 分栏计数：open / pending / processing / closed / done / superseded、
// pendingOverdue / processingOverdue、mine、byKind.{mail,hint}、sla
export const getTicketSummary = () => get("/admin/msg/tickets/summary");

// 接单（pending → processing；本人重复调用幂等；被他人持有 → 409 TICKET_CLAIMED）
export const claimTicket = (ticketId) =>
    post(`/admin/msg/tickets/${ticketId}/claim`);

// 退出 / 标记未处理（processing → pending 并清处理人；admin 可强制退回他人）。
// 注意：退出后待处理计时不重置，超时仍按最初来信时间计算。
export const releaseTicket = (ticketId) =>
    post(`/admin/msg/tickets/${ticketId}/release`);

// ---------- 站内信工作台（邮件式，2026-10-14 起取代旧的 /msg/threads） ----------

// 邮件列表：每条发信一行，只给主题与来源，正文要点进详情。
// 工单过滤（迁移 0041）：ticket_status=open|closed|pending|processing|done|superseded|all、
// ticket_assignee=me|unassigned|all、ticket_overdue=1。
// 元素新增 ticket 与顶层 ticketStatus；被他人持有时服务端隐藏 snippet。
export const listMails = (params) => get("/admin/msg/mails", params);

// 某封邮件的详情：mail（请求的那封自己）+ replyChain（它回复过的链，
// 时间倒序、只上溯、不含后续回复）；没有 since_id / limit（不做会话增量）。
// 2026-11-12 起返回 ticket / threadTicket；staff 打开即接单，admin 仅查看。
export const getMail = (id) => get(`/admin/msg/mails/${id}`);

// 官方回复：主题由服务端生成（回复：<根主题>），正文之外要带 ticket_id
//（有未办结工单时必填）。响应新增 ticketId / ticketStatus。
// 注意：source=hint 的邮件不能从这里回复（403），要走求提示的报价流程。
export const replyMail = (id, body) =>
    post(`/admin/msg/mails/${id}/reply`, body);

// 逐封已读（POST /api/msg/mails/:id/read，与玩家端同一个接口）：
// 无请求体、幂等、只标记这一封（不影响它回复过的链、也不影响同对话其它记录）。
// 管理端打开一封未读邮件时调它，列表里的未读标记随之清零。
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
// 只落服务端 draft_reply，玩家确认扣费后才作为消息送达（见 api-10-tips.md §10.8–§10.10）。
// 动作（quote / requote / decline-cheaper / reject）现在由站内信抽屉的提示面板发起，
// :id 取邮件详情内联的 `hint.requestId`（后端未下发时面板只显示说明、不给动作）。

// 列表 / 详情：合并后前端不再单独调用，保留字段口径（与 `mail.hint` 同形），
// 便于后端联调与将来做「只看待报价」的独立视图。
// 列表：status 默认 pending（待报价队列），另支持 quoted / answered / rejected / closed / all。
// 2026-11-12 起元素新增 ticket / ticketStatus 与两个邮件 id（questionMailId / cheaperMailId），
// 并支持 ticket_status / ticket_overdue 过滤；被他人持有时隐藏 question / draftReply / attachments。
// 求提示工单与站内信工作台共享同一行，两边的 ticket_id 是同一个。
export const listHintRequests = (params) =>
    get("/admin/msg/hint-requests", params);

// 求提示详情（2026-11-12 新增）：question / quotedCost / draftReply / attachments / status /
// createdAt / questionMailId / cheaperMailId + ticket。staff 打开即占位（若工单待处理），admin 仅查看。
export const getHintRequest = (id) => get(`/admin/msg/hint/${id}`);

// 报价：{ cost(0..1000000 整数), reply(1..2000), ticket_id } —— 报价即受理，释放该队「待报价」名额。
// 2026-11-12 起必须先接单并带上 ticket_id（有未办结工单时必填），否则 409。
export const quoteHint = (id, body) => post(`/admin/msg/hint/${id}/quote`, body);

// 同意降价并改回答：{ cost(必须严格低于当前 quotedCost), reply(必填), ticket_id }
export const requoteHint = (id, body) =>
    post(`/admin/msg/hint/${id}/requote`, body);

// 拒绝降价：{ ticket_id }；不改价不改回答，只把当前报价标记为最低报价
export const declineCheaperHint = (id, body) =>
    post(`/admin/msg/hint/${id}/decline-cheaper`, body);

// 拒绝求提示：{ reason?, ticket_id }；reason 可选、≤200；可拒绝 pending / quoted（未确认即未扣费）
export const rejectHint = (id, body) =>
    post(`/admin/msg/hint/${id}/reject`, body);

// 禁言 / 封禁 / 申诉已迁到 ./moderation.js（2026-10-17 重构：
// 旧的 /admin/msg/ban|unban 与 /admin/appeals/:accountId/reply 路径已不存在）。

