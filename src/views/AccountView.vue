<script setup lang="ts">
import { computed, inject, nextTick, onBeforeUnmount, onMounted, ref, watch, type ComputedRef } from 'vue'
import { onBeforeRouteLeave, onBeforeRouteUpdate, useRoute, useRouter } from 'vue-router'
import { ArrowLeft, ChevronRight, Eye, EyeOff, LogOut, Palette, Search, Wallet, ArrowUpRight, ShieldCheck, LockKeyhole, X } from '@lucide/vue'
import { site } from '../site'
import { accountApi, accountCenterUrl, api, errorMessage, loadSession, login, logout, rememberLotteryInvite, rememberReferralInvite, session, type AccountStatus, type LoginIdentitySelection } from '../state'
import AccountSecurity from '../components/AccountSecurity.vue'
import AccountPrivacy from '../components/AccountPrivacy.vue'
import AccountTheme from '../components/AccountTheme.vue'
import AccountWallet from '../components/AccountWallet.vue'
import CommunityWalletSummary from '../components/CommunityWalletSummary.vue'
import { parseCommunityWallet, type CommunityWallet } from '../../shared/studio/community-wallet'
import PasswordRecovery from '../components/PasswordRecovery.vue'
import ContentSkeleton from '../components/ContentSkeleton.vue'
import LoginCharacters from '../components/LoginCharacters.vue'
import AccountTurnstile from '../components/AccountTurnstile.vue'
import { loginReturnPath } from '../login-navigation'
import '../settings-tokens.css'

