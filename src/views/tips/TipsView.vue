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
          </el-descriptions>
          <div class="hint rule-note">
            人工提示价格在「站内信工作台」的求提示邮件里逐条报价，不再有全局单价。
          </div>
        </el-card>
      </el-col>

      <el-col :xs="24" :md="12">
        <el-card v-if="auth.isAdmin" shadow="never">
          <template #header>发放 / 扣减提示点（队伍级）</template>
          <el-form label-width="110px">
            <el-form-item label="队伍" required>
              <el-select
                v-model="grant.team_id"
                filterable
                clearable
                :loading="teamLoading"
                placeholder="搜索正常队伍（队名 / 编号）"
                style="width: 100%"
              >
                <el-option
                    v-for="item in grantTeams"
                  :key="item.id"
                  :label="teamLabel(item)"
                  :value="item.id"
                />
              </el-select>
              <div class="hint">
                只列正常队伍；已解散 / 已禁言 / 已封禁的队伍不可发放。
              </div>
            </el-form-item>
            <el-form-item label="变动量 delta" required>
              <el-input-number
                v-model="grant.delta"
                :precision="0"
                :step="10"
                style="width: 100%"
              />
              <div class="hint">非 0 整数，正数发放、负数扣减</div>
            </el-form-item>
            <el-form-item label="备注 note" required>
              <el-input v-model="grant.note" maxlength="200" show-word-limit />
            </el-form-item>
            <el-form-item label="幂等键">
              <div class="idem-row">
                <el-input
                  :model-value="grant.idem_key"
                  readonly
                  placeholder="提交时自动生成"
                />
                <el-button
                  v-if="grant.idem_key"
                  size="small"
                  text
                  @click="grant.idem_key = ''"
                >
                  换新键
                </el-button>
              </div>
              <div class="hint">
                自动生成：同一笔失败重试复用同一个键（服务端只生效一次），
                成功后自动重置；改动队伍 / 点数 / 备注会视为新的一笔。
              </div>
            </el-form-item>
            <el-form-item>
              <el-button type="primary" :loading="grant.loading" @click="submitGrant">
                执行
              </el-button>
            </el-form-item>
          </el-form>
        </el-card>
      </el-col>
    </el-row>

    <!-- 维护操作（原独立页面，仅 admin）：开赛时间 / 提示点结算 / 里程碑重查 -->
    <el-card v-if="auth.isAdmin" shadow="never" class="maintenance">
      <template #header>
        <div class="card-head">
          <span>维护操作</span>
          <span class="hint inline">仅 admin 可用，均记入审计且不可撤销</span>
        </div>
      </template>
      <el-form label-width="130px">
        <el-form-item label="比赛开赛时间">
          <div class="inline-row">
            <el-date-picker
              v-model="startAt"
              type="datetime"
              placeholder="设置官方开赛时间"
              style="width: 240px"
            />
            <el-button type="primary" :loading="startAtLoading" @click="submitStartAt">
              设置
            </el-button>
          </div>
          <div class="hint">写入后玩家侧立即可读到新的开赛时间；留空表示未设置。</div>
        </el-form-item>
        <el-form-item label="提示点结算">
          <el-button type="warning" :loading="settleLoading" @click="runSettleTips">
            执行提示点结算
          </el-button>
          <div class="hint">按当前规则结算全部队伍的可发放提示点。</div>
        </el-form-item>
        <el-form-item label="里程碑重查">
          <div class="inline-row">
            <el-select
              v-model="recheckTeamId"
              filterable
              clearable
              :loading="teamLoading"
              placeholder="选择要重查的队伍"
              style="width: 260px"
            >
              <el-option
                v-for="item in teamOptions"
                :key="`m-${item.id}`"
                :label="`${teamLabel(item)} · ${statusMeta(item.status, TEAM_STATUS).label}`"
                :value="item.id"
              />
            </el-select>
            <el-button
              type="warning"
              :loading="recheckLoading"
              :disabled="!recheckTeamId"
              @click="runRecheck"
            >
              重新检查里程碑
            </el-button>
          </div>
          <div class="hint">
            接口按队伍逐队重查（<code>team_id</code> 必填），完成后返回本次新增的里程碑。
          </div>
        </el-form-item>
      </el-form>
    </el-card>

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
import { computed, onMounted, reactive, ref, watch } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { useAuthStore } from "@/stores/auth";
import { grantTips, getTipsRule, putTipsRule } from "@/api/tips";
import {
    recheckMilestones,
    setContestStartAt,
    settleTips,
} from "@/api/maintenance";
import { listTeams } from "@/api/teams";
import { extractErrorMessage } from "@/api/errors";
import { fmtTime, TEAM_STATUS, statusMeta } from "@/utils/format";

