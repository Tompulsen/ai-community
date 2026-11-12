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
  it('starts with no synthetic identity or local preview data', async () => {
    const { session } = await import('./state')
    expect(session.user).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it('hydrates the legacy identity using an HttpOnly-cookie request', async () => {
    fetchMock.mockResolvedValue(response({ user, csrfToken: 'csrf-value' }))
    const { session, loadSession } = await import('./state')
    await loadSession()
    expect(session.user).toEqual(user)
    expect(session.csrfToken).toBe('csrf-value')
    expect(fetchMock).toHaveBeenCalledWith('/api/session', expect.objectContaining({ credentials: 'same-origin' }))
  })
  it('does not send duplicate session reads for simultaneous page startup', async () => {
    fetchMock.mockResolvedValue(response({ user: null }))
    const { loadSession } = await import('./state')
    await Promise.all([loadSession(), loadSession()])
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
  it('logs into the account service once and only accepts a confirmed community session', async () => {
    fetchMock.mockImplementation((path: string) => {
      if (path === '/studio/api/new-api/login') return response({ success: true, data: { authenticated: true } })
      if (path === '/api/account/session') return response({ user })
      return response({ user, csrfToken: 'signed-in' })
    })
    const { login, session } = await import('./state')
    await login({ login: 'octopus-user', password: 'account-password', returnTo: '/create/image' })
    expect(fetchMock.mock.calls.map(([path]) => path)).toEqual(['/studio/api/new-api/login', '/api/account/session', '/api/session'])
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toEqual({ username: 'octopus-user', password: 'account-password' })
    expect(JSON.parse(fetchMock.mock.calls[1]![1].body)).toEqual({ returnTo: '/create/image' })
    expect(session.user).toEqual(user)
  })
  it('does not claim a successful login when account-to-community synchronization fails', async () => {
    fetchMock.mockImplementation((path: string) => path === '/studio/api/new-api/login'
      ? response({ success: true, data: { authenticated: true } })
      : response({ message: 'Account mapping unavailable' }, 503))
    const { login, session } = await import('./state')
    await expect(login({ login: 'octopus-user', password: 'account-password' })).rejects.toThrow('Account mapping unavailable')
    expect(session.user).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
  it('silently synchronizes an existing account login and treats a normal guest as anonymous', async () => {
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
      : path === '/studio/api/new-api/login'
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
    fetchMock.mockImplementation((path: string) => path === '/studio/api/new-api/login'
      ? response({ success: true, data: { requires2fa: true } })
      : path === '/studio/api/new-api/login-2fa'
        ? response({ success: true, data: { authenticated: true } })
        : response({ user }))
    const { login, session } = await import('./state')
    expect(await login({ login: 'octopus-user', password: 'account-password' })).toEqual({ requires2fa: true })
    expect(session.user).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await login({ login: '', password: '', code: '123456' })
    expect(fetchMock.mock.calls.map(([path]) => path)).toEqual([
      '/studio/api/new-api/login', '/studio/api/new-api/login-2fa', '/api/account/session', '/api/session',
    ])
    expect(session.user).toEqual(user)
  })
  it('clears the displayed identity even when part of logout fails', async () => {
    fetchMock.mockImplementation((path: string) => path === '/api/session/logout'
      ? response({ message: 'Unavailable' }, 503) : response({ success: true }))
    const { logout, session } = await import('./state')
    session.user = user
    await expect(logout()).rejects.toThrow('部分登录状态')
    expect(session.user).toBeNull()
    expect(session.ready).toBe(true)
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
