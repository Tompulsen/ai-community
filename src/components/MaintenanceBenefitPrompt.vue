<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { Gift, X } from '@lucide/vue'
import type { MaintenanceBenefit, MaintenanceClaim, MaintenanceOffer } from '../../shared/maintenance-benefits'
import { api, errorMessage, session } from '../state'
import { refreshAccountBalance } from '../account-balance'

const route = useRoute(), dialog = ref<HTMLDialogElement>(), closeButton = ref<HTMLButtonElement>()
const benefit = ref<MaintenanceBenefit | null>(null), result = ref<MaintenanceClaim | null>(null), busy = ref(false), error = ref('')
const identity = () => `${session.user?.id || ''}:${session.user?.accountId || ''}`
const safe = () => !!session.user && !session.restoring && document.visibilityState !== 'hidden'
  && !/^\/(?:admin|account|create)(?:\/|$)/.test(route.path) && !route.query.publish
let active = true, mounted = false, revision = 0, nextRead = 0, loading = false
let timer: ReturnType<typeof setTimeout> | undefined, controller: AbortController | undefined, opener: HTMLElement | null = null
function schedule(delay = 60000) { clearTimeout(timer); if (active) timer = setTimeout(() => { void load() }, delay) }
function close() {
  revision++; controller?.abort(); loading = false; busy.value = false
  nextRead = Date.now() + Math.max(60000, (benefit.value?.popupIntervalMinutes ?? 5) * 60000)
  dialog.value?.close(); benefit.value = null; result.value = null; error.value = ''
  if (opener?.isConnected && opener.getClientRects().length) opener.focus({ preventScroll: true })
  opener = null; schedule()
}
async function present(request: number) {
  if (!active || request !== revision || !safe() || !benefit.value) return
  await nextTick()
  if (document.querySelector('dialog[open], [role="dialog"][aria-modal="true"]')) { clearTimeout(timer); timer = setTimeout(() => { void present(request) }, 1500); return }
  if (!active || request !== revision || !safe()) return
  opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
  dialog.value?.showModal(); closeButton.value?.focus()
}
async function load() {
  if (!mounted || !active || loading || dialog.value?.open || !safe() || Date.now() < nextRead) { schedule(); return }
  if (document.querySelector('dialog[open], [role="dialog"][aria-modal="true"]')) { schedule(3000); return }
  const owner = identity(), request = ++revision, account = session.user!.id
  controller?.abort(); controller = new AbortController(); const abort = controller
  const timeout = setTimeout(() => abort.abort(), 12000)
  const current = () => active && request === revision && owner === identity() && safe() && !abort.signal.aborted
  loading = true; nextRead = Date.now() + 60000
  try {
    const found = await api<MaintenanceOffer>('/api/maintenance-benefit', { signal: abort.signal, expectedAccount: account })
    if (!current() || !found.benefit || found.claim) return
    if (document.querySelector('dialog[open], [role="dialog"][aria-modal="true"]')) return
    const shown = await api<MaintenanceOffer>('/api/maintenance-benefit/display', { method: 'POST', body: { id: found.benefit.id, version: found.benefit.version }, signal: abort.signal, expectedAccount: account })
    if (!current() || !shown.benefit || shown.claim) return
    benefit.value = shown.benefit; result.value = null; error.value = ''; void present(request)
  } catch { /* An optional benefit must never prevent opening or using the community. */ }
  finally { clearTimeout(timeout); if (request === revision) { loading = false; if (!benefit.value) schedule() } }
}
async function claim(refresh = false) {
  if (!benefit.value || busy.value || !session.user) return
  const owner = identity(), request = revision, id = benefit.value.id
  busy.value = true; error.value = ''; controller?.abort(); controller = new AbortController()
  const abort = controller, timeout = setTimeout(() => abort.abort(), 12000)
  try {
    const data = await api<{ claim: MaintenanceClaim | null }>(refresh ? `/api/maintenance-benefit?id=${encodeURIComponent(id)}` : '/api/maintenance-benefit/claim', {
      ...(refresh ? {} : { method: 'POST' as const, body: { id, version: benefit.value.version } }), signal: abort.signal, expectedAccount: session.user.id,
    })
    if (!active || request !== revision || owner !== identity() || abort.signal.aborted) return
    if (!data.claim) throw new Error('领取记录暂未确认，请重试核对。')
    result.value = data.claim
    if (data.claim.status === 'fulfilled') void refreshAccountBalance(true)
  } catch (cause) { if (active && request === revision && owner === identity()) error.value = abort.signal.aborted ? '请求超时，可以重试核对，不会重复发放。' : errorMessage(cause) }
  finally { clearTimeout(timeout); if (request === revision) busy.value = false }
}
function reset() { close(); nextRead = 0; schedule(1500) }
function resume() { if (safe() && !dialog.value?.open) void load() }
watch(identity, reset, { flush: 'sync' })
watch(() => route.fullPath, reset)
onMounted(() => { mounted = true; schedule(1800); window.addEventListener('focus', resume); document.addEventListener('visibilitychange', resume) })
onBeforeUnmount(() => { active = false; close(); clearTimeout(timer); window.removeEventListener('focus', resume); document.removeEventListener('visibilitychange', resume) })
</script>

