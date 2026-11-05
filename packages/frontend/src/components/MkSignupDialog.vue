<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<MkModalWindow
	ref="dialog"
	:width="500"
	:height="600"
	@close="onClose"
	@closed="emit('closed')"
>
	<template #header>{{ signingIn ? i18n.ts.login : i18n.ts.signup }}</template>

	<div style="overflow-x: clip;">
		<div v-if="signingIn" class="_spacer" style="--MI_SPACER-min: 20px; --MI_SPACER-max: 32px;">
			<MkSignin :autoSet="autoSet" @login="dialog?.close()" @busy="busy = $event"/>
		</div>
		<Transition
			v-else
			mode="out-in"
			:enterActiveClass="$style.transition_x_enterActive"
			:leaveActiveClass="$style.transition_x_leaveActive"
			:enterFromClass="$style.transition_x_enterFrom"
			:leaveToClass="$style.transition_x_leaveTo"
		>
			<template v-if="!isAcceptedServerRule">
				<XServerRules @done="isAcceptedServerRule = true" @cancel="onClose"/>
			</template>
			<template v-else>
				<XSignup :autoSet="autoSet" @signup="onSignup" @signupEmailPending="onSignupEmailPending" @busy="busy = $event"/>
			</template>
		</Transition>
		<div v-if="autoSet" :class="$style.switchMode">
			<span>{{ signingIn ? authText.noAccount : authText.haveAccount }}</span>
			<button type="button" class="_textButton" :disabled="busy" data-testid="auth-switch" @click="signingIn = !signingIn">{{ signingIn ? authText.goSignup : authText.goSignin }}</button>
		</div>
	</div>
</MkModalWindow>
</template>

<script lang="ts" setup>
import { useTemplateRef, ref } from 'vue';
import * as Misskey from 'misskey-js';
import XSignup from '@/components/MkSignupDialog.form.vue';
import XServerRules from '@/components/MkSignupDialog.rules.vue';
import MkModalWindow from '@/components/MkModalWindow.vue';
import { i18n } from '@/i18n.js';
import MkSignin from '@/components/MkSignin.vue';
import { authText } from '@/utility/auth-copy.js';

const props = withDefaults(defineProps<{
	autoSet?: boolean;
}>(), {
	autoSet: false,
});

const emit = defineEmits<{
	(ev: 'done', res: Misskey.entities.SignupResponse): void;
	(ev: 'cancelled'): void;
	(ev: 'closed'): void;
}>();

const dialog = useTemplateRef('dialog');

const isAcceptedServerRule = ref(false);
const signingIn = ref(false);
const busy = ref(false);

function onClose() {
	if (busy.value) return;
	emit('cancelled');
	dialog.value?.close();
}

function onSignup(res: Misskey.entities.SignupResponse) {
	emit('done', res);
	dialog.value?.close();
}

function onSignupEmailPending() {
	dialog.value?.close();
}
</script>

<style lang="scss" module>
.switchMode {
	display: flex;
	flex-wrap: wrap;
	justify-content: center;
	align-items: center;
	gap: 8px;
	padding: 0 24px 24px;
	button { min-height: 44px; font-weight: bold; }
}
.transition_x_enterActive,
.transition_x_leaveActive {
	transition: opacity 0.3s cubic-bezier(0,0,.35,1), transform 0.3s cubic-bezier(0,0,.35,1);
}
.transition_x_enterFrom {
	opacity: 0;
	transform: translateX(50px);
}
.transition_x_leaveTo {
	opacity: 0;
	transform: translateX(-50px);
}
@media (prefers-reduced-motion: reduce) {
	.transition_x_enterActive, .transition_x_leaveActive { transition: none; }
}
</style>
