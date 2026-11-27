<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script setup lang="ts">
import { combineAbortSignals } from '../abort-signals'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { LoaderCircle, WandSparkles } from '@lucide/vue'
import type { Work } from '../data'
import { api, errorMessage, session } from '../state'
import { creation, resumeCreation, stopCreation, submitCreation, type CreationGroup, type CreationModel } from '../native-studio'
import { reversePromptContent, reversePromptFiles, reversePromptInstruction } from '../studio-reverse-prompt'
import { chatOptionsSchema } from '../../shared/studio/options'
import StudioBilling from './StudioBilling.vue'

const props = defineProps<{ source: Work; disabled?: boolean }>()
const emit = defineEmits<{ 'update:prompt': [value: string]; busy: [value: boolean] }>()
const catalogue = ref<{ groups: CreationGroup[]; items: CreationModel[]; contractVersion?: 1 | 2 }>({ groups: [], items: [] })
const group = ref(''), model = ref(''), fileId = ref(''), draft = ref(''), issue = ref('')
const loading = ref(false), preparing = ref(false), recovering = ref(false)
const owner = session.user?.id, account = session.user?.accountId || owner
const lifetime = new AbortController()
let preparation: AbortController | undefined
const current = () => !lifetime.signal.aborted && owner === session.user?.id && account === (session.user?.accountId || session.user?.id)
const conversationId = computed(() => `reverse-prompt-${props.source.id}`)
const task = computed(() => current() ? creation.tasks.find(item => item.owner === owner && item.conversationId === conversationId.value && item.kind === 'text') : undefined)
const running = computed(() => !!task.value && ['submitting', 'running'].includes(task.value.phase))
const unresolved = computed(() => !!task.value && !['complete', 'error'].includes(task.value.phase))
const busy = computed(() => preparing.value || recovering.value || running.value)
const textModels = computed(() => catalogue.value.items.filter(item => item.configuredKind ? item.configuredKind === 'text' : item.kinds?.includes('text')))
const groups = computed(() => catalogue.value.groups.filter(item => textModels.value.some(model => model.groups?.includes(item.id))))
const models = computed(() => textModels.value.filter(item => item.groups?.includes(group.value)))
const selectedModel = computed(() => models.value.find(item => item.id === model.value))
const files = computed(() => reversePromptFiles(props.source))
const file = computed(() => files.value.find(item => item.id === fileId.value))
const locked = computed(() => props.disabled || busy.value || unresolved.value)
watch(groups, values => { if (!values.some(item => item.id === group.value)) group.value = values[0]?.id || '' })
watch(models, values => { if (!values.some(item => item.id === model.value)) model.value = values[0]?.id || '' })
watch(files, values => { if (!values.some(item => item.id === fileId.value)) fileId.value = values[0]?.id || '' }, { immediate: true })
watch(() => task.value?.text, value => { draft.value = value || '' }, { immediate: true })
watch([draft, () => task.value?.phase], () => emit('update:prompt', task.value?.phase === 'complete' ? draft.value.trim() : ''), { immediate: true })
watch(busy, value => emit('busy', value), { immediate: true })

async function load() {
  if (loading.value || !current()) return
  loading.value = true; issue.value = ''
  try {
    const combined = combineAbortSignals([lifetime.signal, AbortSignal.timeout(20000)])
    const result = await api<typeof catalogue.value>('/api/creation/models?scope=all', { expectedAccount: account, signal: combined.signal }).finally(combined.dispose)
    if (current()) catalogue.value = result
  } catch (cause) { if (current()) issue.value = errorMessage(cause) }
  finally { if (current()) loading.value = false }
}
async function start() {
  if (!current() || locked.value || loading.value || !file.value || !selectedModel.value || !group.value) return
  preparing.value = true; issue.value = ''
  const selected = { group: group.value, model: model.value, file: file.value }
  const controller = preparation = new AbortController()
  const valid = () => current() && !controller.signal.aborted
  let combined: ReturnType<typeof combineAbortSignals> | undefined
  try {
    combined = combineAbortSignals([controller.signal, lifetime.signal, AbortSignal.timeout(90000)])
    const signal = combined.signal
    const content = await reversePromptContent(selected.file, signal)
    const native = catalogue.value.contractVersion === 2
    const access = await api<{ items: CreationModel[]; tokenId?: number; contractVersion: 1 | 2 }>(`/api/creation/models${native ? `?group=${encodeURIComponent(selected.group)}` : ''}`, {
      ...(!native ? { method: 'POST', body: { group: selected.group } } : {}), expectedAccount: account, signal,
    })
    if (!valid()) return
    if (!access.items.some(item => item.id === selected.model && (item.configuredKind ? item.configuredKind === 'text' : item.kinds?.includes('text')))) throw new Error('所选文本模型已不可用，请重新读取模型。')
    await submitCreation({
      kind: 'text', model: selected.model, prompt: '根据源作品反推可复现的生成提示词。', conversationId: conversationId.value,
      sourceWorkId: props.source.id, accountTokenId: access.tokenId ?? null, accountGroup: selected.group, accountContractVersion: access.contractVersion ?? 1,
      apiFormat: 'auto', size: 'auto', aspect_ratio: 'auto', n: 1, duration: 8,
      chatOptions: chatOptionsSchema.parse({ messages: [
        { role: 'system', content: reversePromptInstruction(props.source.kind) },
        { role: 'user', content },
      ], stream: true }),
    }, undefined, valid)
  } catch (cause) { if (valid()) issue.value = errorMessage(cause) }
  finally { combined?.dispose(); if (preparation === controller) { preparing.value = false; preparation = undefined } }
}
function stop() { preparation?.abort(); if (task.value) stopCreation(task.value); preparing.value = false }
async function recover() {
  if (!current() || busy.value || !task.value) return
  recovering.value = true; issue.value = ''
  try { await resumeCreation(task.value) }
  catch (cause) { if (current()) issue.value = errorMessage(cause) }
  finally { if (current()) recovering.value = false }
}
onMounted(load)
onBeforeUnmount(() => { stop(); lifetime.abort() })
watch(() => [session.user?.id, session.user?.accountId], () => { if (!current()) { stop(); lifetime.abort(); draft.value = ''; emit('update:prompt', ''); emit('busy', false) } })
</script>

