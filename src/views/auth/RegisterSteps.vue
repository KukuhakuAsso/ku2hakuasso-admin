<template>
    <el-form :model="form" label-position="top" @submit.prevent="onSubmit">
        <!-- 第一步：只有邮箱（验证码发到邮箱），用户名与口令在第二步提交 -->
        <template v-if="step === 'form'">
            <el-form-item label="邮箱" :error="fieldErrors.email">
                <el-input
                    v-model="form.email"
                    placeholder="用于收取验证码与初始密码"
                    autocomplete="email"
                />
            </el-form-item>

            <TurnstileCaptcha
                ref="captchaRef"
                :captcha="captcha"
                @update:token="captchaToken = $event"
            />

            <el-alert
                v-if="captchaBlocked"
                type="warning"
                :closable="false"
                show-icon
                title="注册暂不可用"
                description="人机验证未就绪，请联系工作人员。"
                class="block"
            />

            <el-button
                type="primary"
                native-type="submit"
                class="block"
                :loading="sending"
                :disabled="captchaBlocked"
            >
                发送验证码
            </el-button>

            <p class="tip">
                注册后账号为玩家身份，后台需要 staff 权限，请等待管理员授予后再登录。
            </p>
        </template>

        <!-- 第二步：验证码 + 用户名（+ 可选口令），用户名占用时可用同一张码重试 -->
        <template v-else>
            <el-alert
                type="info"
                :closable="false"
                show-icon
                :title="`验证码已发送到 ${sentEmail}`"
                :description="`${codeTtlMinutes} 分钟内有效，验证码为 ${codeLength} 位数字。`"
                class="block"
            />

            <el-form-item label="验证码" :error="fieldErrors.code">
                <el-input
                    v-model="form.code"
                    :maxlength="codeLength"
                    placeholder="邮件里的数字验证码"
                    autocomplete="one-time-code"
                />
            </el-form-item>

            <el-form-item label="用户名" :error="fieldErrors.username">
                <el-input
                    v-model="form.username"
                    placeholder="1–32 个字符，注册后可用它登录"
                    autocomplete="username"
                />
                <p
                    class="tip"
                    :class="{
                        'is-ok': usernameStatus === 'available',
                        'is-bad':
                            usernameStatus === 'taken' ||
                            usernameStatus === 'invalid',
                    }"
                >
                    {{ usernameHint }}
                </p>
            </el-form-item>

            <el-form-item label="密码（可留空）" :error="fieldErrors.password">
                <el-input
                    v-model="form.password"
                    type="password"
                    show-password
                    :placeholder="`至少 ${passwordMin} 位；留空则由系统生成初始密码并邮件发送`"
                    autocomplete="new-password"
                />
            </el-form-item>

            <el-form-item label="确认密码" :error="confirmError">
                <el-input
                    v-model="form.confirmPassword"
                    type="password"
                    show-password
                    placeholder="再输一次；密码留空时也留空"
                    autocomplete="new-password"
                />
            </el-form-item>

            <TurnstileCaptcha
                ref="captchaRef"
                :captcha="captcha"
                @update:token="captchaToken = $event"
            />

            <el-button
                type="primary"
                native-type="submit"
                class="block"
                :loading="verifying"
                :disabled="captchaBlocked"
            >
                完成注册
            </el-button>

            <div class="row">
                <el-button
                    text
                    type="primary"
                    :disabled="resending || cooldown > 0"
                    @click="resendCode"
                >
                    {{
                        cooldown > 0
                            ? `${cooldown} 秒后可重新发送`
                            : resending
                              ? "发送中..."
                              : "重新发送验证码"
                    }}
                </el-button>
                <el-button text @click="backToForm">改邮箱</el-button>
            </div>

            <p class="tip">
                用户名被占用时换一个名字、用同一张验证码重试即可，不必重新收码。
            </p>
        </template>
    </el-form>
</template>

