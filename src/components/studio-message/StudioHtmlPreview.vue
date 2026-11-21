<script setup lang="ts">
// Adapted from octopus_chat/app/components/html-preview.tsx (MIT).
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue'
import { Maximize2, Minimize2, RotateCw, X } from '@lucide/vue'

const props = defineProps<{ code: string }>()
const id = useId()
const revision = ref(0)
const height = ref(240)
const title = ref('HTML 预览')
const iframe = ref<HTMLIFrameElement>()
const expanded = ref(false)
const previewRoot = ref<HTMLElement>()
const expandButton = ref<HTMLButtonElement>()
const frameId = computed(() => `${id}-${revision.value}`)
const srcdoc = computed(() => {
  const bridge = `<script>addEventListener("DOMContentLoaded",()=>{const send=()=>parent.postMessage({studioPreview:${JSON.stringify(frameId.value)},height:document.body.scrollHeight,title:document.title},"*");new ResizeObserver(send).observe(document.body);send()})<\/script>`
  const documentCode = props.code
  return /^(\s*<!doctype[^>]*>)/i.test(documentCode)
    ? documentCode.replace(/^(\s*<!doctype[^>]*>)/i, `$1${bridge}`)
    : `${bridge}${documentCode}`
})
function receiveSize(event: MessageEvent) {
  if (event.source !== iframe.value?.contentWindow || !event.data || typeof event.data !== 'object') return
  if (event.data.studioPreview !== frameId.value) return
  const nextHeight: unknown = event.data.height
  if (typeof nextHeight === 'number' && Number.isFinite(nextHeight) && nextHeight >= 0) height.value = Math.min(600, Math.max(120, nextHeight + 16))
  if (typeof event.data.title === 'string' && event.data.title.trim()) title.value = event.data.title.slice(0, 160)
}
watch(expanded, async value => {
  await nextTick()
  if (value && previewRoot.value instanceof HTMLDialogElement) previewRoot.value.showModal()
  else expandButton.value?.focus()
})
onMounted(() => window.addEventListener('message', receiveSize))
onBeforeUnmount(() => window.removeEventListener('message', receiveSize))
</script>

<template>
  <component :is="expanded ? 'dialog' : 'section'" ref="previewRoot" class="studio-html-preview" :class="{ expanded }" aria-label="HTML 预览" @close="expanded = false">
    <header>
      <span>{{ title }}</span>
      <button type="button" title="刷新预览" aria-label="刷新预览" @click="revision++"><RotateCw :size="15" /></button>
      <button ref="expandButton" type="button" :title="expanded ? '退出全屏' : '全屏预览'" :aria-label="expanded ? '退出全屏' : '全屏预览'" @click="expanded = !expanded"><Minimize2 v-if="expanded" :size="15" /><Maximize2 v-else :size="15" /></button>
      <button v-if="expanded" type="button" title="关闭预览" aria-label="关闭预览" @click="expanded = false"><X :size="15" /></button>
    </header>
    <iframe :key="frameId" ref="iframe" :srcdoc="srcdoc" :title="title" sandbox="allow-scripts allow-forms allow-modals" referrerpolicy="no-referrer" :style="{ height: expanded ? '100%' : `${height}px` }" />
  </component>
</template>

<style scoped>
.studio-html-preview { width: 100%; margin-top: 8px; overflow: hidden; border-radius: 6px; background: var(--canvas); }
header { display: flex; align-items: center; gap: 4px; padding: 6px 8px; color: var(--muted); font-size: 12px; }
header span { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
button { display: grid; place-items: center; width: 28px; height: 28px; border: 0; border-radius: 4px; color: inherit; background: transparent; cursor: pointer; }
button:hover:not(:disabled) { color: var(--ink); background: var(--state-hover); }
button:active:not(:disabled) { color: var(--ink); background: var(--state-pressed); }
iframe { display: block; border: 0; width: 100%; background: white; }
.expanded { position: fixed; z-index: 220; inset: 24px; width: calc(100% - 48px); max-width: none; height: calc(100% - 48px); max-height: none; margin: 0; padding: 0; border: 0; display: flex; flex-direction: column; }
.expanded::backdrop { background: #0009; }
.expanded iframe { flex: 1; min-height: 0; }
@media (max-width: 640px) { .expanded { inset: 8px; width: calc(100% - 16px); height: calc(100% - 16px); } }
</style>
