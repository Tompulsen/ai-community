/* SPDX-FileCopyrightText: 2026 Community contributors
 * SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rmdir, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { handleContent } from './content.ts'

test('anonymous visitors can read only the configured, nonsensitive raster logo through the media ACL', async () => {
  const root = await mkdtemp(join(tmpdir(), 'community-site-logo-'))
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  await writeFile(join(root, 'logo-original'), png)
  try {
    for (const item of [
      { id: 'logo1', type: 'image/png', isSensitive: false, allowed: true },
      { id: 'private1', type: 'image/png', isSensitive: false, allowed: false },
      { id: 'logo1', type: 'image/png', isSensitive: true, allowed: false },
      { id: 'logo1', type: 'image/svg+xml', isSensitive: false, allowed: false },
    ]) {
      const result = {}, headers = {}
      const ctx = {
        req: { method: 'HEAD', headers: {} }, user: null, url: new URL(`https://community.example/legacy-files/${item.id}`),
        config: { url: 'https://community.example', id: 'aidx' }, filesRoot: root,
        db: { async query(sql, values) {
          assert.deepEqual(values, [null, item.id, false, 'https://community.example'])
          assert.match(sql, /AND f\."storedInternal" AND NOT f\."isLink"/)
          assert.match(sql, /OR \(NOT f\."isSensitive" AND f\.type IN \('image\/jpeg','image\/png','image\/webp','image\/gif','image\/avif'\)\s+AND EXISTS \(SELECT 1 FROM meta m WHERE m\."clientOptions"->>'communityLogoFileId'=f\.id/)
          assert(sql.includes("NOT (COALESCE(m.\"clientOptions\",'{}'::jsonb) ? 'communityLogoFileId')"))
          assert(sql.includes('COALESCE(m."clientOptions"->>\'communityLogoUrl\',m."iconUrl",\'\')'))
          assert(sql.includes("$4||'/legacy-files/'||f.id") && sql.includes("$4||'/files/'||f.\"accessKey\""))
          return { rows: item.allowed ? [{ ...item, name: 'logo.png', accessKey: 'logo-original' }] : [] }
        } },
        reply: { header(key, value) { headers[key] = value; return this }, code(status) { result.status = status; return this }, send() {} },
      }
      if (item.allowed) {
        assert.equal(await handleContent(ctx), true)
        assert.equal(result.status, 200)
        assert.equal(headers['Content-Type'], 'image/png')
        assert.equal(headers['Content-Length'], png.length)
      } else await assert.rejects(handleContent(ctx), { statusCode: 404 })
    }
  } finally { await unlink(join(root, 'logo-original')); await rmdir(root) }
})
