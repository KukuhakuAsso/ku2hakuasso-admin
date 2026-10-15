<template>
  <div class="page-card">
    <el-row :gutter="16">
      <el-col :xs="24" :md="12">
        <el-card shadow="never">
          <template #header>
            <div class="card-head">
              <span>提示规则</span>
              <el-button v-if="auth.isAdmin" size="small" type="primary" @click="openEditRule">修改</el-button>
            </div>
          </template>
          <el-skeleton v-if="ruleLoading" :rows="5" animated />
          <el-descriptions v-else-if="rule" :column="1" border size="small">
            <el-descriptions-item label="规则名称">{{ rule.name || "—" }}</el-descriptions-item>
            <el-descriptions-item label="每小时速率">{{ rule.rate_per_hour }}</el-descriptions-item>
            <el-descriptions-item label="每日上限">{{ rule.daily_cap }}</el-descriptions-item>
            <el-descriptions-item label="闲置衰减(%)">{{ rule.idle_decay_pct ?? 0 }}</el-descriptions-item>
            <el-descriptions-item label="人工提示单价 hint_cost">{{ rule.hint_cost ?? 1 }}</el-descriptions-item>
          </el-descriptions>
        </el-card>
      </el-col>

      <el-col :xs="24" :md="12">
        <el-card v-if="auth.isAdmin" shadow="never">
          <template #header>发放 / 扣减提示点（队伍级）</template>
          <el-form label-width="110px">
            <el-form-item label="队伍ID" required>
              <el-input-number v-model="grant.team_id" :min="1" style="width: 100%" />
            </el-form-item>
            <el-form-item label="变动量 delta" required>
              <el-input-number v-model="grant.delta" style="width: 100%" />
              <div class="hint">正数发放、负数扣减</div>
            </el-form-item>
            <el-form-item label="备注 note" required>
              <el-input v-model="grant.note" maxlength="200" show-word-limit />
            </el-form-item>
            <el-form-item label="幂等键">
              <el-input v-model="grant.idem_key" placeholder="可选，强烈建议填写" />
            </el-form-item>
            <el-form-item>
              <el-button type="primary" :loading="grant.loading" @click="submitGrant">执行</el-button>
            </el-form-item>
          </el-form>
        </el-card>
      </el-col>
    </el-row>

    <el-dialog v-model="editDialog.visible" title="修改提示规则" width="440px">
      <el-form label-width="120px">
        <el-form-item label="每小时速率" required>
          <el-input-number v-model="editDialog.form.rate_per_hour" :min="0" style="width: 100%" />
        </el-form-item>
        <el-form-item label="每日上限" required>
          <el-input-number v-model="editDialog.form.daily_cap" :min="0" style="width: 100%" />
        </el-form-item>
        <el-form-item label="闲置衰减(%)">
          <el-input-number v-model="editDialog.form.idle_decay_pct" :min="0" :max="100" style="width: 100%" />
        </el-form-item>
        <el-form-item label="提示单价">
          <el-input-number v-model="editDialog.form.hint_cost" :min="0" :max="1000000" style="width: 100%" />
        </el-form-item>
        <el-form-item label="规则名称">
          <el-input v-model="editDialog.form.name" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="editDialog.visible = false">取消</el-button>
        <el-button type="primary" :loading="editDialog.loading" @click="submitEditRule">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { onMounted, reactive, ref } from "vue";
import { ElMessage } from "element-plus";
import { useAuthStore } from "@/stores/auth";
import { grantTips, getTipsRule, putTipsRule } from "@/api/tips";

const auth = useAuthStore();

const rule = ref(null);
const ruleLoading = ref(false);

async function loadRule() {
    ruleLoading.value = true;
    try {
        const data = await getTipsRule();
        rule.value = data?.rule || data;
    } catch (err) {
        ElMessage.error(err.message);
    } finally {
        ruleLoading.value = false;
    }
}

const grant = reactive({ team_id: null, delta: 0, note: "", idem_key: "", loading: false });

async function submitGrant() {
    if (!grant.team_id) {
        ElMessage.warning("请填写队伍ID");
        return;
    }
    if (!grant.note.trim()) {
        ElMessage.warning("请填写备注");
        return;
    }
    grant.loading = true;
    try {
        const data = await grantTips({
            team_id: grant.team_id,
            delta: grant.delta,
            note: grant.note.trim(),
            ...(grant.idem_key ? { idem_key: grant.idem_key } : {}),
        });
        ElMessage.success(`执行成功，当前余额：${data?.balance ?? "—"}`);
    } catch (err) {
        ElMessage.error(err.message);
    } finally {
        grant.loading = false;
    }
}

const editDialog = reactive({
    visible: false,
    loading: false,
    form: { rate_per_hour: 20, daily_cap: 480, idle_decay_pct: 0, hint_cost: 1, name: "" },
});

function openEditRule() {
    editDialog.form = {
        rate_per_hour: rule.value?.rate_per_hour ?? 20,
        daily_cap: rule.value?.daily_cap ?? 480,
        idle_decay_pct: rule.value?.idle_decay_pct ?? 0,
        hint_cost: rule.value?.hint_cost ?? 1,
        name: rule.value?.name || "",
    };
    editDialog.visible = true;
}

async function submitEditRule() {
    editDialog.loading = true;
    try {
        const data = await putTipsRule(editDialog.form);
        rule.value = data?.rule || data;
        ElMessage.success("规则已更新（立即生效）");
        editDialog.visible = false;
    } catch (err) {
        ElMessage.error(err.message);
    } finally {
        editDialog.loading = false;
    }
}

onMounted(() => loadRule());
</script>

<style scoped>
.card-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
}
.hint {
    font-size: 12px;
    color: #909399;
    width: 100%;
}
</style>
