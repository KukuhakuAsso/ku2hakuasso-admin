<template>
    <el-dialog
        :model-value="modelValue"
        :title="title"
        width="460px"
        @update:model-value="emit('update:modelValue', $event)"
    >
        <p class="subject">
            对象：<strong>{{ target?.label || "—" }}</strong>
            （{{ target?.kind === "team" ? "队伍级禁言" : "账号级禁言" }}）
        </p>

        <el-form label-width="90px" @submit.prevent="submit">
            <el-form-item label="原因" required :error="reasonError">
                <el-input
                    v-model="form.reason"
                    type="textarea"
                    :rows="3"
                    maxlength="200"
                    show-word-limit
                    placeholder="会显示在对方的禁言状态里（1–200 字，必填）"
                />
            </el-form-item>
            <el-form-item label="禁言至" :error="untilError">
                <el-date-picker
                    v-model="form.until"
                    type="datetime"
                    placeholder="留空为永久（不会自动解除）"
                    style="width: 100%"
                />
            </el-form-item>
        </el-form>

        <el-alert
            type="info"
            :closable="false"
            show-icon
            title="重复禁言会覆盖原记录，并重置该主体的申诉额度"
            description="到期后服务端自动解除；已封禁的目标不能禁言（需先解封）。"
        />

        <template #footer>
            <el-button @click="emit('update:modelValue', false)">取消</el-button>
            <el-button type="danger" :loading="loading" @click="submit">
                确认禁言
            </el-button>
        </template>
    </el-dialog>
</template>

<script setup>
import { computed, reactive, ref, watch } from "vue";
import { ElMessage } from "element-plus";
import { muteAccount, muteTeam } from "@/api/moderation";

// 禁言对话框：账号级（players/:id/mute）或队伍级（teams/:id/mute）。
// reason 必填 1–200；until 省略 = 永久，必须是未来时间（否则后端 400）。
const props = defineProps({
    modelValue: { type: Boolean, default: false },
    // { kind: "account" | "team", id, label }
    target: { type: Object, default: null },
});
const emit = defineEmits(["update:modelValue", "done"]);

const loading = ref(false);
const form = reactive({ reason: "", until: null });
const reasonError = ref("");
const untilError = ref("");

const title = computed(() =>
    props.target?.kind === "team" ? "禁言队伍" : "禁言账号",
);

watch(
    () => props.modelValue,
    (open) => {
        if (!open) return;
        form.reason = "";
        form.until = null;
        reasonError.value = "";
        untilError.value = "";
    },
);

function validate() {
    reasonError.value = "";
    untilError.value = "";

    const reason = form.reason.trim();
    if (!reason) {
        reasonError.value = "请填写禁言原因（1–200 字）";
        return null;
    }
    if (reason.length > 200) {
        reasonError.value = "原因最多 200 字";
        return null;
    }

    // until 必须是未来时间：后端会 400，本地先拦一次
    if (form.until && new Date(form.until).getTime() <= Date.now()) {
        untilError.value = "到期时间必须晚于当前时间";
        return null;
    }

    return {
        reason,
        until: form.until ? new Date(form.until).toISOString() : null,
    };
}

async function submit() {
    if (!props.target?.id) return;
    const payload = validate();
    if (!payload) return;

    loading.value = true;
    try {
        const request = props.target.kind === "team" ? muteTeam : muteAccount;
        const data = await request(props.target.id, payload);

        ElMessage.success(
            data?.overwritten
                ? "已更新该主体原有的禁言（原因 / 到期 / 操作人已覆盖）"
                : "已禁言，到期后服务端自动解除",
        );
        emit("update:modelValue", false);
        emit("done", data);
    } catch (err) {
        const message = err?.message || "禁言失败";
        const fields = err?.detail?.detail?.fields || {};
        if (err?.status === 409) {
            ElMessage.error(
                message.includes("封禁")
                    ? "该目标已封禁，请先解封再禁言"
                    : message,
            );
        } else if (err?.status === 404) {
            ElMessage.error("目标不存在（账号已注销或队伍已解散）");
        } else if (fields.reason || fields.until) {
            reasonError.value = fields.reason || "";
            untilError.value = fields.until || "";
            ElMessage.error(fields.reason || fields.until);
        } else {
            ElMessage.error(message);
        }
    } finally {
        loading.value = false;
    }
}
</script>

<style scoped>
.subject {
    margin: 0 0 12px;
    font-size: 13px;
    color: var(--el-text-color-regular);
}
</style>
