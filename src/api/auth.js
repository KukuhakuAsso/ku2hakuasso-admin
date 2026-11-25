import { get, post } from "./http";

/**
 * @file 管理端认证 / 注册接口（`/api/auth/*`，复用玩家侧契约）。
 *
 * 约定：
 * - `http.request` 已剥掉统一信封：成功时直接返回响应体里的 `data`；
 *   失败时抛 {@link AdminApiError}，后端 `error` 对象整体挂在 `error.detail` 上，
 *   因此文档里的 `detail.fields` / `detail.reason_code` 运行时读作 `error.detail.detail.*`。
 * - 请求参数与错误码以文档为准：api-3-registration.md（注册）、api-4-authentication.md（登录与会话）、
 *   api-5-username-management.md（用户名）。
 */

/**
 * 登录 / 注册成功后的账号快照。
 * @typedef {Object} AuthAccount
 * @property {number} id 账号 id
 * @property {string} player_no 玩家编号，如 `M2000001`
 * @property {string} username 用户名
 * @property {"player"|"captain"|"staff"|"admin"} role 角色；后台接口要求 staff / admin
 * @property {{ id: number, name: string } | null} team 所属队伍；未加入队伍为 `null`
 * @property {string[]} [permissions] 权限码清单；登录与刷新下发，`admin` 由角色默认拥有全部权限
 * @property {1|2|3|4} [status] 账号状态：1 注销、2 正常、3 禁言、4 封禁
 * @property {boolean} [banned] 封禁标记，与 `status=4` 同义（含所在队伍被封禁）
 */

/**
 * 人机验证信封：把验证组件产出的凭据放进 `response` 原样回传，
 * 不要按 provider 改名、拼接、裁剪或转码。
 * @typedef {Object} CaptchaEnvelope
 * @property {string} response 验证组件产出的凭据
 */

/**
 * 登录 / 注册即登录的响应数据体。
 * @typedef {Object} AuthSessionData
 * @property {string} access_token 访问令牌（2 小时）；本层不落盘，需调用方 `setToken()`
 * @property {number} expires_in 访问令牌有效期（秒，通常 7200）
 * @property {AuthAccount} account 账号快照
 */

/**
 * 注册页公开配置。
 * @typedef {Object} RegistrationConfig
 * @property {Object} captcha 人机验证配置
 * @property {string} captcha.mode 仅供展示与排障，前端**不得**据此分支
 * @property {boolean} captcha.enabled `false` 时不渲染验证组件
 * @property {boolean} captcha.ready `false` 时不要渲染组件，只提示暂不可注册
 * @property {string} [captcha.script] 组件脚本地址，由后端下发，不要写死
 * @property {{ driver: string, params: Object } | null} [captcha.widget] 前端只认这个对象，`params` 原样转交
 * @property {string} [captcha.site_key] 兼容期根级字段
 * @property {string[]} [captcha.test_hosts] 需要 `dev_ticket` 的测试域名
 * @property {boolean} [captcha.test_ticket_required] 测试域名是否必须带 `dev_ticket`
 * @property {number} code_length 验证码位数
 * @property {number} code_ttl_minutes 验证码有效期（分钟）
 * @property {number} resend_cooldown_sec 重新发送冷却（秒）
 * @property {number} password_min_length 密码最小长度
 * @property {number} password_max_length 密码最大长度
 */

/**
 * 验证码邮件下发结果。
 * @typedef {Object} VerificationCodeData
 * @property {boolean} sent 是否已发出
 * @property {string} email 脱敏后的收件地址，如 `qq***@outlook.com`
 * @property {number} ttl_minutes 有效期（分钟）
 * @property {string} expires_at 过期时间（ISO 8601）
 */

/**
 * `http.request` 抛出的接口错误；后端 `error` 对象挂在 `error.detail` 上。
 * @typedef {import("./http").ApiError} AdminApiError
 */

