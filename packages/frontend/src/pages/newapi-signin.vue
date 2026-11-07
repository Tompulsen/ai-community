<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<main :class="$style.root">
	<section :class="$style.panel" :aria-busy="busy">
		<h1>{{ requiresTotp ? authText.newApiFactor : authText.newApiSignin }}</h1>
		<p v-if="busy" role="status">{{ authText.newApiWorking }}</p>
		<p v-if="error" role="alert">{{ error }}</p>
		<XTotp v-if="requiresTotp && !busy" @totpSubmitted="finish"/>
		<MkButton v-if="error" :disabled="busy" primary @click="retry">{{ authText.newApiRetry }}</MkButton>
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

const busy = ref(false);
const error = ref('');
const requiresTotp = ref(false);
const abort = new AbortController();

async function finish(token?: string): Promise<void> {
	if (busy.value) return;
	busy.value = true;
	error.value = '';
	try {
		const response = await window.fetch('/api/newapi/finish', { method: 'POST', credentials: 'same-origin', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }), signal: abort.signal });
		const data = await response.json();
		if (!response.ok) throw new Error(data.error);
		if (data.requiresTotp) { requiresTotp.value = true; return; }
		if (data.finished !== true || typeof data.i !== 'string') throw new Error('SSO_RESPONSE');
		const returnTo = /^\/(community|create\/(text|image|video))$/.test(data.returnTo) ? data.returnTo : '/community';
		await login(data.i, returnTo);
	} catch {
		if (!abort.signal.aborted) error.value = authText.newApiFailed;
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
