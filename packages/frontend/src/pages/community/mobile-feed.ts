/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { computed, onBeforeUnmount, ref } from 'vue';
import { mainRouter } from '@/router.js';

export function useMobileCommunityFeed() {
	const viewport = window.matchMedia('(max-width: 700px)');
	const narrow = ref(viewport.matches);
	const path = ref(mainRouter.getCurrentFullPath());
	const resize = () => { narrow.value = viewport.matches; };
	viewport.addEventListener('change', resize);
	onBeforeUnmount(() => viewport.removeEventListener('change', resize));
	mainRouter.useListener('change', ({ fullPath }) => { path.value = fullPath; });
	return computed(() => narrow.value && /^\/community(?:\/(?:all|video|image|resource|knowledge|text|code|skill|compose))?\/?$/.test(path.value.split(/[?#]/)[0]));
}
