<script setup lang="ts">
import { Bookmark, Heart, Play, FileText, ArrowUpRight, Image, X } from '@lucide/vue'
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import type { Work } from '../data'
import { statusLabels } from '../data'
import { pendingActions, toggleWork } from '../state'
const props = defineProps<{ work: Work; management?: boolean; eager?: boolean }>()
const failed = ref(false)
const preview = ref<HTMLDialogElement>()
const previewOpen = ref(false)
const previewImageFailed = ref(false), previewVideoFailed = ref(false)
const coverLabel = computed(() => {
  const work = props.work
  if (work.kind === 'resource') return undefined
  const parts = ['预览作品', work.title]
  if ((!work.cover || failed.value) && !work.video) parts.push(failed.value ? '预览加载失败' : '暂无预览')
  if (work.kind === 'video') parts.push(work.duration || '视频')
  return parts.join('：')
})
let trigger: HTMLElement | undefined, animation: Animation | undefined
let closing = false, pressedBackdrop = false
watch(() => props.work.cover, () => { failed.value = false })
watch(() => props.work.id, disposePreview)
onBeforeUnmount(disposePreview)

function reducedMotion() { return matchMedia('(prefers-reduced-motion: reduce)').matches }
function sourceTransform(dialog: HTMLDialogElement, source: HTMLElement) {
  const from = source.getBoundingClientRect(), to = dialog.getBoundingClientRect()
  return `translate(${from.left - to.left}px, ${from.top - to.top}px) scale(${from.width / to.width}, ${from.height / to.height})`
}
async function openPreview(event: MouseEvent, navigate: (event: MouseEvent) => unknown) {
  if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) { void navigate(event); return }
  event.preventDefault()
  if (previewOpen.value) return
  trigger = event.currentTarget as HTMLElement
  previewImageFailed.value = false; previewVideoFailed.value = false
  previewOpen.value = true
  await nextTick()
  const dialog = preview.value, source = trigger?.closest<HTMLElement>('.work-card')
  if (!dialog || !trigger?.isConnected) { resetPreview(); return }
  dialog.showModal()
  if (!reducedMotion() && source) {
    animation = dialog.animate([{ transform: sourceTransform(dialog, source), opacity: 0.7 }, { transform: 'none', opacity: 1 }], { duration: 300, easing: 'ease-in-out' })
  }
}
async function closePreview() {
  const dialog = preview.value
  if (!dialog?.open || closing) return
  closing = true
  dialog.querySelector('video')?.pause()
  animation?.cancel()
  const source = trigger?.closest<HTMLElement>('.work-card')
  if (!reducedMotion() && source?.isConnected) {
    animation = dialog.animate([{ transform: 'none', opacity: 1 }, { transform: sourceTransform(dialog, source), opacity: 0.7 }], { duration: 240, easing: 'ease-in-out' })
    await animation.finished.catch(() => {})
  }
  dialog.close()
}
function resetPreview() {
  animation?.cancel(); animation = undefined
  previewOpen.value = false; closing = false; pressedBackdrop = false
  const previous = trigger; trigger = undefined
  if (previous?.isConnected) previous.focus({ preventScroll: true })
}
function disposePreview() {
  trigger = undefined
  animation?.cancel()
  preview.value?.close()
  resetPreview()
}
function outsidePreview(event: PointerEvent | MouseEvent) {
  const bounds = preview.value?.getBoundingClientRect()
  return event.target === preview.value && !!bounds && (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom)
}
function clickPreview(event: MouseEvent) {
  if (pressedBackdrop && outsidePreview(event)) void closePreview()
  pressedBackdrop = false
}
</script>

