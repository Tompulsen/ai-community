<!-- Vue adaptation of octopus_chat MaterialStatus (MIT). -->
<script setup lang="ts">
import { CircleAlert, File, Image, LoaderCircle, Music, RotateCw, Square, Video, X } from '@lucide/vue'
import { computed } from 'vue'
import { formatMaterialSize } from '../../../shared/studio/file-upload'
import type { MaterialUploadItem } from '../../../shared/studio/material-upload'
const props = defineProps<{ items: MaterialUploadItem[]; disabled?: boolean }>()
defineEmits<{ remove: [id: string]; retry: []; cancel: [] }>()
const processing = computed(() => props.items.some(item => item.status === 'processing'))
const failed = computed(() => props.items.some(item => item.status === 'failed'))
</script>
<template>
  <section v-if="items.length" class="material-status" aria-label="附件处理状态" :aria-busy="processing">
    <header><span role="status">{{ processing ? '正在处理附件' : failed ? '部分附件处理失败' : '附件已就绪' }}</span><button v-if="processing" type="button" title="取消附件处理" aria-label="取消附件处理" :disabled="disabled" @click="$emit('cancel')"><Square :size="14" /></button><button v-else-if="failed" type="button" title="重试失败附件" aria-label="重试失败附件" :disabled="disabled" @click="$emit('retry')"><RotateCw :size="14" /></button></header>
    <ul><li v-for="item in items" :key="item.id" :data-file-status="item.status">
      <div class="material-item"><component :is="item.type.startsWith('image/') ? Image : item.type.startsWith('video/') ? Video : item.type.startsWith('audio/') ? Music : File" :size="15" aria-hidden="true" /><span class="material-name">{{ item.name }}</span><span class="material-size">{{ formatMaterialSize(item.size) }}</span><span class="material-state"><LoaderCircle v-if="item.status === 'processing'" :size="13" /><CircleAlert v-else-if="item.status === 'failed'" :size="13" />{{ item.status === 'processing' ? '处理中' : item.status === 'failed' ? '失败' : '就绪' }}</span><button type="button" :title="`移除附件 ${item.name}`" :aria-label="`移除附件 ${item.name}`" :disabled="disabled" @click="$emit('remove', item.id)"><X :size="14" /></button></div>
      <p v-if="item.error" class="material-error" role="alert">{{ item.error }}</p>
    </li></ul>
  </section>
</template>
<style scoped>
.material-status { min-width: 0; max-height: 180px; overflow: auto; margin: 8px; color: var(--muted); font-size: 12px; }
header, .material-item, .material-state { display: flex; align-items: center; gap: 8px; }header { min-height: 32px; justify-content: space-between; }
ul { list-style: none; padding: 0; margin: 0; }li { padding-block: 2px; }.material-name { min-width: 0; flex: 1; overflow-wrap: anywhere; color: var(--ink); }.material-size, .material-state { flex: none; font-variant-numeric: tabular-nums; }.material-item > svg { flex: none; }
button { display: inline-grid; place-items: center; flex: none; min-width: 32px; min-height: 32px; padding: 4px; border: 0; border-radius: 6px; background: transparent; color: var(--muted); cursor: pointer; }button:hover { background: var(--surface-soft); color: var(--ink); }button:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: var(--focus-outline-offset); }button:disabled { opacity: .5; cursor: default; }
.material-error { margin: 2px 0 6px 23px; color: var(--danger); overflow-wrap: anywhere; }
@media (max-width: 600px), (pointer: coarse) { button { min-width: 44px; min-height: 44px; }.material-size { display: none; }.material-status { max-height: 140px; } }
</style>
