<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { loadTurnstile, type TurnstileApi } from '../turnstile'

const props = defineProps<{ siteKey: string; resetKey: number }>()
const emit = defineEmits<{ token: [value: string]; error: [message: string] }>()
const container = ref<HTMLElement>()
let sdk: TurnstileApi | undefined, widget: string | undefined, generation = 0
function remove() { if (widget && sdk) sdk.remove(widget); widget = undefined }
async function render() {
  const current = ++generation
  remove(); emit('token', '')
  try {
    const api = await loadTurnstile()
    if (current !== generation || !container.value) return
    sdk = api
    widget = api.render(container.value, {
      sitekey: props.siteKey, theme: 'auto', size: 'flexible',
      callback: token => { if (current === generation) emit('token', token) },
      'expired-callback': () => emit('token', ''),
      'timeout-callback': () => emit('token', ''),
      'error-callback': () => { emit('token', ''); emit('error', '人机验证暂时不可用，请重试或前往章鱼账户中心。') },
    })
  } catch { if (current === generation) emit('error', '人机验证加载失败，请检查网络后重试。') }
}
onMounted(render)
watch(() => [props.siteKey, props.resetKey], render)
onBeforeUnmount(() => { generation++; remove() })
</script>

<template>
  <div ref="container" class="account-verification" aria-label="账号人机验证"></div>
</template>

<style scoped>
.account-verification { width: 100%; min-width: 0; min-height: 65px; }
</style>
