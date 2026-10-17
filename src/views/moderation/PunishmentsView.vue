<template>
    <div class="page-card">
        <el-tabs v-model="tab">
            <el-tab-pane
                v-if="canViewMutes"
                label="禁言列表"
                name="mutes"
            />
            <el-tab-pane v-if="auth.isAdmin" label="封禁列表" name="banneds" />
            <el-tab-pane
                v-if="!canViewMutes && !auth.isAdmin"
                label="无权查看"
                name="denied"
            />
        </el-tabs>

        <el-empty
            v-if="tab === 'denied'"
            description="需要 moderation.mute 权限（禁言）或 admin 角色（封禁）"
        />

        <template v-else>
            <div class="filter-bar">
                <el-select v-model="filters.status" style="width: 170px">
                    <el-option label="仅生效中" value="active" />
                    <el-option label="含已到期" value="all" />
                </el-select>
                <el-select v-model="filters.target" style="width: 150px">
                    <el-option label="全部目标" value="all" />
                    <el-option label="仅账号" value="account" />
                    <el-option label="仅队伍" value="team" />
                </el-select>
                <el-input
                    v-model="filters.accountId"
                    placeholder="账号 ID（精确）"
                    style="width: 150px"
                    clearable
                />
                <el-input
                    v-model="filters.teamId"
                    placeholder="队伍 ID（精确）"
                    style="width: 150px"
                    clearable
                />
                <el-button type="primary" @click="reload">查询</el-button>
                <el-button @click="reset">重置</el-button>
            </div>

            <p class="hint">
                接口不分页、单次最多 200 条；解禁 / 解封直接用行里的类型 + 目标 id。
            </p>

            <el-alert
                v-if="currentState.hasMore"
                type="warning"
                :closable="false"
                show-icon
                title="结果已截断（超过 200 条）"
                description="请用账号 ID / 队伍 ID 精确过滤，缩小范围后再操作。"
                class="truncated"
            />

            <el-table
                v-loading="currentState.loading"
                :data="currentState.rows"
                :row-key="rowKey"
                border
                stripe
            >
                <el-table-column label="类型" width="90">
                    <template #default="{ row }">
                        <el-tag
                            :type="row.targetType === 'team' ? 'info' : 'primary'"
                            size="small"
                        >
                            {{ row.targetType === "team" ? "队伍" : "账号" }}
                        </el-tag>
                    </template>
                </el-table-column>
                <el-table-column label="对象" min-width="190">
                    <template #default="{ row }">
                        <template v-if="row.targetType === 'team'">
                            <div>{{ row.teamName || "—" }}</div>
                            <div class="sub">队伍 #{{ row.teamId }}</div>
                        </template>
                        <template v-else>
                            <div>{{ row.username || "—" }}</div>
                            <div class="sub">
                                {{ row.playerNo || "—" }} · 账号 #{{ row.accountId }}
                            </div>
                        </template>
                    </template>
                </el-table-column>
                <el-table-column label="原因" min-width="180">
                    <template #default="{ row }">{{ row.reason || "—" }}</template>
                </el-table-column>
                <el-table-column label="到期" width="180">
                    <template #default="{ row }">
                        {{ row.until ? fmtTime(row.until) : "永久（不自动解除）" }}
                    </template>
                </el-table-column>
                <el-table-column label="状态" width="120">
                    <template #default="{ row }">
                        <el-tag
                            :type="row.active === false ? 'info' : 'success'"
                            size="small"
                        >
                            {{ row.active === false ? "已失效" : "生效中" }}
                        </el-tag>
                    </template>
                </el-table-column>
                <el-table-column label="操作人" width="150">
                    <template #default="{ row }">
                        <div>{{ row.punishedByUsername || "—" }}</div>
                        <div class="sub">{{ fmtTime(row.punishedAt) }}</div>
                    </template>
                </el-table-column>
                <el-table-column label="操作" width="140" fixed="right">
                    <template #default="{ row }">
                        <el-button
                            size="small"
                            text
                            :type="tab === 'banneds' ? 'primary' : 'success'"
                            :disabled="row.active === false"
                            @click="onAction(row)"
                        >
                            {{ tab === "banneds" ? "解封" : "解除禁言" }}
                        </el-button>
                    </template>
                </el-table-column>
            </el-table>
        </template>
    </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref, watch } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { useAuthStore } from "@/stores/auth";
