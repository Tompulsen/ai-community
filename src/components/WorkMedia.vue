<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { ChevronLeft, ChevronRight, Download, FileText, ImageOff, Maximize2 } from '@lucide/vue'
import type { WorkFile } from '../data'
import StudioMediaPreview from './studio-message/StudioMediaPreview.vue'

const props = defineProps<{ files: WorkFile[]; references?: WorkFile[]; title: string; body?: string; resource?: boolean; mobile?: boolean }>()
const selected = ref(0)
const viewingReference = ref(false)
const failed = ref(new Set<string>())
const preview = ref<InstanceType<typeof StudioMediaPreview>>()
const activeFiles = computed(() => viewingReference.value ? props.references || [] : props.files)
const file = computed(() => activeFiles.value[selected.value])
function previewable(item: WorkFile) { return item.type.startsWith('image/') || item.type.startsWith('video/') }
const previewFiles = computed(() => activeFiles.value.filter(previewable))
const previewItems = computed(() => previewFiles.value.map(item => ({ src: item.url, kind: item.type.startsWith('video/') ? 'video' as const : 'image' as const, alt: item.name })))
watch(() => props.files, () => { preview.value?.close(); selected.value = 0; viewingReference.value = false; failed.value.clear() })
async function choose(index: number, reference = false) {
  pause(); selected.value = index; viewingReference.value = reference
  if (props.mobile) { await nextTick(); await openPreview() }
}
function step(offset: number) { selected.value = (selected.value + offset + activeFiles.value.length) % activeFiles.value.length }
const browser = ref<HTMLElement>()
let previewTrigger: HTMLElement | null = null
function pause() { browser.value?.querySelectorAll('video').forEach(video => video.pause()) }
function closePreview() {
  pause()
  if (previewTrigger && !previewTrigger.isConnected) browser.value?.querySelector<HTMLElement>('.media-image-preview, .media-tools button[aria-label="放大预览"], button.material-thumbnail.selected')?.focus()
  previewTrigger = null
}
async function openPreview() {
  if (!file.value || !previewable(file.value)) return
  previewTrigger = document.activeElement instanceof HTMLElement ? document.activeElement : null
  pause(); await nextTick()
  await preview.value?.open(previewFiles.value.findIndex(item => item.id === file.value?.id))
}
defineExpose({ pause })
</script>

<template>
  <div ref="browser" class="work-media-browser">
    <slot v-if="resource && !file" name="overlay" />
    <article v-if="resource" class="resource-article" aria-label="资源内容"><div class="resource-label"><FileText :size="18" /><span>资源内容</span></div><pre>{{ body }}</pre></article>
    <div v-if="!resource || file" class="media-stage"><div class="detail-media">
      <div v-if="!file" class="empty-state"><ImageOff :size="28" /><p>暂无可预览的作品文件</p></div>
      <div v-else-if="failed.has(file.id)" class="empty-state" role="alert"><ImageOff :size="28" /><p>文件预览加载失败</p><button class="button btn" @click="failed.delete(file.id)">重新加载</button><a :href="file.url" class="text-link" target="_blank" rel="noopener noreferrer">打开原文件</a></div>
      <video v-else-if="file.type.startsWith('video/')" :key="file.id" :src="file.url" controls playsinline preload="metadata" :aria-label="file.name" @error="failed.add(file.id)" />
      <button v-else-if="file.type.startsWith('image/')" class="media-image-preview" type="button" :aria-label="`完整预览 ${file.name || title}`" @click="openPreview"><img :key="file.id" :src="file.url" :alt="file.name || title" @error="failed.add(file.id)" /></button>
      <a v-else :href="file.url" class="button btn" download><FileText :size="20" />{{ file.name }}<Download :size="16" /></a>
    </div>
    <div v-if="file && !mobile" class="media-controls"><div class="media-page-controls"><button class="icon-button" aria-label="上一个文件" title="上一个文件" :disabled="activeFiles.length < 2" @click="step(-1)"><ChevronLeft :size="18" /></button><span class="caption-5">{{ selected + 1 }} / {{ activeFiles.length }}{{ viewingReference ? ' · 参考图' : ' · 作品' }}</span><button class="icon-button" aria-label="下一个文件" title="下一个文件" :disabled="activeFiles.length < 2" @click="step(1)"><ChevronRight :size="18" /></button></div><span class="media-file-name" :title="file.name">{{ file.name }}</span><div class="media-tools"><a :href="file.url" download :aria-label="`下载 ${file.name}`" class="icon-button" title="下载文件"><Download :size="18" /></a><button v-if="file.type.startsWith('image/') || file.type.startsWith('video/')" class="icon-button" aria-label="放大预览" title="放大预览" @click="openPreview"><Maximize2 :size="18" /></button></div></div>
    <slot name="overlay" />
    </div>
    <div v-if="(mobile && files.length) || files.length > 1 || references?.length" class="material-tray">
      <section v-for="group in [{ title: '作品文件', items: files, reference: false }, { title: '参考图', items: references || [], reference: true }]" :key="group.title" class="material-group" :aria-label="group.title">
        <template v-if="group.items.length"><h3 class="title-4">{{ group.title }} · {{ group.items.length }}</h3><div class="material-strip"><component :is="previewable(item) ? 'button' : 'a'" v-for="(item, index) in group.items" :key="item.id" class="material-thumbnail" :class="{ selected: selected === index && viewingReference === group.reference }" :aria-label="`预览 ${item.name}`" :title="item.name" :aria-pressed="previewable(item) ? selected === index && viewingReference === group.reference : undefined" :href="!previewable(item) ? item.url : undefined" :target="!previewable(item) ? '_blank' : undefined" :rel="!previewable(item) ? 'noopener noreferrer' : undefined" @click="previewable(item) && choose(index, group.reference)"><img v-if="item.type.startsWith('image/')" :src="item.thumbnailUrl || item.url" :alt="item.name" loading="lazy" /><video v-else-if="item.type.startsWith('video/')" :src="item.url" preload="metadata" muted /><FileText v-else :size="22" /></component></div></template>
      </section>
    </div>
    <StudioMediaPreview ref="preview" :items="previewItems" label="作品文件预览" close-label="关闭预览" @close="closePreview" />
  </div>
