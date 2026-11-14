<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { RefreshCw } from '@lucide/vue'
import { session } from '../state'
import { accountBalance, balanceDescription, balanceNumber, refreshAccountBalance } from '../account-balance'
import { creation } from '../native-studio'
import { studioAccount } from '../studio-account'
import type { ModelPricing } from '../../server/native-account/pricing'
const props = defineProps<{ model: string; quantity?: number; refreshKey?: number }>()
defineEmits<{ prices: [] }>()
const prices = ref<ModelPricing>(), loading = ref(false)
const price = computed(() => prices.value?.rows?.find(row => row.model === props.model && row.group === creation.selectedGroup))
const priceLabel = computed(() => price.value ? `${price.value.price} · ${price.value.billing}` : '查看定价')
let version = 0
async function load() {
  const current = ++version, owner = session.user?.id
  if (!owner) { prices.value = undefined; loading.value = false; return }
  loading.value = true
  const [, pricing] = await Promise.allSettled([
    refreshAccountBalance(), studioAccount<ModelPricing>('model-pricing'),
  ])
  if (version !== current || session.user?.id !== owner) return
  prices.value = pricing.status === 'fulfilled' && Array.isArray(pricing.value?.rows) ? pricing.value : undefined
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
    <button type="button" class="billing-price" :title="priceLabel" @click="$emit('prices')"><span v-if="quantity">本次 {{ quantity }} 张 · </span>{{ priceLabel }}</button>
    <span class="billing-balance" :title="balanceDescription">可用 {{ accountBalance.amount === null ? '—' : `${accountBalance.currency} ${balanceNumber}` }}</span>
    <button type="button" class="studio-tool billing-refresh" aria-label="刷新费用和额度" title="刷新费用和额度" :disabled="loading || accountBalance.loading" @click="load"><RefreshCw :size="14" /></button>
  </div>
</template>
<style scoped>
.studio-billing { grid-column: 1 / -1; display: flex; align-items: center; gap: 6px; min-width: 0; margin: -4px 0 4px; font-size: 12px; color: var(--muted); }
.billing-price { flex: 1; min-width: 0; border: 0; background: transparent; color: inherit; padding: 0 4px; min-height: 32px; text-align: left; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.billing-price:hover { color: var(--ink); }.billing-balance { max-width: 48%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-variant-numeric: tabular-nums; }
.billing-refresh { min-height: 32px; min-width: 32px; padding: 4px; }
@media (max-width: 639px) { .studio-billing { margin: 0; gap: 4px; }.billing-price, .billing-refresh { min-height: 36px; }.billing-refresh { min-width: 36px; } }
@media (min-width: 640px) { .billing-balance, .billing-refresh { display: none; } }
</style>
