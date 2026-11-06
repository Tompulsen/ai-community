/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'vitest';
import { getUploadKind, getUploadLimits, getUploadTempLimit, UploadSizeLimitError, validateUploadSize } from '@/misc/upload-limits.js';

const MiB = 1024 * 1024;
const caps = { image: 1, video: 2, audio: 3, document: 4, other: 1 };

async function withFile(content: string | Buffer, run: (path: string) => Promise<void>) {
	const dir = await mkdtemp(join(tmpdir(), 'upload-limits-'));
	try {
		const path = join(dir, 'renamed-file.bin');
		await writeFile(path, content);
		await run(path);
	} finally { await rm(dir, { recursive: true, force: true }); }
}

describe('per-type upload limits', () => {
	test('defaults and invalid persisted settings fail closed to 20 MB', () => {
		assert.deepEqual(getUploadLimits(), { image: 20, video: 20, audio: 20, document: 20, other: 20 });
		for (const n of [0, -1, 1.5, NaN, Infinity, 10241]) assert.equal(getUploadLimits({ image: n }).image, 20);
		assert.deepEqual(getUploadLimits(caps), caps);
	});
	test('temporary cap is the largest category bounded by the server ceiling', () => {
		assert.equal(getUploadTempLimit(caps, 100 * MiB), 4 * MiB);
		assert.equal(getUploadTempLimit(caps, MiB), MiB);
	});
	test('categorizes media, documents, code and archives', () => {
		for (const mime of ['image/png', 'image/gif', 'image/svg+xml']) assert.equal(getUploadKind(mime), 'image');
		assert.equal(getUploadKind('video/mp4'), 'video');
		assert.equal(getUploadKind('application/ogg'), 'video');
		assert.equal(getUploadKind('audio/mp4'), 'audio');
		for (const mime of ['text/markdown', 'application/pdf', 'application/json', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']) assert.equal(getUploadKind(mime), 'document');
		for (const mime of ['application/zip', 'application/x-7z-compressed', 'application/vnd.ms-cab-compressed', 'application/octet-stream']) assert.equal(getUploadKind(mime), 'other');
	});
	for (const [category, mime] of Object.entries({ image: 'image/png', video: 'video/mp4', audio: 'audio/mpeg', document: 'application/pdf', other: 'application/zip' })) {
		test(`${category}: allows equality and rejects one excess byte`, async () => {
			const max = caps[category as keyof typeof caps] * MiB;
			await validateUploadSize('unused', max, mime, caps, 100 * MiB);
			await assert.rejects(validateUploadSize('unused', max + 1, mime, caps, 100 * MiB), err => err instanceof UploadSizeLimitError && err.info.category === category && err.info.limitBytes === max);
		});
	}
	test('server ceiling also applies to categories with a larger setting', async () => {
		await assert.rejects(validateUploadSize('unused', MiB + 1, 'video/mp4', caps, MiB), err => err instanceof UploadSizeLimitError && err.info.limitBytes === MiB);
	});
	test('extensionless UTF-8 Markdown and Skill content uses the document limit', async () => {
		const text = '# 技能说明\n'.repeat(100000);
		await withFile(text, async path => {
			await validateUploadSize(path, Buffer.byteLength(text), 'application/octet-stream', caps, 100 * MiB);
		});
	});
	test('unknown binary cannot gain a larger document cap by using a text prefix', async () => {
		const content = Buffer.concat([Buffer.alloc(MiB + 1, 65), Buffer.from([0])]);
		await withFile(content, async path => {
			await assert.rejects(validateUploadSize(path, content.length, 'application/octet-stream', caps, 100 * MiB), err => err instanceof UploadSizeLimitError && err.info.category === 'other');
		});
	});
	test('malformed UTF-8 is binary and is not accepted as a document', async () => {
		const content = Buffer.concat([Buffer.alloc(MiB + 1, 65), Buffer.from([0xff])]);
		await withFile(content, async path => {
			await assert.rejects(validateUploadSize(path, content.length, 'application/octet-stream', caps, 100 * MiB), err => err instanceof UploadSizeLimitError && err.info.category === 'other');
		});
	});
	test('rejects unknown oversized content before reading it', async () => {
		await assert.rejects(validateUploadSize('not-a-real-path', 5 * MiB, 'application/octet-stream', caps, 100 * MiB), err => err instanceof UploadSizeLimitError && err.info.limitBytes === 4 * MiB);
	});
	test('large SVG uses image cap even when the renderer reports XML or binary', async () => {
		const svg = '<?xml version="1.0"?>\n<!-- cover -->\n<svg xmlns="http://www.w3.org/2000/svg"><!--' + 'a'.repeat(MiB) + '--></svg>';
		await withFile(svg, async path => {
			for (const mime of ['application/xml', 'application/octet-stream']) {
				await assert.rejects(validateUploadSize(path, Buffer.byteLength(svg), mime, caps, 100 * MiB), err => err instanceof UploadSizeLimitError && err.info.category === 'image');
			}
			await validateUploadSize(path, Buffer.byteLength(svg), 'application/xml', { ...caps, image: 5 }, 100 * MiB);
		});
	});
	test('oversized XML preambles cannot conceal an SVG from its image cap', async () => {
		const svg = '<!--' + ' '.repeat(MiB) + '--><svg/>';
		await withFile(svg, async path => {
			await assert.rejects(validateUploadSize(path, svg.length, 'application/octet-stream', caps, 100 * MiB), err => err instanceof UploadSizeLimitError && err.info.limitBytes === MiB);
		});
	});
});
