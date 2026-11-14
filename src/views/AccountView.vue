<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { onBeforeRouteLeave, onBeforeRouteUpdate, useRoute, useRouter } from 'vue-router'
import { ArrowLeft, ArrowRight, Check, ChevronDown, Eye, EyeOff, Image, LogOut, Palette, Save, Search, Upload, UserRound, Wallet, ArrowUpRight, ShieldCheck, LockKeyhole, X } from '@lucide/vue'
import type { SessionUser } from '../data'
import { site } from '../site'
import { accountApi, accountCenterUrl, api, errorMessage, loadSession, login, logout, session, uploadFile, type AccountStatus } from '../state'
import AccountSecurity from '../components/AccountSecurity.vue'
import AccountPrivacy from '../components/AccountPrivacy.vue'
import FollowRequests from '../components/FollowRequests.vue'
import AccountTheme from '../components/AccountTheme.vue'
import AccountWallet from '../components/AccountWallet.vue'
import PasswordRecovery from '../components/PasswordRecovery.vue'
import ContentSkeleton from '../components/ContentSkeleton.vue'
import LoginCharacters from '../components/LoginCharacters.vue'
import AccountTurnstile from '../components/AccountTurnstile.vue'
import { loginReturnPath } from '../login-navigation'

interface Account { linked: boolean; issuer?: string; subject?: string; balance: number | null; currency?: string; currencySymbol?: string; accountUrl?: string; studioReady?: boolean }
const route = useRoute()
const router = useRouter()
const settingTabs = ['profile', 'privacy', 'following', 'theme', 'security', 'balance']
const readTab = (value: unknown) => typeof value === 'string' && settingTabs.includes(value) ? value : 'profile'
const tab = ref(readTab(route.query.tab))
const privacyPanel = ref<InstanceType<typeof AccountPrivacy>>(), privacyDirty = ref(false)
const settingsQuery = ref(''), settingsNav = ref<HTMLElement>()
const avatarInput = ref<HTMLInputElement>(), bannerInput = ref<HTMLInputElement>()
const avatarFailed = ref(false), bannerFailed = ref(false)
const leaveDialog = ref<HTMLDialogElement>()
let resolveLeave: ((discard: boolean) => void) | undefined
const settingsItems = [
  { id: 'profile', label: '个人资料', icon: UserRound, group: '账号设置', keywords: '昵称 名称 头像 封面 简介 profile' },
  { id: 'privacy', label: '关注与隐私', icon: LockKeyhole, group: '账号设置', keywords: '关注 审批 粉丝 隐私 公开 privacy' },
  { id: 'security', label: '账号安全', icon: ShieldCheck, group: '账号设置', keywords: '密码 邮箱 验证 登录 设备 会话 security' },
  { id: 'balance', label: '账户与余额', icon: Wallet, group: '账号设置', keywords: '账户中心 余额 充值 钱包 balance' },
  { id: 'theme', label: '主题与外观', icon: Palette, group: '偏好设置', keywords: '明亮 暗色 主题 配色 外观 定时 跟随系统 theme' },
]
const settingsGroups = computed(() => {
  const query = settingsQuery.value.trim().toLocaleLowerCase()
  return ['账号设置', '偏好设置'].map(label => ({ label, items: settingsItems.filter(item => item.group === label && (!query || (item.label + item.keywords).toLocaleLowerCase().includes(query))) })).filter(group => group.items.length)
})
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
const uploading = ref<'avatar' | 'banner' | null>(null)
const baseline = ref(JSON.stringify(['', '', null, null]))
let profileOwner: string | undefined, profileOperation = 0
let profileUpload: AbortController | undefined
const profileValue = () => JSON.stringify([name.value, bio.value, avatarId.value, bannerId.value])
const dirty = computed(() => profileValue() !== baseline.value)
function navigateTab(value: string) {
  if (value !== tab.value) void router.push({ path: '/account', query: { tab: value } })
}
function confirmLeave() {
  if (!session.user || (!dirty.value && !uploading.value && !privacyDirty.value)) return true
  if (resolveLeave) return false
  leaveDialog.value?.showModal()
  return new Promise<boolean>(resolve => { resolveLeave = resolve })
}
function finishLeave(discard: boolean) {
  if (discard) {
    privacyPanel.value?.discard(); privacyDirty.value = false
    profileOperation++; profileUpload?.abort(); profileUpload = undefined
    restoreProfile(session.user); busy.value = false; uploading.value = null; saved.value = false
  }
  leaveDialog.value?.close(); resolveLeave?.(discard); resolveLeave = undefined
}
onBeforeRouteLeave(confirmLeave)
onBeforeRouteUpdate(confirmLeave)
function beforeUnload(event: BeforeUnloadEvent) {
  if (session.user && (dirty.value || uploading.value || privacyDirty.value)) { event.preventDefault(); event.returnValue = '' }
}
async function signOutFromSettings() {
  if (busy.value || !(await confirmLeave())) return
  busy.value = true; error.value = ''
  try { await logout() } catch (cause) { if (active) error.value = errorMessage(cause) }
  finally { if (active) busy.value = false }
}
function restoreProfile(user: SessionUser | null) {
  name.value = user?.name || user?.username || ''; bio.value = user?.bio || ''
  avatarId.value = user?.avatarId || null; bannerId.value = user?.bannerId || null
  avatarUrl.value = user?.avatarUrl || ''; bannerUrl.value = user?.bannerUrl || ''
  baseline.value = profileValue()
}
watch(() => session.user, user => {
  if (user?.id !== profileOwner) {
    if (resolveLeave) finishLeave(false)
    profileUpload?.abort(); profileUpload = undefined
    profileOwner = user?.id; profileOperation++
    account.value = null; saved.value = false; error.value = ''; busy.value = false; uploading.value = null
    restoreProfile(user)
  } else if (!busy.value && !dirty.value) restoreProfile(user)
}, { immediate: true, flush: 'sync' })
watch(() => route.query.tab, value => { tab.value = readTab(value) })
watch([tab, () => session.user?.id, settingsQuery], async () => {
  await nextTick()
  const nav = settingsNav.value, item = nav?.querySelector<HTMLElement>('[aria-current="page"]')
  if (nav && item && nav.scrollWidth > nav.clientWidth) nav.scrollLeft = item.offsetLeft - nav.offsetLeft - 8
}, { immediate: true })
watch(avatarUrl, () => { avatarFailed.value = false })
watch(bannerUrl, () => { bannerFailed.value = false })
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
onBeforeUnmount(() => { active = false; profileOperation++; profileUpload?.abort(); resolveLeave?.(false); window.removeEventListener('beforeunload', beforeUnload); window.removeEventListener('pageshow', restoreIdentity); window.removeEventListener('focus', refreshIdentity) })
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
  if (busy.value || !session.user || !name.value.trim()) return
  const owner = session.user.id, operation = ++profileOperation
  const current = () => active && operation === profileOperation && session.user?.id === owner
  busy.value = true
  saved.value = false
  error.value = ''
  try {
    const result = await api<{ user: SessionUser }>('/api/profile', { method: 'PATCH', body: { name: name.value.trim(), bio: bio.value.trim(), avatarId: avatarId.value, bannerId: bannerId.value } })
    if (!current()) return
    await loadSession(true)
    if (!current()) return
    const updated = result.user
    session.user = { ...session.user!, name: updated.name, bio: updated.bio, avatarId: updated.avatarId, bannerId: updated.bannerId, avatarUrl: updated.avatarUrl, bannerUrl: updated.bannerUrl }
    restoreProfile(session.user)
    saved.value = true
  } catch (cause) { if (current()) error.value = errorMessage(cause) }
  finally { if (current()) busy.value = false }
}
async function uploadProfile(event: Event, field: 'avatar' | 'banner') {
  const input = event.target as HTMLInputElement, file = input.files?.[0]
  if (!file || busy.value || !session.user) return
  const owner = session.user.id, operation = ++profileOperation
  const current = () => active && operation === profileOperation && session.user?.id === owner
  busy.value = true; uploading.value = field; error.value = ''; saved.value = false
  const controller = new AbortController(); profileUpload = controller
  try {
    if (!file.type.startsWith('image/')) throw new Error('请选择图片。')
    const uploaded = await uploadFile(file, controller.signal)
    if (!current()) return
    if (field === 'avatar') { avatarId.value = uploaded.id; avatarUrl.value = uploaded.url }
    else { bannerId.value = uploaded.id; bannerUrl.value = uploaded.url }
  } catch (cause) { if (current()) error.value = errorMessage(cause) }
  finally { if (profileUpload === controller) profileUpload = undefined; if (current()) { busy.value = false; uploading.value = null }; input.value = '' }
}
</script>

