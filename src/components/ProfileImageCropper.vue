<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, useId } from 'vue'
import { Download, Image as ImageIcon, ImagePlus, Minus, Plus, RotateCcw, X } from '@lucide/vue'
import type Cropper from 'cropperjs'
import { errorMessage } from '../state'

const emit = defineEmits<{ cropped: [file: File, field: 'avatar' | 'banner'] }>()
const dialog = ref<HTMLDialogElement>(), host = ref<HTMLDivElement>()
const avatarInput = ref<HTMLInputElement>(), bannerInput = ref<HTMLInputElement>()
const field = ref<'avatar' | 'banner'>('avatar'), ready = ref(false), exporting = ref(false), error = ref('')
const headingId = useId()
const previewHeadingId = useId(), previewDialog = ref<HTMLDialogElement>()
const previewUrl = ref(''), previewFailed = ref(false)
const downloading = ref(false), downloadError = ref('')
let downloadController: AbortController | undefined
let cropper: Cropper | undefined, url = '', sourceName = '', aspect = 1, version = 0
let initial: number[] = []
let observer: ResizeObserver | undefined
function choose(kind: 'avatar' | 'banner', ratio = 4) {
  field.value = kind; aspect = kind === 'avatar' ? 1 : Number.isFinite(ratio) && ratio > 0 ? ratio : 4
  ;(kind === 'avatar' ? avatarInput : bannerInput).value?.click()
}
function preview(kind: 'avatar' | 'banner', source: string | null | undefined, ratio = 4) {
  field.value = kind; aspect = kind === 'avatar' ? 1 : Number.isFinite(ratio) && ratio > 0 ? ratio : 4
  previewUrl.value = source || ''; previewFailed.value = false
  if (source) {
    const original = new URL(source, window.location.href)
    if (original.origin === window.location.origin && original.pathname.startsWith('/legacy-files/')) {
      original.searchParams.delete('variant')
      previewUrl.value = original.pathname + original.search
    }
  }
  previewDialog.value?.showModal()
}
function cancelDownload() { downloadController?.abort(); downloadController = undefined; downloading.value = false; downloadError.value = '' }
async function downloadCurrent() {
  if (!previewUrl.value || downloading.value) return
  const controller = new AbortController(); downloadController = controller
  const kind = field.value
  downloading.value = true; downloadError.value = ''
  try {
    const response = await fetch(previewUrl.value, { credentials: 'same-origin', signal: controller.signal })
    if (!response.ok) throw new Error('图片下载失败，请重试。')
    const blob = await response.blob()
    if (downloadController !== controller || !previewDialog.value?.open) return
    const extensions: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'avif' }
    const objectUrl = URL.createObjectURL(blob), link = document.createElement('a')
    link.href = objectUrl; link.download = `${kind === 'avatar' ? 'avatar' : 'profile-cover'}.${extensions[blob.type.split(';')[0]!] || 'img'}`
    document.body.appendChild(link)
    try { link.click() }
    finally { link.remove(); setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000) }
  } catch (cause) { if (!controller.signal.aborted && downloadController === controller) downloadError.value = errorMessage(cause) }
  finally { if (downloadController === controller) { downloading.value = false; downloadController = undefined } }
}
function cleanup() {
  version++; ready.value = false; exporting.value = false
  observer?.disconnect(); observer = undefined
  cropper?.destroy(); cropper = undefined; host.value?.replaceChildren()
  if (url) URL.revokeObjectURL(url)
  url = ''
}
function close() { dialog.value?.close() }
async function selected(event: Event, kind: 'avatar' | 'banner') {
  const input = event.target as HTMLInputElement, file = input.files?.[0]
  input.value = ''
  if (!file) return
  previewDialog.value?.close()
  if (field.value !== kind) aspect = kind === 'avatar' ? 1 : 4
  cleanup(); error.value = ''; field.value = kind
  if (kind === 'avatar') aspect = 1
  sourceName = file.name; url = URL.createObjectURL(file)
  dialog.value?.showModal()
  const current = version
  try {
    if (!file.type.startsWith('image/')) throw new Error('请选择图片文件。')
    const { default: Cropper } = await import('cropperjs')
    if (current !== version) return
    await nextTick()
    const image = new Image(); image.src = url; image.alt = ''
    cropper = new Cropper(image, { container: host.value!, template: `
      <cropper-canvas>
        <cropper-image translatable scalable initial-fit="contain" zoom-around-center></cropper-image>
        <cropper-shade></cropper-shade>
        <cropper-handle action="move" plain></cropper-handle>
        <cropper-selection outlined precise border-radius="${kind === 'avatar' ? '50%' : '0'}">
          <cropper-grid aria-hidden="true" covered></cropper-grid>
          <cropper-crosshair centered aria-hidden="true"></cropper-crosshair>
        </cropper-selection>
      </cropper-canvas>` })
    const engine = cropper, cropImage = engine.getCropperImage()!
    const decoded = await cropImage.$ready()
    if (current !== version) return
    const canvas = engine.getCropperCanvas()!, selection = engine.getCropperSelection()!
    let minimumScale = 0, constraining = false
    cropImage.addEventListener('transform', event => {
      if (!ready.value || constraining) return
      const { matrix } = (event as CustomEvent<{ matrix: number[] }>).detail
      const scale = Math.max(matrix[0]!, minimumScale)
      const width = decoded.naturalWidth, height = decoded.naturalHeight
      // Clamp the attempted transform instead of rejecting a whole zoom step at the edge.
      const x = Math.min(selection.x + width * (scale - 1) / 2, Math.max(selection.x + selection.width - width * (scale + 1) / 2, matrix[4]!))
      const y = Math.min(selection.y + height * (scale - 1) / 2, Math.max(selection.y + selection.height - height * (scale + 1) / 2, matrix[5]!))
      if (Math.abs(scale - matrix[0]!) < 1e-7 && Math.abs(x - matrix[4]!) < 1e-7 && Math.abs(y - matrix[5]!) < 1e-7) return
      event.preventDefault(); constraining = true
      try { cropImage.$setTransform(scale, 0, 0, scale, x, y) }
      finally { constraining = false }
    })
    async function fit() {
      ready.value = false
      const width = Math.min(canvas.clientWidth * .88, canvas.clientHeight * .84 * aspect), height = width / aspect
      const x = (canvas.clientWidth - width) / 2, y = (canvas.clientHeight - height) / 2
      selection.$change(x, y, width, height, aspect)
      const scale = Math.max(width / decoded.naturalWidth, height / decoded.naturalHeight)
      minimumScale = scale
      cropImage.$setTransform(scale, 0, 0, scale, (canvas.clientWidth - decoded.naturalWidth) / 2, (canvas.clientHeight - decoded.naturalHeight) / 2)
      initial = cropImage.$getTransform(); ready.value = true
    }
    await fit()
    if (current !== version) return
    observer = new ResizeObserver(() => { if (ready.value && !exporting.value) void fit() })
    observer.observe(host.value!)
  } catch (cause) { if (current === version) error.value = `图片无法裁切：${errorMessage(cause)}` }
}
function zoom(value: number) { cropper?.getCropperImage()?.$zoom(value) }
function reset() { cropper?.getCropperImage()?.$setTransform(initial) }
function move(event: KeyboardEvent) {
  const offsets: Record<string, [number, number]> = { ArrowLeft: [-8, 0], ArrowRight: [8, 0], ArrowUp: [0, -8], ArrowDown: [0, 8] }
  const offset = offsets[event.key]
  if (offset && ready.value) { event.preventDefault(); cropper?.getCropperImage()?.$move(...offset) }
}
async function confirm() {
  if (!ready.value || exporting.value || !cropper) return
  const current = version, kind = field.value
  exporting.value = true; error.value = ''
  try {
    const width = kind === 'avatar' ? 512 : 1920
    const canvas = await cropper.getCropperSelection()!.$toCanvas({ width })
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('请重新选择图片。')), 'image/webp', .92))
    if (current !== version) return
    emit('cropped', new File([blob], `${sourceName.replace(/\.[^.]+$/, '')}-cropped.webp`, { type: blob.type }), kind)
    close()
  } catch (cause) { if (current === version) error.value = errorMessage(cause) }
  finally { if (current === version) exporting.value = false }
}
defineExpose({ choose, preview })
onBeforeUnmount(() => { cancelDownload(); previewDialog.value?.close(); close(); cleanup() })
</script>

