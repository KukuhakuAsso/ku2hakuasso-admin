import { createRouter, createWebHashHistory } from "vue-router";
import { useAuthStore } from "@/stores/auth";

// 子项目部署于主站 /admin/ 路径下，路由 base 与 vite base 保持一致
const routes = [
  {
    path: "/login",
    name: "login",
    component: () => import("@/views/LoginView.vue"),
    meta: { public: true },
  },
  {
    path: "/",
    component: () => import("@/layout/AdminLayout.vue"),
    meta: { requiresStaff: true },
    children: [
      { path: "", redirect: "/dashboard" },
      {
        path: "dashboard",
        name: "dashboard",
        component: () => import("@/views/DashboardView.vue"),
      },
      {
        path: "players",
        name: "players",
        component: () => import("@/views/players/PlayersView.vue"),
      },
      {
        path: "teams",
        name: "teams",
        component: () => import("@/views/teams/TeamsView.vue"),
      },
      {
        // 站内信工作台：原来的「提示工作台」「申诉工作台」已并入本页
        //（抽屉里按邮件来源给提示 / 申诉动作面板），所以只保留这一条子路由。
        // 这条分组记录不挂 component —— Vue Router 渲染时会跳过没有 components 的
        // matched 记录，子页面仍直接渲染进 AdminLayout 的 router-view。
        path: "letters",
        children: [
          {
            path: "messages",
            name: "letters-messages",
            component: () => import("@/views/msg/MsgThreadsView.vue"),
            // 来信 / 公告 / 求提示 / 申诉任一权限都能进（口径与侧栏入口一致）
            meta: { requiresMailWorkbench: true },
          },
        ],
      },
      {
        // 定向通知与公告：定向通知（msg.notify.send）、官方公告发布 + 公告历史
        // （msg.announce.publish）、内部公告（仅 admin）合并在同一页的四个页签里，
        // 页内再按权限逐个收口；这里只判断「至少能看一个页签」。
        path: "notify",
        name: "notify",
        component: () => import("@/views/msg/NotifyView.vue"),
        meta: { requiresNotifyOrAnnounce: true },
      },
      {
        // 处罚记录：禁言列表需 moderation.mute；封禁列表仅 admin（页内再按权限分页签）
        path: "punishments",
        name: "punishments",
        component: () => import("@/views/moderation/PunishmentsView.vue"),
        meta: { requiresMuteOrBan: true },
      },
      {
        // 进度监测四条接口 2026-11-06 起为 admin 专属（staff 一律 403），
        // 路由与侧栏入口都按 admin 收口
        path: "progress",
        name: "progress",
        component: () => import("@/views/progress/ProgressTeamsView.vue"),
        meta: { requiresAdmin: true },
      },
      {
        path: "progress/team/:id",
        name: "progress-team",
        component: () => import("@/views/progress/ProgressTeamView.vue"),
        meta: { requiresAdmin: true },
      },
      {
        path: "progress/matrix",
        name: "progress-matrix",
        component: () => import("@/views/progress/ProgressMatrixView.vue"),
        meta: { requiresAdmin: true },
      },
      {
        path: "progress/submissions",
        name: "submissions",
        component: () => import("@/views/progress/SubmissionsView.vue"),
        meta: { requiresAdmin: true },
      },
      {
        path: "audit",
        name: "audit",
        component: () => import("@/views/audit/AuditView.vue"),
      },
      {
        path: "tips",
        name: "tips",
        component: () => import("@/views/tips/TipsView.vue"),
      },
      {
        // 维护操作已并入「Tips 与规则」页底部的维护卡片（仅 admin）。
        // 旧链接保留，直接转过去；页内那条卡片本身按 admin 收口。
        path: "maintenance",
        redirect: "/tips",
      },
      {
        path: "pz",
        name: "pz",
        component: () => import("@/views/pz/PuzzleStudioView.vue"),
        meta: { requiresPzContent: true },
      },
      {
        path: "milestones",
        name: "milestones",
        component: () => import("@/views/milestones/MilestonesView.vue"),
      },
      {
        path: "permissions",
        name: "permissions",
        component: () => import("@/views/permissions/PermissionsView.vue"),
        meta: { requiresAdmin: true },
      },
    ],
  },
  { path: "/:pathMatch(.*)*", redirect: "/dashboard" },
];

export const router = createRouter({
  history: createWebHashHistory("/admin/"),
  routes,
});

router.beforeEach((to) => {
  const auth = useAuthStore();
  if (to.meta.public) {
    if (to.path === "/login" && auth.isAuthenticated) {
      return "/dashboard";
    }
    return true;
  }
  if (!auth.isAuthenticated) return "/login";
  // 已知角色但不是 staff（如刚注册出来的玩家账号）：清掉后台会话回登录页。
  // 否则把非 staff 送回 /dashboard 会与这条守卫自身形成死循环（页面全白）。
  // 角色未知（仅有令牌、快照还没同步回来）时先放行，等接口或 syncAccount 给出结论。
  if (auth.account && !auth.isStaff) {
    auth.reset();
    return "/login";
  }
  if (to.meta.requiresAdmin && !auth.isAdmin) return "/dashboard";
  // 出题台：需 pz.content.edit（admin 直接通过）
  if (to.meta.requiresPzContent && !canEditPuzzleContent(auth)) {
    return "/dashboard";
  }
  // 定向通知与公告：定向通知需 msg.notify.send，官方公告需 msg.announce.publish，
  // 内部公告仅 admin —— 四个页签里至少能看到一个就放行，页内再逐个收口
  if (to.meta.requiresNotifyOrAnnounce && !canNotifyOrAnnounce(auth)) {
    return "/dashboard";
  }
  // 站内信工作台（含并入的求提示 / 申诉）：来信、公告、求提示、申诉任一权限即可
  if (to.meta.requiresMailWorkbench && !canOpenMailWorkbench(auth)) {
    return "/dashboard";
  }
  // 处罚记录：封禁列表仅 admin；禁言列表需 moderation.mute
  if (
    to.meta.requiresMuteOrBan &&
    !auth.isAdmin &&
    !auth.can("moderation.mute")
  ) {
    return "/dashboard";
  }
  return true;
});

// 站内信工作台的口径与侧栏入口保持一致：来信要 msg.feedback.handle，公告只读要
// msg.announce.publish，并入的求提示 / 申诉分别要 msg.hint.handle、moderation.mute。
function canOpenMailWorkbench(auth) {
  return (
    auth.isAdmin ||
    auth.can("msg.feedback.handle") ||
    auth.can("msg.announce.publish") ||
    auth.can("msg.hint.handle") ||
    auth.can("moderation.mute")
  );
}

function canEditPuzzleContent(auth) {
  return auth.isAdmin || auth.can("pz.content.edit");
}

// 定向通知 + 官方公告（含公告历史）：任一权限即可进入合并页
function canNotifyOrAnnounce(auth) {
  return (
    auth.isAdmin ||
    auth.can("msg.notify.send") ||
    auth.can("msg.announce.publish")
  );
}
