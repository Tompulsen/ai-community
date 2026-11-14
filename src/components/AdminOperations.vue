<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { Check, ClipboardList, Pause, Pencil, Play, Plus, RefreshCw, Save, Search, ShieldCheck, X } from '@lucide/vue'
import { api, errorMessage, notify, queryString, session } from '../state'

type View = 'announcements' | 'audit' | 'roles'
interface Announcement { id: string; title: string; text: string; isActive: boolean; updatedAt: string; version: string }
interface Audit { id: string; date: string | null; type: string; label: string; actor: { id: string; accountId?: string | null; username: string; name: string } | null; details: Record<string, unknown> }
interface Role { id: string; name: string; isAdmin: boolean; isModerator: boolean }
interface RoleUser { id: string; accountId?: string | null; username: string; name: string; roleIds: string[]; version: string; isRoot: boolean; isSelf: boolean; isProtected: boolean; canEdit: boolean }
interface RoleResult { roles: Role[]; items: RoleUser[]; nextCursor: string | null; canAssign: boolean; message?: string }
const props = defineProps<{ view: View }>()
const title = computed(() => ({ announcements: '公告管理', audit: '操作审计', roles: '管理授权' })[props.view])
const allowed = computed(() => Boolean(session.user?.isAdmin))
const announcements = ref<Announcement[]>([]), audit = ref<Audit[]>([]), users = ref<RoleUser[]>([]), roles = ref<Role[]>([])
const query = ref(''), status = ref('all'), auditType = ref(''), typeOptions = ref<{ value: string; label: string }[]>([])
const nextCursor = ref<string | null>(null), loading = ref(false), busy = ref(false), error = ref('')
const canAssign = ref(false), assignmentMessage = ref('')
const editor = ref<HTMLDialogElement>(), editTarget = ref<Announcement | null>(null), editTitle = ref(''), editText = ref(''), editActive = ref(true), editError = ref(''), editConflict = ref(false)
const statusDialog = ref<HTMLDialogElement>(), statusTarget = ref<Announcement | null>(null), statusError = ref('')
const roleDialog = ref<HTMLDialogElement>(), roleTarget = ref<RoleUser | null>(null), selectedRoles = ref<string[]>([]), roleError = ref(''), roleConflict = ref(false)
const controller = new AbortController()
let generation = 0, loadRevision = 0
let appliedFilters = { query: '', status: 'all', type: '' }
const samePage = (current: number, account: string | undefined) => current === generation && account === session.user?.id && allowed.value
const roleNames = (ids: string[]) => ids.map(id => roles.value.find(role => role.id === id)?.name || id).join('、') || '无管理角色'
const protectedUser = (user: RoleUser) => user.isRoot || user.isSelf || user.isProtected || user.id === session.user?.id || !user.canEdit
const addedRoles = computed(() => selectedRoles.value.filter(id => !roleTarget.value?.roleIds.includes(id)))
const removedRoles = computed(() => roleTarget.value?.roleIds.filter(id => !selectedRoles.value.includes(id)) || [])
const roleChanged = computed(() => Boolean(addedRoles.value.length || removedRoles.value.length))
const dateText = (value: string | null) => { const timestamp = value ? Date.parse(value) : NaN; return Number.isFinite(timestamp) ? new Date(timestamp).toLocaleString('zh-CN') : '-' }
const isConflict = (cause: unknown) => (cause as { status?: number })?.status === 409

