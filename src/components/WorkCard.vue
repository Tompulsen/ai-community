<script setup lang="ts">
import { Bookmark, Heart, Play, FileText, ArrowUpRight, Image } from '@lucide/vue'
import { ref, watch } from 'vue'
import type { Work } from '../data'
import { statusLabels } from '../data'
import { pendingActions, toggleWork } from '../state'
const props = defineProps<{ work: Work; management?: boolean }>()
const failed = ref(false)
watch(() => props.work.cover, () => { failed.value = false })
</script>

<template>
  <article class="work-card" :data-work-id="work.id">
    <RouterLink :to="`/work/${work.id}`" class="work-cover" :class="{ 'resource-cover': work.kind === 'resource' }">
      <template v-if="work.kind === 'resource'"><div class="resource-top"><FileText :size="22" /><span>{{ work.tags.includes('Skill') ? 'SKILL' : '创作笔记' }}</span></div><strong class="resource-heading">{{ work.title }}</strong><p>{{ work.body?.split('\n').filter(Boolean).slice(0, 3).join(' ') }}</p><span v-if="!management" class="resource-bottom">阅读内容 <ArrowUpRight :size="16" /></span></template>
      <img v-else-if="work.cover && !failed" :src="work.cover" :alt="work.title" loading="lazy" width="640" height="800" @error="failed = true" />
      <video v-else-if="work.video" :src="work.video" muted playsinline preload="metadata" :aria-label="work.title" />
      <div v-else class="media-placeholder"><Image :size="32" aria-hidden="true" /><span class="caption-5">{{ failed ? '预览加载失败' : '暂无预览' }}</span></div>
      <span v-if="work.kind === 'video'" class="video-badge"><Play :size="12" fill="currentColor" /> {{ work.duration || '视频' }}</span>
      <span v-if="management" class="cover-status" :class="work.status">{{ work.revisionPending ? '修改待审核' : statusLabels[work.status] }}</span>
    </RouterLink>
    <button class="save-work icon-button" :class="{ selected: work.saved }" :aria-label="`${work.saved ? '取消收藏' : '收藏'}：${work.title}`" :aria-pressed="work.saved" :title="work.saved ? '取消收藏' : '收藏作品'" :disabled="pendingActions.has(`saved:${work.id}`)" @click="toggleWork(work, 'saved')"><Bookmark :size="17" :fill="work.saved ? 'currentColor' : 'none'" /></button>
    <RouterLink :to="`/work/${work.id}`" class="work-title title-4">{{ work.title }}</RouterLink>
    <div class="work-meta"><RouterLink :to="{ path: '/community', query: { creator: work.authorId } }" class="work-author"><span class="avatar avatar-xs blue"><img v-if="work.avatarUrl" :src="work.avatarUrl" :alt="work.author" /><span v-else>{{ work.avatar || work.author.slice(0, 1) }}</span></span><span>{{ work.author }}</span></RouterLink><button class="like-button" :class="{ selected: work.liked }" :aria-label="`喜欢：${work.title}，${work.likes} 赞`" :aria-pressed="work.liked" :disabled="pendingActions.has(`liked:${work.id}`)" @click="toggleWork(work, 'liked')"><Heart :size="13" :fill="work.liked ? 'currentColor' : 'none'" /><span>{{ work.likes }}</span></button></div>
  </article>
</template>

<style scoped>
.avatar { overflow: hidden; }.avatar img { width: 100%; height: 100%; object-fit: cover; }
.work-cover > video { width: 100%; height: 100%; object-fit: cover; }
.media-placeholder { flex-direction: column; gap: 8px; }
</style>