<template>
  <input ref="avatarInput" hidden type="file" aria-label="头像" accept="image/jpeg,image/png,image/webp,image/gif,image/avif" @change="selected($event, 'avatar')" />
  <input ref="bannerInput" hidden type="file" aria-label="主页封面" accept="image/jpeg,image/png,image/webp,image/gif,image/avif" @change="selected($event, 'banner')" />
  <dialog ref="previewDialog" class="profile-media-dialog profile-image-preview" :aria-labelledby="previewHeadingId" @close="cancelDownload">
    <header class="crop-heading"><h2 :id="previewHeadingId">{{ field === 'avatar' ? '当前头像' : '当前背景' }}</h2><button type="button" class="icon-button" aria-label="关闭图片预览" title="关闭图片预览" autofocus @click="previewDialog?.close()"><X :size="20" /></button></header>
    <div class="image-preview-stage"><img v-if="previewUrl && !previewFailed" :key="previewUrl" :src="previewUrl" :alt="field === 'avatar' ? '当前头像' : '当前背景'" :class="{ 'avatar-preview': field === 'avatar' }" @error="previewFailed = true" /><p v-else class="image-preview-empty" role="status"><ImageIcon :size="32" aria-hidden="true" />{{ previewFailed ? '图片加载失败，请重试或更换图片。' : field === 'avatar' ? '尚未设置头像' : '尚未设置背景' }}</p></div>
    <p v-if="downloadError" class="crop-error" role="alert">{{ downloadError }}</p>
    <footer class="image-preview-actions"><button type="button" class="button primary" @click="choose(field, aspect)"><ImagePlus :size="18" aria-hidden="true" />{{ field === 'avatar' ? '更换头像' : '更换背景' }}</button><button v-if="previewUrl" type="button" class="button subtle" :disabled="downloading" @click="downloadCurrent"><Download :size="18" aria-hidden="true" />{{ downloading ? '下载中…' : '下载图片' }}</button></footer>
  </dialog>
  <dialog ref="dialog" class="profile-media-dialog profile-crop-dialog" :aria-labelledby="headingId" @close="cleanup">
    <header class="crop-heading"><h2 :id="headingId">{{ field === 'avatar' ? '裁切头像' : '裁切封面' }}</h2><button type="button" class="icon-button" aria-label="取消裁切" title="取消裁切" autofocus @click="close"><X :size="20" /></button></header>
    <div ref="host" class="crop-stage" tabindex="0" role="group" aria-label="裁切区域，可拖动图片或使用方向键调整位置" @keydown="move" />
    <p v-if="error" class="crop-error" role="alert">{{ error }}</p><p v-else-if="!ready" class="crop-status" role="status">正在载入图片…</p>
    <footer class="crop-footer"><button type="button" class="button subtle" @click="close">取消</button><div class="crop-tools"><button type="button" class="icon-button" aria-label="缩小图片" title="缩小图片" :disabled="!ready || exporting" @click="zoom(-.1)"><Minus :size="18" /></button><button type="button" class="icon-button" aria-label="重置裁切" title="重置裁切" :disabled="!ready || exporting" @click="reset"><RotateCcw :size="18" /></button><button type="button" class="icon-button" aria-label="放大图片" title="放大图片" :disabled="!ready || exporting" @click="zoom(.1)"><Plus :size="18" /></button></div><button type="button" class="button primary" :disabled="!ready || exporting" @click="confirm">{{ exporting ? '正在处理…' : '确认裁切' }}</button></footer>
  </dialog>
