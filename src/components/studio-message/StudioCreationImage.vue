<!-- Adapted from octopus_chat app/components/chat-image.tsx (MIT). -->
<script lang="ts">
const dimensions = new Map<string, { width: number; height: number }>()
</script>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { LoaderCircle, RotateCw, SquarePen } from '@lucide/vue'
import { forgetCreationImage, mediaSource, readCreationImage } from '../../native-studio'

const props = defineProps<{ src: string; preview?: string; alt: string; label: string; editable?: boolean; thumbnail?: boolean }>()
const emit = defineEmits<{ open: []; edit: [] }>()
const size = ref(dimensions.get(props.src))
const imageStyle = computed(() => size.value && !props.thumbnail ? {
  width: `min(${size.value.width}px, calc(var(--creation-image-height) * ${size.value.width / size.value.height}))`,
  aspectRatio: `${size.value.width} / ${size.value.height}`, minHeight: '0',
} : undefined)
const loaded = ref(false), failed = ref(false), retrying = ref(false), replacement = ref('')
const element = ref<HTMLElement>(), fallback = ref('')
const pendingPreview = ref(''), previewReady = ref(false)
const showOriginalActions = ref(false)
const directOriginal = computed(() => {
  if (props.thumbnail || !/^(?:https?:\/\/|\/api\/creation\/media\?)/i.test(props.src)) return
  const source = mediaSource(props.src)
  if (source?.startsWith('/api/creation/media?') && !new URL(source, location.origin).searchParams.has('variant')) return source
})
let slowRead: ReturnType<typeof setTimeout> | undefined
let revision = 0
let controller: AbortController | undefined, observer: IntersectionObserver | undefined
function clearImage(keepPreview = false) {
  controller?.abort()
  clearTimeout(slowRead); showOriginalActions.value = false
  if (replacement.value) URL.revokeObjectURL(replacement.value)
  if (!keepPreview) { pendingPreview.value = ''; previewReady.value = false }
  replacement.value = ''; fallback.value = ''; loaded.value = false
}
function release() { observer?.disconnect(); clearImage() }
watch([() => props.src, () => props.thumbnail, element], () => {
  revision++; release(); size.value = dimensions.get(props.src); loaded.value = false; failed.value = false; retrying.value = false
  if (!props.src || !element.value) return
  const accepted = revision
  const start = () => { if (accepted === revision && !failed.value && !fallback.value) void read() }
  if (typeof IntersectionObserver === 'undefined') start()
  else {
    observer = new IntersectionObserver(entries => {
      if (accepted !== revision) return
      if (entries.some(entry => entry.isIntersecting)) start()
      else if (!failed.value && !(fallback.value && fallback.value === directOriginal.value)) clearImage()
    }, { rootMargin: '160px 0px' })
    observer.observe(element.value)
  }
}, { flush: 'post', immediate: true })
onBeforeUnmount(() => { revision++; release() })
function load(event: Event) {
  const image = event.target as HTMLImageElement
  if (image.getAttribute('src') !== (replacement.value || fallback.value)) return
  if (image.naturalWidth && image.naturalHeight) {
    size.value = { width: image.naturalWidth, height: image.naturalHeight }
    if (!props.thumbnail) dimensions.set(props.src, size.value)
    if (dimensions.size > 200) dimensions.delete(dimensions.keys().next().value!)
  }
  loaded.value = true; failed.value = false
}
async function read(retry = false) {
  const accepted = revision, current = new AbortController()
  controller?.abort(); controller = current
  retrying.value = retry
  clearTimeout(slowRead)
  if (directOriginal.value) slowRead = setTimeout(() => { showOriginalActions.value = true }, 8000)
  let previewTimer: ReturnType<typeof setTimeout> | undefined
  const localPath = props.src.startsWith(location.origin + '/') ? props.src.slice(location.origin.length) : props.src
  if (!props.thumbnail && props.preview?.startsWith('data:image/')) pendingPreview.value = props.preview
  else if (!props.thumbnail && !previewReady.value && localPath.startsWith('/api/creation/media?')) {
    const original = new URL(localPath, location.origin)
    if (original.searchParams.has('requestId')
      && [...original.searchParams.keys()].every(key => key === 'requestId' || key === 'index')) {
      // The server already has these bytes. Asking for an external URL's preview would fetch that original twice.
      previewTimer = setTimeout(() => {
        if (!current.signal.aborted) pendingPreview.value = mediaSource(props.src, true) || ''
      }, 1200)
    }
  }
  try {
    const blob = await readCreationImage(props.src, current.signal, props.thumbnail ? true : 'display')
    if (current.signal.aborted || accepted !== revision) return
    if (replacement.value) URL.revokeObjectURL(replacement.value)
    fallback.value = ''; showOriginalActions.value = false
    replacement.value = URL.createObjectURL(blob); failed.value = false; loaded.value = false
  } catch (cause) {
    if (current.signal.aborted || accepted !== revision) return
    const status = (cause as { status?: number })?.status
    showOriginalActions.value = [0, 408, 500, 502, 503, 504].includes(status ?? -1)
    if (!fallback.value || !showOriginalActions.value) {
      fallback.value = ''; failed.value = true
    }
  }
  finally {
    clearTimeout(previewTimer)
    if (!current.signal.aborted) { clearTimeout(slowRead); retrying.value = false }
  }
}
function showOriginal() {
  fallback.value = directOriginal.value || ''
  loaded.value = false; failed.value = false
}
function imageFailed(event: Event) {
  if ((event.target as HTMLImageElement).getAttribute('src') !== (replacement.value || fallback.value)) return
  if (!replacement.value) fallback.value = ''
  forgetCreationImage(props.src, props.thumbnail ? true : 'display'); forgetCreationImage(props.src); failed.value = true
}
function retry() {
  if (retrying.value) return
  clearImage(previewReady.value)
  forgetCreationImage(props.src, props.thumbnail ? true : 'display'); forgetCreationImage(props.src); failed.value = false; loaded.value = false
  return read(true)
}
</script>

