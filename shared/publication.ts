import { z } from 'zod'

export const skillDetailsSchema = z.object({
  kind: z.enum(['text', 'image', 'video']).default('text'),
  platform: z.string().trim().max(100).default(''),
  group: z.string().trim().max(128).optional(),
  coverFileId: z.string().regex(/^[a-zA-Z0-9]{1,32}$/).optional(),
  sourcePublic: z.boolean().optional(),
  sourceFileId: z.string().regex(/^[a-zA-Z0-9]{1,32}$/).optional(),
  sourceSha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  version: z.string().trim().max(80).default(''),
  installation: z.string().trim().max(10000).default(''),
})
export type SkillDetails = z.infer<typeof skillDetailsSchema>
export const skillFileAccept = '.zip,.json,.md,.txt,.yaml,.yml'
export function skillFileName(name: string) { return /\.(?:zip|json|md|txt|ya?ml)$/i.test(name) }
export function skillFileType(type: string) {
  return /^(?:application\/(?:zip|x-zip-compressed|json|yaml|x-yaml)|text\/(?:plain|markdown|x-markdown|json|yaml|x-yaml))$/.test(type)
}
