<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div>
	<div class="_spacer" style="--MI_SPACER-min: 20px; --MI_SPACER-max: 32px;">
		<div :class="$style.intro"><h2>{{ authText.signupTitle }}</h2><p>{{ authText.signupHint }}</p></div>
		<form class="_gaps_m" :aria-busy="submitting" @submit.prevent="onSubmit">
			<div v-if="errorMessage" role="alert" :class="$style.error" data-testid="signup-error">{{ errorMessage }}</div>
			<fieldset class="_gaps_m" :class="$style.fields" :disabled="submitting || !!createdAccount">
			<MkInput v-if="instance.disableRegistration" v-model="invitationCode" type="text" :spellcheck="false" required data-testid="signup-invitation-code">
				<template #label>{{ i18n.ts.invitationCode }}</template>
				<template #prefix><i class="ti ti-key"></i></template>
			</MkInput>
			<MkInput v-model="username" name="username" type="text" pattern="^[a-zA-Z0-9_]{1,20}$" :spellcheck="false" autocapitalize="none" autocomplete="username" required autofocus large data-testid="signup-username">
				<template #label>{{ i18n.ts.username }}</template>
				<template #prefix>@</template>
				<template #caption>
					<div>{{ authText.usernameHint }}</div>
					<span v-if="usernameState === 'wait'" role="status"><MkLoading :em="true"/> {{ i18n.ts.checking }}</span>
					<span v-else-if="usernameState === 'ok'" style="color: var(--MI_THEME-success)"><i class="ti ti-check ti-fw"></i> {{ i18n.ts.available }}</span>
					<span v-else-if="usernameState === 'unavailable'" style="color: var(--MI_THEME-error)"><i class="ti ti-alert-triangle ti-fw"></i> {{ i18n.ts.unavailable }}</span>
					<span v-else-if="usernameState === 'error'" style="color: var(--MI_THEME-error)">{{ authText.checkFailed }} <button type="button" class="_textButton" @click="onChangeUsername">{{ authText.retryCheck }}</button></span>
					<span v-else-if="usernameState === 'invalid-format'" style="color: var(--MI_THEME-error)"><i class="ti ti-alert-triangle ti-fw"></i> {{ i18n.ts.usernameInvalidFormat }}</span>
					<span v-else-if="usernameState === 'min-range'" style="color: var(--MI_THEME-error)"><i class="ti ti-alert-triangle ti-fw"></i> {{ i18n.ts.tooShort }}</span>
					<span v-else-if="usernameState === 'max-range'" style="color: var(--MI_THEME-error)"><i class="ti ti-alert-triangle ti-fw"></i> {{ i18n.ts.tooLong }}</span>
				</template>
			</MkInput>
			<MkInput v-model="email" name="email" type="email" autocomplete="email" autocapitalize="none" :spellcheck="false" required large data-testid="signup-email">
				<template #label>{{ i18n.ts.emailAddress }}</template>
				<template #prefix><i class="ti ti-mail"></i></template>
				<template #caption>
					<span v-if="!instance.emailRequiredForSignup">{{ authText.emailUnverified }}</span>
					<span v-if="emailState === 'wait'" role="status"><MkLoading :em="true"/> {{ i18n.ts.checking }}</span>
					<span v-else-if="emailState === 'ok'" style="color: var(--MI_THEME-success)"><i class="ti ti-check ti-fw"></i> {{ i18n.ts.available }}</span>
					<span v-else-if="emailState === 'unavailable:used'" style="color: var(--MI_THEME-error)"><i class="ti ti-alert-triangle ti-fw"></i> {{ i18n.ts._emailUnavailable.used }}</span>
					<span v-else-if="emailState === 'unavailable:format'" style="color: var(--MI_THEME-error)"><i class="ti ti-alert-triangle ti-fw"></i> {{ i18n.ts._emailUnavailable.format }}</span>
					<span v-else-if="emailState === 'unavailable:disposable'" style="color: var(--MI_THEME-error)"><i class="ti ti-alert-triangle ti-fw"></i> {{ i18n.ts._emailUnavailable.disposable }}</span>
					<span v-else-if="emailState === 'unavailable:banned'" style="color: var(--MI_THEME-error)"><i class="ti ti-alert-triangle ti-fw"></i> {{ i18n.ts._emailUnavailable.banned }}</span>
					<span v-else-if="emailState === 'unavailable:mx'" style="color: var(--MI_THEME-error)"><i class="ti ti-alert-triangle ti-fw"></i> {{ i18n.ts._emailUnavailable.mx }}</span>
					<span v-else-if="emailState === 'unavailable:smtp'" style="color: var(--MI_THEME-error)"><i class="ti ti-alert-triangle ti-fw"></i> {{ i18n.ts._emailUnavailable.smtp }}</span>
					<span v-else-if="emailState === 'unavailable'" style="color: var(--MI_THEME-error)"><i class="ti ti-alert-triangle ti-fw"></i> {{ i18n.ts.unavailable }}</span>
					<span v-else-if="emailState === 'error'" style="color: var(--MI_THEME-error)">{{ authText.checkFailed }} <button type="button" class="_textButton" @click="onChangeEmail">{{ authText.retryCheck }}</button></span>
				</template>
			</MkInput>
			<MkInput v-model="password" name="password" type="password" autocomplete="new-password" withPasswordToggle required large data-testid="signup-password" @update:modelValue="onChangePassword">
				<template #label>{{ i18n.ts.password }}</template>
				<template #prefix><i class="ti ti-lock"></i></template>
				<template #caption>
					<span v-if="!password">{{ authText.passwordHint }}</span>
					<span v-if="passwordStrength == 'low'" style="color: var(--MI_THEME-error)"><i class="ti ti-alert-triangle ti-fw"></i> {{ i18n.ts.weakPassword }}</span>
					<span v-if="passwordStrength == 'medium'" style="color: var(--MI_THEME-warn)"><i class="ti ti-check ti-fw"></i> {{ i18n.ts.normalPassword }}</span>
					<span v-if="passwordStrength == 'high'" style="color: var(--MI_THEME-success)"><i class="ti ti-check ti-fw"></i> {{ i18n.ts.strongPassword }}</span>
				</template>
			</MkInput>
			<MkInput v-model="retypedPassword" name="confirmPassword" type="password" autocomplete="new-password" withPasswordToggle required large data-testid="signup-password-retype">
				<template #label>{{ i18n.ts.password }} ({{ i18n.ts.retype }})</template>
				<template #prefix><i class="ti ti-lock"></i></template>
				<template #caption>
					<span v-if="passwordRetypeState == 'match'" style="color: var(--MI_THEME-success)"><i class="ti ti-check ti-fw"></i> {{ i18n.ts.passwordMatched }}</span>
					<span v-if="passwordRetypeState == 'not-match'" style="color: var(--MI_THEME-error)"><i class="ti ti-alert-triangle ti-fw"></i> {{ i18n.ts.passwordNotMatched }}</span>
				</template>
			</MkInput>
			<MkCaptcha v-if="instance.enableHcaptcha" ref="hcaptcha" v-model="hCaptchaResponse" :class="$style.captcha" provider="hcaptcha" :sitekey="instance.hcaptchaSiteKey"/>
			<MkCaptcha v-if="instance.enableMcaptcha" ref="mcaptcha" v-model="mCaptchaResponse" :class="$style.captcha" provider="mcaptcha" :sitekey="instance.mcaptchaSiteKey" :instanceUrl="instance.mcaptchaInstanceUrl"/>
			<MkCaptcha v-if="instance.enableRecaptcha" ref="recaptcha" v-model="reCaptchaResponse" :class="$style.captcha" provider="recaptcha" :sitekey="instance.recaptchaSiteKey"/>
			<MkCaptcha v-if="instance.enableTurnstile" ref="turnstile" v-model="turnstileResponse" :class="$style.captcha" provider="turnstile" :sitekey="instance.turnstileSiteKey"/>
			<MkCaptcha v-if="instance.enableTestcaptcha" ref="testcaptcha" v-model="testcaptchaResponse" :class="$style.captcha" provider="testcaptcha" :sitekey="null"/>
			</fieldset>
			<MkButton type="submit" :disabled="shouldDisableSubmitting" large primary rounded full data-testid="signup-submit">
				<template v-if="submitting">
					<MkLoading :em="true" :colored="false"/>
					{{ createdAccount ? authText.signingIn : authText.signingUp }}
				</template>
				<template v-else>{{ createdAccount ? authText.retrySignin : authText.signup }}</template>
			</MkButton>
		</form>
	</div>