</template>

<style scoped>
.profile-media-dialog { width: min(760px, calc(100vw - 32px)); max-height: calc(100dvh - 32px); margin: auto; padding: 0; border: 0; border-radius: 8px; background: var(--canvas); color: var(--ink); overflow: auto; }
.profile-media-dialog:modal { overscroll-behavior: contain; }
.profile-media-dialog::backdrop { background: #000b; overflow: hidden; overscroll-behavior: contain; }
.crop-heading { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 12px 16px; }
.crop-heading h2 { font-size: 18px; line-height: 28px; }
.image-preview-stage { display: grid; place-items: center; height: clamp(200px, 52dvh, 480px); padding: 16px; background: #151619; }
.image-preview-stage img { display: block; width: 100%; height: 100%; min-height: 0; object-fit: contain; }
.image-preview-stage img.avatar-preview { width: min(320px, 100%); height: auto; max-height: 100%; aspect-ratio: 1; border-radius: 50%; }
.image-preview-empty { display: grid; justify-items: center; gap: 12px; padding: 16px; color: #d8dde7; font-size: 14px; text-align: center; }
.image-preview-actions { display: flex; flex-wrap: wrap; justify-content: center; gap: 12px; padding: 16px; }
.image-preview-actions .button { min-height: 44px; }
.crop-stage { height: clamp(200px, 52dvh, 480px); width: 100%; overflow: hidden; background: #151619; }
.crop-stage :deep(cropper-canvas) { width: 100%; height: 100%; }
.crop-stage :deep(cropper-selection) { pointer-events: none; }
.crop-stage :deep(cropper-shade) { --theme-color: rgb(0 0 0 / 58%); }
.crop-footer, .crop-tools { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.crop-footer { padding: 12px 16px; }
.crop-footer .icon-button { width: 44px; height: 44px; }
.crop-footer .button { min-height: 44px; }
.crop-error, .crop-status { padding: 8px 16px 0; font-size: 13px; }
.crop-error { color: var(--danger); }
@media (max-width: 599px) { .profile-media-dialog { width: 100%; max-height: 100dvh; border-radius: 0; }.crop-footer { padding-inline: 8px; gap: 4px; }.crop-tools { gap: 0; } }
</style>
