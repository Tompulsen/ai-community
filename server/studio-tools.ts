import { createHash } from 'node:crypto'
import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'
import { z } from 'zod'
import { httpError } from './auth.ts'
import { AccountRequest, accountRequest } from './native-account/index.ts'
import { applicationRequest } from './web-request.ts'
import { retrieveSkillSources, SkillRetrievalError } from './creation/skills-retrieval.ts'
import { createClient, listTools, removeClient } from './mcp/client.ts'
import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import type { RequestContext } from './types.ts'

const sha = (value: string) => createHash('sha256').update(value).digest('hex')
const skillRoot = fileURLToPath(new URL('./skills/', import.meta.url))
const mcpClients = new Map<string, Promise<Client>>()
const configSchema = z.object({ mcpServers: z.record(z.string().regex(/^[\w-]{1,80}$/), z.object({
  command: z.string().min(1).max(300), args: z.array(z.string().max(4000)).max(100),
  env: z.record(z.string().max(100), z.string().max(4000)).optional(), status: z.enum(['active', 'paused', 'error']).optional(),
})) })
const id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/)
async function limited(ctx: RequestContext, name: string, limit: number) {
  const count = Number(await ctx.redis.eval('local n=redis.call("INCR",KEYS[1]); if n==1 then redis.call("EXPIRE",KEYS[1],60) end; return n', 1, `community-next:tools:rate:${name}:${sha(ctx.user!.id)}`))
  if (count > limit) throw httpError(429, '操作过于频繁，请稍后重试。')
}
async function catalog() {
  const directories = await readdir(skillRoot, { withFileTypes: true })
  return Promise.all(directories.filter(item => item.isDirectory() && /^[a-z0-9-]{1,64}$/.test(item.name) && item.name !== 'document-workspace').map(async item => {
    const body = await readFile(path.join(skillRoot, item.name, 'SKILL.md'), 'utf8')
    const metadata = parse(/^---\r?\n([\s\S]*?)\r?\n---/.exec(body)?.[1] || '') || {}
    return { id: item.name, name: String(metadata.name || item.name), description: String(metadata.description || '').slice(0, 500), body, sha256: sha(body) }
  }))
}
async function authorizeMcp(ctx: RequestContext, req: AccountRequest) {
  const allowed = (process.env.MCP_ADMIN_USER_IDS || '').split(',').map(value => value.trim())
  if (process.env.ENABLE_MCP !== 'true' || !ctx.user?.isAdmin || !allowed.includes(ctx.user.accountId || '')) throw httpError(403, 'MCP 未启用或没有操作权限。')
  const { data } = await accountRequest(req, '/api/user/self')
  if (String(data?.id) !== ctx.user.accountId || !Number.isInteger(data?.role) || data.role < 10) throw httpError(403, '没有 MCP 操作权限。')
}
function configPath(ctx: RequestContext) { return process.env.MCP_CONFIG_PATH || path.join(ctx.filesRoot, '.mcp-config.json') }
async function readConfig(ctx: RequestContext) {
  try { return configSchema.parse(JSON.parse(await readFile(configPath(ctx), 'utf8'))) }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { mcpServers: {} }; throw httpError(503, 'MCP 配置无法读取。') }
}
async function clientFor(ctx: RequestContext, name: string) {
  const config = (await readConfig(ctx)).mcpServers[name]
  if (!config || config.status === 'paused') throw httpError(409, 'MCP 服务未启用。')
  const key = sha(JSON.stringify([configPath(ctx), name, config]))
  let pending = mcpClients.get(key)
  if (!pending) {
    pending = createClient(name, config).catch(error => { mcpClients.delete(key); throw error })
    mcpClients.set(key, pending)
  }
  return pending
}
export async function modelMcpTools(ctx: RequestContext, req: AccountRequest, servers: string[]) {
  if (!servers.length) return []
  await authorizeMcp(ctx, req)
  const groups = await Promise.all([...new Set(servers)].map(async server => {
    const client = await clientFor(ctx, server), result = await listTools(client)
    return result.tools.slice(0, 100).flatMap(tool => typeof tool.name !== 'string' ? [] : [{
      server, originalName: tool.name,
      type: 'function',
      function: { name: `mcp_${sha(server + ':' + tool.name).slice(0, 40)}`, description: String(tool.description || '').slice(0, 4000), parameters: tool.inputSchema || { type: 'object', properties: {} } },
    }])
  }))
  return groups.flat().slice(0, 128)
}
export async function closeMcpClients() {
  const clients = [...mcpClients.values()]
  mcpClients.clear()
  await Promise.allSettled(clients.map(async item => removeClient(await item)))
}

