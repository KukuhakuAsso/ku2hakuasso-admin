// iframe 来源归一化。
//
// 后端 allowlist 只接受 https://host[:port]（全库唯一，见 api-12 页面保存说明）：
// 不带路径 / 查询 / 片段，也不带用户名密码。统一走 URL.origin，
// 顺带把主机名大小写与默认端口（:443）归一化，避免同一来源被登记成两行。
export function normalizeIframeOrigin(value) {
    const raw = String(value ?? "").trim();
    if (!raw) return "";

    try {
        const url = new URL(raw);
        if (url.protocol !== "https:") return "";
        if (url.username || url.password) return "";
        if (url.pathname !== "/" || url.search || url.hash) return "";
        return url.origin;
    } catch {
        return "";
    }
}

export default normalizeIframeOrigin;
