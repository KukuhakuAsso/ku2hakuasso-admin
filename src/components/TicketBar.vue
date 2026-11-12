<script setup>
// 工单状态条：站内信详情抽屉与求提示展开行共用。
//
// 只负责展示 + 一个「退出/标记未处理」入口，所有判定都由调用方算好传进来：
//   · canRelease 由调用方判断（处理中 + 我是处理人 / admin 强制退回）
//   · 超时直接用服务端字段（overdue / pendingOverdue / processingOverdue），
//     不在前端拿 ageHours 自己算，避免与服务端 SLA 配置不一致
import { computed } from "vue";
import { ElButton, ElTag } from "element-plus";
import {
    TICKET_KIND,
    TICKET_STATUS,
    statusMeta,
    ticketAssigneeName,
} from "@/utils/format";

const props = defineProps({
    // 列表项/详情里的 ticket 对象（没有工单时为 null）
    ticket: { type: Object, default: null },
    // 顶层 ticketStatus 的兜底（threaded 行 / 详情返回里可能只有它）
    ticketStatus: { type: String, default: "" },
    canRelease: { type: Boolean, default: false },
    // 强制退回（admin 退他人工单）：只改按钮文案与配色，判定仍由调用方给
    forceRelease: { type: Boolean, default: false },
    busy: { type: Boolean, default: false },
});

const emit = defineEmits(["release"]);

const status = computed(() => props.ticket?.status || props.ticketStatus || "");
const meta = computed(() =>
    status.value ? statusMeta(status.value, TICKET_STATUS) : null,
);
const kindMeta = computed(() =>
    props.ticket?.kind ? statusMeta(props.ticket.kind, TICKET_KIND) : null,
);
const assignee = computed(() => ticketAssigneeName(props.ticket));
const overdue = computed(() =>
    Boolean(
        props.ticket?.overdue ||
            props.ticket?.pendingOverdue ||
            props.ticket?.processingOverdue,
    ),
);
// 已等待时长：只认服务端给的 ageHours（未办结时才有值）
const ageText = computed(() => {
    const hours = props.ticket?.ageHours;
    if (typeof hours !== "number" || !Number.isFinite(hours) || hours < 0) {
        return "";
    }
    if (hours < 1) return `已等待 ${Math.max(1, Math.round(hours * 60))} 分钟`;
    return `已等待 ${Math.round(hours)} 小时`;
});
</script>

<template>
    <div v-if="!status" class="ticket-bar ticket-bar--empty">
        没有工单（公告类只读邮件、或规则调整前的历史记录不产生工单）。
    </div>
    <div v-else class="ticket-bar">
        <el-tag size="small" :type="meta.type">{{ meta.label }}</el-tag>
        <el-tag
            v-if="kindMeta"
            size="small"
            :type="kindMeta.type"
            effect="plain"
        >
            {{ kindMeta.label }}
        </el-tag>
        <span class="ticket-bar__assignee">
            {{ assignee ? `处理人：${assignee}` : "未接手" }}
        </span>
        <span v-if="ageText" class="ticket-bar__age">{{ ageText }}</span>
        <el-tag v-if="overdue" size="small" type="danger" effect="plain">
            超时
        </el-tag>
        <el-button
            v-if="canRelease"
            link
            :type="forceRelease ? 'danger' : 'primary'"
            size="small"
            :loading="busy"
            :title="
                forceRelease
                    ? '强制退回他人工单：原处理人会被解除占用，其他同事可接手'
                    : '把工单退回待处理，其他同事可接手；待处理计时不会重置'
            "
            @click="emit('release')"
        >
            {{ forceRelease ? "强制退回" : "退出 / 标记未处理" }}
        </el-button>
    </div>
</template>

<style scoped>
.ticket-bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    padding: 8px 10px;
    border: 1px solid var(--el-border-color-lighter);
    border-radius: 6px;
    background: var(--el-fill-color-lighter);
    font-size: 12px;
}

.ticket-bar--empty {
    color: var(--el-text-color-secondary);
}

.ticket-bar__assignee,
.ticket-bar__age {
    color: var(--el-text-color-regular);
}
</style>
