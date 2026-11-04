<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<PageWithHeader :tabs="[]">
	<div :class="$style.root" class="_gaps">
		<h1>{{ i18n.ts._aiCommunity.review }}</h1>
		<MkInfo>{{ i18n.ts._aiCommunity.reviewDescription }}</MkInfo>
		<div class="_buttons">
			<MkButton type="routerLink" to="/admin/users"><i class="ti ti-users" aria-hidden="true"></i> {{ i18n.ts.users }}</MkButton>
			<MkButton type="routerLink" to="/admin/abuses">{{ i18n.ts.abuseReports }}</MkButton>
		</div>
		<div :class="$style.filters" role="group" :aria-label="i18n.ts._aiCommunity.navigation">
			<button v-for="item in communityModules" :key="item.key" type="button" class="_button" :class="[$style.filter, { [$style.selected]: selected === item.key }]" :aria-pressed="selected === item.key" @click="selected = item.key">
				<i :class="item.icon" aria-hidden="true"></i> {{ item.title }}
			</button>
		</div>
		<MkLoading v-if="loading"/>
		<div v-else-if="failed" role="alert" class="_gaps">
			<p>{{ i18n.ts._aiCommunity.loadError }}</p>
			<MkButton @click="loadChannel">{{ i18n.ts.retry }}</MkButton>
		</div>
		<div v-else-if="!channel" class="_gaps">
			<h2>{{ i18n.ts._aiCommunity.notConfigured }}</h2>
			<p>{{ i18n.ts._aiCommunity.setupDescription }}</p>
			<code :class="$style.command">node scripts/setup-ai-community.mjs --url http://localhost:3000</code>
			<MkButton @click="loadChannel">{{ i18n.ts.reload }}</MkButton>
		</div>
		<template v-else-if="paginator">
			<div class="_buttons">
				<MkButton @click="paginator.reload()">{{ i18n.ts.reload }}</MkButton>
				<MkButton type="routerLink" :to="`/channels/${channel.id}/edit`">{{ i18n.ts._aiCommunity.channelSettings }}</MkButton>
			</div>
			<MkPagination :key="channel.id" :paginator="paginator">
				<template #empty><p role="status">{{ i18n.ts._aiCommunity.noWorks }}</p></template>
				<template #default="{ items }">
					<div class="_gaps">
						<article v-for="note in items" :key="note.id" :class="$style.work">
							<div :class="$style.content">
								<header :class="$style.author"><MkAvatar :user="note.user" style="width: 32px; height: 32px;"/><MkUserName :user="note.user"/><MkTime :time="note.createdAt"/></header>
								<p v-if="note.cw">{{ note.cw }}</p>
								<Mfm v-if="note.text" :text="note.text" :isNote="true"/>
								<ul v-if="note.poll" :aria-label="i18n.ts.poll"><li v-for="(choice, index) in note.poll.choices" :key="index">{{ choice.text }}</li></ul>
								<MkMediaList v-if="note.files && note.files.length" :mediaList="note.files" :user="note.user"/>
								<MkA v-if="note.renoteId" :to="`/notes/${note.renoteId}`" class="_link">{{ i18n.ts._aiCommunity.openOriginal }}</MkA>
							</div>
							<div :class="$style.actions">
								<MkA :to="`/notes/${note.id}`" class="_link">{{ i18n.ts._aiCommunity.openDiscussion }}</MkA>
								<MkA :to="`/admin/user/${note.userId}`" class="_link">{{ i18n.ts._aiCommunity.manageAuthor }}</MkA>
								<MkButton danger small :disabled="deleting !== null" @click="remove(note)">{{ i18n.ts._aiCommunity.removeWork }}</MkButton>
							</div>
						</article>
					</div>
				</template>
			</MkPagination>
		</template>
	</div>
</PageWithHeader>
</template>

