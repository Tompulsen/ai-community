/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, test } from 'vitest';
import { normalizeCommunityAd, publicCommunityClientOptions } from '@/misc/community-ads.js';

const site = 'https://community.example';
const ad = { enabled: true, title: 'Creative tools', imageUrl: 'https://media.example/ad.gif', linkUrl: 'https://tools.example/editor?type=image#canvas' };

describe('community advertisements', () => {
	test.each(['javascript:alert(1)', 'data:text/html,test', '//tools.example', 'https://user:password@tools.example', 'https://tools.example/a\nb', 'https://tools.example\\@other.example'])('rejects unsafe image and destination URLs: %s', value => {
		expect(normalizeCommunityAd({ ...ad, imageUrl: value }, site)).toBeNull();
		expect(normalizeCommunityAd({ ...ad, linkUrl: value }, site)).toBeNull();
	});

	test('preserves GIF URLs and destination query strings without accepting mixed-content images', () => {
		expect(normalizeCommunityAd({ ...ad, title: ' Creative tools ' }, site)).toEqual(ad);
		expect(normalizeCommunityAd({ ...ad, imageUrl: 'http://media.example/ad.gif' }, site)).toBeNull();
	});

	test('allows empty drafts but requires complete published ads', () => {
		const empty = { enabled: false, title: '', imageUrl: '', linkUrl: '' };
		expect(normalizeCommunityAd(empty, site)).toEqual(empty);
		expect(normalizeCommunityAd({ ...empty, enabled: true }, site)).toBeNull();
		expect(normalizeCommunityAd({ ...ad, title: 'x'.repeat(81) }, site)).toBeNull();
	});

	test('removes unpublished and malformed ads from public settings without changing administrator drafts', () => {
		const options = { creationVideoUrl: 'https://tools.example', communityAd1: ad, communityAd2: { ...ad, enabled: false }, communityAd3: null, communityAd4: { ...ad, linkUrl: 'javascript:bad' } };
		expect(publicCommunityClientOptions(options, site)).toEqual({ creationVideoUrl: options.creationVideoUrl, communityAd1: ad });
		expect(options.communityAd2.imageUrl).toBe(ad.imageUrl);
		expect(options.communityAd4.linkUrl).toBe('javascript:bad');
	});
});
