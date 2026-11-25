import { expect, test } from 'vitest'
import { modelTypesSchema, referenceCountIssue, resolveReferenceLimits } from '../shared/studio/model-types'

test('unconfigured models retain their existing reference limits', () => {
  expect(resolveReferenceLimits('image')).toEqual({ images: 16, videos: 0, audios: 0, total: 16 })
  expect(resolveReferenceLimits('video')).toEqual({ images: 10, videos: 10, audios: 10, total: 10 })
  expect(resolveReferenceLimits('video', undefined, true)).toEqual({ images: 0, videos: 1, audios: 0, total: 1 })
})

test('explicit zero disables one reference type without resetting other defaults', () => {
  expect(resolveReferenceLimits('video', { maxReferenceVideos: 0, maxReferenceAudios: 2 }))
    .toEqual({ images: 10, videos: 0, audios: 2, total: 10 })
  expect(resolveReferenceLimits('image', { maxReferenceImages: 0 }).images).toBe(0)
})

test('upscale cannot gain image, audio or additional source videos from model settings', () => {
  expect(resolveReferenceLimits('video', { maxReferenceImages: 10, maxReferenceVideos: 10, maxReferenceAudios: 10 }, true))
    .toEqual({ images: 0, videos: 1, audios: 0, total: 1 })
  expect(resolveReferenceLimits('video', { maxReferenceVideos: 0 }, true).videos).toBe(0)
})

for (const [kind, field, maximum] of [
  ['image', 'maxReferenceImages', 16],
  ['video', 'maxReferenceImages', 10],
  ['video', 'maxReferenceVideos', 10],
  ['video', 'maxReferenceAudios', 10],
] as const) {
  test(`${kind}.${field} retains zero and its maximum when model settings round trip`, () => {
    for (const value of [0, maximum]) {
      const settings = [{ id: 'configured-model', kind, [kind]: { [field]: value } }]
      expect(modelTypesSchema.parse(JSON.parse(JSON.stringify(settings)))).toEqual(settings)
    }
  })
  test.each([-1, 0.5, maximum + 1, '1', null])(`${kind}.${field} rejects invalid count %s`, value => {
    expect(modelTypesSchema.safeParse([{ id: 'configured-model', kind, [kind]: { [field]: value } }]).success).toBe(false)
  })
}

test('count errors identify the exceeded type and preserve a separate total cap', () => {
  const limits = resolveReferenceLimits('video', { maxReferenceImages: 2, maxReferenceVideos: 1, maxReferenceAudios: 0 })
  expect(referenceCountIssue({ images: 3, videos: 0, audios: 0 }, limits)).toBe('当前模型最多支持 2 张参考图片，已选 3 张。')
  expect(referenceCountIssue({ images: 0, videos: 2, audios: 0 }, limits)).toBe('当前模型最多支持 1 个参考视频，已选 2 个。')
  expect(referenceCountIssue({ images: 0, videos: 0, audios: 1 }, limits)).toBe('当前模型不支持参考音频，已选 1 个。')
  expect(referenceCountIssue({ images: 2, videos: 1, audios: 0 }, limits)).toBe('')
  expect(referenceCountIssue({ images: 4, videos: 3, audios: 3 }, resolveReferenceLimits('video'))).toBe('')
  expect(referenceCountIssue({ images: 4, videos: 4, audios: 3 }, resolveReferenceLimits('video')))
    .toBe('参考素材合计不能超过 10 个，已选 11 个。')
})
