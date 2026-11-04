/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, test } from 'vitest';
import { normalizeCreationUrl } from '@/misc/creation-url.js';

const site = 'https://community.example';

describe('creation URL validation', () => {
	test('preserves external paths and query strings while normalizing the URL', () => {
		expect(normalizeCreationUrl(' HTTPS://TOOLS.EXAMPLE/editor?type=image#canvas ', site)).toBe('https://tools.example/editor?type=image#canvas');
	});

	test.each([
		'', '/editor', '//tools.example', 'http://tools.example', 'javascript:alert(1)',
		'data:text/html,test', 'https:///tools.example', 'https://user:password@tools.example',
		'https://user@tools.example', 'https://community.example/create/text',
		'https://COMMUNITY.EXAMPLE:443/editor', 'https://tools.example/a\nb',
		'https://tools.example\\@community.example', 'https://',
		`https://tools.example/${'a'.repeat(2048)}`,
	])('rejects invalid or unsafe destination %s', value => {
		expect(normalizeCreationUrl(value, site)).toBeNull();
	});
});
