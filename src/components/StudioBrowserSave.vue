<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { cacheCreationImages, type CreationTask } from '../native-studio'

const props = defineProps<{ task: CreationTask }>()
const element = ref<HTMLElement>()
let observer: IntersectionObserver | undefined
watch([element, () => props.task.id, () => props.task.owner, () => props.task.phase], () => {
  observer?.disconnect()
  if (!element.value || props.task.kind !== 'image' || props.task.phase !== 'complete') return
  const save = () => { observer?.disconnect(); void cacheCreationImages(props.task) }
  if (typeof IntersectionObserver === 'undefined') save()
  else {
    observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) save() })
    observer.observe(element.value)
  }
}, { flush: 'post' })
onBeforeUnmount(() => observer?.disconnect())
</script>

<template>
  <div v-if="task.kind === 'image' && task.phase === 'complete' && task.urls.length" ref="element" class="browser-save" :class="{ failed: task.browserSave?.state === 'failed' }" role="status" aria-live="polite">
    <template v-if="task.browserSave?.state === 'saved'"><span title="保存在当前账号使用的此浏览器中；清除网站数据会删除本地图片。">图片已保存到此浏览器</span></template>
    <template v-else-if="task.browserSave?.state === 'failed'"><span>{{ task.browserSave.error || '图片未能保存到此浏览器。' }}</span><button class="studio-tool" type="button" @click.stop="cacheCreationImages(task, true)">重试保存图片</button></template>
    <span v-else>生成完成，正在保存图片到此浏览器<span v-if="task.browserSave?.total">（{{ task.browserSave.completed || 0 }}/{{ task.browserSave.total }}）</span>…</span>
  </div>
</template>

<style scoped>
.browser-save { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; margin-top: 8px; color: var(--muted); font-size: 12px; line-height: 1.5; overflow-wrap: anywhere; }
.browser-save.failed { color: var(--danger); }
.browser-save .studio-tool { min-height: 44px; color: var(--ink); }
</style>