/**
 * 管理端登录（与玩家端同一接口，staff / admin 账号登录后由 `account.role` 决定权限）。
 *
 * - 接口：`POST /api/auth/login`
 * - 鉴权：无
 * - 文档：api-4-authentication.md §4.1
 *
 * @param {Object} payload 登录凭据
 * @param {"email"|"username"|"player_no"} payload.type 标识类型（管理端登录表单三种都提供；
 *   玩家端已弃用 `player_no`）
 * @param {string} payload.identifier 登录标识，大小写不敏感：
 *   `type=email` 传邮箱，`type=username` 传用户名，`type=player_no` 传玩家编号（如 `M2000001`）
 * @param {string} payload.password 密码
 * @returns {Promise<AuthSessionData>} 响应 `data` 本体；令牌需调用方自行 `setToken()`
 * @throws {AdminApiError}
 *   - 400 `E_VALIDATION`：登录参数校验失败
 *     detail.fields：
 *       `type` -- 缺失或取值不支持
 *       `identifier` -- 缺失或与 `type` 不匹配
 *   - 401 `E_AUTH`：账号或密码错误（统一文案，不透露账号是否存在）
 *   - 429 `E_QUOTA`：连续失败 5 次后锁定 15 分钟，按 `detail.retry_after_sec` 倒计时
 *
 */
export function apiLogin(payload) {
    return post("/auth/login", payload);
}

/**
 * 注销当前会话。
 *
 * - 接口：`POST /api/auth/logout`
 * - 认证：`mistarg_rt` Cookie（幂等：没带有效令牌也返回成功）
 * - 文档：api-4-authentication.md §4.3
 *
 * @returns {Promise<{ loggedOut: true, revoked: boolean }>} 响应 `data` 本体；
 *   `loggedOut` 恒为 `true`，`revoked` 表示是否真的撤销了一条刷新令牌（幂等分支可能为 `false`）
 * @throws {AdminApiError}
 *   - 网络或服务端异常 -- `stores/auth.js` 会吞掉该错误继续本地登出
 */
export function apiLogout() {
    return post("/auth/logout");
}

// ---- 注册链路（契约见 api-3-registration.md，与玩家端完全一致） ----

/**
 * 读取注册页公开配置。
 *
 * - 接口：`GET /api/auth/reg/config`
 * - 鉴权：无
 * - 文档：api-3-registration.md §3.1
 *
 * @returns {Promise<RegistrationConfig>} `captcha.ready=false` 时不要渲染验证组件，
 *   只提示「暂不可用」
 * @throws {AdminApiError}
 *   - 网络或服务端异常 -- 公开配置取不到时应让注册链路降级为「暂不可注册」
 */
export function apiRegistrationConfig() {
    return get("/auth/reg/config");
}

