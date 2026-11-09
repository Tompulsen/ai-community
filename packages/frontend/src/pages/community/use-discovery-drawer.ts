/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { computed, nextTick, onActivated, onBeforeUnmount, onDeactivated, onMounted, ref, useId, watch } from 'vue';
import type { Ref } from 'vue';
import { focusTrap } from '@/utility/focus-trap.js';
import { claimZIndex } from '@/os.js';

const storageKey = 'community.discovery-open';

function savedOpen() {
	try { return window.localStorage.getItem(storageKey) !== 'false'; } catch { return true; }
}

export function useDiscoveryDrawer(root: Ref<HTMLElement | undefined>, enabled: () => boolean) {
	const discoveryId = useId();
	const discoveryLayer = ref<HTMLElement>();
	const discoveryPanel = ref<HTMLElement>();
	const discoveryToggle = ref<HTMLButtonElement>();
	const discoveryCompact = ref(false);
	const desktopOpen = ref(savedOpen());
	const mobileOpen = ref(false);
	const active = ref(true);
	const discoveryZIndex = ref(0);
	const discoveryOpen = computed(() => active.value && enabled() && (discoveryCompact.value ? mobileOpen.value : desktopOpen.value));
	let resize: ResizeObserver | undefined;
	let releaseFocus: (() => void) | undefined;
	let restoreToggleFocus = false;

	watch(desktopOpen, value => {
		try { window.localStorage.setItem(storageKey, String(value)); } catch { /* Storage is optional. */ }
	});

	function closeDiscovery() {
		if (discoveryCompact.value) mobileOpen.value = false;
		else desktopOpen.value = false;
		void nextTick(() => { if (active.value) discoveryToggle.value?.focus({ preventScroll: true }); });
	}

	async function toggleDiscovery() {
		if (discoveryOpen.value) { closeDiscovery(); return; }
		if (discoveryCompact.value) mobileOpen.value = true;
		else desktopOpen.value = true;
		await nextTick();
		if (discoveryOpen.value) discoveryPanel.value?.focus({ preventScroll: true });
	}

	function discoveryKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeDiscovery(); return; }
		if (!discoveryCompact.value || event.key !== 'Tab' || !discoveryPanel.value) return;
		const controls = [...discoveryPanel.value.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), a[href]')].filter(el => el.getClientRects().length && !el.closest('[inert]'));
		const first = controls[0], last = controls.at(-1);
		if (event.shiftKey && (window.document.activeElement === first || window.document.activeElement === discoveryPanel.value)) { event.preventDefault(); last?.focus(); } else if (!event.shiftKey && window.document.activeElement === last) { event.preventDefault(); first?.focus(); }
	}

	// Release before teleporting/hiding the panel; the existing focus manager also handles nested account dialogs.
	watch([discoveryOpen, discoveryCompact], ([open, compact], previous) => {
		if (!open || !compact) { releaseFocus?.(); releaseFocus = undefined; }
		if (open && compact && !previous?.every(Boolean)) discoveryZIndex.value = claimZIndex('middle');
		if (!open && discoveryLayer.value?.contains(window.document.activeElement)) restoreToggleFocus = true;
	}, { flush: 'sync' });
	watch([discoveryOpen, discoveryCompact, discoveryLayer], ([open, compact]) => {
		if (restoreToggleFocus) { restoreToggleFocus = false; if (active.value) discoveryToggle.value?.focus({ preventScroll: true }); }
		if (open && compact && discoveryLayer.value && !releaseFocus) releaseFocus = focusTrap(discoveryLayer.value).release;
	}, { flush: 'post' });
	watch(discoveryCompact, () => { mobileOpen.value = false; });

	function start() {
		active.value = true;
		desktopOpen.value = savedOpen();
		if (!root.value) return;
		const measure = () => { if (root.value) discoveryCompact.value = root.value.getBoundingClientRect().width <= 900; };
		measure();
		resize?.disconnect();
		resize = new ResizeObserver(measure);
		resize.observe(root.value);
	}

	function stop() {
		active.value = false;
		mobileOpen.value = false;
		resize?.disconnect();
		releaseFocus?.(); releaseFocus = undefined;
	}

	onMounted(start);
	onActivated(start);
	onDeactivated(stop);
	onBeforeUnmount(stop);
	return { discoveryId, discoveryLayer, discoveryPanel, discoveryToggle, discoveryCompact, discoveryOpen, discoveryZIndex, closeDiscovery, toggleDiscovery, discoveryKeydown };
}
