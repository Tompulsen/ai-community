/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
const address = new URL(window.document.querySelector<HTMLMetaElement>('meta[property="instance_url"]')?.content || window.location.href);
const siteName = window.document.querySelector<HTMLMetaElement>('meta[property="og:site_name"]')?.content;

export const host = address.host;
export const hostname = address.hostname;
export const url = address.origin;
export const port = address.port;
export const apiUrl = window.location.origin + '/api';
export const wsOrigin = window.location.origin;
export const lang = localStorage.getItem('lang') ?? 'en-US';
export const langs = _LANGS_;
export const version = _VERSION_;
export const instanceName = (siteName === 'Misskey' || siteName == null) ? host : siteName;
// Adopt the community's full-page workspace once, including existing Deck users.
// Keep saved Deck profiles and allow users to explicitly select Deck afterwards.
if (localStorage.getItem('communityWorkspaceVersion') !== '1') {
	if (localStorage.getItem('ui') === 'deck') localStorage.setItem('ui', 'default');
	if (localStorage.getItem('ui_temp') === 'deck') localStorage.removeItem('ui_temp');
	localStorage.setItem('communityWorkspaceVersion', '1');
}
export const ui = localStorage.getItem('ui');
export const debug = localStorage.getItem('debug') === 'true';
export const isSafeMode = localStorage.getItem('isSafeMode') === 'true';
export const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion)').matches;
