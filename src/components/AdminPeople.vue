<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { Check, RefreshCw, Search, ShieldCheck } from '@lucide/vue'
import { api, errorMessage, notify, queryString, session } from '../state'

const props = defineProps<{ confirmLeave: () => boolean | Promise<boolean> }>()
interface Report { id: string; targetUserId: string; targetUsername: string; reporterId: string; reporterUsername: string; resolved: boolean; resolvedAs: 'accept' | 'reject' | null; comment: string; contentKey: string | null; contentSnapshot: string | null; moderationNote: string }
const reports = ref<Report[]>([]), query = ref('')
const status = ref('open'), nextCursor = ref<string | null>(null)
const loading = ref(true), busy = ref(false), error = ref('')
const selectedReport = ref(''), decision = ref<'accept' | 'reject'>('accept'), note = ref('')
const originalNote = ref('')
let appliedStatus = status.value, appliedQuery = ''
const owner = session.user?.id
let active = true
const isCurrent = () => active && session.user?.id === owner
const hasUnsavedChanges = computed(() => !!selectedReport.value && (note.value !== originalNote.value || decision.value !== 'accept'))
defineExpose({ hasUnsavedChanges, busy })
async function load(more = false) {
  if (!more && hasUnsavedChanges.value) {
    if (!await props.confirmLeave()) { status.value = appliedStatus; return }
    selectedReport.value = ''
  }
  loading.value = true; error.value = ''
  try {
    if (!more) { appliedStatus = status.value; appliedQuery = query.value.trim() }
    const path = `/api/admin/reports${queryString({ query: appliedQuery, status: appliedStatus, cursor: more ? nextCursor.value || undefined : undefined })}`
    const data = await api<{ items: Report[]; nextCursor: string | null }>(path)
    if (!isCurrent()) return
    reports.value = more ? [...reports.value, ...data.items] : data.items; nextCursor.value = data.nextCursor
  } catch (cause) { if (isCurrent()) error.value = errorMessage(cause) }
  finally { if (isCurrent()) loading.value = false }
}
async function openReport(report: Report) {
  if (hasUnsavedChanges.value && !await props.confirmLeave()) return
  selectedReport.value = report.id; note.value = report.moderationNote; originalNote.value = note.value; decision.value = 'accept'; error.value = ''
}
async function cancelReport() { if (!hasUnsavedChanges.value || await props.confirmLeave()) selectedReport.value = '' }
async function resolveReport() {
  if (!selectedReport.value || busy.value) return
  busy.value = true; error.value = ''
  try {
    await api(`/api/admin/reports/${encodeURIComponent(selectedReport.value)}`, { method: 'PATCH', body: { resolvedAs: decision.value, moderationNote: note.value.trim() } })
    if (!isCurrent()) return
    selectedReport.value = ''; busy.value = false; notify('举报已处理。'); await load()
  } catch (cause) { if (isCurrent()) error.value = errorMessage(cause) }
  finally { if (isCurrent()) busy.value = false }
}
onMounted(() => { void load() })
onBeforeUnmount(() => { active = false })
</script>

