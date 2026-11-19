<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { onBeforeRouteLeave, onBeforeRouteUpdate, useRoute, useRouter } from 'vue-router'
import { Check, ChevronDown, Image, Save, Trash2, Upload, X } from '@lucide/vue'
import type { SessionUser } from '../data'
import { api, errorMessage, loadSession, session, uploadFile } from '../state'

const emit = defineEmits<{ saved: [user: SessionUser] }>()
const route = useRoute(), router = useRouter()
const avatarInput = ref<HTMLInputElement>(), bannerInput = ref<HTMLInputElement>(), nameInput = ref<HTMLInputElement>()
const leaveDialog = ref<HTMLDialogElement>()
const name = ref(''), bio = ref(''), avatarId = ref<string | null>(null), bannerId = ref<string | null>(null)
const avatarUrl = ref(''), bannerUrl = ref(''), avatarFailed = ref(false), bannerFailed = ref(false)
const busy = ref(false), uploading = ref<'avatar' | 'banner' | null>(null), error = ref(''), saved = ref(false)
const baseline = ref('')
const value = () => JSON.stringify([name.value, bio.value, avatarId.value, bannerId.value])
const dirty = computed(() => value() !== baseline.value)
let active = true, operation = 0, owner: string | undefined
let upload: AbortController | undefined, resolveLeave: ((discard: boolean) => void) | undefined
function restore(user: SessionUser | null) {
  name.value = user?.name || user?.username || ''; bio.value = user?.bio || ''
  avatarId.value = user?.avatarId || null; bannerId.value = user?.bannerId || null
  avatarUrl.value = user?.avatarUrl || ''; bannerUrl.value = user?.bannerUrl || ''
  baseline.value = value()
}
watch(() => session.user, user => {
  if (user?.id !== owner) {
    finishLeave(false); operation++; upload?.abort(); upload = undefined; owner = user?.id
    busy.value = false; uploading.value = null; saved.value = false; error.value = ''; restore(user)
  } else if (!busy.value && !dirty.value) restore(user)
}, { immediate: true, flush: 'sync' })
watch(avatarUrl, () => { avatarFailed.value = false })
watch(bannerUrl, () => { bannerFailed.value = false })
function confirmLeave() {
  if (!session.user || (!dirty.value && !busy.value)) return true
  if (resolveLeave) return false
  leaveDialog.value?.showModal()
  return new Promise<boolean>(resolve => { resolveLeave = resolve })
}
function finishLeave(discard: boolean) {
  if (discard) {
    operation++; upload?.abort(); upload = undefined; restore(session.user)
    busy.value = false; uploading.value = null
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
  active = false; operation++; upload?.abort(); finishLeave(false)
  window.removeEventListener('beforeunload', beforeUnload)
})
async function saveProfile() {
  if (busy.value || !session.user || !name.value.trim()) return
  const account = session.user.id, currentOperation = ++operation
  const current = () => active && currentOperation === operation && session.user?.id === account
  busy.value = true; saved.value = false; error.value = ''
  try {
    const result = await api<{ user: SessionUser }>('/api/profile', { method: 'PATCH', body: {
      name: name.value.trim(), bio: bio.value.trim(), avatarId: avatarId.value, bannerId: bannerId.value,
    } })
    if (!current()) return
    await loadSession(true)
    if (!current()) return
    const updated = result.user
    session.user = { ...session.user!, name: updated.name, bio: updated.bio, avatarId: updated.avatarId,
      bannerId: updated.bannerId, avatarUrl: updated.avatarUrl, bannerUrl: updated.bannerUrl }
    restore(session.user); saved.value = true; emit('saved', session.user)
  } catch (cause) { if (current()) error.value = errorMessage(cause) }
  finally { if (current()) busy.value = false }
}
async function uploadProfile(event: Event, field: 'avatar' | 'banner') {
  const input = event.target as HTMLInputElement, file = input.files?.[0]
  if (!file || busy.value || !session.user) return
  const account = session.user.id, currentOperation = ++operation
  const current = () => active && currentOperation === operation && session.user?.id === account
  const controller = new AbortController(); upload = controller
  busy.value = true; uploading.value = field; error.value = ''; saved.value = false
  try {
    if (!file.type.startsWith('image/')) throw new Error('请选择图片。')
    const result = await uploadFile(file, controller.signal)
    if (!current()) return
    if (field === 'avatar') { avatarId.value = result.id; avatarUrl.value = result.url }
    else { bannerId.value = result.id; bannerUrl.value = result.url }
  } catch (cause) { if (current()) error.value = errorMessage(cause) }
  finally {
    if (upload === controller) upload = undefined
    if (current()) { busy.value = false; uploading.value = null }
    input.value = ''
  }
}
</script>

