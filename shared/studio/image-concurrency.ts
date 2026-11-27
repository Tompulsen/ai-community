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

export interface ImageConcurrencyUserFilters {
  query: string
  status: 'all' | 'active' | 'suspended'
  mode: 'all' | 'default' | 'override'
}

export interface ImageConcurrencyUser extends UserImageConcurrencyConfig {
  id: string
  accountId?: string
  username: string
  name: string
  isSuspended: boolean
}

export interface ImageConcurrencyUserPage {
  items: ImageConcurrencyUser[]
  total: number
  nextCursor: string | null
  selectionVersion: string
  filters: ImageConcurrencyUserFilters
  defaultLimit: number
  globalLimit: number
}

export interface ImageConcurrencyUsersPatch {
  selection: { type: 'ids'; ids: string[] } | { type: 'all' }
  filters: ImageConcurrencyUserFilters
  overrideLimit: number | null
  version: string
}

export interface ImageConcurrencyUsersResult {
  selectedCount: number
  updatedCount: number
}
