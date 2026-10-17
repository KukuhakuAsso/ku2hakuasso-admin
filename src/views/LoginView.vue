<template>
    <div class="login-wrap">
        <el-card class="login-card">
            <div class="login-head">
                <h2>空白解谜组</h2>
                <p>管理后台</p>
            </div>

            <el-tabs v-model="mode" class="login-tabs">
                <el-tab-pane label="登录" name="login">
                    <el-form
                        ref="formRef"
                        :model="form"
                        :rules="rules"
                        label-position="top"
                        @submit.prevent="onSubmit"
                    >
                        <el-form-item label="登录方式" prop="type">
                            <el-select v-model="form.type" style="width: 100%">
                                <el-option label="用户名" value="username" />
                                <el-option label="邮箱" value="email" />
                                <el-option label="玩家编号" value="player_no" />
                            </el-select>
                        </el-form-item>
                        <el-form-item label="账号" prop="identifier">
                            <el-input
                                v-model="form.identifier"
                                placeholder="请输入账号"
                                autocomplete="username"
                            />
                        </el-form-item>
                        <el-form-item label="密码" prop="password">
                            <el-input
                                v-model="form.password"
                                type="password"
                                show-password
                                placeholder="请输入密码"
                                autocomplete="current-password"
                            />
                        </el-form-item>
                        <el-button
                            type="primary"
                            native-type="submit"
                            class="submit"
                            :loading="loading"
                        >
                            登录
                        </el-button>
                        <div class="links">
                            <el-button text type="primary" @click="openForgot">
                                忘记密码
                            </el-button>
                            <el-button text @click="mode = 'register'">
                                注册账号
                            </el-button>
                        </div>
                    </el-form>
                </el-tab-pane>

                <el-tab-pane label="注册" name="register">
                    <p v-if="registrationError" class="config-tip">
                        注册配置加载失败（{{ registrationError }}），可稍后重试。
                    </p>
                    <RegisterSteps
                        :registration="registration"
                        @registered="onRegistered"
                    />
                </el-tab-pane>
            </el-tabs>
        </el-card>

        <el-dialog
            v-model="forgotOpen"
            title="找回密码"
            width="420px"
            @closed="onForgotClosed"
        >
            <ResetPasswordPanel
                :registration="registration"
                :initial-token="resetToken"
                @done="onPasswordReset"
            />
        </el-dialog>
    </div>
</template>

<script setup>
import { onMounted, reactive, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ElMessage, ElMessageBox } from "element-plus";
import { useAuthStore } from "@/stores/auth";
import { ApiError } from "@/api/http";
import { apiRegistrationConfig } from "@/api/auth";
import RegisterSteps from "@/views/auth/RegisterSteps.vue";
import ResetPasswordPanel from "@/views/auth/ResetPasswordPanel.vue";

const router = useRouter();
const route = useRoute();
const auth = useAuthStore();

// 登录 / 注册同屏切换；找回密码走弹窗（注册与找回都复用玩家端那套公开接口）
const mode = ref("login");

const formRef = ref();
const loading = ref(false);
const form = reactive({
    type: "username",
    identifier: "",
    password: "",
});

const rules = {
    type: [{ required: true, message: "请选择登录方式", trigger: "change" }],
    identifier: [{ required: true, message: "请输入账号", trigger: "blur" }],
    password: [{ required: true, message: "请输入密码", trigger: "blur" }],
};

// reg/config：人机验证配置 + 验证码 / 口令长度等，注册与找回共用一份
const registration = ref(null);
const registrationError = ref("");

// 找回密码弹窗
const forgotOpen = ref(false);
const resetToken = ref("");

const staffRoles = ["staff", "admin"];

onMounted(async () => {
    // 重置邮件里的链接可能带 ?token= 直接进来
    const token = String(route.query.reset_token || route.query.token || "");
    if (token) {
        resetToken.value = token;
        forgotOpen.value = true;
        // 清掉查询串，避免刷新后重复进入
        router.replace({ path: route.path, query: {} });
    }

    try {
        const data = await apiRegistrationConfig();
        registration.value = data || null;
    } catch (err) {
        registrationError.value =
            err instanceof ApiError ? err.message : "网络异常";
    }
});

async function onSubmit() {
    await formRef.value.validate();
    loading.value = true;
    try {
        await auth.login({ ...form });
        // 玩家账号能登录成功，但后台接口一律要求 staff/admin：这里就挡掉，
        // 不留下一个进不去任何页面的会话
        if (!auth.isStaff) {
            auth.reset();
            ElMessage.error("该账号没有后台权限（当前角色为玩家）。");
            return;
        }
        ElMessage.success("登录成功");
        router.replace("/dashboard");
    } catch (err) {
        if (err instanceof ApiError) {
            ElMessage.error(err.message);
        } else {
            ElMessage.error("登录失败，请稍后重试");
        }
    } finally {
        loading.value = false;
    }
}

// 注册成功：staff/admin 直接进后台；player 一律留在登录页等授权
function onRegistered(data) {
    const account = data?.account || null;
    const role = account?.role || "player";
    const username = account?.username || "";

    if (staffRoles.includes(role)) {
        auth.adoptSession({
            access_token: data?.access_token || "",
            account,
        });
        ElMessage.success("注册成功，已登录。");
        router.replace("/dashboard");
        return;
    }

    // 建出来的是玩家账号：后台拿不到任何数据，因此不保留这次会话
    form.type = "username";
    form.identifier = username;
    form.password = "";
    mode.value = "login";

    const mailed = data?.initial_password_mailed;
    ElMessage({
        type: "info",
        duration: 8000,
        showClose: true,
        message:
            `注册成功：${username || "账号已创建"}。该账号当前是玩家身份，` +
            "后台需要 staff 权限，请联系管理员升级后再登录。" +
            (mailed ? "初始密码已发送到注册邮箱。" : ""),
    });

    // 口令没投递出去时后端会回传明文：必须让用户当场保存（仅此一次展示）
    const plain = data?.initial_password || "";
    if (plain) {
        ElMessageBox.alert(
            `初始密码：${plain}（邮件未投递成功，仅此一次展示，请立即保存并尽快修改）`,
            "请立即保存初始密码",
            { confirmButtonText: "我已保存", type: "warning" },
        ).catch(() => {});
    }
}

function openForgot() {
    resetToken.value = "";
    forgotOpen.value = true;
}

function onForgotClosed() {
    resetToken.value = "";
}

function onPasswordReset() {
    forgotOpen.value = false;
    mode.value = "login";
    form.password = "";
}
</script>

<style scoped>
.login-wrap {
    height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    background: linear-gradient(135deg, #001529 0%, #0a2540 100%);
}
.login-card {
    width: 400px;
    padding: 8px 8px 16px;
    max-height: 92vh;
    overflow-y: auto;
}
.login-head {
    text-align: center;
    margin-bottom: 20px;
}
.login-head h2 {
    color: #1f2d3d;
}
.login-head p {
    color: #8a94a6;
    font-size: 13px;
    margin-top: 4px;
}
.submit {
    width: 100%;
}
.links {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-top: 8px;
}
.config-tip {
    margin: 0 0 12px;
    color: #e03131;
    font-size: 12px;
    line-height: 1.6;
}
</style>
