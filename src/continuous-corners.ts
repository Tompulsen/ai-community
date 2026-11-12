import type { ObjectDirective } from 'vue'
import { getSvgPath } from 'figma-squircle'

interface CornerOptions { radius: number; smoothing?: number }
interface CornerState {
  observer: ResizeObserver
  update: (value: CornerOptions) => void
  dispose: () => void
}
const states = new WeakMap<HTMLElement, CornerState>()
const svgNamespace = 'http://www.w3.org/2000/svg'

export const continuousCorners: ObjectDirective<HTMLElement, CornerOptions> = {
  mounted(element, binding) {
    const clipping = binding.arg === 'clip'
    const svg = clipping ? null : document.createElementNS(svgNamespace, 'svg')
    const path = svg ? document.createElementNS(svgNamespace, 'path') : null
    let options = binding.value
    let previous = ''
    if (svg && path) {
      svg.classList.add('continuous-outline')
      svg.setAttribute('aria-hidden', 'true')
      svg.setAttribute('focusable', 'false')
      path.setAttribute('fill', 'var(--continuous-fill, var(--surface))')
      path.setAttribute('stroke', 'var(--continuous-stroke, var(--border))')
      path.setAttribute('stroke-width', '1')
      path.setAttribute('transform', 'translate(.5 .5)')
      svg.append(path)
      element.prepend(svg)
      element.classList.add('continuous-surface')
    }
    function render() {
      const width = element.offsetWidth, height = element.offsetHeight
      if (!width || !height) return
      const radius = Math.max(0, Math.min(options.radius, width / 2, height / 2))
      const smoothing = options.smoothing ?? 0.6
      const key = `${width}:${height}:${radius}:${smoothing}`
      if (key === previous) return
      previous = key
      element.dataset.cornerRadius = String(radius)
      element.dataset.cornerSmoothing = String(smoothing)
      if (clipping) {
        element.style.clipPath = `path('${getSvgPath({ width, height, cornerRadius: radius, cornerSmoothing: smoothing })}')`
      } else if (svg && path) {
        svg.setAttribute('viewBox', `0 0 ${width} ${height}`)
        path.setAttribute('d', getSvgPath({ width: width - 1, height: height - 1, cornerRadius: Math.max(0, radius - 0.5), cornerSmoothing: smoothing }))
      }
    }
    const observer = new ResizeObserver(render)
    observer.observe(element)
    render()
    states.set(element, {
      observer,
      update(value) { options = value; render() },
      dispose() { observer.disconnect(); svg?.remove(); element.classList.remove('continuous-surface'); if (clipping) element.style.removeProperty('clip-path') },
    })
  },
  updated(element, binding) { states.get(element)?.update(binding.value) },
  beforeUnmount(element) { states.get(element)?.dispose(); states.delete(element) },
}
