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
const presets = [{ value: null, label: '默认（不限制）' }, { value: 0, label: '不限制' }, { value: 3600, label: '加入不满 1 小时' }, { value: 86400, label: '加入不满 1 天' }, { value: 604800, label: '加入不满 7 天' }, { value: 2592000, label: '加入不满 30 天' }]
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
    <div class="section-heading"><div><h2 id="privacy-heading">关注与隐私</h2><p class="form-note">管理关注审批与列表可见范围。</p></div></div>
    <p v-if="loading" role="status">正在读取隐私设置…</p>
    <form v-else-if="settings" class="stack" aria-labelledby="privacy-heading" @submit.prevent="save">
      <div class="settings-preference-group">
        <h3 id="privacy-approval-group" class="settings-preference-title">关注审批</h3>
        <fieldset :disabled="saving" class="privacy-fields" aria-labelledby="privacy-approval-group">
          <legend class="settings-group-legend">关注审批</legend>
          <label class="privacy-switch" for="privacy-approval"><span><strong id="privacy-approval-label">关注请求需要批准</strong><small id="privacy-approval-help">开启后先收到关注申请；已有粉丝与公开作品不受影响。</small></span><input id="privacy-approval" v-model="settings.isLocked" type="checkbox" name="isLocked" aria-labelledby="privacy-approval-label" aria-describedby="privacy-approval-help" /></label>
          <label class="field" for="privacy-newcomers"><span id="privacy-newcomers-label">新账号关注审批</span><select id="privacy-newcomers" v-model="settings.followApprovalLocalSeconds" name="followApprovalLocalSeconds" class="control select-control" :disabled="settings.isLocked" aria-labelledby="privacy-newcomers-label" aria-describedby="privacy-newcomers-help"><option v-for="item in presets" :key="String(item.value)" :value="item.value">{{ item.label }}</option><option v-if="customPeriod" :value="settings.followApprovalLocalSeconds">已有自定义设置（{{ settings.followApprovalLocalSeconds }} 秒）</option></select><small id="privacy-newcomers-help" class="form-note">{{ settings.isLocked ? '全部审批已开启，此项暂不生效；关闭后保留原选择。' : '按账号加入本社区的时间判断是否需要审批。' }}</small></label>
          <label class="privacy-switch" for="privacy-followback"><span><strong id="privacy-followback-label">允许已关注的人直接回关</strong><small id="privacy-followback-help">你关注的人无需审批，优先于上方规则。</small></span><input id="privacy-followback" v-model="settings.autoAcceptFollowed" name="autoAcceptFollowed" type="checkbox" aria-labelledby="privacy-followback-label" aria-describedby="privacy-followback-help" /></label>
        </fieldset>
      </div>
      <div class="settings-preference-group">
        <h3 id="privacy-visibility-group" class="settings-preference-title">列表公开范围</h3>
        <fieldset :disabled="saving" class="privacy-fields privacy-visibility" aria-labelledby="privacy-visibility-group"><legend class="settings-group-legend">列表公开范围</legend>
          <label class="field" for="privacy-following"><span>关注列表可见范围</span><select id="privacy-following" v-model="settings.followingVisibility" name="followingVisibility" class="control select-control"><option value="public">公开</option><option value="followers">仅我的粉丝</option><option value="private">仅自己</option></select></label>
          <label class="field" for="privacy-followers"><span>粉丝列表可见范围</span><select id="privacy-followers" v-model="settings.followersVisibility" name="followersVisibility" class="control select-control"><option value="public">公开</option><option value="followers">仅我的粉丝</option><option value="private">仅自己</option></select></label>
        </fieldset>
      </div>
      <p v-if="error" class="error-message settings-preference-footer" role="alert">{{ error }}</p>
      <p v-if="saved && !dirty" class="settings-preference-footer" role="status">隐私设置已保存。</p>
      <div class="privacy-actions settings-preference-footer"><p class="form-note">待处理的<RouterLink to="/messages?tab=activity#follow-requests" class="text-link">关注申请</RouterLink>仍需手动确认。</p><div><button type="submit" class="button btn primary" :disabled="saving || !dirty"><Save :size="16" aria-hidden="true" />{{ saving ? '正在保存…' : '保存隐私设置' }}</button><button v-if="error" type="button" class="button btn subtle" :disabled="saving" @click="load">放弃更改并重新加载</button></div></div>
    </form>
    <div v-else-if="error"><p class="error-message" role="alert">{{ error }}</p><button class="button btn" @click="load">重新加载</button></div>
  </section>
</template>

