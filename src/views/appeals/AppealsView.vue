<template>
    <div class="page-card">
        <div class="filter-bar">
            <el-select v-model="filters.kind" placeholder="类型" style="width: 150px">
                <el-option label="全部类型" value="all" />
                <el-option label="封禁申诉" value="ban" />
                <el-option label="禁言申诉" value="mute" />
            </el-select>
            <el-select v-model="filters.state" placeholder="状态" style="width: 170px">
                <el-option label="待官方反馈" value="awaiting" />
                <el-option label="全部" value="all" />
            </el-select>
            <el-button type="primary" @click="search">查询</el-button>
            <el-button @click="reset">重置</el-button>
            <span class="hint">
                回复只解锁下一条申诉，不会自动解除处罚；解禁 / 解封需单独操作。
            </span>
        </div>

        <el-table v-loading="loading" :data="list" :row-key="rowKey" border stripe>
            <el-table-column type="expand">
                <template #default="{ row }">
                    <div class="expand">
                        <div class="expand__block">
                            <p class="expand__title">
                                最近一条申诉
                                <span v-if="row.lastAppealAt" class="expand__time">
                                    {{ fmtTime(row.lastAppealAt) }}
                                </span>
                            </p>
                            <p class="expand__subject">
                                {{ row.lastAppeal?.subject || "—" }}
                                <span v-if="row.lastAppeal?.mailId" class="expand__id">
                                    #{{ row.lastAppeal.mailId }}
                                </span>
                            </p>
                            <pre class="expand__body">{{
                                row.lastAppeal?.content || "（无正文）"
                            }}</pre>
                        </div>
                        <div class="expand__block">
                            <p class="expand__title">官方最近回复</p>
                            <pre class="expand__body">{{
                                row.lastReply?.content || "（尚未回复）"
                            }}</pre>
                        </div>
                    </div>
                </template>
            </el-table-column>
            <el-table-column label="主体" width="100">
                <template #default="{ row }">
                    <el-tag
                        :type="row.targetType === 'team' ? 'info' : 'primary'"
                        size="small"
                    >
                        {{ row.targetType === "team" ? "队伍" : "账号" }}
                    </el-tag>
                </template>
            </el-table-column>
            <el-table-column label="对象" min-width="200">
                <template #default="{ row }">
                    <template v-if="row.targetType === 'team'">
                        <div>{{ row.teamName || `队伍 #${row.teamId}` }}</div>
                        <div class="sub">
                            队长 {{ row.username || "—" }}
                            <span v-if="row.playerNo">· {{ row.playerNo }}</span>
                        </div>
                    </template>
                    <template v-else>
                        <div>{{ row.username || "—" }}</div>
                        <div class="sub">
                            {{ row.playerNo || "—" }} · 账号 #{{ row.accountId }}
                        </div>
                    </template>
                </template>
            </el-table-column>
            <el-table-column label="类型" width="110">
                <template #default="{ row }">
                    <el-tag
                        :type="row.kind === 'ban' ? 'danger' : 'warning'"
                        size="small"
                    >
                        {{ kindLabel(row) }}
                    </el-tag>
                </template>
            </el-table-column>
            <el-table-column label="处罚原因 / 到期" min-width="200">
                <template #default="{ row }">
                    <div>{{ penaltyReason(row) || "—" }}</div>
                    <div class="sub">{{ penaltyUntil(row) }}</div>
                </template>
            </el-table-column>
            <el-table-column label="申诉进度" width="170">
                <template #default="{ row }">
                    <span>{{ row.used ?? 0 }}/{{ row.limit ?? 3 }}</span>
                    <el-tag
                        :type="stateMeta(row.state).type"
                        size="small"
                        class="state-tag"
                    >
                        {{ stateMeta(row.state).label }}
                    </el-tag>
                </template>
            </el-table-column>
            <el-table-column label="最近申诉" min-width="200">
                <template #default="{ row }">
                    <div class="ellipsis">{{ row.lastAppeal?.content || "—" }}</div>
                    <div class="sub">{{ fmtTime(row.lastAppealAt) }}</div>
                </template>
            </el-table-column>
            <el-table-column label="操作" width="230" fixed="right">
                <template #default="{ row }">
                    <el-button
                        size="small"
                        text
                        type="primary"
                        :disabled="
                            !row.awaitingReply ||
                            (row.kind === 'ban' && !auth.isAdmin)
                        "
                        @click="openReply(row)"
                    >
                        回复申诉
                    </el-button>
                    <!-- 回复不解处罚：这里给出对应的解禁 / 解封入口 -->
                    <el-button
                        v-if="row.kind === 'mute' && canUnmute"
                        size="small"
                        text
                        type="success"
                        @click="unmuteRow(row)"
                    >
                        解除禁言
                    </el-button>
                    <el-button
                        v-else-if="row.kind === 'ban' && auth.isAdmin"
                        size="small"
                        text
                        type="danger"
                        @click="unbanRow(row)"
                    >
                        解封
                    </el-button>
                </template>
            </el-table-column>
        </el-table>

        <PageNav
            :page="page"
            :has-more="hasMore"
            :loading="loading"
            @prev="prev"
            @next="next"
        />

        <!-- 回复申诉 -->
        <el-dialog v-model="replyDialog.visible" title="回复申诉" width="540px">
            <p class="dialog-subject">
                对象：<strong>{{ replyLabel(replyDialog.row) }}</strong>
                （{{ kindLabel(replyDialog.row) }}申诉 ·
                {{
                    replyDialog.row?.targetType === "team"
                        ? "回复写入队伍频道"
                        : "回复写入账号频道"
                }}）
            </p>
            <p v-if="replyDialog.row?.lastAppeal?.content" class="dialog-quote">
                申诉内容：{{ replyDialog.row.lastAppeal.content }}
            </p>
            <el-input
                v-model="replyDialog.content"
                type="textarea"
                :rows="5"
                maxlength="2000"
                show-word-limit
                placeholder="请填写回复正文（1–2000 字）"
            />
            <p class="dialog-tip">
                回复会解锁该主体的下一条申诉，但不会自动解除处罚。
                <template v-if="replyDialog.row?.kind === 'mute'">
                    如需解除禁言，请回复后点「解除禁言」。
                </template>
                <template v-else-if="replyDialog.row?.targetType === 'team'">
                    如需解除队伍封禁，请回复后点「解封」（队长代表队伍提交，回复全队可见）。
                </template>
                <template v-else>
                    如需解除账号封禁，请回复后点「解封」。
                </template>
            </p>
            <template #footer>
                <el-button @click="replyDialog.visible = false">取消</el-button>
                <el-button
                    type="primary"
                    :loading="replyDialog.loading"
                    @click="submitReply"
                >
                    发送回复
                </el-button>
            </template>
        </el-dialog>
    </div>
