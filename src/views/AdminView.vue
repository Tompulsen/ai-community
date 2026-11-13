<script setup lang="ts">
import { computed, ref, onMounted, onBeforeUnmount, nextTick, watch } from 'vue'
import { onBeforeRouteLeave, onBeforeRouteUpdate, useRoute, useRouter } from 'vue-router'
import { ArrowUpRight, Check, Flag, Gift, Globe, LayoutDashboard, Megaphone, RefreshCw, Search, Settings2, ShieldCheck, Tags, Trash2, Users, X } from '@lucide/vue'
import AdminOverview from '../components/AdminOverview.vue'
import AdminLottery from '../components/AdminLottery.vue'
import AdminCommunity from '../components/AdminCommunity.vue'
import AdminPeople from '../components/AdminPeople.vue'
import ContentSkeleton from '../components/ContentSkeleton.vue'
import { kindLabels, statusLabels, type Work, type WorkStatus } from '../data'
import { api, errorMessage, loadSession, notify, queryString, session } from '../state'

const route = useRoute(), router = useRouter()
type Tab = 'overview' | 'review' | 'lottery' | 'site' | 'settings' | 'tags' | 'ads' | 'users' | 'reports'
const status = ref<WorkStatus | 'all'>('pending'), query = ref(''), search = ref('')
const works = ref<Work[]>([]), nextCursor = ref<string | null>(null), updatedAt = ref('')
const booting = ref(true), loading = ref(false), loadingMore = ref(false)
const error = ref(''), reviewError = ref(''), busy = ref(false), reason = ref('')
const selected = ref<Work | null>(null), action = ref<'approve' | 'reject' | 'remove'>('approve'), recordViolation = ref(false)
const adminTabs = computed(() => [
  { id: 'overview' as const, label: '管理概览', icon: LayoutDashboard, group: '工作台' },
  { id: 'review' as const, label: '作品审核', icon: ShieldCheck, group: '内容管理' },
  { id: 'reports' as const, label: '举报处理', icon: Flag, group: '内容管理' },
  ...(session.user?.isAdmin ? [
    { id: 'users' as const, label: '用户管理', icon: Users, group: '内容管理' },
    { id: 'tags' as const, label: '内容标签', icon: Tags, group: '内容管理' },
    { id: 'site' as const, label: '站点设置', icon: Globe, group: '运营设置' },
    { id: 'settings' as const, label: '社区设置', icon: Settings2, group: '运营设置' },
    { id: 'ads' as const, label: '广告位', icon: Megaphone, group: '运营设置' },
    { id: 'lottery' as const, label: '抽奖管理', icon: Gift, group: '运营设置' },
  ] : []),
])
const tab = computed(() => adminTabs.value.find(item => item.id === route.query.tab)?.id ?? 'overview')
const groups = computed(() => ['工作台', '内容管理', '运营设置'].map(label => ({ label, items: adminTabs.value.filter(item => item.group === label) })).filter(group => group.items.length))
const editor = ref<{ hasUnsavedChanges: boolean } | null>(null)
const reviewDialog = ref<HTMLDialogElement>(), leaveDialog = ref<HTMLDialogElement>()
const adminNav = ref<HTMLElement>()
const allowed = computed(() => session.user?.isAdmin || session.user?.isModerator)
let resolveLeave: ((value: boolean) => void) | undefined, requestId = 0
const filters: { value: WorkStatus | 'all'; label: string }[] = [{ value: 'pending', label: '待审核' }, { value: 'published', label: '已公开' }, { value: 'rejected', label: '未通过' }, { value: 'all', label: '全部内容' }]
const needsReview = (work: Work) => work.status === 'pending' || work.revisionPending === true
function navigate(id: Tab) { void router.push({ path: '/admin', query: { ...route.query, tab: id } }) }
function openQueue(value: WorkStatus | 'all' = 'pending') { status.value = value; query.value = ''; search.value = ''; navigate('review') }
function submitSearch() { if (search.value === query.value.trim()) void load(); else search.value = query.value.trim() }
async function load(more = false) {
  if (!allowed.value || !['overview', 'review'].includes(tab.value)) return
  const id = ++requestId
  if (more) loadingMore.value = true
  else { loading.value = true; loadingMore.value = false; works.value = []; nextCursor.value = null }
  error.value = ''
  try {
    const result = await api<{ items: Work[]; nextCursor?: string | null }>('/api/admin/submissions' + queryString({
      status: tab.value === 'review' ? status.value : 'all', query: tab.value === 'review' ? search.value || undefined : undefined,
      cursor: more ? nextCursor.value || undefined : undefined, limit: tab.value === 'overview' ? '100' : '30',
    }))
    if (id !== requestId) return
    works.value = more ? [...works.value, ...result.items] : result.items
    nextCursor.value = result.nextCursor ?? null
    updatedAt.value = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  } catch (cause) { if (id === requestId) error.value = errorMessage(cause) }
  finally { if (id === requestId) { loading.value = false; loadingMore.value = false } }
}
watch([tab, status, search], () => { requestId++; if (!booting.value) void load() })
watch([tab, booting], async () => {
  await nextTick()
  const nav = adminNav.value, item = nav?.querySelector<HTMLElement>('[aria-current="page"]')
  if (nav && item && nav.scrollWidth > nav.clientWidth) nav.scrollLeft = item.offsetLeft - nav.offsetLeft - 8
})
function confirmLeave() {
  if (!editor.value?.hasUnsavedChanges) return true
  if (resolveLeave) return false
  leaveDialog.value?.showModal()
  return new Promise<boolean>(resolve => { resolveLeave = resolve })
}
function finishLeave(discard: boolean) { leaveDialog.value?.close(); resolveLeave?.(discard); resolveLeave = undefined }
onBeforeRouteUpdate(confirmLeave)
onBeforeRouteLeave(confirmLeave)
function beforeUnload(event: BeforeUnloadEvent) { if (editor.value?.hasUnsavedChanges) { event.preventDefault(); event.returnValue = '' } }
onMounted(async () => {
  window.addEventListener('beforeunload', beforeUnload)
  try { await loadSession() } finally { booting.value = false }
  await load()
})
onBeforeUnmount(() => { requestId++; window.removeEventListener('beforeunload', beforeUnload); resolveLeave?.(false) })
function openReview(work: Work, next: 'approve' | 'reject' | 'remove') {
  selected.value = work; action.value = next; reason.value = ''; recordViolation.value = false; reviewError.value = ''
  reviewDialog.value?.showModal()
}
async function review() {
  if (!selected.value || busy.value) return
  busy.value = true; reviewError.value = ''
  try {
    await api('/api/admin/submissions/' + encodeURIComponent(selected.value.id) + '/review', { method: 'POST', body: { action: action.value, reason: reason.value.trim(), version: selected.value.version, recordViolation: recordViolation.value } })
    reviewDialog.value?.close()
    notify(action.value === 'approve' ? '作品已通过审核。' : action.value === 'remove' ? '作品已撤下。' : '作品已驳回。')
    await load()
  } catch (cause) { reviewError.value = errorMessage(cause) }
  finally { busy.value = false }
}
</script>

