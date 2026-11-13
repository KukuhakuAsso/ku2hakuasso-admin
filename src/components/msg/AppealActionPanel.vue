<script setup>
// 申诉邮件的处理面板：原「申诉工作台」的回复申诉 / 解除禁言 / 解封并入站内信抽屉。
//
// 依赖后端在邮件里内联 `appeal` 快照（2.2.0 起只有 6 个字段）：
//   { targetType, accountId, teamId, kind, state, awaitingReply }
// 处罚原因 / 到期 / 申诉进度 / 最近一封正文**本期不下发**（需要时以 GET /admin/appeals 同主体行为准），
// 所以面板只按这 6 个字段渲染；将来后端补字段时下面的 v-if 会自动生效。
//
// 工单：该主体有未办结申诉工单时，回复必须带 `ticket_id` 且先接单（admin 也不例外）。
// 申诉是「主体级」的：一个账号 / 队伍可能有多条申诉邮件，快照给的是最新状态。
//
// 回复只解锁该主体的下一条申诉，不会自动解除处罚 —— 所以解禁 / 解封是单独按钮。
import { computed, ref } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { useAuthStore } from "@/stores/auth";
import { replyAppeal, unmuteAccount, unmuteTeam } from "@/api/moderation";
import { unbanPlayer } from "@/api/players";
import { unbanTeam } from "@/api/teams";
import { extractErrorMessage } from "@/api/errors";
import {
    TICKET_ERROR_ACTION,
    claimTicketQuietly,
    describeTicketError,
} from "@/composables/useTicketActions";
import { fmtTime } from "@/utils/format";

const props = defineProps({
    // 邮件详情里内联的申诉快照（没有则为 null；父级会换成说明，不再回退普通回复框）
    appeal: { type: Object, default: null },
    // 该主体未办结的申诉工单：回复要带 ticket_id，未接单时先 claim
    ticketId: { type: [Number, String], default: null },
    // 只读查看（工单没归我，但账号有只读能力）：不回复，只保留解禁 / 解封这类处罚操作
    readOnly: { type: Boolean, default: false },
});
const emit = defineEmits(["done", "conflict"]);

const auth = useAuthStore();
const content = ref("");
const busyKey = ref("");

const targetType = computed(() =>
    props.appeal?.targetType === "team" ? "team" : "account",
);
const targetId = computed(() =>
    targetType.value === "team"
        ? props.appeal?.teamId
        : props.appeal?.accountId,
);
const kind = computed(() => props.appeal?.kind || "");
const awaitingReply = computed(() => Boolean(props.appeal?.awaitingReply));
const canReply = computed(
    () =>
        !props.readOnly &&
        awaitingReply.value &&
        Boolean(targetId.value) &&
        (kind.value === "mute" ? auth.can("moderation.mute") : auth.isAdmin),
);
const canUnmute = computed(
    () =>
        kind.value === "mute" &&
        Boolean(targetId.value) &&
        auth.can("moderation.mute"),
);
const canUnban = computed(
    () => kind.value === "ban" && Boolean(targetId.value) && auth.isAdmin,
);

const kindText = computed(() => {
    if (kind.value === "ban") {
        return targetType.value === "team" ? "队伍封禁申诉" : "账号封禁申诉";
    }
    if (kind.value === "mute") {
        return targetType.value === "team" ? "队伍禁言申诉" : "账号禁言申诉";
    }
    return "申诉";
});

// appeal.state：none / can_submit / awaiting_reply / closed
const STATE_META = {
    none: { label: "无需申诉", type: "info" },
    can_submit: { label: "可提交", type: "success" },
    awaiting_reply: { label: "等官方反馈", type: "warning" },
    closed: { label: "已关闭", type: "danger" },
};
const stateMeta = computed(
    () =>
        STATE_META[props.appeal?.state] || {
            label: props.appeal?.state || "—",
            type: "info",
        },
);
const reason = computed(() =>
    kind.value === "ban" ? props.appeal?.banReason : props.appeal?.muteReason,
);
const until = computed(() => {
    const value =
        kind.value === "ban" ? props.appeal?.banUntil : props.appeal?.muteUntil;
    return value ? `至 ${fmtTime(value)}` : "永久 / 未设置到期";
});
// 处罚原因 / 到期只有申诉列表行才下发（邮件里的快照只有 6 个字段）：
// 有值才显示，避免恒定为空时渲染「— · 永久 / 未设置到期」。
const penaltyLine = computed(() => {
    if (!reason.value && !props.appeal?.banUntil && !props.appeal?.muteUntil) {
        return "";
    }
    return `${reason.value || "—"} · ${until.value}`;
});

