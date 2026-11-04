<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<PageWithHeader :tabs="[]">
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
			<div v-if="!targetUrl" :class="$style.empty" data-testid="creation-empty">
				<i :class="[definition.icon, $style.emptyIcon]" aria-hidden="true"></i>
				<h1>{{ creationText.notConfigured }}</h1>
				<p>{{ creationText.emptyHint }}</p>
				<MkButton v-if="$i?.isAdmin" type="routerLink" to="/admin/creation-links" primary>{{ creationText.configure }}</MkButton>
			</div>
			<template v-else>
				<div :class="$style.toolbar">
					<p :class="$style.hint">{{ mode === 'embed' ? creationText.embedHint : creationText.externalHint }}</p>
					<div :class="$style.actions">
						<MkButton v-if="$i?.isAdmin" type="routerLink" to="/admin/creation-links" small>{{ creationText.settings }}</MkButton>
						<MkButton type="a" :href="targetUrl" target="_blank" rel="noopener noreferrer" primary small data-testid="creation-open"><i class="ti ti-external-link" aria-hidden="true"></i> {{ creationText.open }}</MkButton>
					</div>
				</div>
				<iframe
					v-if="active && mode === 'embed'"
					:key="`${definition.key}:${targetUrl}`"
					:src="targetUrl"
					:title="definition.title"
					:class="$style.frame"
					sandbox="allow-scripts allow-forms allow-downloads allow-popups allow-popups-to-escape-sandbox"
					referrerpolicy="no-referrer"
					data-testid="creation-frame"
				></iframe>
				<div v-else :class="$style.empty" data-testid="creation-external">
					<i :class="[definition.icon, $style.emptyIcon]" aria-hidden="true"></i>
					<h1>{{ definition.title }}</h1>
					<p>{{ creationText.externalHint }}</p>
					<MkButton type="a" :href="targetUrl" target="_blank" rel="noopener noreferrer" primary>{{ creationText.open }} <i class="ti ti-external-link" aria-hidden="true"></i></MkButton>
				</div>
			</template>
		</template>
	</div>
</PageWithHeader>
</template>

<script lang="ts" setup>
import { computed, onActivated, onBeforeUnmount, onDeactivated, onMounted, ref, watch } from 'vue';
import { url as siteUrl } from '@@/js/config.js';
import MkButton from '@/components/MkButton.vue';
import { creationText, creationPages, normalizeCreationUrl } from '@/utility/creation-pages.js';
import { fetchInstance, instance } from '@/instance.js';
import { $i } from '@/i.js';
import { i18n } from '@/i18n.js';
import { definePage } from '@/page.js';
import { homeText } from '@/pages/home/copy.js';
import * as os from '@/os.js';

const props = defineProps<{ kind: string }>();
const definition = computed(() => creationPages.find(item => item.key === props.kind));
const targetUrl = computed(() => {
	if (!$i) return null;
	const value = definition.value && instance.clientOptions?.[definition.value.urlKey];
	return value ? normalizeCreationUrl(value, siteUrl) : null;
});
const mode = computed(() => definition.value && instance.clientOptions?.[definition.value.modeKey] === 'newTab' ? 'newTab' : 'embed');
const active = ref(false);
const loading = ref(false);
const ready = ref(false);
const failed = ref(false);
let generation = 0;
const loginOpening = ref(false);
let loginRequest = 0;
let disposeLogin: (() => void) | undefined;

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
	failed.value = false;
	try {
		await fetchInstance(true);
		if (current === generation) ready.value = true;
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
watch(() => props.kind, refresh);
definePage(() => ({ title: definition.value?.title ?? i18n.ts.notFound, icon: definition.value?.icon ?? 'ti ti-alert-triangle', needWideArea: true }));
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
.toolbar {
	display: flex;
	align-items: center;
	justify-content: space-between;
	flex-wrap: wrap;
	gap: 12px;
	padding: 12px 24px;
	background: var(--MI_THEME-panel);
}
.hint { margin: 0; font-size: 0.85em; line-height: 1.6; }
.actions { display: flex; flex-wrap: wrap; gap: 8px; }
.frame { display: block; flex: 1; width: 100%; min-height: 0; border: 0; background: var(--MI_THEME-bg); }
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
	h1 { margin: 0; font-size: 1.35em; }
	p { margin: 0; line-height: 1.7; max-width: 36em; }
}
.emptyIcon { font-size: 40px; color: var(--MI_THEME-accent); }
@media (max-width: 600px) { .toolbar { padding: 12px 16px; } }
</style>