</template>

<script setup>
import { computed, onMounted, reactive } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { useAuthStore } from "@/stores/auth";
import {
    listAppeals,
    replyAppeal,
    unmuteAccount,
    unmuteTeam,
} from "@/api/moderation";
import { unbanPlayer } from "@/api/players";
import { unbanTeam } from "@/api/teams";
import { useCursorPage } from "@/composables/useCursorPage";
import PageNav from "@/components/PageNav.vue";
import { fmtTime } from "@/utils/format";

const auth = useAuthStore();

// 行同时覆盖账号级与队伍级：targetType + accountId / teamId 才是解禁、解封的依据。
// 可见范围：禁言申诉需 moderation.mute；封禁申诉仅 admin。
const filters = reactive({ kind: "all", state: "awaiting" });

const fetcher = (cursor) => listAppeals({ ...filters, cursor, limit: 20 });
const { list, page, hasMore, loading, first, next, prev } = useCursorPage(fetcher);

const canUnmute = computed(() => auth.can("moderation.mute"));

function rowKey(row) {
    // 队伍级行同时带 accountId（代表队伍的队长），所以主键必须按 targetType 取对应 id
    const id = row.targetType === "team" ? row.teamId : row.accountId;
    return `${row.targetType}:${id}`;
}

function search() {
    first();
}
function reset() {
    filters.kind = auth.isAdmin ? "all" : "mute";
    filters.state = "awaiting";
    first();
}

function kindLabel(row) {
    if (!row) return "—";
    if (row.kind === "ban") {
        return row.targetType === "team" ? "队伍封禁" : "账号封禁";
    }
    if (row.kind === "mute") {
        return row.targetType === "team" ? "队伍禁言" : "账号禁言";
    }
    return "—";
}

function replyLabel(row) {
    if (!row) return "—";
    if (row.targetType === "team") {
        return `${row.teamName || `队伍 #${row.teamId}`}（队长 ${row.username || "—"}）`;
    }
    return row.username || row.playerNo || `账号 #${row.accountId}`;
}

function penaltyReason(row) {
    return row?.kind === "ban" ? row?.banReason : row?.muteReason;
}

function penaltyUntil(row) {
    const until = row?.kind === "ban" ? row?.banUntil : row?.muteUntil;
    return until ? `至 ${fmtTime(until)}` : "永久 / 未设置到期";
}

