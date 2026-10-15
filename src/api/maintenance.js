import { get, post } from "./http";

export const getStats = () => get("/admin/stats");
export const setContestStartAt = (body) =>
    post("/admin/contest/start-at", body);
export const settleTips = () => post("/admin/maintenance/settle-tips");
export const recheckMilestones = () =>
    post("/admin/maintenance/recheck-milestones");
