export function uploadWithProgress(path: string, body: FormData, headers: Record<string, string>, signal: AbortSignal | undefined, progress: (percent: number) => void): Promise<Response> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    const abort = () => xhr.abort()
    const cleanup = () => signal?.removeEventListener('abort', abort)
    xhr.upload.onprogress = event => { if (event.lengthComputable && event.total > 0) progress(Math.min(100, Math.round(event.loaded / event.total * 100))) }
    xhr.onload = () => {
      cleanup()
      if (!xhr.status) { reject(new Error('上传连接中断，请重试。')); return }
      const responseHeaders = new Headers()
      for (const line of xhr.getAllResponseHeaders().trim().split(/[\r\n]+/)) {
        const colon = line.indexOf(':')
        if (colon > 0) responseHeaders.append(line.slice(0, colon), line.slice(colon + 1).trim())
      }
      resolve(new Response(xhr.status === 204 ? null : xhr.responseText, { status: xhr.status, headers: responseHeaders }))
    }
    xhr.onerror = () => { cleanup(); reject(new Error('上传连接中断，请重试。')) }
    xhr.ontimeout = () => { cleanup(); reject(new Error('上传超时，请重试。')) }
    xhr.onabort = () => { cleanup(); reject(new DOMException('上传已取消。', 'AbortError')) }
    if (signal?.aborted) { reject(new DOMException('上传已取消。', 'AbortError')); return }
    xhr.open('POST', path)
    xhr.withCredentials = true
    xhr.timeout = 10 * 60 * 1000
    for (const [name, value] of Object.entries(headers)) xhr.setRequestHeader(name, value)
    signal?.addEventListener('abort', abort, { once: true })
    xhr.send(body)
  })
}
