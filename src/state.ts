import { reactive, ref } from 'vue'
import type { SessionUser, Work, WorkFile } from './data'

export const session = reactive({
  user: null as SessionUser | null,
  ready: false,
  error: '',
  csrfToken: '',
})
export const notice = ref('')
let noticeTimer: ReturnType<typeof setTimeout>
let sessionRequest: Promise<void> | undefined

export function notify(message: string) {
  notice.value = message
  clearTimeout(noticeTimer)
  noticeTimer = setTimeout(() => { notice.value = '' }, 3600)
}

export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : '请求失败，请稍后重试。'
}

export async function api<T>(path: string, options: {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  body?: unknown
  signal?: AbortSignal
} = {}): Promise<T> {
  if (!path.startsWith('/api/')) throw new Error('无效的接口地址。')
  const headers: Record<string, string> = { Accept: 'application/json' }
  const multipart = options.body instanceof FormData
  if (options.body !== undefined && !multipart) headers['Content-Type'] = 'application/json'
  if (options.method && options.method !== 'GET' && session.csrfToken) headers['X-CSRF-Token'] = session.csrfToken
  let response: Response
  try {
    response = await fetch(path, {
      method: options.method || 'GET',
      credentials: 'same-origin',
      headers,
      ...(options.body !== undefined ? { body: multipart ? options.body as FormData : JSON.stringify(options.body) } : {}),
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
    if (response.status === 401 && (!code || code === 'AUTH_REQUIRED' || code === 'INVALID_CREDENTIALS')) session.user = null
    const detail = typeof payload?.error === 'string' ? payload.error : payload?.error?.message
    throw Object.assign(new Error(detail || payload?.message || (response.status === 401 ? '请先登录。' : `请求失败（${response.status}）。`)), { code })
  }
  if (result === null) throw new Error('服务器返回了无效的数据，请稍后重试。')
  return result as T
}

export interface UploadLimits { maxFileSizeMb: number; imagesMb: number; videosMb: number; filesMb: number }
let uploadLimits: UploadLimits | undefined
let limitsLoaded = 0
let limitsOwner: string | undefined
export async function getUploadLimits(): Promise<UploadLimits> {
  if (uploadLimits && limitsOwner === session.user?.id && Date.now() - limitsLoaded < 300000) return uploadLimits
  const owner = session.user?.id
  const value = await api<UploadLimits>('/api/uploads/limits')
  if (owner === session.user?.id) { uploadLimits = value; limitsOwner = owner; limitsLoaded = Date.now() }
  return value
}
export async function uploadFile(file: File, signal?: AbortSignal): Promise<WorkFile & { size: number }> {
  const limits = await getUploadLimits()
  const mb = file.type.startsWith('image/') ? limits.imagesMb : file.type.startsWith('video/') ? limits.videosMb : limits.filesMb
  if (!file.size || file.size > mb * 1024 * 1024) throw new Error(`请选择非空文件，大小不超过 ${mb} MB。`)
  const body = new FormData()
  body.append('file', file, file.name)
  return (await api<{ file: WorkFile & { size: number } }>('/api/uploads', { method: 'POST', body, signal })).file
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

export async function loadSession(force = false) {
  if (sessionRequest) return sessionRequest
  if (session.ready && !force) return
  sessionRequest = (async () => {
    session.error = ''
    try {
      const result = await api<{ user: SessionUser | null; csrfToken?: string }>('/api/session')
      session.user = result.user
      session.csrfToken = result.csrfToken || ''
    } catch (error) {
      session.user = null
      session.error = errorMessage(error)
    } finally {
      session.ready = true
      sessionRequest = undefined
    }
  })()
  return sessionRequest
}

export async function login(credentials: { login: string; password: string; token?: string; recoveryCode?: string }) {
  await api('/api/session/login', { method: 'POST', body: credentials })
  await loadSession(true)
  if (!session.user) throw new Error(session.error || '登录未完成，请重新尝试。')
}

export async function logout() {
  await api('/api/session/logout', { method: 'POST', body: {} })
  session.user = null
  session.csrfToken = ''
}

export const pendingActions = reactive(new Set<string>())
export async function toggleWork(work: Work, field: 'liked' | 'saved') {
  if (!session.user) { notify('请先登录后再操作。'); return false }
  const key = `${field}:${work.id}`
  if (pendingActions.has(key)) return false
  pendingActions.add(key)
  try {
    const result = await api<{ work: Work }>(`/api/works/${encodeURIComponent(work.id)}/${field === 'liked' ? 'like' : 'save'}`, {
      method: 'POST', body: { active: !work[field] },
    })
    Object.assign(work, result.work)
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
