<!-- Adapted from arsh342/careercompass, Copyright (c) 2025 arsh342, MIT.
     See public/assets/licenses/careercompass-MIT.txt. -->
<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

const props = defineProps<{ isTyping: boolean; showPassword: boolean; passwordLength: number }>()
const scene = ref<HTMLDivElement>()
const scale = ref(1)
const pointer = ref<{ x: number; y: number }>()
const motionAllowed = ref(false)
const looking = ref(false), peeking = ref(false)
const blinking = ref({ purple: false, black: false })
const characters = [
  { id: 'purple', left: 70, width: 180, height: 400, faceX: 45, faceY: 40, eyeSize: 18, pupilSize: 7, gap: 32, distance: 5 },
  { id: 'black', left: 240, width: 120, height: 310, faceX: 26, faceY: 32, eyeSize: 16, pupilSize: 6, gap: 24, distance: 4 },
  { id: 'orange', left: 0, width: 240, height: 200, faceX: 82, faceY: 90, eyeSize: 12, pupilSize: 12, gap: 32, distance: 5 },
  { id: 'yellow', left: 310, width: 140, height: 230, faceX: 52, faceY: 40, eyeSize: 12, pupilSize: 12, gap: 24, distance: 5 },
] as const
type Character = typeof characters[number]
const visiblePassword = computed(() => props.passwordLength > 0 && props.showPassword)
const leaning = computed(() => props.isTyping || props.passwordLength > 0 && !props.showPassword)
const poses = computed(() => characters.map(character => {
  const active = motionAllowed.value
  const dx = active && pointer.value ? pointer.value.x - character.left - character.width / 2 : 0
  const dy = active && pointer.value ? pointer.value.y - (440 - character.height + character.height / 3) : 0
  const faceX = Math.max(-15, Math.min(15, dx / 20))
  const faceY = Math.max(-10, Math.min(10, dy / 30))
  const skew = Math.max(-6, Math.min(6, -dx / 120))
  let x = character.faceX + faceX, y = character.faceY + faceY, tilt = skew, shift = 0
  if (active && visiblePassword.value) {
    x = character.id === 'purple' ? 20 : character.id === 'black' ? 10 : character.id === 'orange' ? 50 : 20
    y = character.id === 'purple' ? 35 : character.id === 'black' ? 28 : character.id === 'orange' ? 85 : 35
    tilt = 0
  } else if (active) {
    if (character.id === 'purple' && leaning.value) { tilt -= 12; shift = 40 }
    if (character.id === 'black' && looking.value) { tilt = skew * 1.5 + 10; shift = 20 }
    else if (character.id === 'black' && leaning.value) tilt = skew * 1.5
    if (looking.value && character.id === 'purple') { x = 55; y = 65 }
    if (looking.value && character.id === 'black') { x = 32; y = 12 }
  }
  return { character, x, y, height: active && character.id === 'purple' && leaning.value ? 440 : character.height,
    transform: active ? `skewX(${tilt}deg) translateX(${shift}px)` : 'none' }
}))
function pupil(character: Character, x: number, y: number, eye: number) {
  if (!motionAllowed.value) return 'translate(0px, 0px)'
  if (visiblePassword.value) {
    return character.id === 'purple'
      ? `translate(${peeking.value ? 4 : -4}px, ${peeking.value ? 5 : -4}px)`
      : `translate(${character.id === 'black' ? -4 : -5}px, -4px)`
  }
  if (looking.value && character.id === 'purple') return 'translate(3px, 4px)'
  if (looking.value && character.id === 'black') return 'translate(0px, -4px)'
  if (!pointer.value) return 'translate(0px, 0px)'
  const dx = pointer.value.x - character.left - x - (eye - 1) * (character.eyeSize + character.gap) - character.eyeSize / 2
  const dy = pointer.value.y - (440 - character.height + y + character.eyeSize / 2)
  const distance = Math.min(Math.hypot(dx, dy), character.distance), angle = Math.atan2(dy, dx)
  return `translate(${Math.cos(angle) * distance}px, ${Math.sin(angle) * distance}px)`
}
let preference: MediaQueryList | undefined, observer: ResizeObserver | undefined
let frame = 0
function move(event: PointerEvent) {
  if (!motionAllowed.value || event.pointerType !== 'mouse') return
  cancelAnimationFrame(frame)
  frame = requestAnimationFrame(() => {
    const bounds = scene.value?.getBoundingClientRect()
    if (bounds && motionAllowed.value) pointer.value = { x: (event.clientX - bounds.left) / scale.value, y: (event.clientY - bounds.top) / scale.value }
  })
}
function updateMotion() { motionAllowed.value = preference?.matches ?? false; pointer.value = undefined }
onMounted(() => {
  preference = matchMedia('(min-width: 1024px) and (hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)')
  updateMotion()
  preference.addEventListener('change', updateMotion)
  window.addEventListener('pointermove', move, { passive: true })
  observer = new ResizeObserver(([entry]) => { if (entry) scale.value = entry.contentRect.width / 550 })
  if (scene.value) observer.observe(scene.value)
})
onBeforeUnmount(() => {
  cancelAnimationFrame(frame)
  observer?.disconnect()
  preference?.removeEventListener('change', updateMotion)
  window.removeEventListener('pointermove', move)
})
watch(motionAllowed, (allowed, _, cleanup) => {
  const timers = new Set<ReturnType<typeof setTimeout>>()
  function later(action: () => void, delay: number) {
    const timer = setTimeout(() => { timers.delete(timer); action() }, delay)
    timers.add(timer)
  }
  function blink(id: 'purple' | 'black') {
    later(() => { blinking.value[id] = true; later(() => { blinking.value[id] = false; blink(id) }, 150) }, 3000 + Math.random() * 4000)
  }
  blinking.value = { purple: false, black: false }
  if (allowed) { blink('purple'); blink('black') }
  cleanup(() => timers.forEach(clearTimeout))
})
watch([() => props.isTyping, motionAllowed], ([typing, allowed], _, cleanup) => {
  looking.value = !!typing && !!allowed
  if (looking.value) { const timer = setTimeout(() => { looking.value = false }, 800); cleanup(() => clearTimeout(timer)) }
})
watch([visiblePassword, motionAllowed], ([visible, allowed], _, cleanup) => {
  peeking.value = false
  if (!visible || !allowed) return
  let peek: ReturnType<typeof setTimeout>, wait: ReturnType<typeof setTimeout>
  function schedule() {
    wait = setTimeout(() => {
      peeking.value = true
      peek = setTimeout(() => { peeking.value = false; schedule() }, 800)
    }, 2000 + Math.random() * 3000)
  }
  schedule()
  cleanup(() => { clearTimeout(wait); clearTimeout(peek) })
})
</script>

