<template>
  <div class="page-card">
    <div class="filter-bar">
      <!-- 工单式工作台：默认只看「待处理栏」（open = pending + processing） -->
      <el-select
        v-model="ticketStatus"
        style="width: 200px"
        @change="first"
      >
        <el-option
          v-for="item in TICKET_FILTER_OPTIONS"
          :key="item.value"
          :label="item.label"
          :value="item.value"
        />
      </el-select>
      <el-select
        v-model="ticketAssignee"
        style="width: 140px"
        @change="first"
      >
        <el-option
          v-for="item in TICKET_ASSIGNEE_OPTIONS"
          :key="item.value"
          :label="item.label"
          :value="item.value"
        />
      </el-select>
      <el-checkbox v-model="ticketOverdue" @change="first">只看超时</el-checkbox>
      <el-select v-model="channel" style="width: 180px" @change="first">
        <el-option
          v-for="item in MAIL_CHANNEL_OPTIONS"
          :key="item.value"
          :label="item.label"
          :value="item.value"
        />
      </el-select>
      <el-checkbox v-model="onlyUnread" @change="first">只看未读</el-checkbox>
      <el-button type="primary" :disabled="loading" @click="first"
        >刷新</el-button
      >
      <span v-if="ticketSummary" class="summary-line">
        待处理 {{ ticketSummary.pending }} · 处理中
        {{ ticketSummary.processing }} · 超时
        {{
          (ticketSummary.pendingOverdue ?? 0) +
          (ticketSummary.processingOverdue ?? 0)
        }}
        <template v-if="ticketSummary.mine">
          · 我处理中 {{ ticketSummary.mine }}
        </template>
      </span>
    </div>

    <el-table
      v-loading="loading"
      :data="list"
      border
      stripe
      @row-click="openRow"
    >
      <el-table-column prop="mailId" label="会话" width="90" />
      <el-table-column label="主题" min-width="240">
        <template #default="{ row }">
          <div class="subject-cell">
            <span :style="{ fontWeight: row.unread > 0 ? 600 : 400 }">
              <span v-if="isMine(row)" class="mine-flag">我的</span>
              {{ row.subject || "（无主题）" }}
            </span>
            <el-tag
              v-if="row.thread?.messageCount > 1"
              size="small"
              type="info"
              class="reply-count"
            >
              共 {{ row.thread.messageCount }} 封 · {{ row.replyCount }} 条回复
            </el-tag>
            <p v-if="row.snippet" class="snippet">{{ row.snippet }}</p>
            <p v-else-if="isSnippetHidden(row)" class="hidden-tip">
              其他 staff 处理中，摘要已隐藏
            </p>
          </div>
        </template>
      </el-table-column>
      <el-table-column label="来源" width="110">
        <template #default="{ row }">
          <el-tag size="small" :type="statusMeta(row.source, MAIL_SOURCE).type">
            {{ statusMeta(row.source, MAIL_SOURCE).label }}
          </el-tag>
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
      <el-table-column label="频道" width="150">
        <template #default="{ row }">{{ row.channelName || "—" }}</template>
      </el-table-column>
      <el-table-column label="归属" min-width="150">
        <template #default="{ row }">
          <template v-if="row.channel === 'team'">
            {{ row.teamName || "—" }}（#{{ row.teamId ?? "—" }}）
          </template>
          <template v-else-if="row.channel === 'account'">
            {{ row.ownerUsername || "—" }}（{{ row.ownerPlayerNo || "—" }}）
          </template>
          <template v-else>全体玩家</template>
        </template>
      </el-table-column>
      <el-table-column label="未读" width="80">
        <template #default="{ row }">
          <el-badge
            v-if="rowUnread(row) > 0"
            :value="rowUnread(row)"
            type="danger"
          />
          <span v-else>—</span>
        </template>
      </el-table-column>
      <el-table-column label="最后回复" width="170">
        <template #default="{ row }">
          {{ fmtTime(row.lastReplyAt || row.createdAt) }}
        </template>
      </el-table-column>
      <el-table-column label="操作" width="170" fixed="right">
        <template #default="{ row }">
          <!-- pending：可以在列表里直接占位（不必先打开详情） -->
          <el-button
            v-if="rowTicketStatus(row) === 'pending'"
            size="small"
            type="primary"
            :loading="rowBusy === `${row.mailId}:claim`"
            @click.stop="claimRow(row)"
          >
            接手
          </el-button>
          <!-- 处理中且归我：可以直接退回待处理 -->
          <el-button
            v-else-if="rowTicketStatus(row) === 'processing' && isMine(row)"
            size="small"
            :loading="rowBusy === `${row.mailId}:release`"
            title="把工单退回待处理；待处理计时不会重置"
            @click.stop="releaseRow(row)"
          >
            退出
          </el-button>
          <!-- admin：他人工单可强制退回（回复仍需先自己接手） -->
          <el-button
            v-else-if="
              rowTicketStatus(row) === 'processing' && canForceReleaseRow(row)
            "
            size="small"
            type="danger"
            plain
            :loading="rowBusy === `${row.mailId}:release`"
            title="强制退回他人工单：原处理人会被解除占用，其他同事可接手"
            @click.stop="releaseRow(row)"
          >
            强制退回
          </el-button>
          <!-- 没接手就不给看详情：详情里能读到正文与附件，工单模型是「谁接手谁负责」 -->
          <el-button
            size="small"
            text
            type="primary"
            :disabled="!canOpenRow(row)"
            :title="canOpenRow(row) ? '' : viewBlockedReason(row)"
            @click.stop="openRow(row)"
          >
            查看
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

    <!-- 邮件详情抽屉：整条会话（thread + messages，升序）+ 官方回复 -->
    <el-drawer v-model="drawer.visible" size="620px">
      <template #header>
        <!-- 自定义标题头：主题可能很长（甚至没有空格），必须能截断，
             否则长串会把头部的关闭按钮顶出抽屉可视区 -->
        <div class="drawer-head">
          <span class="drawer-head__title" :title="drawerTitle">{{ drawerTitle }}</span>
        </div>
      </template>
      <div class="mail-detail">
        <div class="mail-meta">
          <span class="label">主题</span>
          <span>{{ thread?.subject || "（无主题）" }}</span>
          <span class="label">共</span>
          <span>{{ thread?.messageCount ?? messages.length }} 封</span>
        </div>
        <div class="mail-meta">
          <span class="label">频道</span>
          <span>{{ thread?.channelName || "—" }}</span>
          <span class="label">来源</span>
          <span>{{ statusMeta(source, MAIL_SOURCE).label }}</span>
        </div>

        <TicketBar
          :ticket="ticket"
          :ticket-status="drawerTicketStatus"
          :can-release="canReleaseCurrent"
          :force-release="forcingRelease"
          :busy="releasing"
          @release="releaseCurrentTicket"
        />

        <!-- 只读查看：工单没归我时有只读权限的账号能看不能动 -->
        <el-alert
          v-if="viewOnly && !drawer.loading"
          class="view-only-alert"
          type="info"
          :closable="false"
          show-icon
          title="只读查看"
          :description="viewOnlyTip"
        />

        <div v-if="drawer.loading" class="loading">
          <el-skeleton :rows="6" animated />
        </div>
        <div v-else-if="heldByOther" class="held-placeholder">
          <el-empty
            :description="`该工单已被 ${heldByOther} 接手，正文与附件不可见`"
          />
          <p class="tip">
            其他 staff 正在处理这条会话。需要协助时，请让对方点「退出 /
            标记未处理」，或由 admin 强制退回后再查看。
          </p>
        </div>
        <template v-else>
          <div v-if="!messages.length" class="empty">
            <el-empty description="暂无邮件记录" />
          </div>
          <div
            v-for="msg in messages"
            :key="msg.mailId"
            class="msg"
            :class="msg.direction"
          >
            <div class="msg-meta">
              <span class="msg-sender">{{ senderName(msg) }}</span>
              <span class="msg-time">{{ fmtTime(msg.createdAt) }}</span>
            </div>
            <div class="msg-subject">{{ msg.subject }}</div>
            <div class="msg-bubble">{{ msg.content }}</div>
            <AttachmentGallery :items="msg.attachments" />
            <!-- 官方发给玩家的消息下方：可展开「那一次提示」对应的报价记录（含当时暂存的答案）。
                 求提示详情链上每封都没有 hint 快照，报价记录只挂在请求的那封 mail.hintQuotes[]，
                 所以这里按 hintQuotes[].mailId 匹配这一封；匹配不到时（如答复邮件）
                 取这封之前最近的一次报价。 -->
            <template
              v-if="
                msg.direction === 'to_player' &&
                isHintMail &&
                quotesForMessage(msg).length
              "
            >
              <el-button
                link
                type="primary"
                class="quote-toggle"
                @click="toggleQuoteFor(msg.mailId)"
              >
                {{
                  quoteOpenMailId === msg.mailId ? "收起历史提示" : "查看历史提示"
                }}
              </el-button>
              <div v-if="quoteOpenMailId === msg.mailId" class="quote-history">
                <div
                  v-for="q in quotesForMessage(msg)"
                  :key="q.quoteId ?? q.seq"
                  class="quote-history__item"
                >
                  <div class="quote-history__head">
                    <span class="quote-history__seq">#{{ q.seq }}</span>
                    <span>{{ q.kind === "requote" ? "改价" : "报价" }}</span>
                    <strong>{{ q.cost }} 点</strong>
                    <el-tag size="small" :type="quoteTagType(q)" effect="plain">
                      {{ quoteStatusText(q) }}
                    </el-tag>
                    <span class="tip">{{ fmtTime(q.createdAt) }}</span>
                  </div>
                  <p class="quote-history__reply">
                    {{ q.reply || "（这次报价没有写答案）" }}
                  </p>
                </div>
              </div>
            </template>
          </div>
        </template>
      </div>
      <template #footer>
        <!-- 求提示 / 申诉的邮件不再走普通回复：动作在各自面板里（原两个工作台并入这里） -->
        <HintActionPanel
          v-if="isHintMail"
          :hint="hintSnapshot"
          :ticket-id="ticket?.ticketId ?? null"
          :read-only="viewOnly"
          @done="onSourceActionDone"
          @conflict="onSourceConflict"
        />
        <AppealActionPanel
          v-else-if="isAppealMail && appealSnapshot"
          :appeal="appealSnapshot"
          :ticket-id="appealTicketId"
          :read-only="viewOnly"
          @done="onSourceActionDone"
          @conflict="onSourceConflict"
        />
        <!-- 申诉邮件但快照为空：没有可回复的申诉主体（正常数据不会出现），
             这里不能再回退普通回复框 —— 后端对申诉邮件一律 403 APPEAL_REPLY_CLOSED -->
        <div v-else-if="isAppealMail" class="reply-bar">
          <p class="tip">
            这封申诉邮件没有可用的申诉状态，无法在此回复。请到「处罚记录 ·
            申诉」查看与处理。
          </p>
        </div>
        <div v-else class="reply-bar">
          <p v-if="!canReply" class="tip">{{ replyBlockedReason }}</p>
          <template v-else>
            <el-input
              v-model="drawer.content"
              type="textarea"
              :rows="3"
              maxlength="2000"
              show-word-limit
              placeholder="回复正文（1–2000 字），主题由服务端生成为「回复：<根主题>」"
            />
            <div class="reply-actions">
              <el-button @click="loadMessages">刷新</el-button>
              <el-button
                type="primary"
                :loading="drawer.sending"
                :disabled="!drawer.content.trim()"
                @click="sendReply"
              >
                发送回复
              </el-button>
            </div>
          </template>
        </div>
      </template>
    </el-drawer>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import { ElMessage } from "element-plus";