</div>
</template>

<script lang="ts" setup>
import { rememberLotteryInvite } from '@/utility/lottery-invite.js';
import { ref, computed, watch, onBeforeUnmount } from 'vue';
import * as Misskey from 'misskey-js';
import * as config from '@@/js/config.js';
import MkButton from './MkButton.vue';
import MkInput from './MkInput.vue';
import type { Captcha } from '@/components/MkCaptcha.vue';
import MkCaptcha from '@/components/MkCaptcha.vue';
import * as os from '@/os.js';
import { misskeyApi } from '@/utility/misskey-api.js';
import { instance } from '@/instance.js';
import { i18n } from '@/i18n.js';
import { login } from '@/accounts.js';
import { authText } from '@/utility/auth-copy.js';

const props = withDefaults(defineProps<{
	autoSet?: boolean;
}>(), {
	autoSet: false,
});

const emit = defineEmits<{
	(ev: 'signup', user: Misskey.entities.SignupResponse): void;
	(ev: 'signupEmailPending'): void;
	(ev: 'busy', value: boolean): void;
}>();

const hcaptcha = ref<Captcha | undefined>();
const mcaptcha = ref<Captcha | undefined>();
const recaptcha = ref<Captcha | undefined>();
const turnstile = ref<Captcha | undefined>();
const testcaptcha = ref<Captcha | undefined>();

