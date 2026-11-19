<!-- Adapted from octopus_chat account-model-pricing.tsx / .module.scss (MIT). -->
<script setup lang="ts">
import { computed, onBeforeUnmount, ref, useId } from 'vue'
import { ChevronRight, Copy, X } from '@lucide/vue'
import { creation } from '../native-studio'
import { errorMessage, notify } from '../state'
import type { ModelPriceRow } from '../../server/native-account/pricing'

const props = defineProps<{ rows: ModelPriceRow[]; featured?: boolean }>()
type PriceTier = NonNullable<ModelPriceRow['details']>['tiers'][number]
const group = ref(props.rows.some(row => row.group === creation.selectedGroup) ? creation.selectedGroup : props.rows[0]?.group || '')
const row = computed(() => props.rows.find(entry => entry.group === group.value) || props.rows[0])
const tier = computed(() => row.value?.details?.tiers[0])
const extraCount = computed(() => new Set(row.value?.details?.tiers.flatMap(entry => entry.extras?.map(charge => charge.label) || [])).size)
const billing = computed(() => row.value?.details ? row.value.billing === '每次请求' ? '按次计费' : row.value.billing.split(' · ')[0] : row.value?.billing)
const unit = computed(() => row.value?.details?.unit === 'tokens' ? '每百万 tokens' : '每次请求')
const dialog = ref<HTMLDialogElement>(), titleId = `price-detail-${useId()}`, error = ref('')
const priceValues = (value: PriceTier) => value.perRequest !== undefined ? [['单次调用', value.perRequest]] : [['输入', value.input], ['输出', value.output]]
async function copy() {
  if (!row.value) return
  try { await navigator.clipboard.writeText(row.value.model); error.value = ''; notify('已复制模型名称。') }
  catch (cause) { error.value = `复制失败：${errorMessage(cause)}` }
}
onBeforeUnmount(() => dialog.value?.close())
</script>

<template>
  <article v-if="row" class="model-price-card" :aria-label="`${row.model} 模型价格`">
    <header class="price-card-heading">
      <span class="price-avatar" aria-hidden="true">{{ Array.from(row.model)[0]?.toUpperCase() }}</span>
      <div class="price-identity"><h3>{{ row.model }}</h3><p>{{ billing }}</p><span v-if="featured" class="price-featured">本次调用模型</span></div>
      <button type="button" class="studio-tool price-command" :aria-label="`复制 ${row.model} 名称`" title="复制模型名称" @click="copy"><Copy :size="15" aria-hidden="true" /></button>
    </header>
    <template v-if="tier">
      <dl class="price-values"><div v-for="[label, value] in priceValues(tier)" :key="label"><dt>{{ label }}</dt><dd>{{ value ?? '—' }}</dd></div></dl>
      <div class="price-unit"><span>{{ unit }}</span><button v-if="extraCount" type="button" class="price-extras" @click="dialog?.showModal()">{{ extraCount }} 项缓存费用</button><span v-if="tier.context" class="price-context">{{ tier.context }}</span></div>
    </template>
    <p v-else class="price-fallback">{{ row.price }}</p>
    <p v-if="error" class="form-error" role="alert">{{ error }}</p>
    <footer class="price-card-footer">
      <select v-if="rows.length > 1" v-model="group" class="price-group select-control" :aria-label="`${row.model} 计费分组`"><option v-for="entry in rows" :key="entry.group" :value="entry.group">{{ entry.group }}</option></select>
      <span v-else class="price-single-group">{{ row.group }}</span>
      <button type="button" class="studio-tool price-command" :aria-label="`查看 ${row.model} 价格详情`" @click="dialog?.showModal()">{{ row.details && row.details.tiers.length > 1 ? '分档详情' : '详情' }}<ChevronRight :size="14" aria-hidden="true" /></button>
    </footer>
    <Teleport to="body"><dialog ref="dialog" class="compact-dialog model-price-dialog" :aria-labelledby="titleId" @click="($event.target === dialog) && dialog?.close()">
      <header class="dialog-heading"><h2 :id="titleId">模型计费详情</h2><button type="button" class="icon-button" aria-label="关闭模型计费详情" title="关闭" @click="dialog?.close()"><X :size="18" /></button></header>
      <div class="dialog-body price-details"><h3>{{ row.model }}</h3><p class="price-detail-note">{{ row.group }} · {{ row.billing }}</p>
        <template v-if="row.details"><section v-for="(entry, index) in row.details.tiers" :key="index" class="price-tier" :aria-label="entry.context || '计费价格'">
          <h4 v-if="entry.context">{{ entry.context }}</h4>
          <dl class="price-values"><div v-for="[label, value] in priceValues(entry)" :key="label"><dt>{{ label }}</dt><dd>{{ value ?? '—' }}</dd></div></dl>
          <dl v-if="entry.extras?.length" class="price-extra-values"><div v-for="charge in entry.extras" :key="charge.label"><dt>{{ charge.label }}</dt><dd>{{ charge.amount }}</dd></div></dl>
        </section><p class="price-detail-note">{{ unit }}</p></template>
        <p v-else class="price-fallback">{{ row.price }}</p>
      </div>
    </dialog></Teleport>
  </article>
