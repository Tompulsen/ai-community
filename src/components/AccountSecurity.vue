<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ArrowUpRight, LogOut, Monitor, ShieldCheck } from '@lucide/vue'
import { accountCenterUrl, accountApi, api, errorMessage, logout, notify, session, type LoginIdentifiers } from '../state'

interface Security { external: boolean; accountUrl?: string }
interface Device { id: string; current: boolean; createdAt: string | null; ip: string | null; userAgent: string }
interface LoginRecord { id: string; ip: string | null; userAgent: string; date: string; success: boolean }
const security = ref<Security>()
const identifiers = ref<LoginIdentifiers | null>(null)
const identifiersError = ref('')
let active = true, identifiersVersion = 0
async function loadIdentifiers() {
  const owner = session.user?.accountId, version = ++identifiersVersion
  identifiers.value = null; identifiersError.value = ''
  if (!owner) return
  try {
    const value = await accountApi<LoginIdentifiers>('login-identifiers', undefined, owner)
    if (active && version === identifiersVersion && session.user?.accountId === owner) identifiers.value = value
  } catch (cause) {
    if (active && version === identifiersVersion) identifiersError.value = errorMessage(cause)
  }
}
watch(() => session.user?.accountId, loadIdentifiers, { immediate: true })
onBeforeUnmount(() => { active = false; identifiersVersion++ })
const devices = ref<Device[]>([])
const logins = ref<LoginRecord[]>([])
const nextCursor = ref<string | null>(null)
const error = ref('')
const busy = ref(false)
const loading = ref(true)
const centerUrl = computed(() => accountCenterUrl())
const date = (value: string | null) => value ? new Date(value).toLocaleString('zh-CN') : '已有会话'
async function load() {
  const [status, sessions, history] = await Promise.all([
    api<Security>('/api/security/status'),
    api<{ items: Device[] }>('/api/security/sessions'),
    api<{ items: LoginRecord[]; nextCursor: string | null }>('/api/security/logins'),
  ])
  security.value = status; devices.value = sessions.items; logins.value = history.items; nextCursor.value = history.nextCursor
  if (status.accountUrl) session.accountUrl = status.accountUrl
}
onMounted(async () => { try { await load() } catch (cause) { error.value = errorMessage(cause) } finally { loading.value = false } })
async function signOut() {
  if (busy.value) return
  busy.value = true; error.value = ''
  try {
    await logout()
    notify('已退出当前设备。')
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
</script>

<template>
  <div class="security-settings">
    <p v-if="error" class="notice-inline" role="alert">{{ error }}</p>
    <div v-if="loading" class="empty-state" role="status">正在加载安全设置…</div>
    <template v-else-if="security">
      <section class="panel-section security-identity stack">
        <div class="section-heading"><h2>章鱼账号安全</h2><ShieldCheck :size="18" /></div>
        <p class="muted">密码、邮箱及账号验证统一在章鱼账户中心管理。</p>
        <dl v-if="identifiers" class="login-identifiers"><dt>统一账号</dt><dd>{{ identifiers.username }}</dd><dt>邮箱</dt><dd>{{ identifiers.email || '未绑定' }}</dd><dt>可用登录名</dt><dd><span v-for="value in identifiers.login_identifiers" :key="value">{{ value }}</span><span v-if="!identifiers.login_identifiers.length">暂无唯一登录名，请前往账户中心处理。</span></dd></dl>
        <div v-else-if="identifiersError" class="stack"><p class="notice-inline" role="alert">{{ identifiersError }}</p><button class="text-link" type="button" @click="loadIdentifiers">重新加载登录名</button></div>
        <a v-if="centerUrl" :href="centerUrl" class="button btn" target="_blank" rel="noopener noreferrer">管理章鱼账号<ArrowUpRight :size="16" /></a>
      </section>
      <section class="panel-section stack security-sessions">
        <h2>登录会话</h2>
        <div v-for="device in devices" :key="device.id" class="device-row">
          <Monitor :size="20" aria-hidden="true" />
          <div><strong>{{ device.current ? '当前设备' : '其他设备' }}</strong><p class="caption-5 muted">{{ device.userAgent || '已有登录设备' }}</p><p class="caption-5 muted">{{ date(device.createdAt) }} · {{ device.ip || '来源未记录' }}</p></div>
          <span v-if="device.current" class="device-current">当前</span>
        </div>
        <button type="button" class="button btn" :disabled="busy" @click="signOut"><LogOut :size="16" />退出当前设备</button>
      </section>
      <section class="panel-section stack security-history">
        <h2>登录历史</h2>
        <p v-if="!logins.length" class="muted">暂无登录记录。</p>
        <div v-for="record in logins" :key="record.id" class="device-row"><div><strong>{{ date(record.date) }}</strong><p class="caption-5 muted">{{ record.ip || '来源未记录' }} · {{ record.success ? '登录成功' : '登录失败' }}</p><p class="caption-5 muted">{{ record.userAgent || '设备信息未记录' }}</p></div></div>
        <button v-if="nextCursor" class="button btn" :disabled="busy" @click="moreLogins">加载更多</button>
      </section>
    </template>
    <button v-else class="button btn" @click="load().catch(cause => error = errorMessage(cause))">重新加载</button>
  </div>
</template>

<style scoped>
/* Hallmark · shape: app screen · genre: modern-minimal · theme: brand · redesign: full · signature: identity and device ledger · v2.0.0 */
/* Hallmark · pre-emit critique: P4 H4 E4 S3 R5 V3 · weakest: S, keep the verified identity beside actual device records */
.login-identifiers { display: grid; grid-template-columns: 96px minmax(0, 1fr); gap: var(--settings-space-group) var(--settings-space-section); overflow-wrap: anywhere; margin: 0; padding-block: var(--settings-space-group); border-block: 1px solid var(--border); }
.login-identifiers dt { color: var(--muted); }
.login-identifiers dd { margin: 0; display: grid; gap: var(--settings-space-label); }
.security-settings { display: grid; grid-template-columns: minmax(0, 1fr); gap: var(--settings-space-section); align-items: start; }
.security-settings > .notice-inline, .security-settings > .empty-state, .security-identity, .security-sessions, .security-history { grid-column: 1 / -1; }
.security-settings .panel-section { padding-bottom: var(--settings-space-group); }
.security-settings .panel-section + .panel-section { border-top: 1px solid var(--border); padding-top: var(--settings-space-section); }
.security-settings .stack { gap: var(--settings-space-row); }
.security-settings h2 { font-size: 16px; line-height: 24px; min-width: 0; overflow-wrap: break-word; text-wrap: balance; }
.security-identity > .section-heading { margin: 0; }
.security-identity > .button { align-self: flex-start; }
.security-actions { display: flex; flex-wrap: wrap; gap: var(--settings-space-related); align-items: center; }
.security-actions .button { flex: 0 1 auto; }
.device-row { display: flex; align-items: flex-start; gap: var(--settings-space-row); padding-block: var(--settings-space-row); border-bottom: 1px solid var(--border); }
.device-row > svg { color: var(--muted); margin-top: var(--settings-space-label); }
.device-row strong { font-weight: 500; font-size: 14px; }
.device-current { margin-inline-start: auto; padding: var(--settings-space-label) var(--settings-space-related); border-radius: 4px; background: var(--surface-soft); color: var(--muted); font-size: 12px; flex: none; }
.device-row:last-of-type { border-bottom: 0; }
.device-row > div { min-width: 0; overflow-wrap: anywhere; }
.device-row .icon-button { flex: 0 0 44px; width: 44px; height: 44px; }
.device-row p { margin-top: var(--settings-space-label); }
.security-sessions > .button, .security-history > .button { align-self: flex-start; }
.security-settings .button { white-space: nowrap; }
.security-settings .button:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: var(--focus-outline-offset); }
.security-settings .button:active { background: var(--surface-soft); }
.security-settings .button:disabled { opacity: .55; cursor: not-allowed; }
@media (min-width: 1280px) {
  .security-settings { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); column-gap: var(--settings-space-layout); }
  .security-settings .security-identity { grid-column: 1; grid-row: span 2; padding-inline-end: var(--settings-space-layout); border-inline-end: 1px solid var(--border); }
  .security-settings .security-sessions, .security-settings .security-history { grid-column: 2; }
  .security-settings .security-sessions { border-top: 0; }
}
@media (max-width: 639px) { .security-actions .button { flex: 1 1 auto; } }
@media (max-width: 399px) { .login-identifiers { grid-template-columns: 80px minmax(0, 1fr); gap: var(--settings-space-row) var(--settings-space-group); } }
</style>
