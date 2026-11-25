<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId } from 'vue'
import { ArrowLeft, Bot, Check, Download, Pencil, RotateCcw, Save, Search, X } from '@lucide/vue'
import { api, errorMessage, notify, session } from '../state'
import type { CreationGroup, CreationModel } from '../native-studio'
import { imageModelSettingSchema, modelApiFormats, modelTypesSchema, textModelSettingSchema, type ModelApiFormat, type ModelTypeSetting } from '../../shared/studio/model-types'
import { usesGeminiImageChat } from '../../shared/studio/image-params'
import { kindLabels, searchModels } from '../../shared/studio/model-catalog'
import ContentSkeleton from './ContentSkeleton.vue'

const props = defineProps<{ confirmLeave: () => boolean | Promise<boolean> }>()
type Draft = ModelTypeSetting & { tagsInput: string; resolutionInput: string; durationInput: string; defaultDurationInput: string | number; referenceImagesInput: string | number; referenceVideosInput: string | number; referenceAudiosInput: string | number; ratioInput: string; sizesInput: string; unsupportedInput: string; resolutionValuesInput: string }
type Row = CreationModel & { available: boolean; setting?: ModelTypeSetting }
const models = ref<CreationModel[]>([]), settings = ref<ModelTypeSetting[]>([])
const groups = ref<CreationGroup[]>([]), groupFilter = ref('')
const loading = ref(true), pulling = ref(false), busy = ref(false), loaded = ref(false)
const error = ref(''), catalogError = ref(''), version = ref(''), query = ref('')
const source = ref('all'), kindFilter = ref('all'), selectedId = ref('')
const draft = ref<Draft | null>(null), baseline = ref(''), saved = ref(false)
const editorHeading = ref<HTMLElement>(), resetDialog = ref<HTMLDialogElement>(), validationError = ref<HTMLElement>()
const groupFilterId = useId()
const owner = session.user?.id, account = session.user?.accountId || owner
let active = true
const controller = new AbortController()
const current = () => active && session.user?.id === owner && session.user?.isAdmin
const apiFormatNames: Record<ModelApiFormat, string> = { auto: '自动识别', 'chat-completions': 'Chat Completions', responses: 'Responses', gemini: 'Gemini 原生', claude: 'Claude', images: 'Images', openai: 'OpenAI 视频' }
const imageResolutions = imageModelSettingSchema.shape.autoResolution.unwrap().options
const imageQualities = imageModelSettingSchema.shape.autoQuality.unwrap().options
const imageBackgrounds = imageModelSettingSchema.shape.autoBackground.unwrap().options
const reasoningEfforts = textModelSettingSchema.shape.autoReasoningEffort.unwrap().options
const levelNames = { auto: '沿用上游', low: '低', medium: '中', high: '高', xhigh: '更高', max: '最高', ultra: '超高' }
const backgroundNames = { auto: '沿用上游', opaque: '不透明', transparent: '透明' }
const rows = computed<Row[]>(() => {
  const configured = new Map(settings.value.map(item => [item.id, item]))
  const available = new Set(models.value.map(item => item.id))
  const entries: Row[] = [
    ...models.value.map(item => ({ ...item, available: true, setting: configured.get(item.id) })),
    ...settings.value.filter(item => !available.has(item.id)).map(item => ({ id: item.id, available: false, setting: item })),
  ]
  return entries.map(item => ({ ...item, name: item.setting?.name || item.name || item.id, tags: item.setting?.tags || item.tags }))
})
const visibleRows = computed(() => searchModels(rows.value, query.value).filter(item =>
  (source.value !== 'available' || item.available) && (source.value !== 'configured' || item.setting)
  && (kindFilter.value === 'all' || rowKind(item) === kindFilter.value)
  && (!groupFilter.value || item.groups?.includes(groupFilter.value))))
