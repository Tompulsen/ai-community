<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script setup lang="ts">
import { computed, ref } from 'vue'
import { ImagePlus } from '@lucide/vue'
import type { Work, WorkFile } from '../data'
import StudioPopover from './StudioPopover.vue'
const props = defineProps<{ source: Work; selected: string[]; disabled?: boolean }>()
const emit = defineEmits<{ select: [files: WorkFile[]] }>()
const menu = ref<InstanceType<typeof StudioPopover>>(), chosen = ref<string[]>([])
const files = computed(() => (props.source.referenceFiles || []).filter(file => file.type.startsWith('image/')))
function opened(open: boolean) { if (open) chosen.value = files.value.filter(file => props.selected.includes(file.url)).map(file => file.id) }
function apply() { emit('select', files.value.filter(file => chosen.value.includes(file.id))); menu.value?.close() }
</script>
<template>
  <StudioPopover ref="menu" label="选择原作参考图" :width="520" @toggle="opened">
    <template #trigger><ImagePlus :size="17" /><span>参考图</span></template>
    <p class="reference-help">可选择作者公开的参考图，也可在输入区上传自己的图片。</p>
    <div v-if="files.length" class="source-reference-grid"><label v-for="file in files" :key="file.id"><img :src="file.url" alt="" loading="lazy" /><span><input v-model="chosen" type="checkbox" :value="file.id" :disabled="disabled" />{{ file.name }}</span></label></div>
    <p v-else class="reference-help">作者没有公开参考图。</p>
    <button class="button primary btn" :disabled="disabled" @click="apply">{{ chosen.length ? `使用选中的 ${chosen.length} 张参考图` : '不使用原作参考图' }}</button>
  </StudioPopover>
</template>
<style scoped>
.reference-help { color: var(--muted); font-size: 14px; line-height: 22px; margin: 0 0 16px; }
.source-reference-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; max-height: 45dvh; overflow-y: auto; margin-bottom: 16px; }
.source-reference-grid label { cursor: pointer; min-width: 0; border: 1px solid var(--border); border-radius: 8px; overflow: hidden; }
.source-reference-grid label:has(:checked) { border-color: var(--focus-ring); background: var(--surface); }
.source-reference-grid img { width: 100%; aspect-ratio: 4 / 3; object-fit: cover; display: block; }
.source-reference-grid span { display: flex; align-items: center; gap: 8px; padding: 8px; min-height: 44px; font-size: 13px; overflow-wrap: anywhere; }
.source-reference-grid input { flex: none; }
</style>
