<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<PageWithHeader :tabs="[]">
	<div class="_spacer" style="--MI_SPACER-w: 100%; --MI_SPACER-min: 16px; --MI_SPACER-max: 32px;">
		<SearchMarker path="/admin/creation-links" :label="i18n.ts._creationLinks.settings" :keywords="['creation', 'text', 'image', 'video', 'url']" icon="ti ti-link">
			<div class="_gaps_m" data-testid="admin-creation-settings" :aria-busy="loading || saving">
				<p :class="$style.description">{{ i18n.ts._creationLinks.description }}</p>
				<p v-if="!$i?.isAdmin" role="alert">{{ i18n.ts._creationLinks.adminOnly }}</p>
				<MkLoading v-else-if="loading"/>
				<div v-else-if="loadFailed" class="_gaps_s" role="alert">
					<p>{{ i18n.ts._creationLinks.loadError }}</p>
					<MkButton @click="load">{{ i18n.ts.retry }}</MkButton>
				</div>
				<template v-else-if="loaded">
					<section v-for="item in editors" :key="item.key" class="_panel _gaps_m" :class="$style.editor" :aria-labelledby="`creation-${item.key}-heading`" :data-testid="`creation-editor-${item.key}`">
						<h2 :id="`creation-${item.key}-heading`" :class="$style.heading"><i :class="item.icon" aria-hidden="true"></i> {{ item.title }}</h2>
						<label>
							<MkInput v-model="item.url" type="url" :disabled="saving" :spellcheck="false" autocapitalize="none" autocomplete="off" placeholder="https://" :data-testid="`creation-url-${item.key}`">
								<template #label>{{ i18n.ts._creationLinks.url }}</template>
								<template #prefix><i class="ti ti-link" aria-hidden="true"></i></template>
							</MkInput>
						</label>
						<p v-if="isInvalid(item.url)" :class="$style.error" role="alert" :data-testid="`creation-error-${item.key}`">{{ i18n.ts._creationLinks.invalidUrl }}</p>
						<p v-else :class="$style.description">{{ i18n.ts._creationLinks.urlHint }}</p>
						<MkSelect v-model="item.mode" :items="modeOptions" :disabled="saving" :data-testid="`creation-mode-${item.key}`" role="group" :aria-label="i18n.ts._creationLinks.mode">
							<template #label>{{ i18n.ts._creationLinks.mode }}</template>
							<template #caption>{{ i18n.ts._creationLinks.modeHint }}</template>
						</MkSelect>
						<MkA :to="`/create/${item.key}`" class="_link">{{ i18n.ts._creationLinks.preview }} <i class="ti ti-arrow-right" aria-hidden="true"></i></MkA>
					</section>
					<p v-if="saveFailed" role="alert" :class="$style.error">{{ i18n.ts._creationLinks.saveError }}</p>
					<p v-if="saved" role="status" data-testid="creation-saved">{{ i18n.ts._creationLinks.saved }}</p>
					<MkButton primary :wait="saving" :disabled="saving || hasInvalidUrl" data-testid="creation-save" @click="save"><i class="ti ti-check" aria-hidden="true"></i> {{ i18n.ts.save }}</MkButton>
				</template>
			</div>
		</SearchMarker>
	</div>
</PageWithHeader>
</template>

<script lang="ts" setup>
import { computed, onMounted, ref, watch } from 'vue';
import type * as Misskey from 'misskey-js';
import { url as siteUrl } from '@@/js/config.js';
import MkInput from '@/components/MkInput.vue';
import MkSelect from '@/components/MkSelect.vue';
import MkButton from '@/components/MkButton.vue';
import { creationPages, normalizeCreationUrl } from '@/utility/creation-pages.js';
import type { CreationMode } from '@/utility/creation-pages.js';
import { misskeyApi } from '@/utility/misskey-api.js';
import { fetchInstance, instance } from '@/instance.js';
import { $i } from '@/i.js';
import { i18n } from '@/i18n.js';
import { definePage } from '@/page.js';

const editors = ref(creationPages.map(item => ({ ...item, url: '', mode: 'embed' as CreationMode })));
const modeOptions = [
	{ value: 'embed' as const, label: i18n.ts._creationLinks.embed },
	{ value: 'newTab' as const, label: i18n.ts._creationLinks.newTab },
];
const loading = ref(false);
const loaded = ref(false);
const loadFailed = ref(false);
const saving = ref(false);
const saveFailed = ref(false);
const saved = ref(false);
const isInvalid = (value: string) => value.trim() !== '' && normalizeCreationUrl(value, siteUrl) == null;
const hasInvalidUrl = computed(() => editors.value.some(item => isInvalid(item.url)));

watch(editors, () => { saved.value = false; }, { deep: true });

async function load() {
	if (!$i?.isAdmin || loading.value) return;
	loading.value = true;
	loadFailed.value = false;
	try {
		const meta = await misskeyApi('admin/meta');
		for (const item of editors.value) {
			item.url = meta.clientOptions[item.urlKey] ?? '';
			item.mode = meta.clientOptions[item.modeKey] ?? 'embed';
		}
		loaded.value = true;
	} catch {
		loadFailed.value = true;
	} finally {
		loading.value = false;
	}
}

async function save() {
	if (!$i?.isAdmin || !loaded.value || saving.value || hasInvalidUrl.value) return;
	const clientOptions: Partial<Misskey.entities.MetaClientOptions> = {};
	for (const item of editors.value) {
		clientOptions[item.urlKey] = item.url.trim() ? normalizeCreationUrl(item.url, siteUrl) : null;
		clientOptions[item.modeKey] = item.mode;
	}
	saving.value = true;
	saveFailed.value = false;
	saved.value = false;
	try {
		await misskeyApi('admin/update-meta', { clientOptions });
		Object.assign(instance.clientOptions, clientOptions);
		// The write has succeeded even if the subsequent public-cache refresh fails.
		await fetchInstance(true).catch(() => {});
		saved.value = true;
	} catch {
		saveFailed.value = true;
	} finally {
		saving.value = false;
	}
}

onMounted(load);
definePage(() => ({ title: i18n.ts._creationLinks.settings, icon: 'ti ti-link' }));
</script>

<style lang="scss" module>
.editor {
	padding: 24px;
	border-radius: var(--MI-radius);
	min-width: 0;
}
.heading { margin: 0; font-size: 1.1em; }
.description { margin: 0; color: var(--MI_THEME-fg); line-height: 1.7; overflow-wrap: anywhere; }
.error { margin: 0; color: var(--MI_THEME-error); line-height: 1.6; }
@media (max-width: 600px) {
	.editor { padding: 16px; }
}
</style>