<script setup>
import { computed, onBeforeUnmount, reactive, ref, watch } from "vue";
import { ElMessage } from "element-plus";
import TurnstileCaptcha from "@/components/TurnstileCaptcha.vue";
import {
    apiResendRegisterCode,
    apiSendRegisterCode,
    apiUsernameAvailable,
    apiVerifyRegistration,
} from "@/api/auth";
import { apiConfig } from "@/config/api";
import {
    normalizeUsername,
    readApiError,
    readFieldErrors,
    validateEmail,
    validatePassword,
    validateUsername,
} from "@/utils/authValidation";

// 注册两步式流程（复用玩家端同一套接口）：
//   第一步 邮箱 + 人机验证 → 发验证码；第二步 验证码 + 用户名（+ 可选口令）→ 建号并直接登录。
const props = defineProps({
    // reg/config 返回的 data（未取到前为 null）
    registration: { type: Object, default: null },
});
const emit = defineEmits(["registered"]);

const captchaRef = ref(null);

const step = ref("form");
const form = reactive({
    email: "",
    code: "",
    username: "",
    password: "",
    confirmPassword: "",
});
const fieldErrors = ref({});
const confirmError = ref("");
const captchaToken = ref("");

const sending = ref(false);
const verifying = ref(false);
const resending = ref(false);

const sentEmail = ref("");
const cooldown = ref(0);
let cooldownTimer = null;

const captcha = computed(() => props.registration?.captcha || {});
const captchaEnabled = computed(() => Boolean(captcha.value.enabled));
// ready=false 或缺少 widget：后端明确要求不要渲染，也不要提交
const captchaBlocked = computed(
    () =>
        captchaEnabled.value &&
        (!captcha.value.ready || !captcha.value.widget),
);
const codeLength = computed(() => Number(props.registration?.code_length) || 6);
const codeTtlMinutes = computed(
    () => Number(props.registration?.code_ttl_minutes) || 10,
);
const passwordMin = computed(
    () => Number(props.registration?.password_min_length) || 8,
);
const passwordMax = computed(
    () => Number(props.registration?.password_max_length) || 128,
);

// 用户名查重：本地规则即时反馈，规则通过后防抖查唯一性（最终判定仍在 reg/verify）
const usernameStatus = ref("idle");
const usernameMessage = ref("");
let checkTimer = null;

const usernameHint = computed(() => {
    if (usernameStatus.value === "checking") return "检查中，请稍候...";
    if (usernameStatus.value === "available") return "用户名可用";
    if (usernameStatus.value === "taken") return "用户名已被占用";
    if (usernameStatus.value === "invalid") return usernameMessage.value;
    return "大小写不敏感；不能含 @、路径分隔符、emoji 或不可见字符。";
});

watch(
    () => form.username,
    () => {
        window.clearTimeout(checkTimer);
        usernameStatus.value = "idle";
        const result = validateUsername(form.username);
        if (!normalizeUsername(form.username)) return;
        if (!result.ok) {
            usernameStatus.value = "invalid";
            usernameMessage.value = result.message;
            return;
        }
        usernameStatus.value = "checking";
        checkTimer = window.setTimeout(async () => {
            const name = result.value;
            try {
                const data = await apiUsernameAvailable(name);
                if (normalizeUsername(form.username) !== name) return;
                usernameStatus.value =
                    data?.status === "taken" ? "taken" : "available";
            } catch (error) {
                if (normalizeUsername(form.username) !== name) return;
                usernameStatus.value = "idle";
            }
        }, 450);
    },
);

// 第一步已用掉的邮箱被改动：退回第一步重新发码
watch(
    () => form.email,
    () => {
        if (step.value === "verify") {
            backToForm();
            ElMessage.info("邮箱已修改，请重新发送验证码。");
        }
    },
);

function clearCooldown() {
    if (cooldownTimer !== null) {
        window.clearInterval(cooldownTimer);
        cooldownTimer = null;
    }
    cooldown.value = 0;
}

