<script setup lang="ts">
import { computed, onBeforeUnmount, ref, useId } from 'vue'
import { RefreshCw, Save } from '@lucide/vue'
import { api, errorMessage, notify, session } from '../state'
import { IMAGE_CONCURRENCY_GLOBAL_MAX, IMAGE_CONCURRENCY_USER_MAX, type ImageConcurrencyConfig, type UserImageConcurrencyConfig } from '../../shared/studio/image-concurrency'

const props = defineProps<{ userId?: string; confirmLeave: () => boolean | Promise<boolean> }>()
const config = ref<ImageConcurrencyConfig | UserImageConcurrencyConfig>()
const defaultLimit = ref<string | number>(''), globalLimit = ref<string | number>(''), overrideLimit = ref<string | number>(''), mode = ref('default')
const loading = ref(false), saving = ref(false), error = ref(''), showValidation = ref(false)
const owner = session.user?.id, account = session.user?.accountId, controller = new AbortController(), id = useId()
let active = true, revision = 0
const isCurrent = () => active && session.user?.id === owner && session.user?.accountId === account && !!session.user?.isAdmin
const endpoint = props.userId ? `/api/admin/users/${encodeURIComponent(props.userId)}/image-concurrency` : '/api/admin/creation/image-concurrency'
const userConfig = computed(() => config.value && 'userId' in config.value ? config.value : undefined)
const canEdit = computed(() => !!config.value && (!props.userId || userConfig.value?.canEdit === true))
const limit = (value: string | number, maximum: number) => String(value).trim() !== '' && Number.isInteger(Number(value)) && Number(value) >= 1 && Number(value) <= maximum
const defaultError = computed(() => !limit(defaultLimit.value, IMAGE_CONCURRENCY_USER_MAX) ? `请输入 1–${IMAGE_CONCURRENCY_USER_MAX} 的整数。` : '')
const globalError = computed(() => !limit(globalLimit.value, IMAGE_CONCURRENCY_GLOBAL_MAX) ? `请输入 1–${IMAGE_CONCURRENCY_GLOBAL_MAX} 的整数。` : '')
const overrideError = computed(() => mode.value === 'default' ? '' : !limit(overrideLimit.value, IMAGE_CONCURRENCY_USER_MAX) ? `请输入 1–${IMAGE_CONCURRENCY_USER_MAX} 的整数。` : '')
const hasUnsavedChanges = computed(() => canEdit.value && (props.userId
  ? (mode.value === 'default' ? null : Number(overrideLimit.value)) !== userConfig.value?.overrideLimit
  : Number(defaultLimit.value) !== config.value?.defaultLimit || Number(globalLimit.value) !== config.value?.globalLimit))
const busy = computed(() => loading.value || saving.value)
defineExpose({ hasUnsavedChanges, busy })

function apply(value: ImageConcurrencyConfig | UserImageConcurrencyConfig) {
  if (!Number.isInteger(value.defaultLimit) || !Number.isInteger(value.globalLimit) || typeof value.version !== 'string'
    || props.userId && (!('userId' in value) || value.userId !== props.userId || typeof value.canEdit !== 'boolean')) throw new Error('并发设置响应无效，请重新读取。')
  config.value = value
  defaultLimit.value = String(value.defaultLimit); globalLimit.value = String(value.globalLimit)
  if ('overrideLimit' in value) { mode.value = value.overrideLimit === null ? 'default' : 'override'; overrideLimit.value = String(value.overrideLimit ?? value.defaultLimit) }
  showValidation.value = false
}
async function load() {
  if (busy.value || !isCurrent()) return
  if (hasUnsavedChanges.value && !await props.confirmLeave()) return
  if (!isCurrent()) return
  const current = ++revision
  loading.value = true; error.value = ''
  try {
    const value = await api<ImageConcurrencyConfig | UserImageConcurrencyConfig>(endpoint, { expectedAccount: owner, signal: controller.signal })
    if (isCurrent() && current === revision) apply(value)
  } catch (cause) { if (isCurrent() && current === revision) error.value = errorMessage(cause) }
  finally { if (isCurrent() && current === revision) loading.value = false }
}
async function save() {
  if (busy.value || !canEdit.value || !isCurrent() || !hasUnsavedChanges.value) return
  showValidation.value = true; error.value = ''
  if (props.userId ? overrideError.value : defaultError.value || globalError.value) return
  const current = ++revision
  saving.value = true
  try {
    const body = props.userId ? { overrideLimit: mode.value === 'default' ? null : Number(overrideLimit.value), version: config.value!.version }
      : { defaultLimit: Number(defaultLimit.value), globalLimit: Number(globalLimit.value), version: config.value!.version }
    const value = await api<ImageConcurrencyConfig | UserImageConcurrencyConfig>(endpoint, { method: 'PATCH', expectedAccount: owner, signal: controller.signal, body })
    if (!isCurrent() || current !== revision) return
    apply(value); notify(props.userId ? '此用户的图片生成并发设置已保存。' : '图片生成并发设置已保存。')
  } catch (cause) { if (isCurrent() && current === revision) error.value = `${errorMessage(cause)} 你的输入仍保留，可重新读取后核对。` }
  finally { if (isCurrent() && current === revision) saving.value = false }
}
function toggle(event: Event) { if ((event.target as HTMLDetailsElement).open && !config.value && !busy.value) void load() }
onBeforeUnmount(() => { active = false; revision++; controller.abort() })
</script>

