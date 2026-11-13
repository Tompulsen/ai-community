export type WorkKind = 'image' | 'video' | 'resource'
export type WorkStatus = 'draft' | 'pending' | 'approved' | 'published' | 'rejected'

export interface AdminOverviewData {
  counts: { pending: number; published: number; rejected: number; reports: number }
  period: { days: number; from: string; to: string; newWorks: number; newUsers?: number }
  updatedAt: string
}

export interface WorkFile {
  id: string
  name: string
  type: string
  size?: number
  url: string
  thumbnailUrl?: string
  processing?: 'pending' | 'processing' | 'ready' | 'failed'
}

export interface Work {
  id: string
  authorId: string
  noteId?: string | null
  version: number
  fileIds: string[]
  files?: WorkFile[]
  title: string
  author: string
  avatar: string
  avatarUrl?: string
  kind: WorkKind
  cover: string
  coverAspectRatio?: number
  tags: string[]
  prompt: string
  model: string
  likes: number
  viewsCount?: number
  renotesCount?: number
  repliesCount?: number
  renoted?: boolean
  date: string
  owned: boolean
  liked: boolean
  saved: boolean
  status: WorkStatus
  body?: string
  duration?: string
  video?: string
  reviewReason?: string
  revisionPending?: boolean
  sourceUrl?: string
  license?: string
  referenceFiles?: WorkFile[]
}

export interface SessionUser {
  id: string
  accountId?: string
  username: string
  name: string
  bio: string
  avatarId?: string | null
  bannerId?: string | null
  avatarUrl?: string
  bannerUrl?: string
  isAdmin: boolean
  isModerator: boolean
}

export interface Creator {
  id: string
  accountId?: string
  name: string
  username: string
  bio: string
  count: number
  followed: boolean
  requested?: boolean
  followsYou?: boolean
  isLocked?: boolean
  canViewFollowers?: boolean
  canViewFollowing?: boolean
  avatarUrl?: string
  bannerUrl?: string
  followersCount?: number
  followingCount?: number
  receivedLikesCount?: number
  worksCount?: number
  isSelf?: boolean
}

export interface Announcement {
  id: string
  title: string
  body?: string
  text?: string
  createdAt?: string
  date?: string
}

export interface WorkComment {
  id: string
  userId: string
  authorId?: string
  author: string
  authorAvatarUrl?: string
  text: string
  date?: string
  owned: boolean
  removable: boolean
  parentId?: string | null
  repliesCount?: number
  likesCount?: number
  likes?: number
  liked?: boolean
  sourceWorkId?: string
  files?: WorkFile[]
}

export const kindLabels: Record<WorkKind, string> = {
  image: '图片',
  video: '视频',
  resource: '文本 · 代码 · Skill',
}

export const statusLabels: Record<WorkStatus, string> = {
  draft: '草稿',
  pending: '待审核',
  approved: '已通过',
  published: '已公开',
  rejected: '未通过',
}
