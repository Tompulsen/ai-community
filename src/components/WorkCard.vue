<script setup lang="ts">
import { Bookmark, Heart, Play, FileText, ArrowUpRight, Image } from '@lucide/vue'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { Work } from '../data'
import { statusLabels } from '../data'
import { pendingActions, toggleWork } from '../state'
const props = defineProps<{ work: Work; management?: boolean; eager?: boolean }>()
const emit = defineEmits<{ 'cover-ratio': [ratio: number] }>()
const failed = ref(false)
const wobbleEnabled = ref(false)
const mousePosition = ref<{ x: number; y: number }>()
const wobbleTransition = computed(() => !wobbleEnabled.value ? 'none' : 'transform 0.1s ease-out')
const cardStyle = computed(() => ({
  transform: `translate3d(${mousePosition.value?.x ?? 0}px, ${mousePosition.value?.y ?? 0}px, 0)`,
  transition: wobbleTransition.value,
}))
const mediaStyle = computed(() => ({
  transform: `translate3d(${-(mousePosition.value?.x ?? 0) * 0.35}px, ${-(mousePosition.value?.y ?? 0) * 0.35}px, 0) scale(${mousePosition.value ? 1.06 : 1})`,
  transition: wobbleTransition.value,
}))
const coverLabel = computed(() => {
  const work = props.work
  if (work.kind === 'resource') return undefined
  const parts = ['查看作品', work.title]
  if ((!work.cover || failed.value) && !work.video) parts.push(failed.value ? '封面加载失败' : '暂无封面')
  if (work.kind === 'video') parts.push(work.duration || '视频')
  return parts.join('：')
})
let wobblePreference: MediaQueryList | undefined
watch(() => [props.work.cover, props.work.video], () => { failed.value = false })
watch(() => props.work.id, resetWobble)
onMounted(() => {
  wobblePreference = matchMedia('(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)')
  updateWobblePreference()
  wobblePreference.addEventListener('change', updateWobblePreference)
})
onBeforeUnmount(() => {
  wobblePreference?.removeEventListener('change', updateWobblePreference)
  resetWobble()
})

function resetWobble() { mousePosition.value = undefined }
function updateWobblePreference() {
  wobbleEnabled.value = wobblePreference?.matches ?? false
  resetWobble()
}
function moveWobble(event: PointerEvent) {
  if (event.pointerType !== 'mouse' || !wobbleEnabled.value) { resetWobble(); return }
  const card = event.currentTarget as HTMLElement
  const bounds = card.getBoundingClientRect()
  const translation = new DOMMatrixReadOnly(getComputedStyle(card).transform)
  // Remove the live translation so moving bounds cannot feed back into the pointer offset.
  mousePosition.value = {
    x: Math.max(-12, Math.min(12, (event.clientX - (bounds.left - translation.m41 + bounds.width / 2)) / 12)),
    y: Math.max(-12, Math.min(12, (event.clientY - (bounds.top - translation.m42 + bounds.height / 2)) / 12)),
  }
}
function measureCover(event: Event) {
  const media = event.currentTarget as HTMLImageElement | HTMLVideoElement
  const width = media instanceof HTMLImageElement ? media.naturalWidth : media.videoWidth
  const height = media instanceof HTMLImageElement ? media.naturalHeight : media.videoHeight
  if (!width || !height) return
  emit('cover-ratio', width / height)
}
</script>

<template>
  <article v-continuous:clip="{ radius: 32 }" class="work-card card" :class="{ 'work-card-managed': management }" :data-work-id="work.id" :style="cardStyle" @pointerenter="moveWobble" @pointermove="moveWobble" @pointerleave="resetWobble" @pointercancel="resetWobble">
    <div class="work-card-content">
    <RouterLink :to="`/work/${work.id}`" class="work-cover" :class="{ 'resource-cover': work.kind === 'resource' }" :aria-label="coverLabel" @click="resetWobble">
      <template v-if="work.kind === 'resource'"><div class="resource-top"><FileText :size="22" /><span>{{ work.tags.includes('Skill') ? 'SKILL' : '创作笔记' }}</span></div><strong class="resource-heading">{{ work.title }}</strong><p>{{ work.body?.split('\n').filter(Boolean).slice(0, 3).join(' ') }}</p><span v-if="!management" class="resource-bottom">阅读内容 <ArrowUpRight :size="16" /></span></template>
      <img v-else-if="work.cover && !failed" :src="work.cover" :alt="work.title" :style="mediaStyle" :loading="eager ? 'eager' : 'lazy'" width="640" height="800" @load="measureCover" @error="failed = true" />
      <video v-else-if="work.video" :src="work.video" :style="mediaStyle" muted playsinline preload="metadata" :aria-label="work.title" @loadedmetadata="measureCover" />
      <div v-else class="media-placeholder" :style="mediaStyle"><Image :size="32" aria-hidden="true" /><span class="caption-5">{{ failed ? '封面加载失败' : '暂无封面' }}</span></div>
      <span v-if="work.kind === 'video'" class="video-badge"><Play :size="12" fill="currentColor" /> {{ work.duration || '视频' }}</span>
      <span v-if="management" class="cover-status" :class="work.status">{{ work.revisionPending ? '修改待审核' : statusLabels[work.status] }}</span>
    </RouterLink>
    <button class="save-work icon-button" :class="{ selected: work.saved }" :aria-label="`${work.saved ? '取消收藏' : '收藏'}：${work.title}`" :aria-pressed="work.saved" :title="work.saved ? '取消收藏' : '收藏作品'" :disabled="pendingActions.has(`saved:${work.id}`)" @click="toggleWork(work, 'saved')"><Bookmark :size="17" :fill="work.saved ? 'currentColor' : 'none'" /></button>
    <div class="work-information">
      <RouterLink :to="`/work/${work.id}`" class="work-title title-4" :title="work.title">{{ work.title }}</RouterLink>
      <div class="work-meta"><RouterLink :to="{ path: '/community', query: { creator: work.authorId } }" class="work-author"><span class="avatar avatar-xs blue"><img v-if="work.avatarUrl" :src="work.avatarUrl" :alt="work.author" /><span v-else>{{ work.avatar || work.author.slice(0, 1) }}</span></span><span>{{ work.author }}</span></RouterLink><button class="like-button" :class="{ selected: work.liked }" :aria-label="`喜欢：${work.title}，${work.likes} 赞`" :aria-pressed="work.liked" :disabled="pendingActions.has(`liked:${work.id}`)" @click="toggleWork(work, 'liked')"><Heart :size="13" :fill="work.liked ? 'currentColor' : 'none'" /><span>{{ work.likes }}</span></button></div>
    </div>
    <slot name="actions" />
    </div>
  </article>
