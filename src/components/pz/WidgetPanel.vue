<script setup>
// 组件面板：两步发布 —— ① 取上传地址直传 .vue 原文 → ② 编译并登记。
//
// 版本号由服务端分配并自动递增（1.0.0 → 1.0.1），前端不再填版本；
// 发布后引用旧版本的题目会被自动改到新版本（这些题目的 page_rev 会 +1），
// 每个组件只保留最新 ESM，Vue 源码留最近 3 版 —— 更早的源码不可再读取。
import { ref } from "vue";
import { ElMessage } from "element-plus";
import {
    compileWidget,
    getWidgetSource,
    listWidgets,
    signWidgetSource,
    uploadToSignedUrl,
} from "@/api/pz";
import SourceEditor from "@/components/pz/SourceEditor.vue";

const emit = defineEmits(["changed", "published"]);

const widgets = ref([]);
const loading = ref(false);
const compiling = ref(false);
const progress = ref(0);
const loadingSource = ref("");

const form = ref({ name: "", note: "" });
const source = ref("");

const NAME_RE = /^[a-z][a-z0-9-]{2,31}$/;
const MAX_SOURCE_BYTES = 128 * 1024;

async function load() {
    loading.value = true;
    try {
        const data = await listWidgets();
        widgets.value = data?.widgets ?? [];
        emit("changed", widgets.value);
    } catch (error) {
        ElMessage.error(error?.message || "组件列表加载失败");
    } finally {
        loading.value = false;
    }
}

load();

// 从本地 .vue 文件自动填入源码
function importFile(event) {
    const picked = event.target.files?.[0];
    if (!picked) return;
    const reader = new FileReader();
    reader.onload = () => {
        source.value = String(reader.result ?? "");
        if (!form.value.name) {
            form.value.name = picked.name.replace(/\.vue$/i, "").toLowerCase();
        }
        ElMessage.success(`已载入 ${picked.name}`);
    };
    reader.onerror = () => ElMessage.error("读取文件失败");
    reader.readAsText(picked, "utf-8");
    event.target.value = "";
}

// 每次「读取源码」都 +1：两行可以同时点，靠它丢弃迟到的响应。
// 否则先点的 A 后返回时，会把编辑区和组件名一起盖回 A ——
// 用户以为在改 B，点发布却发布了 A。
let sourceSeq = 0;

// 回读仍留档的旧版本源码，编辑后重新发布会自动生成更高版本
async function loadSource(name, version) {
    const seq = ++sourceSeq;
    loadingSource.value = `${name}@${version}`;
    try {
        const data = await getWidgetSource(name, version);
        if (seq !== sourceSeq) return;
        source.value = data?.source?.source ?? "";
        form.value.name = name;
        ElMessage.success(`已载入 ${name}@${version} 的源码，发布后会生成新版本`);
    } catch (error) {
        if (seq !== sourceSeq) return;
        ElMessage.error(error?.message || "源码读取失败");
    } finally {
        // 只有最新一次读取能收起 loading，否则会把新请求的转圈关掉
        if (seq === sourceSeq) loadingSource.value = "";
    }
}

async function compile() {
    const name = String(form.value.name || "").trim();

    if (!NAME_RE.test(name)) {
        ElMessage.error("组件名需为小写字母开头，仅含小写字母/数字/连字符，3–32 位");
        return;
    }
    if (!source.value.trim()) {
        ElMessage.error("请填写 SFC 源码");
        return;
    }

    // 发布期间编辑器、载入 .vue、读取源码都可能被操作（下面会把它们禁掉，
    // 但这里再固化一份才算真正安全）：本次要发的源码与备注先快照成 Blob，
    // 校验、签名、上传全用同一份，避免「签的是这份、传的是另一份」。
    const payload = new Blob([source.value], { type: "text/plain; charset=utf-8" });
    if (payload.size > MAX_SOURCE_BYTES) {
        ElMessage.error("源码不能超过 128KB");
        return;
    }
    const note = form.value.note || undefined;

    compiling.value = true;
    progress.value = 0;
    try {
        // 1) 取上传地址（只在内存里用，不落 localStorage、不打日志）
        const signed = await signWidgetSource({
            name,
            filename: `${name}.vue`,
            sizeBytes: payload.size,
        });
        const upload = signed?.upload;
        if (!upload?.url) throw new Error("未获取到上传地址");

        // 2) 直传 .vue 原文（不经过后端）
        await uploadToSignedUrl(upload, payload, (value) => {
            progress.value = value;
        }).promise;

        // 3) 编译并登记：版本号由服务端分配
        const data = await compileWidget({
            name,
            objectKey: upload.objectKey,
            note,
        });
        const widget = data?.widget;
        const upgraded = Number(data?.replaced?.referencesUpdated) || 0;
        ElMessage.success(
            `已发布 ${name}@${widget?.version ?? "?"}` +
                (upgraded ? `，自动升级 ${upgraded} 道题的引用` : ""),
        );
        await load();
        emit("published", { name, version: widget?.version, referencesUpdated: upgraded });
    } catch (error) {
        // 409 = 同一组件有更新的版本正在发布，重试即可
        ElMessage.error(error?.message || "编译失败");
    } finally {
        compiling.value = false;
        progress.value = 0;
    }
}

