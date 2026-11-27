<!-- Thumbnail layout adapted from octopus_chat chat.module.scss (MIT). -->
<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import { File, Music, Pencil, Play, X } from '@lucide/vue'
import { mediaSource } from '../native-studio'
import { formatMaterialSize } from '../../shared/studio/file-upload'
import StudioMediaPreview from './studio-message/StudioMediaPreview.vue'

const props = defineProps<{ references: { name: string; url: string; type?: string; size?: number; duration?: number }[]; disabled?: boolean; compact?: boolean; sourceVideo?: boolean }>()
const emit = defineEmits<{ remove: [index: number]; duration: [index: number, value: number] }>()
const preview = ref<InstanceType<typeof StudioMediaPreview>>()
const files = computed(() => props.references.map((file, index) => ({ ...file, index,
  kind: !file.type || file.type.startsWith('image/') ? 'image' : file.type.startsWith('video/') ? 'video' : file.type.startsWith('audio/') ? 'audio' : 'file',
})))
const mediaUrls = ref<Record<string, string>>({})
watch(files, (values, _previous, cleanup) => {
  const controller = new AbortController(), temporary: string[] = []
  mediaUrls.value = {}
  cleanup(() => { controller.abort(); temporary.forEach(url => URL.revokeObjectURL(url)) })
  for (const file of values.filter(file => file.kind === 'audio' || file.kind === 'video')) {
    if (!file.url.startsWith('data:')) { mediaUrls.value[file.url] = file.url; continue }
    // Media CSP permits blob URLs; the original data URL remains the submitted file.
    void fetch(file.url, { signal: controller.signal }).then(response => response.blob()).then(blob => {
      if (controller.signal.aborted) return
      const url = URL.createObjectURL(blob)
      temporary.push(url); mediaUrls.value[file.url] = url
    }).catch(() => { /* Unsupported media keeps its type icon and removal action. */ })
  }
}, { immediate: true })
const items = computed(() => files.value.filter(file => file.kind === 'image' || file.kind === 'video')
  .map(file => ({ src: file.kind === 'video' ? mediaUrls.value[file.url] : file.url, kind: file.kind === 'video' ? 'video' as const : 'image' as const, alt: file.name, index: file.index })))
