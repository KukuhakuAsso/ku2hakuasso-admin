<script setup>
// 源码编辑器：CodeMirror 5（vue mode），包装成 v-model 可直接用的输入框。
//
// 语言固定为 vue（<template>/<script setup>/<style> 三段都能高亮），
// 因为出题台只编辑单文件组件源码；需要换语言时传 mode 覆盖即可。
import { computed } from "vue";
import { VueCodemirror } from "codemirror-editor-vue3";
import "codemirror/lib/codemirror.css";
// vue mode 依赖 xml / javascript / css / htmlmixed，必须按顺序先引入
import "codemirror/mode/xml/xml.js";
import "codemirror/mode/javascript/javascript.js";
import "codemirror/mode/css/css.js";
import "codemirror/mode/htmlmixed/htmlmixed.js";
import "codemirror/mode/vue/vue.js";
import "codemirror/addon/edit/closebrackets.js";
import "codemirror/addon/edit/matchbrackets.js";

const props = defineProps({
    modelValue: { type: String, default: "" },
    height: { type: String, default: "320px" },
    placeholder: { type: String, default: "" },
    mode: { type: String, default: "vue" },
    readonly: { type: Boolean, default: false },
});

const emit = defineEmits(["update:modelValue"]);

const code = computed({
    get: () => props.modelValue,
    set: (value) => emit("update:modelValue", value ?? ""),
});

const options = computed(() => ({
    mode: props.mode,
    lineNumbers: true,
    lineWrapping: true,
    tabSize: 2,
    indentUnit: 2,
    autoCloseBrackets: true,
    matchBrackets: true,
    readOnly: props.readonly,
    placeholder: props.placeholder,
}));
</script>

<template>
    <div class="source-editor" :style="{ height }">
        <VueCodemirror
            v-model:value="code"
            :options="options"
            :style="{ height: '100%' }"
            class="source-editor__cm"
        />
    </div>
</template>


<style scoped>
.source-editor {
    width: 100%;
    overflow: hidden;
    border: 1px solid var(--el-border-color);
    border-radius: 4px;
}

/* CodeMirror 5 的容器高度由内部 .CodeMirror 决定，这里让它铺满外层 */
.source-editor :deep(.CodeMirror) {
    height: 100%;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 13px;
    line-height: 1.6;
}
</style>
