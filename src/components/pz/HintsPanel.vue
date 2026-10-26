<script setup>
// 预置提示维护（api-10 §10.12）：整表保存，数组顺序即 ord。
//
// 与「提示工作台」（人工求提示的报价 / 答复）完全分开：这里只维护挂在这道题上的提示条目。
// 保存成功会让题目 page_rev +1，所以要把新 rev 回传给出题台。
import { ref, watch } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { getPuzzleHints, putPuzzleHints } from "@/api/pz";

const props = defineProps({
    puzzleKey: { type: String, required: true },
});
const emit = defineEmits(["saved"]);

const MAX_HINTS = 10;
const NAME_MAX = 40;
const CONTENT_MAX = 2000;
const COST_MAX = 1000000;

const loading = ref(false);
const saving = ref(false);
const rev = ref(0);
const hints = ref([]);
// 服务端当前的条数：保存时条数变少 = 删除（连带删购买记录且不退款），要二次确认
const serverCount = ref(0);

function toModel(list) {
    return (list ?? []).map((item) => ({
        id: item.id,
        name: item.name ?? "",
        content: item.content ?? "",
        cost: Number(item.cost ?? 0) || 0,
    }));
}

async function load() {
    if (!props.puzzleKey) return;
    loading.value = true;
    try {
        const data = await getPuzzleHints(props.puzzleKey);
        rev.value = data?.rev ?? 0;
        hints.value = toModel(data?.hints);
        serverCount.value = hints.value.length;
    } catch (error) {
        ElMessage.error(error?.message || "提示读取失败");
        hints.value = [];
        serverCount.value = 0;
    } finally {
        loading.value = false;
    }
}

watch(() => props.puzzleKey, load, { immediate: true });

function addHint() {
    if (hints.value.length >= MAX_HINTS) return;
    hints.value.push({ name: "", content: "", cost: 0 });
}

function removeHint(index) {
    hints.value.splice(index, 1);
}

function moveHint(index, offset) {
    const target = index + offset;
    if (target < 0 || target >= hints.value.length) return;
    const [item] = hints.value.splice(index, 1);
    hints.value.splice(target, 0, item);
}

// 前端先按 api-10 的约束自检，避免只拿到一个笼统的 400
function validate() {
    if (hints.value.length > MAX_HINTS) {
        return `每题最多 ${MAX_HINTS} 条提示`;
    }

    const seen = new Set();
    for (const [index, hint] of hints.value.entries()) {
        const label = `第 ${index + 1} 条提示`;
        const name = String(hint.name ?? "").trim();
        const content = String(hint.content ?? "").trim();
        if (!name || name.length > NAME_MAX) {
            return `${label}：名称需为 1–${NAME_MAX} 字`;
        }
        if (!content || content.length > CONTENT_MAX) {
            return `${label}：正文需为 1–${CONTENT_MAX} 字`;
        }
        const cost = Number(hint.cost);
        if (!Number.isInteger(cost) || cost < 0 || cost > COST_MAX) {
            return `${label}：价格需为 0–${COST_MAX} 的整数`;
        }
        if (hint.id != null) {
            if (seen.has(hint.id)) return `${label}：同一条提示被重复提交`;
            seen.add(hint.id);
        }
    }
    return "";
}

// 带 id = 改已有，不带 id = 新增；顺序即 ord
function payload() {
    return hints.value.map((hint) => {
        const item = {
            name: String(hint.name ?? "").trim(),
            content: String(hint.content ?? "").trim(),
            cost: Number(hint.cost) || 0,
        };
        if (hint.id != null) item.id = hint.id;
        return item;
    });
}

