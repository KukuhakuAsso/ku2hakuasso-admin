// 题目主数据「后台刷新」时的取舍判定。
//
// 出题台会在保存主数据后静默重取一次列表（authorUsername / answer 只有列表接口才给），
// 期间用户可能已经切到另一道题并改了一半。列表行一旦更换对象，PuzzleMetaForm 的
// watch(props.row) 就会被触发 —— 这一层负责判断这次「换行」到底意味着什么：
//
//   apply  换题 / 表单与远端已经一致 / 本地根本没改过  → 直接回填
//   rebase 只有服务端变过、本地草稿没动               → 不动草稿，只推进基准
//   merge  两边都改过                                 → 交给三方合并弹窗
//
// 判定只用「字段快照」比较，不关心字段语义，因此可以脱离组件单测。

export const META_ROW_ACTION = {
    APPLY: "apply",
    REBASE: "rebase",
    MERGE: "merge",
};

// 把 undefined / 缺键统一成 null，并按键名排序：两边的快照可能来自不同构造路径
// （表单对象 vs 列表行经 toForm 归一），形状一致才算「相同」。
function normalize(value) {
    if (value == null) return null;
    if (Array.isArray(value)) return value.map(normalize);
    if (typeof value === "object") {
        const out = {};
        for (const key of Object.keys(value).sort()) out[key] = normalize(value[key]);
        return out;
    }
    return value;
}

export function sameSnapshot(a, b) {
    return JSON.stringify(normalize(a)) === JSON.stringify(normalize(b));
}

/**
 * @param {object} input
 * @param {string} input.appliedKey 上一次回填的题目 key（空串表示还没回填过）
 * @param {string} input.rowKey     新行的 key
 * @param {object|null} input.local   当前表单的字段快照
 * @param {object|null} input.remote  新行的字段快照
 * @param {object|null} input.baseline 上次对齐的服务端字段快照
 * @returns {"apply"|"rebase"|"merge"}
 */
export function decideMetaRow({ appliedKey, rowKey, local, remote, baseline }) {
    if (!rowKey) return META_ROW_ACTION.APPLY;
    // 换了一题：直接把表单切过去
    if (rowKey !== appliedKey) return META_ROW_ACTION.APPLY;
    // 表单里已经是服务端这份内容（可能只是 rev 变了）
    if (sameSnapshot(local, remote)) return META_ROW_ACTION.APPLY;
    // 本地没动过：跟随服务端
    if (sameSnapshot(local, baseline)) return META_ROW_ACTION.APPLY;
    // 服务端没动过：本地草稿优先，只把基准推进到这份内容，避免下次误判成冲突
    if (sameSnapshot(remote, baseline)) return META_ROW_ACTION.REBASE;
    // 两边都改了
    return META_ROW_ACTION.MERGE;
}

export default decideMetaRow;
