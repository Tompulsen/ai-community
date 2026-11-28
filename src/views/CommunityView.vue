<script setup lang="ts">
import { computed, inject, nextTick, onBeforeUnmount, ref, watch, type Ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowUpRight, Bookmark, Heart, Images, LockKeyhole, MessageSquare, Pencil, Settings, LayoutGrid, WandSparkles, Trash2, Users, X } from '@lucide/vue'
import { previewImageUrl } from '../image-download'
import WorkCard from '../components/WorkCard.vue'
import WorkManagementDialogs from '../components/WorkManagementDialogs.vue'
import BentoGrid from '../components/BentoGrid.vue'
import CommunityAds from '../components/CommunityAds.vue'
import ContentSkeleton from '../components/ContentSkeleton.vue'
import { type Creator, type Work } from '../data'
import { api, canManageWork, errorMessage, loadSession, notify, queryString, session, uploadFile } from '../state'
import FollowButton from '../components/FollowButton.vue'
import { changeRelationship, followRevision, seedRelationships, type Relationship } from '../following'
import ProfileWorkControls, { type ProfileWorkFilters } from '../components/ProfileWorkControls.vue'
import ProfileEditor from '../components/ProfileEditor.vue'
import ProfileImageCropper from '../components/ProfileImageCropper.vue'
import type { SessionUser } from '../data'
import { confirmStudioDelete } from '../studio-confirm'
const mobile = inject<Ref<boolean>>('mobile-community', ref(false))
const route = useRoute(), router = useRouter()
const creatorId = computed(() => typeof route.query.creator === 'string' ? route.query.creator : '')
const creators = ref<Creator[]>([]), creator = ref<Creator | null>(null), works = ref<Work[]>([])
const profileTabs = [{ value: 'works', label: '作品' }, { value: 'saved', label: '收藏' }, { value: 'liked', label: '喜欢' }] as const
const profileTab = ref<'works' | 'saved' | 'liked'>('works'), people = ref<Creator[]>([])
const filters = ref<ProfileWorkFilters>({ kind: 'all', visibility: 'all', from: '', to: '' })
const workManager = ref<InstanceType<typeof WorkManagementDialogs>>()
const selecting = ref(false), selectedWorks = ref(new Set<string>()), deleting = ref(false)
const nextCursor = ref<string | null>(null), worksCursor = ref<string | null>(null), collectionLoading = ref(false)
const loading = ref(true), error = ref(''), collectionError = ref('')
const peopleDialog = ref<HTMLDialogElement>(), peopleMode = ref<'followers' | 'following'>('followers')
const peopleLoading = ref(false), peopleError = ref('')
const removeDialog = ref<HTMLDialogElement>(), removing = ref<Creator | null>(null), removeBusy = ref(false)
const isOwnProfile = computed(() => Boolean(creator.value && creator.value.id === session.user?.id))
const editingProfile = ref(false)
watch([isOwnProfile, () => route.query.edit], ([own, edit]) => {
  if (!own) editingProfile.value = false
  else if (edit === 'profile') editingProfile.value = true
}, { immediate: true })
function closeProfileEditor() {
  editingProfile.value = false
  if (route.query.edit === 'profile') void router.replace({ path: route.path, query: { ...route.query, edit: undefined } })
}
const mediaPicker = ref<InstanceType<typeof ProfileImageCropper>>(), profileRegion = ref<HTMLElement>()
const bannerAspect = ref(4), mediaBusy = ref(false), mediaError = ref(''), mediaProgress = ref(0)
const mediaRetry = ref<{ file: File; field: 'avatar' | 'banner' }>()
let mediaController: AbortController | undefined, mediaOperation = 0
function chooseProfileImage(field: 'avatar' | 'banner') {
  if (!isOwnProfile.value || mediaBusy.value) return
  const rect = profileRegion.value?.getBoundingClientRect()
  if (rect) bannerAspect.value = rect.width / rect.height
  else bannerAspect.value = mobile.value ? 1.2 : 4
  mediaPicker.value?.preview(field, field === 'avatar' ? creator.value?.avatarUrl : creator.value?.bannerUrl, bannerAspect.value)
}
function cancelMedia() {
  mediaOperation++; mediaController?.abort(); mediaBusy.value = false; mediaError.value = ''; mediaRetry.value = undefined
}
watch([() => session.user?.id, creatorId], cancelMedia)
onBeforeUnmount(cancelMedia)
async function saveProfileImage(file: File, field: 'avatar' | 'banner') {
  if (!isOwnProfile.value || !session.user || mediaBusy.value) return
  const owner = session.user.id, current = ++mediaOperation
  const valid = () => current === mediaOperation && session.user?.id === owner && creatorId.value === owner
  const controller = new AbortController(); mediaController = controller
  mediaRetry.value = { file, field }; mediaBusy.value = true; mediaError.value = ''; mediaProgress.value = 0
  notify('裁切已确认，正在保存图片。')
  try {
    const uploaded = await uploadFile(file, controller.signal, progress => { if (valid()) mediaProgress.value = progress })
    if (!valid()) return
    const result = await api<{ user: SessionUser }>('/api/profile', { method: 'PATCH', signal: controller.signal, body: {
      [`${field}Id`]: uploaded.id,
    } })
    if (!valid()) return
    session.user = { ...session.user!, avatarId: result.user.avatarId, bannerId: result.user.bannerId, avatarUrl: result.user.avatarUrl, bannerUrl: result.user.bannerUrl }
    profileSaved(session.user); mediaRetry.value = undefined
    notify(field === 'avatar' ? '头像已更新。' : '封面已更新。')
  } catch (cause) { if (valid()) mediaError.value = errorMessage(cause) }
  finally { if (valid()) mediaBusy.value = false }
}
function profileSaved(user: SessionUser) {
  if (creator.value?.id === user.id && user.id === session.user?.id)
    Object.assign(creator.value, { name: user.name, bio: user.bio, avatarUrl: user.avatarUrl, bannerUrl: user.bannerUrl })
}
const collectionPrivate = computed(() => profileTab.value !== 'works' && !isOwnProfile.value)
const collectionLabel = computed(() => profileTabs.find(item => item.value === profileTab.value)!.label)
const selectedItems = computed(() => works.value.filter(work => work.owned && selectedWorks.value.has(work.id)))
const allSelected = computed(() => works.value.length > 0 && works.value.every(work => work.owned && selectedWorks.value.has(work.id)))
const emptyLabel = computed(() => filters.value.kind !== 'all' || filters.value.from || filters.value.to ? '没有符合筛选条件的作品'
  : profileTab.value !== 'works' ? `还没有${collectionLabel.value}作品`
  : !isOwnProfile.value ? '还没有公开作品' : ({ all: '还没有作品', public: '还没有公开作品', private: '还没有私密作品', draft: '草稿箱为空' })[filters.value.visibility])
