<!-- Vue adaptation of Manu Arora's Aceternity UI Gooey Input.
     Source: https://ui.aceternity.com/registry/gooey-input.json -->
<script setup lang="ts">
import { nextTick, ref, useId, watch } from 'vue'
import { Search, X } from '@lucide/vue'

withDefaults(defineProps<{ placeholder?: string }>(), { placeholder: '搜索作品、提示词或创作者' })
const model = defineModel<string>({ default: '' })
const filterId = `gooey-filter-${useId()}`
const inputId = `gooey-input-${useId()}`
const root = ref<HTMLElement>()
const input = ref<HTMLInputElement>()
const trigger = ref<HTMLButtonElement>()
const expanded = ref(!!model.value)

watch(model, value => {
  if (value) expanded.value = true
  else if (!root.value?.contains(document.activeElement)) expanded.value = false
})
async function expand() {
  expanded.value = true
  await nextTick()
  input.value?.focus()
}
function blur(event: FocusEvent) {
  if (!model.value && !root.value?.contains(event.relatedTarget as Node | null)) expanded.value = false
}
async function escape(event: KeyboardEvent) {
  if (model.value) return
  event.preventDefault()
  event.stopPropagation()
  expanded.value = false
  await nextTick()
  trigger.value?.focus()
}
function clear() {
  input.value?.focus()
  model.value = ''
}
</script>

<template>
  <div ref="root" class="gooey-input" :class="{ expanded }" @focusout="blur" @keydown.esc="escape">
    <svg class="gooey-definitions" width="0" height="0" aria-hidden="true">
      <defs>
        <filter :id="filterId" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur in="SourceGraphic" stdDeviation="5" result="blur" />
          <feColorMatrix in="blur" type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 20 -10" result="goo" />
          <feComposite in="SourceGraphic" in2="goo" operator="atop" />
        </filter>
      </defs>
    </svg>
    <div class="gooey-surfaces" :style="{ filter: `url(#${filterId})` }" aria-hidden="true">
      <div class="gooey-field-surface" />
      <div class="gooey-bubble" />
    </div>
    <Search class="gooey-search-icon" :size="16" aria-hidden="true" />
    <button v-show="!expanded" ref="trigger" type="button" class="gooey-trigger" aria-label="展开搜索" title="展开搜索" :aria-controls="inputId" :aria-expanded="expanded" @click="expand">搜索作品</button>
    <div class="gooey-field">
      <input :id="inputId" ref="input" v-model="model" type="search" aria-label="搜索作品" :placeholder="placeholder" :disabled="!expanded" enterkeyhint="search" autocomplete="off" />
      <button v-if="model" type="button" class="gooey-clear" aria-label="清除搜索" title="清除搜索" @click="clear"><X :size="16" /></button>
    </div>
  </div>
</template>

<style scoped>
.gooey-input { position: relative; display: block; flex: 1; width: 100%; min-width: 0; height: 44px; min-height: 44px; padding: 0; border: 0; border-radius: 22px; background: transparent; color: var(--canvas); isolation: isolate; }
.gooey-input:hover, .gooey-input:focus-within { background: transparent; border-color: transparent; }
.gooey-input:focus-within { outline: none; }
.gooey-definitions { position: absolute; pointer-events: none; }
.gooey-surfaces { position: absolute; inset: 0; pointer-events: none; }
.gooey-field-surface, .gooey-bubble { position: absolute; height: 44px; background: var(--ink); border-radius: 22px; }
.gooey-field-surface { left: calc(100% - var(--gooey-collapsed-width, 128px)); width: var(--gooey-collapsed-width, 128px); transition: left 400ms cubic-bezier(.22, 1.3, .36, 1), width 400ms cubic-bezier(.22, 1.3, .36, 1); }
.gooey-bubble { left: calc(100% - var(--gooey-collapsed-width, 128px)); width: 44px; opacity: 0; transform: scale(0); transition: left 400ms cubic-bezier(.22, 1.3, .36, 1), opacity 300ms var(--ease), transform 400ms cubic-bezier(.22, 1.3, .36, 1); }
.expanded .gooey-field-surface { left: 52px; width: calc(100% - 52px); }
.expanded .gooey-bubble { left: 0; opacity: 1; transform: scale(1); }
.gooey-search-icon { position: absolute; left: calc(100% - var(--gooey-collapsed-width, 128px) + 16px); top: 14px; pointer-events: none; transition: left 400ms cubic-bezier(.22, 1.3, .36, 1); }
.expanded .gooey-search-icon { left: 14px; }
.gooey-trigger { position: absolute; left: calc(100% - var(--gooey-collapsed-width, 128px)); width: var(--gooey-collapsed-width, 128px); height: 44px; padding: 0 12px 0 36px; border-radius: 22px; color: var(--canvas); font-size: 14px; font-weight: 500; white-space: nowrap; text-align: left; }
.gooey-field { position: absolute; left: 52px; width: calc(100% - 52px); height: 44px; display: flex; align-items: center; border-radius: 22px; visibility: hidden; opacity: 0; }
.expanded .gooey-field { visibility: visible; opacity: 1; transition: opacity 160ms var(--ease) 120ms; }
.gooey-field input { width: 100%; min-width: 0; height: 44px; min-height: 44px; padding: 0 12px; border: 0; outline: none; box-shadow: none; background: transparent; color: var(--canvas); font-size: 14px; border-radius: 22px; }
.gooey-field input::placeholder { color: var(--p-inv-muted); opacity: 1; }
.gooey-field input::-webkit-search-cancel-button { appearance: none; }
.gooey-clear { display: grid; place-items: center; flex: none; width: 44px; height: 44px; padding: 0; border-radius: 50%; color: var(--canvas); }
.gooey-clear:hover { background: #00000014; }
.gooey-clear:focus-visible { outline-offset: -4px; outline-color: var(--canvas); }
@media (prefers-reduced-motion: reduce) {
  .gooey-surfaces { filter: none !important; }
  .gooey-field-surface, .gooey-bubble, .gooey-search-icon, .gooey-field { transition: none; }
}
</style>
