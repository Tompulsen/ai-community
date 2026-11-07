<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->
<template>
<div class="_gaps_m">
	<header :class="$style.header">
		<div><h1 :class="$style.title">{{ t.title }}</h1><p :class="$style.intro">{{ t.intro }}</p></div>
		<div v-if="$i.policies.chatAvailability === 'available'" :class="$style.actions">
			<MkButton primary @click="startUser"><i class="ti ti-edit" aria-hidden="true"></i> {{ t.start }}</MkButton>
			<MkButton @click="createRoom"><i class="ti ti-users-group" aria-hidden="true"></i> {{ t.createRoom }}</MkButton>
		</div>
	</header>
	<MkInfo v-if="$i.policies.chatAvailability !== 'available'">{{ $i.policies.chatAvailability === 'readonly' ? i18n.ts._chat.chatIsReadOnlyForThisAccountOrServer : i18n.ts._chat.chatNotAvailableForThisAccountOrServer }}</MkInfo>
	<XSearch/>
	<section :aria-label="t.history">
		<h2 :class="$style.sectionTitle">{{ t.history }}</h2>
		<MkChatHistories>
			<template #empty>
				<div :class="$style.empty">
					<i class="ti ti-messages" aria-hidden="true"></i>
					<h3>{{ t.emptyTitle }}</h3>
					<p>{{ t.emptyHint }}</p>
					<MkButton v-if="$i.policies.chatAvailability === 'available'" @click="startUser">{{ t.start }}</MkButton>
				</div>
			</template>
		</MkChatHistories>
	</section>
</div>
</template>

<script lang="ts" setup>
import XSearch from './room.search.vue';
import { chatText as t } from './copy.js';
import MkButton from '@/components/MkButton.vue';
import MkInfo from '@/components/MkInfo.vue';
import MkChatHistories from '@/components/MkChatHistories.vue';
import { i18n } from '@/i18n.js';
import { misskeyApi } from '@/utility/misskey-api.js';
import { ensureSignin } from '@/i.js';
import { useRouter } from '@/router.js';
import * as os from '@/os.js';

const $i = ensureSignin();
const router = useRouter();

async function startUser() {
	const user = await os.selectUser({ localOnly: true, includeSelf: false });
	router.push('/chat/user/:userId', { params: { userId: user.id } });
}

async function createRoom() {
	const { canceled, result } = await os.inputText({ title: i18n.ts.name, minLength: 1 });
	if (canceled || !result.trim()) return;
	try {
		const room = await misskeyApi('chat/rooms/create', { name: result.trim() });
		router.push('/chat/room/:roomId', { params: { roomId: room.id } });
	} catch {
		os.alert({ type: 'error', text: t.roomFailed });
	}
}
</script>

<style lang="scss" module>
.header { display: flex; justify-content: space-between; align-items: center; gap: 20px; flex-wrap: wrap; }
.title { margin: 0; font-size: 24px; }
.intro { margin: 6px 0 0; font-size: 14px; line-height: 1.6; }
.actions { display: flex; gap: 10px; flex-wrap: wrap; }
.sectionTitle { margin: 6px 0 16px; font-size: 16px; }
.empty { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; min-height: 260px; padding: 32px 20px; text-align: center; border-radius: var(--MI-radius); background: var(--MI_THEME-panel); }
.empty > i { font-size: 30px; }
.empty h3 { font-size: 18px; margin: 0; }
.empty p { max-width: 38ch; margin: 0 0 8px; font-size: 14px; line-height: 1.7; }
</style>
