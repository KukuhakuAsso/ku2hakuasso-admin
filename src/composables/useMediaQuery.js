import { onBeforeUnmount, ref } from "vue";

// 手机端断点：样式里的 @media 与逻辑判断都认这一个值，
// 免得样式换了一处、模板里的 v-if 还停在旧断点。
export const MOBILE_QUERY = "(max-width: 768px)";

export function useMediaQuery(query) {
    const mediaQueryList =
        typeof window !== "undefined" && typeof window.matchMedia === "function"
            ? window.matchMedia(query)
            : null;
    const matches = ref(Boolean(mediaQueryList?.matches));

    function onChange(event) {
        matches.value = event.matches;
    }

    if (mediaQueryList) {
        // Safari 14 以前只有 addListener
        if (mediaQueryList.addEventListener) {
            mediaQueryList.addEventListener("change", onChange);
        } else {
            mediaQueryList.addListener?.(onChange);
        }
    }

    onBeforeUnmount(() => {
        if (!mediaQueryList) return;
        if (mediaQueryList.removeEventListener) {
            mediaQueryList.removeEventListener("change", onChange);
        } else {
            mediaQueryList.removeListener?.(onChange);
        }
    });

    return matches;
}

export function useIsMobile() {
    return useMediaQuery(MOBILE_QUERY);
}
