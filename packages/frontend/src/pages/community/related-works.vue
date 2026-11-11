<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<section :class="$style.root" :aria-label="t.relatedWorks" data-testid="related-works">
	<header :class="$style.header"><div><h2>{{ t.relatedWorks }}</h2><p v-if="tagIds.length">{{ work.tags?.map(tag => `# ${tag.name}`).join(' · ') || t.relatedTags }}</p></div><slot name="close"></slot></header>
	<div ref="content" :class="$style.content" :aria-busy="loading" tabindex="-1">
		<div v-if="items.length" :class="$style.grid" data-testid="related-works-grid"><WorkCard v-for="item in items" :key="item.id" :work="item" compact thumbnailOnly/></div>
		<p v-if="loading" :class="$style.state" role="status">{{ t.loading }}</p>
		<p v-else-if="failed" :class="$style.state" role="alert">{{ t.relatedFailed }}</p>
		<p v-else-if="!items.length" :class="$style.state" role="status">{{ tagIds.length ? t.relatedEmpty : t.relatedNoTags }}</p>
		<button v-if="!loading && (failed || nextCursor)" ref="moreButton" type="button" class="_button" :class="$style.more" data-testid="related-works-more" @click="loadMore">{{ failed ? t.retry : t.relatedMore }}</button>
	</div>
</section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import WorkCard from './work-card.vue';
import { workText as t } from './interactions-copy.js';
import type { CommunityWork } from './types.js';
import { misskeyApi } from '@/utility/misskey-api.js';

const props = defineProps<{ work: CommunityWork }>();
const tagIds = computed(() => [...new Set(props.work.tags?.map(tag => tag.id) ?? props.work.tagIds ?? [])]);
const items = ref<CommunityWork[]>([]);
const nextCursor = ref<string | null>(null);
const loading = ref(false);
const failed = ref(false);
const content = ref<HTMLElement>();
const moreButton = ref<HTMLButtonElement>();
let controller: AbortController | undefined;

async function loadMore() {
	if (loading.value || !tagIds.value.length) return;
	// Keep keyboard focus inside the drawer while the pagination button is replaced.
	if (window.document.activeElement === moreButton.value) content.value?.focus({ preventScroll: true });
	const current = new AbortController();
	controller = current;
	loading.value = true;
	failed.value = false;
	const cursor = nextCursor.value;
	const timeout = window.setTimeout(() => current.abort(), 15000);
	try {
		const page = await misskeyApi('community/works', { category: props.work.category, tagIds: tagIds.value, limit: 20, ...(cursor ? { untilId: cursor } : {}) }, undefined, current.signal);
		if (controller !== current) return;
		const known = new Set([props.work.id, ...items.value.map(item => item.id)]);
		const matches = page.items.filter(item => {
			if (known.has(item.id) || item.category !== props.work.category || !['published', 'approved'].includes(item.status) || !(item.tags?.map(tag => tag.id) ?? item.tagIds ?? []).some(id => tagIds.value.includes(id))) return false;
			known.add(item.id);
			return true;
		});
		items.value.push(...matches);
		nextCursor.value = page.nextCursor === cursor ? null : page.nextCursor;
	} catch {
		if (controller === current) failed.value = true;
	} finally {
		window.clearTimeout(timeout);
		if (controller === current) loading.value = false;
	}
}

watch(() => [props.work.id, props.work.category, ...tagIds.value].join(':'), () => {
	controller?.abort(); controller = undefined;
	items.value = []; nextCursor.value = null; loading.value = false; failed.value = false;
	void loadMore();
}, { immediate: true });
onBeforeUnmount(() => { controller?.abort(); controller = undefined; });
</script>

<style lang="scss" module>
.root { display: flex; flex-direction: column; height: 100%; min-height: 0; min-width: 0; color: var(--MI_THEME-fg); background: var(--MI_THEME-panel); }
.header { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; padding: 18px 14px 12px; flex-shrink: 0; border-bottom: 1px solid var(--MI_THEME-divider); > div { min-width: 0; } h2 { margin: 0; font-size: 15px; line-height: 1.5; font-weight: 600; } p { margin: 5px 0 0; font-size: 12px; line-height: 1.6; color: color-mix(in srgb, var(--MI_THEME-fg) 75%, var(--MI_THEME-panel)); overflow-wrap: anywhere; } }
.content { flex: 1; min-height: 0; padding: 14px; overflow-y: auto; overscroll-behavior: contain; scrollbar-width: thin; }
.grid { --work-row-gap: 8px; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); grid-auto-rows: 1px; column-gap: 8px; align-items: start; }
.state { margin: 0; padding: 24px 4px; font-size: 13px; line-height: 1.7; color: color-mix(in srgb, var(--MI_THEME-fg) 75%, var(--MI_THEME-panel)); }
.more { display: block; width: 100%; min-height: 44px; margin-top: 8px; border-radius: 8px; background: var(--MI_THEME-buttonBg); font-size: 13px; &:hover { background: var(--MI_THEME-buttonHoverBg); } }
.root :focus-visible { outline: 2px solid var(--MI_THEME-accent); outline-offset: -2px; }
</style>
