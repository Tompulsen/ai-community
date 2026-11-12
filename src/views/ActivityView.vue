<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-FileCopyrightText: 2026 Community contributors
SPDX-License-Identifier: AGPL-3.0-only
-->
<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ArrowUpRight, Gift, Link2, Ticket, Users, Heart, Copy, RefreshCw } from '@lucide/vue'
import { api, errorMessage, loadSession, notify, queryString, session } from '../state'

interface Rule { enabled: boolean; threshold: number; tickets: number }
interface Prize { id: string; name: string; description: string; amountCents: number; kind: 'balance' | 'empty'; weight: number; stock: number; enabled: boolean }
interface Award { prizeId: string; name: string; description: string; amountCents: number; status: 'pending' | 'fulfilled' | 'empty'; note?: string }
interface Draw { id: string; createdAt: string; prizes: Award[] }
interface PendingDraw { requestId: string; count: 1 | 3 | 5 }
interface LotteryStatus {
  settings: { enabled: boolean; prizes: Prize[]; invites: Rule; followers: Rule; likes: Rule; likesMode: string; wheel: { theme: 'teal' | 'violet' | 'sunset'; title: string; subtitle: string; buttonText: string; rulesText: string } }
  balance: number; counts: { invites: number; followers: number; likes: number; bestWorkLikes: number }
  earned: { invites: number; followers: number; likes: number }; accountLinked: boolean; creditReady: boolean; inviteUrl: string
}
const tab = ref('draw')
const tabs = [{ id: 'draw', label: '抽奖' }, { id: 'tasks', label: '任务与邀请' }, { id: 'records', label: '奖励记录' }]
const status = ref<LotteryStatus | null>(null), records = ref<Draw[]>([]), nextCursor = ref<string | null>(null), result = ref<Draw | null>(null)
const loading = ref(true), drawing = ref(false), recordsLoading = ref(false), error = ref('')
const count = ref<1 | 3 | 5>(1), pending = ref<PendingDraw | null>(null), wheelRotation = ref(0)
const drawCounts = [1, 3, 5] as const
const drawStorageKey = computed(() => `ai-community-next:lottery-draw:${session.user?.id}`)
const rules = computed(() => status.value ? [
  { key: 'invites' as const, label: '邀请朋友', icon: Users, rule: status.value.settings.invites, count: status.value.counts.invites },
  { key: 'followers' as const, label: '收获关注', icon: Users, rule: status.value.settings.followers, count: status.value.counts.followers },
  { key: 'likes' as const, label: status.value.settings.likesMode === 'work' ? '单件作品获赞' : '作品累计获赞', icon: Heart, rule: status.value.settings.likes, count: status.value.settings.likesMode === 'work' ? status.value.counts.bestWorkLikes : status.value.counts.likes },
].filter(item => item.rule.enabled) : [])
const awardLabels = { pending: '待发放', fulfilled: '已到账', empty: '未中奖' }
const appearance = computed(() => status.value?.settings.wheel ?? { theme: 'teal', title: '', subtitle: '', buttonText: 'GO', rulesText: '' })
const availablePrizes = computed(() => status.value?.settings.prizes.filter(prize => prize.enabled && prize.weight > 0 && prize.stock !== 0) || [])
const totalWeight = computed(() => availablePrizes.value.reduce((sum, prize) => sum + prize.weight, 0))
const drawDisabled = computed(() => drawing.value || loading.value || (!pending.value && (!status.value?.settings.enabled || !status.value.accountLinked || !status.value.creditReady || status.value.balance < count.value || !availablePrizes.value.length)))
const wheelSlots = computed(() => {
  const prizes = [...(status.value?.settings.prizes || [])]
  const winner = result.value?.prizes.at(-1)
  if (winner && !prizes.some(prize => prize.id === winner.prizeId)) prizes.push({ id: winner.prizeId, name: winner.name, description: winner.description, amountCents: winner.amountCents, enabled: true, kind: winner.status === 'empty' ? 'empty' : 'balance', weight: 0, stock: -1 })
  if (!prizes.length) return Array.from({ length: 4 }, (_, i) => ({ id: `placeholder-${i}`, name: '待配置' }))
  return prizes.length >= 4 ? prizes : Array.from({ length: prizes.length * Math.ceil(4 / prizes.length) }, (_, i) => prizes[i % prizes.length]!)
})
const wheelSegments = computed(() => wheelSlots.value.map((prize, index, slots) => {
  const angle = 360 / slots.length
  const point = (degree: number, radius: number) => ({ x: 200 + Math.cos(degree * Math.PI / 180) * radius, y: 200 + Math.sin(degree * Math.PI / 180) * radius })
  const center = -90 + index * angle
  const start = point(center - angle / 2, 184), end = point(center + angle / 2, 184), label = point(center, 128)
  return { ...prize, index, path: `M200 200 L${start.x} ${start.y} A184 184 0 ${angle > 180 ? 1 : 0} 1 ${end.x} ${end.y} Z`, label, rotate: center + 90 }
}))
function drawMessage(cause: unknown) {
  const value = errorMessage(cause)
  return ({ LOTTERY_INSUFFICIENT: '抽奖次数不足。', LOTTERY_ACCOUNT_REQUIRED: '请先连接章鱼账号。', LOTTERY_UNAVAILABLE: '活动或奖励发放暂不可用。', LOTTERY_INVALID: '本次抽奖参数无效，请重新参与。', LOTTERY_CONFLICT: '本次抽奖凭证与原请求不一致，请刷新后核对。', LOTTERY_FORBIDDEN: '当前账号暂不能参与活动。' } as Record<string, string>)[value] || value
}
async function loadRecords(append = false) {
  if (!session.user || recordsLoading.value) return
  recordsLoading.value = true
  try {
    const data = await api<{ items: Draw[]; nextCursor: string | null }>(`/api/lottery/records${queryString({ cursor: append ? nextCursor.value || undefined : undefined })}`)
    records.value = append ? [...records.value, ...data.items] : data.items
    nextCursor.value = data.nextCursor
  } finally { recordsLoading.value = false }
}
function restorePending() {
  if (!session.user) return
  try {
    const value: unknown = JSON.parse(sessionStorage.getItem(drawStorageKey.value) || 'null')
    if (value && typeof value === 'object' && 'requestId' in value && typeof value.requestId === 'string' && /^[a-zA-Z0-9_-]{16,64}$/.test(value.requestId) && 'count' in value && drawCounts.includes(value.count as 1 | 3 | 5)) {
      pending.value = value as PendingDraw; count.value = pending.value.count
    }
  } catch { /* Ignore invalid local state without issuing a new draw. */ }
}
async function load() {
  loading.value = true; error.value = ''
  await loadSession()
  try { status.value = await api<LotteryStatus>('/api/lottery/status'); restorePending(); await loadRecords() }
  catch (cause) { error.value = drawMessage(cause) }
  finally { loading.value = false }
}
onMounted(() => { void load() })
async function draw() {
  if (!session.user || drawDisabled.value) return
  const storageKey = drawStorageKey.value
  if (!pending.value) {
    const value: PendingDraw = { requestId: crypto.randomUUID(), count: count.value }
    try { sessionStorage.setItem(storageKey, JSON.stringify(value)) }
    catch { error.value = '浏览器无法保存抽奖凭证，请允许站点存储后重试。'; return }
    pending.value = value
  }
  drawing.value = true; error.value = ''
  let receipt: Draw
  try { receipt = await api<Draw>('/api/lottery/draw', { method: 'POST', body: pending.value }) }
  catch (cause) {
    const code = errorMessage(cause)
    if (['LOTTERY_INSUFFICIENT', 'LOTTERY_ACCOUNT_REQUIRED', 'LOTTERY_UNAVAILABLE', 'LOTTERY_INVALID', 'LOTTERY_FORBIDDEN', 'LOTTERY_CONFLICT'].includes(code)) {
      pending.value = null
      try { sessionStorage.removeItem(storageKey) } catch { /* Keep the same safe request if local cleanup is unavailable. */ }
    }
    error.value = drawMessage(cause); drawing.value = false; return
  }
  result.value = receipt; pending.value = null
  try { sessionStorage.removeItem(storageKey) } catch { /* Retrying a confirmed receipt cannot consume another chance. */ }
  const winner = receipt.prizes.at(-1)
  const index = wheelSlots.value.findIndex(prize => prize.id === winner?.prizeId)
  if (index >= 0) {
    const target = (360 - index * 360 / wheelSlots.value.length) % 360
    wheelRotation.value += 1440 + (target - wheelRotation.value % 360 + 360) % 360
  }
  notify('抽奖结果已记录。')
  try { status.value = await api<LotteryStatus>('/api/lottery/status'); await loadRecords() }
  catch (cause) { error.value = `抽奖已完成，账户信息刷新失败：${drawMessage(cause)}` }
  finally { drawing.value = false }
}
async function copyInvite() {
  try { await navigator.clipboard.writeText(status.value?.inviteUrl || ''); notify('邀请链接已复制。') }
  catch { notify('复制失败，请手动选择链接。') }
}
</script>

