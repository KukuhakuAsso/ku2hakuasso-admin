<script setup>
// 题目主数据（原「题库」页）：标题 / 排序 / 提示点奖励 / 归档 / 启用 / 答案。
// 字段口径见 api-9「题库、里程碑与权限接口」：
//   GET /admin/puzzles        → key, title, ord, archiveId, tipsReward, enabled
//   PUT /admin/puzzles/:key   → title, ord, archive_id, tips_reward, enabled, answer（admin）
// answer 只写不读（GET 不返回），所以输入框每次都是空的，保存后清空。
import { computed, reactive, ref, watch } from "vue";
import { ElMessage } from "element-plus";
import { putPuzzle } from "@/api/pz";
import { pick } from "@/utils/format";

const props = defineProps({
    // GET /admin/puzzles 的列表项
    row: { type: Object, default: null },
    // 非 admin：只读（PUT /admin/puzzles/:key 是 admin 专属）
    readonly: { type: Boolean, default: false },
});
const emit = defineEmits(["saved"]);

const saving = ref(false);

const form = reactive({
    title: "",
    ord: 0,
    tipsReward: 0,
    archiveId: null,
    enabled: true,
    answer: "",
});

// 列表项里可能只有 camelCase（GET 口径），保存响应里是 snake_case（PUT 口径），两种都认
function toForm(row) {
    if (!row) {
        return { title: "", ord: 0, tipsReward: 0, archiveId: null, enabled: true };
    }
    const num = (value, fallback) => {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : fallback;
    };
    return {
        title: String(pick(row, "title") ?? ""),
        ord: num(pick(row, "ord"), 0),
        tipsReward: num(
            pick(row, "tipsReward", "tips_reward"),
            0,
        ),
        archiveId:
            pick(row, "archiveId", "archive_id") === undefined ||
            pick(row, "archiveId", "archive_id") === null
                ? null
                : num(pick(row, "archiveId", "archive_id"), null),
        enabled: pick(row, "enabled") !== false,
    };
}

// 回填：换题（row 变化）时重置，避免把上一题的改动带到下一题
watch(
    () => props.row,
    (row) => {
        Object.assign(form, toForm(row), { answer: "" });
    },
    { immediate: true },
);

const key = computed(() => pick(props.row, "key") ?? "");

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

    return { title, ord, tipsReward, archiveId, enabled: Boolean(form.enabled), answer };
}

// 只提交改动过的字段：PUT 是「未传字段保持原值」，这样不会因为本地缺字段
// （例如读不到的 answer）把服务端已有值冲掉
function buildBody(current, base) {
    const body = {};
    if (current.title !== base.title) body.title = current.title;
    if (current.ord !== base.ord) body.ord = current.ord;
    if (current.tipsReward !== base.tipsReward) body.tips_reward = current.tipsReward;
    if (current.archiveId !== base.archiveId) body.archive_id = current.archiveId;
    if (current.enabled !== base.enabled) body.enabled = current.enabled;
    // answer 读不到原值，只有显式填写时才提交
    const answer = String(current.answer ?? "").trim();
    if (answer) body.answer = answer;
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
        form.answer = "";
        emit("saved", data?.puzzle ?? null);
    } catch (error) {
        ElMessage.error(error?.message || "保存失败");
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

            <el-form-item label="答案">
                <el-input
                    v-model="form.answer"
                    maxlength="200"
                    show-word-limit
                    placeholder="仅用于核对，接口不回传原值"
                />
                <p class="tip">
                    答案只写不读：GET /admin/puzzles 不返回答案，所以这里永远是空的；
                    留空表示不修改，保存后输入框会清空。
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