import { useRoute } from "vue-router";
import { useAuthStore } from "@/stores/auth";
import {
  getMail,
  getThread,
  getTicketSummary,
  listMails,
  replyMail,
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
import HintActionPanel from "@/components/msg/HintActionPanel.vue";
import AppealActionPanel from "@/components/msg/AppealActionPanel.vue";
import {
  fmtTime,
  isTicketMine,
  isTicketOpen,
  MAIL_CHANNEL_OPTIONS,
  MAIL_SOURCE,
  statusMeta,
  TICKET_ASSIGNEE_OPTIONS,
  TICKET_FILTER_OPTIONS,
  TICKET_STATUS,
  ticketAssigneeName,
} from "@/utils/format";
import { extractErrorMessage } from "@/api/errors";

const POLL_INTERVAL_MS = 180000;
let pollTimer = null;

const auth = useAuthStore();
const { refresh: refreshBadges } = useWorkbenchBadges();

const route = useRoute();
const channel = ref(
  MAIL_CHANNEL_OPTIONS.some((item) => item.value === route.query.channel)
    ? String(route.query.channel)
    : "",
);
const onlyUnread = ref(false);

// ---- 工单筛选（迁移 0041）：默认只看「待处理栏」----
const ticketStatus = ref("open");
const ticketAssignee = ref("all");
const ticketOverdue = ref(false);
// 分栏计数：待处理 / 处理中 / 超时 / 我处理中。轮询只刷它，不动列表。
const ticketSummary = ref(null);

// 列队用邮件式接口：threaded=1 一条会话一行（工单本身是按会话管的），倒序游标分页
const fetcher = (cursor) =>
  listMails({
    cursor,
    limit: 20,
    threaded: 1,
    channel: channel.value || undefined,
    only_unread: onlyUnread.value || undefined,
    ticket_status: ticketStatus.value || undefined,
    // all 与默认等价，不必显式发送
    ticket_assignee:
      ticketAssignee.value && ticketAssignee.value !== "all"
        ? ticketAssignee.value
        : undefined,
    ticket_overdue: ticketOverdue.value ? 1 : undefined,
  });
const { list, page, hasMore, loading, first, next, prev } =
  useCursorPage(fetcher);

// ---- 邮件详情（整条会话）----
const drawer = reactive({
  visible: false,
  loading: false,
  sending: false,
  // 会话根邮件 id：threads/:rootId 只认根，threaded 行的 mailId 就是根
  mailId: null,
  content: "",
});
// 会话信息（threads 返回的 thread）与全部邮件（服务端按时间升序给出，最新在最后）
const thread = ref(null);
const messages = ref([]);
// 会话最新一封：底部动作面板与「回复」都以它为准
const latestMail = ref(null);
// 服务端判定的只读预览（处理权限 + msg.ticket.read，或 admin 看别人手上的工单）
const readOnly = ref(false);
// 求提示的报价记录 / 提示快照 / 申诉快照：都按会话聚合，见 loadMessages
const hintQuotes = ref([]);
const hintSnapshot = ref(null);
const appealSnapshot = ref(null);
// 当前详情对应的工单：threads 返回 thread.ticket
const ticket = ref(null);
// 被其他 staff 持有时后端返回 403（TICKET_HELD_BY_OTHER）：只记处理人名，正文不显示
const heldByOther = ref("");
const releasing = ref(false);

// 详情请求的序号：只接受「最新一次请求且仍是同一封邮件」的响应，
// 避免切到 B 之后 A 的迟到响应、或手动刷新的旧响应覆盖界面
let detailSeq = 0;

function startPolling() {
  stopPolling();
  // 每 3 分钟自动刷新一次（手动「刷新」随时可用）：
  pollTimer = setInterval(() => {
    // 分栏计数每轮都刷（不打扰阅读，也不改动列表）
    refreshTicketSummary();

    // 抽屉打开时一律不刷新列表：操作员正在读对话 / 写回复，界面不该自己变
    //（自动替换整条会话会让人读一半内容跳掉）。关掉抽屉后下一轮自动继续。
    // 抽屉里的「刷新」按钮仍然可以手动拉最新。
    if (drawer.visible) return;

    // 列表：只在第一页自动刷新。first() 会把游标栈与页码重置到第 1 页，
    // 操作员正在翻旧邮件时不能被自动刷新拽回最新页；请求进行中也跳过，避免叠加。
    if (page.value === 1 && !loading.value) {
      first().catch(() => {
        // 轮询失败不打扰操作员，下一轮会再试
      });
    }
  }, POLL_INTERVAL_MS);
}

// 工单计数：失败静默（角标/分栏只是辅助信息，不该弹错）
async function refreshTicketSummary() {
  try {
    ticketSummary.value = await getTicketSummary();
  } catch {
    // 保持上一次的数字
  }
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

// ---- 会话来源决定抽屉底部用哪个动作面板（提示 / 申诉已并入本页）----
// 求提示邮件不能走普通回复（后端 403），必须在提示面板里报价 / 答复；
// 申诉邮件必须走申诉面板（回复要经 appeal 接口才会解锁下一条申诉）。
// 来源取整条会话的：会话里每封的 source 相同，用 thread 更稳（深链时不必等消息回来）。
const source = computed(
  () => thread.value?.source ?? latestMail.value?.source ?? "",
);
const isHintMail = computed(() => source.value === "hint");
const isAppealMail = computed(
  () => source.value === "appeal_ban" || source.value === "appeal_mute",
);

// 申诉面板回复时要带的工单：只有未办结的工单才带 ticket_id
//（已办结时后端不需要它，带上反而可能 409 TICKET_STALE）
const appealTicketId = computed(() =>
  isTicketOpen(ticket.value) ? ticket.value?.ticketId ?? null : null,
);

// ---- 历史提示（2.2.0 的 hintQuotes[]，按会话聚合到 hintQuotes）----
// 官方发给玩家的每条消息下可以展开「那一次提示」：
//   · 先用 hintQuotes[].mailId 精确匹配这一封（报价 / 改价邮件各自对应一行）；
//   · 匹配不到（如「求提示答复」）取这封之前最近的一次报价 —— 答复正文就是那次报价暂存的答案；
//   · consumedAt 有值 = 玩家确认扣费时采用的就是这条；supersededAt 有值 = 已被后续改价取代。
const quoteOpenMailId = ref(null);

function quotesForMessage(msg) {
  const quotes = hintQuotes.value;
  if (!quotes.length) return [];

  const exact = quotes.filter(
    (q) => Number(q.mailId) === Number(msg?.mailId),
  );
  if (exact.length) return exact;

  const at = new Date(msg?.createdAt || 0).getTime();
  const before = quotes.filter(
    (q) => new Date(q.createdAt || 0).getTime() <= at,
  );
  const pool = before.length ? before : quotes;
  // 取 seq 最大的那次（= 这封之前最近的一次报价）
  return [
    pool.reduce((a, b) => (Number(b.seq) > Number(a.seq) ? b : a)),
  ];
}

function quoteStatusText(q) {
  if (q.consumedAt) return "已被采用";
  if (q.supersededAt) return "已被改价取代";
  if (
    q.cost !== null &&
    q.cost !== undefined &&
    Number(q.cost) === Number(hintSnapshot.value?.quotedCost)
  ) {
    return "当前报价";
  }
  return "历史";
}

function quoteTagType(q) {
  if (q.consumedAt) return "success";
  if (q.supersededAt) return "info";
  if (Number(q.cost) === Number(hintSnapshot.value?.quotedCost)) return "primary";
  return "info";
}

function toggleQuoteFor(mailId) {
  quoteOpenMailId.value = quoteOpenMailId.value === mailId ? null : mailId;
}

// ---- 工单派生状态 ----
// 详情返回里可能只有顶层 ticketStatus、没有 ticket 对象（或反之），两者都认
const drawerTicketStatus = computed(
  () => ticket.value?.status || thread.value?.ticket?.status || "",
);
// 我是不是这条工单的处理人
const heldByMe = computed(() => isTicketMine(ticket.value, auth.account));
// 只读预览：服务端回 readOnly:true 就是只读；另外 admin / msg.ticket.read 看别人手上的
// 未办结工单也只读（后端对 admin 的 GET 放行但不置 readOnly）—— 能看正文与附件，
// 回复 / 报价 / 回复申诉都必须先接手。
const viewOnly = computed(
  () =>
    readOnly.value ||
    (canReadOnlyTicket.value && isTicketOpen(ticket.value) && !heldByMe.value),
);
const viewOnlyTip = computed(() => {
  if (drawerTicketStatus.value === "pending") {
    return "该工单还没人接手：你可以查看正文，回复 / 报价 / 回复申诉请先接手。";
  }
  const holder = ticketAssigneeName(ticket.value) || "其他 staff";
  return `该工单由 ${holder} 处理中：你可以查看正文，回复 / 报价 / 回复申诉需先接手（或由 admin 强制退回后再接手）。`;
});

// 未办结的工单只有持单人能动手：
//   · 被其他 staff 持有 → 只读
//   · 还没人接手（admin 的 GET 只读、不会自动接单）→ 也先挡住，否则写完回复才被后端 409 打回
const blockedByTicket = computed(
  () => isTicketOpen(ticket.value) && !heldByMe.value,
);
// 「退出 / 标记未处理」：处理中且归我；admin 可以强制退回他人的工单
//（后端 release 支持，按钮文案会变成「强制退回」以免误认成普通释放）
const canReleaseCurrent = computed(() => {
  const current = ticket.value;
  if (current?.status !== "processing" || !current.ticketId) return false;
  return heldByMe.value || auth.isAdmin;
});
const forcingRelease = computed(
  () => canReleaseCurrent.value && !heldByMe.value,
);

// 公告只读；求提示邮件必须走报价流程；工单被他人持有时也不能回复
const canReply = computed(() => {
  const replyable = latestMail.value?.canReply ?? thread.value?.canReply;
  if (!replyable) return false;
  if (source.value === "hint") return false;
  if (blockedByTicket.value) return false;
  return auth.can("msg.feedback.handle");
});

const replyBlockedReason = computed(() => {
  if (heldByOther.value) {
    return `该工单已被 ${heldByOther.value} 接手，正文与附件不可见。`;
  }
  if (!thread.value) return "邮件未加载。";
  if (source.value === "hint") {
    return "求提示邮件请用底部的「提示」面板报价 / 答复，不能直接回复。";
  }
  if (blockedByTicket.value) {
    return ticket.value?.status === "pending"
      ? "该工单还没有人接手：请先在列表点「接手」后再回复。"
      : "该工单已被其他 staff 接手，无法回复。";
  }
  return "这封邮件不可回复（官方公告只读，或当前账号没有 msg.feedback.handle 权限）。";
});

// ---- 列表行的工单派生 ----
const rowTicketStatus = (row) => row?.ticketStatus || row?.ticket?.status || "";
// 会话未读数：threaded 行给的是 thread.unreadCount（整条会话的未读）
const rowUnread = (row) => Number(row?.thread?.unreadCount ?? row?.unread ?? 0);
const isMine = (row) => isTicketMine(row?.ticket, auth.account);
// admin 可以强制退回他人工单（回复仍要先自己接手）
const canForceReleaseRow = (row) =>
  auth.isAdmin && Boolean(row?.ticket?.ticketId) && !isMine(row);
// 列表里某一封对应的工单：403 快照缺 ticketId 时用它补齐，admin 才能在抽屉里强制退回
const listTicketFor = (mailId) =>
  list.value.find((item) => item.mailId === mailId)?.ticket ?? null;
const isOverdueRow = (row) =>
  Boolean(
    row?.ticket?.overdue ||
      row?.ticket?.pendingOverdue ||
      row?.ticket?.processingOverdue,
  );
// 摘要缺失且工单在别人手上 → 服务端按设计隐藏了 snippet
const isSnippetHidden = (row) =>
  !row?.snippet && rowTicketStatus(row) === "processing" && !isMine(row);

// 只读预览能力：admin 直通；staff 需要 msg.ticket.read（工单只读查看）。
// 服务端的口径是「已持有对应处理权限 + 另有 msg.ticket.read」时，把待接单 / 被他人持有
// 的详情从 403 降级为 200 readOnly:true —— 能看不能动，不占位、不回复、不执行工单动作。
const canReadOnlyTicket = computed(
  () => auth.isAdmin || auth.can("msg.ticket.read"),
);

// 没接手就不许看详情：正文与附件只给当前的持单人。
// 例外是有只读权限的账号（admin / msg.ticket.read）：可以只读查看任何人手上的工单，
// 但回复 / 报价 / 回复申诉都要先接手，抽屉里会挂只读提示（见 viewOnly）。
// 没有未办结工单的行不受限（公告、规则调整前的历史邮件、已办结的会话），否则这些只读邮件就打不开了。
const canOpenRow = (row) =>
  canReadOnlyTicket.value || !isTicketOpen(row?.ticket) || isMine(row);
const viewBlockedReason = (row) =>
  rowTicketStatus(row) === "pending"
    ? "该工单还没人接手：请先点「接手」再看详情"
    : `该工单由 ${ticketAssigneeName(row?.ticket) || "其他 staff"} 处理中，无法查看详情`;

const drawerTitle = computed(() => {
  const current = thread.value;
  if (!current) return "会话";
  const rootId = current.rootMailId ?? drawer.mailId;
  return `会话 #${rootId} · ${current.subject || "（无主题）"}`;
});

// 行点击与「查看」共用同一个入口：没接手时只提示、不打开详情。
function openRow(row) {
  if (!canOpenRow(row)) {
    ElMessage.warning(viewBlockedReason(row));
    return;
  }
  return openMail(row);
}

async function openMail(row) {
  // 列表行给的是会话根（threaded 行 mailId == rootMailId）
  drawer.mailId = Number(row.rootMailId ?? row.mailId);
  drawer.content = "";
  drawer.visible = true;
  thread.value = null;
  messages.value = [];
  latestMail.value = null;
  readOnly.value = false;
  hintQuotes.value = [];
  hintSnapshot.value = null;
  appealSnapshot.value = null;
  // 上一封的工单信息不能留到这一条会话上
  ticket.value = null;
  heldByOther.value = "";
  // 展开中的「历史提示」也要跟着换会话重置
  quoteOpenMailId.value = null;
  await loadMessages();
}

// 会话里的 hint 快照：后端在 messages[] 上给（每封都带同形快照）；列表行也挂着同一个，
// 深链 / 后端还没补时用它兜底（本地数据，不发请求）。
function pickHint(msgs) {
  const hit = msgs.find((item) => item?.hint);
  if (hit) return hit.hint;
  const row = list.value.find((item) => item.mailId === drawer.mailId);
  return row?.hint ?? row?.thread?.hint ?? null;
}

// 申诉 6 字段快照：线程消息里任取一条非空的
function pickAppeal(msgs) {
  return msgs.find((item) => item?.appeal)?.appeal ?? null;
}

// 报价记录按会话汇总：线程消息 / thread 上挂的 hintQuotes[] 合并去重，按 seq 升序
//（同一次报价可能在多封邮件上都带一遍，按 quoteId 去重）
function collectQuotes(data) {
  const pools = [];
  for (const item of data?.messages ?? []) {
    if (Array.isArray(item?.hintQuotes)) pools.push(...item.hintQuotes);
  }
  if (Array.isArray(data?.thread?.hintQuotes)) {
    pools.push(...data.thread.hintQuotes);
  }
  const byKey = new Map();
  for (const quote of pools) {
    if (!quote) continue;
    const key = quote.quoteId ?? `${quote.seq}:${quote.cost}:${quote.mailId}`;
    if (!byKey.has(key)) byKey.set(key, quote);
  }
  return [...byKey.values()].sort((a, b) => Number(a.seq) - Number(b.seq));
}

async function loadMessages() {
  // 先记下这次要请求的会话：响应回来时据此判断是否已被替换
  const requestedId = drawer.mailId;
  if (!requestedId) return;

  const seq = ++detailSeq;
  drawer.loading = true;
  heldByOther.value = "";
  try {
    // mark_read=1 由 getThread 带上：打开会话即把整条会话标已读（幂等）
    const data = await getThread(requestedId);
    // 已经切到别的会话、或已有更新的请求 → 丢弃这次响应
    if (seq !== detailSeq || requestedId !== drawer.mailId) return;

    thread.value = data?.thread ?? null;
    readOnly.value = Boolean(data?.readOnly);
    // messages 由服务端按时间升序给出（旧 → 新），最新一封在最后；报价 / 改价 / 答复
    // 产生的子邮件会自动出现在这里，不必再像单封详情那样「切到新邮件」。
    const items = Array.isArray(data?.messages) ? data.messages : [];
    messages.value = items;
    latestMail.value = items.length ? items[items.length - 1] : null;
    // 工单：会话级 thread.ticket 优先，列表行的快照兜底
    ticket.value = data?.thread?.ticket ?? listTicketFor(requestedId) ?? null;
    // 求提示 / 申诉需要的 hint、hintQuotes、appeal 都由 messages[] 带回来，不再补单封详情
    hintQuotes.value = collectQuotes(data);
    hintSnapshot.value = pickHint(items);
    appealSnapshot.value = pickAppeal(items);

    // 详情里的工单可能是刚接手后的状态：把结果同步回列表，界面不要还停在「待处理」
    syncViewedTicket(ticket.value);

    // 整条会话已由服务端标已读：本地跟着清掉未读标记（列表行与 thread 内的计数）
    for (const item of list.value) {
      if (item.mailId !== requestedId) continue;
      item.unread = 0;
      if (item.thread) item.thread.unreadCount = 0;
    }
  } catch (err) {
    // 被替换的请求失败不打扰操作员
    if (seq !== detailSeq || requestedId !== drawer.mailId) return;

    // 被其他 staff 持有：这不是错误，是工单模型的正常结果 —— 显示占位而不是红字
    const descriptor = describeTicketError(err);
    if (descriptor?.action === TICKET_ERROR_ACTION.HELD) {
      heldByOther.value = descriptor.holder;
      thread.value = null;
      messages.value = [];
      latestMail.value = null;
      ticket.value = {
        ...(listTicketFor(drawer.mailId) || {}),
        ...(descriptor.ticket || { status: "processing" }),
      };
      return;
    }

    ElMessage.error(extractErrorMessage(err));
  } finally {
    if (seq === detailSeq) drawer.loading = false;
  }
}

// 发送者：from 是真实账号名（管理端不匿名）；系统身份（公告 / 警告）三项都是 null
function senderName(msg) {
  const from = msg.from ?? {};
  if (from.id === null || from.id === undefined) return "官方 / 系统";
  return from.name || `#${from.id}`;
}

// 回复：先把「点发送这一刻」的目标与工单固定下来，之后即使切走也不受影响。
// 工单未办结时必须带 ticket_id；持单人由列表里的「接手」确定（没接手也看不到详情，见 canOpenRow），
// 所以这里不再补 claim —— 真正没接单时（如 admin 只读浏览）后端会 409，按错误提示接手即可。
async function sendReply() {
  if (!canReply.value || !drawer.content.trim()) return;

  // 回复接在会话末尾：最新一封就是对话的最后一条（threads 里的最后一项）
  const sessionId = drawer.mailId;
  const targetId = latestMail.value?.mailId ?? sessionId;
  const content = drawer.content.trim();
  const activeTicket = isTicketOpen(ticket.value) ? ticket.value : null;
  const body = activeTicket
    ? { content, ticket_id: activeTicket.ticketId }
    : { content };

  drawer.sending = true;
  try {
    const data = await replyMail(targetId, body);

    ElMessage.success("已回复");
    // 回复会办结工单：用响应里的 ticketId / ticketStatus 更新状态条（不一致时以重取为准）
    if (data?.ticketStatus && ticket.value?.ticketId === data.ticketId) {
      ticket.value = { ...ticket.value, status: data.ticketStatus };
    }
    // 回复成功后自动关闭抽屉，回到列表并刷新（反映新回复与未读状态）；
    // 期间已切到别的会话时，不要清空正文或关掉当前这个抽屉
    if (sessionId === drawer.mailId) {
      drawer.content = "";
      drawer.visible = false;
    }
    first().catch((err) => ElMessage.error(extractErrorMessage(err)));
    refreshTicketSummary();
    // 回复即办结工单：侧栏角标（open 数）要立刻减一，不等下一轮轮询
    void refreshBadges();
  } catch (err) {
    const descriptor = describeTicketError(err);
    if (descriptor?.action === TICKET_ERROR_ACTION.RELOAD) {
      // 工单已变化 / 被别人接走：提示 + 刷新列表与详情，草稿保留
      ElMessage.warning(descriptor.message);
      first().catch(() => {});
      refreshTicketSummary();
      if (sessionId === drawer.mailId) void loadMessages();
      return;
    }
    if (sessionId === drawer.mailId) {
      ElMessage.error(descriptor?.message || extractErrorMessage(err));
    }
  } finally {
    drawer.sending = false;
  }
}

// 提示 / 申诉面板动作完成：工单可能推进（报价、拒绝都会改状态），
// 角标与分栏计数跟着动，并再拉一次会话拿最新的报价 / 申诉快照与那封新邮件。
// 这些动作会**写一封新邮件**（报价 / 改价 / 处理结果 / 答复）：它是这条会话的子节点，
// threads/:rootId 会一并带回来，所以直接从会话根重取即可。
function onSourceActionDone(data) {
  if (data?.ticketStatus && ticket.value?.ticketId === data.ticketId) {
    ticket.value = { ...ticket.value, status: data.ticketStatus };
  }
  // 旧邮件被取代 / 新增一封之后，展开中的报价历史先收起，避免展开在过期的消息上
  quoteOpenMailId.value = null;
  // 角标：站内信 / 求提示 / 申诉已合并成一个数，重拉一次即可
  void refreshBadges();
  refreshTicketSummary();
  void loadMessages();
}

// 面板遇到工单冲突（被别人接走 / 工单已变化）：提示已经由面板弹过，这里只兜底刷新
function onSourceConflict() {
  first().catch(() => {});
  refreshTicketSummary();
  void loadMessages();
}

// 退出 / 标记未处理：把工单退回待处理，其他同事可接手。
// admin 可以强制退回他人工单（原处理人会被解除占用），回复仍需先自己接手。
// 注意待处理计时不重置（超时仍按最初来信时间算），提示里要说明。
async function releaseCurrentTicket() {
  const active = ticket.value;
  if (!active?.ticketId || releasing.value) return;

  const forced = !heldByMe.value;
  const holder = ticketAssigneeName(active);
  releasing.value = true;
  try {
    const result = await releaseTicketQuietly(active.ticketId);
    if (!result.ok) {
      const descriptor = result.descriptor;
      if (descriptor?.action === TICKET_ERROR_ACTION.RELOAD) {
        ElMessage.warning(descriptor.message);
        void loadMessages();
        refreshTicketSummary();
      } else {
        ElMessage.error(descriptor?.message || "退出工单失败");
      }
      return;
    }
    ticket.value = result.ticket ?? {
      ...active,
      status: "pending",
      assignee: null,
    };
    ElMessage.success(
      forced
        ? `已强制退回该工单（原处理人 ${holder || "staff"}），其他同事可接手（待处理计时不重置）`
        : "已释放该工单，其他同事可接手（待处理计时不重置）",
    );
    first().catch(() => {});
    refreshTicketSummary();
    // 没接手就不看详情：退出后本次打开的抽屉一并关掉（强制退回同理，退回后已不属于我）
    drawer.visible = false;
  } finally {
    releasing.value = false;
  }
}

// ---- 列表内的工单动作（不必先打开详情）----
// 每行一个忙标记，避免同一行连点；键 = `mailId:动作`
const rowBusy = ref("");

function patchRowTicket(row, ticket) {
  if (!ticket) return;
  row.ticket = ticket;
  row.ticketStatus = ticket.status;
}

// 「接手」之后才会打开详情（没接手时列表已挡住「查看」）：
// 把服务端返回的工单同步到列表行，否则抽屉里已是「处理中 · 我」，
// 背后那一行还挂着「接手」按钮（同一工单的多行一起改）。
function syncViewedTicket(current) {
  if (!current?.ticketId) return;
  let changed = false;
  for (const item of list.value) {
    if (item.ticket?.ticketId !== current.ticketId) continue;
    patchRowTicket(item, current);
    changed = true;
  }
  // 待处理 → 处理中会改变分栏计数（待处理 -1 / 处理中 +1 / 我处理中 +1）
  if (changed) refreshTicketSummary();
}

// 接手：pending → processing（幂等；被别人抢先 → 409 TICKET_CLAIMED）
async function claimRow(row) {
  const ticketId = row.ticket?.ticketId;
  if (!ticketId || rowBusy.value) return;

  const key = `${row.mailId}:claim`;
  rowBusy.value = key;
  try {
    const result = await claimTicketQuietly(ticketId);
    if (!result.ok) {
      const descriptor = result.descriptor;
      if (descriptor?.action === TICKET_ERROR_ACTION.RELOAD) {
        ElMessage.warning(descriptor.message);
        first().catch(() => {});
      } else {
        ElMessage.error(descriptor?.message || "接手失败");
      }
      refreshTicketSummary();
      return;
    }
    patchRowTicket(row, result.ticket);
    ElMessage.success("已接手，其他同事将无法查看内容");
    refreshTicketSummary();
  } finally {
    rowBusy.value = "";
  }
}

// 退出：processing → pending（处理人本人；admin 可强制退回他人工单；计时都不重置）
async function releaseRow(row) {
  const ticketId = row.ticket?.ticketId;
  if (!ticketId || rowBusy.value) return;

  const forced = !isMine(row);
  const holder = ticketAssigneeName(row.ticket);
  const key = `${row.mailId}:release`;
  rowBusy.value = key;
  try {
    const result = await releaseTicketQuietly(ticketId);
    if (!result.ok) {
      const descriptor = result.descriptor;
      ElMessage.error(descriptor?.message || "退出失败");
      if (descriptor?.action === TICKET_ERROR_ACTION.RELOAD) {
        first().catch(() => {});
      }
      refreshTicketSummary();
      return;
    }
    patchRowTicket(
      row,
      result.ticket ?? { ...row.ticket, status: "pending", assignee: null },
    );
    ElMessage.success(
      forced
        ? `已强制退回该工单（原处理人 ${holder || "staff"}），其他同事可接手`
        : "已释放该工单，其他同事可接手（待处理计时不重置）",
    );
    refreshTicketSummary();
  } finally {
    rowBusy.value = "";
  }
}

onMounted(async () => {
  try {
    // 先等列表回来：深链要按「这封的工单归谁」判断能不能打开
    await first();
  } catch (err) {
    ElMessage.error(extractErrorMessage(err));
  }
  refreshTicketSummary();
  startPolling();
  openMailFromQuery();
});

// ?mailId=：外部带邮件 id 跳过来时（如从处罚记录 / 通知里的深链），打开那封所在的会话。
// 列表里能查到这条会话时按工单归属判断（没接手不给看）；查不到（被默认筛选排除的历史邮件、
// 或带的是会话中间某一封的 id）先反查会话根，再交给后端判权限。
function threadMatches(row, mailId) {
  return (
    Number(row?.mailId) === mailId ||
    Number(row?.rootMailId) === mailId ||
    Number(row?.thread?.rootMailId) === mailId
  );
}

// threads/:rootId 只认会话根；深链可能带中间某一封的 id，用单封详情换出根 id。
// 换不到（无权限 / 已删除）就按原 id 打开，让后端给出具体错误。
async function resolveRootId(mailId) {
  try {
    const data = await getMail(mailId);
    return Number(data?.mail?.rootMsgId ?? data?.mail?.mailId ?? 0) || mailId;
  } catch {
    return mailId;
  }
}

async function openMailFromQuery() {
  const mailId = Number(route.query.mailId);
  if (!Number.isFinite(mailId) || mailId <= 0) return;
  const row = list.value.find((item) => threadMatches(item, mailId));
  if (row) return openRow(row);

  const rootId = await resolveRootId(mailId);
  // 反查期间用户可能又点了别的会话
  if (Number(route.query.mailId) !== mailId) return;
  return openMail({ mailId: rootId });
}

watch(
  () => route.query.mailId,
  () => openMailFromQuery(),
);

onBeforeUnmount(() => {
  stopPolling();
});
</script>

<style scoped>
.tip {
  color: #909399;
  font-size: 12px;
}

/* 筛选栏右侧的分栏计数：辅助信息，弱化显示 */
.summary-line {
  margin-left: auto;
  color: #909399;
  font-size: 12px;
  white-space: nowrap;
}

/* 主题列：标题 + 摘要两行；摘要缺失且有工单时给出「已隐藏」说明 */
.subject-cell {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.snippet {
  margin: 0;
  color: #909399;
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.hidden-tip {
  margin: 0;
  color: #c0c4cc;
  font-size: 12px;
}

/* 自己持有的工单：标题前的小标记，方便在长列表里找回 */
.mine-flag {
  margin-right: 4px;
  padding: 0 4px;
  border-radius: 3px;
  background: var(--el-color-primary-light-9);
  color: var(--el-color-primary);
  font-size: 11px;
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

/* 被他人持有：正文区换成占位说明，不再渲染任何邮件内容 */
.held-placeholder {
  padding: 12px 0;
}

/* admin 只读查看的提示条：压掉默认外边距，别把工单条挤开 */
.view-only-alert {
  margin: 0;
}

/* 抽屉标题头：标题占满剩余宽度并在必要时省略，关闭按钮永远留在抽屉内。
   关键是给标题所在的 flex 子项 min-width: 0 —— 默认 min-width: auto 时，
   一长串没有断点的文字（中文主题、链接、长编号）会把整行撑得比抽屉还宽，
   关闭按钮就被挤到抽屉外面去了。 */
:deep(.el-drawer__header) {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
}

.drawer-head {
  flex: 1 1 auto;
  min-width: 0;
}

.drawer-head__title {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 16px;
  font-weight: 600;
  line-height: 1.4;
}

:deep(.el-drawer__close-btn) {
  flex: 0 0 auto;
  margin: 0;
}

.reply-count {
  margin-left: 8px;
}
.mail-detail {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.mail-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  font-size: 13px;
}
/* 正文区的主题同样可能是长串：允许在任意位置换行，不撑破抽屉 */
.mail-meta > span {
  overflow-wrap: anywhere;
  min-width: 0;
}
.mail-meta .label {
  color: #909399;
  font-size: 12px;
}
.msg-subject {
  margin-bottom: 4px;
  color: #606266;
  font-size: 12px;
}
.loading,
.empty {
  padding: 20px;
}
.msg {
  margin-bottom: 12px;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
}
.msg.to_player {
  align-items: flex-end;
}
.msg-meta {
  font-size: 12px;
  color: #909399;
  margin-bottom: 4px;
}
.msg-sender {
  margin-right: 8px;
}
.msg-bubble {
  max-width: 80%;
  padding: 8px 12px;
  border-radius: 8px;
  background: #f4f4f5;
  white-space: pre-wrap;
  word-break: break-all;
  font-size: 14px;
}

/* 官方 → 玩家消息下方的「查看历史提示」：靠右对齐，与气泡同侧 */
.quote-toggle {
  margin-top: 2px;
  font-size: 12px;
}

/* 展开后的那次报价记录：序号 / 类型 / 价格 / 状态 + 当时暂存的答案 */
.quote-history {
  margin-top: 4px;
  max-width: 80%;
  padding: 8px 10px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 6px;
  background: var(--el-fill-color-blank);
  text-align: left;
}

.quote-history__item + .quote-history__item {
  margin-top: 8px;
}

.quote-history__head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--el-text-color-regular);
}

.quote-history__seq {
  color: var(--el-text-color-placeholder);
  font-variant-numeric: tabular-nums;
}

.quote-history__reply {
  margin: 6px 0 0;
  padding: 8px 10px;
  border-radius: 4px;
  background: var(--el-fill-color-light);
  font-size: 12px;
  line-height: 1.6;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.msg.to_player .msg-bubble {
  background: #ecf5ff;
}
.reply-bar {
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: 100%;
}
.reply-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>
