/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, test } from 'vitest';
import { defaultThemeSchedule, isScheduledDark, isValidThemeSchedule, normalizeThemeSchedule } from '@/utility/theme-schedule.js';

describe('daily appearance schedule', () => {
	test.each([
		['00:00', true], ['06:59', true], ['07:00', false], ['18:59', false], ['19:00', true], ['23:59', true],
	])('normal schedule at %s', (time, dark) => {
		expect(isScheduledDark(defaultThemeSchedule, new Date(`2026-11-07T${time}:00`))).toBe(dark);
	});

	test.each([
		['00:00', false], ['06:59', false], ['07:00', true], ['18:59', true], ['19:00', false], ['23:59', false],
	])('reversed schedule at %s', (time, dark) => {
		expect(isScheduledDark({ enabled: true, lightStart: '19:00', darkStart: '07:00' }, new Date(`2026-11-07T${time}:00`))).toBe(dark);
	});

	test.each([
		['07:00', '07:00'], ['', '19:00'], ['24:00', '19:00'], ['07:60', '19:00'], ['7:00', '19:00'], ['12:00:00', '19:00'],
	])('rejects invalid or equal times %s / %s', (light, dark) => {
		expect(isValidThemeSchedule(light, dark)).toBe(false);
		expect(normalizeThemeSchedule({ enabled: true, lightStart: light, darkStart: dark })).toEqual(defaultThemeSchedule);
	});

	test('supports midnight and one-minute windows', () => {
		const schedule = { enabled: true, lightStart: '00:00', darkStart: '00:01' };
		expect(isValidThemeSchedule(schedule.lightStart, schedule.darkStart)).toBe(true);
		expect(isScheduledDark(schedule, new Date('2026-11-07T00:00:59'))).toBe(false);
		expect(isScheduledDark(schedule, new Date('2026-11-07T00:01:00'))).toBe(true);
	});

	test('missing preferences preserve the existing system-following behavior', () => {
		expect(normalizeThemeSchedule(undefined)).toEqual(defaultThemeSchedule);
		expect(normalizeThemeSchedule(null)).toEqual(defaultThemeSchedule);
		expect(normalizeThemeSchedule({ enabled: true })).toEqual(defaultThemeSchedule);
	});
});
