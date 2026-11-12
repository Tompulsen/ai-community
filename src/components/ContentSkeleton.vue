<script setup lang="ts">
import { computed } from 'vue'
import BentoGrid from './BentoGrid.vue'

const props = withDefaults(defineProps<{ label: string; layout?: 'works' | 'creators' | 'rows' | 'form' }>(), { layout: 'rows' })
const cornerMode = computed(() => props.layout === 'works' ? 'clip' : undefined)
</script>

<template>
  <component :is="layout === 'works' ? BentoGrid : 'div'" class="content-loading" :class="`loading-${layout}`" role="status" :aria-label="label">
    <div v-for="n in layout === 'works' ? 10 : layout === 'creators' ? 4 : 3" :key="n" v-continuous:[cornerMode]="{ radius: layout === 'works' ? 32 : 8 }" class="loading-item" aria-hidden="true">
      <div v-if="layout === 'works'" class="skeleton loading-cover" />
      <div v-else-if="layout === 'creators'" v-continuous:clip="{ radius: 20 }" class="skeleton loading-cover" />
      <div v-if="layout === 'works'" class="loading-work-info"><div class="skeleton loading-line" /><div class="skeleton loading-line loading-line-short" /></div>
      <template v-else><div class="skeleton loading-line" /><div class="skeleton loading-line loading-line-short" /></template>
    </div>
  </component>
</template>

<style scoped>
.loading-works > .loading-item { position: relative; display: flex; flex-direction: column; justify-content: flex-end; min-width: 0; min-height: 0; padding: 0; border: 0; border-radius: var(--card-radius); background: var(--surface); }
.loading-works .loading-cover { position: absolute; inset: 0; width: 100%; height: 100%; min-height: 0; aspect-ratio: auto; border-radius: 0; }
.loading-work-info { position: relative; display: flex; flex: 0 0 auto; flex-direction: column; justify-content: center; gap: 12px; height: 86px; min-width: 0; padding: 16px; background: #0009; }
.loading-work-info .loading-line { flex: none; }
@media (max-width: 639px) { .loading-work-info { height: 120px; } }
</style>
