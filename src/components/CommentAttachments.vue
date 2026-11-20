<script setup lang="ts">
import { File, RotateCw, Video, X } from '@lucide/vue'
import type { CommentAttachment } from '../use-comment-composer'
defineProps<{ items: CommentAttachment[]; removable?: boolean }>()
defineEmits<{ remove: [id: string]; retry: [id: string] }>()
const size = (bytes: number) => bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(bytes / 1024)} KB`
const state = (item: CommentAttachment) => ({ queued: '等待上传', uploading: item.progress === undefined ? '连接中' : `上传中 ${item.progress}%`, saving: '正在保存', ready: '已上传', failed: '上传失败' })[item.state]
</script>
<template>
  <ul v-if="items.length" class="comment-attachments" aria-label="评论附件状态">
    <li v-for="item in items" :key="item.id" :data-upload-state="item.state">
      <img v-if="item.preview" :src="item.preview" :alt="item.name" /><span v-else class="file-preview"><Video v-if="item.type.startsWith('video/')" :size="22" /><File v-else :size="22" /></span>
      <div class="attachment-info"><span class="attachment-name" :title="item.name">{{ item.name }}</span><span class="attachment-meta">{{ size(item.size) }} · <span role="status">{{ state(item) }}</span></span><progress v-if="['uploading', 'saving'].includes(item.state)" :aria-label="`${item.name} 上传进度`" :value="item.state === 'uploading' ? item.progress : undefined" max="100" /><p v-if="item.error" role="alert">{{ item.error }}</p></div>
      <button v-if="item.state === 'failed'" type="button" class="icon-button" :aria-label="`重试上传 ${item.name}`" :title="`重试上传 ${item.name}`" @click="$emit('retry', item.id)"><RotateCw :size="16" /></button>
      <button v-if="removable" type="button" class="icon-button" :aria-label="`移除 ${item.name}`" :title="`移除 ${item.name}`" @click="$emit('remove', item.id)"><X :size="16" /></button>
    </li>
  </ul>
</template>
<style scoped>
.comment-attachments { display: grid; gap: 8px; margin: 0; padding: 0; list-style: none; min-width: 0; max-height: 232px; overflow: auto; }
li { display: flex; align-items: center; gap: 8px; min-width: 0; }
img, .file-preview { width: 48px; height: 48px; flex: none; border-radius: 4px; object-fit: cover; background: var(--surface-soft); }
.file-preview { display: grid; place-items: center; color: var(--muted); }.attachment-info { flex: 1; min-width: 0; }.attachment-name { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; }.attachment-meta { color: var(--muted); font-size: 12px; font-variant-numeric: tabular-nums; }progress { display: block; width: 100%; margin-top: 4px; accent-color: var(--blue); }p { margin: 4px 0 0; color: var(--danger); font-size: 12px; overflow-wrap: anywhere; }.icon-button { flex: none; width: 36px; min-height: 44px; }
</style>
