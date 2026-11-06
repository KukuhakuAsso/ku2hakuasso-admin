// 把接口错误转成运营看得懂的提示。
// 403 的原始 message 是开发向的（如「需要 admin 权限」），各页面按自己的功能给出更具体的文案。
export function describeApiError(
    error,
    { fallback = "请求失败，请稍后重试", forbidden = "没有权限执行该操作" } = {},
) {
    if (error?.status === 403) return forbidden;
    return error?.message || fallback;
}

export default describeApiError;
