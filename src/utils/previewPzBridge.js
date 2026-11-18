// 预览用的只读桥（pz-bridge@0.2 的 preview 模式）。
//
// 管理端预览不下发 runtime，也没有玩家侧的取题门禁，所以拿不到 /puzzle/:key/state：
// 这里给出与玩家端同形的 pz 对象，但快照固定为空、rpc 直接 reject E_PREVIEW。
// 出题人写的组件因此可以「无桥降级」之外再走一条明确的只读分支。
//
// 玩家端真正的读写桥在 vue-mistarg2anns/src/utils/pzBridge.js：两个子项目独立构建，无法共享源码，
// 所以这里只复刻契约外壳与错误形状，不重复实现 CAS / 幂等 / 重试。

export const PZ_BRIDGE_CONTRACT = "pz-bridge@0.2";

// 与玩家端 createPzError 字段一致：组件按 code / reasonCode 分支，不匹配中文 message。
export function createPzError(fields = {}) {
    const error = new Error(fields.message || fields.code || "组件桥调用失败");
    error.name = "PzBridgeError";
    error.code = fields.code || "E_UNKNOWN";
    error.reasonCode = fields.reasonCode ?? null;
    error.status = Number(fields.status) || 0;
    error.retryable = Boolean(fields.retryable);
    error.retryAfterSec = Number(fields.retryAfterSec) > 0 ? Number(fields.retryAfterSec) : 0;
    error.latestRev = Number.isFinite(Number(fields.latestRev)) ? Number(fields.latestRev) : null;
    error.snapshotUpdated = Boolean(fields.snapshotUpdated);
    error.refreshFailed = Boolean(fields.refreshFailed);
    error.reqId = fields.reqId ?? null;
    return error;
}

export function isPzError(error) {
    return error?.name === "PzBridgeError";
}

// 跨边界只传纯数据：组件代码在管理端窗口里执行，但不能拿到宿主的响应式对象。
function toPlainData(value, fallback = null) {
    if (value === null || value === undefined) return fallback;
    try {
        return JSON.parse(JSON.stringify(value));
    } catch {
        return fallback;
    }
}

export function createPreviewPzBridge({ puzzleKey = "", view = null } = {}) {
    let disposed = false;
    let current = {
        rev: 0,
        state: {},
        view: toPlainData(view, null),
    };
    const subscribers = new Set();

    const staleError = () =>
        createPzError({ code: "E_STALE", message: "预览已关闭", retryable: false });

    const snapshot = () => ({ ...current, state: { ...current.state } });

    function onPatch(callback) {
        // 预览不产生写入，订阅只是为了保持契约形状
        if (typeof callback !== "function") return () => {};
        subscribers.add(callback);
        return () => {
            subscribers.delete(callback);
        };
    }

    function setView(next) {
        if (disposed) return;
        const plain = toPlainData(next, null);
        if (plain === null) return;
        current = { ...current, view: plain };
    }

    async function rpc() {
        if (disposed) throw staleError();
        throw createPzError({
            code: "E_PREVIEW",
            message: "预览模式下不能调用组件方法",
            retryable: false,
        });
    }

    async function refresh() {
        // 预览没有可同步的服务端状态：直接回当前快照，不发请求
        if (disposed) throw staleError();
        return snapshot();
    }

    function dispose() {
        if (disposed) return;
        disposed = true;
        subscribers.clear();
    }

    return {
        contract: PZ_BRIDGE_CONTRACT,
        puzzleKey,
        mode: "preview",
        caps: { read: false, write: false, refresh: true },
        get disposed() {
            return disposed;
        },
        snapshot,
        onPatch,
        rpc,
        refresh,
        setView,
        dispose,
    };
}

export default createPreviewPzBridge;