<template>
  <div class="page-container admin-page">
    <header class="page-heading admin-heading"><div><h1>管理后台</h1><p>管理内容，打理你的社区。</p></div><RouterLink to="/discover" class="button subtle btn"><ArrowUpRight :size="16" aria-hidden="true" />访问社区</RouterLink></header>
    <ContentSkeleton v-if="booting" label="正在加载管理后台…" />
    <div v-else-if="!allowed" class="empty-state"><ShieldCheck :size="30" aria-hidden="true" /><h2>需要审核员权限</h2><RouterLink v-if="!session.user" to="/account" class="button btn">登录</RouterLink><RouterLink v-else to="/discover" class="button btn">返回发现</RouterLink></div>
    <div v-else class="admin-layout">
      <aside class="admin-sidebar">
        <div class="admin-identity"><ShieldCheck :size="20" aria-hidden="true" /><div><strong>{{ session.user?.isAdmin ? '管理员工作台' : '审核员工作台' }}</strong><span>{{ session.user?.name || session.user?.username }}</span></div></div>
        <nav ref="adminNav" class="admin-nav" aria-label="管理分类"><div v-for="group in groups" :key="group.label" class="admin-nav-group"><p>{{ group.label }}</p><button v-for="item in group.items" :key="item.id" class="admin-nav-item" :class="{ active: tab === item.id }" :aria-current="tab === item.id ? 'page' : undefined" :aria-pressed="tab === item.id" @click="navigate(item.id)"><component :is="item.icon" :size="18" aria-hidden="true" /><span>{{ item.label }}</span></button></div></nav>
      </aside>
      <div class="admin-content">
        <AdminOverview v-if="tab === 'overview'" :works="works" :loading="loading" :error="error" :updated-at="updatedAt" :is-admin="!!session.user?.isAdmin" @refresh="load()" @review="openQueue" @navigate="navigate" />
        <AdminLottery v-else-if="tab === 'lottery' && session.user?.isAdmin" ref="editor" />
        <AdminCommunity v-else-if="(tab === 'site' || tab === 'settings' || tab === 'tags' || tab === 'ads') && session.user?.isAdmin" :key="tab" ref="editor" :view="tab" />
        <AdminPeople v-else-if="tab === 'reports' || (tab === 'users' && session.user?.isAdmin)" :key="tab" :view="tab" />
        <section v-else class="panel-section review-section" :aria-busy="loading">
          <div class="section-heading"><div class="review-title"><h2>作品审核</h2><p class="form-note">审核新投稿与作品修改，管理公开内容。</p></div><button class="button subtle btn" :disabled="loading || loadingMore" @click="load()"><RefreshCw :size="16" aria-hidden="true" />刷新</button></div>
          <div class="review-toolbar">
            <div class="tabs" aria-label="作品状态"><button v-for="filter in filters" :key="filter.value" class="tab" :class="{ active: status === filter.value }" :aria-pressed="status === filter.value" @click="status = filter.value">{{ filter.label }}</button></div>
            <form class="review-search" role="search" @submit.prevent="submitSearch"><label class="search-control"><Search :size="16" aria-hidden="true" /><input v-model="query" type="search" maxlength="200" placeholder="搜索作品或作者" aria-label="搜索作品或作者" /></label><button class="button btn">搜索</button></form>
          </div>
          <p v-if="error" class="notice-inline" role="alert">{{ error }} <button class="text-link" @click="load(!!works.length)">重试</button></p>
          <ContentSkeleton v-if="loading" label="正在加载审核队列…" />
          <div v-else-if="works.length" class="table-wrap" role="region" aria-label="作品审核列表，可横向滚动" tabindex="0"><table class="data-table review-table"><thead><tr><th scope="col">作品</th><th scope="col">类型</th><th scope="col">作者</th><th scope="col">更新时间</th><th scope="col">状态</th><th scope="col">操作</th></tr></thead><tbody><tr v-for="work in works" :key="work.id"><td><RouterLink :to="'/work/' + work.id">{{ work.title }}</RouterLink></td><td>{{ kindLabels[work.kind] }}</td><td>{{ work.author }}</td><td>{{ new Date(work.date).toLocaleString('zh-CN') }}</td><td><span class="status" :class="needsReview(work) ? 'pending' : work.status">{{ work.revisionPending ? '修改待审核' : statusLabels[work.status] }}</span></td><td><div class="table-actions"><template v-if="needsReview(work)"><button class="icon-button" :aria-label="'通过：' + work.title" title="通过审核" @click="openReview(work, 'approve')"><Check :size="17" /></button><button class="icon-button" :aria-label="'驳回：' + work.title" title="驳回作品" @click="openReview(work, 'reject')"><X :size="17" /></button></template><button v-if="work.status === 'published'" class="icon-button" :aria-label="'撤下：' + work.title" title="撤下作品并记录违规" @click="openReview(work, 'remove')"><Trash2 :size="17" /></button><RouterLink :to="'/work/' + work.id" class="icon-button" :aria-label="'查看作品：' + work.title" title="查看作品"><ArrowUpRight :size="17" /></RouterLink></div></td></tr></tbody></table></div>
          <div v-else-if="!error" class="empty-state"><ShieldCheck :size="28" aria-hidden="true" /><h3>{{ search ? '没有找到匹配的作品' : '当前状态下暂无作品' }}</h3><button v-if="search" class="button btn" @click="query = ''; search = ''">清除搜索</button></div>
          <div v-if="works.length && !loading" class="review-pagination"><span>已载入 {{ works.length }} 条{{ nextCursor ? '' : ' · 已全部载入' }}</span><button v-if="nextCursor" class="button btn" :disabled="loadingMore" @click="load(true)">{{ loadingMore ? '正在加载…' : '加载更多作品' }}</button></div>
        </section>
      </div>
    </div>
    <dialog ref="leaveDialog" class="compact-dialog" aria-labelledby="leave-heading" @cancel.prevent="finishLeave(false)"><div class="dialog-heading"><h2 id="leave-heading">保留这次修改？</h2><button class="icon-button" aria-label="关闭离开提示" @click="finishLeave(false)"><X :size="20" /></button></div><div class="dialog-body stack"><p>当前页面的修改尚未确认保存。离开后，未保存的输入将丢失。</p><div class="table-actions leave-actions"><button class="button subtle btn" @click="finishLeave(true)">放弃修改并离开</button><button class="button primary btn" autofocus @click="finishLeave(false)">继续编辑</button></div></div></dialog>
    <dialog ref="reviewDialog" class="compact-dialog" aria-labelledby="review-heading" @cancel="busy && $event.preventDefault()"><div class="dialog-heading"><h2 id="review-heading">{{ action === 'approve' ? '通过审核' : action === 'remove' ? '撤下作品' : '驳回作品' }}</h2><button class="icon-button" aria-label="关闭审核窗口" :disabled="busy" @click="reviewDialog?.close()"><X :size="20" /></button></div><form class="dialog-body stack" @submit.prevent="review"><p>{{ selected?.title }}</p><p v-if="action === 'remove'" class="form-note">撤下后停止公开展示，并记录此内容的违规。</p><label class="field"><span>审核说明</span><textarea v-model="reason" class="control" rows="3" maxlength="1000" :required="action !== 'approve'" :disabled="busy" /></label><label v-if="action === 'reject'" class="review-violation"><input v-model="recordViolation" type="checkbox" :disabled="busy" />记录内容违规</label><p v-if="reviewError" class="form-error" role="alert">{{ reviewError }}</p><button class="button primary btn" :disabled="busy">{{ busy ? '正在提交…' : '确认' }}</button></form></dialog>
  </div>
