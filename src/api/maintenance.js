import { get, post } from "./http";

export const getStats = () => get("/admin/stats");
export const setContestStartAt = (body) =>
    post("/admin/contest/start-at", body);
export const settleTips = () => post("/admin/maintenance/settle-tips");
// 重新检查指定队伍的里程碑：team_id 必填正整数（按队伍逐队重查）
export const recheckMilestones = (body) =>
    post("/admin/maintenance/recheck-milestones", body);