<template>
  <Teleport to="body"><dialog ref="dialog" class="maintenance-prompt" aria-labelledby="maintenance-prompt-title" @cancel.prevent="close">
    <header><span><Gift :size="20" aria-hidden="true" />维护福利</span><button ref="closeButton" type="button" class="icon-button" aria-label="关闭维护福利" @click="close"><X :size="20" aria-hidden="true" /></button></header>
    <div v-if="benefit" class="maintenance-body"><h2 id="maintenance-prompt-title">{{ benefit.title }}</h2><p class="maintenance-content">{{ benefit.content }}</p>
      <p class="maintenance-amount">+{{ result?.credits ?? benefit.credits }} <span>限时福利积分</span></p>
      <p class="muted">到账后 {{ result?.rewardValidityDays ?? benefit.rewardValidityDays }} 天有效 · 每个账号每期领取一次</p>
      <p v-if="result" role="status">{{ result.status === 'fulfilled' ? '领取成功，福利积分已到账。' : result.status === 'blocked' ? '领取记录已保存，到账状态需要管理员核对，请勿重复领取。' : '领取记录已保存，积分正在发放，无需重复领取。' }}</p>
      <p v-if="result?.expiresAt" class="muted">有效至 {{ new Date(result.expiresAt * 1000).toLocaleString('zh-CN') }}</p>
      <p v-if="result"><RouterLink to="/activities?tab=records" class="text-link" @click="close">查看维护福利领取记录</RouterLink></p>
      <p v-if="error" class="form-error" role="alert">{{ error }}</p>
      <footer><button v-if="!result" class="button primary" :disabled="busy" @click="claim()">{{ busy ? '正在领取…' : '领取福利积分' }}</button><button v-else-if="result.status !== 'fulfilled'" class="button" :disabled="busy" @click="claim(true)">{{ busy ? '正在核对…' : '刷新到账状态' }}</button><button class="button" @click="close">{{ result ? '我知道了' : '稍后再说' }}</button></footer>
    </div>
  </dialog></Teleport>
</template>

<style scoped>
.maintenance-prompt { box-sizing: border-box; width: min(520px,calc(100vw - 32px)); max-height: calc(100dvh - 32px); overflow: auto; padding: 0; border: 1px solid var(--border); border-radius: 16px; background: var(--canvas); color: var(--ink); }.maintenance-prompt::backdrop { background: #0008; }.maintenance-prompt header { display: flex; align-items: center; justify-content: space-between; padding: 12px 16px 0 24px; }.maintenance-prompt header span { display: flex; align-items: center; gap: 8px; color: var(--muted); }.maintenance-body { padding: 8px 24px 24px; }.maintenance-body h2 { margin: 0 0 16px; font-size: 24px; overflow-wrap: anywhere; }.maintenance-content { white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.8; }.maintenance-amount { font-size: 32px; font-weight: 700; margin-block: 24px 8px; }.maintenance-amount span { font-size: 16px; font-weight: 500; }.maintenance-prompt .muted { line-height: 1.7; font-size: 14px; }.maintenance-prompt footer { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 24px; }.maintenance-prompt button { min-width: 44px; min-height: 44px; }.maintenance-prompt :focus-visible { outline: 2px solid var(--focus-ring); outline-offset: 2px; }
</style>
