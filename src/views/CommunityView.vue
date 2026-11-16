<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowUpRight, Bookmark, ChevronDown, Heart, Images, LockKeyhole, Megaphone, MessageSquare, Pencil, Trash2, Users, X } from '@lucide/vue'
import WorkCard from '../components/WorkCard.vue'
import BentoGrid from '../components/BentoGrid.vue'
import CommunityAds from '../components/CommunityAds.vue'
import ContentSkeleton from '../components/ContentSkeleton.vue'
import { type Announcement, type Creator, type Work } from '../data'
import { api, errorMessage, loadSession, queryString, session } from '../state'
import FollowButton from '../components/FollowButton.vue'
import { changeRelationship, followRevision, seedRelationships, type Relationship } from '../following'
import ProfileWorkControls, { type ProfileWorkFilters } from '../components/ProfileWorkControls.vue'
import { confirmStudioDelete } from '../studio-confirm'
const route = useRoute()
const router = useRouter()
const tab = ref(route.query.tab === 'announcements' ? 'announcements' : 'creators')
const creatorId = computed(() => typeof route.query.creator === 'string' ? route.query.creator : '')
const creators = ref<Creator[]>([]), announcements = ref<Announcement[]>([]), creator = ref<Creator | null>(null), works = ref<Work[]>([])
const profileTabs = [{ value: 'works', label: '作品' }, { value: 'saved', label: '收藏' }, { value: 'liked', label: '喜欢' }] as const
const profileTab = ref<'works' | 'saved' | 'liked'>('works'), people = ref<Creator[]>([])
const filters = ref<ProfileWorkFilters>({ kind: 'all', visibility: 'all', from: '', to: '' })
const selecting = ref(false), selectedWorks = ref(new Set<string>()), deleting = ref(false)
const nextCursor = ref<string | null>(null), worksCursor = ref<string | null>(null), collectionLoading = ref(false)
const loading = ref(true), error = ref(''), collectionError = ref('')
const peopleDialog = ref<HTMLDialogElement>(), peopleMode = ref<'followers' | 'following'>('followers')
const peopleLoading = ref(false), peopleError = ref('')
const removeDialog = ref<HTMLDialogElement>(), removing = ref<Creator | null>(null), removeBusy = ref(false)
const isOwnProfile = computed(() => Boolean(creator.value && creator.value.id === session.user?.id))
const collectionPrivate = computed(() => profileTab.value !== 'works' && !isOwnProfile.value)
const collectionLabel = computed(() => profileTabs.find(item => item.value === profileTab.value)!.label)
const selectedItems = computed(() => works.value.filter(work => work.owned && selectedWorks.value.has(work.id)))
const allSelected = computed(() => works.value.length > 0 && works.value.every(work => work.owned && selectedWorks.value.has(work.id)))
const emptyLabel = computed(() => filters.value.kind !== 'all' || filters.value.from || filters.value.to ? '没有符合筛选条件的作品'
  : profileTab.value !== 'works' ? `还没有${collectionLabel.value}作品`
  : !isOwnProfile.value ? '还没有公开作品' : ({ all: '还没有作品', public: '还没有公开作品', private: '还没有私密作品', draft: '草稿箱为空' })[filters.value.visibility])
