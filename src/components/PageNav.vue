<template>
  <div class="page-nav">
    <el-button size="small" :disabled="page <= 1 || loading" @click="$emit('prev')">
      上一页
    </el-button>
    <span class="page-info">第 {{ page }} 页</span>
    <el-button size="small" :disabled="!hasMore || loading" @click="$emit('next')">
      下一页
    </el-button>
  </div>
</template>

<script setup>
defineProps({
    page: { type: Number, default: 1 },
    hasMore: { type: Boolean, default: false },
    loading: { type: Boolean, default: false },
});
defineEmits(["prev", "next"]);
</script>

<style scoped>
.page-nav {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-top: 12px;
    justify-content: flex-end;
}
.page-info {
    color: var(--el-text-color-secondary);
    font-size: 13px;
}
</style>
