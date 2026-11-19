<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { Save } from '@lucide/vue'
import { api, errorMessage, session } from '../state'

interface Privacy {
  isLocked: boolean; autoAcceptFollowed: boolean; followApprovalLocalSeconds: number | null
  followingVisibility: 'public' | 'followers' | 'private'; followersVisibility: 'public' | 'followers' | 'private'
}
const emit = defineEmits<{ dirty: [value: boolean] }>()
const settings = ref<Privacy | null>(null), baseline = ref(''), version = ref('')
const loading = ref(false), saving = ref(false), error = ref(''), saved = ref(false)
const dirty = computed(() => Boolean(settings.value) && JSON.stringify(settings.value) !== baseline.value)
const presets = [{ value: null, label: '使用默认值（不限制）' }, { value: 0, label: '不限制' }, { value: 3600, label: '注册不满 1 小时' }, { value: 86400, label: '注册不满 1 天' }, { value: 604800, label: '注册不满 7 天' }, { value: 2592000, label: '注册不满 30 天' }]
const customPeriod = computed(() => settings.value && !presets.some(item => item.value === settings.value!.followApprovalLocalSeconds))
let controller: AbortController | undefined, generation = 0
watch(dirty, value => emit('dirty', value), { flush: 'sync' })
function discard() {
  generation++; controller?.abort(); saving.value = false; saved.value = false; error.value = ''
  if (baseline.value) settings.value = JSON.parse(baseline.value)
}
defineExpose({ discard })
async function load() {
  controller?.abort(); const active = new AbortController(); controller = active; const current = ++generation
  loading.value = true; error.value = ''; saved.value = false; saving.value = false
  settings.value = null; baseline.value = ''; version.value = ''
  if (!session.user) { loading.value = false; return }
  try {
    const result = await api<{ settings: Privacy; version: string }>('/api/account/privacy', { signal: active.signal })
    if (current !== generation) return
    settings.value = result.settings; baseline.value = JSON.stringify(result.settings); version.value = result.version
  } catch (cause) { if (!active.signal.aborted) error.value = errorMessage(cause) }
  finally { if (current === generation) loading.value = false }
}
async function save() {
  if (!settings.value || saving.value || !dirty.value) return
  const owner = session.user?.id, current = generation, active = new AbortController(); controller = active
  saving.value = true; error.value = ''; saved.value = false
  try {
    const result = await api<{ settings: Privacy; version: string }>('/api/account/privacy', { method: 'PATCH', body: { ...settings.value, version: version.value }, signal: active.signal, expectedAccount: session.user?.accountId || owner })
    if (current !== generation || owner !== session.user?.id) return
    settings.value = result.settings; baseline.value = JSON.stringify(result.settings); version.value = result.version; saved.value = true
  } catch (cause) { if (current === generation && !active.signal.aborted) error.value = errorMessage(cause) }
  finally { if (current === generation) saving.value = false }
}
watch(() => session.user?.id, load, { immediate: true })
onBeforeUnmount(() => { generation++; controller?.abort(); emit('dirty', false) })
</script>

<template>
  <section class="panel-section privacy-settings">
    <div class="section-heading"><div><h2 id="privacy-heading">关注与隐私</h2><p class="form-note">决定谁可以关注你，以及谁能查看你的关注列表。</p></div></div>
    <p v-if="loading" role="status">正在读取隐私设置…</p>
    <form v-else-if="settings" class="stack" aria-labelledby="privacy-heading" @submit.prevent="save">
      <fieldset :disabled="saving" class="privacy-fields">
        <legend>关注审批</legend>
        <label class="privacy-switch"><span><strong>关注请求需要批准</strong><small>新关注会先成为申请；已有粉丝不受影响，公开作品仍可正常浏览。</small></span><input v-model="settings.isLocked" type="checkbox" /></label>
        <label class="field"><span>新账号关注审批</span><select v-model="settings.followApprovalLocalSeconds" class="control" :disabled="settings.isLocked"><option v-for="item in presets" :key="String(item.value)" :value="item.value">{{ item.label }}</option><option v-if="customPeriod" :value="settings.followApprovalLocalSeconds">已有自定义设置（{{ settings.followApprovalLocalSeconds }} 秒）</option></select><small class="form-note">按账号加入本社区的时间计算。开启全部审批后，所有新关注均需批准。</small></label>
        <label class="privacy-switch"><span><strong>自动允许我关注的人的关注请求</strong><small>你已经关注的作者可以直接回关，无需再次审批。</small></span><input v-model="settings.autoAcceptFollowed" type="checkbox" /></label>
      </fieldset>
      <fieldset :disabled="saving" class="privacy-fields"><legend>列表公开范围</legend>
        <label class="field"><span>关注列表可见范围</span><select v-model="settings.followingVisibility" class="control"><option value="public">公开</option><option value="followers">仅我的粉丝</option><option value="private">仅自己</option></select></label>
        <label class="field"><span>粉丝列表可见范围</span><select v-model="settings.followersVisibility" class="control"><option value="public">公开</option><option value="followers">仅我的粉丝</option><option value="private">仅自己</option></select></label>
      </fieldset>
      <p v-if="error" class="error-message" role="alert">{{ error }}</p>
      <p v-if="saved && !dirty" role="status">隐私设置已保存。</p>
      <div class="privacy-actions"><p class="form-note">更改审批规则不影响已有关注。待处理申请请到<RouterLink to="/account?tab=following" class="text-link">关注申请</RouterLink>中确认。</p><div><button class="button btn primary" :disabled="saving || !dirty"><Save :size="16" aria-hidden="true" />{{ saving ? '正在保存…' : '保存隐私设置' }}</button><button v-if="error" type="button" class="button btn subtle" :disabled="saving" @click="load">放弃更改并重新加载</button></div></div>
    </form>
    <div v-else-if="error"><p class="error-message" role="alert">{{ error }}</p><button class="button btn" @click="load">重新加载</button></div>
  </section>
