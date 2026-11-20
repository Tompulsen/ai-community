import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { uploadWithProgress } from './upload-progress'

class FakeXHR {
  static current: FakeXHR
  upload = { onprogress: (_event: any) => {} }
  onload = () => {}; onerror = () => {}; ontimeout = () => {}; onabort = () => {}
  status = 200; responseText = '{"file":{"id":"file1"}}'; withCredentials = false; timeout = 0
  headers: Record<string, string> = {}
  open = vi.fn(); send = vi.fn(); abort = vi.fn(() => this.onabort())
  constructor() { FakeXHR.current = this }
  setRequestHeader(name: string, value: string) { this.headers[name] = value }
  getAllResponseHeaders() { return 'content-type: application/json\r\nx-upload: saved' }
}
beforeEach(() => vi.stubGlobal('XMLHttpRequest', FakeXHR))
afterEach(() => vi.unstubAllGlobals())

it('reports real byte progress, preserves cookie/CSRF headers and waits for the upload response', async () => {
  const progress = vi.fn(), body = new FormData(), finished = vi.fn()
  const promise = uploadWithProgress('/api/uploads', body, { Accept: 'application/json', 'X-CSRF-Token': 'csrf' }, undefined, progress)
  void promise.then(finished)
  const xhr = FakeXHR.current
  xhr.upload.onprogress({ lengthComputable: true, loaded: 5, total: 10 })
  xhr.upload.onprogress({ lengthComputable: true, loaded: 10, total: 10 })
  xhr.upload.onprogress({ lengthComputable: false })
  expect(progress.mock.calls).toEqual([[50], [100]])
  expect(finished).not.toHaveBeenCalled()
  expect(xhr.withCredentials).toBe(true); expect(xhr.headers['X-CSRF-Token']).toBe('csrf')
  expect(xhr.headers['Content-Type']).toBeUndefined()
  expect(xhr.send).toHaveBeenCalledWith(body); expect(xhr.timeout).toBe(600000)
  xhr.onload()
  const response = await promise
  expect(await response.json()).toEqual({ file: { id: 'file1' } })
  expect(response.headers.get('x-upload')).toBe('saved')
})

it('handles 204 and HTTP rejection responses without mistaking transport completion for success', async () => {
  for (const status of [204, 413]) {
    const promise = uploadWithProgress('/api/uploads', new FormData(), {}, undefined, vi.fn())
    FakeXHR.current.status = status; FakeXHR.current.onload()
    const response = await promise
    expect(response.status).toBe(status)
    expect(response.ok).toBe(status === 204)
    if (status === 204) expect(await response.text()).toBe('')
  }
})

it('settles aborts, network failures, timeouts and status zero rather than leaving requests pending', async () => {
  for (const event of ['onerror', 'ontimeout', 'onload'] as const) {
    const promise = uploadWithProgress('/api/uploads', new FormData(), {}, undefined, vi.fn())
    if (event === 'onload') FakeXHR.current.status = 0
    FakeXHR.current[event]()
    await expect(promise).rejects.toThrow(/上传/)
  }
  const controller = new AbortController()
  const promise = uploadWithProgress('/api/uploads', new FormData(), {}, controller.signal, vi.fn())
  controller.abort()
  await expect(promise).rejects.toMatchObject({ name: 'AbortError' })
  const alreadyAborted = uploadWithProgress('/api/uploads', new FormData(), {}, controller.signal, vi.fn())
  await expect(alreadyAborted).rejects.toMatchObject({ name: 'AbortError' })
  expect(FakeXHR.current.send).not.toHaveBeenCalled()
})
