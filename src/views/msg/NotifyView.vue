<template>
    <div class="page-card">
        <el-alert
            type="info"
            :closable="false"
            show-icon
            class="tip-alert"
            title="定向通知：向指定账号 / 队伍各发一封站内信（来源 notice，玩家侧显示真实操作者用户名）。"
        >
            <template #default>
                每位收件人各得一封根邮件，全部成功才会写入（失败一封都不发）；
                去重后收件人合计不得超过 50 个；账号默认允许回复，<strong>队伍收件人恒为仅通知</strong>。
            </template>
        </el-alert>

        <el-tabs v-model="activeTab" class="tabs">
            <!-- ---------- 定向通知 ---------- -->
            <el-tab-pane label="定向通知" name="notify">
                <el-form label-width="110px" class="notify-form">
                    <el-form-item label="收件账号">
                        <el-select
                            v-model="accountIds"
                            multiple
                            filterable
                            remote
                            reserve-keyword
                            clearable
                            :remote-method="searchPlayers"
                            :loading="playerLoading"
                            placeholder="输入用户名或玩家编号搜索（可多选）"
                            class="recipients"
                        >
                            <el-option
                                v-for="item in playerOptions"
                                :key="`p-${item.id}`"
                                :label="playerLabel(item)"
                                :value="item.id"
                            />
                        </el-select>
                    </el-form-item>
                    <el-form-item label="收件队伍">
                        <el-select
                            v-model="teamIds"
                            multiple
                            filterable
                            clearable
                            :loading="teamLoading"
                            placeholder="按队名筛选（可多选）"
                            class="recipients"
                        >
                            <el-option
                                v-for="item in teamOptions"
                                :key="`t-${item.id}`"
                                :label="teamLabel(item)"
                                :value="item.id"
                                :disabled="item.status === 1"
                            />
                        </el-select>
                        <p class="field-hint">
                            队伍已解散（状态 1）无法发送；禁言 / 封禁中的账号与队伍仍可收到通知。
                        </p>
                    </el-form-item>

                    <el-form-item label="主题">
                        <el-input
                            v-model="notifyForm.subject"
                            maxlength="80"
                            show-word-limit
                            placeholder="主题（1–80 字，必填）"
                        />
                    </el-form-item>
                    <el-form-item label="正文">
                        <el-input
                            v-model="notifyForm.content"
                            type="textarea"
                            :rows="6"
                            maxlength="2000"
                            show-word-limit
                            placeholder="正文（1–2000 字，必填）"
                        />
                    </el-form-item>
                    <el-form-item label="允许回复">
                        <el-switch
                            v-model="notifyForm.allowReply"
                            :disabled="hasNoAccountRecipient && teamIds.length > 0"
                        />
                        <span class="field-hint inline">
                            {{
                                teamIds.length && !accountIds.length
                                    ? "只发队伍：队伍通知恒为仅通知，无法回复。"
                                    : "关闭后整条链封口（收件人侧 canReply=false），要再联系需新发一封；仅对账号收件人生效。"
                            }}
                        </span>
                    </el-form-item>

                    <el-form-item label="收件人合计">
                        <el-tag :type="recipientCount > MAX_RECIPIENTS ? 'danger' : 'info'">
                            {{ recipientCount }} / {{ MAX_RECIPIENTS }}
                        </el-tag>
                        <span class="field-hint inline">
                            账号 {{ accountIds.length }} 个 · 队伍 {{ teamIds.length }} 个
                        </span>
                    </el-form-item>

                    <el-form-item>
                        <el-button
                            type="primary"
                            :loading="sending"
                            :disabled="!canSend"
                            @click="sendNotify"
                        >
                            发送通知
                        </el-button>
                        <el-button @click="resetNotify">清空</el-button>
                    </el-form-item>
                </el-form>

                <el-card v-if="notifyResult" shadow="never" class="result">
                    <template #header>
                        发送结果：共 {{ notifyResult.count }} 封（sent={{ notifyResult.sent }}）
                    </template>
                    <el-table :data="notifyResult.mails" border stripe size="small">
                        <el-table-column label="收件人类型" width="120">
                            <template #default="{ row }">
                                {{ row.type === "team" ? "队伍" : "账号" }}
                            </template>
                        </el-table-column>
                        <el-table-column prop="id" label="收件人 ID" width="120" />
                        <el-table-column prop="mailId" label="邮件 ID" width="120" />
                    </el-table>
                </el-card>
            </el-tab-pane>

            <!-- ---------- 内部公告（仅 admin） ---------- -->
            <el-tab-pane v-if="auth.isAdmin" label="内部公告" name="internal">
                <el-alert
                    type="warning"
                    :closable="false"
                    show-icon
                    class="tip-alert"
                    title="管理级内部公告：只向 staff 与 admin 广播，玩家在任何读取路径上都看不到。"
                >
                    <template #default>
                        写入唯一的内部频道（只读广播，任何人不可回复；发布后不可撤回）。
                        历史记录在
                        <el-button link type="primary" @click="openInternalHistory">
                            站内信工作台 · 内部公告频道
                        </el-button>
                        。
                    </template>
                </el-alert>

                <el-form label-width="110px" class="notify-form">
                    <el-form-item label="主题">
                        <el-input
                            v-model="internalForm.subject"
                            maxlength="80"
                            show-word-limit
                            placeholder="主题（1–80 字，必填）"
                        />
                    </el-form-item>
                    <el-form-item label="正文">
                        <el-input
                            v-model="internalForm.content"
                            type="textarea"
                            :rows="6"
                            maxlength="2000"
                            show-word-limit
                            placeholder="正文（1–2000 字，必填）"
                        />
                    </el-form-item>
                    <el-form-item>
                        <el-button
                            type="primary"
                            :loading="publishing"
                            :disabled="!canPublishInternal"
                            @click="publishInternal"
                        >
                            发布内部公告
                        </el-button>
                        <span class="warn">⚠ 无撤回接口，请确认后再发布</span>
                    </el-form-item>
                </el-form>

                <el-card v-if="internalResult" shadow="never" class="result">
                    <template #header>发布成功</template>
                    <p class="result-line">
                        会话 threadId：{{ internalResult.threadId }} · 消息 msgId：{{
                            internalResult.msgId
                        }}
                        · 时间：{{ fmtTime(internalResult.createdAt) }}
                    </p>
                </el-card>
            </el-tab-pane>
        </el-tabs>
    </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from "vue";
