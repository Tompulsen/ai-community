<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<PageWithHeader v-model:tab="tab" :actions="headerActions" :tabs="headerTabs" :swipable="true">
	<div :class="$style.content">
		<XHome v-if="tab === 'home'"/>
		<XInvitations v-else-if="tab === 'invitations'"/>
		<XJoiningRooms v-else-if="tab === 'joiningRooms'"/>
		<XOwnedRooms v-else-if="tab === 'ownedRooms'"/>
	</div>
</PageWithHeader>
</template>

<script lang="ts" setup>
import { computed, ref } from 'vue';
import XHome from './home.home.vue';
import XInvitations from './home.invitations.vue';
import XJoiningRooms from './home.joiningRooms.vue';
import XOwnedRooms from './home.ownedRooms.vue';
import { i18n } from '@/i18n.js';
import { definePage } from '@/page.js';

const tab = ref('home');

const headerActions = computed(() => []);

const headerTabs = computed(() => [{
	key: 'home',
	title: i18n.ts._chat.home,
	icon: 'ti ti-home',
}, {
	key: 'invitations',
	title: i18n.ts._chat.invitations,
	icon: 'ti ti-ticket',
}, {
	key: 'joiningRooms',
	title: i18n.ts._chat.joiningRooms,
	icon: 'ti ti-users-group',
}, {
	key: 'ownedRooms',
	title: i18n.ts._chat.yourRooms,
	icon: 'ti ti-settings',
}]);

definePage(() => ({
	title: i18n.ts.directMessage,
	icon: 'ti ti-messages',
}));
</script>

<style lang="scss" module>
.content { width: 100%; max-width: 1040px; margin: 0 auto; padding: 28px 32px; box-sizing: border-box; }
@media (max-width: 600px) { .content { padding: 20px 12px; } }
</style>