function kb(bytes) {
    const value = Number(bytes) || 0;
    return value < 1024 ? `${value} B` : `${Math.round(value / 1024)} KB`;
}

defineExpose({ reload: load, widgets });
</script>

<template>
    <div class="widget-panel">
        <el-form label-width="72px" size="small">
            <el-form-item label="组件名">
                <el-input v-model="form.name" :disabled="compiling" placeholder="如 time-garden" />
            </el-form-item>
            <el-form-item label="备注">
                <el-input
                    v-model="form.note"
                    :disabled="compiling"
                    placeholder="可选，≤200 字，便于审计"
                />
            </el-form-item>
            <el-form-item label="源码">
                <div class="widget-panel__source">
                    <div class="widget-panel__tools">
                        <span class="tip">
                            SFC ≤128KB，仅 &lt;script setup&gt;；不能 import 子组件/第三方库
                        </span>
                        <label class="file-btn" :class="{ 'is-disabled': compiling }">
                            载入 .vue
                            <input
                                type="file"
                                accept=".vue,text/plain"
                                :disabled="compiling"
                                hidden
                                @change="importFile"
                            />
                        </label>
                    </div>
                    <!-- 发布期间禁止改源码：避免「签的是一份、传的是另一份」 -->
                    <SourceEditor
                        v-model="source"
                        height="260px"
                        :readonly="compiling"
                        placeholder="<template>…</template>
<script setup>
import { ref } from 'vue'
</script>"
                    />
                </div>
            </el-form-item>
            <el-form-item>
                <el-button
                    type="primary"
                    size="small"
                    :loading="compiling"
                    @click="compile"
                >
                    编译并发布
                </el-button>
                <el-button size="small" :loading="loading" @click="load">刷新列表</el-button>
            </el-form-item>
        </el-form>

        <p class="tip">
            版本号由服务端自动递增；发布后引用旧版本的题目会被自动升级，源码只留最近 3 版。
        </p>

        <el-progress
            v-if="compiling && progress > 0"
            :percentage="progress"
            :stroke-width="6"
            style="margin-bottom: 8px"
        />

        <el-table v-loading="loading" :data="widgets" size="small" border>
            <el-table-column type="expand">
                <template #default="{ row }">
                    <div class="widget-panel__sources">
                        <p v-if="!row.sources?.length" class="tip">没有留档的源码</p>
                        <div
                            v-for="item in row.sources ?? []"
                            :key="item.version"
                            class="widget-panel__source-row"
                        >
                            <span>
                                {{ item.version }}
                                <el-tag v-if="item.current" size="small" type="success">
                                    当前
                                </el-tag>
                            </span>
                            <span class="tip">{{ kb(item.bytes) }}</span>
                            <el-button
                                link
                                type="primary"
                                size="small"
                                :disabled="compiling"
                                :loading="loadingSource === `${row.name}@${item.version}`"
                                @click="loadSource(row.name, item.version)"
                            >
                                读取源码
                            </el-button>
                        </div>
                    </div>
                </template>
            </el-table-column>
            <el-table-column label="组件" min-width="150">
                <template #default="{ row }">{{ row.name }}@{{ row.version }}</template>
            </el-table-column>
            <el-table-column prop="tag" label="标签" min-width="180" />
            <el-table-column label="大小" width="90">
                <template #default="{ row }">
                    {{ Math.round((row.bytes || 0) / 1024) }} KB
                </template>
            </el-table-column>
            <el-table-column label="源码版本" width="90">
                <template #default="{ row }">{{ row.sources?.length ?? 0 }}</template>
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
.widget-panel__row {
    display: flex;
    gap: 8px;
    width: 100%;
}

.widget-panel__sources {
    padding: 4px 12px;
}

.widget-panel__source-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 2px 0;
    font-size: 12px;
}

.widget-panel__source {
    width: 100%;
}

.widget-panel__tools {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin-bottom: 6px;
}

.file-btn {
    flex: none;
    padding: 2px 10px;
    border: 1px solid var(--el-border-color);
    border-radius: 4px;
    font-size: 12px;
    cursor: pointer;
}

.file-btn:hover {
    color: var(--el-color-primary);
    border-color: var(--el-color-primary);
}

.file-btn.is-disabled {
    color: var(--el-text-color-disabled);
    border-color: var(--el-border-color-lighter);
    cursor: not-allowed;
}

.file-btn.is-disabled:hover {
    color: var(--el-text-color-disabled);
    border-color: var(--el-border-color-lighter);
}

.tip {
    font-size: 12px;
    color: var(--el-text-color-secondary);
    line-height: 1.5;
}
</style>
