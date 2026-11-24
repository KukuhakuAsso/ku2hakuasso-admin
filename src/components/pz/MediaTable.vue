<script setup>
// 素材表格：本题素材面板与「素材库」各子页签共用。
//
// 只负责展示 + 行内动作；取数由调用方决定 view：
//   puzzle → 本题可用（行带 usedInPage / marked，可「标记本题 / 取消标记」）
//   used   → 本题已使用（行带 sources / invalid / invalidReason）
//   owner / public / usable / all → 素材库的各子页签
//
// 权限口径（mistarg.2.3.0）：私有素材本人或 admin 可改；公共素材只有 admin 能改，
// 作者只能申请撤回。撤回影响面用 withdrawImpact（2.4.0 起取代 referencedBy* 字段）。
import { computed, reactive, ref } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { useAuthStore } from "@/stores/auth";
import {
    approveMediaWithdraw,
    cancelMediaWithdraw,
    getMediaUsage,
    markPuzzleMedia,
    requestMediaWithdraw,
    unmarkPuzzleMedia,
    updateMedia,
} from "@/api/pz";
import { describeApiError } from "@/api/errors";
import { useIsMobile } from "@/composables/useMediaQuery";
import RowActionSheet from "@/components/RowActionSheet.vue";
import MediaPreviewDialog from "@/components/pz/MediaPreviewDialog.vue";

const props = defineProps({
    rows: { type: Array, default: () => [] },
    loading: { type: Boolean, default: false },
    // 当前视图：puzzle / used / owner / public / usable / all
    view: { type: String, default: "" },
    // 本题标记 / 取消标记需要的题目 key（view=puzzle|used 时必填）
    puzzleKey: { type: String, default: "" },
});
const emit = defineEmits(["refresh"]);

const auth = useAuthStore();

const isPuzzleView = computed(() => props.view === "puzzle");
const isUsedView = computed(() => props.view === "used");

const isPublic = (row) => row?.scope === "public";
const isMine = (row) =>
    row?.ownerId !== null &&
    row?.ownerId !== undefined &&
    String(row.ownerId) === String(auth.account?.id);

const canEdit = (row) => (isPublic(row) ? auth.isAdmin : auth.isAdmin || isMine(row));
// 预览下发口径：admin 任意；出题人自己的全部素材 + 任何公共素材；其余后端 403
const canPreview = (row) => auth.isAdmin || isPublic(row) || isMine(row);
const canRequestWithdraw = (row) => isPublic(row) && isMine(row) && !row.withdrawRequestedAt;
const canCancelWithdraw = (row) => isPublic(row) && isMine(row) && Boolean(row.withdrawRequestedAt);
const canApproveWithdraw = (row) => auth.isAdmin && Boolean(row.withdrawRequestedAt);
const canCollect = (row) => auth.isAdmin && !isPublic(row) && Boolean(row.allowShare);
const canDelist = (row) => auth.isAdmin && isPublic(row);

// 本题使用状态：view=puzzle 是布尔标记；view=used 是 sources 数组
const pageUsed = (row) =>
    Boolean(row?.usedInPage) ||
    (Array.isArray(row?.sources) && row.sources.includes("page"));
const marked = (row) =>
    Boolean(row?.marked) || (Array.isArray(row?.sources) && row.sources.includes("mark"));
const isInvalid = (row) => Boolean(row?.invalid);

const busyId = ref(null);
const emptyText = computed(() => {
    if (props.loading) return "加载中…";
    if (props.view === "puzzle") return "本题还没有可用素材";
    if (props.view === "used") return "本题还没有使用任何素材";
    return "暂无素材";
});

// ---- 手机端行操作面板（行尾「⋯」触发）----
// 桌面操作列是 240px 的固定列，窄屏下会把文件/归属这些中间列压没，
// 所以在手机上收成 64px 的「⋯」，点开是底部动作面板。
const isMobile = useIsMobile();
const sheet = reactive({ visible: false, row: null });

// 素材预览：图片/音视频内联播放，PDF/文件走下载（同一份受保护下发路径）
const preview = reactive({ visible: false, row: null });

const sheetTitle = computed(() => {
    const row = sheet.row;
    if (!row) return "";
    return `#${row.id} ${row.filename || "（未命名素材）"}`;
});

