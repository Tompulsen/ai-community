<script setup lang="ts">
import BentoGrid from './BentoGrid.vue'

withDefaults(defineProps<{ label: string; layout?: 'works' | 'creators' | 'rows' | 'form' }>(), { layout: 'rows' })
</script>

<template>
  <component :is="layout === 'works' ? BentoGrid : 'div'" class="content-loading" :class="`loading-${layout}`" role="status" :aria-label="label">
    <div v-for="n in layout === 'works' ? 10 : layout === 'creators' ? 4 : 3" :key="n" v-continuous="{ radius: 8 }" class="loading-item" aria-hidden="true">
      <div v-if="layout === 'works'" class="skeleton loading-cover" />
      <div v-else-if="layout === 'creators'" v-continuous:clip="{ radius: 20 }" class="skeleton loading-cover" />
      <div v-if="layout === 'works'" class="loading-work-info"><div class="skeleton loading-line" /><div class="skeleton loading-line loading-line-short" /></div>
      <template v-else><div class="skeleton loading-line" /><div class="skeleton loading-line loading-line-short" /></template>
    </div>
  </component>
</template>

<style scoped>
.loading-works > .loading-item { display: flex; flex-direction: column; gap: 0; min-width: 0; min-height: 0; padding: 0; border: 0; background: transparent; }
.loading-works .loading-cover { position: relative; width: 100%; height: auto; min-height: 0; aspect-ratio: 4 / 5; border-radius: 8px; }
.loading-work-info { display: flex; flex-direction: column; justify-content: center; gap: 8px; height: 56px; min-width: 0; padding: 8px 4px 0; }
.loading-work-info .loading-line { flex: none; }
@media (max-width: 639px) {
  .loading-work-info { height: 80px; }
}
</style>
