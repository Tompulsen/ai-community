import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Work } from './data'
import { isCurrentStudioMessage, uploadLimit, validateStudioWork } from './studio-share'

const user = { id: 'oldUser1', name: 'Creator', username: 'creator', bio: '', isAdmin: false, isModerator: false }
function makeWork(): Work {
  return { id: 'oldWork1', authorId: user.id, noteId: 'oldNote1', version: 3, fileIds: ['oldFile1'], title: 'A morning', author: 'Creator', avatar: 'C', kind: 'image', cover: '/files/oldFile1', tags: ['自然'], prompt: 'Morning light', model: 'image-model', likes: 9, date: '2026-11-12T00:00:00Z', owned: true, liked: false, saved: false, status: 'published' }
}
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.resetModules()
  vi.useFakeTimers()
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  vi.stubGlobal('localStorage', { getItem: () => { throw new Error('must not read preview storage') }, setItem: () => { throw new Error('must not write preview storage') } })
})
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals() })

describe('real API state', () => {
  it.each(['9', 'Sun, 22 Nov 2026 04:00:09 GMT'])('preserves task-query Retry-After as received (%s)', async retryAfter => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ message: 'Task query rate limited' }), {
      status: 429, headers: { 'Content-Type': 'application/json', 'Retry-After': retryAfter },
    }))
    const { api } = await import('./state')
    await expect(api('/api/creation/tasks/video/original-task')).rejects.toMatchObject({ status: 429, retryAfter })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
  it.each([['90', 90], ['invalid', undefined]])('preserves registration throttling without retrying or signing in (%s)', async (header, retryAfter) => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ success: false, message: '请稍后重试。' }), {
      status: 429, headers: { 'Content-Type': 'application/json', 'Retry-After': header as string },
    }))
    const { accountApi, session } = await import('./state')
    const body = { email: 'creator@example.com', turnstile_token: 'mail-challenge' }
    await expect(accountApi('registration-code', body)).rejects.toMatchObject({ status: 429, retryAfter })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith('/api/new-api/registration-code', expect.objectContaining({
      method: 'POST', credentials: 'same-origin', body: JSON.stringify(body),
    }))
    expect(session.user).toBeNull()
  })
  it('starts with no synthetic identity or local preview data', async () => {
    const { session } = await import('./state')
    expect(session.user).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it('hydrates the native account identity without creating another community login', async () => {
    fetchMock.mockResolvedValue(response({ user, csrfToken: 'csrf-value' }))
    const { session, loadSession } = await import('./state')
    await loadSession()
    expect(session.user).toEqual(user)
    expect(session.csrfToken).toBe('csrf-value')
    expect(fetchMock).toHaveBeenCalledWith('/api/session', expect.objectContaining({ credentials: 'same-origin' }))
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
  it('does not send duplicate session reads for simultaneous page startup', async () => {
    fetchMock.mockResolvedValue(response({ user: null }))
    const { loadSession } = await import('./state')
    await Promise.all([loadSession(), loadSession()])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
  it('distinguishes unknown, failed, retrying, authenticated and confirmed guest states', async () => {
    const { loadSession, sessionStatus } = await import('./state')
    expect(sessionStatus.value).toBe('loading')
    fetchMock.mockResolvedValueOnce(response({ message: 'Temporary outage' }, 503))
    await loadSession()
    expect(sessionStatus.value).toBe('error')
    let finishRead!: (value: Response) => void
    fetchMock.mockImplementationOnce(() => new Promise<Response>(resolve => { finishRead = resolve }))
    const retry = loadSession(true)
    expect(sessionStatus.value).toBe('loading')
    finishRead(response({ user }))
    await retry
    expect(sessionStatus.value).toBe('authenticated')
    fetchMock.mockResolvedValueOnce(response({ user: null }))
    await loadSession(true)
    expect(sessionStatus.value).toBe('guest')
  })
  it.each(['/api/session', '/api/account/session'])('leaves loading and allows retry when %s stalls', async stalledPath => {
    fetchMock.mockImplementation((path: string, options: RequestInit) => path === stalledPath
      ? new Promise<Response>((_, reject) => {
        options.signal!.addEventListener('abort', () => reject(options.signal!.reason), { once: true })
      })
      : response({ user: null, authentication: 'zhangyu' }))
    const { loadSession, session } = await import('./state')
    const pending = loadSession()
    await vi.advanceTimersByTimeAsync(20_000)
    expect(session.ready).toBe(true)
    expect(session.error).toContain('超时')
    expect(session.user).toBeNull()
    await pending
    fetchMock.mockResolvedValue(response({ user }))
    await loadSession(true)
    expect(session.error).toBe('')
    expect(session.user).toEqual(user)
    expect(vi.getTimerCount()).toBe(0)
  })
  it('preserves the current identity when a session refresh times out', async () => {
    fetchMock.mockImplementation((_: string, options: RequestInit) => new Promise<Response>((_, reject) => {
      options.signal!.addEventListener('abort', () => reject(options.signal!.reason), { once: true })
    }))
    const { loadSession, session } = await import('./state')
    session.user = { ...user }
    session.ready = true
    const pending = loadSession(true)
    await vi.advanceTimersByTimeAsync(20_000)
    expect(session.error).toContain('超时')
    await pending
    expect(session.user).toEqual(user)
  })
  it('preserves the last identity on temporary session failure but clears a confirmed expired session', async () => {
    const { session, loadSession } = await import('./state')
    session.user = { ...user }
    fetchMock.mockResolvedValueOnce(response({ message: 'Temporary outage' }, 503))
    await loadSession(true)
    expect(session.user).toEqual(user)
    expect(session.error).toBe('Temporary outage')
    fetchMock.mockResolvedValueOnce(response({ message: 'Session expired' }, 401))
    await loadSession(true)
    expect(session.user).toBeNull()
  })
  it('does not retain the old identity when a confirmed sign-out is followed by a sync failure', async () => {
    const { session, loadSession } = await import('./state')
    session.user = { ...user }
    fetchMock.mockResolvedValueOnce(response({ user: null, authentication: 'zhangyu' }))
      .mockResolvedValueOnce(response({ message: 'Sync unavailable' }, 503))
    await loadSession(true)
    expect(session.user).toBeNull()
  })
  it('commits a restored account once without briefly switching the page to a guest', async () => {
    const { watch } = await import('vue')
    const { session, loadSession } = await import('./state')
    session.user = { ...user }
    session.ready = true
    const identities: (string | undefined)[] = []
    const stop = watch(() => session.user?.id, value => identities.push(value), { flush: 'sync' })
    fetchMock.mockResolvedValueOnce(response({ user: null, authentication: 'zhangyu' }))
      .mockResolvedValueOnce(response({ user }))
      .mockResolvedValueOnce(response({ user }))
    await loadSession(true)
    stop()
    expect(session.user).toEqual(user)
    expect(identities).toEqual([])
    expect(session.loading).toBe(false)
  })
  it('rejects an old request without letting its late 401 overwrite a newly confirmed session', async () => {
    const { session, api, loadSession } = await import('./state')
    session.user = { ...user }
    let finish!: (value: Response) => void
    fetchMock.mockImplementationOnce(() => new Promise<Response>(resolve => { finish = resolve }))
      .mockResolvedValueOnce(response({ user }))
    const stale = api('/api/account')
    const failure = expect(stale).rejects.toMatchObject({ status: 401 })
    await loadSession(true)
    finish(response({ message: 'Session expired', code: 'AUTH_REQUIRED' }, 401))
    await failure
    expect(session.user).toEqual(user)
    fetchMock.mockResolvedValueOnce(response({ message: 'Session expired', code: 'AUTH_REQUIRED' }, 401))
    await expect(api('/api/account')).rejects.toMatchObject({ status: 401 })
    expect(session.user).toBeNull()
  })
  it('lets the active renewal settle identity when an older request returns 401 during synchronization', async () => {
    const { session, api, loadSession } = await import('./state')
    session.user = { ...user }
    let failOld!: (value: Response) => void, finishSync!: (value: Response) => void
    fetchMock.mockImplementationOnce(() => new Promise<Response>(resolve => { failOld = resolve }))
      .mockResolvedValueOnce(response({ user: null, authentication: 'zhangyu' }))
      .mockImplementationOnce(() => new Promise<Response>(resolve => { finishSync = resolve }))
      .mockResolvedValueOnce(response({ user }))
    const stale = api('/api/account')
    const failure = expect(stale).rejects.toMatchObject({ status: 401 })
    const pending = loadSession(true)
    await vi.waitFor(() => expect(session.restoring).toBe(true))
    failOld(response({ message: 'Expired', code: 'AUTH_REQUIRED' }, 401))
    await failure
    expect(session.user).toEqual(user)
    finishSync(response({ user }))
    await pending
    expect(session.user).toEqual(user)
    expect(session.restoring).toBe(false)
  })
  it.each(['guest', 'changed', 'timeout'])('finishes renewal safely for %s', async outcome => {
    const { session, loadSession } = await import('./state')
    session.user = { ...user }
    const nextUser = outcome === 'changed' ? { ...user, id: 'newUser2' } : null
    fetchMock.mockResolvedValueOnce(response({ user: null, authentication: 'zhangyu' }))
      .mockImplementationOnce((_: string, options: RequestInit) => outcome === 'timeout'
        ? new Promise<Response>((_, reject) => options.signal!.addEventListener('abort', () => reject(options.signal!.reason), { once: true }))
        : Promise.resolve(response({ user: nextUser }, outcome === 'guest' ? 401 : 200)))
      .mockResolvedValueOnce(response({ user: nextUser }))
    const pending = loadSession(true)
    await vi.advanceTimersByTimeAsync(outcome === 'timeout' ? 20000 : 0)
    await pending
    expect(session.user).toEqual(nextUser)
    expect(session.restoring).toBe(false)
    expect(session.loading).toBe(false)
  })
  it.each(['same', 'different-user', 'different-account', 'guest'])('waits for renewal before POST requests and checks the final identity: %s', async outcome => {
    const { session, api, loadSession } = await import('./state')
    session.user = { ...user, accountId: '17' }
    const nextUser = outcome === 'guest' ? null : { ...user, accountId: outcome === 'different-account' ? '18' : '17', id: outcome === 'different-user' ? 'newUser2' : user.id }
    let reads = 0, finishSync!: (value: Response) => void
    fetchMock.mockImplementation((path: string) => {
      if (path === '/api/session') return response({ user: reads++ ? nextUser : null, authentication: 'zhangyu', csrfToken: reads > 1 ? 'renewed-csrf' : 'guest-csrf' })
      if (path === '/api/account/session') return new Promise<Response>(resolve => { finishSync = resolve })
      return response({ ok: true })
    })
    const renewal = loadSession(true)
    await vi.waitFor(() => expect(session.restoring).toBe(true))
    const paths = ['/api/notifications/read-all', '/api/works/feed']
    const pending = paths.map(path => api(path, { method: 'POST', body: {} }).then(() => 'sent', error => error.message))
    expect(fetchMock.mock.calls.map(call => call[0])).toEqual(['/api/session', '/api/account/session'])
    finishSync(response({ user: nextUser }))
    await renewal
    expect(await Promise.all(pending)).toEqual(outcome === 'same' ? ['sent', 'sent'] : ['账号已切换，请重新操作。', '账号已切换，请重新操作。'])
    for (const path of paths) {
      const sent = fetchMock.mock.calls.filter(call => call[0] === path)
      expect(sent).toHaveLength(outcome === 'same' ? 1 : 0)
      if (outcome === 'same') expect(sent[0]![1].headers['X-CSRF-Token']).toBe('renewed-csrf')
    }
  })
  it('cancels a pending upload-limit request without occupying the upload queue', async () => {
    fetchMock.mockImplementation((_: string, options: RequestInit) => new Promise<Response>((_, reject) => {
      options.signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true })
    }))
    const { session, uploadFile } = await import('./state')
    session.user = user
    const controller = new AbortController()
    const pending = uploadFile(new File(['image'], 'picture.png', { type: 'image/png' }), controller.signal)
    controller.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]![1].signal).toBe(controller.signal)
  })
  it('never uploads into another account after waiting for upload limits', async () => {
    let resolve!: (value: Response) => void
    fetchMock.mockReturnValue(new Promise<Response>(done => { resolve = done }))
    const { session, uploadFile } = await import('./state')
    session.user = { ...user }
    const pending = uploadFile(new File(['image'], 'picture.png', { type: 'image/png' }))
    session.user = { ...user, id: 'otherUser' }
    resolve(response({ imagesMb: 20, maxFileSizeMb: 20 }))
    await expect(pending).rejects.toThrow('账号已变化')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
  it('does not begin a cancelled upload when its delayed limit read resolves', async () => {
    let resolve!: (value: Response) => void
    fetchMock.mockReturnValue(new Promise<Response>(done => { resolve = done }))
    const { session, uploadFile } = await import('./state')
    session.user = { ...user }
    const controller = new AbortController()
    const pending = uploadFile(new File(['image'], 'picture.png', { type: 'image/png' }), controller.signal)
    controller.abort()
    resolve(response({ imagesMb: 20, maxFileSizeMb: 20 }))
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
  it('adds JSON and CSRF headers to mutations without exposing a token in the body', async () => {
    fetchMock.mockResolvedValue(response({ work: makeWork() }))
    const { session, api } = await import('./state')
    session.csrfToken = 'csrf'
    await api('/api/works/oldWork1', { method: 'PATCH', body: { version: 3, title: 'Updated' } })
    expect(fetchMock).toHaveBeenCalledWith('/api/works/oldWork1', expect.objectContaining({
      method: 'PATCH', credentials: 'same-origin',
      headers: expect.objectContaining({ 'Content-Type': 'application/json', 'X-CSRF-Token': 'csrf' }),
      body: JSON.stringify({ version: 3, title: 'Updated' }),
    }))
  })
  it('rejects non-API addresses before sending credentials', async () => {
    const { api } = await import('./state')
    await expect(api('https://other.example/api/works')).rejects.toThrow('无效')
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it.each(['DELETE', 'POST', 'PATCH'] as const)('sends an empty JSON object for a %s without an explicit body', async method => {
    const { session, api } = await import('./state')
    session.csrfToken = 'csrf'
    fetchMock.mockImplementation(async (_path: string, options: RequestInit) => {
      if (new Headers(options.headers).get('Content-Type') !== 'application/json') return response({ message: '请使用正确的请求格式提交。' }, 415)
      if (options.body !== '{}') return response({ message: 'body must be object' }, 400)
      return response({ deleted: true })
    })
    await expect(api('/api/works/oldWork1/comments/comment1', { method })).resolves.toEqual({ deleted: true })
    expect(fetchMock).toHaveBeenCalledWith('/api/works/oldWork1/comments/comment1', expect.objectContaining({
      method, credentials: 'same-origin', body: '{}',
      headers: expect.objectContaining({ 'Content-Type': 'application/json', 'X-CSRF-Token': 'csrf' }),
    }))
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
  it('keeps GET requests bodyless and lets the browser encode multipart boundaries', async () => {
    const { api } = await import('./state')
    fetchMock.mockImplementation(async () => response({ ok: true }))
    await api('/api/works')
    const get = fetchMock.mock.calls[0]![1] as RequestInit
    expect(get.body).toBeUndefined()
    expect(new Headers(get.headers).has('Content-Type')).toBe(false)
    const body = new FormData()
    body.append('file', new File(['image'], 'image.png', { type: 'image/png' }))
    await api('/api/uploads', { method: 'POST', body })
    const upload = fetchMock.mock.calls[1]![1] as RequestInit
    expect(upload.body).toBe(body)
    expect(new Headers(upload.headers).has('Content-Type')).toBe(false)
  })
  it('clears the current identity on an expired session and reports the backend reason', async () => {
    fetchMock.mockResolvedValue(response({ error: { message: 'Session expired' } }, 401))
    const { session, api } = await import('./state')
    session.user = user
    await expect(api('/api/library')).rejects.toThrow('Session expired')
    expect(session.user).toBeNull()
  })
  it('reports unavailable services without automatically replaying the request', async () => {
    fetchMock.mockRejectedValue(new Error('offline'))
    const { api } = await import('./state')
    await expect(api('/api/lottery/draw', { method: 'POST', body: { requestId: 'same-id', count: 1 } })).rejects.toThrow('网络')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
  it('ignores a previous account request returning 401 after a background identity change', async () => {
    let resolve!: (value: Response) => void
    fetchMock.mockReturnValue(new Promise<Response>(done => { resolve = done }))
    const { session, api } = await import('./state')
    session.user = { ...user }
    const pending = api('/api/profile', { method: 'PATCH', body: { name: 'Saved' } })
    session.user = { ...user, id: 'newAccount' }
    resolve(response({ message: 'Expired', code: 'AUTH_REQUIRED' }, 401))
    await expect(pending).rejects.toThrow('Expired')
    expect(session.user?.id).toBe('newAccount')
  })
  it('does not change likes or claim success when the server refuses a mutation', async () => {
    fetchMock.mockResolvedValue(response({ message: 'Not allowed' }, 403))
    const { session, toggleWork, notice } = await import('./state')
    session.user = user
    const work = makeWork()
    expect(await toggleWork(work, 'liked')).toBe(false)
    expect(work.liked).toBe(false)
    expect(work.likes).toBe(9)
    expect(notice.value).toBe('Not allowed')
  })
  it('uses authoritative counts and identities returned by the server', async () => {
    const changed = { ...makeWork(), liked: true, likes: 14 }
    fetchMock.mockResolvedValue(response({ work: changed }))
    const { session, toggleWork } = await import('./state')
    session.user = user
    const work = makeWork()
    expect(await toggleWork(work, 'liked')).toBe(true)
    expect(work).toEqual(changed)
    expect(fetchMock).toHaveBeenCalledWith('/api/works/oldWork1/like', expect.objectContaining({ body: JSON.stringify({ active: true }) }))
  })
  it('blocks repeated clicks while a mutation is pending', async () => {
    let resolve!: (value: Response) => void
    fetchMock.mockReturnValue(new Promise<Response>(done => { resolve = done }))
    const { session, toggleWork } = await import('./state')
    session.user = user
    const work = makeWork()
    const first = toggleWork(work, 'saved')
    expect(await toggleWork(work, 'saved')).toBe(false)
    expect(work.saved).toBe(false)
    resolve(response({ work: { ...work, saved: true } }))
    expect(await first).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
  it('does not send an authenticated action for a guest', async () => {
    const { toggleWork } = await import('./state')
    expect(await toggleWork(makeWork(), 'saved')).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it('encodes filters and retains stable legacy work IDs', async () => {
    const { queryString, filterWorks } = await import('./state')
    expect(queryString({ query: '海边 & 山', cursor: undefined })).toBe('?query=%E6%B5%B7%E8%BE%B9+%26+%E5%B1%B1')
    expect(filterWorks([makeWork()], 'image', ' morning ', '自然')[0]?.id).toBe('oldWork1')
  })
  it('retains a valid invitation across navigation without changing unrelated storage', async () => {
    const values = new Map<string, string>([['studio-draft', 'keep']])
    vi.stubGlobal('sessionStorage', { getItem: (key: string) => values.get(key) || null, setItem: (key: string, value: string) => values.set(key, value) })
    const { rememberLotteryInvite } = await import('./state')
    expect(rememberLotteryInvite('oldUser1')).toBe('oldUser1')
    expect(rememberLotteryInvite()).toBe('oldUser1')
    expect(rememberLotteryInvite('../invalid')).toBe('oldUser1')
    expect(values.get('studio-draft')).toBe('keep')
  })
  it.each(['Ab9', '001234'])('keeps explicit affiliate code %s separate from legacy lottery IDs', async code => {
    const values = new Map<string, string>([['ai-community-next:invite', '17'], ['studio-draft', 'keep']])
    vi.stubGlobal('sessionStorage', { getItem: (key: string) => values.get(key) || null, setItem: (key: string, value: string) => values.set(key, value) })
    const { rememberReferralInvite, rememberLotteryInvite, accountCenterUrl, session } = await import('./state')
    session.accountUrl = 'https://accounts.example'
    expect(accountCenterUrl('register')).toBe('https://accounts.example/register')
    expect(rememberReferralInvite(code)).toBe(code)
    expect(rememberReferralInvite('../invalid')).toBe(code)
    expect(rememberReferralInvite()).toBe(code)
    expect(accountCenterUrl('register')).toBe(`https://accounts.example/register?aff=${code}`)
    expect(values.get('ai-community-next:invite')).toBe('17')
    expect(values.get('studio-draft')).toBe('keep')
    rememberLotteryInvite('wf' + 'a'.repeat(24))
    expect(accountCenterUrl('register')).toBe(`https://accounts.example/register?aff=${code}`)
  })
  it('keeps historical welfare links available for account-center registration', async () => {
    const code = 'wf' + 'a'.repeat(24), values = new Map<string, string>([['ai-community-next:invite', code]])
    vi.stubGlobal('sessionStorage', { getItem: (key: string) => values.get(key) || null, setItem: (key: string, value: string) => values.set(key, value) })
    const { accountCenterUrl, session } = await import('./state')
    session.accountUrl = 'https://accounts.example'
    expect(accountCenterUrl('register')).toBe(`https://accounts.example/register?aff=${code}`)
  })
  it('logs into the account service once and only accepts a confirmed community session', async () => {
    fetchMock.mockImplementation((path: string) => {
      if (path === '/api/new-api/login') return response({ success: true, data: { authenticated: true } })
      if (path === '/api/account/session') return response({ user })
      return response({ user, csrfToken: 'signed-in' })
    })
    const { login, session } = await import('./state')
    await login({ login: 'octopus-user', password: 'account-password', returnTo: '/create/image' })
    expect(fetchMock.mock.calls.map(([path]) => path)).toEqual(['/api/new-api/login', '/api/account/session', '/api/session'])
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toEqual({ username: 'octopus-user', password: 'account-password' })
    expect(JSON.parse(fetchMock.mock.calls[1]![1].body)).toEqual({ returnTo: '/create/image' })
    expect(session.user).toEqual(user)
  })
  it('does not synchronize or choose an identity until an explicit selection is submitted', async () => {
    const candidates = [{ selection_id: 'only-choice', username: 'creator', account_label: 'Account 7' }]
    fetchMock.mockImplementation((path: string) => path === '/api/new-api/login'
      ? response({ success: true, data: { requiresIdentitySelection: true, candidates, expiresAt: Math.floor(Date.now() / 1000) + 300 } })
      : path === '/api/new-api/login-select'
        ? response({ success: true, data: { requires2fa: true } })
        : response({ user }))
    const { login, session } = await import('./state')
    expect(await login({ login: 'shared-name', password: 'current-password' })).toMatchObject({ requiresIdentitySelection: true, candidates })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(session.user).toBeNull()
    expect(await login({ login: '', password: '', selectionId: 'only-choice' })).toEqual({ requires2fa: true })
    expect(fetchMock.mock.calls.map(([path]) => path)).toEqual(['/api/new-api/login', '/api/new-api/login-select'])
    expect(JSON.parse(fetchMock.mock.calls[1]![1].body)).toEqual({ selection_id: 'only-choice' })
    expect(session.user).toBeNull()
  })
  it('does not claim a successful login when account-to-community synchronization fails', async () => {
    fetchMock.mockImplementation((path: string) => path === '/api/new-api/login'
      ? response({ success: true, data: { authenticated: true } })
      : response({ message: 'Account mapping unavailable' }, 503))
    const { login, session } = await import('./state')
    await expect(login({ login: 'octopus-user', password: 'account-password' })).rejects.toThrow('Account mapping unavailable')
    expect(session.user).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
  it('finishes a confirmed guest session without synchronizing the account', async () => {
    fetchMock.mockResolvedValueOnce(response({ user: null, authentication: 'zhangyu', accountSyncRequired: false }))
    const { loadSession, session, sessionStatus } = await import('./state')
    session.user = user
    await Promise.all([loadSession(true), loadSession()])
    expect(fetchMock.mock.calls.map(([path]) => path)).toEqual(['/api/session'])
    expect(sessionStatus.value).toBe('guest')
    expect(session.user).toBeNull()
  })
  it('falls back to silent synchronization for servers without the sync hint', async () => {
    fetchMock.mockImplementation((path: string) => path === '/api/session'
      ? response({ user: null, csrfToken: 'visitor-csrf', authentication: 'zhangyu', accountUrl: 'https://accounts.example' })
      : response({ message: 'Login required' }, 401))
    const { loadSession, session, accountCenterUrl } = await import('./state')
    await Promise.all([loadSession(), loadSession()])
    expect(fetchMock.mock.calls.map(([path]) => path)).toEqual(['/api/session', '/api/account/session'])
    expect(session.user).toBeNull()
    expect(session.error).toBe('')
    expect(accountCenterUrl('forgot-password')).toBe('https://accounts.example/forgot-password')
  })
  it('synchronizes a newly signed-in native account after logout without requiring a page reload', async () => {
    const switchedUser = { ...user, id: '25', accountId: '25', username: 'another-account' }
    fetchMock.mockResolvedValueOnce(response({ user: null }))
      .mockResolvedValueOnce(response({ user: null, authentication: 'zhangyu', accountSyncRequired: true }))
      .mockResolvedValueOnce(response({ user: switchedUser }))
      .mockResolvedValueOnce(response({ user: switchedUser, authentication: 'zhangyu' }))
    const { loadSession, logout, session } = await import('./state')
    session.user = user
    await logout()
    await loadSession(true)
    expect(session.user).toEqual(switchedUser)
    expect(fetchMock.mock.calls.map(([path]) => path)).toEqual([
      '/api/session/logout', '/api/session', '/api/account/session', '/api/session',
    ])
    expect(fetchMock.mock.calls.every(([, options]) => options.credentials === 'same-origin')).toBe(true)
  })
  it('does not restore an old identity from an in-flight session read after logout', async () => {
    let finishRead!: (value: Response) => void
    fetchMock.mockImplementation((path: string) => path === '/api/session'
      ? new Promise<Response>(done => { finishRead = done })
      : response({ success: true }))
    const { loadSession, logout, session } = await import('./state')
    const pending = loadSession()
    await logout()
    finishRead(response({ user, csrfToken: 'old-csrf' }))
    await pending
    expect(session.user).toBeNull()
    expect(session.csrfToken).toBe('')
    expect(fetchMock.mock.calls[0]![1].signal.aborted).toBe(true)
  })
  it('does not let an old unauthorized response clear a newly logged-in identity', async () => {
    let finishOldRequest!: (value: Response) => void
    fetchMock.mockImplementation((path: string) => path === '/api/library'
      ? new Promise<Response>(done => { finishOldRequest = done })
      : path === '/api/new-api/login'
        ? response({ success: true, data: { authenticated: true } })
        : response({ user }))
    const { api, login, session } = await import('./state')
    const old = api('/api/library')
    await login({ login: 'octopus-user', password: 'account-password' })
    finishOldRequest(response({ message: 'Expired' }, 401))
    await expect(old).rejects.toThrow('Expired')
    expect(session.user).toEqual(user)
  })
  it('uses upstream verification only when requested and keeps community registration out of the flow', async () => {
    fetchMock.mockImplementation((path: string) => path === '/api/new-api/login'
      ? response({ success: true, data: { requires2fa: true } })
      : path === '/api/new-api/login-2fa'
        ? response({ success: true, data: { authenticated: true } })
        : response({ user }))
    const { login, session } = await import('./state')
    expect(await login({ login: 'octopus-user', password: 'account-password' })).toEqual({ requires2fa: true })
    expect(session.user).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await login({ login: '', password: '', code: '123456' })
    expect(fetchMock.mock.calls.map(([path]) => path)).toEqual([
      '/api/new-api/login', '/api/new-api/login-2fa', '/api/account/session', '/api/session',
    ])
    expect(session.user).toEqual(user)
  })
  it('keeps the displayed identity when logout fails and clears it only after a successful retry', async () => {
    fetchMock.mockResolvedValueOnce(response({ message: 'Unavailable' }, 503))
    const { logout, session } = await import('./state')
    session.user = user
    session.csrfToken = 'csrf-value'
    await expect(logout()).rejects.toThrow('Unavailable')
    expect(session.user).toEqual(user)
    expect(session.csrfToken).toBe('csrf-value')
    let finishLogout!: (value: Response) => void
    fetchMock.mockImplementationOnce(() => new Promise<Response>(done => { finishLogout = done }))
    const retry = logout()
    expect(session.user).toEqual(user)
    finishLogout(response({ user: null }))
    await retry
    expect(session.user).toBeNull()
    expect(session.csrfToken).toBe('')
    expect(session.ready).toBe(true)
    expect(fetchMock.mock.calls.map(([path]) => path)).toEqual(['/api/session/logout', '/api/session/logout'])
  })
})

describe('reused Studio bridge trust boundary', () => {
  const share = () => ({ category: 'image', title: 'A work', text: 'Prompt', model: 'model', files: [{ name: 'creation.png', blob: new Blob(['image'], { type: 'image/png' }) }] })
  it('accepts a bounded generated image and rejects malformed media or references', () => {
    expect(validateStudioWork(share())).toBe(true)
    expect(validateStudioWork({ ...share(), files: [{ name: '../private.png', blob: new Blob(['x'], { type: 'image/png' }) }] })).toBe(false)
    expect(validateStudioWork({ ...share(), files: [{ name: 'page.html', blob: new Blob(['x'], { type: 'text/html' }) }] })).toBe(false)
    expect(validateStudioWork({ ...share(), files: [{ name: 'image.png', blob: new Blob([new Uint8Array(uploadLimit + 1)], { type: 'image/png' }) }] })).toBe(false)
  })
  it('keeps source-comment sharing bound to a valid source and blocks video comments', () => {
    expect(validateStudioWork({ ...share(), destination: 'source-comment', resultId: 'result-1', generation: { prompt: 'P', model: 'M', sourceWorkId: 'oldWork1' } })).toBe(true)
    expect(validateStudioWork({ ...share(), destination: 'source-comment', resultId: 'result-1' })).toBe(false)
    expect(validateStudioWork({ ...share(), destination: 'source-comment', category: 'video', resultId: 'result-1', generation: { prompt: 'P', model: 'M', sourceWorkId: 'oldWork1' } })).toBe(false)
  })
  it('requires the actual frame, origin, context, attempt and verified identity', () => {
    const frame = {} as Window
    const identity = { context: 'context', attempt: 'attempt', subject: '7', userId: 'oldUser1' }
    const event = { source: frame, origin: 'https://community.example', data: { type: 'community-studio', ...identity } } as unknown as MessageEvent
    expect(isCurrentStudioMessage(event, frame, event.origin, identity, true)).toBe(true)
    expect(isCurrentStudioMessage({ ...event, source: {} } as MessageEvent, frame, event.origin, identity, true)).toBe(false)
    expect(isCurrentStudioMessage(event, frame, 'https://other.example', identity, true)).toBe(false)
    expect(isCurrentStudioMessage({ ...event, data: { ...event.data, userId: 'otherUser' } } as MessageEvent, frame, event.origin, identity, true)).toBe(false)
    expect(isCurrentStudioMessage({ ...event, data: { ...event.data, attempt: 'oldAttempt' } } as MessageEvent, frame, event.origin, identity, true)).toBe(false)
  })
})
