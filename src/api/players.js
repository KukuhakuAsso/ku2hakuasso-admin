import { get, post } from "./http";

/**
 * @file 管理端玩家列表 / 联系方式 / 曾用名 / 警告 / 封禁解封 / 强制改名
 * （api-9-admin.md「玩家接口」、api-5-username-management.md §七、api-11-moderation-mute.md §一）。
 *
 * 经 `http.request` 调用，返回值已剥掉统一信封，直接是 `data`；失败抛
 * {@link ApiError}（后端 `error` 对象在 `error.detail` 上）。
 */

/**
 * 玩家列表行（脱敏视图）。
 * @typedef {Object} PlayerRow
 * @property {number} id 账号 id（后续接口路径里的 `:id`）
 * @property {string} playerNo 玩家编号
 * @property {string} username 当前用户名
 * @property {string[]} previousUsernames 全部曾用名，最近的在前；从未改名为 `[]`（初始名不算）
 * @property {string} contact 脱敏联系方式（如 `te***@example.invalid`）；原文须调
 *   `getPlayerContact()`（仅 admin，且写入审计）
 * @property {"player"|"captain"|"staff"|"admin"} role 账号角色
 * @property {1|2|3|4} status 统一状态码：`1` 注销、`2` 正常、`3` 禁言、`4` 封禁；
 *   **已到期的 3/4 实时归一为 `2`**
 * @property {string|null} banReason 封禁原因；仅 `status=4` 有值
 * @property {string|null} banUntil 封禁到期时间；`null` = 永久或未封禁
 * @property {string|null} muteReason 禁言原因；仅 `status=3` 有值
 * @property {string|null} muteUntil 禁言到期时间；`null` = 永久或未禁言
 * @property {string} createdAt 注册时间
 */

/**
 * 完整联系方式（`getPlayerContact()` 的 `data`）。
 * @typedef {Object} PlayerContact
 * @property {number} id 账号 id
 * @property {string} playerNo 玩家编号
 * @property {string} contactType 联系方式类型（当前只有 `email`）
 * @property {string} contact 联系方式原文（未脱敏）
 */

/**
 * 曾用名历史项。
 * @typedef {Object} UsernameHistoryItem
 * @property {number} id 记录 id
 * @property {string} oldUsername 改名前
 * @property {string} newUsername 改名后
 * @property {"initial"|"self"|"admin"} changeKind `initial` 建号初始名 / `self` 本人改名 / `admin` 管理员改名
 * @property {string} changedAt 改名时间
 * @property {number|null} changedBy 操作者账号 id（本人改名时即本人；账号被删后置 `null`）
 * @property {string|null} changedByUsername 操作者用户名
 */

/**
 * 曾用名查询结果（`getPlayerUsernames()` 的 `data`）。
 * @typedef {Object} UsernameHistory
 * @property {number} accountId 账号 id
 * @property {string} playerNo 玩家编号
 * @property {string} username 当前用户名
 * @property {UsernameHistoryItem[]} items 历史记录（含 `initial` 那一行）
 */

/**
 * 警告结果（`warnPlayer()` 的 `data`）。
 * @typedef {Object} WarnResult
 * @property {true} warned 固定 `true`
 * @property {true} delivered 固定 `true`（无在职队伍时投递到账号级会话，不再出现 `false` / `no_team`）
 * @property {number} threadId 警告所在会话 id
 * @property {number} msgId 警告邮件 id
 */

/**
 * 封禁结果（`banPlayer()` 的 `data`）。
 * @typedef {Object} BanResult
 * @property {number} id 账号 id
 * @property {string} playerNo 玩家编号
 * @property {true} banned 固定 `true`
 * @property {number} tokenVersion 封禁后的令牌版本；该账号全部会话立即失效，玩家须重新登录
 * @property {"mute"|null} overwrote `null` = 本次新建封禁；`"mute"` = 原禁言已被本次封禁覆盖
 *   （解封后不恢复）
 */

/**
 * 解封结果（`unbanPlayer()` 的 `data`）。
 * @typedef {Object} UnbanResult
 * @property {number} id 账号 id
 * @property {true} unbanned 固定 `true`
 */

