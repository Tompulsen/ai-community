<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<article ref="root" :class="$style.card" :data-motion="prefer.s.animation" data-testid="community-work-card">
	<WorkEngagement :work="work" :viewsCount="views" previewComments>
	<header :class="$style.author"><MkA :to="`/@${work.author.username}`" :class="$style.avatar" aria-hidden="true" tabindex="-1">{{ (work.author.name || work.author.username).slice(0, 1) }}</MkA><div :class="$style.identity"><MkA :to="`/@${work.author.username}`"><strong>{{ work.author.name || work.author.username }}</strong></MkA><span>@{{ work.author.username }}</span></div><time :datetime="work.submittedAt">{{ new Date(work.submittedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) }}</time><slot name="actions"></slot></header>
	<div :class="$style.content"><h3><MkA :to="workPath(work.id)">{{ work.title }}</MkA></h3><p :class="$style.excerpt"><Mfm :text="work.text" :plain="true"/></p>
		<WorkVideo v-if="previewVideo" :workId="work.id" :title="work.title" :url="previewVideo.url" :poster="cover"/>
		<MkA v-else-if="work.category !== 'resource' || cover" :to="workPath(work.id)" :class="$style.preview" :aria-label="`${t.preview}: ${work.title}`"><img v-if="cover && !failed" :src="cover" :alt="work.title" loading="lazy" decoding="async" @error="failed = true"/><span v-else :class="$style.noPreview"><i :class="work.category === 'video' ? 'ti ti-video' : 'ti ti-photo'" aria-hidden="true"></i>{{ sensitive ? t.sensitive : t.noPreview }}</span><span :class="$style.previewAction" aria-hidden="true">{{ t.preview }}<i class="ti ti-arrow-up-right"></i></span></MkA>
		<div v-if="work.category === 'resource' && work.files.length" :class="$style.files"><MkA :to="workPath(work.id)"><i class="ti ti-files" aria-hidden="true"></i> {{ t.attachments }} · {{ work.files.length }} <i class="ti ti-arrow-up-right" aria-hidden="true"></i></MkA></div>
	</div>
	</WorkEngagement>
</article>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { CommunityWork } from './types.js';
import WorkEngagement from './work-engagement.vue';
import WorkVideo from './work-video.vue';
import { workText as t, workPath } from './interactions-copy.js';
import { safeWebUrl } from './copy.js';
import { useWorkView } from './use-work-view.js';
import { prefer } from '@/preferences.js';

const props = defineProps<{ work: CommunityWork }>();
const root = ref<HTMLElement>();
const views = useWorkView(root, () => props.work);
const failed = ref(false);
const sensitive = computed(() => props.work.files.some(file => file.isSensitive));
const previewVideo = computed(() => sensitive.value ? undefined : props.work.files.find(file => file.type.startsWith('video/') && safeWebUrl(file.url)));
const cover = computed(() => {
	if (sensitive.value) return undefined;
	const file = previewVideo.value ?? props.work.files.find(item => item.type.startsWith('image/') || item.type.startsWith('video/'));
	return file ? safeWebUrl(file.thumbnailUrl) ?? (file.type.startsWith('image/') ? safeWebUrl(file.url) : undefined) : undefined;
});
watch(cover, () => { failed.value = false; });
</script>

<style lang="scss" module>
.card { box-sizing: border-box; min-width: 0; padding: 22px 24px 12px; border: 1px solid var(--MI_THEME-divider); background: var(--MI_THEME-panel); color: var(--MI_THEME-fg); border-radius: var(--community-radius, 12px); font-size: 14px; line-height: 1.6; container-type: inline-size; }
.card :focus-visible { outline: 2px solid var(--MI_THEME-accent); outline-offset: 3px; }
.author { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; margin-bottom: 18px; time { margin-left: auto; font-size: 12px; color: var(--MI_THEME-fgTransparentWeak); white-space: nowrap; } }
.avatar { flex-shrink: 0; display: grid; place-items: center; width: 42px; height: 42px; border-radius: 50%; background: var(--MI_THEME-buttonBg); font-size: 18px; font-weight: 600; }
.identity { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 8px; min-width: 0; overflow-wrap: anywhere; span { font-size: 13px; color: var(--MI_THEME-fgTransparentWeak); } }
.content { margin-left: 0; min-width: 0; h3 { overflow-wrap: anywhere; margin: 0 0 5px; font-size: 17px; line-height: 1.5; } }
.excerpt { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 4; overflow: hidden; margin: 0 0 14px; overflow-wrap: anywhere; white-space: pre-wrap; }
.preview { position: relative; display: flex; justify-content: center; align-items: center; width: 100%; aspect-ratio: 16 / 10; max-height: 560px; border-radius: 12px; overflow: hidden; background: var(--community-stage, var(--MI_THEME-bg)); color: var(--community-stage-fg, var(--MI_THEME-fg)); img { width: 100%; height: 100%; object-fit: contain; } }
.noPreview { display: flex; flex-direction: column; align-items: center; gap: 14px; padding: 20px; i { font-size: 36px; } }
.files { padding: 14px 0; a { display: inline-flex; gap: 8px; align-items: center; color: var(--MI_THEME-accent); } }
.card { transition: border-color 200ms ease; &:focus-within { border-color: var(--MI_THEME-accent); } }
.previewAction { position: absolute; right: 14px; bottom: 14px; display: flex; align-items: center; gap: 12px; padding: 9px 12px; border-radius: 8px; background: var(--MI_THEME-panel); color: var(--MI_THEME-fg); font-size: 12px; font-weight: 600; opacity: 0; transform: translateY(8px); transition: opacity 180ms, transform 280ms var(--community-ease, ease-out); i { font-size: 18px; } }
.preview:is(:hover, :focus-visible) .previewAction { opacity: 1; transform: translateY(0); }
@media (hover: hover) and (pointer: fine) { .card:hover { border-color: color-mix(in srgb, var(--MI_THEME-accent) 35%, var(--MI_THEME-divider)); } }
@media (hover: none) { .previewAction { opacity: 1; transform: none; } }
.card[data-motion='false'] { &, .previewAction { transition: none; } }
@media (prefers-reduced-motion: reduce) { .card, .previewAction { transition: none; } }
@container (max-width: 600px) { .card { padding: 16px 14px 8px; border-radius: 12px; } .content { margin-left: 0; } }
</style>
