import { z } from 'zod'

export const maintenanceInput = z.object({
  title: z.string().trim().min(1).max(120),
  content: z.string().trim().min(1).max(10000),
  credits: z.number().int().min(1).max(1000000),
  rewardType: z.literal('timed').default('timed'),
  rewardValidityDays: z.number().int().min(1).max(365).default(30),
  startsAt: z.iso.datetime({ offset: true }),
  endsAt: z.iso.datetime({ offset: true }),
  popupMaxDisplays: z.number().int().min(1).max(100),
  popupIntervalMinutes: z.number().int().min(0).max(10080),
}).refine(value => Date.parse(value.endsAt) > Date.parse(value.startsAt), { message: '结束时间须晚于开始时间', path: ['endsAt'] })

export type MaintenanceInput = z.infer<typeof maintenanceInput>
export type MaintenanceBenefit = MaintenanceInput & {
  id: string; version: number; isActive: boolean; createdAt: string;
  recipientCount: number; claimedCount: number; pendingCount: number; totalDisplays: number
}
export type MaintenanceClaim = {
  credits: number; rewardValidityDays: number; status: 'pending' | 'fulfilled' | 'blocked';
  expiresAt: number | null; reference: string
}
export type MaintenanceOffer = { benefit: MaintenanceBenefit | null; claim: MaintenanceClaim | null }
export type MaintenanceRecord = { id: string; benefitId: string; title: string; claimedAt: string; claim: MaintenanceClaim }
