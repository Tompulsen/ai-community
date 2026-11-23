import { describe, expect, it } from 'vitest'
import { reactive } from 'vue'
import { publicationFields, publicationParameters } from './publication-parameters'
import type { RemixParameters } from '../shared/studio/remix-parameters'

describe('manual publication parameters', () => {
  it('round-trips a reactive recipe and preserves its group and other public options', () => {
    const recipe = reactive<RemixParameters>({ version: 1, kind: 'image', group: 'vip', size: '1024x1024', n: 2, imageOptions: { seed: '123', quality: 'high' } })
    const fields = publicationFields(recipe)
    fields.size = '2048x2048'
    expect(publicationParameters('image', fields, recipe)).toEqual({ ...recipe, size: '2048x2048' })
    expect(recipe.size).toBe('1024x1024')
    fields.seed = ''; fields.size = ''
    expect(publicationParameters('image', fields, recipe)).toEqual({ version: 1, kind: 'image', group: 'vip', n: 2, imageOptions: { quality: 'high' } })
  })
  it('keeps video custom options and saves duration, resolution and numeric fps', () => {
    const recipe: RemixParameters = { version: 1, kind: 'video', videoOptions: { customParameters: '{"fps":24,"motion_bucket_id":12}', seed: '0' } }
    const fields = publicationFields(recipe)
    expect(fields.fps).toBe('24')
    fields.fps = '30'; fields.duration = '8'; fields.resolution = '1080p'
    const saved = publicationParameters('video', fields, recipe)!
    expect(saved.duration).toBe(8)
    expect(saved.videoOptions?.resolution).toBe('1080p')
    expect(JSON.parse(saved.videoOptions!.customParameters!)).toEqual({ fps: 30, motion_bucket_id: 12 })
    fields.fps = ''
    expect(JSON.parse(publicationParameters('video', fields, recipe)!.videoOptions!.customParameters!)).toEqual({ motion_bucket_id: 12 })
  })
  it('supports empty metadata, rejects invalid values and isolates types', () => {
    expect(publicationParameters('image', publicationFields())).toBeNull()
    expect(publicationParameters('video', publicationFields(), { version: 1, kind: 'image', size: '1024x1024' })).toBeNull()
    for (const fields of [{ size: 'oops' }, { seed: '-1' }, { aspectRatio: 'bad' }]) expect(() => publicationParameters('image', { ...publicationFields(), ...fields })).toThrow()
    for (const fields of [{ duration: '-1' }, { fps: '999' }, { fps: 'NaN' }]) expect(() => publicationParameters('video', { ...publicationFields(), ...fields })).toThrow()
  })
})
