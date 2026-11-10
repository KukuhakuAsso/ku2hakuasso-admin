// 可塑区组件的加载器：fetch → sha384 校验 → Blob → import() → customElements.whenDefined。
//
// 关键约束（api-12）：
//   * 顺序不可换，校验不通过必须中止，绝不执行未通过校验的代码；
//   * 组件包内联了自己的 Vue 运行时，跨边界只传纯数据（props）；
//   * 同一 tag 已注册就不再下载。
//
// 与玩家端 useMalleableWidget 同口径，区别只在路径：管理端预览下发的是
// /api/admin/pz/puzzle/:key/asset/:name/:version，由 fetchResource 统一换前缀并带鉴权。
import { ref } from "vue";
import { fetchResource } from "@/api/http";
import { extractErrorMessage } from "@/api/errors";
import { verifySha384 } from "@/utils/integrity";

// 已注册的组件 tag（进程级，跨弹窗复用）
const registered = new Set();
// 正在下载中的 tag → Promise，避免同一组件并发下载多份
const pending = new Map();

function waitForDefinition(tag, timeoutMs = 10000) {
    if (typeof customElements === "undefined") return Promise.resolve();
    return Promise.race([
        customElements.whenDefined(tag),
        new Promise((_, reject) => {
            setTimeout(() => reject(new Error(`组件未注册 <${tag}>`)), timeoutMs);
        }),
    ]);
}

async function loadAsset(asset) {
    const tag = asset?.tag;
    const url = asset?.url;
    if (!tag || !url) throw new Error("组件描述符不完整");

    if (registered.has(tag)) return tag;
    if (pending.has(tag)) return pending.get(tag);

    const task = (async () => {
        const response = await fetchResource(url, {
            accept: "text/javascript",
        });
        const code = await response.text();

        // 完整性校验是硬门槛：缺 integrity / 形态不对一律拒绝
        if (!(await verifySha384(code, asset.integrity))) {
            throw new Error("组件完整性校验未通过，已阻止执行");
        }

        const blobUrl = URL.createObjectURL(
            new Blob([code], { type: "text/javascript" }),
        );
        try {
            await import(/* @vite-ignore */ blobUrl);
        } finally {
            URL.revokeObjectURL(blobUrl);
        }

        await waitForDefinition(tag);
        registered.add(tag);
        return tag;
    })();

    pending.set(tag, task);
    try {
        return await task;
    } finally {
        pending.delete(tag);
    }
}

export function useMalleableWidget() {
    const status = ref("idle"); // idle | loading | ready | error
    const error = ref("");
    const tag = ref("");
    let token = 0;

    async function ensure(asset) {
        // 描述符失效（切题 / 组件被停用）：先作废在飞的加载（cancel() 推进 token），
        // 否则它回来时 current === token 仍成立，会把**旧组件**挂到本应显示 fallback 的区域内
        if (!asset?.tag || !asset?.url) {
            cancel();
            tag.value = "";
            status.value = "error";
            error.value = "该组件当前不可用（未登记或已停用）";
            return;
        }
        if (tag.value === asset.tag && status.value === "ready") return;

        const current = ++token;
        status.value = "loading";
        error.value = "";

        try {
            const resolved = await loadAsset(asset);
            if (current !== token) return;
            tag.value = resolved;
            status.value = "ready";
        } catch (err) {
            if (current !== token) return;
            tag.value = "";
            error.value = extractErrorMessage(err, "组件加载失败");
            status.value = "error";
        }
    }

    function cancel() {
        token += 1;
    }

    return { status, error, tag, ensure, cancel };
}

export default useMalleableWidget;
