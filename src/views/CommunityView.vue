<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { ArrowLeft, ArrowUpRight, ChevronDown, Images, Megaphone, MessageSquare, UserCheck, UserPlus, Users } from '@lucide/vue'
import WorkCard from '../components/WorkCard.vue'
import BentoGrid from '../components/BentoGrid.vue'
import CommunityAds from '../components/CommunityAds.vue'
import ContentSkeleton from '../components/ContentSkeleton.vue'
import { kindLabels, type Announcement, type Creator, type Work } from '../data'
import { api, errorMessage, loadSession, notify, queryString, session } from '../state'
const route = useRoute()
const tab = ref(route.query.tab === 'announcements' ? 'announcements' : 'creators')
const creatorId = computed(() => typeof route.query.creator === 'string' ? route.query.creator : '')
const creators = ref<Creator[]>([]), announcements = ref<Announcement[]>([]), creator = ref<Creator | null>(null), works = ref<Work[]>([])
const profileTab = ref<'works' | 'followers' | 'following'>('works'), kind = ref('all'), people = ref<Creator[]>([])
const nextCursor = ref<string | null>(null), worksCursor = ref<string | null>(null), collectionLoading = ref(false)
const loading = ref(true), error = ref(''), collectionError = ref(''), following = ref('')
let loadId = 0, collectionId = 0
async function load() {
  const current = ++loadId
  loading.value = true; error.value = ''; creator.value = null; works.value = []; people.value = []; profileTab.value = 'works'; kind.value = 'all'
  try {
    await loadSession()
    if (creatorId.value) {
      const result = await api<{ user: Creator }>(`/api/users/${encodeURIComponent(creatorId.value)}`)
      if (current !== loadId) return
      creator.value = { ...result.user, count: result.user.worksCount ?? result.user.count ?? 0 }
      await loadCollection()
    } else {
      const [peopleResult, news] = await Promise.all([api<{ items: Creator[] }>('/api/creators'), api<{ items: Announcement[] }>('/api/announcements')])
      if (current !== loadId) return
      creators.value = peopleResult.items; announcements.value = news.items
    }
  } catch (cause) { if (current === loadId) error.value = errorMessage(cause) }
  finally { if (current === loadId) loading.value = false }
}
async function loadCollection(append = false) {
  if (!creatorId.value) return
  const current = ++collectionId
  collectionLoading.value = true; collectionError.value = ''
  try {
    if (profileTab.value === 'works') {
      const result = await api<{ items: Work[]; nextCursor?: string | null }>(`/api/works${queryString({ authorId: creatorId.value, kind: kind.value === 'all' ? undefined : kind.value, cursor: append ? worksCursor.value || undefined : undefined })}`)
      if (current === collectionId) { works.value = append ? [...works.value, ...result.items] : result.items; worksCursor.value = result.nextCursor || null }
    } else {
      const result = await api<{ items: Creator[]; nextCursor?: string | null }>(`/api/users/${encodeURIComponent(creatorId.value)}/${profileTab.value}${queryString({ cursor: append ? nextCursor.value || undefined : undefined })}`)
      if (current === collectionId) { people.value = append ? [...people.value, ...result.items] : result.items; nextCursor.value = result.nextCursor || null }
    }
  } catch (cause) { if (current === collectionId) collectionError.value = errorMessage(cause) }
  finally { if (current === collectionId) collectionLoading.value = false }
}
watch(creatorId, () => { void load() }, { immediate: true })
watch([profileTab, kind], () => { if (!loading.value) void loadCollection() })
watch(() => route.query.tab, value => { tab.value = value === 'announcements' ? 'announcements' : 'creators' })
async function follow(item: Creator) {
  if (!session.user) { notify('请先登录后关注创作者。'); return }
  if (following.value) return
  following.value = item.id
  try {
    await api(`/api/users/${encodeURIComponent(item.id)}/follow`, { method: 'POST', body: { active: !item.followed } })
    item.followed = !item.followed
    if (item.followersCount !== undefined) item.followersCount = Math.max(0, item.followersCount + (item.followed ? 1 : -1))
  } catch (cause) { notify(errorMessage(cause)) }
  finally { following.value = '' }
}
</script>

