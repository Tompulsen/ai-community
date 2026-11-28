import { computed, reactive, ref, watch } from 'vue'
import type { SessionUser, Work, WorkFile } from './data'
import { readPreferences, rememberInterest } from './feed-preferences'
import { saveDiscoveryCache } from './discovery-cache'

export const session = reactive({
  user: null as SessionUser | null,
  ready: false,
  loading: false,
  restoring: false,
  error: '',
  csrfToken: '',
  accountUrl: '',
})
watch(() => session.ready ? session.user?.id || 'guest' : null, owner => {
  if (owner) { readPreferences(owner); saveDiscoveryCache(undefined) }
}, { flush: 'sync' })
export const sessionStatus = computed(() => session.user ? 'authenticated'
  : !session.ready || session.loading ? 'loading'
    : session.error ? 'error' : 'guest')
export const notice = ref('')
let noticeTimer: ReturnType<typeof setTimeout>
let sessionRequest: Promise<void> | undefined
let sessionController: AbortController | undefined
let sessionVersion = 0

export function notify(message: string) {
  notice.value = message
  clearTimeout(noticeTimer)
  noticeTimer = setTimeout(() => { notice.value = '' }, 3600)
}

export function canManageWork(work: Pick<Work, 'authorId'>) {
  return Boolean(session.user && (session.user.id === work.authorId || session.user.isAdmin))
}

export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : '请求失败，请稍后重试。'
}

export async function api<T>(path: string, options: {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  body?: unknown
  signal?: AbortSignal
  expectedAccount?: string
  priority?: RequestPriority
  onUploadProgress?: (percent: number) => void
} = {}): Promise<T> {
  if (!path.startsWith('/api/')) throw new Error('无效的接口地址。')
  const version = sessionVersion, userId = session.user?.id, accountId = session.user?.accountId
  if (session.restoring && options.method && options.method !== 'GET' && path !== '/api/account/session') {
    // Dialogs outside the page must also wait until the account is confirmed.
    await sessionRequest
    if (version !== sessionVersion || !session.user || session.user.id !== userId || session.user.accountId !== accountId) throw new Error('账号已切换，请重新操作。')
  }
  const owner = session.user
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (options.expectedAccount) headers['X-New-Api-User'] = options.expectedAccount
  const body = options.body === undefined && options.method && options.method !== 'GET' ? {} : options.body
  const multipart = body instanceof FormData
  if (body !== undefined && !multipart) headers['Content-Type'] = 'application/json'
  if (options.method && options.method !== 'GET' && session.csrfToken) headers['X-CSRF-Token'] = session.csrfToken
  let response: Response
  try {
    response = multipart && options.method === 'POST' && options.onUploadProgress
      ? await import('./upload-progress').then(({ uploadWithProgress }) => uploadWithProgress(path, body as FormData, headers, options.signal, options.onUploadProgress!))
      : await fetch(path, {
      method: options.method || 'GET',
      credentials: 'same-origin',
      headers,
      ...(options.priority ? { priority: options.priority } : {}),
      ...(body !== undefined ? { body: multipart ? body as FormData : JSON.stringify(body) } : {}),
      ...(options.signal ? { signal: options.signal } : {}),
    })
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error
    throw new Error('网络连接失败，请检查连接后重试。')
  }
  const result: unknown = response.status === 204 ? {} : await response.json().catch(() => null)
  if (!response.ok) {
    const payload = result as { message?: string; code?: string; error?: string | { message?: string; code?: string } } | null
    const code = typeof payload?.error === 'object' ? payload.error?.code || payload.code : payload?.code
    if (version === sessionVersion && owner === session.user && !session.restoring && response.status === 401 && (!code || code === 'AUTH_REQUIRED' || code === 'INVALID_CREDENTIALS')) session.user = null
    const detail = typeof payload?.error === 'string' ? payload.error : payload?.error?.message
    throw Object.assign(new Error(detail || payload?.message || (response.status === 401 ? '请先登录。' : `请求失败（${response.status}）。`)), { code, status: response.status, retryAfter: response.headers.get('Retry-After') })
  }
  if (result === null) throw new Error('服务器返回了无效的数据，请稍后重试。')
  return result as T
}

