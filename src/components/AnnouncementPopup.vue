<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { Megaphone, X } from '@lucide/vue'
import { api } from '../state'
import AnnouncementText from './AnnouncementText.vue'

interface Notice { id: string; title: string; text: string; display: string }
const route = useRoute(), dialog = ref<HTMLDialogElement>(), items = ref<Notice[]>([])
const controller = new AbortController(), visitKey = 'octopus:announcement-popup:visit'
const initialRoute = route.fullPath
let moved = false
function close() { dialog.value?.close() }
watch(() => route.fullPath, () => { moved = true; controller.abort(); close() })
onMounted(async () => {
  try {
    // A tab's session survives refresh; a fresh tab gets a new announcement visit.
    const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined
    const visit = sessionStorage.getItem(visitKey)
    let copiedVisit = false
    try { copiedVisit = navigation?.type === 'navigate' && !!window.opener && visit === window.opener.sessionStorage.getItem(visitKey) } catch { /* Cross-origin openers cannot share this site's storage. */ }
    if (visit && !copiedVisit) return
    sessionStorage.setItem(visitKey, crypto.randomUUID())
    if (/^\/(?:admin|account)(?:\/|$)/.test(route.path)) return
    const result = await api<{ items: Notice[] }>('/api/announcements?popup=1', { signal: controller.signal })
    if (moved || controller.signal.aborted || route.fullPath !== initialRoute) return
    items.value = result.items.filter(item => item.display === 'dialog')
    await nextTick()
    if (items.value.length && !moved && !controller.signal.aborted && !document.querySelector('dialog[open]')) dialog.value?.showModal()
  } catch { /* An unavailable announcement must not block entering the community. */ }
})
onBeforeUnmount(() => { controller.abort(); close() })
</script>

<template>
  <Teleport to="body">
    <dialog ref="dialog" class="announcement-popup" aria-labelledby="announcement-popup-heading" @click="($event.target === dialog) && close()">
      <div class="dialog-heading">
        <h2 id="announcement-popup-heading"><Megaphone :size="20" aria-hidden="true" />社区公告</h2>
        <button type="button" class="icon-button" aria-label="关闭公告" @click="close"><X :size="20" /></button>
      </div>
      <div class="announcement-popup-content" tabindex="0" aria-label="公告内容">
        <article v-for="item in items" :key="item.id">
          <h3>{{ item.title }}</h3>
          <AnnouncementText :text="item.text" />
        </article>
      </div>
      <div class="announcement-popup-footer">
        <p>本次浏览不再弹出，可在消息中心查看公告。</p>
        <button type="button" class="button primary btn" autofocus @click="close">我知道了</button>
      </div>
    </dialog>
  </Teleport>
</template>

<style scoped>
.announcement-popup { width: min(560px, calc(100vw - 32px)); max-width: calc(100vw - 32px); max-height: calc(100dvh - 48px); padding: 0; overflow: hidden; border: 1px solid var(--border); border-radius: 12px; background: var(--canvas); color: var(--ink); }
.announcement-popup[open] { display: flex; flex-direction: column; }
.dialog-heading { flex-shrink: 0; padding: 16px 20px; }
.dialog-heading h2 { display: flex; align-items: center; gap: 10px; font-size: 18px; }
.icon-button, .announcement-popup-footer button { min-width: 44px; min-height: 44px; }
.announcement-popup-content { min-height: 0; overflow-y: auto; overscroll-behavior: contain; padding: 4px 24px 24px; overflow-wrap: anywhere; }
.announcement-popup-content article + article { margin-top: 24px; padding-top: 24px; border-top: 1px solid var(--border); }
.announcement-popup-content h3 { margin-bottom: 12px; font-size: 18px; line-height: 1.5; font-weight: 600; }
.announcement-popup-content p { white-space: pre-wrap; font-size: 15px; line-height: 1.8; }
.announcement-popup-footer { display: flex; align-items: center; gap: 16px; justify-content: space-between; flex-shrink: 0; padding: 16px 24px; border-top: 1px solid var(--border); }
.announcement-popup-footer p { color: var(--muted); font-size: 12px; line-height: 1.6; }
.announcement-popup-footer button { flex-shrink: 0; }
:global(html:has(.announcement-popup[open])) { overflow: hidden; scrollbar-gutter: stable; }
@media (max-width: 639px) {
  .announcement-popup-footer { align-items: stretch; flex-direction: column; gap: 12px; padding: 16px 20px; }
  .announcement-popup-content { padding: 4px 20px 20px; }
}
</style>
