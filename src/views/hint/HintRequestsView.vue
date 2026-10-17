<template>
  <div class="page-card">
    <div class="filter-bar">
      <el-select v-model="filters.status" style="width: 160px" @change="search">
        <el-option v-for="item in STATUS_OPTIONS" :key="item.value" :label="item.label" :value="item.value" />
      </el-select>
      <el-button type="primary" @click="search">查询</el-button>
      <el-button @click="reset">重置</el-button>
      <span class="tip">
        默认只列待报价；报价即受理并释放该队的一个待报价名额；答复在玩家确认扣费后才送达。
      </span>
    </div>

    <el-table v-loading="loading" :data="list" border stripe>
      <el-table-column prop="id" label="ID" width="70" />
      <el-table-column label="队伍" min-width="130">
        <template #default="{ row }">{{ row.teamName || "—" }}（#{{ row.teamId }}）</template>
      </el-table-column>
      <el-table-column label="发起人" min-width="130">
        <template #default="{ row }">{{ row.username || "—" }}（{{ row.playerNo || "—" }}）</template>
      </el-table-column>
      <el-table-column label="问题" min-width="240">
        <template #default="{ row }">
          <span class="question">{{ row.question || "—" }}</span>
        </template>
      </el-table-column>
      <el-table-column label="当前报价" width="100">
        <template #default="{ row }">{{ quotedCostText(row.quotedCost) }}</template>
      </el-table-column>
      <el-table-column label="议价标记" width="120">
        <template #default="{ row }">
          <el-tag v-if="cheaperMeta(row)" :type="cheaperMeta(row).type" size="small">
            {{ cheaperMeta(row).label }}
          </el-tag>
          <span v-else>—</span>
        </template>
      </el-table-column>
      <el-table-column label="状态" width="90">
        <template #default="{ row }">
          <el-tag :type="statusMeta(row.status, HINT_STATUS).type" size="small">
            {{ statusMeta(row.status, HINT_STATUS).label }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="发起时间" width="170">
        <template #default="{ row }">{{ fmtTime(row.createdAt) }}</template>
      </el-table-column>
      <el-table-column label="已等待" width="110">
        <template #default="{ row }">
          <span v-if="row.status === 'pending'">{{ waitTime(row.createdAt) }}</span>
          <span v-else>—</span>
        </template>
      </el-table-column>
      <el-table-column label="拒绝原因" min-width="140">
        <template #default="{ row }">{{ row.reason || "—" }}</template>
      </el-table-column>
      <el-table-column label="操作" width="230" fixed="right">
        <template #default="{ row }">
          <template v-if="!canHandle">
            <span>—</span>
          </template>
          <template v-else-if="row.status === 'pending'">
            <el-button size="small" type="primary" :loading="busy(row, 'quote')" @click="openForm(row, 'quote')">
              报价
            </el-button>
            <el-button size="small" type="danger" :loading="busy(row, 'reject')" @click="rejectRow(row)">拒绝</el-button>
          </template>
          <template v-else-if="row.status === 'quoted' && needsCheaperReply(row)">
            <el-button size="small" type="primary" :loading="busy(row, 'requote')" @click="openForm(row, 'requote')">
              降价
            </el-button>
            <el-button size="small" :loading="busy(row, 'decline')" @click="declineCheaper(row)">拒绝降价</el-button>
            <el-button size="small" type="danger" :loading="busy(row, 'reject')" @click="rejectRow(row)">拒绝</el-button>
          </template>
          <template v-else-if="row.status === 'quoted'">
            <el-button size="small" type="danger" :loading="busy(row, 'reject')" @click="rejectRow(row)">拒绝</el-button>
          </template>
          <span v-else>—</span>
        </template>
      </el-table-column>
    </el-table>

    <PageNav :page="page" :has-more="hasMore" :loading="loading" @prev="prev" @next="next" />

    <!-- 报价 / 降价共用：价格与答复一次提交，答复只写服务端、玩家确认后才送达 -->
    <el-dialog v-model="formDialog.visible" :title="formDialogTitle" width="520px">
      <el-alert
        v-if="formDialog.mode === 'requote'"
        class="dialog-alert"
        type="info"
        show-icon
        :closable="false"
        :title="formDialogAlert"
      />
      <el-form label-width="90px">
        <el-form-item label="点数 cost" required>
          <el-input-number
            v-model="formDialog.cost"
            :min="0"
            :max="1000000"
            :precision="0"
            :step="1"
            style="width: 100%"
          />
          <div class="hint">0–1000000 的整数（tips 点数）</div>
        </el-form-item>
        <el-form-item label="答复 reply" required>
          <el-input
            v-model="formDialog.reply"
            type="textarea"
            :rows="5"
            maxlength="2000"
            show-word-limit
            placeholder="答复只存服务端，玩家确认扣费后才会收到"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="formDialog.visible = false">取消</el-button>
        <el-button type="primary" :loading="formDialog.loading" @click="submitForm">
          {{ formDialog.mode === "requote" ? "降价并保存答复" : "提交报价" }}
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { useAuthStore } from "@/stores/auth";
import {
    declineCheaperHint,
    listHintRequests,
    quoteHint,
    rejectHint,
    requoteHint,
} from "@/api/msg";
import { useCursorPage } from "@/composables/useCursorPage";
import PageNav from "@/components/PageNav.vue";
import { fmtTime, HINT_STATUS, statusMeta } from "@/utils/format";

const auth = useAuthStore();
// 写操作需要 msg.hint.handle（admin 由 store 的 can() 直通）
const canHandle = computed(() => auth.can("msg.hint.handle"));

const STATUS_OPTIONS = [
    { value: "pending", label: "待报价" },
    { value: "quoted", label: "已报价" },
    { value: "answered", label: "已答复" },
    { value: "rejected", label: "已拒绝" },
    { value: "closed", label: "已关闭" },
    { value: "all", label: "全部" },
];

const filters = reactive({ status: "pending" });

const fetcher = (cursor) => listHintRequests({ ...filters, cursor, limit: 50 });
const { list, page, hasMore, loading, first, next, prev } = useCursorPage(fetcher);

function search() {
    first();
}
function reset() {
    filters.status = "pending";
    first();
}

// 0 是合法报价，只有 null / undefined 才算「未报价」
function quotedCostText(cost) {
    return cost === null || cost === undefined ? "—" : `${cost} 点`;
}

function waitTime(createdAt) {
    const ms = Date.now() - new Date(createdAt).getTime();
    if (Number.isNaN(ms) || ms < 0) return "—";
    const m = Math.floor(ms / 60000);
    if (m < 60) return `${m} 分钟`;
    const h = Math.floor(m / 60);
    return `${h} 小时 ${m % 60} 分`;
}

// 议价标记：申请降价（未回应）> 已回应降价 > 已是最低价，三者只显示其一
function cheaperMeta(row) {
    if (row.cheaperRequestedAt && !row.cheaperDecidedAt) {
        return { label: "申请降价", type: "warning" };
    }
    if (row.cheaperDecidedAt) return { label: "已回应降价", type: "info" };
    if (row.isLowestPrice) return { label: "已是最低价", type: "success" };
    return null;
}

// 有待回应的降价申请：只有此时才能「降价」或「拒绝降价」
function needsCheaperReply(row) {
    return !!row.cheaperRequestedAt && !row.cheaperDecidedAt;
}

// 每个按钮自己的 loading 键（`行ID:动作`），避免同一条请求并发点两次
const busyKey = ref("");
const busy = (row, action) => busyKey.value === `${row.id}:${action}`;

// 报价与降价共用对话框：字段相同（cost + reply），差异只有标题、接口与 cost 上限
const formDialog = reactive({
    visible: false,
    mode: "quote",
    loading: false,
    row: null,
    cost: null,
    reply: "",
});

const formDialogTitle = computed(() =>
    formDialog.mode === "requote" ? "降价并改回答" : "报价",
);
const formDialogAlert = computed(
    () =>
        `当前报价 ${quotedCostText(formDialog.row?.quotedCost)}，新报价必须更低，` +
        "且必须同时给出新的答复（更便宜 ⇒ 内容更少）。",
);

function openForm(row, mode) {
    formDialog.row = row;
    formDialog.mode = mode;
    formDialog.cost = null;
    formDialog.reply = "";
    formDialog.visible = true;
}

async function submitForm() {
    const row = formDialog.row;
    if (!row) return;
    const cost = Number(formDialog.cost);
    if (
        formDialog.cost === null ||
        formDialog.cost === undefined ||
        !Number.isInteger(cost) ||
        cost < 0 ||
        cost > 1000000
    ) {
        ElMessage.warning("请填写 0–1000000 的整数点数");
        return;
    }
    const reply = formDialog.reply.trim();
    if (!reply) {
        ElMessage.warning("请填写答复内容");
        return;
    }
    if (formDialog.mode === "requote") {
        const current = formDialog.row?.quotedCost;
        if (current !== null && current !== undefined && cost >= Number(current)) {
            ElMessage.warning(`新报价必须低于当前报价（${current} 点）`);
            return;
        }
    }

    busyKey.value = `${row.id}:${formDialog.mode}`;
    formDialog.loading = true;
    try {
        if (formDialog.mode === "requote") {
            await requoteHint(row.id, { cost, reply });
            ElMessage.success("已降价并更新答复，等待玩家按新价确认");
        } else {
            await quoteHint(row.id, { cost, reply });
            ElMessage.success("已报价，等待玩家确认扣费");
        }
        formDialog.visible = false;
        first();
    } catch (err) {
        ElMessage.error(err.message);
    } finally {
        formDialog.loading = false;
        busyKey.value = "";
    }
}

// 拒绝降价：不改价不改回答，只标记当前报价为最低报价
async function declineCheaper(row) {
    try {
        await ElMessageBox.confirm(
            `确认后当前报价（${quotedCostText(row.quotedCost)}）即为最低报价，玩家不能再申请更便宜。`,
            "拒绝降价",
            { type: "warning", confirmButtonText: "确认拒绝降价" },
        );
    } catch {
        return;
    }
    busyKey.value = `${row.id}:decline`;
    try {
        await declineCheaperHint(row.id);
        ElMessage.success("已拒绝降价，当前报价已标记为最低报价");
        first();
    } catch (err) {
        ElMessage.error(err.message);
    } finally {
        busyKey.value = "";
    }
}

async function rejectRow(row) {
    let reason = "";
    try {
        const { value } = await ElMessageBox.prompt(
            "拒绝后该请求终止，已写下的答复会被清空（玩家未确认扣费，不产生退款）。",
            "拒绝求提示",
            {
                inputType: "textarea",
                inputPlaceholder: "拒绝原因（可选，≤200 字）",
                inputValidator: (v) =>
                    !v || v.length <= 200 ? true : "拒绝原因不能超过 200 字",
            },
        );
        reason = value || "";
    } catch {
        return;
    }
    busyKey.value = `${row.id}:reject`;
    try {
        await rejectHint(row.id, { reason: reason.trim() });
        ElMessage.success("已拒绝");
        first();
    } catch (err) {
        ElMessage.error(err.message);
    } finally {
        busyKey.value = "";
    }
}

onMounted(() => first());
</script>

<style scoped>
.tip {
    color: #909399;
    font-size: 12px;
}
.question {
    white-space: pre-wrap;
    word-break: break-word;
}
.hint {
    font-size: 12px;
    color: #909399;
    width: 100%;
}
.dialog-alert {
    margin-bottom: 12px;
}
</style>
