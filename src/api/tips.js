import { get, post, put } from "./http";

export const grantTips = (body) => post("/admin/tips/grant", body);
export const getTipsRule = () => get("/admin/tips/rule");
export const putTipsRule = (body) => put("/admin/tips/rule", body);
