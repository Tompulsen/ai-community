<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ArrowLeft, ArrowRight, Check, ChevronRight, RefreshCw, Search, Ticket, Users, X } from '@lucide/vue'
import { api, errorMessage, notify, queryString, session } from '../state'

interface User { id: string; accountId?: string; name: string; username: string; avatarUrl?: string | null }
interface Account { userId: string; balance: number }
interface Adjustment { userId: string; mode: 'add' | 'set'; amount: number; expectedBalance: number; requestId: string; reason: string }
const props = defineProps<{ confirmLeave: () => boolean | Promise<boolean> }>()
const query = ref(''), users = ref<User[]>([]), cursor = ref<string | null>(null), listBusy = ref(false), listError = ref('')
const selected = ref<User | null>(null), account = ref<Account | null>(null), accountBusy = ref(false), accountError = ref('')
const mode = ref<'add' | 'set'>('add'), amount = ref<number | string>(1), reason = ref(''), busy = ref(false), error = ref(''), success = ref('')
const pending = ref<Adjustment | null>(null), confirmation = ref<Adjustment | null>(null), dialog = ref<HTMLDialogElement>()
const detailHeading = ref<HTMLElement>(), searchInput = ref<HTMLInputElement>(), brokenImages = ref(new Set<string>())
const owner = session.user?.id, storageKey = `ai-community-next:admin-adjustment:${owner}`, controller = new AbortController()
let active = true, listVersion = 0, detailVersion = 0, appliedQuery = ''
const isCurrent = () => active && session.user?.id === owner && !!session.user?.isAdmin
const validDetail = (version: number, id: string) => isCurrent() && version === detailVersion && selected.value?.id === id
const format = (value: number) => value.toLocaleString('zh-CN')
const nextBalance = computed(() => {
  if (!account.value || typeof amount.value !== 'number' || !Number.isInteger(amount.value) || amount.value < (mode.value === 'add' ? 1 : 0)) return null
  const result = mode.value === 'add' ? account.value.balance + amount.value : amount.value
  return Number.isSafeInteger(result) && result <= 2147483647 ? result : null
})
const hasUnsavedChanges = computed(() => !!selected.value && !pending.value && (mode.value !== 'add' || amount.value !== 1 || !!reason.value))
defineExpose({ hasUnsavedChanges, busy })
function message(cause: unknown) {
  const value = errorMessage(cause)
  return ({ LOTTERY_ACCOUNT_CHANGED: '当前登录账号已变化，请刷新页面后重新进入抽奖次数。', LOTTERY_CONFLICT: '次数已变化，请按重新读取的次数核对后再提交。', LOTTERY_INVALID: '次数参数无效，请输入范围内的整数。', LOTTERY_NOT_FOUND: '该用户已不存在，请重新选择。', LOTTERY_FORBIDDEN: '该账号当前无法调整抽奖次数。' } as Record<string, string>)[value] || value
}
function resetDraft() { mode.value = 'add'; amount.value = 1; reason.value = ''; confirmation.value = null; dialog.value?.close() }
async function loadUsers(more = false) {
  if (!isCurrent() || listBusy.value || (more && !cursor.value)) return
  const version = ++listVersion
  if (!more) { appliedQuery = query.value.trim(); users.value = []; cursor.value = null }
  listBusy.value = true; listError.value = ''
  try {
    const data = await api<{ items: User[]; nextCursor?: string | null }>(`/api/admin/users${queryString({ query: appliedQuery, origin: 'local', status: 'active', sort: 'created-desc', limit: '20', cursor: more ? cursor.value ?? undefined : undefined })}`, { signal: controller.signal })
    if (!isCurrent() || version !== listVersion) return
    users.value = more ? [...users.value, ...data.items.filter(person => !users.value.some(old => old.id === person.id))] : data.items
    cursor.value = data.nextCursor ?? null
  } catch (cause) { if (isCurrent() && version === listVersion) listError.value = errorMessage(cause) }
  finally { if (isCurrent() && version === listVersion) listBusy.value = false }
}
async function loadAccount() {
  const id = selected.value?.id, version = ++detailVersion
  if (!id || !isCurrent() || pending.value) return
  account.value = null; accountBusy.value = true; accountError.value = ''
  try {
    const data = await api<Account>(`/api/admin/lottery/account${queryString({ userId: id })}`, { signal: controller.signal, expectedAccount: owner })
    if (validDetail(version, id)) account.value = data
  } catch (cause) { if (validDetail(version, id)) accountError.value = message(cause) }
  finally { if (validDetail(version, id)) accountBusy.value = false }
}
async function choose(person: User | null) {
  if (busy.value || pending.value || selected.value?.id === person?.id) return
  if (!await props.confirmLeave() || !isCurrent()) return
  resetDraft(); selected.value = person; account.value = null; accountError.value = ''; error.value = ''; success.value = ''; detailVersion++
  if (person) void loadAccount()
  else accountBusy.value = false
  await nextTick()
  if (person) detailHeading.value?.focus()
  else searchInput.value?.focus()
}
function openConfirmation() {
  if (!isCurrent() || busy.value || pending.value || !account.value || nextBalance.value === null || selected.value?.id !== account.value.userId) return
  error.value = ''; success.value = ''
  confirmation.value = { userId: account.value.userId, mode: mode.value, amount: Number(amount.value), expectedBalance: account.value.balance, requestId: crypto.randomUUID(), reason: reason.value.trim() }
  dialog.value?.showModal()
}
function closeConfirmation() { if (!busy.value) { dialog.value?.close(); confirmation.value = null } }
function clearPending() {
  pending.value = null
  try { sessionStorage.removeItem(storageKey) } catch { /* Retrying a confirmed receipt cannot apply it twice. */ }
}
async function adjust() {
  const request = pending.value ?? confirmation.value, version = detailVersion
  if (!isCurrent() || busy.value || !request || request.userId !== selected.value?.id) return
  if (!pending.value) {
    try { sessionStorage.setItem(storageKey, JSON.stringify(request)) }
    catch { error.value = '浏览器无法保存本次操作凭证，请允许站点存储后重试。'; closeConfirmation(); return }
    pending.value = request
  }
  busy.value = true; error.value = ''; success.value = ''
  try {
    const data = await api<Account>('/api/admin/lottery/chances', { method: 'POST', body: request, expectedAccount: owner, signal: controller.signal })
    if (!validDetail(version, request.userId)) return
    account.value = data; clearPending(); resetDraft()
    success.value = `次数已更新，当前可用 ${format(data.balance)} 次。`; notify('抽奖次数已更新。')
  } catch (cause) {
    if (!validDetail(version, request.userId)) return
    error.value = message(cause)
    if (['LOTTERY_CONFLICT', 'LOTTERY_INVALID', 'LOTTERY_NOT_FOUND', 'LOTTERY_FORBIDDEN'].includes(errorMessage(cause))) {
      clearPending(); await loadAccount()
    }
  } finally {
    if (isCurrent()) { busy.value = false; closeConfirmation() }
  }
}
function restorePending() {
  try {
    const value = JSON.parse(sessionStorage.getItem(storageKey) || 'null') as Partial<Adjustment> | null
    if (!value || typeof value !== 'object' || typeof value.requestId !== 'string' || !/^[a-zA-Z0-9_-]{16,64}$/.test(value.requestId)
      || typeof value.userId !== 'string' || !/^[a-zA-Z0-9]{1,32}$/.test(value.userId) || !['add', 'set'].includes(value.mode ?? '')
      || !Number.isInteger(value.amount) || Number(value.amount) < (value.mode === 'add' ? 1 : 0) || Number(value.amount) > 2147483647
      || !Number.isInteger(value.expectedBalance) || Number(value.expectedBalance) < 0 || Number(value.expectedBalance) > 2147483647
      || typeof value.reason !== 'string' || value.reason.length > 300) return
    pending.value = value as Adjustment
    selected.value = { id: value.userId, name: `用户 #${value.userId}`, username: '' }
    mode.value = value.mode!; amount.value = value.amount!; reason.value = value.reason
    // Keep the original receipt across the move from the activity settings page.
    void api<{ user: User }>(`/api/admin/users/${encodeURIComponent(value.userId)}`, { signal: controller.signal }).then(data => {
      if (isCurrent() && selected.value?.id === data.user.id) selected.value = data.user
    }).catch(() => {})
  } catch { /* An unreadable draft must never become a new adjustment. */ }
}
function invalidate() { active = false; controller.abort(); dialog.value?.close(); selected.value = null; account.value = null; pending.value = null; confirmation.value = null; users.value = [] }
watch([() => session.user?.id, () => session.user?.isAdmin], () => { if (!isCurrent()) invalidate() }, { flush: 'sync' })
onMounted(() => { restorePending(); void loadUsers() })
onBeforeUnmount(invalidate)
</script>

