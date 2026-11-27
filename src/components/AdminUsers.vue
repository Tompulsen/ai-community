<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import { ArrowLeft, ArrowUpRight, Ban, Check, ChevronRight, Copy, ImageOff, RefreshCw, Save, Search, ShieldCheck, Users, X } from '@lucide/vue'
import { accountCenterUrl, api, errorMessage, notify, queryString, session } from '../state'

interface User {
  id: string; accountId?: string; name: string; username: string; host: string | null
  avatarUrl: string | null; bannerUrl: string | null; createdAt: string | null; lastActiveDate: string | null
  isSuspended: boolean; isProtected: boolean; violationCount: number; violationBaseline: number
  statusVersion: string; mediaVersion: string
}
interface Detail extends User { moderationNote: string; noteVersion: string; canEditNote: boolean }
interface Login { id: string; ip: string | null; userAgent: string; success: boolean; date: string | null }
type Filters = { query: string; status: string; origin: string; host: string; sort: string }
type Action = 'suspend' | 'avatar' | 'banner'
const props = defineProps<{ confirmLeave: () => boolean | Promise<boolean> }>()
const route = useRoute()
const defaults = (): Filters => ({ query: '', status: 'all', origin: 'local', host: '', sort: 'created-desc' })
const filters = ref(defaults()), users = ref<User[]>([]), nextCursor = ref<string | null>(null)
const loading = ref(false), error = ref(''), busy = ref(false)
const detail = ref<Detail | null>(null), detailLoading = ref(false), detailError = ref(''), note = ref(''), noteError = ref('')
const logins = ref<Login[]>([]), loginCursor = ref<string | null>(null), loginLoading = ref(false), loginLoaded = ref(false), loginError = ref('')
const brokenImages = ref(new Set<string>())
const action = ref<Action>('suspend'), reason = ref(''), actionError = ref(''), actionDialog = ref<HTMLDialogElement>(), detailHeading = ref<HTMLElement>()
let actionUserId = ''
const selectedId = computed(() => typeof route.query.user === 'string' ? route.query.user : '')
const centerUrl = computed(() => accountCenterUrl())
const noteDirty = computed(() => !!detail.value && note.value !== detail.value.moderationNote)
const hasUnsavedChanges = noteDirty
const canManage = computed(() => !!detail.value && !detail.value.host && !detail.value.isProtected)
const actionTitle = computed(() => action.value === 'suspend' ? detail.value?.isSuspended ? '解除社区封禁' : '封禁社区账号' : action.value === 'avatar' ? '清除头像' : '清除横幅')
const owner = session.user?.id, controller = new AbortController()
let active = true, listRevision = 0, detailRevision = 0, appliedFilters = defaults()
const isCurrent = () => active && session.user?.id === owner && !!session.user?.isAdmin
const currentDetail = (revision: number, id: string) => isCurrent() && revision === detailRevision && id === selectedId.value
const dateText = (value: string | null) => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '暂无记录'
const handle = (user: User) => `@${user.username || user.id}${user.host ? `@${user.host}` : ''}`
const imageFailed = (url: string) => brokenImages.value.add(url)
const userLink = (id?: string) => ({ path: '/admin', query: { tab: 'users', ...(id ? { user: id } : {}) } })
defineExpose({ hasUnsavedChanges, busy })

