// Adapted from community-studio-ui studio-remix.ts and MkStudioRemix.vue (AGPL-3.0-only).
import type { Work } from './data'
import type { VideoOptions } from '../shared/studio/options'

export function remixPrompt(work: Pick<Work, 'kind' | 'prompt' | 'generation' | 'body'>) {
  return work.generation?.prompt?.trim() || work.prompt?.trim() || (work.kind === 'resource' ? work.body?.trim() : '') || ''
}

export function remixReferenceFiles(work: Pick<Work, 'referenceFiles'>) {
  const seen = new Set<string>(), ids = new Set<string>()
  return (work.referenceFiles || []).filter(file => {
    if (!/^image\/(?:png|jpeg|webp|gif|avif)$/.test(file.type) || !file.url.trim() || ids.has(file.id) || seen.has(file.url)) return false
    try {
      const url = new URL(file.url, 'https://community.invalid')
      if (!['http:', 'https:'].includes(url.protocol)) return false
    } catch { return false }
    seen.add(file.url); ids.add(file.id)
    return true
  })
}

export function remixVideoMode(mode: VideoOptions['mode'], count: number): VideoOptions['mode'] {
  return mode === 'first-last-frame' && count === 2 || mode === 'reference-to-video' && count > 0 ? mode
    : count > 1 ? 'reference-to-video' : count ? 'image-to-video' : 'text-to-video'
}