import {
    listBanneds,
    listMutes,
    unmuteAccount,
    unmuteTeam,
} from "@/api/moderation";
import { unbanPlayer } from "@/api/players";
import { unbanTeam } from "@/api/teams";
import { fmtTime } from "@/utils/format";

// 处罚记录：GET /admin/mutes（staff + moderation.mute）与 GET /admin/banneds（admin）。
// 两个接口都不分页（limit ≤ 200），行里没有记录 id —— 解禁 / 解封都用 targetType + 目标 id。
const auth = useAuthStore();

const canViewMutes = computed(() => auth.can("moderation.mute"));

const tab = ref(canViewMutes.value ? "mutes" : "banneds");

const filters = reactive({
    status: "active",
    target: "all",
    accountId: "",
    teamId: "",
});

const muteState = reactive({ rows: [], hasMore: false, loading: false });
const banState = reactive({ rows: [], hasMore: false, loading: false });

const currentState = computed(() =>
    tab.value === "banneds" ? banState : muteState,
);

function rowKey(row) {
    const id = row.targetType === "team" ? row.teamId : row.accountId;
    return `${row.targetType}:${id}`;
}

function queryParams() {
    const accountId = String(filters.accountId || "").trim();
    const teamId = String(filters.teamId || "").trim();
    return {
        status: filters.status,
        target: filters.target,
        // 给了 account_id 时后端忽略 team_id 与 target
        ...(accountId ? { account_id: accountId } : {}),
        ...(teamId ? { team_id: teamId } : {}),
        limit: 200,
    };
}

async function load(state, request) {
    state.loading = true;
    try {
        const data = await request(queryParams());
        state.rows = Array.isArray(data?.items) ? data.items : [];
        state.hasMore = Boolean(data?.hasMore);
    } catch (err) {
        state.rows = [];
        state.hasMore = false;
        ElMessage.error(err.message || "读取处罚列表失败");
    } finally {
        state.loading = false;
    }
}

async function reload() {
    if (tab.value === "banneds") {
        if (!auth.isAdmin) return;
        await load(banState, listBanneds);
        return;
    }
    if (!canViewMutes.value) return;
    await load(muteState, listMutes);
}

function reset() {
    filters.status = "active";
    filters.target = "all";
    filters.accountId = "";
    filters.teamId = "";
    reload();
}

// 切页签时补一次（除了首次进入的那个）
watch(tab, (next, prev) => {
    if (!prev || next === "denied") return;
    reload();
});

function rowLabel(row) {
    if (row.targetType === "team") {
        return row.teamName || `队伍 #${row.teamId}`;
    }
    return row.username || row.playerNo || `账号 #${row.accountId}`;
}

async function onAction(row) {
    const isBan = tab.value === "banneds";
    const kindText = row.targetType === "team" ? "队伍" : "账号";

    try {
        await ElMessageBox.confirm(
            `确认解除「${rowLabel(row)}」的${kindText}${isBan ? "封禁" : "禁言"}？` +
                (row.until ? `\n到期时间：${fmtTime(row.until)}` : "\n到期时间：永久"),
            isBan ? "解封" : "解除禁言",
            { type: "warning", confirmButtonText: isBan ? "解封" : "解除禁言" },
        );
    } catch {
        return;
    }

    const targetId = row.targetType === "team" ? row.teamId : row.accountId;
    try {
        if (isBan) {
            await (row.targetType === "team"
                ? unbanTeam(targetId)
                : unbanPlayer(targetId));
            ElMessage.success("已解封（被封禁覆盖的原禁言不会恢复）");
        } else {
            await (row.targetType === "team"
                ? unmuteTeam(targetId)
                : unmuteAccount(targetId));
            ElMessage.success("已解除禁言");
        }
        reload();
    } catch (err) {
        // 解禁 404 = 当前未禁言（多半是刚好到期自动解除）
        if (!isBan && err?.status === 404) {
            ElMessage.info("该目标当前未被禁言（可能已到期自动解除）");
            reload();
            return;
        }
        ElMessage.error(err.message || "操作失败");
    }
}

onMounted(() => {
    if (tab.value === "denied") return;
    reload();
});
</script>

<style scoped>
.hint {
    margin: 0 0 12px;
    color: var(--el-text-color-secondary);
    font-size: 12px;
}
.sub {
    color: var(--el-text-color-secondary);
    font-size: 12px;
}
.truncated {
    margin-bottom: 12px;
}
</style>
