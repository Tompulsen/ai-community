<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Download, History, Image, LoaderCircle, Pause, Play, RefreshCw, Upload, WandSparkles, X } from '@lucide/vue'
import type { Work } from '../data'
import { errorMessage, notify, session, uploadFile } from '../state'
import { creation, downloadCreation, initializeCreation, loadCreationModels, mediaSource, publishCreation, resumeCreation, stopCreation, submitCreation, type CreationTask } from '../native-studio'

const props = defineProps<{ kind: 'text' | 'image' | 'video'; source?: Work | null }>()
const model = ref(''), prompt = ref(''), ratio = ref('1:1'), count = ref(1), duration = ref(8)
const references = ref<CreationTask['references']>([])
const uploading = ref(false), submissions = ref<Record<string, boolean>>({}), error = ref(''), showHistory = ref(true)
const submitting = computed(() => Boolean(submissions.value[props.kind]))
const publishing = ref(false), publishTitle = ref(''), publishDialog = ref<HTMLDialogElement>()
const selected = computed(() => creation.tasks.find(task => task.id === creation.selectedId && task.kind === props.kind) || creation.tasks.find(task => task.kind === props.kind))
const tasks = computed(() => creation.tasks.filter(task => task.kind === props.kind))
const models = computed(() => creation.models.filter(item => !item.kinds?.length || item.kinds.includes(props.kind)))
const working = computed(() => selected.value && ['submitting', 'running'].includes(selected.value.phase))
const size = computed(() => ratio.value === '16:9' ? '1280x720' : ratio.value === '9:16' ? '720x1280' : '1024x1024')
const phases: Record<string, string> = { submitting: '正在提交', running: '正在生成', paused: '等待已暂停', complete: '生成完成', error: '生成失败', attention: '需要核对' }
const draftKey = () => `octopus:user-${session.user?.id}:native-creation-draft:${props.kind}`
function chooseModel() { if (!models.value.some(item => item.id === model.value)) model.value = models.value[0]?.id || '' }
function loadDraft() {
  prompt.value = ''; model.value = ''; ratio.value = props.kind === 'video' ? '16:9' : '1:1'; count.value = 1; duration.value = 8; references.value = []; error.value = ''
  try {
    const saved = JSON.parse(localStorage.getItem(draftKey()) || 'null')
    if (saved && typeof saved.prompt === 'string') {
      prompt.value = saved.prompt; model.value = typeof saved.model === 'string' ? saved.model : ''
      ratio.value = ['1:1', '16:9', '9:16'].includes(saved.ratio) ? saved.ratio : ratio.value
      count.value = Math.min(4, Math.max(1, Number(saved.count) || 1)); duration.value = Math.min(30, Math.max(1, Number(saved.duration) || 8))
    }
  } catch { /* A malformed local draft does not prevent creation. */ }
  chooseModel()
}
watch(() => [props.kind, session.user?.id], loadDraft, { immediate: true })
watch(models, chooseModel)
watch([prompt, model, ratio, count, duration], () => {
  if (!session.user) return
  try { localStorage.setItem(draftKey(), JSON.stringify({ prompt: prompt.value, model: model.value, ratio: ratio.value, count: count.value, duration: duration.value })) }
  catch { creation.storageError = '当前草稿无法保存到浏览器，请保留提示词。' }
})
watch(() => props.source?.id, () => {
  if (!props.source) return
  prompt.value = props.source.prompt; model.value = props.source.model
  references.value = (props.source.referenceFiles || []).filter(file => file.type.startsWith('image/')).map(file => ({ id: file.id, url: file.url, name: file.name }))
}, { immediate: true })
watch(() => session.user?.id, async () => {
  if (!session.user) return
  await initializeCreation(); await loadCreationModels(); chooseModel()
}, { immediate: true })
async function addReferences(event: Event) {
  const input = event.target as HTMLInputElement
  const files = [...(input.files || [])]
  uploading.value = true; error.value = ''
  const owner = session.user?.id
  try {
    for (const file of files) {
      if (references.value.length >= 8) throw new Error('最多添加 8 张参考图。')
      if (!file.type.startsWith('image/')) throw new Error('参考文件请选择图片。')
      const uploaded = await uploadFile(file)
      if (owner !== session.user?.id) return
      references.value.push({ id: uploaded.id, url: uploaded.url, name: file.name })
    }
  } catch (cause) { error.value = errorMessage(cause) }
  finally { uploading.value = false; input.value = '' }
}
async function generate() {
  if (submitting.value || uploading.value) return
  const kind = props.kind
  error.value = ''; submissions.value[kind] = true
  try {
    const pending = submitCreation({ kind: props.kind, model: model.value, prompt: prompt.value, size: size.value, aspect_ratio: ratio.value, n: count.value, duration: duration.value, protocol: models.value.find(item => item.id === model.value)?.protocol || 'openai', references: references.value.map(file => ({ ...file })), sourceWorkId: props.source?.id })
    await pending
  } catch (cause) { error.value = errorMessage(cause) }
  finally { submissions.value[kind] = false }
}
async function download(task: CreationTask, index = 0) {
  try { await downloadCreation(task, index) } catch (cause) { error.value = errorMessage(cause) }
}
function openPublish() {
  if (!selected.value) return
  publishTitle.value = selected.value.prompt.slice(0, 50)
  publishDialog.value?.showModal()
}
async function publish() {
  if (!selected.value || publishing.value) return
  publishing.value = true; error.value = ''
  try {
    const result = await publishCreation(selected.value, publishTitle.value)
    publishDialog.value?.close()
    notify(result.work.status === 'pending' ? '作品已提交审核。' : '作品已发布。')
  } catch (cause) { error.value = errorMessage(cause) }
  finally { publishing.value = false }
}
function useTask(task: CreationTask) {
  creation.selectedId = task.id; model.value = task.model; prompt.value = task.prompt
  ratio.value = task.request.aspect_ratio; count.value = task.request.n; duration.value = task.request.duration
  references.value = task.references.map(file => ({ ...file }))
}
</script>

