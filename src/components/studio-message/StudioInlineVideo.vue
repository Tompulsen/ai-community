<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { LoaderCircle, Play, RotateCw } from '@lucide/vue'
import { readableMedia, mediaSource } from '../../native-studio'
import { session } from '../../state'

const props = defineProps<{ src: string; label: string; poster?: string }>()
const emit = defineEmits<{ loadedmetadata: [event: Event]; expand: [] }>()
const root = ref<HTMLElement>(), player = ref<HTMLVideoElement>(), source = ref('')
const loading = ref(false), failed = ref(false), position = ref(0)
let revision = 0, observer: IntersectionObserver | undefined
function release() {
  revision++
  const video = player.value
  if (video) {
    if (Number.isFinite(video.currentTime) && video.currentTime > 0) position.value = video.currentTime
    video.pause(); video.removeAttribute('src'); video.load()
  }
  source.value = ''; loading.value = false
}
async function play() {
  release(); failed.value = false; loading.value = true
  const accepted = revision
  try {
    const url = await readableMedia(props.src, 'video')
    if (accepted !== revision) return
    source.value = url
    await nextTick()
    if (accepted !== revision) return
    // Native controls remain usable when the browser declines automatic playback.
    void player.value?.play().catch(() => { if (accepted === revision) loading.value = false })
  } catch { if (accepted === revision) { loading.value = false; failed.value = true } }
}
function metadata(event: Event) {
  const video = event.target as HTMLVideoElement
  if (position.value && Number.isFinite(video.duration)) video.currentTime = Math.min(position.value, Math.max(0, video.duration - .01))
  emit('loadedmetadata', event)
}
function fail() { if (source.value) { release(); failed.value = true } }
watch([() => props.src, () => session.user?.id], () => { release(); position.value = 0; failed.value = false })
watch(root, element => {
  observer?.disconnect()
  if (!element || typeof IntersectionObserver === 'undefined') return
  observer = new IntersectionObserver(entries => { if (entries.every(entry => !entry.isIntersecting)) release() }, { rootMargin: '160px 0px' })
  observer.observe(element)
}, { flush: 'post' })
function visibility() { if (document.visibilityState === 'hidden') release() }
document.addEventListener('visibilitychange', visibility)
onBeforeUnmount(() => { observer?.disconnect(); document.removeEventListener('visibilitychange', visibility); release() })
</script>

<template>
  <div ref="root" class="inline-video">
    <video v-show="source" ref="player" :src="source || undefined" :aria-label="label" controls playsinline preload="none" @loadedmetadata="metadata" @loadeddata="loading = false" @error="fail" @dblclick="emit('expand')" />
    <button v-if="!source" class="inline-video-play" type="button" :disabled="loading" :aria-label="failed ? '重新加载视频' : `播放${label}`" @click="play">
      <img v-if="poster" :src="mediaSource(poster, true)" alt="" loading="lazy" decoding="async" />
      <span><LoaderCircle v-if="loading" :size="24" aria-hidden="true" /><RotateCw v-else-if="failed" :size="24" aria-hidden="true" /><Play v-else :size="28" aria-hidden="true" />{{ loading ? '正在加载视频' : failed ? '重新加载视频' : position ? '继续播放视频' : '播放视频' }}</span>
    </button>
  </div>
</template>

<style scoped>
.inline-video { width: 100%; max-width: 100%; min-width: 0; }
.inline-video video, .inline-video-play { display: block; width: 100%; max-width: 100%; aspect-ratio: var(--video-ratio, 16 / 9); max-height: var(--video-max-height, 360px); object-fit: contain; border-radius: 6px; }
.inline-video-play { position: relative; padding: 0; border: 0; background: var(--surface-soft); color: var(--ink); cursor: pointer; font: inherit; }
.inline-video-play > img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; }
.inline-video-play > span { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; gap: 8px; background: rgb(0 0 0 / 42%); color: #fff; }
.inline-video-play:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: 3px; }
</style>