async function load(more = false) {
  if (!allowed.value) return false
  const current = generation, revision = ++loadRevision, account = session.user?.id, view = props.view
  const filters = more ? appliedFilters : { query: query.value.trim(), status: status.value, type: auditType.value }
  loading.value = true; error.value = ''
  try {
    const search = queryString({
      query: filters.query || undefined, cursor: more ? nextCursor.value || undefined : undefined,
      status: view === 'announcements' ? filters.status : undefined, type: view === 'audit' ? filters.type || undefined : undefined,
    })
    if (view === 'announcements') {
      const result = await api<{ items: Announcement[]; nextCursor: string | null }>(`/api/admin/announcements${search}`, { signal: controller.signal })
      if (!samePage(current, account) || revision !== loadRevision) return false
      announcements.value = more ? [...announcements.value, ...result.items] : result.items; nextCursor.value = result.nextCursor
    } else if (view === 'audit') {
      const result = await api<{ items: Audit[]; nextCursor: string | null; typeOptions: { value: string; label: string }[] }>(`/api/admin/audit${search}`, { signal: controller.signal })
      if (!samePage(current, account) || revision !== loadRevision) return false
      audit.value = more ? [...audit.value, ...result.items] : result.items; nextCursor.value = result.nextCursor; typeOptions.value = result.typeOptions
    } else {
      const result = await api<RoleResult>(`/api/admin/roles${search}`, { signal: controller.signal })
      if (!samePage(current, account) || revision !== loadRevision) return false
      users.value = more ? [...users.value, ...result.items] : result.items; nextCursor.value = result.nextCursor
      roles.value = result.roles; canAssign.value = result.canAssign; assignmentMessage.value = result.message || ''
    }
    if (!more) appliedFilters = filters
    return true
  } catch (cause) {
    if (samePage(current, account) && revision === loadRevision && !controller.signal.aborted) error.value = errorMessage(cause)
    return false
  } finally { if (samePage(current, account) && revision === loadRevision) loading.value = false }
}
function edit(item?: Announcement) {
  if (busy.value || !allowed.value) return
  editTarget.value = item ? { ...item } : null
  editTitle.value = item?.title || ''; editText.value = item?.text || ''; editActive.value = item?.isActive ?? true
  editError.value = ''; editConflict.value = false; editor.value?.showModal()
}
async function saveAnnouncement() {
  if (busy.value || !allowed.value) return
  const current = generation, account = session.user?.id, target = editTarget.value
  const title = editTitle.value.trim(), text = editText.value.trim()
  if (!title || !text) { editError.value = '请填写公告标题和正文。'; return }
  busy.value = true; editError.value = ''; editConflict.value = false
  try {
    await api(target ? `/api/admin/announcements/${encodeURIComponent(target.id)}` : '/api/admin/announcements', {
      method: target ? 'PATCH' : 'POST', expectedAccount: account, signal: controller.signal,
      body: target ? { title, text, isActive: editActive.value, version: target.version } : { title, text },
    })
    if (!samePage(current, account)) return
    editor.value?.close(); notify(target ? '公告已保存。' : '公告已发布。'); await load()
  } catch (cause) { if (samePage(current, account)) { editError.value = errorMessage(cause); editConflict.value = isConflict(cause) } }
  finally { if (samePage(current, account)) busy.value = false }
}
function confirmStatus(item: Announcement) {
  if (busy.value || !allowed.value) return
  statusTarget.value = { ...item }; statusError.value = ''; statusDialog.value?.showModal()
}
async function changeStatus() {
  if (busy.value || !allowed.value || !statusTarget.value) return
  const current = generation, account = session.user?.id, target = statusTarget.value
  busy.value = true; statusError.value = ''
  try {
    await api(`/api/admin/announcements/${encodeURIComponent(target.id)}`, { method: 'PATCH',
      expectedAccount: account, signal: controller.signal, body: { isActive: !target.isActive, version: target.version } })
    if (!samePage(current, account)) return
    statusDialog.value?.close(); notify(target.isActive ? '公告已停用。' : '公告已启用。'); await load()
  } catch (cause) { if (samePage(current, account)) statusError.value = `${errorMessage(cause)}${isConflict(cause) ? ' 请关闭窗口并刷新列表后重试。' : ''}` }
  finally { if (samePage(current, account)) busy.value = false }
}
function editRoles(user: RoleUser) {
  if (busy.value || !allowed.value || !canAssign.value || protectedUser(user)) return
  roleTarget.value = { ...user, roleIds: [...user.roleIds] }; selectedRoles.value = [...user.roleIds]
  roleError.value = ''; roleConflict.value = false; roleDialog.value?.showModal()
}
async function saveRoles() {
  const target = roleTarget.value
  if (busy.value || !allowed.value || !canAssign.value || !target || protectedUser(target) || !roleChanged.value) return
  const current = generation, account = session.user?.id
  busy.value = true; roleError.value = ''; roleConflict.value = false
  try {
    await api(`/api/admin/users/${encodeURIComponent(target.id)}/roles`, { method: 'PATCH',
      expectedAccount: account, signal: controller.signal, body: { roleIds: [...selectedRoles.value], version: target.version } })
    if (!samePage(current, account)) return
    roleDialog.value?.close(); notify('管理授权已更新。'); await load()
  } catch (cause) { if (samePage(current, account)) { roleError.value = errorMessage(cause); roleConflict.value = isConflict(cause) } }
  finally { if (samePage(current, account)) busy.value = false }
}
watch([() => props.view, () => session.user?.id, allowed], () => {
  generation++; loadRevision++
  announcements.value = []; audit.value = []; users.value = []; roles.value = []; typeOptions.value = []
  query.value = ''; status.value = 'all'; auditType.value = ''; nextCursor.value = null
  appliedFilters = { query: '', status: 'all', type: '' }
  loading.value = false; busy.value = false; error.value = ''; canAssign.value = false; assignmentMessage.value = ''
  editor.value?.close(); statusDialog.value?.close(); roleDialog.value?.close()
  if (allowed.value) void load()
}, { immediate: true })
onBeforeUnmount(() => { generation++; controller.abort() })
</script>

