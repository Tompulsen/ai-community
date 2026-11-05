<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<PageWithHeader :tabs="[]">
	<div :class="$style.root" data-testid="admin-community">
		<h1>{{ t.review }}</h1>
		<section :class="$style.settings" :aria-label="t.settingsTitle" :aria-busy="loading || saving">
			<h2>{{ t.settingsTitle }}</h2><p>{{ t.settingsHint }}</p>
			<p v-if="!$i?.isAdmin">{{ t.modeAdminOnly }}</p>
			<p v-else-if="loading" role="status">{{ t.modeLoading }}</p>
			<div v-else-if="!loaded" role="alert"><p>{{ t.modeLoadFailed }}</p><MkButton @click="load">{{ t.modeRetry }}</MkButton></div>
			<template v-else>
				<fieldset :class="$style.modes" :disabled="saving">
					<legend class="_srOnly">{{ t.settingsTitle }}</legend>
					<label><input v-model="mode" type="radio" name="community-publication-mode" value="before"><span><strong>{{ t.beforeMode }}</strong><span>{{ t.beforeHint }}</span></span></label>
					<label><input v-model="mode" type="radio" name="community-publication-mode" value="after"><span><strong>{{ t.afterMode }}</strong><span>{{ t.afterHint }}</span></span></label>
				</fieldset>
				<p :class="$style.hint">{{ t.modeScope }}</p>
				<div :class="$style.actions"><MkButton primary :wait="saving" :disabled="saving || mode === savedMode" @click="save">{{ t.modeSave }}</MkButton><p v-if="saved" role="status">{{ t.modeSaved }}</p></div>
				<p v-if="error" role="alert" :class="$style.error">{{ error }}</p>
			</template>
		</section>
		<CommunitySurface section="review" embedded :publicationMode="savedMode" :signedIn="!!$i" :moderator="iAmModerator" :registrationClosed="instance.disableRegistration" :gateway="gateway" @navigate="router.push($event)"/>
	</div>
</PageWithHeader>
</template>

<script lang="ts" setup>
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { apiUrl } from '@@/js/config.js';
import CommunitySurface from '@/pages/community/surface.vue';
import { createCommunityGateway } from '@/pages/community/api.js';
import { moderationText as t } from '@/pages/community/moderation-copy.js';
import MkButton from '@/components/MkButton.vue';
import { $i, iAmModerator } from '@/i.js';
import { instance, fetchInstance } from '@/instance.js';
import { misskeyApi } from '@/utility/misskey-api.js';
import { useRouter } from '@/router.js';
import { definePage } from '@/page.js';

const router = useRouter();
const mode = ref<'before' | 'after'>('before');
const savedMode = ref<'before' | 'after'>('before');
const loading = ref(false), loaded = ref(false), saving = ref(false), saved = ref(false);
const error = ref('');
let disposed = false;
const gateway = createCommunityGateway({ apiUrl, getToken: () => $i?.token, chooseFiles: async () => [] });
watch(mode, () => { saved.value = false; error.value = ''; });

async function load() {
	if (!$i?.isAdmin || loading.value) return;
	loading.value = true;
	try {
		const meta = await misskeyApi('admin/meta');
		if (disposed) return;
		mode.value = meta.clientOptions.communityPublicationMode === 'after' ? 'after' : 'before';
		savedMode.value = mode.value;
		loaded.value = true;
	} catch { loaded.value = false; } finally { loading.value = false; }
}

async function save() {
	if (!$i?.isAdmin || !loaded.value || saving.value) return;
	const value = mode.value;
	saving.value = true; saved.value = false; error.value = '';
	try {
		await misskeyApi('admin/update-meta', { clientOptions: { communityPublicationMode: value } });
		if (disposed) return;
		savedMode.value = value;
		instance.clientOptions.communityPublicationMode = value;
		void fetchInstance(true).catch(() => {});
		saved.value = true;
	} catch { if (!disposed) error.value = t.modeSaveFailed; } finally { saving.value = false; }
}

onMounted(load);
onBeforeUnmount(() => { disposed = true; });
definePage(() => ({ title: t.review, icon: 'ti ti-shield-check' }));
</script>

<style lang="scss" module>
.root { width: 100%; min-width: 0; box-sizing: border-box; padding: 24px 32px 48px; h1 { margin: 0 0 24px; font-size: 24px; } }
.settings { margin-bottom: 16px; padding-bottom: 24px; border-bottom: 1px solid var(--MI_THEME-divider); h2 { margin: 0 0 8px; font-size: 18px; } p { margin: 8px 0; line-height: 1.7; overflow-wrap: anywhere; } }
.modes { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; padding: 0; margin: 20px 0 12px; border: 0; label { display: flex; gap: 12px; padding: 16px; border: 1px solid var(--MI_THEME-inputBorder); border-radius: 12px; cursor: pointer; } label:has(input:checked) { border-color: var(--MI_THEME-accent); background: var(--MI_THEME-accentedBg); } label:focus-within { outline: 2px solid var(--MI_THEME-focus); outline-offset: 3px; } input { width: 18px; height: 18px; flex: 0 0 auto; accent-color: var(--MI_THEME-accent); margin-top: 3px; } strong { display: block; margin-bottom: 6px; } span { line-height: 1.6; } }
.actions { display: flex; align-items: center; flex-wrap: wrap; gap: 12px; margin-top: 16px; > button { min-height: 44px; } }
.hint { font-size: 13px; }
.error { color: var(--MI_THEME-error); }
@media (max-width: 650px) { .root { padding: 20px 16px 32px; } .modes { grid-template-columns: minmax(0, 1fr); } }
</style>
