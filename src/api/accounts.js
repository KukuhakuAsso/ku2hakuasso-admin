// 出题人 / 目录所有人选择器的账号候选：staff + admin。
// 只在这两类角色里选（后端 PUT /admin/puzzles 与 POST /admin/pz/folders 都要求目标账号是 staff/admin）。
import { listPlayers } from "./players";

// 每页条数与最多翻几页（与 PermissionsView 的 staff 账号下拉同口径）。
// 后端是游标分页：只取第一页会让第 101 个之后的账号永远选不到，
// 而结果是模块级缓存的，重试也救不回来，只能刷新整个后台。
const PAGE_LIMIT = 100;
const MAX_PAGES = 20;

let cache = null;
// 在飞的那一次加载：两个面板同时打开时共用，不重复翻页。
let inflight = null;

// 按角色逐页取全量。任一分页失败就整体失败 —— 宁可显示加载失败，
// 也不要悄悄给出一份不完整的候选列表（那正是这个函数原来出问题的方式）。
async function listAllByRole(role) {
    const items = [];
    let cursor;
    for (let page = 0; page < MAX_PAGES; page += 1) {
        const data = await listPlayers({ role, cursor, limit: PAGE_LIMIT });
        items.push(...(data?.items ?? []));
        if (!data?.hasMore || !data?.nextCursor) break;
        cursor = data.nextCursor;
    }
    return items;
}

async function load() {
    const [staff, admins] = await Promise.all([
        listAllByRole("staff"),
        listAllByRole("admin"),
    ]);

    const map = new Map();
    for (const item of [...staff, ...admins]) {
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

export async function listAuthorCandidates() {
    if (cache) return cache;
    if (!inflight) {
        // 失败不写缓存：调用方下次重进面板会重新发起
        inflight = load().finally(() => {
            inflight = null;
        });
    }
    return inflight;
}

export default listAuthorCandidates;
