import { get } from "./http";

export const listActions = (params) => get("/admin/actions", params);
