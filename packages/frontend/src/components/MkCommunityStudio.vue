<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<template>
<section :class="$style.workspace" :aria-label="title" :data-state="status" :data-phase="phase" data-testid="community-studio">
	<div :class="$style.stage" :aria-busy="status === 'loading'">
		<iframe v-if="frameUrl" :key="attempt" ref="frame" :src="frameUrl" :title="title" :class="$style.frame" sandbox="allow-same-origin allow-scripts allow-forms allow-downloads allow-popups allow-popups-to-escape-sandbox" allow="fullscreen; clipboard-write" referrerpolicy="no-referrer" data-testid="community-studio-frame"></iframe>
		<div v-if="status !== 'ready'" :class="$style.state" :role="status === 'error' ? 'alert' : 'status'">
			<MkLoading v-if="status === 'loading'"/>
			<template v-if="status === 'loading'">
				<p>{{ phase === 'workspace' ? studioText.loadingWorkspace : studioText.checkingAccount }}</p>
				<template v-if="slow"><p>{{ studioText.slowConnection }}</p><MkButton @click="connect">{{ studioText.retry }}</MkButton></template>
			</template>
			<form v-else-if="status === 'unlinked'" :class="$style.form" @submit.prevent="bindAccount">
				<h2>{{ studioText.bindTitle }}</h2><p>{{ studioText.bindHint }}</p><p>{{ studioText.community }} · @{{ $i?.username }}</p>
				<MkInput v-model="password" type="password" autocomplete="current-password" withPasswordToggle required :disabled="binding"><template #label>{{ studioText.password }}</template></MkInput>
				<MkInput v-if="$i?.twoFactorEnabled" v-model="factor" autocomplete="one-time-code" :disabled="binding"><template #label>{{ studioText.factor }}</template></MkInput>
				<p v-if="bindError" role="alert">{{ studioText.bindError }}</p>
				<MkButton primary :disabled="binding || !password" :wait="binding" @click="bindAccount">{{ studioText.bind }}</MkButton>
			</form>
			<template v-else-if="status === 'authorize'"><h2>{{ studioText.authorizeTitle }}</h2><p>{{ studioText.authorizeHint }}</p><p>{{ studioText.newApi }} · #{{ launch?.subject }}</p><MkButton primary :disabled="binding" :wait="binding" @click="authorize">{{ studioText.authorize }}</MkButton></template>
			<template v-else><p>{{ error === 'COMMUNITY_STORAGE_BLOCKED' ? studioText.storage : error === 'STUDIO_CONTEXT_EXPIRED' || error === 'COMMUNITY_ACCOUNT_CHANGED' ? studioText.expired : studioText.failure }}</p><MkButton primary @click="connect">{{ studioText.retry }}</MkButton></template>
		</div>
		<div v-if="['preparing', 'uploading', 'error'].includes(share.phase.value)" :class="$style.shareProgress" :role="share.phase.value === 'error' ? 'alert' : 'status'" data-testid="studio-share-progress">
			<strong>{{ shareText.title }}</strong><span>{{ share.phase.value === 'error' ? shareText.failed : share.phase.value === 'uploading' ? shareText.uploading : shareText.preparing }}</span>
			<progress v-if="share.phase.value === 'uploading'" :value="share.progress.value" max="100" :aria-label="shareText.uploading"></progress>
			<div><MkButton v-if="share.phase.value === 'error'" primary @click="share.retry">{{ shareText.retry }}</MkButton><MkButton @click="share.cancel">{{ shareText.cancel }}</MkButton></div>
		</div>
		<div v-if="remixStatus" :class="$style.shareProgress" role="status" data-testid="studio-remix-progress"><span>{{ remixStatus }}</span><MkButton v-if="!remixSent" @click="sendRemix">{{ studioText.remixRetry }}</MkButton></div>
		<div v-if="share.notice.value" :class="$style.shareProgress" role="status" data-testid="studio-share-success"><span>{{ share.notice.value }}</span><div><MkButton @click="router.push('/community/mine')">{{ shareText.viewMine }}</MkButton><MkButton @click="share.notice.value = ''">{{ shareText.close }}</MkButton></div></div>
	</div>
	<ShareComposer v-if="share.draft.value && props.active && $i" :key="attempt" section="all" embedded composerOnly compose :initialDraft="share.draft.value" :viewerId="$i.id" :signedIn="true" :moderator="false" :registrationClosed="true" :publicationMode="instance.clientOptions.communityPublicationMode === 'after' ? 'after' : 'before'" :gateway="shareGateway" @composerClosed="share.cancel" @submitted="share.published"/>
