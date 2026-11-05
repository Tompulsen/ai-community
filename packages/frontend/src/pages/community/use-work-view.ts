/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { onActivated, onBeforeUnmount, onDeactivated, onMounted, ref, watch } from 'vue';
import type { Ref } from 'vue';
import type { CommunityWork } from './types.js';
import { misskeyApi } from '@/utility/misskey-api.js';

/** Count a visible preview, rather than an API prefetch or a background tab. */
export function useWorkView(element: Ref<HTMLElement | undefined>, getWork: () => CommunityWork | null) {
	const views = ref<number>();
	let observer: IntersectionObserver | undefined;
	let timer: ReturnType<typeof window.setTimeout> | undefined;
	let controller: AbortController | undefined;
	let visible = false;
	let active = true;
	let recorded = false;

	function cancel() { window.clearTimeout(timer); timer = undefined; }

	function schedule() {
		cancel();
		if (!active || !visible || recorded || window.document.visibilityState !== 'visible' || !getWork()) return;
		timer = window.setTimeout(async () => {
			if (!active || !visible || window.document.visibilityState !== 'visible') return;
			const work = getWork();
			if (!work) return;
			recorded = true;
			controller = new AbortController();
			const timeout = window.setTimeout(() => controller?.abort(), 10000);
			try {
				const result = await misskeyApi('community/works/view', { submissionId: work.id }, undefined, controller.signal);
				if (active && getWork()?.id === work.id) views.value = result.viewsCount;
			} catch { /* Browsing remains available when analytics cannot be recorded. */ } finally { window.clearTimeout(timeout); }
		}, 1000);
	}

	watch(() => getWork()?.id, () => { cancel(); controller?.abort(); recorded = false; views.value = getWork()?.viewsCount; schedule(); }, { immediate: true });
	onMounted(() => {
		observer = new IntersectionObserver(entries => { visible = entries.some(entry => entry.isIntersecting && entry.intersectionRatio >= 0.15); schedule(); }, { threshold: [0, 0.15] });
		if (element.value) observer.observe(element.value);
		window.document.addEventListener('visibilitychange', schedule);
	});
	onActivated(() => { active = true; schedule(); });
	onDeactivated(() => { active = false; cancel(); controller?.abort(); });
	onBeforeUnmount(() => { active = false; cancel(); observer?.disconnect(); controller?.abort(); window.document.removeEventListener('visibilitychange', schedule); });
	return views;
}