const details = ref<HTMLDialogElement>(), selected = shallowRef<(typeof files.value)[number]>()
const durations = ref<Record<string, number>>({})
function metadata(index: number, event: Event) {
  const file = files.value[index], value = (event.target as HTMLMediaElement).duration
  if (file && Number.isFinite(value) && value > 0) {
    durations.value[file.url] = value
    emit('duration', index, value)
  }
}
function durationLabel(index: number) {
  const file = files.value[index]!, value = file.duration || durations.value[file.url], seconds = Math.floor(value || 0)
  return value ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}` : ''
}
let previewTimer: ReturnType<typeof setTimeout> | undefined
onBeforeUnmount(() => clearTimeout(previewTimer))
function openEditor(index: number) {
  clearTimeout(previewTimer)
  if (files.value[index]?.kind === 'image') void preview.value?.openEditor(items.value.findIndex(item => item.index === index))
}
function remove(index: number) { clearTimeout(previewTimer); emit('remove', index) }
async function open(index: number, event?: MouseEvent) {
  clearTimeout(previewTimer)
  const file = files.value[index]
  if (!file) return
  if (file.kind === 'image' || file.kind === 'video') {
    const position = items.value.findIndex(item => item.index === index)
    if (file.kind === 'image' && event?.detail) previewTimer = setTimeout(() => void preview.value?.open(position), 280)
    else await preview.value?.open(position)
    return
  }
  selected.value = file
  await nextTick()
  if (selected.value === file) details.value?.showModal()
}
watch(() => props.references.map(file => file.url), urls => {
  clearTimeout(previewTimer)
  preview.value?.close(); details.value?.close(); selected.value = undefined
  for (const url of Object.keys(durations.value)) if (!urls.includes(url)) delete durations.value[url]
})
</script>

<template>
  <ul v-if="references.length" class="reference-list" :class="{ 'compact-references': compact }" :aria-label="compact ? '参考素材' : files.some(file => file.kind !== 'image') ? '已添加附件' : '参考图片'">
    <li v-for="(file, index) in files" :key="`${file.url}:${index}`" :data-attachment-kind="file.kind">
      <button class="reference-preview" type="button" :aria-label="file.kind === 'image' ? `预览参考图 ${index + 1}` : file.kind === 'video' && compact ? sourceVideo ? '预览源视频' : `预览参考视频 ${index + 1}` : `预览附件 ${file.name}`" :title="`${file.name}${file.size === undefined ? '' : ' · ' + formatMaterialSize(file.size)}`" @click="open(index, $event)" @dblclick.stop.prevent="openEditor(index)">
        <img v-if="file.kind === 'image'" :src="mediaSource(file.url, true)" :alt="file.name" />
        <template v-else-if="file.kind === 'video'"><video :src="mediaUrls[file.url] && mediaSource(mediaUrls[file.url]!, false, 'video')" muted playsinline preload="metadata" aria-hidden="true" @loadedmetadata="metadata(index, $event)" /><Play class="attachment-play" :size="20" aria-hidden="true" /></template>
        <template v-else><Music v-if="file.kind === 'audio'" :size="22" aria-hidden="true" /><File v-else :size="22" aria-hidden="true" /><span class="attachment-name">{{ file.name }}</span><audio v-if="file.kind === 'audio'" :src="mediaUrls[file.url]" preload="metadata" @loadedmetadata="metadata(index, $event)" /></template>
        <span v-if="durationLabel(index)" class="attachment-duration">{{ durationLabel(index) }}</span>
      </button>
      <button v-if="file.kind === 'image'" class="reference-edit" type="button" :aria-label="`编辑参考图 ${index + 1}`" title="打开图片画布" @click.stop="openEditor(index)"><Pencil :size="14" /></button>
      <button class="reference-remove" type="button" :disabled="disabled" :aria-label="file.kind === 'image' ? `移除参考图 ${index + 1}` : compact ? `移除${file.kind === 'audio' ? '参考音频' : sourceVideo ? '源视频' : '参考视频'} ${index + 1}` : `移除附件 ${file.name}`" :title="`移除 ${file.name}`" @click="remove(index)"><X :size="14" /></button>
    </li>
  </ul>
  <StudioMediaPreview ref="preview" :items="items" :label="compact ? '参考素材预览' : files.some(file => file.kind !== 'image') ? '附件预览' : '参考图预览'" :close-label="compact ? '关闭参考素材预览' : files.some(file => file.kind !== 'image') ? '关闭附件预览' : '关闭参考图预览'" />
  <Teleport to="body"><dialog ref="details" class="compact-dialog attachment-details" aria-label="附件详情" @close="selected = undefined">
    <header><strong>附件详情</strong><button type="button" class="icon-button" aria-label="关闭附件详情" autofocus @click="details?.close()"><X :size="18" /></button></header>
    <template v-if="selected"><p>{{ selected.name }}</p><p class="attachment-info">{{ selected.type }}<template v-if="selected.size !== undefined"> · {{ formatMaterialSize(selected.size) }}</template></p><audio v-if="selected.kind === 'audio'" :src="mediaUrls[selected.url]" :aria-label="selected.name" controls preload="metadata" /></template>
  </dialog></Teleport>
</template>

<style scoped>
.reference-list { display: flex; flex-shrink: 0; min-width: 0; max-width: 100%; overflow-x: auto; overflow-y: hidden; overscroll-behavior-x: contain; scrollbar-width: thin; scrollbar-color: var(--border) transparent; list-style: none; gap: 8px; padding: 0 5px 4px; margin: 0 0 8px; }
li { flex: 0 0 64px; width: 64px; height: 64px; position: relative; border-radius: 12px; }
.reference-preview { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; width: 100%; height: 100%; padding: 0; border: 0; border-radius: 12px; overflow: hidden; background: var(--surface-soft); color: var(--muted); cursor: pointer; }
img, video { display: block; width: 100%; height: 100%; object-fit: cover; }
.attachment-play { position: absolute; top: 22px; left: 22px; color: white; filter: drop-shadow(0 1px 3px rgb(0 0 0 / 55%)); }
.attachment-name { display: block; max-width: 100%; padding-inline: 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; line-height: 16px; }
.attachment-duration { position: absolute; bottom: 3px; right: 3px; padding: 1px 3px; border-radius: 4px; background: rgb(0 0 0 / 55%); color: white; font-size: 12px; line-height: 16px; font-variant-numeric: tabular-nums; }
.reference-preview audio { display: none; }
.reference-preview:has(audio) { justify-content: flex-start; gap: 1px; padding-top: 5px; }
.attachment-details { width: min(400px, calc(100vw - 32px)); color: var(--ink); background: var(--surface); }
.attachment-details header { display: flex; align-items: center; justify-content: space-between; gap: 16px; }.attachment-details p { overflow-wrap: anywhere; }.attachment-info { color: var(--muted); font-size: 12px; }.attachment-details audio { display: block; width: 100%; }
.reference-preview::after { content: ''; position: absolute; inset: 0; border-radius: inherit; pointer-events: none; background: rgb(0 0 0 / 30%); opacity: 0; transition: opacity 150ms ease-out; }
.reference-remove { position: absolute; top: 4px; right: 4px; display: grid; place-items: center; width: 24px; height: 24px; padding: 0; border: 0; border-radius: 50%; background: var(--surface); color: var(--danger); opacity: 0; cursor: pointer; transition: opacity 150ms ease-out; }
.reference-edit { position: absolute; bottom: 4px; left: 4px; display: grid; place-items: center; width: 24px; height: 24px; padding: 0; border: 0; border-radius: 50%; background: var(--surface); color: var(--ink); opacity: 0; cursor: pointer; }
li:hover .reference-edit, li:focus-within .reference-edit { opacity: 1; }
li:hover .reference-preview::after, li:focus-within .reference-preview::after, li:hover .reference-remove, li:focus-within .reference-remove { opacity: 1; }
button:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: -2px; }
@media (hover: none), (pointer: coarse) {
  .reference-list { gap: 16px; padding: 12px; }
  .reference-remove { top: -12px; right: -12px; width: 44px; height: 44px; opacity: 1; background: transparent; color: #fff; }
  .reference-remove::before { content: ''; position: absolute; inset: 10px; border-radius: 50%; background: rgb(0 0 0 / 55%); }
  .reference-remove > svg { position: relative; }
  .reference-edit { bottom: -12px; left: -12px; width: 44px; height: 44px; opacity: 1; background: transparent; color: #fff; }
  .reference-edit::before { content: ''; position: absolute; inset: 10px; border-radius: 50%; background: rgb(0 0 0 / 55%); }.reference-edit > svg { position: relative; }
}
@media (prefers-reduced-motion: reduce) { .reference-preview::after, .reference-remove { transition: none; } }
</style>
