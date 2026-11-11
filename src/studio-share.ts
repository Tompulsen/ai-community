/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import type { WorkKind } from './data'

export type ShareWork = {
  destination?: 'community' | 'source-comment'
  resultId?: string
  category: WorkKind
  title: string
  text: string
  model: string
  generation?: { prompt: string; model: string; sourceWorkId?: string }
  files: { name: string; blob: Blob; role?: 'reference' }[]
}
export const uploadLimit = 20 * 1024 * 1024
const validSource = (id: unknown): id is string => typeof id === 'string' && /^[a-zA-Z0-9]{1,32}$/.test(id)
export const validShareId = (id: unknown): id is string => typeof id === 'string' && /^[a-f0-9-]{36}$/i.test(id)

export function validateStudioWork(value: unknown, limits = { image: uploadLimit, video: uploadLimit, document: uploadLimit }): value is ShareWork {
  if (!value || typeof value !== 'object') return false
  const work = value as ShareWork
  if (work.destination !== undefined && !['community', 'source-comment'].includes(work.destination)) return false
  if (work.destination === 'source-comment' && (work.category === 'video' || !validSource(work.generation?.sourceWorkId)
    || typeof work.resultId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(work.resultId))) return false
  return ['image', 'video', 'resource'].includes(work.category)
    && typeof work.title === 'string' && work.title.length <= 100
    && typeof work.text === 'string' && work.text.length <= 2500
    && typeof work.model === 'string' && work.model.length <= 100
    && Array.isArray(work.files) && work.files.length <= 32
    && work.files.every(file => file && typeof file.name === 'string' && /^[^/\\\x00-\x1f]{1,180}$/.test(file.name)
      && (file.role === undefined || (file.role === 'reference' && work.destination !== 'source-comment'))
      && file.blob instanceof Blob && file.blob.size > 0 && file.blob.size <= (file.blob.type.startsWith('image/') ? limits.image : file.blob.type.startsWith('video/') ? limits.video : limits.document)
      && /^(image\/(png|jpeg|webp|gif|avif|apng|bmp|x-ms-bmp)|video\/(mp4|webm|quicktime|x-matroska)|text\/markdown)$/.test(file.blob.type)
      && (file.role !== 'reference' || file.blob.type.startsWith('image/'))
      && (work.destination !== 'source-comment' || !file.blob.type.startsWith('video/')))
    && work.files.filter(file => file.role === 'reference').length <= 16
    && work.files.filter(file => file.role !== 'reference').length <= 16
    && (!work.generation || (typeof work.generation.prompt === 'string' && work.generation.prompt.length <= 100000
      && typeof work.generation.model === 'string' && work.generation.model.trim().length > 0 && work.generation.model.length <= 100
      && (work.generation.sourceWorkId === undefined || validSource(work.generation.sourceWorkId))))
    && (work.category === 'resource' ? !!work.text.trim() || work.files.length > 0 : work.files.some(file => file.role !== 'reference' && file.blob.type.startsWith(`${work.category}/`)))
}

export function isCurrentStudioMessage(event: MessageEvent, frame: Window | null | undefined, origin: string, identity: {
  context: string; attempt: string; subject?: string; userId?: string
}, verified = false) {
  const data = event.data
  return event.source === frame && !!frame && event.origin === origin && data?.type === 'community-studio'
    && data.context === identity.context && data.attempt === identity.attempt
    && (!verified || !!identity.subject && !!identity.userId && data.subject === identity.subject && data.userId === identity.userId)
}
