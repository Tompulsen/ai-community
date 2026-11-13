<script setup lang="ts">
import { computed, ref, onMounted } from 'vue'
import { ArrowUpRight, Check, Search, ShieldCheck, Trash2, X } from '@lucide/vue'
import AdminLottery from '../components/AdminLottery.vue'
import AdminCommunity from '../components/AdminCommunity.vue'
import AdminPeople from '../components/AdminPeople.vue'
import ContentSkeleton from '../components/ContentSkeleton.vue'
import { kindLabels, statusLabels, type Work, type WorkStatus } from '../data'
import { api, errorMessage, loadSession, notify, session } from '../state'
const status = ref<WorkStatus | 'all'>('pending')
const query = ref('')
const works = ref<Work[]>([])
const loading = ref(true)
const error = ref('')
const busy = ref(false)
const reason = ref('')
const selected = ref<Work | null>(null)
const action = ref<'approve' | 'reject' | 'remove'>('approve')
const recordViolation = ref(false)
const tab = ref<'review' | 'lottery' | 'site' | 'settings' | 'tags' | 'ads' | 'users' | 'reports'>('review')
const adminTabs = computed(() => [
  { id: 'review' as const, label: '作品审核' },
  ...(session.user?.isAdmin ? [{ id: 'lottery' as const, label: '抽奖管理' }, { id: 'site' as const, label: '站点设置' }, { id: 'settings' as const, label: '社区设置' }, { id: 'tags' as const, label: '内容标签' }, { id: 'ads' as const, label: '广告位' }, { id: 'users' as const, label: '用户管理' }] : []),
  { id: 'reports' as const, label: '举报处理' },
])
const reviewDialog = ref<HTMLDialogElement>()
const allowed = computed(() => session.user?.isAdmin || session.user?.isModerator)
const filters: { value: WorkStatus | 'all'; label: string }[] = [{ value: 'pending', label: '待审核' }, { value: 'published', label: '已公开' }, { value: 'rejected', label: '未通过' }, { value: 'all', label: '全部内容' }]
const needsReview = (work: Work) => work.status === 'pending' || work.revisionPending === true
const pending = computed(() => works.value.filter(needsReview).length)
const filtered = computed(() => {
  const needle = query.value.trim().toLocaleLowerCase()
  return works.value.filter(work => (status.value === 'all' || (status.value === 'pending' ? needsReview(work) : work.status === status.value)) && (!needle || `${work.title} ${work.author}`.toLocaleLowerCase().includes(needle)))
})
async function load() {
  loading.value = true
  error.value = ''
  await loadSession()
  if (!allowed.value) { loading.value = false; return }
  try { works.value = (await api<{ items: Work[] }>('/api/admin/submissions')).items }
  catch (cause) { error.value = errorMessage(cause) }
  finally { loading.value = false }
}
onMounted(() => { void load() })
function openReview(work: Work, next: 'approve' | 'reject' | 'remove') {
  selected.value = work
  action.value = next
  reason.value = ''
  recordViolation.value = false
  error.value = ''
  reviewDialog.value?.showModal()
}
async function review() {
  if (!selected.value || busy.value) return
  busy.value = true
  error.value = ''
  try {
    await api(`/api/admin/submissions/${encodeURIComponent(selected.value.id)}/review`, { method: 'POST', body: { action: action.value, reason: reason.value.trim(), version: selected.value.version, recordViolation: recordViolation.value } })
    reviewDialog.value?.close()
    notify(action.value === 'approve' ? '作品已通过审核。' : action.value === 'remove' ? '作品已撤下。' : '作品已驳回。')
    await load()
  } catch (cause) { error.value = errorMessage(cause) }
  finally { busy.value = false }
}
</script>

