<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<main ref="root" :class="$style.root" data-testid="community-work-detail">
	<header :class="$style.topbar"><MkA :to="backPath" :class="$style.back"><i class="ti ti-arrow-left" aria-hidden="true"></i>{{ t.back }}</MkA><span>{{ work?.title }}</span></header>
	<div v-if="!work" :class="$style.state" :role="failed ? 'alert' : 'status'"><p>{{ failed ? unavailable ? t.unavailable : t.failed : t.loading }}</p><button v-if="failed" type="button" class="_button" @click="load">{{ t.retry }}</button></div>
	<div v-else :class="$style.layout">
		<div :class="$style.stage"><WorkMedia :work="work"/></div>
		<aside :class="$style.sidebar">
			<header :class="$style.author"><MkA :to="`/@${work.author.username}`" :class="$style.avatar" aria-hidden="true" tabindex="-1">{{ (work.author.name || work.author.username).slice(0, 1) }}</MkA><div><MkA :to="`/@${work.author.username}`"><strong>{{ work.author.name || work.author.username }}</strong></MkA><span>@{{ work.author.username }}</span></div></header>
			<h1>{{ work.title }}</h1>
			<section :class="$style.prompt"><h2>{{ t.prompt }}</h2><p><Mfm :text="work.text" :plain="true"/></p><button v-if="work.text" type="button" class="_button" @click="copyPrompt"><i class="ti ti-copy" aria-hidden="true"></i> {{ t.copyPrompt }}</button><p v-if="copyFailed" role="alert">{{ t.copyFailed }}</p></section>
			<p v-if="work.model" :class="$style.meta">{{ work.model }}</p>
			<p v-if="work.license" :class="$style.meta">{{ t.license }} · {{ work.license }}</p>
			<a v-if="safeWebUrl(work.sourceUrl)" :class="$style.source" :href="safeWebUrl(work.sourceUrl)" target="_blank" rel="noopener noreferrer">{{ t.source }} <i class="ti ti-arrow-up-right" aria-hidden="true"></i></a>
			<time :class="$style.date" :datetime="work.submittedAt">{{ new Date(work.submittedAt).toLocaleString() }}</time>
			<WorkEngagement :key="work.id" :work="work" :viewsCount="views" discussion>
				<template #afterActions><MkA :to="studioPath(work!.category)" :class="$style.remix" data-testid="work-remix"><i class="ti ti-wand" aria-hidden="true"></i><span><strong>{{ t.remix }}</strong><small>{{ work!.category === 'image' ? t.remixImage : work!.category === 'video' ? t.remixVideo : t.remixText }}</small></span><i class="ti ti-arrow-up-right" aria-hidden="true"></i></MkA></template>
			</WorkEngagement>
		</aside>
	</div>
</main>
</template>

<script setup lang="ts">
import { computed, onActivated, onBeforeUnmount, onDeactivated, ref, watch } from 'vue';
import type { CommunityWork } from './types.js';
import WorkMedia from './work-media.vue';
import WorkEngagement from './work-engagement.vue';
import { workText as t, studioPath } from './interactions-copy.js';
import { safeWebUrl } from './copy.js';
import { useWorkView } from './use-work-view.js';
import { communityUpdates, getCommunityUpdateVersion } from './updates.js';
import { misskeyApi } from '@/utility/misskey-api.js';
import { definePage } from '@/page.js';
import * as os from '@/os.js';

const props = defineProps<{ submissionId: string }>();
const root = ref<HTMLElement>();
const work = ref<CommunityWork | null>(null);
const failed = ref(false);
const unavailable = ref(false);
const copyFailed = ref(false);
const views = useWorkView(root, () => work.value);
const backPath = computed(() => `/community/${work.value?.category === 'resource' ? 'knowledge' : work.value?.category ?? 'image'}`);
let controller: AbortController | undefined;
let loadedVersion = getCommunityUpdateVersion();
let active = true;

async function load() {
	const version = getCommunityUpdateVersion();
	controller?.abort();
	const current = new AbortController(); controller = current;
	work.value = null; failed.value = false; unavailable.value = false; copyFailed.value = false;
	const timeout = window.setTimeout(() => current.abort(), 15000);
	try {
		const result = await misskeyApi('community/works/show', { submissionId: props.submissionId }, undefined, current.signal);
		if (controller === current) { work.value = result; loadedVersion = version; }
	} catch (error) {
		if (controller !== current) return;
		failed.value = true;
		unavailable.value = error != null && typeof error === 'object' && 'code' in error && error.code === 'COMMUNITY_NOT_FOUND';
	} finally { window.clearTimeout(timeout); }
}

