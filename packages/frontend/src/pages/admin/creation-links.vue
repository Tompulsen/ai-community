<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<PageWithHeader :tabs="[]">
	<div class="_spacer" style="--MI_SPACER-w: 100%; --MI_SPACER-min: 16px; --MI_SPACER-max: 32px;">
		<SearchMarker path="/admin/creation-links" :label="creationText.settings" :keywords="['creation', 'text', 'image', 'video', 'model']" icon="ti ti-sparkles">
			<div class="_gaps_m" data-testid="admin-creation-settings" :aria-busy="loading || savingModels">
				<p :class="$style.description">{{ creationText.description }}</p>
				<p v-if="!$i?.isAdmin" role="alert">{{ creationText.adminOnly }}</p>
				<MkLoading v-else-if="loading"/>
				<div v-else-if="loadFailed" class="_gaps_s" role="alert">
					<p>{{ creationText.loadError }}</p>
					<MkButton @click="load">{{ i18n.ts.retry }}</MkButton>
				</div>
				<template v-else-if="loaded">
					<section class="_panel _gaps_m" :class="$style.editor">
						<h2 :class="$style.heading">{{ workbenchText.title }}</h2>
						<p v-if="studioReady">{{ creationText.builtinReady }}</p>
						<p v-else role="alert">{{ creationText.builtinUnavailable }}</p>
						<MkA v-if="studioReady" to="/create/text" class="_link">{{ creationText.preview }}</MkA>
					</section>
					<section class="_panel _gaps_m" :class="$style.editor" data-testid="creation-models">
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
				</template>
			</div>
		</SearchMarker>
	</div>
</PageWithHeader>
</template>

<script lang="ts" setup>
import { computed, onMounted, ref, watch } from 'vue';
import { url as siteUrl } from '@@/js/config.js';
import type * as Misskey from 'misskey-js';
import MkInput from '@/components/MkInput.vue';
import MkButton from '@/components/MkButton.vue';
import { creationText, creationModelText as modelText, creationPages, workbenchText } from '@/utility/creation-pages.js';
import { misskeyApi } from '@/utility/misskey-api.js';
import { fetchInstance, instance } from '@/instance.js';
import { $i } from '@/i.js';
import { i18n } from '@/i18n.js';
import { definePage } from '@/page.js';
import { newApiSigninConfig } from '@/utility/newapi-signin.js';

const editors = ref(creationPages.map(item => ({ ...item, model: item.defaultModel as string })));
const savingModels = ref(false), modelsFailed = ref(false), modelsSaved = ref(false);
const invalidModels = computed(() => editors.value.some(item => item.model.trim().length > 100 || /\s/u.test(item.model.trim())));
const loading = ref(false);
const loaded = ref(false);
const loadFailed = ref(false);
const studioReady = ref(false);

watch(editors, () => { modelsSaved.value = false; }, { deep: true });

async function load() {
	if (!$i?.isAdmin || loading.value) return;
	loading.value = true;
	loadFailed.value = false;
	try {
		const [meta, sso] = await Promise.all([misskeyApi('admin/meta'), newApiSigninConfig()]);
		studioReady.value = sso.enabled && sso.studioOrigin === new URL(siteUrl).origin && sso.studioPath === '/studio';
		for (const item of editors.value) item.model = meta.clientOptions[item.modelKey] ?? item.defaultModel;
		loaded.value = true;
	} catch { loadFailed.value = true; } finally { loading.value = false; }
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
definePage(() => ({ title: creationText.settings, icon: 'ti ti-sparkles' }));
</script>

<style lang="scss" module>
.editor { padding: 24px; border-radius: var(--MI-radius); min-width: 0; }
.heading { margin: 0; font-size: 1.1em; }
.description { margin: 0; color: var(--MI_THEME-fg); line-height: 1.7; overflow-wrap: anywhere; }
.error { margin: 0; color: var(--MI_THEME-error); line-height: 1.6; }
@media (max-width: 600px) { .editor { padding: 16px; } }
</style>
