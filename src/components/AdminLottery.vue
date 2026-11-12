<script setup lang="ts">
import { computed, onMounted, ref, toRaw } from 'vue'
import { Plus, RefreshCw, Save, Search, Trash2 } from '@lucide/vue'
import type { LotterySettings, LotteryPrize } from '../../server/business/lottery'
import { api, errorMessage, notify, queryString, session } from '../state'

interface Config { version: number; settings: LotterySettings }
interface User { id: string; name: string; username: string }
interface Account { userId: string; balance: number }
interface Award { name: string; amountCents: number; status: 'pending' | 'fulfilled' | 'empty'; note: string }
interface Draw { id: string; username: string; userId: string; createdAt: string; creditAttempts: number; prizes: Award[] }
interface Adjustment { userId: string; mode: 'add' | 'set'; amount: number; expectedBalance: number; requestId: string; reason: string }
const draft = ref<Config | null>(null)
const loading = ref(true), saving = ref(false), error = ref(''), saved = ref(false)
const percentages = ref<Record<string, number>>({})
const probabilitiesEdited = ref(false)
const ruleNames = { invites: '有效邀请', followers: '获得关注', likes: '作品获赞' }
const probabilityTotal = computed(() => draft.value?.settings.prizes.filter(prize => prize.enabled).reduce((total, prize) => total + Number(percentages.value[prize.id] || 0), 0) || 0)
const userQuery = ref(''), users = ref<User[]>([]), selected = ref<User | null>(null), account = ref<Account | null>(null)
const userBusy = ref(false), chanceBusy = ref(false), chanceError = ref(''), mode = ref<'add' | 'set'>('add')
const amount = ref(1), reason = ref(''), pending = ref<Adjustment | null>(null)
const recordBusy = ref(false), records = ref<Draw[]>([]), nextCursor = ref<string | null>(null), recordError = ref(''), retrying = ref('')
const confirmRetry = ref('')
const adjustmentKey = computed(() => `ai-community-next:admin-adjustment:${session.user?.id}`)
const nextBalance = computed(() => !account.value || !Number.isInteger(amount.value) || amount.value < (mode.value === 'add' ? 1 : 0) ? null : mode.value === 'add' ? account.value.balance + amount.value : amount.value)
const awardLabels = { pending: '待发放', fulfilled: '已到账', empty: '未中奖' }
function message(cause: unknown) {
  const value = errorMessage(cause)
  return ({ LOTTERY_CONFLICT: '配置或次数已变化，请重新读取后再提交。', LOTTERY_INVALID: '奖项、概率或次数参数无效，请检查后重试。', LOTTERY_UNAVAILABLE: '奖励发放服务暂不可用，请检查章鱼账号的发放配置。' } as Record<string, string>)[value] || value
}
function setDraft(value: Config) {
  draft.value = value
  const enabled = value.settings.prizes.filter(prize => prize.enabled)
  const total = enabled.reduce((sum, prize) => sum + prize.weight, 0)
  const entries = enabled.map(prize => ({ id: prize.id, exact: total ? prize.weight / total * 10000 : 0 }))
  const basisPoints = Object.fromEntries(value.settings.prizes.map(prize => [prize.id, 0]))
  for (const entry of entries) basisPoints[entry.id] = Math.floor(entry.exact)
  let remaining = total ? 10000 - Object.values(basisPoints).reduce((sum, points) => sum + points, 0) : 0
  for (const entry of entries.sort((a, b) => (b.exact % 1) - (a.exact % 1))) if (remaining-- > 0) basisPoints[entry.id] = basisPoints[entry.id]! + 1
  percentages.value = Object.fromEntries(Object.entries(basisPoints).map(([id, points]) => [id, points / 100]))
  probabilitiesEdited.value = false
}
async function loadConfig() {
  loading.value = true; error.value = ''
  try { setDraft(await api<Config>('/api/admin/lottery/config')) }
  catch (cause) { error.value = message(cause) }
  finally { loading.value = false }
}
function addPrize() {
  draft.value?.settings.prizes.push({ id: crypto.randomUUID(), name: '', description: '', weight: 1, stock: -1, enabled: true, amountCents: 50, kind: 'balance' })
  probabilitiesEdited.value = true; saved.value = false
}
function removePrize(index: number) { draft.value?.settings.prizes.splice(index, 1); probabilitiesEdited.value = true; saved.value = false }
function probability(prize: LotteryPrize) {
  const available = draft.value?.settings.prizes.filter(item => item.enabled && item.stock !== 0) || []
  const weight = (item: LotteryPrize) => probabilitiesEdited.value ? Number(percentages.value[item.id] || 0) : item.weight
  const total = available.reduce((sum, item) => sum + weight(item), 0)
  return prize.enabled && prize.stock !== 0 && total ? (weight(prize) / total * 100).toFixed(2) : '0.00'
}
async function saveConfig() {
  if (!draft.value || saving.value) return
  error.value = ''; saved.value = false
  const value = structuredClone(toRaw(draft.value))
  if (probabilitiesEdited.value) {
    const enabled = value.settings.prizes.filter(prize => prize.enabled)
    if (enabled.length && (Math.abs(probabilityTotal.value - 100) > 0.001 || enabled.some(prize => {
      const percent = percentages.value[prize.id]
      return typeof percent !== 'number' || !Number.isFinite(percent) || percent < 0.01 || percent > 100 || Math.abs(percent * 100 - Math.round(percent * 100)) > 0.000001
    }))) { error.value = '启用奖项的设定概率合计需为 100%，每项至少为 0.01%。'; return }
    for (const prize of enabled) prize.weight = Math.round(percentages.value[prize.id]! * 100)
  }
  saving.value = true
  try { setDraft(await api<Config>('/api/admin/lottery/config', { method: 'PATCH', body: value })); saved.value = true; notify('抽奖配置已保存。') }
  catch (cause) { error.value = message(cause) }
  finally { saving.value = false }
}
async function findUsers() {
  userBusy.value = true; chanceError.value = ''
  try { users.value = (await api<{ items: User[] }>(`/api/admin/users${queryString({ query: userQuery.value.trim(), status: 'active' })}`)).items }
  catch (cause) { chanceError.value = message(cause) }
  finally { userBusy.value = false }
}
async function chooseUser(person: User) {
  if (pending.value || chanceBusy.value) return
  selected.value = person; users.value = []; account.value = null; chanceError.value = ''; userBusy.value = true
  try { account.value = await api<Account>(`/api/admin/lottery/account${queryString({ userId: person.id })}`) }
  catch (cause) { chanceError.value = message(cause) }
  finally { userBusy.value = false }
}
async function adjust() {
  if (chanceBusy.value || (!pending.value && (!account.value || nextBalance.value === null || nextBalance.value > 2147483647))) return
  if (!pending.value && account.value) {
    const value: Adjustment = { userId: account.value.userId, mode: mode.value, amount: amount.value, expectedBalance: account.value.balance, requestId: crypto.randomUUID(), reason: reason.value.trim() }
    try { sessionStorage.setItem(adjustmentKey.value, JSON.stringify(value)) }
    catch { chanceError.value = '浏览器无法保存本次操作凭证，请允许站点存储后重试。'; return }
    pending.value = value
  }
  chanceBusy.value = true; chanceError.value = ''
  try {
    account.value = await api<Account>('/api/admin/lottery/chances', { method: 'POST', body: pending.value })
    pending.value = null
    try { sessionStorage.removeItem(adjustmentKey.value) } catch { /* A confirmed request may safely be retried. */ }
    notify('抽奖次数已更新。')
  } catch (cause) {
    chanceError.value = message(cause)
    if (['LOTTERY_CONFLICT', 'LOTTERY_INVALID', 'LOTTERY_NOT_FOUND', 'LOTTERY_FORBIDDEN'].includes(errorMessage(cause))) {
      const userId = pending.value?.userId
      pending.value = null
      try { sessionStorage.removeItem(adjustmentKey.value) } catch { /* A rejected adjustment has not changed the balance. */ }
      if (userId) {
        try { account.value = await api<Account>(`/api/admin/lottery/account${queryString({ userId })}`) }
        catch { account.value = null }
      }
    }
  }
  finally { chanceBusy.value = false }
}
async function loadRecords(more = false) {
  recordBusy.value = true; recordError.value = ''
  try {
    const data = await api<{ items: Draw[]; nextCursor: string | null }>(`/api/admin/lottery/records${queryString({ cursor: more ? nextCursor.value || undefined : undefined })}`)
    records.value = more ? [...records.value, ...data.items] : data.items; nextCursor.value = data.nextCursor
  } catch (cause) { recordError.value = message(cause) }
  finally { recordBusy.value = false }
}
async function retryCredit(id: string) {
  retrying.value = id; recordError.value = ''
  try { await api('/api/admin/lottery/retry', { method: 'POST', body: { drawId: id } }); confirmRetry.value = ''; await loadRecords(); notify('已重新核对发放结果。') }
  catch (cause) { recordError.value = message(cause) }
  finally { retrying.value = '' }
}
onMounted(() => {
  void loadConfig(); void loadRecords()
  try {
    const stored: unknown = JSON.parse(sessionStorage.getItem(adjustmentKey.value) || 'null')
    const value = stored as Partial<Adjustment> | null
    if (value && typeof value === 'object' && typeof value.requestId === 'string' && /^[a-zA-Z0-9_-]{16,64}$/.test(value.requestId)
      && typeof value.userId === 'string' && /^[a-zA-Z0-9]{1,32}$/.test(value.userId)
      && (value.mode === 'add' || value.mode === 'set') && Number.isInteger(value.amount) && Number(value.amount) >= (value.mode === 'add' ? 1 : 0)
      && Number(value.amount) <= 2147483647 && Number.isInteger(value.expectedBalance) && Number(value.expectedBalance) >= 0
      && Number(value.expectedBalance) <= 2147483647 && typeof value.reason === 'string' && value.reason.length <= 300) {
      pending.value = value as Adjustment
      selected.value = { id: pending.value.userId, name: pending.value.userId, username: pending.value.userId }
    }
  } catch { /* Ignore an unreadable local draft. */ }
})
</script>

