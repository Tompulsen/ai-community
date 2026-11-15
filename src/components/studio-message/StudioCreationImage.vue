<!-- Adapted from octopus_chat app/components/chat-image.tsx (MIT). -->
<script lang="ts">
const dimensions = new Map<string, { width: number; height: number }>()
</script>

<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { RotateCw } from '@lucide/vue'

const props = defineProps<{ src: string; alt: string; label: string }>()
const emit = defineEmits<{ open: [] }>()
const size = ref(dimensions.get(props.src))
const loaded = ref(false), failed = ref(false), retrying = ref(false), replacement = ref('')
let revision = 0
function release() { if (replacement.value) URL.revokeObjectURL(replacement.value); replacement.value = '' }
watch(() => props.src, () => { revision++; release(); size.value = dimensions.get(props.src); loaded.value = false; failed.value = false; retrying.value = false })
onBeforeUnmount(() => { revision++; release() })
function load(event: Event) {
  const image = event.target as HTMLImageElement
  if (image.naturalWidth && image.naturalHeight) {
    size.value = { width: image.naturalWidth, height: image.naturalHeight }
    dimensions.set(props.src, size.value)
    if (dimensions.size > 200) dimensions.delete(dimensions.keys().next().value!)
  }
  loaded.value = true; failed.value = false
}
async function retry() {
  if (retrying.value) return
  const accepted = revision
  retrying.value = true
  try {
    const response = await fetch(props.src, { credentials: 'same-origin', cache: 'reload' })
    if (!response.ok) throw new Error('图片无法读取')
    const blob = await response.blob()
    if (!blob.type.startsWith('image/')) throw new Error('图片格式无效')
    if (accepted !== revision) return
    release(); replacement.value = URL.createObjectURL(blob); failed.value = false; loaded.value = false
  } catch { if (accepted === revision) failed.value = true }
  finally { if (accepted === revision) retrying.value = false }
}
</script>

<template>
  <div class="creation-image">
    <button v-if="failed" class="image-retry" type="button" :disabled="retrying" aria-label="重新加载图片" @click="retry"><RotateCw :size="18" /><span>{{ retrying ? '正在加载' : '重新加载图片' }}</span></button>
    <button v-else type="button" class="creation-image-preview" :aria-label="label" :aria-busy="!loaded" @click="loaded && emit('open')">
      <img :key="replacement || src" :src="replacement || src" :alt="alt" :width="size?.width" :height="size?.height" loading="lazy" decoding="async" @load="load" @error="failed = true" />
    </button>
  </div>
</template>

<style scoped>
.creation-image { min-width: 0; max-width: 100%; }
.creation-image-preview { position: relative; display: block; width: fit-content; max-width: 100%; padding: 0; border: 0; border-radius: 0; background: transparent; cursor: zoom-in; }
.creation-image-preview img { display: block; width: auto; height: auto; max-width: 100%; max-height: min(600px, 56dvh); object-fit: contain; }
.creation-image-preview[aria-busy="true"] img { min-width: min(240px, 100%); min-height: 160px; }
.creation-image-preview:focus-visible, .image-retry:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: 4px; }
.image-retry { display: flex; align-items: center; justify-content: center; gap: 8px; width: min(320px, 100%); min-height: 160px; padding: 16px; border: 0; border-radius: 6px; background: var(--surface-soft); color: var(--ink); font: inherit; font-size: 14px; cursor: pointer; }
.image-retry:disabled { cursor: default; opacity: .6; }
@media (min-width: 1000px) { .creation-image-preview img { max-height: min(440px, 32dvh); } }
@media (max-width: 639px) { .creation-image-preview img { max-height: 44dvh; } }
</style>
