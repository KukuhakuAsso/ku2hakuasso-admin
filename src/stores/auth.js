import { defineStore } from "pinia";
import { apiLogin, apiLogout } from "@/api/auth";
import { getToken, setToken, clearSession } from "@/api/http";

const ACCOUNT_KEY = "admin_account";

function loadAccount() {
    try {
        return JSON.parse(localStorage.getItem(ACCOUNT_KEY));
    } catch {
        return null;
    }
}

export const useAuthStore = defineStore("auth", {
    state: () => ({
        token: getToken(),
        account: loadAccount(),
    }),
    getters: {
        isAuthenticated: (s) => !!s.token,
        role: (s) => s.account?.role || null,
        // 文档口径：staff 及以上可读列表；写操作多为 admin 专属
        isStaff: (s) => ["staff", "admin"].includes(s.account?.role),
        isAdmin: (s) => s.account?.role === "admin",
        displayName: (s) =>
            s.account?.username || s.account?.player_no || "管理员",
    },
    actions: {
        async login(payload) {
            const data = await apiLogin(payload);
            this.token = data.access_token;
            this.account = data.account;
            setToken(data.access_token);
            localStorage.setItem(ACCOUNT_KEY, JSON.stringify(data.account));
            return data;
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