const sheetActions = computed(() => (sheet.row ? rowActions(sheet.row) : []));

// 桌面操作列与手机端面板共用同一份动作清单，避免两处口径漂移
function rowActions(row) {
    const busy = Boolean(busyId.value);
    const actions = [];
    actions.push({
        key: "preview",
        label: "预览",
        type: "primary",
        disabled: !canPreview(row) || busy,
        hint: canPreview(row)
            ? "图片 / 音视频直接播放，PDF / 文件走下载"
            : "只能预览自己的素材或公共素材",
    });
    if (isPuzzleView.value || isUsedView.value) {
        actions.push(
            marked(row)
                ? {
                      key: "unmark",
                      label: "取消标记",
                      type: "warning",
                      disabled: busy,
                      hint: "从本题已使用列表移除",
                  }
                : {
                      key: "mark",
                      label: "标记本题",
                      type: "primary",
                      disabled: busy,
                      hint: "归入本题已使用列表，不影响页面渲染",
                  },
        );
    }
    if (canEdit(row)) {
        actions.push({
            key: "edit",
            label: "编辑",
            type: "primary",
            disabled: busy,
            hint: "展示名 / 备注 / 启用状态 / 他人可用",
        });
    }
    if (auth.isAdmin) {
        actions.push({
            key: "usage",
            label: "引用",
            type: "info",
            disabled: busy,
            hint: "查看哪些题目引用了它",
        });
    }
    if (canCollect(row)) {
        actions.push({
            key: "collect",
            label: "收录",
            type: "success",
            disabled: busy,
            hint: "放进公共区，所有出题人都能用",
        });
    }
    if (canDelist(row)) {
        actions.push({
            key: "delist",
            label: "下架",
            type: "danger",
            disabled: busy,
            hint: "回到作者私有区",
        });
    }
    if (canRequestWithdraw(row)) {
        actions.push({
            key: "withdraw",
            label: "申请撤回",
            type: "warning",
            disabled: busy,
            hint: "提交后等待管理员处理",
        });
    }
    if (canCancelWithdraw(row)) {
        actions.push({
            key: "cancel-withdraw",
            label: "撤销申请",
            disabled: busy,
            hint: "放弃这次撤回，素材保持公共",
        });
    }
    if (canApproveWithdraw(row)) {
        actions.push({
            key: "approve",
            label: "同意撤回",
            type: "success",
            disabled: busy,
            hint: "素材回到作者私有区",
        });
        actions.push({
            key: "reject",
            label: "驳回",
            type: "info",
            disabled: busy,
            hint: "保持公共，拒绝这次撤回",
        });
    }
    return actions;
}

function openSheet(row) {
    sheet.row = row;
    sheet.visible = true;
}

function openPreview(row) {
    preview.row = row;
    preview.visible = true;
}

function onSheetSelect(key) {
    const row = sheet.row;
    sheet.visible = false;
    if (!row) return;
    if (key === "preview") openPreview(row);
    else if (key === "mark") markForPuzzle(row);
    else if (key === "unmark") unmarkForPuzzle(row);
    else if (key === "edit") openEdit(row);
    else if (key === "usage") openUsage(row);
    else if (key === "collect") collect(row);
    else if (key === "delist") delist(row);
    else if (key === "withdraw") requestWithdraw(row);
    else if (key === "cancel-withdraw") cancelWithdraw(row);
    else if (key === "approve") approveWithdraw(row);
    else if (key === "reject") cancelWithdraw(row);
}

async function run(row, action, request, successText) {
    if (busyId.value) return;
    busyId.value = `${row.id}:${action}`;
    try {
        await request();
        ElMessage.success(successText);
        emit("refresh");
    } catch (error) {
        // reason_code（MEDIA_*）的文案在 api/errors.js 统一维护
        ElMessage.error(describeApiError(error, { fallback: "操作失败" }));
    } finally {
        busyId.value = null;
    }
}

function collect(row) {
    return run(
        row,
        "collect",
        () => updateMedia(row.id, { scope: "public" }),
        "已收录到公共区",
    );
}

