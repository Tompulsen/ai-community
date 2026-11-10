<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<article ref="root" :data-scroll-anchor="work.id" :class="[$style.card, { [$style.compact]: compact, [$style.profileGrid]: profileGrid, [$style.gallery]: gallery, [$style.featured]: featured }]" :data-motion="prefer.s.animation" :data-featured="featured || undefined" data-testid="community-work-card">
	<template v-if="compact">
		<MkA :to="workPath(work.id)" :class="$style.compactPreview" :aria-label="`${t.preview}: ${work.title}`" data-testid="gallery-work-open">
			<img v-if="cover && !failed" :src="cover" :alt="work.title" loading="lazy" decoding="async" @error="failed = true"/>
			<div v-else :class="$style.compactFallback"><i :class="sensitive ? 'ti ti-eye-off' : work.category === 'resource' ? 'ti ti-file-text' : work.category === 'video' ? 'ti ti-player-play' : 'ti ti-photo'" aria-hidden="true"></i><p v-if="work.category === 'resource' && !sensitive">{{ excerpt || work.title }}</p><span v-else>{{ sensitive ? t.sensitive : t.noPreview }}</span></div>
			<span v-if="!sensitive" :class="$style.mediaKind"><i :class="work.category === 'video' ? 'ti ti-player-play-filled' : work.category === 'resource' ? 'ti ti-file-text' : 'ti ti-photo'" aria-hidden="true"></i><span v-if="work.files.length > 1">{{ work.files.length }}</span></span>
			<span v-if="profileGrid && work.likesCount != null" :class="$style.profileMetrics"><i class="ti ti-heart" aria-hidden="true"></i>{{ new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(work.likesCount) }}</span>
			<span v-if="gallery" :class="$style.galleryStats"><span v-if="work.likesCount != null" :aria-label="`${t.like} ${work.likesCount}`"><i class="ti ti-heart" aria-hidden="true"></i>{{ formatCount(work.likesCount) }}</span><span :aria-label="`${t.comments} ${work.repliesCount}`"><i class="ti ti-message-circle" aria-hidden="true"></i>{{ formatCount(work.repliesCount) }}</span></span>
			<span v-if="featured" :class="$style.featureLabel">{{ ft.newShare }}<i class="ti ti-arrow-up-right" aria-hidden="true"></i></span>
		</MkA>
		<h3 v-if="!profileGrid" :class="$style.compactTitle"><MkA :to="workPath(work.id)">{{ work.title }}</MkA></h3>
		<div v-if="!profileGrid" :class="$style.compactMeta"><MkA :to="`/@${work.author.username}`" :aria-label="`${ft.viewProfile}: ${work.author.name || work.author.username}`"><span :class="$style.compactAvatar" aria-hidden="true">{{ (work.author.name || work.author.username).slice(0, 1) }}</span><span>{{ work.author.name || work.author.username }}</span></MkA><time v-if="gallery" :datetime="work.submittedAt">{{ new Date(work.submittedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) }}</time><span v-else :aria-label="`${t.like} ${work.likesCount ?? '—'}`"><i class="ti ti-heart" aria-hidden="true"></i>{{ work.likesCount == null ? '—' : formatCount(work.likesCount) }}</span></div>
		<div v-if="gallery && $slots.actions" :class="$style.compactActions"><slot name="actions"></slot></div>
	</template>
	<WorkEngagement v-else :work="work" :viewsCount="views" previewComments>
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

const props = defineProps<{ work: CommunityWork; compact?: boolean; profileGrid?: boolean; gallery?: boolean; featured?: boolean }>();
const formatCount = (value: number) => new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(value);
const root = ref<HTMLElement>();
const views = useWorkView(root, () => props.compact ? null : props.work);
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

