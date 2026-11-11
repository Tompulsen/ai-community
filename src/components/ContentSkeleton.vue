<script setup lang="ts">
withDefaults(defineProps<{ label: string; layout?: 'works' | 'creators' | 'rows' | 'form' }>(), { layout: 'rows' })
</script>

<template>
  <div class="content-loading" :class="`loading-${layout}`" role="status" :aria-label="label">
    <div v-for="n in layout === 'works' ? 10 : layout === 'creators' ? 4 : 3" :key="n" class="loading-item" aria-hidden="true">
      <div v-if="layout === 'works' || layout === 'creators'" class="skeleton loading-cover" />
      <div class="skeleton loading-line" />
      <div class="skeleton loading-line loading-line-short" />
    </div>
  </div>
</template>
