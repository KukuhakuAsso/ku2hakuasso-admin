<script setup>
// 素材上传（sign → PUT 直传 → confirm 登记），本题面板与素材库共用。
//
// mistarg.2.3.0 起 sign / confirm 不再带 puzzleKey，归属由 scope / ownerId / objectKey 决定：
//   * 普通 staff 只能落到自己的私有区；
//   * admin 可直传公共区（scope=public），或用 ownerId 代传到指定出题人名下（私有）。
import { computed, reactive, ref } from "vue";
import { ElMessage } from "element-plus";
import { useAuthStore } from "@/stores/auth";
import { confirmMedia, signMedia, uploadToSignedUrl } from "@/api/pz";
import { describeApiError } from "@/api/errors";
import { MEDIA_KINDS, validateMediaFile } from "@/config/pz";

const props = defineProps({
    // 是否允许 admin 选择「公共区」（本题面板与素材库都允许）
    allowPublic: { type: Boolean, default: true },
    // 上传按钮的文案，便于区分场景
    label: { type: String, default: "上传素材" },
});
const emit = defineEmits(["uploaded"]);

const auth = useAuthStore();

const uploading = ref(false);
const progress = ref(0);
const file = ref(null);
// scope=private：自己的私有区（admin 可用 ownerId 代传）；scope=public：公共区
const target = reactive({ scope: "private", ownerId: "" });

const accept = computed(() =>
    MEDIA_KINDS.flatMap((kind) => kind.exts.map((ext) => `.${ext}`)).join(","),
);

const hint = computed(() =>
    MEDIA_KINDS.map(
        (kind) => `${kind.label} ≤ ${Math.round(kind.maxBytes / 1024 / 1024)}MB`,
    ).join(" · "),
);

function pickFile(event) {
    const picked = event.target.files?.[0] ?? null;
    if (!picked) return;

    const check = validateMediaFile(picked);
    if (!check.ok) {
        ElMessage.error(check.message);
        event.target.value = "";
        return;
    }
    file.value = picked;
}

function scopePayload() {
    if (!auth.isAdmin) return {};
    if (target.scope === "public") return { scope: "public" };
    const ownerId = target.ownerId.trim();
    return ownerId ? { ownerId: Number(ownerId) } : {};
}

async function upload() {
    if (!file.value || uploading.value) return;

    const picked = file.value;
    const check = validateMediaFile(picked);
    if (!check.ok) {
        ElMessage.error(check.message);
        return;
    }
    if (
        auth.isAdmin &&
        target.scope === "private" &&
        target.ownerId.trim() &&
        !/^\d+$/.test(target.ownerId.trim())
    ) {
        ElMessage.warning("代传目标需填写出题人账号 ID（数字）");
        return;
    }

    const extra = scopePayload();
    uploading.value = true;
    progress.value = 0;
    try {
        // 1) 拿直传地址（只在内存里用，不落 localStorage、不打日志）
        const signed = await signMedia({
            filename: picked.name,
            mime: check.mime,
            sizeBytes: check.sizeBytes,
            ...extra,
        });
        const uploadInfo = signed?.upload;
        if (!uploadInfo?.url) throw new Error("未获取到上传地址");

        // 2) 直传对象存储（不经过后端）
        await uploadToSignedUrl(uploadInfo, picked, (value) => {
            progress.value = value;
        }).promise;

        // 3) 确认登记（归属由服务端从 objectKey 解析，不要自拼）
        await confirmMedia({
            objectKey: uploadInfo.objectKey,
            filename: picked.name,
            mime: check.mime,
            sizeBytes: check.sizeBytes,
        });

        ElMessage.success("素材已上传并登记");
        file.value = null;
        emit("uploaded");
    } catch (error) {
        ElMessage.error(
            describeApiError(error, {
                fallback: "上传失败",
                forbidden: "只能上传到自己名下的私有区",
            }),
        );
    } finally {
        uploading.value = false;
    }
}

defineExpose({ uploading });
</script>

<template>
    <div class="media-uploader">
        <div class="media-uploader__row">
            <input type="file" :accept="accept" :disabled="uploading" @change="pickFile" />
            <!-- admin 才可选归属；staff 固定落到自己的私有区 -->
            <template v-if="auth.isAdmin && allowPublic">
                <el-select v-model="target.scope" size="small" style="width: 140px">
                    <el-option label="我的私有区" value="private" />
                    <el-option label="公共区" value="public" />
                </el-select>
                <el-input
                    v-if="target.scope === 'private'"
                    v-model="target.ownerId"
                    size="small"
                    style="width: 170px"
                    placeholder="代传给出题人 ID（可选）"
                />
            </template>
            <el-button
                size="small"
                type="primary"
                :disabled="!file || uploading"
                :loading="uploading"
                @click="upload"
            >
                {{ label }}{{ file ? `（${file.name}）` : "" }}
            </el-button>
        </div>

        <el-progress v-if="uploading" :percentage="progress" :stroke-width="6" />

        <p class="tip">{{ hint }}</p>
    </div>
</template>

<style scoped>
.media-uploader {
    display: flex;
    flex-direction: column;
    gap: 8px;
}

.media-uploader__row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
}

.tip {
    margin: 0;
    color: var(--el-text-color-secondary);
    font-size: 12px;
}
</style>