const selected = computed(() => rows.value.find(item => item.id === selectedId.value))
const configured = computed(() => settings.value.some(item => item.id === selectedId.value))
const dirty = computed(() => !!draft.value && JSON.stringify(draft.value) !== baseline.value)
defineExpose({ hasUnsavedChanges: dirty, busy })
const geminiImage = computed(() => draft.value?.kind === 'image' && usesGeminiImageChat(draft.value.id, draft.value.apiFormat))
function rowKind(item: Row) { return item.setting?.kind || item.configuredKind || item.kinds?.[0] }
function groupName(id: string) { return groups.value.find(item => item.id === id)?.name || id }
function edit(item: Row) {
  const setting = item.setting || { id: item.id, kind: rowKind(item) || 'text' }
  const video = setting.video || (!item.setting ? item.video : undefined)
  draft.value = { ...setting, tagsInput: setting.tags?.join(', ') || '',
    resolutionInput: video?.resolutions?.join(', ') || '',
    durationInput: video?.durations?.join(', ') || '', defaultDurationInput: video?.autoDuration?.toString() || '',
    referenceImagesInput: (setting.kind === 'image' ? setting.image : video)?.maxReferenceImages ?? '',
    referenceVideosInput: video?.maxReferenceVideos ?? '', referenceAudiosInput: video?.maxReferenceAudios ?? '',
    ratioInput: video?.aspectRatios?.join(', ') || '', sizesInput: video?.sizes ? JSON.stringify(video.sizes, null, 2) : '',
    unsupportedInput: video?.unsupportedParameters?.join(', ') || '',
    resolutionValuesInput: video?.resolutionValues ? JSON.stringify(video.resolutionValues, null, 2) : '',
    ...(setting.kind === 'image' ? { image: { ...setting.image } } : {}),
    ...(setting.kind === 'video' ? { video: video ? JSON.parse(JSON.stringify(video)) : {} } : {}),
    ...(setting.kind === 'text' ? { text: { ...setting.text } } : {}),
  }
  baseline.value = JSON.stringify(draft.value); saved.value = false; error.value = ''
}
async function choose(item: Row) {
  if (busy.value || item.id === selectedId.value || !await props.confirmLeave() || !current()) return
  selectedId.value = item.id; edit(item)
  await nextTick(); editorHeading.value?.focus()
}
async function back() {
  if (busy.value || !await props.confirmLeave() || !current()) return
  const id = selectedId.value
  selectedId.value = ''; draft.value = null; error.value = ''
  await nextTick()
  document.getElementById(`configure-model-${encodeURIComponent(id)}`)?.focus()
}
async function pull() {
  pulling.value = true; catalogError.value = ''
  try {
    const result = await api<{ items: CreationModel[]; groups: CreationGroup[] }>('/api/creation/models?management=1', {
      expectedAccount: account, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20000)]),
    })
    if (!current()) return
    if (!Array.isArray(result.items) || !Array.isArray(result.groups)) throw new Error('模型列表返回无效，请重新拉取。')
    const nextGroups = new Map(result.groups.filter(item => item && typeof item.id === 'string'
      && item.id.length > 0 && item.id.length <= 128 && item.id.trim() === item.id
      && !/[\u0000-\u001f\u007f]/u.test(item.id)).map(item => [item.id, { id: item.id,
      name: typeof item.name === 'string' && item.name.trim() ? item.name.trim().slice(0, 128) : item.id }]))
    const nextModels = new Map<string, CreationModel>()
    for (const item of result.items) {
      if (!item || typeof item.id !== 'string' || item.id.trim() !== item.id || !item.id.length
        || item.id.length > 200 || /[\u0000-\u001f\u007f]/u.test(item.id)) continue
      const previous = nextModels.get(item.id)
      const itemGroups = Array.isArray(item.groups) ? item.groups.filter(id => nextGroups.has(id)) : []
      nextModels.set(item.id, { ...(previous || item), groups: [...new Set([...(previous?.groups || []), ...itemGroups])] })
    }
    groups.value = [...nextGroups.values()]; models.value = [...nextModels.values()]
    if (groupFilter.value && !nextGroups.has(groupFilter.value)) groupFilter.value = ''
  } catch (cause) { if (current()) catalogError.value = errorMessage(cause) }
  finally { if (current()) pulling.value = false }
}
async function load() {
  loading.value = true; error.value = ''
  try {
    const result = await api<{ items: ModelTypeSetting[]; version: string }>('/api/admin/models', { signal: controller.signal })
    if (!current()) return
    const parsed = modelTypesSchema.safeParse(result.items)
    if (!result.version || !parsed.success) throw new Error('模型配置读取失败，请刷新后重试。')
    settings.value = parsed.data; version.value = result.version; loaded.value = true
    await pull()
    const item = selected.value
    if (item) edit(item)
    else { selectedId.value = ''; draft.value = null }
  } catch (cause) { if (current()) error.value = errorMessage(cause) }
  finally { if (current()) loading.value = false }
}
async function refresh() {
  if (busy.value || loading.value || pulling.value || !await props.confirmLeave() || !current()) return
  await load()
}
function setOption<T extends object, K extends keyof T>(item: T, key: K, event: Event) {
  const value = (event.target as HTMLSelectElement).value
  if (value === 'auto') delete item[key]
  else item[key] = value as T[K]
}
function changeApi(event: Event) {
  if (!draft.value) return
  setOption(draft.value, 'apiFormat', event)
  if (geminiImage.value && draft.value.protocol === 'async') delete draft.value.protocol
}
function changeKind() {
  const item = draft.value
  if (!item) return
  if (item.apiFormat && item.apiFormat !== 'auto' && !(modelApiFormats[item.kind] as readonly string[]).includes(item.apiFormat)) delete item.apiFormat
  if (item.kind === 'text') { item.text ||= {}; delete item.protocol } else delete item.text
  if (item.kind === 'image') item.image ||= {}; else delete item.image
  item.referenceImagesInput = ''; item.referenceVideosInput = ''; item.referenceAudiosInput = ''
  if (item.kind === 'video') item.video ||= {}; else {
    delete item.video
    item.resolutionInput = ''; item.durationInput = ''; item.defaultDurationInput = ''; item.ratioInput = ''; item.sizesInput = ''; item.unsupportedInput = ''; item.resolutionValuesInput = ''
  }
  if (geminiImage.value && item.protocol === 'async') delete item.protocol
}
function normalized(): ModelTypeSetting {
  const item = draft.value!
  const image = item.kind === 'image' ? { ...item.image } : undefined
  const text = item.kind === 'text' ? { ...item.text } : undefined
  const video = item.kind === 'video' ? { ...item.video } : undefined
  const references = image || video
  if (references) {
    if (String(item.referenceImagesInput).trim()) references.maxReferenceImages = Number(item.referenceImagesInput)
    else delete references.maxReferenceImages
  }
  if (video) {
    if (String(item.referenceVideosInput).trim()) video.maxReferenceVideos = Number(item.referenceVideosInput)
    else delete video.maxReferenceVideos
    if (String(item.referenceAudiosInput).trim()) video.maxReferenceAudios = Number(item.referenceAudiosInput)
    else delete video.maxReferenceAudios
  }
  for (const options of [image, video]) {
    if (!options) continue
    const ratio = options.autoAspectRatio?.trim().toLowerCase()
    if (ratio) options.autoAspectRatio = ratio; else delete options.autoAspectRatio
  }
  if (video) {
    const automatic = video.autoResolution?.trim().toLowerCase()
    if (automatic) video.autoResolution = automatic; else delete video.autoResolution
    if (item.resolutionInput.trim()) video.resolutions = item.resolutionInput.toLowerCase().split(/[\s,，]+/u).filter(Boolean)
    else delete video.resolutions
    if (item.durationInput.trim()) video.durations = item.durationInput.split(/[\s,，]+/u).filter(Boolean).map(Number)
    else delete video.durations
    const resolutionsChanged = JSON.stringify(video.resolutions) !== JSON.stringify(item.video?.resolutions)
    const durationsChanged = JSON.stringify(video.durations) !== JSON.stringify(item.video?.durations)
    if (video.modes && (resolutionsChanged || durationsChanged)) {
      video.modes = Object.fromEntries(Object.entries(video.modes).flatMap(([mode, limits]) => {
        const next = { ...limits }
        if (resolutionsChanged) delete next.resolutions
        if (durationsChanged) delete next.durations
        return Object.keys(next).length ? [[mode, next]] : []
      }))
      if (!Object.keys(video.modes).length) delete video.modes
    }
    if (String(item.defaultDurationInput).trim()) video.autoDuration = Number(item.defaultDurationInput)
    else delete video.autoDuration
    if (item.ratioInput.trim()) video.aspectRatios = item.ratioInput.split(/[\s,，]+/u).filter(Boolean)
    else delete video.aspectRatios
    if (item.sizesInput.trim()) video.sizes = JSON.parse(item.sizesInput)
    else delete video.sizes
    if (item.resolutionValuesInput.trim()) video.resolutionValues = JSON.parse(item.resolutionValuesInput)
    else delete video.resolutionValues
    if (item.unsupportedInput.trim()) video.unsupportedParameters = item.unsupportedInput.split(/[\s,，]+/u).filter(Boolean)
    else delete video.unsupportedParameters
  }
  const name = item.name?.trim(), remark = item.remark?.trim()
  const tags = item.tagsInput.split(/[,，\n]+/u).map(tag => tag.trim()).filter(Boolean)
  return { id: item.id, kind: item.kind, ...(name ? { name } : {}), ...(tags.length ? { tags } : {}),
    ...(item.apiFormat ? { apiFormat: item.apiFormat } : {}), ...(item.protocol ? { protocol: item.protocol } : {}),
    ...(remark ? { remark } : {}), ...(image && Object.keys(image).length ? { image } : {}),
    ...(text && Object.keys(text).length ? { text } : {}), ...(video && Object.keys(video).length ? { video } : {}) }
}
async function write(items: ModelTypeSetting[]) {
  busy.value = true; error.value = ''
  try {
    const result = await api<{ items: ModelTypeSetting[]; version: string }>('/api/admin/models', {
      method: 'PATCH', body: { items, version: version.value }, expectedAccount: owner, signal: controller.signal,
    })
    if (!current()) return false
    const parsed = modelTypesSchema.safeParse(result.items)
    if (!result.version || !parsed.success) throw new Error('保存结果未能确认，请保留输入并刷新核对。')
    settings.value = parsed.data; version.value = result.version
    if (selected.value) edit(selected.value)
    else { selectedId.value = ''; draft.value = null }
    saved.value = true; notify('模型配置已保存。')
    return true
  } catch (cause) {
    if (current()) error.value = (cause as { status?: number }).status === 409
      ? '模型配置已被其他管理员修改，你的输入仍保留。请先保留需要的内容，再拉取最新配置。'
      : errorMessage(cause)
    return false
  } finally { if (current()) busy.value = false }
}
async function save() {
  if (!draft.value || busy.value || !loaded.value) return
  let item: ModelTypeSetting
  try { item = normalized() }
  catch {
    error.value = '精确尺寸和分辨率映射须为有效的 JSON 对象。'
    await nextTick(); validationError.value?.focus()
    return
  }
  const next = settings.value.some(setting => setting.id === item.id)
    ? settings.value.map(setting => setting.id === item.id ? item : setting) : [...settings.value, item]
  const parsed = modelTypesSchema.safeParse(next)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]!
    error.value = issue.path.includes('tags') ? '模型标签最多 12 个，每个最多 32 字符，不能重复。'
      : issue.path.some(key => ['maxReferenceImages', 'maxReferenceVideos', 'maxReferenceAudios'].includes(String(key))) ? '参考素材上限须为整数：图片模型 0 到 16，视频模型 0 到 10；0 表示禁用。'
      : issue.path.includes('durations') || issue.path.includes('autoDuration') ? '请检查视频时长：使用 1 到 3600 的整数秒，可选值不能重复，默认值须包含在可选值中。'
      : issue.path.includes('aspectRatios') ? '请检查可选画面比例：使用 16:9 等有效比例，不能重复。'
      : issue.path.includes('sizes') ? issue.message.includes('不发送') ? issue.message : '精确尺寸须按可选分辨率和画面比例完整配置，宽高短边须匹配分辨率。'
      : issue.path.includes('resolutionValues') ? '分辨率映射须使用可选分辨率作为键，值为有效的上游参数。'
      : issue.path.includes('unsupportedParameters') ? '不支持的参数须为字母开头的字段名，只能包含字母、数字和下划线，不能重复。'
      : issue.path.includes('autoAspectRatio') ? '请检查自动画面比例：使用 auto 或 16:9 等有效比例。'
        : issue.path.includes('video') ? '请检查视频分辨率：使用 480p、720p、4k 等档位；自动值须包含在可选值中，且可选值不能重复。'
          : issue.path.includes('name') ? '显示名称最多 120 字符，不能包含控制字符。'
            : issue.path.includes('remark') ? '模型备注最多 2000 字符，不能包含控制字符。'
              : /接口|协议/u.test(issue.message) ? issue.message : '模型配置无效，请检查类型、接口与请求参数；最多可配置 500 个模型。'
    await nextTick(); validationError.value?.focus()
    return
  }
  await write(parsed.data)
}
async function reset() {
  if (busy.value || !selectedId.value || !configured.value) return
  if (await write(settings.value.filter(item => item.id !== selectedId.value))) {
    resetDialog.value?.close()
    const resetId = selectedId.value, unchangedDraft = JSON.stringify(draft.value)
    await pull()
    if (selected.value && selectedId.value === resetId && JSON.stringify(draft.value) === unchangedDraft) edit(selected.value)
  }
}
onMounted(load)
onBeforeUnmount(() => { active = false; controller.abort(); resetDialog.value?.close() })
</script>

