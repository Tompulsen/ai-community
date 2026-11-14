<!-- ModelSelect interaction rules adapted from octopus_chat (MIT). -->
<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, useId, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Bot, Check, ChevronDown, ExternalLink, Layers, Search, SlidersHorizontal, Star, X } from '@lucide/vue'
import { creation, loadCreationGroups, loadCreationModels, selectCreationGroup, type CreationGroup, type CreationKind, type CreationModel } from '../native-studio'
import { session, errorMessage } from '../state'
import { favoriteModel, modelChoices, modelFormat, modelKind, modelPreferences, modelType, setModelFormat, setModelType, toggleModelFavorite, type ModelType } from '../model-preferences'
import { modelCategories, modelDescription, modelVendor, searchModels, kindLabels } from '../../shared/studio/model-catalog'
import { CHAT_API_FORMATS, type ChatApiFormat } from '../../shared/studio/chat-api-format'
const props = defineProps<{ modelValue: string; kind: CreationKind }>()
const emit = defineEmits<{ 'update:modelValue': [value: string]; keys: [] }>()
const route = useRoute(), router = useRouter(), id = `model-picker-${useId()}`
const dialog = ref<HTMLDialogElement>(), search = ref<HTMLInputElement>()
const open = ref(false), query = ref(''), category = ref('all'), expanded = ref(''), error = ref('')
const groupsOpen = ref(false), sourceSelector = ref<HTMLDivElement>(), groupTrigger = ref<HTMLButtonElement>()
const groups = computed(() => creation.groups.filter(group => group.id !== '').sort((a, b) => a.id === 'auto' ? -1 : b.id === 'auto' ? 1 : 0))
const selectedGroup = computed(() => groups.value.find(group => group.id === creation.selectedGroup))
const busy = computed(() => creation.modelsLoading || creation.groupSwitching || creation.groupsLoading)
const matching = computed(() => searchModels(creation.models, query.value))
const categories = computed(() => modelCategories(matching.value, favoriteModel))
const visible = computed(() => matching.value.filter(item => category.value === 'all'
  || (category.value === 'favorites' ? favoriteModel(item.id) : modelVendor(item.id).name === category.value)))
const icons = new Set(['openai', 'gemini', 'claude', 'deepseek', 'grok', 'qwen', 'meta', 'mistral'])
const icon = (item: CreationModel) => icons.has(modelVendor(item.id).id) ? `/assets/model-vendors/${modelVendor(item.id).id}.svg` : ''
watch(categories, value => { if (!value.some(item => item.id === category.value)) category.value = 'all' })
watch([query, category, () => creation.groupSwitching], () => { expanded.value = '' })
watch(() => [session.user?.id, session.user?.accountId], () => close())
function close() { groupsOpen.value = false; dialog.value?.close(); open.value = false }
function groupLabel(group: CreationGroup) {
  if (group.id === 'auto') return 'Auto'
  return `${group.name || group.id}${typeof group.ratio === 'number' && Number.isFinite(group.ratio) ? ` · ${group.ratio}×` : ''}`
}
async function toggleGroups() {
  groupsOpen.value = !groupsOpen.value
  if (!groupsOpen.value) return
  expanded.value = ''
  await nextTick()
  const options = sourceSelector.value
  const selected = options?.querySelector<HTMLButtonElement>('[aria-pressed="true"]') || options?.querySelector<HTMLButtonElement>('.source-option')
  selected?.focus()
}
function dismissGroups(event: PointerEvent) {
  if (!sourceSelector.value?.contains(event.target as Node)) groupsOpen.value = false
}
function groupKeys(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault(); event.stopPropagation(); groupsOpen.value = false; groupTrigger.value?.focus()
  } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
    const options = [...(sourceSelector.value?.querySelectorAll<HTMLButtonElement>('.source-option:not(:disabled)') || [])]
    if (!options.length) return
    event.preventDefault()
    const current = options.indexOf(document.activeElement as HTMLButtonElement)
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : (current + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length
    options[next]?.focus()
  }
}
async function chooseGroup(group: string) {
  if (busy.value) return
  groupsOpen.value = false
  await selectCreationGroup(group)
  if (open.value) groupTrigger.value?.focus()
}
async function show() {
  if (!session.user) return
  query.value = ''; category.value = 'all'; expanded.value = ''; error.value = ''
  dialog.value?.showModal(); open.value = true
  await nextTick(); search.value?.focus()
}
async function choose(item: CreationModel) {
  const current = creation.models.find(model => model.id === item.id)
  if (busy.value || !current) return
  const kind = modelKind(current)
  close()
  if (kind === props.kind) emit('update:modelValue', item.id)
  else {
    modelChoices[kind] = item.id
    await router.replace({ path: `/create/${kind}`, query: route.query })
    await nextTick()
    document.querySelector<HTMLInputElement>('.studio-model-trigger input')?.focus()
  }
}
function update(action: () => void) { try { action(); error.value = '' } catch (cause) { error.value = errorMessage(cause) } }
function formatName(format: string) { return ({ 'chat-completions': 'Chat Completions', responses: 'Responses', gemini: 'Gemini 原生', claude: 'Claude Messages' } as Record<string, string>)[format] || format }
async function refresh() { if (busy.value) return; await loadCreationGroups(); await loadCreationModels() }
function cancel() {
  if (groupsOpen.value) { groupsOpen.value = false; groupTrigger.value?.focus() }
  else if (expanded.value) expanded.value = ''
  else close()
}
onBeforeUnmount(() => dialog.value?.close())
</script>

