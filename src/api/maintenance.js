import { get, post } from "./http";

/**
 * @file 管理端统计与维护接口（api-9-admin.md「里程碑、统计与权限接口」「维护接口」）。
 *
 * 经 `http.request` 调用，返回值已剥掉统一信封，直接是 `data`。
 *
 * 权限（admin 角色硬门槛，给 staff 授予权限码也不提升）：
 * - `GET /api/admin/stats` —— **staff 及以上**可读；
 * - `POST /api/admin/contest/start-at`、`/maintenance/*` —— **仅 admin**。
 *
 * 四个接口都会写审计（`admin_action`），其中维护类为排查 / 修复用途，不要放进常规流程反复调用。
 */

/**
 * 每日统计行（服务端 `stat_daily` 表原样下发，**snake_case**）。
 * @typedef {Object} StatsDailyRow
 * @property {string} day_key 日期键，如 `2026-11-20`
 * @property {number} reg_count 当日注册数
 * @property {number} login_count 当日登录数
 * @property {number} active_players 当日活跃玩家数
 * @property {number} solved_count 当日解出数
 * @property {number} msg_count 当日站内信数
 * @property {number} tips_issued 当日发放 tips 数
 */

/**
 * `getStats()` 的 `data`。
 * @typedef {Object} AdminStats
 * @property {StatsDailyRow[]} daily 每日统计，按 `day_key` **倒序**；无数据时为 `[]`
 * @property {Object} live 实时统计
 * @property {number} live.players 有效账号数（已排除注销 / 到期归一后的无效账号）
 * @property {number} live.teams 有效队伍数
 * @property {number} live.solves 完成记录数（有首次完成时间的「队伍 × 题目」，重复答对不再累加）
 * @property {number} live.messages 站内信总数
 * @property {string} live.tips_total tips 总量（bigint 序列化为字符串，避免精度丢失）
 */

/**
 * `settleTips()` 的 `data`。
 * @typedef {Object} SettleTipsResult
 * @property {number} settled 本次结算涉及的队伍数
 * @property {number} batches 处理的批次数（服务端按 200 条/批、最多 5 批）
 */

/**
 * `recheckMilestones()` 的 `data`。
 * @typedef {Object} RecheckMilestonesResult
 * @property {number} teamId 被重查的队伍 id（回显请求值）
 * @property {{ key: string, title: string, tipsReward: number }[]} newMilestones
 *   本次新达成的里程碑；没有时为空数组
 */

/**
 * `setContestStartAt()` 的 `data`。
 * @typedef {Object} ContestStartAtResult
 * @property {string} startAt 归一化后的开赛时间（ISO 8601，UTC）
 * @property {number} startAtMs 同一时刻的毫秒时间戳
 */

/**
 * `http.request` 抛出的接口错误。
 * @typedef {import("./http").ApiError} ApiError
 */

/**
 * 读取首页统计（每日 + 实时）。
 *
 * - 接口：`GET /api/admin/stats`
 * - 鉴权：需要访问令牌 + staff 及以上
 * - 文档：api-9-admin.md「里程碑、统计与权限接口 · `GET /api/admin/stats`」
 *
 * ⚠ 本封装**不传** `days`：服务端默认取最近 `7` 天（允许 1–90）。
 * 需要其它范围时把签名扩成 `getStats(days)` 并在 `get()` 里带上参数。
 *
 * @returns {Promise<AdminStats>} `data` 本体
 * @throws {ApiError}
 *   - 400 `E_VALIDATION`：参数不合法（当前封装不会触发，除非扩展 `days`）
 *   - 401 `E_AUTH`：未登录或令牌失效
 *   - 403 `E_FORBIDDEN`：角色不足（不是 staff / admin）
 */
export const getStats = () => get("/admin/stats");

/**
 * 设置官方开赛时间（**仅 admin**）。
 *
 * - 接口：`POST /api/admin/contest/start-at`
 * - 鉴权：需要访问令牌 + admin
 * - 文档：api-9-admin.md「玩家与队伍 · `POST /api/admin/contest/start-at`」
 *
 * @param {Object} body
 * @param {string} body.start_at 开赛时间，任意可被 `Date` 解析的日期时间字符串
 *   （调用方通常传 `new Date(...).toISOString()`）；trim 后 ≤40 字符
 * @returns {Promise<ContestStartAtResult>} `data` 本体
 * @throws {ApiError}
 *   - 400 `E_VALIDATION`：`start_at` 缺失 / 超长 / 不是有效日期时间
 *     detail.fields：
 *       `start_at` -- 具体原因
 *   - 401 `E_AUTH`：未登录或令牌失效
 *   - 403 `E_FORBIDDEN`：不是 admin（staff 也会被拒）
 */
export const setContestStartAt = (body) =>
    post("/admin/contest/start-at", body);

/**
 * 手动触发一次 tips 结算（**仅 admin**，排查用）。
 *
 * - 接口：`POST /api/admin/maintenance/settle-tips`
 * - 鉴权：需要访问令牌 + admin
 * - 文档：api-9-admin.md「维护接口 · `POST /api/admin/maintenance/settle-tips`」
 *
 * @returns {Promise<SettleTipsResult>} `data` 本体
 * @throws {ApiError}
 *   - 401 `E_AUTH`：未登录或令牌失效
 *   - 403 `E_FORBIDDEN`：不是 admin
 *   - 500 `E_INTERNAL`：结算过程异常（可重试；结算本身幂等）
 */
export const settleTips = () => post("/admin/maintenance/settle-tips");

/**
 * 重新检查指定队伍的里程碑（**仅 admin**，改了里程碑定义后使用）。
 *
 * - 接口：`POST /api/admin/maintenance/recheck-milestones`
 * - 鉴权：需要访问令牌 + admin
 * - 文档：api-9-admin.md「维护接口 · `POST /api/admin/maintenance/recheck-milestones`」
 *
 * @param {Object} body
 * @param {number} body.team_id 队伍 id（必填正整数）
 * @returns {Promise<RecheckMilestonesResult>} `data` 本体
 * @throws {ApiError}
 *   - 400 `E_VALIDATION`：`team_id` 缺失或不是正整数
 *     detail.fields：
 *       `team_id` -- 缺失 / 非正整数
 *   - 401 `E_AUTH`：未登录或令牌失效
 *   - 403 `E_FORBIDDEN`：不是 admin
 *   - 404 `E_NOT_FOUND`：队伍不存在
 */
export const recheckMilestones = (body) =>
    post("/admin/maintenance/recheck-milestones", body);
