import { get } from "./http";

/**
 * @file 管理端审计日志（api-9-admin.md「进度与审计接口」）。
 *
 * 数据来源：`GET /api/admin/actions`（需 **staff** 及以上）。
 */

/**
 * `http.request` 抛出的接口错误。
 * @typedef {import("./http").ApiError} ApiError
 */

/**
 * 一条审计记录。
 * @typedef {Object} AuditAction
 * @property {number} id 记录 id（翻页游标）
 * @property {number|null} actorId 操作者账号 id；系统动作为 `null`
 * @property {string|null} actor 操作者展示串，形如 `testadmin(M2000001)`
 * @property {string} action 动作名，如 `player.usernames.read`、`player.ban`、`team.dissolve`
 * @property {string|null} targetType 目标类型，如 `account` / `team` / `mail`
 * @property {string|null} targetId 目标 id（字符串，便于承载非数字目标）
 * @property {Object|null} payload 动作附带的明细（各动作不同，如 `{ count, player_no }`）
 * @property {string|null} ip 操作者 IP
 * @property {string} createdAt 发生时间（ISO 8601）
 */

/**
 * `listActions()` 的 `data`。
 * @typedef {Object} AuditActionPage
 * @property {AuditAction[]} items 本页记录（`id` 倒序，最新在前）
 * @property {number|null} nextCursor 下一页游标；没有更多时为 `null`
 * @property {boolean} hasMore 是否还有下一页
 */

/**
 * 查询审计记录（倒序游标分页）。
 *
 * - 接口：`GET /api/admin/actions`
 * - 鉴权：需要访问令牌 + staff 及以上
 * - 文档：api-9-admin.md「进度与审计接口 · `GET /api/admin/actions`」
 *
 * @param {Object} [params]
 * @param {string} [params.target_type] 目标类型（如 `account` / `team`）
 * @param {string} [params.target_id] 目标 id
 * @param {string} [params.action] 动作名（如 `player.ban`）
 * @param {number} [params.actor_id] 操作者账号 id
 * @param {number} [params.cursor=0] 上一页的 `nextCursor`
 * @param {number} [params.limit=50] 每页条数（1–100）
 * @returns {Promise<AuditActionPage>} `data` 本体
 * @throws {ApiError}
 *   - 400 `E_VALIDATION`：`limit` 越界或参数类型不符
 *   - 401 `E_AUTH`：未登录或令牌失效
 *   - 403 `E_FORBIDDEN`：角色不足（不是 staff / admin）
 */
export const listActions = (params) => get("/admin/actions", params);
