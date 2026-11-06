<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<PageWithHeader :tabs="[]">
	<div :class="$style.settings">
		<SearchMarker path="/admin/community-ads" :label="t.settings" :keywords="['community', 'advertisement', 'banner', '广告']" icon="ti ti-ad">
			<div class="_gaps_m" data-testid="admin-community-ads" :aria-busy="loading">
				<p :class="$style.intro">{{ t.intro }}</p>
				<p v-if="!$i?.isAdmin" role="alert">{{ t.adminOnly }}</p>
				<MkLoading v-else-if="loading"/>
				<div v-else-if="failed" role="alert" class="_gaps_s"><p>{{ t.loadFailed }}</p><MkButton @click="load">{{ t.retry }}</MkButton></div>
				<div v-else-if="options" :class="$style.editors"><CommunityAdEditor v-for="(key, index) in communityAdKeys" :key="key" :slotKey="key" :position="index" :initial="options[key]"/></div>
			</div>
		</SearchMarker>
	</div>
</PageWithHeader>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import CommunityAdEditor from './community-ad-editor.vue';
import type { entities } from 'misskey-js';
import { adText as t, communityAdKeys } from '@/pages/community/ads.js';
import MkButton from '@/components/MkButton.vue';
import { misskeyApi } from '@/utility/misskey-api.js';
import { $i } from '@/i.js';
import { definePage } from '@/page.js';

const options = ref<entities.MetaClientOptions>();
const loading = ref(false);
const failed = ref(false);
let disposed = false;

async function load() {
	if (!$i?.isAdmin || loading.value) return;
	loading.value = true; failed.value = false;
	try {
		const meta = await misskeyApi('admin/meta');
		if (!disposed) options.value = meta.clientOptions;
	} catch { if (!disposed) failed.value = true; } finally { loading.value = false; }
}

onMounted(load);
onBeforeUnmount(() => { disposed = true; });
definePage(() => ({ title: t.settings, icon: 'ti ti-ad' }));
</script>

<style lang="scss" module>
.settings { padding: 24px 32px 48px; max-width: 1280px; margin-inline: auto; container-type: inline-size; }
.intro { margin: 0; line-height: 1.8; }
.editors { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 24px; }
@container (max-width: 700px) { .editors { grid-template-columns: minmax(0, 1fr); } }
@media (max-width: 600px) { .settings { padding: 20px 16px 32px; } }
</style>
