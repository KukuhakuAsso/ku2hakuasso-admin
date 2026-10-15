<template>
  <div>
    <div class="page-card">
      <h3 class="mb">管理端统计</h3>
      <el-skeleton v-if="loading" :rows="5" animated />
      <template v-else-if="entries.length">
        <el-row :gutter="16">
          <el-col
            v-for="entry in entries"
            :key="entry.key"
            :xs="12"
            :sm="8"
            :md="6"
            :lg="4"
          >
            <el-card shadow="never" class="stat-card">
              <div class="stat-value">{{ entry.value }}</div>
              <div class="stat-label">{{ entry.label }}</div>
            </el-card>
          </el-col>
        </el-row>
        <el-divider />
        <el-table :data="entries" size="small">
          <el-table-column prop="label" label="指标" />
          <el-table-column prop="value" label="数值" />
        </el-table>
      </template>
      <el-empty v-else description="暂无统计数据" />
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from "vue";
import { ElMessage } from "element-plus";
import { getStats } from "@/api/maintenance";
import { fmtTime, fmtJson } from "@/utils/format";

const loading = ref(false);
const stats = ref(null);

const entries = computed(() => {
    if (!stats.value || typeof stats.value !== "object") return [];
    return Object.entries(stats.value).map(([key, value]) => ({
        key,
        label: prettyLabel(key),
        value: formatValue(value),
    }));
});

function prettyLabel(key) {
    const map = {
        totalPlayers: "玩家总数",
        totalTeams: "队伍总数",
        totalPuzzles: "题目总数",
        solvedPuzzles: "已解题目",
        submissions: "提交总数",
        correctSubmissions: "正确提交",
        pendingHints: "待处理提示",
        unreadThreads: "未读会话",
        bannedAccounts: "封禁账号",
        bannedTeams: "封禁队伍",
    };
    return map[key] || key;
}

function formatValue(v) {
    if (v === null || v === undefined) return "—";
    if (typeof v === "object") return fmtJson(v);
    if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v)) {
        return fmtTime(v);
    }
    return String(v);
}

onMounted(async () => {
    loading.value = true;
    try {
        stats.value = await getStats();
    } catch (err) {
        ElMessage.error(err.message || "加载统计失败");
    } finally {
        loading.value = false;
    }
});
</script>

<style scoped>
.mb {
    margin-bottom: 16px;
}
.stat-card {
    margin-bottom: 12px;
    text-align: center;
}
.stat-value {
    font-size: 24px;
    font-weight: 600;
    color: #1f2d3d;
}
.stat-label {
    font-size: 12px;
    color: #8a94a6;
    margin-top: 4px;
}
</style>
