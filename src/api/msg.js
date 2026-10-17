import { del, get, post } from "./http";

// ---------- 站内信工作台（邮件式，2026-10-14 起取代旧的 /msg/threads） ----------

// 邮件列表：每条发信一行，只给主题与来源，正文要点进详情
export const listMails = (params) => get("/admin/msg/mails", params);

// 某封邮件的详情：mail（请求的那封自己）+ replyChain（它回复过的链，
// 时间倒序、只上溯、不含后续回复）；没有 since_id / limit（不做会话增量）
export const getMail = (id) => get(`/admin/msg/mails/${id}`);

// 官方回复：主题由服务端生成（回复：<根主题>），请求体只有正文
export const replyMail = (id, body) =>
    post(`/admin/msg/mails/${id}/reply`, body);

// ---------- 公告 ----------

// 发布官方公告：subject（1–80）与 content（1–2000）都必填
export const announce = (body) => post("/admin/msg/announce", body);

// 历史公告（仍带正文，不套用「只给主题」的规则）
export const listAnnouncements = (params) =>
    get("/admin/msg/announcements", params);

// ---------- 权限与权限组（admin） ----------

export const listPermissions = () => get("/admin/permissions");

export const getAccountPermissions = (id) =>
    get(`/admin/accounts/${id}/permissions`);

export const grantPermissionGroup = (id, groupCode) =>
    post(`/admin/accounts/${id}/permissions`, { group_code: groupCode });

export const revokePermissionGroup = (id, groupCode) =>
    del(`/admin/accounts/${id}/permissions/${groupCode}`);

// ---------- 提示工作台（两步报价，2026-10-14 起） ----------
// 旧 POST /admin/msg/hint/:id/reply 已删除：答复必须与报价一起提交，
// 只落服务端 draft_reply，玩家确认扣费后才作为消息送达（见 api-10-tips.md §10.8–§10.10）。

// 工作台列表：status 默认 pending（待报价队列），另支持 quoted / answered / rejected / closed / all
export const listHintRequests = (params) =>
    get("/admin/msg/hint-requests", params);

// 报价：{ cost(0..1000000 整数), reply(1..2000) } —— 报价即受理，释放该队「待报价」名额
export const quoteHint = (id, body) => post(`/admin/msg/hint/${id}/quote`, body);

// 同意降价并改回答：{ cost(必须严格低于当前 quotedCost), reply(必填) }
export const requoteHint = (id, body) =>
    post(`/admin/msg/hint/${id}/requote`, body);

// 拒绝降价：无请求体；不改价不改回答，只把当前报价标记为最低报价
export const declineCheaperHint = (id) =>
    post(`/admin/msg/hint/${id}/decline-cheaper`);

// 拒绝求提示：{ reason } 可选、≤200；可拒绝 pending / quoted（未确认即未扣费）
export const rejectHint = (id, body) =>
    post(`/admin/msg/hint/${id}/reject`, body);

// 禁言 / 封禁 / 申诉已迁到 ./moderation.js（2026-10-17 重构：
// 旧的 /admin/msg/ban|unban 与 /admin/appeals/:accountId/reply 路径已不存在）。

