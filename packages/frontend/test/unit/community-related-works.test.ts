/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { cleanup, fireEvent, render, waitFor } from '@testing-library/vue';
import { afterEach, describe, expect, test, vi } from 'vitest';
import RelatedWorks from '@/pages/community/related-works.vue';
import type { CommunityWork } from '@/pages/community/types.js';

const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('@/utility/misskey-api.js', () => ({ misskeyApi: request }));
vi.mock('@/pages/home/copy.js', () => ({ homeLanguage: 'zh-CN' }));
vi.mock('@/pages/community/work-card.vue', () => ({ default: { props: ['work'], template: '<a :href="`/community/work/${work.id}`">{{ work.title }}</a>' } }));

function work(id: string, tagIds = ['tag1']): CommunityWork {
	return { id, title: id, category: 'image', status: 'published', tagIds, tags: tagIds.map(tag => ({ id: tag, name: tag, category: 'image' })), version: 1, text: '', model: '', sourceUrl: '', license: '', files: [], author: { id: 'author', name: 'Artist', username: 'artist' }, submittedAt: '2026-11-11T00:00:00Z', rejectionReason: null, approvedNoteId: `note-${id}`, repliesCount: 0 };
}

afterEach(() => { cleanup(); request.mockReset(); });

describe('Related community works', () => {
	test('requests matching tags and excludes the current, duplicate and non-public works', async () => {
		request.mockResolvedValue({ items: [work('current'), work('matching'), work('matching'), work('other', ['tag3']), { ...work('removed'), status: 'removed' }, { ...work('video'), category: 'video' }], nextCursor: null });
		const screen = render(RelatedWorks, { props: { work: work('current', ['tag1', 'tag2']) } });
		expect((await screen.findByRole('link', { name: 'matching' })).getAttribute('href')).toBe('/community/work/matching');
		expect(screen.getAllByRole('link')).toHaveLength(1);
		expect(request).toHaveBeenCalledWith('community/works', { category: 'image', tagIds: ['tag1', 'tag2'], limit: 20 }, undefined, expect.any(AbortSignal));
	});

	test('does not present unrelated works when the current work has no tags', async () => {
		const screen = render(RelatedWorks, { props: { work: work('untagged', []) } });
		expect(await screen.findByText('此作品暂无标签，暂时没有相关作品。')).toBeTruthy();
		expect(request).not.toHaveBeenCalled();
	});

	test('keeps loaded works and the pagination cursor when a later page fails', async () => {
		request.mockResolvedValueOnce({ items: [work('first')], nextCursor: 'page2' }).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ items: [work('first'), work('second')], nextCursor: null });
		const screen = render(RelatedWorks, { props: { work: work('current') } });
		await screen.findByRole('link', { name: 'first' });
		const more = screen.getByRole('button', { name: '加载更多作品' });
		more.focus();
		await fireEvent.click(more);
		await screen.findByRole('alert');
		expect(screen.container.contains(document.activeElement)).toBe(true);
		expect(screen.getAllByRole('link')).toHaveLength(1);
		await fireEvent.click(screen.getByRole('button', { name: '重试' }));
		await screen.findByRole('link', { name: 'second' });
		expect(screen.getAllByRole('link')).toHaveLength(2);
		expect(request.mock.calls[1][1].untilId).toBe('page2');
		expect(request.mock.calls[2][1].untilId).toBe('page2');
		expect(screen.queryByRole('button')).toBeNull();
		expect(screen.container.contains(document.activeElement)).toBe(true);
	});

	test('ignores a stale response after switching works, even if the transport ignores cancellation', async () => {
		let resolveOld!: (value: { items: CommunityWork[]; nextCursor: null }) => void;
		request.mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; })).mockResolvedValueOnce({ items: [work('new-match', ['tag2'])], nextCursor: null });
		const screen = render(RelatedWorks, { props: { work: work('old') } });
		const signal = request.mock.calls[0][3] as AbortSignal;
		await screen.rerender({ work: work('new', ['tag2']) });
		await screen.findByRole('link', { name: 'new-match' });
		expect(signal.aborted).toBe(true);
		resolveOld({ items: [work('old-match')], nextCursor: null });
		await waitFor(() => expect(screen.getAllByRole('link').map(link => link.textContent)).toEqual(['new-match']));
	});

	test('aborts a pending request when the drawer unmounts', () => {
		request.mockImplementation(() => new Promise(() => {}));
		const screen = render(RelatedWorks, { props: { work: work('current') } });
		const signal = request.mock.calls[0][3] as AbortSignal;
		screen.unmount();
		expect(signal.aborted).toBe(true);
	});
});
