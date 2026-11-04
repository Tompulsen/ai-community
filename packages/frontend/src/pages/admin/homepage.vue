<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<PageWithHeader :tabs="[]">
	<div :class="$style.settings" data-testid="admin-homepage" :aria-busy="loading || saving">
		<h1>{{ homeText.settings }}</h1>
		<p>{{ homeText.settingsDescription }}</p>
		<p v-if="!$i?.isAdmin" role="alert">{{ homeText.adminOnly }}</p>
		<MkLoading v-else-if="loading"/>
		<div v-else-if="loadFailed" class="_gaps_s" role="alert"><p>{{ homeText.loadFailed }}</p><MkButton @click="load">{{ homeText.retry }}</MkButton></div>
		<div v-else-if="loaded" class="_gaps_m">
			<section :class="$style.editor" :aria-label="homeText.showcaseMode">
				<div :class="$style.previewArea">
					<HomeShowcase :imageUrl="showcasePreviewUrl" :logoUrl="instance.iconUrl || '/favicon.ico'" :mode="showcaseMode" :refreshKey="previewRevision" @status="featuredState = $event"/>
					<p v-if="showcaseMode === 'custom' && !imageUrl.trim()" :class="$style.hint">{{ homeText.defaultPreview }}</p>
				</div>
				<div class="_gaps_m" :class="$style.controls">
					<fieldset :class="$style.modeOptions" :disabled="busy" data-testid="home-showcase-mode">
						<legend>{{ homeText.showcaseMode }}</legend>
						<label><input v-model="showcaseMode" type="radio" name="home-showcase-mode" value="custom">{{ homeText.customMode }}</label>
						<label><input v-model="showcaseMode" type="radio" name="home-showcase-mode" value="popular">{{ homeText.popularMode }}</label>
					</fieldset>
					<div v-if="showcaseMode === 'popular'" class="_gaps_m">
						<p>{{ homeText.popularHint }}</p>
						<p :class="$style.hint">{{ homeText.popularFallback }}</p>
						<p role="status" :class="{ [$style.error]: featuredState === 'error' }" data-testid="home-popular-status">{{ featuredMessage }}</p>
						<MkButton :disabled="busy || featuredState === 'loading'" data-testid="home-popular-refresh" @click="previewRevision++">{{ homeText.refreshPopular }}</MkButton>
					</div>
					<template v-else>
					<h2>{{ homeText.imageLabel }}</h2>
					<p>{{ homeText.formats }}</p>
					<p :class="$style.hint">{{ homeText.sizeHint }}</p>
					<div :class="$style.actions">
						<MkButton :disabled="busy" data-testid="home-image-upload" @click="fileInput?.click()"><i class="ti ti-upload" aria-hidden="true"></i> {{ homeText.upload }}</MkButton>
						<MkButton :disabled="busy" @click="chooseImage">{{ homeText.choose }}</MkButton>
						<MkButton :disabled="busy || !imageUrl" @click="imageUrl = ''">{{ homeText.reset }}</MkButton>
					</div>
					<input ref="fileInput" type="file" :accept="homeImageTypes.join(',')" hidden data-testid="home-image-file" @change="uploadImage">
					<div v-if="uploading" class="_gaps_s" role="status">
						<span>{{ homeText.uploading }} {{ progress }}%</span>
						<progress :value="progress" max="100" :aria-label="homeText.uploading"></progress>
						<MkButton small @click="cancelUpload">{{ homeText.cancelUpload }}</MkButton>
					</div>
					<MkInput v-model="imageUrl" type="url" :disabled="busy" :spellcheck="false" autocapitalize="none" autocomplete="off" data-testid="home-image-url">
						<template #label>{{ homeText.imageUrl }}</template>
						<template #caption>{{ homeText.urlHint }}</template>
					</MkInput>
					</template>
					<p v-if="error || (showcaseMode === 'custom' && invalidUrl)" :class="$style.error" role="alert">{{ error || homeText.invalidUrl }}</p>
				</div>
			</section>
			<div :class="$style.actions">
				<MkButton primary :wait="saving" :disabled="busy || (showcaseMode === 'custom' && invalidUrl)" data-testid="home-image-save" @click="save">{{ homeText.save }}</MkButton>
				<MkA to="/" class="_link">{{ homeText.preview }} <i class="ti ti-arrow-up-right" aria-hidden="true"></i></MkA>
			</div>
			<p v-if="saved" :class="$style.saved" role="status" data-testid="home-image-saved"><i class="ti ti-circle-check" aria-hidden="true"></i> {{ homeText.saved }}</p>
			<div :class="$style.related"><p>{{ homeText.creationSettings }}</p><MkA to="/admin/creation-links" class="_link">{{ homeText.editCreation }} <i class="ti ti-arrow-right" aria-hidden="true"></i></MkA></div>
		</div>
	</div>