<template>
  <article v-continuous:clip="{ radius: 32 }" class="work-card card" :class="{ 'work-card-managed': management }" :data-work-id="work.id">
    <RouterLink v-slot="{ href, navigate }" :to="`/work/${work.id}`" custom>
    <a :href="href" class="work-cover m-zoom" :class="{ 'resource-cover': work.kind === 'resource' }" :aria-label="coverLabel" aria-haspopup="dialog" @click="openPreview($event, navigate)">
      <template v-if="work.kind === 'resource'"><div class="resource-top"><FileText :size="22" /><span>{{ work.tags.includes('Skill') ? 'SKILL' : '创作笔记' }}</span></div><strong class="resource-heading">{{ work.title }}</strong><p>{{ work.body?.split('\n').filter(Boolean).slice(0, 3).join(' ') }}</p><span v-if="!management" class="resource-bottom">阅读内容 <ArrowUpRight :size="16" /></span></template>
      <img v-else-if="work.cover && !failed" :src="work.cover" :alt="work.title" :loading="eager ? 'eager' : 'lazy'" width="640" height="800" @error="failed = true" />
      <video v-else-if="work.video" :src="work.video" muted playsinline preload="metadata" :aria-label="work.title" />
      <div v-else class="media-placeholder"><Image :size="32" aria-hidden="true" /><span class="caption-5">{{ failed ? '预览加载失败' : '暂无预览' }}</span></div>
      <span v-if="work.kind === 'video'" class="video-badge"><Play :size="12" fill="currentColor" /> {{ work.duration || '视频' }}</span>
      <span v-if="management" class="cover-status" :class="work.status">{{ work.revisionPending ? '修改待审核' : statusLabels[work.status] }}</span>
    </a>
    </RouterLink>
    <button class="save-work icon-button" :class="{ selected: work.saved }" :aria-label="`${work.saved ? '取消收藏' : '收藏'}：${work.title}`" :aria-pressed="work.saved" :title="work.saved ? '取消收藏' : '收藏作品'" :disabled="pendingActions.has(`saved:${work.id}`)" @click="toggleWork(work, 'saved')"><Bookmark :size="17" :fill="work.saved ? 'currentColor' : 'none'" /></button>
    <div class="work-information">
      <div class="work-title-row"><component :is="work.kind === 'resource' ? FileText : work.kind === 'video' ? Play : Image" :size="16" aria-hidden="true" /><RouterLink :to="`/work/${work.id}`" class="work-title title-4" :title="work.title">{{ work.title }}</RouterLink></div>
      <div class="work-meta"><RouterLink :to="{ path: '/community', query: { creator: work.authorId } }" class="work-author"><span class="avatar avatar-xs blue"><img v-if="work.avatarUrl" :src="work.avatarUrl" :alt="work.author" /><span v-else>{{ work.avatar || work.author.slice(0, 1) }}</span></span><span>{{ work.author }}</span></RouterLink><button class="like-button" :class="{ selected: work.liked }" :aria-label="`喜欢：${work.title}，${work.likes} 赞`" :aria-pressed="work.liked" :disabled="pendingActions.has(`liked:${work.id}`)" @click="toggleWork(work, 'liked')"><Heart :size="13" :fill="work.liked ? 'currentColor' : 'none'" /><span>{{ work.likes }}</span></button></div>
    </div>
    <slot name="actions" />
    <dialog ref="preview" v-continuous:clip="{ radius: 32 }" class="work-grid-preview" :class="{ 'preview-has-video': work.kind !== 'resource' && work.video && !previewVideoFailed }" :aria-label="`作品预览：${work.title}`" @cancel.prevent="closePreview" @close="resetPreview" @pointerdown="pressedBackdrop = outsidePreview($event)" @click="clickPreview">
      <template v-if="previewOpen">
        <div class="preview-media" :class="{ 'preview-resource': work.kind === 'resource' }">
          <pre v-if="work.kind === 'resource'" tabindex="0" role="region" aria-label="资源正文">{{ work.body || work.prompt || '作者未填写资源内容。' }}</pre>
          <video v-else-if="work.video && !previewVideoFailed" :src="work.video" :poster="work.cover || undefined" controls playsinline preload="metadata" :aria-label="work.title" @error="previewVideoFailed = true" />
          <img v-else-if="work.cover && !previewImageFailed" :src="work.cover" :alt="work.title" @error="previewImageFailed = true" />
          <div v-else class="preview-empty" role="status"><Image :size="32" aria-hidden="true" /><p>{{ previewImageFailed || previewVideoFailed ? '预览加载失败' : '暂无预览' }}</p></div>
        </div>
        <button class="preview-close icon-button" type="button" autofocus aria-label="关闭作品预览" title="关闭作品预览" @click="closePreview"><X :size="20" /></button>
        <div class="preview-information"><h2>{{ work.title }}</h2><p class="preview-author">{{ work.author }}</p><p v-if="work.kind !== 'resource' && (work.body || work.prompt)" class="preview-description">{{ work.body || work.prompt }}</p><RouterLink :to="`/work/${work.id}`" class="button btn preview-detail">查看作品详情 <ArrowUpRight :size="16" /></RouterLink></div>
      </template>
    </dialog>
  </article>
</template>

