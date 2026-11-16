<script setup lang="ts">
import { Bookmark, Heart, Play, FileText, ArrowUpRight, Image } from '@lucide/vue'
import { computed, ref, watch } from 'vue'
import type { Work } from '../data'
import { statusLabels } from '../data'
import { pendingActions, toggleWork } from '../state'
const props = defineProps<{ work: Work; management?: boolean; eager?: boolean }>()
const failed = ref(false)
const measuredRatio = ref<number>()
const coverRatio = computed(() => {
  const ratio = measuredRatio.value ?? props.work.coverAspectRatio
  return typeof ratio === 'number' && Number.isFinite(ratio) && ratio > 0 ? ratio : 4 / 5
})
const coverLabel = computed(() => {
  const work = props.work
  if (work.kind === 'resource') return undefined
  const parts = ['查看作品', work.title]
  if ((!work.cover || failed.value) && !work.video) parts.push(failed.value ? '封面加载失败' : '暂无封面')
  if (work.kind === 'video') parts.push(work.duration || '视频')
  return parts.join('：')
})
watch(() => [props.work.id, props.work.cover, props.work.video], () => {
  failed.value = false
  measuredRatio.value = undefined
})
function measureCover(event: Event) {
  const media = event.currentTarget as HTMLImageElement | HTMLVideoElement
  const width = media instanceof HTMLImageElement ? media.naturalWidth : media.videoWidth
  const height = media instanceof HTMLImageElement ? media.naturalHeight : media.videoHeight
  if (!width || !height) return
  measuredRatio.value = width / height
}
</script>

<template>
  <article class="work-card" :class="{ 'work-card-managed': management }" :data-work-id="work.id">
    <div class="work-card-content">
    <RouterLink :to="`/work/${work.id}`" class="work-cover" :class="{ 'resource-cover': work.kind === 'resource' }" :style="{ aspectRatio: coverRatio }" :aria-label="coverLabel">
      <template v-if="work.kind === 'resource'"><div class="resource-top"><FileText :size="22" /><span>{{ work.tags.includes('Skill') ? 'SKILL' : '创作笔记' }}</span></div><strong class="resource-heading">{{ work.title }}</strong><p>{{ work.body?.split('\n').filter(Boolean).slice(0, 3).join(' ') }}</p><span v-if="!management" class="resource-bottom">阅读内容 <ArrowUpRight :size="16" /></span></template>
      <img v-else-if="work.cover && !failed" :src="work.cover" :alt="work.title" :loading="eager ? 'eager' : 'lazy'" width="640" :height="Math.round(640 / coverRatio)" @load="measureCover" @error="failed = true" />
      <video v-else-if="work.video" :src="work.video" muted playsinline preload="metadata" :aria-label="work.title" @loadedmetadata="measureCover" />
      <div v-else class="media-placeholder"><Image :size="32" aria-hidden="true" /><span class="caption-5">{{ failed ? '封面加载失败' : '暂无封面' }}</span></div>
      <span v-if="work.kind === 'video'" class="video-badge"><Play :size="12" fill="currentColor" /> {{ work.duration || '视频' }}</span>
      <span v-if="management" class="cover-status" :class="work.status">{{ work.revisionPending ? '修改待审核' : statusLabels[work.status] }}</span>
    </RouterLink>
    <button class="save-work icon-button" :class="{ selected: work.saved }" :aria-label="`${work.saved ? '取消收藏' : '收藏'}：${work.title}`" :aria-pressed="work.saved" :title="work.saved ? '取消收藏' : '收藏作品'" :disabled="pendingActions.has(`saved:${work.id}`)" @click="toggleWork(work, 'saved')"><Bookmark :size="17" :fill="work.saved ? 'currentColor' : 'none'" /></button>
    <div class="work-information">
      <RouterLink :to="`/work/${work.id}`" class="work-title title-4" :title="work.title">{{ work.title }}</RouterLink>
      <div class="work-meta">
        <RouterLink :to="{ path: '/community', query: { creator: work.authorId } }" class="work-author" :title="work.author"><span>{{ work.author }}</span></RouterLink>
        <button class="like-button" :class="{ selected: work.liked }" :aria-label="`喜欢：${work.title}，${work.likes} 赞`" :aria-pressed="work.liked" :disabled="pendingActions.has(`liked:${work.id}`)" @click="toggleWork(work, 'liked')"><Heart :size="13" :fill="work.liked ? 'currentColor' : 'none'" /><span>{{ work.likes }}</span></button>
      </div>
    </div>
    <slot name="actions" />
    </div>
  </article>
