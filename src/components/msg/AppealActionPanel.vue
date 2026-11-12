<script setup>
// 申诉邮件的处理面板：原「申诉工作台」的回复申诉 / 解除禁言 / 解封并入站内信抽屉。
//
// 依赖后端在邮件里内联 `appeal` 快照（与 /admin/appeals 行同形）：
//   { targetType, accountId, teamId, kind, state, awaitingReply, used, limit, … }
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
import { fmtTime } from "@/utils/format";

const props = defineProps({
    // 邮件详情里内联的申诉快照（没有则为 null；父级会回退到普通回复框）
    appeal: { type: Object, default: null },
});
const emit = defineEmits(["done"]);

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

async function submitReply() {
    const text = content.value.trim();
    if (!text) {
        ElMessage.warning("请填写回复正文");
        return;
    }

    busyKey.value = "reply";
    try {
        const data = await replyAppeal(targetType.value, targetId.value, {
            kind: kind.value,
            content: text,
        });
        ElMessage.success("已回复，该主体可以继续申诉");
        content.value = "";
        emit("done", data);
    } catch (err) {
        if (err?.status === 404) {
            ElMessage.error("该主体没有可回复的申诉（可能已被处理）");
            emit("done", null);
            return;
        }
        ElMessage.error(extractErrorMessage(err, "回复失败"));
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
            <span class="tip">{{ reason || "—" }} · {{ until }}</span>
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
                awaitingReply
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
