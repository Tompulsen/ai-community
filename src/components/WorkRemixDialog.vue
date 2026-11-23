<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ArrowRight, PanelsTopLeft, WandSparkles, X } from '@lucide/vue'
import type { Work } from '../data'
import { api, errorMessage, session } from '../state'
import { chats, loadChats, saveChats } from '../native-chat'
import { creation, initializeCreation, selectCreationGroup, waitCreationGroup } from '../native-studio'
import { restoreRemixModels } from '../studio-remix-models'
import { remixPrompt } from '../studio-remix'
import type { StudioFile } from '../use-studio-materials'
import StudioRemixDialog from './StudioRemixDialog.vue'
import StudioWorkspace from './StudioWorkspace.vue'

const props = defineProps<{ source: Work }>()
const emit = defineEmits<{ close: [] }>()
const router = useRouter(), dialog = ref<HTMLDialogElement>()
const background = ref(false), loading = ref(false), busy = ref(false), issue = ref(''), loginRequired = ref(false)
const source = ref<Work>(props.source), workspace = ref<InstanceType<typeof StudioWorkspace>>()
const owner = session.user?.id
const mediaKind = computed(() => source.value.kind === 'image' || source.value.kind === 'video' ? source.value.kind : null)
const ready = computed(() => !loading.value && chats.ready && !!workspace.value && !creation.groupsLoading && !creation.groupSwitching && !creation.modelsLoading)
let revision = 0, live = true, previousGroup: string | null | undefined
let previousConversation: string | undefined
onMounted(() => {
  dialog.value?.showModal()
  if (session.user && mediaKind.value && !remixPrompt(props.source)) void prepare()
})
onBeforeUnmount(() => { live = false; revision++ })
const current = (value: number) => live && revision === value && owner === session.user?.id

async function workbench() {
  if (busy.value) return
  try { await router.push({ path: `/create/${props.source.kind === 'resource' ? 'text' : props.source.kind}`, query: { remix: props.source.id, prepare: '1' } }) }
  catch (cause) { issue.value = errorMessage(cause) }
}
async function prepare() {
  if (loading.value || busy.value || !mediaKind.value) return
  if (!session.user) { loginRequired.value = true; return }
  const retry = Boolean(issue.value)
  dialog.value?.close(); background.value = true; loading.value = true; issue.value = ''
  const version = ++revision
  try {
    const result = await api<{ work: Work }>(`/api/works/${encodeURIComponent(props.source.id)}`, { signal: AbortSignal.timeout(20000) })
    if (!current(version)) return
    source.value = { ...result.work, prompt: remixPrompt(result.work), model: result.work.generation?.model || result.work.model }
    if (source.value.kind !== 'image' && source.value.kind !== 'video') throw new Error('此作品请进入工作台生成。')
    await initializeCreation(); await loadChats(); await waitCreationGroup()
    if (!current(version)) return
    previousConversation ??= chats.activeId
    await restoreRemixModels(source.value, () => current(version), group => { previousGroup ??= group }, retry)
  } catch (cause) { if (current(version)) issue.value = errorMessage(cause) }
  finally { if (current(version)) loading.value = false }
}
async function generate(files: StudioFile[], prompt?: string, backgroundTask = true) {
  if (!current(revision) || !ready.value || busy.value || issue.value || !workspace.value) return
  busy.value = true
  const version = revision, target = workspace.value
  try {
    if (!await target.applyRemix({ ...source.value, prompt: prompt ?? source.value.prompt }, files, true)) throw new Error('生成配置尚未就绪，请重试。')
    if (!current(version)) return
    await nextTick()
    if (source.value.model && target.model !== source.value.model) throw new Error('原作模型未能恢复，请进入工作台确认。')
    await saveChats(true)
    if (!current(version)) return
    if (!backgroundTask) {
      if (current(version)) await router.push({ path: `/create/${source.value.kind}`, query: { remix: source.value.id, conversation: chats.activeId } })
      return
    }
    await target.generateBackground(() => { if (current(version)) emit('close') })
    if (current(version)) issue.value = target.submissionIssue || '任务未能提交，请检查配置后重试。'
  } catch (cause) { if (current(version)) issue.value = errorMessage(cause) }
  finally { if (current(version)) busy.value = false }
}
async function cancel() {
  if (busy.value) return
  if (!current(revision)) { emit('close'); return }
  const version = ++revision
  busy.value = true
  try {
    await waitCreationGroup()
    if (current(version) && previousGroup && creation.selectedGroup !== previousGroup) await selectCreationGroup(previousGroup)
    if (current(version)) {
      emit('close')
      await nextTick()
      if (owner === session.user?.id && previousConversation && chats.sessions.some(item => item.id === previousConversation)) { chats.activeId = previousConversation; await saveChats(true) }
    }
  } catch (cause) { if (current(version)) issue.value = errorMessage(cause) }
  finally { if (current(version)) busy.value = false }
}
</script>

