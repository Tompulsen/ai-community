<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<PageWithHeader :tabs="headerTabs">
	<div class="_spacer" style="--MI_SPACER-w: 700px; --MI_SPACER-min: 16px; --MI_SPACER-max: 32px;">
		<SearchMarker path="/admin/branding" :label="i18n.ts.branding" :keywords="['branding']" icon="ti ti-paint">
			<div class="_gaps_m">
				<SearchMarker :keywords="['logo', 'icon', 'image', '项目 Logo']">
					<section class="_gaps_m" :aria-label="i18n.ts._communityBranding.logo" data-testid="admin-logo-settings">
						<div>
							<h2 :class="$style.logoHeading"><SearchLabel>{{ i18n.ts._communityBranding.logo }}</SearchLabel></h2>
							<p :class="$style.logoDescription">{{ i18n.ts._communityBranding.description }}</p>
						</div>
						<div :class="$style.logoEditor" :aria-busy="uploadingLogo">
							<div :class="$style.logoPreview">
								<img v-if="!logoUrlInvalid && !logoPreviewFailed" :key="logoPreviewUrl" :src="logoPreviewUrl" :alt="i18n.ts._communityBranding.preview" data-testid="admin-logo-preview" @error="logoPreviewFailed = true"/>
								<i v-else class="ti ti-photo-off" aria-hidden="true"></i>
							</div>
							<div class="_gaps_s" :class="$style.logoControls">
								<div :class="$style.logoActions">
									<MkButton :disabled="saving || uploadingLogo" :wait="uploadingLogo" data-testid="admin-logo-upload" @click="logoFileInput?.click()"><i class="ti ti-upload" aria-hidden="true"></i> {{ i18n.ts._communityBranding.upload }}</MkButton>
									<MkButton :disabled="saving || uploadingLogo" data-testid="admin-logo-drive" @click="selectLogoFromDrive"><i class="ti ti-cloud" aria-hidden="true"></i> {{ i18n.ts.fromDrive }}</MkButton>
									<MkButton :disabled="saving || uploadingLogo || !iconUrl" data-testid="admin-logo-reset" @click="resetLogo">{{ i18n.ts._communityBranding.reset }}</MkButton>
								</div>
								<p :class="$style.logoDescription">{{ i18n.ts._communityBranding.formats }}</p>
								<p v-if="uploadingLogo" role="status">{{ i18n.ts.uploading }} {{ logoProgress }}%</p>
							</div>
						</div>
						<input ref="logoFileInput" type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden data-testid="admin-logo-file" @change="uploadLogo">
						<p v-if="logoError || logoUrlInvalid || logoPreviewFailed" :class="$style.logoError" role="alert" data-testid="admin-logo-error">{{ logoError || (logoUrlInvalid ? i18n.ts._communityBranding.invalidUrl : i18n.ts._communityBranding.previewFailed) }}</p>
						<MkInput v-model="iconUrl" type="url" :disabled="saving || uploadingLogo" data-testid="admin-logo-url">
							<template #prefix><i class="ti ti-link" aria-hidden="true"></i></template>
							<template #label>{{ i18n.ts._communityBranding.imageUrl }}</template>
							<template #caption>{{ i18n.ts._communityBranding.saveHint }}</template>
						</MkInput>
					</section>
				</SearchMarker>

				<SearchMarker :keywords="['entrance', 'welcome', 'landing', 'front', 'home', 'page', 'style']">
					<MkRadios
						v-model="entrancePageStyle"
						:options="[
							{ value: 'classic' },
							{ value: 'simple' },
						]"
					>
						<template #label><SearchLabel>{{ i18n.ts._serverSettings.entrancePageStyle }}</SearchLabel></template>
					</MkRadios>
				</SearchMarker>

				<SearchMarker :keywords="['timeline']">
					<MkSwitch v-model="showTimelineForVisitor">
						<template #label><SearchLabel>{{ i18n.ts._serverSettings.showTimelineForVisitor }}</SearchLabel></template>
					</MkSwitch>
				</SearchMarker>

				<SearchMarker :keywords="['activity', 'activities']">
					<MkSwitch v-model="showActivitiesForVisitor">
						<template #label><SearchLabel>{{ i18n.ts._serverSettings.showActivitiesForVisitor }}</SearchLabel></template>
					</MkSwitch>
				</SearchMarker>

				<SearchMarker :keywords="['icon', 'image']">
					<MkInput v-model="app192IconUrl" type="url">
						<template #prefix><i class="ti ti-link"></i></template>
						<template #label><SearchLabel>{{ i18n.ts._serverSettings.iconUrl }} (App/192px)</SearchLabel></template>
						<template #caption>
							<div>{{ i18n.tsx._serverSettings.appIconDescription({ host: instance.name ?? host }) }}</div>
							<div>({{ i18n.ts._serverSettings.appIconUsageExample }})</div>
							<div>{{ i18n.ts._serverSettings.appIconStyleRecommendation }}</div>
							<div><strong>{{ i18n.tsx._serverSettings.appIconResolutionMustBe({ resolution: '192x192px' }) }}</strong></div>
						</template>
					</MkInput>
				</SearchMarker>

				<SearchMarker :keywords="['icon', 'image']">
					<MkInput v-model="app512IconUrl" type="url">
						<template #prefix><i class="ti ti-link"></i></template>
						<template #label><SearchLabel>{{ i18n.ts._serverSettings.iconUrl }} (App/512px)</SearchLabel></template>
						<template #caption>
							<div>{{ i18n.tsx._serverSettings.appIconDescription({ host: instance.name ?? host }) }}</div>
							<div>({{ i18n.ts._serverSettings.appIconUsageExample }})</div>
							<div>{{ i18n.ts._serverSettings.appIconStyleRecommendation }}</div>
							<div><strong>{{ i18n.tsx._serverSettings.appIconResolutionMustBe({ resolution: '512x512px' }) }}</strong></div>
						</template>
					</MkInput>
				</SearchMarker>

				<SearchMarker :keywords="['banner', 'image']">
					<MkInput v-model="bannerUrl" type="url">
						<template #prefix><i class="ti ti-link"></i></template>
						<template #label><SearchLabel>{{ i18n.ts.bannerUrl }}</SearchLabel></template>
					</MkInput>
				</SearchMarker>

				<SearchMarker :keywords="['background', 'image']">
					<MkInput v-model="backgroundImageUrl" type="url">
						<template #prefix><i class="ti ti-link"></i></template>
						<template #label><SearchLabel>{{ i18n.ts.backgroundImageUrl }}</SearchLabel></template>
					</MkInput>
				</SearchMarker>

				<SearchMarker :keywords="['image']">
					<MkInput v-model="notFoundImageUrl" type="url">
						<template #prefix><i class="ti ti-link"></i></template>
						<template #label><SearchLabel>{{ i18n.ts.notFoundDescription }}</SearchLabel></template>
					</MkInput>
				</SearchMarker>

				<SearchMarker :keywords="['image']">
					<MkInput v-model="infoImageUrl" type="url">
						<template #prefix><i class="ti ti-link"></i></template>
						<template #label><SearchLabel>{{ i18n.ts.nothing }}</SearchLabel></template>
					</MkInput>
				</SearchMarker>

				<SearchMarker :keywords="['image']">
					<MkInput v-model="serverErrorImageUrl" type="url">
						<template #prefix><i class="ti ti-link"></i></template>
						<template #label><SearchLabel>{{ i18n.ts.somethingHappened }}</SearchLabel></template>
					</MkInput>
				</SearchMarker>

				<SearchMarker :keywords="['theme', 'color']">
					<MkColorInput v-model="themeColor">
						<template #label><SearchLabel>{{ i18n.ts.themeColor }}</SearchLabel></template>
					</MkColorInput>
				</SearchMarker>

				<SearchMarker :keywords="['theme', 'default', 'light']">
					<MkTextarea v-model="defaultLightTheme">
						<template #label><SearchLabel>{{ i18n.ts.instanceDefaultLightTheme }}</SearchLabel></template>
						<template #caption>{{ i18n.ts.instanceDefaultThemeDescription }}</template>
					</MkTextarea>
				</SearchMarker>

				<SearchMarker :keywords="['theme', 'default', 'dark']">
					<MkTextarea v-model="defaultDarkTheme">
						<template #label><SearchLabel>{{ i18n.ts.instanceDefaultDarkTheme }}</SearchLabel></template>
						<template #caption>{{ i18n.ts.instanceDefaultThemeDescription }}</template>
					</MkTextarea>
				</SearchMarker>

				<SearchMarker>
					<MkInput v-model="repositoryUrl" type="url">
						<template #prefix><i class="ti ti-link"></i></template>
						<template #label><SearchLabel>{{ i18n.ts.repositoryUrl }}</SearchLabel></template>
					</MkInput>
				</SearchMarker>

				<SearchMarker>
					<MkInput v-model="feedbackUrl" type="url">
						<template #prefix><i class="ti ti-link"></i></template>
						<template #label><SearchLabel>{{ i18n.ts.feedbackUrl }}</SearchLabel></template>
					</MkInput>
				</SearchMarker>

				<SearchMarker>
					<MkTextarea v-model="manifestJsonOverride">
						<template #label><SearchLabel>{{ i18n.ts._serverSettings.manifestJsonOverride }}</SearchLabel></template>
					</MkTextarea>
				</SearchMarker>
			</div>
		</SearchMarker>
	</div>
	<template #footer>
		<div :class="$style.footer">
			<div class="_spacer" style="--MI_SPACER-w: 700px; --MI_SPACER-min: 16px; --MI_SPACER-max: 16px;">
				<MkButton primary rounded :disabled="uploadingLogo || logoUrlInvalid || logoPreviewFailed" :wait="saving" data-testid="admin-branding-save" @click="save"><i class="ti ti-check"></i> {{ i18n.ts.save }}</MkButton>
			</div>
		</div>
	</template>
