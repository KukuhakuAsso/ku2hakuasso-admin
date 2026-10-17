<template>
  <div class="page-card">
    <div class="filter-bar">
      <el-select v-model="filters.status" placeholder="队伍状态" style="width: 160px" clearable>
        <el-option label="正常" :value="2" />
        <el-option label="已禁言" :value="3" />
        <el-option label="已封禁" :value="4" />
        <el-option label="已解散" :value="1" />
      </el-select>
      <el-button type="primary" @click="search">查询</el-button>
      <el-button @click="reset">重置</el-button>
    </div>

    <el-table v-loading="loading" :data="list" border stripe @row-click="openTeam">
      <el-table-column prop="teamId" label="队伍ID" width="90" />
      <el-table-column label="队名" min-width="140">
        <template #default="{ row }">{{ row.name || "—" }}</template>
      </el-table-column>
      <el-table-column label="状态" width="100">
        <template #default="{ row }">
          <el-tag :type="statusMeta(row.status, TEAM_STATUS).type" size="small">
            {{ statusMeta(row.status, TEAM_STATUS).label }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="memberCount" label="成员" width="80" />
      <el-table-column label="解出/总数" width="110">
        <template #default="{ row }">{{ row.solvedCount }}/{{ row.totalPuzzles }}</template>
      </el-table-column>
      <el-table-column prop="score" label="得分" width="90" />
      <el-table-column label="首解" width="170">
        <template #default="{ row }">{{ fmtTime(row.firstSolveAt) }}</template>
      </el-table-column>
      <el-table-column label="最近解出" width="170">
        <template #default="{ row }">{{ fmtTime(row.lastSolveAt) }}</template>
      </el-table-column>
      <el-table-column label="最近题目" width="100">
        <template #default="{ row }">{{ row.lastPuzzle || "—" }}</template>
      </el-table-column>
      <el-table-column label="操作" width="100" fixed="right">
        <template #default>
          <el-button size="small" text type="primary">详情</el-button>
        </template>
      </el-table-column>
    </el-table>

    <PageNav :page="page" :has-more="hasMore" :loading="loading" @prev="prev" @next="next" />
  </div>
</template>

<script setup>
import { onMounted, reactive } from "vue";
import { useRouter } from "vue-router";
import { ElMessage } from "element-plus";
import { listProgressTeams } from "@/api/progress";
import { useCursorPage } from "@/composables/useCursorPage";
import PageNav from "@/components/PageNav.vue";
import { fmtTime, TEAM_STATUS, statusMeta } from "@/utils/format";

const router = useRouter();
const filters = reactive({ status: "" });

const fetcher = (cursor) => listProgressTeams({ ...filters, cursor, limit: 50 });
const { list, page, hasMore, loading, first, next, prev } = useCursorPage(fetcher);

function search() {
    first();
}
function reset() {
    filters.status = "";
    first();
}
function openTeam(row) {
    router.push(`/progress/team/${row.teamId}`);
}

onMounted(() => first());
</script>
