/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { computed, onActivated, onBeforeUnmount, onDeactivated, onMounted, ref, watch } from 'vue';
import { prefer } from '@/preferences.js';

// One frame per pointer update; no idle animation loop or device-orientation tracking.
export function useShowcaseMotion() {
	const stage = ref<HTMLElement>();
	const media = window.matchMedia('(prefers-reduced-motion: reduce)');
	const pointer = window.matchMedia('(hover: hover) and (pointer: fine)');
	const reduced = ref(media.matches);
	const active = ref(true);
	const visible = ref(true);
	const foreground = ref(!window.document.hidden);
	const motionAllowed = computed(() => prefer.s.animation && !reduced.value);
	const motionRunning = computed(() => motionAllowed.value && active.value && visible.value && foreground.value);
	let observer: IntersectionObserver | undefined;
	let frame: number | undefined;
	let bounds: DOMRect | undefined;
	let x = 0;
	let y = 0;

	function reset() {
		if (frame !== undefined) cancelAnimationFrame(frame);
		frame = undefined;
		bounds = undefined;
		stage.value?.style.removeProperty('--stage-x');
		stage.value?.style.removeProperty('--stage-y');
	}

	function move(event: PointerEvent) {
		if (!motionRunning.value || !pointer.matches || event.pointerType === 'touch' || !stage.value) return;
		bounds ??= stage.value.getBoundingClientRect();
		if (!bounds.width || !bounds.height) return;
		x = Math.max(-1, Math.min(1, (event.clientX - bounds.left) / bounds.width * 2 - 1));
		y = Math.max(-1, Math.min(1, (event.clientY - bounds.top) / bounds.height * 2 - 1));
		if (frame !== undefined) return;
		frame = requestAnimationFrame(() => {
			frame = undefined;
			if (!motionRunning.value) return;
			stage.value?.style.setProperty('--stage-x', x.toFixed(3));
			stage.value?.style.setProperty('--stage-y', y.toFixed(3));
		});
	}

	function updatePreference() { reduced.value = media.matches; reset(); }

	function updateVisibility() { foreground.value = !window.document.hidden; reset(); }

	watch(motionRunning, allowed => { if (!allowed) reset(); });
	onMounted(() => {
		media.addEventListener('change', updatePreference);
		pointer.addEventListener('change', reset);
		window.document.addEventListener('visibilitychange', updateVisibility);
		window.addEventListener('blur', reset);
		window.addEventListener('resize', reset);
		window.addEventListener('scroll', reset, { capture: true, passive: true });
		observer = new IntersectionObserver(entries => { visible.value = entries.some(entry => entry.isIntersecting); });
		if (stage.value) observer.observe(stage.value);
	});
	onActivated(() => { active.value = true; });
	onDeactivated(() => { active.value = false; reset(); });
	onBeforeUnmount(() => {
		active.value = false;
		reset();
		observer?.disconnect();
		media.removeEventListener('change', updatePreference);
		pointer.removeEventListener('change', reset);
		window.document.removeEventListener('visibilitychange', updateVisibility);
		window.removeEventListener('blur', reset);
		window.removeEventListener('resize', reset);
		window.removeEventListener('scroll', reset, true);
	});

	return { stage, motionAllowed, motionRunning, move, reset };
}