<template>
  <details class="image-concurrency" @toggle="toggle">
    <summary>{{ userId ? '此用户的图片生成并发' : '图片生成并发设置' }}</summary>
    <div class="concurrency-content">
      <p :id="`${id}-help`" class="form-note">用户按同时生成的图片张数计数，社区按请求数计数；一次请求可包含多张图。</p>
      <p v-if="loading" class="form-note" role="status">正在读取并发设置…</p>
      <form v-if="config" class="concurrency-form" :aria-label="userId ? '用户图片生成并发' : '默认图片生成并发'" novalidate @submit.prevent="save">
        <template v-if="!userId">
          <div class="concurrency-fields">
            <label class="field"><span :id="`${id}-default-label`">默认用户同时生成图片数</span><input v-model="defaultLimit" class="control" type="number" inputmode="numeric" min="1" :max="IMAGE_CONCURRENCY_USER_MAX" step="1" required :disabled="busy" :aria-labelledby="`${id}-default-label`" :aria-invalid="showValidation && !!defaultError" :aria-describedby="`${id}-default-error ${id}-help`" @blur="showValidation = true" /><span :id="`${id}-default-error`" class="form-error">{{ showValidation ? defaultError : '' }}</span></label>
            <label class="field"><span :id="`${id}-global-label`">社区同时接纳的图片请求数</span><input v-model="globalLimit" class="control" type="number" inputmode="numeric" min="1" :max="IMAGE_CONCURRENCY_GLOBAL_MAX" step="1" required :disabled="busy" :aria-labelledby="`${id}-global-label`" :aria-invalid="showValidation && !!globalError" :aria-describedby="`${id}-global-error ${id}-global-help`" @blur="showValidation = true" /><span :id="`${id}-global-error`" class="form-error">{{ showValidation ? globalError : '' }}</span></label>
          </div>
        </template>
        <template v-else-if="userConfig">
          <p class="concurrency-effective" role="status">当前生效：同时生成 <strong>{{ userConfig.effectiveLimit }}</strong> 张图片<span>默认 {{ userConfig.defaultLimit }} 张 · 社区 {{ userConfig.globalLimit }} 个请求</span></p>
          <div v-if="canEdit" class="concurrency-fields">
            <label class="field"><span :id="`${id}-mode-label`">并发设置方式</span><select v-model="mode" class="control" :disabled="busy" :aria-labelledby="`${id}-mode-label`"><option value="default">使用默认值（{{ userConfig.defaultLimit }} 张）</option><option value="override">单独设置此用户</option></select></label>
            <label v-if="mode === 'override'" class="field"><span :id="`${id}-override-label`">此用户同时生成图片数</span><input v-model="overrideLimit" class="control" type="number" inputmode="numeric" min="1" :max="IMAGE_CONCURRENCY_USER_MAX" step="1" required :disabled="busy" :aria-labelledby="`${id}-override-label`" :aria-invalid="showValidation && !!overrideError" :aria-describedby="`${id}-override-error ${id}-help`" @blur="showValidation = true" /><span :id="`${id}-override-error`" class="form-error">{{ showValidation ? overrideError : '' }}</span></label>
          </div>
          <p v-else class="form-note">此账号的并发设置仅供查看，不能在当前社区修改。</p>
        </template>
        <p :id="`${id}-global-help`" class="form-note">任务结束后释放名额；结果待确认时保留至查明结果或超时。更改仅影响后续请求。</p>
        <p v-if="error" class="form-error" role="alert">{{ error }}</p>
        <div class="concurrency-actions"><button v-if="canEdit" class="button primary btn" :disabled="busy || !hasUnsavedChanges"><Save :size="16" aria-hidden="true" />{{ saving ? '正在保存…' : userId ? '保存用户并发' : '保存默认与社区并发' }}</button><button type="button" class="button subtle btn" :disabled="busy" @click="load"><RefreshCw :size="16" aria-hidden="true" />重新读取并发设置</button></div>
      </form>
      <div v-else-if="error"><p class="form-error" role="alert">{{ error }}</p><button class="button subtle btn" :disabled="busy" @click="load">重新读取并发设置</button></div>
    </div>
  </details>
</template>

<style scoped>
.image-concurrency { margin-block: 24px; border-block: 1px solid var(--border); }
.image-concurrency summary { min-height: 44px; padding: 16px 0; color: var(--ink); cursor: pointer; font-size: 14px; font-weight: 600; }
.concurrency-content, .concurrency-form { display: grid; gap: 16px; min-width: 0; }
.concurrency-content { padding-bottom: 20px; }
.concurrency-fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
.concurrency-fields > *, .control { min-width: 0; }
.control, .button { min-height: 44px; }
.concurrency-actions { display: flex; flex-wrap: wrap; gap: 12px; }
.concurrency-effective { font-size: 14px; line-height: 1.7; }
.concurrency-effective span { display: block; color: var(--muted); }
.form-error, .form-note { overflow-wrap: anywhere; }
.form-error:empty { display: none; }
@media (max-width: 639px) { .concurrency-fields { grid-template-columns: minmax(0, 1fr); }.concurrency-actions > .button { width: 100%; }.control { font-size: 16px; } }
</style>
