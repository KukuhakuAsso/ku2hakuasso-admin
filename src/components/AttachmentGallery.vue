<script setup>
// 已提交附件的只读展示（管理端）。
//
// 服务端给的 `url` 是受保护路径 `/api/msg/media/<id>`：`<img src>` 直接写会 401，
// 必须带令牌 fetch → blob → objectURL。管理端不发图（官方不发图，见接口约定），
// 只负责在邮件详情 / 求提示工作台 / 申诉工作台把玩家上传的截图显示出来。
import { onBeforeUnmount, ref, watch } from "vue";
import { ElImageViewer } from "element-plus";
import { fetchMediaBlob } from "@/api/http";

const props = defineProps({
  // 服务端形状：[{ id, fileName, mimeType, size, url }]
  items: { type: Array, default: () => [] },
  // 尺寸：thumb = 邮件详情里的小缩略图，large = 求提示 / 申诉展开区
  size: { type: String, default: "thumb" },
});

const entries = ref([]);
const preview = ref(null);
const byKey = new Map();

function keyOf(item) {
  return String(item?.id ?? item?.url ?? item?.fileName ?? "");
}

function revoke(entry) {
  if (entry?.blobUrl) {
    URL.revokeObjectURL(entry.blobUrl);
    entry.blobUrl = "";
  }
}

async function loadInto(entry, rawUrl) {
  if (!rawUrl) {
    entry.loading = false;
    entry.error = "缺少图片地址";
    return;
  }
  try {
    const blob = await fetchMediaBlob(rawUrl);
    if (!entries.value.includes(entry)) return; // 期间被移除，别泄漏 URL
    entry.blobUrl = URL.createObjectURL(blob);
    entry.error = "";
  } catch (error) {
    entry.error = error?.message || "图片加载失败";
  } finally {
    entry.loading = false;
  }
}

function sync(list) {
  const source = Array.isArray(list) ? list.filter(Boolean) : [];
  const keys = source.map(keyOf);

  for (const [key, entry] of byKey) {
    if (!keys.includes(key)) {
      revoke(entry);
      byKey.delete(key);
    }
  }

  const next = [];
  for (const item of source) {
    const key = keyOf(item);
    let entry = byKey.get(key);
    if (!entry) {
      entries.value.push({
        key,
        fileName: item.fileName || "图片",
        size: Number(item.size) || 0,
        blobUrl: "",
        loading: true,
        error: "",
      });
      entry = entries.value[entries.value.length - 1];
      byKey.set(key, entry);
      void loadInto(entry, item.url);
    }
    next.push(entry);
  }
  entries.value = next;
  if (preview.value && !next.includes(preview.value)) preview.value = null;
}

watch(() => props.items, sync, { immediate: true, deep: true });

onBeforeUnmount(() => {
  for (const entry of byKey.values()) revoke(entry);
  byKey.clear();
  entries.value = [];
});

function formatSize(bytes) {
  const value = Number(bytes) || 0;
  if (!value) return "";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}
</script>

<template>
  <div v-if="entries.length" class="attachments" :class="`attachments--${size}`">
    <p class="attachments__label">附件（{{ entries.length }}）</p>
    <ul class="attachments__list">
      <li v-for="entry in entries" :key="entry.key" class="attachments__item">
        <button
          v-if="entry.blobUrl"
          class="attachments__thumb"
          type="button"
          :title="`${entry.fileName}（点击查看大图）`"
          @click="preview = entry"
        >
          <img :src="entry.blobUrl" :alt="entry.fileName" />
        </button>
        <div v-else class="attachments__thumb is-pending">
          <span>{{ entry.loading ? "加载中…" : entry.error }}</span>
        </div>
        <div class="attachments__meta">
          <span class="attachments__name" :title="entry.fileName">{{
            entry.fileName
          }}</span>
          <span v-if="entry.size" class="attachments__size">{{
            formatSize(entry.size)
          }}</span>
        </div>
      </li>
    </ul>

    <el-image-viewer
      v-if="preview"
      :url-list="[preview.blobUrl]"
      :initial-index="0"
      :teleported="true"
      @close="preview = null"
    />
  </div>
</template>

<style scoped>
.attachments {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.attachments__label {
  margin: 0;
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.attachments__list {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.attachments__item {
  display: flex;
  flex-direction: column;
  gap: 2px;
  width: 112px;
}

.attachments__thumb {
  display: block;
  width: 112px;
  height: 78px;
  padding: 0;
  overflow: hidden;
  border: 1px solid var(--el-border-color);
  border-radius: 4px;
  background: var(--el-fill-color-light);
  cursor: zoom-in;
}

.attachments--large .attachments__item {
  width: 148px;
}

.attachments--large .attachments__thumb {
  width: 148px;
  height: 102px;
}

.attachments__thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.attachments__thumb.is-pending {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 4px;
  color: var(--el-text-color-secondary);
  font-size: 11px;
  line-height: 1.4;
  text-align: center;
  cursor: default;
}

.attachments__meta {
  display: flex;
  flex-direction: column;
  min-width: 0;
  font-size: 11px;
  color: var(--el-text-color-secondary);
}

.attachments__name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
