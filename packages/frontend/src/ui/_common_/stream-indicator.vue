<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div v-if="hasDisconnected && prefer.s.serverDisconnectedBehavior === 'quiet'" :class="$style.root" class="_panel _shadow">
	<div role="status"><i class="ti ti-alert-triangle" aria-hidden="true"></i> {{ i18n.ts.disconnectedFromServer }}</div>
	<div :class="$style.command" class="_buttons">
		<MkButton small primary @click="reload">{{ i18n.ts.reload }}</MkButton>
		<MkButton small @click="resetDisconnected">{{ i18n.ts.doNothing }}</MkButton>
	</div>
</div>
</template>

<script lang="ts" setup>
import { onUnmounted, ref } from 'vue';
import { useStream } from '@/stream.js';
import { i18n } from '@/i18n.js';
import MkButton from '@/components/MkButton.vue';
import * as os from '@/os.js';
import { prefer } from '@/preferences.js';
import { store } from '@/store.js';

const zIndex = os.claimZIndex('high');

const hasDisconnected = ref(false);
let disconnectTimer: number | undefined;

function onDisconnected() {
	if (disconnectTimer != null || hasDisconnected.value) return;
	// Give automatic reconnection time to recover from a brief network interruption.
	disconnectTimer = window.setTimeout(() => {
		disconnectTimer = undefined;
		hasDisconnected.value = true;
	}, 5000);
}

function resetDisconnected() {
	window.clearTimeout(disconnectTimer);
	disconnectTimer = undefined;
	hasDisconnected.value = false;
}

function reload() {
	window.location.reload();
}

if (store.s.realtimeMode) {
	const stream = useStream();
	stream.on('_disconnected_', onDisconnected);
	stream.on('_connected_', resetDisconnected);
	if (stream.state === 'reconnecting') onDisconnected();

	onUnmounted(() => {
		stream.off('_disconnected_', onDisconnected);
		stream.off('_connected_', resetDisconnected);
		resetDisconnected();
	});
}
</script>

<style lang="scss" module>
.root {
	position: fixed;
	z-index: v-bind(zIndex);
	bottom: calc(var(--MI-minBottomSpacing) + var(--MI-margin));
	right: var(--MI-margin);
	margin: 0;
	padding: 12px;
	font-size: 0.9em;
	max-width: 320px;
}

.command {
	margin-top: 8px;
}
</style>
