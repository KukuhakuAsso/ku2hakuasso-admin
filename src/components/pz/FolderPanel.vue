<script setup>
// 目录面板：列表 / 新建或更新（幂等 upsert）/ 删除。
// 目录下仍有题目时后端返回 409，这里把文案原样提示。
//
// 2026-11-05 起按目录所有人隔离：staff 只看到、只改得了自己的目录；
// owner_id 只有 admin 能传（staff 传 → 403），历史目录 ownerId=null 时仅 admin 可看/可改。
import { computed, getCurrentScope, onScopeDispose, ref } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { deleteFolder, listFolders, upsertFolder } from "@/api/pz";
import { listAuthorCandidates } from "@/api/accounts";
import { cancelChannel, isStaleRequest, requestLatest } from "@/api/http";
import { useAuthStore } from "@/stores/auth";
import { describeApiError } from "@/api/errors";
import UnlockForm from "@/components/pz/UnlockForm.vue";

const emit = defineEmits(["changed"]);

const auth = useAuthStore();
const canAssignOwner = computed(() => auth.isAdmin);

const folders = ref([]);
const loading = ref(false);
const ownerOptions = ref([]);
const ownerLoading = ref(false);

const dialog = ref(false);
const saving = ref(false);
const editingKey = ref("");
const unlockRef = ref(null);
const form = ref(emptyForm());

function emptyForm() {
    return {
        key: "",
        title: "",
        ord: 0,
        enabled: true,
        unlock: { kind: "sequence" },
        ownerId: null,
    };
}

// 列表是全局的（不按题/目录分片），所以只要「同一面板里最新一次生效」：
// 连点刷新、或保存后自动刷新与手动刷新撞在一起时，旧结果不会盖掉新结果。
let panelSeed = 0;
const abortKey = `pz-folders#${++panelSeed}`;
if (getCurrentScope()) {
    onScopeDispose(() => cancelChannel(abortKey));
}

async function load() {
    loading.value = true;
    try {
        const data = await requestLatest(abortKey, ({ signal }) =>
            listFolders({ signal }),
        );
        folders.value = data?.folders ?? [];
        emit("changed", folders.value);
        loading.value = false;
    } catch (error) {
        // 被更新的一次取代：保留它写好的列表，loading 留给那一次收尾
        if (isStaleRequest(error)) return;
        loading.value = false;
        ElMessage.error(
            describeApiError(error, {
                fallback: "目录列表加载失败",
                forbidden: "没有出题权限，请联系 admin 授予 pz.content.edit",
            }),
        );
    }
}

load();

async function loadOwnerOptions() {
    if (!canAssignOwner.value || ownerOptions.value.length || ownerLoading.value) {
        return;
    }
    ownerLoading.value = true;
    try {
        ownerOptions.value = await listAuthorCandidates();
    } catch (error) {
        ElMessage.error(
            describeApiError(error, { fallback: "所有人候选加载失败" }),
        );
    } finally {
        ownerLoading.value = false;
    }
}

function openCreate() {
    editingKey.value = "";
    form.value = emptyForm();
    dialog.value = true;
    loadOwnerOptions();
}

function openEdit(row) {
    editingKey.value = row.key;
    form.value = {
        key: row.key,
        title: row.title,
        ord: row.ord ?? 0,
        enabled: row.enabled !== false,
        unlock: row.unlock ?? { kind: "sequence" },
        ownerId: row.ownerId ?? null,
    };
    dialog.value = true;
    loadOwnerOptions();
}

async function save() {
    const key = String(form.value.key || "").trim();
    const title = String(form.value.title || "").trim();
    if (!/^[a-z][a-z0-9_]{2,31}$/.test(key)) {
        ElMessage.error("目录标识需为小写字母开头，仅含小写字母/数字/下划线，3–32 位");
        return;
    }
    if (!title) {
        ElMessage.error("目录名不能为空");
        return;
    }

    saving.value = true;
    try {
        await upsertFolder({
            key,
            title,
            ord: Number(form.value.ord) || 0,
            enabled: form.value.enabled,
            unlock: unlockRef.value?.toUnlock?.() ?? { kind: "sequence" },
            // 只有 admin 能改派；staff 传 owner_id 会被后端 403
            ownerId:
                canAssignOwner.value && form.value.ownerId
                    ? Number(form.value.ownerId)
                    : undefined,
        });
        ElMessage.success("已保存");
        dialog.value = false;
        await load();
    } catch (error) {
        ElMessage.error(
            describeApiError(error, {
                fallback: "保存失败",
                forbidden: "只能修改自己的目录；改派所有人需要 admin",
            }),
        );
    } finally {
        saving.value = false;
    }
}

