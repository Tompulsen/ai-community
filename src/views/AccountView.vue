<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowLeft, ArrowRight, Check, Eye, EyeOff, Save, UserRound, Wallet, ArrowUpRight, ShieldCheck } from '@lucide/vue'
import { accountApi, accountCenterUrl, api, errorMessage, loadSession, login, session, uploadFile, type AccountStatus } from '../state'
import AccountSecurity from '../components/AccountSecurity.vue'
import PasswordRecovery from '../components/PasswordRecovery.vue'
import ContentSkeleton from '../components/ContentSkeleton.vue'
import LoginCharacters from '../components/LoginCharacters.vue'
import AccountTurnstile from '../components/AccountTurnstile.vue'
import { loginReturnPath } from '../login-navigation'

interface Account { linked: boolean; issuer?: string; subject?: string; balance: number | null; currency?: string; currencySymbol?: string; accountUrl?: string; studioReady?: boolean }
const route = useRoute()
const router = useRouter()
const tab = ref(route.query.tab === 'balance' ? 'balance' : route.query.tab === 'security' ? 'security' : 'profile')
const resetToken = ref(typeof route.query.reset === 'string' ? route.query.reset : undefined)
const avatarId = ref<string | null>(null), bannerId = ref<string | null>(null)
const avatarUrl = ref(''), bannerUrl = ref('')
const identifier = ref('')
const password = ref('')
const showPassword = ref(false), isTyping = ref(false)
const name = ref('')
const bio = ref('')
const error = ref('')
const busy = ref(false)
const status = ref<AccountStatus | null>(null), statusReady = ref(false)
const requiresVerification = ref(false), verificationCode = ref('')
const challengeToken = ref(''), challengeVersion = ref(0)
const resetRequested = computed(() => Boolean(resetToken.value))
const centerUrl = computed(() => accountCenterUrl())
const registerUrl = computed(() => accountCenterUrl('register'))
const recoveryUrl = computed(() => accountCenterUrl('forgot-password'))
let active = true
const saved = ref(false)
const account = ref<Account | null>(null)
watch(() => session.user, user => {
  name.value = user?.name || user?.username || ''; bio.value = user?.bio || ''
  avatarId.value = user?.avatarId || null; bannerId.value = user?.bannerId || null
  avatarUrl.value = user?.avatarUrl || ''; bannerUrl.value = user?.bannerUrl || ''
}, { immediate: true })
watch(() => route.query.tab, value => { tab.value = value === 'balance' ? 'balance' : value === 'security' ? 'security' : 'profile' })
watch(() => session.user?.id, (id, previous) => {
  if (!id && previous && active && !statusReady.value) void loadStatus()
})
async function loadAccount() {
  if (!session.user) { account.value = null; return }
  const owner = session.user.id
  const result = await api<Account>('/api/account')
  if (!active || session.user?.id !== owner) return
  account.value = { ...result, currency: result.currencySymbol || result.currency || 'USD' }
}
async function loadStatus() {
  try {
    const result = await accountApi<AccountStatus>('status')
    if (!active) return
    status.value = result
    if (!session.accountUrl) session.accountUrl = result.publicUrl || ''
  } catch (cause) { if (active) error.value = errorMessage(cause) }
  finally { if (active) statusReady.value = true }
}
async function refreshIdentity() {
  if (busy.value) return
  await loadSession(true)
  if (!active) return
  try {
    if (session.user) await loadAccount()
    else if (!statusReady.value) await loadStatus()
  } catch (cause) { if (active) error.value = errorMessage(cause) }
}
function restoreIdentity(event: PageTransitionEvent) { if (event.persisted) void refreshIdentity() }
onMounted(async () => {
  window.addEventListener('pageshow', restoreIdentity)
  window.addEventListener('focus', refreshIdentity)
  await loadSession(true)
  if (!active) return
  try {
    if (session.user && typeof route.query.returnTo === 'string') {
      await router.replace(loginReturnPath(route.query.returnTo))
      return
    }
    if (session.user) await loadAccount()
    else await loadStatus()
  } catch (cause) { error.value = errorMessage(cause) }
})
onBeforeUnmount(() => { active = false; window.removeEventListener('pageshow', restoreIdentity); window.removeEventListener('focus', refreshIdentity) })
async function signIn() {
  if (busy.value) return
  busy.value = true
  error.value = ''
  try {
    const result = await login({
      login: identifier.value.trim(), password: password.value, turnstileToken: challengeToken.value,
      ...(requiresVerification.value ? { code: verificationCode.value.trim() } : {}),
      returnTo: loginReturnPath(route.query.returnTo),
    })
    password.value = ''
    if (result.requires2fa) { requiresVerification.value = true; return }
    verificationCode.value = ''
    const destination = loginReturnPath(route.query.returnTo)
    if (destination.split('?')[0] === '/account') await loadAccount()
    await router.replace(destination)
  } catch (cause) {
    error.value = errorMessage(cause)
    if (!requiresVerification.value) { challengeToken.value = ''; challengeVersion.value++ }
  }
  finally { busy.value = false }
}
function restartLogin() {
  requiresVerification.value = false; verificationCode.value = ''; error.value = ''
  challengeToken.value = ''; challengeVersion.value++
}
async function saveProfile() {
  if (busy.value || !name.value.trim()) return
  busy.value = true
  saved.value = false
  error.value = ''
  try {
    await api('/api/profile', { method: 'PATCH', body: { name: name.value.trim(), bio: bio.value.trim(), avatarId: avatarId.value, bannerId: bannerId.value } })
    await loadSession(true)
    saved.value = true
  } catch (cause) { error.value = errorMessage(cause) }
  finally { busy.value = false }
}
async function uploadProfile(event: Event, field: 'avatar' | 'banner') {
  const input = event.target as HTMLInputElement, file = input.files?.[0]
  if (!file || busy.value) return
  busy.value = true; error.value = ''; saved.value = false
  try {
    if (!file.type.startsWith('image/')) throw new Error('请选择图片。')
    const uploaded = await uploadFile(file)
    if (field === 'avatar') { avatarId.value = uploaded.id; avatarUrl.value = uploaded.url }
    else { bannerId.value = uploaded.id; bannerUrl.value = uploaded.url }
  } catch (cause) { error.value = errorMessage(cause) } finally { busy.value = false; input.value = '' }
}
</script>