const username = ref<string>('');
const password = ref<string>('');
const retypedPassword = ref<string>('');
const invitationCode = ref<string>('');
const email = ref('');
const usernameState = ref<null | 'wait' | 'ok' | 'unavailable' | 'error' | 'invalid-format' | 'min-range' | 'max-range'>(null);
const emailState = ref<null | 'wait' | 'ok' | 'unavailable:used' | 'unavailable:format' | 'unavailable:disposable' | 'unavailable:banned' | 'unavailable:mx' | 'unavailable:smtp' | 'unavailable' | 'error'>(null);
const passwordStrength = ref<'' | 'low' | 'medium' | 'high'>('');
const passwordRetypeState = computed(() => !retypedPassword.value ? null : password.value === retypedPassword.value ? 'match' : 'not-match');
const submitting = ref<boolean>(false);
const errorMessage = ref('');
const createdAccount = ref<Misskey.entities.SignupResponse | null>(null);
const hCaptchaResponse = ref<string | null>(null);
const mCaptchaResponse = ref<string | null>(null);
const reCaptchaResponse = ref<string | null>(null);
const turnstileResponse = ref<string | null>(null);
const testcaptchaResponse = ref<string | null>(null);
const usernameAbortController = ref<null | AbortController>(null);
const emailAbortController = ref<null | AbortController>(null);
let usernameTimer: number | undefined;
let emailTimer: number | undefined;
let active = true;

watch(submitting, value => emit('busy', value), { flush: 'sync' });
watch(username, onChangeUsername, { flush: 'sync' });
watch(email, onChangeEmail, { flush: 'sync' });

