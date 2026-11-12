<script setup>
// 求提示邮件的处理面板：原「提示工作台」的报价 / 降价 / 拒绝降价 / 拒绝并入站内信抽屉。
//
// 依赖后端在邮件（列表元素与详情 `mail` 同形）里内联 `hint` 快照：
//   { requestId, kind, status, quotedCost, cheaperRequestedAt, cheaperDecidedAt, … }
// 字段还没下发时只显示说明、不给动作，避免点了才 404。
//
// 报价即受理（释放该队一个待报价名额）；答复只落服务端 draft_reply，
// 玩家确认扣费后才作为消息送达，所以这里不自己写 channel。
import { computed, ref, watch } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import {
    declineCheaperHint,
    quoteHint,
    rejectHint,
    requoteHint,
} from "@/api/msg";
import {
    TICKET_ERROR_ACTION,
    describeTicketError,
} from "@/composables/useTicketActions";
import { extractErrorMessage } from "@/api/errors";
import { HINT_STATUS, statusMeta } from "@/utils/format";

const props = defineProps({
    // 邮件详情里内联的提示请求快照（没有则为 null）
    hint: { type: Object, default: null },
    // 当前工单（未办结时动作要带 ticket_id）
    ticketId: { type: [Number, String], default: null },
});
const emit = defineEmits(["done", "conflict"]);

const cost = ref(null);
const reply = ref("");
const busyKey = ref("");

const requestId = computed(() => props.hint?.requestId ?? null);
const status = computed(() => props.hint?.status ?? "");
const quotedCost = computed(() => {
    const raw = props.hint?.quotedCost;
    return raw === null || raw === undefined ? null : Number(raw);
});
const costText = computed(() =>
    quotedCost.value === null ? "—" : `${quotedCost.value} 点`,
);
// 有待回应的降价申请：只有此时才能「降价」或「拒绝降价」
const needsCheaperReply = computed(
    () =>
        Boolean(props.hint?.cheaperRequestedAt) &&
        !props.hint?.cheaperDecidedAt,
);

const canQuote = computed(
    () => status.value === "pending" && Boolean(requestId.value),
);
const canRequote = computed(
    () =>
        status.value === "quoted" &&
        needsCheaperReply.value &&
        Boolean(requestId.value),
);
const canReject = computed(
    () =>
        Boolean(requestId.value) &&
        (status.value === "pending" || status.value === "quoted"),
);

// 切到另一条提示请求（或刷新后换了请求）时清空草稿
watch(requestId, () => {
    cost.value = null;
    reply.value = "";
});

function extra() {
    return props.ticketId ? { ticket_id: props.ticketId } : {};
}

function readForm(mode) {
    const value = Number(cost.value);
    if (
        cost.value === null ||
        cost.value === undefined ||
        !Number.isInteger(value) ||
        value < 0 ||
        value > 1000000
    ) {
        ElMessage.warning("请填写 0–1000000 的整数点数");
        return null;
    }
    const text = reply.value.trim();
    if (!text) {
        ElMessage.warning("请填写答复内容");
        return null;
    }
    if (
        mode === "requote" &&
        quotedCost.value !== null &&
        value >= quotedCost.value
    ) {
        ElMessage.warning(`新报价必须低于当前报价（${quotedCost.value} 点）`);
        return null;
    }
    return { cost: value, reply: text };
}

// 工单类错误统一翻译；RELOAD / HELD 交给父级刷新列表与详情（草稿保留）
function reportError(err, fallback) {
    const descriptor = describeTicketError(err);
    if (
        descriptor?.action === TICKET_ERROR_ACTION.RELOAD ||
        descriptor?.action === TICKET_ERROR_ACTION.HELD
    ) {
        ElMessage.warning(descriptor.message);
        emit("conflict");
        return;
    }
    ElMessage.error(descriptor?.message || extractErrorMessage(err, fallback));
}

async function submitQuote() {
    const mode = canRequote.value ? "requote" : "quote";
    const payload = readForm(mode);
    if (!payload) return;

    busyKey.value = mode;
    try {
        const body = { ...payload, ...extra() };
        const data =
            mode === "requote"
                ? await requoteHint(requestId.value, body)
                : await quoteHint(requestId.value, body);
        ElMessage.success(
            mode === "requote"
                ? "已降价并更新答复，等待玩家按新价确认"
                : "已报价，等待玩家确认扣费",
        );
        cost.value = null;
        reply.value = "";
        emit("done", data);
    } catch (err) {
        reportError(err, "提交失败");
    } finally {
        busyKey.value = "";
    }
}

