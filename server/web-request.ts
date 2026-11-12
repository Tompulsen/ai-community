import { Readable } from 'node:stream'
import type { FastifyReply, FastifyRequest } from 'fastify'
import type { IncomingMessage } from 'node:http'

export function accountRequestFromNode(req: Pick<IncomingMessage, 'headers' | 'url' | 'method'>, origin: string, body?: unknown, signal?: AbortSignal) {
  const headers = new Headers()
  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) value.forEach(item => headers.append(key, item))
    else if (value !== undefined) headers.set(key, value)
  }
  headers.delete('content-length')
  const method = req.method || 'GET'
  return new Request(new URL(req.url || '/', origin), {
    method, headers, signal,
    ...(!['GET', 'HEAD'].includes(method) && body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
}

export function applicationRequest(request: FastifyRequest, reply: FastifyReply, origin: string) {
  const controller = new AbortController()
  const abort = () => controller.abort()
  request.raw.once('aborted', abort)
  reply.raw.once('close', () => { if (!reply.raw.writableEnded) abort() })
  reply.raw.once('finish', () => request.raw.removeListener('aborted', abort))
  return accountRequestFromNode(request.raw, origin, request.body, controller.signal)
}

export function sendWebResponse(reply: FastifyReply, response: Response) {
  reply.code(response.status)
  for (const [name, value] of response.headers) {
    if (!['set-cookie', 'content-encoding', 'content-length', 'transfer-encoding', 'connection'].includes(name)) reply.header(name, value)
  }
  const cookies = response.headers.getSetCookie()
  if (cookies.length) reply.header('Set-Cookie', cookies)
  if (!response.body) return reply.send()
  return reply.send(Readable.fromWeb(response.body as import('node:stream/web').ReadableStream))
}
