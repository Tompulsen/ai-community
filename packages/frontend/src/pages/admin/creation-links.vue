<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<PageWithHeader :tabs="[]">
	<div class="_spacer" style="--MI_SPACER-w: 100%; --MI_SPACER-min: 16px; --MI_SPACER-max: 32px;">
		<SearchMarker path="/admin/creation-links" :label="creationText.settings" :keywords="['creation', 'text', 'image', 'video', 'url']" icon="ti ti-link">
			<div class="_gaps_m" data-testid="admin-creation-settings" :aria-busy="loading || saving">
				<p :class="$style.description">{{ creationText.description }}</p>
				<p v-if="!$i?.isAdmin" role="alert">{{ creationText.adminOnly }}</p>
				<MkLoading v-else-if="loading"/>
				<div v-else-if="loadFailed" class="_gaps_s" role="alert">
					<p>{{ creationText.loadError }}</p>
					<MkButton @click="load">{{ i18n.ts.retry }}</MkButton>
				</div>
				<section v-else-if="loaded && studioOrigin" class="_panel _gaps_m" :class="$style.editor">
					<h2 :class="$style.heading">{{ authText.studioTitle }}</h2>
					<p>{{ authText.studioManaged }}</p>
					<p><code>{{ studioOrigin }}</code></p>
					<MkA to="/create/text" class="_link">{{ creationText.preview }}</MkA>
				</section>
				<template v-else-if="loaded">
					<section v-for="item in editors" :key="item.key" class="_panel _gaps_m" :class="$style.editor" :aria-labelledby="`creation-${item.key}-heading`" :data-testid="`creation-editor-${item.key}`">
						<h2 :id="`creation-${item.key}-heading`" :class="$style.heading"><i :class="item.icon" aria-hidden="true"></i> {{ item.title }}</h2>
						<label>
							<MkInput v-model="item.url" type="url" :disabled="saving" :spellcheck="false" autocapitalize="none" autocomplete="off" placeholder="https://" :data-testid="`creation-url-${item.key}`">
								<template #label>{{ creationText.url }}</template>
								<template #prefix><i class="ti ti-link" aria-hidden="true"></i></template>
							</MkInput>
						</label>
						<p v-if="isInvalid(item.url)" :class="$style.error" role="alert" :data-testid="`creation-error-${item.key}`">{{ creationText.invalidUrl }}</p>
						<p v-else :class="$style.description">{{ creationText.urlHint }}</p>
						<MkSelect v-model="item.mode" :items="modeOptions" :disabled="saving" :data-testid="`creation-mode-${item.key}`" role="group" :aria-label="creationText.mode">
							<template #label>{{ creationText.mode }}</template>
							<template #caption>{{ embedText.modeHint }}</template>
						</MkSelect>
						<div v-if="item.mode === 'embed'" :class="$style.embedGuide" :data-testid="`creation-embed-guide-${item.key}`">
							<h3>{{ embedText.setupTitle }}</h3><p>{{ embedText.setupHint }}</p>
							<div :class="$style.allowedOrigin"><code :aria-label="embedText.originLabel">{{ siteOrigin }}</code><MkButton small @click="copyOrigin(item.key)">{{ copiedOrigin === item.key ? embedText.copied : embedText.copyOrigin }}</MkButton></div>
							<p v-if="copyFailed === item.key" role="alert">{{ embedText.copyFailed }}</p><p>{{ embedText.sessionHint }}</p>
						</div>
						<MkA :to="`/create/${item.key}`" class="_link">{{ creationText.preview }} <i class="ti ti-arrow-right" aria-hidden="true"></i></MkA>
					</section>
					<p v-if="saveFailed" role="alert" :class="$style.error">{{ creationText.saveError }}</p>
					<p v-if="saved" role="status" data-testid="creation-saved">{{ creationText.saved }}</p>
					<MkButton primary :wait="saving" :disabled="saving || hasInvalidUrl" data-testid="creation-save" @click="save"><i class="ti ti-check" aria-hidden="true"></i> {{ i18n.ts.save }}</MkButton>
				</template>
				<section v-if="loaded" class="_panel _gaps_m" :class="$style.editor" data-testid="creation-models">
					<h2 :class="$style.heading">{{ modelText.title }}</h2>
					<p :class="$style.description">{{ modelText.hint }}</p>
					<MkInput v-for="item in editors" :key="item.key" v-model="item.model" :disabled="savingModels" :spellcheck="false" autocapitalize="none" autocomplete="off" :placeholder="modelText.empty" :data-testid="`creation-model-${item.key}`">
						<template #label>{{ item.title }} · {{ modelText.label }}</template>
					</MkInput>
					<p v-if="invalidModels" role="alert" :class="$style.error">{{ modelText.invalid }}</p>
					<p v-if="modelsFailed" role="alert" :class="$style.error">{{ creationText.saveError }}</p>
					<p v-if="modelsSaved" role="status">{{ modelText.saved }}</p>
					<MkButton primary :wait="savingModels" :disabled="savingModels || invalidModels" data-testid="creation-model-save" @click="saveModels">{{ i18n.ts.save }}</MkButton>
				</section>
			</div>
		</SearchMarker>
	</div>