<template>
  <section class="profile-editor" aria-labelledby="profile-editor-heading">
    <header class="editor-heading"><h1 id="profile-editor-heading">编辑个人资料</h1><button type="button" class="icon-button" aria-label="关闭资料编辑" title="关闭资料编辑" @click="close"><X :size="20" /></button></header>
    <p v-if="error" class="notice-inline" role="alert">{{ error }}</p>
    <form class="profile-form" @submit.prevent="saveProfile">
      <div class="profile-media">
        <div class="profile-media-item">
          <img v-if="avatarUrl && !avatarFailed" :src="avatarUrl" alt="当前头像" class="profile-avatar" @error="avatarFailed = true" />
          <span v-else class="profile-avatar profile-placeholder" role="img" :aria-label="avatarFailed ? '头像暂时无法显示' : '尚未设置头像'">{{ (name || session.user?.username || '我').slice(0, 1) }}</span>
          <div class="profile-media-actions"><button type="button" class="button subtle btn" :disabled="busy" @click="avatarInput?.click()"><Upload :size="16" />更换头像</button><button v-if="avatarId" type="button" class="icon-button" aria-label="移除头像" title="移除头像" :disabled="busy" @click="avatarId = null; avatarUrl = ''; saved = false"><Trash2 :size="16" /></button></div>
        </div>
        <div class="profile-media-item">
          <a v-if="bannerUrl && !bannerFailed" :href="bannerUrl" target="_blank" rel="noopener noreferrer" class="profile-cover" aria-label="查看完整封面" title="查看完整封面"><img :src="bannerUrl" alt="当前主页封面" @error="bannerFailed = true" /></a>
          <span v-else class="profile-cover profile-placeholder" role="img" :aria-label="bannerFailed ? '封面暂时无法显示' : '尚未设置封面'"><Image :size="24" /></span>
          <div class="profile-media-actions"><button type="button" class="button subtle btn" :disabled="busy" @click="bannerInput?.click()"><Image :size="16" />更换封面</button><button v-if="bannerId" type="button" class="icon-button" aria-label="移除封面" title="移除封面" :disabled="busy" @click="bannerId = null; bannerUrl = ''; saved = false"><Trash2 :size="16" /></button></div>
        </div>
      </div>
      <input ref="avatarInput" hidden type="file" aria-label="头像" accept="image/jpeg,image/png,image/webp,image/gif,image/avif" :disabled="busy" @change="uploadProfile($event, 'avatar')" />
      <input ref="bannerInput" hidden type="file" aria-label="主页封面" accept="image/jpeg,image/png,image/webp,image/gif,image/avif" :disabled="busy" @change="uploadProfile($event, 'banner')" />
      <label class="field"><span class="field-label"><span id="profile-name-label">社区昵称</span><span class="field-count" aria-hidden="true">{{ name.length }}/50</span></span><input ref="nameInput" v-model="name" aria-labelledby="profile-name-label" class="control" autocomplete="nickname" maxlength="50" required :disabled="busy" @input="saved = false" /></label>
      <label class="field"><span class="field-label"><span id="profile-bio-label">个人简介</span><span class="field-count" aria-hidden="true">{{ bio.length }}/1500</span></span><textarea v-model="bio" aria-labelledby="profile-bio-label" class="control profile-bio" rows="3" maxlength="1500" :disabled="busy" placeholder="介绍一下自己，或分享你的创作方向…" @input="saved = false" /></label>
      <dl class="profile-identity"><div><dt>登录用户名</dt><dd>{{ session.user?.username }}</dd></div><div v-if="session.user?.accountId"><dt>章鱼号</dt><dd>{{ session.user.accountId }}</dd></div></dl>
      <details class="profile-preview"><summary>预览个人资料<ChevronDown :size="16" aria-hidden="true" /></summary><div class="profile-preview-body"><strong>{{ name }}</strong><span v-if="session.user?.accountId">章鱼号：{{ session.user.accountId }}</span><p>{{ bio }}</p></div></details>
      <footer class="profile-savebar"><p class="profile-save-status" role="status"><Check v-if="saved && !dirty" :size="15" />{{ uploading ? '正在上传' + (uploading === 'avatar' ? '头像…' : '封面…') : busy ? '正在保存资料…' : saved && !dirty ? '资料已保存' : dirty ? '有未保存的修改' : '' }}</p><div class="profile-save-actions"><button type="button" class="button subtle btn" @click="close">取消</button><button class="button primary btn" :disabled="busy || !name.trim()"><Save :size="16" />{{ uploading ? '正在上传…' : busy ? '正在保存…' : '保存资料' }}</button></div></footer>
    </form>
    <dialog ref="leaveDialog" class="compact-dialog" aria-labelledby="profile-leave-heading" @cancel.prevent="finishLeave(false)" @close="finishLeave(false)"><div class="dialog-heading"><h2 id="profile-leave-heading">保留资料修改？</h2><button class="icon-button" aria-label="关闭离开提示" @click="finishLeave(false)"><X :size="20" /></button></div><div class="dialog-body stack"><p>资料尚未确认保存。离开后，未保存的文字和图片选择将丢失。</p><div class="profile-leave-actions"><button class="button subtle btn" @click="finishLeave(true)">放弃修改并离开</button><button class="button primary btn" autofocus @click="finishLeave(false)">继续编辑</button></div></div></dialog>
  </section>