<template>
  <div class="page-container admin-page"><div class="page-heading"><h1>管理后台</h1><ShieldCheck :size="20" aria-hidden="true" /></div>
    <ContentSkeleton v-if="loading" label="正在加载审核队列…" />
    <div v-else-if="!allowed" class="empty-state"><ShieldCheck :size="30" /><h2>需要审核员权限</h2><RouterLink v-if="!session.user" to="/account" class="button btn">登录</RouterLink><RouterLink v-else to="/discover" class="button btn">返回发现</RouterLink></div>
    <div v-else class="admin-layout">
      <nav class="settings-nav admin-nav" aria-label="管理分类"><button v-for="item in adminTabs" :key="item.id" class="tab" :class="{ active: tab === item.id }" :aria-pressed="tab === item.id" @click="tab = item.id">{{ item.label }}</button></nav>
      <div class="admin-content">
      <AdminLottery v-if="tab === 'lottery' && session.user?.isAdmin" />
      <AdminCommunity v-else-if="(tab === 'site' || tab === 'settings' || tab === 'tags' || tab === 'ads') && session.user?.isAdmin" :key="tab" :view="tab" />
      <AdminPeople v-else-if="tab === 'reports' || (tab === 'users' && session.user?.isAdmin)" :key="tab" :view="tab" />
      <section v-else class="panel-section review-section">
        <div class="section-heading"><div class="review-title"><h2>作品审核</h2><span class="caption-5">{{ pending }} 件待审核</span></div><button class="button subtle btn" @click="load">刷新</button></div>
        <div class="review-toolbar">
          <div class="tabs" aria-label="作品状态"><button v-for="filter in filters" :key="filter.value" class="tab" :class="{ active: status === filter.value }" :aria-pressed="status === filter.value" @click="status = filter.value">{{ filter.label }}</button></div>
          <label class="search-control"><Search :size="16" /><input v-model="query" type="search" placeholder="搜索作品或作者" aria-label="搜索作品或作者" /></label>
        </div>
        <p v-if="error" class="notice-inline" role="alert">{{ error }}</p>
        <div v-if="filtered.length" class="table-wrap"><table class="data-table review-table"><thead><tr><th scope="col">作品</th><th scope="col">类型</th><th scope="col">作者</th><th scope="col">更新时间</th><th scope="col">状态</th><th scope="col">操作</th></tr></thead><tbody><tr v-for="work in filtered" :key="work.id"><td><RouterLink :to="`/work/${work.id}`">{{ work.title }}</RouterLink></td><td>{{ kindLabels[work.kind] }}</td><td>{{ work.author }}</td><td>{{ new Date(work.date).toLocaleString('zh-CN') }}</td><td><span class="status" :class="needsReview(work) ? 'pending' : work.status">{{ work.revisionPending ? '修改待审核' : statusLabels[work.status] }}</span></td><td><div class="table-actions"><template v-if="needsReview(work)"><button class="icon-button" :aria-label="`通过：${work.title}`" title="通过审核" @click="openReview(work, 'approve')"><Check :size="17" /></button><button class="icon-button" :aria-label="`驳回：${work.title}`" title="驳回作品" @click="openReview(work, 'reject')"><X :size="17" /></button></template><button v-if="work.status === 'published'" class="icon-button" :aria-label="`撤下：${work.title}`" title="撤下作品并记录违规" @click="openReview(work, 'remove')"><Trash2 :size="17" /></button><RouterLink :to="`/work/${work.id}`" class="icon-button" :aria-label="`查看作品：${work.title}`" title="查看作品"><ArrowUpRight :size="17" /></RouterLink></div></td></tr></tbody></table></div>
        <div v-else-if="!error" class="empty-state"><ShieldCheck :size="28" /><h2>当前状态下暂无作品</h2></div>
      </section>
      </div>
    </div>
    <dialog ref="reviewDialog" class="compact-dialog" aria-labelledby="review-heading" @cancel="busy && $event.preventDefault()"><div class="dialog-heading"><h2 id="review-heading">{{ action === 'approve' ? '通过审核' : action === 'remove' ? '撤下作品' : '驳回作品' }}</h2><button class="icon-button" aria-label="关闭审核窗口" :disabled="busy" @click="reviewDialog?.close()"><X :size="20" /></button></div><form class="dialog-body stack" @submit.prevent="review"><p>{{ selected?.title }}</p><p v-if="action === 'remove'" class="form-note">撤下后停止公开展示，并记录此内容的违规。</p><label class="field"><span>审核说明</span><textarea v-model="reason" class="control" rows="3" maxlength="1000" :required="action !== 'approve'" :disabled="busy" /></label><label v-if="action === 'reject'" class="review-violation"><input v-model="recordViolation" type="checkbox" :disabled="busy" />记录内容违规</label><p v-if="error" class="form-error" role="alert">{{ error }}</p><button class="button primary btn" :disabled="busy">{{ busy ? '正在提交…' : '确认' }}</button></form></dialog>
  </div>
</template>

<style scoped>
.admin-page { max-width: 1440px; }
.admin-layout { grid-template-columns: 184px minmax(0, 1fr); gap: 32px; }
.admin-nav { padding: 0 16px 0 0; gap: 4px; border-right: 1px solid var(--border); }
.admin-nav .tab { min-height: 44px; padding: 12px; font-weight: 400; }
.admin-nav .tab.active { font-weight: 500; }
.admin-content { min-width: 0; }
.review-section { padding-top: 0; }
.review-title { display: flex; align-items: baseline; flex-wrap: wrap; gap: 12px; }
.review-title .caption-5 { color: var(--muted); font-variant-numeric: tabular-nums; }
.review-toolbar { display: flex; align-items: center; flex-wrap: wrap; justify-content: space-between; gap: 16px; margin-bottom: 24px; padding-block: 8px 16px; border-bottom: 1px solid var(--border); }
.review-toolbar .tabs { margin: 0; border: 0; gap: 20px; }
.review-toolbar .tab { min-height: 40px; }
.review-toolbar .search-control { width: min(100%, 288px); }
.review-table { min-width: 720px; }
.review-table td:first-child { max-width: 280px; overflow-wrap: anywhere; }
.review-table .icon-button { width: 40px; height: 40px; min-height: 40px; }
.review-violation { display: flex; align-items: center; gap: 8px; }
.review-violation input { width: 18px; height: 18px; accent-color: var(--blue); }
@media (max-width: 899px) {
  .admin-layout { grid-template-columns: minmax(0, 1fr); gap: 24px; }
  .admin-nav { position: static; flex-direction: row; flex-wrap: nowrap; padding: 0 0 12px; border-right: 0; border-bottom: 1px solid var(--border); overflow-x: auto; }
  .admin-nav .tab { padding: 8px 12px; }
}
@media (max-width: 639px) {
  .review-toolbar { align-items: stretch; gap: 12px; margin-bottom: 16px; }
  .review-toolbar .tabs { width: 100%; gap: 20px; }
  .review-toolbar .search-control { width: 100%; }
  .review-table .icon-button { width: 44px; height: 44px; min-height: 44px; }
}
</style>
