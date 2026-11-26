import { randomUUID } from 'node:crypto'
import type { Queryable } from '../types.ts'

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
  return (await db.query<DurableRequest>('SELECT * FROM community_creation_request WHERE key=$1', [key])).rows[0]
}
export async function registerDurableRequest(db: Queryable, key: string, fingerprint: string, record: object, contractVersion = 1, legacy = false) {
  const owner = randomUUID()
  const result = await db.query<DurableRequest>(`INSERT INTO community_creation_request
    (key, fingerprint, contract_version, state, owner, record, next_poll)
    VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (key) DO NOTHING RETURNING *`,
  [key, fingerprint, contractVersion, legacy ? requestState(record) : 'preparing', owner, JSON.stringify(record), nextPoll(record)])
  return { inserted: result.rows.length === 1, row: result.rows[0] ?? (await readDurableRequest(db, key))! }
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
  const updated = await db.query<DurableRequest>(`UPDATE community_creation_request SET state='dispatch_intent',
    context=$4, record=$5, next_poll=$6, version=version+1, updated_at=now()
    WHERE key=$1 AND owner=$2 AND version=$3 AND state='preparing' AND next_poll>$7 RETURNING *`,
  [row.key, row.owner, row.version, JSON.stringify(context), JSON.stringify(record), nextPoll(record), Date.now()])
  if (!updated.rows[0]) throw new Error('Request preparation ownership expired')
  return updated.rows[0]
}
export async function savePreparingRequest(db: Queryable, row: DurableRequest, record: object) {
  const updated = await db.query<DurableRequest>(`UPDATE community_creation_request SET record=$4,
    version=version+1, updated_at=now() WHERE key=$1 AND owner=$2 AND version=$3
    AND state='preparing' AND next_poll>$5 RETURNING *`,
  [row.key, row.owner, row.version, JSON.stringify(record), Date.now()])
  if (!updated.rows[0]) throw new Error('Request preparation ownership expired')
  Object.assign(row, updated.rows[0])
}
export async function saveDurableRequest(db: Queryable, row: DurableRequest, record: object, next: number | null, beforeDispatch = false) {
  const result = await db.query<DurableRequest>(`UPDATE community_creation_request SET record=$4, state=$5,
    next_poll=$6, version=version+1, updated_at=now() WHERE key=$1 AND owner=$2 AND version=$3 RETURNING *`,
  [row.key, row.owner, row.version, JSON.stringify(record), beforeDispatch ? 'failed_before_dispatch' : requestState(record), next])
  if (!result.rows[0]) throw new Error('Request record ownership changed')
  Object.assign(row, result.rows[0])
}
export async function dueDurableRequests(db: Queryable) {
  return (await db.query<DurableRequest>(`SELECT * FROM community_creation_request WHERE next_poll<=$1 ORDER BY next_poll LIMIT 4`, [Date.now()])).rows
}
export async function claimDurablePoll(db: Queryable, row: DurableRequest) {
  return (await db.query<DurableRequest>(`UPDATE community_creation_request SET owner=$4, version=version+1,
    next_poll=$5, updated_at=now() WHERE key=$1 AND owner=$2 AND version=$3 AND next_poll<=$6 RETURNING *`,
  [row.key, row.owner, row.version, randomUUID(), Date.now() + 120000, Date.now()])).rows[0]
}
