<template>
    <div class="page-card">
        <!-- 四个页签合并在同一页：定向通知 / 官方公告 / 公告历史 / 内部公告。
             每个页签各自按权限显示，说明文案也各自跟着页签走（不再顶部固定一条）。 -->
        <el-tabs v-model="activeTab" class="tabs">
            <!-- ---------- 定向通知（需 msg.notify.send） ---------- -->
            <el-tab-pane v-if="canNotify" label="定向通知" name="notify">
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

                <el-form label-width="110px" class="form-block">
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

            <!-- ---------- 官方公告（需 msg.announce.publish） ---------- -->
            <el-tab-pane v-if="canAnnounce" label="官方公告" name="announce">
                <el-alert
                    type="warning"
                    :closable="false"
                    show-icon
                    class="tip-alert"
                    title="官方公告：写入全局系统频道，所有玩家可见，发布后不可撤回。"
                >
                    <template #default>
                        玩家侧在「官方公告」频道收到这封只读广播（<code>canReply=false</code>）。
                        与玩家看到的会话视图对照请用
                        <el-button link type="primary" @click="openAnnounceChannel">
                            站内信工作台 · 系统公告频道
                        </el-button>
                        ；发布记录在「公告历史」页签。
                    </template>
                </el-alert>

                <el-form label-width="110px" class="form-block">
                    <el-form-item label="主题">
                        <el-input
                            v-model="announceForm.subject"
                            maxlength="80"
                            show-word-limit
                            placeholder="公告主题（1–80 字，必填）"
                        />
                    </el-form-item>
                    <el-form-item label="正文">
                        <el-input
                            v-model="announceForm.content"
                            type="textarea"
                            :rows="6"
                            maxlength="2000"
                            show-word-limit
                            placeholder="公告正文（1–2000 字，必填）"
                        />
                    </el-form-item>
                    <el-form-item>
                        <el-button
                            type="primary"
                            :loading="announcing"
                            :disabled="!canPublishAnnounce"
                            @click="publishAnnounce"
                        >
                            发布公告
                        </el-button>
                        <span class="warn">⚠ 无撤回接口，请确认后再发布</span>
                    </el-form-item>
                </el-form>

                <el-card v-if="announceResult" shadow="never" class="result">
                    <template #header>发布成功</template>
                    <p class="result-line">
                        会话 threadId：{{ announceResult.threadId }} · 消息 msgId：{{
                            announceResult.msgId
                        }}
                        · 时间：{{ fmtTime(announceResult.createdAt) }}
                        · 附件 {{ announceResult.attachments?.length || 0 }} 张
                    </p>
                </el-card>
            </el-tab-pane>

            <!-- ---------- 公告历史（倒序，独立页签） ---------- -->
            <el-tab-pane v-if="canAnnounce" label="公告历史" name="history">
                <el-alert
                    type="info"
                    :closable="false"
                    show-icon
                    class="tip-alert"
                    title="历史公告（倒序）：与玩家侧「官方公告」频道同源，含正文与附件数量。"
                />

                <el-table v-loading="loading" :data="list" border stripe>
                    <el-table-column prop="id" label="ID" width="90" />
                    <el-table-column prop="subject" label="主题" min-width="200" />
                    <el-table-column label="内容" min-width="360">
                        <template #default="{ row }">{{ row.content }}</template>
                    </el-table-column>
                    <el-table-column prop="contentType" label="类型" width="100" />
                    <el-table-column label="附件" width="90">
                        <template #default="{ row }">
                            {{ row.attachments?.length || "—" }}
                        </template>
                    </el-table-column>
                    <el-table-column label="发布时间" width="180">
                        <template #default="{ row }">{{ fmtTime(row.createdAt) }}</template>
                    </el-table-column>
                </el-table>

                <PageNav
                    :page="page"
                    :has-more="hasMore"
                    :loading="loading"
                    @prev="prev"
                    @next="next"
                />
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

                <el-form label-width="110px" class="form-block">
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
import { computed, onMounted, reactive, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ElMessage } from "element-plus";
import { useAuthStore } from "@/stores/auth";
import { listPlayers } from "@/api/players";
import { listTeams } from "@/api/teams";
import {
    announce,
    listAnnouncements,
    notifyTargets,
    publishInternalAnnounce,
} from "@/api/msg";
import { useCursorPage } from "@/composables/useCursorPage";
import PageNav from "@/components/PageNav.vue";
import { fmtTime, TEAM_STATUS, statusMeta } from "@/utils/format";
import { extractErrorMessage } from "@/api/errors";

const auth = useAuthStore();
const router = useRouter();
const route = useRoute();

// 服务端上限：合并去重后收件人合计 ≤ 50（超出 400 E_VALIDATION）
const MAX_RECIPIENTS = 50;

// ---- 页签（四个功能合并成一页） ----
// 定向通知 → msg.notify.send；官方公告 / 公告历史 → msg.announce.publish；
// 内部公告 → 仅 admin（后端不挂权限码，只校验角色）。admin 由 can() 直通。
const canNotify = computed(() => auth.can("msg.notify.send"));
const canAnnounce = computed(() => auth.can("msg.announce.publish"));

