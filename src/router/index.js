import { createRouter, createWebHistory } from "vue-router";
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
                path: "messages",
                name: "messages",
                component: () => import("@/views/msg/MsgThreadsView.vue"),
            },
            {
                // 定向通知（msg.notify.send）+ 内部公告（admin）：
                // 发信人可在 /messages 里看到自己发出的通知与回复
                path: "notify",
                name: "notify",
                component: () => import("@/views/msg/NotifyView.vue"),
                meta: { requiresNotify: true },
            },
            {
                path: "hints",
                name: "hints",
                component: () => import("@/views/hint/HintRequestsView.vue"),
            },
            {
                path: "announcements",
                name: "announcements",
                component: () =>
                    import("@/views/announce/AnnouncementsView.vue"),
            },
            {
                // 申诉工作台：封禁申诉仅 admin，禁言申诉需 moderation.mute
                path: "appeals",
                name: "appeals",
                component: () => import("@/views/appeals/AppealsView.vue"),
                meta: { requiresMute: true },
            },
            {
                // 处罚记录：禁言列表需 moderation.mute；封禁列表仅 admin（页内再按权限分页签）
                path: "punishments",
                name: "punishments",
                component: () =>
                    import("@/views/moderation/PunishmentsView.vue"),
                meta: { requiresMuteOrBan: true },
            },
            {
                path: "progress",
                name: "progress",
                component: () =>
                    import("@/views/progress/ProgressTeamsView.vue"),
            },
            {
                path: "progress/team/:id",
                name: "progress-team",
                component: () =>
                    import("@/views/progress/ProgressTeamView.vue"),
            },
            {
                path: "progress/matrix",
                name: "progress-matrix",
                component: () =>
                    import("@/views/progress/ProgressMatrixView.vue"),
            },
            {
                path: "progress/submissions",
                name: "submissions",
                component: () =>
                    import("@/views/progress/SubmissionsView.vue"),
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
                // 题库已并入出题台（中间栏「题目主数据」标签）；旧链接保留，直接转过去
                path: "puzzles",
                redirect: "/pz",
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
                component: () =>
                    import("@/views/milestones/MilestonesView.vue"),
            },
            {
                path: "maintenance",
                name: "maintenance",
                component: () =>
                    import("@/views/maintenance/MaintenanceView.vue"),
            },
            {
                path: "permissions",
                name: "permissions",
                component: () =>
                    import("@/views/permissions/PermissionsView.vue"),
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
    // 定向通知：需 msg.notify.send（admin 直接通过）；内部公告在页内再按 admin 收口
    if (to.meta.requiresNotify && !canSendNotify(auth)) return "/dashboard";
    // 申诉工作台：admin 可看全部，staff 需 moderation.mute（只有禁言申诉）
    if (to.meta.requiresMute && !canHandleAppeals(auth)) return "/dashboard";
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

function canHandleAppeals(auth) {
    return auth.isAdmin || auth.can("moderation.mute");
}

function canEditPuzzleContent(auth) {
    return auth.isAdmin || auth.can("pz.content.edit");
}

function canSendNotify(auth) {
    return auth.isAdmin || auth.can("msg.notify.send");
}
