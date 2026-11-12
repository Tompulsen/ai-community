<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowLeft, ArrowRight, Check, ChevronDown, Eye, EyeOff, Link2, Save, UserRound, Wallet, ArrowUpRight, ShieldCheck } from '@lucide/vue'
import { api, errorMessage, loadSession, login, rememberLotteryInvite, session, uploadFile } from '../state'
import AccountSecurity from '../components/AccountSecurity.vue'
import PasswordRecovery from '../components/PasswordRecovery.vue'
import ContentSkeleton from '../components/ContentSkeleton.vue'
import LoginCharacters from '../components/LoginCharacters.vue'

interface Account { linked: boolean; issuer?: string; subject?: string; balance: number | null; currency?: string; currencySymbol?: string; accountUrl?: string; studioReady?: boolean }
interface FinishResult { requiresTotp?: boolean; requiresLinkConfirmation?: boolean; communityUsername?: string; newApiUsername?: string; linked?: boolean }
const route = useRoute()
const router = useRouter()
const tab = ref(route.query.tab === 'balance' ? 'balance' : route.query.tab === 'security' ? 'security' : 'profile')
const resetToken = ref(typeof route.query.reset === 'string' ? route.query.reset : undefined)
const forgot = ref(false)
const avatarId = ref<string | null>(null), bannerId = ref<string | null>(null)
const avatarUrl = ref(''), bannerUrl = ref('')
const identifier = ref('')
const password = ref('')
const showPassword = ref(false), isTyping = ref(false)
const token = ref('')
const recoveryCode = ref('')
const name = ref('')
const bio = ref('')
const error = ref('')
const busy = ref(false)
let redirecting = false
const saved = ref(false)
const account = ref<Account | null>(null)
const connectionPassword = ref('')
const connectionToken = ref('')
const pendingLink = ref<FinishResult | null>(null)
const mfaToken = ref('')
watch(() => session.user, user => {
  name.value = user?.name || user?.username || ''; bio.value = user?.bio || ''
  avatarId.value = user?.avatarId || null; bannerId.value = user?.bannerId || null
  avatarUrl.value = user?.avatarUrl || ''; bannerUrl.value = user?.bannerUrl || ''
}, { immediate: true })
watch(() => route.query.tab, value => { tab.value = value === 'balance' ? 'balance' : value === 'security' ? 'security' : 'profile' })
async function loadAccount() {
  if (!session.user) { account.value = null; return }
  const result = await api<Account>('/api/account')
  account.value = { ...result, currency: result.currencySymbol || result.currency || 'USD' }
}
onMounted(async () => {
  window.addEventListener('pageshow', restoreConnection)
  await loadSession()
  try {
    if (route.query.newapi === 'complete') await finishLink()
    else await loadAccount()
  } catch (cause) { error.value = errorMessage(cause) }
})
onBeforeUnmount(() => window.removeEventListener('pageshow', restoreConnection))
function restoreConnection(event: PageTransitionEvent) {
  if (!event.persisted || !redirecting) return
  redirecting = false
  busy.value = false
}
async function signIn() {
  if (busy.value) return
  busy.value = true
  error.value = ''
  try {
    await login({ login: identifier.value.trim(), password: password.value, ...(token.value ? { token: token.value.trim() } : {}), ...(recoveryCode.value ? { recoveryCode: recoveryCode.value.trim() } : {}) })
    password.value = ''; token.value = ''; recoveryCode.value = ''
    await loadAccount()
  } catch (cause) { error.value = errorMessage(cause) }
  finally { busy.value = false }
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
async function connect() {
  if (busy.value) return
  busy.value = true
  error.value = ''
  try {
    const result = await api<{ url: string }>('/api/account/connect', { method: 'POST', body: session.user ? { password: connectionPassword.value, ...(connectionToken.value ? { token: connectionToken.value.trim() } : {}) } : { lotteryInviterId: rememberLotteryInvite() } })
    const url = new URL(result.url, window.location.origin)
    if (url.protocol !== 'https:' && url.origin !== window.location.origin) throw new Error('账号授权地址无效。')
    redirecting = true
    window.location.assign(url.href)
  } catch (cause) { redirecting = false; error.value = errorMessage(cause); busy.value = false }
}
async function finishLink(confirmLink = false) {
  if (busy.value) return
  busy.value = true
  error.value = ''
  try {
    const result = await api<FinishResult>('/api/account/finish', { method: 'POST', body: { ...(confirmLink ? { confirmLink: true } : {}), ...(mfaToken.value ? { token: mfaToken.value.trim() } : {}) } })
    if (result.requiresTotp || result.requiresLinkConfirmation) { pendingLink.value = result; return }
    pendingLink.value = null
    mfaToken.value = ''
    await loadSession(true)
    await loadAccount()
    tab.value = 'balance'
    await router.replace('/account?tab=balance')
  } catch (cause) { error.value = errorMessage(cause) }
  finally { busy.value = false }
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
    <div class="page-heading" :class="{ 'auth-heading': !session.user }"><div><h1>{{ session.user ? '账户设置' : resetToken ? '重置社区密码' : pendingLink ? '验证账号身份' : forgot ? '找回社区密码' : '欢迎回来！' }}</h1><p v-if="!session.user && !resetToken && !pendingLink && !forgot">请输入你的账号信息</p></div><span v-if="session.user" class="account-identity">@{{ session.user.username }}</span></div>
    <p v-if="error" class="notice-inline" role="alert">{{ error }}</p>
    <PasswordRecovery v-if="resetToken" :reset-token="resetToken" @done="resetToken = undefined" />
    <section v-else-if="pendingLink" class="panel-section stack"><h2>{{ pendingLink.requiresTotp ? '验证账号身份' : '确认连接章鱼账号' }}</h2><p v-if="pendingLink.requiresLinkConfirmation">将章鱼账号 {{ pendingLink.newApiUsername }} 连接至社区账号 {{ pendingLink.communityUsername }}。</p><label v-if="pendingLink.requiresTotp" class="field"><span>二步验证码</span><input v-model="mfaToken" class="control" autocomplete="one-time-code" inputmode="numeric" /></label><button class="button primary btn" :disabled="busy" @click="finishLink(!!pendingLink.requiresLinkConfirmation)">{{ busy ? '正在验证…' : pendingLink.requiresLinkConfirmation ? '确认连接' : '验证' }}</button></section>
    <ContentSkeleton v-else-if="!session.ready" layout="form" label="正在加载账号…" />
    <div v-else-if="!session.user" class="account-entry">
      <template v-if="forgot"><button type="button" class="auth-back text-link" @click="forgot = false"><ArrowLeft :size="16" />返回登录</button><PasswordRecovery /></template>
      <template v-else>
        <form class="auth-login-form" aria-label="登录社区" @submit.prevent="signIn">
          <label class="field"><span>用户名或邮箱</span><input v-model="identifier" class="control" autocomplete="username" placeholder="请输入用户名或邮箱" required :disabled="busy" @focus="isTyping = true" @blur="isTyping = false" /></label>
          <div class="field"><label for="community-password">密码</label><span class="auth-password"><input id="community-password" v-model="password" class="control" :type="showPassword ? 'text' : 'password'" autocomplete="current-password" placeholder="请输入密码" required :disabled="busy" /><button type="button" class="auth-password-toggle icon-button" :aria-label="showPassword ? '隐藏密码' : '显示密码'" :title="showPassword ? '隐藏密码' : '显示密码'" :aria-pressed="showPassword" :disabled="busy" @click="showPassword = !showPassword"><EyeOff v-if="showPassword" :size="20" /><Eye v-else :size="20" /></button></span></div>
          <div class="login-options"><details class="login-factor"><summary class="text-link">二步验证<ChevronDown :size="14" /></summary><div class="stack"><label class="field"><span>验证码</span><input v-model="token" class="control" autocomplete="one-time-code" inputmode="numeric" :disabled="busy" /></label><label class="field"><span>恢复码</span><input v-model="recoveryCode" class="control" autocomplete="off" :disabled="busy" /></label></div></details><button type="button" class="text-link forgot-password" @click="forgot = true">忘记密码？</button></div>
          <button type="submit" class="button btn auth-button" :disabled="busy"><span class="auth-button-label">{{ busy ? '正在登录…' : '登录' }}</span><span class="auth-button-hover" aria-hidden="true">{{ busy ? '正在登录…' : '登录' }}<ArrowRight :size="18" /></span></button>
        </form>
        <button type="button" class="button btn auth-button auth-octopus" :disabled="busy" @click="connect"><span class="auth-button-label">使用章鱼账号登录</span><span class="auth-button-hover" aria-hidden="true">使用章鱼账号登录<Link2 :size="18" /></span></button>
        <p class="auth-browse">想先看看？<RouterLink to="/discover">浏览社区<ArrowUpRight :size="14" /></RouterLink></p>
      </template>
    </div>
    <div v-else class="split-layout"><nav class="settings-nav account-tabs" aria-label="账户设置"><button class="tab" :class="{ active: tab === 'profile' }" :aria-pressed="tab === 'profile'" @click="tab = 'profile'"><UserRound :size="17" />个人资料</button><button class="tab" :class="{ active: tab === 'balance' }" :aria-pressed="tab === 'balance'" @click="tab = 'balance'"><Wallet :size="17" />账户与余额</button><button class="tab" :class="{ active: tab === 'security' }" :aria-pressed="tab === 'security'" @click="tab = 'security'"><ShieldCheck :size="17" />账号安全</button></nav><div class="settings-main">
      <template v-if="tab === 'profile'"><section class="panel-section profile-section"><div class="section-heading"><h2>个人资料</h2></div><form class="stack profile-form" @submit.prevent="saveProfile">
        <div class="profile-images">
          <label class="field"><span>头像</span><img v-if="avatarUrl" :src="avatarUrl" alt="当前头像" class="profile-avatar" /><input type="file" accept="image/jpeg,image/png,image/webp,image/gif,image/avif" :disabled="busy" @change="uploadProfile($event, 'avatar')" /><button v-if="avatarId" type="button" class="button subtle btn" :disabled="busy" @click="avatarId = null; avatarUrl = ''; saved = false">移除头像</button></label>
          <label class="field"><span>主页封面</span><img v-if="bannerUrl" :src="bannerUrl" alt="当前主页封面" class="profile-banner" /><input type="file" accept="image/jpeg,image/png,image/webp,image/gif,image/avif" :disabled="busy" @change="uploadProfile($event, 'banner')" /><button v-if="bannerId" type="button" class="button subtle btn" :disabled="busy" @click="bannerId = null; bannerUrl = ''; saved = false">移除封面</button></label>
        </div>
        <label class="field"><span>显示名称</span><input v-model="name" class="control" autocomplete="nickname" maxlength="50" required :disabled="busy" @input="saved = false" /></label><label class="field"><span>个人简介</span><textarea v-model="bio" class="control" rows="4" maxlength="1500" :disabled="busy" @input="saved = false" /></label><div class="section-heading"><button class="button primary btn" :disabled="busy"><Save :size="16" />{{ busy ? '正在保存…' : '保存资料' }}</button><span v-if="saved" class="form-note" role="status"><Check :size="14" />资料已保存</span></div></form></section><section class="panel-section"><RouterLink to="/library" class="button subtle btn">管理我的作品<ArrowUpRight :size="15" /></RouterLink></section></template>
      <AccountSecurity v-else-if="tab === 'security'" />
      <template v-else><section class="panel-section"><div class="section-heading"><h2>章鱼账号</h2><span class="status" :class="{ pending: !account?.linked }">{{ account?.linked ? '已连接' : '未连接' }}</span></div><dl v-if="account?.linked" class="info-list"><div><dt>关联用户</dt><dd>{{ account.subject }}</dd></div><div><dt>账号服务</dt><dd>{{ account.issuer }}</dd></div></dl><form v-else class="stack" @submit.prevent="connect"><label class="field"><span>社区密码</span><input v-model="connectionPassword" class="control" type="password" autocomplete="current-password" required :disabled="busy" /></label><label class="field"><span>二步验证码（如已启用）</span><input v-model="connectionToken" class="control" autocomplete="one-time-code" inputmode="numeric" :disabled="busy" /></label><button class="button btn" :disabled="busy"><Link2 :size="16" />{{ busy ? '正在连接…' : '连接章鱼账号' }}</button></form></section><section class="panel-section"><div class="section-heading"><h2>账户余额</h2><Wallet :size="18" /></div><p class="account-balance">{{ account?.balance != null ? `${account.balance.toFixed(2)} ${account.currency || 'USD'}` : '--' }}</p><p v-if="account?.balance == null" class="muted caption-5">{{ account?.linked ? '请在章鱼账户中心查看实时余额。' : '连接章鱼账号后查看账户。' }}</p><a v-if="account?.accountUrl" :href="account.accountUrl" class="button btn" target="_blank" rel="noopener noreferrer">前往账户中心<ArrowUpRight :size="16" /></a><button class="button subtle btn" :disabled="busy" @click="loadAccount().catch(cause => error = errorMessage(cause))">刷新账户</button></section></template>
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
.auth-login-form { display: flex; flex-direction: column; gap: 24px; }
.auth-form .field { gap: 8px; font-size: 14px; color: var(--ink); }
.auth-form .control { width: 100%; min-width: 0; height: 48px; min-height: 48px; padding: 10px 18px; border: 1px solid var(--border); border-radius: 999px; background: #fff; color: var(--ink); font-size: 16px; line-height: 24px; }
.auth-form .control::placeholder { color: var(--muted); }
.auth-form .control:focus { border-color: var(--blue); }
.auth-password { position: relative; display: block; width: 100%; }
.auth-password .control { padding-right: 56px; }
.auth-password-toggle { position: absolute; top: 2px; right: 5px; width: 44px; height: 44px; min-height: 44px; background: transparent; color: var(--muted); }
.auth-password-toggle:hover { background: transparent; color: var(--ink); }
.login-options { position: relative; min-height: 44px; }
.login-factor { width: 100%; }
.login-factor summary { display: flex; align-items: center; width: fit-content; min-height: 44px; color: var(--muted); font-size: 14px; cursor: pointer; }
.login-factor summary > svg { transition: transform 200ms ease-out; }
.login-factor[open] summary > svg { transform: rotate(180deg); }
.login-factor .stack { margin-block: 12px 0; gap: 16px; }
.forgot-password { position: absolute; top: 0; right: 0; min-height: 44px; font-size: 14px; }
.auth-button { position: relative; display: flex; justify-content: center; width: 100%; height: 48px; min-height: 48px; padding: 8px 24px; border: 1px solid #dce1eb; border-radius: 999px; overflow: hidden; background: #fff; color: #101828; font-size: 16px; font-weight: 500; }
.auth-button-label { display: inline-block; transition: transform 300ms ease-out, opacity 300ms ease-out; }
.auth-button-hover { position: absolute; inset: 0; display: flex; justify-content: center; align-items: center; gap: 8px; border-radius: inherit; background: var(--blue); color: #fff; opacity: 0; transition: opacity 300ms ease-out; pointer-events: none; }
.auth-button:not(:disabled):is(:hover, :focus-visible) .auth-button-label { transform: translateX(48px); opacity: 0; }
.auth-button:not(:disabled):is(:hover, :focus-visible) .auth-button-hover { opacity: 1; }
.auth-octopus { margin-top: 24px; }
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
