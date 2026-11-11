<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div :class="[$style.root, { [$style.withDesktopNavigation]: !isHomepage && !mobileCommunity }]">
	<CommunityHeader v-if="!isHomepage && !mobileCommunity"/>
	<div :class="$style.main">
		<div :class="$style.content"><RouterView :class="{ [$style.homeContent]: isHomepage }"/></div>
		<MobileCommunityNavigation v-if="mobileCommunity"/>
	</div>
</div>
<XCommon/>
</template>

<script lang="ts" setup>
import { computed, provide, ref } from 'vue';
import { instanceName } from '@@/js/config.js';
import XCommon from './_common_/common.vue';
import CommunityHeader from './_common_/community-header.vue';
import MobileCommunityNavigation from '@/pages/community/mobile-navigation.vue';
import { useMobileCommunityFeed } from '@/pages/community/mobile-feed.js';
import { deviceKind } from '@/utility/device-kind.js';
import type { PageMetadata } from '@/page.js';
import { provideMetadataReceiver, provideReactiveMetadata } from '@/page.js';
import { mainRouter } from '@/router.js';
import { DI } from '@/di.js';

const narrowCommunity = useMobileCommunityFeed();
const isHomepage = computed(() => mainRouter.currentRoute.value.name === 'index');
const mobileCommunity = computed(() => narrowCommunity.value || (!isHomepage.value && deviceKind === 'smartphone'));

const pageMetadata = ref<null | PageMetadata>(null);
provide(DI.router, mainRouter);
provideMetadataReceiver((metadataGetter) => {
	pageMetadata.value = metadataGetter();
	if (pageMetadata.value) window.document.title = `${pageMetadata.value.title} | ${instanceName}`;
});
provideReactiveMetadata(pageMetadata);

</script>

<style lang="scss" module>
.root { display: flex; flex-direction: column; height: 100dvh; overflow: clip; }
.withDesktopNavigation { padding-inline-start: 64px; }
.main { display: flex; flex-direction: column; flex: 1; min-width: 0; min-height: 0; }
.content { flex: 1; min-height: 0; overflow-y: auto; }
.homeContent { overflow-y: auto; }
</style>
