<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div :class="$style.root" :aria-busy="loading || busy" data-testid="newapi-auth">
	<p v-if="loading" role="status">{{ authText.newApiChecking }}</p>
	<div v-else-if="configError" :class="$style.content">
		<p role="alert">{{ authText.newApiConfigFailed }}</p>
		<MkButton data-testid="newapi-config-retry" @click="loadConfig">{{ authText.retryCheck }}</MkButton>
	</div>
	<template v-else-if="enabled && !legacy">
		<div :class="$style.content">
			<h2>{{ signup ? authText.newApiSignupTitle : authText.signinTitle }}</h2>
			<p>{{ signup ? authText.newApiSignupHint : authText.newApiUnifiedHint }}</p>
			<p v-if="error" role="alert" :class="$style.error">{{ authText.newApiFailed }}</p>
			<template v-if="signup">
				<a :href="registrationUrl" target="_blank" rel="noopener noreferrer" :class="[$style.register, '_buttonPrimary']" data-testid="newapi-signup" @click="registrationOpened = true">{{ authText.newApiSignup }} <i class="ti ti-external-link" aria-hidden="true"></i></a>
				<p v-if="registrationOpened" role="status">{{ authText.newApiSignupReturn }}</p>
				<MkButton v-if="registrationOpened" primary full :disabled="busy" :wait="busy" data-testid="newapi-signin" @click="signin">{{ authText.newApiContinue }}</MkButton>
			</template>
			<MkButton v-else primary full :disabled="busy" :wait="busy" data-testid="newapi-signin" @click="signin">{{ busy ? authText.signingIn : authText.newApiSignin }}</MkButton>
			<p :class="$style.hint">{{ authText.newApiAccountHint }}</p>
		</div>
		<details v-if="!signup" :class="$style.legacy">
			<summary>{{ authText.newApiLegacyTitle }}</summary>
			<p>{{ authText.newApiLegacyHint }}</p>
			<button type="button" class="_textButton" :disabled="busy" data-testid="legacy-signin" @click="legacy = true">{{ authText.newApiLegacySignin }}</button>
		</details>
	</template>
	<template v-else>
		<button v-if="legacy" type="button" class="_textButton" :class="$style.back" :disabled="localBusy" @click="legacy = false">{{ authText.newApiBack }}</button>
		<slot></slot>
	</template>
</div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import MkButton from '@/components/MkButton.vue';
import { authText } from '@/utility/auth-copy.js';
import { newApiSigninConfig, startNewApiSignin } from '@/utility/newapi-signin.js';

withDefaults(defineProps<{ signup?: boolean; localBusy?: boolean; }>(), { signup: false, localBusy: false });
const emit = defineEmits<{ (ev: 'busy', value: boolean): void; }>();
const loading = ref(true);
const configError = ref(false);
const enabled = ref(false);
const legacy = ref(false);
const registrationUrl = ref('');
const registrationOpened = ref(false);
const busy = ref(false);
const error = ref(false);
const abort = new AbortController();

async function loadConfig(): Promise<void> {
	loading.value = true;
	configError.value = false;
	try {
		const config = await newApiSigninConfig(AbortSignal.any([abort.signal, AbortSignal.timeout(10000)]));
		if (abort.signal.aborted) return;
		enabled.value = config.enabled;
		registrationUrl.value = config.enabled ? new URL('/sign-up', config.issuer).href : '';
	} catch {
		if (!abort.signal.aborted) configError.value = true;
	} finally { if (!abort.signal.aborted) loading.value = false; }
}

async function signin(): Promise<void> {
	if (busy.value) return;
	busy.value = true;
	emit('busy', true);
	error.value = false;
	try {
		await startNewApiSignin(undefined, abort.signal);
	} catch {
		if (!abort.signal.aborted) { error.value = true; busy.value = false; emit('busy', false); }
	}
}

onMounted(loadConfig);
onBeforeUnmount(() => { abort.abort(); });
</script>

<style lang="scss" module>
.root { min-width: 0; }
.content { display: grid; gap: 20px; h2 { margin: 0; font-size: 24px; line-height: 1.3; } p { margin: 0; line-height: 1.7; overflow-wrap: anywhere; } }
.hint { font-size: 13px; color: var(--MI_THEME-fg); }
.error { color: var(--MI_THEME-error); }
.register { min-height: 44px; display: flex; align-items: center; justify-content: center; gap: 8px; padding: 8px 16px; border-radius: 8px; box-sizing: border-box; font-weight: bold; text-decoration: none; }
.legacy { margin-top: 24px; border-top: 1px solid var(--MI_THEME-divider); padding-top: 8px; font-size: 13px; summary { cursor: pointer; padding: 14px 0; } p { line-height: 1.6; } button { min-height: 44px; } }
.back { min-height: 44px; margin-bottom: 12px; }
.register:focus-visible, .legacy summary:focus-visible, .legacy button:focus-visible, .back:focus-visible { outline: 2px solid var(--MI_THEME-accent); outline-offset: 3px; }
</style>
