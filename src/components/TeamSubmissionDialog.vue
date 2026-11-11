<template>
    <el-dialog
        v-model="visible"
        :title="title"
        width="900px"
        top="8vh"
        append-to-body
        class="sub-dialog"
    >
        <div class="sub-bar">
            <el-select
                v-model="puzzleFilter"
                placeholder="全部题目"
                style="width: 240px"
                clearable
                filterable
                @change="onFilterChange"
            >
                <el-option
                    v-for="item in puzzleOptions"
                    :key="item.key"
                    :label="item.label"
                    :value="item.key"
                />
            </el-select>
            <el-button :loading="loading" @click="search">刷新</el-button>
            <span class="sub-bar__meta">{{ summary }}</span>
        </div>

        <el-alert
            v-if="error"
            :title="error"
            type="error"
            show-icon
            :closable="false"
            class="sub-alert"
        />

        <el-table
            v-loading="loading"
            :data="items"
            border
            stripe
            size="small"
            max-height="58vh"
        >
            <el-table-column label="题目" width="120">
                <template #default="{ row }">
                    <el-tooltip
                        :content="puzzleTitles[row.puzzleKey] || row.puzzleKey"
                        placement="top"
                    >
                        <span>{{ row.puzzleKey }}</span>
                    </el-tooltip>
                </template>
            </el-table-column>
            <el-table-column label="结果" width="80">
                <template #default="{ row }">
                    <el-tag :type="row.correct ? 'success' : 'danger'" size="small">
                        {{ row.correct ? "正确" : "错误" }}
                    </el-tag>
                </template>
            </el-table-column>
            <el-table-column label="提交答案" min-width="180">
                <template #default="{ row }">
                    <code class="sub-answer">{{ row.answer ?? "—" }}</code>
                </template>
            </el-table-column>
            <el-table-column label="提交人" min-width="120">
                <template #default="{ row }">
                    {{ row.username || `账号 #${row.accountId}` }}
                </template>
            </el-table-column>
            <el-table-column label="提交时间" width="180">
                <template #default="{ row }">{{ fmtTime(row.createdAt) }}</template>
            </el-table-column>
            <el-table-column label="耗时" width="110">
                <template #default="{ row }">{{ fmtDuration(row.durationMs) }}</template>
            </el-table-column>
            <template #empty>
                <span v-if="loading">正在读取…</span>
                <span v-else>还没有提交记录</span>
            </template>
        </el-table>

        <div v-if="hasMore" class="sub-more">
            <el-button size="small" :loading="loadingMore" @click="load()">
                {{ loadingMore ? "加载中…" : "加载更早的提交" }}
            </el-button>
        </div>
    </el-dialog>
</template>

<script setup>
// 队伍答案记录：与玩家端「本队提交记录」是同一份数据（含答错与已解后的重复提交），
// 但管理端必须走 GET /api/admin/progress/submissions —— 玩家端 GET /api/puzzle/:key/submissions
// 由服务端强制 team_id，只能取到自己所在队伍，查不了任意队伍。
import { computed, ref, watch } from "vue";
import { listSubmissions } from "@/api/progress";
import { useAuthStore } from "@/stores/auth";
import { describeApiError } from "@/api/errors";
import { fmtTime, fmtDuration } from "@/utils/format";

const PAGE_SIZE = 20;

const props = defineProps({
    modelValue: { type: Boolean, default: false },
    teamId: { type: [Number, String], default: null },
    teamName: { type: String, default: "" },
    // 打开时预选的题目（从表格某一行进入）；空串表示「全部题目」
    puzzleKey: { type: String, default: "" },
    puzzles: { type: Array, default: () => [] },
});

const emit = defineEmits(["update:modelValue"]);

const auth = useAuthStore();

const visible = computed({
    get: () => props.modelValue,
    set: (value) => emit("update:modelValue", value),
});

const puzzleFilter = ref("");
const items = ref([]);
const loading = ref(false);
const loadingMore = ref(false);
const error = ref("");
const nextCursor = ref(null);
const hasMore = ref(false);

