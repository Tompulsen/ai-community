<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<main ref="root" :class="[$style.root, { [$style.mobileDetail]: mobile, [$style.withVideo]: mobile && hasVideo, [$style.commentsOpen]: commentsOpen }]" data-testid="community-work-detail">
	<header :class="[$style.topbar, { [$style.mobileTopbar]: mobile }]"><MkA :to="backPath" :class="$style.back" :aria-label="t.back"><i class="ti ti-arrow-left" aria-hidden="true"></i><span>{{ t.back }}</span></MkA><span>{{ mobile ? t.preview : work?.title }}</span></header>
	<div v-if="!work" :class="$style.state" :role="failed ? 'alert' : 'status'"><p>{{ failed ? unavailable ? t.unavailable : t.failed : t.loading }}</p><button v-if="failed" type="button" class="_button" @click="load">{{ t.retry }}</button></div>
	<div v-else-if="mobile" :class="$style.mobileStage">
		<WorkEngagement :key="work.id" :work="work" :viewsCount="views" immersive @discussionChange="commentsOpen = $event">
			<div :class="$style.mobileMedia"><WorkMedia :work="work" immersive :suspended="commentsOpen || !active"/></div>
			<section :class="[$style.caption, { [$style.expanded]: detailsOpen, [$style.withVideo]: hasVideo }]" :aria-label="t.prompt">
				<MkA :to="`/@${work.author.username}`" :class="$style.mobileAuthor">@{{ work.author.name || work.author.username }}</MkA>
				<h1>{{ work.title }}</h1>
				<p v-if="captionDescription" :class="$style.description">{{ captionDescription }}</p>
				<div :class="$style.captionFooter"><WorkTags :tags="work.tags"/><button type="button" class="_button" :aria-expanded="detailsOpen" :aria-controls="detailsId" data-testid="work-expand-details" @click="detailsOpen = !detailsOpen">{{ detailsOpen ? t.collapseDetails : t.expandDetails }}<i :class="detailsOpen ? 'ti ti-chevron-down' : 'ti ti-chevron-up'" aria-hidden="true"></i></button></div>
				<div v-if="detailsOpen" :id="detailsId" :class="$style.expandedDetails">
					<section v-if="work.generation?.prompt ?? work.text" :class="$style.prompt"><h2>{{ t.prompt }}</h2><p><Mfm :text="work.generation?.prompt ?? work.text" :plain="true"/></p><button v-if="work.generation?.prompt ?? work.text" type="button" class="_button" @click="copyPrompt"><i class="ti ti-copy" aria-hidden="true"></i> {{ t.copyPrompt }}</button><p v-if="copyFailed" role="alert">{{ t.copyFailed }}</p></section>
					<p v-if="work.generation?.model || work.model" :class="$style.meta">{{ work.generation?.model || work.model }}</p>
					<p v-if="work.license" :class="$style.meta">{{ t.license }} · {{ work.license }}</p>
					<a v-if="safeWebUrl(work.sourceUrl)" :class="$style.source" :href="safeWebUrl(work.sourceUrl)" target="_blank" rel="noopener noreferrer">{{ t.source }} <i class="ti ti-arrow-up-right" aria-hidden="true"></i></a>
					<WorkMaterials :work="work"/>
					<time :class="$style.date" :datetime="work.submittedAt">{{ new Date(work.submittedAt).toLocaleString() }}</time>
				</div>
			</section>
			<template #remixAction><button type="button" class="_button" :class="$style.mobileRemix" data-testid="work-remix" @click="openRemix"><span><i class="ti ti-wand" aria-hidden="true"></i></span><strong>{{ t.remix }}</strong></button></template>
		</WorkEngagement>
	</div>
	<div v-else :class="$style.layout">
		<div :class="$style.stage"><WorkMedia :work="work"/></div>
		<aside :class="$style.sidebar">
			<header :class="$style.author"><MkA :to="`/@${work.author.username}`" :class="$style.avatar" aria-hidden="true" tabindex="-1">{{ (work.author.name || work.author.username).slice(0, 1) }}</MkA><div><MkA :to="`/@${work.author.username}`"><strong>{{ work.author.name || work.author.username }}</strong></MkA><span>@{{ work.author.username }}</span></div></header>
			<h1>{{ work.title }}</h1>
			<WorkTags :tags="work.tags"/>
			<p v-if="work.generation && work.text && work.text !== work.generation.prompt" :class="$style.description">{{ work.text }}</p>
			<section v-if="work.generation?.prompt ?? work.text" :class="$style.prompt"><h2>{{ t.prompt }}</h2><p><Mfm :text="work.generation?.prompt ?? work.text" :plain="true"/></p><button v-if="work.generation?.prompt ?? work.text" type="button" class="_button" @click="copyPrompt"><i class="ti ti-copy" aria-hidden="true"></i> {{ t.copyPrompt }}</button><p v-if="copyFailed" role="alert">{{ t.copyFailed }}</p></section>
			<p v-if="work.model" :class="$style.meta">{{ work.generation?.model || work.model }}</p>
			<p v-if="work.license" :class="$style.meta">{{ t.license }} · {{ work.license }}</p>
			<a v-if="safeWebUrl(work.sourceUrl)" :class="$style.source" :href="safeWebUrl(work.sourceUrl)" target="_blank" rel="noopener noreferrer">{{ t.source }} <i class="ti ti-arrow-up-right" aria-hidden="true"></i></a>
			<time :class="$style.date" :datetime="work.submittedAt">{{ new Date(work.submittedAt).toLocaleString() }}</time>
			<WorkEngagement :key="work.id" :work="work" :viewsCount="views" discussion>
				<template #afterActions><button type="button" class="_button" :class="$style.remix" data-testid="work-remix" @click="openRemix"><i class="ti ti-wand" aria-hidden="true"></i><span><strong>{{ t.remix }}</strong><small>{{ backgroundText.modeSummary }}</small></span><i class="ti ti-chevron-down" aria-hidden="true"></i></button></template>
			</WorkEngagement>
		</aside>
	</div>
