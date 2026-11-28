<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { maintenanceInput, type MaintenanceBenefit, type MaintenanceInput } from '../../shared/maintenance-benefits'
import { api, errorMessage, session } from '../state'

const props = defineProps<{ confirmLeave: () => boolean | Promise<boolean> }>()
const items = ref<MaintenanceBenefit[]>([]), cursor = ref<string | null>(null), error = ref(''), message = ref('')
const loading = ref(false), busy = ref(false), editing = ref(false), baseline = ref('')
const formTitle = ref<HTMLInputElement>()
const draft = ref({ id: '', version: 0, title: '', content: '', credits: 10, rewardValidityDays: 30,
  startsAt: '', endsAt: '', popupMaxDisplays: 3, popupIntervalMinutes: 60, isActive: false })
const hasUnsavedChanges = computed(() => editing.value && JSON.stringify(draft.value) !== baseline.value)
defineExpose({ hasUnsavedChanges, busy })
let sequence = 0, controller: AbortController | undefined
const owner = () => `${session.user?.id || ''}:${session.user?.accountId || ''}:${session.user?.isAdmin}`
const dateInput = (value: string) => { const date = new Date(value); return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0,16) }
const dateLabel = (value: string) => new Date(value).toLocaleString('zh-CN', { dateStyle: 'medium', timeStyle: 'short' })
async function load(more = false) {
  if (!session.user?.isAdmin || busy.value) return
  const request = ++sequence, identity = owner(); controller?.abort(); controller = new AbortController()
  loading.value = true; error.value = ''
  try {
    const data = await api<{ benefits: MaintenanceBenefit[]; nextCursor: string | null }>('/api/admin/maintenance-benefits' + (more && cursor.value ? `?cursor=${encodeURIComponent(cursor.value)}` : ''), { signal: controller.signal, expectedAccount: session.user.id })
    if (request !== sequence || identity !== owner()) return
    items.value = more ? [...items.value, ...data.benefits] : data.benefits; cursor.value = data.nextCursor
  } catch (cause) { if (request === sequence && identity === owner()) error.value = errorMessage(cause) }
  finally { if (request === sequence) loading.value = false }
}
async function edit(item?: MaintenanceBenefit) {
  if (hasUnsavedChanges.value && !await props.confirmLeave()) return
  const start = new Date(), end = new Date(start.getTime() + 86400000)
  draft.value = item ? { id: item.id, version: item.version, title: item.title, content: item.content, credits: item.credits,
    rewardValidityDays: item.rewardValidityDays, startsAt: dateInput(item.startsAt), endsAt: dateInput(item.endsAt),
    popupMaxDisplays: item.popupMaxDisplays, popupIntervalMinutes: item.popupIntervalMinutes, isActive: item.isActive }
    : { id: Date.now().toString(36) + crypto.randomUUID().replaceAll('-','').slice(0,20), version: 0, title: '网站维护福利',
      content: '感谢你的理解与支持，领取限时福利积分后即可用于社区创作。', credits: 10, rewardValidityDays: 30,
      startsAt: dateInput(start.toISOString()), endsAt: dateInput(end.toISOString()), popupMaxDisplays: 3, popupIntervalMinutes: 60, isActive: false }
  baseline.value = JSON.stringify(draft.value); editing.value = true; error.value = ''; message.value = ''
  await nextTick(); formTitle.value?.focus()
}
async function cancel() { if (!hasUnsavedChanges.value || await props.confirmLeave()) editing.value = false }
async function mutate(body: unknown, path = '/api/admin/maintenance-benefits') {
  if (busy.value || !session.user?.isAdmin) return
  const identity = owner(), request = ++sequence; controller?.abort(); controller = new AbortController()
  loading.value = false; busy.value = true; error.value = ''; message.value = ''
  try {
    await api(path, { method: 'POST', body, expectedAccount: session.user.id, signal: controller.signal })
    if (identity !== owner() || request !== sequence) return
    editing.value = false; message.value = path.endsWith('/retry') ? '已安排核对原发放流水，不会重复发积分。' : '维护福利已保存。'
  } catch (cause) { if (identity === owner() && request === sequence) error.value = errorMessage(cause) }
  finally { if (request === sequence) busy.value = false }
  if (identity === owner() && message.value) await load()
}
async function save() {
  let definition: MaintenanceInput
  try { definition = maintenanceInput.parse({ ...draft.value, rewardType: 'timed', startsAt: new Date(draft.value.startsAt).toISOString(), endsAt: new Date(draft.value.endsAt).toISOString() }) }
  catch { error.value = '请检查表单，结束时间须晚于开始时间，有效期为 1–365 天。'; return }
  await mutate({ id: draft.value.id, version: draft.value.version, isActive: draft.value.isActive, definition })
}
async function toggle(item: MaintenanceBenefit) {
  if (hasUnsavedChanges.value && !await props.confirmLeave()) return
  await mutate({ id: item.id, version: item.version, isActive: !item.isActive, definition: maintenanceInput.parse(item) })
}
watch(owner, () => { sequence++; controller?.abort(); busy.value = false; editing.value = false; items.value = []; cursor.value = null; void load() }, { immediate: true, flush: 'sync' })
onBeforeUnmount(() => { sequence++; controller?.abort() })
</script>

