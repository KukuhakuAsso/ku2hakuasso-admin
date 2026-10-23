<script setup>
// 素材面板：sign（拿直传地址）→ PUT 直传 → confirm（登记）。
//
// api-12 的三条硬约束：
//   * objectKey 原样传回，不自行生成；
//   * 上传地址 10 分钟有效，且含临时授权 —— 不打印日志、不持久化、不进缓存；
//   * confirm 幂等：重复确认同一 objectKey 返回已有素材。
import { computed, ref, watch } from "vue";
import { ElMessage } from "element-plus";
import { listMedia, signMedia, confirmMedia, uploadToSignedUrl } from "@/api/pz";
import { MEDIA_KINDS, validateMediaFile } from "@/config/pz";

const props = defineProps({
    puzzleKey: { type: String, default: "" },
});

const emit = defineEmits(["changed"]);

const items = ref([]);
const loading = ref(false);
const uploading = ref(false);
const progress = ref(0);
const file = ref(null);

const accept = computed(() =>
    MEDIA_KINDS.flatMap((kind) => kind.exts.map((ext) => `.${ext}`)).join(","),
);

const hint = computed(() =>
    MEDIA_KINDS.map(
        (kind) => `${kind.label} ≤ ${Math.round(kind.maxBytes / 1024 / 1024)}MB`,
    ).join(" · "),
);

// 每次加载都 +1；晚到的响应靠它判断自己是否已被后续加载取代。
// 只比 key 不够 —— A→B→A 时两次 key 相同，晚到的 A 仍会盖掉第二次的 A。
let loadSeq = 0;

function isStaleLoad(seq, key) {
    return seq !== loadSeq || key !== props.puzzleKey;
}

async function load() {
    const key = props.puzzleKey;
    const seq = ++loadSeq;

    // 先清空并把空清单抛给父级：切题/加载期间，旧题的素材不能再留在
    // 封面与附件下拉里被选中（保存时会被后端以「素材不属于本题」拒绝）
    items.value = [];
    emit("changed", items.value);

    if (!key) {
        loading.value = false;
        return;
    }

    loading.value = true;
    try {
        const data = await listMedia(key);
        // 迟到的响应直接丢弃，否则会把旧题的素材塞进新题的下拉
        if (isStaleLoad(seq, key)) return;
        items.value = data?.media ?? [];
        emit("changed", items.value);
    } catch (error) {
        // 迟到的错误同样别弹，它已经和当前选中的题无关了
        if (isStaleLoad(seq, key)) return;
        ElMessage.error(error?.message || "素材列表加载失败");
    } finally {
        // 只有最新一次加载能收起 loading，否则会把新题的转圈关掉
        if (!isStaleLoad(seq, key)) loading.value = false;
    }
}

watch(
    () => props.puzzleKey,
    () => {
        file.value = null;
        progress.value = 0;
        load();
    },
    { immediate: true },
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

async function upload() {
    if (!props.puzzleKey || !file.value || uploading.value) return;

    // 上传期间用户可能切题：watch 会把 file.value 清成 null、puzzleKey 换成新题。
    // 三步（sign → PUT → confirm）必须都落在同一个题、同一个文件上，
    // 所以先快照下来，后续一律用快照，不再读 props / file.value。
    const puzzleKey = props.puzzleKey;
    const picked = file.value;

    const check = validateMediaFile(picked);
    if (!check.ok) {
        ElMessage.error(check.message);
        return;
    }

    uploading.value = true;
    progress.value = 0;
    try {
        // 1) 拿直传地址（只在内存里用，不落 localStorage、不打日志）
        const signed = await signMedia({
            puzzleKey,
            filename: picked.name,
            mime: check.mime,
            sizeBytes: check.sizeBytes,
        });
        const uploadInfo = signed?.upload;
        if (!uploadInfo?.url) throw new Error("未获取到上传地址");

        // 2) 直传对象存储（不经过后端）
        await uploadToSignedUrl(uploadInfo, picked, (value) => {
            // 已经切题了就别把进度写到新题的进度条上
            if (props.puzzleKey === puzzleKey) progress.value = value;
        }).promise;

        // 3) 确认登记
        await confirmMedia({
            puzzleKey,
            objectKey: uploadInfo.objectKey,
            filename: picked.name,
            mime: check.mime,
            sizeBytes: check.sizeBytes,
        });

        ElMessage.success("素材已上传并登记");
        // 只在文件没被换过时清空，否则会把用户为新题刚选的文件也清掉
        if (file.value === picked) file.value = null;
        // load() 内部会把清单 emit 给父级，这里不用再 emit 一次
        await load();
    } catch (error) {
        ElMessage.error(error?.message || "上传失败");
    } finally {
        uploading.value = false;
    }
}

defineExpose({ reload: load, items });
</script>

<template>
    <div class="media-panel">
        <div class="media-panel__head">
            <span class="tip">{{ hint }}</span>
            <el-button size="small" :loading="loading" @click="load">刷新</el-button>
        </div>

        <div class="media-panel__upload">
            <input
                type="file"
                :accept="accept"
                :disabled="!puzzleKey || uploading"
                @change="pickFile"
            />
            <el-button
                size="small"
                type="primary"
                :disabled="!file || uploading"
                :loading="uploading"
                @click="upload"
            >
                上传{{ file ? `（${file.name}）` : "" }}
            </el-button>
        </div>

        <el-progress
            v-if="uploading"
            :percentage="progress"
            :stroke-width="6"
            style="margin-bottom: 8px"
        />

        <el-table v-loading="loading" :data="items" size="small" border>
            <el-table-column prop="id" label="ID" width="70" />
            <el-table-column label="文件" min-width="160">
                <template #default="{ row }">{{ row.filename || "—" }}</template>
            </el-table-column>
            <el-table-column label="类型" width="80">
                <template #default="{ row }">{{ row.mediaType || "—" }}</template>
            </el-table-column>
            <el-table-column label="大小" width="90">
                <template #default="{ row }">
                    {{ Math.round((row.sizeBytes || 0) / 1024) }} KB
                </template>
            </el-table-column>
            <el-table-column label="状态" width="80">
                <template #default="{ row }">
                    <el-tag :type="row.status === 1 ? 'success' : 'info'" size="small">
                        {{ row.status === 1 ? "可用" : "停用" }}
                    </el-tag>
                </template>
            </el-table-column>
        </el-table>
    </div>
</template>

<style scoped>
.media-panel__head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin-bottom: 8px;
}

.media-panel__upload {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 10px;
}

.media-panel__upload input {
    flex: 1;
    min-width: 0;
    font-size: 12px;
}

.tip {
    font-size: 12px;
    color: var(--el-text-color-secondary);
    line-height: 1.5;
}
</style>
