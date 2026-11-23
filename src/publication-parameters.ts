import { readRemixParameters, type RemixParameters } from '../shared/studio/remix-parameters'

export function publicationFields(parameters?: RemixParameters) {
  let fps = ''
  try { fps = String(JSON.parse(parameters?.videoOptions?.customParameters || '{}').fps ?? '') } catch { /* Historical invalid custom data is not exposed. */ }
  return {
    size: parameters?.size ?? '', aspectRatio: parameters?.aspect_ratio ?? '',
    seed: parameters?.imageOptions?.seed ?? parameters?.videoOptions?.seed ?? '',
    duration: parameters?.duration === undefined ? '' : String(parameters.duration),
    resolution: parameters?.videoOptions?.resolution ?? '', fps,
  }
}

export function publicationParameters(kind: 'image' | 'video', fields: ReturnType<typeof publicationFields>, previous?: RemixParameters): RemixParameters | null {
  const base: RemixParameters = previous?.kind === kind ? JSON.parse(JSON.stringify(previous)) : { version: 1, kind }
  const set = (target: Record<string, unknown>, key: string, value: unknown) => {
    if (value === '' || value === undefined) delete target[key]; else target[key] = value
  }
  set(base, 'size', fields.size.trim()); set(base, 'aspect_ratio', fields.aspectRatio.trim())
  if (kind === 'image') {
    const options = base.imageOptions ?? {}
    set(options, 'seed', fields.seed.trim())
    if (Object.keys(options).length) base.imageOptions = options; else delete base.imageOptions
  } else {
    set(base, 'duration', fields.duration === '' ? undefined : Number(fields.duration))
    const options = base.videoOptions ?? {}
    set(options, 'seed', fields.seed.trim()); set(options, 'resolution', fields.resolution.trim())
    const custom = JSON.parse(options.customParameters || '{}')
    const fps = Number(fields.fps)
    if (fields.fps && (!Number.isFinite(fps) || fps < 1 || fps > 240)) throw new Error('帧率请填写 1–240 之间的数值。')
    set(custom, 'fps', fields.fps === '' ? undefined : fps)
    set(options, 'customParameters', Object.keys(custom).length ? JSON.stringify(custom) : '')
    if (Object.keys(options).length) base.videoOptions = options; else delete base.videoOptions
  }
  if (Object.keys(base).length === 2) return null
  const result = readRemixParameters(base)
  if (!result) throw new Error('请检查作品参数：尺寸如 1024x1024，比例如 16:9，种子为非负整数，视频时长为 0–3600 秒。')
  return result
}
