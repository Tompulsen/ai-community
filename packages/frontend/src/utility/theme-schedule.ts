/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export type AppearanceMode = 'light' | 'dark' | 'schedule' | 'system';
export type ThemeSchedule = { enabled: boolean; lightStart: string; darkStart: string };

export const defaultThemeSchedule: ThemeSchedule = { enabled: false, lightStart: '07:00', darkStart: '19:00' };

function minutes(time: string): number {
	const [hours, mins] = time.split(':').map(Number);
	return hours * 60 + mins;
}

export function isValidThemeSchedule(lightStart: string, darkStart: string): boolean {
	const time = /^([01]\d|2[0-3]):[0-5]\d$/;
	return time.test(lightStart) && time.test(darkStart) && lightStart !== darkStart;
}

export function normalizeThemeSchedule(value: Partial<ThemeSchedule> | null | undefined): ThemeSchedule {
	if (!value || !isValidThemeSchedule(value.lightStart ?? '', value.darkStart ?? '')) return { ...defaultThemeSchedule };
	return { enabled: value.enabled === true, lightStart: value.lightStart!, darkStart: value.darkStart! };
}

/** Local wall-clock time; start inclusive, end exclusive, including overnight ranges. */
export function isScheduledDark(schedule: ThemeSchedule, now = new Date()): boolean {
	const light = minutes(schedule.lightStart);
	const dark = minutes(schedule.darkStart);
	const current = now.getHours() * 60 + now.getMinutes();
	return dark > light ? current >= dark || current < light : current >= dark && current < light;
}
