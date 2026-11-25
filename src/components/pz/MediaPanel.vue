<script setup>
// 本题素材面板（逐题）：两个子视图
//   · 本题可用 view=puzzle —— 该题作者的私有素材 + 公共素材（与保存校验同口径），
//     行带 usedInPage / marked，可直接「标记本题」；
//   · 本题已使用 view=used —— 页面引用 ∪ 本题标记，失效引用高亮并可取消标记清理。
//
// mistarg.2.4.0：标记只服务查询/展示，不参与渲染、保存校验与玩家下发。
import { computed, getCurrentScope, onScopeDispose, ref, useId, watch } from "vue";
import { ElMessage } from "element-plus";
import { listMedia } from "@/api/pz";
import { cancelChannel, isStaleRequest, requestLatest } from "@/api/http";
import { describeApiError } from "@/config/errors";
import MediaTable from "@/components/pz/MediaTable.vue";
import MediaUploader from "@/components/pz/MediaUploader.vue";

const props = defineProps({
    puzzleKey: { type: String, default: "" },
});

const emit = defineEmits(["changed"]);

// 子视图：本题可用 / 本题已使用
const mediaView = ref("puzzle");
const items = ref([]);
const loading = ref(false);
// view=used 的顶层 invalidRefs（页面里已失效的引用，只能在页面内容里清理）
const invalidRefs = ref([]);

const REASON_LABEL = {
    not_found: "素材不存在",
    disabled: "素材已停用",
    not_referenceable: "不可被本题引用",
};

// 切题代际守卫：一个面板实例一个频道。
// 只比对 key 不够 —— A→B→A 时两次 key 相同，迟到的第一次 A 仍会盖掉第二次 A 的结果。
const abortKey = `pz-media#${useId()}`;
if (getCurrentScope()) {
    onScopeDispose(() => cancelChannel(abortKey));
}

const params = computed(() => ({
    view: mediaView.value,
    puzzleKey: props.puzzleKey,
}));

async function load() {
    const key = props.puzzleKey;
    if (!key) {
        // 取消选中：中断在飞的请求并清空，否则迟到的响应会落在已经隐藏的面板上
        cancelChannel(abortKey);
        items.value = [];
        invalidRefs.value = [];
        if (mediaView.value === "puzzle") emit("changed", items.value);
        loading.value = false;
        return;
    }

    // 可用视图先清空并把空清单抛给父级：切题/加载期间，旧题的素材不能再留在
    // 封面与附件下拉里被选中（保存时会被后端以「素材不可引用」拒绝）
    const viewAtStart = mediaView.value;
    if (viewAtStart === "puzzle") {
        items.value = [];
        emit("changed", items.value);
    }
    invalidRefs.value = [];
    loading.value = true;
    try {
        const data = await requestLatest(abortKey, ({ signal }) =>
            listMedia(params.value, { signal }),
        );
        // 目标或视图已经换走：这次结果作废（loading 由最新一次收尾）
        if (key !== props.puzzleKey || viewAtStart !== mediaView.value) return;
        items.value = Array.isArray(data?.media) ? data.media : [];
        invalidRefs.value =
            viewAtStart === "used" && Array.isArray(data?.invalidRefs)
                ? data.invalidRefs
                : [];
        // 只有「可用」清单是页面表单（封面 / 附件下拉）的数据源
        if (viewAtStart === "puzzle") emit("changed", items.value);
        loading.value = false;
    } catch (error) {
        // 迟到的 / 被取代的错误同样别弹，它已经和当前选中的题无关了
        if (isStaleRequest(error) || key !== props.puzzleKey) return;
        loading.value = false;
        ElMessage.error(
            describeApiError(error, {
                fallback: "素材列表加载失败",
                forbidden: "无权查看该题素材",
            }),
        );
    }
}

watch(
    () => [props.puzzleKey, mediaView.value],
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
            <el-radio-group v-model="mediaView" size="small">
                <el-radio-button value="puzzle">本题可用</el-radio-button>
                <el-radio-button value="used">本题已使用</el-radio-button>
            </el-radio-group>
            <el-button size="small" :loading="loading" @click="load">刷新</el-button>
        </div>

        <!-- 上传只服务「本题可用」：素材归出题人，不再绑定某道题 -->
        <MediaUploader v-if="mediaView === 'puzzle'" label="上传素材" @uploaded="load" />

        <!-- 已失效的页面引用：系统不会自动改页面，需要去「页面内容」里清理 -->
        <el-alert
            v-if="mediaView === 'used' && invalidRefs.length"
            type="warning"
            :closable="false"
            show-icon
            :title="`有 ${invalidRefs.length} 处引用已失效`"
        >
            <div v-for="(ref, i) in invalidRefs" :key="i" class="invalid-ref">
                {{ ref.path || ref.where || "页面" }} · #{{ ref.assetId }} ·
                {{ REASON_LABEL[ref.reason] || ref.reason }}
            </div>
            <div class="invalid-ref-tip">
                请在「页面内容」里删除或替换这些引用后重新保存；标记类引用可用下方「取消标记」清理。
            </div>
        </el-alert>

        <MediaTable
            :rows="items"
            :loading="loading"
            :view="mediaView"
            :puzzle-key="puzzleKey"
            @refresh="load"
        />

        <p class="tip">
            {{
                mediaView === "puzzle"
                    ? "本题可用素材 = 该题作者的私有素材 + 公共素材。上传后默认归你的私有区；要给别的题或别人用，在「素材库 · 我的素材」里打开「允许他人使用」，再由管理员收录到公共区。"
                    : "本题已使用 = 页面引用 ∪ 本题标记。标记不会影响页面渲染、保存校验与玩家可见内容。"
            }}
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

.invalid-ref {
    font-size: 12px;
    line-height: 1.8;
}

.invalid-ref-tip {
    margin-top: 4px;
    font-size: 12px;
    color: var(--el-text-color-secondary);
}
</style>
