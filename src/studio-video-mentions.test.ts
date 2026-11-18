import { expect, it } from 'vitest'
import { insertVideoMention, remapVideoMentions, removeVideoMention, videoMentionQuery } from '../shared/studio/video-mentions'

it('finds reference queries without matching addresses or splitting existing mentions', () => {
  expect(videoMentionQuery('镜头从 @2', 6)).toEqual({ start: 4, end: 6, number: '2' })
  expect(videoMentionQuery('mail@example', 5)).toBeUndefined()
  expect(videoMentionQuery('@图片1', 1)).toBeUndefined()
  expect(insertVideoMention('看 @ 后', { start: 2, end: 3 }, 2)).toEqual({ prompt: '看 @图片2  后', cursor: 7 })
})
it('renumbers retained references and marks removed ones without reassigning the wrong image', () => {
  expect(removeVideoMention('@图片1 到 @图片2，再到 @图片10', 2)).toBe('@图片1 到 [已移除图片]，再到 @图片9')
  expect(remapVideoMentions('@图片1 @图片2 @图片3', ['a', 'b', 'c'], ['c', 'a', 'd'])).toBe('@图片2 [已移除图片] @图片1')
})

it('does not bind unknown original mentions to newly selected work images', () => {
  expect(remapVideoMentions('@图片1 @图片2', [], ['poster'], true)).toBe('[已移除图片] [已移除图片]')
  expect(remapVideoMentions('@图片1 @图片2', ['author'], ['poster', 'author'], true)).toBe('@图片2 [已移除图片]')
})