// 拒绝降价：不改价不改答复，只把当前报价标记为最低报价
async function declineCheaper() {
    try {
        await ElMessageBox.confirm(
            `确认后当前报价（${costText.value}）即为最低报价，玩家不能再申请更便宜。`,
            "拒绝降价",
            { type: "warning", confirmButtonText: "确认拒绝降价" },
        );
    } catch {
        return;
    }

    busyKey.value = "decline";
    try {
        const data = await declineCheaperHint(requestId.value, extra());
        ElMessage.success("已拒绝降价，当前报价已标记为最低报价");
        emit("done", data);
    } catch (err) {
        reportError(err, "拒绝降价失败");
    } finally {
        busyKey.value = "";
    }
}

async function reject() {
    let reason = "";
    try {
        const { value } = await ElMessageBox.prompt(
            "拒绝后该请求终止，已写下的答复会被清空（玩家未确认扣费，不产生退款）。",
            "拒绝求提示",
            {
                inputType: "textarea",
                inputPlaceholder: "拒绝原因（可选，≤200 字）",
                inputValidator: (v) =>
                    !v || v.length <= 200 ? true : "拒绝原因不能超过 200 字",
            },
        );
        reason = value || "";
    } catch {
        return;
    }

    busyKey.value = "reject";
    try {
        const data = await rejectHint(requestId.value, {
            reason: reason.trim(),
            ...extra(),
        });
        ElMessage.success("已拒绝");
        emit("done", data);
    } catch (err) {
        reportError(err, "拒绝失败");
    } finally {
        busyKey.value = "";
    }
}
</script>

<template>
    <div class="hint-panel">
        <div v-if="hint" class="hint-panel__meta">
            <el-tag size="small" :type="statusMeta(status, HINT_STATUS).type">
                {{ statusMeta(status, HINT_STATUS).label }}
            </el-tag>
            <span>当前报价 <strong>{{ costText }}</strong></span>
            <el-tag v-if="needsCheaperReply" size="small" type="warning">
                玩家申请降价
            </el-tag>
            <el-tag v-if="hint?.isLowestPrice" size="small" type="success" effect="plain">
                已是最低价
            </el-tag>
        </div>

        <el-alert
            v-if="!requestId"
            type="info"
            :closable="false"
            show-icon
            title="缺少提示请求数据（后端尚未下发 hint.requestId），暂时不能在这里报价 / 答复"
        />

        <template v-else>
            <div v-if="canQuote || canRequote" class="hint-panel__form">
                <div class="hint-panel__row">
                    <span class="hint-panel__label">点数</span>
                    <el-input-number
                        v-model="cost"
                        :min="0"
                        :max="1000000"
                        :precision="0"
                        :step="1"
                        style="width: 170px"
                    />
                    <span class="tip">
                        {{
                            canRequote
                                ? "新报价必须更低，且要同时给出新的答复"
                                : "报价即受理，答复在玩家确认扣费后才送达"
                        }}
                    </span>
                </div>
                <el-input
                    v-model="reply"
                    type="textarea"
                    :rows="3"
                    maxlength="2000"
                    show-word-limit
                    placeholder="答复内容（1–2000 字，只存服务端，玩家确认扣费后才送达）"
                />
            </div>

            <div class="hint-panel__actions">
                <el-button
                    v-if="canQuote"
                    type="primary"
                    :loading="busyKey === 'quote'"
                    @click="submitQuote"
                >
                    提交报价
                </el-button>
                <el-button
                    v-if="canRequote"
                    type="primary"
                    :loading="busyKey === 'requote'"
                    @click="submitQuote"
                >
                    降价并保存答复
                </el-button>
                <el-button
                    v-if="canRequote"
                    :loading="busyKey === 'decline'"
                    @click="declineCheaper"
                >
                    拒绝降价
                </el-button>
                <el-button
                    v-if="canReject"
                    type="danger"
                    :loading="busyKey === 'reject'"
                    @click="reject"
                >
                    拒绝
                </el-button>
                <span v-if="status === 'quoted' && !needsCheaperReply" class="tip">
                    已报价，等待玩家确认扣费或申请降价
                </span>
                <span v-else-if="status === 'answered'" class="tip">
                    玩家已确认扣费，答复已送达
                </span>
                <span v-else-if="status === 'rejected'" class="tip">
                    已拒绝：{{ hint?.reason || "—" }}
                </span>
            </div>
        </template>
    </div>
</template>

<style scoped>
.hint-panel {
    display: flex;
    flex-direction: column;
    gap: 8px;
}

.hint-panel__meta,
.hint-panel__row,
.hint-panel__actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
}

.hint-panel__meta {
    font-size: 12px;
    color: var(--el-text-color-regular);
}

.hint-panel__form {
    display: flex;
    flex-direction: column;
    gap: 8px;
}

.hint-panel__label {
    font-size: 12px;
    color: var(--el-text-color-secondary);
}

.tip {
    color: #909399;
    font-size: 12px;
}
</style>
