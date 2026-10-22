<script setup>
// 目录面板：列表 / 新建或更新（幂等 upsert）/ 删除。
// 目录下仍有题目时后端返回 409，这里把文案原样提示。
import { ref } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { deleteFolder, listFolders, upsertFolder } from "@/api/pz";
import UnlockForm from "@/components/pz/UnlockForm.vue";

const emit = defineEmits(["changed"]);

const folders = ref([]);
const loading = ref(false);

const dialog = ref(false);
const saving = ref(false);
const unlockRef = ref(null);
const form = ref(emptyForm());

function emptyForm() {
    return { key: "", title: "", ord: 0, enabled: true, unlock: { kind: "sequence" } };
}

async function load() {
    loading.value = true;
    try {
        const data = await listFolders();
        folders.value = data?.folders ?? [];
        emit("changed", folders.value);
    } catch (error) {
        ElMessage.error(error?.message || "目录列表加载失败");
    } finally {
        loading.value = false;
    }
}

load();

function openCreate() {
    form.value = emptyForm();
    dialog.value = true;
}

function openEdit(row) {
    form.value = {
        key: row.key,
        title: row.title,
        ord: row.ord ?? 0,
        enabled: row.enabled !== false,
        unlock: row.unlock ?? { kind: "sequence" },
    };
    dialog.value = true;
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
        });
        ElMessage.success("已保存");
        dialog.value = false;
        await load();
    } catch (error) {
        ElMessage.error(error?.message || "保存失败");
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
        ElMessage.error(error?.message || "删除失败");
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
            <el-table-column label="启用" width="70">
                <template #default="{ row }">
                    <el-tag :type="row.enabled ? 'success' : 'info'" size="small">
                        {{ row.enabled ? "是" : "否" }}
                    </el-tag>
                </template>
            </el-table-column>
            <el-table-column label="操作" width="120" fixed="right">
                <template #default="{ row }">
                    <el-button size="small" text type="primary" @click="openEdit(row)">
                        编辑
                    </el-button>
                    <el-button size="small" text type="danger" @click="remove(row)">
                        删除
                    </el-button>
                </template>
            </el-table-column>
        </el-table>

        <el-dialog v-model="dialog" title="目录" width="480px">
            <el-form label-width="80px" size="small">
                <el-form-item label="标识">
                    <el-input
                        v-model="form.key"
                        placeholder="如 wave1（建立后不要修改）"
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
</style>
