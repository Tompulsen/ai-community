<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div :class="[$style.showcase, { [$style.popular]: mode === 'popular' && work }]" :aria-busy="state === 'loading'" data-testid="home-showcase">
	<WorkPanel v-if="mode === 'popular' && work" :key="work.approvedNoteId ?? work.id" :work="work"/>
	<img v-else-if="imageUrl && !failed" :key="imageUrl" :src="imageUrl" :alt="homeText.showcase" :class="$style.customImage" decoding="async" data-testid="home-custom-image" @error="failed = true"/>
	<div v-else :class="$style.art" role="img" :aria-label="homeText.artTitle" data-testid="home-default-art">
		<div :class="$style.artHeading" aria-hidden="true"><span>{{ homeText.showcaseTitle }}</span><i class="ti ti-sparkles"></i></div>
		<div :class="$style.poster" aria-hidden="true">
			<div :class="$style.posterTop"><span>{{ homeText.artTitle }}</span><i class="ti ti-arrow-up-right"></i></div>
			<img :src="logoFailed ? '/favicon.ico' : logoUrl" alt="" :class="$style.mascot" @error="logoFailed = true"/>
			<p>{{ homeText.artNote }}</p>
		</div>
		<div :class="$style.sticker" aria-hidden="true"><i class="ti ti-bulb"></i><strong>{{ homeText.sticker }}<br>{{ homeText.stickerMore }}</strong></div>
		<i :class="$style.star" class="ti ti-asterisk" aria-hidden="true"></i>
	</div>
</div>
</template>

<script lang="ts" setup>
import { onActivated, onDeactivated, ref, watch } from 'vue';
import WorkPanel from './work-panel.vue';
import { homeText } from './copy.js';
import { loadFeaturedWork } from './featured.js';
import type { FeaturedState, HomeShowcaseMode } from './featured.js';
import type { CommunityWork } from '@/pages/community/types.js';

const props = withDefaults(defineProps<{ imageUrl: string | null; logoUrl: string; mode?: HomeShowcaseMode; refreshKey?: number }>(), { mode: 'custom', refreshKey: 0 });
const emit = defineEmits<{ status: [state: FeaturedState] }>();
const failed = ref(false);
const logoFailed = ref(false);
const work = ref<CommunityWork | null>(null);
const state = ref<FeaturedState>('custom');
const active = ref(true);
onActivated(() => { active.value = true; });
onDeactivated(() => { active.value = false; });

function updateState(value: FeaturedState) { state.value = value; emit('status', value); }

watch(() => [props.mode, props.refreshKey, active.value], async (_value, _old, onCleanup) => {
	work.value = null;
	if (!active.value || props.mode !== 'popular') { updateState('custom'); return; }
	const controller = new AbortController();
	onCleanup(() => controller.abort());
	updateState('loading');
	try {
		const selected = await loadFeaturedWork(controller.signal);
		if (controller.signal.aborted || !active.value) return;
		work.value = selected;
		updateState(selected ? 'ready' : 'empty');
	} catch { if (!controller.signal.aborted && active.value) updateState('error'); }
}, { immediate: true });
watch(() => props.imageUrl, () => { failed.value = false; });
watch(() => props.logoUrl, () => { logoFailed.value = false; });
</script>

<style lang="scss" module>
.showcase {
	container-type: inline-size;
	position: relative;
	width: 100%;
	aspect-ratio: 1.19;
	box-sizing: border-box;
	border: 2px solid var(--home-ink);
	border-radius: 24px;
	background: var(--home-purple);
	box-shadow: 9px 10px 0 var(--home-ink);
	overflow: hidden;
}
.customImage { display: block; width: 100%; height: 100%; object-fit: contain; }
.art { position: relative; height: 100%; color: var(--home-ink); }
.artHeading { display: flex; align-items: center; justify-content: space-between; padding: 6% 7%; font-size: clamp(14px, 3.5cqw, 24px); font-weight: 700; i { font-size: 1.3em; } }
.poster {
	position: absolute; left: 10%; top: 22%; width: 65%; height: 65%;
	display: flex; flex-direction: column; align-items: center;
	background: var(--home-paper); border: 2px solid var(--home-ink); border-radius: 8px;
	box-shadow: 5px 6px 0 var(--home-ink); transform: rotate(-6deg);
	p { margin: 0; padding: 0 8% 6%; font-size: clamp(10px, 2.5cqw, 15px); font-weight: 500; }
}
.posterTop { display: flex; justify-content: space-between; gap: 8px; width: 100%; box-sizing: border-box; padding: 6% 7%; border-bottom: 2px solid var(--home-ink); font-size: clamp(11px, 3.1cqw, 19px); font-weight: 700; }
.mascot { min-height: 0; flex: 1; width: 70%; object-fit: contain; padding: 4%; box-sizing: border-box; }
.sticker { position: absolute; right: 5%; top: 43%; width: 25%; aspect-ratio: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3%; background: var(--home-lime); border: 2px solid var(--home-ink); border-radius: 50%; transform: rotate(12deg); box-shadow: 3px 4px 0 var(--home-ink); font-size: clamp(12px, 3.8cqw, 26px); text-align: center; line-height: 1.25; i { font-size: 1.1em; } }
.star { position: absolute; top: 22%; right: 9%; color: var(--home-paper); font-size: clamp(32px, 12cqw, 72px); transform: rotate(12deg); }
.popular { aspect-ratio: auto; }
@media (max-width: 800px) { .showcase { border-radius: 18px; box-shadow: 6px 7px 0 var(--home-ink); } }
@media (max-width: 480px) { .poster p { display: none; } }
</style>
