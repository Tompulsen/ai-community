<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ChevronLeft, ChevronRight, Download, FileText, ImageOff, Maximize2, X } from '@lucide/vue'
import type { WorkFile } from '../data'

const props = defineProps<{ files: WorkFile[]; references?: WorkFile[]; title: string; body?: string; resource?: boolean }>()
const selected = ref(0)
const viewingReference = ref(false)
const failed = ref(new Set<string>())
const preview = ref<HTMLDialogElement>()
const activeFiles = computed(() => viewingReference.value ? props.references || [] : props.files)
const file = computed(() => activeFiles.value[selected.value])
watch(() => props.files, () => { selected.value = 0; viewingReference.value = false; failed.value.clear() })
function choose(index: number, reference = false) { selected.value = index; viewingReference.value = reference }
function step(offset: number) { selected.value = (selected.value + offset + activeFiles.value.length) % activeFiles.value.length }
</script>

<template>
  <div class="work-media-browser">
    <article v-if="resource" class="resource-article" aria-label="资源内容"><div class="resource-label"><FileText :size="18" /><span>资源内容</span></div><pre>{{ body }}</pre></article>
    <div v-if="!resource || file" class="media-stage"><div class="detail-media">
      <div v-if="!file" class="empty-state"><ImageOff :size="28" /><p>暂无可预览的作品文件</p></div>
      <div v-else-if="failed.has(file.id)" class="empty-state" role="alert"><ImageOff :size="28" /><p>文件预览加载失败</p><button class="button btn" @click="failed.delete(file.id)">重新加载</button><a :href="file.url" class="text-link" target="_blank" rel="noopener noreferrer">打开原文件</a></div>
      <video v-else-if="file.type.startsWith('video/')" :key="file.id" :src="file.url" controls playsinline preload="metadata" :aria-label="file.name" @error="failed.add(file.id)" />
      <img v-else-if="file.type.startsWith('image/')" :key="file.id" :src="file.url" :alt="file.name || title" @error="failed.add(file.id)" />
      <a v-else :href="file.url" class="button btn" download><FileText :size="20" />{{ file.name }}<Download :size="16" /></a>
    </div>
    <div v-if="file" class="media-controls"><div class="media-page-controls"><button class="icon-button" aria-label="上一个文件" title="上一个文件" :disabled="activeFiles.length < 2" @click="step(-1)"><ChevronLeft :size="18" /></button><span class="caption-5">{{ selected + 1 }} / {{ activeFiles.length }}{{ viewingReference ? ' · 参考图' : '' }}</span><button class="icon-button" aria-label="下一个文件" title="下一个文件" :disabled="activeFiles.length < 2" @click="step(1)"><ChevronRight :size="18" /></button></div><span class="media-file-name" :title="file.name">{{ file.name }}</span><div class="media-tools"><a :href="file.url" download :aria-label="`下载 ${file.name}`" class="icon-button" title="下载文件"><Download :size="18" /></a><button v-if="file.type.startsWith('image/') || file.type.startsWith('video/')" class="icon-button" aria-label="放大预览" title="放大预览" @click="preview?.showModal()"><Maximize2 :size="18" /></button></div></div>
    </div>
    <section v-for="group in [{ title: '作品文件', items: files, reference: false }, { title: '参考图', items: references || [], reference: true }]" :key="group.title" class="material-group">
      <template v-if="group.items.length"><h3 class="title-4">{{ group.title }} · {{ group.items.length }}</h3><div class="material-strip"><div v-for="(item, index) in group.items" :key="item.id" class="material-item"><button class="material-thumbnail" :class="{ selected: selected === index && viewingReference === group.reference }" :aria-label="`预览 ${item.name}`" :aria-pressed="selected === index && viewingReference === group.reference" @click="choose(index, group.reference)"><img v-if="item.type.startsWith('image/')" :src="item.thumbnailUrl || item.url" :alt="item.name" loading="lazy" /><video v-else-if="item.type.startsWith('video/')" :src="item.url" preload="metadata" muted /><FileText v-else :size="22" /></button><a :href="item.url" download class="file-download" :title="`下载 ${item.name}`"><span>{{ item.name }}</span><Download :size="14" /></a></div></div></template>
    </section>
    <dialog ref="preview" class="media-preview" aria-label="作品文件预览"><div class="dialog-heading"><span>{{ file?.name }}</span><button class="icon-button" aria-label="关闭预览" @click="preview?.close()"><X :size="20" /></button></div><video v-if="file?.type.startsWith('video/')" :src="file.url" controls playsinline /><img v-else-if="file?.type.startsWith('image/')" :src="file.url" :alt="file.name" /><div class="media-controls"><button class="icon-button" aria-label="上一个文件" :disabled="activeFiles.length < 2" @click="step(-1)"><ChevronLeft :size="20" /></button><a v-if="file" :href="file.url" download class="button btn"><Download :size="16" />下载原文件</a><button class="icon-button" aria-label="下一个文件" :disabled="activeFiles.length < 2" @click="step(1)"><ChevronRight :size="20" /></button></div></dialog>
  </div>
