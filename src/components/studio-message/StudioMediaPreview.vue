<!-- Adapted from octopus_chat app/components/gallery/lightbox.tsx (MIT). -->
<!-- Zoom gestures also adapted from QXChat app/components/ui-lib.tsx (MIT, NextChat 2023–2025). -->
<script setup lang="ts">
import { computed, defineAsyncComponent, inject, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { ChevronLeft, ChevronRight, Copy, Download, LoaderCircle, Minus, Plus, RotateCcw, SquarePen, X } from '@lucide/vue'
import { copyMediaImage, forgetCreationImage, mediaSource, readableMedia, readCreationImage } from '../../native-studio'
import { errorMessage, notify, session } from '../../state'
import { imageDownload, imageDownloadUrl, originalImageUrl } from '../../image-download'
import { chooseImageDownloadFormat } from '../../image-download-choice'
import type { ImageDownloadChoice } from '../../../shared/image-download'
import { clampMediaOffset, mediaScale, mediaZoomOffset, MIN_MEDIA_SCALE, MAX_MEDIA_SCALE, type MediaPoint } from '../../media-zoom'

import { studioCanvasKey } from '../../studio-canvas'
import { chats } from '../../native-chat'
const StudioImageCanvas = defineAsyncComponent(() => import('../StudioImageCanvas.vue'))
const canvas = inject(studioCanvasKey, undefined), editing = ref(false)
const canvasScope = computed(() => canvas?.scope.value || `${session.user?.id}:${chats.activeId}`)
const props = withDefaults(defineProps<{
  items: { id?: string; src?: string; previewSrc?: string; kind: 'image' | 'video'; alt?: string }[]
  label?: string
  closeLabel?: string
  onDownload?: (index: number, format?: ImageDownloadChoice, signal?: AbortSignal) => Promise<unknown>
  onCopy?: (index: number) => Promise<unknown>
}>(), { label: '原始媒体预览', closeLabel: '关闭媒体预览' })
const emit = defineEmits<{ close: [] }>()
const dialog = ref<HTMLDialogElement>(), video = ref<HTMLVideoElement>()
const stage = ref<HTMLElement>(), picture = ref<HTMLImageElement>()
const opened = ref(false), index = ref(0), scale = ref(1), offset = ref({ x: 0, y: 0 })
const loading = ref(true), failed = ref(false), attempt = ref(0), actionError = ref('')
const imageSource = ref(''), previewReady = ref(false), previewFailed = ref(false)
const localPreview = ref('')
const action = ref<'download' | 'copy'>()
const current = computed(() => props.items[index.value])
function safeSource(value: string | undefined, kind: 'image' | 'video', original = true) {
  if (!value) return
  if (value.startsWith('studio-asset:') || value.startsWith('legacy-gallery:')) return kind === 'image' && original ? value : mediaSource(value, !original, kind)
  try {
    const url = new URL(value, location.href)
    if (url.protocol === 'blob:') return value
    if (url.protocol === 'data:') return value.startsWith(`data:${kind}/`) ? value : undefined
    if (['http:', 'https:'].includes(url.protocol) && !url.username && !url.password) return url.origin === location.origin ? (kind === 'image' && original ? originalImageUrl(url.href) : url.href) : mediaSource(url.href, false, kind)
  } catch { /* Invalid references are never fetched or rendered. */ }
}
const source = computed(() => safeSource(current.value?.src, current.value?.kind || 'image'))
const previewSource = computed(() => {
  const value = /^(?:studio-asset:|legacy-gallery:)/.test(current.value?.previewSrc || '') ? localPreview.value : safeSource(current.value?.previewSrc, 'image', false)
  return value !== source.value && !previewFailed.value ? value : undefined
})
const displayedImage = computed(() => imageSource.value || previewSource.value)
let imageOperation = 0, imageController: AbortController | undefined, imageTimer: ReturnType<typeof setTimeout> | undefined
let acceptedOwner: string | undefined, operation = 0, pending: AbortController | undefined
let oldOverflow: string | undefined, notified = true
const pointers = new Map<number, MediaPoint>()
let gesture: { center: MediaPoint; distance: number; scale: number; offset: MediaPoint } | undefined
let tap: { id: number; point: MediaPoint; time: number; background: boolean } | undefined, lastTap: { point: MediaPoint; time: number } | undefined
let suppressClickUntil = 0, lastTouchAt = -Infinity, observer: ResizeObserver | undefined
const isDragging = ref(false)
const canZoom = computed(() => current.value?.kind === 'image' && !!displayedImage.value && (previewReady.value || !loading.value && !failed.value))
function stopVideo() {
  const element = video.value
  if (element) { element.pause(); element.removeAttribute('src'); element.load() }
}
function playVideo() {
  document.querySelectorAll('video').forEach(element => { if (element !== video.value) element.pause() })
}
function endPan() {
  const ids = [...pointers.keys()]
  pointers.clear(); gesture = undefined; tap = undefined; lastTap = undefined; isDragging.value = false
  for (const id of ids) if (stage.value?.hasPointerCapture(id)) stage.value.releasePointerCapture(id)
}
function reset() { endPan(); scale.value = 1; offset.value = { x: 0, y: 0 } }
function contain(point: MediaPoint, value = scale.value) {
  if (!picture.value || !stage.value) return { x: 0, y: 0 }
  return clampMediaOffset(point, value, { width: picture.value.clientWidth, height: picture.value.clientHeight },
    { width: stage.value.clientWidth, height: stage.value.clientHeight })
}
function localPoint(point: MediaPoint) {
  const bounds = stage.value!.getBoundingClientRect()
  return { x: point.x - bounds.x - bounds.width / 2, y: point.y - bounds.y - bounds.height / 2 }
}
function zoom(value: number, anchor: MediaPoint = { x: 0, y: 0 }) {
  if (!canZoom.value) return
  endPan()
  const next = mediaScale(value)
  offset.value = contain(mediaZoomOffset(offset.value, next / scale.value, anchor), next)
  scale.value = next
}
function trackGesture() {
  const [first, second] = [...pointers.values()]
  if (!first) { gesture = undefined; isDragging.value = false; return }
  gesture = { center: localPoint(second ? { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 } : first),
    distance: second ? Math.hypot(second.x - first.x, second.y - first.y) : 0, scale: scale.value, offset: { ...offset.value } }
  isDragging.value = pointers.size > 1 || scale.value > 1
}
function startPan(event: PointerEvent) {
  if (!canZoom.value || event.button !== 0 || pointers.size >= 2) return
  event.preventDefault()
  if (event.pointerType === 'touch') lastTouchAt = performance.now()
  const point = { x: event.clientX, y: event.clientY }
  pointers.set(event.pointerId, point)
  tap = pointers.size === 1 ? { id: event.pointerId, point, time: performance.now(), background: event.target === stage.value } : undefined
  if (pointers.size > 1) { lastTap = undefined; suppressClickUntil = performance.now() + 500 }
  stage.value!.setPointerCapture(event.pointerId)
  trackGesture()
}
function pan(event: PointerEvent) {
  if (!gesture || !pointers.has(event.pointerId)) return
  if (event.pointerType === 'mouse' && event.buttons === 0) { endPan(); return }
  event.preventDefault()
  const point = { x: event.clientX, y: event.clientY }
  pointers.set(event.pointerId, point)
  if (tap && Math.hypot(point.x - tap.point.x, point.y - tap.point.y) > 6) { tap = undefined; lastTap = undefined }
  if (!tap) suppressClickUntil = performance.now() + 500
  const [first, second] = [...pointers.values()]
  if (!first) return
  if (second && gesture.distance > 0) {
    const next = mediaScale(gesture.scale * Math.hypot(second.x - first.x, second.y - first.y) / gesture.distance)
    const center = localPoint({ x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 })
    offset.value = contain(mediaZoomOffset(gesture.offset, next / gesture.scale, gesture.center, center), next)
    scale.value = next
  } else if (!second && scale.value > 1) {
    const center = localPoint(first)
    offset.value = contain({ x: gesture.offset.x + center.x - gesture.center.x, y: gesture.offset.y + center.y - gesture.center.y })
  }
}
function finishPan(event: PointerEvent) {
  if (!pointers.has(event.pointerId)) return
  if (event.type !== 'pointerup') lastTap = undefined
  const touchTap = event.type === 'pointerup' && event.pointerType === 'touch' && tap?.id === event.pointerId && !tap.background && pointers.size === 1
    && performance.now() - tap.time < 300
  if (event.pointerType === 'touch') lastTouchAt = performance.now()
  if (!tap || !tap.background || event.type !== 'pointerup') suppressClickUntil = performance.now() + 500
  else suppressClickUntil = 0
  const point = pointers.get(event.pointerId)!
  pointers.delete(event.pointerId); tap = undefined
  if (stage.value?.hasPointerCapture(event.pointerId)) stage.value.releasePointerCapture(event.pointerId)
  trackGesture()
  if (touchTap) {
    if (lastTap && performance.now() - lastTap.time < 350 && Math.hypot(point.x - lastTap.point.x, point.y - lastTap.point.y) < 24) {
      suppressClickUntil = performance.now() + 500
      if (scale.value > 1) reset(); else zoom(2.5, localPoint(point))
      lastTap = undefined
    } else lastTap = { point, time: performance.now() }
  }
}
function doubleClick(event: MouseEvent) {
  if (!canZoom.value || performance.now() - lastTouchAt < 500) return
  if (scale.value > 1) reset(); else zoom(2.5, localPoint({ x: event.clientX, y: event.clientY }))
}
function stageClick(event: MouseEvent) {
  if (event.target === stage.value && performance.now() > suppressClickUntil) close()
}
function wheel(event: WheelEvent) {
  if (!canZoom.value) return
  event.preventDefault(); event.stopPropagation()
  const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? stage.value!.clientHeight : 1)
  zoom(scale.value * Math.exp(Math.max(-4, Math.min(4, -delta * .002))), localPoint({ x: event.clientX, y: event.clientY }))
}
function resized() { endPan(); offset.value = contain(offset.value) }
function loadedImage(event: Event) {
  if (event.currentTarget !== picture.value || picture.value?.getAttribute('src') !== displayedImage.value) return
  if (imageSource.value) { clearTimeout(imageTimer); loading.value = false; failed.value = false }
  else previewReady.value = true
  offset.value = contain(offset.value)
}
function imageFailed(event?: Event) {
  if (event && (event.currentTarget !== picture.value || picture.value?.getAttribute('src') !== displayedImage.value)) return
  if (!imageSource.value) { previewFailed.value = true; previewReady.value = false; return }
  if (source.value) forgetCreationImage(source.value)
  if (imageSource.value.startsWith('blob:')) URL.revokeObjectURL(imageSource.value)
  imageSource.value = ''; failedMedia()
}
function retryMedia() { reset(); failed.value = false; loading.value = true; attempt.value++ }
function failedMedia() { clearTimeout(imageTimer); endPan(); loading.value = false; failed.value = true }
function releaseImage() {
  imageOperation++; imageController?.abort(); imageController = undefined; clearTimeout(imageTimer)
  if (imageSource.value.startsWith('blob:')) URL.revokeObjectURL(imageSource.value)
  if (localPreview.value) URL.revokeObjectURL(localPreview.value)
  imageSource.value = ''; localPreview.value = ''
}
async function loadImage() {
  releaseImage(); previewReady.value = false; previewFailed.value = false
  if (!opened.value || current.value?.kind !== 'image') return
  const accepted = imageOperation
  if (!source.value) { imageTimer = setTimeout(failedMedia, 15000); return }
  const direct = new URL(source.value, location.href)
  if (direct.origin === location.origin && ['/files/', '/legacy-files/', '/assets/'].some(path => direct.pathname.startsWith(path))) {
    // Public uploads may exceed the studio's browser-storage limit.
    imageSource.value = source.value
    imageTimer = setTimeout(imageFailed, 300000)
    return
  }
  const controller = new AbortController()
  imageController = controller
  if (/^(?:studio-asset:|legacy-gallery:)/.test(current.value?.previewSrc || '')) {
    void readCreationImage(current.value!.previewSrc!, controller.signal, true).then(blob => {
      if (!controller.signal.aborted && accepted === imageOperation) localPreview.value = URL.createObjectURL(blob)
    }).catch(() => {})
  }
  try {
    const blob = await readCreationImage(source.value, controller.signal)
    if (controller.signal.aborted || accepted !== imageOperation) return
    imageSource.value = URL.createObjectURL(blob)
    imageTimer = setTimeout(imageFailed, 15000)
  } catch (cause) {
    if (controller.signal.aborted || accepted !== imageOperation) return
    if ((cause as { status?: number }).status === 0) {
      imageSource.value = source.value
      imageTimer = setTimeout(imageFailed, 300000)
    } else failedMedia()
  }
}
function blur() { endPan() }
function observeStage() {
  observer?.disconnect()
  observer = new ResizeObserver(resized)
  if (stage.value) observer.observe(stage.value)
}
function release() {
  operation++; pending?.abort(); pending = undefined; action.value = undefined
  releaseImage()
  endPan(); stopVideo()
  observer?.disconnect(); observer = undefined
  window.removeEventListener('blur', blur)
  if (oldOverflow !== undefined) { document.body.style.overflow = oldOverflow; oldOverflow = undefined }
}
function closed() {
  if (dialog.value?.open) return
  opened.value = false; editing.value = false; release()
  if (!notified) { notified = true; emit('close') }
}
function close() {
  if (!opened.value && !dialog.value?.open) return
  opened.value = false; editing.value = false; release()
  if (dialog.value?.open) dialog.value.close()
  else closed()
}
async function open(position = 0, editor = false) {
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
  editing.value = editor && current.value?.kind === 'image'
  opened.value = true; notified = false
  await nextTick()
  if (owner !== session.user?.id || !opened.value) return
  if (!dialog.value?.open) dialog.value?.showModal()
  observeStage()
}
async function editImage() {
  if (current.value?.kind !== 'image' || !current.value.src) return
  endPan(); releaseImage(); editing.value = true
}
async function backToPreview() {
  editing.value = false; await nextTick(); observeStage()
  dialog.value?.querySelector<HTMLButtonElement>('[aria-label="画布编辑"]')?.focus()
}
defineExpose({ open, close, openEditor: (position = 0) => open(position, true), download: () => run('download') })
function choose(position: number) {
  if (position < 0 || position >= props.items.length || position === index.value) return
  stopVideo(); index.value = position
}
function keys(event: KeyboardEvent) {
  if (editing.value) return
  if (event.target instanceof HTMLSelectElement || event.target instanceof HTMLVideoElement) return
  if (event.key === 'ArrowLeft' && props.items.length > 1) { event.preventDefault(); choose(index.value - 1) }
  else if (event.key === 'ArrowRight' && props.items.length > 1) { event.preventDefault(); choose(index.value + 1) }
  else if (canZoom.value && !event.ctrlKey && !event.metaKey && !event.altKey) {
    if (event.key === '+' || event.key === '=') { event.preventDefault(); zoom(scale.value * 1.2) }
    else if (event.key === '-') { event.preventDefault(); zoom(scale.value / 1.2) }
    else if (event.key === '0') { event.preventDefault(); reset() }
  }
}
watch([index, () => current.value?.id || current.value?.src], () => {
  operation++; pending?.abort(); pending = undefined; action.value = undefined; actionError.value = ''
})
watch([opened, editing, index, source, attempt], () => {
  stopVideo(); reset(); loading.value = true; failed.value = false
  if (editing.value) releaseImage(); else void loadImage()
})
watch(() => props.items.length, length => { if (!length) close(); else if (index.value >= length) choose(length - 1) })
watch(() => session.user?.id, () => close())
watch(canvasScope, () => close())
onBeforeUnmount(() => { release(); dialog.value?.close() })
async function defaultDownload(item: NonNullable<typeof current.value>, controller: AbortController, accepted: number, format?: ImageDownloadChoice) {
  if (!item.src) throw new Error('文件正在加载，请稍后重试。')
  let blob: Blob
  if (item.kind === 'image' && /^(?:studio-asset:|legacy-gallery:)/.test(item.src)) blob = await readCreationImage(item.src, controller.signal)
  else {
    const readable = item.src.startsWith('blob:') || item.src.startsWith('data:') ? item.src : await readableMedia(item.src, item.kind)
    if (controller.signal.aborted || accepted !== operation || acceptedOwner !== session.user?.id) return
    const response = await fetch(format ? imageDownloadUrl(readable, format) : readable, { credentials: 'same-origin', signal: controller.signal })
    if (!response.ok) throw new Error('文件下载失败，请重试。')
    blob = await response.blob()
  }
  if (!blob.size || !blob.type.startsWith(`${item.kind}/`)) throw new Error('文件格式无效，请重新加载。')
  if (item.kind === 'image' && format) blob = await imageDownload(blob, format, controller.signal)
  if (controller.signal.aborted || accepted !== operation || acceptedOwner !== session.user?.id) return
  const extension = blob.type === 'image/jpeg' ? 'jpg' : blob.type.split('/')[1]!.split(';')[0]!.replace(/[^a-z0-9]/g, '') || (item.kind === 'image' ? 'png' : 'mp4')
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
    const format = kind === 'download' && item.kind === 'image'
      ? await chooseImageDownloadFormat(controller.signal, () => accepted === operation && opened.value) : undefined
    if (kind === 'download' && item.kind === 'image' && !format) return
    if (kind === 'copy') await (props.onCopy ? props.onCopy(selected) : copyMediaImage(originalImageUrl(item.src!)))
    else await (props.onDownload ? props.onDownload(selected, format, controller.signal) : defaultDownload(item, controller, accepted, format))
    if (accepted === operation && acceptedOwner === session.user?.id && opened.value) notify(kind === 'copy' ? '图片已复制' : '已发起下载')
  } catch (error) {
    if (!controller.signal.aborted && accepted === operation && acceptedOwner === session.user?.id && opened.value) actionError.value = errorMessage(error)
  } finally { if (accepted === operation) { pending = undefined; action.value = undefined } }
}
</script>