<template>
  <section class="panel-section admin-people">
    <div class="section-heading"><h2>举报处理</h2><button class="icon-button" aria-label="刷新举报列表" title="刷新列表" :disabled="loading || busy" @click="load()"><RefreshCw :size="17" /></button></div>
    <form class="people-filters" @submit.prevent="load()"><label class="field"><span>搜索举报</span><input v-model="query" class="control" type="search" maxlength="120" :disabled="busy || loading" /></label><label class="field"><span>状态</span><select v-model="status" class="control" :disabled="busy || loading" @change="load()"><option value="all">全部</option><option value="open">待处理</option><option value="resolved">已处理</option></select></label><button class="button btn" :disabled="loading || busy"><Search :size="16" />搜索</button></form>
    <p v-if="error" class="form-error" role="alert">{{ error }}</p>
    <div v-if="loading" class="admin-loading" role="status" aria-label="正在加载列表"><div v-for="n in 3" :key="n" class="skeleton" /></div>
      <article v-for="report in reports" :key="report.id" class="report-row">
        <div class="section-heading"><div><strong>@{{ report.targetUsername || report.targetUserId }}</strong><p class="caption-5">举报人 @{{ report.reporterUsername || report.reporterId }}</p></div><span class="status" :class="{ pending: !report.resolved }">{{ !report.resolved ? '待处理' : report.resolvedAs === 'accept' ? '举报成立' : report.resolvedAs === 'reject' ? '举报不成立' : '已处理' }}</span></div>
        <p class="report-text">{{ report.comment }}</p><p v-if="report.contentKey" class="caption-5">相关内容：{{ report.contentKey }}</p>
        <details v-if="report.contentSnapshot" class="report-snapshot"><summary>举报时的内容</summary><pre>{{ report.contentSnapshot }}</pre></details>
        <p v-if="report.resolved && report.moderationNote" class="form-note">处理说明：{{ report.moderationNote }}</p>
        <form v-if="selectedReport === report.id && !report.resolved" class="stack report-resolution" @submit.prevent="resolveReport"><fieldset class="fieldset stack" :disabled="busy"><label class="field"><span>处理结果</span><select v-model="decision" class="control"><option value="accept">举报成立，记录内容违规</option><option value="reject">举报不成立</option></select></label><label class="field"><span>处理说明</span><textarea v-model="note" class="control" rows="3" maxlength="8192" /></label><div class="table-actions"><button class="button primary btn" :disabled="busy"><Check :size="16" />{{ busy ? '正在提交…' : '确认处理' }}</button><button type="button" class="button subtle btn" :disabled="busy" @click="cancelReport">取消</button></div></fieldset></form>
        <button v-else-if="!report.resolved" class="button subtle btn" :disabled="busy" @click="openReport(report)">处理举报</button>
      </article>
      <div v-if="!reports.length && !loading && !error" class="empty-state"><ShieldCheck :size="28" /><h3>{{ status === 'open' ? '暂无待处理举报' : '没有符合条件的举报' }}</h3></div>
    <button v-if="nextCursor" class="button btn" :disabled="loading || busy" @click="load(true)">加载更多</button>
  </section>
</template>

<style scoped>
.admin-people { padding-top: 0; }
.people-filters { display: grid; grid-template-columns: minmax(0, 1fr) 160px auto; gap: 12px; align-items: end; margin: 20px 0 24px; padding-bottom: 24px; border-bottom: 1px solid var(--border); }
.people-filters > * { min-width: 0; }
.fieldset { border: 0; margin: 0; padding: 0; min-width: 0; }
.report-row { padding-block: 24px; border-bottom: 1px solid var(--border); min-width: 0; }
.report-row .section-heading { margin-bottom: 16px; }
.report-row .section-heading > div { min-width: 0; overflow-wrap: anywhere; }
.report-row .section-heading strong { font-weight: 500; }
.report-row .section-heading .caption-5 { margin-top: 4px; }
.report-row > .button, .report-row > form { margin-top: 16px; }
.report-text, .report-snapshot pre { white-space: pre-wrap; overflow-wrap: anywhere; line-height: 24px; }
.report-text + .caption-5 { margin-top: 12px; color: var(--muted); }
.report-snapshot { margin-block: 16px; }
.report-snapshot summary { cursor: pointer; color: var(--blue); padding-block: 8px; }
.report-snapshot pre { max-height: 320px; overflow: auto; font-family: inherit; font-size: 14px; margin-top: 8px; padding: 16px; border: 1px solid var(--border); border-radius: 4px; background: var(--surface); color: var(--muted); }
.report-resolution { max-width: 640px; padding-left: 20px; border-left: 1px solid var(--border); }
.report-resolution .stack { gap: 16px; }
.report-resolution .table-actions { flex-wrap: wrap; gap: 8px; }
.admin-loading { display: grid; gap: 16px; padding-block: 24px; }
.admin-loading .skeleton { height: 48px; }
@media (max-width: 639px) {
  .people-filters { grid-template-columns: minmax(0, 1fr) 120px; gap: 16px 12px; }
  .people-filters > .button { grid-column: 1 / -1; }
  .report-resolution { padding-left: 12px; }
  .report-resolution .table-actions > .button { flex: 1; }
}
</style>
