export function supportsNativePopover() {
  return typeof HTMLElement !== 'undefined' && typeof HTMLElement.prototype.showPopover === 'function'
    && typeof HTMLElement.prototype.hidePopover === 'function'
}

interface FallbackPopover { panel: HTMLElement; trigger: HTMLElement; close: (restoreFocus?: boolean) => void }
const opened: FallbackPopover[] = []

function contains(panel: HTMLElement, target: Node | null): boolean {
  // Nested panels share a portal so their parents cannot clip them.
  for (let node = target; node;) {
    if (panel.contains(node)) return true
    node = opened.find(item => item.panel.contains(node))?.trigger || null
  }
  return false
}
function dismissOutside(event: Event) {
  if (!(event.target instanceof Node)) return
  for (const item of [...opened].reverse()) {
    if (!item.trigger.contains(event.target) && !contains(item.panel, event.target)) item.close(false)
  }
}
function keys(event: KeyboardEvent) {
  const item = opened.at(-1)
  if (!item || event.isComposing) return
  if (event.key === 'Escape') {
    event.preventDefault(); event.stopImmediatePropagation(); item.close(); return
  }
  if (event.key !== 'Tab') return
  const controls = [...item.panel.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, summary, [tabindex]')]
    .filter(control => control.tabIndex >= 0 && !control.matches(':disabled') && control.getClientRects().length)
  const boundary = event.shiftKey ? controls[0] : controls.at(-1)
  if (document.activeElement === boundary) {
    if (event.shiftKey) event.preventDefault()
    item.close()
  }
}
export function removeFallbackPopover(panel: HTMLElement) {
  for (const item of [...opened].reverse()) {
    if (item.panel !== panel && contains(panel, item.trigger)) item.close(false)
  }
  const index = opened.findIndex(item => item.panel === panel)
  if (index >= 0) opened.splice(index, 1)
  if (!opened.length) {
    document.removeEventListener('pointerdown', dismissOutside, true)
    document.removeEventListener('focusin', dismissOutside, true)
    document.removeEventListener('keydown', keys, true)
  }
}
export function addFallbackPopover(item: FallbackPopover) {
  removeFallbackPopover(item.panel)
  for (const current of [...opened].reverse()) {
    if (!contains(current.panel, item.trigger)) current.close(false)
  }
  opened.push(item)
  item.panel.style.zIndex = String(100 + opened.length)
  document.addEventListener('pointerdown', dismissOutside, true)
  document.addEventListener('focusin', dismissOutside, true)
  document.addEventListener('keydown', keys, true)
}
