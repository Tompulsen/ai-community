<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div :class="$style.root" :aria-busy="busy" :data-profile-activity="section">
	<div :class="$style.tools"><span><i v-if="section === 'favorites'" class="ti ti-lock" aria-hidden="true"></i>{{ section === 'favorites' ? ft.profilePrivate : section === 'likes' ? ft.profileLiked : ft.profileRecent }}</span><button type="button" class="_button" :disabled="busy" :aria-label="ft.profileRefresh" @click="load()"><i class="ti ti-refresh" aria-hidden="true"></i></button></div>
	<div v-if="entries.length" :class="$style.grid">
		<template v-for="entry in entries" :key="entry.id">
			<WorkCard v-if="entry.work && entry.note.cw == null" :work="entry.work" :data-scroll-anchor="active ? `${section}:${entry.id}` : undefined" compact profileGrid/>
			<MkA v-else :to="`/notes/${entry.note.id}`" :data-scroll-anchor="active ? `${section}:${entry.id}` : undefined" :class="$style.note" :aria-label="entry.note.cw || entry.note.text || ft.profileNotes" data-testid="profile-note-open">
				<img v-if="cover(entry.note) && !failed.has(entry.id)" :src="cover(entry.note)" alt="" loading="lazy" decoding="async" @error="failed.add(entry.id)"/>
				<div v-else :class="$style.fallback"><i :class="concealed(entry.note) ? 'ti ti-eye-off' : entry.note.files?.length ? 'ti ti-photo' : 'ti ti-align-left'" aria-hidden="true"></i><p>{{ concealed(entry.note) ? entry.note.cw || wt.sensitive : entry.note.text || wt.noPreview }}</p></div>
				<span v-if="entry.note.files?.length && !concealed(entry.note)" :class="$style.kind"><i :class="entry.note.files.some(file => file.type.startsWith('video/')) ? 'ti ti-player-play-filled' : 'ti ti-photo'" aria-hidden="true"></i><span v-if="entry.note.files.length > 1">{{ entry.note.files.length }}</span></span>
			</MkA>
		</template>
	</div>
	<p v-if="busy && !entries.length" :class="$style.state" role="status">{{ ft.loading }}</p>
	<div v-else-if="error" :class="$style.state" role="alert"><i class="ti ti-cloud-off" aria-hidden="true"></i><p>{{ ft.loadFailed }}</p><button type="button" class="_button" :disabled="busy" @click="load()">{{ ft.retry }}</button></div>
	<div v-else-if="!entries.length" :class="$style.state"><i :class="section === 'favorites' ? 'ti ti-star' : section === 'likes' ? 'ti ti-heart' : 'ti ti-notes'" aria-hidden="true"></i><p>{{ section === 'favorites' ? ft.profileNoFavorites : section === 'likes' ? ft.profileNoLikes : ft.profileNoNotes }}</p></div>
	<button v-if="paginator.canFetchOlder.value && !error" type="button" class="_button" :class="$style.more" :disabled="busy" @click="load(true)">{{ busy ? ft.loading : ct.loadMore }}</button>
</div>
</template>

<script setup lang="ts">
import { markRaw, onActivated, onBeforeUnmount, onDeactivated, onMounted, ref, shallowRef, watch } from 'vue';
import type * as Misskey from 'misskey-js';
import WorkCard from './work-card.vue';
import { feedText as ft } from './feed-copy.js';
import { workText as wt } from './interactions-copy.js';
import { communityText as ct, safeWebUrl } from './copy.js';
import type { CommunityWork } from './types.js';
import { Paginator } from '@/utility/paginator.js';
import { misskeyApi } from '@/utility/misskey-api.js';
import { prefer } from '@/preferences.js';
import { getStaticImageUrl } from '@/utility/media-proxy.js';

const props = defineProps<{ userId: string; section: 'notes' | 'favorites' | 'likes'; active: boolean }>();
const endpoint = props.section === 'favorites' ? 'i/favorites' : props.section === 'likes' ? 'users/reactions' : 'users/notes';
const paginator = markRaw(new Paginator(endpoint, {
	limit: 24, canFetchDetection: 'safe',
	params: props.section === 'favorites' ? {} : { userId: props.userId, ...(props.section === 'notes' ? { withRenotes: false, withReplies: false, withChannelNotes: false } : {}) },
}));
type Entry = { id: string; note: Misskey.entities.Note; work?: CommunityWork };
const entries = shallowRef<Entry[]>([]);
const resolved = new Map<string, CommunityWork | undefined>();
const busy = ref(false);
const error = ref(false);
const failed = ref(new Set<string>());
let disposed = false;
let needsRefresh = false;
let routeActive = true;

