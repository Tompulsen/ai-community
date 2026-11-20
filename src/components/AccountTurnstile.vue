<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { RefreshCw } from '@lucide/vue'
import { loadTurnstile, TurnstileLoadError, type TurnstileApi } from '../turnstile'

const props = defineProps<{ siteKey: string; resetKey: number; disabled?: boolean; action?: string }>()
const emit = defineEmits<{ token: [value: string] }>()
const container = ref<HTMLElement>()
const failure = ref<{ code: string; message: string }>()
let sdk: TurnstileApi | undefined, widget: string | undefined, generation = 0
let waitTimer: number | undefined, startedAt = 0
function remove() {
  window.clearTimeout(waitTimer)
  if (widget !== undefined && sdk) sdk.remove(widget)
  widget = undefined
}
function reportFailure(current: number, stage: 'sdk' | 'challenge', code: string, message: string) {
  if (current !== generation) return
  window.clearTimeout(waitTimer)
  emit('token', '')
  if (failure.value?.code === code) return
  failure.value = { code, message }
  console.warn('[AccountTurnstile]', { stage, code, hostname: window.location.hostname, elapsedMs: Math.round(performance.now() - startedAt) })
}
async function render() {
  const current = ++generation
  remove(); emit('token', ''); failure.value = undefined; startedAt = performance.now()
  try {
    const api = await loadTurnstile()
    if (current !== generation || !container.value) return
    sdk = api
    waitTimer = window.setTimeout(() => reportFailure(current, 'challenge', 'CHALLENGE_TIMEOUT', '验证等待时间较长，请重新验证；若仍失败，请检查网络连接。'), 30_000)
    widget = api.render(container.value, {
      sitekey: props.siteKey, theme: 'auto', size: 'flexible',
      ...(props.action ? { action: props.action } : {}),
      callback: token => {
        if (current !== generation) return
        window.clearTimeout(waitTimer)
        failure.value = undefined
        emit('token', token)
      },
      'expired-callback': () => reportFailure(current, 'challenge', 'TOKEN_EXPIRED', '验证已过期，请重新验证。'),
      'timeout-callback': () => reportFailure(current, 'challenge', 'INTERACTION_TIMEOUT', '验证已超时，请重新验证。'),
      'error-callback': value => {
        const code = value && /^\d{6}$/.test(value) ? value : 'CHALLENGE_ERROR'
        const message = ['110100', '110110', '110200', '400020', '400021', '400070'].includes(code)
          ? '人机验证配置异常，请联系管理员。'
          : ['110600', '110620'].includes(code) ? '验证已超时，请重新验证。'
            : code === '200500' ? '验证连接失败，请检查网络后重新验证。'
              : '人机验证暂时不可用，请重新验证。'
        reportFailure(current, 'challenge', code, message)
      },
    })
  } catch (cause) {
    reportFailure(current, cause instanceof TurnstileLoadError ? 'sdk' : 'challenge',
      cause instanceof TurnstileLoadError ? cause.code : 'WIDGET_RENDER_FAILED',
      '人机验证加载失败，请检查网络后重新验证。')
  }
}
onMounted(render)
watch(() => [props.siteKey, props.resetKey, props.action], render)
onBeforeUnmount(() => { generation++; remove() })
</script>

<template>
  <div class="account-verification" aria-label="账号人机验证">
    <div ref="container" class="verification-widget"></div>
    <div v-if="failure" class="verification-feedback">
      <div role="status"><p>{{ failure.message }}</p><p class="verification-code">错误码：{{ failure.code }}</p></div>
      <button type="button" class="button subtle btn" :disabled="disabled" @click="render"><RefreshCw :size="16" aria-hidden="true" />重新验证</button>
    </div>
  </div>
</template>

<style scoped>
.account-verification { width: 100%; min-width: 0; min-height: 65px; }
.verification-widget { min-height: 65px; }
.verification-feedback { display: grid; gap: 8px; margin-top: 12px; color: var(--muted); font-size: 14px; line-height: 20px; overflow-wrap: anywhere; }
.verification-feedback p { margin: 0; }
.verification-feedback .verification-code { margin-top: 4px; font-size: 12px; }
.verification-feedback .button { justify-self: start; min-height: 44px; }
</style>