let swipeStart: { x: number; y: number } | null = null
function beginSwipe(event: TouchEvent) {
  const point = event.touches[0]
  swipeStart = mobile.value && point && event.touches.length === 1 ? { x: point.clientX, y: point.clientY } : null
}
function endSwipe(event: TouchEvent) {
  const point = event.changedTouches[0], start = swipeStart
  swipeStart = null
  if (!point || !start || deleting.value || selecting.value || Math.abs(point.clientY - start.y) > 40 || Math.abs(point.clientX - start.x) < 64) return
  const index = profileTabs.findIndex(item => item.value === profileTab.value)
  const next = profileTabs[index + (point.clientX < start.x ? 1 : -1)]
  if (next) { event.preventDefault(); profileTab.value = next.value }
}
async function navigateProfileTabs(event: KeyboardEvent) {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key) || deleting.value) return
  event.preventDefault()
  const tabs = event.currentTarget as HTMLElement
  const index = profileTabs.findIndex(item => item.value === profileTab.value)
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? profileTabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + profileTabs.length) % profileTabs.length
  profileTab.value = profileTabs[next]!.value
  await nextTick()
  ;tabs.querySelector<HTMLElement>('[aria-selected="true"]')?.focus()
}
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
      const peopleResult = await api<{ items: Creator[] }>('/api/creators')
      if (current !== loadId || owner !== session.user?.id) return
      creators.value = peopleResult.items; seedRelationships(peopleResult.items, captured)
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
watch([creatorId, () => session.user?.id, () => session.user?.isAdmin], () => { void load() }, { immediate: true })
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
      await api(`/api/works/${encodeURIComponent(item.id)}`, { method: 'DELETE', expectedAccount: owner, body: { version: item.version } })
      if (!current()) return
      works.value = works.value.filter(work => work.id !== item.id); selectedWorks.value.delete(item.id); removed++
    }
    selecting.value = false
  } catch (cause) { if (current()) collectionError.value = `${removed ? `已删除 ${removed} 件。` : ''}${errorMessage(cause)} 剩余作品已保留，请核对后重试。` }
  finally { deleting.value = false }
}
function workSaved(work: Work) {
  const existing = works.value.find(item => item.id === work.id)
  if (existing) Object.assign(existing, work)
  void loadCollection()
}
function workDeleted(work: Work) {
  works.value = works.value.filter(item => item.id !== work.id)
  selectedWorks.value.delete(work.id)
}
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
  <div class="page-container community-page" :class="{ 'creator-page': creatorId }">
    <div v-if="!creatorId" class="community-toolbar">
      <h1>社区</h1>
    </div>
    <p v-if="error" class="notice-inline" role="alert">{{ error }} <button class="text-link" @click="load">重试</button></p><ContentSkeleton v-if="loading" layout="creators" label="正在加载社区…" />
    <template v-else-if="creatorId">
      <template v-if="creator">
        <section v-if="mobile" ref="profileRegion" class="mobile-profile profile-cover-region" :class="{ 'has-banner': creator.bannerUrl }" aria-label="个人资料">
          <button v-if="isOwnProfile" type="button" class="profile-cover-edit" aria-label="查看背景" title="查看背景" :disabled="mediaBusy" @click="chooseProfileImage('banner')" />
          <img v-if="creator.bannerUrl" class="profile-banner" :src="creator.bannerUrl" alt="" />
          <div class="profile-hero"><div class="profile-hero-identity"><component :is="isOwnProfile ? 'button' : 'span'" :type="isOwnProfile ? 'button' : undefined" class="avatar blue profile-avatar" :aria-label="isOwnProfile ? '查看头像' : undefined" :title="isOwnProfile ? '查看头像' : undefined" :disabled="isOwnProfile && mediaBusy" @click="chooseProfileImage('avatar')"><img v-if="creator.avatarUrl" :src="creator.avatarUrl" alt="" /><span v-else>{{ (creator.name || creator.username).slice(0, 1) }}</span></component><div><div class="profile-name"><h1>{{ creator.name || creator.username }}</h1><button v-if="isOwnProfile" type="button" class="icon-button profile-edit" aria-label="编辑资料" title="编辑资料" aria-haspopup="dialog" @click="editingProfile = true"><Pencil :size="16" aria-hidden="true" /></button></div><p>@{{ creator.username }}</p><p v-if="creatorIdentity(creator)">{{ creatorIdentity(creator) }}</p></div></div></div>
          <div class="mobile-profile-body"><div class="mobile-profile-stats"><button type="button" aria-label="查看关注" @click="openPeople('following')"><strong>{{ creator.followingCount ?? 0 }}</strong>关注</button><button type="button" aria-label="查看粉丝" @click="openPeople('followers')"><strong>{{ creator.followersCount ?? 0 }}</strong>粉丝</button><span><strong>{{ creator.receivedLikesCount ?? 0 }}</strong>获赞</span></div>
            <p v-if="creator.bio" class="mobile-profile-bio">{{ creator.bio }}</p><button v-else-if="isOwnProfile" type="button" class="profile-add-bio" aria-haspopup="dialog" @click="editingProfile = true">添加个人简介<Pencil :size="13" /></button>
            <div v-if="!isOwnProfile" class="profile-actions"><FollowButton :person="creator" @changed="updateRelationship" /><RouterLink v-if="session.user" :to="`/messages/${creator.id}`" class="button btn subtle"><MessageSquare :size="16" />私信</RouterLink></div>
            <nav v-if="isOwnProfile" class="profile-shortcuts" aria-label="个人主页工具"><RouterLink to="/library"><LayoutGrid :size="22" />作品管理</RouterLink><button type="button" @click="profileTab = 'saved'"><Bookmark :size="22" />我的收藏</button><RouterLink to="/create/video"><WandSparkles :size="22" />创作</RouterLink><RouterLink to="/account"><Settings :size="22" />设置</RouterLink></nav>
          </div>
        </section>
        <section v-else ref="profileRegion" class="profile-header profile-cover-region" :class="{ 'has-banner': creator.bannerUrl }" aria-label="个人资料"><img v-if="creator.bannerUrl" class="profile-banner" :src="creator.bannerUrl" alt="" />
        <button v-if="isOwnProfile" type="button" class="profile-cover-edit" aria-label="查看背景" title="查看背景" :disabled="mediaBusy" @click="chooseProfileImage('banner')" />
        <div class="creator-profile">
          <component :is="isOwnProfile ? 'button' : 'span'" :type="isOwnProfile ? 'button' : undefined" class="avatar blue profile-avatar" :aria-label="isOwnProfile ? '查看头像' : undefined" :title="isOwnProfile ? '查看头像' : undefined" :disabled="isOwnProfile && mediaBusy" @click="chooseProfileImage('avatar')"><img v-if="creator.avatarUrl" :src="creator.avatarUrl" :alt="creator.name || creator.username" /><span v-else>{{ (creator.name || creator.username || '用').slice(0, 1) }}</span></component>
          <div class="profile-copy">
            <div class="profile-heading"><div class="profile-name"><h1>{{ creator.name || creator.username }}</h1><button v-if="isOwnProfile" type="button" class="icon-button profile-edit" aria-label="编辑资料" title="编辑资料" aria-haspopup="dialog" @click="editingProfile = true"><Pencil :size="16" aria-hidden="true" /></button></div><div v-if="!isOwnProfile" class="profile-actions">
              <FollowButton :person="creator" @changed="updateRelationship" /><RouterLink v-if="session.user" :to="`/messages/${creator.id}`" class="button btn subtle"><MessageSquare :size="16" />私信</RouterLink>
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
        </section>
        <ProfileImageCropper v-if="isOwnProfile" :key="`${session.user?.id}:${creatorId}`" ref="mediaPicker" @cropped="saveProfileImage" />
        <p v-if="mediaBusy" class="profile-media-status" role="status">{{ mediaProgress < 100 ? `图片上传中 ${mediaProgress}%` : '正在保存图片…' }}</p>
        <p v-if="mediaError" class="notice-inline" role="alert">{{ mediaError }} <button v-if="mediaRetry" type="button" class="text-link" @click="saveProfileImage(mediaRetry.file, mediaRetry.field)">重试保存</button></p>
        <ProfileEditor v-if="editingProfile" @saved="profileSaved" @close="closeProfileEditor" />
        <div class="profile-content-toolbar"><div class="tabs profile-tabs" role="tablist" aria-label="个人主页内容" @keydown="navigateProfileTabs"><button v-for="item in profileTabs" :key="item.value" class="tab" :class="{ active: profileTab === item.value }" :id="`profile-tab-${item.value}`" role="tab" :aria-selected="profileTab === item.value" aria-controls="profile-collection" :tabindex="profileTab === item.value ? 0 : -1" :disabled="deleting" @click="profileTab = item.value">{{ item.label }}</button></div><ProfileWorkControls v-if="!collectionPrivate" :filters="filters" :own="isOwnProfile" :works-tab="profileTab === 'works'" :disabled="deleting" @apply="filters = $event" @select="selecting = !selecting; selectedWorks = new Set()" /></div>
        <div id="profile-collection" role="tabpanel" :aria-labelledby="`profile-tab-${profileTab}`" @touchstart.passive="beginSwipe" @touchend="endSwipe" @touchcancel="swipeStart = null">
        <div v-if="collectionPrivate" class="empty-state profile-private"><LockKeyhole :size="28" /><h2>{{ collectionLabel }}仅本人可见</h2></div>
        <template v-else>
          <div v-if="selecting && isOwnProfile && profileTab === 'works'" class="profile-selection" role="toolbar" aria-label="作品批量操作"><label><input type="checkbox" aria-label="全选当前作品" :checked="allSelected" :disabled="deleting || collectionLoading" @change="selectedWorks = allSelected ? new Set() : new Set(works.filter(work => work.owned).map(work => work.id))" />全选当前页</label><span role="status">已选 {{ selectedItems.length }} 件</span><button type="button" class="icon-button" title="删除所选作品" aria-label="删除所选作品" :disabled="deleting || !selectedItems.length" @click="deleteSelectedWorks"><Trash2 :size="17" /></button><button type="button" class="icon-button" title="退出批量管理" aria-label="退出批量管理" :disabled="deleting" @click="selecting = false; selectedWorks = new Set()"><X :size="18" /></button></div>
          <p v-if="collectionError" class="form-error" role="alert">{{ collectionError }} <button class="text-link" @click="loadCollection()">重试</button></p>
          <div v-if="collectionLoading && !works.length" class="empty-state" role="status">正在加载作品…</div>
          <BentoGrid v-else-if="works.length" class="profile-works"><WorkCard v-for="(work, index) in works" :key="work.id" :work="work" :management="canManageWork(work) && profileTab === 'works'" :eager="index < 3"><template #actions><label v-if="selecting && work.owned" class="profile-work-select"><input type="checkbox" :aria-label="`选择作品：${work.title}`" :checked="selectedWorks.has(work.id)" :disabled="deleting" @change="toggleWorkSelection(work.id)" /><span class="studio-sr-only">选择作品</span></label><div v-else-if="profileTab === 'works' && canManageWork(work)" class="profile-work-actions"><button type="button" class="button subtle btn" :aria-label="`编辑作品：${work.title}`" :disabled="deleting || collectionLoading" @click="workManager?.edit(work)"><Pencil :size="15" aria-hidden="true" />编辑</button><button type="button" class="button subtle btn work-delete" :aria-label="`删除作品：${work.title}`" :disabled="deleting || collectionLoading" @click="workManager?.remove(work)"><Trash2 :size="15" aria-hidden="true" />删除</button></div></template></WorkCard></BentoGrid>
          <div v-else-if="!collectionError" class="empty-state"><component :is="profileTab === 'saved' ? Bookmark : profileTab === 'liked' ? Heart : Images" :size="28" /><h2>{{ emptyLabel }}</h2></div>
          <div v-if="worksCursor" class="feed-end"><button class="button btn" :disabled="collectionLoading" @click="loadCollection(true)">加载更多</button></div>
        </template>
        </div>
        <WorkManagementDialogs ref="workManager" :disabled="deleting" @saved="workSaved" @deleted="workDeleted" />
        <dialog ref="peopleDialog" class="profile-people-dialog" aria-labelledby="profile-people-heading" @close="closePeople">
          <div class="dialog-heading"><h2 id="profile-people-heading">{{ peopleMode === 'followers' ? '粉丝' : '关注' }}</h2><button class="icon-button" aria-label="关闭列表" title="关闭列表" @click="peopleDialog?.close()"><X :size="20" /></button></div>
          <div class="profile-people-body">
            <p v-if="peopleError" class="form-error" role="alert">{{ peopleError }} <button class="text-link" @click="loadPeople()">重试</button></p>
            <div v-if="peopleLoading && !people.length" class="profile-people-status" role="status">正在加载列表…</div>
            <div class="people-list"><article v-for="person in people" :key="person.id" class="person-row"><RouterLink :to="{ path: '/community', query: { creator: person.id } }" class="person-identity"><span class="avatar blue"><img v-if="person.avatarUrl" :src="previewImageUrl(person.avatarUrl, 96)" loading="lazy" decoding="async" :alt="person.name || person.username" /><span v-else>{{ (person.name || person.username || '用').slice(0, 1) }}</span></span><div><strong>{{ person.name || person.username }}</strong><p v-if="creatorIdentity(person)" class="caption-5">{{ creatorIdentity(person) }}</p></div></RouterLink><div class="person-actions"><FollowButton :person="person" @changed="updateRelationship" /><button v-if="isOwnProfile && peopleMode === 'followers'" class="button btn subtle" @click="removing = person; removeDialog?.showModal()">移除粉丝</button></div></article></div>
            <p v-if="!peopleLoading && !people.length && !peopleError" class="profile-people-status">暂无{{ peopleMode === 'followers' ? '粉丝' : '关注' }}</p>
            <div v-if="nextCursor" class="feed-end"><button class="button btn" :disabled="peopleLoading" @click="loadPeople(true)">加载更多</button></div>
          </div>
        </dialog>
        <dialog ref="removeDialog" class="compact-dialog" aria-labelledby="remove-follower-heading"><div class="dialog-heading"><h2 id="remove-follower-heading">移除这位粉丝？</h2></div><div class="dialog-body stack"><p>{{ removing?.name }} 将从你的粉丝列表中移除，对方仍可重新关注或申请。</p><p v-if="peopleError" role="alert" class="form-error">{{ peopleError }}</p><div class="table-actions"><button class="button btn subtle" :disabled="removeBusy" @click="removeDialog?.close()">取消</button><button class="button btn" :disabled="removeBusy" @click="removeFollower">{{ removeBusy ? '正在移除…' : '确认移除' }}</button></div></div></dialog>
      </template><div v-else-if="!error" class="empty-state"><Users :size="28" /><h1>未找到这位创作者</h1></div>
    </template>
    <template v-else>
      <section class="creators-grid" aria-label="社区创作者">
        <article v-for="item in creators" :key="item.id" class="creator-card card">
          <RouterLink :to="{ path: '/community', query: { creator: item.id } }" class="creator-identity"><span class="avatar blue"><img v-if="item.avatarUrl" :src="previewImageUrl(item.avatarUrl, 96)" loading="lazy" decoding="async" :alt="item.name || item.username" /><span v-else>{{ (item.name || item.username).slice(0, 1) }}</span></span><div class="creator-name"><h2>{{ item.name || item.username }}</h2><p v-if="creatorIdentity(item)" class="caption-5">{{ creatorIdentity(item) }}</p></div><ArrowUpRight :size="16" /></RouterLink>
          <p v-if="item.bio" class="creator-summary">{{ item.bio }}</p>
          <div class="creator-footer"><span class="caption-5">{{ item.count }} 件公开作品</span><FollowButton :person="item" @changed="updateRelationship" /></div>
        </article>
        <div v-if="!creators.length && !error" class="empty-state"><Users :size="28" /><h2>暂无创作者</h2></div>
      </section>
      <CommunityAds :slots="['communityAd3', 'communityAd4']" />
    </template>
  </div>