<template>
  <div class="admin-lottery">
    <section class="panel-section lottery-config">
      <div class="section-heading"><h2>奖池与活动规则</h2><div class="table-actions"><RouterLink to="/activities" class="button subtle btn">预览活动</RouterLink><button class="icon-button" title="重新读取抽奖配置" aria-label="重新读取抽奖配置" :disabled="loading || saving" @click="loadConfig"><RefreshCw :size="17" /></button></div></div>
      <div v-if="loading" class="admin-loading" role="status" aria-label="正在读取抽奖配置"><div v-for="n in 3" :key="n" class="skeleton" /></div>
      <p v-if="error" class="form-error" role="alert">{{ error }}</p>
      <form v-if="draft && !loading" class="stack" @submit.prevent="saveConfig">
        <fieldset :disabled="saving" class="fieldset stack">
          <h3 class="config-title">活动展示</h3>
          <label class="check-label"><input v-model="draft.settings.enabled" type="checkbox" />开放抽奖</label>
          <div class="fields">
            <label class="field"><span>活动标题</span><input v-model="draft.settings.wheel.title" class="control" maxlength="32" /></label>
            <label class="field"><span>轮盘按钮</span><input v-model="draft.settings.wheel.buttonText" class="control" maxlength="8" required /></label>
            <label class="field"><span>轮盘主题</span><select v-model="draft.settings.wheel.theme" class="control"><option value="teal">青绿</option><option value="violet">紫色</option><option value="sunset">日落</option></select></label>
            <label class="field"><span>活动简介</span><input v-model="draft.settings.wheel.subtitle" class="control" maxlength="120" /></label>
          </div>
          <label class="field"><span>活动规则</span><textarea v-model="draft.settings.wheel.rulesText" class="control" rows="3" maxlength="2000" /></label>
          <h3 class="config-title">任务奖励</h3>
          <div class="rule-grid"><div v-for="(label, key) in ruleNames" :key="key" class="stack"><label class="check-label"><input v-model="draft.settings[key].enabled" type="checkbox" />{{ label }}</label><div class="fields"><label class="field"><span>达成数量</span><input v-model.number="draft.settings[key].threshold" class="control" type="number" min="1" max="1000000" step="1" required /></label><label class="field"><span>奖励次数</span><input v-model.number="draft.settings[key].tickets" class="control" type="number" min="1" max="1000" step="1" required /></label></div></div></div>
          <label class="field"><span>获赞统计</span><select v-model="draft.settings.likesMode" class="control"><option value="work">单件作品累计</option><option value="total">所有作品累计</option></select></label>
          <div class="section-heading prize-heading"><h3>奖项</h3><button type="button" class="button subtle btn" :disabled="draft.settings.prizes.length >= 30" @click="addPrize"><Plus :size="16" />添加奖项</button></div>
          <p class="form-note">有库存且已启用的奖项参与抽取。库存填 −1 表示不限；金额单位为美元。</p>
          <p class="probability-total" role="status">设定概率合计 <strong>{{ probabilityTotal.toFixed(2) }}%</strong></p>
          <article v-for="(prize, index) in draft.settings.prizes" :key="prize.id" class="prize-editor">
            <div class="section-heading"><label class="check-label"><input v-model="prize.enabled" type="checkbox" @change="probabilitiesEdited = true" />启用奖项</label><button type="button" class="icon-button" :title="`移除奖项 ${index + 1}`" :aria-label="`移除奖项 ${index + 1}`" @click="removePrize(index)"><Trash2 :size="16" /></button></div>
            <div class="prize-fields">
              <label class="field"><span>名称</span><input v-model="prize.name" class="control" maxlength="80" required /></label>
              <label class="field"><span>类型</span><select v-model="prize.kind" class="control" @change="prize.amountCents = prize.kind === 'empty' ? 0 : 50"><option value="balance">账户余额</option><option value="empty">未中奖</option></select></label>
              <label v-if="prize.kind === 'balance'" class="field"><span>金额（美元）</span><input :value="(prize.amountCents / 100).toFixed(2)" class="control" type="number" min="0.01" max="10000" step="0.01" required @change="prize.amountCents = Math.round(Number(($event.target as HTMLInputElement).value) * 100)" /></label>
              <label class="field"><span>设定概率（%）</span><input v-model.number="percentages[prize.id]" class="control" type="number" min="0.01" max="100" step="0.01" :disabled="!prize.enabled" required @input="probabilitiesEdited = true" /></label>
              <label class="field"><span>剩余库存</span><input v-model.number="prize.stock" class="control" type="number" min="-1" max="1000000" step="1" required /></label>
              <div class="field"><span>当前实际概率</span><strong>{{ probability(prize) }}%</strong></div>
            </div>
            <label class="field"><span>说明</span><textarea v-model="prize.description" class="control" rows="2" maxlength="500" /></label>
          </article>
          <p v-if="!draft.settings.prizes.length" class="muted">暂无奖项，请先添加奖项再开放活动。</p>
          <div class="table-actions config-actions"><button class="button primary btn" :disabled="saving"><Save :size="16" />{{ saving ? '正在保存…' : '保存抽奖配置' }}</button><span v-if="saved" role="status">已保存</span></div>
        </fieldset>
      </form>
    </section>
    <section class="panel-section lottery-chances">
      <h2>用户抽奖次数</h2>
      <form v-if="!pending" class="search-row" @submit.prevent="findUsers"><label class="field"><span>账号或用户编号</span><input v-model="userQuery" type="search" class="control" maxlength="120" /></label><button class="button btn" :disabled="userBusy || chanceBusy"><Search :size="16" />查找用户</button></form>
      <ul v-if="users.length" class="user-results"><li v-for="person in users" :key="person.id"><button class="button subtle btn" :disabled="chanceBusy || userBusy || !!pending" @click="chooseUser(person)">{{ person.name }} · @{{ person.username }}</button></li></ul>
      <template v-if="selected"><p>{{ selected.name }} · @{{ selected.username }}<span v-if="account"> · 可用 {{ account.balance }} 次</span></p><form class="stack" @submit.prevent="adjust"><fieldset class="fieldset fields" :disabled="chanceBusy || userBusy || !!pending || !account"><label class="field"><span>调整方式</span><select v-model="mode" class="control"><option value="add">增加次数</option><option value="set">设置为指定次数</option></select></label><label class="field"><span>次数</span><input v-model.number="amount" class="control" type="number" :min="mode === 'add' ? 1 : 0" max="2147483647" step="1" required /></label><label class="field"><span>操作原因</span><input v-model="reason" class="control" maxlength="300" /></label><p v-if="nextBalance !== null">调整后 {{ nextBalance }} 次</p></fieldset><p v-if="pending" class="notice-inline">上次操作结果尚未确认，请使用原凭证重新核对。</p><button class="button primary btn" :disabled="chanceBusy || userBusy || (!pending && (!account || nextBalance === null || nextBalance > 2147483647))">{{ chanceBusy ? '正在核对…' : pending ? '核对上次调整' : '确认调整次数' }}</button></form></template>
      <p v-else class="muted">查找并选择需要调整次数的账号。</p><p v-if="userBusy" role="status">正在读取账号…</p><p v-if="chanceError" class="form-error" role="alert">{{ chanceError }}</p>
    </section>
    <section class="panel-section lottery-records">
      <div class="section-heading"><h2>全员奖励记录</h2><button class="icon-button" title="刷新奖励记录" aria-label="刷新奖励记录" :disabled="recordBusy || !!retrying" @click="loadRecords()"><RefreshCw :size="17" /></button></div>
      <p v-if="recordError" class="form-error" role="alert">{{ recordError }}</p><p v-if="recordBusy" role="status">正在读取奖励记录…</p>
      <div v-if="records.length" class="table-wrap"><table class="data-table"><thead><tr><th scope="col">时间与用户</th><th scope="col">奖励</th><th scope="col">状态</th><th scope="col">操作</th></tr></thead><tbody><tr v-for="item in records" :key="item.id"><td>{{ new Date(item.createdAt).toLocaleString('zh-CN') }}<p class="caption-5">@{{ item.username || item.userId }}</p></td><td><div v-for="(award, i) in item.prizes" :key="i">{{ award.name }}<span v-if="award.amountCents"> · ${{ (award.amountCents / 100).toFixed(2) }}</span></div></td><td><div v-for="(award, i) in item.prizes" :key="i"><span class="status" :class="{ pending: award.status === 'pending' }">{{ awardLabels[award.status] }}</span><p v-if="award.note" class="caption-5">{{ award.note }}</p></div></td><td><template v-if="item.prizes.some(award => award.status === 'pending')"><button v-if="confirmRetry !== item.id" class="button subtle btn" :disabled="!!retrying" @click="confirmRetry = item.id">重试发放</button><template v-else><p class="caption-5">核对并重试此笔奖励？</p><div class="table-actions"><button class="button btn" :disabled="!!retrying" @click="retryCredit(item.id)">{{ retrying === item.id ? '核对中…' : '确认' }}</button><button class="button subtle btn" :disabled="!!retrying" @click="confirmRetry = ''">取消</button></div></template></template></td></tr></tbody></table></div>
      <p v-else-if="!recordBusy && !recordError" class="muted">暂无奖励记录。</p><button v-if="nextCursor" class="button btn" :disabled="recordBusy" @click="loadRecords(true)">加载更多</button>
    </section>
  </div>
