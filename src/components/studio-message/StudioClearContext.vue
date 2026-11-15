<!-- Inline context marker adapted from octopus_chat ClearContextDivider (MIT). -->
<script setup lang="ts">
defineProps<{ disabled?: boolean }>()
defineEmits<{ restore: [] }>()
</script>

<template>
  <button type="button" class="clear-context-divider" aria-label="恢复上下文" title="恢复上下文" :disabled="disabled" @click="$emit('restore')">
    <span class="clear-context-label" role="status">上下文已清除</span>
    <span class="clear-context-restore" aria-hidden="true">恢复上下文</span>
  </button>
</template>

<style scoped>
.clear-context-divider { position: relative; display: grid; place-items: center; width: 100%; min-height: 32px; padding: 4px 0; margin: 20px 0 0; border: 0; border-radius: 0; background: transparent; color: var(--muted); font-size: 12px; line-height: 20px; cursor: pointer; }
.clear-context-divider span { grid-area: 1 / 1; transition: opacity 150ms var(--ease); }
.clear-context-restore { opacity: 0; color: var(--ink); }
.clear-context-divider:is(:hover, :focus-visible):not(:disabled) .clear-context-label { opacity: 0; }
.clear-context-divider:is(:hover, :focus-visible):not(:disabled) .clear-context-restore { opacity: 1; }
.clear-context-divider:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: -2px; }
.clear-context-divider:disabled { cursor: default; opacity: .55; }
@media (pointer: coarse) { .clear-context-divider { min-height: 44px; }.clear-context-divider span { grid-area: auto; }.clear-context-divider { display: flex; justify-content: center; gap: 12px; }.clear-context-restore { opacity: 1; }.clear-context-divider:is(:hover, :focus-visible):not(:disabled) .clear-context-label { opacity: 1; } }
@media (prefers-reduced-motion: reduce) { .clear-context-divider span { transition: none; } }
</style>