.card.compact { padding: 0; border: 1px solid var(--MI_THEME-divider); border-radius: 12px; background: var(--MI_THEME-panel); color: var(--MI_THEME-fg); container-type: normal; align-self: start; }
.compact :focus-visible { outline-color: var(--MI_THEME-accent); outline-offset: -2px; }
.compactPreview { position: relative; display: block; width: 100%; overflow: hidden; border-radius: 11px 11px 0 0; background: var(--MI_THEME-buttonBg); aspect-ratio: 3 / 4; img { display: block; width: 100%; height: 100%; object-fit: cover; } }
.compactPreview:active { opacity: .85; }
.compactFallback { display: flex; height: 100%; padding: 18px 14px; box-sizing: border-box; flex-direction: column; justify-content: center; gap: 12px; color: var(--MI_THEME-fgTransparentWeak); > i { font-size: 26px; } p { color: var(--MI_THEME-fg); display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 7; margin: 0; font-size: 14px; line-height: 1.65; overflow: hidden; overflow-wrap: anywhere; } > span { font-size: 12px; } }
.mediaKind { @include work-palette.stage; position: absolute; bottom: 7px; right: 8px; display: inline-flex; gap: 4px; align-items: center; padding: 3px 5px; border-radius: 5px; font-size: 12px; color: var(--work-stage-fg); background: color-mix(in srgb, var(--work-stage) 65%, transparent); }
.compactTitle { min-height: 3em; margin: 8px 9px 0; font-size: 14px; font-weight: 600; line-height: 1.5; a { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; overflow-wrap: anywhere; } }
.compactMeta { display: flex; align-items: center; justify-content: space-between; gap: 6px; min-height: 36px; margin: 2px 9px 4px; color: var(--work-muted); font-size: 12px; font-variant-numeric: tabular-nums; > a { display: flex; min-width: 0; align-items: center; gap: 5px; min-height: 36px; > span:last-child { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; } } > span { display: inline-flex; flex: 0 0 auto; align-items: center; gap: 3px; } }
.compactAvatar { display: grid; flex: 0 0 auto; place-items: center; width: 18px; height: 18px; border-radius: 50%; background: var(--MI_THEME-buttonBg); color: var(--MI_THEME-fg); font-size: 10px; }
.card.profileGrid { border: 0; border-radius: 0; }
.profileGrid .compactPreview { border-radius: 0; }
.profileGrid .mediaKind { top: 6px; bottom: auto; right: 6px; }
.profileMetrics { @include work-palette.stage; position: absolute; bottom: 0; inset-inline: 0; display: flex; align-items: center; gap: 4px; padding: 20px 8px 6px; background: linear-gradient(transparent, color-mix(in srgb, var(--work-stage) 75%, transparent)); color: var(--work-stage-fg); font-size: 12px; pointer-events: none; }

.card.gallery { align-self: stretch; border: 0; border-radius: 10px; background: transparent; }
.gallery .compactPreview { aspect-ratio: 16 / 9; border-radius: 10px; isolation: isolate; img { transition: transform 250ms ease; } }
.gallery .compactTitle { margin: 10px 0 0; font-size: 15px; font-weight: 600; }
.gallery .compactMeta { margin: 2px 0 0; gap: 12px; time { flex: 0 0 auto; font-size: 12px; white-space: nowrap; } }
.gallery .compactFallback { padding: 16px 16px 40px; gap: 6px; background: var(--MI_THEME-panel); border: 1px solid var(--MI_THEME-divider); border-radius: 10px; > i { font-size: 22px; } p { -webkit-line-clamp: 2; font-size: 13px; } }
.gallery .mediaKind { top: 10px; bottom: auto; right: 10px; }
.galleryStats { @include work-palette.stage; position: absolute; bottom: 0; inset-inline: 0; display: flex; align-items: center; gap: 14px; padding: 26px 12px 9px; background: linear-gradient(transparent, color-mix(in srgb, var(--work-stage) 80%, transparent)); color: var(--work-stage-fg); font-size: 12px; pointer-events: none; > span { display: inline-flex; align-items: center; gap: 5px; } i { font-size: 15px; } }
.compactActions { padding-top: 4px; }
.featureLabel { display: none; }
@container community-feed (min-width: 1100px) {
	.gallery.featured { @include work-palette.stage; position: relative; display: flex; flex-direction: column; grid-column: span 2; grid-row: span 2; overflow: hidden; background: var(--work-stage); color: var(--work-stage-fg); }
	.featured .compactPreview { position: absolute; inset: 0; height: 100%; aspect-ratio: auto; border-radius: inherit; &::after { content: ''; position: absolute; inset: 35% 0 0; background: linear-gradient(transparent, color-mix(in srgb, var(--work-stage) 96%, transparent)); pointer-events: none; } }
	.featured .compactFallback { justify-content: flex-start; padding: 70px 24px 130px; background: var(--work-stage); color: var(--work-stage-fg); border: 0; p { color: inherit; -webkit-line-clamp: 6; } }
	.featured .featureLabel { position: absolute; inset: 20px 20px auto; display: flex; align-items: center; justify-content: space-between; color: var(--work-stage-fg); font-size: 12px; font-weight: 600; text-shadow: 0 1px 4px var(--work-stage); i { display: grid; place-items: center; width: 32px; height: 32px; border-radius: 50%; background: color-mix(in srgb, var(--work-stage) 55%, transparent); font-size: 20px; } }
	.featured .compactTitle { position: relative; z-index: 1; margin: auto 24px 0; padding-top: 100px; min-height: 0; font-size: clamp(20px, 1.7vw, 28px); font-weight: 650; a { color: inherit; } }
	.featured .compactMeta { position: relative; z-index: 1; margin: 8px 24px 20px; color: var(--work-stage-fg); }
	.featured .compactAvatar { background: color-mix(in srgb, var(--work-stage-fg) 16%, transparent); color: inherit; }
	.featured .galleryStats, .featured .mediaKind { display: none; }
}
@media (hover: hover) { .gallery .compactPreview:hover img { transform: scale(1.035); } .gallery .compactTitle a:hover, .gallery .compactMeta a:hover { color: var(--MI_THEME-accent); } .featured .compactTitle a:hover, .featured .compactMeta a:hover { color: inherit; text-decoration: underline; } }
.card[data-motion='false'] .compactPreview img { transition: none; transform: none; }
@media (prefers-reduced-motion: reduce) { .gallery .compactPreview img { transition: none; transform: none !important; } }
</style>