<style scoped>
/* Hallmark · shape: app screen · genre: modern-minimal · theme: brand · redesign: full · signature: aligned privacy controls · v2.0.0 */
/* Hallmark · pre-emit critique: P4 H4 E4 S3 R5 V3 · weakest: S, keep all community follow rules visible */
/* Hallmark · reworded privacy helper and followback label · preserve approval priority, existing followers and pending requests while removing repeated explanations */
/* Hallmark · reworded "button" to "button[type=submit]" · privacy form keeps its save action; the original implicit submit type is now explicit */
.privacy-settings { width: 100%; max-width: var(--settings-form-width); container: settings-preferences / inline-size; border-bottom: 0; padding-bottom: 0; }
.privacy-settings > form { gap: var(--settings-space-group); margin-top: var(--settings-space-group); }
.privacy-settings h2 { min-width: 0; overflow-wrap: break-word; text-wrap: balance; }
.privacy-fields { border: 0; margin: 0; padding: 0; display: grid; gap: 0; min-width: 0; }
.privacy-switch { display: flex; align-items: center; justify-content: space-between; gap: var(--settings-space-section); cursor: pointer; min-height: 64px; padding-block: var(--settings-space-row); border-bottom: 1px solid var(--border); }
.privacy-switch:last-child { border-bottom: 0; }
.privacy-switch input { appearance: none; position: relative; width: 40px; height: 24px; flex: none; margin: 0; background: var(--surface-soft); border: 1px solid var(--control-border); border-radius: 999px; cursor: pointer; }
.privacy-switch input:focus-visible, .privacy-settings .control:focus-visible, .privacy-settings button:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: var(--focus-outline-offset); }
.privacy-switch input:active { background: var(--surface); }
.privacy-switch input:disabled, .privacy-settings select:disabled, .privacy-settings button:disabled { opacity: .55; cursor: not-allowed; }
.privacy-switch input::before { content: ''; position: absolute; inset-block-start: 3px; inset-inline-start: 3px; width: 16px; height: 16px; border-radius: 50%; background: var(--ink); }
.privacy-switch input:checked { background: var(--blue); border-color: var(--blue); }
.privacy-switch input:checked::before { inset-inline-start: 19px; background: var(--action-ink); }
.privacy-switch span { display: grid; gap: var(--settings-space-label); min-width: 0; }
.privacy-switch strong { font-size: var(--font-size-field); line-height: var(--line-height-field); font-weight: 500; }
.privacy-switch small { color: var(--muted); font-size: 12px; line-height: 20px; }
.privacy-fields > .field { display: grid; grid-template-columns: minmax(0, 1fr) var(--settings-compact-control-width); align-items: center; gap: var(--settings-space-label) var(--settings-space-section); min-height: 60px; padding-block: var(--settings-space-row); border-bottom: 1px solid var(--border); }
.privacy-fields > .field:last-child { border-bottom: 0; }
.privacy-fields > .field .control { grid-column: 2; grid-row: 1 / span 2; align-self: center; }
.privacy-fields > .field:not(:has(small)) .control { grid-row: 1; }
.privacy-fields > .field small { grid-column: 1; font-size: var(--font-size-help); line-height: var(--line-height-help); margin: 0; }
.privacy-actions { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: var(--settings-space-group); padding-block: var(--settings-space-row); border-top: 1px solid var(--border); }
.privacy-actions > p { flex: 1 1 220px; max-width: 58ch; font-size: var(--font-size-help); line-height: var(--line-height-help); margin: 0; }
.privacy-actions > div { display: flex; flex-wrap: wrap; gap: var(--settings-space-related); margin-inline-start: auto; }
.privacy-actions button, select.control { min-height: var(--control-size, var(--control-height)); white-space: nowrap; }
.privacy-actions button.primary:disabled { background: var(--surface-soft); color: var(--muted); border-color: var(--border); }
@media (min-width: 1000px) and (hover: hover) and (pointer: fine) {
  .privacy-settings { --control-size: var(--control-height-compact); --control-font-size: var(--font-size-field); }
  .privacy-settings select { padding-block: var(--settings-space-label); }
  .privacy-switch { min-height: 60px; padding-block: var(--settings-space-related); }
  .privacy-fields > .field { min-height: 56px; padding-block: var(--settings-space-related); }
}
@media (any-pointer: coarse) {
  .privacy-settings { --control-size: var(--control-height); --control-font-size: var(--font-size-input); }
}
@container settings-preferences (max-width: 560px) {
  .privacy-settings > form { margin-top: var(--settings-space-group); }
  .privacy-fields > .field { grid-template-columns: minmax(0, 1fr); gap: var(--settings-space-label); padding-block: var(--settings-space-related); }
  .privacy-fields > .field .control { grid-column: auto; grid-row: auto; }
  .privacy-fields > .field:not(:has(small)) .control { grid-row: auto; }
  .privacy-fields > .field small { grid-row: 2; }
  .privacy-switch { gap: var(--settings-space-group); padding-block: var(--settings-space-related); }
  .privacy-visibility { grid-template-columns: repeat(2, minmax(0, 1fr)); column-gap: var(--settings-space-row); }
  .privacy-visibility > .field { align-content: start; border-bottom: 0; }
  .privacy-actions { gap: var(--settings-space-related); padding-block: var(--settings-space-row); }
}
@media (forced-colors: active) {
  .privacy-switch input { appearance: auto; }
  .privacy-switch input::before { display: none; }
}
</style>
