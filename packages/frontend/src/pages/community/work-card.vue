<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<article ref="root" :data-scroll-anchor="work.id" :class="[$style.card, { [$style.compact]: compact, [$style.wide]: compact && wideCover }]" :data-motion="prefer.s.animation" data-testid="community-work-card">
	<template v-if="compact">
		<MkA :to="workPath(work.id)" :class="$style.compactPreview" :style="{ aspectRatio: compactAspect }" :aria-label="`${t.preview}: ${work.title}`" data-testid="gallery-work-open">
			<img v-if="cover && !failed" :src="cover" :alt="work.title" loading="lazy" decoding="async" @error="failed = true"/>
			<div v-else :class="$style.compactFallback"><i :class="sensitive ? 'ti ti-eye-off' : work.category === 'resource' ? 'ti ti-file-text' : work.category === 'video' ? 'ti ti-player-play' : 'ti ti-photo'" aria-hidden="true"></i><p v-if="work.category === 'resource' && !sensitive">{{ excerpt || work.title }}</p><span v-else>{{ sensitive ? t.sensitive : t.noPreview }}</span></div>
			<span v-if="!sensitive" :class="$style.mediaKind"><i :class="work.category === 'video' ? 'ti ti-player-play-filled' : work.category === 'resource' ? 'ti ti-file-text' : 'ti ti-photo'" aria-hidden="true"></i><span v-if="work.files.length > 1">{{ work.files.length }}</span></span>
		</MkA>
		<h3 :class="$style.compactTitle"><MkA :to="workPath(work.id)">{{ work.title }}</MkA></h3>
		<div :class="$style.compactMeta"><MkA :to="`/@${work.author.username}`" :aria-label="`${ft.viewProfile}: ${work.author.name || work.author.username}`"><span :class="$style.compactAvatar" aria-hidden="true">{{ (work.author.name || work.author.username).slice(0, 1) }}</span><span>{{ work.author.name || work.author.username }}</span></MkA><span :aria-label="`${t.like} ${work.likesCount ?? '—'}`"><i class="ti ti-heart" aria-hidden="true"></i>{{ work.likesCount == null ? '—' : new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(work.likesCount) }}</span></div>
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

const props = defineProps<{ work: CommunityWork; compact?: boolean }>();
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
const coverRatio = computed(() => {
	const file = previewVideo.value ?? props.work.files.find(item => item.type.startsWith('image/'));
	const width = file?.properties?.width, height = file?.properties?.height;
	return typeof width === 'number' && typeof height === 'number' && Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0 ? width / height : 3 / 4;
});
const wideCover = computed(() => !!cover.value && coverRatio.value >= 1.7);
const compactAspect = computed(() => wideCover.value ? '16 / 9' : String(Math.max(.7, Math.min(1.3, coverRatio.value))));
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

.card.compact { @include work-palette.immersive; padding: 0; border: 0; border-radius: 0; background: transparent; color: var(--work-stage-fg); container-type: normal; align-self: start; }
.compact.wide { grid-column: 1 / -1; }
.compact :focus-visible { outline-color: var(--work-stage-fg); outline-offset: -2px; }
.compactPreview { position: relative; display: block; width: 100%; overflow: hidden; border-radius: 8px; background: var(--work-stage-border); aspect-ratio: 3 / 4; img { display: block; width: 100%; height: 100%; object-fit: cover; } }
.compactPreview:active { opacity: .85; }
.compactFallback { display: flex; height: 100%; padding: 18px 14px; box-sizing: border-box; flex-direction: column; justify-content: center; gap: 12px; color: var(--work-stage-muted); > i { font-size: 26px; } p { color: var(--work-stage-fg); display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 7; margin: 0; font-size: 14px; line-height: 1.65; overflow: hidden; overflow-wrap: anywhere; } > span { font-size: 12px; } }
.mediaKind { position: absolute; bottom: 7px; right: 8px; display: inline-flex; gap: 4px; align-items: center; font-size: 12px; color: var(--work-stage-fg); text-shadow: 0 1px 3px var(--work-stage); }
.compactTitle { margin: 6px 1px 0; font-size: 14px; font-weight: 500; line-height: 1.5; a { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; overflow-wrap: anywhere; } }
.compactMeta { display: flex; align-items: center; justify-content: space-between; gap: 6px; min-height: 36px; margin-inline: 1px; color: var(--work-stage-muted); font-size: 12px; font-variant-numeric: tabular-nums; > a { display: flex; min-width: 0; align-items: center; gap: 5px; min-height: 36px; > span:last-child { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; } } > span { display: inline-flex; flex: 0 0 auto; align-items: center; gap: 3px; } }
.compactAvatar { display: grid; flex: 0 0 auto; place-items: center; width: 18px; height: 18px; border-radius: 50%; background: var(--work-stage-border); color: var(--work-stage-fg); font-size: 10px; }
</style>
