<template>
  <div class="page-card">
    <div class="filter-bar">
      <el-select v-model="filters.status" style="width: 130px">
        <el-option
          v-for="opt in STATUS_OPTIONS"
          :key="opt.value"
          :label="opt.label"
          :value="opt.value"
        />
      </el-select>
      <el-select
        v-model="filters.puzzle_key"
        placeholder="全部题目"
        filterable
        clearable
        style="width: 220px"
      >
        <el-option
          v-for="item in puzzleOptions"
          :key="item.key"
          :label="item.title ? `${item.title}（${item.key}）` : item.key"
          :value="item.key"
        />
      </el-select>
      <el-input
        v-model="filters.team_id"
        placeholder="队伍ID"
        style="width: 110px"
        clearable
      />
      <el-select v-model="filters.sort" style="width: 140px">
        <el-option label="按队伍ID" value="team_id" />
        <el-option
          label="按通过时间"
          value="solved_at"
          :disabled="!filters.puzzle_key"
        />
        <el-option
          label="按通过时长"
          value="duration"
          :disabled="!filters.puzzle_key"
        />
      </el-select>
      <el-select v-model="filters.order" style="width: 100px">
        <el-option label="降序" value="desc" />
        <el-option label="升序" value="asc" />
      </el-select>
      <el-radio-group v-model="metric">
        <el-radio-button value="time">通过时间</el-radio-button>
        <el-radio-button value="duration">通过时长</el-radio-button>
      </el-radio-group>
      <el-select v-model="limit" style="width: 110px" @change="search">
        <el-option
          v-for="n in LIMIT_OPTIONS"
          :key="n"
          :label="`每页 ${n} 队`"
          :value="n"
        />
      </el-select>
      <el-button type="primary" :loading="loading" @click="search">查询</el-button>
      <el-button @click="reset">重置</el-button>
    </div>

    <p v-if="!filters.puzzle_key" class="hint">
      按「通过时间 / 通过时长」排序需先选定一道题目；未通过的格子记「—」并排在最后。
    </p>

    <!-- 一行为一队、一列为一题；格子是首次通过时间或「首次通过 − 首次取题」的时长 -->
    <el-table
      v-loading="loading"
      :data="teams"
      border
      stripe
      size="small"
      max-height="calc(100vh - 300px)"
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
            :content="cellTooltip(row, p.key)"
            placement="top"
          >
            <span :class="metric === 'duration' ? 'solved-duration' : 'solved-time'">
              {{ cellText(row, p.key) }}
            </span>
          </el-tooltip>
          <span v-else class="unsolved">—</span>
        </template>
      </el-table-column>
    </el-table>
    <el-empty v-if="!loading && !teams.length" description="暂无数据" />

    <div class="matrix-foot">
      <span class="hint">共 {{ total }} 支队 · 每页 {{ limit }} 队</span>
      <PageNav
        :page="page"
        :has-more="hasMore"
        :loading="loading"
        @prev="prev"
        @next="next"
      />
    </div>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import { ElMessage } from "element-plus";
import { getProgressMatrix } from "@/api/progress";
import { listPuzzles } from "@/api/pz";
import {
    fmtTime,
    fmtDuration,
    TEAM_STATUS,
    statusMeta,
} from "@/utils/format";
import { describeApiError } from "@/api/errors";
import { isStaleRequest, requestLatest, cancelChannel } from "@/api/http";
import PageNav from "@/components/PageNav.vue";

// 状态取值见 api-9-admin.md：matrix 缺省按「只看正常队伍（2）」处理，
// 要拿全量必须显式传 0（与 /progress/teams 的缺省语义不同）
const STATUS_OPTIONS = [
    { value: 2, label: "正常队伍" },
    { value: 3, label: "已禁言" },
    { value: 4, label: "已封禁" },
    { value: 1, label: "已解散" },
    { value: 0, label: "全部队伍" },
];

// 后端分页上限 500；旧参数 limit_teams 已由 page/limit 取代
const LIMIT_OPTIONS = [50, 100, 200, 500];

const DEFAULT_FILTERS = {
    status: 2,
    puzzle_key: "",
    team_id: "",
    sort: "team_id",
    order: "desc",
};

const filters = reactive({ ...DEFAULT_FILTERS });
const metric = ref("time");
const limit = ref(200);
const page = ref(1);
const total = ref(0);
const hasMore = ref(false);
const loading = ref(false);
const teams = ref([]);
const puzzles = ref([]);
const puzzleOptions = ref([]);

// 指标类排序默认「最快/最早在前」，队伍排序保持旧的倒序
function defaultOrder(sort) {
    return sort === "team_id" ? "desc" : "asc";
}

watch(
    () => filters.sort,
    (sort) => {
        filters.order = defaultOrder(sort);
    },
);

