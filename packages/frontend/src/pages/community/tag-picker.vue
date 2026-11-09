<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<Teleport to="body">
	<div v-if="open && active" ref="layer" :class="$style.layer" :style="{ zIndex }" :data-motion="prefer.s.animation" @click.self="close" @wheel.self.prevent @touchmove.self.prevent>
		<section ref="panel" :class="$style.panel" role="dialog" aria-modal="true" :aria-labelledby="headingId" :aria-describedby="hintId" tabindex="-1" data-testid="community-tag-picker" @keydown="onKeydown">
			<header :class="$style.heading">
				<div><h2 :id="headingId">{{ title || (mode === 'filter' ? t.filterTitle : t.pickerTitle) }}</h2><p :id="hintId">{{ t.limitHint(maximum) }}</p></div>
				<button type="button" class="_button" :class="$style.iconButton" :aria-label="t.close" :title="t.close" @click="close"><i class="ti ti-x" aria-hidden="true"></i></button>
			</header>
			<div :class="$style.controls">
				<div v-if="!category" :class="$style.categories" :aria-label="t.categoryLabel" role="group">
					<button v-for="item in categoryChoices" :key="item.value" type="button" class="_button" :aria-pressed="filter === item.value" @click="filter = item.value">{{ item.label }}</button>
				</div>
				<div :class="$style.searchRow">
					<label :class="$style.search"><i class="ti ti-search" aria-hidden="true"></i><input v-model="query" type="search" :aria-label="t.search" :placeholder="t.searchPlaceholder" maxlength="100" autocomplete="off" data-testid="tag-search"/></label>
					<button type="button" class="_button" :class="$style.iconButton" :disabled="loading" :aria-label="t.refresh" :title="t.refresh" :aria-busy="loading" @click="reload"><i class="ti ti-refresh" aria-hidden="true"></i></button>
				</div>
			</div>
			<div :class="$style.body" :aria-busy="loading">
				<p v-if="loading" :class="$style.feedback" role="status">{{ t.loading }}</p>
				<div v-else-if="failed" :class="[$style.feedback, $style.error]" role="alert"><p>{{ t.loadFailed }}</p><button type="button" class="_button" :class="$style.secondary" @click="reload">{{ t.retry }}</button></div>
				<template v-else>
					<p v-if="invalidated" :class="$style.notice" role="status">{{ t.invalidated }}</p>
					<div v-if="!groups.length" :class="$style.empty"><i class="ti ti-tags" aria-hidden="true"></i><h3>{{ query.trim() ? t.noMatches : category || filter !== 'all' ? t.empty : t.emptyAll }}</h3><p>{{ query.trim() ? t.noMatchesHint : t.emptyHint }}</p><button v-if="query.trim()" type="button" class="_button" :class="$style.secondary" @click="query = ''">{{ t.clearSearch }}</button></div>
					<section v-for="group in groups" :key="group.category" :class="$style.group" :aria-label="t.categories[group.category]">
						<h3>{{ t.categories[group.category] }}<span>{{ group.tags.length }}</span></h3>
						<div :class="$style.tags"><button v-for="tag in group.tags" :key="tag.id" type="button" class="_button" :class="$style.tag" :aria-pressed="selectedIds.includes(tag.id)" :disabled="disabled || (!selectedIds.includes(tag.id) && atLimit)" :data-tag-id="tag.id" @click="toggle(tag.id)"><i :class="selectedIds.includes(tag.id) ? 'ti ti-check' : 'ti ti-plus'" aria-hidden="true"></i><span>{{ tag.name }}</span></button></div>
					</section>
				</template>
			</div>
			<footer :class="$style.footer">
				<div :class="$style.selectionSummary"><span role="status" aria-live="polite">{{ t.selectedCount(selectedIds.length, maximum) }}</span><button v-if="selectedIds.length" type="button" class="_button" :class="$style.clear" :disabled="disabled" @click="selection = []">{{ t.clear }}</button></div>
				<div v-if="selectedTags.length" :class="$style.selectedTags" :aria-label="t.selected"><button v-for="tag in selectedTags" :key="tag.id" type="button" class="_button" :disabled="disabled" :aria-label="t.remove(tag.name)" @click="toggle(tag.id)"><span>{{ tag.name }}</span><i class="ti ti-x" aria-hidden="true"></i></button></div>
				<p v-if="atLimit" :class="$style.limit" role="status">{{ t.limitReached(maximum) }}</p>
				<button type="button" class="_button" :class="$style.done" data-testid="tag-picker-done" @click="close">{{ t.done }}<i class="ti ti-check" aria-hidden="true"></i></button>
			</footer>
		</section>
	</div>
