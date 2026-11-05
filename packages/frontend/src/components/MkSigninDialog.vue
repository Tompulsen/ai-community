<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<MkModal
	ref="modal"
	:preferType="'dialog'"
	@click="onClose"
	@esc="onClose"
	@closed="emit('closed')"
>
	<div :class="[$style.root, { [$style.signup]: signupMode }]">
		<div :class="$style.header">
			<div :class="$style.headerText"><i class="ti ti-login-2" aria-hidden="true"></i> {{ signupMode ? i18n.ts.signup : i18n.ts.login }}</div>
			<button type="button" :class="$style.closeButton" class="_button" :disabled="busy" :aria-label="i18n.ts.close" @click="onClose"><i class="ti ti-x" aria-hidden="true"></i></button>
		</div>
		<div v-if="!signupMode" :class="$style.content">
			<MkSignin :autoSet="autoSet" :message="message" :openOnRemote="openOnRemote" :initialUsername="initialUsername" @login="onLogin" @busy="busy = $event"/>
		</div>
		<template v-else>
			<XServerRules v-if="!acceptedRules" @done="acceptedRules = true" @cancel="signupMode = false"/>
			<XSignup v-else :autoSet="autoSet" @signup="onSignup" @signupEmailPending="modal?.close()" @busy="busy = $event"/>
		</template>
		<div v-if="autoSet" :class="$style.switchMode">
			<span>{{ signupMode ? authText.haveAccount : authText.noAccount }}</span>
			<button type="button" class="_textButton" :disabled="busy" data-testid="auth-switch" @click="signupMode = !signupMode">{{ signupMode ? authText.goSignin : authText.goSignup }}</button>
		</div>
	</div>
</MkModal>
</template>

<script lang="ts" setup>
import * as Misskey from 'misskey-js';
import { useTemplateRef, ref } from 'vue';
import type { OpenOnRemoteOptions } from '@/utility/please-login.js';
import MkSignin from '@/components/MkSignin.vue';
import MkModal from '@/components/MkModal.vue';
import { i18n } from '@/i18n.js';
import XSignup from '@/components/MkSignupDialog.form.vue';
import XServerRules from '@/components/MkSignupDialog.rules.vue';
import { authText } from '@/utility/auth-copy.js';

withDefaults(defineProps<{
	autoSet?: boolean;
	message?: string,
	openOnRemote?: OpenOnRemoteOptions,
	initialUsername?: string;
}>(), {
	autoSet: false,
	message: '',
	openOnRemote: undefined,
	initialUsername: undefined,
});

const emit = defineEmits<{
	(ev: 'done', v: Misskey.entities.SigninFlowResponse & { finished: true }): void;
	(ev: 'closed'): void;
	(ev: 'cancelled'): void;
}>();

const modal = useTemplateRef('modal');
const signupMode = ref(false);
const acceptedRules = ref(false);
const busy = ref(false);

function onClose() {
	if (busy.value) return;
	emit('cancelled');
	if (modal.value) modal.value.close();
}

function onLogin(res: Misskey.entities.SigninFlowResponse & { finished: true }) {
	emit('done', res);
	if (modal.value) modal.value.close();
}

function onSignup(res: Misskey.entities.SignupResponse) {
	onLogin({ finished: true, id: res.id, i: res.token });
}
</script>

<style lang="scss" module>
.root {
	overflow: auto;
	margin: auto;
	position: relative;
	width: calc(100vw - 24px);
	max-width: 440px;
	max-height: min(90dvh, 760px);
	box-sizing: border-box;
	background: var(--MI_THEME-panel);
	border-radius: var(--MI-radius);
}

.signup { max-width: 500px; }
.switchMode {
	display: flex;
	flex-wrap: wrap;
	justify-content: center;
	align-items: center;
	gap: 8px;
	padding: 4px 24px 24px;
	button { min-height: 44px; font-weight: bold; }
}

.header {
	position: sticky;
	top: 0;
	left: 0;
	width: 100%;
	height: 50px;
	box-sizing: border-box;
	display: flex;
	align-items: center;
	font-weight: bold;
	backdrop-filter: var(--MI-blur, blur(15px));
	background: color(from var(--MI_THEME-bg) srgb r g b / 0.5);
	z-index: 1;
}

.headerText {
	padding: 0 20px;
	box-sizing: border-box;
}

.closeButton {
	margin-left: auto;
	padding: 16px;
	font-size: 16px;
	line-height: 16px;
}

.content {
	padding: 24px 28px 12px;
	box-sizing: border-box;
}

@media (max-width: 480px) {
	.content { padding: 20px 20px 8px; }
}
</style>