<template>
  <div ref="element" class="creation-image" :class="{ 'creation-image-thumbnail': thumbnail }">
    <div v-if="failed ? previewReady : !replacement && (!fallback || (fallback === directOriginal && !loaded))" class="image-loading" :class="{ 'with-preview': previewReady }" :style="imageStyle" role="status">
      <img v-if="pendingPreview" :key="pendingPreview" :src="pendingPreview" alt="生成图片预览" decoding="async" @load="previewReady = true" @error="pendingPreview = ''; previewReady = false" />
      <template v-if="!previewReady"><LoaderCircle :size="20" aria-hidden="true" /><span>正在加载图片</span></template>
    </div>
    <button v-if="failed" class="image-retry" :class="{ 'after-preview': previewReady }" type="button" :disabled="retrying" aria-label="重新加载图片" @click="retry"><RotateCw :size="18" /><span>{{ retrying ? '正在加载' : '重新加载图片' }}</span></button>
    <img v-else-if="directOriginal && fallback === directOriginal" v-show="loaded" class="direct-original" :src="fallback" :alt="alt" :style="imageStyle" @load="load" @error="imageFailed" />
    <img v-else-if="thumbnail && (replacement || fallback)" :src="replacement || fallback" :alt="alt" width="72" height="72" loading="lazy" decoding="async" @load="load" @error="imageFailed" />
    <button v-else-if="replacement || fallback" type="button" class="creation-image-preview" :aria-label="label" :aria-busy="!loaded" @click="emit('open')">
      <img :key="replacement || fallback" :src="replacement || fallback" :alt="alt" :width="size?.width" :height="size?.height" :style="imageStyle" loading="lazy" decoding="async" @load="load" @error="imageFailed" />
    </button>
    <div v-if="showOriginalActions && directOriginal" class="original-actions">
      <button v-if="fallback !== directOriginal" class="studio-tool" type="button" @click="showOriginal">直接查看原图</button>
      <a class="studio-tool" :href="directOriginal" download>直接下载原图</a>
    </div>
    <button v-if="editable && loaded && !failed && !showOriginalActions" type="button" class="creation-image-edit" aria-label="打开图片画布" title="画布编辑" @click.stop="emit('edit')"><SquarePen :size="18" /></button>
  </div>
</template>

<style scoped>
.creation-image { --creation-image-height: min(480px, 44dvh); position: relative; width: fit-content; min-width: 0; max-width: 100%; }
.creation-image-edit { display: none; position: absolute; right: 6px; bottom: 6px; width: 44px; height: 44px; border: 1px solid rgb(255 255 255 / 40%); border-radius: 8px; color: #fff; background: rgb(0 0 0 / 65%); cursor: pointer; opacity: 0; pointer-events: none; transition: opacity 150ms ease; }
@media (hover: hover) and (pointer: fine) and (min-width: 640px) { .creation-image-edit { display: grid; place-items: center; }.creation-image:hover .creation-image-edit, .creation-image:focus-within .creation-image-edit { opacity: 1; pointer-events: auto; }.creation-image-edit:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: 2px; } }
@media (prefers-reduced-motion: reduce) { .creation-image-edit { transition: none; } }
.creation-image-preview { position: relative; display: block; width: fit-content; max-width: 100%; padding: 0; border: 0; border-radius: 0; background: transparent; cursor: zoom-in; }
.creation-image-preview img, .direct-original { display: block; width: auto; height: auto; max-width: 100%; max-height: var(--creation-image-height); object-fit: contain; }
.original-actions { display: flex; flex-wrap: wrap; gap: 4px 8px; }
.creation-image-preview[aria-busy="true"] img { min-width: min(240px, 100%); min-height: 160px; }
.creation-image-preview:focus-visible, .image-retry:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: var(--focus-outline-offset); }
.image-retry { display: flex; align-items: center; justify-content: center; gap: 8px; width: min(320px, 100%); min-height: 160px; padding: 16px; border: 0; border-radius: 6px; background: var(--surface-soft); color: var(--ink); font: inherit; font-size: 14px; cursor: pointer; }
.image-retry:disabled { cursor: default; opacity: .6; }
.image-retry.after-preview { width: fit-content; min-height: 44px; padding: 6px 10px; }
.image-loading { display: flex; align-items: center; justify-content: center; gap: 8px; width: 320px; max-width: 100%; min-height: 160px; border-radius: 6px; background: var(--surface-soft); color: var(--muted); font-size: 14px; }
.image-loading > img { display: none; max-width: 100%; max-height: var(--creation-image-height); }
.image-loading.with-preview { width: fit-content; min-height: 0; }
.image-loading.with-preview > img { display: block; }
.creation-image-thumbnail, .creation-image-thumbnail > img { width: 72px; height: 72px; flex: none; }
.creation-image-thumbnail > img { display: block; object-fit: cover; border-radius: 6px; }
.creation-image-thumbnail .image-retry { width: 72px; min-height: 72px; padding: 4px; font-size: 11px; flex-direction: column; gap: 4px; }
.creation-image-thumbnail .image-loading { width: 72px; min-height: 72px; font-size: 11px; flex-direction: column; gap: 4px; }
@media (min-width: 1000px) { .creation-image { --creation-image-height: min(340px, 26dvh); } }
@media (max-width: 639px) { .creation-image { --creation-image-height: 36dvh; } }
</style>
