<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ChevronDown, CircleDollarSign, RefreshCw } from '@lucide/vue'
import { session } from '../state'
import { accountBalance, balancePoints, refreshAccountBalance } from '../account-balance'
import { creation } from '../native-studio'
import { studioAccount } from '../studio-account'
import { formatInvocationPoints, invocationPoints, selectedModelPrices } from '../studio-billing'
import StudioPopover from './StudioPopover.vue'
import type { ModelPriceRow, ModelPricing } from '../../server/native-account/pricing'

const props = withDefaults(defineProps<{ model: string; group?: string | null; kind?: 'text' | 'image' | 'video'; quantity?: number; duration?: number; resolution?: string; customParameters?: string; size?: string; protocol?: string; apiFormat?: string; refreshKey?: number; hideCatalog?: boolean; compact?: boolean; hasReferenceVideo?: boolean; referenceVideoDuration?: number }>(), { kind: 'text' })
const emit = defineEmits<{ prices: [] }>()
const menu = ref<InstanceType<typeof StudioPopover>>()
const prices = ref<ModelPricing>(), loading = ref(false), error = ref('')
const billingGroup = computed(() => props.group === undefined ? creation.selectedGroup : props.group)
const rows = computed(() => selectedModelPrices(prices.value, props.model, billingGroup.value))
const billingParameters = computed(() => {
  const configured = creation.models.find(item => item.id === props.model)
  return { ...props, apiFormat: !props.apiFormat || props.apiFormat === 'auto' ? configured?.apiFormat : props.apiFormat,
    protocol: props.protocol === 'auto' ? configured?.protocol || 'openai' : props.protocol }
})
const quote = computed(() => invocationPoints(rows.value, prices.value?.currency, billingParameters.value))
const cost = computed(() => quote.value ? quote.value.min === quote.value.max
  ? formatInvocationPoints(quote.value.min)
  : `${formatInvocationPoints(quote.value.min)}–${formatInvocationPoints(quote.value.max)}` : '')
const groupName = computed(() => billingGroup.value === 'auto' ? '自动分组' : creation.groups.find(group => group.id === billingGroup.value)?.name || billingGroup.value)
const billsReferenceVideo = computed(() => props.hasReferenceVideo && rows.value.some(row => row.videoRates?.some(rate => rate.billReferenceVideo)))
const referenceDurationKnown = computed(() => Number.isFinite(props.referenceVideoDuration) && props.referenceVideoDuration! > 0)
const quantityLabel = computed(() => props.kind === 'image' ? `本次 ${props.quantity ?? 1} 张` : props.kind === 'video' && props.duration
  ? billsReferenceVideo.value && referenceDurationKnown.value ? `输出 ${props.duration} 秒 + 参考 ${formatInvocationPoints(props.referenceVideoDuration!)} 秒` : `本次 ${props.duration} 秒视频` : quote.value ? '单次请求' : '本次调用')
const pointsPricing = computed(() => prices.value?.currency === '积分')
const compactLabel = computed(() => quote.value ? cost.value + ' 积分' : loading.value ? '计价中…' : pointsPricing.value && rows.value.length ? '按量计费' : '查看价格')
const usageBased = computed(() => rows.value.some(row => row.details?.unit === 'tokens'))
function billingLabel(row: ModelPriceRow) {
  const unit = props.kind === 'image' && billingParameters.value.protocol !== 'async' && row.imageCountMultiplier ? '每张图片' : row.billing
  return `${unit} · ${row.groupRatio !== undefined ? `已含 ${row.groupRatio}× 分组倍率` : '已含分组倍率'}`
}
function showPrices() { menu.value?.close(); emit('prices') }
let version = 0
async function load(background = false) {
  if (background && loading.value) return
  const current = ++version, owner = session.user?.id, account = session.user?.accountId || owner
  if (!background) prices.value = undefined
  error.value = ''
  if (!owner) { loading.value = false; return }
  loading.value = true
  void refreshAccountBalance()
  try {
    const result = await studioAccount<ModelPricing>('model-pricing')
    if (version !== current || session.user?.id !== owner || account !== (session.user?.accountId || session.user?.id)) return
    if (!Array.isArray(result?.rows) || result.userId !== Number(account)) throw new Error('Invalid pricing account')
    prices.value = result
  } catch {
    if (version === current) { prices.value = undefined; error.value = '价格读取失败，请重试。' }
  } finally {
    if (version === current) loading.value = false
  }
}
function refreshVisible() { if (document.visibilityState === 'visible' && !session.restoring) void load(true) }
watch([() => session.user?.id, () => session.user?.accountId, billingGroup], () => { void load() }, { immediate: true, flush: 'sync' })
watch(() => props.refreshKey, (value, previous) => { if (value && value !== previous) void load() })
onMounted(() => window.addEventListener('focus', refreshVisible))
onBeforeUnmount(() => { version++; window.removeEventListener('focus', refreshVisible) })
</script>

