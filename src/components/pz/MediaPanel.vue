<script setup>
// 本题素材面板：按 view=puzzle 取「本题可用素材」（该题作者的私有素材 + 公共素材），
// 与保存页面时的引用校验同口径；上传走共用的 MediaUploader。
//
// 素材与题目分离（mistarg.2.3.0）后，这里不再承担「素材管理」职责：
// 改名 / 允许他人使用 / 收录 / 撤回都在「素材库」页签里做。
import { getCurrentScope, onScopeDispose, ref, useId, watch } from "vue";
import { ElMessage } from "element-plus";
import { listMedia } from "@/api/pz";
import { cancelChannel, isStaleRequest, requestLatest } from "@/api/http";
import { describeApiError } from "@/api/errors";
import MediaTable from "@/components/pz/MediaTable.vue";
import MediaUploader from "@/components/pz/MediaUploader.vue";

const props = defineProps({
    puzzleKey: { type: String, default: "" },
});

const emit = defineEmits(["changed"]);

const items = ref([]);
const loading = ref(false);

// 切题代际守卫：一个面板实例一个频道。
// 只比对 key 不够 —— A→B→A 时两次 key 相同，迟到的第一次 A 仍会盖掉第二次 A 的结果。
const abortKey = `pz-media#${useId()}`;
if (getCurrentScope()) {
    onScopeDispose(() => cancelChannel(abortKey));
}

async function load() {
    const key = props.puzzleKey;
    if (!key) {
        // 取消选中：中断在飞的请求并清空，否则迟到的响应会落在已经隐藏的面板上
        cancelChannel(abortKey);
        items.value = [];
        emit("changed", items.value);
        loading.value = false;
        return;
    }

    // 先清空并把空清单抛给父级：切题/加载期间，旧题的素材不能再留在
    // 封面与附件下拉里被选中（保存时会被后端以「素材不可引用」拒绝）
    items.value = [];
    emit("changed", items.value);

    loading.value = true;
    try {
        const data = await requestLatest(abortKey, ({ signal }) =>
            listMedia({ view: "puzzle", puzzleKey: key }, { signal }),
        );
        // 目标已经换走：这次结果属于另一道题，丢弃（loading 由最新一次收尾）
        if (key !== props.puzzleKey) return;
        items.value = data?.media ?? [];
        emit("changed", items.value);
        loading.value = false;
    } catch (error) {
        // 迟到的 / 被取代的错误同样别弹，它已经和当前选中的题无关了
        if (isStaleRequest(error) || key !== props.puzzleKey) return;
        loading.value = false;
        ElMessage.error(
            describeApiError(error, {
                fallback: "素材列表加载失败",
                forbidden: "无权查看该题可用素材",
            }),
        );
    }
}

watch(
    () => props.puzzleKey,
    () => {
        load();
    },
    { immediate: true },
);

defineExpose({ reload: load, items });
</script>

<template>
    <div class="media-panel">
        <div class="media-panel__head">
            <span class="tip">
                本题可用素材 = 该题作者的私有素材 + 公共素材
            </span>
            <el-button size="small" :loading="loading" @click="load">刷新</el-button>
        </div>

        <MediaUploader label="上传素材" @uploaded="load" />

        <MediaTable :rows="items" :loading="loading" view="puzzle" @refresh="load" />

        <p class="tip">
            上传后默认归你的私有区。要让别的题或别人用：到「素材库 · 我的素材」打开
            「允许他人使用」，再由管理员收录到公共区。
        </p>
    </div>
</template>

<style scoped>
.media-panel {
    display: flex;
    flex-direction: column;
    gap: 10px;
}

.media-panel__head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
}

.tip {
    margin: 0;
    color: var(--el-text-color-secondary);
    font-size: 12px;
    line-height: 1.7;
}
</style>
