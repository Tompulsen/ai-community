/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { cleanup, fireEvent, render, waitFor } from '@testing-library/vue';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import UserSelect from '@/components/MkUserSelectDialog.vue';

const fixture = vi.hoisted(() => ({ api: vi.fn(), me: { id: 'admin', isAdmin: true, isModerator: false } }));
vi.mock('@/utility/misskey-api.js', () => ({ misskeyApi: fixture.api }));
vi.mock('@/i.js', () => ({ $i: fixture.me }));
vi.mock('@@/js/config.js', () => ({ hostname: 'community.test' }));
vi.mock('@/instance.js', () => ({ instance: { federation: 'all' } }));
vi.mock('@/store.js', () => ({ store: { s: { recentlyUsedUsers: [] }, set: vi.fn() } }));
vi.mock('@/i18n.js', () => ({ i18n: { ts: { selectUser: 'Select user', username: 'Username', name: 'Name', host: 'Host', noUsers: 'No users', loading: 'Loading', failedToFetchAccountInformation: 'Search failed', retry: 'Retry' } } }));
vi.mock('@/components/MkInput.vue', () => ({ default: { props: ['modelValue'], emits: ['update:modelValue'], template: '<label><slot name="label"/><input :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)"/></label>' } }));
vi.mock('@/components/MkButton.vue', () => ({ default: { template: '<button><slot/></button>' } }));
vi.mock('@/components/form/split.vue', () => ({ default: { template: '<div><slot/></div>' } }));
vi.mock('@/components/MkModalWindow.vue', () => ({ default: { props: ['okButtonDisabled'], emits: ['ok', 'click', 'close'], methods: { close() {} }, template: '<section><slot/><button :disabled="okButtonDisabled" @click="$emit(\'ok\')">Confirm</button></section>' } }));

const root = { id: 'new-root', username: 'na_4964e61c1df3dd93', name: 'root', host: null };
function mount(props = {}) {
	return render(UserSelect, {
		props: { localOnly: true, includeSelf: true, ...props },
		global: { stubs: {
			MkAvatar: true,
			MkUserName: { props: ['user'], template: '<span>{{ user.name }}</span>' },
			MkAcct: { props: ['user'], template: '<span>@{{ user.username }}</span>' },
		} },
	});
}

beforeEach(() => {
	fixture.me.isAdmin = true;
	fixture.api.mockImplementation(async (endpoint, body) => endpoint === 'users/show' ? (body.userIds ? [] : root) : [root]);
});
afterEach(() => { cleanup(); fixture.api.mockReset(); });

describe('User selection search', () => {
	test('admin display-name search selects the exact returned ID', async () => {
		const screen = mount({ initialQuery: 'root' });
		const row = await screen.findByRole('button', { name: 'root @na_4964e61c1df3dd93' });
		expect(fixture.api).toHaveBeenCalledWith('admin/show-users', { username: 'root', origin: 'local', state: 'available', limit: 10 });
		await fireEvent.click(row);
		await fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
		await waitFor(() => expect(screen.emitted().ok).toEqual([[root]]));
		expect(fixture.api).toHaveBeenCalledWith('users/show', { userId: root.id });
	});

	test('trims pasted accounts and their leading @', async () => {
		const screen = mount();
		await fireEvent.update(screen.getByRole('textbox'), '  @na_4964e61c1df3dd93  ');
		await screen.findByRole('button', { name: /root @na_/ });
		expect(fixture.api).toHaveBeenCalledWith('admin/show-users', expect.objectContaining({ username: root.username }));
	});

	test('keeps normal users on the public API and excludes self and remote results', async () => {
		fixture.me.isAdmin = false;
		fixture.api.mockImplementation(async (endpoint) => endpoint === 'users/show' ? [] : [root, { ...root, id: 'admin' }, { ...root, id: 'remote', host: 'other.test' }]);
		const screen = mount({ includeSelf: false, initialQuery: 'na_' });
		await screen.findByRole('button', { name: /root @na_/ });
		expect(screen.getAllByRole('button')).toHaveLength(2);
		expect(fixture.api).toHaveBeenCalledWith('users/search-by-username-and-host', { username: 'na_', host: '.', detail: false, limit: 10 });
	});

	test('preserves explicit remote host prefix search', async () => {
		const screen = mount({ localOnly: false });
		await fireEvent.update(screen.getByRole('textbox', { name: 'Host' }), ' EXAM ');
		await waitFor(() => expect(fixture.api).toHaveBeenCalledWith('users/search-by-username-and-host', { username: '', host: 'exam', detail: false, limit: 10 }));
	});

	test('clears the selected account when the query changes', async () => {
		const screen = mount({ initialQuery: 'root' });
		await fireEvent.click(await screen.findByRole('button', { name: /root @na_/ }));
		expect((screen.getByRole('button', { name: 'Confirm' }) as HTMLButtonElement).disabled).toBe(false);
		await fireEvent.update(screen.getByRole('textbox'), 'missing');
		expect((screen.getByRole('button', { name: 'Confirm' }) as HTMLButtonElement).disabled).toBe(true);
	});

	test('does not confirm a stale account after the query changes during lookup', async () => {
		let finish!: (user: typeof root) => void;
		fixture.api.mockImplementation((endpoint, body) => endpoint !== 'users/show' ? Promise.resolve([root]) : body.userIds ? Promise.resolve([]) : new Promise(resolve => { finish = resolve; }));
		const screen = mount({ initialQuery: 'root' });
		await fireEvent.click(await screen.findByRole('button', { name: /root @na_/ }));
		await fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
		await fireEvent.update(screen.getByRole('textbox'), 'another');
		finish(root);
		await waitFor(() => expect(screen.emitted().ok).toBeUndefined());
	});

	test('ignores delayed results after a newer search and after clearing input', async () => {
		const pending = new Map<string, (value: unknown[]) => void>();
		fixture.api.mockImplementation((endpoint, body) => endpoint === 'users/show' ? Promise.resolve([]) : new Promise(resolve => pending.set(body.username, resolve)));
		const screen = mount();
		await fireEvent.update(screen.getByRole('textbox'), 'old');
		await fireEvent.update(screen.getByRole('textbox'), 'root');
		pending.get('root')!([root]);
		await screen.findByRole('button', { name: /root @na_/ });
		pending.get('old')!([{ ...root, id: 'old', name: 'Wrong' }]);
		await waitFor(() => expect(screen.queryByText('Wrong')).toBeNull());
		await fireEvent.update(screen.getByRole('textbox'), 'later');
		await fireEvent.update(screen.getByRole('textbox'), '');
		pending.get('later')!([root]);
		await waitFor(() => expect(screen.queryByText('root')).toBeNull());
	});

	test('shows a retriable error instead of an empty result on network failure', async () => {
		fixture.api.mockImplementation(async (endpoint) => { if (endpoint === 'users/show') return []; throw new Error('offline'); });
		const screen = mount({ initialQuery: 'root' });
		await screen.findByRole('alert');
		expect(screen.queryByText('No users')).toBeNull();
		fixture.api.mockResolvedValue([root]);
		await fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
		await screen.findByRole('button', { name: /root @na_/ });
	});
});