<template>
  <section class="native-studio" aria-label="创作工作台">
    <form class="creation-controls" aria-label="创作参数" @submit.prevent="generate">
      <div class="creation-section-heading"><h2>创作参数</h2><span class="caption-5">{{ kind === 'image' ? '图片' : kind === 'video' ? '视频' : '文本' }}</span></div>
      <label class="field"><span>模型</span><select v-model="model" class="control" :disabled="creation.modelsLoading || !models.length"><option v-if="!models.length" value="">{{ creation.modelsLoading ? '正在读取模型…' : '暂无可用模型' }}</option><option v-for="item in models" :key="item.id" :value="item.id">{{ item.name || item.id }}</option></select></label>
      <p v-if="creation.modelsError" class="form-error" role="alert">{{ creation.modelsError }} <button type="button" class="text-link" @click="loadCreationModels">重试</button></p>
      <label class="field prompt-field"><span>提示词</span><textarea v-model="prompt" class="control creation-prompt" rows="7" maxlength="100000" placeholder="描述你想创作的内容" required /></label>
      <template v-if="kind !== 'text'"><div class="parameter-row"><label class="field"><span>画面比例</span><select v-model="ratio" class="control"><option value="1:1">1:1</option><option value="16:9">16:9</option><option value="9:16">9:16</option></select></label><label v-if="kind === 'image'" class="field"><span>图片数量</span><input v-model.number="count" class="control" type="number" min="1" max="4" step="1" required /></label><label v-else class="field"><span>时长（秒）</span><input v-model.number="duration" class="control" type="number" min="1" max="30" step="1" required /></label></div>
      <div class="field"><span>参考图</span><label class="reference-upload button subtle btn"><Upload :size="16" />{{ uploading ? '正在上传…' : '添加图片' }}<input type="file" accept="image/jpeg,image/png,image/webp,image/gif,image/avif" multiple :disabled="uploading || references.length >= 8" @change="addReferences" /></label><ul v-if="references.length" class="reference-list"><li v-for="(file, index) in references" :key="file.url"><img :src="file.url" :alt="file.name" /><button type="button" class="icon-button" :aria-label="`移除参考图 ${index + 1}`" title="移除参考图" @click="references.splice(index, 1)"><X :size="14" /></button></li></ul></div></template>
      <p v-if="error" class="form-error" role="alert">{{ error }}</p><p v-if="creation.storageError" class="form-error" role="alert">{{ creation.storageError }}</p>
      <button class="button primary btn generation-button" :disabled="submitting || uploading || !model || !prompt.trim()"><LoaderCircle v-if="submitting" :size="17" /><WandSparkles v-else :size="17" />{{ submitting ? '正在生成…' : '开始生成' }}</button>
    </form>
    <div class="creation-output">
      <div class="creation-output-toolbar"><h2>生成结果</h2><div><button v-if="selected?.phase === 'complete'" class="button subtle btn" @click="openPublish"><Upload :size="16" />发布作品</button><button class="icon-button" aria-label="生成历史" title="生成历史" :aria-pressed="showHistory" @click="showHistory = !showHistory"><History :size="18" /></button><button class="icon-button" aria-label="刷新模型" title="刷新模型" :disabled="creation.modelsLoading" @click="loadCreationModels"><RefreshCw :size="18" /></button></div></div>
      <div class="creation-canvas" :class="{ 'has-result': selected?.phase === 'complete' }">
        <template v-if="selected"><div class="task-status" :role="selected.phase === 'error' || selected.phase === 'attention' ? 'alert' : 'status'"><div><LoaderCircle v-if="working" :size="18" /><strong>{{ phases[selected.phase] }}</strong><span v-if="selected.progress != null && selected.phase !== 'complete'" class="caption-5">{{ Math.round(selected.progress) }}%</span></div><button v-if="working" class="button subtle btn" @click="stopCreation(selected)"><Pause :size="15" />停止等待</button><button v-else-if="selected.upstreamId && selected.phase !== 'complete' && selected.phase !== 'error'" class="button subtle btn" @click="resumeCreation(selected)"><Play :size="15" />继续查询</button></div><p v-if="selected.error" class="task-message">{{ selected.error }}</p>
        <div v-if="selected.urls.length" class="creation-media"><figure v-for="(url, index) in selected.urls" :key="url"><video v-if="selected.kind === 'video'" :src="mediaSource(url, false, 'video')" controls playsinline preload="metadata" /><img v-else :src="mediaSource(url)" :alt="selected.prompt" /><figcaption><button class="button subtle btn" @click="download(selected, index)"><Download :size="16" />下载{{ selected.urls.length > 1 ? ` ${index + 1}` : '' }}</button></figcaption></figure></div><div v-else-if="selected.text" class="creation-text"><pre>{{ selected.text }}</pre><button class="button subtle btn" @click="download(selected)"><Download :size="16" />下载文本</button></div><div v-else-if="working" class="canvas-waiting"><LoaderCircle :size="28" /><p>{{ selected.phase === 'submitting' ? '正在提交生成请求' : '等待生成结果' }}</p></div></template>
        <div v-else class="canvas-empty"><Image :size="32" /><p>暂无生成结果</p></div>
      </div>
      <section v-if="showHistory" class="creation-history" aria-label="生成历史"><div class="creation-section-heading"><h3>生成历史</h3><span class="caption-5">{{ tasks.length }} 条</span></div><p v-if="!tasks.length" class="muted">暂无记录</p><button v-for="task in tasks" :key="task.id" class="history-row" :class="{ selected: selected?.id === task.id }" @click="useTask(task)"><img v-if="task.kind === 'image' && task.urls[0]" :src="mediaSource(task.urls[0], true)" alt="" loading="lazy" /><span v-else class="history-kind">{{ task.kind === 'video' ? '视频' : task.kind === 'text' ? '文本' : '图片' }}</span><span class="history-content"><strong>{{ task.prompt || task.model }}</strong><span>{{ task.model }} · {{ new Date(task.createdAt).toLocaleString('zh-CN') }}</span></span><span class="history-status">{{ phases[task.phase] }}</span></button></section>
    </div>
    <Teleport to="body"><dialog ref="publishDialog" class="compact-dialog" aria-labelledby="native-publish-title"><div class="dialog-heading"><h2 id="native-publish-title">发布作品</h2><button class="icon-button" aria-label="关闭发布作品" :disabled="publishing" @click="publishDialog?.close()"><X :size="18" /></button></div><form class="dialog-body stack" @submit.prevent="publish"><label class="field"><span>作品标题</span><input v-model="publishTitle" class="control" maxlength="100" required :disabled="publishing" /></label><p v-if="error" class="form-error" role="alert">{{ error }}</p><button class="button primary btn" :disabled="publishing"><Upload :size="16" />{{ publishing ? '正在提交…' : '提交作品' }}</button></form></dialog></Teleport>
  </section>
