/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export async function newApiSigninConfig(signal?: AbortSignal): Promise<{ enabled: boolean; issuer?: string; studioOrigin?: string; }> {
	const response = await window.fetch('/api/newapi/config', { credentials: 'same-origin', cache: 'no-store', signal });
	if (!response.ok) throw new Error('SSO_UNAVAILABLE');
	const data = await response.json();
	if (typeof data?.enabled !== 'boolean') throw new Error('SSO_CONFIG');
	if (data.enabled) {
		const issuer = new URL(data.issuer);
		if (issuer.protocol !== 'https:' || issuer.username || issuer.password || issuer.pathname !== '/' || issuer.search || issuer.hash) throw new Error('SSO_CONFIG');
	}
	return data;
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

export async function startNewApiSignin(returnTo = window.location.pathname + window.location.search, signal?: AbortSignal): Promise<void> {
	const requestSignal = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(15000)]);
	const response = await window.fetch('/api/newapi/start', {
		method: 'POST', credentials: 'same-origin', cache: 'no-store', signal: requestSignal,
		headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ returnTo }),
	});
	if (!response.ok) throw new Error('SSO_UNAVAILABLE');
	const { authorizationUrl } = await response.json();
	const target = new URL(authorizationUrl);
	if (target.protocol !== 'https:') throw new Error('SSO_UNAVAILABLE');
	requestSignal.throwIfAborted();
	window.location.assign(target.href);
}

export function studioContext(userId: string, reset = false): string {
	const key = `community-studio:${userId}`;
	const existing = reset ? null : localStorage.getItem(key);
	if (existing && /^[A-Za-z0-9_-]{43}$/.test(existing)) return existing;
	const value = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
	localStorage.setItem(key, value);
	return value;
}

export async function studioContextAction(token: string, context: string, action: 'renew' | 'revoke'): Promise<void> {
	const response = await window.fetch('/api/newapi/studio/context', { method: 'POST', credentials: 'same-origin', cache: 'no-store', keepalive: action === 'revoke', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ i: token, context, action }), signal: AbortSignal.timeout(5000) });
	if (!response.ok) throw new Error('STUDIO_CONTEXT_EXPIRED');
}

export async function revokeNewApiStudio(userId: string, token: string): Promise<void> {
	const context = localStorage.getItem(`community-studio:${userId}`);
	window.dispatchEvent(new Event('community-studio-disconnect'));
	localStorage.removeItem(`community-studio:${userId}`);
	if (context) await studioContextAction(token, context, 'revoke');
}

export async function newApiStudioLaunch(token: string, kind: string, context: string, signal?: AbortSignal): Promise<{ code: string; origin: string; subject: string; userId: string; }> {
	const response = await window.fetch('/api/newapi/studio/start', { method: 'POST', credentials: 'same-origin', cache: 'no-store', signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ i: token, kind, context, returnTo: window.location.pathname + window.location.search }) });
	const data = await response.json();
	if (!response.ok) throw new Error(data.error ?? 'STUDIO_UNAVAILABLE');
	if (!/^[A-Za-z0-9_-]{43}$/.test(data.code) || new URL(data.origin).protocol !== 'https:') throw new Error('STUDIO_UNAVAILABLE');
	return data;
}

export async function startNewApiLink(token: string, password: string, factor: string, returnTo: string, signal?: AbortSignal): Promise<string> {
	const response = await window.fetch('/api/newapi/start', { method: 'POST', credentials: 'same-origin', cache: 'no-store', signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ link: true, i: token, password, token: factor, returnTo }) });
	const data = await response.json();
	if (!response.ok) throw new Error(data.error ?? 'SSO_LINK_AUTH');
	const target = new URL(data.authorizationUrl);
	if (target.protocol !== 'https:') throw new Error('SSO_UNAVAILABLE');
	return target.href;
}
