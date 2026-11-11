<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { Ban, Check, RefreshCw, Search, ShieldCheck, X } from '@lucide/vue'
import { api, errorMessage, notify, queryString } from '../state'

const props = defineProps<{ view: 'users' | 'reports' }>()
interface User { id: string; username: string; name: string; isSuspended: boolean; isProtected: boolean; violationCount: number; violationBaseline: number }
interface Report { id: string; targetUserId: string; targetUsername: string; reporterId: string; reporterUsername: string; resolved: boolean; resolvedAs: 'accept' | 'reject' | null; comment: string; contentKey: string | null; contentSnapshot: string | null; moderationNote: string }
const users = ref<User[]>([]), reports = ref<Report[]>([]), query = ref('')
const status = ref(props.view === 'users' ? 'all' : 'open'), nextCursor = ref<string | null>(null)
const loading = ref(true), busy = ref(false), error = ref('')
const selectedUser = ref<User | null>(null), reason = ref(''), userDialog = ref<HTMLDialogElement>()
const selectedReport = ref(''), decision = ref<'accept' | 'reject'>('accept'), note = ref('')
async function load(more = false) {
  loading.value = true; error.value = ''
  try {
    const path = `/api/admin/${props.view}${queryString({ query: query.value.trim(), status: status.value, cursor: more ? nextCursor.value || undefined : undefined })}`
    if (props.view === 'users') {
      const data = await api<{ items: User[]; nextCursor: string | null }>(path)
      users.value = more ? [...users.value, ...data.items] : data.items; nextCursor.value = data.nextCursor
    } else {
      const data = await api<{ items: Report[]; nextCursor: string | null }>(path)
      reports.value = more ? [...reports.value, ...data.items] : data.items; nextCursor.value = data.nextCursor
    }
  } catch (cause) { error.value = errorMessage(cause) }
  finally { loading.value = false }
}
function openUser(user: User) {
  selectedUser.value = user; reason.value = ''; error.value = ''
  userDialog.value?.showModal()
}
async function changeUser() {
  if (!selectedUser.value || busy.value) return
  busy.value = true; error.value = ''
  try {
    const suspended = !selectedUser.value.isSuspended
    await api(`/api/admin/users/${encodeURIComponent(selectedUser.value.id)}`, { method: 'PATCH', body: { isSuspended: suspended, reason: reason.value.trim() } })
    userDialog.value?.close(); notify(suspended ? '账号已封禁。' : '账号已解封，后续违规重新计算。'); await load()
  } catch (cause) { error.value = errorMessage(cause) }
  finally { busy.value = false }
}
function openReport(report: Report) { selectedReport.value = report.id; note.value = report.moderationNote; decision.value = 'accept'; error.value = '' }
async function resolveReport() {
  if (!selectedReport.value || busy.value) return
  busy.value = true; error.value = ''
  try {
    await api(`/api/admin/reports/${encodeURIComponent(selectedReport.value)}`, { method: 'PATCH', body: { resolvedAs: decision.value, moderationNote: note.value.trim() } })
    selectedReport.value = ''; notify('举报已处理。'); await load()
  } catch (cause) { error.value = errorMessage(cause) }
  finally { busy.value = false }
}
onMounted(() => { void load() })
</script>

