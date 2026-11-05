<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div :class="$style.signinRoot" :aria-busy="waiting">
	<div v-if="errorMessage" role="alert" :class="$style.error" data-testid="signin-error">{{ errorMessage }}</div>
	<div :inert="waiting">
		<XInput
			v-show="page === 'input'"
			ref="inputPageEl"
			:message="message"
			:openOnRemote="openOnRemote"
			:initialUsername="initialUsername"
			:needCaptcha="needCaptcha"
			:waiting="waiting"
			@credentialsSubmitted="onCredentialsSubmitted"
			@passkeyClick="onPasskeyLogin"
		/>
		<template v-if="page !== 'input'">
			<button type="button" class="_textButton" :class="$style.back" @click="backToInput"><i class="ti ti-arrow-left" aria-hidden="true"></i> {{ authText.backToSignin }}</button>
			<XTotp v-if="page === 'totp'" @totpSubmitted="onTotpSubmitted"/>
			<XPasskey
				v-else-if="page === 'passkey' && credentialRequest"
				:credentialRequest="credentialRequest"
				:isPerformingPasswordlessLogin="doingPasskeyFromInputPage"
				@done="onPasskeyDone"
				@useTotp="onUseTotp"
			/>
		</template>
	</div>
	<div v-if="waiting && page !== 'input'" role="status" :class="$style.waitingRoot">
		<MkLoading/>
		<span>{{ authText.signingIn }}</span>
	</div>
</div>
</template>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, shallowRef, useTemplateRef, watch } from 'vue';
import * as Misskey from 'misskey-js';
import { browserSupportsWebAuthn } from '@simplewebauthn/browser';
import type { PublicKeyCredentialRequestOptionsJSON, AuthenticationResponseJSON } from '@simplewebauthn/browser';
import type { OpenOnRemoteOptions } from '@/utility/please-login.js';
import type { PwResponse } from '@/components/MkSignin.password.vue';
import { misskeyApi } from '@/utility/misskey-api.js';
import { showSuspendedDialog } from '@/utility/show-suspended-dialog.js';
import { i18n } from '@/i18n.js';
import { instance } from '@/instance.js';
import { authText } from '@/utility/auth-copy.js';
import XInput from '@/components/MkSignin.input.vue';
import XTotp from '@/components/MkSignin.totp.vue';
import XPasskey from '@/components/MkSignin.passkey.vue';
import { login } from '@/accounts.js';

const emit = defineEmits<{
	(ev: 'login', v: Misskey.entities.SigninFlowResponse & { finished: true }): void;
	(ev: 'busy', value: boolean): void;
}>();

const props = withDefaults(defineProps<{
	autoSet?: boolean;
	message?: string;
	openOnRemote?: OpenOnRemoteOptions;
	initialUsername?: string;
}>(), {
	autoSet: false,
	message: '',
	openOnRemote: undefined,
	initialUsername: undefined,
});

const page = ref<'input' | 'totp' | 'passkey'>('input');
const waiting = ref(false);
const errorMessage = ref('');
const inputPageEl = useTemplateRef('inputPageEl');
// A password request validates CAPTCHA immediately, without another challenge response.
const needCaptcha = ref(true);
const password = ref('');
const identifier = ref('');
const credentialRequest = shallowRef<PublicKeyCredentialRequestOptionsJSON | null>(null);
const passkeyContext = ref('');
const doingPasskeyFromInputPage = ref(false);
let active = true;

watch(waiting, value => emit('busy', value), { flush: 'sync' });

async function onPasskeyLogin(): Promise<void> {
	if (waiting.value || !browserSupportsWebAuthn()) return;
	waiting.value = true;
	errorMessage.value = '';
	doingPasskeyFromInputPage.value = true;
	password.value = '';
	inputPageEl.value?.clearPassword();
	try {
		const res = await misskeyApi('signin-with-passkey', {});
		if (!active) return;
		passkeyContext.value = res.context ?? '';
		credentialRequest.value = res.option;
		page.value = 'passkey';
	} catch (err) {
		onSigninApiError(err);
	} finally {
		waiting.value = false;
	}
}

async function onPasskeyDone(credential: AuthenticationResponseJSON): Promise<void> {
	if (!active || waiting.value || page.value !== 'passkey') return;
	if (!doingPasskeyFromInputPage.value) {
		await tryLogin({ username: identifier.value, password: password.value, credential });
		return;
	}
	waiting.value = true;
	errorMessage.value = '';
	try {
		const res = await misskeyApi('signin-with-passkey', { credential, context: passkeyContext.value });
		if (!active) return;
		if (!res.signinResponse) throw new Error('Missing sign-in response');
		await onLoginSucceeded(res.signinResponse);
	} catch (err) {
		onSigninApiError(err);
	} finally {
		waiting.value = false;
	}
}

function onUseTotp(): void {
	errorMessage.value = '';
	page.value = 'totp';
}

async function backToInput(): Promise<void> {
	if (waiting.value) return;
	page.value = 'input';
	doingPasskeyFromInputPage.value = false;
	credentialRequest.value = null;
	passkeyContext.value = '';
	password.value = '';
	errorMessage.value = '';
	inputPageEl.value?.clearPassword();
	inputPageEl.value?.resetCaptcha();
	await nextTick();
	inputPageEl.value?.focus();
}