</main>
</template>

<script setup lang="ts">
import { computed, onActivated, onBeforeUnmount, onDeactivated, ref, useId, watch } from 'vue';
import WorkMedia from './work-media.vue';
import WorkEngagement from './work-engagement.vue';
import WorkMaterials from './work-materials.vue';
import WorkTags from './work-tags.vue';
import { workText as t, studioPath } from './interactions-copy.js';
import { safeWebUrl } from './copy.js';
import { useWorkView } from './use-work-view.js';
import { communityUpdates, getCommunityUpdateVersion } from './updates.js';
import { getCommunityWorkReturnPath } from './work-navigation.js';
import type { CommunityWork } from './types.js';
import type { StudioRemix } from '@/utility/studio-remix.js';
import { backgroundText } from '@/utility/studio-copy.js';
import { misskeyApi } from '@/utility/misskey-api.js';
import { definePage } from '@/page.js';
import { useRouter } from '@/router.js';
import * as os from '@/os.js';
import { $i } from '@/i.js';
import { backgroundStudio, manualRemix, queueBackgroundRemix } from '@/utility/background-studio.js';

const props = defineProps<{ submissionId: string }>();
const router = useRouter();
const root = ref<HTMLElement>();
const viewport = window.matchMedia('(max-width: 700px)');
const mobile = ref(viewport.matches);
const resize = () => { mobile.value = viewport.matches; };
viewport.addEventListener('change', resize);
const active = ref(true);
const commentsOpen = ref(false);
const detailsOpen = ref(false);
const detailsId = useId();
const work = ref<CommunityWork | null>(null);
const failed = ref(false);
const unavailable = ref(false);
const copyFailed = ref(false);
const views = useWorkView(root, () => work.value);
const hasVideo = computed(() => work.value?.files.some(file => file.type.startsWith('video/')) ?? false);
const captionDescription = computed(() => {
	const value = work.value;
	if (!value) return '';
	const title = value.title.replace(/\s+/g, ' ').trim();
	const text = value.text.replace(/\s+/g, ' ').trim();
	return title && text.startsWith(title) ? '' : value.text;
});
const remixPath = computed(() => work.value ? `${studioPath(work.value.category)}?remix=${encodeURIComponent(work.value.id)}` : '/create/image');
let remixOpening = false;

async function openRemix() {
	if (!$i) { router.pushByPath(remixPath.value); return; }
	if (!work.value || remixOpening) return;
	remixOpening = true;
	try {
		const { dispose } = await os.popupAsyncWithDialog(import('@/components/MkStudioRemix.vue'), { submissionId: work.value.id, chooseMode: true }, {
			apply: (value: StudioRemix, mode: 'workbench' | 'background') => {
				if (mode === 'background') queueBackgroundRemix(value);
				else { manualRemix.value = value; backgroundStudio.openTask = ''; router.push('/create/:kind', { params: { kind: value.kind } }); }
			},
			closed: () => { dispose(); remixOpening = false; },
		});
	} catch { remixOpening = false; os.toast('无法打开做同款，请重试。'); }
}