</template>

<style scoped>
.work-media-browser { position: relative; min-width: 0; }
.media-stage { background: var(--canvas); border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; }
.detail-media { min-height: 360px; height: min(66svh, 720px); background: var(--canvas); border-radius: 0; }
.media-image-preview, .media-image-preview > img, .detail-media > video { width: 100%; height: 100%; max-height: 100%; object-fit: contain; }
.media-image-preview { display: block; padding: 0; border: 0; border-radius: 0; background: transparent; cursor: zoom-in; }
.media-image-preview > img { display: block; }
.media-image-preview:focus-visible { outline-offset: -4px; }
.detail-media .empty-state { min-height: 320px; margin: 0; color: var(--muted); }
.media-controls { display: grid; grid-template-columns: max-content minmax(0, 1fr) max-content; align-items: center; gap: 12px; min-height: 60px; padding: 6px 12px; border-top: 1px solid var(--border); background: var(--canvas); }
.media-page-controls, .media-tools { display: flex; align-items: center; gap: 4px; }
.media-page-controls .icon-button, .media-tools .icon-button { width: 40px; height: 40px; min-height: 40px; }
.media-file-name { min-width: 0; color: var(--muted); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: center; }
.material-tray { display: flex; flex: none; gap: 16px; padding: 8px 12px; border-top: 1px solid var(--border); }
.material-group { flex: 1; min-width: 0; }
.material-group:empty { display: none; }
.material-group h3 { margin: 0 0 4px; color: var(--muted); font-size: 12px; line-height: 16px; font-weight: 500; white-space: nowrap; }
.material-strip { display: flex; gap: 8px; overflow-x: auto; padding: 2px; scrollbar-width: thin; }
.material-thumbnail { width: 44px; height: 44px; flex: 0 0 44px; display: grid; place-items: center; border: 1px solid var(--border); background: var(--surface); border-radius: var(--radius); overflow: hidden; padding: 0; cursor: pointer; transition: border-color 180ms var(--ease); }
.material-thumbnail:hover { border-color: var(--muted); }
.material-thumbnail.selected { border-color: var(--focus-ring); outline: 1px solid var(--focus-ring); outline-offset: var(--focus-outline-offset); }
.material-thumbnail img, .material-thumbnail video { width: 100%; height: 100%; object-fit: contain; }
.resource-article { padding: 0 0 24px; background: transparent; color: var(--ink); }
.resource-label { display: flex; align-items: center; gap: 8px; padding-bottom: 16px; border-bottom: 1px solid var(--border); color: var(--muted); font-size: 13px; }
.resource-article pre { max-width: 72ch; white-space: pre-wrap; overflow-wrap: anywhere; margin-top: 24px; font-family: inherit; font-size: 16px; line-height: 28px; }
@media (max-width: 639px) {
  .detail-media { min-height: 280px; height: min(62svh, 560px); }
  .media-controls { padding: 4px 8px; gap: 8px; }
  .media-page-controls .icon-button, .media-tools .icon-button { width: 44px; height: 44px; min-height: 44px; }
  .media-file-name { display: none; }
  .media-controls { grid-template-columns: max-content max-content; justify-content: space-between; }
}
</style>
