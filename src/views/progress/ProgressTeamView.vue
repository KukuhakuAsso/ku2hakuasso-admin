<template>
  <div class="page-card">
    <div class="toolbar">
      <el-button @click="$router.back()">返回</el-button>
      <h3 v-if="team">{{ team.name }}（#{{ team.teamId }}）</h3>
    </div>

    <el-skeleton v-if="loading" :rows="8" animated />
    <template v-else-if="team">
      <el-descriptions :column="3" border size="small" class="mb">
        <el-descriptions-item label="队伍ID">{{ team.teamId }}</el-descriptions-item>
        <el-descriptions-item label="状态">
          <el-tag :type="statusMeta(team.status, TEAM_STATUS).type" size="small">
            {{ statusMeta(team.status, TEAM_STATUS).label }}
          </el-tag>
        </el-descriptions-item>
        <el-descriptions-item label="确认参赛">{{ fmtTime(team.confirmedAt) }}</el-descriptions-item>
        <el-descriptions-item label="封禁原因">{{ team.banReason || "—" }}</el-descriptions-item>
        <el-descriptions-item label="封禁至">{{ fmtTime(team.banUntil) }}</el-descriptions-item>
      </el-descriptions>

      <h4 class="mb">题目通过情况</h4>
      <el-table :data="puzzles" border stripe size="small">
        <el-table-column prop="key" label="题号" width="120" />
        <el-table-column prop="title" label="标题" min-width="160" />
        <el-table-column prop="ord" label="序号" width="80" />
        <el-table-column label="状态" width="90">
          <template #default="{ row }">
            <el-tag :type="row.solved ? 'success' : 'info'" size="small">
              {{ row.solved ? "已解" : "未解" }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="通过时间" width="180">
          <template #default="{ row }">{{ fmtTime(row.solvedAt) }}</template>
        </el-table-column>
        <el-table-column label="解题人" min-width="120">
          <template #default="{ row }">
            <template v-if="row.solvedBy">{{ row.solvedBy.username || row.solvedBy.accountId }}</template>
            <template v-else>—</template>
          </template>
        </el-table-column>
        <el-table-column label="耗时" width="110">
          <template #default="{ row }">{{ fmtDuration(row.durationMs) }}</template>
        </el-table-column>
        <el-table-column prop="attempts" label="尝试次数" width="90" />
      </el-table>

      <h4 class="mb mt">达成的里程碑</h4>
      <el-table v-if="milestones.length" :data="milestones" border stripe size="small">
        <el-table-column prop="key" label="标识" width="160" />
        <el-table-column prop="title" label="标题" min-width="160" />
        <el-table-column prop="kind" label="类型" width="100" />
        <el-table-column prop="tipsReward" label="提示点奖励" width="110" />
        <el-table-column label="达成时间" width="180">
          <template #default="{ row }">{{ fmtTime(row.hitAt) }}</template>
        </el-table-column>
      </el-table>
      <el-empty v-else description="暂无里程碑" />
    </template>
  </div>
</template>

<script setup>
import { onMounted, ref } from "vue";
import { useRoute } from "vue-router";
import { ElMessage } from "element-plus";
import { getProgressTeam } from "@/api/progress";
import { fmtTime, fmtDuration, TEAM_STATUS, statusMeta } from "@/utils/format";

const route = useRoute();
const loading = ref(false);
const team = ref(null);
const puzzles = ref([]);
const milestones = ref([]);

onMounted(async () => {
    loading.value = true;
    try {
        const data = await getProgressTeam(route.params.id);
        team.value = data?.team || null;
        puzzles.value = data?.puzzles || [];
        milestones.value = data?.milestones || [];
    } catch (err) {
        ElMessage.error(err.message);
    } finally {
        loading.value = false;
    }
});
</script>

<style scoped>
.mb {
    margin-bottom: 12px;
}
.mt {
    margin-top: 24px;
}
</style>
