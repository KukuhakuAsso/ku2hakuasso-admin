import { getCurrentScope, onScopeDispose, ref } from "vue";
import { cancelChannel, isStaleRequest, requestLatest } from "@/api/http";

// 每个实例一个频道名：同一个页面里可能有多个列表（例如队伍进度 + 提交历史），
// 它们各自「最新一次生效」，互不干扰。
let pageSeed = 0;

// 游标分页组合式函数（后端返回 nextCursor / hasMore）
// fetcher(cursor, { signal }) => Promise<{ [listKey]: [], nextCursor, hasMore }>
//
// 代际守卫（旧响应覆盖新结果的一类）：
//   · 同一实例的请求走 requestLatest(abortKey, …)：新的一发就把旧的 abort，
//     并在响应回来时再比一次「我还是不是最新的一次」；
//   · 被取代的那次按 stale 处理（不是错误），这里静默返回当前列表，
//     调用方的 `.catch(toast)` 不会因为一次取消就弹提示；
//   · loading 只由最新一次关掉，否则旧请求收尾会把新请求的转圈关掉。
// fetcher 的第二个参数是可选的：现有 fetcher 忽略它也不影响正确性，
// 想顺便省掉往返的可以把 signal 透给 get(path, params, { signal })。
export function useCursorPage(fetcher, { listKey = "items", channel } = {}) {
    const list = ref([]);
    const nextCursor = ref(null);
    const hasMore = ref(false);
    const loading = ref(false);
    const cursorStack = ref([]);
    const page = ref(1);

    const abortKey = channel || `cursor-page#${++pageSeed}`;

    // 组件卸载后没人再读这些响应：中断掉，别让它们继续占连接
    if (getCurrentScope()) {
        onScopeDispose(() => cancelChannel(abortKey));
    }

    // loading 不需要自己再记一个序号：requestLatest 已经保证只有最新一次能走到下面两条成功路径，
    // 被取代的那次一律以 stale 结束、直接返回，不碰 loading（否则它的收尾会把最新一次还在转的圈关掉）。
    async function load(cursor) {
        loading.value = true;
        try {
            const data = await requestLatest(abortKey, ({ signal }) =>
                fetcher(cursor, { signal }),
            );
            list.value = data?.[listKey] ?? [];
            nextCursor.value = data?.nextCursor ?? null;
            hasMore.value = !!data?.hasMore;
            loading.value = false;
            return list.value;
        } catch (error) {
            // 被更新的一次取代：保留它已经写好的状态，loading 留给那一次收尾
            if (isStaleRequest(error)) return list.value;
            loading.value = false;
            throw error;
        }
    }

    async function first() {
        cursorStack.value = [];
        page.value = 1;
        return load(0);
    }

    async function next() {
        if (!hasMore.value || loading.value) return;
        cursorStack.value.push(nextCursor.value);
        page.value += 1;
        return load(nextCursor.value);
    }

    async function prev() {
        if (!cursorStack.value.length || loading.value) return;
        cursorStack.value.pop();
        page.value = Math.max(1, page.value - 1);
        const cursor = cursorStack.value.length
            ? cursorStack.value[cursorStack.value.length - 1]
            : 0;
        return load(cursor);
    }

    return { list, nextCursor, hasMore, loading, page, first, next, prev };
}
