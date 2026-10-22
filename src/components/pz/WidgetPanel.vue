<script setup>
// 组件面板：上传 SFC → 服务端编译成单文件 ESM → 登记版本。
//
// 版本不可覆盖（同 name@version → 409），升级要发新版本；
// 响应里没有 objectKey / compiler，界面也不展示。
import { ref } from "vue";
import { ElMessage } from "element-plus";
import { compileWidget, listWidgets } from "@/api/pz";
import SourceEditor from "@/components/pz/SourceEditor.vue";

const emit = defineEmits(["changed"]);

const widgets = ref([]);
const loading = ref(false);
const compiling = ref(false);

const form = ref({ name: "", version: "1.0.0", note: "" });
const source = ref("");

const NAME_RE = /^[a-z][a-z0-9-]{2,31}$/;
const VERSION_RE = /^\d+\.\d+\.\d+$/;
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

async function compile() {
    const name = String(form.value.name || "").trim();
    const version = String(form.value.version || "").trim();

    if (!NAME_RE.test(name)) {
        ElMessage.error("组件名需为小写字母开头，仅含小写字母/数字/连字符，3–32 位");
        return;
    }
    if (!VERSION_RE.test(version)) {
        ElMessage.error("版本号格式应为 x.y.z");
        return;
    }
    if (!source.value.trim()) {
        ElMessage.error("请填写 SFC 源码");
        return;
    }
    if (new Blob([source.value]).size > MAX_SOURCE_BYTES) {
        ElMessage.error("源码不能超过 128KB");
        return;
    }

    compiling.value = true;
    try {
        const data = await compileWidget({
            name,
            version,
            source: source.value,
            note: form.value.note || undefined,
        });
        const widget = data?.widget;
        ElMessage.success(
            widget ? `已发布 ${widget.name}@${widget.version}（${widget.tag}）` : "已发布",
        );
        await load();
    } catch (error) {
        // 409：同 name@version 已存在，提示升级版本
        ElMessage.error(error?.message || "编译失败");
    } finally {
        compiling.value = false;
    }
}

defineExpose({ reload: load, widgets });
</script>

<template>
    <div class="widget-panel">
        <el-form label-width="72px" size="small">
            <el-form-item label="命名">
                <div class="widget-panel__row">
                    <el-input v-model="form.name" placeholder="如 time-garden" />
                    <el-input v-model="form.version" placeholder="1.0.0" style="width: 110px" />
                </div>
            </el-form-item>
            <el-form-item label="备注">
                <el-input v-model="form.note" placeholder="可选，≤200 字，便于审计" />
            </el-form-item>
            <el-form-item label="源码">
                <div class="widget-panel__source">
                    <div class="widget-panel__tools">
                        <span class="tip">
                            SFC ≤128KB，仅 &lt;script setup&gt;；不能 import 子组件/第三方库
                        </span>
                        <label class="file-btn">
                            载入 .vue
                            <input
                                type="file"
                                accept=".vue,text/plain"
                                hidden
                                @change="importFile"
                            />
                        </label>
                    </div>
                    <SourceEditor
                        v-model="source"
                        height="260px"
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

        <el-table v-loading="loading" :data="widgets" size="small" border>
            <el-table-column label="组件" min-width="150">
                <template #default="{ row }">{{ row.name }}@{{ row.version }}</template>
            </el-table-column>
            <el-table-column prop="tag" label="标签" min-width="180" />
            <el-table-column label="大小" width="90">
                <template #default="{ row }">
                    {{ Math.round((row.bytes || 0) / 1024) }} KB
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
.widget-panel__row {
    display: flex;
    gap: 8px;
    width: 100%;
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

.tip {
    font-size: 12px;
    color: var(--el-text-color-secondary);
    line-height: 1.5;
}
</style>
