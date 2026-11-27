import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'

export async function requestDatabase(t) {
  const db = new PGlite()
  await db.exec(await readFile(new URL('../../migration/20261125-account-requests.up.sql', import.meta.url), 'utf8'))
  t.after(() => db.close())
  return db
}
export function environment(t, values) {
  for (const [key, value] of Object.entries(values)) {
    const previous = process.env[key]
    process.env[key] = value
    t.after(() => { if (previous === undefined) delete process.env[key]; else process.env[key] = previous })
  }
}

// PGlite has one connection; serialize fixture transactions without pretending to test row-lock races.
export function transactionalFixture(db) {
  let tail = Promise.resolve()
  return { query: db.query.bind(db), async connect() {
    const previous = tail
    let release
    tail = new Promise(resolve => { release = resolve })
    await previous
    return { query: db.query.bind(db), release }
  } }
}