</template>

<style scoped>
.profile-work-actions { display: flex; gap: 8px; margin: 8px 4px 0; border-top: 1px solid var(--border); padding-top: 4px; }
.profile-work-actions button { flex: 1; min-width: 0; min-height: 44px; padding-inline: 8px; background: transparent; color: var(--muted); }
.profile-work-actions .work-delete:hover { color: var(--danger); }
@media (max-width: 999px) {
  .profile-work-actions { gap: 0; margin: 4px 0 0; padding-top: 0; }
  .profile-work-actions button { flex-direction: column; gap: 4px; min-width: 44px; padding: 6px 2px; font-size: 12px; line-height: 16px; }
}
.person-actions { display: flex; flex-wrap: wrap; gap: 8px; justify-content: flex-end; }
.person-actions > button { min-height: 44px; }
.community-toolbar { display: flex; justify-content: space-between; align-items: center; gap: 24px; margin-bottom: 28px; padding-bottom: 20px; border-bottom: 1px solid var(--border); }
.community-toolbar h1, .profile-copy h1 { margin: 0; color: var(--ink); font-size: 28px; line-height: 36px; font-weight: 600; }
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
.profile-cover-region { position: relative; isolation: isolate; overflow: hidden; background: var(--canvas); }
.profile-cover-region.has-banner {
  overflow: hidden; --ink: #f8f9fc; --muted: #d8dde7; --surface: #202226; --surface-soft: #2b2e34; --border: #414650;
  --state-hover: color-mix(in srgb, var(--ink) 4%, var(--surface-soft));
  --state-selected: color-mix(in srgb, var(--ink) 8%, var(--surface-soft));
  --state-pressed: color-mix(in srgb, var(--ink) 12%, var(--surface-soft));
  --state-selected-border: color-mix(in srgb, var(--ink) 65%, var(--canvas));
  color: var(--ink);
}
.profile-cover-edit { position: absolute; z-index: 1; inset: 0; width: 100%; height: 100%; padding: 0; border: 0; border-radius: inherit; background: transparent; cursor: pointer; }
.profile-cover-edit:focus-visible { outline-offset: -4px; }
.profile-cover-region .creator-profile { position: relative; z-index: 2; pointer-events: none; }
.profile-cover-region :is(a, button) { pointer-events: auto; }
button.profile-avatar { padding: 0; border: 0; cursor: pointer; }
.profile-media-status { margin-bottom: 12px; font-size: 13px; color: var(--muted); }
.profile-banner { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; pointer-events: none; }
.profile-cover-region.has-banner::after { content: ''; position: absolute; z-index: 0; inset: 0; background: linear-gradient(180deg in oklab, rgb(0 0 0 / 4%) 0%, rgb(0 0 0 / 12%) 25%, rgb(0 0 0 / 30%) 50%, rgb(0 0 0 / 50%) 75%, rgb(0 0 0 / 64%) 100%); pointer-events: none; }
.profile-header { padding-top: 24px; margin-bottom: 24px; border-radius: var(--radius); }
.profile-header > .creator-profile { margin: 0; padding: 24px; }
.creator-page { padding-top: 24px; }
.creator-profile { display: grid; grid-template-columns: 96px minmax(0, 1fr); align-items: start; gap: 20px; margin: 8px 0 24px; }
.creator-profile > .profile-avatar { width: 96px; height: 96px; border-radius: 50%; font-size: 36px; }
.profile-copy { padding-top: 0; }
.profile-heading { display: flex; justify-content: space-between; align-items: center; gap: 16px; }
.profile-name { display: flex; align-items: center; gap: 4px; min-width: 0; max-width: 100%; }
.profile-edit { color: var(--ink); }
.profile-copy h1 { margin: 0; min-width: 0; overflow-wrap: anywhere; font-size: 24px; line-height: 32px; font-weight: 600; }
.profile-stats { display: flex; flex-wrap: wrap; align-items: center; column-gap: 24px; row-gap: 0; margin: 4px 0; }
.profile-stat { position: relative; display: inline-flex; align-items: center; flex: 0 0 auto; gap: 6px; min-height: 32px; border: 0; background: transparent; color: var(--muted); font-size: 13px; line-height: 20px; padding: 0; }
.profile-stat + .profile-stat::before { content: ''; position: absolute; top: 10px; bottom: 10px; left: -12px; width: 1px; background: var(--border); }
.profile-stat strong { color: var(--ink); font-size: 16px; line-height: 24px; font-weight: 500; font-variant-numeric: tabular-nums; }
button.profile-stat:hover:not(:disabled) { color: var(--ink); background: var(--state-hover); }
button.profile-stat:active:not(:disabled) { color: var(--ink); background: var(--state-pressed); }
.profile-copy > .profile-account-id { margin: 0; color: var(--muted); overflow-wrap: anywhere; font-size: 12px; line-height: 18px; }
.profile-bio { white-space: pre-wrap; overflow-wrap: anywhere; margin-top: 6px; max-width: 70ch; color: var(--muted); font-size: 13px; line-height: 20px; }
.profile-actions, .person-row, .person-identity { display: flex; align-items: center; gap: 12px; }
.profile-actions { flex: 0 0 auto; flex-wrap: wrap; justify-content: flex-end; gap: 8px; }
.profile-actions .button { min-height: 36px; padding: 6px 12px; font-size: 12px; white-space: nowrap; }
.profile-content-toolbar { display: flex; align-items: center; gap: 16px; border-bottom: 1px solid var(--border); margin-bottom: 28px; min-width: 0; }
.profile-tabs { flex: 1; gap: 40px; padding-bottom: 0; margin-bottom: 0; border-bottom: 0; }
.profile-tabs .tab { min-height: 48px; padding: 12px 0; font-size: 16px; }
.profile-tabs .tab:hover:not(:disabled) { color: var(--ink); background: var(--state-hover); }
.profile-tabs .tab.active:hover:not(:disabled), .profile-tabs .tab:active:not(:disabled) { color: var(--ink); background: var(--state-pressed); }
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
  .community-toolbar h1 { font-size: 24px; line-height: 32px; }
  .creators-grid { grid-template-columns: minmax(0, 1fr); gap: 12px; }
  .creator-card { min-height: 160px; padding: 18px; }
  .creator-footer .button { min-height: 44px; }
  .creator-page { padding-top: 16px; }
  .creator-profile { grid-template-columns: 64px minmax(0, 1fr); gap: 12px; margin: 8px 0 20px; }
  .creator-profile > .profile-avatar { width: 64px; height: 64px; font-size: 28px; }
  .profile-copy { padding-top: 0; }
  .profile-heading { flex-wrap: wrap; gap: 8px; }
  .profile-copy h1 { flex: 1 1 auto; font-size: 20px; line-height: 28px; }
  .profile-actions { gap: 8px; }
  .profile-actions .button { min-height: 44px; padding-inline: 12px; font-size: 12px; }
  .profile-stats { column-gap: 16px; margin: 4px 0; }
  .profile-stat { gap: 4px; min-height: 44px; font-size: 12px; line-height: 20px; }
  .profile-stat strong { font-size: 16px; line-height: 24px; }
  .profile-stat + .profile-stat::before { top: 16px; bottom: 16px; left: -8px; }
  .profile-copy > .profile-account-id { font-size: 12px; }
  .profile-bio { font-size: 13px; line-height: 20px; }
  .profile-content-toolbar { gap: 8px; flex-wrap: wrap; margin-bottom: 24px; }
  .profile-tabs { gap: 24px; margin-bottom: 0; flex: 1 1 auto; }
  .profile-tabs .tab { font-size: 15px; }
  .profile-people-body { padding: 0 16px 16px; }
  .person-row { flex-wrap: wrap; gap: 16px; }
}

