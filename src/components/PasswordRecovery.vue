<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { KeyRound, Mail } from '@lucide/vue'
import { api, errorMessage, loadSession } from '../state'
const route = useRoute(), router = useRouter()
const props = defineProps<{ resetToken?: string }>()
const emit = defineEmits<{ done: [] }>()
const available = ref(false), checked = ref(false), email = ref(''), password = ref(''), repeated = ref(''), factor = ref(''), error = ref(''), message = ref(''), busy = ref(false)
onMounted(async () => {
  try { available.value = (await api<{ emailReset: boolean }>('/api/security/capabilities')).emailReset }
  catch (cause) { error.value = errorMessage(cause) } finally { checked.value = true }
  if (props.resetToken) await router.replace({ path: route.path, query: { ...route.query, reset: undefined } })
})
async function submit() {
  if (busy.value) return
  if (props.resetToken && (password.value !== repeated.value || password.value.length < 8)) { error.value = '两次新密码需一致，且至少 8 个字符。'; return }
  busy.value = true; error.value = ''; message.value = ''
  try {
    const result = await api<{ message?: string }>(`/api/security/password/${props.resetToken ? 'reset' : 'forgot'}`, { method: 'POST', body: props.resetToken
      ? { resetToken: props.resetToken, newPassword: password.value, token: factor.value.trim() } : { email: email.value.trim() } })
    password.value = ''; repeated.value = ''; factor.value = ''
    message.value = result.message || '社区密码已重置，请重新登录。'
    if (props.resetToken) await loadSession(true)
  } catch (cause) { error.value = errorMessage(cause) } finally { busy.value = false }
}
</script>
<template>
  <section class="panel-section stack password-recovery">
    <h2>{{ resetToken ? '重置社区密码' : '找回社区密码' }}</h2>
    <p v-if="error" class="notice-inline" role="alert">{{ error }}</p>
    <p v-if="message" class="notice-inline" role="status">{{ message }}</p>
    <button v-if="resetToken && message" class="button btn" @click="emit('done')">返回登录</button>
    <p v-if="!checked" class="muted">正在加载…</p>
    <form v-else-if="resetToken || available" class="stack" @submit.prevent="submit">
      <template v-if="resetToken">
        <label class="field"><span>新密码</span><input v-model="password" type="password" class="control" autocomplete="new-password" minlength="8" required :disabled="busy" /></label>
        <label class="field"><span>再次输入新密码</span><input v-model="repeated" type="password" class="control" autocomplete="new-password" minlength="8" required :disabled="busy" /></label>
        <label class="field"><span>二步验证码或恢复码（如已启用）</span><input v-model="factor" class="control" autocomplete="one-time-code" :disabled="busy" /></label>
      </template>
      <label v-else class="field"><span>已验证邮箱</span><input v-model="email" type="email" class="control" autocomplete="email" required :disabled="busy" /></label>
      <button class="button primary btn" :disabled="busy"><KeyRound v-if="resetToken" :size="16" /><Mail v-else :size="16" />{{ busy ? '正在提交…' : resetToken ? '重置密码' : '申请重置邮件' }}</button>
    </form>
    <p v-else class="muted">本站尚未配置发信服务，请使用章鱼账号登录、前往章鱼账户中心或联系管理员恢复社区密码。</p>
  </section>
</template>

<style scoped>
.password-recovery { max-width: 640px; padding-block: 24px 32px; gap: 24px; }
.password-recovery h2 { font-size: 18px; line-height: 28px; }
.password-recovery > form { margin-top: 0; gap: 24px; }
.password-recovery > form > .button, .password-recovery > .button { align-self: flex-start; min-width: 144px; }
.password-recovery > .notice-inline { margin: 0; color: var(--ink); }
.password-recovery > .muted { font-size: 14px; line-height: 24px; max-width: 56ch; }
@media (max-width: 639px) { .password-recovery > form > .button, .password-recovery > .button { width: 100%; } }
</style>
