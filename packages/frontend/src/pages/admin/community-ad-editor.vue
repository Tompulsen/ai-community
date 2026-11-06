<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<section :class="$style.editor" :aria-labelledby="headingId" :aria-busy="busy" :data-testid="`ad-editor-${position + 1}`">
	<header :class="$style.heading"><h2 :id="headingId"><span :class="$style.number">{{ position + 1 }}</span>{{ t.positions[position] }}</h2><span :class="[$style.status, { [$style.published]: published }]">{{ published ? t.published : t.draft }}</span></header>
	<div :class="$style.imageRow">
		<div :class="$style.preview" :aria-label="t.preview"><img v-if="preview && !imageFailed" :src="preview" :alt="draft.title || t.image" referrerpolicy="no-referrer" @error="imageFailed = true"/><span v-else><i :class="imageFailed ? 'ti ti-photo-off' : 'ti ti-photo-plus'" aria-hidden="true"></i>{{ imageFailed ? t.imageFailed : t.image }}</span></div>
		<div :class="$style.uploadControls">
			<input ref="fileInput" type="file" :accept="homeImageTypes.join(',')" hidden :disabled="busy" @change="uploadImage"/>
			<div :class="$style.actions"><MkButton :disabled="busy" @click="fileInput?.click()"><i class="ti ti-upload" aria-hidden="true"></i>{{ t.upload }}</MkButton><MkButton :disabled="busy" @click="chooseImage">{{ t.choose }}</MkButton></div>
			<p :class="$style.hint">{{ t.imageHint }}</p>
			<div v-if="uploading" :class="$style.progress" role="status"><progress :value="progress" max="100"></progress><span>{{ progress }}%</span><button type="button" class="_button" @click="cancelUpload">{{ t.cancel }}</button></div>
		</div>
	</div>
	<MkInput v-model="draft.title" :disabled="busy" :data-testid="`ad-title-${position + 1}`"><template #label>{{ t.name }}</template><template #caption>{{ draft.title.length }} / 80</template></MkInput>
	<MkInput v-model="draft.imageUrl" type="url" :disabled="busy" :spellcheck="false" autocapitalize="none" autocomplete="off" placeholder="https://" :data-testid="`ad-image-${position + 1}`"><template #label>{{ t.image }}</template></MkInput>
	<button v-if="draft.imageUrl" type="button" class="_button" :class="$style.remove" :disabled="busy" @click="draft.imageUrl = ''">{{ t.remove }}</button>
	<MkInput v-model="draft.linkUrl" type="url" :disabled="busy" :spellcheck="false" autocapitalize="none" autocomplete="off" placeholder="https://" :data-testid="`ad-link-${position + 1}`"><template #label>{{ t.link }}</template></MkInput>
	<p :class="$style.hint">{{ t.linkHint }}</p>
	<label :class="$style.publish"><input v-model="draft.enabled" type="checkbox" :disabled="busy" :data-testid="`ad-enabled-${position + 1}`"/><span><strong>{{ t.enabled }}</strong><small>{{ t.enabledHint }}</small></span></label>
	<p v-if="error" :class="$style.error" role="alert">{{ error }}</p>
	<div :class="$style.actions"><MkButton primary :disabled="busy" :wait="saving" :data-testid="`ad-save-${position + 1}`" @click="save"><i class="ti ti-check" aria-hidden="true"></i>{{ t.save }}</MkButton><p v-if="saved" role="status" :class="$style.saved">{{ t.saved }}</p></div>
</section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, useId, useTemplateRef, watch } from 'vue';
import { url as siteUrl } from '@@/js/config.js';
import type { CommunityAd, CommunityAdKey } from '@/pages/community/ads.js';
import { adText as t, emptyAd, normalizeAdUrl } from '@/pages/community/ads.js';
import { homeImageTypes, maxHomeImageSize } from '@/pages/home/image.js';
import MkButton from '@/components/MkButton.vue';
import MkInput from '@/components/MkInput.vue';
import { uploadFile } from '@/utility/drive.js';
import { misskeyApi } from '@/utility/misskey-api.js';
import { instance, fetchInstance } from '@/instance.js';
import { $i } from '@/i.js';
import * as os from '@/os.js';