<template>
  <div class="page-container activity-page">
    <div class="page-heading"><h1>活动</h1><button class="icon-button" aria-label="刷新活动" title="刷新活动" :disabled="loading || drawing" @click="load"><RefreshCw :size="18" /></button></div>
    <div class="tabs" aria-label="活动分类"><button v-for="item in tabs" :key="item.id" class="tab" :class="{ active: tab === item.id }" :aria-pressed="tab === item.id" @click="tab = item.id">{{ item.label }}</button></div>
    <p v-if="error" class="notice-inline" role="alert">{{ error }}</p>
    <div v-if="loading" class="activity-loading" role="status" aria-label="正在加载活动"><div class="skeleton" /><div class="skeleton" /></div>
    <template v-else-if="status">
      <div v-if="tab === 'draw'" class="activity-layout lottery-layout">
        <section class="panel-section draw-section">
          <div class="section-heading"><h2>{{ appearance.title || '幸运抽奖' }}</h2><Ticket :size="20" /></div><p v-if="appearance.subtitle" class="muted">{{ appearance.subtitle }}</p>
          <div class="lottery-wheel" :class="`theme-${appearance.theme}`" data-testid="lottery-wheel">
            <svg viewBox="0 0 400 400" aria-hidden="true"><circle cx="200" cy="200" r="195" class="wheel-rim" /><g class="wheel-disc" :style="{ transform: `rotate(${wheelRotation}deg)` }"><g v-for="segment in wheelSegments" :key="`${segment.id}-${segment.index}`"><path :d="segment.path" :class="segment.index % 2 ? 'wheel-alternate' : 'wheel-sector'" /><text :x="segment.label.x" :y="segment.label.y" :transform="`rotate(${segment.rotate},${segment.label.x},${segment.label.y})`" text-anchor="middle" dominant-baseline="middle">{{ wheelSegments.length > 12 ? segment.index + 1 : segment.name.length > 6 ? `${segment.name.slice(0, 5)}…` : segment.name }}</text></g></g></svg>
            <span class="wheel-pointer" aria-hidden="true" />
            <button v-if="session.user" class="wheel-center" :disabled="drawDisabled" :aria-label="pending ? '核对上次抽奖结果' : `抽奖 ${count} 次`" :aria-busy="drawing" @click="draw">{{ drawing ? '确认中' : pending ? '核对' : appearance.buttonText || 'GO' }}</button><RouterLink v-else to="/account" class="wheel-center">登录</RouterLink>
          </div>
          <p class="caption-5 wheel-caption">扇区仅展示奖项，中奖概率以奖池为准。</p>
          <div class="draw-controls"><p>可用 <strong>{{ status.balance }}</strong> 次</p><div class="view-switch" role="group" aria-label="本次抽奖次数"><button v-for="n in drawCounts" :key="n" class="button subtle btn" :class="{ selected: count === n }" :aria-pressed="count === n" :disabled="drawing || !!pending" @click="count = n">{{ n }} 次</button></div></div>
          <button v-if="session.user" class="button primary btn" :disabled="drawDisabled" @click="draw"><Gift :size="17" />{{ drawing ? '正在确认结果…' : pending ? '核对上次抽奖' : `抽奖 ${count} 次` }}</button><RouterLink v-else to="/account" class="button primary btn">登录后参与</RouterLink>
          <p v-if="pending && !drawing" class="form-note">上次结果尚未确认，再次核对会使用同一凭证。</p><p v-if="!status.settings.enabled" class="form-note">活动暂未开放。</p><p v-else-if="!status.creditReady" class="form-note">奖励发放服务暂不可用。</p><RouterLink v-else-if="!status.accountLinked && session.user" to="/account?tab=balance" class="text-link">连接章鱼账号</RouterLink><p v-else-if="status.balance < count && session.user && !pending" class="form-note">本次需要 {{ count }} 次机会，当前次数不足。</p>
          <div v-if="result" class="notice-inline draw-result" role="status"><div v-for="(award, index) in result.prizes" :key="index"><strong>{{ index + 1 }}. {{ award.name }}</strong><p class="caption-5">{{ awardLabels[award.status] }}<span v-if="award.amountCents"> · ${{ (award.amountCents / 100).toFixed(2) }}</span></p></div><button class="text-link" @click="tab = 'records'">查看奖励记录<ArrowUpRight :size="15" /></button></div>
          <p v-if="appearance.rulesText" class="activity-rules">{{ appearance.rulesText }}</p>
        </section>
        <section class="panel-section prize-section"><div class="section-heading"><h2>奖池</h2><Gift :size="18" /></div><div class="prize-list"><div v-for="prize in status.settings.prizes" :key="prize.id" class="prize-item"><span class="avatar" :class="prize.kind === 'empty' ? 'rose' : 'green'"><Gift :size="18" /></span><div><strong>{{ prize.name }}</strong><p class="caption-5">{{ prize.description }}<span v-if="prize.amountCents"> · ${{ (prize.amountCents / 100).toFixed(2) }}</span></p><p class="caption-5">当前概率 {{ prize.stock !== 0 && totalWeight ? (prize.weight / totalWeight * 100).toFixed(2) : '0.00' }}% · {{ prize.stock === -1 ? '库存不限' : prize.stock === 0 ? '已抽完' : `剩余 ${prize.stock} 份` }}</p></div></div><p v-if="!status.settings.prizes.length" class="muted">暂无可用奖项</p></div></section>
        <section class="panel-section chances-section"><div class="section-heading"><h2>获得抽奖机会</h2><Ticket :size="18" /></div><div v-for="item in rules" :key="item.key" class="reward-item"><div><strong>{{ item.label }}</strong><p class="caption-5">每 {{ item.rule.threshold }} 个获得 {{ item.rule.tickets }} 次机会</p></div><span>{{ item.count }} 个</span></div></section>
        <section class="panel-section account-section"><div class="section-heading"><h2>奖励账户</h2><Link2 :size="18" /></div><dl class="info-list"><div><dt>章鱼账号</dt><dd>{{ status.accountLinked ? '已连接' : '未连接' }}</dd></div><div><dt>发放服务</dt><dd>{{ status.creditReady ? '可用' : '不可用' }}</dd></div></dl><RouterLink to="/account?tab=balance" class="button subtle btn">账户与余额<ArrowUpRight :size="15" /></RouterLink></section>
      </div>
      <div v-else-if="tab === 'tasks'" class="activity-layout"><section class="panel-section"><h2>活动任务</h2><div v-for="item in rules" :key="item.key" class="reward-item"><component :is="item.icon" :size="18" /><div><strong>{{ item.label }}</strong><p class="caption-5">每 {{ item.rule.threshold }} 个获得 {{ item.rule.tickets }} 次</p></div><span>{{ item.count }} 个</span></div><p v-if="!rules.length" class="muted">当前没有开放的任务。</p></section><section class="panel-section"><h2>邀请朋友</h2><dl class="info-list"><div><dt>有效邀请</dt><dd>{{ status.counts.invites }}</dd></div><div><dt>已获得机会</dt><dd>{{ status.earned.invites }}</dd></div></dl><template v-if="session.user && status.inviteUrl"><p class="invite-url">{{ status.inviteUrl }}</p><button class="button btn" @click="copyInvite"><Copy :size="16" />复制邀请链接</button></template><RouterLink v-else to="/account" class="button btn">登录</RouterLink></section></div>
      <section v-else class="panel-section"><div class="section-heading"><h2>奖励记录</h2><button class="button subtle btn" :disabled="recordsLoading" @click="loadRecords().catch(cause => error = drawMessage(cause))"><RefreshCw :size="15" />刷新</button></div><div v-if="records.length" class="table-wrap"><table class="data-table"><thead><tr><th scope="col">时间</th><th scope="col">奖励</th><th scope="col">金额</th><th scope="col">状态</th></tr></thead><tbody><template v-for="record in records" :key="record.id"><tr v-for="(award, index) in record.prizes" :key="`${record.id}:${index}`"><td>{{ new Date(record.createdAt).toLocaleString('zh-CN') }}</td><td>{{ award.name }}</td><td>{{ award.amountCents ? `$${(award.amountCents / 100).toFixed(2)}` : '--' }}</td><td><span class="status" :class="{ pending: award.status === 'pending' }">{{ awardLabels[award.status] }}</span></td></tr></template></tbody></table></div><div v-else class="empty-state"><Gift :size="28" /><h2>{{ session.user ? '暂无奖励记录' : '登录后查看奖励记录' }}</h2><RouterLink v-if="!session.user" to="/account" class="button btn">登录</RouterLink></div><button v-if="nextCursor" class="button btn" :disabled="recordsLoading" @click="loadRecords(true).catch(cause => error = drawMessage(cause))">加载更多</button></section>
    </template>
  </div>