</PageWithHeader>
</template>

<script lang="ts" setup>
import { ref, computed, watch, useTemplateRef, onBeforeUnmount } from 'vue';
import JSON5 from 'json5';
import * as Misskey from 'misskey-js';
import { host } from '@@/js/config.js';
import MkInput from '@/components/MkInput.vue';
import MkTextarea from '@/components/MkTextarea.vue';
import * as os from '@/os.js';
import { misskeyApi } from '@/utility/misskey-api.js';
import { instance, fetchInstance } from '@/instance.js';
import { i18n } from '@/i18n.js';
import { definePage } from '@/page.js';
import MkButton from '@/components/MkButton.vue';
import MkColorInput from '@/components/MkColorInput.vue';
import MkRadios from '@/components/MkRadios.vue';
import MkSwitch from '@/components/MkSwitch.vue';
import { chooseDriveFile, uploadFile } from '@/utility/drive.js';

const meta = await misskeyApi('admin/meta');

// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
const entrancePageStyle = ref<Misskey.entities.MetaClientOptions['entrancePageStyle']>(meta.clientOptions.entrancePageStyle ?? 'classic');
// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
const showTimelineForVisitor = ref<Misskey.entities.MetaClientOptions['showTimelineForVisitor']>(meta.clientOptions.showTimelineForVisitor ?? true);
// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
const showActivitiesForVisitor = ref<Misskey.entities.MetaClientOptions['showActivitiesForVisitor']>(meta.clientOptions.showActivitiesForVisitor ?? true);

