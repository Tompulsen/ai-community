/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export async function newApiSigninConfig(signal?: AbortSignal): Promise<{ enabled: boolean; issuer?: string; studioOrigin?: string; }> {
	const response = await window.fetch('/api/newapi/config', { credentials: 'same-origin', cache: 'no-store', signal });
	if (!response.ok) throw new Error('SSO_UNAVAILABLE');
	return response.json();
}

export async function newApiStudioUrl(token: string, kind: string, signal?: AbortSignal): Promise<string> {
	const response = await window.fetch('/api/newapi/studio/start', {
		method: 'POST', credentials: 'same-origin', cache: 'no-store', signal,
		headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ i: token, kind }),
	});
	const data = await response.json();
	if (!response.ok) throw new Error(data.error ?? 'STUDIO_UNAVAILABLE');
	const target = new URL(data.url);
	if (target.protocol !== 'https:' || target.pathname !== '/api/new-api/community/start') throw new Error('STUDIO_UNAVAILABLE');
	return target.href;
}

export async function startNewApiSignin(returnTo = window.location.pathname): Promise<void> {
	const response = await window.fetch('/api/newapi/start', {
		method: 'POST', credentials: 'same-origin', cache: 'no-store',
		headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ returnTo }),
	});
	if (!response.ok) throw new Error('SSO_UNAVAILABLE');
	const { authorizationUrl } = await response.json();
	const target = new URL(authorizationUrl);
	if (target.protocol !== 'https:') throw new Error('SSO_UNAVAILABLE');
	window.location.assign(target.href);
}
