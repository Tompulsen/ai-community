<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { ArrowRight, CalendarCheck, Gift, X } from '@lucide/vue'
import type { WelfareStatus } from '../../shared/welfare-points'
import { api, session } from '../state'

const route = useRoute(), dialog = ref<HTMLDialogElement>(), closeButton = ref<HTMLButtonElement>()
const welfare = ref<WelfareStatus | null>(null)
const identity = () => `${session.user?.id || ''}:${session.user?.accountId || session.user?.id || ''}`
const safeRoute = () => !/^\/(?:account|admin|create|activities)(?:\/|$)/.test(route.path) && !route.query.publish
const storageKey = () => `community:welfare-reminder:${identity()}`
const availableCheckin = computed(() => welfare.value?.checkin.enabled && !welfare.value.checkin.claimed
  && (welfare.value.pool?.remaining ?? 0) >= welfare.value.checkin.minPoints)
const availableLottery = computed(() => welfare.value?.lottery.enabled && !welfare.value.lottery.participated && welfare.value.lottery.maxPoints !== null)
let active = true, revision = 0, mounted = false, lastRead = 0, expires = 0
let controller: AbortController | undefined, timer: ReturnType<typeof setTimeout> | undefined, opener: HTMLElement | null = null
const seen = new Map<string, string>()
const viewed = (date: string) => { if (seen.get(storageKey()) === date) return true; try { return localStorage.getItem(storageKey()) === date } catch { return false } }
function close() {
  clearTimeout(timer); dialog.value?.close()
  if (opener?.isConnected && opener.getClientRects().length) opener.focus({ preventScroll: true })
  opener = null
}
async function present(request: number) {
  if (!active || request !== revision || !safeRoute() || document.visibilityState === 'hidden') return
  if (Date.now() >= expires) { void load(); return }
  const date = welfare.value?.pool?.date
  if (!date || viewed(date) || !welfare.value?.pool?.ready || (!availableCheckin.value && !availableLottery.value)) return
  await nextTick()
  if (!active || request !== revision || !safeRoute()) return
  if (document.querySelector('dialog[open], [role="dialog"][aria-modal="true"]')) { timer = setTimeout(() => { void present(request) }, 1500); return }
  opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
  dialog.value?.showModal(); closeButton.value?.focus()
  seen.set(storageKey(), date)
  try { localStorage.setItem(storageKey(), date) } catch { /* The in-memory date still prevents duplicate prompts during this visit. */ }
}
async function load() {
  if (!mounted || !active || !session.user || !safeRoute() || document.visibilityState === 'hidden') return
  if (Date.now() < expires && Date.now() - lastRead < 30000) { if (!dialog.value?.open) void present(revision); return }
  const request = ++revision, owner = identity()
  controller?.abort(); controller = new AbortController()
  const abort = controller, timeout = setTimeout(() => abort.abort(), 12000)
  lastRead = Date.now()
  try {
    const data = await api<WelfareStatus>('/api/lottery/welfare', { signal: abort.signal, expectedAccount: session.user.id })
    if (!active || request !== revision || identity() !== owner || abort.signal.aborted) return
    welfare.value = data
    expires = data.pool ? Date.now() + Math.max(0, Date.parse(data.pool.resetsAt) - Date.parse(data.pool.serverTime)) : 0
    if (data.pool && expires > Date.now()) timer = setTimeout(() => { void present(request) }, 1200)
  } catch { /* The invitation must never block normal community use. */ }
  finally { clearTimeout(timeout) }
}
function reset() { revision++; controller?.abort(); clearTimeout(timer); close(); welfare.value = null; lastRead = 0; expires = 0; void load() }
function resume() { if (!dialog.value?.open) void load() }
watch(identity, reset, { flush: 'sync' })
watch(() => route.fullPath, () => { revision++; controller?.abort(); clearTimeout(timer); close(); if (safeRoute()) { lastRead = 0; void load() } })
onMounted(() => { mounted = true; void load(); window.addEventListener('focus', resume); document.addEventListener('visibilitychange', resume) })
onBeforeUnmount(() => { active = false; revision++; controller?.abort(); close(); window.removeEventListener('focus', resume); document.removeEventListener('visibilitychange', resume) })
</script>