/**
 * 改名后的账号快照。
 * @typedef {Object} RenamedAccount
 * @property {number} id 账号 id
 * @property {string} playerNo 玩家编号
 * @property {string} username 新用户名
 * @property {string} previousUsername 旧用户名
 * @property {"player"|"captain"|"staff"|"admin"} role 角色
 * @property {1|2|3|4} status 统一状态码（同 `PlayerRow.status`）
 */

/**
 * 强制改名结果（`renamePlayer()` 的 `data`）。
 * @typedef {Object} RenameResult
 * @property {true} changed 固定 `true`
 * @property {RenamedAccount} account 改名后的账号快照
 */

/**
 * `http.request` 抛出的接口错误；后端 `error` 对象挂在 `error.detail` 上。
 * @typedef {import("./http").ApiError} ApiError
 */

/**
 * 玩家列表。
 *
 * - 接口：`GET /api/admin/players`
 * - 鉴权：需要访问令牌 + staff 及以上
 * - 文档：api-9-admin.md「`GET /api/admin/players`」
 *
 * @param {Object} [params]
 * @param {1|2|3|4} [params.status] 统一状态码（`1` 注销 / `2` 正常 / `3` 禁言 / `4` 封禁），
 *   缺省 = 全部。
 * @param {string} [params.role] 按角色筛选（`player` / `captain` / `staff` / `admin`；管理端页面只提供 `player` / `staff` / `admin`）
 * @param {string} [params.keyword] 匹配玩家编号或用户名
 * @param {number} [params.cursor=0] 取 id 小于游标的记录（传上一页 `nextCursor`）
 * @param {number} [params.limit=50] 每页条数（1–100）
 * @returns {Promise<{ items: PlayerRow[], nextCursor: number|null, hasMore: boolean }>} `data` 本体
 * @throws {ApiError}
 *   - 400 `E_VALIDATION`：参数非法（传 `status=5` 或越界、`limit` 不在 1–100）
 *     detail.fields：
 *       `status` -- 不是 1–4
 *       `limit` -- 大于 100 / 小于 1
 *   - 401 `E_AUTH`：未登录或令牌失效
 *   - 403 `E_FORBIDDEN`：角色不足（不是 staff / admin）
 */
export const listPlayers = (params) => get("/admin/players", params);

/**
 * 查看账号的**完整**联系方式（未脱敏）。
 *
 * - 接口：`GET /api/admin/players/:id/contact`
 * - 鉴权：**仅 admin**
 * - 文档：api-9-admin.md「`GET /api/admin/players/:id/contact`」
 *
 * @param {number} id 账号 id
 * @returns {Promise<PlayerContact>} `data` 本体
 * @throws {ApiError}
 *   - 401 `E_AUTH`：未登录或令牌失效
 *   - 403 `E_FORBIDDEN`：不是 admin
 *   - 404 `E_NOT_FOUND`：账号不存在
 */
export const getPlayerContact = (id) => get(`/admin/players/${id}/contact`);

/**
 * 查询某账号的曾用名记录。
 *
 * - 接口：`GET /api/admin/players/:id/usernames`
 * - 鉴权：需要访问令牌 + staff 及以上
 * - 文档：api-5-username-management.md §7.1
 *
 * @param {number} id 账号 id
 * @param {Object} [params]
 * @param {number} [params.limit=50] 返回条数（1–200）
 * @returns {Promise<UsernameHistory>} `data` 本体
 * @throws {ApiError}
 *   - 400 `E_VALIDATION`：`limit` 越界
 *   - 401 `E_AUTH`：未登录或令牌失效
 *   - 403 `E_FORBIDDEN`：角色不足
 *   - 404 `E_NOT_FOUND`：账号不存在
 */
export const getPlayerUsernames = (id, params) =>
    get(`/admin/players/${id}/usernames`, params);

