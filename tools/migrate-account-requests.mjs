import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import pg from 'pg'
import { Redis } from 'ioredis'
import { parse } from 'yaml'
import { registerDurableRequest } from '../server/creation/request-store.ts'
import { getNewApiConfig } from '../server/native-account/config.ts'
import { AccountRequest } from '../server/native-account/http.ts'
import { accountRequest, getAuthenticatedSession } from '../server/native-account/client.ts'
import { closeNewApiRedis, getNewApiRedis } from '../server/native-account/session.ts'
import { reusableSystemToken } from '../server/native-account/model-groups.ts'
import { z } from 'zod'
import assert from 'node:assert/strict'

const args = process.argv.slice(2), apply = args.includes('--apply')
const manifestSchema = z.array(z.object({
  issuer: z.url(), userId: z.number().int().positive(), group: z.string().min(1).max(128).regex(/^[^\u0000-\u001f\u007f]+$/u),
  tokenId: z.number().int().positive().optional(), pendingName: z.string().regex(/^系统创建-[a-f0-9]{16}$/).optional(),
  search: z.boolean().optional(), verifiedSystemCreated: z.literal(true), evidence: z.string().trim().min(1),
}).refine(item => Boolean(item.tokenId) !== Boolean(item.pendingName))).max(128)
if (args.includes('--self-test')) {
  const verified = { issuer: 'https://accounts.example', userId: 17, group: 'auto', tokenId: 1, verifiedSystemCreated: true, evidence: 'operator audit' }
  assert.equal(manifestSchema.safeParse([verified]).success, true)
  for (const invalid of [{ ...verified, evidence: '' }, { ...verified, verifiedSystemCreated: false }, { ...verified, pendingName: '系统创建-0000000000000000' }, { ...verified, tokenId: -1 }])
    assert.equal(manifestSchema.safeParse([invalid]).success, false)
  console.log('Credential migration validation passed; no connections opened')
  process.exit(0)
}
const config = parse(await readFile(process.env.CONFIG_PATH || '.config/default.yml', 'utf8'))
const db = new pg.Pool({ host: config.db.host, port: config.db.port || 5432, user: config.db.user, password: config.db.pass,
  database: config.db.db, connectionTimeoutMillis: 8000, statement_timeout: 15000 })
const source = config.redis, prefix = `${source.prefix ?? new URL(config.url).host}:`
const redis = new Redis({ host: source.host, port: source.port || 6379, password: source.pass, username: source.username,
  db: source.db || 0, maxRetriesPerRequest: 1, connectTimeout: 8000 })
redis.on('error', () => {})
let requests = 0, credentials = 0
try {
  let cursor = '0'
  do {
    const [next, keys] = await redis.scan(cursor, 'MATCH', `${prefix}community-next:creation:request:*`, 'COUNT', 100)
    cursor = next
    for (const rawKey of keys) {
      const key = rawKey.slice(prefix.length)
      if (!/^community-next:creation:request:[a-f0-9]{64}:[A-Za-z0-9_-]{1,128}$/.test(key)) continue
      const raw = await redis.get(rawKey)
      if (!raw) continue
      const record = JSON.parse(raw)
      if (!/^[a-f0-9]{64}$/.test(record.fingerprint) || !['text', 'image', 'video'].includes(record.kind) || !record.result?.status)
        throw new Error('Invalid legacy request; migration stopped')
      if (apply) await registerDurableRequest(db, key, record.fingerprint, record, record.contractVersion ?? 1, true)
      requests++
    }
  } while (cursor !== '0')
  const manifestIndex = args.indexOf('--credentials')
  if (manifestIndex !== -1) {
    const manifest = manifestSchema.parse(JSON.parse(await readFile(args[manifestIndex + 1], 'utf8')))
    if (!process.env.COMMUNITY_MIGRATION_SESSION) throw new Error('COMMUNITY_MIGRATION_SESSION is required for live account verification')
    const req = new AccountRequest(new URL('/api/new-api/model-groups', config.url), {
      headers: { cookie: `octopus_new_api_session=${process.env.COMMUNITY_MIGRATION_SESSION}` },
    })
    const { session } = await getAuthenticatedSession(req, true)
    const { data: groups } = await accountRequest(req, '/api/user/self/groups', { reuseRequestSession: true })
    const { baseUrl } = getNewApiConfig()
    for (const item of manifest) {
      if (item.issuer !== baseUrl || item.userId !== session.user.id || !Object.hasOwn(groups, item.group)
        || item.verifiedSystemCreated !== true || typeof item.evidence !== 'string' || !item.evidence.trim())
        throw new Error('Credential provenance and account/group must be explicitly verified')
      const groupKey = `octopus:new-api:model-group:${createHash('sha256').update(JSON.stringify([baseUrl, item.userId, item.group])).digest('hex')}`
      let binding
      if (item.pendingName) {
        const previous = await getNewApiRedis()?.get(item.search ? `${groupKey}:web-search` : groupKey)
        const pending = previous ? JSON.parse(previous) : null
        if (!pending || pending.pendingName !== item.pendingName || !/^系统创建-[a-f0-9]{16}$/.test(pending.pendingName))
          throw new Error('Legacy pending creation does not match; no new key will be created')
        binding = pending
      } else {
        if (!Number.isSafeInteger(item.tokenId) || item.tokenId < 1) throw new Error('Invalid token ID')
        const { data: token } = await accountRequest(req, `/api/token/${item.tokenId}`, { reuseRequestSession: true })
        if (token?.id !== item.tokenId || !reusableSystemToken(token, item.userId, item.group))
          throw new Error('Token details do not match an eligible system credential')
        binding = { tokenId: item.tokenId }
      }
      if (apply) {
        const inserted = await db.query(`INSERT INTO community_group_credential (key,binding,provenance) VALUES ($1,$2,$3)
          ON CONFLICT (key) DO NOTHING RETURNING key`, [`${groupKey}:native`, JSON.stringify(binding), `operator-import: ${item.evidence}`])
        if (!inserted.rows.length) {
          const existing = await db.query('SELECT key FROM community_group_credential WHERE key=$1 AND binding=$2::jsonb', [`${groupKey}:native`, JSON.stringify(binding)])
          if (!existing.rows.length) throw new Error('A different durable binding already exists; preserved')
        }
      }
      credentials++
    }
  }
  console.log(JSON.stringify({ mode: apply ? 'applied' : 'dry-run', requests, credentials }))
} catch (error) {
  console.error(JSON.stringify({ status: 'migration-failed', code: error?.code || error?.name || 'Error' }))
  process.exitCode = 1
} finally {
  await Promise.allSettled([db.end(), redis.quit(), closeNewApiRedis()])
}
