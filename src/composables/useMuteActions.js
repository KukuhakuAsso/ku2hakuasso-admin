// 禁言 / 解禁的界面状态（api-11-moderation-mute.md）。
// 2026-10-17 重构后解禁按「目标」发起（players/:id/unmute、teams/:id/unmute），
// 不再需要记录 ban_id；列表状态以 GET /admin/mutes 为准，前端不自己记账。
import { computed, reactive, ref, watch } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import {
    listMutes,
    unmuteAccount,
    unmuteTeam,
} from "@/api/moderation";

// 列表单次最多返回 200 条且不分页，超出时 hasMore=true
const LIST_LIMIT = 200;
// 列表被截断时，按精确 id 补齐展示行的并发上限
const LOOKUP_CONCURRENCY = 4;

// kind: "account" | "team"
// rows: 表格当前展示的行（ref 数组）；列表被截断时用它决定要补齐哪些行
export function useMuteActions(kind, onChanged = () => {}, { rows } = {}) {
    const muteDialog = reactive({ visible: false, target: null });
    // accountId / teamId → 生效中的禁言行
    const muted = ref(new Map());
    // 已确认「未禁言」的 id（只在列表被截断时逐行查过才有记录）
    const resolvedClear = ref(new Set());
    // 列表是否被截断：为 true 时，既不在 muted 也不在 resolvedClear 的主体状态未知
    const truncated = ref(false);
    const loading = ref(false);

    const idParam = kind === "team" ? "team_id" : "account_id";
    // 非响应式：正在查询的 id → 发起查询时的代际（避免同一行重复发请求）
    const inflight = new Map();
    let visibleRows = [];
    // 每次 refreshMutes 自增。代际一变，上一代在途的响应、队列与清理全部作废：
    // 清空缓存管不住已经发出的请求，必须让它们自己发现「我过期了」
    let generation = 0;

    function keyOf(id) {
        return String(id);
    }

    function idOf(row) {
        return kind === "team" ? row?.teamId : row?.accountId;
    }

    function setRecord(key, row) {
        const next = new Map(muted.value);
        next.set(key, row);
        muted.value = next;
    }

    function markClear(key) {
        const next = new Set(resolvedClear.value);
        next.add(key);
        resolvedClear.value = next;
    }

    // 只取仍生效的禁言（status=active），一次最多 200 条，不分页
    async function refreshMutes() {
        const gen = (generation += 1);
        loading.value = true;
        try {
            const data = await listMutes({
                target: kind,
                status: "active",
                limit: LIST_LIMIT,
            });
            // 期间又发起了新的刷新：本次结果（以及后面基于它的补查）整体作废
            if (gen !== generation) return;
            const items = Array.isArray(data?.items) ? data.items : [];
            const map = new Map();
            for (const row of items) {
                const id = idOf(row);
                if (id === null || id === undefined) continue;
                if (row.active === false) continue;
                map.set(keyOf(id), row);
            }
            muted.value = map;
            // 还有没取回来的生效禁言：不能把这些主体当成「未禁言」
            truncated.value = Boolean(data?.hasMore);
            resolvedClear.value = new Set();
            // 旧代登记的在途标记已无意义，留着只会挡住同一 id 在新代的查询
            for (const [key, at] of inflight) {
                if (at !== gen) inflight.delete(key);
            }
        } catch {
            // 读列表失败不阻断主流程：按钮退化为「禁言」，服务端仍会拦非法解禁
        } finally {
            // 新一代还在跑时不要替它关 loading
            if (gen === generation) loading.value = false;
        }
        if (gen !== generation) return;
        // 截断时补齐当前展示行，否则已禁言的目标会显示成「禁言」并覆盖原处罚
        await resolveMutes(visibleRows);
    }

    // 列表被截断时，用精确 id 过滤补齐展示行：
    // 缺失的行若直接当「未禁言」，点下去就是重复禁言（覆盖处罚并重置申诉额度）
    async function resolveMutes(items) {
        if (!truncated.value) return;
        // 整个补查绑定在发起时的代际上
        const gen = generation;

        const queue = [];
        for (const row of items || []) {
            const id = row?.id;
            if (id === null || id === undefined || id === "") continue;
            const key = keyOf(id);
            if (muted.value.has(key) || resolvedClear.value.has(key)) continue;
            // 同一代里已在查就跳过；别的代留下的标记不算数
            if (inflight.get(key) === gen) continue;
            queue.push({ key, id });
        }
        if (!queue.length) return;

        let index = 0;
        const worker = async () => {
            while (index < queue.length) {
                // 刷新已换代：旧队列不再消费，免得把过期状态写回去
                if (gen !== generation) return;
                const { key, id } = queue[index];
                index += 1;
                inflight.set(key, gen);
                try {
                    const data = await listMutes({
                        target: kind,
                        status: "active",
                        [idParam]: id,
                        limit: LIST_LIMIT,
                    });
                    // 响应晚于换代（如禁言被覆盖）：直接丢弃，不写状态
                    if (gen !== generation) continue;
                    const rows = Array.isArray(data?.items) ? data.items : [];
                    const hit =
                        rows.find(
                            (item) =>
                                keyOf(idOf(item)) === key &&
                                item.active !== false,
                        ) || null;
                    if (hit) setRecord(key, hit);
                    else markClear(key);
                } catch {
                    // 单行查询失败：保持「未知」，界面禁用操作，避免误覆盖
                } finally {
                    // 只清理本代自己的标记，别删掉新代同 id 的在途记录
                    if (inflight.get(key) === gen) inflight.delete(key);
                }
            }
        };
        await Promise.all(
            Array.from(
                { length: Math.min(LOOKUP_CONCURRENCY, queue.length) },
                worker,
            ),
        );
    }

    // "muted" | "clear" | "unknown"
    function muteState(id) {
        const key = keyOf(id);
        if (muted.value.has(key)) return "muted";
        if (resolvedClear.value.has(key)) return "clear";
        return truncated.value ? "unknown" : "clear";
    }

    function muteOf(id) {
        return muted.value.get(keyOf(id)) || null;
    }

    // 表格换页 / 筛选后重新判定可见行的状态（只在截断时才会发请求）
    if (rows) {
        watch(
            rows,
            (value) => {
                visibleRows = Array.isArray(value) ? value : [];
                resolveMutes(visibleRows);
            },
            { immediate: true },
        );
    }

    const mutedCount = computed(() => muted.value.size);

    function openMute(row, label) {
        muteDialog.target = { kind, id: row?.id, label };
        muteDialog.visible = true;
    }

    async function unmute(row, label) {
        const id = row?.id;
        if (!id) return;

        const record = muteOf(id);
        const untilText = record?.until
            ? `至 ${new Date(record.until).toLocaleString()}`
            : "永久（不会自动解除）";
        const reasonText = record?.reason ? `\n原因：${record.reason}` : "";

        try {
            await ElMessageBox.confirm(
                `确认解除「${label || id}」的禁言？\n到期：${untilText}${reasonText}`,
                "解除禁言",
                { type: "warning", confirmButtonText: "解除禁言" },
            );
        } catch {
            return;
        }

        try {
            const request = kind === "team" ? unmuteTeam : unmuteAccount;
            await request(id);
            ElMessage.success("已解除禁言");
            await refreshMutes();
            onChanged();
        } catch (err) {
            // 404 = 当前未被禁言（可能已到期自动解除）：按成功刷新状态处理
            if (err?.status === 404) {
                ElMessage.info("该目标当前未被禁言（可能已到期自动解除）");
                await refreshMutes();
                onChanged();
                return;
            }
            ElMessage.error(err?.message || "解除禁言失败");
        }
    }

    return {
        muteDialog,
        muted,
        loading,
        mutedCount,
        muteOf,
        muteState,
        openMute,
        unmute,
        refreshMutes,
    };
}
