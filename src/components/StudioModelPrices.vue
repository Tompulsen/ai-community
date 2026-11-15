<!-- Adapted from octopus_chat account-model-pricing.tsx / .module.scss (MIT). -->
<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { RefreshCw, Search } from '@lucide/vue'
import { errorMessage, session } from '../state'
import { studioAccount } from '../studio-account'
import type { ModelPriceRow, ModelPricing } from '../../server/native-account/pricing'
import StudioModelPriceCard from './StudioModelPriceCard.vue'

const props = withDefaults(defineProps<{ model?: string }>(), { model: '' })
const data = ref<ModelPricing>(), error = ref(''), query = ref(''), loading = ref(false)
let revision = 0
async function load() {
  const current = ++revision, owner = session.user?.id, accountId = session.user?.accountId || owner
  data.value = undefined; error.value = ''
  if (!owner) { loading.value = false; return }
  loading.value = true
  try {
    const result = await studioAccount<ModelPricing>('model-pricing')
    if (current !== revision || owner !== session.user?.id || accountId !== (session.user?.accountId || session.user?.id)) return
    if (result.userId !== Number(accountId)) throw new Error('账号已变化，请刷新价格。')
    if (!Array.isArray(result.rows)) throw new Error('模型价格数据不可用。')
    data.value = result
  } catch (cause) { if (current === revision) error.value = errorMessage(cause) }
  finally { if (current === revision) loading.value = false }
}
const models = computed(() => {
  const grouped = new Map<string, ModelPriceRow[]>()
  for (const row of [...(data.value?.rows || [])].sort((a, b) => a.model.localeCompare(b.model) || a.group.localeCompare(b.group))) {
    const group = grouped.get(row.model)
    if (group) group.push(row)
    else grouped.set(row.model, [row])
  }
  return [...grouped.entries()].sort(([a], [b]) => Number(b === props.model) - Number(a === props.model))
})
const rows = computed(() => models.value.filter(([name, prices]) => name === props.model || `${name} ${prices.map(row => row.group).join(' ')}`.toLowerCase().includes(query.value.trim().toLowerCase())))
const missingModel = computed(() => props.model && data.value && !models.value.some(([name]) => name === props.model))
watch(() => [session.user?.id, session.user?.accountId], () => { query.value = ''; void load() }, { immediate: true })
onBeforeUnmount(() => { revision++ })
</script>

<template>
  <section class="model-prices" aria-label="模型广场">
    <header class="prices-heading"><h2>模型广场</h2><div class="prices-toolbar">
      <label class="prices-search"><Search :size="15" aria-hidden="true" /><input v-model="query" type="search" aria-label="搜索模型价格" placeholder="搜索模型或分组" :disabled="!data" /></label>
      <span v-if="data" class="prices-count" role="status">{{ query.trim() ? `${rows.length} / ` : '' }}{{ models.length }} 个模型</span>
      <button type="button" class="studio-tool" aria-label="刷新价格" title="刷新价格" :disabled="loading" @click="load"><RefreshCw :size="15" aria-hidden="true" /></button>
    </div></header>
    <p v-if="missingModel" class="prices-state" role="status">{{ model }}：模型广场暂未提供此模型的可用价格，请查看模型详情。</p>
    <p v-if="loading" class="prices-state" role="status">正在读取模型价格…</p>
    <div v-if="error" class="prices-state form-error" role="alert"><p>{{ error }}</p><button type="button" class="studio-tool" @click="load"><RefreshCw :size="15" />重新读取</button></div>
    <template v-if="data">
      <div v-if="rows.length" class="model-price-grid"><StudioModelPriceCard v-for="[name, prices] in rows" :key="name" :rows="prices" :featured="name === model" /></div>
      <p v-else class="prices-state" role="status">{{ models.length ? '没有匹配的模型，试试其他名称。' : '模型广场暂未提供可用价格。' }}</p>
      <p class="prices-note">每次请求为单次调用价格；按量模型分别列出输入、输出价格。动态计费及图片、音频等附加费用以模型广场详情为准。</p>
    </template>
  </section>
</template>

<style scoped>
.model-prices { container-type: inline-size; min-width: 0; padding-top: 24px; color: var(--ink); font-size: 13px; line-height: 1.5; }
.prices-heading { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px 20px; margin-bottom: 20px; }
.prices-heading h2 { margin: 0; font-size: 16px; font-weight: 500; line-height: 24px; }
.prices-toolbar { display: flex; align-items: center; justify-content: flex-end; gap: 12px; min-width: 0; margin-left: auto; }
.prices-search { display: flex; align-items: center; gap: 8px; width: 200px; min-width: 0; min-height: 36px; padding: 0 10px; border-radius: 6px; background: var(--surface-soft); color: var(--muted); }
.prices-search input { width: 100%; min-width: 0; padding: 6px 0; border: 0; border-radius: 0; outline: none; background: transparent; color: var(--ink); caret-color: var(--ink); font: inherit; }
.prices-search input::placeholder { color: var(--muted); opacity: 1; }
.prices-search:focus-within { outline: 1px solid var(--muted); outline-offset: 2px; }
.prices-count { flex: none; color: var(--muted); font-size: 12px; font-variant-numeric: tabular-nums; white-space: nowrap; }
.model-price-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); align-items: stretch; gap: 16px; }
.prices-state { margin: 0; padding: 20px 0; overflow-wrap: anywhere; }
.prices-note { margin: 16px 0 0; color: var(--muted); font-size: 12px; }
@container (max-width: 800px) { .model-price-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@container (max-width: 520px) { .prices-heading { margin-bottom: 16px; }.prices-toolbar { width: 100%; gap: 8px; }.prices-search { flex: 1; width: auto; }.model-price-grid { grid-template-columns: minmax(0, 1fr); } }
@media (max-width: 600px), (pointer: coarse) { .prices-toolbar > .studio-tool { min-width: 44px; min-height: 44px; }.prices-search { min-height: 44px; }.prices-search input { font-size: 16px; } }
</style>
