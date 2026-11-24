import { open, realpath } from 'node:fs/promises'
import { confinedFile } from './media.ts'
import { readSkillPackage } from './skill-package.ts'
import { httpError } from './auth.ts'
import { skillLimits, skillKinds, type SkillKind } from '../shared/community-skills.ts'
import type { Queryable, RequestContext } from './types.ts'
import { AccountRequest } from './native-account/index.ts'
import { applicationRequest } from './web-request.ts'
import { readAccountModelCatalogue, classifyModel } from './native-account/model-catalogue.ts'
import { readModelTypes } from '../shared/studio/model-types.ts'

export type SkillModelCatalogue = typeof readAccountModelCatalogue
export async function validateWorkSkillModel(ctx: RequestContext, group: string, model: string, catalogue = readAccountModelCatalogue, expectedKind: SkillKind = 'text') {
  if (!ctx.user?.accountId) throw httpError(401, '请登录章鱼账号后选择模型分组。')
  const req = new AccountRequest(applicationRequest(ctx.request, ctx.reply, ctx.config.url))
  req.headers.set('x-new-api-user', ctx.user.accountId)
  const available = await catalogue(req)
  const found = available.items.find(item => item.id === model && item.groups.includes(group))
  const options = (await ctx.db.query<{ clientOptions: Record<string, unknown> }>('SELECT "clientOptions" FROM meta ORDER BY id LIMIT 1')).rows[0]?.clientOptions
  const kind = readModelTypes(options?.communityModelTypes).find(item => item.id === model)?.kind ?? classifyModel(model)
  if (!found || kind !== expectedKind) throw httpError(400, `请选择当前分组中可用的${skillKinds[expectedKind]}模型。`)
}

// Keep the source in its existing drive file; approval remains owned by the work.
export async function readWorkSkillPackage(ctx: RequestContext, db: Queryable, authorId: string, id: string) {
  const file = (await db.query<{ name: string; accessKey: string; storedInternal: boolean; isLink: boolean }>(
    'SELECT name,"accessKey","storedInternal","isLink" FROM drive_file WHERE id=$1 AND "userId"=$2', [id, authorId])).rows[0]
  if (!file?.storedInternal || file.isLink) throw httpError(400, '技能源文件不可用，请重新上传。')
  try {
    const path = await confinedFile(await realpath(ctx.filesRoot), file.accessKey)
    const handle = await open(path, 'r')
    let bytes: Buffer
    try {
      const info = await handle.stat()
      if (!info.isFile() || info.size < 1 || info.size > skillLimits.archiveBytes) throw httpError(400, '技能文件须为不超过 5 MB 的 SKILL.md 或 ZIP。')
      bytes = Buffer.alloc(info.size)
      let offset = 0
      while (offset < bytes.length) {
        const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset)
        if (!bytesRead) throw httpError(400, '技能文件已变化，请重新上传。')
        offset += bytesRead
      }
    } finally { await handle.close() }
    return await readSkillPackage(file.name, bytes)
  } catch (error) {
    if (error && typeof error === 'object' && 'statusCode' in error) throw error
    throw httpError(400, '技能源文件无法安全读取，请重新上传。')
  }
}
