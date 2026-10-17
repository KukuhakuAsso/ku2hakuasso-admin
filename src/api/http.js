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

// 登录时保存的账号快照（含 permissions）。会话还原 / 刷新令牌后要用新快照覆盖它，
// 否则被授予权限组的 staff 要等到重新登录才看得到新入口。
const ACCOUNT_KEY = "admin_account";

// 会话代次：登出、清空会话、换账号登录都会 +1。刷新令牌是异步的，
// 若期间会话已被清空或换成别的账号，迟到的刷新结果必须丢弃 ——
// 否则会把旧账号的令牌与权限写回来（登出失效 / 新登录的身份被顶替）。
let sessionGeneration = 0;

export function beginNewSession() {
    sessionGeneration += 1;
}

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

export function clearSession() {
    beginNewSession();
    localStorage.removeItem(apiConfig.tokenKey);
    localStorage.removeItem(ACCOUNT_KEY);
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
// 每次刷新都会轮换令牌，因此同一会话代次内并发调用复用同一个 Promise；
// 会话代次变了（登出 / 换账号）就不再复用旧请求，且旧请求的结果会被丢弃。
let refreshing = null;
let refreshingGeneration = -1;

export function refreshSession() {
    const generation = sessionGeneration;
    if (!getToken()) return Promise.resolve(null);
    if (refreshing && refreshingGeneration === generation) return refreshing;

    refreshingGeneration = generation;
    refreshing = (async () => {
        try {
            const r = await fetch(buildApiUrl("/auth/refresh"), {
                method: "POST",
                headers: getApiHeaders(),
                credentials: "include",
            });
            const j = await r.json().catch(() => null);
            if (r.ok && j?.data?.access_token) {
                // 刷新期间登出或换了账号 → 这次结果属于旧会话，整份丢弃
                if (generation !== sessionGeneration) return null;
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
                // 只清自己这一代次的缓存；更新的一代次可能已经发起新刷新
                if (refreshingGeneration === generation) {
                    refreshing = null;
                    refreshingGeneration = -1;
                }
            }, 0);
        }
    })();
    return refreshing;
}

// 核心请求：返回响应体中的 data 字段；ok:false 或非 2xx 抛 ApiError。
// retried 只由 401 分支内部使用：刷新令牌后只重试一次，避免「刷新成功但仍 401」时无限递归。
export async function request(path, { method = "GET", body, retried = false } = {}) {
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
        const generation = sessionGeneration;
        // 已经刷新并重试过仍 401（令牌被撤销 / token_version 变了）→ 结束会话，不再递归
        if (retried) {
            if (generation === sessionGeneration) {
                clearSession();
                window.dispatchEvent(new window.Event("admin:unauthorized"));
            }
            throw new ApiError(
                401,
                json?.error?.message || "未登录或令牌已失效",
                json?.error,
            );
        }
        const refreshed = await refreshSession();
        if (refreshed) {
            return request(path, { method, body, retried: true });
        }
        // 刷新期间已经登出或换成别的账号：不要动新会话，只把这次请求判失败
        if (generation !== sessionGeneration) {
            throw new ApiError(
                401,
                json?.error?.message || "登录状态已变化，请重新操作",
                json?.error,
            );
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
