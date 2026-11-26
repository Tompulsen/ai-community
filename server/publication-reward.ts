import { emptyLotteryProgress } from './business/lottery.ts'
import { readWelfareTasks, type PublicationProgress, type PublicationStatus } from '../shared/welfare-tasks.ts'
import { lotteryDay } from '../shared/lottery-daily.ts'
import type { Queryable } from './types.ts'

type Account = { balance: number; progress: Record<string, unknown> & { publication?: PublicationProgress } }
const emptyProgress = (): PublicationProgress => ({ count: 0, rewardedAt: null, rewardTickets: 0 })

export function publicationStatus(progress: PublicationProgress = emptyProgress(), now = new Date()): PublicationStatus {
  const day = lotteryDay(now)
  // Old rewarded records have no date; their award timestamp identifies the Beijing day.
  const date = progress.date ?? (progress.rewardedAt ? lotteryDay(new Date(progress.rewardedAt)).date : null)
  return { ...(date === day.date ? progress : emptyProgress()), date: day.date,
    resetsAt: day.end.toISOString(), serverTime: now.toISOString() }
}

export async function readPublicationStatus(db: Queryable, userId?: string): Promise<PublicationStatus | null> {
  if (!userId) return null
  const row = (await db.query<{ publication: PublicationProgress | null }>(
    `SELECT progress->'publication' AS publication FROM community_lottery_account WHERE "userId"=$1`, [userId])).rows[0]
  return publicationStatus(row?.publication ?? undefined)
}

// Called inside the publication transaction; a failed award rolls back publication too.
export async function rewardPublication(db: Queryable, workId: string, userId: string, newId: () => string, now = () => new Date()) {
  const first = await db.query(`UPDATE community_submission SET "firstPublishedAt"=clock_timestamp()
    WHERE id=$1 AND "authorId"=$2 AND destination='community' AND "firstPublishedAt" IS NULL RETURNING id`, [workId, userId])
  if (!first.rows.length) return
  // Publication already locks the author; do not reverse admin's meta -> user lock order.
  const meta = (await db.query<{ clientOptions: Record<string, unknown> }>('SELECT "clientOptions" FROM meta ORDER BY id LIMIT 1')).rows[0]
  if (!meta) throw new Error('Publication reward configuration unavailable')
  const rule = readWelfareTasks(meta.clientOptions?.communityWelfareTasks).find(item => item.id === 'publish')!.publicationReward!
  if (!rule.enabled) return
  await db.query('INSERT INTO community_lottery_account ("userId",balance,progress) VALUES ($1,0,$2::jsonb) ON CONFLICT ("userId") DO NOTHING', [userId, JSON.stringify(emptyLotteryProgress())])
  const account = (await db.query<Account>('SELECT balance,progress FROM community_lottery_account WHERE "userId"=$1 FOR UPDATE', [userId])).rows[0]
  if (!account) throw new Error('Publication reward account unavailable')
  // Read the clock after acquiring the account lock, including when another publication made us wait.
  const time = now(), status = publicationStatus(account.progress.publication, time)
  if (status.rewardedAt) return
  const progress: PublicationProgress = { date: status.date, count: status.count + 1, rewardedAt: null, rewardTickets: 0 }
  const awarded = progress.count >= rule.threshold ? rule.tickets : 0
  if (account.balance + awarded > 2147483647) throw Object.assign(new Error('抽奖次数已达上限，请联系管理员后重试。'), { statusCode: 409 })
  if (awarded) { progress.rewardedAt = time.toISOString(); progress.rewardTickets = awarded }
  account.progress.publication = progress
  await db.query('UPDATE community_lottery_account SET balance=$2,progress=$3::jsonb WHERE "userId"=$1', [userId, account.balance + awarded, JSON.stringify(account.progress)])
  if (awarded) await db.query('INSERT INTO moderation_log (id,"userId",type,info) VALUES ($1,$2,$3,$4::jsonb)',
    [newId(), userId, 'communityPublicationReward', JSON.stringify({ submissionId: workId, threshold: rule.threshold, tickets: awarded,
      rewardedAt: progress.rewardedAt, resetsAt: status.resetsAt })])
}