function startCooldown(seconds) {
    clearCooldown();
    const total = Math.max(0, Math.floor(Number(seconds) || 0));
    if (!total) return;
    cooldown.value = total;
    cooldownTimer = window.setInterval(() => {
        cooldown.value -= 1;
        if (cooldown.value <= 0) clearCooldown();
    }, 1000);
}

function backToForm() {
    step.value = "form";
    form.code = "";
    sentEmail.value = "";
    fieldErrors.value = {};
    confirmError.value = "";
    clearCooldown();
}

// 发码 / 重发前确保手里有一份可用凭据：用掉了就先重建组件让用户重新验证
function ensureCaptchaToken() {
    if (!captchaEnabled.value) return true;
    if (captchaToken.value) return true;
    captchaRef.value?.reset();
    ElMessage.warning("请先完成人机验证。");
    return false;
}

function buildCodePayload(email) {
    return {
        email,
        captcha: captchaEnabled.value
            ? { response: String(captchaToken.value || "").trim() }
            : undefined,
        dev_ticket: apiConfig.devTicket || "",
    };
}

// 403 人机验证类失败：按 detail.reason_code 给提示（文案会变，只匹配 code）
function handleCaptchaFailure(info) {
    const reason = info?.reason_code || "";
    if (reason === "CAPTCHA_MISSING") {
        ElMessage.warning("请先完成人机验证。");
        return true;
    }
    if (reason === "CAPTCHA_INVALID" || reason === "CAPTCHA_HOST_MISMATCH") {
        captchaRef.value?.reset();
        ElMessage.error("人机验证未通过，请重新验证。");
        return true;
    }
    if (reason === "CAPTCHA_UNAVAILABLE") {
        ElMessage.error("人机验证服务暂时不可用，请稍后重试。");
        return true;
    }
    if (
        reason === "CAPTCHA_MISCONFIGURED" ||
        reason === "CAPTCHA_NOT_READY"
    ) {
        ElMessage.error("注册暂不可用，请联系工作人员。");
        return true;
    }
    if (reason === "CAPTCHA_TEST_TICKET_REQUIRED") {
        ElMessage.error("缺少测试放行凭证（dev_ticket），请联系开发。");
        return true;
    }
    return false;
}

async function sendCode() {
    const emailCheck = validateEmail(form.email);
    if (!emailCheck.ok) {
        fieldErrors.value = { email: emailCheck.message };
        return;
    }
    fieldErrors.value = {};

    if (!ensureCaptchaToken()) return;

    sending.value = true;
    try {
        const data = await apiSendRegisterCode(
            buildCodePayload(emailCheck.value),
        );
        sentEmail.value = data?.email || emailCheck.value;
        step.value = "verify";
        captchaRef.value?.markUsed();
        captchaToken.value = "";
        startCooldown(props.registration?.resend_cooldown_sec ?? 60);
        ElMessage.success("验证码已发送，请查收邮箱。");
    } catch (error) {
        const { status, code, message, info } = readApiError(error);

        // 该邮箱还有一张未消费的验证码：直接进第二步，重发走 3.3
        if (status === 429 && info.reason_code === "REG_VERIFY_PENDING") {
            sentEmail.value = emailCheck.value;
            step.value = "verify";
            captchaRef.value?.markUsed();
            captchaToken.value = "";
            startCooldown(info.resend_after_sec ?? 0);
            ElMessage.info("该邮箱已发过验证码，可直接填写；没收到可点重新发送。");
            return;
        }

        if (status === 409) {
            ElMessage.error("该邮箱已经注册过了，请直接登录或找回密码。");
            return;
        }

        if (status === 403 && handleCaptchaFailure(info)) return;

        if (code === "E_VALIDATION") {
            const fields = readFieldErrors(error);
            fieldErrors.value = fields;
            ElMessage.error(
                fields.email || message || "参数校验失败，请检查邮箱。",
            );
            return;
        }

        ElMessage.error(message || "验证码发送失败，请稍后再试。");
    } finally {
        sending.value = false;
    }
}

