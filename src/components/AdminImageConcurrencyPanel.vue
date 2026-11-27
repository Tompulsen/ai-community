<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { ChevronLeft, ChevronRight, Pencil, RefreshCw, Save, Search, Users, X } from '@lucide/vue'
import AdminImageConcurrency from './AdminImageConcurrency.vue'
import { api, errorMessage, notify, queryString, session } from '../state'
import { IMAGE_CONCURRENCY_USER_MAX, type ImageConcurrencyUser, type ImageConcurrencyUserFilters,
  type ImageConcurrencyUserPage, type ImageConcurrencyUsersPatch, type ImageConcurrencyUsersResult } from '../../shared/studio/image-concurrency'

const props = defineProps<{ confirmLeave: () => boolean | Promise<boolean> }>()
const route = useRoute(), endpoint = '/api/admin/creation/image-concurrency/users'
const emptyFilters = (): ImageConcurrencyUserFilters => ({ query: '', status: 'all', mode: 'all' })
const initialUser = typeof route.query.user === 'string' ? route.query.user : ''
const filters = ref({ ...emptyFilters(), query: initialUser }), applied = ref({ ...filters.value })
const users = ref<ImageConcurrencyUser[]>([]), total = ref(0), nextCursor = ref<string | null>(null)
const cursors = ref<(string | undefined)[]>([undefined]), page = ref(0), selectionVersion = ref('')
const loading = ref(false), saving = ref(false), listError = ref(''), batchError = ref(''), notice = ref(''), loaded = ref(false)
const selected = ref(new Set<string>()), allSelected = ref(false)
const batchMode = ref<'override' | 'default'>('override'), batchLimit = ref<string | number>(''), showValidation = ref(false)
const defaultEditor = ref<InstanceType<typeof AdminImageConcurrency>>(), userEditor = ref<InstanceType<typeof AdminImageConcurrency>>()
const editingId = ref(initialUser), editorHeading = ref<HTMLElement>()
const editorGeneration = ref(0)
const owner = session.user?.id, account = session.user?.accountId, controller = new AbortController()
let active = true, listRevision = 0
const isCurrent = () => active && session.user?.id === owner && session.user?.accountId === account && !!session.user?.isAdmin
const selectedCount = computed(() => allSelected.value ? total.value : selected.value.size)
const pageSelected = computed(() => users.value.length > 0 && users.value.every(user => selected.value.has(user.id)))
const partlySelected = computed(() => !pageSelected.value && users.value.some(user => selected.value.has(user.id)))
const childDirty = computed(() => !!defaultEditor.value?.hasUnsavedChanges || !!userEditor.value?.hasUnsavedChanges)
const busy = computed(() => loading.value || saving.value || !!defaultEditor.value?.busy || !!userEditor.value?.busy)
const hasUnsavedChanges = computed(() => childDirty.value || selectedCount.value > 0 || batchMode.value !== 'override' || String(batchLimit.value) !== '')
const batchValidation = computed(() => batchMode.value === 'default' || String(batchLimit.value).trim() !== '' && Number.isInteger(Number(batchLimit.value)) && Number(batchLimit.value) >= 1 && Number(batchLimit.value) <= IMAGE_CONCURRENCY_USER_MAX
  ? '' : `请输入 1–${IMAGE_CONCURRENCY_USER_MAX} 的整数。`)
const editingName = computed(() => users.value.find(user => user.id === editingId.value)?.name || editingId.value)
const hasFilterChanges = computed(() => JSON.stringify({ ...filters.value, query: filters.value.query.trim() }) !== JSON.stringify(applied.value))
defineExpose({ hasUnsavedChanges, busy })

