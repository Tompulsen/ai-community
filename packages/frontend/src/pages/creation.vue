<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<PageWithHeader :tabs="[]" :actions="studioActions">
	<div :class="$style.workspace" data-testid="creation-workspace">
		<div v-if="!definition" :class="$style.empty"><h1>{{ i18n.ts.notFound }}</h1></div>
		<div v-else-if="!$i" :class="$style.empty" data-testid="creation-login-required">
			<i class="ti ti-lock" :class="$style.emptyIcon" aria-hidden="true"></i>
			<h1>{{ homeText.loginTitle }}</h1>
			<p>{{ homeText.loginHint }}</p>
			<MkButton primary :disabled="loginOpening" @click="requestLogin">{{ homeText.login }}</MkButton>
			<MkA to="/community" class="_link">{{ homeText.browse }}</MkA>
			<MkA to="/" class="_link">{{ homeText.back }}</MkA>
		</div>
		<div v-else-if="loading" :class="$style.empty" role="status"><MkLoading/></div>
		<div v-else-if="failed" :class="$style.empty" role="alert">
			<p>{{ creationText.loadError }}</p>
			<MkButton @click="refresh">{{ i18n.ts.retry }}</MkButton>
		</div>
		<template v-else-if="ready">
			<MkStudioRemix v-if="remixOpen && remixId && active" :key="remixId" :submissionId="remixId" @apply="remix = $event" @closed="remixOpen = false"/>
			<MkCommunityStudio ref="studio" :origin="siteOrigin" :kind="definition.key" :title="workbenchText.title" :active="active" :defaultModel="instance.clientOptions?.[definition.modelKey] ?? definition.defaultModel" :defaultModels="defaultModels" :remix="remix" @identity="studioIdentity = $event"/>
		</template>
	</div>
</PageWithHeader>
</template>

<script lang="ts" setup>
import { computed, onActivated, onBeforeUnmount, onDeactivated, onMounted, ref, watch } from 'vue';
import { url as siteUrl } from '@@/js/config.js';
import type { StudioRemix } from '@/utility/studio-remix.js';
import MkButton from '@/components/MkButton.vue';
import { creationText, creationPages, workbenchText } from '@/utility/creation-pages.js';
import { fetchInstance, instance } from '@/instance.js';
import { $i } from '@/i.js';
import { i18n } from '@/i18n.js';
import { definePage } from '@/page.js';
import { homeText } from '@/pages/home/copy.js';
import MkStudioRemix from '@/components/MkStudioRemix.vue';
import MkCommunityStudio from '@/components/MkCommunityStudio.vue';
import { newApiSigninConfig } from '@/utility/newapi-signin.js';
import { studioText } from '@/utility/studio-copy.js';
import * as os from '@/os.js';

const props = defineProps<{ kind: string; remixId?: string }>();
const remix = ref<StudioRemix>();
const remixOpen = ref(!!props.remixId);
watch(() => props.remixId, value => { remix.value = undefined; remixOpen.value = !!value; });
const definition = computed(() => creationPages.find(item => item.key === props.kind));
const defaultModels = computed(() => Object.fromEntries(creationPages.map(item => [item.key, instance.clientOptions?.[item.modelKey] ?? item.defaultModel])));
const siteOrigin = new URL(siteUrl).origin;
const active = ref(false);
const loading = ref(false);
const ready = ref(false);
const failed = ref(false);
let generation = 0;
const loginOpening = ref(false);
let loginRequest = 0;
let disposeLogin: (() => void) | undefined;
const studio = ref<InstanceType<typeof MkCommunityStudio>>();
const studioIdentity = ref('');
const studioActions = computed(() => ready.value ? [{ icon: 'ti ti-refresh', text: studioText.refresh, handler: () => studio.value?.refresh() }] : []);

async function requestLogin() {
	if ($i || loginOpening.value || !active.value || !definition.value) return;
	const request = ++loginRequest;
	loginOpening.value = true;
	try {
		const component = await import('@/components/MkSigninDialog.vue');
		if (!active.value || request !== loginRequest) return;
		// Native autoSet login reloads the current /create/:kind URL after authentication.
		const { dispose } = await os.popupAsyncWithDialog(Promise.resolve(component.default), {
			autoSet: true,
			message: homeText.loginHint,
		}, { closed: () => {
			dispose();
			if (request === loginRequest) { loginOpening.value = false; disposeLogin = undefined; }
		} });
		if (!active.value || request !== loginRequest) { dispose(); return; }
		disposeLogin = dispose;
	} catch {
		if (request !== loginRequest || !active.value) return;
		loginOpening.value = false;
		await os.alert({ type: 'error', text: homeText.loginError });
	}
}

async function refresh() {
	if (!active.value || !definition.value) return;
	if (!$i) { await requestLogin(); return; }
	const current = ++generation;
	loading.value = true;
	ready.value = false;
	studioIdentity.value = '';
	failed.value = false;
	try {
		const [, sso] = await Promise.all([fetchInstance(true), newApiSigninConfig()]);
		if (current === generation) {
			if (!sso.enabled || sso.studioOrigin !== siteOrigin || sso.studioPath !== '/studio') throw new Error('BUILTIN_STUDIO_UNAVAILABLE');
			ready.value = true;
		}
	} catch {
		if (current === generation) failed.value = true;
	} finally {
		if (current === generation) loading.value = false;
	}
}

function activate() {
	if (active.value) return;
	active.value = true;
	void refresh();
}

function deactivate() {
	active.value = false;
	ready.value = false;
	generation++;
	loginRequest++;
	disposeLogin?.();
	disposeLogin = undefined;
	loginOpening.value = false;
}

onMounted(activate);
onActivated(activate);
onDeactivated(deactivate);
onBeforeUnmount(deactivate);
watch(() => props.kind, () => { if (!ready.value) void refresh(); });
definePage(() => ({ title: definition.value ? workbenchText.title : i18n.ts.notFound, subtitle: studioIdentity.value, icon: definition.value ? 'ti ti-sparkles' : 'ti ti-alert-triangle', needWideArea: true }));
</script>

<style lang="scss" module>
.workspace {
	display: flex;
	flex-direction: column;
	height: calc(100cqh - (var(--MI-stickyTop, 0px) + var(--MI-stickyBottom, 0px)));
	min-height: 240px;
	width: 100%;
	min-width: 0;
}
.empty {
	flex: 1;
	display: flex;
	flex-direction: column;
	justify-content: center;
	align-items: center;
	gap: 16px;
	padding: 32px 16px;
	box-sizing: border-box;
	text-align: center;
	h1 { margin: 0; font-size: clamp(24px, 3vw, 36px); font-weight: 650; letter-spacing: -.025em; }
	p { margin: 0; line-height: 1.7; max-width: 36em; }
}
.emptyIcon { display: grid; place-items: center; width: 88px; height: 88px; margin-bottom: 8px; border-radius: 20px; background: var(--community-stage); color: var(--community-stage-accent); font-size: 34px; }
</style>
