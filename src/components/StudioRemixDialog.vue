<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ImagePlus, LoaderCircle, X } from '@lucide/vue'
import type { Work, WorkFile } from '../data'
import { errorMessage, session } from '../state'
import { mediaSource } from '../native-studio'
import { remixReferenceFiles } from '../studio-remix'
import { prepareStudioImage } from '../studio-image-upload'
import { useStudioMaterials, type StudioFile } from '../use-studio-materials'
import StudioMaterialStatus from './studio-message/StudioMaterialStatus.vue'
import StudioBilling from './StudioBilling.vue'
import { readRemixParameters } from '../../shared/studio/remix-parameters'
import { usesGeminiImageChat } from '../../shared/studio/image-params'

const props = defineProps<{ source: Work; issue: string; loading: boolean; ready: boolean; busy: boolean; canFallback: boolean; backgroundOnly?: boolean }>()
const emit = defineEmits<{ apply: [files: StudioFile[]]; background: [files: StudioFile[]]; cancel: []; retry: []; fallback: []; workbench: [] }>()
const parameters = computed(() => readRemixParameters(props.source.generation?.parameters))
const geminiImage = computed(() => props.source.kind === 'image' && usesGeminiImageChat(props.source.model))
const dialog = ref<HTMLDialogElement>(), upload = ref<HTMLInputElement>()
const selected = ref<string[]>([]), own = ref<StudioFile[]>([]), error = ref(''), importing = ref(false)
const failed = ref<string[]>([]), failedThumbnails = ref<string[]>([]), selectedOwn = ref<string[]>([])
const originals = computed(() => remixReferenceFiles(props.source))
watch(originals, files => { selected.value = selected.value.filter(id => files.some(file => file.id === id)) })
const limit = computed(() => props.source.kind === 'image' ? 16 : 10)
const materials = useStudioMaterials(own, computed(() => (session.user?.id || '') + ':' + props.source.id), { limit, imagesOnly: true })
const ownImages = computed(() => materials.snapshot.value.items.filter(item => item.status === 'ready').map((item, index) => ({ id: item.id, file: own.value[index]! })))
watch(ownImages, (items, previous) => {
  const previousIds = new Set(previous.map(item => item.id))
  const chosen = items.filter(item => selectedOwn.value.includes(item.id)).map(item => item.id)
  for (const item of items) if (!previousIds.has(item.id) && selected.value.length + chosen.length < limit.value) chosen.push(item.id)
  selectedOwn.value = chosen
})
const selectedUploads = computed(() => ownImages.value.filter(item => selectedOwn.value.includes(item.id)))
const issues = computed(() => materials.snapshot.value.items.filter(item => item.status !== 'ready'))
const count = computed(() => selected.value.length + selectedUploads.value.length)
const pending = computed(() => materials.pending.value || importing.value || props.busy)
const blocked = computed(() => pending.value || !props.ready || Boolean(props.issue))
const controller = new AbortController()
onMounted(() => dialog.value?.showModal())
onBeforeUnmount(() => controller.abort())

function previewFailed(file: WorkFile) {
  if (file.thumbnailUrl && !failedThumbnails.value.includes(file.id)) failedThumbnails.value.push(file.id)
  else failed.value.push(file.id)
}
async function addFiles(event: Event) {
  const input = event.target as HTMLInputElement, values = [...(input.files || [])]; input.value = ''
  if (!values.length || pending.value) return
  error.value = ''
  if (values.length + count.value > limit.value || values.length + materials.snapshot.value.items.length > limit.value) {
    error.value = '参考图数量超过上限，请先取消勾选或移除部分图片。'; return
  }
  try { await materials.add(values) } catch (cause) { error.value = errorMessage(cause) }
}
function cancel() { if (!props.busy) { controller.abort(); emit('cancel') } }
async function apply(withReferences: boolean, background = false) {
  if (blocked.value || withReferences && materials.failed.value) return
  error.value = ''; importing.value = true
  const owner = session.user?.id, source = props.source
  try {
    const images: StudioFile[] = []
    if (withReferences) {
      for (const file of originals.value.filter(file => selected.value.includes(file.id))) {
        let content = file.url
        if (source.kind === 'resource') {
          const response = await fetch(mediaSource(file.url)!, { credentials: 'same-origin', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30000)]) })
          if (!response.ok) throw new Error('参考图无法读取，请取消该图片或重试。')
          const blob = await response.blob()
          content = await prepareStudioImage(new File([blob], file.name, { type: blob.type }), true)
        }
        images.push({ name: file.name, type: /^data:([^;,]+)/.exec(content)?.[1] || file.type, size: file.size || 0, content, isText: false, sourceUrl: file.url, fromWorkId: source.id })
      }
      images.push(...selectedUploads.value.map(({ file }) => ({ ...file })))
    }
    if (images.length > limit.value) throw new Error('参考图数量超过上限，请先移除部分图片。')
    if (controller.signal.aborted || owner !== session.user?.id || source !== props.source) return
    if (background) emit('background', images)
    else emit('apply', images)
  } catch (cause) { if (!controller.signal.aborted) error.value = errorMessage(cause) }
  finally { importing.value = false }
}
</script>