<template>
  <div class="studio-billing" :class="{ 'billing-compact': compact }" aria-label="模型费用与可用积分">
    <div class="billing-controls"><StudioPopover ref="menu" label="模型价格" :trigger-label="compact ? '预计积分消耗：' + compactLabel + '，查看详情' : undefined" :width="440">
      <template #trigger><span v-if="compact" class="billing-estimate" aria-live="polite">{{ compactLabel }}</span><template v-else><CircleDollarSign :size="15" aria-hidden="true" /><span>模型价格</span></template><ChevronDown :size="13" aria-hidden="true" /></template>
      <div class="billing-details">
        <div class="billing-model-row"><strong class="billing-model">{{ model || '尚未选择模型' }}</strong><span v-if="groupName" class="billing-group">{{ groupName }}</span></div>
        <div class="billing-summary" aria-live="polite">
          <div class="billing-cost">
            <span>{{ quantityLabel }}{{ quote ? '，预计消耗' : '' }}</span>
            <strong v-if="quote" class="billing-cost-value">{{ cost }} <small>积分</small></strong>
            <span v-else-if="loading" role="status">正在读取价格…</span>
            <span v-else-if="error">暂不可用</span>
            <span v-else-if="!rows.length">暂无可用定价</span>
            <span v-else-if="!pointsPricing">积分定价暂不可用</span>
            <span v-else>按实际用量结算</span>
          </div>
          <div class="billing-wallet"><span>可用总积分</span><strong v-if="accountBalance.points" class="billing-wallet-value">{{ balancePoints }} <small>积分</small></strong><span v-else>{{ accountBalance.loading ? '正在读取…' : '暂不可用' }}</span></div>
        </div>
        <p v-if="error" class="billing-error" role="alert">{{ error }}</p>
        <p v-else-if="!loading && !rows.length" class="billing-note">当前模型暂无可用定价，请刷新或查看全部定价。</p>
        <template v-else-if="!loading && pointsPricing && rows.length">
          <div class="billing-rates">
            <div v-for="row in rows" :key="row.group" class="billing-rate">
              <span class="billing-context">{{ billingGroup === 'auto' ? row.group : '计费标准' }} · {{ billingLabel(row) }}</span>
              <p class="billing-full-price">{{ row.requestPrice !== undefined ? `${formatInvocationPoints(row.requestPrice)} 积分` : row.price }}</p>
            </div>
          </div>
          <p class="billing-note">{{ usageBased ? '按实际输入、输出及缓存用量结算，调用前无法确定总消耗。' : quote ? kind === 'text' ? '按单次模型请求预估；历史摘要或工具调用产生的额外请求另计。' : '按当前定价预估，实际消耗以结算为准。' : '总消耗随生成参数及实际用量变化，完成后结算。' }}<template v-if="billingGroup === 'auto' && rows.length > 1"> 自动分组以实际使用的分组为准。</template></p>
          <p v-if="kind === 'video'" class="billing-note">1 元 = 5,000 积分，已含当前分组倍率。<template v-if="customParameters?.trim()">自定义参数可能覆盖时长或分辨率，暂不预估总额。</template><template v-else-if="quote && quote.min !== quote.max">预计范围包含不同渠道或自动分辨率的价格。</template></p>
          <p v-if="billsReferenceVideo && !referenceDurationKnown" class="billing-note" role="status">参考视频时长待服务器确认，暂不预估总额。</p>
        </template>
        <p v-if="accountBalance.error" class="billing-error" role="alert">积分读取失败，请重试。</p>
        <div class="billing-detail-actions"><button type="button" class="studio-tool billing-refresh" :disabled="loading || accountBalance.loading" @click="load()"><RefreshCw :size="15" aria-hidden="true" />{{ error || accountBalance.error ? '重试' : '刷新积分与价格' }}</button><button v-if="!hideCatalog" type="button" class="studio-tool" @click="showPrices">查看全部定价</button></div>
      </div>
    </StudioPopover><slot /></div>
  </div>
</template>

<style scoped>
.studio-billing { display: flex; flex: none; align-items: center; min-width: 0; margin: 4px 0 0; font-size: 12px; color: var(--muted); }
.billing-controls { display: flex; flex: none; flex-wrap: wrap; align-items: center; gap: 6px; min-width: 0; max-width: 100%; }
.billing-compact { margin: 0; max-width: 180px; }
.billing-compact .billing-controls { flex: 1; flex-wrap: nowrap; }
.billing-compact :deep(.studio-tool) { min-width: 0; min-height: 44px; max-width: 100%; color: var(--ink); font-size: 13px; font-variant-numeric: tabular-nums; }
.billing-estimate { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.billing-details { display: grid; gap: 16px; color: var(--ink); font-size: 14px; line-height: 1.6; overflow-wrap: anywhere; }
.billing-details p { margin: 0; }
.billing-model-row { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: 4px 16px; }
.billing-model { min-width: 0; font-size: 16px; font-weight: 600; }
.billing-group, .billing-context, .billing-note { color: var(--muted); font-size: 12px; }
.billing-summary { display: grid; gap: 14px; padding-block: 16px; border-block: 1px solid var(--border); }
.billing-cost, .billing-wallet { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: 4px 16px; min-width: 0; }
.billing-cost > span:first-child, .billing-wallet > span:first-child { color: var(--muted); }
.billing-cost-value { color: var(--blue); font-size: 22px; line-height: 1.4; font-weight: 600; }
.billing-wallet-value { font-size: 16px; font-weight: 500; }
.billing-cost-value, .billing-wallet-value, .billing-full-price { font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.billing-summary small { font-size: 13px; font-weight: 500; }
.billing-rates { display: grid; gap: 12px; }
.billing-full-price { white-space: pre-wrap; }
.billing-error { color: var(--danger); }
.billing-detail-actions { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 4px 12px; }
.billing-detail-actions > button { min-height: 36px; }
@media (max-width: 639px) { .studio-billing { margin: 0; }.billing-details { gap: 14px; }.billing-summary { gap: 12px; }.billing-detail-actions > button { min-height: 44px; } }
</style>
