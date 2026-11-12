<!-- Layout adapted from the user-provided Aceternity UI Bento Grid example. -->
<template>
  <div class="works-grid bento-grid"><slot /></div>
</template>

<style scoped>
.bento-grid { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); grid-auto-rows: max(20rem, 320px); grid-auto-flow: row; gap: 16px; width: 100%; min-width: 0; margin-inline: auto; }
.bento-grid > :deep(*) { min-width: 0; min-height: 0; grid-column: auto; }
@media (min-width: 1200px) {
  .bento-grid > :deep(:nth-child(8n + 6)), .bento-grid > :deep(:nth-child(8n)) { grid-column: span 2; }
  .bento-grid > :deep(.work-card:nth-child(8n + 6) .work-cover > img),
  .bento-grid > :deep(.work-card:nth-child(8n) .work-cover > img),
  .bento-grid > :deep(.work-card:nth-child(8n + 6) .work-cover > video),
  .bento-grid > :deep(.work-card:nth-child(8n) .work-cover > video) { object-fit: contain; object-position: center; }
}
@media (min-width: 1000px) and (max-width: 1199px) {
  .bento-grid { grid-template-columns: repeat(4, minmax(0, 1fr)); }
  .bento-grid > :deep(:nth-child(3n)) { grid-column: span 2; }
  .bento-grid > :deep(.work-card:nth-child(3n) .work-cover > img),
  .bento-grid > :deep(.work-card:nth-child(3n) .work-cover > video) { object-fit: contain; object-position: center; }
}
@media (min-width: 640px) and (max-width: 999px) {
  .bento-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 639px) {
  .bento-grid { grid-template-columns: minmax(0, 1fr); }
}
</style>
