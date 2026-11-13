<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ArrowDown, ArrowUp, ArrowLeftRight, FileText, ImagePlus, Save, Trash2, Upload, X } from '@lucide/vue'
import { kindLabels, type Work, type WorkFile, type WorkKind } from '../data'
import { api, errorMessage, notify, safeExternalUrl, session, uploadFile } from '../state'

const props = defineProps<{ open: boolean; work?: Work | null }>()
const emit = defineEmits<{ close: []; saved: [work: Work] }>()
const dialog = ref<HTMLDialogElement>()
const leaveDialog = ref<HTMLDialogElement>()
const router = useRouter()
const draft = reactive({ title: '', kind: 'image' as WorkKind, body: '', prompt: '', tags: '', model: '', sourceUrl: '', license: '' })
const files = ref<WorkFile[]>([])
const references = ref<WorkFile[]>([])
const version = ref(0)
const error = ref('')
const loading = ref(false)
const uploading = ref(false)
const saving = ref(false)
const requestId = ref(crypto.randomUUID())
let controller: AbortController | undefined
let loadId = 0
let resolveLeave: ((leave: boolean) => void) | undefined
const baseline = ref('')
const snapshot = () => JSON.stringify({ ...draft, files: files.value.map(file => file.id), references: references.value.map(file => file.id) })
const dirty = computed(() => props.open && snapshot() !== baseline.value)

function fill(work?: Work | null) {
  Object.assign(draft, { title: work?.title || '', kind: work?.kind || 'image', body: work?.body || '', prompt: work?.prompt || '', tags: work?.tags.join('，') || '', model: work?.model || '', sourceUrl: work?.sourceUrl || '', license: work?.license || '' })
  files.value = [...(work?.files || [])]
  references.value = [...(work?.referenceFiles || [])]
  version.value = work?.version || 0
  baseline.value = snapshot()
}
watch(() => [props.open, props.work?.id] as const, async ([open]) => {
  const current = ++loadId
  if (!open) { dialog.value?.close(); return }
  error.value = ''; loading.value = false; fill(props.work)
  await nextTick()
  if (!dialog.value?.open) dialog.value?.showModal()
  if (!props.work) return
  loading.value = true
  try {
    const result = await api<{ work: Work }>(`/api/works/${encodeURIComponent(props.work.id)}`)
    if (current === loadId) fill(result.work)
  } catch (cause) { if (current === loadId) error.value = errorMessage(cause) }
  finally { if (current === loadId) loading.value = false }
}, { immediate: true })