</template>

<style scoped>
.work-card { min-width: 0; padding: 0; border: 0; border-radius: 0; background: transparent; box-shadow: none; color: var(--ink); }
.work-card-content { position: relative; width: 100%; min-width: 0; }
.work-cover { position: relative; display: block; width: 100%; height: auto; min-width: 0; border-radius: 8px; overflow: hidden; background: var(--surface-soft); transition: opacity 200ms var(--ease); }
.work-cover:hover { opacity: .92; }
.work-cover:focus-visible { outline-offset: -4px; }
.work-cover > img, .work-cover > video { display: block; width: 100%; height: 100%; object-fit: contain; transform: none; }
.work-information { min-width: 0; padding: 8px 4px 0; }
.work-title { min-width: 0; padding-top: 0; font-size: 14px; line-height: 20px; font-weight: 500; }
.work-title:hover { color: var(--ink); text-decoration: underline; text-underline-offset: 3px; }
.work-meta { margin-top: 4px; gap: 8px; min-height: 24px; font-size: 12px; line-height: 16px; color: var(--muted); }
.work-author { flex: 1; min-width: 0; min-height: 24px; }
.work-author > span:last-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.work-author:hover { color: var(--ink); }
.work-title:focus-visible, .work-author:focus-visible { outline-offset: -2px; }
.like-button { min-width: 36px; min-height: 24px; padding: 0 0 0 4px; justify-content: flex-end; color: var(--muted); transition: color 200ms var(--ease); }
.like-button:hover, .like-button:focus-visible { color: var(--ink); }
.like-button.selected { color: var(--danger); }
.save-work { top: 8px; right: 8px; z-index: 2; background: var(--surface); color: var(--ink); border: 1px solid var(--border); border-radius: 6px; }
.save-work.selected { background: var(--blue); color: var(--action-ink); border-color: var(--blue); }
.resource-cover { display: flex; flex-direction: column; align-items: stretch; gap: 0; padding: 16px 16px 48px; border: 0; }
.resource-top { flex: 0 0 auto; color: var(--blue); }
.resource-heading { flex: 0 1 auto; min-height: 0; color: var(--ink); font-size: 18px; line-height: 24px; margin-top: 12px; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; }
.resource-cover > p { flex: 0 1 auto; min-height: 0; color: var(--muted); margin-top: 8px; font-size: 12px; line-height: 20px; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; }
.resource-bottom { display: flex; position: absolute; bottom: 16px; left: 16px; margin: 0; color: var(--blue); }
.media-placeholder { display: flex; width: 100%; height: 100%; align-items: center; justify-content: center; flex-direction: column; gap: 8px; color: var(--muted); }
.video-badge { top: 8px; bottom: auto; left: 8px; right: auto; background: var(--canvas); color: var(--ink); }
.work-card-managed .work-card-content > :deep(.work-management-actions) { margin: 8px 0 0; padding: 0 4px; }
@media (max-width: 639px) {
  .work-title { min-height: 24px; line-height: 24px; }
  .work-author, .like-button { min-height: 44px; }
  .like-button { min-width: 44px; }
  .save-work { min-width: 44px; min-height: 44px; }
}
@media (prefers-reduced-motion: reduce) {
  .work-cover, .like-button { transition: none; }
}
</style>