<template>
  <section class="reverse-prompt" aria-labelledby="reverse-prompt-heading">
    <h3 id="reverse-prompt-heading"><WandSparkles :size="18" aria-hidden="true" />反推作品提示词</h3>
    <p class="form-note">作者未公开提示词。选择支持图片理解的文本模型，根据原作品推测提示词，编辑后即可导入。</p>
    <p v-if="source.kind === 'video'" class="form-note">视频最多采样 8 帧，仅分析画面，不分析音轨。单个视频不超过 100 MB。</p>
    <label v-if="files.length > 1" class="reverse-field">反推作品文件<select v-model="fileId" :disabled="locked"><option v-for="item in files" :key="item.id" :value="item.id">{{ item.name }}</option></select></label>
    <p v-if="!files.length" class="form-error" role="alert">没有可读取的原作品文件，暂时无法反推。</p>
    <div class="reverse-models">
      <label class="reverse-field">反推文本分组<select v-model="group" :disabled="locked || loading || !groups.length"><option v-if="!groups.length" value="">{{ loading ? '正在读取…' : '暂无可用文本分组' }}</option><option v-for="item in groups" :key="item.id" :value="item.id">{{ item.name }}</option></select></label>
      <label class="reverse-field">反推文本模型<select v-model="model" :disabled="locked || loading || !models.length"><option v-if="!models.length" value="">请选择可用文本分组</option><option v-for="item in models" :key="item.id" :value="item.id">{{ item.name || item.id }}</option></select></label>
    </div>
    <p class="form-note">反推按所选文本模型消耗积分，制作同款另行计费。反推结果不等同于作者原始提示词。</p>
    <StudioBilling v-if="model" :model="model" :group="group" :api-format="selectedModel?.apiFormat" hide-catalog />
    <div class="reverse-actions">
      <button v-if="busy" type="button" class="button btn" @click="stop">停止等待</button>
      <button v-else-if="unresolved" type="button" class="button btn" :disabled="disabled" @click="recover">查询反推结果</button>
      <button v-else type="button" class="button btn" :disabled="disabled || loading || !file || !model || !group" @click="start"><WandSparkles :size="16" aria-hidden="true" />{{ task?.phase === 'complete' ? '重新反推（另计费）' : '开始反推提示词' }}</button>
      <button type="button" class="text-link" :disabled="locked || loading" @click="load">重新读取模型</button>
    </div>
    <p v-if="busy" class="reverse-status" role="status"><LoaderCircle :size="16" aria-hidden="true" />{{ running || recovering ? '正在反推提示词…' : '正在读取原作品…' }}</p>
    <p v-if="unresolved && !busy" class="form-note" role="status">原请求可能仍在执行，查询结果不会重新生成或重复提交扣费。</p>
    <label v-if="draft || task?.phase === 'complete'" class="reverse-field">反推提示词（可编辑）<textarea v-model="draft" rows="6" maxlength="32000" :readonly="task?.phase !== 'complete' || busy" :disabled="disabled" placeholder="模型未返回提示词，可在此补充。" /></label>
    <p v-if="task?.phase === 'complete'" class="form-note" role="status">反推完成。确认提示词后，点击下方“导入提示词”，或直接后台生成同款。</p>
    <p v-if="issue || task?.error" class="form-error" role="alert">{{ issue || task?.error }}</p>
  </section>
</template>

<style scoped>
.reverse-prompt { display: grid; gap: 12px; padding: 16px; border: 1px solid var(--border); border-radius: 10px; background: var(--surface); }
.reverse-prompt h3 { display: flex; align-items: center; gap: 8px; margin: 0; font-size: 15px; }
.reverse-prompt p { margin: 0; line-height: 1.6; }
.reverse-models { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.3fr); gap: 12px; }
.reverse-field { display: grid; gap: 6px; min-width: 0; font-size: 13px; }
.reverse-field select, .reverse-field textarea { width: 100%; min-width: 0; min-height: 44px; padding: 10px; border: 1px solid var(--border); border-radius: 6px; background: var(--canvas); color: var(--ink); font: inherit; }
.reverse-field textarea { resize: vertical; line-height: 1.6; }
.reverse-actions, .reverse-status { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.reverse-actions button { min-height: 44px; white-space: normal; }
.reverse-field :focus-visible { outline: 2px solid var(--focus-ring); outline-offset: 2px; }
@media (max-width: 639px) { .reverse-models { grid-template-columns: minmax(0, 1fr); }.reverse-prompt { padding: 12px; } }
</style>