/**
 * 发送注册验证码邮件（**只发第一次**）。
 *
 * - 接口：`POST /api/auth/reg/start`
 * - 鉴权：无
 * - 文档：api-3-registration.md §3.2
 *
 * 本接口只提交邮箱：`username` / `password` 在 3.4 提交，传到这里会被静默忽略；
 *
 * @param {Object} payload
 * @param {string} payload.email 注册邮箱（≤128 字符，需能收信）
 * @param {CaptchaEnvelope} [payload.captcha] `captcha.enabled=true` 时必填
 * @param {string} [payload.dev_ticket] 测试域名需要，见 `reg/config` 的 `test_hosts`
 * @param {string} [payload.platform] 注册来源（≤16 字符，可选）
 * @param {string} [payload.platform_uid] 注册来源账号标识（≤64 字符，可选）
 * @returns {Promise<VerificationCodeData>} 成功状态码为 201，`email` 为脱敏地址
 * @throws {AdminApiError}
 *   - 400 `E_VALIDATION`：注册参数校验失败
 *     detail.fields：
 *       `email`：`必填` -- 缺失 / 空串 / 纯空白
 *       `email`：`长度最多 128` -- 超过 128 字符
 *       `email`：`邮箱格式不正确` -- 语法非法
 *       `email`：`该邮箱域名不存在或无法接收邮件，请检查后重试` -- 域名收不到信
 *       `platform`：`长度最多 16` -- 注册来源超长
 *       `platform_uid`：`长度最多 64` -- 来源账号标识超长
 *   - 403 `E_FORBIDDEN`：人机验证失败
 *     detail.reason_code：
 *       `CAPTCHA_MISSING` -- 未提交凭据；提示先完成人机验证并高亮组件
 *       `CAPTCHA_INVALID` -- 凭据已用 / 过期 / 无效；重置组件后重试
 *       `CAPTCHA_TEST_TICKET_REQUIRED` -- 测试域名缺 `dev_ticket`；提示补凭证
 *       `CAPTCHA_HOST_MISMATCH` -- 票的 hostname 与站点不符；提示联系管理员并重置组件
 *       `CAPTCHA_UNAVAILABLE` -- 校验服务网络异常 / 超时；提示稍后重试，不要自动重试
 *       `CAPTCHA_MISCONFIGURED` -- 服务端人机验证异常；提示稍后重试，可上报监控
 *       `CAPTCHA_NOT_READY` -- 人机验证未就绪；提示注册暂不可用
 *   - 409 `E_CONFLICT`：邮箱已注册（`detail.player_no` 可用于引导登录 / 找回）
 *   - 429 `E_QUOTA`：发送过于频繁
 *     detail.reason_code：
 *       `REG_VERIFY_PENDING` -- 该邮箱已有未消费验证码；改调 `apiResendRegisterCode()`
 *                               并按 `detail.resend_after_sec` 倒计时
 *       `空` -- 每日额度用尽（每 IP 10 封，与重发共用）；按 `detail.retry_after_sec` 等待
 */
export function apiSendRegisterCode(payload) {
    return post("/auth/reg/start", payload);
}

/**
 * 重新发送注册验证码（作废旧码，有效期从这一刻重新计时）。
 *
 * - 接口：`POST /api/auth/reg/resend`
 * - 鉴权：无
 * - 文档：api-3-registration.md §3.3
 *
 * @param {Object} payload
 * @param {string} payload.email 必须与 `apiSendRegisterCode()` 提交的是同一个邮箱
 * @param {CaptchaEnvelope} [payload.captcha] `captcha.enabled=true` 时必填，与发送接口同一套人机验证
 * @param {string} [payload.dev_ticket] 测试域名需要
 * @returns {Promise<VerificationCodeData>} 与发送接口同形状（201），可复用同一段解析与提示
 * @throws {AdminApiError}
 *   - 400 `E_VALIDATION`：注册参数校验失败
 *     detail.fields：
 *       `email`：`必填` -- 缺失 / 空串 / 纯空白
 *       `email`：`长度最多 128` -- 超过 128 字符
 *       `email`：`邮箱格式不正确` -- 语法非法
 *       `email`：`该邮箱域名不存在或无法接收邮件，请检查后重试` -- 域名收不到信
 *   - 403 `E_FORBIDDEN`：人机验证失败
 *     detail.reason_code：
 *       `CAPTCHA_MISSING` -- 未提交凭据；提示先完成人机验证并高亮组件
 *       `CAPTCHA_INVALID` -- 凭据已用 / 过期 / 无效；重置组件后重试
 *       `CAPTCHA_TEST_TICKET_REQUIRED` -- 测试域名缺 `dev_ticket`；提示补凭证
 *       `CAPTCHA_HOST_MISMATCH` -- 票的 hostname 与站点不符；提示联系管理员并重置组件
 *       `CAPTCHA_UNAVAILABLE` -- 校验服务网络异常 / 超时；提示稍后重试，不要自动重试
 *       `CAPTCHA_MISCONFIGURED` -- 服务端人机验证异常；提示稍后重试，可上报监控
 *       `CAPTCHA_NOT_READY` -- 人机验证未就绪；提示注册暂不可用
 *   - 409 `E_CONFLICT`：该邮箱没有进行中的注册验证（退回第一步重新开始），或已注册成功
 *   - 429 `E_QUOTA`：同邮箱 60 秒冷却（`detail.retry_after_sec`），或每 IP 每日额度用尽
 */