<template>
  <section class="maintenance-admin" aria-labelledby="maintenance-admin-title">
    <header class="maintenance-heading"><div><h2 id="maintenance-admin-title">维护福利</h2><p class="muted">设置维护期间的弹窗福利、展示次数和领取积分。启用活动会自动停用其他活动。</p></div><button class="button primary" :disabled="busy || loading" @click="edit()">新建福利</button></header>
    <p v-if="error" role="alert" class="form-error">{{ error }}</p><p v-if="message" role="status">{{ message }}</p>
    <form v-if="editing" class="maintenance-editor" @submit.prevent="save">
      <h3>{{ draft.version ? '编辑福利' : '新建福利' }}</h3>
      <fieldset :disabled="busy"><label class="field"><span>福利标题</span><input ref="formTitle" v-model="draft.title" class="control" maxlength="120" required /></label>
        <label class="field"><span>福利内容</span><textarea v-model="draft.content" class="control" rows="4" maxlength="10000" required /></label>
        <div class="maintenance-fields"><label class="field"><span>每人领取积分</span><input v-model.number="draft.credits" class="control" type="number" min="1" max="1000000" step="1" required /></label><label class="field"><span>积分有效期（天）</span><input v-model.number="draft.rewardValidityDays" class="control" type="number" min="1" max="365" step="1" required /></label></div>
        <p class="form-note">积分属性：<strong>限时福利积分</strong>。有效期从实际到账时开始计算；每个账号每期只能领取一次。已领取和正在发放的奖励保留原金额与有效期。</p>
        <div class="maintenance-fields"><label class="field"><span>活动开始时间</span><input v-model="draft.startsAt" class="control" type="datetime-local" required /></label><label class="field"><span>活动结束时间</span><input v-model="draft.endsAt" class="control" type="datetime-local" required /></label><label class="field"><span>每人最多弹窗次数</span><input v-model.number="draft.popupMaxDisplays" class="control" type="number" min="1" max="100" step="1" required /></label><label class="field"><span>弹窗间隔（分钟）</span><input v-model.number="draft.popupIntervalMinutes" class="control" type="number" min="0" max="10080" step="1" required /></label></div>
        <p class="form-note">时间按当前设备时区显示。已领取后不再弹出，创作和管理页面不自动弹出。</p>
        <label class="maintenance-enable"><input v-model="draft.isActive" type="checkbox" />启用此活动（会停用其他活动）</label>
        <footer><button type="submit" class="button primary">{{ busy ? '正在保存…' : '保存福利' }}</button><button type="button" class="button" @click="cancel">取消编辑</button></footer>
      </fieldset>
    </form>
    <header class="maintenance-heading"><h3>福利活动记录</h3><button class="button" :disabled="loading || busy" @click="load()">刷新</button></header>
    <p v-if="loading" role="status">正在读取福利活动…</p><p v-else-if="!items.length" class="muted">暂无维护福利，点击“新建福利”开始设置。</p>
    <article v-for="item in items" :key="item.id" class="maintenance-card">
      <header><div><h4>{{ item.title }}</h4><p class="muted">{{ dateLabel(item.startsAt) }} 至 {{ dateLabel(item.endsAt) }}</p></div><span :class="['maintenance-badge', { enabled: item.isActive }]">{{ item.isActive ? '已启用' : '已停用' }}</span></header>
      <p class="maintenance-content">{{ item.content }}</p>
      <div class="maintenance-stats"><span>{{ item.credits }} 积分/人</span><span>限时福利积分（{{ item.rewardValidityDays }} 天）</span><span>每人最多弹窗 {{ item.popupMaxDisplays }} 次</span><span>间隔 {{ item.popupIntervalMinutes }} 分钟</span><span>覆盖 {{ item.recipientCount }} 人</span><span>已到账 {{ item.claimedCount }} 人</span><span v-if="item.pendingCount">待到账 {{ item.pendingCount }} 人</span><span>展示 {{ item.totalDisplays }} 次</span></div>
      <footer><button v-if="item.pendingCount" class="button" :disabled="busy || editing" @click="mutate({ id: item.id }, '/api/admin/maintenance-benefits/retry')">重试待到账</button><button class="button" :disabled="busy" @click="edit(item)">编辑</button><button :class="['button', { primary: !item.isActive }]" :disabled="busy" @click="toggle(item)">{{ item.isActive ? '停用' : '启用' }}</button></footer>
    </article>
    <button v-if="cursor" class="button" :disabled="busy || loading" @click="load(true)">更多活动</button>
  </section>
