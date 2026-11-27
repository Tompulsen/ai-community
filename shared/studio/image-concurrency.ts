export const IMAGE_CONCURRENCY_USER_MAX = 1000
export const IMAGE_CONCURRENCY_GLOBAL_MAX = 10000

export interface ImageConcurrencySettings {
  defaultLimit: number
  globalLimit: number
  userOverrides: Record<string, number>
}

export interface ImageConcurrencyConfig {
  defaultLimit: number
  globalLimit: number
  version: string
}

export interface UserImageConcurrencyConfig extends ImageConcurrencyConfig {
  userId: string
  overrideLimit: number | null
  effectiveLimit: number
  canEdit: boolean
}