interface Account { linked: boolean; issuer?: string; subject?: string; balance: number | null; currency?: string; currencySymbol?: string; accountUrl?: string; studioReady?: boolean; walletEnabled?: boolean; points?: CommunityWallet | null }
const route = useRoute()
const router = useRouter()
const settingTabs = ['privacy', 'theme', 'security', 'balance']
const readTab = (value: unknown) => typeof value === 'string' && settingTabs.includes(value) ? value : 'privacy'
const tab = ref(readTab(route.query.tab))
const mobileSettings = inject<ComputedRef<boolean>>('mobile-community', computed(() => false))
const settingsDetail = computed(() => typeof route.query.tab === 'string' && settingTabs.includes(route.query.tab))
const showPanel = computed(() => !mobileSettings.value || settingsDetail.value)
const privacyPanel = ref<InstanceType<typeof AccountPrivacy>>(), privacyDirty = ref(false)
const settingsQuery = ref(''), settingsNav = ref<HTMLElement>(), settingsMain = ref<HTMLElement>()
const leaveDialog = ref<HTMLDialogElement>()
let resolveLeave: ((discard: boolean) => void) | undefined
const settingsItems = [
  { id: 'privacy', label: '关注与隐私', icon: LockKeyhole, group: '账号设置', keywords: '关注 审批 粉丝 隐私 公开 privacy' },
  { id: 'security', label: '账号安全', icon: ShieldCheck, group: '账号设置', keywords: '密码 邮箱 验证 登录 设备 会话 security' },
  { id: 'balance', label: '我的账户', icon: Wallet, group: '账号设置', keywords: '账户中心 余额 充值 钱包 balance' },
  { id: 'theme', label: '主题与外观', icon: Palette, group: '偏好设置', keywords: '明亮 暗色 主题 配色 外观 定时 跟随系统 theme' },
]
const settingsGroups = computed(() => {
  const query = settingsQuery.value.trim().toLocaleLowerCase()
  return ['账号设置', '偏好设置'].map(label => ({ label, items: settingsItems.filter(item => item.group === label && (!query || (item.label + item.keywords).toLocaleLowerCase().includes(query))) })).filter(group => group.items.length)
})
const resetToken = ref(typeof route.query.reset === 'string' ? route.query.reset : undefined)
const identifier = ref('')
const password = ref('')
const showPassword = ref(false), isTyping = ref(false)
const error = ref('')
const busy = ref(false)
const status = ref<AccountStatus | null>(null), statusReady = ref(false)
const requiresVerification = ref(false), verificationCode = ref('')
const identitySelection = ref<LoginIdentitySelection | null>(null)
const challengeToken = ref(''), challengeVersion = ref(0)
const resetRequested = computed(() => Boolean(resetToken.value))
const registrationRequested = computed(() => route.query.mode === 'register' && !resetRequested.value)
const registrationAvailable = computed(() => !!status.value?.registerEnabled && !!status.value?.passwordRegisterEnabled)
const registrationEmail = ref(''), registrationCode = ref(''), confirmation = ref(''), acceptedTerms = ref(false)
const emailControl = ref<HTMLInputElement>(), confirmationControl = ref<HTMLInputElement>(), loginControl = ref<HTMLInputElement>()
const notice = ref(''), confirmationError = ref(false), sendingCode = ref(false)
const codeAvailableAt = ref(0), currentTime = ref(Date.now())
const resendSeconds = computed(() => Math.max(0, Math.ceil((codeAvailableAt.value - currentTime.value) / 1000)))
let resendTimer: ReturnType<typeof setInterval> | undefined, authModeVersion = 0
const centerUrl = computed(() => accountCenterUrl())
const recoveryUrl = computed(() => accountCenterUrl('forgot-password'))
const agreementUrl = computed(() => accountCenterUrl('user-agreement'))
const privacyUrl = computed(() => accountCenterUrl('privacy-policy'))
const authLocation = (register: boolean) => ({ path: '/account', query: { ...route.query, mode: register ? 'register' : undefined } })
let active = true
const account = ref<Account | null>(null)
watch(registrationRequested, () => {
  authModeVersion++
  password.value = ''; confirmation.value = ''; showPassword.value = false; isTyping.value = false
  error.value = ''; notice.value = ''; confirmationError.value = false; acceptedTerms.value = false
  registrationCode.value = ''; identitySelection.value = null; requiresVerification.value = false
  challengeToken.value = ''; challengeVersion.value++
})
watch(registrationEmail, () => { registrationCode.value = ''; notice.value = '' })
function startCodeCooldown(seconds = 60) {
  clearInterval(resendTimer)
  currentTime.value = Date.now(); codeAvailableAt.value = currentTime.value + seconds * 1000
  resendTimer = setInterval(() => {
    currentTime.value = Date.now()
    if (!resendSeconds.value) clearInterval(resendTimer)
  }, 1000)
}
async function sendRegistrationCode() {
  if (busy.value || resendSeconds.value || !emailControl.value?.reportValidity()) return
  busy.value = true; sendingCode.value = true; error.value = ''; notice.value = ''
  const version = authModeVersion
  try {
    await accountApi('registration-code', { email: registrationEmail.value.trim(), ...(challengeToken.value ? { turnstile_token: challengeToken.value } : {}) })
    if (!active || version !== authModeVersion) return
    notice.value = '验证码已发送，请查收邮箱。'
    startCodeCooldown()
  } catch (cause) {
    if (!active || version !== authModeVersion) return
    error.value = errorMessage(cause)
    if ((cause as { status?: number }).status === 429) startCodeCooldown((cause as { retryAfter?: number }).retryAfter || 60)
  } finally {
    if (active) { busy.value = false; sendingCode.value = false; challengeToken.value = ''; challengeVersion.value++ }
  }
}
async function registerAccount() {
  if (busy.value || !registrationAvailable.value) return
  error.value = ''; notice.value = ''
  if (password.value !== confirmation.value) {
    confirmationError.value = true
    error.value = '两次输入的密码不一致。'
    await nextTick(); confirmationControl.value?.focus()
    return
  }
  const version = authModeVersion, username = identifier.value.trim()
  const stored = rememberLotteryInvite()
  const aff = typeof route.query.aff === 'string' ? route.query.aff : rememberReferralInvite() || (stored && /^wf[a-zA-Z0-9]{24}$/.test(stored) ? stored : '')
  busy.value = true
  try {
    await accountApi('register', {
      username, password: password.value,
      ...(status.value?.emailVerificationEnabled ? { email: registrationEmail.value.trim(), verification_code: registrationCode.value.trim() } : {}),
      ...(aff ? { aff_code: aff } : {}),
      ...(challengeToken.value ? { turnstile_token: challengeToken.value } : {}),
    })
    if (!active || version !== authModeVersion) return
    await router.replace(authLocation(false))
    if (!active) return
    identifier.value = username
    busy.value = false
    notice.value = '注册成功，请登录章鱼账号。'
    await nextTick(); loginControl.value?.focus()
  } catch (cause) {
    if (active && version === authModeVersion) error.value = errorMessage(cause)
  } finally {
    if (active) {
      busy.value = false
      if (version === authModeVersion) { challengeToken.value = ''; challengeVersion.value++ }
    }
  }
}
function navigateTab(value: string) {
  if (value !== tab.value || !showPanel.value) void router.push({ path: '/account', query: { tab: value } })
}
function confirmLeave() {
  if (!session.user || !privacyDirty.value) return true
  if (resolveLeave) return false
  leaveDialog.value?.showModal()
  return new Promise<boolean>(resolve => { resolveLeave = resolve })
}
function finishLeave(discard: boolean) {
  if (discard) {
    privacyPanel.value?.discard(); privacyDirty.value = false
  }
  leaveDialog.value?.close(); resolveLeave?.(discard); resolveLeave = undefined
}
onBeforeRouteLeave(confirmLeave)
onBeforeRouteUpdate(to => !settingsDetail.value && to.query.tab === tab.value ? true : confirmLeave())
function beforeUnload(event: BeforeUnloadEvent) {
  if (session.user && privacyDirty.value) { event.preventDefault(); event.returnValue = '' }
}
async function signOutFromSettings() {
  if (busy.value || !(await confirmLeave())) return
  busy.value = true; error.value = ''
  try { await logout() } catch (cause) { if (active) error.value = errorMessage(cause) }
  finally { if (active) busy.value = false }
}
watch(() => session.user?.id, () => {
  if (resolveLeave) finishLeave(false)
  account.value = null; error.value = ''; busy.value = false
}, { flush: 'sync' })
watch([() => session.user?.id, () => route.query.tab], ([id, value]) => {
  if (id && value === 'profile') void router.replace({ path: '/community', query: { creator: id, edit: 'profile' } })
}, { immediate: true })
watch(() => route.query.tab, async (value, previous) => {
  tab.value = readTab(value)
  if (!mobileSettings.value) return
  await nextTick()
  if (settingsDetail.value) settingsMain.value?.focus({ preventScroll: true })
  else {
    const target = settingsNav.value?.querySelector<HTMLButtonElement>(`[data-setting="${readTab(previous)}"]`)
      || settingsNav.value?.querySelector<HTMLButtonElement>('button')
    target?.focus({ preventScroll: true })
  }
  window.scrollTo({ top: 0 })
})
watch([tab, () => session.user?.id, settingsQuery], async () => {
  await nextTick()
  const nav = settingsNav.value, item = nav?.querySelector<HTMLElement>('[aria-current="page"]')
  if (nav && item && nav.scrollWidth > nav.clientWidth) nav.scrollLeft = item.offsetLeft - nav.offsetLeft - 8
}, { immediate: true })
watch(() => session.user?.id, (id, previous) => {
  if (!id && previous && active && !statusReady.value) void loadStatus()
})
watch(() => session.user?.accountId, () => { account.value = null }, { flush: 'sync' })
async function loadAccount() {
  if (!session.user) { account.value = null; return }
  const owner = session.user.id, subject = session.user.accountId || owner
  let result: Account
  try { result = await api<Account>('/api/account', { expectedAccount: subject }) }
  catch (cause) {
    if (active && session.user?.id === owner && (session.user.accountId || owner) === subject && account.value?.walletEnabled)
      account.value = { ...account.value, points: null, balance: null }
    throw cause
  }
  if (!active || session.user?.id !== owner || (session.user.accountId || owner) !== subject) return
  if (result.subject !== subject || !result.linked) { account.value = null; return }
  let points: CommunityWallet | null = null
  if (result.walletEnabled) { try { points = parseCommunityWallet(result.points) } catch {} }
  account.value = { ...result, points, currency: result.currencySymbol || result.currency || 'USD' }
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
  window.addEventListener('beforeunload', beforeUnload)
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
onBeforeUnmount(() => { active = false; clearInterval(resendTimer); resolveLeave?.(false); window.removeEventListener('beforeunload', beforeUnload); window.removeEventListener('pageshow', restoreIdentity); window.removeEventListener('focus', refreshIdentity) })
async function signIn(selectionId?: string) {
  if (busy.value || (identitySelection.value && !selectionId)) return
  const returnTo = loginReturnPath(route.query.returnTo), legacyProfile = route.query.tab === 'profile' && !route.query.returnTo
  if (identitySelection.value && identitySelection.value.expiresAt <= Date.now() / 1000) {
    await restartLogin(); error.value = '账号选择已过期，请重新登录。'; return
  }
  busy.value = true
  error.value = ''
  try {
    const result = await login({
      login: identifier.value.trim(), password: password.value, turnstileToken: challengeToken.value,
      ...(requiresVerification.value ? { code: verificationCode.value.trim() } : {}),
      ...(selectionId ? { selectionId } : {}),
      returnTo,
    })
    password.value = ''
    if (!active) return
    if ('requiresIdentitySelection' in result) { identitySelection.value = result; return }
    identitySelection.value = null
    if (result.requires2fa) { requiresVerification.value = true; return }
    verificationCode.value = ''
    const destination = legacyProfile && session.user
      ? `/community?creator=${encodeURIComponent(session.user.id)}&edit=profile`
      : returnTo
    if (destination.split('?')[0] === '/account') await loadAccount()
    await router.replace(destination)
  } catch (cause) {
    if (selectionId) await restartLogin()
    error.value = errorMessage(cause)
    if (!requiresVerification.value) { challengeToken.value = ''; challengeVersion.value++ }
  }
  finally { busy.value = false }
}
async function restartLogin() {
  identitySelection.value = null; password.value = ''
  requiresVerification.value = false; verificationCode.value = ''; error.value = ''
  challengeToken.value = ''; challengeVersion.value++
  try { await accountApi('login-cancel', {}) } catch (cause) { error.value = errorMessage(cause) }
}
</script>

<template>
  <div :class="session.user ? 'page-container settings-page' : ['auth-page', { 'auth-registration': registrationRequested }]" :data-settings-tab="session.user ? tab : undefined" :data-settings-detail="session.user ? settingsDetail : undefined">
    <aside v-if="!session.user" class="auth-visual">
      <RouterLink to="/discover" class="auth-brand" :aria-label="`${site.brand}首页`"><img v-if="site.logoUrl" class="auth-brand-mark" :src="site.logoUrl" width="36" height="36" alt="" /><span>{{ site.brand }}</span></RouterLink>
      <LoginCharacters :is-typing="isTyping" :show-password="showPassword" :password-length="password.length" />
      <div class="auth-visual-footer"><RouterLink to="/discover">发现作品</RouterLink><RouterLink to="/messages?tab=announcement">公告</RouterLink></div>
    </aside>
    <div :class="{ 'auth-panel': !session.user }"><div :class="{ 'auth-form': !session.user }">
    <RouterLink v-if="!session.user" to="/discover" class="auth-brand auth-mobile-brand" :aria-label="`${site.brand}首页`"><img v-if="site.logoUrl" class="auth-brand-mark" :src="site.logoUrl" width="36" height="36" alt="" /><span>{{ site.brand }}</span></RouterLink>
    <div class="page-heading" :class="{ 'auth-heading': !session.user }"><div><h1>{{ session.user ? '账户设置' : resetRequested ? '找回章鱼账号密码' : registrationRequested ? '注册章鱼账号' : identitySelection ? '确认登录账号' : requiresVerification ? '验证章鱼账号' : '登录章鱼账号' }}</h1><p v-if="!session.user && !resetRequested">{{ registrationRequested ? '创建你的章鱼账号' : identitySelection ? '该登录名关联多个账号，请确认本次要使用的账号。' : requiresVerification ? '请输入章鱼账号要求的验证码' : '使用用户名或邮箱登录' }}</p></div></div>
    <p v-if="error" class="notice-inline" role="alert">{{ error }}</p>
    <p v-if="notice && !session.user" class="notice-inline auth-feedback" role="status">{{ notice }}</p>
    <PasswordRecovery v-if="resetToken" :reset-token="resetToken" @done="resetToken = undefined" />
    <ContentSkeleton v-else-if="!session.ready" layout="form" label="正在加载账号…" />
    <div v-else-if="!session.user" class="account-entry">
      <ContentSkeleton v-if="!statusReady" layout="form" label="正在连接章鱼账号…" />
      <template v-else-if="registrationRequested && status?.enabled && status.configured">
        <form v-if="registrationAvailable" class="auth-login-form auth-register-form" aria-label="注册章鱼账号" method="post" action="/api/new-api/register" @submit.prevent="registerAccount">
          <label class="field" for="register-username"><span>用户名</span><input id="register-username" v-model="identifier" name="username" class="control" autocomplete="username" autocapitalize="none" autocorrect="off" :spellcheck="false" maxlength="20" placeholder="请输入用户名" required :disabled="busy" @focus="isTyping = true" @blur="isTyping = false" /></label>
          <template v-if="status.emailVerificationEnabled">
            <label class="field" for="register-email"><span>邮箱</span><input id="register-email" ref="emailControl" v-model="registrationEmail" name="email" class="control" type="email" autocomplete="email" :spellcheck="false" maxlength="50" placeholder="请输入邮箱" required :disabled="busy" /></label>
            <div class="field"><label for="register-code">邮箱验证码</label><div class="registration-code-row"><input id="register-code" v-model="registrationCode" name="verification_code" class="control" autocomplete="one-time-code" autocapitalize="none" :spellcheck="false" maxlength="32" placeholder="验证码" required :disabled="busy" /><button type="button" class="button btn" :title="resendSeconds ? `${resendSeconds} 秒后可重新发送` : undefined" :disabled="busy || resendSeconds > 0 || (!!status.turnstileSiteKey && !challengeToken)" @click="sendRegistrationCode">{{ sendingCode ? '正在发送…' : resendSeconds > 999 ? '稍后重发' : resendSeconds ? `${resendSeconds} 秒后重发` : '发送验证码' }}</button></div></div>
          </template>
          <div class="field"><label for="register-password">密码</label><span class="auth-password"><input id="register-password" v-model="password" name="password" class="control" :type="showPassword ? 'text' : 'password'" autocomplete="new-password" minlength="8" maxlength="128" placeholder="请输入密码" required :disabled="busy" @input="confirmationError = false" /><button type="button" class="auth-password-toggle icon-button" :aria-label="showPassword ? '隐藏密码' : '显示密码'" :title="showPassword ? '隐藏密码' : '显示密码'" :aria-pressed="showPassword" :disabled="busy" @click="showPassword = !showPassword"><EyeOff v-if="showPassword" :size="20" /><Eye v-else :size="20" /></button></span></div>
          <div class="field"><label for="register-confirmation">确认密码</label><input id="register-confirmation" ref="confirmationControl" v-model="confirmation" name="password_confirmation" class="control" :type="showPassword ? 'text' : 'password'" autocomplete="new-password" minlength="8" maxlength="128" :aria-invalid="confirmationError || undefined" :aria-describedby="confirmationError ? 'registration-confirmation-error' : undefined" placeholder="请再次输入密码" required :disabled="busy" @input="confirmationError = false" /><span v-if="confirmationError" id="registration-confirmation-error" class="registration-help">两次输入的密码不一致。</span></div>
          <div v-if="status.userAgreementEnabled || status.privacyPolicyEnabled" class="registration-terms"><input id="registration-terms" v-model="acceptedTerms" name="terms" type="checkbox" required :disabled="busy" /><label for="registration-terms">我已阅读并同意<template v-if="status.userAgreementEnabled"><a :href="agreementUrl" target="_blank" rel="noopener noreferrer">《用户协议》</a></template><template v-if="status.privacyPolicyEnabled"><a :href="privacyUrl" target="_blank" rel="noopener noreferrer">《隐私政策》</a></template></label></div>
          <AccountTurnstile v-if="status.turnstileSiteKey" :site-key="status.turnstileSiteKey" action="registration" :reset-key="challengeVersion" :disabled="busy" @token="challengeToken = $event" />
          <button type="submit" class="button btn auth-button" :disabled="busy || (!!status.turnstileSiteKey && !challengeToken)">{{ busy && !sendingCode ? '正在注册…' : '注册账号' }}</button>
        </form>
        <p v-else class="muted" role="status">当前暂未开放账号注册。</p>
        <p class="auth-browse">已有章鱼账号？<RouterLink :to="authLocation(false)" :aria-disabled="busy || undefined" @click.capture="busy && $event.preventDefault()">立即登录</RouterLink></p>
      </template>
      <template v-else-if="status?.enabled && status.configured && status.passwordLoginEnabled">
        <form class="auth-login-form" aria-label="登录章鱼账号" @submit.prevent="signIn()">
          <template v-if="identitySelection">
            <button v-for="candidate in identitySelection.candidates" :key="candidate.selection_id" type="button" class="button btn identity-choice" :disabled="busy" @click="signIn(candidate.selection_id)"><strong>登录 {{ candidate.username }}</strong><span class="muted">{{ candidate.account_label }}</span></button>
            <button type="button" class="text-link auth-back" :disabled="busy" @click="restartLogin"><ArrowLeft :size="16" />返回账号登录</button>
          </template>
          <template v-else-if="!requiresVerification">
            <label class="field"><span>用户名或邮箱</span><input ref="loginControl" v-model="identifier" class="control" autocomplete="username" placeholder="请输入用户名或邮箱" required :disabled="busy" @focus="isTyping = true" @blur="isTyping = false" /></label>
            <div class="field"><label for="account-password">密码</label><span class="auth-password"><input id="account-password" v-model="password" class="control" :type="showPassword ? 'text' : 'password'" autocomplete="current-password" placeholder="请输入密码" required :disabled="busy" /><button type="button" class="auth-password-toggle icon-button" :aria-label="showPassword ? '隐藏密码' : '显示密码'" :title="showPassword ? '隐藏密码' : '显示密码'" :aria-pressed="showPassword" :disabled="busy" @click="showPassword = !showPassword"><EyeOff v-if="showPassword" :size="20" /><Eye v-else :size="20" /></button></span></div>
            <div class="login-options"><a v-if="recoveryUrl" class="text-link forgot-password" :href="recoveryUrl" target="_blank" rel="noopener noreferrer">忘记密码？</a></div>
            <AccountTurnstile v-if="status.turnstileSiteKey" :site-key="status.turnstileSiteKey" :reset-key="challengeVersion" :disabled="busy" @token="challengeToken = $event" />
          </template>
          <template v-else>
            <label class="field"><span>账号验证码或恢复码</span><input v-model="verificationCode" class="control" autocomplete="one-time-code" maxlength="32" required :disabled="busy" /></label>
            <button type="button" class="text-link auth-back" :disabled="busy" @click="restartLogin"><ArrowLeft :size="16" />返回账号登录</button>
          </template>
          <button v-if="!identitySelection" type="submit" class="button btn auth-button" :disabled="busy || (!requiresVerification && !!status.turnstileSiteKey && !challengeToken)"><span class="auth-button-label">{{ busy ? '正在登录…' : requiresVerification ? '验证并登录' : '登录' }}</span></button>
        </form>
      </template>
      <div v-else class="stack account-unavailable"><p class="muted">{{ statusReady && status ? '当前账号服务未开放密码登录。' : '暂时无法连接章鱼账号服务。' }}</p><a v-if="centerUrl" :href="centerUrl" class="button btn auth-button">前往章鱼账户中心<ArrowUpRight :size="16" /></a><button type="button" class="text-link" @click="loadStatus">重新连接</button></div>
      <p v-if="!registrationRequested && registrationAvailable && !requiresVerification && !identitySelection" class="auth-browse">还没有章鱼账号？<RouterLink :to="authLocation(true)" :aria-disabled="busy || undefined" @click.capture="busy && $event.preventDefault()">注册账号</RouterLink></p>
      <p class="auth-browse">想先看看？<RouterLink to="/discover">浏览社区<ArrowUpRight :size="14" /></RouterLink></p>
    </div>
    <div v-else class="split-layout">
      <aside v-show="!mobileSettings || !settingsDetail" class="settings-sidebar">
        <label class="search-control settings-search"><Search :size="17" aria-hidden="true" /><input v-model="settingsQuery" type="search" placeholder="搜索设置" aria-label="搜索设置" /></label>
        <nav ref="settingsNav" class="account-tabs" aria-label="账户设置">
          <div v-for="group in settingsGroups" :key="group.label" class="settings-nav-group"><h2>{{ group.label }}</h2><template v-for="item in group.items" :key="item.id">
            <button v-wallet-prefetch="item.id === 'balance'" class="settings-nav-item" :data-setting="item.id" :class="{ active: showPanel && tab === item.id }" :aria-current="showPanel && tab === item.id ? 'page' : undefined" :aria-pressed="showPanel && tab === item.id" @click="navigateTab(item.id)"><component :is="item.icon" :size="18" aria-hidden="true" /><span>{{ item.label }}</span><span v-if="item.id === 'privacy' && privacyDirty" class="draft-dot" title="有未保存的修改" aria-hidden="true" /><ChevronRight class="settings-nav-chevron" :size="16" aria-hidden="true" /></button>
          </template></div>
          <div v-if="!settingsGroups.length" class="settings-no-results" role="status"><p>没有找到相关设置</p><button type="button" class="text-link" @click="settingsQuery = ''">清除搜索</button></div>
        </nav>
        <div class="settings-sidebar-footer"><a v-if="centerUrl" :href="centerUrl" class="settings-nav-item" target="_blank" rel="noopener noreferrer"><ArrowUpRight :size="18" aria-hidden="true" /><span>章鱼账户中心</span></a><button type="button" class="settings-nav-item signout" :disabled="busy" @click="signOutFromSettings"><LogOut :size="18" aria-hidden="true" /><span>退出登录</span></button></div>
      </aside>
      <div v-show="showPanel" ref="settingsMain" class="settings-main" tabindex="-1">
        <AccountPrivacy v-if="tab === 'privacy'" ref="privacyPanel" @dirty="privacyDirty = $event" />
        <AccountTheme v-else-if="tab === 'theme'" />
        <AccountSecurity v-else-if="tab === 'security'" />
        <div v-else class="balance-settings">
          <section class="panel-section balance-panel">
            <div class="balance-summary"><div class="section-heading"><Wallet :size="16" aria-hidden="true" /><h2>{{ account?.walletEnabled ? '社区积分' : '账户余额' }}</h2></div><CommunityWalletSummary v-if="account?.points" :wallet="account.points" /><p v-else-if="account?.walletEnabled" class="form-note" role="status">积分余额暂不可用，请稍后刷新或前往账户中心查看。</p><template v-else><p class="account-balance">{{ account?.balance != null ? account.balance.toFixed(2) + ' ' + (account.currency || 'USD') : '--' }}</p><p v-if="account?.balance == null" class="form-note">请在章鱼账户中心查看实时余额。</p><p v-else class="form-note">以章鱼账户中心实时余额为准。</p></template></div>
            <div class="balance-actions"><a v-if="centerUrl" :href="centerUrl" class="button subtle btn" aria-label="前往账户中心" title="前往账户中心" target="_blank" rel="noopener noreferrer"><span>前往账户中心</span><ArrowUpRight :size="16" /></a></div>
          </section>
          <AccountWallet :wallet-enabled="account?.walletEnabled" @refresh="loadAccount().catch(cause => error = errorMessage(cause))" />
        </div>
      </div>
    </div>
    <dialog v-if="session.user" ref="leaveDialog" class="compact-dialog" aria-labelledby="privacy-leave-heading" @cancel.prevent="finishLeave(false)"><div class="dialog-heading"><h2 id="privacy-leave-heading">保留隐私设置修改？</h2><button class="icon-button" aria-label="关闭离开提示" @click="finishLeave(false)"><X :size="20" /></button></div><div class="dialog-body stack"><p>隐私设置尚未保存。离开后，未保存的修改将丢失。</p><div class="table-actions settings-leave-actions"><button class="button subtle btn" @click="finishLeave(true)">放弃修改并离开</button><button class="button primary btn" autofocus @click="finishLeave(false)">继续编辑</button></div></div></dialog>
    </div></div>
  </div>
</template>

<style scoped>
/* Hallmark · shape: app screen · genre: modern-minimal · theme: brand · redesign: full · nav: kept · signature: compact settings rows · states: loading empty error full · modes: light+dark · v2.0.0 */
/* Hallmark · pre-emit critique: P4 H4 E4 S3 R5 V3 · weakest: S, preserve the community account model and existing navigation */
/* Hallmark · waive 24b · existing balance action uses 6px by 10px padding · DESIGN.md preserves the compact account-center action while this redesign focuses on settings */
/* Hallmark · dismissed 49 · identity-choice contains a username and account_label on separate lines; the existing identity picker preserves both while auth-button actions stay on one line */
.identity-choice { min-height: 64px; display: flex; flex-direction: column; align-items: flex-start; text-align: left; overflow-wrap: anywhere; white-space: normal; gap: 4px; padding: 12px 16px; }
.settings-page { max-width: var(--settings-width); padding-top: var(--settings-space-section); }
.settings-page .page-heading { min-height: 32px; margin-bottom: var(--settings-space-section); }
.settings-page .page-heading h1 { font-size: 24px; line-height: 32px; min-width: 0; overflow-wrap: break-word; text-wrap: balance; }
.settings-page .split-layout { display: grid; grid-template-columns: 208px minmax(0, 1fr); gap: var(--settings-space-layout); align-items: start; }
.settings-sidebar { position: sticky; top: 24px; min-width: 0; }
.settings-search { width: 100%; min-height: var(--settings-control-height); margin-bottom: var(--settings-space-section); background: var(--surface); border-color: var(--control-border); }
.account-tabs { display: grid; gap: 24px; min-width: 0; }
.settings-nav-group { display: grid; gap: 4px; }
.settings-nav-group h2 { margin: 0 12px 8px; color: var(--muted); font-size: 12px; line-height: 20px; font-weight: 400; }
.settings-nav-item { display: flex; align-items: center; gap: 12px; min-height: 44px; padding: 12px; border-radius: 6px; text-align: left; color: var(--muted); }
.settings-nav-item > span:first-of-type { flex: 1; }
.settings-nav-item > svg { flex-shrink: 0; }
.settings-nav-item:hover { background: var(--surface); color: var(--ink); }
.settings-nav-item { white-space: nowrap; }
.settings-nav-item:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: var(--focus-outline-offset); }
.settings-nav-item.active { background: var(--surface-soft); color: var(--ink); }
.settings-nav-item.active::after { content: ''; width: 12px; height: 2px; flex: none; border-radius: 1px; background: currentColor; }
.settings-nav-chevron { display: none; }
.draft-dot { width: 12px; height: 2px; border-radius: 1px; background: var(--amber); flex-shrink: 0; }
.settings-sidebar-footer { display: grid; gap: 4px; margin-top: 24px; padding-top: 20px; border-top: 1px solid var(--border); }
.settings-sidebar-footer .signout { color: var(--danger); }
.settings-no-results { display: grid; gap: 12px; padding: 16px 12px; color: var(--muted); }
.settings-no-results .text-link { justify-self: start; min-height: 44px; }
.settings-main { min-width: 0; }
.settings-main:focus { outline: none; }
.settings-main:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: var(--focus-outline-offset); }
.settings-page:not([data-settings-tab="balance"]) .settings-main :deep(.panel-section) { border-top: 0; padding-top: 0; }
.settings-page:not([data-settings-tab="balance"]) .settings-main :deep(.section-heading) { align-items: flex-start; margin-bottom: var(--settings-space-group); }
.settings-page:not([data-settings-tab="balance"]) .settings-main :deep(.section-heading h2) { font-size: 20px; line-height: 28px; min-width: 0; overflow-wrap: break-word; text-wrap: balance; }
.settings-page:not([data-settings-tab="balance"]) .settings-main :deep(.section-heading .form-note) { margin-top: 8px; font-size: 14px; line-height: 20px; }
.settings-page:not([data-settings-tab="balance"]) .settings-main :deep(.control) { min-height: var(--control-size, var(--settings-control-height)); font-size: var(--control-font-size, var(--font-size-input)); background: var(--surface); border-radius: 6px; }
.settings-page:not([data-settings-tab="balance"]) .settings-main :deep(.button) { min-height: var(--control-size, var(--control-height)); }
.settings-leave-actions { justify-content: end; flex-wrap: wrap; }
.balance-settings { display: grid; gap: 16px; }
.balance-settings > .panel-section { padding-top: 0; }
.balance-settings .balance-panel { display: flex; justify-content: space-between; align-items: center; gap: 12px 24px; padding: 0 0 12px; background: transparent; border-radius: 0; }
.balance-summary { flex: 1; min-width: 0; }.balance-summary .section-heading { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }.balance-summary h2 { min-width: 0; overflow-wrap: break-word; text-wrap: balance; }.balance-summary .form-note { margin-top: 4px; }
.account-balance { font-size: 20px; line-height: 28px; margin: 0; padding: 0; color: var(--ink); overflow-wrap: anywhere; font-variant-numeric: tabular-nums; }
.balance-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin: 0; }.balance-actions .button { min-height: 36px; padding: 6px 10px; font-size: 12px; }
@media (max-width: 639px) {
  .balance-settings .balance-panel { padding-bottom: 16px; }.balance-actions .button, .balance-actions .icon-button { min-height: 44px; }
}