function confirmLeave() {
  if (!props.open) return true
  if (saving.value || uploading.value || resolveLeave) return false
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
  loadId++; controller?.abort(); finishLeave(false); fill(); loading.value = false
  saving.value = false; uploading.value = false; requestId.value = crypto.randomUUID()
  if (props.open) emit('close')
}, { flush: 'sync' })
async function choose(event: Event, reference = false) {
  const input = event.target as HTMLInputElement
  const selected = [...(input.files || [])]
  input.value = ''
  if (!selected.length || uploading.value) return
  const target = reference ? references : files
  if (target.value.length + selected.length > 16) { error.value = '作品文件和参考图各最多 16 个。'; return }
  if (reference && selected.some(file => !file.type.startsWith('image/'))) { error.value = '参考素材请选择图片。'; return }
  uploading.value = true; error.value = ''
  const current = loadId, owner = session.user?.id, request = new AbortController()
  controller = request
  try {
    for (const file of selected) {
      const uploaded = await uploadFile(file, request.signal)
      if (current !== loadId || session.user?.id !== owner) return
      target.value.push(uploaded)
    }
  } catch (cause) { if (current === loadId && !request.signal.aborted) error.value = errorMessage(cause) }
  finally { if (current === loadId) uploading.value = false }
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
}
async function save(status: 'draft' | 'pending') {
  if (saving.value || uploading.value || loading.value) return
  if (!draft.title.trim()) { error.value = '请填写作品标题。'; return }
  if (draft.sourceUrl.trim() && !safeExternalUrl(draft.sourceUrl.trim())) { error.value = '来源请填写完整的 http 或 https 链接。'; return }
  if (draft.kind !== 'resource' && !files.value.some(file => file.type.startsWith(`${draft.kind}/`))) { error.value = `请至少添加一个${draft.kind === 'image' ? '图片' : '视频'}作品文件。`; return }
  if (draft.kind === 'resource' && !draft.body.trim() && !files.value.length) { error.value = '请填写资源内容或添加文件。'; return }
  saving.value = true; error.value = ''
  const current = loadId, owner = session.user?.id
  try {
    const body = {
      ...draft, title: draft.title.trim(), tags: [...new Set(draft.tags.split(/[,，\s]+/).filter(Boolean))].slice(0, 10),
      fileIds: files.value.map(file => file.id), referenceFileIds: references.value.map(file => file.id),
      ...(props.work ? { version: version.value, ...(['draft', 'rejected'].includes(props.work.status) ? { status } : {}) } : { status, requestId: requestId.value, idempotencyKey: requestId.value }),
    }
    const result = await api<{ work: Work }>(props.work ? `/api/works/${encodeURIComponent(props.work.id)}` : '/api/works', { method: props.work ? 'PATCH' : 'POST', body })
    if (current !== loadId || session.user?.id !== owner) return
    baseline.value = snapshot()
    saving.value = false
    emit('saved', result.work)
    notify(result.work.revisionPending || result.work.status === 'pending' ? '作品已提交审核。' : result.work.status === 'draft' ? '草稿已保存。' : '作品已保存。')
    requestId.value = crypto.randomUUID()
    emit('close')
  } catch (cause) { if (current === loadId) error.value = errorMessage(cause) }
  finally { if (current === loadId) saving.value = false }
}
onBeforeUnmount(() => { loadId++; controller?.abort(); removeGuard(); window.removeEventListener('beforeunload', beforeUnload); resolveLeave?.(false) })
</script>

