import { get, post } from "./http";

export const listTeams = (params) => get("/admin/teams", params);
export const warnTeam = (id, body) => post(`/admin/teams/${id}/warn`, body);
export const banTeam = (id, body) => post(`/admin/teams/${id}/ban`, body);
export const unbanTeam = (id) => post(`/admin/teams/${id}/unban`);
export const renameTeam = (id, body) => post(`/admin/teams/${id}/name`, body);
export const dissolveTeam = (id) => post(`/admin/teams/${id}/dissolve`);
