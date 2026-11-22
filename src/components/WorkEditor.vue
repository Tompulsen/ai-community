<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ChevronDown, ImagePlus, PenLine, Plus, Save, SlidersHorizontal, Upload, X } from '@lucide/vue'
import WorkAttachments from './WorkAttachments.vue'
import PublicationTagPicker from './PublicationTagPicker.vue'
import { kindLabels, type Work, type WorkKind, type WorkTag } from '../data'
import { api, errorMessage, notify, safeExternalUrl, session } from '../state'
import { useFileUploads, type UploadFile } from '../use-file-uploads'
import { refreshLotteryBalance } from '../lottery-balance'
import '../publication-controls.css'

const props = defineProps<{ open: boolean; work?: Work | null }>()
const emit = defineEmits<{ close: []; saved: [work: Work] }>()
const dialog = ref<HTMLDialogElement>()
const leaveDialog = ref<HTMLDialogElement>()
const router = useRouter()
const draft = reactive({ title: '', kind: 'image' as WorkKind, body: '', prompt: '', tags: [] as string[], tagIds: undefined as string[] | undefined, model: '', sourceUrl: '', license: '' })
const extra = ref<HTMLDetailsElement>(), fileInput = ref<HTMLInputElement>(), referenceInput = ref<HTMLInputElement>()
const writing = ref(false), autoKind = ref(true), tagOptions = ref<WorkTag[]>([]), tagsLoading = ref(false), tagsError = ref('')
const tagField = ref<HTMLFieldSetElement>(), tagValidation = ref('')
const sourceComment = ref(false)
const selectedTagIds = computed({
  get: () => draft.tagIds ?? draft.tags.flatMap(name => {
    const tag = tagOptions.value.find(option => option.category === draft.kind && option.name === name)
    return tag ? [tag.id] : []
  }),
  set: (ids: string[]) => {
    draft.tagIds = ids
    draft.tags = ids.flatMap(id => { const tag = tagOptions.value.find(option => option.id === id); return tag ? [tag.name] : [] })
    tagValidation.value = ''
  },
})
let tagLoadId = 0
const files = ref<UploadFile[]>([])
const references = ref<UploadFile[]>([])
const uploads = useFileUploads(() => props.work && session.user?.isAdmin && props.work.authorId !== session.user.id ? props.work.id : undefined)
const version = ref(0)
const error = ref('')
const loading = ref(false), loadFailed = ref(false)
const uploading = uploads.uploading
const saving = ref(false)
const requestId = ref(crypto.randomUUID())
let loadId = 0
let resolveLeave: ((leave: boolean) => void) | undefined
const baseline = ref('')
const snapshot = () => JSON.stringify({ ...draft, files: files.value.map(file => file.id), references: references.value.map(file => file.id) })
const dirty = computed(() => props.open && snapshot() !== baseline.value)

function fill(work?: Work | null) {
  uploads.reset()
  sourceComment.value = work?.destination === 'source-comment'
  Object.assign(draft, { title: work?.title || '', kind: work?.kind || 'image', body: work?.body || '', prompt: work?.prompt || '', tags: [...(work?.tags || [])], tagIds: work?.tagIds ? [...work.tagIds] : undefined, model: work?.model || '', sourceUrl: work?.sourceUrl || '', license: work?.license || '' })
  writing.value = work?.kind === 'resource'
  autoKind.value = !work || work.status === 'draft' && work.kind !== 'resource' && !work.generation?.parameters && !(work.files || []).some(file => file.type.startsWith(`${work.kind}/`))
  tagsError.value = ''; tagValidation.value = ''; tagOptions.value = []; tagsLoading.value = false; tagLoadId++
  if (extra.value) extra.value.open = false
  files.value = [...(work?.files || [])]
  references.value = [...(work?.referenceFiles || [])]
  version.value = work?.version || 0
  baseline.value = snapshot()
}
async function loadWork() {
  const current = ++loadId;
  error.value = ''; loadFailed.value = false; loading.value = false; fill(props.work)
  await nextTick()
  if (current !== loadId || !props.open) return
  if (!dialog.value?.open) dialog.value?.showModal()
  if (!props.work) return
  loading.value = true
  try {
    const result = await api<{ work: Work }>(`/api/works/${encodeURIComponent(props.work.id)}`)
    if (current === loadId) { fill(result.work); if (!sourceComment.value) void loadTags() }
  } catch (cause) { if (current === loadId) { error.value = errorMessage(cause); loadFailed.value = true } }
  finally { if (current === loadId) loading.value = false }
}
watch(() => [props.open, props.work?.id] as const, ([open]) => {
  if (open) void loadWork()
  else { loadId++; uploads.reset(); dialog.value?.close() }
}, { immediate: true })

