/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { watch } from 'vue';
import { prefer } from '@/preferences.js';
import { store } from '@/store.js';
import { isScheduledDark, normalizeThemeSchedule } from '@/utility/theme-schedule.js';
import type { AppearanceMode } from '@/utility/theme-schedule.js';

export function getAppearanceMode(): AppearanceMode {
	if (normalizeThemeSchedule(prefer.r.themeSchedule.value).enabled) return 'schedule';
	if (prefer.r.syncDeviceDarkMode.value) return 'system';
	return store.r.darkMode.value ? 'dark' : 'light';
}

function applyAppearance() {
	const schedule = normalizeThemeSchedule(prefer.s.themeSchedule);
	const dark = schedule.enabled ? isScheduledDark(schedule) : prefer.s.syncDeviceDarkMode ? window.matchMedia('(prefers-color-scheme: dark)').matches : store.s.darkMode;
	if (store.s.darkMode !== dark) store.set('darkMode', dark);
}

export function setAppearanceMode(mode: AppearanceMode) {
	prefer.commit('themeSchedule', { ...normalizeThemeSchedule(prefer.s.themeSchedule), enabled: mode === 'schedule' });
	prefer.commit('syncDeviceDarkMode', mode === 'system');
	if (mode === 'light' || mode === 'dark') store.set('darkMode', mode === 'dark');
	applyAppearance();
}

/** One app-wide controller, also reconciled after background throttling or sleep. */
export function initializeAppearance(): () => void {
	const media = window.matchMedia('(prefers-color-scheme: dark)');
	let timer: number | undefined;

	function reconcile() {
		window.clearTimeout(timer);
		applyAppearance();
		if (normalizeThemeSchedule(prefer.s.themeSchedule).enabled && window.document.visibilityState !== 'hidden') {
			timer = window.setTimeout(reconcile, 60000 - Date.now() % 60000);
		}
	}

	const stop = watch([prefer.r.themeSchedule, prefer.r.syncDeviceDarkMode], reconcile, { immediate: true });
	media.addEventListener('change', reconcile);
	window.document.addEventListener('visibilitychange', reconcile);
	window.addEventListener('focus', reconcile);
	window.addEventListener('pageshow', reconcile);
	return () => {
		stop();
		window.clearTimeout(timer);
		media.removeEventListener('change', reconcile);
		window.document.removeEventListener('visibilitychange', reconcile);
		window.removeEventListener('focus', reconcile);
		window.removeEventListener('pageshow', reconcile);
	};
}
