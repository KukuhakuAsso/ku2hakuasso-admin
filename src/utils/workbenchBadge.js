// 用户信工作台角标的纯计算规则（可单测，不碰网络与 Vue）。
//
// 待办数怎么来的见 composables/useWorkbenchBadges.js：
//   · 站内信 / 提示：GET /admin/msg/tickets/summary 的 byKind.*.pending + byKind.*.mine（精确值，不截断）
//   · 申诉：GET /admin/appeals?state=awaiting&limit=50，拉满一页且 hasMore 时按「N+」显示
// 这里只负责把数字变成角标文案。

// 父级合计的上限：超过就显示 99+
export const TOTAL_CAP = 99;

// 单个角标文案：0 不显示；被截断显示「上限+」；合计超过 99 显示 99+
export function formatBadge(value, capped) {
    const count = Number(value);
    if (!Number.isFinite(count) || count <= 0) return "";
    if (capped) return `${count}+`;
    if (count > TOTAL_CAP) return `${TOTAL_CAP}+`;
    return String(count);
}