async function resendCode() {
    if (resending.value || cooldown.value > 0) return;
    if (!sentEmail.value) {
        backToForm();
        ElMessage.error("注册信息已失效，请重新发送验证码。");
        return;
    }
    if (!ensureCaptchaToken()) return;

    resending.value = true;
    try {
        await apiResendRegisterCode(buildCodePayload(sentEmail.value));
        captchaRef.value?.markUsed();
        captchaToken.value = "";
        startCooldown(props.registration?.resend_cooldown_sec ?? 60);
        ElMessage.success("已重新发送验证码，旧码立即失效。");
    } catch (error) {
        const { status, code, message, info } = readApiError(error);
        if (status === 403 && handleCaptchaFailure(info)) return;
        if (code === "E_VALIDATION") {
            fieldErrors.value = readFieldErrors(error);
            ElMessage.error(message || "参数校验失败，请检查邮箱。");
            return;
        }
        ElMessage.error(message || "重新发送失败，请稍后再试。");
    } finally {
        resending.value = false;
    }
}

async function submitVerify() {
    fieldErrors.value = {};
    confirmError.value = "";

    const emailCheck = validateEmail(sentEmail.value || form.email);
    const usernameCheck = validateUsername(form.username);
    const passwordCheck = validatePassword(form.password, {
        min: passwordMin.value,
        max: passwordMax.value,
    });
    const code = String(form.code || "").trim();

    const fields = {};
    if (!emailCheck.ok) fields.email = emailCheck.message;
    if (!code) {
        fields.code = "请填写验证码";
    } else if (!new RegExp(`^\\d{${codeLength.value}}$`).test(code)) {
        fields.code = `应为 ${codeLength.value} 位数字`;
    }
    if (!usernameCheck.ok) fields.username = usernameCheck.message;
    if (!passwordCheck.ok) fields.password = passwordCheck.message;
    if (Object.keys(fields).length) {
        fieldErrors.value = fields;
        return;
    }

    if (form.password && form.password !== form.confirmPassword) {
        confirmError.value = "两次输入的密码不一致";
        return;
    }

    verifying.value = true;
    try {
        const data = await apiVerifyRegistration({
            email: emailCheck.value,
            code,
            username: usernameCheck.value,
            // 口令可选：留空 = 由系统生成初始密码并发邮件
            ...(form.password ? { password: form.password } : {}),
        });
        emit("registered", data || {});
    } catch (error) {
        const { status, code: errorCode, message, info } = readApiError(error);

        // 用户名被占用：验证码不会被消费，改名后可用同一张码重试
        if (status === 409) {
            fieldErrors.value = {
                username: info.username ? "用户名已被占用" : "",
            };
            ElMessage.error(
                "该用户名已被占用，请换一个名字重试（无需重新收码）。",
            );
            return;
        }

        if (errorCode === "E_CODE" || info.attempts_left !== undefined) {
            const attemptsLeft = info.attempts_left;
            fieldErrors.value = {
                code:
                    attemptsLeft === undefined
                        ? "验证码无效或已过期"
                        : `验证码错误，还剩 ${attemptsLeft} 次机会`,
            };
            if (attemptsLeft === 0) {
                ElMessage.error("验证码尝试次数已用尽，请重新发送验证码。");
            }
            return;
        }

        if (errorCode === "E_VALIDATION") {
            fieldErrors.value = readFieldErrors(error);
            ElMessage.error(message || "参数校验失败，请检查填写内容。");
            return;
        }

        ElMessage.error(message || "注册失败，请稍后再试。");
    } finally {
        verifying.value = false;
    }
}

function onSubmit() {
    if (step.value === "form") {
        sendCode();
    } else {
        submitVerify();
    }
}

onBeforeUnmount(() => {
    clearCooldown();
    window.clearTimeout(checkTimer);
});
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
.tip {
    margin: 6px 0 0;
    color: #8a94a6;
    font-size: 12px;
    line-height: 1.6;
}
.tip.is-ok {
    color: #2f9e44;
}
.tip.is-bad {
    color: #e03131;
}
</style>
