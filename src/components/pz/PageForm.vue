<script setup>
// 五元素编辑：封面 → 描述 → 可塑区 → 附件，外加目录归属与解锁规则。
// 标题不在这里（仍走 PUT /admin/puzzles/:key，避免两个真源）。
import { computed, nextTick, onMounted, ref, watch } from "vue";
import { ElMessage } from "element-plus";
import { putPuzzlePage } from "@/api/pz";
import { ATTACHMENT_TYPES } from "@/config/pz";
import { renderMarkdown } from "@/utils/miniMarkdown";
import SourceEditor from "@/components/pz/SourceEditor.vue";
import UnlockForm from "@/components/pz/UnlockForm.vue";
import PageMergeDialog from "@/components/pz/PageMergeDialog.vue";

const props = defineProps({
    puzzleKey: { type: String, required: true },
    // getPuzzlePage 的响应：{ key, title, enabled, rev, folderKey, unlock, page }
    detail: { type: Object, default: null },
    media: { type: Array, default: () => [] },
    widgets: { type: Array, default: () => [] },
    folders: { type: Array, default: () => [] },
});

const emit = defineEmits(["saved"]);

const saving = ref(false);
const unlockRef = ref(null);
const previewOpen = ref(false);

const model = ref(emptyModel());

function emptyModel() {
    return {
        folderKey: "",
        description: "",
        cover: null,
        malleable: null,
        attachments: [],
        unlock: { kind: "sequence" },
        rev: 0,
    };
}

// 后端返回的 page 可能缺字段，这里补齐成可直接绑定的形状
function toModel(detail) {
    const page = detail?.page ?? {};
    return {
        folderKey: detail?.folderKey ?? "",
        description: page.description ?? "",
        cover: page.cover
            ? {
                  assetId: page.cover.assetId ?? null,
                  alt: page.cover.alt ?? "",
                  ratio: page.cover.ratio ?? "16:9",
                  // 完成态封面：本队答对后 map/view 改用它，alt / ratio 仍沿用主封面
                  progressAssetId: page.cover.progressAssetId ?? null,
              }
            : null,
        malleable: page.malleable
            ? {
                  kind: page.malleable.kind ?? "none",
                  name: page.malleable.name ?? "",
                  version: page.malleable.version ?? "",
                  props: page.malleable.props
                      ? JSON.stringify(page.malleable.props, null, 2)
                      : "",
                  wide: Boolean(page.malleable.wide),
                  minHeight: Number(page.malleable.minHeight ?? 320),
                  url: page.malleable.url ?? "",
              }
            : null,
        attachments: (page.attachments ?? []).map((item) => ({
            type: item.type ?? "image",
            name: item.name ?? "",
            assetId: item.assetId ?? null,
            href: item.href ?? "",
            note: item.note ?? "",
        })),
        unlock: detail?.unlock ?? { kind: "sequence" },
        rev: detail?.rev ?? 0,
    };
}

// 与服务端「已对齐」的内容快照：重取回新 detail 时用它判断表单是否还有未保存修改。
// 建立/比较都用同一个 snapshot()，避免 unlock 经过 UnlockForm 归一化后误判为脏。
let syncedPayload = null;
let initialized = false;
let prompting = false;
let queuedDetail = null;

const mergeOpen = ref(false);
const mergeRev = ref(0);
const mergeBase = ref(null);
const mergeLocal = ref(null);
const mergeRemote = ref(null);

let pendingDetail = null;
let promptedRev = null;

function localPayload() {
    try {
        return toPayload();
    } catch {
        // props 不是合法 JSON 之类：给个空页面，至少还能选「载入服务端」
        return {
            folderKey: model.value.folderKey || null,
            page: {},
            unlock: model.value.unlock,
        };
    }
}

function snapshot() {
    try {
        return JSON.stringify(localPayload());
    } catch {
        // 算作脏，宁可多问一次也别静默覆盖
        return null;
    }
}

