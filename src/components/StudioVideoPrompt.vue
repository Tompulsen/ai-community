<!-- Reference menu adapted from octopus_chat video-prompt-input.tsx (MIT). -->
<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, useId, watch } from 'vue'
import { createImeGuard } from '../../shared/studio/ime-input'
import { insertVideoMention, videoMentionQuery } from '../../shared/studio/video-mentions'
import { mediaSource } from '../native-studio'
import { studioPreferences } from '../studio-preferences'
import { shouldSubmit } from '../../shared/studio/submit-key'

const props = defineProps<{ modelValue: string; references: { name: string; url: string }[]; disabled?: boolean; label?: string }>()
const emit = defineEmits<{ 'update:modelValue': [value: string]; submit: []; paste: [event: ClipboardEvent] }>()
const input = ref<HTMLTextAreaElement>(), panel = ref<HTMLElement>(), cursor = ref(0), selected = ref(0), dismissed = ref(false)
const id = `video-references-${useId()}`, ime = createImeGuard()
const query = computed(() => dismissed.value ? undefined : videoMentionQuery(props.modelValue, cursor.value))
const choices = computed(() => query.value ? props.references.map((file, index) => ({ ...file, number: index + 1 })).filter(file => String(file.number).startsWith(query.value!.number || '')) : [])
const opened = computed(() => choices.value.length > 0)
function position() {
  if (!panel.value || !input.value) return
  const rect = input.value.getBoundingClientRect(), viewport = window.visualViewport
  const left = viewport?.offsetLeft || 0, top = viewport?.offsetTop || 0
  const width = viewport?.width || innerWidth, height = viewport?.height || innerHeight
  const available = Math.max(rect.top - top - 16, top + height - rect.bottom - 16)
  panel.value.style.width = `${Math.min(320, width - 24)}px`
  panel.value.style.maxHeight = `${Math.min(240, available)}px`
  panel.value.style.left = `${Math.max(left + 12, Math.min(rect.left, left + width - panel.value.offsetWidth - 12))}px`
  const above = rect.top - top > top + height - rect.bottom
  panel.value.style.top = `${above ? Math.max(top + 8, rect.top - panel.value.offsetHeight - 8) : rect.bottom + 8}px`
}
function updateCursor() {
  cursor.value = input.value?.selectionStart || 0; dismissed.value = false; selected.value = 0
}
async function choose(number: number) {
  if (!query.value) return
  const result = insertVideoMention(props.modelValue, query.value, number)
  emit('update:modelValue', result.prompt); dismissed.value = true
  await nextTick(); input.value?.focus(); input.value?.setSelectionRange(result.cursor, result.cursor); cursor.value = result.cursor
}
function handleInput(event: Event) { emit('update:modelValue', (event.target as HTMLTextAreaElement).value); updateCursor() }
function keydown(event: KeyboardEvent) {
  if (ime.blocks(event)) { if (event.key === 'Enter' && !ime.isComposing(event)) event.preventDefault(); return }
  if (opened.value && !event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey && ['ArrowDown', 'ArrowUp', 'Enter', 'Tab', 'Escape'].includes(event.key)) {
    event.preventDefault()
    if (event.key === 'Escape') dismissed.value = true
    else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') selected.value = (selected.value + (event.key === 'ArrowDown' ? 1 : -1) + choices.value.length) % choices.value.length
    else void choose(choices.value[selected.value]?.number || choices.value[0]!.number)
    return
  }
  if (shouldSubmit(event, studioPreferences.submitKey, window.matchMedia('(hover: hover) and (pointer: fine)').matches)) { event.preventDefault(); emit('submit') }
}
watch([opened, choices], async () => { selected.value = Math.max(0, Math.min(selected.value, choices.value.length - 1)); await nextTick(); position() }, { flush: 'post' })
watch(selected, () => { panel.value?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' }) })
window.addEventListener('resize', position)
window.addEventListener('scroll', position, true)
window.visualViewport?.addEventListener('resize', position)
onBeforeUnmount(() => { window.removeEventListener('resize', position); window.removeEventListener('scroll', position, true); window.visualViewport?.removeEventListener('resize', position) })
defineExpose({ focus: () => input.value?.focus() })
</script>

<template>
  <textarea ref="input" :value="modelValue" :disabled="disabled" class="composer-input creation-prompt" :aria-label="label || '提示词'" rows="1" maxlength="100000" placeholder="描述你想生成的视频…" required
    aria-autocomplete="list" aria-haspopup="listbox" :aria-controls="opened ? id : undefined" :aria-activedescendant="opened ? `${id}-${choices[selected]?.number}` : undefined"
    @input="handleInput" @click="updateCursor" @select="updateCursor" @keydown="keydown" @keyup="ime.release" @compositionstart="ime.start" @compositionend="ime.end" @paste="emit('paste', $event)" @blur="dismissed = true" />
  <Teleport to="body">
    <div v-if="opened" :id="id" ref="panel" class="video-reference-menu" role="listbox" aria-label="选择参考图">
      <button v-for="(file, index) in choices" :id="`${id}-${file.number}`" :key="`${file.url}:${file.number}`" type="button" role="option" :aria-selected="index === selected"
        @pointerdown.prevent="choose(file.number)" @mouseenter="selected = index"><img :src="mediaSource(file.url, true)" alt="" /><span>图片{{ file.number }}</span><small>{{ file.name }}</small></button>
    </div>
  </Teleport>
</template>

<style scoped>
.video-reference-menu { position: fixed; z-index: 1200; overflow-y: auto; padding: 6px; border-radius: 8px; background: var(--popover-surface); color: var(--ink); box-shadow: var(--popover-shadow); }
.video-reference-menu button { width: 100%; min-height: 44px; display: flex; align-items: center; gap: 10px; border: 0; border-radius: 6px; padding: 6px 8px; background: transparent; color: inherit; text-align: left; cursor: pointer; font: inherit; }
.video-reference-menu button:hover:not(:disabled) { color: var(--ink); background: var(--state-hover); }
.video-reference-menu button[aria-selected="true"] { color: var(--ink); background: var(--state-selected); }
.video-reference-menu button[aria-selected="true"]:hover:not(:disabled) { background: var(--state-pressed); }
.video-reference-menu img { flex: 0 0 32px; width: 32px; height: 32px; object-fit: cover; border-radius: 4px; }
.video-reference-menu small { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--muted); }
.video-reference-menu button:is(:hover:not(:disabled), [aria-selected="true"]) small { color: var(--ink); }
.video-reference-menu span { flex-shrink: 0; }
</style>
