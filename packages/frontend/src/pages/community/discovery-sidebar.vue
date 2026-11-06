<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<aside :class="$style.sidebar" :aria-label="t.sidebar" data-testid="community-discovery">
	<section :class="$style.module">
		<h2 :id="searchId">{{ t.search }}</h2>
		<form :class="$style.search" role="search" :aria-labelledby="searchId" @submit.prevent="emit('search')">
			<div :class="$style.searchField">
				<i class="ti ti-search" aria-hidden="true"></i>
				<input v-model="query" type="search" :aria-label="t.search" :placeholder="t.searchPlaceholder" maxlength="200"/>
				<button v-if="query" type="button" class="_button" :class="$style.clear" :aria-label="t.clearSearch" @click="clearSearch"><i class="ti ti-x" aria-hidden="true"></i></button>
			</div>
			<button type="submit" class="_button" :class="$style.searchButton">{{ t.searchAction }}</button>
		</form>
	</section>
	<button type="button" class="_button" :class="$style.disclosure" :aria-expanded="expanded" :aria-controls="discoveryId" @click="expanded = !expanded"><span>{{ expanded ? t.hideDiscovery : t.showDiscovery }}</span><i :class="expanded ? 'ti ti-chevron-up' : 'ti ti-chevron-down'" aria-hidden="true"></i></button>
	<div :id="discoveryId" :class="[$style.sections, { [$style.expanded]: expanded }]">
		<section :class="$style.module" :aria-labelledby="announcementsId" :aria-busy="announcementsLoading">
			<header :class="$style.heading"><h2 :id="announcementsId">{{ t.announcements }}</h2><a href="/announcements" @click.prevent="emit('navigate', '/announcements')">{{ t.allAnnouncements }}<i class="ti ti-arrow-up-right" aria-hidden="true"></i></a></header>
			<p v-if="announcementsLoading && !announcements.length" :class="$style.message" role="status">{{ t.loading }}</p>
			<div v-else-if="announcementsFailed" :class="$style.message" role="alert"><p>{{ t.loadFailed }}</p><button type="button" class="_button" :class="$style.retry" @click="loadAnnouncements">{{ t.retry }}</button></div>
			<ul v-else-if="announcements.length" :class="$style.announcements">
				<li v-for="announcement in announcements" :key="announcement.id"><a :href="`/announcements/${announcement.id}`" @click.prevent="emit('navigate', `/announcements/${announcement.id}`)"><time :datetime="announcement.createdAt">{{ formatDate(announcement.createdAt) }}</time><h3>{{ announcement.title }}</h3><p><Mfm :text="announcement.text" :plain="true"/></p></a></li>
			</ul>
			<p v-else :class="$style.message">{{ t.noAnnouncements }}</p>
		</section>
		<section :class="$style.module" :aria-labelledby="creatorsId" :aria-busy="creatorsLoading">
			<h2 :id="creatorsId">{{ t.creators }}</h2><p :class="$style.hint">{{ t.creatorsHint }}</p>
			<p v-if="creatorsLoading && !creators.length" :class="$style.message" role="status">{{ t.loading }}</p>
			<div v-else-if="creatorsFailed" :class="$style.message" role="alert"><p>{{ t.loadFailed }}</p><button type="button" class="_button" :class="$style.retry" @click="loadCreators">{{ t.retry }}</button></div>
			<ul v-else-if="creators.length" :class="$style.creators">
				<li v-for="creator in creators" :key="creator.id">
					<div :class="$style.creatorRow">
						<a :class="$style.creatorLink" :href="profilePath(creator)" :aria-label="`${t.viewProfile}: ${creator.name || creator.username}`" @click.prevent="emit('navigate', profilePath(creator))"><MkAvatar :user="creator" :link="false" :preview="false" :class="$style.avatar"/><span :class="$style.identity"><strong>{{ creator.name || creator.username }}</strong><span>@{{ creator.username }}</span></span></a>
						<button type="button" class="_button" :class="[$style.followButton, { [$style.followed]: creator.isFollowing || creator.hasPendingFollowRequestFromYou }]" :disabled="!!followBusy[creator.id] || creator.isFollowing || creator.hasPendingFollowRequestFromYou" :aria-busy="!!followBusy[creator.id]" @click="follow(creator)">{{ followBusy[creator.id] ? t.followingBusy : creator.isFollowing ? t.following : creator.hasPendingFollowRequestFromYou ? t.followPending : followUncertain[creator.id] ? t.refreshFollow : t.follow }}</button>
					</div>
					<p v-if="followErrors[creator.id]" :class="$style.followError" role="status">{{ followErrors[creator.id] }}</p>
				</li>
			</ul>
			<p v-else :class="$style.message">{{ t.noCreators }}</p>
		</section>
	</div>
