<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-FileCopyrightText: 2026 Community contributors
SPDX-License-Identifier: AGPL-3.0-only
-->
<script setup lang="ts">
import { computed, defineAsyncComponent, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue'
import { Gift, RefreshCw } from '@lucide/vue'
import '../welfare-tokens.css'
import { api, errorMessage, loadSession, queryString, session } from '../state'
import WelfareTasks from '../components/WelfareTasks.vue'
import WelfareCheckin from '../components/WelfareCheckin.vue'
import type { WelfareStatus } from '../../shared/welfare-points'
import LotteryFeedbackDialog, { type LotteryAward as Award, type LotteryDraw as Draw, type LotteryNotice } from '../components/LotteryFeedbackDialog.vue'
import { isClownPrize } from '../../shared/lottery-public'
import { refreshLotteryBalance, updateLotteryBalance } from '../lottery-balance'
import { useRoute } from 'vue-router'
import { formatPoints } from '../../shared/studio/community-wallet'

interface Rule { enabled: boolean; threshold: number; tickets: number }
interface Prize { id: string; name: string; description: string; amountCents: number; kind: 'balance' | 'empty'; weight: number; stock: number; enabled: boolean; dailyQuota?: number }
interface PendingDraw { requestId: string; count: 1 | 3 | 5 }
interface LotteryStatus {
  welfare?: WelfareStatus | null
  settings: { enabled: boolean; minSupportCnyFen: number; rewardValidityHours?: number; prizes: Prize[]; invites: Rule; followers: Rule; likes: Rule; likesMode: string; wheel: { theme: 'teal' | 'violet' | 'sunset'; title: string; subtitle: string; buttonText: string; rulesText: string } }
  balance: number; counts: { invites: number; followers: number; likes: number; bestWorkLikes: number }
  earned: { invites: number; followers: number; likes: number }; accountLinked: boolean; creditReady: boolean; inviteUrl: string
  daily?: { date: string; timezone: string; resetsAt: string; limit: number; used: number; remaining: number; participated: boolean } | null
  support: { checked: boolean; eligible: boolean; amountCnyFen: number | null }
}
const route = useRoute()
const LotteryPublicResults = defineAsyncComponent(() => import('../components/LotteryPublicResults.vue'))
const wheelId = `lottery-${useId()}`
const tab = ref(route.query.invite || route.query.aff || route.query.tab === 'tasks' ? 'tasks' : ['records', 'leaderboard'].includes(String(route.query.tab)) ? String(route.query.tab) : 'draw')
const leaderboardOpened = ref(false)
const tasks = ref<InstanceType<typeof WelfareTasks>>()
const publicResults = ref<InstanceType<typeof LotteryPublicResults>>()
const tabs = [{ id: 'draw', label: '活动抽奖' }, { id: 'tasks', label: '任务与邀请' }, { id: 'records', label: '奖励记录' }, { id: 'leaderboard', label: '排行榜' }]
const status = ref<LotteryStatus | null>(null), records = ref<Draw[]>([]), nextCursor = ref<string | null>(null), result = ref<Draw | null>(null)
const loading = ref(false), drawing = ref(false), recordsLoading = ref(false), recordsLoaded = ref(false), error = ref('')
const recordsError = ref('')
const refreshLabel = computed(() => tab.value === 'leaderboard' ? '刷新排行榜' : tab.value === 'records' ? '刷新奖励记录' : '刷新活动')
const refreshing = computed(() => tab.value === 'leaderboard' ? publicResults.value?.loading : tab.value === 'records' ? recordsLoading.value : loading.value || drawing.value)
const statusFailed = ref(false)
const feedback = ref<'result' | 'blocked' | null>(null)
const serverNotice = ref<LotteryNotice | null>(null)
const identity = () => `${session.user?.id || ''}:${session.user?.accountId || session.user?.id || ''}`
const pointDisplay = ref<{ currencySymbol?: string; pointsPerUsd?: number }>()
function rewardAmount(value: Prize | Award) {
  const charity = !('status' in value) || value.rewardKind === 'charity'
  if ('status' in value && value.status === 'fulfilled' && charity) return value.points
    ? `${formatPoints(value.points)} 福利积分` : '福利积分，数额待核对'
  if ('rewardPoints' in value && value.rewardPoints) return `${formatPoints(String(value.rewardPoints))} 福利积分`
  if (pointDisplay.value?.currencySymbol !== '积分') return pointDisplay.value ? `$${(value.amountCents / 100).toFixed(2)}` : '积分待核对'
  if ('status' in value && value.status === 'fulfilled') return value.legacyPoints
    ? `${formatPoints(value.legacyPoints)} 积分` : '积分数额待核对'
  const rate = pointDisplay.value.pointsPerUsd
  return rate && Number.isFinite(rate) && rate > 0
    ? `${status.value?.daily ? '' : '约 '}${(value.amountCents / 100 * rate).toLocaleString('zh-CN', { maximumFractionDigits: 6 })} ${charity ? '福利积分' : '积分'}` : '积分待核对'
}
function validityLabel(hours: number) {
  return hours % 24 === 0 ? `${hours / 24} 天` : `${hours} 小时`
}
function rewardExpiry(award: Award) {
  if (award.status === 'pending') return `首次到账后 ${validityLabel(award.validityHours ?? 168)}有效`
  if (!award.expiresAt) return '有效期待核对'
  const seconds = Math.max(0, Math.ceil((award.expiresAt * 1000 - currentTime.value) / 1000))
  if (!seconds) return '已到期'
  const clock = [Math.floor(seconds % 86400 / 3600), Math.floor(seconds % 3600 / 60), seconds % 60].map(value => String(value).padStart(2, '0')).join(':')
  return `剩余 ${seconds >= 86400 ? `${Math.floor(seconds / 86400)}天 ` : ''}${clock}`
}
const count = ref<1 | 3 | 5>(1), pending = ref<PendingDraw | null>(null), wheelRotation = ref(0)
const allDrawCounts = [1, 3, 5] as const
const drawCounts = computed(() => status.value?.daily ? [1] as const : allDrawCounts)
const drawStorageKey = computed(() => `ai-community-next:lottery-draw:${session.user?.id}`)
const awardLabels = { pending: '待发放', fulfilled: '已到账', empty: '未中奖' }
const appearance = computed(() => status.value?.settings.wheel ?? { theme: 'teal', title: '', subtitle: '', buttonText: 'GO', rulesText: '' })
const drawTitle = computed(() => !appearance.value.title || appearance.value.title === '每日幸运转盘' ? '活动抽奖' : appearance.value.title)
const currentTime = ref(Date.now())
let clockOffset = 0
const resetAt = computed(() => Date.parse(status.value?.welfare?.pool?.resetsAt ?? status.value?.daily?.resetsAt ?? ''))
const supportChecked = computed(() => status.value?.support?.checked === true)
const supportEligible = computed(() => supportChecked.value && status.value?.support.eligible === true)
const participationStatus = computed(() => {
  const value = status.value
  if (!session.user) return '登录后参与'
  if (pending.value) return '上次结果尚未确认，请核对原抽奖'
  if (statusFailed.value) return '参与状态更新失败，请刷新后重试'
  if (!value?.settings.enabled) return '活动暂未开放'
  if (!value.accountLinked) return '请先连接章鱼账号'
  if (value.welfare?.pool && !value.welfare.pool.ready) return '今日福利积分正在核对，请稍后再来'
  if (value.welfare?.pool && !value.welfare.pool.remaining) return '今日福利积分已领完，北京时间次日 00:00 重置'
  if (value.daily?.participated) return '今日已参与，下次北京时间 00:00 统一重置'
  if (value.daily && !value.daily.remaining) return '今日名额已领完，下次北京时间 00:00 统一重置'
  if (!availablePrizes.value.length) return '奖池暂无可用奖项'
  if (!supportChecked.value) return '累计支持暂无法核验'
  if (!supportEligible.value) return '累计支持未满足参与条件'
  if (!value.creditReady) return '奖励发放服务暂不可用'
  if (value.balance < count.value) return '完成任务获取抽奖次数'
  return '可以参与'
})
const supportRequirement = computed(() => {
  const minimum = status.value?.settings.minSupportCnyFen ?? 0
  return `累计支持 ${minimum ? '≥' : '>'} ¥${(minimum / 100).toFixed(2)}`
})
const supportAmount = computed(() => {
  if (!supportChecked.value) return '待核验'
  const amount = status.value?.support.amountCnyFen
  if (typeof amount !== 'number' || !Number.isSafeInteger(amount) || amount < 0) return '待核验'
  if (amount === 0 && supportEligible.value && !status.value?.settings.minSupportCnyFen) return '小于 ¥0.01'
  return `¥${(amount / 100).toFixed(2)}`
})
const availablePrizes = computed(() => status.value?.settings.prizes.filter(prize => prize.enabled && prize.weight > 0 && prize.stock !== 0) || [])
const totalWeight = computed(() => availablePrizes.value.reduce((sum, prize) => sum + prize.weight, 0))
const drawDisabled = computed(() => drawing.value || loading.value)
const drawBlocker = computed<LotteryNotice | null>(() => {
  if (pending.value) return null
  const value = status.value
  const unavailable: LotteryNotice = { title: '暂时无法参与抽奖', message: participationStatus.value, action: 'refresh' }
  if (statusFailed.value || !value?.settings.enabled) return unavailable
  if (!value.accountLinked) return { title: '请先连接章鱼账号', message: '连接账号后可核验参与资格，并将中奖积分发放至你的积分账户。', action: 'account' }
  if (value.welfare?.pool && !value.welfare.pool.ready) return unavailable
  if (value.welfare?.pool && (!value.welfare.pool.remaining || !availablePrizes.value.some(prize => prize.kind === 'balance'))) return {
    title: value.welfare.pool.remaining ? '今日福利积分不足' : '今日福利积分已领完',
    message: `今日剩余 ${value.welfare.pool.remaining.toLocaleString('zh-CN')} 积分，暂时无法发放本次抽奖奖励。签到与抽奖共用每日额度，请在重置后再来。`, resetsAt: value.welfare.pool.resetsAt,
  }
  if (value.daily && Number.isFinite(resetAt.value) && currentTime.value >= resetAt.value) return {
    title: '请更新今日参与资格', message: '已到北京时间的每日重置时间，请重新核验今日资格与剩余名额。', action: 'refresh',
  }
  if (value.daily && (value.daily.participated || !value.daily.remaining)) return {
    title: value.daily.participated ? '今日已完成抽奖' : '今日名额已领完',
    message: value.daily.participated ? '每人每天限抽 1 次，今天已经参与。请在下次开放后再来试试手气。' : '今日奖池名额已经领完，新的每日名额开放后可再来参与。',
    resetsAt: value.daily.resetsAt,
  }
  if (!availablePrizes.value.length || !supportChecked.value) return unavailable
  if (!supportEligible.value) {
    const minimum = value.settings.minSupportCnyFen, amount = value.support.amountCnyFen
    return {
      title: '解锁长期抽奖福利',
      message: minimum ? `累计支持社区满 ¥${(minimum / 100).toFixed(2)}，即可满足抽奖的支持条件。` : '支持社区任意正金额，即可满足抽奖的支持条件。',
      supportAmount: supportAmount.value,
      shortfall: typeof amount === 'number' && Number.isSafeInteger(amount) && amount >= 0 && minimum > amount ? `¥${((minimum - amount) / 100).toFixed(2)}` : undefined,
      action: 'support',
    }
  }
  if (!value.creditReady) return unavailable
  if (value.balance < count.value) return { title: '抽奖机会不足', message: `本次需要 ${count.value} 次抽奖机会，完成任务或邀请朋友即可获取。`, action: 'tasks' }
  return null
})
const feedbackNotice = computed<LotteryNotice>(() => drawBlocker.value || serverNotice.value || {
  title: '已满足参与条件', message: '参与资格已更新，关闭提示后点击抽奖即可参与。',
})
async function refreshFeedback() { serverNotice.value = null; await load() }
function feedbackTab(value: string) { feedback.value = null; tab.value = value }
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
  const start = point(center - angle / 2, 160), end = point(center + angle / 2, 160)
  const labelRadius = slots.length > 4 ? 124 : 118
  const labelStart = point(center - angle * .36, labelRadius), labelEnd = point(center + angle * .36, labelRadius)
  const clown = isClownPrize(prize.name)
  const name = Array.from(prize.name), maxLength = slots.length <= 4 ? 6 : slots.length <= 8 ? 4 : 2
  const labelName = clown ? '🤡' : slots.length > 12 ? index + 1 : name.length > maxLength ? `${name.slice(0, maxLength).join('')}…` : prize.name
  const labelWidth = Math.min(100, labelRadius * angle * .72 * Math.PI / 180 * .85)
  const textLength = typeof labelName === 'string' && Array.from(labelName).length * (slots.length > 4 ? 16 : 24) > labelWidth ? labelWidth : undefined
  return { ...prize, index, labelName, textLength, clown, path: `M200 200 L${start.x} ${start.y} A160 160 0 ${angle > 180 ? 1 : 0} 1 ${end.x} ${end.y} Z`, labelPath: `M${labelStart.x} ${labelStart.y} A${labelRadius} ${labelRadius} 0 0 1 ${labelEnd.x} ${labelEnd.y}` }
}))
function drawMessage(cause: unknown) {
  const value = errorMessage(cause)
  if (value === 'WELFARE_POOL_EXHAUSTED') return '今日剩余福利积分不足以发放本次奖励，北京时间次日 00:00 重置后再来。'
  if (value === 'WELFARE_UNAVAILABLE') return '今日福利额度或发放服务正在核对，请稍后刷新。'
  return ({ LOTTERY_DAILY_USED: '今天已参与，下次北京时间 00:00 统一重置。', LOTTERY_DAILY_SINGLE: '每日福利每人每天限抽 1 次。', LOTTERY_DAILY_EXHAUSTED: '今日名额已领完，北京时间 00:00 后再来。', LOTTERY_INSUFFICIENT: '抽奖次数不足。', LOTTERY_ACCOUNT_REQUIRED: '请先连接章鱼账号。', LOTTERY_SUPPORT_REQUIRED: '累计支持未满足参与条件，请刷新后查看。', LOTTERY_SUPPORT_UNAVAILABLE: '累计支持暂时无法核验，请使用原凭证重新核对。', LOTTERY_UNAVAILABLE: '活动或奖励发放暂不可用。', LOTTERY_INVALID: '本次抽奖参数无效，请重新参与。', LOTTERY_CONFLICT: '本次抽奖凭证与原请求不一致，请刷新后核对。', LOTTERY_FORBIDDEN: '当前账号暂不能参与活动。' } as Record<string, string>)[value] || value
}
async function loadRecords(append = false) {
  if (!session.user || recordsLoading.value) return
  const owner = identity(), request = ++recordsRequest
  const current = () => active && request === recordsRequest && identity() === owner
  recordsLoading.value = true
  try {
    const data = await api<{ items: Draw[]; nextCursor: string | null }>(`/api/lottery/records${queryString({ cursor: append ? nextCursor.value || undefined : undefined })}`)
    if (!current()) return
    records.value = append ? [...records.value, ...data.items] : data.items
    recordsLoaded.value = true
    const updated = result.value && data.items.find(item => item.id === result.value!.id)
    if (updated) result.value = updated
    nextCursor.value = data.nextCursor
    scheduleReset()
  } finally { if (current()) recordsLoading.value = false }
}
function restorePending() {
  if (!session.user) return
  try {
    const value: unknown = JSON.parse(sessionStorage.getItem(drawStorageKey.value) || 'null')
    if (value && typeof value === 'object' && 'requestId' in value && typeof value.requestId === 'string' && /^[a-zA-Z0-9_-]{16,64}$/.test(value.requestId) && 'count' in value && allDrawCounts.includes(value.count as 1 | 3 | 5)) {
      pending.value = value as PendingDraw; count.value = pending.value.count
    }
  } catch { /* Ignore invalid local state without issuing a new draw. */ }
}
async function load() {
  if (!active) return
  const request = ++statusRequest
  loading.value = true; error.value = ''
  await loadSession()
  if (!active || request !== statusRequest) return
  const owner = identity()
  const current = () => active && request === statusRequest && owner === identity()
  try {
    if (!pointDisplay.value) void loadPointDisplay()
    const lottery = await api<LotteryStatus>('/api/lottery/status')
    if (!current()) return
    status.value = lottery; statusFailed.value = false; if (lottery.daily) count.value = 1
    const serverTime = Date.parse(lottery.welfare?.pool?.serverTime ?? '')
    clockOffset = Number.isFinite(serverTime) ? serverTime - Date.now() : 0
    if (session.user) updateLotteryBalance(session.user.id, lottery.balance)
    restorePending(); scheduleReset()
  }
  catch (cause) { if (current()) { statusFailed.value = true; error.value = drawMessage(cause) } }
  finally { if (current()) loading.value = false }
}
async function loadPointDisplay() {
  const owner = identity()
  try {
    const value = await api<{ success: boolean; data: { currencySymbol?: string; pointsPerUsd?: number } }>('/api/new-api/status')
    if (active && owner === identity() && value.success && typeof value.data?.currencySymbol === 'string') pointDisplay.value = value.data
  } catch { /* Prize amounts stay unverified when conversion settings are unavailable. */ }
}
function readRecords(append = false) {
  if (!session.user || recordsLoading.value) return
  const owner = identity(), request = recordsRequest + 1
  recordsError.value = ''
  void loadRecords(append).catch(cause => {
    if (active && owner === identity() && request === recordsRequest) recordsError.value = `奖励记录读取失败：${drawMessage(cause)}`
  })
}
function loadTab() {
  if (tab.value === 'leaderboard') {
    void loadSession().then(() => { if (active && tab.value === 'leaderboard') leaderboardOpened.value = true })
    return
  }
  if (tab.value === 'records') {
    void loadSession().then(() => {
      if (!active || tab.value !== 'records') return
      if (!pointDisplay.value) void loadPointDisplay()
      if (!recordsLoaded.value) readRecords()
    })
  } else if (!status.value && !loading.value) void load()
  else updateActivityClock()
}
function refresh() {
  if (tab.value === 'leaderboard') { void publicResults.value?.refresh(); return }
  if (tab.value === 'records') { readRecords(); return }
  void load()
  if (tab.value === 'tasks') void tasks.value?.refresh()
}
let active = true, lastResetAttempt = 0, statusRequest = 0, recordsRequest = 0, drawRevision = 0
watch(tab, loadTab)
watch(identity, () => { drawRevision++; feedback.value = null; serverNotice.value = null; statusRequest++; status.value = null; loading.value = false; drawing.value = false; statusFailed.value = false; error.value = ''; pointDisplay.value = undefined; records.value = []; recordsRequest++; recordsLoading.value = false; recordsLoaded.value = false; recordsError.value = ''; nextCursor.value = null; result.value = null; pending.value = null; loadTab() }, { flush: 'sync' })
let resetTimer: ReturnType<typeof setInterval> | undefined
function updateActivityClock() {
  if (!active || document.visibilityState === 'hidden') return
  currentTime.value = Date.now() + clockOffset
  if (Number.isFinite(resetAt.value) && currentTime.value >= resetAt.value + 1000
    && (tab.value === 'draw' || tab.value === 'tasks') && !loading.value && !drawing.value && currentTime.value - lastResetAttempt >= 15000) {
    lastResetAttempt = currentTime.value
    void load()
  }
}
function scheduleReset() {
  clearInterval(resetTimer)
  currentTime.value = Date.now() + clockOffset
  if (active && (Number.isFinite(resetAt.value) || records.value.some(record => record.prizes.some(award => award.expiresAt))
    || result.value?.prizes.some(award => award.expiresAt))) resetTimer = setInterval(updateActivityClock, 1000)
}
onMounted(() => {
  document.addEventListener('visibilitychange', updateActivityClock)
  window.addEventListener('focus', updateActivityClock)
  loadTab()
})
onBeforeUnmount(() => {
  active = false; drawRevision++
  clearInterval(resetTimer)
  document.removeEventListener('visibilitychange', updateActivityClock)
  window.removeEventListener('focus', updateActivityClock)
})
async function draw() {
  if (!session.user || drawDisabled.value) return
  const owner = identity(), request = ++drawRevision
  const current = () => active && owner === identity() && request === drawRevision
  serverNotice.value = null
  if (!pending.value && Number.isFinite(resetAt.value) && Date.now() + clockOffset >= resetAt.value) {
    await load()
    if (current()) feedback.value = 'blocked'
    return
  }
  if (drawBlocker.value) { feedback.value = 'blocked'; return }
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
    if (!current()) return
    const code = errorMessage(cause)
    if (['LOTTERY_DAILY_USED', 'LOTTERY_DAILY_SINGLE', 'LOTTERY_DAILY_EXHAUSTED', 'LOTTERY_INSUFFICIENT', 'LOTTERY_ACCOUNT_REQUIRED', 'LOTTERY_SUPPORT_REQUIRED', 'LOTTERY_UNAVAILABLE', 'LOTTERY_INVALID', 'LOTTERY_FORBIDDEN', 'LOTTERY_CONFLICT'].includes(code)) {
      pending.value = null
      try { sessionStorage.removeItem(storageKey) } catch { /* Keep the same safe request if local cleanup is unavailable. */ }
    }
    if (code.startsWith('LOTTERY_DAILY_') || code === 'LOTTERY_SUPPORT_REQUIRED') {
      await load()
    } else void refreshLotteryBalance(true)
    if (!current()) return
    error.value = drawMessage(cause); drawing.value = false
    if (!pending.value) { serverNotice.value = { title: '本次暂未抽奖', message: error.value, action: 'refresh' }; feedback.value = 'blocked' }
    return
  }
  if (!current()) return
  result.value = receipt; pending.value = null; drawing.value = false
  recordsLoaded.value = false; recordsRequest++; recordsLoading.value = false
  scheduleReset()
  try { sessionStorage.removeItem(storageKey) } catch { /* Retrying a confirmed receipt cannot consume another chance. */ }
  const winner = receipt.prizes.at(-1)
  const index = wheelSlots.value.findIndex(prize => prize.id === winner?.prizeId)
  if (index >= 0) {
    const target = (360 - index * 360 / wheelSlots.value.length) % 360
    wheelRotation.value += 1440 + (target - wheelRotation.value % 360 + 360) % 360
  }
  feedback.value = 'result'
  void load()
}

