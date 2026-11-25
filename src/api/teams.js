import { get, post } from "./http";

/**
 * @file 管理端队伍：列表 / 警告 / 封禁解封 / 强制改名 / 强制解散
 * （api-9-admin.md「队伍与赛事接口」、api-11-moderation-mute.md §一）。
 *
 * 经 `http.request` 调用，返回值已剥掉统一信封，直接是 `data`；失败抛
 * {@link ApiError}（后端 `error` 对象在 `error.detail` 上）。
 */

/**
 * 队伍列表行。
 * @typedef {Object} TeamRow
 * @property {number} id 队伍 id（后续接口路径里的 `:id`）
 * @property {string} name 队名
 * @property {string|null} intro 队伍简介；未填写为 `null`
 * @property {number|null} captainId 队长账号 id；无队长为 `null`
 * @property {1|2|3|4} status 统一状态码：`1` 已解散、`2` 正常、`3` 禁言、`4` 封禁；
 *   **已到期的 3/4 实时归一为 `2`**
 * @property {string|null} confirmedAt 确认参赛时间；未确认为 `null`
 * @property {string|null} banReason 封禁原因；仅 `status=4` 有值
 * @property {string|null} banUntil 封禁到期时间；`null` = 永久或未封禁
 * @property {string|null} muteReason 禁言原因；仅 `status=3` 有值
 * @property {string|null} muteUntil 禁言到期时间；`null` = 永久或未禁言
 * @property {number} memberCount 在职成员数
 * @property {number} solvedCount 已解题目数
 * @property {number} score 得分
 * @property {string} createdAt 建队时间
 */

/**
 * 队伍警告结果（`warnTeam()` 的 `data`）。
 * @typedef {Object} WarnTeamResult
 * @property {true} warned 固定 `true`
 * @property {true} delivered 固定 `true`（处罚不切断通知）
 * @property {number} teamId 被警告的队伍 id
 * @property {number} threadId 警告所在会话 id
 * @property {number} msgId 警告邮件 id
 */

/**
 * 队伍封禁结果（正常封禁）。
 * @typedef {Object} BanTeamResult
 * @property {true} banned 固定 `true`
 * @property {number} teamId 队伍 id
 * @property {string|null} until 到期时间；`null` = 永久（须人工 `unbanTeam()`）
 * @property {"mute"|null} overwrote `null` = 本次新建封禁；`"mute"` = 原禁言已被本次封禁覆盖
 *   （解封后不恢复）
 * @property {false} [dissolved] 正常封禁时不下发该字段
 */

/**
 * 队伍封禁结果（队伍含 staff / admin 成员时：按解散处理，不是封禁）。
 * @typedef {Object} BanTeamDissolvedResult
 * @property {false} banned 固定 `false`（本次没有封禁成功，而是解散）
 * @property {true} dissolved 固定 `true`；管理台据此提示「队伍已解散，不能解封」
 * @property {number} teamId 队伍 id
 * @property {1} status 固定 `1`（解散）
 */

/**
 * 队伍解封结果（`unbanTeam()` 的 `data`）。
 * @typedef {Object} UnbanTeamResult
 * @property {true} unbanned 固定 `true`
 * @property {number} teamId 队伍 id
 * @property {2} status 固定 `2`（正常）
 */

/**
 * 队伍强制改名结果（`renameTeam()` 的 `data`）。
 * @typedef {Object} RenameTeamResult
 * @property {true} renamed 固定 `true`
 * @property {number} teamId 队伍 id
 * @property {string} name 新队名
 * @property {string} previousName 旧队名
 */

/**
 * 队伍强制解散结果（`dissolveTeam()` 的 `data`）。
 * @typedef {Object} DissolveTeamResult
 * @property {number} teamId 队伍 id
 * @property {true} dissolved 固定 `true`
 * @property {true} forced 固定 `true`（管理端强制解散，非队长自行解散）
 */

/**
 * `http.request` 抛出的接口错误；后端 `error` 对象挂在 `error.detail` 上。
 * @typedef {import("./http").ApiError} ApiError
 */

/**
 * 队伍列表（按队伍 id 倒序游标分页）。
 *
 * - 接口：`GET /api/admin/teams`
 * - 鉴权：需要访问令牌 + staff 及以上
 * - 文档：api-9-admin.md「`GET /api/admin/teams`」
 *
 * @param {Object} [params]
 * @param {0|1|2|3|4} [params.status=0] 统一状态码：`1` 已解散、`2` 正常、`3` 禁言、`4` 封禁；
 *   缺省或 `0` = 全部，范围外 → `400`。筛 `2` 会**包含已到期**（对外显示为 `2`）的 3/4
 * @param {number} [params.cursor=0] 取 id 小于游标的记录（传上一页 `nextCursor`）
 * @param {number} [params.limit=50] 每页条数（1–100）
 * @returns {Promise<{ items: TeamRow[], nextCursor: number|null, hasMore: boolean }>} `data` 本体
 * @throws {ApiError}
 *   - 400 `E_VALIDATION`：`status` 不在 0–4、`limit` 越界
 *     detail.fields：
 *       `status` -- 不在 0–4
 *       `limit` -- 不在 1–100
 *   - 401 `E_AUTH`：未登录或令牌失效
 *   - 403 `E_FORBIDDEN`：角色不足（不是 staff / admin）
 */
export const listTeams = (params) => get("/admin/teams", params);

