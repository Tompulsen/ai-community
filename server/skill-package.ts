import { createHash } from 'node:crypto'
import { Readable } from 'node:stream'
import { fromBufferPromise } from 'yauzl'
import { ZipFile } from 'yazl'
import { parse } from 'yaml'
import { httpError } from './auth.ts'
import { skillLimits, type SkillFile } from '../shared/community-skills.ts'

const fail = (message: string): never => { throw httpError(400, message) }
const digest = (body: Buffer | string) => createHash('sha256').update(body).digest('hex')
export function skillDocument(bytes: Buffer) {
  if (!bytes.length || bytes.length > skillLimits.bodyBytes) fail('SKILL.md 须为非空 UTF-8 文本，大小不超过 64 KB。')
  let body: string
  try { body = new TextDecoder('utf-8', { fatal: true }).decode(bytes) } catch { return fail('SKILL.md 必须使用 UTF-8 编码。') }
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(body)) fail('SKILL.md 包含无效控制字符。')
  const front = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(body)
  if (!front || front[1]!.length > 8192 || !body.slice(front[0].length).trim()) return fail('SKILL.md 须包含 YAML 名称、简介和技能正文。')
  let meta: any
  try { meta = parse(front[1]!, { maxAliasCount: 0, uniqueKeys: true }) } catch { return fail('SKILL.md 的 YAML 格式无效。') }
  if (!meta || typeof meta.name !== 'string' || !meta.name.trim() || meta.name.length > 100
    || typeof meta.description !== 'string' || !meta.description.trim() || meta.description.length > 1000
    || /[\u0000-\u001f\u007f]/.test(meta.name.trim()) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(meta.description)) fail('技能名称须为 1–100 字，简介须为 1–1000 字。')
  return { body, name: meta.name.trim(), description: meta.description.trim().replace(/\s+/g, ' '), sha256: digest(body) }
}

export async function readSkillPackage(filename: string, source: Buffer, replacement?: string) {
  if (!source.length || source.length > skillLimits.archiveBytes || !/^[^/\\\u0000-\u001f]{1,150}\.(?:md|zip)$/i.test(filename)) fail('请上传不超过 5 MB 的 Markdown 文件或 ZIP 技能包。')
  const zipped = /\.zip$/i.test(filename), entries = new Map<string, Buffer>()
  let skillPath = 'SKILL.md'
  if (zipped) {
    let zip: Awaited<ReturnType<typeof fromBufferPromise>> | undefined
    try {
      zip = await fromBufferPromise(source, { lazyEntries: true, validateEntrySizes: true, strictFileNames: true })
      if (zip.entryCount > skillLimits.files) fail('技能包最多包含 200 个文件及目录。')
      let total = 0
      const names = new Set<string>()
      for await (const entry of zip.eachEntry()) {
        const name = entry.fileName
        if (name.length > 240 || /[\\\u0000-\u001f\u007f:]/.test(name) || name.startsWith('/')
          || name.replace(/\/$/, '').split('/').some(part => !part || part === '.' || part === '..')) fail('技能包包含不安全的文件路径。')
        if ((entry.externalFileAttributes >>> 16 & 0o170000) === 0o120000 || entry.generalPurposeBitFlag & 1) fail('技能包不支持符号链接或加密文件。')
        if (name.startsWith('__MACOSX/') || name.split('/').at(-1) === '.DS_Store') continue
        if (name.split('/').some(part => part.startsWith('.'))) fail('技能包不能包含隐藏文件，请移除 .git、.env 等内容。')
        const key = name.normalize('NFC').toLowerCase().replace(/\/$/, '')
        if (names.has(key)) fail('技能包包含重名文件。')
        names.add(key)
        total += entry.uncompressedSize
        if (total > skillLimits.expandedBytes || entry.uncompressedSize > skillLimits.archiveBytes) fail('技能包解压后最多 20 MB，单个配套文件最多 5 MB。')
        if (name.endsWith('/')) continue
        const stream = await zip.openReadStreamPromise(entry), chunks: Buffer[] = []
        let size = 0
        for await (const chunk of stream) {
          size += chunk.length
          if (size > entry.uncompressedSize || size > skillLimits.archiveBytes) { stream.destroy(); fail('技能包文件大小无效。') }
          chunks.push(chunk)
        }
        entries.set(name, Buffer.concat(chunks))
      }
      const documents = [...entries.keys()].filter(name => name.split('/').at(-1) === 'SKILL.md')
      if (documents.length !== 1) fail('ZIP 内必须包含且仅包含一个 SKILL.md。')
      skillPath = documents[0]!
    } catch (error) {
      if (error && typeof error === 'object' && 'statusCode' in error) throw error
      fail('ZIP 无法安全读取，请重新打包后上传。')
    } finally { zip?.close() }
  } else entries.set(skillPath, source)
  const document = skillDocument(replacement === undefined ? entries.get(skillPath)! : Buffer.from(replacement, 'utf8'))
  entries.set(skillPath, Buffer.from(document.body, 'utf8'))
  if ([...entries.values()].reduce((size, value) => size + value.length, 0) > skillLimits.expandedBytes) fail('技能包解压后最多 20 MB。')
  let archive: Buffer
  if (!zipped) archive = Buffer.from(document.body, 'utf8')
  else {
    const writer = new ZipFile(), chunks: Buffer[] = []
    const output = writer.outputStream as Readable
    writer.on('error', error => output.destroy(error))
    for (const [name, body] of entries) writer.addBuffer(body, name, { mtime: new Date('2000-01-01T00:00:00Z') })
    writer.end()
    let size = 0
    for await (const chunk of output) {
      size += chunk.length
      if (size > skillLimits.archiveBytes) { output.destroy(); fail('整理后的技能包超过 5 MB，请减少附件。') }
      chunks.push(chunk)
    }
    archive = Buffer.concat(chunks)
  }
  const files: SkillFile[] = [...entries].map(([path, bytes]) => ({ path, bytes: bytes.length }))
  return { ...document, filename: zipped ? filename : 'SKILL.md', archive, size: archive.length, files }
}
