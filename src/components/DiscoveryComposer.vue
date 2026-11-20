<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ArrowUp, Image, LoaderCircle, Plus, Video } from '@lucide/vue'
import { errorMessage, session } from '../state'
import { clearStudioEntry, saveStudioEntry } from '../studio-entry'
import { useStudioMaterials, type StudioFile } from '../use-studio-materials'
import { createImeGuard } from '../../shared/studio/ime-input'
import { shouldSubmit } from '../../shared/studio/submit-key'
import { studioPreferences } from '../studio-preferences'
import StudioReferenceAttachments from './StudioReferenceAttachments.vue'
import StudioMaterialStatus from './studio-message/StudioMaterialStatus.vue'
import '../studio-composer.css'

const router = useRouter(), prompt = ref(''), kind = ref<'image' | 'video'>('image')
const files = ref<StudioFile[]>([]), busy = ref(false), error = ref('')
const ime = createImeGuard(), preparation = new AbortController()
const materials = useStudioMaterials(files, computed(() => 'discovery:' + (session.user?.id || 'guest')), { imagesOnly: true, limit: ref(10) })
const references = computed(() => files.value.map(file => ({ name: file.name, url: file.content })))
const issues = computed(() => materials.snapshot.value.items.filter(item => item.status !== 'ready'))
onBeforeUnmount(() => preparation.abort())
function attach(event: Event) {
  const input = event.target as HTMLInputElement
  if (input.files) materials.add([...input.files])
  input.value = ''
}
function paste(event: ClipboardEvent) {
  const images = [...(event.clipboardData?.files || [])].filter(file => file.type.startsWith('image/'))
  if (images.length) { event.preventDefault(); materials.add(images) }
}
function drop(event: DragEvent) {
  if (event.dataTransfer?.files.length) materials.add([...event.dataTransfer.files])
}
function enter(event: KeyboardEvent) {
  if (ime.blocks(event)) return
  if (!shouldSubmit(event, studioPreferences.submitKey, matchMedia('(hover: hover) and (pointer: fine)').matches)) return
  event.preventDefault(); void send()
}
async function send() {
  if (busy.value || !prompt.value.trim()) return
  busy.value = true; error.value = ''
  const owner = session.user?.id
  try {
    await materials.wait(preparation.signal)
    if (preparation.signal.aborted || owner !== session.user?.id) return
    const id = saveStudioEntry({ owner: owner || null, kind: kind.value, prompt: prompt.value, references: references.value })
    const failure = await router.push({ path: '/create/' + kind.value, query: { entry: id } })
    if (failure) { clearStudioEntry(id); error.value = '未能进入创作台，请重试。' }
  } catch (cause) { if (!preparation.signal.aborted) error.value = errorMessage(cause) }
  finally { busy.value = false }
}
</script>

<template>
  <section class="discovery-creation" aria-labelledby="discovery-creation-heading">
    <h2 id="discovery-creation-heading">今天，想创作什么？</h2>
    <div class="creation-modes" role="group" aria-label="快捷创作类型">
      <button type="button" :aria-pressed="kind === 'image'" :disabled="busy" @click="kind = 'image'"><Image :size="18" aria-hidden="true" />图片生成</button>
      <button type="button" :aria-pressed="kind === 'video'" :disabled="busy" @click="kind = 'video'"><Video :size="18" aria-hidden="true" />视频生成</button>
    </div>
    <form class="studio-composer discovery-composer" aria-label="快捷创作" @submit.prevent="send" @dragover.prevent @drop.prevent="drop">
      <StudioReferenceAttachments :references="references" :disabled="busy" @remove="materials.removeAt" />
      <StudioMaterialStatus :items="issues" :disabled="busy" @remove="materials.remove" @retry="materials.retry" @cancel="materials.cancel" />
      <label class="field"><span class="studio-sr-only">创作描述</span><textarea v-model="prompt" class="composer-input" rows="2" maxlength="100000" required :disabled="busy" :placeholder="kind === 'image' ? '描述你想生成的图片…' : '描述你想生成的视频…'" @keydown="enter" @keyup="ime.release" @compositionstart="ime.start" @compositionend="ime.end" @paste="paste" /></label>
      <div class="studio-composer-tools">
        <label class="studio-tool composer-attachment" title="添加参考图"><Plus :size="20" aria-hidden="true" /><span>参考图</span><input type="file" aria-label="添加参考图" accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif" multiple :disabled="busy || materials.snapshot.value.items.length >= 10" @change="attach" /></label>
        <button type="submit" class="composer-submit" aria-label="发送到创作台" title="发送到创作台" :disabled="busy || materials.failed.value || !prompt.trim()"><LoaderCircle v-if="busy" :size="21" aria-hidden="true" /><ArrowUp v-else :size="21" aria-hidden="true" /></button>
      </div>
      <p v-if="error" class="form-error" role="alert">{{ error }}</p>
    </form>
  </section>
</template>

<style scoped>
.discovery-creation { width: min(100%, 1120px); margin: 28px auto 48px; }
h2 { margin: 0 0 20px; text-align: center; font-size: 28px; line-height: 40px; font-weight: 600; letter-spacing: 0; }
.creation-modes { display: flex; width: fit-content; max-width: 100%; margin: 0 auto 24px; padding: 4px; border-radius: 16px; background: var(--surface-soft); }
.creation-modes button { display: flex; align-items: center; justify-content: center; gap: 8px; min-width: 144px; min-height: 44px; padding: 8px 16px; border: 0; border-radius: 12px; color: var(--muted); background: transparent; font-size: 14px; }
.creation-modes button[aria-pressed="true"] { color: var(--ink); background: var(--surface); }
.discovery-composer { margin: 0; padding: 16px; border-radius: 24px; background: color-mix(in srgb, var(--surface) 88%, var(--canvas)); }
.discovery-composer > .field { margin: 0; min-width: 0; }
.discovery-composer .composer-input { min-height: 96px; }
.discovery-composer .studio-composer-tools { display: flex; justify-content: space-between; gap: 12px; }
.discovery-composer .studio-tool, .discovery-composer .composer-submit { min-height: 44px; }
.discovery-composer .composer-submit { width: 44px; height: 44px; margin-left: auto; }
.discovery-composer .composer-attachment { font-size: 14px; }
.discovery-composer .composer-attachment input { height: 100%; }
@media (max-width: 999px) {
  .discovery-creation { margin: 16px auto 28px; }
  h2 { margin-bottom: 16px; font-size: 22px; line-height: 32px; }
  .creation-modes { margin-bottom: 16px; }
  .creation-modes button { min-width: 128px; }
  .discovery-composer { padding: 12px; }
  .discovery-composer .composer-input { min-height: 88px; }
  .discovery-composer .composer-submit { grid-column: auto; grid-row: auto; }
}
</style>