// 回复申诉：有未办结工单时带 ticket_id（否则后端 400）；未接单时后端 409
// TICKET_NOT_CLAIMED —— 接单后重试一次（admin 也必须先 claim，没有例外）。
async function submitReply({ retried = false } = {}) {
    const text = content.value.trim();
    if (!text) {
        ElMessage.warning("请填写回复正文");
        return;
    }

    const ticketId = props.ticketId;
    const body = {
        kind: kind.value,
        content: text,
        ...(ticketId ? { ticket_id: ticketId } : {}),
    };

    busyKey.value = "reply";
    try {
        const data = await replyAppeal(targetType.value, targetId.value, body);
        ElMessage.success("已回复，该主体可以继续申诉");
        content.value = "";
        emit("done", data);
    } catch (err) {
        const descriptor = describeTicketError(err);

        // 没接单：接手后原样重试一次（草稿保留）
        if (
            descriptor?.action === TICKET_ERROR_ACTION.CLAIM &&
            !retried &&
            ticketId
        ) {
            const attempt = await claimTicketQuietly(ticketId);
            if (attempt.ok) {
                await submitReply({ retried: true });
                return;
            }
        }

        // 被他人接手 / 工单已变化：父级会刷新列表与详情
        if (
            descriptor?.action === TICKET_ERROR_ACTION.HELD ||
            descriptor?.action === TICKET_ERROR_ACTION.RELOAD
        ) {
            ElMessage.warning(descriptor.message);
            emit("conflict");
            return;
        }

        if (err?.status === 404) {
            ElMessage.error("该主体没有可回复的申诉（可能已被处理）");
            emit("done", null);
            return;
        }
        ElMessage.error(
            descriptor?.message || extractErrorMessage(err, "回复失败"),
        );
    } finally {
        busyKey.value = "";
    }
}

async function unmute() {
    try {
        await ElMessageBox.confirm(
            "确认解除该主体的禁言？",
            "解除禁言",
            { type: "warning", confirmButtonText: "解除禁言" },
        );
    } catch {
        return;
    }

    busyKey.value = "unmute";
    try {
        await (targetType.value === "team"
            ? unmuteTeam(targetId.value)
            : unmuteAccount(targetId.value));
        ElMessage.success("已解除禁言");
        emit("done", null);
    } catch (err) {
        if (err?.status === 404) {
            ElMessage.info("该主体当前未被禁言（可能已到期自动解除）");
            emit("done", null);
            return;
        }
        ElMessage.error(extractErrorMessage(err, "解除禁言失败"));
    } finally {
        busyKey.value = "";
    }
}

async function unban() {
    try {
        await ElMessageBox.confirm(
            "确认解除该主体的封禁？",
            "解封",
            { type: "warning", confirmButtonText: "解封" },
        );
    } catch {
        return;
    }

    busyKey.value = "unban";
    try {
        await (targetType.value === "team"
            ? unbanTeam(targetId.value)
            : unbanPlayer(targetId.value));
        ElMessage.success("已解封（被封禁覆盖的原禁言不会恢复）");
        emit("done", null);
    } catch (err) {
        ElMessage.error(extractErrorMessage(err, "解封失败"));
    } finally {
        busyKey.value = "";
    }
}
</script>

<template>
    <div class="appeal-panel">
        <div class="appeal-panel__meta">
            <el-tag size="small" type="info">{{ kindText }}</el-tag>
            <el-tag size="small" :type="stateMeta.type">
                {{ stateMeta.label }}
            </el-tag>
            <span v-if="appeal?.used !== undefined">
                申诉进度 {{ appeal.used ?? 0 }}/{{ appeal.limit ?? 3 }}
            </span>
            <span v-if="penaltyLine" class="tip">{{ penaltyLine }}</span>
        </div>

        <el-input
            v-if="canReply"
            v-model="content"
            type="textarea"
            :rows="3"
            maxlength="2000"
            show-word-limit
            placeholder="回复正文（1–2000 字）。回复只解锁下一条申诉，不会自动解除处罚"
        />
        <p v-else class="tip">
            {{
                readOnly
                    ? "只读查看：该申诉工单未由你接手，接手后才能回复申诉。"
                    : awaitingReply
                      ? "当前账号没有回复这类申诉的权限（封禁申诉仅 admin，禁言申诉需 moderation.mute）。"
                      : "该主体当前没有待回复的申诉。"
            }}
        </p>

        <div class="appeal-panel__actions">
            <el-button
                v-if="canReply"
                type="primary"
                :loading="busyKey === 'reply'"
                @click="submitReply"
            >
                发送回复
            </el-button>
            <el-button
                v-if="canUnmute"
                type="success"
                plain
                :loading="busyKey === 'unmute'"
                @click="unmute"
            >
                解除禁言
            </el-button>
            <el-button
                v-if="canUnban"
                type="danger"
                plain
                :loading="busyKey === 'unban'"
                @click="unban"
            >
                解封
            </el-button>
        </div>
    </div>
</template>

<style scoped>
.appeal-panel {
    display: flex;
    flex-direction: column;
    gap: 8px;
}

.appeal-panel__meta,
.appeal-panel__actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
}

.appeal-panel__meta {
    font-size: 12px;
    color: var(--el-text-color-regular);
}

.tip {
    color: #909399;
    font-size: 12px;
}
</style>