</script>

<template>
  <div class="page-container activity-page">
    <div class="page-heading"><div><h1>福利中心</h1></div><button type="button" class="icon-button" :aria-label="refreshLabel" :title="refreshLabel" :disabled="refreshing" @click="refresh"><RefreshCw :size="18" aria-hidden="true" /></button></div>
    <div class="tabs" aria-label="活动分类"><button v-for="item in tabs" :key="item.id" type="button" class="tab" :class="{ active: tab === item.id }" :aria-pressed="tab === item.id" @click="tab = item.id">{{ item.label }}</button></div>
    <p v-if="error && (tab === 'draw' || tab === 'tasks')" class="notice-inline" role="alert">{{ error }}</p>
    <section v-if="status && (status.daily || status.welfare?.pool) && (tab === 'draw' || tab === 'tasks')" class="daily-overview" aria-label="今日福利">
      <dl><div v-if="status.daily"><dt>今日剩余抽奖名额</dt><dd><strong>{{ status.daily.remaining }}</strong><span> / {{ status.daily.limit }} 名</span></dd></div>
        <div v-if="status.welfare?.pool" class="welfare-pool" aria-live="polite"><dt>今日剩余福利积分</dt><dd><strong>{{ status.welfare.pool.ready ? status.welfare.pool.remaining.toLocaleString('zh-CN') : '核对中' }}</strong><span> / {{ status.welfare.pool.limit.toLocaleString('zh-CN') }}</span></dd><dd>
          <progress v-if="status.welfare.pool.ready" :value="status.welfare.pool.remaining" :max="status.welfare.pool.limit" aria-label="今日剩余福利积分占比" />
          <small>签到与抽奖共用 · 已领取 {{ status.welfare.pool.claimed.toLocaleString('zh-CN') }}<template v-if="status.welfare.pool.reserved">（含 {{ status.welfare.pool.reserved.toLocaleString('zh-CN') }} 待到账预留）</template></small>
          <p v-if="status.welfare.pool.ready && !status.welfare.pool.remaining" class="pool-empty" role="status">今日福利积分已领完，明日 00:00 恢复发放。</p>
        </dd></div></dl>
      <p class="reset-schedule"><strong>每天 00:00 统一重置</strong><span>北京时间 · 所有用户同步</span></p>
    </section>
    <WelfareCheckin v-if="status?.welfare?.pool && (tab === 'draw' || tab === 'tasks')" :welfare="status.welfare" :chances="status.balance" @refresh="load" @records="tab = 'records'" />
    <WelfareTasks v-if="tab === 'tasks'" :key="session.user?.id ?? 'guest'" ref="tasks" :lottery="loading || statusFailed ? null : status" :rules-loading="loading" />
    <div v-else-if="loading && !status && tab === 'draw'" class="activity-loading" role="status" aria-label="正在加载活动"><div class="skeleton" /><div class="skeleton" /></div>
    <template v-else-if="status || tab === 'records'">
      <p v-if="loading && status && tab === 'draw'" class="muted" role="status" aria-label="正在加载活动">正在更新活动…</p>
      <div v-if="tab === 'draw' && status" class="activity-layout lottery-layout">
        <section class="panel-section draw-section" :class="`theme-${appearance.theme}`">
          <div class="draw-console">
          <div class="section-heading"><h2>{{ drawTitle }}</h2></div>
          <section class="participation-conditions" :aria-labelledby="`${wheelId}-conditions`">
            <h3 :id="`${wheelId}-conditions`">参与状态</h3>
            <p role="status">{{ participationStatus }}</p>
            <RouterLink v-if="session.user && !status.accountLinked" to="/account?tab=balance" class="text-link">连接章鱼账号</RouterLink>
            <button v-else-if="session.user && !supportChecked && !pending" type="button" class="text-link" :disabled="loading || drawing" @click="load">重新核验</button>
            <button v-else-if="session.user && supportEligible && status.balance < count && !pending && !status.daily?.participated" type="button" class="text-link" @click="tab = 'tasks'">前往任务与邀请</button>
            <details>
              <summary>参与条件与支持金额</summary>
              <p>{{ supportRequirement }}</p>
              <p v-if="!session.user" class="form-note">登录后查看累计支持及资格</p>
              <p v-else class="support-status"><span>当前累计支持 {{ supportAmount }}</span><strong>{{ !supportChecked ? '暂无法核验' : supportEligible ? '已满足' : '未满足' }}</strong></p>
            </details>
          </section>
          <div class="draw-controls"><p>可用 <strong>{{ status.balance }}</strong> 次</p><div v-if="!status.daily" class="view-switch" role="group" aria-label="本次抽奖次数"><button v-for="n in drawCounts" :key="n" type="button" class="button subtle btn" :class="{ selected: count === n }" :aria-pressed="count === n" :disabled="drawing || !!pending" @click="count = n">{{ n }} 次</button></div></div>
          <button v-if="session.user" type="button" class="button primary btn" :disabled="drawDisabled" :aria-busy="drawing" @click="draw"><Gift :size="17" aria-hidden="true" />{{ drawing ? '正在确认结果…' : pending ? '核对上次抽奖' : status.daily?.participated ? '今日已参与' : status.daily && !status.daily.remaining ? '今日名额已领完' : `抽奖 ${count} 次` }}</button><RouterLink v-else to="/account" class="button primary btn">登录后参与</RouterLink>
          <div v-if="result" class="notice-inline draw-result" role="status"><div v-for="(award, index) in result.prizes" :key="index"><strong>{{ index + 1 }}. {{ award.name }}</strong><p class="caption-5">{{ awardLabels[award.status] }}<span v-if="award.amountCents">，{{ rewardAmount(award) }}</span></p><p v-if="award.rewardKind === 'charity'" class="reward-expiry"><time v-if="award.expiresAt" :datetime="new Date(award.expiresAt * 1000).toISOString()" role="timer" aria-label="奖励到期倒计时" aria-live="off">{{ rewardExpiry(award) }}</time><span v-else>{{ rewardExpiry(award) }}</span></p></div><button type="button" class="text-link" @click="tab = 'records'">查看奖励记录</button></div>
          </div>
          <div class="lottery-wheel" :class="[`theme-${appearance.theme}`, { 'wheel-dense': wheelSegments.length > 4 }]" data-testid="lottery-wheel">
            <svg viewBox="0 0 400 400" aria-hidden="true">
              <defs>
                <linearGradient :id="`${wheelId}-metal`" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0" class="gold-light" /><stop offset=".22" class="gold-shade" /><stop offset=".43" class="gold-light" /><stop offset=".64" class="gold-base" /><stop offset=".82" class="gold-shade" /><stop offset="1" class="gold-light" />
                </linearGradient>
                <linearGradient :id="`${wheelId}-shell`" x1="0" y1="0" x2=".75" y2="1">
                  <stop offset="0" class="enamel-gloss" /><stop offset=".35" class="enamel-base" /><stop offset=".76" class="enamel-deep" /><stop offset="1" class="enamel-base" />
                </linearGradient>
                <linearGradient :id="`${wheelId}-featured`" x1="0" y1="0" x2=".3" y2="1">
                  <stop offset="0" class="action-light" /><stop offset=".55" class="action-base" /><stop offset="1" class="action-deep" />
                </linearGradient>
                <linearGradient :id="`${wheelId}-cool`" x1="0" y1="0" x2=".6" y2="1">
                  <stop offset="0" class="face-light" /><stop offset=".6" class="face-base" /><stop offset="1" class="face-shade" />
                </linearGradient>
                <linearGradient :id="`${wheelId}-warm`" x1="0" y1="0" x2=".6" y2="1">
                  <stop offset="0" class="warm-light" /><stop offset=".6" class="warm-base" /><stop offset="1" class="warm-shade" />
                </linearGradient>
                <radialGradient :id="`${wheelId}-lamp`" cx=".35" cy=".3" r=".75">
                  <stop offset="0" class="lamp-light" /><stop offset=".65" class="gold-light" /><stop offset="1" class="gold-base" />
                </radialGradient>
                <path v-for="segment in wheelSegments" :id="`${wheelId}-label-${segment.index}`" :key="`label-${segment.index}`" :d="segment.labelPath" />
              </defs>
              <circle cx="200" cy="204" r="194" class="wheel-depth" />
              <circle cx="200" cy="200" r="195" :fill="`url(#${wheelId}-metal)`" class="wheel-frame" />
              <circle cx="200" cy="200" r="188" :fill="`url(#${wheelId}-shell)`" class="wheel-rim" />
              <circle cx="200" cy="200" r="166" :fill="`url(#${wheelId}-metal)`" />
              <g class="wheel-lights"><g v-for="bulb in 24" :key="bulb" :transform="`rotate(${bulb * 15},200,200)`"><circle cx="200" cy="19" r="6" class="lamp-socket" /><circle cx="200" cy="19" r="4.5" :fill="`url(#${wheelId}-lamp)`" /></g></g>
              <g class="wheel-disc" :style="{ transform: `rotate(${wheelRotation}deg)` }">
                <g v-for="segment in wheelSegments" :key="`${segment.id}-${segment.index}`" :class="{ 'is-winner': result?.prizes.at(-1)?.prizeId === segment.id, 'wheel-featured': segment.index === 0 }">
                  <path :d="segment.path" :fill="`url(#${wheelId}-${segment.index === 0 ? 'featured' : segment.index % 2 ? 'cool' : 'warm'})`" :class="segment.index % 2 ? 'wheel-alternate' : 'wheel-sector'" />
                  <text class="wheel-label" :class="{ 'clown-label': segment.clown }" text-anchor="middle" dominant-baseline="middle">
                    <textPath class="wheel-name" :href="`#${wheelId}-label-${segment.index}`" startOffset="50%" :textLength="segment.textLength" lengthAdjust="spacingAndGlyphs">{{ segment.labelName }}</textPath>
                  </text>
                </g>
              </g>
              <circle cx="200" cy="200" r="161" class="wheel-inner-rim" />
              <circle cx="200" cy="202" r="63" class="wheel-hub-depth" />
              <circle cx="200" cy="200" r="61" :fill="`url(#${wheelId}-metal)`" class="wheel-hub" />
              <circle cx="200" cy="200" r="54" :fill="`url(#${wheelId}-featured)`" class="wheel-hub-ring" />
              <g class="wheel-pointer"><path d="M200 4 C185 4 178 17 184 29 L200 54 L216 29 C222 17 215 4 200 4 Z" :fill="`url(#${wheelId}-metal)`" /><circle cx="200" cy="20" r="7" /></g>
            </svg>
            <button v-if="session.user" type="button" class="wheel-center" :disabled="drawDisabled" :aria-label="drawing ? '确认中' : pending ? '核对上次抽奖结果' : `${appearance.buttonText || 'GO'}，抽奖 ${count} 次`" :title="appearance.buttonText || 'GO'" :aria-busy="drawing" @click="draw"><Gift :size="20" aria-hidden="true" /><span>{{ drawing ? '确认中' : pending ? '核对' : appearance.buttonText || 'GO' }}</span></button><RouterLink v-else to="/account" class="wheel-center"><Gift :size="20" aria-hidden="true" /><span>登录</span></RouterLink>
          </div>
        </section>
        <section class="panel-section prize-section">
          <div class="section-heading"><h2>{{ status.daily ? '今日奖池' : '奖池' }}</h2></div>
          <p v-if="status.daily" class="pool-caption">每档名额独立，概率随剩余名额实时变化。</p>
          <div class="prize-list">
            <div v-for="prize in status.settings.prizes" :key="prize.id" class="prize-item">
              <span class="prize-icon" aria-hidden="true"><Gift v-if="!isClownPrize(prize.name)" :size="20" /></span>
              <div class="prize-detail"><span v-if="isClownPrize(prize.name)" class="prize-clown" role="img" aria-label="小丑奖">🤡</span><strong v-else>{{ prize.name }}</strong><p v-if="prize.amountCents" class="prize-amount">{{ rewardAmount(prize) }} · {{ validityLabel(status.settings.rewardValidityHours ?? 168) }}有效</p><p v-if="prize.description" class="caption-5">{{ prize.description }}</p></div>
              <div class="prize-availability"><p>当前概率 <strong>{{ prize.stock !== 0 && totalWeight && (!status.daily || status.daily.remaining > 0) ? (prize.weight / totalWeight * 100).toFixed(2) : '0.00' }}%</strong></p><p>{{ status.daily ? `剩余 ${prize.stock} / ${prize.dailyQuota} 名` : prize.stock === -1 ? '库存不限' : prize.stock === 0 ? '已抽完' : `剩余 ${prize.stock} 份` }}</p></div>
            </div>
            <p v-if="!status.settings.prizes.length" class="muted">暂无可用奖项</p>
          </div>
        </section>
      </div>
      <section v-else-if="tab === 'records'" class="panel-section records-section">
        <div class="section-heading"><h2 id="rewards-heading">奖励记录</h2></div>
        <p v-if="recordsError" class="notice-inline" role="alert">{{ recordsError }}</p>
        <p v-if="recordsLoading" class="muted" role="status">正在读取奖励记录…</p>
        <div v-if="records.length" class="table-wrap" tabindex="0" role="region" aria-labelledby="rewards-heading">
          <table class="data-table">
            <thead><tr><th scope="col">时间</th><th scope="col">奖励</th><th scope="col">{{ pointDisplay?.currencySymbol === '积分' ? '折合积分' : '奖励额度' }}</th><th scope="col">状态</th></tr></thead>
            <tbody><template v-for="record in records" :key="record.id"><tr v-for="(award, index) in record.prizes" :key="`${record.id}:${index}`">
              <td data-label="时间">{{ new Date(record.createdAt).toLocaleString('zh-CN') }}</td>
              <td data-label="奖励">{{ award.name }}</td>
              <td :data-label="pointDisplay?.currencySymbol === '积分' ? '折合积分' : '奖励额度'">{{ award.amountCents || award.rewardPoints ? rewardAmount(award) : '--' }}</td>
              <td data-label="状态"><span class="status" :class="{ pending: award.status === 'pending' }">{{ awardLabels[award.status] }}</span><p v-if="award.rewardKind === 'charity'" class="reward-expiry"><time v-if="award.expiresAt" :datetime="new Date(award.expiresAt * 1000).toISOString()" role="timer" aria-label="奖励到期倒计时" aria-live="off">{{ rewardExpiry(award) }}</time><span v-else>{{ rewardExpiry(award) }}</span></p></td>
            </tr></template></tbody>
          </table>
        </div>
        <div v-else-if="!recordsLoading && !recordsError" class="empty-state"><Gift :size="28" aria-hidden="true" /><h2>{{ session.user ? '暂无奖励记录' : '登录后查看奖励记录' }}</h2><RouterLink v-if="!session.user" to="/account" class="button btn">登录</RouterLink></div>
        <button v-if="nextCursor" type="button" class="button btn" :disabled="recordsLoading" @click="readRecords(true)">加载更多</button>
      </section>
    </template>
    <LotteryPublicResults v-if="leaderboardOpened" v-show="tab === 'leaderboard'" ref="publicResults" />
    <LotteryFeedbackDialog v-if="feedback" :draw="feedback === 'result' ? result : null" :notice="feedbackNotice"
      :chances="status?.balance ?? 0" :refreshing="loading" :reward-amount="rewardAmount" :reward-expiry="rewardExpiry"
      @close="feedback = null" @refresh="refreshFeedback" @records="feedbackTab('records')" @tasks="feedbackTab('tasks')" @update="result = $event" />
  </div>