</template>

<style scoped>
.work-card { display: flex; flex-direction: column; justify-content: flex-end; gap: 0; min-width: 0; min-height: 0; height: 100%; padding: 0; border: 0; border-radius: var(--card-radius); background: var(--surface); box-shadow: none; color: var(--ink); }
.work-card-content { position: relative; display: flex; flex-direction: column; justify-content: flex-end; width: 100%; height: 100%; min-width: 0; min-height: 0; }
/* Overdraw the shared clip edge so composited media cannot form a subpixel seam. */
.work-card-content::before { content: ""; position: absolute; inset: auto -1px -1px; height: calc(160px + 1px); z-index: 1; background: var(--work-cover-shade); pointer-events: none; }
.work-card-content:has(.resource-cover)::before { display: none; }
.work-cover { position: absolute; inset: 0; min-width: 0; min-height: 0; width: 100%; height: 100%; aspect-ratio: auto; border-radius: 0; overflow: visible; background: var(--surface-soft); }
/* Stop transformed media before the shade's raster edge can expose an unshaded pixel. */
.work-cover:not(.resource-cover) { clip-path: inset(0 0 1px); }
.work-cover:focus-visible { outline-offset: -4px; }
.work-cover > img, .work-cover > video { width: 100%; height: 100%; object-fit: cover; object-position: center top; }
.work-information { position: relative; z-index: 2; flex: 0 0 auto; min-width: 0; padding: 12px 16px; color: #fff; }
.work-title { min-width: 0; padding-top: 0; font-size: 14px; line-height: 22px; font-weight: 500; }
.work-title:hover { color: #fff; text-decoration: underline; text-underline-offset: 3px; }
.work-meta { margin-top: 4px; gap: 8px; min-height: 32px; color: #e2e2df; }
.work-author { flex: 1; min-width: 0; min-height: 32px; }
.work-author > span:last-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.work-author:hover { color: #fff; }
.work-title:focus-visible, .work-author:focus-visible { outline-offset: -2px; }
.avatar { overflow: hidden; }.avatar img { width: 100%; height: 100%; object-fit: cover; }
.like-button { min-width: 36px; min-height: 32px; justify-content: center; color: #e2e2df; transition: color 200ms var(--ease); }
.like-button:hover, .like-button:focus-visible { color: #fff; }
.like-button.selected { color: var(--blue-hover); }
.save-work { top: 16px; right: 16px; z-index: 2; background: var(--surface); color: var(--ink); border: 1px solid var(--border); border-radius: 6px; }
.save-work.selected { background: var(--blue); color: var(--action-ink); border-color: var(--blue); }
.resource-cover { display: flex; flex-direction: column; align-items: stretch; gap: 0; padding: 20px 20px 112px; border: 0; }
.resource-top { flex: 0 0 auto; color: var(--blue); }
.resource-heading { flex: 0 1 auto; min-height: 0; color: var(--ink); font-size: 18px; line-height: 24px; margin-top: 12px; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; }
.resource-cover > p { flex: 0 1 auto; min-height: 0; color: var(--muted); margin-top: 8px; font-size: 13px; line-height: 21px; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; }
.resource-bottom { display: flex; flex: 0 0 auto; position: static; margin-top: auto; padding-top: 8px; color: var(--blue); }
.media-placeholder { display: flex; align-items: center; justify-content: center; flex-direction: column; gap: 8px; color: var(--muted); }
.video-badge { top: 16px; bottom: auto; left: 16px; right: auto; background: var(--canvas); color: var(--ink); }
.work-card-managed .work-information { padding-bottom: 8px; }
.work-card-managed .work-card-content::before { height: calc(224px + 1px); }
.work-card-managed .work-card-content > :deep(.work-management-actions) { position: relative; z-index: 2; margin: 0; padding: 0 16px 16px; color: #fff; }
@media (max-width: 639px) {
  .work-card-content::before { height: calc(192px + 1px); }
  .work-card-managed .work-card-content::before { height: calc(288px + 1px); }
  .work-meta { gap: 8px; }
  .work-title { min-height: 44px; line-height: 44px; }
  .work-author, .like-button { min-height: 44px; }
  .like-button { min-width: 44px; }
  .save-work { min-width: 44px; min-height: 44px; }
}
</style>
