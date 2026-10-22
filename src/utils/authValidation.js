// 注册 / 找回密码用到的基础校验。
// 口径与玩家端（vue-mistarg2anns/src/views/RegisterView.vue）保持一致，
// 规则来自 api-5-username-management.md「用户名规则」与 api-3-registration.md。

// 用户名统一去首尾空白（服务端也会做 NFC 归一化与去空白）
export function normalizeUsername(value) {
    return String(value ?? "").trim();
}

// 用户名规则：1–32 个 Unicode 码点、字符白名单、禁止 @ / 路径分隔符 / 不可见字符 / emoji，
// 且不能占用玩家编号形态（M2 + 6 位数字）。
export function validateUsername(value) {
    const username = normalizeUsername(value);
    if (!username) return { ok: false, message: "用户名不能为空" };

    const length = [...username].length;
    if (length < 1 || length > 32) {
        return { ok: false, message: "用户名长度必须为 1–32 个字符" };
    }

    const allowed = /^[\p{L}\p{N}\p{Zs}_\-.+&'()[\]!#$%*=?^{|}~`]+$/u;
    if (!allowed.test(username)) {
        return { ok: false, message: "用户名包含非法字符" };
    }

    if (/[@/\\]|\p{C}|\p{So}/u.test(username)) {
        return { ok: false, message: "用户名包含禁止字符" };
    }

    if (/^M2\d{6}$/i.test(username)) {
        return { ok: false, message: "用户名不能使用玩家编号格式" };
    }

    return { ok: true, value: username };
}

// 邮箱：与后端内置正则同量级，真正的判定仍在服务端（还会查 MX）
export function validateEmail(value) {
    const email = String(value ?? "").trim();
    if (!email) return { ok: false, message: "邮箱不能为空" };
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return { ok: false, message: "邮箱格式不正确" };
    }
    return { ok: true, value: email };
}

// 口令可选：留空表示让系统下发初始密码并发邮件。
// 长度上下限由 reg/config 下发（当前 8 / 128），不要写死。
export function validatePassword(value, { min = 8, max = 128 } = {}) {
    const password = String(value ?? "");
    if (!password.trim()) return { ok: true, value: "" };
    if (password.length < min) {
        return { ok: false, message: `密码长度至少 ${min} 位` };
    }
    if (password.length > max) {
        return { ok: false, message: `密码长度最多 ${max} 位` };
    }
    return { ok: true, value: password };
}

// ApiError → 统一取用：detail 是响应里的 error 对象（{ code, message, detail }）
export function readApiError(error) {
    const body = error?.detail || {};
    return {
        status: Number(error?.status) || 0,
        code: body.code || "",
        message: body.message || error?.message || "",
        info: body.detail || {},
    };
}

// 400 E_VALIDATION 的 detail.fields：{ 字段名: 可直接展示的中文原因 }
export function readFieldErrors(error) {
    const { info } = readApiError(error);
    return info.fields && typeof info.fields === "object" ? info.fields : {};
}
