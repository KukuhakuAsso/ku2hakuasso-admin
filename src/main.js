import { createApp } from "vue";
import { createPinia } from "pinia";
import ElementPlus from "element-plus";
import "element-plus/dist/index.css";
import zhCn from "element-plus/es/locale/lang/zh-cn";
import * as ElementPlusIconsVue from "@element-plus/icons-vue";
import App from "./App.vue";
import { router } from "./router";
import { useAuthStore } from "./stores/auth";
import "./style.css";

const app = createApp(App);
const pinia = createPinia();

for (const [key, component] of Object.entries(ElementPlusIconsVue)) {
    app.component(key, component);
}

app.use(pinia);
app.use(router);
app.use(ElementPlus, { locale: zhCn });

const auth = useAuthStore(pinia);

window.addEventListener("admin:unauthorized", () => {
    // 只清了 localStorage 还不够：pinia 里的令牌还在，守卫会认为「已登录」并把
    // /login 弹回 /dashboard，界面就卡在一个请求全部 401 的页面上
    auth.reset();
    if (router.currentRoute.value.path !== "/login") {
        router.replace("/login");
    }
});

// 刷新令牌（含请求遇到 401 时的自动刷新）会带回最新的 account.permissions，
// 同步到 store，避免权限被撤销 / 新增后界面还停在旧快照
window.addEventListener("admin:account-updated", (event) => {
    auth.applyAccount(event.detail);
});

app.mount("#app");

// 会话还原：用刷新令牌换一次最新权限快照。被授予权限组的 staff 重新打开页面后
// 就能看到新入口，不必等到重新登录（失败时保留本地快照，不影响使用）
auth.syncAccount();