<template>
  <section class="admin-models" :aria-busy="loading || pulling">
    <header class="section-heading model-heading">
      <div><h2>模型管理</h2><p class="form-note">账号中心模型 · 全部授权分组</p></div>
      <button type="button" class="button subtle btn" :disabled="loading || pulling || busy" @click="refresh"><Download :size="16" aria-hidden="true" />{{ pulling ? '正在拉取…' : '拉取模型' }}</button>
    </header>
    <p v-if="catalogError" class="notice-inline" role="alert">{{ catalogError }}<button type="button" class="text-link" :disabled="pulling || busy" @click="pull">重新拉取</button></p>
    <p v-if="error && !draft" class="notice-inline" role="alert">{{ error }}<button v-if="!loaded" type="button" class="text-link" :disabled="loading" @click="load">重试</button></p>
    <ContentSkeleton v-if="loading" layout="rows" label="正在读取模型…" />
    <template v-else-if="loaded">
      <div class="model-toolbar">
        <label class="search-control model-search"><Search :size="16" aria-hidden="true" /><input v-model="query" type="search" aria-label="搜索模型" placeholder="搜索名称、ID 或标签" maxlength="200" /></label>
        <label class="field model-group-filter" :for="groupFilterId"><span class="sr-only">筛选模型分组</span><select :id="groupFilterId" v-model="groupFilter" class="control"><option value="">全部分组</option><option v-for="group in groups" :key="group.id" :value="group.id">{{ group.name }}</option></select></label>
        <label class="field"><span class="sr-only">筛选模型类型</span><select v-model="kindFilter" class="control"><option value="all">全部类型</option><option value="text">对话</option><option value="image">生图</option><option value="video">视频</option></select></label>
        <label class="field"><span class="sr-only">筛选模型来源</span><select v-model="source" class="control"><option value="all">全部模型</option><option value="available">授权目录内</option><option value="configured">已配置</option></select></label>
        <span class="model-count">{{ models.length }} 个模型 · {{ groups.length }} 个分组 · {{ settings.length }} 个已配置</span>
      </div>
      <div class="model-workspace" :class="{ 'is-editing': draft }">
        <div class="model-catalog">
          <div v-if="visibleRows.length" class="table-wrap model-table-wrap" role="region" aria-label="账号中心模型列表" tabindex="0">
            <table class="data-table model-table">
              <caption class="sr-only">账号中心模型与后台配置</caption>
              <thead><tr><th scope="col">模型</th><th scope="col">类型</th><th scope="col">配置</th><th scope="col">操作</th></tr></thead>
              <tbody><tr v-for="item in visibleRows" :key="item.id" :class="{ 'is-selected': selectedId === item.id }">
                <th scope="row"><strong>{{ item.name }}</strong><code v-if="item.name !== item.id">{{ item.id }}</code><small v-if="item.groups?.length" class="model-groups">分组：{{ item.groups.map(groupName).join('、') }}</small><span v-if="item.tags?.length" class="model-tags"><span v-for="tag in item.tags" :key="tag">{{ tag }}</span></span><span v-if="!item.available" class="model-unavailable">授权目录未收录</span></th>
                <td>{{ rowKind(item) ? kindLabels[rowKind(item)!] : '待识别' }}</td>
                <td><span>{{ item.setting ? '已配置' : '自动识别' }}</span><small>{{ apiFormatNames[item.setting?.apiFormat || 'auto'] }}</small></td>
                <td><button :id="`configure-model-${encodeURIComponent(item.id)}`" type="button" class="icon-button" :aria-label="'配置：' + item.id" title="配置模型" :aria-pressed="selectedId === item.id" :disabled="busy" @click="choose(item)"><Pencil :size="17" aria-hidden="true" /></button></td>
              </tr></tbody>
            </table>
          </div>
          <div v-else class="empty-state"><Bot :size="28" aria-hidden="true" /><h3>{{ query || groupFilter || source !== 'all' || kindFilter !== 'all' ? '没有匹配的模型' : catalogError ? '模型列表暂不可用' : '授权目录暂无模型' }}</h3><button v-if="query || groupFilter || source !== 'all' || kindFilter !== 'all'" type="button" class="button btn" @click="query = ''; groupFilter = ''; source = 'all'; kindFilter = 'all'">清除筛选</button></div>
        </div>
        <form v-if="draft" class="model-editor" @submit.prevent="save">
          <div class="model-editor-heading"><button type="button" class="icon-button" aria-label="返回模型列表" title="返回模型列表" :disabled="busy" @click="back"><ArrowLeft :size="18" aria-hidden="true" /></button><h3 ref="editorHeading" tabindex="-1">模型配置</h3><span v-if="configured" class="form-note">已配置</span></div>
          <div class="model-editor-id"><span>模型 ID</span><code>{{ draft.id }}</code></div>
          <p v-if="selected && !selected.available" class="form-note">授权目录未收录，已保存的配置继续保留。</p>
          <fieldset class="fieldset model-fields" :disabled="busy">
            <label class="field"><span>显示名称</span><input v-model="draft.name" class="control" maxlength="120" :placeholder="selected?.name || draft.id" /></label>
            <div class="model-field-pair">
              <label class="field"><span>模型类型</span><select v-model="draft.kind" class="control" @change="changeKind"><option value="text">对话</option><option value="image">生图</option><option value="video">视频</option></select></label>
              <label class="field"><span>接口格式</span><select :value="draft.apiFormat || 'auto'" class="control" @change="changeApi"><option value="auto">自动识别</option><option v-for="format in modelApiFormats[draft.kind]" :key="format" :value="format">{{ apiFormatNames[format] }}</option></select></label>
            </div>
            <label class="field"><span>模型标签</span><input v-model="draft.tagsInput" class="control" maxlength="512" placeholder="如 绘图, 高画质" aria-describedby="model-tags-help" /></label>
            <p id="model-tags-help" class="form-note">逗号分隔，最多 12 个；在前台模型列表中展示。</p>
            <label v-if="draft.kind !== 'text'" class="field"><span>任务协议</span><select :value="draft.protocol || 'auto'" class="control" @change="setOption(draft, 'protocol', $event)"><option value="auto">沿用默认</option><option value="sync">同步返回</option><option value="async" :disabled="geminiImage">异步任务</option></select></label>
            <section class="model-parameters">
              <h4>请求参数</h4><p class="form-note">前台使用“自动”时采用这里的默认值；手动选择优先。</p>
              <div v-if="draft.kind === 'text' && draft.text" class="model-field-pair">
                <label class="field"><span>自动推理强度</span><select :value="draft.text.autoReasoningEffort || 'auto'" class="control" @change="setOption(draft.text, 'autoReasoningEffort', $event)"><option v-for="effort in reasoningEfforts" :key="effort" :value="effort">{{ levelNames[effort] }}{{ effort === 'auto' ? '' : ' · ' + effort }}</option></select></label>
              </div>
              <fieldset v-if="draft.kind === 'image' && draft.image" class="fieldset model-field-pair" :disabled="geminiImage && draft.apiFormat !== 'gemini'">
                <legend class="sr-only">图片自动参数</legend>
                <label class="field"><span>自动分辨率</span><select :value="draft.image.autoResolution || 'auto'" class="control" @change="setOption(draft.image, 'autoResolution', $event)"><option v-for="resolution in imageResolutions" :key="resolution" :value="resolution">{{ resolution === 'auto' ? '沿用上游' : resolution.toUpperCase() }}</option></select></label>
                <label class="field"><span>自动画质</span><select :value="draft.image.autoQuality || 'auto'" class="control" :disabled="draft.apiFormat === 'gemini'" @change="setOption(draft.image, 'autoQuality', $event)"><option v-for="quality in imageQualities" :key="quality" :value="quality">{{ levelNames[quality] }}{{ quality === 'auto' ? '' : ' · ' + quality }}</option></select></label>
                <label class="field"><span>自动画面比例</span><input v-model="draft.image.autoAspectRatio" class="control" maxlength="7" placeholder="auto 或 16:9" /></label>
                <label class="field"><span>自动背景</span><select :value="draft.image.autoBackground || 'auto'" class="control" :disabled="draft.apiFormat === 'gemini'" @change="setOption(draft.image, 'autoBackground', $event)"><option v-for="background in imageBackgrounds" :key="background" :value="background">{{ backgroundNames[background] }}</option></select></label>
              </fieldset>
              <p v-if="geminiImage && draft.apiFormat !== 'gemini'" class="form-note">图片对话接口的尺寸、画质和背景由上游决定。</p>
              <fieldset v-if="draft.kind !== 'text'" class="fieldset model-reference-limits">
                <legend class="sr-only">参考素材数量</legend>
                <div class="model-field-pair">
                  <label class="field"><span>参考图片上限</span><input v-model="draft.referenceImagesInput" class="control" type="number" min="0" :max="draft.kind === 'image' ? 16 : 10" step="1" aria-describedby="model-reference-limits-help" /></label>
                  <label v-if="draft.kind === 'video'" class="field"><span>参考视频上限</span><input v-model="draft.referenceVideosInput" class="control" type="number" min="0" max="10" step="1" aria-describedby="model-reference-limits-help" /></label>
                  <label v-if="draft.kind === 'video'" class="field"><span>参考音频上限</span><input v-model="draft.referenceAudiosInput" class="control" type="number" min="0" max="10" step="1" aria-describedby="model-reference-limits-help" /></label>
                </div>
                <p id="model-reference-limits-help" class="form-note">留空使用默认，0 禁用；{{ draft.kind === 'image' ? '参考图片合计最多 16 张。' : '参考素材合计最多 10 个，视频超分最多 1 个源视频。' }}</p>
              </fieldset>
              <template v-if="draft.kind === 'video' && draft.video">
                <div class="model-field-pair">
                  <label class="field"><span>视频处理</span><select :value="draft.video.operation || 'generate'" class="control" @change="draft.video.operation = ($event.target as HTMLSelectElement).value as 'generate' | 'upscale'"><option value="generate">视频生成</option><option value="upscale">视频超分</option></select></label>
                  <label class="check-field"><input :checked="draft.video.sendSize !== false" type="checkbox" @change="draft.video.sendSize = ($event.target as HTMLInputElement).checked" />发送尺寸</label>
                  <label class="field"><span>自动分辨率</span><input v-model="draft.video.autoResolution" class="control" maxlength="16" placeholder="auto 或 720p" /></label>
                  <label class="field"><span>可选分辨率</span><input v-model="draft.resolutionInput" class="control" maxlength="256" placeholder="480p, 720p, 1080p" /></label>
                  <label class="field"><span>默认时长（秒）</span><input v-model="draft.defaultDurationInput" class="control" type="number" min="1" max="3600" step="1" /></label>
                  <label class="field"><span>可选时长（秒）</span><input v-model="draft.durationInput" class="control" maxlength="20000" placeholder="5, 10, 15" /></label>
                  <label class="field"><span>自动画面比例</span><input v-model="draft.video.autoAspectRatio" class="control" maxlength="7" placeholder="auto 或 16:9" /></label>
                  <label class="field"><span>可选画面比例</span><input v-model="draft.ratioInput" class="control" maxlength="256" placeholder="16:9, 9:16" /></label>
                  <label class="field"><span>视频参数格式</span><select :value="draft.video.parameterFormat || 'auto'" class="control" @change="setOption(draft.video, 'parameterFormat', $event)"><option value="auto">自动识别</option><option value="openai">OpenAI</option><option value="xai">xAI</option><option value="seedance">Seedance</option><option value="gemini">Gemini</option></select></label>
                  <label class="field"><span>不支持的参数</span><input v-model="draft.unsupportedInput" class="control" maxlength="2200" placeholder="frame_rate" /></label>
                </div>
                <p class="form-note">可选值以逗号分隔；留空时使用默认配置。</p>
                <label class="field"><span>精确尺寸 JSON</span><textarea v-model="draft.sizesInput" class="control" rows="6" maxlength="20000" spellcheck="false" aria-describedby="model-video-sizes-help" /></label>
                <p id="model-video-sizes-help" class="form-note">按分辨率和比例填写，例如 {"720p":{"16:9":"1280x720"}}；留空时使用后台默认尺寸规则。</p>
                <label class="field"><span>分辨率映射 JSON</span><textarea v-model="draft.resolutionValuesInput" class="control" rows="3" maxlength="2000" spellcheck="false" aria-describedby="model-video-resolution-values-help" /></label>
                <p id="model-video-resolution-values-help" class="form-note">例如 {"720p":"tier_720p"}；留空时发送可选分辨率原值。</p>
              </template>
            </section>
            <label class="field"><span>备注</span><textarea v-model="draft.remark" class="control" rows="3" maxlength="2000" aria-describedby="model-remark-help" /></label>
            <p id="model-remark-help" class="form-note">仅管理员可见。</p>
          </fieldset>
          <p v-if="error" ref="validationError" class="form-error" role="alert" tabindex="-1">{{ error }}</p>
          <footer class="model-savebar">
            <span class="form-note" role="status">{{ dirty ? '有未保存的修改' : saved ? '已保存' : configured ? '配置已生效' : '使用自动识别' }}<Check v-if="!dirty && saved" :size="14" aria-hidden="true" /></span>
            <button v-if="configured" type="button" class="icon-button" aria-label="恢复自动识别" title="恢复自动识别" :disabled="busy" @click="resetDialog?.showModal()"><RotateCcw :size="17" aria-hidden="true" /></button>
            <button type="submit" class="button primary btn" :disabled="busy || !dirty"><Save :size="16" aria-hidden="true" />{{ busy ? '正在保存…' : '保存模型配置' }}</button>
          </footer>
        </form>
        <div v-else class="model-no-selection"><Bot :size="28" aria-hidden="true" /><p>选择模型进行配置</p></div>
      </div>
    </template>
    <dialog ref="resetDialog" class="compact-dialog" aria-labelledby="reset-model-heading" @cancel="busy && $event.preventDefault()">
      <div class="dialog-heading"><h2 id="reset-model-heading">恢复自动识别？</h2><button type="button" class="icon-button" aria-label="关闭恢复提示" :disabled="busy" @click="resetDialog?.close()"><X :size="20" aria-hidden="true" /></button></div>
      <div class="dialog-body stack"><p>清除 {{ selectedId }} 的后台配置。模型仍保留在账号中心，其他模型配置不受影响。</p><p v-if="error" class="form-error" role="alert">{{ error }}</p><div class="table-actions"><button type="button" class="button subtle btn" :disabled="busy" autofocus @click="resetDialog?.close()">取消</button><button type="button" class="button primary btn" :disabled="busy" @click="reset">确认恢复</button></div></div>
    </dialog>
  </section>
