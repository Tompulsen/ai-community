<script setup lang="ts">
import { computed, defineAsyncComponent, nextTick, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Image, MessageSquare, Video, X } from '@lucide/vue'
import { errorMessage, session } from '../state'
import { clearStudioEntry, saveStudioEntry, type StudioEntry } from '../studio-entry'
import StudioWorkspace from './StudioWorkspace.vue'
import type StudioChat from './StudioChat.vue'
import '../studio-composer.css'

const StudioAccountTools = defineAsyncComponent(() => import('./StudioAccountTools.vue'))
const router = useRouter(), route = useRoute(), kind = ref<'text' | 'image' | 'video'>('image'), mediaKind = ref<'image' | 'video'>('image')
const chatComponent = shallowRef<typeof StudioChat>(), chatLoading = ref(false)
const chat = ref<InstanceType<typeof StudioChat>>()
const busy = ref(false), error = ref(''), workspace = ref<InstanceType<typeof StudioWorkspace>>()
const accountDialog = ref<HTMLDialogElement>(), accountTool = ref<'prices' | 'keys'>('prices')
const accountOpen = ref(false)
const accountHeading = computed(() => accountTool.value === 'prices' ? '模型广场' : '密钥')
let kindChange = 0
let pendingTextModel: string | undefined
async function changeKind(value: 'text' | 'image' | 'video', model?: string) {
  const accepted = ++kindChange
  if (value === 'text' && model) pendingTextModel = model
  kind.value = value
  if (value !== 'text') mediaKind.value = value
  if (value === 'text' && !chatComponent.value) {
    chatLoading.value = true; error.value = ''
    try {
      const component = await import('./StudioChat.vue')
      if (!live) return
      chatComponent.value = component.default
    } catch (cause) {
      if (live && accepted === kindChange) error.value = errorMessage(cause)
      return
    } finally { chatLoading.value = false }
  }
  await nextTick()
  if (!live || accepted !== kindChange) return
  const target = value === 'text' ? chat.value : workspace.value
  const selectedModel = value === 'text' ? pendingTextModel : model
  if (target && selectedModel) target.model = selectedModel
  if (value === 'text' && target) pendingTextModel = undefined
}
let live = true, sendRevision = 0
onBeforeUnmount(() => { live = false; sendRevision++; accountDialog.value?.close() })
watch(() => session.user?.id, () => { kindChange++; sendRevision++; busy.value = false; pendingTextModel = undefined; error.value = ''; accountDialog.value?.close() })
async function openAccount(view: 'prices' | 'keys') {
  if (!session.user) { error.value = '请登录后查看模型价格和密钥。'; return }
  accountTool.value = view; accountOpen.value = true
  await nextTick(); accountDialog.value?.showModal()
}
async function send(value: StudioEntry) {
  if (busy.value) return
  const revision = ++sendRevision, owner = session.user?.id || null, path = route.fullPath
  const current = () => live && revision === sendRevision && owner === (session.user?.id || null) && route.fullPath === path
  let id: string | undefined
  busy.value = true; error.value = ''
  try {
    id = await saveStudioEntry(value)
    if (!current()) { await clearStudioEntry(id, owner); return }
    const failure = await router.push({ path: '/create/' + value.kind, query: { entry: id } })
    if (failure) { await clearStudioEntry(id, owner); if (current()) error.value = '未能进入创作台，请重试。' }
  } catch (cause) {
    if (id && current()) await clearStudioEntry(id, owner).catch(() => {})
    if (current()) error.value = errorMessage(cause)
  } finally { if (revision === sendRevision) busy.value = false }
}
</script>

<template>
  <section class="discovery-creation" aria-labelledby="discovery-creation-heading">
    <h2 id="discovery-creation-heading">今天，想创作什么？</h2>
    <div class="creation-modes" role="group" aria-label="快捷创作类型">
      <button type="button" :aria-pressed="kind === 'text'" :disabled="busy" @click="changeKind('text')"><MessageSquare :size="18" aria-hidden="true" />文本对话</button>
      <button type="button" :aria-pressed="kind === 'image'" :disabled="busy" @click="changeKind('image')"><Image :size="18" aria-hidden="true" />图片生成</button>
      <button type="button" :aria-pressed="kind === 'video'" :disabled="busy" @click="changeKind('video')"><Video :size="18" aria-hidden="true" />视频生成</button>
    </div>
    <component :is="chatComponent" v-if="chatComponent" v-show="kind === 'text'" ref="chat" class="discovery-workspace" :mode="kind" entry-only :entry-pending="busy" @kind="changeKind" @entry="send" @prices="openAccount('prices')" @keys="openAccount('keys')" />
    <div v-if="kind === 'text' && !chatComponent" class="discovery-workspace"><div class="studio-composer composer-loading" role="status" :aria-busy="chatLoading"><span>{{ chatLoading ? '正在加载文本创作…' : '文本创作暂时无法加载' }}</span><button v-if="!chatLoading" type="button" class="button btn" @click="changeKind('text')">重新加载</button></div></div>
    <StudioWorkspace v-show="kind !== 'text'" ref="workspace" class="discovery-workspace" :kind="mediaKind" entry-only :entry-pending="busy" @kind="changeKind" @entry="send" @prices="openAccount('prices')" @keys="openAccount('keys')" />
    <p v-if="error" class="form-error" role="alert">{{ error }}</p>
    <Teleport to="body">
      <dialog ref="accountDialog" class="discovery-account-dialog" :aria-label="accountHeading" @close="accountOpen = false" @click="($event.target === accountDialog) && accountDialog?.close()">
        <header><h2>{{ accountHeading }}</h2><button type="button" class="icon-button" :aria-label="'关闭' + accountHeading" @click="accountDialog?.close()"><X :size="20" aria-hidden="true" /></button></header>
        <StudioAccountTools v-if="accountOpen" :view="accountTool" :model="kind === 'text' ? chat?.model : workspace?.model" />
      </dialog>
    </Teleport>
  </section>
