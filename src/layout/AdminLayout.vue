<template>
  <el-container class="layout">
    <el-aside width="220px" class="aside">
      <div class="brand">
        <span class="brand-title">空白解谜组</span>
        <span class="brand-sub">管理后台</span>
      </div>
      <el-menu
        :default-active="activePath"
        router
        background-color="#001529"
        text-color="#c7ccd4"
        active-text-color="#ffffff"
        class="menu"
      >
        <el-menu-item index="/dashboard">
          <el-icon><DataBoard /></el-icon><span>仪表盘</span>
        </el-menu-item>
        <el-menu-item index="/players">
          <el-icon><User /></el-icon><span>玩家管理</span>
        </el-menu-item>
        <el-menu-item index="/teams">
          <el-icon><OfficeBuilding /></el-icon><span>队伍管理</span>
        </el-menu-item>
        <!-- 站内信工作台：原「提示工作台」「申诉工作台」已并入本页（抽屉里按来源给动作面板），
             所以入口按「来信 / 公告 / 求提示 / 申诉」任一权限收口，角标也是三条合并后的一个数。 -->
        <el-menu-item v-if="canMsgWorkbench" index="/letters/messages">
          <el-icon><Message /></el-icon><span>站内信工作台</span>
          <span v-if="badges.totalBadge" class="menu-badge">
            {{ badges.totalBadge }}
          </span>
        </el-menu-item>
        <el-menu-item v-if="canNotify" index="/notify">
          <el-icon><Promotion /></el-icon><span>定向通知与公告</span>
        </el-menu-item>
        <el-menu-item v-if="canViewPunishments" index="/punishments">
          <el-icon><Warning /></el-icon><span>处罚记录</span>
        </el-menu-item>
        <el-sub-menu v-if="auth.isAdmin" index="progress-group">
          <template #title>
            <el-icon><DataLine /></el-icon><span>进度监测</span>
          </template>
          <el-menu-item index="/progress">队伍进度</el-menu-item>
          <el-menu-item index="/progress/matrix">通过矩阵</el-menu-item>
          <el-menu-item index="/progress/submissions">提交历史</el-menu-item>
        </el-sub-menu>
        <el-menu-item index="/audit">
          <el-icon><Document /></el-icon><span>审计日志</span>
        </el-menu-item>
        <el-menu-item index="/tips">
          <el-icon><Coin /></el-icon><span>Tips 与规则</span>
        </el-menu-item>
        <el-menu-item v-if="auth.can('pz.content.edit')" index="/pz">
          <el-icon><EditPen /></el-icon><span>出题台</span>
        </el-menu-item>
        <el-menu-item index="/milestones">
          <el-icon><Flag /></el-icon><span>里程碑</span>
        </el-menu-item>
        <el-menu-item v-if="auth.isAdmin" index="/permissions">
          <el-icon><Lock /></el-icon><span>权限管理</span>
        </el-menu-item>
      </el-menu>
    </el-aside>

    <el-container>
      <el-header class="header">
        <div class="header-title">{{ currentTitle }}</div>
        <div class="header-user">
          <el-tag size="small" :type="auth.isAdmin ? 'danger' : 'warning'" effect="dark">
            {{ auth.isAdmin ? "admin" : "staff" }}
          </el-tag>
          <span class="username">{{ auth.displayName }}</span>
          <el-button size="small" text @click="onLogout">退出登录</el-button>
        </div>
      </el-header>
      <el-main class="main">
        <router-view />
      </el-main>
    </el-container>
  </el-container>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ElMessage } from "element-plus";
import { useAuthStore } from "@/stores/auth";
import { useWorkbenchBadges } from "@/composables/useWorkbenchBadges";

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();

const activePath = computed(() => route.path);
const currentTitle = computed(() => route.meta.title || document.title);
// 站内信工作台：原「提示 / 申诉」两个工作台已并入本页，所以来信 / 公告 / 求提示 / 申诉
// 任一权限都能进（页内与后端按频道、来源各自收口）
const canMsgWorkbench = computed(
    () =>
        auth.isAdmin ||
        auth.can("msg.feedback.handle") ||
        auth.can("msg.announce.publish") ||
        auth.can("msg.hint.handle") ||
        auth.can("moderation.mute"),
);
// 定向通知与公告：定向通知需 msg.notify.send、官方公告与公告历史需 msg.announce.publish、
// 内部公告仅 admin —— 任一项可见就显示入口（页内再按页签逐个收口）
const canNotify = computed(
    () =>
        auth.isAdmin ||
        auth.can("msg.notify.send") ||
        auth.can("msg.announce.publish"),
);
// 申诉权限：admin 看全部，staff 需 moderation.mute（只有禁言申诉）
const canHandleAppeals = computed(
    () => auth.isAdmin || auth.can("moderation.mute"),
);
// 处罚记录：封禁列表仅 admin；禁言列表需 moderation.mute
const canViewPunishments = computed(
    () => auth.isAdmin || auth.can("moderation.mute"),
);

// ---------- 站内信工作台角标 ----------
const { badges, refresh: refreshBadges, startPolling, stopPolling, reset: resetBadges } =
    useWorkbenchBadges();

// 每一路都按权限决定是否请求：没权限的项不该发请求（会 403）。
// 站内信工作台是一个整体（来信 / 求提示 / 申诉都在这一个页面里，角标也只有一个数），
// 所以这里只判断「有没有任一处理权限」；至于各类型算多少，由后端按权限累加后给顶层 open。
const canSeeTicketBadge = computed(
    () =>
        auth.can("msg.feedback.handle") ||
        auth.can("msg.hint.handle") ||
        canHandleAppeals.value,
);

onMounted(() => {
    // startPolling 内部会立刻拉一次，并负责 60 秒轮询 + 可见性恢复时补拉
    startPolling(() => canSeeTicketBadge.value);
});

onBeforeUnmount(() => {
    stopPolling();
});

// 切页面就刷新一次：从工作台处理完返回时，角标立刻反映最新状态
watch(
    () => route.path,
    () => refreshBadges(canSeeTicketBadge.value),
);

// 权限快照变化（登录后 syncAccount / 授权被回收）：重算一遍，被收回时归零
watch(canSeeTicketBadge, (can) => refreshBadges(can));

async function onLogout() {
    await auth.logout();
    resetBadges();
    ElMessage.success("已退出登录");
    router.replace("/login");
}
</script>

<style scoped>
.layout {
    height: 100vh;
}
.aside {
    background-color: #001529;
    display: flex;
    flex-direction: column;
}
.brand {
    height: 56px;
    display: flex;
    flex-direction: column;
    justify-content: center;
    padding: 0 16px;
    color: #fff;
}
.brand-title {
    font-size: 16px;
    font-weight: 600;
}
.brand-sub {
    font-size: 12px;
    color: #8a94a6;
}
.menu {
    border-right: none;
    flex: 1;
    overflow-y: auto;
}
.header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    border-bottom: 1px solid var(--el-border-color-light);
    background: #fff;
}
.header-title {
    font-size: 16px;
    font-weight: 600;
}
/* 侧栏角标：深色底上用强对比红，数字等宽避免位数变化时抖动 */
.menu-badge {
    margin-left: auto;
    min-width: 18px;
    padding: 0 5px;
    border-radius: 9px;
    background: #e45656;
    color: #fff;
    font-size: 11px;
    font-weight: 600;
    line-height: 18px;
    text-align: center;
    font-variant-numeric: tabular-nums;
    flex: none;
}
.header-user {
    display: flex;
    align-items: center;
    gap: 10px;
}
.username {
    font-size: 14px;
}
.main {
    background: #f5f7fa;
}
</style>