/**
 * 警告玩家（以官方身份发一封站内信）。
 *
 * - 接口：`POST /api/admin/players/:id/warn`
 * - 鉴权：**仅 admin**（角色硬门槛，不挂权限码）
 * - 文档：api-9-admin.md「`POST /api/admin/players/:id/warn`」、api-11-moderation-mute.md §一
 *
 * @param {number} id 账号 id
 * @param {Object} body
 * @param {string} body.reason 警告原因（1–200 字，不能为空白）
 * @returns {Promise<WarnResult>} `data` 本体
 * @throws {ApiError}
 *   - 400 `E_VALIDATION`：`reason` 缺失 / 空白 / 超过 200 字
 *     detail.fields：
 *       `reason` -- 缺失 / 空白 / 超过 200 字
 *   - 401 `E_AUTH`：未登录或令牌失效
 *   - 403 `E_FORBIDDEN`：不是 admin；或目标账号角色不低于操作者
 *     detail.reason_code：
 *       `PUNISH_TARGET_ROLE` -- 目标角色与操作者同级或更高（`player < captain < staff < admin`）
 *   - 404 `E_NOT_FOUND`：账号不存在
 */
export const warnPlayer = (id, body) =>
    post(`/admin/players/${id}/warn`, body);

/**
 * 封禁账号。
 *
 * - 接口：`POST /api/admin/players/:id/ban`
 * - 鉴权：**仅 admin**（`moderation.ban` 目前不生效，仅预留）
 * - 文档：api-11-moderation-mute.md §一、api-9-admin.md「`POST /api/admin/players/:id/ban`」
 *
 * @param {number} id 账号 id
 * @param {Object} body
 * @param {string} body.reason 封禁原因（1–200 字，不能为空白）
 * @param {string|null} [body.until] 到期时间（ISO 8601）；省略或 `null` = 永久（须人工 `unbanPlayer()`），
 *   且必须是未来时间
 * @returns {Promise<BanResult>} `data` 本体
 * @throws {ApiError}
 *   - 400 `E_VALIDATION`：请求体或路径参数非法
 *     detail.fields：
 *       `reason` -- 缺失 / 空白 / 超过 200 字
 *       `until` -- 格式错误 / 不是未来时间
 *   - 401 `E_AUTH`：未登录或令牌失效
 *   - 403 `E_FORBIDDEN`：不是 admin；或目标账号角色不低于操作者（`detail.reason_code="PUNISH_TARGET_ROLE"`）
 *   - 409 `E_CONFLICT`：账号不存在 / 已封禁 / 已注销（`账号不存在或已被封禁`、`账号已注销，无法封禁`）
 */
export const banPlayer = (id, body) => post(`/admin/players/${id}/ban`, body);

/**
 * 解除封禁（无请求体）。
 *
 * - 接口：`POST /api/admin/players/:id/unban`
 * - 鉴权：**仅 admin**
 * - 文档：api-11-moderation-mute.md §一
 *
 * 不受目标角色门槛限制（解封是解除处罚）。解封后玩家**无需重新登录**，
 * 下一次读 `/api/me/status` 即为 `status=2`；被封禁覆盖的原禁言**不恢复**。
 * 审计动作为 `player.unban`。
 *
 * @param {number} id 账号 id
 * @returns {Promise<UnbanResult>} `data` 本体
 * @throws {ApiError}
 *   - 401 `E_AUTH`：未登录或令牌失效
 *   - 403 `E_FORBIDDEN`：不是 admin
 *   - 409 `E_CONFLICT`：`账号不存在或未被封禁`
 */
export const unbanPlayer = (id) => post(`/admin/players/${id}/unban`);

/**
 * 强制改名（更正违规用户名）。
 *
 * - 接口：`POST /api/admin/players/:id/username`
 * - 鉴权：**仅 admin**
 * - 文档：api-5-username-management.md §7.2
 *
 * @param {number} id 账号 id
 * @param {Object} body
 * @param {string} body.username 新用户名（1–32 个 Unicode 码点）
 * @returns {Promise<RenameResult>} `data` 本体
 * @throws {ApiError}
 *   - 400 `E_VALIDATION`：不符合用户名规则
 *     detail.fields：
 *       `username` -- 空 / 超过 32 码点 / 含禁用字符 / 形如玩家编号
 *   - 401 `E_AUTH`：未登录或令牌失效
 *   - 403 `E_BANNED`：目标账号已被封禁，不能改名（须先 `unbanPlayer()`）
 *   - 403 `E_FORBIDDEN`：不是 admin
 *   - 404 `E_NOT_FOUND`：账号不存在
 *   - 409 `E_CONFLICT`：`该用户名已被占用，请换一个`（含仅改大小写被他人占用的情况）
 */
export const renamePlayer = (id, body) =>
    post(`/admin/players/${id}/username`, body);
