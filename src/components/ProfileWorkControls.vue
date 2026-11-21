<script setup lang="ts">
import { computed, ref } from 'vue'
import { ChevronDown, ListChecks, RotateCcw } from '@lucide/vue'
import { kindLabels } from '../data'
import StudioPopover from './StudioPopover.vue'
import '../studio-composer.css'

export interface ProfileWorkFilters { kind: string; visibility: 'all' | 'public' | 'private' | 'draft'; from: string; to: string }
const props = defineProps<{ filters: ProfileWorkFilters; own: boolean; worksTab: boolean; disabled?: boolean }>()
const emit = defineEmits<{ apply: [filters: ProfileWorkFilters]; select: [] }>()
const menu = ref<InstanceType<typeof StudioPopover>>()
const draft = ref<ProfileWorkFilters>({ ...props.filters }), error = ref('')
const active = computed(() => props.filters.kind !== 'all' || props.worksTab && props.filters.visibility !== 'all' || Boolean(props.filters.from || props.filters.to))
function opened(open: boolean) { if (open) { draft.value = { ...props.filters }; error.value = '' } }
function apply() {
  if (draft.value.from && draft.value.to && draft.value.from > draft.value.to) { error.value = '开始日期不能晚于结束日期。'; return }
  emit('apply', { ...draft.value })
  menu.value?.close()
}
function reset() { draft.value = { kind: 'all', visibility: 'all', from: '', to: '' }; apply() }
</script>
<template>
  <div class="profile-work-controls">
    <StudioPopover ref="menu" :label="own && worksTab ? '批量管理' : '筛选作品'" :width="360" placement="bottom-end" panel-class="profile-filter-popover" :disabled="disabled" @toggle="opened">
      <template #trigger><ListChecks :size="17" /><span>{{ own && worksTab ? '批量管理' : '筛选作品' }}</span><span v-if="active" class="filter-dot" aria-label="已筛选" /><ChevronDown :size="14" /></template>
      <form class="profile-filter-form" @submit.prevent="apply">
        <div class="filter-fields">
          <label class="field"><span>作品类型</span><select v-model="draft.kind" class="control" :disabled="disabled"><option value="all">全部类型</option><option v-for="(label, value) in kindLabels" :key="value" :value="value">{{ label }}</option></select></label>
          <label v-if="own && worksTab" class="field"><span>作品状态</span><select v-model="draft.visibility" class="control" :disabled="disabled"><option value="all">全部作品</option><option value="public">公开作品</option><option value="private">私密作品</option><option value="draft">草稿箱</option></select></label>
        </div>
        <p v-if="own && worksTab && draft.visibility === 'private'" class="filter-note">非草稿的未公开作品，包括待审核和未通过的作品。</p>
        <div class="date-filters"><label class="field"><span>开始日期</span><input v-model="draft.from" class="control" type="date" :max="draft.to || undefined" :disabled="disabled" /></label><label class="field"><span>结束日期</span><input v-model="draft.to" class="control" type="date" :min="draft.from || undefined" :disabled="disabled" /></label></div>
        <p v-if="error" class="form-error" role="alert">{{ error }}</p>
        <footer>
          <div class="filter-actions"><button type="button" class="studio-tool" :disabled="disabled" @click="reset"><RotateCcw :size="15" />重置</button><button type="submit" class="button btn primary" :disabled="disabled">应用筛选</button></div>
          <button v-if="own && worksTab" type="button" class="studio-command batch-action" :disabled="disabled" @click="menu?.close(); emit('select')"><ListChecks :size="17" />多选作品</button>
        </footer>
      </form>
    </StudioPopover>
  </div>
</template>
<style scoped>
.profile-work-controls { flex: none; margin-inline-start: auto; }.profile-work-controls :deep(> .studio-tool) { min-height: 44px; font-size: 13px; }
.profile-filter-form { display: grid; gap: 16px; min-width: 0; }.field { min-width: 0; font-size: 13px; }.control { width: 100%; min-width: 0; min-height: 40px; padding: 8px 10px; }.filter-fields, .date-filters { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.filter-fields > .field:only-child { grid-column: 1 / -1; }
.filter-note, .form-error { margin: 0; font-size: 12px; line-height: 20px; }.filter-note { color: var(--muted); }.filter-dot { width: 6px; height: 6px; flex: none; border-radius: 50%; background: currentColor; }
footer { position: sticky; bottom: -16px; z-index: 1; display: grid; gap: 8px; margin: 0 -16px -16px; padding: 12px 16px 16px; background: var(--popover-surface); }
.filter-actions { display: flex; justify-content: space-between; align-items: center; gap: 12px; }.batch-action { justify-content: center; background: var(--surface-soft); border-radius: 6px; }
:global(.profile-filter-popover) { background: var(--popover-surface); border: 0; border-radius: 8px; box-shadow: var(--popover-shadow); }
:global(.profile-filter-popover .studio-popover-heading) { position: sticky; top: 0; z-index: 2; padding: 8px 16px; background: var(--popover-surface); }
@media (max-width: 600px) { .control, footer button { min-height: 44px; } footer { padding-bottom: 16px; } :global(.profile-filter-popover) { border-radius: 16px 16px 0 0; } }
@media (max-width: 360px) { .date-filters { grid-template-columns: minmax(0, 1fr); } }
</style>