<template>
  <section class="lottery-chances-page" aria-labelledby="chances-title">
    <header class="section-heading chances-heading"><div><h2 id="chances-title">用户抽奖次数</h2><p class="form-note">查找社区用户，查看并调整可用抽奖次数。</p></div><RouterLink to="/admin?tab=lottery" class="button subtle btn">活动抽奖<ArrowRight :size="16" aria-hidden="true" /></RouterLink></header>
    <div class="chances-workspace" :class="{ 'has-selection': selected }">
      <section class="chances-directory" aria-labelledby="chances-users-title">
        <div class="directory-heading"><h3 id="chances-users-title">选择用户</h3><span class="caption-5">正常的本地账号</span></div>
        <form class="chance-search" role="search" @submit.prevent="loadUsers()"><label class="field"><span>名称、用户名或账号 ID</span><input class="control" ref="searchInput" v-model="query" type="search" maxlength="120" placeholder="搜索用户" :disabled="listBusy || busy || !!pending" /></label><button class="button btn" :disabled="listBusy || busy || !!pending"><Search :size="16" aria-hidden="true" />查找</button></form>
        <p v-if="listError" class="form-error" role="alert">{{ listError }} <button class="text-link" :disabled="listBusy" @click="loadUsers(!!users.length)">重试</button></p>
        <p v-if="listBusy" class="form-note" role="status">正在读取用户…</p>
        <ul v-if="users.length" class="chance-user-list"><li v-for="person in users" :key="person.id"><button class="chance-user" :class="{ selected: selected?.id === person.id }" :aria-pressed="selected?.id === person.id" :disabled="busy || !!pending" @click="choose(person)"><span class="chance-avatar" aria-hidden="true"><img v-if="person.avatarUrl && !brokenImages.has(person.id)" :src="person.avatarUrl" alt="" @error="brokenImages.add(person.id)" /><span v-else>{{ (person.name || person.username || person.id).slice(0, 1) }}</span></span><span class="chance-user-text"><strong>{{ person.name || person.username }}</strong><span>@{{ person.username }} · ID {{ person.id }}</span></span><component :is="selected?.id === person.id ? Check : ChevronRight" :size="16" aria-hidden="true" /></button></li></ul>
        <div v-else-if="!listBusy && !listError" class="chance-empty"><Users :size="28" aria-hidden="true" /><h3>未找到用户</h3><p>试试名称、用户名、社区 ID 或统一账号 ID。</p></div>
        <div v-if="users.length" class="directory-footer"><span class="caption-5">已显示 {{ users.length }} 位用户</span><button v-if="cursor" class="button subtle btn" :disabled="listBusy || busy || !!pending" @click="loadUsers(true)">加载更多</button></div>
      </section>
      <section class="chances-detail" aria-label="用户次数详情">
        <template v-if="selected">
          <div class="detail-toolbar"><button class="button subtle btn change-user" :disabled="busy || !!pending" @click="choose(null)"><ArrowLeft :size="16" aria-hidden="true" />更换用户</button><button class="button subtle btn" :disabled="busy || accountBusy || !!pending" @click="loadAccount"><RefreshCw :size="16" aria-hidden="true" />刷新次数</button></div>
          <div class="chance-identity"><h3 ref="detailHeading" tabindex="-1">{{ selected.name }}</h3><p class="form-note"><span v-if="selected.username">@{{ selected.username }} · </span>社区 ID {{ selected.id }}</p></div>
          <p v-if="accountBusy" class="form-note" role="status">正在读取可用次数…</p>
          <p v-if="accountError" class="form-error" role="alert">{{ accountError }} <button class="text-link" :disabled="accountBusy || busy" @click="loadAccount">重新读取</button></p>
          <dl class="chance-balance"><dt>当前可用次数</dt><dd><strong>{{ pending ? '待核对' : account ? format(account.balance) : '—' }}</strong><span v-if="account && !pending">次</span></dd></dl>
          <template v-if="pending"><div class="notice-inline" role="status"><p>上次调整结果尚未确认。请先核对，避免重复增加次数。</p><p>原次数 {{ format(pending.expectedBalance) }} → 目标 {{ format(pending.mode === 'add' ? pending.expectedBalance + pending.amount : pending.amount) }} 次</p><p v-if="pending.reason">原因：{{ pending.reason }}</p></div><button class="button primary btn" :disabled="busy" @click="adjust">{{ busy ? '正在核对…' : '核对上次调整' }}</button></template>
          <form v-else-if="account && !accountBusy" class="chance-adjustment" @submit.prevent="openConfirmation">
            <fieldset class="fieldset stack" :disabled="busy"><legend>调整次数</legend><div class="chance-fields"><label class="field"><span>调整方式</span><select class="control" v-model="mode"><option value="add">增加次数</option><option value="set">设置为指定次数</option></select></label><label class="field"><span>{{ mode === 'add' ? '增加次数' : '目标次数' }}</span><input class="control" v-model.number="amount" type="number" :min="mode === 'add' ? 1 : 0" max="2147483647" step="1" required inputmode="numeric" /></label></div><label class="field"><span>操作原因 <span class="caption-5">（选填）</span></span><textarea class="control" v-model="reason" rows="2" maxlength="300" placeholder="例如：活动补发或次数修正" /></label><p v-if="mode === 'set'" class="form-note">将现有次数替换为目标值，填 0 会清空可用次数。</p><div class="chance-preview" aria-live="polite"><span>调整后可用</span><strong>{{ nextBalance === null ? '—' : format(nextBalance) }}<small v-if="nextBalance !== null"> 次</small></strong></div><p v-if="nextBalance === null" class="form-error">请输入有效整数，调整后最多为 2,147,483,647 次。</p><button class="button primary btn" :disabled="busy || nextBalance === null || nextBalance === account.balance">确认调整次数</button></fieldset>
          </form>
          <p v-if="error" class="form-error" role="alert">{{ error }}</p><p v-if="success" class="chance-success" role="status">{{ success }}</p>
          <p class="form-note detail-note">次数变更会记录到操作审计。活动参与条件仍按现有规则生效。</p>
        </template>
        <div v-else class="chance-empty"><Ticket :size="32" aria-hidden="true" /><h3>选择用户后查看次数</h3><p>可用次数、调整预览与操作会在这里显示。</p></div>
      </section>
    </div>
    <dialog ref="dialog" class="compact-dialog" aria-labelledby="chance-confirm-title" @cancel.prevent="closeConfirmation"><div class="dialog-heading"><h2 id="chance-confirm-title">确认调整抽奖次数</h2><button class="icon-button" aria-label="取消次数调整" :disabled="busy" @click="closeConfirmation"><X :size="20" aria-hidden="true" /></button></div><div v-if="confirmation" class="dialog-body stack"><p>{{ selected?.name }} · ID {{ confirmation.userId }}</p><p class="confirmation-balance">{{ format(confirmation.expectedBalance) }} 次 <ArrowRight :size="20" aria-hidden="true" /> {{ format(confirmation.mode === 'add' ? confirmation.expectedBalance + confirmation.amount : confirmation.amount) }} 次</p><p v-if="confirmation.reason">原因：{{ confirmation.reason }}</p><p v-if="confirmation.mode === 'set' && confirmation.amount < confirmation.expectedBalance" class="form-note">本次操作将减少用户的可用次数，请核对目标值。</p><div class="table-actions"><button class="button subtle btn" :disabled="busy" autofocus @click="closeConfirmation">取消</button><button class="button primary btn" :disabled="busy" @click="adjust">{{ busy ? '正在提交…' : '确认提交' }}</button></div></div></dialog>
  </section>
