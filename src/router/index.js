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
                path: "puzzles",
                name: "puzzles",
                component: () => import("@/views/puzzles/PuzzlesView.vue"),
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
        ],
    },
    { path: "/:pathMatch(.*)*", redirect: "/dashboard" },
];

export const router = createRouter({
    history: createWebHistory("/admin/"),
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
    if (to.meta.requiresStaff && !auth.isStaff) return "/dashboard";
    return true;
});
