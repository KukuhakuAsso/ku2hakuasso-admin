<template>
  <div class="page-card">
    <div class="filter-bar">
      <el-select v-model="filters.status" placeholder="状态（默认待处理）" style="width: 160px" clearable>
        <el-option label="待处理" value="pending" />
        <el-option label="已答复" value="answered" />
        <el-option label="已拒绝" value="rejected" />
      </el-select>
      <el-button type="primary" @click="search">查询</el-button>
      <el-button @click="reset">重置</el-button>
      <span class="tip">同一队可能存在多条待处理请求，答复/拒绝后状态即迁移。</span>
    </div>

    <el-table v-loading="loading" :data="list" border stripe>
      <el-table-column prop="id" label="ID" width="70" />
      <el-table-column label="队伍" min-width="130">
        <template #default="{ row }">{{ row.teamName || "—" }}（#{{ row.teamId }}）</template>
      </el-table-column>
      <el-table-column label="发起人" min-width="130">
        <template #default="{ row }">{{ row.username || "—" }}（{{ row.playerNo || "—" }}）</template>
      </el-table-column>
      <el-table-column prop="cost" label="扣费" width="70" />
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
      <el-table-column label="操作" width="160" fixed="right">
        <template #default="{ row }">
          <template v-if="auth.isAdmin && row.status === 'pending'">
            <el-button size="small" type="primary" @click="openReply(row)">答复</el-button>
            <el-button size="small" type="danger" @click="rejectRow(row)">拒绝</el-button>
          </template>
          <span v-else>—</span>
        </template>
      </el-table-column>
    </el-table>

    <PageNav :page="page" :has-more="hasMore" :loading="loading" @prev="prev" @next="next" />

    <el-dialog v-model="replyDialog.visible" title="答复求提示" width="480px">
      <el-form label-width="80px">
        <el-form-item label="回复内容" required>
          <el-input v-model="replyDialog.content" type="textarea" :rows="5" maxlength="2000" show-word-limit />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="replyDialog.visible = false">取消</el-button>
        <el-button type="primary" :loading="replyDialog.loading" @click="submitReply">发送答复</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { useAuthStore } from "@/stores/auth";
import { listHintRequests, replyHint, rejectHint } from "@/api/msg";
import { useCursorPage } from "@/composables/useCursorPage";
import PageNav from "@/components/PageNav.vue";
import { fmtTime, HINT_STATUS, statusMeta } from "@/utils/format";

const auth = useAuthStore();
const filters = reactive({ status: "" });

const fetcher = (cursor) => listHintRequests({ ...filters, cursor, limit: 50 });
const { list, page, hasMore, loading, first, next, prev } = useCursorPage(fetcher);

function search() {
    first();
}
function reset() {
    filters.status = "";
    first();
}

function waitTime(createdAt) {
    const ms = Date.now() - new Date(createdAt).getTime();
    if (Number.isNaN(ms) || ms < 0) return "—";
    const m = Math.floor(ms / 60000);
    if (m < 60) return `${m} 分钟`;
    const h = Math.floor(m / 60);
    return `${h} 小时 ${m % 60} 分`;
}

const replyDialog = reactive({ visible: false, loading: false, content: "", row: null });

function openReply(row) {
    replyDialog.row = row;
    replyDialog.content = "";
    replyDialog.visible = true;
}

async function submitReply() {
    if (!replyDialog.content.trim()) {
        ElMessage.warning("请填写回复内容");
        return;
    }
    replyDialog.loading = true;
    try {
        await replyHint(replyDialog.row.id, { content: replyDialog.content.trim() });
        ElMessage.success("已答复");
        replyDialog.visible = false;
        first();
    } catch (err) {
        ElMessage.error(err.message);
    } finally {
        replyDialog.loading = false;
    }
}

async function rejectRow(row) {
    let reason = "";
    try {
        const { value } = await ElMessageBox.prompt("拒绝将全额退款给该队", "拒绝求提示", {
            inputType: "textarea",
            inputPlaceholder: "拒绝原因（可选，≤200 字）",
        });
        reason = value || "";
    } catch {
        return;
    }
    try {
        await rejectHint(row.id, { reason: reason.trim() });
        ElMessage.success("已拒绝并全额退款");
        first();
    } catch (err) {
        ElMessage.error(err.message);
    }
}

onMounted(() => first());
</script>

<style scoped>
.tip {
    color: #909399;
    font-size: 12px;
}
</style>