</template>

<style scoped>
/* Hallmark · shape: app screen · genre: modern-minimal · theme: brand · redesign: full · signature: daily wheel and prize ledger · nav: kept · states: loading, empty, error, full · v2.0.0 */
/* Hallmark · pre-emit critique: P4 H4 E4 S4 R5 V4 · weakest: H, put participation before the wheel on narrow screens */
/* Hallmark · dropped "获得抽奖机会" · hide this empty heading only when every task is disabled; enabled rules keep the section */
/* Hallmark · finish-review: subagent · ship · no blocking findings */
.activity-page { max-width: 1360px; }
.activity-page :is(h1, h2, h3) { min-width: 0; overflow-wrap: break-word; text-wrap: balance; }
.activity-page > .page-heading { margin-bottom: var(--space-group); }
.activity-page > .tabs { margin-bottom: 0; gap: var(--space-section); }
.activity-page .tab { min-height: var(--target-size); white-space: nowrap; }
.daily-overview { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--space-group) var(--space-section); padding-block: var(--space-group); border-bottom: 1px solid var(--border); }
.daily-overview dl { display: flex; flex-wrap: wrap; gap: var(--space-group) var(--space-page); margin: 0; }
.daily-overview dl > div + div { padding-inline-start: var(--space-page); border-inline-start: 1px solid var(--border); }
.daily-overview dt { color: var(--muted); font-size: 12px; line-height: 20px; }
.daily-overview dd { margin: var(--space-label) 0 0; font-variant-numeric: tabular-nums; }
.daily-overview strong { font-size: 28px; line-height: 36px; font-weight: 600; }
.daily-overview dd span, .daily-overview p { color: var(--muted); font-size: 12px; line-height: 20px; }
.daily-overview p { margin: 0; }
.welfare-pool { min-width: 0; }
.welfare-pool progress { display: block; width: min(100%, 300px); height: 6px; margin: 10px 0 6px; accent-color: var(--accent); }
.welfare-pool small { display: block; max-width: 420px; color: var(--muted); font-size: 12px; line-height: 1.6; overflow-wrap: anywhere; }
.daily-overview .pool-empty { margin-top: 6px; color: var(--ink); }
@media (max-width: 600px) { .daily-overview dl > .welfare-pool { flex-basis: 100%; padding: 12px 0 0; border-inline: 0; border-top: 1px solid var(--border); } }
.reset-schedule { display: grid; gap: 4px; }
.reset-schedule strong { color: var(--ink); font-size: 14px; line-height: 22px; font-weight: 500; }
.reward-expiry { margin: var(--space-label) 0 0; color: var(--muted); font-size: var(--font-size-help); line-height: var(--line-height-help); font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.lottery-layout { grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr); gap: var(--space-section) var(--space-page); padding-top: var(--space-section); align-items: start; }
.lottery-layout > .panel-section { padding: 0; border: 0; border-radius: 0; background: transparent; }
.lottery-layout > .panel-section > .section-heading { margin-bottom: var(--space-group); }
.lottery-layout h2 { font-size: 18px; line-height: 28px; }
.draw-section { --wheel-shell-gloss: var(--lottery-enamel-gloss); --wheel-shell: var(--lottery-enamel); --wheel-shell-deep: var(--lottery-enamel-deep); --wheel-action-light: var(--lottery-action-light); --wheel-action: var(--lottery-action); --wheel-action-deep: var(--lottery-action-deep); display: grid; grid-template-columns: minmax(0, 1.3fr) minmax(176px, 1fr); align-items: center; gap: var(--space-section); }
.draw-console { display: grid; grid-column: 2; grid-row: 1; justify-items: start; gap: var(--space-group); min-width: 0; }
.draw-console > .section-heading { margin: 0; }
.lottery-layout > .draw-section h2 { font-size: 20px; line-height: 28px; }
.draw-console > .button { min-width: 176px; max-width: 100%; min-height: var(--control-height); margin: 0; padding: var(--space-small) var(--space-group); white-space: nowrap; }
.draw-console > .button.primary, .draw-console > .button.primary:hover:not(:disabled) { min-height: 48px; padding-inline: var(--space-section); border: 2px solid var(--lottery-metal); border-radius: 999px; background: var(--wheel-action); background: linear-gradient(180deg in oklab, var(--wheel-action-light), var(--wheel-action) 55%, var(--wheel-action-deep)); color: var(--lottery-lamp); font-size: 16px; font-weight: 600; box-shadow: inset 0 1px 0 var(--lottery-metal-light), 0 4px 8px var(--lottery-shadow); }
.activity-page .draw-console > .button.primary:not(:disabled):active { background-color: var(--wheel-action-deep); filter: brightness(.94); }
.draw-console > .form-note { margin: 0; min-height: 1lh; }
.draw-console > .form-note .text-link { flex-shrink: 0; white-space: nowrap; min-height: var(--target-size); }
.participation-conditions { display: grid; gap: var(--space-label); min-width: 0; font-variant-numeric: tabular-nums; }
.participation-conditions h3 { font-size: var(--font-size-field); line-height: var(--line-height-field); font-weight: 500; }
.participation-conditions p { margin: 0; }
.support-status { display: flex; flex-wrap: wrap; gap: var(--space-label) var(--space-small); color: var(--muted); font-size: var(--font-size-help); line-height: var(--line-height-help); }
.support-status strong { color: var(--ink); font-weight: 500; }
.participation-conditions .text-link { justify-self: start; min-height: var(--target-size); }
.participation-conditions summary { display: list-item; min-height: var(--target-size); padding-block: var(--space-control); color: var(--muted); font-size: var(--font-size-help); cursor: pointer; }
.lottery-layout > .prize-section { padding-inline-start: var(--space-page); border-inline-start: 1px solid var(--border); }
.pool-caption { color: var(--muted); font-size: 12px; line-height: 20px; margin-bottom: var(--space-small); }
.lottery-layout > .prize-section > .section-heading { margin-bottom: var(--space-label); }
.lottery-wheel { position: relative; isolation: isolate; grid-column: 1; grid-row: 1; justify-self: center; inline-size: min(100%, 320px); aspect-ratio: 1; margin: 0; }
.theme-violet { --wheel-shell-gloss: color-mix(in oklab, var(--lottery-violet-accent) 65%, var(--lottery-lamp)); --wheel-shell: var(--lottery-violet-accent); --wheel-shell-deep: color-mix(in oklab, var(--lottery-violet-accent) 40%, var(--lottery-enamel-edge)); --wheel-action-light: color-mix(in oklab, var(--lottery-violet-accent) 45%, var(--lottery-enamel-edge)); --wheel-action: color-mix(in oklab, var(--lottery-violet-accent) 30%, var(--lottery-enamel-edge)); --wheel-action-deep: color-mix(in oklab, var(--lottery-violet-accent) 20%, var(--lottery-enamel-edge)); }
.theme-sunset { --wheel-shell-gloss: color-mix(in oklab, var(--lottery-sunset-accent) 65%, var(--lottery-lamp)); --wheel-shell: var(--lottery-sunset-accent); --wheel-shell-deep: var(--lottery-metal-edge); --wheel-action-light: color-mix(in oklab, var(--lottery-sunset-accent) 35%, var(--lottery-metal-edge)); --wheel-action: var(--lottery-metal-edge); --wheel-action-deep: color-mix(in oklab, var(--lottery-metal-edge) 75%, var(--lottery-enamel-edge)); }
.lottery-wheel svg { display: block; inline-size: 100%; block-size: 100%; }
.lottery-wheel > svg { filter: drop-shadow(0 8px 9px var(--lottery-shadow)); }
.gold-light { stop-color: var(--lottery-metal-light); }
.gold-base { stop-color: var(--lottery-metal); }
.gold-shade { stop-color: var(--lottery-metal-shade); }
.enamel-gloss { stop-color: var(--wheel-shell-gloss); }
.enamel-base { stop-color: var(--wheel-shell); }
.enamel-deep { stop-color: var(--wheel-shell-deep); }
.action-light { stop-color: var(--wheel-action-light); }
.action-base { stop-color: var(--wheel-action); }
.action-deep { stop-color: var(--wheel-action-deep); }
.face-light { stop-color: var(--lottery-face-light); }
.face-base { stop-color: var(--lottery-face); }
.face-shade { stop-color: var(--lottery-face-shade); }
.warm-light { stop-color: var(--lottery-warm-light); }
.warm-base { stop-color: var(--lottery-warm); }
.warm-shade { stop-color: var(--lottery-warm-shade); }
.lamp-light { stop-color: var(--lottery-lamp); }
.wheel-depth { fill: var(--lottery-enamel-edge); }
.wheel-frame { stroke: var(--lottery-metal-edge); stroke-width: 1; }
.wheel-rim { stroke: var(--lottery-metal-light); stroke-width: 1.5; }
.wheel-lights { filter: drop-shadow(0 1px 2px var(--lottery-metal-shade)); }
.lamp-socket { fill: var(--lottery-metal); stroke: var(--lottery-metal-light); stroke-width: .75; }
.wheel-sector, .wheel-alternate { stroke: var(--lottery-metal); stroke-width: 1.5; }
.wheel-disc { transform-origin: 200px 200px; }
.wheel-label { fill: var(--lottery-face-ink); font-size: 24px; font-weight: 600; }
.wheel-featured .wheel-label { fill: var(--lottery-lamp); }
.wheel-dense .wheel-label { font-size: 16px; }
.wheel-label.clown-label { font-size: 36px; }
.wheel-dense .wheel-label.clown-label { font-size: 24px; }
.prize-clown { display: inline-block; font-size: 26px; line-height: 28px; }
.wheel-inner-rim { fill: none; stroke: var(--lottery-metal-light); stroke-width: 1; }
.wheel-hub-depth { fill: var(--lottery-metal-edge); }
.wheel-hub { stroke: var(--lottery-metal-light); stroke-width: 1.5; }
.wheel-hub-ring { stroke: var(--lottery-metal-shade); stroke-width: 1.5; }
.wheel-disc .is-winner > path { stroke: var(--lottery-metal-light); stroke-width: 3; }
.wheel-pointer { filter: drop-shadow(0 3px 2px var(--lottery-shadow)); }
.wheel-pointer path { stroke: var(--lottery-metal-edge); stroke-width: 1; }
.wheel-pointer circle { fill: var(--wheel-shell-deep); stroke: var(--lottery-metal-light); stroke-width: 1.5; }
.wheel-center { position: absolute; inset-inline-start: 50%; inset-block-start: 50%; transform: translate(-50%, -50%); display: flex; flex-direction: column; align-items: center; justify-content: center; gap: var(--space-label); inline-size: 27%; aspect-ratio: 1; min-block-size: var(--target-size); padding: var(--space-label); border: 1px solid var(--lottery-metal-light); border-radius: 50%; background: transparent; color: var(--lottery-lamp); font-size: 12px; line-height: 16px; font-weight: 500; text-align: center; }
.wheel-center span { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; max-inline-size: 100%; flex-shrink: 0; overflow: hidden; overflow-wrap: anywhere; }
.wheel-center svg { inline-size: 20px; block-size: 20px; flex-shrink: 0; color: currentColor; }
.wheel-center:not(:disabled):active { transform: translate(-50%, -50%); background: color-mix(in oklab, var(--lottery-enamel-edge) 16%, transparent); }
.wheel-center:disabled { opacity: .55; cursor: not-allowed; }
.activity-page :is(button, a, .table-wrap):focus-visible { outline: 2px solid var(--focus-ring); outline-offset: var(--focus-outline-offset); }
.activity-page button:not(:disabled):active { background-color: var(--state-pressed); }
.activity-page button.primary:not(:disabled):active { background-color: var(--blue-hover); }
@media (hover: hover) {
  .wheel-center:not(:disabled):hover { background: color-mix(in oklab, var(--lottery-lamp) 8%, transparent); }
  .draw-console > .button.primary:not(:disabled):hover { filter: brightness(1.06); }
}
.draw-controls { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-control); }
.draw-controls > p { color: var(--muted); }
.draw-controls strong { margin-inline: var(--space-label); font-size: 28px; line-height: 36px; color: var(--ink); font-weight: 600; font-variant-numeric: tabular-nums; }
.draw-controls .view-switch { padding: var(--space-label); }
.view-switch .button { min-height: var(--control-height); padding: var(--space-small) var(--space-control); }
.view-switch .selected { background: var(--state-selected); color: var(--ink); }
.view-switch .selected:hover:not(:disabled) { background: var(--state-pressed); }
.draw-result { display: grid; gap: var(--space-small); margin: 0; padding-block: var(--space-control); border: 0; border-block-start: 1px solid var(--border); border-radius: 0; background: transparent; color: var(--ink); }
.draw-result > div { display: grid; gap: var(--space-label); }
.draw-result .caption-5 { font-variant-numeric: tabular-nums; }
.draw-result .text-link { justify-self: start; min-block-size: var(--target-size); }
.prize-list { display: grid; }
.prize-item { display: grid; grid-template-columns: 20px minmax(0, 1fr) max-content; align-items: start; gap: var(--space-control); padding-block: var(--space-control); border-bottom: 1px solid var(--border); }
.prize-item:last-child { border-bottom: 0; }
.prize-icon { color: var(--muted); }
.prize-item > div { min-width: 0; overflow-wrap: anywhere; }
.prize-item p { margin-top: var(--space-label); font-size: 12px; line-height: 20px; }
.prize-item .prize-amount { color: var(--ink); font-size: 14px; font-weight: 500; line-height: 21px; }
.prize-availability { color: var(--muted); text-align: end; font-variant-numeric: tabular-nums; }
.prize-availability strong { color: var(--ink); font-weight: 500; }
.activity-page > .stack { gap: var(--space-section); }
.records-section > .section-heading { margin-bottom: var(--space-group); }
.records-section .table-wrap { container: reward-records / inline-size; }
.records-section .data-table { font-variant-numeric: tabular-nums; }
.records-section .data-table th { background: transparent; border-bottom: 1px solid var(--border); }
.activity-loading { display: grid; grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr); gap: var(--space-page); padding-top: var(--space-section); }
.activity-loading .skeleton { min-block-size: 320px; border-radius: var(--radius); }
@container reward-records (max-width: 640px) {
  .data-table, .data-table tbody, .data-table tr { display: block; }
  .data-table thead { display: none; }
  .data-table tr { padding-block: var(--space-control); border-bottom: 1px solid var(--border); }
  .data-table td { display: grid; grid-template-columns: 64px minmax(0, 1fr); gap: var(--space-control); min-width: 0; padding: var(--space-label) 0; border: 0; white-space: normal; overflow-wrap: anywhere; }
  .data-table td::before { content: attr(data-label); color: var(--muted); font-size: 12px; }
  .data-table td .status { justify-self: start; }
  .data-table td[data-label="状态"] { row-gap: var(--space-label); }
  .data-table td > .reward-expiry { grid-column: 2; margin-top: 0; }
}
@media (max-width: 1099px) {
  .lottery-layout, .activity-loading { grid-template-columns: minmax(0, 1fr); }
  .draw-section { grid-template-columns: minmax(0, 320px) minmax(0, 1fr); }
  .lottery-layout > .prize-section { padding: var(--space-section) 0 0; border: 0; border-block-start: 1px solid var(--border); }
}
@media (max-width: 999px) {
  .activity-page > .page-heading { position: relative; height: 0; min-height: 0; margin: 0; }
  .activity-page > .page-heading h1 { display: none; }
  .activity-page > .page-heading > .icon-button { position: absolute; inset-block-start: 0; inset-inline-end: 0; }
  .activity-page > .tabs { max-inline-size: calc(100% - var(--target-size) - var(--space-small)); gap: var(--space-group); }
}
@media (max-width: 639px) {
  .activity-page { padding-top: var(--space-group); }
  .activity-page > .tabs { gap: var(--space-label); }
  .activity-page .tab { min-inline-size: var(--target-size); font-size: 12px; }
  .daily-overview { align-items: start; gap: var(--space-control); padding-block: var(--space-control); }
  .daily-overview dl { inline-size: 100%; gap: var(--space-group); }
  .daily-overview dl > div { flex: 1; }
  .daily-overview dl > div + div { padding-inline-start: var(--space-group); }
  .daily-overview strong { font-size: 24px; line-height: 32px; }
  .lottery-layout { padding-top: var(--space-group); gap: var(--space-group); }
  .draw-section { grid-template-columns: minmax(0, 1fr); gap: var(--space-control); }
  .draw-console { grid-column: 1; grid-row: auto; justify-items: stretch; }
  .draw-console > .button { inline-size: 100%; }
  .lottery-wheel { grid-column: 1; grid-row: auto; inline-size: min(100%, 248px); }
  .prize-item { column-gap: var(--space-small); }
  .prize-availability p { max-inline-size: 104px; }
}
@media (prefers-reduced-motion: no-preference) {
  .wheel-disc { transition: transform 1600ms var(--ease); }
}
</style>