import { useRouter } from "vue-router";
import { ElMessage } from "element-plus";
import { useAuthStore } from "@/stores/auth";
import { listPlayers } from "@/api/players";
import { listTeams } from "@/api/teams";
import { notifyTargets, publishInternalAnnounce } from "@/api/msg";
import { fmtTime, TEAM_STATUS, statusMeta } from "@/utils/format";

const auth = useAuthStore();
const router = useRouter();

// 服务端上限：合并去重后收件人合计 ≤ 50（超出 400 E_VALIDATION）
const MAX_RECIPIENTS = 50;

const activeTab = ref("notify");

const accountIds = ref([]);
const teamIds = ref([]);

// ---- 账号收件人：GET /admin/players 支持 keyword（编号或用户名），滚动做远程搜索 ----
const playerOptions = ref([]);
const playerLoading = ref(false);
// 请求序号：每次搜索（含清空关键字）都自增，只有最新一次的响应能改选项 / 报错 / 关 loading
let searchSeq = 0;

function playerLabel(item) {
    if (!item) return "";
    const no = item.playerNo ? ` · ${item.playerNo}` : "";
    return `${item.username || "（无用户名）"}${no}（#${item.id}）`;
}

// 只保留已选中的账号：el-select 的 label 依赖选项对象，丢了已选值会退化成裸 id
function keepSelectedPlayers() {
    const selected = new Set(accountIds.value);
    playerOptions.value = playerOptions.value.filter((item) =>
        selected.has(item.id),
    );
}

// 本次搜索结果整体替换旧结果（仅保留已选中的账号）：
// 否则先搜 Alice 再搜 Bob，未选中的 Alice 仍会留在下拉里；无结果时也会残留上一次的列表
function mergePlayers(items) {
    const selected = new Set(accountIds.value);
    const map = new Map(
        playerOptions.value
            .filter((item) => selected.has(item.id))
            .map((item) => [item.id, item]),
    );
    for (const item of items) {
        if (item && item.id != null) map.set(item.id, item);
    }
    playerOptions.value = [...map.values()];
}

async function searchPlayers(keyword) {
    const seq = (searchSeq += 1);
    const kw = String(keyword || "").trim();
    if (!kw) {
        // 清空关键字也要让在途请求失效，否则它晚到会把旧结果重新塞回下拉
        keepSelectedPlayers();
        playerLoading.value = false;
        return;
    }
    playerLoading.value = true;
    try {
        const data = await listPlayers({ keyword: kw, limit: 50 });
        // 已经有更新的输入（或已清空）：本次结果整体丢弃
        if (seq !== searchSeq) return;
        mergePlayers(data?.items || []);
    } catch (err) {
        if (seq !== searchSeq) return;
        ElMessage.error(err.message);
    } finally {
        // loading 归最新一次请求管，旧请求不要替它关掉
        if (seq === searchSeq) playerLoading.value = false;
    }
}

// ---- 队伍收件人：GET /admin/teams 没有 keyword，翻到底后本地过滤（同 Tips 发放页） ----
const TEAM_PAGE_LIMIT = 100;
const MAX_TEAM_PAGES = 1000;
const teamOptions = ref([]);
const teamLoading = ref(false);

function teamLabel(item) {
    if (!item) return "";
    const status = statusMeta(item.status, TEAM_STATUS).label;
    return `${item.name || "（未命名）"}（#${item.id}）· ${status}`;
}

