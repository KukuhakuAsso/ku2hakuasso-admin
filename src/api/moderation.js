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

// ---------- 申诉工作台 ----------
// kind=ban|mute|all（可见范围由权限决定）、state=awaiting|all、cursor、limit≤50
export const listAppeals = (params) => get("/admin/appeals", params);

// 回复申诉：targetType=account|team，targetId 是账号 id 或队伍 id（不是邮件 id）。
// 两个主体都要带 kind：ban → 需 admin；mute → 需 moderation.mute。
// team + kind=ban 即「队伍封禁申诉」（队长代表队伍提交，回复写入队伍频道）。
export const replyAppeal = (targetType, targetId, body) =>
    post(`/admin/appeals/${targetType}/${targetId}/reply`, body);