export function apiResendRegisterCode(payload) {
    return post("/auth/reg/resend", payload);
}

/**
 * 提交验证码 + 用户名完成注册（注册即登录）。
 *
 * - 接口：`POST /api/auth/reg/verify`
 * - 鉴权：无
 * - 文档：api-3-registration.md §3.4
 *
 * 建出来的账号 `role` 固定为 `player`，而后台接口要求 staff / admin：
 *
 * @param {Object} payload
 * @param {string} payload.email 与第一步提交的**同一个**邮箱
 * @param {string} payload.code 邮件中的验证码（位数见 `reg/config.code_length`）
 * @param {string} payload.username 用户名，规则见 `apiUsernameAvailable()`
 * @param {string} [payload.password] 自设密码（8–128 位，不 trim；空串 / 纯空白等同不填）。
 *   不填则由系统生成初始密码并发邮件
 * @returns {Promise<AuthSessionData & {
 *   initial_password_mailed?: boolean, initial_password?: string }>}
 *   成功后可用 `access_token` + `account` 直接建立会话。密码交付分支：
 *   自设密码 → 两个字段都不存在；未设密码且邮件已发 → `initial_password_mailed: true`；
 *   未设密码且邮件**未投递** → `initial_password_mailed: false` 且回传 `initial_password`，
 *   须显著展示并要求用户保存后立刻改密
 * @throws {AdminApiError}
 *   - 400 `E_VALIDATION`：注册参数校验失败（每字段只给第一条原因）
 *     detail.fields：
 *       `email`：`必填` -- 缺失 / 空串 / 纯空白
 *       `email`：`长度最多 128` -- 超过 128 字符
 *       `email`：`邮箱格式不正确` -- 语法非法
 *       `email`：`该邮箱域名不存在或无法接收邮件，请检查后重试` -- 域名收不到信
 *       `code`：`必填` -- 缺失 / 空串 / 纯空白
 *       `code`：`长度最多 8` -- 超过 8 字符
 *       `code`：`应为 6 位数字` -- 形如 `12ab` / `1234`
 *       `username`：`必填` -- 缺失 / 空串 / 纯空白
 *       `username`：`长度最多 32` -- 超过 32 个码点
 *       `username`：`用户名不能包含 @` -- 含 `@`
 *       `username`：`用户名不能包含不可见字符、组合音标或符号（U+xxxx）` -- 含不可见字符、组合音标或 emoji
 *       `username`：`用户名不能包含空格以外的空白、控制字符或方括号以外的符号` -- 含控制字符、全角空白等
 *       `username`：`用户名不能采用 M2+6位数字 的编号格式` -- 形如 `M2000001`
 *       `password`：`长度至少 8` -- 提交了值但不足 8 位
 *       `password`：`长度最多 128` -- 提交了值但超过 128 位（不传 / 空串时不会出现该键）
 *   - 400 `E_CODE`：验证码无效、过期或错误（`detail.attempts_left` 为剩余次数，单码最多 5 次）
 *   - 409 `E_CONFLICT`：用户名已被占用
 *     detail.username：
 *       `true` -- 验证码不会被消费，改名后可用同一张码重试，不必重新收码
 */
export function apiVerifyRegistration(payload) {
    return post("/auth/reg/verify", payload);
}

