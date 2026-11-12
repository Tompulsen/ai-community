<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ArrowUpRight, LogOut, ShieldCheck } from '@lucide/vue'
import { accountCenterUrl, api, errorMessage, logout, notify, session } from '../state'

interface Security { external: boolean; accountUrl?: string }
interface Device { id: string; current: boolean; createdAt: string | null; ip: string | null; userAgent: string }
interface LoginRecord { id: string; ip: string | null; userAgent: string; date: string; success: boolean }
const security = ref<Security>()
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
        <a v-if="centerUrl" :href="centerUrl" class="button btn" target="_blank" rel="noopener noreferrer">管理章鱼账号<ArrowUpRight :size="16" /></a>
      </section>
      <section class="panel-section stack security-sessions">
        <h2>登录会话</h2>
        <div v-for="device in devices" :key="device.id" class="device-row">
          <div><strong>{{ device.current ? '当前设备' : '其他设备' }}</strong><p class="caption-5 muted">{{ device.userAgent || '已有登录设备' }}</p><p class="caption-5 muted">{{ date(device.createdAt) }} · {{ device.ip || '来源未记录' }}</p></div>
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
.security-settings { display: grid; grid-template-columns: minmax(0, 1fr); gap: 32px; align-items: start; }
.security-settings > .notice-inline, .security-settings > .empty-state, .security-identity, .security-sessions, .security-history { grid-column: 1 / -1; }
.security-settings .panel-section { padding: 0 0 32px; }
.security-settings .stack { gap: 16px; }
.security-settings h2 { font-size: 18px; line-height: 28px; }
.security-identity > .section-heading { margin: 0; }
.security-identity > .button { align-self: flex-start; }
.security-actions { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.security-actions .button { flex: 0 1 auto; }
.device-row { display: flex; align-items: flex-start; justify-content: space-between; gap: 24px; padding: 16px 0; border-bottom: 1px solid var(--border); }
.device-row:last-of-type { border-bottom: 0; }
.device-row > div { min-width: 0; overflow-wrap: anywhere; }
.device-row .icon-button { flex: 0 0 44px; width: 44px; height: 44px; }
.device-row p { margin-top: 4px; }
.security-sessions > .button, .security-history > .button { align-self: flex-start; }
@media (max-width: 639px) { .security-actions .button { flex: 1 1 auto; } .device-row { gap: 16px; } }
</style>