function clearSelection() { selected.value = new Set(); allSelected.value = false }
watch(filters, clearSelection, { deep: true, flush: 'sync' })
function clearDraft() { clearSelection(); batchMode.value = 'override'; batchLimit.value = ''; showValidation.value = false; batchError.value = '' }
function staleList() {
  clearSelection(); selectionVersion.value = ''; nextCursor.value = null
  notice.value = '用户列表已变化，已清除选择，请刷新后重新选择。'
}
async function readUsers(cursor?: string, targetPage = 0) {
  if (!isCurrent() || loading.value) return
  const revision = ++listRevision, expectedVersion = selectionVersion.value
  loading.value = true; listError.value = ''
  try {
    const result = await api<ImageConcurrencyUserPage>(endpoint + queryString({ ...applied.value, cursor }), { expectedAccount: owner, signal: controller.signal })
    if (!isCurrent() || revision !== listRevision) return
    if (expectedVersion && result.selectionVersion !== expectedVersion) { staleList(); return }
    if (!Array.isArray(result.items) || !Number.isSafeInteger(result.total) || result.total < 0 || typeof result.selectionVersion !== 'string' || !result.selectionVersion)
      throw new Error('用户列表响应无效，请重新读取。')
    users.value = result.items; total.value = result.total; nextCursor.value = result.nextCursor
    selectionVersion.value = result.selectionVersion; applied.value = result.filters; page.value = targetPage
    if (targetPage === 0) cursors.value = [undefined]
    loaded.value = true
  } catch (cause) {
    if (!isCurrent() || revision !== listRevision) return
    if ((cause as { status?: number })?.status === 409) staleList()
    listError.value = errorMessage(cause)
  } finally { if (isCurrent() && revision === listRevision) loading.value = false }
}
async function filterUsers(reset = false) {
  if (busy.value || !isCurrent()) return
  if (selectedCount.value && !await props.confirmLeave()) { filters.value = { ...applied.value }; return }
  if (!isCurrent()) return
  clearSelection(); selectionVersion.value = ''; notice.value = ''; batchError.value = ''
  if (reset) filters.value = emptyFilters()
  applied.value = { ...filters.value, query: filters.value.query.trim() }
  await readUsers()
}
async function refreshUsers() {
  if (busy.value || !isCurrent()) return
  if (selectedCount.value && !await props.confirmLeave()) return
  if (!isCurrent()) return
  clearSelection(); selectionVersion.value = ''; notice.value = ''
  await readUsers()
}
async function turnPage(direction: -1 | 1) {
  if (busy.value || hasFilterChanges.value || !selectionVersion.value || !isCurrent()) return
  const target = page.value + direction, cursor = direction === 1 ? nextCursor.value : cursors.value[target]
  if (target < 0 || direction === 1 && !cursor) return
  await readUsers(cursor ?? undefined, target)
  if (page.value === target) cursors.value[target] = cursor ?? undefined
}
function toggleUser(user: ImageConcurrencyUser, checked: boolean) {
  if (busy.value || hasFilterChanges.value || allSelected.value || !selectionVersion.value || !isCurrent()) return
  const ids = new Set(selected.value)
  if (checked) ids.add(user.id); else ids.delete(user.id)
  selected.value = ids; batchError.value = ''; notice.value = ''
}
function togglePage(checked: boolean) {
  if (busy.value || hasFilterChanges.value || allSelected.value || !selectionVersion.value || !isCurrent()) return
  const ids = new Set(selected.value)
  for (const user of users.value) { if (checked) ids.add(user.id); else ids.delete(user.id) }
  selected.value = ids; batchError.value = ''; notice.value = ''
}
function selectAll() {
  if (busy.value || hasFilterChanges.value || !total.value || !selectionVersion.value || !isCurrent()) return
  selected.value = new Set(); allSelected.value = true; batchError.value = ''; notice.value = ''
}
async function editUser(id: string) {
  if (busy.value || editingId.value === id || !isCurrent()) return
  if (userEditor.value?.hasUnsavedChanges && !await props.confirmLeave()) return
  if (!isCurrent()) return
  editingId.value = id
  await nextTick(); editorHeading.value?.focus()
}
async function settingsSaved(defaultsChanged = false) {
  if (!isCurrent()) return
  const hadSelection = selectedCount.value > 0, preservedUserDraft = defaultsChanged && !!userEditor.value?.hasUnsavedChanges
  clearSelection(); selectionVersion.value = ''; batchError.value = ''
  if (defaultsChanged && editingId.value && !preservedUserDraft) editorGeneration.value++
  notice.value = [preservedUserDraft ? '默认设置已更新，此用户的未保存输入已保留，请重新读取后核对。' : '',
    hadSelection ? '设置已更新，请重新选择需要批量调整的用户。' : ''].filter(Boolean).join(' ')
  await readUsers()
}
async function saveBatch() {
  if (busy.value || childDirty.value || hasFilterChanges.value || !selectedCount.value || !selectionVersion.value || !isCurrent()) return
  showValidation.value = true; batchError.value = ''; notice.value = ''
  if (batchValidation.value) return
  const body: ImageConcurrencyUsersPatch = {
    selection: allSelected.value ? { type: 'all' } : { type: 'ids', ids: [...selected.value] },
    filters: { ...applied.value }, overrideLimit: batchMode.value === 'default' ? null : Number(batchLimit.value), version: selectionVersion.value,
  }
  saving.value = true
  try {
    const result = await api<ImageConcurrencyUsersResult>(endpoint, { method: 'PATCH', body, expectedAccount: owner, signal: controller.signal })
    if (!isCurrent()) return
    clearDraft(); selectionVersion.value = ''; editorGeneration.value++
    notice.value = `已处理 ${result.selectedCount} 位用户，其中 ${result.updatedCount} 位设置已更新。`
    notify(notice.value)
    await readUsers()
  } catch (cause) {
    if (!isCurrent()) return
    batchError.value = `${errorMessage(cause)} 批量输入仍保留。`
    if ((cause as { status?: number })?.status === 409) staleList()
  } finally { if (isCurrent()) saving.value = false }
}
void readUsers()
onBeforeUnmount(() => { active = false; listRevision++; controller.abort() })
</script>

