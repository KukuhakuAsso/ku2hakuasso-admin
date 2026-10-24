<script setup>
// 出题台（单页）：左选题目 → 中间编辑五元素 → 右侧管理素材 / 组件 / 目录。
//
// 数据来源：
//   题目主数据  GET /admin/puzzles（标题、启用、排序）
//   页面五元素  GET /admin/pz/puzzle/:key/page
//   素材/组件/目录 各自面板内自行加载，并通过 changed 事件回传，供页面表单选择。
import { computed, ref } from "vue";
import { ElMessage } from "element-plus";
import { getPuzzlePage, listFolders, listPuzzles, listWidgets, putPuzzle } from "@/api/pz";
import { pick } from "@/utils/format";
import { useAuthStore } from "@/stores/auth";
import PageForm from "@/components/pz/PageForm.vue";
import PuzzleMetaForm from "@/components/pz/PuzzleMetaForm.vue";
import MediaPanel from "@/components/pz/MediaPanel.vue";
import WidgetPanel from "@/components/pz/WidgetPanel.vue";
import FolderPanel from "@/components/pz/FolderPanel.vue";

const auth = useAuthStore();
const canPublishWidget = computed(() => auth.can("pz.widget.publish"));
// PUT /admin/puzzles/:key（新增题目主数据）是 admin 专属，staff 只能编辑已有题目的页面
const canCreatePuzzle = computed(() => auth.isAdmin);

const puzzles = ref([]);
const puzzleLoading = ref(false);
const keyword = ref("");

const selectedKey = ref("");
const detail = ref(null);
const detailLoading = ref(false);

const media = ref([]);
const widgets = ref([]);
const folders = ref([]);

const activeTab = ref("media");
// 中间栏：页面五元素 / 题目主数据（原「题库」页并入这里）
const editorTab = ref("page");

const createOpen = ref(false);
const creating = ref(false);
const createForm = ref({ key: "", title: "", enabled: true });
const KEY_RE = /^[A-Za-z0-9_-]{1,64}$/;

// 刚建的题目还没有页面草稿，直接给一份空骨架，免得先报一次 404
function blankDetail(key, title) {
    return {
        key,
        title,
        enabled: true,
        rev: 0,
        folderKey: "",
        unlock: { kind: "sequence" },
        page: {},
    };
}

function titleOf(key) {
    return puzzles.value.find((item) => item.key === key)?.title ?? "";
}

// 当前选中题目的列表行（主数据表单的数据源）
const selectedRow = computed(
    () => puzzles.value.find((item) => item.key === selectedKey.value) ?? null,
);
// PUT /admin/puzzles/:key 是 admin 专属：非 admin 只读展示（与原「题库」页的权限一致）
const canEditMeta = computed(() => auth.isAdmin);

const filteredPuzzles = computed(() => {
    const word = keyword.value.trim().toLowerCase();
    if (!word) return puzzles.value;
    return puzzles.value.filter((item) =>
        `${item.key} ${item.title ?? ""}`.toLowerCase().includes(word),
    );
});

async function loadPuzzles() {
    puzzleLoading.value = true;
    try {
        const data = await listPuzzles();
        puzzles.value = data?.items ?? [];
        // 默认选中第一题，省一次点击
        if (!selectedKey.value && puzzles.value.length) {
            await selectPuzzle(puzzles.value[0].key);
        }
    } catch (error) {
        ElMessage.error(error?.message || "题目列表加载失败");
    } finally {
        puzzleLoading.value = false;
    }
}

// 拉一次某题的服务端存档；404 / 空响应都落到空骨架（题目可能还没写过页面）
async function fetchDetail(key) {
    try {
        const data = await getPuzzlePage(key);
        return data ?? blankDetail(key, titleOf(key));
    } catch (error) {
        if (error?.status === 404) return blankDetail(key, titleOf(key));
        throw error;
    }
}

// 每次切题都 +1；晚到的响应靠它判断自己是否已经被后来的操作取代。
// 只比对 key 不够 —— A→B→A 时两次 key 相同，晚到的 A 仍会盖掉第二次的 A。
let selectSeq = 0;

