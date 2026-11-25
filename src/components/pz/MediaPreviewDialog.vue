<script setup>
// 素材预览：预览下发走 GET /api/admin/pz/media/:id（admin 任意；出题人自己的全部素材 +
// 任何公共素材；其余 403；不存在/停用 404；成功 302 到签名地址）。
// 该地址要带 Bearer，原生标签放不出请求头，所以图片/音视频由 useProtectedMedia 取字节转 blob。
import { computed } from "vue";
import PreviewAttachment from "@/components/pz/PreviewAttachment.vue";

const props = defineProps({
    modelValue: { type: Boolean, default: false },
    row: { type: Object, default: null },
});

const emit = defineEmits(["update:modelValue"]);

const INLINE_TYPES = ["image", "video", "audio"];

const type = computed(() => props.row?.mediaType || "file");
const isPublic = computed(() => props.row?.scope === "public");

const attachment = computed(() => {
    const row = props.row;
    if (!row) return null;
    const base = `/api/admin/pz/media/${row.id}`;
    // pdf / file 不能内联渲染，带 download=1 走「下载」语义（文件名由响应决定）
    return {
        type: type.value,
        url: INLINE_TYPES.includes(type.value) ? base : `${base}?download=1`,
        name: row.filename || `素材 #${row.id}`,
        sizeBytes: row.sizeBytes,
        durationSec: row.durationSec,
        note: row.note || "",
    };
});

function close() {
    emit("update:modelValue", false);
}
</script>

<template>
    <el-dialog
        :model-value="modelValue"
        title="素材预览"
        width="640px"
        append-to-body
        @update:model-value="emit('update:modelValue', $event)"
    >
        <div v-if="row" class="media-preview">
            <p class="media-preview__meta">
                #{{ row.id }} ·
                <el-tag size="small" :type="isPublic ? 'success' : 'info'" effect="plain">
                    {{ isPublic ? "公共" : "私有" }}
                </el-tag>
                <template v-if="row.ownerUsername"> · {{ row.ownerUsername }}</template>
            </p>
            <PreviewAttachment v-if="attachment" :item="attachment" />
        </div>
        <template #footer>
            <el-button @click="close">关闭</el-button>
        </template>
    </el-dialog>
</template>

<style scoped>
.media-preview {
    display: flex;
    flex-direction: column;
    gap: 10px;
}

.media-preview__meta {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 0;
    color: var(--el-text-color-secondary);
    font-size: 12px;
}
</style>
