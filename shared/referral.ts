import { z } from 'zod'

const integer = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const amount = z.number().nonnegative().max(Number.MAX_SAFE_INTEGER)
export const referralConfigSchema = z.object({
  version: integer.positive(), enabled: z.boolean(), inviterPoints: amount, inviteePoints: amount,
  inviterQuota: integer, inviteeQuota: integer, minTopupCny: amount.multipleOf(0.01), updatedAt: integer,
})
export const referralRecordSchema = z.object({
  inviteeId: integer.positive(), inviterId: integer.positive(), configVersion: integer,
  inviterPoints: amount, inviteePoints: amount, minTopupCny: amount.multipleOf(0.01), boundAt: integer,
  state: z.enum(['waiting_topup', 'pending', 'credited']), creditedAt: integer,
})
export const referralStatusSchema = z.object({
  config: referralConfigSchema, code: z.string().regex(/^[a-zA-Z0-9]{0,32}$/), invited: integer,
  credited: integer, pending: integer, waiting: integer, earnedPoints: amount, earnedQuota: integer,
  legacyInvited: integer, asInvitee: referralRecordSchema.nullable(),
  items: z.array(referralRecordSchema).max(20), nextCursor: integer,
})
export type ReferralConfig = z.infer<typeof referralConfigSchema>
export type ReferralStatus = z.infer<typeof referralStatusSchema> & { inviteUrl: string }
