<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { ArrowDown, ArrowUp, RefreshCw } from '@lucide/vue'
import { welfareTasksSchema, type WelfareTask } from '../../shared/welfare-tasks'
import { api, errorMessage, notify, session } from '../state'

const items = ref<WelfareTask[]>([]), version = ref(''), baseline = ref('')
const loading = ref(true), busy = ref(false), error = ref(''), saved = ref(false), reloadPrompt = ref(false)
const hasUnsavedChanges = computed(() => !!version.value && JSON.stringify(items.value) !== baseline.value)
const labels = { invite: '邀请福利', publish: '作品福利', upcoming: '后续预告' }
let sequence = 0, controller: AbortController | undefined
const valid = computed(() => welfareTasksSchema.safeParse(items.value).success)
defineExpose({ hasUnsavedChanges, busy })

async function request(save = false) {
  if (!session.user?.isAdmin || busy.value) return
  if (save && (!version.value || !valid.value || !hasUnsavedChanges.value)) return
  const id = ++sequence, owner = session.user.id
  controller?.abort(); controller = new AbortController()
  const current = () => id === sequence && session.user?.id === owner && session.user.isAdmin
  if (save) busy.value = true
  else loading.value = true
  error.value = ''; saved.value = false; reloadPrompt.value = false
  try {
    const result = await api<{ items: unknown; version: string }>('/api/admin/welfare/tasks', {
      ...(save ? { method: 'PATCH' as const, expectedAccount: owner, body: { items: items.value, version: version.value } } : {}),
      signal: controller.signal,
    })
    const parsed = welfareTasksSchema.safeParse(result.items)
    if (!parsed.success || typeof result.version !== 'string' || !result.version) throw new Error('任务配置读取不完整，请重新读取。')
    if (!current()) return
    items.value = parsed.data; version.value = result.version; baseline.value = JSON.stringify(items.value)
    if (save) { saved.value = true; notify('福利任务与作品奖励已保存。') }
  } catch (cause) { if (current()) error.value = errorMessage(cause) }
  finally { if (current()) { loading.value = false; busy.value = false } }
}
function refresh() { if (hasUnsavedChanges.value) reloadPrompt.value = true; else void request() }
function move(index: number, offset: number) {
  const target = index + offset
  if (busy.value || target < 0 || target >= items.value.length) return
  const [item] = items.value.splice(index, 1); items.value.splice(target, 0, item!)
  saved.value = false
}
watch([() => session.user?.id, () => session.user?.isAdmin], () => {
  sequence++; controller?.abort(); items.value = []; version.value = ''; baseline.value = ''; busy.value = false
  error.value = ''; saved.value = false; reloadPrompt.value = false
  void request()
}, { immediate: true, flush: 'sync' })
onBeforeUnmount(() => { sequence++; controller?.abort() })
</script>

