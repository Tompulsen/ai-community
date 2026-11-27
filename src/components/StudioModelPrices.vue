<!-- Adapted from octopus_chat account-model-pricing.tsx / .module.scss (MIT). -->
<script setup lang="ts">
import { combineAbortSignals } from '../abort-signals'
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Image, LayoutGrid, MessageSquare, RefreshCw, Search, Video } from '@lucide/vue'
import { api, errorMessage, session } from '../state'
import { studioAccount } from '../studio-account'
import { creation, initializeCreation, loadCreationGroups, loadCreationModels, selectCreationGroup, waitCreationGroup, type CreationModel } from '../native-studio'
import { chats, createEmptyChat, loadChats, saveChats } from '../native-chat'
import { modelChoices, modelKind } from '../model-preferences'
import { selectedModelPrices } from '../studio-billing'
import type { ModelPriceRow, ModelPricing } from '../../server/native-account/pricing'
import StudioModelPriceCard from './StudioModelPriceCard.vue'

const props = withDefaults(defineProps<{ model?: string; standalone?: boolean }>(), { model: '' })
const emit = defineEmits<{ launched: [] }>()
const route = useRoute(), router = useRouter(), launching = ref(''), launchError = ref('')
const data = ref<ModelPricing>(), error = ref(''), query = ref(''), loading = ref(false)
const catalogue = ref<CreationModel[]>(), catalogueError = ref(''), catalogueLoading = ref(false)
const filters = [
  { id: 'all', label: '全部', icon: LayoutGrid }, { id: 'text', label: '文本', icon: MessageSquare },
  { id: 'image', label: '图片', icon: Image }, { id: 'video', label: '视频', icon: Video },
] as const
const kind = ref<typeof filters[number]['id']>('all')
let revision = 0
let request: AbortController | undefined
async function load() {
  const current = ++revision, owner = session.user?.id, accountId = session.user?.accountId || owner
  request?.abort()
  const controller = request = new AbortController()
  data.value = undefined; catalogue.value = undefined; error.value = ''; catalogueError.value = ''
  if (!owner) { loading.value = false; catalogueLoading.value = false; return }
  const valid = () => current === revision && owner === session.user?.id && accountId === (session.user?.accountId || session.user?.id)
  loading.value = true; catalogueLoading.value = true
  const combined = combineAbortSignals([controller.signal, AbortSignal.timeout(20000)])
  await Promise.all([
      loadCreationGroups(),
      studioAccount<ModelPricing>('model-pricing', 'GET', undefined, controller.signal).then(result => {
        if (!valid()) return
        if (result.userId !== Number(accountId)) throw new Error('账号已变化，请刷新价格。')
        if (!Array.isArray(result.rows)) throw new Error('模型价格数据不可用。')
        data.value = result
      }).catch(cause => { if (valid()) error.value = errorMessage(cause) })
        .finally(() => { if (valid()) loading.value = false }),
      api<{ items: CreationModel[] }>('/api/creation/models?scope=all', {
        expectedAccount: accountId, signal: combined.signal,
      }).then(value => {
        if (!valid()) return
        if (!Array.isArray(value.items)) throw new Error('模型分类数据不可用。')
        catalogue.value = value.items
      }).catch(cause => {
        if (valid()) { catalogueError.value = errorMessage(cause); kind.value = 'all' }
      }).finally(() => { combined.dispose(); if (valid()) catalogueLoading.value = false }),
  ])
}
const models = computed(() => {
  const grouped = new Map<string, ModelPriceRow[]>()
  for (const row of [...(data.value?.rows || [])].sort((a, b) => a.model.localeCompare(b.model) || a.group.localeCompare(b.group))) {
    const group = grouped.get(row.model)
    if (group) group.push(row)
    else grouped.set(row.model, [row])
  }
  return [...grouped.entries()].sort(([a], [b]) => Number(b === props.model) - Number(a === props.model))
})
const modelKinds = computed(() => new Map(catalogue.value?.map(item => [item.id, item.configuredKind ? [item.configuredKind] : item.kinds || []])))
const catalogueModels = computed(() => new Map(catalogue.value?.map(item => [item.id, item])))
const categories = computed(() => filters.map(filter => {
  const id = filter.id
  return { ...filter, count: id === 'all' ? models.value.length : models.value.filter(([name]) => modelKinds.value.get(name)?.includes(id)).length }
}))
const rows = computed(() => models.value.filter(([name, prices]) =>
  (kind.value === 'all' || modelKinds.value.get(name)?.includes(kind.value)) &&
  `${name} ${prices.map(row => row.group).join(' ')}`.toLowerCase().includes(query.value.trim().toLowerCase())))