</aside>
</template>

<script setup lang="ts">
import { onActivated, onBeforeUnmount, onDeactivated, onMounted, reactive, ref, useId } from 'vue';
import type { entities } from 'misskey-js';
import { feedText as t } from './feed-copy.js';
import { isDiscoverableCreator, loadDiscoveryAnnouncements, loadDiscoveryCreators, readCreatorFollow, requestCreatorFollow } from './discovery-data.js';
import { homeLanguage } from '@/pages/home/copy.js';
import { $i } from '@/i.js';
import { prefer } from '@/preferences.js';
import { confirm } from '@/os.js';

const query = defineModel<string>('query', { required: true });
const emit = defineEmits<{ (event: 'search'): void; (event: 'navigate', path: string): void; (event: 'login'): void; }>();
const searchId = useId();
const discoveryId = useId();
const announcementsId = useId();
const creatorsId = useId();
const expanded = ref(false);
const announcements = ref<entities.Announcement[]>([]);
const creators = ref<entities.UserDetailed[]>([]);
const announcementsLoading = ref(false);
const creatorsLoading = ref(false);
const announcementsFailed = ref(false);
const creatorsFailed = ref(false);
const followBusy = reactive<Record<string, boolean>>({});
const followErrors = reactive<Record<string, string>>({});
const followUncertain = reactive<Record<string, boolean>>({});
let announcementsController: AbortController | undefined;
let creatorsController: AbortController | undefined;
const followControllers = new Map<string, AbortController>();
let active = true;
let suspended = false;

const profilePath = (creator: entities.UserDetailed) => `/@${creator.username}`;
const formatDate = (date: string) => new Date(date).toLocaleDateString(homeLanguage, { month: 'short', day: 'numeric' });

function clearSearch() {
	query.value = '';
	emit('search');
}

async function loadAnnouncements() {
	announcementsController?.abort();
	const controller = new AbortController();
	announcementsController = controller;
	announcementsLoading.value = true;
	announcementsFailed.value = false;
	try {
		const result = await loadDiscoveryAnnouncements(controller.signal);
		if (active && announcementsController === controller) announcements.value = result;
	} catch {
		if (active && announcementsController === controller && !controller.signal.aborted) announcementsFailed.value = true;
	} finally {
		if (active && announcementsController === controller) announcementsLoading.value = false;
	}
}

async function loadCreators() {
	creatorsController?.abort();
	const controller = new AbortController();
	creatorsController = controller;
	creatorsLoading.value = true;
	creatorsFailed.value = false;
	try {
		const result = await loadDiscoveryCreators($i?.id, controller.signal);
		if (active && creatorsController === controller) creators.value = result;
	} catch {
		if (active && creatorsController === controller && !controller.signal.aborted) creatorsFailed.value = true;
	} finally {
		if (active && creatorsController === controller) creatorsLoading.value = false;
	}
}

function updateCreator(user: entities.UserDetailed) {
	if (!isDiscoverableCreator(user, $i?.id)) {
		creators.value = creators.value.filter(creator => creator.id !== user.id);
		return;
	}
	creators.value = creators.value.map(creator => creator.id === user.id ? user : creator);
}

