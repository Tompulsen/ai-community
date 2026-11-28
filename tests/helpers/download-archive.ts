import type { Download } from '@playwright/test'
import { buffer } from 'node:stream/consumers'
import { openPromise } from 'yauzl'

export async function readDownloadArchive(download: Download) {
  const archive = await openPromise((await download.path())!)
  const files = new Map<string, Buffer>()
  try {
    for await (const entry of archive.eachEntry()) {
      if (files.has(entry.fileName)) throw new Error(`Duplicate archive entry: ${entry.fileName}`)
      files.set(entry.fileName, await buffer(await archive.openReadStreamPromise(entry)))
    }
    return files
  } finally { archive.close() }
}
