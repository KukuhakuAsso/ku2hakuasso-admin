// 展示辅助：兼容后端字段的 camelCase / snake_case 两种命名
export function pick(obj, ...keys) {
    for (const k of keys) {
        if (obj && obj[k] !== undefined && obj[k] !== null) return obj[k];
    }
    return undefined;
}

export function fmtTime(v) {
    if (!v) return "—";
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return String(v);
    return d.toLocaleString("zh-CN", { hour12: false });
}

export function fmtDuration(ms) {
    if (ms === undefined || ms === null) return "—";
    const s = Math.round(ms / 1000);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    const parts = [];
    if (h) parts.push(`${h}时`);
    if (m) parts.push(`${m}分`);
    parts.push(`${sec}秒`);
    return parts.join("");
}

export function fmtJson(v) {
    if (v === undefined || v === null) return "—";
    try {
        return JSON.stringify(v);
    } catch {
        return String(v);
    }
}

// 账号状态（文档明确：4=封禁；2 为正常，其余展示原始值）
export const ACCOUNT_STATUS = {
    2: { label: "正常", type: "success" },
    4: { label: "已封禁", type: "danger" },
};

export const TEAM_STATUS = {
    1: { label: "正常", type: "success" },
    2: { label: "已解散", type: "info" },
    3: { label: "已封禁", type: "danger" },
};

export const HINT_STATUS = {
    pending: { label: "待处理", type: "warning" },
    answered: { label: "已答复", type: "success" },
    rejected: { label: "已拒绝", type: "danger" },
};

export const THREAD_KIND = {
    system: "官方公告",
    account: "账号级会话",
};

export function statusMeta(status, map) {
    return map[status] || { label: `未知(${status})`, type: "info" };
}
