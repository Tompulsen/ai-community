/*
 * SPDX-FileCopyrightText: 2026 Community contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readdir, rmdir, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { startMediaWorker } from './media.ts';

test('preview ratio describes the rotated thumbnail rather than original EXIF dimensions', async t => {
  const root = await mkdtemp(join(tmpdir(), 'community-cover-ratio-'));
  let stop = async () => {};
  t.after(async () => {
    await stop();
    await Promise.all((await readdir(root)).map(name => unlink(join(root, name))));
    await rmdir(root);
  });
  await sharp({ create: { width: 120, height: 60, channels: 3, background: '#60765d' } })
    .withMetadata({ orientation: 6 }).jpeg().toFile(join(root, 'original'));
  let claimed = false, complete;
  const processed = new Promise(resolve => { complete = resolve; });
  const db = { query: async (sql, params) => {
    if (sql.includes('WITH candidate AS') && !claimed) {
      claimed = true;
      return { rows: [{ id: 'file1', name: 'Cover', type: 'image/jpeg', accessKey: 'original', url: '/legacy-files/file1',
        lease: params[1], properties: { communityMedia: { attempts: 1 } } }], rowCount: 1 };
    }
    if (sql.includes('RETURNING id') && sql.includes('"thumbnailAccessKey"=$2')) {
      complete(params[6]);
      return { rows: [{ id: 'file1' }], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  } };
  const timeout = setTimeout(() => complete(null), 5000);
  t.after(() => clearTimeout(timeout));
  stop = startMediaWorker({ db, filesRoot: root });
  const properties = await processed;
  assert(properties, 'Media worker must complete successfully');
  assert.equal(properties.width, 120);
  assert.equal(properties.height, 60);
  assert.equal(properties.previewAspectRatio, 1 / 2);
});
