<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->
<template>
<div class="_gaps_s">
	<form :class="$style.search" role="search" @submit.prevent="search">
		<label :class="$style.field">
			<i class="ti ti-search" aria-hidden="true"></i>
			<input v-model="searchQuery" type="search" :placeholder="t.searchPlaceholder" :aria-label="t.search" @input="resetSearch">
		</label>
		<MkButton type="submit" :disabled="!searchQuery.trim() || searching" :wait="searching">{{ t.search }}</MkButton>
	</form>
	<p v-if="searching" role="status">{{ t.searching }}</p>
	<div v-else-if="failed" role="alert" :class="$style.feedback"><span>{{ t.searchFailed }}</span><MkButton @click="search">{{ t.retry }}</MkButton></div>
	<section v-else-if="searched" :aria-label="t.results" class="_gaps_s">
		<h3 :class="$style.title">{{ t.results }}</h3>
		<div v-for="message in searchResults" :key="message.id" :class="$style.searchResultItem"><XMessage :message="message" :isSearchResult="true"/></div>
		<p v-if="searchResults.length === 0" role="status">{{ t.noResults }} · {{ t.noResultsHint }}</p>
	</section>
</div>
</template>

<script lang="ts" setup>
import { onBeforeUnmount, ref } from 'vue';
import * as Misskey from 'misskey-js';
import XMessage from './XMessage.vue';
import { chatText as t } from './copy.js';
import MkButton from '@/components/MkButton.vue';
import { misskeyApi } from '@/utility/misskey-api.js';

const props = defineProps<{ userId?: string; roomId?: string }>();
const searchQuery = ref('');
const searched = ref(false);
const searching = ref(false);
const failed = ref(false);
const searchResults = ref<Misskey.entities.ChatMessage[]>([]);
let request = 0;
let controller: AbortController | undefined;

function resetSearch() {
	request++;
	controller?.abort();
	searching.value = false;
	searched.value = false;
	failed.value = false;
	searchResults.value = [];
}

async function search() {
	const query = searchQuery.value.trim();
	if (!query || searching.value) return;
	const id = ++request;
	controller = new AbortController();
	searching.value = true;
	failed.value = false;
	searched.value = false;
	try {
		const results = await misskeyApi('chat/messages/search', { query, roomId: props.roomId, userId: props.userId }, undefined, controller.signal);
		if (id !== request) return;
		searchResults.value = results;
		searched.value = true;
	} catch {
		if (id === request) failed.value = true;
	} finally {
		if (id === request) searching.value = false;
	}
}

onBeforeUnmount(resetSearch);
</script>

<style lang="scss" module>
.search { display: flex; gap: 10px; align-items: stretch; }
.field { display: flex; align-items: center; gap: 10px; flex: 1; min-width: 0; padding: 0 14px; border-radius: var(--MI-radius); border: 1px solid var(--MI_THEME-divider); background: var(--MI_THEME-panel); }
.field input { width: 100%; min-width: 0; min-height: 44px; padding: 10px 0; font: inherit; font-size: 16px; color: var(--MI_THEME-fg); background: transparent; border: 0; outline: none; }
.field input::placeholder { color: var(--MI_THEME-fg); opacity: .8; }
.field:focus-within { outline: 2px solid var(--MI_THEME-accent); outline-offset: 2px; }
.feedback { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.title { font-size: 16px; margin: 12px 0; }
.searchResultItem { padding: 16px; border-radius: var(--MI-radius); background: var(--MI_THEME-panel); }
@media (max-width: 480px) {
	.search { flex-wrap: wrap; }
	.field { flex-basis: 100%; }
	.search > button { margin-left: auto; }
}
</style>
