<!-- Adapted from octopus_chat app/components/chat-image.tsx (MIT). -->
<script lang="ts">
const dimensions = new Map<string, { width: number; height: number }>()
</script>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { LoaderCircle, RotateCw, SquarePen } from '@lucide/vue'
import { forgetCreationImage, readCreationImage } from '../../native-studio'

const props = defineProps<{ src: string; alt: string; label: string; editable?: boolean; thumbnail?: boolean }>()
const emit = defineEmits<{ open: []; edit: [] }>()
const size = ref(dimensions.get(props.src))
const imageStyle = computed(() => size.value && !props.thumbnail ? {
  width: `min(${size.value.width}px, calc(var(--creation-image-height) * ${size.value.width / size.value.height}))`,
  aspectRatio: `${size.value.width} / ${size.value.height}`, minHeight: '0',
} : undefined)
const loaded = ref(false), failed = ref(false), retrying = ref(false), replacement = ref('')
const element = ref<HTMLElement>(), fallback = ref('')
let revision = 0
let controller: AbortController | undefined, observer: IntersectionObserver | undefined
function clearImage() {
  controller?.abort()
  if (replacement.value) URL.revokeObjectURL(replacement.value)
  replacement.value = ''; fallback.value = ''; loaded.value = false
}
function release() { observer?.disconnect(); clearImage() }
watch([() => props.src, () => props.thumbnail, element], () => {
  revision++; release(); size.value = dimensions.get(props.src); loaded.value = false; failed.value = false; retrying.value = false
  if (!props.src || !element.value) return
  const accepted = revision
  const start = () => { if (accepted === revision && !failed.value) void read() }
  if (typeof IntersectionObserver === 'undefined') start()
  else {
    observer = new IntersectionObserver(entries => {
      if (accepted !== revision) return
      if (entries.some(entry => entry.isIntersecting)) start(); else clearImage()
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
  if (/^(?:blob:|data:)/.test(props.src)) { fallback.value = props.src; return }
  retrying.value = retry
  try {
    const blob = await readCreationImage(props.src, current.signal, props.thumbnail)
    if (current.signal.aborted || accepted !== revision) return
    if (replacement.value) URL.revokeObjectURL(replacement.value)
    replacement.value = URL.createObjectURL(blob); failed.value = false; loaded.value = false
  } catch {
    if (current.signal.aborted || accepted !== revision) return
    failed.value = true
  }
  finally { if (accepted === revision) retrying.value = false }
}
function imageFailed(event: Event) {
  if ((event.target as HTMLImageElement).getAttribute('src') !== (replacement.value || fallback.value)) return
  forgetCreationImage(props.src, props.thumbnail); failed.value = true
}
function retry() {
  if (retrying.value) return
  clearImage()
  forgetCreationImage(props.src, props.thumbnail); failed.value = false; loaded.value = false
  return read(true)
}
</script>

<template>
  <div ref="element" class="creation-image" :class="{ 'creation-image-thumbnail': thumbnail }">
    <button v-if="failed" class="image-retry" type="button" :disabled="retrying" aria-label="重新加载图片" @click="retry"><RotateCw :size="18" /><span>{{ retrying ? '正在加载' : '重新加载图片' }}</span></button>
    <div v-else-if="!replacement && !fallback" class="image-loading" :style="imageStyle" role="status"><LoaderCircle :size="20" aria-hidden="true" /><span>正在加载图片</span></div>
    <img v-else-if="thumbnail" :src="replacement || fallback" :alt="alt" width="72" height="72" loading="lazy" decoding="async" @load="load" @error="imageFailed" />
    <button v-else type="button" class="creation-image-preview" :aria-label="label" :aria-busy="!loaded" @click="emit('open')">
      <img :key="replacement || fallback" :src="replacement || fallback" :alt="alt" :width="size?.width" :height="size?.height" :style="imageStyle" loading="lazy" decoding="async" @load="load" @error="imageFailed" />
    </button>
    <button v-if="editable && loaded && !failed" type="button" class="creation-image-edit" aria-label="打开图片画布" title="画布编辑" @click.stop="emit('edit')"><SquarePen :size="18" /></button>
  </div>
</template>

<style scoped>
.creation-image { --creation-image-height: min(480px, 44dvh); position: relative; width: fit-content; min-width: 0; max-width: 100%; }
.creation-image-edit { display: none; position: absolute; right: 6px; bottom: 6px; width: 44px; height: 44px; border: 1px solid rgb(255 255 255 / 40%); border-radius: 8px; color: #fff; background: rgb(0 0 0 / 65%); cursor: pointer; opacity: 0; pointer-events: none; transition: opacity 150ms ease; }
@media (hover: hover) and (pointer: fine) and (min-width: 640px) { .creation-image-edit { display: grid; place-items: center; }.creation-image:hover .creation-image-edit, .creation-image:focus-within .creation-image-edit { opacity: 1; pointer-events: auto; }.creation-image-edit:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: 2px; } }
@media (prefers-reduced-motion: reduce) { .creation-image-edit { transition: none; } }
.creation-image-preview { position: relative; display: block; width: fit-content; max-width: 100%; padding: 0; border: 0; border-radius: 0; background: transparent; cursor: zoom-in; }
.creation-image-preview img { display: block; width: auto; height: auto; max-width: 100%; max-height: var(--creation-image-height); object-fit: contain; }
.creation-image-preview[aria-busy="true"] img { min-width: min(240px, 100%); min-height: 160px; }
.creation-image-preview:focus-visible, .image-retry:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: var(--focus-outline-offset); }
.image-retry { display: flex; align-items: center; justify-content: center; gap: 8px; width: min(320px, 100%); min-height: 160px; padding: 16px; border: 0; border-radius: 6px; background: var(--surface-soft); color: var(--ink); font: inherit; font-size: 14px; cursor: pointer; }
.image-retry:disabled { cursor: default; opacity: .6; }
.image-loading { display: flex; align-items: center; justify-content: center; gap: 8px; width: 320px; max-width: 100%; min-height: 160px; border-radius: 6px; background: var(--surface-soft); color: var(--muted); font-size: 14px; }
.creation-image-thumbnail, .creation-image-thumbnail > img { width: 72px; height: 72px; flex: none; }
.creation-image-thumbnail > img { display: block; object-fit: cover; border-radius: 6px; }
.creation-image-thumbnail .image-retry { width: 72px; min-height: 72px; padding: 4px; font-size: 11px; flex-direction: column; gap: 4px; }
.creation-image-thumbnail .image-loading { width: 72px; min-height: 72px; font-size: 11px; flex-direction: column; gap: 4px; }
@media (min-width: 1000px) { .creation-image { --creation-image-height: min(340px, 26dvh); } }
@media (max-width: 639px) { .creation-image { --creation-image-height: 36dvh; } }
</style>
