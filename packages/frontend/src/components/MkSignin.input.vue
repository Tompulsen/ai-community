<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div :class="$style.wrapper" data-testid="signin-page-input">
	<div :class="$style.root">
		<div :class="$style.intro">
			<h2>{{ authText.signinTitle }}</h2>
			<p>{{ authText.signinHint }}</p>
		</div>

		<!-- ログイン画面メッセージ -->
		<MkInfo v-if="message">
			{{ message }}
		</MkInfo>

		<!-- 外部サーバーへの転送 -->
		<div v-if="openOnRemote" class="_gaps_m">
			<div class="_gaps_s">
				<MkButton type="button" rounded primary style="margin: 0 auto;" @click="openRemote(openOnRemote)">
					{{ i18n.ts.continueOnRemote }} <i class="ti ti-external-link"></i>
				</MkButton>
				<button type="button" class="_button" :class="$style.instanceManualSelectButton" @click="specifyHostAndOpenRemote(openOnRemote)">
					{{ i18n.ts.specifyServerHost }}
				</button>
			</div>
			<div :class="$style.orHr">
				<p :class="$style.orMsg">{{ i18n.ts.or }}</p>
			</div>
		</div>

		<XPassword ref="passwordForm" :user="null" :needCaptcha="needCaptcha" :waiting="waiting" embedded @passwordSubmitted="onPasswordSubmitted">
			<template #identifier>
				<MkInput ref="identifierInput" v-model="username" name="username" :placeholder="authText.identifier" type="text" pattern=".*\S.*" :spellcheck="false" autocapitalize="none" autocomplete="username webauthn" :disabled="waiting" autofocus required large data-testid="signin-username">
					<template #label>{{ authText.identifier }}</template>
					<template #prefix><i class="ti ti-user" aria-hidden="true"></i></template>
				</MkInput>
			</template>
		</XPassword>

		<!-- パスワードレスログイン -->
		<div v-if="supportsPasskey" :class="$style.orHr">
			<p :class="$style.orMsg">{{ i18n.ts.or }}</p>
		</div>
		<div v-if="supportsPasskey">
			<MkButton type="button" full large rounded :disabled="waiting" @click="emit('passkeyClick')">
				<i class="ti ti-device-usb" style="font-size: medium;"></i>{{ i18n.ts.signinWithPasskey }}
			</MkButton>
		</div>
	</div>
</div>
</template>

<script setup lang="ts">
import { ref, useTemplateRef } from 'vue';
import { browserSupportsWebAuthn } from '@simplewebauthn/browser';

import { query, extractDomain } from '@@/js/url.js';
import type { OpenOnRemoteOptions } from '@/utility/please-login.js';
import { i18n } from '@/i18n.js';
import * as os from '@/os.js';

import MkButton from '@/components/MkButton.vue';
import MkInput from '@/components/MkInput.vue';
import MkInfo from '@/components/MkInfo.vue';
import XPassword from '@/components/MkSignin.password.vue';
import type { PwResponse } from '@/components/MkSignin.password.vue';
import { authText } from '@/utility/auth-copy.js';

const props = withDefaults(defineProps<{
	message?: string,
	openOnRemote?: OpenOnRemoteOptions,
	initialUsername?: string;
	needCaptcha?: boolean;
	waiting?: boolean;
}>(), {
	message: '',
	openOnRemote: undefined,
	initialUsername: undefined,
});

const emit = defineEmits<{
	(ev: 'credentialsSubmitted', v: PwResponse & { identifier: string }): void;
	(ev: 'passkeyClick'): void;
}>();

const username = ref(props.initialUsername ?? '');
const supportsPasskey = browserSupportsWebAuthn();
const passwordForm = useTemplateRef('passwordForm');
const identifierInput = useTemplateRef('identifierInput');

function onPasswordSubmitted(value: PwResponse) {
	if (!username.value.trim() || props.waiting) return;
	emit('credentialsSubmitted', { ...value, identifier: username.value.trim() });
}

defineExpose({
	resetCaptcha: () => passwordForm.value?.resetCaptcha(),
	clearPassword: () => passwordForm.value?.clearPassword(),
	focus: () => identifierInput.value?.focus(),
});

//#region Open on remote
function openRemote(options: OpenOnRemoteOptions, targetHost?: string): void {
	switch (options.type) {
		case 'web':
		case 'lookup': {
			let _path: string;

			if (options.type === 'lookup') {
				// TODO: v2024.7.0以降が浸透してきたら正式なURLに変更する▼
				// _path = `/lookup?uri=${encodeURIComponent(_path)}`;
				_path = `/authorize-follow?acct=${encodeURIComponent(options.url)}`;
			} else {
				_path = options.path;
			}

			if (targetHost) {
				window.open(`https://${targetHost}${_path}`, '_blank', 'noopener');
			} else {
				window.open(`https://misskey-hub.net/mi-web/?path=${encodeURIComponent(_path)}`, '_blank', 'noopener');
			}
			break;
		}
		case 'share': {
			const params = query(options.params);
			if (targetHost) {
				window.open(`https://${targetHost}/share?${params}`, '_blank', 'noopener');
			} else {
				window.open(`https://misskey-hub.net/share/?${params}`, '_blank', 'noopener');
			}
			break;
		}
	}
}

async function specifyHostAndOpenRemote(options: OpenOnRemoteOptions): Promise<void> {
	const { canceled, result: hostTemp } = await os.inputText({
		title: i18n.ts.inputHostName,
		placeholder: 'misskey.example.com',
	});

	if (canceled) return;

	let targetHost: string | null = hostTemp;

	// ドメイン部分だけを取り出す
	targetHost = extractDomain(targetHost ?? '');
	if (targetHost == null) {
		os.alert({
			type: 'error',
			title: i18n.ts.invalidValue,
			text: i18n.ts.tryAgain,
		});
		return;
	}
	openRemote(options, targetHost);
}
//#endregion
</script>

<style lang="scss" module>
.root {
	display: flex;
	flex-direction: column;
	gap: 20px;
}

.wrapper {
	display: flex;
	align-items: center;
	width: 100%;
	min-height: 0;

	> .root {
		width: 100%;
	}
}

.intro {
	h2 { margin: 0; font-size: 1.75em; font-weight: 650; letter-spacing: -.025em; line-height: 1.3; }
	p { margin: 10px 0 0; color: var(--MI_THEME-fgTransparentWeak); line-height: 1.6; }
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
