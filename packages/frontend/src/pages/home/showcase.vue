<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div ref="stage" :class="[$style.showcase, { [$style.popular]: browsing }]" :aria-busy="state === 'loading'" :data-motion="motionAllowed" :data-running="motionRunning" :data-kind="selectedKind" data-testid="home-showcase" tabindex="-1" @pointermove="move" @pointerleave="reset">
	<div v-if="browsing" :class="$style.selectionHeader">
		<div :class="$style.selectionTitle"><span><i class="ti ti-flame" aria-hidden="true"></i> {{ categoryTitle }}</span><button v-if="requestedKind" type="button" :class="$style.back" data-testid="stage-back" @click="restoreShowcase"><i class="ti ti-arrow-left" aria-hidden="true"></i> {{ homeText.featuredBack }}</button></div>
		<div :class="$style.modes" role="group" :aria-label="homeText.featuredCategories">
			<button v-for="item in categories" :key="item.key" type="button" :class="[$style.mode, { [$style.modeActive]: requestedKind === item.key }]" :aria-pressed="requestedKind === item.key" :aria-label="item.label" :data-testid="`stage-category-${item.key}`" @click="selectCategory(item.key)"><i :class="item.icon" aria-hidden="true"></i><span>{{ item.title }}</span></button>
		</div>
	</div>
	<WorkPanel v-if="work" :key="work.approvedNoteId ?? work.id" :work="work"/>
	<div v-else-if="requestedKind" :class="$style.categoryStatus" data-testid="stage-category-status">
		<i :class="state === 'loading' ? 'ti ti-hourglass' : state === 'error' ? 'ti ti-cloud-off' : 'ti ti-sparkles'" aria-hidden="true"></i>
		<p role="status">{{ state === 'loading' ? homeText.featuredLoading : state === 'error' ? homeText.featuredFailed : homeText.featuredEmpty }}</p>
		<button v-if="state === 'error'" type="button" :class="$style.retry" data-testid="stage-retry" @click="retry++">{{ homeText.retry }}</button>
		<MkA v-else-if="state === 'empty'" to="/community" :class="$style.browse">{{ homeText.featuredBrowse }} <i class="ti ti-arrow-up-right" aria-hidden="true"></i></MkA>
	</div>
	<img v-else-if="imageUrl && !failed" :key="imageUrl" :src="imageUrl" :alt="homeText.showcase" :class="$style.customImage" decoding="async" data-testid="home-custom-image" @error="failed = true"/>
	<div v-else :class="$style.art" data-testid="home-default-art">
		<div :class="$style.artHeading"><span>{{ homeText.showcaseTitle }}</span><i class="ti ti-sparkles" aria-hidden="true"></i></div>
		<div :class="$style.poster">
			<div :class="$style.scene">
				<div :class="$style.sceneInner">
					<button type="button" :class="[$style.sheet, $style.textSheet]" :aria-label="homeText.featuredTextLabel" data-testid="stage-sheet-text" @click="selectCategory('text')" @pointerenter="hoveredKind = 'text'" @pointerleave="hoveredKind = null" @focus="focusedKind = 'text'" @blur="focusedKind = null"><span aria-hidden="true">Aa</span><i class="ti ti-cursor-text" aria-hidden="true"></i></button>
					<button type="button" :class="[$style.sheet, $style.imageSheet]" :aria-label="homeText.featuredImageLabel" data-testid="stage-sheet-image" @click="selectCategory('image')" @pointerenter="hoveredKind = 'image'" @pointerleave="hoveredKind = null" @focus="focusedKind = 'image'" @blur="focusedKind = null"><i class="ti ti-photo" aria-hidden="true"></i><span :class="$style.imageCorners" aria-hidden="true"></span></button>
					<button type="button" :class="[$style.sheet, $style.videoSheet]" :aria-label="homeText.featuredVideoLabel" data-testid="stage-sheet-video" @click="selectCategory('video')" @pointerenter="hoveredKind = 'video'" @pointerleave="hoveredKind = null" @focus="focusedKind = 'video'" @blur="focusedKind = null"><i class="ti ti-player-play-filled" aria-hidden="true"></i><span :class="$style.filmEdge" aria-hidden="true"></span></button>
					<div :class="$style.core" aria-hidden="true"><img :src="logoFailed ? '/favicon.ico' : logoUrl" alt="" :class="$style.mascot" @error="logoFailed = true"/><span :class="$style.coreEdge"></span></div>
				</div>
			</div>
			<div :class="$style.modes" role="group" :aria-label="homeText.featuredCategories">
				<button v-for="item in categories" :key="item.key" type="button" :class="[$style.mode, { [$style.modeActive]: selectedKind === item.key }]" :aria-pressed="false" :aria-label="item.label" :data-testid="`stage-category-${item.key}`" @pointerenter="hoveredKind = item.key" @pointerleave="hoveredKind = null" @focus="focusedKind = item.key" @blur="focusedKind = null" @click="selectCategory(item.key)"><i :class="item.icon" aria-hidden="true"></i><span>{{ item.title }}</span><i class="ti ti-arrow-right" :class="$style.modeArrow" aria-hidden="true"></i></button>
			</div>
			<p>{{ homeText.featuredNote }}</p>
			<MkA to="/community" :class="$style.posterTop"><span>{{ homeText.artTitle }}</span><i class="ti ti-arrow-up-right" aria-hidden="true"></i></MkA>
		</div>
	</div>
