/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterEach, describe, expect, test, vi } from 'vitest';
import { createApp, defineComponent, h, nextTick, ref } from 'vue';
import { useDiscoveryDrawer } from '@/pages/community/use-discovery-drawer.js';

const route = vi.hoisted(() => ({
	path: '/community',
	listeners: new Set<(event: { fullPath: string }) => void>(),
	getCurrentFullPath: vi.fn(() => route.path),
	useListener: vi.fn((_event: string, listener: (event: { fullPath: string }) => void) => route.listeners.add(listener)),
	replaceByPath: vi.fn((path: string) => {
		route.path = path;
		route.listeners.forEach(listener => listener({ fullPath: path }));
	}),
}));
vi.mock('@/router.js', () => ({ useRouter: () => route }));
vi.mock('@/os.js', () => ({ claimZIndex: () => 100 }));

const cleanup: (() => void)[] = [];
afterEach(() => {
	cleanup.splice(0).forEach(dispose => dispose());
	route.listeners.clear();
	vi.clearAllMocks();
});

function fixture(path: string, available = true) {
	route.path = path;
	const enabled = ref(available);
	const host = document.createElement('div');
	document.body.append(host);
	let drawer!: ReturnType<typeof useDiscoveryDrawer>;
	const app = createApp(defineComponent({
		setup() {
			drawer = useDiscoveryDrawer(() => enabled.value);
			return () => h('div', [
				h('button', { 'data-testid': 'community-menu' }, 'Community'),
				h('section', { ref: drawer.discoveryLayer }, [
					h('div', { ref: drawer.discoveryPanel, tabindex: -1 }, 'Creators'),
				]),
			]);
		},
	}));
	app.mount(host);
	cleanup.push(() => { app.unmount(); host.remove(); });
	return { drawer, enabled, host };
}

describe('community menu discovery navigation', () => {
	test('initial entry opens above the header and consumes only its panel parameter', async () => {
		const { drawer, host } = fixture('/community/image?q=cat&tags=one&panel=community#works');
		await nextTick();
		expect(drawer.discoveryOpen.value).toBe(true);
		expect(drawer.discoveryZIndex.value).toBe(100);
		expect(route.replaceByPath).toHaveBeenCalledWith('/community/image?q=cat&tags=one#works');
		expect(document.activeElement).toBe(drawer.discoveryPanel.value);
		drawer.closeDiscovery();
		await nextTick();
		expect(drawer.discoveryOpen.value).toBe(false);
		expect(document.activeElement).toBe(host.querySelector('[data-testid="community-menu"]'));
		expect(host.inert).not.toBe(true);
		expect(host.querySelector('button')!.inert).not.toBe(true);
	});

	test('the menu can reopen a mounted feed after closing', async () => {
		const { drawer } = fixture('/community?q=cat');
		expect(drawer.discoveryOpen.value).toBe(false);
		route.listeners.forEach(listener => listener({ fullPath: '/community?q=cat&panel=community' }));
		await nextTick();
		expect(drawer.discoveryOpen.value).toBe(true);
		drawer.closeDiscovery();
		await nextTick();
		route.listeners.forEach(listener => listener({ fullPath: '/community?q=cat&panel=community' }));
		await nextTick();
		expect(drawer.discoveryOpen.value).toBe(true);
	});

	test('waits for a public feed and ignores unrelated panel parameters', async () => {
		const { drawer, enabled } = fixture('/community?panel=community', false);
		await nextTick();
		expect(drawer.discoveryOpen.value).toBe(false);
		expect(route.replaceByPath).not.toHaveBeenCalled();
		enabled.value = true;
		await nextTick();
		expect(drawer.discoveryOpen.value).toBe(true);
		drawer.closeDiscovery();
		await nextTick();
		route.listeners.forEach(listener => listener({ fullPath: '/community?panel=other' }));
		await nextTick();
		expect(drawer.discoveryOpen.value).toBe(false);
	});
});
