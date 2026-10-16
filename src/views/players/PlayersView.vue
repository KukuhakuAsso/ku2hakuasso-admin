<template>
  <div class="page-card">
    <div class="filter-bar">
      <el-input
        v-model="filters.keyword"
        placeholder="用户名 / 编号 / 邮箱"
        style="width: 220px"
        clearable
        @keyup.enter="search"
      />
      <el-select v-model="filters.status" placeholder="状态" style="width: 140px" clearable>
        <el-option label="正常" :value="2" />
        <el-option label="已封禁" :value="4" />
      </el-select>
      <el-select v-model="filters.role" placeholder="角色" style="width: 140px" clearable>
        <el-option label="player" value="player" />
        <el-option label="staff" value="staff" />
        <el-option label="admin" value="admin" />
      </el-select>
      <el-button type="primary" @click="search">查询</el-button>
      <el-button @click="reset">重置</el-button>
    </div>

    <el-table v-loading="loading" :data="list" border stripe>
      <el-table-column label="ID" prop="id" width="80" />
      <el-table-column label="玩家编号" width="130">
        <template #default="{ row }">{{ pick(row, "playerNo", "player_no") || "—" }}</template>
      </el-table-column>
      <el-table-column label="用户名" min-width="140">
        <template #default="{ row }">{{ pick(row, "username") || "—" }}</template>
      </el-table-column>
      <el-table-column label="曾用名" min-width="120">
        <template #default="{ row }">{{ pick(row, "previousUsername") || "—" }}</template>
      </el-table-column>
      <el-table-column label="角色" width="100">
        <template #default="{ row }">{{ pick(row, "role") || "—" }}</template>
      </el-table-column>
      <el-table-column label="状态" width="100">
        <template #default="{ row }">
          <el-tag :type="statusMeta(pick(row, 'status'), ACCOUNT_STATUS).type" size="small">
            {{ statusMeta(pick(row, "status"), ACCOUNT_STATUS).label }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="联系方式" min-width="160">
        <template #default="{ row }">{{ pick(row, "contact") || "（脱敏）" }}</template>
      </el-table-column>
      <el-table-column label="操作" width="420" fixed="right">
        <template #default="{ row }">
          <el-button v-if="auth.isAdmin" size="small" text type="primary" @click="showContact(row)">
            联系方式
          </el-button>
          <el-button size="small" text @click="showUsernames(row)">曾用名</el-button>
          <el-button
            v-if="auth.isAdmin && pick(row, 'role') === 'staff'"
            size="small"
            text
            type="info"
            @click="openPermissions(row)"
          >
            权限
          </el-button>
          <el-button v-if="auth.isAdmin" size="small" text type="warning" @click="warnRow(row)">
            警告
          </el-button>
          <el-button v-if="auth.isAdmin" size="small" text type="primary" @click="renameRow(row)">
            改名
          </el-button>
          <el-button
            v-if="auth.isAdmin"
            size="small"
            text
            :type="pick(row, 'status') === 4 ? 'success' : 'danger'"
            @click="toggleBan(row)"
          >
            {{ pick(row, "status") === 4 ? "解封" : "封禁" }}
          </el-button>
        </template>
      </el-table-column>
    </el-table>

    <PageNav :page="page" :has-more="hasMore" :loading="loading" @prev="prev" @next="next" />

    <!-- 封禁对话框 -->
    <el-dialog v-model="banDialog.visible" title="封禁玩家" width="420px">
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

    <!-- 联系方式对话框 -->
    <el-dialog v-model="contactDialog.visible" title="完整联系方式" width="420px">
      <el-skeleton v-if="contactDialog.loading" :rows="3" animated />
      <pre v-else class="pre">{{ contactDialog.text }}</pre>
    </el-dialog>

    <!-- 曾用名对话框 -->
    <el-dialog v-model="usernamesDialog.visible" title="曾用名记录" width="560px">
      <el-table v-loading="usernamesDialog.loading" :data="usernamesDialog.list" border size="small">
        <el-table-column prop="oldUsername" label="旧用户名" />
        <el-table-column prop="newUsername" label="新用户名" />
        <el-table-column prop="changeKind" label="类型" width="90" />
        <el-table-column label="时间" width="170">
          <template #default="{ row }">{{ fmtTime(row.changedAt) }}</template>
        </el-table-column>
      </el-table>
    </el-dialog>
  </div>
</template>

<script setup>
import { onMounted, reactive, ref } from "vue";
import { useRouter } from "vue-router";
import { ElMessage, ElMessageBox } from "element-plus";
import { useAuthStore } from "@/stores/auth";
import {
    listPlayers,
    getPlayerContact,
    getPlayerUsernames,
    warnPlayer,
    banPlayer,
    unbanPlayer,
    renamePlayer,
} from "@/api/players";
import { useCursorPage } from "@/composables/useCursorPage";
import PageNav from "@/components/PageNav.vue";
import { pick, fmtTime, ACCOUNT_STATUS, statusMeta } from "@/utils/format";

const auth = useAuthStore();
const router = useRouter();
const filters = reactive({ keyword: "", status: "", role: "" });

const fetcher = (cursor) =>
    listPlayers({ ...filters, cursor, limit: 50 });

const { list, page, hasMore, loading, first, next, prev } = useCursorPage(fetcher);

function search() {
    first();
}
function reset() {
    filters.keyword = "";
    filters.status = "";
    filters.role = "";
    first();
}

// ---- 封禁 ----
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
        await banPlayer(banDialog.row.id, { reason: banDialog.reason.trim(), ...(until ? { until } : {}) });
        ElMessage.success("已封禁");
        banDialog.visible = false;
        first();
    } catch (err) {
        ElMessage.error(err.message);
    } finally {
        banDialog.loading = false;
    }
}