</Teleport>
</template>

<script setup lang="ts">
import { computed, onActivated, onBeforeUnmount, onDeactivated, ref, useId, watch } from 'vue';
import { tagText as t } from './tag-copy.js';
import { communityTagCategories, communityTagUpdates, loadCommunityTags } from './tags.js';
import type { CommunityCategory, CommunityTag } from './types.js';
import { claimZIndex } from '@/os.js';
import { focusTrap } from '@/utility/focus-trap.js';
import { prefer } from '@/preferences.js';

const selection = defineModel<string[]>({ required: true });
const open = defineModel<boolean>('open', { required: true });
const props = withDefaults(defineProps<{ category?: CommunityCategory; limit?: number; disabled?: boolean; title?: string; mode?: 'select' | 'filter' }>(), { category: undefined, title: undefined, limit: 3, disabled: false, mode: 'select' });
const emit = defineEmits<{ (event: 'loaded', tags: CommunityTag[]): void }>();
const headingId = useId(), hintId = useId();
const layer = ref<HTMLElement>(), panel = ref<HTMLElement>();
const tags = ref<CommunityTag[]>([]);
const query = ref(''), filter = ref<CommunityCategory | 'all'>('all');
const loading = ref(false), failed = ref(false), invalidated = ref(false), zIndex = ref(0);
const maximum = computed(() => Number.isFinite(props.limit) ? Math.max(1, Math.min(3, Math.floor(props.limit))) : 3);
const selectedIds = computed(() => [...new Set(selection.value)]);
const selectedTags = computed(() => selectedIds.value.flatMap(id => { const tag = tags.value.find(item => item.id === id); return tag ? [tag] : []; }));
const atLimit = computed(() => selectedIds.value.length >= maximum.value);
const categoryChoices = [{ value: 'all' as const, label: t.allCategories }, ...communityTagCategories.map(value => ({ value, label: t.categories[value] }))];
const groups = computed(() => {
	const search = query.value.trim().normalize('NFC').toLowerCase();
	return communityTagCategories.filter(category => (!props.category || category === props.category) && (filter.value === 'all' || category === filter.value)).map(category => ({ category, tags: tags.value.filter(tag => tag.category === category && tag.name.toLowerCase().includes(search)) })).filter(group => group.tags.length);
});
let controller: AbortController | undefined;
let releaseFocus: (() => void) | undefined;
let returnFocus: HTMLElement | undefined;
const active = ref(true);

function close() { open.value = false; }

function toggle(id: string) {
	if (props.disabled) return;
	if (selectedIds.value.includes(id)) selection.value = selectedIds.value.filter(value => value !== id);
	else if (!atLimit.value && !loading.value && !failed.value && tags.value.some(tag => tag.id === id)) selection.value = [...selectedIds.value, id];
}

async function reload() {
	if (!open.value || !active.value) return;
	controller?.abort();
	const request = new AbortController();
	controller = request;
	loading.value = true; failed.value = false;
	try {
		const result = await loadCommunityTags(props.category, request.signal);
		if (!active.value || !open.value || controller !== request) return;
		tags.value = result;
		emit('loaded', result);
		const valid = selectedIds.value.filter(id => result.some(tag => tag.id === id)).slice(0, maximum.value);
		if (valid.length !== selection.value.length) {
			invalidated.value = true;
			selection.value = valid;
		}
	} catch {
		if (active.value && open.value && controller === request && !request.signal.aborted) failed.value = true;
	} finally {
		if (controller === request) loading.value = false;
	}
}