</template>

<style scoped>
.work-media-browser { min-width: 0; }
.media-stage { background: var(--canvas); border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; }
.detail-media { min-height: 360px; height: min(66svh, 720px); background: var(--canvas); border-radius: 0; }
.detail-media > img, .detail-media > video { width: 100%; height: 100%; max-height: 100%; object-fit: contain; }
.detail-media .empty-state { min-height: 320px; margin: 0; color: var(--muted); }
.media-controls { display: grid; grid-template-columns: max-content minmax(0, 1fr) max-content; align-items: center; gap: 12px; min-height: 60px; padding: 6px 12px; border-top: 1px solid var(--border); background: var(--canvas); }
.media-page-controls, .media-tools { display: flex; align-items: center; gap: 4px; }
.media-page-controls .icon-button, .media-tools .icon-button { width: 40px; height: 40px; min-height: 40px; }
.media-file-name { min-width: 0; color: var(--muted); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: center; }
.material-group { margin-top: 24px; }
.material-group h3 { margin-bottom: 12px; color: var(--muted); font-size: 12px; line-height: 20px; font-weight: 500; }
.material-strip { display: flex; gap: 12px; overflow-x: auto; padding: 2px 2px 8px; }
.material-item { width: 80px; flex: 0 0 80px; }
.material-thumbnail { width: 80px; height: 80px; display: grid; place-items: center; border: 1px solid var(--border); background: var(--surface); border-radius: var(--radius); overflow: hidden; padding: 0; cursor: pointer; transition: border-color 180ms var(--ease); }
.material-thumbnail:hover { border-color: var(--muted); }
.material-thumbnail.selected { border-color: var(--blue); outline: 1px solid var(--blue); outline-offset: 1px; }
.material-thumbnail img, .material-thumbnail video { width: 100%; height: 100%; object-fit: contain; }
.file-download { display: flex; align-items: center; gap: 4px; padding: 8px 0; min-height: 36px; font-size: 12px; color: var(--muted); }
.file-download:hover { color: var(--blue); }
.file-download span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.file-download svg { flex: none; }
.resource-article { padding: 0 0 24px; background: transparent; color: var(--ink); }
.resource-label { display: flex; align-items: center; gap: 8px; padding-bottom: 16px; border-bottom: 1px solid var(--border); color: var(--muted); font-size: 13px; }
.resource-article pre { max-width: 72ch; white-space: pre-wrap; overflow-wrap: anywhere; margin-top: 24px; font-family: inherit; font-size: 16px; line-height: 28px; }
.media-preview { width: min(1280px, calc(100vw - 32px)); padding: 0; background: var(--canvas); color: var(--ink); border: 1px solid var(--border); border-radius: var(--radius); }
.media-preview .dialog-heading > span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.media-preview > img, .media-preview > video { display: block; width: 100%; max-height: 75svh; object-fit: contain; }
.media-preview > .media-controls { display: flex; justify-content: space-between; padding: 12px 24px; }
@media (max-width: 639px) {
  .detail-media { min-height: 280px; height: min(62svh, 560px); }
  .media-controls { padding: 4px 8px; gap: 8px; }
  .media-page-controls .icon-button, .media-tools .icon-button { width: 44px; height: 44px; min-height: 44px; }
  .media-file-name { display: none; }
  .media-controls { grid-template-columns: max-content max-content; justify-content: space-between; }
  .material-group { margin-top: 20px; }
  .file-download { min-height: 44px; }
  .media-preview > .media-controls { padding: 8px 12px; }
}
</style>
