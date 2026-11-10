<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->
<template>
<div :class="$style.root">
	<p v-if="loading" role="status">{{ t.loadingWorks }}</p>
	<MkA v-else-if="work" :to="`/community/work/${work.id}`" :class="$style.work">
		<img v-if="thumbnail" :src="thumbnail" alt="" loading="lazy"/>
		<i v-else class="ti ti-photo" aria-hidden="true"></i>
		<span><small>{{ t.sharedWork }}</small><strong>{{ work.title }}</strong><small>{{ work.author.name || work.author.username }}</small></span>
		<i class="ti ti-chevron-right" aria-hidden="true"></i>
	</MkA>
	<div v-else role="status"><p>{{ unavailable ? t.workUnavailable : t.worksFailed }}</p><button v-if="!unavailable" type="button" class="_textButton" @click="load">{{ t.retry }}</button></div>
</div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import type { CommunityWork } from '../community/types.js';
import { chatText as t } from './copy.js';
import { misskeyApi } from '@/utility/misskey-api.js';

const props = defineProps<{ workId: string }>();
const work = ref<CommunityWork | null>(null);
const loading = ref(true);
const unavailable = ref(false);
let version = 0;
const thumbnail = computed(() => {
	const file = work.value?.files[0];
	return file && !file.isSensitive ? file.thumbnailUrl || (file.type.startsWith('image/') ? file.url : null) : null;
});

async function load() {
	const request = ++version;
	work.value = null;
	loading.value = true;
	unavailable.value = false;
	try {
		const result = await misskeyApi('community/works/show', { submissionId: props.workId });
		if (request === version) work.value = result;
	} catch (error) {
		if (request === version) unavailable.value = (error as { code?: string }).code === 'COMMUNITY_NOT_FOUND';
	} finally {
		if (request === version) loading.value = false;
	}
}

watch(() => props.workId, load, { immediate: true });
onBeforeUnmount(() => { version++; });
</script>

<style module lang="scss">
.root { min-width: 0; text-align: start; }
.root p { margin: 0; font-size: 14px; }
.work { display: flex; align-items: center; gap: 12px; max-width: 360px; min-height: 76px; color: inherit; text-decoration: none; }
.work > img { width: 68px; height: 68px; flex-shrink: 0; object-fit: cover; border-radius: var(--MI-radius); }
.work > i { flex-shrink: 0; }
.work > span { display: grid; gap: 5px; min-width: 0; flex: 1; }
.work strong { font-size: 15px; overflow-wrap: anywhere; }
.work small { font-size: 12px; }
.work:focus-visible { outline: 2px solid var(--MI_THEME-accent); outline-offset: 4px; }
</style>
