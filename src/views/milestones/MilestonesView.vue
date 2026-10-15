<template>
  <div class="page-card">
    <div class="toolbar">
      <el-button @click="load">刷新</el-button>
      <el-button v-if="auth.isAdmin" type="primary" @click="openCreate">创建里程碑</el-button>
    </div>

    <el-table v-loading="loading" :data="milestones" border stripe>
      <el-table-column label="标识 key" min-width="140">
        <template #default="{ row }">{{ row.key || "—" }}</template>
      </el-table-column>
      <el-table-column label="标题" min-width="180">
        <template #default="{ row }">{{ row.title || "—" }}</template>
      </el-table-column>
      <el-table-column label="类型 kind" width="120">
        <template #default="{ row }">{{ row.kind || "—" }}</template>
      </el-table-column>
      <el-table-column label="提示点奖励" width="110">
        <template #default="{ row }">{{ row.tipsReward ?? "—" }}</template>
      </el-table-column>
    </el-table>

    <el-dialog v-model="createDialog.visible" title="创建里程碑" width="440px">
      <el-form label-width="100px">
        <el-form-item label="标识 key" required>
          <el-input v-model="createDialog.form.key" placeholder="如 first_blood" />
        </el-form-item>
        <el-form-item label="标题" required>
          <el-input v-model="createDialog.form.title" />
        </el-form-item>
        <el-form-item label="类型 kind">
          <el-input v-model="createDialog.form.kind" placeholder="如 count" />
        </el-form-item>
        <el-form-item label="提示点奖励">
          <el-input-number v-model="createDialog.form.tipsReward" :min="0" style="width: 100%" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="createDialog.visible = false">取消</el-button>
        <el-button type="primary" :loading="createDialog.loading" @click="submitCreate">创建</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { onMounted, reactive, ref } from "vue";
import { ElMessage } from "element-plus";
import { useAuthStore } from "@/stores/auth";
import { listMilestones, createMilestone } from "@/api/milestones";

const auth = useAuthStore();
const loading = ref(false);
const milestones = ref([]);

async function load() {
    loading.value = true;
    try {
        const data = await listMilestones();
        if (Array.isArray(data)) milestones.value = data;
        else milestones.value = data?.items || data?.milestones || [];
    } catch (err) {
        ElMessage.error(err.message);
    } finally {
        loading.value = false;
    }
}

const createDialog = reactive({
    visible: false,
    loading: false,
    form: { key: "", title: "", kind: "count", tipsReward: 0 },
});

function openCreate() {
    createDialog.form = { key: "", title: "", kind: "count", tipsReward: 0 };
    createDialog.visible = true;
}

async function submitCreate() {
    if (!createDialog.form.key.trim() || !createDialog.form.title.trim()) {
        ElMessage.warning("请填写标识与标题");
        return;
    }
    createDialog.loading = true;
    try {
        await createMilestone({
            key: createDialog.form.key.trim(),
            title: createDialog.form.title.trim(),
            kind: createDialog.form.kind.trim(),
            tipsReward: createDialog.form.tipsReward,
        });
        ElMessage.success("已创建");
        createDialog.visible = false;
        load();
    } catch (err) {
        ElMessage.error(err.message);
    } finally {
        createDialog.loading = false;
    }
}

onMounted(() => load());
</script>
