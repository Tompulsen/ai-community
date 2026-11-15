<script setup lang="ts">
// Vue adapter of octopus_chat/app/components/markdown.tsx (MIT).
import { computed, h, onBeforeUnmount, ref, useId, type VNode } from 'vue'
import { ExternalLink, X } from '@lucide/vue'
import 'katex/dist/katex.min.css'
import { renderStudioMarkdown, safeMarkdownUrl } from '../../studio-markdown'
import type { StudioMessageSource } from '../../studio-message-types'
import StudioCodeBlock from './StudioCodeBlock.vue'

const props = withDefaults(defineProps<{ content: string; streaming?: boolean; sources?: StudioMessageSource[] }>(), { streaming: false, sources: () => [] })
const marker = useId()
const rendered = computed(() => renderStudioMarkdown(props.content, props.streaming, props.sources, marker))
const imageDialog = ref<HTMLDialogElement>()
const imageUrl = ref('')
const sourceDialog = ref<HTMLDialogElement>()
const sourceModalOpen = ref(false)
const selectedSource = ref<StudioMessageSource>()
let sourceTimer: ReturnType<typeof setTimeout> | undefined

function convertNode(node: Node, index: number): VNode | string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? ''
  if (!(node instanceof Element)) return ''
  const codeId = node.getAttribute('data-studio-code')
  if (codeId?.startsWith(`${marker}:`)) {
    const code = rendered.value.codes[Number(codeId.slice(marker.length + 1))]
    if (code) return h(StudioCodeBlock, { key: `code-${index}`, code: code.code, language: code.language, streaming: props.streaming })
  }
  const attributes: Record<string, unknown> = { key: index }
  for (const attribute of Array.from(node.attributes)) {
    if (/^on/i.test(attribute.name)) continue
    attributes[attribute.name === 'class' ? 'class' : attribute.name] = attribute.value
  }
  // Raw HTML links and media pass the same URL policy as Markdown links.
  for (const attribute of ['href', 'src']) {
    const media = node.tagName === 'IMG' ? true : node.tagName === 'AUDIO' ? 'audio' : node.tagName === 'VIDEO' ? 'video' : false
    if (typeof attributes[attribute] === 'string') attributes[attribute] = safeMarkdownUrl(attributes[attribute] as string, media)
  }
  if (node.tagName === 'A') { attributes.rel = 'noopener noreferrer'; attributes.target = '_blank' }
  if (node.tagName === 'INPUT') attributes.disabled = true
  return h(node.tagName.toLowerCase(), attributes, Array.from(node.childNodes).map(convertNode))
}
const nodes = computed(() => {
  const document = new DOMParser().parseFromString(rendered.value.html, 'text/html')
  return Array.from(document.body.childNodes).map(convertNode)
})
function showSource(index: number, modal = true) {
  const source = props.sources[index]
  if (!source || !safeMarkdownUrl(source.url)) return
  selectedSource.value = source
  if (modal && !sourceDialog.value?.open) {
    sourceModalOpen.value = true
    sourceDialog.value?.showModal()
  }
}
function handleClick(event: MouseEvent) {
  const target = event.target instanceof Element ? event.target : undefined
  const image = target?.closest<HTMLElement>('[data-studio-image]')
  if (image?.dataset.studioImage) {
    imageUrl.value = safeMarkdownUrl(image.dataset.studioImage, true)
    if (!imageUrl.value) return
    imageDialog.value?.showModal()
    return
  }
  const source = target?.closest<HTMLElement>('[data-studio-source]')
  if (source) showSource(Number(source.dataset.studioSource))
}
function handleHover(event: MouseEvent) {
  const source = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-studio-source]') : null
  clearTimeout(sourceTimer)
  if (source) {
    const index = Number(source.dataset.studioSource)
    sourceTimer = setTimeout(() => showSource(index, false), 350)
  }
}
function renderMarkdown() { return h('div', { class: 'studio-markdown-body', onClick: handleClick, onMouseover: handleHover }, nodes.value) }
onBeforeUnmount(() => clearTimeout(sourceTimer))
</script>

<template>
  <div class="studio-markdown">
    <component :is="renderMarkdown" />
    <div v-if="selectedSource && !sourceModalOpen" class="source-hover" role="status">
      <a :href="safeMarkdownUrl(selectedSource.url)" target="_blank" rel="noopener noreferrer"><strong>{{ selectedSource.title }}</strong><ExternalLink :size="13" /></a>
      <p v-if="selectedSource.snippet">{{ selectedSource.snippet }}</p>
      <button type="button" title="关闭来源预览" aria-label="关闭来源预览" @click="selectedSource = undefined"><X :size="14" /></button>
    </div>
    <dialog ref="imageDialog" class="image-dialog" aria-label="放大图片" @click="($event.target === imageDialog) && imageDialog?.close()">
      <button type="button" class="dialog-close" title="关闭图片" aria-label="关闭图片" @click="imageDialog?.close()"><X :size="22" /></button>
      <img :src="imageUrl" alt="放大图片" />
    </dialog>
    <dialog ref="sourceDialog" class="source-dialog" aria-label="引用来源" @close="sourceModalOpen = false" @click="($event.target === sourceDialog) && sourceDialog?.close()">
      <button type="button" class="dialog-close" title="关闭来源" aria-label="关闭来源" @click="sourceDialog?.close()"><X :size="20" /></button>
      <template v-if="selectedSource"><a :href="safeMarkdownUrl(selectedSource.url)" target="_blank" rel="noopener noreferrer">{{ selectedSource.title }}<ExternalLink :size="14" /></a><p>{{ selectedSource.snippet }}</p><small>{{ selectedSource.url }}</small></template>
    </dialog>
  </div>
