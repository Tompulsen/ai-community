import type { VideoModelSetting } from '../shared/studio/model-types.ts'
import type { VideoGenMode } from '../shared/studio/types.ts'
import { VIDEO_RATIOS } from '../shared/studio/video-size.ts'

type DurationValues = number[] | { min: number; max: number }
type ParameterLimits = { resolutions: string[]; durations: DurationValues }
type VideoModelProfile = Omit<VideoModelSetting, 'durations' | 'modes'> & ParameterLimits & {
  models: string[]
  modes?: Partial<Record<VideoGenMode, Partial<ParameterLimits>>>
}

// Model defaults stay on the server; the catalogue and submission use the same resolver.
const videoModelProfiles: VideoModelProfile[] = [
  {
    models: ['sd2.0-mini-720p'],
    resolutions: ['720p'],
    durations: { min: 4, max: 15 },
  },
  // These aliases reuse the working workbench range; the gateway validates provider support.
  {
    models: ['sd2.0-fast-480p', 'sd2.0-mini-480p'],
    resolutions: ['480p'],
    durations: { min: 3, max: 30 },
  },
  {
    models: ['sd2.0-fast-720p'],
    resolutions: ['720p'],
    durations: { min: 3, max: 30 },
  },
  {
    models: ['wan3.0'],
    resolutions: ['720p', '1080p'],
    durations: { min: 5, max: 30 },
  },
  {
    models: ['grok-imagine-video'],
    resolutions: ['480p', '720p'],
    durations: { min: 1, max: 15 },
    modes: { 'reference-to-video': { durations: { min: 1, max: 10 } } },
  },
  {
    models: ['grok-imagine-video-1.5', 'grok-imagine-video-1.5-lite'],
    resolutions: ['480p', '720p', '1080p'],
    durations: { min: 1, max: 15 },
    modes: {
      'reference-to-video': { resolutions: ['480p', '720p'] },
      'first-last-frame': { resolutions: ['480p', '720p'] },
    },
  },
  {
    models: ['sora-2'],
    resolutions: ['720p'],
    durations: [4, 8, 12],
  },
  {
    models: ['sora-2-pro'],
    resolutions: ['720p', '1024p'],
    durations: [4, 8, 12],
  },
  {
    models: [
      'doubao-seedance-1-0', 'doubao-seedance-1-0-pro', 'doubao-seedance-1-0-pro-250528',
      'doubao-seedance-1-0-pro-fast-251015', 'doubao-seedance-1-0-lite-t2v-250428',
      'doubao-seedance-1-0-lite-i2v-250428',
    ],
    resolutions: ['480p', '720p', '1080p'],
    durations: { min: 2, max: 12 },
  },
  {
    models: ['doubao-seedance-2-0', 'seedance-2-0'],
    resolutions: ['480p', '720p', '1080p', '4k'],
    durations: { min: 4, max: 15 },
  },
  {
    models: ['doubao-seedance-2-0-fast', 'doubao-seedance-2-0-mini', 'seedance-2-0-fast', 'seedance-2-0-mini'],
    resolutions: ['480p', '720p'],
    durations: { min: 4, max: 15 },
  },
  {
    models: ['doubao-seedance-2-5', 'doubao-seedance-2-5-pro', 'seedance-2-5'],
    resolutions: ['480p', '720p', '1080p'],
    durations: { min: 4, max: 30 },
  },
  {
    models: ['veo-2', 'veo-2.0', 'veo-2.0-generate-001'],
    resolutions: ['720p'],
    durations: { min: 5, max: 8 },
  },
  {
    models: [
      'veo-3', 'veo-3.0', 'veo-3.0-generate-001', 'veo-3.0-fast-generate-001',
      'veo-3.1-fast-generate-preview', 'veo-3.1-fast-generate-001', 'veo-3.1-fast',
    ],
    resolutions: ['720p', '1080p'],
    durations: [4, 6, 8],
    modes: { 'reference-to-video': { durations: [8] } },
  },
  {
    models: ['veo-3.1', 'veo-3.1-generate-preview', 'veo-3.1-generate-001'],
    resolutions: ['720p', '1080p', '4k'],
    durations: [4, 6, 8],
    modes: { 'reference-to-video': { durations: [8] } },
  },
  {
    models: ['MiniMax H3视频生成'],
    resolutions: ['768p', '1080p'],
    autoResolution: '768p',
    durations: { min: 4, max: 15 },
    autoDuration: 10,
    aspectRatios: ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'],
    autoAspectRatio: '16:9',
    sizes: {
      '768p': { '21:9': '1792x768', '16:9': '1368x768', '4:3': '1024x768', '1:1': '768x768', '3:4': '768x1024', '9:16': '768x1368' },
      '1080p': { '21:9': '2520x1080', '16:9': '1920x1080', '4:3': '1440x1080', '1:1': '1080x1080', '3:4': '1080x1440', '9:16': '1080x1920' },
    },
    unsupportedParameters: ['frame_rate'],
  },
]

