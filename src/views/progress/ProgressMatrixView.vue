<template>
  <div class="page-card">
    <div class="filter-bar">
      <el-select v-model="filters.status" style="width: 160px">
        <el-option
          v-for="opt in STATUS_OPTIONS"
          :key="opt.value"
          :label="opt.label"
          :value="opt.value"
        />
      </el-select>
      <el-input-number v-model="filters.limit_teams" :min="1" :max="500" />
      <span class="tip">队伍数量上限（默认 200，最大 500）</span>
      <el-button type="primary" :loading="loading" @click="load">查询</el-button>
    </div>

    <!-- 一行为一队、一列为一题，格子是该队该题的首次通过时间（未通过为 null） -->
    <el-table
      v-loading="loading"
      :data="teams"
      border
      stripe
      size="small"
      max-height="calc(100vh - 240px)"
    >
      <el-table-column prop="teamId" label="队伍ID" width="90" fixed="left" />
      <el-table-column label="队名" min-width="140" fixed="left">
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
        :width="colWidth(p)"
        align="center"
      >
        <template #header>
          <div class="puzzle-head">
            <span class="puzzle-title">{{ p.title || p.key }}</span>
            <span v-if="p.title" class="puzzle-key">{{ p.key }}</span>
          </div>
        </template>
        <template #default="{ row }">
          <el-tooltip
            v-if="cellValue(row, p.key)"
            :content="fmtTime(cellValue(row, p.key))"
            placement="top"
          >
            <span class="solved-time">{{ fmtCell(cellValue(row, p.key)) }}</span>
          </el-tooltip>
          <span v-else class="unsolved">—</span>
        </template>
      </el-table-column>
    </el-table>
    <el-empty v-if="!loading && !teams.length" description="暂无数据" />
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from "vue";
import { ElMessage } from "element-plus";
import { getProgressMatrix } from "@/api/progress";
import { fmtTime, TEAM_STATUS, statusMeta } from "@/utils/format";

// 状态取值见 api-9-admin.md：matrix 缺省按「只看正常队伍（2）」处理，
// 要拿全量必须显式传 0（与 /progress/teams 的缺省语义不同）
const STATUS_OPTIONS = [
    { value: 2, label: "正常队伍" },
    { value: 3, label: "已禁言" },
    { value: 4, label: "已封禁" },
    { value: 1, label: "已解散" },
    { value: 0, label: "全部队伍" },
];

const filters = reactive({ status: 2, limit_teams: 200 });
const loading = ref(false);
const teams = ref([]);
const puzzles = ref([]);

// 通过时间通常集中在同一场比赛内：全部落在同一天就只显示时分秒，跨天再补日期
const crossDay = computed(() => {
    const days = new Set();
    for (const team of teams.value) {
        for (const value of Object.values(team.cells || {})) {
            if (!value) continue;
            const d = new Date(value);
            if (Number.isNaN(d.getTime())) continue;
            days.add(`${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`);
            if (days.size > 1) return true;
        }
    }
    return false;
});

async function load() {
    loading.value = true;
    try {
        const data = await getProgressMatrix({ ...filters });
        // 列顺序即题目顺序（ord），各队横向对照的才是同一序列
        puzzles.value = [...(data?.puzzles || [])].sort(
            (a, b) =>
                (a.ord ?? 0) - (b.ord ?? 0) ||
                String(a.key).localeCompare(String(b.key)),
        );
        teams.value = data?.teams || [];
    } catch (err) {
        ElMessage.error(err.message);
    } finally {
        loading.value = false;
    }
}

const pad2 = (n) => String(n).padStart(2, "0");

function fmtCell(value) {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return String(value);
    const clock = `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
    return crossDay.value
        ? `${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${clock}`
        : clock;
}

// 未通过的题目在 cells 里是 null（不是缺键）
const cellValue = (row, key) => row?.cells?.[key] || null;

function colWidth(p) {
    const headChars = Math.max((p.title || "").length, (p.key || "").length);
    const cellChars = crossDay.value ? 14 : 8;
    return Math.max(96, headChars * 14 + 24, cellChars * 7 + 24);
}

onMounted(() => load());
</script>

<style scoped>
.tip {
    color: #909399;
    font-size: 12px;
    line-height: 32px;
}
.puzzle-head {
    display: flex;
    flex-direction: column;
    line-height: 1.35;
}
.puzzle-title {
    font-weight: 600;
}
.puzzle-key {
    color: #909399;
    font-size: 11px;
    font-weight: 400;
}
.solved-time {
    color: #67c23a;
    font-size: 12px;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
}
.unsolved {
    color: #c0c4cc;
    font-size: 12px;
}
</style>
