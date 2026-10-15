import { createApp } from "vue";
import { createPinia } from "pinia";
import ElementPlus from "element-plus";
import "element-plus/dist/index.css";
import zhCn from "element-plus/es/locale/lang/zh-cn";
import * as ElementPlusIconsVue from "@element-plus/icons-vue";
import App from "./App.vue";
import { router } from "./router";
import "./style.css";

const app = createApp(App);

for (const [key, component] of Object.entries(ElementPlusIconsVue)) {
    app.component(key, component);
}

app.use(createPinia());
app.use(router);
app.use(ElementPlus, { locale: zhCn });

// 会话失效时统一跳转登录页
window.addEventListener("admin:unauthorized", () => {
    if (router.currentRoute.value.path !== "/login") {
        router.replace("/login");
    }
});

app.mount("#app");
