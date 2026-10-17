<template>
  <div class="page-card">
    <div class="filter-bar">
      <el-select v-model="filters.status" placeholder="状态（默认正常）" style="width: 160px">
        <el-option label="全部" :value="0" />
        <el-option label="正常" :value="1" />
        <el-option label="已解散" :value="2" />
        <el-option label="已封禁" :value="3" />
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
      <el-table-column label="操作" width="330" fixed="right">
        <template #default="{ row }">
          <template v-if="auth.isAdmin">
            <el-button size="small" text type="warning" :disabled="row.status === 2" @click="warnRow(row)">
              警告
            </el-button>
            <el-button size="small" text type="primary" @click="renameRow(row)">改名</el-button>
            <el-button
              v-if="row.status !== 3"
              size="small"
              text
              type="danger"
              :disabled="row.status === 2"
              @click="openBan(row)"
            >
              封禁
            </el-button>
            <el-button v-else size="small" text type="success" @click="unbanRow(row)">解封</el-button>
            <el-button
              size="small"
              text
              type="danger"
              :disabled="row.status !== 1"
              @click="dissolveRow(row)"
            >
              解散
            </el-button>
          </template>
        </template>
      </el-table-column>
    </el-table>

    <PageNav :page="page" :has-more="hasMore" :loading="loading" @prev="prev" @next="next" />

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
import PageNav from "@/components/PageNav.vue";
import { fmtTime, TEAM_STATUS, statusMeta } from "@/utils/format";

const auth = useAuthStore();
const filters = reactive({ status: 0 });

const fetcher = (cursor) => listTeams({ ...filters, cursor, limit: 50 });
const { list, page, hasMore, loading, first, next, prev } = useCursorPage(fetcher);

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
    if (!banDialog.reason.trim()) {
        ElMessage.warning("请填写封禁原因");
        return;
    }
    banDialog.loading = true;
    try {
        const until = banDialog.until ? new Date(banDialog.until).toISOString() : undefined;
        await banTeam(banDialog.row.id, { reason: banDialog.reason.trim(), ...(until ? { until } : {}) });
        ElMessage.success("已封禁");
        banDialog.visible = false;
        first();
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
        ElMessage.success("已解封");
        first();
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

onMounted(() => first());
</script>
