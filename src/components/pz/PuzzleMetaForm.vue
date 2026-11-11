<script setup>
// 题目主数据（原「题库」页）：标题 / 排序 / 提示点奖励 / 归档 / 启用 / 答案 / 出题人。
// 字段口径见 api-12 §五：
//   GET /admin/puzzles        → key, title, ord, archiveId, tipsReward, enabled, authorId, authorUsername, answer?
//   PUT /admin/puzzles/:key   → title, ord, archive_id, tips_reward, enabled, answer, author_id（admin）
// 2026-11-05 起按出题人隔离：staff 只看到/只改得了自己的题；answer 只对作者本人或 admin 返回。
// PUT 不回显答案，所以保存后用列表重取一次来校准（由出题台负责）。
import { computed, nextTick, reactive, ref, watch } from "vue";
import { ElMessage } from "element-plus";
import { putPuzzle } from "@/api/pz";
import { listAuthorCandidates } from "@/api/accounts";
import { pick } from "@/utils/format";
import { describeApiError } from "@/api/errors";
import PageMergeDialog from "@/components/pz/PageMergeDialog.vue";
import { META_ROW_ACTION, decideMetaRow } from "./metaMerge.js";

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

// 参与比对 / 合并的字段：看不到的字段不参与，也不提交
const metaFields = computed(() => {
    const list = [
        { key: "title", label: "标题" },
        { key: "ord", label: "排序" },
        { key: "tipsReward", label: "提示点奖励" },
        { key: "archiveId", label: "归档 ID" },
        { key: "enabled", label: "启用" },
    ];
    if (canReadAnswer.value) list.push({ key: "answer", label: "答案" });
    if (props.canAssignAuthor) list.push({ key: "authorId", label: "出题人" });
    return list;
});

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

// 与服务端「已对齐」的字段快照：既用来判断表单脏没脏，也作为三方合并的 base。
let appliedKey = "";
let baseline = null;
let prompting = false;
let closing = false;
let pendingRow = null;
let queuedRow = null;

const mergeOpen = ref(false);
const mergeRev = ref(0);
const mergeBase = ref(null);
const mergeLocal = ref(null);
const mergeRemote = ref(null);

// 两侧都过一遍 toForm：它负责类型归一（数字、null、布尔），
// 保证「表单里的值」和「列表行里的值」用同一把尺子比较。
function snapOfRow(row) {
    const out = {};
    const normalized = toForm(row);
    for (const field of metaFields.value) out[field.key] = normalized[field.key] ?? null;
    return out;
}

function snapOfForm() {
    return snapOfRow({
        title: form.title,
        ord: form.ord,
        tipsReward: form.tipsReward,
        archiveId: form.archiveId,
        enabled: form.enabled,
        answer: form.answer,
        authorId: form.authorId,
    });
}

function applyRow(row) {
    Object.assign(form, toForm(row));
    appliedKey = row?.key ?? "";
    baseline = row ? snapOfRow(row) : null;
}

// 行变了要区分三件事：换题 / 后台刷新 / 服务端也改了
//   换题          → 直接回填
//   表单干净      → 直接回填（保存后的重取也走这里，后端会补默认值）
//   只有本地改过  → 不动草稿，只把基准推进到这次的服务端内容
//   两边都改了    → 打开三方合并弹窗
function handleRow(row) {
    if (prompting || closing) {
        queuedRow = row;
        return;
    }
    if (!row) {
        applyRow(null);
        return;
    }

    const local = snapOfForm();
    const remote = snapOfRow(row);
    const action = decideMetaRow({
        appliedKey,
        rowKey: row.key,
        local,
        remote,
        baseline,
    });

    if (action === META_ROW_ACTION.APPLY) {
        applyRow(row);
        return;
    }
    if (action === META_ROW_ACTION.REBASE) {
        appliedKey = row.key;
        baseline = remote;
        return;
    }

    prompting = true;
    pendingRow = row;
    mergeRev.value = Number(row.rev) || 0;
    mergeBase.value = baseline ? { ...baseline } : null;
    mergeLocal.value = local;
    mergeRemote.value = remote;
    mergeOpen.value = true;
}

function onMergeApply({ mode, payload }) {
    const row = pendingRow;
    pendingRow = null;
    // 本组件是 mergeOpen 的唯一控制者：先关窗，排队的行等关闭动画结束后再处理
    mergeOpen.value = false;
    prompting = false;
    closing = true;

    if (row) {
        if (mode === "remote") {
            applyRow(row);
        } else if (mode === "merge") {
            Object.assign(form, payload ?? {});
            appliedKey = row.key;
            baseline = snapOfRow(row);
        } else {
            // 保留我的修改：草稿不动，但基准要推进到这次看到的服务端内容，
            // 否则下一轮同一处服务端改动会被当成「仅服务端改过」而反复弹窗
            appliedKey = row.key;
            baseline = snapOfRow(row);
        }
    }
}

function onMergeClosed() {
    closing = false;
    // 兜底：万一有非 footer 的路径把弹窗关掉，别把 prompting 卡在 true
    if (prompting) {
        prompting = false;
        pendingRow = null;
    }
    const next = queuedRow;
    queuedRow = null;
    if (!next) return;
    // Element Plus 先 emit closed 再写回 modelValue：等这次更新落地再开新弹窗
    nextTick(() => handleRow(next));
}

function readMetaField(payload, key) {
    return payload?.[key] ?? null;
}

function formatMetaField(value, row) {
    if (row.key === "enabled") return value ? "启用" : "停用";
    if (row.key === "archiveId") return value == null ? "不归档" : `#${value}`;
    if (row.key === "answer") return value ? String(value) : "（未设置）";
    if (row.key === "authorId") {
        if (value == null) return "（未指派）";
        const hit = authorOptions.value.find((item) => item.id === Number(value));
        return hit?.label ? `${hit.label}` : `账号 #${value}`;
    }
    return String(value ?? "");
}

const buildMetaResult = (values) => values;

// 回填：换题直接重置；同一题的后台刷新按「表单干不干净」决定应用还是弹合并
watch(() => props.row, handleRow, { immediate: true });

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
        // 这次提交的内容就是新的对齐基准：随后的 refreshList 换新行时不该被当成冲突
        baseline = snapOfRow(current);
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

        <!-- 服务端更新 + 本地还有未保存修改：复用页面的三方合并弹窗 -->
        <PageMergeDialog
            v-model="mergeOpen"
            :rev="mergeRev"
            :base="mergeBase"
            :local="mergeLocal"
            :remote="mergeRemote"
            :fields="metaFields"
            :read-field="readMetaField"
            :format-field="formatMetaField"
            :build-result="buildMetaResult"
            @apply="onMergeApply"
            @closed="onMergeClosed"
        />
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