function onKeydown(event: KeyboardEvent) {
	if (event.key === 'Escape' && !event.isComposing) { event.preventDefault(); event.stopPropagation(); close(); return; }
	if (event.key !== 'Tab' || !panel.value) return;
	event.stopPropagation();
	const controls = [...panel.value.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), a[href], [tabindex="0"]')].filter(element => element.getClientRects().length && !element.closest('[inert]'));
	const first = controls[0], last = controls.at(-1);
	if (!first) { event.preventDefault(); panel.value.focus(); } else if (event.shiftKey && (window.document.activeElement === first || window.document.activeElement === panel.value)) { event.preventDefault(); last?.focus(); } else if (!event.shiftKey && window.document.activeElement === last) { event.preventDefault(); first.focus(); }
}

function release() {
	controller?.abort();
	releaseFocus?.(); releaseFocus = undefined;
}

watch(open, value => {
	if (value) {
		returnFocus = window.document.activeElement instanceof HTMLElement ? window.document.activeElement : undefined;
		zIndex.value = claimZIndex('middle');
	} else release();
}, { immediate: true, flush: 'sync' });
watch([open, layer], ([value, element]) => {
	if (value && element && active.value && !releaseFocus) {
		releaseFocus = focusTrap(element).release;
		panel.value?.focus({ preventScroll: true });
	} else if (!value && active.value) {
		if (returnFocus?.isConnected && !returnFocus.closest('[inert]')) returnFocus.focus({ preventScroll: true });
		returnFocus = undefined;
	}
}, { flush: 'post' });
watch([open, () => props.category, active], ([value]) => {
	query.value = ''; filter.value = props.category ?? 'all'; invalidated.value = false;
	if (value) void reload();
}, { immediate: true });
watch(communityTagUpdates, () => { if (open.value) void reload(); });
onActivated(() => { active.value = true; });
onDeactivated(() => { active.value = false; release(); });
onBeforeUnmount(() => { active.value = false; release(); });
</script>

