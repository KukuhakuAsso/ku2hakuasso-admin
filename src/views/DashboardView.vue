<template>
  <div>
    <div class="page-card">
      <div class="head">
        <h3 class="title">管理端统计</h3>
        <div class="head-actions">
          <span v-if="loadedAt" class="updated-at">
            {{ fmtTime(loadedAt) }} 更新
          </span>
          <el-button size="small" :loading="loading" @click="load">
            刷新
          </el-button>
        </div>
      </div>

      <el-skeleton v-if="loading && !stats" :rows="4" animated />
      <el-empty v-else-if="!stats" description="暂无统计数据" />
      <template v-else>
        <!-- live：当前实时概况 -->
        <el-divider content-position="left">实时概况</el-divider>
        <el-row v-if="liveEntries.length" :gutter="16">
          <el-col
            v-for="entry in liveEntries"
            :key="entry.key"
            :xs="12"
            :sm="12"
            :md="6"
          >
            <el-card shadow="never" class="stat-card">
              <div class="stat-value">{{ entry.value }}</div>
              <div class="stat-label">{{ entry.label }}</div>
            </el-card>
          </el-col>
        </el-row>
        <el-empty v-else description="暂无实时数据" :image-size="60" />

        <!-- daily：按日汇总；列不用写死，按返回里的字段推导，数字列带相对柱 -->
        <el-divider content-position="left">每日统计</el-divider>
        <el-table
          v-if="dailyColumns.length"
          v-loading="loading"
          :data="dailyRows"
          border
          stripe
          size="small"
          max-height="420"
        >
          <el-table-column
            v-for="col in dailyColumns"
            :key="col.key"
            :label="col.label"
            :width="col.width"
            :min-width="col.minWidth"
            :align="col.align"
          >
            <template #default="{ row }">
              <span v-if="row[col.key] === null || row[col.key] === undefined">
                —
              </span>
              <span v-else-if="col.numeric" class="num-cell">
                <span>{{ row[col.key] }}</span>
                <span class="bar" :style="{ width: barWidth(row[col.key], col.key) }" />
              </span>
              <span v-else>{{ formatCell(row[col.key]) }}</span>
            </template>
          </el-table-column>
        </el-table>
        <el-empty v-else description="暂无每日统计" :image-size="60" />

        <!-- 字段未在接口文档中固定，留一份原始返回便于核对 -->
        <el-collapse class="raw">
          <el-collapse-item title="原始返回">
            <pre class="pre">{{ fmtJson(stats) }}</pre>
          </el-collapse-item>
        </el-collapse>
      </template>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from "vue";
import { ElMessage } from "element-plus";
import { getStats } from "@/api/maintenance";
import { fmtTime, fmtJson } from "@/utils/format";

// 已知字段给中文名，未知字段原样显示（后端加指标不用改前端）
const LIVE_LABELS = {
    players: "玩家",
    teams: "队伍",
    solves: "解出",
    messages: "消息",
};

const DAILY_LABELS = {
    ...LIVE_LABELS,
    date: "日期",
    day: "日期",
    statDate: "日期",
    submissions: "提交",
    correct: "正确提交",
    hints: "提示",
    newPlayers: "新增玩家",
    newTeams: "新增队伍",
    activePlayers: "活跃玩家",
};

const loading = ref(false);
const stats = ref(null);
const loadedAt = ref(null);

const live = computed(() =>
    stats.value?.live && typeof stats.value.live === "object"
        ? stats.value.live
        : null,
);

const liveEntries = computed(() =>
    Object.entries(live.value || {}).map(([key, value]) => ({
        key,
        label: LIVE_LABELS[key] || key,
        value: value === null || value === undefined ? "—" : String(value),
    })),
);

const dailyRows = computed(() =>
    (Array.isArray(stats.value?.daily) ? stats.value.daily : [])
        .filter((item) => item && typeof item === "object")
        .map((item, index) => ({ ...item, __key: index })),
);

const isDateLike = (v) =>
    typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v);

// 列 = 各行字段的并集，顺序按首次出现；全为数字的列右对齐并画相对柱
const dailyColumns = computed(() => {
    const rows = dailyRows.value;
    const keys = [];
    for (const row of rows) {
        for (const key of Object.keys(row)) {
            if (key !== "__key" && !keys.includes(key)) keys.push(key);
        }
    }
    return keys.map((key) => {
        const values = rows.map((row) => row[key]).filter((v) => v != null);
        const numeric =
            values.length > 0 && values.every((v) => typeof v === "number");
        const dateLike = !numeric && values.some(isDateLike);
        return {
            key,
            label: DAILY_LABELS[key] || key,
            numeric,
            dateLike,
            align: numeric ? "right" : "left",
            ...(dateLike ? { width: 130 } : {}),
            ...(numeric ? { width: 120 } : { minWidth: 140 }),
        };
    });
});

const dailyMax = computed(() => {
    const max = {};
    for (const col of dailyColumns.value) {
        if (!col.numeric) continue;
        max[col.key] = dailyRows.value.reduce(
            (acc, row) =>
                typeof row[col.key] === "number"
                    ? Math.max(acc, row[col.key])
                    : acc,
            0,
        );
    }
    return max;
});

function barWidth(value, key) {
    const max = dailyMax.value[key];
    if (!max || typeof value !== "number") return "0%";
    return `${Math.max(2, Math.round((value / max) * 100))}%`;
}

function formatCell(value) {
    if (typeof value === "object") return fmtJson(value);
    if (typeof value === "string" && value.includes("T")) return fmtTime(value);
    return String(value);
}

async function load() {
    loading.value = true;
    try {
        stats.value = await getStats();
        loadedAt.value = new Date();
    } catch (err) {
        ElMessage.error(err.message || "加载统计失败");
    } finally {
        loading.value = false;
    }
}

onMounted(load);
</script>

<style scoped>
.head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 16px;
}
.title {
    margin: 0;
}
.head-actions {
    display: flex;
    align-items: center;
    gap: 12px;
}
.updated-at {
    color: #909399;
    font-size: 12px;
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
/* 数字列：右侧一条按列最大值缩放的相对柱，便于看出趋势 */
.num-cell {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 8px;
}
.bar {
    flex: 0 0 auto;
    height: 6px;
    max-width: 70px;
    border-radius: 3px;
    background: #a0cfff;
}
.raw {
    margin-top: 16px;
}
.pre {
    white-space: pre-wrap;
    word-break: break-all;
    background: #f5f7fa;
    padding: 12px;
    border-radius: 4px;
    font-size: 12px;
    margin: 0;
}
</style>