// 下架：作者回到私有；无作者（ownerId 为空）时必须同时指定归属
async function delist(row) {
    let ownerId = row.ownerId;
    if (ownerId === null || ownerId === undefined) {
        try {
            const { value } = await ElMessageBox.prompt(
                "该素材没有作者，下架后需要指定归属的出题人账号 ID",
                "下架素材",
                {
                    inputPattern: /^\d+$/,
                    inputErrorMessage: "请填写账号 ID（数字）",
                },
            );
            ownerId = Number(value);
        } catch {
            return;
        }
    }
    await run(
        row,
        "delist",
        () => updateMedia(row.id, { scope: "private", ...(ownerId ? { ownerId } : {}) }),
        "已下架，素材回到作者私有区",
    );
}

function requestWithdraw(row) {
    return run(
        row,
        "withdraw",
        () => requestMediaWithdraw(row.id),
        "已提交撤回申请，等待管理员处理",
    );
}

function cancelWithdraw(row) {
    return run(
        row,
        "cancel-withdraw",
        () => cancelMediaWithdraw(row.id),
        auth.isAdmin ? "已驳回撤回申请（素材保持公共）" : "已撤销撤回申请",
    );
}

// 同意撤回：withdrawImpact 说明会影响哪些人（other 需该题作者自行清理，后端不阻断）
async function approveWithdraw(row) {
    const impact = row.withdrawImpact || {};
    const lines = [];
    if (Number(impact.self ?? 0) > 0) {
        lines.push(`作者自己的 ${impact.self} 道题引用了它（作者可自行清理）`);
    }
    if (Number(impact.admin ?? 0) > 0) {
        lines.push(`${impact.admin} 道管理员题目引用了它（管理员可自行处理）`);
    }
    if (Number(impact.other ?? 0) > 0 || impact.needsAttention) {
        lines.push(
            `其他出题人的 ${impact.other ?? 0} 道题引用了它，撤回后需要他们自行清理引用`,
        );
    }
    try {
        await ElMessageBox.confirm(
            ["同意后素材回到作者私有区，并清除「允许他人使用」标记。", ...lines].join("\n"),
            "同意撤回",
            { type: "warning", confirmButtonText: "同意撤回" },
        );
    } catch {
        return;
    }
    return run(
        row,
        "approve-withdraw",
        () => approveMediaWithdraw(row.id),
        "已同意撤回，素材回到作者私有区",
    );
}

// ---- 本题标记（2.4.0）----
function markForPuzzle(row) {
    if (!props.puzzleKey) return;
    return run(
        row,
        "mark",
        () => markPuzzleMedia(props.puzzleKey, row.id),
        "已归入本题使用列表",
    );
}

function unmarkForPuzzle(row) {
    if (!props.puzzleKey) return;
    return run(
        row,
        "unmark",
        () => unmarkPuzzleMedia(props.puzzleKey, row.id),
        "已从本题使用列表移除",
    );
}

// ---- admin：素材使用反查（2.4.0）----
const usage = reactive({
    visible: false,
    loading: false,
    row: null,
    items: [],
});

const RELATION_LABEL = {
    author: "作者自己的题",
    admin: "管理员题目",
    other: "其他出题人",
};

async function openUsage(row) {
    usage.row = row;
    usage.items = [];
    usage.visible = true;
    usage.loading = true;
    try {
        const data = await getMediaUsage(row.id, { limit: 200 });
        usage.items = Array.isArray(data?.items) ? data.items : [];
    } catch (error) {
        ElMessage.error(describeApiError(error, { fallback: "引用查询失败" }));
    } finally {
        usage.loading = false;
    }
}

// ---- 编辑 ----
const dialog = reactive({
    visible: false,
    loading: false,
    row: null,
    filename: "",
    note: "",
    enabled: true,
    allowShare: false,
});

function openEdit(row) {
    dialog.row = row;
    dialog.filename = row?.filename || "";
    dialog.note = row?.note || "";
    dialog.enabled = Number(row?.status) !== 0;
    dialog.allowShare = Boolean(row?.allowShare);
    dialog.visible = true;
}