<style scoped>
.work-card { display: flex; flex-direction: column; justify-content: flex-end; gap: 0; min-width: 0; min-height: 0; height: 100%; padding: 0; border: 0; border-radius: var(--card-radius); background: var(--surface); box-shadow: none; color: var(--ink); }
.work-cover { position: absolute; inset: 0; min-width: 0; min-height: 0; width: 100%; height: 100%; aspect-ratio: auto; border-radius: 0; background: var(--surface-soft); }
.work-cover:focus-visible { outline-offset: -4px; }
.work-cover > img, .work-cover > video { width: 100%; height: 100%; object-fit: cover; object-position: center top; }
.work-information { position: relative; z-index: 1; flex: 0 0 auto; min-width: 0; padding: 12px 16px 16px; background: #0009; color: #fff; }
.work-title-row { display: flex; align-items: center; gap: 8px; min-width: 0; }
.work-title-row > svg { flex: 0 0 auto; color: #e2e2df; }
.work-title { flex: 1; min-width: 0; padding-top: 0; font-size: 14px; line-height: 22px; font-weight: 600; }
.work-meta { margin-top: 4px; gap: 8px; min-height: 32px; color: #e2e2df; }
.work-author { flex: 1; min-width: 0; min-height: 32px; }
.work-author > span:last-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.work-author:hover { color: #fff; }
.work-title:focus-visible, .work-author:focus-visible { outline-offset: -2px; }
.avatar { overflow: hidden; }.avatar img { width: 100%; height: 100%; object-fit: cover; }
.like-button { min-width: 36px; min-height: 32px; justify-content: center; color: #e2e2df; }
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
.work-card-managed > :deep(.work-management-actions) { position: relative; z-index: 1; margin: 0; padding: 0 16px 16px; background: #0009; color: #fff; }
.work-grid-preview { position: fixed; inset: 0; margin: auto; width: min(720px, calc(100vw - 32px)); height: min(680px, calc(100svh - 48px)); max-width: none; max-height: none; padding: 0; border: 0; border-radius: var(--card-radius); background: var(--surface); color: #fff; overflow: hidden; transform-origin: left top; }
.work-grid-preview[open] { display: flex; flex-direction: column; justify-content: flex-end; }
.work-grid-preview::backdrop { background: #0000004d; }
.preview-media { position: absolute; inset: 0; background: var(--canvas); }
.preview-media > img, .preview-media > video { display: block; width: 100%; height: 100%; object-fit: contain; }
.preview-has-video .preview-media, .preview-resource { position: relative; inset: auto; flex: 1; min-height: 0; }
.preview-resource { padding: 32px; }
.preview-resource pre { max-height: 100%; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; font: inherit; font-size: 15px; line-height: 26px; }
.preview-empty { display: flex; height: 100%; padding-bottom: 180px; flex-direction: column; align-items: center; justify-content: center; gap: 12px; }
.preview-close { position: absolute; top: 16px; right: 16px; z-index: 2; width: 44px; height: 44px; background: #202120; color: #fff; border: 1px solid #747672; }
.preview-information { position: relative; z-index: 1; max-height: 50%; overflow: auto; padding: 24px 32px; background: #0009; }
.preview-information h2 { font-size: 24px; line-height: 32px; color: #fff; overflow-wrap: anywhere; }
.preview-author { margin-top: 4px; font-size: 13px; line-height: 20px; color: #e2e2df; }
.preview-description { margin-top: 12px; font-size: 14px; line-height: 22px; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; }
.preview-detail { margin-top: 16px; min-height: 44px; background: var(--surface); color: var(--ink); border: 1px solid var(--muted); }
.work-grid-preview[open] .preview-information { animation: preview-information-in 300ms ease-in-out; }
:global(html:has(.work-grid-preview[open])) { overflow: hidden; }
@keyframes preview-information-in { from { opacity: 0; transform: translateY(100px); } to { opacity: 1; transform: translateY(0); } }
@media (prefers-reduced-motion: reduce) { .work-grid-preview[open] .preview-information { animation: none; } }
@media (max-width: 639px) {
  .work-meta { gap: 8px; }
  .work-title { min-height: 44px; line-height: 44px; }
  .work-author, .like-button { min-height: 44px; }
  .like-button { min-width: 44px; }
  .save-work { min-width: 44px; min-height: 44px; }
  .preview-information { padding: 20px; }
  .preview-information h2 { font-size: 20px; line-height: 28px; }
  .preview-resource { padding: 24px; }
}
</style>
