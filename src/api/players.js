import { get, post } from "./http";

export const listPlayers = (params) => get("/admin/players", params);
export const getPlayerContact = (id) => get(`/admin/players/${id}/contact`);
export const getPlayerUsernames = (id, params) =>
    get(`/admin/players/${id}/usernames`, params);
export const warnPlayer = (id, body) =>
    post(`/admin/players/${id}/warn`, body);
export const banPlayer = (id, body) => post(`/admin/players/${id}/ban`, body);
export const unbanPlayer = (id) => post(`/admin/players/${id}/unban`);
export const renamePlayer = (id, body) =>
    post(`/admin/players/${id}/username`, body);
