<!-- Lazy cover behavior adapted from Octopus Chat's MIT gallery-video-card.tsx. -->
<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { Image, LoaderCircle, Maximize, Play, RefreshCw, Video } from '@lucide/vue'
import { forgetCreationImage, readCreationImage, readableMedia, type CreationTask } from '../native-studio'
import { session, errorMessage } from '../state'
import { readTaskAsset, readTaskPreview, saveTaskPreview } from '../studio-task-store'
import { imageThumbnail, mediaPreviewIdentity } from '../studio-media-previews'
import { extractVideoPoster } from '../studio-video-poster'

const props = withDefaults(defineProps<{ task: CreationTask; index?: number; selecting?: boolean; selected?: boolean }>(), { index: 0 })
const emit = defineEmits<{ open: [] }>()
const element = ref<HTMLElement>(), source = ref(''), duration = ref<number>(), loading = ref(false), error = ref(''), retry = ref(0)
const identity = computed(() => {
  const base = mediaPreviewIdentity(props.task, props.index)
  return props.task.kind === 'video' && props.task.poster ? JSON.stringify([base, props.task.poster]) : base
})
const previewLabel = computed(() => `预览 ${props.task.prompt}${props.index > 0 ? ` · ${props.index + 1}` : ''}`)
const durationLabel = computed(() => duration.value === undefined ? '' : `${Math.floor(duration.value / 60)}:${String(Math.floor(duration.value % 60)).padStart(2, '0')}`)
let dispose = () => {}
let releaseSource = () => {}
function failedCover() { releaseSource(); error.value = '封面无法显示，请重新加载。' }
watch([() => session.user?.id, () => props.task.id, () => props.index, identity, retry, element], () => {
  dispose(); source.value = ''; duration.value = undefined; error.value = ''; loading.value = false
  const owner = session.user?.id, task = props.task, index = props.index, acceptedIdentity = identity.value
  const url = task.urls[index]
  if (!owner || task.owner !== owner || !element.value || !url) return
  let controller: AbortController | undefined, objectUrl = '', observer: IntersectionObserver | undefined, active = true
  const stop = () => {
    controller?.abort(); controller = undefined
    source.value = ''; duration.value = undefined; loading.value = false
    if (objectUrl) URL.revokeObjectURL(objectUrl)
    objectUrl = ''
  }
  releaseSource = stop
  const load = async () => {
    if (controller || !active || session.user?.id !== owner) return
    const request = new AbortController()
    controller = request
    const current = () => active && controller === request && !request.signal.aborted && session.user?.id === owner && props.task.id === task.id && identity.value === acceptedIdentity
    loading.value = true; error.value = ''
    try {
      let cached = retry.value ? undefined : await readTaskPreview(owner, task.id, acceptedIdentity, index)
      if (!current()) return
      if (!cached) {
        if (task.kind === 'video') {
          if (task.poster) {
            try {
              cached = { blob: await imageThumbnail(async () => {
                const response = await fetch(await readableMedia(task.poster!, 'image', true), { credentials: 'same-origin', signal: request.signal })
                if (!response.ok || !response.headers.get('content-type')?.startsWith('image/')) { await response.body?.cancel(); throw new Error('视频封面暂时无法读取。') }
                return response.blob()
              }, request.signal) }
            } catch (cause) { if (request.signal.aborted) throw cause }
          }
          if (!cached) {
            const original = await readTaskAsset(owner, url)
            if (!current()) return
            const temporary = original ? URL.createObjectURL(original) : undefined
            try { cached = await extractVideoPoster(temporary || await readableMedia(url, 'video'), request.signal) }
            finally { if (temporary) URL.revokeObjectURL(temporary) }
          }
        } else {
          if (retry.value) forgetCreationImage(url)
          cached = { blob: await imageThumbnail(() => readCreationImage(url, request.signal), request.signal) }
        }
        if (!current()) return
        // A failed optional cover write never blocks opening or publishing the original.
        await saveTaskPreview(owner, task.id, acceptedIdentity, cached.blob, cached.duration, index).catch(() => {})
      }
      if (!current()) return
      objectUrl = URL.createObjectURL(cached.blob); source.value = objectUrl; duration.value = cached.duration
    } catch (cause) { if (current()) error.value = errorMessage(cause) }
    finally { if (current()) loading.value = false }
  }
  if (typeof IntersectionObserver === 'undefined') void load()
  else {
    observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) void load(); else stop() }, { rootMargin: '160px 0px' })
    observer.observe(element.value)
  }
  dispose = () => { active = false; stop(); observer?.disconnect() }
}, { flush: 'post', immediate: true })
onBeforeUnmount(() => dispose())
</script>

