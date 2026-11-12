<!-- Layout adapted from the user-provided Aceternity UI Bento Grid example. -->
<script lang="ts">
import { cloneVNode, defineComponent, Fragment, h, onBeforeUnmount, onMounted, reactive, ref, type VNode } from 'vue'

function columnCount() {
  return window.innerWidth >= 1200 ? 5 : window.innerWidth >= 1000 ? 4 : window.innerWidth >= 640 ? 2 : 1
}

function flatten(children: VNode[]): VNode[] {
  return children.flatMap(child => child.type === Fragment && Array.isArray(child.children) ? flatten(child.children as VNode[]) : [child])
}

export default defineComponent({
  setup(_, { slots }) {
    const columns = ref(columnCount())
    const ratios = reactive(new Map<string, number>())
    const resize = () => { columns.value = columnCount() }
    onMounted(() => window.addEventListener('resize', resize, { passive: true }))
    onBeforeUnmount(() => window.removeEventListener('resize', resize))
    return () => {
      let filled = 0
      return h('div', { class: 'works-grid bento-grid' }, flatten(slots.default?.() ?? []).map((child, index) => {
        const work = child.props?.work
        const key = work?.cover || work?.video || work?.id
        const ratio = ratios.get(key) ?? work?.coverAspectRatio
        const known = typeof ratio === 'number' && Number.isFinite(ratio) && ratio > 0
        const fallback = (!work || work.kind === 'resource') && (columns.value === 5 ? index % 8 === 5 || index % 8 === 7 : index % 3 === 2)
        // Keep feed order and use the last column instead of leaving a hole.
        const span = columns.value >= 4 && (known ? ratio > 1 : fallback) && filled < columns.value - 1 ? 2 : 1
        filled = (filled + span) % columns.value
        return cloneVNode(child, {
          style: { gridColumn: `span ${span}` },
          ...(work ? { onCoverRatio: (value: number) => { if (Number.isFinite(value) && value > 0) ratios.set(key, value) } } : {}),
        })
      }))
    }
  },
})
</script>

<style scoped>
.bento-grid { --bento-columns: 5; container-type: inline-size; display: grid; grid-template-columns: repeat(var(--bento-columns), minmax(0, 1fr)); grid-auto-rows: auto; grid-auto-flow: row; gap: 16px; width: 100%; min-width: 0; margin-inline: auto; }
.bento-grid.works-grid > :deep(*) { min-width: 0; min-height: 0; height: calc((100cqw - (var(--bento-columns) - 1) * 16px) / var(--bento-columns) * 5 / 4); grid-column: auto; }
@media (min-width: 1000px) and (max-width: 1199px) {
  .bento-grid { --bento-columns: 4; }
}
@media (min-width: 640px) and (max-width: 999px) {
  .bento-grid { --bento-columns: 2; }
}
@media (max-width: 639px) {
  .bento-grid { --bento-columns: 1; }
}
</style>
