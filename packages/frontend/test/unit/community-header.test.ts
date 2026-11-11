/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterEach, describe, expect, test, vi } from 'vitest';
import { createApp, defineComponent, h, nextTick } from 'vue';
import Header from '@/ui/_common_/community-header.vue';

const mocks = vi.hoisted(() => ({
	user: null as { username: string; isAdmin: boolean; isModerator: boolean } | null,
	pushByPath: vi.fn(),
	popupMenu: vi.fn(),
	getAccountMenu: vi.fn(async () => [{ type: 'link', text: 'Profile', to: '/@tester' }]),
}));
vi.mock('@/i.js', () => ({ get $i() { return mocks.user; } }));
vi.mock('@/router.js', () => ({ useRouter: () => ({
	getCurrentFullPath: () => '/community/image?q=cat&tags=one',
	useListener: vi.fn(),
	pushByPath: mocks.pushByPath,
}) }));
vi.mock('@/os.js', () => ({ popupMenu: mocks.popupMenu }));
vi.mock('@/accounts.js', () => ({ getAccountMenu: mocks.getAccountMenu }));
vi.mock('@/instance.js', () => ({ instance: { name: 'Community' } }));
vi.mock('@/i18n.js', () => ({ i18n: { ts: { _aiCommunity: { title: 'Community' }, account: 'Account', settings: 'Settings', controlPanel: 'Admin', timeline: 'Timeline', widgets: 'Widgets', login: 'Log in' } } }));
vi.mock('@/pages/home/copy.js', () => ({ homeLanguage: 'en-US' }));
vi.mock('@/pages/community/copy.js', () => ({ communityText: { publish: 'Publish', review: 'Review' } }));
vi.mock('@/pages/community/compose.js', () => ({ requestCommunityComposer: vi.fn() }));
vi.mock('@/utility/creation-pages.js', () => ({ workbenchText: { title: 'Create', tools: 'Tools' } }));

const cleanup: (() => void)[] = [];
afterEach(() => {
	cleanup.splice(0).forEach(dispose => dispose());
	mocks.user = null;
	vi.clearAllMocks();
});

function fixture() {
	const host = document.createElement('div');
	document.body.append(host);
	const app = createApp(Header);
	app.config.globalProperties.$style = {};
	app.component('MkA', defineComponent({ props: ['to'], setup: (props, { slots }) => () => h('a', { href: props.to }, slots.default?.()) }));
	app.component('MkAvatar', defineComponent({ setup: () => () => h('span') }));
	app.mount(host);
	cleanup.push(() => { app.unmount(); host.remove(); });
	return host;
}

describe('community header grouping', () => {
	test('creator navigation waits until the menu is closed and preserves feed filters', async () => {
		const host = fixture();
		host.querySelector<HTMLButtonElement>('[data-testid="community-menu"]')!.click();
		const [items, , options] = mocks.popupMenu.mock.calls[0];
		items.find((item: { text: string }) => item.text === 'Creators to discover').action();
		expect(mocks.pushByPath).not.toHaveBeenCalled();
		options.onClosed();
		expect(mocks.pushByPath).not.toHaveBeenCalled();
		await nextTick();
		expect(mocks.pushByPath).toHaveBeenCalledWith('/community/image?q=cat&tags=one&panel=community');
	});

	test('guest community menu contains public destinations without account or admin commands', () => {
		const host = fixture();
		host.querySelector<HTMLButtonElement>('[data-testid="community-menu"]')!.click();
		const [items] = mocks.popupMenu.mock.calls[0];
		expect(items.map((item: { text: string }) => item.text)).toEqual(['View all', 'Creators to discover', 'Home']);
	});

	test('avatar menu reuses the profile once and gates management by role', async () => {
		mocks.user = { username: 'tester', isAdmin: false, isModerator: false };
		const host = fixture();
		host.querySelector<HTMLButtonElement>('[aria-label="Account: @tester"]')!.click();
		await nextTick();
		let items = mocks.popupMenu.mock.calls[0][0];
		expect(items.filter((item: { to?: string }) => item.to === '/@tester')).toHaveLength(1);
		expect(items.some((item: { to?: string }) => item.to === '/my/favorites')).toBe(true);
		expect(items.some((item: { to?: string }) => item.to === '/settings')).toBe(true);
		expect(items.some((item: { to?: string }) => item.to === '/admin')).toBe(false);
		mocks.user.isModerator = true;
		host.querySelector<HTMLButtonElement>('[aria-label="Account: @tester"]')!.click();
		await nextTick();
		items = mocks.popupMenu.mock.calls[1][0];
		expect(items.some((item: { to?: string }) => item.to === '/community/review')).toBe(true);
		expect(items.some((item: { to?: string }) => item.to === '/admin')).toBe(true);
	});
});
