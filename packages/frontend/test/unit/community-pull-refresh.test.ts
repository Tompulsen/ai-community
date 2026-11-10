/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterEach, describe, expect, test, vi } from 'vitest';
import { createApp, defineComponent, h, nextTick, ref } from 'vue';
import { usePullRefresh } from '@/pages/community/use-pull-refresh.js';

const cleanup: (() => void)[] = [];
afterEach(() => { cleanup.splice(0).forEach(dispose => dispose()); });

function fixture() {
	const enabled = ref(true);
	const refresh = vi.fn(async () => {});
	const host = document.createElement('div');
	document.body.append(host);
	const app = createApp(defineComponent({
		setup() {
			const root = ref<HTMLElement>();
			const pull = usePullRefresh(root, () => enabled.value, refresh);
			return () => h('main', { ref: root, 'data-ready': pull.ready.value }, [h('input'), h('button', 'Open work')]);
		},
	}));
	app.mount(host);
	cleanup.push(() => { app.unmount(); host.remove(); });
	const element = host.querySelector('main')!;
	const touch = (type: string, x = 20, y = 20, count = 1, target: Element = element) => {
		const event = new Event(type, { bubbles: true, cancelable: true });
		Object.defineProperty(event, 'touches', { value: Array.from({ length: count }, (_, id) => ({ identifier: id, clientX: x + id * 20, clientY: y })) });
		target.dispatchEvent(event);
		return event;
	};
	return { element, touch, refresh, enabled, unmount: () => app.unmount() };
}

describe('community pull refresh', () => {
	test('a downward pull at the top refreshes once and suppresses the work click', async () => {
		const f = fixture();
		f.touch('touchstart');
		expect(f.touch('touchmove', 20, 180).defaultPrevented).toBe(true);
		await nextTick();
		expect(f.element.dataset.ready).toBe('true');
		f.touch('touchend', 20, 180, 0);
		f.touch('touchend', 20, 180, 0);
		expect(f.refresh).toHaveBeenCalledTimes(1);
		const click = new MouseEvent('click', { bubbles: true, cancelable: true });
		f.element.querySelector('button')!.dispatchEvent(click);
		expect(click.defaultPrevented).toBe(true);
	});

	test.each(['short', 'horizontal', 'cancel', 'multitouch', 'blur', 'disabled', 'scroll', 'input'])('%s does not refresh and a later normal pull works', async kind => {
		const f = fixture();
		if (kind === 'disabled') f.enabled.value = false;
		if (kind === 'scroll') f.element.scrollTop = 80;
		f.touch('touchstart', 20, 20, 1, kind === 'input' ? f.element.querySelector('input')! : f.element);
		f.touch('touchmove', kind === 'horizontal' ? 200 : 20, kind === 'short' || kind === 'horizontal' ? 50 : 180, kind === 'multitouch' ? 2 : 1);
		if (kind === 'blur') window.dispatchEvent(new Event('blur'));
		f.touch(kind === 'cancel' ? 'touchcancel' : 'touchend', 20, 180, 0);
		expect(f.refresh).not.toHaveBeenCalled();
		f.enabled.value = true; f.element.scrollTop = 0;
		await nextTick();
		f.touch('touchstart'); f.touch('touchmove', 20, 180); f.touch('touchend', 20, 180, 0);
		expect(f.refresh).toHaveBeenCalledTimes(1);
	});

	test('disabling during a pull cancels it and unmount removes all handlers', async () => {
		const f = fixture();
		f.touch('touchstart'); f.touch('touchmove', 20, 180);
		f.enabled.value = false;
		await nextTick();
		f.touch('touchend', 20, 180, 0);
		expect(f.refresh).not.toHaveBeenCalled();
		f.unmount(); f.enabled.value = true;
		f.touch('touchstart'); f.touch('touchmove', 20, 180); f.touch('touchend', 20, 180, 0);
		expect(f.refresh).not.toHaveBeenCalled();
	});
});
