import type { VideoModelSetting } from '../shared/studio/model-types.ts'

export function resolveVideoModelSetting(stored?: VideoModelSetting): VideoModelSetting | undefined {
  if (!stored) return
  const result = structuredClone(stored)
  if (result.sizes) {
    result.resolutions ??= Object.keys(result.sizes)
    result.aspectRatios ??= Object.keys(Object.values(result.sizes)[0] ?? {})
  }
  return result
}
