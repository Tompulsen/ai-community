<script setup lang="ts">
import { onBeforeUnmount, onMounted, onUpdated, ref } from 'vue'

const grid = ref<HTMLElement>()
const observed = new Set<Element>()
let observer: ResizeObserver | undefined

function syncCards() {
  const children = new Set(Array.from(grid.value?.children ?? []))
  for (const element of observed) {
    if (!children.has(element)) { observer?.unobserve(element); observed.delete(element) }
  }
  for (const element of children) {
    if (!observed.has(element)) { observer?.observe(element); observed.add(element) }
  }
}

onMounted(() => {
  observer = new ResizeObserver(entries => {
    for (const entry of entries) {
      // One-pixel rows pack natural card heights without changing feed or keyboard order.
      const height = entry.borderBoxSize[0]?.blockSize ?? entry.target.getBoundingClientRect().height
      const card = entry.target as HTMLElement
      card.style.gridRowEnd = `span ${Math.ceil(height + 24)}`
    }
  })
  syncCards()
})
onUpdated(syncCards)
onBeforeUnmount(() => observer?.disconnect())
</script>

<template>
  <div ref="grid" class="works-grid bento-grid"><slot /></div>
</template>

<style scoped>
.bento-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); grid-auto-rows: 1px; grid-auto-flow: row; align-items: start; gap: 0 16px; width: 100%; min-width: 0; margin-inline: auto; }
.bento-grid.works-grid > :deep(*) { min-width: 0; min-height: 0; height: auto; }
@media (max-width: 639px) {
  .bento-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
</style>