const missingModel = computed(() => props.model && data.value && !models.value.some(([name]) => name === props.model))
let launchRevision = 0
async function launch(row: ModelPriceRow) {
  const owner = session.user?.id, account = session.user?.accountId || owner
  if (!owner || creation.modelLaunchPending || launching.value || !catalogueModels.value.get(row.model)?.groups?.includes(row.group)) return
  const accepted = ++launchRevision, path = route.fullPath
  let previousId = chats.activeId, previousGroup = creation.selectedGroup
  const sameAccount = () => owner === session.user?.id && account === (session.user?.accountId || session.user?.id)
  const current = () => accepted === launchRevision && sameAccount() && route.fullPath === path
  let draft: ReturnType<typeof createEmptyChat> | undefined, entered = false
  let finish!: () => void
  const pending = new Promise<void>(resolve => { finish = resolve })
  launching.value = row.model; launchError.value = ''; creation.modelLaunchPending = pending
  try {
    await nextTick()
    await initializeCreation(); await loadChats()
    if (!current()) return
    if (!creation.loaded || !chats.ready) throw new Error(creation.storageError || chats.error || '创作记录尚未就绪，请稍后重试。')
    const activeId = previousId = chats.activeId
    await saveChats(true)
    if (!current() || chats.activeId !== activeId) return
    await loadCreationGroups(true)
    if (!current() || chats.activeId !== activeId) return
    await waitCreationGroup()
    if (!current() || chats.activeId !== activeId) return
    if (creation.groupsError || !creation.groups.some(item => item.id === row.group)) throw new Error('当前账号暂时无法使用此分组，请刷新模型广场后重试。')
    previousGroup = creation.selectedGroup
    await selectCreationGroup(row.group)
    if (!current() || chats.activeId !== activeId) return
    await loadCreationModels(true)
    if (!current() || chats.activeId !== activeId) return
    const model = creation.models.find(item => item.id === row.model)
    if (creation.modelsError || creation.selectedGroup !== row.group || !creation.modelsLoaded || !model) throw new Error('此分组下的模型暂不可用，请刷新模型广场后重试。')
    const targetKind = modelKind(model)
    modelChoices[targetKind] = ''
    draft = createEmptyChat(targetKind)
    Object.assign(draft, { composerKind: targetKind, draft: '', mediaDrafts: {} })
    if (targetKind === 'text') draft.textModel = row.model
    else draft.mediaDrafts = { [targetKind]: { model: row.model, prompt: '', references: [], protocol: 'auto', apiFormat: 'auto' } }
    chats.sessions.unshift(draft)
    await saveChats(true)
    if (!current() || chats.activeId !== activeId) return
    chats.activeId = draft.id
    const failure = await router.push({ path: `/create/${targetKind}`, query: { conversation: draft.id } })
    if (failure) throw new Error('未能进入工作台，请重试。')
    entered = true; emit('launched')
  } catch (cause) { if (current()) launchError.value = errorMessage(cause) }
  finally {
    try {
      if (!entered && sameAccount()) {
        // A failed launch must not leave an empty conversation or overwrite the previous draft.
        if (draft) {
          if (chats.activeId === draft.id) chats.activeId = previousId
          chats.sessions = chats.sessions.filter(item => item.id !== draft!.id)
          await saveChats(true).catch(() => {})
        }
        if (chats.activeId === previousId && previousGroup && creation.selectedGroup === row.group && creation.groups.some(item => item.id === previousGroup)) await selectCreationGroup(previousGroup)
      }
    } finally {
      if (accepted === launchRevision) launching.value = ''
      if (creation.modelLaunchPending === pending) creation.modelLaunchPending = undefined
      finish()
    }
  }
}
watch(() => [session.user?.id, session.user?.accountId], () => { launchRevision++; launching.value = ''; launchError.value = ''; query.value = ''; kind.value = 'all'; void load() }, { immediate: true })
onBeforeUnmount(() => { revision++; launchRevision++; request?.abort() })
</script>