let loadId = 0, collectionId = 0, peopleId = 0
onBeforeUnmount(() => { loadId++; collectionId++; peopleId++ })
function creatorIdentity(item: Creator) {
  const id = item.accountId || (/^[1-9]\d*$/.test(item.id) ? item.id : '')
  return id ? `章鱼号：${id}` : ''
}
async function load() {
  const current = ++loadId, captured = followRevision.value
  ++collectionId; ++peopleId; peopleDialog.value?.close(); removeDialog.value?.close(); removing.value = null
  loading.value = true; error.value = ''; creator.value = null; works.value = []; people.value = []; profileTab.value = 'works'
  filters.value = { kind: 'all', visibility: 'all', from: '', to: '' }; selecting.value = false; selectedWorks.value = new Set()
  worksCursor.value = null; nextCursor.value = null; collectionError.value = ''; peopleError.value = ''
  try {
    await loadSession()
    if (current !== loadId) return
    const owner = session.user?.id
    if (creatorId.value) {
      const result = await api<{ user: Creator }>(`/api/users/${encodeURIComponent(creatorId.value)}`)
      if (current !== loadId || owner !== session.user?.id) return
      creator.value = { ...result.user, count: result.user.worksCount ?? result.user.count ?? 0 }; seedRelationships([creator.value], captured)
      await loadCollection()
    } else {
      const [peopleResult, news] = await Promise.all([api<{ items: Creator[] }>('/api/creators'), api<{ items: Announcement[] }>('/api/announcements')])
      if (current !== loadId || owner !== session.user?.id) return
      creators.value = peopleResult.items; seedRelationships(peopleResult.items, captured); announcements.value = news.items
    }
  } catch (cause) { if (current === loadId) error.value = errorMessage(cause) }
  finally { if (current === loadId) loading.value = false }
}
async function loadCollection(append = false) {
  if (!creator.value) return
  const current = ++collectionId
  const selectedTab = profileTab.value, owner = session.user?.id, own = isOwnProfile.value
  collectionError.value = ''
  if (!append) { works.value = []; worksCursor.value = null; selectedWorks.value = new Set() }
  if (collectionPrivate.value) { collectionLoading.value = false; return }
  collectionLoading.value = true; collectionError.value = ''
  try {
    const path = selectedTab === 'works' && !own ? '/api/works' : '/api/library'
    const start = filters.value.from ? new Date(`${filters.value.from}T00:00:00`) : undefined
    const end = filters.value.to ? new Date(`${filters.value.to}T00:00:00`) : undefined
    end?.setDate(end.getDate() + 1)
    const result = await api<{ items: Work[]; nextCursor?: string | null }>(`${path}${queryString({
      authorId: path === '/api/works' ? creatorId.value : undefined,
      tab: selectedTab === 'works' ? undefined : selectedTab,
      kind: filters.value.kind === 'all' ? undefined : filters.value.kind,
      visibility: own && selectedTab === 'works' && ['public', 'private'].includes(filters.value.visibility) ? filters.value.visibility : undefined,
      status: own && selectedTab === 'works' && filters.value.visibility === 'draft' ? 'draft' : undefined,
      from: start?.toISOString(), to: end?.toISOString(),
      cursor: append ? worksCursor.value || undefined : undefined,
    })}`)
    if (current === collectionId && owner === session.user?.id && (selectedTab === 'works' || isOwnProfile.value)) {
      works.value = append ? [...works.value, ...result.items] : result.items
      worksCursor.value = result.nextCursor || null
    }
  } catch (cause) { if (current === collectionId) collectionError.value = errorMessage(cause) }
  finally { if (current === collectionId) collectionLoading.value = false }
}
async function loadPeople(append = false) {
  if (!creator.value) return
  const current = ++peopleId, captured = followRevision.value, owner = session.user?.id
  peopleLoading.value = true; peopleError.value = ''
  if (!append) { people.value = []; nextCursor.value = null }
  try {
    const result = await api<{ items: Creator[]; nextCursor?: string | null }>(`/api/users/${encodeURIComponent(creatorId.value)}/${peopleMode.value}${queryString({ cursor: append ? nextCursor.value || undefined : undefined })}`)
    if (current === peopleId && owner === session.user?.id) { seedRelationships(result.items, captured); people.value = append ? [...people.value, ...result.items] : result.items; nextCursor.value = result.nextCursor || null }
  } catch (cause) { if (current === peopleId) peopleError.value = errorMessage(cause) }
  finally { if (current === peopleId) peopleLoading.value = false }
}
function openPeople(mode: 'followers' | 'following') {
  peopleMode.value = mode
  peopleDialog.value?.showModal()
  void loadPeople()
}
function closePeople() { ++peopleId; peopleLoading.value = false; peopleError.value = ''; people.value = []; nextCursor.value = null }
watch([creatorId, () => session.user?.id], () => { void load() }, { immediate: true })
watch([profileTab, filters], () => { selecting.value = false; selectedWorks.value = new Set(); if (!loading.value) void loadCollection() })
function toggleWorkSelection(id: string) {
  const next = new Set(selectedWorks.value)
  if (next.has(id)) next.delete(id); else next.add(id)
  selectedWorks.value = next
}
async function deleteSelectedWorks() {
  const items = selectedItems.value.map(work => ({ id: work.id, version: work.version }))
  const owner = session.user?.id, profile = creatorId.value, generation = collectionId
  const current = () => owner === session.user?.id && profile === creatorId.value && generation === collectionId && isOwnProfile.value && profileTab.value === 'works'
  if (deleting.value || !items.length || !await confirmStudioDelete(`删除选中的 ${items.length} 件作品？删除后无法恢复。`, () => current() && !deleting.value)) return
  deleting.value = true; collectionError.value = ''
  let removed = 0
  try {
    for (const item of items) {
      if (!current()) return
      await api(`/api/works/${encodeURIComponent(item.id)}`, { method: 'DELETE', body: { version: item.version } })
      if (!current()) return
      works.value = works.value.filter(work => work.id !== item.id); selectedWorks.value.delete(item.id); removed++
    }
    selecting.value = false
  } catch (cause) { if (current()) collectionError.value = `${removed ? `已删除 ${removed} 件。` : ''}${errorMessage(cause)} 剩余作品已保留，请核对后重试。` }
  finally { deleting.value = false }
}
watch(() => route.query.tab, value => { tab.value = value === 'announcements' ? 'announcements' : 'creators' })
function selectTab(value: 'creators' | 'announcements') { void router.push({ path: '/community', query: { tab: value } }) }
function updateRelationship(result: Relationship) {
  for (const item of [...creators.value, ...people.value, ...(creator.value ? [creator.value] : [])]) if (item.id === result.id) Object.assign(item, result)
  if (isOwnProfile.value && creator.value) {
    if (result.viewerFollowingCount !== undefined) creator.value.followingCount = result.viewerFollowingCount
    if (result.viewerFollowersCount !== undefined) creator.value.followersCount = result.viewerFollowersCount
    if (peopleMode.value === 'following' && !result.followed) people.value = people.value.filter(item => item.id !== result.id)
  }
}
async function removeFollower() {
  const person = removing.value, owner = session.user?.id, current = loadId
  if (!person || removeBusy.value || !isOwnProfile.value) return
  removeBusy.value = true; peopleError.value = ''
  try {
    const result = await changeRelationship(person.id, false, true)
    if (result && current === loadId && owner === session.user?.id) {
      updateRelationship(result); people.value = people.value.filter(item => item.id !== person.id)
      removeDialog.value?.close(); removing.value = null
    }
  } catch (cause) { if (current === loadId) peopleError.value = errorMessage(cause) }
  finally { removeBusy.value = false }
}

