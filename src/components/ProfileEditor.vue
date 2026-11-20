<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { onBeforeRouteLeave, onBeforeRouteUpdate, useRoute, useRouter } from 'vue-router'
import { Check, ChevronDown, Save, X } from '@lucide/vue'
import type { SessionUser } from '../data'
import { api, errorMessage, loadSession, session } from '../state'
const emit = defineEmits<{ saved: [user: SessionUser] }>()
const route = useRoute(), router = useRouter()
const nameInput = ref<HTMLInputElement>()
const leaveDialog = ref<HTMLDialogElement>()
const name = ref(''), bio = ref('')
const busy = ref(false), error = ref(''), saved = ref(false)
const baseline = ref('')
const value = () => JSON.stringify([name.value, bio.value])
const dirty = computed(() => value() !== baseline.value)
let active = true, operation = 0, owner: string | undefined
let resolveLeave: ((discard: boolean) => void) | undefined
function restore(user: SessionUser | null) {
  name.value = user?.name || user?.username || ''; bio.value = user?.bio || ''
  baseline.value = value()
}
watch(() => session.user, user => {
  if (user?.id !== owner) {
    finishLeave(false); operation++; owner = user?.id
    busy.value = false; saved.value = false; error.value = ''; restore(user)
  } else if (!busy.value && !dirty.value) restore(user)
}, { immediate: true, flush: 'sync' })
function confirmLeave() {
  if (!session.user || (!dirty.value && !busy.value)) return true
  if (resolveLeave) return false
  leaveDialog.value?.showModal()
  return new Promise<boolean>(resolve => { resolveLeave = resolve })
}
function finishLeave(discard: boolean) {
  if (discard) {
    operation++; restore(session.user)
    busy.value = false
  }
  leaveDialog.value?.close(); resolveLeave?.(discard); resolveLeave = undefined
}
onBeforeRouteLeave(confirmLeave)
onBeforeRouteUpdate(to => to.query.creator === route.query.creator && to.query.edit === 'profile' ? true : confirmLeave())
function beforeUnload(event: BeforeUnloadEvent) {
  if (session.user && (dirty.value || busy.value)) { event.preventDefault(); event.returnValue = '' }
}
function close() { void router.replace({ path: route.path, query: { ...route.query, edit: undefined } }) }
onMounted(async () => {
  window.addEventListener('beforeunload', beforeUnload)
  await nextTick()
  nameInput.value?.focus({ preventScroll: true })
})
onBeforeUnmount(() => {
  active = false; operation++; finishLeave(false)
  window.removeEventListener('beforeunload', beforeUnload)
})
async function saveProfile() {
  if (busy.value || !session.user || !name.value.trim()) return
  const account = session.user.id, currentOperation = ++operation
  const current = () => active && currentOperation === operation && session.user?.id === account
  busy.value = true; saved.value = false; error.value = ''
  try {
    const result = await api<{ user: SessionUser }>('/api/profile', { method: 'PATCH', body: {
      name: name.value.trim(), bio: bio.value.trim(),
    } })
    if (!current()) return
    await loadSession(true)
    if (!current()) return
    const updated = result.user
    session.user = { ...session.user!, name: updated.name, bio: updated.bio }
    restore(session.user); saved.value = true; emit('saved', session.user)
  } catch (cause) { if (current()) error.value = errorMessage(cause) }
  finally { if (current()) busy.value = false }
}
</script>