export interface UploadLimits { maxFileSizeMb: number; imagesMb: number; videosMb: number; filesMb: number }
let uploadLimits: UploadLimits | undefined
let limitsLoaded = 0
let limitsOwner: string | undefined
export async function getUploadLimits(signal?: AbortSignal, workId?: string): Promise<UploadLimits> {
  if (!workId && uploadLimits && limitsOwner === session.user?.id && Date.now() - limitsLoaded < 300000) return uploadLimits
  const owner = session.user?.id
  const value = await api<UploadLimits>(`/api/uploads/limits${queryString({ workId })}`, { signal, expectedAccount: owner })
  if (!workId && owner === session.user?.id) { uploadLimits = value; limitsOwner = owner; limitsLoaded = Date.now() }
  return value
}
export async function uploadFile(file: File, signal?: AbortSignal, onUploadProgress?: (percent: number) => void, workId?: string): Promise<WorkFile & { size: number }> {
  const owner = session.user?.id, version = sessionVersion
  const limits = await getUploadLimits(signal, workId)
  signal?.throwIfAborted()
  if (owner !== session.user?.id || version !== sessionVersion) throw new Error('账号已变化，请重新选择文件。')
  const mb = file.type.startsWith('image/') ? limits.imagesMb : file.type.startsWith('video/') ? limits.videosMb : limits.filesMb
  if (!file.size || file.size > mb * 1024 * 1024) throw new Error(`请选择非空文件，大小不超过 ${mb} MB。`)
  const body = new FormData()
  body.append('file', file, file.name)
  const result = await api<{ file: WorkFile & { size: number } }>(`/api/uploads${queryString({ workId })}`, { method: 'POST', body, signal, onUploadProgress, expectedAccount: owner })
  if (owner !== session.user?.id || version !== sessionVersion) throw new Error('账号已变化，请重新选择文件。')
  return result.file
}

export function safeExternalUrl(value?: string) {
  try { const url = new URL(value || ''); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : '' }
  catch { return '' }
}

export function queryString(values: Record<string, string | undefined>) {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(values)) if (value) params.set(key, value)
  const query = params.toString()
  return query ? `?${query}` : ''
}

export function rememberLotteryInvite(value?: unknown): string | undefined {
  const valid = (input: unknown): input is string => typeof input === 'string' && /^[a-zA-Z0-9]{1,32}$/.test(input)
  try {
    if (valid(value)) sessionStorage.setItem('ai-community-next:invite', value)
    const stored = sessionStorage.getItem('ai-community-next:invite')
    return valid(stored) ? stored : undefined
  } catch { return valid(value) ? value : undefined }
}

export function rememberReferralInvite(value?: unknown): string | undefined {
  const valid = (input: unknown): input is string => typeof input === 'string' && /^[a-zA-Z0-9]{1,32}$/.test(input)
  try {
    if (valid(value)) sessionStorage.setItem('ai-community-next:referral-invite', value)
    const stored = sessionStorage.getItem('ai-community-next:referral-invite')
    return valid(stored) ? stored : undefined
  } catch { return valid(value) ? value : undefined }
}

export interface AccountStatus {
  enabled: boolean
  configured: boolean
  publicUrl: string
  passwordLoginEnabled: boolean
  registerEnabled: boolean
  passwordRegisterEnabled: boolean
  emailVerificationEnabled: boolean
  userAgreementEnabled: boolean
  privacyPolicyEnabled: boolean
  turnstileSiteKey: string
}

export function accountCenterUrl(path: '' | 'register' | 'forgot-password' | 'user-agreement' | 'privacy-policy' = '') {
  try {
    const url = new URL(session.accountUrl)
    if (url.protocol !== 'https:' || url.username || url.password) return ''
    const target = new URL(`/${path}`, url.origin)
    const stored = rememberLotteryInvite()
    const invite = rememberReferralInvite() || (stored && /^wf[a-zA-Z0-9]{24}$/.test(stored) ? stored : undefined)
    if (path === 'register' && invite) target.searchParams.set('aff', invite)
    return target.href
  } catch { return '' }
}

