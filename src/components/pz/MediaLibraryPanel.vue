<script setup>
// 素材库：素材与题目分离（mistarg.2.3.0）后的管理中心，嵌在出题台右侧页签里。
//
// 子页签（按角色/权限显示）：
//   · 我的素材  view=owner（默认）——自己的私有素材与已收录的公共素材
//   · 公共素材  view=public ——所有人可引用；作者对其中自己的素材只能申请撤回
//   · 收录候选  view=usable&allowShare=1（admin）——从「已允许他人使用」的私有素材收录
//   · 撤回审批  view=public&withdrawRequested=1（admin）——同意 / 驳回作者申请
//
// 行内动作与权限口径都在 MediaTable 里，这里只负责取数与页签切换。
import { computed, ref, watch } from "vue";
import { ElMessage } from "element-plus";
import { useAuthStore } from "@/stores/auth";
import { listMedia } from "@/api/pz";
import { describeApiError } from "@/api/errors";
import MediaTable from "@/components/pz/MediaTable.vue";
import MediaUploader from "@/components/pz/MediaUploader.vue";

const auth = useAuthStore();

const TABS = [
    { name: "owner", label: "我的素材", upload: true },
    { name: "public", label: "公共素材", upload: false },
    { name: "usable", label: "收录候选", adminOnly: true },
    { name: "withdraw", label: "撤回审批", adminOnly: true },
];

const tabs = computed(() =>
    TABS.filter((tab) => !tab.adminOnly || auth.isAdmin),
);

const activeTab = ref("owner");
const rows = ref([]);
const loading = ref(false);
// 请求代号：快速切换页签时只接受最新一次
let seq = 0;

function paramsOf(name) {
    if (name === "public") return { view: "public" };
    if (name === "usable") return { view: "usable", allowShare: 1 };
    if (name === "withdraw") return { view: "public", withdrawRequested: 1 };
    return { view: "owner" };
}

async function load() {
    const current = ++seq;
    const name = activeTab.value;
    loading.value = true;
    try {
        const data = await listMedia(paramsOf(name));
        if (current !== seq) return;
        rows.value = Array.isArray(data?.media) ? data.media : [];
    } catch (error) {
        if (current !== seq) return;
        rows.value = [];
        ElMessage.error(
            describeApiError(error, {
                fallback: "素材列表加载失败",
                forbidden: "无权查看该素材列表",
            }),
        );
    } finally {
        if (current === seq) loading.value = false;
    }
}

watch(activeTab, () => {
    rows.value = [];
    load();
}, { immediate: true });

const activeUpload = computed(
    () => tabs.value.find((tab) => tab.name === activeTab.value)?.upload === true,
);
</script>

<template>
    <div class="media-library">
        <el-tabs v-model="activeTab" class="media-library__tabs">
            <el-tab-pane
                v-for="tab in tabs"
                :key="tab.name"
                :label="tab.label"
                :name="tab.name"
            />
        </el-tabs>

        <div class="media-library__toolbar">
            <!-- 我的素材：上传到自己的私有区（admin 也可选公共区 / 代传） -->
            <MediaUploader
                v-if="activeUpload"
                class="media-library__uploader"
                label="上传素材"
                @uploaded="load"
            />
            <span v-else class="tip">
                {{
                    activeTab === "public"
                        ? "公共素材所有出题人都可引用；已收录的素材只有管理员能修改。"
                        : activeTab === "usable"
                          ? "这里只列出作者已允许他人使用的私有素材。"
                          : "作者申请撤回公共素材后在此审批：同意后素材回到作者私有区。"
                }}
            </span>
            <el-button size="small" :loading="loading" @click="load">刷新</el-button>
        </div>

        <MediaTable :rows="rows" :loading="loading" :view="activeTab" @refresh="load" />
    </div>
</template>

<style scoped>
.media-library {
    display: flex;
    flex-direction: column;
    gap: 8px;
}

.media-library__tabs :deep(.el-tabs__header) {
    margin-bottom: 8px;
}

.media-library__toolbar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
}

.media-library__uploader {
    flex: 1;
    min-width: 320px;
}

.tip {
    color: var(--el-text-color-secondary);
    font-size: 12px;
    line-height: 1.7;
}
</style>