<template>
  <Teleport to="body">
    <dialog ref="dialog" class="media-lightbox" :class="{ 'has-sequence': items.length > 1, 'is-editing': editing }" :aria-label="editing ? '图片画布' : label" @cancel.prevent="editing ? backToPreview() : close()" @close="closed" @keydown="keys" @click.self="close">
      <StudioImageCanvas v-if="opened && editing && current?.src" :key="`${canvasScope}:${current.src}`" :src="originalImageUrl(current.src)" :scope="canvasScope" :attachments="items" @back="backToPreview" @close="close" />
      <template v-else-if="opened">
        <div class="lightbox-actions" role="group" aria-label="媒体操作">
          <button v-if="current?.kind === 'image'" class="viewer-button" type="button" aria-label="画布编辑" title="画布编辑" :disabled="!source || !!action" @click="editImage"><SquarePen :size="20" /></button>
          <button class="viewer-button" type="button" :aria-label="current?.kind === 'image' ? '下载图片' : '下载原文件'" :title="current?.kind === 'image' ? '选择图片下载格式' : '下载原文件'" :disabled="!source || !!action" @click="run('download')"><LoaderCircle v-if="action === 'download'" :size="20" /><Download v-else :size="20" /></button>
          <button v-if="current?.kind === 'image'" class="viewer-button" type="button" aria-label="复制图片" title="复制图片" :disabled="!source || !!action" @click="run('copy')"><LoaderCircle v-if="action === 'copy'" :size="20" /><Copy v-else :size="20" /></button>
          <button class="viewer-button" type="button" :aria-label="closeLabel" :title="closeLabel" autofocus @click="close"><X :size="22" /></button>
        </div>
        <div ref="stage" class="lightbox-stage" :class="{ 'is-image': current?.kind === 'image' }" @click="stageClick" @wheel="wheel" @pointerdown="startPan" @pointermove="pan" @pointerup="finishPan" @pointercancel="finishPan" @lostpointercapture="finishPan" @dblclick="doubleClick">
          <div class="lightbox-content" :class="{ 'is-image': current?.kind === 'image', 'is-dragging': isDragging, zoomed: scale > 1 }" @click.stop>
            <div v-if="failed && !displayedImage" class="lightbox-error" role="status"><p>{{ current?.kind === 'video' ? '视频加载失败' : '图片加载失败' }}</p><button type="button" class="viewer-retry" @click="retryMedia">重新加载</button></div>
            <template v-else>
              <div v-if="loading && !previewReady" class="lightbox-loading" role="status"><LoaderCircle :size="28" aria-hidden="true" /><span class="viewer-sr-only">正在加载原文件</span></div>
              <img v-if="current?.kind === 'image' && displayedImage" :key="`${index}:${attempt}:${displayedImage}`" ref="picture" draggable="false" :src="displayedImage" :alt="current.alt || ''" :style="{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})` }" @load="loadedImage" @error="imageFailed" />
              <video v-else-if="current?.kind === 'video' && source" :key="`${index}:${attempt}:${source}`" ref="video" :src="source" :aria-label="current.alt || '视频预览'" controls playsinline preload="metadata" @loadeddata="loading = false" @error="loading = false; failed = true" @play="playVideo" @dblclick.stop />
            </template>
          </div>
        </div>
        <div v-if="current?.kind === 'image' && previewSource && (loading || failed)" class="lightbox-original-status" role="status"><span>{{ failed ? '原图加载失败，当前显示预览图。' : '正在加载原图，先显示预览图。' }}</span><button v-if="failed" type="button" class="viewer-retry" @click="retryMedia">重新加载</button></div>
        <p v-if="actionError" class="lightbox-action-error" role="alert">{{ actionError }}</p>
        <div v-if="current?.kind === 'image' || items.length > 1" class="lightbox-controls">
          <div v-if="current?.kind === 'image'" class="lightbox-zoom" role="group" aria-label="图片缩放"><button class="viewer-button" type="button" aria-label="缩小" title="缩小 (-)" :disabled="!canZoom || scale <= MIN_MEDIA_SCALE" @click="zoom(scale / 1.2)"><Minus :size="18" /></button><output aria-label="缩放比例">{{ Math.round(scale * 100) }}%</output><button class="viewer-button" type="button" aria-label="放大" title="放大 (+)" :disabled="!canZoom || scale >= MAX_MEDIA_SCALE" @click="zoom(scale * 1.2)"><Plus :size="18" /></button><button class="viewer-button" type="button" aria-label="重置缩放" title="适应屏幕 (0)" :disabled="!canZoom" @click="reset"><RotateCcw :size="18" /></button></div>
          <div v-if="items.length > 1" class="lightbox-sequence"><button class="viewer-button" type="button" aria-label="上一张" title="上一张" :disabled="index === 0" @click="choose(index - 1)"><ChevronLeft :size="18" /></button><select :value="index" aria-label="预览图片序号" @change="choose(Number(($event.target as HTMLSelectElement).value))"><option v-for="(_, position) in items" :key="position" :value="position">{{ position + 1 }} / {{ items.length }}</option></select><button class="viewer-button" type="button" aria-label="下一张" title="下一张" :disabled="index >= items.length - 1" @click="choose(index + 1)"><ChevronRight :size="18" /></button></div>
        </div>
      </template>
    </dialog>
  </Teleport>
