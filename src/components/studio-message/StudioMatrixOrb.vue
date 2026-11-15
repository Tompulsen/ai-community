<!-- Canvas geometry adapted from octopus_chat/app/components/matrix-orb.tsx (MIT). -->
<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useReducedMotion } from '../../studio-motion'
const canvas = ref<HTMLCanvasElement>(), reduced = useReducedMotion()
let refresh = () => {}
onMounted(() => {
  const element = canvas.value!, context = element.getContext('2d')
  if (!context) return
  const size = 32, ratio = Math.min(devicePixelRatio || 1, 4)
  element.width = element.height = Math.round(size * ratio)
  context.scale(ratio, ratio)
  let frame = 0, visible = true, time = 0, last = 0
  const orbiters = [{ radius: .62, speed: 2.2, phase: 0, spread: .42 }, { radius: .4, speed: -1.7, phase: 2.1, spread: .36 }, { radius: .8, speed: 1.15, phase: 4, spread: .34 }]
  function draw() {
    context!.clearRect(0, 0, size, size)
    context!.fillStyle = getComputedStyle(element).color
    const amplitude = .22 + .78 * (.45 + .55 * (.5 + .5 * Math.sin(time * .62 + .4))) * (.5 + .5 * Math.sin(time * 1.9 + 1.1))
    for (let y = 0; y < 9; y++) for (let x = 0; x < 9; x++) {
      const nx = (x - 4) / 4, ny = (y - 4) / 4, distance = Math.hypot(nx, ny)
      if (distance > 1.12) continue
      let heat = 0
      for (const orb of orbiters) {
        const angle = time * orb.speed + orb.phase
        heat += Math.exp(-((nx - Math.cos(angle) * orb.radius) ** 2 + (ny - Math.sin(angle) * orb.radius) ** 2) / orb.spread ** 2)
      }
      const intensity = Math.min(1, (.26 + .8 * Math.min(1, heat)) * (.7 + amplitude * .5))
      const radius = size * .74 / 8 * .6 * Math.exp(-(distance ** 2) * 1.7) * intensity * .92
      if (radius * ratio < .5) continue
      context!.beginPath(); context!.arc(16 + (x - 4) * size * .74 / 8 * .92, 16 + (y - 4) * size * .74 / 8 * .92, radius, 0, Math.PI * 2); context!.fill()
    }
  }
  function animate(now: number) {
    frame = 0
    if (now - last >= 32) { time += Math.min((now - last) / 1000, .05); last = now; draw() }
    frame = requestAnimationFrame(animate)
  }
  refresh = () => {
    cancelAnimationFrame(frame); frame = 0
    const active = !document.hidden && visible && !reduced.value
    element.dataset.animated = String(active)
    draw()
    if (active) { last = performance.now(); frame = requestAnimationFrame(animate) }
  }
  const intersection = new IntersectionObserver(entries => { visible = entries[0]?.isIntersecting ?? false; refresh() })
  intersection.observe(element)
  const theme = new MutationObserver(refresh)
  theme.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style', 'data-theme'] })
  document.addEventListener('community-appearance-change', refresh)
  document.addEventListener('visibilitychange', refresh)
  refresh()
  onBeforeUnmountCleanup = () => {
    cancelAnimationFrame(frame); intersection.disconnect(); theme.disconnect()
    document.removeEventListener('visibilitychange', refresh); document.removeEventListener('community-appearance-change', refresh)
  }
})
let onBeforeUnmountCleanup = () => {}
watch(reduced, () => refresh())
onBeforeUnmount(() => onBeforeUnmountCleanup())
</script>

<template><canvas ref="canvas" class="matrix-orb" data-slot="matrix-orb" aria-hidden="true" /></template>
<style scoped>
.matrix-orb { display: block; flex: none; width: 32px; height: 32px; color: var(--ink); }
</style>
