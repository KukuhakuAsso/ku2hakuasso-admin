import { get, post } from "./http";

/**
 * @file 管理端里程碑定义（api-9-admin.md「里程碑、统计与权限接口」）。
 *
 * 经 `http.request` 调用，返回值已剥掉统一信封，直接是 `data`。
 *
 * 权限：`GET` 需 staff 及以上；`POST` 为 **admin 专属**。写操作都会记审计。
 */

/**
 * 里程碑定义（`GET` 响应的列表项，camelCase）。
 * @typedef {Object} MilestoneDef
 * @property {string} key 里程碑标识（如 `first_blood`）
 * @property {string} title 展示标题（如「首杀」）
 * @property {"count"|"set"|"custom"} kind 判定方式：计数 / 集齐指定题目 / 自定义
 * @property {number|null} threshold 计数类阈值（`kind=count` 时有意义）
 * @property {string[]} requireKeys `kind=set` 时需集齐的题目 key
 * @property {number} tipsReward 达成后发放的 tips
 * @property {boolean} enabled 是否启用
 */

/**
 * `createMilestone()` 的 `data`（**snake_case**，与请求体同形）。
 * @typedef {Object} MilestoneSaved
 * @property {Object} milestone 保存后的里程碑定义
 * @property {string} milestone.key 里程碑标识
 * @property {string} milestone.title 展示标题
 * @property {"count"|"set"|"custom"} milestone.kind 判定方式
 * @property {number|null} milestone.threshold 计数类阈值
 * @property {string[]} milestone.require_keys 需集齐的题目 key
 * @property {number} milestone.tips_reward 达成后发放的 tips
 * @property {boolean} milestone.enabled 是否启用
 */

/**
 * `http.request` 抛出的接口错误。
 * @typedef {import("./http").ApiError} ApiError
 */

/**
 * 读取全部里程碑定义（按 `key` 升序）。
 *
 * - 接口：`GET /api/admin/milestones`
 * - 鉴权：需要访问令牌 + staff 及以上
 * - 文档：api-9-admin.md「里程碑、统计与权限接口 · `GET /api/admin/milestones`」
 *
 * @returns {Promise<{ items: MilestoneDef[] }>} `data` 本体
 * @throws {ApiError}
 *   - 401 `E_AUTH`：未登录或令牌失效
 *   - 403 `E_FORBIDDEN`：角色不足（不是 staff / admin）
 */
export const listMilestones = () => get("/admin/milestones");

/**
 * 新增或更新里程碑（**仅 admin**，相同 `key` 覆盖原记录）。
 *
 * - 接口：`POST /api/admin/milestones`
 * - 鉴权：需要访问令牌 + admin
 * - 文档：api-9-admin.md「里程碑、统计与权限接口 · `POST /api/admin/milestones`」
 *
 * @param {Object} body
 * @param {string} body.key 里程碑标识（必填，trim 后 ≤48 字符）
 * @param {string} body.title 展示标题（必填，trim 后 ≤200 字符）
 * @param {"count"|"set"|"custom"} [body.kind] 判定方式；不传则沿用后端默认
 * @param {number} [body.threshold] 计数类阈值（0–1000000）
 * @param {string[]} [body.require_keys] `kind=set` 时需集齐的题目 key（每个 ≤64 字符）
 * @param {number} [body.tips_reward] 达成奖励 tips（0–1000000，默认 0）
 * @param {boolean} [body.enabled] 是否启用（默认 `true`）
 * @returns {Promise<MilestoneSaved>} `data` 本体
 * @throws {ApiError}
 *   - 400 `E_VALIDATION`：参数校验失败
 *     detail.fields：
 *       `key` -- 缺失 / 超过 48 字符
 *       `title` -- 缺失 / 超过 200 字符
 *       `kind` -- 不在 `count` / `set` / `custom` 之内
 *       `threshold` -- 不是 0–1000000 的整数
 *       `require_keys` -- 元素不是字符串或超过 64 字符
 *       `tips_reward` -- 不是 0–1000000 的整数
 *   - 401 `E_AUTH`：未登录或令牌失效
 *   - 403 `E_FORBIDDEN`：不是 admin（staff 也会被拒）
 */
export const createMilestone = (body) => post("/admin/milestones", body);
