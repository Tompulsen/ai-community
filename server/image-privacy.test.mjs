import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { privateMetadataFreeImage, publicImageName } from './image-privacy.ts';

test('public image names never use upload names while resources retain their useful names', () => {
  assert.equal(publicImageName({ id: 'file1', name: 'PRIVATE.png', type: 'image/png' }), 'zhangyu-file1.png');
  assert.equal(publicImageName({ id: 'file1', name: 'model.zip', type: 'application/zip' }), 'model.zip');
});

test('failed processing leaves the source intact without temporary or duplicate files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'community-invalid-image-'));
  try {
    const source = join(root, 'original');
    await writeFile(source, 'invalid image');
    await assert.rejects(privateMetadataFreeImage(source));
    assert.equal(await readFile(source, 'utf8'), 'invalid image');
    assert.deepEqual(await readdir(root), ['original']);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('sanitized images replace the original and deduplicate concurrent work', async () => {
  const root = await mkdtemp(join(tmpdir(), 'community-image-privacy-'));
  try {
    const source = join(root, 'original');
    const pixels = Buffer.from([255, 0, 0, 255, 0, 0, 0, 0, 255, 0, 0, 255]);
    const gif = await sharp(pixels, { raw: { width: 2, height: 2, channels: 3, pageHeight: 1 } })
      .gif({ delay: [100, 200], loop: 0 }).toBuffer();
    assert.equal((await sharp(gif, { animated: true }).metadata()).pages, 2);
    await writeFile(source, gif);
    const results = await Promise.all(Array.from({ length: 5 }, () => privateMetadataFreeImage(source)));
    assert(results.every(result => result.path === source));
    const output = await readFile(source);
    const metadata = await sharp(output, { animated: true }).metadata();
    assert.equal(metadata.pages, 2);
    assert.equal(metadata.pageHeight, 1);
    assert.deepEqual(metadata.delay, [100, 200]);
    assert.deepEqual((await sharp(output, { animated: true }).raw().toBuffer()), pixels);
    assert.deepEqual(await readdir(root), ['original']);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('oversized static images keep their dimensions without exposing EXIF', async () => {
  const root = await mkdtemp(join(tmpdir(), 'community-long-image-'));
  try {
    const source = join(root, 'original');
    const original = await sharp({ create: { width: 17000, height: 1, channels: 3, background: 'red' } })
      .withExif({ IFD0: { Artist: 'PRIVATE' } }).png().toBuffer();
    await writeFile(source, original);
    const result = await privateMetadataFreeImage(source);
    assert.equal(result.path, source);
    const output = await sharp(await readFile(source)).metadata();
    assert.equal(output.format, 'png');
    assert.equal(output.width, 17000);
    assert.equal(output.exif, undefined);
    assert.equal((await privateMetadataFreeImage(source)).path, source);
    assert.deepEqual(await readdir(root), ['original']);
  } finally { await rm(root, { recursive: true, force: true }); }
});