</script>

<template>
  <div class="page-container community-page">
    <div v-if="!creatorId" class="community-toolbar">
      <h1>社区</h1>
      <div class="tabs" aria-label="社区分类"><button class="tab" :class="{ active: tab === 'creators' }" :aria-pressed="tab === 'creators'" @click="selectTab('creators')"><Users :size="16" />创作者</button><button class="tab" :class="{ active: tab === 'announcements' }" :aria-pressed="tab === 'announcements'" @click="selectTab('announcements')"><Megaphone :size="16" />社区公告</button></div>
    </div>
    <p v-if="error" class="notice-inline" role="alert">{{ error }} <button class="text-link" @click="load">重试</button></p><ContentSkeleton v-if="loading" layout="creators" label="正在加载社区…" />
    <template v-else-if="creatorId">
      <template v-if="creator"><img v-if="creator.bannerUrl" class="profile-banner" :src="creator.bannerUrl" alt="" />
        <div class="creator-profile">
          <span class="avatar blue profile-avatar"><img v-if="creator.avatarUrl" :src="creator.avatarUrl" :alt="creator.name || creator.username" /><span v-else>{{ (creator.name || creator.username || '用').slice(0, 1) }}</span></span>
          <div class="profile-copy">
            <div class="profile-heading"><h1>{{ creator.name || creator.username }}</h1><div class="profile-actions">
              <RouterLink v-if="isOwnProfile" to="/account?tab=profile" class="button btn subtle"><Pencil :size="16" />编辑资料</RouterLink><RouterLink v-if="isOwnProfile" to="/account?tab=following" class="button btn subtle">关注申请</RouterLink>
              <template v-else><FollowButton :person="creator" @changed="updateRelationship" /><RouterLink v-if="session.user" :to="`/messages/${creator.id}`" class="button btn subtle"><MessageSquare :size="16" />私信</RouterLink></template>
            </div></div>
            <div class="profile-stats" aria-label="创作者统计">
              <button class="profile-stat" aria-label="查看关注" aria-haspopup="dialog" @click="openPeople('following')"><span>关注</span><strong>{{ creator.followingCount ?? 0 }}</strong></button>
              <button class="profile-stat" aria-label="查看粉丝" aria-haspopup="dialog" @click="openPeople('followers')"><span>粉丝</span><strong>{{ creator.followersCount ?? 0 }}</strong></button>
              <span class="profile-stat"><span>收获点赞</span><strong>{{ creator.receivedLikesCount ?? 0 }}</strong></span>
            </div>
            <p v-if="creatorIdentity(creator)" class="caption-5 profile-account-id">{{ creatorIdentity(creator) }}</p>
            <p v-if="creator.bio" class="profile-bio">{{ creator.bio }}</p>
          </div>
        </div>
        <div class="profile-content-toolbar"><div class="tabs profile-tabs" aria-label="个人主页内容"><button v-for="item in profileTabs" :key="item.value" class="tab" :class="{ active: profileTab === item.value }" :aria-pressed="profileTab === item.value" :disabled="deleting" @click="profileTab = item.value">{{ item.label }}</button></div><ProfileWorkControls v-if="!collectionPrivate" :filters="filters" :own="isOwnProfile" :works-tab="profileTab === 'works'" :disabled="deleting" @apply="filters = $event" @select="selecting = !selecting; selectedWorks = new Set()" /></div>
        <div v-if="collectionPrivate" class="empty-state profile-private"><LockKeyhole :size="28" /><h2>{{ collectionLabel }}仅本人可见</h2></div>
        <template v-else>
          <div v-if="selecting && isOwnProfile && profileTab === 'works'" class="profile-selection" role="toolbar" aria-label="作品批量操作"><label><input type="checkbox" aria-label="全选当前作品" :checked="allSelected" :disabled="deleting || collectionLoading" @change="selectedWorks = allSelected ? new Set() : new Set(works.filter(work => work.owned).map(work => work.id))" />全选当前页</label><span role="status">已选 {{ selectedItems.length }} 件</span><button type="button" class="icon-button" title="删除所选作品" aria-label="删除所选作品" :disabled="deleting || !selectedItems.length" @click="deleteSelectedWorks"><Trash2 :size="17" /></button><button type="button" class="icon-button" title="退出批量管理" aria-label="退出批量管理" :disabled="deleting" @click="selecting = false; selectedWorks = new Set()"><X :size="18" /></button></div>
          <p v-if="collectionError" class="form-error" role="alert">{{ collectionError }} <button class="text-link" @click="loadCollection()">重试</button></p>
          <div v-if="collectionLoading && !works.length" class="empty-state" role="status">正在加载作品…</div>
          <BentoGrid v-else-if="works.length" class="profile-works"><WorkCard v-for="(work, index) in works" :key="work.id" :work="work" :management="isOwnProfile && profileTab === 'works'" :eager="index < 3"><template #actions><label v-if="selecting && work.owned" class="profile-work-select"><input type="checkbox" :aria-label="`选择作品：${work.title}`" :checked="selectedWorks.has(work.id)" :disabled="deleting" @change="toggleWorkSelection(work.id)" /><span class="studio-sr-only">选择作品</span></label></template></WorkCard></BentoGrid>
          <div v-else-if="!collectionError" class="empty-state"><component :is="profileTab === 'saved' ? Bookmark : profileTab === 'liked' ? Heart : Images" :size="28" /><h2>{{ emptyLabel }}</h2></div>
          <div v-if="worksCursor" class="feed-end"><button class="button btn" :disabled="collectionLoading" @click="loadCollection(true)">加载更多</button></div>
        </template>
        <dialog ref="peopleDialog" class="profile-people-dialog" aria-labelledby="profile-people-heading" @close="closePeople">
          <div class="dialog-heading"><h2 id="profile-people-heading">{{ peopleMode === 'followers' ? '粉丝' : '关注' }}</h2><button class="icon-button" aria-label="关闭列表" title="关闭列表" @click="peopleDialog?.close()"><X :size="20" /></button></div>
          <div class="profile-people-body">
            <p v-if="peopleError" class="form-error" role="alert">{{ peopleError }} <button class="text-link" @click="loadPeople()">重试</button></p>
            <div v-if="peopleLoading && !people.length" class="profile-people-status" role="status">正在加载列表…</div>
            <div class="people-list"><article v-for="person in people" :key="person.id" class="person-row"><RouterLink :to="{ path: '/community', query: { creator: person.id } }" class="person-identity"><span class="avatar blue"><img v-if="person.avatarUrl" :src="person.avatarUrl" :alt="person.name || person.username" /><span v-else>{{ (person.name || person.username || '用').slice(0, 1) }}</span></span><div><strong>{{ person.name || person.username }}</strong><p v-if="creatorIdentity(person)" class="caption-5">{{ creatorIdentity(person) }}</p></div></RouterLink><div class="person-actions"><FollowButton :person="person" @changed="updateRelationship" /><button v-if="isOwnProfile && peopleMode === 'followers'" class="button btn subtle" @click="removing = person; removeDialog?.showModal()">移除粉丝</button></div></article></div>
            <p v-if="!peopleLoading && !people.length && !peopleError" class="profile-people-status">暂无{{ peopleMode === 'followers' ? '粉丝' : '关注' }}</p>
            <div v-if="nextCursor" class="feed-end"><button class="button btn" :disabled="peopleLoading" @click="loadPeople(true)">加载更多</button></div>
          </div>
        </dialog>
        <dialog ref="removeDialog" class="compact-dialog" aria-labelledby="remove-follower-heading"><div class="dialog-heading"><h2 id="remove-follower-heading">移除这位粉丝？</h2></div><div class="dialog-body stack"><p>{{ removing?.name }} 将从你的粉丝列表中移除，对方仍可重新关注或申请。</p><p v-if="peopleError" role="alert" class="form-error">{{ peopleError }}</p><div class="table-actions"><button class="button btn subtle" :disabled="removeBusy" @click="removeDialog?.close()">取消</button><button class="button btn" :disabled="removeBusy" @click="removeFollower">{{ removeBusy ? '正在移除…' : '确认移除' }}</button></div></div></dialog>
      </template><div v-else-if="!error" class="empty-state"><Users :size="28" /><h1>未找到这位创作者</h1></div>
    </template>
    <template v-else>
      <section v-if="tab === 'creators'" class="creators-grid" aria-label="社区创作者">
        <article v-for="item in creators" :key="item.id" class="creator-card card">
          <RouterLink :to="{ path: '/community', query: { creator: item.id } }" class="creator-identity"><span class="avatar blue"><img v-if="item.avatarUrl" :src="item.avatarUrl" :alt="item.name || item.username" /><span v-else>{{ (item.name || item.username).slice(0, 1) }}</span></span><div class="creator-name"><h2>{{ item.name || item.username }}</h2><p v-if="creatorIdentity(item)" class="caption-5">{{ creatorIdentity(item) }}</p></div><ArrowUpRight :size="16" /></RouterLink>
          <p v-if="item.bio" class="creator-summary">{{ item.bio }}</p>
          <div class="creator-footer"><span class="caption-5">{{ item.count }} 件公开作品</span><FollowButton :person="item" @changed="updateRelationship" /></div>
        </article>
        <div v-if="!creators.length && !error" class="empty-state"><Users :size="28" /><h2>暂无创作者</h2></div>
      </section>
      <section v-else class="announcement-list" aria-label="社区公告"><details v-for="item in announcements" :key="item.id" class="announcement-item"><summary><strong>{{ item.title }}</strong><time class="caption-5">{{ item.createdAt ? new Date(item.createdAt).toLocaleDateString('zh-CN') : item.date }}</time><ChevronDown :size="17" /></summary><div class="announcement-body"><p>{{ item.body || item.text }}</p></div></details><div v-if="!announcements.length && !error" class="empty-state"><Megaphone :size="28" /><h2>暂无公告</h2></div></section>
      <CommunityAds :slots="['communityAd3', 'communityAd4']" />
    </template>
  </div>