/**
 * 检查用户名是否可用。
 *
 * - 接口：`POST /api/auth/username-available`
 * - 鉴权：无（登录后调用可返回 `unchanged`）
 * - 文档：api-5-username-management.md §五
 *
 * @param {string} username 待检查的用户名（1–32 个 Unicode 码点；
 *   禁止 `@`、路径分隔符、不可见字符、emoji、`M2` + 6 位数字）
 * @returns {Promise<{ status: "available"|"taken"|"unchanged", available: boolean, username: string }>}
 *   `status=available` 允许提交、`taken` 提示更换、`unchanged` 无需更改（仅登录后）；
 *   `available` 是 `status === "available"` 的便捷布尔；
 *   `username` 已去除首尾空白并执行 NFC 归一化
 * @throws {AdminApiError}
 *   - 400 `E_VALIDATION`：用户名不合规
 *     detail.fields：
 *       `username`：`必填` -- 缺失 / 空串 / 纯空白
 *       `username`：`长度最多 32` -- 超过 32 个码点
 *       `username`：`用户名不能包含 @` -- 含 `@`
 *       `username`：`用户名不能包含不可见字符、组合音标或符号（U+xxxx）` -- 含不可见字符、组合音标或 emoji
 *       `username`：`用户名不能包含空格以外的空白、控制字符或方括号以外的符号` -- 含控制字符、全角空白等
 *       `username`：`用户名不能采用 M2+6位数字 的编号格式` -- 形如 `M2000001`
 *   - 429 `E_QUOTA`：检查过于频繁（20 次/秒；每账号或 IP 每天 200 次）
 */
export function apiUsernameAvailable(username) {
    return post("/auth/username-available", { username });
}

/**
 * 找回密码第一步：发送重置邮件。
 *
 * - 接口：`POST /api/auth/forgot`
 * - 鉴权：无
 * - 文档：api-4-authentication.md §4.5
 *
 * @param {Object} payload
 * @param {"email"|"username"} payload.type 标识类型
 * @param {string} payload.identifier 邮箱或用户名
 * @param {CaptchaEnvelope} payload.captcha 人机验证凭据（必填）
 * @param {string} [payload.dev_ticket] 测试域名需要
 * @returns {Promise<{ accepted: boolean, delivered: boolean, message: string }>}
 *   `accepted` 恒为 `true`（与账号是否存在无关）；`delivered=false` 不代表账号不存在；
 *   `message` 是固定提示「若该账号存在，我们已发送重置邮件」，可直接展示
 * @throws {AdminApiError}
 *   - 400 `E_VALIDATION`：参数校验失败（`detail.fields` 给具体字段原因）
 *   - 403 `E_FORBIDDEN`：人机验证失败
 *     detail.reason_code：
 *       `CAPTCHA_MISSING` -- 未提交凭据；提示先完成人机验证并高亮组件
 *       `CAPTCHA_INVALID` -- 凭据已用 / 过期 / 无效；重置组件后重试
 *       `CAPTCHA_TEST_TICKET_REQUIRED` -- 测试域名缺 `dev_ticket`；提示补凭证
 *       `CAPTCHA_HOST_MISMATCH` -- 票的 hostname 与站点不符；提示联系管理员并重置组件
 *       `CAPTCHA_UNAVAILABLE` -- 校验服务网络异常 / 超时；提示稍后重试，不要自动重试
 *       `CAPTCHA_MISCONFIGURED` -- 服务端人机验证异常；提示稍后重试，可上报监控
 *       `CAPTCHA_NOT_READY` -- 人机验证未就绪；提示注册暂不可用
 *   - 429 `E_QUOTA`：每个 IP 每天最多 3 次
 */
export function apiForgotPassword(payload) {
    return post("/auth/forgot", payload);
}

/**
 * 找回密码第二步：用邮件里的令牌重置密码。
 *
 * - 接口：`POST /api/auth/reset`
 * - 鉴权：无
 * - 文档：api-4-authentication.md §4.5
 *
 * 重置成功后该账号的**全部会话失效**（token_version +1 并清空刷新令牌）。
 *
 * @param {Object} payload
 * @param {string} payload.token 邮件中的重置令牌
 * @param {string} payload.new_password 新密码（≥8 位、≤128 位）
 * @returns {Promise<{ reset: true }>} 响应 `data` 本体；`reset` 恒为 `true`
 * @throws {AdminApiError}
 *   - 400 `E_VALIDATION`：密码不合规
 *     detail.fields：
 *       `new_password` -- 缺失 / 不足 8 位 / 超过 128 位
 *   - 401 `E_AUTH`：令牌无效或已使用
 */
export function apiResetPassword(payload) {
    return post("/auth/reset", payload);
}
