<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div :class="$style.root" data-testid="profile-sections">
	<div ref="tabbar" role="tablist" :aria-label="ft.profileWorks" :class="$style.tabs" data-testid="profile-tabs">
		<button v-for="tab in tabs" :id="`${id}-${tab.key}-tab`" :key="tab.key" type="button" role="tab" class="_button" :aria-controls="`${id}-${tab.key}-panel`" :aria-selected="model === tab.key" :tabindex="model === tab.key ? 0 : -1" @click="select(tab.key)" @keydown="keydown($event, tab.key)">{{ tab.label }}<i v-if="tab.locked" class="ti ti-lock" aria-hidden="true"></i></button>
		<span :class="$style.indicator" :style="{ width: `${100 / tabs.length}%`, transform: `translateX(${progress * 100}%)` }" aria-hidden="true"></span>
	</div>
	<div ref="track" :class="$style.track" :style="{ height: `${height}px` }" data-testid="profile-swipe-track" @scroll.passive="onScroll" @scrollend="settle" @pointerdown.passive="interrupt">
		<section v-for="tab in tabs" :id="`${id}-${tab.key}-panel`" :key="tab.key" :ref="el => setPanel(tab.key, el)" role="tabpanel" :aria-labelledby="`${id}-${tab.key}-tab`" :aria-hidden="model !== tab.key" :inert="model !== tab.key" :tabindex="model === tab.key ? 0 : -1" :class="$style.panel" :data-profile-panel="tab.key">
			<slot v-if="visited.has(tab.key)" :name="tab.key" :active="model === tab.key"></slot>
		</section>
	</div>
</div>
</template>

<script setup lang="ts">
import { nextTick, onActivated, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue';
import type { ComponentPublicInstance } from 'vue';
import { feedText as ft } from './feed-copy.js';
import { prefer } from '@/preferences.js';

const props = defineProps<{ tabs: { key: string; label: string; locked?: boolean }[]; scrollRoot?: HTMLElement; headerHeight: number }>();
const model = defineModel<string>({ default: 'works' });
const id = useId();
const tabbar = ref<HTMLElement>();
const track = ref<HTMLElement>();
const panels = new Map<string, HTMLElement>();
const visited = ref(new Set([model.value]));
const positions = new Map<string, number>();
const height = ref(320);
const progress = ref(0);
let destination: number | undefined;
let timer: number | undefined;
let observer: ResizeObserver | undefined;
let change = 0;

function setPanel(key: string, element: Element | ComponentPublicInstance | null) {
	const previous = panels.get(key);
	if (previous) observer?.unobserve(previous);
	if (element instanceof HTMLElement) {
		panels.set(key, element);
		observer?.observe(element);
	} else panels.delete(key);
}

function measure() {
	height.value = panels.get(model.value)?.offsetHeight ?? 320;
}

function select(key: string) {
	const index = props.tabs.findIndex(tab => tab.key === key);
	if (index < 0 || !track.value) return;
	destination = index;
	model.value = key;
	const animate = prefer.s.animation && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
	track.value.scrollTo({ left: index * track.value.clientWidth, behavior: animate ? 'smooth' : 'instant' });
	window.clearTimeout(timer);
	timer = window.setTimeout(settle, 180);
}

function onScroll() {
	const element = track.value;
	if (!element?.clientWidth) return;
	progress.value = Math.max(0, Math.min(props.tabs.length - 1, element.scrollLeft / element.clientWidth));
	if (destination == null) model.value = props.tabs[Math.round(progress.value)].key;
	window.clearTimeout(timer);
	timer = window.setTimeout(settle, 120);
}

function settle() {
	window.clearTimeout(timer);
	destination = undefined;
	onScroll();
	window.clearTimeout(timer);
}

function interrupt() {
	if (destination == null || !track.value) return;
	track.value.scrollTo({ left: track.value.scrollLeft, behavior: 'instant' });
	settle();
}

function keydown(event: KeyboardEvent, key: string) {
	const index = props.tabs.findIndex(tab => tab.key === key);
	const next = event.key === 'Home' ? 0 : event.key === 'End' ? props.tabs.length - 1 : event.key === 'ArrowRight' ? (index + 1) % props.tabs.length : event.key === 'ArrowLeft' ? (index - 1 + props.tabs.length) % props.tabs.length : -1;
	if (next < 0) return;
	event.preventDefault();
	select(props.tabs[next].key);
	(tabbar.value?.querySelectorAll('button')[next])?.focus({ preventScroll: true });
}

watch(model, async (key, previous) => {
	const version = ++change;
	const top = props.scrollRoot?.scrollTop ?? 0;
	positions.set(previous, Math.max(0, top - props.headerHeight));
	visited.value.add(key);
	await nextTick();
	if (version !== change) return;
	measure();
	await nextTick();
	if (version !== change || !props.scrollRoot) return;
	props.scrollRoot.scrollTop = top < props.headerHeight ? top : props.headerHeight + (positions.get(key) ?? 0);
});

function align() {
	measure();
	const index = Math.max(0, props.tabs.findIndex(tab => tab.key === model.value));
	track.value?.scrollTo({ left: index * track.value.clientWidth, behavior: 'instant' });
	progress.value = index;
}

onMounted(() => {
	observer = new ResizeObserver(entries => {
		measure();
		if (entries.some(entry => entry.target === tabbar.value)) align();
	});
	for (const panel of panels.values()) observer.observe(panel);
	// Observe width only; the active panel owns the track height.
	if (tabbar.value) observer.observe(tabbar.value);
	align();
});
watch(() => props.tabs.map(tab => tab.key).join(','), async () => {
	if (!props.tabs.some(tab => tab.key === model.value)) model.value = props.tabs[0].key;
	await nextTick();
	align();
});
onActivated(() => { void nextTick(align); });
onBeforeUnmount(() => { observer?.disconnect(); window.clearTimeout(timer); change++; });
defineExpose({ select });
</script>

<style lang="scss" module>
.root { min-width: 0; overflow-anchor: none; }
.tabs { position: sticky; top: var(--profile-topbar-height, 0px); z-index: 30; display: flex; height: 50px; background: var(--MI_THEME-panel); border-bottom: 1px solid var(--MI_THEME-divider); > button { flex: 1; min-width: 0; min-height: 50px; display: flex; justify-content: center; align-items: center; gap: 4px; color: var(--MI_THEME-fgTransparentWeak); font-size: 15px; &[aria-selected='true'] { color: var(--MI_THEME-fg); font-weight: 700; } i { font-size: 12px; } &:focus-visible { outline: 2px solid var(--MI_THEME-accent); outline-offset: -4px; border-radius: 4px; } } }
.indicator { position: absolute; left: 0; bottom: -1px; height: 3px; pointer-events: none; &::after { content: ''; display: block; width: 36px; max-width: 70%; height: 100%; margin: auto; background: var(--MI_THEME-accent); border-radius: 3px; } }
.track { display: flex; align-items: flex-start; overflow-x: auto; overflow-y: hidden; scroll-snap-type: x mandatory; overscroll-behavior-x: contain; scrollbar-width: none; min-height: max(260px, calc(var(--mobile-feed-height, 600px) - var(--profile-topbar-height, 56px) - 50px)); &::-webkit-scrollbar { display: none; } }
.panel { flex: 0 0 100%; min-width: 0; min-height: 260px; scroll-snap-align: start; scroll-snap-stop: always; &:focus-visible { outline: 2px solid var(--MI_THEME-accent); outline-offset: -3px; } }
</style>
