<script setup lang="ts">
import { computed, ref, useId, watch } from 'vue'
import { Check, ChevronDown, X } from '@lucide/vue'
import { kindLabels, type WorkKind, type WorkTag } from '../data'

const props = defineProps<{ tags: WorkTag[]; kind: WorkKind; checkboxes?: boolean }>()
const selected = defineModel<string[]>({ required: true })
const expanded = ref(false), query = ref(''), catalogId = useId()
const kinds: WorkKind[] = ['image', 'video', 'resource']
const quickTags = computed(() => props.tags.filter(tag => tag.category === props.kind).slice(0, 8))
const groups = computed(() => kinds.map(kind => ({ kind, tags: props.tags.filter(tag => tag.category === kind && tag.name.toLocaleLowerCase().includes(query.value.trim().toLocaleLowerCase())) })).filter(group => group.tags.length))
const selectedTags = computed(() => selected.value.map(id => props.tags.find(tag => tag.id === id) ?? { id, name: '已失效标签', category: props.kind }))
const more = computed(() => props.tags.length > quickTags.value.length)
watch(() => props.kind, () => { expanded.value = false; query.value = '' })
function toggle(id: string) {
  if (selected.value.includes(id)) selected.value = selected.value.filter(value => value !== id)
  else if (selected.value.length < 3) selected.value = [...selected.value, id]
}
function toggleMore() { expanded.value = !expanded.value; query.value = '' }
</script>

<template>
  <div class="tag-picker">
    <div v-if="selectedTags.length" class="selected-tags" role="group" aria-label="已选标签">
      <span class="form-note">已选</span>
      <button v-for="tag in selectedTags" :key="tag.id" type="button" class="publication-tag selected" :aria-label="`移除标签 ${tag.name}（${kindLabels[tag.category]}）`" @click="toggle(tag.id)"><span>{{ tag.name }}<small>（{{ kindLabels[tag.category] }}）</small></span><X :size="14" aria-hidden="true" /></button>
    </div>
    <div v-if="!expanded" class="publication-tag-options" role="group" aria-label="快捷标签">
      <template v-for="tag in quickTags" :key="tag.id">
        <label v-if="checkboxes" class="publication-tag" :class="{ selected: selected.includes(tag.id) }"><input type="checkbox" :checked="selected.includes(tag.id)" :disabled="!selected.includes(tag.id) && selected.length >= 3" @change="toggle(tag.id)" /><span>{{ tag.name }}</span></label>
        <button v-else type="button" class="publication-tag" :aria-pressed="selected.includes(tag.id)" :disabled="!selected.includes(tag.id) && selected.length >= 3" @click="toggle(tag.id)"><Check v-if="selected.includes(tag.id)" :size="14" aria-hidden="true" /># {{ tag.name }}</button>
      </template>
    </div>
    <button v-if="more" type="button" class="button subtle tag-more" :aria-expanded="expanded" :aria-controls="catalogId" @click="toggleMore">{{ expanded ? '收起标签' : `更多标签（${tags.length}）` }}<ChevronDown :size="16" :class="{ expanded }" aria-hidden="true" /></button>
    <div v-show="expanded" :id="catalogId" class="tag-expanded">
      <label class="field"><span>搜索全部标签</span><input v-model="query" class="control" type="search" placeholder="输入标签名称" @keydown.enter.prevent /></label>
      <div class="tag-catalog">
        <div v-for="group in groups" :key="group.kind" class="tag-group" role="group" :aria-label="`${kindLabels[group.kind]}标签`">
          <p class="form-note">{{ kindLabels[group.kind] }} <span>{{ group.tags.length }}</span></p>
          <div class="publication-tag-options">
            <template v-for="tag in group.tags" :key="tag.id">
              <label v-if="checkboxes" class="publication-tag" :class="{ selected: selected.includes(tag.id) }"><input type="checkbox" :checked="selected.includes(tag.id)" :disabled="!selected.includes(tag.id) && selected.length >= 3" @change="toggle(tag.id)" /><span>{{ tag.name }}</span></label>
              <button v-else type="button" class="publication-tag" :aria-pressed="selected.includes(tag.id)" :disabled="!selected.includes(tag.id) && selected.length >= 3" @click="toggle(tag.id)"><Check v-if="selected.includes(tag.id)" :size="14" aria-hidden="true" /># {{ tag.name }}</button>
            </template>
          </div>
        </div>
        <p v-if="!groups.length" class="form-note" role="status">没有匹配的标签，试试其他关键词。</p>
      </div>
    </div>
    <p v-if="selected.length >= 3" class="form-note" role="status">已选满 3 个标签，可取消已选标签后更换。</p>
  </div>
</template>

<style scoped>
.tag-picker, .tag-expanded { display: grid; gap: 12px; min-width: 0; }
.tag-picker { margin-top: 12px; }
.selected-tags { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
.selected-tags .publication-tag { justify-content: space-between; }
.selected-tags small { font-size: 12px; color: inherit; }
.selected-tags svg { flex: none; }
.tag-more { justify-self: start; min-height: 44px; }
.tag-more .expanded { transform: rotate(180deg); }
.tag-catalog { display: grid; gap: 16px; max-height: 280px; overflow-y: auto; overscroll-behavior: contain; }
.tag-group > p { margin-bottom: 8px; }
.tag-group > p span { margin-left: 8px; }
.tag-group .publication-tag-options { max-height: none; overflow: visible; }
</style>