<style lang="scss" module>
.layer { position: fixed; inset: 0; display: flex; justify-content: flex-end; background: var(--MI_THEME-modalBg); color: var(--MI_THEME-fg); font: 14px/1.6 var(--community-font, sans-serif); overscroll-behavior: contain; }
.layer, .layer * { box-sizing: border-box; }
.panel { display: flex; flex-direction: column; width: min(460px, 100%); height: 100%; min-height: 0; background: var(--MI_THEME-panel); outline: none; animation: enter 180ms ease-out; }
.panel :focus-visible { outline: 2px solid var(--MI_THEME-accent); outline-offset: 3px; }
.panel button, .panel input { font: inherit; }
.panel button { cursor: pointer; }
.panel button:disabled { cursor: not-allowed; opacity: .5; }
.panel ::selection { background: var(--MI_THEME-accentedBg); color: var(--MI_THEME-accent); }
.heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; padding: max(24px, env(safe-area-inset-top)) 24px 20px; h2 { margin: 0 0 4px; font-size: 20px; line-height: 1.4; } p { margin: 0; color: color-mix(in srgb, var(--MI_THEME-fg) 75%, var(--MI_THEME-panel)); } }
.iconButton { display: grid; flex: 0 0 44px; place-items: center; width: 44px; height: 44px; border-radius: 8px; i { font-size: 20px; } &:hover:not(:disabled) { background: var(--MI_THEME-buttonBg); } }
.controls { padding: 0 24px 20px; border-bottom: 1px solid var(--MI_THEME-divider); }
.categories { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 12px; button { min-height: 44px; padding: 8px 10px; border-radius: 8px; font-size: 13px; } button:hover { background: var(--MI_THEME-buttonBg); } button[aria-pressed='true'] { color: var(--MI_THEME-accent); background: var(--MI_THEME-accentedBg); font-weight: 600; } }
.searchRow { display: flex; align-items: center; gap: 8px; }
.search { display: flex; flex: 1; align-items: center; gap: 8px; min-width: 0; padding: 0 12px; border: 1px solid var(--MI_THEME-inputBorder); border-radius: 8px; background: var(--MI_THEME-input); input { width: 100%; min-width: 0; height: 44px; padding: 0; border: 0; background: transparent; color: inherit; outline: none; caret-color: var(--MI_THEME-accent); } input::placeholder { color: color-mix(in srgb, var(--MI_THEME-fg) 70%, var(--MI_THEME-panel)); } &:focus-within { outline: 2px solid var(--MI_THEME-accent); outline-offset: 2px; } }
.body { flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain; padding: 24px; scrollbar-width: thin; scrollbar-color: var(--MI_THEME-divider) transparent; }
.group + .group { margin-top: 28px; }
.group h3 { display: flex; align-items: baseline; gap: 8px; margin: 0 0 12px; font-size: 14px; span { font-size: 12px; font-weight: normal; font-variant-numeric: tabular-nums; } }
.tags { display: flex; flex-wrap: wrap; gap: 8px; }
.tag { display: inline-flex; align-items: center; gap: 8px; min-height: 44px; max-width: 100%; padding: 10px 12px; border: 1px solid var(--MI_THEME-divider); border-radius: 8px; text-align: left; span { overflow-wrap: anywhere; } &:hover:not(:disabled) { background: var(--MI_THEME-buttonBg); } &[aria-pressed='true'] { border-color: var(--MI_THEME-accent); color: var(--MI_THEME-accent); background: var(--MI_THEME-accentedBg); } }
.empty { padding: 28px 0; text-align: center; > i { font-size: 28px; } h3 { margin: 12px 0 8px; font-size: 16px; } p { margin: 0 0 16px; } }
.feedback, .notice { margin: 0 0 16px; overflow-wrap: anywhere; p { margin: 0 0 12px; } }
.error { color: var(--MI_THEME-error); }
.notice { padding: 12px; background: var(--MI_THEME-buttonBg); border-radius: 8px; }
.secondary { min-height: 44px; padding: 8px 16px; border-radius: 8px; background: var(--MI_THEME-buttonBg); color: var(--MI_THEME-fg); }
.footer { flex-shrink: 0; padding: 12px 24px max(24px, env(safe-area-inset-bottom)); border-top: 1px solid var(--MI_THEME-divider); }
.selectionSummary { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 44px; font-variant-numeric: tabular-nums; }
.clear { min-height: 44px; padding: 8px; color: var(--MI_THEME-accent); &:hover:not(:disabled) { text-decoration: underline; } }
.selectedTags { display: flex; gap: 8px; margin-bottom: 8px; overflow-x: auto; scrollbar-width: thin; button { display: inline-flex; flex-shrink: 0; align-items: center; gap: 8px; min-height: 44px; max-width: 85%; padding: 8px 10px; border-radius: 8px; background: var(--MI_THEME-buttonBg); text-align: left; span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } &:hover:not(:disabled) { background: var(--MI_THEME-buttonHoverBg); } } }
.limit { margin: 0 0 12px; font-size: 12px; }
.done { display: flex; align-items: center; justify-content: center; gap: 8px; width: 100%; min-height: 44px; padding: 10px 16px; border-radius: 8px; background: var(--MI_THEME-accent); color: var(--MI_THEME-fgOnAccent); font-weight: 600; &:hover { filter: brightness(.95); } }
@keyframes enter { from { opacity: .7; transform: translateX(24px); } }
@keyframes rise { from { opacity: .7; transform: translateY(24px); } }
@media (max-width: 600px) {
	.layer { align-items: flex-end; }
	.panel { width: 100%; height: min(88dvh, 760px); border-radius: 16px 16px 0 0; animation-name: rise; }
	.heading { padding: 20px 16px 12px; h2 { font-size: 18px; } }
	.controls { padding: 0 16px 12px; }
	.search input { font-size: 16px; }
	.body { padding: 20px 16px; }
	.footer { padding: 8px 16px max(16px, env(safe-area-inset-bottom)); }
}
@media (max-height: 550px) { .panel { height: 100%; } .heading { padding-top: 12px; padding-bottom: 8px; } .controls { padding-bottom: 8px; } .selectedTags { display: none; } .footer { padding-bottom: max(12px, env(safe-area-inset-bottom)); } .limit { margin-bottom: 8px; } }
.layer[data-motion='false'] .panel { animation: none; }
@media (prefers-reduced-motion: reduce) { .panel { animation: none; } }
</style>
