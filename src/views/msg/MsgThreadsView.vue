<template>
  <div class="page-card">
    <div class="filter-bar">
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
    </div>

    <el-table
      v-loading="loading"
      :data="list"
      border
      stripe
      @row-click="openMail"
    >
      <el-table-column prop="mailId" label="邮件ID" width="90" />
      <el-table-column label="主题" min-width="240">
        <template #default="{ row }">
          <span :style="{ fontWeight: row.unread > 0 ? 600 : 400 }">
            {{ row.subject || "（无主题）" }}
          </span>
          <el-tag
            v-if="row.replyCount"
            size="small"
            type="info"
            class="reply-count"
          >
            {{ row.replyCount }} 条回复
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="来源" width="110">
        <template #default="{ row }">
          <el-tag size="small" :type="statusMeta(row.source, MAIL_SOURCE).type">
            {{ statusMeta(row.source, MAIL_SOURCE).label }}
          </el-tag>
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
      <el-table-column label="方向" width="100">
        <template #default="{ row }">
          {{ row.direction === "to_staff" ? "玩家 → 官方" : "官方 → 玩家" }}
        </template>
      </el-table-column>
      <el-table-column label="未读" width="80">
        <template #default="{ row }">
          <el-badge v-if="row.unread > 0" :value="row.unread" type="danger" />
          <span v-else>—</span>
        </template>
      </el-table-column>
      <el-table-column label="最后回复" width="170">
        <template #default="{ row }">
          {{ fmtTime(row.lastReplyAt || row.createdAt) }}
        </template>
      </el-table-column>
      <el-table-column label="操作" width="90" fixed="right">
        <template #default>
          <el-button size="small" text type="primary">查看</el-button>
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

    <!-- 邮件详情抽屉：mail（当前这封）+ replyChain（它回复过的链）+ 官方回复 -->
    <el-drawer v-model="drawer.visible" size="620px" :title="drawerTitle">
      <div class="mail-detail">
        <div class="mail-meta">
          <span class="label">主题</span>
          <span>{{ mail?.subject || "（无主题）" }}</span>
        </div>
        <div class="mail-meta">
          <span class="label">频道</span>
          <span>{{ mail?.channelName || "—" }}</span>
          <span class="label">来源</span>
          <span>{{ statusMeta(mail?.source, MAIL_SOURCE).label }}</span>
        </div>

        <div v-if="drawer.loading" class="loading">
          <el-skeleton :rows="6" animated />
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
          </div>
        </template>
      </div>
      <template #footer>
        <div class="reply-bar">
          <p v-if="!canReply" class="tip">
            这封邮件不可回复（官方公告只读，或当前账号没有 msg.feedback.handle
            权限）。
          </p>
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
import { computed, onBeforeUnmount, onMounted, reactive, ref } from "vue";
import { ElMessage } from "element-plus";
import { useAuthStore } from "@/stores/auth";
import { listMails, getMail, replyMail } from "@/api/msg";
import { useCursorPage } from "@/composables/useCursorPage";
import PageNav from "@/components/PageNav.vue";
import {
  fmtTime,
  MAIL_CHANNEL_OPTIONS,
  MAIL_SOURCE,
  statusMeta,
} from "@/utils/format";

const POLL_INTERVAL_MS = 10000;
let pollTimer = null;

const auth = useAuthStore();

const channel = ref("");
const onlyUnread = ref(false);

// 列队用邮件式接口：每条记录一行，倒序游标分页
const fetcher = (cursor) =>
  listMails({
    cursor,
    limit: 20,
    channel: channel.value || undefined,
    only_unread: onlyUnread.value || undefined,
  });
const { list, page, hasMore, loading, first, next, prev } =
  useCursorPage(fetcher);

// ---- 邮件详情 ----
const drawer = reactive({
  visible: false,
  loading: false,
  sending: false,
  mailId: null,
  content: "",
});
const mail = ref(null);
const messages = ref([]);

// 详情请求的序号：只接受「最新一次请求且仍是同一封邮件」的响应，
// 避免切到 B 之后 A 的迟到响应、或轮询与手动刷新的旧响应覆盖界面
let detailSeq = 0;

function startPolling() {
  stopPolling();
  pollTimer = setInterval(() => {
    if (drawer.visible) {
      if (drawer.mailId) loadMessages();
      return;
    }

    // 列表：只在第一页自动刷新。first() 会把游标栈与页码重置到第 1 页，
    // 操作员正在翻旧邮件时不能被每 10 秒拽回最新页；请求进行中也跳过，避免叠加。
    if (page.value === 1 && !loading.value) {
      first().catch(() => {
        // 轮询失败不打扰操作员，下一轮会再试
      });
    }
  }, POLL_INTERVAL_MS);
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

// 公告只读；回复还需要 msg.feedback.handle 权限
const canReply = computed(
  () => Boolean(mail.value?.canReply) && auth.can("msg.feedback.handle"),
);

const drawerTitle = computed(() => {
  const item = mail.value;
  if (!item) return "邮件";
  return `邮件 #${item.mailId} · ${item.subject || "（无主题）"}`;
});

async function openMail(row) {
  drawer.mailId = row.mailId;
  drawer.content = "";
  drawer.visible = true;
  mail.value = null;
  messages.value = [];
  await loadMessages();
}

async function loadMessages() {
  // 先记下这次要请求的邮件：响应回来时据此判断是否已被替换
  const requestedId = drawer.mailId;
  if (!requestedId) return;

  const seq = ++detailSeq;
  drawer.loading = true;
  try {
    const data = await getMail(requestedId);
    // 已经切到别的邮件、或已有更新的请求 → 丢弃这次响应
    if (seq !== detailSeq || requestedId !== drawer.mailId) return;

    mail.value = data?.mail || null;
    // 渲染顺序：mail（当前打开这封，时间最新）在前，replyChain 按服务端顺序
    //（时间倒序，最新祖先在前、链尾是根）跟在后面——旧信息排在时间新的正文之后。
    const chain = Array.isArray(data?.replyChain) ? data.replyChain : [];
    messages.value = [];
    if (mail.value) {
      messages.value.push(mail.value);
    }
    messages.value.push(...chain);
  } catch (err) {
    // 被替换的请求失败不打扰操作员
    if (seq !== detailSeq || requestedId !== drawer.mailId) return;
    ElMessage.error(err.message);
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

async function sendReply() {
  if (!canReply.value || !drawer.content.trim()) return;

  // 发到点发送时看到的那封邮件；之后即使切到别的邮件也不受影响
  const targetId = drawer.mailId;
  drawer.sending = true;
  try {
    await replyMail(targetId, { content: drawer.content.trim() });
    ElMessage.success("已回复");
    // 回复成功后自动关闭抽屉，回到列表并刷新（反映新回复与未读状态）；
    // 期间已切到别的邮件时，不要清空正文或关掉当前这个抽屉
    if (targetId === drawer.mailId) {
      drawer.content = "";
      drawer.visible = false;
    }
    first().catch((err) => ElMessage.error(err.message));
  } catch (err) {
    if (targetId === drawer.mailId) ElMessage.error(err.message);
  } finally {
    drawer.sending = false;
  }
}

onMounted(() => {
  first().catch((err) => ElMessage.error(err.message));
  startPolling();
});

onBeforeUnmount(() => {
  stopPolling();
});
</script>

<style scoped>
.tip {
  color: #909399;
  font-size: 12px;
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
