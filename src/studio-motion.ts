import { onBeforeUnmount, onMounted, ref } from 'vue'

// Same preference contract as octopus_chat/app/utils/motion.ts.
export function useReducedMotion() {
  const reduced = ref(window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  let cleanup = () => {}
  onMounted(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => {
      reduced.value = document.body.dataset.motion === 'reduced' || document.body.classList.contains('reduce-motion') || media.matches
    }
    const observer = new MutationObserver(update)
    observer.observe(document.body, { attributes: true, attributeFilter: ['class', 'data-motion'] })
    media.addEventListener('change', update)
    update()
    cleanup = () => { observer.disconnect(); media.removeEventListener('change', update) }
  })
  onBeforeUnmount(() => cleanup())
  return reduced
}
