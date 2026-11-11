// 统一请求封装
// 管理端 API 前缀由 VITE_API_BASE_PATH 配置，并映射到后端 /api/* 路径。
// 与站点其它子项目保持一致；登录态为 Bearer access_token。
import { apiConfig, buildApiUrl, getApiHeaders, isApiUrl, resolveServerUrl } from "@/config/api";
import { extractErrorMessage } from "@/api/errors";

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
    // 旧会话的在飞请求全部作废：既省掉无用的往返，也保证它们的续体不会再写回界面
    cancelAllChannels();
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

// 请求所属的会话已被替换（登出 / 换账号）：只让这次请求失败，不触碰新会话
function staleSessionError(json) {
    return new ApiError(
        401,
        json?.error?.message || "登录状态已变化，请重新操作",
        json?.error,
    );
}

// 核心请求：返回响应体中的 data 字段；ok:false 或非 2xx 抛 ApiError。
// retried 只由 401 分支内部使用：刷新令牌后只重试一次，避免「刷新成功但仍 401」时无限递归。
// signal 用于取消：requestLatest() 会用它在同一频道换新请求时中断旧请求。
export async function request(path, { method = "GET", body, retried = false, signal } = {}) {
    // 发请求时就记账次：响应（尤其 401）回来时若会话已经换了，
    // 这次请求属于旧账号，不能拿它去刷新 / 清空新会话，也不能把它重放到新身份上。
    const requestGeneration = sessionGeneration;
    const headers = getApiHeaders();
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;

    const res = await fetch(buildApiUrl(path), {
        method,
        headers,
        credentials: "include",
        signal,
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
        // 这次请求是在旧会话里发出的（期间登出 / 换账号）：
        // 不刷新、不清空、也不重放，直接判失败
        if (requestGeneration !== sessionGeneration) {
            throw staleSessionError(json);
        }

        // 已经刷新并重试过仍 401（令牌被撤销 / token_version 变了）→ 结束会话，不再递归
        if (retried) {
            clearSession();
            window.dispatchEvent(new window.Event("admin:unauthorized"));
            throw new ApiError(
                401,
                json?.error?.message || "未登录或令牌已失效",
                json?.error,
            );
        }

        const refreshed = await refreshSession();
        // 刷新期间又登出 / 换了账号 → 同样丢弃这次请求，别动新会话
        if (requestGeneration !== sessionGeneration) {
            throw staleSessionError(json);
        }
        if (refreshed) {
            return request(path, { method, body, retried: true, signal });
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

// get / post / put / del 的第三个参数是可选的请求选项（目前只有 signal），
// 让「同频道最新一次生效」的调用方能把取消信号一路透到 fetch。
export const get = (path, params, options) =>
    request(`${path}${buildQuery(params)}`, options);
export const post = (path, body, options) =>
    request(path, { method: "POST", body, ...options });
export const put = (path, body, options) =>
    request(path, { method: "PUT", body, ...options });
export const del = (path, options) => request(path, { method: "DELETE", ...options });

// ---------------------------------------------------------------------------
// 「同频道只有最新一次生效」（请求层的代际守卫）
//
// 页面里普遍的竞争：快速改筛选 / 连点搜索 / 轮询与手动刷新同时发 → 先发的请求
// 后回来，把后发的结果覆盖掉（列表停在旧筛选上、分页错位）。
// 这一层提供原语：同一个 abortKey 上只保留最后一次，
//   ① 新请求会把旧请求 abort（省掉无用的往返）；
//   ② 响应回来时再比一次"我还是不是最新的一次"——只 abort 不够，
//      旧请求可能已经 resolve、续体还没跑完；
//   ③ 换会话（登出 / 换账号）后旧频道全部作废。
//
// 不能在这一层解决、仍要调用点自己判断的两件事：
//   · 「A → B → A」这类同一 URL 的来回切换：abortKey 必须按**目标**给（如题目 key），
//     且组件仍要比对"当前展示的还是不是这个目标"；
//   · 分页 append vs 整体替换、以及 await 之后的业务副作用（改余额、发事件等）。
// ---------------------------------------------------------------------------

// 被更新的一次请求取代（或被 abort）：不是错误，调用方应静默忽略。
// 典型用法：catch (error) { if (isStaleRequest(error)) return; ... }
export class StaleRequestError extends Error {
    constructor() {
        super("请求已被更新的一次取代");
        this.name = "StaleRequestError";
        this.stale = true;
    }
}

export function isStaleRequest(error) {
    return Boolean(error?.stale) || error?.name === "AbortError";
}

// abortKey → { seq, generation, controller }
const channels = new Map();

// 中止并清掉一个频道（组件卸载时调用，避免没人再读它的响应）。
export function cancelChannel(abortKey) {
    const key = String(abortKey);
    const channel = channels.get(key);
    if (!channel) return;
    channel.controller.abort();
    channels.delete(key);
}

// 会话结束（登出 / 换账号）：所有在飞频道一起作废。
// beginNewSession 调它，避免旧账号的响应落到新会话的界面上。
function cancelAllChannels() {
    for (const channel of channels.values()) channel.controller.abort();
    channels.clear();
}

/**
 * 同一 abortKey 上「最后一次请求生效」。
 *
 * @param {string} abortKey 频道名。粒度必须是使用点（一个列表 / 一个面板），
 *                          需要区分目标时带上目标 id：`hints:${puzzleKey}`
 * @param {(ctx: { signal: AbortSignal }) => Promise<any>} task 真正发请求的函数
 * @returns {Promise<any>} 最新一次的结果；被取代 / 被中断时抛 StaleRequestError
 */
export function requestLatest(abortKey, task) {
    const key = String(abortKey);
    const generation = sessionGeneration;
    const previous = channels.get(key);
    previous?.controller.abort();

    const controller = new AbortController();
    const current = {
        generation,
        seq: (previous?.seq ?? 0) + 1,
        controller,
    };
    channels.set(key, current);

    const isCurrent = () =>
        channels.get(key) === current && current.generation === sessionGeneration;

    return Promise.resolve()
        .then(() => task({ signal: controller.signal }))
        .then(
            (value) => {
                if (!isCurrent()) throw new StaleRequestError();
                return value;
            },
            (error) => {
                // 被 abort（新请求取代 / 会话切换）：属于 stale，不是错误
                if (error?.name === "AbortError") throw new StaleRequestError();
                // 期间换了会话：旧会话的错误也不该冒到新界面上
                if (!isCurrent()) throw new StaleRequestError();
                throw error;
            },
        )
        .finally(() => {
            if (channels.get(key) === current) channels.delete(key);
        });
}

// 受保护资源的二进制取回（素材、组件 ESM）。
//
// 这些路径走管理端鉴权，而原生 <img src> / <a href> / import() 都发不出 Authorization 头，
// 所以必须先由 JS 取回再转 blob。path 可以是后端下发的 /api/admin/... 原始路径，
// 这里统一经 resolveServerUrl() 换成本次构建的 API 前缀。
//
// 信任边界与 fetchWithAuth 同一把尺子（按目标分流，而不是一律拒绝）：
//   · 本端 API：带令牌 + Cookie，401 时刷新后重试一次；
//   · 外联资源（外联素材 / 外联组件 ESM）：不带任何令牌与 Cookie，靠对方的 CORS 取回。
//     组件那条仍要过 sha384 校验（由调用方负责），所以外链代码不会被无校验执行。
//
// 这里是「取受保护字节」的唯一入口：fetchMediaBlob 与 useProtectedMedia 都复用它，
// 于是错误文案与 429 语义只有一份（后端文案 > 429 友好文案 > 调用方 fallback）。
export async function fetchResource(path, { accept = "*/*", fallback = "" } = {}) {
    const target = resolveServerUrl(path);
    if (!target) {
        throw new ApiError(400, "资源地址为空");
    }

    const res = await fetchWithAuth(target, { headers: { Accept: accept } });

    if (!res.ok) {
        const payload = await res.json().catch(() => null);
        // 429 的等待秒数是通用语义，收敛在这里，别让每个调用方各写一份
        const waitSec = Number(payload?.error?.detail?.retry_after_sec) || 0;
        const message =
            res.status === 429 && waitSec > 0
                ? `请求过于频繁，请 ${waitSec} 秒后再试`
                : extractErrorMessage(
                      payload,
                      fallback || `资源加载失败（${res.status}）`,
                  );
        throw new ApiError(res.status, message, payload?.error);
    }
    return res;
}

// ---------- 二进制通道（图片附件） ----------
// 邮件 / 求提示附件的 url 是受保护路径（`/api/msg/media/<id>`，会 302 到对象存储的短签名地址），
// 响应体不是 JSON 信封，所以不能走 request()。这里复用同一套令牌与刷新逻辑：
// 401 先刷新令牌再重试一次；只有指向本端 API 的地址才带令牌与 Cookie（信任边界）。
// options 与玩家端 request.js 的 fetchWithAuth 同形：`(url, options, { retried })`，
// 调用方可以传 headers（素材是二进制、组件 ESM 是脚本，都要自己指定 Accept）。
//
// 已知未覆盖（PR #21 review 记录，决定不修）：本函数只校验**初始** URL，而 fetch 默认跟随重定向。
// 若后端把某个素材 / 组件端点改成 302 到 CDN，浏览器会剥掉 Authorization，但**不会**剥掉
// X-Mistarg-Test-Ticket。生产构建没有配置测试票据（getApiHeaders 不会加这个头），
// 所以泄露面仅限 dev / test 构建。若将来后端改成 302，需要改为后端同源直传或在此处做 manual 探测。
export async function fetchWithAuth(url, options = {}, { retried = false } = {}) {
    const { headers: extraHeaders = {}, ...init } = options;
    const trusted = isApiUrl(url);
    const headers = trusted ? { ...getApiHeaders(), ...extraHeaders } : { ...extraHeaders };
    const token = trusted ? getToken() : null;
    if (token) headers.Authorization = `Bearer ${token}`;

    // 代次要在**发出前**记下：A 会话发出的素材 / 组件请求在 B 登录之后才 401 时，
    // 不能被当成当前会话的请求（那会用 B 的令牌重放旧地址，还会白白轮换一次 B 的刷新令牌）。
    const generation = sessionGeneration;

    const response = await fetch(url, {
        ...init,
        headers,
        credentials: trusted ? "include" : "omit",
    });

    if (!trusted || response.status !== 401 || retried) return response;

    // 旧会话的 401：说明不了当前会话，原样返回给调用方（不刷新、不重试）
    if (generation !== sessionGeneration) return response;

    const refreshed = await refreshSession();
    if (!refreshed) return response;
    return fetchWithAuth(url, options, { retried: true });
}

// 取受保护图片：直接复用 fetchResource 的取字节与错误语义，只把结果转成 Blob。
// 失败时同样优先显示后端文案，没有才退回「图片加载失败」。
export const fetchMediaBlob = (rawUrl) =>
    fetchResource(rawUrl, { accept: "*/*", fallback: "图片加载失败" }).then((res) =>
        res.blob(),
    );
