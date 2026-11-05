<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<article ref="root" :class="$style.card" data-testid="community-work-card">
	<header :class="$style.author"><MkA :to="`/@${work.author.username}`" :class="$style.avatar" aria-hidden="true" tabindex="-1">{{ (work.author.name || work.author.username).slice(0, 1) }}</MkA><div :class="$style.identity"><MkA :to="`/@${work.author.username}`"><strong>{{ work.author.name || work.author.username }}</strong></MkA><span>@{{ work.author.username }}</span></div><time :datetime="work.submittedAt">{{ new Date(work.submittedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) }}</time></header>
	<div :class="$style.content"><h3><MkA :to="workPath(work.id)">{{ work.title }}</MkA></h3><p :class="$style.excerpt"><Mfm :text="work.text" :plain="true"/></p>
		<MkA v-if="work.category !== 'resource' || cover" :to="workPath(work.id)" :class="$style.preview" :aria-label="`${t.preview}: ${work.title}`"><img v-if="cover && !failed" :src="cover" :alt="work.title" loading="lazy" decoding="async" @error="failed = true"/><span v-else :class="$style.noPreview"><i :class="work.category === 'video' ? 'ti ti-video' : 'ti ti-photo'" aria-hidden="true"></i>{{ sensitive ? t.sensitive : t.noPreview }}</span><span v-if="work.category === 'video' && cover" :class="$style.play"><i class="ti ti-player-play-filled" aria-hidden="true"></i></span></MkA>
		<div v-if="work.category === 'resource' && work.files.length" :class="$style.files"><MkA :to="workPath(work.id)"><i class="ti ti-files" aria-hidden="true"></i> {{ t.attachments }} · {{ work.files.length }} <i class="ti ti-arrow-up-right" aria-hidden="true"></i></MkA></div>
		<WorkEngagement :work="work" :viewsCount="views"/>
	</div>
</article>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import type { CommunityWork } from './types.js';
import WorkEngagement from './work-engagement.vue';
import { workText as t, workPath } from './interactions-copy.js';
import { safeWebUrl } from './copy.js';
import { useWorkView } from './use-work-view.js';

const props = defineProps<{ work: CommunityWork }>();
const root = ref<HTMLElement>();
const views = useWorkView(root, () => props.work);
const failed = ref(false);
const sensitive = computed(() => props.work.files.some(file => file.isSensitive));
const cover = computed(() => {
	if (sensitive.value) return undefined;
	const file = props.work.files.find(item => item.type.startsWith('image/') || item.type.startsWith('video/'));
	return file ? safeWebUrl(file.thumbnailUrl) ?? (file.type.startsWith('image/') ? safeWebUrl(file.url) : undefined) : undefined;
});
</script>

<style lang="scss" module>
.card { box-sizing: border-box; min-width: 0; padding: 22px 24px 12px; background: var(--MI_THEME-panel); color: var(--MI_THEME-fg); border-radius: 16px; font-size: 14px; line-height: 1.6; }
.card :focus-visible { outline: 2px solid var(--MI_THEME-accent); outline-offset: 3px; }
.author { display: flex; align-items: center; gap: 12px; margin-bottom: 10px; time { margin-left: auto; font-size: 12px; color: var(--MI_THEME-fgTransparentWeak); white-space: nowrap; } }
.avatar { flex-shrink: 0; display: grid; place-items: center; width: 42px; height: 42px; border-radius: 50%; background: var(--MI_THEME-buttonBg); font-size: 18px; font-weight: 600; }
.identity { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 8px; min-width: 0; overflow-wrap: anywhere; span { font-size: 13px; color: var(--MI_THEME-fgTransparentWeak); } }
.content { margin-left: 54px; min-width: 0; h3 { overflow-wrap: anywhere; margin: 0 0 5px; font-size: 17px; line-height: 1.5; } }
.excerpt { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 4; overflow: hidden; margin: 0 0 14px; overflow-wrap: anywhere; white-space: pre-wrap; }
.preview { position: relative; display: flex; justify-content: center; align-items: center; width: 100%; height: clamp(240px, 57vh, 640px); border-radius: 12px; overflow: hidden; background: var(--MI_THEME-bg); img { width: 100%; height: 100%; object-fit: contain; } }
.play { position: absolute; display: grid; place-items: center; width: 60px; height: 60px; border-radius: 50%; background: var(--MI_THEME-fg); color: var(--MI_THEME-panel); font-size: 24px; }
.noPreview { display: flex; flex-direction: column; align-items: center; gap: 14px; padding: 20px; i { font-size: 36px; } }
.files { padding: 14px 0; a { display: inline-flex; gap: 8px; align-items: center; color: var(--MI_THEME-accent); } }
@container (max-width: 600px) { .card { padding: 16px 14px 8px; border-radius: 12px; } .content { margin-left: 0; } .preview { height: clamp(220px, 52vh, 440px); } }
</style>
