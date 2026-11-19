<script setup lang="ts">
import { ArrowDown, ArrowLeftRight, ArrowUp, FileText, Trash2 } from '@lucide/vue'
import type { WorkFile } from '../data'

defineProps<{ files: WorkFile[]; reference?: boolean; featured?: boolean }>()
const emit = defineEmits<{ move: [index: number, direction: number]; role: [index: number]; remove: [index: number] }>()
</script>

<template>
  <ul class="attachment-list" :class="{ featured }">
    <li v-for="(file, index) in files" :key="file.id">
      <a v-if="featured && index === 0 && file.type.startsWith('image/')" :href="file.url" target="_blank" rel="noopener noreferrer" class="attachment-preview" :aria-label="`查看 ${file.name}`"><img :src="file.url" :alt="file.name" /></a>
      <video v-if="file.type.startsWith('video/')" :src="file.url" :aria-label="file.name" controls playsinline preload="metadata" />
      <a v-else :href="file.url" target="_blank" rel="noopener noreferrer" class="file-name" :title="file.name"><img v-if="file.type.startsWith('image/') && !(featured && index === 0)" :src="file.thumbnailUrl || file.url" alt="" /><FileText v-else-if="!file.type.startsWith('image/')" :size="24" aria-hidden="true" /><span>{{ file.name }}</span></a>
      <div class="table-actions">
        <button type="button" class="icon-button" aria-label="向前移动" title="向前移动" :disabled="index === 0" @click="emit('move', index, -1)"><ArrowUp :size="16" /></button>
        <button type="button" class="icon-button" aria-label="向后移动" title="向后移动" :disabled="index === files.length - 1" @click="emit('move', index, 1)"><ArrowDown :size="16" /></button>
        <button v-if="reference || file.type.startsWith('image/')" type="button" class="icon-button" :aria-label="reference ? '移至作品文件' : '移至参考图'" :title="reference ? '移至作品文件' : '移至参考图'" @click="emit('role', index)"><ArrowLeftRight :size="16" /></button>
        <button type="button" class="icon-button" :aria-label="`移除 ${file.name}`" title="移除附件" @click="emit('remove', index)"><Trash2 :size="16" /></button>
      </div>
    </li>
  </ul>
</template>

<style scoped>
.attachment-list { padding: 0; margin: 0; list-style: none; }
.attachment-list li { display: flex; align-items: center; flex-wrap: wrap; gap: 12px; padding-block: 12px; border-bottom: 1px solid var(--border); }
.file-name { display: flex; align-items: center; gap: 12px; flex: 1; min-width: 0; }
.file-name img { flex: none; width: 80px; height: 80px; object-fit: contain; border-radius: 4px; background: var(--surface-soft); }
.file-name span { min-width: 0; overflow-wrap: anywhere; font-size: 12px; line-height: 18px; }
video { width: min(100%, 280px); max-height: 180px; border-radius: 4px; }
.table-actions { margin-left: auto; flex-wrap: wrap; gap: 0; }
.icon-button { width: 44px; height: 44px; }
.featured li:first-child { padding-top: 0; }
.featured li:last-child { border-bottom: 0; padding-bottom: 0; }
.featured .file-name { flex-basis: 64px; }
.featured .file-name span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.featured .file-name img { width: 48px; height: 48px; }
.featured .icon-button { border: 0; background: transparent; color: var(--muted); }
.featured .icon-button:hover:not(:disabled) { background: var(--surface-soft); color: var(--ink); }
.attachment-preview { display: block; width: 100%; border-radius: 8px; background: var(--surface-soft); }
.attachment-preview img { display: block; width: 100%; height: 260px; object-fit: contain; border-radius: inherit; }
.featured video { width: 100%; height: 260px; max-height: none; background: var(--surface-soft); }
@media (max-width: 639px) { .file-name { flex-basis: 100%; } }
@media (max-width: 699px) { .attachment-preview img, .featured video { height: 180px; } }
</style>
