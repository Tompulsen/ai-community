<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ChevronDown, CircleDollarSign, RefreshCw } from '@lucide/vue'
import { session } from '../state'
import { accountBalance, balanceDescription, balanceNumber, refreshAccountBalance } from '../account-balance'
import { creation } from '../native-studio'
import { studioAccount } from '../studio-account'
import StudioPopover from './StudioPopover.vue'
import type { ModelPricing } from '../../server/native-account/pricing'
const props = defineProps<{ model: string; quantity?: number; refreshKey?: number }>()
const emit = defineEmits<{ prices: [] }>()
const menu = ref<InstanceType<typeof StudioPopover>>()
const prices = ref<ModelPricing>(), loading = ref(false), error = ref('')
const price = computed(() => prices.value?.rows?.find(row => row.model === props.model && row.group === creation.selectedGroup))
const groupName = computed(() => creation.groups.find(group => group.id === creation.selectedGroup)?.name || creation.selectedGroup)
function showPrices() { menu.value?.close(); emit('prices') }
let version = 0
async function load() {
  const current = ++version, owner = session.user?.id
  if (!owner) { prices.value = undefined; loading.value = false; return }
  loading.value = true; error.value = ''
  const [, pricing] = await Promise.allSettled([
    refreshAccountBalance(), studioAccount<ModelPricing>('model-pricing'),
  ])
  if (version !== current || session.user?.id !== owner) return
  prices.value = pricing.status === 'fulfilled' && Array.isArray(pricing.value?.rows) ? pricing.value : undefined
  error.value = pricing.status === 'rejected' ? '价格读取失败，请重试。' : ''
  loading.value = false
}
function refreshVisible() { if (document.visibilityState === 'visible') void load() }
watch(() => [session.user?.id, creation.selectedGroup], () => { prices.value = undefined; void load() }, { immediate: true })
watch(() => props.refreshKey, (value, previous) => { if (value && value !== previous) void load() })
onMounted(() => window.addEventListener('focus', refreshVisible))
onBeforeUnmount(() => { version++; window.removeEventListener('focus', refreshVisible) })
</script>
<template>
  <div class="studio-billing" aria-label="模型费用与可用额度">
    <div class="billing-controls"><StudioPopover ref="menu" label="模型价格" :width="480">
      <template #trigger><CircleDollarSign :size="15" /><span>模型价格</span><ChevronDown :size="13" /></template>
      <div class="billing-details">
        <strong class="billing-model">{{ model || '尚未选择模型' }}</strong>
        <p class="billing-context"><span v-if="groupName">{{ groupName }}</span><span v-if="quantity">本次 {{ quantity }} 张</span></p>
        <p v-if="loading" role="status">正在读取价格…</p>
        <p v-else-if="error" role="alert">{{ error }}</p>
        <template v-else-if="price"><p class="billing-full-price">{{ price.price }}</p><p class="billing-context">{{ price.billing }}</p></template>
        <p v-else>当前模型暂无可用定价。</p>
        <div class="billing-detail-actions"><button v-if="error" type="button" class="studio-tool" @click="load"><RefreshCw :size="15" />重试</button><button type="button" class="studio-tool" @click="showPrices">查看全部定价</button></div>
      </div>
    </StudioPopover><slot /></div>
    <div class="billing-account"><span class="billing-balance" :title="balanceDescription">可用 {{ accountBalance.amount === null ? '—' : `${accountBalance.currency} ${balanceNumber}` }}</span>
    <button type="button" class="studio-tool billing-refresh" aria-label="刷新费用和额度" title="刷新费用和额度" :disabled="loading || accountBalance.loading" @click="load"><RefreshCw :size="14" /></button></div>
  </div>
</template>
<style scoped>
.studio-billing { display: flex; flex: none; flex-wrap: wrap; align-items: center; gap: 4px 8px; min-width: 0; margin: 4px 0 0; font-size: 12px; color: var(--muted); }
.billing-controls, .billing-account { display: flex; flex: none; align-items: center; gap: 6px; min-width: 0; max-width: 100%; }
.billing-account { margin-left: auto; }
.billing-balance { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-variant-numeric: tabular-nums; }
.billing-details { display: grid; gap: 12px; font-size: 14px; line-height: 24px; overflow-wrap: anywhere; }
.billing-details p { margin: 0; }
.billing-model { font-weight: 500; }
.billing-context { display: flex; flex-wrap: wrap; gap: 8px; color: var(--muted); font-size: 12px; }
.billing-full-price { font-variant-numeric: tabular-nums; white-space: pre-wrap; }
.billing-detail-actions { display: flex; justify-content: flex-end; gap: 8px; }
.billing-refresh { min-height: 32px; min-width: 32px; padding: 4px; }
@media (max-width: 639px) { .studio-billing { margin: 0; gap: 4px; }.billing-refresh { min-height: 36px; min-width: 36px; } }
@media (min-width: 640px) { .billing-account { display: none; } }
</style>
