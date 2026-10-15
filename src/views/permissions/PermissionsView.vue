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
          <el-tag
            v-for="code in row.permissions"
            :key="code"
            size="small"
            class="perm-tag"
          >
            {{ code }}
          </el-tag>
          <span v-if="!row.permissions?.length">—</span>
        </template>
      </el-table-column>
      <el-table-column label="说明" min-width="220">
        <template #default="{ row }">{{ row.description || "—" }}</template>
      </el-table-column>
    </el-table>

    <el-divider content-position="left">账号授权</el-divider>
    <div class="filter-bar">
      <el-input-number
        v-model="accountId"
        :min="1"
        :controls="false"
        style="width: 160px"
        placeholder="账号 ID"
      />
      <el-button
        type="primary"
        :loading="accountLoading"
        :disabled="!accountId"
        @click="loadAccount"
      >
        查询
      </el-button>
      <span class="tip">
        只能给 role=staff 的账号授予权限组（admin / 玩家会被服务端拒绝）。
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
          <el-tag
            v-for="code in account.groups"
            :key="code"
            size="small"
            type="success"
            class="perm-tag"
          >
            {{ code }}
          </el-tag>
          <span v-if="!account.groups?.length">—</span>
        </el-descriptions-item>
        <el-descriptions-item label="实际权限" :span="3">
          <el-tag
            v-for="code in account.permissions"
            :key="code"
            size="small"
            class="perm-tag"
          >
            {{ code }}
          </el-tag>
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
              :disabled="account.byRole"
              @click="toggleGroup(row)"
            >
              {{ row.granted ? "撤销" : "授予" }}
            </el-button>
          </template>
        </el-table-column>
      </el-table>
    </template>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from "vue";
import { ElMessage } from "element-plus";
import {
    getAccountPermissions,
    grantPermissionGroup,
    listPermissions,
    revokePermissionGroup,
} from "@/api/msg";

const loading = ref(false);
const catalog = ref({ permissions: [], groups: [] });

const accountId = ref(null);
const account = ref(null);
const accountLoading = ref(false);
const busyGroup = ref("");

// 权限组目录 + 该账号是否已授予
const groupRows = computed(() =>
    (catalog.value.groups || []).map((group) => ({
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

async function loadAccount() {
    if (!accountId.value) return;

    accountLoading.value = true;
    try {
        account.value = await getAccountPermissions(accountId.value);
    } catch (err) {
        account.value = null;
        ElMessage.error(err.message);
    } finally {
        accountLoading.value = false;
    }
}

// 授予 / 撤销都幂等：重复操作不报错，返回体的 granted / revoked 说明是否真的改了
async function toggleGroup(row) {
    if (!account.value) return;
    if (account.value.byRole) {
        ElMessage.warning("admin 由角色默认拥有全部权限，无需授予权限组");
        return;
    }

    busyGroup.value = row.code;
    try {
        if (row.granted) {
            await revokePermissionGroup(accountId.value, row.code);
            ElMessage.success(`已撤销 ${row.code}`);
        } else {
            await grantPermissionGroup(accountId.value, row.code);
            ElMessage.success(`已授予 ${row.code}`);
        }
        await loadAccount();
    } catch (err) {
        ElMessage.error(err.message);
    } finally {
        busyGroup.value = "";
    }
}

onMounted(loadCatalog);
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
</style>