async function load(more = false, preserve = false) {
	if (busy.value || disposed) return;
	busy.value = true;
	error.value = false;
	try {
		const previousCount = paginator.items.value.length;
		if (more) await paginator.fetchOlder();
		else {
			resolved.clear();
			if (!preserve) entries.value = [];
			failed.value.clear();
			await paginator.init();
			// Revalidate a cached route without shortening a previously paged gallery.
			while (preserve && !disposed && !paginator.error.value && paginator.canFetchOlder.value && paginator.items.value.length < previousCount) {
				const count = paginator.items.value.length;
				await paginator.fetchOlder();
				if (count === paginator.items.value.length && paginator.canFetchOlder.value) throw new Error('Profile page unavailable');
				if (count === paginator.items.value.length) break;
			}
		}
		if (disposed) return;
		if (paginator.error.value) entries.value = [];
		if (paginator.error.value || (more && previousCount === paginator.items.value.length && paginator.canFetchOlder.value)) throw new Error('Profile page unavailable');
		// Keep the original favorite/reaction records in the paginator: their IDs own the cursor.
		const notes: Entry[] = paginator.items.value.flatMap(item => {
			if (props.section === 'likes' && (!('type' in item) || item.type.replaceAll('\uFE0F', '') !== '❤')) return [];
			const note = 'note' in item ? item.note : item;
			return note && !note.isHidden ? [{ id: item.id, note }] : [];
		});
		const ids = [...new Set(notes.map(entry => entry.note.id))].filter(id => !resolved.has(id));
		for (let offset = 0; offset < ids.length; offset += 50) {
			const noteIds = ids.slice(offset, offset + 50);
			const page = await misskeyApi('community/works', { noteIds, limit: 50 });
			if (disposed) return;
			for (const id of noteIds) resolved.set(id, undefined);
			for (const work of page.items) {
				if (work.approvedNoteId && noteIds.includes(work.approvedNoteId) && ['approved', 'published'].includes(work.status)) resolved.set(work.approvedNoteId, work);
			}
		}
		entries.value = notes.map(entry => ({ ...entry, work: resolved.get(entry.note.id) }));
	} catch {
		if (!disposed) error.value = true;
	} finally {
		if (!disposed) { busy.value = false; refreshWhenActive(); }
	}
}

function refreshWhenActive() {
	if (!needsRefresh || !routeActive || !props.active || busy.value || disposed) return;
	needsRefresh = false;
	void load(false, true);
}

function concealed(note: Misskey.entities.Note) { return note.cw != null || note.files?.some(file => file.isSensitive); }

function cover(note: Misskey.entities.Note) {
	if (concealed(note)) return undefined;
	const file = note.files?.find(item => item.type.startsWith('image/') || item.type.startsWith('video/'));
	const url = file && (safeWebUrl(file.thumbnailUrl) ?? (file.type.startsWith('image/') ? safeWebUrl(file.url) : undefined));
	return url && prefer.s.disableShowingAnimatedImages ? getStaticImageUrl(url) : url;
}

onMounted(() => { void load(); });
onDeactivated(() => { routeActive = false; needsRefresh = true; });
onActivated(() => { routeActive = true; refreshWhenActive(); });
watch(() => props.active, refreshWhenActive);
onBeforeUnmount(() => { disposed = true; });
</script>

<style lang="scss" module>
@use './work-palette.scss';
.root { min-width: 0; }
.tools { display: flex; justify-content: space-between; align-items: center; min-height: 44px; padding-inline: 14px; color: var(--MI_THEME-fgTransparentWeak); font-size: 12px; > span { display: inline-flex; align-items: center; gap: 5px; } > button { width: 44px; height: 44px; font-size: 18px; } }
.grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 2px; align-items: start; }
.note { display: block; position: relative; aspect-ratio: 3 / 4; overflow: hidden; background: var(--MI_THEME-buttonBg); > img { display: block; width: 100%; height: 100%; object-fit: cover; } &:active { opacity: .85; } }
.fallback { display: flex; flex-direction: column; justify-content: center; gap: 12px; height: 100%; padding: 14px 10px; box-sizing: border-box; i { font-size: 24px; color: var(--MI_THEME-fgTransparentWeak); } p { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 6; overflow: hidden; overflow-wrap: anywhere; margin: 0; font-size: 12px; line-height: 1.6; } }
.kind { @include work-palette.stage; position: absolute; top: 6px; right: 6px; display: flex; gap: 4px; padding: 3px 5px; border-radius: 5px; font-size: 12px; background: color-mix(in srgb, var(--work-stage) 65%, transparent); color: var(--work-stage-fg); }
.state { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; min-height: 220px; margin: 0; padding: 24px; text-align: center; color: var(--MI_THEME-fgTransparentWeak); > i { font-size: 30px; } p { margin: 0; } button { min-height: 44px; padding: 8px 20px; border-radius: 8px; color: var(--MI_THEME-accent); background: var(--MI_THEME-buttonBg); } }
.more { display: block; width: 100%; min-height: 52px; color: var(--MI_THEME-accent); }
.root :focus-visible { outline: 2px solid var(--MI_THEME-accent); outline-offset: -3px; }
</style>