<template>
  <dialog v-if="!background" ref="dialog" class="remix-choice-dialog" aria-labelledby="remix-choice-title" aria-describedby="remix-choice-description" @cancel.prevent="cancel">
    <header><h2 id="remix-choice-title">制作同款</h2><button type="button" class="icon-button" aria-label="关闭制作同款" :disabled="busy" @click="cancel"><X :size="20" /></button></header>
    <p id="remix-choice-description">选择生成方式，沿用作品的公开提示词与配置。</p>
    <div class="remix-choices">
      <button type="button" class="remix-choice" :disabled="busy" @click="workbench"><PanelsTopLeft :size="22" aria-hidden="true" /><span><strong>进入工作台生成</strong><small>先调整提示词、模型和参考图，再开始生成</small></span><ArrowRight :size="18" aria-hidden="true" /></button>
      <button type="button" class="remix-choice" :disabled="busy || !mediaKind" @click="prepare"><WandSparkles :size="22" aria-hidden="true" /><span><strong>后台生成</strong><small>{{ mediaKind ? '在当前页确认参考图和积分消耗，生成时继续浏览' : '文字作品请进入工作台生成' }}</small></span><ArrowRight :size="18" aria-hidden="true" /></button>
    </div>
    <p v-if="loginRequired" class="form-note" role="status">请先登录后使用后台生成。<RouterLink :to="{ path: '/account', query: { returnTo: '/work/' + source.id } }" class="text-link">去登录</RouterLink></p>
    <p v-if="issue" class="form-error" role="alert">{{ issue }}</p>
  </dialog>
  <template v-else>
    <div hidden inert><StudioWorkspace v-if="chats.ready && creation.loaded && mediaKind && !loading && !issue" ref="workspace" :kind="mediaKind" remix-preparing /></div>
    <StudioRemixDialog :source="source" :issue="issue" :loading="loading" :ready="ready" :busy="busy" :can-fallback="false" background-only @apply="(files, prompt) => generate(files, prompt, false)" @background="generate" @cancel="cancel" @retry="prepare" @workbench="workbench" />
  </template>
</template>

<style scoped>
.remix-choice-dialog { width: 480px; max-width: calc(100vw - 24px); max-height: calc(100dvh - 32px); padding: 20px; border: 1px solid var(--border); border-radius: var(--radius); color: var(--ink); background: var(--canvas); overflow-y: auto; }
.remix-choice-dialog::backdrop { background: rgb(0 0 0 / .5); }
header { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
h2 { margin: 0; font-size: 18px; }
header .icon-button { width: 44px; height: 44px; }
#remix-choice-description { margin: 8px 0 20px; color: var(--muted); font-size: 14px; line-height: 1.6; }
.remix-choices { display: grid; gap: 12px; }
.remix-choice { display: flex; align-items: center; gap: 12px; width: 100%; min-height: 88px; padding: 16px; text-align: left; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); color: var(--ink); }
.remix-choice:not(:disabled):hover { background: var(--state-hover); }
.remix-choice:not(:disabled):hover small { color: var(--ink); }
.remix-choice > svg { flex: none; }
.remix-choice > span { flex: 1; min-width: 0; display: grid; gap: 6px; }
.remix-choice strong { font-size: 15px; font-weight: 600; }
.remix-choice small { font-size: 13px; line-height: 1.6; color: var(--muted); }
.remix-choice:disabled { opacity: .6; cursor: not-allowed; }
@media (max-width: 639px) { .remix-choice-dialog { padding: 16px; }.remix-choice { padding: 12px; } }
</style>
