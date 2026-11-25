<!-- Thumbnail layout adapted from octopus_chat chat.module.scss (MIT). -->
<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Music2, Play, X } from '@lucide/vue'
import { mediaSource } from '../native-studio'
import StudioMediaPreview from './studio-message/StudioMediaPreview.vue'

const props = defineProps<{ references: { name: string; url: string; type?: string; duration?: number }[]; disabled?: boolean; compact?: boolean; sourceVideo?: boolean }>()
const emit = defineEmits<{ remove: [index: number]; duration: [index: number, value: number] }>()
const preview = ref<InstanceType<typeof StudioMediaPreview>>()
const durations = ref<Record<string, number>>({})
const items = computed(() => props.references.filter(file => !file.type?.startsWith('audio/')).map(file => ({ src: file.url, kind: file.type?.startsWith('video/') ? 'video' as const : 'image' as const, alt: file.name })))
function loadedMedia(index: number, event: Event) {
  const file = props.references[index], value = (event.target as HTMLMediaElement).duration
  if (file && Number.isFinite(value) && value > 0) {
    durations.value[file.url] = value
    emit('duration', index, value)
  }
}
function durationLabel(index: number) {
  const file = props.references[index]!, value = file.duration || durations.value[file.url]
  return value ? `${Number(value.toFixed(2))} 秒` : ''
}
function openPreview(index: number) { preview.value?.open(props.references.slice(0, index).filter(file => !file.type?.startsWith('audio/')).length) }
function mediaLabel(index: number) {
  const file = props.references[index]!
  return file.type?.startsWith('audio/') ? '参考音频' : file.type?.startsWith('video/') ? props.sourceVideo ? '源视频' : '参考视频' : `图片${props.references.slice(0, index + 1).filter(file => !file.type?.startsWith('video/') && !file.type?.startsWith('audio/')).length}`
}
watch(() => props.references.map(file => file.url).join('\n'), () => preview.value?.close())
</script>

<template>
  <ul v-if="references.length" class="reference-list" :class="{ 'compact-references': compact }" :aria-label="compact ? '参考素材' : '参考图片'">
    <li v-for="(file, index) in references" :key="`${file.url}:${index}`" :class="{ 'video-reference': file.type?.startsWith('video/') }">
      <template v-if="compact">
        <div v-if="file.type?.startsWith('audio/')" class="reference-audio">
          <div class="reference-audio-heading"><Music2 :size="16" aria-hidden="true" /><span class="reference-name" :title="file.name">{{ file.name }}</span><small>{{ mediaLabel(index) }}<template v-if="durationLabel(index)"> · {{ durationLabel(index) }}</template></small></div>
          <audio :src="mediaSource(file.url, false, 'video')" :aria-label="`参考音频：${file.name}`" controls preload="metadata" @loadedmetadata="loadedMedia(index, $event)" />
        </div>
        <button v-else type="button" class="reference-preview reference-media-preview" :aria-label="file.type?.startsWith('video/') ? sourceVideo ? '预览源视频' : `预览参考视频 ${index + 1}` : `预览参考图 ${index + 1}`" @click="openPreview(index)">
          <span class="reference-thumbnail"><video v-if="file.type?.startsWith('video/')" :src="mediaSource(file.url, false, 'video')" :aria-label="`${sourceVideo ? '源视频' : '参考视频'}：${file.name}`" width="72" height="72" playsinline muted preload="metadata" @loadedmetadata="loadedMedia(index, $event)" /><img v-else :src="mediaSource(file.url, true)" :alt="file.name" /><Play v-if="file.type?.startsWith('video/')" class="reference-play" :size="20" aria-hidden="true" /></span>
          <span class="reference-copy"><span class="reference-name" :title="file.name">{{ file.name }}</span><small>{{ mediaLabel(index) }}<template v-if="durationLabel(index)"> · {{ durationLabel(index) }}</template></small></span>
        </button>
      </template>
      <video v-else-if="file.type?.startsWith('video/')" :src="mediaSource(file.url, false, 'video')" :aria-label="`源视频：${file.name}`" width="240" height="135" controls playsinline preload="metadata" @loadedmetadata="loadedMedia(index, $event)" />
      <button v-else class="reference-preview" type="button" :aria-label="`预览参考图 ${index + 1}`" :title="file.name" @click="preview?.open(index)">
        <img :src="mediaSource(file.url, true)" :alt="file.name" />
      </button>
      <button class="reference-remove" type="button" :disabled="disabled" :aria-label="`移除${file.type?.startsWith('audio/') ? '参考音频' : file.type?.startsWith('video/') ? sourceVideo ? '源视频' : '参考视频' : '参考图'} ${index + 1}`" title="移除附件" @click="$emit('remove', index)"><X :size="14" /></button>
    </li>
  </ul>
  <StudioMediaPreview ref="preview" :items="items" :label="compact ? '参考素材预览' : '参考图预览'" :close-label="compact ? '关闭参考素材预览' : '关闭参考图预览'" />
