<template>
  <el-container class="layout">
    <!-- 手机端：侧栏改为抽屉，点遮罩关闭 -->
    <transition name="backdrop">
      <div
        v-if="isMobile && mobileNavOpen"
        class="aside-backdrop"
        @click="mobileNavOpen = false"
      />
    </transition>

    <el-aside
      :width="asideWidth"
      class="aside"
      :class="{
        'is-collapsed': menuCollapsed,
        'is-open': mobileNavOpen,
      }"
      :inert="isMobile && !mobileNavOpen ? '' : null"
    >
      <div class="brand">
        <span class="brand-mark">空</span>
        <span v-if="!menuCollapsed" class="brand-text">
          <span class="brand-title">空白解谜组</span>
          <span class="brand-sub">管理后台</span>
        </span>
      </div>
      <el-menu
        :default-active="activePath"
        router
        background-color="#001529"
        text-color="#c7ccd4"
        active-text-color="#ffffff"
        class="menu"
        :collapse="menuCollapsed"
        :collapse-transition="false"
        @select="onMenuSelect"
      >
        <el-menu-item index="/dashboard">
          <el-icon><DataBoard /></el-icon>
          <template #title>仪表盘</template>
        </el-menu-item>
        <el-menu-item index="/players">
          <el-icon><User /></el-icon>
          <template #title>玩家管理</template>
        </el-menu-item>
        <el-menu-item index="/teams">
          <el-icon><OfficeBuilding /></el-icon>
          <template #title>队伍管理</template>
        </el-menu-item>
        <!-- 站内信工作台：原「提示工作台」「申诉工作台」已并入本页（抽屉里按来源给动作面板），
             所以入口按「来信 / 公告 / 求提示 / 申诉」任一权限收口，角标也是三条合并后的一个数。 -->
        <el-menu-item
          v-if="canMsgWorkbench"
          index="/letters/messages"
          :class="{ 'has-badge': badges.totalBadge }"
        >
          <el-icon><Message /></el-icon>
          <template #title>
            <span>站内信工作台</span>
            <span v-if="badges.totalBadge" class="menu-badge">
              {{ badges.totalBadge }}
            </span>
          </template>
        </el-menu-item>
        <el-menu-item v-if="canNotify" index="/notify">
          <el-icon><Promotion /></el-icon>
          <template #title>定向通知与公告</template>
        </el-menu-item>
        <el-menu-item v-if="canViewPunishments" index="/punishments">
          <el-icon><Warning /></el-icon>
          <template #title>处罚记录</template>
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
          <el-icon><Document /></el-icon>
          <template #title>审计日志</template>
        </el-menu-item>
        <el-menu-item index="/tips">
          <el-icon><Coin /></el-icon>
          <template #title>Tips 与规则</template>
        </el-menu-item>
        <el-menu-item v-if="auth.can('pz.content.edit')" index="/pz">
          <el-icon><EditPen /></el-icon>
          <template #title>出题台</template>
        </el-menu-item>
        <el-menu-item index="/milestones">
          <el-icon><Flag /></el-icon>
          <template #title>里程碑</template>
        </el-menu-item>
        <el-menu-item v-if="auth.isAdmin" index="/permissions">
          <el-icon><Lock /></el-icon>
          <template #title>权限管理</template>
        </el-menu-item>
      </el-menu>
    </el-aside>

    <el-container class="body">
      <el-header class="header">
        <div class="header-left">
          <el-button
            class="nav-toggle"
            text
            :aria-label="toggleLabel"
            :aria-expanded="isMobile ? mobileNavOpen : !collapsed"
            @click="onToggleNav"
          >
            <el-icon :size="18">
              <Menu v-if="isMobile" />
              <Expand v-else-if="collapsed" />
              <Fold v-else />
            </el-icon>
          </el-button>
          <div class="header-title">{{ currentTitle }}</div>
        </div>
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
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ElMessage } from "element-plus";
import { useAuthStore } from "@/stores/auth";
import { useIsMobile } from "@/composables/useMediaQuery";
import { useWorkbenchBadges } from "@/composables/useWorkbenchBadges";

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();

// ---------- 侧栏展开 / 收起 ----------
// 桌面端：折叠成 64px 图标栏，状态存 localStorage，刷新后保持；
// 手机端：侧栏变成抽屉，默认隐藏，由顶栏按钮打开（与折叠状态互不影响）。
const COLLAPSE_KEY = "admin.layout.navCollapsed";

const isMobile = useIsMobile();
const mobileNavOpen = ref(false);
const collapsed = ref(readCollapsed());

const menuCollapsed = computed(() => !isMobile.value && collapsed.value);
const asideWidth = computed(() => {
    if (isMobile.value) return "260px";
    return collapsed.value ? "64px" : "220px";
});
const toggleLabel = computed(() => {
    if (isMobile.value) return mobileNavOpen.value ? "关闭菜单" : "打开菜单";
    return collapsed.value ? "展开侧栏" : "收起侧栏";
});