<template>
  <div ref="element" class="gallery-cover">
    <button v-if="source" class="cover-preview" type="button" :aria-label="selecting ? `选择 ${task.prompt}${task.urls.length > 1 ? ` · ${index + 1}` : ''}` : previewLabel" :aria-pressed="selecting ? selected : undefined" @click="emit('open')">
      <img :src="source" :alt="task.prompt" decoding="async" @error="failedCover" />
      <Play v-if="task.kind === 'video'" :size="24" class="cover-play" aria-hidden="true" /><Maximize v-else :size="16" class="cover-expand" aria-hidden="true" />
      <span v-if="durationLabel" class="cover-duration" aria-label="实际视频时长">{{ durationLabel }}</span>
    </button>
    <div v-else class="cover-empty">
      <button class="cover-await" type="button" :aria-label="previewLabel" @click="emit('open')"><LoaderCircle v-if="loading" :size="22" aria-hidden="true" /><Video v-else-if="task.kind === 'video'" :size="24" aria-hidden="true" /><Image v-else :size="24" aria-hidden="true" /></button>
      <span v-if="loading" class="studio-sr-only" role="status">正在加载封面</span>
      <template v-if="error"><button class="icon-button" type="button" :title="error" :aria-label="`重新加载封面：${task.prompt}`" @click.stop="retry++"><RefreshCw :size="17" /></button><button class="cover-original" type="button" @click="emit('open')">查看原{{ task.kind === 'video' ? '视频' : '图' }}</button></template>
    </div>
  </div>
</template>

<style scoped>
.gallery-cover { position: relative; width: 100%; aspect-ratio: 1; min-width: 0; overflow: hidden; background: var(--surface-soft); }
.cover-preview { position: absolute; inset: 0; display: block; width: 100%; height: 100%; padding: 0; border: 0; background: transparent; color: white; cursor: zoom-in; }
.cover-preview img { display: block; width: 100%; height: 100%; object-fit: cover; }
.cover-play, .cover-expand { position: absolute; padding: 6px; box-sizing: content-box; border-radius: 6px; background: rgb(0 0 0 / 70%); color: white; }
.cover-play { inset: 50% auto auto 50%; transform: translate(-50%, -50%); }.cover-expand { bottom: 8px; right: 8px; }
.cover-duration { position: absolute; right: 8px; bottom: 8px; padding: 2px 6px; border-radius: 4px; background: rgb(0 0 0 / 75%); color: white; font-size: 12px; font-variant-numeric: tabular-nums; }
.cover-empty { position: absolute; inset: 0; display: flex; flex-wrap: wrap; align-content: center; align-items: center; justify-content: center; gap: 8px; color: var(--muted); }
.cover-await { display: grid; place-items: center; width: 100%; min-height: 64px; padding: 16px; border: 0; background: transparent; color: inherit; cursor: zoom-in; }
.cover-original { flex-basis: 100%; border: 0; background: transparent; color: var(--ink); font: inherit; font-size: 12px; padding: 8px; cursor: pointer; }
.cover-preview:focus-visible, .cover-original:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: -3px; }
</style>