.auth-page { --canvas: var(--auth-canvas); --surface: var(--auth-canvas); --surface-soft: var(--auth-surface-soft); --ink: var(--auth-ink); --muted: var(--auth-muted); --border: var(--auth-border); --blue: var(--auth-primary); --blue-hover: var(--auth-primary-hover); --blue-soft: var(--auth-primary-soft); --action: var(--blue); --action-ink: var(--auth-canvas); --bg: var(--auth-canvas); display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); min-height: 100svh; background: var(--auth-canvas); color: var(--ink); color-scheme: light; }
.auth-visual { display: flex; flex-direction: column; justify-content: space-between; align-items: flex-start; min-width: 0; gap: 40px; padding: 48px; overflow: hidden; background: linear-gradient(135deg, var(--auth-visual-start), var(--auth-visual-mid) 50%, var(--auth-visual-end)); color: var(--auth-canvas); }
.auth-brand { display: inline-flex; align-items: center; gap: 12px; min-height: 44px; max-width: 100%; font-size: 20px; font-weight: 700; line-height: 28px; }
.auth-brand > span { min-width: 0; overflow-wrap: anywhere; }
.auth-brand-mark { display: grid; flex: none; place-items: center; width: 36px; height: 36px; border-radius: 8px; background: var(--auth-brand-wash); }
.auth-visual > :deep(.login-characters) { align-self: center; margin-block: 40px; }
.auth-visual-footer { display: flex; align-items: center; flex-wrap: wrap; gap: 32px; font-size: 12px; }
.auth-visual-footer a { display: inline-flex; align-items: center; min-height: 44px; }
.auth-visual-footer a:hover { text-decoration: underline; text-underline-offset: 4px; }
.auth-panel { display: flex; align-items: center; justify-content: center; min-width: 0; padding: 48px 32px; }
.auth-form { width: 100%; max-width: 420px; }
.auth-mobile-brand { display: none; }
.auth-heading { justify-content: center; min-height: 0; margin-bottom: 40px; text-align: center; }
.auth-heading h1 { font-size: 30px; line-height: 40px; font-weight: 700; min-width: 0; overflow-wrap: break-word; text-wrap: balance; }
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
.auth-register-form { gap: 16px; }
.auth-registration .auth-heading { margin-bottom: 24px; }
.registration-code-row { display: grid; grid-template-columns: minmax(0, 1fr) 128px; gap: 8px; align-items: center; }
.registration-code-row .button { width: 100%; min-height: 48px; padding: 8px 12px; border-radius: 8px; font-size: 14px; white-space: nowrap; font-variant-numeric: tabular-nums; }
.registration-help { color: var(--muted); font-size: 12px; line-height: 20px; }
.registration-terms { display: flex; align-items: flex-start; gap: 8px; font-size: 12px; line-height: 20px; }
.registration-terms input { flex: none; margin-top: 4px; accent-color: var(--blue); }
.registration-terms label { min-height: 44px; }
.registration-terms a { color: var(--blue); text-decoration: underline; text-underline-offset: 4px; }
.auth-form .field { gap: 8px; font-size: 14px; color: var(--ink); }
.auth-form .control { width: 100%; min-width: 0; height: 48px; min-height: 48px; padding: var(--auth-control-padding); border: 1px solid var(--border); border-radius: 999px; background: var(--auth-canvas); color: var(--ink); font-size: 16px; line-height: 24px; }
.auth-form .control::placeholder { color: var(--muted); }
.auth-form .control:focus { border-color: var(--focus-ring); }
.auth-password { position: relative; display: block; width: 100%; }
.auth-password .control { padding-right: 56px; }
.auth-password-toggle { position: absolute; top: 2px; right: 5px; width: 44px; height: 44px; min-height: 44px; background: transparent; color: var(--muted); }
.auth-password-toggle:hover { background: transparent; color: var(--ink); }
.login-options { display: flex; justify-content: flex-end; min-height: 44px; }
.forgot-password { min-height: 44px; font-size: 14px; }
.auth-button { position: relative; display: flex; justify-content: center; width: 100%; height: 48px; min-height: 48px; padding: 8px 24px; border: 1px solid var(--auth-button-border); border-radius: 999px; overflow: hidden; background: var(--auth-canvas); color: var(--auth-ink); font-size: 16px; font-weight: 500; white-space: nowrap; }
.auth-button:enabled:is(:hover, :focus-visible) { border-color: var(--blue); background: var(--blue); color: var(--action-ink); }
.auth-octopus { align-items: center; gap: var(--auth-brand-gap); border-color: var(--blue); background: var(--blue); color: var(--auth-canvas); font-weight: 600; }
.auth-octopus:enabled:is(:hover, :focus-visible) { border-color: var(--blue-hover); background: var(--blue-hover); }
.auth-octopus-mark { flex: none; width: 24px; height: 24px; border-radius: 6px; object-fit: cover; }
.auth-browse { display: flex; justify-content: center; align-items: center; flex-wrap: wrap; gap: var(--auth-link-gap); margin-top: 32px; color: var(--muted); font-size: 14px; line-height: 24px; }
.auth-browse a { display: inline-flex; align-items: center; gap: 4px; min-height: 44px; color: var(--ink); font-weight: 500; }
.auth-browse a:hover { text-decoration: underline; text-underline-offset: 4px; }
.auth-back { min-height: 44px; margin-bottom: 16px; font-size: 14px; }
.auth-form > .notice-inline { margin: 0 0 24px; padding: 12px 16px; border: 1px solid var(--auth-notice-border); border-radius: 8px; background: var(--auth-notice-bg); color: var(--auth-notice-ink); }
.auth-form > .auth-feedback { border-color: var(--border); background: var(--surface-soft); color: var(--ink); }
.auth-form :deep(.password-recovery) { max-width: none; padding: 0; }
.auth-form :deep(.password-recovery h2) { display: none; }
.auth-form :deep(.password-recovery .control) { border-radius: 999px; background: var(--auth-canvas); font-size: 16px; }
.auth-form > .panel-section { margin: 0; padding: 0; border: 0; }
@media (max-width: 1023px) {
  .auth-page { grid-template-columns: minmax(0, 1fr); }
  .auth-visual { display: none; }
  .auth-panel { min-height: 100svh; padding: 40px 24px; }
  .auth-mobile-brand { display: flex; justify-content: center; margin-bottom: 48px; color: var(--ink); }
  .auth-mobile-brand .auth-brand-mark { background: var(--auth-brand-mobile); }
}
@media (max-width: 639px) {
  .auth-panel { padding: 32px 24px; }
  .auth-heading { margin-bottom: 32px; }
}

