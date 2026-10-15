import { get, post } from "./http";

export const listThreads = (params) => get("/admin/msg/threads", params);
export const getThread = (id, params) =>
    get(`/admin/msg/thread/${id}`, params);
export const replyThread = (body) => post("/admin/msg/reply", body);

export const listHintRequests = (params) =>
    get("/admin/msg/hint-requests", params);
export const replyHint = (id, body) =>
    post(`/admin/msg/hint/${id}/reply`, body);
export const rejectHint = (id, body) =>
    post(`/admin/msg/hint/${id}/reject`, body);

export const announce = (body) => post("/admin/msg/announce", body);
export const listAnnouncements = (params) =>
    get("/admin/msg/announcements", params);