</template>

<style scoped>
.admin-models { container-type: inline-size; }
.fieldset { border: 0; padding: 0; margin: 0; min-width: 0; }
.model-heading { align-items: center; gap: 16px; margin-bottom: 24px; }
.model-heading h2 { font-size: 20px; font-weight: 500; }
.model-heading .form-note { margin-top: 8px; }
.model-heading .button { flex-shrink: 0; }
.model-toolbar { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-bottom: 20px; }
.model-search { flex: 1; min-width: 180px; min-height: 44px; }
.model-toolbar > .field { min-width: 132px; }
.model-group-filter { max-width: 240px; }
.model-group-filter .control { min-width: 0; max-width: 100%; }
.model-count { width: 100%; font-size: 12px; color: var(--muted); }
.model-workspace { display: grid; grid-template-columns: minmax(0, 1fr) minmax(320px, 1fr); gap: 24px; align-items: start; }
.model-catalog { min-width: 0; }
.model-table-wrap { max-height: 720px; overflow: auto; container-type: inline-size; }
.model-table { width: 100%; min-width: 380px; table-layout: fixed; }
.model-table th { font-weight: 500; }
.model-table thead { position: sticky; top: 0; z-index: 1; background: var(--canvas); }
.model-table thead th:first-child { width: 44%; }
.model-table thead th:last-child { width: 56px; }
.model-table tbody th { text-align: left; white-space: normal; overflow-wrap: anywhere; background: transparent; color: var(--ink); font-size: 14px; }
.model-table tbody th > strong, .model-table code, .model-table td small { display: block; }
.model-table tbody th > strong { font-weight: 500; }
.model-table code, .model-table td small, .model-unavailable, .model-groups { margin-top: 4px; color: var(--muted); font-size: 12px; }
.model-table :is(th, td) { padding: 12px 8px; vertical-align: middle; }
.model-table td:last-child { padding: 4px; }
.model-table .icon-button { width: 44px; height: 44px; }
.model-table tr.is-selected { background: var(--state-selected); }
.model-table tr:hover { background: var(--state-hover); }
.model-table tr.is-selected:hover { background: var(--state-pressed); }
.model-table tr:is(:hover, .is-selected) :is(code, small, .model-unavailable) { color: var(--ink); }
.model-tags { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 8px; }
.model-tags > span { padding: 2px 6px; border-radius: 4px; background: var(--surface-soft); color: var(--ink); font-size: 12px; font-weight: 400; }
.model-unavailable, .model-groups { display: block; }
.model-editor { min-width: 0; padding-left: 24px; border-left: 1px solid var(--border); }
.model-editor-heading { display: flex; align-items: center; gap: 8px; margin-bottom: 20px; }
.model-editor-heading h3 { font-size: 18px; font-weight: 500; }
.model-editor-heading > .form-note { margin-left: auto; }
.model-editor-heading .icon-button { width: 44px; height: 44px; }
.model-editor-id { display: grid; gap: 8px; margin-bottom: 20px; }
.model-editor-id > span { color: var(--muted); font-size: 12px; }
.model-editor-id code { overflow-wrap: anywhere; font-size: 14px; }
.model-fields { display: grid; gap: 16px; }
.model-field-pair { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; align-items: start; }
.model-field-pair > *, .model-fields > * { min-width: 0; }
.check-field { display: flex; align-items: center; gap: 8px; min-height: 44px; font-size: 14px; }
.model-parameters { display: grid; gap: 16px; padding-top: 20px; border-top: 1px solid var(--border); }
.model-parameters h4 { font-size: 14px; font-weight: 500; }
.model-parameters .form-note { margin: 0; }
.model-reference-limits { display: grid; gap: 12px; }
.model-fields textarea { min-height: 96px; resize: vertical; }
.model-savebar { display: flex; align-items: center; gap: 8px; padding-block: 16px; margin-top: 16px; flex-wrap: wrap; }
.model-savebar > span { flex: 1; display: flex; align-items: center; gap: 4px; }
.model-savebar .icon-button { width: 44px; height: 44px; }
.model-no-selection { display: grid; justify-items: center; gap: 12px; color: var(--muted); padding: 64px 24px; border-left: 1px solid var(--border); font-size: 14px; }
.notice-inline { margin-bottom: 20px; }
.notice-inline .text-link { margin-left: 12px; }
.form-error { margin-top: 16px; overflow-wrap: anywhere; }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; border: 0; }
@container (max-width: 760px) {
  .model-workspace { grid-template-columns: minmax(0, 1fr); }
  .model-workspace.is-editing > .model-catalog, .model-no-selection { display: none; }
  .model-editor { border-left: 0; padding-left: 0; }
  .model-toolbar { gap: 8px; }
  .model-search { flex-basis: 100%; }
  .model-toolbar > .field { flex: 1; min-width: 0; }
  .model-toolbar > .model-group-filter { flex-basis: 100%; max-width: none; }
  .model-table-wrap { max-height: none; }
  .model-table { min-width: 320px; }
}
@container (max-width: 400px) {
  .model-field-pair { grid-template-columns: minmax(0, 1fr); }
  .model-savebar > span { flex-basis: 100%; }
  .model-savebar > .button { margin-left: auto; }
}
</style>
