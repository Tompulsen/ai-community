/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { createHash } from 'node:crypto';
import { describe, expect, test } from 'vitest';
import { communityPayloadHash, normalizeCommunityTagIds, normalizeCommunityTagName } from '@/misc/community-tags.js';
import type { CommunityRevision } from '@/models/CommunitySubmission.js';

const legacy: CommunityRevision = { category: 'resource', title: 'A work', text: 'Caption', model: '', sourceUrl: '', license: '', fileIds: [], generation: { prompt: 'Prompt', model: 'test', referenceFileIds: [] } };

describe('community tag inputs and retry compatibility', () => {
	test('preserves historical payload hashes when tags are omitted or empty', () => {
		const oldHash = createHash('sha256').update(JSON.stringify(legacy)).digest('hex');
		expect(communityPayloadHash(legacy)).toBe(oldHash);
		expect(communityPayloadHash({ ...legacy, tagIds: [] })).toBe(oldHash);
	});

	test('tag order does not create an idempotency conflict, but a different selection does', () => {
		expect(communityPayloadHash({ ...legacy, tagIds: ['tagB', 'tagA'] })).toBe(communityPayloadHash({ ...legacy, tagIds: ['tagA', 'tagB'] }));
		expect(communityPayloadHash({ ...legacy, tagIds: ['tagA'] })).not.toBe(communityPayloadHash({ ...legacy, tagIds: ['tagB'] }));
	});

	test.each([['a', 'b', 'c', 'd'], ['a', 'a'], ['../tag'], [''], ['x'.repeat(33)]])('rejects invalid tag selection %j', ids => {
		expect(() => normalizeCommunityTagIds(ids)).toThrow();
	});

	test('normalizes names while preventing invisible and multiline names', () => {
		expect(normalizeCommunityTagName('  教程  ')).toBe('教程');
		expect(normalizeCommunityTagName('cafe\u0301')).toBe('café');
		expect(normalizeCommunityTagName('图'.repeat(24))).toHaveLength(24);
		for (const value of ['', ' ', '图'.repeat(25), 'a\nb', 'a\u200bb', 'a\u2028b']) expect(() => normalizeCommunityTagName(value)).toThrow();
	});
});