@media (max-width: 999px) {
  .creator-page { padding-top: 0; }
  .profile-hero { position: relative; padding: 28px 20px 38px; background: var(--blue-soft); overflow: hidden; }
  .mobile-profile > :is(.profile-hero, .mobile-profile-body) { position: relative; z-index: 2; pointer-events: none; }
  .mobile-profile > :is(.profile-hero, .mobile-profile-body) { background: transparent; }
  .mobile-profile.has-banner::after { background: linear-gradient(180deg in oklab, rgb(0 0 0 / 38%) 0%, rgb(0 0 0 / 44%) 30%, rgb(0 0 0 / 56%) 65%, rgb(0 0 0 / 68%) 100%); }
  .profile-hero-identity { position: relative; display: flex; align-items: center; gap: 18px; }
  .profile-hero-identity > .avatar { width: 92px; height: 92px; border: 3px solid var(--surface); font-size: 34px; color: var(--blue); }
  .profile-hero-identity > div { min-width: 0; }
  .profile-hero h1 { margin: 0; font-size: 25px; line-height: 1.4; overflow-wrap: anywhere; }
  .profile-name h1 { min-width: 0; }
  .profile-edit { width: 44px; height: 44px; }
  .profile-hero p { margin-top: 4px; color: var(--muted); font-size: 13px; overflow-wrap: anywhere; }
  .mobile-profile-body { position: relative; margin-top: -18px; padding: 14px 16px 16px; border-radius: 20px 20px 0 0; background: var(--canvas); }
  .mobile-profile-stats { display: flex; align-items: center; flex-wrap: wrap; gap: 8px 16px; }
  .mobile-profile-stats > :is(button, span) { display: inline-flex; align-items: center; gap: 5px; min-height: 44px; padding: 0; font-size: 12px; color: var(--muted); }
  .mobile-profile-stats > button:hover:not(:disabled) { color: var(--ink); background: var(--state-hover); }
  .mobile-profile-stats > button:active:not(:disabled) { color: var(--ink); background: var(--state-pressed); }
  .mobile-profile-stats strong { font-size: 16px; color: var(--ink); font-variant-numeric: tabular-nums; }
  .mobile-profile-bio { font-size: 13px; line-height: 1.8; white-space: pre-wrap; overflow-wrap: anywhere; margin: 8px 0; }
  .profile-add-bio { display: inline-flex; align-items: center; gap: 6px; min-height: 44px; color: var(--muted); font-size: 13px; }
  .profile-shortcuts { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; margin-top: 12px; }
  .profile-shortcuts > * { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; min-height: 64px; border-radius: 10px; background: var(--surface); font-size: 12px; }
  .profile-shortcuts > *:hover:not(:disabled) { color: var(--ink); background: var(--state-hover); }
  .profile-shortcuts > *:active:not(:disabled) { color: var(--ink); background: var(--state-pressed); }
  .profile-shortcuts svg { color: var(--ink); }
  .profile-content-toolbar { position: sticky; top: var(--header-height); z-index: 5; flex-wrap: nowrap; gap: 4px; min-height: 50px; margin: 0; padding: 0 8px; background: var(--canvas); }
  .profile-tabs { display: flex; gap: 0; }
  .profile-tabs .tab { position: relative; flex: 1; min-height: 50px; padding: 12px 8px; border: 0; font-size: 14px; text-align: center; justify-content: center; }
  .profile-tabs .tab.active { color: var(--ink); }
  .profile-tabs .tab.active::after { content: ''; position: absolute; bottom: 0; left: calc(50% - 18px); width: 36px; height: 3px; border-radius: 2px; background: var(--ink); }
  .profile-works { grid-template-columns: repeat(3, minmax(0, 1fr)); column-gap: 2px; --card-row-gap: 2; padding-top: 2px; }
  .profile-works :deep(.work-cover) { aspect-ratio: 3 / 4 !important; border-radius: 0; }
  .profile-works :deep(.work-cover > img), .profile-works :deep(.work-cover > video) { object-fit: cover; }
  .profile-works :deep(.work-information), .profile-works :deep(.save-work), .profile-works :deep(.resource-bottom) { display: none; }
  .profile-works :deep(.resource-cover) { padding: 10px; }
  .profile-works :deep(.resource-top) { font-size: 9px; gap: 4px; }
  .profile-works :deep(.resource-heading) { font-size: 13px; line-height: 18px; margin-top: 8px; }
  .profile-works :deep(.resource-cover > p) { display: none; }
  #profile-collection { touch-action: pan-y; }
  .profile-selection { padding: 8px 12px; margin: 0; }
  .profile-work-select { left: 2px; top: 2px; }
  .profile-actions { justify-content: flex-start; }
  .community-toolbar { padding: 0 12px 12px; }
}
@media (max-width: 360px) {
  .profile-hero { padding-inline: 16px; }
  .profile-hero-identity { gap: 12px; }
  .profile-hero-identity > .avatar { width: 80px; height: 80px; }
  .profile-hero h1 { font-size: 22px; }
  .mobile-profile-stats { gap: 8px 10px; }
}

</style>