</template>

<style scoped>
.fieldset { border: 0; padding: 0; margin: 0; min-width: 0; }
.fieldset.stack { gap: 20px; }
.chances-heading { align-items: flex-start; gap: 16px; flex-wrap: wrap; margin-bottom: 24px; }
.chances-heading h2 { font-size: 20px; line-height: 28px; }
.chances-heading p { margin-top: 8px; }
.chances-workspace { display: grid; grid-template-columns: minmax(260px, 0.9fr) minmax(0, 1.1fr); border: 1px solid var(--border); border-radius: 12px; overflow: hidden; }
.chances-directory, .chances-detail { min-width: 0; padding: 24px; }
.chances-directory { border-right: 1px solid var(--border); }
.directory-heading, .directory-footer, .detail-toolbar { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px; }
.directory-heading h3, .chance-adjustment legend { font-size: 16px; line-height: 24px; font-weight: 600; }
.chance-search { display: flex; gap: 8px; align-items: end; margin-block: 20px; }
.chance-search .field { min-width: 0; flex: 1; }
.chance-user-list { list-style: none; padding: 0; margin: 0; }
.chance-user { display: flex; align-items: center; width: 100%; gap: 12px; min-height: 76px; padding: 14px 12px; border: 0; border-bottom: 1px solid var(--border); background: transparent; color: var(--ink); text-align: left; cursor: pointer; }
.chance-user:hover, .chance-user.selected { background: var(--surface-soft); }
.chance-user.selected > svg { color: var(--blue); }
.chance-user:disabled { cursor: default; }
.chance-user > svg, .chance-avatar { flex-shrink: 0; }
.chance-avatar { display: grid; place-items: center; width: 40px; height: 40px; border-radius: 50%; overflow: hidden; background: var(--surface-soft); font-size: 18px; }
.chance-avatar img { width: 100%; height: 100%; object-fit: cover; }
.chance-user-text { flex: 1; min-width: 0; display: grid; gap: 4px; }
.chance-user-text strong, .chance-user-text > span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.chance-user-text > span { font-size: 12px; line-height: 20px; color: var(--muted); }
.directory-footer { margin-top: 20px; }
.chances-detail { background: var(--surface); }
.detail-toolbar { justify-content: flex-end; margin-bottom: 20px; }
.change-user { display: none; }
.chance-identity h3 { font-size: 20px; line-height: 28px; overflow-wrap: anywhere; }
.chance-identity p { margin-top: 4px; overflow-wrap: anywhere; }
.chance-balance { display: flex; align-items: baseline; justify-content: space-between; gap: 16px; padding-block: 24px; margin: 0 0 24px; border-bottom: 1px solid var(--border); }
.chance-balance dt { color: var(--muted); }
.chance-balance dd { display: flex; gap: 8px; align-items: baseline; margin: 0; font-variant-numeric: tabular-nums; }
.chance-balance strong { font-size: 28px; line-height: 1.2; font-weight: 600; overflow-wrap: anywhere; }
.chance-adjustment legend { padding-bottom: 16px; }
.chance-fields { display: grid; grid-template-columns: 1.2fr 1fr; gap: 16px; }
.chance-preview { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; padding: 16px 0; border-block: 1px solid var(--border); }
.chance-preview strong { font-size: 24px; line-height: 32px; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.chance-preview small { font-size: 14px; font-weight: 400; }
.chance-adjustment .button { align-self: flex-start; }
.detail-note, .chances-detail > .form-error, .chance-success { margin-top: 20px; }
.chance-success { color: var(--green); }
.chance-empty { display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; gap: 12px; padding: 48px 16px; min-height: 240px; }
.chance-empty > svg, .chance-empty p { color: var(--muted); }
.chance-empty h3 { font-size: 16px; line-height: 24px; }
.chance-empty p { font-size: 14px; line-height: 24px; }
.chances-detail > .notice-inline { margin-bottom: 16px; overflow-wrap: anywhere; }
.confirmation-balance { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; font-size: 20px; font-variant-numeric: tabular-nums; }
.dialog-body > p { overflow-wrap: anywhere; }
@media (max-width: 1000px) {
  .chances-workspace { grid-template-columns: 1fr; }
  .chances-directory { border-right: 0; }
  .chances-detail { display: none; }
  .has-selection .chances-directory { display: none; }
  .has-selection .chances-detail { display: block; }
  .change-user { display: inline-flex; }
  .detail-toolbar { justify-content: space-between; }
}
@media (max-width: 639px) {
  .chances-directory, .chances-detail { padding: 16px; }
  .chance-fields { grid-template-columns: 1fr; }
  .chance-adjustment .button { width: 100%; }
  .chance-search { flex-wrap: wrap; }
  .chance-search .field { flex-basis: 100%; }
  .chance-search > .button { width: 100%; }
  .chance-balance { flex-wrap: wrap; }
  .chance-balance strong { font-size: 28px; }
}
</style>