</div>
</template>

<script lang="ts" setup>
import { computed, nextTick, onActivated, onDeactivated, ref, watch } from 'vue';
import WorkPanel from './work-panel.vue';
import { homeText } from './copy.js';
import { loadFeaturedWork } from './featured.js';
import { useShowcaseMotion } from './use-showcase-motion.js';
import type { FeaturedState, HomeShowcaseMode } from './featured.js';
import type { CommunityWork } from '@/pages/community/types.js';

const props = withDefaults(defineProps<{ imageUrl: string | null; logoUrl: string; mode?: HomeShowcaseMode; refreshKey?: number; activeKind?: string | null; rememberSelection?: boolean }>(), { mode: 'custom', refreshKey: 0, activeKind: null, rememberSelection: false });
const emit = defineEmits<{ status: [state: FeaturedState] }>();
const { stage, motionAllowed, motionRunning, move, reset } = useShowcaseMotion();
const hoveredKind = ref<string | null>(null);
const focusedKind = ref<string | null>(null);
const categories = [
	{ key: 'text', title: homeText.featuredText, label: homeText.featuredTextLabel, icon: 'ti ti-file-text' },
	{ key: 'image', title: homeText.featuredImage, label: homeText.featuredImageLabel, icon: 'ti ti-photo' },
	{ key: 'video', title: homeText.featuredVideo, label: homeText.featuredVideoLabel, icon: 'ti ti-video' },
] as const;
type ShowcaseKind = 'text' | 'image' | 'video';
const selectionKey = 'community:home-featured-kind';

function restoredKind(): ShowcaseKind | null {
	if (!props.rememberSelection) return null;
	try {
		const saved = window.sessionStorage.getItem(selectionKey);
		return saved === 'text' || saved === 'image' || saved === 'video' ? saved : null;
	} catch { return null; }
}

const requestedKind = ref<ShowcaseKind | null>(restoredKind());
const retry = ref(0);
const selectedKind = computed(() => focusedKind.value ?? props.activeKind ?? hoveredKind.value ?? requestedKind.value);
const failed = ref(false);
const logoFailed = ref(false);
const work = ref<CommunityWork | null>(null);
const state = ref<FeaturedState>('custom');
const browsing = computed(() => !!requestedKind.value || !!work.value);
const categoryTitle = computed(() => requestedKind.value ? `${categories.find(item => item.key === requestedKind.value)!.title} · ${homeText.popularBadge}` : homeText.featuredCategories);
const active = ref(true);
onActivated(() => { active.value = true; });
onDeactivated(() => { active.value = false; hoveredKind.value = null; focusedKind.value = null; });

function updateState(value: FeaturedState) { state.value = value; emit('status', value); }

function rememberKind(kind: ShowcaseKind | null) {
	if (!props.rememberSelection) return;
	try {
		if (kind) window.sessionStorage.setItem(selectionKey, kind);
		else window.sessionStorage.removeItem(selectionKey);
	} catch { /* Selection still works when browser storage is unavailable. */ }
}

async function selectCategory(kind: ShowcaseKind) {
	requestedKind.value = kind;
	rememberKind(kind);
	hoveredKind.value = null; focusedKind.value = null;
	await nextTick();
	stage.value?.querySelector<HTMLButtonElement>(`[data-testid="stage-category-${kind}"]`)?.focus({ preventScroll: true });
}