<template>
  <section class="panel-section admin-operations" :aria-label="title">
    <div v-if="!allowed" class="empty-state"><ShieldCheck :size="28" /><h2>需要管理员权限</h2></div>
    <template v-else>
      <div class="section-heading"><h2>{{ title }}</h2><div class="table-actions"><button v-if="view === 'announcements'" class="button btn" :disabled="busy" @click="edit()"><Plus :size="16" />发布公告</button><button class="icon-button" :aria-label="`刷新${title}`" :title="`刷新${title}`" :disabled="busy || loading" @click="load()"><RefreshCw :size="17" /></button></div></div>
      <form class="operation-filters" :class="{ 'roles-filters': view === 'roles' }" @submit.prevent="load()">
        <label class="field"><span>{{ view === 'announcements' ? '搜索公告' : view === 'audit' ? '搜索审计日志' : '搜索账号' }}</span><input v-model="query" class="control" type="search" maxlength="120" :placeholder="view === 'roles' ? '账号ID或用户名' : undefined" :disabled="busy || loading" /></label>
        <label v-if="view === 'announcements'" class="field"><span>公告状态</span><select v-model="status" class="control" :disabled="busy || loading" @change="load()"><option value="all">全部</option><option value="active">已启用</option><option value="inactive">已停用</option></select></label>
        <label v-if="view === 'audit'" class="field"><span>操作类型</span><select v-model="auditType" class="control" :disabled="busy || loading" @change="load()"><option value="">全部类型</option><option v-for="item in typeOptions" :key="item.value" :value="item.value">{{ item.label }}</option></select></label>
        <button class="button btn" :disabled="busy || loading"><Search :size="16" />搜索</button>
      </form>
      <p v-if="error" class="form-error list-error" role="alert">{{ error }} <button class="text-link" :disabled="loading || busy" @click="load()">重试</button></p>
      <div v-if="loading" class="admin-loading" role="status" :aria-label="`正在加载${title}`"><div v-for="n in 3" :key="n" class="skeleton" /></div>
      <template v-if="view === 'announcements'">
        <div v-if="announcements.length" class="table-wrap" tabindex="0" aria-label="公告列表"><table class="data-table announcement-table"><thead><tr><th scope="col">公告</th><th scope="col">状态</th><th scope="col">更新时间</th><th scope="col">操作</th></tr></thead><tbody><tr v-for="item in announcements" :key="item.id"><td><strong>{{ item.title }}</strong><p class="announcement-preview">{{ item.text }}</p></td><td><span class="status" :class="item.isActive ? 'published' : ''">{{ item.isActive ? '已启用' : '已停用' }}</span></td><td><time>{{ dateText(item.updatedAt) }}</time></td><td><div class="table-actions"><button class="icon-button" :aria-label="`编辑公告：${item.title}`" title="编辑公告" :disabled="busy || loading" @click="edit(item)"><Pencil :size="17" /></button><button class="button subtle btn" :aria-label="`${item.isActive ? '停用' : '启用'}公告：${item.title}`" :disabled="busy || loading" @click="confirmStatus(item)"><Pause v-if="item.isActive" :size="15" /><Play v-else :size="15" />{{ item.isActive ? '停用' : '启用' }}</button></div></td></tr></tbody></table></div>
        <div v-else-if="!loading && !error" class="empty-state"><ClipboardList :size="28" /><h3>没有符合条件的公告</h3><button class="button btn" @click="edit()"><Plus :size="16" />发布公告</button></div>
      </template>
      <template v-else-if="view === 'audit'">
        <div v-if="audit.length" class="table-wrap" tabindex="0" aria-label="审计日志列表"><table class="data-table audit-table"><thead><tr><th scope="col">时间</th><th scope="col">操作人</th><th scope="col">操作</th><th scope="col">详情</th></tr></thead><tbody><tr v-for="item in audit" :key="item.id"><td><time>{{ dateText(item.date) }}</time></td><td><template v-if="item.actor"><strong>{{ item.actor.username || item.actor.name || '账号' }}</strong><p class="caption-5">账号ID:{{ item.actor.accountId ?? item.actor.id }}</p></template><span v-else>系统</span></td><td>{{ item.label || item.type }}</td><td><details class="audit-details"><summary>查看详情</summary><pre>{{ JSON.stringify(item.details, null, 2) }}</pre></details></td></tr></tbody></table></div>
        <div v-else-if="!loading && !error" class="empty-state"><ClipboardList :size="28" /><h3>没有符合条件的审计日志</h3></div>
      </template>
      <template v-else>
        <p v-if="!canAssign && !loading && !error" class="notice-inline" role="status">{{ assignmentMessage || '当前没有可手动分配的管理角色。' }}</p>
        <div v-if="users.length" class="table-wrap" tabindex="0" aria-label="管理授权账号列表"><table class="data-table roles-table"><thead><tr><th scope="col">账号</th><th scope="col">当前管理角色</th><th scope="col">状态</th><th scope="col">操作</th></tr></thead><tbody><tr v-for="item in users" :key="item.id"><td><strong>{{ item.username || item.name }}</strong><p class="caption-5">账号ID:{{ item.accountId ?? item.id }}</p></td><td class="role-names">{{ roleNames(item.roleIds) }}</td><td>{{ item.isRoot ? '根账号' : item.id === session.user?.id || item.isSelf ? '当前账号' : item.isProtected ? '受保护账号' : '正常' }}</td><td><button class="button subtle btn" :aria-label="`管理授权：${item.username || item.id}`" :disabled="busy || loading || !canAssign || protectedUser(item)" @click="editRoles(item)"><ShieldCheck :size="16" />管理授权</button></td></tr></tbody></table></div>
        <div v-else-if="!loading && !error" class="empty-state"><ShieldCheck :size="28" /><h3>没有符合条件的账号</h3></div>
      </template>
      <button v-if="nextCursor" class="button btn load-more" :disabled="busy || loading" @click="load(true)">{{ loading ? '正在加载…' : '加载更多' }}</button>
    </template>
    <dialog ref="editor" class="compact-dialog" aria-labelledby="announcement-editor-heading" @cancel="busy && $event.preventDefault()"><div class="dialog-heading"><h2 id="announcement-editor-heading">{{ editTarget ? '编辑公告' : '发布公告' }}</h2><button class="icon-button" aria-label="关闭公告编辑" title="关闭" :disabled="busy" @click="editor?.close()"><X :size="20" /></button></div><form class="dialog-body stack" @submit.prevent="saveAnnouncement"><fieldset class="fieldset stack" :disabled="busy"><label class="field"><span>公告标题</span><input v-model="editTitle" class="control" maxlength="100" required /></label><label class="field"><span>公告正文</span><textarea v-model="editText" class="control" rows="8" maxlength="8192" required /></label><label v-if="editTarget" class="check-label"><input v-model="editActive" type="checkbox" />启用公告</label></fieldset><p v-if="editError" class="form-error" role="alert">{{ editError }}</p><p v-if="editConflict" class="form-note">当前输入已保留。关闭编辑并刷新列表后，请核对最新公告再修改。</p><button class="button primary btn" :disabled="busy || editConflict"><Save :size="16" />{{ busy ? '正在保存…' : editTarget ? '保存公告' : '确认发布' }}</button></form></dialog>
    <dialog ref="statusDialog" class="compact-dialog" aria-labelledby="announcement-status-heading" @cancel="busy && $event.preventDefault()"><div class="dialog-heading"><h2 id="announcement-status-heading">{{ statusTarget?.isActive ? '停用公告' : '启用公告' }}</h2><button class="icon-button" aria-label="关闭公告状态确认" title="关闭" :disabled="busy" @click="statusDialog?.close()"><X :size="20" /></button></div><form class="dialog-body stack" @submit.prevent="changeStatus"><p>{{ statusTarget?.title }}</p><p class="form-note">{{ statusTarget?.isActive ? '停用后不再公开展示，公告记录仍会保留。' : '启用后这条公告将恢复公开展示。' }}</p><p v-if="statusError" class="form-error" role="alert">{{ statusError }}</p><button class="button primary btn" :disabled="busy"><Check :size="16" />{{ busy ? '正在提交…' : statusTarget?.isActive ? '确认停用' : '确认启用' }}</button></form></dialog>
    <dialog ref="roleDialog" class="compact-dialog" aria-labelledby="role-editor-heading" @cancel="busy && $event.preventDefault()"><div class="dialog-heading"><h2 id="role-editor-heading">管理授权</h2><button class="icon-button" aria-label="关闭管理授权" title="关闭" :disabled="busy" @click="roleDialog?.close()"><X :size="20" /></button></div><form class="dialog-body stack" @submit.prevent="saveRoles"><div class="target-account"><strong>{{ roleTarget?.username || roleTarget?.name }}</strong><p class="caption-5">账号ID:{{ roleTarget?.accountId ?? roleTarget?.id }}</p><p class="form-note">当前角色：{{ roleNames(roleTarget?.roleIds || []) }}</p></div><fieldset class="fieldset role-options" :disabled="busy"><legend>管理角色</legend><label v-for="role in roles" :key="role.id" class="role-option"><input v-model="selectedRoles" type="checkbox" :value="role.id" /><span><strong>{{ role.name }}</strong><span class="caption-5">{{ role.isAdmin ? '管理员权限' : '审核员权限' }}</span></span></label></fieldset><div v-if="roleChanged" class="role-change" aria-label="授权变更"><p v-if="addedRoles.length">将授予：{{ roleNames(addedRoles) }}</p><p v-if="removedRoles.length">将撤销：{{ roleNames(removedRoles) }}</p></div><p v-if="roleError" class="form-error" role="alert">{{ roleError }}</p><p v-if="roleConflict" class="form-note">当前选择已保留。关闭窗口并刷新账号列表后，请核对最新授权再修改。</p><button class="button primary btn" :disabled="busy || roleConflict || !roleChanged"><ShieldCheck :size="16" />{{ busy ? '正在保存…' : '确认保存授权' }}</button></form></dialog>
  </section>
