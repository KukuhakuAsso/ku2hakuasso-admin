<template>
  <div class="page-card">
    <el-card v-if="canPublish" shadow="never" class="publish">
      <template #header>发布官方公告</template>
      <el-input
        v-model="subject"
        maxlength="80"
        show-word-limit
        class="publish-subject"
        placeholder="公告主题（1–80 字，必填）"
      />
      <el-input
        v-model="content"
        type="textarea"
        :rows="4"
        maxlength="2000"
        show-word-limit
        placeholder="公告正文（1–2000 字），发布后写入全局系统频道，无撤回接口"
      />
      <div class="publish-actions">
        <span class="warn">⚠ 无撤回接口，请确认后再发布</span>
        <el-button
          type="primary"
          :loading="publishing"
          :disabled="!subject.trim() || !content.trim()"
          @click="publish"
        >
          发布公告
        </el-button>
      </div>
    </el-card>

    <el-alert
      v-else
      type="info"
      :closable="false"
      show-icon
      class="publish"
      title="当前账号没有 msg.announce.publish 权限，只能查看历史公告。"
    />

    <el-divider content-position="left">历史公告（倒序）</el-divider>

    <el-table v-loading="loading" :data="list" border stripe>
      <el-table-column prop="id" label="ID" width="90" />
      <el-table-column prop="subject" label="主题" min-width="200" />
      <el-table-column label="内容" min-width="360">
        <template #default="{ row }">{{ row.content }}</template>
      </el-table-column>
      <el-table-column prop="contentType" label="类型" width="100" />
      <el-table-column label="发布时间" width="180">
        <template #default="{ row }">{{ fmtTime(row.createdAt) }}</template>
      </el-table-column>
    </el-table>

    <PageNav :page="page" :has-more="hasMore" :loading="loading" @prev="prev" @next="next" />
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from "vue";
import { ElMessage } from "element-plus";
import { useAuthStore } from "@/stores/auth";
import { listAnnouncements, announce } from "@/api/msg";
import { useCursorPage } from "@/composables/useCursorPage";
import PageNav from "@/components/PageNav.vue";
import { fmtTime } from "@/utils/format";

const auth = useAuthStore();
const subject = ref("");
const content = ref("");
const publishing = ref(false);

// 发布需要 msg.announce.publish 权限（admin 由角色默认拥有）
const canPublish = computed(() => auth.can("msg.announce.publish"));

const fetcher = (cursor) => listAnnouncements({ cursor, limit: 50 });
const { list, page, hasMore, loading, first, next, prev } = useCursorPage(fetcher);

async function publish() {
    publishing.value = true;
    try {
        await announce({
            subject: subject.value.trim(),
            content: content.value.trim(),
        });
        ElMessage.success("公告已发布");
        subject.value = "";
        content.value = "";
        first();
    } catch (err) {
        ElMessage.error(err.message);
    } finally {
        publishing.value = false;
    }
}

onMounted(() => first());
</script>

<style scoped>
.publish {
    margin-bottom: 8px;
}
.publish-subject {
    margin-bottom: 10px;
}
.publish-actions {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 12px;
    margin-top: 12px;
}
.warn {
    color: #e6a23c;
    font-size: 12px;
}
</style>
