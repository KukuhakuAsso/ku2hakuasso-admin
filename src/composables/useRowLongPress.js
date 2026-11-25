import { onBeforeUnmount, onMounted, ref } from "vue";

// 长按判定：480ms 内不动就成立；手指移动超过 10px 视为滚动 / 横滑，直接取消。
const LONG_PRESS_MS = 480;
const MOVE_TOLERANCE_PX = 10;
// 长按松手后浏览器还会补发一次 click（有的行点击是「进入详情」）：
// 这段时间内的 click 一律拦掉，避免面板背后又跳一次页面。
const CLICK_SUPPRESS_MS = 700;

/**
 * 手机端「长按整行」。
 *
 * 窄屏上操作列会把表格撑得很宽、要横向滚很久才能点到，所以干脆不渲染，
 * 改成在行上长按从底部弹出操作面板（动作与桌面端操作列同源）。
 *
 * 用法：把 el-table 的 ref 传进来，行对象从 activeRow 取；
 * 触屏监听由这里直接挂在表格根元素上（passive，不影响滚动），安卓的长按
 * contextmenu 由 @row-contextmenu 兜底。长按成立后松手浏览器补发的那次 click
 * 会被抑制，所以「点行 = 进入详情」的表格也可以安全地用长按出面板。
 *
 * 注意：靠「tr 序号 ↔ 数据序号」对应行。两张表都是平铺数据；真出现隐藏行 / 展开行
 * 导致行数对不上时宁可不响应，也不猜错处罚对象。
 */
export function useRowLongPress({ tableRef, getRows, isMobile, onLongPress }) {
    const activeRow = ref(null);
    let root = null;
    let timer = null;
    let startX = 0;
    let startY = 0;
    // 这一次触摸是否已经触发过长按：touchend 据此决定要不要掐掉合成 click
    let fired = false;
    let suppressClickUntil = 0;

    function clearTimer() {
        if (timer) {
            clearTimeout(timer);
            timer = null;
        }
    }

    function rowOfTarget(target) {
        const tr = target?.closest?.("tr");
        if (!root || !tr || !tr.classList.contains("el-table__row")) return null;
        const trs = Array.from(root.querySelectorAll("tr.el-table__row"));
        const rows = getRows() || [];
        const index = trs.indexOf(tr);
        if (index < 0 || trs.length !== rows.length) return null;
        return rows[index] || null;
    }

    function open(row) {
        if (!row) return;
        clearTimer();
        activeRow.value = row;
        fired = true;
        suppressClickUntil = Date.now() + CLICK_SUPPRESS_MS;
        // 支持的设备给一点触觉反馈；不支持就算了
        navigator.vibrate?.(12);
        onLongPress?.(row);
    }

    function onTouchStart(event) {
        clearTimer();
        fired = false;
        if (!isMobile.value || event.touches.length !== 1) return;
        const row = rowOfTarget(event.target);
        if (!row) return;
        startX = event.touches[0].clientX;
        startY = event.touches[0].clientY;
        timer = setTimeout(() => open(row), LONG_PRESS_MS);
    }

    function onTouchMove(event) {
        if (!timer) return;
        const touch = event.touches[0];
        if (!touch) {
            clearTimer();
            return;
        }
        if (
            Math.abs(touch.clientX - startX) > MOVE_TOLERANCE_PX ||
            Math.abs(touch.clientY - startY) > MOVE_TOLERANCE_PX
        ) {
            clearTimer();
        }
    }

    function onTouchEnd(event) {
        clearTimer();
        if (!fired) return;
        fired = false;
        // 触屏在长按松手后仍会派发 click：这里先掐一次（多数浏览器就此不再补发）
        event.preventDefault?.();
    }

    // 兜底：仍有浏览器补发了 click（或经过 el-table 的合成点击），在捕获阶段拦掉，
    // 免得弹着面板的同时把「行点击 = 进入详情」也执行了。
    function onClickCapture(event) {
        if (Date.now() >= suppressClickUntil) return;
        suppressClickUntil = 0;
        event.stopPropagation();
        event.preventDefault();
    }

    // 安卓长按会派发 contextmenu：拦掉系统菜单，改用我们的面板
    function onContextMenu(row, column, event) {
        if (!isMobile.value) return;
        event?.preventDefault?.();
        open(row);
    }

    onMounted(() => {
        root = tableRef.value?.$el || null;
        if (!root) return;
        root.addEventListener("touchstart", onTouchStart, { passive: true });
        root.addEventListener("touchmove", onTouchMove, { passive: true });
        root.addEventListener("touchend", onTouchEnd);
        root.addEventListener("touchcancel", onTouchEnd);
        root.addEventListener("click", onClickCapture, true);
    });

    onBeforeUnmount(() => {
        clearTimer();
        if (!root) return;
        root.removeEventListener("touchstart", onTouchStart);
        root.removeEventListener("touchmove", onTouchMove);
        root.removeEventListener("touchend", onTouchEnd);
        root.removeEventListener("touchcancel", onTouchEnd);
        root.removeEventListener("click", onClickCapture, true);
        root = null;
    });

    return {
        activeRow,
        onContextMenu,
    };
}