<template>
  <section class="profile-editor" aria-labelledby="profile-editor-heading">
    <header class="editor-heading"><h1 id="profile-editor-heading">编辑个人资料</h1><button type="button" class="icon-button" aria-label="关闭资料编辑" title="关闭资料编辑" @click="close"><X :size="20" /></button></header>
    <p v-if="error" class="notice-inline" role="alert">{{ error }}</p>
    <form class="profile-form" @submit.prevent="saveProfile">
      <label class="field"><span class="field-label"><span id="profile-name-label">社区昵称</span><span class="field-count" aria-hidden="true">{{ name.length }}/50</span></span><input ref="nameInput" v-model="name" aria-labelledby="profile-name-label" class="control" autocomplete="nickname" maxlength="50" required :disabled="busy" @input="saved = false" /></label>
      <label class="field"><span class="field-label"><span id="profile-bio-label">个人简介</span><span class="field-count" aria-hidden="true">{{ bio.length }}/1500</span></span><textarea v-model="bio" aria-labelledby="profile-bio-label" class="control profile-bio" rows="3" maxlength="1500" :disabled="busy" placeholder="介绍一下自己，或分享你的创作方向…" @input="saved = false" /></label>
      <dl class="profile-identity"><div><dt>登录用户名</dt><dd>{{ session.user?.username }}</dd></div><div v-if="session.user?.accountId"><dt>章鱼号</dt><dd>{{ session.user.accountId }}</dd></div></dl>
      <details class="profile-preview"><summary>预览个人资料<ChevronDown :size="16" aria-hidden="true" /></summary><div class="profile-preview-body"><strong>{{ name }}</strong><span v-if="session.user?.accountId">章鱼号：{{ session.user.accountId }}</span><p>{{ bio }}</p></div></details>
      <footer class="profile-savebar"><p class="profile-save-status" role="status"><Check v-if="saved && !dirty" :size="15" />{{ busy ? '正在保存资料…' : saved && !dirty ? '资料已保存' : dirty ? '有未保存的修改' : '' }}</p><div class="profile-save-actions"><button type="button" class="button subtle btn" @click="close">取消</button><button class="button primary btn" :disabled="busy || !name.trim()"><Save :size="16" />{{ busy ? '正在保存…' : '保存资料' }}</button></div></footer>
    </form>
    <dialog ref="leaveDialog" class="compact-dialog" aria-labelledby="profile-leave-heading" @cancel.prevent="finishLeave(false)" @close="finishLeave(false)"><div class="dialog-heading"><h2 id="profile-leave-heading">保留资料修改？</h2><button class="icon-button" aria-label="关闭离开提示" @click="finishLeave(false)"><X :size="20" /></button></div><div class="dialog-body stack"><p>资料尚未确认保存。离开后，未保存的文字修改将丢失。</p><div class="profile-leave-actions"><button class="button subtle btn" @click="finishLeave(true)">放弃修改并离开</button><button class="button primary btn" autofocus @click="finishLeave(false)">继续编辑</button></div></div></dialog>
  </section>
</template>

<style scoped>
.profile-editor { container: profile-editor / inline-size; width: 100%; max-width: 760px; margin: 0 auto 24px; }
.editor-heading { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 16px; }
.editor-heading h1 { font-size: 20px; line-height: 28px; }
.editor-heading .icon-button { width: 44px; height: 44px; flex: none; }
.profile-form { display: grid; gap: 16px; }
.field-label { display: flex; align-items: baseline; justify-content: space-between; gap: 16px; }
.field-count, .profile-identity, .profile-save-status { color: var(--muted); font-size: 12px; line-height: 20px; }
.field-count { font-variant-numeric: tabular-nums; }
.profile-form .control { min-height: 44px; background: var(--surface); font-size: 16px; }
.profile-bio { min-height: 88px; resize: vertical; }
.profile-identity { display: flex; flex-wrap: wrap; gap: 4px 24px; margin: 0; overflow-wrap: anywhere; }
.profile-identity > div { display: flex; gap: 8px; }.profile-identity dd { margin: 0; color: var(--ink); }
.profile-preview { font-size: 12px; color: var(--muted); }.profile-preview summary { display: flex; align-items: center; gap: 8px; cursor: pointer; min-height: var(--control-height); }.profile-preview[open] summary svg { transform: rotate(180deg); }.profile-preview-body { display: grid; gap: 4px; padding-top: 8px; }.profile-preview-body p { white-space: pre-wrap; overflow-wrap: anywhere; }
.profile-savebar { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px 16px; padding-top: 16px; border-top: 1px solid var(--border); }
.profile-save-status { display: flex; align-items: center; gap: 4px; }
.profile-save-status svg { color: var(--green); }
.profile-save-actions, .profile-leave-actions { display: flex; justify-content: end; flex-wrap: wrap; gap: 8px; }
.profile-form .button { min-height: 44px; }
dialog:modal { overscroll-behavior: contain; }
dialog::backdrop { overflow: hidden; overscroll-behavior: contain; }
@media (max-width: 999px) { .profile-editor { padding: 16px; } }
@container profile-editor (max-width: 559px) {
  .profile-save-actions { margin-left: auto; }
}
</style>