async function follow(creator: entities.UserDetailed) {
	if (!$i) { emit('login'); return; }
	if (followBusy[creator.id] || creator.isFollowing || creator.hasPendingFollowRequestFromYou || !active) return;
	followBusy[creator.id] = true;
	followErrors[creator.id] = '';
	const controller = new AbortController();
	followControllers.set(creator.id, controller);
	let attempted = false;
	const current = () => active && followControllers.get(creator.id) === controller;
	try {
		const user = await readCreatorFollow(creator.id, controller.signal);
		if (!current()) return;
		updateCreator(user);
		if (user.isFollowing || user.hasPendingFollowRequestFromYou || !isDiscoverableCreator(user, $i.id)) {
			followUncertain[creator.id] = false;
			return;
		}
		if (followUncertain[creator.id]) {
			// An explicit status check never silently submits another follow request.
			followUncertain[creator.id] = false;
			return;
		}
		if (prefer.s.alwaysConfirmFollow) {
			const result = await confirm({ type: 'question', text: t.followConfirm.replace('{name}', creator.name || creator.username) });
			if (result.canceled || !current()) return;
		}
		attempted = true;
		await requestCreatorFollow(creator.id, prefer.s.defaultFollowWithReplies, controller.signal);
		const verified = await readCreatorFollow(creator.id, controller.signal);
		if (!current()) return;
		updateCreator(verified);
		followUncertain[creator.id] = !verified.isFollowing && !verified.hasPendingFollowRequestFromYou;
		if (followUncertain[creator.id]) followErrors[creator.id] = t.followUncertain;
	} catch (error) {
		if (!current()) return;
		const rejected = typeof error === 'object' && error !== null && 'code' in error;
		followUncertain[creator.id] = followUncertain[creator.id] || (attempted && !rejected);
		if (attempted) {
			try {
				const verified = await readCreatorFollow(creator.id, controller.signal);
				if (!current()) return;
				updateCreator(verified);
				if (verified.isFollowing || verified.hasPendingFollowRequestFromYou) {
					followUncertain[creator.id] = false;
					return;
				}
			} catch {
				if (!current()) return;
				followUncertain[creator.id] = true;
			}
		}
		followErrors[creator.id] = followUncertain[creator.id] ? t.followUncertain : t.followFailed;
	} finally {
		if (followControllers.get(creator.id) === controller) {
			followBusy[creator.id] = false;
			followControllers.delete(creator.id);
		}
	}
}

function deactivate() {
	active = false;
	suspended = true;
	announcementsController?.abort();
	creatorsController?.abort();
	for (const [id, controller] of followControllers) {
		controller.abort();
		followUncertain[id] = true;
		followBusy[id] = false;
	}
	followControllers.clear();
}

onMounted(() => { void loadAnnouncements(); void loadCreators(); });
onDeactivated(deactivate);
onBeforeUnmount(deactivate);
onActivated(() => {
	active = true;
	if (!suspended) return;
	suspended = false;
	void loadAnnouncements();
	void loadCreators();
});
</script>

<style lang="scss" module>
.sidebar { min-width: 0; display: flex; flex-direction: column; gap: 20px; color: var(--MI_THEME-fg); font-size: 14px; line-height: 1.6; }
.sidebar, .sidebar * { box-sizing: border-box; }
.sidebar :focus-visible { outline: 2px solid var(--MI_THEME-accent); outline-offset: 3px; }
.module { min-width: 0; padding: 20px; border: 1px solid var(--MI_THEME-divider); border-radius: var(--community-radius, 12px); background: var(--MI_THEME-panel); }
.module h2 { margin: 0; font-size: 15px; line-height: 1.5; font-weight: 700; }
.search { display: flex; flex-direction: column; gap: 10px; margin-top: 16px; }
.searchField { min-width: 0; display: flex; align-items: center; gap: 8px; border: 1px solid var(--MI_THEME-inputBorder); border-radius: 12px; padding-left: 12px; background: var(--MI_THEME-bg); }
.searchField:focus-within { border-color: var(--MI_THEME-accent); }
.sidebar .searchField input { min-width: 0; flex: 1; width: 100%; min-height: 44px; padding: 10px 0; border: 0; border-radius: 12px; background: transparent; color: var(--MI_THEME-fg); font: inherit; caret-color: var(--MI_THEME-accent); }
.searchField input::-webkit-search-cancel-button { display: none; }
.searchField input::placeholder { color: var(--MI_THEME-fg); opacity: 1; }
.sidebar .clear { display: grid; place-items: center; flex-shrink: 0; width: 44px; height: 44px; border-radius: 10px; padding: 0; background: transparent; color: var(--MI_THEME-fg); }
.sidebar .searchButton, .sidebar .retry, .sidebar .followButton { display: inline-flex; justify-content: center; align-items: center; min-height: 44px; padding: 8px 14px; border-radius: 10px; background: var(--MI_THEME-buttonBg); color: var(--MI_THEME-fg); font: inherit; font-weight: 600; border: 1px solid transparent; }
.sidebar .searchButton { background: var(--MI_THEME-accent); color: var(--MI_THEME-fgOnAccent); }
.sidebar .searchButton:hover { background: var(--MI_THEME-accent); filter: brightness(.92); }
 .sidebar .retry:hover, .sidebar .followButton:not(:disabled):hover, .sidebar .clear:hover { background: var(--MI_THEME-buttonHoverBg); }