async function restoreShowcase() {
	const kind = requestedKind.value;
	requestedKind.value = null; hoveredKind.value = null; focusedKind.value = null;
	rememberKind(null);
	await nextTick();
	const target = props.mode === 'popular' ? stage.value : stage.value?.querySelector<HTMLButtonElement>(`[data-testid="stage-category-${kind}"]`) ?? stage.value;
	target?.focus({ preventScroll: true });
}

watch(() => [props.mode, props.imageUrl, props.refreshKey], () => {
	// Administrator previews must follow their controlled settings after a change.
	if (!props.rememberSelection) { requestedKind.value = null; hoveredKind.value = null; focusedKind.value = null; }
}, { flush: 'sync' });

watch(() => [props.mode, props.refreshKey, active.value, requestedKind.value, retry.value], async (_value, _old, onCleanup) => {
	work.value = null;
	if (!active.value || (!requestedKind.value && props.mode !== 'popular')) { updateState('custom'); return; }
	const category = requestedKind.value === 'text' ? 'resource' : requestedKind.value ?? undefined;
	const controller = new AbortController();
	onCleanup(() => controller.abort());
	updateState('loading');
	try {
		const selected = await loadFeaturedWork(controller.signal, category);
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
.poster { position: relative; min-height: 0; flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 16px; padding: 0 8% 7%; p { margin: 0; font-size: clamp(12px, 2.1cqw, 14px); color: var(--home-stage-muted); text-align: center; } }
.posterTop { order: 1; display: flex; align-items: center; justify-content: space-between; gap: 18px; width: 100%; box-sizing: border-box; padding-top: 22px; border-top: 1px solid var(--home-stage-line); font-size: clamp(15px, 3.4cqw, 22px); font-weight: 500; }
.scene { position: relative; flex: 1; min-height: 0; width: 100%; perspective: 1000px; }
.sceneInner { position: absolute; inset: 0; transform-style: preserve-3d; transform: scale(.9) rotateX(calc(var(--stage-y, 0) * -4deg)) rotateY(calc(var(--stage-x, 0) * 5deg)); transition: transform 320ms var(--community-ease, ease-out); }
.sheet, .core { position: absolute; width: 32%; aspect-ratio: 1; left: 34%; top: 50%; margin-top: -16%; border-radius: 18%; box-sizing: border-box; display: grid; place-items: center; transition: transform 520ms var(--community-ease, ease-out), border-color 280ms, background-color 280ms; }
.sheet, .mode, .back, .retry { appearance: none; font: inherit; cursor: pointer; }
.sheet { padding: 0; border: 1px solid var(--home-stage-line); color: var(--home-stage-muted); background: var(--home-stage-panel); > i { font-size: 7cqw; } }
.textSheet { transform: translate(-64%, -12%) rotate(-14deg); > span { font-size: 8cqw; letter-spacing: -.04em; font-weight: 500; } > i { position: absolute; right: 12%; bottom: 12%; font-size: 3cqw; } }
.imageSheet { transform: translate(56%, -12%) rotate(12deg); > i { position: absolute; right: 14%; top: 17%; font-size: 5.6cqw; } }
.videoSheet { transform: translate(28%, 18%) rotate(6deg); > i { position: absolute; right: 15%; bottom: 13%; font-size: 5cqw; } }
.core { pointer-events: none; transform: translateZ(35px); border: 1px solid var(--home-stage-line); background: var(--home-stage); box-shadow: 0 18px 36px color-mix(in srgb, var(--home-stage) 65%, transparent); }
.mascot { display: block; width: 66%; height: 66%; object-fit: contain; border-radius: 24%; }
.coreEdge { position: absolute; inset: 10%; border-radius: 18%; border: 1px solid color-mix(in srgb, var(--home-stage-accent) 16%, transparent); pointer-events: none; }
.imageCorners { position: absolute; inset: 14%; border: 1px solid color-mix(in srgb, currentColor 35%, transparent); border-radius: 5px; }
.filmEdge { position: absolute; inset: 12% auto 12% 10%; width: 5%; border-top: 3px solid currentColor; border-bottom: 3px solid currentColor; opacity: .4; }
.modes { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; width: 100%; }
.mode { display: flex; align-items: center; justify-content: center; gap: 7px; min-height: 44px; padding: 6px; box-sizing: border-box; border: 1px solid var(--home-stage-line); border-radius: 8px; color: var(--home-stage-muted) !important; background: var(--home-stage-panel); font-size: clamp(12px, 1.9cqw, 14px); line-height: 1.4; transition: color 180ms, background-color 180ms; > i { font-size: 1.25em; } > span { min-width: 0; } }
.modeArrow { width: 0; opacity: 0; transform: translate(-5px, 5px); transition: transform 260ms var(--community-ease, ease-out), opacity 180ms; }
.modeActive, .mode:focus-visible { background: var(--home-stage-accent); color: var(--home-stage) !important; .modeArrow { width: 1em; opacity: 1; transform: translate(0, 0); } }
.mode:focus-visible, .posterTop:focus-visible, .sheet:focus-visible, .back:focus-visible, .retry:focus-visible, .browse:focus-visible { outline: 2px solid var(--home-stage-accent); outline-offset: 4px; }
.selectionHeader { padding: 16px 20px 20px; border-bottom: 1px solid var(--home-stage-line); }
.selectionTitle { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 44px; margin-bottom: 8px; font-size: 13px; > span { display: inline-flex; align-items: center; gap: 8px; min-width: 0; } }
.back { display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-height: 44px; padding: 6px; border: 0; border-radius: 6px; background: transparent; color: var(--home-stage-muted); font-size: 12px; &:hover { color: var(--home-stage-accent); } }
.categoryStatus { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 16px; min-height: clamp(320px, 54cqw, 460px); box-sizing: border-box; padding: 24px; text-align: center; > i { font-size: 32px; color: var(--home-stage-accent); } p { margin: 0; max-width: 30em; font-size: 14px; line-height: 1.8; color: var(--home-stage-muted); } }
.retry { min-height: 44px; padding: 10px 24px; border: 1px solid var(--home-stage-line); border-radius: 8px; background: var(--home-stage-accent); color: var(--home-stage); font-size: 14px; }
.browse { display: inline-flex; align-items: center; gap: 8px; min-height: 44px; color: var(--home-stage-accent) !important; font-size: 14px; }
.posterTop { text-decoration: none; color: var(--home-stage-fg) !important; transition: color 180ms; > i { transition: transform 260ms var(--community-ease, ease-out); } &:hover, &:focus-visible { color: var(--home-stage-accent) !important; > i { transform: translate(3px, -3px); } } }
.showcase[data-kind='text'] .textSheet { transform: translate(-76%, -16%) rotate(-18deg); background: var(--home-stage-accent); color: var(--home-stage); border-color: transparent; }
.showcase[data-kind='image'] .imageSheet { transform: translate(68%, -20%) rotate(14deg); background: var(--home-stage-accent); color: var(--home-stage); border-color: transparent; }
.showcase[data-kind='video'] .videoSheet { transform: translate(52%, 24%) rotate(10deg); background: var(--home-stage-accent); color: var(--home-stage); border-color: transparent; }
.showcase[data-kind] .core { transform: translateZ(45px) translateY(-3%); }
.showcase::after { content: ''; position: absolute; inset: 7px; border: 1px solid var(--home-stage-accent); border-radius: 11px; opacity: 0; pointer-events: none; transition: opacity 220ms; }
.showcase:has(> .customImage):hover::after, .popular:focus-within::after { opacity: .6; }
.showcase[data-motion='true'] .scene { animation: assemble 750ms var(--community-ease, ease-out) both; }
.showcase[data-running='false'] .scene { animation-play-state: paused; }
@keyframes assemble { from { opacity: .5; transform: translateY(18px) scale(.92); } to { opacity: 1; transform: translateY(0) scale(1); } }
@mixin quietMotion { &::after { transition: none; } .scene { animation: none !important; } .sceneInner { transform: scale(.9); } .textSheet { transform: translate(-64%, -12%) rotate(-14deg); } .imageSheet { transform: translate(56%, -12%) rotate(12deg); } .videoSheet { transform: translate(28%, 18%) rotate(6deg); } .core { transform: translateZ(35px); } .sceneInner, .sheet, .core, .mode, .modeArrow, .posterTop, .posterTop > i { transition: none; } }
.showcase[data-motion='false'] { @include quietMotion; }
@media (prefers-reduced-motion: reduce) { .showcase { @include quietMotion; } }
.popular { aspect-ratio: auto; }
@media (max-width: 480px) { .showcase { border-radius: 12px; aspect-ratio: 1.05; } .popular { aspect-ratio: auto; } .poster { gap: 10px; padding-inline: 6%; } .posterTop { padding-top: 14px; } .mode { gap: 5px; } .modeArrow { display: none; } }
</style>
