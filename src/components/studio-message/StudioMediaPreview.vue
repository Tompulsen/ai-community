<!-- Adapted from octopus_chat app/components/gallery/lightbox.tsx (MIT). -->
<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { ChevronLeft, ChevronRight, Copy, Download, LoaderCircle, Minus, Plus, RotateCcw, X } from '@lucide/vue'
import { copyMediaImage, mediaSource, readableMedia } from '../../native-studio'
import { errorMessage, notify, session } from '../../state'

const props = withDefaults(defineProps<{
  items: { src?: string; kind: 'image' | 'video'; alt?: string }[]
  label?: string
  closeLabel?: string
  onDownload?: (index: number) => Promise<unknown>
  onCopy?: (index: number) => Promise<unknown>
}>(), { label: '原始媒体预览', closeLabel: '关闭媒体预览' })
const emit = defineEmits<{ close: [] }>()
const dialog = ref<HTMLDialogElement>(), video = ref<HTMLVideoElement>()
const opened = ref(false), index = ref(0), scale = ref(1), offset = ref({ x: 0, y: 0 })
const loading = ref(true), failed = ref(false), attempt = ref(0), actionError = ref('')
const action = ref<'download' | 'copy'>()
const current = computed(() => props.items[index.value])
const source = computed(() => {
  const item = current.value, value = item?.src
  if (!value) return
  if (value.startsWith('studio-asset:') || value.startsWith('legacy-gallery:')) return mediaSource(value, false, item.kind)
  try {
    const url = new URL(value, location.href)
    if (url.protocol === 'blob:') return value
    if (url.protocol === 'data:') return value.startsWith(`data:${item.kind}/`) ? value : undefined
    if (['http:', 'https:'].includes(url.protocol) && !url.username && !url.password) return url.origin === location.origin ? url.href : mediaSource(url.href, false, item.kind)
  } catch { /* Invalid references are never fetched or rendered. */ }
})
let acceptedOwner: string | undefined, operation = 0, pending: AbortController | undefined
let oldOverflow: string | undefined, notified = true
let dragging: { id: number; target: HTMLElement; x: number; y: number; left: number; top: number } | undefined
const isDragging = ref(false)
function stopVideo() {
  const element = video.value
  if (element) { element.pause(); element.removeAttribute('src'); element.load() }
}
function playVideo() {
  document.querySelectorAll('video').forEach(element => { if (element !== video.value) element.pause() })
}
function endPan(event?: PointerEvent) {
  if (!dragging || event && event.pointerId !== dragging.id) return
  const previous = dragging
  dragging = undefined; isDragging.value = false
  if (previous.target.hasPointerCapture(previous.id)) previous.target.releasePointerCapture(previous.id)
}
function reset() { endPan(); scale.value = 1; offset.value = { x: 0, y: 0 } }
function zoom(value: number) {
  if (current.value?.kind !== 'image') return
  scale.value = Math.min(5, Math.max(.5, value))
  if (scale.value <= 1) offset.value = { x: 0, y: 0 }
}
function startPan(event: PointerEvent) {
  if (current.value?.kind !== 'image' || scale.value <= 1 || dragging || event.button !== 0) return
  event.preventDefault()
  const target = event.currentTarget as HTMLElement
  dragging = { id: event.pointerId, target, x: event.clientX, y: event.clientY, left: offset.value.x, top: offset.value.y }
  isDragging.value = true; target.setPointerCapture(event.pointerId)
}
function pan(event: PointerEvent) {
  if (!dragging || dragging.id !== event.pointerId) return
  event.preventDefault()
  offset.value = { x: dragging.left + event.clientX - dragging.x, y: dragging.top + event.clientY - dragging.y }
}
function wheel(event: WheelEvent) {
  if (current.value?.kind !== 'image') return
  event.preventDefault(); event.stopPropagation(); zoom(scale.value - event.deltaY * .001)
}
function release() {
  operation++; pending?.abort(); pending = undefined; action.value = undefined
  endPan(); stopVideo()
  window.removeEventListener('blur', blur)
  if (oldOverflow !== undefined) { document.body.style.overflow = oldOverflow; oldOverflow = undefined }
}
function closed() {
  if (dialog.value?.open) return
  opened.value = false; release()
  if (!notified) { notified = true; emit('close') }
}
function close() {
  if (!opened.value && !dialog.value?.open) return
  opened.value = false; release()
  if (dialog.value?.open) dialog.value.close()
  else closed()
}
function blur() { endPan() }
async function open(position = 0) {
  if (!props.items.length) return
  const owner = session.user?.id
  stopVideo(); reset()
  attempt.value++
  index.value = Math.min(props.items.length - 1, Math.max(0, Number.isFinite(position) ? Math.floor(position) : 0))
  acceptedOwner = owner; loading.value = true; failed.value = false; actionError.value = ''
  if (!opened.value) {
    oldOverflow = document.body.style.overflow; document.body.style.overflow = 'hidden'
    window.addEventListener('blur', blur)
  }
  opened.value = true; notified = false
  await nextTick()
  if (owner !== session.user?.id || !opened.value) return
  if (!dialog.value?.open) dialog.value?.showModal()
}
defineExpose({ open, close })
function choose(position: number) {
  if (position < 0 || position >= props.items.length || position === index.value) return
  stopVideo(); index.value = position
}
function keys(event: KeyboardEvent) {
  if (event.target instanceof HTMLSelectElement || event.target instanceof HTMLVideoElement) return
  if (event.key === 'ArrowLeft' && props.items.length > 1) { event.preventDefault(); choose(index.value - 1) }
  else if (event.key === 'ArrowRight' && props.items.length > 1) { event.preventDefault(); choose(index.value + 1) }
}
watch([index, source], () => {
  operation++; pending?.abort(); pending = undefined; action.value = undefined; actionError.value = ''
  stopVideo(); reset(); loading.value = true; failed.value = false
})
watch(() => props.items.length, length => { if (!length) close(); else if (index.value >= length) choose(length - 1) })
watch(() => session.user?.id, () => close())
onBeforeUnmount(() => { release(); dialog.value?.close() })
async function defaultDownload(item: NonNullable<typeof current.value>, controller: AbortController, accepted: number) {
  if (!item.src) throw new Error('文件正在加载，请稍后重试。')
  const readable = item.src.startsWith('blob:') || item.src.startsWith('data:') ? item.src : await readableMedia(item.src, item.kind)
  if (controller.signal.aborted || accepted !== operation || acceptedOwner !== session.user?.id) return
  const response = await fetch(readable, { credentials: 'same-origin', signal: controller.signal })
  if (!response.ok) throw new Error('文件下载失败，请重试。')
  const blob = await response.blob()
  if (!blob.size || !blob.type.startsWith(`${item.kind}/`)) throw new Error('文件格式无效，请重新加载。')
  if (controller.signal.aborted || accepted !== operation || acceptedOwner !== session.user?.id) return
  const extension = blob.type.split('/')[1]!.split(';')[0]!.replace(/[^a-z0-9]/g, '') || (item.kind === 'image' ? 'png' : 'mp4')
  const link = document.createElement('a'), objectUrl = URL.createObjectURL(blob)
  link.href = objectUrl; link.download = `media-${index.value + 1}.${extension}`
  link.click(); setTimeout(() => URL.revokeObjectURL(objectUrl), 1000)
}
async function run(kind: 'download' | 'copy') {
  if (action.value || !current.value?.src || acceptedOwner !== session.user?.id) return
  const item = { ...current.value }, selected = index.value, accepted = ++operation
  const controller = new AbortController()
  pending?.abort(); pending = controller; action.value = kind; actionError.value = ''
  try {
    if (kind === 'copy') await (props.onCopy ? props.onCopy(selected) : copyMediaImage(item.src!))
    else await (props.onDownload ? props.onDownload(selected) : defaultDownload(item, controller, accepted))
    if (accepted === operation && acceptedOwner === session.user?.id && opened.value) notify(kind === 'copy' ? '图片已复制' : '已发起下载')
  } catch (error) {
    if (!controller.signal.aborted && accepted === operation && acceptedOwner === session.user?.id && opened.value) actionError.value = errorMessage(error)
  } finally { if (accepted === operation) { pending = undefined; action.value = undefined } }
}
</script>

