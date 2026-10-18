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

    <el-table v-loading="loading" :data="list" border stripe>
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
      <el-table-column label="操作" width="420" fixed="right">
        <template #default="{ row }">
          <template v-if="auth.isAdmin">
            <el-button
              size="small"
              text
              type="warning"
              :disabled="isDissolved(row)"
              @click="warnRow(row)"
            >
              警告
            </el-button>
            <el-button
              size="small"
              text
              type="primary"
              :disabled="isDissolved(row)"
              @click="renameRow(row)"
            >
              改名
            </el-button>
            <el-button
              v-if="!isBanned(row)"
              size="small"
              text
              type="danger"
              :disabled="isDissolved(row)"
              @click="openBan(row)"
            >
              封禁
            </el-button>
            <el-button v-else size="small" text type="success" @click="unbanRow(row)">
              解封
            </el-button>
            <el-button
              size="small"
              text
              type="danger"
              :disabled="isDissolved(row) || isBanned(row)"
              @click="dissolveRow(row)"
            >
              解散
            </el-button>
          </template>
          <!-- 队伍级禁言：只拦该队成员发信，与封禁（status=4）是两套处罚；
               已解散（1）没有主体、已封禁（4）后端会 409，禁言状态未知时操作可能覆盖原处罚 -->
          <el-button
            v-if="auth.can('moderation.mute')"
            size="small"
            text
            :disabled="Boolean(muteBlockedReason(row))"
            :type="muteRecord(row.id) ? 'success' : 'warning'"
            :title="muteBlockedReason(row)"
            @click="toggleMute(row)"
          >
            {{ muteRecord(row.id) ? "解除禁言" : "禁言" }}
          </el-button>
        </template>
      </el-table-column>
    </el-table>

    <PageNav :page="page" :has-more="hasMore" :loading="loading" @prev="prev" @next="next" />

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
import { onMounted, reactive, ref } from "vue";
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
import { useMuteActions } from "@/composables/useMuteActions";
import PageNav from "@/components/PageNav.vue";
import MuteDialog from "@/components/MuteDialog.vue";
import { fmtTime, TEAM_STATUS, TEAM_STATUS_OPTIONS, statusMeta } from "@/utils/format";

const auth = useAuthStore();
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
        ElMessage.success(
            data?.overwrote === "mute"
                ? "已封禁；原禁言已被本次封禁覆盖（解封后不恢复）"
                : "已封禁",
        );
        banDialog.visible = false;
        first();
        // 封禁会覆盖禁言，禁言列表需要跟着刷新
        refreshMutes();
    } catch (err) {
        ElMessage.error(err.message);
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
        first();
        refreshMutes();
    } catch (err) {
        ElMessage.error(err.message);
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
        ElMessage.error(err.message);
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
        ElMessage.error(err.message);
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
        ElMessage.error(err.message);
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
