import type { ServerResponse } from 'node:http'
import type { CreationEvent } from './stream.ts'

// A slow browser falls back to GET recovery; it must not stall the paid upstream.
export function createEventWriter(response: ServerResponse, append: boolean, maximum = 256 * 1024) {
  let queue: string[] = [], queuedBytes = 0, blocked = false, closed = false, ending = false
  let textLength = 0, reasoningLength = 0
  let timeout: ReturnType<typeof setTimeout> | undefined
  const cleanup = () => {
    closed = true; queue = []; queuedBytes = 0
    clearTimeout(timeout); clearInterval(heartbeat)
    response.off('drain', drain); response.off('close', cleanup); response.off('finish', cleanup); response.off('error', detach)
  }
  const detach = () => { cleanup(); response.destroy() }
  const write = (frame: string) => {
    if (closed || response.destroyed || response.writableEnded) return
    const bytes = Buffer.byteLength(frame)
    if (queuedBytes + response.writableLength + bytes > maximum) { detach(); return }
    if (blocked) { queue.push(frame); queuedBytes += bytes; return }
    if (!response.write(frame)) {
      blocked = true
      timeout = setTimeout(detach, 15_000)
    }
  }
  function drain() {
    clearTimeout(timeout); blocked = false
    while (queue.length && !blocked && !closed) {
      const frame = queue.shift()!
      queuedBytes -= Buffer.byteLength(frame)
      write(frame)
    }
    if (ending && !queue.length && !closed) { clearTimeout(timeout); timeout = setTimeout(detach, 15_000); response.end() }
  }
  const heartbeat = setInterval(() => { if (!blocked) write(': keepalive\n\n') }, 15_000)
  response.on('drain', drain); response.once('close', cleanup); response.once('finish', cleanup); response.once('error', detach)
  return {
    emit(event: CreationEvent) {
      if (closed) return
      if (append && event.type === 'delta') {
        const text = typeof event.text === 'string' ? event.text : ''
        const reasoning = typeof event.reasoning === 'string' ? event.reasoning : ''
        event = { ...event, append: true, text: text.slice(textLength), reasoning: reasoning.slice(reasoningLength) }
        textLength = text.length; reasoningLength = reasoning.length
      }
      write(`data: ${JSON.stringify(event)}\n\n`)
    },
    end() {
      ending = true; clearInterval(heartbeat)
      if (!queue.length && !closed) { clearTimeout(timeout); timeout = setTimeout(detach, 15_000); response.end() }
    },
  }
}
