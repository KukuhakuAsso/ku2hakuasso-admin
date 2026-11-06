<script setup>
// 服务端全量草稿预览（api-12 § 题目预览）。
//
// 与「预览描述」（本地前端渲染）不同：这里拿的是后端按玩家 view 形状组装的草稿，
// 跳过进度解锁、停用题也能看、提示全部带正文，资源 URL 换成了管理端下发路径。
//
// 所有资源（封面 / 描述内联图 / 附件 / 组件 ESM）都需要 Authorization，
// 原生标签带不上，统一走 blob（见 composables/useProtectedMedia、api/http.fetchResource）。
import { computed, ref, watch } from "vue";
import { getPuzzlePreview } from "@/api/pz";
import { extractErrorMessage, describeApiError } from "@/api/errors";
import { useMediaObjectUrl, useMarkdownMedia } from "@/composables/useProtectedMedia";
import { renderMarkdown } from "@/utils/miniMarkdown";
import PreviewMalleable from "@/components/pz/PreviewMalleable.vue";
import PreviewAttachment from "@/components/pz/PreviewAttachment.vue";

const props = defineProps({
    modelValue: { type: Boolean, default: false },
    puzzleKey: { type: String, default: "" },
});
const emit = defineEmits(["update:modelValue"]);

const visible = computed({
    get: () => props.modelValue,
    set: (value) => emit("update:modelValue", value),
});

const loading = ref(false);
const error = ref("");
const preview = ref(null);

const cover = computed(() => preview.value?.cover ?? null);
const attachments = computed(() => preview.value?.attachments ?? []);
const hints = computed(() => preview.value?.hints ?? []);

// 封面同样受鉴权保护：取字节转 blob，关窗时 preview 清空 → src 归空 → 释放
const { src: coverSrc, status: coverStatus, error: coverError } = useMediaObjectUrl(
    () => cover.value?.url ?? "",
);

// 渲染器输出的是真实 src；受保护路径换成占位，交给 useMarkdownMedia 回填 blob。
// 外链图片（https）保持原样，交给浏览器。
const descriptionHtml = computed(() => {
    const html = renderMarkdown(preview.value?.description || "");
    return html.replace(
        /<img src="(\/api\/[^"]*)"/g,
        (_all, path) =>
            `<img data-media-path="${path.replace(/&amp;/g, "&")}" data-media-state="pending"`,
    );
});

const descriptionRef = ref(null);
useMarkdownMedia(descriptionRef, descriptionHtml);

const pad2 = (n) => String(n).padStart(2, "0");

function formatStamp(value) {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

const coverAspect = computed(() => {
    const ratios = { "16:9": 16 / 9, "4:3": 4 / 3, "1:1": 1 };
    return ratios[cover.value?.ratio] ?? 16 / 9;
});

let token = 0;

async function load() {
    const key = props.puzzleKey;
    if (!key) return;

    const current = ++token;
    loading.value = true;
    error.value = "";
    preview.value = null;

    try {
        const data = await getPuzzlePreview(key);
        if (current !== token) return;
        if (!data) throw new Error("题目不存在");
        preview.value = data;
    } catch (err) {
        if (current !== token) return;
        error.value = describeApiError(err, {
            fallback: "预览加载失败",
            forbidden: "只有出题人本人或 admin 可以预览该题",
        });
    } finally {
        if (current === token) loading.value = false;
    }
}

// 打开时拉取；关闭时清空，顺带释放封面的 blob 引用
watch(
    () => props.modelValue,
    (open) => {
        if (open) {
            load();
        } else {
            token += 1;
            preview.value = null;
            error.value = "";
            loading.value = false;
        }
    },
);

// 预览打开期间切题（左侧列表点别的题）→ 重新拉
watch(
    () => props.puzzleKey,
    () => {
        if (props.modelValue) load();
    },
);

function close() {
    visible.value = false;
}
</script>

<template>
    <el-dialog
        v-model="visible"
        title="题目预览（草稿）"
        width="900px"
        top="5vh"
        append-to-body
        class="pv-dialog"
    >
        <div class="pv-topbar">
            <el-tag size="small" type="warning">草稿</el-tag>
            <span class="pv-topbar__key">{{ puzzleKey }}</span>
            <span v-if="preview?.rev != null" class="pv-topbar__meta">
                rev {{ preview.rev }}
            </span>
            <span class="pv-topbar__meta">
                跳过进度解锁 · 停用题也可预览 · 提示全部可见
            </span>
            <el-button size="small" text :loading="loading" @click="load">
                重新拉取
            </el-button>
        </div>

        <div v-loading="loading" class="pv-body">
            <el-alert
                v-if="error"
                :title="error"
                type="error"
                show-icon
                :closable="false"
                class="pv-alert"
            />

            <template v-else-if="preview">
                <!-- 五元素顺序：封面 → 题目(H1) → 描述 → 可塑区 → 附件；空字段整块不渲染 -->
                <figure
                    v-if="cover"
                    class="pv-cover"
                    :style="{ '--pv-aspect': coverAspect }"
                >
                    <img
                        v-if="coverStatus === 'ready'"
                        :src="coverSrc"
                        :alt="cover.alt"
                    />
                    <span
                        v-else-if="coverStatus === 'error'"
                        class="pv-cover__fallback"
                    >
                        {{ coverError || "封面加载失败" }}
                    </span>
                    <span v-else class="pv-cover__fallback">封面加载中…</span>
                </figure>

                <h1 class="pv-title">{{ preview.title }}</h1>

                <div
                    v-if="descriptionHtml"
                    ref="descriptionRef"
                    class="pv-description"
                    v-html="descriptionHtml"
                />

                <PreviewMalleable
                    v-if="preview.malleable"
                    :malleable="preview.malleable"
                />

                <section v-if="attachments.length" class="pv-section">
                    <h2 class="pv-section__title">附件</h2>
                    <div class="pv-attachments">
                        <PreviewAttachment
                            v-for="(item, index) in attachments"
                            :key="`${item.type}-${item.name}-${index}`"
                            :item="item"
                        />
                    </div>
                </section>

                <section v-if="hints.length" class="pv-section">
                    <h2 class="pv-section__title">
                        预置提示（预览里全部解锁）
                    </h2>
                    <ol class="pv-hints">
                        <li v-for="hint in hints" :key="hint.id" class="pv-hint">
                            <div class="pv-hint__head">
                                <span class="pv-hint__name">{{ hint.name }}</span>
                                <el-tag size="small" type="info">
                                    {{ hint.cost > 0 ? `${hint.cost} 点` : "免费" }}
                                </el-tag>
                            </div>
                            <p class="pv-hint__content">{{ hint.content }}</p>
                        </li>
                    </ol>
                </section>

                <p
                    v-if="!cover && !descriptionHtml && !preview.malleable && !attachments.length"
                    class="pv-empty"
                >
                    这道题还没有保存任何页面内容（只有标题）。
                </p>
            </template>

            <el-empty v-else-if="!loading && !error" description="暂无预览数据" />
        </div>

        <template #footer>
            <el-button @click="close">关闭</el-button>
        </template>
    </el-dialog>
</template>

<style scoped>
.pv-topbar {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 10px;
    padding-bottom: 12px;
    margin-bottom: 12px;
    border-bottom: 1px solid var(--el-border-color-lighter);
    font-size: 12px;
    color: var(--el-text-color-secondary);
}

.pv-topbar__key {
    font-family: var(--el-font-family-mono, monospace);
    font-size: 12px;
    color: var(--el-text-color-primary);
}

.pv-body {
    min-height: 120px;
    max-height: calc(90vh - 200px);
    overflow-y: auto;
}

.pv-alert {
    margin-bottom: 12px;
}

.pv-cover {
    width: min(100%, calc(320px * var(--pv-aspect, 1.7778)));
    margin: 0 auto 16px;
    aspect-ratio: var(--pv-aspect, 1.7778);
    overflow: hidden;
    border: 1px solid var(--el-border-color-light);
    border-radius: 4px;
    background: #f5f7fa;
}

.pv-cover img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: contain;
}

