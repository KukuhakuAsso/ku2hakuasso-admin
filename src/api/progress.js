import { get } from "./http";

export const listProgressTeams = (params) =>
    get("/admin/progress/teams", params);
export const getProgressTeam = (id) => get(`/admin/progress/team/${id}`);
export const getProgressMatrix = (params) =>
    get("/admin/progress/matrix", params);
export const listSubmissions = (params) =>
    get("/admin/progress/submissions", params);
