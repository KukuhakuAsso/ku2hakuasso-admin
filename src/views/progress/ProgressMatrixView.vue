<template>
  <div class="page-card">
    <div class="filter-bar">
      <el-select v-model="filters.status" placeholder="队伍状态" style="width: 160px" clearable>
        <el-option label="正常" :value="1" />
        <el-option label="已解散" :value="2" />
        <el-option label="已封禁" :value="3" />
      </el-select>
      <el-input-number v-model="filters.limit_teams" :min="1" :max="500" />
      <span class="tip">队伍数量上限（默认 200，最大 500）</span>
      <el-button type="primary" @click="load">查询</el-button>
    </div>

    <el-table v-loading="loading" :data="teams" border stripe>
      <el-table-column prop="teamId" label="队伍ID" width="90" fixed="left" />
      <el-table-column label="队名" min-width="130" fixed="left">
        <template #default="{ row }">{{ row.name || "—" }}</template>
      </el-table-column>
      <el-table-column label="状态" width="90" fixed="left">
        <template #default="{ row }">
          <el-tag :type="statusMeta(row.status, TEAM_STATUS).type" size="small">
            {{ statusMeta(row.status, TEAM_STATUS).label }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column
        v-for="p in puzzles"
        :key="p.key"
        :label="p.key"
        :width="colWidth(p)"
      >
        <template #default="{ row }">
          <span v-if="row.cells && row.cells[p.key]" class="solved-time">
            {{ fmtTime(row.cells[p.key]) }}
          </span>
          <span v-else class="unsolved">未解</span>
        </template>
      </el-table-column>
    </el-table>
  </div>
</template>

<script setup>
import { onMounted, reactive, ref } from "vue";
import { ElMessage } from "element-plus";
import { getProgressMatrix } from "@/api/progress";
import { fmtTime, TEAM_STATUS, statusMeta } from "@/utils/format";

const filters = reactive({ status: "", limit_teams: 200 });
const loading = ref(false);
const teams = ref([]);
const puzzles = ref([]);

async function load() {
    loading.value = true;
    try {
        const data = await getProgressMatrix({ ...filters });
        puzzles.value = data?.puzzles || [];
        teams.value = data?.teams || [];
    } catch (err) {
        ElMessage.error(err.message);
    } finally {
        loading.value = false;
    }
}

function colWidth(p) {
    const title = p.title || p.key || "";
    return Math.max(140, title.length * 16 + 40);
}

onMounted(() => load());
</script>

<style scoped>
.tip {
    color: #909399;
    font-size: 12px;
    line-height: 32px;
}
.solved-time {
    font-size: 12px;
    color: #67c23a;
}
.unsolved {
    font-size: 12px;
    color: #c0c4cc;
}
</style>