const backPath = computed(() => getCommunityWorkReturnPath(router, props.submissionId) ?? `/community/${work.value?.category === 'resource' ? 'knowledge' : work.value?.category ?? 'image'}`);
let controller: AbortController | undefined;
let loadedVersion = getCommunityUpdateVersion();

async function load() {
	const version = getCommunityUpdateVersion();
	controller?.abort();
	const current = new AbortController(); controller = current;
	work.value = null; failed.value = false; unavailable.value = false; copyFailed.value = false; commentsOpen.value = false; detailsOpen.value = false;
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

async function copyPrompt() { try { await navigator.clipboard.writeText(work.value?.generation?.prompt ?? work.value?.text ?? ''); os.toast(t.copied); copyFailed.value = false; } catch { copyFailed.value = true; } }

watch(() => props.submissionId, load, { immediate: true });
watch(communityUpdates, () => { if (active.value) void load(); });
watch(mobile, () => { commentsOpen.value = false; detailsOpen.value = false; });
onActivated(() => { active.value = true; if (loadedVersion !== getCommunityUpdateVersion()) void load(); });
onDeactivated(() => { active.value = false; commentsOpen.value = false; });
onBeforeUnmount(() => { controller?.abort(); controller = undefined; viewport.removeEventListener('change', resize); });
definePage(() => ({ title: work.value?.title ?? t.preview, icon: 'ti ti-photo', needWideArea: true }));
</script>

<style lang="scss" module>
@use './work-palette.scss';

.root { height: 100%; min-width: 0; overflow: auto; background: var(--MI_THEME-panel); color: var(--MI_THEME-fg); container-type: inline-size; }
.root :focus-visible { outline: 2px solid var(--MI_THEME-accent); outline-offset: 3px; }
.topbar { display: flex; align-items: center; gap: 24px; padding: 0 20px; min-height: 54px; border-bottom: 1px solid var(--MI_THEME-divider); box-sizing: border-box; > span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; } }
.back { display: inline-flex; align-items: center; gap: 8px; min-height: 44px; flex-shrink: 0; font-size: 13px; }
.layout { display: grid; grid-template-columns: minmax(0, 1fr) minmax(340px, 380px); height: calc(100% - 55px); min-height: 540px; }
.stage { min-width: 0; min-height: 0; }
.sidebar { min-width: 0; padding: 28px 24px; border-left: 1px solid var(--MI_THEME-divider); overflow-y: auto; scrollbar-width: thin; box-sizing: border-box; h1 { font-size: 21px; margin: 20px 0 14px; line-height: 1.45; overflow-wrap: anywhere; } }
.author { display: flex; align-items: center; gap: 10px; font-size: 14px; > div { display: flex; flex-direction: column; min-width: 0; overflow-wrap: anywhere; } span { font-size: 12px; color: var(--MI_THEME-fgTransparentWeak); } }
.avatar { flex-shrink: 0; display: grid; place-items: center; width: 42px; height: 42px; border-radius: 50%; background: var(--MI_THEME-buttonBg); font-size: 18px; font-weight: 600; }
.prompt { h2 { font-size: 12px; font-weight: 500; margin: 0 0 8px; color: var(--MI_THEME-fgTransparentWeak); } p { font-size: 14px; line-height: 1.8; white-space: pre-wrap; overflow-wrap: anywhere; margin: 0; } > button { display: flex; align-items: center; gap: 6px; min-height: 40px; margin-top: 4px; font-size: 12px; } }
.meta, .source { display: block; font-size: 12px; line-height: 1.6; margin: 10px 0; overflow-wrap: anywhere; }
.date { display: block; padding: 16px 0 12px; border-bottom: 1px solid var(--MI_THEME-divider); color: var(--MI_THEME-fgTransparentWeak); font-size: 12px; }
.remix { width: 100%; text-align: left; display: flex; align-items: center; gap: 12px; min-height: 72px; margin: 8px 0 20px; padding: 12px 16px; box-sizing: border-box; border-radius: 12px; background: var(--MI_THEME-accent); color: var(--MI_THEME-fgOnAccent); > i { font-size: 23px; } > i:last-child { margin-left: auto; font-size: 21px; } span { display: flex; flex-direction: column; gap: 2px; } strong { font-size: 16px; } small { font-size: 12px; } &:hover { filter: brightness(.94); } }
.state { display: grid; place-content: center; min-height: 60vh; text-align: center; padding: 24px; button { min-height: 44px; color: var(--MI_THEME-accent); } }
@container (max-width: 780px) { .layout { display: flex; flex-direction: column; height: auto; min-height: 0; } .stage { height: clamp(280px, 54vh, 620px); flex-shrink: 0; } .sidebar { overflow: visible; padding: 22px 18px; } .topbar { padding: 0 16px; } }

