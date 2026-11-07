<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<section class="_panel" :class="$style.root" aria-labelledby="appearance-title">
	<h2 id="appearance-title" :class="$style.title">{{ t.title }}</h2>
	<p :class="$style.hint">{{ t.intro }}</p>
	<fieldset :class="$style.options">
		<legend :class="$style.srOnly">{{ t.title }}</legend>
		<label v-for="option in options" :key="option.value" :class="[$style.option, { [$style.selected]: mode === option.value }]">
			<input type="radio" name="appearance-mode" :value="option.value" :checked="mode === option.value" @change="selectMode(option.value)">
			<i :class="option.icon" aria-hidden="true"></i>
			<span>{{ option.label }}</span>
		</label>
	</fieldset>
	<p :class="$style.status" role="status">{{ t.current }} · {{ store.r.darkMode.value ? t.dark : t.light }}</p>
	<form v-if="mode === 'schedule'" :class="$style.schedule" novalidate @submit.prevent="saveSchedule">
		<div :class="$style.times">
			<label :class="$style.timeField">
				<span>{{ t.lightStart }}</span>
				<input v-model="lightStart" type="time" step="60" required :aria-invalid="!valid" aria-describedby="appearance-time-hint appearance-time-error" @input="saved = false">
			</label>
			<label :class="$style.timeField">
				<span>{{ t.darkStart }}</span>
				<input v-model="darkStart" type="time" step="60" required :aria-invalid="!valid" aria-describedby="appearance-time-hint appearance-time-error" @input="saved = false">
			</label>
		</div>
		<p id="appearance-time-hint" :class="$style.hint">{{ t.localTime }}</p>
		<p v-if="!valid" id="appearance-time-error" :class="$style.error" role="alert">{{ t.invalid }}</p>
		<div :class="$style.ranges">
			<p>{{ t.dayRange }} · {{ schedule.lightStart }} – {{ schedule.darkStart <= schedule.lightStart ? t.nextDay + ' ' : '' }}{{ schedule.darkStart }}</p>
			<p>{{ t.nightRange }} · {{ schedule.darkStart }} – {{ schedule.lightStart <= schedule.darkStart ? t.nextDay + ' ' : '' }}{{ schedule.lightStart }}</p>
		</div>
		<div :class="$style.actions">
			<MkButton type="submit" primary :disabled="!valid || !dirty">{{ t.save }}</MkButton>
			<span v-if="saved" role="status">{{ t.saved }}</span>
		</div>
	</form>
	<p :class="$style.hint">{{ t.manual }}</p>
</section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import MkButton from '@/components/MkButton.vue';
import { prefer } from '@/preferences.js';
import { store } from '@/store.js';
import { appearanceText as t } from '@/utility/appearance-copy.js';
import { getAppearanceMode, setAppearanceMode } from '@/utility/appearance.js';
import { isValidThemeSchedule, normalizeThemeSchedule } from '@/utility/theme-schedule.js';
import type { AppearanceMode } from '@/utility/theme-schedule.js';

const options: { value: AppearanceMode; label: string; icon: string }[] = [
	{ value: 'light', label: t.light, icon: 'ti ti-sun' },
	{ value: 'dark', label: t.dark, icon: 'ti ti-moon' },
	{ value: 'schedule', label: t.schedule, icon: 'ti ti-clock' },
	{ value: 'system', label: t.system, icon: 'ti ti-device-desktop' },
];
const mode = computed(getAppearanceMode);
const schedule = computed(() => normalizeThemeSchedule(prefer.r.themeSchedule.value));
const lightStart = ref(schedule.value.lightStart);
const darkStart = ref(schedule.value.darkStart);
const saved = ref(false);
const valid = computed(() => isValidThemeSchedule(lightStart.value, darkStart.value));
const dirty = computed(() => lightStart.value !== schedule.value.lightStart || darkStart.value !== schedule.value.darkStart);

watch(schedule, value => {
	lightStart.value = value.lightStart;
	darkStart.value = value.darkStart;
});

function selectMode(value: AppearanceMode) {
	saved.value = false;
	setAppearanceMode(value);
}

function saveSchedule() {
	if (!valid.value) return;
	prefer.commit('themeSchedule', { enabled: true, lightStart: lightStart.value, darkStart: darkStart.value });
	saved.value = true;
}
</script>

<style lang="scss" module>
.root { padding: 24px; }
.title { margin: 0 0 8px; font-size: 1.1em; }
.hint { margin: 8px 0; font-size: .9em; line-height: 1.6; color: var(--MI_THEME-fg); }
.options { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; padding: 0; margin: 20px 0 12px; border: 0; }
.option { display: flex; align-items: center; gap: 10px; min-height: 48px; padding: 8px 12px; box-sizing: border-box; border: 1px solid var(--MI_THEME-divider); border-radius: var(--MI-radius); cursor: pointer; }
.option:hover { background: var(--MI_THEME-buttonHoverBg); }
.selected { background: var(--MI_THEME-buttonBg); border-color: var(--MI_THEME-fg); }
.option input { accent-color: var(--MI_THEME-accent); margin: 0; flex-shrink: 0; }
.option i { font-size: 20px; }
.option:focus-within, .timeField input:focus-visible { outline: 2px solid var(--MI_THEME-accent); outline-offset: 3px; }
.status { margin: 12px 0; font-size: .9em; }
.schedule { padding-block: 16px; border-top: 1px solid var(--MI_THEME-divider); }
.times { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
.timeField { display: flex; flex-direction: column; gap: 8px; min-width: 0; font-size: .9em; }
.timeField input { width: 100%; min-width: 0; box-sizing: border-box; min-height: 44px; padding: 8px 12px; font: inherit; font-size: 16px; font-variant-numeric: tabular-nums; border: 1px solid var(--MI_THEME-divider); border-radius: var(--MI-radius); color: var(--MI_THEME-fg); background: var(--MI_THEME-panel); }
.timeField input[aria-invalid="true"] { border-color: var(--MI_THEME-error); }
.error { color: var(--MI_THEME-error); font-size: .9em; }
.ranges { margin-block: 16px; font-size: .9em; font-variant-numeric: tabular-nums; }
.ranges p { margin: 6px 0; }
.actions { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; font-size: .9em; }
.srOnly { position: absolute; width: 1px; height: 1px; padding: 0; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
@media (max-width: 480px) {
	.root { padding: 16px; }
	.times { grid-template-columns: 1fr; }
	.option { gap: 6px; padding-inline: 8px; font-size: .9em; }
}
</style>