<template>
  <div class="page-container community-page">
    <div v-if="!creatorId" class="community-toolbar">
      <h1>社区</h1>
      <div class="tabs" aria-label="社区分类"><button class="tab" :class="{ active: tab === 'creators' }" :aria-pressed="tab === 'creators'" @click="tab = 'creators'"><Users :size="16" />创作者</button><button class="tab" :class="{ active: tab === 'announcements' }" :aria-pressed="tab === 'announcements'" @click="tab = 'announcements'"><Megaphone :size="16" />社区公告</button></div>
    </div>
    <p v-if="error" class="notice-inline" role="alert">{{ error }} <button class="text-link" @click="load">重试</button></p><ContentSkeleton v-if="loading" layout="creators" label="正在加载社区…" />
    <template v-else-if="creatorId"><RouterLink to="/community" class="back-link profile-back"><ArrowLeft :size="16" />全部创作者</RouterLink>
      <template v-if="creator"><img v-if="creator.bannerUrl" class="profile-banner" :src="creator.bannerUrl" alt="" />
        <div class="creator-profile"><div class="creator-identity"><span class="avatar blue"><img v-if="creator.avatarUrl" :src="creator.avatarUrl" :alt="creator.name || creator.username" /><span v-else>{{ (creator.name || creator.username).slice(0, 1) }}</span></span><div class="profile-copy"><h1>{{ creator.name || creator.username }}</h1><p class="caption-5">@{{ creator.username }}</p><p v-if="creator.bio" class="profile-bio">{{ creator.bio }}</p></div></div><div class="profile-actions"><RouterLink v-if="creator.id === session.user?.id" to="/library" class="button btn">管理我的作品<ArrowUpRight :size="16" /></RouterLink><template v-else><button class="button btn" :aria-pressed="creator.followed" :disabled="!!following" @click="follow(creator)"><component :is="creator.followed ? UserCheck : UserPlus" :size="16" />{{ creator.followed ? '已关注' : '关注' }}</button><RouterLink v-if="session.user" :to="`/messages/${creator.id}`" class="button btn subtle"><MessageSquare :size="16" />私信</RouterLink></template></div></div>
        <div class="tabs profile-tabs" aria-label="个人主页内容"><button class="tab" :class="{ active: profileTab === 'works' }" :aria-pressed="profileTab === 'works'" @click="profileTab = 'works'">公开作品 · {{ creator.count }}</button><button class="tab" :class="{ active: profileTab === 'followers' }" :aria-pressed="profileTab === 'followers'" @click="profileTab = 'followers'">粉丝 · {{ creator.followersCount ?? 0 }}</button><button class="tab" :class="{ active: profileTab === 'following' }" :aria-pressed="profileTab === 'following'" @click="profileTab = 'following'">关注 · {{ creator.followingCount ?? 0 }}</button></div>
        <p v-if="collectionError" class="form-error" role="alert">{{ collectionError }} <button class="text-link" @click="loadCollection()">重试</button></p>
        <template v-if="profileTab === 'works'"><div class="section-heading profile-work-heading"><h2>公开作品</h2><label class="sort-control"><select v-model="kind" aria-label="个人作品分类"><option value="all">全部类型</option><option v-for="(label, value) in kindLabels" :key="value" :value="value">{{ label }}</option></select></label></div><div v-if="collectionLoading && !works.length" class="empty-state" role="status">正在加载作品…</div><BentoGrid v-else-if="works.length" class="profile-works"><WorkCard v-for="(work, index) in works" :key="work.id" :work="work" :eager="index < 3" /></BentoGrid><div v-else-if="!collectionError" class="empty-state"><Images :size="28" /><h2>还没有公开作品</h2></div><div v-if="worksCursor" class="feed-end"><button class="button btn" :disabled="collectionLoading" @click="loadCollection(true)">加载更多</button></div></template>
        <template v-else><div v-if="collectionLoading && !people.length" class="empty-state" role="status">正在加载列表…</div><div class="people-list"><article v-for="person in people" :key="person.id" class="person-row"><RouterLink :to="{ path: '/community', query: { creator: person.id } }" class="person-identity"><span class="avatar blue"><img v-if="person.avatarUrl" :src="person.avatarUrl" :alt="person.name || person.username" /><span v-else>{{ (person.name || person.username).slice(0, 1) }}</span></span><div><strong>{{ person.name || person.username }}</strong><p class="caption-5">@{{ person.username }}</p></div></RouterLink><button v-if="person.id !== session.user?.id" class="button btn subtle" :aria-pressed="person.followed" :disabled="!!following" @click="follow(person)"><component :is="person.followed ? UserCheck : UserPlus" :size="15" />{{ person.followed ? '已关注' : '关注' }}</button></article></div><p v-if="!collectionLoading && !people.length && !collectionError" class="form-note">暂无{{ profileTab === 'followers' ? '粉丝' : '关注' }}</p><div v-if="nextCursor" class="feed-end"><button class="button btn" :disabled="collectionLoading" @click="loadCollection(true)">加载更多</button></div></template>
      </template><div v-else-if="!error" class="empty-state"><Users :size="28" /><h1>未找到这位创作者</h1></div>
    </template>
    <template v-else>
      <section v-if="tab === 'creators'" class="creators-grid" aria-label="社区创作者">
        <article v-for="item in creators" :key="item.id" class="creator-card card">
          <RouterLink :to="{ path: '/community', query: { creator: item.id } }" class="creator-identity"><span class="avatar blue"><img v-if="item.avatarUrl" :src="item.avatarUrl" :alt="item.name || item.username" /><span v-else>{{ (item.name || item.username).slice(0, 1) }}</span></span><div class="creator-name"><h2>{{ item.name || item.username }}</h2><p class="caption-5">@{{ item.username }}</p></div><ArrowUpRight :size="16" /></RouterLink>
          <p v-if="item.bio" class="creator-summary">{{ item.bio }}</p>
          <div class="creator-footer"><span class="caption-5">{{ item.count }} 件公开作品</span><button v-if="item.id !== session.user?.id" class="button btn subtle" :aria-pressed="item.followed" :disabled="!!following" @click="follow(item)"><component :is="item.followed ? UserCheck : UserPlus" :size="15" />{{ item.followed ? '已关注' : '关注' }}</button></div>
        </article>
        <div v-if="!creators.length && !error" class="empty-state"><Users :size="28" /><h2>暂无创作者</h2></div>
      </section>
      <section v-else class="announcement-list" aria-label="社区公告"><details v-for="item in announcements" :key="item.id" class="announcement-item"><summary><strong>{{ item.title }}</strong><time class="caption-5">{{ item.createdAt ? new Date(item.createdAt).toLocaleDateString('zh-CN') : item.date }}</time><ChevronDown :size="17" /></summary><div class="announcement-body"><p>{{ item.body || item.text }}</p></div></details><div v-if="!announcements.length && !error" class="empty-state"><Megaphone :size="28" /><h2>暂无公告</h2></div></section>
      <CommunityAds :slots="['communityAd3', 'communityAd4']" />
    </template>
  </div>
