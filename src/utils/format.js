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

// 账号状态（2026-10-17 起统一口径）：1=已注销（读侧当不存在）、2=正常、3=禁言、4=封禁
export const ACCOUNT_STATUS = {
    1: { label: "已注销", type: "info" },
    2: { label: "正常", type: "success" },
    3: { label: "已禁言", type: "warning" },
    4: { label: "已封禁", type: "danger" },
};

// 队伍状态（2026-10-17 起与账号口径对齐）：1=已解散（读侧当不存在）、2=正常、3=禁言、4=封禁
export const TEAM_STATUS = {
    1: { label: "已解散", type: "info" },
    2: { label: "正常", type: "success" },
    3: { label: "已禁言", type: "warning" },
    4: { label: "已封禁", type: "danger" },
};

// 队伍筛选下拉的取值（0 = 全部，后端 status 缺省或 0 表示全部）
export const TEAM_STATUS_OPTIONS = [
    { value: 0, label: "全部" },
    { value: 2, label: "正常" },
    { value: 3, label: "已禁言" },
    { value: 4, label: "已封禁" },
    { value: 1, label: "已解散" },
];

// 提示工作台状态（两步报价：pending 待报价 → quoted 已报价 → answered 已答复）
export const HINT_STATUS = {
    pending: { label: "待报价", type: "warning" },
    quoted: { label: "已报价", type: "primary" },
    answered: { label: "已答复", type: "success" },
    rejected: { label: "已拒绝", type: "danger" },
    closed: { label: "已关闭", type: "info" },
};

// 站内信工作台（邮件式）：来源标记（服务端判定，客户端不能指定）
export const MAIL_SOURCE = {
    mail: { label: "邮件", type: "info" },
    feedback: { label: "问题反馈", type: "warning" },
    hint: { label: "求提示", type: "success" },
    announce: { label: "公告", type: "danger" },
    warn: { label: "官方警告", type: "danger" },
    system: { label: "系统消息", type: "info" },
    // 2026-10-17 起：官方通知（notify 发送）与管理级内部公告之外的通知类邮件
    notice: { label: "官方通知", type: "info" },
    // 处罚申诉链：封禁 / 禁言的往来邮件（也出现在申诉工作台里）
    appeal_ban: { label: "封禁申诉", type: "danger" },
    appeal_mute: { label: "禁言申诉", type: "warning" },
};

// 频道筛选项（列表里的频道名以服务端返回的 channelName 为准，不要自己拼）
export const MAIL_CHANNEL_OPTIONS = [
    { value: "", label: "全部频道" },
    { value: "system", label: "官方公告" },
    { value: "account", label: "与官方的联系" },
    { value: "team", label: "队伍会话" },
];

export function statusMeta(status, map) {
    return map[status] || { label: `未知(${status})`, type: "info" };
}

// 审计动作清单（api-9-admin.md §9.7）：动作名是契约，后端将来新增的动作按原文展示
export const AUDIT_ACTIONS = {
    "player.warn": "警告玩家",
    "player.ban": "封禁玩家",
    "player.unban": "解封玩家",
    "player.username.change": "强制修改玩家用户名",
    "player.contact.read": "读取玩家完整联系方式",
    "player.usernames.read": "读取玩家曾用名",
    "team.warn": "警告队伍",
    "team.ban": "封禁队伍",
    "team.unban": "解封队伍",
    "team.rename": "强制修改队名",
    "team.dissolve": "强制解散队伍",
    "msg.reply": "后台回复",
    "msg.announce": "发布公告",
    "msg.ban": "禁言",
    "msg.unban": "解除禁言",
    "appeal.reply": "回复申诉",
    "hint.quote": "提示报价",
    "hint.requote": "同意降价并改回答",
    "hint.decline_cheaper": "拒绝降价",
    "hint.reject": "拒绝求提示",
    "tips.grant": "发放或扣减提示点",
    "tips.rule.update": "修改提示规则",
    "permission.grant": "授予权限组",
    "permission.revoke": "撤销权限组",
    "maintenance.settle_tips": "执行提示点结算",
    "maintenance.recheck_milestones": "重新检查里程碑",
};

export function auditActionLabel(action) {
    return AUDIT_ACTIONS[action] || action || "—";
}
