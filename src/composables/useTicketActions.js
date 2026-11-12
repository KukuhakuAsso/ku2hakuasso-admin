// 工单错误 → 界面动作的统一翻译（站内信与求提示两个工作台共用）。
//
// 后端在 403 / 409 上给了 `detail.reason_code`，前端不要匹配中文 message：
//   403 TICKET_HELD_BY_OTHER   → 已被其他 staff 接手，内容不可见
//   409 TICKET_NOT_CLAIMED     → 还没接单（可以先 claim 再重试一次）
//   409 TICKET_CLAIMED         → 别人抢先接了
//   409 TICKET_STALE           → 工单已变化（可能来了新的来信）
//   409 TICKET_WRONG_WORKBENCH → 该工单属于另一个工作台
//   409 TICKET_NOT_PROCESSING  → release 时发现它已不在处理中
import { claimTicket, releaseTicket } from "@/api/msg";
import { ticketAssigneeName } from "@/utils/format";

export const TICKET_ERROR_ACTION = {
    HELD: "held",
    CLAIM: "claim",
    RELOAD: "reload",
    SWITCH: "switch",
    RETRY: "retry",
};

// error 是 http.js 抛的 ApiError：detail 就是响应体里的 error 对象，
// 而 reason_code / ticket 位于 error.detail 再下一层 —— 两层都兼容。
function normalizeTicketDetail(error) {
    const first = error?.detail || {};
    const inner = first?.detail;
    if (inner && typeof inner === "object") return inner;
    return first;
}

export function describeTicketError(error) {
    const status = Number(error?.status);
    const detail = normalizeTicketDetail(error);
    const reason = detail.reason_code || detail.reasonCode || "";
    const holder = ticketAssigneeName(detail.ticket) || "其他 staff";

    if (status === 403 && reason === "TICKET_HELD_BY_OTHER") {
        return {
            action: TICKET_ERROR_ACTION.HELD,
            reasonCode: reason,
            holder,
            // 带上服务端给的工单快照，界面可以直接显示「处理中 · 处理人 X」
            ticket: detail.ticket ?? null,
            message: `该工单已被 ${holder} 接手，正文与附件不可见`,
        };
    }

    if (status === 409) {
        if (reason === "TICKET_NOT_CLAIMED") {
            return {
                action: TICKET_ERROR_ACTION.CLAIM,
                reasonCode: reason,
                message: "请先接手该工单再操作",
            };
        }
        if (reason === "TICKET_CLAIMED") {
            return {
                action: TICKET_ERROR_ACTION.RELOAD,
                reasonCode: reason,
                holder,
                message: `该工单已被 ${holder} 接手`,
            };
        }
        if (reason === "TICKET_STALE") {
            return {
                action: TICKET_ERROR_ACTION.RELOAD,
                reasonCode: reason,
                message: "工单状态已变化（可能收到新的来信），已为你刷新",
            };
        }
        if (reason === "TICKET_WRONG_WORKBENCH") {
            return {
                action: TICKET_ERROR_ACTION.SWITCH,
                reasonCode: reason,
                message: "该工单属于另一个工作台，请到对应页面处理",
            };
        }
        if (reason === "TICKET_NOT_PROCESSING") {
            return {
                action: TICKET_ERROR_ACTION.RELOAD,
                reasonCode: reason,
                message: "该工单已不在处理中（可能已被退回或办结）",
            };
        }
        return {
            action: TICKET_ERROR_ACTION.RETRY,
            reasonCode: reason,
            message: error?.message || "工单状态变化，请刷新后重试",
        };
    }

    return null;
}

// 接单：幂等（本人重复调用不算错）。已被他人持有 → 返回 descriptor 交给调用方提示。
export async function claimTicketQuietly(ticketId) {
    try {
        const data = await claimTicket(ticketId);
        return { ok: true, ticket: data?.ticket ?? null };
    } catch (error) {
        return { ok: false, descriptor: describeTicketError(error), error };
    }
}

// 退出 / 标记未处理。退出后待处理计时不重置（由调用方在提示里说明）。
export async function releaseTicketQuietly(ticketId) {
    try {
        const data = await releaseTicket(ticketId);
        return { ok: true, ticket: data?.ticket ?? null };
    } catch (error) {
        return { ok: false, descriptor: describeTicketError(error), error };
    }
}