function isStale(seq, key) {
    return seq !== selectSeq || key !== selectedKey.value;
}

async function selectPuzzle(key) {
    const seq = ++selectSeq;
    selectedKey.value = key;
    detail.value = null;
    detailLoading.value = true;
    try {
        const data = await fetchDetail(key);
        // 迟到的响应直接丢弃，否则会把新题的详情盖掉（保存时就会写到错的题上）
        if (isStale(seq, key)) return;
        detail.value = data;
    } catch (error) {
        // 迟到的错误同样别弹，它已经和当前选中的题无关了
        if (isStale(seq, key)) return;
        ElMessage.error(error?.message || "页面草稿加载失败");
    } finally {
        // 只有最新一次请求能收起 loading，否则会把新题的转圈关掉
        if (!isStale(seq, key)) detailLoading.value = false;
    }
}

function openCreate() {
    createForm.value = { key: "", title: "", enabled: true };
    createOpen.value = true;
}

async function submitCreate() {
    if (creating.value) return;
    const key = createForm.value.key.trim();
    const title = createForm.value.title.trim();
    if (!KEY_RE.test(key)) {
        ElMessage.error("key 只能包含字母、数字、下划线和连字符，1–64 位");
        return;
    }
    if (!title) {
        ElMessage.error("请填写标题");
        return;
    }
    if (puzzles.value.some((item) => item.key === key)) {
        ElMessage.error(`题目 ${key} 已存在，直接点它编辑即可`);
        return;
    }

    creating.value = true;
    try {
        const data = await putPuzzle(key, {
            title,
            enabled: createForm.value.enabled,
        });
        const puzzle = data?.puzzle ?? {};
        puzzles.value.push({
            key,
            title: puzzle.title ?? title,
            enabled: puzzle.enabled ?? createForm.value.enabled,
            rev: 0,
        });
        createOpen.value = false;
        keyword.value = "";
        // 页面草稿此刻还不存在，直接进编辑，第一次「保存页面」才落库。
        // 递增 seq：把还在飞的旧题请求作废，别让它落地；
        // 但那条请求的 finally 会因此跳过收尾，这里必须自己把 loading 关掉，
        // 否则新题一直被中间栏的加载遮罩盖着。
        selectSeq += 1;
        detailLoading.value = false;
        selectedKey.value = key;
        detail.value = blankDetail(key, puzzle.title ?? title);
        ElMessage.success(`已创建 ${key}，接着写页面内容吧`);
    } catch (error) {
        ElMessage.error(error?.message || "创建失败");
    } finally {
        creating.value = false;
    }
}

// 右侧面板首次加载后把清单回传，页面表单据此提供下拉选项
async function loadSideLists() {
    try {
        const [widgetData, folderData] = await Promise.all([
            listWidgets(),
            listFolders(),
        ]);
        widgets.value = widgetData?.widgets ?? [];
        folders.value = folderData?.folders ?? [];
    } catch {
        // 侧栏清单失败不阻塞主流程，面板里有各自的错误提示
    }
}

loadPuzzles();
loadSideLists();

async function onSaved(data) {
    // 保存的是哪道题以响应为准：保存期间用户可能已经切走，别再拿 selectedKey 猜
    const key = data?.key || selectedKey.value;
    const target = puzzles.value.find((item) => item.key === key);
    if (target && data?.rev != null) target.rev = data.rev;

    // 保存后以服务端为准重取一次：后端会补默认值、丢空字段、规范化形状，
    // 只回填 rev 会让表单停在提交前的内容，与真实存档对不上
    const seq = selectSeq;
    try {
        const fresh = await fetchDetail(key);
        // 期间切走了（或切走又切回来过）就别覆盖，交给切题那次请求去落地
        if (isStale(seq, key)) return;
        detail.value = fresh;
    } catch (error) {
        if (isStale(seq, key)) return;
        ElMessage.error(error?.message || "刷新页面状态失败");
    }
}