</PageWithHeader>
</template>

<script lang="ts" setup>
import { computed, onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from 'vue';
import { url as siteUrl } from '@@/js/config.js';
import HomeShowcase from '@/pages/home/showcase.vue';
import { homeText } from '@/pages/home/copy.js';
import { homeImageTypes, maxHomeImageSize, normalizeHomeImageUrl } from '@/pages/home/image.js';
import type { FeaturedState, HomeShowcaseMode } from '@/pages/home/featured.js';
import MkButton from '@/components/MkButton.vue';
import MkInput from '@/components/MkInput.vue';
import { $i } from '@/i.js';
import { instance, fetchInstance } from '@/instance.js';
import { misskeyApi } from '@/utility/misskey-api.js';
import { uploadFile } from '@/utility/drive.js';
import { definePage } from '@/page.js';
import * as os from '@/os.js';

const imageUrl = ref('');
const savedImageUrl = ref('');
const showcaseMode = ref<HomeShowcaseMode>('custom');
const featuredState = ref<FeaturedState>('custom');
const previewRevision = ref(0);
const featuredMessage = computed(() => featuredState.value === 'loading' ? homeText.popularLoading : featuredState.value === 'error' ? homeText.popularFailed : featuredState.value === 'ready' ? homeText.popularReady : homeText.popularEmpty);
const fileInput = useTemplateRef('fileInput');
const loading = ref(false);
const loaded = ref(false);
const loadFailed = ref(false);
const saving = ref(false);
const uploading = ref(false);
const selecting = ref(false);
const progress = ref(0);
const error = ref('');
const saved = ref(false);
const busy = computed(() => saving.value || uploading.value || selecting.value);
const previewUrl = computed(() => normalizeHomeImageUrl(imageUrl.value, siteUrl));
const showcasePreviewUrl = computed(() => showcaseMode.value === 'popular' ? normalizeHomeImageUrl(savedImageUrl.value, siteUrl) : previewUrl.value);
const invalidUrl = computed(() => !!imageUrl.value.trim() && !previewUrl.value);
let disposed = false;
let abortUpload: (() => void) | undefined;
let cancelled = false;

watch([imageUrl, showcaseMode], () => { saved.value = false; error.value = ''; });

async function load() {
	if (!$i?.isAdmin || loading.value) return;
	loading.value = true;
	loadFailed.value = false;
	try {
		const meta = await misskeyApi('admin/meta');
		if (disposed) return;
		imageUrl.value = meta.mascotImageUrl ?? '';
		savedImageUrl.value = imageUrl.value;
		showcaseMode.value = meta.clientOptions.homeShowcaseMode === 'popular' ? 'popular' : 'custom';
		loaded.value = true;
	} catch { loadFailed.value = true; } finally { loading.value = false; }
}

function validate(file: { type: string; size: number; isSensitive?: boolean }): boolean {
	if (!homeImageTypes.includes(file.type) || file.isSensitive) { error.value = homeText.invalidImage; return false; }
	if (file.size > maxHomeImageSize) { error.value = homeText.tooLarge; return false; }
	return true;
}

function cancelUpload() { cancelled = true; abortUpload?.(); }

async function uploadImage(event: Event) {
	const input = event.target as HTMLInputElement;
	const file = input.files?.[0];
	input.value = '';
	if (!file || busy.value || !$i?.isAdmin || !loaded.value) return;
	error.value = '';
	saved.value = false;
	if (!validate(file)) return;
	uploading.value = true;
	progress.value = 0;
	cancelled = false;
	let timeout: number | undefined;
	try {
		// Upload the original bytes: resizing or canvas conversion would flatten animations.
		const upload = uploadFile(file, { name: file.name, onProgress: ({ loaded: sent, total }) => { progress.value = total > 0 ? Math.round(sent / total * 100) : 0; } });
		abortUpload = upload.abort;
		timeout = window.setTimeout(upload.abort, 120000);
		const uploaded = await upload.filePromise;
		if (!disposed && !cancelled && validate(uploaded)) imageUrl.value = uploaded.url;
	} catch {
		if (!disposed && !cancelled) error.value = homeText.uploadFailed;
	} finally {
		window.clearTimeout(timeout);
		abortUpload = undefined;
		uploading.value = false;
	}
}

async function chooseImage() {
	if (busy.value || !$i?.isAdmin || !loaded.value) return;
	error.value = '';
	selecting.value = true;
	try {
		const { dispose } = await os.popupAsyncWithDialog(import('@/components/MkDriveFileSelectDialog.vue').then(x => x.default), { multiple: false, excludeSensitive: true }, {
			done: files => {
				const file = files?.[0];
				if (file && !disposed && validate(file)) imageUrl.value = file.url;
			},
			closed: () => { dispose(); selecting.value = false; },
		});
	} catch { selecting.value = false; if (!disposed) error.value = homeText.uploadFailed; }
}

async function save() {
	if (!$i?.isAdmin || !loaded.value || busy.value || (showcaseMode.value === 'custom' && invalidUrl.value)) return;
	const value = previewUrl.value;
	saving.value = true;
	error.value = '';
	saved.value = false;
	let previewTimeout: number | undefined;
	try {
		if (showcaseMode.value === 'custom' && value) {
			const image = new Image();
			image.src = value;
			await Promise.race([
				image.decode(),
				new Promise<never>((_resolve, reject) => { previewTimeout = window.setTimeout(() => reject(new Error('image-preview')), 15000); }),
			]).catch(() => { throw new Error('image-preview'); });
			window.clearTimeout(previewTimeout);
		}
		if (disposed) return;
		const clientOptions = { homeShowcaseMode: showcaseMode.value };
		await misskeyApi('admin/update-meta', { clientOptions, ...(showcaseMode.value === 'custom' ? { mascotImageUrl: value } : {}) });
		Object.assign(instance.clientOptions, clientOptions);
		if (showcaseMode.value === 'custom') {
			instance.mascotImageUrl = value ?? '/assets/ai.png';
			savedImageUrl.value = value ?? '';
		}
		await fetchInstance(true).catch(() => {});
		saved.value = true;
	} catch (reason) {
		error.value = reason instanceof Error && reason.message === 'image-preview' ? homeText.imageFailed : homeText.saveFailed;
	} finally { window.clearTimeout(previewTimeout); saving.value = false; }
}

onMounted(load);
onBeforeUnmount(() => { disposed = true; abortUpload?.(); });
definePage(() => ({ title: homeText.settings, icon: 'ti ti-home-edit' }));
</script>

<style lang="scss" module>
@use '../home/palette.scss';
.settings { padding: 28px 32px 48px; max-width: 1280px; margin: 0 auto; box-sizing: border-box; h1 { margin: 0 0 12px; font-size: 24px; } h2 { margin: 0; font-size: 18px; } p { line-height: 1.7; overflow-wrap: anywhere; } > p { margin: 0 0 28px; } }
.editor { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.1fr); gap: 40px; padding: 24px; background: var(--MI_THEME-panel); border-radius: var(--MI-radius); }
.previewArea { @include palette.home; padding: 6px 10px 6px 0; align-self: start; }
.controls { min-width: 0; p { margin: 0; } }
.controls input:not([type='radio']) { border-color: var(--MI_THEME-inputBorder); min-height: 44px; }
.modeOptions { margin: 0; padding: 0; border: 0; display: flex; flex-direction: column; gap: 8px; legend { padding: 0 0 12px; font-size: 18px; font-weight: 700; } label { display: flex; align-items: center; gap: 10px; padding: 10px 12px; min-height: 44px; box-sizing: border-box; border: 1px solid var(--MI_THEME-inputBorder); border-radius: 8px; cursor: pointer; } label:has(input:checked) { border-color: var(--MI_THEME-accent); background: var(--MI_THEME-accentedBg); } input { accent-color: var(--MI_THEME-accent); width: 18px; height: 18px; flex-shrink: 0; } label:focus-within { outline: 2px solid var(--MI_THEME-accent); outline-offset: 2px; } }
.hint { font-size: 13px; color: var(--MI_THEME-fg); }
.actions { display: flex; align-items: center; flex-wrap: wrap; gap: 12px; > button { min-height: 44px; } > a { min-height: 44px; display: inline-flex; align-items: center; } }
.error { color: var(--MI_THEME-error); }
.saved { display: flex; align-items: center; gap: 8px; margin: 0; animation: saved .18s ease-out; i { color: var(--MI_THEME-accent); font-size: 20px; } }
@keyframes saved { from { transform: translateY(3px); } to { transform: translateY(0); } }
.related { padding-top: 16px; border-top: 1px solid var(--MI_THEME-divider); p { margin: 0 0 8px; } }
@media (max-width: 900px) { .editor { grid-template-columns: minmax(0, 1fr); gap: 28px; } .previewArea { max-width: 480px; width: 100%; box-sizing: border-box; } }
@media (max-width: 600px) { .settings { padding: 24px 16px; } .editor { padding: 16px; } }
@media (prefers-reduced-motion: reduce) { .saved { animation: none; } }
</style>
