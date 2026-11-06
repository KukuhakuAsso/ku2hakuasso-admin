<script setup>
// 题目主数据（原「题库」页）：标题 / 排序 / 提示点奖励 / 归档 / 启用 / 答案 / 出题人。
// 字段口径见 api-12 §五：
//   GET /admin/puzzles        → key, title, ord, archiveId, tipsReward, enabled, authorId, authorUsername, answer?
//   PUT /admin/puzzles/:key   → title, ord, archive_id, tips_reward, enabled, answer, author_id（admin）
// 2026-11-05 起按出题人隔离：staff 只看到/只改得了自己的题；answer 只对作者本人或 admin 返回。
// PUT 不回显答案，所以保存后用列表重取一次来校准（由出题台负责）。
import { computed, reactive, ref, watch } from "vue";
import { ElMessage } from "element-plus";
import { putPuzzle } from "@/api/pz";
import { listAuthorCandidates } from "@/api/accounts";
import { pick } from "@/utils/format";
import { describeApiError } from "@/utils/apiError";

const props = defineProps({
    // GET /admin/puzzles 的列表项
    row: { type: Object, default: null },
    // 不能改这道题：非本人 staff（后端 403），或整体只读
    readonly: { type: Boolean, default: false },
    // 仅 admin 能改派出题人（PUT body 的 author_id）
    canAssignAuthor: { type: Boolean, default: false },
});
const emit = defineEmits(["saved"]);

const saving = ref(false);
const authorOptions = ref([]);
const authorLoading = ref(false);

// 有 answer 这个键（哪怕是 null）才说明有权查看；无权限时后端整个字段都不返回
const canReadAnswer = computed(
    () =>
        props.row != null &&
        Object.prototype.hasOwnProperty.call(props.row, "answer"),
);

const form = reactive({
    title: "",
    ord: 0,
    tipsReward: 0,
    archiveId: null,
    enabled: true,
    answer: "",
    authorId: null,
});

// 列表项里可能只有 camelCase（GET 口径），保存响应里是 snake_case（PUT 口径），两种都认
function toForm(row) {
    if (!row) {
        return {
            title: "",
            ord: 0,
            tipsReward: 0,
            archiveId: null,
            enabled: true,
            answer: "",
            authorId: null,
        };
    }
    const num = (value, fallback) => {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : fallback;
    };
    const archiveId = pick(row, "archiveId", "archive_id");
    return {
        title: String(pick(row, "title") ?? ""),
        ord: num(pick(row, "ord"), 0),
        tipsReward: num(
            pick(row, "tipsReward", "tips_reward"),
            0,
        ),
        archiveId:
            archiveId === undefined || archiveId === null
                ? null
                : num(archiveId, null),
        enabled: pick(row, "enabled") !== false,
        // 无权查看时永远按空串处理，避免把看不到的值当成「未改动」或「要清空」
        answer: canReadAnswer.value ? String(row.answer ?? "") : "",
        authorId: (() => {
            const value = pick(row, "authorId", "author_id");
            return value === undefined ? null : Number(value);
        })(),
    };
}

// 回填：换题（row 变化）时重置，避免把上一题的改动带到下一题
watch(
    () => props.row,
    (row) => {
        Object.assign(form, toForm(row));
    },
    { immediate: true },
);

const key = computed(() => pick(props.row, "key") ?? "");

// 出题人下拉：只在 admin 打开改派时拉一次（候选 = 全部 staff + admin）
async function loadAuthorOptions() {
    if (!props.canAssignAuthor || authorOptions.value.length || authorLoading.value) {
        return;
    }
    authorLoading.value = true;
    try {
        authorOptions.value = await listAuthorCandidates();
    } catch (error) {
        ElMessage.error(
            describeApiError(error, { fallback: "出题人候选加载失败" }),
        );
    } finally {
        authorLoading.value = false;
    }
}

watch(() => props.canAssignAuthor, loadAuthorOptions, { immediate: true });

function validate() {
    const title = form.title.trim();
    if (!title) {
        ElMessage.warning("标题不能为空");
        return null;
    }
    if (title.length > 200) {
        ElMessage.warning("标题最多 200 字");
        return null;
    }

    const ord = Number(form.ord);
    if (!Number.isInteger(ord) || ord < 0 || ord > 100000) {
        ElMessage.warning("排序值需为 0–100000 的整数");
        return null;
    }

    const tipsReward = Number(form.tipsReward);
    if (!Number.isInteger(tipsReward) || tipsReward < 0 || tipsReward > 1000000) {
        ElMessage.warning("提示点奖励需为 0–1000000 的整数");
        return null;
    }

    const archiveId =
        form.archiveId === null || form.archiveId === "" ? null : Number(form.archiveId);
    if (archiveId !== null && (!Number.isInteger(archiveId) || archiveId < 0)) {
        ElMessage.warning("归档 ID 需为非负整数，留空表示不归档");
        return null;
    }

    const answer = form.answer.trim();
    if (answer.length > 200) {
        ElMessage.warning("答案最多 200 字");
        return null;
    }

    if (props.canAssignAuthor && form.authorId) {
        if (!Number.isInteger(Number(form.authorId)) || Number(form.authorId) <= 0) {
            ElMessage.warning("出题人需为有效账号");
            return null;
        }
    }

    return {
        title,
        ord,
        tipsReward,
        archiveId,
        enabled: Boolean(form.enabled),
        answer,
        authorId: form.authorId ?? null,
    };
}

