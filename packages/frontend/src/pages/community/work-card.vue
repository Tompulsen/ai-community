<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<article ref="root" :data-scroll-anchor="work.id" :class="[$style.card, { [$style.immersive]: immersive }]" :data-motion="prefer.s.animation" data-testid="community-work-card">
	<WorkEngagement :key="immersive ? 'immersive' : 'standard'" :work="work" :viewsCount="views" :previewComments="!immersive" :immersive="immersive" @discussionChange="commentsOpen = $event">
		<template v-if="immersive" #beforeActions><MkA :to="`/@${work.author.username}`" :class="$style.mobileAvatar" :aria-label="`${ft.viewProfile}: ${work.author.name || work.author.username}`">{{ (work.author.name || work.author.username).slice(0, 1) }}<i class="ti ti-user" aria-hidden="true"></i></MkA></template>
		<template v-if="immersive">
			<div :class="$style.mobileMedia">
				<WorkVideo v-if="previewVideo" :workId="work.id" :title="work.title" :url="previewVideo.url" :poster="cover" immersive :suspended="suspended || commentsOpen"/>
				<MkA v-else-if="cover && !failed" :to="workPath(work.id)" :class="$style.mobileImage" :aria-label="`${t.preview}: ${work.title}`"><img :src="cover" :alt="work.title" loading="lazy" decoding="async" @error="failed = true"/></MkA>
				<div v-else :class="$style.mobileText"><i :class="sensitive ? 'ti ti-eye-off' : work.category === 'resource' ? 'ti ti-file-text' : 'ti ti-photo'" aria-hidden="true"></i><h2>{{ sensitive ? t.sensitive : work.title }}</h2><p v-if="!sensitive">{{ excerpt || t.noPreview }}</p><MkA :to="workPath(work.id)">{{ ft.mobileDetails }}<i class="ti ti-arrow-up-right" aria-hidden="true"></i></MkA></div>
			</div>
			<div :class="$style.mobileCaption">
				<MkA :to="`/@${work.author.username}`" :class="$style.mobileAuthor">@{{ work.author.name || work.author.username }}</MkA>
				<MkA :to="workPath(work.id)" :class="$style.mobileDescription">{{ excerpt || work.title }}</MkA>
				<WorkTags :tags="work.tags"/>
				<MkA :to="workPath(work.id)" :class="$style.mobileDetail"><i class="ti ti-sparkles" aria-hidden="true"></i><span>{{ work.model || ft.mobileDetails }}</span><i class="ti ti-chevron-right" aria-hidden="true"></i></MkA>
			</div>
		</template>
		<template v-else>
		<header :class="$style.author"><MkA :to="`/@${work.author.username}`" :class="$style.avatar" aria-hidden="true" tabindex="-1">{{ (work.author.name || work.author.username).slice(0, 1) }}</MkA><div :class="$style.identity"><MkA :to="`/@${work.author.username}`"><strong>{{ work.author.name || work.author.username }}</strong></MkA><span>@{{ work.author.username }}</span></div><time :datetime="work.submittedAt">{{ new Date(work.submittedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) }}</time><div v-if="$slots.actions" :class="$style.authorActions"><slot name="actions"></slot></div></header>
		<div :class="$style.content">
			<h3><MkA :to="workPath(work.id)">{{ work.title }}</MkA></h3><p v-if="excerpt" :class="$style.excerpt"><Mfm :text="excerpt" :plain="true"/></p>
			<WorkTags :tags="work.tags"/>
			<div :class="[$style.mediaLayout, { [$style.withMaterials]: work.files.length > 1 || work.referenceFiles?.length }]">
				<div :class="$style.mainMedia">
					<WorkVideo v-if="previewVideo" :workId="work.id" :title="work.title" :url="previewVideo.url" :poster="cover"/>
					<MkA v-else-if="work.category !== 'resource' || cover" :to="workPath(work.id)" :class="$style.preview" :style="{ aspectRatio: previewAspect }" :aria-label="`${t.preview}: ${work.title}`"><img v-if="cover && !failed" :src="cover" :alt="work.title" loading="lazy" decoding="async" @error="failed = true"/><span v-else :class="$style.noPreview"><i :class="work.category === 'video' ? 'ti ti-video' : 'ti ti-photo'" aria-hidden="true"></i>{{ sensitive ? t.sensitive : t.noPreview }}</span><span :class="$style.previewAction" aria-hidden="true">{{ t.preview }}<i class="ti ti-arrow-up-right"></i></span></MkA>
				</div>
				<WorkMaterials :work="work"/>
			</div>
			<div v-if="work.category === 'resource' && work.files.length" :class="$style.files"><MkA :to="workPath(work.id)"><i class="ti ti-files" aria-hidden="true"></i> {{ t.attachments }} · {{ work.files.length }} <i class="ti ti-arrow-up-right" aria-hidden="true"></i></MkA></div>
		</div>
		</template>
	</WorkEngagement>
