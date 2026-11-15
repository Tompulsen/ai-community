<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { Images, X } from '@lucide/vue'
import { session } from '../state'
import type { CreationTask, CreationDestination } from '../native-studio'
import StudioGallery from './StudioGallery.vue'

defineProps<{ trigger?: boolean }>()
const emit = defineEmits<{ reuse: [task: CreationTask]; publish: [task: CreationTask, destination: CreationDestination]; create: [] }>()
const dialog = ref<HTMLDialogElement>(), gallery = ref<InstanceType<typeof StudioGallery>>(), loaded = ref(false)
const opened = ref(false)
async function open() {
  const owner = session.user?.id
  if (!owner) return
  loaded.value = true
  await nextTick()
  if (owner !== session.user?.id || dialog.value?.open) return
  dialog.value?.showModal(); opened.value = true
}
function closed() {
  if (dialog.value?.open) return
  gallery.value?.cancelOperation(); opened.value = false
}
function close() { dialog.value?.close(); closed() }
watch(() => session.user?.id, () => { close(); loaded.value = false })
onBeforeUnmount(() => { close() })
defineExpose({ open, close })
</script>

<template>
  <button v-if="trigger" type="button" class="studio-tool library-trigger" aria-label="作品库" aria-haspopup="dialog" :aria-expanded="opened" @click="open"><Images :size="20" /><span>作品库</span></button>
  <Teleport to="body"><dialog ref="dialog" class="studio-library-dialog" aria-label="作品库" @cancel.prevent="close" @close="closed" @click.self="close"><div class="library-dialog-body"><header class="library-heading"><h2><Images :size="20" />作品库</h2><button type="button" class="icon-button" aria-label="关闭作品库" title="关闭作品库" @click="close"><X :size="20" /></button></header><StudioGallery v-if="loaded" ref="gallery" embedded @reuse="emit('reuse', $event)" @publish="(task, destination) => emit('publish', task, destination)" @create="emit('create')" /></div></dialog></Teleport>
</template>

<style scoped>
.studio-library-dialog { position: fixed; inset: 0; width: min(1400px, calc(100vw - 48px)); max-width: none; height: min(1000px, calc(100dvh - 48px)); max-height: none; padding: 0; border: 0; border-radius: 8px; background: var(--canvas); color: var(--ink); overflow: hidden; }
.studio-library-dialog::backdrop { background: rgb(0 0 0 / 55%); }
:global(body:has(.studio-library-dialog[open])) { overflow: hidden; }
.library-dialog-body { display: flex; flex-direction: column; height: 100%; min-height: 0; }
.library-heading { display: flex; align-items: center; justify-content: space-between; gap: 16px; flex: none; padding: 16px 24px; }
.library-heading h2 { display: flex; align-items: center; gap: 8px; margin: 0; font-size: 16px; line-height: 24px; font-weight: 500; }
.library-heading .icon-button { width: 36px; min-height: 36px; }
.library-dialog-body > :deep(.studio-gallery) { flex: 1; height: auto; }
@media (max-width: 600px) { .studio-library-dialog { width: 100vw; height: 100dvh; margin: 0; border-radius: 0; }.library-heading { padding: max(12px, env(safe-area-inset-top)) 16px 12px; }.library-heading .icon-button { width: 44px; min-height: 44px; } }
</style>