async function syncBaseline() {
    await nextTick();
    syncedPayload = snapshot();
}

async function applyDetail(detail) {
    model.value = toModel(detail);
    initialized = true;
    await syncBaseline();
}

// 本地草稿在字段上是否已经等于服务端这次回来的内容（只是 rev 不同）
function sameAsRemote(detail) {
    try {
        return JSON.stringify(localPayload()) === JSON.stringify(payloadOf(detail));
    } catch {
        return false;
    }
}

// 重取回来的 detail 怎么落地：
//   表单干净，或关键内容已与服务端一致 → 直接整体替换（后端会补默认值 / 丢空字段，需要它的结果）
//   有未保存修改 → 打开三方合并弹窗，由用户逐字段决定
async function handleDetail(detail) {
    if (!detail) return;
    // 弹窗期间又来了新 detail：排队，等这次选择完再处理
    if (prompting) {
        queuedDetail = detail;
        return;
    }
    if (!initialized || snapshot() === syncedPayload || sameAsRemote(detail)) {
        await applyDetail(detail);
        return;
    }
    // 同一个 rev 已经问过就别重复打扰
    if (promptedRev === detail.rev) return;

    prompting = true;
    promptedRev = detail.rev;
    pendingDetail = detail;
    mergeRev.value = detail.rev ?? 0;
    mergeBase.value = syncedPayload ? JSON.parse(syncedPayload) : null;
    mergeLocal.value = localPayload();
    mergeRemote.value = payloadOf(detail);
    mergeOpen.value = true;
}

function onMergeApply({ mode, payload }) {
    const detail = pendingDetail;
    pendingDetail = null;
    if (!detail) return;

    if (mode === "remote") {
        applyDetail(detail);
    } else if (mode === "merge") {
        model.value = toModel({
            key: props.puzzleKey,
            rev: detail.rev,
            folderKey: payload.folderKey ?? "",
            unlock: payload.unlock,
            page: payload.page,
        });
        // 合并结果还没保存：基准仍以服务端为准，所以表单依然是「脏」的，
        // 用户需要再点一次保存；但同一 rev 不会重复弹窗。
        syncedPayload = JSON.stringify(payloadOf(detail));
        initialized = true;
    } else {
        // 保留我的修改：只把版本号对齐，正文继续用用户手上的草稿
        model.value.rev = detail.rev ?? model.value.rev;
    }

    prompting = false;
    if (queuedDetail) {
        const next = queuedDetail;
        queuedDetail = null;
        handleDetail(next);
    }
}

watch(() => props.detail, handleDetail, { immediate: true });

// 挂载后重建一次基准：此时 UnlockForm 已绑定，toPayload() 与后续比较同源
onMounted(syncBaseline);

// 只有图片素材能当封面
const imageMedia = computed(() =>
    props.media.filter((item) => item.mediaType === "image"),
);

function mediaOfType(type) {
    return props.media.filter((item) => item.mediaType === type);
}

const previewHtml = computed(() => renderMarkdown(model.value.description || ""));

const sourceBytes = computed(() => {
    try {
        return new Blob([JSON.stringify(toPayload())]).size;
    } catch {
        return 0;
    }
});

// ---------- 封面 ----------

function toggleCover(enabled) {
    model.value.cover = enabled
        ? {
              assetId: imageMedia.value[0]?.id ?? null,
              alt: "",
              ratio: "16:9",
              progressAssetId: null,
          }
        : null;
}

// ---------- 可塑区 ----------

function setMalleableKind(kind) {
    if (kind === "none") {
        model.value.malleable = null;
        return;
    }
    model.value.malleable = {
        kind,
        name: model.value.malleable?.name ?? "",
        version: model.value.malleable?.version ?? "",
        props: model.value.malleable?.props ?? "",
        wide: model.value.malleable?.wide ?? false,
        minHeight: model.value.malleable?.minHeight ?? 320,
        url: model.value.malleable?.url ?? "",
    };
}

