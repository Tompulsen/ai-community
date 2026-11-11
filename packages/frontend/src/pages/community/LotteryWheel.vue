<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div :class="$style.wheel" :style="colors" :data-landed-prize="landed" :data-slot-count="slots.length" data-testid="lottery-wheel">
	<div :class="$style.stage">
		<div ref="host" :class="$style.canvas" aria-hidden="true"></div>
		<div :class="$style.lights" aria-hidden="true"><span v-for="n in 24" :key="n" :style="{ transform: `rotate(${n * 15}deg)` }"><b></b></span></div>
		<span :class="$style.pointer" aria-hidden="true"></span>
		<button type="button" :class="$style.center" :disabled="disabled || busy || preview" :aria-label="actionLabel" :aria-busy="busy" data-testid="lottery-wheel-start" @click="emit('draw')">
			<i v-if="busy" class="ti ti-hourglass" aria-hidden="true"></i>
			<strong v-else :class="{ [$style.longLabel]: appearance.buttonText.length > 4 }">{{ appearance.buttonText || 'GO' }}</strong>
			<span>{{ preview ? t.wheelPreview : busy ? t.drawing : t.wheelStart }}</span>
		</button>
	</div>
	<p v-if="failed" :class="$style.caption" role="status">{{ t.wheelFallback }}</p>
	<p v-else-if="!prizes.length" :class="$style.caption">{{ t.emptyPool }}</p>
</div>
</template>

<script setup lang="ts">
import { computed, onActivated, onBeforeUnmount, onDeactivated, onMounted, ref, watch } from 'vue';
import LuckyWheel from '../../../vendor/lucky-canvas/wheel.js';
import { wheelSlots, wheelThemes } from './lottery-wheel.js';
import type { WheelPrize, WheelSettings } from './lottery-wheel.js';
import { lotteryText as t } from './lottery-copy.js';

const props = defineProps<{ prizes: WheelPrize[]; appearance: WheelSettings; actionLabel: string; disabled?: boolean; busy?: boolean; preview?: boolean }>();
const emit = defineEmits<{ (event: 'draw'): void }>();
const host = ref<HTMLDivElement>();
const failed = ref(false), landed = ref('');
const slots = computed(() => wheelSlots(props.prizes));
const palette = computed(() => wheelThemes[props.appearance.theme] ?? wheelThemes.teal);
const colors = computed(() => ({ '--wheel-accent': palette.value.accent, '--wheel-paper': palette.value.paper, '--wheel-rim': palette.value.rim, '--wheel-ink': palette.value.ink }));
let wheel: LuckyWheel | undefined;
let active = true, mounted = false;
let pendingIndex = -1;
let finishPending: (() => void) | undefined;
let watchdog: number | undefined;

function finish() {
	if (pendingIndex >= 0) {
		wheel?.settle(pendingIndex);
		landed.value = slots.value[pendingIndex]?.id ?? '';
	}
	if (watchdog) window.clearTimeout(watchdog);
	pendingIndex = -1;
	const resolve = finishPending;
	finishPending = undefined;
	resolve?.();
}

function dispose() {
	finish();
	wheel?.destroy();
	wheel = undefined;
}

function renderWheel() {
	if (!active || !host.value) return;
	dispose();
	failed.value = false;
	const p = palette.value;
	const dense = slots.value.length > 12;
	const display = slots.value.length ? slots.value : Array.from({ length: 6 }, () => null);
	try {
		wheel = new LuckyWheel({ divElement: host.value }, {
			width: 480, height: 480,
			blocks: [{ padding: '20px', background: p.accent }, { padding: '5px', background: p.rim }],
			prizes: display.map((prize, index) => ({
				background: index % 2 ? p.alternate : p.light,
				fonts: !prize ? [{ text: t.wheelPreparing, top: '28px', fontSize: '18px' }] : dense
					? [{ text: `${index + 1}`, top: '18px', fontSize: '22px' }]
					: [
						{ text: prize.name, top: '15px', fontSize: slots.value.length > 8 ? '13px' : '16px', lineClamp: 2 },
						{ text: prize.stock === 0 ? t.soldOut : prize.kind === 'balance' ? `$${(prize.amountCents / 100).toFixed(2)}` : t.none, top: '70px', fontSize: slots.value.length > 8 ? '16px' : '24px', fontWeight: '700' },
					],
			})),
			buttons: [{ radius: '27%', background: p.paper }, { radius: '23.5%', background: p.accent }],
			defaultConfig: { gutter: 2, offsetDegree: -180 / display.length, speed: 18, accelerationTime: 650, decelerationTime: 2200, stopRange: 0 },
			defaultStyle: { fontColor: p.ink, fontSize: '16px', fontWeight: '500', lineClamp: 2, lengthLimit: '88%' },
			end: finish,
		});
		const winnerIndex = slots.value.findIndex(prize => prize.id === landed.value);
		if (winnerIndex >= 0) wheel.settle(winnerIndex);
		else landed.value = '';
	} catch {
		failed.value = true;
		wheel?.destroy();
		wheel = undefined;
		host.value.replaceChildren();
	}
}