<template>
  <div :class="session.user ? 'page-container settings-page' : 'auth-page'">
    <aside v-if="!session.user" class="auth-visual">
      <RouterLink to="/discover" class="auth-brand" :aria-label="`${site.brand}首页`"><img v-if="site.logoUrl" class="auth-brand-mark" :src="site.logoUrl" width="36" height="36" alt="" /><span>{{ site.brand }}</span></RouterLink>
      <LoginCharacters :is-typing="isTyping" :show-password="showPassword" :password-length="password.length" />
      <div class="auth-visual-footer"><RouterLink to="/discover">发现作品</RouterLink><RouterLink to="/community?tab=announcements">社区公告</RouterLink></div>
    </aside>
    <div :class="{ 'auth-panel': !session.user }"><div :class="{ 'auth-form': !session.user }">
    <RouterLink v-if="!session.user" to="/discover" class="auth-brand auth-mobile-brand" :aria-label="`${site.brand}首页`"><img v-if="site.logoUrl" class="auth-brand-mark" :src="site.logoUrl" width="36" height="36" alt="" /><span>{{ site.brand }}</span></RouterLink>
    <div class="page-heading" :class="{ 'auth-heading': !session.user }"><div><h1>{{ session.user ? '账户设置' : resetRequested ? '找回章鱼账号密码' : requiresVerification ? '验证章鱼账号' : '欢迎回来！' }}</h1><p v-if="!session.user && !resetRequested">{{ requiresVerification ? '请输入章鱼账号要求的验证码' : '使用章鱼账号登录' }}</p></div><span v-if="session.user?.accountId && tab !== 'balance'" class="account-identity" aria-label="章鱼账号">账号ID:{{ session.user.accountId }} @{{ session.user.username }}</span></div>
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
    <div v-else class="split-layout">
      <aside class="settings-sidebar">
        <label class="search-control settings-search"><Search :size="17" aria-hidden="true" /><input v-model="settingsQuery" type="search" placeholder="搜索设置" aria-label="搜索设置" /></label>
        <nav ref="settingsNav" class="account-tabs" aria-label="账户设置">
          <div v-for="group in settingsGroups" :key="group.label" class="settings-nav-group"><h2>{{ group.label }}</h2><template v-for="item in group.items" :key="item.id">
            <button class="settings-nav-item" :class="{ active: tab === item.id }" :aria-current="tab === item.id ? 'page' : undefined" :aria-pressed="tab === item.id" @click="navigateTab(item.id)"><component :is="item.icon" :size="18" aria-hidden="true" /><span>{{ item.label }}</span><span v-if="item.id === 'profile' && dirty || item.id === 'privacy' && privacyDirty" class="draft-dot" title="有未保存的修改" aria-hidden="true" /></button>
          </template></div>
          <div v-if="!settingsGroups.length" class="settings-no-results" role="status"><p>没有找到相关设置</p><button type="button" class="text-link" @click="settingsQuery = ''">清除搜索</button></div>
        </nav>
        <div class="settings-sidebar-footer"><a v-if="centerUrl" :href="centerUrl" class="settings-nav-item" target="_blank" rel="noopener noreferrer"><ArrowUpRight :size="18" aria-hidden="true" /><span>章鱼账户中心</span></a><button type="button" class="settings-nav-item signout" :disabled="busy" @click="signOutFromSettings"><LogOut :size="18" aria-hidden="true" /><span>退出登录</span></button></div>
      </aside>
      <div class="settings-main">
        <section v-if="tab === 'profile'" class="panel-section profile-section">
          <div class="section-heading profile-heading"><div><h2>个人资料</h2><p class="form-note">设置你在社区中展示的公开信息。</p></div></div>
          <form id="profile-form" class="profile-form" @submit.prevent="saveProfile">
            <div class="profile-card">
              <div class="profile-cover"><img v-if="bannerUrl && !bannerFailed" :src="bannerUrl" alt="当前主页封面" @error="bannerFailed = true" /><div v-else class="profile-cover-empty"><Image :size="26" aria-hidden="true" /><span>{{ bannerFailed ? '封面暂时无法显示' : '添加一张属于你的主页封面' }}</span></div><button type="button" class="button cover-button btn" :disabled="busy" @click="bannerInput?.click()"><Image :size="16" aria-hidden="true" />更换封面</button></div>
              <div class="profile-avatar-area"><img v-if="avatarUrl && !avatarFailed" :src="avatarUrl" alt="当前头像" class="profile-avatar" @error="avatarFailed = true" /><div v-else class="profile-avatar profile-placeholder" :aria-label="avatarFailed ? '头像暂时无法显示' : '尚未设置头像'">{{ (name || session.user.username).slice(0, 1) }}</div><div class="profile-avatar-actions"><button type="button" class="button primary btn" :disabled="busy" @click="avatarInput?.click()"><Upload :size="16" aria-hidden="true" />更换头像</button><button v-if="avatarId" type="button" class="button subtle btn" :disabled="busy" @click="avatarId = null; avatarUrl = ''; saved = false">移除头像</button><button v-if="bannerId" type="button" class="button subtle btn" :disabled="busy" @click="bannerId = null; bannerUrl = ''; saved = false">移除封面</button></div><p class="form-note">头像与封面上传后，点击“保存资料”生效。</p></div>
            </div>
            <input id="profile-avatar" ref="avatarInput" hidden type="file" aria-label="头像" accept="image/jpeg,image/png,image/webp,image/gif,image/avif" :disabled="busy" @change="uploadProfile($event, 'avatar')" />
            <input id="profile-banner" ref="bannerInput" hidden type="file" aria-label="主页封面" accept="image/jpeg,image/png,image/webp,image/gif,image/avif" :disabled="busy" @change="uploadProfile($event, 'banner')" />
            <div class="profile-field-group"><label class="field"><span>显示名称</span><input v-model="name" class="control" autocomplete="nickname" maxlength="50" required :disabled="busy" aria-describedby="profile-name-help" @input="saved = false" /></label><div class="field-caption"><p id="profile-name-help">作为昵称显示在作品和个人主页。</p><span>{{ name.length }}/50</span></div></div>
            <div class="profile-field-group"><label class="field"><span>个人简介</span><textarea v-model="bio" class="control profile-bio" rows="6" maxlength="1500" :disabled="busy" aria-describedby="profile-bio-help" placeholder="介绍一下自己，或分享你的创作方向…" @input="saved = false" /></label><div class="field-caption"><p id="profile-bio-help">让大家更了解你。</p><span>{{ bio.length }}/1500</span></div></div>
            <details class="profile-preview"><summary><Eye :size="16" aria-hidden="true" />预览个人资料<ChevronDown class="preview-chevron" :size="16" aria-hidden="true" /></summary><div class="profile-preview-body"><strong>{{ name || session.user.username }}</strong><span>@{{ session.user.username }}</span><p>{{ bio || '还没有填写个人简介。' }}</p></div></details>
            <footer class="profile-savebar"><p class="profile-save-status" role="status"><Check v-if="saved" :size="15" aria-hidden="true" /><span v-else class="save-dot" :class="{ dirty }" aria-hidden="true" />{{ uploading ? '正在上传' + (uploading === 'avatar' ? '头像…' : '封面…') : busy ? '正在保存资料…' : saved ? '资料已保存' : dirty ? '有未保存的修改' : '资料已同步' }}</p><button class="button primary btn" :disabled="busy"><Save :size="16" aria-hidden="true" />{{ uploading ? '正在上传…' : busy ? '正在保存…' : '保存资料' }}</button></footer>
          </form>
        </section>
        <AccountPrivacy v-else-if="tab === 'privacy'" ref="privacyPanel" @dirty="privacyDirty = $event" />
        <FollowRequests v-else-if="tab === 'following'" />
        <AccountTheme v-else-if="tab === 'theme'" />
        <AccountSecurity v-else-if="tab === 'security'" />
        <div v-else class="balance-settings">
          <section class="panel-section balance-panel"><div class="section-heading"><h2>账户余额</h2><Wallet :size="20" aria-hidden="true" /></div><p class="account-balance">{{ account?.balance != null ? account.balance.toFixed(2) + ' ' + (account.currency || 'USD') : '--' }}</p><p v-if="account?.balance == null" class="muted caption-5">请在章鱼账户中心查看实时余额。</p><p v-else class="form-note">以章鱼账户中心实时余额为准。</p><div class="balance-actions"><a v-if="centerUrl" :href="centerUrl" class="button subtle btn" target="_blank" rel="noopener noreferrer">前往账户中心<ArrowUpRight :size="16" /></a><button class="button subtle btn" :disabled="busy" @click="loadAccount().catch(cause => error = errorMessage(cause))">刷新账户</button></div></section>
          <AccountWallet @refresh="loadAccount().catch(cause => error = errorMessage(cause))" />
        </div>
      </div>
    </div>
    <dialog v-if="session.user" ref="leaveDialog" class="compact-dialog" aria-labelledby="profile-leave-heading" @cancel.prevent="finishLeave(false)"><div class="dialog-heading"><h2 id="profile-leave-heading">{{ privacyDirty ? '保留隐私设置修改？' : '保留资料修改？' }}</h2><button class="icon-button" aria-label="关闭离开提示" @click="finishLeave(false)"><X :size="20" /></button></div><div class="dialog-body stack"><p>{{ privacyDirty ? '隐私设置尚未保存。离开后，未保存的修改将丢失。' : '资料尚未确认保存。离开后，未保存的文字和图片选择将丢失。' }}</p><div class="table-actions profile-leave-actions"><button class="button subtle btn" @click="finishLeave(true)">放弃修改并离开</button><button class="button primary btn" autofocus @click="finishLeave(false)">继续编辑</button></div></div></dialog>
    </div></div>
  </div>