async function load(more = false) {
  if (!isCurrent() || loading.value || busy.value) return
  const revision = ++listRevision
  const search = more ? appliedFilters : { ...filters.value, query: filters.value.query.trim(), host: filters.value.origin === 'local' ? '' : filters.value.host.trim() }
  loading.value = true; error.value = ''
  try {
    const result = await api<{ items: User[]; nextCursor: string | null }>(`/api/admin/users${queryString({ ...search, cursor: more ? nextCursor.value || undefined : undefined })}`, { signal: controller.signal })
    if (!isCurrent() || revision !== listRevision) return
    users.value = more ? [...users.value, ...result.items] : result.items; nextCursor.value = result.nextCursor; appliedFilters = search
  } catch (cause) { if (isCurrent() && revision === listRevision) error.value = errorMessage(cause) }
  finally { if (isCurrent() && revision === listRevision) loading.value = false }
}
function reset() { filters.value = defaults(); void load() }
async function loadDetail() {
  const id = selectedId.value, revision = ++detailRevision
  actionDialog.value?.close(); actionUserId = ''; reason.value = ''; actionError.value = ''
  detail.value = null; note.value = ''; noteError.value = ''; detailError.value = ''; logins.value = []; loginLoaded.value = false; loginLoading.value = false; loginCursor.value = null; loginError.value = ''
  if (!id || !isCurrent()) { detailLoading.value = false; return }
  detailLoading.value = true
  try {
    const result = await api<{ user: Detail }>(`/api/admin/users/${encodeURIComponent(id)}`, { signal: controller.signal })
    if (!currentDetail(revision, id)) return
    detail.value = result.user; note.value = result.user.moderationNote
    await nextTick(); detailHeading.value?.focus()
  } catch (cause) { if (currentDetail(revision, id)) detailError.value = errorMessage(cause) }
  finally { if (currentDetail(revision, id)) detailLoading.value = false }
}
async function refreshDetail() { if (!busy.value && (!hasUnsavedChanges.value || await props.confirmLeave())) await loadDetail() }
async function saveNote() {
  const target = detail.value, revision = detailRevision
  if (!target?.canEditNote || busy.value || !isCurrent()) return
  busy.value = true; noteError.value = ''
  try {
    const result = await api<{ moderationNote: string; noteVersion: string }>(`/api/admin/users/${encodeURIComponent(target.id)}/note`, {
      method: 'PATCH', expectedAccount: owner, signal: controller.signal, body: { moderationNote: note.value, version: target.noteVersion },
    })
    if (!currentDetail(revision, target.id)) return
    Object.assign(target, result); note.value = result.moderationNote; notify('管理笔记已保存。')
  } catch (cause) { if (currentDetail(revision, target.id)) noteError.value = `${errorMessage(cause)} 你的输入仍保留，可刷新详情后重新核对。` }
  finally { if (currentDetail(revision, target.id)) busy.value = false }
}
function openAction(value: Action) {
  if (!canManage.value || busy.value || !isCurrent()) return
  actionUserId = detail.value!.id
  action.value = value; reason.value = ''; actionError.value = ''; actionDialog.value?.showModal()
}
async function confirmAction() {
  const target = detail.value, revision = detailRevision, operation = action.value
  if (!target || target.id !== actionUserId || target.id !== selectedId.value || !canManage.value || busy.value || !isCurrent()) return
  busy.value = true; actionError.value = ''
  try {
    const result = await api<{ user: User }>(`/api/admin/users/${encodeURIComponent(target.id)}${operation === 'suspend' ? '' : '/media'}`, {
      method: 'PATCH', expectedAccount: owner, signal: controller.signal,
      body: operation === 'suspend' ? { isSuspended: !target.isSuspended, reason: reason.value.trim(), version: target.statusVersion } : { clear: operation, version: target.mediaVersion },
    })
    if (!currentDetail(revision, target.id)) return
    Object.assign(target, result.user)
    const listed = users.value.find(user => user.id === target.id); if (listed) Object.assign(listed, result.user)
    if (operation === 'suspend' && appliedFilters.status !== 'all') users.value = users.value.filter(user => user.id !== target.id)
    actionDialog.value?.close(); notify(operation === 'suspend' ? target.isSuspended ? '已封禁该账号的社区服务。' : '已解封，本轮违规次数已归零。' : operation === 'avatar' ? '头像已清除。' : '横幅已清除。')
  } catch (cause) { if (currentDetail(revision, target.id)) actionError.value = `${errorMessage(cause)} 如状态已变化，请关闭窗口并刷新详情。` }
  finally { if (currentDetail(revision, target.id)) busy.value = false }
}
async function loadLogins(more = false) {
  const id = selectedId.value, revision = detailRevision
  if (!id || loginLoading.value || !isCurrent()) return
  loginLoading.value = true; loginError.value = ''
  try {
    const result = await api<{ items: Login[]; nextCursor: string | null }>(`/api/admin/users/${encodeURIComponent(id)}/logins${queryString({ cursor: more ? loginCursor.value || undefined : undefined })}`, { signal: controller.signal })
    if (!currentDetail(revision, id)) return
    logins.value = more ? [...logins.value, ...result.items] : result.items; loginCursor.value = result.nextCursor; loginLoaded.value = true
  } catch (cause) { if (currentDetail(revision, id)) loginError.value = errorMessage(cause) }
  finally { if (currentDetail(revision, id)) loginLoading.value = false }
}
function toggleLogins(event: Event) { if ((event.target as HTMLDetailsElement).open && !loginLoaded.value) void loadLogins() }
async function copyId(value: string) {
  try { await navigator.clipboard.writeText(value); if (isCurrent()) notify('ID 已复制。') }
  catch { if (isCurrent()) notify('复制失败，请手动选择并复制 ID。') }
}
watch(selectedId, () => { void loadDetail() }, { immediate: true })
void load()
onBeforeUnmount(() => { active = false; controller.abort(); actionDialog.value?.close() })
</script>

