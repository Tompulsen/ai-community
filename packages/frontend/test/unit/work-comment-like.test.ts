/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, ref } from 'vue';
import WorkCommentLike from '../../src/pages/community/work-comment-like.vue';
import type { entities } from 'misskey-js';

const mock = vi.hoisted(() => ({ api: vi.fn(), confirm: vi.fn(), actor: { id: 'viewer' } as { id: string } | null }));
vi.mock('@/utility/misskey-api.js', () => ({ misskeyApi: mock.api }));
vi.mock('@/i.js', () => ({ get $i() { return mock.actor; } }));
vi.mock('@/instance.js', () => ({ instance: { maxNoteTextLength: 1000 } }));
vi.mock('@/os.js', () => ({ confirm: mock.confirm }));
vi.mock('@/pages/community/interactions-copy.js', () => ({ workText: { likeComment: 'Like comment', likedComment: 'Liked comment', retry: 'Retry', interactionFailed: 'Action failed', replaceReaction: 'Replace reaction?' } }));

describe('Comment heart reactions', () => {
	let dispose: (() => void) | undefined;
	let reaction: string | null = null;
	const note = () => ({ id: 'comment', visibility: 'public', cw: null, isHidden: false, deletedAt: null, myReaction: reaction, reactions: { '❤️': reaction === '❤️' ? 5 : 4 } } as unknown as entities.Note);
	beforeEach(() => {
		mock.actor = { id: 'viewer' }; reaction = null; mock.api.mockReset(); mock.confirm.mockReset(); mock.confirm.mockResolvedValue({ canceled: false });
		mock.api.mockImplementation(async endpoint => {
			if (endpoint === 'notes/show') return note();
			if (endpoint === 'notes/reactions/create') reaction = '❤️';
			if (endpoint === 'notes/reactions/delete') reaction = null;
			return undefined;
		});
	});
	afterEach(() => { dispose?.(); dispose = undefined; });

	async function mount() {
		const login = vi.fn(), host = document.createElement('div'); document.body.append(host);
		const currentNote = ref(note());
		const app = createApp({ render: () => h(WorkCommentLike, { note: currentNote.value, onLogin: login }) }); app.mount(host);
		dispose = () => { app.unmount(); host.remove(); };
		await nextTick();
		const button = host.querySelector('button');
		if (!button) throw new Error('Missing comment like button');
		return { host, button, login, currentNote };
	}

	it('renders loaded counts with zero reads, then verifies like and unlike after tapping', async () => {
		const { button } = await mount();
		expect(button.textContent).toContain('4'); expect(mock.api).not.toHaveBeenCalled();
		button.click(); await vi.waitFor(() => expect(button.getAttribute('aria-pressed')).toBe('true'));
		expect(button.textContent).toContain('5');
		button.click(); await vi.waitFor(() => expect(button.getAttribute('aria-pressed')).toBe('false'));
		expect(button.textContent).toContain('4');
		expect(mock.api.mock.calls.filter(([endpoint]) => endpoint.startsWith('notes/reactions/')).map(([endpoint]) => endpoint)).toEqual(['notes/reactions/create', 'notes/reactions/delete']);
		expect(mock.api.mock.calls.some(([endpoint]) => endpoint === 'notes/replies')).toBe(false);
	});

	it('uses the existing login flow for a guest and performs no API write', async () => {
		mock.actor = null;
		const { button, login } = await mount(); button.click(); await nextTick();
		expect(login).toHaveBeenCalledOnce(); expect(mock.api).not.toHaveBeenCalled();
	});

	it('uses refreshed parent counts and viewer reaction for the same comment after liking', async () => {
		const { button, currentNote } = await mount();
		button.click();
		await vi.waitFor(() => { expect(button.textContent).toContain('5'); expect(button.getAttribute('aria-busy')).toBe('false'); });
		const calls = mock.api.mock.calls.length;
		currentNote.value = { ...note(), myReaction: null, reactions: { '❤️': 6 } };
		await nextTick();
		expect(button.textContent).toContain('6');
		expect(button.getAttribute('aria-pressed')).toBe('false');
		expect(mock.api).toHaveBeenCalledTimes(calls);
	});

	it('keeps the verified mutation result when the parent refreshes during a write', async () => {
		let finishWrite: (() => void) | undefined;
		const original = mock.api.getMockImplementation();
		if (!original) throw new Error('Missing API mock');
		mock.api.mockImplementation(async (endpoint, ...args) => {
			if (endpoint === 'notes/reactions/create') {
				await new Promise<void>(resolve => { finishWrite = resolve; });
			}
			return original(endpoint, ...args);
		});
		const { button, currentNote } = await mount();
		button.click();
		await vi.waitFor(() => expect(finishWrite).toBeDefined());
		currentNote.value = { ...note(), reactions: { '❤️': 6 } };
		await nextTick();
		expect(button.getAttribute('aria-busy')).toBe('true');
		expect(button.textContent).toContain('4');
		finishWrite?.();
		await vi.waitFor(() => expect(button.getAttribute('aria-busy')).toBe('false'));
		expect(button.textContent).toContain('5');
		expect(button.getAttribute('aria-pressed')).toBe('true');
	});

	it('shows failure and never invents a successful reaction count', async () => {
		const original = mock.api.getMockImplementation();
		if (!original) throw new Error('Missing API mock');
		mock.api.mockImplementation(async (endpoint, ...args) => { if (endpoint === 'notes/reactions/create') throw new Error('Unavailable'); return original(endpoint, ...args); });
		const { host, button } = await mount(); button.click();
		await vi.waitFor(() => expect(host.querySelector('[role="alert"]')).not.toBeNull());
		expect(button.getAttribute('aria-pressed')).toBe('false'); expect(button.getAttribute('aria-label')).toContain('4');
	});

	it('preserves an existing non-heart reaction when replacement is canceled', async () => {
		reaction = '👍'; mock.confirm.mockResolvedValue({ canceled: true });
		const { button } = await mount(); button.click();
		await vi.waitFor(() => expect(mock.confirm).toHaveBeenCalledOnce());
		expect(mock.api.mock.calls.some(([endpoint]) => endpoint.startsWith('notes/reactions/'))).toBe(false);
		expect(reaction).toBe('👍');
	});
});
