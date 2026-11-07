<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<span v-if="!$i || $i.id !== authorId" :class="$style.root">
	<button type="button" class="_button" :class="$style.button" :aria-label="noteId ? t.reportComment : t.reportWork" :title="noteId ? t.reportComment : t.reportWork" :disabled="busy || reported" :aria-busy="busy" @click="report"><i class="ti ti-flag" aria-hidden="true"></i><span>{{ reported ? t.reported : busy ? t.sending : t.report }}</span></button>
	<span v-if="error" role="alert" :class="$style.error">{{ error }}</span>
</span>
</template>

<script setup lang="ts">
import { onActivated, onBeforeUnmount, onDeactivated, ref, watch } from 'vue';
import { safetyText as t } from './safety-copy.js';
import { $i } from '@/i.js';
import * as os from '@/os.js';
import { misskeyApi } from '@/utility/misskey-api.js';

const props = defineProps<{ submissionId: string; authorId: string; noteId?: string }>();
const emit = defineEmits<{ (ev: 'login'): void }>();
const busy = ref(false), reported = ref(false), error = ref(''), reason = ref('');
let active = true, generation = 0;
let controller: AbortController | undefined;

function invalidate() { controller?.abort(); generation++; busy.value = false; reported.value = false; error.value = ''; reason.value = ''; }

watch(() => [props.submissionId, props.noteId, $i?.id], invalidate);
onActivated(() => { active = true; });
onDeactivated(() => { active = false; controller?.abort(); generation++; busy.value = false; });
onBeforeUnmount(() => { active = false; controller?.abort(); generation++; });

async function report() {
	if (!$i) { emit('login'); return; }
	if (!active || busy.value || reported.value) return;
	const current = generation, userId = $i.id;
	const target = { submissionId: props.submissionId, ...(props.noteId ? { noteId: props.noteId } : {}) };
	const valid = () => active && current === generation && $i?.id === userId;
	busy.value = true; error.value = '';
	let timeout: number | undefined;
	try {
		const input = await os.inputText({ title: props.noteId ? t.reportComment : t.reportWork, text: t.reportHint, default: reason.value, minLength: 1, maxLength: 1000 });
		if (!valid() || input.canceled) return;
		reason.value = input.result.trim();
		if (!reason.value) { error.value = t.reasonRequired; return; }
		const request = new AbortController(); controller = request;
		timeout = window.setTimeout(() => request.abort(), 15000);
		await misskeyApi('community/report', { ...target, reason: reason.value }, undefined, request.signal);
		if (!valid()) return;
		reported.value = true; reason.value = ''; os.toast(t.reportSuccess);
	} catch (cause) {
		if (!valid()) return;
		const code = cause && typeof cause === 'object' && 'code' in cause ? cause.code : '';
		error.value = code === 'COMMUNITY_FORBIDDEN' ? t.reportForbidden : code === 'COMMUNITY_NOT_FOUND' ? t.reportUnavailable : t.reportFailed;
	} finally { window.clearTimeout(timeout); if (valid()) { busy.value = false; controller = undefined; } }
}
</script>

<style lang="scss" module>
.root { display: inline-flex; flex-wrap: wrap; align-items: center; min-width: 0; }
.button { display: inline-flex; align-items: center; justify-content: center; gap: 5px; min-width: 44px; min-height: 44px; padding: 0 6px; border-radius: 8px; font-size: 12px; color: var(--MI_THEME-fg); &:hover:not(:disabled) { background: var(--MI_THEME-buttonHoverBg); } &:focus-visible { outline: 2px solid var(--MI_THEME-accent); outline-offset: 2px; } &:disabled { cursor: default; opacity: .65; } }
.error { width: 100%; font-size: 12px; line-height: 1.6; color: var(--MI_THEME-error); overflow-wrap: anywhere; }
</style>