<template>
  <section class="panel-section admin-users">
    <div v-show="!selectedId">
      <div class="section-heading"><div><h2>用户管理</h2><p class="form-note">查找用户，查看账号资料与社区违规记录。</p></div><button class="button subtle btn" :disabled="loading || busy" @click="load()"><RefreshCw :size="16" aria-hidden="true" />刷新</button></div>
      <p class="form-note">图片生成额度可在 <RouterLink :to="{ path: '/admin', query: { tab: 'image-concurrency' } }" class="text-link">图片并发</RouterLink> 中集中管理。</p>
      <form class="user-filters" aria-label="筛选用户" @submit.prevent="load()">
        <label class="field"><span>排序</span><select v-model="filters.sort" class="control" :disabled="loading" @change="load()"><option value="created-desc">创建时间 · 新到旧</option><option value="created-asc">创建时间 · 旧到新</option><option value="active-desc">活跃记录 · 最近优先</option><option value="active-asc">活跃记录 · 最早优先</option></select></label>
        <label class="field"><span>状态</span><select v-model="filters.status" class="control" :disabled="loading" @change="load()"><option value="all">全部</option><option value="active">正常</option><option value="suspended">已封禁</option></select></label>
        <label class="field"><span>来源服务器</span><select v-model="filters.origin" class="control" :disabled="loading" @change="load()"><option value="local">本地</option><option value="remote">远程</option><option value="all">全部</option></select></label>
        <label class="field user-search"><span>用户名 / 名称 / ID</span><input v-model="filters.query" class="control" type="search" maxlength="120" :disabled="loading" placeholder="搜索社区用户或统一账号 ID" /></label>
        <label class="field"><span>主机名</span><input v-model="filters.host" class="control" type="search" maxlength="255" :disabled="loading || filters.origin === 'local'" placeholder="例如 example.com" /></label>
        <div class="filter-actions"><button class="button primary btn" :disabled="loading"><Search :size="16" aria-hidden="true" />搜索</button><button type="button" class="button subtle btn" :disabled="loading" @click="reset">重置</button></div>
      </form>
      <p v-if="filters.sort.startsWith('active')" class="form-note filter-note">按已有活跃记录排序，无记录的用户排在最后。当前社区尚未持续采集此时间。</p>
      <p v-if="error" class="form-error" role="alert">{{ error }} <button class="text-link" :disabled="loading" @click="load()">重试</button></p>
      <p v-if="loading" class="form-note" role="status">正在加载用户…</p>
      <div v-if="users.length" class="user-grid" :aria-busy="loading">
        <RouterLink v-for="user in users" :key="user.id" :to="userLink(user.id)" class="user-card" :aria-label="`查看 ${user.name} 的管理详情`">
          <span class="user-avatar" aria-hidden="true"><img v-if="user.avatarUrl && !brokenImages.has(user.avatarUrl)" :src="user.avatarUrl" alt="" loading="lazy" @error="imageFailed(user.avatarUrl)" /><span v-else>{{ user.name.slice(0, 1) }}</span></span>
          <span class="user-summary"><strong>{{ user.name }}</strong><span class="user-handle">{{ handle(user) }}</span><span class="user-meta"><span class="status" :class="user.isSuspended ? 'rejected' : 'published'">{{ user.isSuspended ? '已封禁' : '正常' }}</span><span v-if="user.isProtected">受保护账号</span><span v-else>本轮违规 {{ Math.max(0, user.violationCount - user.violationBaseline) }}</span></span></span><ChevronRight :size="16" aria-hidden="true" />
        </RouterLink>
      </div>
      <div v-else-if="!loading && !error" class="empty-state"><Users :size="28" aria-hidden="true" /><h3>没有符合条件的用户</h3><p>试试调整筛选条件或搜索关键词。</p><button class="button subtle btn" @click="reset">重置筛选</button></div>
      <div v-if="users.length" class="list-footer"><span class="form-note">已显示 {{ users.length }} 位用户</span><button v-if="nextCursor" class="button btn" :disabled="loading" @click="load(true)">加载更多用户</button></div>
    </div>
    <div v-if="selectedId" class="user-detail">
      <div class="section-heading detail-toolbar"><RouterLink class="button subtle btn" :to="userLink()"><ArrowLeft :size="16" aria-hidden="true" />用户列表</RouterLink><button class="button subtle btn" :disabled="detailLoading || busy" @click="refreshDetail"><RefreshCw :size="16" aria-hidden="true" />刷新详情</button></div>
      <p v-if="detailLoading" class="form-note" role="status">正在加载用户详情…</p><p v-if="detailError" class="form-error" role="alert">{{ detailError }}</p>
      <template v-if="detail">
        <div class="user-identity"><span class="user-avatar large" aria-hidden="true"><img v-if="detail.avatarUrl && !brokenImages.has(detail.avatarUrl)" :src="detail.avatarUrl" alt="" @error="imageFailed(detail.avatarUrl)" /><span v-else>{{ detail.name.slice(0, 1) }}</span></span><div><h2 ref="detailHeading" tabindex="-1">{{ detail.name }}</h2><p class="user-handle">{{ handle(detail) }}</p><span class="status" :class="detail.isSuspended ? 'rejected' : 'published'">{{ detail.isSuspended ? '已封禁' : '正常' }}</span></div></div>
        <dl class="user-facts"><dt>社区 ID</dt><dd><span>{{ detail.id }}</span><button class="icon-button" aria-label="复制社区 ID" @click="copyId(detail.id)"><Copy :size="16" aria-hidden="true" /></button></dd><dt>统一账号 ID</dt><dd>{{ detail.accountId || '未关联' }}</dd><dt>社区创建时间</dt><dd>{{ dateText(detail.createdAt) }}</dd><dt>最后活跃记录</dt><dd>{{ dateText(detail.lastActiveDate) }}<small>历史采集记录，当前未持续更新。</small></dd><dt>来源服务器</dt><dd>{{ detail.host || '本地' }}</dd><dt>邮箱与账号安全</dt><dd>{{ detail.host ? '由来源服务器管理' : '由章鱼账户中心管理' }}</dd></dl>
        <p v-if="detail.host" class="form-note">远程账号仅供查看，资料与安全设置由来源服务器管理。</p>
        <form class="user-note" @submit.prevent="saveNote"><label class="field"><span>管理笔记</span><textarea v-model="note" class="control" rows="4" maxlength="8192" :readonly="!detail.canEditNote" :disabled="busy" aria-describedby="user-note-help" /></label><div class="note-footer"><p id="user-note-help" class="form-note">仅管理员可见，用于记录处理依据与跟进事项。</p><button v-if="detail.canEditNote" class="button primary btn" :disabled="busy || !noteDirty"><Save :size="16" aria-hidden="true" />{{ busy ? '正在提交…' : '保存笔记' }}</button></div><p v-if="noteError" class="form-error" role="alert">{{ noteError }}</p></form>
        <p v-if="!detail.host" class="form-note"><RouterLink :to="{ path: '/admin', query: { tab: 'image-concurrency', user: detail.id } }" class="text-link">管理此用户的图片并发</RouterLink></p>
        <section class="user-section" aria-labelledby="user-moderation-heading"><h3 id="user-moderation-heading">社区违规与封禁</h3><div class="violation-counts"><p>本轮违规 <strong>{{ Math.max(0, detail.violationCount - detail.violationBaseline) }}</strong></p><p>历史违规 <strong>{{ detail.violationCount }}</strong></p></div><p class="form-note">解封后保留历史记录，本轮违规次数归零。社区封禁不改变统一账号的其他服务权限。</p><p v-if="detail.isProtected" class="form-note">受保护管理账号，不能在此封禁或清除资料图片。</p><button v-if="!detail.host" class="button subtle btn" :disabled="!canManage || busy" @click="openAction('suspend')"><ShieldCheck v-if="detail.isSuspended" :size="16" aria-hidden="true" /><Ban v-else :size="16" aria-hidden="true" />{{ detail.isSuspended ? '解除社区封禁' : '封禁社区账号' }}</button></section>
        <details class="user-disclosure"><summary>角色与账号安全</summary><div class="stack"><p class="form-note">社区管理授权在“管理授权”中维护。密码重置、双重认证和账号注销由章鱼账户中心处理，需具备对应权限。</p><div class="detail-actions"><RouterLink v-if="!detail.host" class="button subtle btn" :to="{ path: '/admin', query: { tab: 'roles', query: detail.id } }"><ShieldCheck :size="16" aria-hidden="true" />查看管理授权</RouterLink><a v-if="!detail.host && centerUrl" :href="centerUrl" target="_blank" rel="noopener noreferrer" class="button subtle btn">章鱼账户中心<ArrowUpRight :size="16" aria-hidden="true" /></a></div></div></details>
        <details class="user-disclosure" @toggle="toggleLogins"><summary>社区登录记录与 IP</summary><div class="stack"><p class="form-note">每个统一账号会话记录一次社区登录，仅反映社区留存的记录。</p><p v-if="loginLoading" class="form-note" role="status">正在加载登录记录…</p><p v-if="loginError" class="form-error" role="alert">{{ loginError }} <button class="text-link" :disabled="loginLoading" @click="loadLogins()">重试</button></p><ul v-if="logins.length" class="login-list"><li v-for="login in logins" :key="login.id"><div><strong>{{ login.ip || 'IP 未记录' }}</strong><span>{{ login.success ? '成功' : '失败' }}</span><time>{{ dateText(login.date) }}</time></div><p>{{ login.userAgent || '设备信息未记录' }}</p></li></ul><p v-else-if="loginLoaded && !loginLoading" class="form-note">暂无社区登录记录。</p><button v-if="loginCursor" class="button subtle btn" :disabled="loginLoading" @click="loadLogins(true)">加载更多登录记录</button></div></details>
        <section v-if="!detail.host" class="user-section" aria-labelledby="user-media-heading"><h3 id="user-media-heading">资料图片</h3><img v-if="detail.bannerUrl && !brokenImages.has(detail.bannerUrl)" class="user-banner" :src="detail.bannerUrl" alt="用户横幅" @error="imageFailed(detail.bannerUrl)" /><p class="form-note">清除后恢复默认展示，原文件及作品附件会保留。</p><div class="detail-actions"><button class="button subtle btn" :disabled="!canManage || busy || !detail.avatarUrl" @click="openAction('avatar')"><ImageOff :size="16" aria-hidden="true" />清除头像</button><button class="button subtle btn" :disabled="!canManage || busy || !detail.bannerUrl" @click="openAction('banner')"><ImageOff :size="16" aria-hidden="true" />清除横幅</button></div></section>
      </template>
    </div>
    <dialog ref="actionDialog" class="compact-dialog" aria-labelledby="user-action-heading" @cancel="busy && $event.preventDefault()"><div class="dialog-heading"><h2 id="user-action-heading">{{ actionTitle }}</h2><button class="icon-button" aria-label="关闭用户操作窗口" :disabled="busy" @click="actionDialog?.close()"><X :size="20" aria-hidden="true" /></button></div><form class="dialog-body stack" @submit.prevent="confirmAction"><p>{{ detail?.name }} · {{ detail ? handle(detail) : '' }}</p><p class="form-note">{{ action === 'suspend' ? detail?.isSuspended ? '解封后保留历史违规记录，本轮违规次数归零。' : '封禁后将限制社区服务，公开内容停止展示。请填写处理原因。' : '将解除该资料图片的引用，原文件与作品附件会保留。' }}</p><label v-if="action === 'suspend'" class="field"><span>处理原因</span><textarea v-model="reason" class="control" rows="3" maxlength="1000" :required="!detail?.isSuspended" :disabled="busy" /></label><p v-if="actionError" class="form-error" role="alert">{{ actionError }}</p><div class="detail-actions"><button class="button primary btn" :disabled="busy"><Check :size="16" aria-hidden="true" />{{ busy ? '正在提交…' : '确认' }}</button><button type="button" class="button subtle btn" :disabled="busy" @click="actionDialog?.close()">取消</button></div></form></dialog>
  </section>
