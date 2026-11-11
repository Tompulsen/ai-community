/*
 * SPDX-FileCopyrightText: 2026 Community contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { FastifyReply, FastifyRequest } from 'fastify'
import type { Redis } from 'ioredis'
import type { Pool } from 'pg'

export type Database = Pool
export type Queryable = Pick<Pool, 'query'>

export interface AppConfig {
  url: string
  id?: string
  db: { host: string; port?: number; user: string; pass?: string; db: string }
  redis: { host: string; port?: number; pass?: string; username?: string; db?: number; prefix?: string }
  newApiSso?: { issuer?: string; studioSecret?: string; lotterySecret?: string }
  communityStudioUpstream?: string
}

export interface PublicUser {
  id: string
  username: string
  name: string
  bio: string
  isAdmin: boolean
  isModerator: boolean
  avatarId?: string | null
  bannerId?: string | null
  avatarUrl?: string | null
  bannerUrl?: string | null
}

export interface SessionUser extends Omit<PublicUser, 'name' | 'bio'> {
  name: string | null
  bio: string | null
  tokenHash: string
  host: string | null
}

export interface TwoFactorProfile {
  userId: string
  twoFactorEnabled: boolean
  twoFactorSecret: string | null
  twoFactorBackupSecret: string[] | null
}

export interface RequestContext {
  request: FastifyRequest
  req: IncomingMessage
  res: ServerResponse
  reply: FastifyReply
  url: URL
  body: Record<string, unknown>
  db: Database
  redis: Redis
  config: AppConfig
  filesRoot: string
  user: SessionUser | null
  sessionHash: string | null
  ip?: string
  newId(): string
  json(status: number, value: unknown): void
  createSession(userId: string, expectedTokenHash?: string): Promise<PublicUser>
  authenticateFactor(profile: TwoFactorProfile, token: unknown, recoveryCode?: unknown): Promise<void>
  requireUser(): SessionUser
  requireAdmin(): SessionUser
}
