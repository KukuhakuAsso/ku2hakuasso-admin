// 用户信工作台角标的纯计算规则（可单测，不碰网络与 Vue）。
//
// 后端没有「待办总数」接口，只能按列表数并截断：
//   · 站内信：GET /admin/msg/mails?only_unread=true&limit=50
//   · 提示：  status=pending（待报价）+ status=quoted 里「申请降价还没回应」的
//   · 申诉：  GET /admin/appeals?state=awaiting&limit=50
// 拉满一页且 hasMore 时显示「N+」，不继续翻页。

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

// 提示工作台的待办数：待报价 + 待回应降价。
// 「待回应降价」= cheaperRequestedAt 非空且 cheaperDecidedAt 为空（api-10 §10.8：
// 玩家申请了更便宜、官方还没回应，要么降价要么拒绝，都算等我处理）。
export function countHintTodos(pendingItems = [], quotedItems = []) {
    const pending = Array.isArray(pendingItems) ? pendingItems.length : 0;
    const quoted = Array.isArray(quotedItems) ? quotedItems : [];
    const cheaperPending = quoted.filter(
        (item) => Boolean(item?.cheaperRequestedAt) && !item?.cheaperDecidedAt,
    ).length;
    return pending + cheaperPending;
}
