<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div :class="$style.root">
	<aside :class="$style.side">
		<MkA to="/" :class="$style.brand">{{ i18n.ts._aiCommunity.title }}</MkA>
		<MkCommunityNav :compact="narrow"/>
		<div :class="$style.accountLinks">
			<MkButton @click="signin">{{ i18n.ts.login }}</MkButton>
			<MkButton v-if="!instance.disableRegistration" primary @click="signup">{{ i18n.ts.signup }}</MkButton>
		</div>
	</aside>
	<div :class="$style.main">
		<header :class="$style.mobileHeader">
			<MkA to="/">{{ i18n.ts._aiCommunity.title }}</MkA>
			<MkButton @click="signin">{{ i18n.ts.login }}</MkButton>
		</header>
		<div :class="$style.content"><RouterView/></div>
	</div>
</div>
<XCommon/>
</template>

<script lang="ts" setup>
import { onBeforeUnmount, provide, ref } from 'vue';
import { instanceName } from '@@/js/config.js';
import XCommon from './_common_/common.vue';
import type { PageMetadata } from '@/page.js';
import { instance } from '@/instance.js';
import { provideMetadataReceiver, provideReactiveMetadata } from '@/page.js';
import { i18n } from '@/i18n.js';
import { mainRouter } from '@/router.js';
import { DI } from '@/di.js';
import MkButton from '@/components/MkButton.vue';
import MkCommunityNav from '@/components/MkCommunityNav.vue';
import * as os from '@/os.js';

const viewport = window.matchMedia('(max-width: 700px)');
const narrow = ref(viewport.matches);
const updateViewport = () => { narrow.value = viewport.matches; };
viewport.addEventListener('change', updateViewport);
onBeforeUnmount(() => viewport.removeEventListener('change', updateViewport));

const pageMetadata = ref<null | PageMetadata>(null);
provide(DI.router, mainRouter);
provideMetadataReceiver((metadataGetter) => {
	pageMetadata.value = metadataGetter();
	if (pageMetadata.value) window.document.title = `${pageMetadata.value.title} | ${instanceName}`;
});
provideReactiveMetadata(pageMetadata);

async function signin() {
	const { dispose } = await os.popupAsyncWithDialog(import('@/components/MkSigninDialog.vue').then(x => x.default), { autoSet: true }, { closed: () => dispose() });
}

async function signup() {
	if (instance.disableRegistration) return;
	const { dispose } = await os.popupAsyncWithDialog(import('@/components/MkSignupDialog.vue').then(x => x.default), { autoSet: true }, { closed: () => dispose() });
}
</script>

<style lang="scss" module>
.root { display: flex; height: 100dvh; overflow: clip; }
.side { flex: 0 0 250px; width: 250px; overflow-y: auto; background: var(--MI_THEME-navBg); border-right: 1px solid var(--MI_THEME-divider); }
.brand { display: block; padding: 28px 24px 12px; font-size: 20px; font-weight: 700; }
.accountLinks { display: grid; gap: 12px; padding: 24px; }
.main { display: flex; flex-direction: column; flex: 1; min-width: 0; }
.content { flex: 1; min-height: 0; overflow-y: auto; }
.mobileHeader { display: none; }
@media (max-width: 700px) {
	.side { flex-basis: 76px; width: 76px; }
	.brand { padding: 20px 10px 8px; font-size: 14px; overflow-wrap: anywhere; }
	.accountLinks { display: none; }
	.mobileHeader { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 12px 16px; background: var(--MI_THEME-panel); }
}
</style>