async function copyPrompt() { try { await navigator.clipboard.writeText(work.value?.text ?? ''); os.toast(t.copied); copyFailed.value = false; } catch { copyFailed.value = true; } }

watch(() => props.submissionId, load, { immediate: true });
watch(communityUpdates, () => { if (active) void load(); });
onActivated(() => { active = true; if (loadedVersion !== getCommunityUpdateVersion()) void load(); });
onDeactivated(() => { active = false; });
onBeforeUnmount(() => { controller?.abort(); controller = undefined; });
definePage(() => ({ title: work.value?.title ?? t.preview, icon: 'ti ti-photo', needWideArea: true }));
</script>

<style lang="scss" module>
.root { height: 100%; min-width: 0; overflow: auto; background: var(--MI_THEME-panel); color: var(--MI_THEME-fg); container-type: inline-size; }
.root :focus-visible { outline: 2px solid var(--MI_THEME-accent); outline-offset: 3px; }
.topbar { display: flex; align-items: center; gap: 24px; padding: 0 20px; min-height: 54px; border-bottom: 1px solid var(--MI_THEME-divider); box-sizing: border-box; > span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; } }
.back { display: inline-flex; align-items: center; gap: 8px; min-height: 44px; flex-shrink: 0; font-size: 13px; }
.layout { display: grid; grid-template-columns: minmax(0, 1fr) minmax(340px, 380px); height: calc(100% - 55px); min-height: 540px; }
.stage { min-width: 0; min-height: 0; }
.sidebar { min-width: 0; padding: 24px 22px; overflow-y: auto; scrollbar-width: thin; box-sizing: border-box; h1 { font-size: 21px; margin: 20px 0 14px; line-height: 1.45; overflow-wrap: anywhere; } }
.author { display: flex; align-items: center; gap: 10px; font-size: 14px; > div { display: flex; flex-direction: column; min-width: 0; overflow-wrap: anywhere; } span { font-size: 12px; color: var(--MI_THEME-fgTransparentWeak); } }
.avatar { flex-shrink: 0; display: grid; place-items: center; width: 42px; height: 42px; border-radius: 50%; background: var(--MI_THEME-buttonBg); font-size: 18px; font-weight: 600; }
.prompt { h2 { font-size: 12px; font-weight: 500; margin: 0 0 8px; color: var(--MI_THEME-fgTransparentWeak); } p { font-size: 14px; line-height: 1.8; white-space: pre-wrap; overflow-wrap: anywhere; margin: 0; } > button { display: flex; align-items: center; gap: 6px; min-height: 40px; margin-top: 4px; font-size: 12px; } }
.meta, .source { display: block; font-size: 12px; line-height: 1.6; margin: 10px 0; overflow-wrap: anywhere; }
.date { display: block; padding: 16px 0 12px; border-bottom: 1px solid var(--MI_THEME-divider); color: var(--MI_THEME-fgTransparentWeak); font-size: 12px; }
.remix { display: flex; align-items: center; gap: 12px; min-height: 72px; margin: 8px 0 20px; padding: 12px 16px; box-sizing: border-box; border-radius: 12px; background: var(--MI_THEME-accentedBg); color: var(--MI_THEME-accent); > i { font-size: 23px; } > i:last-child { margin-left: auto; font-size: 21px; } span { display: flex; flex-direction: column; gap: 2px; } strong { font-size: 16px; } small { font-size: 12px; } &:hover { background: var(--MI_THEME-buttonHoverBg); } }
.state { display: grid; place-content: center; min-height: 60vh; text-align: center; padding: 24px; button { min-height: 44px; color: var(--MI_THEME-accent); } }
@container (max-width: 780px) { .layout { display: flex; flex-direction: column; height: auto; min-height: 0; } .stage { height: clamp(280px, 54vh, 620px); flex-shrink: 0; } .sidebar { overflow: visible; padding: 22px 18px; } .topbar { padding: 0 16px; } }
</style>