</template>

<style scoped>
.admin-page { max-width: 1440px; }
.admin-heading { align-items: center; margin-bottom: 32px; }
.admin-heading p { margin-top: 8px; color: var(--muted); }
.admin-layout { grid-template-columns: 184px minmax(0, 1fr); gap: 32px; }
.admin-sidebar { position: sticky; top: calc(var(--header-height) + 24px); min-width: 0; }
.admin-identity { display: flex; align-items: center; gap: 10px; margin-bottom: 24px; padding: 14px 12px; background: var(--surface); border-radius: 6px; }
.admin-identity > svg { flex-shrink: 0; color: var(--blue); }
.admin-identity > div { min-width: 0; }
.admin-identity strong, .admin-identity span { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.admin-identity strong { font-size: 14px; font-weight: 500; }
.admin-identity span { margin-top: 4px; color: var(--muted); font-size: 12px; }
.admin-nav { display: grid; gap: 24px; }
.admin-nav-group { display: grid; gap: 4px; }
.admin-nav-group > p { margin: 0 12px 4px; font-size: 12px; color: var(--muted); }
.admin-nav-item { display: flex; align-items: center; gap: 12px; min-height: 44px; padding: 10px 12px; border-radius: 6px; text-align: left; color: var(--muted); }
.admin-nav-item:hover { color: var(--ink); background: var(--surface); }
.admin-nav-item.active { color: var(--blue-hover); background: var(--blue-soft); }
.admin-nav-item svg { flex-shrink: 0; }
.admin-content { min-width: 0; }
.review-section { padding-top: 0; }
.review-title { display: grid; gap: 8px; }
.review-toolbar { display: flex; align-items: center; flex-wrap: wrap; justify-content: space-between; gap: 16px; margin-bottom: 24px; padding-block: 8px 16px; border-bottom: 1px solid var(--border); }
.review-toolbar .tabs { margin: 0; border: 0; gap: 20px; }
.review-toolbar .tab { min-height: 44px; }
.review-search { display: flex; gap: 8px; min-width: 0; }
.review-search .search-control { width: 220px; min-height: 44px; }
.review-table { min-width: 720px; }
.review-table td:first-child { max-width: 280px; overflow-wrap: anywhere; }
.review-table .icon-button { width: 44px; height: 44px; min-height: 44px; }
.review-pagination { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-top: 20px; }
.review-pagination > span { font-size: 12px; color: var(--muted); }
.review-violation { display: flex; align-items: center; gap: 8px; }
.review-violation input { width: 18px; height: 18px; accent-color: var(--blue); }
.leave-actions { justify-content: end; flex-wrap: wrap; }
@media (max-width: 899px) {
  .admin-layout { grid-template-columns: minmax(0, 1fr); gap: 24px; }
  .admin-sidebar { position: static; }
  .admin-identity { display: none; }
  .admin-nav { display: flex; gap: 8px; overflow-x: auto; padding: 4px 2px 12px; border-bottom: 1px solid var(--border); }
  .admin-nav-group { display: contents; }
  .admin-nav-group > p { display: none; }
  .admin-nav-item { flex-shrink: 0; gap: 8px; }
}
@media (max-width: 639px) {
  .admin-heading { gap: 12px; margin-bottom: 20px; }
  .admin-heading p { font-size: 12px; }
  .admin-heading .button { padding-inline: 10px; }
  .review-toolbar { align-items: stretch; gap: 12px; margin-bottom: 16px; }
  .review-toolbar .tabs { width: 100%; gap: 20px; }
  .review-search { width: 100%; }
  .review-search .search-control { flex: 1; width: auto; min-width: 0; }
}
</style>