.sections { display: flex; flex-direction: column; gap: 20px; }
.heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.heading > a { display: inline-flex; flex-shrink: 0; align-items: center; gap: 4px; min-height: 44px; font-size: 12px; text-decoration: none; }
.heading > a:hover { text-decoration: underline; text-underline-offset: 3px; }
.announcements, .creators { list-style: none; margin: 12px 0 0; padding: 0; }
.announcements li + li, .creators li + li { border-top: 1px solid var(--MI_THEME-divider); }
.announcements li > a { display: block; padding: 14px 0; color: inherit; text-decoration: none; overflow-wrap: anywhere; }
.announcements li:first-child > a { padding-top: 0; }
.announcements li:last-child > a { padding-bottom: 0; }
.announcements time { color: var(--community-muted, var(--MI_THEME-fg)); font-size: 12px; }
.announcements h3 { margin: 4px 0 6px; font-size: 14px; line-height: 1.6; font-weight: 600; }
.announcements a:hover h3 { text-decoration: underline; text-underline-offset: 3px; }
.announcements p { margin: 0; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; font-size: 13px; }
.hint { margin: 10px 0 0; font-size: 13px; }
.message { margin: 16px 0 0; font-size: 13px; overflow-wrap: anywhere; }
.message p { margin: 0 0 8px; }
.creators li { padding: 14px 0; }
.creators li:first-child { padding-top: 4px; }
.creators li:last-child { padding-bottom: 0; }
.creatorRow { display: flex; align-items: center; gap: 10px; }
.creatorLink { display: flex; flex: 1; min-width: 0; align-items: center; gap: 10px; text-decoration: none; color: inherit; }
.avatar { flex-shrink: 0; width: 40px; height: 40px; }
.identity { display: flex; flex-direction: column; min-width: 0; font-size: 12px; }
.identity > strong { font-size: 14px; font-weight: 600; }
.identity > * { display: block; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.creatorLink:hover strong { text-decoration: underline; text-underline-offset: 3px; }
.sidebar .followButton { flex-shrink: 0; max-width: 120px; padding: 8px 12px; border: 1px solid var(--MI_THEME-inputBorder); font-size: 12px; line-height: 1.4; }
.sidebar .followButton:disabled { cursor: default; opacity: .8; }
.sidebar .followButton[aria-busy='true'] { cursor: wait; }
.sidebar .followed { background: transparent; border-color: transparent; }
.followError { margin: 8px 0 0; color: var(--MI_THEME-error); font-size: 12px; }
.sidebar .disclosure { display: none; }
@container (max-width: 900px) {
	.sidebar { gap: 12px; }
	.sidebar .disclosure { display: flex; align-items: center; justify-content: space-between; gap: 12px; width: 100%; min-height: 44px; padding: 8px 14px; background: var(--MI_THEME-panel); color: var(--MI_THEME-fg); border-radius: 12px; font: inherit; font-size: 13px; }
	.sections { display: none; }
	.sections.expanded { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
	.search { flex-direction: row; }
	.searchField { flex: 1; }
}
@container (max-width: 600px) {
	.module { padding: 16px; }
	.sections.expanded { display: flex; }
	.sidebar .searchField input { font-size: 16px; }
	.search { gap: 8px; }
	.sidebar .searchButton { padding-inline: 12px; }
}
</style>
