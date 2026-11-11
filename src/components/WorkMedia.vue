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
    <article v-if="resource" class="resource-article"><h2>{{ title }}</h2><pre>{{ body }}</pre></article>
    <div v-if="!resource || file" class="detail-media">
      <div v-if="!file" class="empty-state"><ImageOff :size="28" /><p>暂无可预览的作品文件</p></div>
      <div v-else-if="failed.has(file.id)" class="empty-state" role="alert"><ImageOff :size="28" /><p>文件预览加载失败</p><button class="button" @click="failed.delete(file.id)">重新加载</button><a :href="file.url" class="text-link" target="_blank" rel="noopener noreferrer">打开原文件</a></div>
      <video v-else-if="file.type.startsWith('video/')" :key="file.id" :src="file.url" controls playsinline preload="metadata" :aria-label="file.name" @error="failed.add(file.id)" />
      <img v-else-if="file.type.startsWith('image/')" :key="file.id" :src="file.url" :alt="file.name || title" @error="failed.add(file.id)" />
      <a v-else :href="file.url" class="button" download><FileText :size="20" />{{ file.name }}<Download :size="16" /></a>
    </div>
    <div v-if="file" class="media-controls"><div><button class="icon-button" aria-label="上一个文件" title="上一个文件" :disabled="activeFiles.length < 2" @click="step(-1)"><ChevronLeft :size="18" /></button><span class="caption-5">{{ selected + 1 }} / {{ activeFiles.length }}{{ viewingReference ? ' · 参考图' : '' }}</span><button class="icon-button" aria-label="下一个文件" title="下一个文件" :disabled="activeFiles.length < 2" @click="step(1)"><ChevronRight :size="18" /></button></div><div><a :href="file.url" download :aria-label="`下载 ${file.name}`" class="icon-button" title="下载文件"><Download :size="18" /></a><button v-if="file.type.startsWith('image/') || file.type.startsWith('video/')" class="icon-button" aria-label="放大预览" title="放大预览" @click="preview?.showModal()"><Maximize2 :size="18" /></button></div></div>
    <section v-for="group in [{ title: '作品文件', items: files, reference: false }, { title: '参考图', items: references || [], reference: true }]" :key="group.title" class="material-group">
      <template v-if="group.items.length"><h3 class="title-4">{{ group.title }} · {{ group.items.length }}</h3><div class="material-strip"><div v-for="(item, index) in group.items" :key="item.id" class="material-item"><button class="material-thumbnail" :class="{ selected: selected === index && viewingReference === group.reference }" :aria-label="`预览 ${item.name}`" :aria-pressed="selected === index && viewingReference === group.reference" @click="choose(index, group.reference)"><img v-if="item.type.startsWith('image/')" :src="item.thumbnailUrl || item.url" :alt="item.name" loading="lazy" /><video v-else-if="item.type.startsWith('video/')" :src="item.url" preload="metadata" muted /><FileText v-else :size="22" /></button><a :href="item.url" download class="file-download" :title="`下载 ${item.name}`"><span>{{ item.name }}</span><Download :size="14" /></a></div></div></template>
    </section>
    <dialog ref="preview" class="media-preview" aria-label="作品文件预览"><div class="dialog-heading"><span>{{ file?.name }}</span><button class="icon-button" aria-label="关闭预览" @click="preview?.close()"><X :size="20" /></button></div><video v-if="file?.type.startsWith('video/')" :src="file.url" controls playsinline /><img v-else-if="file?.type.startsWith('image/')" :src="file.url" :alt="file.name" /><div class="media-controls"><button class="icon-button" aria-label="上一个文件" :disabled="activeFiles.length < 2" @click="step(-1)"><ChevronLeft :size="20" /></button><a v-if="file" :href="file.url" download class="button"><Download :size="16" />下载原文件</a><button class="icon-button" aria-label="下一个文件" :disabled="activeFiles.length < 2" @click="step(1)"><ChevronRight :size="20" /></button></div></dialog>
  </div>
</template>

<style scoped>
.work-media-browser { min-width: 0; }
.media-controls, .media-controls > div { display: flex; align-items: center; gap: 8px; }
.media-controls { justify-content: space-between; padding: 8px 0; }
.material-group { margin-top: 16px; }
.material-group h3 { margin-bottom: 8px; }
.material-strip { display: flex; gap: 12px; overflow-x: auto; padding: 2px; }
.material-item { width: 88px; flex: 0 0 88px; }
.material-thumbnail { width: 88px; height: 88px; display: grid; place-items: center; border: 1px solid var(--border); background: var(--surface-soft); border-radius: 6px; overflow: hidden; padding: 0; cursor: pointer; }
.material-thumbnail.selected { border-color: var(--blue); outline: 1px solid var(--blue); }
.material-thumbnail img, .material-thumbnail video { width: 100%; height: 100%; object-fit: contain; }
.file-download { display: flex; align-items: center; gap: 4px; padding: 8px 0; font-size: 12px; }
.file-download span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.file-download svg { flex: none; }
.resource-article { padding: 24px; background: var(--surface-soft); }
.resource-article pre { max-width: 72ch; white-space: pre-wrap; overflow-wrap: anywhere; margin-top: 16px; font-family: inherit; font-size: 16px; line-height: 28px; }
.media-preview { width: min(1200px, calc(100vw - 32px)); }
.media-preview > img, .media-preview > video { display: block; width: 100%; max-height: 75svh; object-fit: contain; }
.media-preview > .media-controls { padding: 12px 24px; }
</style>