const shouldDisableSubmitting = computed((): boolean => {
	if (createdAccount.value) return submitting.value;
	return submitting.value ||
		instance.enableHcaptcha && !hCaptchaResponse.value ||
		instance.enableMcaptcha && !mCaptchaResponse.value ||
		instance.enableRecaptcha && !reCaptchaResponse.value ||
		instance.enableTurnstile && !turnstileResponse.value ||
		instance.enableTestcaptcha && !testcaptchaResponse.value ||
		emailState.value !== 'ok' ||
		instance.disableRegistration && invitationCode.value === '' ||
		usernameState.value !== 'ok' ||
		!password.value || passwordRetypeState.value !== 'match';
});

function getPasswordStrength(source: string): number {
	let strength = 0;
	let power = 0.018;

	// 英数字
	if (/[a-zA-Z]/.test(source) && /[0-9]/.test(source)) {
		power += 0.020;
	}

	// 大文字と小文字が混ざってたら
	if (/[a-z]/.test(source) && /[A-Z]/.test(source)) {
		power += 0.015;
	}

	// 記号が混ざってたら
	if (/[!\x22\#$%&@'()*+,-./_]/.test(source)) {
		power += 0.02;
	}

	strength = power * source.length;

	return Math.max(0, Math.min(1, strength));
}

function onChangeUsername(): void {
	window.clearTimeout(usernameTimer);
	usernameAbortController.value?.abort();
	usernameAbortController.value = null;
	if (!username.value) { usernameState.value = null; return; }
	if (!/^[a-zA-Z0-9_]+$/.test(username.value)) { usernameState.value = 'invalid-format'; return; }
	if (username.value.length > 20) { usernameState.value = 'max-range'; return; }
	usernameState.value = 'wait';
	const value = username.value;
	const controller = new AbortController();
	usernameAbortController.value = controller;
	usernameTimer = window.setTimeout(async () => {
		try {
			const result = await misskeyApi('username/available', { username: value }, undefined, controller.signal);
			if (active && !controller.signal.aborted && username.value === value) usernameState.value = result.available ? 'ok' : 'unavailable';
		} catch {
			if (active && !controller.signal.aborted && username.value === value) usernameState.value = 'error';
		}
	}, 300);
}

function onChangeEmail(): void {
	window.clearTimeout(emailTimer);
	emailAbortController.value?.abort();
	emailAbortController.value = null;
	const value = email.value.trim().toLowerCase();
	if (!value) { emailState.value = null; return; }
	if (value.length > 128 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) { emailState.value = 'unavailable:format'; return; }
	emailState.value = 'wait';
	const controller = new AbortController();
	emailAbortController.value = controller;
	emailTimer = window.setTimeout(async () => {
		try {
			const result = await misskeyApi('email-address/available', { emailAddress: value }, undefined, controller.signal);
			if (!active || controller.signal.aborted || email.value.trim().toLowerCase() !== value) return;
			emailState.value = result.available ? 'ok' :
				result.reason === 'used' ? 'unavailable:used' :
				result.reason === 'format' ? 'unavailable:format' :
				result.reason === 'disposable' ? 'unavailable:disposable' :
				result.reason === 'banned' ? 'unavailable:banned' :
				result.reason === 'mx' ? 'unavailable:mx' :
				result.reason === 'smtp' ? 'unavailable:smtp' : 'unavailable';
		} catch {
			if (active && !controller.signal.aborted && email.value.trim().toLowerCase() === value) emailState.value = 'error';
		}
	}, 300);
}

function onChangePassword(): void {
	if (password.value === '') {
		passwordStrength.value = '';
		return;
	}

	const strength = getPasswordStrength(password.value);
	passwordStrength.value = strength > 0.7 ? 'high' : strength > 0.3 ? 'medium' : 'low';
}

function resetCaptcha(): void {
	hCaptchaResponse.value = mCaptchaResponse.value = reCaptchaResponse.value = turnstileResponse.value = testcaptchaResponse.value = null;
	hcaptcha.value?.reset();
	mcaptcha.value?.reset();
	recaptcha.value?.reset();
	turnstile.value?.reset();
	testcaptcha.value?.reset();
}

function signupErrorText(body: unknown, status: number): string {
	const error = body as { error?: { code?: string; message?: string }; message?: string } | null;
	const code = `${error?.error?.code ?? ''} ${error?.error?.message ?? ''} ${error?.message ?? ''}`;
	if (status === 429) return i18n.ts.rateLimitExceeded;
	if (/captcha/i.test(code)) return authText.captchaError;
	if (/DUPLICATED_USERNAME|USED_USERNAME|DENIED_USERNAME/.test(code)) return authText.usernameUsed;
	if (/DUPLICATED_EMAIL|EMAIL_ALREADY_USED/.test(code)) return authText.emailUsed;
	if (/INVITATION|TICKET/.test(code)) return authText.invitationInvalid;
	if (/INVALID_CREDENTIALS/.test(code)) return authText.invalidSignup;
	return authText.signupError;
}

async function onSubmit(): Promise<void> {
	if (shouldDisableSubmitting.value) return;
	submitting.value = true;
	errorMessage.value = '';
	try {
		if (!createdAccount.value) {
			const signupPayload: Misskey.entities.SignupRequest & { lotteryInviterId?: string } = {
				lotteryInviterId: rememberLotteryInvite(),
				username: username.value,
				password: password.value,
				emailAddress: email.value.trim().toLowerCase(),
				invitationCode: invitationCode.value,
				'hcaptcha-response': hCaptchaResponse.value,
				'm-captcha-response': mCaptchaResponse.value,
				'g-recaptcha-response': reCaptchaResponse.value,
				'turnstile-response': turnstileResponse.value,
				'testcaptcha-response': testcaptchaResponse.value,
			};
			const res = await window.fetch(`${config.apiUrl}/signup`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(signupPayload),
			});
			if (!active) return;
			if (!res.ok) {
				const body: unknown = await res.json().catch(() => null);
				if (!active) return;
				errorMessage.value = signupErrorText(body, res.status);
				// Availability can change between the initial check and registration.
				onChangeUsername();
				onChangeEmail();
				return;
			}
			if (res.status === 204) {
				await os.alert({ type: 'success', title: i18n.ts._signup.almostThere, text: i18n.tsx._signup.emailSent({ email: email.value }) });
				if (active) emit('signupEmailPending');
				return;
			}
			const account = await res.json() as Misskey.entities.SignupResponse;
			if (!active) return;
			if (!account || typeof account.id !== 'string' || typeof account.token !== 'string' || !account.token) throw new Error('Invalid signup response');
			createdAccount.value = account;
			password.value = retypedPassword.value = '';
		}
		if (props.autoSet) await login(createdAccount.value.token);
		if (active) emit('signup', createdAccount.value);
	} catch (err) {
		if (active) errorMessage.value = createdAccount.value ? authText.accountCreated : err instanceof TypeError ? authText.networkError : authText.signupError;
	} finally {
		resetCaptcha();
		submitting.value = false;
	}
}

onBeforeUnmount(() => {
	active = false;
	window.clearTimeout(usernameTimer);
	window.clearTimeout(emailTimer);
	usernameAbortController.value?.abort();
	emailAbortController.value?.abort();
	password.value = retypedPassword.value = '';
	createdAccount.value = null;
});
</script>

<style lang="scss" module>
.intro {
	margin-bottom: 24px;
	h2 { margin: 0; font-size: 1.5em; line-height: 1.35; }
	p { margin: 10px 0 0; line-height: 1.6; color: var(--MI_THEME-fgTransparentWeak); }
}
.fields { border: 0; padding: 0; margin: 0; min-width: 0; }
.error { padding: 12px 14px; border: 1px solid var(--MI_THEME-error); border-radius: 8px; color: var(--MI_THEME-error); line-height: 1.6; overflow-wrap: anywhere; }
.captcha { max-width: 100%; overflow-x: auto; }
</style>