</template>

<style scoped>
.admin-lottery { min-width: 0; }
.lottery-config { padding-top: 0; }
.fieldset { border: 0; padding: 0; margin: 0; min-width: 0; }
.fieldset.stack { gap: 20px; }
.config-title { font-size: 14px; line-height: 20px; font-weight: 600; margin-top: 8px; padding-top: 24px; border-top: 1px solid var(--border); }
.config-title:first-child { margin: 0; padding: 0; border: 0; }
.fields, .prize-fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
.fields > *, .prize-fields > * { min-width: 0; }
.rule-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 24px; align-items: start; }
.rule-grid .stack { gap: 16px; }
.rule-grid .check-label { font-weight: 500; }
.prize-heading { margin: 8px 0 0; padding-top: 24px; border-top: 1px solid var(--border); }
.prize-heading h3 { font-size: 14px; line-height: 20px; font-weight: 600; }
.probability-total { display: flex; justify-content: space-between; gap: 16px; color: var(--muted); font-size: 12px; line-height: 20px; }
.probability-total strong { color: var(--ink); font-size: 14px; font-variant-numeric: tabular-nums; }
.prize-fields { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.prize-editor { border: 1px solid var(--border); border-radius: 6px; padding: 20px; display: grid; gap: 16px; background: var(--surface); }
.prize-editor .section-heading { margin: 0; }
.prize-editor .field > strong { min-height: 40px; display: flex; align-items: center; font-size: 16px; font-weight: 500; font-variant-numeric: tabular-nums; }
.check-label { display: flex; align-items: center; gap: 8px; min-height: 24px; }
.check-label input { width: 18px; height: 18px; accent-color: var(--blue); }
.config-actions { gap: 16px; flex-wrap: wrap; padding-top: 4px; }
.config-actions > span { color: var(--green); font-size: 12px; }
.lottery-chances > h2 { font-size: 18px; line-height: 28px; }
.lottery-chances > p { margin-top: 16px; }
.lottery-chances > form.stack { gap: 16px; }
.lottery-chances form.stack > .button { align-self: flex-start; }
.search-row { display: flex; align-items: end; flex-wrap: wrap; gap: 12px; margin-block: 20px 16px; }
.search-row .field { flex: 1; min-width: 176px; }
.user-results { list-style: none; padding: 0; display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 16px; }
.admin-loading { display: grid; gap: 16px; padding-block: 24px; }
.admin-loading .skeleton { height: 40px; max-width: 640px; }
.data-table td { vertical-align: top; white-space: normal; min-width: 160px; overflow-wrap: anywhere; }
.data-table td p { margin-top: 4px; }
.lottery-records .data-table { min-width: 640px; }
.lottery-records .data-table td { padding: 16px 12px; }
.lottery-records .data-table .button { white-space: nowrap; }
.lottery-records .data-table .table-actions { flex-wrap: wrap; gap: 8px; }
@media (max-width: 1199px) { .rule-grid { grid-template-columns: 1fr; } .prize-fields { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 639px) {
  .fields, .prize-fields { grid-template-columns: 1fr; }
  .prize-editor { padding: 16px; }
  .search-row .button, .lottery-chances form.stack > .button { width: 100%; }
  .config-actions { align-items: stretch; }
  .config-actions > .button { width: 100%; }
}
</style>
