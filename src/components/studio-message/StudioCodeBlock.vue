<script setup lang="ts">
// Adapted from octopus_chat/app/components/markdown.tsx (MIT).
import { computed, nextTick, onBeforeUnmount, ref, useId, watch } from 'vue'
import { Check, ChevronDown, ChevronUp, Code2, Copy, Eye, X } from '@lucide/vue'
import DOMPurify from 'dompurify'
import hljs from 'highlight.js/lib/common'
import { escapeMarkdownHtml, isPreviewableHtml } from '../../studio-markdown'
import StudioHtmlPreview from './StudioHtmlPreview.vue'

const props = defineProps<{ code: string; language?: string; streaming?: boolean }>()
const language = computed(() => (props.language || 'text').toLowerCase())
const expanded = ref(false)
const copied = ref(false)
const copyFailed = ref(false)
const showPreview = ref(true)
const diagram = ref('')
const diagramError = ref('')
const diagramDialog = ref<HTMLDialogElement>()
const diagramId = useId().replace(/[^a-z\d_-]/gi, '')
const pre = ref<HTMLPreElement>()
const block = ref<HTMLElement>()
const wrappedOverflow = ref(false)
let preObserver: ResizeObserver | undefined
let copyTimer: ReturnType<typeof setTimeout> | undefined
let renderRevision = 0
const lineCount = computed(() => props.code.replace(/\n$/, '').split('\n').length)
const foldable = computed(() => lineCount.value > 14 || wrappedOverflow.value)
const htmlPreview = computed(() => !props.streaming && isPreviewableHtml(props.code, language.value))
const isMermaid = computed(() => language.value === 'mermaid')
const wrap = computed(() => ['text', 'txt', 'plaintext', 'md', 'markdown', 'tex', 'latex'].includes(language.value))
const highlighted = computed(() => {
  if (!hljs.getLanguage(language.value)) return escapeMarkdownHtml(props.code)
  try { return hljs.highlight(props.code, { language: language.value, ignoreIllegals: true }).value } catch { return escapeMarkdownHtml(props.code) }
})
const safeHighlight = computed(() => DOMPurify.sanitize(highlighted.value))
async function copy() {
  try {
    await navigator.clipboard.writeText(props.code)
    copied.value = true
    copyFailed.value = false
  } catch { copyFailed.value = true }
  clearTimeout(copyTimer)
  copyTimer = setTimeout(() => { copied.value = false; copyFailed.value = false }, 1800)
}
async function toggleFold() {
  expanded.value = !expanded.value
  if (!expanded.value) {
    await nextTick()
    if (pre.value) pre.value.scrollTop = 0
    block.value?.scrollIntoView({ block: 'nearest' })
  }
}
watch(pre, element => {
  preObserver?.disconnect()
  wrappedOverflow.value = false
  if (!element) return
  const measure = () => { wrappedOverflow.value = element.scrollHeight > 332 }
  preObserver = new ResizeObserver(measure)
  preObserver.observe(element)
  measure()
})
watch(() => [props.code, props.streaming, isMermaid.value] as const, async () => {
  const revision = ++renderRevision
  if (!isMermaid.value || props.streaming) { diagram.value = ''; diagramError.value = ''; return }
  try {
    const { default: mermaid } = await import('mermaid')
    // Strict mode disables diagram links and embedded executable markup.
    mermaid.initialize({
      startOnLoad: false, securityLevel: 'strict', theme: 'neutral', htmlLabels: false, suppressErrorRendering: true,
      secure: ['secure', 'securityLevel', 'startOnLoad', 'maxTextSize', 'maxEdges', 'suppressErrorRendering', 'themeCSS', 'htmlLabels'],
    })
    const result = await mermaid.render(`studio-diagram-${diagramId}-${revision}`, props.code)
    if (revision !== renderRevision) return
    diagram.value = DOMPurify.sanitize(result.svg, { USE_PROFILES: { svg: true, svgFilters: true }, FORBID_TAGS: ['foreignObject', 'script'], FORBID_ATTR: ['href', 'xlink:href'] })
    diagramError.value = ''
  } catch {
    if (revision === renderRevision) { diagram.value = ''; diagramError.value = '图表暂时无法渲染，已保留源代码。' }
  }
}, { immediate: true })
onBeforeUnmount(() => { clearTimeout(copyTimer); preObserver?.disconnect(); renderRevision++ })
</script>