</template>

<style scoped>
.admin-users { padding-top: 0; }
.section-heading > div { min-width: 0; }
.section-heading .form-note { margin-top: 6px; }
.user-filters { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; padding-block: 24px; margin-bottom: 20px; border-bottom: 1px solid var(--border); }
.user-filters > *, .user-summary, .user-identity > div { min-width: 0; }
.filter-actions, .detail-actions, .note-footer, .list-footer { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.filter-actions { align-self: end; }
.filter-actions .button { flex: 1; }
.filter-note { margin-bottom: 20px; }
.user-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 260px), 1fr)); gap: 12px; margin-top: 20px; }
.user-card { display: flex; gap: 12px; align-items: center; padding: 20px 16px; border: 1px solid var(--border); border-radius: 12px; color: var(--ink); text-decoration: none; background: var(--surface); transition: background .15s; }
.user-card:hover { background: var(--surface-soft); }
.user-card > svg { flex-shrink: 0; color: var(--muted); margin-left: auto; }
.user-avatar { display: grid; place-items: center; flex: 0 0 44px; width: 44px; height: 44px; border-radius: 50%; overflow: hidden; background: var(--surface-soft); color: var(--ink); font-size: 18px; }
.user-avatar img { width: 100%; height: 100%; object-fit: cover; }
.user-summary { display: grid; gap: 5px; }
.user-summary > strong { font-size: 15px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.user-handle { color: var(--muted); font-size: 13px; overflow-wrap: anywhere; }
.user-summary .user-handle { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.user-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; color: var(--muted); font-size: 12px; line-height: 20px; }
.user-meta .status { font-size: 12px; padding: 0 6px; }
.list-footer { justify-content: space-between; margin-top: 24px; }
.user-detail { max-width: 840px; }
.detail-toolbar { margin-bottom: 28px; }
.user-identity { display: flex; align-items: center; gap: 20px; margin-bottom: 24px; }
.user-identity h2 { overflow-wrap: anywhere; }
.user-identity .user-handle { margin-block: 5px 8px; }
.user-avatar.large { width: 72px; height: 72px; flex-basis: 72px; font-size: 28px; }
.user-facts { display: grid; grid-template-columns: 150px minmax(0, 1fr); align-items: baseline; gap: 16px 24px; font-size: 14px; line-height: 22px; margin-bottom: 28px; }
.user-facts dt { color: var(--muted); }
.user-facts dd { min-width: 0; margin: 0; overflow-wrap: anywhere; font-variant-numeric: tabular-nums; }
.user-facts dd:first-of-type { display: flex; align-items: center; gap: 8px; }
.user-facts small { display: block; color: var(--muted); font-size: 12px; margin-top: 4px; }
.user-note { margin-top: 24px; }
.note-footer { justify-content: space-between; margin-top: 12px; }
.user-section { display: grid; gap: 16px; padding-block: 24px; margin-top: 8px; border-top: 1px solid var(--border); }
.user-section h3 { font-size: 16px; font-weight: 600; }
.user-section > .button { justify-self: start; }
.violation-counts { display: flex; gap: 32px; flex-wrap: wrap; color: var(--muted); font-size: 14px; }
.violation-counts strong { color: var(--ink); font-size: 20px; font-weight: 600; margin-left: 8px; font-variant-numeric: tabular-nums; }
.user-disclosure { border-top: 1px solid var(--border); }
.user-disclosure summary { padding-block: 18px; cursor: pointer; font-size: 14px; font-weight: 500; }
.user-disclosure > div { padding-bottom: 20px; }
.login-list { list-style: none; padding: 0; margin: 0; }
.login-list li { padding-block: 16px; border-top: 1px solid var(--border); font-size: 13px; overflow-wrap: anywhere; }
.login-list li > div { display: flex; gap: 8px 16px; flex-wrap: wrap; }
.login-list p { color: var(--muted); line-height: 22px; margin-top: 6px; }
.user-banner { width: 100%; max-height: 180px; object-fit: cover; border-radius: 8px; }
@media (max-width: 639px) {
  .user-filters { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .user-search, .filter-actions { grid-column: 1 / -1; }
  .user-facts { grid-template-columns: 104px minmax(0, 1fr); gap: 14px 12px; }
  .user-identity { gap: 14px; }
  .note-footer .button { width: 100%; }
  .detail-toolbar { gap: 8px; }
}
@media (prefers-reduced-motion: reduce) { .user-card { transition: none; } }
</style>
