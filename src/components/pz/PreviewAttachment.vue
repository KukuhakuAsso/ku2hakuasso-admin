<script setup>
// 预览里的单个附件。附件 URL 走 /api/admin/pz/media/:id（受鉴权保护），
// 图片/音视频要用 blob URL；pdf/file 只能先取字节再交给浏览器打开或下载。
import { computed, ref } from "vue";
import { ElMessage } from "element-plus";
import { fetchResource } from "@/api/http";
import { extractErrorMessage } from "@/api/errors";
import { useMediaObjectUrl } from "@/composables/useProtectedMedia";

const props = defineProps({
    item: { type: Object, required: true },
});

const TYPE_LABEL = {
    image: "图片",
    video: "视频",
    audio: "音频",
    pdf: "PDF",
    file: "文件",
    link: "链接",
};

const type = computed(() => props.item?.type ?? "file");
const isLink = computed(() => type.value === "link");
const isMedia = computed(() =>
    ["image", "video", "audio"].includes(type.value),
);

const { src, status, error } = useMediaObjectUrl(() =>
    isMedia.value ? props.item?.url ?? "" : "",
);

const opening = ref(false);

function formatSize(bytes) {
    const value = Number(bytes);
    if (!Number.isFinite(value) || value < 0) return "";
    if (value < 1024) return `${value} B`;
    if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
    return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function formatDuration(sec) {
    const value = Number(sec);
    if (!Number.isFinite(value) || value <= 0) return "";
    const m = Math.floor(value / 60);
    const s = Math.round(value % 60);
    return m > 0 ? `${m}分${s}秒` : `${s}秒`;
}

// pdf / file：blob 不能直接在新标签打开（跨标签会失效），
// 这里用 <a download> 走「下载」语义；文件名取附件展示名。
async function openFile() {
    if (opening.value) return;
    opening.value = true;
    try {
        const res = await fetchResource(props.item.url, { accept: "*/*" });
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = props.item.name || "download";
        a.rel = "noopener";
        document.body.appendChild(a);
        a.click();
        a.remove();
        // 下载已经开始，稍后再释放
        setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (err) {
        ElMessage.error(extractErrorMessage(err, "文件打开失败"));
    } finally {
        opening.value = false;
    }
}
</script>

<template>
    <div class="pv-attachment">
        <div class="pv-attachment__head">
            <el-tag size="small" type="info">{{ TYPE_LABEL[type] || type }}</el-tag>
            <span class="pv-attachment__name">{{ item.name }}</span>
            <span v-if="formatSize(item.sizeBytes)" class="pv-attachment__meta">
                {{ formatSize(item.sizeBytes) }}
            </span>
            <span v-if="formatDuration(item.durationSec)" class="pv-attachment__meta">
                {{ formatDuration(item.durationSec) }}
            </span>
            <a
                v-if="isLink"
                class="pv-attachment__link"
                :href="item.url"
                target="_blank"
                rel="noopener noreferrer"
            >
                打开外链
            </a>
            <el-button
                v-else-if="!isMedia"
                size="small"
                text
                type="primary"
                :loading="opening"
                @click="openFile"
            >
                下载
            </el-button>
        </div>

        <p v-if="item.note" class="pv-attachment__note">{{ item.note }}</p>

        <template v-if="isMedia">
            <el-skeleton v-if="status === 'loading'" :rows="3" animated />
            <p v-else-if="status === 'error'" class="pv-attachment__error">
                {{ error || "附件加载失败" }}
            </p>
            <img
                v-else-if="type === 'image' && status === 'ready'"
                class="pv-attachment__image"
                :src="src"
                :alt="item.name"
            />
            <video
                v-else-if="type === 'video' && status === 'ready'"
                class="pv-attachment__player"
                :src="src"
                controls
            />
            <audio
                v-else-if="type === 'audio' && status === 'ready'"
                class="pv-attachment__player"
                :src="src"
                controls
            />
        </template>
    </div>
</template>

<style scoped>
.pv-attachment {
    display: flex;
    flex-direction: column;
    gap: 8px;
}

.pv-attachment__head {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
    font-size: 13px;
}

.pv-attachment__name {
    color: var(--el-text-color-primary);
}

.pv-attachment__meta {
    color: var(--el-text-color-secondary);
    font-size: 12px;
}

.pv-attachment__link {
    color: var(--el-color-primary);
    font-size: 12px;
}

.pv-attachment__note {
    margin: 0;
    font-size: 12px;
    color: var(--el-text-color-secondary);
}

.pv-attachment__error {
    margin: 0;
    font-size: 12px;
    color: var(--el-color-danger);
}

.pv-attachment__image {
    max-width: 100%;
    border: 1px solid var(--el-border-color-light);
    border-radius: 4px;
}

.pv-attachment__player {
    width: 100%;
    max-width: 480px;
}
</style>