// solved_at / duration 必须带 puzzle_key，否则后端 400：题目被清空时退回默认排序
watch(
    () => filters.puzzle_key,
    (key) => {
        if (!key && filters.sort !== "team_id") filters.sort = "team_id";
    },
);

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

async function loadPuzzleOptions() {
    try {
        const data = await listPuzzles();
        puzzleOptions.value = data?.items ?? [];
    } catch {
        // 题目下拉失败不阻塞矩阵本身；下方 load() 会把响应里的题目补进选项
    }
}

// /admin/puzzles 拉不到时，至少让矩阵里出现过的题能在筛选里选中
function mergePuzzleOptions(list) {
    for (const item of list) {
        if (!puzzleOptions.value.some((o) => o.key === item.key)) {
            puzzleOptions.value.push({ key: item.key, title: item.title });
        }
    }
}

function parseTeamId() {
    const raw = String(filters.team_id ?? "").trim();
    if (!raw) return null;
    const parsed = Number(raw);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : NaN;
}

// 同一频道只让最后一次请求生效（见 api/http 的 requestLatest）：
// 重置 / 改每页条数都可能在旧请求还在飞的时候再发一次，
// 晚到的旧响应会覆盖分页与数据，还会提前把 loading 关掉、弹一条已过期请求的错误。
const MATRIX_CHANNEL = "progress-matrix";

async function load(target = page.value) {
    const teamId = parseTeamId();
    if (Number.isNaN(teamId)) {
        ElMessage.warning("队伍ID需为正整数");
        return;
    }

    loading.value = true;
    // 被更新的一次取代：不要碰任何界面状态，loading 交给那一次去收尾
    let superseded = false;
    try {
        const data = await requestLatest(MATRIX_CHANNEL, ({ signal }) =>
            getProgressMatrix(
                {
                    status: filters.status,
                    puzzle_key: filters.puzzle_key || undefined,
                    team_id: teamId ?? undefined,
                    sort: filters.sort,
                    order: filters.order,
                    page: target,
                    limit: limit.value,
                },
                { signal },
            ),
        );
        // 列顺序即题目顺序（ord），各队横向对照的才是同一序列
        puzzles.value = [...(data?.puzzles || [])].sort(
            (a, b) =>
                (a.ord ?? 0) - (b.ord ?? 0) ||
                String(a.key).localeCompare(String(b.key)),
        );
        mergePuzzleOptions(puzzles.value);
        teams.value = data?.teams || [];
        page.value = data?.page ?? target;
        total.value = data?.total ?? teams.value.length;
        hasMore.value = !!data?.hasMore;
    } catch (err) {
        if (isStaleRequest(err)) {
            superseded = true;
            return;
        }
        ElMessage.error(
            describeApiError(err, { forbidden: "通过矩阵仅 admin 可查看" }),
        );
    } finally {
        if (!superseded) loading.value = false;
    }
}

function search() {
    load(1);
}

function reset() {
    Object.assign(filters, DEFAULT_FILTERS);
    metric.value = "time";
    limit.value = 200;
    load(1);
}

function prev() {
    if (page.value <= 1 || loading.value) return;
    load(page.value - 1);
}

function next() {
    if (!hasMore.value || loading.value) return;
    load(page.value + 1);
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

// durations 是服务端的「首次通过 − 首次取题」；缺取题记录等异常为 null
function cellDuration(row, key) {
    const value = row?.durations?.[key];
    return typeof value === "number" ? value : null;
}

function cellText(row, key) {
    if (metric.value !== "duration") return fmtCell(cellValue(row, key));
    const duration = cellDuration(row, key);
    return duration === null ? "—" : fmtDuration(duration);
}

function cellTooltip(row, key) {
    const parts = [];
    if (cellValue(row, key)) parts.push(`通过 ${fmtTime(cellValue(row, key))}`);
    const duration = cellDuration(row, key);
    parts.push(duration === null ? "用时未知" : `用时 ${fmtDuration(duration)}`);
    return parts.join(" · ");
}

function colWidth(p) {
    const headChars = Math.max((p.title || "").length, (p.key || "").length);
    const cellChars =
        metric.value === "duration" ? 10 : crossDay.value ? 14 : 8;
    return Math.max(96, headChars * 14 + 24, cellChars * 7 + 24);
}

onMounted(() => {
    loadPuzzleOptions();
    load(1);
});

// 离开页面时中断还在飞的请求，别让它的响应落到已卸载的视图上
onBeforeUnmount(() => cancelChannel(MATRIX_CHANNEL));
</script>

<style scoped>
.tip {
    color: #909399;
    font-size: 12px;
    line-height: 32px;
}
.hint {
    margin: 0;
    color: #909399;
    font-size: 12px;
}
.matrix-foot {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-top: 12px;
}
.matrix-foot :deep(.page-nav) {
    margin-top: 0;
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
.solved-duration {
    color: #409eff;
    font-size: 12px;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
}
.unsolved {
    color: #c0c4cc;
    font-size: 12px;
}
</style>