<template>
  <section ref="block" class="studio-code-block">
    <header class="code-header">
      <span>{{ language }}</span>
      <span v-if="copyFailed" role="status">复制失败</span>
      <button v-if="htmlPreview || diagram" type="button" :title="showPreview ? '查看源代码' : '查看预览'" :aria-label="showPreview ? '查看源代码' : '查看预览'" @click="showPreview = !showPreview"><Code2 v-if="showPreview" :size="15" /><Eye v-else :size="15" /></button>
      <button type="button" :title="copied ? '已复制' : '复制代码'" :aria-label="copied ? '已复制' : '复制代码'" @click="copy"><Check v-if="copied" :size="15" /><Copy v-else :size="15" /></button>
      <span class="sr-only" role="status">{{ copied ? '代码已复制' : '' }}</span>
    </header>
    <button v-if="diagram && showPreview" class="diagram-preview" type="button" title="放大图表" aria-label="放大图表" @click="diagramDialog?.showModal()"><span v-html="diagram"></span></button>
    <StudioHtmlPreview v-else-if="htmlPreview && showPreview" :code="code" />
    <template v-else>
      <pre ref="pre" :class="{ collapsed: foldable && !expanded, wrap }"><code class="hljs" v-html="safeHighlight"></code></pre>
      <button v-if="foldable" class="code-fold" type="button" :aria-expanded="expanded" @click="toggleFold"><ChevronUp v-if="expanded" :size="14" /><ChevronDown v-else :size="14" />{{ expanded ? '收起' : '展开' }}<span>{{ lineCount }} 行</span></button>
    </template>
    <p v-if="diagramError" class="diagram-error" role="status">{{ diagramError }}</p>
    <dialog ref="diagramDialog" class="diagram-dialog" aria-label="放大图表" @click="($event.target === diagramDialog) && diagramDialog?.close()">
      <button type="button" class="dialog-close" title="关闭图表" aria-label="关闭图表" @click="diagramDialog?.close()"><X :size="20" /></button>
      <div v-html="diagram"></div>
    </dialog>
  </section>
</template>

<style scoped>
.studio-code-block { min-width: 0; max-width: 100%; margin: 12px 0; border-radius: 6px; overflow: hidden; background: var(--canvas); color: var(--ink); font-size: 13px; }
.code-header { position: relative; display: flex; align-items: center; gap: 4px; padding: 6px 8px 6px 12px; color: var(--muted); font-size: 12px; line-height: 20px; }
.code-header > span:first-child { margin-right: auto; }
button { display: inline-flex; align-items: center; justify-content: center; border: 0; color: inherit; background: transparent; border-radius: 4px; cursor: pointer; }
.code-header button { width: 28px; height: 28px; }
button:hover { background: var(--surface); color: var(--ink); }
pre { margin: 0 !important; padding: 12px !important; overflow: auto; background: transparent !important; font: 13px/22px ui-monospace, SFMono-Regular, Consolas, monospace; tab-size: 2; }
pre.collapsed { max-height: 332px; }
pre.wrap { white-space: pre-wrap; overflow-wrap: anywhere; }
code { font: inherit; background: transparent; padding: 0; }
.code-fold { width: 100%; gap: 5px; padding: 8px; font-size: 12px; color: var(--muted); }
.code-fold span { margin-left: 8px; }
.diagram-preview { display: block; width: 100%; padding: 16px; background: white; }
.diagram-preview :deep(svg) { display: block; max-width: 100%; height: auto; margin: auto; }
.diagram-error { padding: 0 12px 10px; margin: 0; color: var(--muted); font-size: 12px; }
.diagram-dialog { padding: 40px 20px 20px; width: min(1200px, 94vw); max-height: 92dvh; overflow: auto; border: 0; border-radius: 8px; background: white; }
.diagram-dialog::backdrop { background: #0009; }
.diagram-dialog :deep(svg) { display: block; width: 100%; height: auto; max-width: none !important; }
.dialog-close { position: absolute; top: 8px; right: 8px; width: 32px; height: 32px; color: #333; }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
:deep(.hljs-keyword), :deep(.hljs-selector-tag), :deep(.hljs-literal) { color: color-mix(in srgb, var(--ink) 65%, #b254a3); }
:deep(.hljs-string), :deep(.hljs-attr), :deep(.hljs-template-tag) { color: color-mix(in srgb, var(--ink) 65%, #4a8853); }
:deep(.hljs-number), :deep(.hljs-built_in), :deep(.hljs-type) { color: color-mix(in srgb, var(--ink) 65%, #b97431); }
:deep(.hljs-title), :deep(.hljs-function), :deep(.hljs-section) { color: color-mix(in srgb, var(--ink) 65%, #397aaf); }
:deep(.hljs-comment), :deep(.hljs-quote) { color: var(--muted); }
</style>