async function loadTeams() {
    teamLoading.value = true;
    try {
        const items = [];
        const seenIds = new Set();
        const seenCursors = new Set();
        let cursor;
        for (let page = 0; page < MAX_TEAM_PAGES; page += 1) {
            const data = await listTeams({ cursor, limit: TEAM_PAGE_LIMIT });
            for (const item of data?.items || []) {
                if (seenIds.has(item.id)) continue;
                seenIds.add(item.id);
                items.push(item);
            }
            if (!data?.hasMore || !data?.nextCursor) break;
            // 游标没有前进就停，避免服务端异常时死循环
            if (seenCursors.has(data.nextCursor)) break;
            seenCursors.add(data.nextCursor);
            cursor = data.nextCursor;
        }
        teamOptions.value = items;
    } catch (err) {
        ElMessage.error(err.message);
    } finally {
        teamLoading.value = false;
    }
}

// ---- 定向通知 ----
const notifyForm = reactive({
    subject: "",
    content: "",
    allowReply: true,
});
const sending = ref(false);
const notifyResult = ref(null);

const recipientCount = computed(
    () => new Set(accountIds.value).size + new Set(teamIds.value).size,
);
const hasNoAccountRecipient = computed(() => accountIds.value.length === 0);

const canSend = computed(() => {
    const subject = notifyForm.subject.trim();
    const content = notifyForm.content.trim();
    return (
        recipientCount.value > 0 &&
        recipientCount.value <= MAX_RECIPIENTS &&
        subject.length >= 1 &&
        subject.length <= 80 &&
        content.length >= 1 &&
        content.length <= 2000
    );
});

async function sendNotify() {
    if (!canSend.value) {
        ElMessage.warning("请填写主题与正文，并至少选择一个收件人（合计 ≤ 50）");
        return;
    }
    const subject = notifyForm.subject.trim();
    const content = notifyForm.content.trim();

    sending.value = true;
    notifyResult.value = null;
    try {
        // allow_reply 只对账号收件人生效：只发队伍时不下发该字段（服务端一律按仅通知处理）
        const body = { subject, content };
        if (accountIds.value.length) {
            body.account_ids = accountIds.value;
            body.allow_reply = notifyForm.allowReply;
        }
        if (teamIds.value.length) {
            body.team_ids = teamIds.value;
        }
        const data = await notifyTargets(body);
        notifyResult.value = {
            sent: Boolean(data?.sent),
            count: Number(data?.count ?? 0),
            mails: Array.isArray(data?.mails) ? data.mails : [],
        };
        ElMessage.success(`已发送 ${notifyResult.value.count} 封通知`);
        notifyForm.subject = "";
        notifyForm.content = "";
    } catch (err) {
        if (err?.status === 404) {
            ElMessage.error("有收件人不存在（账号或队伍 id 无效），请刷新后重试");
        } else if (err?.status === 409) {
            ElMessage.error(err.message || "队伍已解散，无法发送");
        } else if (err?.status === 400) {
            ElMessage.error(err.message || "请求不合法（收件人为空或超过 50 个）");
        } else if (err?.status === 403) {
            ElMessage.error("没有 msg.notify.send 权限");
        } else {
            ElMessage.error(err.message || "发送失败");
        }
    } finally {
        sending.value = false;
    }
}

function resetNotify() {
    accountIds.value = [];
    teamIds.value = [];
    notifyForm.subject = "";
    notifyForm.content = "";
    notifyForm.allowReply = true;
    notifyResult.value = null;
}

// ---- 内部公告（仅 admin） ----
const internalForm = reactive({ subject: "", content: "" });
const publishing = ref(false);
const internalResult = ref(null);

const canPublishInternal = computed(() => {
    const subject = internalForm.subject.trim();
    const content = internalForm.content.trim();
    return (
        auth.isAdmin &&
        subject.length >= 1 &&
        subject.length <= 80 &&
        content.length >= 1 &&
        content.length <= 2000
    );
});

async function publishInternal() {
    if (!canPublishInternal.value) {
        ElMessage.warning("请填写主题与正文（各 1–80 / 1–2000 字）");
        return;
    }
    publishing.value = true;
    internalResult.value = null;
    try {
        const data = await publishInternalAnnounce({
            subject: internalForm.subject.trim(),
            content: internalForm.content.trim(),
        });
        internalResult.value = data || {};
        ElMessage.success("内部公告已发布");
        internalForm.subject = "";
        internalForm.content = "";
    } catch (err) {
        if (err?.status === 403) {
            ElMessage.error("发布内部公告需要 admin 权限");
        } else {
            ElMessage.error(err.message || "发布失败");
        }
    } finally {
        publishing.value = false;
    }
}

function openInternalHistory() {
    router.push({ path: "/messages", query: { channel: "internal" } });
}

onMounted(() => {
    loadTeams();
});
</script>

<style scoped>
.tip-alert {
    margin-bottom: 12px;
}
.tabs {
    margin-top: 4px;
}
.notify-form {
    max-width: 860px;
    padding-top: 8px;
}
.recipients {
    width: 100%;
}
.field-hint {
    margin: 4px 0 0;
    color: var(--el-text-color-secondary);
    font-size: 12px;
    line-height: 1.6;
}
.field-hint.inline {
    margin: 0 0 0 10px;
}
.result {
    margin-top: 12px;
    max-width: 860px;
}
.result-line {
    margin: 0;
    font-size: 13px;
}
.warn {
    margin-left: 12px;
    color: #e6a23c;
    font-size: 12px;
}
</style>
