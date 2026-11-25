import { get, post, put } from "./http";

/**
 * @file 管理端提示点（tips）：队伍级发放 / 扣减、提示规则查询与修改
 * （api-10-tips-hints.md §10.13）。
 *
 * 经 `http.request` 调用，返回值已剥掉统一信封，直接是 `data`；失败抛
 * {@link ApiError}（后端 `error` 对象在 `error.detail` 上）。
 *
 * - 规则里的 **`hint_cost` 已废弃**（2026-10-14，迁移 0020）：不再下发、`PUT` 也不再接受
 *   （传了被静默丢弃）。人工提示的价格来自 staff **逐条报价**，不要再用全局单价渲染按钮；
 */

/**
 * 提示点规则（`GET` / `PUT` 的 `data.rule`）。
 * @typedef {Object} TipsRule
 * @property {number} id 规则 id（每次保存都是新行，旧规则立即失效）
 * @property {string} name 规则名称
 * @property {number} rate_per_hour 每小时自动增长点数（0–100000）
 * @property {number} daily_cap 每日累计上限（0–10000000）
 * @property {number} idle_decay_pct 不活跃衰减百分比（0–100）；`0` = 不衰减
 */

/**
 * 发放 / 扣减结果（`grantTips()` 的 `data`）。
 * @typedef {Object} TipsGrantResult
 * @property {number} balance 本次操作后的余额（**已含懒结算**，直接用它刷新界面，
 *   不要用「旧余额 + delta」自己算）
 * @property {number} delta 本次实际生效的增减；**幂等命中时为 `0`**
 * @property {number} accrued 本次懒结算产生的点数变化（自动增长为正；闲置衰减为负）
 * @property {boolean} idempotent `true` = 幂等命中，本次**一个字节都没写**（余额、锚点、累计全部未变）
 */

/**
 * `http.request` 抛出的接口错误；后端 `error` 对象挂在 `error.detail` 上。
 * @typedef {import("./http").ApiError} ApiError
 */

/**
 * 给**队伍**发放或扣减提示点。
 *
 * - 接口：`POST /api/admin/tips/grant`
 * - 鉴权：**仅 admin**（路由 `requireRole("admin")`）
 * - 文档：api-10-tips-hints.md §10.13「`POST /api/admin/tips/grant`」
 *
 * @param {Object} body
 * @param {number} body.team_id 目标**队伍** id（不是账号 id —— `account_id` 已废除）
 * @param {number} body.delta 增减值（整数，-1000000–1000000；负数 = 扣减，
 *   扣到余额不足会 `400 E_TIPS_SHORT`）
 * @param {string} body.note 备注（1–200 字，**必填**，空白也算缺失）
 * @param {string} [body.idem_key] 幂等键（≤96 字符）；相同键只生效一次
 * @returns {Promise<TipsGrantResult>} `data` 本体
 * @throws {ApiError}
 *   - 400 `E_VALIDATION`：参数非法
 *     detail.fields：
 *       `team_id` -- 缺失 / 不是正整数
 *       `delta` -- 缺失 / 超出 ±1000000
 *       `note` -- 缺失 / 空白 / 超过 200 字（`手动调整积分必须填备注`）
 *   - 400 `E_TIPS_SHORT`：扣减后余额不足（`detail.balance` / `detail.required`）
 *   - 401 `E_AUTH`：未登录或令牌失效
 *   - 403 `E_FORBIDDEN`：不是 admin
 *   - 404 `E_NOT_FOUND`：队伍不存在
 */
export const grantTips = (body) => post("/admin/tips/grant", body);

/**
 * 读取当前生效的提示点规则。
 *
 * - 接口：`GET /api/admin/tips/rule`
 * - 鉴权：需要访问令牌 + staff 及以上
 * - 文档：api-10-tips-hints.md §10.13
 *
 * ⚠ 响应**不含 `hint_cost`**（2026-10-14 起废弃，见文件头）。
 *
 * @returns {Promise<{ rule: TipsRule }>} `data` 本体
 * @throws {ApiError}
 *   - 401 `E_AUTH`：未登录或令牌失效
 *   - 403 `E_FORBIDDEN`：角色不足（不是 staff / admin）
 */
export const getTipsRule = () => get("/admin/tips/rule");

/**
 * 修改提示点规则（**立即生效**）。
 *
 * - 接口：`PUT /api/admin/tips/rule`
 * - 鉴权：**仅 admin**
 * - 文档：api-10-tips-hints.md §10.13
 *
 * @param {Object} body
 * @param {string} [body.name] 规则名称（≤32 字；缺省 `调整后规则`）
 * @param {number} body.rate_per_hour 每小时自动增长（0–100000，**必填**）
 * @param {number} body.daily_cap 每日累计上限（0–10000000，**必填**）
 * @param {number} [body.idle_decay_pct] 不活跃衰减百分比（0–100，缺省 `0`）
 * @returns {Promise<{ rule: TipsRule }>} `data` 本体（新规则的快照）
 * @throws {ApiError}
 *   - 400 `E_VALIDATION`：参数非法
 *     detail.fields：
 *       `rate_per_hour` -- 缺失 / 不在 0–100000
 *       `daily_cap` -- 缺失 / 不在 0–10000000
 *       `idle_decay_pct` -- 不在 0–100
 *       `name` -- 超过 32 字
 *   - 401 `E_AUTH`：未登录或令牌失效
 *   - 403 `E_FORBIDDEN`：不是 admin
 */
export const putTipsRule = (body) => put("/admin/tips/rule", body);