</template>

<style scoped>
.activity-page { max-width: 1360px; }
.activity-page > .tabs { margin-bottom: 16px; }
.lottery-layout { grid-template-columns: minmax(0, 2fr) minmax(0, 1fr); gap: 16px; align-items: start; }
.lottery-layout > .panel-section { padding: 16px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); }
.lottery-layout > .panel-section > .section-heading { margin-bottom: 16px; }
.lottery-layout > .panel-section > .section-heading h2 { font-size: 16px; line-height: 24px; }
.draw-section { min-width: 0; min-height: 480px; display: grid; grid-template-columns: minmax(0, 1.1fr) minmax(176px, 1fr); align-items: start; align-content: start; align-self: stretch; column-gap: 24px; row-gap: 16px; grid-column: 1; grid-row: 1 / span 3; }
.draw-section > :not(.lottery-wheel) { grid-column: 2; }
.lottery-layout > .draw-section > .section-heading { margin: 0; }
.lottery-layout > .draw-section > .section-heading h2 { font-size: 20px; line-height: 28px; }
.draw-section > .button { width: fit-content; min-width: 176px; margin-top: 0; }
.draw-section > .form-note { margin-top: 0; }
.prize-section { grid-column: 2; grid-row: 1; }
.chances-section { grid-column: 2; grid-row: 2; }
.account-section { grid-column: 2; grid-row: 3; }
.lottery-wheel { --wheel-accent: var(--blue); --wheel-light: color-mix(in srgb, var(--blue) 16%, var(--surface)); --wheel-alternate: var(--surface); --wheel-ink: var(--ink); grid-column: 1; grid-row: 1 / span 8; align-self: center; justify-self: center; width: min(100%, 340px); aspect-ratio: 1; margin: 0; position: relative; }
.theme-violet { --wheel-accent: #bdabef; --wheel-light: color-mix(in srgb, #bdabef 20%, var(--surface)); --wheel-alternate: color-mix(in srgb, #bdabef 6%, var(--surface)); }
.theme-sunset { --wheel-accent: #edb17e; --wheel-light: color-mix(in srgb, #edb17e 20%, var(--surface)); --wheel-alternate: color-mix(in srgb, #e8c78f 6%, var(--surface)); }
.lottery-wheel svg { width: 100%; height: 100%; display: block; }
.wheel-rim { fill: var(--wheel-accent); }
.wheel-sector { fill: var(--wheel-light); stroke: var(--wheel-accent); stroke-width: 1; }
.wheel-alternate { fill: var(--wheel-alternate); stroke: var(--wheel-accent); stroke-width: 1; }
.wheel-disc { transform-origin: 200px 200px; transition: transform 1600ms cubic-bezier(.22, 1, .36, 1); }
.lottery-wheel text { fill: var(--wheel-ink); font-size: 14px; font-weight: 500; }
.wheel-pointer { position: absolute; left: calc(50% - 12px); top: -4px; border-left: 12px solid transparent; border-right: 12px solid transparent; border-top: 24px solid var(--wheel-accent); }
.wheel-center { position: absolute; inset: 37%; border-radius: 50%; background: var(--wheel-accent); color: var(--action-ink); display: flex; align-items: center; justify-content: center; padding: 8px; font-weight: 600; font-size: 16px; text-align: center; overflow-wrap: anywhere; border: 4px solid var(--canvas); }
.wheel-center:disabled { opacity: .72; color: var(--action-ink); cursor: default; }
.wheel-center:not(:disabled):hover { filter: brightness(1.1); }
.wheel-center:focus-visible { outline-color: var(--blue); outline-offset: 4px; }
.wheel-caption { text-align: left; color: var(--muted); font-size: 13px; line-height: 20px; }
.draw-controls { display: flex; align-items: center; flex-wrap: wrap; justify-content: space-between; gap: 16px; margin-block: 8px; }
.draw-controls > p { color: var(--muted); }
.draw-controls strong { font-variant-numeric: tabular-nums; font-size: 24px; color: var(--ink); margin-inline: 4px; font-weight: 500; }
.draw-controls .view-switch { padding: 4px; background: var(--canvas); border-color: var(--border); }
.view-switch .button { min-height: 40px; padding: 8px 16px; border-radius: 4px; }
.view-switch .selected { background: var(--blue-soft); color: var(--blue); }
.draw-result { margin: 8px 0 0; display: grid; gap: 16px; padding: 0 0 0 12px; background: transparent; border: 0; border-left: 2px solid var(--blue); border-radius: 0; color: var(--ink); }
.draw-result > div { display: flex; justify-content: space-between; align-items: baseline; flex-wrap: wrap; gap: 8px; }
.draw-result .caption-5 { font-variant-numeric: tabular-nums; }
.activity-rules { margin-top: 8px; padding-top: 16px; border-top: 1px solid var(--border); white-space: pre-wrap; overflow-wrap: anywhere; color: var(--muted); font-size: 14px; line-height: 24px; }
.prize-list { display: grid; gap: 0; }
.prize-item { display: flex; align-items: start; gap: 12px; min-width: 0; padding: 16px 0; border-bottom: 1px solid var(--border); }
.prize-item:first-child { padding-top: 0; }
.prize-item:last-child { border-bottom: 0; }
.prize-item .avatar { width: 32px; height: 32px; flex-shrink: 0; border-radius: 4px; }
.prize-item > div { min-width: 0; overflow-wrap: anywhere; }
.prize-item p { margin-top: 4px; overflow-wrap: anywhere; font-size: 13px; line-height: 20px; }
.activity-page .reward-item { justify-content: space-between; align-items: flex-start; gap: 16px; margin: 0; padding: 16px 0; border-bottom: 1px solid var(--border); }
.activity-page .reward-item:last-of-type { border-bottom: 0; }
.activity-page .reward-item > span { flex-shrink: 0; color: var(--blue); font-variant-numeric: tabular-nums; }
.activity-page .data-table { font-variant-numeric: tabular-nums; }
.activity-loading { display: grid; grid-template-columns: 2fr 1fr; gap: 16px; }
.activity-loading .skeleton { height: 400px; border-radius: 8px; }
@media (max-width: 899px) {
  .lottery-layout, .activity-loading { grid-template-columns: minmax(0, 1fr); }
  .draw-section { grid-template-columns: minmax(208px, 280px) minmax(0, 1fr); column-gap: 24px; min-height: 0; }
  .lottery-layout > .panel-section { grid-column: auto; grid-row: auto; }
}
@media (max-width: 639px) {
  .lottery-layout > .panel-section { padding: 16px; }
  .draw-section { display: flex; flex-direction: column; gap: 16px; }
  .draw-section > .section-heading { width: 100%; }
  .lottery-wheel { width: min(100%, 280px); align-self: center; order: 1; }
  .wheel-caption { order: 2; }
  .draw-controls { width: 100%; order: 3; margin-block: 0; }
  .draw-section > .button { width: 100%; order: 4; }
  .draw-section > .form-note, .draw-section > .text-link { order: 5; }
  .draw-result { width: 100%; order: 6; }
  .activity-rules { order: 7; }
  .view-switch .button { padding-inline: 12px; }
}
@media (prefers-reduced-motion: reduce) { .wheel-disc { transition: none; } }
</style>