</template>

<style scoped>
.profile-editor { container: profile-editor / inline-size; width: 100%; max-width: 760px; margin: 0 auto 24px; }
.editor-heading { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 16px; }
.editor-heading h1 { font-size: 20px; line-height: 28px; }
.editor-heading .icon-button, .profile-media-actions .icon-button { width: 44px; height: 44px; flex: none; }
.profile-form { display: grid; gap: 16px; }
.profile-media { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 24px; padding-bottom: 16px; border-bottom: 1px solid var(--border); }
.profile-media-item { display: flex; align-items: center; gap: 12px; min-width: 0; }
.profile-avatar { width: 64px; height: 64px; flex: none; border-radius: 50%; object-fit: cover; background: var(--surface-soft); }
.profile-placeholder { display: grid; place-items: center; color: var(--muted); font-size: 24px; }
.profile-cover { width: 112px; height: 64px; flex: none; background: var(--surface-soft); border-radius: 6px; }
.profile-cover img { display: block; width: 100%; height: 100%; object-fit: contain; border-radius: inherit; }
.profile-media-actions { display: flex; align-items: center; flex-wrap: wrap; gap: 4px; }
.profile-media-actions .button { padding-inline: 8px; }
.profile-media-actions .icon-button { color: var(--muted); }
.profile-media-actions .icon-button:hover { color: var(--danger); background: var(--danger-soft); }
.field-label { display: flex; align-items: baseline; justify-content: space-between; gap: 16px; }
.field-count, .profile-identity, .profile-save-status { color: var(--muted); font-size: 12px; line-height: 20px; }
.field-count { font-variant-numeric: tabular-nums; }
.profile-form .control { min-height: 44px; background: var(--surface); font-size: 16px; }
.profile-bio { min-height: 88px; resize: vertical; }
.profile-identity { display: flex; flex-wrap: wrap; gap: 4px 24px; margin: 0; overflow-wrap: anywhere; }
.profile-identity > div { display: flex; gap: 8px; }.profile-identity dd { margin: 0; color: var(--ink); }
.profile-preview { font-size: 12px; color: var(--muted); }.profile-preview summary { display: flex; align-items: center; gap: 8px; cursor: pointer; min-height: 24px; }.profile-preview[open] summary svg { transform: rotate(180deg); }.profile-preview-body { display: grid; gap: 4px; padding-top: 8px; }.profile-preview-body p { white-space: pre-wrap; overflow-wrap: anywhere; }
.profile-savebar { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px 16px; padding-top: 16px; border-top: 1px solid var(--border); }
.profile-save-status { display: flex; align-items: center; gap: 4px; }
.profile-save-status svg { color: var(--green); }
.profile-save-actions, .profile-leave-actions { display: flex; justify-content: end; flex-wrap: wrap; gap: 8px; }
.profile-form .button { min-height: 44px; }
dialog:modal { overscroll-behavior: contain; }
dialog::backdrop { overflow: hidden; overscroll-behavior: contain; }
@media (max-width: 999px) { .profile-editor { padding: 16px; } }
@container profile-editor (max-width: 559px) {
  .profile-media { gap: 12px; }
  .profile-media-item { flex-direction: column; align-items: flex-start; gap: 8px; }
  .profile-media-actions { gap: 0; }
  .profile-media-actions .button { gap: 4px; padding-inline: 4px; font-size: 12px; }
  .profile-media-actions .icon-button { width: 36px; }
  .profile-save-actions { margin-left: auto; }
}
</style>
