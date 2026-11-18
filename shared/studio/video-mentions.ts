// Adapted from octopus_chat app/utils/video-mentions.ts (MIT).
export function videoMentionQuery(prompt: string, cursor: number) {
  if (/^(?:\d|图片)/.test(prompt.slice(cursor))) return
  const before = prompt.slice(0, cursor)
  const match = /@(?:图片)?(\d{0,2})$/.exec(before)
  if (!match || /[A-Za-z0-9._]$/.test(before.slice(0, match.index))) return
  return { start: match.index, end: cursor, number: match[1] }
}
export function insertVideoMention(prompt: string, range: { start: number; end: number }, image: number) {
  const text = `@图片${image} `
  return { prompt: prompt.slice(0, range.start) + text + prompt.slice(range.end), cursor: range.start + text.length }
}
export function removeVideoMention(prompt: string, removed: number) {
  return prompt.replace(/@图片(\d+)(?!\d)/g, (text, digits: string) => {
    const image = Number(digits)
    return image === removed ? '[已移除图片]' : image > removed ? `@图片${image - 1}` : text
  })
}
export function remapVideoMentions(prompt: string, before: string[], after: string[], removeUnknown = false) {
  return prompt.replace(/@图片(\d+)(?!\d)/g, (text, digits: string) => {
    const index = Number(digits) - 1
    if (index < 0 || index >= before.length) return removeUnknown ? '[已移除图片]' : text
    const target = after.indexOf(before[index]!)
    return target < 0 ? '[已移除图片]' : `@图片${target + 1}`
  })
}