function readCollapsed() {
    try {
        return localStorage.getItem(COLLAPSE_KEY) === "1";
    } catch {
        return false;
    }
}

function onToggleNav() {
    if (isMobile.value) mobileNavOpen.value = !mobileNavOpen.value;
    else collapsed.value = !collapsed.value;
}

// 抽屉里点菜单就关（点当前页时路由不变，所以不能只靠路由监听）
function onMenuSelect() {
    if (isMobile.value) mobileNavOpen.value = false;
}

// 回到桌面端时抽屉没有意义，直接收起
watch(isMobile, (mobile) => {
    if (!mobile) mobileNavOpen.value = false;
});

function onKeydown(event) {
    if (event.key === "Escape" && mobileNavOpen.value) mobileNavOpen.value = false;
}

watch(collapsed, (value) => {
    try {
        localStorage.setItem(COLLAPSE_KEY, value ? "1" : "0");
    } catch {
        // 隐私模式等场景写不进去就算了，不影响本次使用
    }
});

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
    // startPolling 内部会立刻拉一次，并负责轮询 + 可见性恢复时补拉
    startPolling(() => canSeeTicketBadge.value);
    window.addEventListener("keydown", onKeydown);
});

onBeforeUnmount(() => {
    stopPolling();
    window.removeEventListener("keydown", onKeydown);
});

// 切页面就刷新一次：从工作台处理完返回时，角标立刻反映最新状态
watch(
    () => route.path,
    () => {
        // 手机端抽屉里点完菜单就收起
        mobileNavOpen.value = false;
        refreshBadges(canSeeTicketBadge.value);
    },
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
    /* 移动端地址栏会挤占 100vh，支持的浏览器用动态视口高度 */
    height: 100dvh;
}

.aside {
    background-color: #001529;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    transition: width 0.2s ease;
}

.brand {
    flex: none;
    height: 56px;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 0 16px;
    color: #fff;
    overflow: hidden;
}

.brand-mark {
    flex: none;
    width: 28px;
    height: 28px;
    border-radius: 8px;
    background: linear-gradient(135deg, #2f6fed, #7c4dff);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 14px;
    font-weight: 600;
}

.brand-text {
    display: flex;
    flex-direction: column;
    min-width: 0;
}

.brand-title {
    font-size: 16px;
    font-weight: 600;
    white-space: nowrap;
}

.brand-sub {
    font-size: 12px;
    color: #8a94a6;
    white-space: nowrap;
}

/* 收起时只留 64px，品牌区居中放缩略标 */
.aside.is-collapsed .brand {
    justify-content: center;
    padding: 0;
}

.menu {
    border-right: none;
    flex: 1;
    overflow-y: auto;
    overflow-x: hidden;
}

/* 收起成图标栏时，角标缩成图标右上角的小红点 */
.aside.is-collapsed .has-badge :deep(.el-icon) {
    position: relative;
}

.aside.is-collapsed .has-badge :deep(.el-icon)::after {
    content: "";
    position: absolute;
    top: -3px;
    right: -5px;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: #e45656;
    box-shadow: 0 0 0 2px #001529;
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

.body {
    min-width: 0;
}

.header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    --el-header-padding: 0 16px;
    border-bottom: 1px solid var(--el-border-color-light);
    background: #fff;
}

.header-left {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
}

.nav-toggle {
    flex: none;
    padding: 8px;
    margin-left: -8px;
}

.header-title {
    font-size: 16px;
    font-weight: 600;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
}

.header-user {
    display: flex;
    align-items: center;
    gap: 10px;
    flex: none;
}

.username {
    font-size: 14px;
}

.main {
    background: #f5f7fa;
    padding: 16px;
}

@media (max-width: 768px) {
    .aside {
        /* 抽屉浮在内容之上，宽度仍由 asideWidth 保持 260px */
        position: fixed;
        top: 0;
        bottom: 0;
        left: 0;
        z-index: 1500;
        transform: translateX(-100%);
        transition: transform 0.24s ease;
    }

    .aside.is-open {
        transform: translateX(0);
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
    }

    .aside-backdrop {
        position: fixed;
        inset: 0;
        z-index: 1499;
        background: rgba(0, 0, 0, 0.45);
    }

    .backdrop-enter-active,
    .backdrop-leave-active {
        transition: opacity 0.24s ease;
    }

    .backdrop-enter-from,
    .backdrop-leave-to {
        opacity: 0;
    }

    .header {
        --el-header-height: 52px;
        --el-header-padding: 0 12px;
    }

    .header-title {
        font-size: 15px;
    }

    .username {
        display: none;
    }

    .main {
        padding: 12px;
    }
}

/* 极窄屏优先保证页面标题，角色标签让位 */
@media (max-width: 420px) {
    .header-user :deep(.el-tag) {
        display: none;
    }
}
</style>