.pv-cover__fallback {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    font-size: 12px;
    color: var(--el-text-color-secondary);
}

.pv-title {
    margin: 0 0 14px;
    font-size: 20px;
    line-height: 1.3;
}

.pv-description {
    margin-bottom: 16px;
    font-size: 14px;
    line-height: 1.75;
    color: var(--el-text-color-primary);
}

.pv-description :deep(p:first-child) {
    margin-top: 0;
}

.pv-description :deep(p) {
    margin: 0 0 10px;
}

.pv-description :deep(h2),
.pv-description :deep(h3) {
    margin: 18px 0 8px;
    font-size: 15px;
}

.pv-description :deep(ul),
.pv-description :deep(ol) {
    margin: 0 0 10px;
    padding-left: 22px;
}

.pv-description :deep(blockquote) {
    margin: 0 0 10px;
    padding: 6px 12px;
    border-left: 3px solid var(--el-border-color);
    color: var(--el-text-color-secondary);
}

.pv-description :deep(code) {
    padding: 1px 4px;
    border-radius: 3px;
    background: var(--el-fill-color-light);
    font-family: var(--el-font-family-mono, monospace);
    font-size: 12px;
}

.pv-description :deep(pre) {
    margin: 0 0 10px;
    padding: 10px 12px;
    overflow-x: auto;
    border: 1px solid var(--el-border-color-light);
    border-radius: 4px;
    background: #fafafa;
}

.pv-description :deep(table) {
    width: 100%;
    margin: 0 0 10px;
    border-collapse: collapse;
    font-size: 13px;
}

.pv-description :deep(th),
.pv-description :deep(td) {
    padding: 5px 8px;
    border: 1px solid var(--el-border-color-light);
    text-align: left;
}

.pv-description :deep(img) {
    max-width: 100%;
    border-radius: 4px;
}

/* 受保护图片：加载中隐藏（此时没有 src，浏览器会画 alt）；
   失败时保留节点，用 alt + title 作为占位。 */
.pv-description :deep(img[data-media-state="pending"]) {
    display: none;
}

.pv-description :deep(img[data-media-state="error"]) {
    padding: 6px 10px;
    border: 1px dashed var(--el-border-color);
    border-radius: 4px;
    font-size: 12px;
    color: var(--el-text-color-secondary);
}

.pv-description :deep(a) {
    color: var(--el-color-primary);
}

.pv-section {
    margin-top: 20px;
}

.pv-section__title {
    margin: 0 0 10px;
    font-size: 12px;
    font-weight: 500;
    color: var(--el-text-color-secondary);
}

.pv-attachments {
    display: flex;
    flex-direction: column;
    gap: 14px;
}

.pv-hints {
    display: flex;
    flex-direction: column;
    gap: 10px;
    margin: 0;
    padding-left: 20px;
}

.pv-hint__head {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
    font-weight: 500;
}

.pv-hint__content {
    margin: 4px 0 0;
    font-size: 13px;
    line-height: 1.7;
    color: var(--el-text-color-regular);
    white-space: pre-wrap;
}

.pv-empty {
    margin: 24px 0;
    font-size: 13px;
    color: var(--el-text-color-secondary);
    text-align: center;
}
</style>
