<!-- Thumbnail layout adapted from octopus_chat chat.module.scss (MIT). -->
<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { X } from '@lucide/vue'
import { mediaSource } from '../native-studio'
import StudioMediaPreview from './studio-message/StudioMediaPreview.vue'

const props = defineProps<{ references: { name: string; url: string; type?: string }[]; disabled?: boolean }>()
const emit = defineEmits<{ remove: [index: number]; duration: [index: number, value: number] }>()
const preview = ref<InstanceType<typeof StudioMediaPreview>>()
const items = computed(() => props.references.map(file => ({ src: file.url, kind: file.type?.startsWith('video/') ? 'video' as const : 'image' as const, alt: file.name })))
function loadedVideo(index: number, event: Event) {
  const value = (event.target as HTMLVideoElement).duration
  if (Number.isFinite(value) && value > 0) emit('duration', index, value)
}
watch(() => props.references.map(file => file.url).join('\n'), () => preview.value?.close())
</script>

<template>
  <ul v-if="references.length" class="reference-list" :aria-label="references.some(file => file.type?.startsWith('video/')) ? '参考素材' : '参考图片'">
    <li v-for="(file, index) in references" :key="`${file.url}:${index}`" :class="{ 'video-reference': file.type?.startsWith('video/') }">
      <video v-if="file.type?.startsWith('video/')" :src="mediaSource(file.url, false, 'video')" :aria-label="`源视频：${file.name}`" width="240" height="135" controls playsinline preload="metadata" @loadedmetadata="loadedVideo(index, $event)" />
      <button v-else class="reference-preview" type="button" :aria-label="`预览参考图 ${index + 1}`" :title="file.name" @click="preview?.open(index)">
        <img :src="mediaSource(file.url, true)" :alt="file.name" />
      </button>
      <button class="reference-remove" type="button" :disabled="disabled" :aria-label="`移除${file.type?.startsWith('video/') ? '源视频' : '参考图'} ${index + 1}`" :title="file.type?.startsWith('video/') ? '移除源视频' : '移除参考图'" @click="$emit('remove', index)"><X :size="14" /></button>
    </li>
  </ul>
  <StudioMediaPreview ref="preview" :items="items" label="参考图预览" close-label="关闭参考图预览" />
</template>

<style scoped>
.reference-list { display: flex; flex-shrink: 0; min-width: 0; overflow-x: auto; overflow-y: hidden; overscroll-behavior-x: contain; scrollbar-width: thin; scrollbar-color: var(--border) transparent; list-style: none; gap: 8px; padding: 0 5px 4px; margin: 0 0 8px; }
li { flex: 0 0 64px; width: 64px; height: 64px; position: relative; border-radius: 12px; overflow: hidden; }
.reference-preview { display: block; width: 100%; height: 100%; padding: 0; border: 0; background: var(--surface-soft); cursor: zoom-in; }
img { width: 100%; height: 100%; object-fit: cover; }
.video-reference { flex-basis: 240px; width: 240px; height: 135px; }.video-reference video { display: block; width: 100%; height: 100%; object-fit: contain; background: #000; }.video-reference .reference-remove { opacity: 1; }
.reference-preview::after { content: ''; position: absolute; inset: 0; pointer-events: none; background: rgb(0 0 0 / 30%); opacity: 0; transition: opacity 150ms ease-out; }
.reference-remove { position: absolute; top: 4px; right: 4px; display: grid; place-items: center; width: 24px; height: 24px; padding: 0; border: 0; border-radius: 50%; background: var(--surface); color: var(--danger); opacity: 0; cursor: pointer; transition: opacity 150ms ease-out; }
li:hover .reference-preview::after, li:focus-within .reference-preview::after, li:hover .reference-remove, li:focus-within .reference-remove { opacity: 1; }
button:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: -2px; }
@media (hover: none), (pointer: coarse) { li { flex-basis: 96px; width: 96px; height: 96px; }.reference-remove { top: 0; right: 0; width: 44px; height: 44px; opacity: 1; border-radius: 0 0 0 12px; background: rgb(0 0 0 / 55%); color: #fff; } }
@media (prefers-reduced-motion: reduce) { .reference-preview::after, .reference-remove { transition: none; } }
</style>
