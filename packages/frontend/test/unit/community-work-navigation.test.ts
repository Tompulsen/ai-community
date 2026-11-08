/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { computed } from 'vue';
import { describe, expect, test } from 'vitest';
import type { Router } from '@/router.js';
import { getCommunityWorkReturnPath, rememberCommunityWorkReturnPath } from '@/pages/community/work-navigation.js';

describe('Community work return navigation', () => {
	test('returns to the exact feed, including its submitted search', () => {
		const router = {} as Router;
		const source = '/community/image?q=%E5%B0%8F%E7%8C%AB';
		rememberCommunityWorkReturnPath(router, source, '/community/work/cat');
		expect(getCommunityWorkReturnPath(router, 'cat')).toBe(source);
	});

	test('a cached detail follows the latest entry point for the same work', () => {
		const router = {} as Router;
		const destination = computed(() => getCommunityWorkReturnPath(router, 'cat'));
		expect(destination.value).toBeUndefined();
		rememberCommunityWorkReturnPath(router, '/community', '/community/work/cat');
		expect(destination.value).toBe('/community');
		rememberCommunityWorkReturnPath(router, '/community/image?q=cat', '/community/work/cat');
		expect(destination.value).toBe('/community/image?q=cat');
	});

	test('preserves separate origins for different works and router windows', () => {
		const router = {} as Router;
		const otherRouter = {} as Router;
		rememberCommunityWorkReturnPath(router, '/community', '/community/work/cat');
		rememberCommunityWorkReturnPath(router, '/community/video', '/community/work/movie');
		rememberCommunityWorkReturnPath(otherRouter, '/community/image', '/community/work/cat');
		expect(getCommunityWorkReturnPath(router, 'cat')).toBe('/community');
		expect(getCommunityWorkReturnPath(router, 'movie')).toBe('/community/video');
		expect(getCommunityWorkReturnPath(otherRouter, 'cat')).toBe('/community/image');
	});

	test('direct detail links retain the category fallback', () => {
		expect(getCommunityWorkReturnPath({} as Router, 'cat')).toBeUndefined();
	});

	test.each(['/community/mine', '/community/review', '/community/work/other', '/create/image', 'https://other.example/community', '//other.example/community'])(
		'ignores non-feed entry points: %s', source => {
			const router = {} as Router;
			rememberCommunityWorkReturnPath(router, source, '/community/work/cat');
			expect(getCommunityWorkReturnPath(router, 'cat')).toBeUndefined();
		},
	);
});
