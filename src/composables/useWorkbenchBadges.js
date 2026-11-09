// 用户信工作台的角标（站内信 / 提示 / 申诉三路待办数）。
//
// 后端没有「待办总数」接口，只能按列表数：
//   · 站内信：GET /admin/msg/mails?only_unread=true&limit=50 → items.length + hasMore
//   · 提示：  GET /admin/msg/hint-requests 两个状态各拉一页
//              status=pending → 待报价
//              status=quoted  → 其中 cheaperRequestedAt 非空且 cheaperDecidedAt 为空 = 待回应降价
//   · 申诉：  GET /admin/appeals?state=awaiting&limit=50 → items.length + hasMore
//
// 因此数字是有上限的：拉满一页且 hasMore 时显示「50+ / 100+」而不是继续翻页。
// 三路都是「有权限才请求」，失败一律静默——角标出错不该弹提示，也不该把上一次的数字清零。
//
// 单例状态：侧栏只有一个，多组件读同一份。切账号时由 reset() 清空。
//
// 除了 60s 轮询，工作台页面里的动作会让对应那一路的待办数立刻变化
//（读信 / 报价 / 拒绝 / 降价 / 回复申诉 / 解封 ……），动作成功后调
// refreshMails / refreshHints / refreshAppeals 只重拉那一路，不必等下一轮轮询。
import { computed, reactive } from "vue";
import { listHintRequests, listMails } from "@/api/msg";
import { listAppeals } from "@/api/moderation";
import { countHintTodos, formatBadge } from "@/utils/workbenchBadge";

// 每路最多数多少条（接口上限分别是 50 / 100 / 50）
const LIMITS = {
    mails: 50,
    hints: 100,
    appeals: 50,
};
const POLL_INTERVAL_MS = 60000;

const state = reactive({
    mails: 0,
    mailsCapped: false,
    hints: 0,
    hintsCapped: false,
    appeals: 0,
    appealsCapped: false,
    loaded: false,
});

// 每路各一个序号：迟到的响应靠它判断自己是否已被更新的请求（或 reset）作废。
// 分路而不是共用一个，避免「读了一封邮件」把正在飞行的提示/申诉响应一起作废。
const seq = { mails: 0, hints: 0, appeals: 0 };

let timer = null;
let accessGetter = null;

function zero(kind) {
    seq[kind] += 1;
    state[kind] = 0;
    state[`${kind}Capped`] = false;
}

function fmt(value, capped) {
    return formatBadge(value, capped);
}

const badges = computed(() => {
    const total = state.mails + state.hints + state.appeals;
    const totalCapped = state.mailsCapped || state.hintsCapped || state.appealsCapped;
    return {
        mails: state.mails,
        hints: state.hints,
        appeals: state.appeals,
        total,
        mailsBadge: fmt(state.mails, state.mailsCapped),
        hintsBadge: fmt(state.hints, state.hintsCapped),
        appealsBadge: fmt(state.appeals, state.appealsCapped),
        // 只要有一路被截断，合计就只能是「至少这么多」
        totalBadge: fmt(total, totalCapped),
    };
});

async function loadMails() {
    const my = ++seq.mails;
    try {
        const data = await listMails({
            only_unread: true,
            limit: LIMITS.mails,
        });
        if (my !== seq.mails) return;
        const items = Array.isArray(data?.items) ? data.items : [];
        state.mails = items.length;
        state.mailsCapped = Boolean(data?.hasMore);
    } catch {
        // 静默：保留上一次的值
    }
}

async function loadHints() {
    const my = ++seq.hints;
    try {
        const [pending, quoted] = await Promise.all([
            listHintRequests({ status: "pending", limit: LIMITS.hints }),
            listHintRequests({ status: "quoted", limit: LIMITS.hints }),
        ]);
        if (my !== seq.hints) return;

        const pendingItems = Array.isArray(pending?.items) ? pending.items : [];
        const quotedItems = Array.isArray(quoted?.items) ? quoted.items : [];

        // 待报价 + 玩家申请了更便宜但官方还没回应：两类都算「等我处理」
        state.hints = countHintTodos(pendingItems, quotedItems);
        state.hintsCapped = Boolean(pending?.hasMore || quoted?.hasMore);
    } catch {
        // 静默
    }
}

async function loadAppeals() {
    const my = ++seq.appeals;
    try {
        const data = await listAppeals({
            state: "awaiting",
            limit: LIMITS.appeals,
        });
        if (my !== seq.appeals) return;
        const items = Array.isArray(data?.items) ? data.items : [];
        state.appeals = items.length;
        state.appealsCapped = Boolean(data?.hasMore);
    } catch {
        // 静默
    }
}

const LOADERS = {
    mails: loadMails,
    hints: loadHints,
    appeals: loadAppeals,
};

// access: { mails, hints, appeals } —— 没权限的那路直接归零，不发请求
async function refresh(access = {}) {
    const jobs = [];
    for (const kind of Object.keys(LOADERS)) {
        if (access[kind]) {
            jobs.push(LOADERS[kind]());
        } else {
            zero(kind);
        }
    }
    await Promise.allSettled(jobs);
    state.loaded = true;
}

// 工作台页面里的动作改变了某一路的待办数后调用：只重拉那一路。
// 没有那一路权限时不发请求（否则会拿一个自己看不到的数字去显示角标）。
function refreshKind(kind) {
    const loader = LOADERS[kind];
    if (!loader) return Promise.resolve();
    const access = accessGetter?.();
    if (access && !access[kind]) return Promise.resolve();
    return loader();
}

// 轮询每次触发：页面隐藏时不请求（省流量），切回前台由 visibilitychange 补一次
function tick() {
    if (typeof document !== "undefined" && document.hidden) return;
    refresh(accessGetter?.() ?? {});
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

// 开始轮询；accessGetter 每次触发时重新取一遍权限（权限被回收后立即停止那一路）。
// 首次拉取不走 tick()：标签页在后台打开时 document.hidden 为 true，
// 走 tick() 会一次都不请求，等你切过去才看到角标——初次加载应该无条件拉一次。
function startPolling(getter) {
    accessGetter = getter;
    stopPolling();
    refresh(accessGetter?.() ?? {});
    timer = setInterval(tick, POLL_INTERVAL_MS);
    if (typeof document !== "undefined") {
        document.addEventListener("visibilitychange", onVisibilityChange);
    }
}

// 登出 / 切账号：清空数字并作废在途请求
function reset() {
    stopPolling();
    for (const kind of Object.keys(LOADERS)) zero(kind);
    state.loaded = false;
}

export function useWorkbenchBadges() {
    return {
        badges,
        state,
        refresh,
        refreshMails: () => refreshKind("mails"),
        refreshHints: () => refreshKind("hints"),
        refreshAppeals: () => refreshKind("appeals"),
        startPolling,
        stopPolling,
        reset,
    };
}

export default useWorkbenchBadges;