export async function accountApi<T>(route: 'status' | 'session' | 'registration-code' | 'register' | 'login' | 'login-2fa' | 'login-select' | 'login-cancel' | 'login-identifiers' | 'logout' | 'model-groups' | 'model-groups/select', body?: object, expectedUser?: string): Promise<T> {
  let response: Response
  try {
    response = await fetch(`/api/new-api/${route}`, {
      method: body ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store',
      headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(expectedUser ? { 'X-New-Api-User': expectedUser } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(20000),
    })
  } catch { throw new Error('无法连接章鱼账号，请稍后重试。') }
  const result = await response.json().catch(() => null)
  if (!response.ok || result?.success !== true) {
    throw Object.assign(new Error(typeof result?.message === 'string' ? result.message : '章鱼账号服务暂时不可用，请稍后重试。'), {
      status: response.status, code: typeof result?.code === 'string' ? result.code : undefined,
      retryAfter: /^\d{1,6}$/.test(response.headers.get('retry-after') || '') ? Number(response.headers.get('retry-after')) : undefined,
    })
  }
  return result.data as T
}

export async function syncAccountSession(returnTo?: string, signal?: AbortSignal) {
  return api<{ user: SessionUser; returnTo?: string }>('/api/account/session', {
    method: 'POST', signal, body: { ...(returnTo ? { returnTo } : {}) },
  })
}

function invalidateSessionRead() {
  sessionVersion++
  session.loading = false
  session.restoring = false
  sessionController?.abort()
  sessionController = undefined
  sessionRequest = undefined
}

export async function loadSession(force = false) {
  if (sessionRequest) return sessionRequest
  if (session.ready && !force) return
  const version = sessionVersion
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(new Error('账号加载超时，请检查网络后重试。')), 20_000)
  session.loading = true
  sessionController = controller
  sessionRequest = (async () => {
    session.error = ''
    let missingSession = false
    try {
      type SessionResult = { user: SessionUser | null; csrfToken?: string; authentication?: string; accountUrl?: string }
      let result = await api<SessionResult>('/api/session', { signal: controller.signal })
      if (version !== sessionVersion) return
      session.csrfToken = result.csrfToken || ''
      session.accountUrl = result.accountUrl || session.accountUrl
      missingSession = !result.user
      if (!result.user && result.authentication === 'zhangyu') {
        // Commit the final identity once so renewal does not remount the current page.
        session.restoring = Boolean(session.user)
        try {
          await syncAccountSession(undefined, controller.signal)
          if (version !== sessionVersion) return
          result = await api<SessionResult>('/api/session', { signal: controller.signal })
        } catch (error) {
          if (version !== sessionVersion) return
          if ((error as { status?: number })?.status !== 401) throw error
        }
      }
      if (version !== sessionVersion) return
      session.user = result.user
      session.csrfToken = result.csrfToken || ''
    } catch (error) {
      if (version !== sessionVersion) return
      if (missingSession || (error as { status?: number }).status === 401) session.user = null
      session.error = errorMessage(controller.signal.aborted ? controller.signal.reason : error)
    } finally {
      clearTimeout(timeout)
      if (version === sessionVersion) {
        session.ready = true
        session.loading = false
        session.restoring = false
        sessionRequest = undefined
        sessionController = undefined
      }
    }
  })()
  return sessionRequest
}

export interface LoginIdentitySelection {
  requiresIdentitySelection: true
  candidates: { selection_id: string; username: string; account_label: string }[]
  expiresAt: number
}
export interface LoginIdentifiers { username: string; email: string; login_identifiers: string[] }
type LoginStep = LoginIdentitySelection | { requires2fa?: boolean; authenticated?: boolean }

export async function login(credentials: { login: string; password: string; turnstileToken?: string; code?: string; selectionId?: string; returnTo?: string }) {
  invalidateSessionRead()
  const version = sessionVersion
  session.user = null
  const result = credentials.selectionId
    ? await accountApi<LoginStep>('login-select', { selection_id: credentials.selectionId })
    : credentials.code
    ? await accountApi<LoginStep>('login-2fa', { code: credentials.code })
    : await accountApi<LoginStep>('login', {
      username: credentials.login, password: credentials.password,
      ...(credentials.turnstileToken ? { turnstile_token: credentials.turnstileToken } : {}),
    })
  if (version !== sessionVersion) throw new Error('登录状态已变化，请重新登录。')
  if (result && 'requiresIdentitySelection' in result && result.requiresIdentitySelection) return result
  if (result && 'requires2fa' in result && result.requires2fa) return { requires2fa: true }
  if (!result || !('authenticated' in result) || result.authenticated !== true) throw new Error('登录未完成，请重新尝试。')
  await syncAccountSession(credentials.returnTo)
  if (version !== sessionVersion) throw new Error('登录状态已变化，请重新登录。')
  invalidateSessionRead()
  await loadSession(true)
  if (!session.user) throw new Error(session.error || '登录未完成，请重新尝试。')
  return { requires2fa: false }
}

export async function logout() {
  invalidateSessionRead()
  await api('/api/session/logout', { method: 'POST', body: {} })
  session.user = null
  session.csrfToken = ''
  session.error = ''
  session.ready = true
}

export const pendingActions = reactive(new Set<string>())
export async function toggleWork(work: Pick<Work, 'id' | 'kind' | 'tags' | 'status' | 'destination' | 'liked' | 'saved' | 'likes'>, field: 'liked' | 'saved') {
  if (!session.user) { notify('请先登录后再操作。'); return false }
  const key = `${field}:${work.id}`
  if (pendingActions.has(key)) return false
  pendingActions.add(key)
  const owner = session.user.id
  try {
    const result = await api<{ work: Work }>(`/api/works/${encodeURIComponent(work.id)}/${field === 'liked' ? 'like' : 'save'}`, {
      method: 'POST', body: { active: !work[field] },
    })
    if (owner !== session.user?.id) return false
    Object.assign(work, result.work)
    if (work[field]) rememberInterest(owner, work, field)
    return true
  } catch (error) {
    notify(errorMessage(error))
    return false
  } finally {
    pendingActions.delete(key)
  }
}

export function filterWorks(works: Work[], kind: string, query: string, tag = '') {
  const needle = query.trim().toLocaleLowerCase()
  return works.filter(work => work.title && (kind === 'all' || work.kind === kind)
    && (!tag || work.tags.includes(tag))
    && (!needle || [work.title, work.author, ...work.tags, work.body || ''].join(' ').toLocaleLowerCase().includes(needle)))
}