<template>
  <section class="panel-section">
    <div class="section-heading"><h2>{{ view === 'users' ? '用户管理' : '举报处理' }}</h2><button class="icon-button" :aria-label="view === 'users' ? '刷新用户列表' : '刷新举报列表'" title="刷新列表" :disabled="loading || busy" @click="load()"><RefreshCw :size="17" /></button></div>
    <form class="people-filters" @submit.prevent="load()"><label class="field"><span>搜索{{ view === 'users' ? '用户' : '举报' }}</span><input v-model="query" class="control" type="search" maxlength="120" :disabled="busy || loading" /></label><label class="field"><span>状态</span><select v-model="status" class="control" :disabled="busy || loading" @change="load()"><option value="all">全部</option><template v-if="view === 'users'"><option value="active">正常</option><option value="suspended">已封禁</option></template><template v-else><option value="open">待处理</option><option value="resolved">已处理</option></template></select></label><button class="button" :disabled="loading || busy"><Search :size="16" />搜索</button></form>
    <p v-if="error" class="form-error" role="alert">{{ error }}</p>
    <div v-if="loading" class="admin-loading" role="status" aria-label="正在加载列表"><div v-for="n in 3" :key="n" class="skeleton" /></div>
    <template v-if="view === 'users'">
      <div v-if="users.length" class="table-wrap"><table class="data-table"><thead><tr><th scope="col">用户</th><th scope="col">状态</th><th scope="col">违规次数</th><th scope="col">操作</th></tr></thead><tbody><tr v-for="user in users" :key="user.id"><td><strong>{{ user.name }}</strong><p class="caption-5">@{{ user.username }}</p><p class="caption-5">{{ user.id }}</p></td><td><span class="status" :class="user.isSuspended ? 'rejected' : 'published'">{{ user.isSuspended ? '已封禁' : '正常' }}</span><p v-if="user.isProtected" class="caption-5">受保护管理账号</p></td><td>{{ user.violationCount }}<p class="caption-5">本轮 {{ user.violationCount - user.violationBaseline }}</p></td><td><button class="button subtle" :disabled="busy || user.isProtected" @click="openUser(user)"><ShieldCheck v-if="user.isSuspended" :size="16" /><Ban v-else :size="16" />{{ user.isSuspended ? '解封' : '封禁' }}</button></td></tr></tbody></table></div>
      <div v-else-if="!loading && !error" class="empty-state"><ShieldCheck :size="28" /><h3>没有符合条件的用户</h3></div>
    </template>
    <template v-else>
      <article v-for="report in reports" :key="report.id" class="report-row">
        <div class="section-heading"><div><strong>@{{ report.targetUsername || report.targetUserId }}</strong><p class="caption-5">举报人 @{{ report.reporterUsername || report.reporterId }}</p></div><span class="status" :class="{ pending: !report.resolved }">{{ !report.resolved ? '待处理' : report.resolvedAs === 'accept' ? '举报成立' : report.resolvedAs === 'reject' ? '举报不成立' : '已处理' }}</span></div>
        <p class="report-text">{{ report.comment }}</p><p v-if="report.contentKey" class="caption-5">相关内容：{{ report.contentKey }}</p>
        <details v-if="report.contentSnapshot" class="report-snapshot"><summary>举报时的内容</summary><pre>{{ report.contentSnapshot }}</pre></details>
        <p v-if="report.resolved && report.moderationNote" class="form-note">处理说明：{{ report.moderationNote }}</p>
        <form v-if="selectedReport === report.id && !report.resolved" class="stack" @submit.prevent="resolveReport"><fieldset class="fieldset stack" :disabled="busy"><label class="field"><span>处理结果</span><select v-model="decision" class="control"><option value="accept">举报成立，记录内容违规</option><option value="reject">举报不成立</option></select></label><label class="field"><span>处理说明</span><textarea v-model="note" class="control" rows="3" maxlength="8192" /></label><div class="table-actions"><button class="button primary" :disabled="busy"><Check :size="16" />{{ busy ? '正在提交…' : '确认处理' }}</button><button type="button" class="button subtle" :disabled="busy" @click="selectedReport = ''">取消</button></div></fieldset></form>
        <button v-else-if="!report.resolved" class="button subtle" :disabled="busy" @click="openReport(report)">处理举报</button>
      </article>
      <div v-if="!reports.length && !loading && !error" class="empty-state"><ShieldCheck :size="28" /><h3>{{ status === 'open' ? '暂无待处理举报' : '没有符合条件的举报' }}</h3></div>
    </template>
    <button v-if="nextCursor" class="button" :disabled="loading || busy" @click="load(true)">加载更多</button>
    <dialog ref="userDialog" class="compact-dialog" aria-labelledby="user-status-heading" @cancel="busy && $event.preventDefault()"><div class="dialog-heading"><h2 id="user-status-heading">{{ selectedUser?.isSuspended ? '解封账号' : '封禁账号' }}</h2><button class="icon-button" aria-label="关闭账号处理窗口" :disabled="busy" @click="userDialog?.close()"><X :size="20" /></button></div><form class="dialog-body stack" @submit.prevent="changeUser"><p>@{{ selectedUser?.username }}</p><p class="form-note">{{ selectedUser?.isSuspended ? '解封后保留历史违规次数，后续违规从本轮重新计算。' : '封禁后该账号无法登录，公开内容将停止展示。' }}</p><label class="field"><span>处理原因</span><textarea v-model="reason" class="control" rows="3" maxlength="1000" :required="!selectedUser?.isSuspended" :disabled="busy" /></label><p v-if="error" class="form-error" role="alert">{{ error }}</p><button class="button primary" :disabled="busy">{{ busy ? '正在提交…' : '确认' }}</button></form></dialog>
  </section>
</template>

<style scoped>
.people-filters { display: grid; grid-template-columns: minmax(0, 1fr) 176px auto; gap: 16px; align-items: end; margin: 24px 0; }
.fieldset { border: 0; margin: 0; padding: 0; min-width: 0; }
.report-row { padding-block: 24px; border-bottom: 1px solid var(--border); min-width: 0; }
.report-row .section-heading { margin-bottom: 16px; }
.report-row > .button, .report-row > form { margin-top: 16px; }
.report-text, .report-snapshot pre { white-space: pre-wrap; overflow-wrap: anywhere; }
.report-snapshot { margin-block: 16px; }
.report-snapshot summary { cursor: pointer; color: var(--blue); padding-block: 8px; }
.report-snapshot pre { max-height: 320px; overflow: auto; font-family: inherit; font-size: 14px; }
.data-table td { vertical-align: top; }
.data-table td p { margin-top: 4px; }
.admin-loading { display: grid; gap: 16px; padding-block: 24px; }
.admin-loading .skeleton { height: 48px; }
@media (max-width: 639px) { .people-filters { grid-template-columns: minmax(0, 1fr); } }
</style>
