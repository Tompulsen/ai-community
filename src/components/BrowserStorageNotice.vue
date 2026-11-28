<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { browserStorageChangedEvent, browserStorageWriteFailure, formatStorageBytes, refreshBrowserStorage, type BrowserStorageEstimate } from '../browser-storage'

const estimate = ref<BrowserStorageEstimate>(), failure = ref(browserStorageWriteFailure())
const dismissKey = 'community:storage-notice-dismissed:v1'
function savedDismissals(): string[] {
  try {
    const saved = JSON.parse(sessionStorage.getItem(dismissKey) || '[]')
    return Array.isArray(saved) ? saved.filter(value => value === 'mild' || value === 'strong') : []
  } catch { return [] }
}
const dismissed = ref<string[]>(savedDismissals())
const level = computed(() => failure.value ? 'failure' : estimate.value?.pressure || 'unknown')
const visible = computed(() => ['mild', 'strong', 'failure'].includes(level.value) && !dismissed.value.includes(level.value))
let timer: ReturnType<typeof setInterval> | undefined, active = true
function dismiss() {
  dismissed.value.push(level.value)
  try { sessionStorage.setItem(dismissKey, JSON.stringify(dismissed.value.filter(value => value !== 'failure'))) } catch { /* Dismissal still works for this page when browser storage is unavailable. */ }
}
async function refresh() {
  failure.value = browserStorageWriteFailure()
  if (document.visibilityState === 'hidden') return
  const next = await refreshBrowserStorage()
  if (active) estimate.value = next
}
onMounted(() => {
  void refresh()
  window.addEventListener(browserStorageChangedEvent, refresh)
  document.addEventListener('visibilitychange', refresh)
  timer = setInterval(() => void refresh(), 60_000)
})
onBeforeUnmount(() => {
  active = false; clearInterval(timer)
  window.removeEventListener(browserStorageChangedEvent, refresh)
  document.removeEventListener('visibilitychange', refresh)
})
</script>

<template>
  <aside v-if="visible" class="browser-storage-notice" :class="{ strong: level !== 'mild' }" aria-label="浏览器存储提醒">
    <div role="status">
      <strong>{{ failure ? '本地数据保存遇到问题' : level === 'strong' ? '建议尽快整理浏览器存储' : '浏览器存储使用较多' }}</strong>
      <p v-if="failure">{{ failure === 'quota' ? '浏览器报告存储空间不足。' : '浏览器未能完成本地保存。' }}请先下载重要原图，再检查本地存储。</p>
      <p v-else>本站在此浏览器中约使用 {{ formatStorageBytes(estimate?.usage ?? null) }}。可下载重要原图并整理缩略图缓存；此数值不代表运行内存。</p>
    </div>
    <div class="notice-actions"><a href="/account?tab=storage">查看存储</a><a href="/storage-recovery">恢复入口</a><button type="button" @click="dismiss">暂时收起</button></div>
  </aside>
</template>

<style scoped>
.browser-storage-notice { display: flex; align-items: center; flex-wrap: wrap; gap: 12px 24px; padding: 14px 20px; margin: 12px 16px; border: 1px solid var(--border, #ccd2d9); border-radius: var(--radius, 12px); background: var(--surface-soft, #f2f5f8); color: var(--ink, #182332); font-size: 14px; line-height: 1.6; }
.browser-storage-notice > div:first-child { flex: 1 1 280px; min-width: 0; }
.browser-storage-notice p { margin: 4px 0 0; overflow-wrap: anywhere; }
.browser-storage-notice.strong { border-width: 2px; }
.notice-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.notice-actions a, .notice-actions button { min-height: 44px; display: inline-flex; align-items: center; justify-content: center; padding: 8px 12px; color: inherit; font: inherit; border: 1px solid var(--border, #ccd2d9); border-radius: 8px; background: var(--surface, #fff); text-decoration: none; cursor: pointer; }
.notice-actions :focus-visible { outline: 2px solid var(--focus-ring, #3659b8); outline-offset: 3px; }
</style>