async function spinTo(prizeId: string, animate: boolean) {
	const index = slots.value.findIndex(prize => prize.id === prizeId);
	if (!wheel || index < 0 || !active) return;
	finish();
	pendingIndex = index;
	landed.value = '';
	if (!animate || window.document.hidden) { finish(); return; }
	await new Promise<void>(resolve => {
		finishPending = resolve;
		// Animation cannot hold a confirmed receipt hostage in throttled/background tabs.
		watchdog = window.setTimeout(finish, 5000);
		try { wheel!.play(); wheel!.stop(index); } catch { finish(); }
	});
}

function visibilityChanged() { if (window.document.hidden) finish(); }

onMounted(() => { mounted = true; renderWheel(); window.document.addEventListener('visibilitychange', visibilityChanged); });
onActivated(() => { const resume = !active; active = true; if (mounted && resume) renderWheel(); });
onDeactivated(() => { active = false; dispose(); });
onBeforeUnmount(() => { active = false; dispose(); window.document.removeEventListener('visibilitychange', visibilityChanged); });
watch(() => [props.prizes, props.appearance], renderWheel, { deep: true, flush: 'post' });
defineExpose({ spinTo });
</script>

<style lang="scss" module>
.wheel { width: min(100%, 480px); margin-inline: auto; }
.stage { position: relative; aspect-ratio: 1; isolation: isolate; border-radius: 50%; background: var(--wheel-accent); }
.canvas { position: absolute; inset: 0; width: 100% !important; height: 100% !important; border-radius: 50%; }
.canvas :global(canvas) { width: 100% !important; height: 100% !important; transform: none !important; }
.lights { position: absolute; inset: 0; overflow: hidden; border-radius: 50%; pointer-events: none; }
.lights > span { position: absolute; inset: 2%; display: flex; justify-content: center; }
.lights b { display: block; width: 1.4%; height: 1.4%; background: var(--wheel-paper); border-radius: 50%; }
.lights > span:nth-child(even) b { background: var(--wheel-rim); }
.pointer { position: absolute; top: -2%; left: 46.5%; width: 7%; height: 10%; background: var(--wheel-ink); clip-path: polygon(0 0, 100% 0, 50% 100%); border-radius: 5px; }
.center { position: absolute; left: 39.5%; top: 39.5%; width: 21%; height: 21%; border: 0; border-radius: 50%; background: var(--wheel-accent); color: var(--wheel-paper); display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; padding: 8px; cursor: pointer; font: inherit; }
.center strong { max-width: 100%; font-size: clamp(13px, 2.5vw, 26px); line-height: 1.1; overflow-wrap: anywhere; }
.center strong.longLabel { font-size: 13px; }
.center i { font-size: 24px; }.center span { font-size: 11px; line-height: 1.3; }
.center:disabled { cursor: default; }.center:not(:disabled):hover { filter: brightness(1.12); }.center:not(:disabled):active { transform: scale(.96); }
.center:focus-visible { outline: 3px solid var(--wheel-paper); outline-offset: 2px; }
.caption { text-align: center; font-size: 13px; line-height: 1.7; margin: 18px 0 0; color: var(--MI_THEME-fg); }
@media (max-width: 500px) { .center strong { font-size: 18px; }.center strong.longLabel { font-size: 11px; }.center span { font-size: 10px; }.center { gap: 2px; padding: 4px; } }
@media (prefers-reduced-motion: reduce) { .center:not(:disabled):active { transform: none; } }
</style>
