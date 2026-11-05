<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div :class="[$style.wrapper, { [$style.embedded]: embedded }]" data-testid="signin-page-password">
	<div class="_gaps" :class="$style.root">
		<div v-if="!embedded" :class="$style.avatar" :style="{ backgroundImage: user ? `url('${user.avatarUrl}')` : undefined }"></div>
		<div v-if="!embedded" :class="$style.welcomeBackMessage">
			<I18n v-if="user" :src="i18n.ts.welcomeBackWithName" tag="span">
				<template #name><Mfm :text="user.name ?? user.username" :plain="true"/></template>
			</I18n>
			<span v-else>{{ i18n.ts._communityAuth.enterPassword }}</span>
		</div>

		<!-- password入力 -->
		<form class="_gaps_m" :aria-busy="waiting" @submit.prevent="onSubmit">
			<slot name="identifier">
			<!-- ブラウザ オートコンプリート用 -->
			<input type="hidden" name="username" autocomplete="username" :value="identifier ?? user?.username">
			</slot>

			<MkInput v-model="password" name="password" :placeholder="i18n.ts.password" type="password" autocomplete="current-password" :withPasswordToggle="true" :disabled="waiting" required :autofocus="!embedded" large data-testid="signin-password">
				<template #label>{{ i18n.ts.password }}</template>
				<template #prefix><i class="ti ti-lock"></i></template>
					<template #caption><button class="_textButton" type="button" :disabled="waiting" @click="resetPassword">{{ i18n.ts.forgotPassword }}</button></template>
			</MkInput>

			<div v-if="needCaptcha && captchaEnabled" :class="$style.captcha">
				<MkCaptcha v-if="instance.enableHcaptcha" ref="hcaptcha" v-model="hCaptchaResponse" provider="hcaptcha" :sitekey="instance.hcaptchaSiteKey"/>
				<MkCaptcha v-if="instance.enableMcaptcha" ref="mcaptcha" v-model="mCaptchaResponse" provider="mcaptcha" :sitekey="instance.mcaptchaSiteKey" :instanceUrl="instance.mcaptchaInstanceUrl"/>
				<MkCaptcha v-if="instance.enableRecaptcha" ref="recaptcha" v-model="reCaptchaResponse" provider="recaptcha" :sitekey="instance.recaptchaSiteKey"/>
				<MkCaptcha v-if="instance.enableTurnstile" ref="turnstile" v-model="turnstileResponse" provider="turnstile" :sitekey="instance.turnstileSiteKey"/>
				<MkCaptcha v-if="instance.enableTestcaptcha" ref="testcaptcha" v-model="testcaptchaResponse" provider="testcaptcha" :sitekey="null"/>
			</div>

			<MkButton type="submit" :disabled="waiting || (needCaptcha && captchaFailed)" large primary rounded full data-testid="signin-page-password-continue">
				<MkLoading v-if="waiting" :em="true" :colored="false"/>
				{{ waiting ? authText.signingIn : authText.signin }}
			</MkButton>
		</form>
	</div>
</div>
</template>

<script lang="ts">
export type PwResponse = {
	password: string;
	captcha: {
		hCaptchaResponse: string | null;
		mCaptchaResponse: string | null;
		reCaptchaResponse: string | null;
		turnstileResponse: string | null;
		testcaptchaResponse: string | null;
	};
};
</script>

<script setup lang="ts">
import { ref, computed, useTemplateRef, defineAsyncComponent, onBeforeUnmount } from 'vue';
import * as Misskey from 'misskey-js';

import { instance } from '@/instance.js';
import { i18n } from '@/i18n.js';
import * as os from '@/os.js';
import { authText } from '@/utility/auth-copy.js';

import MkButton from '@/components/MkButton.vue';
import MkInput from '@/components/MkInput.vue';
import MkCaptcha from '@/components/MkCaptcha.vue';