const TAB_NAMES = ["notify", "announce", "history", "internal"];
const tabVisible = computed(() => ({
    notify: canNotify.value,
    announce: canAnnounce.value,
    history: canAnnounce.value,
    internal: auth.isAdmin,
}));

function firstVisibleTab() {
    return TAB_NAMES.find((name) => tabVisible.value[name]) || "notify";
}

// 支持深链（旧 /announcements 会重定向到 ?tab=announce）；指定的页签不可见时回落到第一个可见的
const requested = String(route.query.tab || "");
const activeTab = ref(
    TAB_NAMES.includes(requested) && tabVisible.value[requested]
        ? requested
        : firstVisibleTab(),
);

// 权限被回收后当前页签可能已经不该显示：换到第一个可见页签，避免停在空白页
watch(
    tabVisible,
    (visible) => {
        if (!visible[activeTab.value]) activeTab.value = firstVisibleTab();
    },
    { deep: true },
);

// 同一组件内跳转（如旧 /announcements 重定向到 ?tab=announce）不会重建实例，
// setup 只跑一次，所以 query 变化要单独接住
watch(
    () => route.query.tab,
    (tab) => {
        const name = String(tab || "");
        if (TAB_NAMES.includes(name) && tabVisible.value[name]) {
            activeTab.value = name;
        }
    },
);

// 反向同步：手动切页签时把 tab 写回地址栏（replace，不留历史），
// 刷新 / 复制链接都能回到同一页签
watch(activeTab, (tab) => {
    if (String(route.query.tab || "") === tab) return;
    router.replace({ path: route.path, query: { ...route.query, tab } });
});

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
        ElMessage.error(extractErrorMessage(err));
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
        ElMessage.error(extractErrorMessage(err));
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
            ElMessage.error(extractErrorMessage(err, "队伍已解散，无法发送"));
        } else if (err?.status === 400) {
            ElMessage.error(extractErrorMessage(err, "请求不合法（收件人为空或超过 50 个）"));
        } else if (err?.status === 403) {
            ElMessage.error("没有 msg.notify.send 权限");
        } else {
            ElMessage.error(extractErrorMessage(err, "发送失败"));
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

// ---- 官方公告（需 msg.announce.publish） ----
const announceForm = reactive({ subject: "", content: "" });
const announcing = ref(false);
const announceResult = ref(null);

const canPublishAnnounce = computed(() => {
    const subject = announceForm.subject.trim();
    const content = announceForm.content.trim();
    return (
        canAnnounce.value &&
        subject.length >= 1 &&
        subject.length <= 80 &&
        content.length >= 1 &&
        content.length <= 2000
    );
});

async function publishAnnounce() {
    if (!canPublishAnnounce.value) {
        ElMessage.warning("请填写主题与正文（各 1–80 / 1–2000 字）");
        return;
    }
    announcing.value = true;
    announceResult.value = null;
    try {
        const data = await announce({
            subject: announceForm.subject.trim(),
            content: announceForm.content.trim(),
        });
        announceResult.value = data || {};
        ElMessage.success("公告已发布");
        announceForm.subject = "";
        announceForm.content = "";
        // 新公告排在倒序列表最前面：已经打开过「公告历史」就顺手刷新
        if (historyLoaded.value) first();
    } catch (err) {
        if (err?.status === 403) {
            ElMessage.error("发布公告需要 msg.announce.publish 权限");
        } else {
            ElMessage.error(extractErrorMessage(err, "发布失败"));
        }
    } finally {
        announcing.value = false;
    }
}

function openAnnounceChannel() {
    router.push({ path: "/letters/messages", query: { channel: "system" } });
}

// ---- 公告历史（倒序游标分页，首次切到该页签才请求） ----
const historyFetcher = (cursor) => listAnnouncements({ cursor, limit: 50 });
const {
    list,
    page,
    hasMore,
    loading,
    first,
    next,
    prev,
} = useCursorPage(historyFetcher);

const historyLoaded = ref(false);
watch(
    activeTab,
    (tab) => {
        if (tab !== "history" || historyLoaded.value) return;
        historyLoaded.value = true;
        first().catch((err) =>
            ElMessage.error(extractErrorMessage(err, "读取公告历史失败")),
        );
    },
    { immediate: true },
);

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
            ElMessage.error(extractErrorMessage(err, "发布失败"));
        }
    } finally {
        publishing.value = false;
    }
}

function openInternalHistory() {
    router.push({ path: "/letters/messages", query: { channel: "internal" } });
}

onMounted(() => {
    // 队伍收件人只服务「定向通知」页签：没有该权限就不必翻完全部队伍
    if (canNotify.value) loadTeams();
});
</script>

<style scoped>
.tip-alert {
    margin-bottom: 12px;
}
.tabs {
    margin-top: 4px;
}
.form-block {
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