const iconUrl = ref(meta.iconUrl);
const logoFileInput = useTemplateRef('logoFileInput');
const uploadingLogo = ref(false);
const saving = ref(false);
const logoProgress = ref(0);
const logoError = ref('');
const logoPreviewFailed = ref(false);
const logoPreviewUrl = computed(() => iconUrl.value?.trim() || '/favicon.ico');
const logoTypes = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
const maxLogoSize = 2 * 1024 * 1024;
let abortLogoUpload: (() => void) | undefined;
let disposed = false;

const logoUrlInvalid = computed(() => {
	if (!iconUrl.value?.trim()) return false;
	try {
		return !['https:', 'http:'].includes(new URL(iconUrl.value.trim()).protocol);
	} catch {
		return true;
	}
});

watch(iconUrl, () => { logoPreviewFailed.value = false; logoError.value = ''; });
onBeforeUnmount(() => {
	disposed = true;
	abortLogoUpload?.();
});

function validateLogo(file: { type: string; size: number; isSensitive?: boolean }): boolean {
	logoError.value = '';
	if (!logoTypes.includes(file.type) || file.isSensitive) {
		logoError.value = i18n.ts._communityBranding.invalidImage;
	} else if (file.size > maxLogoSize) {
		logoError.value = i18n.ts._communityBranding.tooLarge;
	}
	return logoError.value === '';
}

function resetLogo() {
	iconUrl.value = null;
	logoError.value = '';
	logoPreviewFailed.value = false;
}

async function selectLogoFromDrive() {
	try {
		const files = await chooseDriveFile({ multiple: false, excludeSensitive: true });
		const file = files[0];
		if (file && !disposed && !saving.value && !uploadingLogo.value && validateLogo(file)) iconUrl.value = file.url;
	} catch {
		if (!disposed) logoError.value = i18n.ts._communityBranding.uploadFailed;
	}
}

async function uploadLogo(event: Event) {
	const input = event.target as HTMLInputElement;
	const file = input.files?.[0];
	input.value = '';
	if (!file || saving.value || uploadingLogo.value || !validateLogo(file)) return;
	uploadingLogo.value = true;
	logoProgress.value = 0;
	let timeout: ReturnType<typeof setTimeout> | undefined;
	const localUrl = URL.createObjectURL(file);
	try {
		const image = new Image();
		image.src = localUrl;
		await image.decode();
		if (disposed) return;
		const upload = uploadFile(file, {
			name: file.name,
			onProgress: ({ loaded, total }) => { logoProgress.value = Math.round(loaded / total * 100); },
		});
		abortLogoUpload = upload.abort;
		timeout = setTimeout(upload.abort, 60000);
		const uploaded = await upload.filePromise;
		if (!disposed && validateLogo(uploaded)) iconUrl.value = uploaded.url;
	} catch {
		if (!disposed) logoError.value = i18n.ts._communityBranding.uploadFailed;
	} finally {
		clearTimeout(timeout);
		URL.revokeObjectURL(localUrl);
		abortLogoUpload = undefined;
		uploadingLogo.value = false;
	}
}