const props = defineProps<{ slotKey: CommunityAdKey; position: number; initial?: CommunityAd | null }>();
const draft = reactive({ ...emptyAd(), ...props.initial });
const published = ref(!!props.initial?.enabled);
const headingId = useId();
const fileInput = useTemplateRef('fileInput');
const uploading = ref(false);
const selecting = ref(false);
const saving = ref(false);
const progress = ref(0);
const saved = ref(false);
const error = ref('');
const imageFailed = ref(false);
const busy = computed(() => uploading.value || selecting.value || saving.value);
const preview = computed(() => normalizeAdUrl(draft.imageUrl, siteUrl, true));
let disposed = false;
let cancelled = false;
let abortUpload: (() => void) | undefined;
let closePicker: (() => void) | undefined;

watch(draft, () => { saved.value = false; error.value = ''; }, { flush: 'sync' });
watch(preview, () => { imageFailed.value = false; });

function validate(file: { type: string; size: number; isSensitive?: boolean }): boolean {
	if (!homeImageTypes.includes(file.type) || file.isSensitive) { error.value = t.invalidImage; return false; }
	if (file.size > maxHomeImageSize) { error.value = t.tooLarge; return false; }
	return true;
}

function cancelUpload() { cancelled = true; abortUpload?.(); }

async function uploadImage(event: Event) {
	const input = event.target as HTMLInputElement;
	const file = input.files?.[0]; input.value = '';
	if (!file || busy.value || !$i?.isAdmin) return;
	error.value = ''; saved.value = false;
	if (!validate(file)) return;
	uploading.value = true; progress.value = 0; cancelled = false;
	let timeout: number | undefined;
	try {
		const upload = uploadFile(file, { name: file.name, onProgress: ({ loaded, total }) => { progress.value = total > 0 ? Math.round(loaded / total * 100) : 0; } });
		abortUpload = upload.abort; timeout = window.setTimeout(upload.abort, 120000);
		const uploaded = await upload.filePromise;
		if (!disposed && !cancelled && validate(uploaded)) draft.imageUrl = uploaded.url;
	} catch { if (!disposed && !cancelled) error.value = t.uploadFailed; } finally { window.clearTimeout(timeout); abortUpload = undefined; uploading.value = false; }
}

async function chooseImage() {
	if (busy.value || !$i?.isAdmin) return;
	error.value = ''; selecting.value = true;
	try {
		const { dispose } = await os.popupAsyncWithDialog(import('@/components/MkDriveFileSelectDialog.vue').then(x => x.default), { multiple: false, excludeSensitive: true }, {
			done: files => { const file = files?.[0]; if (file && !disposed && validate(file)) draft.imageUrl = file.url; },
			closed: () => { dispose(); closePicker = undefined; selecting.value = false; },
		});
		closePicker = dispose;
		if (disposed) dispose();
	} catch { selecting.value = false; if (!disposed) error.value = t.uploadFailed; }
}

