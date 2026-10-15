<template>
  <div class="login-wrap">
    <el-card class="login-card">
      <div class="login-head">
        <h2>空白解谜组</h2>
        <p>管理后台登录</p>
      </div>
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
      </el-form>
    </el-card>
  </div>
</template>

<script setup>
import { reactive, ref } from "vue";
import { useRouter } from "vue-router";
import { ElMessage } from "element-plus";
import { useAuthStore } from "@/stores/auth";
import { ApiError } from "@/api/http";

const router = useRouter();
const auth = useAuthStore();

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

async function onSubmit() {
    await formRef.value.validate();
    loading.value = true;
    try {
        await auth.login({ ...form });
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
    width: 360px;
    padding: 8px 8px 16px;
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
</style>
