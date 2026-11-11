<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { RefreshCw, X, Upload } from '@lucide/vue'
import { api, errorMessage, getUploadLimits, notify, session, uploadFile } from '../state'
import { isCurrentStudioMessage, validateStudioWork, validShareId, type ShareWork } from '../studio-share'
import type { Work } from '../data'

const props = defineProps<{ kind: 'text' | 'image' | 'video'; source?: Work | null }>()
const emit = defineEmits<{ ready: []; state: [state: string]; background: [data: Record<string, unknown>] }>()
const frame = ref<HTMLIFrameElement>()
const frameUrl = ref('')
const state = ref<'loading' | 'ready' | 'authorize' | 'error'>('loading')
const error = ref('')
const launch = ref<{ code: string; origin: string; subject: string; userId: string }>()
const attempt = ref('')
const context = ref('')
const authorizing = ref(false)
const shareDialog = ref<HTMLDialogElement>()
const sharePhase = ref<'' | 'uploading' | 'editing' | 'error' | 'submitting'>('')
const shareTitle = ref('')
const shareText = ref('')
const shareError = ref('')
const remixNotice = ref('')
const origin = window.location.origin
let hello = false
let sent = false
let generation = 0
let timeout: ReturnType<typeof setTimeout> | undefined
let heartbeat: ReturnType<typeof setInterval> | undefined
let controller: AbortController | undefined
let workspaceRequest = ''
let remixRequest = ''
let authorizationUrl = ''
let task: { id: string; destination: string; sourceWorkId?: string; resultId?: string; content?: ShareWork; limits?: { image: number; video: number; document: number }; files: { id: string; role?: string }[]; controller: AbortController } | undefined