.root.mobileDetail { @include work-palette.immersive; --work-video-controls-height: 88px; position: relative; overflow: hidden; background: var(--work-stage); color: var(--work-stage-fg); container-type: normal; }
.mobileDetail.withVideo { --work-actions-inset: var(--work-video-controls-height); }
.mobileDetail :focus-visible { outline-color: var(--work-stage-fg); outline-offset: -3px; }
.topbar.mobileTopbar { position: absolute; inset: 0 0 auto; z-index: 3; min-height: 58px; padding: max(4px, env(safe-area-inset-top)) 16px 4px; border: 0; background: linear-gradient(color-mix(in srgb, var(--work-stage) 65%, transparent), transparent); color: var(--work-stage-fg); > span { font-size: 15px; font-weight: 600; } .back { width: 44px; min-height: 44px; font-size: 25px; span { display: none; } } }
.mobileStage { height: 100%; min-height: 0; }
.mobileMedia { position: absolute; inset: 0; height: 100%; transition: height 180ms ease-out; }
.caption { position: absolute; left: max(16px, env(safe-area-inset-left)); right: 86px; bottom: 28px; display: grid; gap: 7px; text-shadow: 0 1px 3px var(--work-stage); color: var(--work-stage-fg); > * { position: relative; } h1 { margin: 0; font-size: 16px; line-height: 1.5; font-weight: 500; overflow-wrap: anywhere; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; } }
.caption::before { content: ''; position: absolute; inset: -80px -86px -28px -16px; background: linear-gradient(transparent, color-mix(in srgb, var(--work-stage) 85%, transparent)); pointer-events: none; }
.caption.withVideo { bottom: calc(var(--work-video-controls-height) + 14px); }
.mobileAuthor { font-size: 18px; font-weight: 700; line-height: 1.5; overflow-wrap: anywhere; }
.description { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; overflow-wrap: anywhere; line-height: 1.6; font-size: 14px; margin: 0; }
.captionFooter { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 4px 8px; > button { display: inline-flex; align-items: center; gap: 4px; min-height: 44px; font-size: 13px; font-weight: 600; } }
.caption.expanded { max-height: calc(100% - 100px); overflow: auto; overscroll-behavior: contain; padding: 14px; left: 8px; right: 76px; background: var(--MI_THEME-panel); color: var(--MI_THEME-fg); border: 1px solid var(--MI_THEME-divider); border-radius: 12px; text-shadow: none; box-sizing: border-box; h1, .description { display: block; -webkit-line-clamp: unset; overflow: visible; } &::before { display: none; } }
.caption.expanded.withVideo { max-height: calc(100% - var(--work-video-controls-height) - 88px); }
.caption.expanded :focus-visible { outline-color: var(--MI_THEME-accent); }
.sidebar .description { display: block; -webkit-line-clamp: unset; overflow: visible; white-space: pre-wrap; }
.expandedDetails { padding-top: 8px; .date, .prompt h2 { color: var(--MI_THEME-fgTransparentWeak); } }
.mobileRemix { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; width: 52px; min-height: 64px; color: var(--work-stage-fg); text-shadow: 0 1px 3px var(--work-stage); span { display: grid; place-items: center; width: 42px; height: 42px; background: var(--MI_THEME-accent); color: var(--MI_THEME-fgOnAccent); border: 2px solid var(--MI_THEME-fgOnAccent); border-radius: 12px; text-shadow: none; } i { font-size: 25px; } strong { font-size: 12px; line-height: 1.25; white-space: nowrap; } }
.commentsOpen .mobileMedia { height: max(36dvh, calc(100dvh - 680px)); }
.commentsOpen .caption, .commentsOpen .mobileTopbar, .commentsOpen [data-testid='work-actions'] { visibility: hidden; }
@media (max-height: 580px) { .caption { bottom: 16px; gap: 3px; } .caption.withVideo { bottom: calc(var(--work-video-controls-height) + 10px); } .mobileAuthor { font-size: 15px; } .caption h1, .description { -webkit-line-clamp: 1; font-size: 13px; } }
@media (max-height: 560px) { .caption { right: 132px; } .caption.expanded { right: 122px; } .mobileRemix { min-height: 48px; span { width: 30px; height: 30px; } i { font-size: 20px; } } }
@media (prefers-reduced-motion: reduce) { .mobileMedia { transition: none; } }
</style>