<template>
  <section class="panel-section image-concurrency-panel">
    <div class="section-heading"><div><h2>图片并发管理</h2><p class="form-note">集中管理默认图片额度、社区请求总量和用户专属额度。</p></div></div>
    <AdminImageConcurrency ref="defaultEditor" :disabled="loading || saving || !!userEditor?.busy" :confirm-leave="confirmLeave" @saved="settingsSaved(true)" />
    <section v-if="editingId" class="user-editor" aria-labelledby="image-user-editor-heading">
      <div class="editor-heading"><h3 id="image-user-editor-heading" ref="editorHeading" tabindex="-1">编辑 {{ editingName }}</h3><button type="button" class="button subtle btn" :disabled="busy" @click="editUser('')"><X :size="16" aria-hidden="true" />关闭用户编辑</button></div>
      <AdminImageConcurrency :key="`${editingId}:${editorGeneration}`" ref="userEditor" :user-id="editingId" :disabled="loading || saving || !!defaultEditor?.busy" :confirm-leave="confirmLeave" @saved="settingsSaved()" />
    </section>
    <section class="concurrency-users" aria-labelledby="image-users-heading">
      <div class="section-heading"><div><h3 id="image-users-heading">用户图片并发</h3><p class="form-note">按账号查找，可单独调整，也可一次设置多位用户。</p></div><button type="button" class="button subtle btn" :disabled="busy" @click="refreshUsers"><RefreshCw :size="16" aria-hidden="true" />刷新用户列表</button></div>
      <form class="concurrency-filters" aria-label="筛选图片并发用户" @submit.prevent="filterUsers()">
        <label class="field search-field"><span>搜索用户</span><input v-model="filters.query" class="control" type="search" maxlength="120" :disabled="busy" placeholder="社区 ID、统一账号 ID、用户名或昵称" /></label>
        <label class="field"><span>账号状态</span><select v-model="filters.status" class="control" :disabled="busy" @change="filterUsers()"><option value="all">全部</option><option value="active">正常</option><option value="suspended">已封禁</option></select></label>
        <label class="field"><span>额度来源</span><select v-model="filters.mode" class="control" :disabled="busy" @change="filterUsers()"><option value="all">全部</option><option value="default">使用默认</option><option value="override">单独设置</option></select></label>
        <div class="filter-actions"><button class="button primary btn" :disabled="busy"><Search :size="16" aria-hidden="true" />搜索</button><button type="button" class="button subtle btn" :disabled="busy" @click="filterUsers(true)">重置筛选</button></div>
      </form>
      <p v-if="hasFilterChanges" class="form-note filter-hint">搜索词尚未应用，请点击搜索后重新选择用户。</p>
      <div class="selection-toolbar">
        <p role="status">已选择 <strong>{{ selectedCount }}</strong> 位用户<span> · 当前筛选共 {{ total }} 位</span></p>
        <div class="selection-actions"><label class="selection-control select-page-control"><input type="checkbox" :checked="allSelected || pageSelected" :indeterminate="!allSelected && partlySelected" :disabled="busy || hasFilterChanges || allSelected || !users.length || !selectionVersion" @change="togglePage(($event.target as HTMLInputElement).checked)" /><span>全选当前页</span></label><button type="button" class="button subtle btn" :disabled="busy || hasFilterChanges || !total || !selectionVersion || allSelected" @click="selectAll">全选全部筛选结果（{{ total }} 人）</button><button type="button" class="button subtle btn" :disabled="busy || !selectedCount" @click="clearSelection">清除选择</button></div>
      </div>
      <p v-if="allSelected" class="form-note">已选择全部匹配用户，包含其他分页。如需逐个选择，请先清除选择。</p>
      <p v-if="notice" class="notice-inline" role="status">{{ notice }}</p>
      <p v-if="listError" class="form-error" role="alert">{{ listError }} <button type="button" class="text-link" :disabled="busy" @click="refreshUsers">重新读取用户列表</button></p>
      <p v-if="loading" class="form-note" role="status">正在读取用户列表…</p>
      <form class="batch-form" aria-label="批量图片并发" novalidate @submit.prevent="saveBatch">
        <h4>批量调整</h4>
        <p class="form-note">将应用到已选择的 {{ selectedCount }} 位用户。恢复默认会移除这些用户的专属额度。</p>
        <div class="batch-fields"><label class="field"><span>批量操作</span><select v-model="batchMode" class="control" :disabled="busy"><option value="override">设置图片数</option><option value="default">恢复默认</option></select></label><label v-if="batchMode === 'override'" class="field"><span id="image-batch-label">批量图片数</span><input v-model="batchLimit" class="control" type="number" inputmode="numeric" min="1" :max="IMAGE_CONCURRENCY_USER_MAX" step="1" required :disabled="busy" aria-labelledby="image-batch-label" aria-describedby="image-batch-error" :aria-invalid="showValidation && !!batchValidation" @blur="showValidation = true" /><span id="image-batch-error" class="form-error">{{ showValidation ? batchValidation : '' }}</span></label></div>
        <p v-if="childDirty" class="form-note">请先保存或重新读取上方未保存的设置，再提交批量修改。</p>
        <p v-if="batchError" class="form-error" role="alert">{{ batchError }}</p>
        <button class="button primary btn" :disabled="busy || childDirty || hasFilterChanges || !selectedCount || !selectionVersion"><Save :size="16" aria-hidden="true" />{{ saving ? '正在保存批量设置…' : '保存批量设置' }}</button>
      </form>
      <div v-if="users.length" class="concurrency-table-wrap" :aria-busy="loading">
        <table class="data-table concurrency-table"><caption class="sr-only">用户图片并发列表</caption><thead><tr>
          <th scope="col" class="select-column"><span class="sr-only">选择用户</span></th>
          <th scope="col">用户</th><th scope="col">账号状态</th><th scope="col">当前图片数</th><th scope="col">额度来源</th><th scope="col">操作</th>
        </tr></thead><tbody><tr v-for="user in users" :key="user.id">
          <td class="select-column"><label class="selection-control"><input type="checkbox" :aria-label="`选择 ${user.name}`" :checked="allSelected || selected.has(user.id)" :disabled="busy || hasFilterChanges || allSelected || !selectionVersion" @change="toggleUser(user, ($event.target as HTMLInputElement).checked)" /></label></td>
          <td class="person-cell"><strong>{{ user.name }}</strong><span>@{{ user.username || user.id }}</span><small>社区 ID：{{ user.id }}</small><small>统一账号 ID：{{ user.accountId || '未关联' }}</small></td>
          <td data-label="账号状态"><span class="status" :class="user.isSuspended ? 'rejected' : 'published'">{{ user.isSuspended ? '已封禁' : '正常' }}</span></td>
          <td data-label="当前图片数"><strong>{{ user.effectiveLimit }}</strong> 张</td>
          <td data-label="额度来源">{{ user.overrideLimit === null ? '使用默认' : '单独设置' }}</td>
          <td class="edit-cell"><button type="button" class="button subtle btn" :disabled="busy" :aria-label="`编辑 ${user.name} 的图片并发`" @click="editUser(user.id)"><Pencil :size="16" aria-hidden="true" />编辑</button></td>
        </tr></tbody></table>
      </div>
      <div v-else-if="loaded && !loading && !listError" class="empty-state"><Users :size="28" aria-hidden="true" /><h4>没有符合条件的用户</h4><p>试试其他账号信息或调整筛选条件。</p></div>
      <div v-if="loaded && total" class="concurrency-pagination"><span class="form-note">第 {{ page + 1 }} 页 · 当前显示 {{ users.length }} 位用户</span><div><button type="button" class="button subtle btn" :disabled="busy || hasFilterChanges || page === 0 || !selectionVersion" @click="turnPage(-1)"><ChevronLeft :size="16" aria-hidden="true" />上一页</button><button type="button" class="button subtle btn" :disabled="busy || hasFilterChanges || !nextCursor || !selectionVersion" @click="turnPage(1)">下一页<ChevronRight :size="16" aria-hidden="true" /></button></div></div>
    </section>
  </section>