function send(type: string, value: object = {}) {
  frame.value?.contentWindow?.postMessage({ type, context: context.value, attempt: attempt.value, subject: launch.value?.subject, userId: launch.value?.userId, ...value }, origin)
}
function sendBackground(value: Record<string, unknown>) {
  if (state.value !== 'ready' || !launch.value) return false
  send('community-background', value)
  return true
}
defineExpose({ sendBackground, reconnect: connect })
function finishShare(outcome: string, code?: string) {
  if (task) send('community-share-response', { requestId: task.id, phase: 'finished', outcome, code })
  task?.controller.abort()
  task = undefined
  sharePhase.value = ''
  shareDialog.value?.close()
}
function stop() {
  generation++
  controller?.abort()
  clearTimeout(timeout)
  clearInterval(heartbeat)
  finishShare('canceled')
  hello = false; sent = false
  frameUrl.value = ''; launch.value = undefined
}
function fail(message: string) { stop(); error.value = message; state.value = 'error' }
function sendLaunch() {
  if (!hello || sent || !launch.value || !frame.value?.contentWindow) return
  sent = true
  send('community-launch', { code: launch.value.code })
}
async function connect() {
  const previous = context.value
  stop()
  if (previous) void api('/api/newapi/studio/context', { method: 'POST', body: { context: previous, action: 'revoke' } }).catch(() => {})
  if (!session.user) return
  const current = generation
  const active = new AbortController()
  controller = active
  state.value = 'loading'; error.value = ''; remixNotice.value = ''
  context.value = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  attempt.value = crypto.randomUUID()
  const url = new URL('/studio/community-embed', origin)
  url.search = new URLSearchParams({ context: context.value, attempt: attempt.value, kind: props.kind }).toString()
  frameUrl.value = url.href
  timeout = setTimeout(() => { if (current === generation) fail('工作台连接超时，请重试。') }, 60000)
  try {
    const result = await api<NonNullable<typeof launch.value>>('/api/newapi/studio/start', { method: 'POST', body: { kind: props.kind, context: context.value, returnTo: `/create/${props.kind}${props.source ? `?remix=${encodeURIComponent(props.source.id)}` : ''}` }, signal: active.signal })
    if (current !== generation) return
    if (result.origin !== origin || result.userId !== session.user.id || !/^[A-Za-z0-9_-]{43}$/.test(result.code)) throw new Error('工作台身份验证失败。')
    launch.value = result
    sendLaunch()
  } catch (cause) { if (current === generation && !active.signal.aborted) fail(errorMessage(cause)) }
}
function switchWorkspace() {
  if (state.value !== 'ready') return
  workspaceRequest = crypto.randomUUID()
  send('community-workspace', { kind: props.kind, requestId: workspaceRequest })
}
async function authorize() {
  if (authorizing.value || !launch.value) return
  authorizing.value = true
  try {
    const next = await api<NonNullable<typeof launch.value>>('/api/newapi/studio/start', { method: 'POST', body: { kind: props.kind, context: context.value, returnTo: `/create/${props.kind}` } })
    if (next.origin !== origin || next.userId !== session.user?.id || next.subject !== launch.value.subject) throw new Error('账号已变化，请重新连接。')
    const response = await fetch('/studio/api/new-api/community/embedded/init', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'x-community-embed': context.value }, body: JSON.stringify({ code: next.code }) })
    const result = await response.json()
    if (!response.ok || result.userId !== next.userId || result.subject !== next.subject || result.kind !== props.kind) throw new Error('工作台授权失败。')
    if (result.status === 'verify') { await connect(); return }
    const url = new URL(result.authorizationUrl)
    if (url.origin !== origin || url.pathname !== '/studio/api/new-api/community/embedded/authorize') throw new Error('授权地址无效。')
    window.location.assign(url.href)
  } catch (cause) { error.value = errorMessage(cause) }
  finally { authorizing.value = false }
}
async function uploadShared() {
  const active = task
  if (!active?.content || sharePhase.value === 'uploading') return
  sharePhase.value = 'uploading'
  shareError.value = ''
  send('community-share-response', { requestId: active.id, phase: 'uploading' })
  try {
    for (let index = active.files.length; index < active.content.files.length; index++) {
      const file = active.content.files[index]!
      if (task !== active || active.controller.signal.aborted) return
      const result = await uploadFile(new File([file.blob], file.name, { type: file.blob.type }), active.controller.signal)
      if (task !== active) return
      active.files.push({ id: result.id, role: file.role })
    }
    if (task !== active) return
    shareTitle.value = active.content.title
    shareText.value = active.content.text
    sharePhase.value = 'editing'
    shareDialog.value?.showModal()
    send('community-share-response', { requestId: active.id, phase: 'editing' })
  } catch (cause) {
    if (task !== active || active.controller.signal.aborted) return
    shareError.value = errorMessage(cause)
    sharePhase.value = 'error'
    send('community-share-response', { requestId: active.id, phase: 'retry' })
  }
}
async function publishShared() {
  const active = task
  if (!active?.content || sharePhase.value === 'submitting') return
  sharePhase.value = 'submitting'
  shareError.value = ''
  try {
    const work = active.content
    const generation = work.generation ? { ...work.generation, referenceFileIds: active.files.filter(file => file.role === 'reference').map(file => file.id) } : undefined
    const result = await api<{ work: Work }>('/api/works', { method: 'POST', body: { title: shareTitle.value.trim(), kind: work.category, text: shareText.value.trim(), body: work.category === 'resource' ? work.text : '', prompt: generation?.prompt || shareText.value.trim(), model: generation?.model || work.model, generation, fileIds: active.files.filter(file => file.role !== 'reference').map(file => file.id), tags: [], status: 'pending', destination: active.destination, resultId: active.resultId, requestId: active.id, idempotencyKey: active.id }, signal: active.controller.signal })
    if (task !== active) return
    finishShare(result.work.status)
    notify(result.work.status === 'pending' ? '作品已提交审核。' : '作品已发布。')
  } catch (cause) { if (task === active) { shareError.value = errorMessage(cause); sharePhase.value = 'editing' } }
}
async function receiveShare(data: Record<string, unknown>) {
  if (!validShareId(data.requestId)) return
  if (data.status === 'share-request') {
    if (task) {
      if (task.id !== data.requestId) send('community-share-response', { requestId: data.requestId, phase: 'finished', outcome: 'error', code: 'busy' })
      return
    }
    if (data.destination !== undefined && !['community', 'source-comment'].includes(String(data.destination))
      || data.destination === 'source-comment' && (typeof data.sourceWorkId !== 'string' || !/^[a-zA-Z0-9]{1,32}$/.test(data.sourceWorkId) || typeof data.resultId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(data.resultId))) {
      send('community-share-response', { requestId: data.requestId, phase: 'finished', outcome: 'error', code: 'invalid' }); return
    }
    task = { id: data.requestId, destination: data.destination === 'source-comment' ? 'source-comment' : 'community', sourceWorkId: typeof data.sourceWorkId === 'string' ? data.sourceWorkId : undefined, resultId: typeof data.resultId === 'string' ? data.resultId : undefined, files: [], controller: new AbortController() }
    const active = task
    try {
      const limits = await getUploadLimits()
      if (task !== active) return
      active.limits = { image: limits.imagesMb * 1024 * 1024, video: limits.videosMb * 1024 * 1024, document: limits.filesMb * 1024 * 1024 }
      send('community-share-response', { requestId: active.id, phase: 'ready', limits: active.limits })
    } catch (cause) { if (task === active) { notify(errorMessage(cause)); finishShare('error', 'limits-unavailable') } }
  } else if (task?.id === data.requestId) {
    if (data.status === 'share-cancel' && sharePhase.value !== 'editing' && sharePhase.value !== 'submitting') { finishShare('canceled'); return }
    if (data.status !== 'share-content' || task.content) return
    if (!validateStudioWork(data.work, task.limits) || (data.work.destination || 'community') !== task.destination
      || task.destination === 'source-comment' && (data.work.resultId !== task.resultId || data.work.generation?.sourceWorkId !== task.sourceWorkId)) {
      finishShare('error', 'invalid'); return
    }
    let content = data.work
    if (content.category === 'resource' && content.destination !== 'source-comment' && content.generation?.prompt.trim() && content.text.trim() && !content.files.some(file => file.role !== 'reference' && file.blob.type === 'text/markdown')) {
      if (content.files.filter(file => file.role !== 'reference').length >= 16) { finishShare('error', 'invalid'); return }
      content = { ...content, files: [...content.files, { name: 'creation.md', blob: new Blob([content.text], { type: 'text/markdown' }) }] }
    }
    task.content = content
    await uploadShared()
  }
}
function message(event: MessageEvent) {
  const identity = { context: context.value, attempt: attempt.value, subject: launch.value?.subject, userId: launch.value?.userId }
  if (!isCurrentStudioMessage(event, frame.value?.contentWindow, origin, identity)) return
  const data = event.data
  if (data.status === 'hello') { hello = true; sendLaunch(); return }
  if (data.status === 'error') { fail('工作台连接失败，请重新连接章鱼账号后重试。'); return }
  if (!isCurrentStudioMessage(event, frame.value?.contentWindow, origin, identity, true) || launch.value?.userId !== session.user?.id) return
  if (data.status === 'authorize') {
    try {
      const url = new URL(data.authorizationUrl)
      if (url.origin !== origin || url.pathname !== '/studio/api/new-api/community/embedded/authorize') throw new Error()
      authorizationUrl = url.href
      state.value = 'authorize'; clearTimeout(timeout)
    } catch { fail('工作台授权地址无效。') }
  } else if (data.status === 'ready') {
    state.value = 'ready'; clearTimeout(timeout)
    switchWorkspace()
    sendBackground({ action: 'list' })
    emit('ready')
    const current = generation
    const renew = async () => {
      try { await api('/api/newapi/studio/context', { method: 'POST', body: { context: context.value, action: 'renew' } }) }
      catch { if (current === generation) fail('工作台会话已过期，请重试。') }
    }
    void renew()
    heartbeat = setInterval(renew, 30000)
  } else if (data.status === 'workspace-ready' && data.requestId === workspaceRequest && data.kind === props.kind && props.source && (props.source.kind === 'resource' ? 'text' : props.source.kind) === props.kind) {
    remixRequest = crypto.randomUUID()
    remixNotice.value = '正在填入同款…'
    send('community-remix', { work: { requestId: remixRequest, sourceWorkId: props.source.id, kind: props.source.kind === 'resource' ? 'text' : props.source.kind, prompt: props.source.prompt, model: props.source.model || '', references: (props.source.referenceFiles || []).filter(file => file.type.startsWith('image/') && (/^https?:\/\//.test(file.url) || file.url.startsWith('/legacy-files/'))).map(file => ({ name: file.name, url: new URL(file.url, origin).href })) } })
  } else if (data.status === 'remix-applied' && data.requestId === remixRequest) remixNotice.value = '同款已填入。'
  else if (data.status === 'remix-error' && data.requestId === remixRequest) remixNotice.value = typeof data.message === 'string' ? data.message.slice(0, 240) : '同款无法填入。'
  else if (state.value === 'ready' && typeof data.status === 'string' && data.status.startsWith('background-')) emit('background', data)
  else if (state.value === 'ready' && typeof data.status === 'string' && data.status.startsWith('share-')) void receiveShare(data)
}
onMounted(() => { window.addEventListener('message', message); void connect() })
onBeforeUnmount(() => {
  const previous = context.value
  stop()
  window.removeEventListener('message', message)
  if (previous) void api('/api/newapi/studio/context', { method: 'POST', body: { context: previous, action: 'revoke' } }).catch(() => {})
})
watch(() => [props.kind, props.source?.id], () => { if (state.value === 'ready') switchWorkspace(); else void connect() })
watch(state, value => emit('state', value), { immediate: true })
</script>

<template>
  <section class="studio-stage" aria-label="创作工作台" :data-state="state">
    <iframe v-if="frameUrl" :key="attempt" ref="frame" :src="frameUrl" title="创作工作台" class="studio-frame" sandbox="allow-same-origin allow-scripts allow-forms allow-downloads allow-popups allow-popups-to-escape-sandbox" allow="fullscreen; clipboard-write" referrerpolicy="no-referrer" />
    <div v-if="state !== 'ready'" class="studio-state" :role="state === 'error' ? 'alert' : 'status'"><h2>{{ state === 'loading' ? '正在连接创作工作台…' : state === 'authorize' ? '授权创作工作台' : '无法打开工作台' }}</h2><p v-if="error">{{ error }}</p><button v-if="state === 'authorize' && authorizationUrl" class="button primary" :disabled="authorizing" @click="authorize">确认授权</button><button v-else-if="state === 'error'" class="button" @click="connect"><RefreshCw :size="16" />重试</button><RouterLink v-if="state === 'error'" to="/account?tab=balance" class="text-link">连接章鱼账号</RouterLink></div>
    <div v-if="sharePhase === 'uploading' || sharePhase === 'error'" class="studio-share-status" role="status"><p>{{ sharePhase === 'uploading' ? '正在上传作品…' : shareError }}</p><button v-if="sharePhase === 'error'" class="button" @click="uploadShared">重试上传</button><button class="button subtle" @click="finishShare('canceled')">取消</button></div>
    <p v-if="remixNotice" class="studio-remix-status" role="status">{{ remixNotice }}</p>
    <Teleport to="body"><dialog ref="shareDialog" class="compact-dialog" aria-labelledby="studio-share-title" @cancel.prevent="sharePhase !== 'submitting' && finishShare('canceled')"><div class="dialog-heading"><h2 id="studio-share-title">{{ task?.destination === 'source-comment' ? '发布同款评论' : '分享作品' }}</h2><button class="icon-button" aria-label="取消分享" :disabled="sharePhase === 'submitting'" @click="finishShare('canceled')"><X :size="20" /></button></div><form class="dialog-body stack" @submit.prevent="publishShared"><label class="field"><span>作品标题</span><input v-model="shareTitle" class="control" maxlength="100" required :disabled="sharePhase === 'submitting'" /></label><label class="field"><span>创作说明</span><textarea v-model="shareText" class="control" rows="4" maxlength="2500" :disabled="sharePhase === 'submitting'" /></label><p v-if="shareError" class="form-error" role="alert">{{ shareError }}</p><button class="button primary" :disabled="sharePhase === 'submitting'"><Upload :size="16" />{{ sharePhase === 'submitting' ? '正在提交…' : '提交作品' }}</button></form></dialog></Teleport>
  </section>
</template>
