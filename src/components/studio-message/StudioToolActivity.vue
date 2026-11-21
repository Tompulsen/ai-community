<!-- Adapted from octopus_chat tool-activity.tsx / tool-result.module.scss (MIT). -->
<script setup lang="ts">
import { computed, ref, useId, watch } from 'vue'
import { Check, ChevronDown, Copy, PencilLine, RotateCw, X } from '@lucide/vue'
import type { StudioToolActivity } from '../../studio-message-types'
import { formatToolValue, getToolResult, getToolTable, isToolRecord, MAX_TOOL_TEXT_LENGTH, parseToolArgumentInput } from '../../../shared/studio/tool-result'
import StudioAiStatus from './StudioAiStatus.vue'
import StudioDetails from './StudioDetails.vue'

const props = defineProps<{ tool: StudioToolActivity; disabled?: boolean; onRerun?: (args: Record<string, unknown>) => Promise<void> }>()
const id = `tool-${useId()}`, editing = ref(false), inputs = ref<Record<string, string>>({}), pending = ref(false), error = ref(''), copied = ref(false)
const running = computed(() => props.tool.status === 'pending' || props.tool.status === 'running')
const state = computed(() => props.tool.status === 'error' ? 'error' : running.value ? 'thinking' : 'done')
const label = computed(() => `${({ pending: '等待执行', running: '正在执行', complete: '已完成', error: '执行失败', stopped: '已停止' })[props.tool.status]} · ${props.tool.name || '工具调用'}`)
const result = computed(() => typeof props.tool.result === 'string' ? getToolResult(props.tool.result) : props.tool.result)
const resultText = computed(() => formatToolValue(result.value)), table = computed(() => getToolTable(result.value))
const fields = computed(() => isToolRecord(result.value) && Object.keys(result.value).length <= 20 ? Object.entries(result.value) : undefined)
const args = computed(() => Object.entries(props.tool.arguments))
const canEdit = computed(() => !!props.onRerun && !running.value)
watch(() => props.tool.id, () => { editing.value = false; error.value = ''; copied.value = false })
function editArguments() {
  if (props.disabled || pending.value || !canEdit.value) return
  if (!editing.value) inputs.value = Object.fromEntries(args.value.map(([key, value]) => [key, formatToolValue(value)]))
  editing.value = !editing.value; error.value = ''
}
async function rerun() {
  if (!props.onRerun || props.disabled || pending.value || !canEdit.value) return
  pending.value = true; error.value = ''
  try {
    const next = Object.fromEntries(args.value.map(([key, value]) => [key, parseToolArgumentInput(value, inputs.value[key] ?? '')]))
    await props.onRerun(next)
    editing.value = false
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '操作失败，请重试。' }
  finally { pending.value = false }
}
async function copy() {
  try {
    await navigator.clipboard.writeText(typeof props.tool.result === 'string' ? props.tool.result : resultText.value)
    copied.value = true; error.value = ''
  } catch { error.value = '复制失败，请重试。' }
}
</script>

