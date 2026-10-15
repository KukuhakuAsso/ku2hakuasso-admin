<template>
  <div class="page-card">
    <div class="filter-bar">
      <el-input v-model="filters.team_id" placeholder="队伍ID" style="width: 130px" clearable />
      <el-input v-model="filters.account_id" placeholder="账号ID" style="width: 130px" clearable />
      <el-input v-model="filters.puzzle_key" placeholder="题目 key" style="width: 150px" clearable />
      <el-checkbox v-if="auth.isAdmin" v-model="filters.with_answer">回显答案</el-checkbox>
      <el-button type="primary" @click="search">查询</el-button>
      <el-button @click="reset">重置</el-button>
    </div>

    <el-table v-loading="loading" :data="list" border stripe>
      <el-table-column prop="id" label="ID" width="80" />
      <el-table-column prop="teamId" label="队伍ID" width="90" />
      <el-table-column prop="accountId" label="账号ID" width="90" />
      <el-table-column label="提交人" min-width="120">
        <template #default="{ row }">{{ row.username || "—" }}</template>
      </el-table-column>
      <el-table-column prop="puzzleKey" label="题目" width="110" />
      <el-table-column label="结果" width="90">
        <template #default="{ row }">
          <el-tag :type="row.correct ? 'success' : 'danger'" size="small">
            {{ row.correct ? "正确" : "错误" }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="耗时" width="110">
        <template #default="{ row }">{{ fmtDuration(row.durationMs) }}</template>
      </el-table-column>
      <el-table-column label="提交时间" width="180">
        <template #default="{ row }">{{ fmtTime(row.createdAt) }}</template>
      </el-table-column>
      <el-table-column v-if="filters.with_answer" label="答案" min-width="200">
        <template #default="{ row }">{{ row.answer ?? "—" }}</template>
      </el-table-column>
    </el-table>

    <PageNav :page="page" :has-more="hasMore" :loading="loading" @prev="prev" @next="next" />
  </div>
</template>

<script setup>
import { onMounted, reactive } from "vue";
import { ElMessage } from "element-plus";
import { useAuthStore } from "@/stores/auth";
import { listSubmissions } from "@/api/progress";
import { useCursorPage } from "@/composables/useCursorPage";
import PageNav from "@/components/PageNav.vue";
import { fmtTime, fmtDuration } from "@/utils/format";

const auth = useAuthStore();
const filters = reactive({ team_id: "", account_id: "", puzzle_key: "", with_answer: false });

const fetcher = (cursor) =>
    listSubmissions({
        team_id: filters.team_id,
        account_id: filters.account_id,
        puzzle_key: filters.puzzle_key,
        with_answer: filters.with_answer ? 1 : undefined,
        cursor,
        limit: 50,
    });
const { list, page, hasMore, loading, first, next, prev } = useCursorPage(fetcher);

function search() {
    first();
}
function reset() {
    filters.team_id = "";
    filters.account_id = "";
    filters.puzzle_key = "";
    filters.with_answer = false;
    first();
}

onMounted(() => first());
</script>
