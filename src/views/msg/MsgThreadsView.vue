<template>
  <div class="page-card">
    <div class="filter-bar">
      <el-checkbox v-model="onlyUnread" @change="load">只看未读</el-checkbox>
      <el-button type="primary" @click="load">刷新</el-button>
    </div>

    <el-table v-loading="loading" :data="threads" border stripe @row-click="openThread">
      <el-table-column prop="threadId" label="会话ID" width="90" />
      <el-table-column label="类型" width="110">
        <template #default="{ row }">
          <el-tag size="small" :type="kindType(row.kind)">{{ kindLabel(row.kind) }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="对象" min-width="140">
        <template #default="{ row }">
          <template v-if="row.kind === 'team'">{{ row.teamName || "—" }}</template>
          <template v-else-if="row.kind === 'account'">
            {{ row.ownerUsername || "—" }}（{{ row.ownerPlayerNo || "—" }}）
          </template>
          <template v-else>全体玩家</template>
        </template>
      </el-table-column>
      <el-table-column label="预览" min-width="260">
        <template #default="{ row }">
          <span :style="{ color: row.previewDirection === 'to_staff' ? '#303133' : '#909399' }">
            {{ row.preview || "—" }}
          </span>
        </template>
      </el-table-column>
      <el-table-column label="未读" width="80">
        <template #default="{ row }">
          <el-badge v-if="row.hasUnread" is-dot type="danger" />
          <span v-else>—</span>
        </template>
      </el-table-column>
      <el-table-column label="最后消息" width="170">
        <template #default="{ row }">{{ fmtTime(row.lastCreatedAt || row.lastMsgAt) }}</template>
      </el-table-column>
      <el-table-column label="操作" width="100" fixed="right">
        <template #default>
          <el-button size="small" text type="primary">查看</el-button>
        </template>
      </el-table-column>
    </el-table>

    <!-- 会话详情抽屉 -->
    <el-drawer v-model="drawer.visible" size="560px" :title="drawerTitle">
      <div class="thread-body">
        <div v-if="drawer.loading" class="loading"><el-skeleton :rows="6" animated /></div>
        <template v-else>
          <div v-if="!messages.length" class="empty"><el-empty description="暂无消息" /></div>
          <div v-for="msg in messages" :key="msg.id" class="msg" :class="msg.direction">
            <div class="msg-meta">
              <span class="msg-sender">{{ senderName(msg) }}</span>
              <span class="msg-time">{{ fmtTime(msg.createdAt) }}</span>
            </div>
            <div class="msg-bubble">{{ msg.content }}</div>
          </div>
        </template>
      </div>
      <template #footer>
        <div class="reply-bar">
          <el-input
            v-model="drawer.content"
            type="textarea"
            :rows="3"
            maxlength="2000"
            show-word-limit
            :disabled="!auth.isAdmin"
            placeholder="回复正文（1–2000 字）"
          />
          <div class="reply-actions">
            <el-button @click="loadMessages">刷新</el-button>
            <el-button
              v-if="auth.isAdmin"
              type="primary"
              :loading="drawer.sending"
              :disabled="!drawer.content.trim()"
              @click="sendReply"
            >
              发送回复
            </el-button>
          </div>
        </div>
      </template>
    </el-drawer>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from "vue";
import { ElMessage } from "element-plus";
import { useAuthStore } from "@/stores/auth";
import { listThreads, getThread, replyThread } from "@/api/msg";
import { fmtTime, THREAD_KIND } from "@/utils/format";

const auth = useAuthStore();

const threads = ref([]);
const loading = ref(false);
const onlyUnread = ref(false);

async function load() {
    loading.value = true;
    try {
        const data = await listThreads({ only_unread: onlyUnread.value || undefined, limit: 200 });
        threads.value = data?.threads || [];
    } catch (err) {
        ElMessage.error(err.message);
    } finally {
        loading.value = false;
    }
}

function kindLabel(kind) {
    return THREAD_KIND[kind] || kind;
}
function kindType(kind) {
    return kind === "team" ? "primary" : kind === "account" ? "warning" : "info";
}

// ---- 会话详情 ----
const drawer = reactive({
    visible: false,
    loading: false,
    sending: false,
    thread: null,
    content: "",
});
const messages = ref([]);

const drawerTitle = computed(() => {
    const t = drawer.thread;
    if (!t) return "会话";
    if (t.kind === "team") return `会话 #${t.threadId} · ${t.teamName || "队伍会话"}`;
    if (t.kind === "account") return `会话 #${t.threadId} · ${t.ownerUsername || "账号级会话"}`;
    return `会话 #${t.threadId} · 官方公告`;
});

async function openThread(row) {
    drawer.thread = row;
    drawer.content = "";
    drawer.visible = true;
    await loadMessages();
}

async function loadMessages() {
    drawer.loading = true;
    try {
        const data = await getThread(drawer.thread.threadId, { since_id: 0, limit: 100 });
        messages.value = data?.messages || [];
    } catch (err) {
        ElMessage.error(err.message);
    } finally {
        drawer.loading = false;
    }
}

function senderName(msg) {
    if (msg.sender?.username) return msg.sender.username;
    if (msg.senderId === null || msg.senderId === undefined) {
        return msg.direction === "to_player" ? "官方" : "玩家";
    }
    return `#${msg.senderId}`;
}

async function sendReply() {
    drawer.sending = true;
    try {
        await replyThread({ thread_id: drawer.thread.threadId, content: drawer.content.trim() });
        ElMessage.success("已回复");
        drawer.content = "";
        await loadMessages();
        await load();
    } catch (err) {
        ElMessage.error(err.message);
    } finally {
        drawer.sending = false;
    }
}

onMounted(() => load());
</script>

<style scoped>
.thread-body {
    height: calc(100vh - 200px);
    overflow-y: auto;
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
