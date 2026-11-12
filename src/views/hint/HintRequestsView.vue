<template>
  <div class="page-card">
    <div class="filter-bar">
      <!-- 工单筛选（迁移 0041）：默认只看待处理栏；业务状态仍然保留，便于回看历史 -->
      <el-select v-model="filters.ticketStatus" style="width: 190px" @change="search">
        <el-option
          v-for="item in TICKET_FILTER_OPTIONS"
          :key="item.value"
          :label="item.label"
          :value="item.value"
        />
      </el-select>
      <el-select v-model="filters.status" style="width: 160px" @change="search">
        <el-option v-for="item in STATUS_OPTIONS" :key="item.value" :label="item.label" :value="item.value" />
      </el-select>
      <el-checkbox v-model="filters.ticketOverdue" @change="search">只看超时</el-checkbox>
      <el-button type="primary" @click="search">查询</el-button>
      <el-button @click="reset">重置</el-button>
      <span class="tip">
        报价前需先接手工单；报价即受理并释放该队的一个待报价名额；答复在玩家确认扣费后才送达。
      </span>
      <span v-if="hintSummary" class="summary-line">
        待处理 {{ hintSummary.pending }} · 处理中 {{ hintSummary.processing }} ·
        超时 {{ (hintSummary.pendingOverdue ?? 0) + (hintSummary.processingOverdue ?? 0) }}
        <template v-if="hintSummary.mine">· 我处理中 {{ hintSummary.mine }}</template>
      </span>
    </div>

    <el-table
      v-loading="loading"
      :data="list"
      row-key="id"
      border
      stripe
      @expand-change="onExpandChange"
    >
      <!-- 展开行：工单状态条、问题全文、staff 自己写下的答复（draftReply）与各阶段时间 -->
      <el-table-column type="expand">
        <template #default="{ row }">
          <div class="expand">
            <TicketBar
              :ticket="row.ticket"
              :can-release="isMine(row)"
              :busy="releasingId === row.ticket?.ticketId"
              @release="releaseRowTicket(row)"
            />

            <div class="expand-block">
              <span class="expand-label">问题</span>
              <p v-if="row.question" class="expand-text">{{ row.question }}</p>
              <p v-else-if="isContentHidden(row)" class="expand-text hidden-tip">
                其他 staff 处理中，问题内容已隐藏
              </p>
              <p v-else class="expand-text">—</p>
              <!-- 提问截图（2026-10-31 起）：报价前就能看，是定价依据 -->
              <AttachmentGallery :items="row.attachments" size="large" />
            </div>
            <div class="expand-block">
              <span class="expand-label">
                答复（只存服务端，玩家确认扣费后才送达）
              </span>
              <p v-if="row.draftReply" class="expand-text">{{ row.draftReply }}</p>
              <p v-else-if="isContentHidden(row)" class="expand-text hidden-tip">
                其他 staff 处理中，答复内容已隐藏
              </p>
              <p v-else class="expand-text">—</p>
            </div>
            <p v-if="row.questionMailId || row.cheaperMailId" class="expand-links">
              <el-button
                v-if="row.questionMailId"
                link
                type="primary"
                size="small"
                @click="openRelatedMail(row.questionMailId)"
              >
                提问邮件 #{{ row.questionMailId }}
              </el-button>
              <el-button
                v-if="row.cheaperMailId"
                link
                type="primary"
                size="small"
                @click="openRelatedMail(row.cheaperMailId)"
              >
                议价邮件 #{{ row.cheaperMailId }}
              </el-button>
            </p>
            <el-descriptions :column="3" size="small" border>
              <el-descriptions-item label="实际扣费">
                {{ row.cost ?? "—" }}
              </el-descriptions-item>
              <el-descriptions-item label="报价时间">
                {{ fmtTime(row.quotedAt) }}
              </el-descriptions-item>
              <el-descriptions-item label="报价人">
                {{ row.quotedBy || "—" }}
              </el-descriptions-item>
              <el-descriptions-item label="申请降价">
                {{ fmtTime(row.cheaperRequestedAt) }}
              </el-descriptions-item>
              <el-descriptions-item label="回应降价">
                {{ fmtTime(row.cheaperDecidedAt) }}
              </el-descriptions-item>
              <el-descriptions-item label="是否最低报价">
                {{ row.isLowestPrice ? "是" : "否" }}
              </el-descriptions-item>
              <el-descriptions-item label="确认扣费">
                {{ fmtTime(row.confirmedAt) }}
              </el-descriptions-item>
              <el-descriptions-item label="结束时间">
                {{ fmtTime(row.decidedAt) }}
              </el-descriptions-item>
              <el-descriptions-item label="答复消息 ID">
                {{ row.replyMsgId ?? "—" }}
              </el-descriptions-item>
            </el-descriptions>
          </div>
        </template>
      </el-table-column>
      <el-table-column prop="id" label="ID" width="70" />
      <el-table-column label="队伍" min-width="130">
        <template #default="{ row }">{{ row.teamName || "—" }}（#{{ row.teamId }}）</template>
      </el-table-column>
      <el-table-column label="发起人" min-width="130">
        <template #default="{ row }">{{ row.username || "—" }}（{{ row.playerNo || "—" }}）</template>
      </el-table-column>
      <el-table-column label="问题" min-width="240">
        <template #default="{ row }">
          <span class="question">{{ row.question || "—" }}</span>
          <p v-if="!row.question && isContentHidden(row)" class="hidden-tip">
            其他 staff 处理中，内容已隐藏
          </p>
        </template>
      </el-table-column>
      <el-table-column label="工单" width="150">
        <template #default="{ row }">
          <div v-if="rowTicketStatus(row)" class="ticket-cell">
            <el-tag
              size="small"
              :type="statusMeta(rowTicketStatus(row), TICKET_STATUS).type"
            >
              {{ statusMeta(rowTicketStatus(row), TICKET_STATUS).label }}
            </el-tag>
            <span v-if="isOverdueRow(row)" class="overdue-flag">超时</span>
            <span class="ticket-assignee">
              {{ ticketAssigneeName(row.ticket) || "未接手" }}
            </span>
          </div>
          <span v-else>—</span>
        </template>
      </el-table-column>
      <el-table-column label="当前报价" width="100">
        <template #default="{ row }">{{ quotedCostText(row.quotedCost) }}</template>
      </el-table-column>
      <el-table-column label="议价标记" width="120">
        <template #default="{ row }">
          <el-tag v-if="cheaperMeta(row)" :type="cheaperMeta(row).type" size="small">
            {{ cheaperMeta(row).label }}
          </el-tag>
          <span v-else>—</span>
        </template>
      </el-table-column>
      <el-table-column label="状态" width="90">
        <template #default="{ row }">
          <el-tag :type="statusMeta(row.status, HINT_STATUS).type" size="small">
            {{ statusMeta(row.status, HINT_STATUS).label }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="发起时间" width="170">
        <template #default="{ row }">{{ fmtTime(row.createdAt) }}</template>
      </el-table-column>
      <el-table-column label="已等待" width="110">
        <template #default="{ row }">
          <span v-if="row.status === 'pending'">{{ waitTime(row.createdAt) }}</span>
          <span v-else>—</span>
        </template>
      </el-table-column>
      <el-table-column label="拒绝原因" min-width="140">
        <template #default="{ row }">{{ row.reason || "—" }}</template>
      </el-table-column>
      <el-table-column label="操作" width="230" fixed="right">
        <template #default="{ row }">
          <template v-if="!canHandle">
            <span>—</span>
          </template>
          <template v-else-if="row.status === 'pending'">
            <el-button size="small" type="primary" :loading="busy(row, 'quote')" @click="openForm(row, 'quote')">
              报价
            </el-button>
            <el-button size="small" type="danger" :loading="busy(row, 'reject')" @click="rejectRow(row)">拒绝</el-button>
          </template>
          <template v-else-if="row.status === 'quoted' && needsCheaperReply(row)">
            <el-button size="small" type="primary" :loading="busy(row, 'requote')" @click="openForm(row, 'requote')">
              降价
            </el-button>
            <el-button size="small" :loading="busy(row, 'decline')" @click="declineCheaper(row)">拒绝降价</el-button>
            <el-button size="small" type="danger" :loading="busy(row, 'reject')" @click="rejectRow(row)">拒绝</el-button>
          </template>
          <template v-else-if="row.status === 'quoted'">
            <el-button size="small" type="danger" :loading="busy(row, 'reject')" @click="rejectRow(row)">拒绝</el-button>
          </template>
          <span v-else>—</span>
        </template>
      </el-table-column>
    </el-table>

    <PageNav :page="page" :has-more="hasMore" :loading="loading" @prev="prev" @next="next" />

    <!-- 报价 / 降价共用：价格与答复一次提交，答复只写服务端、玩家确认后才送达 -->
    <el-dialog v-model="formDialog.visible" :title="formDialogTitle" width="520px">
      <el-alert
        v-if="formDialog.mode === 'requote'"
        class="dialog-alert"
        type="info"
        show-icon
        :closable="false"
        :title="formDialogAlert"
      />
      <el-form label-width="90px">
        <el-form-item label="点数 cost" required>
          <el-input-number
            v-model="formDialog.cost"
            :min="0"
            :max="1000000"
            :precision="0"
            :step="1"
            style="width: 100%"
          />
          <div class="hint">0–1000000 的整数（tips 点数）</div>
        </el-form-item>
        <el-form-item label="答复 reply" required>
          <el-input
            v-model="formDialog.reply"
            type="textarea"
            :rows="5"
            maxlength="2000"
            show-word-limit
            placeholder="答复只存服务端，玩家确认扣费后才会收到"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="formDialog.visible = false">取消</el-button>
        <el-button type="primary" :loading="formDialog.loading" @click="submitForm">
          {{ formDialog.mode === "requote" ? "降价并保存答复" : "提交报价" }}
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { useRouter } from "vue-router";
import { useAuthStore } from "@/stores/auth";
import {
    declineCheaperHint,
    getHintRequest,
    getTicketSummary,
    listHintRequests,
    quoteHint,
    rejectHint,
    requoteHint,
} from "@/api/msg";
import { useCursorPage } from "@/composables/useCursorPage";
import { useWorkbenchBadges } from "@/composables/useWorkbenchBadges";
import {
    TICKET_ERROR_ACTION,
    claimTicketQuietly,
    describeTicketError,
    releaseTicketQuietly,
} from "@/composables/useTicketActions";
import PageNav from "@/components/PageNav.vue";
import AttachmentGallery from "@/components/AttachmentGallery.vue";
import TicketBar from "@/components/TicketBar.vue";
import {
    fmtTime,
    HINT_STATUS,
    isTicketMine,
    isTicketOpen,
    statusMeta,
    TICKET_FILTER_OPTIONS,
    TICKET_STATUS,
    ticketAssigneeName,
} from "@/utils/format";
import { extractErrorMessage } from "@/api/errors";

const auth = useAuthStore();
const router = useRouter();
// 写操作需要 msg.hint.handle（admin 由 store 的 can() 直通）
const canHandle = computed(() => auth.can("msg.hint.handle"));
const { refreshHints } = useWorkbenchBadges();

const STATUS_OPTIONS = [
    { value: "pending", label: "待报价" },
    { value: "quoted", label: "已报价" },
    { value: "answered", label: "已答复" },
    { value: "rejected", label: "已拒绝" },
    { value: "closed", label: "已关闭" },
    { value: "all", label: "全部" },
];

// 工单筛选（迁移 0041）：默认只看待处理栏；业务状态默认 all，
// 因为一条求提示在生命周期里会跨多个业务状态，靠工单状态做主视图更符合工作台语义
const filters = reactive({
    status: "all",
    ticketStatus: "open",
    ticketOverdue: false,
});

// 分栏计数（byKind.hint）：只在有 msg.hint.handle 时才有意义
const ticketSummary = ref(null);
const hintSummary = computed(() => ticketSummary.value?.byKind?.hint ?? null);

const fetcher = (cursor) =>
    listHintRequests({
        status: filters.status,
        ticket_status: filters.ticketStatus || undefined,
        ticket_overdue: filters.ticketOverdue ? 1 : undefined,
        cursor,
        limit: 50,
    });
const { list, page, hasMore, loading, first, next, prev } = useCursorPage(fetcher);

function search() {
    first();
}
function reset() {
    filters.status = "all";
    filters.ticketStatus = "open";
    filters.ticketOverdue = false;
    first();
}

// 0 是合法报价，只有 null / undefined 才算「未报价」
function quotedCostText(cost) {
    return cost === null || cost === undefined ? "—" : `${cost} 点`;
}

function waitTime(createdAt) {
    const ms = Date.now() - new Date(createdAt).getTime();
    if (Number.isNaN(ms) || ms < 0) return "—";
    const m = Math.floor(ms / 60000);
    if (m < 60) return `${m} 分钟`;
    const h = Math.floor(m / 60);
    return `${h} 小时 ${m % 60} 分`;
}

// 议价标记：待回应（申请降价）> 已是最低价 > 已降价回应，三者只显示其一。
// 拒绝降价会同时写 cheaperDecidedAt 与 isLowestPrice，所以 isLowestPrice 要先判。
function cheaperMeta(row) {
    if (row.cheaperRequestedAt && !row.cheaperDecidedAt) {
        return { label: "申请降价", type: "warning" };
    }
    if (row.isLowestPrice) return { label: "已是最低价", type: "success" };
    if (row.cheaperDecidedAt) return { label: "已降价回应", type: "info" };
    return null;
}

// 有待回应的降价申请：只有此时才能「降价」或「拒绝降价」
function needsCheaperReply(row) {
    return !!row.cheaperRequestedAt && !row.cheaperDecidedAt;
}

// ---- 工单派生 ----
const rowTicketStatus = (row) => row?.ticketStatus || row?.ticket?.status || "";
const isMine = (row) => isTicketMine(row?.ticket, auth.account);
const isOverdueRow = (row) =>
    Boolean(
        row?.ticket?.overdue ||
            row?.ticket?.pendingOverdue ||
            row?.ticket?.processingOverdue,
    );
// 内容缺失且工单在别人手上 → 服务端按设计隐藏了 question / draftReply / attachments
const isContentHidden = (row) =>
    rowTicketStatus(row) === "processing" && !isMine(row);

const releasingId = ref(null);

// 分栏计数：失败静默（辅助信息）
async function refreshTicketSummary() {
    try {
        ticketSummary.value = await getTicketSummary();
    } catch {
        // 保持上一次的数字
    }
}

// 展开行 = 打开这条求提示详情：staff 会因此占位接单（admin 只读）。
// 已被别人持有时不再发请求（服务端也会 403），直接由 isContentHidden 显示占位。
async function onExpandChange(row, expandedRows) {
    const expanded = Array.isArray(expandedRows)
        ? expandedRows.includes(row)
        : Boolean(expandedRows);
    if (!expanded) return;
    if (isContentHidden(row)) return;

    try {
        const data = await getHintRequest(row.id);
        if (!data) return;
        Object.assign(row, data);
        row.ticketStatus = data.ticket?.status ?? row.ticketStatus;
        refreshTicketSummary();
    } catch (err) {
        const descriptor = describeTicketError(err);
        if (descriptor) {
            ElMessage.warning(descriptor.message);
            if (descriptor.action === TICKET_ERROR_ACTION.RELOAD) {
                first().catch(() => {});
                refreshTicketSummary();
            }
            return;
        }
        ElMessage.error(extractErrorMessage(err, "求提示详情加载失败"));
    }
}

// 打开关联邮件（提问 / 议价）：跳到站内信工作台并直接打开那封
function openRelatedMail(mailId) {
    if (!mailId) return;
    router.push({ path: "/letters/messages", query: { mailId: String(mailId) } });
}

// 统一的「先确保持有工单，再执行动作」：
//   · 工单未办结且不是我的 → 先 claim（别人持有则提示并中止）
//   · 未办结 → body 里带 ticket_id；已办结 → 不带
// 409/403 统一翻译；RELOAD 类会刷新列表与计数。
async function withTicket(row, run) {
    const ticket = row.ticket;
    let ticketId = null;

    if (isTicketOpen(ticket)) {
        if (!isMine(row)) {
            const claimed = await claimTicketQuietly(ticket.ticketId);
            if (!claimed.ok) {
                ElMessage.warning(claimed.descriptor?.message || "接手工单失败");
                if (claimed.descriptor?.action === TICKET_ERROR_ACTION.RELOAD) {
                    first().catch(() => {});
                }
                refreshTicketSummary();
                return { ok: false };
            }
            row.ticket = claimed.ticket ?? { ...ticket, status: "processing" };
            row.ticketStatus = row.ticket.status;
            refreshTicketSummary();
        }
        ticketId = row.ticket?.ticketId ?? ticket.ticketId;
    }

    try {
        await run(ticketId ? { ticket_id: ticketId } : {});
        return { ok: true };
    } catch (err) {
        const descriptor = describeTicketError(err);
        if (descriptor) {
            ElMessage.warning(descriptor.message);
            if (descriptor.action === TICKET_ERROR_ACTION.RELOAD) {
                first().catch(() => {});
                refreshTicketSummary();
            }
            return { ok: false };
        }
        ElMessage.error(extractErrorMessage(err));
        return { ok: false };
    }
}

// 退出 / 标记未处理（展开行里的 TicketBar）
async function releaseRowTicket(row) {
    const ticketId = row.ticket?.ticketId;
    if (!ticketId || releasingId.value) return;

    releasingId.value = ticketId;
    try {
        const result = await releaseTicketQuietly(ticketId);
        if (!result.ok) {
            ElMessage.error(result.descriptor?.message || "退出工单失败");
            if (result.descriptor?.action === TICKET_ERROR_ACTION.RELOAD) {
                first().catch(() => {});
            }
            refreshTicketSummary();
            return;
        }
        row.ticket = result.ticket ?? { ...row.ticket, status: "pending", assignee: null };
        row.ticketStatus = row.ticket.status;
        ElMessage.success("已释放该工单，其他同事可接手（待处理计时不重置）");
        refreshTicketSummary();
    } finally {
        releasingId.value = null;
    }
}

// 每个按钮自己的 loading 键（`行ID:动作`），避免同一条请求并发点两次
const busyKey = ref("");
const busy = (row, action) => busyKey.value === `${row.id}:${action}`;

// 报价与降价共用对话框：字段相同（cost + reply），差异只有标题、接口与 cost 上限
const formDialog = reactive({
    visible: false,
    mode: "quote",
    loading: false,
    row: null,
    cost: null,
    reply: "",
});

const formDialogTitle = computed(() =>
    formDialog.mode === "requote" ? "降价并改回答" : "报价",
);
const formDialogAlert = computed(
    () =>
        `当前报价 ${quotedCostText(formDialog.row?.quotedCost)}，新报价必须更低，` +
        "且必须同时给出新的答复（更便宜 ⇒ 内容更少）。",
);

function openForm(row, mode) {
    formDialog.row = row;
    formDialog.mode = mode;
    formDialog.cost = null;
    formDialog.reply = "";
    formDialog.visible = true;
}

async function submitForm() {
    const row = formDialog.row;
    if (!row) return;
    const cost = Number(formDialog.cost);
    if (
        formDialog.cost === null ||
        formDialog.cost === undefined ||
        !Number.isInteger(cost) ||
        cost < 0 ||
        cost > 1000000
    ) {
        ElMessage.warning("请填写 0–1000000 的整数点数");
        return;
    }
    const reply = formDialog.reply.trim();
    if (!reply) {
        ElMessage.warning("请填写答复内容");
        return;
    }
    if (formDialog.mode === "requote") {
        const current = formDialog.row?.quotedCost;
        if (current !== null && current !== undefined && cost >= Number(current)) {
            ElMessage.warning(`新报价必须低于当前报价（${current} 点）`);
            return;
        }
    }

    busyKey.value = `${row.id}:${formDialog.mode}`;
    formDialog.loading = true;
    try {
        const result = await withTicket(row, (extra) =>
            formDialog.mode === "requote"
                ? requoteHint(row.id, { cost, reply, ...extra })
                : quoteHint(row.id, { cost, reply, ...extra }),
        );
        if (!result.ok) return;

        ElMessage.success(
            formDialog.mode === "requote"
                ? "已降价并更新答复，等待玩家按新价确认"
                : "已报价，等待玩家确认扣费",
        );
        formDialog.visible = false;
        // 待报价 → 已报价（或降价被受理），「提示工作台」角标要立刻跟上
        void refreshHints();
        first();
        refreshTicketSummary();
    } finally {
        formDialog.loading = false;
        busyKey.value = "";
    }
}

// 拒绝降价：不改价不改回答，只标记当前报价为最低报价
async function declineCheaper(row) {
    try {
        await ElMessageBox.confirm(
            `确认后当前报价（${quotedCostText(row.quotedCost)}）即为最低报价，玩家不能再申请更便宜。`,
            "拒绝降价",
            { type: "warning", confirmButtonText: "确认拒绝降价" },
        );
    } catch {
        return;
    }
    busyKey.value = `${row.id}:decline`;
    try {
        const result = await withTicket(row, (extra) =>
            declineCheaperHint(row.id, extra),
        );
        if (!result.ok) return;
        ElMessage.success("已拒绝降价，当前报价已标记为最低报价");
        void refreshHints();
        first();
        refreshTicketSummary();
    } finally {
        busyKey.value = "";
    }
}

async function rejectRow(row) {
    let reason = "";
    try {
        const { value } = await ElMessageBox.prompt(
            "拒绝后该请求终止，已写下的答复会被清空（玩家未确认扣费，不产生退款）。",
            "拒绝求提示",
            {
                inputType: "textarea",
                inputPlaceholder: "拒绝原因（可选，≤200 字）",
                inputValidator: (v) =>
                    !v || v.length <= 200 ? true : "拒绝原因不能超过 200 字",
            },
        );
        reason = value || "";
    } catch {
        return;
    }
    busyKey.value = `${row.id}:reject`;
    try {
        const result = await withTicket(row, (extra) =>
            rejectHint(row.id, { reason: reason.trim(), ...extra }),
        );
        if (!result.ok) return;
        ElMessage.success("已拒绝");
        void refreshHints();
        first();
        refreshTicketSummary();
    } finally {
        busyKey.value = "";
    }
}

// 工作台每 3 分钟自动刷新一次：新提问要能自己冒出来，但不必每分钟都重拉列表
//（手动「查询」/「刷新」随时可用）。只在第一页（first() 会重置游标栈与页码）、
// 没有请求在跑、没有开着报价对话框时刷新，避免打断正在填报价或翻旧记录的操作员。
const POLL_INTERVAL_MS = 180000;
let pollTimer = null;

function startPolling() {
    stopPolling();
    pollTimer = setInterval(() => {
        if (document.hidden) return;
        // 计数每轮都刷（辅助信息，不影响正在填的表单）
        refreshTicketSummary();
        if (formDialog.visible) return;
        if (page.value !== 1 || loading.value) return;
        first().catch(() => {
            // 轮询失败不打扰，下一轮再试
        });
    }, POLL_INTERVAL_MS);
}

function stopPolling() {
    if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
    }
}

