import { post } from "./http";

// 管理端复用玩家侧登录接口，staff/admin 账号登录后由 account.role 决定权限。
export function apiLogin(payload) {
    return post("/auth/login", payload);
}

export function apiLogout() {
    return post("/auth/logout");
}