async function save() {
	if (busy.value || !$i?.isAdmin) return;
	error.value = ''; saved.value = false;
	const imageUrl = draft.imageUrl.trim() ? normalizeAdUrl(draft.imageUrl, siteUrl, true) : '';
	const linkUrl = draft.linkUrl.trim() ? normalizeAdUrl(draft.linkUrl, siteUrl) : '';
	if (draft.title.trim().length > 80) { error.value = t.titleTooLong; return; }
	if (imageUrl == null || linkUrl == null) { error.value = t.invalid; return; }
	if (draft.enabled && (!draft.title.trim() || !imageUrl || !linkUrl)) { error.value = t.required; return; }
	const ad: CommunityAd = { enabled: draft.enabled, title: draft.title.trim(), imageUrl, linkUrl };
	saving.value = true;
	let timeout: number | undefined;
	try {
		if (ad.enabled) {
			const image = new Image(); image.referrerPolicy = 'no-referrer'; image.src = imageUrl;
			await Promise.race([image.decode(), new Promise<never>((_resolve, reject) => { timeout = window.setTimeout(() => reject(new Error('image-preview')), 15000); })]).catch(() => { throw new Error('image-preview'); });
			window.clearTimeout(timeout);
		}
		if (disposed) return;
		await misskeyApi('admin/update-meta', { clientOptions: { [props.slotKey]: ad } });
		if (ad.enabled) instance.clientOptions[props.slotKey] = ad;
		else delete instance.clientOptions[props.slotKey];
		Object.assign(draft, ad); published.value = ad.enabled; saved.value = true;
		await fetchInstance(true).catch(() => {});
	} catch (reason) { if (!disposed) error.value = reason instanceof Error && reason.message === 'image-preview' ? t.imageFailed : t.saveFailed; } finally { window.clearTimeout(timeout); saving.value = false; }
}

onBeforeUnmount(() => { disposed = true; abortUpload?.(); closePicker?.(); });
</script>

<style lang="scss" module>
.editor { min-width: 0; display: flex; flex-direction: column; gap: 16px; padding: 24px; background: var(--MI_THEME-panel); border: 1px solid var(--MI_THEME-divider); border-radius: 12px; }
.heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; h2 { margin: 0; display: flex; align-items: center; gap: 10px; font-size: 17px; } }
.number { display: grid; place-items: center; width: 30px; height: 30px; background: var(--MI_THEME-bg); border: 1px solid var(--MI_THEME-divider); border-radius: 8px; font-size: 13px; font-variant-numeric: tabular-nums; }
.status { font-size: 12px; padding: 5px 8px; border-radius: 6px; background: var(--MI_THEME-bg); }
.published { color: var(--MI_THEME-accent); background: var(--MI_THEME-accentedBg); }
.imageRow { display: flex; flex-wrap: wrap; align-items: start; gap: 16px; }
.preview { width: 120px; aspect-ratio: 1; flex-shrink: 0; display: grid; place-items: center; overflow: hidden; background: var(--MI_THEME-bg); border: 1px solid var(--MI_THEME-divider); border-radius: 8px; img { width: 100%; height: 100%; object-fit: cover; } span { display: flex; flex-direction: column; gap: 8px; padding: 10px; text-align: center; font-size: 12px; line-height: 1.5; } i { font-size: 24px; } }
.uploadControls { flex: 1 1 180px; min-width: 0; display: flex; flex-direction: column; gap: 12px; }
.actions { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; > button { min-height: 44px; } }
.hint { margin: 0; font-size: 12px; line-height: 1.8; overflow-wrap: anywhere; }
.remove { color: var(--MI_THEME-accent); align-self: start; min-height: 32px; font-size: 13px; }
.publish { display: flex; align-items: center; gap: 12px; padding: 12px; border: 1px solid var(--MI_THEME-inputBorder); border-radius: 8px; cursor: pointer; input { accent-color: var(--MI_THEME-accent); width: 18px; height: 18px; flex-shrink: 0; } strong { display: block; font-size: 14px; } small { display: block; font-size: 12px; line-height: 1.7; margin-top: 4px; } }
.progress { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; font-size: 12px; progress { width: 100%; accent-color: var(--MI_THEME-accent); } button { min-height: 32px; text-decoration: underline; } }
.error { margin: 0; font-size: 13px; line-height: 1.7; color: var(--MI_THEME-error); }
.saved { margin: 0; font-size: 13px; color: var(--MI_THEME-accent); }
.editor :focus-visible { outline: 2px solid var(--MI_THEME-accent); outline-offset: 3px; }
@media (max-width: 600px) { .editor { padding: 16px; } }
</style>