<template>
  <div :class="session.user ? 'page-container settings-page' : 'auth-page'">
    <aside v-if="!session.user" class="auth-visual">
      <RouterLink to="/discover" class="auth-brand" aria-label="章鱼社区首页"><img class="auth-brand-mark" src="/assets/brand/octopus-community.jpg" width="36" height="36" alt="" /><span>章鱼社区</span></RouterLink>
      <LoginCharacters :is-typing="isTyping" :show-password="showPassword" :password-length="password.length" />
      <div class="auth-visual-footer"><RouterLink to="/discover">发现作品</RouterLink><RouterLink to="/community?tab=announcements">社区公告</RouterLink></div>
    </aside>
    <div :class="{ 'auth-panel': !session.user }"><div :class="{ 'auth-form': !session.user }">
    <RouterLink v-if="!session.user" to="/discover" class="auth-brand auth-mobile-brand" aria-label="章鱼社区首页"><img class="auth-brand-mark" src="/assets/brand/octopus-community.jpg" width="36" height="36" alt="" /><span>章鱼社区</span></RouterLink>
    <div class="page-heading" :class="{ 'auth-heading': !session.user }"><div><h1>{{ session.user ? '账户设置' : resetRequested ? '找回章鱼账号密码' : requiresVerification ? '验证章鱼账号' : '欢迎回来！' }}</h1><p v-if="!session.user && !resetRequested">{{ requiresVerification ? '请输入章鱼账号要求的验证码' : '使用章鱼账号登录' }}</p></div><span v-if="session.user" class="account-identity">@{{ session.user.username }}</span></div>
    <p v-if="error" class="notice-inline" role="alert">{{ error }}</p>
    <PasswordRecovery v-if="resetToken" :reset-token="resetToken" @done="resetToken = undefined" />
    <ContentSkeleton v-else-if="!session.ready" layout="form" label="正在加载账号…" />
    <div v-else-if="!session.user" class="account-entry">
      <ContentSkeleton v-if="!statusReady" layout="form" label="正在连接章鱼账号…" />
      <template v-else-if="status?.enabled && status.configured && status.passwordLoginEnabled">
        <form class="auth-login-form" aria-label="登录章鱼账号" @submit.prevent="signIn">
          <template v-if="!requiresVerification">
            <label class="field"><span>章鱼账号</span><input v-model="identifier" class="control" autocomplete="username" placeholder="请输入章鱼账号用户名" required :disabled="busy" @focus="isTyping = true" @blur="isTyping = false" /></label>
            <div class="field"><label for="account-password">密码</label><span class="auth-password"><input id="account-password" v-model="password" class="control" :type="showPassword ? 'text' : 'password'" autocomplete="current-password" placeholder="请输入密码" required :disabled="busy" /><button type="button" class="auth-password-toggle icon-button" :aria-label="showPassword ? '隐藏密码' : '显示密码'" :title="showPassword ? '隐藏密码' : '显示密码'" :aria-pressed="showPassword" :disabled="busy" @click="showPassword = !showPassword"><EyeOff v-if="showPassword" :size="20" /><Eye v-else :size="20" /></button></span></div>
            <div class="login-options"><a v-if="recoveryUrl" class="text-link forgot-password" :href="recoveryUrl" target="_blank" rel="noopener noreferrer">忘记密码？</a></div>
            <AccountTurnstile v-if="status.turnstileSiteKey" :site-key="status.turnstileSiteKey" :reset-key="challengeVersion" @token="challengeToken = $event" @error="error = $event" />
          </template>
          <template v-else>
            <label class="field"><span>账号验证码或恢复码</span><input v-model="verificationCode" class="control" autocomplete="one-time-code" maxlength="32" required :disabled="busy" /></label>
            <button type="button" class="text-link auth-back" :disabled="busy" @click="restartLogin"><ArrowLeft :size="16" />返回账号登录</button>
          </template>
          <button type="submit" class="button btn auth-button" :disabled="busy || (!requiresVerification && !!status.turnstileSiteKey && !challengeToken)"><span class="auth-button-label">{{ busy ? '正在登录…' : requiresVerification ? '验证并登录' : '登录' }}</span><span class="auth-button-hover" aria-hidden="true">{{ busy ? '正在登录…' : requiresVerification ? '验证并登录' : '登录' }}<ArrowRight :size="18" /></span></button>
        </form>
        <p v-if="registerUrl && !requiresVerification" class="auth-browse">还没有章鱼账号？<a :href="registerUrl" target="_blank" rel="noopener noreferrer">注册账号<ArrowUpRight :size="14" /></a></p>
      </template>
      <div v-else class="stack account-unavailable"><p class="muted">{{ statusReady && status ? '当前账号服务未开放密码登录。' : '暂时无法连接章鱼账号服务。' }}</p><a v-if="centerUrl" :href="centerUrl" class="button btn auth-button">前往章鱼账户中心<ArrowUpRight :size="16" /></a><button type="button" class="text-link" @click="loadStatus">重新连接</button></div>
      <p class="auth-browse">想先看看？<RouterLink to="/discover">浏览社区<ArrowUpRight :size="14" /></RouterLink></p>
    </div>
    <div v-else class="split-layout"><nav class="settings-nav account-tabs" aria-label="账户设置"><button class="tab" :class="{ active: tab === 'profile' }" :aria-pressed="tab === 'profile'" @click="tab = 'profile'"><UserRound :size="17" />个人资料</button><button class="tab" :class="{ active: tab === 'balance' }" :aria-pressed="tab === 'balance'" @click="tab = 'balance'"><Wallet :size="17" />账户与余额</button><button class="tab" :class="{ active: tab === 'security' }" :aria-pressed="tab === 'security'" @click="tab = 'security'"><ShieldCheck :size="17" />账号安全</button></nav><div class="settings-main">
      <template v-if="tab === 'profile'"><section class="panel-section profile-section"><div class="section-heading"><h2>个人资料</h2></div><form class="stack profile-form" @submit.prevent="saveProfile">
        <div class="profile-images">
          <label class="field"><span>头像</span><img v-if="avatarUrl" :src="avatarUrl" alt="当前头像" class="profile-avatar" /><input type="file" accept="image/jpeg,image/png,image/webp,image/gif,image/avif" :disabled="busy" @change="uploadProfile($event, 'avatar')" /><button v-if="avatarId" type="button" class="button subtle btn" :disabled="busy" @click="avatarId = null; avatarUrl = ''; saved = false">移除头像</button></label>
          <label class="field"><span>主页封面</span><img v-if="bannerUrl" :src="bannerUrl" alt="当前主页封面" class="profile-banner" /><input type="file" accept="image/jpeg,image/png,image/webp,image/gif,image/avif" :disabled="busy" @change="uploadProfile($event, 'banner')" /><button v-if="bannerId" type="button" class="button subtle btn" :disabled="busy" @click="bannerId = null; bannerUrl = ''; saved = false">移除封面</button></label>
        </div>
        <label class="field"><span>显示名称</span><input v-model="name" class="control" autocomplete="nickname" maxlength="50" required :disabled="busy" @input="saved = false" /></label><label class="field"><span>个人简介</span><textarea v-model="bio" class="control" rows="4" maxlength="1500" :disabled="busy" @input="saved = false" /></label><div class="section-heading"><button class="button primary btn" :disabled="busy"><Save :size="16" />{{ busy ? '正在保存…' : '保存资料' }}</button><span v-if="saved" class="form-note" role="status"><Check :size="14" />资料已保存</span></div></form></section><section class="panel-section"><RouterLink to="/library" class="button subtle btn">管理我的作品<ArrowUpRight :size="15" /></RouterLink></section></template>
      <AccountSecurity v-else-if="tab === 'security'" />
      <template v-else><section class="panel-section"><div class="section-heading"><h2>章鱼账号</h2><span class="status" :class="{ pending: !account?.linked }">{{ account?.linked ? '已登录' : '需要重新登录' }}</span></div><dl v-if="account?.linked" class="info-list"><div><dt>账号编号</dt><dd>{{ account.subject }}</dd></div><div><dt>账号服务</dt><dd>{{ account.issuer }}</dd></div></dl><p v-else class="muted">请退出当前会话后，使用章鱼账号重新登录。</p></section><section class="panel-section"><div class="section-heading"><h2>账户余额</h2><Wallet :size="18" /></div><p class="account-balance">{{ account?.balance != null ? `${account.balance.toFixed(2)} ${account.currency || 'USD'}` : '--' }}</p><p v-if="account?.balance == null" class="muted caption-5">请在章鱼账户中心查看实时余额。</p><a v-if="centerUrl" :href="centerUrl" class="button btn" target="_blank" rel="noopener noreferrer">前往账户中心<ArrowUpRight :size="16" /></a><button class="button subtle btn" :disabled="busy" @click="loadAccount().catch(cause => error = errorMessage(cause))">刷新账户</button></section></template>
    </div></div>
    </div></div>
  </div>