</article>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { feedText as ft } from './feed-copy.js';
import WorkEngagement from './work-engagement.vue';
import WorkTags from './work-tags.vue';
import WorkVideo from './work-video.vue';
import WorkMaterials from './work-materials.vue';
import { workText as t, workPath } from './interactions-copy.js';
import { safeWebUrl } from './copy.js';
import { useWorkView } from './use-work-view.js';
import type { CommunityWork } from './types.js';
import { prefer } from '@/preferences.js';

const props = defineProps<{ work: CommunityWork; immersive?: boolean; suspended?: boolean }>();
const commentsOpen = ref(false);
const root = ref<HTMLElement>();
const views = useWorkView(root, () => props.work);
const failed = ref(false);
const excerpt = computed(() => {
	const text = props.work.text.trim();
	return text.replace(/\s+/g, ' ') === props.work.title.trim().replace(/\s+/g, ' ') ? '' : text;
});
const sensitive = computed(() => props.work.files.some(file => file.isSensitive));
const previewVideo = computed(() => sensitive.value ? undefined : props.work.files.find(file => file.type.startsWith('video/') && safeWebUrl(file.url)));
const cover = computed(() => {
	if (sensitive.value) return undefined;
	const file = previewVideo.value ?? props.work.files.find(item => item.type.startsWith('image/') || item.type.startsWith('video/'));
	if (props.immersive && !prefer.s.dataSaver.media && file?.type.startsWith('image/')) return safeWebUrl(file.url) ?? safeWebUrl(file.thumbnailUrl);
	return file ? safeWebUrl(file.thumbnailUrl) ?? (file.type.startsWith('image/') ? safeWebUrl(file.url) : undefined) : undefined;
});
const previewAspect = computed(() => {
	if (!cover.value || failed.value) return undefined;
	const file = props.work.files.find(item => item.type.startsWith('image/') || item.type.startsWith('video/'));
	const width = file?.properties?.width, height = file?.properties?.height;
	return typeof width === 'number' && typeof height === 'number' && Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0 ? `${width} / ${height}` : undefined;
});
watch(cover, () => { failed.value = false; });
</script>

<style lang="scss" module>
@use './work-palette.scss';
.card { --work-muted: color-mix(in srgb, var(--MI_THEME-fg) 72%, var(--MI_THEME-panel)); box-sizing: border-box; min-width: 0; padding: 20px 20px 12px; border: 1px solid var(--MI_THEME-divider); background: var(--MI_THEME-panel); color: var(--MI_THEME-fg); border-radius: var(--community-radius, 12px); font-size: 14px; line-height: 1.6; container-type: inline-size; }
.card :focus-visible { outline: 2px solid var(--MI_THEME-accent); outline-offset: 3px; }
.author { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; margin-bottom: 16px; time { margin-left: auto; font-size: 12px; color: var(--work-muted); white-space: nowrap; } }
.avatar { flex-shrink: 0; display: grid; place-items: center; width: 40px; height: 40px; border-radius: 50%; background: var(--MI_THEME-buttonBg); font-size: 18px; font-weight: 600; }
.identity { display: flex; flex: 1; flex-direction: column; align-items: flex-start; gap: 0; min-width: 0; > a, > span { display: block; min-width: 0; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } strong { font-size: 13px; font-weight: 600; } span { font-size: 12px; color: var(--work-muted); } }
.authorActions { display: flex; min-width: 0; flex-wrap: wrap; margin-left: auto; }
.content { margin-left: 0; min-width: 0; container-type: inline-size; h3 { overflow-wrap: anywhere; margin: 0 0 8px; font-size: 18px; line-height: 1.5; font-weight: 650; } h3 a { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; } }
.excerpt { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; margin: 0 0 16px; overflow-wrap: anywhere; white-space: pre-wrap; color: color-mix(in srgb, var(--MI_THEME-fg) 82%, var(--MI_THEME-panel)); font-size: 14px; line-height: 1.65; }
.mediaLayout { display: grid; gap: 12px; min-width: 0; }
.mainMedia { min-width: 0; }
@container (min-width: 600px) { .withMaterials { grid-template-columns: minmax(0, 1fr) 148px; align-items: start; } }
.preview { position: relative; display: flex; justify-content: center; align-items: center; width: 100%; aspect-ratio: 16 / 10; min-height: 120px; max-height: min(480px, 54svh); border-radius: 8px; overflow: hidden; background: var(--MI_THEME-bg); color: var(--MI_THEME-fg); img { width: 100%; height: 100%; object-fit: contain; } }
.noPreview { display: flex; flex-direction: column; align-items: center; gap: 14px; padding: 20px; i { font-size: 36px; } }
.files { padding: 14px 0; a { display: inline-flex; gap: 8px; align-items: center; color: var(--MI_THEME-accent); } }
.previewAction { position: absolute; right: 14px; bottom: 14px; display: flex; align-items: center; gap: 12px; padding: 9px 12px; border-radius: 8px; background: var(--MI_THEME-panel); color: var(--MI_THEME-fg); font-size: 12px; font-weight: 600; opacity: 0; transform: translateY(8px); transition: opacity 180ms, transform 280ms var(--community-ease, ease-out); i { font-size: 18px; } }
.preview:is(:hover, :focus-visible) .previewAction { opacity: 1; transform: translateY(0); }
@media (hover: none) { .previewAction { opacity: 1; transform: none; } }
.card[data-motion='false'] { &, .previewAction { transition: none; } }
@media (prefers-reduced-motion: reduce) { .card, .previewAction { transition: none; } }
@container (max-width: 600px) { .card { padding: 16px 14px 8px; border-radius: 12px; } .content { margin-left: 0; } .author { gap: 8px; } .authorActions { flex-basis: 100%; justify-content: flex-end; } .identity { flex-direction: column; align-items: flex-start; gap: 0; } .author time { flex-shrink: 0; } }

