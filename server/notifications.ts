/*
 * SPDX-FileCopyrightText: 2026 Community contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import type { Queryable, RequestContext } from './types.ts'

export async function notifyUser(ctx: RequestContext, db: Queryable, userId: string, title: string, text: string, path: string) {
  if (userId === ctx.user?.id) return
  await db.query(`INSERT INTO announcement (id,title,text,"userId","updatedAt",icon,display)
    VALUES ($1,$2,$3,$4,NOW(),'info','normal')`,
  [ctx.newId(), title, `${text}\n${new URL(path, ctx.config.url).href}`, userId])
}