async function onCredentialsSubmitted(value: PwResponse & { identifier: string }): Promise<void> {
	if (waiting.value) return;
	identifier.value = value.identifier;
	password.value = value.password;
	doingPasskeyFromInputPage.value = false;
	await tryLogin({
		username: identifier.value,
		password: password.value,
		'hcaptcha-response': value.captcha.hCaptchaResponse,
		'm-captcha-response': value.captcha.mCaptchaResponse,
		'g-recaptcha-response': value.captcha.reCaptchaResponse,
		'turnstile-response': value.captcha.turnstileResponse,
		'testcaptcha-response': value.captcha.testcaptchaResponse,
	});
}

async function onTotpSubmitted(token: string): Promise<void> {
	if (waiting.value || !identifier.value || !password.value) return;
	await tryLogin({ username: identifier.value, password: password.value, token });
}

async function tryLogin(request: Misskey.entities.SigninFlowRequest): Promise<void> {
	if (waiting.value) return;
	waiting.value = true;
	errorMessage.value = '';
	try {
		const res = await misskeyApi('signin-flow', request);
		if (!active) return;
		if (res.finished) {
			await onLoginSucceeded(res);
		} else {
			switch (res.next) {
				case 'captcha':
					needCaptcha.value = true;
					page.value = 'input';
					break;
				case 'password':
					needCaptcha.value = false;
					page.value = 'input';
					break;
				case 'totp':
					page.value = 'totp';
					break;
				case 'passkey':
					if (browserSupportsWebAuthn()) {
						credentialRequest.value = res.authRequest;
						page.value = 'passkey';
					} else {
						page.value = 'totp';
					}
					break;
			}
		}
	} catch (err) {
		onSigninApiError(err);
	} finally {
		inputPageEl.value?.resetCaptcha();
		waiting.value = false;
	}
}

async function onLoginSucceeded(res: Misskey.entities.SigninFlowResponse & { finished: true }): Promise<void> {
	if (!active) return;
	// Keep the dialog available if establishing the local session fails.
	if (props.autoSet) await login(res.i);
	if (!active) return;
	password.value = '';
	inputPageEl.value?.clearPassword();
	emit('login', res);
}

function onSigninApiError(error: unknown): void {
	if (!active) return;
	const err = error as { id?: string; code?: string; message?: string } | undefined;
	switch (err?.id) {
		case '6cc579cc-885d-43d8-95c2-b8c7fc963280':
		case '932c904e-9460-45b7-9ce6-7ed33be7eb2c':
			errorMessage.value = authText.invalidCredentials;
			break;
		case 'e03a5f46-d309-4865-9b69-56282d94e1eb':
			showSuspendedDialog();
			break;
		case '22d05606-fbcf-421a-a2db-b32610dcfd1b':
			errorMessage.value = i18n.ts.rateLimitExceeded;
			break;
		case 'cdf1235b-ac71-46d4-a3a6-84ccce48df6f':
			errorMessage.value = i18n.ts.incorrectTotp;
			break;
		case '36b96a7d-b547-412d-aeed-2d611cdc8cdc':
			errorMessage.value = i18n.ts.unknownWebAuthnKey;
			break;
		case '93b86c4b-72f9-40eb-9815-798928603d1e':
		case 'b18c89a7-5b5e-4cec-bb5b-0419f332d430':
			errorMessage.value = i18n.ts.passkeyVerificationFailed;
			break;
		case '2d84773e-f7b7-4d0b-8f72-bb69b584c912':
			errorMessage.value = i18n.ts.passkeyVerificationSucceededButPasswordlessLoginDisabled;
			break;
		default: {
			const captchaEnabled = instance.enableHcaptcha || instance.enableMcaptcha || instance.enableRecaptcha || instance.enableTurnstile || instance.enableTestcaptcha;
			// Fastify may expose only "Bad Request" through misskeyApi. Do not invent a cause.
			errorMessage.value = /captcha/i.test(typeof error === 'string' ? error : `${err?.code ?? ''} ${err?.message ?? ''}`) ? authText.captchaError :
				error === 'Bad Request' && needCaptcha.value && captchaEnabled ? authText.verificationRetry :
				error instanceof TypeError ? authText.networkError : authText.serviceError;
			break;
		}
	}
	if (doingPasskeyFromInputPage.value) {
		doingPasskeyFromInputPage.value = false;
		page.value = 'input';
		password.value = '';
		credentialRequest.value = null;
		passkeyContext.value = '';
	}
}

onBeforeUnmount(() => {
	active = false;
	password.value = '';
	passkeyContext.value = '';
	credentialRequest.value = null;
});
</script>

<style lang="scss" module>
.signinRoot { position: relative; }
.error {
	margin-bottom: 20px;
	padding: 12px 14px;
	border: 1px solid var(--MI_THEME-error);
	border-radius: 8px;
	color: var(--MI_THEME-error);
	line-height: 1.6;
	overflow-wrap: anywhere;
}
.back { min-height: 44px; text-align: start; }
.waitingRoot {
	position: absolute;
	inset: 0;
	background-color: color-mix(in srgb, var(--MI_THEME-panel), transparent 15%);
	display: flex;
	gap: 12px;
	justify-content: center;
	align-items: center;
	z-index: 1;
}
</style>