const auth = useAuthStore();

const rule = ref(null);
const ruleLoading = ref(false);

async function loadRule() {
    ruleLoading.value = true;
    try {
        const data = await getTipsRule();
        rule.value = data?.rule || data;
    } catch (err) {
        ElMessage.error(extractErrorMessage(err));
    } finally {
        ruleLoading.value = false;
    }
}

const grant = reactive({ team_id: null, delta: 0, note: "", idem_key: "", loading: false });

// 队伍下拉：翻到 hasMore=false 为止把队伍全部载入，下拉做本地过滤；
// 游标去重 + 计数上限只用于防异常死循环，不会因为队伍多就截断
//（旧版固定 5 页会漏掉第 500 个之后的队伍）。
//
// 这里取「全部队伍」（不带 status）：里程碑重查要能选到禁言 / 封禁中的队伍；
// 发放提示点只允许正常队伍，用 grantTeams 在前端过滤（与原先 status=2 的口径一致）。
const TEAM_PAGE_LIMIT = 100;
const MAX_TEAM_PAGES = 1000;
const teamOptions = ref([]);
const teamLoading = ref(false);

const teamLabel = (item) => `${item.name || "（未命名）"}（#${item.id}）`;

// 发放 / 扣减只允许正常队伍（status=2）；已解散 / 禁言 / 封禁都不参与
const grantTeams = computed(() =>
    teamOptions.value.filter((item) => Number(item.status) === 2),
);

async function loadTeams() {
    teamLoading.value = true;
    try {
        const items = [];
        const seenIds = new Set();
        const seenCursors = new Set();
        let cursor;
        for (let page = 0; page < MAX_TEAM_PAGES; page += 1) {
            const data = await listTeams({
                cursor,
                limit: TEAM_PAGE_LIMIT,
            });
            for (const item of data?.items || []) {
                if (seenIds.has(item.id)) continue;
                seenIds.add(item.id);
                items.push(item);
            }
            if (!data?.hasMore || !data?.nextCursor) break;
            // 游标没有前进就停，避免服务端异常时死循环
            if (seenCursors.has(data.nextCursor)) break;
            seenCursors.add(data.nextCursor);
            cursor = data.nextCursor;
        }
        teamOptions.value = items;
    } catch (err) {
        ElMessage.error(extractErrorMessage(err));
    } finally {
        teamLoading.value = false;
    }
}

// 幂等键：只代表「这一笔」。队伍 / 点数 / 备注一变就是新的一笔，键要作废；
// 失败重试时保持同一个键（服务端据此只生效一次）。
watch(
    () => [grant.team_id, grant.delta, grant.note],
    () => {
        grant.idem_key = "";
    },
);

function makeIdemKey(teamId) {
    const rand = Math.random().toString(36).slice(2, 10);
    return `grant-${teamId}-${Date.now().toString(36)}-${rand}`;
}

async function submitGrant() {
    if (!grant.team_id) {
        ElMessage.warning("请选择队伍");
        return;
    }
    if (!Number.isInteger(grant.delta) || grant.delta === 0) {
        ElMessage.warning("变动量必须是非 0 整数");
        return;
    }
    if (!grant.note.trim()) {
        ElMessage.warning("请填写备注");
        return;
    }

    const team = grantTeams.value.find((item) => item.id === grant.team_id);
    if (Math.abs(grant.delta) >= 1000) {
        try {
            await ElMessageBox.confirm(
                `确认给「${teamLabel(team || { id: grant.team_id })}」${
                    grant.delta > 0 ? "发放" : "扣减"
                } ${Math.abs(grant.delta)} 点？该操作会记入审计且不可撤销。`,
                "大额变动确认",
                { type: "warning" },
            );
        } catch {
            return;
        }
    }

    if (!grant.idem_key) grant.idem_key = makeIdemKey(grant.team_id);

    grant.loading = true;
    try {
        const data = await grantTips({
            team_id: grant.team_id,
            delta: grant.delta,
            note: grant.note.trim(),
            idem_key: grant.idem_key,
        });
        ElMessage.success(`执行成功，当前余额：${data?.balance ?? "—"}`);
        if (data?.idempotent) {
            ElMessage.warning("幂等命中，未重复生效");
        }
        // 这一笔已完成，下一笔必须用新键
        grant.idem_key = "";
    } catch (err) {
        // 失败时保留幂等键：可能是响应丢了而服务端已落库，重试同一笔不会重复发放
        ElMessage.error(extractErrorMessage(err));
    } finally {
        grant.loading = false;
    }
}

