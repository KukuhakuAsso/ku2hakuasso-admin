<template>
  <div class="page-card">
    <el-alert
      type="info"
      :closable="false"
      show-icon
      title="角色决定能不能进管理端，权限决定进来后能碰哪类事；权限每请求校验，撤销即时生效。"
      description="admin 由角色默认拥有全部权限（byRole）；staff 需要被授予权限组，可同时属于多个组，权限取并集。"
    />

    <el-divider content-position="left">权限目录</el-divider>
    <el-table
      v-loading="loading"
      :data="catalog.permissions"
      border
      stripe
      size="small"
    >
      <el-table-column prop="code" label="权限码" width="220" />
      <el-table-column prop="name" label="名称" width="220" />
      <el-table-column prop="description" label="说明" min-width="320" />
    </el-table>

    <el-divider content-position="left">权限组</el-divider>
    <el-table
      v-loading="loading"
      :data="catalog.groups"
      border
      stripe
      size="small"
    >
      <el-table-column prop="code" label="组码" width="200" />
      <el-table-column prop="name" label="名称" width="240" />
      <el-table-column label="包含权限" min-width="320">
        <template #default="{ row }">
          <el-tooltip
            v-for="code in row.permissions"
            :key="code"
            :content="code"
            placement="top"
          >
            <el-tag size="small" class="perm-tag">
              {{ permissionName(code) }}
            </el-tag>
          </el-tooltip>
          <span v-if="!row.permissions?.length">—</span>
        </template>
      </el-table-column>
      <el-table-column label="说明" min-width="220">
        <template #default="{ row }">{{ row.description || "—" }}</template>
      </el-table-column>
    </el-table>

    <el-divider content-position="left">账号授权</el-divider>
    <div class="filter-bar">
      <el-select
        v-model="accountId"
        filterable
        clearable
        placeholder="搜索 staff 账号（用户名 / 编号）"
        style="width: 280px"
        :loading="staffLoading"
        @change="onAccountChange"
      >
        <el-option
          v-for="item in accountOptions"
          :key="item.id"
          :label="accountLabel(item)"
          :value="item.id"
        />
      </el-select>
      <el-button
        :loading="accountLoading"
        :disabled="!accountId"
        @click="loadAccount"
      >
        刷新
      </el-button>
      <span class="tip">
        只能给 role=staff 的账号授予权限组；admin 由角色默认拥有全部权限。
      </span>
    </div>

    <template v-if="account">
      <el-descriptions :column="3" border size="small">
        <el-descriptions-item label="账号 ID">
          {{ account.accountId }}
        </el-descriptions-item>
        <el-descriptions-item label="角色">
          {{ account.role || "—" }}
        </el-descriptions-item>
        <el-descriptions-item label="权限来源">
          {{ account.byRole ? "角色默认（admin 拥有全部权限）" : "权限组" }}
        </el-descriptions-item>
        <el-descriptions-item label="已授予的组" :span="3">
          <el-tooltip
            v-for="code in account.groups"
            :key="code"
            :content="code"
            placement="top"
          >
            <el-tag size="small" type="success" class="perm-tag">
              {{ groupName(code) }}
            </el-tag>
          </el-tooltip>
          <span v-if="!account.groups?.length">—</span>
        </el-descriptions-item>
        <el-descriptions-item label="实际权限" :span="3">
          <el-tooltip
            v-for="code in account.permissions"
            :key="code"
            :content="code"
            placement="top"
          >
            <el-tag size="small" class="perm-tag">
              {{ permissionName(code) }}
            </el-tag>
          </el-tooltip>
          <span v-if="!account.permissions?.length">—</span>
        </el-descriptions-item>
      </el-descriptions>

      <el-table :data="groupRows" border stripe size="small" class="group-table">
        <el-table-column prop="code" label="权限组" width="200" />
        <el-table-column prop="name" label="名称" min-width="240" />
        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <el-tag size="small" :type="row.granted ? 'success' : 'info'">
              {{ row.granted ? "已授予" : "未授予" }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="110" fixed="right">
          <template #default="{ row }">
            <el-button
              size="small"
              :type="row.granted ? 'danger' : 'primary'"
              :loading="busyGroup === row.code"
              :disabled="!canGrant"
              @click="toggleGroup(row)"
            >
              {{ row.granted ? "撤销" : "授予" }}
            </el-button>
          </template>
        </el-table-column>
      </el-table>

      <el-alert
        v-if="!canGrant"
        class="hint"
        type="warning"
        :closable="false"
        show-icon
        :title="grantBlockedReason"
      />
    </template>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from "vue";
import { useRoute } from "vue-router";
import { ElMessage, ElMessageBox } from "element-plus";
import { listPlayers } from "@/api/players";
import { pick } from "@/utils/format";
import {
    getAccountPermissions,
    grantPermissionGroup,
    listPermissions,
    revokePermissionGroup,
} from "@/api/msg";

const route = useRoute();

const loading = ref(false);
// 权限目录 / 权限组一律以服务端 GET /admin/permissions 为准，前端不再维护任何清单
const catalog = ref({ permissions: [], groups: [] });

const accountId = ref(null);
const account = ref(null);
const accountLoading = ref(false);
const accountOptions = ref([]);
const staffLoading = ref(false);
const busyGroup = ref("");

// staff 账号下拉：一次取 100 个，最多翻 20 页（staff 数量很少，避免游标异常时死循环）
const STAFF_PAGE_LIMIT = 100;
const MAX_STAFF_PAGES = 20;

const accountLabel = (item) => {
    const name = pick(item, "username") || pick(item, "playerNo");
    return `${name ? `${name} · ` : ""}#${pick(item, "id")}`;
};

// 权限码 / 组码 → 服务端目录里的中文名称（目录未命中时回退原码）
const permissionName = (code) =>
    catalog.value.permissions.find((item) => item.code === code)?.name || code;
const groupName = (code) =>
    catalog.value.groups.find((item) => item.code === code)?.name || code;

// 文档 §9.12：只有 role=staff 的账号可以被授予权限组
const canGrant = computed(() => account.value?.role === "staff");
const grantBlockedReason = computed(() => {
    if (!account.value) return "";
    if (account.value.byRole || account.value.role === "admin") {
        return "该账号是 admin，由角色默认拥有全部权限（byRole），无需授予权限组。";
    }
    return `该账号的角色是 ${account.value.role || "未知"}，只能给 role=staff 的账号授予权限组。`;
});

// 权限组目录 + 该账号是否已授予（权限取并集）
const groupRows = computed(() =>
    catalog.value.groups.map((group) => ({
        ...group,
        granted: (account.value?.groups || []).includes(group.code),
    })),
);

async function loadCatalog() {
    loading.value = true;
    try {
        const data = await listPermissions();
        catalog.value = {
            permissions: data?.permissions || [],
            groups: data?.groups || [],
        };
    } catch (err) {
        ElMessage.error(err.message);
    } finally {
        loading.value = false;
    }
}

// 账号下拉：权限组只能授予 staff，这里按游标翻页取全量 staff 账号（接口示例：
// GET /admin/players?role=staff&cursor=<上页 nextCursor>&limit=100）
async function loadStaffAccounts() {
    staffLoading.value = true;
    try {
        const items = [];
        let cursor;
        for (let page = 0; page < MAX_STAFF_PAGES; page += 1) {
            const data = await listPlayers({
                role: "staff",
                cursor,
                limit: STAFF_PAGE_LIMIT,
            });
            items.push(...(data?.items || []));
            if (!data?.hasMore || !data?.nextCursor) break;
            cursor = data.nextCursor;
        }
        accountOptions.value = items;
    } catch (err) {
        ElMessage.error(err.message);
    } finally {
        staffLoading.value = false;
    }
}

function onAccountChange(value) {
    account.value = null;
    if (value) loadAccount();
}

async function loadAccount() {
    if (!accountId.value) return;

    accountLoading.value = true;
    try {
        const data = await getAccountPermissions(accountId.value);
        account.value = data;
        // 深链进来时该账号可能不在 staff 列表里（如 admin / 玩家），补一条选项让下拉能显示它
        if (!accountOptions.value.some((item) => pick(item, "id") === accountId.value)) {
            accountOptions.value = [
                { id: accountId.value, role: data?.role },
                ...accountOptions.value,
            ];
        }
    } catch (err) {
        account.value = null;
        ElMessage.error(err.message);
    } finally {
        accountLoading.value = false;
    }
}

// 授予 / 撤销都幂等：返回体的 granted / revoked 说明这次是否真的改了
async function toggleGroup(row) {
    if (!account.value) return;
    if (!canGrant.value) {
        ElMessage.warning(grantBlockedReason.value);
        return;
    }

    const verb = row.granted ? "撤销" : "授予";
    try {
        await ElMessageBox.confirm(
            `确认${verb}「${groupName(row.code)}」？权限每次请求实时判定，${
                row.granted ? "撤销后立即失效" : "授予后立即生效"
            }。`,
            `${verb}权限组`,
            { type: "warning" },
        );
    } catch {
        return;
    }

    busyGroup.value = row.code;
    try {
        if (row.granted) {
            const data = await revokePermissionGroup(accountId.value, row.code);
            ElMessage.success(
                data?.revoked
                    ? `已撤销 ${groupName(row.code)}`
                    : `该账号本就不属于 ${groupName(row.code)}`,
            );
        } else {
            const data = await grantPermissionGroup(accountId.value, row.code);
            ElMessage.success(
                data?.granted
                    ? `已授予 ${groupName(row.code)}`
                    : `该账号本就已授予 ${groupName(row.code)}`,
            );
        }
        await loadAccount();
    } catch (err) {
        ElMessage.error(err.message);
    } finally {
        busyGroup.value = "";
    }
}

onMounted(async () => {
    loadCatalog();
    loadStaffAccounts();

    // 支持从玩家列表带 ?account_id= 直接进来看授权
    const id = Number(route.query.account_id);
    if (Number.isInteger(id) && id > 0) {
        accountId.value = id;
        await loadAccount();
    }
});
</script>

<style scoped>
.tip {
    color: #909399;
    font-size: 12px;
}
.perm-tag {
    margin: 0 6px 4px 0;
}
.group-table {
    margin-top: 12px;
}
.hint {
    margin-top: 12px;
}
</style>
