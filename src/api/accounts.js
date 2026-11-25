// 出题人 / 目录所有人选择器的账号候选：staff + admin。
// 只在这两类角色里选（后端 PUT /admin/puzzles 与 POST /admin/pz/folders 都要求目标账号是 staff/admin）。
import { listPlayers } from "./players";

/**
 * @file 出题人 / 目录所有人选择器的账号候选（`staff` + `admin`）。
 */

/**
 * 每页条数与最多翻几页（与 PermissionsView 的 staff 账号下拉同口径）。
 * `PAGE_LIMIT` 取后端允许的上限 100；`MAX_PAGES` 决定单个角色最多取 2000 个账号，
 * 超出部分不会出现在候选里 —— 账号规模接近该上限时应改成分页搜索选择器。
 */
const PAGE_LIMIT = 100;
const MAX_PAGES = 20;

/**
 * 一个账号候选。
 * @typedef {Object} AuthorCandidate
 * @property {number} id 账号 id（提交给 `ownerId` / 出题人字段）
 * @property {string} label 展示名：用户名优先，其次玩家编号，最后回落 `账号 #<id>`
 * @property {"staff"|"admin"} role 角色
 */

/** @type {AuthorCandidate[]|null} 成功结果缓存；`null` = 尚未加载 */
let cache = null;
/** @type {Promise<AuthorCandidate[]>|null} 在飞的那一次加载：并发调用共用，不重复翻页 */
let inflight = null;

/**
 * 按角色逐页取全量账号。
 *
 * 任一分页失败就整体失败（异常向上抛），避免返回不完整候选；
 * 达到 `MAX_PAGES` 时停止翻页，不报错。
 *
 * @param {"staff"|"admin"} role 目标角色
 * @returns {Promise<Object[]>} `GET /admin/players` 的列表项（未去重、未排序）
 * @throws {Error} 任一分页请求失败（401 / 403 / 网络错误等）
 */
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

/**
 * 拉取 staff + admin 全量候选，按 `id` 去重、按展示名排序后写入缓存。
 *
 * @returns {Promise<AuthorCandidate[]>} 排好序的候选列表
 * @throws {Error} 任一角色分页失败（此时不写缓存）
 */
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

/**
 * 读取出题人 / 目录所有人候选（`staff` + `admin`，按展示名升序）。
 *
 * 首次调用会翻页拉全量并缓存；后续调用直接命中缓存。并发调用共享同一次在飞请求。
 * 加载失败**不写缓存**，下次调用会重新发起（调用方通常只需展示错误并允许重试）。
 *
 * @returns {Promise<AuthorCandidate[]>} 候选列表（同一数组引用，调用方不要原地修改）
 * @throws {Error} 加载失败：任一 `GET /api/admin/players` 分页出错时原样抛出
 */
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
