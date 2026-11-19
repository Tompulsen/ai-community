import { z } from 'zod'

const integer = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
export const referralConfigSchema = z.object({
  version: integer.positive(), enabled: z.boolean(), inviterPoints: integer.positive().max(100000000),
  inviteePoints: integer.positive().max(100000000), updatedAt: integer,
})
export const referralRecordSchema = z.object({
  inviteeId: integer.positive(), inviterId: integer.positive(), configVersion: integer.positive(),
  inviterPoints: integer.positive(), inviteePoints: integer.positive(), boundAt: integer,
  state: z.enum(['waiting_topup', 'pending', 'credited']), creditedAt: integer,
})
export const referralStatusSchema = z.object({
  config: referralConfigSchema, code: z.string().regex(/^(?:wf[a-zA-Z0-9]{24})?$/), invited: integer,
  credited: integer, pending: integer, earnedPoints: integer, asInvitee: referralRecordSchema.nullable(),
  items: z.array(referralRecordSchema).max(20), nextCursor: integer,
})
export type ReferralConfig = z.infer<typeof referralConfigSchema>
export type ReferralStatus = z.infer<typeof referralStatusSchema> & { inviteUrl: string }
