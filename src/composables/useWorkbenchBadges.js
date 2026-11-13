// 站内信工作台的角标（原「提示工作台」「申诉工作台」已并入本页）。
//
// 侧栏只有一个入口、一个数，所以这里也只维护一个数：
//   GET /admin/msg/tickets/summary 的**顶层 open**。
// open = pending + processing，即「还有多少工单没办完」；顶层的合计是后端**按调用方权限
// 累加可见桶**算好的（来信 msg.feedback.handle、求提示 msg.hint.handle、申诉 moderation.mute），
// 前端不必也不该再按 byKind.mail / hint / appeal 分路相加 —— 那只是把服务端的权限判断
// 在前端重做了一遍，还容易漏桶或重复计数。
//
// 精确值，不再有「50+」近似，也不需要额外请求申诉列表。
// 没有对应处理权限的账号直接归零、不发请求；失败一律静默（角标出错不该弹提示，
// 也不该把上一次的数字清零）。
//
// 单例状态：侧栏只有一个，多组件读同一份。切账号时由 reset() 清空。
// 除了 60s 轮询，工作台 / 处罚记录里的动作会让数字立刻变化，动作成功后调 refresh() 即可。
import { computed, reactive } from "vue";
import { getTicketSummary } from "@/api/msg";
import { formatBadge } from "@/utils/workbenchBadge";

const POLL_INTERVAL_MS = 60000;

const state = reactive({
    open: 0,
    loaded: false,
});

// 序号：迟到的响应靠它判断自己是否已被更新的请求（或 reset）作废
let seq = 0;
let timer = null;
let accessGetter = null;

function zero() {
    seq += 1;
    state.open = 0;
}

const badges = computed(() => ({
    total: state.open,
    totalBadge: formatBadge(state.open, false),
}));

async function loadOpen() {
    const my = ++seq;
    try {
        const data = await getTicketSummary();
        if (my !== seq) return;
        state.open = Number(data?.open ?? 0) || 0;
    } catch {
        // 静默：保留上一次的值
    }
}

// canSee：当前账号有任一处理权限（来信 / 求提示 / 申诉）才请求，否则归零
async function refresh(canSee = Boolean(accessGetter?.())) {
    if (!canSee) {
        zero();
        state.loaded = true;
        return;
    }
    await loadOpen();
    state.loaded = true;
}

// 轮询每次触发：页面隐藏时不请求（省流量），切回前台由 visibilitychange 补一次
function tick() {
    if (typeof document !== "undefined" && document.hidden) return;
    refresh();
}

function onVisibilityChange() {
    if (typeof document === "undefined" || document.hidden) return;
    tick();
}

function stopPolling() {
    if (timer) {
        clearInterval(timer);
        timer = null;
    }
    if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisibilityChange);
    }
}

// 开始轮询；accessGetter 每次触发时重新取一遍权限（权限被回收后立即停止请求并归零）。
// 首次拉取不走 tick()：标签页在后台打开时 document.hidden 为 true，
// 走 tick() 会一次都不请求，等你切过去才看到角标——初次加载应该无条件拉一次。
function startPolling(getter) {
    accessGetter = getter;
    stopPolling();
    refresh();
    timer = setInterval(tick, POLL_INTERVAL_MS);
    if (typeof document !== "undefined") {
        document.addEventListener("visibilitychange", onVisibilityChange);
    }
}

// 登出 / 切账号：清空数字并作废在途请求
function reset() {
    stopPolling();
    zero();
    state.loaded = false;
}

export function useWorkbenchBadges() {
    return {
        badges,
        state,
        refresh,
        startPolling,
        stopPolling,
        reset,
    };
}

export default useWorkbenchBadges;
