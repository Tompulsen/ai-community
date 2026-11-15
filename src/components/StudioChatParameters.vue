<!-- Settings hierarchy adapted from octopus_chat model-config.tsx (MIT). -->
<script setup lang="ts">
import { ChevronDown } from '@lucide/vue'
import { saveChats, type NativeChat } from '../native-chat'
import { CHAT_API_FORMATS } from '../../shared/studio/chat-api-format'
import { REASONING_EFFORT_OPTIONS } from '../../shared/studio/chat-params'
defineProps<{ chat: NativeChat; format?: string }>()
defineEmits<{ format: [event: Event] }>()
</script>
<template>
  <div class="chat-parameter-settings">
    <label class="setting-row"><span>最大输出 Tokens</span><input v-model.number="chat.settings.max_tokens" class="control" type="number" min="1" max="1000000" @change="saveChats()" /></label>
    <label class="setting-row"><span>推理强度</span><select v-model="chat.settings.reasoningEffort" class="control" @change="saveChats()"><option v-for="option in REASONING_EFFORT_OPTIONS" :key="option.value" :value="option.value">{{ option.label }}</option></select></label>
    <label class="setting-row"><span>温度 <output>{{ chat.settings.temperature }}</output></span><input v-model.number="chat.settings.temperature" aria-label="温度" type="range" min="0" max="2" step="0.1" @change="saveChats()" /></label>
    <label class="setting-row"><span>流式输出</span><input v-model="chat.settings.stream" type="checkbox" role="switch" @change="saveChats()" /></label>
    <label class="field system-prompt"><span>系统提示词</span><textarea v-model="chat.system" class="control" rows="3" @change="saveChats()" /></label>
    <details class="chat-advanced-settings">
      <summary>高级参数<ChevronDown :size="15" /></summary>
      <div class="advanced-settings-content">
        <label class="setting-row"><span>接口格式</span><select :value="format" class="control" @change="$emit('format', $event)"><option v-for="value in CHAT_API_FORMATS" :key="value" :value="value">{{ value }}</option></select></label>
        <label class="setting-row"><span>Top P</span><input v-model.number="chat.settings.top_p" class="control" type="number" min="0" max="1" step="0.05" @change="saveChats()" /></label>
        <label class="setting-row"><span>话题惩罚</span><input v-model.number="chat.settings.presence_penalty" class="control" type="number" min="-2" max="2" step="0.1" @change="saveChats()" /></label>
        <label class="setting-row"><span>重复惩罚</span><input v-model.number="chat.settings.frequency_penalty" class="control" type="number" min="-2" max="2" step="0.1" @change="saveChats()" /></label>
        <label class="setting-row"><span>历史压缩阈值</span><input v-model.number="chat.compressionThreshold" class="control" type="number" min="500" max="2000000" @change="saveChats()" /></label>
        <label class="setting-row"><span>保留历史摘要</span><input v-model="chat.sendMemory" type="checkbox" role="switch" @change="saveChats()" /></label>
        <label class="field"><span>停止序列（每行一项）</span><textarea v-model="chat.settings.stop" class="control" rows="2" @change="saveChats()" /></label>
      </div>
    </details>
  </div>
</template>
<style scoped>
.chat-parameter-settings, .advanced-settings-content { display: grid; gap: 12px; min-width: 0; }.setting-row { display: flex; align-items: center; justify-content: space-between; gap: 16px; min-height: 44px; font-size: 13px; color: var(--muted); }.setting-row > span { flex: 0 1 auto; }.setting-row .control, .setting-row > input[type="range"] { width: 52%; min-width: 0; }.setting-row output { padding-inline-start: 6px; font-variant-numeric: tabular-nums; color: var(--ink); }.setting-row > input[type="range"] { accent-color: var(--ink); }
.setting-row input[role="switch"] { appearance: none; flex: none; position: relative; width: 34px; height: 20px; margin: 0; border: 0; border-radius: 10px; background: var(--muted); cursor: pointer; }.setting-row input[role="switch"]::after { content: ''; display: block; position: absolute; top: 3px; left: 3px; width: 14px; height: 14px; border-radius: 50%; background: var(--surface); }.setting-row input[role="switch"]:checked { background: var(--ink); }.setting-row input[role="switch"]:checked::after { left: 17px; }.setting-row input:focus-visible, summary:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: 2px; }
.field { min-width: 0; font-size: 13px; color: var(--muted); }.control { max-width: 100%; }summary { display: flex; align-items: center; justify-content: space-between; min-height: 44px; color: var(--muted); font-size: 13px; list-style: none; cursor: pointer; }summary::-webkit-details-marker { display: none; }details[open] > summary svg { transform: rotate(180deg); }
</style>