</template>

<style scoped>
.community-toolbar { display: flex; justify-content: space-between; align-items: center; gap: 24px; margin-bottom: 28px; padding-bottom: 20px; border-bottom: 1px solid var(--border); }
.community-toolbar h1, .profile-copy h1 { margin: 0; color: var(--ink); font-size: 28px; line-height: 36px; font-weight: 600; }
.community-toolbar .tabs { margin: 0; }
.creators-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; }
.creator-card { display: flex; flex-direction: column; gap: 16px; min-width: 0; min-height: 176px; padding: 16px; background: var(--surface); border: 1px solid var(--border); border-radius: 8px; box-shadow: none; }
.creator-identity { display: flex; align-items: center; gap: 12px; min-width: 0; }
.avatar { flex: 0 0 auto; overflow: hidden; }
.avatar img { width: 100%; height: 100%; object-fit: cover; }
.creator-card .avatar { width: 44px; height: 44px; }
.creator-name, .profile-copy { min-width: 0; }
.creator-name { flex: 1; }
.creator-name h2 { margin: 0 0 2px; overflow-wrap: anywhere; color: var(--ink); font-size: 15px; line-height: 22px; font-weight: 500; }
.creator-name .caption-5 { overflow-wrap: anywhere; }
.creator-identity > svg { flex: 0 0 auto; color: var(--muted); }
.creator-summary { display: -webkit-box; overflow: hidden; -webkit-box-orient: vertical; -webkit-line-clamp: 3; margin: 0; color: var(--muted); font-size: 13px; line-height: 22px; white-space: pre-wrap; overflow-wrap: anywhere; }
.creator-footer { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-top: auto; padding-top: 4px; }
.creator-footer .button { flex: 0 0 auto; min-height: 34px; padding: 6px 10px; font-size: 12px; }
.creators-grid > .empty-state { grid-column: 1 / -1; }
.announcement-list { max-width: 960px; margin: 0; }
.announcement-item { margin: 0; background: transparent; border: 0; border-bottom: 1px solid var(--border); border-radius: 0; }
.announcement-item summary { display: grid; grid-template-columns: minmax(0, 1fr) auto 20px; align-items: center; gap: 16px; padding: 22px 0; list-style: none; cursor: pointer; }
.announcement-item summary::-webkit-details-marker { display: none; }
.announcement-item summary strong { color: var(--ink); font-size: 15px; line-height: 24px; font-weight: 500; overflow-wrap: anywhere; }
.announcement-item summary svg { color: var(--muted); }
.announcement-item[open] summary svg { transform: rotate(180deg); }
.announcement-body { padding: 0 36px 24px 0; color: var(--muted); font-size: 14px; line-height: 26px; white-space: pre-wrap; overflow-wrap: anywhere; }
.profile-back { margin: 0 0 24px; min-height: 40px; color: var(--muted); }
.profile-banner { display: block; width: 100%; height: 180px; object-fit: cover; border-radius: var(--radius); margin-bottom: 28px; }
.creator-profile { display: flex; justify-content: space-between; align-items: flex-start; gap: 24px; margin-bottom: 32px; }
.creator-profile > .creator-identity { align-items: flex-start; flex: 1; gap: 20px; }
.creator-profile .avatar { width: 72px; height: 72px; font-size: 28px; }
.profile-copy h1 { overflow-wrap: anywhere; }
.profile-copy > .caption-5 { margin-top: 4px; overflow-wrap: anywhere; }
.profile-bio { white-space: pre-wrap; overflow-wrap: anywhere; margin-top: 12px; max-width: 70ch; color: var(--muted); font-size: 14px; line-height: 24px; }
.profile-actions, .person-row, .person-identity { display: flex; align-items: center; gap: 12px; }
.profile-actions { flex: 0 0 auto; flex-wrap: wrap; padding-top: 4px; }
.profile-tabs { margin-bottom: 28px; }
.profile-work-heading { margin-bottom: 20px; }
.profile-work-heading h2 { font-size: 16px; line-height: 24px; font-weight: 500; }
.people-list { max-width: 760px; }
.person-row { justify-content: space-between; padding: 20px 0; border-bottom: 1px solid var(--border); }
.person-identity { min-width: 0; }
.person-identity > div { min-width: 0; }
.person-identity strong { color: var(--ink); font-size: 14px; line-height: 22px; font-weight: 500; overflow-wrap: anywhere; }
.person-identity .caption-5 { overflow-wrap: anywhere; }
@media (max-width: 1199px) { .creators-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }.creator-profile { flex-wrap: wrap; } }
@media (max-width: 639px) {
  .community-toolbar { align-items: flex-start; flex-direction: column; gap: 16px; margin-bottom: 24px; padding-bottom: 16px; }
  .community-toolbar h1, .profile-copy h1 { font-size: 24px; line-height: 32px; }
  .creators-grid { grid-template-columns: minmax(0, 1fr); gap: 12px; }
  .creator-card { min-height: 160px; padding: 18px; }
  .creator-footer .button { min-height: 44px; }
  .announcement-item summary { gap: 10px; padding: 18px 0; }
  .announcement-item summary strong { font-size: 14px; }
  .announcement-item time { font-size: 11px; }
  .announcement-body { padding-right: 0; }
  .profile-back { margin-bottom: 16px; }
  .profile-banner { height: 120px; margin-bottom: 24px; }
  .creator-profile { gap: 20px; margin-bottom: 24px; }
  .creator-profile > .creator-identity { gap: 14px; }
  .creator-profile .avatar { width: 56px; height: 56px; font-size: 22px; }
  .profile-actions { width: 100%; padding: 0; }
  .profile-tabs { margin-bottom: 24px; }
  .person-row { flex-wrap: wrap; gap: 16px; }
}
</style>
