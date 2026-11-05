/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { CommunityFile, CommunityGateway, CommunityPage, CommunityWork, SubmissionStatus } from './types.js';
import { communityText as t } from './copy.js';

const isObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const isId = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value);
const isFile = (file: unknown): file is CommunityFile => isObject(file) && isId(file.id) && typeof file.name === 'string' && typeof file.type === 'string' && typeof file.url === 'string' && (file.thumbnailUrl == null || typeof file.thumbnailUrl === 'string') && (file.isSensitive == null || typeof file.isSensitive === 'boolean');

export function isCommunityWork(value: unknown): value is CommunityWork {
	if (!isObject(value) || !isObject(value.author)) return false;
	return isId(value.id) && Number.isInteger(value.version) && Number(value.version) >= 0
		&& ['video', 'image', 'resource'].includes(String(value.category))
		&& ['pending', 'published', 'approved', 'rejected', 'removed', 'withdrawn'].includes(String(value.status))
		&& ['title', 'text', 'model', 'sourceUrl', 'license', 'submittedAt'].every(key => typeof value[key] === 'string')
		&& Number.isFinite(Date.parse(value.submittedAt as string))
		&& Array.isArray(value.files) && value.files.every(isFile)
		&& isId(value.author.id) && typeof value.author.name === 'string' && typeof value.author.username === 'string'
		&& (value.rejectionReason === null || typeof value.rejectionReason === 'string')
		&& (value.approvedNoteId === null || isId(value.approvedNoteId))
		&& (!['approved', 'published'].includes(String(value.status)) || isId(value.approvedNoteId))
		&& Number.isInteger(value.repliesCount) && Number(value.repliesCount) >= 0;
}

export function parseCommunityPage(value: unknown): CommunityPage {
	if (!isObject(value) || !Array.isArray(value.items) || !value.items.every(isCommunityWork)
		|| !(value.nextCursor === null || isId(value.nextCursor))) throw new Error(t.invalidResponse);
	return value as CommunityPage;
}

/** Project extension; never falls back to unmoderated Misskey timelines. */
export function createCommunityGateway(options: {
	apiUrl: string;
	getToken: () => string | undefined;
	chooseFiles: CommunityGateway['chooseFiles'];
	uploadFiles?: CommunityGateway['uploadFiles'];
	fetch?: typeof fetch;
}): CommunityGateway {
	async function request(endpoint: string, data: object, signal?: AbortSignal): Promise<unknown> {
		const controller = new AbortController();
		const abort = () => controller.abort();
		if (signal?.aborted) controller.abort();
		signal?.addEventListener('abort', abort, { once: true });
		const timeout = window.setTimeout(abort, 20000);
		try {
			const token = options.getToken();
			const response = await (options.fetch ?? window.fetch)(`${options.apiUrl}/${endpoint}`, {
				method: 'POST', credentials: 'omit', cache: 'no-store',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ ...data, ...(token ? { i: token } : {}) }), signal: controller.signal,
			});
			if (!response.ok) {
				const body = await response.json().catch(() => null);
				const messages: Record<string, string> = { COMMUNITY_INVALID_FILES: t.invalidFiles, COMMUNITY_INVALID_CONTENT: t.invalidContent, COMMUNITY_AUTHOR_UNAVAILABLE: t.authorUnavailable, COMMUNITY_CANNOT_PUBLISH: t.cannotPublish, COMMUNITY_NOT_FOUND: t.notFound, RATE_LIMIT_EXCEEDED: t.rateLimited };
				const fallback = response.status === 401 ? t.loginError : response.status === 403 ? t.permissionError : response.status === 409 ? t.conflictError : [404, 501, 503].includes(response.status) ? t.serviceUnavailable : t.networkError;
				throw new Error(messages[body?.error?.code] ?? fallback);
			}
			try { return await response.json(); } catch { throw new Error(t.invalidResponse); }
		} catch (error) {
			if (controller.signal.aborted && !signal?.aborted) throw new Error(t.networkError);
			throw error;
		} finally {
			window.clearTimeout(timeout);
			signal?.removeEventListener('abort', abort);
		}
	}

	return {
		async list(section, query, signal) {
			if (section === 'profile' && (!isId(query.authorId) || (query.category != null && !['video', 'image', 'resource'].includes(query.category)))) throw new Error(t.invalidResponse);
			const endpoint = section === 'review' ? 'admin/community/submissions' : section === 'mine' ? 'community/submissions/mine' : 'community/works';
			const page = parseCommunityPage(await request(endpoint, {
				limit: 20, query: query.query, ...(query.cursor ? { untilId: query.cursor } : {}),
				...(section === 'profile' ? { authorId: query.authorId, ...(query.category ? { category: query.category } : {}) } : section === 'mine' || section === 'review' ? { status: query.status } : { category: section }),
			}, signal));
			if (endpoint === 'community/works' && page.items.some(work => !['approved', 'published'].includes(work.status) || (section === 'profile' ? work.author.id !== query.authorId || (query.category != null && work.category !== query.category) : work.category !== section))) throw new Error(t.invalidResponse);
			return page;
		},
		async submit(input) {
			const result = await request('community/submissions/create', input);
			if (!isObject(result) || !isId(result.id) || !['pending', 'published', 'approved', 'rejected', 'removed', 'withdrawn'].includes(String(result.status)) || typeof result.submittedAt !== 'string' || !Number.isFinite(Date.parse(result.submittedAt))) throw new Error(t.invalidResponse);
			return { id: result.id, status: result.status as SubmissionStatus, submittedAt: result.submittedAt };
		},
		async review(input) {
			const result = await request('admin/community/review', input);
			if (!isCommunityWork(result)) throw new Error(t.invalidResponse);
			return result;
		},
		chooseFiles: options.chooseFiles,
		uploadFiles: options.uploadFiles,
	};
}