<template>
  <dialog ref="dialog" class="editor-dialog" aria-labelledby="work-editor-heading" @close="props.open && emit('close')" @cancel.prevent="close">
    <div class="dialog-heading"><h2 id="work-editor-heading">{{ work ? '编辑作品' : '发布作品' }}</h2><button class="icon-button" aria-label="关闭作品编辑" :disabled="saving || uploading" @click="close"><X :size="20" /></button></div>
    <form class="dialog-body stack" @submit.prevent="save('pending')">
      <p v-if="loading" role="status">正在加载作品…</p>
      <fieldset :disabled="loading || saving || uploading" class="editor-fields">
        <div class="editor-columns"><label class="field"><span>作品类型</span><select v-model="draft.kind" class="control"><option v-for="(label, value) in kindLabels" :key="value" :value="value">{{ label }}</option></select></label><label class="field"><span>作品标题</span><input v-model="draft.title" class="control" maxlength="100" required /></label></div>
        <label class="field"><span>{{ draft.kind === 'resource' ? '资源内容' : '创作说明' }}</span><textarea v-model="draft.body" class="control" rows="4" maxlength="20000" /></label>
        <label class="field"><span>生成提示词</span><textarea v-model="draft.prompt" class="control" rows="4" maxlength="100000" /></label>
        <div class="editor-columns"><label class="field"><span>标签</span><input v-model="draft.tags" class="control" maxlength="500" placeholder="用逗号分隔" /></label><label class="field"><span>模型</span><input v-model="draft.model" class="control" maxlength="100" /></label><label class="field"><span>来源链接</span><input v-model="draft.sourceUrl" class="control" type="url" maxlength="2000" /></label><label class="field"><span>授权许可</span><input v-model="draft.license" class="control" maxlength="200" /></label></div>
        <section v-for="group in [{ reference: false, title: '作品文件', items: files }, { reference: true, title: '参考图', items: references }]" :key="group.title" class="attachment-section">
          <div class="section-heading"><h3 class="title-4">{{ group.title }} · {{ group.items.length }}/16</h3><label class="button subtle btn"><ImagePlus :size="16" />添加文件<input type="file" multiple :accept="group.reference ? 'image/*' : undefined" aria-label="添加附件" @change="choose($event, group.reference)" /></label></div>
          <ul v-if="group.items.length" class="attachment-list"><li v-for="(file, index) in group.items" :key="file.id"><a :href="file.url" target="_blank" rel="noopener noreferrer" class="file-name"><img v-if="file.type.startsWith('image/')" :src="file.thumbnailUrl || file.url" :alt="file.name" /><FileText v-else :size="22" /><span>{{ file.name }}</span></a><div class="table-actions"><button type="button" class="icon-button" aria-label="向前移动" title="向前移动" :disabled="index === 0" @click="move(index, group.reference, -1)"><ArrowUp :size="15" /></button><button type="button" class="icon-button" aria-label="向后移动" title="向后移动" :disabled="index === group.items.length - 1" @click="move(index, group.reference, 1)"><ArrowDown :size="15" /></button><button v-if="group.reference || file.type.startsWith('image/')" type="button" class="icon-button" :aria-label="group.reference ? '移至作品文件' : '移至参考图'" :title="group.reference ? '移至作品文件' : '移至参考图'" @click="changeRole(index, group.reference)"><ArrowLeftRight :size="15" /></button><button type="button" class="icon-button" :aria-label="`移除 ${file.name}`" title="移除附件" @click="group.items.splice(index, 1)"><Trash2 :size="15" /></button></div></li></ul>
          <p v-else class="form-note">暂无{{ group.title }}</p>
        </section>
      </fieldset>
      <p v-if="uploading" role="status">正在上传文件…</p><p v-if="error" class="form-error" role="alert">{{ error }}</p>
      <div class="dialog-footer"><span class="caption-5">{{ work?.revisionPending ? '本次保存将更新待审核修改。' : '' }}</span><div><button v-if="!work || work.status === 'draft'" type="button" class="button subtle btn" :disabled="loading || saving || uploading" @click="save('draft')"><Save :size="16" />存为草稿</button><button class="button primary btn" :disabled="loading || saving || uploading"><Upload :size="16" />{{ saving ? '正在保存…' : work ? '保存修改' : '提交作品' }}</button></div></div>
    </form>
  </dialog>
  <dialog ref="leaveDialog" class="compact-dialog" aria-labelledby="work-discard-heading" @cancel.prevent="finishLeave(false)">
    <div class="dialog-heading"><h2 id="work-discard-heading">保留作品修改？</h2><button class="icon-button" aria-label="关闭作品离开提示" @click="finishLeave(false)"><X :size="20" /></button></div>
    <div class="dialog-body stack"><p>作品尚未保存。你可以继续编辑并存为草稿，或放弃这次输入。</p><div class="table-actions"><button class="button subtle btn" @click="finishLeave(true)">放弃修改</button><button class="button primary btn" autofocus @click="finishLeave(false)">继续编辑</button></div></div>
  </dialog>
</template>

<style scoped>
.editor-dialog { width: 840px; max-width: calc(100vw - 32px); }
.editor-fields { border: 0; padding: 0; margin: 0; min-width: 0; display: grid; gap: 16px; }
.editor-columns { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
.attachment-section { min-width: 0; padding-top: 8px; }
.attachment-section input[type=file] { display: none; }
.attachment-list { padding: 0; margin: 0; list-style: none; }
.attachment-list li { display: flex; align-items: center; gap: 8px; justify-content: space-between; border-bottom: 1px solid var(--border); padding: 8px 0; }
.file-name { display: flex; align-items: center; gap: 8px; min-width: 0; }
.file-name img { width: 40px; height: 40px; object-fit: cover; border-radius: 4px; }
.file-name span { overflow-wrap: anywhere; }
.table-actions { flex-shrink: 0; }
@media (max-width: 639px) { .editor-columns { grid-template-columns: 1fr; } .attachment-list li { flex-wrap: wrap; } .table-actions { margin-left: auto; } }
</style>
