<template>
    <el-form label-position="top" @submit.prevent="onSubmit">
        <template v-if="mode === 'request'">
            <el-form-item label="邮箱或用户名">
                <el-input
                    v-model="identifier"
                    placeholder="填写账号，我们会把重置邮件发到注册邮箱"
                    autocomplete="username"
                />
            </el-form-item>

            <TurnstileCaptcha
                ref="captchaRef"
                :captcha="captcha"
                @update:token="captchaToken = $event"
            />

            <el-alert
                v-if="sentMessage"
                type="success"
                :closable="false"
                show-icon
                :title="sentMessage"
                description="点开邮件里的链接即可重置；也可以把邮件里的令牌粘贴到下一步。"
                class="block"
            />

            <div class="row">
                <el-button text type="primary" @click="mode = 'reset'">
                    我有重置令牌
                </el-button>
                <el-button
                    type="primary"
                    native-type="submit"
                    :loading="sending"
                    :disabled="captchaBlocked || Boolean(sentMessage)"
                >
                    发送重置邮件
                </el-button>
            </div>
        </template>

        <template v-else>
            <el-form-item label="重置令牌">
                <el-input
                    v-model="token"
                    placeholder="邮件链接里的 token 参数，或直接粘贴整条链接"
                    autocomplete="off"
                />
            </el-form-item>

            <el-form-item label="新密码" :error="passwordError">
                <el-input
                    v-model="newPassword"
                    type="password"
                    show-password
                    :placeholder="`至少 ${passwordMin} 位`"
                    autocomplete="new-password"
                />
            </el-form-item>

            <el-form-item label="确认新密码" :error="confirmError">
                <el-input
                    v-model="confirmPassword"
                    type="password"
                    show-password
                    placeholder="再输一次"
                    autocomplete="new-password"
                />
            </el-form-item>

            <div class="row">
                <el-button text @click="mode = 'request'">返回上一步</el-button>
                <el-button
                    type="primary"
                    native-type="submit"
                    :loading="resetting"
                >
                    重置密码
                </el-button>
            </div>
        </template>
    </el-form>
</template>

<script setup>
import { computed, ref } from "vue";
import { ElMessage } from "element-plus";
import TurnstileCaptcha from "@/components/TurnstileCaptcha.vue";
import { apiForgotPassword, apiResetPassword } from "@/api/auth";
import { apiConfig } from "@/config/api";
import { readApiError, validatePassword } from "@/utils/authValidation";

// 找回 / 重置密码（api-4-authentication.md §4.5）：
//   第一步 邮箱或用户名 + 人机验证 → 发重置邮件（响应恒定，不透露账号是否存在）；
//   第二步 用邮件里的令牌 + 新密码重置。令牌可从邮件链接自动带入，也可手动粘贴。
const props = defineProps({
    // reg/config 返回的 data（人机验证配置与口令长度都取自这里）
    registration: { type: Object, default: null },
    // 从 ?token= / ?reset_token= 带进来时直接进重置步骤
    initialToken: { type: String, default: "" },
});
const emit = defineEmits(["done"]);

const captchaRef = ref(null);
const mode = ref(props.initialToken ? "reset" : "request");

const identifier = ref("");
const captchaToken = ref("");
const sending = ref(false);
const sentMessage = ref("");

const token = ref(props.initialToken);
const newPassword = ref("");
const confirmPassword = ref("");
const resetting = ref(false);
const passwordError = ref("");
const confirmError = ref("");

const captcha = computed(() => props.registration?.captcha || {});
const captchaEnabled = computed(() => Boolean(captcha.value.enabled));
const captchaBlocked = computed(
    () =>
        captchaEnabled.value &&
        (!captcha.value.ready || !captcha.value.widget),
);
const passwordMin = computed(
    () => Number(props.registration?.password_min_length) || 8,
);

function buildCaptchaEnvelope() {
    return captchaEnabled.value
        ? { response: String(captchaToken.value || "").trim() }
        : undefined;
}

async function sendResetMail() {
    const account = String(identifier.value || "").trim();
    if (!account) {
        ElMessage.warning("请填写邮箱或用户名。");
        return;
    }
    if (captchaEnabled.value && !captchaToken.value) {
        captchaRef.value?.reset();
        ElMessage.warning("请先完成人机验证。");
        return;
    }

    sending.value = true;
    try {
        const data = await apiForgotPassword({
            type: "email",
            identifier: account,
            captcha: buildCaptchaEnvelope(),
            dev_ticket: apiConfig.devTicket || "",
        });
        sentMessage.value =
            data?.message || "若该账号存在，我们已发送重置邮件。";
    } catch (error) {
        const { status, code, message, info } = readApiError(error);
        if (
            status === 403 ||
            String(info.reason_code || "").startsWith("CAPTCHA")
        ) {
            captchaRef.value?.reset();
            captchaToken.value = "";
            ElMessage.error(message || "人机验证未通过，请重新验证。");
            return;
        }
        if (status === 429) {
            ElMessage.error("发送过于频繁，请稍后再试。");
            return;
        }
        if (code === "E_VALIDATION") {
            ElMessage.error(message || "账号格式不正确。");
            return;
        }
        ElMessage.error(message || "发送失败，请稍后再试。");
    } finally {
        sending.value = false;
    }
}

// 用户可能整条链接粘进来：取 token 参数，取不到就原样当令牌用
function normalizeToken(value) {
    const raw = String(value || "").trim();
    if (!raw) return "";
    try {
        const url = new URL(raw);
        return (
            url.searchParams.get("token") ||
            url.searchParams.get("reset_token") ||
            raw
        );
    } catch {
        return raw;
    }
}

async function resetPassword() {
    passwordError.value = "";
    confirmError.value = "";

    const resolvedToken = normalizeToken(token.value);
    if (!resolvedToken) {
        ElMessage.warning("请填写邮件里的重置令牌。");
        return;
    }
    // 重置口令必填（注册时那种「留空 = 系统生成」在这里不适用）
    if (!String(newPassword.value || "").trim()) {
        passwordError.value = `密码不能为空，至少 ${passwordMin.value} 位`;
        return;
    }
    const check = validatePassword(newPassword.value, {
        min: passwordMin.value,
        max: Number(props.registration?.password_max_length) || 128,
    });
    if (!check.ok) {
        passwordError.value = check.message;
        return;
    }
    if (newPassword.value !== confirmPassword.value) {
        confirmError.value = "两次输入的密码不一致";
        return;
    }

    resetting.value = true;
    try {
        await apiResetPassword({
            token: resolvedToken,
            new_password: newPassword.value,
        });
        ElMessage.success("密码已重置，请用新密码登录。");
        emit("done");
    } catch (error) {
        const { status, code, message } = readApiError(error);
        if (status === 401) {
            ElMessage.error("重置令牌无效或已使用，请重新申请重置邮件。");
            return;
        }
        if (code === "E_VALIDATION") {
            passwordError.value = message || "新密码不符合要求。";
            return;
        }
        ElMessage.error(message || "重置失败，请稍后再试。");
    } finally {
        resetting.value = false;
    }
}

function onSubmit() {
    if (mode.value === "request") {
        sendResetMail();
    } else {
        resetPassword();
    }
}
</script>

<style scoped>
.block {
    width: 100%;
    margin-bottom: 12px;
}
.row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
}
</style>
