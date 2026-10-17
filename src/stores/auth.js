import { defineStore } from "pinia";
import { apiLogin, apiLogout } from "@/api/auth";
import {
    getToken,
    setToken,
    clearSession,
    getStoredAccount,
    setStoredAccount,
    beginNewSession,
    refreshSession,
} from "@/api/http";

export const useAuthStore = defineStore("auth", {
    state: () => ({
        token: getToken(),
        // 登录 / 刷新时下发的账号快照（含 permissions），can() 都基于它
        account: getStoredAccount(),
    }),
    getters: {
        isAuthenticated: (s) => !!s.token,
        role: (s) => s.account?.role || null,
        // 文档口径：staff 及以上可读列表；写操作多为 admin 专属
        isStaff: (s) => ["staff", "admin"].includes(s.account?.role),
        isAdmin: (s) => s.account?.role === "admin",
        // 权限清单由登录 / 刷新响应下发；admin 由角色默认拥有全部权限
        permissions: (s) => s.account?.permissions || [],
        can: (s) => (code) =>
            s.account?.role === "admin" ||
            (s.account?.permissions || []).includes(code),
        displayName: (s) =>
            s.account?.username || s.account?.player_no || "管理员",
    },
    actions: {
        async login(payload) {
            const data = await apiLogin(payload);
            // 新会话代次：还在路上的旧刷新（启动还原 / 上一个账号的 401 刷新）结果作废
            beginNewSession();
            this.token = data.access_token;
            setToken(data.access_token);
            this.applyAccount(data.account);
            return data;
        },
        // 账号快照统一从这里写入：内存 + localStorage 一起更新
        applyAccount(account) {
            this.account = account || null;
            setStoredAccount(account);
        },
        // 注册接口（/auth/reg/verify）已下发令牌与账号快照，直接采用，不再调一次登录接口
        adoptSession({ access_token, account }) {
            if (!access_token) return;
            beginNewSession();
            this.token = access_token;
            setToken(access_token);
            this.applyAccount(account || null);
        },
        // 还原 / 刷新会话时取一次最新权限：刷新令牌的响应带 account.permissions，
        // 权限每次请求实时判定，这里负责让界面跟上（撤销或新增都能立即反映）。
        async syncAccount() {
            if (!this.isAuthenticated) return null;
            const data = await refreshSession();
            if (data?.account) this.applyAccount(data.account);
            else if (data?.token) this.token = data.token;
            return data?.account || null;
        },
        async logout() {
            try {
                await apiLogout();
            } catch {
                // 登出接口失败不阻断本地清理
            }
            this.reset();
        },
        reset() {
            this.token = null;
            this.account = null;
            clearSession();
        },
    },
});
