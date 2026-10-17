// 禁言 / 解禁的界面状态（api-11-moderation-mute.md）。
// 2026-10-17 重构后解禁按「目标」发起（players/:id/unmute、teams/:id/unmute），
// 不再需要记录 ban_id；列表状态以 GET /admin/mutes 为准，前端不自己记账。
import { computed, reactive, ref } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import {
    listMutes,
    unmuteAccount,
    unmuteTeam,
} from "@/api/moderation";

// kind: "account" | "team"
export function useMuteActions(kind, onChanged = () => {}) {
    const muteDialog = reactive({ visible: false, target: null });
    // accountId / teamId → 生效中的禁言行
    const muted = ref(new Map());
    const loading = ref(false);

    function keyOf(id) {
        return String(id);
    }

    // 只取仍生效的禁言（status=active），一次最多 200 条，不分页
    async function refreshMutes() {
        loading.value = true;
        try {
            const data = await listMutes({
                target: kind,
                status: "active",
                limit: 200,
            });
            const items = Array.isArray(data?.items) ? data.items : [];
            const map = new Map();
            for (const row of items) {
                const id =
                    kind === "team" ? row.teamId : row.accountId;
                if (id === null || id === undefined) continue;
                if (row.active === false) continue;
                map.set(keyOf(id), row);
            }
            muted.value = map;
        } catch {
            // 读列表失败不阻断主流程：按钮退化为「禁言」，服务端仍会拦非法解禁
        } finally {
            loading.value = false;
        }
    }

    function muteOf(id) {
        return muted.value.get(keyOf(id)) || null;
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
        openMute,
        unmute,
        refreshMutes,
    };
}
