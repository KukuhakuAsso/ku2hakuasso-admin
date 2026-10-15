import { ref } from "vue";

// 游标分页组合式函数（后端返回 nextCursor / hasMore）
// fetcher(cursor) => Promise<{ [listKey]: [], nextCursor, hasMore }>
export function useCursorPage(fetcher, { listKey = "items" } = {}) {
    const list = ref([]);
    const nextCursor = ref(null);
    const hasMore = ref(false);
    const loading = ref(false);
    const cursorStack = ref([]);
    const page = ref(1);

    async function load(cursor) {
        loading.value = true;
        try {
            const data = await fetcher(cursor);
            list.value = data?.[listKey] ?? [];
            nextCursor.value = data?.nextCursor ?? null;
            hasMore.value = !!data?.hasMore;
            return list.value;
        } finally {
            loading.value = false;
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