async function toggleBan(row) {
    if (pick(row, "status") === 4) {
        try {
            await ElMessageBox.confirm("确认解除该玩家的封禁？", "解封确认", { type: "warning" });
        } catch {
            return;
        }
        try {
            await unbanPlayer(row.id);
            ElMessage.success("已解封");
            first();
        } catch (err) {
            ElMessage.error(err.message);
        }
    } else {
        openBan(row);
    }
}

async function warnRow(row) {
    let value;
    try {
        const { value: v } = await ElMessageBox.prompt(
            "警告将投递到玩家所在队伍会话（全队可见）；玩家没有队伍时投递到其账号级会话",
            "警告玩家",
            {
                inputType: "textarea",
                inputPlaceholder: "请填写警告原因（1–200 字）",
                inputValidator: (s) =>
                    (s && s.trim().length >= 1 && s.trim().length <= 200) ||
                    "原因需为 1–200 字",
            },
        );
        value = v;
    } catch {
        return;
    }
    try {
        await warnPlayer(row.id, { reason: value.trim() });
        ElMessage.success("已警告");
        first();
    } catch (err) {
        ElMessage.error(err.message);
    }
}

async function renameRow(row) {
    let value;
    try {
        const { value: v } = await ElMessageBox.prompt("封禁中的账号不允许改名", "强制改名", {
            inputPlaceholder: "新用户名（1–32 码点）",
            inputValidator: (s) => (s && s.trim().length >= 1 && s.trim().length <= 32) || "长度需为 1–32",
        });
        value = v;
    } catch {
        return;
    }
    try {
        await renamePlayer(row.id, { username: value.trim() });
        ElMessage.success("已改名");
        first();
    } catch (err) {
        ElMessage.error(err.message);
    }
}

// ---- 联系方式 ----
const contactDialog = reactive({ visible: false, loading: false, text: "" });

async function showContact(row) {
    contactDialog.visible = true;
    contactDialog.loading = true;
    contactDialog.text = "";
    try {
        const data = await getPlayerContact(row.id);
        contactDialog.text = JSON.stringify(data, null, 2);
    } catch (err) {
        ElMessage.error(err.message);
        contactDialog.text = String(err.message);
    } finally {
        contactDialog.loading = false;
    }
}

// ---- 曾用名 ----
const usernamesDialog = reactive({ visible: false, loading: false, list: [] });

async function showUsernames(row) {
    usernamesDialog.visible = true;
    usernamesDialog.loading = true;
    usernamesDialog.list = [];
    try {
        const data = await getPlayerUsernames(row.id, { limit: 100 });
        usernamesDialog.list = data?.items || [];
    } catch (err) {
        ElMessage.error(err.message);
    } finally {
        usernamesDialog.loading = false;
    }
}

// ---- 权限组：权限是逐账号授予的，带着账号 ID 跳到权限管理页 ----
function openPermissions(row) {
    router.push({ name: "permissions", query: { account_id: row.id } });
}

onMounted(() => first());
</script>

<style scoped>
.pre {
    white-space: pre-wrap;
    word-break: break-all;
    background: #f5f7fa;
    padding: 12px;
    border-radius: 4px;
    font-size: 13px;
}
</style>