</template>

<style scoped>
.image-concurrency-panel { min-width: 0; padding-top: 0; }
.image-concurrency-panel > .section-heading { margin-bottom: 28px; }
.section-heading > div, .concurrency-filters > *, .batch-fields > * { min-width: 0; }
.section-heading .form-note { margin-top: 6px; }
h3, h4 { font-size: 16px; font-weight: 600; }
.user-editor, .concurrency-users { margin-top: 28px; padding-top: 24px; border-top: 1px solid var(--border); }
.editor-heading, .selection-toolbar, .selection-actions, .concurrency-pagination, .concurrency-pagination > div, .filter-actions { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.editor-heading { justify-content: space-between; margin-bottom: 20px; }
.editor-heading h3 { overflow-wrap: anywhere; min-width: 0; }
.concurrency-filters { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; padding-block: 20px; }
.search-field, .filter-actions { grid-column: 1 / -1; }
.selection-toolbar { justify-content: space-between; padding-block: 16px; }
.selection-toolbar p { font-size: 14px; }
.selection-toolbar p > span { color: var(--muted); }
.form-note, .form-error, .notice-inline, .person-cell { overflow-wrap: anywhere; }
.form-error:empty { display: none; }
.control, .button, .text-link { min-height: 44px; }
.control { width: 100%; min-width: 0; }
.selection-control { display: inline-flex; align-items: center; justify-content: center; width: 44px; min-height: 44px; cursor: pointer; }
.selection-control input { width: 18px; height: 18px; accent-color: var(--accent); }
.select-page-control { width: auto; gap: 8px; font-size: 14px; }
.concurrency-table-wrap { margin-top: 12px; min-width: 0; }
.concurrency-table { width: 100%; table-layout: fixed; }
.concurrency-table .select-column { width: 52px; padding-inline: 4px; }
.concurrency-table th:nth-child(2) { width: 32%; }
.concurrency-table td { vertical-align: middle; overflow-wrap: anywhere; }
.person-cell > strong, .person-cell > span, .person-cell > small { display: block; }
.person-cell > span, .person-cell > small { color: var(--muted); font-size: 12px; line-height: 1.7; }
.concurrency-pagination { justify-content: space-between; margin-top: 16px; }
.batch-form { display: grid; gap: 16px; margin-top: 24px; padding-top: 24px; border-top: 1px solid var(--border); }
.batch-fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
.batch-form > button { justify-self: start; }
@media (max-width: 767px) {
  .concurrency-table thead { position: absolute; width: 1px; height: 1px; clip-path: inset(50%); overflow: hidden; }
  .concurrency-table, .concurrency-table tbody { display: block; }
  .concurrency-table tbody tr { display: grid; grid-template-columns: 44px minmax(0, 1fr); padding-block: 16px; border-top: 1px solid var(--border); }
  .concurrency-table td { display: block; padding: 6px 0; border: 0; }
  .concurrency-table .select-column { width: 44px; padding: 0; }
  .concurrency-table td[data-label], .concurrency-table .edit-cell { grid-column: 2; }
  .concurrency-table td[data-label]::before { content: attr(data-label) '：'; color: var(--muted); }
}
@media (max-width: 639px) {
  .concurrency-filters, .batch-fields { grid-template-columns: minmax(0, 1fr); }
  .selection-actions, .selection-actions > button, .batch-form > button { width: 100%; }
  .selection-actions > button { white-space: normal; height: auto; }
  .control { font-size: 16px; }
}
</style>
