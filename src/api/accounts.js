// 出题人 / 目录所有人选择器的账号候选：staff + admin。
// 只在这两类角色里选（后端 PUT /admin/puzzles 与 POST /admin/pz/folders 都要求目标账号是 staff/admin）。
import { listPlayers } from "./players";

let cache = null;

export async function listAuthorCandidates() {
    if (cache) return cache;

    const [staff, admins] = await Promise.all([
        listPlayers({ role: "staff", limit: 100 }),
        listPlayers({ role: "admin", limit: 100 }),
    ]);

    const map = new Map();
    for (const item of [...(staff?.items ?? []), ...(admins?.items ?? [])]) {
        const id = Number(item.id);
        if (!Number.isFinite(id)) continue;
        map.set(id, {
            id,
            label: item.username || item.playerNo || `账号 #${id}`,
            role: item.role,
        });
    }

    cache = [...map.values()].sort((a, b) => a.label.localeCompare(b.label));
    return cache;
}

export default listAuthorCandidates;