<template>
  <section class="admin-welfare-tasks" aria-labelledby="admin-welfare-title">
    <header class="section-heading"><div><h2 id="admin-welfare-title">福利任务</h2><p class="muted">管理福利中心「任务与邀请」中展示的任务。</p></div><button type="button" class="icon-button" aria-label="刷新福利任务配置" :disabled="loading || busy" @click="refresh"><RefreshCw :size="18" aria-hidden="true" /></button></header>
    <p class="form-note">发作品送抽奖次数可在下方「作品福利」调整。邀请积分和充值条件沿用章鱼账户中心设置；作品获赞与关注规则可在 <RouterLink to="/admin?tab=lottery" class="text-link">活动抽奖</RouterLink> 中调整。</p>
    <p class="form-note">补充说明只用于展示；关闭展示不会停发已绑定的邀请奖励，也不会关闭原有福利规则。「敬请期待」始终作为未开放预告。</p>
    <p v-if="loading" role="status">正在读取任务配置…</p>
    <div v-if="error" class="form-error" role="alert"><p>{{ error }}</p><button type="button" class="button btn" :disabled="busy || loading" @click="refresh">重新读取配置</button></div>
    <div v-if="reloadPrompt" class="notice-inline" role="alert"><p>重新读取会丢弃未保存的任务修改。</p><button type="button" class="button btn" @click="request()">丢弃修改并重新读取</button><button type="button" class="button subtle btn" @click="reloadPrompt = false">继续编辑</button></div>
    <form v-if="version && !loading" @submit.prevent="request(true)">
      <fieldset v-for="(item, index) in items" :key="item.id" class="task-editor" :disabled="busy">
        <legend>{{ index + 1 }}. {{ labels[item.id] }}</legend>
        <div class="task-editor-toolbar"><label class="task-visible"><input v-model="item.enabled" type="checkbox" />显示{{ labels[item.id] }}</label><div class="task-order"><button type="button" class="icon-button" :aria-label="`上移${labels[item.id]}`" :disabled="index === 0" @click="move(index, -1)"><ArrowUp :size="18" aria-hidden="true" /></button><button type="button" class="icon-button" :aria-label="`下移${labels[item.id]}`" :disabled="index === items.length - 1" @click="move(index, 1)"><ArrowDown :size="18" aria-hidden="true" /></button></div></div>
        <div v-if="item.id === 'publish' && item.publicationReward" class="publication-editor">
          <label class="task-visible"><input v-model="item.publicationReward.enabled" type="checkbox" />启用发作品送抽奖次数</label>
          <div class="task-editor-fields">
            <label class="field"><span>每日需发布作品数</span><input v-model.number="item.publicationReward.threshold" class="control" type="number" min="1" max="1000000" step="1" required aria-describedby="publication-reward-help" /></label>
            <label class="field"><span>每日奖励抽奖次数</span><input v-model.number="item.publicationReward.tickets" class="control" type="number" min="1" max="1000" step="1" required aria-describedby="publication-reward-help" /></label>
          </div>
          <p v-if="valid" class="reward-preview">{{ item.publicationReward.enabled ? `发布 ${item.publicationReward.threshold} 个作品，获得 ${item.publicationReward.tickets} 次抽奖机会` : '发作品奖励已暂停' }}</p>
          <p v-else class="form-error" role="alert">作品数量须为 1–1,000,000 的整数，抽奖次数须为 1–1,000 的整数；请同时检查任务名称与说明。</p>
          <p id="publication-reward-help" class="form-note">达标自动到账，每日仅奖励一次。每天北京时间 00:00 与活动抽奖同步重置，当日未完成进度和领奖后发布的作品不结转。仅计首次公开的社区作品；待审核作品通过后计入，编辑与重新上架不重复计数。已到账的抽奖次数不受任务重置影响。</p>
          <p class="form-note">保存后，当日未完成的进度会保留，后续新发表作品按新门槛和奖励判断；已到账的次数与当日领奖状态不变。隐藏展示不会关闭发奖，停发请关闭上方奖励开关。</p>
        </div>
        <div class="task-editor-fields"><label class="field"><span>{{ labels[item.id] }}名称</span><input v-model="item.title" class="control" required maxlength="40" /></label><label class="field"><span>{{ labels[item.id] }}按钮文字</span><input v-model="item.buttonText" class="control" required maxlength="24" /></label></div>
        <label class="field"><span>{{ labels[item.id] }}补充说明</span><textarea v-model="item.description" class="control" rows="2" maxlength="240" /></label>
      </fieldset>
      <div class="task-save"><button type="submit" class="button primary btn" :disabled="busy || !valid || !hasUnsavedChanges">{{ busy ? '正在保存…' : '保存福利任务' }}</button><p v-if="hasUnsavedChanges" class="muted" role="status">有未保存的修改</p><p v-else-if="saved" role="status">已保存，福利中心会自动同步最新规则。</p></div>
    </form>
  </section>
</template>

<style scoped>
.admin-welfare-tasks { min-width: 0; }
.admin-welfare-tasks > .section-heading { display: grid; grid-template-columns: minmax(0, 1fr) var(--target-size); gap: var(--space-control); align-items: start; }
.admin-welfare-tasks h2 { margin-bottom: var(--space-small); }
.admin-welfare-tasks > .form-note { display: block; line-height: 24px; margin-block: var(--space-control); }
.admin-welfare-tasks > .form-note .text-link { display: inline; white-space: nowrap; text-decoration: underline; text-underline-offset: 3px; }
.task-editor { min-width: 0; margin-block: var(--space-group); border: 1px solid var(--border); border-radius: var(--radius); padding: var(--space-group); }
.task-editor legend { padding-inline: var(--space-small); font-size: 16px; font-weight: 600; }
.task-editor-toolbar, .task-order, .task-save { display: flex; align-items: center; gap: var(--space-control); }
.task-editor-toolbar { justify-content: space-between; margin-bottom: var(--space-control); }
.task-visible { display: flex; align-items: center; gap: var(--space-small); min-height: var(--target-size); }
.task-visible input { width: 18px; height: 18px; accent-color: var(--blue); }
.task-editor-fields { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-group); }
.task-editor .field { min-width: 0; }
.task-editor .control { width: 100%; border-color: var(--control-border); }
.task-editor textarea { resize: vertical; }
.publication-editor { padding-bottom: var(--space-group); margin-bottom: var(--space-group); border-bottom: 1px solid var(--border); }
.publication-editor .form-note { display: block; line-height: 24px; margin-top: var(--space-small); }
.reward-preview { color: var(--blue); font-weight: 600; font-variant-numeric: tabular-nums; }
.task-save { flex-wrap: wrap; margin-block: var(--space-group); }
.admin-welfare-tasks :is(input, textarea, button, a):focus-visible { outline: 2px solid var(--focus-ring); outline-offset: var(--focus-outline-offset); }
.notice-inline .btn { margin: var(--space-small) var(--space-small) 0 0; }
@media (max-width: 700px) { .task-editor-fields { grid-template-columns: minmax(0, 1fr); gap: 0; } }
</style>
