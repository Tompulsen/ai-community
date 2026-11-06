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
				<div ref="toolbar" :class="$style.toolbar">
					<div :class="$style.destination"><i :class="definition.icon" aria-hidden="true"></i><div><strong>{{ mode === 'embed' ? embedText.workspace : definition.title }}</strong><span>{{ targetHost }}</span></div></div>
					<div :class="$style.actions">
						<MkButton v-if="mode === 'embed'" small data-testid="creation-reload" @click="reloadFrame"><i class="ti ti-refresh" aria-hidden="true"></i> {{ embedText.reload }}</MkButton>
						<MkButton v-if="mode === 'embed'" small :aria-expanded="showHelp" :aria-controls="helpId" data-testid="creation-help" @click="showHelp = !showHelp">{{ showHelp ? embedText.closeHelp : embedText.help }}</MkButton>
						<MkButton v-if="$i?.isAdmin" type="routerLink" to="/admin/creation-links" small>{{ creationText.settings }}</MkButton>
						<MkButton type="a" :href="targetUrl" target="_blank" rel="noopener noreferrer" primary small data-testid="creation-open"><i class="ti ti-external-link" aria-hidden="true"></i> {{ creationText.open }}</MkButton>
					</div>
				</div>
				<section v-if="showHelp && mode === 'embed'" :id="helpId" :class="$style.help" data-testid="creation-help-panel">
					<h2>{{ embedText.helpTitle }}</h2><p>{{ embedText.helpHint }}</p>
					<p v-if="$i?.isAdmin">{{ embedText.adminHint }} <code>{{ siteOrigin }}</code></p>
				</section>
				<div v-if="active && mode === 'embed'" :class="$style.frameStage" data-testid="creation-frame-stage" :aria-busy="frameState === 'loading'">
				<iframe
					:key="`${definition.key}:${targetUrl}:${frameAttempt}`"
					ref="frame"
					:src="targetUrl"
					:title="definition.title"
					:class="$style.frame"
					sandbox="allow-same-origin allow-scripts allow-forms allow-downloads allow-popups allow-popups-to-escape-sandbox"
					allow="fullscreen"
					referrerpolicy="no-referrer"
					data-testid="creation-frame"
					@load="frameLoaded"
					@error="frameFailed"
				></iframe>
				<div v-if="frameState !== 'unconfirmed'" :class="$style.frameStatus" :role="frameState === 'error' ? 'alert' : 'status'" data-testid="creation-frame-status">
					<MkLoading v-if="frameState === 'loading'"/>
					<i v-else class="ti ti-browser-off" :class="$style.statusIcon" aria-hidden="true"></i>
					<h2>{{ frameState === 'loading' ? embedText.loading : frameState === 'timeout' ? embedText.slowTitle : embedText.failedTitle }}</h2>
					<template v-if="frameState !== 'loading'"><p>{{ embedText.waitHint }}</p><div :class="$style.actions"><MkButton primary @click="reloadFrame">{{ embedText.reload }}</MkButton><MkButton type="a" :href="targetUrl" target="_blank" rel="noopener noreferrer">{{ creationText.open }}</MkButton><MkButton @click="continueFrame">{{ embedText.continuePreview }}</MkButton></div></template>
				</div>
				</div>
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
import { computed, nextTick, onActivated, onBeforeUnmount, onDeactivated, onMounted, ref, useId, watch } from 'vue';
import { url as siteUrl } from '@@/js/config.js';
import MkButton from '@/components/MkButton.vue';
import { creationText, creationEmbedText as embedText, creationPages, normalizeCreationUrl } from '@/utility/creation-pages.js';
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
const targetHost = computed(() => targetUrl.value ? new URL(targetUrl.value).host : '');
const siteOrigin = new URL(siteUrl).origin;
const toolbar = ref<HTMLElement>();
const frame = ref<HTMLIFrameElement>();
const helpId = useId();
const showHelp = ref(false);
const frameAttempt = ref(0);
const frameState = ref<'loading' | 'unconfirmed' | 'timeout' | 'error'>('loading');
let frameTimer: number | undefined;
const active = ref(false);
const loading = ref(false);
const ready = ref(false);
const failed = ref(false);
let generation = 0;
const loginOpening = ref(false);
let loginRequest = 0;
let disposeLogin: (() => void) | undefined;

function clearFrameTimer() { window.clearTimeout(frameTimer); frameTimer = undefined; }

function frameLoaded(event: Event) {
	if (!active.value || event.target !== frame.value) return;
	clearFrameTimer();
	// Browsers also fire load for blocked cross-origin frames. This is not proof of a usable page.
	frameState.value = 'unconfirmed';
}

function frameFailed(event: Event) {
	if (!active.value || event.target !== frame.value) return;
	clearFrameTimer(); frameState.value = 'error';
}

async function reloadFrame() {
	if (!active.value || !targetUrl.value || mode.value !== 'embed') return;
	showHelp.value = false;
	frameAttempt.value++;
	await nextTick();
	toolbar.value?.querySelector<HTMLButtonElement>('[data-testid="creation-reload"]')?.focus({ preventScroll: true });
}

async function continueFrame() {
	frameState.value = 'unconfirmed';
	await nextTick();
	frame.value?.focus({ preventScroll: true });
}

watch([active, ready, targetUrl, mode, frameAttempt], () => {
	clearFrameTimer();
	if (!active.value || !ready.value || !targetUrl.value || mode.value !== 'embed') return;
	frameState.value = 'loading';
	frameTimer = window.setTimeout(() => { frameState.value = 'timeout'; }, 12000);
}, { flush: 'post' });
watch(targetUrl, () => { showHelp.value = false; });

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
	clearFrameTimer();
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
	padding: 16px 24px;
	border-bottom: 1px solid var(--MI_THEME-divider);
	background: var(--MI_THEME-panel);
}
.destination { display: flex; align-items: center; gap: 12px; min-width: 0; > i { font-size: 22px; color: var(--MI_THEME-accent); } > div { min-width: 0; } strong, span { display: block; } strong { font-size: 14px; } span { margin-top: 3px; font-size: 12px; color: var(--MI_THEME-fgTransparentWeak); overflow-wrap: anywhere; } }
.actions { display: flex; flex-wrap: wrap; gap: 8px; }
.frameStage { position: relative; flex: 1; min-height: 240px; }
.frame { display: block; position: absolute; inset: 0; width: 100%; height: 100%; border: 0; background: var(--MI_THEME-bg); }
.frameStatus { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 16px; padding: 24px; overflow: auto; text-align: center; background: var(--MI_THEME-panel); h2 { margin: 0; font-size: 20px; } p { margin: 0; line-height: 1.7; max-width: 38em; } .actions { justify-content: center; } }
.statusIcon { font-size: 32px; color: var(--MI_THEME-fgTransparentWeak); }
.help { padding: 18px 24px; border-bottom: 1px solid var(--MI_THEME-divider); background: var(--MI_THEME-infoBg); color: var(--MI_THEME-infoFg); h2 { margin: 0 0 8px; font-size: 15px; } p { margin: 6px 0 0; font-size: 13px; line-height: 1.7; } code { display: inline-block; padding: 2px 6px; border: 1px solid var(--MI_THEME-divider); border-radius: 4px; overflow-wrap: anywhere; } }
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
@media (max-width: 600px) { .toolbar, .help { padding: 12px 16px; } .actions { gap: 6px; } .frameStatus { padding: 20px 16px; } }
</style>