<template>
  <dialog ref="dialog" class="studio-remix-dialog" aria-labelledby="remix-heading" @cancel.prevent="cancel">
    <header class="dialog-heading"><h2 id="remix-heading">制作同款</h2><button type="button" class="icon-button" aria-label="关闭制作同款" :disabled="busy" @click="cancel"><X :size="20" /></button></header>
    <div class="remix-body">
      <p v-if="loading" class="form-note" role="status">正在读取作品和可用模型…</p>
      <section class="remix-prompt" aria-label="作品提示词"><h3>作品提示词</h3><p>{{ source.prompt || '作者未公开提示词，可导入参考图后在工作台填写。' }}</p></section>
      <section v-if="source.kind !== 'resource'" class="remix-background" aria-label="后台制作同款">
        <p>沿用模型 {{ source.model || '（未提供）' }} 和公开参数，使用当前账号可用分组。后台生成会消耗积分，提交后{{ backgroundOnly ? '留在当前作品页' : '返回作品' }}，你可以继续浏览并在小窗中查看进度。</p>
        <StudioBilling v-if="ready && !issue" :model="source.model" :kind="source.kind" :quantity="geminiImage ? 1 : parameters?.n ?? 1" :duration="parameters?.duration ?? 8" :protocol="geminiImage ? 'openai' : parameters?.protocol ?? 'openai'" hide-catalog />
      </section>
      <h3>本次使用的参考图</h3>
      <p class="form-note">选择作品参考图，或上传自己的图片。只有选中的参考图会用于本次生成。</p>
      <div class="remix-tools"><button type="button" class="button btn" :disabled="pending || count >= limit || materials.snapshot.value.items.length >= limit" @click="upload?.click()"><LoaderCircle v-if="materials.pending.value" :size="18" /><ImagePlus v-else :size="18" />上传我的参考图</button><span class="form-note">最多 {{ limit }} 张，每张 20 MB</span><input ref="upload" hidden type="file" aria-label="上传我的参考图" accept="image/jpeg,image/png,image/webp,image/gif,image/avif,image/heic,image/heif,.heic,.heif" multiple :disabled="pending" @change="addFiles" /></div>
      <p class="remix-count" role="status">已选择 {{ count }} / {{ limit }} 张</p>
      <section v-if="ownImages.length" aria-label="我的参考图">
        <h3>我的参考图 · {{ ownImages.length }}</h3>
        <p class="form-note">上传后默认选中，点击图片可取消或重新选择。</p>
        <div class="remix-grid">
          <div v-for="{ id, file } in ownImages" :key="id" class="remix-image">
            <label><div class="remix-preview"><img :src="file.content" :alt="file.name" /></div><span><input v-model="selectedOwn" type="checkbox" :value="id" :aria-label="file.name" :disabled="pending || !selectedOwn.includes(id) && count >= limit" />{{ file.name }}</span></label>
            <button type="button" class="text-link remix-remove" :aria-label="'移除 ' + file.name" :disabled="pending" @click="materials.remove(id)">移除</button>
          </div>
        </div>
      </section>
      <section v-if="originals.length" aria-label="作品参考图">
        <div class="remix-section-heading"><h3>作品参考图 · {{ originals.length }}</h3><button type="button" class="text-link" :disabled="pending || originals.length + selectedUploads.length > limit" @click="selected = originals.map(file => file.id)">全选</button><button type="button" class="text-link" :disabled="pending || !selected.length" @click="selected = []">清空</button></div>
        <div class="remix-grid">
          <label v-for="file in originals" :key="file.id" class="remix-image">
            <div class="remix-preview"><span v-if="failed.includes(file.id)">预览暂不可用</span><img v-else :src="failedThumbnails.includes(file.id) ? file.url : file.thumbnailUrl || file.url" alt="" loading="lazy" @error="previewFailed(file)" /></div>
            <span><input v-model="selected" type="checkbox" :value="file.id" :aria-label="file.name" :disabled="pending || !selected.includes(file.id) && count >= limit" />{{ file.name }}</span>
          </label>
        </div>
      </section>
      <p v-else class="form-note">作者未公开参考图。可上传自己的图片，或仅导入提示词。</p>
      <StudioMaterialStatus :items="issues" :disabled="importing || busy" @remove="materials.remove" @retry="materials.retry" @cancel="materials.cancel" />
      <p v-if="source.kind === 'video'" class="form-note">选中的作品参考图按原顺序导入，你的图片排在后面。视频中的 @图片编号会同步调整，未选图片会标记为已移除。</p>
      <p v-if="issue" class="form-error" role="alert">{{ issue }} <button v-if="canFallback" type="button" class="text-link" :disabled="pending" @click="emit('fallback')">使用当前配置</button><button type="button" class="text-link" :disabled="pending" @click="emit('retry')">重新读取原作</button></p>
      <p v-if="error" class="form-error" role="alert">{{ error }}</p>
    </div>
    <footer class="remix-footer"><button type="button" class="button btn" :disabled="busy" @click="cancel">取消</button><button v-if="backgroundOnly" type="button" class="button btn" :disabled="pending" @click="emit('workbench')">进入工作台调整</button><template v-else><button type="button" class="button btn" :class="{ primary: !count && source.kind === 'resource' }" :disabled="blocked || !source.prompt.trim()" @click="apply(false)">仅导入提示词</button><button v-if="count" type="button" class="button btn" :class="{ primary: source.kind === 'resource' }" :disabled="blocked || materials.failed.value" @click="apply(true)"><LoaderCircle v-if="pending" :size="18" />导入提示词和参考图（{{ count }}）</button></template><button v-if="source.kind !== 'resource'" type="button" class="button btn primary" :disabled="blocked || materials.failed.value || !source.prompt.trim() || !source.model" @click="apply(true, true)"><LoaderCircle v-if="pending" :size="18" />后台生成同款</button></footer>
  </dialog>