async function loadTags() {
  const current = ++tagLoadId
  tagsLoading.value = true; tagsError.value = ''
  try {
    const result = await api<{ items: WorkTag[] }>('/api/tags')
    if (current !== tagLoadId) return
    if (!Array.isArray(result.items)) throw new Error('标签暂时不可用。')
    tagOptions.value = result.items
  } catch (cause) { if (current === tagLoadId) tagsError.value = errorMessage(cause) }
  finally { if (current === tagLoadId) tagsLoading.value = false }
}
watch([() => props.open, () => draft.kind], ([open]) => { if (open && !sourceComment.value) void loadTags() }, { immediate: true })
function inferKind() {
  if (!autoKind.value) return
  const kind: WorkKind = writing.value || files.value.some(file => !/^(image|video)\//.test(file.type)) ? 'resource'
    : files.value.some(file => file.type.startsWith('video/')) ? 'video' : 'image'
  if (draft.kind !== kind) { draft.kind = kind; tagValidation.value = '' }
}
watch(() => files.value.map(file => file.type), inferKind)
function writeContent() { writing.value = true; inferKind() }
function useFiles() { writing.value = false; inferKind() }
function showUpload() { fileInput.value?.click() }
function invalidField(event: Event) {
  const input = event.target as HTMLInputElement
  const details = input.closest('details')
  if (details) details.open = true
}
function confirmLeave() {
  if (!props.open) return true
  if (saving.value && !uploading.value || resolveLeave) return false
  if (!dirty.value) return true
  leaveDialog.value?.showModal()
  return new Promise<boolean>(resolve => { resolveLeave = resolve })
}
function finishLeave(discard: boolean) {
  leaveDialog.value?.close()
  if (discard) baseline.value = snapshot()
  resolveLeave?.(discard); resolveLeave = undefined
}
async function close() { if (await confirmLeave()) emit('close') }
function beforeUnload(event: BeforeUnloadEvent) {
  if (dirty.value || props.open && (saving.value || uploading.value)) { event.preventDefault(); event.returnValue = '' }
}
const removeGuard = router.beforeEach(confirmLeave)
onMounted(() => window.addEventListener('beforeunload', beforeUnload))
watch(() => session.user?.id, (_owner, previous) => {
  if (!previous && !session.ready) return
  loadId++; finishLeave(false); fill(); loading.value = false
  saving.value = false; requestId.value = crypto.randomUUID()
  if (props.open) emit('close')
}, { flush: 'sync' })
function choose(event: Event, reference = false) {
  const input = event.target as HTMLInputElement
  const selected = [...(input.files || [])]
  input.value = ''
  if (!selected.length || saving.value || loading.value) return
  const target = reference ? references : files
  if (target.value.length + selected.length > 16) { error.value = '作品文件和参考图各最多 16 个。'; return }
  if (reference && selected.some(file => !file.type.startsWith('image/'))) { error.value = '参考素材请选择图片。'; return }
  error.value = ''; target.value.push(...uploads.add(selected))
  if (!reference) inferKind()
}
function move(index: number, reference: boolean, direction: number) {
  const target = reference ? references.value : files.value
  const next = index + direction
  if (next < 0 || next >= target.length) return
  const file = target.splice(index, 1)[0]!
  target.splice(next, 0, file)
}
function changeRole(index: number, reference: boolean) {
  const from = reference ? references.value : files.value
  const to = reference ? files.value : references.value
  const file = from[index]
  if (!file || to.length >= 16 || (!reference && !file.type.startsWith('image/'))) return
  from.splice(index, 1); to.push(file)
  inferKind()
  if (!reference && extra.value) extra.value.open = true
}
function removeFile(index: number, reference = false) {
  const target = reference ? references.value : files.value
  const [removed] = target.splice(index, 1)
  if (removed) uploads.remove(removed)
  if (!reference) inferKind()
}
async function save(status: 'draft' | 'pending') {
  if (saving.value || loading.value || loadFailed.value) return
  if (!draft.title.trim()) { error.value = '请填写作品标题。'; return }
  if (draft.sourceUrl.trim() && !safeExternalUrl(draft.sourceUrl.trim())) { if (extra.value) extra.value.open = true; error.value = '来源请填写完整的 http 或 https 链接。'; return }
  if (status !== 'draft' && draft.kind !== 'resource' && !files.value.some(file => file.type.startsWith(`${draft.kind}/`))) { error.value = `请至少添加一个${draft.kind === 'image' ? '图片' : '视频'}作品文件。`; return }
  if (status !== 'draft' && draft.kind === 'resource' && !draft.body.trim() && !files.value.length) { error.value = '请填写资源内容或添加文件。'; return }
  tagValidation.value = ''
  if (status !== 'draft' && !sourceComment.value) {
    tagValidation.value = tagsLoading.value ? '标签正在加载，请稍后再提交。'
      : tagsError.value ? '请重新加载标签并选择后再发布。'
        : !selectedTagIds.value.length ? '请至少选择 1 个作品标签后再发布。'
          : selectedTagIds.value.length > 3 || selectedTagIds.value.some(id => !tagOptions.value.some(tag => tag.id === id)) || !draft.tagIds && draft.tags.length !== selectedTagIds.value.length ? '请选择 1–3 个有效标签。' : ''
    if (tagValidation.value) {
      error.value = ''; await nextTick()
      const target = tagField.value?.querySelector<HTMLElement>('input:not(:disabled), button:not(:disabled)') ?? tagField.value
      target?.focus()
      return
    }
  }
  saving.value = true; error.value = ''
  const current = loadId, owner = session.user?.id
  try {
    await uploads.wait([...files.value, ...references.value])
    if (current !== loadId || session.user?.id !== owner) return
    const body = {
      ...draft, title: draft.title.trim(), tags: [...draft.tags],
      tagIds: draft.tagIds ?? (!tagsLoading.value && !tagsError.value && draft.tags.length === selectedTagIds.value.length ? [...selectedTagIds.value] : undefined),
      fileIds: files.value.map(file => file.id), referenceFileIds: references.value.map(file => file.id),
      ...(props.work ? { version: version.value, ...(['draft', 'rejected'].includes(props.work.status) ? { status } : {}) } : { status, requestId: requestId.value, idempotencyKey: requestId.value }),
    }
    const result = await api<{ work: Work }>(props.work ? `/api/works/${encodeURIComponent(props.work.id)}` : '/api/works', { method: props.work ? 'PATCH' : 'POST', body, expectedAccount: owner })
    if (current !== loadId || session.user?.id !== owner) return
    if (result.work.status !== 'draft') void refreshLotteryBalance(true)
    baseline.value = snapshot()
    saving.value = false
    emit('saved', result.work)
    notify(result.work.revisionPending || result.work.status === 'pending' ? '作品已提交审核。' : result.work.status === 'draft' ? '草稿已保存。' : '作品已保存。')
    requestId.value = crypto.randomUUID()
    emit('close')
  } catch (cause) { if (current === loadId) { error.value = errorMessage(cause); if (extra.value) extra.value.open = true } }
  finally { if (current === loadId) saving.value = false }
}
onBeforeUnmount(() => { loadId++; tagLoadId++; removeGuard(); window.removeEventListener('beforeunload', beforeUnload); resolveLeave?.(false) })
</script>

<template>
  <dialog ref="dialog" class="editor-dialog" aria-labelledby="work-editor-heading" @close="props.open && emit('close')" @cancel.prevent="close">
    <div class="dialog-heading"><h2 id="work-editor-heading">{{ work ? '编辑作品' : '发布作品' }}</h2><button class="icon-button" aria-label="关闭作品编辑" :disabled="saving || uploading" @click="close"><X :size="20" /></button></div>
    <form class="editor-form" @submit.prevent="save('pending')" @invalid.capture="invalidField">
      <div class="editor-scroll" tabindex="0" role="region" aria-label="作品信息">
        <p v-if="loading" role="status">正在加载作品…</p>
        <fieldset :disabled="loading || saving || loadFailed" class="editor-fields editor-layout">
          <legend class="editor-sr-only">作品信息</legend>
          <section class="attachment-section editor-media" aria-label="作品文件">
            <input ref="fileInput" type="file" multiple hidden aria-label="添加作品文件" @change="choose($event)" />
            <button v-if="!files.length && !writing" type="button" class="upload-area" @click="showUpload"><ImagePlus :size="40" :stroke-width="1.8" aria-hidden="true" /><span>添加作品</span></button>
            <div v-else class="section-heading"><span class="form-note">{{ draft.kind === 'resource' ? '资源' : kindLabels[draft.kind] }} · {{ files.length }}/16</span><button type="button" class="button subtle btn" @click="showUpload"><Plus :size="16" aria-hidden="true" />添加文件</button></div>
            <WorkAttachments :files="files" featured @retry="index => uploads.retry(files[index]!)" @move="(index, direction) => move(index, false, direction)" @role="index => changeRole(index, false)" @remove="index => removeFile(index)" />
            <label v-if="draft.kind === 'resource'" class="field resource-content"><span>资源内容</span><textarea v-model="draft.body" class="control" rows="7" maxlength="20000" /></label>
            <button v-if="autoKind && (writing || !files.length)" type="button" class="write-content" @click="writing ? useFiles() : writeContent()"><ImagePlus v-if="writing" :size="16" aria-hidden="true" /><PenLine v-else :size="16" aria-hidden="true" />{{ writing ? '使用文件投稿' : '填写内容' }}</button>
          </section>
          <div class="editor-content">
          <label class="field editor-title"><span><span>作品标题</span><small aria-hidden="true">{{ draft.title.length }}/100</small></span><input v-model="draft.title" class="control" aria-label="作品标题" maxlength="100" required placeholder="为作品起个名字" /></label>
          <fieldset v-if="!sourceComment" ref="tagField" class="editor-tags" tabindex="-1" :aria-invalid="Boolean(tagValidation)" :aria-describedby="tagValidation ? 'editor-tags-hint editor-tags-error' : 'editor-tags-hint'">
            <legend>作品标签（必选）<span>{{ selectedTagIds.length }}/3</span></legend>
            <p id="editor-tags-hint" class="form-note">选择 1–3 个标签，方便搜索和发现同类作品。</p>
            <p v-if="tagsLoading" class="form-note" role="status">正在加载标签…</p>
            <div v-else-if="tagsError" class="tag-error"><p class="form-note">标签加载失败：{{ tagsError }}</p><button type="button" class="button subtle btn" @click="loadTags">重新加载标签</button></div>
            <PublicationTagPicker v-else-if="tagOptions.length" v-model="selectedTagIds" :tags="tagOptions" :kind="draft.kind" checkboxes />
            <template v-else-if="!tagsLoading && !tagsError"><p class="form-note">暂无可用标签，请联系管理员添加；也可以先存为草稿。</p><button type="button" class="button subtle btn" @click="loadTags">重新加载标签</button></template>
            <p v-if="tagValidation" id="editor-tags-error" class="form-error" role="alert">{{ tagValidation }}</p>
          </fieldset>
          <details ref="extra" class="editor-extras publication-extras">
            <summary><SlidersHorizontal :size="16" aria-hidden="true" /><span><span>补充信息（选填）</span><small v-if="draft.prompt.trim() || references.length">{{ draft.prompt.trim() ? '含提示词' : '' }}{{ draft.prompt.trim() && references.length ? ' · ' : '' }}{{ references.length ? `${references.length} 张公开参考图` : '' }}</small></span><ChevronDown :size="16" aria-hidden="true" /></summary>
            <div class="editor-fields">
              <label v-if="draft.kind !== 'resource'" class="field"><span>作品简介</span><textarea v-model="draft.body" class="control" rows="2" maxlength="20000" /></label>
              <label class="field"><span>生成提示词</span><textarea v-model="draft.prompt" class="control" rows="3" maxlength="100000" /></label>
              <div class="editor-columns"><label class="field"><span>模型</span><input v-model="draft.model" class="control" maxlength="100" /></label><label class="field"><span>来源链接</span><input v-model="draft.sourceUrl" class="control" type="url" maxlength="2000" autocapitalize="none" :spellcheck="false" /></label></div>
              <label class="field"><span>授权许可</span><input v-model="draft.license" class="control" maxlength="200" /></label>
              <section class="attachment-section" aria-label="参考图">
                <div class="section-heading"><h3 class="title-4">参考图 · {{ references.length }}/16</h3><button type="button" class="button subtle btn" @click="referenceInput?.click()"><ImagePlus :size="16" aria-hidden="true" />添加参考图</button></div>
                <input ref="referenceInput" type="file" multiple accept="image/*" hidden aria-label="添加参考图" @change="choose($event, true)" />
                <WorkAttachments :files="references" reference @retry="index => uploads.retry(references[index]!)" @move="(index, direction) => move(index, true, direction)" @role="index => changeRole(index, true)" @remove="index => removeFile(index, true)" />
              </section>
            </div>
          </details>
          </div>
        </fieldset>
      </div>
      <div class="editor-feedback"><p v-if="uploading" role="status">{{ saving ? '已安排提交，上传完成后自动保存。' : '文件正在上传，可继续填写作品信息。' }}</p><p v-if="error" class="form-error" role="alert">{{ error }} <button v-if="loadFailed" type="button" class="text-link" @click="loadWork">重新加载作品</button></p></div>
      <div class="dialog-footer"><span v-if="work?.revisionPending" class="caption-5">本次保存将更新待审核修改。</span><div><button v-if="!work || work.status === 'draft'" type="button" class="button subtle btn" :disabled="loading || saving || loadFailed" @click="save('draft')"><Save :size="16" />存为草稿</button><button class="button primary btn" :disabled="loading || saving || loadFailed"><Upload :size="16" />{{ saving ? '正在保存…' : work ? '保存修改' : '提交审核' }}</button></div></div>
    </form>
  </dialog>
  <dialog ref="leaveDialog" class="compact-dialog" aria-labelledby="work-discard-heading" @cancel.prevent="finishLeave(false)">
    <div class="dialog-heading"><h2 id="work-discard-heading">保留作品修改？</h2><button class="icon-button" aria-label="关闭作品离开提示" @click="finishLeave(false)"><X :size="20" /></button></div>
    <div class="dialog-body stack"><p>作品尚未保存。你可以继续编辑并存为草稿，或放弃这次输入。</p><div class="table-actions"><button class="button subtle btn" @click="finishLeave(true)">放弃修改</button><button class="button primary btn" autofocus @click="finishLeave(false)">继续编辑</button></div></div>
  </dialog>
</template>

<style scoped>
.editor-dialog { width: 880px; max-width: calc(100dvw - 32px); background: var(--surface); }
.editor-dialog[open] { display: flex; flex-direction: column; max-height: calc(100dvh - 48px); overflow: hidden; }
.editor-dialog > .dialog-heading { flex: none; padding: 16px 24px; }
.editor-dialog > .dialog-heading .icon-button { width: 44px; height: 44px; }
.editor-form { display: flex; flex-direction: column; min-height: 0; }
.editor-scroll { min-height: 0; overflow-y: auto; overscroll-behavior: contain; }
.editor-sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
.editor-fields { border: 0; padding: 0; margin: 0; min-width: 0; display: grid; gap: 16px; }
.editor-layout { grid-template-columns: minmax(0, 1fr) minmax(0, 1.1fr); gap: 0; }
.editor-media { padding: 24px; background: var(--canvas); }
.editor-content { min-width: 0; padding: 24px; display: flex; flex-direction: column; gap: 24px; }
.editor-title small { color: var(--muted); font-size: 12px; line-height: 16px; font-weight: 400; font-variant-numeric: tabular-nums; }
.editor-title .control { min-height: 48px; font-size: 16px; }
.editor-columns { display: grid; grid-template-columns: minmax(0, 1fr); gap: 16px; }
.attachment-section { min-width: 0; }
.upload-area { display: flex; align-items: center; justify-content: center; flex-direction: column; gap: 16px; width: 100%; min-height: 280px; border: 1px dashed var(--control-border); border-radius: 8px; color: var(--muted); background: var(--surface); }
.upload-area > span { font-size: 16px; line-height: 24px; font-weight: 500; color: var(--ink); }
.upload-area:hover:not(:disabled) { color: var(--ink); background: var(--state-hover); }
.upload-area:active:not(:disabled) { transform: translateY(1px); }
.write-content { display: flex; align-items: center; justify-content: center; gap: 8px; min-height: 48px; width: 100%; margin-top: 8px; color: var(--muted); font-size: 14px; border-radius: 6px; }
.write-content:hover { color: var(--ink); }
.resource-content { margin-block-start: 16px; }
.editor-tags { border: 0; padding: 0; margin: 0; min-width: 0; }
.editor-tags legend { margin-bottom: 8px; font-size: 14px; }
.editor-tags legend span { margin-left: 8px; color: var(--muted); font-size: 12px; }
.editor-tag-options { margin-top: 12px; }
.tag-error { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.editor-feedback:has(> p) { padding: 8px 24px; }
.editor-dialog .dialog-footer { flex: none; }
.editor-dialog .dialog-footer > div { width: 100%; justify-content: space-between; }
.editor-dialog .dialog-footer .button { min-height: 44px; }
.editor-dialog .dialog-footer .primary { min-width: 144px; }
.editor-dialog .dialog-footer .subtle { background: transparent; color: var(--muted); }
.editor-dialog .dialog-footer .subtle:hover { background: var(--state-hover); color: var(--ink); }
@media (max-width: 699px) {
  .editor-dialog { width: calc(100dvw - 24px); max-width: none; }
  .editor-dialog[open] { max-height: calc(100dvh - 24px); }
  .editor-dialog > .dialog-heading { padding: 12px 16px; }
  .editor-layout { grid-template-columns: minmax(0, 1fr); }
  .editor-media, .editor-content { padding: 16px; }
  .editor-content { gap: 16px; }
  .upload-area { min-height: 180px; gap: 12px; }
  .upload-area > svg:first-child { width: 32px; height: 32px; }
  .editor-dialog .control { font-size: 16px; min-height: 44px; }
  .editor-dialog .dialog-footer { padding: 12px 16px; }
  .editor-dialog .dialog-footer > div { gap: 8px; }
  .editor-dialog .dialog-footer .primary { min-width: 128px; }
  .attachment-section .section-heading { flex-wrap: wrap; gap: 8px; }
  .editor-feedback:has(> p) { padding-inline: 16px; }
}

</style>