.card.immersive { @include work-palette.immersive; position: relative; height: var(--mobile-feed-height); min-height: 280px; padding: 0; border: 0; border-radius: 0; background: var(--work-stage); color: var(--work-stage-fg); scroll-snap-align: start; scroll-snap-stop: always; overflow: clip; container-type: normal; }
.mobileMedia { position: absolute; inset: 0; }
.mobileImage { display: block; width: 100%; height: 100%; img { display: block; width: 100%; height: 100%; object-fit: contain; } }
.mobileCaption { position: absolute; bottom: 66px; left: max(16px, env(safe-area-inset-left)); right: 82px; display: grid; gap: 7px; color: var(--work-stage-fg); text-shadow: 0 1px 3px var(--work-stage); }
.mobileCaption::before { content: ''; position: absolute; inset: -72px -82px -66px -16px; background: linear-gradient(transparent, color-mix(in srgb, var(--work-stage) 78%, transparent)); pointer-events: none; }
.mobileCaption > * { position: relative; }
.mobileAuthor { font-weight: 700; font-size: 17px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding-block: 5px; }
.mobileDescription { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; overflow-wrap: anywhere; line-height: 1.55; font-size: 14px; }
.mobileDetail { display: flex; align-items: center; gap: 7px; min-height: 28px; font-size: 12px; span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } }
.mobileAvatar { position: relative; display: grid; place-items: center; width: 44px; height: 44px; margin: 0 auto 12px; box-sizing: border-box; border: 2px solid var(--work-stage-fg); border-radius: 50%; background: var(--work-stage-border); font-size: 20px; font-weight: 600; text-shadow: none; i { position: absolute; bottom: -9px; right: -1px; display: grid; place-items: center; width: 20px; height: 20px; border-radius: 50%; background: var(--work-stage-accent); color: var(--work-stage-fg); font-size: 12px; } }
.mobileText { position: absolute; inset: 84px 80px 210px 24px; overflow: hidden; display: flex; flex-direction: column; justify-content: center; align-items: flex-start; gap: 12px; > i { color: var(--work-stage-muted); font-size: 30px; } h2 { font-size: 25px; line-height: 1.4; margin: 0; overflow-wrap: anywhere; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; } p { margin: 0; color: var(--work-stage-muted); line-height: 1.8; overflow-wrap: anywhere; display: -webkit-box; -webkit-line-clamp: 5; -webkit-box-orient: vertical; overflow: hidden; } a { display: inline-flex; align-items: center; gap: 8px; min-height: 44px; font-size: 13px; text-decoration: underline; } }
@media (max-height: 580px) { .mobileCaption { bottom: 58px; } .mobileText { inset-block: 70px 170px; } .mobileText p { -webkit-line-clamp: 2; } }
@media (max-height: 500px) { .mobileCaption { right: 120px; bottom: 58px; gap: 2px; } .mobileAuthor { font-size: 15px; } .mobileDescription { -webkit-line-clamp: 1; font-size: 13px; } .mobileText { right: 120px; bottom: 155px; } .mobileText h2 { font-size: 18px; -webkit-line-clamp: 2; } .mobileText p { display: none; } }
</style>
