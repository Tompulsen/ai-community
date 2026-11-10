<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div ref="root" :class="[$style.player, { [$style.playing]: playing, [$style.immersive]: immersive }]" data-testid="work-video" @pointerenter="enter" @pointerleave="leave" @focusout="focusOut">
	<video ref="video" :src="activated ? source : undefined" :poster="poster" :loop="immersive" muted playsinline preload="none" :aria-label="title" @click="immersive && toggle()" @playing="playing = true; waiting = false" @pause="playing = false; waiting = false" @waiting="waiting = true" @ended="ended" @timeupdate="syncTime" @loadedmetadata="syncTime" @volumechange="syncVolume" @error="mediaError"></video>
	<div v-if="failed" :class="$style.message" role="status"><p>{{ t.videoFailed }}</p><button type="button" class="_button" @click="retry">{{ t.retry }}</button></div>
	<template v-else>
		<button v-if="!playing && !waiting && (!immersive || !suspended)" type="button" class="_button" :class="$style.centerPlay" :aria-label="t.playVideo" @click="start(false)"><i class="ti ti-player-play-filled" aria-hidden="true"></i></button>
		<span v-if="waiting" :class="$style.waiting" role="status">{{ t.videoLoading }}</span>
		<span v-if="playing && muted" :class="$style.previewHint"><i class="ti ti-volume-off" aria-hidden="true"></i>{{ t.mutedPreview }}</span>
		<div v-show="!immersive || !suspended" :class="$style.controls">
			<input :class="$style.seek" :style="{ '--work-progress': `${duration ? position / duration * 100 : 0}%` }" type="range" min="0" :max="duration || 1" step="0.1" :value="position" :disabled="!duration" :aria-label="t.videoProgress" :aria-valuetext="`${timeLabel(position)} / ${timeLabel(duration)}`" @input="seek"/>
			<div :class="$style.controlRow">
				<button type="button" class="_button" :aria-label="playing || waiting ? t.pauseVideo : t.playVideo" :title="playing || waiting ? t.pauseVideo : t.playVideo" @click="toggle"><i :class="playing || waiting ? 'ti ti-player-pause-filled' : 'ti ti-player-play-filled'" aria-hidden="true"></i></button>
				<span :class="$style.time">{{ timeLabel(position) }} / {{ timeLabel(duration) }}</span>
				<button type="button" class="_button" :class="$style.sound" :aria-label="muted ? t.unmuteVideo : t.muteVideo" :title="muted ? t.unmuteVideo : t.muteVideo" :aria-pressed="!muted" @click="toggleSound"><i :class="muted ? 'ti ti-volume-off' : 'ti ti-volume'" aria-hidden="true"></i></button>
				<MkA :to="workPath(workId)" :class="$style.detail" :aria-label="t.videoDetail" :title="t.videoDetail" @click="stop"><i class="ti ti-arrow-up-right" aria-hidden="true"></i></MkA>
				<button v-if="fullscreenSupported" type="button" class="_button" :aria-label="t.videoFullscreen" :title="t.videoFullscreen" @click="fullscreen"><i class="ti ti-maximize" aria-hidden="true"></i></button>
			</div>
		</div>
	</template>
	<p v-if="playError" :class="$style.playError" role="status">{{ playError }}</p>
</div>
</template>

<script setup lang="ts">
import { computed, nextTick, onActivated, onBeforeUnmount, onDeactivated, onMounted, ref, watch } from 'vue';
import { safeWebUrl } from './copy.js';
import { workText as t, workPath } from './interactions-copy.js';
import { claimVideoPlayback, releaseVideoPlayback } from './video-playback.js';
import { prefer } from '@/preferences.js';

const props = defineProps<{ workId: string; title: string; url: string; poster?: string; immersive?: boolean; suspended?: boolean; }>();
const root = ref<HTMLElement>();
const video = ref<HTMLVideoElement>();
const source = computed(() => safeWebUrl(props.url));
const activated = ref(false);
const playing = ref(false);
const waiting = ref(false);
const muted = ref(true);
const failed = ref(false);
const playError = ref('');
const position = ref(0);
const duration = ref(0);
const fullscreenSupported = ref(false);
let active = true;
let visible = !props.immersive;
let manuallyPaused = false;
let hovering = false;
let ticket = 0;
let hoverTimer: number | undefined;
let observer: IntersectionObserver | undefined;