const app192IconUrl = ref(meta.app192IconUrl);
const app512IconUrl = ref(meta.app512IconUrl);
const bannerUrl = ref(meta.bannerUrl);
const backgroundImageUrl = ref(meta.backgroundImageUrl);
const themeColor = ref(meta.themeColor);
const defaultLightTheme = ref(meta.defaultLightTheme);
const defaultDarkTheme = ref(meta.defaultDarkTheme);
const serverErrorImageUrl = ref(meta.serverErrorImageUrl);
const infoImageUrl = ref(meta.infoImageUrl);
const notFoundImageUrl = ref(meta.notFoundImageUrl);
const repositoryUrl = ref(meta.repositoryUrl);
const feedbackUrl = ref(meta.feedbackUrl);
const manifestJsonOverride = ref(meta.manifestJsonOverride === '' ? '{}' : JSON.stringify(JSON.parse(meta.manifestJsonOverride), null, '\t'));

async function save() {
	if (saving.value || uploadingLogo.value || logoUrlInvalid.value || logoPreviewFailed.value) return;
	let manifest: string;
	try {
		manifest = manifestJsonOverride.value === '' ? '{}' : JSON.stringify(JSON5.parse(manifestJsonOverride.value));
	} catch {
		await os.alert({ type: 'error', text: i18n.ts._communityBranding.invalidManifest });
		return;
	}
	const savedIconUrl = iconUrl.value?.trim() || null;
	saving.value = true;
	try {
		await os.apiWithDialog('admin/update-meta', {
			clientOptions: {
				entrancePageStyle: entrancePageStyle.value,
				showTimelineForVisitor: showTimelineForVisitor.value,
				showActivitiesForVisitor: showActivitiesForVisitor.value,
			},
			iconUrl: savedIconUrl,
			app192IconUrl: app192IconUrl.value,
			app512IconUrl: app512IconUrl.value,
			bannerUrl: bannerUrl.value,
			backgroundImageUrl: backgroundImageUrl.value,
			themeColor: themeColor.value === '' ? null : themeColor.value,
			defaultLightTheme: defaultLightTheme.value === '' ? null : defaultLightTheme.value,
			defaultDarkTheme: defaultDarkTheme.value === '' ? null : defaultDarkTheme.value,
			infoImageUrl: infoImageUrl.value === '' ? null : infoImageUrl.value,
			notFoundImageUrl: notFoundImageUrl.value === '' ? null : notFoundImageUrl.value,
			serverErrorImageUrl: serverErrorImageUrl.value === '' ? null : serverErrorImageUrl.value,
			repositoryUrl: repositoryUrl.value === '' ? null : repositoryUrl.value,
			feedbackUrl: feedbackUrl.value === '' ? null : feedbackUrl.value,
			manifestJsonOverride: manifest,
		});
		instance.iconUrl = savedIconUrl;
		await fetchInstance(true).catch(() => os.alert({ type: 'warning', text: i18n.ts._communityBranding.refreshFailed }));
	} catch {
		// apiWithDialog displays API failures; keep the selected logo for a retry.
	} finally {
		saving.value = false;
	}
}

const headerTabs = computed(() => []);

definePage(() => ({
	title: i18n.ts.branding,
	icon: 'ti ti-paint',
}));
</script>

<style lang="scss" module>
.logoHeading {
	margin: 0;
	font-size: 1.2em;
}

.logoDescription {
	margin: 8px 0 0;
	line-height: 1.6;
}

.logoEditor {
	display: flex;
	align-items: center;
	gap: 20px;
	flex-wrap: wrap;
}

.logoPreview {
	display: grid;
	place-items: center;
	flex-shrink: 0;
	width: 96px;
	height: 96px;
	padding: 12px;
	box-sizing: border-box;
	border: 1px solid var(--MI_THEME-divider);
	border-radius: 12px;
	background: var(--MI_THEME-panel);

	> img {
		width: 100%;
		height: 100%;
		object-fit: contain;
	}
}

.logoControls {
	flex: 1 1 240px;
	min-width: 0;
}

.logoActions {
	display: flex;
	flex-wrap: wrap;
	gap: 8px;

	> button {
		min-height: 44px;
	}
}

.logoError {
	margin: 0;
	color: var(--MI_THEME-error);
	overflow-wrap: anywhere;
}

.footer {
	-webkit-backdrop-filter: var(--MI-blur, blur(15px));
	backdrop-filter: var(--MI-blur, blur(15px));
}
</style>