<template>
  <div class="studio-select studio-model-select studio-model-trigger">
    <input type="text" role="combobox" aria-label="模型" aria-haspopup="dialog" :aria-controls="id" :aria-expanded="open" :value="modelValue" :placeholder="busy ? '正在读取模型…' : '选择模型'" :title="modelValue || '选择模型'" readonly @click="show" @keydown.enter.prevent="show" @keydown.space.prevent="show" @keydown.down.prevent="show" />
    <ChevronDown :size="14" aria-hidden="true" />
  </div>
  <Teleport to="body"><dialog :id="id" ref="dialog" class="studio-model-dialog" aria-label="选择模型" @close="open = false" @cancel.prevent="cancel" @pointerdown="dismissGroups" @click="($event.target === dialog) && close()">
    <header class="model-dialog-header"><h2>选择模型</h2><button type="button" class="icon-button" aria-label="关闭选择模型" @click="close"><X :size="20" /></button></header>
    <div class="model-source">
      <div ref="sourceSelector" class="source-selector">
        <button ref="groupTrigger" type="button" class="source-trigger" aria-label="选择分组" :aria-expanded="groupsOpen" :aria-controls="`${id}-groups`" :disabled="busy || !groups.length" @click="toggleGroups()" @keydown.down.prevent="!groupsOpen && toggleGroups()">
          <Layers :size="18" aria-hidden="true" /><span>分组</span>
          <span class="source-name">{{ creation.groupSwitching ? '正在切换…' : creation.groupsLoading ? '正在读取…' : selectedGroup ? groupLabel(selectedGroup) : '选择分组' }}</span>
          <span v-if="selectedGroup?.id === 'auto'" class="source-type">系统</span><ChevronDown :size="16" aria-hidden="true" />
        </button>
        <div v-if="groupsOpen" :id="`${id}-groups`" class="source-options" role="group" aria-label="可选分组" @keydown="groupKeys">
          <button v-for="group in groups" :key="group.id" type="button" class="source-option" :aria-label="group.id === 'auto' ? 'Auto 系统' : groupLabel(group)" :aria-pressed="group.id === creation.selectedGroup" :title="group.description" :disabled="busy" @click="chooseGroup(group.id)">
            <span>{{ groupLabel(group) }}</span><span v-if="group.id === 'auto'" class="source-type">系统</span><Check v-if="group.id === creation.selectedGroup" :size="16" aria-hidden="true" />
          </button>
        </div>
      </div>
      <button type="button" class="text-link" @click="close(); emit('keys')"><ExternalLink :size="14" aria-hidden="true" />管理密钥</button>
    </div>
    <p v-if="error || modelPreferences.error || creation.groupsError || creation.modelsError" class="model-picker-error" role="alert">{{ error || modelPreferences.error || creation.groupsError || creation.modelsError }} <button type="button" class="text-link" @click="refresh">重新读取</button></p>
    <div class="model-dialog-body">
      <nav class="model-categories" aria-label="模型厂商分类"><button v-for="item in categories" :key="item.id" type="button" :aria-pressed="category === item.id" @click="category = item.id"><span>{{ item.name }}</span><span>{{ item.count }}</span></button></nav>
      <section class="model-results" aria-label="可选模型">
        <div class="model-search-row"><label class="model-search"><Search :size="18" /><input ref="search" v-model="query" type="search" aria-label="搜索模型" placeholder="搜索模型" autocomplete="off" /><button v-if="query" type="button" class="icon-button" aria-label="清除搜索" @click="query = ''; search?.focus()"><X :size="16" /></button></label><span>{{ visible.length }} 个模型</span></div>
        <div class="model-list" :aria-busy="busy">
          <p v-if="busy" class="model-empty" role="status">正在读取模型…</p>
          <p v-else-if="!visible.length" class="model-empty" role="status">暂无匹配模型</p>
          <template v-else><article v-for="item in visible" :key="item.id" class="model-item" :class="{ selected: item.id === modelValue && modelKind(item) === kind }">
            <div class="model-row"><button type="button" class="model-option" :aria-label="item.id" :aria-pressed="item.id === modelValue && modelKind(item) === kind" @click="choose(item)">
              <img v-if="icon(item)" :src="icon(item)" alt="" width="32" height="32" /><Bot v-else :size="28" />
              <span class="model-info"><span class="model-heading"><strong>{{ item.name || item.id }}</strong><span class="model-kind">{{ kindLabels[modelKind(item)] }}</span><span v-if="modelType(item.id) !== 'auto'" class="model-manual">手动</span></span><span class="model-description">{{ modelVendor(item.id).name }} · {{ modelDescription(item, modelKind(item)) }}</span></span><Check v-if="item.id === modelValue && modelKind(item) === kind" :size="17" />
            </button><button type="button" class="icon-button" :aria-label="`调整模型类型: ${item.id}`" title="调整模型类型与接口" :aria-expanded="expanded === item.id" :aria-controls="`${id}-${encodeURIComponent(item.id)}`" :disabled="busy || !creation.modelTokenId" @click="expanded = expanded === item.id ? '' : item.id"><SlidersHorizontal :size="18" /></button><button type="button" class="icon-button" :aria-label="`${favoriteModel(item.id) ? '取消收藏' : '收藏'}: ${item.id}`" :aria-pressed="favoriteModel(item.id)" :title="favoriteModel(item.id) ? '取消收藏' : '收藏'" :disabled="busy || !creation.modelTokenId" @click="update(() => toggleModelFavorite(item.id))"><Star :size="18" :fill="favoriteModel(item.id) ? 'currentColor' : 'none'" /></button></div>
            <div v-if="expanded === item.id" :id="`${id}-${encodeURIComponent(item.id)}`" class="model-settings" role="group" :aria-label="`模型设置: ${item.id}`">
              <label><span>模型类型</span><select :value="modelType(item.id)" :disabled="busy" @change="update(() => setModelType(item.id, ($event.target as HTMLSelectElement).value as ModelType))"><option value="auto">自动识别</option><option value="chat">对话</option><option value="image">生图</option><option value="video">视频</option></select></label>
              <label v-if="modelKind(item) === 'text'"><span>接口格式</span><select :value="modelFormat(item.id) || 'auto'" :disabled="busy" @change="update(() => setModelFormat(item.id, ($event.target as HTMLSelectElement).value as ChatApiFormat | 'auto'))"><option value="auto">跟随对话设置</option><option v-for="format in CHAT_API_FORMATS" :key="format" :value="format">{{ formatName(format) }}</option></select></label>
            </div>
          </article></template>
        </div>
      </section>
    </div>
  </dialog></Teleport>
