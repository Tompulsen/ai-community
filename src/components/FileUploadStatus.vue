<script setup lang="ts">
import type { UploadFile } from '../use-file-uploads'
defineProps<{ file: UploadFile; disabled?: boolean }>()
defineEmits<{ retry: [] }>()
</script>

<template>
  <div v-if="file.upload" class="upload-feedback">
    <p role="status">{{ file.upload.state === 'failed' ? file.upload.error : file.upload.state === 'queued' ? '等待上传…' : file.upload.state === 'saving' ? '文件已传输，正在确认保存…' : file.upload.state === 'ready' ? (file.processing === 'pending' || file.processing === 'processing' ? '上传成功，后台处理中' : '上传成功') : file.upload.progress === undefined ? '准备上传…' : `正在上传 ${file.upload.progress}%` }}</p>
    <progress v-if="['queued', 'uploading', 'saving'].includes(file.upload.state)" :value="file.upload.state === 'saving' ? undefined : file.upload.progress" max="100" :aria-label="`${file.name}上传进度`" />
    <button v-if="file.upload.state === 'failed'" type="button" class="button subtle btn" :disabled="disabled" @click="$emit('retry')">重试上传</button>
  </div>
</template>

<style scoped>
.upload-feedback { width: 100%; min-width: 0; color: var(--muted); font-size: 12px; line-height: 20px; overflow-wrap: anywhere; }
.upload-feedback p { margin: 0; }
progress { display: block; width: 100%; height: 8px; margin-top: 4px; accent-color: var(--blue); }
</style>
