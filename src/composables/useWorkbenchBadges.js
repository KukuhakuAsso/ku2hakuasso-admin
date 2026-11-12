// 用户信工作台的角标（站内信 / 提示 / 申诉三路待办数）。
//
// 2026-11-12 起前两路改用工单计数（一次请求拿到两路，且是精确值）：
//   · 站内信：GET /admin/msg/tickets/summary → byKind.mail.open   （open = pending + processing）
//   · 提示：  同上                                        → byKind.hint.open
//   · 申诉：  GET /admin/appeals?state=awaiting&limit=50 → items.length + hasMore（仍有上限）
//
// 选 open（待处理栏总数）而不是「分给我的 + 没人接的」，是为了让角标反映**积压**：
// 处理中的工单也是「还没办完」，不显示会让人以为清空了。要改成只看自己的，
// 把下面两处 byKind.*.open 换成 pending + mine 即可。
//
// 用 summary 的另一个好处：不再受「列表只读第一页」限制（原来提示角标会漏掉
// quoted 第二页里的待回应降价申请）。申诉那一路仍是列表计数，拉满一页显示「50+」。
// 三路都是「有权限才请求」，失败一律静默——角标出错不该弹提示，也不该把上一次的数字清零。
//
// 单例状态：侧栏只有一个，多组件读同一份。切账号时由 reset() 清空。
//
// 除了 60s 轮询，工作台页面里的动作会让对应那一路的待办数立刻变化
//（读信 / 报价 / 拒绝 / 降价 / 回复申诉 / 解封 ……），动作成功后调
// refreshMails / refreshHints / refreshAppeals 只重拉那一路，不必等下一轮轮询。
import { computed, reactive } from "vue";
import { getTicketSummary } from "@/api/msg";
import { listAppeals } from "@/api/moderation";
import { formatBadge } from "@/utils/workbenchBadge";

// 申诉只能按列表数（接口上限 50）
const APPEALS_LIMIT = 50;
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

// 站内信 + 提示两路的工单计数：一次 summary 同时喂两路（按权限决定写哪几路）。
// 计数是精确值，因此 Capped 恒为 false —— 不再有「50+」这种近似。
async function loadTickets(wantMail, wantHint) {
    const myMail = ++seq.mails;
    const myHint = ++seq.hints;
    try {
        const data = await getTicketSummary();
        // 期间发生过 zero()（重置 / 权限变化）或又发起了新一轮：整体丢弃
        if (myMail !== seq.mails || myHint !== seq.hints) return;

        if (wantMail) {
            state.mails = Number(data?.byKind?.mail?.open ?? 0) || 0;
            state.mailsCapped = false;
        }
        if (wantHint) {
            state.hints = Number(data?.byKind?.hint?.open ?? 0) || 0;
            state.hintsCapped = false;
        }
    } catch {
        // 静默：保留上一次的值
    }
}

async function loadAppeals() {
    const my = ++seq.appeals;
    try {
        const data = await listAppeals({
            state: "awaiting",
            limit: APPEALS_LIMIT,
        });
        if (my !== seq.appeals) return;
        const items = Array.isArray(data?.items) ? data.items : [];
        state.appeals = items.length;
        state.appealsCapped = Boolean(data?.hasMore);
    } catch {
        // 静默
    }
}

// access: { mails, hints, appeals } —— 没权限的那路直接归零，不发请求
async function refresh(access = {}) {
    const wantMail = Boolean(access.mails);
    const wantHint = Boolean(access.hints);
    const jobs = [];

    if (wantMail || wantHint) {
        jobs.push(loadTickets(wantMail, wantHint));
    } else {
        zero("mails");
        zero("hints");
    }

    if (access.appeals) jobs.push(loadAppeals());
    else zero("appeals");

    await Promise.allSettled(jobs);
    state.loaded = true;
}

// 工作台页面里的动作改变了某一路的待办数后调用：只重拉那一路。
// 站内信与提示共用同一次 summary，任一动作都会顺带刷新两路（同一次请求，无额外开销）。
// 没有那一路权限时不发请求（否则会拿一个自己看不到的数字去显示角标）。
function refreshKind(kind) {
    const access = accessGetter?.() ?? {};

    if (kind === "appeals") {
        if (!access.appeals) return Promise.resolve();
        return loadAppeals();
    }
    if (kind !== "mails" && kind !== "hints") return Promise.resolve();
    if (!access.mails && !access.hints) return Promise.resolve();
    return loadTickets(Boolean(access.mails), Boolean(access.hints));
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
    for (const kind of ["mails", "hints", "appeals"]) zero(kind);
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