onMounted(() => {
    first().catch((err) => ElMessage.error(extractErrorMessage(err)));
    refreshTicketSummary();
    startPolling();
});

onBeforeUnmount(stopPolling);
</script>

<style scoped>
.tip {
    color: #909399;
    font-size: 12px;
}
.question {
    white-space: pre-wrap;
    word-break: break-word;
}
.hint {
    font-size: 12px;
    color: #909399;
    width: 100%;
}
.dialog-alert {
    margin-bottom: 12px;
}
.expand {
    padding: 4px 12px 12px;
    display: flex;
    flex-direction: column;
    gap: 10px;
}
.expand-block {
    display: flex;
    flex-direction: column;
    gap: 2px;
}
.expand-label {
    font-size: 12px;
    color: #909399;
}
.expand-text {
    margin: 0;
    font-size: 13px;
    white-space: pre-wrap;
    word-break: break-word;
}
.hidden-tip {
    margin: 0;
    font-size: 12px;
    color: #c0c4cc;
}
.expand-links {
    margin: 0;
    display: flex;
    gap: 8px;
}
/* 工单列：状态 + 超时 + 处理人 */
.ticket-cell {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 2px;
}
.overdue-flag {
    color: var(--el-color-danger);
    font-size: 11px;
}
.ticket-assignee {
    color: #909399;
    font-size: 11px;
}
/* 筛选栏右侧的分栏计数 */
.summary-line {
    margin-left: auto;
    color: #909399;
    font-size: 12px;
    white-space: nowrap;
}
</style>