</template>

<style scoped>
.discovery-creation { width: min(100%, 1120px); margin: 28px auto 48px; }
h2 { margin: 0 0 20px; text-align: center; font-size: 28px; line-height: 40px; font-weight: 600; letter-spacing: 0; }
.creation-modes { display: flex; width: fit-content; max-width: 100%; margin: 0 auto 24px; padding: 4px; border-radius: 16px; background: var(--surface-soft); }
.creation-modes button { display: flex; align-items: center; justify-content: center; gap: 8px; min-width: 144px; min-height: 44px; padding: 8px 16px; border: 0; border-radius: 12px; color: var(--muted); background: transparent; font-size: 14px; }
.creation-modes button:hover { color: var(--ink); background: var(--state-hover); }
.creation-modes button[aria-pressed="true"] { color: var(--ink); background: var(--state-selected); }
.creation-modes button[aria-pressed="true"]:hover { background: var(--state-pressed); }
.discovery-workspace :deep(.studio-composer) { margin: 0; padding: 16px; border-radius: 24px; background: color-mix(in srgb, var(--surface) 88%, var(--canvas)); }
.discovery-workspace :deep(.prompt-field) { margin: 0; min-width: 0; }
.discovery-workspace :deep(.composer-input) { min-height: 96px; }
.discovery-workspace :deep(.studio-composer-tools) { gap: 8px; }
.discovery-workspace :deep(.studio-composer-models) { margin-left: 0; flex: 1; }
.discovery-workspace :deep(.studio-tool), .discovery-workspace :deep(.composer-submit) { min-height: 44px; }
.discovery-workspace :deep(.composer-submit) { width: 44px; height: 44px; margin-left: auto; }
.discovery-workspace :deep(.composer-attachment input) { height: 100%; }
.composer-loading { display: grid; place-content: center; gap: 12px; min-height: 182px; color: var(--muted); text-align: center; }
.discovery-account-dialog { width: min(1000px, calc(100vw - 32px)); max-height: calc(100dvh - 48px); padding: 24px; border: 1px solid var(--border); border-radius: 12px; background: var(--surface); color: var(--ink); overflow-y: auto; overscroll-behavior: contain; }
.discovery-account-dialog::backdrop { background: rgb(0 0 0 / 40%); }
.discovery-account-dialog > header { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 24px; }
.discovery-account-dialog > header h2 { margin: 0; font-size: 20px; line-height: 28px; }
@media (max-width: 999px) {
  .discovery-creation { margin: 16px auto 28px; }
  h2 { margin-bottom: 16px; font-size: 22px; line-height: 32px; }
  .creation-modes { margin-bottom: 16px; }
  .creation-modes button { min-width: 0; padding-inline: 12px; gap: 6px; }
  .discovery-workspace :deep(.studio-composer) { padding: 12px; }
  .discovery-workspace :deep(.composer-input) { min-height: 88px; }
  .composer-loading { min-height: 210px; }
  .discovery-workspace :deep(.studio-composer-tools) { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, auto) 44px; }
  .discovery-workspace :deep(.studio-composer-actions) { grid-column: 1 / 4; grid-row: 1; justify-content: flex-start; }
  .discovery-workspace :deep(.studio-composer-models) { grid-column: 1; grid-row: 2; }
  .discovery-workspace :deep(.billing-compact) { grid-column: 2; grid-row: 2; max-width: 112px; justify-self: end; }
  .discovery-workspace :deep(.composer-submit) { grid-column: 3; grid-row: 2; }
  .discovery-account-dialog { padding: 16px; }
}
@media (max-width: 480px) {
  .creation-modes button { gap: 4px; padding-inline: 8px; font-size: 12px; white-space: nowrap; }
  .creation-modes button svg { flex: none; width: 16px; height: 16px; }
}
</style>
