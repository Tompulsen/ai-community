import { randomUUID } from 'node:crypto'
import type { Database, Queryable } from '../types.ts'
import { creationRetention } from '../../shared/studio/creation-limits.ts'
import { readImageConcurrencySettings } from '../settings.ts'

export const requestStoreEnabled = () => process.env.COMMUNITY_REQUEST_STORE === '1'
const v2Configured = () => process.env.COMMUNITY_REQUEST_V2 === '1' || !!process.env.COMMUNITY_REQUEST_V2_ACCOUNTS?.trim()
export function nativeRequestsEnabled(account: string | number | undefined) {
  return requestStoreEnabled() && (process.env.COMMUNITY_REQUEST_V2 === '1'
    || !!account && (process.env.COMMUNITY_REQUEST_V2_ACCOUNTS || '').split(',').includes(String(account)))
}
export interface DurableRequest {
  key: string
  fingerprint: string
  contract_version: number
  state: string
  version: number
  owner: string
  context: Record<string, unknown>
  record: Record<string, unknown>
  updated_at: Date | string
}
function retainRow(row: DurableRequest | undefined) {
  if (!row) return row
  const updated = new Date(row.updated_at).getTime()
  const timings = row.record.timings as { acceptedAt?: number } | undefined
  row.record.requestExpiresAt ??= (timings?.acceptedAt ?? updated) + creationRetention.request
  return row
}
export async function checkRequestSchema(db: Queryable) {
  if (!requestStoreEnabled()) {
    if (v2Configured()) throw new Error('COMMUNITY_REQUEST_STORE is required for v2')
    return
  }
  await db.query('SELECT key, fingerprint, contract_version, state, version, owner, context, record, next_poll FROM community_creation_request LIMIT 0')
  await db.query('SELECT key, binding, provenance, version FROM community_group_credential LIMIT 0')
  if (v2Configured() && process.env.COMMUNITY_CREDENTIAL_MIGRATION_CONFIRMED !== '1')
    throw new Error('Import legacy request records and verify credential provenance before enabling v2')
}
export async function readDurableRequest(db: Queryable, key: string) {
  return retainRow((await db.query<DurableRequest>('SELECT * FROM community_creation_request WHERE key=$1', [key])).rows[0])
}
export async function registerDurableRequest(db: Queryable, key: string, fingerprint: string, record: object, contractVersion = 1, legacy = false) {
  record = { requestExpiresAt: Date.now() + creationRetention.request, ...record }
  const owner = randomUUID()
  const result = await db.query<DurableRequest>(`INSERT INTO community_creation_request
    (key, fingerprint, contract_version, state, owner, record, next_poll)
    VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (key) DO NOTHING RETURNING *`,
  [key, fingerprint, contractVersion, legacy ? requestState(record) : 'preparing', owner, JSON.stringify(record), nextPoll(record)])
  return { inserted: result.rows.length === 1, row: retainRow(result.rows[0]) ?? (await readDurableRequest(db, key))! }
}
export async function registerImageRequest(db: Database, key: string, fingerprint: string,
  record: object, userId: string, namespace: string, imageCount: number, contractVersion = 1) {
  const prefix = `community-next:creation:request:${namespace}:`
  if (!/^[a-f0-9]{64}$/.test(namespace) || !key.startsWith(prefix) || !Number.isSafeInteger(imageCount) || imageCount < 1 || imageCount > 10)
    throw new Error('Invalid image admission request')
  const client = await db.connect()
  try {
    await client.query('BEGIN')
    const options = (await client.query<{ clientOptions: Record<string, unknown> }>('SELECT "clientOptions" FROM meta ORDER BY id LIMIT 1 FOR UPDATE')).rows[0]?.clientOptions
    if (!options) throw Object.assign(new Error('图片并发设置暂不可用，请稍后重试。'), { statusCode: 503, code: 'IMAGE_CONCURRENCY_UNAVAILABLE', notAccepted: true })
    const existing = await readDurableRequest(client, key)
    if (existing) { await client.query('COMMIT'); return { inserted: false, row: existing, options } }
    const settings = readImageConcurrencySettings(options.communityImageConcurrency)
    const counts = (await client.query<{ requests: string; images: string }>(`SELECT count(*) AS requests,
      COALESCE(sum(CASE WHEN left(key,length($1))=$1 THEN GREATEST(1,
        COALESCE((record->>'imageCount')::int,(context#>>'{resolved,n}')::int,1)) ELSE 0 END),0) AS images
      FROM community_creation_request WHERE record->>'kind'='image'
      AND record#>>'{result,status}' IN ('pending','indeterminate')
      AND (record->>'deadline')::bigint>$2`, [prefix, Date.now()])).rows[0]!
    const limit = Object.hasOwn(settings.userOverrides, userId) ? settings.userOverrides[userId]! : settings.defaultLimit
    if (Number(counts.images) + imageCount > limit)
      throw Object.assign(new Error(`当前账号最多同时生成 ${limit} 张图片，已有 ${counts.images} 张进行中，请等待已有任务完成后重试。`),
        { statusCode: 429, code: 'IMAGE_CONCURRENCY_LIMIT', retryAfter: 5, notAccepted: true })
    if (Number(counts.requests) >= settings.globalLimit)
      throw Object.assign(new Error(`全站同时进行的图片请求已达到 ${settings.globalLimit} 个，请稍后重试。`),
        { statusCode: 429, code: 'IMAGE_GLOBAL_LIMIT', retryAfter: 5, notAccepted: true })
    const registration = await registerDurableRequest(client, key, fingerprint, { ...record, imageCount }, contractVersion)
    await client.query('COMMIT')
    return { ...registration, options }
  } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error }
  finally { client.release() }
}
function nextPoll(record: object): number | null {
  const item = record as { result?: { status?: string }; deadline?: number }
  return item.result?.status === 'pending' ? item.deadline ?? Date.now() + 120000 : null
}
function requestState(record: object) {
  const status = (record as { result?: { status?: string } }).result?.status
  return status === 'pending' ? 'running' : status === 'succeeded' ? 'succeeded' : status === 'failed' ? 'failed' : 'indeterminate'
}
export async function dispatchDurableRequest(db: Queryable, row: DurableRequest, context: object, record: object) {
  record = { requestExpiresAt: row.record.requestExpiresAt, ...record }
  const updated = await db.query<DurableRequest>(`UPDATE community_creation_request SET state='dispatch_intent',
    context=$4, record=$5, next_poll=$6, version=version+1, updated_at=now()
    WHERE key=$1 AND owner=$2 AND version=$3 AND state='preparing' AND next_poll>$7 RETURNING *`,
  [row.key, row.owner, row.version, JSON.stringify(context), JSON.stringify(record), nextPoll(record), Date.now()])
  if (!updated.rows[0]) throw new Error('Request preparation ownership expired')
  return updated.rows[0]
}
export async function savePreparingRequest(db: Queryable, row: DurableRequest, record: object) {
  record = { requestExpiresAt: row.record.requestExpiresAt, ...record }
  const updated = await db.query<DurableRequest>(`UPDATE community_creation_request SET record=$4,
    version=version+1, updated_at=now() WHERE key=$1 AND owner=$2 AND version=$3
    AND state='preparing' AND next_poll>$5 RETURNING *`,
  [row.key, row.owner, row.version, JSON.stringify(record), Date.now()])
  if (!updated.rows[0]) throw new Error('Request preparation ownership expired')
  Object.assign(row, updated.rows[0])
}
export async function saveDurableRequest(db: Queryable, row: DurableRequest, record: object, next: number | null, beforeDispatch = false) {
  record = { requestExpiresAt: row.record.requestExpiresAt, ...record }
  const result = await db.query<DurableRequest>(`UPDATE community_creation_request SET record=$4, state=$5,
    next_poll=$6, version=version+1, updated_at=now() WHERE key=$1 AND owner=$2 AND version=$3 RETURNING *`,
  [row.key, row.owner, row.version, JSON.stringify(record), beforeDispatch ? 'failed_before_dispatch' : requestState(record), next])
  if (!result.rows[0]) throw new Error('Request record ownership changed')
  Object.assign(row, result.rows[0])
}
export async function expiredRequestCandidates(db: Queryable, now: number) {
  return (await db.query<DurableRequest>(`SELECT * FROM community_creation_request WHERE next_poll IS NULL AND (
    COALESCE((record->>'requestExpiresAt')::bigint,
      COALESCE((record#>>'{timings,acceptedAt}')::bigint, EXTRACT(EPOCH FROM updated_at)*1000)+$2) <= $1
    ) ORDER BY updated_at LIMIT 100`,
  [now, creationRetention.request])).rows.map(row => retainRow(row)!)
}
export async function deleteDurableRequest(db: Queryable, row: DurableRequest) {
  return (await db.query(`DELETE FROM community_creation_request WHERE key=$1 AND owner=$2 AND version=$3
    AND next_poll IS NULL RETURNING key`, [row.key, row.owner, row.version])).rows.length === 1
}
export async function dueDurableRequests(db: Queryable) {
  return (await db.query<DurableRequest>(`SELECT * FROM community_creation_request WHERE next_poll<=$1 ORDER BY next_poll LIMIT 4`, [Date.now()])).rows.map(row => retainRow(row)!)
}
export async function claimDurablePoll(db: Queryable, row: DurableRequest) {
  return (await db.query<DurableRequest>(`UPDATE community_creation_request SET owner=$4, version=version+1,
    next_poll=$5, record=$7, updated_at=now() WHERE key=$1 AND owner=$2 AND version=$3 AND next_poll<=$6 RETURNING *`,
  [row.key, row.owner, row.version, randomUUID(), Date.now() + 120000, Date.now(), JSON.stringify(retainRow(row)!.record)])).rows[0]
}