<template>
  <section class="model-prices" aria-label="模型广场">
    <header class="prices-heading"><div><component :is="standalone ? 'h1' : 'h2'" class="prices-title">模型广场</component><p class="prices-description">按创作类型查找模型，对比价格，点击调用即可进入对应工作台。</p></div><div class="prices-toolbar">
      <label class="prices-search"><Search :size="15" aria-hidden="true" /><input v-model="query" type="search" aria-label="搜索模型价格" placeholder="搜索模型或分组" :disabled="!data" /></label>
      <button type="button" class="studio-tool" aria-label="刷新价格" title="刷新价格" :disabled="loading || catalogueLoading || Boolean(creation.modelLaunchPending)" @click="load"><RefreshCw :size="15" aria-hidden="true" /></button>
    </div></header>
    <div class="prices-filter-bar">
      <div class="prices-filters" role="group" aria-label="模型类型">
        <button v-for="filter in categories" :key="filter.id" type="button" class="prices-filter" :aria-label="`${filter.label}模型`" :aria-pressed="kind === filter.id" :disabled="!data || (filter.id !== 'all' && !catalogue)" @click="kind = filter.id">
          <component :is="filter.icon" :size="16" aria-hidden="true" /><span>{{ filter.label }}</span><span class="filter-count" aria-hidden="true">{{ data && (filter.id === 'all' || catalogue) ? filter.count : '—' }}</span>
        </button>
      </div>
      <span v-if="data" class="prices-count" role="status">{{ query.trim() || kind !== 'all' ? `${rows.length} / ` : '' }}{{ models.length }} 个模型</span>
    </div>
    <p v-if="missingModel" class="prices-state" role="status">{{ model }}：模型广场暂未提供此模型的可用价格，请查看模型详情。</p>
    <p v-if="loading" class="prices-state" role="status">正在读取模型价格…</p>
    <p v-if="creation.groupsLoading" class="prices-state" role="status">正在读取当前分组…</p>
    <div v-if="creation.groupsError" class="prices-state form-error" role="alert"><p>{{ creation.groupsError }} 以下价格按卡片标注的分组展示。</p><button type="button" class="studio-tool" @click="loadCreationGroups(true)">重试分组</button></div>
    <p v-if="launching" class="prices-state" role="status">正在准备 {{ launching }} 的工作台…</p>
    <p v-if="launchError" class="prices-state form-error" role="alert">{{ launchError }}</p>
    <div v-if="error" class="prices-state form-error" role="alert"><p>{{ error }}</p><button type="button" class="studio-tool" @click="load"><RefreshCw :size="15" />重新读取</button></div>
    <template v-if="data">
      <p v-if="catalogueLoading" class="prices-state" role="status">正在读取模型分类…</p>
      <div v-if="catalogueError" class="prices-state form-error" role="alert"><p>模型分类暂不可用，当前展示全部价格。{{ catalogueError }}</p><button type="button" class="studio-tool" @click="load">重试分类</button></div>
      <div v-if="rows.length" class="model-price-grid"><StudioModelPriceCard v-for="[name, prices] in rows" :key="name" :rows="prices" :preferred-group="selectedModelPrices(data, name, creation.selectedGroup || 'auto')[0]?.group" :featured="name === model" :catalogue-model="catalogueModels.get(name)" :catalogue-loading="catalogueLoading" :busy="Boolean(creation.modelLaunchPending)" :launching="launching === name" @launch="launch" /></div>
      <div v-else-if="kind === 'all' || !catalogueLoading" class="prices-state" role="status"><p>{{ models.length ? '当前筛选下没有匹配的模型，试试其他类型、名称或分组。' : '模型广场暂未提供可用价格。' }}</p><button v-if="models.length" type="button" class="studio-tool" @click="kind = 'all'; query = ''">查看全部模型</button></div>
      <p class="prices-note">价格已含卡片所选分组的倍率，点击调用将使用该分组。自动分组优先展示首个可用候选分组的价格，可切换分组对比；工作台自动分组的预估范围以实际路由为准。</p>
      <p class="prices-note">每次请求为单次调用价格；按量模型分别列出输入、输出价格。动态计费及图片、音频等附加费用以模型广场详情为准。</p>
    </template>
  </section>
