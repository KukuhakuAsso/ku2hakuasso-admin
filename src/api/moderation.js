import { get, post } from "./http";

// 禁言与封禁（api-11-moderation-mute.md）。
// 目标在路径上：players/:id = 账号 id，teams/:id = 队伍 id。
// 旧路径 /admin/msg/ban|unban|mutes 已移除（404）。

// ---------- 禁言：staff + moderation.mute ----------
// body: { reason(必填 1..200), until?(ISO 8601，省略/ null = 永久，必须是未来时间) }
// 重复禁言 = 覆盖（响应 overwritten:true）；目标已封禁 → 409
export const muteAccount = (id, body) => post(`/admin/players/${id}/mute`, body);
export const muteTeam = (id, body) => post(`/admin/teams/${id}/mute`, body);

// 解禁：无请求体；当前未禁言 → 404
export const unmuteAccount = (id) => post(`/admin/players/${id}/unmute`);
export const unmuteTeam = (id) => post(`/admin/teams/${id}/unmute`);

// 禁言列表（解禁用）：status=active|all、target=account|team|all、account_id / team_id、limit≤200（不分页）
export const listMutes = (params) => get("/admin/mutes", params);

// ---------- 封禁：admin ----------
// body 与禁言同形；响应 overwrote:"mute" 表示覆盖了原禁言
// 解封仍走 /admin/players/:id/unban、/admin/teams/:id/unban（见 api/players.js、api/teams.js）
export const listBanneds = (params) => get("/admin/banneds", params);

// ---------- 申诉（2026-11-12 起并入站内信工作台，2.2.0 起申诉也进工单） ----------
// 列表：kind=ban|mute|all（可见范围由权限决定）、state=awaiting|all、cursor、limit≤50。
// 2.2.0 起行内另含 ticket / ticketStatus / readOnly，并支持三个工单筛选：
// ticket_status=open|pending|processing|closed|done|all、ticket_assignee=me|unassigned|all、
// ticket_overdue=0|1；他人持有且调用方无只读权限时隐藏 lastAppeal.content / lastReply.content。
// 合并后前端只用它做申诉筛选/查阅；侧栏角标改由 tickets/summary 的顶层 open 提供，
// 回复 / 解禁用邮件详情内联的 `appeal` 快照。
export const listAppeals = (params) => get("/admin/appeals", params);

// 回复申诉：targetType=account|team，targetId 是账号 id 或队伍 id（不是邮件 id）。
// 两个主体都要带 kind：ban → 需 admin；mute → 需 moderation.mute。
// team + kind=ban 即「队伍封禁申诉」（队长代表队伍提交，回复写入队伍频道）。
// 2.2.0 起该申诉有未办结工单时必须带 ticket_id，并且**admin 也要先 claim**：
// 未接单 / 被他人持有 / ticket_id 失效 → 409 TICKET_NOT_CLAIMED / TICKET_CLAIMED / TICKET_STALE；
// 回复成功即办结工单，响应新增 ticketId / ticketStatus / ticket。
export const replyAppeal = (targetType, targetId, body) =>
    post(`/admin/appeals/${targetType}/${targetId}/reply`, body);