</template>

<style scoped>
/* Hallmark · shape: app screen · genre: modern-minimal · theme: brand · redesign: full · signature: aligned privacy controls · v2.0.0 */
/* Hallmark · pre-emit critique: P4 H4 E4 S3 R5 V3 · weakest: S, keep all community follow rules visible */
.privacy-settings { width: 100%; container: privacy / inline-size; }
.privacy-settings > form { gap: var(--settings-space-section); }
.privacy-settings h2 { min-width: 0; overflow-wrap: break-word; text-wrap: balance; }
.privacy-fields { border: 0; margin: 0; padding: 0; display: grid; gap: 0; min-width: 0; }
.privacy-fields + .privacy-fields { border-top: 1px solid var(--border); padding-top: var(--settings-space-group); }
.privacy-fields legend { font-size: 14px; line-height: 20px; font-weight: 600; margin-bottom: var(--settings-space-related); padding: 0; }
.privacy-switch { display: flex; align-items: center; justify-content: space-between; gap: var(--settings-space-section); cursor: pointer; min-height: 72px; padding-block: var(--settings-space-row); border-bottom: 1px solid var(--border); }
.privacy-switch:last-child { border-bottom: 0; }
.privacy-switch input { appearance: none; position: relative; width: 40px; height: 24px; flex: none; margin: 0; background: var(--surface-soft); border: 1px solid var(--control-border); border-radius: 999px; cursor: pointer; }
.privacy-switch input:focus-visible, .privacy-settings .control:focus-visible, .privacy-settings button:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: var(--focus-outline-offset); }
.privacy-switch input:active { background: var(--surface); }
.privacy-switch input:disabled, .privacy-settings select:disabled, .privacy-settings button:disabled { opacity: .55; cursor: not-allowed; }
.privacy-switch input::before { content: ''; position: absolute; inset-block-start: 3px; inset-inline-start: 3px; width: 16px; height: 16px; border-radius: 50%; background: var(--ink); }
.privacy-switch input:checked { background: var(--blue); border-color: var(--blue); }
.privacy-switch input:checked::before { inset-inline-start: 19px; background: var(--action-ink); }
.privacy-switch span { display: grid; gap: var(--settings-space-label); min-width: 0; }
.privacy-switch strong { font-size: 14px; font-weight: 500; }
.privacy-switch small { color: var(--muted); font-size: 12px; line-height: 20px; }
.privacy-fields > .field { display: grid; grid-template-columns: minmax(0, 1fr) var(--settings-control-width); align-items: center; gap: var(--settings-space-label) var(--settings-space-section); min-height: 68px; padding-block: var(--settings-space-row); border-bottom: 1px solid var(--border); }
.privacy-fields > .field:last-child { border-bottom: 0; }
.privacy-fields > .field .control { grid-column: 2; grid-row: 1 / span 2; align-self: center; }
.privacy-fields > .field:not(:has(small)) .control { grid-row: 1; }
.privacy-fields > .field small { grid-column: 1; font-size: 12px; line-height: 20px; }
.privacy-actions { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: var(--settings-space-group); padding-block: var(--settings-space-group); border-top: 1px solid var(--border); }
.privacy-actions > p { flex: 1 1 260px; max-width: 58ch; font-size: 12px; line-height: 20px; }
.privacy-actions > div { display: flex; flex-wrap: wrap; gap: var(--settings-space-related); margin-inline-start: auto; }
.privacy-actions button, select.control { min-height: var(--settings-control-height); white-space: nowrap; }
@container privacy (max-width: 560px) {
  .privacy-fields > .field { grid-template-columns: minmax(0, 1fr); gap: var(--settings-space-related); }
  .privacy-fields > .field .control { grid-column: auto; grid-row: auto; }
  .privacy-fields > .field:not(:has(small)) .control { grid-row: auto; }
  .privacy-fields > .field small { grid-row: 2; }
  .privacy-switch { gap: var(--settings-space-group); }
}
@media (forced-colors: active) {
  .privacy-switch input { appearance: auto; }
  .privacy-switch input::before { display: none; }
}
</style>