// 保存主数据后把响应合并回列表行：中间栏标题、左侧列表、页面表单的 title 都读同一份
function onMetaSaved(puzzle) {
    if (!puzzle) return;
    const key = puzzle.key || selectedKey.value;
    const target = puzzles.value.find((item) => item.key === key);
    if (target) {
        // PUT 响应是 snake_case，GET 是 camelCase：两种都认，只覆盖确实返回的字段
        const title = pick(puzzle, "title");
        const enabled = pick(puzzle, "enabled");
        const ord = pick(puzzle, "ord");
        const tipsReward = pick(puzzle, "tipsReward", "tips_reward");
        const archiveId = pick(puzzle, "archiveId", "archive_id");

        if (title !== undefined) target.title = title;
        if (enabled !== undefined) target.enabled = enabled;
        if (ord !== undefined) target.ord = ord;
        if (tipsReward !== undefined) target.tipsReward = tipsReward;
        if (archiveId !== undefined) target.archiveId = archiveId;
    }

    // 中间栏头部与 PageForm 都读 detail，一并跟上
    if (detail.value && detail.value.key === key) {
        const title = pick(puzzle, "title");
        const enabled = pick(puzzle, "enabled");
        if (title !== undefined) detail.value.title = title;
        if (enabled !== undefined) detail.value.enabled = enabled;
    }
}

// 发布组件会让引用它的题目自动升级版本、page_rev +1；
// 当前题目若正好引用了这个组件，表单里的版本号与 rev 已经过期，重取一次。
async function onWidgetPublished({ name, referencesUpdated }) {
    const current = detail.value?.page?.malleable;
    if (!referencesUpdated || current?.kind !== "component" || current?.name !== name) {
        return;
    }
    const key = selectedKey.value;
    const seq = selectSeq;
    try {
        const fresh = await fetchDetail(key);
        if (isStale(seq, key)) return;
        detail.value = fresh;
    } catch (error) {
        if (isStale(seq, key)) return;
        ElMessage.error(error?.message || "刷新页面状态失败");
    }
}
</script>

<template>
    <div class="studio">
        <!-- 左：题目列表 -->
        <aside class="studio__list">
            <div class="studio__list-actions">
                <el-button
                    v-if="canCreatePuzzle"
                    size="small"
                    type="primary"
                    plain
                    style="width: 100%"
                    @click="openCreate"
                >
                    新建题目
                </el-button>
            </div>

            <div class="studio__list-head">
                <el-input
                    v-model="keyword"
                    size="small"
                    placeholder="搜索 key / 标题"
                    clearable
                />
                <el-button size="small" :loading="puzzleLoading" @click="loadPuzzles">
                    刷新
                </el-button>
            </div>

            <el-scrollbar v-loading="puzzleLoading" class="studio__list-body">
                <p v-if="!filteredPuzzles.length" class="tip">没有匹配的题目</p>
                <button
                    v-for="item in filteredPuzzles"
                    :key="item.key"
                    type="button"
                    class="puzzle-item"
                    :class="{ 'is-active': item.key === selectedKey }"
                    @click="selectPuzzle(item.key)"
                >
                    <span class="puzzle-item__title">{{ item.title || item.key }}</span>
                    <span class="puzzle-item__meta">
                        {{ item.key }}
                        <el-tag v-if="item.enabled === false" size="small" type="info">
                            停用
                        </el-tag>
                    </span>
                </button>
            </el-scrollbar>
        </aside>

        <!-- 中：五元素编辑 + 题目主数据 -->
        <section class="studio__editor">
            <el-empty
                v-if="!selectedKey"
                description="从左侧选择一道题目"
            />
            <div v-else class="studio__editor-inner">
                <header class="studio__editor-head">
                    <h3>{{ detail?.title || selectedKey }}</h3>
                    <span class="tip">
                        {{ selectedKey }}
                        <template v-if="detail?.folderKey"> · 目录 {{ detail.folderKey }}</template>
                    </span>
                </header>

                <el-tabs v-model="editorTab" class="studio__editor-tabs">
                    <el-tab-pane label="页面内容" name="page">
                        <div v-loading="detailLoading">
                            <PageForm
                                v-if="detail"
                                :key="selectedKey"
                                :puzzle-key="selectedKey"
                                :detail="detail"
                                :media="media"
                                :widgets="widgets"
                                :folders="folders"
                                @saved="onSaved"
                            />
                        </div>
                    </el-tab-pane>
                    <el-tab-pane label="题目主数据" name="meta">
                        <PuzzleMetaForm
                            :row="selectedRow"
                            :readonly="!canEditMeta"
                            @saved="onMetaSaved"
                        />
                    </el-tab-pane>
                </el-tabs>
            </div>
        </section>

        <!-- 右：素材 / 组件 / 目录 -->
        <aside class="studio__side">
            <el-tabs v-model="activeTab" class="studio__tabs">
                <el-tab-pane label="素材" name="media">
                    <MediaPanel
                        :puzzle-key="selectedKey"
                        @changed="media = $event"
                    />
                </el-tab-pane>
                <el-tab-pane v-if="canPublishWidget" label="组件" name="widget">
                    <WidgetPanel @changed="widgets = $event" @published="onWidgetPublished" />
                </el-tab-pane>
                <el-tab-pane label="目录" name="folder">
                    <FolderPanel @changed="folders = $event" />
                </el-tab-pane>
            </el-tabs>
        </aside>

        <el-dialog v-model="createOpen" title="新建题目" width="420px" append-to-body>
            <el-form label-width="72px" @submit.prevent>
                <el-form-item label="key" required>
                    <el-input
                        v-model="createForm.key"
                        placeholder="如 day2_02，创建后不可改"
                        maxlength="64"
                    />
                </el-form-item>
                <el-form-item label="标题" required>
                    <el-input
                        v-model="createForm.title"
                        placeholder="最多 200 字"
                        maxlength="200"
                        show-word-limit
                    />
                </el-form-item>
                <el-form-item label="启用">
                    <el-switch v-model="createForm.enabled" />
                </el-form-item>
            </el-form>
            <p class="tip">
                排序、提示点奖励与答案建好后在中间栏的「题目主数据」标签里填；这里只建题目主数据，页面内容保存后才会生效。
            </p>
            <template #footer>
                <el-button @click="createOpen = false">取消</el-button>
                <el-button type="primary" :loading="creating" @click="submitCreate">
                    创建并编辑
                </el-button>
            </template>
        </el-dialog>
    </div>
