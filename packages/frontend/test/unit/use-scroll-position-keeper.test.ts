/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterEach, describe, expect, test, vi } from 'vitest';
import { createApp, defineComponent, h, KeepAlive, nextTick, ref } from 'vue';
import { useScrollPositionKeeper } from '@/composables/use-scroll-position-keeper.js';

describe('Cached scroll position', () => {
	let dispose: (() => void) | undefined;
	afterEach(() => { dispose?.(); vi.useRealTimers(); });

	async function setup() {
		vi.useFakeTimers();
		const visible = ref(true);
		const root = ref<HTMLElement>();
		const Feed = defineComponent({
			setup() {
				useScrollPositionKeeper(root);
				return () => h('main', { ref: root }, h('a', { href: '/work' }, 'Preview'));
			},
		});
		const host = document.createElement('div');
		document.body.append(host);
		const app = createApp({ render: () => h(KeepAlive, {}, { default: () => visible.value ? h(Feed) : h('div') }) });
		app.mount(host);
		dispose = () => { app.unmount(); host.remove(); };
		await nextTick();
		await vi.advanceTimersByTimeAsync(100);
		const element = root.value!;
		let top = 0;
		// Detached KeepAlive content has no scrollable layout, as in Chromium.
		Object.defineProperty(element, 'scrollTop', { configurable: true, get: () => element.isConnected ? top : 0, set: value => { top = value; } });
		async function leave() { visible.value = false; await nextTick(); top = 0; }
		async function back(settle = true) { visible.value = true; await nextTick(); if (settle) await vi.advanceTimersByTimeAsync(100); }
		return { element, leave, back };
	}

	test('remembers an offset near the top even without an anchor', async () => {
		const { element, leave, back } = await setup();
		element.scrollTop = 50;
		element.dispatchEvent(new Event('pointerdown', { bubbles: true }));
		await leave();
		await back();
		expect(element.scrollTop).toBe(50);
	});

	test('keyboard navigation captures the latest scroll before detaching', async () => {
		const { element, leave, back } = await setup();
		element.scrollTop = 200;
		element.dispatchEvent(new Event('scroll'));
		element.scrollTop = 750;
		element.dispatchEvent(new Event('scroll'));
		element.querySelector('a')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
		await leave();
		await back();
		expect(element.scrollTop).toBe(750);
	});

	test('a wheel gesture after returning takes priority over delayed restoration', async () => {
		const { element, leave, back } = await setup();
		element.scrollTop = 500;
		element.dispatchEvent(new Event('pointerdown'));
		await leave();
		await back(false);
		element.dispatchEvent(new Event('wheel'));
		element.scrollTop = 850;
		await vi.advanceTimersByTimeAsync(150);
		expect(element.scrollTop).toBe(850);
	});
});
