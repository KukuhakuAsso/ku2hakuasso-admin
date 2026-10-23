<script setup>
// 页面三方合并（base / 本地草稿 / 服务端），用于「服务端已更新，而本地还有未保存修改」时的取舍。
//
// 逐字段判定四态：
//   same     两边一致                → 不打扰，直接采用
//   local    只有本地改过            → 默认保留本地
//   remote   只有服务端改过          → 默认跟随服务端（本地本来就没动）
//   conflict 两边都改过且不一样      → 必须由用户选，默认保留本地（避免静默丢草稿）
// unlock 整块当原子字段：内部 kind/extra 互相约束，拆开合并会产出后端不接受的组合。
import { computed, ref, watch } from "vue";

const props = defineProps({
    modelValue: { type: Boolean, default: false },
    rev: { type: Number, default: 0 },
    // 三方都是 buildPayload() 的产物
    base: { type: Object, default: null },
    local: { type: Object, default: null },
    remote: { type: Object, default: null },
    // 用于把 assetId 显示成文件名
    media: { type: Array, default: () => [] },
});

const emit = defineEmits(["update:modelValue", "apply"]);

const FIELDS = [
    { key: "description", label: "描述" },
    { key: "cover", label: "封面" },
    { key: "malleable", label: "可塑区" },
    { key: "attachments", label: "附件" },
    { key: "folderKey", label: "所属目录" },
    { key: "unlock", label: "解锁规则" },
];

const perField = ref(false);
const choices = ref({});
const expanded = ref({});

const visible = computed({
    get: () => props.modelValue,
    set: (value) => emit("update:modelValue", value),
});

function pick(payload, key) {
    if (!payload) return null;
    if (key === "folderKey") return payload.folderKey ?? null;
    if (key === "unlock") return payload.unlock ?? { kind: "sequence" };
    return payload.page?.[key] ?? null;
}

const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

const rows = computed(() =>
    FIELDS.map((field) => {
        const base = pick(props.base, field.key);
        const local = pick(props.local, field.key);
        const remote = pick(props.remote, field.key);

        let status = "same";
        if (!same(local, remote)) {
            const localChanged = !same(local, base);
            const remoteChanged = !same(remote, base);
            if (localChanged && remoteChanged) status = "conflict";
            else if (localChanged) status = "local";
            else status = "remote";
        }

        return { ...field, base, local, remote, status };
    }),
);

// 有差异的字段（含冲突），用来决定要不要显示逐字段开关
const changedRows = computed(() => rows.value.filter((row) => row.status !== "same"));
const conflictRows = computed(() => rows.value.filter((row) => row.status === "conflict"));

// 打开时重置勾选：冲突默认「保留本地」，其余按「谁改了就取谁」
watch(
    () => props.modelValue,
    (open) => {
        if (!open) return;
        perField.value = false;
        expanded.value = {};
        const next = {};
        for (const row of changedRows.value) {
            next[row.key] = row.status === "remote" ? "remote" : "local";
        }
        choices.value = next;
    },
);

const STATUS_LABEL = {
    local: "仅本地改动",
    remote: "仅服务端改动",
    conflict: "两边都改了",
};

function mediaLabel(assetId) {
    if (!assetId) return "无";
    const hit = props.media.find((item) => item.id === assetId);
    return hit ? `#${assetId} ${hit.filename || ""}`.trim() : `#${assetId}`;
}

const UNLOCK_LABEL = {
    sequence: "顺序解锁（上一题答对）",
    always: "始终解锁",
    count: "已解数达到阈值",
    keys: "指定题目全部答对",
    handler: "服务端判定函数",
};

// 每个字段一句话摘要，够用户判断「要不要」即可，细节可展开
function summary(row, side) {
    const value = side === "local" ? row.local : row.remote;
    if (row.key === "description") {
        if (!value) return "（空）";
        const text = String(value).replace(/\s+/g, " ");
        return `${value.length} 字：${text.slice(0, 36)}${text.length > 36 ? "…" : ""}`;
    }
    if (row.key === "cover") {
        if (!value) return "无封面";
        const extra = value.progressAssetId
            ? `，完成态 ${mediaLabel(value.progressAssetId)}`
            : "";
        return `${mediaLabel(value.assetId)}（${value.ratio || "16:9"}）${extra}`;
    }
    if (row.key === "malleable") {
        if (!value) return "无可塑区";
        if (value.kind === "component") {
            return `组件 ${value.name}@${value.version}`;
        }
        if (value.kind === "iframe") return `外链 ${value.url}`;
        return value.kind || "无";
    }
    if (row.key === "attachments") {
        if (!value || !value.length) return "无附件";
        const names = value
            .slice(0, 2)
            .map((item) => item.name || item.type)
            .join("、");
        return value.length > 2 ? `${value.length} 条：${names}…` : `${value.length} 条：${names}`;
    }
    if (row.key === "folderKey") {
        return value || "未分组";
    }
    if (row.key === "unlock") {
        const kind = value?.kind || "sequence";
        const detail =
            kind === "count"
                ? ` ≥ ${value.min ?? 0}`
                : kind === "keys"
                  ? ` ${(value.keys ?? []).length} 题`
                  : kind === "handler"
                    ? ` ${value.name || ""}`
                    : "";
        return `${UNLOCK_LABEL[kind] || kind}${detail}`;
    }
    return String(value ?? "");
}