function timeLabel(seconds: number) {
	const value = Math.max(0, Math.floor(seconds));
	return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`;
}

function stop() {
	window.clearTimeout(hoverTimer);
	ticket++;
	video.value?.pause();
	playing.value = false;
	waiting.value = false;
	releaseVideoPlayback(stop);
}

async function start(automatic: boolean) {
	if (!source.value || !active || !visible || props.suspended || window.document.hidden || failed.value) return;
	window.clearTimeout(hoverTimer);
	if (!automatic) manuallyPaused = false;
	const attempt = ++ticket;
	activated.value = true;
	waiting.value = true;
	playError.value = '';
	await nextTick();
	if (attempt !== ticket || !video.value || !active || !visible || props.suspended || window.document.hidden || (automatic && !hovering && !props.immersive)) return;
	const media = video.value;
	if (automatic) muted.value = true;
	media.muted = muted.value;
	claimVideoPlayback(stop);
	try {
		await media.play();
	} catch (error) {
		if (attempt !== ticket) return;
		stop();
		// Hover can be denied by browser policy. The manual play control stays usable.
		if (!automatic && !(error instanceof DOMException && error.name === 'AbortError')) playError.value = t.videoPlayBlocked;
	}
}

function enter(event: PointerEvent) {
	if (props.immersive) return;
	if (event.pointerType !== 'mouse') return;
	hovering = true;
	const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
	if (playing.value || waiting.value || prefer.s.dataSaver.media || connection?.saveData || window.matchMedia('(prefers-reduced-motion: reduce)').matches || !window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
	hoverTimer = window.setTimeout(() => { void start(true); }, 160);
}

function leave(event: PointerEvent) {
	if (props.immersive) return;
	if (event.pointerType !== 'mouse') return;
	hovering = false;
	if (window.document.fullscreenElement !== root.value) stop();
}

function focusOut(event: FocusEvent) {
	if (!props.immersive && !hovering && window.document.fullscreenElement !== root.value && !root.value?.contains(event.relatedTarget as Node | null)) stop();
}

function toggle() { manuallyPaused = playing.value || waiting.value; if (manuallyPaused) stop(); else void start(false); }

function autoplay() {
	const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
	if (props.immersive && !manuallyPaused && !playing.value && !waiting.value && !prefer.s.dataSaver.media && !connection?.saveData && prefer.s.animation !== false && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) void start(true);
}

function toggleSound() {
	muted.value = !muted.value;
	if (video.value) video.value.muted = muted.value;
}

function syncVolume() { muted.value = video.value?.muted !== false || video.value.volume === 0; }

function syncTime() {
	position.value = video.value?.currentTime ?? 0;
	duration.value = Number.isFinite(video.value?.duration) ? video.value!.duration : 0;
}

function seek(event: Event) {
	if (!video.value || !duration.value) return;
	video.value.currentTime = Number((event.target as HTMLInputElement).value);
	syncTime();
}

function ended() { stop(); syncTime(); }

function mediaError() { if (activated.value) { stop(); failed.value = true; } }

function retry() { failed.value = false; video.value?.load(); void start(false); }

function visibilityChanged() { if (window.document.hidden) { hovering = false; stop(); } }

async function fullscreen() {
	try {
		if (window.document.fullscreenElement === root.value) await window.document.exitFullscreen();
		else await root.value?.requestFullscreen();
	} catch { playError.value = t.videoFullscreenFailed; }
}

watch(source, () => {
	stop(); activated.value = false; failed.value = false; playError.value = ''; position.value = 0; duration.value = 0; muted.value = true; manuallyPaused = false;
});
watch(() => props.suspended, value => { if (value) stop(); else autoplay(); });
onMounted(() => {
	fullscreenSupported.value = !!window.document.fullscreenEnabled;
	window.document.addEventListener('visibilitychange', visibilityChanged);
	observer = new IntersectionObserver(entries => {
		visible = entries.some(entry => entry.isIntersecting && entry.intersectionRatio >= (props.immersive ? .7 : .1));
		if (!visible) { hovering = false; manuallyPaused = false; stop(); } else autoplay();
	}, { threshold: [0, .1, .7] });
	if (root.value) observer.observe(root.value);
});
onActivated(() => { active = true; autoplay(); });
onDeactivated(() => { active = false; hovering = false; stop(); });
onBeforeUnmount(() => { active = false; stop(); observer?.disconnect(); window.document.removeEventListener('visibilitychange', visibilityChanged); });
</script>

<style lang="scss" module>
@use './work-palette.scss';

.player { @include work-palette.stage; position: relative; width: 100%; aspect-ratio: 16 / 9; max-height: 560px; overflow: hidden; border-radius: 12px; background: var(--work-stage); color: var(--work-stage-fg); isolation: isolate; container-type: inline-size; }
.player video { display: block; width: 100%; height: 100%; object-fit: contain; }
.player :focus-visible { outline: 2px solid var(--work-stage-fg); outline-offset: -4px; }
.centerPlay { position: absolute; inset: 0; margin: auto; display: grid; place-items: center; width: 60px; height: 60px; border-radius: 50%; background: color-mix(in srgb, var(--work-stage) 80%, transparent); color: var(--work-stage-fg); border: 1px solid color-mix(in srgb, var(--work-stage-fg) 45%, transparent); font-size: 24px; }
.controls { position: absolute; inset: auto 0 0; padding: 0 12px 4px; background: color-mix(in srgb, var(--work-stage) 88%, transparent); opacity: 1; transition: opacity .15s ease-out; }
.controlRow { display: flex; align-items: center; gap: 4px; }
.controlRow button, .detail { display: inline-grid; place-items: center; width: 44px; height: 44px; flex: 0 0 44px; color: inherit; font-size: 20px; border-radius: 6px; }
.controlRow button:hover, .detail:hover { background: color-mix(in srgb, var(--work-stage-fg) 18%, transparent); }
.controlRow .sound { margin-left: auto; }
.time { font-size: 12px; font-variant-numeric: tabular-nums; white-space: nowrap; }
.player .seek { display: block; width: 100%; height: 24px; margin: 0; padding: 0; accent-color: var(--work-stage-fg); cursor: pointer; }
.previewHint, .waiting { position: absolute; top: 12px; left: 12px; display: inline-flex; gap: 6px; align-items: center; padding: 5px 10px; border-radius: 6px; font-size: 12px; background: var(--work-stage); color: var(--work-stage-fg); pointer-events: none; }
.waiting { left: 50%; top: 40%; transform: translate(-50%, -50%); white-space: nowrap; }
.message { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; flex-direction: column; gap: 12px; padding: 20px; text-align: center; font-size: 14px; }
.message button { min-height: 44px; padding: 8px 20px; border: 1px solid currentColor; border-radius: 8px; }
.playError { position: absolute; top: 12px; left: 12px; right: 12px; padding: 8px 12px; margin: 0; background: var(--work-stage); font-size: 12px; }
.player:fullscreen { max-height: none; height: 100%; border-radius: 0; }
@media (hover: hover) and (pointer: fine) { .playing:not(:hover):not(:focus-within) .controls { opacity: 0; pointer-events: none; } }
@media (pointer: coarse) { .player .seek { height: 44px; } }
@container (max-width: 360px) { .detail, .centerPlay { display: none; } }
@media (prefers-reduced-motion: reduce) { .controls { transition: none; } }

.player.immersive { @include work-palette.immersive; width: 100%; height: 100%; max-height: none; aspect-ratio: auto; border-radius: 0; background: var(--work-stage); }
.immersive .controls { box-sizing: border-box; height: var(--work-video-controls-height, 88px); padding: 0 max(12px, env(safe-area-inset-right)) 0 max(12px, env(safe-area-inset-left)); background: color-mix(in srgb, var(--work-stage) 88%, transparent); z-index: 1; }
.immersive .seek { appearance: none; height: 44px; background: linear-gradient(to right, var(--work-stage-accent) 0 var(--work-progress), color-mix(in srgb, var(--work-stage-fg) 32%, transparent) var(--work-progress) 100%) center / 100% 3px no-repeat; &:disabled { opacity: .4; cursor: default; } }
.immersive .seek::-webkit-slider-runnable-track { height: 3px; background: transparent; }
.immersive .seek::-moz-range-track { height: 3px; background: transparent; }
.immersive .seek::-webkit-slider-thumb { appearance: none; width: 10px; height: 10px; margin-top: -3.5px; border: 0; border-radius: 50%; background: var(--work-stage-accent); }
.immersive .seek::-moz-range-thumb { width: 10px; height: 10px; border: 0; border-radius: 50%; background: var(--work-stage-accent); }
.immersive .controlRow { height: 44px; }
.immersive .detail, .immersive .previewHint { display: none; }
.immersive .centerPlay { display: grid; background: transparent; border: 0; width: 72px; height: 72px; font-size: 46px; opacity: .8; }
.immersive .controlRow button { width: 44px; flex-basis: 44px; }
.immersive .time { font-size: 12px; }
.immersive .playError { top: 70px; }
.immersive .message { inset: 76px 76px 170px 16px; }
.immersive.playing .controls { opacity: 1; pointer-events: auto; }
</style>
