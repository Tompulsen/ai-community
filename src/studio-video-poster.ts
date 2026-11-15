// Adapted from octopus_chat app/utils/video-poster.ts (MIT).
let activeCaptures = 0
const waiting: { start: () => void; signal: AbortSignal }[] = []
function captureSlot(signal: AbortSignal): Promise<() => void> {
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    const aborted = () => { const index = waiting.indexOf(entry); if (index >= 0) waiting.splice(index, 1); reject(new DOMException('Cancelled', 'AbortError')) }
    const release = () => {
      activeCaptures--
      const next = waiting.shift()
      if (next) next.start()
    }
    const entry = { signal, start: () => { signal.removeEventListener('abort', aborted); activeCaptures++; resolve(release) } }
    if (activeCaptures < 2) entry.start()
    else { waiting.push(entry); signal.addEventListener('abort', aborted, { once: true }) }
  })
}
function frame(video: HTMLVideoElement): Promise<Blob | undefined> {
  const canvas = document.createElement('canvas')
  const scale = Math.min(1, 480 / Math.max(video.videoWidth, video.videoHeight))
  canvas.width = Math.max(1, Math.round(video.videoWidth * scale))
  canvas.height = Math.max(1, Math.round(video.videoHeight * scale))
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('视频封面暂时无法生成。')
  context.drawImage(video, 0, 0, canvas.width, canvas.height)
  const { data } = context.getImageData(0, 0, canvas.width, canvas.height)
  let sum = 0, squares = 0, peak = 0, count = 0
  for (let index = 0; index < data.length; index += 64) {
    const brightness = data[index]! * .2126 + data[index + 1]! * .7152 + data[index + 2]! * .0722
    sum += brightness; squares += brightness * brightness
    peak = Math.max(peak, data[index]!, data[index + 1]!, data[index + 2]!); count++
  }
  // Retain dark scenes with detail; skip only uniform blank black frames.
  if (sum / count < 10 && squares / count - (sum / count) ** 2 < 4 && peak < 24) return Promise.resolve(undefined)
  return new Promise(resolve => canvas.toBlob(blob => { canvas.width = canvas.height = 0; resolve(blob || undefined) }, 'image/webp', .8))
}
function waitForFrame(video: HTMLVideoElement, ready: () => boolean, signal: AbortSignal, deadline: number, start: () => void) {
  return new Promise<void>((resolve, reject) => {
    const events = ['loadedmetadata', 'loadeddata', 'canplay', 'seeked']
    const finish = (error?: Error) => {
      clearTimeout(timer)
      for (const event of events) video.removeEventListener(event, check)
      video.removeEventListener('error', failed); signal.removeEventListener('abort', aborted)
      if (error) reject(error); else resolve()
    }
    const failed = () => finish(new Error('视频封面无法解码，可重试或直接播放原视频。'))
    const aborted = () => finish(new DOMException('Cancelled', 'AbortError'))
    const check = () => { if (signal.aborted) aborted(); else if (video.error) failed(); else if (ready()) finish() }
    const timer = setTimeout(() => finish(new Error('视频封面生成超时，请重试。')), Math.max(0, deadline - Date.now()))
    if (signal.aborted) { aborted(); return }
    if (Date.now() >= deadline) { finish(new Error('视频封面生成超时，请重试。')); return }
    for (const event of events) video.addEventListener(event, check)
    video.addEventListener('error', failed); signal.addEventListener('abort', aborted, { once: true })
    try { start(); check() } catch { failed() }
  })
}
const posterSourceLimit = 64 * 1024 * 1024
async function posterSource(source: string, signal: AbortSignal): Promise<string> {
  const response = await fetch(source, { credentials: 'same-origin', signal })
  if (!response.ok || !response.body || !response.headers.get('content-type')?.startsWith('video/')) throw new Error('视频封面无法读取，可直接播放原视频。')
  if (Number(response.headers.get('content-length')) > posterSourceLimit) {
    await response.body.cancel()
    throw new Error('视频较大，请直接播放原视频。')
  }
  const reader = response.body.getReader(), chunks: Uint8Array<ArrayBuffer>[] = []
  let total = 0
  try {
    for (;;) {
      const part = await reader.read()
      if (part.done) break
      signal.throwIfAborted()
      total += part.value.byteLength
      if (total > posterSourceLimit) throw new Error('视频较大，请直接播放原视频。')
      chunks.push(new Uint8Array(part.value))
    }
    return URL.createObjectURL(new Blob(chunks, { type: response.headers.get('content-type')!.split(';')[0] }))
  } catch (error) { await reader.cancel().catch(() => {}); throw error }
  finally { reader.releaseLock() }
}
async function capturePoster(source: string, signal: AbortSignal): Promise<{ blob: Blob; duration: number }> {
  signal.throwIfAborted()
  const url = new URL(source, location.href)
  if (!['http:', 'https:', 'blob:', 'data:'].includes(url.protocol) || url.protocol === 'data:' && !source.startsWith('data:video/')) throw new Error('视频地址无效。')
  const video = document.createElement('video'), deadline = Date.now() + 12000
  const boundedSignal = AbortSignal.any([signal, AbortSignal.timeout(12000)])
  let originalUrl = ''
  video.preload = 'metadata'; video.muted = true; video.playsInline = true; video.crossOrigin = 'anonymous'
  try {
    // The existing safe public-media proxy does not forward Range. A bounded,
    // temporary Blob keeps seeking reliable without changing its trust boundary.
    if (['http:', 'https:'].includes(url.protocol)) originalUrl = await posterSource(url.href, boundedSignal)
    await waitForFrame(video, () => video.readyState >= 1, boundedSignal, deadline, () => { video.src = originalUrl || url.href; video.load() })
    const duration = video.duration
    if (!Number.isFinite(duration) || duration <= 0 || !video.videoWidth || !video.videoHeight) throw new Error('视频元数据无效，可直接播放原视频。')
    const last = Math.max(0, duration - Math.min(.05, duration / 100))
    const times = new Set([Math.min(.5, duration * .1), duration * .25, duration * .5].map(time => Math.min(time, last)))
    for (const time of times) {
      await waitForFrame(video, () => !video.seeking && video.readyState >= 2 && Math.abs(video.currentTime - time) < .01,
        boundedSignal, deadline, () => { video.currentTime = time })
      boundedSignal.throwIfAborted()
      const blob = await frame(video)
      boundedSignal.throwIfAborted()
      if (blob) return { blob, duration }
    }
    throw new Error('视频暂无可用封面，可直接播放原视频。')
  } catch (error) {
    if (!signal.aborted && boundedSignal.aborted) throw new Error('视频封面生成超时，请重试或直接播放原视频。')
    throw error
  } finally { video.pause(); video.removeAttribute('src'); video.load(); if (originalUrl) URL.revokeObjectURL(originalUrl) }
}
export async function extractVideoPoster(source: string, signal: AbortSignal): Promise<{ blob: Blob; duration: number }> {
  const release = await captureSlot(signal)
  try { return await capturePoster(source, signal) }
  finally { release() }
}