<template>
  <Teleport to="body">
    <dialog ref="dialog" class="media-lightbox" :class="{ 'has-sequence': items.length > 1 }" :aria-label="label" @cancel.prevent="close" @close="closed" @keydown="keys" @click.self="close">
      <template v-if="opened">
        <div class="lightbox-actions" role="group" aria-label="媒体操作">
          <button class="viewer-button" type="button" aria-label="下载原文件" title="下载原文件" :disabled="!source || !!action" @click="run('download')"><LoaderCircle v-if="action === 'download'" :size="20" /><Download v-else :size="20" /></button>
          <button v-if="current?.kind === 'image'" class="viewer-button" type="button" aria-label="复制图片" title="复制图片" :disabled="!source || !!action" @click="run('copy')"><LoaderCircle v-if="action === 'copy'" :size="20" /><Copy v-else :size="20" /></button>
          <button class="viewer-button" type="button" :aria-label="closeLabel" :title="closeLabel" autofocus @click="close"><X :size="22" /></button>
        </div>
        <div class="lightbox-stage" @click.self="close">
          <div class="lightbox-content" :class="{ 'is-image': current?.kind === 'image', 'is-dragging': isDragging, zoomed: scale > 1 }" @click.stop @wheel="wheel" @pointerdown="startPan" @pointermove="pan" @pointerup="endPan" @pointercancel="endPan" @lostpointercapture="endPan" @dblclick="current?.kind === 'image' && (scale > 1 ? reset() : zoom(2.5))">
            <div v-if="failed" class="lightbox-error" role="status"><p>{{ current?.kind === 'video' ? '视频加载失败' : '图片加载失败' }}</p><button type="button" class="viewer-retry" @click="failed = false; loading = true; attempt++">重新加载</button></div>
            <template v-else>
              <div v-if="loading || !source" class="lightbox-loading" role="status"><LoaderCircle :size="28" aria-hidden="true" /><span class="viewer-sr-only">正在加载原文件</span></div>
              <img v-if="current?.kind === 'image' && source" :key="`${index}:${attempt}:${source}`" draggable="false" :src="source" :alt="current.alt || ''" :style="{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})` }" @load="loading = false" @error="loading = false; failed = true" />
              <video v-else-if="current?.kind === 'video' && source" :key="`${index}:${attempt}:${source}`" ref="video" :src="source" :aria-label="current.alt || '视频预览'" controls playsinline preload="metadata" @loadeddata="loading = false" @error="loading = false; failed = true" @play="playVideo" @dblclick.stop />
            </template>
          </div>
        </div>
        <p v-if="actionError" class="lightbox-action-error" role="alert">{{ actionError }}</p>
        <div v-if="current?.kind === 'image' || items.length > 1" class="lightbox-controls">
          <template v-if="current?.kind === 'image'"><button class="viewer-button" type="button" aria-label="缩小" title="缩小" :disabled="scale <= .5" @click="zoom(scale - .5)"><Minus :size="18" /></button><output aria-label="缩放比例">{{ Math.round(scale * 100) }}%</output><button class="viewer-button" type="button" aria-label="放大" title="放大" :disabled="scale >= 5" @click="zoom(scale + .5)"><Plus :size="18" /></button><button class="viewer-button" type="button" aria-label="重置缩放" title="重置缩放" @click="reset"><RotateCcw :size="18" /></button></template>
          <div v-if="items.length > 1" class="lightbox-sequence"><button class="viewer-button" type="button" aria-label="上一张" title="上一张" :disabled="index === 0" @click="choose(index - 1)"><ChevronLeft :size="18" /></button><select :value="index" aria-label="预览图片序号" @change="choose(Number(($event.target as HTMLSelectElement).value))"><option v-for="(_, position) in items" :key="position" :value="position">{{ position + 1 }} / {{ items.length }}</option></select><button class="viewer-button" type="button" aria-label="下一张" title="下一张" :disabled="index >= items.length - 1" @click="choose(index + 1)"><ChevronRight :size="18" /></button></div>
        </div>
      </template>
    </dialog>
  </Teleport>