<template>
  <StudioDetails class="tool-activity" :data-state="state" :open-on="tool.status === 'error'" data-testid="tool-result-card" data-chat-scroll-isolation>
    <template #summary><StudioAiStatus :state="state" :label="label" :timer="running" /><ChevronDown :size="14" aria-hidden="true" /></template>
    <div class="tool-content">
      <p v-if="tool.status === 'error'" class="tool-error" role="alert">{{ tool.error || '工具执行失败，请调整参数后重试。' }}</p>
      <p v-if="tool.status === 'stopped'" class="tool-notice">已停止等待，工具的执行结果尚未确认。</p>
      <section v-if="tool.result !== undefined" aria-label="工具结果">
        <header class="tool-section-heading"><span>结果</span><button type="button" :aria-label="copied ? '结果已复制' : '复制工具结果'" :title="copied ? '结果已复制' : '复制工具结果'" @click="copy"><component :is="copied ? Check : Copy" :size="16" aria-hidden="true" /></button></header>
        <template v-if="table">
          <div class="tool-table-wrap" role="region" aria-label="工具结果数据" tabindex="0">
            <table><thead><tr><th v-for="column in table.columns" :key="column" scope="col">{{ column }}</th></tr></thead><tbody><tr v-for="(row, index) in table.rows" :key="index"><td v-for="column in table.columns" :key="column">{{ formatToolValue(row[column]).slice(0, 2000) }}</td></tr></tbody></table>
          </div>
          <p v-if="table.totalRows > table.rows.length" class="tool-notice">显示 {{ table.rows.length }} / {{ table.totalRows }} 条结果</p>
        </template>
        <dl v-else-if="fields" class="tool-fields"><template v-for="[key, value] in fields" :key="key"><dt>{{ key }}</dt><dd>{{ formatToolValue(value).slice(0, MAX_TOOL_TEXT_LENGTH) }}</dd></template></dl>
        <pre v-else class="tool-result" :class="{ 'tool-plain-text': typeof result === 'string' }">{{ resultText.slice(0, MAX_TOOL_TEXT_LENGTH) }}</pre>
        <p v-if="resultText.length > MAX_TOOL_TEXT_LENGTH" class="tool-notice">结果较长，可复制完整内容查看。</p>
      </section>
      <section v-if="args.length || canEdit" aria-label="工具参数">
        <header class="tool-section-heading"><span>参数</span><button v-if="canEdit" type="button" :disabled="disabled || pending" :aria-expanded="editing" @click="editArguments"><PencilLine :size="14" aria-hidden="true" />调整参数</button></header>
        <form v-if="editing" aria-label="调整工具参数" :aria-busy="pending" @submit.prevent="rerun">
          <label v-for="([key, value], index) in args" :key="key" :for="`${id}-${index}`" :class="{ 'tool-checkbox': typeof value === 'boolean' }">
            <template v-if="typeof value === 'boolean'"><input :id="`${id}-${index}`" type="checkbox" :checked="inputs[key] === 'true'" :disabled="disabled || pending" @change="inputs[key] = String(($event.target as HTMLInputElement).checked); error = ''" />{{ key }}</template>
            <template v-else><span>{{ key }}</span><input v-if="typeof value === 'string' || typeof value === 'number'" :id="`${id}-${index}`" :value="inputs[key]" :type="typeof value === 'number' ? 'number' : 'text'" :step="typeof value === 'number' ? 'any' : undefined" :disabled="disabled || pending" @input="inputs[key] = ($event.target as HTMLInputElement).value; error = ''" /><textarea v-else :id="`${id}-${index}`" v-model="inputs[key]" rows="3" :disabled="disabled || pending" @input="error = ''" /></template>
          </label>
          <div class="tool-form-actions"><button type="button" :disabled="pending" @click="editing = false; error = ''"><X :size="16" aria-hidden="true" />取消</button><button type="submit" :disabled="disabled || pending"><RotateCw :size="16" aria-hidden="true" />{{ pending ? '正在执行' : '重新执行' }}</button></div>
        </form>
        <pre v-else class="tool-result">{{ formatToolValue(tool.arguments).slice(0, MAX_TOOL_TEXT_LENGTH) }}</pre>
      </section>
      <p v-if="error" class="tool-error" role="alert">{{ error }}</p>
    </div>
  </StudioDetails>
</template>