export async function handleStudioTools(ctx: RequestContext, overrides: { retrieve?: typeof retrieveSkillSources } = {}): Promise<boolean> {
  if (!/^\/api\/creation\/(?:skills|search|mcp)(?:\/|$)/.test(ctx.url.pathname)) return false
  const user = ctx.requireUser()
  if (!user.accountId) throw httpError(409, '请先用章鱼账号登录。')
  if (ctx.req.headers['x-new-api-user'] !== undefined && ctx.req.headers['x-new-api-user'] !== user.accountId) throw httpError(409, '账号已切换，请重新操作。')
  const req = new AccountRequest(applicationRequest(ctx.request, ctx.reply, ctx.config.url))
  req.headers.set('x-new-api-user', user.accountId)
  if (ctx.req.method === 'GET' && ctx.url.pathname === '/api/creation/skills/catalog') {
    await limited(ctx, 'catalog', 20)
    ctx.json(200, { items: await catalog() })
    return true
  }
  if (ctx.req.method === 'POST' && ctx.url.pathname === '/api/creation/search') {
    await limited(ctx, 'search', 12)
    const input = z.object({ query: z.string().trim().min(1).max(2000), mode: z.enum(['quick', 'deep']), requestId: id }).safeParse(ctx.body)
    if (!input.success) throw httpError(400, '搜索参数无效。')
    const { query, mode, requestId } = input.data
    const key = `community-next:search:${sha(user.accountId)}:${requestId}`
    const fingerprint = sha(JSON.stringify({ query, mode }))
    const cached = await ctx.redis.get(key)
    if (cached) {
      const data = JSON.parse(cached)
      if (data.fingerprint !== fingerprint) throw httpError(409, '搜索请求编号已被使用。')
      if (!data.result) throw httpError(409, data.error || '搜索已提交，结果尚无法确认，请核对消费记录。')
      ctx.json(200, data.result)
      return true
    }
    if (await ctx.redis.set(key, JSON.stringify({ fingerprint }), 'EX', 30 * 86400, 'NX') !== 'OK') throw httpError(409, '搜索正在进行，请核对原请求。')
    try {
      // Detach paid search from browser cancellation, matching generation semantics.
      const result = await (overrides.retrieve || retrieveSkillSources)('web', query, AbortSignal.timeout(60000), req, mode)
      await ctx.redis.set(key, JSON.stringify({ fingerprint, result }), 'EX', 30 * 86400)
      ctx.json(200, result)
    } catch (error) {
      const detail = error instanceof SkillRetrievalError ? error.message : '搜索结果无法确认，请核对消费记录。'
      await ctx.redis.set(key, JSON.stringify({ fingerprint, error: detail }), 'EX', 30 * 86400)
      throw httpError(error instanceof SkillRetrievalError ? error.status : 502, detail)
    }
    return true
  }
  if (!ctx.url.pathname.startsWith('/api/creation/mcp/')) return false
  if (ctx.url.pathname === '/api/creation/mcp/status' && ctx.req.method === 'GET') {
    const enabled = process.env.ENABLE_MCP === 'true' && user.isAdmin && (process.env.MCP_ADMIN_USER_IDS || '').split(',').map(value => value.trim()).includes(user.accountId)
    if (!enabled) { ctx.json(200, { enabled: false, items: [] }); return true }
  }
  await authorizeMcp(ctx, req)
  await limited(ctx, 'mcp', 30)
  if (ctx.url.pathname === '/api/creation/mcp/status' && ctx.req.method === 'GET') {
    const config = await readConfig(ctx)
    ctx.json(200, { enabled: true, items: Object.entries(config.mcpServers).map(([name, item]) => ({ id: name, status: item.status || 'active' })) })
  } else if (ctx.url.pathname === '/api/creation/mcp/config' && ctx.req.method === 'POST') {
    const input = configSchema.safeParse(ctx.body)
    if (!input.success) throw httpError(400, 'MCP 配置格式无效。')
    await mkdir(path.dirname(configPath(ctx)), { recursive: true })
    await writeFile(configPath(ctx), JSON.stringify(input.data), { mode: 0o600 })
    await closeMcpClients()
    ctx.json(200, { ok: true })
  } else if (ctx.url.pathname === '/api/creation/mcp/tools' && ctx.req.method === 'GET') {
    const name = ctx.url.searchParams.get('server') || ''
    ctx.json(200, await listTools(await clientFor(ctx, name)))
  } else if (ctx.url.pathname === '/api/creation/mcp/call' && ctx.req.method === 'POST') {
    const input = z.object({ server: id.optional(), servers: z.array(id).max(8).optional(), name: z.string().min(1).max(200), arguments: z.record(z.string(), z.unknown()), requestId: id }).safeParse(ctx.body)
    if (!input.success) throw httpError(400, '工具调用参数无效。')
    const key = `community-next:mcp:${sha(user.accountId)}:${input.data.requestId}`
    const fingerprint = sha(JSON.stringify(input.data))
    const cached = await ctx.redis.get(key)
    if (cached) {
      const data = JSON.parse(cached)
      if (data.fingerprint !== fingerprint || !data.result) throw httpError(409, '工具调用已经提交，请先核对执行结果。')
      ctx.json(200, data.result); return true
    }
    const resolved = input.data.servers?.length ? (await modelMcpTools(ctx, req, input.data.servers)).find(item => item.function.name === input.data.name) : undefined
    const server = resolved?.server || input.data.server, name = resolved?.originalName || input.data.name
    if (!server) throw httpError(400, '工具服务无效。')
    const client = await clientFor(ctx, server)
    const tools = await listTools(client)
    if (!tools.tools.some(tool => tool.name === name)) throw httpError(400, '工具不存在。')
    if (await ctx.redis.set(key, JSON.stringify({ fingerprint }), 'EX', 86400, 'NX') !== 'OK') throw httpError(409, '工具已提交，请勿重复执行。')
    const result = await client.callTool({ name, arguments: input.data.arguments })
    if (JSON.stringify(result).length > 1024 ** 2) throw httpError(502, '工具结果过大，请在工具服务中查看。')
    await ctx.redis.set(key, JSON.stringify({ fingerprint, result }), 'EX', 86400)
    ctx.json(200, result)
  } else return false
  return true
}
