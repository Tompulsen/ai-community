<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { Check, ChevronLeft, ChevronRight, KeyRound, Pencil, Plus, RefreshCw, Trash2, X } from '@lucide/vue'
import { session, errorMessage } from '../state'
import { studioAccount } from '../studio-account'
import { loadCreationGroups, loadCreationModels } from '../native-studio'
import type { ModelPricing } from '../../server/native-account/pricing'
interface Token { id: number; name: string; status: number; group: string; expired_time: number; remain_quota: number; used_quota: number; unlimited_quota: boolean; model_limits_enabled: boolean; model_limits: string; allow_ips?: string; auto_groups?: string[]; cross_group_retry?: boolean }
interface Log { id: number; created_at: number; model_name: string; token_name: string; prompt_tokens: number; completion_tokens: number; quota: number; content: string }
const props = defineProps<{ view: 'prices' | 'logs' | 'keys' }>()
const loading = ref(false), error = ref(''), busy = ref(false), page = ref(1), total = ref(0), query = ref('')
const prices = ref<ModelPricing>(), tokens = ref<Token[]>([]), logs = ref<Log[]>([])
const groups = ref<{ id: string; name: string }[]>([]), autoGroups = ref({ supported: false, defaultGroups: [] as string[], maxCount: 0 })
const selectedToken = ref<number | null>(null), status = ref({ quotaPerUnit: 0, currencySymbol: '' })
const dialog = ref<HTMLDialogElement>(), editing = ref<Token>(), unlimited = ref(true), quota = ref(0)
const form = reactive({ name: '', group: 'auto', expired_time: -1, model_limits_enabled: false, model_limits: '', allow_ips: '', cross_group_retry: false, auto_groups: [] as string[] })
const rows = computed(() => (prices.value?.rows || []).filter(row => `${row.model} ${row.group}`.toLowerCase().includes(query.value.toLowerCase())))
const amount = (value: number) => status.value.quotaPerUnit > 0 ? `${status.value.currencySymbol} ${(value / status.value.quotaPerUnit).toLocaleString('zh-CN', { maximumFractionDigits: 6 })}` : '—'
let revision = 0
async function load() {
  const current = ++revision, owner = session.user?.id
  if (!owner) return
  loading.value = true; error.value = ''
  try {
    const [currentStatus, account, availableGroups] = await Promise.all([
      studioAccount<typeof status.value>('status'), studioAccount<{ selectedTokenId: number | null }>('session'), studioAccount<{ groups?: typeof groups.value } | typeof groups.value>('groups'),
    ])
    if (current !== revision || owner !== session.user?.id) return
    status.value = currentStatus; selectedToken.value = account.selectedTokenId
    groups.value = Array.isArray(availableGroups) ? availableGroups : availableGroups.groups || []
    if (props.view === 'prices') prices.value = await studioAccount<ModelPricing>('model-pricing')
    else {
      const result = await studioAccount<{ items: Token[] | Log[]; total: number }>(`${props.view === 'logs' ? 'logs' : 'tokens'}?page=${page.value}&size=20`)
      if (current !== revision || owner !== session.user?.id) return
      if (props.view === 'logs') logs.value = result.items as Log[]
      else { tokens.value = result.items as Token[]; autoGroups.value = await studioAccount<typeof autoGroups.value>('auto-groups') }
      total.value = result.total
    }
  } catch (cause) { if (current === revision && owner === session.user?.id) error.value = errorMessage(cause) }
  finally { if (current === revision) loading.value = false }
}
watch(() => [props.view, session.user?.id], () => { dialog.value?.close(); editing.value = undefined; page.value = 1; prices.value = undefined; logs.value = []; tokens.value = []; void load() }, { immediate: true })
function edit(token?: Token) {
  editing.value = token; unlimited.value = token?.unlimited_quota ?? true; quota.value = status.value.quotaPerUnit > 0 ? (token?.remain_quota || 0) / status.value.quotaPerUnit : 0
  Object.assign(form, { name: token?.name || '', group: token?.group || groups.value[0]?.id || 'auto', expired_time: token?.expired_time ?? -1, model_limits_enabled: token?.model_limits_enabled || false, model_limits: token?.model_limits || '', allow_ips: token?.allow_ips || '', cross_group_retry: token?.cross_group_retry || false, auto_groups: [...(token?.auto_groups || [])] })
  dialog.value?.showModal()
}
async function action(callback: () => Promise<unknown>) {
  if (busy.value) return; busy.value = true; error.value = ''
  try { await callback(); await load() } catch (cause) { error.value = `${errorMessage(cause)} 请刷新核对结果后再操作。` } finally { busy.value = false }
}
async function save() {
  if (!unlimited.value && status.value.quotaPerUnit <= 0) { error.value = '额度比例尚未读取，请刷新后重试。'; return }
  await action(async () => {
    await studioAccount(editing.value ? `tokens/${editing.value.id}` : 'tokens', editing.value ? 'PUT' : 'POST', {
      ...form, ...(editing.value ? { id: editing.value.id } : {}), unlimited_quota: unlimited.value,
      remain_quota: unlimited.value ? editing.value?.remain_quota || 0 : Math.round(quota.value * status.value.quotaPerUnit),
    })
    dialog.value?.close()
  })
}
async function select(token: Token) { await action(async () => { await studioAccount(`tokens/${token.id}/select`, 'POST', {}); await loadCreationGroups(); await loadCreationModels() }) }
async function remove(token: Token) { if (confirm(`删除密钥“${token.name}”？使用此密钥的历史任务可能无法继续查询。`)) await action(async () => { await studioAccount(`tokens/${token.id}`, 'DELETE'); await loadCreationGroups(); await loadCreationModels() }) }
function changePage(value: number) { page.value = value; void load() }
</script>
<template>
  <section class="account-tools" :aria-label="view === 'prices' ? '模型价格' : view === 'logs' ? '消费记录' : '密钥管理'">
    <header><h2>{{ view === 'prices' ? '模型价格' : view === 'logs' ? '消费记录' : '密钥管理' }}</h2><div><input v-if="view === 'prices'" v-model="query" class="control" type="search" aria-label="搜索模型价格" placeholder="搜索模型或分组" /><button v-if="view === 'keys'" class="button subtle btn" :disabled="loading || busy" @click="edit()"><Plus :size="16" />创建密钥</button><button class="icon-button" title="刷新" aria-label="刷新账号工具" :disabled="loading || busy" @click="load"><RefreshCw :size="18" /></button></div></header>
    <p v-if="error" class="form-error" role="alert">{{ error }}</p><p v-if="loading" class="muted" role="status">正在读取…</p>
    <template v-if="view === 'prices'"><p v-if="prices" class="account-caption">{{ prices.account }} · {{ prices.currency }} · 更新于 {{ new Date(prices.fetchedAt).toLocaleString('zh-CN') }}</p><div class="table-scroll"><table><thead><tr><th>模型</th><th>分组</th><th>计费方式</th><th>价格</th></tr></thead><tbody><tr v-for="(row, index) in rows" :key="index"><td>{{ row.model }}</td><td>{{ row.group }}</td><td>{{ row.billing }}</td><td>{{ row.price }}<details v-if="row.details && row.details.tiers.length > 1"><summary>阶梯详情</summary><div v-for="(tier, tierIndex) in row.details.tiers" :key="tierIndex">{{ tier.context }} {{ tier.perRequest || `输入 ${tier.input} · 输出 ${tier.output}` }}<span v-for="extra in tier.extras" :key="extra.label"> · {{ extra.label }} {{ extra.amount }}</span></div></details></td></tr></tbody></table></div><p v-if="!loading && !rows.length" class="muted">暂无匹配价格</p></template>
    <template v-else-if="view === 'logs'"><p class="account-caption">最近 7 天</p><div class="table-scroll"><table><thead><tr><th>时间</th><th>模型</th><th>密钥</th><th>输入 / 输出</th><th>消费</th></tr></thead><tbody><tr v-for="item in logs" :key="item.id"><td>{{ new Date(item.created_at * 1000).toLocaleString('zh-CN') }}</td><td>{{ item.model_name }}</td><td>{{ item.token_name }}</td><td>{{ item.prompt_tokens }} / {{ item.completion_tokens }}</td><td>{{ amount(item.quota) }}</td></tr></tbody></table></div><p v-if="!loading && !logs.length" class="muted">暂无消费记录</p></template>
    <template v-else><div class="table-scroll"><table><thead><tr><th>密钥</th><th>分组</th><th>剩余额度</th><th>已用额度</th><th>状态</th><th>操作</th></tr></thead><tbody><tr v-for="token in tokens" :key="token.id"><td><KeyRound :size="14" /> {{ token.name }}</td><td>{{ token.group || '默认' }}</td><td>{{ token.unlimited_quota ? '不限额' : amount(token.remain_quota) }}</td><td>{{ amount(token.used_quota) }}</td><td>{{ token.status === 1 ? token.expired_time > 0 && token.expired_time < Date.now() / 1000 ? '已过期' : '启用' : '停用' }}</td><td><div class="token-actions"><button class="icon-button" :disabled="busy || selectedToken === token.id || token.status !== 1" :aria-label="`选择密钥 ${token.name}`" title="使用此密钥" @click="select(token)"><Check :size="16" /></button><button class="icon-button" :disabled="busy" :aria-label="`编辑密钥 ${token.name}`" title="编辑" @click="edit(token)"><Pencil :size="16" /></button><button class="button subtle btn" :disabled="busy" @click="action(() => studioAccount(`tokens/${token.id}`, 'PATCH', { status: token.status === 1 ? 2 : 1 }))">{{ token.status === 1 ? '停用' : '启用' }}</button><button class="icon-button" :disabled="busy" :aria-label="`删除密钥 ${token.name}`" title="删除" @click="remove(token)"><Trash2 :size="16" /></button></div></td></tr></tbody></table></div><p v-if="!loading && !tokens.length" class="muted">暂无密钥</p></template>
    <footer v-if="view !== 'prices' && total > 20"><span>共 {{ total }} 条 · 第 {{ page }} 页</span><button class="icon-button" aria-label="上一页" title="上一页" :disabled="loading || page <= 1" @click="changePage(page - 1)"><ChevronLeft :size="18" /></button><button class="icon-button" aria-label="下一页" title="下一页" :disabled="loading || page * 20 >= total" @click="changePage(page + 1)"><ChevronRight :size="18" /></button></footer>
    <Teleport to="body"><dialog ref="dialog" class="compact-dialog" aria-labelledby="token-editor-title"><div class="dialog-heading"><h2 id="token-editor-title">{{ editing ? '编辑密钥' : '创建密钥' }}</h2><button class="icon-button" aria-label="关闭密钥编辑" :disabled="busy" @click="dialog?.close()"><X :size="18" /></button></div><form class="dialog-body stack" @submit.prevent="save"><label class="field"><span>名称</span><input v-model="form.name" class="control" maxlength="128" required /></label><label class="field"><span>密钥分组</span><select v-model="form.group" class="control"><option v-for="group in groups" :key="group.id" :value="group.id">{{ group.name }}</option></select></label><label class="check-field"><input v-model="unlimited" type="checkbox" />不限额</label><label v-if="!unlimited" class="field"><span>额度（{{ status.currencySymbol }}）</span><input v-model.number="quota" class="control" type="number" min="0" step="0.000001" required /></label><label class="field"><span>过期时间</span><select v-model.number="form.expired_time" class="control"><option v-if="editing" :value="editing.expired_time">保持原时间</option><option :value="-1">永不过期</option><option :value="Math.floor(Date.now() / 1000) + 7 * 86400">7 天</option><option :value="Math.floor(Date.now() / 1000) + 30 * 86400">30 天</option></select></label><label class="check-field"><input v-model="form.model_limits_enabled" type="checkbox" />限制模型</label><label v-if="form.model_limits_enabled" class="field"><span>允许模型（逗号分隔）</span><textarea v-model="form.model_limits" class="control" rows="3" /></label><label class="field"><span>IP 白名单</span><textarea v-model="form.allow_ips" class="control" rows="2" /></label><template v-if="form.group === 'auto' && autoGroups.supported"><label v-for="group in groups.filter(item => item.id !== 'auto')" :key="group.id" class="check-field"><input v-model="form.auto_groups" type="checkbox" :value="group.id" />{{ group.name }}</label></template><label class="check-field"><input v-model="form.cross_group_retry" type="checkbox" />允许跨组重试</label><p v-if="error" class="form-error" role="alert">{{ error }}</p><button class="button primary btn" :disabled="busy">{{ busy ? '正在保存…' : '保存密钥' }}</button></form></dialog></Teleport>
  </section>
</template>
<style scoped>
.account-tools { border-top: 1px solid var(--border); padding-top: 24px; min-height: 400px; }
header, header > div, footer, .token-actions { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }header { justify-content: space-between; margin-bottom: 24px; }h2 { font-size: 18px; margin: 0; }.account-caption { font-size: 12px; color: var(--muted); overflow-wrap: anywhere; }
.table-scroll { overflow-x: auto; max-width: 100%; }table { border-collapse: collapse; width: 100%; font-size: 14px; }th, td { text-align: left; padding: 16px 12px; border-bottom: 1px solid var(--border); vertical-align: top; min-width: 90px; overflow-wrap: anywhere; }th { color: var(--muted); font-weight: 500; }td { font-variant-numeric: tabular-nums; }td:first-child { min-width: 150px; }.token-actions { flex-wrap: nowrap; }footer { justify-content: flex-end; padding-top: 16px; font-size: 12px; }.check-field { display: flex; align-items: center; gap: 8px; }.control { max-width: 100%; }.stack { gap: 16px; }details { margin-top: 8px; font-size: 12px; }summary { cursor: pointer; }
@media (max-width: 639px) { header > div { width: 100%; }header input { flex: 1; min-width: 120px; } }
</style>