</template>

<style scoped>
.reference-list { display: flex; flex-shrink: 0; min-width: 0; overflow-x: auto; overflow-y: hidden; overscroll-behavior-x: contain; scrollbar-width: thin; scrollbar-color: var(--border) transparent; list-style: none; gap: 8px; padding: 0 5px 4px; margin: 0 0 8px; }
li { flex: 0 0 64px; width: 64px; height: 64px; position: relative; border-radius: 12px; overflow: hidden; }
.reference-preview { display: block; width: 100%; height: 100%; padding: 0; border: 0; background: var(--surface-soft); cursor: zoom-in; }
img { width: 100%; height: 100%; object-fit: cover; }
.video-reference { flex-basis: 240px; width: 240px; height: 135px; }.video-reference video { display: block; width: 100%; height: 100%; object-fit: contain; background: #000; }.video-reference .reference-remove { opacity: 1; }
.reference-preview::after { content: ''; position: absolute; inset: 0; pointer-events: none; background: rgb(0 0 0 / 30%); opacity: 0; transition: opacity 150ms ease-out; }
.compact-references { gap: 8px; padding: 0 0 4px; margin-bottom: 8px; }
.compact-references li { flex: 0 0 240px; width: 240px; height: 80px; border-radius: 8px; background: var(--surface-soft); }
.compact-references .reference-media-preview { display: flex; align-items: center; gap: 10px; padding: 4px 42px 4px 4px; color: var(--ink); text-align: left; }
.reference-thumbnail { position: relative; flex: 0 0 72px; height: 72px; overflow: hidden; border-radius: 4px; background: #000; }
.reference-thumbnail video { width: 72px; height: 72px; object-fit: cover; }
.reference-play { position: absolute; inset: 0; margin: auto; color: #fff; filter: drop-shadow(0 1px 3px #000); }
.reference-copy { min-width: 0; display: flex; flex-direction: column; gap: 5px; }
.reference-name { display: block; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; }
.reference-copy small, .reference-audio-heading small { color: var(--muted); font-size: 11px; font-variant-numeric: tabular-nums; }
.compact-references li:has(.reference-audio) { flex-basis: 288px; width: 288px; }
.reference-audio { height: 100%; display: flex; flex-direction: column; justify-content: center; gap: 6px; padding: 6px 6px 6px 10px; }
.reference-audio-heading { min-width: 0; display: flex; align-items: center; gap: 6px; padding-right: 36px; }
.reference-audio-heading .reference-name { flex: 1; }
.reference-audio-heading small { flex-shrink: 0; }
.reference-audio audio { width: 100%; min-width: 0; height: 36px; }
.compact-references .reference-remove { top: 0; right: 0; width: 40px; height: 40px; opacity: 1; color: var(--muted); background: transparent; }
.compact-references .reference-remove:hover { color: var(--danger); background: var(--state-hover); }
.reference-remove { position: absolute; top: 4px; right: 4px; display: grid; place-items: center; width: 24px; height: 24px; padding: 0; border: 0; border-radius: 50%; background: var(--surface); color: var(--danger); opacity: 0; cursor: pointer; transition: opacity 150ms ease-out; }
li:hover .reference-preview::after, li:focus-within .reference-preview::after, li:hover .reference-remove, li:focus-within .reference-remove { opacity: 1; }
button:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: -2px; }
@media (hover: none), (pointer: coarse) { li { flex-basis: 96px; width: 96px; height: 96px; }.reference-remove { top: 0; right: 0; width: 44px; height: 44px; opacity: 1; border-radius: 0 0 0 12px; background: rgb(0 0 0 / 55%); color: #fff; }.compact-references .reference-remove { width: 48px; height: 48px; }.compact-references li { height: 80px; }.compact-references .reference-media-preview { padding-right: 48px; } }
@media (prefers-reduced-motion: reduce) { .reference-preview::after, .reference-remove { transition: none; } }
</style>
