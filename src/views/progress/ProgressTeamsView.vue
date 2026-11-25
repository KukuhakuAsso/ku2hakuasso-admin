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

    <p v-if="isMobile" class="mobile-hint">
      点击任意一行进入详情；长按同样可以打开该行的操作
    </p>

    <el-table
      ref="tableRef"
      v-loading="loading"
      :data="list"
      border
      stripe
      @row-click="openTeam"
      @row-contextmenu="onContextMenu"
    >
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
      <el-table-column v-if="!isMobile" label="操作" width="100" fixed="right">
        <template #default>
          <el-button size="small" text type="primary">详情</el-button>
        </template>
      </el-table-column>
    </el-table>

    <!-- 手机端：操作列不渲染（点行即可进入详情），长按仍弹出同一动作的面板保持一致性 -->
    <RowActionSheet
      v-model="actionSheetVisible"
      :title="actionSheetTitle"
      :actions="actionSheetActions"
      @select="onSheetSelect"
    />

    <PageNav :page="page" :has-more="hasMore" :loading="loading" @prev="run(prev)" @next="run(next)" />
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from "vue";
import { useRouter } from "vue-router";
import { ElMessage } from "element-plus";
import { listProgressTeams } from "@/api/progress";
import { useCursorPage } from "@/composables/useCursorPage";
import { useIsMobile } from "@/composables/useMediaQuery";
import { useRowLongPress } from "@/composables/useRowLongPress";
import PageNav from "@/components/PageNav.vue";
import RowActionSheet from "@/components/RowActionSheet.vue";
import { fmtTime, TEAM_STATUS, statusMeta } from "@/utils/format";
import { describeApiError } from "@/config/errors";

const router = useRouter();
const filters = reactive({ status: "" });

const fetcher = (cursor) => listProgressTeams({ ...filters, cursor, limit: 50 });
const { list, page, hasMore, loading, first, next, prev } = useCursorPage(fetcher);

// useCursorPage 不吞异常：这里兜住，否则 403 只会变成一条无声的 unhandled rejection
async function run(action) {
    try {
        await action();
    } catch (err) {
        ElMessage.error(
            describeApiError(err, { forbidden: "队伍进度仅 admin 可查看" }),
        );
    }
}

function search() {
    run(first);
}
function reset() {
    filters.status = "";
    run(first);
}
function openTeam(row) {
    router.push(`/progress/team/${row.teamId}`);
}

// ---- 手机端：长按行弹出操作面板（这张表唯一动作就是「详情」）----
const isMobile = useIsMobile();
const tableRef = ref(null);
const actionSheetVisible = ref(false);

const { activeRow, onContextMenu } = useRowLongPress({
    tableRef,
    getRows: () => list.value,
    isMobile,
    onLongPress: () => {
        actionSheetVisible.value = true;
    },
});

const actionSheetActions = computed(() => {
    if (!activeRow.value) return [];
    return [{ key: "detail", label: "查看详情", type: "primary" }];
});

const actionSheetTitle = computed(() => {
    const row = activeRow.value;
    if (!row) return "";
    return `${row.name || "未命名队伍"}（队伍 #${row.teamId}）`;
});

function onSheetSelect(key) {
    const row = activeRow.value;
    actionSheetVisible.value = false;
    if (key === "detail" && row) openTeam(row);
}

onMounted(() => run(first));
</script>
