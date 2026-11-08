<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<main :class="$style.root">
	<section :class="$style.panel" :aria-busy="busy">
		<h1>{{ link ? studioText.confirmTitle : requiresTotp ? authText.newApiFactor : authText.newApiSignin }}</h1>
		<p v-if="busy" role="status">{{ authText.newApiWorking }}</p>
		<p v-if="error" role="alert">{{ error }}</p>
		<XTotp v-if="requiresTotp && !busy" @totpSubmitted="finish"/>
		<template v-if="link && !error"><p>{{ studioText.community }} · @{{ link.communityUsername }}</p><p>{{ studioText.newApi }} · {{ link.newApiUsername }} (#{{ link.subject }})</p><MkButton primary :disabled="busy" @click="finish(undefined, true)">{{ studioText.confirm }}</MkButton></template>
		<MkButton v-if="error && !link && !$i" :disabled="busy" primary @click="retry">{{ authText.newApiRetry }}</MkButton>
		<MkA to="/community">{{ homeText.community }}</MkA>
	</section>
</main>
</template>

<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref } from 'vue';
import { authText } from '@/utility/auth-copy.js';
import { startNewApiSignin } from '@/utility/newapi-signin.js';
import { login } from '@/accounts.js';
import MkButton from '@/components/MkButton.vue';
import XTotp from '@/components/MkSignin.totp.vue';
import { homeText } from '@/pages/home/copy.js';
import { definePage } from '@/page.js';
import { $i } from '@/i.js';
import { studioText } from '@/utility/studio-copy.js';

const busy = ref(false);
const error = ref('');
const requiresTotp = ref(false);
const link = ref<{ communityUsername: string; newApiUsername: string; subject: string; }>();
const abort = new AbortController();

async function finish(token?: string, confirmLink = false): Promise<void> {
	if (busy.value) return;
	busy.value = true;
	error.value = '';
	try {
		const response = await window.fetch('/api/newapi/finish', { method: 'POST', credentials: 'same-origin', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, i: $i?.token, confirmLink }), signal: abort.signal });
		const data = await response.json();
		if (!response.ok) throw new Error(data.error);
		if (data.requiresLinkConfirmation) { link.value = data; return; }
		if (data.linked === true) { window.location.assign(/^\/(community|create\/(text|image|video))$/.test(data.returnTo) ? data.returnTo : '/community'); return; }
		if (data.requiresTotp) { requiresTotp.value = true; return; }
		if (data.finished !== true || typeof data.i !== 'string') throw new Error('SSO_RESPONSE');
		const returnTo = /^\/(community|create\/(text|image|video))$/.test(data.returnTo) ? data.returnTo : '/community';
		await login(data.i, returnTo);
	} catch (err) {
		if (!abort.signal.aborted) error.value = err instanceof Error && err.message === 'SSO_LINK_CONFLICT' ? studioText.conflict : authText.newApiFailed;
	} finally { busy.value = false; }
}

async function retry(): Promise<void> {
	busy.value = true;
	try { await startNewApiSignin('/community'); } catch { error.value = authText.newApiFailed; busy.value = false; }
}

onMounted(() => {
	if (new URLSearchParams(window.location.search).has('error')) error.value = authText.newApiFailed;
	else void finish();
});
onBeforeUnmount(() => abort.abort());
definePage(() => ({ title: authText.newApiSignin, icon: 'ti ti-login' }));
</script>

<style module lang="scss">
.root { min-height: 70dvh; display: grid; place-items: center; padding: 32px 20px; }
.panel { display: grid; gap: 20px; width: min(100%, 400px); h1 { font-size: 24px; margin: 0; } p { margin: 0; line-height: 1.7; } }
</style>
