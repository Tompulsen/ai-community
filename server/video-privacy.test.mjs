import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { privateMetadataFreeVideo } from './video-privacy.ts';
import { publicImageName } from './image-privacy.ts';

const available = spawnSync('ffmpeg', ['-version'], { windowsHide: true, stdio: 'ignore' }).status === 0;
function ffmpeg(args) {
  const result = spawnSync('ffmpeg', ['-nostdin', '-v', 'error', ...args], { windowsHide: true, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
}
function probe(path) {
  const result = spawnSync('ffprobe', ['-v', 'error', '-show_format', '-show_streams', '-show_chapters', '-of', 'json', path], { windowsHide: true, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test('video remux removes global, stream and chapter metadata without changing video frames', { skip: !available }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'community-video-privacy-'));
  try {
    const source = join(root, 'original');
    const metadata = join(root, 'metadata.txt');
    await writeFile(metadata, ';FFMETADATA1\ntitle=PRIVATE-TITLE\ncomment=PRIVATE-PROMPT\nlocation=PRIVATE-LOCATION\n[CHAPTER]\nTIMEBASE=1/1000\nSTART=0\nEND=1000\ntitle=PRIVATE-CHAPTER\n');
    ffmpeg(['-f', 'lavfi', '-i', 'color=red:s=16x16:r=2:d=1', '-f', 'ffmetadata', '-i', metadata,
      '-map', '0:v', '-map_metadata', '1', '-map_chapters', '1', '-metadata:s:v', 'title=PRIVATE-STREAM', '-c:v', 'mpeg4', '-f', 'mp4', source]);
    await rm(metadata);
    const before = probe(source);
    assert(JSON.stringify(before).includes('PRIVATE'));
    const frameHash = () => spawnSync('ffmpeg', ['-v', 'error', '-i', source, '-f', 'framemd5', '-'], { windowsHide: true, encoding: 'utf8' }).stdout;
    const frames = frameHash();
    const results = await Promise.all([privateMetadataFreeVideo(source, 'video/mp4'), privateMetadataFreeVideo(source, 'video/mp4')]);
    assert(results.every(result => result.path === source));
    const after = probe(source);
    assert(!JSON.stringify(after).includes('PRIVATE'));
    assert.deepEqual(after.chapters, []);
    assert.equal(after.streams[0].codec_name, before.streams[0].codec_name);
    assert.equal(frameHash(), frames);
    assert.equal(results[0].size, (await readFile(source)).length);
    assert.deepEqual(await readdir(root), ['original']);
    assert.equal(publicImageName({ id: '1', type: 'video/mp4', name: 'PRIVATE.mp4' }), 'zhangyu-1.mp4');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('Ogg cannot bypass metadata cleaning by declaring an audio or application MIME', { skip: !available }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'community-ogg-privacy-'));
  try {
    for (const type of ['video/ogg', 'audio/ogg', 'application/ogg']) {
      const source = join(root, 'original');
      ffmpeg(['-f', 'lavfi', '-i', 'sine=frequency=1000:duration=0.1', '-c:a', 'libopus', '-metadata', 'title=PRIVATE-TITLE', '-f', 'ogg', source]);
      assert(JSON.stringify(probe(source)).includes('PRIVATE'));
      await privateMetadataFreeVideo(source, type);
      assert(!JSON.stringify(probe(source)).includes('PRIVATE'));
      assert.equal(probe(source).streams[0].codec_type, 'audio');
      await rm(source);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('failed remux leaves the source intact and removes its temporary output', { skip: !available }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'community-invalid-video-'));
  try {
    const source = join(root, 'original');
    await writeFile(source, 'invalid video');
    await assert.rejects(privateMetadataFreeVideo(source, 'video/mp4'));
    assert.equal(await readFile(source, 'utf8'), 'invalid video');
    assert.deepEqual(await readdir(root), ['original']);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('an output budget rejection preserves the complete original instead of publishing a limited remux', { skip: !available }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'community-video-limit-'));
  try {
    const source = join(root, 'original');
    ffmpeg(['-f', 'lavfi', '-i', 'color=red:s=16x16:r=2:d=1', '-c:v', 'mpeg4', '-f', 'mp4', source]);
    const original = await readFile(source);
    await assert.rejects(privateMetadataFreeVideo(source, 'video/mp4', 64), /output exceeds limit/);
    assert.deepEqual(await readFile(source), original);
    assert.deepEqual(await readdir(root), ['original']);
  } finally { await rm(root, { recursive: true, force: true }); }
});
