<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<XSetup v-if="instance.requireSetup"/>
<CommunitySurface v-else :section="activeSection" :initialQuery="publicQuery" :publicationMode="instance.clientOptions.communityPublicationMode === 'after' ? 'after' : 'before'" :compose="(props.section ?? props.module) === 'compose'" :composeRequest="composeRequest" :viewerId="$i?.id" :signedIn="!!$i" :moderator="iAmModerator" :registrationClosed="instance.disableRegistration" :gateway="gateway" @navigate="navigate" @login="login" @signup="signup"><template #composerAvatar><MkAvatar v-if="$i" :user="$i" :link="false" :preview="false" style="width: 100%; height: 100%;"/></template></CommunitySurface>
</template>

<script setup lang="ts">
import { computed, defineAsyncComponent, onActivated, onBeforeUnmount, ref } from 'vue';
import CommunitySurface from './community/surface.vue';
import { createBrowserCommunityGateway } from './community/browser-gateway.js';
import { communityText, communitySections } from './community/copy.js';
import XSetup from './welcome.setup.vue';
import { $i, iAmModerator } from '@/i.js';
import { instance } from '@/instance.js';
import { definePage } from '@/page.js';
import { useRouter } from '@/router.js';
import * as os from '@/os.js';

const props = defineProps<{ section?: string; module?: string; initialQuery?: string; }>();
const activeSection = computed(() => {
	const section = props.section ?? props.module ?? 'all';
	return section === 'compose' ? 'all' : ['text', 'code', 'skill', 'knowledge'].includes(section) ? 'resource' : section;
});
const publicQuery = computed(() => ['all', 'video', 'image', 'resource'].includes(activeSection.value) ? props.initialQuery : undefined);
const router = useRouter();
const composeRequest = ref(0);

function reopenComposer() {
	if ((props.section ?? props.module) === 'compose') composeRequest.value++;
}

router.on('same', reopenComposer);
onActivated(reopenComposer);
onBeforeUnmount(() => router.off('same', reopenComposer));
const gateway = createBrowserCommunityGateway();

function navigate(path: string) { router.push(path); }

function login() {
	const { dispose } = os.popup(defineAsyncComponent(() => import('@/components/MkSigninDialog.vue')), { autoSet: true }, { closed: () => dispose() });
}

function signup() {
	const { dispose } = os.popup(defineAsyncComponent(() => import('@/components/MkSignupDialog.vue')), { autoSet: true }, { closed: () => dispose() });
}

definePage(() => ({
	title: communitySections.find(entry => entry.id === activeSection.value)?.title ?? communityText.brand,
	icon: 'ti ti-sparkles',
	needWideArea: true,
}));
</script>