</template>

<style scoped>
.studio {
    display: grid;
    grid-template-columns: 220px minmax(0, 1fr) 420px;
    gap: 12px;
    align-items: start;
    min-height: calc(100vh - 120px);
}

@media (max-width: 1400px) {
    .studio {
        grid-template-columns: 200px minmax(0, 1fr);
    }

    .studio__side {
        grid-column: 1 / -1;
    }
}

.studio__list,
.studio__editor,
.studio__side {
    padding: 12px;
    border: 1px solid var(--el-border-color-lighter);
    border-radius: 6px;
    background: var(--el-bg-color);
}

.studio__list-head {
    display: flex;
    gap: 6px;
    margin-bottom: 8px;
}

.studio__list-actions {
    margin-bottom: 8px;
}

.studio__list-body {
    max-height: calc(100vh - 200px);
}

.puzzle-item {
    display: flex;
    flex-direction: column;
    gap: 2px;
    width: 100%;
    margin-bottom: 4px;
    padding: 6px 8px;
    border: 1px solid transparent;
    border-radius: 4px;
    background: transparent;
    text-align: left;
    cursor: pointer;
}

.puzzle-item:hover {
    background: var(--el-fill-color-light);
}

.puzzle-item.is-active {
    border-color: var(--el-color-primary);
    background: var(--el-color-primary-light-9);
}

.puzzle-item__title {
    font-size: 13px;
    color: var(--el-text-color-primary);
}

.puzzle-item__meta {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    color: var(--el-text-color-secondary);
}

.studio__editor-head {
    display: flex;
    align-items: baseline;
    gap: 10px;
    margin-bottom: 10px;
}

.studio__editor-head h3 {
    margin: 0;
    font-size: 15px;
}

.studio__tabs {
    min-height: 200px;
}

.studio__editor-tabs {
    margin-top: -6px;
}

.tip {
    margin: 0;
    font-size: 12px;
    color: var(--el-text-color-secondary);
    line-height: 1.5;
}
</style>