</template>

<style scoped>
.native-studio { display: grid; grid-template-columns: minmax(240px, 320px) minmax(0, 1fr); min-height: 640px; border-block: 1px solid var(--border); }
.creation-controls { display: flex; flex-direction: column; gap: 24px; padding: 24px 24px 32px 0; border-right: 1px solid var(--border); min-width: 0; }
.creation-section-heading, .creation-output-toolbar, .creation-output-toolbar > div, .task-status, .task-status > div { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.creation-section-heading h2, .creation-output-toolbar h2, .creation-section-heading h3 { margin: 0; font-size: 16px; line-height: 24px; }
.creation-section-heading > span { color: var(--muted); }
.creation-prompt { min-height: 176px; resize: vertical; line-height: 24px; }
.parameter-row { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 16px; }
.parameter-row .control { width: 100%; min-width: 0; }
.generation-button { width: 100%; min-height: 44px; }
.reference-upload { width: fit-content; position: relative; overflow: hidden; }
.reference-upload input { position: absolute; inset: 0; opacity: 0; cursor: pointer; width: 100%; }
.reference-upload:focus-within { outline: 2px solid var(--primary); outline-offset: 2px; }
.reference-list { display: flex; flex-wrap: wrap; list-style: none; padding: 0; gap: 8px; }
.reference-list li { position: relative; width: 64px; height: 64px; }
.reference-list img { width: 100%; height: 100%; object-fit: cover; border-radius: 4px; }
.reference-list button { position: absolute; right: 0; top: 0; min-width: 24px; width: 24px; height: 24px; min-height: 24px; background: var(--surface); }
.creation-output { min-width: 0; padding-left: 24px; }
.creation-output-toolbar { min-height: 80px; }
.creation-output-toolbar > div { gap: 8px; }
.creation-canvas { min-height: 380px; background: var(--surface); border-radius: 6px; padding: 16px; }
.canvas-empty, .canvas-waiting { min-height: 348px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 16px; color: var(--muted); }
.task-status { min-height: 40px; margin-bottom: 16px; }
.task-status > div { justify-content: flex-start; flex-wrap: wrap; }
.task-message { color: var(--pending); font-size: 14px; line-height: 24px; margin-block: 0 16px; overflow-wrap: anywhere; }
.creation-media { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(220px, 100%), 1fr)); gap: 16px; }
.creation-media figure { margin: 0; min-width: 0; }
.creation-media img, .creation-media video { width: 100%; max-height: 600px; display: block; object-fit: contain; }
.creation-media figcaption { margin-top: 12px; }
.creation-text pre { white-space: pre-wrap; overflow-wrap: anywhere; font: inherit; line-height: 28px; margin: 0 0 16px; max-width: 72ch; }
.creation-history { padding-block: 24px; }
.creation-history > .creation-section-heading { margin-bottom: 16px; }
.history-row { display: flex; align-items: center; gap: 12px; padding: 12px 8px; border: 0; border-bottom: 1px solid var(--border); background: transparent; color: var(--ink); width: 100%; min-width: 0; text-align: left; cursor: pointer; }
.history-row:hover, .history-row.selected { background: var(--surface-soft); }
.history-row > img, .history-kind { width: 48px; height: 48px; flex: none; object-fit: cover; border-radius: 4px; }
.history-kind { display: grid; place-items: center; font-size: 12px; background: var(--surface-soft); }
.history-content { display: flex; flex-direction: column; gap: 4px; min-width: 0; flex: 1; }
.history-content strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 14px; font-weight: 500; }
.history-content > span, .history-status { font-size: 12px; color: var(--muted); }
.history-content > span { overflow-wrap: anywhere; }
.history-status { white-space: nowrap; }
@media (max-width: 799px) { .native-studio { grid-template-columns: minmax(0, 1fr); } .creation-controls { padding: 24px 0; border-right: 0; border-bottom: 1px solid var(--border); } .creation-output { padding-left: 0; } .creation-prompt { min-height: 144px; } .creation-canvas { min-height: 280px; } .canvas-empty, .canvas-waiting { min-height: 248px; } .history-row { gap: 8px; } .creation-output-toolbar { flex-wrap: wrap; padding-block: 16px; } }
</style>