<style scoped>
.tool-activity { min-width: 0; margin-block: 12px; color: var(--ink); font-size: 13px; line-height: 20px; }
:deep(summary) { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 36px; padding: 4px 8px; border-radius: 6px; cursor: pointer; list-style: none; }:deep(summary::-webkit-details-marker) { display: none; }:deep(summary:hover) { color: var(--ink); background: var(--state-hover); }:deep(summary:active) { color: var(--ink); background: var(--state-pressed); }:deep(summary > svg) { flex: none; color: var(--muted); transition: transform 220ms cubic-bezier(.22, 1, .36, 1); }:deep(summary:is(:hover, :active) > svg) { color: var(--ink); }.tool-activity[data-expanded="true"] :deep(summary > svg) { transform: rotate(180deg); }
:deep(summary:focus-visible), button:focus-visible, input:focus-visible, textarea:focus-visible, .tool-table-wrap:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: var(--focus-outline-offset); }
.tool-content { display: grid; gap: 12px; min-width: 0; padding: 8px; }.tool-content section { min-width: 0; }
.tool-section-heading { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px; min-height: 32px; margin-bottom: 4px; color: var(--muted); font-size: 12px; }
button { display: inline-flex; align-items: center; justify-content: center; gap: 8px; min-width: 32px; min-height: 32px; max-width: 100%; padding: 4px 8px; border: 0; border-radius: 6px; background: transparent; color: var(--ink); font: inherit; cursor: pointer; }button:hover:not(:disabled) { color: var(--ink); background: var(--state-hover); }button[aria-expanded="true"] { color: var(--ink); background: var(--state-selected); }button[aria-expanded="true"]:hover:not(:disabled), button:active:not(:disabled) { color: var(--ink); background: var(--state-pressed); }button:disabled { opacity: .55; cursor: default; }button svg { flex: none; }
.tool-result { margin: 0; max-height: 360px; overflow: auto; overscroll-behavior: contain; scrollbar-width: thin; padding: 12px; border-radius: 6px; background: var(--surface-soft); color: var(--ink); font-size: 12px; line-height: 20px; white-space: pre-wrap; overflow-wrap: anywhere; }.tool-plain-text { font-family: inherit; font-size: 13px; }
.tool-fields { display: grid; grid-template-columns: minmax(80px, 1fr) minmax(0, 3fr); gap: 8px 16px; margin: 0; padding: 8px 0; overflow-wrap: anywhere; }.tool-fields dt { color: var(--muted); }.tool-fields dd { margin: 0; white-space: pre-wrap; }
.tool-table-wrap { max-width: 100%; max-height: 360px; overflow: auto; overscroll-behavior: contain; scrollbar-width: thin; }table { width: 100%; border-collapse: collapse; font-size: 12px; text-align: start; font-variant-numeric: tabular-nums; }th, td { padding: 8px 12px; min-width: 100px; max-width: 360px; text-align: start; vertical-align: top; overflow-wrap: anywhere; }th { background: var(--surface-soft); font-weight: 500; }tr:nth-child(even) { background: var(--surface-soft); }
.tool-notice { margin: 8px 0 0; color: var(--muted); font-size: 12px; }.tool-error { margin: 0; color: var(--danger); overflow-wrap: anywhere; }
form { display: grid; gap: 12px; min-width: 0; }form label { display: grid; gap: 4px; min-width: 0; overflow-wrap: anywhere; }form label > span { color: var(--muted); font-size: 12px; }form .tool-checkbox { display: flex; align-items: center; gap: 8px; min-height: 36px; }
form .tool-checkbox:hover:not(:has(:disabled)) { background: var(--state-hover); }form .tool-checkbox:has(:checked) { background: var(--state-selected); }form .tool-checkbox:has(:checked):hover:not(:has(:disabled)), form .tool-checkbox:active:not(:has(:disabled)) { background: var(--state-pressed); }form .tool-checkbox:is(:hover:not(:has(:disabled)), :has(:checked)) > span { color: var(--ink); }
input:not([type="checkbox"]), textarea { box-sizing: border-box; width: 100%; min-height: 36px; padding: 8px 10px; border: 0; border-radius: 6px; background: var(--surface-soft); color: var(--ink); caret-color: var(--ink); font: inherit; }textarea { resize: vertical; }input[type="checkbox"] { appearance: auto; width: 18px; height: 18px; margin: 0; accent-color: var(--ink); }input[type="checkbox"]::after { display: none; }input:disabled, textarea:disabled { opacity: .55; }
.tool-form-actions { display: flex; align-items: center; justify-content: flex-end; flex-wrap: wrap; gap: 8px; }
@media (max-width: 600px), (pointer: coarse) { :deep(summary), button, input:not([type="checkbox"]), form .tool-checkbox { min-height: 44px; }.tool-fields { grid-template-columns: minmax(0, 1fr); gap: 4px; }.tool-fields dd { margin-bottom: 8px; }input:not([type="checkbox"]), textarea { font-size: 16px; } }
</style>
