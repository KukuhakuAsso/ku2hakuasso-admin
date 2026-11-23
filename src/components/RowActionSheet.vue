<template>
  <teleport to="body">
    <transition name="row-sheet">
      <div v-if="modelValue" class="row-sheet-mask" @click="close">
        <div class="row-sheet" role="dialog" aria-modal="true" @click.stop>
          <div v-if="title" class="row-sheet-title">{{ title }}</div>
          <button
            v-for="action in actions"
            :key="action.key"
            type="button"
            class="row-sheet-action"
            :class="[`is-${action.type || 'default'}`, { 'is-disabled': action.disabled }]"
            :disabled="action.disabled"
            @click="select(action)"
          >
            <span>{{ action.label }}</span>
            <span v-if="action.hint" class="row-sheet-hint">
              {{ action.hint }}
            </span>
          </button>
          <button type="button" class="row-sheet-cancel" @click="close">取消</button>
        </div>
      </div>
    </transition>
  </teleport>
</template>

<script setup>
// 手机端的行操作面板：操作列在窄屏不渲染，长按行后从底部弹出这份动作清单。
// 动作与桌面端操作列同源（页面里的 rowActions(row)），只是换了呈现方式。
const props = defineProps({
    modelValue: { type: Boolean, default: false },
    title: { type: String, default: "" },
    actions: { type: Array, default: () => [] },
});

const emit = defineEmits(["update:modelValue", "select"]);

function close() {
    emit("update:modelValue", false);
}

function select(action) {
    if (action.disabled) return;
    emit("select", action.key);
    close();
}
</script>

<style scoped>
.row-sheet-mask {
    position: fixed;
    inset: 0;
    z-index: 1900;
    display: flex;
    align-items: flex-end;
    background: rgba(0, 0, 0, 0.45);
    /* 面板打开时别让手势穿透到背后的表格上滚动 */
    touch-action: none;
}

.row-sheet {
    width: 100%;
    max-height: 75vh;
    overflow-y: auto;
    padding: 12px 12px calc(12px + env(safe-area-inset-bottom));
    border-radius: 14px 14px 0 0;
    background: #fff;
    /* 面板自身可以上下滚，滚到底也不带动页面 */
    touch-action: pan-y;
    overscroll-behavior: contain;
    -webkit-overflow-scrolling: touch;
}

.row-sheet-title {
    padding: 4px 8px 10px;
    color: var(--el-text-color-secondary);
    font-size: 13px;
    text-align: center;
    word-break: break-all;
}

.row-sheet-action,
.row-sheet-cancel {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    width: 100%;
    padding: 14px 12px;
    border: 0;
    border-radius: 10px;
    background: transparent;
    color: var(--el-text-color-primary);
    font-family: inherit;
    font-size: 16px;
    line-height: 1.3;
    cursor: pointer;
}

.row-sheet-action + .row-sheet-action {
    margin-top: 2px;
}

.row-sheet-action:active {
    background: var(--el-fill-color-light);
}

.row-sheet-action.is-primary {
    color: var(--el-color-primary);
}

.row-sheet-action.is-info {
    color: var(--el-text-color-regular);
}

.row-sheet-action.is-warning {
    color: var(--el-color-warning);
}

.row-sheet-action.is-success {
    color: var(--el-color-success);
}

.row-sheet-action.is-danger {
    color: var(--el-color-danger);
}

.row-sheet-action.is-disabled {
    color: var(--el-text-color-disabled);
    cursor: not-allowed;
}

.row-sheet-hint {
    color: var(--el-text-color-secondary);
    font-size: 12px;
    text-align: center;
}

.row-sheet-cancel {
    margin-top: 8px;
    background: var(--el-fill-color-light);
}

.row-sheet-enter-active,
.row-sheet-leave-active {
    transition: opacity 0.2s ease;
}

.row-sheet-enter-active .row-sheet,
.row-sheet-leave-active .row-sheet {
    transition: transform 0.2s ease;
}

.row-sheet-enter-from,
.row-sheet-leave-to {
    opacity: 0;
}

.row-sheet-enter-from .row-sheet,
.row-sheet-leave-to .row-sheet {
    transform: translateY(100%);
}
</style>