</template>

<style scoped>
.settings-page { max-width: 1168px; }
.account-identity { color: var(--muted); font-size: 14px; }
.settings-page .split-layout { display: grid; grid-template-columns: minmax(0, 1fr); gap: 32px; }
.account-tabs { position: static; display: flex; flex-direction: row; flex-wrap: nowrap; align-items: center; gap: 8px; padding: 0 0 16px; border-bottom: 1px solid var(--border); overflow-x: auto; }
.account-tabs .tab { padding: 8px 16px; min-height: 44px; }
.settings-main { min-width: 0; }
.profile-section { padding-top: 0; border: 0; }
.profile-form { max-width: 800px; gap: 24px; }
.profile-form > .field { max-width: 640px; }
.profile-form > .section-heading { margin-top: 8px; padding-top: 24px; border-top: 1px solid var(--border); }
.profile-images { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 2fr); gap: 32px; padding-block: 8px 32px; border-bottom: 1px solid var(--border); }
.profile-images .field { align-items: flex-start; gap: 16px; }
.profile-images input { max-width: 100%; min-width: 0; font: inherit; }
.profile-avatar { width: 80px; height: 80px; object-fit: cover; border-radius: 50%; border: 1px solid var(--border); }
.profile-banner { width: 100%; max-height: 144px; aspect-ratio: 3 / 1; object-fit: cover; border-radius: 6px; border: 1px solid var(--border); }
.settings-main:has(.account-balance) { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 48px; }
.settings-main:has(.account-balance) > .panel-section { padding-top: 0; border: 0; }
.settings-main:has(.account-balance) > .panel-section + .panel-section { padding-left: 32px; border-left: 1px solid var(--border); }
.settings-main .account-balance { font-size: 32px; line-height: 40px; margin: 24px 0 8px; padding: 0; color: var(--ink); }
.settings-main .info-list { margin-block: 24px; }
.settings-main .info-list dd { overflow-wrap: anywhere; min-width: 0; }
.auth-page { --canvas: #fff; --surface: #fff; --surface-soft: #f8fafc; --ink: #101828; --muted: #667085; --border: #e4e7ec; --blue: #3f51b5; --blue-hover: #34449b; --blue-soft: #eef0fb; --action: var(--blue); --action-ink: #fff; --bg: #fff; display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); min-height: 100svh; background: #fff; color: var(--ink); color-scheme: light; }
.auth-visual { display: flex; flex-direction: column; justify-content: space-between; align-items: flex-start; min-width: 0; gap: 40px; padding: 48px; overflow: hidden; background: linear-gradient(135deg, #87909f, #6b7280 50%, #4b5563); color: #fff; }
.auth-brand { display: inline-flex; align-items: center; gap: 12px; min-height: 44px; font-size: 20px; font-weight: 700; line-height: 28px; }
.auth-brand-mark { display: grid; place-items: center; width: 36px; height: 36px; border-radius: 8px; background: #ffffff1a; }
.auth-visual > :deep(.login-characters) { align-self: center; margin-block: 40px; }
.auth-visual-footer { display: flex; align-items: center; flex-wrap: wrap; gap: 32px; font-size: 12px; }
.auth-visual-footer a { display: inline-flex; align-items: center; min-height: 44px; }
.auth-visual-footer a:hover { text-decoration: underline; text-underline-offset: 4px; }
.auth-panel { display: flex; align-items: center; justify-content: center; min-width: 0; padding: 48px 32px; }
.auth-form { width: 100%; max-width: 420px; }
.auth-mobile-brand { display: none; }
.auth-heading { justify-content: center; min-height: 0; margin-bottom: 40px; text-align: center; }
.auth-heading h1 { font-size: 30px; line-height: 40px; font-weight: 700; }
.auth-heading p { margin-top: 8px; color: var(--muted); font-size: 14px; line-height: 24px; }
.connection-state { margin-bottom: 24px; color: var(--muted); font-size: 14px; line-height: 24px; }
.connection-state p { margin: 0; }
.connection-state-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 24px; margin-top: 4px; }
.connection-state-actions .text-link { display: inline-flex; align-items: center; gap: 4px; min-height: 44px; font-size: inherit; }
.auth-form > .connection-state { text-align: center; }
.auth-form > .connection-state .connection-state-actions { justify-content: center; }
.auth-divider { display: flex; align-items: center; gap: 16px; margin: 24px 0; color: var(--muted); font-size: 12px; line-height: 20px; }
.auth-divider::before, .auth-divider::after { content: ''; flex: 1; height: 1px; background: var(--border); }
.auth-login-form { display: flex; flex-direction: column; gap: 24px; }
.auth-form .field { gap: 8px; font-size: 14px; color: var(--ink); }
.auth-form .control { width: 100%; min-width: 0; height: 48px; min-height: 48px; padding: 10px 18px; border: 1px solid var(--border); border-radius: 999px; background: #fff; color: var(--ink); font-size: 16px; line-height: 24px; }
.auth-form .control::placeholder { color: var(--muted); }
.auth-form .control:focus { border-color: var(--blue); }
.auth-password { position: relative; display: block; width: 100%; }
.auth-password .control { padding-right: 56px; }
.auth-password-toggle { position: absolute; top: 2px; right: 5px; width: 44px; height: 44px; min-height: 44px; background: transparent; color: var(--muted); }
.auth-password-toggle:hover { background: transparent; color: var(--ink); }
.login-options { display: flex; justify-content: flex-end; min-height: 44px; }
.forgot-password { min-height: 44px; font-size: 14px; }
.auth-button { position: relative; display: flex; justify-content: center; width: 100%; height: 48px; min-height: 48px; padding: 8px 24px; border: 1px solid #dce1eb; border-radius: 999px; overflow: hidden; background: #fff; color: #101828; font-size: 16px; font-weight: 500; }
.auth-button-label { display: inline-block; transition: transform 300ms ease-out, opacity 300ms ease-out; }
.auth-button-hover { position: absolute; inset: 0; display: flex; justify-content: center; align-items: center; gap: 8px; border-radius: inherit; background: var(--blue); color: #fff; opacity: 0; transition: opacity 300ms ease-out; pointer-events: none; }
.auth-button:not(:disabled):is(:hover, :focus-visible) .auth-button-label { transform: translateX(48px); opacity: 0; }
.auth-button:not(:disabled):is(:hover, :focus-visible) .auth-button-hover { opacity: 1; }
.auth-octopus { align-items: center; gap: 10px; border-color: var(--blue); background: var(--blue); color: #fff; font-weight: 600; }
.auth-octopus:not(:disabled):is(:hover, :focus-visible) { border-color: var(--blue-hover); background: var(--blue-hover); }
.auth-octopus-mark { flex: none; width: 24px; height: 24px; border-radius: 6px; object-fit: cover; }
.auth-browse { display: flex; justify-content: center; align-items: center; flex-wrap: wrap; gap: 6px; margin-top: 32px; color: var(--muted); font-size: 14px; line-height: 24px; }
.auth-browse a { display: inline-flex; align-items: center; gap: 4px; min-height: 44px; color: var(--ink); font-weight: 500; }
.auth-browse a:hover { text-decoration: underline; text-underline-offset: 4px; }
.auth-back { min-height: 44px; margin-bottom: 16px; font-size: 14px; }
.auth-form > .notice-inline { margin: 0 0 24px; padding: 12px 16px; border: 1px solid #fecdca; border-radius: 8px; background: #fff4f3; color: #b42318; }
.auth-form :deep(.password-recovery) { max-width: none; padding: 0; }
.auth-form :deep(.password-recovery h2) { display: none; }
.auth-form :deep(.password-recovery .control) { border-radius: 999px; background: #fff; font-size: 16px; }
.auth-form > .panel-section { margin: 0; padding: 0; border: 0; }
@media (max-width: 1023px) {
  .auth-page { grid-template-columns: minmax(0, 1fr); }
  .auth-visual { display: none; }
  .auth-panel { min-height: 100svh; padding: 40px 24px; }
  .auth-mobile-brand { display: flex; justify-content: center; margin-bottom: 48px; color: var(--ink); }
  .auth-mobile-brand .auth-brand-mark { background: #f2f4f7; }
}
@media (prefers-reduced-motion: reduce) { .auth-button-label, .auth-button-hover { transition: none; }.auth-button:not(:disabled):is(:hover, :focus-visible) .auth-button-label { transform: none; } }
@media (max-width: 639px) {
  .settings-page .split-layout { gap: 24px; }
  .account-tabs { gap: 4px; padding-bottom: 12px; }
  .account-tabs .tab { padding-inline: 12px; }
  .profile-images { grid-template-columns: minmax(0, 1fr); gap: 32px; }
  .settings-main:has(.account-balance) { grid-template-columns: minmax(0, 1fr); gap: 24px; }
  .settings-main:has(.account-balance) > .panel-section + .panel-section { padding: 24px 0 0; border-left: 0; border-top: 1px solid var(--border); }
  .auth-panel { padding: 32px 24px; }
  .auth-heading { margin-bottom: 32px; }
}
</style>