</template>

<style scoped>
.media-lightbox { position: fixed; inset: 0; box-sizing: border-box; width: 100vw; max-width: none; height: 100dvh; max-height: none; margin: 0; padding: 0; border: 0; border-radius: 0; overflow: hidden; background: rgb(0 0 0 / 94%); color: #fff; overscroll-behavior: contain; color-scheme: dark; }
.media-lightbox.is-editing { background: var(--surface); color: var(--ink); color-scheme: normal; }
.media-lightbox::backdrop { background: rgb(0 0 0 / 30%); }
.lightbox-stage { position: absolute; inset: 64px 16px 84px; display: flex; align-items: center; justify-content: center; overflow: hidden; }
.lightbox-content { position: relative; display: flex; align-items: center; justify-content: center; max-width: 100%; max-height: 100%; }
.lightbox-stage.is-image { touch-action: none; }.lightbox-content.is-image { cursor: zoom-in; }.lightbox-content.zoomed { cursor: grab; }.lightbox-content.is-dragging { cursor: grabbing; }
.lightbox-content img, .lightbox-content video { display: block; max-width: min(90vw, calc(100vw - 32px)); max-height: calc(100dvh - 164px); width: auto; height: auto; object-fit: contain; border-radius: 8px; }
.lightbox-content img { user-select: none; }
.lightbox-content video { max-width: min(1200px, calc(100vw - 32px)); }
.lightbox-actions { position: absolute; right: max(16px, env(safe-area-inset-right)); top: max(12px, env(safe-area-inset-top)); z-index: 2; display: flex; align-items: center; gap: 8px; }
.viewer-button { display: grid; place-items: center; flex: none; width: 44px; height: 44px; padding: 0; border: 0; border-radius: 6px; color: #f5f5f5; background: rgb(38 38 38 / 85%); cursor: pointer; }
.viewer-button:hover:not(:disabled), .viewer-retry:hover { background: #404040; }.viewer-button:disabled { opacity: .4; cursor: default; }
.viewer-button:focus-visible, select:focus-visible, .viewer-retry:focus-visible { outline: 2px solid #fff; outline-offset: var(--focus-outline-offset); }
.lightbox-controls { position: absolute; bottom: max(16px, env(safe-area-inset-bottom)); left: 50%; transform: translateX(-50%); z-index: 2; display: flex; align-items: center; justify-content: center; flex-wrap: wrap; gap: 4px; width: max-content; max-width: calc(100% - 24px); padding: 4px; border-radius: 8px; background: rgb(24 24 24 / 94%); }
.lightbox-controls .viewer-button { background: transparent; }.lightbox-controls output { min-width: 48px; text-align: center; font-size: 13px; font-variant-numeric: tabular-nums; }
.lightbox-zoom { display: flex; align-items: center; gap: 8px; }
.lightbox-sequence { display: flex; align-items: center; gap: 4px; }.lightbox-sequence select { box-sizing: border-box; width: auto; max-width: 104px; height: 40px; padding: 4px 8px; border: 0; border-radius: 4px; font: inherit; font-size: 13px; color: #f5f5f5; background: #262626; font-variant-numeric: tabular-nums; }
.lightbox-loading { position: absolute; inset: 0; min-width: 120px; min-height: 120px; display: flex; align-items: center; justify-content: center; pointer-events: none; }.lightbox-loading svg { animation: spin 1s linear infinite; }
.lightbox-error { min-width: min(240px, calc(100vw - 48px)); padding: 24px; text-align: center; }.lightbox-error p { margin: 0 0 16px; font-size: 14px; }
.viewer-retry { border: 0; border-radius: 6px; padding: 10px 16px; font: inherit; font-size: 14px; color: #fff; background: #262626; cursor: pointer; }
.lightbox-action-error { position: absolute; top: 64px; left: 24px; right: 24px; margin: 0; color: #fff; font-size: 14px; line-height: 24px; overflow-wrap: anywhere; pointer-events: none; }
.lightbox-original-status { position: absolute; top: 64px; left: 16px; right: 16px; z-index: 1; display: flex; align-items: center; justify-content: center; flex-wrap: wrap; gap: 8px; padding: 8px; border-radius: 6px; background: rgb(24 24 24 / 94%); font-size: 14px; line-height: 1.5; }
.lightbox-original-status .viewer-retry { min-height: 44px; }
.viewer-sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
@keyframes spin { to { transform: rotate(360deg); } }
@media (max-width: 639px) { .lightbox-controls { gap: 8px; }.lightbox-controls output { min-width: 44px; }.lightbox-sequence { gap: 8px; }.lightbox-content img, .lightbox-content video { border-radius: 4px; max-height: calc(100dvh - 184px); }.lightbox-stage { inset: 68px 12px 104px; } }
@media (max-width: 639px) { .has-sequence .lightbox-stage { bottom: 128px; }.has-sequence .lightbox-content img, .has-sequence .lightbox-content video { max-height: calc(100dvh - 208px); } }
@media (prefers-reduced-motion: reduce) { .lightbox-content img { transition: none; }.lightbox-loading svg { animation: none; } }
</style>
