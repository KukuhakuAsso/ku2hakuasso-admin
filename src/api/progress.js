import { get } from "./http";

/**
 * @file 管理端进度监测：队伍进度汇总 / 单队时间线 / 队伍 × 题目矩阵 / 提交历史
 * （api-9-admin.md「进度与审计」§，api-1-api-list.md）。
 *
 * 经 `http.request` 调用，返回值已剥掉统一信封，直接是 `data`；失败抛
 */

/**
 * 队伍进度汇总行（`listProgressTeams()` 的 `items[]`）。
 * @typedef {Object} ProgressTeamRow
 * @property {number} teamId 队伍 id
 * @property {string} name 队伍名
 * @property {1|2|3|4} status 统一状态码：`1` 已解散、`2` 正常、`3` 禁言、`4` 封禁（按到期归一）
 * @property {string|null} confirmedAt 确认参赛时间
 * @property {number} memberCount 在职成员数
 * @property {number} solvedCount 已解题目数
 * @property {number} totalPuzzles 当前题库题目总数
 * @property {number} score 得分
 * @property {string|null} firstSolveAt 首次通过时间；一题未解为 `null`
 * @property {string|null} lastSolveAt 最近一次通过时间
 * @property {string|null} lastPuzzle 最近通过的题目 key
 */

/**
 * 单队时间线里的队伍信息（`getProgressTeam()` 的 `data.team`）。
 * @typedef {Object} ProgressTeamInfo
 * @property {number} teamId 队伍 id
 * @property {string} name 队伍名
 * @property {1|2|3|4} status 统一状态码（同 `ProgressTeamRow.status`）
 * @property {string|null} confirmedAt 确认参赛时间
 * @property {string|null} banReason 封禁原因；未封禁为 `null`
 * @property {string|null} banUntil 封禁到期时间；`null` = 永久或未封禁
 * @property {string|null} muteReason 禁言原因；未禁言为 `null`
 * @property {string|null} muteUntil 禁言到期时间；`null` = 永久或未禁言
 */

/**
 * 单队逐题进度。
 * @typedef {Object} TeamPuzzleProgress
 * @property {string} key 题目 key
 * @property {string} title 题目标题
 * @property {number} ord 展示序号
 * @property {boolean} solved 该队是否已解
 * @property {string|null} solvedAt 通过时间；未解为 `null`
 * @property {string|null} firstTakenAt 首次取题时间（2026-11-06 起；历史题 / 未取题为 `null`）
 * @property {{ accountId: number, username: string }|null} solvedBy 解出者；未解为 `null`
 * @property {number|null} durationMs 该题耗时（毫秒）；未解为 `null`
 * @property {number} attempts 提交次数（**含答错与已解后的重复提交**）
 */

/**
 * 单队已达成的里程碑。
 * @typedef {Object} TeamMilestone
 * @property {string} key 里程碑标识
 * @property {string} title 标题
 * @property {string} kind 类型（如 `count`）
 * @property {number} tipsReward 提示点奖励（GET 侧为 camelCase）
 * @property {string} hitAt 达成时间
 */

/**
 * 单队时间线（`getProgressTeam()` 的 `data`）。
 * @typedef {Object} ProgressTeamDetail
 * @property {ProgressTeamInfo} team 队伍信息（含封禁 / 禁言字段）
 * @property {TeamPuzzleProgress[]} puzzles 逐题进度（按题目顺序；未通过题 `solved=false`、`solvedAt=null`）
 * @property {TeamMilestone[]} milestones 已达成的里程碑；无则 `[]`
 */

/**
 * 矩阵的列（题目）。
 * @typedef {Object} MatrixPuzzle
 * @property {string} key 题目 key
 * @property {string} title 题目标题
 * @property {number} ord 展示序号（前端按它排列表头，保证各队横向对照同一序列）
 */

/**
 * 矩阵的行（队伍）。
 * @typedef {Object} MatrixTeam
 * @property {number} teamId 队伍 id
 * @property {string} name 队伍名
 * @property {1|2|3|4} status 统一状态码
 * @property {Object<string, string|null>} cells 题目 key → 首次通过时间；未通过为 `null`
 * @property {Object<string, number|null>} durations 题目 key → **通过时长**（毫秒 =
 *   首次通过时间 − 首次取题时间）；缺取题记录 / 先解后取等异常为 `null`
 */

/**
 * 队伍 × 题目矩阵（`getProgressMatrix()` 的 `data`，当前页）。
 * @typedef {Object} ProgressMatrix
 * @property {MatrixPuzzle[]} puzzles 列（按题目顺序）
 * @property {MatrixTeam[]} teams 当前页的行
 * @property {number} page 当前页（从 1 起）
 * @property {number} limit 每页条数
 * @property {number} total 符合筛选的队伍总数
 * @property {boolean} hasMore 是否还有下一页
 */

/**
 * 提交记录行。
 * @typedef {Object} SubmissionRow
 * @property {number} id 提交 id
 * @property {number} teamId 队伍 id
 * @property {number} accountId 提交人账号 id
 * @property {string} username 提交人用户名
 * @property {string} puzzleKey 题目 key
 * @property {boolean} correct 是否判定通过
 * @property {number|null} durationMs 本题耗时（毫秒）
 * @property {string} createdAt 提交时间
 * @property {string} [answer] 答案原文；**仅 `with_answer=1` 时下发**，默认无此字段
 */

/**
 * `http.request` 抛出的接口错误；后端 `error` 对象挂在 `error.detail` 上。
 * @typedef {import("./http").ApiError} ApiError
 */