</template>

<style scoped>
.studio-markdown { min-width: 0; max-width: 100%; color: var(--ink); overflow-wrap: anywhere; font-size: 15px; line-height: 1.8; }
.studio-markdown-body :deep(> :first-child) { margin-top: 0; }
.studio-markdown-body :deep(> :last-child) { margin-bottom: 0; }
.studio-markdown-body :deep(p) { margin: 0 0 12px; }
.studio-markdown-body :deep(h1), .studio-markdown-body :deep(h2), .studio-markdown-body :deep(h3) { margin: 20px 0 12px; line-height: 1.5; font-size: 18px; }
.studio-markdown-body :deep(h1) { font-size: 22px; }
.studio-markdown-body :deep(h2) { font-size: 20px; }
.studio-markdown-body :deep(ul), .studio-markdown-body :deep(ol) { padding-left: 24px; margin-block: 10px; }
.studio-markdown-body :deep(li > p) { margin-bottom: 4px; }
.studio-markdown-body :deep(input[type=checkbox]) { margin-right: 6px; }
.studio-markdown-body :deep(blockquote) { margin: 12px 0; padding: 2px 16px; border-left: 3px solid var(--border); color: var(--muted); }
.studio-markdown-body :deep(table) { display: block; max-width: 100%; overflow-x: auto; border-collapse: collapse; font-size: 14px; margin-block: 12px; }
.studio-markdown-body :deep(td), .studio-markdown-body :deep(th) { padding: 8px 12px; border: 1px solid var(--border); text-align: left; }
.studio-markdown-body :deep(th) { background: var(--canvas); font-weight: 600; }
.studio-markdown-body :deep(:not(pre) > code) { padding: 2px 5px; border-radius: 4px; background: var(--canvas); font-size: .9em; font-family: ui-monospace, Consolas, monospace; }
.studio-markdown-body :deep(a), .source-hover a, .source-dialog a { color: var(--blue, #4478a6); text-decoration: underline; text-underline-offset: 3px; }
.studio-markdown-body :deep(video), .studio-markdown-body :deep(audio) { display: block; max-width: 100%; margin-block: 12px; }
.studio-markdown-body :deep(video) { max-height: 480px; }
.studio-markdown-body :deep(.studio-markdown-image) { display: block; padding: 0; border: 0; background: none; cursor: zoom-in; max-width: 100%; }
.studio-markdown-body :deep(img) { display: block; max-width: 100%; height: auto; border-radius: 6px; }
.studio-markdown-body :deep(.studio-source-citation) { display: inline-flex; min-width: 20px; height: 20px; padding: 0 5px; margin-inline: 3px; align-items: center; justify-content: center; border: 0; border-radius: 4px; background: var(--surface); color: var(--muted); font-size: 11px; cursor: pointer; vertical-align: baseline; }
.studio-markdown-body :deep(.studio-source-citation:hover) { color: var(--ink); background: var(--border); }
.studio-markdown-body :deep(.katex-display) { max-width: 100%; overflow-x: auto; overflow-y: hidden; padding-block: 4px; }
.source-hover { position: relative; margin-top: 10px; padding: 10px 34px 10px 12px; border-radius: 6px; background: var(--canvas); font-size: 12px; line-height: 1.6; }
.source-hover a, .source-dialog a { display: inline-flex; align-items: center; gap: 6px; }
.source-hover p { margin: 4px 0 0; color: var(--muted); }
.source-hover button { position: absolute; top: 8px; right: 8px; border: 0; background: transparent; color: var(--muted); cursor: pointer; }
dialog { border: 0; padding: 40px 20px 20px; border-radius: 8px; color: var(--ink); background: var(--canvas); }
dialog::backdrop { background: #000b; }
.dialog-close { position: absolute; top: 8px; right: 8px; display: grid; place-items: center; width: 32px; height: 32px; padding: 0; border: 0; border-radius: 4px; background: var(--surface); color: var(--ink); cursor: pointer; }
.image-dialog { max-width: 96vw; max-height: 94dvh; }
.image-dialog img { display: block; max-width: calc(96vw - 40px); max-height: calc(94dvh - 60px); object-fit: contain; }
.source-dialog { width: min(460px, 90vw); overflow-wrap: anywhere; }
.source-dialog p, .source-dialog small { color: var(--muted); }
</style>