</template>

<style scoped>
.media-lightbox { position: fixed; inset: 0; box-sizing: border-box; width: 100%; max-width: none; height: 100dvh; max-height: none; margin: 0; padding: 0; border: 0; border-radius: 0; overflow: hidden; background: rgb(0 0 0 / 94%); color: #fff; overscroll-behavior: contain; color-scheme: dark; }
.media-lightbox::backdrop { background: rgb(0 0 0 / 30%); }
.lightbox-stage { position: absolute; inset: 64px 16px 84px; display: flex; align-items: center; justify-content: center; overflow: hidden; }
.lightbox-content { position: relative; display: flex; align-items: center; justify-content: center; max-width: 100%; max-height: 100%; }
.lightbox-content.is-image { touch-action: none; cursor: zoom-in; }.lightbox-content.zoomed { cursor: grab; }.lightbox-content.is-dragging { cursor: grabbing; }
.lightbox-content img, .lightbox-content video { display: block; max-width: min(90vw, calc(100vw - 32px)); max-height: calc(100dvh - 164px); width: auto; height: auto; object-fit: contain; border-radius: 8px; }
.lightbox-content img { user-select: none; transition: transform .2s ease-out; }.lightbox-content.is-dragging img { transition: none; }
.lightbox-content video { max-width: min(1200px, calc(100vw - 32px)); }
.lightbox-actions { position: absolute; right: max(16px, env(safe-area-inset-right)); top: max(12px, env(safe-area-inset-top)); z-index: 2; display: flex; align-items: center; gap: 8px; }
.viewer-button { display: grid; place-items: center; flex: none; width: 40px; height: 40px; padding: 0; border: 0; border-radius: 6px; color: #f5f5f5; background: rgb(38 38 38 / 85%); cursor: pointer; }
.viewer-button:hover:not(:disabled), .viewer-retry:hover { background: #404040; }.viewer-button:disabled { opacity: .4; cursor: default; }
.viewer-button:focus-visible, select:focus-visible, .viewer-retry:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }
.lightbox-controls { position: absolute; bottom: max(16px, env(safe-area-inset-bottom)); left: 50%; transform: translateX(-50%); z-index: 2; display: flex; align-items: center; justify-content: center; flex-wrap: wrap; gap: 4px; width: max-content; max-width: calc(100% - 24px); padding: 4px; border-radius: 8px; background: rgb(24 24 24 / 94%); }
.lightbox-controls .viewer-button { background: transparent; }.lightbox-controls output { min-width: 48px; text-align: center; font-size: 13px; font-variant-numeric: tabular-nums; }
.lightbox-sequence { display: flex; align-items: center; gap: 4px; }.lightbox-sequence select { box-sizing: border-box; width: auto; max-width: 104px; height: 40px; padding: 4px 8px; border: 0; border-radius: 4px; font: inherit; font-size: 13px; color: #f5f5f5; background: #262626; font-variant-numeric: tabular-nums; }
.lightbox-loading { position: absolute; inset: 0; min-width: 120px; min-height: 120px; display: flex; align-items: center; justify-content: center; pointer-events: none; }.lightbox-loading svg { animation: spin 1s linear infinite; }
.lightbox-error { min-width: min(240px, calc(100vw - 48px)); padding: 24px; text-align: center; }.lightbox-error p { margin: 0 0 16px; font-size: 14px; }
.viewer-retry { border: 0; border-radius: 6px; padding: 10px 16px; font: inherit; font-size: 14px; color: #fff; background: #262626; cursor: pointer; }
.lightbox-action-error { position: absolute; top: 64px; left: 24px; right: 24px; margin: 0; color: #fff; font-size: 14px; line-height: 24px; overflow-wrap: anywhere; pointer-events: none; }
.viewer-sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
@keyframes spin { to { transform: rotate(360deg); } }
@media (max-width: 639px) { .viewer-button { width: 44px; height: 44px; }.lightbox-controls { gap: 0; }.lightbox-controls output { min-width: 44px; }.lightbox-sequence { gap: 0; }.lightbox-content img, .lightbox-content video { border-radius: 4px; max-height: calc(100dvh - 184px); }.lightbox-stage { inset: 68px 12px 104px; } }
@media (max-width: 639px) { .has-sequence .lightbox-stage { bottom: 128px; }.has-sequence .lightbox-content img, .has-sequence .lightbox-content video { max-height: calc(100dvh - 208px); } }
@media (prefers-reduced-motion: reduce) { .lightbox-content img { transition: none; }.lightbox-loading svg { animation: none; } }
</style>
