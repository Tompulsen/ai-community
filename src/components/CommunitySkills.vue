<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { onBeforeRouteLeave } from 'vue-router'
import { ArrowUpRight, Download, FileArchive, FileText, Pencil, Plus, Puzzle, RefreshCw, Search, ShieldCheck, Trash2, Upload, X } from '@lucide/vue'
import { api, errorMessage, notify, session } from '../state'
import { confirmStudioDelete } from '../studio-confirm'
import { skillLimits, skillStates, skillKinds, type SkillKind, type CommunitySkill, type SkillFile, type SkillList, type SkillStatus } from '../../shared/community-skills'

const props = defineProps<{ admin?: boolean; confirmLeave?: () => boolean | Promise<boolean> }>()
const prefix = computed(() => props.admin ? '/api/admin/skills' : '/api/skills')
const scope = ref('public'), status = ref<SkillStatus | 'all'>('pending'), query = ref(''), search = ref('')
const items = ref<CommunitySkill[]>([]), cursor = ref<string | null>(null), loading = ref(false), error = ref('')
const dialog = ref<HTMLDialogElement>(), discard = ref<HTMLDialogElement>(), selected = ref<CommunitySkill | null>(null)
const mode = ref<'view' | 'edit' | 'upload'>('view'), busy = ref(false), detailLoading = ref(false), formError = ref(''), reason = ref('')
const kind = ref<SkillKind | ''>(''), filterKind = ref<SkillKind | ''>('')
const name = ref(''), description = ref(''), body = ref(''), files = ref<SkillFile[]>([])
const upload = ref<{ filename: string; data: string }>(), requestId = ref(''), publish = ref(true)
const initial = ref(''), fileInput = ref<HTMLInputElement>()
const draft = () => JSON.stringify([kind.value, name.value, description.value, body.value, upload.value?.data, publish.value])
const hasUnsavedChanges = computed(() => mode.value !== 'view' && draft() !== initial.value)
defineExpose({ hasUnsavedChanges, busy })
let epoch = 0, listVersion = 0, detailVersion = 0, controller: AbortController | undefined
let resolveDiscard: ((value: boolean) => void) | undefined
const identity = () => `${session.user?.id}:${session.user?.accountId}:${session.user?.isAdmin}`
const canEdit = (skill: CommunitySkill) => Boolean(props.admin || skill.authorId === session.user?.id)
const size = (bytes: number) => bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.ceil(bytes / 1024))} KB`
const title = computed(() => mode.value === 'upload' ? '上传技能' : mode.value === 'edit' ? '编辑技能' : selected.value?.name || '技能详情')

async function load(more = false) {
  if (!session.ready || props.admin && !session.user?.isAdmin) return
  const version = ++listVersion, owner = identity()
  controller?.abort(); controller = new AbortController()
  loading.value = true; error.value = ''
  if (!more) { items.value = []; cursor.value = null }
  const params = new URLSearchParams({ query: search.value, ...(props.admin ? { status: status.value } : { scope: scope.value }) })
  if (filterKind.value) params.set('kind', filterKind.value)
  if (more && cursor.value) params.set('cursor', cursor.value)
  try {
    const data = await api<SkillList>(`${prefix.value}?${params}`, { signal: controller.signal, expectedAccount: session.user?.id })
    if (version !== listVersion || owner !== identity()) return
    items.value = more ? [...items.value, ...data.items.filter(item => !items.value.some(old => old.id === item.id))] : data.items
    cursor.value = data.nextCursor
  } catch (cause) { if (version === listVersion && owner === identity()) error.value = errorMessage(cause) }
  finally { if (version === listVersion) loading.value = false }
}
function submitSearch() { search.value = query.value.trim(); void load() }
function settleDiscard(value: boolean) { discard.value?.close(); resolveDiscard?.(value); resolveDiscard = undefined }
async function confirmDiscard() {
  if (busy.value) return false
  if (!hasUnsavedChanges.value) return true
  if (props.confirmLeave) return props.confirmLeave()
  return new Promise<boolean>(resolve => { resolveDiscard = resolve; discard.value?.showModal() })
}
async function close() { if (await confirmDiscard()) { dialog.value?.close(); detailVersion++; mode.value = 'view'; upload.value = undefined } }
function resetForm() { kind.value = ''; name.value = ''; description.value = ''; body.value = ''; files.value = []; upload.value = undefined; publish.value = true; reason.value = ''; formError.value = ''; initial.value = draft() }
async function openUpload() {
  selected.value = null; resetForm(); mode.value = 'upload'; requestId.value = crypto.randomUUID(); detailLoading.value = false
  await nextTick(); dialog.value?.showModal(); fileInput.value?.focus()
}
async function openSkill(item: CommunitySkill, edit = false) {
  const version = ++detailVersion, owner = identity()
  selected.value = null; resetForm(); mode.value = 'view'; detailLoading.value = true
  await nextTick(); dialog.value?.showModal()
  try {
    const data = await api<{ skill: CommunitySkill }>(`${prefix.value}/${item.id}`, { expectedAccount: session.user?.id })
    if (version !== detailVersion || owner !== identity()) return
    selected.value = data.skill
    if (edit) startEdit()
  } catch (cause) { if (version === detailVersion && owner === identity()) formError.value = errorMessage(cause) }
  finally { if (version === detailVersion) detailLoading.value = false }
}
function startEdit() {
  if (!selected.value) return
  kind.value = selected.value.kind; name.value = selected.value.name; description.value = selected.value.description; body.value = selected.value.body || ''
  files.value = selected.value.files; upload.value = undefined; publish.value = selected.value.status === 'published'
  initial.value = draft(); mode.value = 'edit'; formError.value = ''
}
async function inspect(event: Event) {
  const input = event.target as HTMLInputElement, file = input.files?.[0]
  input.value = ''
  if (!file || busy.value) return
  if (file.size > skillLimits.archiveBytes || !/\.(md|zip)$/i.test(file.name)) { formError.value = '请上传不超过 5 MB 的 SKILL.md 或 ZIP 技能包。'; return }
  const current = epoch, owner = identity(); busy.value = true; formError.value = ''
  try {
    const bytes = new Uint8Array(await file.arrayBuffer())
    let binary = ''
    for (let offset = 0; offset < bytes.length; offset += 32768) binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768))
    const source = { filename: file.name, data: btoa(binary) }
    if (current !== epoch || owner !== identity()) return
    const parsed = await api<{ body: string; name: string; description: string; files: SkillFile[] }>(`${prefix.value}/inspect`, { method: 'POST', body: source, expectedAccount: session.user?.id })
    if (current !== epoch || owner !== identity()) return
    upload.value = source; body.value = parsed.body; name.value = parsed.name; description.value = parsed.description; files.value = parsed.files
  } catch (cause) { if (current === epoch) formError.value = errorMessage(cause) }
  finally { if (current === epoch) busy.value = false }
}
async function save() {
  if (busy.value) return
  if (!kind.value) { formError.value = '请选择技能类型。'; return }
  const current = epoch, owner = identity(), skill = selected.value, editing = mode.value === 'edit'
  busy.value = true; formError.value = ''
  try {
    await api(`${prefix.value}${editing ? '/' + skill!.id : ''}`, { method: editing ? 'PATCH' : 'POST', expectedAccount: session.user?.id,
      body: { kind: kind.value, name: name.value, description: description.value, body: body.value, upload: upload.value,
        ...(editing ? { version: skill!.version } : { requestId: requestId.value }), ...(props.admin ? { publish: publish.value } : {}) } })
    if (current !== epoch || owner !== identity()) return
    initial.value = draft(); mode.value = 'view'; dialog.value?.close(); upload.value = undefined
    notify(props.admin && publish.value ? '技能已发布。' : '技能已提交审核，通过后会出现在技能广场。')
    if (!props.admin) scope.value = 'mine'
    await load()
  } catch (cause) { if (current === epoch) formError.value = errorMessage(cause) }
  finally { if (current === epoch) busy.value = false }
}
async function review(action: 'approve' | 'reject' | 'remove') {
  if (busy.value || !selected.value) return
  if (action !== 'approve' && !reason.value.trim()) { formError.value = '请填写审核或下架原因。'; return }
  const current = epoch, skill = selected.value; busy.value = true; formError.value = ''
  try {
    await api(`${prefix.value}/${skill.id}/review`, { method: 'POST', expectedAccount: session.user?.id, body: { version: skill.version, action, reason: reason.value } })
    if (current !== epoch) return
    dialog.value?.close(); notify(action === 'approve' ? '技能已通过审核并发布。' : action === 'remove' ? '技能已下架。' : '技能未通过审核，作者可修改后重新提交。'); await load()
  } catch (cause) { if (current === epoch) formError.value = errorMessage(cause) }
  finally { if (current === epoch) busy.value = false }
}
async function remove() {
  const skill = selected.value, current = epoch
  if (!skill || busy.value || !await confirmStudioDelete(`删除「${skill.name}」及其技能包？此操作无法撤销。`, () => current === epoch)) return
  busy.value = true; formError.value = ''
  try {
    await api(`${prefix.value}/${skill.id}`, { method: 'DELETE', body: { version: skill.version }, expectedAccount: session.user?.id })
    if (current !== epoch) return
    dialog.value?.close(); notify('技能已删除。'); await load()
  } catch (cause) { if (current === epoch) formError.value = errorMessage(cause) }
  finally { if (current === epoch) busy.value = false }
}
function unload(event: BeforeUnloadEvent) { if (hasUnsavedChanges.value || busy.value) { event.preventDefault(); event.returnValue = '' } }
window.addEventListener('beforeunload', unload)
onBeforeRouteLeave(() => props.admin ? true : confirmDiscard())
watch([identity, () => session.ready], () => {
  epoch++; detailVersion++; listVersion++; controller?.abort(); settleDiscard(false); dialog.value?.close()
  mode.value = 'view'; busy.value = false; selected.value = null; resetForm(); items.value = []; query.value = ''; search.value = ''; scope.value = 'public'; void load()
}, { immediate: true })
watch([scope, status, filterKind], () => { void load() })
onBeforeUnmount(() => { epoch++; detailVersion++; listVersion++; controller?.abort(); settleDiscard(false); dialog.value?.close(); window.removeEventListener('beforeunload', unload) })
</script>

<template>
  <section class="community-skills" :class="{ 'skills-admin': admin }" :aria-label="admin ? '技能管理' : '技能广场'">
    <header class="skills-heading"><div><p class="skills-eyebrow"><Puzzle :size="16" aria-hidden="true" />社区共创 · SKILLS</p><component :is="admin ? 'h2' : 'h1'">{{ admin ? '技能管理' : '技能广场' }}</component><p class="skills-intro">{{ admin ? '上传、编辑社区技能，审核用户投稿。审核通过后才会公开。' : '分享你的创作方法，让好用的技能被更多人发现。' }}</p></div><button v-if="session.user" class="button primary btn" @click="openUpload"><Plus :size="18" aria-hidden="true" />上传技能</button><RouterLink v-else to="/account?returnTo=/skills" class="button primary btn">登录上传</RouterLink></header>
    <div v-if="!admin" class="skills-guide"><ShieldCheck :size="20" aria-hidden="true" /><p>用户技能经审核后公开，可在创作台的「技能」中选择。支持 SKILL.md 与包含配套文件的 ZIP 技能包。</p><RouterLink to="/create/text">前往创作台 <ArrowUpRight :size="16" aria-hidden="true" /></RouterLink></div>
    <div class="skills-toolbar"><div v-if="!admin" class="tabs" aria-label="技能范围"><button class="tab" :class="{ active: scope === 'public' }" :aria-pressed="scope === 'public'" @click="scope = 'public'">发现技能</button><button v-if="session.user" class="tab" :class="{ active: scope === 'mine' }" :aria-pressed="scope === 'mine'" @click="scope = 'mine'">我的上传</button></div><label v-else class="skills-status">审核状态<select v-model="status" class="control"><option value="all">全部技能</option><option v-for="(label, value) in skillStates" :key="value" :value="value">{{ label }}</option></select></label><label class="skills-status">筛选类型<select v-model="filterKind" class="control"><option value="">全部类型</option><option v-for="(label, value) in skillKinds" :key="value" :value="value">{{ label }}</option></select></label><form class="skills-search" role="search" @submit.prevent="submitSearch"><label class="search-control"><Search :size="17" aria-hidden="true" /><input v-model="query" type="search" aria-label="搜索技能" placeholder="搜索技能名称或用途" maxlength="120" /></label><button class="button subtle btn">搜索</button></form><button class="icon-button" aria-label="刷新技能广场" :disabled="loading" @click="load()"><RefreshCw :size="18" aria-hidden="true" /></button></div>
    <p v-if="error" class="form-error" role="alert">{{ error }} <button class="text-link" @click="load()">重试</button></p>
    <p v-if="loading && !items.length" class="skills-empty" role="status">正在加载技能…</p>
    <div v-else-if="!items.length && !error" class="skills-empty"><Puzzle :size="32" aria-hidden="true" /><h2>{{ search ? '没有找到相关技能' : scope === 'mine' ? '还没有上传技能' : admin ? '当前没有待处理的技能' : '等待第一个好用的技能' }}</h2><p>{{ search ? '试试其他名称或用途关键词。' : '上传 SKILL.md 或 ZIP，与社区分享你的方法。' }}</p></div>
    <div v-else class="skill-grid"><article v-for="skill in items" :key="skill.id" class="skill-card"><div class="skill-card-top"><span class="skill-symbol"><Puzzle :size="22" aria-hidden="true" /></span><span class="skill-badge">{{ skill.official ? '管理员发布' : '社区投稿' }}</span><span class="skill-badge">{{ skillKinds[skill.kind] }}技能</span><span v-if="admin || scope === 'mine'" class="skill-badge skill-state">{{ skillStates[skill.status] }}</span></div><component :is="admin ? 'h3' : 'h2'" class="skill-name"><button @click="openSkill(skill)">{{ skill.name }}</button></component><p class="skill-description">{{ skill.description }}</p><p v-if="skill.reviewNote && scope === 'mine'" class="skill-review-note">审核反馈：{{ skill.reviewNote }}</p><div class="skill-meta"><span>{{ skill.authorName }}</span><span>{{ skill.filename.toLowerCase().endsWith('.zip') ? 'ZIP 技能包' : 'SKILL.md' }} · {{ size(skill.size) }}</span></div><footer><button class="button subtle btn" @click="openSkill(skill)">{{ admin ? '查看与审核' : '查看技能' }}<ArrowUpRight :size="16" aria-hidden="true" /></button><button v-if="canEdit(skill)" class="icon-button" :aria-label="'编辑技能：' + skill.name" @click="openSkill(skill, true)"><Pencil :size="17" aria-hidden="true" /></button></footer></article></div>
    <button v-if="cursor" class="button subtle btn skills-more" :disabled="loading" @click="load(true)">{{ loading ? '正在加载…' : '加载更多技能' }}</button>

    <dialog ref="dialog" class="skill-dialog" aria-labelledby="skill-dialog-title" @cancel.prevent="close"><header><h2 id="skill-dialog-title">{{ title }}</h2><button class="icon-button" :disabled="busy" aria-label="关闭技能窗口" @click="close"><X :size="20" aria-hidden="true" /></button></header>
      <p v-if="detailLoading" role="status">正在读取技能…</p><p v-if="formError" class="form-error" role="alert">{{ formError }}</p>
      <form v-if="mode !== 'view'" class="skill-form" @submit.prevent="save">
        <label class="field"><span>技能类型</span><select v-model="kind" class="control" required :disabled="busy"><option disabled value="">请选择技能类型</option><option v-for="(label, value) in skillKinds" :key="value" :value="value">{{ label }}</option></select></label><p class="form-note">选择此技能适用的创作模块，审核通过后会出现在对应模块的技能列表中。</p>
        <label class="skill-upload"><Upload :size="22" aria-hidden="true" /><strong>{{ upload?.filename || (mode === 'edit' ? '替换技能文件（可选）' : '选择 SKILL.md 或 ZIP 技能包') }}</strong><span>最多 5 MB；ZIP 内须包含一个 SKILL.md，可附 references、scripts、assets。</span><input ref="fileInput" type="file" accept=".md,.zip" aria-label="技能文件" :disabled="busy" @change="inspect" /></label>
        <p v-if="busy" role="status">正在处理，请稍候…</p>
        <template v-if="upload || mode === 'edit'"><label class="field"><span>展示名称</span><input v-model="name" class="control" maxlength="100" required :disabled="busy" /></label><label class="field"><span>技能简介</span><textarea v-model="description" class="control" rows="3" maxlength="1000" required :disabled="busy" /></label><label class="field"><span>SKILL.md 内容</span><textarea v-model="body" class="control skill-source" rows="14" maxlength="65536" required spellcheck="false" :disabled="busy" /></label><p class="form-note">保留顶部 YAML 中的 name、description。ZIP 的其余配套文件会随技能包一起保存。</p><details class="skill-files"><summary>包内文件 · {{ files.length }} 个</summary><ul><li v-for="file in files" :key="file.path"><span>{{ file.path }}</span><small>{{ size(file.bytes) }}</small></li></ul></details></template>
        <p class="skill-policy">{{ admin ? '上传前请确认技能内容和配套文件适合公开分享。' : mode === 'edit' ? '保存修改后将重新审核；已发布的技能会暂时从广场和创作台隐藏，审核通过后恢复。' : '请确认有权分享这些内容。提交后仅自己与管理员可见，审核通过后公开。' }}</p>
        <label v-if="admin" class="skill-checkbox"><input v-model="publish" type="checkbox" :disabled="busy" />保存后直接发布至技能广场</label>
        <footer><button type="button" class="button subtle btn" :disabled="busy" @click="close">取消</button><button class="button primary btn" :disabled="busy || !body || mode === 'upload' && !upload">{{ busy ? '正在保存…' : admin ? '保存技能' : '提交审核' }}</button></footer>
      </form>
      <template v-else-if="selected"><div class="skill-detail-meta"><span class="skill-badge">{{ skillKinds[selected.kind] }}技能</span><span class="skill-badge">{{ skillStates[selected.status] }}</span><span>{{ selected.authorName }} · {{ size(selected.size) }}</span></div><p class="skill-detail-description">{{ selected.description }}</p><p v-if="selected.reviewNote" class="skill-review-note">审核反馈：{{ selected.reviewNote }}</p><div class="skill-detail-actions"><a class="button subtle btn" :href="`${prefix}/${selected.id}/download`" download><Download :size="17" aria-hidden="true" />下载{{ selected.filename.toLowerCase().endsWith('.zip') ? '技能包' : ' SKILL.md' }}</a><RouterLink v-if="selected.status === 'published'" class="button primary btn" :to="`/create/${selected.kind}`" @click="dialog?.close()">去创作台选择技能<ArrowUpRight :size="16" aria-hidden="true" /></RouterLink><button v-if="canEdit(selected)" class="button subtle btn" @click="startEdit"><Pencil :size="16" aria-hidden="true" />编辑</button></div><p class="form-note">创作台使用 SKILL.md 的文本指令；配套文件可下载使用，平台不会执行包内脚本。</p><details class="skill-files"><summary><FileArchive :size="17" aria-hidden="true" />包内文件 · {{ selected.files.length }} 个</summary><ul><li v-for="file in selected.files" :key="file.path"><span>{{ file.path }}</span><small>{{ size(file.bytes) }}</small></li></ul></details><h3 class="skill-source-title"><FileText :size="17" aria-hidden="true" />SKILL.md</h3><pre class="skill-preview" tabindex="0" aria-label="技能文本内容">{{ selected.body }}</pre>
        <section v-if="admin" class="skill-review"><h3>审核技能</h3><label class="field"><span>审核 / 下架原因（驳回、下架时必填）</span><textarea v-model="reason" class="control" rows="3" maxlength="1000" :disabled="busy" /></label><div class="skill-review-actions"><button v-if="selected.status !== 'published'" class="button primary btn" :disabled="busy" @click="review('approve')">通过并发布</button><button v-if="selected.status === 'pending'" class="button subtle btn" :disabled="busy" @click="review('reject')">驳回投稿</button><button v-if="selected.status === 'published'" class="button subtle btn" :disabled="busy" @click="review('remove')">下架技能</button></div></section><footer v-if="canEdit(selected)"><button class="button subtle btn skill-delete" :disabled="busy" @click="remove"><Trash2 :size="16" aria-hidden="true" />删除技能</button></footer>
      </template>
    </dialog>
    <dialog ref="discard" class="skill-dialog skill-discard" aria-label="放弃修改" @cancel.prevent="settleDiscard(false)"><h2>放弃未保存的修改？</h2><p>关闭后本次填写的内容不会保存。</p><footer><button class="button subtle btn" autofocus @click="settleDiscard(false)">继续编辑</button><button class="button btn" @click="settleDiscard(true)">放弃修改</button></footer></dialog>
  </section>
</template>

<style scoped>
.community-skills { min-width: 0; }.skills-heading, .skills-toolbar, .skill-card-top, .skill-meta, .skill-card footer, .skill-dialog header, .skill-dialog footer, .skill-detail-actions, .skill-review-actions { display: flex; align-items: center; gap: 12px; }.skills-heading { justify-content: space-between; align-items: flex-start; margin-bottom: 24px; }.skills-eyebrow { display: flex; align-items: center; gap: 8px; color: var(--muted); font-size: 12px; letter-spacing: .06em; margin-bottom: 10px; }.skills-heading h1 { font-size: clamp(26px, 4vw, 34px); line-height: 1.3; }.skills-heading h2 { font-size: 24px; }.skills-intro { margin-top: 10px; color: var(--muted); font-size: 14px; line-height: 24px; }.skills-heading > .button { flex: none; }.skills-guide { display: flex; align-items: center; gap: 12px; padding: 18px 20px; border: 1px solid var(--border); border-radius: 12px; background: var(--surface-soft); margin-bottom: 24px; font-size: 13px; line-height: 22px; }.skills-guide > svg { flex: none; }.skills-guide p { flex: 1; }.skills-guide a { display: flex; align-items: center; gap: 4px; white-space: nowrap; min-height: 44px; }.skills-toolbar { flex-wrap: wrap; margin-bottom: 24px; }.skills-search { display: flex; gap: 8px; margin-left: auto; }.skills-search .search-control { min-width: 0; width: min(280px, 100%); }.skills-status { display: flex; gap: 10px; align-items: center; font-size: 14px; }.skills-status select { min-height: 44px; }.skills-empty { min-height: 260px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 14px; text-align: center; color: var(--muted); font-size: 14px; }.skills-empty h2 { font-size: 18px; color: var(--ink); }.skill-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 20px; }.skills-admin .skill-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }.skill-card { border: 1px solid var(--border); border-radius: 14px; padding: 20px; min-width: 0; display: flex; flex-direction: column; background: var(--surface); }.skill-symbol { display: grid; place-items: center; width: 44px; height: 44px; border-radius: 10px; background: var(--surface-soft); flex: none; }.skill-badge { font-size: 12px; line-height: 20px; color: var(--muted); }.skill-state { margin-left: auto; }.skill-card-top { gap: 8px; flex-wrap: wrap; }.skill-card .skill-name { font-size: 17px; line-height: 26px; margin-top: 16px; overflow-wrap: anywhere; }.skill-card .skill-name button { text-align: left; min-height: 44px; }.skill-description { color: var(--muted); font-size: 14px; line-height: 24px; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; margin: 4px 0 20px; min-height: 72px; overflow-wrap: anywhere; }.skill-meta { justify-content: space-between; flex-wrap: wrap; color: var(--muted); font-size: 12px; line-height: 20px; margin-top: auto; overflow-wrap: anywhere; }.skill-card footer { justify-content: space-between; border-top: 1px solid var(--border); padding-top: 14px; margin-top: 14px; }.skill-review-note { background: var(--surface-soft); border-left: 3px solid var(--border); padding: 10px 12px; font-size: 13px; line-height: 22px; overflow-wrap: anywhere; margin-bottom: 16px; }.skills-more { margin: 24px auto; display: flex; }.skill-dialog { width: min(760px, calc(100vw - 32px)); max-height: calc(100dvh - 32px); padding: 24px; border: 1px solid var(--border); border-radius: 16px; background: var(--popover-surface); color: var(--ink); overflow-y: auto; overscroll-behavior: contain; }.skill-dialog::backdrop { background: rgb(0 0 0 / 48%); }.skill-dialog header { justify-content: space-between; margin-bottom: 20px; }.skill-dialog h2 { font-size: 20px; line-height: 28px; overflow-wrap: anywhere; }.skill-dialog header .icon-button { flex: none; }.skill-dialog footer { justify-content: flex-end; margin-top: 24px; padding-top: 16px; border-top: 1px solid var(--border); }.skill-form .field { margin-top: 16px; }.skill-form textarea, .skill-form input.control { width: 100%; }.skill-upload { display: grid; gap: 10px; padding: 20px; border: 1px dashed var(--control-border); border-radius: 10px; font-size: 14px; overflow-wrap: anywhere; }.skill-upload span { font-size: 12px; color: var(--muted); line-height: 20px; }.skill-upload input { width: 100%; min-height: 44px; }.skill-source { font-family: ui-monospace, monospace; font-size: 13px; line-height: 22px; resize: vertical; }.skill-files { margin-block: 20px; font-size: 13px; }.skill-files summary { display: flex; align-items: center; gap: 8px; min-height: 44px; cursor: pointer; }.skill-files ul { list-style: none; padding: 0; max-height: 240px; overflow-y: auto; }.skill-files li { display: flex; justify-content: space-between; gap: 14px; padding: 8px 0; border-bottom: 1px solid var(--border); }.skill-files li span { overflow-wrap: anywhere; min-width: 0; }.skill-files small { white-space: nowrap; color: var(--muted); font-size: 12px; }.skill-policy, .skill-checkbox { font-size: 13px; line-height: 22px; margin-block: 20px; }.skill-checkbox { display: flex; align-items: center; gap: 10px; min-height: 44px; }.skill-checkbox input { width: 18px; height: 18px; }.skill-detail-meta { display: flex; gap: 16px; flex-wrap: wrap; color: var(--muted); font-size: 13px; }.skill-detail-description { margin-block: 20px; line-height: 26px; overflow-wrap: anywhere; }.skill-detail-actions, .skill-review-actions { flex-wrap: wrap; margin-bottom: 16px; }.skill-preview { white-space: pre-wrap; overflow-wrap: anywhere; max-height: 400px; overflow-y: auto; padding: 16px; background: var(--surface-soft); border: 1px solid var(--border); border-radius: 8px; font-size: 13px; line-height: 22px; }.skill-source-title { display: flex; align-items: center; gap: 8px; font-size: 14px; margin-bottom: 12px; }.skill-review { margin-top: 24px; border-top: 1px solid var(--border); padding-top: 20px; }.skill-review h3 { font-size: 16px; }.skill-review .field { margin-block: 16px; }.skill-delete { color: var(--danger); }.skill-discard { width: min(400px, calc(100vw - 32px)); }.skill-discard p { margin-top: 16px; font-size: 14px; }.community-skills .button, .community-skills .icon-button { min-height: 44px; }.community-skills .icon-button { min-width: 44px; }.skill-dialog .form-error { margin-bottom: 16px; }
@media (max-width: 1100px) { .skill-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }.skills-admin .skill-grid { grid-template-columns: 1fr; } }
@media (max-width: 639px) { .skills-heading { gap: 14px; flex-wrap: wrap; }.skills-guide { align-items: flex-start; flex-wrap: wrap; padding: 16px; }.skills-guide p { flex-basis: calc(100% - 40px); }.skills-guide a { margin-left: 32px; }.skills-search { order: 3; width: 100%; margin: 0; }.skills-search .search-control { flex: 1; width: 0; }.skills-toolbar > .icon-button { margin-left: auto; }.skill-grid { grid-template-columns: 1fr; gap: 14px; }.skill-card { padding: 18px; }.skill-description { min-height: 0; }.skill-dialog { padding: 18px; width: calc(100vw - 16px); max-height: calc(100dvh - 16px); border-radius: 12px; }.skill-dialog .control { font-size: 16px; }.skill-dialog footer { flex-wrap: wrap; }.skill-form .skill-source { font-size: 14px; } }
</style>
