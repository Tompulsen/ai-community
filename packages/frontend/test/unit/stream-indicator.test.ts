/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, nextTick } from 'vue';
import type { App } from 'vue';
import Indicator from '../../src/ui/_common_/stream-indicator.vue';

const fixture = vi.hoisted(() => {
	const listeners = new Map<string, () => void>();
	return {
		listeners,
		stream: { state: 'connected', on: (event: string, listener: () => void) => listeners.set(event, listener), off: (event: string) => listeners.delete(event) },
		store: { s: { realtimeMode: true } },
	};
});
vi.mock('@/stream.js', () => ({ useStream: () => fixture.stream }));
vi.mock('@/store.js', () => ({ store: fixture.store }));
vi.mock('@/preferences.js', () => ({ prefer: { s: { serverDisconnectedBehavior: 'quiet' } } }));
vi.mock('@/os.js', () => ({ claimZIndex: () => 100 }));
vi.mock('@/i18n.js', () => ({ i18n: { ts: { disconnectedFromServer: 'Disconnected', reload: 'Refresh', doNothing: 'Close' } } }));
vi.mock('@/components/MkButton.vue', () => ({ default: { template: '<button><slot /></button>' } }));

describe('stream connection notice', () => {
	let app: App | undefined;
	let container: HTMLDivElement;
	const mount = () => { app = createApp(Indicator); app.mount(container); };
	const emit = (event: string) => fixture.listeners.get(event)?.();
	const advance = async (ms: number) => { await vi.advanceTimersByTimeAsync(ms); await nextTick(); };
	beforeEach(() => {
		vi.useFakeTimers(); fixture.listeners.clear(); fixture.stream.state = 'connected'; fixture.store.s.realtimeMode = true;
		container = document.createElement('div'); document.body.appendChild(container);
	});
	afterEach(() => { app?.unmount(); app = undefined; container.remove(); vi.useRealTimers(); });
	it('does not show a warning when automatic reconnect recovers quickly', async () => {
		mount(); emit('_disconnected_'); await advance(3000); emit('_connected_'); await advance(10000);
		expect(container.textContent).not.toContain('Disconnected');
	});
	it('shows a persistent outage and clears the notice as soon as connection recovers', async () => {
		mount(); emit('_disconnected_'); await advance(5000);
		expect(container.querySelector('[role="status"]')?.textContent).toContain('Disconnected');
		emit('_connected_'); await nextTick(); expect(container.textContent).not.toContain('Disconnected');
		emit('_disconnected_'); await advance(5000); expect(container.textContent).toContain('Disconnected');
	});
	it('allows explicit dismissal without showing it again during the same outage', async () => {
		mount(); emit('_disconnected_'); await advance(5000);
		container.querySelectorAll('button')[1].click(); await nextTick(); await advance(10000);
		expect(container.textContent).not.toContain('Disconnected');
	});
	it('cleans up pending timers and both event listeners on unmount', async () => {
		mount(); emit('_disconnected_'); app?.unmount(); app = undefined; await advance(10000);
		expect(fixture.listeners.size).toBe(0); expect(vi.getTimerCount()).toBe(0);
	});
	it('handles mounting while already reconnecting', async () => {
		fixture.stream.state = 'reconnecting'; mount(); await advance(5000);
		expect(container.textContent).toContain('Disconnected');
	});
	it('does not subscribe when realtime mode is disabled', () => {
		fixture.store.s.realtimeMode = false; mount(); expect(fixture.listeners.size).toBe(0);
	});
});