// appeal.state：none / can_submit / awaiting_reply / closed
function stateMeta(state) {
    const map = {
        none: { label: "无需申诉", type: "info" },
        can_submit: { label: "可提交", type: "success" },
        awaiting_reply: { label: "等官方反馈", type: "warning" },
        closed: { label: "已关闭", type: "danger" },
    };
    return map[state] || { label: state || "—", type: "info" };
}

function targetIdOf(row) {
    return row?.targetType === "team" ? row.teamId : row.accountId;
}

// ---- 回复申诉 ----
const replyDialog = reactive({
    visible: false,
    row: null,
    content: "",
    loading: false,
});

function openReply(row) {
    replyDialog.row = row;
    replyDialog.content = "";
    replyDialog.visible = true;
}

async function submitReply() {
    const row = replyDialog.row;
    const content = replyDialog.content.trim();
    if (!row || !content) {
        ElMessage.warning("请填写回复正文");
        return;
    }

    replyDialog.loading = true;
    try {
        // 账号级与队伍级都要带 kind：封禁申诉仅 admin 可回复
        await replyAppeal(row.targetType, targetIdOf(row), {
            kind: row.kind,
            content,
        });
        ElMessage.success("已回复，该主体可以继续申诉");
        replyDialog.visible = false;
        first();
    } catch (err) {
        if (err?.status === 404) {
            ElMessage.error("该主体没有可回复的申诉（可能已被处理）");
            replyDialog.visible = false;
            first();
            return;
        }
        ElMessage.error(err.message || "回复失败");
    } finally {
        replyDialog.loading = false;
    }
}

// ---- 直接解除处罚（回复不会自动解除）----
async function unmuteRow(row) {
    try {
        await ElMessageBox.confirm(
            `确认解除「${replyLabel(row)}」的禁言？`,
            "解除禁言",
            { type: "warning", confirmButtonText: "解除禁言" },
        );
    } catch {
        return;
    }

    try {
        const id = targetIdOf(row);
        await (row.targetType === "team" ? unmuteTeam(id) : unmuteAccount(id));
        ElMessage.success("已解除禁言");
        first();
    } catch (err) {
        if (err?.status === 404) {
            ElMessage.info("该主体当前未被禁言（可能已到期自动解除）");
            first();
            return;
        }
        ElMessage.error(err.message || "解除禁言失败");
    }
}

async function unbanRow(row) {
    try {
        await ElMessageBox.confirm(
            `确认解除「${replyLabel(row)}」的封禁？`,
            "解封",
            { type: "warning", confirmButtonText: "解封" },
        );
    } catch {
        return;
    }

    try {
        const id = targetIdOf(row);
        await (row.targetType === "team" ? unbanTeam(id) : unbanPlayer(id));
        ElMessage.success("已解封（被封禁覆盖的原禁言不会恢复）");
        first();
    } catch (err) {
        ElMessage.error(err.message || "解封失败");
    }
}

onMounted(() => {
    // staff 没有封禁申诉权限：默认只看禁言申诉
    if (!auth.isAdmin) filters.kind = "mute";
    first();
});
</script>

<style scoped>
.hint {
    color: var(--el-text-color-secondary);
    font-size: 12px;
}
.sub {
    color: var(--el-text-color-secondary);
    font-size: 12px;
}
.state-tag {
    margin-left: 6px;
}
.ellipsis {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.expand {
    display: flex;
    gap: 16px;
    padding: 4px 8px;
}
.expand__block {
    flex: 1;
    min-width: 0;
}
.expand__title {
    margin: 0 0 6px;
    font-size: 12px;
    color: var(--el-text-color-secondary);
}
.expand__time,
.expand__id {
    margin-left: 6px;
    color: var(--el-text-color-secondary);
}
.expand__subject {
    margin: 0 0 4px;
    font-weight: 600;
    font-size: 13px;
}
.expand__body {
    margin: 0;
    padding: 8px 10px;
    background: #f5f7fa;
    border-radius: 4px;
    font-size: 13px;
    line-height: 1.7;
    white-space: pre-wrap;
    word-break: break-word;
    max-height: 160px;
    overflow-y: auto;
}
.dialog-subject {
    margin: 0 0 8px;
    font-size: 13px;
}
.dialog-quote {
    margin: 0 0 10px;
    padding: 8px 10px;
    background: #f5f7fa;
    border-radius: 4px;
    font-size: 12px;
    line-height: 1.7;
    color: var(--el-text-color-regular);
    max-height: 120px;
    overflow-y: auto;
    white-space: pre-wrap;
    word-break: break-word;
}
.dialog-tip {
    margin: 10px 0 0;
    font-size: 12px;
    color: var(--el-text-color-secondary);
    line-height: 1.6;
}
</style>