const editDialog = reactive({
    visible: false,
    loading: false,
    form: { rate_per_hour: 20, daily_cap: 480, idle_decay_pct: 0, name: "" },
});

function openEditRule() {
    editDialog.form = {
        rate_per_hour: rule.value?.rate_per_hour ?? 20,
        daily_cap: rule.value?.daily_cap ?? 480,
        idle_decay_pct: rule.value?.idle_decay_pct ?? 0,
        name: rule.value?.name || "",
    };
    editDialog.visible = true;
}

async function submitEditRule() {
    editDialog.loading = true;
    try {
        // hint_cost 已废弃（2026-10-14）：PUT 不再接受，也不再下发
        const data = await putTipsRule({
            name: editDialog.form.name,
            rate_per_hour: editDialog.form.rate_per_hour,
            daily_cap: editDialog.form.daily_cap,
            idle_decay_pct: editDialog.form.idle_decay_pct,
        });
        rule.value = data?.rule || data;
        ElMessage.success("规则已更新（立即生效）");
        editDialog.visible = false;
    } catch (err) {
        ElMessage.error(extractErrorMessage(err));
    } finally {
        editDialog.loading = false;
    }
}

// ---- 维护操作（原独立页面，仅 admin） ----
const startAt = ref(null);
const startAtLoading = ref(false);
const settleLoading = ref(false);
const recheckLoading = ref(false);
const recheckTeamId = ref(null);

async function submitStartAt() {
    if (!startAt.value) {
        ElMessage.warning("请选择开赛时间");
        return;
    }
    startAtLoading.value = true;
    try {
        const data = await setContestStartAt({
            start_at: new Date(startAt.value).toISOString(),
        });
        const at = data?.startAt ? fmtTime(data.startAt) : "已更新";
        ElMessage.success(`已设置开赛时间：${at}`);
    } catch (err) {
        ElMessage.error(extractErrorMessage(err));
    } finally {
        startAtLoading.value = false;
    }
}

async function runSettleTips() {
    try {
        await ElMessageBox.confirm(
            "确认执行提示点结算？该操作会按当前规则结算全部队伍，并记入审计。",
            "执行提示点结算",
            { type: "warning", confirmButtonText: "执行结算" },
        );
    } catch {
        return;
    }
    settleLoading.value = true;
    try {
        const data = await settleTips();
        const settled = Number(data?.settled ?? 0);
        const batches = Number(data?.batches ?? 0);
        ElMessage.success(`结算完成：${settled} 个队伍 / ${batches} 批`);
    } catch (err) {
        ElMessage.error(extractErrorMessage(err));
    } finally {
        settleLoading.value = false;
    }
}

async function runRecheck() {
    // 接口要求 team_id 必填（按队伍逐队重查）
    const teamId = recheckTeamId.value;
    if (!teamId) {
        ElMessage.warning("请选择要重查的队伍");
        return;
    }
    const team = teamOptions.value.find((item) => item.id === teamId);
    try {
        await ElMessageBox.confirm(
            `确认重新检查「${teamLabel(team || { id: teamId })}」的里程碑？`,
            "重新检查里程碑",
            { type: "warning", confirmButtonText: "开始重查" },
        );
    } catch {
        return;
    }
    recheckLoading.value = true;
    try {
        const data = await recheckMilestones({ team_id: teamId });
        const list = Array.isArray(data?.newMilestones) ? data.newMilestones : [];
        ElMessage.success(
            list.length ? `重查完成：新增 ${list.length} 个里程碑` : "重查完成：没有新增里程碑",
        );
    } catch (err) {
        ElMessage.error(extractErrorMessage(err));
    } finally {
        recheckLoading.value = false;
    }
}

onMounted(() => {
    loadRule();
    if (auth.isAdmin) loadTeams();
});
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
.rule-note {
    margin-top: 12px;
}
.idem-row {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
}
.maintenance {
    margin-top: 16px;
}
.inline-row {
    display: flex;
    align-items: center;
    gap: 12px;
    width: 100%;
}
.hint.inline {
    width: auto;
    margin: 0;
}
.maintenance code {
    padding: 0 4px;
    background: var(--el-fill-color-light);
    border-radius: 3px;
}
</style>
