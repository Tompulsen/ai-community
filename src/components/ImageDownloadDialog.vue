<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Download, X } from '@lucide/vue'
import { session } from '../state'
import type { ImageDownloadFormat } from '../../shared/image-download'

const emit = defineEmits<{ decision: [format?: ImageDownloadFormat] }>()
const dialog = ref<HTMLDialogElement>(), selected = ref<ImageDownloadFormat>('jpeg')
const formats = [
  { value: 'jpeg', label: 'JPG / JPEG', description: '照片与社交分享 · 白色背景' },
  { value: 'png', label: 'PNG', description: '无损静态图片 · 保留透明背景' },
  { value: 'webp', label: 'WebP', description: '体积更小 · 支持透明与动画' },
  { value: 'gif', label: 'GIF', description: '兼容动图分享 · 最多 256 色' },
] as const
watch(() => `${session.user?.id}:${session.user?.accountId}`, () => emit('decision'))
onMounted(() => { dialog.value?.showModal(); dialog.value?.querySelector<HTMLInputElement>('input:checked')?.focus() })
onBeforeUnmount(() => dialog.value?.close())
</script>

<template>
  <dialog ref="dialog" class="image-download-dialog" aria-label="选择图片下载格式" @cancel.prevent="emit('decision')" @close="emit('decision')" @click.self="emit('decision')">
    <header><div><h2>下载图片</h2><p>选择适合你的文件格式</p></div><button type="button" class="icon-button" aria-label="关闭下载格式选择" @click="emit('decision')"><X :size="20" /></button></header>
    <fieldset><legend class="studio-sr-only">图片格式</legend><label v-for="format in formats" :key="format.value" :class="{ selected: selected === format.value }"><input v-model="selected" type="radio" name="image-download-format" :value="format.value" :aria-label="format.label" /><span><strong>{{ format.label }}</strong><small>{{ format.description }}</small></span></label></fieldset>
    <p class="format-note">动图选择 GIF / WebP 可保留动画；JPG / PNG 仅保存首帧。静态图片不会自动变成动画。</p>
    <footer><button type="button" class="button subtle btn" @click="emit('decision')">取消</button><button type="button" class="button btn" @click="emit('decision', selected)"><Download :size="17" aria-hidden="true" />确认下载</button></footer>
  </dialog>
</template>

<style scoped>
.image-download-dialog { box-sizing: border-box; width: min(420px, calc(100vw - 24px)); max-height: calc(100dvh - 24px); padding: 22px; overflow-y: auto; border: 1px solid var(--border); border-radius: 16px; background: var(--surface); color: var(--ink); box-shadow: 0 20px 64px rgb(0 0 0 / 30%); }
.image-download-dialog::backdrop { background: rgb(0 0 0 / 56%); }
header, footer { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
h2 { margin: 0; font-size: 18px; }header p { margin: 5px 0 0; color: var(--muted); font-size: 13px; }
header button { width: 44px; height: 44px; flex: none; }
fieldset { display: grid; gap: 8px; margin: 20px 0 12px; padding: 0; border: 0; }
label { display: flex; align-items: center; gap: 12px; min-height: 64px; padding: 10px 14px; border: 1px solid var(--border); border-radius: 10px; cursor: pointer; background: var(--canvas); }
label.selected { border-color: var(--blue); background: color-mix(in srgb, var(--blue) 8%, var(--canvas)); }
label:focus-within { outline: 2px solid var(--focus-ring); outline-offset: 2px; }
input { flex: none; width: 18px; height: 18px; margin: 0; accent-color: var(--blue); }
strong, small { display: block; }strong { font-size: 14px; }small { margin-top: 3px; color: var(--muted); font-size: 12px; line-height: 1.5; }
.format-note { margin: 0 0 20px; color: var(--muted); font-size: 12px; line-height: 1.7; }
footer { justify-content: flex-end; }footer button { min-height: 44px; }button:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: 2px; }
@media (max-width: 600px) { .image-download-dialog { margin: auto auto max(12px, env(safe-area-inset-bottom)); padding: 18px; } }
</style>