@media (max-width: 999px) {
  .settings-page { padding-top: 24px; }
  .settings-page .page-heading { display: none; }
  .settings-page .split-layout { grid-template-columns: minmax(0, 1fr); gap: 0; }
  .settings-sidebar { position: static; max-width: 760px; margin-inline: auto; width: 100%; }
  .settings-search { margin-bottom: 24px; min-height: 48px; }
  .account-tabs { display: grid; gap: 24px; }
  .settings-nav-group { gap: 0; }
  .settings-nav-group h2 { margin-inline: 0; }
  .settings-nav-item { min-height: 56px; border-radius: 0; padding-inline: 0; font-size: 14px; border-bottom: 1px solid var(--border); }
  .settings-nav-chevron { display: block; color: var(--muted); }
  .settings-sidebar-footer { margin-top: 32px; border-top: 0; padding-top: 0; }
  .settings-sidebar-footer .settings-nav-item { min-height: 48px; border-bottom: 0; }
  .settings-main { width: 100%; margin-inline: auto; }
  .balance-settings { gap: 8px; }
  .balance-settings .balance-panel { gap: 8px; padding-bottom: 4px; }
  .balance-actions { flex: none; gap: 4px; }
  .balance-actions .button { display: inline-flex; width: 44px; min-height: 44px; padding: 0; }
  .balance-actions .button > span { display: none; }
  .auth-page { --canvas: var(--p-bg); --surface: var(--p-surface); --surface-soft: var(--p-surface); --ink: var(--p-ink); --muted: var(--p-muted); --border: color-mix(in srgb, var(--p-ink) 20%, transparent); --blue: var(--p-action); --blue-hover: var(--p-action); --blue-soft: color-mix(in srgb, var(--p-action) 15%, transparent); --action-ink: var(--p-action-ink); background: var(--canvas); color: var(--ink); color-scheme: inherit; }
  .auth-panel { padding: 28px 24px; min-height: 100dvh; }
  .auth-mobile-brand { margin-bottom: 40px; }
  .auth-mobile-brand .auth-brand-mark { background: var(--surface); }
  .auth-form .control { border-radius: 12px; background: var(--surface); color: var(--ink); }
  .auth-button { border-radius: 12px; }
  .auth-octopus { color: var(--action-ink); }
}

</style>