</template>

<style scoped>
.studio-model-trigger { position: relative; flex: 1; min-width: 0; }
.studio-model-trigger input { width: 100%; min-width: 0; max-width: 220px; min-height: 36px; padding: 8px 24px 8px 4px; background: transparent; border: 0; outline: none; cursor: pointer; font-size: 14px; text-overflow: ellipsis; }
.studio-model-trigger:focus-within { outline: 1px solid var(--muted); outline-offset: 2px; }
.studio-model-trigger > svg { position: absolute; right: 4px; pointer-events: none; }
.studio-model-dialog { width: min(1000px, calc(100vw - 32px)); height: min(720px, calc(100dvh - 48px)); max-height: calc(100dvh - 48px); display: none; flex-direction: column; border-radius: 8px; }
.studio-model-dialog[open] { display: flex; }
.studio-model-dialog::backdrop { background: #0008; }
.model-dialog-header { display: flex; flex: none; align-items: center; justify-content: space-between; gap: 16px; padding: 16px 24px; }
.model-dialog-header h2 { margin: 0; font-size: 20px; line-height: 28px; }
.model-dialog-header .icon-button { width: 44px; height: 44px; background: transparent; border: 0; }
.model-source { display: flex; flex: none; align-items: center; gap: 12px; padding: 0 24px 16px; min-width: 0; }
.source-selector { position: relative; flex: 1; min-width: 0; }
.source-trigger { display: flex; align-items: center; gap: 8px; width: 100%; min-height: 44px; padding: 8px 12px; text-align: left; border-radius: 8px; }
.source-trigger:hover:not(:disabled), .source-trigger[aria-expanded="true"] { background: var(--surface-soft); }
.source-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.source-trigger > svg:last-child { margin-left: auto; }
.source-options { position: absolute; z-index: 2; top: calc(100% + 8px); left: 0; right: 0; max-height: min(440px, calc(100dvh - 240px)); overflow-y: auto; overscroll-behavior: contain; padding: 4px; border-radius: 8px; background: var(--surface); border: 1px solid var(--border); }
.source-option { display: flex; align-items: center; gap: 8px; width: 100%; min-height: 44px; padding: 8px 12px; border-radius: 6px; text-align: left; }
.source-option > span:first-child { min-width: 0; overflow-wrap: anywhere; }
.source-option > svg { margin-left: auto; }
.source-option:hover:not(:disabled), .source-option[aria-pressed="true"] { background: var(--surface-soft); }
.source-trigger:focus-visible, .source-option:focus-visible { outline: 1px solid var(--muted); outline-offset: -2px; }
.source-type { color: var(--muted); font-size: 12px; }
.model-source > .text-link { margin-left: auto; white-space: nowrap; }
.model-picker-error { margin: 0 24px 12px; font-size: 13px; color: var(--danger); }
.model-dialog-body { display: grid; grid-template-columns: 180px minmax(0, 1fr); flex: 1; min-height: 0; gap: 20px; padding: 0 24px 24px; }
.model-categories { display: flex; flex-direction: column; gap: 4px; overflow-y: auto; }
.model-categories > button { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex: none; min-height: 44px; padding: 10px 12px; border-radius: 6px; text-align: left; color: var(--muted); }
.model-categories > button[aria-pressed="true"] { color: var(--ink); background: var(--surface-soft); }
.model-results { display: flex; flex-direction: column; min-width: 0; min-height: 0; }
.model-search-row { display: flex; flex: none; align-items: center; gap: 12px; margin-bottom: 8px; font-size: 12px; color: var(--muted); }
.model-search { display: flex; flex: 1; align-items: center; min-width: 0; gap: 8px; padding-inline: 12px; min-height: 44px; background: var(--surface); border-radius: 6px; }
.model-search:focus-within { outline: 1px solid var(--muted); }
.model-search input { width: 100%; min-width: 0; background: transparent; border: 0; outline: none; padding-block: 10px; font-size: 16px; }
.model-search-row > span { flex: none; }
.model-search .icon-button { border: 0; background: transparent; }
.model-list { overflow-y: auto; min-height: 0; flex: 1; }
.model-empty { padding: 32px 12px; text-align: center; color: var(--muted); }
.model-item { border-radius: 6px; }
.model-item.selected { background: var(--surface); color: var(--ink); }
.model-row { display: grid; grid-template-columns: minmax(0, 1fr) 36px 36px; align-items: center; gap: 4px; padding-right: 4px; }
.model-option { display: flex; align-items: center; gap: 16px; min-width: 0; min-height: 76px; padding: 12px; text-align: left; }
.model-option:hover { background: var(--surface-soft); border-radius: 6px; }
.model-option > img { flex: none; padding: 3px; border-radius: 6px; background: white; object-fit: contain; }
.model-info { display: grid; min-width: 0; gap: 6px; overflow-wrap: anywhere; }
.model-heading { display: flex; align-items: baseline; flex-wrap: wrap; gap: 6px 12px; }
.model-heading strong { font-size: 15px; font-weight: 500; }
.model-kind { font-size: 12px; color: var(--amber); }
.model-description, .model-manual { font-size: 12px; color: var(--muted); }
.model-row > .icon-button { background: transparent; border: 0; }
.model-row > .icon-button[aria-pressed="true"] { color: var(--amber); }
.model-settings { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; padding: 12px; background: var(--surface); border-radius: 6px; }
.model-settings label { display: grid; gap: 6px; font-size: 13px; }
.model-settings select { width: 100%; min-height: 44px; padding: 8px; border: 1px solid var(--border); border-radius: 6px; background: var(--canvas); }
@media (max-width: 639px) {
  .studio-model-trigger input { min-height: 44px; max-width: none; font-size: 13px; }
  .studio-model-dialog { width: calc(100vw - 16px); max-width: calc(100vw - 16px); height: calc(100dvh - 24px); max-height: calc(100dvh - 24px); }
  .model-dialog-header { padding: 8px 12px; }
  .model-source { padding: 0 12px 8px; gap: 4px 12px; flex-wrap: wrap; }
  .source-selector { flex-basis: 100%; }
  .model-dialog-body { display: flex; flex-direction: column; gap: 8px; padding: 0 12px 12px; }
  .model-categories { flex-direction: row; overflow-x: auto; overflow-y: hidden; }
  .model-categories > button { gap: 8px; white-space: nowrap; }
  .model-search-row { gap: 6px; }
  .model-option { gap: 8px; padding: 10px 4px; min-height: 76px; }
  .model-option > img { width: 26px; height: 26px; }
  .model-row { grid-template-columns: minmax(0, 1fr) 36px 36px; padding-right: 0; }
  .model-settings { grid-template-columns: minmax(0, 1fr); }
}
</style>
