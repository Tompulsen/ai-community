<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { Copy, Download, KeyRound, LogOut, RefreshCw, ShieldCheck } from '@lucide/vue'
import { api, errorMessage, loadSession, notify } from '../state'

interface Security { hasPassword: boolean; twoFactorEnabled: boolean; recoveryCodesRemaining: number; emailReset: boolean }
interface Device { id: string; current: boolean; createdAt: string | null; ip: string | null; userAgent: string }
interface LoginRecord { id: string; ip: string | null; userAgent: string; date: string; success: boolean }
const security = ref<Security>()
const devices = ref<Device[]>([])
const logins = ref<LoginRecord[]>([])
const nextCursor = ref<string | null>(null)
const currentPassword = ref('')
const factor = ref('')
const password = ref('')
const repeated = ref('')
const setup = ref<{ secret: string; uri: string }>()
const setupCode = ref('')
const codes = ref<string[]>([])
const error = ref('')
const busy = ref(false)
const loading = ref(true)
const confirmAll = ref(false)
const date = (value: string | null) => value ? new Date(value).toLocaleString('zh-CN') : '已有会话'
async function load() {
  const [status, sessions, history] = await Promise.all([
    api<Security>('/api/security/status'),
    api<{ items: Device[] }>('/api/security/sessions'),
    api<{ items: LoginRecord[]; nextCursor: string | null }>('/api/security/logins'),
  ])
  security.value = status; devices.value = sessions.items; logins.value = history.items; nextCursor.value = history.nextCursor
}
onMounted(async () => { try { await load() } catch (cause) { error.value = errorMessage(cause) } finally { loading.value = false } })
async function execute(action: string, extra: Record<string, unknown> = {}) {
  if (busy.value) return
  if (action === 'password' && (password.value !== repeated.value || password.value.length < 8)) {
    error.value = '两次新密码需一致，且至少 8 个字符。'; return
  }
  busy.value = true; error.value = ''
  try {
    const result = await api<{ secret?: string; uri?: string; recoveryCodes?: string[]; signedOut?: boolean }>(`/api/security/${action}`, {
      method: 'POST', body: { password: currentPassword.value, token: factor.value.trim(), ...extra },
    })
    if (result.secret && result.uri) setup.value = { secret: result.secret, uri: result.uri }
    else {
      if (action.startsWith('mfa/')) setup.value = undefined
      codes.value = result.recoveryCodes || []
    }
    currentPassword.value = ''; factor.value = ''; setupCode.value = ''; password.value = ''; repeated.value = ''; confirmAll.value = false
    if (result.signedOut) { await loadSession(true); notify('会话已撤销。'); return }
    await loadSession(true)
    await load()
    notify(action === 'mfa/setup' ? '验证器密钥已生成，请输入验证码完成启用。' : '安全设置已更新。')
  } catch (cause) { error.value = errorMessage(cause) } finally { busy.value = false }
}
async function moreLogins() {
  if (!nextCursor.value || busy.value) return
  busy.value = true; error.value = ''
  try {
    const result = await api<{ items: LoginRecord[]; nextCursor: string | null }>(`/api/security/logins?cursor=${encodeURIComponent(nextCursor.value)}`)
    logins.value.push(...result.items); nextCursor.value = result.nextCursor
  } catch (cause) { error.value = errorMessage(cause) } finally { busy.value = false }
}
async function copy(value: string) {
  try { await navigator.clipboard.writeText(value); notify('已复制。') } catch { error.value = '复制未完成，请选中内容复制。' }
}
function downloadCodes() {
  const url = URL.createObjectURL(new Blob([codes.value.join('\n')], { type: 'text/plain;charset=utf-8' }))
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'community-recovery-codes.txt'; anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
</script>

<template>
  <div class="security-settings">
    <p v-if="error" class="notice-inline" role="alert">{{ error }}</p>
    <div v-if="loading" class="empty-state" role="status">正在加载安全设置…</div>
    <template v-else-if="security">
      <section class="panel-section stack">
        <div class="section-heading"><h2>身份验证</h2><ShieldCheck :size="18" /></div>
        <label class="field"><span>当前社区密码</span><input v-model="currentPassword" class="control" type="password" autocomplete="current-password" :disabled="busy" /></label>
        <label v-if="security.twoFactorEnabled" class="field"><span>二步验证码或恢复码</span><input v-model="factor" class="control" autocomplete="one-time-code" :disabled="busy" /></label>
        <p v-if="!security.hasPassword" class="muted">此账号尚未设置社区密码，请通过已验证邮箱重置或联系管理员。</p>
      </section>
      <section class="panel-section">
        <h2>修改密码</h2>
        <form class="stack" @submit.prevent="execute('password', { newPassword: password })">
          <label class="field"><span>新密码</span><input v-model="password" class="control" type="password" autocomplete="new-password" minlength="8" required :disabled="busy" /></label>
          <label class="field"><span>再次输入新密码</span><input v-model="repeated" class="control" type="password" autocomplete="new-password" minlength="8" required :disabled="busy" /></label>
          <button class="button primary" :disabled="busy || !currentPassword || !password || !repeated"><KeyRound :size="16" />修改密码</button>
        </form>
      </section>
      <section class="panel-section stack">
        <div class="section-heading"><h2>二步验证</h2><span class="status" :class="{ pending: !security.twoFactorEnabled }">{{ security.twoFactorEnabled ? '已启用' : '未启用' }}</span></div>
        <template v-if="setup">
          <label class="field"><span>验证器密钥</span><input :value="setup.secret" class="control secret" readonly autocomplete="off" /></label>
          <div class="security-actions"><button class="button" :disabled="busy" @click="copy(setup.secret)"><Copy :size="16" />复制密钥</button><a :href="setup.uri" class="button">在验证器中打开</a></div>
          <form class="stack" @submit.prevent="execute('mfa/confirm', { token: setupCode.trim() })">
            <label class="field"><span>验证器中的 6 位验证码</span><input v-model="setupCode" class="control" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required :disabled="busy" /></label>
            <button class="button primary" :disabled="busy || setupCode.length !== 6"><ShieldCheck :size="16" />确认启用</button>
          </form>
        </template>
        <button v-else-if="!security.twoFactorEnabled" class="button" :disabled="busy || !currentPassword" @click="execute('mfa/setup')"><ShieldCheck :size="16" />设置二步验证</button>
        <template v-else>
          <p class="muted">剩余恢复码 {{ security.recoveryCodesRemaining }} 个。</p>
          <div class="security-actions"><button class="button" :disabled="busy || !currentPassword || !factor" @click="execute('mfa/recovery')"><RefreshCw :size="16" />重新生成恢复码</button><button class="button" :disabled="busy || !currentPassword || !factor" @click="execute('mfa/disable')">停用二步验证</button></div>
        </template>
        <div v-if="codes.length" class="recovery-codes stack" role="status">
          <p>恢复码仅显示一次，每个只能使用一次，请妥善保存。</p>
          <pre class="secret">{{ codes.join('\n') }}</pre>
          <div class="security-actions"><button class="button" @click="copy(codes.join('\n'))"><Copy :size="16" />复制</button><button class="button" @click="downloadCodes"><Download :size="16" />下载恢复码</button><button class="button subtle" @click="codes = []">我已保存</button></div>
        </div>
      </section>
      <section class="panel-section stack">
        <h2>登录会话</h2>
        <div v-for="device in devices" :key="device.id" class="device-row">
          <div><strong>{{ device.current ? '当前设备' : '其他设备' }}</strong><p class="caption-5 muted">{{ device.userAgent || '已有登录设备' }}</p><p class="caption-5 muted">{{ date(device.createdAt) }} · {{ device.ip || '来源未记录' }}</p></div>
          <button class="icon-button" :aria-label="device.current ? '退出当前会话' : '撤销此会话'" :title="device.current ? '退出当前会话' : '撤销此会话'" :disabled="busy || !currentPassword || (security.twoFactorEnabled && !factor)" @click="execute('sessions/revoke', { id: device.id })"><LogOut :size="17" /></button>
        </div>
        <button v-if="!confirmAll" class="button" :disabled="busy || !currentPassword || (security.twoFactorEnabled && !factor)" @click="confirmAll = true"><LogOut :size="16" />退出所有设备并重置登录凭证</button>
        <div v-else class="stack"><p>所有社区会话、旧登录令牌和创作授权将失效，需要重新登录。</p><div class="security-actions"><button class="button primary" :disabled="busy" @click="execute('sessions/revoke', { all: true })">确认退出所有设备</button><button class="button" :disabled="busy" @click="confirmAll = false">取消</button></div></div>
      </section>
      <section class="panel-section stack">
        <h2>登录历史</h2>
        <p v-if="!logins.length" class="muted">暂无登录记录。</p>
        <div v-for="record in logins" :key="record.id" class="device-row"><div><strong>{{ date(record.date) }}</strong><p class="caption-5 muted">{{ record.ip || '来源未记录' }} · {{ record.success ? '登录成功' : '登录失败' }}</p><p class="caption-5 muted">{{ record.userAgent || '设备信息未记录' }}</p></div></div>
        <button v-if="nextCursor" class="button" :disabled="busy" @click="moreLogins">加载更多</button>
      </section>
    </template>
    <button v-else class="button" @click="load().catch(cause => error = errorMessage(cause))">重新加载</button>
  </div>
</template>

<style scoped>
.security-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.security-actions .button { flex: 0 1 auto; }
.device-row { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; padding: 12px 0; border-bottom: 1px solid var(--border); }
.device-row > div { min-width: 0; overflow-wrap: anywhere; }
.device-row .icon-button { flex: 0 0 40px; }
.device-row p { margin-top: 4px; }
.secret { overflow-wrap: anywhere; white-space: pre-wrap; font-family: monospace; letter-spacing: 0; user-select: text; }
.recovery-codes { padding: 16px; background: var(--surface-soft); }
</style>
