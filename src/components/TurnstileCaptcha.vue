<template>
    <div class="captcha">
        <div ref="container" class="captcha__widget"></div>
        <p v-if="!enabled" class="captcha__state">当前环境未启用人机验证</p>
        <p v-else-if="token" class="captcha__state is-ok">人机验证已通过</p>
        <p v-else-if="used" class="captcha__state">
            本次验证已用于发送验证码，重新发送前请点击「重新验证」。
        </p>
        <p v-else-if="!ready" class="captcha__state">
            注册暂不可用（人机验证未就绪）
        </p>
    </div>
</template>

<script setup>
import {
    computed,
    nextTick,
    onBeforeUnmount,
    onMounted,
    ref,
    watch,
} from "vue";

// 人机验证的通用包装（当前后端下发 Turnstile）。
// 前端只认 reg/config 的 captcha.widget.driver / params 与 captcha.script，
// 不按 mode 分支，也不解释 provider 细节。
const props = defineProps({
    // reg/config 的 captcha 对象
    captcha: { type: Object, default: () => ({}) },
});
const emit = defineEmits(["update:token"]);

const container = ref(null);
const token = ref("");
// 凭据是一次性的：发过验证码后组件仍停在「已验证」，但服务端已经用掉了
const used = ref(false);
let widgetId = null;
// 容器是否已可见：人机验证组件在隐藏容器（未激活的页签、未打开的弹窗）里
// 渲染会得到 0 尺寸的挂件，所以等它真正可见时再渲染
const visible = ref(false);
let observer = null;

const enabled = computed(() => Boolean(props.captcha?.enabled));
const ready = computed(
    () => enabled.value && Boolean(props.captcha?.ready) &&
        Boolean(props.captcha?.widget),
);

// 同一份脚本只注入一次，多个组件（注册 + 找回密码）共用
const scriptTasks = new Map();

function ensureScript(url) {
    if (!url) return Promise.resolve();
    if (window.turnstile) return Promise.resolve();

    const existing = scriptTasks.get(url);
    if (existing) return existing;

    const task = new Promise((resolve, reject) => {
        const selector = `script[data-captcha-script="${url}"]`;
        const found = document.querySelector(selector);
        if (found) {
            found.addEventListener("load", () => resolve(), { once: true });
            found.addEventListener(
                "error",
                () => reject(new Error("人机验证脚本加载失败")),
                { once: true },
            );
            return;
        }

        const script = document.createElement("script");
        script.src = url;
        script.async = true;
        script.defer = true;
        script.setAttribute("data-captcha-script", url);
        script.onload = () => resolve();
        script.onerror = () => reject(new Error("人机验证脚本加载失败"));
        document.head.appendChild(script);
    });

    scriptTasks.set(url, task);
    return task;
}

function setToken(value) {
    token.value = value || "";
    if (token.value) used.value = false;
    emit("update:token", token.value);
}

function removeWidget() {
    if (widgetId !== null && window.turnstile?.remove) {
        try {
            window.turnstile.remove(widgetId);
        } catch {
            // 组件已被移除时忽略
        }
    }
    widgetId = null;
}

// 渲染（或重建）验证组件；配置未就绪、缺容器或缺脚本时跳过
function renderWidget() {
    const captcha = props.captcha || {};
    const widget = captcha.widget;
    const siteKey = widget?.params?.site_key || captcha.site_key;

    if (
        !captcha.enabled ||
        !captcha.ready ||
        !widget ||
        !siteKey ||
        !container.value ||
        !window.turnstile
    ) {
        return;
    }

    removeWidget();
    widgetId = window.turnstile.render(container.value, {
        sitekey: siteKey,
        ...(widget.params || {}),
        callback: (value) => setToken(value),
        "expired-callback": () => setToken(""),
        "error-callback": () => setToken(""),
    });
}

async function setup() {
    const captcha = props.captcha || {};
    if (!captcha.enabled || !captcha.ready || !captcha.widget) return;

    try {
        await ensureScript(captcha.script);
    } catch {
        return;
    }

    await nextTick();
    observeVisibility();
}

// 容器可见时才渲染；不支持 IntersectionObserver 的环境直接渲染
function observeVisibility() {
    if (!container.value || typeof IntersectionObserver === "undefined") {
        visible.value = true;
        renderWidget();
        return;
    }
    if (observer) {
        // 配置晚到（reg/config 异步返回）时容器可能早就可见了，这里补一次渲染
        if (visible.value && widgetId === null) renderWidget();
        return;
    }

    observer = new IntersectionObserver((entries) => {
        for (const entry of entries) {
            visible.value = entry.isIntersecting;
            if (entry.isIntersecting && widgetId === null) {
                renderWidget();
            }
        }
    });
    observer.observe(container.value);
}

// 需要一份新凭据时调用：清空旧凭据并重建组件
function reset() {
    setToken("");
    used.value = false;
    removeWidget();
    // 隐藏状态下不渲染，等 visible 变 true 时由观察器补渲染
    if (visible.value) renderWidget();
}

// 发码成功后凭据已被服务端消费：只标记，不立刻重建组件（免得用户什么都没点又要验一次）
function markUsed() {
    token.value = "";
    used.value = true;
    emit("update:token", "");
}

defineExpose({ reset, markUsed });

onMounted(setup);

watch(() => props.captcha, setup, { deep: false });

onBeforeUnmount(() => {
    observer?.disconnect();
    observer = null;
    removeWidget();
});
</script>

<style scoped>
.captcha {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-bottom: 18px;
}
.captcha__widget {
    min-height: 64px;
}
.captcha__state {
    margin: 0;
    color: #8a94a6;
    font-size: 12px;
    line-height: 1.6;
}
.captcha__state.is-ok {
    color: #2f9e44;
}
</style>
