<template>
  <div class="page-card">
    <div class="toolbar">
      <el-button @click="load">刷新</el-button>
      <span class="tip">题库字段以接口返回为准；修改仅 admin 可用。</span>
    </div>

    <el-table v-loading="loading" :data="puzzles" border stripe>
      <el-table-column label="题号 key" min-width="120">
        <template #default="{ row }">{{ pick(row, "key") || "—" }}</template>
      </el-table-column>
      <el-table-column label="标题" min-width="160">
        <template #default="{ row }">{{ pick(row, "title") || "—" }}</template>
      </el-table-column>
      <el-table-column label="序号" width="80">
        <template #default="{ row }">{{ pick(row, "ord", "order") ?? "—" }}</template>
      </el-table-column>
      <el-table-column label="启用" width="90">
        <template #default="{ row }">
          <el-tag :type="pick(row, 'enabled') ? 'success' : 'info'" size="small">
            {{ pick(row, "enabled") ? "启用" : "停用" }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column v-if="auth.isAdmin" label="操作" width="100" fixed="right">
        <template #default="{ row }">
          <el-button size="small" text type="primary" @click="openEdit(row)">修改</el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-dialog v-model="editDialog.visible" :title="`修改题目 ${editDialog.key}`" width="520px">
      <el-form label-width="100px">
        <el-form-item v-for="f in editDialog.fields" :key="f.key" :label="f.key">
          <el-switch v-if="f.type === 'boolean'" v-model="editDialog.model[f.key]" />
          <el-input-number
            v-else-if="f.type === 'number'"
            v-model="editDialog.model[f.key]"
            style="width: 100%"
          />
          <el-input v-else v-model="editDialog.model[f.key]" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="editDialog.visible = false">取消</el-button>
        <el-button type="primary" :loading="editDialog.loading" @click="submitEdit">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { onMounted, reactive, ref } from "vue";
import { ElMessage } from "element-plus";
import { useAuthStore } from "@/stores/auth";
import { listPuzzles, putPuzzle } from "@/api/puzzles";
import { pick } from "@/utils/format";

const auth = useAuthStore();
const loading = ref(false);
const puzzles = ref([]);

async function load() {
    loading.value = true;
    try {
        const data = await listPuzzles();
        if (Array.isArray(data)) puzzles.value = data;
        else puzzles.value = data?.items || data?.puzzles || [];
    } catch (err) {
        ElMessage.error(err.message);
    } finally {
        loading.value = false;
    }
}

const editDialog = reactive({
    visible: false,
    loading: false,
    key: "",
    model: {},
    fields: [],
});

function openEdit(row) {
    const model = { ...row };
    const fields = Object.entries(model)
        .filter(([k]) => k !== "key" && k !== "id")
        .map(([k, v]) => ({
            key: k,
            type: typeof v === "boolean" ? "boolean" : typeof v === "number" ? "number" : "string",
        }));
    editDialog.key = pick(row, "key");
    editDialog.model = model;
    editDialog.fields = fields;
    editDialog.visible = true;
}

async function submitEdit() {
    editDialog.loading = true;
    try {
        const { key, ...body } = editDialog.model;
        await putPuzzle(editDialog.key, body);
        ElMessage.success("已保存");
        editDialog.visible = false;
        load();
    } catch (err) {
        ElMessage.error(err.message);
    } finally {
        editDialog.loading = false;
    }
}

onMounted(() => load());
</script>

<style scoped>
.tip {
    color: #909399;
    font-size: 12px;
}
</style>