/**
 * 警告队伍（向该队会话发一条官方警告）。
 *
 * - 接口：`POST /api/admin/teams/:id/warn`
 * - 鉴权：**仅 admin**（路由 `requireRole("admin")`）
 * - 文档：api-9-admin.md「`POST /api/admin/teams/:id/warn`」、api-11-moderation-mute.md §一
 *
 * @param {number} id 队伍 id
 * @param {Object} body
 * @param {string} body.reason 警告原因（1–200 字，不能为空白）
 * @returns {Promise<WarnTeamResult>} `data` 本体
 * @throws {ApiError}
 *   - 400 `E_VALIDATION`：`reason` 缺失 / 空白 / 超过 200 字；`:id` 不是正整数
 *     detail.fields：
 *       `reason` -- 缺失 / 空白 / 超过 200 字
 *   - 401 `E_AUTH`：未登录或令牌失效
 *   - 403 `E_FORBIDDEN`：不是 admin
 *   - 404 `E_NOT_FOUND`：队伍不存在
 *   - 409 `E_CONFLICT`：队伍已解散（`status=1`）
 */
export const warnTeam = (id, body) => post(`/admin/teams/${id}/warn`, body);

/**
 * 封禁队伍。
 *
 * - 接口：`POST /api/admin/teams/:id/ban`
 * - 鉴权：**仅 admin**
 * - 文档：api-9-admin.md「`POST /api/admin/teams/:id/ban`」、api-11-moderation-mute.md §一
 *
 * ⚠ 队伍里若有 staff / admin 成员，会被**按解散处理**：响应变成
 * {@link BanTeamDissolvedResult}（`banned: false` + `dissolved: true` + `status: 1`），
 * 调用方必须按 `dissolved` 分支提示「队伍已解散，不能解封」，不能一律提示「已封禁」。
 *
 * @param {number} id 队伍 id
 * @param {Object} body
 * @param {string} body.reason 封禁原因（1–200 字，不能为空白）
 * @param {string|null} [body.until] 到期时间（ISO 8601）；省略或 `null` = 永久，
 *   且必须是未来时间
 * @returns {Promise<BanTeamResult|BanTeamDissolvedResult>} `data` 本体
 *   （**联合类型**：含 staff / admin 成员时为解散形状）
 * @throws {ApiError}
 *   - 400 `E_VALIDATION`：字段不合法或 `:id` 不是正整数
 *     detail.fields：
 *       `reason` -- 缺失 / 空白 / 超过 200 字
 *       `until` -- 格式错误 / 不是未来时间
 *   - 401 `E_AUTH`：未登录或令牌失效
 *   - 403 `E_FORBIDDEN`：不是 admin
 *   - 409 `E_CONFLICT`：队伍不存在 / 已解散 / 已封禁
 */
export const banTeam = (id, body) => post(`/admin/teams/${id}/ban`, body);

/**
 * 解除队伍封禁（无请求体）。
 *
 * - 接口：`POST /api/admin/teams/:id/unban`
 * - 鉴权：**仅 admin**
 * - 文档：api-11-moderation-mute.md §一
 *
 * @param {number} id 队伍 id
 * @returns {Promise<UnbanTeamResult>} `data` 本体
 * @throws {ApiError}
 *   - 400 `E_VALIDATION`：`:id` 不是正整数
 *   - 401 `E_AUTH`：未登录或令牌失效
 *   - 403 `E_FORBIDDEN`：不是 admin
 *   - 409 `E_CONFLICT`：`队伍不存在或未被封禁`
 */
export const unbanTeam = (id) => post(`/admin/teams/${id}/unban`);

/**
 * 强制改队名。
 *
 * - 接口：`POST /api/admin/teams/:id/name`
 * - 鉴权：**仅 admin**
 * - 文档：api-9-admin.md「`POST /api/admin/teams/:id/name`」
 *
 * @param {number} id 队伍 id
 * @param {Object} body
 * @param {string} body.name 新队名（1–32 字）
 * @returns {Promise<RenameTeamResult>} `data` 本体
 * @throws {ApiError}
 *   - 400 `E_VALIDATION`：队名为空 / 超过 32 码点 / 含禁用字符
 *     detail.fields：
 *       `name` -- 不符合建队命名规则
 *   - 401 `E_AUTH`：未登录或令牌失效
 *   - 403 `E_FORBIDDEN`：不是 admin
 *   - 404 `E_NOT_FOUND`：队伍不存在
 *   - 409 `E_CONFLICT`：`该队名已被占用`
 */
export const renameTeam = (id, body) => post(`/admin/teams/${id}/name`, body);

/**
 * 强制解散队伍（无请求体）。
 *
 * - 接口：`POST /api/admin/teams/:id/dissolve`
 * - 鉴权：**仅 admin**
 * - 文档：api-9-admin.md「`POST /api/admin/teams/:id/dissolve`」
 *
 * @param {number} id 队伍 id
 * @returns {Promise<DissolveTeamResult>} `data` 本体
 * @throws {ApiError}
 *   - 400 `E_VALIDATION`：`:id` 不是正整数
 *   - 401 `E_AUTH`：未登录或令牌失效
 *   - 403 `E_FORBIDDEN`：不是 admin
 *   - 404 `E_NOT_FOUND`：队伍不存在 / 已解散 / 生效中封禁（「封禁队伍请先解封」）
 */
export const dissolveTeam = (id) => post(`/admin/teams/${id}/dissolve`);