<template>
  <Teleport to="body">
    <dialog ref="dialog" class="welfare-reminder" aria-labelledby="welfare-reminder-title" @cancel.prevent="close">
      <header><span class="reminder-eyebrow">今天的社区福利</span><button ref="closeButton" class="icon-button" type="button" aria-label="关闭福利提醒" @click="close"><X :size="20" aria-hidden="true" /></button></header>
      <div class="reminder-content"><h2 id="welfare-reminder-title">新的一天，来领积分</h2><p class="reminder-intro">每日福利已刷新，签到与创作都有收获。</p>
        <div v-if="availableCheckin && welfare" class="reminder-reward"><CalendarCheck :size="23" aria-hidden="true" /><div><h3>每日签到</h3><p><strong>{{ welfare.checkin.minPoints.toLocaleString('zh-CN') }}–{{ welfare.checkin.maxPoints.toLocaleString('zh-CN') }}</strong> 福利积分</p><small>随机领取 · 到账后 24 小时有效</small></div></div>
        <div v-if="availableLottery && welfare" class="reminder-reward"><Gift :size="23" aria-hidden="true" /><div><h3>活动抽奖</h3><p><strong>{{ welfare.lottery.minPoints?.toLocaleString('zh-CN') }}–{{ welfare.lottery.maxPoints?.toLocaleString('zh-CN') }}</strong> 福利积分</p><small>完成任务可得抽奖机会，参与须满足活动条件</small></div></div>
        <p v-if="welfare?.pool" class="reminder-pool">今日全站还剩 <strong>{{ welfare.pool.remaining.toLocaleString('zh-CN') }}</strong> 积分 · 签到与抽奖共享</p>
      </div>
      <footer><RouterLink to="/activities" class="button primary btn" @click="close">前往福利中心<ArrowRight :size="17" aria-hidden="true" /></RouterLink><button type="button" class="button subtle btn" @click="close">稍后再说</button><small>每天北京时间 00:00 重置 · 今日不再提醒</small></footer>
    </dialog>
  </Teleport>
</template>

<style scoped>
.welfare-reminder { box-sizing: border-box; width: min(460px, calc(100vw - 32px)); max-height: calc(100dvh - 32px); padding: 0; border: 1px solid var(--border); border-radius: 16px; background: var(--canvas); color: var(--ink); overflow: auto; }
.welfare-reminder::backdrop { background: #0008; }
.welfare-reminder header { display: flex; justify-content: space-between; align-items: center; padding: 12px 16px 0 24px; }
.reminder-eyebrow { color: var(--muted); font-size: 13px; }
.welfare-reminder button { min-width: 44px; min-height: 44px; }
.reminder-content { padding: 4px 24px 20px; }
.reminder-content h2 { font-size: 24px; line-height: 1.4; margin: 0 0 8px; }
.reminder-intro { color: var(--muted); margin: 0 0 24px; line-height: 1.6; }
.reminder-reward { display: flex; gap: 14px; padding: 18px 0; border-top: 1px solid var(--border); }
.reminder-reward > svg { flex: none; margin-top: 2px; color: var(--accent); }
.reminder-reward h3 { margin: 0 0 6px; font-size: 15px; }
.reminder-reward p { margin: 0 0 4px; line-height: 1.6; }
.reminder-reward strong { font-size: 24px; font-variant-numeric: tabular-nums; }
.reminder-reward small, .reminder-pool, footer small { font-size: 12px; line-height: 1.6; color: var(--muted); }
.reminder-pool { margin: 12px 0 0; }
.welfare-reminder footer { padding: 0 24px 24px; display: grid; gap: 8px; text-align: center; }
.welfare-reminder footer a { min-height: 44px; justify-content: center; }
@media (max-width: 360px) { .reminder-content { padding-inline: 18px; }.welfare-reminder footer { padding-inline: 18px; }.reminder-reward strong { font-size: 21px; } }
</style>
