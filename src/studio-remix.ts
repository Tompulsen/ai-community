// Adapted from community-studio-ui studio-remix.ts and MkStudioRemix.vue (AGPL-3.0-only).
import type { Work } from './data'
import type { VideoOptions } from '../shared/studio/options'

export function remixReferenceFiles(work: Work) {
  const seen = new Set<string>()
  return (work.referenceFiles || []).filter(file => {
    if (!file.type.startsWith('image/') || seen.has(file.url)) return false
    try {
      const url = new URL(file.url, 'https://community.invalid')
      if (!['http:', 'https:'].includes(url.protocol)) return false
    } catch { return false }
    seen.add(file.url)
    return true
  })
}

export function remixVideoMode(mode: VideoOptions['mode'], count: number): VideoOptions['mode'] {
  return mode === 'first-last-frame' && count === 2 || mode === 'reference-to-video' && count > 0 ? mode
    : count > 1 ? 'reference-to-video' : count ? 'image-to-video' : 'text-to-video'
}
