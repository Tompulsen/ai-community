import { z } from 'zod'

export const skillDetailsSchema = z.object({
  platform: z.string().trim().max(100).default(''),
  version: z.string().trim().max(80).default(''),
  installation: z.string().trim().max(10000).default(''),
})
export type SkillDetails = z.infer<typeof skillDetailsSchema>
export const skillFileAccept = '.zip,.json,.md,.txt,.yaml,.yml'
export function skillFileName(name: string) { return /\.(?:zip|json|md|txt|ya?ml)$/i.test(name) }
export function skillFileType(type: string) {
  return /^(?:application\/(?:zip|x-zip-compressed|json|yaml|x-yaml)|text\/(?:plain|markdown|x-markdown|json|yaml|x-yaml))$/.test(type)
}