// 关窗 / 换队后旧请求的响应必须作废，否则会把上一次查询的记录填进当前列表
let token = 0;

const title = computed(() =>
    props.teamName ? `${props.teamName} · 答案记录` : "答案记录",
);

const puzzleOptions = computed(() =>
    props.puzzles
        .filter((item) => item?.key)
        .map((item) => ({
            key: item.key,
            label: item.title ? `${item.key} · ${item.title}` : String(item.key),
        })),
);

// 题号 → 标题，供表格里的 tooltip 用（模板里不做函数调用，避免热更新时的陈旧绑定）
const puzzleTitles = computed(() => {
    const map = {};
    for (const item of props.puzzles) {
        if (item?.key) map[item.key] = item.title || item.key;
    }
    return map;
});

const summary = computed(() => {
    if (loading.value) return "正在读取…";
    if (!items.value.length) return "";
    return hasMore.value
        ? `已加载 ${items.value.length} 条（还有更早的记录）`
        : `共 ${items.value.length} 条`;
});

async function load({ reset = false } = {}) {
    if (!props.teamId) return;
    // 先判守卫再动 token：过早自增会让在飞请求的结果被丢弃，且它的 finally 不再收尾
    if (!reset && (loading.value || loadingMore.value)) return;
    if (!reset && !hasMore.value) return;

    const current = ++token;
    if (reset) {
        loading.value = true;
        error.value = "";
    } else {
        loadingMore.value = true;
    }

    try {
        const data = await listSubmissions({
            team_id: props.teamId,
            puzzle_key: puzzleFilter.value || undefined,
            // answer 原文仅 admin 可见，接口本身也是 admin 专属
            with_answer: auth.isAdmin ? 1 : undefined,
            cursor: reset ? 0 : nextCursor.value ?? 0,
            limit: PAGE_SIZE,
        });
        if (current !== token) return;

        const page = Array.isArray(data?.items) ? data.items : [];
        items.value = reset ? page : [...items.value, ...page];
        nextCursor.value = data?.nextCursor ?? null;
        hasMore.value = Boolean(data?.hasMore);
        // 失败提示只针对那一次请求：后续成功取到数据就撤掉
        error.value = "";
    } catch (err) {
        if (current !== token) return;
        error.value = describeApiError(err, {
            forbidden: "提交记录仅 admin 可查看",
            fallback: "提交记录加载失败",
        });
    } finally {
        if (current === token) {
            loading.value = false;
            loadingMore.value = false;
        }
    }
}

function search() {
    load({ reset: true });
}

// 换题目筛选：旧行与旧游标都属于上一次查询，不能留给新筛选复用 —— 否则这次请求失败时，
// 表格里留着别的题的行、「加载更早的提交」还会拿旧游标配新筛选去查。
// 与玩家端 SubmissionHistory 一致：换题 = 清空后重取，同一筛选的「刷新」只重取第一页。
function onFilterChange() {
    clear();
    load({ reset: true });
}

function clear() {
    token += 1;
    items.value = [];
    nextCursor.value = null;
    hasMore.value = false;
    error.value = "";
    loading.value = false;
    loadingMore.value = false;
}

// 展开时按传入的题目重置筛选并取第一页；关闭时清空，避免把上一队的记录留到下次
watch(
    () => props.modelValue,
    (open) => {
        if (open) {
            puzzleFilter.value = props.puzzleKey || "";
            clear();
            load({ reset: true });
        } else {
            clear();
        }
    },
);

// 队伍页是单队路由，但万一同一实例换了队伍，也要重新拉
watch(
    () => props.teamId,
    () => {
        if (!props.modelValue) return;
        clear();
        load({ reset: true });
    },
);
</script>

<style scoped>
.sub-bar {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 12px;
}

.sub-bar__meta {
    margin-left: auto;
    font-size: 12px;
    color: var(--el-text-color-secondary);
}

.sub-alert {
    margin-bottom: 12px;
}

.sub-answer {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 12px;
    overflow-wrap: anywhere;
}

.sub-more {
    display: flex;
    justify-content: center;
    margin-top: 12px;
}
</style>
