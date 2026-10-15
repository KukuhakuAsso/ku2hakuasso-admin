import { get, post } from "./http";

export const listMilestones = () => get("/admin/milestones");
export const createMilestone = (body) => post("/admin/milestones", body);