/**
 * 队伍进度汇总列表（按队伍 id 倒序分页）。
 *
 * - 接口：`GET /api/admin/progress/teams`
 * - 鉴权：**仅 admin**（staff 403，2026-11-06 起）
 * - 文档：api-9-admin.md「`GET /api/admin/progress/teams`」
 *
 * @param {Object} [params]
 * @param {0|1|2|3|4} [params.status=0] 统一状态码：`1` 已解散、`2` 正常、`3` 禁言、`4` 封禁；
 *   缺省或 `0` = 全部，范围外 → `400`
 * @param {number} [params.cursor=0] 取 id 小于游标的记录（传上一页 `nextCursor`）
 * @param {number} [params.limit=50] 每页条数（1–100）
 * @returns {Promise<{ items: ProgressTeamRow[], nextCursor: number|null, hasMore: boolean }>}
 *   `data` 本体
 * @throws {ApiError}
 *   - 400 `E_VALIDATION`：`status` 不在 0–4、`limit` 越界
 *     detail.fields：
 *       `status` -- 不在 0–4
 *       `limit` -- 不在 1–100
 *   - 401 `E_AUTH`：未登录或令牌失效
 *   - 403 `E_FORBIDDEN`：不是 admin（含 staff）
 */
export const listProgressTeams = (params) =>
    get("/admin/progress/teams", params);

/**
 * 单队时间线：队伍信息 + 逐题通过情况 + 已达成的里程碑。
 *
 * - 接口：`GET /api/admin/progress/team/:id`
 * - 鉴权：**仅 admin**（staff 403）
 * - 文档：api-9-admin.md「`GET /api/admin/progress/team/:id`」
 *
 * @param {number} id 队伍 id
 * @returns {Promise<ProgressTeamDetail>} `data` 本体
 * @throws {ApiError}
 *   - 400 `E_VALIDATION`：`:id` 不是正整数
 *   - 401 `E_AUTH`：未登录或令牌失效
 *   - 403 `E_FORBIDDEN`：不是 admin（含 staff）
 *   - 404 `E_NOT_FOUND`：队伍不存在
 */
export const getProgressTeam = (id) => get(`/admin/progress/team/${id}`);

/**
 * 队伍 × 题目矩阵：每队每题首次通过时间 `cells` + 通过时长 `durations`。
 *
 * - 接口：`GET /api/admin/progress/matrix`
 * - 鉴权：**仅 admin**（staff 403）
 * - 文档：api-9-admin.md「`GET /api/admin/progress/matrix`」
 *
 * @param {Object} [params]
 * @param {0|1|2|3|4} [params.status=2] 统一状态码；缺省 `2`（与旧默认等价），`0` = 全部
 * @param {string} [params.puzzle_key] 只返回该题一列；`sort=solved_at|duration` 时**必填**，
 *   题目不存在 / 已停用 → `400`
 * @param {number} [params.team_id] 只返回该队一行
 * @param {"team_id"|"solved_at"|"duration"} [params.sort="team_id"] `solved_at` 按通关时间、
 *   `duration` 按通关时长
 * @param {"asc"|"desc"} [params.order] `team_id` 缺省 `desc`（保持旧顺序），指标类缺省 `asc`
 * @param {number} [params.page=1] 页码（≥1，**新分页**）
 * @param {number} [params.limit=200] 每页队伍数（1–500）；旧参数 `limit_teams` 仍兼容，
 *   两者都传时 `limit` 优先
 * @param {{ signal?: AbortSignal }} [options] 请求选项：只透传 `signal`，
 *   配合 `http.requestLatest()` 让同一频道的旧请求被中止（见 `ProgressMatrixView`）
 * @returns {Promise<ProgressMatrix>} `data` 本体
 * @throws {ApiError}
 *   - 400 `E_VALIDATION`：参数非法
 *     detail.fields：
 *       `status` -- 不在 0–4
 *       `puzzle_key` -- 题目不存在 / 已停用，或指标排序时缺失
 *       `limit` -- 不在 1–500
 *       `page` -- 小于 1
 *   - 401 `E_AUTH`：未登录或令牌失效
 *   - 403 `E_FORBIDDEN`：不是 admin（含 staff）
 */
export const getProgressMatrix = (params, options) =>
    get("/admin/progress/matrix", params, options);

/**
 * 提交历史（可按队伍 / 账号 / 题目筛选）。
 *
 * - 接口：`GET /api/admin/progress/submissions`
 * - 鉴权：**仅 admin**（staff 403）
 * - 文档：api-9-admin.md「`GET /api/admin/progress/submissions`」
 *
 * @param {Object} [params]
 * @param {number} [params.team_id] 按队伍筛选
 * @param {number} [params.account_id] 按账号筛选
 * @param {string} [params.puzzle_key] 按题目筛选
 * @param {number} [params.cursor=0] 取 id 小于游标的记录（传上一页 `nextCursor`）
 * @param {number} [params.limit=50] 每页条数（1–100）
 * @param {boolean|0|1} [params.with_answer] 传 `1` 时每行额外返回 `answer` 原文
 * @returns {Promise<{ items: SubmissionRow[], nextCursor: number|null, hasMore: boolean }>}
 *   `data` 本体
 * @throws {ApiError}
 *   - 400 `E_VALIDATION`：`limit` 越界 / `team_id` / `account_id` 不是正整数
 *   - 401 `E_AUTH`：未登录或令牌失效
 *   - 403 `E_FORBIDDEN`：不是 admin（含 staff）
 */
export const listSubmissions = (params) =>
    get("/admin/progress/submissions", params);
