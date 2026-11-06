/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { onActivated, onBeforeUnmount, onDeactivated, onMounted, ref, watch } from 'vue';

/** Measure a continuous prefix of complete preview rows; never turn the preview into a scroller. */
export function useCommentPreview(enabled: () => boolean, changed: () => unknown, fill: () => void) {
	const root = ref<HTMLElement>();
	const viewport = ref<HTMLElement>();
	const list = ref<HTMLElement>();
	const footer = ref<HTMLElement>();
	const inView = ref(false);
	const visibleCount = ref(0);
	let active = true;
	let frame = 0;
	let resize: ResizeObserver | undefined;
	let intersection: IntersectionObserver | undefined;

	function measure() {
		frame = 0;
		if (!active || !enabled() || !viewport.value) return;
		const bounds = viewport.value.getBoundingClientRect();
		const rows = Array.from(list.value?.children ?? []) as HTMLElement[];
		let count = 0;
		for (const row of rows) {
			if (row.getBoundingClientRect().bottom > bounds.bottom + 0.5) break;
			count++;
		}
		// A resize must not leave keyboard focus inside a now-hidden comment.
		if (rows.slice(count).some(row => row.contains(window.document.activeElement))) footer.value?.querySelector<HTMLElement>('a')?.focus({ preventScroll: true });
		if (visibleCount.value !== count) visibleCount.value = count;
		if (inView.value && bounds.height > 0 && count === rows.length) fill();
	}

	function schedule() {
		if (active && enabled() && !frame) frame = requestAnimationFrame(measure);
	}

	function observeSize() {
		resize?.disconnect();
		if (!active || !enabled()) return;
		resize ??= new ResizeObserver(schedule);
		for (const element of [root.value, viewport.value, list.value, ...(list.value?.children ?? [])]) if (element) resize.observe(element);
		schedule();
	}

	function start() {
		active = true;
		if (!enabled() || !root.value) return;
		intersection?.disconnect();
		intersection = new IntersectionObserver(entries => {
			inView.value = entries.some(entry => entry.isIntersecting);
			schedule();
		});
		intersection.observe(root.value);
		observeSize();
	}

	function stop() {
		active = false;
		inView.value = false;
		intersection?.disconnect();
		resize?.disconnect();
		cancelAnimationFrame(frame);
		frame = 0;
	}

	watch([viewport, list, changed], observeSize, { flush: 'post' });
	onMounted(start);
	onActivated(start);
	onDeactivated(stop);
	onBeforeUnmount(stop);
	return { root, viewport, list, footer, inView, visibleCount, schedule };
}
