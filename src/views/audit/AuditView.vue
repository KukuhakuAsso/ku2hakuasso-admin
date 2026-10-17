<template>
  <div class="page-card">
    <div class="filter-bar">
      <el-select v-model="filters.target_type" placeholder="目标类型" style="width: 140px" clearable>
        <el-option label="账号 account" value="account" />
        <el-option label="队伍 team" value="team" />
        <el-option label="提示请求 hint_request" value="hint_request" />
      </el-select>
      <el-input v-model="filters.target_id" placeholder="目标ID" style="width: 130px" clearable />
      <el-input v-model="filters.action" placeholder="动作（如 team.ban）" style="width: 180px" clearable />
      <el-input v-model="filters.actor_id" placeholder="操作者ID" style="width: 130px" clearable />
      <el-button type="primary" @click="search">查询</el-button>
      <el-button @click="reset">重置</el-button>
    </div>

    <el-table v-loading="loading" :data="list" border stripe>
      <el-table-column prop="id" label="ID" width="80" />
      <el-table-column label="操作者" min-width="150">
        <template #default="{ row }">{{ row.actor || `#${row.actorId}` }}</template>
      </el-table-column>
      <el-table-column label="动作" min-width="180">
        <template #default="{ row }">
          <div class="action">
            <span class="action-label">{{ auditActionLabel(row.action) }}</span>
            <span
              v-if="row.action !== auditActionLabel(row.action)"
              class="action-code"
              >{{ row.action }}</span
            >
          </div>
        </template>
      </el-table-column>
      <el-table-column label="目标" min-width="120">
        <template #default="{ row }">{{ row.targetType }} #{{ row.targetId }}</template>
      </el-table-column>
      <el-table-column label="详情" min-width="240">
        <template #default="{ row }">
          <span class="payload">{{ fmtJson(row.payload) }}</span>
        </template>
      </el-table-column>
      <el-table-column prop="ip" label="IP" width="140" />
      <el-table-column label="时间" width="180">
        <template #default="{ row }">{{ fmtTime(row.createdAt) }}</template>
      </el-table-column>
    </el-table>

    <PageNav :page="page" :has-more="hasMore" :loading="loading" @prev="prev" @next="next" />
  </div>
</template>

<script setup>
import { onMounted, reactive } from "vue";
import { ElMessage } from "element-plus";
import { listActions } from "@/api/audit";
import { useCursorPage } from "@/composables/useCursorPage";
import PageNav from "@/components/PageNav.vue";
import { fmtTime, fmtJson, auditActionLabel } from "@/utils/format";

const filters = reactive({ target_type: "", target_id: "", action: "", actor_id: "" });

const fetcher = (cursor) => listActions({ ...filters, cursor, limit: 50 });
const { list, page, hasMore, loading, first, next, prev } = useCursorPage(fetcher);

function search() {
    first();
}
function reset() {
    filters.target_type = "";
    filters.target_id = "";
    filters.action = "";
    filters.actor_id = "";
    first();
}

onMounted(() => first());
</script>

<style scoped>
.payload {
    font-size: 12px;
    color: #606266;
    word-break: break-all;
}
.action {
    display: flex;
    flex-direction: column;
    line-height: 1.35;
}
/* 动作名是契约（查询与筛选都按它），中文标签旁保留原文便于对照 */
.action-code {
    color: #909399;
    font-size: 11px;
}
</style>
