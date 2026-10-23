<script setup>
// 解锁规则编辑器：对应 api-12 的 unlock 对象。
//
// kind:
//   sequence（默认，同目录上一题答对后解锁）/ always / count（已解数阈值）
//   keys（指定题目集合全部答对）/ handler（服务端已注册的判定函数）
// extra: 额外条件 { handler, params }，与主规则 AND。
import { ref, watch } from "vue";

const props = defineProps({
    modelValue: { type: Object, default: () => ({ kind: "sequence" }) },
});

const emit = defineEmits(["update:modelValue"]);

const KINDS = [
    { value: "sequence", label: "顺序解锁（上一题答对）" },
    { value: "always", label: "始终解锁" },
    { value: "count", label: "已解数达到阈值" },
    { value: "keys", label: "指定题目全部答对" },
    { value: "handler", label: "服务端判定函数" },
];

const form = ref(normalize(props.modelValue));

function normalize(value) {
    const source = value && typeof value === "object" ? value : {};
    return {
        kind: source.kind || "sequence",
        min: Number(source.min ?? 0),
        keys: Array.isArray(source.keys) ? source.keys.join(", ") : "",
        name: source.name || "",
        params: source.params ? JSON.stringify(source.params, null, 2) : "",
        extraName: source.extra?.handler || "",
        extraParams: source.extra?.params
            ? JSON.stringify(source.extra.params, null, 2)
            : "",
    };
}

// 外部换题时重置表单
watch(
    () => props.modelValue,
    (value) => {
        form.value = normalize(value);
    },
);

// 提交给后端前做最小整形：空字段不传，params 解析成对象。
function toUnlock() {
    const out = { kind: form.value.kind };

    if (out.kind === "count") out.min = Number(form.value.min) || 0;
    if (out.kind === "keys") {
        out.keys = String(form.value.keys || "")
            .split(",")
            .map((item) => item.trim())
            .filter(Boolean);
    }
    if (out.kind === "handler") {
        out.name = String(form.value.name || "").trim();
        const params = parseJson(form.value.params);
        if (params) out.params = params;
    }

    const extraName = String(form.value.extraName || "").trim();
    if (extraName) {
        const extra = { handler: extraName };
        const params = parseJson(form.value.extraParams);
        if (params) extra.params = params;
        out.extra = extra;
    }

    return out;
}

function parseJson(text) {
    const raw = String(text || "").trim();
    if (!raw) return null;
    try {
        return JSON.parse(raw);
    } catch {
        throw new Error("参数不是合法 JSON");
    }
}

defineExpose({ toUnlock });
</script>

<template>
    <div class="unlock-form">
        <el-form label-width="96px" size="small">
            <el-form-item label="规则">
                <el-select v-model="form.kind" style="width: 100%">
                    <el-option
                        v-for="item in KINDS"
                        :key="item.value"
                        :label="item.label"
                        :value="item.value"
                    />
                </el-select>
            </el-form-item>

            <el-form-item v-if="form.kind === 'count'" label="已解数">
                <el-input-number v-model="form.min" :min="0" :max="100000" />
            </el-form-item>

            <el-form-item v-if="form.kind === 'keys'" label="题目 key">
                <el-input
                    v-model="form.keys"
                    placeholder="多道题用英文逗号分隔，全部答对才解锁"
                />
            </el-form-item>

            <el-form-item v-if="form.kind === 'handler'" label="函数名">
                <el-input v-model="form.name" placeholder="服务端已注册的判定函数" />
            </el-form-item>

            <el-form-item v-if="form.kind === 'handler'" label="参数 JSON">
                <el-input v-model="form.params" type="textarea" :rows="2" />
            </el-form-item>

            <el-divider content-position="left">额外条件（可选，与主规则 AND）</el-divider>
            <el-form-item label="函数名">
                <el-input v-model="form.extraName" placeholder="留空表示不加额外条件" />
            </el-form-item>
            <el-form-item v-if="form.extraName" label="参数 JSON">
                <el-input v-model="form.extraParams" type="textarea" :rows="2" />
            </el-form-item>
        </el-form>
    </div>
</template>
