<script setup>
// iframe 来源 allowlist（admin-only）：出题台右侧「外链来源」页签。
//
// 保存外链题（kind=iframe）时后端要求 url 的 origin 在这份**启用**列表里，
// 不在 → 400 且 detail.fields 指向 malleable.url；存量题仍能正常加载（取题时回退原样 URL）。
// 删除是软删（status=2，不物理删），POST 同一 origin 即可恢复。
import { computed, getCurrentScope, onScopeDispose, ref, useId } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import {
    deleteIframeOrigin,
    listIframeOrigins,
    upsertIframeOrigin,
} from "@/api/pz";
import { cancelChannel, isStaleRequest, requestLatest } from "@/api/http";
import { describeApiError } from "@/api/errors";
import { normalizeIframeOrigin } from "@/utils/iframeOrigin";
import { pick } from "@/utils/format";

const rows = ref([]);
const loading = ref(false);

const dialog = ref(false);
const saving = ref(false);
const form = ref({ origin: "", note: "" });

const activeCount = computed(
    () => rows.value.filter((row) => row.status !== 2).length,
);

// 同一面板里只保留最新一次列表请求；实例级频道避免多实例互相 abort。
const abortKey = `pz-iframe-origins#${useId()}`;
if (getCurrentScope()) {
    onScopeDispose(() => cancelChannel(abortKey));
}

// 响应形状未在文档里定死：{ origins } / { items } / 数组都接受，字段兼容驼峰与下划线。
function normalizeRows(data) {
    const list = data?.origins ?? data?.items ?? (Array.isArray(data) ? data : []);
    return list.map((item) => ({
        id: pick(item, "id"),
        origin: String(pick(item, "origin") ?? ""),
        note: String(pick(item, "note") ?? ""),
        status: Number(pick(item, "status") ?? 1),
        updatedAt: pick(item, "updatedAt", "updated_at") ?? null,
    }));
}

async function load() {
    loading.value = true;
    try {
        const data = await requestLatest(abortKey, ({ signal }) =>
            listIframeOrigins({ signal }),
        );
        rows.value = normalizeRows(data);
        loading.value = false;
    } catch (error) {
        if (isStaleRequest(error)) return;
        loading.value = false;
        ElMessage.error(
            describeApiError(error, {
                fallback: "外链来源列表加载失败",
                forbidden: "只有 admin 能维护外链来源",
            }),
        );
    }
}

load();

function openCreate() {
    form.value = { origin: "", note: "" };
    dialog.value = true;
}

async function save() {
    if (saving.value) return;

    const origin = normalizeIframeOrigin(form.value.origin);
    if (!origin) {
        ElMessage.error("只支持 https://host[:port]，不要带路径、查询或片段");
        return;
    }

    saving.value = true;
    try {
        const note = String(form.value.note || "").trim();
        await upsertIframeOrigin({
            origin,
            ...(note ? { note } : {}),
            status: 1,
        });
        ElMessage.success(`已启用 ${origin}`);
        dialog.value = false;
        await load();
    } catch (error) {
        ElMessage.error(
            describeApiError(error, {
                fallback: "保存失败",
                forbidden: "只有 admin 能维护外链来源",
            }),
        );
    } finally {
        saving.value = false;
    }
}

async function restore(row) {
    try {
        await upsertIframeOrigin({
            origin: row.origin,
            ...(row.note ? { note: row.note } : {}),
            status: 1,
        });
        ElMessage.success(`已恢复 ${row.origin}`);
        await load();
    } catch (error) {
        ElMessage.error(
            describeApiError(error, {
                fallback: "恢复失败",
                forbidden: "只有 admin 能维护外链来源",
            }),
        );
    }
}

async function remove(row) {
    try {
        await ElMessageBox.confirm(
            `停用后，保存新的外链题不能再使用 ${row.origin}；已保存的题目不受影响，可随时恢复。`,
            "停用外链来源",
            { type: "warning", confirmButtonText: "停用", cancelButtonText: "取消" },
        );
    } catch {
        return;
    }

    try {
        await deleteIframeOrigin(row.id);
        ElMessage.success(`已停用 ${row.origin}`);
        await load();
    } catch (error) {
        ElMessage.error(
            describeApiError(error, {
                fallback: "停用失败",
                forbidden: "只有 admin 能维护外链来源",
            }),
        );
    }
}
</script>

