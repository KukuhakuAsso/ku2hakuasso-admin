// 后端错误体解析：统一把错误响应整理成一句可直接展示的文案。
//
// 后端错误体形如：
//   { ok: false, error: { code, message, detail: { fields: { email: "邮箱格式不正确", ... }, reason } } }
//
// 管理端请求层抛的是 ApiError（status / message / detail，detail 就是上面的 error 对象），
// 这里三种来源都兼容：抛出的 ApiError、原始响应体、扁平的 { code, detail }。
//
// 与玩家端 api/errors.js 保持同一套口径（两个子项目各自独立构建，无法共享源码）。

const DEFAULT_ERROR_MESSAGE = "请求失败，请稍后重试";

// 取第一个非空字符串（非字符串一律忽略）。
function firstNonEmpty(...candidates) {
    for (const candidate of candidates) {
        if (typeof candidate === "string" && candidate.trim()) {
            return candidate.trim();
        }
    }
    return "";
}

// 取出错误体：统一成 { error: { code, message, detail } } 的形状。
export function resolveErrorPayload(source) {
    if (source?.payload && typeof source.payload === "object") {
        return source.payload;
    }
    // ApiError：detail 就是响应体里的 error 对象
    if (source?.detail && typeof source.detail === "object") {
        return { error: source.detail };
    }
    return source && typeof source === "object" ? source : {};
}

// 取出 detail.fields 原始内容（对象，或整体说明字符串）。
function resolveErrorFields(source) {
    const payload = resolveErrorPayload(source);
    const detail = payload.error?.detail ?? payload.detail ?? {};
    return detail?.fields ?? null;
}

// 取指定字段的报错原因。一个响应里可能同时含多个字段的原因，需要落到某个输入框下方时
// 必须按字段名取值，否则会把别的字段的原因张冠李戴到该输入框。
export function extractFieldMessage(source, fieldName) {
    const fields = resolveErrorFields(source);
    if (!fields || typeof fields !== "object") {
        return "";
    }
    return firstNonEmpty(fields[fieldName]);
}

// 取出字段级报错明细：detail.fields 形如 { email: "邮箱格式不正确", username: "用户名不能为空" }，
// 同一个响应里可能同时含多个字段的原因，这里按出现顺序全部取出并去重。
export function extractFieldMessages(source) {
    const fields = resolveErrorFields(source);

    if (typeof fields === "string") {
        return firstNonEmpty(fields) ? [fields.trim()] : [];
    }
    if (!fields || typeof fields !== "object") {
        return [];
    }

    const messages = [];
    for (const value of Object.values(fields)) {
        const text = firstNonEmpty(value);
        if (text && !messages.includes(text)) {
            messages.push(text);
        }
    }
    return messages;
}

// 把错误整理成一句展示文案；source 可以是 ApiError，也可以是原始响应体。
export function extractErrorMessage(source, fallback = DEFAULT_ERROR_MESSAGE) {
    const payload = resolveErrorPayload(source);

    // 字段级原因优先：E_VALIDATION 的 error.message 通常只是笼统的「参数校验失败」，
    // 真正有用的原因在 detail.fields 里，多个字段的原因用分号连成一句。
    const fieldMessages = extractFieldMessages(payload);
    if (fieldMessages.length) {
        return fieldMessages.join("；");
    }

    const backendMessage = firstNonEmpty(
        payload.error?.message,
        payload.message,
        typeof payload.error === "string" ? payload.error : "",
        payload.error?.detail?.reason,
        payload.detail?.reason,
    );
    if (backendMessage) {
        return backendMessage;
    }

    // Error 自带的 message 可能只是请求层的通用兜底文案，此时优先用调用方给的文案。
    const ownMessage = firstNonEmpty(source?.message);
    if (ownMessage && ownMessage !== DEFAULT_ERROR_MESSAGE) {
        return ownMessage;
    }

    return firstNonEmpty(fallback, ownMessage) || DEFAULT_ERROR_MESSAGE;
}

// 页面级收口：403 换成调用方给的功能文案（后端那句「需要 admin 权限」对运营没意义），
// 其余情况走 extractErrorMessage，顺带拿到 detail.fields 里的字段级原因。
export function describeApiError(
    source,
    { fallback = DEFAULT_ERROR_MESSAGE, forbidden = "没有权限执行该操作" } = {},
) {
    if (source?.status === 403) return forbidden;
    return extractErrorMessage(source, fallback);
}