</PageWithHeader>
</template>

<script lang="ts" setup>
import { computed, onMounted, ref, watch } from 'vue';
import { url as siteUrl } from '@@/js/config.js';
import type * as Misskey from 'misskey-js';
import type { CreationMode } from '@/utility/creation-pages.js';
import MkInput from '@/components/MkInput.vue';
import MkSelect from '@/components/MkSelect.vue';
import MkButton from '@/components/MkButton.vue';
import { creationText, creationEmbedText as embedText, creationModelText as modelText, creationPages, normalizeCreationUrl } from '@/utility/creation-pages.js';
import { misskeyApi } from '@/utility/misskey-api.js';
import { fetchInstance, instance } from '@/instance.js';
import { $i } from '@/i.js';
import { i18n } from '@/i18n.js';
import { definePage } from '@/page.js';
import { authText } from '@/utility/auth-copy.js';
import { newApiSigninConfig } from '@/utility/newapi-signin.js';

const editors = ref(creationPages.map(item => ({ ...item, url: '', mode: 'embed' as CreationMode, model: item.defaultModel as string })));
const savingModels = ref(false), modelsFailed = ref(false), modelsSaved = ref(false);
const invalidModels = computed(() => editors.value.some(item => item.model.trim().length > 100 || /\s/u.test(item.model.trim())));
const modeOptions = [
	{ value: 'embed' as const, label: creationText.embed },
	{ value: 'newTab' as const, label: creationText.newTab },
];
const loading = ref(false);
const loaded = ref(false);
const loadFailed = ref(false);
const saving = ref(false);
const saveFailed = ref(false);
const saved = ref(false);
const studioOrigin = ref('');
const siteOrigin = new URL(siteUrl).origin;
const copiedOrigin = ref('');
const copyFailed = ref('');
const isInvalid = (value: string) => value.trim() !== '' && normalizeCreationUrl(value, siteUrl) == null;
const hasInvalidUrl = computed(() => editors.value.some(item => isInvalid(item.url)));

watch(editors, () => { saved.value = false; modelsSaved.value = false; }, { deep: true });

async function copyOrigin(key: string) {
	copiedOrigin.value = '';
	copyFailed.value = '';
	try { await navigator.clipboard.writeText(siteOrigin); copiedOrigin.value = key; } catch { copyFailed.value = key; }
}

async function load() {
	if (!$i?.isAdmin || loading.value) return;
	loading.value = true;
	loadFailed.value = false;
	try {
		const [meta, sso] = await Promise.all([misskeyApi('admin/meta'), newApiSigninConfig()]);
		studioOrigin.value = sso.studioOrigin ?? '';
		for (const item of editors.value) {
			item.url = meta.clientOptions[item.urlKey] ?? '';
			item.mode = meta.clientOptions[item.modeKey] ?? 'embed';
			item.model = meta.clientOptions[item.modelKey] ?? item.defaultModel;
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

async function saveModels() {
	if (!$i?.isAdmin || !loaded.value || savingModels.value || invalidModels.value) return;
	savingModels.value = true; modelsFailed.value = false; modelsSaved.value = false;
	const clientOptions: Partial<Misskey.entities.MetaClientOptions> = {};
	for (const item of editors.value) clientOptions[item.modelKey] = item.model.trim();
	try {
		await misskeyApi('admin/update-meta', { clientOptions });
		Object.assign(instance.clientOptions, clientOptions);
		await fetchInstance(true).catch(() => {});
		modelsSaved.value = true;
	} catch { modelsFailed.value = true; } finally { savingModels.value = false; }
}

onMounted(load);
definePage(() => ({ title: creationText.settings, icon: 'ti ti-link' }));
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
.embedGuide { padding: 16px; border: 1px solid var(--MI_THEME-divider); border-radius: var(--community-radius-small, 8px); background: var(--MI_THEME-bg); h3 { margin: 0 0 8px; font-size: 14px; } p { margin: 8px 0; font-size: 13px; line-height: 1.7; overflow-wrap: anywhere; } }
.allowedOrigin { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; padding-block: 8px; code { user-select: text; overflow-wrap: anywhere; } }
@media (max-width: 600px) {
	.editor { padding: 16px; }
}
</style>
