// 受保护素材 → 可直接放进 <img>/<audio>/<video> 的 blob URL。
//
// 管理端预览里的封面 / 描述内联图 / 附件都走 /api/admin/pz/media/:id，
// 需要 Authorization 头；原生标签发不出这个头，只能由 JS 取回二进制再转 blob。
//
// 缓存按后端下发的原始路径复用，引用计数归零时释放，避免同一素材重复下载或过早撤销。
// 与玩家端 useMediaObjectUrl 同口径，但这里只需要「取一次、用完释放」，不做失败聚合重试。
import { onBeforeUnmount, ref, watch } from "vue";
import { fetchResource } from "@/api/http";
import { extractErrorMessage } from "@/api/errors";

const cache = new Map();

// 取得一条素材记录（含引用计数）。调用方必须持有返回值并在卸载时 release。
export function acquireMedia(path) {
    const key = String(path ?? "").trim();
    let record = cache.get(key);

    if (!record) {
        record = { path: key, refs: 0, url: "", error: null };
        record.promise = fetchResource(key, { accept: "*/*" })
            .then((res) => res.blob())
            .then((blob) => {
                record.url = URL.createObjectURL(blob);
                return record.url;
            })
            .catch((err) => {
                record.error = err;
                throw err;
            });
        // 避免未消费时的 unhandled rejection；真正的错误由调用方 catch
        record.promise.catch(() => {});
        cache.set(key, record);
    }

    record.refs += 1;
    return record;
}

export function releaseMedia(record) {
    if (!record) return;
    record.refs -= 1;
    if (record.refs > 0) return;

    if (cache.get(record.path) === record) cache.delete(record.path);
    if (record.url) {
        URL.revokeObjectURL(record.url);
        record.url = "";
    }
}

// 单个素材路径 → { src, status, error, reload }
// getter 返回后端原始路径（可能为空 → status 保持 idle）。
export function useMediaObjectUrl(getter) {
    const src = ref("");
    const status = ref("idle"); // idle | loading | ready | error
    const error = ref("");

    let record = null;
    let token = 0;

    function drop() {
        releaseMedia(record);
        record = null;
        src.value = "";
    }

    function load() {
        drop();
        const path = String(getter() ?? "").trim();
        if (!path) {
            status.value = "idle";
            error.value = "";
            return;
        }

        const current = ++token;
        status.value = "loading";
        error.value = "";

        const next = acquireMedia(path);
        record = next;
        next.promise.then(
            (url) => {
                if (current !== token) return;
                src.value = url;
                status.value = "ready";
            },
            (err) => {
                if (current !== token) return;
                error.value = extractErrorMessage(err, "素材加载失败");
                status.value = "error";
            },
        );
    }

    watch(getter, load, { immediate: true });
    onBeforeUnmount(() => {
        token += 1;
        drop();
    });

    return { src, status, error, reload: load };
}

// Markdown 正文里的受保护图片：渲染器只输出 data-media-path 占位，
// 这里在 DOM 更新后用 blob URL 回填 src（与玩家端 useMarkdownMedia 同口径）。
const MEDIA_SELECTOR = "img[data-media-path]";

export function useMarkdownMedia(containerRef, htmlRef) {
    let records = [];
    let generation = 0;

    function releaseAll() {
        for (const record of records) releaseMedia(record);
        records = [];
    }

    function hydrate() {
        generation += 1;
        releaseAll();

        const root = containerRef.value;
        if (!root) return;
        const gen = generation;

        for (const node of root.querySelectorAll(MEDIA_SELECTOR)) {
            const path = String(node.getAttribute("data-media-path") || "").trim();
            if (!path) continue;

            const record = acquireMedia(path);
            records.push(record);
            record.promise.then(
                (url) => {
                    if (gen !== generation) return;
                    node.setAttribute("data-media-state", "ready");
                    node.setAttribute("src", url);
                },
                (err) => {
                    if (gen !== generation) return;
                    node.setAttribute("data-media-state", "error");
                    node.setAttribute(
                        "title",
                        extractErrorMessage(err, "图片加载失败"),
                    );
                },
            );
        }
    }

    watch([containerRef, htmlRef], hydrate, { flush: "post", immediate: true });

    onBeforeUnmount(() => {
        generation += 1;
        releaseAll();
    });

    return { hydrate };
}
