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
.showcase { container-type: inline-size; position: relative; width: 100%; aspect-ratio: 1.19; box-sizing: border-box; border-radius: 16px; background: var(--home-stage); color: var(--home-stage-fg); overflow: hidden; }
.customImage { display: block; width: 100%; height: 100%; object-fit: contain; }
.art { position: relative; height: 100%; display: flex; flex-direction: column; }
.artHeading { display: flex; align-items: center; justify-content: space-between; padding: 6%; font-size: clamp(13px, 3cqw, 19px); font-weight: 500; color: var(--home-stage-muted); i { font-size: 1.2em; color: var(--home-stage-accent); } }
.poster { position: relative; min-height: 0; flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 24px; padding: 0 8% 8%; p { margin: 0; font-size: clamp(12px, 2.5cqw, 16px); color: var(--home-stage-muted); text-align: center; } }
.posterTop { order: 1; display: flex; align-items: center; justify-content: space-between; gap: 18px; width: 100%; box-sizing: border-box; padding-top: 22px; border-top: 1px solid var(--home-stage-line); font-size: clamp(15px, 3.4cqw, 22px); font-weight: 500; }
.mascot { display: block; width: 34%; height: 42%; max-height: 190px; min-height: 0; object-fit: contain; padding: 6%; box-sizing: content-box; background: var(--home-stage-panel); border-radius: 50%; }
.popular { aspect-ratio: auto; }
@media (max-width: 480px) { .showcase { border-radius: 12px; } .poster { gap: 16px; } .posterTop { padding-top: 16px; } }
</style>
