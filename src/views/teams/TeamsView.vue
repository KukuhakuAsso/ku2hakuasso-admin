<template>
  <div class="page-card">
    <div class="filter-bar">
      <el-select v-model="filters.status" placeholder="状态（默认全部）" style="width: 160px">
        <el-option
          v-for="opt in TEAM_STATUS_OPTIONS"
          :key="opt.value"
          :label="opt.label"
          :value="opt.value"
        />
      </el-select>
      <el-button type="primary" @click="search">查询</el-button>
      <el-button @click="reset">重置</el-button>
    </div>

    <p v-if="isMobile" class="mobile-hint">长按任意一行，查看该行的操作</p>

    <el-table
      ref="tableRef"
      v-loading="loading"
      :data="list"
      border
      stripe
      @row-contextmenu="onContextMenu"
    >
      <el-table-column label="ID" prop="id" width="80" />
      <el-table-column label="队名" min-width="140">
        <template #default="{ row }">{{ row.name || "—" }}</template>
      </el-table-column>
      <el-table-column label="队长ID" prop="captainId" width="90" />
      <el-table-column label="状态" width="100">
        <template #default="{ row }">
          <el-tag :type="statusMeta(row.status, TEAM_STATUS).type" size="small">
            {{ statusMeta(row.status, TEAM_STATUS).label }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="成员数" prop="memberCount" width="90" />
      <el-table-column label="解出" prop="solvedCount" width="80" />
      <el-table-column label="得分" prop="score" width="90" />
      <el-table-column label="封禁原因" min-width="140">
        <template #default="{ row }">{{ row.banReason || "—" }}</template>
      </el-table-column>
      <el-table-column label="封禁至" width="170">
        <template #default="{ row }">{{ fmtTime(row.banUntil) }}</template>
      </el-table-column>
      <el-table-column label="确认参赛" width="170">
        <template #default="{ row }">{{ fmtTime(row.confirmedAt) }}</template>
      </el-table-column>
      <el-table-column label="禁言" width="170">
        <template #default="{ row }">
          <template v-if="muteRecord(row.id)">
            <el-tag type="warning" size="small">
              {{ muteRecord(row.id).until ? "限时禁言" : "永久禁言" }}
            </el-tag>
            <div class="sub">{{ muteRecord(row.id).reason || "—" }}</div>
          </template>
          <!-- 列表被截断（>200 条生效禁言）且该行未能补齐：状态未知，不能当「未禁言」 -->
          <el-tag v-else-if="muteState(row.id) === 'unknown'" type="info" size="small">
            状态未知
          </el-tag>
          <span v-else>—</span>
        </template>
      </el-table-column>
      <el-table-column v-if="!isMobile" label="操作" width="420" fixed="right">
        <template #default="{ row }">
          <el-button
            v-for="action in rowActions(row)"
            :key="action.key"
            size="small"
            text
            :type="action.type"
            :disabled="action.disabled"
            :title="action.hint"
            @click="runRowAction(action.key, row)"
          >
            {{ action.label }}
          </el-button>
        </template>
      </el-table-column>
    </el-table>

    <PageNav :page="page" :has-more="hasMore" :loading="loading" @prev="prev" @next="next" />

    <!-- 手机端：操作列不渲染，长按行后从底部弹出同一份动作清单 -->
    <RowActionSheet
      v-model="actionSheetVisible"
      :title="actionSheetTitle"
      :actions="actionSheetActions"
      @select="onSheetSelect"
    />

    <MuteDialog
      v-model="muteDialog.visible"
      :target="muteDialog.target"
      @done="onMuteDone"
    />

    <!-- 封禁对话框 -->
    <el-dialog v-model="banDialog.visible" title="封禁队伍" width="420px">
      <el-form label-width="80px">
        <el-form-item label="原因" required>
          <el-input v-model="banDialog.reason" type="textarea" :rows="3" maxlength="200" show-word-limit />
        </el-form-item>
        <el-form-item label="封禁至">
          <el-date-picker
            v-model="banDialog.until"
            type="datetime"
            placeholder="留空为永久封禁"
            style="width: 100%"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="banDialog.visible = false">取消</el-button>
        <el-button type="danger" :loading="banDialog.loading" @click="submitBan">确认封禁</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { useAuthStore } from "@/stores/auth";
import {
    listTeams,
    warnTeam,
    banTeam,
    unbanTeam,
    renameTeam,
    dissolveTeam,
} from "@/api/teams";
import { useCursorPage } from "@/composables/useCursorPage";
import { useIsMobile } from "@/composables/useMediaQuery";
import { useRowLongPress } from "@/composables/useRowLongPress";
import { useMuteActions } from "@/composables/useMuteActions";
import { useWorkbenchBadges } from "@/composables/useWorkbenchBadges";
import PageNav from "@/components/PageNav.vue";
import RowActionSheet from "@/components/RowActionSheet.vue";
import MuteDialog from "@/components/MuteDialog.vue";
import { fmtTime, TEAM_STATUS, TEAM_STATUS_OPTIONS, statusMeta } from "@/utils/format";
import { extractErrorMessage } from "@/config/errors";

const auth = useAuthStore();
// 解封 = 处罚撤销：队伍会退出申诉工单的未办结集合，角标（open 数）要立刻减
const { refresh: refreshBadges } = useWorkbenchBadges();
const filters = reactive({ status: 0 });

const fetcher = (cursor) => listTeams({ ...filters, cursor, limit: 50 });
const { list, page, hasMore, loading, first, next, prev } = useCursorPage(fetcher);

// 队伍状态码与账号口径一致：1=已解散（读侧当不存在）、2=正常、3=禁言、4=封禁
const isDissolved = (row) => Number(row?.status) === 1;
const isBanned = (row) => Number(row?.status) === 4;

// 禁言 / 解除禁言（队伍级）：需要 moderation.mute 权限码。
// 禁言状态以 GET /admin/mutes（status=active）为准，前端不自己记账。
const {
    muteDialog,
    muteOf: muteRecord,
    muteState,
    openMute,
    unmute,
    refreshMutes,
} = useMuteActions("team", first, { rows: list });

function muteBlockedReason(row) {
    if (isDissolved(row)) return "已解散，无法禁言";
    if (isBanned(row)) return "已封禁，请先解封再禁言";
    if (muteState(row.id) === "unknown") {
        return "禁言状态未知（生效禁言超过 200 条），已禁用以免覆盖原处罚，请重新查询后再试";
    }
    return "";
}

// 禁言成功后列表与禁言状态都要刷新，否则刚禁言的队伍仍显示「禁言」
async function onMuteDone() {
    await Promise.all([first(), refreshMutes()]);
}

function toggleMute(row) {
    const label = row.name || `队伍 #${row.id}`;
    if (muteRecord(row.id)) {
        unmute(row, label);
    } else {
        openMute(row, label);
    }
}

// ---- 行操作：桌面端操作列与手机端长按面板共用同一份动作清单 ----
function rowActions(row) {
    const dissolved = isDissolved(row);
    const banned = isBanned(row);
    const muted = Boolean(muteRecord(row.id));
    const actions = [];
    if (auth.isAdmin) {
        actions.push({
            key: "warn",
            label: "警告",
            type: "warning",
            disabled: dissolved,
            hint: dissolved ? "已解散，无法操作" : "",
        });
        actions.push({
            key: "rename",
            label: "改名",
            type: "primary",
            disabled: dissolved,
            hint: dissolved ? "已解散，无法操作" : "",
        });
        actions.push(
            banned
                ? { key: "unban", label: "解封", type: "success" }
                : {
                      key: "ban",
                      label: "封禁",
                      type: "danger",
                      disabled: dissolved,
                      hint: dissolved ? "已解散，无法封禁" : "",
                  },
        );
        actions.push({
            key: "dissolve",
            label: "解散",
            type: "danger",
            disabled: dissolved || banned,
            hint: dissolved ? "已解散" : banned ? "已封禁，请先解封" : "",
        });
    }
    // 队伍级禁言：只拦该队成员发信，与封禁（status=4）是两套处罚；
    // 已解散（1）没有主体、已封禁（4）后端会 409，禁言状态未知时操作可能覆盖原处罚
    if (auth.can("moderation.mute")) {
        const reason = muteBlockedReason(row);
        actions.push({
            key: "mute",
            label: muted ? "解除禁言" : "禁言",
            type: muted ? "success" : "warning",
            disabled: Boolean(reason),
            hint: reason,
        });
    }
    return actions;
}

function runRowAction(key, row) {
    switch (key) {
        case "warn":
            return warnRow(row);
        case "rename":
            return renameRow(row);
        case "ban":
            return openBan(row);
        case "unban":
            return unbanRow(row);
        case "dissolve":
            return dissolveRow(row);
        case "mute":
            return toggleMute(row);
        default:
            return undefined;
    }
}

const isMobile = useIsMobile();
const tableRef = ref(null);
const actionSheetVisible = ref(false);

const { activeRow, onContextMenu } = useRowLongPress({
    tableRef,
    getRows: () => list.value,
    isMobile,
    onLongPress: () => {
        actionSheetVisible.value = true;
    },
});

const actionSheetActions = computed(() =>
    activeRow.value ? rowActions(activeRow.value) : [],
);

const actionSheetTitle = computed(() => {
    const row = activeRow.value;
    if (!row) return "";
    return row.name ? `${row.name}（#${row.id}）` : `队伍 #${row.id}`;
});

function onSheetSelect(key) {
    const row = activeRow.value;
    actionSheetVisible.value = false;
    if (row) runRowAction(key, row);
}

function search() {
    first();
}
function reset() {
    filters.status = 0;
    first();
}

const banDialog = reactive({ visible: false, reason: "", until: null, loading: false, row: null });

function openBan(row) {
    banDialog.row = row;
    banDialog.reason = "";
    banDialog.until = null;
    banDialog.visible = true;
}

async function submitBan() {
    const reason = banDialog.reason.trim();
    if (!reason) {
        ElMessage.warning("请填写封禁原因（1–200 字）");
        return;
    }
    if (banDialog.until && new Date(banDialog.until).getTime() <= Date.now()) {
        ElMessage.warning("封禁到期时间必须晚于当前时间");
        return;
    }
    banDialog.loading = true;
    try {
        const until = banDialog.until ? new Date(banDialog.until).toISOString() : null;
        const data = await banTeam(banDialog.row.id, { reason, until });
        banDialog.visible = false;
        // 队伍含 staff/admin 成员时后端按解散处理（banned:false + dissolved:true），
        // 不是封禁、也无法解封，不能提示「已封禁」。
        if (data?.dissolved) {
            ElMessage.warning("该队伍含 staff / admin 成员，已按解散处理，不能解封");
        } else {
            ElMessage.success(
                data?.overwrote === "mute"
                    ? "已封禁；原禁言已被本次封禁覆盖（解封后不恢复）"
                    : "已封禁",
            );
        }
        first();
        // 封禁会覆盖禁言，禁言列表需要跟着刷新
        refreshMutes();
    } catch (err) {
        ElMessage.error(extractErrorMessage(err));
    } finally {
        banDialog.loading = false;
    }
}

async function unbanRow(row) {
    try {
        await ElMessageBox.confirm("确认解除该队伍的封禁？", "解封确认", { type: "warning" });
    } catch {
        return;
    }
    try {
        await unbanTeam(row.id);
        ElMessage.success("已解封（被封禁覆盖的原禁言不会恢复）");
        void refreshBadges();
        first();
        refreshMutes();
    } catch (err) {
        ElMessage.error(extractErrorMessage(err));
    }
}

async function warnRow(row) {
    let value;
    try {
        const { value: v } = await ElMessageBox.prompt("警告将投递到该队会话", "警告队伍", {
            inputType: "textarea",
            inputPlaceholder: "请填写警告原因（1–200 字）",
            inputValidator: (s) => (s && s.trim().length >= 1 && s.trim().length <= 200) || "原因需为 1–200 字",
        });
        value = v;
    } catch {
        return;
    }
    try {
        await warnTeam(row.id, { reason: value.trim() });
        ElMessage.success("已警告");
        first();
    } catch (err) {
        ElMessage.error(extractErrorMessage(err));
    }
}

async function renameRow(row) {
    let value;
    try {
        const { value: v } = await ElMessageBox.prompt("与玩家用户名同一套字符规则", "强制改队名", {
            inputPlaceholder: "新队名（1–32 码点）",
            inputValidator: (s) => (s && s.trim().length >= 1 && s.trim().length <= 32) || "长度需为 1–32",
        });
        value = v;
    } catch {
        return;
    }
    try {
        await renameTeam(row.id, { name: value.trim() });
        ElMessage.success("已改队名");
        first();
    } catch (err) {
        ElMessage.error(extractErrorMessage(err));
    }
}

async function dissolveRow(row) {
    try {
        await ElMessageBox.confirm("解散后不可通过 API 还原，确认强制解散该队伍？", "解散确认", {
            type: "warning",
            confirmButtonText: "确认解散",
            confirmButtonClass: "el-button--danger",
        });
    } catch {
        return;
    }
    try {
        await dissolveTeam(row.id);
        ElMessage.success("已解散");
        first();
    } catch (err) {
        ElMessage.error(extractErrorMessage(err));
    }
}

onMounted(() => {
    first();
    // 禁言状态来自服务端列表（无 moderation.mute 时后端会 403，静默忽略）
    if (auth.can("moderation.mute")) {
        refreshMutes();
    }
});
</script>

<style scoped>
.sub {
    color: var(--el-text-color-secondary);
    font-size: 12px;
}
</style>