</template>

<style scoped>
.settings-page { max-width: 1360px; }
.account-identity { min-width: 0; max-width: 100%; color: var(--muted); font-size: 14px; text-align: right; overflow-wrap: anywhere; }
.settings-page .split-layout { display: grid; grid-template-columns: 248px minmax(0, 1fr); gap: 40px; align-items: start; }
.settings-sidebar { position: sticky; top: calc(var(--header-height) + 24px); min-width: 0; }
.settings-search { width: 100%; min-height: 44px; margin-bottom: 24px; background: var(--surface); }
.account-tabs { display: grid; gap: 24px; min-width: 0; }
.settings-nav-group { display: grid; gap: 4px; }
.settings-nav-group h2 { margin: 0 12px 8px; color: var(--muted); font-size: 12px; line-height: 20px; font-weight: 400; }
.settings-nav-item { display: flex; align-items: center; gap: 12px; min-height: 44px; padding: 12px; border-radius: 6px; text-align: left; color: var(--muted); }
.settings-nav-item > span:first-of-type { flex: 1; }
.settings-nav-item > svg { flex-shrink: 0; }
.settings-nav-item:hover { background: var(--surface); color: var(--ink); }
.settings-nav-item.active { background: var(--blue-soft); color: var(--blue-hover); }
.draft-dot, .save-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--amber); flex-shrink: 0; }
.save-dot { background: var(--green); }
.save-dot.dirty { background: var(--amber); }
.settings-sidebar-footer { display: grid; gap: 4px; margin-top: 24px; padding-top: 20px; border-top: 1px solid var(--border); }
.settings-sidebar-footer .signout { color: var(--danger); }
.settings-no-results { display: grid; gap: 12px; padding: 16px 12px; color: var(--muted); }
.settings-no-results .text-link { justify-self: start; min-height: 44px; }
.settings-main { min-width: 0; }
.profile-section { padding-top: 0; border: 0; }
.profile-heading .form-note { margin-top: 8px; font-size: 14px; }
.profile-form { display: grid; gap: 24px; }
.profile-card { background: var(--surface); border-radius: 8px; overflow: hidden; }
.profile-cover { position: relative; height: 180px; background: var(--surface-soft); }
.profile-cover > img { width: 100%; height: 100%; object-fit: cover; }
.profile-cover-empty { height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; color: var(--muted); font-size: 12px; padding: 24px 16px 48px; }
.profile-cover .cover-button { position: absolute; top: 16px; right: 16px; background: var(--canvas); min-height: 44px; }
.profile-avatar-area { position: relative; display: flex; flex-direction: column; align-items: center; padding: 0 24px 24px; }
.profile-avatar { display: block; width: 96px; height: 96px; flex-shrink: 0; margin-top: -48px; border: 4px solid var(--surface); border-radius: 50%; object-fit: cover; background: var(--blue-soft); }
.profile-placeholder { display: grid; place-items: center; font-size: 32px; color: var(--blue-hover); }
.profile-avatar-actions { display: flex; justify-content: center; flex-wrap: wrap; gap: 8px; margin-top: 16px; }
.profile-avatar-actions .button { min-height: 44px; }
.profile-avatar-area > .form-note { margin-top: 12px; text-align: center; }
.profile-field-group { display: grid; gap: 8px; min-width: 0; }
.field-caption { display: flex; justify-content: space-between; align-items: baseline; gap: 16px; color: var(--muted); font-size: 12px; line-height: 20px; }
.field-caption > span { white-space: nowrap; font-variant-numeric: tabular-nums; }
.profile-form .control { background: var(--surface); }
.profile-bio { min-height: 168px; }
.profile-preview { background: var(--surface); border-radius: 6px; }
.profile-preview summary { display: flex; align-items: center; gap: 8px; min-height: 48px; padding: 12px 16px; cursor: pointer; }
.preview-chevron { margin-left: auto; color: var(--muted); }
.profile-preview[open] .preview-chevron { transform: rotate(180deg); }
.profile-preview-body { display: grid; gap: 8px; padding: 0 20px 20px; overflow-wrap: anywhere; }
.profile-preview-body > strong { font-size: 18px; font-weight: 500; }
.profile-preview-body > span { color: var(--muted); font-size: 12px; }
.profile-preview-body > p { white-space: pre-wrap; }
.profile-savebar { position: sticky; bottom: calc(var(--mobile-nav-height) + 12px); z-index: 5; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px; padding: 14px 20px; background: var(--surface-soft); border-radius: 8px; }
.profile-save-status { display: flex; align-items: center; gap: 8px; color: var(--muted); font-size: 12px; }
.profile-save-status > svg { color: var(--green); }
.profile-savebar .button { min-height: 44px; }
.profile-leave-actions { justify-content: end; flex-wrap: wrap; }
.balance-settings { display: grid; gap: 32px; }
.balance-settings > .panel-section { padding-top: 0; }
.balance-settings .balance-panel { padding: 24px; background: var(--surface); border-radius: 8px; border: 0; }
.account-balance { font-size: 32px; line-height: 40px; margin: 24px 0 8px; padding: 0; color: var(--ink); font-variant-numeric: tabular-nums; }
.balance-actions { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 24px; }
@media (max-width: 899px) {
  .settings-page .split-layout { grid-template-columns: minmax(0, 1fr); gap: 24px; }
  .settings-sidebar { position: static; }
  .settings-search { margin-bottom: 12px; }
  .account-tabs { display: flex; gap: 8px; overflow-x: auto; padding: 4px 2px 12px; }
  .settings-nav-group { display: contents; }
  .settings-nav-group h2 { display: none; }
  .settings-nav-item { flex-shrink: 0; }
  .settings-sidebar-footer { display: flex; flex-wrap: wrap; margin-top: 0; padding-top: 8px; gap: 8px; }
  .settings-sidebar-footer .settings-nav-item { padding-inline: 8px; font-size: 12px; }
}
@media (max-width: 639px) {
  .profile-cover { height: 160px; }
  .profile-cover-empty { padding: 60px 16px 48px; }
  .profile-cover-empty > svg { display: none; }
  .profile-avatar-area { padding-inline: 16px; }
  .profile-avatar { width: 88px; height: 88px; margin-top: -44px; }
  .profile-heading .form-note { font-size: 12px; }
  .profile-savebar { padding: 12px; bottom: var(--mobile-nav-height); }
  .profile-savebar .button { margin-left: auto; }
  .balance-settings .balance-panel { padding: 20px; }
}

.auth-page { --canvas: #fff; --surface: #fff; --surface-soft: #f8fafc; --ink: #101828; --muted: #667085; --border: #e4e7ec; --blue: #3f51b5; --blue-hover: #34449b; --blue-soft: #eef0fb; --action: var(--blue); --action-ink: #fff; --bg: #fff; display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); min-height: 100svh; background: #fff; color: var(--ink); color-scheme: light; }
.auth-visual { display: flex; flex-direction: column; justify-content: space-between; align-items: flex-start; min-width: 0; gap: 40px; padding: 48px; overflow: hidden; background: linear-gradient(135deg, #87909f, #6b7280 50%, #4b5563); color: #fff; }
.auth-brand { display: inline-flex; align-items: center; gap: 12px; min-height: 44px; max-width: 100%; font-size: 20px; font-weight: 700; line-height: 28px; }
.auth-brand > span { min-width: 0; overflow-wrap: anywhere; }
.auth-brand-mark { display: grid; flex: none; place-items: center; width: 36px; height: 36px; border-radius: 8px; background: #ffffff1a; }
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
.auth-form .control:focus { border-color: var(--focus-ring); }
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
  .auth-panel { padding: 32px 24px; }
  .auth-heading { margin-bottom: 32px; }
}
</style>