<template>
  <div ref="scene" class="login-characters" aria-hidden="true" :data-motion-active="motionAllowed">
    <div class="character-stage" :style="{ transform: `scale(${scale})` }">
      <div v-for="pose in poses" :key="pose.character.id" class="character" :class="pose.character.id"
        :style="{ left: `${pose.character.left}px`, width: `${pose.character.width}px`, height: `${pose.height}px`, transform: pose.transform }">
        <div class="character-face" :style="{ left: `${pose.x}px`, top: `${pose.y}px`, gap: `${pose.character.gap}px` }">
          <span v-for="eye in 2" :key="eye" class="character-eye" :class="{ blinking: (pose.character.id === 'purple' || pose.character.id === 'black') && blinking[pose.character.id] }"
            :style="{ width: `${pose.character.eyeSize}px`, height: `${pose.character.eyeSize}px` }">
            <span class="character-pupil" :style="{ width: `${pose.character.pupilSize}px`, height: `${pose.character.pupilSize}px`, transform: pupil(pose.character, pose.x, pose.y, eye) }" />
          </span>
        </div>
        <span v-if="pose.character.id === 'yellow'" class="character-mouth"
          :style="{ left: `${visiblePassword && motionAllowed ? 10 : pose.x - 12}px`, top: `${visiblePassword && motionAllowed ? 88 : pose.y + 48}px` }" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.login-characters { position: relative; width: min(550px, 100%); aspect-ratio: 550 / 440; }
.character-stage { position: absolute; left: 0; top: 0; width: 550px; height: 440px; transform-origin: top left; }
.character { position: absolute; bottom: 0; transform-origin: bottom center; transition: transform 700ms ease-in-out, height 700ms ease-in-out; }
.purple { z-index: 1; background: #6c3ff5; border-radius: 10px 10px 0 0; }
.black { z-index: 2; background: #2d2d2d; border-radius: 8px 8px 0 0; }
.orange { z-index: 3; background: #ff9b6b; border-radius: 120px 120px 0 0; }
.yellow { z-index: 4; background: #e8d754; border-radius: 70px 70px 0 0; }
.character-face { position: absolute; display: flex; transition: left 700ms ease-in-out, top 700ms ease-in-out; }
.character-eye { display: grid; place-items: center; flex: none; border-radius: 50%; background: white; overflow: hidden; transition: transform 150ms ease-out; }
.character-eye.blinking { transform: scaleY(0.12); }
.character-pupil { display: block; border-radius: 50%; background: #2d2d2d; transition: transform 100ms ease-out; }
.orange .character-eye, .yellow .character-eye { overflow: visible; background: transparent; }
.character-mouth { position: absolute; display: block; width: 80px; height: 4px; border-radius: 2px; background: #2d2d2d; transition: left 200ms ease-out, top 200ms ease-out; }
@media (prefers-reduced-motion: reduce) { .character, .character-face, .character-eye, .character-pupil, .character-mouth { transition: none; } }
</style>