const malleableKind = computed(() => model.value.malleable?.kind ?? "none");

// 组件名选中后自动带出该组件的版本
function onWidgetPick(name) {
    const options = props.widgets.filter((item) => item.name === name);
    const latest = options[options.length - 1];
    if (!latest) return;
    model.value.malleable.name = latest.name;
    model.value.malleable.version = latest.version;
}

const widgetNames = computed(() => [
    ...new Set(props.widgets.map((item) => item.name)),
]);

const widgetVersions = computed(() =>
    props.widgets
        .filter((item) => item.name === model.value.malleable?.name)
        .map((item) => item.version),
);

// 组件列表刷新（发布了新版本）后，草稿里指向已不存在版本的引用要跟上最新版本。
// 只看草稿、不看服务端是否升级过引用：api-12 每个组件只保留最新 ESM，
// 拿旧版本号保存会被后端拒绝（或引用到已被删除的产物）。
watch(
    () => props.widgets,
    () => {
        const malleable = model.value.malleable;
        if (malleable?.kind !== "component" || !malleable.name) return;
        const versions = widgetVersions.value;
        if (!versions.length || versions.includes(malleable.version)) return;
        malleable.version = versions[versions.length - 1];
        ElMessage.warning(
            `组件 ${malleable.name} 已发布新版本，版本号已切到 ${malleable.version}（记得保存页面）`,
        );
    },
);

// ---------- 附件 ----------

function addAttachment() {
    model.value.attachments.push({
        type: "image",
        name: "",
        assetId: imageMedia.value[0]?.id ?? null,
        href: "",
        note: "",
    });
}

function removeAttachment(index) {
    model.value.attachments.splice(index, 1);
}

// ---------- 保存 ----------

function parseProps(text) {
    const raw = String(text || "").trim();
    if (!raw) return {};
    const value = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error("props 必须是 JSON 对象");
    }
    return value;
}

// 把「表单形状」的对象序列化成 api-12 的 PUT 请求体。
// source 可以是 model.value（本地草稿），也可以是 toModel(detail) 的结果（服务端存档），
// 这样两边才能用同一把尺子比较出差异。
function buildPayload(source, unlock) {
    const page = {};

    if (source.description.trim()) {
        page.description = source.description;
    }

    if (source.cover) {
        page.cover = {
            assetId: source.cover.assetId,
            alt: source.cover.alt,
            ratio: source.cover.ratio,
        };
        // 完成态封面：没选就整条省略，别给后端传 null
        if (source.cover.progressAssetId) {
            page.cover.progressAssetId = source.cover.progressAssetId;
        }
    }

    const malleable = source.malleable;
    if (malleable?.kind === "component") {
        page.malleable = {
            kind: "component",
            name: malleable.name,
            version: malleable.version,
            props: parseProps(malleable.props),
            wide: Boolean(malleable.wide),
            minHeight: Number(malleable.minHeight) || 320,
        };
    } else if (malleable?.kind === "iframe") {
        page.malleable = {
            kind: "iframe",
            url: malleable.url,
            wide: Boolean(malleable.wide),
            minHeight: Number(malleable.minHeight) || 320,
        };
    }

    if (source.attachments.length) {
        page.attachments = source.attachments.map((item) =>
            item.type === "link"
                ? { type: "link", name: item.name, href: item.href, note: item.note }
                : {
                      type: item.type,
                      name: item.name,
                      assetId: item.assetId,
                      note: item.note,
                  },
        );
    }

    return {
        folderKey: source.folderKey || null,
        page,
        unlock,
    };
}

// 当前表单（含 UnlockForm 里正在编辑的解锁规则）的请求体
function toPayload() {
    return buildPayload(
        model.value,
        unlockRef.value?.toUnlock?.() ?? model.value.unlock,
    );
}

