<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { Check, ChevronDown, Globe } from '@lucide/vue'
import type { NativeChat } from '../native-chat'
import StudioPopover from './StudioPopover.vue'
import { session } from '../state'
import { creation } from '../native-studio'
import { studioAccount } from '../studio-account'
import { formatInvocationPoints, invocationPoints, selectedModelPrices } from '../studio-billing'
import type { ModelPricing } from '../../server/native-account/pricing'

const props = defineProps<{ modelValue: NativeChat['search']; disabled?: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: NativeChat['search']] }>()
const menu = ref<InstanceType<typeof StudioPopover>>(), root = ref<HTMLDivElement>()
const modes = [
  { id: 'off', label: '关闭联网', trigger: '联网' },
  { id: 'quick', label: '快速搜索', trigger: '快速搜索' },
  { id: 'deep', label: '深度搜索', trigger: '深度搜索' },
] as const
const current = computed(() => modes.find(mode => mode.id === props.modelValue) || modes[0])
const pricing = ref<ModelPricing>(), loading = ref(false), failed = ref(false), opened = ref(false)
let priceVersion = 0
async function loadPrices(isOpen: boolean) {
  opened.value = isOpen
  if (!isOpen) return
  const version = ++priceVersion, owner = session.user?.id, account = session.user?.accountId || owner
  pricing.value = undefined; failed.value = false; loading.value = false
  if (!owner) return
  loading.value = true
  try {
    const result = await studioAccount<ModelPricing>('model-pricing')
    if (version !== priceVersion) return
    if (!Array.isArray(result?.rows) || result.userId !== Number(account)) throw new Error('Invalid pricing account')
    pricing.value = result
  } catch {
    if (version === priceVersion) failed.value = true
  } finally {
    if (version === priceVersion) loading.value = false
  }
}
function price(mode: NativeChat['search']) {
  if (!session.user) return '登录后查看'
  if (loading.value) return '计价中…'
  if (failed.value) return '暂不可用'
  const model = `tavily-${mode}`, rows = selectedModelPrices(pricing.value, model, creation.selectedGroup)
  const quote = invocationPoints(rows, pricing.value?.currency, { kind: 'text', model })
  if (!quote) return rows.some(row => row.details?.unit === 'tokens') ? '按量计费' : '暂无定价'
  const min = formatInvocationPoints(quote.min), max = formatInvocationPoints(quote.max)
  return `${min}${quote.min === quote.max ? '' : '–' + max} 积分/次`
}
watch(() => [session.user?.id, session.user?.accountId, creation.selectedGroup], () => {
  priceVersion++; pricing.value = undefined; loading.value = false; failed.value = false
  if (opened.value) void loadPrices(true)
}, { flush: 'sync' })
onBeforeUnmount(() => { priceVersion++ })

async function select(value: NativeChat['search']) {
  if (props.disabled) return
  emit('update:modelValue', value)
  menu.value?.close()
  await nextTick()
  root.value?.querySelector<HTMLButtonElement>('button')?.focus()
}
</script>

<template>
  <div ref="root" class="studio-search-control" :class="{ enabled: modelValue !== 'off' }">
    <StudioPopover ref="menu" label="联网搜索" :trigger-label="`联网搜索：${current.trigger}`" :width="300" :disabled="disabled" @toggle="loadPrices">
      <template #trigger><Globe :size="17" /><span>{{ current.trigger }}</span><ChevronDown :size="14" /></template>
      <div class="studio-search-options" role="group" aria-label="搜索模式">
        <button v-for="mode in modes" :key="mode.id" type="button" class="studio-command" :aria-label="mode.label" :aria-description="mode.id === 'off' ? undefined : price(mode.id)" :aria-pressed="modelValue === mode.id" :disabled="disabled" @click="select(mode.id)"><span class="search-mode-label">{{ mode.label }}</span><span v-if="mode.id !== 'off'" class="search-mode-price">{{ price(mode.id) }}</span><span class="search-mode-check" aria-hidden="true"><Check v-if="modelValue === mode.id" :size="19" /></span></button>
      </div>
    </StudioPopover>
  </div>
</template>

<style scoped>
.studio-search-control { flex: none; width: max-content; max-width: 100%; }
.studio-search-control.enabled :deep(> .studio-tool) { color: var(--ink); background: var(--state-selected); }
.studio-search-control.enabled :deep(> .studio-tool:hover:not(:disabled)), .studio-search-control.enabled :deep(> .studio-tool:active:not(:disabled)) { background: var(--state-pressed); }
.studio-search-control :deep(> .studio-tool) { gap: 6px; }
.studio-search-options { display: grid; gap: 4px; }
.studio-search-options .studio-command { min-height: 48px; padding: 12px; border-radius: 8px; }
.search-mode-label { flex: 1; min-width: 0; }
.search-mode-price { flex: none; font-size: 12px; color: var(--muted); font-variant-numeric: tabular-nums; overflow-wrap: anywhere; text-align: right; max-width: 55%; }
.studio-search-options .studio-command:is(:hover:not(:disabled), [aria-pressed="true"]) .search-mode-price { color: var(--ink); }
.search-mode-check { display: grid; place-items: center; flex: none; width: 19px; height: 19px; }
:global(.studio-popover:has(.studio-search-options) .studio-popover-content) { padding: 8px; }
</style>
