import { get, put } from "./http";

export const listPuzzles = () => get("/admin/puzzles");
export const putPuzzle = (key, body) => put(`/admin/puzzles/${key}`, body);
