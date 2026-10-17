// 统一请求封装
// 管理端 API 前缀由 VITE_API_BASE_PATH 配置，并映射到后端 /api/* 路径。
// 与站点其它子项目保持一致；登录态为 Bearer access_token。
import { apiConfig, buildApiUrl, getApiHeaders } from "@/config/api";

export class ApiError extends Error {
    constructor(status, message, detail) {
        super(message || "请求失败");
        this.name = "ApiError";
        this.status = status;
        this.detail = detail || {};
    }
}

export function getToken() {
    return localStorage.getItem(apiConfig.tokenKey);
}

export function setToken(token) {
    if (token) localStorage.setItem(apiConfig.tokenKey, token);
    else localStorage.removeItem(apiConfig.tokenKey);
}

export function clearSession() {
    localStorage.removeItem(apiConfig.tokenKey);
    localStorage.removeItem("admin_account");
}

// 登录时保存的账号快照（含 permissions）。会话还原 / 刷新令牌后要用新快照覆盖它，
// 否则被授予权限组的 staff 要等到重新登录才看得到新入口。
const ACCOUNT_KEY = "admin_account";

export function getStoredAccount() {
    try {
        return JSON.parse(localStorage.getItem(ACCOUNT_KEY));
    } catch {
        return null;
    }
}

export function setStoredAccount(account) {
    if (account) localStorage.setItem(ACCOUNT_KEY, JSON.stringify(account));
    else localStorage.removeItem(ACCOUNT_KEY);
}

// 拼接查询参数（跳过空值）
export function buildQuery(params = {}) {
    const usp = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
        if (v === undefined || v === null || v === "") continue;
        usp.set(k, String(v));
    }
    const qs = usp.toString();
    return qs ? `?${qs}` : "";
}

// 刷新访问令牌，并顺带取回最新的账号快照（POST /auth/refresh 的响应带 account.permissions）。
// 依赖 /api/auth 路径下的 httpOnly Cookie；代理未正确转发 Cookie 时静默失败，由调用方走登出流程。
// 每次刷新都会轮换令牌，因此并发调用复用同一个 Promise。
let refreshing = null;
export function refreshSession() {
    if (!getToken()) return Promise.resolve(null);
    if (refreshing) return refreshing;
    refreshing = (async () => {
        try {
            const r = await fetch(buildApiUrl("/auth/refresh"), {
                method: "POST",
                headers: getApiHeaders(),
                credentials: "include",
            });
            const j = await r.json().catch(() => null);
            if (r.ok && j?.data?.access_token) {
                setToken(j.data.access_token);
                const account = j.data.account || null;
                if (account) {
                    setStoredAccount(account);
                    // 通知已在运行的 store 更新权限（页面不刷新也能看到新入口）
                    window.dispatchEvent(
                        new window.CustomEvent("admin:account-updated", {
                            detail: account,
                        }),
                    );
                }
                return { token: j.data.access_token, account };
            }
            return null;
        } catch {
            return null;
        } finally {
            setTimeout(() => {
                refreshing = null;
            }, 0);
        }
    })();
    return refreshing;
}

// 核心请求：返回响应体中的 data 字段；ok:false 或非 2xx 抛 ApiError
export async function request(path, { method = "GET", body } = {}) {
    const headers = getApiHeaders();
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;

    const res = await fetch(buildApiUrl(path), {
        method,
        headers,
        credentials: "include",
        body: body === undefined ? undefined : JSON.stringify(body),
    });

    let json = null;
    try {
        json = await res.json();
    } catch {
        // 非 JSON 响应
    }

    // 令牌失效：先尝试刷新后重试一次（刷新响应会带回最新的账号权限快照）
    if (res.status === 401) {
        const refreshed = await refreshSession();
        if (refreshed) {
            return request(path, { method, body });
        }
        clearSession();
        window.dispatchEvent(new window.Event("admin:unauthorized"));
        throw new ApiError(
            401,
            json?.error?.message || "未登录或令牌已失效",
            json?.error,
        );
    }

    if (!res.ok || (json && json.ok === false)) {
        const detail = json?.error || {};
        throw new ApiError(
            res.status,
            detail.message || `请求失败（${res.status}）`,
            detail,
        );
    }

    return json?.data;
}

export const get = (path, params) => request(`${path}${buildQuery(params)}`);
export const post = (path, body) => request(path, { method: "POST", body });
export const put = (path, body) => request(path, { method: "PUT", body });
export const del = (path) => request(path, { method: "DELETE" });