async function save() {
    if (saving.value) return;

    const message = validate();
    if (message) {
        ElMessage.error(message);
        return;
    }

    if (hints.value.length < serverCount.value) {
        const removed = serverCount.value - hints.value.length;
        try {
            await ElMessageBox.confirm(
                `本次保存会删除 ${removed} 条提示，已购买该提示的玩家不会被退款（tips 流水留痕）。确定继续吗？`,
                "确认删除提示",
                {
                    type: "warning",
                    confirmButtonText: "删除并保存",
                    cancelButtonText: "取消",
                },
            );
        } catch {
            return;
        }
    }

    saving.value = true;
    try {
        const data = await putPuzzleHints(props.puzzleKey, payload());
        rev.value = data?.rev ?? rev.value + 1;
        // 以服务端返回为准：新增的提示会拿到 id，ord 已按顺序重排
        hints.value = toModel(data?.hints);
        serverCount.value = hints.value.length;
        ElMessage.success(`已保存，rev ${rev.value}`);
        emit("saved", { key: props.puzzleKey, rev: rev.value });
    } catch (error) {
        ElMessage.error(error?.message || "提示保存失败");
    } finally {
        saving.value = false;
    }
}
</script>

<template>
    <div v-loading="loading" class="hints-panel">
        <div class="hints-panel__head">
            <span class="tip">
                rev {{ rev }} · {{ hints.length }}/{{ MAX_HINTS }} 条
            </span>
            <div>
                <el-button
                    size="small"
                    :disabled="hints.length >= MAX_HINTS"
                    @click="addHint"
                >
                    添加提示
                </el-button>
                <el-button
                    size="small"
                    type="primary"
                    :loading="saving"
                    @click="save"
                >
                    保存提示
                </el-button>
            </div>
        </div>

        <p class="tip">
            玩家只看到名称与价格；购买后正文全队可见（价格为 0 直接可见）。
            减少条数等于删除，已购买不退款。
        </p>

        <el-empty
            v-if="!hints.length"
            :image-size="56"
            description="这道题还没有预置提示"
        />

        <div
            v-for="(hint, index) in hints"
            :key="hint.id ?? `new-${index}`"
            class="hint-row"
        >
            <div class="hint-row__head">
                <span class="hint-row__index">{{ index + 1 }}</span>
                <el-input
                    v-model="hint.name"
                    size="small"
                    maxlength="40"
                    show-word-limit
                    placeholder="名称（未购买也可见）"
                />
            </div>

            <div class="hint-row__tools">
                <div class="hint-row__cost">
                    <span class="tip">价格</span>
                    <el-input-number
                        v-model="hint.cost"
                        size="small"
                        :min="0"
                        :max="1000000"
                        :step="1"
                        controls-position="right"
                        style="width: 124px"
                    />
                    <span class="tip">tips</span>
                </div>
                <div class="hint-row__actions">
                    <el-button size="small" text :disabled="index === 0" @click="moveHint(index, -1)">
                        上移
                    </el-button>
                    <el-button
                        size="small"
                        text
                        :disabled="index === hints.length - 1"
                        @click="moveHint(index, 1)"
                    >
                        下移
                    </el-button>
                    <el-button size="small" text type="danger" @click="removeHint(index)">
                        删除
                    </el-button>
                </div>
            </div>

            <el-input
                v-model="hint.content"
                type="textarea"
                :rows="3"
                maxlength="2000"
                show-word-limit
                placeholder="正文（纯文本，保留换行；玩家购买后看到）"
            />

            <span v-if="hint.id != null" class="tip">提示 id {{ hint.id }}</span>
        </div>
    </div>
</template>

<style scoped>
.hints-panel {
    display: flex;
    flex-direction: column;
    gap: 8px;
}

.hints-panel__head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
}

.tip {
    font-size: 12px;
    color: var(--el-text-color-secondary);
}

.hint-row {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px;
    border: 1px solid var(--el-border-color-lighter);
    border-radius: 4px;
    background: var(--el-fill-color-blank);
}

.hint-row__head {
    display: flex;
    align-items: center;
    gap: 6px;
}

.hint-row__index {
    flex: none;
    width: 18px;
    font-family: var(--el-font-family);
    font-size: 12px;
    color: var(--el-text-color-secondary);
    text-align: center;
}

.hint-row__tools {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
    flex-wrap: wrap;
}

.hint-row__cost {
    display: flex;
    align-items: center;
    gap: 4px;
}

.hint-row__actions {
    display: flex;
    gap: 2px;
}
</style>