function chooseValue(row) {
    if (row.status === "same") return row.local;
    if (row.status === "local") return row.local;
    if (row.status === "remote") return row.remote;
    return choices.value[row.key] === "local" ? row.local : row.remote;
}

function mergedPayload() {
    const page = {};
    let folderKey = null;
    let unlock = { kind: "sequence" };

    for (const row of rows.value) {
        const value = chooseValue(row);
        if (row.key === "folderKey") folderKey = value ?? null;
        else if (row.key === "unlock") unlock = value ?? { kind: "sequence" };
        else if (value != null) page[row.key] = value;
    }

    return { folderKey, page, unlock };
}

function apply(mode) {
    if (mode === "merge") {
        emit("apply", { mode: "merge", payload: mergedPayload() });
    } else {
        emit("apply", { mode });
    }
    visible.value = false;
}
</script>

<template>
    <el-dialog
        v-model="visible"
        title="服务端已有更新"
        width="920px"
        top="6vh"
        append-to-body
        class="merge-dialog"
    >
        <p class="merge-dialog__lead">
            你还有未保存的修改，服务端已更新到 rev {{ rev }}。
            共 <strong>{{ changedRows.length }}</strong> 处有差异，其中
            <strong class="is-conflict">{{ conflictRows.length }}</strong> 处两边都改过。
        </p>

        <el-table :data="rows" size="small" border class="merge-dialog__table">
            <el-table-column label="字段" width="100">
                <template #default="{ row }">{{ row.label }}</template>
            </el-table-column>
            <el-table-column label="状态" width="110">
                <template #default="{ row }">
                    <el-tag v-if="row.status === 'same'" size="small" type="info">一致</el-tag>
                    <el-tag v-else-if="row.status === 'local'" size="small" type="success">
                        仅本地
                    </el-tag>
                    <el-tag v-else-if="row.status === 'remote'" size="small">仅服务端</el-tag>
                    <el-tag v-else size="small" type="danger">冲突</el-tag>
                </template>
            </el-table-column>
            <el-table-column label="我的草稿" min-width="220">
                <template #default="{ row }">
                    <span :class="{ 'is-changed': row.status === 'local' || row.status === 'conflict' }">
                        {{ summary(row, "local") }}
                    </span>
                </template>
            </el-table-column>
            <el-table-column label="服务端" min-width="220">
                <template #default="{ row }">
                    <span :class="{ 'is-changed': row.status === 'remote' || row.status === 'conflict' }">
                        {{ summary(row, "remote") }}
                    </span>
                </template>
            </el-table-column>
            <el-table-column label="采用" width="150">
                <template #default="{ row }">
                    <el-radio-group
                        v-if="perField && row.status !== 'same'"
                        v-model="choices[row.key]"
                        size="small"
                    >
                        <el-radio-button value="local">本地</el-radio-button>
                        <el-radio-button value="remote">服务端</el-radio-button>
                    </el-radio-group>
                    <span v-else-if="row.status === 'same'" class="merge-dialog__hint">—</span>
                    <span v-else class="merge-dialog__hint">
                        {{ row.status === 'remote' ? "服务端" : "本地" }}
                    </span>
                </template>
            </el-table-column>
            <el-table-column width="52">
                <template #default="{ row }">
                    <el-button
                        v-if="row.key === 'description' && row.status !== 'same'"
                        link
                        size="small"
                        @click="expanded.description = !expanded.description"
                    >
                        {{ expanded.description ? "收起" : "对照" }}
                    </el-button>
                </template>
            </el-table-column>
        </el-table>

        <div v-if="expanded.description" class="merge-dialog__text">
            <div>
                <h4>我的草稿</h4>
                <pre>{{ rows.find((r) => r.key === 'description')?.local || "（空）" }}</pre>
            </div>
            <div>
                <h4>服务端</h4>
                <pre>{{ rows.find((r) => r.key === 'description')?.remote || "（空）" }}</pre>
            </div>
        </div>

        <template #footer>
            <div class="merge-dialog__footer">
                <el-checkbox v-model="perField">逐字段选择</el-checkbox>
                <div>
                    <el-button @click="apply('local')">保留我的修改</el-button>
                    <el-button type="primary" @click="apply(perField ? 'merge' : 'remote')">
                        {{ perField ? "应用所选" : "载入服务端" }}
                    </el-button>
                </div>
            </div>
        </template>
    </el-dialog>
</template>

<style scoped>
.merge-dialog__lead {
    margin: 0 0 10px;
    font-size: 13px;
    line-height: 1.6;
    color: var(--el-text-color-regular);
}

.merge-dialog__lead .is-conflict {
    color: var(--el-color-danger);
}

.merge-dialog__table :deep(.el-table__cell) {
    vertical-align: top;
}

.merge-dialog__hint {
    font-size: 12px;
    color: var(--el-text-color-secondary);
}

.is-changed {
    font-weight: 600;
}

.merge-dialog__text {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
    margin-top: 10px;
}

.merge-dialog__text h4 {
    margin: 0 0 6px;
    font-size: 12px;
    color: var(--el-text-color-secondary);
}

.merge-dialog__text pre {
    max-height: 220px;
    margin: 0;
    padding: 8px 10px;
    overflow: auto;
    border: 1px solid var(--el-border-color-lighter);
    border-radius: 4px;
    background: var(--el-fill-color-lighter);
    font-size: 12px;
    line-height: 1.6;
    white-space: pre-wrap;
    word-break: break-word;
}

.merge-dialog__footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
}
</style>