async function submitEdit() {
    const row = dialog.row;
    const filename = dialog.filename.trim();
    if (!row || !filename) {
        ElMessage.warning("请填写展示名");
        return;
    }

    dialog.loading = true;
    try {
        await updateMedia(row.id, {
            filename,
            note: dialog.note.trim(),
            status: dialog.enabled ? 1 : 0,
            allowShare: dialog.allowShare,
        });
        ElMessage.success("已保存");
        dialog.visible = false;
        emit("refresh");
    } catch (error) {
        ElMessage.error(describeApiError(error, { fallback: "保存失败" }));
    } finally {
        dialog.loading = false;
    }
}

function fmtTime(value) {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    const pad = (n) => String(n).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
        date.getHours(),
    )}:${pad(date.getMinutes())}`;
}

// 待审撤回的行整行高亮，非法引用淡红，便于在长列表里扫出来
function rowClassName({ row }) {
    if (row?.withdrawRequestedAt) return "is-withdraw-pending";
    if (isInvalid(row)) return "is-invalid-ref";
    return "";
}
</script>

<template>
    <div class="media-table">
        <el-table
            v-loading="loading"
            :data="rows"
            size="small"
            border
            :row-class-name="rowClassName"
        >
            <template #empty>
                <span class="tip">{{ emptyText }}</span>
            </template>

            <el-table-column prop="id" label="ID" width="70" />
            <el-table-column label="文件" min-width="160">
                <template #default="{ row }">
                    <div>{{ row.filename || "—" }}</div>
                    <div v-if="row.note" class="sub">{{ row.note }}</div>
                    <!-- 已使用视图：这一条为什么会被算进来 -->
                    <div v-if="isUsedView" class="sub">
                        <el-tag v-if="pageUsed(row)" size="small" type="primary" effect="plain">
                            页面使用
                        </el-tag>
                        <el-tag v-if="marked(row)" size="small" type="warning" effect="plain">
                            标记
                        </el-tag>
                        <el-tag v-if="isInvalid(row)" size="small" type="danger">失效</el-tag>
                    </div>
                    <div v-if="isInvalid(row) && row.invalidReason" class="sub danger">
                        {{ row.invalidReason }}
                    </div>
                    <!-- 已使用视图：引用位置（便于去页面里定位） -->
                    <div v-if="isUsedView && row.refs?.length" class="sub">
                        <span v-for="(ref, i) in row.refs.slice(0, 3)" :key="i">
                            {{ i > 0 ? "、" : "" }}{{ ref.where || ref.path || "页面" }}
                        </span>
                        <span v-if="row.refs.length > 3">…</span>
                    </div>
                </template>
            </el-table-column>
            <el-table-column label="类型" width="80">
                <template #default="{ row }">{{ row.mediaType || "—" }}</template>
            </el-table-column>
            <el-table-column label="大小" width="90">
                <template #default="{ row }">
                    {{ Math.round((row.sizeBytes || 0) / 1024) }} KB
                </template>
            </el-table-column>
            <el-table-column label="归属" min-width="130">
                <template #default="{ row }">
                    <el-tag
                        size="small"
                        :type="isPublic(row) ? 'success' : 'info'"
                        effect="plain"
                    >
                        {{ isPublic(row) ? "公共" : "私有" }}
                    </el-tag>
                    <span v-if="auth.isAdmin && row.ownerUsername" class="sub owner">
                        {{ row.ownerUsername }}
                    </span>
                </template>
            </el-table-column>
            <!-- 本题可用：显示与本题的关系 -->
            <el-table-column v-if="isPuzzleView" label="本题" width="130">
                <template #default="{ row }">
                    <el-tag v-if="pageUsed(row)" size="small" type="primary" effect="plain">
                        页面使用
                    </el-tag>
                    <el-tag v-if="marked(row)" size="small" type="warning" effect="plain">
                        已标记
                    </el-tag>
                    <span v-if="!pageUsed(row) && !marked(row)" class="tip">—</span>
                </template>
            </el-table-column>
            <el-table-column v-else label="他人可用" width="90">
                <template #default="{ row }">
                    <el-tag v-if="Number(row.allowShare)" size="small" type="warning">
                        已允许
                    </el-tag>
                    <span v-else class="tip">—</span>
                </template>
            </el-table-column>
            <el-table-column label="状态" width="80">
                <template #default="{ row }">
                    <el-tag
                        :type="Number(row.status) === 0 ? 'info' : 'success'"
                        size="small"
                    >
                        {{ Number(row.status) === 0 ? "停用" : "可用" }}
                    </el-tag>
                </template>
            </el-table-column>
            <el-table-column label="撤回申请" width="130">
                <template #default="{ row }">
                    <el-tag v-if="row.withdrawRequestedAt" size="small" type="warning">
                        待审
                    </el-tag>
                    <div v-if="row.withdrawRequestedAt" class="sub">
                        {{ fmtTime(row.withdrawRequestedAt) }}
                    </div>
                    <span v-else class="tip">—</span>
                </template>
            </el-table-column>
            <el-table-column v-if="!isMobile" label="操作" min-width="240" fixed="right">
                <template #default="{ row }">
                    <!-- 预览：受保护下发路径，按类型内联播放或下载 -->
                    <el-button
                        v-if="canPreview(row)"
                        size="small"
                        text
                        type="primary"
                        @click="openPreview(row)"
                    >
                        预览
                    </el-button>
                    <!-- 本题可用 / 已使用：标记与取消标记 -->
                    <el-button
                        v-if="(isPuzzleView || isUsedView) && !marked(row)"
                        size="small"
                        text
                        type="primary"
                        :loading="busyId === `${row.id}:mark`"
                        @click="markForPuzzle(row)"
                    >
                        标记本题
                    </el-button>
                    <el-button
                        v-if="(isPuzzleView || isUsedView) && marked(row)"
                        size="small"
                        text
                        type="warning"
                        :loading="busyId === `${row.id}:unmark`"
                        @click="unmarkForPuzzle(row)"
                    >
                        取消标记
                    </el-button>

                    <el-button
                        v-if="canEdit(row)"
                        size="small"
                        text
                        type="primary"
                        @click="openEdit(row)"
                    >
                        编辑
                    </el-button>
                    <el-button
                        v-if="auth.isAdmin"
                        size="small"
                        text
                        type="info"
                        @click="openUsage(row)"
                    >
                        引用
                    </el-button>
                    <el-button
                        v-if="canCollect(row)"
                        size="small"
                        text
                        type="success"
                        :loading="busyId === `${row.id}:collect`"
                        @click="collect(row)"
                    >
                        收录
                    </el-button>
                    <el-button
                        v-if="canDelist(row)"
                        size="small"
                        text
                        type="danger"
                        :loading="busyId === `${row.id}:delist`"
                        @click="delist(row)"
                    >
                        下架
                    </el-button>
                    <el-button
                        v-if="canRequestWithdraw(row)"
                        size="small"
                        text
                        type="warning"
                        :loading="busyId === `${row.id}:withdraw`"
                        @click="requestWithdraw(row)"
                    >
                        申请撤回
                    </el-button>
                    <el-button
                        v-if="canCancelWithdraw(row)"
                        size="small"
                        text
                        :loading="busyId === `${row.id}:cancel-withdraw`"
                        @click="cancelWithdraw(row)"
                    >
                        撤销申请
                    </el-button>
                    <el-button
                        v-if="canApproveWithdraw(row)"
                        size="small"
                        text
                        type="success"
                        :loading="busyId === `${row.id}:approve-withdraw`"
                        @click="approveWithdraw(row)"
                    >
                        同意撤回
                    </el-button>
                    <el-button
                        v-if="canApproveWithdraw(row)"
                        size="small"
                        text
                        type="info"
                        :loading="busyId === `${row.id}:cancel-withdraw`"
                        @click="cancelWithdraw(row)"
                    >
                        驳回
                    </el-button>
                </template>
            </el-table-column>

            <!-- 手机端：操作列收成「⋯」，点开是底部动作面板 -->
            <el-table-column v-else label="操作" width="64" align="center" fixed="right">
                <template #default="{ row }">
                    <el-button
                        class="row-more"
                        text
                        :disabled="!rowActions(row).length"
                        aria-label="更多操作"
                        @click.stop="openSheet(row)"
                    >
                        ⋯
                    </el-button>
                </template>
            </el-table-column>
        </el-table>

        <RowActionSheet
            v-model="sheet.visible"
            :title="sheetTitle"
            :actions="sheetActions"
            @select="onSheetSelect"
        />

        <MediaPreviewDialog v-model="preview.visible" :row="preview.row" />

        <!-- admin：素材使用反查 -->
        <el-dialog v-model="usage.visible" title="素材引用情况" width="680px">
            <p v-if="usage.row" class="sub">
                #{{ usage.row.id }} {{ usage.row.filename || "" }}
            </p>
            <div v-loading="usage.loading">
                <el-table :data="usage.items" size="small" border max-height="360">
                    <template #empty>
                        <span class="tip">没有任何题目引用或标记该素材</span>
                    </template>
                    <el-table-column label="题目" min-width="200">
                        <template #default="{ row }">
                            <div>{{ row.title || row.puzzleKey }}</div>
                            <div class="sub">{{ row.puzzleKey }}</div>
                        </template>
                    </el-table-column>
                    <el-table-column label="关系" width="120">
                        <template #default="{ row }">
                            <el-tag
                                size="small"
                                :type="row.relation === 'other' ? 'warning' : 'info'"
                                effect="plain"
                            >
                                {{ RELATION_LABEL[row.relation] || row.relation || "—" }}
                            </el-tag>
                        </template>
                    </el-table-column>
                    <el-table-column label="引用位置" min-width="180">
                        <template #default="{ row }">
                            <template v-if="row.refs?.length">
                                <div v-for="(ref, i) in row.refs" :key="i" class="sub">
                                    {{ ref.where || ref.path || "页面" }}
                                </div>
                            </template>
                            <span v-else class="tip">—</span>
                        </template>
                    </el-table-column>
                    <el-table-column label="仅标记" width="90">
                        <template #default="{ row }">
                            <el-tag v-if="row.marked" size="small" type="warning">是</el-tag>
                            <span v-else class="tip">—</span>
                        </template>
                    </el-table-column>
                </el-table>
            </div>
            <template #footer>
                <el-button @click="usage.visible = false">关闭</el-button>
            </template>
        </el-dialog>

        <el-dialog v-model="dialog.visible" title="编辑素材" width="460px">
            <el-form label-width="100px">
                <el-form-item label="展示名" required>
                    <el-input v-model="dialog.filename" maxlength="120" show-word-limit />
                </el-form-item>
                <el-form-item label="备注">
                    <el-input
                        v-model="dialog.note"
                        type="textarea"
                        :rows="2"
                        maxlength="200"
                        show-word-limit
                    />
                </el-form-item>
                <el-form-item label="状态">
                    <el-switch v-model="dialog.enabled" active-text="可用" inactive-text="停用" />
                </el-form-item>
                <el-form-item label="允许他人使用">
                    <el-switch v-model="dialog.allowShare" />
                    <div class="sub">开启后管理员可将其收录到公共区；收录后你不能再修改。</div>
                </el-form-item>
            </el-form>
            <template #footer>
                <el-button @click="dialog.visible = false">取消</el-button>
                <el-button type="primary" :loading="dialog.loading" @click="submitEdit">
                    保存
                </el-button>
            </template>
        </el-dialog>
    </div>
</template>

<style scoped>
.media-table {
    display: flex;
    flex-direction: column;
    gap: 8px;
}

.tip {
    color: var(--el-text-color-secondary);
    font-size: 12px;
}

.sub {
    color: var(--el-text-color-secondary);
    font-size: 11px;
    line-height: 1.6;
}

.danger {
    color: var(--el-color-danger);
}

.owner {
    margin-left: 6px;
}

/* 待审撤回：整行淡黄底，方便管理员扫出待处理项 */
.media-table :deep(.is-withdraw-pending) {
    --el-table-tr-bg-color: var(--el-color-warning-light-9);
}

/* 非法引用：整行淡红底 */
.media-table :deep(.is-invalid-ref) {
    --el-table-tr-bg-color: var(--el-color-danger-light-9);
}

/* 手机端行尾的「⋯」：把 240px 的桌面操作列收成一个入口 */
.row-more {
    min-height: 36px;
    padding: 4px 10px;
    font-size: 20px;
    font-weight: 700;
    line-height: 1;
}
</style>