</template>

<style scoped>
.model-prices { container-type: inline-size; min-width: 0; padding-top: 24px; color: var(--ink); font-size: 13px; line-height: 1.5; }
.prices-heading { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px 20px; margin-bottom: 20px; }
.prices-title { margin: 0; font-size: 20px; font-weight: 600; line-height: 28px; }
.prices-description { margin: 4px 0 0; color: var(--muted); font-size: 12px; }
.prices-filter-bar { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px; margin-bottom: 20px; }
.prices-filters { display: flex; flex-wrap: wrap; gap: 8px; }
.prices-filter { display: flex; align-items: center; justify-content: center; gap: 8px; min-height: 44px; padding: 8px 12px; border: 1px solid transparent; border-radius: 8px; color: var(--muted); font: inherit; }
.prices-filter:hover:not(:disabled) { background: var(--state-hover); color: var(--ink); }
.prices-filter[aria-pressed="true"] { background: var(--state-selected); border-color: var(--state-selected-border); color: var(--ink); }
.prices-filter:focus-visible { outline: 2px solid var(--blue); outline-offset: 2px; }
.filter-count { font-size: 12px; font-variant-numeric: tabular-nums; }
.prices-toolbar { display: flex; align-items: center; justify-content: flex-end; gap: 12px; min-width: 0; margin-left: auto; }
.prices-search { display: flex; align-items: center; gap: 8px; width: 200px; min-width: 0; min-height: 36px; padding: 0 10px; border-radius: 6px; background: var(--surface-soft); color: var(--muted); }
.prices-search input { width: 100%; min-width: 0; padding: 6px 0; border: 0; border-radius: 0; outline: none; background: transparent; color: var(--ink); caret-color: var(--ink); font: inherit; }
.prices-search input::placeholder { color: var(--muted); opacity: 1; }
.prices-search:focus-within { outline: 1px solid var(--muted); outline-offset: var(--focus-outline-offset); }
.prices-count { flex: none; color: var(--muted); font-size: 12px; font-variant-numeric: tabular-nums; white-space: nowrap; }
.model-price-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); align-items: stretch; gap: 16px; }
.prices-state { margin: 0; padding: 20px 0; overflow-wrap: anywhere; }
.prices-note { margin: 16px 0 0; color: var(--muted); font-size: 12px; }
@container (max-width: 800px) { .model-price-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@container (max-width: 520px) { .prices-heading { margin-bottom: 16px; }.prices-toolbar { width: 100%; gap: 8px; }.prices-search { flex: 1; width: auto; }.prices-filters { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); width: 100%; gap: 4px; }.prices-filter { gap: 4px; padding: 8px 4px; }.prices-filter > svg { display: none; }.model-price-grid { grid-template-columns: minmax(0, 1fr); } }
@media (max-width: 600px), (pointer: coarse) { .prices-toolbar > .studio-tool { min-width: 44px; min-height: 44px; }.prices-search { min-height: 44px; }.prices-search input { font-size: 16px; } }
</style>