</template>

<style scoped>
.admin-operations { padding-top: 0; }
.section-heading > .table-actions { flex-wrap: wrap; gap: 8px; }
.operation-filters { display: grid; grid-template-columns: minmax(0, 1fr) 160px auto; align-items: end; gap: 12px; padding-bottom: 24px; margin: 20px 0 24px; border-bottom: 1px solid var(--border); }
.operation-filters.roles-filters { grid-template-columns: minmax(0, 1fr) auto; }
.operation-filters > * { min-width: 0; }
.list-error { margin-bottom: 16px; }
.fieldset { padding: 0; margin: 0; border: 0; min-width: 0; }
.fieldset.stack { gap: 20px; }
.check-label, .role-option { display: flex; align-items: center; gap: 10px; min-height: 44px; }
.check-label input, .role-option input { flex-shrink: 0; width: 18px; height: 18px; accent-color: var(--blue); }
.data-table { min-width: 660px; }
.data-table td { font-variant-numeric: tabular-nums; }
.data-table strong { font-weight: 500; }
.data-table .caption-5 { margin-top: 4px; color: var(--muted); }
.data-table .table-actions { gap: 8px; }
.data-table .icon-button { width: 40px; height: 40px; }
.announcement-table td:first-child { width: 44%; min-width: 200px; max-width: 400px; overflow-wrap: anywhere; }
.announcement-preview { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; white-space: pre-wrap; overflow-wrap: anywhere; margin-top: 8px; color: var(--muted); font-size: 12px; line-height: 20px; }
.audit-table td:first-child { min-width: 168px; white-space: nowrap; }
.audit-table td:nth-child(2) { min-width: 132px; max-width: 200px; white-space: normal; overflow-wrap: anywhere; }
.audit-details { min-width: 180px; max-width: 400px; }
.audit-details summary { padding-block: 2px; color: var(--blue); cursor: pointer; }
.audit-details pre { max-height: 300px; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; margin-top: 12px; padding: 12px; border: 1px solid var(--border); border-radius: 4px; background: var(--surface); font-size: 12px; line-height: 20px; }
.role-names { white-space: normal; overflow-wrap: anywhere; min-width: 160px; max-width: 240px; }
.roles-table td:first-child { max-width: 200px; overflow-wrap: anywhere; }
.admin-loading { display: grid; gap: 16px; padding-block: 24px; }
.admin-loading .skeleton { height: 48px; }
.load-more { margin-top: 24px; }
.target-account { overflow-wrap: anywhere; }
.target-account strong { font-weight: 500; }
.target-account > .caption-5 { margin-top: 4px; }
.role-options legend { margin-bottom: 12px; font-size: 14px; font-weight: 500; }
.role-option { align-items: flex-start; padding-block: 12px; border-bottom: 1px solid var(--border); }
.role-option input { margin-top: 2px; }
.role-option > span { display: flex; flex-direction: column; gap: 4px; min-width: 0; overflow-wrap: anywhere; }
.role-option strong { font-size: 14px; line-height: 20px; font-weight: 500; }
.role-change { padding-top: 16px; border-top: 1px solid var(--border); font-size: 14px; line-height: 24px; overflow-wrap: anywhere; }
.role-change p + p { margin-top: 8px; }
@media (max-width: 639px) {
  .operation-filters { grid-template-columns: minmax(0, 1fr) 120px; gap: 16px 12px; }
  .operation-filters > .button { grid-column: 1 / -1; }
  .operation-filters.roles-filters { grid-template-columns: minmax(0, 1fr); }
  .section-heading .table-actions { gap: 4px; }
  .data-table .icon-button { width: 44px; height: 44px; }
}
</style>