</section>
</template>

<script setup lang="ts">
import { defineAsyncComponent, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { StudioRemix } from '@/utility/studio-remix.js';
import { serializeStudioRemix } from '@/utility/studio-remix.js';
import MkButton from '@/components/MkButton.vue';
import MkInput from '@/components/MkInput.vue';
import { $i } from '@/i.js';
import { newApiStudioLaunch, startNewApiLink, studioContext, studioContextAction } from '@/utility/newapi-signin.js';
import { studioText } from '@/utility/studio-copy.js';
import { useStudioShare } from '@/utility/studio-share.js';
import { studioShareText as shareText } from '@/utility/studio-share-copy.js';
import { createBrowserCommunityGateway } from '@/pages/community/browser-gateway.js';
import { instance } from '@/instance.js';
import { useRouter } from '@/router.js';

const props = defineProps<{ origin: string; kind: string; title: string; active: boolean; defaultModel?: string; defaultModels?: Record<string, string>; remix?: StudioRemix }>();
const emit = defineEmits<{ (event: 'identity', value: string): void }>();
const remixStatus = ref('');
const remixSent = ref('');
let remixTimer: number | undefined;

function sendRemix() {
	if (!props.remix || status.value !== 'ready' || !props.active || !launch.value || !$i || remixSent.value === props.remix.requestId) return;
	const target = frame.value?.contentWindow;
	if (!target) { remixStatus.value = studioText.remixFailed; return; }
	remixSent.value = props.remix.requestId; remixStatus.value = studioText.remixLoading;
	window.clearTimeout(remixTimer);
	remixTimer = window.setTimeout(() => { remixStatus.value = studioText.remixTimeout; remixSent.value = ''; }, 60000);
	try {
		target.postMessage({ type: 'community-remix', context, attempt: attempt.value, subject: launch.value.subject, userId: $i.id, work: serializeStudioRemix(props.remix) }, props.origin);
	} catch {
		window.clearTimeout(remixTimer); remixSent.value = ''; remixStatus.value = studioText.remixFailed;
	}
}

const frame = ref<HTMLIFrameElement>();
const frameUrl = ref('');
const attempt = ref('');
const status = ref<'loading' | 'ready' | 'unlinked' | 'authorize' | 'error'>('loading');
const phase = ref<'account' | 'workspace'>('account');
const slow = ref(false);
const launch = ref<Awaited<ReturnType<typeof newApiStudioLaunch>>>();
const error = ref('');
const password = ref('');
const factor = ref('');
const binding = ref(false);
const bindError = ref(false);
let context = '';
let authorizationUrl = '';
let abort: AbortController | undefined;
let timeout: number | undefined;
let slowTimeout: number | undefined;
let heartbeat: number | undefined;
let generation = 0;
let frameHello = false;
let launchSent = false;
const ShareComposer = defineAsyncComponent(() => import('@/pages/community/surface.vue'));
const router = useRouter();
const share = useStudioShare(() => status.value === 'ready' && props.active && $i && launch.value?.userId === $i.id ? { userId: $i.id, subject: launch.value.subject, token: $i.token, context, attempt: attempt.value, accountLimitMb: $i.policies.maxFileSizeMb } : undefined, data => {
	frame.value?.contentWindow?.postMessage({ type: 'community-share-response', context, attempt: attempt.value, subject: launch.value?.subject, userId: $i?.id, ...data }, props.origin);
});
const baseGateway = createBrowserCommunityGateway();
const shareGateway = { ...baseGateway, submit: (input: Parameters<typeof baseGateway.submit>[0]) => { share.assertCurrent(); return baseGateway.submit(input); } };

function stop() {
	window.clearTimeout(remixTimer); remixSent.value = ''; remixStatus.value = '';
	share.stop();
	emit('identity', '');
	generation++;
	abort?.abort();
	abort = undefined;
	window.clearTimeout(timeout);
	window.clearTimeout(slowTimeout);
	window.clearInterval(heartbeat);
	slow.value = false;
	frameHello = false;
	launchSent = false;
	frameUrl.value = '';
	launch.value = undefined;
	authorizationUrl = '';
	binding.value = false;
}

function fail(code: string) { stop(); error.value = code; status.value = 'error'; }

function prepareFrame(nextContext: string, kind: string, origin: string) {
	context = nextContext;
	frameHello = false;
	launchSent = false;
	launch.value = undefined;
	attempt.value = crypto.randomUUID();
	const target = new URL('/community-embed', origin);
	target.search = new URLSearchParams({ context, attempt: attempt.value, kind }).toString();
	frameUrl.value = target.href;
}

function sendLaunch() {
	if (!frameHello || launchSent || !launch.value || !props.active || !frame.value?.contentWindow) return;
	launchSent = true;
	frame.value.contentWindow.postMessage({ type: 'community-launch', context, attempt: attempt.value, code: launch.value.code, subject: launch.value.subject, userId: launch.value.userId, defaultModel: props.defaultModel, defaultModels: { ...props.defaultModels } }, props.origin);
}

async function connect() {
	stop();
	if (!$i || !props.active) return;
	const current = generation, me = $i, kind = props.kind, origin = props.origin;
	const controller = new AbortController();
	abort = controller;
	status.value = 'loading';
	phase.value = 'account';
	error.value = '';
	timeout = window.setTimeout(() => { if (current === generation) fail('STUDIO_TIMEOUT'); }, 45000);
	slowTimeout = window.setTimeout(() => { if (current === generation && status.value === 'loading') slow.value = true; }, 8000);
	try {
		let nextContext = studioContext(me.id);
		// Fetch only the inert embedded shell while the server prepares the identity-bound ticket.
		prepareFrame(nextContext, kind, origin);
		let nextLaunch;
		try { nextLaunch = await newApiStudioLaunch(me.token, kind, nextContext, controller.signal); } catch (err) {
			if (current !== generation || controller.signal.aborted) return;
			if (err instanceof Error && err.message === 'STUDIO_CONTEXT_EXPIRED') {
				nextContext = studioContext(me.id, true);
				prepareFrame(nextContext, kind, origin);
				nextLaunch = await newApiStudioLaunch(me.token, kind, nextContext, controller.signal);
			} else throw err;
		}
		if (current !== generation || controller.signal.aborted || !props.active) return;
		if (nextLaunch.origin !== origin || nextLaunch.userId !== me.id) throw new Error('STUDIO_ACCOUNT');
		launch.value = nextLaunch;
		sendLaunch();
	} catch (err) {
		if (current !== generation) return;
		stop();
		error.value = err instanceof Error ? err.message : 'STUDIO_UNAVAILABLE';
		status.value = error.value === 'NEW_API_ACCOUNT_REQUIRED' ? 'unlinked' : 'error';
	}
}

function message(event: MessageEvent) {
	if (!props.active || event.origin !== props.origin || event.source !== frame.value?.contentWindow || !event.data || event.data.type !== 'community-studio' || event.data.context !== context || event.data.attempt !== attempt.value) return;
	const data = event.data;
	if (data.status === 'remix-applied' || data.status === 'remix-error') {
		if (status.value !== 'ready' || data.subject !== launch.value?.subject || data.userId !== $i?.id || data.requestId !== props.remix?.requestId) return;
		window.clearTimeout(remixTimer); remixStatus.value = data.status === 'remix-applied' ? '' : (typeof data.message === 'string' ? data.message.slice(0, 240) : studioText.remixFailed); if (data.status === 'remix-error') remixSent.value = ''; return;
	}
	if (typeof data.status === 'string' && data.status.startsWith('share-')) {
		if (status.value === 'ready' && launch.value && data.subject === launch.value.subject && data.userId === launch.value.userId && data.userId === $i?.id) void share.receive(data);
		return;
	}
	if (data.status === 'hello') {
		frameHello = true;
		sendLaunch();
		return;
	}
	if (data.status === 'error') { fail(data.code || 'STUDIO_UNAVAILABLE'); return; }
	if (!launch.value || data.subject !== launch.value.subject || data.userId !== $i?.id) { fail('STUDIO_ACCOUNT'); return; }
	if (data.status === 'loading' && data.phase === 'workspace') { phase.value = 'workspace'; return; }
	if (data.status === 'authorize') {
		window.clearTimeout(timeout);
		window.clearTimeout(slowTimeout);
		try { const target = new URL(data.authorizationUrl); if (target.origin !== props.origin || target.pathname !== '/api/new-api/community/embedded/authorize') throw new Error(); authorizationUrl = target.href; status.value = 'authorize'; } catch { fail('STUDIO_ACCOUNT'); }
	} else if (data.status === 'ready') {
		window.clearTimeout(timeout);
		window.clearTimeout(slowTimeout);
		const username = typeof data.username === 'string' ? data.username : '';
		emit('identity', studioText.identity + ' · ' + username + ' #' + launch.value.subject);
		status.value = 'ready';
		const current = generation;
		const renew = async () => { try { await studioContextAction($i!.token, context, 'renew'); } catch { if (current === generation) fail('STUDIO_CONTEXT_EXPIRED'); } };
		void renew();
		window.clearInterval(heartbeat);
		heartbeat = window.setInterval(renew, 30000);
	}
}

async function authorize() {
	if (!$i || !props.active || binding.value || !authorizationUrl) return;
	const current = generation, target = authorizationUrl;
	binding.value = true;
	try { await newApiStudioLaunch($i.token, props.kind, context, abort?.signal); if (current === generation && props.active) window.location.assign(target); } catch { if (current === generation) { binding.value = false; fail('STUDIO_UNAVAILABLE'); } }
}

async function bindAccount() {
	if (!$i || !props.active || binding.value || !password.value) return;
	const current = generation, credential = password.value, code = factor.value;
	const controller = new AbortController();
	abort = controller;
	binding.value = true; bindError.value = false; password.value = ''; factor.value = '';
	try { const target = await startNewApiLink($i.token, credential, code, window.location.pathname + window.location.search, controller.signal); if (current === generation && props.active) window.location.assign(target); } catch { if (current === generation) { bindError.value = true; binding.value = false; } }
}

function disconnected() { fail('STUDIO_CONTEXT_EXPIRED'); }

function storage(event: StorageEvent) { if (event.key === `community-studio:${$i?.id}` && event.newValue !== context) disconnected(); }

onMounted(() => { window.addEventListener('message', message); window.addEventListener('community-studio-disconnect', disconnected); window.addEventListener('storage', storage); void connect(); });
onBeforeUnmount(() => { stop(); window.removeEventListener('message', message); window.removeEventListener('community-studio-disconnect', disconnected); window.removeEventListener('storage', storage); });
watch(() => [props.kind, props.origin, props.active, $i?.id, $i?.token], connect);
watch(() => [props.remix, status.value, props.active], sendRemix, { flush: 'post' });
defineExpose({ refresh: () => { void connect(); } });
</script>

<style module lang="scss">
.workspace { display: flex; flex: 1; flex-direction: column; min-height: 0; min-width: 0; }
.stage { flex: 1; position: relative; min-height: 0; min-width: 0; overflow: hidden; }
.frame { display: block; position: absolute; inset: 0; width: 100%; height: 100%; border: 0; background: var(--MI_THEME-bg); }
.state { position: absolute; inset: 0; display: flex; flex-direction: column; justify-content: safe center; align-items: center; gap: 16px; padding: 24px 20px; overflow: auto; text-align: center; background: var(--MI_THEME-panel); h2 { margin: 0; font-size: 22px; } p { max-width: 40em; margin: 0; line-height: 1.7; } }
.shareProgress { position: absolute; z-index: 2; bottom: 16px; right: 16px; left: 16px; margin-left: auto; display: grid; gap: 12px; width: min(420px, calc(100% - 32px)); padding: 20px; border: 1px solid var(--MI_THEME-divider); border-radius: 12px; background: var(--MI_THEME-panel); color: var(--MI_THEME-fg); line-height: 1.6; box-sizing: border-box; div { display: flex; justify-content: flex-end; gap: 8px; } progress { width: 100%; accent-color: var(--MI_THEME-accent); } }
.form { display: grid; gap: 20px; width: min(100%, 400px); text-align: left; }
@media (max-width: 600px) { .state { padding: 20px 16px; } }
</style>
