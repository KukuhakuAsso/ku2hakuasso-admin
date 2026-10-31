// 后端接口的地址与请求头配置：API 基址、版本头、票据，以及正式 / 测试环境的切换。
// 变量命名与 vue-mistarg2anns/src/config/api.js 保持一致，两个前端共用同一套部署配置。
import { ref } from "vue";

// 用户手动选择的 API 环境记在 localStorage 的这个键下。更改为测试/生产环境时，会更新此值。
const API_ENVIRONMENT_STORAGE_KEY = "admin_api_environment";

// 构建期由 VITE_* 环境变量注入的配置；testTicket 为空表示未配置测试环境，此时不允许切到 test。
export const apiConfig = {
    baseUrl: import.meta.env.VITE_API_BASE_URL || "",
    basePath: import.meta.env.VITE_API_BASE_PATH || "/api-mist",
    apiVersion: import.meta.env.VITE_API_VERSION || "mistarg.2026.v1",
    tokenKey: import.meta.env.VITE_TOKEN_KEY || "admin_token",
    devTicket: import.meta.env.VITE_DEV_TICKET || "",
    testTicket: import.meta.env.VITE_X_MISTARG_TEST_TICKET || "",
};

// 解析当前应使用的 API 环境：localStorage 里的用户选择优先，其次是 VITE_API_ENVIRONMENT；
// 两条路径都要求存在测试票据，否则一律落在 production。
function readApiEnvironment() {
    const configuredEnvironment =
        import.meta.env.VITE_API_ENVIRONMENT === "test" ? "test" : "production";

    if (typeof window === "undefined") {
        return configuredEnvironment;
    }

    try {
        const savedEnvironment = window.localStorage.getItem(
            API_ENVIRONMENT_STORAGE_KEY,
        );
        if (savedEnvironment === "test" && apiConfig.testTicket) {
            return "test";
        }
        if (savedEnvironment === "production") {
            return "production";
        }
    } catch (error) {
        console.warn("[admin] 读取 API 环境设置失败", error);
    }

    return configuredEnvironment === "test" && apiConfig.testTicket
        ? "test"
        : "production";
}

// 当前生效的 API 环境（响应式，供界面显示与切换）。
export const apiEnvironment = ref(readApiEnvironment());

// 切换 API 环境并持久化到 localStorage；环境名非法或缺少测试票据时抛错。
export function setApiEnvironment(environment) {
    if (!["test", "production"].includes(environment)) {
        throw new Error("API 环境仅支持测试环境或正式环境。");
    }

    if (environment === "test" && !apiConfig.testTicket) {
        throw new Error("未配置测试票据，无法切换到测试环境。");
    }

    apiEnvironment.value = environment;
    if (typeof window !== "undefined") {
        try {
            window.localStorage.setItem(
                API_ENVIRONMENT_STORAGE_KEY,
                environment,
            );
        } catch (error) {
            console.warn("[admin] 保存 API 环境设置失败", error);
        }
    }
}

// 拼接完整请求地址：baseUrl + basePath + path（baseUrl 为绝对 URL 时同样适用）。
export function buildApiUrl(path) {
    const normalized = String(path ?? "/").trim();
    const safePath = normalized.startsWith("/") ? normalized : `/${normalized}`;
    const base = (apiConfig.baseUrl || "").replace(/\/+$/, "");
    const prefix = (apiConfig.basePath || "").replace(/\/+$/, "");
    return `${base}${prefix}${safePath}`;
}

function apiOrigin() {
    if (typeof window === "undefined") return "";
    return window.location.origin;
}

// 后端下发的资源地址一律是它自身的绝对路径（如邮件 / 求提示附件的 `/api/msg/media/12`），
// 而本端实际走的是 `/api-admin`（开发，代理重写到 /api）或 `/api-mist`（生产），
// 直接拿 `/api/...` 会打到静态站点上 404，所以统一在这里换成本端前缀。
// 外链与 blob/data 原样返回（也不给它带凭证，见 isApiUrl）。
export function resolveServerUrl(path) {
    const raw = String(path ?? "").trim();
    if (!raw) return "";
    if (/^(?:https?:)?\/\//i.test(raw) || /^(?:blob|data):/i.test(raw)) {
        return raw;
    }
    if (raw.startsWith("/api/")) {
        const base = (apiConfig.baseUrl || "").replace(/\/+$/, "");
        const prefix = apiConfig.basePath || "/api";
        return `${base}${prefix}${raw.slice("/api".length)}`;
    }
    return raw;
}

// 信任边界：只有指向本端 API 的地址才带令牌与 Cookie。
export function isApiUrl(raw) {
    const path = String(raw || "").trim();
    if (!path) return false;
    if (!/^(?:https?:)?\/\//i.test(path) && !path.startsWith("/")) return false;

    let parsed;
    try {
        parsed = new URL(path, apiOrigin() || "http://localhost");
    } catch {
        return false;
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
    if (apiOrigin() && parsed.origin !== apiOrigin()) return false;

    const prefix = (apiConfig.basePath || "/api").replace(/\/+$/, "");
    return (
        parsed.pathname === prefix || parsed.pathname.startsWith(`${prefix}/`)
    );
}

// 生成通用请求头；处于测试环境且配置了测试票据时，额外带上 X-Mistarg-Test-Ticket。
export function getApiHeaders(extra = {}) {
    const headers = {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-API-Version": apiConfig.apiVersion,
        ...extra,
    };
    if (apiEnvironment.value === "test" && apiConfig.testTicket) {
        headers["X-Mistarg-Test-Ticket"] = apiConfig.testTicket;
    }

    return headers;
}