// 只提交改动过的字段：PUT 是「未传字段保持原值」，这样不会因为本地缺字段
// 把服务端已有值冲掉
function buildBody(current, base) {
    const body = {};
    if (current.title !== base.title) body.title = current.title;
    if (current.ord !== base.ord) body.ord = current.ord;
    if (current.tipsReward !== base.tipsReward) body.tips_reward = current.tipsReward;
    if (current.archiveId !== base.archiveId) body.archive_id = current.archiveId;
    if (current.enabled !== base.enabled) body.enabled = current.enabled;
    // 看不到原值时（staff 改别人的题）一律不动答案，避免把读不到的内容覆盖成空
    if (canReadAnswer.value && current.answer !== base.answer) {
        body.answer = current.answer;
    }
    // 改派是 admin 专属；staff 传 author_id 会被后端 403
    if (
        props.canAssignAuthor &&
        current.authorId !== null &&
        current.authorId !== base.authorId
    ) {
        body.author_id = current.authorId;
    }
    return body;
}

async function save() {
    if (props.readonly || saving.value) return;

    const current = validate();
    if (!current) return;
    if (!key.value) {
        ElMessage.error("没有选中题目");
        return;
    }

    const body = buildBody(current, toForm(props.row));
    if (!Object.keys(body).length) {
        ElMessage.info("没有需要保存的改动");
        return;
    }

    saving.value = true;
    try {
        const data = await putPuzzle(key.value, body);
        ElMessage.success("题目主数据已保存");
        emit("saved", data?.puzzle ?? null);
    } catch (error) {
        ElMessage.error(
            describeApiError(error, {
                fallback: "保存失败",
                forbidden: "只能修改自己的题目；改派他人出题人需要 admin",
            }),
        );
    } finally {
        saving.value = false;
    }
}
</script>

<template>
    <div class="meta">
        <p v-if="!row" class="tip">没有选中题目。</p>

        <el-form v-else label-width="110px" :disabled="readonly" @submit.prevent>
            <el-form-item label="题号 key">
                <span class="value">{{ key }}</span>
                <span class="tip inline">创建后不可修改</span>
            </el-form-item>

            <el-form-item label="标题">
                <el-input v-model="form.title" maxlength="200" show-word-limit />
            </el-form-item>

            <el-form-item label="排序">
                <el-input-number
                    v-model="form.ord"
                    :min="0"
                    :max="100000"
                    :step="1"
                    step-strictly
                    controls-position="right"
                />
                <span class="tip inline">数值越小越靠前</span>
            </el-form-item>

            <el-form-item label="提示点奖励">
                <el-input-number
                    v-model="form.tipsReward"
                    :min="0"
                    :max="1000000"
                    :step="1"
                    step-strictly
                    controls-position="right"
                />
            </el-form-item>

            <el-form-item label="归档 ID">
                <el-input-number
                    v-model="form.archiveId"
                    :min="0"
                    :step="1"
                    step-strictly
                    controls-position="right"
                    placeholder="留空表示不归档"
                />
            </el-form-item>

            <el-form-item label="启用">
                <el-switch v-model="form.enabled" />
                <span class="tip inline">停用后玩家侧不可见</span>
            </el-form-item>

            <el-form-item label="出题人">
                <!-- admin：可改派（PUT body 的 author_id）；staff：只读自己的账号 -->
                <el-select
                    v-if="canAssignAuthor"
                    v-model="form.authorId"
                    filterable
                    :loading="authorLoading"
                    placeholder="选择出题人"
                    style="width: 280px"
                    @focus="loadAuthorOptions"
                >
                    <el-option
                        v-for="item in authorOptions"
                        :key="item.id"
                        :label="`${item.label}（${item.role}）`"
                        :value="item.id"
                    />
                </el-select>
                <template v-else>
                    <span class="value">
                        {{ row.authorUsername || "—" }}
                    </span>
                    <span class="tip inline">
                        出题人归属只有 admin 能改派
                    </span>
                </template>
            </el-form-item>

            <el-form-item label="答案">
                <el-input
                    v-model="form.answer"
                    maxlength="200"
                    show-word-limit
                    :placeholder="canReadAnswer ? '留空表示不设答案' : '无权查看'"
                    :disabled="!canReadAnswer"
                />
                <p v-if="!canReadAnswer" class="tip">
                    答案只对出题人本人与 admin 返回，当前账号看不到原值，也不会提交该字段。
                </p>
                <p v-else class="tip">
                    答案已回显，只有改动才会提交；清空后保存表示取消答案。
                    保存后以题库列表为准重新回填（PUT 本身不返回答案）。
                </p>
            </el-form-item>

            <el-form-item>
                <el-button
                    type="primary"
                    :loading="saving"
                    :disabled="readonly"
                    @click="save"
                >
                    保存主数据
                </el-button>
                <span v-if="readonly" class="tip inline">修改题目主数据需要 admin 权限</span>
            </el-form-item>
        </el-form>
    </div>
</template>

<style scoped>
.meta {
    max-width: 720px;
    padding-top: 4px;
}

.value {
    font-family: var(--el-font-family-mono, monospace);
    font-size: 13px;
}

.tip {
    margin: 4px 0 0;
    font-size: 12px;
    line-height: 1.5;
    color: var(--el-text-color-secondary);
}

.tip.inline {
    margin: 0 0 0 10px;
}
</style>