</template>

<style scoped>
.studio-remix-dialog { width: 600px; max-width: calc(100vw - 24px); max-height: calc(100dvh - 32px); padding: 0; border: 1px solid var(--border); border-radius: var(--radius); color: var(--ink); background: var(--canvas); }
.studio-remix-dialog[open] { display: flex; flex-direction: column; }
.studio-remix-dialog::backdrop { background: rgb(0 0 0 / .5); }
.dialog-heading, .remix-footer { flex: none; padding: 16px 20px; }
.dialog-heading { display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border); }
.dialog-heading h2 { font-size: 18px; margin: 0; }
.dialog-heading .icon-button { width: 44px; height: 44px; }
.remix-body { padding: 20px; overflow-y: auto; overflow-wrap: anywhere; }
.remix-body h3 { margin: 20px 0 8px; font-size: 15px; line-height: 24px; }
.remix-prompt h3 { margin-top: 0; }
.remix-prompt p { max-height: 160px; overflow-y: auto; white-space: pre-wrap; font-size: 14px; }
.remix-background { display: grid; gap: 12px; margin-top: 20px; }
.remix-background > p { margin: 0; color: var(--muted); font-size: 13px; line-height: 1.6; }
.remix-tools, .remix-section-heading, .remix-footer { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.remix-section-heading h3 { margin: 0 auto 0 0; }
.remix-section-heading { margin-bottom: 12px; }
.remix-section-heading button, .remix-remove { min-height: 44px; }
.remix-count { font-size: 13px; color: var(--muted); }
.remix-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; margin-bottom: 20px; }
.remix-image { min-width: 0; border: 1px solid var(--border); border-radius: 8px; overflow: hidden; }
label.remix-image, .remix-image > label { display: block; cursor: pointer; }
.remix-image:has(:checked) { border-color: var(--focus-ring); background: var(--surface); }
.remix-preview { aspect-ratio: 4 / 3; display: flex; align-items: center; justify-content: center; background: var(--surface); font-size: 12px; }
.remix-preview img { width: 100%; height: 100%; object-fit: contain; }
.remix-image > span, .remix-image > label > span { display: flex; align-items: center; gap: 8px; padding: 8px; min-height: 44px; font-size: 13px; overflow-wrap: anywhere; }
.remix-image input { flex: none; }
.remix-remove { width: 100%; border-top: 1px solid var(--border); }
.remix-footer { justify-content: flex-end; border-top: 1px solid var(--border); }
.remix-footer .button { min-height: 44px; white-space: normal; }
@media (max-width: 639px) { .studio-remix-dialog { max-width: calc(100vw - 16px); }.remix-body, .dialog-heading, .remix-footer { padding: 12px; }.remix-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }.remix-footer { gap: 8px; } }
</style>