function durationValues(value: DurationValues): number[] {
  return Array.isArray(value) ? value : Array.from({ length: value.max - value.min + 1 }, (_, index) => value.min + index)
}

export function resolveVideoModelSetting(model: string, stored?: VideoModelSetting): VideoModelSetting | undefined {
  const name = model.split('@')[0]!.toLowerCase()
  const profile = videoModelProfiles.find(item => item.models.some(id => id.toLowerCase() === name))
  if (!profile && !stored) return
  const { models: _models, modes: profileModes, durations, ...defaults } = profile ?? { models: [] }
  const result: VideoModelSetting = { ...(profile ? { aspectRatios: VIDEO_RATIOS.filter(value => value !== 'auto') } : {}),
    ...defaults, ...(durations ? { durations: durationValues(durations) } : {}), ...stored }
  if (stored?.sizes) {
    result.resolutions = stored.resolutions ?? Object.keys(stored.sizes)
    result.aspectRatios = stored.aspectRatios ?? Object.keys(Object.values(stored.sizes)[0] ?? {})
  }
  if (profile && !stored?.resolutions && !stored?.sizes && stored?.autoResolution && stored.autoResolution !== 'auto'
    && !result.resolutions?.includes(stored.autoResolution)) result.resolutions = [...result.resolutions ?? [], stored.autoResolution]
  if (profile && !stored?.durations && stored?.autoDuration !== undefined
    && !result.durations?.includes(stored.autoDuration)) result.durations = [...result.durations ?? [], stored.autoDuration]
  if (!stored?.aspectRatios && !stored?.sizes && stored?.autoAspectRatio && stored.autoAspectRatio !== 'auto' && result.aspectRatios
    && !result.aspectRatios.includes(stored.autoAspectRatio)) result.aspectRatios = [...result.aspectRatios, stored.autoAspectRatio]
  if (result.autoResolution && result.autoResolution !== 'auto' && result.resolutions && !result.resolutions.includes(result.autoResolution))
    result.autoResolution = result.resolutions[0]
  if (result.autoDuration !== undefined && result.durations && !result.durations.includes(result.autoDuration))
    result.autoDuration = result.durations[0]
  if (result.autoAspectRatio && result.autoAspectRatio !== 'auto' && result.aspectRatios && !result.aspectRatios.includes(result.autoAspectRatio))
    result.autoAspectRatio = result.aspectRatios[0]
  if (!stored?.sizes && result.sizes) {
    const sizes = Object.fromEntries(Object.entries(result.sizes)
      .filter(([resolution]) => !result.resolutions || result.resolutions.includes(resolution))
      .map(([resolution, ratios]) => [resolution, Object.fromEntries(Object.entries(ratios)
        .filter(([ratio]) => !result.aspectRatios || result.aspectRatios.includes(ratio)))]))
    if (Object.keys(sizes).length && Object.values(sizes).every(ratios => Object.keys(ratios).length)
      && (!result.resolutions || result.resolutions.every(resolution => sizes[resolution]
        && (!result.aspectRatios || result.aspectRatios.every(ratio => sizes[resolution]![ratio]))))) result.sizes = sizes
    else delete result.sizes
  }
  const modes: NonNullable<VideoModelSetting['modes']> = {}
  for (const mode of new Set([...Object.keys(profileModes ?? {}), ...Object.keys(stored?.modes ?? {})]) as Set<VideoGenMode>) {
    const limits = profileModes?.[mode]
    const override = {
      ...(!stored?.resolutions && !stored?.sizes && limits?.resolutions ? { resolutions: limits.resolutions } : {}),
      ...(!stored?.durations && limits?.durations ? { durations: durationValues(limits.durations) } : {}),
      ...stored?.modes?.[mode],
    }
    if (Object.keys(override).length) modes[mode] = override
  }
  if (Object.keys(modes).length) result.modes = modes
  else delete result.modes
  return structuredClone(result)
}