<template>
    <div class="origins">
        <div class="origins__head">
            <span class="origins__count">
                启用 {{ activeCount }} / 共 {{ rows.length }}
            </span>
            <div class="origins__tools">
                <el-button size="small" :loading="loading" @click="load">
                    刷新
                </el-button>
                <el-button size="small" type="primary" @click="openCreate">
                    新增
                </el-button>
            </div>
        </div>

        <p class="tip">
            保存外链题时，地址的 origin 必须在这里且为启用状态，否则页面保存会返回
            400。只支持 <code>https://host[:port]</code>。
        </p>

        <div v-loading="loading" class="origins__list">
            <article
                v-for="row in rows"
                :key="row.id ?? row.origin"
                class="origins__row"
                :class="{ 'is-off': row.status === 2 }"
            >
                <div class="origins__main">
                    <span class="origins__origin">{{ row.origin }}</span>
                    <el-tag
                        size="small"
                        :type="row.status === 2 ? 'info' : 'success'"
                    >
                        {{ row.status === 2 ? "已停用" : "启用" }}
                    </el-tag>
                </div>
                <p v-if="row.note" class="origins__note">{{ row.note }}</p>
                <div class="origins__actions">
                    <el-button
                        v-if="row.status === 2"
                        size="small"
                        text
                        type="primary"
                        @click="restore(row)"
                    >
                        恢复
                    </el-button>
                    <el-button
                        v-else
                        size="small"
                        text
                        type="danger"
                        @click="remove(row)"
                    >
                        停用
                    </el-button>
                </div>
            </article>

            <el-empty
                v-if="!rows.length && !loading"
                description="还没有登记任何外链来源"
                :image-size="60"
            />
        </div>

        <el-dialog
            v-model="dialog"
            title="新增外链来源"
            width="480px"
            append-to-body
        >
            <el-form label-width="72px" @submit.prevent>
                <el-form-item label="origin" required>
                    <el-input
                        v-model="form.origin"
                        placeholder="https://example.com 或 https://example.com:8443"
                    />
                </el-form-item>
                <el-form-item label="备注">
                    <el-input
                        v-model="form.note"
                        maxlength="200"
                        show-word-limit
                        placeholder="可选，如「维护组 SCF」"
                    />
                </el-form-item>
            </el-form>
            <p class="tip">
                已存在同一 origin 时不会报错，会直接把它设为启用（幂等 upsert）。
            </p>
            <template #footer>
                <el-button @click="dialog = false">取消</el-button>
                <el-button type="primary" :loading="saving" @click="save">
                    保存
                </el-button>
            </template>
        </el-dialog>
    </div>
</template>

<style scoped>
.origins {
    display: flex;
    flex-direction: column;
    gap: 10px;
}

.origins__head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
}

.origins__count {
    font-size: 13px;
    color: var(--el-text-color-secondary);
}

.origins__tools {
    display: flex;
    gap: 6px;
}

.origins__list {
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-height: 120px;
}

.origins__row {
    padding: 8px 10px;
    border: 1px solid var(--el-border-color-lighter);
    border-radius: 4px;
    background: #fff;
}

.origins__row.is-off {
    background: #fafafa;
}

.origins__main {
    display: flex;
    align-items: center;
    gap: 8px;
}

.origins__origin {
    flex: 1;
    min-width: 0;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 12px;
    line-height: 1.5;
    color: var(--el-text-color-primary);
    word-break: break-all;
}

.origins__note {
    margin: 4px 0 0;
    font-size: 12px;
    color: var(--el-text-color-secondary);
    word-break: break-word;
}

.origins__actions {
    display: flex;
    justify-content: flex-end;
}

.origins__actions .el-button {
    padding: 2px 0;
}

.tip {
    margin: 0;
    font-size: 12px;
    line-height: 1.6;
    color: var(--el-text-color-secondary);
}
</style>
