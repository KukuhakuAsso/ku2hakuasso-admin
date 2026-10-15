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
        <el-menu-item v-if="canMsgWorkbench" index="/messages">
          <el-icon><ChatDotRound /></el-icon><span>站内信工作台</span>
        </el-menu-item>
        <el-menu-item v-if="auth.can('msg.hint.handle')" index="/hints">
          <el-icon><QuestionFilled /></el-icon><span>提示工作台</span>
        </el-menu-item>
        <el-menu-item v-if="auth.can('msg.announce.publish')" index="/announcements">
          <el-icon><Bell /></el-icon><span>公告</span>
        </el-menu-item>
        <el-sub-menu index="progress-group">
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
        <el-menu-item index="/puzzles">
          <el-icon><Notebook /></el-icon><span>题库</span>
        </el-menu-item>
        <el-menu-item index="/milestones">
          <el-icon><Flag /></el-icon><span>里程碑</span>
        </el-menu-item>
        <el-menu-item v-if="auth.isAdmin" index="/maintenance">
          <el-icon><Tools /></el-icon><span>维护操作</span>
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
import { computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ElMessage } from "element-plus";
import { useAuthStore } from "@/stores/auth";

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();

const activePath = computed(() => route.path);
const currentTitle = computed(() => route.meta.title || document.title);
// 站内信工作台：有反馈处理权限看全部频道，只有公告权限时后端只返回公告
const canMsgWorkbench = computed(
    () => auth.can("msg.feedback.handle") || auth.can("msg.announce.publish"),
);

async function onLogout() {
    await auth.logout();
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
