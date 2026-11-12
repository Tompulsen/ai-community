<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Check, Link2, Save, UserRound, Wallet, LogIn, ArrowUpRight, ShieldCheck } from '@lucide/vue'
import { api, errorMessage, loadSession, login, rememberLotteryInvite, session, uploadFile } from '../state'
import AccountSecurity from '../components/AccountSecurity.vue'
import PasswordRecovery from '../components/PasswordRecovery.vue'
import ContentSkeleton from '../components/ContentSkeleton.vue'

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
const token = ref('')
const recoveryCode = ref('')
const name = ref('')
const bio = ref('')
const error = ref('')
const busy = ref(false)
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
  await loadSession()
  try {
    if (route.query.newapi === 'complete') await finishLink()
    else await loadAccount()
  } catch (cause) { error.value = errorMessage(cause) }
})
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
    window.location.assign(url.href)
  } catch (cause) { error.value = errorMessage(cause); busy.value = false }
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
  <div class="page-container settings-page">
    <div class="page-heading"><div><h1>账户设置</h1></div><span v-if="session.user" class="account-identity">@{{ session.user.username }}</span></div>
    <p v-if="error" class="notice-inline" role="alert">{{ error }}</p>
    <PasswordRecovery v-if="resetToken" :reset-token="resetToken" @done="resetToken = undefined" />
    <section v-else-if="pendingLink" class="panel-section stack"><h2>{{ pendingLink.requiresTotp ? '验证账号身份' : '确认连接章鱼账号' }}</h2><p v-if="pendingLink.requiresLinkConfirmation">将章鱼账号 {{ pendingLink.newApiUsername }} 连接至社区账号 {{ pendingLink.communityUsername }}。</p><label v-if="pendingLink.requiresTotp" class="field"><span>二步验证码</span><input v-model="mfaToken" class="control" autocomplete="one-time-code" inputmode="numeric" /></label><button class="button primary btn" :disabled="busy" @click="finishLink(!!pendingLink.requiresLinkConfirmation)">{{ busy ? '正在验证…' : pendingLink.requiresLinkConfirmation ? '确认连接' : '验证' }}</button></section>
    <ContentSkeleton v-else-if="!session.ready" layout="form" label="正在加载账号…" />
    <div v-else-if="!session.user" class="account-entry">
      <div class="account-entry-main">
        <section class="panel-section login-section">
          <div class="section-heading"><h2>登录社区</h2><LogIn :size="18" /></div>
          <form class="stack" @submit.prevent="signIn">
            <label class="field"><span>用户名或邮箱</span><input v-model="identifier" class="control" autocomplete="username" required :disabled="busy" /></label>
            <label class="field"><span>密码</span><input v-model="password" class="control" type="password" autocomplete="current-password" required :disabled="busy" /></label>
            <details class="login-factor"><summary class="text-link">二步验证</summary><div class="stack"><label class="field"><span>验证码</span><input v-model="token" class="control" autocomplete="one-time-code" inputmode="numeric" :disabled="busy" /></label><label class="field"><span>恢复码</span><input v-model="recoveryCode" class="control" autocomplete="off" :disabled="busy" /></label></div></details>
            <div class="login-actions"><button class="button primary btn" :disabled="busy"><LogIn :size="17" />{{ busy ? '正在登录…' : '登录' }}</button><button type="button" class="text-link" @click="forgot = !forgot">忘记社区密码</button></div>
          </form>
        </section>
        <PasswordRecovery v-if="forgot" />
      </div>
      <aside class="account-entry-side"><Link2 :size="24" /><h2>章鱼账号</h2><button class="button btn" :disabled="busy" @click="connect"><Link2 :size="17" />使用章鱼账号登录</button></aside>
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
.account-entry { display: grid; grid-template-columns: minmax(0, 520px) minmax(224px, 320px); gap: 64px; align-items: start; max-width: 960px; padding-top: 8px; }
.account-entry-main { min-width: 0; }
.login-section { border: 0; padding-top: 0; }
.login-section > form { margin-top: 24px; }
.login-factor { border-block: 1px solid var(--border); padding-block: 16px; }
.login-factor summary { width: fit-content; min-height: 24px; }
.login-factor .stack { margin-top: 24px; gap: 16px; }
.login-actions { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 16px; padding-top: 8px; }
.login-actions .button { min-width: 128px; }
.account-entry-side { display: flex; flex-direction: column; gap: 24px; padding: 24px 0 24px 32px; border-left: 1px solid var(--border); color: var(--muted); }
.account-entry-side > svg { color: var(--blue); }
.account-entry-side h2 { font-size: 18px; line-height: 28px; color: var(--ink); }
.account-entry-side .button { align-self: start; }
@media (max-width: 899px) { .account-entry { grid-template-columns: minmax(0, 1fr); gap: 24px; max-width: 640px; } .account-entry-side { padding: 24px 0; border-left: 0; border-top: 1px solid var(--border); } }
@media (max-width: 639px) {
  .settings-page .split-layout { gap: 24px; }
  .account-tabs { gap: 4px; padding-bottom: 12px; }
  .account-tabs .tab { padding-inline: 12px; }
  .profile-images { grid-template-columns: minmax(0, 1fr); gap: 32px; }
  .settings-main:has(.account-balance) { grid-template-columns: minmax(0, 1fr); gap: 24px; }
  .settings-main:has(.account-balance) > .panel-section + .panel-section { padding: 24px 0 0; border-left: 0; border-top: 1px solid var(--border); }
  .login-actions .button { flex: 1; }
  .account-entry-side .button { width: 100%; }
}
</style>
