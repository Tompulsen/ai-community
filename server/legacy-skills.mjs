// One-time migration, run before switching the workbench catalog to database skills.
import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { ZipFile } from 'yazl'
import { readSkillPackage } from './skill-package.ts'
import { skillLimits } from '../shared/community-skills.ts'

export async function readLegacySkillPackages(root) {
  const skills = []
  for (const directory of await readdir(root, { withFileTypes: true })) {
    if (!directory.isDirectory() || !/^[a-z0-9-]{1,64}$/.test(directory.name) || directory.name === 'document-workspace') continue
    const entries = []
    async function visit(folder, prefix) {
      for (const item of await readdir(folder, { withFileTypes: true })) {
        const filename = path.join(folder, item.name), name = `${prefix}/${item.name}`
        if (item.isSymbolicLink()) throw new Error('Legacy skill contains a symbolic link')
        if (item.isDirectory()) await visit(filename, name)
        else if (item.isFile()) entries.push([name, await readFile(filename)])
      }
    }
    await visit(path.join(root, directory.name), directory.name)
    let pack
    if (entries.length === 1 && entries[0][0] === `${directory.name}/SKILL.md`) pack = await readSkillPackage('SKILL.md', entries[0][1])
    else {
      const writer = new ZipFile(), chunks = []
      for (const [name, value] of entries) writer.addBuffer(value, name, { mtime: new Date('2000-01-01T00:00:00Z') })
      writer.end()
      for await (const chunk of writer.outputStream) chunks.push(chunk)
      pack = await readSkillPackage(`${directory.name}.zip`, Buffer.concat(chunks))
    }
    skills.push({ ...pack, legacyId: directory.name, id: 'legacy' + createHash('sha256').update(directory.name).digest('hex').slice(0, 24) })
  }
  return skills
}

export async function importLegacySkills(db, authorId, packages) {
  const client = await db.connect()
  try {
    await client.query('BEGIN')
    const author = (await client.query('SELECT id FROM "user" WHERE id=$1 AND NOT "isDeleted" AND NOT "isSuspended" FOR UPDATE', [authorId])).rows[0]
    if (!author) throw new Error('Legacy skill owner must be an active administrator')
    const existing = new Set((await client.query('SELECT "legacyId" FROM community_skill WHERE "legacyId" IS NOT NULL')).rows.map(row => row.legacyId))
    const missing = packages.filter(pack => !existing.has(pack.legacyId))
    const usage = (await client.query('SELECT COUNT(*)::int AS count,COALESCE(SUM(size),0)::bigint AS bytes FROM community_skill WHERE "authorId"=$1', [authorId])).rows[0]
    if (usage.count + missing.length > skillLimits.accountCount || Number(usage.bytes) + missing.reduce((sum, pack) => sum + pack.size, 0) > skillLimits.accountBytes) throw new Error('Legacy skill import exceeds the administrator skill quota')
    let imported = 0
    for (const pack of missing) {
      const result = await client.query(`INSERT INTO community_skill
        (id,"authorId",name,kind,description,body,sha256,filename,archive,size,files,status,official,"requestId","requestHash","reviewedBy","legacyId")
        VALUES ($1,$2,$3,'text',$4,$5,$6,$7,$8,$9,$10::jsonb,'published',true,$11,$6,$2,$12)
        ON CONFLICT ("legacyId") DO NOTHING`,
      [pack.id, authorId, pack.name, pack.description, pack.body, pack.sha256, pack.filename, pack.archive, pack.size, JSON.stringify(pack.files), 'legacy-import-' + pack.legacyId, pack.legacyId])
      imported += result.rowCount
    }
    await client.query('COMMIT')
    return { imported, existing: packages.length - imported, total: packages.length }
  } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error }
  finally { client.release() }
}