// 把某题页面（detail 或合并结果）转回请求体形状
function payloadOf(detail) {
    return buildPayload(
        toModel(detail),
        detail?.unlock ?? { kind: "sequence" },
    );
}

// 前端先按 api-12 的约束自检，避免只拿到一个笼统的 400
function validate(payload) {
    const page = payload.page;

    if (page.description && page.description.length > 20000) {
        return "描述不能超过 20000 字符";
    }
    if (page.cover) {
        if (!page.cover.assetId) return "请选择封面图片";
        if (!page.cover.alt || page.cover.alt.length > 200) return "封面替代文本需为 1–200 字符";
    }
    if (page.malleable?.kind === "component") {
        if (!page.malleable.name || !page.malleable.version) return "请选择组件与版本";
    }
    if (page.malleable?.kind === "iframe") {
        if (!/^https:\/\//i.test(page.malleable.url || "")) return "iframe 只支持 https 地址";
        if (page.malleable.url.length > 500) return "iframe 地址不能超过 500 字符";
    }
    if (page.attachments) {
        if (page.attachments.length > 20) return "附件最多 20 条";
        for (const [index, item] of page.attachments.entries()) {
            const label = `附件 ${index + 1}`;
            if (!item.name || item.name.length > 80) return `${label}：名称需为 1–80 字符`;
            if (item.type === "link") {
                if (!/^https:\/\//i.test(item.href || "")) return `${label}：外链只支持 https`;
            } else if (!item.assetId) {
                return `${label}：请选择素材`;
            }
        }
    }
    if (new Blob([JSON.stringify(payload)]).size > 64 * 1024) {
        return "整页内容超过 64KB，请精简";
    }
    return "";
}

async function save() {
    if (saving.value) return;

    let payload;
    try {
        payload = toPayload();
    } catch (error) {
        ElMessage.error(error?.message || "参数格式有误");
        return;
    }

    const message = validate(payload);
    if (message) {
        ElMessage.error(message);
        return;
    }

    saving.value = true;
    try {
        const data = await putPuzzlePage(props.puzzleKey, payload);
        model.value.rev = data?.rev ?? model.value.rev + 1;
        // 服务端已保存的就是这次发出去的 payload：以此为新基准。
        // 用户在 PUT 期间又改动的话，快照仍不等于基准 → 重取回来时会问一句。
        syncedPayload = JSON.stringify(payload);
        initialized = true;
        ElMessage.success(`已保存，rev ${model.value.rev}`);
        emit("saved", data);
    } catch (error) {
        ElMessage.error(error?.message || "保存失败");
    } finally {
        saving.value = false;
    }
}
</script>

<template>
    <div class="page-form">
        <div class="page-form__head">
            <span class="tip">
                rev {{ model.rev }} · {{ detail?.enabled === false ? "题目已停用" : "题目启用中" }}
            </span>
            <div>
                <el-button size="small" @click="previewOpen = !previewOpen">
                    {{ previewOpen ? "关闭预览" : "预览描述" }}
                </el-button>
                <el-button size="small" type="primary" :loading="saving" @click="save">
                    保存页面
                </el-button>
            </div>
        </div>

        <el-form label-width="88px" size="small" class="page-form__body">
            <el-form-item label="所属目录">
                <el-select v-model="model.folderKey" clearable placeholder="未分组">
                    <el-option
                        v-for="folder in folders"
                        :key="folder.key"
                        :label="`${folder.title}（${folder.key}）`"
                        :value="folder.key"
                    />
                </el-select>
            </el-form-item>

            <el-divider content-position="left">封面</el-divider>
            <el-form-item label="启用封面">
                <el-switch
                    :model-value="Boolean(model.cover)"
                    @update:model-value="toggleCover"
                />
            </el-form-item>
            <template v-if="model.cover">
                <el-form-item label="图片">
                    <el-select v-model="model.cover.assetId" placeholder="从本题素材中选图">
                        <el-option
                            v-for="item in imageMedia"
                            :key="item.id"
                            :label="`#${item.id} ${item.filename || ''}`"
                            :value="item.id"
                        />
                    </el-select>
                </el-form-item>
                <el-form-item label="替代文本">
                    <el-input v-model="model.cover.alt" placeholder="1–200 字符" />
                </el-form-item>
                <el-form-item label="比例">
                    <el-radio-group v-model="model.cover.ratio">
                        <el-radio-button value="16:9">16:9</el-radio-button>
                        <el-radio-button value="4:3">4:3</el-radio-button>
                        <el-radio-button value="1:1">1:1</el-radio-button>
                    </el-radio-group>
                </el-form-item>
                <el-form-item label="完成态封面">
                    <el-select
                        v-model="model.cover.progressAssetId"
                        placeholder="可选：本队答对后换这张"
                        clearable
                    >
                        <el-option
                            v-for="item in imageMedia"
                            :key="item.id"
                            :label="`#${item.id} ${item.filename || ''}`"
                            :value="item.id"
                        />
                    </el-select>
                </el-form-item>
            </template>

            <el-divider content-position="left">描述（受限 Markdown）</el-divider>
            <el-form-item label="正文">
                <div class="page-form__desc">
                    <el-input
                        v-model="model.description"
                        type="textarea"
                        :rows="8"
                        maxlength="20000"
                        show-word-limit
                        placeholder="支持标题 / 强调 / 列表 / 引用 / 代码 / 表格 / 图片 / 链接"
                    />
                    <div v-if="previewOpen" class="page-form__preview">
                        <!-- 白名单渲染器输出，标签全部由渲染器拼出 -->
                        <div class="markdown-body" v-html="previewHtml" />
                    </div>
                </div>
            </el-form-item>

            <el-divider content-position="left">可塑区</el-divider>
            <el-form-item label="类型">
                <el-radio-group
                    :model-value="malleableKind"
                    @update:model-value="setMalleableKind"
                >
                    <el-radio-button value="none">无</el-radio-button>
                    <el-radio-button value="component">组件</el-radio-button>
                    <el-radio-button value="iframe">外链</el-radio-button>
                </el-radio-group>
            </el-form-item>

            <template v-if="malleableKind === 'component'">
                <el-form-item label="组件">
                    <div class="page-form__row">
                        <el-select
                            :model-value="model.malleable.name"
                            placeholder="组件名"
                            @update:model-value="onWidgetPick"
                        >
                            <el-option
                                v-for="name in widgetNames"
                                :key="name"
                                :label="name"
                                :value="name"
                            />
                        </el-select>
                        <el-select v-model="model.malleable.version" placeholder="版本">
                            <el-option
                                v-for="version in widgetVersions"
                                :key="version"
                                :label="version"
                                :value="version"
                            />
                        </el-select>
                    </div>
                </el-form-item>
                <el-form-item label="props">
                    <SourceEditor
                        v-model="model.malleable.props"
                        mode="javascript"
                        height="160px"
                        placeholder='{ "label": "调整花园时间" }'
                    />
                </el-form-item>
            </template>

            <template v-if="malleableKind === 'iframe'">
                <el-form-item label="外链地址">
                    <el-input
                        v-model="model.malleable.url"
                        placeholder="https://…（仅 https，≤500 字符）"
                    />
                </el-form-item>
            </template>

            <template v-if="malleableKind !== 'none'">
                <el-form-item label="加宽">
                    <el-switch v-model="model.malleable.wide" />
                </el-form-item>
                <el-form-item label="骨架高度">
                    <el-input-number
                        v-model="model.malleable.minHeight"
                        :min="200"
                        :max="2000"
                        :step="20"
                    />
                </el-form-item>
            </template>

            <el-divider content-position="left">附件</el-divider>
            <el-form-item label="列表">
                <div class="page-form__attachments">
                    <p v-if="!model.attachments.length" class="tip">
                        还没有附件；先到右侧「素材」上传，再回来选。
                    </p>
                    <div
                        v-for="(item, index) in model.attachments"
                        :key="index"
                        class="attachment-row"
                    >
                        <el-select v-model="item.type" style="width: 96px">
                            <el-option
                                v-for="type in ATTACHMENT_TYPES"
                                :key="type.value"
                                :label="type.label"
                                :value="type.value"
                            />
                        </el-select>
                        <el-input v-model="item.name" placeholder="展示名（1–80）" />
                        <el-select
                            v-if="item.type !== 'link'"
                            v-model="item.assetId"
                            placeholder="素材"
                            style="width: 180px"
                        >
                            <el-option
                                v-for="asset in mediaOfType(item.type)"
                                :key="asset.id"
                                :label="`#${asset.id} ${asset.filename || ''}`"
                                :value="asset.id"
                            />
                        </el-select>
                        <el-input
                            v-else
                            v-model="item.href"
                            placeholder="https://…"
                            style="width: 200px"
                        />
                        <el-button size="small" text type="danger" @click="removeAttachment(index)">
                            移除
                        </el-button>
                    </div>
                    <el-button
                        size="small"
                        :disabled="model.attachments.length >= 20"
                        @click="addAttachment"
                    >
                        添加附件
                    </el-button>
                </div>
            </el-form-item>

            <el-divider content-position="left">解锁规则</el-divider>
            <UnlockForm ref="unlockRef" :model-value="model.unlock" />

            <p class="tip">页面序列化大小约 {{ Math.round(sourceBytes / 1024) }} KB（上限 64KB）</p>
        </el-form>

        <PageMergeDialog
            v-model="mergeOpen"
            :rev="mergeRev"
            :base="mergeBase"
            :local="mergeLocal"
            :remote="mergeRemote"
            :media="media"
            @apply="onMergeApply"
        />
    </div>
</template>

<style scoped>
.page-form__head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin-bottom: 12px;
}

.page-form__desc,
.page-form__attachments {
    width: 100%;
}

.page-form__preview {
    margin-top: 8px;
    padding: 10px 12px;
    border: 1px dashed var(--el-border-color);
    border-radius: 4px;
    background: var(--el-fill-color-lighter);
}

.page-form__row {
    display: flex;
    gap: 8px;
    width: 100%;
}

.attachment-row {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 8px;
}

.tip {
    margin: 0;
    font-size: 12px;
    color: var(--el-text-color-secondary);
    line-height: 1.5;
}

/* 预览区排版：与玩家端白名单渲染保持一致的基础样式 */
.markdown-body {
    font-size: 13px;
    line-height: 1.7;
}

.markdown-body :deep(p) {
    margin: 0 0 8px;
}

.markdown-body :deep(h2),
.markdown-body :deep(h3),
.markdown-body :deep(h4) {
    margin: 12px 0 6px;
    font-size: 14px;
}

.markdown-body :deep(ul),
.markdown-body :deep(ol) {
    margin: 0 0 8px;
    padding-left: 20px;
}

.markdown-body :deep(code) {
    padding: 1px 4px;
    border-radius: 3px;
    background: var(--el-fill-color);
    font-family: ui-monospace, Menlo, Consolas, monospace;
}

.markdown-body :deep(pre) {
    margin: 0 0 8px;
    padding: 8px 10px;
    overflow-x: auto;
    background: var(--el-fill-color);
}

.markdown-body :deep(blockquote) {
    margin: 0 0 8px;
    padding: 4px 10px;
    border-left: 3px solid var(--el-border-color);
    color: var(--el-text-color-secondary);
}

.markdown-body :deep(table) {
    width: 100%;
    border-collapse: collapse;
    margin-bottom: 8px;
}

.markdown-body :deep(th),
.markdown-body :deep(td) {
    padding: 4px 8px;
    border: 1px solid var(--el-border-color);
    text-align: left;
}
</style>