<script lang="ts" setup>
import { markRaw, onBeforeUnmount, ref, shallowRef, watch } from 'vue';
import type * as Misskey from 'misskey-js';
import type { CommunityModule } from '@/utility/ai-community.js';
import { communityModules, fetchCommunityChannels } from '@/utility/ai-community.js';
import MkButton from '@/components/MkButton.vue';
import MkInfo from '@/components/MkInfo.vue';
import MkMediaList from '@/components/MkMediaList.vue';
import MkPagination from '@/components/MkPagination.vue';
import { Paginator } from '@/utility/paginator.js';
import { misskeyApi } from '@/utility/misskey-api.js';
import { i18n } from '@/i18n.js';
import { iAmModerator } from '@/i.js';
import { definePage } from '@/page.js';
import * as os from '@/os.js';

const selected = ref<CommunityModule>('video');
const channel = shallowRef<Misskey.entities.Channel | null>(null);
const paginator = shallowRef<Paginator<'admin/community/notes'> | null>(null);
const loading = ref(false);
const failed = ref(false);
const deleting = ref<string | null>(null);
let version = 0;
let controller: AbortController | undefined;

async function loadChannel() {
	const currentVersion = ++version;
	controller?.abort();
	controller = new AbortController();
	const signal = controller.signal;
	channel.value = null;
	paginator.value = null;
	failed.value = false;
	loading.value = true;
	const key = selected.value;
	try {
		if (!iAmModerator) throw new Error('Access denied');
		const channels = await fetchCommunityChannels(signal);
		const channelId = channels[key];
		if (!channelId) return;
		const result = await misskeyApi('channels/show', { channelId }, undefined, signal);
		if (currentVersion !== version) return;
		channel.value = result;
		paginator.value = markRaw(new Paginator('admin/community/notes', { limit: 20, params: { module: key } }));
	} catch {
		if (currentVersion === version && !signal.aborted) failed.value = true;
	} finally {
		if (currentVersion === version) loading.value = false;
	}
}

async function remove(note: Misskey.entities.Note) {
	if (!iAmModerator || deleting.value) return;
	deleting.value = note.id;
	const currentPaginator = paginator.value;
	try {
		const { canceled } = await os.confirm({ type: 'warning', title: i18n.ts._aiCommunity.removeWork, text: i18n.ts._aiCommunity.removeConfirm });
		if (canceled) return;
		await os.apiWithDialog('notes/delete', { noteId: note.id });
		currentPaginator?.removeItem(note.id);
	} catch {
		// apiWithDialog already presents the server error; retain the work for retry.
	} finally {
		deleting.value = null;
	}
}

watch(selected, loadChannel, { immediate: true });
onBeforeUnmount(() => { version++; controller?.abort(); });
definePage(() => ({ title: i18n.ts._aiCommunity.review, icon: 'ti ti-shield-check' }));
</script>

<style lang="scss" module>
.root { max-width: 900px; margin: auto; padding: 24px; }
.root h1 { font-size: 24px; margin: 0; }
.root h2 { font-size: 18px; margin: 0; }
.root p { line-height: 1.8; }
.filters { display: flex; flex-wrap: wrap; gap: 8px; }
.filter { min-height: 44px; padding: 10px 14px; border-radius: var(--MI-radius); }
.filter:hover { background: var(--MI_THEME-buttonHoverBg); }
.filter:focus-visible { outline: 2px solid var(--MI_THEME-focus); outline-offset: 2px; }
.selected { background: var(--MI_THEME-buttonBg); font-weight: 700; }
.work { min-width: 0; overflow: clip; background: var(--MI_THEME-panel); border: 1px solid var(--MI_THEME-divider); border-radius: var(--MI-radius); }
.content { padding: 20px; overflow-wrap: anywhere; }
.author { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; margin-bottom: 16px; }
.actions { display: flex; align-items: center; flex-wrap: wrap; gap: 16px; padding: 16px; border-top: 1px solid var(--MI_THEME-divider); }
.actions > a { min-height: 44px; display: inline-flex; align-items: center; }
.command { padding: 16px; background: var(--MI_THEME-panel); overflow-wrap: anywhere; white-space: pre-wrap; }
@media (max-width: 600px) { .root { padding: 16px; } }
</style>