</template>

<style scoped>
.model-price-card { display: flex; flex-direction: column; gap: 12px; min-width: 0; min-height: 232px; padding: 16px; border-radius: 8px; background: var(--surface); }
.model-price-card :is(h3, p, dl, dd), .price-details :is(h3, h4, p, dl, dd) { margin: 0; }
.price-card-heading { display: flex; align-items: flex-start; gap: 8px; min-width: 0; }
.price-avatar { display: grid; place-items: center; flex: 0 0 32px; width: 32px; height: 32px; border-radius: 8px; background: var(--surface-soft); color: var(--muted); font-weight: 500; }
.price-identity { flex: 1; min-width: 0; }
.price-identity h3 { font-size: 13px; font-weight: 500; line-height: 19px; overflow-wrap: anywhere; }
.price-identity p { padding-top: 3px; color: var(--muted); font-size: 12px; }
.price-featured { display: inline-block; margin-top: 4px; color: var(--ink); font-size: 12px; }
.price-command { flex: none; min-width: 32px; min-height: 32px; padding: 4px 6px; color: var(--ink); }
.price-values { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; padding-top: 8px; font-variant-numeric: tabular-nums; }
.price-values > div { display: grid; gap: 4px; min-width: 0; }
.price-values dt { color: var(--muted); font-size: 12px; }
.price-values dd { font-size: 19px; font-weight: 500; line-height: 26px; overflow-wrap: anywhere; }
.price-unit { display: flex; align-items: baseline; flex-wrap: wrap; gap: 4px 12px; min-height: 18px; color: var(--muted); font-size: 12px; }
.price-context { flex-basis: 100%; overflow-wrap: anywhere; }
.price-extras { padding: 0; color: var(--muted); font-size: 12px; text-decoration: underline; text-underline-offset: 3px; cursor: pointer; }
.price-fallback { padding-top: 8px; font-size: 14px; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; white-space: pre-line; }
.price-card-footer { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-width: 0; margin-top: auto; padding-top: 4px; color: var(--muted); font-size: 12px; }
.price-single-group { min-width: 0; overflow-wrap: anywhere; }
.price-group { width: auto; min-width: 0; max-width: calc(100% - 72px); min-height: var(--control-size, var(--control-height)); padding: var(--control-padding, 8px 12px); border: 0; border-radius: 6px; background: var(--surface-soft); font-family: inherit; font-size: var(--control-font-size, var(--font-size-input)); line-height: var(--control-line-height, 24px); color: var(--ink); text-overflow: ellipsis; }
.price-group option { background: var(--surface); color: var(--ink); }
.model-price-dialog { width: min(480px, calc(100vw - 24px)); }
.price-details { font-size: 13px; line-height: 1.5; }
.price-details h3 { font-size: 15px; font-weight: 500; line-height: 22px; overflow-wrap: anywhere; }
.price-details .price-detail-note { margin-top: 8px; color: var(--muted); font-size: 12px; overflow-wrap: anywhere; }
.price-tier { margin-top: 20px; }
.price-tier h4 { margin-bottom: 12px; font-size: 12px; font-weight: 500; }
.price-details .price-values { padding: 0; }
.price-details .price-values dd { font-size: 16px; line-height: 24px; }
.price-details .price-extra-values { display: grid; gap: 12px; margin-top: 20px; }
.price-extra-values > div { display: flex; justify-content: space-between; align-items: baseline; gap: 16px; }
.price-extra-values dt { color: var(--muted); }
.price-extra-values dd { font-variant-numeric: tabular-nums; text-align: end; overflow-wrap: anywhere; }
.form-error { font-size: 12px; overflow-wrap: anywhere; }
@media (max-width: 600px), (pointer: coarse) { .price-command, .price-extras, .price-group { min-width: 44px; min-height: 44px; }.model-price-card { min-height: 244px; } }
</style>