</template>

<style scoped>
.person-actions { display: flex; flex-wrap: wrap; gap: 8px; justify-content: flex-end; }
.person-actions > button { min-height: 44px; }
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
.profile-banner { display: block; width: 100%; height: 180px; object-fit: cover; border-radius: var(--radius); margin-bottom: 28px; }
.creator-profile { display: grid; grid-template-columns: 160px minmax(0, 1fr); align-items: start; gap: 32px; margin: 24px 0 40px; }
.creator-profile > .profile-avatar { width: 160px; height: 160px; border-radius: 50%; font-size: 56px; }
.profile-copy { padding-top: 4px; }
.profile-heading { display: flex; justify-content: space-between; align-items: flex-start; gap: 24px; }
.profile-copy h1 { margin: 0; min-width: 0; overflow-wrap: anywhere; font-size: 28px; line-height: 36px; font-weight: 600; }
.profile-stats { display: flex; flex-wrap: wrap; align-items: center; column-gap: 32px; row-gap: 0; margin: 8px 0 12px; }
.profile-stat { position: relative; display: inline-flex; align-items: center; flex: 0 0 auto; gap: 8px; min-height: 44px; border: 0; background: transparent; color: var(--muted); font-size: 15px; line-height: 24px; padding: 0; }
.profile-stat + .profile-stat::before { content: ''; position: absolute; top: 14px; bottom: 14px; left: -16px; width: 1px; background: var(--border); }
.profile-stat strong { color: var(--ink); font-size: 20px; line-height: 28px; font-weight: 500; font-variant-numeric: tabular-nums; }
button.profile-stat:hover { color: var(--ink); }
button.profile-stat:hover strong { color: var(--blue-hover); }
.profile-copy > .profile-account-id { margin: 0; color: var(--muted); overflow-wrap: anywhere; font-size: 13px; line-height: 20px; }
.profile-bio { white-space: pre-wrap; overflow-wrap: anywhere; margin-top: 12px; max-width: 70ch; color: var(--muted); font-size: 14px; line-height: 24px; }
.profile-actions, .person-row, .person-identity { display: flex; align-items: center; gap: 12px; }
.profile-actions { flex: 0 0 auto; flex-wrap: wrap; justify-content: flex-end; }
.profile-actions .button { min-height: 40px; white-space: nowrap; }
.profile-content-toolbar { display: flex; align-items: center; gap: 16px; border-bottom: 1px solid var(--border); margin-bottom: 28px; min-width: 0; }
.profile-tabs { flex: 1; gap: 40px; padding-bottom: 0; margin-bottom: 0; border-bottom: 0; }
.profile-tabs .tab { min-height: 48px; padding: 12px 0; font-size: 16px; }
.profile-selection { display: flex; align-items: center; flex-wrap: wrap; gap: 8px 16px; min-height: 44px; margin-bottom: 16px; color: var(--muted); font-size: 13px; }.profile-selection label { display: flex; align-items: center; gap: 8px; min-height: 44px; }.profile-selection > span { margin-inline-end: auto; }.profile-selection input { accent-color: var(--ink); width: 18px; height: 18px; }
.profile-work-select { position: absolute; z-index: 3; inset: 8px auto auto 8px; display: grid; place-items: center; width: 44px; height: 44px; border-radius: 6px; background: var(--surface); cursor: pointer; }.profile-work-select input { width: 20px; height: 20px; margin: 0; accent-color: var(--ink); cursor: pointer; }
.profile-private { min-height: 240px; }
.profile-people-dialog { width: 560px; max-width: calc(100vw - 32px); }
.profile-people-body { padding: 0 24px 24px; max-height: min(560px, 65svh); overflow-y: auto; }
.profile-people-status { padding: 32px 0; text-align: center; color: var(--muted); font-size: 14px; line-height: 24px; }
.people-list { max-width: 760px; }
.person-row { justify-content: space-between; padding: 20px 0; border-bottom: 1px solid var(--border); }
.person-identity { min-width: 0; }
.person-identity > div { min-width: 0; }
.person-identity strong { color: var(--ink); font-size: 14px; line-height: 22px; font-weight: 500; overflow-wrap: anywhere; }
.person-identity .caption-5 { overflow-wrap: anywhere; }
@media (max-width: 1199px) { .creators-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
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
  .profile-banner { height: 120px; margin-bottom: 24px; }
  .creator-profile { grid-template-columns: 80px minmax(0, 1fr); gap: 16px; margin: 16px 0 28px; }
  .creator-profile > .profile-avatar { width: 80px; height: 80px; font-size: 32px; }
  .profile-copy { padding-top: 0; }
  .profile-heading { flex-wrap: wrap; gap: 12px; }
  .profile-copy h1 { flex: 1 1 auto; font-size: 24px; line-height: 32px; }
  .profile-actions { gap: 8px; }
  .profile-actions .button { min-height: 44px; padding-inline: 12px; font-size: 12px; }
  .profile-stats { column-gap: 20px; margin: 4px 0 8px; }
  .profile-stat { gap: 4px; font-size: 12px; line-height: 20px; }
  .profile-stat strong { font-size: 16px; line-height: 24px; }
  .profile-stat + .profile-stat::before { left: -10px; }
  .profile-copy > .profile-account-id { font-size: 12px; }
  .profile-bio { font-size: 13px; line-height: 22px; }
  .profile-content-toolbar { gap: 8px; flex-wrap: wrap; margin-bottom: 24px; }
  .profile-tabs { gap: 24px; margin-bottom: 0; flex: 1 1 auto; }
  .profile-tabs .tab { font-size: 15px; }
  .profile-people-body { padding: 0 16px 16px; }
  .person-row { flex-wrap: wrap; gap: 16px; }
}
</style>
