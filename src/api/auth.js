import { get, post } from "./http";

// 管理端复用玩家侧登录接口，staff/admin 账号登录后由 account.role 决定权限。
export function apiLogin(payload) {
    return post("/auth/login", payload);
}

export function apiLogout() {
    return post("/auth/logout");
}

// ---- 注册链路（契约见 api-3-registration.md，与玩家端完全一致） ----
// 注意：reg/verify 建出来的账号 role 固定为 player，后台接口要求 staff/admin，
// 所以注册成功不等于能进后台，调用方要按角色分流。

// 3.1 公开配置：人机验证 provider、验证码长度 / 有效期、重发冷却、口令长度
export function apiRegistrationConfig() {
    return get("/auth/reg/config");
}

// 3.2 发送验证码（同一邮箱只发第一次，重发走 3.3）
export function apiSendRegisterCode(payload) {
    return post("/auth/reg/start", payload);
}

// 3.3 重新发送验证码
export function apiResendRegisterCode(payload) {
    return post("/auth/reg/resend", payload);
}

// 3.4 提交验证码 + 用户名（+ 可选口令），建号并直接登录
export function apiVerifyRegistration(payload) {
    return post("/auth/reg/verify", payload);
}

// 第五节 用户名可用性（建议性检查，最终判定在 3.4）
export function apiUsernameAvailable(username) {
    return post("/auth/username-available", { username });
}

// 4.5 找回密码：向邮箱发送重置令牌（响应恒定，不透露账号是否存在）
export function apiForgotPassword(payload) {
    return post("/auth/forgot", payload);
}

// 4.5 用邮件里的令牌重置密码
export function apiResetPassword(payload) {
    return post("/auth/reset", payload);
}