</template>

<style scoped>
.maintenance-admin { min-width: 0; }.maintenance-heading,.maintenance-card header { display: flex; justify-content: space-between; align-items: start; gap: 16px; margin-bottom: 20px; }.maintenance-heading h2,.maintenance-heading h3,.maintenance-card h4 { margin: 0 0 8px; }.maintenance-heading p { max-width: 640px; line-height: 1.7; }.maintenance-admin button { min-height: 44px; flex-shrink: 0; }.maintenance-card,.maintenance-editor { padding: 24px; border: 1px solid var(--border); border-radius: var(--radius); margin-bottom: 20px; background: var(--surface); }.maintenance-card h4 { font-size: 18px; }.maintenance-card header p { font-size: 14px; }.maintenance-content { white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.8; }.maintenance-stats { display: flex; flex-wrap: wrap; gap: 8px 16px; margin: 20px 0; color: var(--muted); font-size: 14px; }.maintenance-badge { flex-shrink: 0; border: 1px solid var(--border); padding: 5px 10px; border-radius: 999px; font-size: 13px; }.maintenance-badge.enabled { color: var(--accent); }.maintenance-admin footer { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 12px; margin-top: 20px; }.maintenance-fields { display: grid; grid-template-columns: minmax(0,1fr) minmax(0,1fr); gap: 16px; }.maintenance-editor fieldset { border: 0; padding: 0; margin: 0; min-width: 0; }.maintenance-editor .field { min-width: 0; }.maintenance-editor .control { width: 100%; box-sizing: border-box; }.maintenance-editor textarea { resize: vertical; }.maintenance-enable { display: flex; align-items: center; gap: 10px; min-height: 44px; }.maintenance-editor .form-note { display: block; line-height: 1.7; margin-bottom: 20px; }.maintenance-admin :is(button,input,textarea):focus-visible { outline: 2px solid var(--focus-ring); outline-offset: 2px; }
@media (max-width: 600px) { .maintenance-heading { flex-wrap: wrap; }.maintenance-card,.maintenance-editor { padding: 16px; }.maintenance-fields { grid-template-columns: minmax(0,1fr); gap: 0; } }
</style>
