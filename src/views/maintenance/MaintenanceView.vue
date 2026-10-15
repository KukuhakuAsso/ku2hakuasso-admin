<template>
  <div class="page-card">
    <el-alert
      v-if="!auth.isAdmin"
      type="warning"
      :closable="false"
      show-icon
      title="维护操作仅 admin 可用"
    />
    <template v-else>
      <el-card shadow="never" class="mb">
        <template #header>比赛开赛时间</template>
        <div class="row">
          <el-date-picker
            v-model="startAt"
            type="datetime"
            placeholder="设置官方开赛时间"
            style="width: 300px"
          />
          <el-button type="primary" :loading="startAtLoading" @click="submitStartAt">设置</el-button>
        </div>
      </el-card>

      <el-card shadow="never">
        <template #header>维护操作</template>
        <div class="row">
          <el-button type="warning" :loading="settleLoading" @click="runSettleTips">
            执行提示点结算
          </el-button>
          <el-button type="warning" :loading="recheckLoading" @click="runRecheck">
            重新检查里程碑
          </el-button>
        </div>
      </el-card>
    </template>
  </div>
</template>

<script setup>
import { ref } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { useAuthStore } from "@/stores/auth";
import { setContestStartAt, settleTips, recheckMilestones } from "@/api/maintenance";

const auth = useAuthStore();
const startAt = ref(null);
const startAtLoading = ref(false);
const settleLoading = ref(false);
const recheckLoading = ref(false);

async function submitStartAt() {
    if (!startAt.value) {
        ElMessage.warning("请选择开赛时间");
        return;
    }
    startAtLoading.value = true;
    try {
        await setContestStartAt({ start_at: new Date(startAt.value).toISOString() });
        ElMessage.success("已设置开赛时间");
    } catch (err) {
        ElMessage.error(err.message);
    } finally {
        startAtLoading.value = false;
    }
}

async function runSettleTips() {
    try {
        await ElMessageBox.confirm("确认执行提示点结算？", "确认", { type: "warning" });
    } catch {
        return;
    }
    settleLoading.value = true;
    try {
        await settleTips();
        ElMessage.success("结算完成");
    } catch (err) {
        ElMessage.error(err.message);
    } finally {
        settleLoading.value = false;
    }
}

async function runRecheck() {
    try {
        await ElMessageBox.confirm("确认重新检查里程碑？", "确认", { type: "warning" });
    } catch {
        return;
    }
    recheckLoading.value = true;
    try {
        await recheckMilestones();
        ElMessage.success("重查完成");
    } catch (err) {
        ElMessage.error(err.message);
    } finally {
        recheckLoading.value = false;
    }
}
</script>

<style scoped>
.mb {
    margin-bottom: 16px;
}
.row {
    display: flex;
    align-items: center;
    gap: 12px;
}
</style>
