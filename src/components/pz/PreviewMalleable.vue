<script setup>
// 预览里的可塑区：只负责容器、骨架与兜底；组件内部排版由组件自己负责。
// 组件包内联了自己的 Vue 运行时，跨边界只传纯数据（props）。
import { computed, h, onBeforeUnmount, shallowRef, watch } from "vue";
import { useMalleableWidget } from "@/composables/useAdminMalleableWidget";
import { createPreviewPzBridge } from "@/utils/previewPzBridge";

const props = defineProps({
    malleable: { type: Object, required: true },
    // 组件题状态桥的 key；预览不下发 runtime，桥固定为只读
    puzzleKey: { type: String, default: "" },
    // 完整预览视图，透给组件的 pz.snapshot().view
    view: { type: Object, default: null },
});

const isComponent = computed(() => props.malleable?.kind === "component");
const isIframe = computed(() => props.malleable?.kind === "iframe");

const minHeight = computed(() => {
    const value = Number(props.malleable?.minHeight);
    return Number.isFinite(value) && value > 0 ? value : 320;
});

const widgetProps = computed(() => props.malleable?.props ?? {});
const asset = computed(() => props.malleable?.asset ?? null);

const { status, error, tag, ensure, cancel } = useMalleableWidget();

// 管理端预览只读：组件仍拿到 pz（契约 pz-bridge@0.2），但 rpc 一律 reject E_PREVIEW。
const bridge = shallowRef(null);
let bridgeSignature = null;

watch(
    () => [props.puzzleKey, tag.value],
    () => {
        const signature = `${props.puzzleKey}\u0000${tag.value}`;
        if (bridge.value && signature === bridgeSignature) return;
        bridge.value?.dispose();
        bridgeSignature = signature;
        bridge.value = createPreviewPzBridge({
            puzzleKey: props.puzzleKey,
            view: props.view,
        });
    },
    { immediate: true },
);

watch(
    () => props.view,
    (view) => bridge.value?.setView(view),
);

// 用 render 函数挂自定义元素：props 走 DOM property 而不是 attribute，
// 这样出题人配置的对象不会被序列化成字符串。
//
// 这里**故意不做** props 白名单：组件代码本身就是出题人写的任意 JS，
// import() 已在管理端窗口里执行它了，过滤 innerHTML / on* 只是换个入口，
// 挡不住任何真实风险却会拦住合法用法。唯一有效的边界是把整个组件执行
// 搬进无凭证的沙箱（见 useAdminMalleableWidget 的说明）。
const WidgetHost = {
    props: {
        tag: { type: String, required: true },
        widgetProps: { type: Object, default: () => ({}) },
        pz: { type: Object, default: null },
    },
    setup(hostProps) {
        return () =>
            h(hostProps.tag, {
                ...hostProps.widgetProps,
                ...(hostProps.pz ? { pz: hostProps.pz } : {}),
            });
    },
};

watch(
    asset,
    (value) => {
        if (isComponent.value) ensure(value ?? null);
    },
    { immediate: true },
);

onBeforeUnmount(() => {
    bridge.value?.dispose();
    bridge.value = null;
    cancel();
});

function retry() {
    ensure(asset.value ?? null);
}
</script>

<template>
    <div class="pv-malleable" :class="{ 'is-wide': malleable.wide }">
        <div class="pv-malleable__frame" :style="{ minHeight: `${minHeight}px` }">
            <template v-if="isComponent">
                <WidgetHost
                    v-if="status === 'ready'"
                    :tag="tag"
                    :widget-props="widgetProps"
                    :pz="bridge"
                    class="pv-malleable__host"
                />
                <div v-else-if="status === 'error'" class="pv-malleable__fallback">
                    <p>{{ error || "可塑区组件加载失败" }}</p>
                    <el-button size="small" @click="retry">重试</el-button>
                </div>
                <div v-else class="pv-malleable__skeleton" aria-hidden="true" />
            </template>

            <!-- 外链题：预览地址可能带短时 pz_ticket（mode=preview），原样透传即可；
                 由 iframe 页面自行从 location.hash 读取，管理端不读、不写日志。 -->
            <iframe
                v-else-if="isIframe"
                class="pv-malleable__iframe"
                :src="malleable.url"
                :style="{ minHeight: `${minHeight}px` }"
                loading="lazy"
                referrerpolicy="no-referrer"
                allow="fullscreen"
            />

            <div v-else class="pv-malleable__fallback">
                <p>{{ malleable.name || "本题没有可交互区域" }}</p>
            </div>
        </div>
    </div>
</template>

<style scoped>
.pv-malleable {
    display: flex;
    justify-content: center;
}

.pv-malleable__frame {
    position: relative;
    display: flex;
    flex-direction: column;
    width: 100%;
    padding: 12px;
    border: 1px solid var(--el-border-color-light);
    border-radius: 4px;
    background: #fff;
}

.pv-malleable__host {
    display: block;
    width: 100%;
}

.pv-malleable__iframe {
    width: 100%;
    flex: 1;
    border: 0;
    border-radius: 2px;
    background: #f5f7fa;
}

.pv-malleable__skeleton {
    flex: 1;
    border-radius: 2px;
    background: repeating-linear-gradient(
        90deg,
        rgba(0, 0, 0, 0.05) 0 2px,
        transparent 2px 12px
    );
    animation: pv-malleable-pulse 1.6s ease-in-out infinite;
}

@keyframes pv-malleable-pulse {
    0%,
    100% {
        opacity: 0.5;
    }
    50% {
        opacity: 0.85;
    }
}

.pv-malleable__fallback {
    display: flex;
    flex: 1;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 10px;
    padding: 24px;
    border: 1px dashed var(--el-border-color);
    border-radius: 2px;
    font-size: 13px;
    color: var(--el-text-color-secondary);
    text-align: center;
}

.pv-malleable__fallback p {
    margin: 0;
}
</style>