async function remove(row) {
    try {
        await ElMessageBox.confirm(
            `删除目录「${row.title}」？目录下若仍有题目会被拒绝。`,
            "确认删除",
            { type: "warning" },
        );
    } catch {
        return;
    }

    try {
        await deleteFolder(row.key);
        ElMessage.success("已删除");
        await load();
    } catch (error) {
        ElMessage.error(
            describeApiError(error, {
                fallback: "删除失败",
                forbidden: "只能删除自己的目录",
            }),
        );
    }
}

defineExpose({ reload: load, folders });
</script>

<template>
    <div class="folder-panel">
        <div class="folder-panel__head">
            <el-button size="small" type="primary" @click="openCreate">新建目录</el-button>
            <el-button size="small" :loading="loading" @click="load">刷新</el-button>
        </div>

        <el-table v-loading="loading" :data="folders" size="small" border>
            <el-table-column prop="key" label="标识" min-width="110" />
            <el-table-column prop="title" label="名称" min-width="120" />
            <el-table-column prop="ord" label="排序" width="70" />
            <el-table-column v-if="canAssignOwner" label="所有人" min-width="120">
                <template #default="{ row }">
                    {{ row.ownerUsername || (row.ownerId ? `#${row.ownerId}` : "—") }}
                </template>
            </el-table-column>
            <el-table-column label="启用" width="70">
                <template #default="{ row }">
                    <el-tag :type="row.enabled ? 'success' : 'info'" size="small">
                        {{ row.enabled ? "是" : "否" }}
                    </el-tag>
                </template>
            </el-table-column>
            <el-table-column label="操作" width="130" fixed="right">
                <template #default="{ row }">
                    <!-- 用 flex + gap 排一行：默认的 el-button + el-button 会带 12px 左边距，
                         再叠上两个按钮自身的 padding 就会超出 120px 被挤成两行 -->
                    <div class="row-actions">
                        <el-button size="small" text type="primary" @click="openEdit(row)">
                            编辑
                        </el-button>
                        <el-button size="small" text type="danger" @click="remove(row)">
                            删除
                        </el-button>
                    </div>
                </template>
            </el-table-column>
        </el-table>

        <!-- destroy-on-close：关闭即销毁内容。否则取消后再打开同一目录时，
             form.unlock 仍是同一个对象引用，UnlockForm 的 watch 不触发，
             会沿用上一轮被取消的规则，最后被静默保存。 -->
        <el-dialog v-model="dialog" title="目录" width="480px" destroy-on-close>
            <el-form label-width="80px" size="small">
                <el-form-item label="标识">
                    <el-input
                        v-model="form.key"
                        placeholder="如 wave1（建立后不要修改）"
                        :disabled="Boolean(editingKey)"
                    />
                </el-form-item>
                <el-form-item label="名称">
                    <el-input v-model="form.title" placeholder="如 第一夜" />
                </el-form-item>
                <el-form-item label="排序">
                    <el-input-number v-model="form.ord" :min="0" :max="100000" />
                </el-form-item>
                <el-form-item label="启用">
                    <el-switch v-model="form.enabled" />
                </el-form-item>
                <!-- 仅 admin：改派目录所有人（POST body 的 owner_id） -->
                <el-form-item v-if="canAssignOwner" label="所有人">
                    <el-select
                        v-model="form.ownerId"
                        filterable
                        clearable
                        :loading="ownerLoading"
                        placeholder="保持原所有人"
                        style="width: 100%"
                        @focus="loadOwnerOptions"
                    >
                        <el-option
                            v-for="item in ownerOptions"
                            :key="item.id"
                            :label="`${item.label}（${item.role}）`"
                            :value="item.id"
                        />
                    </el-select>
                </el-form-item>
            </el-form>
            <UnlockForm ref="unlockRef" :model-value="form.unlock" />
            <template #footer>
                <el-button @click="dialog = false">取消</el-button>
                <el-button type="primary" :loading="saving" @click="save">保存</el-button>
            </template>
        </el-dialog>
    </div>
</template>

<style scoped>
.folder-panel__head {
    display: flex;
    gap: 8px;
    margin-bottom: 10px;
}
/* 单元格内的操作按钮：不允许换行，间距统一由 gap 控制 */
.row-actions {
    display: flex;
    align-items: center;
    gap: 8px;
    white-space: nowrap;
}
.row-actions :deep(.el-button) {
    margin-left: 0;
    padding: 0;
}
</style>