const props = defineProps<{
	user: Misskey.entities.UserDetailed | null;
	identifier?: string;
	needCaptcha: boolean;
	embedded?: boolean;
	waiting?: boolean;
}>();

const emit = defineEmits<{
	(ev: 'passwordSubmitted', v: PwResponse): void;
}>();

const password = ref('');

const hCaptcha = useTemplateRef('hcaptcha');
const mCaptcha = useTemplateRef('mcaptcha');
const reCaptcha = useTemplateRef('recaptcha');
const turnstile = useTemplateRef('turnstile');
const testcaptcha = useTemplateRef('testcaptcha');

const hCaptchaResponse = ref<string | null>(null);
const mCaptchaResponse = ref<string | null>(null);
const reCaptchaResponse = ref<string | null>(null);
const turnstileResponse = ref<string | null>(null);
const testcaptchaResponse = ref<string | null>(null);
const captchaEnabled = computed(() => instance.enableHcaptcha || instance.enableMcaptcha || instance.enableRecaptcha || instance.enableTurnstile || instance.enableTestcaptcha);

const captchaFailed = computed((): boolean => {
	return (
		(instance.enableHcaptcha && !hCaptchaResponse.value) ||
		(instance.enableMcaptcha && !mCaptchaResponse.value) ||
		(instance.enableRecaptcha && !reCaptchaResponse.value) ||
		(instance.enableTurnstile && !turnstileResponse.value) ||
		(instance.enableTestcaptcha && !testcaptchaResponse.value)
	);
});

function resetPassword(): void {
	const { dispose } = os.popup(defineAsyncComponent(() => import('@/components/MkForgotPassword.vue')), {}, {
		closed: () => dispose(),
	});
}

function onSubmit() {
	if (props.waiting || (props.needCaptcha && captchaFailed.value) || !password.value) return;
	emit('passwordSubmitted', {
		password: password.value,
		captcha: {
			hCaptchaResponse: hCaptchaResponse.value,
			mCaptchaResponse: mCaptchaResponse.value,
			reCaptchaResponse: reCaptchaResponse.value,
			turnstileResponse: turnstileResponse.value,
			testcaptchaResponse: testcaptchaResponse.value,
		},
	});
}

function resetCaptcha() {
	hCaptchaResponse.value = mCaptchaResponse.value = reCaptchaResponse.value = turnstileResponse.value = testcaptchaResponse.value = null;
	hCaptcha.value?.reset();
	mCaptcha.value?.reset();
	reCaptcha.value?.reset();
	turnstile.value?.reset();
	testcaptcha.value?.reset();
}

defineExpose({
	resetCaptcha,
	clearPassword: () => { password.value = ''; },
});

onBeforeUnmount(() => { password.value = ''; });
</script>

<style lang="scss" module>
.wrapper {
	display: flex;
	align-items: center;
	width: 100%;
	min-height: 336px;

	> .root {
		width: 100%;
	}
}

.embedded { min-height: 0; }
.captcha { max-width: 100%; overflow-x: auto; }

.avatar {
	margin: 0 auto 0 auto;
	width: 64px;
	height: 64px;
	background: #ddd;
	background-position: center;
	background-size: cover;
	border-radius: 100%;
}

.welcomeBackMessage {
	text-align: center;
	font-size: 1.1em;
}

.instanceManualSelectButton {
	display: block;
	text-align: center;
	opacity: .7;
	font-size: .8em;

	&:hover {
		text-decoration: underline;
	}
}

.orHr {
	position: relative;
	margin: .4em auto;
	width: 100%;
	height: 1px;
	background: var(--MI_THEME-divider);
}

.orMsg {
	position: absolute;
	top: -.6em;
	display: inline-block;
	padding: 0 1em;
	background: var(--MI_THEME-panel);
	font-size: 0.8em;
	color: var(--MI_THEME-fgOnPanel);
	margin: 0;
	left: 50%;
	transform: translateX(-50%);
}
</style>
