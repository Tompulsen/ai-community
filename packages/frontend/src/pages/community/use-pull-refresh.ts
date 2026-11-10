/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { computed, onBeforeUnmount, onDeactivated, onMounted, ref, watch } from 'vue';
import type { Ref } from 'vue';

/** The community scrolls inside its own main element, not the window. */
export function usePullRefresh(root: Ref<HTMLElement | undefined>, enabled: () => boolean, refresh: () => Promise<void>) {
	const distance = ref(0);
	const ready = computed(() => distance.value >= 64);
	let start: { id: number; x: number; y: number } | undefined;
	let claimed = false;
	let ignoreClickUntil = 0;

	function cancel() { start = undefined; distance.value = 0; claimed = false; }

	function begin(event: TouchEvent) {
		cancel();
		if (!enabled() || event.touches.length !== 1 || !root.value || root.value.scrollTop > 0) return;
		if (event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable="true"], [role="dialog"]')) return;
		const touch = event.touches[0];
		start = { id: touch.identifier, x: touch.clientX, y: touch.clientY };
	}

	function move(event: TouchEvent) {
		if (!start) return;
		if (!enabled() || event.touches.length !== 1 || (root.value?.scrollTop ?? 1) > 0) { cancel(); return; }
		const touch = event.touches[0];
		if (touch.identifier !== start.id) { cancel(); return; }
		const dy = touch.clientY - start.y, dx = Math.abs(touch.clientX - start.x);
		if (!claimed && Math.max(Math.abs(dy), dx) < 10) return;
		if (dy <= 0 || (!claimed && dx >= dy)) { cancel(); return; }
		if (!event.cancelable) { cancel(); return; }
		event.preventDefault();
		claimed = true;
		ignoreClickUntil = Date.now() + 400;
		distance.value = Math.min(96, Math.round(dy / 2));
	}

	function end() {
		const shouldRefresh = claimed && ready.value && enabled();
		cancel();
		if (shouldRefresh) void refresh().catch(() => {});
	}

	function click(event: MouseEvent) {
		if (Date.now() >= ignoreClickUntil) return;
		event.preventDefault();
		event.stopImmediatePropagation();
	}

	let element: HTMLElement | undefined;
	onMounted(() => {
		element = root.value;
		element?.addEventListener('touchstart', begin, { passive: true });
		element?.addEventListener('touchmove', move, { passive: false });
		element?.addEventListener('touchend', end);
		element?.addEventListener('touchcancel', cancel);
		element?.addEventListener('click', click, true);
		window.addEventListener('blur', cancel);
	});
	watch(enabled, value => { if (!value) cancel(); });
	onDeactivated(cancel);
	onBeforeUnmount(() => {
		cancel();
		element?.removeEventListener('touchstart', begin);
		element?.removeEventListener('touchmove', move);
		element?.removeEventListener('touchend', end);
		element?.removeEventListener('touchcancel', cancel);
		element?.removeEventListener('click', click, true);
		window.removeEventListener('blur', cancel);
	});
	return { distance, ready };
}
