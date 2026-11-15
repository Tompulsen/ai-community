<!-- Vue adaptation of octopus_chat CollapsibleContent (MIT). -->
<script setup lang="ts">
import { ref, watch } from 'vue'
const props = defineProps<{ open: boolean; trigger?: HTMLElement }>()
const viewport = ref<HTMLElement>()
watch(() => props.open, open => {
  if (!open && viewport.value?.contains(document.activeElement)) props.trigger?.focus({ preventScroll: true })
}, { flush: 'sync' })
</script>

<template>
  <div ref="viewport" class="studio-collapse" :data-open="open" :aria-hidden="!open" :inert="!open">
    <div class="collapse-clip"><slot /></div>
  </div>
</template>

<style scoped>
.studio-collapse { display: grid; min-width: 0; grid-template-rows: 0fr; visibility: hidden; overflow-anchor: none; transition: grid-template-rows 220ms cubic-bezier(.22, 1, .36, 1), visibility 0s 220ms; }
.studio-collapse[data-open="true"] { grid-template-rows: 1fr; visibility: visible; transition-delay: 0s; }
.collapse-clip { min-height: 0; min-width: 0; overflow: hidden; }
@media (prefers-reduced-motion: reduce) { .studio-collapse { transition: none; } }
:global(.reduce-motion) .studio-collapse, :global([data-motion="reduced"]) .studio-collapse { transition: none; }
</style>
